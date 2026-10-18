import { useSyncExternalStore } from 'react';
import { kvGet, kvSet } from '../db/db';
import { commit, getState, onDataChange, put, updateSettings } from '../store/store';
import { runSync, type SyncMeta } from './engine';
import { supabaseAdapter, supabaseConfigured } from './supabase';
import type { StoreName } from '../types';

export interface SyncStatus {
  configured: boolean;
  signedIn: boolean;
  running: boolean;
  lastError?: string;
  lastSyncAt?: number;
}

let status: SyncStatus = { configured: supabaseConfigured, signedIn: false, running: false };
const listeners = new Set<() => void>();
function set(p: Partial<SyncStatus>) {
  status = { ...status, ...p };
  listeners.forEach((l) => l());
}
export function useSyncStatus() {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => status);
}

const META_KEY = 'syncMeta';
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;

export async function syncNow(): Promise<void> {
  if (!supabaseConfigured || !getState().settings.syncEnabled) return;
  if (inFlight) return inFlight;
  if (!navigator.onLine) return;
  inFlight = (async () => {
    try {
      const ready = await supabaseAdapter.isReady();
      set({ signedIn: ready });
      if (!ready) return;
      set({ running: true, lastError: undefined });
      await runSync({
        adapter: supabaseAdapter,
        getRaw: () => getState().raw,
        apply: (recs) => commit(recs.map((r) => put(r.store as StoreName, r.data as never)), { keepTimestamps: true, silentSync: true }),
        loadMeta: async () => (await kvGet<SyncMeta>(META_KEY)) ?? { cursor: null, pushedAt: 0 },
        saveMeta: (m) => kvSet(META_KEY, m),
      });
      const t = Date.now();
      set({ lastSyncAt: t });
      await updateSettings({ lastSyncAt: t });
    } catch (e) {
      set({ lastError: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ running: false });
      inFlight = null;
    }
  })();
  return inFlight;
}

function schedule(ms = 2000) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), ms);
}

export function startSyncService() {
  if (!supabaseConfigured) return;
  set({ lastSyncAt: getState().settings.lastSyncAt });
  onDataChange(() => schedule());
  window.addEventListener('online', () => schedule(500));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') schedule(500);
  });
  setInterval(() => schedule(0), 60_000);
  void (async () => {
    const ready = await supabaseAdapter.isReady().catch(() => false);
    set({ signedIn: ready });
    schedule(300);
  })();
}

/** Réinitialise le curseur (ex. changement de compte) */
export async function resetSyncMeta() {
  await kvSet(META_KEY, { cursor: null, pushedAt: 0 });
}

export function refreshSignedIn(v: boolean) {
  set({ signedIn: v });
}
