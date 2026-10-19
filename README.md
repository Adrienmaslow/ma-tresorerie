# Solde — PWA de gestion de trésorerie personnelle

Application web progressive (React + TypeScript + Tailwind CSS + Vite + vite-plugin-pwa) installable sur iPhone, Android, Mac et PC. Les données sont stockées localement dans IndexedDB, l'application fonctionne hors ligne, et une synchronisation entre appareils via Supabase peut être activée.

---

## 1. Démarrage rapide (en local)

Prérequis : Node.js 18 ou plus récent.

```bash
npm install
npm run dev        # serveur de développement : http://localhost:5173
npm test           # tests unitaires des calculs, de la sécurité et de la synchro
npm run build      # build de production dans dist/
npm run preview    # sert dist/ sur http://localhost:4173 (Service Worker actif)
```

> Le Service Worker (mode hors ligne) n'est actif qu'avec `build` + `preview` ou une fois déployé, pas avec `npm run dev`.

---

## 2. Déploiement en HTTPS

### Déploiement actuel : GitHub Pages
L'application est publiée sur **https://adrienmaslow.github.io/ma-tresorerie/**.
- Le code source est sur la branche `main` ; le site compilé sur la branche `gh-pages`.
- Pour republier : `npm run build:pages`, puis publier le contenu de `dist/` sur la branche `gh-pages`.
- Après chaque publication, l'application installée affiche « Une nouvelle version est disponible » → **Mettre à jour**. Les données ne sont pas touchées.
- Note : toutes les pages GitHub de votre compte partagent le domaine `adrienmaslow.github.io`. N'y publiez que des projets de confiance (les vôtres).

### Autres hébergeurs

Une PWA **exige HTTPS** (sauf sur `localhost`) : sans HTTPS, pas de Service Worker, pas d'installation, pas de Face ID / Touch ID.
Le résultat du build (`dist/`) est un site 100 % statique : n'importe quel hébergeur statique convient. Tous ceux ci-dessous fournissent le HTTPS automatiquement et gratuitement.

### Option A — Netlify (le plus simple)
1. Créez un compte sur netlify.com.
2. **Sans Git** : lancez `npm run build`, puis glissez-déposez le dossier `dist/` sur https://app.netlify.com/drop.
3. **Avec Git** : « Add new site → Import an existing project », choisissez le dépôt, puis
   - Build command : `npm run build`
   - Publish directory : `dist`
4. Le fichier `public/_redirects` (déjà fourni) gère la redirection vers `index.html`.
5. Votre application est en ligne sur `https://<nom>.netlify.app`.

### Option B — Vercel
1. Importez le dépôt sur vercel.com (framework détecté : **Vite**).
2. Build command `npm run build`, output `dist`. Le fichier `vercel.json` fourni règle les en-têtes de cache.

### Option C — Cloudflare Pages
1. Pages → « Create a project » → connectez le dépôt.
2. Framework preset : **Vite** (build `npm run build`, sortie `dist`).

### Option D — Votre propre serveur (Nginx + Let's Encrypt)
```bash
npm run build
scp -r dist/* utilisateur@serveur:/var/www/ma-tresorerie/
sudo certbot --nginx -d tresorerie.mondomaine.fr   # certificat HTTPS gratuit
```
Configuration Nginx minimale :
```nginx
server {
  server_name tresorerie.mondomaine.fr;
  root /var/www/ma-tresorerie;
  location / { try_files $uri /index.html; }
  # Le Service Worker et le manifeste ne doivent jamais être mis en cache par le navigateur
  location = /sw.js { add_header Cache-Control "no-cache"; }
  location = /manifest.webmanifest { add_header Cache-Control "no-cache"; }
  location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; }
}
```

### Nom de domaine personnalisé
Tous les hébergeurs ci-dessus permettent d'ajouter votre domaine (ex. `tresorerie.mondomaine.fr`) avec certificat HTTPS automatique.
⚠️ Choisissez le domaine **avant** d'installer l'application sur vos appareils : les données locales et l'enregistrement Face ID sont liés au domaine. Changer de domaine revient à repartir d'une base vide (exportez puis importez une sauvegarde JSON).

---

## 3. Installation sur iPhone (Safari)

1. Ouvrez l'adresse HTTPS de l'application dans **Safari** (obligatoire sur iOS pour l'installation).
2. Touchez le bouton **Partager** (carré avec une flèche vers le haut) en bas de l'écran.
3. Faites défiler et touchez **« Sur l'écran d'accueil »**.
4. Vérifiez le nom **« Trésorerie »**, puis touchez **Ajouter**.
5. Lancez l'application depuis l'icône : elle s'ouvre en plein écran, sans barre Safari.

Recommandations iPhone :
- Ouvrez toujours l'application **depuis l'icône** de l'écran d'accueil. Sur iOS, les données d'une application installée sont conservées ; celles d'un simple site Safari peuvent être effacées après 7 jours sans visite.
- Les données de l'application installée sont séparées de celles de Safari : saisissez vos données dans l'application installée.
- Pour Face ID : Réglages de l'app → Sécurité → activez le code PIN, puis « Face ID / Touch ID » (iOS 16 ou plus récent).

### Android (Chrome)
Ouvrez l'URL → menu ⋮ → **Installer l'application** (ou bouton « Installer » dans Réglages → Installation).

### Mac
- Safari (macOS Sonoma ou plus récent) : menu **Fichier → Ajouter au Dock**.
- Chrome / Edge : icône d'installation dans la barre d'adresse.

### PC Windows
Chrome ou Edge : icône d'installation dans la barre d'adresse, ou menu → **Installer Ma Trésorerie**.

### Mises à jour
Après un nouveau déploiement, l'application affiche « Une nouvelle version est disponible » → **Mettre à jour**. Les données ne sont pas touchées.

---

## 4. Synchronisation entre appareils (optionnelle, Supabase)

Sans configuration, tout reste sur l'appareil. Pour synchroniser iPhone, Mac et PC :

1. Créez un projet gratuit sur supabase.com.
2. Dans **SQL Editor**, exécutez le contenu de `supabase/schema.sql` (table, règles RLS, fonction de fusion).
3. Dans **Authentication → Providers**, laissez « Email » activé. (Dans « URL Configuration », renseignez l'URL HTTPS de votre application.)
4. Récupérez dans **Project Settings → API** l'URL du projet et la clé `anon` publique.
5. Créez un fichier `.env` à la racine (voir `.env.example`) :
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
   Sur Netlify / Vercel / Cloudflare, ajoutez ces deux variables dans les paramètres du site puis redéployez.
6. Dans l'application : **Réglages → Synchronisation** → créez un compte ou connectez-vous sur chaque appareil.

Fonctionnement : chaque modification est horodatée ; la synchronisation se fait automatiquement (au démarrage, après chaque modification, au retour en ligne et toutes les minutes). En cas de modification concurrente du même élément, la plus récente l'emporte. Les suppressions sont propagées. Hors ligne, les modifications sont gardées puis envoyées au retour du réseau.
La clé `anon` est publique par conception : la sécurité repose sur les règles RLS du schéma, qui limitent chaque utilisateur à ses propres lignes.

> La partie Supabase a été testée avec un serveur simulé (tests unitaires de convergence), mais pas contre un vrai projet Supabase : faites un essai avec deux appareils avant d'en dépendre.

---

## 5. Fonctionnement des calculs

Tous les montants sont stockés en **centimes entiers** (aucun calcul en virgule flottante).

| Carte | Calcul |
|---|---|
| Liquidités | Somme des soldes des comptes. Le solde d'un compte est calculé uniquement à partir de ses opérations. |
| Argent en attente | Paiements « en attente » + « litige » + reste dû sur l'argent prêté |
| Argent bloqué | Paiements au statut « bloqué » |
| Valeur du stock | Quantité × prix d'achat des articles non vendus |
| Trésorerie totale | Liquidités + en attente + bloqué + stock |
| Argent à payer | Reste dû des paiements à venir et des dettes + prochaine échéance de chaque charge récurrente |
| Trésorerie prévisionnelle | Liquidités + en attente + bloqué − argent à payer |
| Bénéfices réalisés | Σ (prix de vente réel × quantité − coût d'achat − frais) des articles vendus |

Pas de double comptage :
- **Transfert** : débite un compte et crédite l'autre, le total ne bouge pas.
- **Paiement reçu** : sort de « En attente » et entre dans le compte choisi via une opération liée. Revenir au statut « en attente » supprime l'opération.
- **Achat de stock** payé depuis un compte : les liquidités deviennent du stock, le total ne bouge pas.
- **Vente** : l'article sort du stock (au coût) et le prix net entre en liquidités ou en attente, donc seule la marge modifie le total. Une vente partielle scinde la ligne.
- **Prêt accordé** : les liquidités deviennent une créance « en attente ».
- **Modifier directement un solde** crée un « ajustement » daté, ce qui garde l'historique cohérent.

Les graphiques d'évolution sont reconstruits jour par jour à partir des dates des opérations, ventes, achats et réceptions.

---

## 6. Sécurité

- **Code PIN** (4 à 8 chiffres) : jamais enregistré. Seule une empreinte PBKDF2-SHA-256 (210 000 itérations, sel aléatoire de 16 octets) est gardée, et la comparaison se fait en temps constant. Après 5 erreurs, un délai croissant s'applique (30 s, 60 s… jusqu'à 15 min).
- **Biométrie** : WebAuthn avec l'authentificateur de l'appareil (Face ID, Touch ID, Windows Hello), avec vérification de l'utilisateur obligatoire. Le PIN reste toujours utilisable.
- **Verrouillage automatique** au retour d'arrière-plan ou après inactivité (immédiat, 1, 5, 15 ou 60 min). L'écran est masqué quand l'application passe en arrière-plan.
- **Masquage des montants** (icône œil), avec option « masquer au démarrage ».
- **Cache** : le Service Worker ne met en cache que les fichiers statiques de l'application (HTML, JS, CSS, icônes). Aucune donnée financière ni réponse d'API n'y est stockée ; les données sont uniquement dans IndexedDB.

Limite à connaître : le verrouillage protège l'**interface**. Les données IndexedDB ne sont pas chiffrées par l'application. Elles sont protégées par le chiffrement de l'appareil (iOS les chiffre quand le téléphone est verrouillé) et par l'isolation par domaine du navigateur. Gardez un code de verrouillage sur l'appareil lui-même.

---

## 7. Sauvegarde, import et export

Réglages → Données :
- **Sauvegarde complète JSON** (à faire régulièrement) et restauration.
- **Export CSV** des opérations, des paiements en attente et du stock (séparateur `;`, compatible Excel FR).
- **Import CSV** d'opérations : colonnes `date;type;montant;compte;compte_destination;categorie;plateforme;description` (le format de l'export). Les comptes inconnus sont créés.

---

## 8. Structure du projet

```
src/
  types.ts              Modèle de données (montants en centimes)
  lib/calc.ts           Calculs financiers, historique, statistiques
  lib/money.ts          Saisie et formatage des montants sans flottants
  lib/security.ts       PIN (PBKDF2) et biométrie (WebAuthn)
  lib/io.ts, importCsv  Import et export JSON / CSV
  db/db.ts              IndexedDB (idb)
  store/store.ts        État de l'application + écriture atomique
  store/actions.ts      Règles métier (transferts, ventes, réceptions…)
  sync/engine.ts        Moteur de synchronisation (dernier écrit gagne, suppressions logiques)
  sync/supabase.ts      Adaptateur Supabase
  pages/                Accueil, Liquidités, En attente, Stock, Historique,
                        Dépenses & dettes, Statistiques, Réglages
  components/           Interface, formulaires, écran de verrouillage
supabase/schema.sql     Schéma + RLS pour la synchronisation
scripts/                Icône source + génération des PNG (npm run icons)
```

Pour changer l'icône, modifiez `scripts/icon.svg` puis lancez `npm run icons`.
