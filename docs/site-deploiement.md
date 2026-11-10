# Site AppDashboard : publication

Adresse : **https://appdashboard.fr**, hébergée chez o2switch (dossier `public_html`). Elle est définie **une seule
fois** dans `src/config/site.json`, lue par l'app (`src/config/site.ts`) et par les tests.

## Mises à jour automatiques

À chaque push sur `main` qui touche le code (pas les docs seules), le workflow GitHub **« Site (o2switch) »**
(`.github/workflows/site-o2switch.yml`) vérifie les types, lance les tests, construit le site et le pose sur la
branche `deploiement-o2switch` (fichiers construits seulement). Le serveur o2switch tire cette branche toutes les
5 minutes (`esport/serveur/deployer.sh`) et la recopie dans `public_html`. Aucun secret d'hébergement dans GitHub.
Installation et dépannage : [o2switch.md](o2switch.md) (étape A10).

Le paquet de mise à jour de l'app iPhone (`/maj`, signé sur le PC avec `npm run publier-maj`) n'est jamais effacé
par la publication : déposez `main.jsbundle` et `manifeste.json` dans `public_html/maj/` (cPanel › Gestionnaire de
fichiers). Voir [iphone.md](iphone.md).

## Adresses des serveurs (`relais.json`, `esport.json`)

Le site publie l'adresse du relais dans `relais.json` et celle du serveur Esport dans `esport.json` (rien de
secret) : un ami qui ouvre le site sur un appareil neuf peut alors se connecter avec son identifiant et son mot de
passe (voir `docs/connexion-amis.md`). Par défaut `https://relais.appdashboard.fr` et `https://esport.appdashboard.fr` ;
variables GitHub facultatives `O2SWITCH_RELAIS_URL` et `O2SWITCH_ESPORT_URL` pour changer de domaine.

## Et le relais ?

Le relais et le serveur Esport se mettent à jour tout seuls, par la même tâche cron (`deployer.sh`) : rien à lancer.
Voir [o2switch.md](o2switch.md).

## Rendu et cache

- `bureau/public/_headers` est traduit en règles Apache (bloc « AppDashboard » du `.htaccess`, par
  `scripts/htaccess-o2switch.mjs`) : les fichiers de `assets/`, dont le nom porte une empreinte, sont gardés un an
  par le navigateur ; `index.html`, le manifeste et `/maj` sont revalidés à chaque visite, donc une nouvelle version
  est vue au chargement suivant.
- Les textes (HTML, JS, CSS, JSON, SVG, wasm) sont compressés par Apache (brotli, sinon gzip) ; le code de chaque
  app est chargé à la demande. Mesures et diagnostic : [performance.md](performance.md).
- Couleur de la barre du navigateur (`theme-color`) et polices : celles du thème affiché, posées dès l'écran
  d'accueil, même sans thème jamais choisi.
- Contrôle : `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-rendu-site.mjs`
  (après `npx vite build`), sur PC, iPad et iPhone. Captures avant/après : `docs/captures-rendu-site/`.
