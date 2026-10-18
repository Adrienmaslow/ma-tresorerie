import { useMemo, useState } from 'react';
import { Plus, Check, Clock, Search, MoreHorizontal, AlertTriangle } from 'lucide-react';
import { useApp } from '../store/store';
import { Amount, Badge, Chips, Empty, PageHeader, Select, Stat, TextInput } from '../components/ui';
import { openSheet, attempt } from '../store/ui';
import { setPendingStatus } from '../store/actions';
import { PENDING_STATUS_LABEL } from '../lib/labels';
import { daysBetween, fmtDate, today } from '../lib/dates';
import { useRoute } from '../lib/router';
import type { PendingPayment, PendingStatus } from '../types';

type Filter = 'open' | PendingStatus | 'all';

export const STATUS_TONE: Record<PendingStatus, 'warn' | 'neutral' | 'neg' | 'pos'> = {
  pending: 'warn',
  blocked: 'neutral',
  dispute: 'neg',
  received: 'pos',
  cancelled: 'neutral',
};

function PendingCard({ p }: { p: PendingPayment }) {
  const [menu, setMenu] = useState(false);
  const late = (p.status === 'pending' || p.status === 'blocked') && p.expectedDate && p.expectedDate < today();
  const d = p.expectedDate ? daysBetween(today(), p.expectedDate) : null;
  const open = p.status === 'pending' || p.status === 'blocked' || p.status === 'dispute';
  const change = (s: PendingStatus) => {
    setMenu(false);
    void attempt(() => setPendingStatus(p.id, s), `Statut : ${PENDING_STATUS_LABEL[s]}`);
  };
  return (
    <div className="card p-4">
      <button type="button" className="w-full text-left flex items-start gap-3" onClick={() => openSheet({ kind: 'pending', id: p.id })}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone={STATUS_TONE[p.status]}>{PENDING_STATUS_LABEL[p.status]}</Badge>
            <span className="text-muted text-[13px]">{p.platform}</span>
          </div>
          <div className="mt-1.5 font-medium truncate">{p.description || 'Sans description'}</div>
          <div className="text-muted text-[13px] mt-0.5">
            Vendu le {fmtDate(p.saleDate)}
            {p.expectedDate && open && (
              <span className={late ? 'text-neg' : ''}>
                {' · '}
                {late ? (
                  <>
                    <AlertTriangle size={12} className="inline -mt-0.5" /> attendu le {fmtDate(p.expectedDate)}
                  </>
                ) : d === 0 ? (
                  'attendu aujourd’hui'
                ) : (
                  `attendu le ${fmtDate(p.expectedDate)}`
                )}
              </span>
            )}
            {p.status === 'received' && p.resolvedDate && ` · reçu le ${fmtDate(p.resolvedDate)}`}
          </div>
        </div>
        <Amount cents={p.amountCents} className="text-[18px] font-semibold" />
      </button>
      {open && (
        <div className="flex gap-2 mt-3 relative">
          <button className="btn-primary h-9 px-3 text-[14px]" onClick={() => openSheet({ kind: 'receive', id: p.id })}>
            <Check size={16} /> Reçu
          </button>
          <button className="btn-secondary h-9 px-3 text-[14px]" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
            <MoreHorizontal size={16} /> Statut
          </button>
          {menu && (
            <div className="absolute z-20 top-11 left-0 card p-1 shadow-xl min-w-[180px] animate-fade-in">
              {(['pending', 'blocked', 'dispute', 'cancelled'] as PendingStatus[])
                .filter((s) => s !== p.status)
                .map((s) => (
                  <button key={s} className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-raised text-[14px]" onClick={() => change(s)}>
                    {PENDING_STATUS_LABEL[s]}
                  </button>
                ))}
            </div>
          )}
        </div>
      )}
      {(p.status === 'received' || p.status === 'cancelled') && (
        <div className="mt-3">
          <button className="btn-ghost h-9 px-2 text-[13px] -ml-2" onClick={() => change('pending')}>
            Repasser en attente
          </button>
        </div>
      )}
    </div>
  );
}

export default function Pending() {
  const { params } = useRoute();
  const pending = useApp((s) => s.data.pending);
  const [filter, setFilter] = useState<Filter>((params.get('f') as Filter) || 'open');
  const [platform, setPlatform] = useState('');
  const [q, setQ] = useState('');

  const totals = useMemo(() => {
    const t = { pending: 0, blocked: 0, dispute: 0, receivedMonth: 0 };
    const m = today().slice(0, 7);
    for (const p of pending) {
      if (p.status === 'pending') t.pending += p.amountCents;
      if (p.status === 'blocked') t.blocked += p.amountCents;
      if (p.status === 'dispute') t.dispute += p.amountCents;
      if (p.status === 'received' && p.resolvedDate?.startsWith(m)) t.receivedMonth += p.amountCents;
    }
    return t;
  }, [pending]);

  const platforms = useMemo(() => [...new Set(pending.map((p) => p.platform))].sort(), [pending]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: pending.length, open: 0 };
    for (const p of pending) {
      c[p.status] = (c[p.status] ?? 0) + 1;
      if (p.status === 'pending' || p.status === 'blocked' || p.status === 'dispute') c.open++;
    }
    return c;
  }, [pending]);

  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return pending
      .filter((p) => (filter === 'all' ? true : filter === 'open' ? ['pending', 'blocked', 'dispute'].includes(p.status) : p.status === filter))
      .filter((p) => !platform || p.platform === platform)
      .filter((p) => !ql || p.description.toLowerCase().includes(ql) || p.platform.toLowerCase().includes(ql))
      .sort((a, b) => (a.expectedDate ?? '9999') .localeCompare(b.expectedDate ?? '9999') || b.saleDate.localeCompare(a.saleDate));
  }, [pending, filter, platform, q]);
  const listTotal = list.reduce((s, p) => s + p.amountCents, 0);

  return (
    <div>
      <PageHeader
        title="En attente"
        subtitle="Encaissements attendus et fonds bloqués"
        actions={
          <button className="btn-primary h-10 px-3 hidden sm:inline-flex" onClick={() => openSheet({ kind: 'pending' })}>
            <Plus size={18} /> Ajouter
          </button>
        }
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="En attente">
          <Amount cents={totals.pending} />
        </Stat>
        <Stat label="Bloqué">
          <Amount cents={totals.blocked} />
        </Stat>
        <Stat label="En litige">
          <Amount cents={totals.dispute} />
        </Stat>
        <Stat label="Reçu ce mois-ci">
          <Amount cents={totals.receivedMonth} />
        </Stat>
      </div>

      <button className="btn-primary w-full mt-4 sm:hidden" onClick={() => openSheet({ kind: 'pending' })}>
        <Plus size={18} /> Ajouter un paiement en attente
      </button>

      <Chips
        className="mt-5"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'open', label: 'À recevoir', count: counts.open },
          { value: 'pending', label: 'En attente', count: counts.pending ?? 0 },
          { value: 'blocked', label: 'Bloqués', count: counts.blocked ?? 0 },
          { value: 'dispute', label: 'Litiges', count: counts.dispute ?? 0 },
          { value: 'received', label: 'Reçus', count: counts.received ?? 0 },
          { value: 'cancelled', label: 'Annulés', count: counts.cancelled ?? 0 },
          { value: 'all', label: 'Tous', count: counts.all },
        ]}
      />
      <div className="flex gap-2 mt-3">
        <div className="relative flex-1">
          <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher" className="pl-10" />
        </div>
        <div className="w-40">
          <Select value={platform} onChange={setPlatform}>
            <option value="">Plateformes</option>
            {platforms.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </Select>
        </div>
      </div>

      {list.length > 0 && (
        <div className="flex justify-between text-[13px] text-muted mt-4 mb-2 px-1">
          <span>{list.length} élément{list.length > 1 ? 's' : ''}</span>
          <span>
            Total : <Amount cents={listTotal} className="text-ink font-medium" />
          </span>
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-3 mt-2">
        {list.map((p) => (
          <PendingCard key={p.id} p={p} />
        ))}
      </div>
      {list.length === 0 && (
        <div className="mt-4">
          <Empty icon={<Clock size={22} />} title="Rien ici" text="Ajoutez les ventes dont vous attendez le paiement, ou les fonds temporairement bloqués sur une plateforme." action={<button className="btn-primary" onClick={() => openSheet({ kind: 'pending' })}><Plus size={18} /> Ajouter</button>} />
        </div>
      )}
    </div>
  );
}
