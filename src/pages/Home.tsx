import { useMemo } from 'react';
import { Wallet, Clock, Lock, Package, Receipt, TrendingUp, Sparkles, LineChart, ChevronRight, AlertTriangle, BarChart3 } from 'lucide-react';
import { useApp } from '../store/store';
import { buildHistory, computeTotals, isOverdue, obligationRemaining } from '../lib/calc';
import { addDays, daysBetween, fmtDate, fmtDateLong, today } from '../lib/dates';
import { Amount, Badge, Card, SectionTitle, cx, useHidden } from '../components/ui';
import { navigate, href } from '../lib/router';
import { openSheet } from '../store/ui';
import { TxRow } from './History';
import { OBLIGATION_KIND_LABEL } from '../lib/labels';
import type { Cents } from '../types';

function Sparkline({ values }: { values: number[] }) {
  const w = 300, h = 64;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / Math.max(1, values.length - 1)) * w, h - 4 - ((v - min) / span) * (h - 8)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-full">
      <defs>
        <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgb(var(--accent))" stopOpacity={0.3} />
          <stop offset="1" stopColor="rgb(var(--accent))" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${line} L${w} ${h} L0 ${h} Z`} fill="url(#spark)" />
      <path d={line} fill="none" stroke="rgb(var(--accent))" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function StatCard({ icon, label, value, hint, onClick, tone }: { icon: React.ReactNode; label: string; value: Cents; hint?: React.ReactNode; onClick?: () => void; tone: string }) {
  return (
    <Card onClick={onClick} className="p-4 flex flex-col gap-3 min-w-0">
      <div className="flex items-center gap-2.5">
        <span className={cx('h-9 w-9 rounded-full grid place-items-center shrink-0', tone)}>{icon}</span>
        <span className="text-muted text-[13px] leading-tight">{label}</span>
      </div>
      <div className="min-w-0">
        <div className="font-display text-[23px] font-semibold truncate">
          <Amount cents={value} />
        </div>
        {hint && <div className="text-muted text-[12px] mt-0.5 truncate">{hint}</div>}
      </div>
    </Card>
  );
}

export default function Home() {
  const data = useApp((s) => s.data);
  const hidden = useHidden();
  const t = useMemo(() => computeTotals(data), [data]);
  const spark = useMemo(() => buildHistory(data, addDays(today(), -29), today()), [data]);
  const first = spark[0]?.total ?? 0;
  const delta = t.total - first;

  const upcoming = useMemo(() => {
    const items: { id: string; label: string; date?: string; amount: Cents; kind: 'ob' | 'pend'; sub: string; overdue: boolean; out: boolean }[] = [];
    for (const o of data.obligations) {
      if (o.status !== 'open') continue;
      items.push({ id: o.id, label: o.label, date: o.dueDate, amount: obligationRemaining(o, data.transactions), kind: 'ob', sub: OBLIGATION_KIND_LABEL[o.kind], overdue: isOverdue(o), out: o.kind !== 'loan_given' });
    }
    for (const p of data.pending) {
      if (p.status !== 'pending' && p.status !== 'dispute' && p.status !== 'blocked') continue;
      items.push({ id: p.id, label: p.description || p.platform, date: p.expectedDate, amount: p.amountCents, kind: 'pend', sub: p.platform, overdue: !!p.expectedDate && p.expectedDate < today(), out: false });
    }
    return items
      .filter((i) => i.date)
      .sort((a, b) => (a.date! < b.date! ? -1 : 1))
      .slice(0, 5);
  }, [data]);

  const recent = useMemo(() => [...data.transactions].sort((a, b) => (b.date === a.date ? b.createdAt - a.createdAt : b.date.localeCompare(a.date))).slice(0, 5), [data.transactions]);

  // Répartition
  const parts = [
    { key: 'liq', label: 'Liquidités', v: t.liquidity, color: 'var(--s1)' },
    { key: 'pend', label: 'En attente', v: t.pending, color: 'var(--s2)' },
    { key: 'blk', label: 'Bloqué', v: t.blocked, color: 'var(--s4)' },
    { key: 'stk', label: 'Stock', v: t.stock, color: 'var(--s3)' },
  ];
  const positive = parts.filter((p) => p.v > 0);
  const sum = positive.reduce((s, p) => s + p.v, 0);

  return (
    <div>
      <div className="text-muted text-[14px] mb-1">{fmtDateLong(today())}</div>

      {/* Trésorerie totale */}
      <div className="card p-6 md:p-8 relative overflow-hidden">
        <div className="flex items-center gap-2 text-muted text-[14px]">
          <LineChart size={16} /> Trésorerie totale
        </div>
        <div className="font-display text-[46px] md:text-[56px] font-bold leading-[1.05] mt-2">
          <Amount cents={t.total} />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] mt-1">
          {!hidden && spark.length > 1 && (
            <span className={cx('font-medium', delta > 0 ? 'text-pos' : delta < 0 ? 'text-neg' : 'text-muted')}>
              <Amount cents={delta} sign /> sur 30 jours
            </span>
          )}
          <span className="text-muted">
            Prévisionnel : <Amount cents={t.forecast} className="text-ink font-medium" />
          </span>
        </div>
        {!hidden && spark.some((p) => p.total !== 0) && (
          <div className="h-16 -mx-2 mt-3" aria-hidden>
            <Sparkline values={spark.map((p) => p.total)} />
          </div>
        )}
        {sum > 0 && !hidden && (
          <div className="mt-4">
            <div className="flex h-2 rounded-full overflow-hidden gap-[2px]" role="img" aria-label="Répartition de la trésorerie">
              {positive.map((p) => (
                <div key={p.key} style={{ width: `${(p.v / sum) * 100}%`, background: p.color }} />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5 text-[12px] text-muted">
              {positive.map((p) => (
                <span key={p.key} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
                  {p.label} {hidden ? '' : `${Math.round((p.v / sum) * 100)} %`}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Cartes */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
        <StatCard icon={<Wallet size={18} />} tone="bg-raised text-ink/80" label="Liquidités disponibles" value={t.liquidity} hint={`${data.accounts.length} compte${data.accounts.length > 1 ? 's' : ''}`} onClick={() => navigate('accounts')} />
        <StatCard icon={<Clock size={18} />} tone="bg-raised text-ink/80" label="Argent en attente" value={t.pending} hint={t.loansGiven ? <>dont prêts <Amount cents={t.loansGiven} /></> : t.dispute ? <>dont litiges <Amount cents={t.dispute} /></> : 'À recevoir'} onClick={() => navigate('pending')} />
        <StatCard icon={<Lock size={18} />} tone="bg-raised text-ink/80" label="Argent bloqué" value={t.blocked} hint="Temporairement indisponible" onClick={() => navigate('pending', { f: 'blocked' })} />
        <StatCard icon={<Package size={18} />} tone="bg-raised text-ink/80" label="Valeur du stock" value={t.stock} hint="Au prix d’achat" onClick={() => navigate('stock')} />
        <StatCard icon={<Receipt size={18} />} tone="bg-raised text-ink/80" label="Argent à payer" value={t.toPay} hint={t.overdueCount ? <span className="text-neg">{t.overdueCount} en retard</span> : 'Échéances et dettes'} onClick={() => navigate('obligations')} />
        <StatCard icon={<TrendingUp size={18} />} tone="bg-raised text-ink/80" label="Trésorerie prévisionnelle" value={t.forecast} hint="Liquidités + à recevoir − à payer" onClick={() => navigate('stats')} />
        <StatCard icon={<Sparkles size={18} />} tone="bg-raised text-ink/80" label="Bénéfices réalisés" value={t.realizedProfit} hint="Ventes terminées" onClick={() => navigate('stock', { f: 'sold' })} />
        <Card onClick={() => navigate('stats')} className="p-4 flex flex-col justify-between gap-3">
          <span className="h-9 w-9 rounded-xl grid place-items-center bg-raised text-muted">
            <BarChart3 size={18} />
          </span>
          <span className="flex items-center justify-between text-[15px] font-medium">
            Statistiques <ChevronRight size={18} className="text-muted" />
          </span>
        </Card>
      </div>

      {/* Échéances */}
      <SectionTitle action={<a href={href('obligations')} className="text-[13px] text-accent font-medium">Tout voir</a>}>Prochaines échéances</SectionTitle>
      {upcoming.length === 0 ? (
        <div className="card p-5 text-muted text-[14px]">Aucune échéance datée. Ajoutez une date de réception ou d’échéance pour la voir ici.</div>
      ) : (
        <div className="card divide-y divide-line/70">
          {upcoming.map((u) => {
            const d = daysBetween(today(), u.date!);
            return (
              <button key={u.kind + u.id} type="button" onClick={() => openSheet(u.kind === 'ob' ? { kind: 'obligation', id: u.id } : { kind: 'pending', id: u.id })} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-raised/50 transition">
                <span className={cx('h-9 w-9 rounded-xl grid place-items-center shrink-0', u.out ? 'bg-neg/10 text-neg' : 'bg-warn/10 text-warn')}>{u.overdue ? <AlertTriangle size={17} /> : u.out ? <Receipt size={17} /> : <Clock size={17} />}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px]">{u.label}</span>
                  <span className="block text-muted text-[13px] truncate">
                    {u.sub} · {fmtDate(u.date)}
                  </span>
                </span>
                <span className="text-right">
                  <Amount cents={u.out ? -u.amount : u.amount} className={cx('block font-medium', u.out ? 'text-neg' : 'text-ink')} />
                  {u.overdue ? <Badge tone="neg">En retard</Badge> : <span className="text-muted text-[12px]">{d === 0 ? 'Aujourd’hui' : d === 1 ? 'Demain' : `Dans ${d} j`}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Récents */}
      <SectionTitle action={<a href={href('history')} className="text-[13px] text-accent font-medium">Historique</a>}>Opérations récentes</SectionTitle>
      {recent.length === 0 ? (
        <div className="card p-5 text-muted text-[14px]">
          Aucune opération pour l’instant. Commencez par saisir le solde de vos comptes dans <a className="text-accent" href={href('accounts')}>Liquidités</a>, puis utilisez le bouton « + ».
        </div>
      ) : (
        <div className="card divide-y divide-line/70">
          {recent.map((tx) => (
            <TxRow key={tx.id} tx={tx} />
          ))}
        </div>
      )}
    </div>
  );
}
