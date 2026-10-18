/**
 * Moteur de synchronisation indépendant du backend.
 * Stratégie : « dernier écrit gagne » par enregistrement (champ updatedAt),
 * suppressions propagées par tombstones (deleted = true).
 */
import { STORE_NAMES, type DataState, type StoreName } from '../types';

export interface RemoteRecord {
  store: StoreName;
  id: string;
  data: Record<string, unknown> & { id: string; updatedAt: number; deleted?: boolean };
  updatedAt: number;
  deleted: boolean;
}

export interface PullResult {
  records: RemoteRecord[];
  /** Curseur opaque à renvoyer au prochain pull */
  cursor: string | null;
}

export interface SyncAdapter {
  readonly name: string;
  isReady(): Promise<boolean>;
  pull(cursor: string | null): Promise<PullResult>;
  push(records: RemoteRecord[]): Promise<void>;
}

export interface SyncMeta {
  cursor: string | null;
  /** Horodatage local de la dernière poussée réussie */
  pushedAt: number;
}

/** Enregistrements locaux modifiés depuis la dernière poussée */
export function collectDirty(raw: DataState, since: number): RemoteRecord[] {
  const out: RemoteRecord[] = [];
  for (const store of STORE_NAMES) {
    for (const r of raw[store] as unknown as RemoteRecord['data'][]) {
      if (r.updatedAt > since) out.push({ store, id: r.id, data: r, updatedAt: r.updatedAt, deleted: !!r.deleted });
    }
  }
  return out;
}

/** Fusionne des enregistrements distants : ne garde que ceux plus récents que la version locale */
export function mergeRemote(raw: DataState, remote: RemoteRecord[]): RemoteRecord[] {
  const index = new Map<string, number>();
  for (const store of STORE_NAMES) {
    for (const r of raw[store] as unknown as RemoteRecord['data'][]) index.set(store + ':' + r.id, r.updatedAt);
  }
  // Dédoublonne en gardant la version distante la plus récente
  const best = new Map<string, RemoteRecord>();
  for (const r of remote) {
    const k = r.store + ':' + r.id;
    const prev = best.get(k);
    if (!prev || r.updatedAt > prev.updatedAt) best.set(k, r);
  }
  const winners: RemoteRecord[] = [];
  for (const [k, r] of best) {
    const local = index.get(k);
    if (local === undefined || r.updatedAt > local) winners.push(r);
  }
  return winners;
}

export interface SyncDeps {
  adapter: SyncAdapter;
  getRaw: () => DataState;
  apply: (records: RemoteRecord[]) => Promise<void>;
  loadMeta: () => Promise<SyncMeta>;
  saveMeta: (m: SyncMeta) => Promise<void>;
}

export interface SyncReport {
  pushed: number;
  pulled: number;
}

export async function runSync(d: SyncDeps): Promise<SyncReport> {
  const meta = await d.loadMeta();
  // 1. Pull d'abord pour appliquer les changements distants
  let cursor = meta.cursor;
  let pulled = 0;
  for (let guard = 0; guard < 50; guard++) {
    const res = await d.adapter.pull(cursor);
    const winners = mergeRemote(d.getRaw(), res.records);
    if (winners.length) await d.apply(winners);
    pulled += winners.length;
    const done = res.cursor === cursor || res.records.length === 0;
    cursor = res.cursor;
    if (done) break;
  }
  // 2. Push des modifications locales
  const startedAt = Date.now();
  const dirty = collectDirty(d.getRaw(), meta.pushedAt);
  if (dirty.length) await d.adapter.push(dirty);
  await d.saveMeta({ cursor, pushedAt: dirty.length ? Math.max(startedAt, ...dirty.map((r) => r.updatedAt)) : meta.pushedAt });
  return { pushed: dirty.length, pulled };
}
