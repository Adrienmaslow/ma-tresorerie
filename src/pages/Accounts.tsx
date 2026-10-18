import { useMemo, useState } from 'react';
import { Banknote, Landmark, Wallet, CreditCard, PiggyBank, Plus, ArrowLeftRight, ChevronUp, ChevronDown, Pencil, History as HistoryIcon } from 'lucide-react';
import { useApp } from '../store/store';
import { computeTotals } from '../lib/calc';
import { Amount, PageHeader, cx } from '../components/ui';
import { openSheet, attempt } from '../store/ui';
import { reorderAccounts } from '../store/actions';
import { ACCOUNT_KIND_LABEL } from '../lib/labels';
import { href } from '../lib/router';
import type { AccountKind } from '../types';

export const ACCOUNT_ICON: Record<AccountKind, typeof Wallet> = {
  cash: Banknote,
  bank: Landmark,
  paypal: Wallet,
  revolut: CreditCard,
  other: PiggyBank,
};

export default function Accounts() {
  const data = useApp((s) => s.data);
  const t = useMemo(() => computeTotals(data), [data]);
  const accounts = useMemo(() => [...data.accounts].sort((a, b) => a.order - b.order), [data.accounts]);
  const [reorder, setReorder] = useState(false);

  const move = (i: number, dir: -1 | 1) => {
    const ids = accounts.map((a) => a.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void attempt(() => reorderAccounts(ids));
  };

  return (
    <div>
      <PageHeader
        title="Liquidités"
        subtitle="Argent immédiatement disponible"
        actions={
          <button className="btn-secondary h-10 px-3 hidden sm:inline-flex" onClick={() => openSheet({ kind: 'tx', type: 'transfer' })}>
            <ArrowLeftRight size={17} /> Transfert
          </button>
        }
      />
      <div className="card p-5">
        <div className="text-muted text-[14px]">Total des liquidités</div>
        <div className="text-[36px] font-semibold tracking-tight">
          <Amount cents={t.liquidity} />
        </div>
      </div>

      <div className="flex gap-2 mt-4">
        <button className="btn-primary flex-1 sm:flex-none" onClick={() => openSheet({ kind: 'account' })}>
          <Plus size={18} /> Ajouter un compte
        </button>
        <button className="btn-secondary sm:hidden" onClick={() => openSheet({ kind: 'tx', type: 'transfer' })} aria-label="Transfert">
          <ArrowLeftRight size={18} />
        </button>
        <button className={cx('btn-secondary', reorder && 'bg-ink text-bg hover:bg-ink')} onClick={() => setReorder((r) => !r)}>
          {reorder ? 'Terminé' : 'Réordonner'}
        </button>
      </div>

      <div className="mt-4 grid sm:grid-cols-2 gap-3">
        {accounts.map((a, i) => {
          const Icon = ACCOUNT_ICON[a.kind];
          const bal = t.balances.get(a.id) ?? 0;
          const share = t.liquidity > 0 && bal > 0 ? Math.round((bal / t.liquidity) * 100) : 0;
          return (
            <div key={a.id} className="card p-4 animate-rise" style={{ animationDelay: `${i * 25}ms` }}>
              <div className="flex items-center gap-3">
                <span className="h-11 w-11 rounded-xl bg-raised grid place-items-center text-ink shrink-0">
                  <Icon size={20} />
                </span>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openSheet({ kind: 'account', id: a.id })}>
                  <div className="font-medium truncate">{a.name}</div>
                  <div className="text-muted text-[13px]">
                    {ACCOUNT_KIND_LABEL[a.kind]}
                    {share > 0 && ` · ${share} %`}
                  </div>
                </button>
                {reorder ? (
                  <div className="flex">
                    <button className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Monter">
                      <ChevronUp size={20} />
                    </button>
                    <button className="icon-btn" onClick={() => move(i, 1)} disabled={i === accounts.length - 1} aria-label="Descendre">
                      <ChevronDown size={20} />
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => openSheet({ kind: 'account', id: a.id })} className="text-right">
                    <Amount cents={bal} className={cx('text-[18px] font-semibold', bal < 0 && 'text-neg')} />
                  </button>
                )}
              </div>
              {!reorder && (
                <div className="flex gap-1 mt-3 -mb-1 -ml-1">
                  <button className="btn-ghost h-9 px-2.5 text-[13px]" onClick={() => openSheet({ kind: 'account', id: a.id })}>
                    <Pencil size={15} /> Modifier
                  </button>
                  <a className="btn-ghost h-9 px-2.5 text-[13px]" href={href('history', { account: a.id })}>
                    <HistoryIcon size={15} /> Opérations
                  </a>
                  <button className="btn-ghost h-9 px-2.5 text-[13px]" onClick={() => openSheet({ kind: 'tx', type: 'transfer', accountId: a.id })}>
                    <ArrowLeftRight size={15} /> Transférer
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-muted text-[13px] mt-4">Touchez un montant pour le modifier : un ajustement est enregistré dans l’historique pour garder des calculs cohérents. Les transferts entre comptes ne modifient pas votre trésorerie totale.</p>
    </div>
  );
}
