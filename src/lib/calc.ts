/**
 * Calculs financiers. Règles anti double-comptage :
 *  - Le solde d'un compte est dérivé exclusivement des transactions (grand livre).
 *  - Un transfert débite un compte et crédite l'autre : effet nul sur le total.
 *  - Un paiement en attente « reçu » sort de l'attente et entre en liquidités via
 *    une transaction liée : il n'est jamais compté dans les deux.
 *  - Un achat de marchandise transforme des liquidités en stock (valeur au coût).
 *  - Une vente fait sortir l'article du stock et fait entrer le prix de vente
 *    en liquidités ou en attente : seule la marge modifie le total.
 *  - Un prêt accordé transforme des liquidités en créance (comptée « en attente »).
 */
import type {
  Account, Cents, DataState, ISODate, Obligation, PendingPayment, Product, Transaction, TxType,
} from '../types';
import { addDays, addMonths, eachDay, today } from './dates';
import { mulCents, percent } from './money';

export const INFLOW_TYPES: TxType[] = ['income', 'payment_received', 'sale', 'loan_repaid', 'borrow'];
export const OUTFLOW_TYPES: TxType[] = ['expense', 'purchase', 'loan_out', 'debt_payment'];

export function live<T extends { deleted?: boolean }>(arr: T[]): T[] {
  return arr.filter((r) => !r.deleted);
}

/** Effets d'une transaction sur les soldes de comptes */
export function txEffects(tx: Transaction): { accountId: string; delta: Cents }[] {
  const a = Math.abs(tx.amountCents);
  switch (tx.type) {
    case 'transfer':
      return [
        { accountId: tx.accountId, delta: -a },
        ...(tx.toAccountId ? [{ accountId: tx.toAccountId, delta: a }] : []),
      ];
    case 'adjustment':
      return [{ accountId: tx.accountId, delta: tx.amountCents }];
    default:
      return [{ accountId: tx.accountId, delta: INFLOW_TYPES.includes(tx.type) ? a : -a }];
  }
}

/** Variation nette de liquidités totale (0 pour un transfert) */
export function txNet(tx: Transaction): Cents {
  return txEffects(tx).reduce((s, e) => s + e.delta, 0);
}

export function accountBalances(accounts: Account[], txs: Transaction[], upTo?: ISODate): Map<string, Cents> {
  const m = new Map<string, Cents>();
  for (const a of accounts) m.set(a.id, 0);
  for (const tx of txs) {
    if (tx.deleted) continue;
    if (upTo && tx.date > upTo) continue;
    for (const e of txEffects(tx)) {
      if (m.has(e.accountId)) m.set(e.accountId, (m.get(e.accountId) ?? 0) + e.delta);
    }
  }
  return m;
}

// ---------- Obligations ----------

export function obligationPaidCents(o: Obligation, txs: Transaction[], upTo?: ISODate): Cents {
  let s = o.paidCents || 0;
  for (const t of txs) {
    if (t.deleted || t.linkedObligationId !== o.id) continue;
    if (t.id === o.originTxId) continue;
    if (upTo && t.date > upTo) continue;
    if (t.type === 'debt_payment' || t.type === 'loan_repaid') s += Math.abs(t.amountCents);
  }
  return s;
}

/** Reste dû (dette, échéance) ou reste à recevoir (prêt). Pour une charge récurrente : la prochaine échéance. */
export function obligationRemaining(o: Obligation, txs: Transaction[]): Cents {
  if (o.status !== 'open') return 0;
  if (o.kind === 'recurring') return o.amountCents;
  return Math.max(0, o.amountCents - obligationPaidCents(o, txs));
}

export function isOverdue(o: Obligation, ref: ISODate = today()): boolean {
  return o.status === 'open' && !!o.dueDate && o.dueDate < ref;
}

// ---------- Stock ----------

export function productCost(p: Product): Cents {
  return mulCents(p.unitCostCents, p.quantity);
}
export function productEstValue(p: Product): Cents {
  return mulCents(p.estUnitPriceCents, p.quantity);
}
export function productRevenue(p: Product): Cents {
  return mulCents(p.actualUnitPriceCents ?? 0, p.quantity);
}
/** Bénéfice réalisé d'une ligne vendue (prix réel − coût − frais) */
export function productRealizedProfit(p: Product): Cents {
  if (p.status !== 'sold') return 0;
  return productRevenue(p) - productCost(p) - (p.feesCents || 0);
}
/** Bénéfice potentiel d'une ligne non vendue (prix estimé − coût − frais) */
export function productPotentialProfit(p: Product): Cents {
  if (p.status === 'sold') return 0;
  return productEstValue(p) - productCost(p) - (p.feesCents || 0);
}

export interface StockStats {
  costValue: Cents;
  estValue: Cents;
  potentialProfit: Cents;
  realizedProfit: Cents;
  soldRevenue: Cents;
  soldCost: Cents;
  /** Rentabilité réalisée : bénéfice réalisé / coût des articles vendus */
  realizedMarginPct: number | null;
  /** Rentabilité potentielle : bénéfice potentiel / coût du stock */
  potentialMarginPct: number | null;
  unitsInStock: number;
  unitsSold: number;
}

export function stockStats(products: Product[]): StockStats {
  let costValue = 0, estValue = 0, potentialProfit = 0, realizedProfit = 0, soldRevenue = 0, soldCost = 0, unitsInStock = 0, unitsSold = 0;
  for (const p of live(products)) {
    if (p.status === 'sold') {
      realizedProfit += productRealizedProfit(p);
      soldRevenue += productRevenue(p);
      soldCost += productCost(p) + (p.feesCents || 0);
      unitsSold += p.quantity;
    } else {
      costValue += productCost(p);
      estValue += productEstValue(p);
      potentialProfit += productPotentialProfit(p);
      unitsInStock += p.quantity;
    }
  }
  return {
    costValue, estValue, potentialProfit, realizedProfit, soldRevenue, soldCost,
    realizedMarginPct: percent(realizedProfit, soldCost),
    potentialMarginPct: percent(potentialProfit, costValue),
    unitsInStock, unitsSold,
  };
}

// ---------- Attente ----------

export const OPEN_PENDING = ['pending', 'dispute'] as const;

export function isPendingOpen(p: PendingPayment): boolean {
  return p.status === 'pending' || p.status === 'dispute' || p.status === 'blocked';
}

// ---------- Synthèse ----------

export interface Totals {
  liquidity: Cents;
  pending: Cents; // en attente + litiges + prêts accordés
  pendingSales: Cents;
  loansGiven: Cents;
  dispute: Cents;
  blocked: Cents;
  stock: Cents;
  toPay: Cents;
  total: Cents;
  forecast: Cents;
  realizedProfit: Cents;
  overdueCount: number;
  balances: Map<string, Cents>;
}

export function computeTotals(s: DataState): Totals {
  const accounts = live(s.accounts);
  const txs = live(s.transactions);
  const balances = accountBalances(accounts, txs);
  let liquidity = 0;
  for (const a of accounts) liquidity += balances.get(a.id) ?? 0;

  let pendingSales = 0, dispute = 0, blocked = 0;
  for (const p of live(s.pending)) {
    if (p.status === 'pending') pendingSales += p.amountCents;
    else if (p.status === 'dispute') dispute += p.amountCents;
    else if (p.status === 'blocked') blocked += p.amountCents;
  }
  let loansGiven = 0, toPay = 0, overdueCount = 0;
  for (const o of live(s.obligations)) {
    if (o.status !== 'open') continue;
    const r = obligationRemaining(o, txs);
    if (o.kind === 'loan_given') loansGiven += r;
    else toPay += r;
    if (isOverdue(o)) overdueCount++;
  }
  const st = stockStats(s.products);
  const pending = pendingSales + dispute + loansGiven;
  const total = liquidity + pending + blocked + st.costValue;
  const forecast = liquidity + pending + blocked - toPay;
  return {
    liquidity, pending, pendingSales, loansGiven, dispute, blocked,
    stock: st.costValue, toPay, total, forecast,
    realizedProfit: st.realizedProfit, overdueCount, balances,
  };
}

// ---------- Historique reconstruit ----------

export interface HistoryPoint {
  date: ISODate;
  liquidity: Cents;
  receivable: Cents;
  stock: Cents;
  total: Cents;
  profitCum: Cents;
}

/**
 * Reconstruit l'état jour par jour à partir des dates des enregistrements
 * (transactions, dates de vente/réception, dates d'achat/vente du stock, prêts).
 */
export function buildHistory(s: DataState, from: ISODate, to: ISODate): HistoryPoint[] {
  const txs = live(s.transactions);
  const pend = live(s.pending);
  const prods = live(s.products);
  const loans = live(s.obligations).filter((o) => o.kind === 'loan_given');

  // Variation de liquidités par jour + solde avant la période
  const liqDelta = new Map<ISODate, Cents>();
  let liq = 0;
  for (const t of txs) {
    const n = txNet(t);
    if (t.date < from) liq += n;
    else liqDelta.set(t.date, (liqDelta.get(t.date) ?? 0) + n);
  }
  // Bénéfices réalisés cumulés
  const profitDelta = new Map<ISODate, Cents>();
  let profit = 0;
  for (const p of prods) {
    if (p.status !== 'sold' || !p.soldDate) continue;
    const v = productRealizedProfit(p);
    if (p.soldDate < from) profit += v;
    else profitDelta.set(p.soldDate, (profitDelta.get(p.soldDate) ?? 0) + v);
  }

  const days = eachDay(from, to);
  const out: HistoryPoint[] = [];
  for (const d of days) {
    liq += liqDelta.get(d) ?? 0;
    profit += profitDelta.get(d) ?? 0;
    let receivable = 0;
    for (const p of pend) {
      if (p.saleDate > d) continue;
      const open = isPendingOpen(p) || (!!p.resolvedDate && p.resolvedDate > d);
      if (open) receivable += p.amountCents;
    }
    for (const o of loans) {
      if (o.startDate > d) continue;
      if (o.status === 'cancelled' && o.closedDate && o.closedDate <= d) continue;
      receivable += Math.max(0, o.amountCents - obligationPaidCents(o, txs, d));
    }
    let stock = 0;
    for (const p of prods) {
      if (p.purchaseDate > d) continue;
      if (p.status === 'sold' && p.soldDate && p.soldDate <= d) continue;
      stock += productCost(p);
    }
    out.push({ date: d, liquidity: liq, receivable, stock, total: liq + receivable + stock, profitCum: profit });
  }
  return out;
}

/** Échantillonne une série journalière pour limiter le nombre de points */
export function sampleSeries<T>(arr: T[], max = 120): T[] {
  if (arr.length <= max) return arr;
  const step = Math.ceil(arr.length / max);
  const out: T[] = [];
  for (let i = 0; i < arr.length; i += step) out.push(arr[i]);
  if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]);
  return out;
}

export interface MonthFlow {
  month: string; // AAAA-MM
  inflow: Cents;
  outflow: Cents;
  net: Cents;
}

export function monthlyFlows(txs: Transaction[], from: ISODate, to: ISODate): MonthFlow[] {
  const m = new Map<string, MonthFlow>();
  // Initialise tous les mois de la période
  let d = from.slice(0, 7) + '-01';
  let guard = 0;
  while (d.slice(0, 7) <= to.slice(0, 7) && guard++ < 240) {
    const k = d.slice(0, 7);
    m.set(k, { month: k, inflow: 0, outflow: 0, net: 0 });
    const [y, mo] = k.split('-').map(Number);
    d = mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`;
  }
  for (const t of live(txs)) {
    if (t.date < from || t.date > to) continue;
    const f = m.get(t.date.slice(0, 7));
    if (!f) continue;
    const a = Math.abs(t.amountCents);
    if (INFLOW_TYPES.includes(t.type)) f.inflow += a;
    else if (OUTFLOW_TYPES.includes(t.type)) f.outflow += a;
  }
  for (const f of m.values()) f.net = f.inflow - f.outflow;
  return [...m.values()];
}

export function flowsInRange(txs: Transaction[], from: ISODate, to: ISODate) {
  let inflow = 0, outflow = 0;
  for (const t of live(txs)) {
    if (t.date < from || t.date > to) continue;
    const a = Math.abs(t.amountCents);
    if (INFLOW_TYPES.includes(t.type)) inflow += a;
    else if (OUTFLOW_TYPES.includes(t.type)) outflow += a;
  }
  return { inflow, outflow, net: inflow - outflow };
}

export function earliestDate(s: DataState): ISODate | undefined {
  let min: ISODate | undefined;
  const consider = (d?: ISODate) => {
    if (d && (!min || d < min)) min = d;
  };
  live(s.transactions).forEach((t) => consider(t.date));
  live(s.pending).forEach((p) => consider(p.saleDate));
  live(s.products).forEach((p) => consider(p.purchaseDate));
  live(s.obligations).forEach((o) => consider(o.startDate));
  return min;
}

export function nextRecurrence(date: ISODate, r: NonNullable<Obligation['recurrence']>): ISODate {
  switch (r) {
    case 'weekly':
      return addDays(date, 7);
    case 'monthly':
      return addMonths(date, 1);
    case 'quarterly':
      return addMonths(date, 3);
    case 'yearly':
      return addMonths(date, 12);
  }
}
