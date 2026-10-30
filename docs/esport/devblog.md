# Devblog (notes de mise à jour)

Le devblog annonce aux membres ce qui a changé dans l'app, dans la DA du devblog posté à la main par le Fondateur
sur Discord (« 🚀 DEVBLOG — Nouvelle Mise à Jour ! 🛠️ ») : un titre, une phrase d'intro, des sections (emoji + titre
en gras) avec des puces courtes « **Nom :** description », une phrase de fin.

Migrations `0036_devblog.sql`, `0037_devblog_auto.sql` · serveur `esport/noyau/devblog/`, `esport/serveur/devblog-source.mjs` ·
app `src/esport/ui/devblog/`, `src/esport/devblog/`.

## Ce que voient les membres

- **Fenêtre « Nouveautés »** à l'entrée dans l'app Esport : le **dernier** devblog publié, s'il n'a pas encore été vu
  par ce compte, dans la langue du compte (l'anglais incomplet retombe sur le français). « J'ai compris » le marque
  **vu en base** (`devblog_vus`) : il ne revient sur aucun appareil. La croix (ou Échap) ferme sans marquer : la
  fenêtre revient à la prochaine ouverture. Un nouveau membre ne voit **que le dernier** devblog, jamais l'historique.
- **« Voir tous les devblogs »** (dans la fenêtre) ou le bouton **« ✨ Nouveautés »** de l'en-tête du Dashboard :
  la page Devblog, tous les devblogs publiés du plus récent au plus ancien. Aucune entrée de plus dans la barre du bas
  du téléphone.

## Gérer le devblog (Fondateur)

Réservé au Fondateur, et aux comptes à qui il confie la permission du club **`devblog.gerer`** (page Membres › Rôles
et permissions, rôle du club ; catégorie Administration). Elle est **désactivée par défaut**, y compris pour le
Second CEO.

Dashboard › « ✨ Nouveautés » › **Nouveau devblog** ou **Modifier ›** sur un devblog :

- date (AAAA-MM-JJ), version facultative (petite ligne sous le titre sur Discord) ;
- onglets **Français / Anglais** : titre, intro, sections (emoji, titre, puces nom + description ; monter,
  descendre, retirer), phrase de fin ;
- **aperçu en direct** « Comme sur Discord » (messages découpés à 2000 caractères, fil français) ou « Comme dans
  l'app » (dans l'une ou l'autre langue) ;
- **✨ Préparer avec l'IA** (onglet Anglais) : propose la version anglaise à partir du français. Tâche légère
  (« traduction ») passée au connecteur IA existant (`discuterPour`, ordre de repli réglé dans l'Administration IA) ;
  **seul le texte du devblog** est envoyé (rien sur le club ni sur ses membres ; les emojis sont repris tels quels).
  La proposition remplace l'anglais dans l'éditeur : à relire, puis **Enregistrer**. Une puce oubliée par l'IA garde
  le texte français ;
- **Publier dans l'app** (les versions française ET anglaise doivent avoir un titre et au moins une puce) ;
  **Repasser en brouillon** (retire de l'app ; les marques « vu » restent) ; **Supprimer**.

Un brouillon n'est visible que des gestionnaires (404 pour les autres).

### Premier devblog

Au premier passage d'un gestionnaire, un devblog **en brouillon** est posé (`devblog-2026-10-30`, FR et EN) : tout ce
qui a été livré depuis le devblog du 23/10/2026 (Compétition & Jeux, Section CM, Membres & Rôles, Discord, IA &
Transcription, Corrections). Il n'est **jamais publié automatiquement** : le Fondateur le relit, le corrige, le publie.
Supprimé, il ne revient pas (réglage `amorce`).

## Publier sur Discord

Dans l'éditeur d'un devblog publié, carte **📣 Publier sur Discord** :

1. **Salons** : cochez les salons. Proposés : les salons du club (webhooks de la page Réseaux du CM, `cm_rs_salons`),
   le salon du club lié au bot (s'il est réglé) et le salon Discord de chaque team (bot lié, sinon webhook ; module
   Discord actif). « Garder ces salons cochés par défaut » mémorise le choix (« annonces du club »).
2. **Salon d'annonces du club** (en bas de la carte) : ajouter un webhook (nom + adresse : chiffré et rangé avec les
   salons de la page Réseaux, coché par défaut), ou lier un salon où le bot est présent (identifiant numérique du
   salon : clic droit › Copier l'identifiant).
3. **Mentionner @here** : coché par défaut. Une seule fois, à la fin du message anglais (comme le devblog posté à la
   main), **jamais dans le fil français** ; aucune autre mention possible (le texte saisi est neutralisé).
4. **Aperçu avant envoi** : le texte exact généré par le serveur.
5. **Publier sur Discord**.

Règle du club : le message principal part en **anglais**, puis le bot ouvre un fil **« 🇫🇷 Version française · DEVBLOG —
… »** sur ce message, avec la version française. Texte Markdown Discord (pas d'embed, aperçus de liens supprimés).
Au-delà de **2000 caractères**, le texte est découpé proprement (entre deux sections, sinon entre deux lignes, sinon
entre deux mots) : plusieurs messages anglais à la suite, plusieurs messages français dans le fil.

- **Jamais deux fois** : une ligne par devblog et par salon (`devblog_discord`). Republier sans changement :
  « Déjà publié ». Après une **correction** du texte, le bouton devient « Publier la correction » : les messages
  déjà postés sont **réédités** (aucune nouvelle mention) ; un morceau en plus est posté à la suite, un morceau en trop
  est supprimé. Si le premier message a été supprimé dans Discord, tout est reposté (sans mention).
- Envoi juste après la requête, puis par le cron (`devblog Discord`) : étapes reprenables (messages anglais, fil,
  messages français) enregistrées une à une ; nonce du bot ; limite de débit de Discord respectée ; réessais 1 min,
  5 min, 15 min, 1 h, 3 h puis abandon (l'erreur s'affiche dans la carte).
- Sans bot (`DISCORD_BOT_TOKEN`) ou sans permission de créer des fils : l'anglais part seul, l'état indique « sans fil
  français ».
- Publication refusée tant que le devblog est en brouillon, ou qu'il reste des modifications non enregistrées.

## Publier en un clic, programmer, publier automatiquement

Tout est réservé au Fondateur et à la permission du club `devblog.gerer`.

### 🚀 Tout publier

Dans l'éditeur (devblog enregistré, versions française ET anglaise complètes), carte **🚀 Tout publier** : un
panneau s'ouvre avec les **salons cochés par défaut** (« annonces du club », modifiables), la case **@here** (cochée)
et l'**aperçu exact** des messages Discord. **Confirmer : tout publier** publie dans l'app (s'il était en brouillon)
puis sur les salons, en une seule action ; **Annuler** ne fait rien. Aucun salon coché : l'app seulement. Le bouton
reste grisé tant qu'il y a des modifications non enregistrées. Deux clics ne publient jamais deux fois (« Déjà
publié »).

### 🗓️ Publication programmée

Sur un **brouillon prêt**, carte **Publication programmée** : date et heure (« AAAA-MM-JJ HH:MM », **heure de Paris**,
fuseau du club ; demain 18:00 proposé), salons (par défaut ceux d'« annonces du club ») et @here. Le cron (toutes les
5 minutes, étape `devblog programmé`) le publie **à l'heure, jamais avant** : app, puis salons Discord (envoi dans la
foulée). **Modifier la programmation** ou **Annuler la programmation** jusqu'à l'heure. Un devblog publié à la main
entre-temps perd sa programmation ; devenu incomplet (version vidée), la programmation est annulée et les gestionnaires
sont notifiés. Au plus 90 jours à l'avance. La liste et l'éditeur affichent « 🗓️ Programmé · … ».

### ⚙️ Publication automatique

Page Devblog › **⚙️ Publication automatique** (bouton de l'en-tête, gestionnaires seulement) :

| Réglage | Défaut |
| --- | --- |
| **Mode automatique** (interrupteur) | **désactivé** |
| **Fréquence** | « Après chaque mise à jour » : regroupées, **au plus un devblog par jour**, à l'heure choisie ; ou « Une fois par semaine » (jour + heure) |
| **Heure** (heure de Paris) | 18:00 (jour : vendredi en hebdomadaire) |
| **Validation avant publication** | **désactivée** (publié tout seul) ; activée : brouillon + notification |
| **Salons Discord** | ceux cochés par défaut (« annonces du club ») ; ou une liste choisie |
| **Mentionner @here** | oui (une seule fois, à la fin du message anglais) |

Ce que fait le cron (`esport/serveur/cron.mjs`, étape `devblog automatique`) à l'heure dite :

1. **Source des changements** : l'historique git du dépôt **réellement déployé** sur le serveur (o2switch :
   `~/application-enzo`, mis à jour par `esport/serveur/deployer.sh`), depuis le dernier devblog : `git log
   <dernier>..HEAD`. Au premier passage (activation), le point de départ est le premier déploiement noté
   « code : <ancien> → <nouveau> » dans `~/logs/esport-deploy.log` après le dernier devblog publié, sinon l'état
   actuel (rien d'ancien n'est raconté). Sûreté (`devblog-source.mjs`) : chemins fixes, git lancé **sans shell**
   avec un environnement minimal (aucune variable du serveur), délai et taille bornés, identifiants vérifiés ; seuls
   le sujet, le corps et la date des commits sont lus (jamais l'auteur ni les fichiers).
2. **Filtrage** : les commits sans intérêt pour les membres sont écartés par des règles (`auto-regles.mjs` : tests,
   e2e, Jest, docs, refactor, CI, dépendances, journaux, diagnostic, déploiement, travail en cours, fusions…), puis
   par l'IA (consigne).
3. **Nettoyage** : rien d'interne ne part — identifiants de commit, chemins, noms de fichiers, variables
   d'environnement, adresses, e-mails, options de ligne de commande, lignes de fin (Co-Authored-By…) sont retirés.
4. **Rédaction** : l'IA (connecteur `discuterPour`, tâche **« devblog »**, non confidentielle — des messages de commit,
   aucune donnée de réunion — donc autorisée vers l'API externe, ordre de repli « léger ») écrit le devblog **FR + EN
   dans la DA exacte** : exemples fournis (devblog du 23/10 et premier devblog du 30/10), titre « Nouvelle Mise à
   Jour ! » / « New Update! », intro, sections emoji + titre, puces « **Nom :** description », phrase de fin ; ton
   positif, sans jargon ni nom de fournisseur ou de technologie.
5. **Validation stricte** du JSON : structure, longueurs, un emoji par section, mêmes sections et puces en français et
   en anglais, aucune mention, aucun élément interne (hash, chemin, fichier, variable, adresse), aucun nom de
   technologie ou de fournisseur. Refusé = jamais publié.
6. **Publication** (validation désactivée) : dans l'app, puis sur les salons des réglages (@here selon les réglages) ;
   notification « Devblog publié automatiquement ». Validation activée : brouillon « ✨ Rédigé automatiquement » +
   notification « Nouveau devblog à valider » ; « 🚀 Tout publier » le publie.

Garde-fous :

- **rien à publier** sans changement notable (ou si l'IA répond qu'il n'y a rien pour les membres) : aucun devblog ;
- **IA en échec** ou réponse refusée : **brouillon de secours** (les sujets nettoyés, à réécrire) + notification ;
  jamais de publication d'un texte invalide ;
- **au plus une publication automatique par jour** : le passage du jour est réservé en base (`devblog_auto.jour`
  unique), même si deux cron se chevauchent ;
- **journal** de chaque passage (date, résultat, commits lus / retenus, lien vers le devblog) dans le panneau ;
- **Générer maintenant** : brouillon de test à partir des mises à jour en attente ; ne publie rien, ne consomme pas le
  passage du jour ; publier ce brouillon fait avancer le point de départ (pas de doublon ensuite).

Administration IA : la tâche « Devblog » apparaît parmi celles qui peuvent partir chez le fournisseur d'API.

## API

| Route | Droit | Rôle |
| --- | --- | --- |
| `GET /devblog` | tous (brouillons : gestionnaires) | Liste, `gestion` |
| `POST /devblog` · `PATCH` / `DELETE /devblog/:id` | devblog.gerer | Créer, modifier (`statut` : `publie` / `brouillon`), supprimer |
| `GET /devblog/:id` | tous (brouillon : gestionnaires) | Détail |
| `GET /devblog/nouveautes` · `POST /devblog/:id/vu` | tous | Fenêtre Nouveautés, « J'ai compris » |
| `POST /devblog/ia/traduire` `{ fr }` | devblog.gerer | Version anglaise proposée (limite `devblog_ia`) |
| `GET` / `PUT /devblog/salons` | devblog.gerer | Salons possibles, cochés par défaut, salon du bot, nouveau webhook |
| `GET /devblog/:id/discord?here=0\|1` · `POST` `{ cibles, mentionHere }` | devblog.gerer | Aperçu et état ; publier / corriger (limite `devblog_discord`) |
| `POST /devblog/:id/tout-publier` `{ cibles, mentionHere }` | devblog.gerer | « 🚀 Tout publier » : app + salons (limite `devblog_discord`) |
| `PUT` / `DELETE /devblog/:id/programmation` `{ le, cibles, mentionHere }` | devblog.gerer | Programmer (`le` : « AAAA-MM-JJ HH:MM », heure de Paris), annuler |
| `GET` / `PUT /devblog/auto` (`?attente=1`) | devblog.gerer | Mode automatique : réglages, prochain passage, journal, changements en attente |
| `POST /devblog/auto/generer` | devblog.gerer | « Générer maintenant » : brouillon de test (limite `devblog_ia`) |

`/moi` renvoie `peutGererDevblog`. La fonction `devblog` est annoncée par `/sante`.

## Données, export, RGPD

- Tables `devblog_entrees` (avec `origine`, la programmation et `auto_commit`, migration 0037), `devblog_vus`,
  `devblog_discord`, `devblog_reglages` (dont `auto` : réglages du mode automatique, `auto_etat` : dernière mise à jour
  couverte) et `devblog_auto` (journal du mode automatique) : comprises dans l'export / import de la base
  (`transfert.mjs`).
- Export RGPD d'un compte : les devblogs qu'il a vus (`devblogVus`).
- Suppression d'un compte (par lui-même ou par l'Administration) : ses marques « vu » sont **effacées** ; les devblogs
  qu'il a écrits restent (textes du club), sans auteur (programmations et journal du mode automatique compris).
