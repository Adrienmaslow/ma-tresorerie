import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Shield, Palette, Tags, Database, Cloud, Smartphone, Info, Download, Upload, Trash2, Plus, X, Pencil, Share, SquarePlus, RefreshCw, LogOut, Check } from 'lucide-react';
import { getState, replaceData, updateSettings, useApp } from '../store/store';
import { attempt, askConfirm, toast } from '../store/ui';
import { Field, PageHeader, Segmented, Select, Sheet, TextInput, Toggle, cx } from '../components/ui';
import { biometricAvailable, hashPin, isValidPin, registerBiometric, verifyPin } from '../lib/security';
import { downloadFile, exportJSON, exportPendingCSV, exportStockCSV, exportTransactionsCSV, parseImportJSON } from '../lib/io';
import { importTransactionsCSV } from '../lib/importCsv';
import { addCategory, deleteCategory, renameCategory, seedChanges } from '../store/actions';
import { commit } from '../store/store';
import { today } from '../lib/dates';
import { isIOS, isStandalone } from '../lib/hooks';
import { getSupabase, supabaseConfigured } from '../sync/supabase';
import { refreshSignedIn, resetSyncMeta, syncNow, useSyncStatus } from '../sync/service';
import { STORE_NAMES, type CategoryKind, type DataState } from '../types';
import { requestPersistence } from '../db/db';
import { useInstallPrompt, useSWUpdate } from '../pwa';

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="card p-4 md:p-5">
      <h2 className="flex items-center gap-2 font-semibold mb-2">
        <span className="text-muted">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

// ---------- PIN ----------

function PinSheet({ mode, onClose }: { mode: 'set' | 'change' | 'remove'; onClose: () => void }) {
  const s = useApp((x) => x.settings);
  const [current, setCurrent] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [busy, setBusy] = useState(false);
  const needsCurrent = mode !== 'set';
  const submit = async () => {
    setBusy(true);
    try {
      if (needsCurrent) {
        const ok = s.pinHash && s.pinSalt && (await verifyPin(current, s.pinHash, s.pinSalt, s.pinIterations));
        if (!ok) throw new Error('Code actuel incorrect.');
      }
      if (mode === 'remove') {
        await updateSettings({ pinHash: undefined, pinSalt: undefined, pinIterations: undefined, pinLength: undefined, biometricCredentialId: undefined });
        toast('Verrouillage désactivé');
      } else {
        if (!isValidPin(pin)) throw new Error('Le code doit contenir 4 à 8 chiffres.');
        if (pin !== pin2) throw new Error('Les deux codes ne correspondent pas.');
        const h = await hashPin(pin);
        await updateSettings({ ...h, pinLength: pin.length });
        toast(mode === 'set' ? 'Code PIN activé' : 'Code PIN modifié');
      }
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const pinInput = (v: string, set: (v: string) => void, autoFocus?: boolean) => (
    <TextInput type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={v} autoFocus={autoFocus} onChange={(e) => set(e.target.value.replace(/\D/g, ''))} className="tracking-[0.4em] text-center text-[20px]" />
  );
  return (
    <Sheet
      open
      title={mode === 'set' ? 'Créer un code PIN' : mode === 'change' ? 'Modifier le code PIN' : 'Désactiver le code PIN'}
      onClose={onClose}
      footer={
        <button className={cx(mode === 'remove' ? 'btn-danger' : 'btn-primary', 'flex-1')} onClick={submit} disabled={busy}>
          {busy ? 'Patientez…' : mode === 'remove' ? 'Désactiver' : 'Enregistrer'}
        </button>
      }
    >
      <div className="space-y-4">
        {needsCurrent && <Field label="Code actuel">{pinInput(current, setCurrent, true)}</Field>}
        {mode !== 'remove' && (
          <>
            <Field label="Nouveau code (4 à 8 chiffres)">{pinInput(pin, setPin, !needsCurrent)}</Field>
            <Field label="Confirmer le code">{pinInput(pin2, setPin2)}</Field>
            <p className="text-muted text-[13px]">Le code n’est jamais enregistré : seule une empreinte cryptographique (PBKDF2-SHA-256, 210 000 itérations, sel aléatoire) est conservée sur l’appareil.</p>
          </>
        )}
      </div>
    </Sheet>
  );
}

function SecuritySection() {
  const s = useApp((x) => x.settings);
  const [sheet, setSheet] = useState<null | 'set' | 'change' | 'remove'>(null);
  const [bioOk, setBioOk] = useState(false);
  useEffect(() => {
    void biometricAvailable().then(setBioOk);
  }, []);
  const toggleBio = async (on: boolean) => {
    if (!on) return void updateSettings({ biometricCredentialId: undefined });
    try {
      const id = await registerBiometric();
      await updateSettings({ biometricCredentialId: id });
      toast('Déverrouillage biométrique activé');
    } catch (e) {
      toast(e instanceof Error && e.name === 'NotAllowedError' ? 'Activation annulée.' : 'Biométrie indisponible sur cet appareil.', 'error');
    }
  };
  return (
    <Section icon={<Shield size={18} />} title="Sécurité et confidentialité">
      <div className="divide-y divide-line/70">
        <div className="flex items-center justify-between gap-3 py-3">
          <div>
            <div className="text-[15px]">Verrouillage par code PIN</div>
            <div className="text-muted text-[13px]">{s.pinHash ? 'Activé' : 'Désactivé'}</div>
          </div>
          {s.pinHash ? (
            <div className="flex gap-2">
              <button className="btn-secondary h-9 px-3 text-[14px]" onClick={() => setSheet('change')}>
                Modifier
              </button>
              <button className="btn-danger h-9 px-3 text-[14px]" onClick={() => setSheet('remove')}>
                Désactiver
              </button>
            </div>
          ) : (
            <button className="btn-primary h-9 px-3 text-[14px]" onClick={() => setSheet('set')}>
              Activer
            </button>
          )}
        </div>
        {s.pinHash && (
          <>
            {bioOk ? (
              <Toggle checked={!!s.biometricCredentialId} onChange={toggleBio} label="Face ID / Touch ID" description="Déverrouiller avec la biométrie de l’appareil (WebAuthn). Le code PIN reste disponible." />
            ) : (
              <div className="py-3 text-muted text-[13px]">Biométrie non disponible dans ce navigateur (nécessite HTTPS et un capteur compatible).</div>
            )}
            <div className="flex items-center justify-between gap-3 py-3">
              <div className="text-[15px]">Verrouiller après</div>
              <div className="w-44">
                <Select value={String(s.autoLockMinutes)} onChange={(v) => void updateSettings({ autoLockMinutes: Number(v) })}>
                  <option value="0">Immédiatement</option>
                  <option value="1">1 minute</option>
                  <option value="5">5 minutes</option>
                  <option value="15">15 minutes</option>
                  <option value="60">1 heure</option>
                </Select>
              </div>
            </div>
          </>
        )}
        <Toggle checked={s.hideAmounts} onChange={(v) => void updateSettings({ hideAmounts: v })} label="Masquer les montants" description="Remplace les montants par •••••" />
        <Toggle checked={s.hideOnLaunch} onChange={(v) => void updateSettings({ hideOnLaunch: v })} label="Masquer au démarrage" description="Les montants sont masqués à chaque ouverture" />
      </div>
      {sheet && <PinSheet mode={sheet} onClose={() => setSheet(null)} />}
    </Section>
  );
}

// ---------- Catégories ----------

function CategoryGroup({ kind, title }: { kind: CategoryKind; title: string }) {
  const all = useApp((s) => s.data.categories);
  const cats = useMemo(() => all.filter((c) => c.kind === kind).sort((a, b) => a.name.localeCompare(b.name, 'fr')), [all, kind]);
  const [name, setName] = useState('');
  const [edit, setEdit] = useState<{ id: string; name: string } | null>(null);
  const add = async () => {
    if (await attempt(() => addCategory(kind, name))) setName('');
  };
  return (
    <div className="py-3">
      <div className="text-[14px] font-medium mb-2">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {cats.map((c) => (
          <span key={c.id} className="inline-flex items-center h-8 pl-3 pr-1 rounded-full bg-raised text-[13px]">
            <button onClick={() => setEdit({ id: c.id, name: c.name })} className="flex items-center gap-1">
              {c.name}
            </button>
            <button
              className="h-6 w-6 grid place-items-center rounded-full text-muted hover:text-neg"
              aria-label={`Supprimer ${c.name}`}
              onClick={async () => {
                const r = await askConfirm({ title: `Supprimer « ${c.name} » ?`, body: 'Les opérations existantes conservent ce nom.', confirm: 'Supprimer', danger: true });
                if (r.ok) void attempt(() => deleteCategory(c.id));
              }}
            >
              <X size={14} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2 mt-2.5">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Nouvelle…" onKeyDown={(e) => e.key === 'Enter' && name.trim() && add()} maxLength={40} />
        <button className="btn-secondary px-3" onClick={add} disabled={!name.trim()} aria-label="Ajouter">
          <Plus size={18} />
        </button>
      </div>
      {edit && (
        <Sheet
          open
          title="Renommer"
          onClose={() => setEdit(null)}
          footer={
            <button
              className="btn-primary flex-1"
              onClick={async () => {
                if (await attempt(() => renameCategory(edit.id, edit.name), 'Renommé')) setEdit(null);
              }}
            >
              <Pencil size={16} /> Renommer
            </button>
          }
        >
          <TextInput autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={40} />
          <p className="text-muted text-[13px] mt-2">Le nouveau nom est appliqué à toutes les opérations qui utilisent cette catégorie.</p>
        </Sheet>
      )}
    </div>
  );
}

// ---------- Données ----------

function DataSection() {
  const fileJson = useRef<HTMLInputElement>(null);
  const fileCsv = useRef<HTMLInputElement>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<string>('');
  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersisted);
    void navigator.storage?.estimate?.().then((e) => e.usage !== undefined && setUsage(`${(e.usage / 1024).toFixed(0)} Ko utilisés`));
  }, []);
  const stamp = today();
  const exportAll = () => downloadFile(`ma-tresorerie-${stamp}.json`, exportJSON(getState().raw), 'application/json');
  const onJson = async (f: File) => {
    try {
      const data = parseImportJSON(await f.text());
      const r = await askConfirm({ title: 'Remplacer toutes les données ?', body: `La sauvegarde contient ${data.transactions.filter((t) => !t.deleted).length} opérations et ${data.accounts.filter((a) => !a.deleted).length} comptes. Les données actuelles seront remplacées.`, confirm: 'Importer', danger: true });
      if (!r.ok) return;
      // Les enregistrements importés sont réhorodatés pour être propagés par la synchronisation
      const now = Date.now();
      const stamped = Object.fromEntries(STORE_NAMES.map((s) => [s, (data[s] as { updatedAt: number }[]).map((x) => ({ ...x, updatedAt: now }))])) as unknown as DataState;
      // Les enregistrements actuels absents de la sauvegarde sont supprimés logiquement
      const cur = getState().raw;
      for (const s of STORE_NAMES) {
        const ids = new Set((stamped[s] as { id: string }[]).map((x) => x.id));
        for (const r0 of cur[s] as { id: string; deleted?: boolean }[]) if (!ids.has(r0.id)) (stamped[s] as unknown[]).push({ ...r0, deleted: true, updatedAt: now });
      }
      await replaceData(stamped);
      toast('Sauvegarde importée');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };
  const onCsv = async (f: File) => {
    try {
      const { imported, errors } = await importTransactionsCSV(await f.text());
      toast(`${imported} opération(s) importée(s)${errors.length ? `, ${errors.length} ligne(s) ignorée(s)` : ''}`, errors.length ? 'info' : 'ok');
      if (errors.length) console.warn(errors);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };
  const wipe = async () => {
    const r = await askConfirm({ title: 'Effacer toutes les données ?', body: 'Comptes, opérations, stock et échéances seront supprimés de cet appareil (et des appareils synchronisés). Exportez une sauvegarde avant.', confirm: 'Tout effacer', danger: true, checkbox: 'Je comprends que cette action est irréversible' });
    if (!r.ok || !r.checked) return;
    const now = Date.now();
    const cur = getState().raw;
    const wiped = Object.fromEntries(STORE_NAMES.map((s) => [s, (cur[s] as object[]).map((x) => ({ ...x, deleted: true, updatedAt: now }))])) as unknown as DataState;
    await replaceData(wiped);
    await commit(seedChanges());
    toast('Données effacées');
  };
  return (
    <Section icon={<Database size={18} />} title="Données">
      <p className="text-muted text-[13px] mb-3">
        Vos données sont enregistrées automatiquement dans la base locale de l’appareil (IndexedDB) et restent disponibles hors ligne.
        {persisted !== null && (persisted ? ' Stockage persistant accordé.' : ' Stockage persistant non garanti par le navigateur : installez l’application sur l’écran d’accueil et exportez régulièrement.')} {usage}
      </p>
      {persisted === false && (
        <button className="btn-secondary h-9 px-3 text-[14px] mb-3" onClick={async () => setPersisted(await requestPersistence())}>
          Demander le stockage persistant
        </button>
      )}
      <div className="grid sm:grid-cols-2 gap-2">
        <button className="btn-secondary justify-start" onClick={exportAll}>
          <Download size={18} /> Sauvegarde complète (JSON)
        </button>
        <button className="btn-secondary justify-start" onClick={() => fileJson.current?.click()}>
          <Upload size={18} /> Restaurer une sauvegarde (JSON)
        </button>
        <button className="btn-secondary justify-start" onClick={() => downloadFile(`operations-${stamp}.csv`, exportTransactionsCSV(getState().data), 'text/csv;charset=utf-8')}>
          <Download size={18} /> Opérations (CSV)
        </button>
        <button className="btn-secondary justify-start" onClick={() => fileCsv.current?.click()}>
          <Upload size={18} /> Importer des opérations (CSV)
        </button>
        <button className="btn-secondary justify-start" onClick={() => downloadFile(`attente-${stamp}.csv`, exportPendingCSV(getState().data), 'text/csv;charset=utf-8')}>
          <Download size={18} /> Paiements en attente (CSV)
        </button>
        <button className="btn-secondary justify-start" onClick={() => downloadFile(`stock-${stamp}.csv`, exportStockCSV(getState().data), 'text/csv;charset=utf-8')}>
          <Download size={18} /> Stock (CSV)
        </button>
      </div>
      <p className="text-muted text-[12px] mt-2">CSV : séparateur « ; », colonnes date (AAAA-MM-JJ ou JJ/MM/AAAA), type, montant, compte, compte_destination, categorie, plateforme, description.</p>
      <button className="btn-danger w-full mt-4" onClick={wipe}>
        <Trash2 size={18} /> Effacer toutes les données
      </button>
      <input ref={fileJson} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onJson(f); }} />
      <input ref={fileCsv} type="file" accept="text/csv,.csv" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onCsv(f); }} />
    </Section>
  );
}

// ---------- Synchronisation ----------

function SyncSection() {
  const s = useApp((x) => x.settings);
  const st = useSyncStatus();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [user, setUser] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!supabaseConfigured) return;
    void getSupabase().then(async (sb) => {
      const { data } = await sb.auth.getSession();
      setUser(data.session?.user.email ?? null);
    });
  }, [st.signedIn]);

  if (!supabaseConfigured) {
    return (
      <Section icon={<Cloud size={18} />} title="Synchronisation">
        <p className="text-muted text-[14px]">La synchronisation entre appareils n’est pas configurée sur ce déploiement. Elle s’active en renseignant un projet Supabase (variables <code className="text-ink">VITE_SUPABASE_URL</code> et <code className="text-ink">VITE_SUPABASE_ANON_KEY</code>) — voir le README. Vos données restent en attendant uniquement sur cet appareil.</p>
      </Section>
    );
  }
  const auth = async () => {
    setBusy(true);
    try {
      const sb = await getSupabase();
      const { data, error } = mode === 'in' ? await sb.auth.signInWithPassword({ email, password }) : await sb.auth.signUp({ email, password });
      if (error) throw error;
      if (!data.session) {
        toast('Vérifiez votre e-mail pour confirmer le compte.', 'info');
        return;
      }
      await resetSyncMeta();
      await updateSettings({ syncEnabled: true });
      refreshSignedIn(true);
      setUser(data.session.user.email ?? email);
      await syncNow();
      toast('Synchronisation activée');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const logout = async () => {
    const sb = await getSupabase();
    await sb.auth.signOut();
    await updateSettings({ syncEnabled: false });
    await resetSyncMeta();
    refreshSignedIn(false);
    setUser(null);
  };
  return (
    <Section icon={<Cloud size={18} />} title="Synchronisation">
      {user ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-[14px]">
            <Check size={16} className="text-pos" /> Connecté : <span className="font-medium">{user}</span>
          </div>
          <Toggle checked={!!s.syncEnabled} onChange={(v) => void updateSettings({ syncEnabled: v }).then(() => { if (v) void syncNow(); })} label="Synchronisation automatique" />
          <div className="text-muted text-[13px]">
            {st.running ? 'Synchronisation en cours…' : st.lastSyncAt ? `Dernière synchro : ${new Date(st.lastSyncAt).toLocaleString('fr-FR')}` : 'Jamais synchronisé'}
            {st.lastError && <div className="text-neg mt-1">Erreur : {st.lastError}</div>}
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => void syncNow()} disabled={st.running}>
              <RefreshCw size={17} className={st.running ? 'animate-spin' : ''} /> Synchroniser
            </button>
            <button className="btn-ghost" onClick={logout}>
              <LogOut size={17} /> Déconnexion
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-muted text-[13px]">Connectez-vous pour synchroniser vos données chiffrées en transit (HTTPS) entre vos appareils. Chaque compte n’accède qu’à ses propres données (sécurité au niveau des lignes).</p>
          <Segmented value={mode} onChange={setMode} options={[{ value: 'in', label: 'Connexion' }, { value: 'up', label: 'Créer un compte' }]} />
          <Field label="E-mail">
            <TextInput type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Mot de passe">
            <TextInput type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <button className="btn-primary w-full" onClick={auth} disabled={busy || !email || password.length < 8}>
            {busy ? 'Patientez…' : mode === 'in' ? 'Se connecter' : 'Créer le compte'}
          </button>
        </div>
      )}
    </Section>
  );
}

// ---------- Installation ----------

function InstallSection() {
  const standalone = isStandalone();
  const ios = isIOS();
  const prompt = useInstallPrompt();
  return (
    <Section icon={<Smartphone size={18} />} title="Installation">
      {standalone ? (
        <p className="text-muted text-[14px]">L’application est installée et s’ouvre en plein écran.</p>
      ) : ios ? (
        <ol className="text-[14px] space-y-2">
          <li className="flex gap-2">
            <span className="text-muted">1.</span> Ouvrez ce site dans <strong>Safari</strong>.
          </li>
          <li className="flex gap-2 items-center flex-wrap">
            <span className="text-muted">2.</span> Touchez <Share size={16} className="inline text-info" /> <strong>Partager</strong>.
          </li>
          <li className="flex gap-2 items-center flex-wrap">
            <span className="text-muted">3.</span> Choisissez <SquarePlus size={16} className="inline" /> <strong>Sur l’écran d’accueil</strong>, puis <strong>Ajouter</strong>.
          </li>
        </ol>
      ) : prompt ? (
        <button className="btn-primary" onClick={prompt}>
          <Download size={18} /> Installer Ma Trésorerie
        </button>
      ) : (
        <p className="text-muted text-[14px]">Utilisez le menu du navigateur : « Installer l’application » (Chrome, Edge) ou « Ajouter au Dock » (Safari sur Mac).</p>
      )}
    </Section>
  );
}

export default function Settings() {
  const s = useApp((x) => x.settings);
  const { needRefresh, update } = useSWUpdate();
  return (
    <div>
      <PageHeader title="Réglages" />
      <div className="space-y-3">
        <SecuritySection />
        <Section icon={<Palette size={18} />} title="Apparence">
          <Segmented value={s.theme} onChange={(v) => void updateSettings({ theme: v })} options={[{ value: 'dark', label: 'Sombre' }, { value: 'light', label: 'Clair' }, { value: 'system', label: 'Système' }]} />
        </Section>
        <Section icon={<Tags size={18} />} title="Catégories">
          <div className="divide-y divide-line/70">
            <CategoryGroup kind="transaction" title="Catégories d’opérations" />
            <CategoryGroup kind="product" title="Catégories de produits" />
            <CategoryGroup kind="platform" title="Plateformes" />
          </div>
        </Section>
        <DataSection />
        <SyncSection />
        <InstallSection />
        <Section icon={<Info size={18} />} title="À propos">
          <p className="text-muted text-[14px]">Ma Trésorerie v{__APP_VERSION__}. Montants calculés en centimes entiers. Fonctionne hors ligne.</p>
          {needRefresh && (
            <button className="btn-primary mt-3" onClick={update}>
              <RefreshCw size={17} /> Installer la mise à jour
            </button>
          )}
        </Section>
      </div>
    </div>
  );
}
