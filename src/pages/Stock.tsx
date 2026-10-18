import { useMemo, useState } from 'react';
import { Package, Plus, Search, ShoppingBag, Undo2 } from 'lucide-react';
import { useApp } from '../store/store';
import { productCost, productEstValue, productPotentialProfit, productRealizedProfit, productRevenue, stockStats } from '../lib/calc';
import { Amount, Badge, Chips, Empty, PageHeader, Select, Stat, TextInput, cx, useHidden } from '../components/ui';
import { attempt, askConfirm, openSheet } from '../store/ui';
import { cancelSale } from '../store/actions';
import { PRODUCT_STATUS_LABEL } from '../lib/labels';
import { fmtDate } from '../lib/dates';
import { percent } from '../lib/money';
import { useRoute } from '../lib/router';
import type { Product, ProductStatus } from '../types';

type Filter = 'available' | ProductStatus | 'all';

function Pct({ v }: { v: number | null }) {
  const hidden = useHidden();
  if (v === null || hidden) return <span className="text-muted">—</span>;
  return <span className={v > 0 ? 'text-pos' : v < 0 ? 'text-neg' : ''}>{v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %</span>;
}

function ProductCard({ p }: { p: Product }) {
  const sold = p.status === 'sold';
  const cost = productCost(p);
  const profit = sold ? productRealizedProfit(p) : productPotentialProfit(p);
  const pct = percent(profit, cost + (p.feesCents || 0));
  const undo = async () => {
    const r = await askConfirm({ title: 'Annuler cette vente ?', body: 'L’article revient en stock et l’encaissement lié (transaction ou paiement en attente) est supprimé.', confirm: 'Annuler la vente', danger: true });
    if (r.ok) void attempt(() => cancelSale(p.id), 'Vente annulée');
  };
  return (
    <div className="card p-4">
      <button type="button" className="w-full text-left" onClick={() => openSheet({ kind: 'product', id: p.id })}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge tone={sold ? 'pos' : p.status === 'reserved' ? 'info' : 'neutral'}>{PRODUCT_STATUS_LABEL[p.status]}</Badge>
              <span className="text-muted text-[13px] truncate">{p.category}</span>
            </div>
            <div className="mt-1.5 font-medium truncate">{p.name}</div>
            <div className="text-muted text-[13px] mt-0.5">
              {p.quantity} × <Amount cents={p.unitCostCents} /> · {sold ? `vendu le ${fmtDate(p.soldDate)}` : `acheté le ${fmtDate(p.purchaseDate)}`}
            </div>
          </div>
          <div className="text-right shrink-0">
            <Amount cents={sold ? productRevenue(p) : cost} className="text-[17px] font-semibold block" />
            <span className="text-muted text-[12px]">{sold ? 'vendu' : 'coût'}</span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3 text-[13px]">
          <div className="rounded-xl bg-raised px-2.5 py-2">
            <div className="text-muted text-[11px]">{sold ? 'Prix réel u.' : 'Estimé u.'}</div>
            <Amount cents={sold ? p.actualUnitPriceCents ?? 0 : p.estUnitPriceCents} className="font-medium" />
          </div>
          <div className="rounded-xl bg-raised px-2.5 py-2">
            <div className="text-muted text-[11px]">{sold ? 'Bénéfice' : 'Potentiel'}</div>
            <Amount cents={profit} colored sign className="font-medium" />
          </div>
          <div className="rounded-xl bg-raised px-2.5 py-2">
            <div className="text-muted text-[11px]">Rentabilité</div>
            <span className="font-medium"><Pct v={pct} /></span>
          </div>
        </div>
      </button>
      <div className="flex gap-2 mt-3">
        {sold ? (
          <button className="btn-ghost h-9 px-2 text-[13px] -ml-2" onClick={undo}>
            <Undo2 size={15} /> Annuler la vente
          </button>
        ) : (
          <button className="btn-primary h-9 px-3 text-[14px]" onClick={() => openSheet({ kind: 'sell', id: p.id })}>
            <ShoppingBag size={16} /> Vendre
          </button>
        )}
      </div>
    </div>
  );
}

export default function Stock() {
  const { params } = useRoute();
  const products = useApp((s) => s.data.products);
  const [filter, setFilter] = useState<Filter>((params.get('f') as Filter) || 'available');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const st = useMemo(() => stockStats(products), [products]);
  const cats = useMemo(() => [...new Set(products.map((p) => p.category))].sort(), [products]);

  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return products
      .filter((p) => (filter === 'all' ? true : filter === 'available' ? p.status !== 'sold' : p.status === filter))
      .filter((p) => !category || p.category === category)
      .filter((p) => !ql || p.name.toLowerCase().includes(ql) || (p.notes ?? '').toLowerCase().includes(ql))
      .sort((a, b) => (a.status === 'sold' && b.status === 'sold' ? (b.soldDate ?? '').localeCompare(a.soldDate ?? '') : b.purchaseDate.localeCompare(a.purchaseDate)));
  }, [products, filter, category, q]);

  const counts = useMemo(() => {
    const c = { available: 0, in_stock: 0, reserved: 0, sold: 0, all: products.length };
    for (const p of products) {
      c[p.status]++;
      if (p.status !== 'sold') c.available++;
    }
    return c;
  }, [products]);

  const listCost = list.reduce((s, p) => s + (p.status === 'sold' ? 0 : productCost(p)), 0);
  const listEst = list.reduce((s, p) => s + (p.status === 'sold' ? 0 : productEstValue(p)), 0);

  return (
    <div>
      <PageHeader
        title="Stock"
        subtitle="Produits et marchandises à revendre"
        actions={
          <button className="btn-primary h-10 px-3 hidden sm:inline-flex" onClick={() => openSheet({ kind: 'product' })}>
            <Plus size={18} /> Ajouter
          </button>
        }
      />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="Valeur au prix d’achat" sub={`${st.unitsInStock} unité${st.unitsInStock > 1 ? 's' : ''}`}>
          <Amount cents={st.costValue} />
        </Stat>
        <Stat label="Valeur estimée revente">
          <Amount cents={st.estValue} />
        </Stat>
        <Stat label="Bénéfice potentiel" sub={<>Marge <Pct v={st.potentialMarginPct} /></>}>
          <Amount cents={st.potentialProfit} colored sign />
        </Stat>
        <Stat label="Bénéfice réalisé" sub={`${st.unitsSold} vendue${st.unitsSold > 1 ? 's' : ''}`}>
          <Amount cents={st.realizedProfit} colored sign />
        </Stat>
        <div className="col-span-2 md:col-span-1">
          <Stat label="Rentabilité réalisée" sub="Bénéfice / (coût + frais)">
            <Pct v={st.realizedMarginPct} />
          </Stat>
        </div>
      </div>
      <p className="text-muted text-[12px] mt-2">Le bénéfice potentiel (estimation sur le stock restant) n’est jamais ajouté au bénéfice réalisé.</p>

      <button className="btn-primary w-full mt-4 sm:hidden" onClick={() => openSheet({ kind: 'product' })}>
        <Plus size={18} /> Ajouter un produit
      </button>

      <Chips
        className="mt-5"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'available', label: 'Disponibles', count: counts.available },
          { value: 'in_stock', label: 'En stock', count: counts.in_stock },
          { value: 'reserved', label: 'Réservés', count: counts.reserved },
          { value: 'sold', label: 'Vendus', count: counts.sold },
          { value: 'all', label: 'Tous', count: counts.all },
        ]}
      />
      <div className="flex gap-2 mt-3">
        <div className="relative flex-1">
          <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un produit" className="pl-10" />
        </div>
        <div className="w-40">
          <Select value={category} onChange={setCategory}>
            <option value="">Catégories</option>
            {cats.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </div>
      </div>
      {list.length > 0 && filter !== 'sold' && (
        <div className={cx('flex justify-between text-[13px] text-muted mt-4 mb-2 px-1')}>
          <span>{list.length} ligne{list.length > 1 ? 's' : ''}</span>
          <span>
            Coût <Amount cents={listCost} className="text-ink font-medium" /> · Estimé <Amount cents={listEst} className="text-ink font-medium" />
          </span>
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-3 mt-2">
        {list.map((p) => (
          <ProductCard key={p.id} p={p} />
        ))}
      </div>
      {list.length === 0 && (
        <div className="mt-4">
          <Empty icon={<Package size={22} />} title="Aucun produit" text="Ajoutez vos articles destinés à la revente pour suivre la valeur du stock et vos marges." action={<button className="btn-primary" onClick={() => openSheet({ kind: 'product' })}><Plus size={18} /> Ajouter un produit</button>} />
        </div>
      )}
    </div>
  );
}
