# Devblog (notes de mise à jour)

Le devblog annonce aux membres ce qui a changé dans l'app, dans la DA du devblog posté à la main par le Fondateur
sur Discord (« 🚀 DEVBLOG — Nouvelle Mise à Jour ! 🛠️ ») : un titre, une phrase d'intro, des sections (emoji + titre
en gras) avec des puces courtes « **Nom :** description », une phrase de fin.

Migration `0036_devblog.sql` · serveur `esport/noyau/devblog/` · app `src/esport/ui/devblog/`, `src/esport/devblog/`.

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

`/moi` renvoie `peutGererDevblog`. La fonction `devblog` est annoncée par `/sante`.

## Données, export, RGPD

- Tables `devblog_entrees`, `devblog_vus`, `devblog_discord`, `devblog_reglages` : comprises dans l'export / import
  de la base (`transfert.mjs`).
- Export RGPD d'un compte : les devblogs qu'il a vus (`devblogVus`).
- Suppression d'un compte (par lui-même ou par l'Administration) : ses marques « vu » sont **effacées** ; les devblogs
  qu'il a écrits restent (textes du club), sans auteur.
