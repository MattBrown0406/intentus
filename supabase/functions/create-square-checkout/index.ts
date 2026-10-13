import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { squareConfig, squareRequest, validCatalog, checkoutBindingId, resolveCheckoutLink, ENDED_SUBSCRIPTION_STATUSES } from '../_shared/square.ts';
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
    // One binding per subscription. A binding whose subscription has ENDED at
    // Square no longer blocks a new checkout (a lapsed coach can resubscribe);
    // any live subscription (incl. cancel-scheduled) must be managed first.
    const {data:existing,error:listError} = await admin.from('square_checkouts').select('id,subscription_id').eq('user_id',user.id).eq('merchant_id',c.merchant).eq('location_id',c.location).eq('variation_id',c.variation);
    if (listError) throw listError;
    const bound = (existing ?? []).filter(b => b.subscription_id);
    for (const b of bound) {
      const sub = (await squareRequest(c,`/subscriptions/${encodeURIComponent(b.subscription_id)}`)).subscription;
      if (sub?.id !== b.subscription_id) throw new Error('Square subscription lookup failed');
      if (!ENDED_SUBSCRIPTION_STATUSES.has(sub.status)) return reply({error:'An existing subscription must be managed before starting another'},409);
    }
    const id = await checkoutBindingId(c,user.id,bound.length);
    const {error:insertError} = await admin.from('square_checkouts').upsert({id,user_id:user.id,merchant_id:c.merchant,location_id:c.location,variation_id:c.variation},{onConflict:'id',ignoreDuplicates:true});
    if (insertError) throw insertError;
    const {data:binding,error:readError} = await admin.from('square_checkouts').select('*').eq('id',id).single();
    if (readError) throw readError;
    if (binding.subscription_id) return reply({error:'An existing subscription must be managed before starting another'},409);
    const result = await resolveCheckoutLink(c,binding,(path,body,method)=>squareRequest(c,path,body,method),async update=>{
      const {data:saved,error:saveError} = await admin.from('square_checkouts').update(update).eq('id',id).is('subscription_id',null).select('order_id').single();
      if (saveError || saved?.order_id !== update.order_id) throw new Error('Checkout binding not persisted');
    });
    if ('pending' in result) return reply({error:'Your payment is being verified. Access activates shortly.'},409);
    return reply({checkout_url:result.url});
  } catch (error) {
    const limited = error instanceof RequestLimitError ? limitErrorResponse(error, headers) : null;
    if (limited) return limited;
    return reply({error:'Recurring checkout temporarily unavailable; configuration and database must be verified'},503);
  }
});
