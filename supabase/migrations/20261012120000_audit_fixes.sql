-- 2026-10-12 database audit fixes. Idempotent: safe to re-run, and safe whether or
-- not every earlier migration has been applied (each block checks what it needs).
-- Depends on 20260905165846_rc_event_fulfillment (recompute_user_plan,
-- rc_preserve_external_grant, rc_entitlement_sources) and
-- 20260905164849_security_boundary_hardening (auth.uid()-bound is_coach/has_role).

-- ---------------------------------------------------------------------------
-- 1. Coach-derived client tiers must follow the coach's own coach status.
--    recompute_user_plan() only counts a coach_clients grant while the coach's
--    profile is 'coach', but nothing re-ran it for the clients when the coach's
--    subscription lapsed (RC EXPIRATION / Square revocation) or was restored. A
--    lapsed coach's clients therefore kept the assigned premium/exec tier
--    indefinitely (until some unrelated event recomputed them), and a renewed
--    coach's clients stayed downgraded. Account deletion already recomputes a
--    deleted coach's clients; this does the same whenever coach status flips.
--    Recursion is bounded: coach_clients.assigned_tier can never be 'coach', so
--    a client's own coach status cannot change as a result of this cascade.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_user_plan(p_user_id uuid) RETURNS public.plan_tier
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tier public.plan_tier; v_old public.plan_tier; v_client uuid;
BEGIN
 -- Nested authorized SECURITY DEFINER workflows execute as their owner.
 -- Client roles still have no EXECUTE grant and cannot select source rows.
 IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
  RAISE EXCEPTION 'trusted server role required' USING ERRCODE = '42501';
 END IF;
 SELECT plan_tier INTO v_old FROM public.profiles WHERE user_id = p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'profile missing' USING ERRCODE = 'P0002'; END IF;
 SELECT CASE WHEN tier = 'pro' THEN 'exec'::public.plan_tier ELSE tier END INTO v_tier FROM (
  SELECT tier FROM public.rc_entitlement_sources
   WHERE user_id = p_user_id AND active AND (expires_at IS NULL OR expires_at > clock_timestamp())
  UNION ALL
  SELECT cc.assigned_tier FROM public.coach_clients cc
   JOIN public.profiles coach ON coach.user_id = cc.coach_user_id
   WHERE cc.client_user_id = p_user_id AND coach.plan_tier = 'coach'
     AND cc.assigned_tier IN ('free', 'pro', 'exec', 'premium')
 ) grants
 ORDER BY CASE tier WHEN 'coach' THEN 4 WHEN 'premium' THEN 3 WHEN 'exec' THEN 2 WHEN 'pro' THEN 2 ELSE 0 END DESC
 LIMIT 1;
 v_tier := coalesce(v_tier, 'free'::public.plan_tier);
 PERFORM set_config('rc.applying', 'yes', true);
 UPDATE public.profiles SET plan_tier = v_tier WHERE user_id = p_user_id;
 PERFORM set_config('rc.applying', '', true);
 IF (v_old = 'coach') IS DISTINCT FROM (v_tier = 'coach') THEN
  FOR v_client IN
   SELECT cc.client_user_id FROM public.coach_clients cc
    JOIN public.profiles p ON p.user_id = cc.client_user_id
    WHERE cc.coach_user_id = p_user_id AND cc.client_user_id <> p_user_id
    ORDER BY cc.client_user_id
  LOOP
   PERFORM public.recompute_user_plan(v_client);
  END LOOP;
 END IF;
 RETURN v_tier;
END $$;
REVOKE ALL ON FUNCTION public.recompute_user_plan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_user_plan(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. An explicit server/admin downgrade to 'free' must revoke the 'legacy'
--    grant. rc_preserve_external_grant() recorded every external non-free tier
--    as an active legacy source but ignored external revocations, so an admin
--    (or any service-role writer) setting plan_tier='free' was silently undone
--    by the next recompute_user_plan() (any RC/Square event, coach tier change,
--    invite acceptance), restoring the revoked comp/legacy tier forever.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rc_preserve_external_grant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF coalesce(current_setting('rc.applying', true), '') = 'yes' THEN RETURN NEW; END IF;
 IF NEW.plan_tier <> 'free' AND (TG_OP = 'INSERT' OR NEW.plan_tier IS DISTINCT FROM OLD.plan_tier) THEN
  INSERT INTO public.rc_entitlement_sources(user_id, source, product_id, tier, active)
  VALUES (NEW.user_id, 'legacy', 'legacy', NEW.plan_tier, true)
  ON CONFLICT (user_id, source, product_id) DO UPDATE SET tier = excluded.tier, active = true;
 ELSIF TG_OP = 'UPDATE' AND NEW.plan_tier = 'free' AND OLD.plan_tier IS DISTINCT FROM 'free' THEN
  UPDATE public.rc_entitlement_sources SET active = false
   WHERE user_id = NEW.user_id AND source = 'legacy' AND product_id = 'legacy';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.rc_preserve_external_grant() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Admin "close / reopen account" (src/pages/Admin.tsx toggleActive) has
--    never worked: profiles had no admin UPDATE policy, so the UPDATE matched 0
--    rows under RLS and returned no error. prevent_profile_privilege_escalation
--    already permits admins to change is_active; only the RLS path was missing.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can update profiles" ON public.profiles;
CREATE POLICY "Admins can update profiles" ON public.profiles
 FOR UPDATE TO authenticated
 USING (public.has_role(auth.uid(), 'admin'::public.app_role))
 WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ---------------------------------------------------------------------------
-- 4. coach-assets writes and coach_branding creation are coach-only.
--    The storage INSERT/UPDATE policies (named "Coaches can ...") only checked
--    the folder prefix, so ANY signed-up free user could upload arbitrary files
--    (any MIME type, e.g. .html) into this public, listable bucket = free public
--    hosting on the project's storage domain. Likewise any user could insert a
--    coach_branding row and squat a public slug for a branded sign-in page.
--    Public read/listing (security/security-memory.md) and own-folder DELETE are
--    unchanged; a lapsed coach can still delete their files and edit branding.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Coaches can upload own assets" ON storage.objects;
CREATE POLICY "Coaches can upload own assets" ON storage.objects
 FOR INSERT TO authenticated
 WITH CHECK (bucket_id = 'coach-assets'
   AND (storage.foldername(name))[1] = auth.uid()::text
   AND public.is_coach(auth.uid()));
DROP POLICY IF EXISTS "Coaches can update own assets" ON storage.objects;
CREATE POLICY "Coaches can update own assets" ON storage.objects
 FOR UPDATE TO authenticated
 USING (bucket_id = 'coach-assets' AND (storage.foldername(name))[1] = auth.uid()::text)
 WITH CHECK (bucket_id = 'coach-assets'
   AND (storage.foldername(name))[1] = auth.uid()::text
   AND public.is_coach(auth.uid()));
DROP POLICY IF EXISTS "Coaches can insert own branding" ON public.coach_branding;
CREATE POLICY "Coaches can insert own branding" ON public.coach_branding
 FOR INSERT TO authenticated
 WITH CHECK (auth.uid() = coach_user_id AND public.is_coach(auth.uid()));

-- ---------------------------------------------------------------------------
-- 5. audit_history is server-authored (archive_and_reset_audit). The duplicate
--    20260412_reaudit.sql (which sorts AFTER 20260412204601_*) added a FOR ALL
--    policy "Users can view own audit_history", and 20260412204601 an INSERT
--    policy. Until 20260905170247 revoked the table grants, users could
--    insert/update/delete their own history, i.e. erase the 30-day re-audit
--    cooldown or forge audit_number. Remove the write policies so the guard
--    no longer depends on grants alone; keep a single owner SELECT policy.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own audit_history" ON public.audit_history;
DROP POLICY IF EXISTS "Users can insert own audit history" ON public.audit_history;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'audit_history'
                AND policyname = 'Users can view own audit history') THEN
  CREATE POLICY "Users can view own audit history" ON public.audit_history
   FOR SELECT TO authenticated USING (auth.uid() = user_id);
 END IF;
END $$;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_history FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. 20260905164849 revoked EXECUTE on is_client_of/has_role from anon, but the
--    coach-access policies that call is_client_of() were created without a role
--    (TO public). Postgres checks function EXECUTE when the policy expression is
--    initialised, so EVERY anon-key query on these tables (even ones that would
--    simply return 0 rows, e.g. a request racing session restore) now fails with
--    "permission denied for function is_client_of". Scope them to authenticated.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
 FOR r IN SELECT * FROM (VALUES
   ('baseline_audits', 'Coaches can view client audits'),
   ('strategic_reports', 'Coaches can view client reports'),
   ('strategic_reports', 'Coaches can update client reports'),
   ('check_ins', 'Coaches can view client check_ins'),
   ('profiles', 'Coaches can view client profiles'),
   ('audit_history', 'Coaches can view client audit history'),
   ('coaching_messages', 'Coaches can view client coaching_messages'),
   ('north_star_goals', 'Coaches can view client north_star_goals'),
   ('plan_action_completions', 'Coaches can view client plan_action_completions'),
   ('coach_annotations', 'Coaches manage own coach_annotations')
 ) AS v(tbl, pol)
 LOOP
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = r.tbl AND policyname = r.pol) THEN
   EXECUTE format('ALTER POLICY %I ON public.%I TO authenticated', r.pol, r.tbl);
  END IF;
 END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 7. Server-side enforcement of the one-audit / re-audit rule.
--    Re-audits are Premium/Coach-only with a 30-day cooldown, enforced only in
--    archive_and_reset_audit(). But RLS lets owners INSERT baseline_audits and
--    UPDATE any column, so any (free) user could start a fresh audit without
--    archiving: flip a completed audit back to in_progress and rewrite it,
--    insert a second audit and complete it (generate-report then makes a new
--    report for the new audit_id), or set status='archived' to hide the old one.
--    Rules for client roles (server roles, and archive_and_reset_audit() which
--    runs as its owner and only DELETEs, are unaffected):
--      * new audits start in_progress, and only while no COMPLETED audit
--        exists for the user (after archive_and_reset_audit there is none);
--      * completed/archived audits are frozen (status/responses/scores);
--        completed_at is pinned so a retried final save stays idempotent;
--      * only in_progress -> completed is allowed, and only when the user has
--        no other completed audit. 'archived' is server-only.
--    Legacy status='archived' rows (written directly by the old client "Start
--    Fresh", with no audit_history) are inert history and do NOT block a new or
--    in-progress audit; otherwise those users would be locked out permanently
--    (archive_and_reset_audit needs a completed audit). This cannot reopen the
--    paywall: clients can no longer create or set 'archived' rows. Leftover
--    archived rows are removed by archive_and_reset_audit's per-user DELETE and
--    never affect the cooldown, which reads audit_history only.
--    The owner's profile row is locked to serialize with archive_and_reset_audit
--    and concurrent completions (same lock that function takes).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_baseline_audit_lifecycle() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
 -- INVOKER (like prevent_profile_privilege_escalation) so current_user is the
 -- caller; owner-run SECURITY DEFINER workflows and service_role are trusted.
 -- Lookups below run under the caller's RLS, which exposes their own rows.
 IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN RETURN NEW; END IF;
 IF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
  RAISE EXCEPTION 'Audit owner is immutable' USING ERRCODE = '42501';
 END IF;
 PERFORM 1 FROM public.profiles WHERE user_id = NEW.user_id FOR UPDATE;
 IF TG_OP = 'INSERT' THEN
  IF NEW.status IS DISTINCT FROM 'in_progress'::public.audit_status OR NEW.completed_at IS NOT NULL THEN
   RAISE EXCEPTION 'New audits must start in progress' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.baseline_audits WHERE user_id = NEW.user_id AND status = 'completed') THEN
   RAISE EXCEPTION 'A completed audit exists; use re-audit' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
 END IF;
 IF OLD.status IN ('completed', 'archived') THEN
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.responses IS DISTINCT FROM OLD.responses
     OR NEW.scores IS DISTINCT FROM OLD.scores THEN
   RAISE EXCEPTION 'Completed audits are server managed' USING ERRCODE = '42501';
  END IF;
  NEW.completed_at := OLD.completed_at;
  RETURN NEW;
 END IF;
 IF NEW.status = 'archived' THEN
  RAISE EXCEPTION 'Archiving is server managed' USING ERRCODE = '42501';
 END IF;
 IF NEW.status = 'completed' AND EXISTS (
   SELECT 1 FROM public.baseline_audits
    WHERE user_id = NEW.user_id AND id <> NEW.id AND status = 'completed') THEN
  RAISE EXCEPTION 'A completed audit exists; use re-audit' USING ERRCODE = '42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_baseline_audit_lifecycle() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_baseline_audit_lifecycle ON public.baseline_audits;
CREATE TRIGGER guard_baseline_audit_lifecycle BEFORE INSERT OR UPDATE ON public.baseline_audits
 FOR EACH ROW EXECUTE FUNCTION public.guard_baseline_audit_lifecycle();

-- ---------------------------------------------------------------------------
-- 8. One report per audit. generate-report does check-then-insert, so two
--    concurrent calls (double tap / retry) both pass the existence check and
--    insert two reports for one audit. First, reports whose audit_id points at
--    ANOTHER user's audit (possible before validate_owned_references existed)
--    are detached so they cannot win the dedupe or block the owner's report.
--    Existing duplicates are NOT deleted:
--    all but the newest (created_at, id) are detached (audit_id = NULL), which
--    keeps every row and its plan_action_completions/annotations intact; the
--    app always shows the newest report. Then enforce uniqueness. Runs in one
--    DO block so the table lock covers dedupe + index build.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'strategic_reports_audit_id_unique') THEN
  LOCK TABLE public.strategic_reports IN SHARE ROW EXCLUSIVE MODE;
  UPDATE public.strategic_reports r SET audit_id = NULL
   WHERE r.audit_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.baseline_audits a WHERE a.id = r.audit_id AND a.user_id = r.user_id);
  UPDATE public.strategic_reports r SET audit_id = NULL
   FROM (SELECT id, row_number() OVER (PARTITION BY audit_id ORDER BY created_at DESC, id DESC) AS rn
           FROM public.strategic_reports WHERE audit_id IS NOT NULL) d
   WHERE r.id = d.id AND d.rn > 1;
  EXECUTE 'CREATE UNIQUE INDEX strategic_reports_audit_id_unique ON public.strategic_reports (audit_id) WHERE audit_id IS NOT NULL';
 END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 9. One-off data repair for shapes written by older edge-function code.
--    a) refresh-plan stored edited_ninety_day_plan as {"phases":[...]}; the app
--       (Report.tsx) reads/writes a bare array. Unwrap.
--    b) Report.tsx cached pattern-intelligence ERROR bodies ({"error":...}) in
--       strategic_reports.pattern_intelligence, which then suppressed
--       regeneration. Clear them so the next view regenerates.
--    Rows whose audit_id fails the ownership trigger (pre-hardening data) are
--    skipped rather than aborting the migration.
-- ---------------------------------------------------------------------------
UPDATE public.strategic_reports r
   SET edited_ninety_day_plan = CASE
         WHEN jsonb_typeof(r.edited_ninety_day_plan) = 'object'
          AND jsonb_typeof(r.edited_ninety_day_plan -> 'phases') = 'array'
         THEN r.edited_ninety_day_plan -> 'phases' ELSE r.edited_ninety_day_plan END,
       pattern_intelligence = CASE
         WHEN jsonb_typeof(r.pattern_intelligence) = 'object' AND r.pattern_intelligence ? 'error'
         THEN NULL ELSE r.pattern_intelligence END
 WHERE ((jsonb_typeof(r.edited_ninety_day_plan) = 'object' AND jsonb_typeof(r.edited_ninety_day_plan -> 'phases') = 'array')
        OR (jsonb_typeof(r.pattern_intelligence) = 'object' AND r.pattern_intelligence ? 'error'))
   AND (r.audit_id IS NULL OR EXISTS (SELECT 1 FROM public.baseline_audits a WHERE a.id = r.audit_id AND a.user_id = r.user_id));

-- ---------------------------------------------------------------------------
-- 10. coach_accept_invite: an already-linked client re-opening an invite link
--     that has since expired, been deactivated, hit max_uses or been deleted got
--     an error ("Invalid or expired invite") although nothing needed to change.
--     "Already linked" is now answered before invite validity (it changes no
--     state), and re-checked after the profile locks as the concurrency guard.
--     For a deleted invite the coach is unknown, so idempotent success requires
--     the caller to also pass p_coach_user_id of the existing link.
--     Branded (code-less) joins now also require the coach to have a
--     coach_branding row (the edge function matches the caller's slug to it);
--     previously any user could join ANY active coach by UUID alone.
--     Owner (service_role), ACL and signature are preserved by CREATE OR REPLACE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.coach_accept_invite(p_client_user_id uuid, p_invite_code text DEFAULT NULL, p_coach_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_coach uuid; v_link public.coach_invite_links; v_tier public.plan_tier := 'free';
BEGIN
 IF p_client_user_id IS NULL THEN RAISE EXCEPTION 'Client required' USING ERRCODE = '22023'; END IF;
 IF p_invite_code IS NOT NULL AND p_invite_code <> '__branded__' THEN
  SELECT coach_user_id INTO v_coach FROM public.coach_invite_links WHERE invite_code = p_invite_code;
  IF NOT FOUND THEN
   IF p_coach_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.coach_clients
       WHERE coach_user_id = p_coach_user_id AND client_user_id = p_client_user_id) THEN
    RETURN jsonb_build_object('success', true, 'coach_user_id', p_coach_user_id, 'message', 'Already linked');
   END IF;
   RAISE EXCEPTION 'Invalid invite' USING ERRCODE = '22023';
  END IF;
 ELSE v_coach := p_coach_user_id;
 END IF;
 IF v_coach IS NULL OR v_coach = p_client_user_id THEN RAISE EXCEPTION 'Invalid coach' USING ERRCODE = '22023'; END IF;
 IF EXISTS (SELECT 1 FROM public.coach_clients WHERE coach_user_id = v_coach AND client_user_id = p_client_user_id) THEN
  RETURN jsonb_build_object('success', true, 'coach_user_id', v_coach, 'message', 'Already linked');
 END IF;
 -- Branded (code-less) self-service joins only reach coaches with a public
 -- branded page; process-coach-invite additionally matches the caller's slug.
 IF (p_invite_code IS NULL OR p_invite_code = '__branded__')
    AND NOT EXISTS (SELECT 1 FROM public.coach_branding WHERE coach_user_id = v_coach) THEN
  RAISE EXCEPTION 'Invalid coach' USING ERRCODE = '22023';
 END IF;
 PERFORM 1 FROM public.profiles WHERE user_id IN (v_coach, p_client_user_id) ORDER BY user_id FOR UPDATE;
 IF EXISTS (SELECT 1 FROM public.coach_clients WHERE coach_user_id = v_coach AND client_user_id = p_client_user_id) THEN
  RETURN jsonb_build_object('success', true, 'coach_user_id', v_coach, 'message', 'Already linked');
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_coach AND plan_tier = 'coach' AND is_active) THEN
  RAISE EXCEPTION 'Active coach required' USING ERRCODE = '42501'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = p_client_user_id AND is_active) THEN
  RAISE EXCEPTION 'Active client required' USING ERRCODE = '42501'; END IF;
 IF p_invite_code IS NOT NULL AND p_invite_code <> '__branded__' THEN
  SELECT * INTO v_link FROM public.coach_invite_links WHERE invite_code = p_invite_code AND coach_user_id = v_coach FOR UPDATE;
  IF NOT FOUND OR NOT v_link.is_active OR (v_link.expires_at IS NOT NULL AND v_link.expires_at <= clock_timestamp()) THEN
   RAISE EXCEPTION 'Invalid or expired invite' USING ERRCODE = '22023'; END IF;
  v_tier := v_link.assigned_tier;
 END IF;
 IF v_tier::text NOT IN ('free', 'exec', 'pro', 'premium') THEN RAISE EXCEPTION 'Invalid invite tier' USING ERRCODE = '22023'; END IF;
 IF v_link.max_uses IS NOT NULL AND v_link.uses_count >= v_link.max_uses THEN
  RAISE EXCEPTION 'Invite usage limit reached' USING ERRCODE = '22023'; END IF;
 -- Existing UNIQUE(coach_user_id,client_user_id) is the final concurrency backstop.
 INSERT INTO public.coach_clients(coach_user_id, client_user_id, assigned_tier) VALUES (v_coach, p_client_user_id, v_tier);
 IF v_link.id IS NOT NULL THEN UPDATE public.coach_invite_links SET uses_count = uses_count + 1 WHERE id = v_link.id; END IF;
 PERFORM public.recompute_user_plan(p_client_user_id);
 RETURN jsonb_build_object('success', true, 'coach_user_id', v_coach);
END $$;
REVOKE ALL ON FUNCTION public.coach_accept_invite(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coach_accept_invite(uuid, text, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 11. Push tokens follow the device's current user. UNIQUE(user_id, token)
--     lets one device token stay registered to a previous account (session
--     expired / app reinstalled / no clean sign-out), so that account's
--     notifications keep arriving on a device now used by someone else. RLS
--     cannot remove another user's row, so registration goes through this RPC:
--       public.register_push_token(p_token text, p_platform text) RETURNS void
--     platform: 'ios' | 'android' | 'web' (Capacitor.getPlatform()).
--     Direct push_tokens upsert/delete by the owner keep working (sign-out).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_push_token(p_token text, p_platform text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u uuid := auth.uid();
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
 IF p_token IS NULL OR length(btrim(p_token)) NOT BETWEEN 1 AND 4096 THEN
  RAISE EXCEPTION 'Invalid push token' USING ERRCODE = '22023'; END IF;
 IF p_platform IS NULL OR p_platform NOT IN ('ios', 'android', 'web') THEN
  RAISE EXCEPTION 'Invalid platform' USING ERRCODE = '22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('push-token:' || p_token, 0));
 DELETE FROM public.push_tokens WHERE token = p_token AND user_id <> u;
 INSERT INTO public.push_tokens(user_id, token, platform) VALUES (u, p_token, p_platform)
 ON CONFLICT (user_id, token) DO UPDATE SET platform = excluded.platform;
END $$;
REVOKE ALL ON FUNCTION public.register_push_token(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_push_token(text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 12. A report's owner is immutable for client roles. "Coaches can update
--     client reports" checks is_client_of() on both the old and new row, so a
--     coach could re-point client A's report (A's private audit analysis) at
--     client B (user_id = B), disclosing it to B. Owners cannot move rows (their
--     WITH CHECK pins user_id = auth.uid()); server roles are exempt.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_strategic_report_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
 IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN RETURN NEW; END IF;
 IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
  RAISE EXCEPTION 'Report owner is immutable' USING ERRCODE = '42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_strategic_report_owner() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_strategic_report_owner ON public.strategic_reports;
CREATE TRIGGER guard_strategic_report_owner BEFORE UPDATE ON public.strategic_reports
 FOR EACH ROW EXECUTE FUNCTION public.guard_strategic_report_owner();

-- ---------------------------------------------------------------------------
-- 13. RevenueCat refunds revoke access. A refund arrives as CANCELLATION
--     (cancel_reason CUSTOMER_SUPPORT) whose expiration_at_ms is moved back to
--     the refund time; RevenueCat documents no EXPIRATION after it. CANCELLATION
--     was 'ignored', so a refunded subscriber kept the paid tier indefinitely
--     (nothing recomputes plan_tier when expires_at merely passes). A
--     CANCELLATION now SHORTENS the source's expiry when it is newer than the
--     source's last event and its expiration is earlier; an ordinary
--     unsubscribe carries the unchanged period end and still changes nothing.
--     Signature, owner and ACL are preserved by CREATE OR REPLACE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rc_apply_event(p_event_id text, p_user_id uuid, p_app_id text, p_store text, p_environment text,
 p_product_id text, p_event_type text, p_event_at timestamptz, p_expires_at timestamptz)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_source text; v_tier public.plan_tier; v_old public.rc_entitlement_sources%rowtype;
 v_event public.rc_events%rowtype; v_outcome text := 'applied'; v_grant boolean;
BEGIN
 IF current_user <> 'service_role' THEN RAISE EXCEPTION 'service_role required' USING ERRCODE = '42501'; END IF;
 IF p_event_id IS NULL OR length(p_event_id) NOT BETWEEN 1 AND 200 OR p_user_id IS NULL OR
    p_event_at IS NULL OR NOT isfinite(p_event_at) OR p_event_at < '2020-01-01'::timestamptz OR p_event_at > clock_timestamp() + interval '5 minutes' THEN
  RAISE EXCEPTION 'invalid event' USING ERRCODE = '22023'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.rc_product_config WHERE app_id = p_app_id AND store = p_store AND environment = p_environment
                AND product_id = p_product_id AND enabled) THEN
  RETURN 'unconfigured'; END IF;
 -- Serialize both same-user changes and event IDs, including cross-user replay.
 PERFORM pg_advisory_xact_lock(hashtextextended('rc-event:' || p_event_id, 0));
 SELECT * INTO v_event FROM public.rc_events WHERE event_id = p_event_id;
 IF FOUND THEN
  IF (v_event.user_id, v_event.app_id, v_event.store, v_event.environment, v_event.product_id, v_event.event_type, v_event.event_at, v_event.expires_at)
     IS DISTINCT FROM (p_user_id, p_app_id, p_store, p_environment, p_product_id, p_event_type, p_event_at, p_expires_at) THEN
   RAISE EXCEPTION 'event ID collision' USING ERRCODE = '22023'; END IF;
  RETURN 'duplicate'; END IF;
 PERFORM 1 FROM public.profiles WHERE user_id = p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'profile missing' USING ERRCODE = 'P0002'; END IF;
 v_source := 'revenuecat:' || p_app_id || ':' || p_store || ':' || p_environment;
 v_tier := CASE p_product_id WHEN 'intentus_executive_monthly' THEN 'exec'::public.plan_tier
                             WHEN 'intentus_premium_monthly' THEN 'premium'::public.plan_tier ELSE 'coach'::public.plan_tier END;
 v_grant := p_event_type IN ('INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'SUBSCRIPTION_EXTENDED', 'TEMPORARY_ENTITLEMENT_GRANT');
 IF v_grant THEN
  IF p_expires_at IS NULL OR NOT isfinite(p_expires_at) OR p_expires_at <= clock_timestamp() OR p_expires_at <= p_event_at THEN
   RAISE EXCEPTION 'future expiration required' USING ERRCODE = '22023'; END IF;
 ELSIF p_event_type = 'EXPIRATION' THEN
  IF p_expires_at IS NULL OR NOT isfinite(p_expires_at) OR p_expires_at > clock_timestamp() THEN
   RAISE EXCEPTION 'expiration not reached' USING ERRCODE = '22023'; END IF;
 ELSIF p_event_type <> 'CANCELLATION' THEN v_outcome := 'ignored';
 END IF;
 -- PRODUCT_CHANGE schedules a change: only purchase/renewal establishes paid access.
 SELECT * INTO v_old FROM public.rc_entitlement_sources WHERE user_id = p_user_id AND source = v_source AND product_id = p_product_id;
 IF p_event_type = 'CANCELLATION' THEN
  IF v_old.user_id IS NOT NULL AND v_old.active AND p_expires_at IS NOT NULL AND isfinite(p_expires_at)
     AND v_old.expires_at IS NOT NULL AND p_expires_at < v_old.expires_at
     AND (v_old.event_at IS NULL OR p_event_at > v_old.event_at) THEN
   UPDATE public.rc_entitlement_sources SET expires_at = p_expires_at, event_at = p_event_at, event_id = p_event_id
    WHERE user_id = p_user_id AND source = v_source AND product_id = p_product_id;
   PERFORM public.recompute_user_plan(p_user_id);
  ELSE v_outcome := 'ignored';
  END IF;
 ELSIF v_outcome <> 'ignored' THEN
  IF v_old.event_at IS NOT NULL AND p_event_at <= v_old.event_at THEN v_outcome := 'stale';
  ELSIF NOT v_grant AND v_old.expires_at IS NOT NULL AND p_expires_at < v_old.expires_at THEN v_outcome := 'stale';
  ELSE
   INSERT INTO public.rc_entitlement_sources(user_id, source, product_id, tier, expires_at, event_at, event_id, active)
   VALUES (p_user_id, v_source, p_product_id, v_tier, p_expires_at, p_event_at, p_event_id, v_grant)
   ON CONFLICT (user_id, source, product_id) DO UPDATE SET tier = excluded.tier, expires_at = excluded.expires_at,
    event_at = excluded.event_at, event_id = excluded.event_id, active = excluded.active;
   PERFORM public.recompute_user_plan(p_user_id);
  END IF;
 END IF;
 INSERT INTO public.rc_events(event_id, user_id, app_id, store, environment, product_id, event_type, event_at, expires_at, outcome)
 VALUES (p_event_id, p_user_id, p_app_id, p_store, p_environment, p_product_id, p_event_type, p_event_at, p_expires_at, v_outcome);
 RETURN v_outcome;
END $$;
REVOKE ALL ON FUNCTION public.rc_apply_event(text, uuid, text, text, text, text, text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rc_apply_event(text, uuid, text, text, text, text, text, timestamptz, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 14. RevenueCat TRANSFER (e.g. a second Intentus account restoring the same
--     Apple ID's purchases). The event has no app_user_id/product_id, so the
--     webhook rejected it (400) forever: the account the purchase moved AWAY
--     from kept its paid tier indefinitely (later events go to the new owner,
--     so no EXPIRATION ever reaches it) and the new owner got nothing until the
--     next renewal. rc_apply_transfer moves the from-accounts' live RevenueCat
--     sources for the configured app (and store/environment when present) to
--     the single Intentus target, deactivates them on the sources, and
--     recomputes everyone. Non-UUID ids (anonymous RC ids) are skipped; with
--     no single Intentus target the sources are only revoked (RC moved them),
--     except that an anonymous-only destination revokes nothing (see below).
--     Sources updated after the transfer time are left alone.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rc_transfer_events (
 event_id text PRIMARY KEY CHECK (length(event_id) BETWEEN 1 AND 200),
 app_id text NOT NULL, store text, environment text,
 event_at timestamptz NOT NULL,
 transferred_from text[] NOT NULL, transferred_to text[] NOT NULL,
 outcome text NOT NULL CHECK (outcome IN ('applied', 'ignored')),
 received_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rc_transfer_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rc_transfer_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rc_transfer_events TO service_role;

CREATE OR REPLACE FUNCTION public.rc_apply_transfer(p_event_id text, p_app_id text, p_store text, p_environment text,
 p_event_at timestamptz, p_from text[], p_to text[])
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_prior public.rc_transfer_events%rowtype; v_sources text[]; v_from uuid[]; v_to uuid[]; v_target uuid;
 v_row public.rc_entitlement_sources%rowtype; v_moved integer := 0; v_user uuid;
 c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
 IF current_user <> 'service_role' THEN RAISE EXCEPTION 'service_role required' USING ERRCODE = '42501'; END IF;
 IF p_event_id IS NULL OR length(p_event_id) NOT BETWEEN 1 AND 200 OR p_app_id IS NULL OR
    p_event_at IS NULL OR NOT isfinite(p_event_at) OR p_event_at < '2020-01-01'::timestamptz OR p_event_at > clock_timestamp() + interval '5 minutes' OR
    p_from IS NULL OR p_to IS NULL OR cardinality(p_from) > 50 OR cardinality(p_to) > 50 OR
    (p_store IS NOT NULL AND p_store NOT IN ('APP_STORE', 'PLAY_STORE', 'STRIPE', 'MAC_APP_STORE', 'AMAZON')) OR
    (p_environment IS NOT NULL AND p_environment NOT IN ('PRODUCTION', 'SANDBOX')) THEN
  RAISE EXCEPTION 'invalid event' USING ERRCODE = '22023'; END IF;
 SELECT array_agg(DISTINCT 'revenuecat:' || app_id || ':' || store || ':' || environment) INTO v_sources
  FROM public.rc_product_config WHERE app_id = p_app_id AND enabled
   AND (p_store IS NULL OR store = p_store) AND (p_environment IS NULL OR environment = p_environment);
 IF v_sources IS NULL THEN RETURN 'unconfigured'; END IF;
 -- Same lock namespace as rc_apply_event: one id is one event across both tables.
 PERFORM pg_advisory_xact_lock(hashtextextended('rc-event:' || p_event_id, 0));
 IF EXISTS (SELECT 1 FROM public.rc_events WHERE event_id = p_event_id) THEN
  RAISE EXCEPTION 'event ID collision' USING ERRCODE = '22023'; END IF;
 SELECT * INTO v_prior FROM public.rc_transfer_events WHERE event_id = p_event_id;
 IF FOUND THEN
  IF (v_prior.app_id, v_prior.store, v_prior.environment, v_prior.event_at, v_prior.transferred_from, v_prior.transferred_to)
     IS DISTINCT FROM (p_app_id, p_store, p_environment, p_event_at, p_from, p_to) THEN
   RAISE EXCEPTION 'event ID collision' USING ERRCODE = '22023'; END IF;
  RETURN 'duplicate'; END IF;
 SELECT coalesce(array_agg(DISTINCT p.user_id), '{}') INTO v_to FROM public.profiles p
  WHERE p.user_id IN (SELECT x::uuid FROM unnest(p_to) x WHERE x ~ c_uuid);
 SELECT coalesce(array_agg(DISTINCT p.user_id), '{}') INTO v_from FROM public.profiles p
  WHERE p.user_id IN (SELECT x::uuid FROM unnest(p_from) x WHERE x ~ c_uuid) AND NOT (p.user_id = ANY (v_to));
 IF cardinality(v_to) = 1 THEN v_target := v_to[1]; END IF;
 -- Anonymous-only destination ($RCAnonymousID: a signed-out device): RevenueCat
 -- ALIASES that anonymous id with whoever signs in next, with no further event.
 -- That is almost always the same payer, so revoking here would strand them
 -- until the next renewal. Only an identified destination revokes the source.
 IF NOT EXISTS (SELECT 1 FROM unnest(p_to) x WHERE x ~ c_uuid) THEN v_from := '{}'; END IF;
 PERFORM 1 FROM public.profiles WHERE user_id = ANY (v_from || v_to) ORDER BY user_id FOR UPDATE;
 FOR v_row IN
  SELECT * FROM public.rc_entitlement_sources
   WHERE user_id = ANY (v_from) AND source = ANY (v_sources) AND active
     AND (event_at IS NULL OR event_at <= p_event_at)
   ORDER BY user_id, source, product_id
 LOOP
  IF v_target IS NOT NULL AND (v_row.expires_at IS NULL OR v_row.expires_at > clock_timestamp()) THEN
   INSERT INTO public.rc_entitlement_sources AS s(user_id, source, product_id, tier, expires_at, event_at, event_id, active)
   VALUES (v_target, v_row.source, v_row.product_id, v_row.tier, v_row.expires_at, v_row.event_at, v_row.event_id, true)
   ON CONFLICT (user_id, source, product_id) DO UPDATE SET tier = excluded.tier, expires_at = excluded.expires_at,
    event_at = excluded.event_at, event_id = excluded.event_id, active = true
    WHERE NOT s.active OR (s.expires_at IS NOT NULL AND s.expires_at < excluded.expires_at);
  END IF;
  UPDATE public.rc_entitlement_sources SET active = false, event_at = p_event_at, event_id = p_event_id
   WHERE user_id = v_row.user_id AND source = v_row.source AND product_id = v_row.product_id;
  v_moved := v_moved + 1;
 END LOOP;
 IF v_moved > 0 THEN
  FOREACH v_user IN ARRAY v_from LOOP PERFORM public.recompute_user_plan(v_user); END LOOP;
  IF v_target IS NOT NULL THEN PERFORM public.recompute_user_plan(v_target); END IF;
 END IF;
 INSERT INTO public.rc_transfer_events(event_id, app_id, store, environment, event_at, transferred_from, transferred_to, outcome)
 VALUES (p_event_id, p_app_id, p_store, p_environment, p_event_at, p_from, p_to, CASE WHEN v_moved > 0 THEN 'applied' ELSE 'ignored' END);
 RETURN CASE WHEN v_moved > 0 THEN 'applied' ELSE 'ignored' END;
END $$;
REVOKE ALL ON FUNCTION public.rc_apply_transfer(text, text, text, text, timestamptz, text[], text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rc_apply_transfer(text, text, text, text, timestamptz, text[], text[]) TO service_role;
-- Transfer records hold raw App User IDs without an FK: purge them with the account.
CREATE OR REPLACE FUNCTION public.rc_transfer_events_purge_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 DELETE FROM public.rc_transfer_events
  WHERE EXISTS (SELECT 1 FROM unnest(transferred_from || transferred_to) x WHERE lower(x) = OLD.id::text);
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.rc_transfer_events_purge_user() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS rc_transfer_events_purge_user ON auth.users;
CREATE TRIGGER rc_transfer_events_purge_user BEFORE DELETE ON auth.users
 FOR EACH ROW EXECUTE FUNCTION public.rc_transfer_events_purge_user();

-- ---------------------------------------------------------------------------
-- 15. Square: a coach whose web subscription ended could never subscribe
--     again. square_checkouts allowed ONE binding per user/merchant/location/
--     plan and create-square-checkout answered 409 forever once it had a
--     subscription_id. Bindings are now one per subscription (the edge function
--     only opens a new one after every bound subscription has ended at Square);
--     at most one UNBOUND (pending) checkout may exist per user/plan.
--     redirect_url records which payment links send the buyer back to the app;
--     links created before it are regenerated while still unpaid.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
 FOR r IN
  SELECT c.conname FROM pg_constraint c
   WHERE c.conrelid = 'public.square_checkouts'::regclass AND c.contype = 'u'
     AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
           WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey))
         = ARRAY['location_id', 'merchant_id', 'user_id', 'variation_id']
 LOOP
  EXECUTE format('ALTER TABLE public.square_checkouts DROP CONSTRAINT %I', r.conname);
 END LOOP;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS square_checkouts_one_pending
 ON public.square_checkouts (user_id, merchant_id, location_id, variation_id) WHERE subscription_id IS NULL;
ALTER TABLE public.square_checkouts ADD COLUMN IF NOT EXISTS redirect_url text;
