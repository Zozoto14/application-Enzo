# Tâches (V1)

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
- **États vides** pédagogiques ; **données d'exemple** facultatives (« Découvrir avec un exemple », retirées d'un
  geste dans ⚙︎).
- Interface aux 8 thèmes du hub (clair et sombre), PC 1440 × 900, iPad 1024 × 768 et 820 × 1180, iPhone 390 × 844
  (cibles ≥ 44 px, textes ≥ 15 px, pas de débordement — mesurés par `scripts/e2e-taches.mjs`).

## Droits

| Compte | Tuile | Voit | Modifie | Gère (listes, statuts, partage, suppression du projet) |
| --- | --- | --- | --- | --- |
| Fondateur (compte historique) | oui | tout | tout | oui |
| L'ami choisi | oui, dès que le dépôt scellé pour lui est arrivé | les projets partagés | ceux partagés **en écriture** (tâches, checklist, commentaires, suppression d'une tâche) | non — jamais de suppression de projet |
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
tombale**), qui voyage et qu'une restauration plus récente défait. La fusion est commutative, associative et
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

## Limites connues (V1)

- Un seul ami. Les rappels ne sonnent que si l'application est ouverte (PC, site, app) ; pas de notification iOS
  programmée ; chaque appareil a son propre anti-répétition (deux appareils ouverts → deux notifications).
- Côté ami, la clé de réception est celle de Tsuzuku : un ami sur plusieurs navigateurs reçoit les projets sur celui
  dont la clé a été déposée en dernier (même limite que les sources partagées de Tsuzuku).
- Un appareil du Fondateur d'une version antérieure ignore l'objet `taches` (pas de perte, il ne le voit simplement pas).
- La sous-tâche d'une tâche récurrente n'est pas recopiée dans l'occurrence suivante.
- Le titre « modifiable en place » s'ouvre au double-clic / F2 (le simple clic ouvre le détail).

## Feuille de route

**V2** — liens avec les autres apps (créer une tâche depuis Claude Office, une fiche Prospects, un abonnement à
renouveler ; voir les tâches liées au portefeuille) ; suivi du temps (minuteur, estimations, temps passé par projet) ;
Gantt (dépendances simples, glisser les barres) ; tableau de bord (tâches par statut / personne, en retard, faites cette
semaine) ; pièces jointes chiffrées ; mentions dans les commentaires ; modèles de projets ; notifications iOS
programmées pour les échéances.

**V3** — objectifs (cibles chiffrées liées à des tâches) ; IA (découper une tâche, résumer un projet, proposer des
échéances, ajout rapide en langage libre étendu) ; intégration GitHub (issues / PR liées, statut automatique) ; plus
d'un ami (partage par personne, rôles, invitations) ; automatisations (si statut = Fait alors…) ; vues personnalisées
avancées (tableau à colonnes libres, champs personnalisés).

## Tests

- `src/taches/taches.test.ts` : dates en français, ajout rapide, modèle, récurrences, filtres / tris / Ma journée,
  fusion (champs, pierres tombales, conflits), droits Fondateur / ami / autres, rappels (anti-répétition,
  notification, pastille), synchronisation par un relais en mémoire qui applique les portées (rien en clair, l'ami ne
  lit que son espace et n'écrit pas l'objet du Fondateur, conflit fusionné, retrait, budget de 30 s).
- `src/taches/RacineTaches.test.tsx` : rendu des vues, du détail, de la garde, dans les 8 thèmes et sur téléphone.
- Bout en bout : `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-taches.mjs` (après `npx vite build`),
  captures JPEG dans `docs/captures-taches/`.
