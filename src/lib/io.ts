import { STORE_NAMES, type DataState, type Transaction } from '../types';
import { live } from './calc';
import { centsToInput } from './money';
import { TX_TYPE_LABEL } from './labels';

export const EXPORT_FORMAT = 'ma-tresorerie';
export const EXPORT_VERSION = 1;

export function exportJSON(data: DataState): string {
  return JSON.stringify({ format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: new Date().toISOString(), data }, null, 2);
}

export function parseImportJSON(text: string): DataState {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('Fichier JSON illisible.');
  }
  const o = obj as { format?: string; data?: Record<string, unknown> };
  if (o.format !== EXPORT_FORMAT || !o.data) throw new Error('Ce fichier n’est pas une sauvegarde Solde.');
  const out = {} as DataState;
  for (const s of STORE_NAMES) {
    const arr = o.data[s];
    if (!Array.isArray(arr)) throw new Error(`Section « ${s} » manquante.`);
    for (const r of arr) {
      if (!r || typeof r !== 'object' || typeof (r as { id?: unknown }).id !== 'string') throw new Error(`Enregistrement invalide dans « ${s} ».`);
    }
    (out as unknown as Record<string, unknown>)[s] = arr;
  }
  // Contrôle des montants : entiers en centimes
  const ints = (v: unknown) => v === undefined || Number.isInteger(v);
  for (const t of out.transactions) if (!ints(t.amountCents)) throw new Error('Montant non entier détecté (transactions).');
  for (const p of out.pending) if (!ints(p.amountCents)) throw new Error('Montant non entier détecté (attente).');
  for (const p of out.products) if (!ints(p.unitCostCents) || !ints(p.estUnitPriceCents)) throw new Error('Montant non entier détecté (stock).');
  return out;
}

function csvCell(v: unknown): string {
  const s = v === undefined || v === null ? '' : String(v);
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCSV(rows: unknown[][]): string {
  // Séparateur « ; » et BOM UTF-8 pour une ouverture correcte dans Excel (FR)
  return '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
}

export function exportTransactionsCSV(data: DataState): string {
  const accName = new Map(data.accounts.map((a) => [a.id, a.name]));
  const rows: unknown[][] = [['date', 'type', 'montant', 'compte', 'compte_destination', 'categorie', 'plateforme', 'description']];
  for (const t of live(data.transactions).sort((a, b) => a.date.localeCompare(b.date))) {
    rows.push([t.date, TX_TYPE_LABEL[t.type], centsToInput(t.amountCents), accName.get(t.accountId) ?? '', t.toAccountId ? accName.get(t.toAccountId) ?? '' : '', t.category, t.platform ?? '', t.description]);
  }
  return toCSV(rows);
}

export function exportPendingCSV(data: DataState): string {
  const rows: unknown[][] = [['date_vente', 'date_reception_estimee', 'statut', 'montant', 'plateforme', 'description']];
  for (const p of live(data.pending)) rows.push([p.saleDate, p.expectedDate ?? '', p.status, centsToInput(p.amountCents), p.platform, p.description]);
  return toCSV(rows);
}

export function exportStockCSV(data: DataState): string {
  const rows: unknown[][] = [['nom', 'categorie', 'quantite', 'prix_achat_unitaire', 'prix_vente_estime', 'prix_vente_reel', 'frais', 'statut', 'date_achat', 'date_vente']];
  for (const p of live(data.products)) rows.push([p.name, p.category, p.quantity, centsToInput(p.unitCostCents), centsToInput(p.estUnitPriceCents), p.actualUnitPriceCents !== undefined ? centsToInput(p.actualUnitPriceCents) : '', centsToInput(p.feesCents), p.status, p.purchaseDate, p.soldDate ?? '']);
  return toCSV(rows);
}

/** Analyse un CSV (séparateur ; ou ,) avec guillemets */
export function parseCSV(text: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const firstLine = t.split(/\r?\n/)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') {
        if (t[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

export type CsvTxRow = Pick<Transaction, 'date' | 'type' | 'amountCents' | 'category' | 'description' | 'platform'> & { account: string; toAccount?: string };

export function downloadFile(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
