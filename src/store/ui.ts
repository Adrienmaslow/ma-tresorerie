import { useSyncExternalStore } from 'react';

// ---------- Toasts ----------
export interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'error' | 'info';
  action?: { label: string; run: () => void };
}
let toasts: Toast[] = [];
const tl = new Set<() => void>();
let seq = 0;
export function toast(text: string, tone: Toast['tone'] = 'ok', action?: Toast['action']) {
  const id = ++seq;
  toasts = [...toasts, { id, text, tone, action }].slice(-2);
  tl.forEach((l) => l());
  setTimeout(() => dismissToast(id), action ? 6000 : 3200);
}
export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  tl.forEach((l) => l());
}
export function useToasts() {
  return useSyncExternalStore((l) => (tl.add(l), () => tl.delete(l)), () => toasts);
}

/** Exécute une action et affiche l'erreur éventuelle. Renvoie true si succès. */
export async function attempt(fn: () => Promise<unknown>, ok?: string): Promise<boolean> {
  try {
    await fn();
    if (ok) toast(ok);
    return true;
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error');
    return false;
  }
}

// ---------- Confirmation ----------
export interface ConfirmReq {
  title: string;
  body?: string;
  confirm?: string;
  danger?: boolean;
  checkbox?: string;
  resolve: (v: { ok: boolean; checked: boolean }) => void;
}
let confirmReq: ConfirmReq | null = null;
const cl = new Set<() => void>();
export function askConfirm(o: Omit<ConfirmReq, 'resolve'>): Promise<{ ok: boolean; checked: boolean }> {
  return new Promise((resolve) => {
    confirmReq = { ...o, resolve };
    cl.forEach((l) => l());
  });
}
export async function confirmDanger(title: string, body?: string, confirm = 'Supprimer') {
  return (await askConfirm({ title, body, confirm, danger: true })).ok;
}
export function closeConfirm(v: { ok: boolean; checked: boolean }) {
  confirmReq?.resolve(v);
  confirmReq = null;
  cl.forEach((l) => l());
}
export function useConfirm() {
  return useSyncExternalStore((l) => (cl.add(l), () => cl.delete(l)), () => confirmReq);
}

// ---------- Feuilles modales globales (ajout rapide, etc.) ----------
export type SheetReq =
  | { kind: 'quick' }
  | { kind: 'tx'; type?: import('../types').TxType; id?: string; accountId?: string }
  | { kind: 'pending'; id?: string }
  | { kind: 'receive'; id: string }
  | { kind: 'product'; id?: string }
  | { kind: 'sell'; id?: string }
  | { kind: 'obligation'; id?: string; obKind?: import('../types').ObligationKind }
  | { kind: 'settle'; id: string }
  | { kind: 'account'; id?: string };

let sheet: SheetReq | null = null;
const sl = new Set<() => void>();
export function openSheet(s: SheetReq) {
  sheet = s;
  sl.forEach((l) => l());
}
export function closeSheet() {
  sheet = null;
  sl.forEach((l) => l());
}
export function useSheet() {
  return useSyncExternalStore((l) => (sl.add(l), () => sl.delete(l)), () => sheet);
}
