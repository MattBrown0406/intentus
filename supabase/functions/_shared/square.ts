export type SquareConfig = { token: string; base: string; merchant: string; location: string; variation: string };
export function squareConfig(env: (key: string) => string | undefined): SquareConfig {
  const token = env('SQUARE_ACCESS_TOKEN'), merchant = env('SQUARE_MERCHANT_ID'), location = env('SQUARE_LOCATION_ID'), variation = env('SQUARE_COACH_MONTHLY_VARIATION_ID');
  const environment = env('SQUARE_ENVIRONMENT');
  if (!token || !merchant || !location || !variation || !['production','sandbox'].includes(environment ?? '')) throw new Error('Square configuration unavailable');
  return { token, merchant, location, variation, base: environment === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com' };
}
export async function squareRequest(c: SquareConfig, path: string, body?: unknown) {
  const response = await fetch(c.base + '/v2' + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${c.token}`, 'Square-Version': '2026-08-19', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Square request failed (${response.status})`);
  return response.json();
}
export function validCatalog(c: SquareConfig, object: any, location: any): boolean {
  const phases = object?.subscription_plan_variation_data?.phases;
  return location?.id === c.location && location.merchant_id === c.merchant && location.status === 'ACTIVE' && location.currency === 'USD' && object?.id === c.variation && object.type === 'SUBSCRIPTION_PLAN_VARIATION' && !object.is_deleted && (object.present_at_all_locations === true || object.present_at_location_ids?.includes(c.location)) && !object.absent_at_location_ids?.includes(c.location) && phases?.length === 1 && phases[0].cadence === 'MONTHLY' && phases[0].periods == null && phases[0].pricing?.type === 'STATIC' && moneyMatches(phases[0].pricing.price_money);
}
export function moneyMatches(m: any): boolean { return m?.amount === 29999 && m?.currency === 'USD'; }
export function recurringCheckout(c: SquareConfig, id: string) {
  return { idempotency_key: id, quick_pay: { name: 'Intentus Coach monthly', price_money: { amount: 29999, currency: 'USD' }, location_id: c.location }, checkout_options: { subscription_plan_id: c.variation, allow_tipping: false }, description: '$299.99 USD each month until canceled' };
}
export function paidSubscription(c: SquareConfig, subscription: any, invoice: any, order: any, payment: any): boolean {
  return subscription?.plan_variation_id === c.variation && subscription.location_id === c.location && subscription.status === 'ACTIVE' && (!subscription.price_override_money || moneyMatches(subscription.price_override_money)) && invoice?.subscription_id === subscription.id && subscription.invoice_ids?.[0] === invoice.id && invoice.status === 'PAID' && invoice.order_id === order?.id && order.location_id === c.location && payment?.order_id === order.id && payment.location_id === c.location && payment.status === 'COMPLETED' && moneyMatches(payment.amount_money) && !(payment.refunded_money?.amount > 0) && moneyMatches(order.total_money) && payment.customer_id === subscription.customer_id;
}

/** Stops future Square billing for each bound subscription before account deletion.
 * Already canceled/deactivated or cancel-scheduled subscriptions are left as-is.
 * Any lookup/cancel failure throws so the caller can abort deletion (retryable). */
export async function cancelSquareSubscriptions(ids: string[], request: (path: string, body?: unknown) => Promise<any>): Promise<void> {
  for (const id of ids) {
    const sub = (await request(`/subscriptions/${encodeURIComponent(id)}`))?.subscription;
    if (!sub || sub.id !== id) throw new Error('Square subscription lookup failed');
    if (sub.status === 'CANCELED' || sub.status === 'DEACTIVATED' || sub.canceled_date) continue;
    const result = await request(`/subscriptions/${encodeURIComponent(id)}/cancel`, {});
    if (result?.subscription?.id !== id) throw new Error('Square subscription cancel not acknowledged');
  }
}
