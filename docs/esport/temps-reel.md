# Esport : synchronisation en temps réel et « le premier qui enregistre a la main »

Demande du Fondateur : les actions d'une personne arrivent chez les autres **en moins d'une seconde**, et **le
premier qui enregistre a la main** (personne n'écrase le travail d'un autre sans le savoir).

## En bref

| | Avant | Maintenant |
| --- | --- | --- |
| Arrivée d'une modification chez les autres | au prochain rafraîchissement (12 s pour le CM, sinon au rechargement de la page) | **< 1 s** (mesuré en test : quelques millisecondes en local, un seul processus ou deux processus via PostgreSQL) |
| Connexions longues par navigateur | 0 (Esport) | **1 au plus**, partagée par tous les onglets ; 0 quand toutes les pages sont masquées |
| Deux personnes modifient la même fiche | le dernier qui enregistre écrase l'autre | le **second** reçoit « Pas enregistré : X a modifié cet élément il y a N s » (409), rien n'est écrasé |
| Qui modifie quoi | invisible | pastille « Léa est en train de modifier » sur la fiche ouverte |

## Transport : SSE, puis attente longue, puis sondage

Choix : **SSE lu par `fetch`** (une requête GET longue ; la session part dans `Authorization`, jamais dans
l'adresse). **Pas de WebSocket** : il faudrait que le frontal d'o2switch (LiteSpeed/Apache devant Passenger)
laisse passer la mise à niveau `Upgrade: websocket`, ce qui n'est pas garanti sur le mutualisé, et le serveur
devrait gérer lui-même le protocole (aucune dépendance aujourd'hui). SSE passe partout où passe HTTP ; `ws` dans
`TEMPS_REEL` est accepté et vaut `sse`.

Trois étages, l'app descend toute seule :

| Étage | Route | Quand |
| --- | --- | --- |
| flux SSE | `GET /temps-reel/flux?depuis=<id>&appareil=<id>` | par défaut (`TEMPS_REEL=sse`) ; bourrage de 2 Kio puis « bonjour », battement toutes les 20 s, fermé au bout de 5 min (l'app rouvre avec son curseur) |
| attente longue | `GET /temps-reel/attendre?depuis=<id>&delai=50` | flux retenu par un intermédiaire (pas de « bonjour » en 4 s), pas de lecture en continu (app iPhone), 3 erreurs de suite, ou `TEMPS_REEL=attente` ; un espace toutes les 15 s |
| sondage | `GET /temps-reel/evenements?depuis=<id>` toutes les 15 s | `TEMPS_REEL=sondage`, ou serveur qui répond 429 « utilise le sondage » |

Un étage du dessous est quitté au bout de 5 min pour réessayer celui du dessus (un étage à la fois). Erreurs :
attente exponentielle avec une part au hasard (2 s → 5 min), `Retry-After` respecté : jamais de reconnexion en
boucle. Si le canal ne marche pas du tout, chaque écran garde une relecture lente de secours (60 s ; 12 s face à
un ancien serveur sans temps réel).

**Une connexion par navigateur** (`src/esport/tempsReel/transport.ts`) : élection d'un onglet meneur par Web
Locks (même mécanisme que la synchro du hub, `MeneurOnglets`), seul un onglet **visible** mène ; il relaie messages
et état aux autres onglets par `BroadcastChannel`. Onglet masqué : connexion rendue, un autre onglet visible prend
la suite. Toutes les pages masquées : aucune connexion. Sans Web Locks (app iPhone) : une par app.

**Reprise** : chaque message a un numéro croissant ; l'app le garde (`dernierId`) et le donne à chaque
reconnexion : le serveur rejoue ce qui a été manqué (deux heures de journal, 200 messages au plus ; au-delà, ou
curseur inconnu, `reinitialiser` : les écrans relisent tout).

## Ce qui circule (et ce qui ne circule jamais)

Un message dit seulement : « dans le **sujet** S, l'objet **K** (version V) a changé, par X » — **aucune donnée
métier**. L'app relit ensuite par les routes habituelles, qui appliquent tous les contrôles.

Sujets : `team:<id>` (team, membres, rôles), `team:<id>:<module>` (planning, attendance, availability,
goals_tasks, meeting_summaries, strat_editor, playbook, video_review, scouting, player_notes, resources, tournois,
resultats, activity_log), `cm` (tableaux, cartes, visuels, clips, réglages), `cm:drive`, `cm:reseaux`,
`cm:reunions` (équipe CM ou invité), `sponsors`,
`trombi`, `club` (rôles du club, comptes) et `compte` (ses propres notifications).

**Contrôle d'accès, pour chaque destinataire et chaque message** (`esport/noyau/temps-reel/regles.mjs`) :

1. le **sujet** : le destinataire doit pouvoir lire ce module (appartenance active, module activé, permission de
   lecture — ou sa lecture « personnelle » : RSVP, ses dispos, ses dépôts) ; `cm` : `cm.voir` quelque part ;
   `cm:drive`, `cm:reseaux`, `sponsors`, `trombi` : la route GET de la rubrique est rejouée en son nom ; `compte` :
   lui seul. Sinon : **rien**, même pas « quelque chose a changé ».
2. l'**objet** (clé, version, auteur, pseudo) : seulement si la route GET de l'objet (`/cm/cartes/<id>`,
   `/teams/<t>/strats/<id>`, `/teams/<t>/suivi/<compte>`…) répond 200 **au nom du destinataire** — les règles ne
   sont jamais recopiées. Sinon il reçoit « le sujet a changé » sans rien d'autre, et relit sa liste (filtrée par
   le serveur). Exemple : une note du staff sur Léa n'arrive ni à Léa ni aux autres joueurs, même sous forme
   anonyme.

Les contrôles sont mis en cache (sujet 30 s, objet 15 s) et **oubliés dès qu'un rôle, un membre, un module ou une
affectation CM change**, dans tous les processus. L'objet est re-contrôlé à chaque écriture le concernant (son
écriture a pu changer qui le voit).

Écritures diffusées : toute requête PATCH/PUT/DELETE/POST réussie sur une route décrite, sauf envois par morceaux,
liens signés, aperçus, exports. Écritures hors HTTP (bot Discord, cron) et **notifications créées pour un compte** :
par le bus d'événements (abonné `abonneTempsReel`, juste après le centre de notifications). Les éléments du fil
du centre annoncés pour un compte (`surNouvelleNotification`, droits et préférences appliqués par le centre)
deviennent un message `compte` pour ce compte (écouté seulement tant que le processus a des navigateurs
connectés) : la cloche se met à jour en direct.

## Plusieurs processus (Passenger)

Le journal `temps_reel_flux` (migration 0040) est la mémoire commune. En **PostgreSQL**, chaque écriture fait
`pg_notify('esport_tr_<schéma>', message)` ; chaque processus Node qui a au moins un navigateur connecté tient
**une** connexion `LISTEN` (ouverte à la première connexion, rendue à la dernière, rouverte avec attente
croissante, puis rattrapage par le journal). Le cron (notifications, rappels) passe par la même base. En SQLite
(tests, développement) : bus en mémoire.

## Le premier qui enregistre a la main

Chaque objet modifiable a une **version** (`temps_reel_versions`), générique : toute route `PATCH`, `PUT` ou
`DELETE` de l'objet lui-même (`/cm/cartes/<id>`, `/teams/<t>/taches/<id>`, `/sponsors/prospects/<id>`…) l'augmente.
Les strats gardent en plus leur `revision` (inchangée), les cartes CM leur `version` de post.

- Une fiche ouverte (`useVerrouOptimiste(client, '/cm/cartes/<id>')`) lit la version (`GET
  /temps-reel/version?chemin=`) ; le client l'envoie avec chaque modification de cette route (`X-Version-Lue`) ;
  la réponse donne la nouvelle (`X-Version-Objet`) : ses propres enregistrements successifs ne font jamais de
  conflit.
- Le serveur augmente la version **avant** d'écrire, conditionnellement (`UPDATE … WHERE version = lue`) : de deux
  enregistrements simultanés, un seul passe ; l'autre reçoit **409 `conflit-version`** avec qui et quand. La
  version est rendue si l'écriture échoue ensuite (validation, droits).
- Le nom de l'auteur n'est donné qu'à qui voit l'objet (sinon : 404 habituel).
- Sans `X-Version-Lue` (ancienne app, écran pas encore branché) : l'écriture passe et la version avance quand même
  (les fiches ouvertes ailleurs l'apprennent).
- Interface (`src/esport/tempsReel/ui.tsx`) : dès qu'un autre enregistre, bandeau « Kai a modifié cet élément il y
  a 12 s » ; après un 409, « Pas enregistré : … » ; boutons **Recharger**, **Voir la différence** (si l'écran
  fournit ses champs modifiés), **Copier mes modifications**. Pastille « Léa est en train de modifier »
  (`POST /temps-reel/presence`, renouvelée toutes les 20 s, oubliée au bout de 45 s).

## Écrans branchés

`useTempsReel(client, sujets, relire)` : tableaux, calendrier et file de validation du CM (`useEtatCm` : plus de
relecture toutes les 12 s en direct, 60 s de secours sinon), fiche d'une carte CM (verrou, présence, bandeau),
planning et présences, Drive, Visuels, Sponsors, Réseaux, trombinoscope et badges, tournois, résultats, strats et
playbook (liste), objectifs et tâches, agenda des réunions CM, cloche et compteur du centre de notifications, teams (accueil, page d'une team). Pastille « En direct » /
« Reconnexion… » en bas à droite de l'Esport. Les autres écrans (review, scouting, ressources, suivi)
reçoivent déjà les messages : un appel à `useTempsReel` suffit pour les brancher.

## Sobriété côté serveur

Au plus 2 connexions tenues par compte **et** par adresse, 4 par compte, `TEMPS_REEL_MAX` (30) par processus ;
au-delà, réponse immédiate 429 « sondage » + `Retry-After` (rien n'est gardé ouvert). Au plus 60 appels par
minute et par adresse. Une connexion du **même appareil** remplace l'ancienne. Durée maximale, libération dès que
le navigateur part, balayage des orphelines. Mesures pour le Fondateur : `GET /temps-reel/etat` (connexions par
étage, refus, latence médiane / p95 / max du serveur au navigateur, écoute PostgreSQL).

## Réglages (`~/.appdashboard/esport.env`)

```ini
# sse (défaut) | attente | sondage (repli sûr : aucune connexion tenue)
TEMPS_REEL=sse
# Connexions tenues au plus, par processus Node (défaut 30)
# TEMPS_REEL_MAX=30
```

Le mode est annoncé par `/sante` (`"tempsReel"`) ; l'app ne monte jamais au-dessus. Retour en arrière :
`TEMPS_REEL=sondage` puis redémarrer l'app Node (voir [docs/o2switch.md](../o2switch.md), partie K).

## Hub (relais de synchro)

Le relais a déjà le même principe (`relais/avis.mjs`, docs/synchro-relais.md) : sondage par défaut, attente longue
ou SSE au choix (`SYNCHRO_TEMPS_REEL`), une écoute par navigateur. Pour descendre sous la seconde sur le hub, il
suffit de passer `SYNCHRO_TEMPS_REEL=attente` (mesuré 0,38 s), **après** une semaine sans souci avec le temps réel de
l'Esport (deux connexions longues par navigateur au lieu d'une). Aucun changement de code n'a été fait sur le relais.

« Le premier qui enregistre a la main » côté hub : le relais détecte déjà le conflit **par enregistrement** sans
lire le contenu (chiffré de bout en bout) : chaque envoi porte la révision de base ; si elle a changé, le plus
récent **par sa date** l'emporte et l'autre version est gardée dans l'historique (`conflit`, rien n'est perdu).
Passer à « le premier gagne » est possible sans casser le chiffrement (le serveur compare des révisions, pas des
contenus), mais changerait le comportement hors ligne (une modification faite dans le métro perdrait toujours
contre une plus ancienne déjà envoyée) : c'est une décision à prendre à part, non faite ici.

## Tests

- Serveur, `esport/test/temps-reel.test.mjs` (SQLite et PostgreSQL) : diffusion filtrée (notes du staff, CM,
  autre team), latence < 1 s, retrait d'un membre, notifications, 409 et course de deux enregistrements, version
  rendue sur échec, présence, reprise par curseur et purge, attente longue, sondage, limites et remplacement par
  appareil, modes du serveur, deux processus sur la même base (LISTEN/NOTIFY).
- App, `src/esport/tempsReel/tempsReel.test.tsx` : une connexion pour 4 onglets et relève, rien d'ouvert au
  repos, repli flux → attente → sondage, flux retenu, reprise par curseur et backoff, `X-Version-Lue` /
  `X-Version-Objet` / 409, bandeau de conflit et pastille (FR/EN).
