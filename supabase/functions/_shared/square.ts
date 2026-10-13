export type SquareConfig = { token: string; base: string; merchant: string; location: string; variation: string };
export function squareConfig(env: (key: string) => string | undefined): SquareConfig {
  const token = env('SQUARE_ACCESS_TOKEN'), merchant = env('SQUARE_MERCHANT_ID'), location = env('SQUARE_LOCATION_ID'), variation = env('SQUARE_COACH_MONTHLY_VARIATION_ID');
  const environment = env('SQUARE_ENVIRONMENT');
  if (!token || !merchant || !location || !variation || !['production','sandbox'].includes(environment ?? '')) throw new Error('Square configuration unavailable');
  return { token, merchant, location, variation, base: environment === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com' };
}
export async function squareRequest(c: SquareConfig, path: string, body?: unknown, method?: 'DELETE') {
  const response = await fetch(c.base + '/v2' + path, { method: method ?? (body ? 'POST' : 'GET'), headers: { Authorization: `Bearer ${c.token}`, 'Square-Version': '2026-08-19', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Square request failed (${response.status})`);
  return response.json();
}
export function validCatalog(c: SquareConfig, object: any, location: any): boolean {
  const phases = object?.subscription_plan_variation_data?.phases;
  return location?.id === c.location && location.merchant_id === c.merchant && location.status === 'ACTIVE' && location.currency === 'USD' && object?.id === c.variation && object.type === 'SUBSCRIPTION_PLAN_VARIATION' && !object.is_deleted && (object.present_at_all_locations === true || object.present_at_location_ids?.includes(c.location)) && !object.absent_at_location_ids?.includes(c.location) && phases?.length === 1 && phases[0].cadence === 'MONTHLY' && phases[0].periods == null && phases[0].pricing?.type === 'STATIC' && moneyMatches(phases[0].pricing.price_money);
}
export function moneyMatches(m: any): boolean { return m?.amount === 29999 && m?.currency === 'USD'; }
// Production web origin (src/lib/site.ts SITE_URL, same as invite-user). Square
// sends the buyer here after payment; Subscribe.tsx then polls for the verified tier.
export const SQUARE_CHECKOUT_REDIRECT_URL = 'https://intentusai.com/subscribe?payment=success';
export function recurringCheckout(c: SquareConfig, id: string, idempotencyKey: string = id) {
  return { idempotency_key: idempotencyKey, quick_pay: { name: 'Intentus Coach monthly', price_money: { amount: 29999, currency: 'USD' }, location_id: c.location }, checkout_options: { subscription_plan_id: c.variation, allow_tipping: false, redirect_url: SQUARE_CHECKOUT_REDIRECT_URL }, description: '$299.99 USD each month until canceled' };
}

/** Binding id: generation 0 keeps the original per-user id; each subscription
 * that has ended adds a generation so a lapsed coach can subscribe again. */
export async function checkoutBindingId(c: Pick<SquareConfig, 'merchant' | 'location' | 'variation'>, userId: string, generation: number): Promise<string> {
  const key = `${c.merchant}:${c.location}:${c.variation}:${userId}` + (generation > 0 ? `:${generation}` : '');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

export const ENDED_SUBSCRIPTION_STATUSES = new Set(['CANCELED', 'DEACTIVATED']);

type SquareCall = (path: string, body?: unknown, method?: 'DELETE') => Promise<any>;
type CheckoutBinding = { id: string; order_id: string | null; checkout_url: string | null; payment_link_id: string | null; redirect_url?: string | null };
type LinkUpdate = { order_id: string; checkout_url: string; payment_link_id: string; redirect_url: string };

/** Returns the buyer-facing checkout URL for an unbound checkout. Links created
 * before redirect_url existed never send the buyer back, so an UNPAID one is
 * deleted at Square and replaced; a link whose order already has a payment (or
 * is COMPLETED) is kept, because the webhook binds that payment by its
 * order_id and replacing the order would orphan it. */
export async function resolveCheckoutLink(c: SquareConfig, binding: CheckoutBinding, request: SquareCall, save: (update: LinkUpdate) => Promise<void>): Promise<{ url: string } | { pending: true }> {
  const create = async (idempotencyKey: string) => {
    const link = (await request('/online-checkout/payment-links', recurringCheckout(c, binding.id, idempotencyKey)))?.payment_link;
    if (!link?.order_id || !link?.url || !link?.id || new URL(link.url).protocol !== 'https:') throw new Error('Invalid Square payment link');
    await save({ order_id: link.order_id, checkout_url: link.url, payment_link_id: link.id, redirect_url: SQUARE_CHECKOUT_REDIRECT_URL });
    return { url: link.url as string };
  };
  if (!binding.checkout_url || !binding.order_id) return await create(binding.id);
  if (binding.redirect_url === SQUARE_CHECKOUT_REDIRECT_URL) return { url: binding.checkout_url };
  const orderPaid = async () => {
    const order = (await request(`/orders/${encodeURIComponent(binding.order_id!)}`))?.order;
    if (!order || order.id !== binding.order_id) throw new Error('Square order lookup failed');
    return order.state === 'COMPLETED' || (order.tenders?.length ?? 0) > 0;
  };
  if (await orderPaid()) return { pending: true };
  if (!binding.payment_link_id) throw new Error('Legacy checkout link id missing');
  // 404 = already deleted (a concurrent call, or an earlier attempt that failed
  // before saving the replacement); treating it as fatal would block checkout forever.
  await request(`/online-checkout/payment-links/${encodeURIComponent(binding.payment_link_id)}`, undefined, 'DELETE')
    .catch((error) => { if (!/\(404\)/.test(String(error?.message))) throw error; });
  // A payment that landed between the check and the delete keeps its order.
  if (await orderPaid()) return { pending: true };
  return await create(`${binding.id}:redirect-v1`);
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
