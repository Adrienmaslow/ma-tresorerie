import { parseCSV } from './io';
import { parseEuroToCents } from './money';
import { TX_TYPE_LABEL } from './labels';
import { commit, getState, put, uid } from '../store/store';
import type { Account, Transaction, TxType } from '../types';
import type { Change } from '../db/db';
import { live } from './calc';

const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Importe des transactions depuis un CSV (format de l'export, ou colonnes
 * date ; type ; montant ; compte ; compte_destination ; categorie ; plateforme ; description).
 * Les comptes inconnus sont créés. Renvoie le nombre de lignes importées et les erreurs.
 */
export async function importTransactionsCSV(text: string): Promise<{ imported: number; errors: string[] }> {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('Le fichier ne contient aucune ligne.');
  const header = rows[0].map(norm);
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const iDate = col('date');
  const iType = col('type');
  const iAmount = col('montant', 'amount');
  const iAcc = col('compte', 'account');
  const iTo = col('compte_destination', 'destination');
  const iCat = col('categorie', 'category');
  const iPlat = col('plateforme', 'platform');
  const iDesc = col('description', 'libelle');
  if (iDate < 0 || iAmount < 0 || iAcc < 0) throw new Error('Colonnes requises : date, montant, compte.');

  const typeByLabel = new Map<string, TxType>();
  (Object.keys(TX_TYPE_LABEL) as TxType[]).forEach((t) => {
    typeByLabel.set(norm(TX_TYPE_LABEL[t]), t);
    typeByLabel.set(t, t);
  });

  const accounts = new Map(live(getState().raw.accounts).map((a) => [norm(a.name), a]));
  let order = accounts.size;
  const ch: Change[] = [];
  const errors: string[] = [];
  const getAcc = (name: string): Account => {
    const k = norm(name);
    let a = accounts.get(k);
    if (!a) {
      const n = Date.now();
      a = { id: uid(), createdAt: n, updatedAt: n, name: name.trim(), kind: 'other', order: order++ };
      accounts.set(k, a);
      ch.push(put('accounts', a));
    }
    return a;
  };

  let imported = 0;
  rows.slice(1).forEach((r, idx) => {
    const line = idx + 2;
    const date = (r[iDate] ?? '').trim();
    const dm = date.match(/^(\d{4})-(\d{2})-(\d{2})$/) ?? date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!dm) return errors.push(`Ligne ${line} : date invalide « ${date} »`);
    const iso = dm[1].length === 4 ? date : `${dm[3]}-${dm[2]}-${dm[1]}`;
    const amt = parseEuroToCents(r[iAmount] ?? '');
    if (amt === null || amt === 0) return errors.push(`Ligne ${line} : montant invalide`);
    let type: TxType | undefined = iType >= 0 ? typeByLabel.get(norm(r[iType] ?? '')) : undefined;
    if (!type) type = amt < 0 ? 'expense' : 'income';
    const accName = (r[iAcc] ?? '').trim();
    if (!accName) return errors.push(`Ligne ${line} : compte manquant`);
    const acc = getAcc(accName);
    let toAccountId: string | undefined;
    if (type === 'transfer') {
      const toName = iTo >= 0 ? (r[iTo] ?? '').trim() : '';
      if (!toName) return errors.push(`Ligne ${line} : compte de destination manquant`);
      toAccountId = getAcc(toName).id;
    }
    const n = Date.now();
    const tx: Transaction = {
      id: uid(), createdAt: n, updatedAt: n, type, date: iso,
      amountCents: type === 'adjustment' ? amt : Math.abs(amt),
      accountId: acc.id, toAccountId,
      category: (iCat >= 0 ? r[iCat]?.trim() : '') || 'Divers',
      platform: (iPlat >= 0 ? r[iPlat]?.trim() : '') || undefined,
      description: (iDesc >= 0 ? r[iDesc]?.trim() : '') ?? '',
    };
    ch.push(put('transactions', tx));
    imported++;
  });
  await commit(ch);
  return { imported, errors };
}
