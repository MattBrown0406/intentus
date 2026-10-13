import { assertEquals, assertRejects } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { canUseAiChat, canUseAiDebrief, normalizePlanTier } from "../functions/_shared/tier-policy.ts";
import { inviteTier, timingSafeEqualString } from "../functions/_shared/payment-security.ts";
import { boundedTail } from "../functions/_shared/ai-guardrails.ts";
import { cancelSquareSubscriptions } from "../functions/_shared/square.ts";
import { createHandler } from "../functions/revenuecat-webhook/index.ts";

Deno.test("database Executive tier (exec) keeps paid AI access at the edge", () => {
  assertEquals(normalizePlanTier("exec"), "pro");
  assertEquals(normalizePlanTier("pro"), "pro");
  assertEquals(canUseAiChat(normalizePlanTier("exec")), true);
  assertEquals(canUseAiDebrief(normalizePlanTier("exec")), true);
  assertEquals(normalizePlanTier("admin"), "free");
  assertEquals(normalizePlanTier(null), "free");
});

Deno.test("admin/coach invites accept the Executive tier the UI sends, never Coach", () => {
  assertEquals(inviteTier("exec"), "exec");
  assertEquals(inviteTier("pro"), "exec");
  assertEquals(inviteTier("premium"), "premium");
  assertEquals(inviteTier("coach"), null);
});

Deno.test("chat history bound keeps the newest turns", () => {
  const history = Array.from({ length: 30 }, (_, i) => ({ role: "user", content: `m${i}` }));
  const kept = boundedTail<{ content: string }>(history, 16);
  assertEquals(kept.length, 16);
  assertEquals(kept[15].content, "m29");
  assertEquals(kept[0].content, "m14");
  assertEquals(boundedTail("nope", 16), []);
});

Deno.test("constant-time secret compare", async () => {
  assertEquals(timingSafeEqualString("Bearer abc", "Bearer abc"), true);
  assertEquals(timingSafeEqualString("Bearer abd", "Bearer abc"), false);
  assertEquals(timingSafeEqualString("Bearer ab", "Bearer abc"), false);
  assertEquals(timingSafeEqualString("", "Bearer abc"), false);
  const h = createHandler({ env: () => "secret", apply: () => { throw new Error("must not call"); } });
  const req = (auth: string) => new Request("http://local", { method: "POST", headers: { Authorization: auth }, body: "{}" });
  assertEquals((await h(req("Bearer secretX"))).status, 401);
  assertEquals((await h(req("Bearer secre"))).status, 401);
});

Deno.test("account deletion stops Square renewals and fails closed", async () => {
  const calls: string[] = [];
  const subs: Record<string, Record<string, unknown>> = {
    active: { id: "active", status: "ACTIVE" },
    scheduled: { id: "scheduled", status: "ACTIVE", canceled_date: "2026-11-01" },
    done: { id: "done", status: "CANCELED" },
  };
  const request = (path: string, body?: unknown) => {
    calls.push(`${body ? "POST" : "GET"} ${path}`);
    const id = path.split("/")[2];
    return Promise.resolve({ subscription: subs[id] });
  };
  await cancelSquareSubscriptions(["active", "scheduled", "done"], request);
  assertEquals(calls.filter((c) => c.startsWith("POST")), ["POST /subscriptions/active/cancel"]);
  await assertRejects(() => cancelSquareSubscriptions(["missing"], request));
  await assertRejects(() => cancelSquareSubscriptions(["active"], () => Promise.reject(new Error("Square request failed (500)"))));
});
