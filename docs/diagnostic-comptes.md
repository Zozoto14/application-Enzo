# Diagnostic des comptes : « (prénom inconnu) » et connexions refusées

Point complet de novembre 2026 sur deux symptômes signalés par le Fondateur :

1. dans **Administration › Utilisateurs**, tous les comptes sauf « Moi » s'affichaient « (prénom inconnu) », avec un
   avatar « ( » ;
2. **par moments**, des membres n'arrivaient plus à se connecter alors qu'ils tapaient le bon nom et le bon mot de
   passe.

Ce document dit ce qui n'allait pas, ce qui a été corrigé, et ce qu'il faut regarder sur le serveur.

---

## 1. « (prénom inconnu) » partout

### Où l'Administration prend les prénoms

Les prénoms ne sont **pas** sur le serveur. Ils sont dans l'annuaire des comptes, dans un **bloc privé chiffré** pour
le Fondateur (`prive` dans `src/profils/annuaire.ts`) : prénom, date de création et code d'accès de chaque compte.
Chaque compte a aussi une empreinte salée de son prénom (pour le retrouver à la connexion par prénom) et un prénom
scellé. Le bloc privé voyage entre les appareils du Fondateur par le relais (`src/profils/synchroAnnuaire.ts`).

### Cause confirmée : le bloc privé était écarté en silence au-delà d'une taille

À la relecture de l'annuaire, chaque champ chiffré était borné à **4096 caractères**. Le bloc privé grossit d'environ
260 caractères par compte (prénom, date, code d'accès créé à la première connexion du membre). **À partir de 14 à 15
comptes déjà connectés, il dépassait la borne et était jeté sans erreur** :

- tous les prénoms devenaient « (prénom inconnu) », le vôtre aussi (d'où « Moi ») ;
- l'avatar prenait la première lettre du texte de remplacement : « ( » ;
- la synchronisation publiait ensuite un annuaire **sans** bloc privé : la perte gagnait les autres appareils.

Le club venait de passer 16 membres : c'est exactement le moment où tout a basculé.

Reproduit par le test `src/profils/comptesNoms.test.ts` (17 comptes Esport réalistes, chacun connecté une fois) : il
échoue avec l'ancienne borne et passe maintenant.

### Effets secondaires confirmés (aggravants)

- **Le texte de remplacement était rescellé comme prénom** à la moindre modification dans l'Administration. Avec un
  seul compte inconnu, son empreinte devenait celle de « (prénom inconnu) » : il ne se retrouvait plus par son
  prénom sur un appareil (connexion par prénom refusée). Avec deux comptes inconnus ou plus, **toute** modification
  échouait (« Le prénom « (prénom inconnu) » est déjà pris »).
- Une invitation renvoyée à un compte inconnu partait avec l'identifiant « (prénom inconnu) ».
- **Synchronisation avant déverrouillage** : un appareil qui avait réécrit son bloc privé puis redémarrait pouvait
  publier ce bloc par-dessus celui d'un autre appareil (règle « dernier gagnant », sans les clés pour réunir les
  deux) : les prénoms ajoutés ailleurs disparaissaient.

### Corrections

- Borne du bloc privé portée à 4 Mio (`TAILLE_MAX_BLOC_PRIVE`), pour l'annuaire et pour le bloc d'un titulaire.
  **Si un appareil a encore l'ancien bloc complet dans son fichier, il est relu tel quel** : les prénoms reviennent
  seuls à la prochaine ouverture de cet appareil.
- Le texte de remplacement n'est **jamais** enregistré ni scellé : un compte sans prénom garde son empreinte et son
  prénom scellé ; un ancien bloc qui le contient le traite comme inconnu.
- Synchronisation : un bloc privé perdant faute de clés est **gardé de côté** sur l'appareil, puis réuni au prochain
  tour déverrouillé. Un bloc supprimé ailleurs n'est plus perdu en silence.
- Affichage : à la place de « (prénom inconnu) », le **pseudo Esport**, sinon l'**adresse e-mail masquée**
  (`l•••a@g•••l.com`), sinon « Compte » et le début de l'identifiant ; jamais d'avatar « ( ». Un bandeau compte les
  comptes concernés.
- **« Réparer les prénoms »** (bandeau en haut de la liste) : cherche des candidats dans votre journal de
  l'Administration (prénoms notés lors des invitations, créations…) et dans l'Esport (pseudos). **Rien n'est
  deviné** : un candidat n'est retenu que si son empreinte est exactement celle du compte, c'est-à-dire le prénom
  avec lequel le compte a été créé. Les autres se saisissent dans la fiche (champ Prénom, Renommer).
- Tant que le prénom manque, l'invitation et la régénération des identifiants sont refusées avec un message clair.

---

## 2. Connexions refusées avec le bon mot de passe

### Qui authentifie

- **Connexion au hub** (prénom + mot de passe) : le **relais** (`relais/relais.mjs`, route `/acces/<empreinte>/ouvrir`).
  Le mot de passe ne quitte jamais l'appareil : il en tire une preuve (Argon2id, forme canonique NFC, espaces et
  apostrophes typographiques normalisés, invisibles retirés) ; l'identifiant est comparé sans casse, accents ni
  espaces superflus. Ce chemin-là était juste : aucun problème de normalisation trouvé (vérifié).
- **Esport** : l'app présente son jeton du relais au serveur Esport (`POST /session`), qui le fait vérifier par le
  relais et rend une session d'une heure, signée (sans état en mémoire : valable sur tous les processus).

### Causes trouvées

| Cause | Statut | Effet vu par le membre |
|---|---|---|
| Limite « 10 échecs par adresse IP » **en mémoire du processus** : tout le Wi-Fi du club (ou la même antenne 4G) partageait un compteur, les fautes de frappe des uns bloquaient les autres jusqu'à 15 min, **et** chaque processus Passenger avait le sien (bloqué sur l'un, pas sur l'autre ; remis à zéro au redémarrage) | Confirmée (code), reproduite par test | « Trop de tentatives » au hasard, même avec le bon mot de passe |
| Adresse inconnue (proxy qui ne transmet pas `X-Forwarded-For`) : tous les comptes du monde dans **un seul** compteur | Probable selon la configuration o2switch, à vérifier (voir 4) | Blocage général de quelques minutes |
| Compteur par identifiant jamais oublié tant qu'il y a une faute par jour : au 6e oubli dans la semaine, verrou de 30 s à 1 h dès la première faute | Confirmée (code) | « Trop de tentatives » après une seule faute |
| **Panne passagère de la base** (délai PostgreSQL, connexions épuisées) lue comme « identifiant inconnu » : réponse « mot de passe incorrect » **et** un échec compté vers le verrou | Confirmée (code), reproduite par test | « Identifiant ou mot de passe incorrect » avec le bon mot de passe |
| Esport : au chargement d'une page, **chaque requête ouvrait sa session** (rafale de `POST /session`), limite de 30 par minute **par adresse** | Confirmée (code), reproduite par test | « Trop de demandes » dans l'Esport, pour tout le club en même temps |
| Esport : échéance de session calculée avec l'horloge de l'appareil | Confirmée (mineure) | Sessions rouvertes sans cesse sur un appareil mal à l'heure |
| SQLite sans délai d'attente (`busy_timeout`) ni WAL : une écriture pendant celle d'un autre processus échouait aussitôt (« database is locked ») | Confirmée (code) ; en production l'Esport est sur PostgreSQL, donc concerne le serveur local et les essais | Erreur serveur au hasard |
| Prénom inconnu rescellé (partie 1) : connexion par prénom refusée sur un appareil | Confirmée | « Mot de passe incorrect » sur un appareil, pas sur un autre |

Vérifié et **hors de cause** : normalisation Unicode et espaces des mots de passe et identifiants, sessions Esport
(signées, sans mémoire), jeton de session du Fondateur (en base, 180 jours), invitation « expirée » sur un appareil dont
le coffre est déjà accepté (déjà géré).

### Corrections

- Limites par adresse rangées **dans la base** (`relais/connexions.mjs`) : les mêmes pour tous les processus,
  survivent aux redémarrages, et le Fondateur peut les lever. Seuil adapté aux adresses partagées : 30 échecs libres,
  attente plafonnée à 5 min. La vraie protection contre la force brute reste la limite **par identifiant** (5 essais,
  puis attente doublée jusqu'à 1 h).
- Une adresse inconnue ou interne (127.0.0.1, 10.x…) n'est **jamais** limitée.
- Compteur d'un identifiant oublié après une heure sans échec.
- Panne de la base pendant une connexion : réponse 503 « erreur du serveur, ton mot de passe n'est pas en cause »,
  aucun échec compté.
- Esport : une seule ouverture de session à la fois (partagée par toutes les requêtes) ; limite portée à 240 par
  minute et par adresse ; échéance relative à l'heure du serveur.
- SQLite : `busy_timeout = 5000`, journal WAL, lots en `BEGIN IMMEDIATE`.

---

## 3. Diagnostic dans l'Administration

**Administration › Utilisateurs › (un compte) › Diagnostic de connexion › Voir les dernières tentatives** :

- les 12 dernières tentatives relevées par le relais : date, cause (connexion réussie, mauvais mot de passe, compte
  introuvable, verrouillé, bloqué par l'adresse, invitation expirée / déjà utilisée / remplacée, accès révoqué, code à
  six chiffres faux, session refusée par l'Esport, erreur du serveur, débloqué), et le **début** de l'adresse
  (`203.0.113.x`) ;
- l'état du verrou de son identifiant et des adresses bloquées ;
- une phrase « cause probable » ;
- **Débloquer** : lève tout de suite le verrou de l'identifiant et la limite des adresses vues dans ses tentatives
  (noté au journal).

Confidentialité : le relais ne reçoit jamais de mot de passe ; le journal ne garde ni preuve, ni jeton, ni adresse
complète, ni e-mail (30 tentatives par compte, 90 jours). Une faute de frappe sur l'identifiant est notée à part
(« identifiant inconnu essayé », date et adresse masquée).

---

## 4. Ce qu'il faut faire et regarder sur le serveur (terminal cPanel)

Aucune commande ci-dessous n'affiche de secret. Les chemins sont ceux de [o2switch.md](o2switch.md)
(`/home/jayo8828`, journaux dans `~/logs/`).

### Après la mise à jour

1. La mise à jour se déploie seule (cron, `~/logs/esport-deploy.log` : « serveurs Esport et relais redémarrés »).
2. Ouvrez AppDashboard **sur chaque appareil où vous êtes Fondateur** (PC d'abord), déverrouillé : si un appareil a
   gardé l'ancien bloc complet, les prénoms reviennent seuls et partent vers les autres.
3. S'il reste des comptes sans prénom : Administration › Utilisateurs › **Réparer les prénoms**. Pour les derniers,
   ouvrez la fiche et saisissez le prénom exact de leur identifiant de connexion (celui de l'invitation), puis
   **Renommer**.

### Tentatives de connexion et verrous

```bash
cd ~/application-enzo
source ~/nodevenv/application-enzo/esport/22/bin/activate
# Verrous en cours, dernières tentatives (tous comptes), échecs par cause :
node relais/serveur/diagnostic-connexions.mjs
# Un compte précis (identifiant interne du compte, affiché dans les lignes ci-dessus) :
node relais/serveur/diagnostic-connexions.mjs esp0000001
# Urgence : lever TOUS les verrous (identifiants et adresses) :
node relais/serveur/diagnostic-connexions.mjs --tout-debloquer
```

### Journaux

```bash
# Chaque tentative, une ligne (compte ou début de l'identifiant, cause, adresse masquée) :
grep -hF "[relais] connexion" ~/logs/relais-passenger.log | tail -n 50
# Échecs comptés par cause :
grep -hF "[relais] connexion" ~/logs/relais-passenger.log | grep -v ": succes" | sed 's/.* : \([a-z0-9-]*\) .*/\1/' | sort | uniq -c | sort -rn
# Pannes du serveur pendant une connexion (base de données) :
grep -h "erreur serveur\|erreur-serveur\|postgres" ~/logs/relais-passenger.log | tail -n 30
# Sessions Esport refusées (code et adresse masquée) :
grep -hF "[esport] session refusée" ~/logs/esport-passenger.log | tail -n 30
```

Sans réglage de journal dans « Setup Node.js App », Passenger écrit dans `~/application-enzo/relais/stderr.log` et
`~/application-enzo/esport/stderr.log` : remplacez le chemin dans les commandes.

### Adresse vue par le serveur (à vérifier une fois)

Si toutes les lignes `[relais] connexion` montrent `adresse inconnue` ou `127.0.0.x`, le proxy de l'hébergeur ne
transmet pas l'adresse du visiteur : les limites par adresse sont alors ignorées (plus de blocage collectif), et seule
la limite par identifiant protège. Signalez-le au support o2switch (« `X-Forwarded-For` n'arrive pas jusqu'à
l'application Node »).

### Processus

```bash
# Combien de processus Node tournent pour chaque app (plusieurs = normal ; les limites sont maintenant partagées) :
ps -u "$USER" -o pid,etime,rss,args | grep -E "relais/serveur|esport/serveur" | grep -v grep
```

---

## 5. Tests de non-régression

| Fichier | Ce qu'il vérifie |
|---|---|
| `src/profils/comptesNoms.test.ts` | Bloc privé de 17 comptes relu intact ; texte de remplacement jamais scellé ; réparation vérifiée par empreinte ; synchronisation sans clés puis réunion |
| `src/hub/admin/ui/adminNomsInconnus.test.tsx` | Nom de repli, avatar, bandeau, « Réparer les prénoms », diagnostic et « Débloquer » |
| `relais/diagnostic.test.mjs` | Wi-Fi du club partagé, proxy sans adresse, deux processus sur la même base, compteur oublié après une heure, journal sans secret, invitation expirée notée, panne de la base, jeton Esport refusé, script du terminal |
| `src/esport/sessionsConcurrentes.test.ts` | 20 requêtes simultanées = une session ; session expirée partagée ; horloge décalée ; échec non gardé |
| `esport/test/connexions-club.test.mjs` | 60 membres sur une adresse ; SQLite partagé entre deux processus (attend au lieu de « database is locked ») |
