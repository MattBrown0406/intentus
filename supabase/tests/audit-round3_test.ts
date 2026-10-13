import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { rcTransferArgs } from "../functions/_shared/rc-events.ts";
import { createHandler } from "../functions/revenuecat-webhook/index.ts";
import {
  checkoutBindingId, recurringCheckout, resolveCheckoutLink, SQUARE_CHECKOUT_REDIRECT_URL, type SquareConfig,
} from "../functions/_shared/square.ts";
import {
  editedPlanPhases, isUsableLongitudinalResult, isUsablePlanRefresh, isUsableStrategicReport, parseToolArguments,
} from "../functions/_shared/ai-guardrails.ts";

const transfer = {
  id: "CD489E0E-5D52-4E03-966B-A7F17788E432", type: "TRANSFER", app_id: "app-test", store: "APP_STORE",
  environment: "PRODUCTION", event_timestamp_ms: Date.now() - 1000,
  transferred_from: ["11111111-1111-4111-8111-111111111111"], transferred_to: ["22222222-2222-4222-8222-222222222222"],
};

Deno.test("RevenueCat TRANSFER (no app_user_id/product_id) is routed to rc_apply_transfer", async () => {
  const seen: { rpc?: string; args?: Record<string, unknown> } = {};
  const h = createHandler({ env: () => "secret", apply: (args, rpc) => { seen.rpc = rpc; seen.args = args; return Promise.resolve({ data: "applied", error: null }); } });
  const res = await h(new Request("http://local", { method: "POST", headers: { Authorization: "Bearer secret" }, body: JSON.stringify({ event: transfer }) }));
  assertEquals(res.status, 200);
  assertEquals(seen.rpc, "rc_apply_transfer");
  assertEquals(seen.args?.p_from, transfer.transferred_from);
  assertEquals(seen.args?.p_to, transfer.transferred_to);
  assertEquals(seen.args?.p_store, "APP_STORE");
  // Optional store/environment become null, never invented.
  const bare = rcTransferArgs({ ...transfer, store: undefined, environment: undefined });
  assertEquals([bare.p_store, bare.p_environment], [null, null]);
  for (const bad of [{ transferred_to: "x" }, { transferred_from: [1] }, { environment: "DEV" }, { event_timestamp_ms: Date.now() + 900000 }, { app_id: "" }]) {
    assertThrows(() => rcTransferArgs({ ...transfer, ...bad }));
  }
});

const config: SquareConfig = { token: "t", base: "https://square.test", merchant: "M", location: "L", variation: "V" };

Deno.test("Square checkout returns the buyer to the web subscribe page", () => {
  const body = recurringCheckout(config, "binding") as { idempotency_key: string; checkout_options: { redirect_url: string } };
  assertEquals(body.checkout_options.redirect_url, "https://intentusai.com/subscribe?payment=success");
  assertEquals(SQUARE_CHECKOUT_REDIRECT_URL, body.checkout_options.redirect_url);
  assertEquals(body.idempotency_key, "binding");
});

Deno.test("binding id generation 0 is the original per-user id; later generations differ", async () => {
  const legacy = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("M:L:V:user"))))
    .map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 40);
  assertEquals(await checkoutBindingId(config, "user", 0), legacy);
  assert((await checkoutBindingId(config, "user", 1)) !== legacy);
});

function squareFake(order: Record<string, unknown>, paidAfterDelete = false) {
  const calls: string[] = [];
  let deleted = false;
  const request = (path: string, body?: unknown, method?: string) => {
    calls.push(`${method ?? (body ? "POST" : "GET")} ${path}`);
    if (method === "DELETE") { deleted = true; return Promise.resolve({}); }
    if (path.startsWith("/orders/")) return Promise.resolve({ order: deleted && paidAfterDelete ? { ...order, tenders: [{}] } : order });
    const key = (body as { idempotency_key: string }).idempotency_key;
    return Promise.resolve({ payment_link: { id: `link-${key}`, order_id: `order-${key}`, url: `https://square.link/${key}` } });
  };
  const saved: Record<string, unknown>[] = [];
  return { calls, saved, request, save: (u: Record<string, unknown>) => { saved.push(u); return Promise.resolve(); } };
}

Deno.test("checkout links: new, current, legacy-unpaid (regenerated) and legacy-paid (kept)", async () => {
  const fresh = squareFake({});
  assertEquals(await resolveCheckoutLink(config, { id: "b", order_id: null, checkout_url: null, payment_link_id: null }, fresh.request, fresh.save), { url: "https://square.link/b" });
  assertEquals(fresh.saved[0].redirect_url, SQUARE_CHECKOUT_REDIRECT_URL);

  const current = squareFake({});
  assertEquals(await resolveCheckoutLink(config, { id: "b", order_id: "o", checkout_url: "https://square.link/old", payment_link_id: "l", redirect_url: SQUARE_CHECKOUT_REDIRECT_URL }, current.request, current.save), { url: "https://square.link/old" });
  assertEquals(current.calls, []);

  const legacy = { id: "b", order_id: "o", checkout_url: "https://square.link/old", payment_link_id: "l", redirect_url: null };
  const unpaid = squareFake({ id: "o", state: "OPEN" });
  assertEquals(await resolveCheckoutLink(config, legacy, unpaid.request, unpaid.save), { url: "https://square.link/b:redirect-v1" });
  assertEquals(unpaid.calls, ["GET /orders/o", "DELETE /online-checkout/payment-links/l", "GET /orders/o", "POST /online-checkout/payment-links"]);
  assertEquals(unpaid.saved[0].order_id, "order-b:redirect-v1");

  const paid = squareFake({ id: "o", state: "OPEN", tenders: [{ payment_id: "p" }] });
  assertEquals(await resolveCheckoutLink(config, legacy, paid.request, paid.save), { pending: true });
  assertEquals(paid.calls, ["GET /orders/o"]);
  assertEquals(paid.saved, []);

  const race = squareFake({ id: "o", state: "OPEN" }, true);
  assertEquals(await resolveCheckoutLink(config, legacy, race.request, race.save), { pending: true });
  assertEquals(race.saved, []);
});

Deno.test("AI tool output: non-objects rejected, empty shells never persisted", () => {
  for (const bad of ["[]", "null", "\"text\"", "3"]) assertThrows(() => parseToolArguments(bad));
  assertEquals(parseToolArguments('{"a":1}'), { a: 1 });
  const plan = { phase_1: { actions: ["a"] }, phase_2: { actions: ["b"] }, phase_3: { actions: ["c"] } };
  assertEquals(isUsableStrategicReport({ forced_choice: "x", north_star_focus: "y", ninety_day_plan: plan }), true);
  assertEquals(isUsableStrategicReport({ forced_choice: "", north_star_focus: "y", ninety_day_plan: plan }), false);
  assertEquals(isUsableStrategicReport({ forced_choice: "x", north_star_focus: "y", ninety_day_plan: { ...plan, phase_3: { actions: [] } } }), false);
  assertEquals(isUsablePlanRefresh([{ actions: ["a"] }, { actions: ["b"] }, { actions: [] }]), false);
  assertEquals(isUsablePlanRefresh([{ actions: ["a"] }, { actions: ["b"] }, { actions: ["c"] }]), true);
  assertEquals(isUsableLongitudinalResult({ executive_summary: "", recommended_focus: "x" }), false);
});

Deno.test("coaching context uses the edited/refreshed plan shapes", () => {
  const phases = editedPlanPhases([{ phase_label: "Days 1-30", title: "Edited", actions: ["new action", 5] }, null, { title: "Three", actions: [] }]);
  assertEquals(phases?.[0], { phase: 1, title: "Edited", days: "Days 1-30", actions: ["new action"] });
  assertEquals(phases?.length, 2);
  assertEquals(editedPlanPhases({ phases: [{ title: "Legacy", actions: ["a"] }] })?.[0].title, "Legacy");
  assertEquals(editedPlanPhases(null), null);
  assertEquals(editedPlanPhases([]), null);
});
