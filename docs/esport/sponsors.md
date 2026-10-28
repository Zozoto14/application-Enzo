# Esport : Sponsors & partenaires

La rubrique **Sponsors** de l'espace CM (entrée **CM** de la navigation de l'Esport, onglet **Sponsors**) suit la
recherche de sponsors et la vie des partenariats :

- **Prospects** : entreprises et marques à démarcher, rangées par étape (Kanban) ;
- **Partenaires** : fiche, contrats (numéraire, dotation en nature), **contreparties** et leur avancement ;
- **Tableau de bord** : pipeline, conversion, revenus, retards, contrats qui se terminent ;
- **Import / export CSV**, **RGPD des contacts**, journal de la rubrique.

Migration : `esport/migrations/0024_sponsors.sql`. Code : `esport/noyau/sponsors/`, `src/esport/sponsors/`,
`src/esport/ui/sponsors/`, textes `src/esport/i18n/sponsors.ts`.

## Qui voit quoi

Les données sont **sensibles** (contacts, montants, contrats). Deux permissions **du club** :

| Permission | Ce qu'elle ouvre |
| --- | --- |
| `sponsors.voir` | lire le pipeline, les fiches, les contrats, le tableau de bord, ouvrir les pièces jointes |
| `sponsors.gerer` | tout écrire : prospects, contacts, échanges, partenaires, contrats, contreparties, étapes, import / export, RGPD, journal |

- Le **Fondateur** a tout.
- Elles se donnent par les **rôles CM** (**Esport › Teams › CM du club › Équipe CM**) et ne valent que par une affectation pour
  **tout le club** : une affectation de team, un rôle de team (Propriétaire compris) ou l'appartenance à une team
  n'ouvrent **jamais** la rubrique.
- Par défaut (migration 0024), le rôle système **Responsable CM** les a toutes les deux ; le **Correspondant CM**
  ne les a pas. Le rôle est **éditable** : décochez-les pour réserver la rubrique au Fondateur, ou créez un rôle
  « Chargé sponsors » (`sponsors.voir` + `sponsors.gerer`, sans rien du CM) ou « Lecteur sponsors » (`sponsors.voir`).
  « Rétablir » remet les permissions par défaut. Anti-escalade : hors Fondateur, on n'accorde pas une permission
  Sponsors qu'on n'a pas.
- Sans `sponsors.voir`, toutes les routes `/sponsors/…` répondent **404** (la rubrique n'existe pas pour lui) ; avec
  `sponsors.voir` seulement, les écritures répondent **403**. Un compte qui n'a **que** les Sponsors voit l'entrée
  **CM** avec le seul onglet Sponsors (aucun tableau CM).
- Seule exception : **la liste des partenaires actifs (nom et niveau)** est lisible par qui prépare des contenus
  (`cm.editer`), pour cocher « mention sponsor » sur une carte post (voir plus bas).

Sur téléphone, rien de nouveau dans la barre du bas : la rubrique est un onglet de l'espace CM (lui-même ouvert depuis
la page Teams quand la barre est pleine).

## Prospects (pipeline)

**CM › Sponsors › Prospects** : une colonne par étape, avec le nombre de prospects et leur valeur estimée.

- Étapes par défaut : **À contacter → Contacté → En discussion → Proposition envoyée → Négociation → Signé / Perdu**.
  **Réglages › Étapes du pipeline** : renommer (vide = nom par défaut traduit), recolorer, réordonner, ajouter,
  archiver (une étape vide). « Signé » (gagnée) et « Perdu » (perdue) restent en dernier.
- Fiche d'un prospect : entreprise ou marque, site (https), secteur, taille (indépendant, TPE, PME, ETI, grande
  entreprise), source, intérêt (inconnu, faible, moyen, fort), priorité, **valeur estimée** (en euros, gardée en
  centimes), teams concernées, responsable (« suivi par », un compte qui voit la rubrique), notes.
- **Contacts** : nom, rôle, e-mail, téléphone, réseaux (pseudo `@nom` ou adresse `https://`), contact principal.
- **Historique des échanges** : appel, e-mail, réunion, note (date, contact, résumé, auteur).
- **Prochaine action** : quoi et quand (heure de Paris). Le jour venu, le responsable — ou à défaut les gestionnaires
  — reçoit une **notification** « Sponsors · action prévue aujourd'hui », reprise dans le **récapitulatif e-mail**
  pour qui l'a activé. Une nouvelle date réarme le rappel. Une action passée apparaît en rouge sur la carte.
- **Pièces jointes** : deck, proposition, contrat, logo, facture… en lien https ou en fichier (PDF, images, vidéos,
  archives ; envoi par morceaux).
- **Déplacer** un prospect : boutons d'étape sur la fiche, ou menu **⋯** de la carte (Monter, Descendre, Étape
  précédente / suivante, Déplacer vers…), utilisable au clavier et au lecteur d'écran. Vers **Perdu**, la **raison**
  est obligatoire ; revenir dans une étape en cours l'efface.
- Vers **Signé**, l'app propose la **conversion en partenaire en un clic** (aussi sur la fiche, avec le niveau) :
  le partenaire reprend nom, site, secteur, teams, notes, responsable ; contacts, échanges et pièces lui sont
  rattachés (ils restent visibles depuis le prospect). Un prospect ne se convertit qu'une fois (409 `deja-converti`).

### E-mail depuis la fiche

Bouton **Écrire** d'un contact : choisissez un **modèle** (prise de contact, relance, envoi de la proposition,
remerciement) en **français ou en anglais** (selon l'interlocuteur, pas la langue de l'app). Le message s'ouvre dans
**votre messagerie** (`mailto:`, rien ne part du serveur) avec le prénom, l'entreprise et le club remplis ; chaque
modèle de prise de contact rappelle qu'on peut répondre « stop ». Après l'ouverture, l'app prépare la ligne
« E-mail envoyé » de l'historique (à enregistrer). La Messagerie de l'Administration (envoi SMTP) n'est pas utilisée
ici : elle sert aux comptes de l'app, pas aux contacts extérieurs.

## Partenaires et sponsors

**CM › Sponsors › Partenaires** (actifs / terminés) puis la fiche :

- **Logo** (une image jointe, bouton « Utiliser comme logo »), **niveau** (sponsor principal, partenaire officiel,
  partenaire, fournisseur officiel, partenaire média), statut, teams concernées, responsable, notes.
- **Contrats** : intitulé, début et fin (AAAA-MM-JJ), **montant en numéraire**, **dotation en nature** (description
  et valeur estimée), renouvellement (à renouveler, tacite reconduction, sans renouvellement), statut (brouillon,
  actif, terminé, résilié), **préavis** : le responsable (ou les gestionnaires) est prévenu ce nombre de jours avant
  la fin (7 jours au moins ; une seule fois, réarmé si la fin ou le préavis change).
- **Contreparties** (obligations) : intitulé, type (posts, logo sur les affiches, mention en stream, maillot,
  événement, autre), **période** (hebdomadaire, mensuelle, trimestrielle, annuelle, ou unique sur la durée),
  **quantité par période**, début et fin (par défaut celles du contrat lié), rappel N jours avant la fin de la période
  si elle n'est pas atteinte, responsable. L'avancement est calculé **par période** : fait, à faire, **en retard**
  (période terminée sans la quantité) ; historique des périodes, archivage.
- **Comptage** :
  - « Saisie à la main » : boutons **+ / −** de la période en cours (ou d'une période passée dans l'historique) ;
  - « **Posts CM publiés** » : chaque carte post de la section CM qui coche **Mention sponsor** et qui est **publiée**
    compte pour la période de sa date de publication (heure de Paris) ; la saisie manuelle s'y ajoute.

### Mention sponsor sur une carte post

Dans la fiche d'une carte post (section CM), bloc des liens : **Mention sponsor** propose les partenaires actifs (nom
seulement). C'est un lien du contenu : le cocher après la validation repasse le post « à valider », comme tout
changement de contenu ; un post publié est verrouillé (cochez avant de publier). Si le partenaire est supprimé, la
carte ne montre plus son nom.

## Tableau de bord

**CM › Sponsors › Tableau de bord** :

- **Pipeline en cours** (valeur estimée des prospects des étapes ouvertes) et pipeline **par étape** ;
- **Taux de conversion** sur 12 mois : signés / (signés + perdus) ;
- **Revenus et dotations par mois** de l'année choisie : chaque contrat actif ou terminé est réparti **au prorata des
  jours** (numéraire + valeur de la dotation) ;
- **Contreparties en retard** et **contreparties de la période** (avec les jours restants) ;
- **Contrats bientôt expirés** (60 jours, ou déjà expirés mais encore « actifs ») ;
- **Prochaines actions** (en retard et 7 jours).

## Import et export CSV

**CM › Sponsors › Import / export** (`sponsors.gerer`) :

- **Import** de prospects : choisir un fichier (site, app PC) ou coller le contenu ; séparateur détecté (virgule,
  point-virgule, tabulation), guillemets doublés, UTF-8. **Aperçu** : colonnes, exemples, **correspondance proposée**
  (« Entreprise », « E-mail », « Téléphone », « Valeur estimée »… en français ou en anglais), modifiable colonne par
  colonne (ou Ignorer). Champs : nom (obligatoire), site, secteur, taille, source, intérêt, priorité, valeur, étape
  (nom ou clé d'une étape ouverte), notes, prochaine action, contact (nom, rôle, e-mail, téléphone, réseaux).
  **Bilan** : prospects créés, **doublons** (même nom, sans casse ni accents, déjà présent ou répété dans le fichier)
  et **lignes écartées** avec leur numéro et le champ illisible. Refus : fichier vide, plus de 1 Mo, plus de
  2 000 lignes ou 40 colonnes, champ de plus de 4 000 caractères, **guillemet non refermé** (400 `csv-invalide`, avec
  la ligne). Le contenu n'est jamais exécuté : tout passe par les mêmes contrôles que la saisie.
- **Export** des prospects (contact principal compris) et des partenaires (contrat en cours, contreparties) en CSV
  UTF-8. **Injection de formules** : toute cellule qui commence — même après des espaces — par `=`, `+`, `-`, `@`, une
  tabulation ou un retour chariot est préfixée d'une apostrophe ; les guillemets sont doublés.

Limites : 30 imports (aperçus compris) et 30 exports par compte et par heure.

## RGPD

- Les **contacts** sont des **données personnelles** de personnes extérieures. **Réglages › RGPD des contacts** :
  saisir l'adresse e-mail de la personne, puis **Exporter ses données** (fichier JSON : ses fiches de contact, les
  prospects et partenaires concernés, les échanges qui la citent) ou **Effacer ses données** (ses fiches de contact et
  ces échanges disparaissent ; adresse comparée sans casse). Supprimer un prospect ou un partenaire efface aussi ses
  contacts, ses échanges et ses fichiers.
- Pour un **compte de l'app** : l'export (Profil › Exporter, ou par le Fondateur) contient les fiches dont il est
  responsable et les échanges qu'il a notés ; la suppression du compte le retire des responsables, et ce qu'il a écrit
  pour le club reste, sans auteur.
- Le **journal** de la rubrique (`sponsors.*`, Réglages › Journal) ne contient que des noms d'entreprises (ni
  adresse, ni téléphone, ni montant) ; ces événements n'ont pas de team et n'apparaissent dans aucun journal de team
  ni dans le journal CM.

## Données (migration 0024)

| Table | Contenu |
| --- | --- |
| `sp_etapes` | étapes du pipeline (clé par défaut, nom, issue ouverte / gagnée / perdue, couleur, position, archivage) |
| `sp_prospects` | prospects (valeur en centimes, teams en JSON, prochaine action, rappel posé, raison et date de perte, signature, partenaire issu) |
| `sp_partenaires` | partenaires (niveau, statut, teams, logo, prospect d'origine) |
| `sp_contrats` | contrats (jours de début et de fin, montant, dotation et sa valeur, renouvellement, préavis, rappel posé) |
| `sp_obligations`, `sp_suivi` | contreparties ; avancement saisi et rappel par période (`2026-10`, `2026-T4`, `2026-S44`, `2026`, `unique`) |
| `sp_contacts`, `sp_echanges` | contacts (données personnelles) et historique des échanges |
| `sp_pieces` | pièces jointes (lien, ou fichier de `cm_fichiers` de portée `sponsors`) |

La migration pose les sept étapes par défaut et ajoute `sponsors.voir` et `sponsors.gerer` au rôle système
Responsable CM. Tout est dans l'**export / import de la base** (les étapes posées par la migration sont remplacées par
celles de l'export).

Fichiers : envoi par morceaux de la section CM, portée **`sponsors`** (`/cm/portees/sponsors/envois…`,
`sponsors.gerer`), gardés dans `cm_fichiers` ; lus par lien signé (`/cm/fichiers/:id`, 2 h) qui ne vaut que pour un
compte qui a **encore** `sponsors.voir` (jamais pour la seule section CM).

## API (préfixe facultatif `/api/esport`)

| Route | Droit |
| --- | --- |
| `GET /sponsors/moi` | session |
| `GET /sponsors/mentionnables` | voir, ou cm.editer (nom et niveau seulement) |
| `GET /sponsors/comptes` ; `GET /sponsors/pipeline?q&responsable&priorite&team` ; `GET /sponsors/tableau-de-bord?annee` | voir |
| `GET\|POST /sponsors/etapes` ; `PATCH /sponsors/etapes/:id` (`nom`, `couleur`, `archive`, `index`) | voir ; gerer |
| `POST /sponsors/prospects` ; `GET\|PATCH\|DELETE /sponsors/prospects/:id` ; `POST …/deplacer` (`{ etapeId, index?, raisonPerte? }`) ; `POST …/convertir` (`{ niveau? }`) | gerer (lecture : voir) |
| `POST /sponsors/contacts` ; `PATCH\|DELETE /sponsors/contacts/:id` | gerer |
| `POST /sponsors/echanges` (`{ prospectId\|partenaireId, genre, resume, date?, contactId?, prochaineAction?, prochaineActionLe? }`) ; `DELETE …/:id` | gerer |
| `POST /sponsors/pieces` (`{ prospectId\|partenaireId\|contratId, genre, url\|envoi, nom?, categorie }`) ; `DELETE …/:id` ; `POST …/:id/lien` | gerer ; lien : voir |
| `GET\|POST /sponsors/partenaires` ; `GET\|PATCH\|DELETE /sponsors/partenaires/:id` ; `POST …/contrats` ; `POST …/obligations` | voir ; gerer |
| `PATCH\|DELETE /sponsors/contrats/:id` ; `PATCH\|DELETE /sponsors/obligations/:id` ; `PUT /sponsors/obligations/:id/suivi` (`{ periode, fait, note? }`) | gerer |
| `POST /sponsors/import/apercu` ; `POST /sponsors/import` (`{ contenu, correspondance, etapeId? }`) | gerer |
| `GET /sponsors/export/(prospects\|partenaires).csv` (`?format=json`) ; `POST /sponsors/rgpd/(export\|effacer)` (`{ email }`) ; `GET /sponsors/journal` | gerer |

Les modifications d'un prospect ou d'un partenaire acceptent `versionAttendue` (409 `version` si la fiche a changé).

## Code et tests

- Serveur : `esport/noyau/sponsors/` — `commun.mjs` (droits), `regles.mjs` (périodes, montants, CSV : règles pures),
  `service.mjs`, `rappels.mjs` (tâche du cron), `bus.mjs` (notifications `sp-*`), `rgpd.mjs`, `routes.mjs`. Lien avec
  le CM : `cm/posts.mjs` (`liens.sponsors`), `cm/tableaux.mjs` (noms, contrôle d'existence), `cm/droits.mjs`
  (permissions des rôles CM, `GET /cm/moi` → `sponsors`), `cm/service.mjs` (fichiers de portée `sponsors`).
- App : `src/esport/sponsors/` (client, règles, phrases), `src/esport/ui/sponsors/` (EspaceSponsors, Pipeline,
  FicheProspect, FichePartenaire, MentionsSponsors, briques communes), textes et modèles d'e-mail
  `src/esport/i18n/sponsors.ts`.
- Tests : `esport/test/sponsors.test.mjs` (SQLite et PostgreSQL : règles, migration, permissions — joueur,
  Propriétaire, correspondant, rédacteur CM, lecteur —, pipeline et conversion, contreparties comptées par les posts
  publiés, rappels, import CSV malformé, export sans formule, fichiers, RGPD, export / import),
  `src/esport/Sponsors.test.tsx`.

## Pour le Fondateur

1. Mettre à jour le serveur Esport (déploiement automatique o2switch, ou `npm run migrer --prefix esport`) : la
   migration `0024_sponsors.sql` s'applique seule. Publier le site et l'app PC.
2. Décider qui voit la rubrique : par défaut le **Responsable CM**. Pour la réserver, **Esport › Teams › CM du club › Équipe CM** :
   décocher « Sponsors : voir / gérer » du Responsable CM, ou créer un rôle dédié et l'affecter **pour tout le club**.
3. Facultatif : renommer les étapes (**CM › Sponsors › Réglages**), importer la liste de prospects existante (CSV).
