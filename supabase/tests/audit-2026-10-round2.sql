-- Round-2 regression tests for supabase/migrations/20261012120000_audit_fixes.sql
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(10);
INSERT INTO auth.users(id,email) VALUES
('b1111111-1111-4111-8111-111111111111','r2-coach-a@example.invalid'),
('b2222222-2222-4222-8222-222222222222','r2-coach-b@example.invalid'),
('b3333333-3333-4333-8333-333333333333','r2-client-1@example.invalid'),
('b4444444-4444-4444-8444-444444444444','r2-client-2@example.invalid'),
('b5555555-5555-4555-8555-555555555555','r2-stranger@example.invalid');

SET LOCAL ROLE service_role;
INSERT INTO rc_entitlement_sources(user_id,source,product_id,tier,expires_at,active) VALUES
 ('b1111111-1111-4111-8111-111111111111','square:m:a','plan','coach',now()+interval '1 day',true),
 ('b2222222-2222-4222-8222-222222222222','square:m:b','plan','coach',now()+interval '1 day',true);
SELECT recompute_user_plan('b1111111-1111-4111-8111-111111111111');
SELECT recompute_user_plan('b2222222-2222-4222-8222-222222222222');

-- Branded (code-less) joins need the coach's public branded page.
SELECT throws_ok($$SELECT coach_accept_invite('b5555555-5555-4555-8555-555555555555','__branded__','b1111111-1111-4111-8111-111111111111')$$,
 '22023',NULL,'branded join to a coach without a branded page is rejected');
SELECT throws_ok($$SELECT coach_accept_invite('b5555555-5555-4555-8555-555555555555',NULL,'b1111111-1111-4111-8111-111111111111')$$,
 '22023',NULL,'code-less join (NULL invite) is rejected the same way');
INSERT INTO coach_branding(coach_user_id,slug) VALUES ('b1111111-1111-4111-8111-111111111111','r2-coach-a');
SELECT lives_ok($$SELECT coach_accept_invite('b3333333-3333-4333-8333-333333333333','__branded__','b1111111-1111-4111-8111-111111111111')$$,
 'branded join works once the coach has a branded page');
SELECT lives_ok($$SELECT coach_accept_invite('b4444444-4444-4444-8444-444444444444','__branded__','b1111111-1111-4111-8111-111111111111')$$,
 'second branded client');

-- Mutual coaches: a coach-status flip cascade terminates and is correct.
INSERT INTO coach_branding(coach_user_id,slug) VALUES ('b2222222-2222-4222-8222-222222222222','r2-coach-b');
SELECT coach_accept_invite('b2222222-2222-4222-8222-222222222222','__branded__','b1111111-1111-4111-8111-111111111111');
SELECT coach_accept_invite('b1111111-1111-4111-8111-111111111111','__branded__','b2222222-2222-4222-8222-222222222222');
UPDATE rc_entitlement_sources SET active=false WHERE user_id='b1111111-1111-4111-8111-111111111111';
SELECT is(recompute_user_plan('b1111111-1111-4111-8111-111111111111')::text,'free','mutual-coach cascade terminates');
SELECT is((SELECT plan_tier::text FROM profiles WHERE user_id='b2222222-2222-4222-8222-222222222222'),'coach','other coach keeps own paid tier');
UPDATE rc_entitlement_sources SET active=true WHERE user_id='b1111111-1111-4111-8111-111111111111';
SELECT recompute_user_plan('b1111111-1111-4111-8111-111111111111');

-- Reports: a coach may edit a client's plan but never re-point it at another client.
INSERT INTO baseline_audits(id,user_id,status) VALUES ('b3000000-0000-4000-8000-000000000001','b3333333-3333-4333-8333-333333333333','completed');
INSERT INTO strategic_reports(id,user_id,audit_id,north_star_focus) VALUES
 ('b3000000-0000-4000-8000-0000000000a1','b3333333-3333-4333-8333-333333333333','b3000000-0000-4000-8000-000000000001','focus-1');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"b1111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
SELECT lives_ok($$UPDATE strategic_reports SET north_star_focus='focus-2' WHERE id='b3000000-0000-4000-8000-0000000000a1'$$,
 'coach edits client plan');
SELECT throws_ok($$UPDATE strategic_reports SET user_id='b4444444-4444-4444-8444-444444444444', audit_id=NULL WHERE id='b3000000-0000-4000-8000-0000000000a1'$$,
 '42501',NULL,'coach cannot move a client report to another client');
RESET ROLE;
SELECT is((SELECT user_id::text FROM strategic_reports WHERE id='b3000000-0000-4000-8000-0000000000a1'),'b3333333-3333-4333-8333-333333333333','report owner unchanged');
SELECT is((SELECT north_star_focus FROM strategic_reports WHERE id='b3000000-0000-4000-8000-0000000000a1'),'focus-2','coach edit persisted');
SELECT * FROM finish();
ROLLBACK;
