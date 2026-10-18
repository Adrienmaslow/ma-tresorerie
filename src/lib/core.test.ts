import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { centsToInput, formatCents, parseEuroToCents } from './money';
import { buildHistory, computeTotals, monthlyFlows, stockStats } from './calc';
import { getState, init } from '../store/store';
import * as A from '../store/actions';
import { collectDirty, mergeRemote, runSync, type RemoteRecord, type SyncAdapter, type SyncMeta } from '../sync/engine';
import { hashPin, verifyPin } from './security';
import { exportJSON, parseImportJSON, parseCSV } from './io';
import { addDays, today } from './dates';

describe('money', () => {
  it('parse les saisies françaises sans flottants', () => {
    expect(parseEuroToCents('12')).toBe(1200);
    expect(parseEuroToCents('12,5')).toBe(1250);
    expect(parseEuroToCents('12.05')).toBe(1205);
    expect(parseEuroToCents('1 234,56')).toBe(123456);
    expect(parseEuroToCents('1.234,56')).toBe(123456);
    expect(parseEuroToCents('0,1')).toBe(10);
    expect(parseEuroToCents('-3,20 €')).toBe(-320);
    expect(parseEuroToCents('0.07')).toBe(7);
    expect(parseEuroToCents('abc')).toBeNull();
    expect(parseEuroToCents('12,345,6')).toBeNull();
    expect(parseEuroToCents('')).toBeNull();
  });
  it('formate en euros avec deux décimales', () => {
    expect(formatCents(123456).replace(/\s/g, ' ')).toBe('1 234,56 €');
    expect(formatCents(5).replace(/\s/g, ' ')).toBe('0,05 €');
    expect(centsToInput(-1205)).toBe('-12,05');
  });
  it('évite les erreurs d’arrondi classiques', () => {
    const a = parseEuroToCents('0,1')!;
    const b = parseEuroToCents('0,2')!;
    expect(a + b).toBe(30);
  });
});

describe('logique métier (IndexedDB réelle simulée)', () => {
  let main = '', paypal = '';
  beforeAll(async () => {
    await init(() => A.seedChanges());
    const accs = getState().data.accounts;
    expect(accs.map((a) => a.name)).toEqual(['Espèces', 'Compte principal', 'Compte secondaire', 'PayPal', 'Revolut', 'Autres comptes']);
    expect(getState().data.categories.some((c) => c.kind === 'platform' && c.name === 'Viagogo')).toBe(true);
    main = accs[1].id;
    paypal = accs[3].id;
  });

  const T = () => computeTotals(getState().data);

  it('fixe un solde par ajustement', async () => {
    await A.setAccountBalance(main, 100000);
    expect(T().liquidity).toBe(100000);
    expect(T().total).toBe(100000);
  });

  it('un transfert ne change pas la trésorerie totale', async () => {
    await A.addTransaction({ type: 'transfer', date: today(), amountCents: 25050, accountId: main, toAccountId: paypal, category: 'Divers', description: 'Vers PayPal' });
    expect(T().liquidity).toBe(100000);
    expect(T().balances.get(main)).toBe(74950);
    expect(T().balances.get(paypal)).toBe(25050);
  });

  it('un paiement reçu sort de l’attente sans double comptage', async () => {
    const p = await A.addPending({ amountCents: 4000, platform: 'Vinted', description: 'Veste', saleDate: today(), status: 'pending' });
    expect(T().pending).toBe(4000);
    expect(T().total).toBe(104000);
    await A.setPendingStatus(p.id, 'received', { accountId: paypal, date: today() });
    expect(T().pending).toBe(0);
    expect(T().liquidity).toBe(104000);
    expect(T().total).toBe(104000);
    // retour arrière : la transaction est supprimée
    await A.setPendingStatus(p.id, 'pending');
    expect(T().liquidity).toBe(100000);
    expect(T().pending).toBe(4000);
    await A.setPendingStatus(p.id, 'blocked');
    expect(T().blocked).toBe(4000);
    expect(T().pending).toBe(0);
    await A.deletePending(p.id);
    expect(T().total).toBe(100000);
  });

  it('achat de stock : liquidités → stock, total inchangé', async () => {
    await A.addProduct({ name: 'Carte Pikachu', category: 'Cartes à collectionner', quantity: 4, unitCostCents: 1000, estUnitPriceCents: 2500, feesCents: 0, status: 'in_stock', purchaseDate: today() }, main);
    expect(T().liquidity).toBe(96000);
    expect(T().stock).toBe(4000);
    expect(T().total).toBe(100000);
    const st = stockStats(getState().data.products);
    expect(st.estValue).toBe(10000);
    expect(st.potentialProfit).toBe(6000);
    expect(st.realizedProfit).toBe(0);
  });

  it('vente partielle : seule la marge augmente le total', async () => {
    const p = getState().data.products[0];
    await A.sellProduct(p.id, { quantity: 1, unitPriceCents: 3000, feesCents: 200, date: today(), destination: { kind: 'account', accountId: paypal } });
    const prods = getState().data.products;
    expect(prods).toHaveLength(2);
    expect(prods.find((x) => x.status === 'in_stock')!.quantity).toBe(3);
    expect(T().stock).toBe(3000);
    expect(T().liquidity).toBe(96000 + 2800);
    expect(T().realizedProfit).toBe(1800);
    expect(T().total).toBe(100000 + 1800);
    const st = stockStats(getState().data.products);
    expect(st.realizedMarginPct).toBe(150); // 1800 / (1000+200)
  });

  it('vente vers l’attente puis réception', async () => {
    const p = getState().data.products.find((x) => x.status === 'in_stock')!;
    await A.sellProduct(p.id, { quantity: 3, unitPriceCents: 2000, feesCents: 0, date: today(), destination: { kind: 'pending' } });
    expect(T().stock).toBe(0);
    expect(T().pending).toBe(6000);
    expect(T().total).toBe(100000 + 1800 + 3000);
    const pend = getState().data.pending[0];
    await A.setPendingStatus(pend.id, 'received', { accountId: main, date: today() });
    expect(T().pending).toBe(0);
    expect(T().total).toBe(104800);
    // annulation de la vente : l'article revient, l'argent repart
    const sold = getState().data.products.find((x) => x.salePendingId === pend.id)!;
    await A.cancelSale(sold.id);
    expect(T().stock).toBe(3000);
    expect(T().pending).toBe(0);
    expect(T().total).toBe(101800);
  });

  it('prêt accordé et remboursement', async () => {
    const before = T().total;
    const o = await A.addObligation({ kind: 'loan_given', label: 'Prêt Paul', counterparty: 'Paul', amountCents: 5000, paidCents: 0, startDate: today(), category: 'Divers' }, main);
    expect(T().loansGiven).toBe(5000);
    expect(T().total).toBe(before);
    await A.settleObligation(o.id, { amountCents: 2000, accountId: main, date: today() });
    expect(T().loansGiven).toBe(3000);
    expect(T().total).toBe(before);
    await A.settleObligation(o.id, { amountCents: 3000, accountId: main, date: today() });
    expect(getState().data.obligations.find((x) => x.id === o.id)!.status).toBe('paid');
    expect(T().loansGiven).toBe(0);
    expect(T().total).toBe(before);
  });

  it('dettes, charges récurrentes et prévisionnel', async () => {
    const before = T();
    await A.addObligation({ kind: 'debt', label: 'Dette Marie', amountCents: 10000, paidCents: 2000, startDate: today(), category: 'Divers' });
    const r = await A.addObligation({ kind: 'recurring', label: 'Loyer', amountCents: 60000, paidCents: 0, startDate: today(), dueDate: '2026-01-31', recurrence: 'monthly', category: 'Logement' });
    expect(T().toPay).toBe(8000 + 60000);
    expect(T().forecast).toBe(before.liquidity + before.pending + before.blocked - 68000);
    await A.settleObligation(r.id, { amountCents: 60000, accountId: main, date: today() });
    expect(getState().data.obligations.find((x) => x.id === r.id)!.dueDate).toBe('2026-02-28');
    expect(T().liquidity).toBe(before.liquidity - 60000);
  });

  it('supprimer une transaction liée défait le lien', async () => {
    const p = await A.addPending({ amountCents: 1500, platform: 'eBay', description: 'Jeu', saleDate: today(), status: 'pending' });
    await A.setPendingStatus(p.id, 'received', { accountId: main, date: today() });
    const tx = getState().data.transactions.find((t) => t.linkedPendingId === p.id)!;
    await A.deleteTransaction(tx.id);
    expect(getState().data.pending.find((x) => x.id === p.id)!.status).toBe('pending');
  });

  it('historique reconstruit cohérent avec les totaux du jour', () => {
    const s = getState().data;
    const h = buildHistory(s, addDays(today(), -10), today());
    const last = h[h.length - 1];
    const t = computeTotals(s);
    expect(last.liquidity).toBe(t.liquidity);
    expect(last.stock).toBe(t.stock);
    expect(last.receivable).toBe(t.pending + t.blocked);
    expect(last.total).toBe(t.total);
    expect(last.profitCum).toBe(t.realizedProfit);
    expect(h[0].total).toBe(0);
  });

  it('flux mensuels excluent transferts et ajustements', () => {
    const f = monthlyFlows(getState().data.transactions, today().slice(0, 7) + '-01', today());
    expect(f).toHaveLength(1);
    expect(f[0].inflow).toBeGreaterThan(0);
  });

  it('ajoute Viagogo aux installations existantes une seule fois', async () => {
    const v = getState().data.categories.find((c) => c.kind === 'platform' && c.name === 'Viagogo')!;
    await A.deleteCategory(v.id);
    expect(A.seedChanges()).toHaveLength(0); // supprimée volontairement : pas réajoutée
  });

  it('paiement en attente Viagogo', async () => {
    const p = await A.addPending({ amountCents: 12000, platform: 'Viagogo', description: 'Billets concert', saleDate: today(), status: 'pending' });
    expect(getState().data.pending.find((x) => x.id === p.id)!.platform).toBe('Viagogo');
    await A.deletePending(p.id);
  });

  it('export / import JSON aller-retour', () => {
    const raw = getState().raw;
    const back = parseImportJSON(exportJSON(raw));
    expect(back.transactions.length).toBe(raw.transactions.length);
    expect(() => parseImportJSON('{"x":1}')).toThrow();
  });

  it('suppression de compte supprime ses transactions', async () => {
    const acc = await A.addAccount('Test', 'other', 1234);
    expect(computeTotals(getState().data).balances.get(acc.id)).toBe(1234);
    await A.deleteAccount(acc.id);
    expect(getState().data.accounts.find((a) => a.id === acc.id)).toBeUndefined();
    expect(getState().data.transactions.some((t) => t.accountId === acc.id)).toBe(false);
  });
});

describe('sécurité', () => {
  it('hache et vérifie le PIN sans le stocker', async () => {
    const h = await hashPin('482915');
    expect(JSON.stringify(h)).not.toContain('482915');
    expect(await verifyPin('482915', h.pinHash, h.pinSalt, h.pinIterations)).toBe(true);
    expect(await verifyPin('482916', h.pinHash, h.pinSalt, h.pinIterations)).toBe(false);
  });
});

describe('csv', () => {
  it('parse séparateur ; et guillemets', () => {
    const rows = parseCSV('﻿a;b;c\r\n1;"x;y";"il a dit ""ok"""\r\n');
    expect(rows).toEqual([['a', 'b', 'c'], ['1', 'x;y', 'il a dit "ok"']]);
  });
});

describe('synchronisation', () => {
  it('dernier écrit gagne + convergence de deux appareils', async () => {
    const server = new Map<string, RemoteRecord & { seq: number }>();
    let seq = 0;
    const adapter: SyncAdapter = {
      name: 'mem',
      isReady: async () => true,
      async pull(cursor) {
        const c = cursor ? Number(cursor) : 0;
        const recs = [...server.values()].filter((r) => r.seq > c).sort((a, b) => a.seq - b.seq);
        return { records: recs, cursor: recs.length ? String(recs[recs.length - 1].seq) : cursor };
      },
      async push(records) {
        for (const r of records) {
          const k = r.store + ':' + r.id;
          const ex = server.get(k);
          if (!ex || ex.updatedAt < r.updatedAt) server.set(k, { ...r, seq: ++seq });
        }
      },
    };
    const mk = () => {
      const raw = { accounts: [] as never[], transactions: [], pending: [], products: [], obligations: [], categories: [] } as unknown as import('../types').DataState;
      let meta: SyncMeta = { cursor: null, pushedAt: 0 };
      return {
        raw,
        deps: {
          adapter,
          getRaw: () => raw,
          apply: async (recs: RemoteRecord[]) => {
            for (const r of recs) {
              const arr = raw[r.store] as unknown as RemoteRecord['data'][];
              const i = arr.findIndex((x) => x.id === r.id);
              if (i >= 0) arr[i] = r.data; else arr.push(r.data);
            }
          },
          loadMeta: async () => meta,
          saveMeta: async (m: SyncMeta) => { meta = m; },
        },
      };
    };
    const A1 = mk(), B = mk();
    (A1.raw.accounts as unknown[]).push({ id: 'a1', name: 'Banque', kind: 'bank', order: 0, createdAt: 1, updatedAt: 1000 });
    await runSync(A1.deps);
    await runSync(B.deps);
    expect(B.raw.accounts[0].name).toBe('Banque');
    // Modifs concurrentes : la plus récente gagne
    (A1.raw.accounts[0] as { name: string; updatedAt: number }).name = 'Banque A';
    A1.raw.accounts[0].updatedAt = Date.now() + 10;
    (B.raw.accounts[0] as { name: string; updatedAt: number }).name = 'Banque B';
    B.raw.accounts[0].updatedAt = Date.now() + 20;
    await runSync(A1.deps);
    await runSync(B.deps);
    await runSync(A1.deps);
    expect(A1.raw.accounts[0].name).toBe('Banque B');
    expect(B.raw.accounts[0].name).toBe('Banque B');
    expect(mergeRemote(A1.raw, [])).toEqual([]);
    expect(collectDirty(A1.raw, Number.MAX_SAFE_INTEGER)).toEqual([]);
  });
});
