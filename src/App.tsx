import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from './store/store';
import { useRoute } from './lib/router';
import { Layout } from './components/Layout';
import { LockScreen } from './components/LockScreen';
import { SheetHost } from './components/forms';
import { ConfirmHost, ToastHost } from './components/ui';
import Home from './pages/Home';
import Accounts from './pages/Accounts';
import Pending from './pages/Pending';
import Stock from './pages/Stock';
import History from './pages/History';
import Obligations from './pages/Obligations';
import Settings from './pages/Settings';

// Les graphiques détaillés sont chargés à la demande
const Stats = lazy(() => import('./pages/Stats'));

function useTheme() {
  const theme = useApp((s) => s.settings.theme);
  useEffect(() => {
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      const color = dark ? '#0a0b0d' : '#f4f5f7';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

/** Verrouillage : au lancement, au retour d'arrière-plan et après inactivité */
function useLock() {
  const hasPin = useApp((s) => !!s.settings.pinHash);
  const minutes = useApp((s) => s.settings.autoLockMinutes);
  const [locked, setLocked] = useState(hasPin);
  const [covered, setCovered] = useState(false);
  const hiddenAt = useRef<number | null>(null);
  const lastActivity = useRef(Date.now());

  useEffect(() => {
    if (!hasPin) setLocked(false);
  }, [hasPin]);

  useEffect(() => {
    if (!hasPin) return;
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
        setCovered(true); // masque le contenu dans le sélecteur d'applications
        if (minutes === 0) setLocked(true);
      } else {
        const away = hiddenAt.current ? Date.now() - hiddenAt.current : 0;
        if (away >= minutes * 60_000) setLocked(true);
        hiddenAt.current = null;
        setCovered(false);
        lastActivity.current = Date.now();
      }
    };
    const onAct = () => (lastActivity.current = Date.now());
    const iv = setInterval(() => {
      if (minutes > 0 && Date.now() - lastActivity.current >= minutes * 60_000) setLocked(true);
    }, 15_000);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pointerdown', onAct);
    window.addEventListener('keydown', onAct);
    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pointerdown', onAct);
      window.removeEventListener('keydown', onAct);
    };
  }, [hasPin, minutes]);

  const unlock = useCallback(() => {
    lastActivity.current = Date.now();
    setLocked(false);
  }, []);
  return { locked: hasPin && locked, covered: hasPin && covered, lock: () => setLocked(true), unlock };
}

function Page() {
  const { route } = useRoute();
  switch (route) {
    case 'home':
      return <Home />;
    case 'accounts':
      return <Accounts />;
    case 'pending':
      return <Pending />;
    case 'stock':
      return <Stock />;
    case 'history':
      return <History />;
    case 'obligations':
      return <Obligations />;
    case 'stats':
      return (
        <Suspense fallback={<div className="text-muted p-8 text-center">Chargement…</div>}>
          <Stats />
        </Suspense>
      );
    case 'settings':
      return <Settings />;
  }
}

export default function App() {
  useTheme();
  const { locked, covered, lock, unlock } = useLock();
  const { route, params } = useRoute();
  if (locked) return <LockScreen onUnlock={unlock} />;
  return (
    <>
      <Layout onLock={lock}>
        <Page key={route + params.toString()} />
      </Layout>
      <SheetHost />
      <ConfirmHost />
      <ToastHost />
      {covered && <div className="fixed inset-0 z-[90] bg-bg" aria-hidden />}
    </>
  );
}
