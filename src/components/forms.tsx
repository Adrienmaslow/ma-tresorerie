import { useMemo, useState, type ReactNode } from 'react';
import {
  ArrowDownLeft, ArrowUpRight, ArrowLeftRight, ShoppingBag, Clock, PackagePlus, CalendarClock, HandCoins, Wallet,
} from 'lucide-react';
import { getState, useApp, findLive } from '../store/store';
import * as A from '../store/actions';
import { attempt, closeSheet, confirmDanger, openSheet, useSheet, askConfirm } from '../store/ui';
import { Amount, Field, MoneyInput, Segmented, Select, Sheet, TextInput, cx } from './ui';
import { today } from '../lib/dates';
import { ACCOUNT_KIND_LABEL, OBLIGATION_KIND_LABEL, PENDING_STATUS_LABEL, PRODUCT_STATUS_LABEL, RECURRENCE_LABEL, TX_TYPE_LABEL } from '../lib/labels';
import type { AccountKind, Cents, CategoryKind, ObligationKind, PendingStatus, ProductStatus, Recurrence, TxType } from '../types';
import { computeTotals, obligationPaidCents, obligationRemaining } from '../lib/calc';
import { mulCents } from '../lib/money';

// ---------- helpers ----------

function useAccounts() {
  const accounts = useApp((s) => s.data.accounts);
  return useMemo(() => [...accounts].sort((a, b) => a.order - b.order), [accounts]);
}

function useCategoryNames(kind: CategoryKind) {
  const cats = useApp((s) => s.data.categories);
  return useMemo(() => cats.filter((c) => c.kind === kind).map((c) => c.name).sort((a, b) => a.localeCompare(b, 'fr')), [cats, kind]);
}

function AccountSelect({ value, onChange, exclude, label = 'Compte' }: { value: string; onChange: (v: string) => void; exclude?: string; label?: string }) {
  const accounts = useAccounts();
  const balances = useApp((s) => s.data);
  const bal = useMemo(() => computeTotals(balances).balances, [balances]);
  const hidden = useApp((s) => s.settings.hideAmounts);
  return (
    <Field label={label}>
      <Select value={value} onChange={onChange}>
        <option value="">Choisir…</option>
        {accounts
          .filter((a) => a.id !== exclude)
          .map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {hidden ? '' : ` — ${((bal.get(a.id) ?? 0) / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}`}
            </option>
          ))}
      </Select>
    </Field>
  );
}

function ListSelect({ label, value, onChange, kind, allowEmpty }: { label: string; value: string; onChange: (v: string) => void; kind: CategoryKind; allowEmpty?: string }) {
  const names = useCategoryNames(kind);
  const opts = value && !names.includes(value) ? [value, ...names] : names;
  return (
    <Field label={label}>
      <Select value={value} onChange={onChange}>
        {allowEmpty !== undefined && <option value="">{allowEmpty}</option>}
        {!allowEmpty && !value && <option value="">Choisir…</option>}
        {opts.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function Footer({ onSubmit, label = 'Enregistrer', onDelete, disabled, extra }: { onSubmit: () => void; label?: string; onDelete?: () => void; disabled?: boolean; extra?: ReactNode }) {
  return (
    <>
      {onDelete && (
        <button type="button" className="btn-danger px-3" onClick={onDelete} aria-label="Supprimer">
          Supprimer
        </button>
      )}
      {extra}
      <button type="button" className="btn-primary flex-1" onClick={onSubmit} disabled={disabled}>
        {label}
      </button>
    </>
  );
}

const grid2 = 'grid grid-cols-2 gap-3';

// ---------- Ajout rapide ----------

function QuickAdd() {
  const items: { icon: ReactNode; label: string; desc: string; run: () => void; tone: string }[] = [
    { icon: <ArrowDownLeft size={20} />, label: 'Entrée', desc: 'Argent reçu', run: () => openSheet({ kind: 'tx', type: 'income' }), tone: 'text-pos bg-pos/10' },
    { icon: <ArrowUpRight size={20} />, label: 'Dépense', desc: 'Argent sorti', run: () => openSheet({ kind: 'tx', type: 'expense' }), tone: 'text-neg bg-neg/10' },
    { icon: <ArrowLeftRight size={20} />, label: 'Transfert', desc: 'Entre deux comptes', run: () => openSheet({ kind: 'tx', type: 'transfer' }), tone: 'text-info bg-info/10' },
    { icon: <ShoppingBag size={20} />, label: 'Vente', desc: 'Article vendu', run: () => openSheet({ kind: 'sell' }), tone: 'text-accent bg-accent/10' },
    { icon: <Clock size={20} />, label: 'Paiement en attente', desc: 'À recevoir', run: () => openSheet({ kind: 'pending' }), tone: 'text-warn bg-warn/10' },
    { icon: <PackagePlus size={20} />, label: 'Achat de stock', desc: 'Marchandise', run: () => openSheet({ kind: 'product' }), tone: 'text-ink bg-line' },
    { icon: <CalendarClock size={20} />, label: 'À payer', desc: 'Échéance, dette, charge', run: () => openSheet({ kind: 'obligation', obKind: 'upcoming' }), tone: 'text-neg bg-neg/10' },
    { icon: <HandCoins size={20} />, label: 'Argent prêté', desc: 'À me rembourser', run: () => openSheet({ kind: 'obligation', obKind: 'loan_given' }), tone: 'text-info bg-info/10' },
  ];
  return (
    <Sheet open title="Ajouter" onClose={closeSheet}>
      <div className="grid grid-cols-2 gap-2.5 pb-2">
        {items.map((i) => (
          <button key={i.label} type="button" onClick={i.run} className="flex flex-col items-start gap-3 p-4 rounded-2xl bg-raised hover:bg-line/70 transition active:scale-[.98] text-left">
            <span className={cx('h-10 w-10 rounded-xl grid place-items-center', i.tone)}>{i.icon}</span>
            <span>
              <span className="block font-medium text-[15px]">{i.label}</span>
              <span className="block text-muted text-[13px]">{i.desc}</span>
            </span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

// ---------- Transaction ----------

const EDITABLE_TYPES: TxType[] = ['income', 'expense', 'transfer', 'sale', 'purchase', 'payment_received', 'adjustment'];

function TxForm({ id, type: initType, accountId: initAcc }: { id?: string; type?: TxType; accountId?: string }) {
  const existing = id ? findLive('transactions', id) : undefined;
  const accounts = useAccounts();
  const [type, setType] = useState<TxType>(existing?.type ?? initType ?? 'expense');
  const [amount, setAmount] = useState<Cents | null>(existing ? existing.amountCents : null);
  const [accountId, setAccountId] = useState(existing?.accountId ?? initAcc ?? accounts[1]?.id ?? accounts[0]?.id ?? '');
  const [toAccountId, setTo] = useState(existing?.toAccountId ?? '');
  const [date, setDate] = useState(existing?.date ?? today());
  const [category, setCategory] = useState(existing?.category ?? (type === 'income' ? 'Divers' : ''));
  const [platform, setPlatform] = useState(existing?.platform ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const linked = !!(existing && (existing.linkedPendingId || existing.linkedProductId || existing.linkedObligationId));
  const lockedType = !!existing && (linked || !EDITABLE_TYPES.includes(existing.type));

  const submit = async () => {
    if (amount === null) return;
    const input = { type, date, amountCents: amount, accountId, toAccountId: type === 'transfer' ? toAccountId : undefined, category: type === 'transfer' ? 'Transfert' : category || 'Divers', description: description.trim(), platform: platform || undefined };
    const ok = await attempt(() => (existing ? A.updateTransaction({ ...existing, ...input }) : A.addTransaction(input)), existing ? 'Opération modifiée' : 'Opération ajoutée');
    if (ok) closeSheet();
  };
  const del = async () => {
    if (!existing) return;
    const body = existing.linkedPendingId
      ? 'Le paiement lié repassera « en attente ».'
      : existing.linkedProductId && existing.type === 'sale'
        ? 'L’article lié repassera « en stock ».'
        : existing.linkedObligationId
          ? 'L’échéance liée sera rouverte si elle était soldée.'
          : 'Les soldes seront recalculés.';
    if (await confirmDanger('Supprimer cette opération ?', body)) {
      if (await attempt(() => A.deleteTransaction(existing.id), 'Opération supprimée')) closeSheet();
    }
  };

  const typeOptions: { value: TxType; label: string }[] = [
    { value: 'expense', label: 'Dépense' },
    { value: 'income', label: 'Entrée' },
    { value: 'transfer', label: 'Transfert' },
  ];
  const title = existing ? 'Modifier l’opération' : type === 'transfer' ? 'Transfert' : type === 'income' ? 'Entrée d’argent' : type === 'expense' ? 'Dépense' : TX_TYPE_LABEL[type];

  return (
    <Sheet open title={title} onClose={closeSheet} footer={<Footer onSubmit={submit} onDelete={existing ? del : undefined} disabled={amount === null || (type !== 'adjustment' && amount <= 0) || !accountId || (type === 'transfer' && !toAccountId)} />}>
      <div className="space-y-4">
        {!lockedType && ['expense', 'income', 'transfer'].includes(type) && <Segmented value={type} onChange={setType} options={typeOptions} />}
        {lockedType && <div className="text-muted text-[14px]">Type : {TX_TYPE_LABEL[type]}{linked && ' · liée'}</div>}
        <Field label={type === 'adjustment' ? 'Montant (négatif pour diminuer)' : 'Montant'}>
          <MoneyInput value={amount} onChange={setAmount} autoFocus={!existing} large allowNegative={type === 'adjustment'} />
        </Field>
        {type === 'transfer' ? (
          <div className={grid2}>
            <AccountSelect label="Depuis" value={accountId} onChange={setAccountId} />
            <AccountSelect label="Vers" value={toAccountId} onChange={setTo} exclude={accountId} />
          </div>
        ) : (
          <AccountSelect value={accountId} onChange={setAccountId} label={['income', 'sale', 'payment_received', 'loan_repaid', 'borrow'].includes(type) ? 'Compte crédité' : type === 'adjustment' ? 'Compte' : 'Compte débité'} />
        )}
        <div className={grid2}>
          <Field label="Date">
            <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value || today())} />
          </Field>
          {type !== 'transfer' && <ListSelect label="Catégorie" value={category} onChange={setCategory} kind="transaction" />}
        </div>
        {type !== 'transfer' && <ListSelect label="Plateforme (optionnel)" value={platform} onChange={setPlatform} kind="platform" allowEmpty="Aucune" />}
        <Field label="Description">
          <TextInput value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex. Courses, loyer…" maxLength={140} />
        </Field>
      </div>
    </Sheet>
  );
}

// ---------- Paiement en attente ----------

function PendingForm({ id }: { id?: string }) {
  const existing = id ? findLive('pending', id) : undefined;
  const accounts = useAccounts();
  const [amount, setAmount] = useState<Cents | null>(existing?.amountCents ?? null);
  const [platform, setPlatform] = useState(existing?.platform ?? 'Vinted');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [saleDate, setSaleDate] = useState(existing?.saleDate ?? today());
  const [expectedDate, setExpected] = useState(existing?.expectedDate ?? '');
  const [status, setStatus] = useState<PendingStatus>(existing?.status ?? 'pending');
  const [receiveAcc, setReceiveAcc] = useState(accounts.find((a) => a.kind === 'paypal')?.id ?? accounts[0]?.id ?? '');

  const submit = async () => {
    if (!amount) return;
    const data = { amountCents: amount, platform, description: description.trim(), saleDate, expectedDate: expectedDate || undefined };
    const ok = await attempt(async () => {
      if (existing) {
        await A.updatePending({ ...existing, ...data });
        if (status !== existing.status) await A.setPendingStatus(existing.id, status, status === 'received' ? { accountId: receiveAcc, date: today() } : undefined);
      } else {
        await A.addPending({ ...data, status }, status === 'received' ? { accountId: receiveAcc, date: today() } : undefined);
      }
    }, existing ? 'Paiement modifié' : 'Paiement ajouté');
    if (ok) closeSheet();
  };
  const del = async () => {
    if (!existing) return;
    const body = existing.status === 'received' ? 'La transaction de réception déjà enregistrée sera conservée dans l’historique.' : undefined;
    if (await confirmDanger('Supprimer ce paiement ?', body)) if (await attempt(() => A.deletePending(existing.id), 'Supprimé')) closeSheet();
  };
  return (
    <Sheet open title={existing ? 'Modifier le paiement' : 'Paiement en attente'} onClose={closeSheet} footer={<Footer onSubmit={submit} onDelete={existing ? del : undefined} disabled={!amount || amount <= 0 || (status === 'received' && existing?.status !== 'received' && !receiveAcc)} />}>
      <div className="space-y-4">
        <Field label="Montant">
          <MoneyInput value={amount} onChange={setAmount} autoFocus={!existing} large />
        </Field>
        <div className={grid2}>
          <ListSelect label="Plateforme" value={platform} onChange={setPlatform} kind="platform" />
          <Field label="Statut">
            <Select value={status} onChange={(v) => setStatus(v as PendingStatus)}>
              {(Object.keys(PENDING_STATUS_LABEL) as PendingStatus[]).map((s) => (
                <option key={s} value={s}>
                  {PENDING_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {status === 'received' && existing?.status !== 'received' && <AccountSelect label="Compte qui reçoit l’argent" value={receiveAcc} onChange={setReceiveAcc} />}
        <Field label="Description">
          <TextInput value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex. Veste en jean" maxLength={140} />
        </Field>
        <div className={grid2}>
          <Field label="Date de vente">
            <TextInput type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value || today())} />
          </Field>
          <Field label="Réception estimée">
            <TextInput type="date" value={expectedDate} onChange={(e) => setExpected(e.target.value)} />
          </Field>
        </div>
      </div>
    </Sheet>
  );
}

function ReceiveForm({ id }: { id: string }) {
  const p = findLive('pending', id);
  const accounts = useAccounts();
  const [acc, setAcc] = useState(() => {
    // Viagogo verse sur un compte bancaire, la main propre en espèces, les autres plateformes souvent sur PayPal
    const kind = p?.platform === 'Viagogo' ? 'bank' : p?.platform === 'Main propre' ? 'cash' : 'paypal';
    return accounts.find((a) => a.kind === kind)?.id ?? accounts[0]?.id ?? '';
  });
  const [date, setDate] = useState(today());
  if (!p) return null;
  const submit = async () => {
    if (await attempt(() => A.setPendingStatus(p.id, 'received', { accountId: acc, date }), 'Paiement reçu et transféré')) closeSheet();
  };
  return (
    <Sheet open title="Marquer comme reçu" onClose={closeSheet} footer={<Footer onSubmit={submit} label="Confirmer la réception" disabled={!acc} />}>
      <div className="space-y-4">
        <div className="rounded-2xl bg-raised p-4">
          <div className="text-muted text-[13px]">{p.platform} · {p.description || 'Sans description'}</div>
          <div className="text-[26px] font-semibold mt-1"><Amount cents={p.amountCents} /></div>
        </div>
        <AccountSelect label="Transférer vers" value={acc} onChange={setAcc} />
        <Field label="Date de réception">
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value || today())} />
        </Field>
        <p className="text-muted text-[13px]">Le montant quitte « En attente » et s’ajoute au compte choisi : il n’est jamais compté deux fois.</p>
      </div>
    </Sheet>
  );
}

// ---------- Produit ----------

function ProductForm({ id }: { id?: string }) {
  const existing = id ? findLive('products', id) : undefined;
  const accounts = useAccounts();
  const [name, setName] = useState(existing?.name ?? '');
  const [category, setCategory] = useState(existing?.category ?? '');
  const [quantity, setQuantity] = useState(String(existing?.quantity ?? 1));
  const [unitCost, setUnitCost] = useState<Cents | null>(existing?.unitCostCents ?? null);
  const [estPrice, setEstPrice] = useState<Cents | null>(existing?.estUnitPriceCents ?? null);
  const [actualPrice, setActualPrice] = useState<Cents | null>(existing?.actualUnitPriceCents ?? null);
  const [fees, setFees] = useState<Cents | null>(existing?.feesCents ?? 0);
  const [status, setStatus] = useState<ProductStatus>(existing?.status ?? 'in_stock');
  const [purchaseDate, setPurchaseDate] = useState(existing?.purchaseDate ?? today());
  const [platform, setPlatform] = useState(existing?.platform ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [paidFrom, setPaidFrom] = useState(existing ? '' : accounts[1]?.id ?? '');
  const qty = parseInt(quantity, 10);
  const valid = name.trim() && Number.isInteger(qty) && qty >= 1 && unitCost !== null && estPrice !== null;

  const submit = async () => {
    if (!valid) return;
    const data = {
      name, category: category || 'Divers', quantity: qty, unitCostCents: unitCost!, estUnitPriceCents: estPrice!, feesCents: fees ?? 0,
      purchaseDate, platform: platform || undefined, notes: notes.trim() || undefined,
    };
    const ok = await attempt(async () => {
      if (existing) {
        const sold = existing.status === 'sold';
        await A.updateProduct({ ...existing, ...data, status: sold ? 'sold' : status, actualUnitPriceCents: sold ? actualPrice ?? existing.actualUnitPriceCents : existing.actualUnitPriceCents });
      } else {
        await A.addProduct({ ...data, status: status === 'sold' ? 'in_stock' : status }, paidFrom || undefined);
      }
    }, existing ? 'Produit modifié' : 'Produit ajouté au stock');
    if (ok) closeSheet();
  };
  const del = async () => {
    if (!existing) return;
    const r = await askConfirm({ title: 'Supprimer ce produit ?', danger: true, confirm: 'Supprimer', checkbox: existing.purchaseTxId ? 'Supprimer aussi la transaction d’achat (rembourse le compte)' : undefined, body: existing.saleTxId || existing.salePendingId ? 'L’encaissement de la vente reste enregistré.' : undefined });
    if (r.ok && (await attempt(() => A.deleteProduct(existing.id, r.checked), 'Produit supprimé'))) closeSheet();
  };
  const cost = unitCost !== null && qty > 0 ? mulCents(unitCost, qty) : 0;

  return (
    <Sheet open title={existing ? 'Modifier le produit' : 'Ajouter au stock'} onClose={closeSheet} footer={<Footer onSubmit={submit} onDelete={existing ? del : undefined} disabled={!valid} />}>
      <div className="space-y-4">
        <Field label="Nom">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Carte Dracaufeu" autoFocus={!existing} maxLength={120} />
        </Field>
        <div className={grid2}>
          <ListSelect label="Catégorie" value={category} onChange={setCategory} kind="product" />
          <Field label="Quantité">
            <TextInput inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/\D/g, ''))} />
          </Field>
        </div>
        <div className={grid2}>
          <Field label="Prix d’achat unitaire">
            <MoneyInput value={unitCost} onChange={setUnitCost} />
          </Field>
          <Field label="Prix de vente estimé (unité)">
            <MoneyInput value={estPrice} onChange={setEstPrice} />
          </Field>
        </div>
        <div className={grid2}>
          <Field label={existing?.status === 'sold' ? 'Frais réels (total)' : 'Frais estimés (total)'} hint="Commission, port…">
            <MoneyInput value={fees} onChange={setFees} />
          </Field>
          {existing?.status === 'sold' ? (
            <Field label="Prix de vente réel (unité)">
              <MoneyInput value={actualPrice} onChange={setActualPrice} />
            </Field>
          ) : (
            <Field label="Statut">
              <Select value={status} onChange={(v) => setStatus(v as ProductStatus)}>
                <option value="in_stock">{PRODUCT_STATUS_LABEL.in_stock}</option>
                <option value="reserved">{PRODUCT_STATUS_LABEL.reserved}</option>
              </Select>
            </Field>
          )}
        </div>
        <div className={grid2}>
          <Field label="Date d’achat">
            <TextInput type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value || today())} />
          </Field>
          <ListSelect label="Plateforme" value={platform} onChange={setPlatform} kind="platform" allowEmpty="Aucune" />
        </div>
        {!existing && (
          <Field label="Payé depuis" hint={cost > 0 ? <>Débite <Amount cents={cost} /> du compte : vos liquidités deviennent du stock, la trésorerie totale ne change pas.</> : 'Choisissez « Non suivi » si l’achat n’a pas été payé depuis un compte suivi.'}>
            <Select value={paidFrom} onChange={setPaidFrom}>
              <option value="">Non suivi / déjà comptabilisé</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Notes">
          <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="État, référence…" maxLength={200} />
        </Field>
      </div>
    </Sheet>
  );
}

// ---------- Vente ----------

function SellForm({ id }: { id?: string }) {
  const products = useApp((s) => s.data.products);
  const accounts = useAccounts();
  const available = useMemo(() => products.filter((p) => p.status !== 'sold').sort((a, b) => a.name.localeCompare(b.name, 'fr')), [products]);
  const [mode, setMode] = useState<'stock' | 'free'>(id || available.length ? 'stock' : 'free');
  const [productId, setProductId] = useState(id ?? '');
  const product = available.find((p) => p.id === productId);
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState<Cents | null>(product?.estUnitPriceCents ?? null);
  const [fees, setFees] = useState<Cents | null>(0);
  const [date, setDate] = useState(today());
  const [platform, setPlatform] = useState(product?.platform ?? 'Vinted');
  const [dest, setDest] = useState<'account' | 'pending'>('pending');
  const [accountId, setAccountId] = useState(accounts.find((a) => a.kind === 'paypal')?.id ?? accounts[0]?.id ?? '');
  const [expected, setExpected] = useState('');
  const [description, setDescription] = useState('');
  const q = parseInt(qty, 10);

  const pick = (pid: string) => {
    setProductId(pid);
    const p = available.find((x) => x.id === pid);
    if (p) {
      setPrice(p.estUnitPriceCents);
      setQty(String(p.quantity));
      if (p.platform) setPlatform(p.platform);
    }
  };

  const gross = price !== null && q > 0 ? mulCents(price, mode === 'stock' ? q : 1) : 0;
  const net = gross - (fees ?? 0);
  const profit = product && q > 0 ? net - mulCents(product.unitCostCents, q) : null;

  const valid = price !== null && price >= 0 && (mode === 'free' ? net > 0 : !!product && q >= 1 && q <= (product?.quantity ?? 0)) && (dest === 'pending' || !!accountId);

  const submit = async () => {
    if (!valid) return;
    const ok = await attempt(async () => {
      if (mode === 'stock' && product) {
        await A.sellProduct(product.id, { quantity: q, unitPriceCents: price!, feesCents: fees ?? 0, date, platform, destination: dest === 'account' ? { kind: 'account', accountId } : { kind: 'pending', expectedDate: expected || undefined } });
      } else if (dest === 'account') {
        await A.addTransaction({ type: 'sale', date, amountCents: net, accountId, category: 'Ventes', description: description.trim() || 'Vente', platform });
      } else {
        await A.addPending({ amountCents: net, platform, description: description.trim() || 'Vente', saleDate: date, expectedDate: expected || undefined, status: 'pending' });
      }
    }, 'Vente enregistrée');
    if (ok) closeSheet();
  };

  return (
    <Sheet open title="Enregistrer une vente" onClose={closeSheet} footer={<Footer onSubmit={submit} label="Enregistrer la vente" disabled={!valid} />}>
      <div className="space-y-4">
        {!id && (
          <Segmented value={mode} onChange={setMode} options={[{ value: 'stock', label: 'Article du stock' }, { value: 'free', label: 'Vente libre' }]} />
        )}
        {mode === 'stock' ? (
          <>
            {available.length === 0 ? (
              <p className="text-muted text-[14px]">Aucun article en stock. Utilisez « Vente libre » ou ajoutez d’abord un produit.</p>
            ) : (
              <Field label="Article">
                <Select value={productId} onChange={pick}>
                  <option value="">Choisir…</option>
                  {available.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.quantity} en stock)
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <div className={grid2}>
              <Field label="Quantité vendue" error={product && (q < 1 || q > product.quantity) ? `Entre 1 et ${product.quantity}` : undefined}>
                <TextInput inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} />
              </Field>
              <Field label="Prix unitaire réel">
                <MoneyInput value={price} onChange={setPrice} />
              </Field>
            </div>
          </>
        ) : (
          <>
            <Field label="Prix de vente">
              <MoneyInput value={price} onChange={setPrice} large autoFocus />
            </Field>
            <Field label="Description">
              <TextInput value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex. Console" maxLength={140} />
            </Field>
          </>
        )}
        <div className={grid2}>
          <Field label="Frais (total)">
            <MoneyInput value={fees} onChange={setFees} />
          </Field>
          <ListSelect label="Plateforme" value={platform} onChange={setPlatform} kind="platform" />
        </div>
        <Field label="Date de vente">
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value || today())} />
        </Field>
        <Field label="Encaissement">
          <Segmented value={dest} onChange={setDest} options={[{ value: 'pending', label: 'En attente' }, { value: 'account', label: 'Déjà reçu' }]} />
        </Field>
        {dest === 'account' ? (
          <AccountSelect label="Compte crédité" value={accountId} onChange={setAccountId} />
        ) : (
          <Field label="Réception estimée">
            <TextInput type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
          </Field>
        )}
        <div className="rounded-2xl bg-raised p-4 grid grid-cols-2 gap-2 text-[14px]">
          <span className="text-muted">Net encaissé</span>
          <span className="text-right font-medium"><Amount cents={net} /></span>
          {profit !== null && (
            <>
              <span className="text-muted">Bénéfice réalisé</span>
              <span className="text-right font-medium"><Amount cents={profit} colored sign /></span>
            </>
          )}
        </div>
      </div>
    </Sheet>
  );
}

// ---------- Dépenses / dettes / prêts ----------

function ObligationForm({ id, obKind }: { id?: string; obKind?: ObligationKind }) {
  const existing = id ? findLive('obligations', id) : undefined;
  const [kind, setKind] = useState<ObligationKind>(existing?.kind ?? obKind ?? 'upcoming');
  const [label, setLabel] = useState(existing?.label ?? '');
  const [counterparty, setCounterparty] = useState(existing?.counterparty ?? '');
  const [amount, setAmount] = useState<Cents | null>(existing?.amountCents ?? null);
  const [paid, setPaid] = useState<Cents | null>(existing?.paidCents ?? 0);
  const [dueDate, setDueDate] = useState(existing?.dueDate ?? '');
  const [startDate, setStartDate] = useState(existing?.startDate ?? today());
  const [recurrence, setRecurrence] = useState<Recurrence>(existing?.recurrence ?? 'monthly');
  const [category, setCategory] = useState(existing?.category ?? '');
  const [originAcc, setOriginAcc] = useState('');

  const valid = label.trim() && amount && amount > 0 && (kind !== 'recurring' || dueDate) && (paid ?? 0) <= amount;
  const submit = async () => {
    if (!valid) return;
    const data = { kind, label, counterparty: counterparty.trim() || undefined, amountCents: amount!, paidCents: kind === 'recurring' ? 0 : paid ?? 0, dueDate: dueDate || undefined, startDate, recurrence: kind === 'recurring' ? recurrence : undefined, category: category || 'Divers' };
    const ok = await attempt(() => (existing ? A.updateObligation({ ...existing, ...data }) : A.addObligation(data, originAcc || undefined)), existing ? 'Modifié' : 'Ajouté');
    if (ok) closeSheet();
  };
  const del = async () => {
    if (!existing) return;
    if (await confirmDanger('Supprimer cet élément ?', 'Les paiements déjà enregistrés restent dans l’historique.')) if (await attempt(() => A.deleteObligation(existing.id), 'Supprimé')) closeSheet();
  };
  const isLoan = kind === 'loan_given';
  return (
    <Sheet open title={existing ? 'Modifier' : OBLIGATION_KIND_LABEL[kind]} onClose={closeSheet} footer={<Footer onSubmit={submit} onDelete={existing ? del : undefined} disabled={!valid} />}>
      <div className="space-y-4">
        {!existing && (
          <Field label="Type">
            <Select value={kind} onChange={(v) => setKind(v as ObligationKind)}>
              {(Object.keys(OBLIGATION_KIND_LABEL) as ObligationKind[]).map((k) => (
                <option key={k} value={k}>
                  {OBLIGATION_KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={kind === 'recurring' ? 'Montant par échéance' : isLoan ? 'Montant prêté' : 'Montant'}>
          <MoneyInput value={amount} onChange={setAmount} large autoFocus={!existing} />
        </Field>
        <Field label="Libellé">
          <TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder={kind === 'recurring' ? 'Ex. Loyer, abonnement' : isLoan ? 'Ex. Prêt à Paul' : 'Ex. Facture électricité'} maxLength={120} />
        </Field>
        <div className={grid2}>
          <Field label={isLoan ? 'Emprunteur' : 'Créancier / bénéficiaire'}>
            <TextInput value={counterparty} onChange={(e) => setCounterparty(e.target.value)} maxLength={80} />
          </Field>
          <ListSelect label="Catégorie" value={category} onChange={setCategory} kind="transaction" />
        </div>
        {kind === 'recurring' && (
          <Field label="Fréquence">
            <Select value={recurrence} onChange={(v) => setRecurrence(v as Recurrence)}>
              {(Object.keys(RECURRENCE_LABEL) as Recurrence[]).map((r) => (
                <option key={r} value={r}>
                  {RECURRENCE_LABEL[r]}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className={grid2}>
          <Field label={kind === 'recurring' ? 'Prochaine échéance' : 'Échéance'}>
            <TextInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          <Field label="Date de début">
            <TextInput type="date" value={startDate} onChange={(e) => setStartDate(e.target.value || today())} />
          </Field>
        </div>
        {kind !== 'recurring' && (
          <Field label={isLoan ? 'Déjà remboursé (hors application)' : 'Déjà réglé (hors application)'}>
            <MoneyInput value={paid} onChange={setPaid} />
          </Field>
        )}
        {!existing && (isLoan || kind === 'debt') && (
          <Field label={isLoan ? 'Argent prêté depuis' : 'Argent emprunté reçu sur'} hint={isLoan ? 'Débite le compte : vos liquidités deviennent une créance « en attente ».' : 'Crédite le compte du montant emprunté.'}>
            <Select value={originAcc} onChange={setOriginAcc}>
              <option value="">Non suivi / déjà comptabilisé</option>
              {getState().data.accounts
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </Select>
          </Field>
        )}
      </div>
    </Sheet>
  );
}

function SettleForm({ id }: { id: string }) {
  const o = findLive('obligations', id);
  const txs = useApp((s) => s.data.transactions);
  const accounts = useAccounts();
  const remaining = o ? obligationRemaining(o, txs) : 0;
  const [amount, setAmount] = useState<Cents | null>(remaining || null);
  const [acc, setAcc] = useState(accounts[1]?.id ?? accounts[0]?.id ?? '');
  const [date, setDate] = useState(today());
  if (!o) return null;
  const isLoan = o.kind === 'loan_given';
  const submit = async () => {
    if (!amount) return;
    if (await attempt(() => A.settleObligation(o.id, { amountCents: amount, accountId: acc, date }), isLoan ? 'Remboursement encaissé' : 'Paiement enregistré')) closeSheet();
  };
  const paid = obligationPaidCents(o, txs);
  return (
    <Sheet open title={isLoan ? 'Encaisser un remboursement' : 'Enregistrer un paiement'} onClose={closeSheet} footer={<Footer onSubmit={submit} disabled={!amount || amount <= 0 || !acc} label={isLoan ? 'Encaisser' : 'Payer'} />}>
      <div className="space-y-4">
        <div className="rounded-2xl bg-raised p-4">
          <div className="text-muted text-[13px]">{o.label}</div>
          <div className="text-[22px] font-semibold mt-1">
            Reste : <Amount cents={remaining} />
          </div>
          {o.kind !== 'recurring' && paid > 0 && (
            <div className="text-muted text-[13px] mt-0.5">
              Déjà réglé : <Amount cents={paid} /> sur <Amount cents={o.amountCents} />
            </div>
          )}
        </div>
        <Field label="Montant">
          <MoneyInput value={amount} onChange={setAmount} large />
        </Field>
        <AccountSelect label={isLoan ? 'Compte crédité' : 'Compte débité'} value={acc} onChange={setAcc} />
        <Field label="Date">
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value || today())} />
        </Field>
        {o.kind === 'recurring' && <p className="text-muted text-[13px]">La prochaine échéance sera automatiquement reportée selon la fréquence ({RECURRENCE_LABEL[o.recurrence ?? 'monthly'].toLowerCase()}).</p>}
      </div>
    </Sheet>
  );
}

// ---------- Compte ----------

function AccountForm({ id }: { id?: string }) {
  const existing = id ? findLive('accounts', id) : undefined;
  const data = useApp((s) => s.data);
  const balance = existing ? computeTotals(data).balances.get(existing.id) ?? 0 : 0;
  const [name, setName] = useState(existing?.name ?? '');
  const [kind, setKind] = useState<AccountKind>(existing?.kind ?? 'bank');
  const [amount, setAmount] = useState<Cents | null>(existing ? balance : 0);
  const submit = async () => {
    if (!name.trim() || amount === null) return;
    const ok = await attempt(async () => {
      if (existing) {
        await A.updateAccount({ ...existing, name, kind });
        if (amount !== balance) await A.setAccountBalance(existing.id, amount);
      } else {
        await A.addAccount(name, kind, amount);
      }
    }, existing ? 'Compte mis à jour' : 'Compte créé');
    if (ok) closeSheet();
  };
  const del = async () => {
    if (!existing) return;
    const n = A.accountTxCount(existing.id);
    if (await confirmDanger(`Supprimer « ${existing.name} » ?`, n ? `Ses ${n} opération(s) seront aussi supprimées et les totaux recalculés.` : 'Ce compte n’a aucune opération.')) {
      if (await attempt(() => A.deleteAccount(existing.id), 'Compte supprimé')) closeSheet();
    }
  };
  return (
    <Sheet open title={existing ? 'Modifier le compte' : 'Nouveau compte'} onClose={closeSheet} footer={<Footer onSubmit={submit} onDelete={existing ? del : undefined} disabled={!name.trim() || amount === null} />}>
      <div className="space-y-4">
        <Field label="Nom">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Livret A" autoFocus={!existing} maxLength={60} />
        </Field>
        <Field label="Type">
          <Select value={kind} onChange={(v) => setKind(v as AccountKind)}>
            {(Object.keys(ACCOUNT_KIND_LABEL) as AccountKind[]).map((k) => (
              <option key={k} value={k}>
                {ACCOUNT_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={existing ? 'Solde actuel' : 'Solde initial'} hint={existing ? 'Modifier le solde crée un ajustement daté d’aujourd’hui, visible dans l’historique.' : undefined}>
          <MoneyInput value={amount} onChange={setAmount} allowNegative large />
        </Field>
        {existing && (
          <button type="button" className="btn-secondary w-full" onClick={() => openSheet({ kind: 'tx', type: 'transfer', accountId: existing.id })}>
            <Wallet size={18} /> Transférer depuis ce compte
          </button>
        )}
      </div>
    </Sheet>
  );
}

// ---------- Hôte ----------

export function SheetHost() {
  const s = useSheet();
  if (!s) return null;
  const key = JSON.stringify(s);
  switch (s.kind) {
    case 'quick':
      return <QuickAdd key={key} />;
    case 'tx':
      return <TxForm key={key} id={s.id} type={s.type} accountId={s.accountId} />;
    case 'pending':
      return <PendingForm key={key} id={s.id} />;
    case 'receive':
      return <ReceiveForm key={key} id={s.id} />;
    case 'product':
      return <ProductForm key={key} id={s.id} />;
    case 'sell':
      return <SellForm key={key} id={s.id} />;
    case 'obligation':
      return <ObligationForm key={key} id={s.id} obKind={s.obKind} />;
    case 'settle':
      return <SettleForm key={key} id={s.id} />;
    case 'account':
      return <AccountForm key={key} id={s.id} />;
  }
}
