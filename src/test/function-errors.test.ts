import { describe, expect, it } from "vitest";
import { functionErrorMessage } from "@/lib/function-errors";

describe("functionErrorMessage", () => {
  it("surfaces the Edge Function's own error message", async () => {
    const error = { message: "Edge Function returned a non-2xx status code", context: { json: async () => ({ error: "Your payment is being verified." }) } };
    expect(await functionErrorMessage(error, "fallback")).toBe("Your payment is being verified.");
  });
  it("falls back when the body is missing or not JSON", async () => {
    expect(await functionErrorMessage(new Error("x"), "fallback")).toBe("fallback");
    expect(await functionErrorMessage({ context: { json: async () => { throw new SyntaxError(); } } }, "fallback")).toBe("fallback");
  });
});
