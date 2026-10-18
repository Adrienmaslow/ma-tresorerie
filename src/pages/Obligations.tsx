import { useMemo, useState } from 'react';
import { Plus, Receipt, AlertTriangle, Repeat, HandCoins, CalendarClock, Landmark, Ban, RotateCcw } from 'lucide-react';
import { useApp } from '../store/store';
import { flowsInRange, isOverdue, obligationPaidCents, obligationRemaining } from '../lib/calc';
import { Amount, Badge, Chips, Empty, PageHeader, Stat, cx } from '../components/ui';
import { attempt, openSheet } from '../store/ui';
import { setObligationStatus } from '../store/actions';
import { OBLIGATION_KIND_LABEL, RECURRENCE_LABEL } from '../lib/labels';
import { daysBetween, fmtDate, today } from '../lib/dates';
import { TxRow } from './History';
import type { Obligation, ObligationKind } from '../types';

type Tab = 'all' | ObligationKind | 'spent';
type StatusF = 'open' | 'paid' | 'cancelled';

const KIND_ICON: Record<ObligationKind, typeof Receipt> = {
  upcoming: CalendarClock,
  debt: Landmark,
  loan_given: HandCoins,
  recurring: Repeat,
};

function ObligationCard({ o }: { o: Obligation }) {
  const txs = useApp((s) => s.data.transactions);
  const remaining = obligationRemaining(o, txs);
  const paid = obligationPaidCents(o, txs);
  const overdue = isOverdue(o);
  const Icon = KIND_ICON[o.kind];
  const loan = o.kind === 'loan_given';
  const progress = o.kind !== 'recurring' && o.amountCents ? Math.min(100, Math.round((paid / o.amountCents) * 100)) : 0;
  const d = o.dueDate ? daysBetween(today(), o.dueDate) : null;
  return (
    <div className="card p-4">
      <button type="button" className="w-full text-left" onClick={() => openSheet({ kind: 'obligation', id: o.id })}>
        <div className="flex items-start gap-3">
          <span className={cx('h-10 w-10 rounded-xl grid place-items-center shrink-0', loan ? 'bg-info/10 text-info' : 'bg-neg/10 text-neg')}>
            <Icon size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-medium truncate">{o.label}</div>
            <div className="text-muted text-[13px] truncate">
              {OBLIGATION_KIND_LABEL[o.kind]}
              {o.recurrence && ` · ${RECURRENCE_LABEL[o.recurrence]}`}
              {o.counterparty && ` · ${o.counterparty}`}
            </div>
            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
              {o.status === 'paid' && <Badge tone="pos">{loan ? 'Remboursé' : 'Soldé'}</Badge>}
              {o.status === 'cancelled' && <Badge>Annulé</Badge>}
              {o.status === 'open' && overdue && (
                <Badge tone="neg">
                  <AlertTriangle size={12} /> En retard
                </Badge>
              )}
              {o.status === 'open' && o.dueDate && (
                <span className={cx('text-[13px]', overdue ? 'text-neg' : 'text-muted')}>
                  {o.kind === 'recurring' ? 'Prochaine : ' : 'Échéance : '}
                  {fmtDate(o.dueDate)}
                  {!overdue && d !== null && d <= 7 && ` (${d === 0 ? 'aujourd’hui' : `J-${d}`})`}
                </span>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <Amount cents={o.status === 'open' ? remaining : o.amountCents} className={cx('text-[17px] font-semibold block', o.status !== 'open' && 'text-muted')} />
            <span className="text-muted text-[12px]">{o.status !== 'open' ? 'total' : o.kind === 'recurring' ? 'par échéance' : loan ? 'à recevoir' : 'reste dû'}</span>
          </div>
        </div>
        {o.kind !== 'recurring' && paid > 0 && (
          <div className="mt-3">
            <div className="h-1.5 rounded-full bg-raised overflow-hidden">
              <div className={cx('h-full rounded-full', loan ? 'bg-info' : 'bg-pos')} style={{ width: `${progress}%` }} />
            </div>
            <div className="text-muted text-[12px] mt-1">
              <Amount cents={paid} /> réglé sur <Amount cents={o.amountCents} /> ({progress} %)
            </div>
          </div>
        )}
      </button>
      <div className="flex gap-2 mt-3">
        {o.status === 'open' ? (
          <>
            <button className="btn-primary h-9 px-3 text-[14px]" onClick={() => openSheet({ kind: 'settle', id: o.id })}>
              {loan ? 'Encaisser' : 'Payer'}
            </button>
            <button className="btn-ghost h-9 px-2.5 text-[13px]" onClick={() => void attempt(() => setObligationStatus(o.id, 'cancelled'), 'Annulé')}>
              <Ban size={15} /> Annuler
            </button>
          </>
        ) : (
          <button className="btn-ghost h-9 px-2 text-[13px] -ml-2" onClick={() => void attempt(() => setObligationStatus(o.id, 'open'), 'Rouvert')}>
            <RotateCcw size={15} /> Rouvrir
          </button>
        )}
      </div>
    </div>
  );
}

export default function Obligations() {
  const obligations = useApp((s) => s.data.obligations);
  const txs = useApp((s) => s.data.transactions);
  const [tab, setTab] = useState<Tab>('all');
  const [status, setStatus] = useState<StatusF>('open');

  const totals = useMemo(() => {
    let toPay = 0, loans = 0, overdue = 0, monthlyRecurring = 0;
    for (const o of obligations) {
      if (o.status !== 'open') continue;
      const r = obligationRemaining(o, txs);
      if (o.kind === 'loan_given') loans += r;
      else toPay += r;
      if (isOverdue(o)) overdue++;
      if (o.kind === 'recurring') {
        const f = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 }[o.recurrence ?? 'monthly'];
        monthlyRecurring += Math.round(o.amountCents * f);
      }
    }
    return { toPay, loans, overdue, monthlyRecurring };
  }, [obligations, txs]);

  const month = today().slice(0, 7);
  const spentMonth = useMemo(() => flowsInRange(txs.filter((t) => t.type === 'expense' || t.type === 'debt_payment'), month + '-01', today()).outflow, [txs, month]);

  const list = useMemo(
    () =>
      obligations
        .filter((o) => tab === 'all' || o.kind === tab)
        .filter((o) => o.status === status)
        .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999')),
    [obligations, tab, status],
  );
  const spent = useMemo(() => txs.filter((t) => t.type === 'expense' || t.type === 'debt_payment').sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 100), [txs]);

  return (
    <div>
      <PageHeader
        title="Dépenses & dettes"
        subtitle="Échéances, dettes, prêts et charges récurrentes"
        actions={
          <button className="btn-primary h-10 px-3 hidden sm:inline-flex" onClick={() => openSheet({ kind: 'obligation', obKind: tab !== 'all' && tab !== 'spent' ? tab : 'upcoming' })}>
            <Plus size={18} /> Ajouter
          </button>
        }
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="À payer" sub={totals.overdue ? <span className="text-neg">{totals.overdue} en retard</span> : 'Échéances ouvertes'}>
          <Amount cents={totals.toPay} />
        </Stat>
        <Stat label="Argent prêté" sub="À me rembourser">
          <Amount cents={totals.loans} />
        </Stat>
        <Stat label="Charges récurrentes" sub="Équivalent mensuel">
          <Amount cents={totals.monthlyRecurring} />
        </Stat>
        <Stat label="Dépensé ce mois-ci" sub="Dépenses + échéances payées">
          <Amount cents={spentMonth} />
        </Stat>
      </div>

      <button className="btn-primary w-full mt-4 sm:hidden" onClick={() => openSheet({ kind: 'obligation', obKind: tab !== 'all' && tab !== 'spent' ? tab : 'upcoming' })}>
        <Plus size={18} /> Ajouter
      </button>

      <Chips
        className="mt-5"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'all', label: 'Tout' },
          { value: 'upcoming', label: 'Paiements à venir' },
          { value: 'debt', label: 'Dettes' },
          { value: 'loan_given', label: 'Prêts accordés' },
          { value: 'recurring', label: 'Récurrentes' },
          { value: 'spent', label: 'Dépenses réalisées' },
        ]}
      />
      {tab !== 'spent' && (
        <div className="flex gap-2 mt-3">
          {(['open', 'paid', 'cancelled'] as StatusF[]).map((s) => (
            <button key={s} className={cx('chip h-8 text-[13px]', status === s && 'chip-on')} onClick={() => setStatus(s)}>
              {s === 'open' ? 'Ouverts' : s === 'paid' ? 'Soldés' : 'Annulés'}
            </button>
          ))}
        </div>
      )}

      {tab === 'spent' ? (
        spent.length ? (
          <>
            <div className="card divide-y divide-line/70 mt-4 overflow-hidden">
              {spent.map((t) => (
                <TxRow key={t.id} tx={t} />
              ))}
            </div>
            <button className="btn-secondary w-full mt-3" onClick={() => openSheet({ kind: 'tx', type: 'expense' })}>
              <Plus size={18} /> Nouvelle dépense
            </button>
          </>
        ) : (
          <div className="mt-4">
            <Empty icon={<Receipt size={22} />} title="Aucune dépense" text="Les dépenses réalisées et les échéances payées apparaîtront ici." action={<button className="btn-primary" onClick={() => openSheet({ kind: 'tx', type: 'expense' })}><Plus size={18} /> Ajouter une dépense</button>} />
          </div>
        )
      ) : list.length ? (
        <div className="grid md:grid-cols-2 gap-3 mt-4">
          {list.map((o) => (
            <ObligationCard key={o.id} o={o} />
          ))}
        </div>
      ) : (
        <div className="mt-4">
          <Empty icon={<CalendarClock size={22} />} title="Rien à afficher" text="Ajoutez vos paiements à venir, dettes, charges récurrentes ou l’argent prêté pour anticiper votre trésorerie." />
        </div>
      )}
    </div>
  );
}
