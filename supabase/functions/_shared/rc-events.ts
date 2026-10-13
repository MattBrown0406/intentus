export function rcEventArgs(value: unknown, now = Date.now()): Record<string, unknown> {
  const e = value as Record<string, unknown>;
  if (!e || typeof e !== 'object' || Array.isArray(e)) throw new Error('event');
  for (const field of ['id','app_id','store','environment','product_id','type','app_user_id']) {
    if (typeof e[field] !== 'string' || !(e[field] as string).length || (e[field] as string).length > 200) throw new Error(field);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(e.app_user_id))) throw new Error('user');
  if (!['PRODUCTION','SANDBOX'].includes(String(e.environment))) throw new Error('environment');
  if (!['APP_STORE','PLAY_STORE','STRIPE','MAC_APP_STORE','AMAZON'].includes(String(e.store))) throw new Error('store');
  const stamp = (x: unknown) => typeof x === 'number' && Number.isSafeInteger(x) && x >= 1577836800000 && x <= 253402300799999;
  if (!stamp(e.event_timestamp_ms) || Number(e.event_timestamp_ms) > now + 300000) throw new Error('timestamp');
  if (e.expiration_at_ms != null && !stamp(e.expiration_at_ms)) throw new Error('expiration');
  return {p_event_id:e.id,p_user_id:e.app_user_id,p_app_id:e.app_id,p_store:e.store,p_environment:e.environment,
    p_product_id:e.product_id,p_event_type:e.type,p_event_at:new Date(Number(e.event_timestamp_ms)).toISOString(),
    p_expires_at:e.expiration_at_ms == null ? null : new Date(Number(e.expiration_at_ms)).toISOString()};
}

/** TRANSFER carries no app_user_id/product_id/expiration: only the id lists. */
export function rcTransferArgs(value: unknown, now = Date.now()): Record<string, unknown> {
  const e = value as Record<string, unknown>;
  if (!e || typeof e !== 'object' || Array.isArray(e) || e.type !== 'TRANSFER') throw new Error('event');
  for (const field of ['id','app_id']) {
    if (typeof e[field] !== 'string' || !(e[field] as string).length || (e[field] as string).length > 200) throw new Error(field);
  }
  if (e.environment != null && !['PRODUCTION','SANDBOX'].includes(String(e.environment))) throw new Error('environment');
  if (e.store != null && !['APP_STORE','PLAY_STORE','STRIPE','MAC_APP_STORE','AMAZON'].includes(String(e.store))) throw new Error('store');
  const ids = (x: unknown) => {
    if (!Array.isArray(x) || x.length > 50 || !x.every((id) => typeof id === 'string' && id.length >= 1 && id.length <= 200)) throw new Error('ids');
    return x as string[];
  };
  const stamp = e.event_timestamp_ms;
  if (typeof stamp !== 'number' || !Number.isSafeInteger(stamp) || stamp < 1577836800000 || stamp > now + 300000) throw new Error('timestamp');
  return {p_event_id:e.id,p_app_id:e.app_id,p_store:e.store ?? null,p_environment:e.environment ?? null,
    p_event_at:new Date(stamp).toISOString(),p_from:ids(e.transferred_from),p_to:ids(e.transferred_to)};
}
