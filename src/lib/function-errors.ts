// supabase-js reports non-2xx Edge Function replies as a generic "non-2xx status" error;
// the actionable message (e.g. "payment is being verified") is in the response body.
export async function functionErrorMessage(error: unknown, fallback: string): Promise<string> {
  const context = (error as { context?: { json?: () => Promise<unknown> } })?.context;
  try {
    const body = await context?.json?.();
    const message = (body as { error?: unknown })?.error;
    if (typeof message === "string" && message.trim()) return message;
  } catch { /* not JSON */ }
  return fallback;
}
