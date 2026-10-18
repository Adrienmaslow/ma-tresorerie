import type { ReactNode } from 'react';
import { Home, Wallet, Clock, Package, History, Plus, Eye, EyeOff, Settings, Lock, BarChart3, Receipt, RefreshCw, CloudOff } from 'lucide-react';
import { href, type Route, useRoute } from '../lib/router';
import { openSheet } from '../store/ui';
import { updateSettings, useApp } from '../store/store';
import { cx } from './ui';
import { useSyncStatus } from '../sync/service';
import { useOnline } from '../lib/hooks';

const MAIN: { route: Route; label: string; icon: typeof Home }[] = [
  { route: 'home', label: 'Accueil', icon: Home },
  { route: 'accounts', label: 'Liquidités', icon: Wallet },
  { route: 'pending', label: 'En attente', icon: Clock },
  { route: 'stock', label: 'Stock', icon: Package },
  { route: 'history', label: 'Historique', icon: History },
];
const MORE: { route: Route; label: string; icon: typeof Home }[] = [
  { route: 'obligations', label: 'Dépenses & dettes', icon: Receipt },
  { route: 'stats', label: 'Statistiques', icon: BarChart3 },
  { route: 'settings', label: 'Réglages', icon: Settings },
];

function Logo() {
  return <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" className="h-8 w-8 rounded-[9px]" />;
}

export function Layout({ children, onLock }: { children: ReactNode; onLock?: () => void }) {
  const { route } = useRoute();
  const hidden = useApp((s) => s.settings.hideAmounts);
  const hasPin = useApp((s) => !!s.settings.pinHash);
  const online = useOnline();
  const sync = useSyncStatus();
  const toggleHide = () => void updateSettings({ hideAmounts: !hidden });

  const HideBtn = (
    <button type="button" className="icon-btn" onClick={toggleHide} aria-label={hidden ? 'Afficher les montants' : 'Masquer les montants'} title={hidden ? 'Afficher les montants' : 'Masquer les montants'}>
      {hidden ? <EyeOff size={20} /> : <Eye size={20} />}
    </button>
  );

  return (
    <div className="min-h-full md:flex">
      {/* Navigation latérale (ordinateur) */}
      <aside className="hidden md:flex md:flex-col w-64 shrink-0 border-r border-line/70 h-screen sticky top-0 p-4">
        <div className="flex items-center gap-2.5 px-2 py-2 mb-6">
          <Logo />
          <span className="font-semibold text-[17px] tracking-tight">Ma Trésorerie</span>
        </div>
        <nav className="space-y-0.5">
          {MAIN.map((n) => (
            <a key={n.route} href={href(n.route)} className={cx('flex items-center gap-3 h-10 px-3 rounded-xl text-[15px] transition', route === n.route ? 'bg-raised text-ink font-medium' : 'text-muted hover:text-ink hover:bg-raised/60')}>
              <n.icon size={18} /> {n.label}
            </a>
          ))}
        </nav>
        <div className="my-4 border-t border-line/70" />
        <nav className="space-y-0.5">
          {MORE.map((n) => (
            <a key={n.route} href={href(n.route)} className={cx('flex items-center gap-3 h-10 px-3 rounded-xl text-[15px] transition', route === n.route ? 'bg-raised text-ink font-medium' : 'text-muted hover:text-ink hover:bg-raised/60')}>
              <n.icon size={18} /> {n.label}
            </a>
          ))}
        </nav>
        <button type="button" className="btn-primary mt-6 w-full" onClick={() => openSheet({ kind: 'quick' })}>
          <Plus size={18} /> Ajouter
        </button>
        <div className="mt-auto flex items-center gap-1 text-muted">
          {HideBtn}
          {hasPin && (
            <button type="button" className="icon-btn" onClick={onLock} aria-label="Verrouiller" title="Verrouiller">
              <Lock size={20} />
            </button>
          )}
          <span className="ml-auto text-[12px] flex items-center gap-1.5">
            {!online ? (<><CloudOff size={14} /> Hors ligne</>) : sync.running ? (<><RefreshCw size={14} className="animate-spin" /> Synchro</>) : null}
          </span>
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        {/* Barre supérieure (mobile) */}
        <header className="md:hidden sticky top-0 z-30 bg-bg/85 backdrop-blur-xl safe-top">
          <div className="flex items-center h-14 px-4 gap-1">
            <a href={href('home')} className="flex items-center gap-2 mr-auto" aria-label="Accueil">
              <Logo />
              <span className="font-semibold tracking-tight">Ma Trésorerie</span>
            </a>
            {!online && (
              <span className="text-muted text-[12px] flex items-center gap-1 mr-1">
                <CloudOff size={14} /> Hors ligne
              </span>
            )}
            {sync.running && <RefreshCw size={16} className="animate-spin text-muted mr-1" />}
            {HideBtn}
            {hasPin && (
              <button type="button" className="icon-btn" onClick={onLock} aria-label="Verrouiller">
                <Lock size={20} />
              </button>
            )}
            <a href={href('settings')} className={cx('icon-btn', route === 'settings' && 'text-ink')} aria-label="Réglages">
              <Settings size={20} />
            </a>
          </div>
        </header>

        <main className="px-4 md:px-8 pt-3 md:pt-8 pb-nav md:pb-12 max-w-5xl mx-auto animate-fade-in" key={route}>
          {children}
        </main>
      </div>

      {/* Bouton + (mobile) */}
      <button
        type="button"
        onClick={() => openSheet({ kind: 'quick' })}
        className="md:hidden fixed z-40 right-4 h-14 w-14 rounded-2xl bg-accent text-[#04150e] grid place-items-center shadow-[0_8px_30px_rgba(62,224,160,0.35)] active:scale-95 transition bottom-[calc(env(safe-area-inset-bottom)+5rem)]"
        aria-label="Ajouter une opération"
      >
        <Plus size={28} strokeWidth={2.4} />
      </button>

      {/* Barre d'onglets (mobile) */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-surface/90 backdrop-blur-xl border-t border-line/70 safe-bottom" aria-label="Navigation principale">
        <div className="grid grid-cols-5 h-16">
          {MAIN.map((n) => {
            const on = route === n.route;
            return (
              <a key={n.route} href={href(n.route)} aria-current={on ? 'page' : undefined} className={cx('flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition', on ? 'text-accent' : 'text-muted')}>
                <n.icon size={22} strokeWidth={on ? 2.2 : 1.8} />
                {n.label}
              </a>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
