# Site de secours AppDashboard : publication

Adresse : **https://appdashboard.pages.dev** (projet Cloudflare Pages
`appdashboard`). Elle est définie **une seule fois** dans
`src/config/site.json`, lue par l'app (`src/config/site.ts`), le script
`npm run relais:site` et le workflow `.github/workflows/site.yml`.

## Première publication (à faire une fois, sur le PC)

1. Dans le dossier du projet : `npm run relais:site`.
2. Une fenêtre Cloudflare s'ouvre : connectez-vous et acceptez.
3. Le script crée le projet Pages `appdashboard` s'il n'existe pas, construit
   le site et le publie. Il affiche `Site de secours : https://appdashboard.pages.dev`.
4. Vérifiez : ouvrez cette adresse (l'écran de connexion d'AppDashboard
   apparaît) ; sur le PC, Paramètres › Synchronisation affiche le même lien.

Si Cloudflare répond que le nom est déjà pris, choisissez un autre nom dans
`src/config/site.json` (`projetPages` et `site`) et relancez.

## Mises à jour automatiques (GitHub Actions)

À chaque push sur `main` qui touche le code (pas les docs seules), le workflow
« Site (Cloudflare Pages) » vérifie les types, lance les tests, construit le
site et le publie. Il ne publie **jamais** une autre branche que `main`.

À faire une fois :

1. **Créer le jeton Cloudflare** : dash.cloudflare.com › My Profile › API
   Tokens › Create Token › « Create Custom Token » ; permission
   **Account › Cloudflare Pages › Edit** ; ressource : votre compte. Copiez le
   jeton (affiché une seule fois).
2. **Trouver l'identifiant de compte** : dash.cloudflare.com › Workers & Pages
   (colonne de droite : « Account ID »).
3. **Les coller dans GitHub** : dépôt › Settings › Secrets and variables ›
   Actions › New repository secret, deux fois :
   `CLOUDFLARE_API_TOKEN` (le jeton) et `CLOUDFLARE_ACCOUNT_ID` (l'identifiant).
   Ne les écrivez nulle part ailleurs (ni code, ni docs, ni chat).
4. **Vérifier** : onglet Actions › « Site (Cloudflare Pages) » › Run workflow
   (branche `main`). Le job doit finir en vert, puis
   https://appdashboard.pages.dev se met à jour. Sans les secrets, le job
   s'arrête tout de suite avec un message qui nomme le secret manquant.

Le paquet de mise à jour de l'app iPhone (`/maj`, signé sur le PC) est repris
tel qu'il est en ligne : la publication automatique ne l'efface pas. Il ne se
renouvelle que par `npm run relais:site` sur le PC.

## Transition depuis l'ancienne adresse

L'ancien site (`applibourse-ef0ddb.pages.dev`) n'est pas supprimé : les codes
de liaison (`AB1.…`) déjà émis contiennent leur adresse et continuent de
l'ouvrir. Le relais accepte toutes les origines (CORS ouvert ; l'accès est
protégé par le jeton), donc l'ancien et le nouveau site parlent au même relais
sans rien changer. Les nouveaux liens et QR codes utilisent la nouvelle
adresse. Quand plus aucun appareil n'utilise l'ancien lien, supprimez l'ancien
projet dans Cloudflare › Workers & Pages.
