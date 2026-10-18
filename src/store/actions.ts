import type {
  Account, AccountKind, Category, CategoryKind, Cents, ISODate, Obligation, PendingPayment, PendingStatus,
  Product, Transaction, TxType,
} from '../types';
import { commit, findLive, getState, put, softDelete, uid } from './store';
import type { Change } from '../db/db';
import { accountBalances, live, nextRecurrence, obligationPaidCents } from '../lib/calc';
import { today } from '../lib/dates';
import { mulCents } from '../lib/money';

const now = () => Date.now();
const base = () => ({ id: uid(), createdAt: now(), updatedAt: now() });

export class ActionError extends Error {}

function makeTx(p: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>): Transaction {
  return { ...base(), ...p };
}

// ============ Seed (premier lancement) ============

export const DEFAULT_ACCOUNTS: [string, AccountKind][] = [
  ['Espèces', 'cash'],
  ['Compte principal', 'bank'],
  ['Compte secondaire', 'bank'],
  ['PayPal', 'paypal'],
  ['Revolut', 'revolut'],
  ['Autres comptes', 'other'],
];
export const DEFAULT_TX_CATEGORIES = ['Salaire', 'Ventes', 'Alimentation', 'Logement', 'Transport', 'Abonnements', 'Loisirs', 'Santé', 'Frais de port', 'Marchandises', 'Impôts', 'Divers'];
export const DEFAULT_PRODUCT_CATEGORIES = ['Cartes à collectionner', 'Vêtements', 'Électronique', 'Jeux vidéo', 'Livres', 'Divers'];
export const DEFAULT_PLATFORMS = ['Vinted', 'eBay', 'Leboncoin', 'Cardmarket', 'Viagogo', 'Main propre', 'Autre'];
/** Plateformes ajoutées après la première version : ajoutées aux installations existantes */
const ADDED_PLATFORMS = ['Viagogo'];

export function seedChanges(): Change[] {
  const raw = getState().raw;
  const s = { accounts: live(raw.accounts), categories: live(raw.categories) };
  const ch: Change[] = [];
  if (s.accounts.length === 0) {
    DEFAULT_ACCOUNTS.forEach(([name, kind], i) => ch.push(put('accounts', { ...base(), name, kind, order: i })));
  }
  if (s.categories.length === 0) {
    const add = (kind: CategoryKind, names: string[]) =>
      names.forEach((name) => ch.push(put('categories', { ...base(), kind, name } as Category)));
    add('transaction', DEFAULT_TX_CATEGORIES);
    add('product', DEFAULT_PRODUCT_CATEGORIES);
    add('platform', DEFAULT_PLATFORMS);
  } else {
    // Ajoute une seule fois les nouvelles plateformes (jamais réajoutées si l'utilisateur les supprime)
    for (const name of ADDED_PLATFORMS) {
      const known = raw.categories.some((c) => c.kind === 'platform' && c.name.toLowerCase() === name.toLowerCase());
      if (!known) ch.push(put('categories', { ...base(), kind: 'platform', name } as Category));
    }
  }
  return ch;
}

// ============ Comptes ============

export async function addAccount(name: string, kind: AccountKind, initialCents: Cents, date: ISODate = today()) {
  const accs = live(getState().raw.accounts);
  const acc: Account = { ...base(), name: name.trim(), kind, order: accs.length ? Math.max(...accs.map((a) => a.order)) + 1 : 0 };
  const ch: Change[] = [put('accounts', acc)];
  if (initialCents) {
    ch.push(put('transactions', makeTx({ type: 'adjustment', date, amountCents: initialCents, accountId: acc.id, category: 'Solde initial', description: 'Solde initial' })));
  }
  await commit(ch);
  return acc;
}

export async function updateAccount(a: Account) {
  await commit([put('accounts', { ...a, name: a.name.trim() })]);
}

export async function reorderAccounts(ids: string[]) {
  const ch: Change[] = [];
  ids.forEach((id, i) => {
    const a = findLive('accounts', id);
    if (a && a.order !== i) ch.push(put('accounts', { ...a, order: i }));
  });
  await commit(ch);
}

/** Supprime le compte et toutes ses transactions (les liens sont défaits). */
export async function deleteAccount(id: string) {
  const s = getState().raw;
  const a = findLive('accounts', id);
  if (!a) return;
  const ch: Change[] = [softDelete('accounts', a)];
  for (const t of live(s.transactions)) {
    if (t.accountId === id || t.toAccountId === id) ch.push(...unlinkTxChanges(t), softDelete('transactions', t));
  }
  await commit(ch);
}

/** Fixe directement le solde d'un compte en créant un ajustement de la différence */
export async function setAccountBalance(id: string, targetCents: Cents, date: ISODate = today()) {
  const s = getState().raw;
  const bal = accountBalances(live(s.accounts), live(s.transactions)).get(id) ?? 0;
  const diff = targetCents - bal;
  if (diff === 0) return;
  await commit([put('transactions', makeTx({ type: 'adjustment', date, amountCents: diff, accountId: id, category: 'Ajustement', description: 'Correction de solde' }))]);
}

export function accountTxCount(id: string) {
  return live(getState().raw.transactions).filter((t) => t.accountId === id || t.toAccountId === id).length;
}

// ============ Transactions ============

export interface TxInput {
  type: TxType;
  date: ISODate;
  amountCents: Cents;
  accountId: string;
  toAccountId?: string;
  category: string;
  description: string;
  platform?: string;
}

function validateTx(t: TxInput) {
  if (!findLive('accounts', t.accountId)) throw new ActionError('Choisissez un compte.');
  if (t.type === 'transfer') {
    if (!t.toAccountId || !findLive('accounts', t.toAccountId)) throw new ActionError('Choisissez le compte de destination.');
    if (t.toAccountId === t.accountId) throw new ActionError('Les deux comptes doivent être différents.');
  }
  if (t.type !== 'adjustment' && t.amountCents <= 0) throw new ActionError('Le montant doit être supérieur à 0.');
  if (t.type === 'adjustment' && t.amountCents === 0) throw new ActionError('Le montant ne peut pas être nul.');
}

export async function addTransaction(t: TxInput) {
  validateTx(t);
  const tx = makeTx({ ...t, toAccountId: t.type === 'transfer' ? t.toAccountId : undefined });
  await commit([put('transactions', tx)]);
  return tx;
}

export async function updateTransaction(t: Transaction) {
  validateTx(t);
  const ch: Change[] = [put('transactions', t)];
  // Garder les montants liés cohérents
  if (t.linkedPendingId) {
    const p = findLive('pending', t.linkedPendingId);
    if (p && p.status === 'received' && (p.amountCents !== t.amountCents || p.resolvedDate !== t.date)) {
      ch.push(put('pending', { ...p, amountCents: Math.abs(t.amountCents), resolvedDate: t.date }));
    }
  }
  if (t.linkedProductId && t.type === 'sale') {
    const pr = findLive('products', t.linkedProductId);
    if (pr && pr.quantity > 0) {
      const unit = Math.round((Math.abs(t.amountCents) + (pr.feesCents || 0)) / pr.quantity);
      ch.push(put('products', { ...pr, actualUnitPriceCents: unit, soldDate: t.date }));
    }
  }
  if (t.linkedProductId && t.type === 'purchase') {
    const pr = findLive('products', t.linkedProductId);
    if (pr && pr.quantity > 0 && pr.purchaseTxId === t.id) {
      ch.push(put('products', { ...pr, unitCostCents: Math.round(Math.abs(t.amountCents) / pr.quantity), purchaseDate: t.date }));
    }
  }
  await commit(ch);
}

/** Changements nécessaires pour défaire les liens d'une transaction supprimée */
function unlinkTxChanges(t: Transaction): Change[] {
  const ch: Change[] = [];
  if (t.linkedPendingId) {
    const p = findLive('pending', t.linkedPendingId);
    if (p && p.receivedTxId === t.id) ch.push(put('pending', { ...p, status: 'pending', receivedTxId: undefined, resolvedDate: undefined }));
  }
  if (t.linkedProductId) {
    const pr = findLive('products', t.linkedProductId);
    if (pr && pr.saleTxId === t.id) ch.push(put('products', { ...pr, status: 'in_stock', saleTxId: undefined, actualUnitPriceCents: undefined, soldDate: undefined }));
    if (pr && pr.purchaseTxId === t.id) ch.push(put('products', { ...pr, purchaseTxId: undefined }));
  }
  if (t.linkedObligationId) {
    const o = findLive('obligations', t.linkedObligationId);
    if (o) {
      if (o.originTxId === t.id) ch.push(put('obligations', { ...o, originTxId: undefined }));
      else if (o.status === 'paid') ch.push(put('obligations', { ...o, status: 'open', closedDate: undefined }));
    }
  }
  return ch;
}

export async function deleteTransaction(id: string) {
  const t = findLive('transactions', id);
  if (!t) return;
  await commit([...unlinkTxChanges(t), softDelete('transactions', t)]);
}

// ============ Argent en attente ============

export type PendingInput = Omit<PendingPayment, 'id' | 'createdAt' | 'updatedAt' | 'receivedTxId' | 'resolvedDate'>;

export async function addPending(p: PendingInput, receiveTo?: { accountId: string; date: ISODate }) {
  if (p.amountCents <= 0) throw new ActionError('Le montant doit être supérieur à 0.');
  const rec: PendingPayment = { ...base(), ...p, status: p.status === 'received' ? 'pending' : p.status };
  await commit([put('pending', rec)]);
  if (p.status === 'received' && receiveTo) await setPendingStatus(rec.id, 'received', receiveTo);
  if (p.status === 'cancelled') await setPendingStatus(rec.id, 'cancelled');
  return rec;
}

export async function updatePending(p: PendingPayment) {
  if (p.amountCents <= 0) throw new ActionError('Le montant doit être supérieur à 0.');
  const ch: Change[] = [put('pending', p)];
  if (p.receivedTxId) {
    const t = findLive('transactions', p.receivedTxId);
    if (t && (t.amountCents !== p.amountCents || t.description !== p.description || t.platform !== p.platform)) {
      ch.push(put('transactions', { ...t, amountCents: p.amountCents, description: p.description, platform: p.platform }));
    }
  }
  await commit(ch);
}

/**
 * Change le statut. Passer à « reçu » crée une transaction vers le compte choisi
 * (le montant quitte l'attente et entre en liquidités, sans double comptage).
 * Quitter « reçu » supprime cette transaction.
 */
export async function setPendingStatus(id: string, status: PendingStatus, receive?: { accountId: string; date: ISODate }) {
  const p = findLive('pending', id);
  if (!p) return;
  const ch: Change[] = [];
  let next: PendingPayment = { ...p, status };
  if (p.status === 'received' && status !== 'received' && p.receivedTxId) {
    const t = findLive('transactions', p.receivedTxId);
    if (t) ch.push(softDelete('transactions', t));
    next.receivedTxId = undefined;
  }
  if (status === 'received') {
    if (p.status === 'received') return;
    if (!receive || !findLive('accounts', receive.accountId)) throw new ActionError('Choisissez le compte qui reçoit le paiement.');
    const tx = makeTx({
      type: 'payment_received', date: receive.date, amountCents: p.amountCents, accountId: receive.accountId,
      category: 'Ventes', description: p.description || `Paiement ${p.platform}`, platform: p.platform, linkedPendingId: p.id,
      linkedProductId: p.productId,
    });
    ch.push(put('transactions', tx));
    next = { ...next, receivedTxId: tx.id, resolvedDate: receive.date };
  } else if (status === 'cancelled') {
    next.resolvedDate = today();
  } else {
    next.resolvedDate = undefined;
  }
  ch.push(put('pending', next));
  await commit(ch);
}

export async function deletePending(id: string) {
  const p = findLive('pending', id);
  if (!p) return;
  const ch: Change[] = [softDelete('pending', p)];
  if (p.receivedTxId) {
    const t = findLive('transactions', p.receivedTxId);
    if (t) ch.push(put('transactions', { ...t, linkedPendingId: undefined }));
  }
  if (p.productId) {
    const pr = findLive('products', p.productId);
    if (pr && pr.salePendingId === p.id) ch.push(put('products', { ...pr, salePendingId: undefined }));
  }
  await commit(ch);
}

// ============ Stock ============

export type ProductInput = Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'purchaseTxId' | 'saleTxId' | 'salePendingId'>;

function validateProduct(p: ProductInput) {
  if (!p.name.trim()) throw new ActionError('Indiquez un nom.');
  if (!Number.isInteger(p.quantity) || p.quantity < 1) throw new ActionError('La quantité doit être un entier ≥ 1.');
  if (p.unitCostCents < 0 || p.estUnitPriceCents < 0 || p.feesCents < 0) throw new ActionError('Les montants ne peuvent pas être négatifs.');
}

/** Ajoute un produit ; s'il a été payé depuis un compte suivi, crée l'achat (liquidités → stock). */
export async function addProduct(p: ProductInput, paidFrom?: string) {
  validateProduct(p);
  const prod: Product = { ...base(), ...p, name: p.name.trim() };
  const ch: Change[] = [];
  const cost = mulCents(p.unitCostCents, p.quantity);
  if (paidFrom && cost > 0) {
    const tx = makeTx({ type: 'purchase', date: p.purchaseDate, amountCents: cost, accountId: paidFrom, category: 'Marchandises', description: `Achat : ${prod.name}${p.quantity > 1 ? ` ×${p.quantity}` : ''}`, platform: p.platform, linkedProductId: prod.id });
    prod.purchaseTxId = tx.id;
    ch.push(put('transactions', tx));
  }
  ch.push(put('products', prod));
  await commit(ch);
  return prod;
}

export async function updateProduct(p: Product) {
  validateProduct(p);
  const ch: Change[] = [put('products', { ...p, name: p.name.trim() })];
  if (p.purchaseTxId) {
    const t = findLive('transactions', p.purchaseTxId);
    const cost = mulCents(p.unitCostCents, p.quantity);
    if (t && (t.amountCents !== cost || t.date !== p.purchaseDate)) ch.push(put('transactions', { ...t, amountCents: cost, date: p.purchaseDate }));
  }
  await commit(ch);
}

export async function deleteProduct(id: string, alsoDeletePurchase: boolean) {
  const p = findLive('products', id);
  if (!p) return;
  const ch: Change[] = [softDelete('products', p)];
  for (const tid of [p.purchaseTxId, p.saleTxId]) {
    const t = findLive('transactions', tid);
    if (!t) continue;
    if (tid === p.purchaseTxId && alsoDeletePurchase) ch.push(softDelete('transactions', t));
    else ch.push(put('transactions', { ...t, linkedProductId: undefined }));
  }
  const pend = findLive('pending', p.salePendingId);
  if (pend) ch.push(put('pending', { ...pend, productId: undefined }));
  await commit(ch);
}

export type SaleDestination =
  | { kind: 'account'; accountId: string }
  | { kind: 'pending'; expectedDate?: ISODate; status?: 'pending' | 'blocked' }
  | { kind: 'none' };

export interface SaleInput {
  quantity: number;
  unitPriceCents: Cents;
  feesCents: Cents;
  date: ISODate;
  platform?: string;
  destination: SaleDestination;
}

/**
 * Vend tout ou partie d'une ligne de stock. En cas de vente partielle, la ligne
 * est scindée : la partie vendue devient une nouvelle ligne « vendu ».
 * Le montant net (prix − frais) va soit sur un compte, soit en attente.
 */
export async function sellProduct(id: string, s: SaleInput) {
  const p = findLive('products', id);
  if (!p) return;
  if (p.status === 'sold') throw new ActionError('Ce produit est déjà vendu.');
  if (!Number.isInteger(s.quantity) || s.quantity < 1 || s.quantity > p.quantity) throw new ActionError(`Quantité entre 1 et ${p.quantity}.`);
  if (s.unitPriceCents < 0 || s.feesCents < 0) throw new ActionError('Montants invalides.');
  const ch: Change[] = [];
  let sold: Product;
  const partial = s.quantity < p.quantity;
  // Les frais estimés de la ligne d'origine sont répartis au prorata
  const remainingFees = partial ? Math.round(((p.feesCents || 0) * (p.quantity - s.quantity)) / p.quantity) : 0;
  if (partial) {
    // La ligne est scindée : l'achat d'origine n'est plus synchronisable avec une seule ligne
    ch.push(put('products', { ...p, quantity: p.quantity - s.quantity, feesCents: remainingFees, purchaseTxId: undefined }));
    const pt = findLive('transactions', p.purchaseTxId);
    if (pt) ch.push(put('transactions', { ...pt, linkedProductId: undefined }));
    sold = { ...p, ...base(), quantity: s.quantity, purchaseTxId: undefined };
  } else {
    sold = { ...p };
  }
  sold = { ...sold, status: 'sold', actualUnitPriceCents: s.unitPriceCents, feesCents: s.feesCents, soldDate: s.date, platform: s.platform || p.platform };
  const net = mulCents(s.unitPriceCents, s.quantity) - s.feesCents;
  const label = `Vente : ${p.name}${s.quantity > 1 ? ` ×${s.quantity}` : ''}`;
  if (s.destination.kind === 'account') {
    if (!findLive('accounts', s.destination.accountId)) throw new ActionError('Choisissez un compte.');
    if (net > 0) {
      const tx = makeTx({ type: 'sale', date: s.date, amountCents: net, accountId: s.destination.accountId, category: 'Ventes', description: label, platform: sold.platform, linkedProductId: sold.id });
      sold.saleTxId = tx.id;
      ch.push(put('transactions', tx));
    }
  } else if (s.destination.kind === 'pending' && net > 0) {
    const pend: PendingPayment = { ...base(), amountCents: net, platform: sold.platform || 'Autre', description: label, saleDate: s.date, expectedDate: s.destination.expectedDate, status: s.destination.status ?? 'pending', productId: sold.id };
    sold.salePendingId = pend.id;
    ch.push(put('pending', pend));
  }
  ch.push(put('products', sold));
  await commit(ch);
}

/** Annule une vente : l'article revient en stock, l'encaissement lié est supprimé. */
export async function cancelSale(id: string) {
  const p = findLive('products', id);
  if (!p || p.status !== 'sold') return;
  const ch: Change[] = [];
  const t = findLive('transactions', p.saleTxId);
  if (t) ch.push(softDelete('transactions', t));
  const pend = findLive('pending', p.salePendingId);
  if (pend) {
    ch.push(softDelete('pending', pend));
    const rt = findLive('transactions', pend.receivedTxId);
    if (rt) ch.push(softDelete('transactions', rt));
  }
  ch.push(put('products', { ...p, status: 'in_stock', actualUnitPriceCents: undefined, soldDate: undefined, saleTxId: undefined, salePendingId: undefined, feesCents: 0 }));
  await commit(ch);
}

// ============ Dépenses, dettes, prêts ============

export type ObligationInput = Omit<Obligation, 'id' | 'createdAt' | 'updatedAt' | 'originTxId' | 'closedDate' | 'status'>;

/**
 * - loan_given + compte : l'argent prêté sort du compte (liquidités → créance)
 * - debt + compte : l'argent emprunté arrive sur le compte (liquidités + / dette +)
 */
export async function addObligation(o: ObligationInput, originAccountId?: string) {
  if (!o.label.trim()) throw new ActionError('Indiquez un libellé.');
  if (o.amountCents <= 0) throw new ActionError('Le montant doit être supérieur à 0.');
  if (o.paidCents < 0 || o.paidCents > o.amountCents) throw new ActionError('Le montant déjà réglé est invalide.');
  if (o.kind === 'recurring' && (!o.recurrence || !o.dueDate)) throw new ActionError('Indiquez la fréquence et la prochaine échéance.');
  const ob: Obligation = { ...base(), ...o, label: o.label.trim(), status: 'open' };
  const ch: Change[] = [];
  if (originAccountId && (o.kind === 'loan_given' || o.kind === 'debt')) {
    const tx = makeTx({
      type: o.kind === 'loan_given' ? 'loan_out' : 'borrow', date: o.startDate, amountCents: o.amountCents - o.paidCents,
      accountId: originAccountId, category: o.kind === 'loan_given' ? 'Prêt accordé' : 'Emprunt',
      description: `${o.kind === 'loan_given' ? 'Prêt à' : 'Emprunt auprès de'} ${o.counterparty || ob.label}`, linkedObligationId: ob.id,
    });
    ob.originTxId = tx.id;
    ch.push(put('transactions', tx));
  }
  ch.push(put('obligations', ob));
  await commit(ch);
  return ob;
}

export async function updateObligation(o: Obligation) {
  if (!o.label.trim()) throw new ActionError('Indiquez un libellé.');
  if (o.amountCents <= 0) throw new ActionError('Le montant doit être supérieur à 0.');
  await commit([put('obligations', { ...o, label: o.label.trim() })]);
}

/**
 * Règle une échéance / rembourse une dette (sortie d'argent) ou encaisse le
 * remboursement d'un prêt accordé (entrée d'argent).
 */
export async function settleObligation(id: string, p: { amountCents: Cents; accountId: string; date: ISODate }) {
  const o = findLive('obligations', id);
  if (!o || o.status !== 'open') return;
  if (p.amountCents <= 0) throw new ActionError('Le montant doit être supérieur à 0.');
  if (!findLive('accounts', p.accountId)) throw new ActionError('Choisissez un compte.');
  const txs = live(getState().raw.transactions);
  const isLoan = o.kind === 'loan_given';
  const tx = makeTx({
    type: isLoan ? 'loan_repaid' : 'debt_payment', date: p.date, amountCents: p.amountCents, accountId: p.accountId,
    category: isLoan ? 'Remboursement reçu' : o.category || 'Divers', description: isLoan ? `Remboursement de ${o.counterparty || o.label}` : o.label,
    linkedObligationId: o.id,
  });
  const ch: Change[] = [put('transactions', tx)];
  if (o.kind === 'recurring') {
    ch.push(put('obligations', { ...o, dueDate: nextRecurrence(o.dueDate ?? p.date, o.recurrence ?? 'monthly') }));
  } else {
    const remaining = o.amountCents - obligationPaidCents(o, txs) - p.amountCents;
    if (remaining <= 0) ch.push(put('obligations', { ...o, status: 'paid', closedDate: p.date }));
  }
  await commit(ch);
}

export async function setObligationStatus(id: string, status: Obligation['status']) {
  const o = findLive('obligations', id);
  if (!o) return;
  await commit([put('obligations', { ...o, status, closedDate: status === 'open' ? undefined : today() })]);
}

export async function deleteObligation(id: string) {
  const o = findLive('obligations', id);
  if (!o) return;
  const ch: Change[] = [softDelete('obligations', o)];
  for (const t of live(getState().raw.transactions)) {
    if (t.linkedObligationId === id) ch.push(put('transactions', { ...t, linkedObligationId: undefined }));
  }
  await commit(ch);
}

// ============ Catégories ============

export async function addCategory(kind: CategoryKind, name: string) {
  const n = name.trim();
  if (!n) throw new ActionError('Nom vide.');
  const exists = live(getState().raw.categories).some((c) => c.kind === kind && c.name.toLowerCase() === n.toLowerCase());
  if (exists) throw new ActionError('Cette catégorie existe déjà.');
  await commit([put('categories', { ...base(), kind, name: n } as Category)]);
}

export async function renameCategory(id: string, name: string) {
  const c = findLive('categories', id);
  if (!c) return;
  const n = name.trim();
  if (!n || n === c.name) return;
  const s = getState().raw;
  const ch: Change[] = [put('categories', { ...c, name: n })];
  // Propage le nouveau nom aux enregistrements
  if (c.kind === 'transaction') {
    live(s.transactions).filter((t) => t.category === c.name).forEach((t) => ch.push(put('transactions', { ...t, category: n })));
    live(s.obligations).filter((o) => o.category === c.name).forEach((o) => ch.push(put('obligations', { ...o, category: n })));
  } else if (c.kind === 'product') {
    live(s.products).filter((p) => p.category === c.name).forEach((p) => ch.push(put('products', { ...p, category: n })));
  } else {
    live(s.pending).filter((p) => p.platform === c.name).forEach((p) => ch.push(put('pending', { ...p, platform: n })));
    live(s.transactions).filter((t) => t.platform === c.name).forEach((t) => ch.push(put('transactions', { ...t, platform: n })));
    live(s.products).filter((p) => p.platform === c.name).forEach((p) => ch.push(put('products', { ...p, platform: n })));
  }
  await commit(ch);
}

export async function deleteCategory(id: string) {
  const c = findLive('categories', id);
  if (!c) return;
  await commit([softDelete('categories', c)]);
}
