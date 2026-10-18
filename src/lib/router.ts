import { useSyncExternalStore } from 'react';

export type Route = 'home' | 'accounts' | 'pending' | 'stock' | 'history' | 'obligations' | 'stats' | 'settings';

const PATHS: Record<Route, string> = {
  home: '',
  accounts: 'liquidites',
  pending: 'attente',
  stock: 'stock',
  history: 'historique',
  obligations: 'depenses',
  stats: 'statistiques',
  settings: 'reglages',
};

export interface Loc {
  route: Route;
  params: URLSearchParams;
}

function parse(): Loc {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, q] = h.split('?');
  const route = (Object.keys(PATHS) as Route[]).find((r) => PATHS[r] === path) ?? 'home';
  return { route, params: new URLSearchParams(q ?? '') };
}

let current = parse();
let key = location.hash;
const ls = new Set<() => void>();
window.addEventListener('hashchange', () => {
  current = parse();
  key = location.hash;
  ls.forEach((l) => l());
  window.scrollTo({ top: 0 });
});

export function useRoute(): Loc {
  useSyncExternalStore((l) => (ls.add(l), () => ls.delete(l)), () => key);
  return current;
}

export function href(r: Route, params?: Record<string, string>): string {
  const q = params ? '?' + new URLSearchParams(params).toString() : '';
  return '#/' + PATHS[r] + q;
}

export function navigate(r: Route, params?: Record<string, string>) {
  location.hash = href(r, params);
}
