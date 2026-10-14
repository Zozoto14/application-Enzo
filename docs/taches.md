# Tâches (V1 + V2 + V3)

App du hub « façon ClickUp » pour le Fondateur et les **membres** qu'il invite (amis et gestionnaires du hub ; un seul
ami en V1/V2). Tuile sur la page « Applications » (catégorie `page: 'publique'`), visible du Fondateur et de ses
membres ; invisible pour tout autre compte.

## Ce que fait la V1

- **Modèle** : Espaces › Projets › Listes › Tâches ; sous-tâches (un niveau : la sous-tâche d'une sous-tâche est
  rattachée à la tâche principale) et checklist ; statuts **par projet** (défaut À faire / En cours / En revue / Fait,
  renommables, réordonnables, colorés, au moins un « terminé » et un ouvert ; les tâches d'un statut retiré passent au
  premier) ; priorité (urgente, haute, normale, basse) ; échéance (jour + heure facultative) ; étiquettes ; description
  en texte simple (liens http/https cliquables) ; personne assignée (le Fondateur ou l'ami) ; commentaires ;
  historique (100 derniers événements, avec l'**ancienne valeur** d'un titre ou d'une description).
- **Ajout rapide** en une ligne : `Appeler Paul demain #prospects !haute @ami` → titre, échéance, étiquette,
  priorité, personne. `!urgente|!haute|!normale|!basse` (ou `!1`…`!4`), `@moi`, `@ami`, `@<prénom>`. Dates en
  français : aujourd'hui, demain, après-demain, lundi (le prochain, jamais aujourd'hui), lundi prochain, semaine
  prochaine, 15/11, 15/11/2027, 15 novembre, 1er mars, dans 3 jours / deux semaines / 1 mois, suivies ou non de
  « à 14h30 ». Une date déjà passée cette année (« 15/01 ») vise l'année suivante. Récurrences écrites : « tous les
  jours », « chaque lundi et jeudi », « toutes les semaines », « chaque mois », « tous les ans ». L'aperçu
  « Compris : … » montre ce qui a été reconnu avant de valider.
- **Récurrences** : quotidienne (tous les N jours), hebdomadaire (jours choisis), mensuelle (jour N, borné au dernier
  jour du mois), annuelle. La suivante se crée **à la complétion**, jamais dans le passé, checklist décochée. Son
  identifiant est dérivé de la tâche et de sa date : si le Fondateur et l'ami terminent la même tâche chacun de son
  côté, la fusion réunit les deux créations (pas de doublon).
- **Recherche** (sans accents ni casse : titre, description, étiquettes, checklist), **filtres** (statut, priorité,
  étiquettes, personne, échéance : en retard / aujourd'hui / 7 jours / sans date, terminées masquées), **tris**
  (manuel, échéance, priorité, titre, récentes, statut), **regroupement** (statut, priorité, échéance, aucun),
  **vues enregistrées** (vue + projet + filtres + tri + regroupement, dans la barre latérale).
- **Vues** : Liste (tableau, titre modifiable en place — double-clic ou F2 —, statut / priorité / échéance /
  personne par menus, groupes repliables ; cartes quand la place manque), Kanban (colonnes par statut, glisser-déposer
  à la souris et au doigt, Maj + ←/→ au clavier, boutons ‹ › sur téléphone ; sans projet choisi, colonnes par nom de
  statut), Calendrier (mois / semaine, glisser une tâche sur un jour, Maj + flèches au clavier, colonne « Sans
  échéance » à glisser dans le calendrier sur grand écran), **Ma journée** (en retard, dû aujourd'hui, choisies pour
  aujourd'hui avec ☀︎, à venir sur 7 jours). Détail en panneau latéral (PC ≥ 1280 px), panneau flottant (iPad),
  plein écran (iPhone).
- **Rappels** : à l'échéance ou 10 / 30 min, 1 / 2 h, 1 / 2 j avant (5 au plus par tâche). Évalués toutes les 30 s
  tant que l'application est ouverte et déverrouillée (`useRappelsTaches`, monté par `App.tsx`) ; notification
  système sur le PC par le pont existant (`window.applibourse.systeme.notifier`, comme Claude Office) ; pastille
  « N RAPPELS » sur la tuile et 🔔 N dans l'app (toutes plateformes) ; « Tout marquer comme lu ». Anti-répétition :
  une clé (tâche, échéance, délai) n'est jamais déclenchée deux fois ; échéance déplacée → nouvelle clé ; un rappel
  manqué de plus de 24 h est abandonné. Chez le Fondateur : ses tâches et celles de personne ; chez l'ami : celles
  qui lui sont assignées.
- **Raccourcis** (hors champ) : N nouvelle tâche, / recherche, 1-4 les vues, Échap ferme la fenêtre, puis le détail,
  puis l'app (écoute en capture : le hub ne se ferme pas sous une fenêtre ouverte).
- **Suppression et corbeille** (`src/taches/corbeille.ts`, `ui/Suppression.tsx`) : espaces, projets, listes et
  tâches se suppriment depuis le menu **⋯** (barre latérale : espace, projet, liste ; en-tête de la vue : projet,
  liste affichée, espace), par **appui long** (doigt ou souris) sur une ligne de la barre latérale, ou par la touche
  **Suppr** (élément de la barre latérale qui a le focus, sinon la tâche ouverte, sinon la liste / le projet affiché).
  La confirmation dit ce qui part (« 2 projets, 42 tâches »), prévient si un projet partagé disparaîtra aussi chez
  l'ami, et propose de **déplacer le contenu d'abord** (projets vers un autre espace ; listes et tâches vers un autre
  projet, statuts équivalents : même identifiant, sinon même nom, sinon le premier ; tâches vers une autre liste).
  Puis un avis **« … supprimé — Annuler »** pendant 10 s (annule aussi le déplacement), et la **Corbeille** (en bas
  de la barre latérale) : 30 jours, « Restaurer » (tout ce qui est parti ensemble revient ; ce qui avait été supprimé
  avant, à part, reste à la corbeille ; une tâche dont la liste est à la corbeille attend que sa liste revienne ; un
  projet dont l'espace a été effacé revient dans un autre espace), « Supprimer définitivement », « Vider la
  corbeille ». Au-delà de 30 jours, l'élément s'efface à l'ouverture de l'app. Supprimer le **dernier espace** le
  remplace par un espace « Personnel » vide (retiré si l'on annule). Un projet garde au moins une liste.
- **États vides** pédagogiques ; **données d'exemple** facultatives (« Découvrir avec un exemple », retirées d'un
  geste dans ⚙︎).
- Interface aux 8 thèmes du hub (clair et sombre), PC 1440 × 900, iPad 1024 × 768 et 820 × 1180, iPhone 390 × 844
  (cibles ≥ 44 px, textes ≥ 15 px, pas de débordement — mesurés par `scripts/e2e-taches.mjs`).

## Ce que fait la V2

### Suivi du temps (`src/taches/temps.ts`, `ui/SuiviTemps.tsx`)

- **Minuteur** dans le détail d'une tâche (▶ / ■) et pastille « ⏱ 00:12:34 · titre » dans l'en-tête (clic : la
  tâche ; ■ : arrêt). **Un seul actif à la fois** par personne : en démarrer un autre arrête le premier et note son
  temps. Le minuteur est un champ daté de la tâche (`chronoF` Fondateur, `chronoA` ami) : il suit d'un appareil à
  l'autre par la synchronisation existante (un rechargement ne l'arrête pas) et **seuls le démarrage et l'arrêt
  écrivent** — l'affichage compte les secondes tout seul. Moins de 30 s : rien n'est noté ; 12 h au plus. Une tâche
  terminée arrête son minuteur.
- **Saisie manuelle** (« 45 min », « 1h30 », « 1,5 h », « 0:45 » ; jour en français ; note), retrait d'une saisie.
- **Estimation contre réel** (champ « Estimation » du détail, barre verte / orange / rouge).
- **Relevé hebdomadaire** (bouton ⏱, ou 👥 › Relevé du temps) : semaine par semaine, par **projet** ou par
  **étiquette**, tout le monde ou « mon temps », totaux par jour ; estimé contre réel des tâches estimées ; **export
  CSV** (séparateur « ; », heures décimales à virgule, pour Excel).
- Entrées de temps fusionnées élément par élément (deux appareils gardent tout) ; l'ami chronomètre les tâches des
  projets partagés en écriture, son temps arrive chez le Fondateur (il ne peut pas toucher au minuteur de celui-ci).

### Notifications (`src/taches/notifications.ts`, `ui/ReglagesV2.tsx`)

Chacun ses réglages (👥 › Notifications) : le Fondateur dans `reglages.notifF`, l'ami dans `reglages.notifA` — qui
part dans le retour qu'il écrit déjà, puis lui revient scellé : synchronisés entre ses appareils **sans aucune écriture
de plus** sur le relais (une notification n'écrit jamais rien sur le relais).

- Activation globale ; **par type** — échéance atteinte, rappel avant échéance, tâche en retard (une fois, quand
  l'échéance passée d'une heure, ou le lendemain sans heure), tâche qui m'est assignée, modification ou commentaire de l'autre sur un projet partagé, tâche
  liée à un agent Claude Office terminée (Fondateur), récap quotidien « Ma journée » — un **canal** : notification du
  système (PC ; navigateur si déjà autorisé), pastille 🔔 dans le hub et dans Tâches, les deux, ou aucune.
- **Rappel par défaut** d'une nouvelle échéance (aucun, à l'heure, 10 min, 1 h, 1 jour avant), modifiable par tâche.
- **Heure du récap** ; **heures calmes** (plage qui peut passer minuit, et le week-end) : rien ne sonne, la pastille
  garde tout ; **regroupement** (une notification résumée si plusieurs partent ensemble) ; **son** (application du PC
  à partir de cette version : `systeme:notifier` reçoit `{ silencieux }`) ; **projets en sourdine** ; **un appareil
  seulement** (identifiant d'appareil dans `taches.appareil`, jamais synchronisé) pour les notifications du système ;
  **« Tester une notification »**.
- Modifications de l'autre : comparées aux traces déjà vues par tâche (`autres` dans `taches.rappels`), pas à
  l'heure — une modification qui arrive par la synchronisation des minutes plus tard est bien signalée. Le premier
  passage d'un appareil ne rattrape rien. Anti-répétition par clé, comme en V1.

### Journal du jour et débriefing (`src/taches/journal.ts`, `ui/Journal.tsx`)

- Chaque projet a un **Journal du jour** (bouton 📓 de l'en-tête, menu ⋯ du projet, « Noter dans le journal du jour »
  dans le détail d'une tâche, et depuis « Ma journée » avec le choix du projet) : des entrées courtes, datées, signées
  (Fondateur ou ami), liées ou non à une tâche, modifiables et retirables par leur auteur. Les tâches **terminées
  aujourd'hui** et le **temps suivi** du jour sont **proposés** (texte modifiable, « ＋ » pour l'ajouter) — jamais
  ajoutés d'office. Une entrée n'est écrite qu'à la validation (pas d'écriture par frappe) ; fusion entrée par entrée
  (`journal` dans les données, élément par élément comme la checklist).
- **Débriefing** par projet, du **jour** ou de la **semaine** : en tête le résumé (tâches terminées, temps suivi,
  nombre d'entrées), puis les entrées **par auteur** et **par tâche** (liens vers les tâches), puis **ce qui reste**
  (en retard, en revue / bloqué / en attente, à venir sur 7 jours, nombre de tâches ouvertes). « Copier (Markdown) »,
  « Copier en texte » (presse-papiers, sinon fichier) et « Exporter .md ».
- Partage : l'ami voit le journal et le débriefing des projets partagés avec lui ; il y écrit seulement dans ceux en
  **écriture** (ses entrées partent dans le retour qu'il écrit déjà ; le Fondateur n'accepte que ses entrées, signées
  de lui, dans un projet partagé en écriture). Rien d'un projet non partagé ne part.
- Invite du soir « Note ce que tu as fait aujourd'hui » : type de notification « journal » (désactivé par défaut,
  heure réglable, pas si une entrée a déjà été notée ce jour).

### Paramètres des projets, espaces et listes

- **Paramètres du projet** (⚙︎ Projet, ou ⋯ › Paramètres du projet) : nom et **icône** (un emoji, aussi dans la
  barre latérale), couleur, **description**, **dates** de début et de fin (facultatives, en français), **étiquettes du
  projet**, **espace** (déplacer), **statuts** (ajouter, renommer, réordonner, marquer « terminé », retirer — en
  choisissant où vont ses tâches), listes, partage avec l'ami (lecture / écriture), suppression. **Historique du
  projet** (dernières modifications, qui et quand ; fusionné par union entre appareils).
- **Espace** : ⋯ › Modifier l'espace (nom, couleur). **Liste** : ⋯ › Renommer la liste.
- Droits : la structure (espace, projet, liste, statuts, partage) est au Fondateur seul ; l'ami ne modifie pas un
  projet (rien de tel n'est accepté de lui).

### Vue d'ouverture

Tâches s'ouvre sur le **calendrier de la semaine** (semaine courante). 👥 › « Vue d'ouverture (cet appareil) » :
calendrier de la semaine (par défaut), Ma journée, toutes les tâches en liste, ou la dernière vue utilisée (alors
seulement, la vue du moment est reprise à l'ouverture suivante).

### Liens avec les autres apps (`src/taches/integrations/`)

Modules isolés : les apps reliées ne sont pas modifiées, sauf deux points d'accroche de Claude Office (un bouton fourni
par Tâches dans son Détail, et l'ouverture de l'Historique demandée par Tâches). Chaque lien s'active dans 👥 › Liens
(Fondateur) : Claude Office activé par défaut (il ne crée rien tout seul), les autres non. Les tâches des apps vivent
dans un projet **auto-géré** à leur nom (espace « Applications », identifiants fixes : deux appareils n'en font qu'un)
et ont un **identifiant dérivé de la source** (`idSource`) : jamais de doublon, une tâche supprimée ne revient pas,
une tâche créée n'est jamais réécrite. **Rien de ces apps n'est exposé à l'ami** : un projet auto-géré ne se partage
pas (refusé, et exclu de la projection même forcé), une tâche venue d'une app est exclue même déplacée dans un projet
partagé, les sessions liées sont retirées de ce qui part chez l'ami, et l'ami ne peut ni poser ni changer une source,
une session ou le minuteur du Fondateur.

- **Claude Office** : dans le Détail d'un agent (ou d'un sous-agent), « ＋ Créer une tâche » (titre proposé : sa
  demande ; projet au choix, « Claude Office » par défaut). Quand l'agent (ou le sous-agent) lié **finit après le
  lien**, la tâche ouverte passe « En revue » (une fois par fin) et la notification « office » part. Le hub lit
  l'activité (journal du PC toutes les 30 s, présences du relais toutes les 3 min) seulement s'il y a des tâches liées
  ouvertes. Sur la tâche, « Liens » liste les sessions ; un clic ouvre l'Historique de Claude Office filtré sur la
  session (demande `claudeOffice.demandeHistorique` dans la base de l'appareil, valable une minute).
- **Prospects** : chaque relance prévue (30 prochains jours, ou en retard ; fiche ni close ni « ne plus contacter »)
  devient « Relancer … » ; relance notée dans Prospects → la tâche se termine ; **cocher la tâche note le contact**
  dans Prospects (une fois, seulement si la fiche attend encore cette relance) et lève la relance.
- **Abonnements** : échéances proches et retards → tâches (« Abonnement de Léa en retard », priorité haute) ;
  paiement noté dans Abonnements → la tâche se termine. Rien n'est écrit dans Abonnements depuis Tâches.
- **Portefeuille** : le rappel de versement mensuel (3 jours avant son jour) et les dividendes attendus à vérifier (du
  calendrier des dividendes) → tâches. Le portefeuille donne ces deux listes à l'hôte (`ResumePortefeuille.rappelsTaches`),
  rien n'y est écrit.
- Passe des liens : à l'ouverture de Tâches, puis toutes les 5 min au plus avec le tour du hub ; n'écrit que s'il y
  a du nouveau (budget KV inchangé : la synchronisation garde ses 30 s minimum entre deux dépôts).

## Ce que fait la V3

### Partage à plusieurs (`src/taches/membres.ts`, `partage.ts`, `ui/Membres.tsx`)

- **Membres** : 👥 › « Gérer les membres et leurs droits » — le Fondateur invite des comptes de rang **ami**,
  **gestionnaire** ou **administrateur** (30 au plus) ; l'invitation lui ouvre l'app (accès `taches`), il reçoit sa **clé de
  membre** (32 octets, scelle ce qu'il renvoie). L'ami des V1/V2 reste membre, avec son code d'auteur historique
  « ami » (ses traces passées restent les siennes) ; les membres V3 signent avec l'identifiant de leur compte.
- **Droits par projet et par personne** (`projet.acces`) : *lecture* (voir), *écriture* (tâches, checklist,
  commentaires, temps et son minuteur, journal, corbeille de ses tâches), *admin du projet* (en plus : nom, icône,
  couleur, description, dates, étiquettes, statuts, listes — créer, renommer). Le partage, la suppression du projet ou
  d'une liste et l'espace restent au Fondateur. Choix dans la fenêtre des membres (par personne) ou dans ⚙︎ Projet ›
  Partage (par projet). L'en-tête du projet dit qui le voit et avec quel droit ; pastilles d'initiales (avatars) dans
  la barre, les lignes, les cartes, le détail.
- **Retrait d'accès** : retirer quelqu'un d'un projet, ou de Tâches (« Retirer… », confirmé), fait **tourner la clé
  de partage** du projet ; son dépôt est réécrit sans le projet (ou effacé) au tour suivant : sa copie se vide, sa
  tuile disparaît. Ses commentaires et son temps passés restent.
- **Assignation à plusieurs** (`assignes` ; `assigne` garde la première personne pour les appareils plus anciens) :
  « Pour qui ? » coche une ou plusieurs personnes du projet ; ajout rapide « @Léa @Hugo » ; filtre « Pour » par
  personne ; rappels et notifications « assignée » à chacun.
- **Mentions** (`src/taches/mentions.ts`) : « @ » dans un commentaire propose les personnes du projet (prénom, sans
  accents ni casse) ; le commentaire garde les mentionnés ; chacun reçoit la notification « On me mentionne » selon
  SES réglages (canal, heures calmes, sourdine…), jamais l'auteur lui-même.

### Accès donné par l'Administration (`membres.ts` › `accorderAcces`)

- **Accès à l'app = membre** : dans Administration › Utilisateurs › fiche d'un profil (ami, gestionnaire ou
  administrateur), le niveau d'accès de l'app « Tâches » (Aucun / Complet) ouvre ou ferme l'app comme pour les autres
  apps du registre. Au tour suivant du hub (30 s), le Fondateur invite le profil (sa clé de membre est créée) ou le
  retire ; inviter depuis Tâches ouvre aussi l'accès. Une seule vérité : la liste des profils qui ont l'app.
- **Sans projet partagé** : la tuile apparaît, l'app montre « Aucun projet partagé avec toi » (et, si le Fondateur
  l'a permis, le bouton « Mes projets personnels »).
- **Fermer l'accès** : retrait de Tâches — clés des projets tournées, dépôt effacé au tour suivant, la tuile
  disparaît ; ce qui est écrit ensuite ne lui parvient plus (vérifié par `e2e-taches-v3`).
- **« Peut créer ses propres projets »** (case par membre, 👥 › Membres) : le membre a alors un espace « Mes projets
  personnels » (barre de navigation : Partagés / Personnels). Ces projets restent dans la **base chiffrée de son
  compte** (`taches.perso`) : ils ne sont ni déposés chez le Fondateur ni partagés ; il en est le seul maître (toutes
  les vues, ses notifications). Comme toute la base d'un profil, ils suivent la sauvegarde/séquestre du hub de ce
  profil s'il en a une. Permission retirée : il les garde en lecture, sans en créer de nouveaux.

### Paramètres › Tâches (page Paramètres du hub, `ui/ParametresTaches.tsx`)

Une section « Tâches » dans les Paramètres du hub reprend les **mêmes fenêtres** que l'app (mêmes composants, même
stockage) : pour tout compte qui a l'app, vue d'ouverture de l'appareil, SES notifications, relevé du temps ; pour
le Fondateur seul, en plus : membres et droits, liens avec les autres apps, IA et GitHub, corbeille. « Ouvrir dans
Tâches › » mène à l'app ; dans l'app, 👥 › « Paramètres › Tâches » y ramène.

### Chronologie — Gantt (`src/taches/gantt.ts`, `ui/Gantt.tsx`)

Onglet « Chronologie » (touche 5) : une barre par tâche de son **début** (champ « Début » du détail) à son
échéance (un jour si une seule date) ; **jalons** en losange ; regroupement par projet, et par liste si le projet en a
plusieurs ; **ligne « aujourd'hui »** ; échelles **jour / semaine / mois**. Glisser une barre la **déplace** (début
et échéance), ses bords l'**étirent** (souris ; au doigt : appui long puis glisser, sinon le doigt fait défiler).
**Dépendances « fin → début »** : glisser la pastille ● d'une barre sur une autre, ou « ＋ Dépend de… » dans le détail
(une boucle est refusée) ; une dépendance **violée** (la suivante commence le jour où la précédente finit, ou avant)
est en rouge, signalée dans la chronologie et le détail, et « **Décaler les suivantes** » les repousse en gardant
leur durée, de proche en proche. Clavier : ← → déplace d'un jour, Maj + ← → change l'échéance, Entrée ouvre. Les
tâches sans date sont listées dessous (« Planifier »). Sur iPhone : colonne des titres étroite, la chronologie défile
seule à l'horizontale, barres et jalons d'au moins 44 × 44 px.

### Tableau de bord (`src/taches/tableauBord.ts`, `ui/TableauBord.tsx`)

Onglet « Tableau de bord » (touche 6), pour le projet choisi ou pour tout : avancement (% des tâches terminées, sans
les sous-tâches), en retard, temps passé contre estimé (V2), tâches terminées par semaine (8 semaines), burndown
(tâches restantes par jour, trait du rythme idéal jusqu'à la fin du projet ou la dernière échéance), répartition par
statut, charge par personne (ouvertes et estimation restante), avancement de chaque projet (vue globale). Graphiques
en vues (aucune dépendance), aux couleurs du thème ; chaque valeur est écrite, et « Voir les valeurs en tableau »
donne tout en texte.

### Objectifs (`src/taches/objectifs.ts`, `ui/Objectifs.tsx`)

« Objectifs » dans la barre latérale (Fondateur) : nom, description, échéance ; progression **calculée** (tâches
liées, et toutes les tâches des projets liés) ou **saisie** (pourcentage, ou cible chiffrée « 4 articles sur 10 ») ;
état *en cours*, *à risque* (le temps écoulé dépasse l'avancement de plus de 25 points), *en retard*, *atteint*.
Fusionnés entre les appareils du Fondateur ; ils ne partent pas chez les membres.

### Aide de l'IA — facultative, désactivée par défaut (`src/taches/ia.ts`, `ui/IA.tsx`, `bureau/electron/tachesReseau.mjs`)

Il n'existait aucun appel à un modèle dans l'app (le podcast est préparé à l'avance) : l'aide passe par l'**API
Claude** (modèle par défaut `claude-sonnet-5-5`, réglable), avec la **clé du Fondateur** saisie dans 👥 › IA et
GitHub, rangée dans la base chiffrée de CET appareil (`taches.secrets`) — jamais dans le dépôt, jamais synchronisée,
jamais envoyée à un membre, jamais affichée en entier (« sk-ant-…a1b2 »).

- **Découper une tâche** en sous-tâches (✨ dans le détail) ; **résumer un projet** (menu ⋯ du projet, ou ✨) ou
  **un débriefing** (📓 › Débriefing › ✨, prénoms remplacés par « Personne 1… ») ; **proposer un planning de la
  semaine** (✨ › Planning : répartit les tâches ouvertes qui me concernent sur les jours restants ; « Appliquer » pose
  leur début).
- **Minimum envoyé, montré avant l'envoi** : titres, statuts, échéances, priorités, estimations ; ni commentaires,
  ni prénoms, ni identifiants (les tâches du planning sont « T1, T2… », retraduites sur l'appareil).
- **Validation obligatoire** : la réponse (lue et bornée : rien d'inattendu ne passe) est un **aperçu modifiable** ;
  rien n'est créé ni modifié sans « Appliquer ».
- **Où part l'appel** : de l'**application du PC**, par le processus principal d'Electron (`taches:ia` :
  `POST https://api.anthropic.com/v1/messages`, sortie structurée en JSON Schema, repli serveur
  `fallbacks: "default"` sur les modèles qui l'acceptent, refus et réponse coupée rendus lisibles). Sur le **site**,
  l'appel réel n'est pas proposé : il faudrait exposer la clé à la page, ou un relais modifié — seul le **mode
  essai** (réponses simulées sur l'appareil, rien n'est envoyé) y fonctionne. Pas de SDK dans le processus
  principal : l'application installée n'embarque aucun module de `node_modules` (« files » de `package.json`) ;
  appel HTTP direct, sans dépendance.

### GitHub — facultatif, désactivé par défaut (`src/taches/github.ts`, `ui/DetailV3.tsx`)

Dans le détail d'une tâche (Fondateur, GitHub activé) : un **lien** vers un dépôt, une branche ou une PR
(« proprio/depot#12 », « proprio/depot@branche », ou l'adresse github.com). L'**état** (PR ouverte, en brouillon,
fusionnée, fermée ; CI réussie, en échec, en cours) est lu par l'API REST de GitHub avec un **jeton personnel en
lecture** (« fine-grained » : Contents, Pull requests, Checks en lecture), rangé comme la clé de l'IA. Lecture à
l'ouverture puis toutes les 5 min au plus tant que l'app est ouverte (↻ pour relire) ; l'état reste sur l'appareil
(`taches.github`) : **le lire n'écrit rien sur le relais**. Option « Marquer Faite quand la PR est fusionnée » : la
tâche passe au statut terminé (une écriture, une fois). L'API GitHub accepte les appels d'un navigateur (CORS) :
le site lit directement, l'application du PC passe par son processus principal (`taches:github`, liste fermée de
chemins en lecture). Un membre voit le lien mais ne le pose ni ne le change ; il ne reçoit jamais le jeton.

## Droits

| Compte | Tuile | Voit | Modifie | Gère |
| --- | --- | --- | --- | --- |
| Fondateur (compte historique) | oui | tout | tout | tout : membres, partage, suppression, objectifs, IA, GitHub, liens |
| Membre (ami, gestionnaire ou administrateur qui a l'app) | oui, dès que le dépôt scellé pour lui est arrivé | les projets où il a un droit (jamais les autres projets, les objectifs, les projets et tâches des autres apps, les sessions de Claude Office, les clés d'autrui) | là où il a *écriture* ou *admin* : tâches, checklist, commentaires (les siens), temps passé et SON minuteur, journal (ses entrées), suppression et restauration d'une tâche ; ses réglages de notifications | *admin du projet* : listes (créer, renommer), statuts et paramètres du projet — jamais le partage, ni la suppression d'un espace, d'un projet ou d'une liste, ni un lien GitHub ou avec une autre app |
| Tout autre compte (sans l'app, autre Fondateur, membre retiré) | non | rien | rien | non |

`src/taches/acces.ts` : `roleTaches` donne le rôle de membre à tout profil (non Fondateur, actif) qui a l'accès
`taches`, ouvert dans l'Administration ou par une invitation depuis Tâches. Sans dépôt reçu, il ne lit rien : l'état
vide s'affiche. Ce qu'il lit et écrit reste borné par les clés : sa clé de membre et celles des projets où il a un
droit, vérifiées chez le Fondateur à chaque retour.

## Stockage et synchronisation (aucun changement du relais)

Données dans la base chiffrée du profil (`contexte.baseProfil`) : `taches.donnees` (Fondateur), `taches.copie`
(membre), `taches.rappels`, `taches.affichage`, `taches.github` (état des PR) et `taches.secrets` (clé de l'API
Claude, jeton GitHub ; Fondateur) — ces quatre-là sur l'appareil seulement, jamais synchronisés, et hors des
sauvegardes (qui ne gardent qu'une liste fermée de paramètres).

**Fusion par champ** (`src/taches/fusion.ts`) : chaque entité (espace, projet, liste, tâche, vue, réglages) porte
l'horodatage de chacun de ses champs (`ISO|f`, `ISO|a` ou, en V3, `ISO|<identifiant du membre>`, toujours croissant
même si l'horloge recule) ; deux
copies se réunissent champ par champ, le plus récent gagne, à égalité l'ordre canonique départage. Checklist et
commentaires : élément par élément ; historique : union bornée. Suppression = champ `supprime` daté (**pierre
tombale**), qui voyage et qu'une restauration plus récente défait. Chaque pierre tombale porte un **lot** (champ
`lot` : l'identifiant de l'élément que l'utilisateur a supprimé) : la corbeille restaure le lot entier, sans ce qui
avait été supprimé avant (les suppressions de la V1, sans lot, se regroupent par instant de suppression).
« Supprimer définitivement » vide le contenu des tâches et pose `efface` : la pierre tombale reste, sinon un autre
appareil ferait revenir l'élément à la fusion. Un projet partagé mis à la corbeille part chez l'ami comme pierre
tombale seule (ni listes ni tâches) : il disparaît chez lui, et revient s'il est restauré. La fusion est commutative, associative et
idempotente (testé). Deux modifications de champs différents (Fondateur et ami) sont gardées toutes les deux ; deux
modifications du même champ : la plus récente gagne, l'autre reste lisible dans l'historique — rien n'est perdu.

Échanges (`src/taches/partage.ts`, branchés dans `bureau/synchroComptes.ts`, tours existants) :

| Objet | Écrit par | Contenu | Chiffrement |
| --- | --- | --- | --- |
| `p/principal/boite/taches` | le Fondateur (jeton maître) | ses données entières (appareils du Fondateur), membres, clés de membre et de projet comprises | `cleDerivee('synchro')`, comme `admin` |
| `p/<membre>/boite/taches` (un par membre) | le Fondateur (jeton maître ; le relais refuse ce nom à un jeton de profil) | les SEULS projets où ce membre a un droit (listes, tâches, journal, pierres tombales ; son droit dans `partage`, les droits des personnes du projet par code), les prénoms de ces personnes, sa clé de membre, la clé de chacun de CES projets | ECIES X25519 + XChaCha20-Poly1305 pour la clé publique de réception du membre (`tsuzuku-cle`, la même que Tsuzuku), usage `taches|<id>` |
| champ `taches` du retour `p/<membre>/boite/compte` | le membre (objet qu'il écrit déjà) | ce qu'il a fait, **un paquet par projet** (tâches touchées, journal, et — admin — le projet et ses listes) | chaque paquet : XChaCha20-Poly1305 par la clé du projet, lié au projet et à l'auteur (données associées `tp|<projet>|<code>`) ; le tout par sa clé de membre |

Le Fondateur revérifie tout ce qu'un membre renvoie (`appliquerEnvoiMembre`) : chaque paquet doit s'ouvrir avec la
clé ACTUELLE du projet (ou la précédente, juste après une rotation, pour qui a encore un droit), le membre doit avoir
*écriture* (ou *admin* pour le projet et ses listes) avant comme après la fusion, dans une liste de ce projet ;
seulement ses commentaires, son temps et ses entrées de journal ; jamais un partage, une suppression de projet ou de
liste, une source d'une autre app, une session liée, le minuteur d'un autre ni un lien GitHub. Un membre croit
seulement un dépôt estampillé `maitre` par le relais. L'ami des V1/V2 sur un appareil pas encore à jour peut encore
renvoyer au format à plat (et lui seul).

**Retrait et rotation des clés.** Le relais isole déjà chaque espace (un membre ne lit que le sien) et rien de neuf
n'est scellé pour un membre retiré : son dépôt est réécrit sans le projet, ou effacé. En plus, la clé du projet
tourne : la nouvelle ne part que chez ceux qui restent ; ce que l'ancien membre scellerait encore avec l'ancienne est
refusé — elle n'ouvre ni n'authentifie plus rien de nouveau.

**Budget d'écritures KV** : rien n'est déposé sans changement (empreintes) ; jamais deux dépôts du même objet à moins
de 30 s (les changements intermédiaires partent avec le suivant, testé) ; une frappe n'écrit rien (les textes sont
enregistrés à la validation) ; le tour des comptes part ~5 s après la dernière écriture, toutes les 2 min et au retour
au premier plan. Un dépôt coûte 2 écritures (valeur + index). Usage typique : quelques dizaines d'écritures par jour.
V3 : un membre ne reçoit un nouveau dépôt que si SA projection a changé (une modification d'un projet privé n'écrit
rien chez les membres) ; la clé de chaque projet partagé est créée une fois. Mesuré (`v3.test.ts`, relais en
mémoire) : premier envoi à 3 membres = 3 dépôts ; puis une modification de Léa dans un projet vu par les 3 = 1
retour + 4 dépôts (principal et les 3 membres) = 5 objets, soit 10 écritures KV ; un tour sans changement : 0.
Mesuré de bout en bout (`e2e-taches-v3`) : MESURE_E2E.

**Relais : inchangé** (`relais/worker.mjs` non modifié en V1, V2 et V3 : pas de redéploiement).

## Limites connues

- Les rappels ne sonnent que si l'application est ouverte (PC, site, app) ; pas de notification iOS
  programmée ; chaque appareil a son propre anti-répétition (deux appareils ouverts → deux notifications).
- Côté ami, la clé de réception est celle de Tsuzuku : un ami sur plusieurs navigateurs reçoit les projets sur celui
  dont la clé a été déposée en dernier (même limite que les sources partagées de Tsuzuku).
- Un appareil du Fondateur d'une version antérieure ignore l'objet `taches` (pas de perte, il ne le voit simplement pas).
- La sous-tâche d'une tâche récurrente n'est pas recopiée dans l'occurrence suivante.
- Le titre « modifiable en place » s'ouvre au double-clic / F2 (le simple clic ouvre le détail).
- Un appareil d'une version antérieure à la corbeille lit les pierres tombales mais ignore le lot : s'il republie
  avant d'être mis à jour, une restauration peut ne rendre que l'élément choisi (son contenu reste dans la corbeille).
- L'ami n'a pas de corbeille pour ce que le Fondateur supprime : il ne voit que ses tâches supprimées dans les projets
  en écriture (qu'il peut restaurer).
- V2 : les notifications ne partent que si l'application est ouverte (comme les rappels) ; « son » coupé demande la
  nouvelle version de l'application du PC (une ancienne ignore l'option : la notification sonne). Les réglages de
  l'ami passent par le Fondateur : un changement fait sur un appareil de l'ami arrive sur ses autres appareils après
  un tour du Fondateur (quelques minutes). Claude Office : « En revue » seulement si l'activité est lue (PC allumé, ou
  présences récentes sur le relais) pendant que la session est encore au bureau ; une tâche liée ne retrouve pas une
  fin survenue avant le lien. Prospects : relances au-delà de 30 jours non créées d'avance. Portefeuille : versement
  et dividendes lus seulement quand le hub est affiché (résumé du portefeuille). Un projet auto-géré supprimé revient
  si son lien reste activé (désactivez le lien d'abord).

- V3 : les objectifs sont au Fondateur (pas partagés). Un membre admin ne supprime pas de liste. Les mentions et
  les assignations proposent les personnes du projet telles que le Fondateur les a publiées (un membre ajouté arrive
  chez les autres au tour suivant). Un appareil d'une version antérieure à la V3 ignore les horodatages des membres
  V3 (mettez tous les appareils à jour). L'IA réelle passe par l'application du PC (le site : mode essai seulement).
  GitHub : 5 min au plus entre deux lectures, et seulement quand l'app est ouverte ; un jeton refusé (droits,
  expiration) est signalé à la relecture. Une dépendance se viole « au jour près » (pas d'heures dans la
  chronologie).

## Feuille de route

**V2 — faite** : suppression des espaces / projets / listes avec corbeille ; liens avec Claude Office, Prospects,
Abonnements et Portefeuille ; suivi du temps (minuteur, saisie, estimations, relevé hebdomadaire, CSV) ; réglages des
notifications de chacun ; journal du jour et débriefing ; paramètres des projets (icône, description, dates,
étiquettes, statuts avec réaffectation, historique) ; ouverture sur le calendrier de la semaine.

**V3 — faite** : partage à plusieurs (membres amis et gestionnaires, droits lecture / écriture / admin par projet et
par personne, invitations, retrait avec rotation de la clé du projet, avatars, assignation à plusieurs, mentions
notifiées) ; chronologie (Gantt : glisser, étirer, dépendances fin → début, décalage, jalons, clavier, iPhone) ;
tableau de bord ; objectifs ; aide de l'IA (facultative) ; lien GitHub (facultatif).

**Reporté** :
- **Pièces jointes chiffrées** (reportées depuis la V2) : pas proprement faisables sans changer le relais. Un membre
  n'écrit que ses objets propres (`compte`, `coffre`, `portefeuille`, `tsuzuku-cle`) : ses fichiers devraient voyager
  dans son retour `compte` (réécrit à chaque envoi), et ceux du Fondateur être recopiés dans l'espace de CHAQUE membre
  du projet (une écriture par fichier et par membre, et des dépôts lourds à chaque modification). Il faut un objet de
  pièces jointes par projet, lisible des seuls membres du projet, côté relais : à faire avec une évolution du relais
  (et son redéploiement).
- Ajout rapide en langage libre par l'IA ; automatisations (si statut = Fait alors…) ; vues personnalisées avancées
  (tableau à colonnes libres, champs personnalisés) ; modèles de projets ; notifications iOS programmées ; issues
  GitHub (seulement dépôt, branche, PR) ; objectifs partagés avec les membres ; IA sur le site (demanderait un relais
  qui garde la clé).

## Tests

- `src/taches/taches.test.ts` : dates en français, ajout rapide, modèle, récurrences, filtres / tris / Ma journée,
  fusion (champs, pierres tombales, conflits), droits Fondateur / ami / autres, rappels (anti-répétition,
  notification, pastille), synchronisation par un relais en mémoire qui applique les portées (rien en clair, l'ami ne
  lit que son espace et n'écrit pas l'objet du Fondateur, conflit fusionné, retrait, budget de 30 s).
- `src/taches/corbeille.test.ts` : bilan (« 2 projets, 4 tâches »), cascade par lot, annuler, déplacer (espace,
  projet avec statuts équivalents, liste), dernier espace, restauration (lots, V1, obstacles), effacement et 30 jours,
  droits (Fondateur / ami), pierres tombales vues par un autre appareil et par l'ami (disparition, retour), ami qui
  tente de faire passer une suppression de projet.
- `src/taches/RacineTaches.test.tsx` : rendu des vues, du détail, de la garde, dans les 8 thèmes et sur téléphone ;
  suppression d'un espace (menu ⋯, bilan, Annuler, déplacer, corbeille) et d'un projet (⋯ de la vue, restaurer,
  supprimer définitivement).
- `src/taches/v2.test.ts` : temps (durées en français, minuteur unique, 30 s / 12 h, fusion entre appareils, saisies,
  relevé par projet / étiquette, CSV, ami), notifications (lecture des réglages, type / canal, global, anti-répétition,
  sourdine, regroupement, un appareil, heures calmes, retard, assignée / modifiée par l'autre malgré le délai de
  synchronisation, récap, réglages de l'ami synchronisés, tour du hub avec son coupé et test), liens (identifiants
  stables, projet auto aux identifiants fixes, sans doublon ni retour, fermeture, rien chez l'ami, Prospects avec la
  passe complète et les droits, Abonnements, Portefeuille, Claude Office : création, « En revue » une fois par fin,
  sous-agent, demande d'Historique, ami qui forge une source).
- `src/taches/integrations/officeUi.test.tsx` : « ＋ Créer une tâche » dans le Détail d'un agent de Claude Office ;
  absent pour l'ami ou lien désactivé ; fins lues dans l'activité.
- `src/taches/v3.test.ts` : membres (invitations, droits par projet, projection de chacun, document sans clé
  d'autrui), retours (écriture acceptée, lecture refusée même forgée, admin limité, auteurs vérifiés, format à plat
  refusé à un membre V3), révocation (clé tournée, ancienne clé refusée, rejeu sur un autre projet refusé), ami des
  V1/V2 (code « ami », format à plat), trois membres par le relais en mémoire (chiffré, chacun ses projets, dépôts
  comptés, membre retiré : dépôt effacé, copie vide, nouvelle clé chez les autres), mentions (lecture, suggestions,
  notification selon les réglages), assignation à plusieurs, chronologie (barres, échelle, déplacer, étirer,
  violation, décaler, boucle), tableau de bord, objectifs, IA (client simulé : minimum envoyé, rien avant
  « Appliquer », réponses bornées, anonymisation), GitHub (liens saisis, état, cache 5 min, « Faite » une fois, lien
  refusé à un membre).
- `src/taches/RacineV3.test.tsx` : chronologie, tableau de bord et objectifs dans les 8 thèmes (bureau, téléphone),
  mouvement réduit, violation et « Décaler », clavier, membres (inviter, droits, retirer), assignation et mention, IA
  et GitHub en mode essai, membre admin et membre en lecture.
- `bureau/electron/tachesReseau.test.mjs` (`node --test`) : requête à l'API Claude (clé en en-tête, sortie
  structurée, repli), erreurs lisibles, demandes invalides refusées sans envoi ; GitHub : liste fermée de chemins.
- Bout en bout : `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-taches.mjs`, `scripts/e2e-taches-v2.mjs`
  et `scripts/e2e-taches-v3.mjs` (après `npx vite build`), captures JPEG dans `docs/captures-taches/` (`v2-…`,
  `v3-…`).
