import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { rcEventArgs } from '../_shared/rc-events.ts';
import { timingSafeEqualString } from '../_shared/payment-security.ts';
type Result = {data: unknown; error: {code?:string} | null};
type Dependencies = { env: (key:string)=>string|undefined; apply: (args:Record<string,unknown>)=>Promise<Result> };
const production: Dependencies = {
 env: (key) => Deno.env.get(key),
 apply: async (args) => {
  const url=Deno.env.get('SUPABASE_URL'), key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Database not configured');
  return await createClient(url,key,{auth:{persistSession:false}}).rpc('rc_apply_event',args);
 },
};
export function createHandler(deps: Dependencies) {
 return async (req:Request):Promise<Response> => {
  const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  if(req.method!=='POST') return reply(405,{error:'Method not allowed'});
  const secret=deps.env('REVENUECAT_WEBHOOK_SECRET');
  if(!secret) return reply(503,{error:'Webhook not configured'});
  if(!timingSafeEqualString(req.headers.get('Authorization') ?? '',`Bearer ${secret}`)) return reply(401,{error:'Unauthorized'});
  let args;
  try {
   const reader=req.body?.getReader(); if(!reader) return reply(400,{error:'Missing body'});
   let size=0; const chunks:Uint8Array[]=[];
   while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();return reply(413,{error:'Body too large'});}chunks.push(value);}
   const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
   args=rcEventArgs(JSON.parse(new TextDecoder().decode(bytes))?.event);
  } catch {return reply(400,{error:'Invalid event'});}
  try {
   const {data,error}=await deps.apply(args);
   if(error) return reply(error.code==='22023'?400:503,{error:'Event not applied'});
   if(data==='unconfigured') return reply(503,{error:'App/store/environment/product not allowlisted'});
   if(!['applied','duplicate','stale','ignored'].includes(String(data))) return reply(503,{error:'Unexpected fulfillment result'});
   return reply(200,{ok:true,outcome:data});
  } catch {return reply(503,{error:'Fulfillment temporarily unavailable'});}
 };
}
export const handler=createHandler(production);
if(import.meta.main) serve(handler);
