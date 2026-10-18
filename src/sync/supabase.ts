/**
 * Adaptateur Supabase. Activé uniquement si VITE_SUPABASE_URL et
 * VITE_SUPABASE_ANON_KEY sont définis au moment du build.
 * Schéma et règles RLS : voir supabase/schema.sql.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PullResult, RemoteRecord, SyncAdapter } from './engine';

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = !!(URL_ && KEY);

let clientP: Promise<SupabaseClient> | null = null;

export function getSupabase(): Promise<SupabaseClient> {
  if (!supabaseConfigured) throw new Error('Supabase non configuré.');
  if (!clientP) {
    clientP = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(URL_!, KEY!, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'ma-tresorerie-auth' } }),
    );
  }
  return clientP;
}

const PAGE = 500;

export const supabaseAdapter: SyncAdapter = {
  name: 'supabase',
  async isReady() {
    if (!supabaseConfigured) return false;
    const sb = await getSupabase();
    const { data } = await sb.auth.getSession();
    return !!data.session;
  },
  async pull(cursor): Promise<PullResult> {
    const sb = await getSupabase();
    let q = sb.from('records').select('store,id,data,updated_at,deleted,server_updated_at').order('server_updated_at', { ascending: true }).limit(PAGE);
    if (cursor) q = q.gt('server_updated_at', cursor);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { store: RemoteRecord['store']; id: string; data: RemoteRecord['data']; updated_at: number; deleted: boolean; server_updated_at: string }[];
    return {
      records: rows.map((r) => ({ store: r.store, id: r.id, data: r.data, updatedAt: Number(r.updated_at), deleted: r.deleted })),
      cursor: rows.length ? rows[rows.length - 1].server_updated_at : cursor,
    };
  },
  async push(records) {
    const sb = await getSupabase();
    for (let i = 0; i < records.length; i += PAGE) {
      const chunk = records.slice(i, i + PAGE).map((r) => ({ store: r.store, id: r.id, data: r.data, updated_at: r.updatedAt, deleted: r.deleted }));
      const { error } = await sb.rpc('push_records', { payload: chunk });
      if (error) throw new Error(error.message);
    }
  },
};
