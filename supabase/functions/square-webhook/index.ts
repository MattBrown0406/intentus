import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { verifySquareSignature } from '../_shared/payment-security.ts';
import { squareConfig, squareRequest, paidSubscription, moneyMatches } from '../_shared/square.ts';
serve(async (req: Request) => {
  const reply = (status: number, outcome: string) => new Response(JSON.stringify({outcome}),{status,headers:{'Content-Type':'application/json'}});
  if (req.method !== 'POST') return reply(405,'method');
  try {
    const raw = await req.text();
    const key = Deno.env.get('SQUARE_INTENTUS_WEBHOOK_SIGNATURE_KEY');
    const url = Deno.env.get('SQUARE_WEBHOOK_NOTIFICATION_URL');
    if (!key || !url) return reply(503,'unconfigured');
    if (!await verifySquareSignature(key,url,raw,req.headers.get('x-square-hmacsha256-signature') ?? '')) return reply(401,'signature');
    const event = JSON.parse(raw), c = squareConfig(k=>Deno.env.get(k));
    if (event.merchant_id !== c.merchant) return reply(200,'unrelated merchant');
    if (!event.event_id || !Number.isFinite(Date.parse(event.created_at))) return reply(400,'invalid event');
    const admin = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    let sub: any, binding: any;
    const lookup = async (column: string,id: string) => {
      const {data,error} = await admin.from('square_checkouts').select('*').eq(column,id).maybeSingle();
      if (error) throw error;
      return data;
    };
    const object = event.data?.object;
    if (event.type === 'payment.created' || event.type === 'payment.updated') {
      const p = (await squareRequest(c,`/payments/${encodeURIComponent(object?.payment?.id)}`)).payment;
      if (!p?.order_id) return reply(200,'unrelated');
      binding = await lookup('order_id',p.order_id);
      if (!binding) return reply(200,'unrelated');
      if (binding.subscription_id) sub = (await squareRequest(c,`/subscriptions/${encodeURIComponent(binding.subscription_id)}`)).subscription;
      else {
        if (p.status !== 'COMPLETED' || p.location_id !== c.location || !moneyMatches(p.amount_money) || !p.customer_id || p.refunded_money?.amount > 0) return reply(200,'unpaid');
        const order = (await squareRequest(c,`/orders/${encodeURIComponent(p.order_id)}`)).order;
        if (order.customer_id !== p.customer_id || order.location_id !== c.location || !moneyMatches(order.total_money)) throw new Error('Order mismatch');
        const result = await squareRequest(c,'/subscriptions/search',{query:{filter:{customer_ids:[p.customer_id],location_ids:[c.location]}}});
        // Subscriptions from earlier (ended) checkouts of the same customer
        // predate this binding; only one created for this checkout may match.
        const notBefore = Date.parse(binding.created_at) - 60000;
        const candidates = (result.subscriptions ?? []).filter((s:any)=>s.plan_variation_id === c.variation && Date.parse(s.created_at) >= notBefore);
        // Never guess between subscriptions or accept incomplete pagination.
        if (result.cursor || candidates.length !== 1) return reply(503,'subscription binding unresolved');
        sub = candidates[0];
        if (Date.parse(sub.created_at) < Date.parse(binding.created_at) - 60000) throw new Error('Preexisting subscription');
      }
    } else if (event.type?.startsWith('subscription.')) {
      const id = object?.subscription?.id;
      if (!id) return reply(400,'missing subscription');
      binding = await lookup('subscription_id',id);
      if (!binding) return reply(503,'subscription binding pending');
      sub = (await squareRequest(c,`/subscriptions/${encodeURIComponent(id)}`)).subscription;
    } else if (event.type?.startsWith('invoice.')) {
      const invoice = (await squareRequest(c,`/invoices/${encodeURIComponent(object?.invoice?.id)}`)).invoice;
      if (!invoice?.subscription_id) return reply(200,'unrelated');
      binding = await lookup('subscription_id',invoice.subscription_id);
      if (!binding) return reply(503,'subscription binding pending');
      sub = (await squareRequest(c,`/subscriptions/${encodeURIComponent(invoice.subscription_id)}`)).subscription;
    } else if (event.type?.startsWith('refund.') || event.type?.startsWith('dispute.')) {
      // Never acknowledge financial reversals until their payment-to-subscription
      // reconciliation has been implemented and applied. Provider retries retain them.
      return reply(503,'financial reversal requires reconciliation');
    } else return reply(200,'ignored');
    if (!binding || binding.merchant_id !== c.merchant || binding.location_id !== c.location || binding.variation_id !== c.variation || sub?.plan_variation_id !== c.variation || sub.location_id !== c.location) throw new Error('Binding mismatch');
    let active = false;
    let expires: string | null = null;
    if (sub.invoice_ids?.length) {
      const invoice = (await squareRequest(c,`/invoices/${encodeURIComponent(sub.invoice_ids[0])}`)).invoice;
      const order = (await squareRequest(c,`/orders/${encodeURIComponent(invoice.order_id)}`)).order;
      const tenders = order?.tenders ?? [];
      if (tenders.length === 1 && tenders[0].payment_id) {
        const payment = (await squareRequest(c,`/payments/${encodeURIComponent(tenders[0].payment_id)}`)).payment;
        active = paidSubscription(c,sub,invoice,order,payment);
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(sub.charged_through_date ?? '')) expires = new Date(Date.parse(sub.charged_through_date+'T00:00:00Z')+86400000).toISOString();
      active = active && !!expires && Date.parse(expires) > Date.now();
    }
    const {data,error} = await admin.rpc('square_apply_state',{p_checkout_id:binding.id,p_subscription_id:sub.id,p_event_id:event.event_id,p_event_at:event.created_at,p_active:active,p_expires_at:expires});
    if (error) throw error;
    return reply(200,data);
  } catch { return reply(503,'verification or persistence failed'); }
});
