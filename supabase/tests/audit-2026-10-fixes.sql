-- Regression tests for supabase/migrations/20261012120000_audit_fixes.sql
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(42);
INSERT INTO auth.users(id,email) VALUES
('a1111111-1111-4111-8111-111111111111','fix-coach@example.invalid'),
('a2222222-2222-4222-8222-222222222222','fix-client@example.invalid'),
('a3333333-3333-4333-8333-333333333333','fix-admin@example.invalid'),
('a4444444-4444-4444-8444-444444444444','fix-free@example.invalid'),
('a5555555-5555-4555-8555-555555555555','fix-auditor@example.invalid'),
('a6666666-6666-4666-8666-666666666666','fix-legacy-a@example.invalid'),
('a7777777-7777-4777-8777-777777777777','fix-legacy-b@example.invalid');
INSERT INTO user_roles(user_id,role) VALUES ('a3333333-3333-4333-8333-333333333333','admin');
INSERT INTO storage.buckets(id,name,public) VALUES ('coach-assets','coach-assets',true) ON CONFLICT (id) DO NOTHING;

-- 1. Coach status flips cascade to coach-derived client tiers.
SET LOCAL ROLE service_role;
INSERT INTO rc_entitlement_sources(user_id,source,product_id,tier,expires_at,active)
 VALUES ('a1111111-1111-4111-8111-111111111111','square:m:sub','plan','coach',now()+interval '1 day',true);
SELECT is(recompute_user_plan('a1111111-1111-4111-8111-111111111111')::text,'coach','coach paid');
INSERT INTO coach_clients(coach_user_id,client_user_id,assigned_tier)
 VALUES ('a1111111-1111-4111-8111-111111111111','a2222222-2222-4222-8222-222222222222','premium');
SELECT is(recompute_user_plan('a2222222-2222-4222-8222-222222222222')::text,'premium','client receives coach grant');
UPDATE rc_entitlement_sources SET active=false WHERE user_id='a1111111-1111-4111-8111-111111111111';
SELECT is(recompute_user_plan('a1111111-1111-4111-8111-111111111111')::text,'free','coach lapses');
SELECT is((SELECT plan_tier::text FROM profiles WHERE user_id='a2222222-2222-4222-8222-222222222222'),'free','lapsed coach grant revoked from client');
UPDATE rc_entitlement_sources SET active=true WHERE user_id='a1111111-1111-4111-8111-111111111111';
SELECT is(recompute_user_plan('a1111111-1111-4111-8111-111111111111')::text,'coach','coach renews');
SELECT is((SELECT plan_tier::text FROM profiles WHERE user_id='a2222222-2222-4222-8222-222222222222'),'premium','renewed coach grant restored to client');
SELECT is((SELECT count(*)::int FROM rc_entitlement_sources WHERE user_id='a2222222-2222-4222-8222-222222222222'),0,'cascade does not mint legacy grants');

-- 2. External downgrade to free revokes the legacy grant.
UPDATE profiles SET plan_tier='premium' WHERE user_id='a4444444-4444-4444-8444-444444444444';
SELECT is((SELECT active FROM rc_entitlement_sources WHERE user_id='a4444444-4444-4444-8444-444444444444' AND source='legacy'),true,'external grant recorded');
UPDATE profiles SET plan_tier='free' WHERE user_id='a4444444-4444-4444-8444-444444444444';
SELECT is(recompute_user_plan('a4444444-4444-4444-8444-444444444444')::text,'free','external revocation survives recompute');
RESET ROLE;

-- 3. Admin can close an account; ordinary users still cannot.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"a3333333-3333-4333-8333-333333333333","role":"authenticated"}',true);
UPDATE profiles SET is_active=false WHERE user_id='a4444444-4444-4444-8444-444444444444';
SELECT is((SELECT is_active FROM profiles WHERE user_id='a4444444-4444-4444-8444-444444444444'),false,'admin deactivates user');
SELECT set_config('request.jwt.claims','{"sub":"a4444444-4444-4444-8444-444444444444","role":"authenticated"}',true);
UPDATE profiles SET display_name='hijacked' WHERE user_id='a2222222-2222-4222-8222-222222222222';
RESET ROLE;
SELECT is((SELECT display_name FROM profiles WHERE user_id='a2222222-2222-4222-8222-222222222222'),'fix-client@example.invalid','non-admin cannot edit another profile');
SET LOCAL ROLE authenticated;

-- 4. Only active coaches write coach-assets / create branding.
SELECT throws_ok($$INSERT INTO storage.objects(bucket_id,name) VALUES('coach-assets','a4444444-4444-4444-8444-444444444444/x.html')$$,'42501',NULL,'free user cannot upload to public bucket');
SELECT throws_ok($$INSERT INTO coach_branding(coach_user_id,slug) VALUES(auth.uid(),'squat')$$,'42501',NULL,'free user cannot claim branding slug');
SELECT set_config('request.jwt.claims','{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
SELECT lives_ok($$INSERT INTO storage.objects(bucket_id,name) VALUES('coach-assets','a1111111-1111-4111-8111-111111111111/logo.png')$$,'coach uploads own asset');
SELECT throws_ok($$INSERT INTO storage.objects(bucket_id,name) VALUES('coach-assets','a2222222-2222-4222-8222-222222222222/logo.png')$$,'42501',NULL,'coach cannot write another folder');
SELECT lives_ok($$INSERT INTO coach_branding(coach_user_id,slug) VALUES(auth.uid(),'fix-coach')$$,'coach creates branding');

-- 5. audit_history has no client write policy.
SELECT ok(NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='audit_history' AND cmd IN ('ALL','INSERT','UPDATE','DELETE')),'audit_history write policies removed');
RESET ROLE;

-- 7. Audit lifecycle is enforced server-side (re-audit only via archive_and_reset_audit).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"a5555555-5555-4555-8555-555555555555","role":"authenticated"}',true);
SELECT throws_ok($$INSERT INTO baseline_audits(user_id,status) VALUES(auth.uid(),'completed')$$,'42501',NULL,'cannot insert an already-completed audit');
INSERT INTO baseline_audits(id,user_id) VALUES ('a5000000-0000-4000-8000-000000000001',auth.uid()),('a5000000-0000-4000-8000-000000000002',auth.uid());
SELECT throws_ok($$UPDATE baseline_audits SET status='archived' WHERE id='a5000000-0000-4000-8000-000000000001'$$,'42501',NULL,'client cannot archive');
SELECT lives_ok($$UPDATE baseline_audits SET responses='{"q":"a"}',status='completed',completed_at=now() WHERE id='a5000000-0000-4000-8000-000000000001'$$,'normal completion works');
SELECT lives_ok($$UPDATE baseline_audits SET responses='{"q":"a"}',status='completed',completed_at=now()+interval '1 hour' WHERE id='a5000000-0000-4000-8000-000000000001'$$,'retried final save is idempotent');
SELECT ok((SELECT completed_at < now()+interval '1 minute' FROM baseline_audits WHERE id='a5000000-0000-4000-8000-000000000001'),'completed_at pinned on retry');
SELECT throws_ok($$UPDATE baseline_audits SET status='in_progress' WHERE id='a5000000-0000-4000-8000-000000000001'$$,'42501',NULL,'cannot reopen a completed audit');
SELECT throws_ok($$UPDATE baseline_audits SET status='completed' WHERE id='a5000000-0000-4000-8000-000000000002'$$,'42501',NULL,'cannot complete a spare audit as a second audit');
SELECT throws_ok($$INSERT INTO baseline_audits(user_id) VALUES(auth.uid())$$,'42501',NULL,'cannot start a new audit while one is completed');
RESET ROLE;
UPDATE profiles SET plan_tier='premium' WHERE user_id='a5555555-5555-4555-8555-555555555555';
SET LOCAL ROLE authenticated;
SELECT is(archive_and_reset_audit('a5000000-0000-4000-8000-000000000001'),1,'premium re-audit archives');
SELECT lives_ok($$INSERT INTO baseline_audits(user_id) VALUES(auth.uid())$$,'new audit allowed after archive');
RESET ROLE;

-- 7b. Legacy client-written 'archived' rows (old "Start Fresh") must not lock users out.
INSERT INTO baseline_audits(id,user_id,status) VALUES
 ('a6000000-0000-4000-8000-000000000001','a6666666-6666-4666-8666-666666666666','archived'),
 ('a6000000-0000-4000-8000-000000000002','a6666666-6666-4666-8666-666666666666','in_progress'),
 ('a7000000-0000-4000-8000-000000000001','a7777777-7777-4777-8777-777777777777','archived');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"a6666666-6666-4666-8666-666666666666","role":"authenticated"}',true);
SELECT lives_ok($$UPDATE baseline_audits SET status='completed',completed_at=now() WHERE id='a6000000-0000-4000-8000-000000000002'$$,'legacy archived + in_progress: in-progress audit can complete');
SELECT throws_ok($$UPDATE baseline_audits SET status='in_progress' WHERE id='a6000000-0000-4000-8000-000000000001'$$,'42501',NULL,'legacy archived row stays frozen');
SELECT throws_ok($$INSERT INTO baseline_audits(user_id) VALUES(auth.uid())$$,'42501',NULL,'completed audit still blocks a new one despite archived rows');
SELECT set_config('request.jwt.claims','{"sub":"a7777777-7777-4777-8777-777777777777","role":"authenticated"}',true);
SELECT lives_ok($$INSERT INTO baseline_audits(user_id) VALUES(auth.uid())$$,'legacy archived only: user can start an audit');
SELECT throws_ok($$INSERT INTO baseline_audits(user_id,status) VALUES(auth.uid(),'archived')$$,'42501',NULL,'client cannot manufacture archived rows');
RESET ROLE;

-- 9. One report per audit.
INSERT INTO baseline_audits(id,user_id,status) VALUES ('a4000000-0000-4000-8000-000000000001','a4444444-4444-4444-8444-444444444444','completed');
INSERT INTO strategic_reports(user_id,audit_id) VALUES ('a4444444-4444-4444-8444-444444444444','a4000000-0000-4000-8000-000000000001');
SELECT throws_ok($$INSERT INTO strategic_reports(user_id,audit_id) VALUES ('a4444444-4444-4444-8444-444444444444','a4000000-0000-4000-8000-000000000001')$$,'23505',NULL,'duplicate report for one audit rejected');

-- 10. Already-linked clients get idempotent success from stale invites.
SET LOCAL ROLE service_role;
INSERT INTO coach_invite_links(id,coach_user_id,invite_code,assigned_tier) VALUES ('a1000000-0000-4000-8000-0000000000c1','a1111111-1111-4111-8111-111111111111','fix-code','free');
SELECT lives_ok($$SELECT coach_accept_invite('a5555555-5555-4555-8555-555555555555','fix-code',NULL)$$,'client accepts invite');
UPDATE coach_invite_links SET expires_at=now()-interval '1 day' WHERE invite_code='fix-code';
SELECT is((SELECT coach_accept_invite('a5555555-5555-4555-8555-555555555555','fix-code',NULL)->>'message'),'Already linked','expired invite is idempotent for linked client');
SELECT throws_ok($$SELECT coach_accept_invite('a3333333-3333-4333-8333-333333333333','fix-code',NULL)$$,'22023',NULL,'expired invite still rejects new clients');
DELETE FROM coach_invite_links WHERE invite_code='fix-code';
SELECT is((SELECT coach_accept_invite('a5555555-5555-4555-8555-555555555555','fix-code','a1111111-1111-4111-8111-111111111111')->>'message'),'Already linked','deleted invite + known coach is idempotent');
SELECT throws_ok($$SELECT coach_accept_invite('a5555555-5555-4555-8555-555555555555','fix-code',NULL)$$,'22023',NULL,'deleted invite without coach id rejected');
RESET ROLE;

-- 11. A device token is re-bound to the user who registers it.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"a4444444-4444-4444-8444-444444444444","role":"authenticated"}',true);
SELECT register_push_token('device-token-1','ios');
SELECT set_config('request.jwt.claims','{"sub":"a5555555-5555-4555-8555-555555555555","role":"authenticated"}',true);
SELECT lives_ok($$SELECT register_push_token('device-token-1','ios')$$,'new user registers shared device');
RESET ROLE;
SELECT is((SELECT array_agg(user_id::text) FROM push_tokens WHERE token='device-token-1'),ARRAY['a5555555-5555-4555-8555-555555555555'],'token moved to current user only');

-- 6. Anonymous requests get empty results, not permission errors.
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
SELECT is((SELECT count(*)::int FROM profiles),0,'anon profile read is empty, not an error');
SELECT is((SELECT count(*)::int FROM strategic_reports),0,'anon report read is empty, not an error');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
