import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { squareConfig, squareRequest, validCatalog, recurringCheckout } from '../_shared/square.ts';
import { readBoundedJson, limitErrorResponse, RequestLimitError } from '../_shared/request-limits.ts';
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Content-Type': 'application/json' };
serve(async req => {
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === 'OPTIONS') return reply(null);
  if (req.method !== 'POST') return reply(null,405);
  try {
    const auth = req.headers.get('Authorization');
    if (!auth?.startsWith('Bearer ')) return reply({error:'Unauthorized'},401);
    const client = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:auth}}});
    const {data:{user},error} = await client.auth.getUser();
    if (error || !user) return reply({error:'Unauthorized'},401);
    if ((await readBoundedJson(req, { maxBytes: 8192 })).plan !== 'coach_monthly') return reply({error:'Unsupported plan'},400);
    const c = squareConfig(k => Deno.env.get(k));
    const [catalog,location] = await Promise.all([squareRequest(c,`/catalog/object/${encodeURIComponent(c.variation)}`),squareRequest(c,`/locations/${encodeURIComponent(c.location)}`)]);
    if (!validCatalog(c,catalog.object,location.location)) return reply({error:'Square recurring catalog configuration invalid'},503);
    const admin = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const key = `${c.merchant}:${c.location}:${c.variation}:${user.id}`;
    const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));
    const id = Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,40);
    const {error:insertError} = await admin.from('square_checkouts').upsert({id,user_id:user.id,merchant_id:c.merchant,location_id:c.location,variation_id:c.variation},{onConflict:'id',ignoreDuplicates:true});
    if (insertError) throw insertError;
    const {data:binding,error:readError} = await admin.from('square_checkouts').select('*').eq('id',id).single();
    if (readError) throw readError;
    if (binding.subscription_id) return reply({error:'An existing subscription must be managed before starting another'},409);
    if (binding.checkout_url) return reply({checkout_url:binding.checkout_url});
    const result = await squareRequest(c,'/online-checkout/payment-links',recurringCheckout(c,id));
    const link = result.payment_link;
    if (!link?.order_id || !link?.url || !link?.id || new URL(link.url).protocol !== 'https:') throw new Error('Invalid Square payment link');
    const {data:saved,error:saveError} = await admin.from('square_checkouts').update({order_id:link.order_id,checkout_url:link.url,payment_link_id:link.id}).eq('id',id).select('order_id').single();
    if (saveError || saved?.order_id !== link.order_id) throw new Error('Checkout binding not persisted');
    return reply({checkout_url:link.url});
  } catch (error) {
    const limited = error instanceof RequestLimitError ? limitErrorResponse(error, headers) : null;
    if (limited) return limited;
    return reply({error:'Recurring checkout temporarily unavailable; configuration and database must be verified'},503);
  }
});
