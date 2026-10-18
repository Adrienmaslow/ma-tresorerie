import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { useApp } from '../store/store';
import { formatCents, parseEuroToCents, centsToInput } from '../lib/money';
import type { Cents } from '../types';
import { closeConfirm, dismissToast, useConfirm, useToasts } from '../store/ui';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

/** Montant formaté, masqué si l'option de confidentialité est active */
export function Amount({ cents, sign, className, colored, forceShow }: { cents: Cents; sign?: boolean; className?: string; colored?: boolean; forceShow?: boolean }) {
  const hidden = useApp((s) => s.settings.hideAmounts) && !forceShow;
  const tone = colored ? (cents > 0 ? 'text-pos' : cents < 0 ? 'text-neg' : '') : '';
  return (
    <span className={cx('tnum whitespace-nowrap', tone, className)} aria-label={hidden ? 'Montant masqué' : undefined}>
      {hidden ? '••••• €' : formatCents(cents, { sign })}
    </span>
  );
}

export function useHidden() {
  return useApp((s) => s.settings.hideAmounts);
}

export function Card({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={cx('card text-left w-full transition hover:border-line active:scale-[.99]', className)}>
        {children}
      </button>
    );
  return <div className={cx('card', className)}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3 mb-5">
      <div className="min-w-0">
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight">{title}</h1>
        {subtitle && <div className="text-muted text-[14px] mt-0.5">{subtitle}</div>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mt-7 mb-3">
      <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted">{children}</h2>
      {action}
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'pos' | 'neg' | 'warn' | 'info' | 'accent' }) {
  const t = {
    neutral: 'bg-raised text-muted',
    pos: 'bg-pos/10 text-pos',
    neg: 'bg-neg/10 text-neg',
    warn: 'bg-warn/10 text-warn',
    info: 'bg-info/10 text-info',
    accent: 'bg-accent/10 text-accent',
  }[tone];
  return <span className={cx('inline-flex items-center gap-1 h-6 px-2 rounded-md text-[12px] font-medium whitespace-nowrap', t)}>{children}</span>;
}

export function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="card p-8 flex flex-col items-center text-center">
      <div className="h-12 w-12 rounded-2xl bg-raised grid place-items-center text-muted mb-3">{icon}</div>
      <div className="font-medium">{title}</div>
      {text && <p className="text-muted text-[14px] mt-1 max-w-sm">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Chips<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[]; className?: string }) {
  return (
    <div className={cx('flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 md:mx-0 md:px-0', className)} role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)} className={cx('chip', value === o.value && 'chip-on')}>
          {o.label}
          {o.count !== undefined && <span className={cx('text-[12px]', value === o.value ? 'opacity-70' : 'opacity-60')}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="flex p-1 rounded-xl bg-raised gap-1" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)} className={cx('flex-1 h-9 rounded-lg text-[14px] font-medium transition px-2', value === o.value ? 'bg-surface text-ink shadow-sm' : 'text-muted')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Champs ----------

export function Field({ label, children, hint, error }: { label: string; children: ReactNode; hint?: ReactNode; error?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {error ? <span className="block text-neg text-[12px] mt-1">{error}</span> : hint ? <span className="block text-muted text-[12px] mt-1">{hint}</span> : null}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx('input', props.className)} />;
}

export function Select({ value, onChange, children, className }: { value: string; onChange: (v: string) => void; children: ReactNode; className?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={cx('input appearance-none pr-9 bg-no-repeat bg-[right_0.8rem_center] bg-[length:16px]', className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888f99' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}>
      {children}
    </select>
  );
}

/** Saisie d'un montant en euros, convertie en centimes entiers */
export function MoneyInput({ value, onChange, allowNegative, autoFocus, placeholder = '0,00', large }: { value: Cents | null; onChange: (c: Cents | null) => void; allowNegative?: boolean; autoFocus?: boolean; placeholder?: string; large?: boolean }) {
  const [text, setText] = useState(() => (value === null ? '' : centsToInput(value)));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      setText(value === null ? '' : centsToInput(value));
      last.current = value;
    }
  }, [value]);
  const parsed = text.trim() ? parseEuroToCents(text) : null;
  const invalid = text.trim() !== '' && (parsed === null || (!allowNegative && parsed < 0));
  return (
    <div className="relative">
      <input
        inputMode="decimal"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d.,\s-]/g, '');
          setText(t);
          const p = t.trim() ? parseEuroToCents(t) : null;
          const ok = p !== null && (allowNegative || p >= 0) ? p : null;
          last.current = ok;
          onChange(ok);
        }}
        className={cx('input tnum pr-9', large && 'h-16 text-[28px] font-semibold', invalid && 'border-neg focus:border-neg focus:ring-neg/20')}
        aria-invalid={invalid}
      />
      <span className={cx('absolute right-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none', large && 'text-[22px]')}>€</span>
    </div>
  );
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <div className="text-[15px]">{label}</div>
        {description && <div className="text-muted text-[13px]">{description}</div>}
      </label>
      <button id={id} type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={cx('relative h-7 w-12 rounded-full transition shrink-0', checked ? 'bg-accent' : 'bg-line')}>
        <span className={cx('absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
      </button>
    </div>
  );
}

// ---------- Feuille modale ----------

export function Sheet({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />
      <div className={cx('relative w-full bg-surface border border-line md:rounded-2xl rounded-t-[1.5rem] max-h-[92dvh] flex flex-col animate-sheet-in md:animate-rise shadow-2xl', wide ? 'md:max-w-2xl' : 'md:max-w-lg')}>
        <div className="md:hidden mx-auto mt-2 h-1.5 w-10 rounded-full bg-line" />
        <div className="flex items-center justify-between px-5 pt-3 md:pt-5 pb-3">
          <h2 className="text-[19px] font-semibold">{title}</h2>
          <button type="button" className="icon-btn -mr-2" onClick={onClose} aria-label="Fermer">
            <X size={20} />
          </button>
        </div>
        <div className="px-5 pb-4 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] md:pb-5 border-t border-line flex gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmHost() {
  const req = useConfirm();
  const [checked, setChecked] = useState(false);
  useEffect(() => setChecked(false), [req]);
  if (!req) return null;
  return (
    <Sheet
      open
      title={req.title}
      onClose={() => closeConfirm({ ok: false, checked })}
      footer={
        <>
          <button className="btn-secondary flex-1" onClick={() => closeConfirm({ ok: false, checked })}>
            Annuler
          </button>
          <button className={cx(req.danger ? 'btn-danger' : 'btn-primary', 'flex-1')} onClick={() => closeConfirm({ ok: true, checked })}>
            {req.confirm ?? 'Confirmer'}
          </button>
        </>
      }
    >
      {req.body && <p className="text-muted text-[15px]">{req.body}</p>}
      {req.checkbox && (
        <label className="flex items-center gap-3 mt-4 text-[15px]">
          <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--accent))]" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          {req.checkbox}
        </label>
      )}
    </Sheet>
  );
}

export function ToastHost() {
  const toasts = useToasts();
  return createPortal(
    <div className="fixed z-[60] left-0 right-0 flex flex-col items-center gap-2 px-4 pointer-events-none top-[calc(env(safe-area-inset-top)+0.75rem)]">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto animate-rise flex items-center gap-2.5 rounded-xl bg-raised border border-line shadow-xl px-4 py-3 text-[14px] max-w-md">
          {t.tone === 'ok' ? <CheckCircle2 size={18} className="text-pos shrink-0" /> : t.tone === 'error' ? <AlertCircle size={18} className="text-neg shrink-0" /> : <Info size={18} className="text-info shrink-0" />}
          <span>{t.text}</span>
          {t.action && (
            <button
              className="ml-2 font-semibold text-accent"
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
}

export function Stat({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card p-4 min-w-0">
      <div className="text-muted text-[13px]">{label}</div>
      <div className="text-[20px] font-semibold mt-1 truncate">{children}</div>
      {sub && <div className="text-muted text-[12px] mt-0.5">{sub}</div>}
    </div>
  );
}
