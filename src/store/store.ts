import { useSyncExternalStore } from 'react';
import { loadAll, loadSettings, saveSettings, writeChanges, replaceAll, type Change } from '../db/db';
import { STORE_NAMES, type DataState, type Settings, type StoreName, type RecordOf } from '../types';
import { live } from '../lib/calc';

export const DEFAULT_SETTINGS: Settings = {
  hideAmounts: false,
  hideOnLaunch: false,
  autoLockMinutes: 1,
  theme: 'dark',
};

export interface AppState {
  loaded: boolean;
  /** Toutes les données, y compris les suppressions logiques */
  raw: DataState;
  /** Données visibles (sans suppressions logiques) */
  data: DataState;
  settings: Settings;
}

const empty: DataState = { accounts: [], transactions: [], pending: [], products: [], obligations: [], categories: [] };

let state: AppState = { loaded: false, raw: empty, data: empty, settings: DEFAULT_SETTINGS };
const listeners = new Set<() => void>();
const changeHooks = new Set<() => void>();

function deriveLive(raw: DataState): DataState {
  const out = {} as DataState;
  for (const s of STORE_NAMES) (out as Record<StoreName, unknown>)[s] = live(raw[s] as { deleted?: boolean }[]);
  return out;
}

function setState(next: AppState) {
  state = next;
  listeners.forEach((l) => l());
}

export function getState() {
  return state;
}

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Appelé après chaque modification de données (ex. déclencher une synchro) */
export function onDataChange(fn: () => void) {
  changeHooks.add(fn);
  return () => changeHooks.delete(fn);
}

export function useApp<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state), () => selector(state));
}

export function uid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

const bc: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ma-tresorerie') : null;
bc?.addEventListener('message', (e) => {
  if (e.data === 'changed') void reload();
});

export async function init(seed?: (s: AppState) => Change[]) {
  const [raw, s] = await Promise.all([loadAll(), loadSettings()]);
  const settings: Settings = { ...DEFAULT_SETTINGS, ...s };
  if (settings.hideOnLaunch) settings.hideAmounts = true;
  setState({ loaded: true, raw, data: deriveLive(raw), settings });
  if (seed) {
    const ch = seed(state);
    if (ch.length) await commit(ch, { silentSync: true });
  }
}

export async function reload() {
  const raw = await loadAll();
  setState({ ...state, raw, data: deriveLive(raw) });
}

type AnyRecord = RecordOf<StoreName>;

/** Applique un lot de changements : mémoire + IndexedDB (atomique) */
export async function commit(changes: Change[], opts: { keepTimestamps?: boolean; silentSync?: boolean } = {}) {
  if (!changes.length) return;
  const now = Date.now();
  const stamped = changes.map((c) => ({
    store: c.store,
    record: opts.keepTimestamps ? c.record : { ...c.record, updatedAt: now },
  }));
  const raw = { ...state.raw } as Record<StoreName, AnyRecord[]>;
  for (const c of stamped) {
    const arr = [...(raw[c.store] as AnyRecord[])];
    const i = arr.findIndex((r) => r.id === c.record.id);
    if (i >= 0) arr[i] = c.record as unknown as AnyRecord;
    else arr.push(c.record as unknown as AnyRecord);
    raw[c.store] = arr;
  }
  const nextRaw = raw as unknown as DataState;
  setState({ ...state, raw: nextRaw, data: deriveLive(nextRaw) });
  await writeChanges(stamped as Change[]);
  bc?.postMessage('changed');
  if (!opts.silentSync) changeHooks.forEach((h) => h());
}

export function put<S extends StoreName>(store: S, record: RecordOf<S>): Change {
  return { store, record: record as unknown as Change['record'] };
}

export function softDelete<S extends StoreName>(store: S, record: RecordOf<S>): Change {
  return put(store, { ...record, deleted: true } as RecordOf<S>);
}

export function findRaw<S extends StoreName>(store: S, id: string | undefined): RecordOf<S> | undefined {
  if (!id) return undefined;
  return (state.raw[store] as RecordOf<S>[]).find((r) => r.id === id);
}

export function findLive<S extends StoreName>(store: S, id: string | undefined): RecordOf<S> | undefined {
  const r = findRaw(store, id);
  return r && !(r as { deleted?: boolean }).deleted ? r : undefined;
}

export async function updateSettings(patch: Partial<Settings>) {
  const settings = { ...state.settings, ...patch };
  setState({ ...state, settings });
  await saveSettings(settings);
}

export async function replaceData(data: DataState) {
  await replaceAll(data);
  setState({ ...state, raw: data, data: deriveLive(data) });
  bc?.postMessage('changed');
  changeHooks.forEach((h) => h());
}
