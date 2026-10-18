import type { AccountKind, ObligationKind, PendingStatus, ProductStatus, Recurrence, TxType } from '../types';

export const TX_TYPE_LABEL: Record<TxType, string> = {
  income: 'Entrée',
  expense: 'Dépense',
  transfer: 'Transfert',
  payment_received: 'Paiement reçu',
  purchase: 'Achat marchandise',
  sale: 'Vente',
  loan_out: 'Prêt accordé',
  loan_repaid: 'Remboursement reçu',
  borrow: 'Emprunt',
  debt_payment: 'Paiement échéance',
  adjustment: 'Ajustement',
};

export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  cash: 'Espèces',
  bank: 'Banque',
  paypal: 'PayPal',
  revolut: 'Revolut',
  other: 'Autre',
};

export const PENDING_STATUS_LABEL: Record<PendingStatus, string> = {
  pending: 'En attente',
  blocked: 'Bloqué',
  dispute: 'Litige',
  received: 'Reçu',
  cancelled: 'Annulé',
};

export const PRODUCT_STATUS_LABEL: Record<ProductStatus, string> = {
  in_stock: 'En stock',
  reserved: 'Réservé',
  sold: 'Vendu',
};

export const OBLIGATION_KIND_LABEL: Record<ObligationKind, string> = {
  upcoming: 'Paiement à venir',
  debt: 'Dette à rembourser',
  loan_given: 'Argent prêté',
  recurring: 'Charge récurrente',
};

export const RECURRENCE_LABEL: Record<Recurrence, string> = {
  weekly: 'Hebdomadaire',
  monthly: 'Mensuelle',
  quarterly: 'Trimestrielle',
  yearly: 'Annuelle',
};
