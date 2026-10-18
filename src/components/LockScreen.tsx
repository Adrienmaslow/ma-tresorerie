import { useCallback, useEffect, useState } from 'react';
import { Delete, ScanFace } from 'lucide-react';
import { useApp } from '../store/store';
import { verifyBiometric, verifyPin } from '../lib/security';
import { kvGet, kvSet } from '../db/db';
import { cx } from './ui';

const MAX_LEN = 8;

/** Délai imposé après des échecs répétés (en secondes) */
function lockoutSeconds(fails: number) {
  if (fails < 5) return 0;
  return Math.min(30 * 2 ** (fails - 5), 15 * 60);
}

export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const settings = useApp((s) => s.settings);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fails, setFails] = useState(0);
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    void kvGet<{ fails: number; until: number }>('lock').then((v) => {
      if (v) {
        setFails(v.fails);
        setUntil(v.until);
      }
    });
  }, []);
  useEffect(() => {
    if (until <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [until]);

  const locked = until > now;
  const remaining = Math.ceil((until - now) / 1000);

  const tryBio = useCallback(async () => {
    if (!settings.biometricCredentialId) return;
    try {
      if (await verifyBiometric(settings.biometricCredentialId)) {
        await kvSet('lock', { fails: 0, until: 0 });
        onUnlock();
      }
    } catch {
      /* annulé par l'utilisateur */
    }
  }, [settings.biometricCredentialId, onUnlock]);

  const submit = useCallback(
    async (value: string) => {
      if (!settings.pinHash || !settings.pinSalt) return onUnlock();
      setBusy(true);
      const ok = await verifyPin(value, settings.pinHash, settings.pinSalt, settings.pinIterations);
      setBusy(false);
      if (ok) {
        await kvSet('lock', { fails: 0, until: 0 });
        onUnlock();
        return;
      }
      const f = fails + 1;
      const u = Date.now() + lockoutSeconds(f) * 1000;
      setFails(f);
      setUntil(u);
      setNow(Date.now());
      await kvSet('lock', { fails: f, until: u });
      setError(true);
      setTimeout(() => {
        setError(false);
        setPin('');
      }, 450);
    },
    [settings, fails, onUnlock],
  );

  const press = (d: string) => {
    if (busy || locked) return;
    setPin((p) => (p.length < MAX_LEN ? p + d : p));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
      else if (e.key === 'Enter' && pin.length >= 4) void submit(pin);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (settings.pinLength && pin.length === settings.pinLength && !busy && !error) void submit(pin);
  }, [pin, settings.pinLength, busy, error, submit]);

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  return (
    <div className="fixed inset-0 z-[100] bg-bg flex flex-col items-center justify-center px-6 safe-top safe-bottom select-none">
      <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" className="h-16 w-16 rounded-[18px] mb-5" />
      <h1 className="text-[20px] font-semibold">Ma Trésorerie</h1>
      <p className="text-muted text-[14px] mt-1 h-5">{locked ? `Trop d’essais. Réessayez dans ${remaining} s` : fails > 0 ? 'Code incorrect' : 'Saisissez votre code'}</p>
      <div className={cx('flex gap-3 my-8 h-4', error && 'animate-shake')}>
        {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
          <span key={i} className={cx('h-3.5 w-3.5 rounded-full border transition', i < pin.length ? (error ? 'bg-neg border-neg' : 'bg-ink border-ink') : 'border-muted')} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-4 w-full max-w-[290px]">
        {keys.map((k) => (
          <button key={k} type="button" onClick={() => press(k)} disabled={locked} className="h-[72px] rounded-full bg-raised text-[28px] font-medium active:bg-line transition disabled:opacity-40">
            {k}
          </button>
        ))}
        {settings.biometricCredentialId ? (
          <button type="button" onClick={tryBio} disabled={locked} className="h-[72px] rounded-full grid place-items-center text-accent disabled:opacity-40" aria-label="Déverrouiller avec la biométrie">
            <ScanFace size={30} />
          </button>
        ) : (
          <span />
        )}
        <button type="button" onClick={() => press('0')} disabled={locked} className="h-[72px] rounded-full bg-raised text-[28px] font-medium active:bg-line transition disabled:opacity-40">
          0
        </button>
        <button type="button" onClick={() => setPin((p) => p.slice(0, -1))} className="h-[72px] rounded-full grid place-items-center text-muted" aria-label="Effacer">
          <Delete size={26} />
        </button>
      </div>
      <button type="button" className="btn-primary mt-8 w-full max-w-[290px]" disabled={pin.length < 4 || busy || locked} onClick={() => submit(pin)}>
        {busy ? 'Vérification…' : 'Déverrouiller'}
      </button>
    </div>
  );
}
