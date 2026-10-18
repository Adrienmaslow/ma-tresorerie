// Tous les montants sont des entiers en centimes d'euro (Cents).
export type Cents = number;
/** Date civile au format AAAA-MM-JJ */
export type ISODate = string;

/** Champs communs à tout enregistrement synchronisable */
export interface BaseRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  /** Suppression logique (nécessaire à la synchronisation entre appareils) */
  deleted?: boolean;
}

export type AccountKind = 'cash' | 'bank' | 'paypal' | 'revolut' | 'other';

export interface Account extends BaseRecord {
  name: string;
  kind: AccountKind;
  order: number;
  archived?: boolean;
}

export type TxType =
  | 'income' // Entrée d'argent
  | 'expense' // Sortie d'argent / dépense réalisée
  | 'transfer' // Transfert entre comptes (neutre sur la trésorerie)
  | 'payment_received' // Paiement en attente reçu
  | 'purchase' // Achat de marchandises (liquidités → stock)
  | 'sale' // Vente réalisée encaissée directement
  | 'loan_out' // Argent prêté (liquidités → créance)
  | 'loan_repaid' // Remboursement reçu d'un prêt
  | 'borrow' // Argent emprunté (liquidités + / dette +)
  | 'debt_payment' // Paiement d'une échéance, dette ou charge
  | 'adjustment'; // Correction de solde (signée)

export interface Transaction extends BaseRecord {
  type: TxType;
  date: ISODate;
  /** Montant positif, sauf pour 'adjustment' où il est signé */
  amountCents: Cents;
  accountId: string;
  /** Compte destination (transferts uniquement) */
  toAccountId?: string;
  category: string;
  description: string;
  platform?: string;
  linkedPendingId?: string;
  linkedProductId?: string;
  linkedObligationId?: string;
}

export type PendingStatus = 'pending' | 'blocked' | 'dispute' | 'received' | 'cancelled';

export interface PendingPayment extends BaseRecord {
  amountCents: Cents;
  platform: string;
  description: string;
  saleDate: ISODate;
  expectedDate?: ISODate;
  status: PendingStatus;
  /** Date à laquelle il est devenu reçu/annulé */
  resolvedDate?: ISODate;
  receivedTxId?: string;
  productId?: string;
}

export type ProductStatus = 'in_stock' | 'reserved' | 'sold';

export interface Product extends BaseRecord {
  name: string;
  category: string;
  quantity: number;
  unitCostCents: Cents;
  estUnitPriceCents: Cents;
  /** Prix de vente réel unitaire (une fois vendu) */
  actualUnitPriceCents?: Cents;
  /** Frais (commission, port…) pour la ligne */
  feesCents: Cents;
  status: ProductStatus;
  purchaseDate: ISODate;
  soldDate?: ISODate;
  platform?: string;
  purchaseTxId?: string;
  saleTxId?: string;
  salePendingId?: string;
  notes?: string;
}

export type ObligationKind = 'upcoming' | 'debt' | 'loan_given' | 'recurring';
export type ObligationStatus = 'open' | 'paid' | 'cancelled';
export type Recurrence = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface Obligation extends BaseRecord {
  kind: ObligationKind;
  label: string;
  counterparty?: string;
  /** Montant initial (ou montant d'une échéance pour les charges récurrentes) */
  amountCents: Cents;
  /** Déjà réglé (dettes / prêts remboursés partiellement) */
  paidCents: Cents;
  dueDate?: ISODate;
  startDate: ISODate;
  status: ObligationStatus;
  recurrence?: Recurrence;
  category: string;
  closedDate?: ISODate;
  /** Transaction de création (prêt accordé / emprunt reçu) */
  originTxId?: string;
}

export type CategoryKind = 'transaction' | 'product' | 'platform';

export interface Category extends BaseRecord {
  kind: CategoryKind;
  name: string;
}

export interface Settings {
  hideAmounts: boolean;
  hideOnLaunch: boolean;
  pinHash?: string;
  pinSalt?: string;
  pinIterations?: number;
  /** Longueur du PIN (pour la validation automatique à la saisie) */
  pinLength?: number;
  biometricCredentialId?: string;
  /** minutes d'inactivité/arrière-plan avant verrouillage ; 0 = immédiat */
  autoLockMinutes: number;
  theme: 'dark' | 'light' | 'system';
  lastSyncAt?: number;
  syncEnabled?: boolean;
  onboarded?: boolean;
}

export const STORE_NAMES = ['accounts', 'transactions', 'pending', 'products', 'obligations', 'categories'] as const;
export type StoreName = (typeof STORE_NAMES)[number];

export interface DataState {
  accounts: Account[];
  transactions: Transaction[];
  pending: PendingPayment[];
  products: Product[];
  obligations: Obligation[];
  categories: Category[];
}

export type RecordOf<S extends StoreName> = DataState[S][number];
