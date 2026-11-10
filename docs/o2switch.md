# Le dashboard chez o2switch

Les **trois parties en ligne** du dashboard tournent sur l'hébergement o2switch du Fondateur (SAS o2switch,
Chemin des Pardiaux, 63000 Clermont-Ferrand) :

| Quoi | Adresse |
| --- | --- |
| **Site** (l'app dans le navigateur) | **https://appdashboard.fr** (dossier `public_html`) |
| **Relais** (synchro chiffrée, invitations, connexion des amis, Tsuzuku, support, e-mails…) | **https://relais.appdashboard.fr** (Node + PostgreSQL) |
| **Serveur Esport** (teams, planning, résumés, vidéos, Discord…) | **https://esport.appdashboard.fr** (Node + PostgreSQL + disque) |

Ce guide sert à **installer ou réinstaller** ces serveurs (partie A, environ 1 h 30), puis à suivre les évolutions
(parties G et H), les sauvegardes et le dépannage. L'ancien hébergement Cloudflare est retiré : voir « Historique »
à la fin.

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

Dans les commandes, remplacez seulement ce qui est en MAJUSCULES : `MOT_DE_PASSE_POSTGRES`, `JETON_MAITRE`.

### Comment ça marche (en bref)

- **Deux petites apps Node** dans « Setup Node.js App » : le **relais** (`relais/serveur/app.mjs`) et le **serveur
  Esport** (`esport/serveur/app.mjs`).
- **Une seule base PostgreSQL** pour les deux, dans un schéma `appdashboard` (créé tout seul) : les tables de
  l'Esport, la table `relais_kv` (la « boîte » du relais) et les tables du coffre serveur (les données y restent
  chiffrées par vos appareils : le serveur ne peut pas les lire).
- **L'Esport fait vérifier les jetons par le relais** en HTTPS (`https://relais.appdashboard.fr/jeton/verifier`).
  On garde ce chemin plutôt que de tout mettre dans un seul programme : ainsi le serveur
  Esport ne connaît **jamais** le jeton maître (seul le relais l'a), et une panne de l'un ne bloque pas l'autre.
- **Mises à jour automatiques « par pull »** : o2switch n'accepte pas de connexion venue de GitHub, et il n'y a pas
  de jeton API cPanel. C'est donc le serveur qui va chercher les nouveautés : toutes les 5 minutes, une tâche cron
  lance `esport/serveur/deployer.sh`, qui récupère le code (clé de déploiement GitHub en **lecture seule**), installe
  les dépendances, met la base à jour, redémarre les deux apps, et recopie le site construit par GitHub.
  Le script reste ensuite ~4 minutes à **guetter** : chaque minute, un simple `git ls-remote` (très léger) regarde
  s'il y a du nouveau ; si oui, il déploie tout de suite. Une nouveauté est donc en ligne environ **une minute après
  la fin du workflow GitHub**, et l'app ouverte se met à jour seule (voir [mises-a-jour.md](mises-a-jour.md) : plus
  besoin de `tail ~/logs/esport-deploy.log` ni de Ctrl+F5).
- **Migration vers un autre serveur** (un jour, si besoin) : le nouveau serveur **tire** lui-même les données de
  l'ancien par des routes d'administration protégées par le jeton maître (`relais/serveur/importer.mjs`,
  `esport/serveur/importer.mjs` : voir « Migrer vers un autre serveur »). Pas de fichier d'export à télécharger.

---

## Partie A — Installer (ou réinstaller)

### A1. Ce qu'il faut avoir sous la main

- l'accès à cPanel (o2switch) et au dépôt GitHub **application-Enzo** (réglages du dépôt) ;
- le **jeton maître** du relais (étape A6) : les jetons des amis en dérivent, il ne change jamais ;
- pour une réinstallation : les clés `CLE_ESPORT` et `CLE_DISCORD` de l'ancien `esport.env` (sinon les sessions,
  les liens de partage des strats et les webhooks Discord des teams sont à refaire).

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
  `"jeton"` (ou l'ancien `relais.env`). Toujours **le même** : les jetons des amis en sont dérivés ;
- facultatif : l'adresse du **webhook Discord du support** (voir [support.md](support.md) § 1) ; et pour le **bot Discord** :
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

La ligne `openssl` affiche une longue clé : copiez-la (pour une réinstallation, reprenez plutôt l'ancienne
`CLE_ESPORT` ; ensuite, ne la changez plus : les sessions et les liens de partage en dépendent). Dans l'éditeur qui s'ouvre, collez ceci, puis remplacez les MAJUSCULES :

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
# Drive du CM (facultatif, voir docs/esport/drive.md) : espace total (alerte à 80 %), un fichier, un dossier en ZIP.
# ESPORT_DRIVE_QUOTA=20G
# ESPORT_DRIVE_FICHIER_MAX=2G
# ESPORT_DRIVE_ZIP_MAX=2G
# Transcription des réunions sur le serveur (facultatif, partie H) : calcul dans Node (ONNX).
# Temps réel de l'Esport (partie K) : sse (défaut), attente, ou sondage pour revenir en arrière.
# TEMPS_REEL=sse
# TRANSCRIPTION_THREADS=4
# TRANSCRIPTION_RAM_MAX=8G
# IA de l'Esport (facultatif, partie I, docs/esport/ia-api.md) : sans ces lignes, tout se fait à la main.
# IA_API_URL=https://integrate.api.nvidia.com/v1
# IA_API_CLE=nvapi-REMPLACER-cle-du-modele-principal
# IA_MODELE=mistralai/mistral-large-4-1t-a52b
# IA_API2_URL=https://integrate.api.nvidia.com/v1
# IA_API2_CLE=nvapi-REMPLACER-cle-du-modele-secondaire
# IA_MODELE2=openai/gpt-oss-20b
# IA_ORDRE=api,api2,local
# IA_ORDRE_LEGER=api2,api,local
# IA locale sur le serveur (facultatif, partie J) : moteur de plus dans l'ordre de repli.
# IA_FOURNISSEUR=local
# IA_LOCALE_MODELE=qwen2.5-7b
# IA_LOCALE_THREADS=8
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
ORIGINES_SITE=https://appdashboard.fr,https://www.appdashboard.fr
# Support Discord (facultatif, docs/support.md) : URL du webhook du salon support
DISCORD_WEBHOOK_URL=
# Salon support de type TEXTE seulement : le bot ouvre un fil par demande (même jeton que esport.env)
DISCORD_BOT_TOKEN=
# E-mails envoyés par le serveur (facultatif, docs/emails.md)
# Nom du serveur affiché par cPanel (pas mail.appdashboard.fr : son certificat ne correspond pas)
SMTP_HOST=poisson.o2switch.net
SMTP_PORT=465
SMTP_USER=noreply@appdashboard.fr
SMTP_PASS=MOT_DE_PASSE_DE_LA_BOITE_NOREPLY
MAIL_FROM=AppDashboard <noreply@appdashboard.fr>
LIEN_APP=https://appdashboard.fr
# Avis des autres appareils : sondage (défaut, le plus sûr), attente ou sse (voir partie H)
SYNCHRO_TEMPS_REEL=sondage
```

Pour `SMTP_HOST`, prenez le **nom du serveur** affiché par cPanel (**Connect Devices**), ici `poisson.o2switch.net` :
le certificat de `mail.appdashboard.fr` est celui du serveur et ne contient pas ce nom, l'envoi échouerait avec
« certificat SMTP ne correspond pas au nom du serveur ». Une copie de chaque e-mail arrive dans « Envoyés » de la
boîte (webmail), réglages dans [emails.md](emails.md).

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

La première met à jour code, base, apps et site (elle vérifie chaque minute pendant ses ~4 minutes de « guet », par
un `git ls-remote` qui ne coûte presque rien, et ne fait le travail complet que s'il y a du nouveau, si l'app a
demandé « Vérifier maintenant » ou au moins une fois par heure : [mises-a-jour.md](mises-a-jour.md)) ; la seconde fait le travail planifié de l'Esport (rappels,
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
2. Dans la minute qui suit (5 au plus), la tâche cron le recopie dans `/home/jayo8828/public_html` :
   - la **première fois**, une copie de ce qu'il y avait est gardée dans `/home/jayo8828/sauvegardes/` ;
   - sont **toujours gardés** : `.htaccess` (seul le bloc « AppDashboard » est remplacé), `.well-known/`
     (Let's Encrypt), `cgi-bin/`, `.user.ini`, `php.ini`, `maj/` (mises à jour de l'iPhone). Pour garder d'autres
     fichiers, écrivez leur chemin (ex. `/mon-dossier/`), un par ligne, dans `~/.appdashboard/site-garder.txt` ;
   - le bloc `.htaccess` (généré depuis `bureau/public/_headers` par `scripts/htaccess-o2switch.mjs`) : HTTPS obligatoire, en-têtes de `bureau/public/_headers`
     (cache d'un an des fichiers `assets/`), repli « une page » vers `index.html` ;
   - les anciens fichiers de `assets/` sont **gardés 14 jours** après leur dernier build (un onglet resté ouvert en a encore besoin), puis purgés par le cron ; l'app se recharge seule une fois si un morceau manque.
3. Ouvrez **https://appdashboard.fr** : l'écran d'ouverture de l'app s'affiche.

`esport.json` et `relais.json` du site pointent vers `https://esport.appdashboard.fr` et
`https://relais.appdashboard.fr` (variables GitHub facultatives `O2SWITCH_ESPORT_URL` et `O2SWITCH_RELAIS_URL`
pour changer de domaine).

---

## Partie B — Vérifier

- `curl -s https://esport.appdashboard.fr/sante` répond `"ok":true` (étape A8).
- `tail ~/logs/esport-cron.log` : « 12/12 tâches faites » toutes les 5 minutes.
- `tail ~/logs/esport-deploy.log` : rien de rouge (ou, plus simple : Paramètres › Administration › **Mises à jour**
  dans l'app, qui montre les mêmes lignes, les versions en ligne et l'état de GitHub).
- https://appdashboard.fr s'ouvre ; connexion, tuile Esport, une team, un PDF de résumé s'ouvre.
- **Discord** (si le bot est utilisé) : [Discord Developer Portal](https://discord.com/developers/applications) ›
  votre app › **General Information** › **Interactions Endpoint URL** =
  `https://esport.appdashboard.fr/discord/interactions` ; une commande `/prochain` répond.
- **PC** : `relais/relais-local.json` (dossier de l'app) doit contenir `"relais": "https://relais.appdashboard.fr"`
  et `"site": "https://appdashboard.fr"`.

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

Attendu : `"version":10` (9 avant la synchro quasi immédiate, partie H).

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

- **Avis des autres appareils : sobres par défaut (réglage `SYNCHRO_TEMPS_REEL`).** Depuis l'incident du 22 octobre
  2026 (site inaccessible pour le Fondateur juste après la version 10 : adresse IP très probablement bannie par le
  pare-feu pour trop de connexions longues ouvertes et rouvertes, un flux SSE par onglet et par appareil), le relais
  ne garde **aucune connexion ouverte** sauf si vous le demandez. Ligne à ajouter (facultative) dans
  `~/.appdashboard/relais.env`, puis redémarrer l'app Node (« Setup Node.js App » › **Restart**) :

  ```ini
  # sondage (DÉFAUT, le plus sûr) : chaque appareil demande « quelle révision ? » toutes les 15 s, page visible
  #   seulement, et UN SEUL onglet par navigateur le fait ; délai A → B ≤ 15 s environ.
  # attente : attente longue de 50 s (un espace toutes les 15 s la garde en vie), une par navigateur ; délai < 1 s.
  # sse : flux continu (comme la première version 10) ; à éviter sur un mutualisé.
  SYNCHRO_TEMPS_REEL=sondage
  ```

  Les appareils lisent ce réglage dans `/sante` (`"tempsReel":"sondage"`) et ne montent jamais au-dessus. Les
  modifications, elles, partent toujours ~150 ms après la frappe (requête courte). Commencez par `sondage` ; passez
  à `attente` seulement après une semaine sans blocage, en surveillant les « entry processes » (ci-dessous).

  Garde-fous côté serveur, quel que soit le mode : au plus **2 connexions tenues par compte et par adresse IP**
  (4 par compte, 60 en tout) ; au-delà, réponse **immédiate** « utilise le sondage » (429 + `Retry-After`, rien
  n'est gardé ouvert) ; au plus **60 appels d'avis par minute et par adresse** ; chaque connexion tenue a une durée
  maximale (50 s, ou 5 min pour un flux), est libérée dès que l'appareil part, et un balayage ferme les orphelines.
  Côté appareils : une seule écoute par navigateur (les onglets se relaient), arrêtée dès que la page est masquée,
  au plus 30 requêtes de synchro par minute, et des réessais de plus en plus espacés (2 s → 5 min, au hasard) :
  jamais de reconnexion rapide en boucle.

  En mode `sse` seulement : si la vérification ci-dessous montre un flux qui arrive par paquets, vous pouvez
  essayer, dans le `.htaccess` du dossier racine du sous-domaine `relais.` (au-dessus des lignes de Passenger),
  d'empêcher LiteSpeed de le compresser :

  ```apache
  <IfModule LiteSpeed>
    SetEnvIf Request_URI "/flux$" no-gzip=1 dont-vary=1
  </IfModule>
  ```

  Vérification du mode annoncé (doit afficher `"tempsReel":"sondage"`, ou ce que vous avez choisi) :

  ```bash
  curl -s https://relais.appdashboard.fr/sante -H "Authorization: Bearer $(grep ^JETON= ~/.appdashboard/relais.env | cut -d= -f2)"
  ```

- **Connexions et processus.** Une seule instance Node suffit (les avis passent en mémoire ; un second processus
  serait rattrapé par la relecture en base, 30 s au plus).
- **Compression.** Les réponses JSON de plus d'1 Kio sont compressées (gzip) par le relais lui-même.
- **PUT sans corps.** Certains frontaux mutualisés refusent les `PUT` ou en perdent le corps : c'était la cause du
  « Le serveur de synchronisation a répondu 400 » de la migration du Fondateur (dépôt d'accès reçu vide). Les appareils
  à jour réessaient alors en `POST` avec l'en-tête `X-Methode: PUT`, que le relais traite comme l'original ; le
  journal du relais note la raison de chaque dépôt d'accès refusé (`[relais] dépôt d'accès refusé : corps-vide…`).
- **Clé des secrets A2F (facultatif).** Les secrets TOTP sont chiffrés par une clé tirée du `JETON`. Pour une clé à
  part, ajoutez à `relais.env` une ligne `CLE_A2F=` suivie de 32 caractères aléatoires (`openssl rand -hex 32`),
  **avant** la première activation, et ne la changez plus (sinon les A2F déjà activées ne se vérifient plus : il
  faudrait les réactiver).


### H bis. Site « inaccessible » : adresse IP bannie, processus pleins

**Symptôme.** Le site ou le relais ne répond plus pour UN appareil ou UNE connexion Internet (Opera : « Ce site est
inaccessible, la connexion réseau a été perdue » ; Safari : « la connexion a été perdue »), alors qu'il marche en 4G
ou chez quelqu'un d'autre : c'est votre adresse IP qui est bannie par le pare-feu d'o2switch (CSF/LFD, Tiger
Protect), souvent pour trop de connexions simultanées ou répétées. S'il ne répond plus pour PERSONNE, ce sont plutôt
les processus de l'hébergement qui sont pleins (voir « entry processes »).

**Débloquer une adresse IP bannie.**

1. Trouvez votre adresse publique : depuis l'appareil bloqué, ouvrez <https://ifconfig.me> (ou cherchez « mon
   adresse IP »).
2. **cPanel** (connexion par <https://cpanel.o2switch.net> ou l'espace client) › section **Sécurité** › outil
   **Tiger Protect** (selon la version : « Autorisation SSH » / « Déblocage IP ») : collez l'adresse, **Débloquer**,
   puis **Ajouter à la liste blanche** si l'outil le propose (votre box change rarement d'adresse).
3. Si l'outil n'existe pas ou que l'adresse reste bloquée : **espace client o2switch**
   (<https://clients.o2switch.fr>) › **Support** › **Ouvrir un ticket**, ou le chat, avec : le domaine
   (`appdashboard.fr`, `relais.appdashboard.fr`), l'adresse IP bloquée, l'heure approximative, et la phrase
   « Merci de débloquer cette IP dans le pare-feu (CSF/LFD) et de me dire la règle déclenchée ». Le support répond
   en général en moins d'une heure.
4. En attendant : le site marche depuis une autre connexion (partage 4G du téléphone).
5. Après le déblocage, **fermez les onglets restés ouverts sur une ancienne version** (ou rechargez-les) et
   rouvrez l'app de bureau : la nouvelle version n'ouvre qu'une écoute par navigateur.

**Voir les « entry processes » (CloudLinux).** cPanel › section **Métriques** › **Statistiques de ressources**
(« Resource Usage » / LVE ; parfois dans **Statistiques et limites**) › **Détails** ou **Instantané**. Colonnes
utiles : **EP** (*entry processes* : requêtes en cours de traitement en même temps, limite souvent 20 à 30 sur un
mutualisé), **NPROC** (processus), **CPU**, **PMEM**. Une barre rouge ou des « faults » sur EP au moment du blocage =
trop de requêtes tenues en même temps : restez (ou revenez) en `SYNCHRO_TEMPS_REEL=sondage`. L'onglet
**Instantané** montre les requêtes en cours à l'instant : en mode `sondage`, aucune ne doit durer plus d'une ou deux
secondes.

**Prévenir.** Gardez `SYNCHRO_TEMPS_REEL=sondage` (défaut). Le journal du relais (`~/logs/relais.log` ou celui de
Passenger) ne doit pas montrer de rafales de `/attendre` ou `/flux` ; un `429` « trop-de-connexions » ou
« trop-de-requetes » de temps en temps est normal (le serveur protège l'adresse avant le pare-feu).
---

## Partie H — Transcription des réunions sur le serveur

Le **serveur o2switch transcrit lui-même** les réunions déposées (Esport › Résumés) : aucun PC à laisser ouvert, ça
marche aussi depuis un iPhone. Le calcul se fait **dans le processus Node** de l'Esport (ONNX Runtime), avec
**Whisper large-v3-turbo** (Équilibrée), **small** (Rapide) ou **large-v3** (Maximale), le **vocabulaire de la team**
(pseudos, agents, maps, glossaire), la recherche en faisceau et une **relecture par l'IA locale** (partie J
seulement : vos réunions ne partent jamais chez NVIDIA ni ailleurs, sauf autorisation explicite du Fondateur dans
Administration IA › Confidentialité ; sans IA locale, pas de relecture, le texte est nettoyé sans IA). Pourquoi
et comment : [esport/transcription.md](esport/transcription.md) ; côté app : [esport/resumes.md](esport/resumes.md).

> **Pourquoi pas whisper.cpp (ni llama-server) ?** Journaux du 29/10 : l'hébergeur **arrête de force (SIGKILL)** les
> binaires de calcul lancés depuis le dossier personnel (`whisper.cpp s'est arrêté (signal SIGKILL)`, IA locale tuée
> au chargement), sans aucune « faute » mémoire ni processeur dans Resource Usage, alors que l'ancien moteur ONNX,
> **dans Node**, a transcrit 28 minutes d'audio sans incident. whisper.cpp reste installable en option
> (`--whispercpp`) : s'il est tué, le travail **bascule tout seul sur ONNX** et whisper.cpp est désactivé (visible dans
> Esport › Administration › Jeux › Administration IA › Transcription sur le serveur).

### H1. Installer ou mettre à jour (une fois, 10 à 30 minutes, sans rester devant)

Dans le **Terminal** cPanel, **dans cet ordre** (la première ligne active le Node 22 de l'app Esport) :

```bash
source /home/jayo8828/nodevenv/application-enzo/esport/22/bin/activate
cd ~/application-enzo

# 1. Voir le plan (rien n'est téléchargé) : fichiers, tailles, SHA-256 publiés par Hugging Face :
bash esport/serveur/installer-transcription.sh --dry-run --tous

# 2. Installer les trois qualités : ONNX Runtime + ffmpeg (npm, versions figées), modèles Whisper ONNX int8
#    small, large-v3-turbo et large-v3 (≈ 3,2 Go, chaque fichier vérifié par son SHA-256) :
bash esport/serveur/installer-transcription.sh --tous

# 3. Essai DANS Node, comme le fera le processus de fond : vitesse (« × temps réel »), mémoire du processus,
#    durée estimée d'une heure de réunion par qualité (mesures gardées pour les estimations de l'app) :
bash esport/serveur/installer-transcription.sh --test
```

Sans `--tous`, seul le modèle de la qualité Équilibrée (large-v3-turbo, ≈ 1 Go) est installé. À la fin :
**« Transcription serveur prête »**, et l'app Esport est redémarrée (les qualités Rapide / Équilibrée / Maximale
apparaissent au dépôt et dans Paramètres › Transcription des réunions).

Ensuite, ajoutez ces lignes dans `~/.appdashboard/esport.env` (un commentaire `#` va sur **sa propre ligne**), puis
redémarrez l'app Esport :

```ini
# Transcription : fils de calcul d'ONNX Runtime (dans Node) ; mémoire du processus permise (modèle compris)
TRANSCRIPTION_THREADS=4
TRANSCRIPTION_RAM_MAX=8G
```

```bash
mkdir -p ~/application-enzo/esport/tmp && touch ~/application-enzo/esport/tmp/restart.txt
```

**Durée et espace disque** :

| Étape | Durée | Disque |
| --- | --- | --- |
| ONNX Runtime + ffmpeg (npm) | 1 à 3 min | ≈ 300 Mo (déjà là si installé avant) |
| Modèle large-v3-turbo int8 (défaut) | 2 à 5 min | ≈ 1 Go |
| `--tous` : small + large-v3 int8 en plus | 3 à 8 min | ≈ 0,4 Go + 1,8 Go |
| `--test` | 2 à 10 min | — |

Au final : ≈ 1,3 Go (défaut) ou ≈ 3,5 Go (`--tous`) dans `~/esport-modeles`, plus ≈ 115 Mo par heure de réunion en
cours de transcription (`~/esport-modeles/travail`, effacé à la fin). Le déploiement automatique (`deployer.sh`) ne
touche jamais à `~/esport-modeles` ; relancer le script ne refait que ce qui manque (`--forcer` pour tout refaire).
Les anciens fichiers de whisper.cpp (`whispercpp/`, `ggml/`) peuvent rester : ils ne servent plus par défaut.

Rien d'autre à faire : la tâche cron Esport (étape A9, toutes les 5 minutes) lance la transcription quand une réunion
attend.

Réglages facultatifs (valeurs par défaut ; détail : [esport/transcription.md](esport/transcription.md)) :

```ini
# Qualité par défaut des teams : rapide, equilibree, maximale
TRANSCRIPTION_QUALITE=equilibree
# Moteur : auto (ONNX dans Node), onnx, whispercpp (option, bascule sur ONNX s'il est tué)
TRANSCRIPTION_MOTEUR=auto
# Relecture par l'IA : auto (si une IA est configurée) ou non
TRANSCRIPTION_CORRECTION=auto
# Processus figé (aucune avancée pendant N minutes) : il s'arrête, le passage suivant du cron reprend
TRANSCRIPTION_BLOCAGE_MIN=45
# Garde-fous : pause après chaque morceau (0.25 = le processeur se repose 20 % du temps), essais, délai, durée d'un processus
# TRANSCRIPTION_REPOS=0.25
# TRANSCRIPTION_ESSAIS=3
# TRANSCRIPTION_DELAI_MAX=24
# TRANSCRIPTION_DUREE_TRAVAILLEUR=120
```

### H2. Combien de temps ?

Valeurs de départ (processeur de serveur x64, 4 fils, pauses comprises) ; `--test` mesure les vraies sur votre
serveur et l'app les utilise pour ses estimations :

| Qualité | Modèle (ONNX int8) | Mémoire du processus | 1 h de réunion |
| --- | --- | --- | --- |
| Rapide | small | ≈ 1,1 Go | 20 à 40 min |
| **Équilibrée** (défaut) | large-v3-turbo | ≈ 2,6 Go | **45 à 90 min** |
| Maximale | large-v3 | ≈ 4,5 Go | 2 h 30 à 5 h |
| + relecture par l'IA | IA locale (partie J) ; jamais une API par défaut | — | + 2 à 10 min |

Une seule réunion à la fois : les suivantes attendent leur tour (« En file d'attente »). Plus de fils
(`TRANSCRIPTION_THREADS=8`) va plus vite si Resource Usage le permet.

### H3. Les limites du mutualisé (et ce qui est prévu)

o2switch limite par compte le processeur, la mémoire et les processus (CloudLinux « LVE ») et arrête de force les
binaires de calcul externes. La transcription reste discrète :

- **tout le calcul dans Node** (ONNX Runtime) ; ffmpeg ne sert que quelques secondes à lire la vidéo ;
- **une seule transcription à la fois** (verrou), **priorité la plus basse** (`nice 19`) : les pages passent avant ;
- **morceaux de 30 s**, chacun **enregistré** : si l'hébergeur arrête le processus, le cron suivant **reprend au
  morceau suivant** (et la relecture au lot suivant) ;
- **chien de garde** : un processus sans aucune avancée pendant 45 min s'arrête de lui-même ; un verrou sans battement
  depuis 30 min est retiré par le cron : rien ne bloque la file indéfiniment ;
- après un échec, l'app affiche **la raison, l'heure du nouvel essai et les essais restants** ; après **3 échecs** (ou
  24 h), « Échec de la transcription » : le déposant est prévenu, l'app propose le navigateur ;
- une transcription « en attente » depuis plus de 15 min est signalée **bloquée**, avec **« Relancer maintenant »**.

Si cPanel › **Resource Usage** montre des « fautes » pendant les transcriptions : baissez `TRANSCRIPTION_THREADS` (2),
montez `TRANSCRIPTION_REPOS=1`, ou choisissez la qualité Rapide par défaut.

### H4. Vérifier que ça marche

```bash
tail -n 20 ~/logs/esport-transcription.log    # « processus pid … démarré (rapide onnx:small, equilibree onnx:turbo…) »
tail -n 5 ~/logs/esport-cron.log              # « … tâches faites ; transcription : lancé, 1 à faire » (ou « déjà en cours (pid …) »)
cat ~/esport-modeles/lanceur.json             # dernière décision du cron
cat ~/esport-modeles/pret.json                # modèles ONNX vérifiés (SHA-256), vitesses mesurées
curl -s https://esport.appdashboard.fr/sante  # "transcriptionServeur":true
```

Dans l'app : Esport › Administration › Jeux › **Administration IA** › carte « Transcription sur le serveur » (modèles, whisper.cpp
désactivé ou non, dernière décision du cron, file, transcriptions bloquées).

### H5. Une transcription reste « En file d'attente »

1. Dans la réunion, touchez **« Relancer maintenant »** (affiché dès qu'elle est bloquée ou qu'un nouvel essai est
   prévu) : le travail repasse en tête, essais remis à zéro ; le cron le prend dans les 5 minutes.
2. Si rien ne bouge, dans le Terminal cPanel :

```bash
source /home/jayo8828/nodevenv/application-enzo/esport/22/bin/activate
cd ~/application-enzo
tail -n 5 ~/logs/esport-cron.log ; cat ~/esport-modeles/lanceur.json ; echo
tail -n 30 ~/logs/esport-transcription.log
# Verrou d'un processus disparu ou figé : le retirer (le cron le fait seul après 30 min sans battement)
cat ~/esport-modeles/travailleur.verrou 2>/dev/null && ps -o pid,etime,cmd -p "$(cat ~/esport-modeles/travailleur.verrou)"
rm -f ~/esport-modeles/travailleur.verrou
# Lancer le processus de fond à la main pour voir l'erreur tout de suite
nice -n 19 node esport/serveur/transcription/travailleur.mjs
```

---

## Partie I — Assistant IA des profils de jeu (facultatif)

La page **Esport › Administration › Jeux** (profils de jeu : formats, score, maps, personnages… voir
[docs/esport/profils-jeu.md](esport/profils-jeu.md)) marche sans IA. Avec une clé d'API d'un fournisseur d'IA (pas
Claude : celui que vous choisissez), le bouton **Préparer avec l'IA** prépare un brouillon de profil, et une
vérification hebdomadaire propose des mises à jour à valider. Tout fournisseur qui offre une API « chat
completions » compatible OpenAI convient : **NVIDIA** (build.nvidia.com), OpenAI, Mistral, Google Gemini (adresse
compatible OpenAI), DeepSeek, Groq… Sans clé d'API, une **IA installée sur le serveur** peut faire le même travail,
plus lentement : partie J.

Jusqu'à **trois moteurs** : une API **principale** (`IA_API_*`), une API **secondaire** (`IA_API2_*`, pour les tâches
légères : traductions, posts CM) et l'IA locale, essayés dans un **ordre de repli** par tâche. Tout est expliqué dans
[docs/esport/ia-api.md](esport/ia-api.md). Les données envoyées à une API externe **quittent le serveur**.

> **Confidentialité** : le contenu des **réunions** (audio, transcriptions, relecture, résumés, PDF), les notes du
> staff et les strats ne partent **jamais** chez le fournisseur d'API, quel que soit `IA_ORDRE_LEGER` : seule l'IA
> locale (partie J) les traite ; sans elle, ces tâches ne sont pas faites. Ce qui part chez NVIDIA : profils de jeu,
> traductions, textes des posts CM. Le Fondateur seul peut lever la règle, tâche par tâche (Esport › Administration › Jeux ›
> Administration IA › « Confidentialité : ce qui quitte le serveur », avec avertissement ; journalisé). L'API audio
> de transcription (`TRANSCRIPTION_API`) n'est utilisée qu'après cette autorisation explicite.

### I1. Ajouter la clé (5 minutes)

**Configuration conseillée : NVIDIA, deux modèles** (une clé par modèle, créée sur build.nvidia.com › le modèle ›
« Get API Key »). Dans le Terminal cPanel, `nano ~/.appdashboard/esport.env`, puis ajoutez à la fin ces lignes
(valeurs **factices** : remplacez les deux `nvapi-REMPLACER-…` par vos clés) :

```ini
# IA de l'Esport (docs/esport/ia-api.md) : jamais dans le dépôt.
# Moteur principal : NVIDIA, Mistral Large (profils de jeu : brouillons, vérifications)
IA_API_URL=https://integrate.api.nvidia.com/v1
IA_API_CLE=nvapi-REMPLACER-cle-du-modele-principal
IA_MODELE=mistralai/mistral-large-4-1t-a52b
# Moteur secondaire : NVIDIA, gpt-oss-20b (traductions, posts CM ; jamais les réunions)
IA_API2_URL=https://integrate.api.nvidia.com/v1
IA_API2_CLE=nvapi-REMPLACER-cle-du-modele-secondaire
IA_MODELE2=openai/gpt-oss-20b
# Ordres de repli (valeurs par défaut ; l'Administration IA peut les changer ; sans effet sur les réunions)
IA_ORDRE=api,api2,local
IA_ORDRE_LEGER=api2,api,local
```

Enregistrez (**Ctrl+O**, **Entrée**, **Ctrl+X**), redémarrez l'app Esport (étape 4 ci-dessous), puis partie I2.
Réglages fins (délai, effort de raisonnement, flux, images) : [docs/esport/ia-api.md](esport/ia-api.md).

**Un seul fournisseur, un seul modèle** (autre que NVIDIA) :

1. Créez une clé d'API chez le fournisseur choisi (son espace « API keys ») et notez le nom d'un modèle.
2. Dans le **Terminal** cPanel :

   ```bash
   nano ~/.appdashboard/esport.env
   ```

3. Ajoutez à la fin ces trois lignes (exemple Mistral ; les valeurs ci-dessous sont **factices**, remplacez-les) :

   ```ini
   # Assistant IA des profils de jeu (docs/esport/profils-jeu.md) : jamais dans le dépôt.
   IA_API_URL=https://api.mistral.ai/v1
   IA_API_CLE=cle-factice-a-remplacer-0123456789
   IA_MODELE=mistral-small-latest
   ```

   Autres fournisseurs (même principe, adresse de base de leur API) :

   | Fournisseur | `IA_API_URL` | Exemple de `IA_MODELE` |
   | --- | --- | --- |
   | NVIDIA | `https://integrate.api.nvidia.com/v1` | `mistralai/mistral-large-4-1t-a52b`, `openai/gpt-oss-20b` |
   | OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
   | Mistral | `https://api.mistral.ai/v1` | `mistral-small-latest` |
   | Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.0-flash` |
   | DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
   | Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |

   Lignes facultatives :

   ```ini
   # nvidia, openai, mistral, gemini, deepseek, groq ou autre (sinon déduit de l'adresse) :
   # IA_FOURNISSEUR=mistral
   # serveur (défaut : le serveur lit lui-même quelques pages web), modele (le modèle sait chercher), aucune :
   # IA_RECHERCHE=serveur
   ```

4. Enregistrez (**Ctrl+O**, **Entrée**, **Ctrl+X**), puis redémarrez l'app Esport : cPanel › **Setup Node.js App** ›
   l'app Esport › **Restart** (ou `touch ~/application-enzo/esport/tmp/restart.txt`). Le cron relit le fichier tout
   seul à son passage suivant.

### I2. Vérifier

Dans l'app : **Esport › Administration › Jeux › Administration IA › Moteurs de l'IA** : pour l'API principale et la secondaire,
fournisseur (NVIDIA) et modèle détectés, « Clé d'API : présente (jamais affichée) », puis **Tester** sur chacune (un
modèle à raisonnement peut mettre 10 à 60 s). **Ordre de repli** : quel moteur pour les profils de jeu, lequel pour les
tâches légères. Les plafonds mensuels (API principale 30 appels, API secondaire 200, 8 vérifications par défaut) se
règlent au même endroit, avec le compteur du mois ; au plafond, le moteur suivant prend le relais. La clé n'est
jamais renvoyée par le serveur, ni écrite dans un journal, un export ou la base.

---

## Partie J — IA locale sur le serveur (facultatif)

L'assistant des profils de jeu peut utiliser une **IA installée sur le serveur o2switch** au lieu (ou en secours)
d'une clé d'API : moteur **llama.cpp** et modèle **Qwen2.5-7B-Instruct** (licence Apache 2.0), calculés sur le
processeur. Gratuit, rien ne sort du serveur, mais plus lent (un brouillon : 5 à 15 minutes). Fonctionnement,
sécurité et réglages : [esport/ia-locale.md](esport/ia-locale.md).

### J1. Installer (une fois, 20 à 45 minutes, sans rester devant)

Le déploiement automatique doit d'abord avoir amené le code (cron `deployer.sh`, 5 minutes après la fusion ; vérifiez
que `ls ~/application-enzo/esport/serveur/installer-ia-locale.sh` répond). Puis, dans le **Terminal** cPanel :

```bash
# 1. Voir le plan (rien n'est téléchargé ni écrit) :
bash ~/application-enzo/esport/serveur/installer-ia-locale.sh --dry-run
# 2. Installer et mesurer (moteur, modèle, banc d'essai) :
bash ~/application-enzo/esport/serveur/installer-ia-locale.sh --test
```

Le script vérifie la machine et l'espace disque, **compile le moteur** llama.cpp (CloudLinux 8 : les binaires tout
faits demandent une glibc plus récente ; la compilation se fait sans droit administrateur avec un GCC récent
téléchargé et vérifié, 10 à 30 minutes), télécharge le modèle (≈ 4,7 Go, avec reprise si la connexion coupe, empreinte
SHA-256 vérifiée), lance un **banc d'essai** (chargement, jetons par seconde, mémoire, un JSON en anglais, un résumé en
français) et termine par une **recommandation** et les lignes à copier. Si le Terminal se ferme en route : relancez
la même commande, elle reprend où elle en était (rien n'est refait inutilement).

Espace disque : ≈ 2,5 Go de plus pendant la compilation (effacés à la fin) ; au final **≈ 4,7 Go** (≈ 2,5 Go avec
`--petit`), dans `~/.appdashboard/ia-locale` (hors du dépôt et de `public_html` ; `deployer.sh` n'y touche pas).

Serveur trop lent d'après le banc d'essai : modèle plus petit et deux fois plus rapide (Qwen3-4B, Apache 2.0) :

```bash
bash ~/application-enzo/esport/serveur/installer-ia-locale.sh --petit --test
```

### J2. Brancher (2 minutes)

```bash
nano ~/.appdashboard/esport.env
```

Ajoutez les lignes **affichées à la fin du script** (exemple avec les valeurs par défaut ; `qwen3-4b` après `--petit`) :

```ini
# IA locale (docs/esport/ia-locale.md)
IA_FOURNISSEUR=local
IA_LOCALE_MODELE=qwen2.5-7b
IA_LOCALE_THREADS=8
```

Gardez les lignes `IA_API_*` / `IA_API2_*` si vous avez des clés d'API : elles servent de secours (ordre de repli,
partie J3). Sans `IA_FOURNISSEUR=local`, l'IA locale reste en dernier recours (`IA_ORDRE=api,api2,local`). Enregistrez
(**Ctrl+O**, **Entrée**, **Ctrl+X**) puis redémarrez l'app Esport :

```bash
mkdir -p ~/application-enzo/esport/tmp && touch ~/application-enzo/esport/tmp/restart.txt
```

### J3. Choisir et tester

**Esport › Administration › Jeux › Administration IA › Ordre de repli** : placez l'**IA locale** où vous voulez pour les profils de
jeu et pour les tâches légères (seule, en tête avec les API en secours, ou en dernier recours), puis **Tester l'IA
locale** (le premier test charge le modèle : jusqu'à une minute). La carte « Moteur de l'IA » affiche le modèle,
« en marche » ou « arrêtée (démarre à la demande) », la dernière vitesse et le dernier temps de réponse.

Le moteur ne tourne **que quand une tâche arrive** (écoute sur `127.0.0.1` seulement) et s'arrête après 5 minutes
sans travail. Les brouillons et vérifications sont calculés par un **processus de fond** (lancé par l'app, relancé
par la tâche cron Esport si besoin) : rien à ajouter dans les tâches cron.

### J4. Vérifier, dépanner

```bash
tail -n 30 ~/logs/esport-ia-locale.log        # démarrages / arrêts du moteur, travaux du processus de fond
tail -n 5 ~/logs/esport-cron.log              # « profils de jeu (IA) » : ia-locale : lancé / rien à faire
cat ~/.appdashboard/ia-locale/pret.json       # moteur, modèle, empreintes, mesures du --test
pgrep -af llama-server                        # moteur en marche (rien = arrêté, c'est normal au repos)
```

- **« IA locale occupée »** : une autre tâche utilise le moteur (une à la fois) ; réessayez, ou ajoutez une API après
  l'IA locale dans l'**ordre de repli**.
- **« L'IA locale n'a pas pu démarrer »** : voir `~/logs/esport-ia-locale.log` ; relancez
  `bash ~/application-enzo/esport/serveur/installer-ia-locale.sh --test`.
- **« Le moteur d'IA locale a été arrêté de force pendant le calcul (SIGKILL) »** (ou « coupé la connexion
  (ECONNRESET) ») : ce n'est pas la limite mémoire (48 Go, aucune faute dans Resource Usage). Chaque signal envoyé par
  nos programmes est journalisé : `grep -E "signal SIG|imprévue" ~/logs/esport-ia-locale.log | tail -n 40` ; puis
  `installer-ia-locale.sh --petit --diagnostic` (moteur lancé seul) dit « tué par nous » ou « tué par l'extérieur » et
  prépare un message pour le support : voir docs/esport/ia-locale.md, « Tué par nous ou tué par l'extérieur ? ».
- **« IA locale indisponible sur cet hébergement »** (Administration IA) : son moteur a été arrêté de force par
  l'hébergeur 2 fois de suite (`IA_LOCALE_TUES_MAX`). Elle reste configurée mais elle est **sautée** dans les ordres
  de repli : les API répondent à sa place, plus aucune attente. Pour la réessayer (après un changement chez
  l'hébergeur) : `rm ~/.appdashboard/ia-locale/etat/hebergement.json` (ou relancer `installer-ia-locale.sh`). Piste
  pour plus tard (pas faite) : `node-llama-cpp`, qui calculerait dans le processus Node comme la transcription.
- **« Le serveur Esport ne répond pas »** en testant un moteur (Administration IA) : corrigé le 30/10 ; le test d'un
  modèle à raisonnement ou de l'IA locale continue en tâche de fond (la page interroge son résultat, 90 s au plus pour
  une API, 4 min pour l'IA locale) au lieu de dépasser le délai de 15 s de l'app.
- **Site plus lent pendant un calcul** ou fautes dans cPanel › **Resource Usage** : `IA_LOCALE_THREADS=4` dans
  `esport.env` (puis restart), ou le modèle `--petit`.

### J5. Désinstaller

```bash
rm -rf ~/.appdashboard/ia-locale
rm -f ~/logs/esport-ia-locale.log
```

Retirez `IA_FOURNISSEUR=local` et les lignes `IA_LOCALE_*` de `~/.appdashboard/esport.env`, puis redémarrez l'app
(`touch ~/application-enzo/esport/tmp/restart.txt`).

---

## Partie K — Esport en temps réel (moins d'une seconde)

Détails : [esport/temps-reel.md](esport/temps-reel.md). Le cron installe la migration 0040 ; `/sante` de l'Esport
annonce `"tempsReel":"sse"` et la fonction `temps-reel`. Rien d'obligatoire à faire.

**Ce que ça change pour l'hébergement** : chaque navigateur ouvert sur l'Esport (page visible) garde **une**
requête longue vers `esport.appdashboard.fr` (5 min au plus, puis une nouvelle), quel que soit le nombre d'onglets.
Garde-fous du serveur : 2 par compte et par adresse IP, 4 par compte, 30 par processus (`TEMPS_REEL_MAX`), 60
appels par minute et par adresse ; au-delà, l'app passe d'elle-même au sondage (15 s).

**À vérifier la première semaine**

1. Mode annoncé : `curl -s https://esport.appdashboard.fr/sante` → `"tempsReel":"sse"`.
2. Le flux passe sans être retenu : dans l'app, la pastille en bas à droite de l'Esport dit **En direct** (vert).
   « Mise à jour régulière » = l'app est descendue au sondage (intermédiaire qui retient le flux, ou 429) ;
   « Reconnexion… » qui reste = le flux est coupé. Deux navigateurs ouverts sur le même tableau CM : une carte
   déplacée d'un côté bouge de l'autre en moins d'une seconde.
3. Mesures (Fondateur) : dans la console du navigateur de l'app, ou avec la session, `GET /temps-reel/etat`
   (connexions, refus, latence du serveur au navigateur).
4. cPanel › **Statistiques de ressources** : la colonne **EP** (entry processes) monte d'environ une unité par
   navigateur ouvert. Si elle approche la limite (souvent 20 à 30) ou montre des « faults » : `TEMPS_REEL_MAX=10`,
   ou repli (ci-dessous).
5. Si le flux arrive par paquets (pastille « Mise à jour régulière » alors que le serveur répond) : dans le
   `.htaccess` du sous-domaine `esport.`, au-dessus des lignes de Passenger :

   ```apache
   <IfModule LiteSpeed>
     SetEnvIf Request_URI "/temps-reel/" no-gzip=1 dont-vary=1
   </IfModule>
   ```

**Revenir en arrière si le pare-feu réagit mal** (adresse bannie, partie H bis, ou EP pleins) : dans
`~/.appdashboard/esport.env`, la ligne `TEMPS_REEL=sondage` (aucune connexion tenue : une requête courte toutes les
15 s par navigateur), puis « Setup Node.js App » › app Esport › **Restart**. Les onglets déjà ouverts reçoivent
« utilise le sondage » (429) à leur prochaine requête et s'y tiennent. Étape intermédiaire possible :
`TEMPS_REEL=attente` (attentes longues de 50 s, une par navigateur). Le reste (verrou « le premier qui enregistre a
la main », présence) marche dans tous les modes.

**Plusieurs processus Node** : les messages passent par PostgreSQL (`LISTEN/NOTIFY`), un processus de plus ne
change rien ; chaque processus qui a des navigateurs connectés tient **une** connexion PostgreSQL de plus.

**Hub** : pour la même vitesse sur la synchro du hub, `SYNCHRO_TEMPS_REEL=attente` dans `relais.env` (partie H),
seulement après une semaine sans souci ici.

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
| Des membres n'arrivent pas à se connecter avec le bon mot de passe, ou « (prénom inconnu) » dans l'Administration | [diagnostic-comptes.md](diagnostic-comptes.md) : Administration › Utilisateurs › fiche › « Diagnostic de connexion » (et « Débloquer ») ; dans le terminal : `node relais/serveur/diagnostic-connexions.mjs` (après le `source …/activate`) et `grep -hF "[relais] connexion" ~/logs/relais-passenger.log \| tail -n 50`. |
| Page « We're sorry, but something went wrong » ou erreur 503 sur esport./relais. | Lisez le journal de l'app : `tail -n 50 ~/logs/esport-passenger.log` (ou `relais-passenger.log`). Sans réglage de journal, Passenger écrit dans `stderr.log` du dossier de l'app (`~/application-enzo/esport/stderr.log`). Redémarrer : **Setup Node.js App** › l'app › **Restart**, ou `touch ~/application-enzo/esport/tmp/restart.txt`. |
| Tickets Discord : « Connexion Discord : Hors ligne » | Ouvrez **Tickets › Configuration › Connexion** : le **diagnostic** dit quelle condition manque (jeton, serveur, catégorie, activation, app arrêtée, `URL_PUBLIQUE`, tâche cron jamais vue, avec la commande à copier). Détails : [esport/tickets.md](esport/tickets.md). |
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
| « Clés du serveur NON reprises » | L'ancien serveur n'expose pas ses clés : recopiez `CLE_ESPORT` et `CLE_DISCORD` de son `esport.env` dans le nouveau, puis redémarrez l'app Esport. |
| Envoi d'une vidéo bloqué dès le premier morceau (413, « Requête refusée ») | Pare-feu de l'hébergeur : `ESPORT_TAILLE_MORCEAU=2M` dans `esport.env`, redémarrez l'app ; sinon cPanel › **ModSecurity** › désactivé pour `esport.appdashboard.fr`. Détails : [docs/esport/videos.md](esport/videos.md). |
| Transcription : l'app ne propose pas « Serveur (automatique) » | L'installation n'est pas faite ou pas vérifiée : relancez `bash ~/application-enzo/esport/serveur/installer-transcription.sh` (il doit finir par « Transcription serveur prête »), puis **Restart** de l'app Esport (`cat ~/esport-modeles/pret.json` : rubrique `onnx`). |
| Transcription : « En file d'attente » depuis plus de 10 minutes | Dans la réunion : **« Relancer maintenant »**. Puis voir partie H5 : `tail -n 5 ~/logs/esport-cron.log` (la ligne dit « transcription : lancé / déjà en cours (pid …) / rien à faire »), `tail -n 30 ~/logs/esport-transcription.log`, et lancer à la main : `cd ~/application-enzo && nice -n 19 node esport/serveur/transcription/travailleur.mjs` (après le `source …/activate`). |
| Transcription : « whisper.cpp s'est arrêté (signal SIGKILL) » | L'hébergeur tue ce binaire : depuis le 30/10 le moteur par défaut est ONNX **dans Node**. Installez-le : `bash esport/serveur/installer-transcription.sh --tous` puis `--test` ; un travail encore sur whisper.cpp bascule tout seul sur ONNX. |
| Transcription : « Interrompue trop souvent (limite de l'hébergeur ou redémarrage) » | Le processus est arrêté avant d'avancer (mémoire ou processeur du compte) : cPanel › Statistiques, puis `TRANSCRIPTION_THREADS=2`, qualité Rapide, ou `TRANSCRIPTION_REPOS=1`. Dans l'app : « Réessayer sur le serveur », ou « Transcrire » dans le navigateur d'un PC. |
| Transcription : « Mémoire insuffisante… » | Modèle trop gros pour `TRANSCRIPTION_RAM_MAX` : montez-le (`--test` affiche la mémoire réelle de chaque modèle), ou choisissez la qualité Rapide. |
| Installation : « glibc trop ancienne » ou erreur au chargement d'ONNX Runtime | Le serveur est trop ancien pour les binaires tout faits : gardez la transcription dans le navigateur (`TRANSCRIPTION_MODE=navigateur`) et signalez-le au support o2switch (ils migrent les comptes vers des serveurs récents). |
| Installation : « Hugging Face indisponible » | Rien à faire : le script prend l'archive GitHub à la place (plus grosse, environ 200 Mo pour « base »). Si GitHub échoue aussi : réessayez plus tard. |
| Transcription : « ffmpeg n'a pas pu lire l'enregistrement » | Fichier abîmé ou format exotique : déposez un MP4, M4A, MP3 ou WAV. |
| Jeux : « Assistant IA non configuré (clé d'API absente) » | Les lignes `IA_API_URL`, `IA_API_CLE`, `IA_MODELE` de `esport.env` (partie I), puis **Restart** de l'app Esport. **Jeux › Administration IA** dit ce qui manque. |
| Jeux : « Le service d'IA refuse la clé d'API » | Clé fausse ou révoquée chez le fournisseur (NVIDIA : une clé par modèle) : recopiez-la dans `IA_API_CLE` (ou `IA_API2_CLE`), **Restart**. |
| Jeux : « Le service d'IA limite les appels (quota ou débit…) » | Limite de débit du fournisseur (HTTP 429, fréquente sur NVIDIA) sur tous les moteurs de l'ordre de repli : réessayez plus tard, ou ajoutez un moteur (IA locale) à l'ordre. Voir [docs/esport/ia-api.md](esport/ia-api.md). |
| Jeux : « Modèle ou adresse inconnus du service d'IA » | `IA_MODELE` doit être un modèle de votre fournisseur ; `IA_API_URL` son adresse de base (tableau de la partie I). |
| Jeux : « IA locale non installée » / « IA locale occupée » / « n'a pas pu démarrer » | Partie J : installer (`installer-ia-locale.sh --test`), lignes `IA_LOCALE_*` de `esport.env`, `~/logs/esport-ia-locale.log`. « Occupée » : une tâche à la fois, réessayer, ou mettre une API après l'IA locale dans l'ordre de repli (Administration IA). |
| Jeux : « Plafond mensuel … atteint » | **Jeux › Administration IA** › Plafonds mensuels : montez-les, ou attendez le mois suivant. |
| « Trop de demandes en peu de temps » pour tout le monde | Les limites de débit se basent sur l'adresse IP vue par le serveur (dernière entrée de `X-Forwarded-For` posée par le frontal d'o2switch) : un intermédiaire commun (VPN, réseau d'entreprise) peut faire partager un compteur à plusieurs appareils. Patientez quelques minutes. |

Journaux utiles : `~/logs/esport-deploy.log` (déploiements), `~/logs/esport-cron.log` (tâches planifiées),
`~/logs/esport-transcription.log` (transcriptions sur le serveur), `~/logs/esport-passenger.log` et
`~/logs/relais-passenger.log` (les deux apps).

Pour les curieux : les fichiers concernés sont `esport/serveur/` (serveur Esport, cron, migrations, import,
`deployer.sh`), `relais/serveur/` (relais et sa boîte PostgreSQL), `esport/adaptateurs/postgres.mjs`,
`scripts/htaccess-o2switch.mjs`, `.github/workflows/site-o2switch.yml` et `.cpanel.yml`.

---

## Migrer vers un autre serveur

Les outils de migration sont génériques (d'un serveur Node à un autre) : sur le **nouveau** serveur, une fois la
partie A faite avec le même jeton maître,

```bash
RELAIS_SOURCE=https://ADRESSE-DE-L-ANCIEN-RELAIS node relais/serveur/importer.mjs
ESPORT_SOURCE=https://ADRESSE-DE-L-ANCIEN-ESPORT node esport/serveur/importer.mjs
```

Le premier copie toute la boîte du relais (`GET /admin/boite`, rejouable, rien n'est effacé) ; le second copie la
base Esport dans une base **vide**, vérifie le nombre de lignes de chaque table, puis les fichiers
(`--fichiers-seulement` pour reprendre après une coupure). Les clés `CLE_ESPORT` et `CLE_DISCORD` se recopient à la
main depuis l'ancien `esport.env`. Le coffre serveur (tables `relais_coffre…`) se copie avec la base PostgreSQL
(sauvegarde cPanel puis restauration). Export JSON hors ligne : `esport/outils/transfert.mjs`.

---

## Historique : le déménagement depuis Cloudflare (octobre 2026)

Jusqu'en octobre 2026, le site était sur Cloudflare Pages, le relais et le serveur Esport sur deux Workers Cloudflare
(boîte KV, base D1, fichiers R2). Le déménagement vers o2switch s'est fait en trois temps : installation ci-dessus,
import des données par les outils de « Migrer vers un autre serveur », puis bascule (les anciens Workers ont transmis
quelques semaines les requêtes vers o2switch, le temps que tous les appareils suivent). Le compte Cloudflare et toutes
ses ressources ont ensuite été supprimés, et le code propre à Cloudflare (Workers, workflows de déploiement, mode
transmission) a été retiré du dépôt.

Un appareil resté sur une ancienne adresse (relais `…workers.dev`, site `…pages.dev`) ne se synchronise plus : il
suffit de se reconnecter sur https://appdashboard.fr avec son identifiant et son mot de passe (sur le PC, mettre à
jour `relais/relais-local.json`, voir partie B).
