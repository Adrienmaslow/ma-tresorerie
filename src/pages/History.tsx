import { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, ShoppingBag, PackagePlus, Check, HandCoins, Landmark, Receipt, SlidersHorizontal, Search, Clock, X, History as HistoryIcon } from 'lucide-react';
import { useApp } from '../store/store';
import { txNet } from '../lib/calc';
import { Amount, Badge, Chips, Empty, Field, PageHeader, Select, TextInput, cx } from '../components/ui';
import { openSheet } from '../store/ui';
import { PENDING_STATUS_LABEL, TX_TYPE_LABEL } from '../lib/labels';
import { fmtDateLong, periodRange, type PeriodKey, today } from '../lib/dates';
import { useRoute } from '../lib/router';
import type { PendingPayment, Transaction, TxType } from '../types';
import { STATUS_TONE } from './Pending';

const TX_ICON: Record<TxType, typeof ArrowDownLeft> = {
  income: ArrowDownLeft,
  expense: ArrowUpRight,
  transfer: ArrowLeftRight,
  payment_received: Check,
  purchase: PackagePlus,
  sale: ShoppingBag,
  loan_out: HandCoins,
  loan_repaid: HandCoins,
  borrow: Landmark,
  debt_payment: Receipt,
  adjustment: SlidersHorizontal,
};

export function TxRow({ tx }: { tx: Transaction }) {
  const accounts = useApp((s) => s.data.accounts);
  const acc = accounts.find((a) => a.id === tx.accountId)?.name ?? 'Compte supprimé';
  const to = tx.toAccountId ? accounts.find((a) => a.id === tx.toAccountId)?.name : undefined;
  const Icon = TX_ICON[tx.type];
  const net = txNet(tx);
  const tone = tx.type === 'transfer' ? 'bg-info/10 text-info' : net > 0 ? 'bg-pos/10 text-pos' : net < 0 ? 'bg-neg/10 text-neg' : 'bg-raised text-muted';
  return (
    <button type="button" onClick={() => openSheet({ kind: 'tx', id: tx.id })} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-raised/50 transition">
      <span className={cx('h-9 w-9 rounded-xl grid place-items-center shrink-0', tone)}>
        <Icon size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px]">{tx.description || TX_TYPE_LABEL[tx.type]}</span>
        <span className="block text-muted text-[13px] truncate">
          {tx.type === 'transfer' ? `${acc} → ${to ?? '?'}` : `${tx.category} · ${acc}`}
          {tx.platform ? ` · ${tx.platform}` : ''}
        </span>
      </span>
      <Amount cents={tx.type === 'transfer' ? Math.abs(tx.amountCents) : net} sign={tx.type !== 'transfer'} className={cx('font-medium', tx.type === 'transfer' ? 'text-muted' : net > 0 ? 'text-pos' : '')} />
    </button>
  );
}

function PendingRow({ p }: { p: PendingPayment }) {
  return (
    <button type="button" onClick={() => openSheet({ kind: 'pending', id: p.id })} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-raised/50 transition">
      <span className="h-9 w-9 rounded-xl grid place-items-center shrink-0 bg-warn/10 text-warn">
        <Clock size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px]">{p.description || 'Paiement en attente'}</span>
        <span className="block text-muted text-[13px] truncate">{p.platform} · non encaissé</span>
      </span>
      <span className="text-right">
        <Amount cents={p.amountCents} className={cx('block font-medium', p.status === 'cancelled' ? 'text-muted line-through' : 'text-muted')} />
        <Badge tone={STATUS_TONE[p.status]}>{PENDING_STATUS_LABEL[p.status]}</Badge>
      </span>
    </button>
  );
}

type Row = { kind: 'tx'; date: string; key: string; tx: Transaction } | { kind: 'pend'; date: string; key: string; p: PendingPayment };
type StatusF = '' | 'done' | 'pending' | 'blocked' | 'dispute' | 'cancelled';
type TypeF = '' | TxType | 'in' | 'out';

export default function History() {
  const { params } = useRoute();
  const data = useApp((s) => s.data);
  const [period, setPeriod] = useState<PeriodKey>('all');
  const [custom, setCustom] = useState({ from: today().slice(0, 8) + '01', to: today() });
  const [type, setType] = useState<TypeF>('');
  const [status, setStatus] = useState<StatusF>('');
  const [platform, setPlatform] = useState('');
  const [account, setAccount] = useState(params.get('account') ?? '');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [showFilters, setShowFilters] = useState(!!params.get('account'));

  const range = period === 'all' ? null : periodRange(period, custom);
  const platforms = useMemo(() => [...new Set([...data.transactions.map((t) => t.platform), ...data.pending.map((p) => p.platform)].filter(Boolean) as string[])].sort(), [data]);
  const categories = useMemo(() => [...new Set(data.transactions.map((t) => t.category))].sort(), [data.transactions]);

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const out: Row[] = [];
    const inRange = (d: string) => !range || (d >= range.from && d <= range.to);
    if (status === '' || status === 'done') {
      for (const tx of data.transactions) {
        if (!inRange(tx.date)) continue;
        if (type === 'in' && txNet(tx) <= 0) continue;
        if (type === 'out' && (txNet(tx) >= 0 || tx.type === 'transfer')) continue;
        if (type && type !== 'in' && type !== 'out' && tx.type !== type) continue;
        if (platform && tx.platform !== platform) continue;
        if (account && tx.accountId !== account && tx.toAccountId !== account) continue;
        if (category && tx.category !== category) continue;
        if (ql && !`${tx.description} ${tx.category} ${tx.platform ?? ''}`.toLowerCase().includes(ql)) continue;
        out.push({ kind: 'tx', date: tx.date, key: tx.id, tx });
      }
    }
    // Opérations non réalisées (paiements en attente non reçus)
    if (status !== 'done' && !type && !account && !category) {
      for (const p of data.pending) {
        if (p.status === 'received') continue; // déjà représenté par sa transaction
        if (status && p.status !== status) continue;
        if (!inRange(p.saleDate)) continue;
        if (platform && p.platform !== platform) continue;
        if (ql && !`${p.description} ${p.platform}`.toLowerCase().includes(ql)) continue;
        out.push({ kind: 'pend', date: p.saleDate, key: 'p' + p.id, p });
      }
    }
    return out.sort((a, b) => (a.date === b.date ? (b.kind === 'tx' ? b.tx.createdAt : b.p.createdAt) - (a.kind === 'tx' ? a.tx.createdAt : a.p.createdAt) : b.date.localeCompare(a.date)));
  }, [data, range?.from, range?.to, type, status, platform, account, category, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const sums = useMemo(() => {
    let inflow = 0, outflow = 0;
    for (const r of rows) {
      if (r.kind !== 'tx' || r.tx.type === 'transfer' || r.tx.type === 'adjustment') continue;
      const n = txNet(r.tx);
      if (n > 0) inflow += n;
      else outflow -= n;
    }
    return { inflow, outflow };
  }, [rows]);

  const groups = useMemo(() => {
    const g: { date: string; rows: Row[] }[] = [];
    for (const r of rows) {
      const last = g[g.length - 1];
      if (last && last.date === r.date) last.rows.push(r);
      else g.push({ date: r.date, rows: [r] });
    }
    return g;
  }, [rows]);

  const [limit, setLimit] = useState(60);
  let shown = 0;
  const activeFilters = [type, status, platform, account, category].filter(Boolean).length;
  const reset = () => {
    setType('');
    setStatus('');
    setPlatform('');
    setAccount('');
    setCategory('');
    setQ('');
    setPeriod('all');
  };

  return (
    <div>
      <PageHeader title="Historique" subtitle="Toutes vos opérations" />
      <Chips
        value={period}
        onChange={setPeriod}
        options={[
          { value: 'all', label: 'Tout' },
          { value: '7d', label: '7 jours' },
          { value: '30d', label: '30 jours' },
          { value: '3m', label: '3 mois' },
          { value: '1y', label: '1 an' },
          { value: 'custom', label: 'Période…' },
        ]}
      />
      {period === 'custom' && (
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Field label="Du">
            <TextInput type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value || c.from }))} />
          </Field>
          <Field label="Au">
            <TextInput type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value || c.to }))} />
          </Field>
        </div>
      )}
      <div className="flex gap-2 mt-3">
        <div className="relative flex-1">
          <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher" className="pl-10" />
        </div>
        <button className={cx('btn-secondary px-3.5', activeFilters > 0 && 'text-accent')} onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
          <SlidersHorizontal size={18} /> {activeFilters > 0 ? activeFilters : <span className="hidden sm:inline">Filtres</span>}
        </button>
      </div>
      {showFilters && (
        <div className="card p-4 mt-3 grid grid-cols-2 md:grid-cols-5 gap-3 animate-fade-in">
          <Field label="Type">
            <Select value={type} onChange={(v) => setType(v as TypeF)}>
              <option value="">Tous</option>
              <option value="in">Toutes les entrées</option>
              <option value="out">Toutes les sorties</option>
              {(Object.keys(TX_TYPE_LABEL) as TxType[]).map((t) => (
                <option key={t} value={t}>
                  {TX_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Statut">
            <Select value={status} onChange={(v) => setStatus(v as StatusF)}>
              <option value="">Tous</option>
              <option value="done">Réalisées</option>
              <option value="pending">En attente</option>
              <option value="blocked">Bloquées</option>
              <option value="dispute">Litiges</option>
              <option value="cancelled">Annulées</option>
            </Select>
          </Field>
          <Field label="Plateforme">
            <Select value={platform} onChange={setPlatform}>
              <option value="">Toutes</option>
              {platforms.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </Select>
          </Field>
          <Field label="Compte">
            <Select value={account} onChange={setAccount}>
              <option value="">Tous</option>
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Catégorie">
            <Select value={category} onChange={setCategory}>
              <option value="">Toutes</option>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          {activeFilters > 0 && (
            <button className="btn-ghost col-span-2 md:col-span-5 justify-start px-0 h-8" onClick={reset}>
              <X size={16} /> Réinitialiser les filtres
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 mt-4">
        <div className="card px-3 py-2.5">
          <div className="text-muted text-[12px]">Entrées</div>
          <Amount cents={sums.inflow} className="text-pos font-semibold text-[15px]" />
        </div>
        <div className="card px-3 py-2.5">
          <div className="text-muted text-[12px]">Sorties</div>
          <Amount cents={-sums.outflow} className="font-semibold text-[15px]" />
        </div>
        <div className="card px-3 py-2.5">
          <div className="text-muted text-[12px]">Solde net</div>
          <Amount cents={sums.inflow - sums.outflow} sign className="font-semibold text-[15px]" />
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="mt-4">
          <Empty icon={<HistoryIcon size={22} />} title="Aucune opération" text={activeFilters || q || period !== 'all' ? 'Aucun résultat avec ces filtres.' : 'Vos entrées, sorties, transferts, ventes et paiements apparaîtront ici.'} />
        </div>
      ) : (
        <div className="mt-2">
          {groups.map((g) => {
            if (shown >= limit) return null;
            const rowsToShow = g.rows.slice(0, limit - shown);
            shown += rowsToShow.length;
            return (
              <section key={g.date}>
                <h3 className="text-muted text-[13px] font-medium mt-5 mb-2 px-1">{fmtDateLong(g.date)}</h3>
                <div className="card divide-y divide-line/70 overflow-hidden">
                  {rowsToShow.map((r) => (r.kind === 'tx' ? <TxRow key={r.key} tx={r.tx} /> : <PendingRow key={r.key} p={r.p} />))}
                </div>
              </section>
            );
          })}
          {rows.length > limit && (
            <button className="btn-secondary w-full mt-4" onClick={() => setLimit((l) => l + 100)}>
              Afficher plus ({rows.length - limit} restantes)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
