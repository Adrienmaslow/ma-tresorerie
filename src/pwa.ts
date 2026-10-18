import { useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { toast } from './store/ui';

// ---------- Mise à jour du Service Worker ----------
let needRefresh = false;
let updateFn: ((reload?: boolean) => Promise<void>) | null = null;
const ul = new Set<() => void>();

export function initPWA() {
  if (!('serviceWorker' in navigator)) return;
  updateFn = registerSW({
    immediate: true,
    onNeedRefresh() {
      needRefresh = true;
      ul.forEach((l) => l());
      toast('Une nouvelle version est disponible.', 'info', { label: 'Mettre à jour', run: () => void updateFn?.(true) });
    },
    onOfflineReady() {
      toast('Prête à fonctionner hors ligne', 'ok');
    },
    onRegisteredSW(_url, reg) {
      // Vérifie les mises à jour toutes les heures
      if (reg) setInterval(() => void reg.update(), 60 * 60 * 1000);
    },
  });
}

export function useSWUpdate() {
  const nr = useSyncExternalStore((l) => (ul.add(l), () => ul.delete(l)), () => needRefresh);
  return { needRefresh: nr, update: () => void updateFn?.(true) };
}

// ---------- Invite d'installation (Android / ordinateur) ----------
interface BIPEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}
let deferred: BIPEvent | null = null;
const il = new Set<() => void>();
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as BIPEvent;
  il.forEach((l) => l());
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  il.forEach((l) => l());
});

export function useInstallPrompt(): (() => void) | null {
  const d = useSyncExternalStore((l) => (il.add(l), () => il.delete(l)), () => deferred);
  if (!d) return null;
  return () => {
    void d.prompt();
    void d.userChoice.finally(() => {
      deferred = null;
      il.forEach((l) => l());
    });
  };
}
