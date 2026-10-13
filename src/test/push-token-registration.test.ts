import { beforeEach, describe, expect, it, vi } from "vitest";
const { rpc, upsert, from } = vi.hoisted(() => {
  const upsert = vi.fn();
  return { rpc: vi.fn(), upsert, from: vi.fn(() => ({ upsert })) };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, from } }));
vi.mock("@/contexts/AuthContext", () => ({ bounded: (p: unknown) => p, useAuth: () => ({}), registerSignOutCleanup: () => () => undefined }));
import { registerPushToken } from "@/hooks/usePushNotifications";

describe("push token registration", () => {
  beforeEach(() => { rpc.mockReset(); upsert.mockReset(); from.mockClear(); });
  it("uses the RPC that unbinds the token from other accounts", async () => {
    rpc.mockResolvedValue({ error: null });
    expect((await registerPushToken("u1", "tok", "ios")).error).toBeNull();
    expect(rpc).toHaveBeenCalledWith("register_push_token", { p_token: "tok", p_platform: "ios" });
    expect(from).not.toHaveBeenCalled();
  });
  it("falls back to the owner upsert only when the RPC is not deployed yet", async () => {
    rpc.mockResolvedValue({ error: { code: "PGRST202", message: "not found" } });
    upsert.mockResolvedValue({ error: null });
    expect((await registerPushToken("u1", "tok", "ios")).error).toBeNull();
    expect(upsert).toHaveBeenCalledWith({ user_id: "u1", token: "tok", platform: "ios" }, { onConflict: "user_id,token" });
  });
  it("surfaces other RPC errors without a fallback write", async () => {
    rpc.mockResolvedValue({ error: { code: "22023", message: "bad token" } });
    expect((await registerPushToken("u1", "", "ios")).error?.message).toBe("bad token");
    expect(upsert).not.toHaveBeenCalled();
  });
});
