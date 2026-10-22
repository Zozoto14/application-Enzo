# Tout le dashboard chez o2switch (au lieu de Cloudflare)

Ce guide déménage **les trois parties en ligne** du dashboard sur l'hébergement o2switch du Fondateur :

| Quoi | Aujourd'hui (Cloudflare) | Demain (o2switch) |
| --- | --- | --- |
| **Site** (l'app dans le navigateur) | `https://applibourse-ef0ddb.pages.dev` | **https://appdashboard.fr** (dossier `public_html`) |
| **Relais** (synchro chiffrée, invitations, connexion des amis, Tsuzuku, support…) | `https://applibourse-relais.<vous>.workers.dev` | **https://relais.appdashboard.fr** |
| **Serveur Esport** (teams, planning, résumés, Discord…) | `https://applibourse-esport.<vous>.workers.dev` | **https://esport.appdashboard.fr** |

Tout reste en place sur Cloudflare jusqu'à la bascule (partie C), et même après : l'ancien relais et l'ancien
serveur Esport **transmettent** alors tout à o2switch, pour que les appareils pas encore à jour continuent de marcher.
Rien n'est supprimé sur Cloudflare (partie F explique comment le couper, plus tard).

Comptez **1 h 30** pour la préparation (parties A et B, sans rien casser) et **30 minutes** pour la bascule (partie C).

---

## Les valeurs de votre hébergement

Elles servent partout dans ce guide. Aucune n'est secrète.

| Nom | Valeur |
| --- | --- |
| Identifiant cPanel | `jayo8828` |
| Dossier personnel | `/home/jayo8828` |
| Domaine | `appdashboard.fr` (dossier du site : `/home/jayo8828/public_html`) |
| Adresse IP du serveur | `109.234.167.229` |
| Base PostgreSQL | `jayo8828_Data__esport` (attention : **deux** tirets bas avant `esport`) |
| Utilisateur PostgreSQL | `jayo8828_esport` |
| Dossier du code | `/home/jayo8828/application-enzo` |
| Dossier des fichiers Esport (PDF, miniatures, vidéos, enregistrements) | `/home/jayo8828/esport-fichiers` (jamais dans `public_html`) |
| Fichiers de configuration (secrets) | `/home/jayo8828/.appdashboard/esport.env` et `relais.env` (jamais dans le dépôt) |
| Journaux | `/home/jayo8828/logs/` |

Les **secrets** (mot de passe PostgreSQL, jeton maître du relais…) ne sont écrits **que** dans les deux fichiers
`.env` ci-dessus, sur le serveur. Jamais dans GitHub, jamais dans ce guide.

Dans les commandes, remplacez seulement ce qui est en MAJUSCULES : `MOT_DE_PASSE_POSTGRES`, `JETON_MAITRE`,
`VOTRE-SOUS-DOMAINE` (la partie entre `applibourse-relais.` et `.workers.dev` de vos adresses Cloudflare actuelles).

### Comment ça marche (en bref)

- **Deux petites apps Node** dans « Setup Node.js App » : le **relais** et le **serveur Esport**. Elles font tourner
  exactement le même code que sur Cloudflare.
- **Une seule base PostgreSQL** pour les deux, dans un schéma `appdashboard` (créé tout seul) : les tables de
  l'Esport, et la table `relais_kv` qui remplace la « boîte » Cloudflare KV du relais (les données y restent
  chiffrées par vos appareils : le serveur ne peut pas les lire).
- **L'Esport fait vérifier les jetons par le relais** en HTTPS (`https://relais.appdashboard.fr/jeton/verifier`),
  comme sur Cloudflare. On garde ce chemin plutôt que de tout mettre dans un seul programme : ainsi le serveur
  Esport ne connaît **jamais** le jeton maître (seul le relais l'a), et une panne de l'un ne bloque pas l'autre.
- **Mises à jour automatiques « par pull »** : o2switch n'accepte pas de connexion venue de GitHub, et il n'y a pas
  de jeton API cPanel. C'est donc le serveur qui va chercher les nouveautés : toutes les 5 minutes, une tâche cron
  lance `esport/serveur/deployer.sh`, qui récupère le code (clé de déploiement GitHub en **lecture seule**), installe
  les dépendances, met la base à jour, redémarre les deux apps, et recopie le site construit par GitHub.
- **Déménagement des données** : c'est le serveur o2switch qui **tire** lui-même les données des Workers Cloudflare,
  par des routes d'administration protégées par le jeton maître. Pas de fichier d'export à télécharger, pas
  d'artefact GitHub : rien ne traîne nulle part.

---

## Partie A — Préparer (rien ne change pour les utilisateurs)

### A1. Mettre à jour les deux Workers Cloudflare (2 minutes)

Ils apprennent les routes du déménagement (export de la boîte, des fichiers), sans rien changer d'autre.

1. GitHub › dépôt **application-Enzo** › onglet **Actions** › **Relais (Cloudflare Worker)** › **Run workflow** ›
   branche `main` › **Run workflow**. Attendez la coche verte.
2. **Actions** › **Esport (Worker)** › **Run workflow** › `main` › **Run workflow**. Coche verte.

### A2. La base PostgreSQL (5 minutes)

La base et l'utilisateur existent déjà. On vérifie seulement.

1. cPanel › section **Bases de données** › **Bases de données PostgreSQL**.
2. Dans **Bases de données actuelles**, la ligne `jayo8828_Data__esport` doit montrer l'utilisateur
   `jayo8828_esport` dans la colonne **Utilisateurs privilégiés**.
   - Sinon : plus bas, **Ajouter un utilisateur à la base de données** › utilisateur `jayo8828_esport`, base
     `jayo8828_Data__esport` › **Envoyer** (tous les privilèges).
3. Mot de passe : si vous ne le connaissez plus, section **Utilisateurs actuels** › `jayo8828_esport` ›
   **Changer le mot de passe** (un long mot de passe ; gardez-le pour l'étape A6).
4. Vérifier qu'elle est vide : cPanel › **phpPgAdmin** › à gauche `jayo8828_Data__esport` › **Schémas** ›
   `public` › **Tables** : « Aucune table trouvée ». Les **7,23 Mo** affichés sont normaux : c'est la taille d'une base
   PostgreSQL vide (le catalogue du système). Nos tables iront dans un schéma à part, `appdashboard`.

### A3. Clé SSH pour lire le dépôt GitHub (10 minutes)

Le serveur doit pouvoir **lire** (jamais écrire) le dépôt privé.

1. cPanel › section **Sécurité** › **Accès SSH** › **Gérer les clés SSH** › **Générer une nouvelle clé**.
   - **Nom de la clé** : `github_appdashboard`
   - **Mot de passe de la clé** : laissez **vide** (la tâche cron doit pouvoir s'en servir seule ; la clé ne permet
     que de lire ce dépôt).
   - **Type de clé** : RSA, **taille** 4096 › **Générer la clé** › **Revenir**.
   - Pas besoin de « Autoriser » la clé : ça sert aux connexions **vers** o2switch, pas vers GitHub.
2. Dans **Clés publiques**, ligne `github_appdashboard.pub` › **Afficher/Télécharger** › copiez tout le texte (il
   commence par `ssh-rsa`). C'est la clé **PUBLIQUE** : elle peut être montrée sans danger.
   Ne copiez jamais la clé **privée**.
3. GitHub › dépôt **application-Enzo** › **Settings** › **Deploy keys** › **Add deploy key** :
   - **Title** : `o2switch`
   - **Key** : collez la clé publique
   - **Allow write access** : **laisser décoché** (lecture seule)
   - **Add key**.
4. cPanel › section **Avancé** › **Terminal** (acceptez l'avertissement). Tapez ces lignes une par une
   (elles disent à `git` d'utiliser cette clé, par le port 443 qui n'est jamais bloqué) :

   ```bash
   mkdir -p ~/.ssh && chmod 700 ~/.ssh
   printf 'Host github.com\n  HostName ssh.github.com\n  Port 443\n  User git\n  IdentityFile ~/.ssh/github_appdashboard\n  IdentitiesOnly yes\n' >> ~/.ssh/config
   chmod 600 ~/.ssh/config
   ssh -T git@github.com
   ```

   À la question « Are you sure you want to continue connecting », tapez `yes`. La réponse attendue :
   « Hi Zozoto14/application-Enzo! You've successfully authenticated, but GitHub does not provide shell access. »

### A4. Copier le dépôt sur le serveur (5 minutes)

1. cPanel › section **Fichiers** › **Git™ Version Control** › **Créer**.
2. **Clone a Repository** : activé.
   - **Clone URL** : `git@github.com:Zozoto14/application-Enzo.git`
   - **Repository Path** : `/home/jayo8828/application-enzo` (hors de `public_html` : le code n'est jamais visible
     sur le web)
   - **Repository Name** : `application-enzo`
3. **Créer**. La copie prend une à deux minutes.

### A5. Sous-domaines et certificats HTTPS (10 minutes)

1. cPanel › section **Domaines** › **Domaines** › **Créer un nouveau domaine** :
   - **Domaine** : `esport.appdashboard.fr`
   - **Décochez** « Partager la racine du document » ; **Racine du document** : `/home/jayo8828/esport.appdashboard.fr`
     (hors de `public_html` : la mise à jour du site ne doit jamais y toucher)
   - **Envoyer**.
2. Pareil pour `relais.appdashboard.fr`, racine `/home/jayo8828/relais.appdashboard.fr`.
3. Si les DNS de `appdashboard.fr` ne sont **pas** chez o2switch : chez votre registraire, ajoutez deux
   enregistrements **A** : `esport` → `109.234.167.229` et `relais` → `109.234.167.229`. (S'ils sont chez o2switch,
   c'est déjà fait.)
4. Certificats : cPanel › section **Sécurité** › **SSL/TLS Status** › cochez `appdashboard.fr`,
   `www.appdashboard.fr`, `esport.appdashboard.fr`, `relais.appdashboard.fr` › **Run AutoSSL** (Let's Encrypt,
   gratuit, renouvelé tout seul). Attendez les cadenas verts (quelques minutes).

### A6. Les deux fichiers de configuration (10 minutes)

Ils contiennent les secrets. Ils sont **hors du dépôt** et **hors de `public_html`**, lisibles par vous seul.

Avant de commencer, munissez-vous de :

- **le mot de passe PostgreSQL** (étape A2) ;
- **le jeton maître du relais** : sur le PC, fichier `relais/relais-local.json` du dossier de l'app, valeur de
  `"jeton"`. Il faut **le même** qu'aujourd'hui : les jetons des amis en sont dérivés ;
- facultatif : l'adresse du **webhook Discord du support**. Celle posée sur Cloudflare ne se relit PAS (secret) :
  créez-en une nouvelle dans Discord (voir [support.md](support.md) § 1) ; et pour le **bot Discord** :
  `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY` (Discord Developer Portal › votre app › **General Information**) et
  `DISCORD_BOT_TOKEN` (onglet **Bot** › **Reset Token** si vous ne l'avez plus) ;
- facultatif : la boîte d'envoi **noreply@appdashboard.fr** et son mot de passe, pour les **e-mails envoyés par le
  serveur** (invitations, réponses du support, Messagerie) : voir [emails.md](emails.md) §§ 1 et 2.

Dans le **Terminal** cPanel :

```bash
mkdir -p ~/.appdashboard ~/logs ~/esport-fichiers && chmod 700 ~/.appdashboard ~/esport-fichiers
openssl rand -hex 32
nano ~/.appdashboard/esport.env
```

La ligne `openssl` affiche une longue clé : copiez-la (clé **provisoire** : l'import de la partie C la remplace
par celle de Cloudflare). Dans l'éditeur qui s'ouvre, collez ceci, puis remplacez les MAJUSCULES :

```ini
# Serveur Esport (o2switch) : NE JAMAIS copier ce fichier ailleurs.
PGHOST=localhost
PGPORT=5432
PGDATABASE=jayo8828_Data__esport
PGUSER=jayo8828_esport
PGPASSWORD=MOT_DE_PASSE_POSTGRES
CLE_ESPORT=LA_CLE_AFFICHEE_PAR_OPENSSL
RELAIS_URL=https://relais.appdashboard.fr
URL_PUBLIQUE=https://esport.appdashboard.fr
FICHIERS_DIR=/home/jayo8828/esport-fichiers
LIEN_APP=https://appdashboard.fr
# Bot Discord (facultatif) :
DISCORD_APPLICATION_ID=
DISCORD_PUBLIC_KEY=
DISCORD_BOT_TOKEN=
# Récapitulatif e-mail de l'Esport (facultatif, docs/emails.md) : les mêmes lignes que dans relais.env
SMTP_HOST=
SMTP_PORT=465
SMTP_USER=
SMTP_PASS=
MAIL_FROM=AppDashboard <noreply@appdashboard.fr>
# Vidéos déposées (facultatif, voir docs/esport/videos.md) : plafond par fichier, taille des morceaux d'envoi.
# ESPORT_VIDEO_MAX=10G
# ESPORT_TAILLE_MORCEAU=8M
# Transcription des réunions sur le serveur (facultatif, partie H) :
# TRANSCRIPTION_MODELE=base
# TRANSCRIPTION_THREADS=1
```

Enregistrez : **Ctrl+O**, **Entrée**, puis **Ctrl+X**. Ensuite :

```bash
nano ~/.appdashboard/relais.env
```

```ini
# Relais (o2switch) : NE JAMAIS copier ce fichier ailleurs.
PGHOST=localhost
PGPORT=5432
PGDATABASE=jayo8828_Data__esport
PGUSER=jayo8828_esport
PGPASSWORD=MOT_DE_PASSE_POSTGRES
JETON=JETON_MAITRE
URL_PUBLIQUE=https://relais.appdashboard.fr
ORIGINES_SITE=https://appdashboard.fr,https://www.appdashboard.fr,https://applibourse-ef0ddb.pages.dev
# Support Discord (facultatif, docs/support.md) : URL du webhook du salon support
DISCORD_WEBHOOK_URL=
# Salon support de type TEXTE seulement : le bot ouvre un fil par demande (même jeton que esport.env)
DISCORD_BOT_TOKEN=
# E-mails envoyés par le serveur (facultatif, docs/emails.md)
SMTP_HOST=mail.appdashboard.fr
SMTP_PORT=465
SMTP_USER=noreply@appdashboard.fr
SMTP_PASS=MOT_DE_PASSE_DE_LA_BOITE_NOREPLY
MAIL_FROM=AppDashboard <noreply@appdashboard.fr>
LIEN_APP=https://appdashboard.fr
```

(Sans `SMTP_*`, laissez ces lignes vides : l'app garde l'envoi par votre messagerie, `mailto:`.)

**Ctrl+O**, **Entrée**, **Ctrl+X**, puis :

```bash
chmod 600 ~/.appdashboard/*.env
```

(Les variables peuvent aussi être saisies dans « Setup Node.js App » › **Environment variables** ; celles de
l'interface passent avant le fichier. Le fichier reste nécessaire pour les tâches cron, qui ne voient pas
l'interface : le plus simple est de tout mettre dans le fichier.)

### A7. Les deux apps Node (10 minutes)

cPanel › section **Logiciel** › **Setup Node.js App** › **Create Application**, deux fois :

| Champ | App Esport | App relais |
| --- | --- | --- |
| **Node.js version** | **22** (la plus récente 22.x proposée) | **22** (la même) |
| **Application mode** | Production | Production |
| **Application root** | `application-enzo/esport` | `application-enzo/relais` |
| **Application URL** | `esport.appdashboard.fr` (chemin vide) | `relais.appdashboard.fr` (chemin vide) |
| **Application startup file** | `serveur/app.cjs` | `serveur/app.cjs` |
| **Passenger log file** | `/home/jayo8828/logs/esport-passenger.log` | `/home/jayo8828/logs/relais-passenger.log` |

Cliquez **Create** pour chacune. Puis, dans l'app **Esport** seulement : bouton **Run NPM Install** (il installe le
seul paquet nécessaire, `pg`, pour les deux apps). Dans l'app relais, inutile : elle n'a aucune dépendance à elle et
utilise celles de l'Esport.

Pourquoi Node **22** : les serveurs utilisent `fetch`, `Request`/`Response` et WebCrypto intégrés (Node 22 les a
tous ; ils refusent de démarrer avec une version plus ancienne et le disent dans le journal). Le paquet `pg` marche
avec Node 16 et plus. (`node:sqlite`, utilisé seulement par les tests et le serveur de développement, demande 22.13 ou
plus ; il ne sert pas sur o2switch.)

Notez la commande affichée en haut de la page de l'app Esport, « **Enter to the virtual environment** » : elle
ressemble à `source /home/jayo8828/nodevenv/application-enzo/esport/22/bin/activate && cd /home/jayo8828/application-enzo/esport`.
Le chiffre (`22`) est celui de **votre** version : utilisez votre ligne dans la suite.

### A8. Première installation (5 minutes)

Dans le **Terminal** :

```bash
source /home/jayo8828/nodevenv/application-enzo/esport/22/bin/activate
cd ~/application-enzo
bash esport/serveur/deployer.sh --forcer
tail -n 20 ~/logs/esport-deploy.log
```

Le journal doit finir par « serveurs Esport et relais redémarrés ». Le script a installé les dépendances, créé
les tables (« Migrations appliquées : 0001_fondations.sql, … ») et redémarré les deux apps.

Vérifiez :

```bash
curl -s https://esport.appdashboard.fr/sante
curl -s -o /dev/null -w '%{http_code}\n' https://relais.appdashboard.fr/sante
```

- Esport : `{"ok":true,"service":"esport",...,"stockage":true,"session":true,...}`
- Relais : `401` (normal : sans jeton, le relais refuse ; il tourne).

### A9. Les deux tâches cron (5 minutes)

cPanel › section **Avancé** › **Tâches Cron**.

1. **E-mail de cron** : laissez vide (sinon un e-mail toutes les 5 minutes).
2. **Ajouter une nouvelle tâche Cron** › **Paramètres communs** : « Toutes les cinq minutes (*/5 * * * *) ».
   **Commande** :

   ```text
   /bin/bash /home/jayo8828/application-enzo/esport/serveur/deployer.sh >/dev/null 2>&1
   ```

   **Ajouter une nouvelle tâche Cron**.
3. Une deuxième, toujours toutes les cinq minutes, **Commande** (avec **votre** chemin de Node, étape A7) :

   ```text
   cd /home/jayo8828/application-enzo && /home/jayo8828/nodevenv/application-enzo/esport/22/bin/node esport/serveur/cron.mjs >> /home/jayo8828/logs/esport-cron.log 2>&1
   ```

La première met à jour code, base, apps et site ; la seconde fait le travail planifié de l'Esport (rappels,
file d'envoi Discord, purge du journal selon la durée de chaque team, ménage, envois de vidéos inachevés depuis plus de
24 h, transcriptions demandées à une API externe si elle est activée, lancement de la transcription sur le serveur
quand une réunion attend : partie H) et efface les clés expirées du relais.
Toutes deux se protègent contre une exécution en double.

*Variante sans cron de déploiement* : cPanel › **Git Version Control** › **Gérer** › onglet **Pull or Deploy** ›
**Update from Remote**, puis **Deploy HEAD Commit** (fichier `.cpanel.yml` du dépôt : même script).

### A10. Le site (5 minutes)

1. GitHub › **Actions** › **Site (o2switch)** › **Run workflow** › `main`. (Ensuite, il tourne tout seul à chaque
   changement de l'app.) Il construit le site et le pose sur la branche `deploiement-o2switch` (fichiers construits
   seulement, jamais de code).
2. Dans les 5 minutes, la tâche cron le recopie dans `/home/jayo8828/public_html` :
   - la **première fois**, une copie de ce qu'il y avait est gardée dans `/home/jayo8828/sauvegardes/` ;
   - sont **toujours gardés** : `.htaccess` (seul le bloc « AppDashboard » est remplacé), `.well-known/`
     (Let's Encrypt), `cgi-bin/`, `.user.ini`, `php.ini`, `maj/` (mises à jour de l'iPhone). Pour garder d'autres
     fichiers, écrivez leur chemin (ex. `/mon-dossier/`), un par ligne, dans `~/.appdashboard/site-garder.txt` ;
   - le bloc `.htaccess` reproduit Cloudflare Pages : HTTPS obligatoire, en-têtes de `bureau/public/_headers`
     (cache d'un an des fichiers `assets/`), repli « une page » vers `index.html`.
3. Ouvrez **https://appdashboard.fr** : l'écran d'ouverture de l'app s'affiche.

`esport.json` et `relais.json` du site pointent vers `https://esport.appdashboard.fr` et
`https://relais.appdashboard.fr` (variables GitHub facultatives `O2SWITCH_ESPORT_URL` et `O2SWITCH_RELAIS_URL`
pour changer de domaine).

---

## Partie B — Vérifier avant la bascule

- `curl -s https://esport.appdashboard.fr/sante` répond `"ok":true` (étape A8).
- `tail ~/logs/esport-cron.log` : « 12/12 tâches faites » toutes les 5 minutes.
- `tail ~/logs/esport-deploy.log` : rien de rouge.
- https://appdashboard.fr s'ouvre.
- Répétition sans risque de l'import du relais (il est rejouable, il ne supprime rien) :

  ```bash
  source /home/jayo8828/nodevenv/application-enzo/esport/22/bin/activate
  cd ~/application-enzo
  RELAIS_SOURCE=https://applibourse-relais.VOTRE-SOUS-DOMAINE.workers.dev node relais/serveur/importer.mjs
  ```

  Attendu : « Boîte du relais : N clés exportées, N écrites… » puis « toutes les clés sont relues à l'identique ».

Ne lancez **pas** encore l'import de l'Esport : il se fait une seule fois, à la bascule.

---

## Partie C — La bascule (30 minutes, un jour calme)

Prévenez les membres : pendant environ 10 minutes, l'Esport est en **lecture seule** et il vaut mieux ne rien
modifier dans les apps. Rien ne sera perdu.

Dans GitHub, les variables se règlent dans **Settings** › **Secrets and variables** › **Actions** › onglet
**Variables** › **New repository variable** (ou le crayon pour modifier).

1. **Esport en lecture seule** : variable `ESPORT_LECTURE_SEULE` = `1` › **Actions** › **Esport (Worker)** ›
   **Run workflow**. (Les écritures répondent « déménagement en cours » ; les lectures marchent.)
2. **Import de l'Esport** (Terminal cPanel) :

   ```bash
   source /home/jayo8828/nodevenv/application-enzo/esport/22/bin/activate
   cd ~/application-enzo
   ESPORT_SOURCE=https://applibourse-esport.VOTRE-SOUS-DOMAINE.workers.dev node esport/serveur/importer.mjs
   ```

   Il ouvre une session du Fondateur sur l'ancien serveur (avec le jeton maître de `relais.env`), puis :
   - copie toute la base dans PostgreSQL et **vérifie le nombre de lignes de chaque table** (« mêmes nombres de
     lignes que l'export ») ;
   - copie les fichiers (PDF, miniatures) dans `/home/jayo8828/esport-fichiers` (« Fichiers : N copiés ») ;
   - reprend les **clés** du serveur Cloudflare (`CLE_ESPORT`, `CLE_DISCORD`) dans `esport.env` : les liens de
     partage des strats, les webhooks Discord des teams et les sessions ouvertes restent valables ; l'app Esport
     redémarre.

   En cas de coupure pendant la copie des fichiers : relancez avec `--fichiers-seulement` à la fin de la commande.
3. **Import final du relais** (même Terminal) :

   ```bash
   RELAIS_SOURCE=https://applibourse-relais.VOTRE-SOUS-DOMAINE.workers.dev node relais/serveur/importer.mjs
   ```

4. **Relais : transmission vers o2switch** : variables `RELAIS_CIBLE` = `https://relais.appdashboard.fr` et
   `SITE_CIBLE` = `https://appdashboard.fr` › **Actions** › **Relais (Cloudflare Worker)** › **Run workflow**.
   L'ancien relais transmet désormais tout à o2switch et annonce la nouvelle adresse aux appareils.
5. **Esport : transmission vers o2switch** : variable `ESPORT_CIBLE` = `https://esport.appdashboard.fr`, et
   **supprimez** `ESPORT_LECTURE_SEULE` › **Actions** › **Esport (Worker)** › **Run workflow**.
6. **Site Cloudflare Pages** : variable `SITE_CLOUDFLARE_ARRET` = `1`. Le workflow « Site (Cloudflare Pages) » ne
   publie plus (l'ancien site reste en ligne tel quel et marche, puisque ses serveurs transmettent à o2switch).
   Puis demandez à Claude la petite modification de `src/config/site.json` :
   `"site": "https://appdashboard.fr"` et `"anciensSites": ["https://applibourse-ef0ddb.pages.dev"]` (les nouveaux
   liens de liaison et QR codes pointent alors vers appdashboard.fr).
7. **Discord** (si le bot est utilisé) : [Discord Developer Portal](https://discord.com/developers/applications) ›
   votre app › **General Information** › **Interactions Endpoint URL** :
   `https://esport.appdashboard.fr/discord/interactions` › **Save Changes** (Discord vérifie l'adresse aussitôt :
   « All your edits have been carefully recorded »). Les webhooks des teams (onglet Discord) ne changent pas.
8. **Vérifier** :
   - `curl -s https://esport.appdashboard.fr/sante` ;
   - https://appdashboard.fr : connexion, synchro, tuile Esport, une team, un PDF de résumé s'ouvre ;
   - dans Discord, une commande `/prochain` répond.

### Ce qu'il faut faire sur chaque appareil

Presque rien : **les appareils suivent tout seuls**.

| Appareil | Que faire |
| --- | --- |
| **PC** (app Electron) | Installer la dernière version de l'app (comme d'habitude). Ouvrir l'app › **Paramètres** › **Synchronisation** › **Synchroniser maintenant** : l'app voit que le relais a déménagé, vérifie la nouvelle adresse avec son jeton, et l'enregistre. L'Esport suit (adresse déduite : `relais.appdashboard.fr` → `esport.appdashboard.fr`). |
| **iPhone** (AltStore) | Mettre l'app à jour (mise à jour JavaScript habituelle, ou nouvelle version AltStore). Ouvrir l'app › **Synchroniser maintenant**. Le site des mises à jour suit aussi (appdashboard.fr). Pour publier une mise à jour JavaScript après la bascule : déposez `main.jsbundle` et `manifeste.json` dans `public_html/maj/` (cPanel › **Gestionnaire de fichiers**). |
| **Site** | Utiliser **https://appdashboard.fr** (l'ancienne adresse `pages.dev` marche encore, et suit aussi). Tout le monde se connecte avec son identifiant et son mot de passe (partie G). |
| **Amis** | Rien. Leur appareil suit au premier « Synchroniser » ; un appareil qui n'est pas mis à jour continue de marcher par l'ancienne adresse, tant que Cloudflare n'est pas coupé. |

Un appareil a suivi quand sa synchronisation marche encore après la coupure de Cloudflare… ce qu'on ne fait
qu'à la toute fin (partie E), quand plus aucune requête n'arrive sur l'ancien relais.

---

## Partie D — Retour arrière (si quelque chose ne va pas)

Tant que Cloudflare n'est pas coupé, revenir est possible :

1. GitHub › variables : supprimez `RELAIS_CIBLE`, `SITE_CIBLE`, `ESPORT_CIBLE` et `SITE_CLOUDFLARE_ARRET` ›
   relancez **Relais (Cloudflare Worker)**, **Esport (Worker)** et **Site (Cloudflare Pages)**. Cloudflare sert de
   nouveau **ses** données, telles qu'au moment de la bascule.
2. Appareils qui ont déjà suivi o2switch : renvoyez-les vers Cloudflare en ajoutant à `~/.appdashboard/relais.env`
   la ligne `RELAIS_CIBLE=https://applibourse-relais.VOTRE-SOUS-DOMAINE.workers.dev` (et
   `SITE_CIBLE=https://applibourse-ef0ddb.pages.dev`), puis
   `touch ~/application-enzo/relais/tmp/restart.txt`. Le relais o2switch transmet et annonce l'ancienne adresse :
   les appareils reviennent d'eux-mêmes.
3. Discord : remettez l'ancienne **Interactions Endpoint URL** (`https://applibourse-esport.VOTRE-SOUS-DOMAINE.workers.dev/discord/interactions`).
4. Données Esport modifiées sur o2switch depuis la bascule : elles ne sont pas sur Cloudflare. Pour les y
   reporter, exportez-les (`ESPORT_JETON='…' node esport/outils/transfert.mjs exporter --url https://esport.appdashboard.fr`)
   et demandez de l'aide pour les réimporter (l'import ne se fait que dans une base vide). Dans les premières
   heures, le plus simple est d'accepter de refaire ces quelques changements.

---

## Partie E — Plus tard : couper Cloudflare

Attendez que **tous** les appareils aient suivi (quelques semaines). Pour vérifier : dash.cloudflare.com ›
**Workers & Pages** › `applibourse-relais` › **Metrics** : plus aucune requête depuis plusieurs jours.

Ensuite seulement (rien de tout cela n'est automatique) :

1. **Workers & Pages** › `applibourse-relais` › **Settings** › **Delete** ; pareil pour `applibourse-esport`.
2. **Storage & Databases** › **D1** › `applibourse-esport` › **Delete** ; **R2** › `esport-fichiers` › vider puis
   supprimer ; **KV** › la boîte du relais › **Delete**.
3. **Workers & Pages** › le projet Pages `applibourse-ef0ddb` › **Settings** › **Delete project**.
4. Dans GitHub, vous pouvez alors désactiver les workflows Cloudflare (**Actions** › le workflow › **⋯** ›
   **Disable workflow**).

---

## Partie G — Données sur le serveur et connexion par identifiant (relais version 9)

Depuis cette version, **toutes vos données sont enregistrées sur le serveur o2switch**, chiffrées par vos appareils
(le serveur ne peut pas les lire), et **chacun se connecte avec son identifiant et son mot de passe**, vous compris.
Plus de code de liaison, plus de « Synchronisation » dans les Paramètres. Détails : `docs/synchro-relais.md` et
`docs/connexion-amis.md`.

**Côté serveur : rien à faire.** La tâche cron de déploiement (toutes les 5 minutes) installe la nouvelle version ; au
redémarrage, le relais crée lui-même ses trois nouvelles tables PostgreSQL (`relais_coffre`, `relais_coffre_rev`,
`relais_coffre_historique`). Pour vérifier, dans le Terminal cPanel :

```bash
curl -s https://relais.appdashboard.fr/sante -H "Authorization: Bearer $(grep ^JETON= ~/.appdashboard/relais.env | cut -d= -f2)" | grep -o '"version":[0-9]*'
```

Attendu : `"version":10` (9 avant la synchro quasi immédiate, partie H). L'ancien relais Cloudflare transmet tout à
o2switch : rien à y faire non plus.

**Ce que vous faites, dans cet ordre :**

1. **Le PC d'abord.** Installez la dernière version de l'app (comme d'habitude), ouvrez-la et déverrouillez-la (mot de
   passe et code à six chiffres, comme d'habitude). Laissez-la ouverte 1 minute : elle envoie toutes vos données au
   serveur (première synchronisation). Puis l'écran **« Se connecter partout avec un identifiant »** apparaît :
   - **Identifiant** : par exemple « admin » (majuscules, accents et espaces au bord ne comptent pas) ;
   - **Mot de passe actuel** et **code à six chiffres** ;
   - **« Changer de mot de passe »** reste **décoché** (facultatif) : votre mot de passe actuel sert partout ;
   - **Activer la connexion par identifiant**.
   Votre code à six chiffres est **gardé** (version 10) : son secret est confié au serveur, chiffré, et le serveur le
   demandera à chaque connexion sur un nouvel appareil (même application d'authentification qu'aujourd'hui).
   L'app affiche **dix codes de récupération** : **notez-les sur papier** et rangez-les (c'est votre seule solution si
   vous oubliez votre mot de passe ou perdez votre téléphone). Puis « J'ai noté mes codes ». Si vous aviez cliqué
   « Plus tard » : Paramètres › Sécurité › « Identifiant et mot de passe de connexion ». Un échec (réseau…) ne casse
   rien : refaites simplement l'écran.
2. **Le site** : ouvrez **https://appdashboard.fr** (sur n'importe quel ordinateur). Tapez votre identifiant (l'écran
   prend aussitôt votre style), votre mot de passe, « Se connecter », puis **le code à six chiffres** que le serveur
   demande. Toutes vos apps et vos données arrivent du serveur. Tant que l'étape 1 n'est pas faite, le serveur ne
   connaît aucun identifiant pour vous : la connexion répond « Identifiant ou mot de passe incorrect » (le bouton
   « Administrateur : première connexion ? » de l'écran le rappelle).
3. **L'iPhone** : dans Safari, https://appdashboard.fr → identifiant + mot de passe + code (vous pouvez l'ajouter à
   l'écran d'accueil). L'app AltStore déjà reliée continue de marcher après sa mise à jour habituelle. Sur un iPhone
   neuf, utilisez le site : la connexion par identifiant n'est pas encore dans l'app native.
4. **Les amis** : rien à faire. Leur identifiant et leur mot de passe marchent tels quels, sur n'importe quel appareil.
   Un ami « à l'ancienne » (code de liaison + code à six chiffres) : Administration › son compte › **Réinitialiser
   l'accès** et envoyez-lui le lien (il choisit son mot de passe ; ses données sont gardées).

**Mot de passe oublié ou téléphone perdu ?** Sur l'écran de connexion : « Mot de passe oublié ? », votre identifiant,
UN de vos codes de récupération (pas de code à six chiffres) et un nouveau mot de passe. Dix nouveaux codes
s'affichent : notez-les (les anciens ne marchent plus). La validation en deux étapes se gère dans **Paramètres ›
Sécurité › Validation en deux étapes** (activer, désactiver : pour tout compte).

**Anciens appareils de la liste « Appareils liés »** (« Site de secours · il y a 22 jours ») : ils disparaissent seuls.
Leurs données sont reprises dans le serveur à la première ouverture d'un appareil à jour, puis leurs vieux dépôts sont
effacés (rien n'est perdu).

## Partie H — Synchro quasi immédiate et validation en deux étapes (relais version 10)

**Côté serveur : rien d'obligatoire.** Le cron installe la version 10 ; `/sante` annonce `"version":10` et les
fonctions `coffre-v10`, `avis`, `a2f`, `methode-post`. Les appareils en version 9 continuent de marcher pendant le
déploiement (mêmes routes `/v9/…`).

- **Avis en temps réel (SSE).** Un appareil ouvert garde UNE connexion vers le relais (`/v10/coffre/<compte>/flux`) ;
  le serveur y écrit « nouvelle révision » à chaque modification d'un autre appareil. La réponse porte
  `X-Accel-Buffering: no` et `Cache-Control: no-transform` (Passenger et LiteSpeed ne la retiennent pas), un bourrage
  de 2 Kio à l'ouverture et un battement de cœur toutes les 15 s. **Si un frontal retient malgré tout le flux**,
  l'appareil le voit en 4 s et passe seul à l'attente longue (`/attendre`, 25 s), puis au sondage (15 s) : aucune
  action nécessaire (le délai reste sous la seconde avec l'attente longue). Seulement si la vérification ci-dessous
  montre un flux qui arrive par paquets, vous pouvez essayer, dans le `.htaccess` du dossier racine du sous-domaine
  `relais.` (au-dessus des lignes de Passenger), d'empêcher LiteSpeed de le compresser :

  ```apache
  <IfModule LiteSpeed>
    SetEnvIf Request_URI "/flux$" no-gzip=1 dont-vary=1
  </IfModule>
  ```

  Vérification (doit afficher `event: version` immédiatement, puis `: coeur` toutes les 15 s ; Ctrl+C pour sortir) :

  ```bash
  curl -N https://relais.appdashboard.fr/v10/coffre/principal/flux -H "Authorization: Bearer $(grep ^JETON= ~/.appdashboard/relais.env | cut -d= -f2)"
  ```

- **Connexions et processus.** Au plus 6 connexions tenues par compte et 300 en tout (au-delà : sondage). Une seule
  instance Node suffit (les avis passent en mémoire ; un second processus serait rattrapé par la relecture en base,
  30 s au plus). Un onglet masqué ferme sa connexion.
- **Compression.** Les réponses JSON de plus d'1 Kio sont compressées (gzip) par le relais lui-même.
- **PUT sans corps.** Certains frontaux mutualisés refusent les `PUT` ou en perdent le corps : c'était la cause du
  « Le serveur de synchronisation a répondu 400 » de la migration du Fondateur (dépôt d'accès reçu vide). Les appareils
  à jour réessaient alors en `POST` avec l'en-tête `X-Methode: PUT`, que le relais traite comme l'original ; le
  journal du relais note la raison de chaque dépôt d'accès refusé (`[relais] dépôt d'accès refusé : corps-vide…`).
- **Clé des secrets A2F (facultatif).** Les secrets TOTP sont chiffrés par une clé tirée du `JETON`. Pour une clé à
  part, ajoutez à `relais.env` une ligne `CLE_A2F=` suivie de 32 caractères aléatoires (`openssl rand -hex 32`),
  **avant** la première activation, et ne la changez plus (sinon les A2F déjà activées ne se vérifient plus : il
  faudrait les réactiver).

---

## Partie H — Transcription des réunions sur le serveur

Depuis la migration `0016`, le **serveur o2switch transcrit lui-même** les réunions déposées (Esport › Résumés) :
plus besoin qu'un PC reste ouvert, et ça marche aussi pour un dépôt fait depuis un iPhone. Le moteur est
**Whisper** (le même modèle d'OpenAI que dans le navigateur), calculé sur le processeur du serveur avec **ONNX
Runtime** (binaires tout faits pour Linux : rien à compiler, aucun droit administrateur). Détails côté app :
[esport/resumes.md](esport/resumes.md).

### H1. Installer (une seule fois, 5 minutes)

Dans le **Terminal** cPanel :

```bash
bash ~/application-enzo/esport/serveur/installer-transcription.sh
```

Le script vérifie la machine, installe le moteur dans `~/esport-modeles/moteur` (ONNX Runtime et ffmpeg, environ
300 Mo), télécharge le modèle Whisper « base » (environ 160 Mo) dans `~/esport-modeles/whisper-base`, transcrit un
court enregistrement d'exemple (une phrase en anglais : « After early nightfall… »), redémarre l'app Esport, puis
affiche **« Transcription serveur prête »**. L'app propose alors « Serveur (automatique) » au dépôt.

Rien d'autre à faire : la tâche cron Esport (étape A9, toutes les 5 minutes) lance la transcription quand une réunion
attend. Le déploiement automatique (`deployer.sh`) ne touche jamais à `~/esport-modeles` : le modèle n'est téléchargé
qu'une fois. Relancer le script ne retélécharge que ce qui manque (`--forcer` pour tout refaire).

Réglages facultatifs, à ajouter dans `~/.appdashboard/esport.env` (puis relancer le script si vous changez de modèle,
et redémarrer l'app Esport). Attention : un commentaire `#` va sur **sa propre ligne**, jamais au bout d'une valeur :

```ini
# Transcription des réunions sur le serveur (facultatif : ces valeurs sont celles par défaut).
# Mode par défaut des teams : serveur, navigateur ou externe
TRANSCRIPTION_MODE=serveur
# Modèle : tiny (rapide, moins juste), base (conseillé), small (plus juste, lent)
TRANSCRIPTION_MODELE=base
# Fils de calcul : 1 (sage) ou 2 (deux fois plus de processeur)
TRANSCRIPTION_THREADS=1
TRANSCRIPTION_DOSSIER_MODELES=/home/jayo8828/esport-modeles
# Garde-fous (rarement utiles) : mémoire au-delà de laquelle on s'arrête proprement ; pause après chaque
# morceau (0.25 = le processeur se repose 20 % du temps) ; essais avant l'échec ; heures au plus entre le
# dépôt et la fin ; minutes de travail d'un processus avant de passer la main.
# TRANSCRIPTION_RAM_MAX=2G
# TRANSCRIPTION_REPOS=0.25
# TRANSCRIPTION_ESSAIS=3
# TRANSCRIPTION_DELAI_MAX=24
# TRANSCRIPTION_DUREE_TRAVAILLEUR=120
```

Changer de modèle : `bash ~/application-enzo/esport/serveur/installer-transcription.sh --modele small`, puis
`TRANSCRIPTION_MODELE=small` dans `esport.env` et **Restart** de l'app Esport.

### H2. Combien de temps ?

Mesuré sur un processeur de serveur x64 (Xeon 2,1 GHz), avec un enregistrement de réunion en français, **sans** les
pauses de ménagement ; le serveur o2switch peut être 1,5 à 2 fois plus lent selon la charge :

| Modèle | Mémoire | 1 h de réunion, 1 fil | 1 h de réunion, 2 fils | Qualité (français) |
| --- | --- | --- | --- | --- |
| tiny | 360 Mo | 9 min | 6 min 30 | Correcte, des mots déformés |
| **base** (conseillé) | 510 Mo | **18 min** | 12 min | Bonne |
| small | 970 Mo | 60 min | 44 min | Très bonne |

Avec la pause de 25 % et un serveur partagé, comptez **20 à 45 minutes pour 1 h de réunion** avec « base » sur 1
fil. Une seule réunion à la fois : les suivantes attendent leur tour (l'app affiche « En file d'attente »).

### H3. Les limites du mutualisé (et ce qui est prévu)

o2switch annonce des ressources « illimitées », mais en **usage raisonnable** : CloudLinux limite par compte le
processeur, la mémoire et le nombre de processus (limites « LVE »), et peut ralentir ou arrêter un processus lourd.
La transcription est faite pour rester discrète :

- **une seule transcription à la fois** (verrou), avec la **priorité la plus basse** (`nice 19`) : les pages du site
  passent avant ;
- **1 fil de calcul** par défaut, une **pause** après chaque morceau de 30 s ;
- **mémoire surveillée** (2 Go au plus par défaut) : au-delà, arrêt propre et message « choisissez un modèle plus
  petit » ;
- chaque morceau de 30 s est **enregistré** : si l'hébergeur arrête le processus (ou en cas de redémarrage), la tâche
  cron suivante en relance un qui **reprend au dernier morceau fait** ;
- après **3 échecs** (ou 24 h), la réunion passe en « Échec de la transcription » : le déposant est prévenu et l'app
  propose de la transcrire **dans le navigateur** d'un PC ;
- l'audio est décodé une fois dans `~/esport-modeles/travail` (environ 115 Mo par heure de réunion), effacé à la fin.

Pour voir ce que consomme votre compte : cPanel › **Statistiques** (colonne de gauche) › « Utilisation du processeur
et de la mémoire » (ou **Resource Usage**). Si vous voyez des « fautes » (limites atteintes) pendant les
transcriptions : gardez `TRANSCRIPTION_THREADS=1`, montez `TRANSCRIPTION_REPOS=1` (le processeur se repose la
moitié du temps) ou passez au modèle `tiny`.

### H4. Vérifier que ça marche

```bash
tail -n 20 ~/logs/esport-transcription.log    # « transcription : 1 terminée(s)… »
tail -n 5 ~/logs/esport-cron.log              # la ligne du cron compte « transcription serveur »
cat ~/esport-modeles/pret.json                # modèles vérifiés par l'installation
curl -s https://esport.appdashboard.fr/sante  # "transcriptionServeur":true
```

---

## Sauvegardes

- **Base** : cPanel › **Sauvegarde** (« Backup ») sauvegarde aussi les bases PostgreSQL ; o2switch garde en plus
  ses propres sauvegardes quotidiennes (JetBackup : cPanel › **JetBackup 5**).
- **Export JSON de l'Esport** à la demande : `ESPORT_JETON='…' node esport/outils/transfert.mjs exporter --url https://esport.appdashboard.fr --sortie ~/sauvegardes/esport.json`.
- **Fichiers** : `/home/jayo8828/esport-fichiers` (compris dans les sauvegardes cPanel).

---

## Dépannage

| Ce que vous voyez | Que faire |
| --- | --- |
| Page « We're sorry, but something went wrong » ou erreur 503 sur esport./relais. | Lisez le journal de l'app : `tail -n 50 ~/logs/esport-passenger.log` (ou `relais-passenger.log`). Sans réglage de journal, Passenger écrit dans `stderr.log` du dossier de l'app (`~/application-enzo/esport/stderr.log`). Redémarrer : **Setup Node.js App** › l'app › **Restart**, ou `touch ~/application-enzo/esport/tmp/restart.txt`. |
| `/sante` répond « Serveur Esport pas encore configuré » avec une liste de problèmes | Le fichier `~/.appdashboard/esport.env` manque une valeur (la liste dit laquelle). Corrigez, puis redémarrez l'app. |
| « Node 22 ou plus est nécessaire » | **Setup Node.js App** › l'app › **Node.js version** : 22 › **Save**, pour les deux apps ; corrigez aussi le chemin `nodevenv/…/22/` de la tâche cron. |
| `password authentication failed for user "jayo8828_esport"` | Mot de passe PostgreSQL faux dans un des deux `.env` (étape A2 pour le changer). |
| `permission denied for database` / `for schema` | Étape A2 : l'utilisateur doit avoir **tous les privilèges** sur la base. Les tables vont dans le schéma `appdashboard` ; pour utiliser un autre schéma, ajoutez `SCHEMA_BASE=nom` aux deux `.env`. |
| `ECONNREFUSED 127.0.0.1:5432` | Essayez `PGHOST=127.0.0.1` ou le nom indiqué dans phpPgAdmin. |
| `~/logs/esport-deploy.log` : « ÉCHEC : git fetch » | Clé de déploiement (étape A3) : `ssh -T git@github.com` doit dire « successfully authenticated ». |
| « ÉCHEC : npm install » | Dans le Terminal : `source …/activate`, puis `cd ~/application-enzo/esport && npm install --omit=dev` pour voir l'erreur. Ne lancez pas `npm ci` (il effacerait le lien `node_modules` de cPanel). |
| « ÉCHEC : migrations » | L'ancienne version reste en service. Lisez le message dans le journal ; la tâche cron réessaie toutes les 5 minutes. |
| Le site ne se met pas à jour | GitHub › **Actions** › **Site (o2switch)** : coche verte ? Puis `tail ~/logs/esport-deploy.log` (« site : public_html à jour »). Forcer : `bash ~/application-enzo/esport/serveur/deployer.sh --forcer`. |
| Le site affiche une page d'o2switch | `public_html/index.html` absent : voir la ligne précédente. Votre ancien contenu est dans `~/sauvegardes/`. |
| Dans l'app : « Esport pas encore activé » | Sur le site : `https://appdashboard.fr/esport.json` doit contenir `https://esport.appdashboard.fr`. Sur PC/iPhone : l'adresse se déduit du relais ; synchronisez une fois. |
| Lecture des sources Tsuzuku refusée depuis le site (CORS) | `ORIGINES_SITE` de `relais.env` doit contenir l'adresse exacte du site (avec ou sans `www`). |
| Support : rien n'arrive dans Discord | **Administration › Support** dit si le webhook est absent, mal formé, ou le motif du dernier échec. `DISCORD_WEBHOOK_URL` dans `relais.env`, puis redémarrez le relais ([support.md](support.md)). Les demandes déjà reçues : bouton **Renvoyer sur Discord**. |
| E-mails : « l'envoi par le serveur n'est pas configuré » | Les cinq lignes `SMTP_*` / `MAIL_FROM` de `relais.env` ([emails.md](emails.md)), puis redémarrez le relais. `tail ~/logs/relais-passenger.log` dit laquelle manque. |
| E-mails en spam | cPanel › **Email Deliverability** : SPF et DKIM « Valide » ([emails.md](emails.md) § 2). |
| Discord : « interactions endpoint url could not be verified » | `DISCORD_PUBLIC_KEY` et `DISCORD_APPLICATION_ID` dans `esport.env`, app redémarrée, puis réessayez. `curl -s https://esport.appdashboard.fr/sante` doit montrer `"bot":true`. |
| L'import Esport dit « contient déjà des données » | Il ne fusionne jamais (protection). Si c'était une répétition : demandez de l'aide pour vider le schéma `appdashboard`, puis relancez. |
| « Clés du serveur NON reprises » | Le Worker n'était pas en lecture seule : étape C1, puis relancez l'import avec `--fichiers-seulement`. |
| Envoi d'une vidéo bloqué dès le premier morceau (413, « Requête refusée ») | Pare-feu de l'hébergeur : `ESPORT_TAILLE_MORCEAU=2M` dans `esport.env`, redémarrez l'app ; sinon cPanel › **ModSecurity** › désactivé pour `esport.appdashboard.fr`. Détails : [docs/esport/videos.md](esport/videos.md). |
| Transcription : l'app ne propose pas « Serveur (automatique) » | L'installation n'est pas faite ou pas vérifiée : relancez `bash ~/application-enzo/esport/serveur/installer-transcription.sh` (il doit finir par « Transcription serveur prête »), puis **Restart** de l'app Esport. Le modèle de `TRANSCRIPTION_MODELE` doit être celui installé (`cat ~/esport-modeles/pret.json`). |
| Transcription : « En file d'attente » depuis plus de 10 minutes | La tâche cron Esport (étape A9) tourne-t-elle ? `tail ~/logs/esport-cron.log` puis `tail -n 30 ~/logs/esport-transcription.log`. Lancer à la main pour voir l'erreur : `cd ~/application-enzo && /home/jayo8828/nodevenv/application-enzo/esport/22/bin/node esport/serveur/transcription/travailleur.mjs`. |
| Transcription : « Interrompue trop souvent (limite de l'hébergeur ou redémarrage) » | Le processus est arrêté avant d'avancer (mémoire ou processeur du compte) : cPanel › Statistiques, puis `TRANSCRIPTION_MODELE=tiny` (relancer l'installation avec `--modele tiny`) ou `TRANSCRIPTION_REPOS=1`. Dans l'app : « Réessayer sur le serveur », ou « Transcrire » dans le navigateur d'un PC. |
| Transcription : « Mémoire insuffisante… » | Modèle trop gros pour le compte : `--modele tiny` (ou `base` si vous aviez `small`), ou montez `TRANSCRIPTION_RAM_MAX` si cPanel › Statistiques montre de la marge. |
| Installation : « glibc trop ancienne » ou erreur au chargement d'ONNX Runtime | Le serveur est trop ancien pour les binaires tout faits : gardez la transcription dans le navigateur (`TRANSCRIPTION_MODE=navigateur`) et signalez-le au support o2switch (ils migrent les comptes vers des serveurs récents). |
| Installation : « Hugging Face indisponible » | Rien à faire : le script prend l'archive GitHub à la place (plus grosse, environ 200 Mo pour « base »). Si GitHub échoue aussi : réessayez plus tard. |
| Transcription : « ffmpeg n'a pas pu lire l'enregistrement » | Fichier abîmé ou format exotique : déposez un MP4, M4A, MP3 ou WAV. |
| « Trop de demandes en peu de temps » pour tout le monde | Les limites de débit se basent sur l'adresse IP vue par le serveur ; pendant la transmission depuis Cloudflare, les appareils pas encore à jour partagent l'adresse de Cloudflare. Ça disparaît quand ils ont suivi. |

Journaux utiles : `~/logs/esport-deploy.log` (déploiements), `~/logs/esport-cron.log` (tâches planifiées),
`~/logs/esport-transcription.log` (transcriptions sur le serveur), `~/logs/esport-passenger.log` et
`~/logs/relais-passenger.log` (les deux apps).

Pour les curieux : les fichiers concernés sont `esport/serveur/` (serveur Esport, cron, migrations, import,
`deployer.sh`), `relais/serveur/` (relais et sa boîte PostgreSQL), `esport/adaptateurs/postgres.mjs`,
`scripts/htaccess-o2switch.mjs`, `.github/workflows/site-o2switch.yml` et `.cpanel.yml`.
