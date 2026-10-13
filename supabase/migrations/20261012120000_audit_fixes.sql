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
