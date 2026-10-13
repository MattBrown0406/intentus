begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(24);
insert into auth.users(id,email) values
 ('a1111111-1111-4111-8111-111111111111','r3-a@example.invalid'),
 ('b2222222-2222-4222-8222-222222222222','r3-b@example.invalid'),
 ('c3333333-3333-4333-8333-333333333333','r3-c@example.invalid');
insert into public.profiles(user_id,plan_tier) values
 ('a1111111-1111-4111-8111-111111111111','free'),('b2222222-2222-4222-8222-222222222222','free'),('c3333333-3333-4333-8333-333333333333','free')
 on conflict(user_id) do update set plan_tier='free';
insert into public.rc_product_config values ('r3-app','APP_STORE','PRODUCTION','intentus_premium_monthly',true);
select ok(not has_function_privilege('authenticated','public.rc_apply_transfer(text,text,text,text,timestamptz,text[],text[])','EXECUTE'),'clients cannot apply transfers');
set local role service_role;
-- Refund: CANCELLATION with expiration moved back to the refund time revokes.
select is(public.rc_apply_event('r3-buy','a1111111-1111-4111-8111-111111111111','r3-app','APP_STORE','PRODUCTION','intentus_premium_monthly','INITIAL_PURCHASE',now()-interval '3 minutes',now()+interval '30 days'),'applied','purchase');
select is(public.rc_apply_event('r3-unsub','a1111111-1111-4111-8111-111111111111','r3-app','APP_STORE','PRODUCTION','intentus_premium_monthly','CANCELLATION',now()-interval '2 minutes',now()+interval '30 days'),'ignored','unsubscribe keeps access to period end');
select is((select plan_tier::text from public.profiles where user_id='a1111111-1111-4111-8111-111111111111'),'premium','still premium after unsubscribe');
select is(public.rc_apply_event('r3-old-refund','a1111111-1111-4111-8111-111111111111','r3-app','APP_STORE','PRODUCTION','intentus_premium_monthly','CANCELLATION',now()-interval '4 minutes',now()-interval '4 minutes'),'ignored','cancellation older than the grant is ignored');
select is((select plan_tier::text from public.profiles where user_id='a1111111-1111-4111-8111-111111111111'),'premium','older cancellation does not revoke');
select is(public.rc_apply_event('r3-refund','a1111111-1111-4111-8111-111111111111','r3-app','APP_STORE','PRODUCTION','intentus_premium_monthly','CANCELLATION',now()-interval '1 minute',now()-interval '1 minute'),'applied','refund applied');
select is((select plan_tier::text from public.profiles where user_id='a1111111-1111-4111-8111-111111111111'),'free','refund revokes immediately');
select is(public.rc_apply_event('r3-exp','a1111111-1111-4111-8111-111111111111','r3-app','APP_STORE','PRODUCTION','intentus_premium_monthly','EXPIRATION',now(),now()-interval '1 minute'),'applied','a later EXPIRATION for the refund still applies');
select is(public.rc_apply_event('r3-renew','a1111111-1111-4111-8111-111111111111','r3-app','APP_STORE','PRODUCTION','intentus_premium_monthly','RENEWAL',now(),now()+interval '30 days'),'stale','renewal not newer than the expiration is stale');
-- Transfer A -> B moves the live source; B is premium, A is free.
select is(public.rc_apply_event('r3-buy-b','c3333333-3333-4333-8333-333333333333','r3-app','APP_STORE','PRODUCTION','intentus_premium_monthly','INITIAL_PURCHASE',now()-interval '3 minutes',now()+interval '30 days'),'applied','C purchases');
select is(public.rc_apply_transfer('r3-xfer','r3-app','APP_STORE','PRODUCTION',now()-interval '1 minute',array['c3333333-3333-4333-8333-333333333333','$RCAnonymousID:abc'],array['b2222222-2222-4222-8222-222222222222']),'applied','transfer applied');
select is((select plan_tier::text from public.profiles where user_id='b2222222-2222-4222-8222-222222222222'),'premium','transfer target gains the subscription');
select is((select plan_tier::text from public.profiles where user_id='c3333333-3333-4333-8333-333333333333'),'free','transfer source loses it');
select is(public.rc_apply_transfer('r3-xfer','r3-app','APP_STORE','PRODUCTION',now()-interval '1 minute',array['c3333333-3333-4333-8333-333333333333','$RCAnonymousID:abc'],array['b2222222-2222-4222-8222-222222222222']),'duplicate','transfer retry idempotent');
-- Anonymous-only destination (signed-out device): RC aliases it with the next sign-in, so the payer keeps access.
select is(public.rc_apply_transfer('r3-xfer-anon','r3-app','APP_STORE','PRODUCTION',now(),array['b2222222-2222-4222-8222-222222222222'],array['$RCAnonymousID:def']),'ignored','anonymous-only transfer revokes nothing');
select is((select plan_tier::text from public.profiles where user_id='b2222222-2222-4222-8222-222222222222'),'premium','payer keeps access after anonymous transfer');
select is((select active from public.rc_entitlement_sources where user_id='b2222222-2222-4222-8222-222222222222' and product_id='intentus_premium_monthly'),true,'source untouched by anonymous transfer');
select throws_ok($$select public.rc_apply_transfer('r3-buy','r3-app','APP_STORE','PRODUCTION',now(),array[]::text[],array[]::text[])$$,'22023','event ID collision','transfer id cannot reuse a lifecycle event id');
select is(public.rc_apply_transfer('r3-xfer-x','other-app',null,null,now(),array[]::text[],array[]::text[]),'unconfigured','unconfigured app denied');
-- Square: a second binding per user is allowed once the first is bound; two pending are not.
insert into public.square_checkouts(id,user_id,merchant_id,location_id,variation_id,order_id,subscription_id) values ('r3-gen0','a1111111-1111-4111-8111-111111111111','M','L','V','o0','s0');
insert into public.square_checkouts(id,user_id,merchant_id,location_id,variation_id,order_id,redirect_url) values ('r3-gen1','a1111111-1111-4111-8111-111111111111','M','L','V','o1','https://intentusai.com/subscribe?payment=success');
select is((select count(*)::int from public.square_checkouts where user_id='a1111111-1111-4111-8111-111111111111'),2,'resubscribe binding allowed');
select throws_ok($$insert into public.square_checkouts(id,user_id,merchant_id,location_id,variation_id) values ('r3-gen1b','a1111111-1111-4111-8111-111111111111','M','L','V')$$,'23505',null,'only one pending checkout');
select is(public.square_apply_state('r3-gen1','s1','r3-sq',now()-interval '1 minute',true,now()+interval '30 days'),'applied','new subscription fulfils');
reset role;
delete from auth.users where id='c3333333-3333-4333-8333-333333333333';
select is((select count(*)::int from public.rc_transfer_events where event_id='r3-xfer'),0,'account deletion purges transfer records naming the user');
select * from finish();
rollback;
