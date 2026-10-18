import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { STORE_NAMES, type DataState, type Settings, type StoreName } from '../types';

interface TresoDB extends DBSchema {
  accounts: { key: string; value: DataState['accounts'][number] };
  transactions: { key: string; value: DataState['transactions'][number] };
  pending: { key: string; value: DataState['pending'][number] };
  products: { key: string; value: DataState['products'][number] };
  obligations: { key: string; value: DataState['obligations'][number] };
  categories: { key: string; value: DataState['categories'][number] };
  kv: { key: string; value: unknown };
}

const DB_NAME = 'ma-tresorerie';
const DB_VERSION = 1;

let dbp: Promise<IDBPDatabase<TresoDB>> | null = null;

export function getDB() {
  if (!dbp) {
    dbp = openDB<TresoDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        for (const s of STORE_NAMES) {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      },
    });
  }
  return dbp;
}

export async function loadAll(): Promise<DataState> {
  const db = await getDB();
  const tx = db.transaction([...STORE_NAMES], 'readonly');
  const [accounts, transactions, pending, products, obligations, categories] = await Promise.all(
    STORE_NAMES.map((s) => tx.objectStore(s).getAll()),
  );
  await tx.done;
  return { accounts, transactions, pending, products, obligations, categories } as DataState;
}

export type Change = { store: StoreName; record: { id: string } & Record<string, unknown> };

/** Écrit un lot de changements dans une seule transaction IndexedDB (atomique) */
export async function writeChanges(changes: Change[]): Promise<void> {
  if (!changes.length) return;
  const db = await getDB();
  const stores = [...new Set(changes.map((c) => c.store))];
  const tx = db.transaction(stores, 'readwrite');
  for (const c of changes) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx.objectStore(c.store).put(c.record as any);
  }
  await tx.done;
}

export async function replaceAll(data: DataState): Promise<void> {
  const db = await getDB();
  const tx = db.transaction([...STORE_NAMES], 'readwrite');
  for (const s of STORE_NAMES) {
    const os = tx.objectStore(s);
    await os.clear();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of data[s] as any[]) await os.put(r);
  }
  await tx.done;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await getDB();
  return (await db.get('kv', key)) as T | undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await getDB();
  await db.put('kv', value, key);
}

export async function loadSettings(): Promise<Partial<Settings>> {
  return (await kvGet<Partial<Settings>>('settings')) ?? {};
}

export async function saveSettings(s: Settings): Promise<void> {
  await kvSet('settings', s);
}

/** Demande au navigateur de ne pas évincer les données (stockage persistant) */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* non supporté */
  }
  return false;
}
