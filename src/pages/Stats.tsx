import { useMemo, useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import { EyeOff } from 'lucide-react';
import { useApp } from '../store/store';
import { buildHistory, computeTotals, earliestDate, flowsInRange, monthlyFlows, productRealizedProfit, sampleSeries } from '../lib/calc';
import { eachDay, fmtDate, fmtMonth, periodRange, type PeriodKey, today } from '../lib/dates';
import { formatCents, formatCompact } from '../lib/money';
import { Amount, Chips, Field, PageHeader, TextInput, cx, useHidden } from '../components/ui';
import type { Cents } from '../types';

const S = (n: number) => `var(--s${n})`;

function ChartCard({ title, subtitle, children, legend }: { title: string; subtitle?: ReactNode; children: ReactNode; legend?: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="card p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <h3 className="font-semibold">{title}</h3>
          {subtitle && <div className="text-muted text-[13px] mt-0.5">{subtitle}</div>}
        </div>
        {legend && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted">
            {legend.map((l) => (
              <span key={l.label} className="flex items-center gap-1.5">
                <span className="h-[3px] w-3.5 rounded-full" style={{ background: l.color }} />
                {l.label}
              </span>
            ))}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function Tip({ active, payload, label, labelFmt }: TooltipProps<number, string> & { labelFmt?: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl bg-raised border border-line shadow-xl px-3 py-2 text-[13px] min-w-[160px]">
      <div className="text-muted mb-1">{labelFmt ? labelFmt(String(label)) : label}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="tnum font-medium">{formatCents(Number(p.value))}</span>
        </div>
      ))}
    </div>
  );
}

const axis = { tickLine: false, axisLine: false, tick: { fontSize: 11 } } as const;

function HiddenNotice() {
  return (
    <div className="card p-8 flex flex-col items-center text-center text-muted">
      <EyeOff size={22} />
      <p className="mt-2 text-[14px]">Les montants sont masqués. Touchez l’icône œil pour afficher les graphiques.</p>
    </div>
  );
}

export default function Stats() {
  const data = useApp((s) => s.data);
  const hidden = useHidden();
  const [period, setPeriod] = useState<PeriodKey>('30d');
  const [custom, setCustom] = useState({ from: today().slice(0, 8) + '01', to: today() });
  const earliest = useMemo(() => earliestDate(data), [data]);
  const range = periodRange(period, custom, earliest);
  const from = range.from <= range.to ? range.from : range.to;
  const to = range.to;

  const history = useMemo(() => sampleSeries(buildHistory(data, from, to), 120), [data, from, to]);
  const totals = useMemo(() => computeTotals(data), [data]);
  const flows = useMemo(() => monthlyFlows(data.transactions, from, to), [data.transactions, from, to]);
  const flowSum = useMemo(() => flowsInRange(data.transactions, from, to), [data.transactions, from, to]);
  const short = eachDay(from, to).length <= 62;

  const first = history[0];
  const last = history[history.length - 1];

  // Répartition actuelle (part d'un tout)
  const split = useMemo(() => {
    const accs = [...data.accounts].sort((a, b) => a.order - b.order);
    const items: { name: string; value: Cents }[] = [];
    for (const a of accs) {
      const v = totals.balances.get(a.id) ?? 0;
      if (v > 0) items.push({ name: a.name, value: v });
    }
    items.sort((a, b) => b.value - a.value);
    const others = [
      { name: 'En attente', value: totals.pending },
      { name: 'Bloqué', value: totals.blocked },
      { name: 'Stock', value: totals.stock },
    ].filter((x) => x.value > 0);
    // 8 couleurs maximum : les plus petits comptes sont regroupés
    const maxAcc = 8 - others.length - 1;
    let accItems = items;
    if (items.length > maxAcc + 1) {
      const rest = items.slice(maxAcc).reduce((s, x) => s + x.value, 0);
      accItems = [...items.slice(0, maxAcc), { name: 'Autres comptes', value: rest }];
    }
    return [...accItems, ...others];
  }, [data.accounts, totals]);
  const splitTotal = split.reduce((s, x) => s + x.value, 0);

  // Bénéfices réalisés par mois
  const profits = useMemo(() => {
    const m = new Map(flows.map((f) => [f.month, 0]));
    let total = 0;
    for (const p of data.products) {
      if (p.status !== 'sold' || !p.soldDate || p.soldDate < from || p.soldDate > to) continue;
      const v = productRealizedProfit(p);
      total += v;
      const k = p.soldDate.slice(0, 7);
      m.set(k, (m.get(k) ?? 0) + v);
    }
    return { rows: [...m.entries()].map(([month, profit]) => ({ month, profit })), total };
  }, [data.products, flows, from, to]);

  // Dépenses par catégorie
  const byCat = useMemo(() => {
    const m = new Map<string, Cents>();
    for (const t of data.transactions) {
      if (t.date < from || t.date > to) continue;
      if (t.type !== 'expense' && t.type !== 'debt_payment') continue;
      m.set(t.category, (m.get(t.category) ?? 0) + Math.abs(t.amountCents));
    }
    return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [data.transactions, from, to]);
  const maxCat = byCat[0]?.value ?? 0;

  const dayFmt = (d: string) => fmtDate(d);

  return (
    <div>
      <PageHeader title="Statistiques" subtitle={`Du ${fmtDate(from)} au ${fmtDate(to)}`} />
      <Chips
        value={period}
        onChange={setPeriod}
        options={[
          { value: '7d', label: '7 jours' },
          { value: '30d', label: '30 jours' },
          { value: '3m', label: '3 mois' },
          { value: '1y', label: '1 an' },
          { value: 'all', label: 'Tout' },
          { value: 'custom', label: 'Période…' },
        ]}
      />
      {period === 'custom' && (
        <div className="grid grid-cols-2 gap-3 mt-3 max-w-md">
          <Field label="Du">
            <TextInput type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value || c.from }))} />
          </Field>
          <Field label="Au">
            <TextInput type="date" value={custom.to} max={today()} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value || c.to }))} />
          </Field>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
        <div className="card p-4">
          <div className="text-muted text-[13px]">Variation trésorerie</div>
          <Amount cents={(last?.total ?? 0) - (first?.total ?? 0)} sign colored className="text-[20px] font-semibold" />
        </div>
        <div className="card p-4">
          <div className="text-muted text-[13px]">Entrées</div>
          <Amount cents={flowSum.inflow} className="text-[20px] font-semibold" />
        </div>
        <div className="card p-4">
          <div className="text-muted text-[13px]">Sorties</div>
          <Amount cents={flowSum.outflow} className="text-[20px] font-semibold" />
        </div>
        <div className="card p-4">
          <div className="text-muted text-[13px]">Bénéfices réalisés</div>
          <Amount cents={profits.total} sign colored className="text-[20px] font-semibold" />
        </div>
      </div>

      {hidden ? (
        <div className="mt-4">
          <HiddenNotice />
        </div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-3 mt-4">
          <div className="lg:col-span-2">
            <ChartCard
              title="Évolution de la trésorerie"
              subtitle={<>Aujourd’hui : <span className="text-ink font-medium tnum">{formatCents(totals.total)}</span></>}
              legend={[
                { label: 'Total', color: 'rgb(var(--ink))' },
                { label: 'Liquidités', color: S(1) },
                { label: 'À recevoir', color: S(2) },
                { label: 'Stock', color: S(3) },
              ]}
            >
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--grid)" />
                    <XAxis dataKey="date" {...axis} tickFormatter={dayFmt} minTickGap={28} />
                    <YAxis {...axis} width={56} tickFormatter={formatCompact} />
                    <Tooltip content={<Tip labelFmt={dayFmt} />} cursor={{ stroke: 'rgb(var(--muted))', strokeDasharray: '3 3' }} />
                    <Line type="monotone" dataKey="total" name="Total" stroke="rgb(var(--ink))" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="liquidity" name="Liquidités" stroke={S(1)} strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="receivable" name="À recevoir" stroke={S(2)} strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="stock" name="Stock" stroke={S(3)} strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          </div>

          <ChartCard title="Répartition de mon argent" subtitle="Situation actuelle par catégorie">
            {splitTotal <= 0 ? (
              <p className="text-muted text-[14px] py-10 text-center">Aucun actif positif à répartir.</p>
            ) : (
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <div className="h-48 w-48 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={split} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="100%" paddingAngle={1.5} stroke="rgb(var(--surface))" strokeWidth={2} isAnimationActive={false}>
                        {split.map((_, i) => (
                          <Cell key={i} fill={S(i + 1)} />
                        ))}
                      </Pie>
                      <Tooltip content={<Tip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="w-full space-y-1.5 text-[14px]">
                  {split.map((s, i) => (
                    <li key={s.name} className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: S(i + 1) }} />
                      <span className="truncate flex-1">{s.name}</span>
                      <span className="text-muted tnum">{Math.round((s.value / splitTotal) * 100)} %</span>
                      <span className="tnum font-medium w-28 text-right">{formatCents(s.value)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </ChartCard>

          <ChartCard
            title="Liquidités vs argent en attente"
            subtitle={<>Actuellement <span className="tnum text-ink">{formatCents(totals.liquidity)}</span> disponibles, <span className="tnum text-ink">{formatCents(totals.pending + totals.blocked)}</span> à recevoir</>}
            legend={[
              { label: 'Liquidités', color: S(1) },
              { label: 'En attente + bloqué', color: S(2) },
            ]}
          >
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--grid)" />
                  <XAxis dataKey="date" {...axis} tickFormatter={dayFmt} minTickGap={28} />
                  <YAxis {...axis} width={56} tickFormatter={formatCompact} />
                  <Tooltip content={<Tip labelFmt={dayFmt} />} cursor={{ stroke: 'rgb(var(--muted))', strokeDasharray: '3 3' }} />
                  <Line type="monotone" dataKey="liquidity" name="Liquidités" stroke={S(1)} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="receivable" name="En attente + bloqué" stroke={S(2)} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          <ChartCard title="Évolution des bénéfices" subtitle="Bénéfices réalisés cumulés (ventes terminées)">
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--grid)" />
                  <XAxis dataKey="date" {...axis} tickFormatter={dayFmt} minTickGap={28} />
                  <YAxis {...axis} width={56} tickFormatter={formatCompact} />
                  <Tooltip content={<Tip labelFmt={dayFmt} />} cursor={{ stroke: 'rgb(var(--muted))', strokeDasharray: '3 3' }} />
                  <Line type="stepAfter" dataKey="profitCum" name="Bénéfice cumulé" stroke={S(3)} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            {!short && profits.rows.length > 1 && (
              <div className="h-32 mt-3">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={profits.rows} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
                    <XAxis dataKey="month" {...axis} tickFormatter={fmtMonth} />
                    <YAxis {...axis} width={56} tickFormatter={formatCompact} />
                    <Tooltip content={<Tip labelFmt={fmtMonth} />} cursor={{ fill: 'var(--grid)' }} />
                    <Bar dataKey="profit" name="Bénéfice du mois" fill={S(3)} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </ChartCard>

          <ChartCard
            title="Entrées et sorties mensuelles"
            subtitle="Hors transferts et ajustements"
            legend={[
              { label: 'Entrées', color: S(1) },
              { label: 'Sorties', color: S(2) },
            ]}
          >
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={flows} margin={{ top: 6, right: 6, left: 0, bottom: 0 }} barGap={2}>
                  <CartesianGrid vertical={false} stroke="var(--grid)" />
                  <XAxis dataKey="month" {...axis} tickFormatter={fmtMonth} />
                  <YAxis {...axis} width={56} tickFormatter={formatCompact} />
                  <Tooltip content={<Tip labelFmt={fmtMonth} />} cursor={{ fill: 'var(--grid)' }} />
                  <Bar dataKey="inflow" name="Entrées" fill={S(1)} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
                  <Bar dataKey="outflow" name="Sorties" fill={S(2)} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          <ChartCard title="Dépenses par catégorie" subtitle="Dépenses et échéances payées sur la période">
            {byCat.length === 0 ? (
              <p className="text-muted text-[14px] py-10 text-center">Aucune dépense sur la période.</p>
            ) : (
              <ul className="space-y-2.5">
                {byCat.map((c) => (
                  <li key={c.name}>
                    <div className="flex justify-between text-[14px] mb-1">
                      <span className="truncate">{c.name}</span>
                      <span className="tnum font-medium">{formatCents(c.value)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-raised overflow-hidden">
                      <div className={cx('h-full rounded-full')} style={{ width: `${(c.value / maxCat) * 100}%`, background: S(1) }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </ChartCard>
        </div>
      )}
    </div>
  );
}
