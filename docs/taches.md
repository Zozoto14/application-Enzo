# Tâches (V1 + V2)

App du hub « façon ClickUp » pour le Fondateur et **un** ami. Tuile sur la page « Applications » (catégorie
`page: 'publique'`), visible du Fondateur et du seul ami qu'il désigne ; invisible pour tout autre compte.

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

## Droits

| Compte | Tuile | Voit | Modifie | Gère (listes, statuts, partage, suppression du projet) |
| --- | --- | --- | --- | --- |
| Fondateur (compte historique) | oui | tout | tout | oui |
| L'ami choisi | oui, dès que le dépôt scellé pour lui est arrivé | les projets partagés (jamais les projets ni les tâches des autres apps, ni les sessions de Claude Office liées) | ceux partagés **en écriture** (tâches, checklist, commentaires, temps passé et son minuteur, suppression et restauration d'une tâche) ; ses propres réglages de notifications | non — jamais de suppression d'espace, de projet ou de liste, ni d'effacement définitif, ni de lien avec les autres apps |
| Tout autre compte (autre ami, gestionnaire, administrateur, autre Fondateur) | non | rien | rien | non |

`src/taches/acces.ts` : `roleTaches` exige, pour l'ami, l'accès `taches` (donné par le choix du Fondateur, par
`onAutoriser`) **et** la copie reçue avec la clé de partage : un accès donné autrement (ou un ancien ami dont le dépôt
est retiré) n'ouvre rien. L'Administration ne propose pas Tâches en case à cocher (`attribueeParApp` dans le
registre) et un « modèle » d'accès ne retire pas cet accès.

## Stockage et synchronisation (aucun changement du relais)

Données dans la base chiffrée du profil (`contexte.baseProfil`) : `taches.donnees` (Fondateur), `taches.copie`
(ami), `taches.rappels` et `taches.affichage` (appareil, jamais synchronisés).

**Fusion par champ** (`src/taches/fusion.ts`) : chaque entité (espace, projet, liste, tâche, vue, réglages) porte
l'horodatage de chacun de ses champs (`ISO|f` ou `ISO|a`, toujours croissant même si l'horloge recule) ; deux
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
| `p/principal/boite/taches` | le Fondateur (jeton maître) | ses données entières (appareils du Fondateur) | `cleDerivee('synchro')`, comme `admin` |
| `p/<ami>/boite/taches` | le Fondateur (jeton maître ; le relais refuse ce nom à un jeton de profil) | les seuls projets partagés (listes, tâches, pierres tombales), leur mode, les prénoms, la clé de partage `K` | ECIES X25519 + XChaCha20-Poly1305 pour la clé publique de réception de l'ami (`tsuzuku-cle`, la même que Tsuzuku), usage `taches|<id>` |
| champ `taches` du retour `p/<ami>/boite/compte` | l'ami (objet qu'il écrit déjà) | les tâches qu'il a touchées dans les projets en écriture | XChaCha20-Poly1305 par `K` (32 octets aléatoires tirés au choix de l'ami) |

Le Fondateur revérifie tout ce que l'ami renvoie (`appliquerEnvoiAmi`) : seulement des tâches, seulement dans un
projet partagé **en écriture** avant comme après la fusion, dans une liste de ce projet ; jamais un projet, une liste,
un statut, un partage ni une suppression de projet. L'ami croit seulement un dépôt estampillé `maitre` par le relais.
Un changement d'ami (ou « Personne ») efface le dépôt de l'ancien : sa copie se vide, sa tuile disparaît.

**Budget d'écritures KV** : rien n'est déposé sans changement (empreintes) ; jamais deux dépôts du même objet à moins
de 30 s (les changements intermédiaires partent avec le suivant, testé) ; une frappe n'écrit rien (les textes sont
enregistrés à la validation) ; le tour des comptes part ~5 s après la dernière écriture, toutes les 2 min et au retour
au premier plan. Un dépôt coûte 2 écritures (valeur + index). Usage typique : quelques dizaines d'écritures par jour.

**Relais : inchangé** (`relais/worker.mjs` non modifié, pas de redéploiement).

## Limites connues

- Un seul ami. Les rappels ne sonnent que si l'application est ouverte (PC, site, app) ; pas de notification iOS
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

## Feuille de route

**V2 — faite** : suppression des espaces / projets / listes avec corbeille ; liens avec Claude Office, Prospects,
Abonnements et Portefeuille ; suivi du temps (minuteur, saisie, estimations, relevé hebdomadaire, CSV) ; réglages des
notifications de chacun ; journal du jour et débriefing ; paramètres des projets (icône, description, dates,
étiquettes, statuts avec réaffectation, historique) ; ouverture sur le calendrier de la semaine.

**Reste de la V2 (reporté)** — Gantt (dépendances simples, glisser les barres) ; tableau de bord (tâches par statut /
personne, en retard, faites cette semaine) ; pièces jointes chiffrées ; mentions dans les commentaires ; modèles de
projets ; notifications iOS programmées pour les échéances.

**V3** — objectifs (cibles chiffrées liées à des tâches) ; IA (découper une tâche, résumer un projet, proposer des
échéances, ajout rapide en langage libre étendu) ; intégration GitHub (issues / PR liées, statut automatique) ; plus
d'un ami (partage par personne, rôles, invitations) ; automatisations (si statut = Fait alors…) ; vues personnalisées
avancées (tableau à colonnes libres, champs personnalisés).

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
- Bout en bout : `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-taches.mjs` et
  `scripts/e2e-taches-v2.mjs` (après `npx vite build`), captures JPEG dans `docs/captures-taches/` (`v2-…` pour la V2).
