# Sécurité de l'AppDashboard (site, relais, Esport) et du pont avec le site LigneZero

Revue du 11/11/2026. Portée : site appdashboard.fr (`bureau/public/_headers`, `scripts/htaccess-o2switch.mjs`),
relais (`relais/`), serveur Esport (`esport/`), pont vers lz.appdashboard.fr (`esport/noyau/site-lz/`).
Le détail côté site LigneZero est dans `docs/securite.md` du dépôt site-ligne-zero.

## Constats

| # | Gravité | Constat | Statut |
| --- | --- | --- | --- |
| 1 | Critique | Pont vers le site LigneZero : la clé `CLE_SERVICE` du site (accès propriétaire à TOUTES ses tables, partagée avec le bot) était envoyée en clair (`Bearer`) à chaque requête. | Corrigé |
| 2 | Haute | Relais, `POST /jeton/verifier` : l'adresse limitée était la **première** entrée de `X-Forwarded-For`, que n'importe quel appelant écrit lui-même → anti-force brute contourné en changeant cet en-tête. | Corrigé |
| 3 | Moyenne | Relais et Esport : à défaut de l'en-tête posé par le serveur Node, repli sur la première entrée de `X-Forwarded-For` (même problème). | Corrigé (dernière entrée) |
| 4 | Moyenne | Site appdashboard.fr : ni HSTS, ni protection contre l'encadrement (clickjacking), ni `Referrer-Policy` / `Permissions-Policy` ; fichiers cachés, sauvegardes et cartes de sources servis s'ils existent. | Corrigé |
| 5 | Moyenne | Site appdashboard.fr : aucune CSP (Content-Security-Policy) sur les scripts. Le site charge des relais, lecteurs YouTube, transformers.js, images Valorant… : une CSP complète demande un inventaire et des essais. | À faire (liste de départ dans `bureau/public/_headers`) |
| 6 | Moyenne | Serveur Esport : `nodemailer` 10.0.13 (analyse des adresses contournable). | Corrigé (10.5.0) |
| 7 | Haute | Dépendances de l'app (outils React Native : `shell-quote`, `body-parser`, `joi`, `launch-editor`, `qs`, `fast-xml-parser`). Jamais déployées sur un serveur ni dans le site. | Corrigé (versions correctives) ; `deepmerge` (faible, CLI React Native) accepté |
| 8 | Info | Interactions Discord : signature Ed25519 vérifiée (clé publique de l'application), horodatage de 5 minutes, corps borné. | Conforme |
| 9 | Info | Liens signés de fichiers (résumés, Drive CM, ressources, pièces de tickets) : HMAC par `CLE_ESPORT`, genre, compte et expiration dans la signature, accès revérifié pour Drive / ressources / tickets ; clés de stockage sans `..` ni caractères hors liste. | Conforme |
| 10 | Info | CORS `*` sur le relais et l'Esport : authentification par jeton `Bearer` (jamais de cookie), sans `Access-Control-Allow-Credentials`. | Accepté |
| 11 | Info | Erreurs internes : message générique au client (« Erreur interne »), détail au journal seulement. Journaux : valeurs des variables sensibles, jetons, URL de base, webhooks et e-mails masqués (`journal-fichier.mjs`). | Conforme |
| 12 | Info | IA (assistant d'écriture, profils de jeu) : plafond mensuel, 30 demandes / minute / compte, le texte envoyé est celui de l'utilisateur (une injection de consigne ne touche que sa propre réponse). | Conforme |
| 13 | Basse | Routes de l'Esport : session obligatoire hors routes publiques, droits vérifiés dans chaque service (échantillon revu : événements, pont du site, tickets, fichiers, statistiques, déploiement). Une revue exhaustive route par route (IDOR entre teams) reste à faire. | À faire |

## Ce qui a changé

### Pont vers le site LigneZero (n° 1)

`esport/noyau/site-lz/client.mjs` :

- La clé du pont `CLE_PONT` (créée par le déploiement du site dans `~/.lignezero/api.env`) **ne voyage jamais** :
  chaque requête porte `x-lz-horodatage`, `x-lz-nonce` (18 octets aléatoires) et `x-lz-signature`
  = HMAC-SHA256(`LZ1\nPOST\n/rest\n<horodatage>\n<nonce>\n<sha256 du corps>`). Le site refuse une requête modifiée,
  trop vieille (5 min) ou rejouée.
- Côté site, cette clé n'ouvre que les tournois (lecture), équipes et joueurs de tournoi, colonnes et filtres listés,
  sans suppression de masse, avec un journal des écritures. Le client ne demande que les colonnes utiles.
- HTTPS obligatoire (sauf localhost), aucune redirection suivie, 15 s maximum, message d'erreur du site borné.
- La configuration est relue au plus une fois par minute : une clé créée ou changée sur le site est prise **sans
  redémarrer l'Esport**.
- **Ordre de déploiement libre** : tant que le site n'a pas créé `CLE_PONT`, l'ancien accès (`Bearer CLE_SERVICE`)
  sert encore ; le site l'accepte jusqu'au 25/11/2026, limité aux trois tables du pont.

### Adresse du navigateur entre l'Esport et le relais (n° 2 et 3)

- Le serveur Esport fait vérifier les jetons par le relais en annonçant l'adresse du navigateur. Le relais ne la croit
  plus que si elle est **prouvée** : HMAC-SHA256 par une clé partagée du même hébergement
  (`~/.appdashboard/adresse-relais.cle`, droits 600, créée par le relais à son démarrage, lue par l'Esport), liée à
  l'adresse, à l'heure (2 minutes) et au jeton vérifié (`relais/preuve-adresse.mjs`).
- Sans preuve valable, c'est l'adresse de la connexion qui compte (dernière entrée de `X-Forwarded-For`, ajoutée par
  le proxy). Un attaquant qui change la première entrée reste bloqué comme avant.
- `CLE_ADRESSE_RELAIS` (32 caractères au moins) dans `esport.env` remplace le fichier si le relais est ailleurs.

### Site appdashboard.fr (n° 4)

Bloc `.htaccess` généré : `Strict-Transport-Security`, `Referrer-Policy: strict-origin-when-cross-origin`,
`X-Frame-Options: SAMEORIGIN`, `Permissions-Policy` (géolocalisation, paiement, USB, série coupés),
fichiers cachés (sauf `/.well-known`), sauvegardes, journaux, `.map`, `.env` en 404, en plus de
`Options -Indexes` et `nosniff` déjà présents.

## Tests

- `esport/test/site-lz-pont.test.mjs` : signature vérifiable, clé jamais envoyée, nonce unique, HTTPS obligatoire,
  clé relue sans redémarrage, ancien accès tant que le site n'est pas à jour.
- `relais/verification.test.mjs` : `X-Forwarded-For` falsifié → toujours bloqué ; preuve valable acceptée ; preuve
  fausse, périmée, d'un autre jeton ou sans clé : ignorée.
- `esport/test/securite-adresse.test.mjs` : clé partagée créée en 600 puis relue ; Esport → relais de bout en bout.
- `esport/test/htaccess-site.test.mjs` : en-têtes et blocages du `.htaccess`.

## Ce que le fondateur doit faire sur le serveur

Aucun secret à copier ni à coller dans une conversation. Les commandes se lancent dans **cPanel › Terminal** et
n'affichent jamais une clé.

### Ordre de mise en ligne

1. **Site LigneZero** (déjà poussé) : la tâche cron le met à jour dans les 5 minutes et crée `CLE_PONT`.
2. **AppDashboard** : mise à jour habituelle (le déploiement redémarre le relais puis l'Esport). Le relais crée
   `~/.appdashboard/adresse-relais.cle` à son démarrage ; l'Esport la lit à la première connexion.

L'ordre inverse marche aussi (voir plus haut). Rien à ajouter dans `esport.env` ni `relais.env`.

### Vérifications (une fois)

```
ls -l ~/.appdashboard/adresse-relais.cle
grep -c '^CLE_PONT=' ~/.lignezero/api.env
curl -sI https://appdashboard.fr | grep -iE 'strict-transport|x-frame'
```

Attendu : un fichier `-rw-------`, le chiffre `1`, puis les deux en-têtes. Dans l'app : Administration ›
Événements › un événement lié au site › « Synchroniser » doit réussir.

Si le fichier de clé n'existe pas (relais pas encore redémarré) : cPanel › Setup Node.js App › relais › **Restart**,
puis l'Esport › **Restart**. Tant qu'il manque, les connexions marchent comme avant ; seul le compteur
anti-force brute de la vérification des jetons est commun à tous les navigateurs.

### Changer la clé d'adresse (en cas de doute)

```
rm -f ~/.appdashboard/adresse-relais.cle && mkdir -p ~/application-enzo/relais/tmp ~/application-enzo/esport/tmp && touch ~/application-enzo/relais/tmp/restart.txt ~/application-enzo/esport/tmp/restart.txt && echo "Clé d'adresse renouvelée au prochain démarrage"
```

Puis ouvrir l'app une fois (le relais redémarre et recrée la clé, l'Esport la relit à son redémarrage).

### Clés du site LigneZero

Rotation de `CLE_PONT` et de la clé du bot : voir `docs/securite.md` du dépôt site-ligne-zero (l'Esport suit tout
seul, sans redémarrage).
