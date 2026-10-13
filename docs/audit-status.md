# Intentus repair audit — local checkpoint, NOT a production release

## Implemented
- Repaired npm clean-install lockfile and upgraded vulnerable dependencies.
- Auth restoration/account-switch fencing; safe continuation URLs; native cold-link recovery and listener cleanup; push-token cleanup before sign-out; visible logout failure.
- Removed client-authoritative subscription grants; fenced native billing identity; separate Android configuration; pending verification messages.
- Audits/reports/coaching/goals: checked persistence results, serialized writes, retained failed drafts, stable history retries, local-calendar handling and consecutive-week calculations.
- Atomic database check-in/re-audit and coach invitation workflows; ownership/tier enforcement, RLS hardening and source-aware entitlement aggregation.
- Auth/public-data deletion transaction and checked, bounded coach-assets cleanup before Auth deletion. Storage cleanup itself cannot roll back.
- Bounded AI request bodies/deadlines and DNS-pinned brand extraction.
- Mobile demo overflow and landing menu accessibility; guarded lazy-route recovery when browser storage throws.

## Verified locally
- Clean npm ci succeeds; npm audit reports zero known vulnerabilities at verification time.
- 56 frontend tests pass; TypeScript passes; production Vite build passes.
- ESLint exits zero, with 23 warnings (not a warning-free claim).
- Public/mobile browser smoke: 30 route/viewport visits, 95/95 assertions; zero uncaught page errors. External networking blocked; this is NOT an authenticated live-backend or device test.
- All Edge Function/shared-module Deno checks pass. Deno helper/handler tests executed with deterministic doubles, not real payment providers.
- SQL suites executed on dedicated local Supabase PostgreSQL, including real role/RLS/transaction tests for security, check-in/re-audit, RC, Square and deletion. See remaining runtime caveat below.

## Unresolved — do not deploy this branch as-is
1. Two original migration filenames share prefix `20260412`. Reconcile against authoritative production applied-history before renaming/removing anything. SQL-content replay is not original CLI reset acceptance.
2. Square refunds/disputes still return retryable 503; resubscription lifecycle and periodic expiration/provider reconciliation need completion and provider Sandbox tests. Required merchant/catalog/webhook mappings must be supplied. RC requires authoritative app/store/product/environment configuration and legacy-grant reconciliation. No real purchase lifecycle was certified.
3. Hosted Edge Runtime support for raw DNS-pinned TLS egress is unverified; extraction fails closed where unavailable.
4. Account deletion cleans coach-assets, but concurrent new uploads and other-bucket ownership require a durable deletion-pending workflow. Real GoTrue/Storage integration remains unverified.
5. Local all-SQL verification required current auth helper definitions from another isolated Intentus schema because interrupted CLI startup left outdated Auth helpers. Initial ownership-transfer migration failure was repaired with temporary, restored schema privileges. A direct authenticated call to a non-executable coach RPC crashed this local PostgreSQL runtime; the catalog correctly denies EXECUTE, but an expected permission-error runtime result was NOT verified. Investigate platform/runtime before claiming release acceptance. Catalog pgTAP checks do not replace this missing negative runtime gate.
6. Physical-device purchase/restore, push delivery, native recovery and authenticated browser workflows remain unverified. No production migrations, functions, app builds or deployments performed.

## Five product improvements — subsequently implemented

See `docs/product-improvements.md` for the implemented scope, verification and deployment prerequisites. The original recommendations were:
1. Interactive sample audit and report before signup: demonstrate the actual reasoning and next action rather than only listing features in review-demo.
2. A single prioritized next-action card connecting North Star goal, plan commitment and next check-in; reduce choosing between separate dashboards/tools.
3. A first-week guided path with transparent time estimates and resumable steps from audit to first completed action.
4. A progress story comparing prior audits and weekly follow-through, with understandable explanations of changes and one suggested adjustment—not just scores/streaks.
5. Clear coach collaboration controls: preview exactly what the coach sees, choose what to share, and make feedback/next-contact expectations explicit.

These recommendations are hypotheses to test, not guaranteed retention or conversion gains.

## October 2026 multi-round audit (4 rounds, pushed to main 2026-10-12) — HOLD deployment

Four audit rounds (frontend, auth/coach/native, Edge Functions, SQL/RLS; rounds 2–4 re-reviewed earlier fixes). Rounds 1–3 still found significant bugs; round 4 found 4 (2 were regressions from round 3) and both reviewers then reported no remaining significant bugs.

Highlights: Executive (`exec`) subscribers were treated as free by every AI function; coach dashboard RPCs were unbound (invite links/tier changes always failed); returning users were sent back through onboarding on every login; Report crashed after "Refresh Plan"; pattern intelligence always said "insufficient data"; purchases nearly always showed "awaiting verification"; RevenueCat refunds and TRANSFER events never revoked/moved access; Square coaches could never resubscribe and never returned to the app after checkout; account deletion left the Square subscription billing; free users could write to the public coach-assets bucket; users could delete audit history to dodge the re-audit cooldown; re-audit paywall was client-only; a coach could move one client's report to another client; push tokens leaked across accounts; native deep links replayed on every navigation.

Verified locally: tsc, ESLint (0 errors), 132 vitest tests, Vite build, `npm audit --omit=dev --audit-level=critical`, Deno check + 46 Deno tests, and a full local Postgres replay of all migrations with every SQL suite passing (including the new audit-2026-10-*.sql suites) and an idempotent double-apply of the new migration. Not verified: production database, real RevenueCat/Square/APNs traffic, physical devices.

### Deployment order (Lovable prompts only — no SQL editor)
1. Reconcile production migration history first (item 1 above; the two `20260412_*` files share version `20260412`).
2. Apply pending migrations in order, ending with `20261012120000_audit_fixes.sql` (requires the 20260905/06 migrations). Then regenerate `src/integrations/supabase/types.ts`.
3. Deploy Edge Functions only after step 2: `revenuecat-webhook` (calls `rc_apply_transfer`), `create-square-checkout` (`square_checkouts.redirect_url`, per-subscription bindings), `invite-user`/`process-coach-invite`/`delete-account` all depend on the new schema.
4. Then publish the frontend. It tolerates the new RPCs being absent (`register_push_token` falls back on PGRST202).
5. Native: run `npx cap sync ios` (CapApp-SPM Package.swift lacks CapacitorApp/CapacitorPushNotifications), add the Push Notifications capability (aps-environment entitlement), and add a `CFBundleURLTypes` entry for the `intentus` scheme. These were not edited here.

### Open product/ops follow-ups
- Legacy 'legacy' entitlement grants never expire (seeded by 20260905165846) — needs a reconciliation pass; past coach invites wrote permanent tiers.
- No scheduled recompute when an entitlement expires without a webhook (consider pg_cron).
- Square refunds/disputes still 503; failed Square renewal revokes immediately (no grace).
- Deactivated coaches' clients keep their coach-assigned tier.
- Clients cannot leave a coach (only the sharing switch); coach-written `ninety_day_plan` edits are hidden when the client has an edited plan.
- Settings "Manage subscription" always opens Apple — web (Square) coaches have no cancel path in-app.
