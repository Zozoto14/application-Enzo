# Journal automatique

App du hub « **Journal** » (`src/journal/`, id `journal`, page « Applications »).
Chaque soir, elle écrit **seule** une page de journal pour la journée, à partir de ce
qui s'est passé dans les autres apps. On relit le carnet comme un livre.

Rien n'est envoyé à un service externe et aucune IA n'est nécessaire. Depuis la version 9 du relais (serveur
o2switch), le journal est **partagé entre les appareils du compte** par le coffre serveur chiffré (voir
« Synchronisation » plus bas).

## Ce que fait l'app

- **Écriture du soir** : à l'heure réglée (21 h par défaut, réglable de 12 h à 23 h dans ⚙︎),
  tant que l'app est ouverte et déverrouillée. Si elle était fermée à ce moment-là, la page
  s'écrit **à la première ouverture** (jusqu'à 14 soirs manqués sont rattrapés, du plus ancien au
  plus récent ; le journal ne remonte jamais avant son jour d'activation).
- **Contenu d'une page** : une accroche, une introduction, des sections (une par app qui a de la
  matière), des **chiffres clés**, un **fait marquant** du jour, une clôture. Sources :
  tâches terminées et créées (Tâches), sessions Claude terminées et ce qu'elles ont fait
  (Claude Office), épisodes vus (Tsuzuku), opérations et variation du jour (Portefeuille),
  paiements d'abonnements, relances de prospects, et tout ce qu'une autre app dépose dans la
  boîte du journal (décisions du coach, météo du jour…).
- **Lecture** : onglets **Jour** (‹ › d'un jour à l'autre), **Semaine** et **Mois** (récapitulatif
  généré à partir des pages), **Calendrier** (pages écrites, humeurs, journées épinglées),
  **Recherche** (sans casse ni accents, notes comprises ; les journées épinglées en l'absence de requête).
- **À soi** : une **note** personnelle et une **humeur** (😞 😕 😐 🙂 😄) par page, une **épingle** par
  journée. Une note écrite avant l'écriture du soir crée une page « vide » que l'écriture du soir complète
  sans rien perdre. Réécrire une page garde note, humeur et épingle.
- **Export** : Markdown (fichier proposé à l'enregistrement) ou **PDF** par la fenêtre d'impression
  du système (« Enregistrer au format PDF »), pour le jour, la semaine (avec son récap) ou le mois.

## Confidentialité

- **Privé au profil** : le journal vit dans la base chiffrée du **profil ouvert** (`baseProfil`),
  sous les clés `journal.*`. Il n'est dans aucune donnée d'administration, n'apparaît dans aucun
  écran de l'Administration et n'est pas dans la synchronisation du relais.
- **Chaque source ne rend que ce que le profil peut déjà voir** dans l'app d'origine : un ami n'obtient
  jamais les prospects, les abonnements ni Claude Office du Fondateur, même avec le journal ouvert
  (testé : `src/journal/sources.test.ts`).
- **Pas de secret ni d'adresse** : les secrets sont masqués dans les textes de Claude Office
  (`masquerAffichage`), l'adresse e-mail d'un prospect n'est jamais recopiée.
- **Valeurs masquées** : les montants sont conservés bruts dans la page, mais **tout affichage et
  tout export** passent par `masquerMontants` : en mode discret, « •••• € » à l'écran, dans le
  Markdown et dans le PDF. Les pourcentages restent visibles.
- Limite honnête : le **séquestre** déjà décrit dans `docs/hub/sequestre.md` (un rang supérieur peut
  ouvrir un compte inférieur) s'applique au coffre entier, donc au journal ; le journal n'ajoute aucun
  accès.

## Synchronisation (relais version 9)

Les pages voyagent **une par jour** (`journal:page:<jour>`, la plus récente gagne pour ce jour-là, l'autre version est
gardée dans l'historique du serveur), les réglages tels quels, et la boîte du journal **par union** (deux appareils
n'effacent jamais les événements de l'autre) : `src/sync/relais/entitesApps.ts`. Notes, humeurs et épingles passent donc
d'un appareil à l'autre. Tout est chiffré par la clé du compte : le serveur ne lit rien.

### Avant (ancienne boîte à quota, historique)

La limite du relais était d'environ 1000 écritures par jour. Le journal **ne l'appelait jamais** :

- une page = au plus **3 écritures locales** (le mois, l'index des mois la première fois, un petit
  résumé), jamais une écriture par événement ;
- les pages sont regroupées **par mois** (`journal.mois.AAAA-MM`, toutes les pages du mois dans une
  seule clé) ; si le journal est un jour synchronisé entre appareils, l'unité naturelle sera « un mois =
  une entité chiffrée », soit une trentaine d'écritures par an et par appareil au plus ;
- les sources **lisent** des données locales déjà synchronisées (Claude Office : le journal du PC, et les
  copies chiffrées déjà présentes sur le relais — lues, jamais écrites).

Conséquence (avant la version 9) : chaque appareil écrivait ses propres pages ; les notes et humeurs ne passaient pas
d'un appareil à l'autre.

## Architecture

```
src/hub/journal/contrat.ts   contrat « source d'événements » (le hub ne dépend d'aucune app)
src/hub/journal/boite.ts     boîte du journal : dépôt d'événements par les apps sans source
src/journal/                 l'app
   registre.ts               entrée du hub + info de la tuile
   AppJournal.tsx            écran (bureau, iPad, iPhone ; 8 thèmes ; clair/sombre)
   briques.tsx               onglets, humeur, chiffres, page rédigée
   sources.ts                SOURCES_JOURNAL : la liste des sources branchées
   moteur.ts                 lecture des sources → agrégation → rédaction → enregistrement
   agregation.ts             dédoublonnage, tri, compteurs, fait marquant, rythme
   redaction.ts              modèles de phrases + point d'extension IA
   texte.ts                  tirage reproductible, listes, montants, pourcentages
   echeance.ts               échéance du soir et rattrapage (pur)
   automatique.ts            contrôle à l'ouverture puis toutes les minutes (hook de l'hôte)
   modele.ts                 pages, réglages, stockage par mois, validation à la lecture
   recap.ts                  récapitulatifs hebdomadaire et mensuel
   recherche.ts · export.ts  recherche, Markdown, document imprimable
src/<app>/sourceJournal.ts   la source de chaque app (Tâches, Claude Office, Tsuzuku,
                             Prospects, Abonnements) ; Portefeuille : src/app/sourceJournalPortefeuille.ts
```

### Le contrat

Une source (`SourceJournal`) rend les `EvenementJournal` d'un jour pour le profil ouvert :

```ts
interface SourceJournal {
  id: string; nom: string; famille: FamilleEvenement;
  lire(jour: string, contexte: ContexteHub): EvenementJournal[] | Promise<EvenementJournal[]>;
}
```

Un événement porte au minimum `id` (stable : relu deux fois, il n'est compté qu'une fois), `jour`, `genre` et
`titre` ; il peut ajouter l'heure, un groupe (projet, série), un nombre, un montant, un pourcentage et un
`poids` (0–100) qui décide du fait marquant. Le moteur revalide tout, rattache chaque événement à sa source,
**limite chaque source à 12 s** et note celles qui échouent dans la page (`sourcesEnEchec`) sans bloquer les
autres.

**Ajouter une source** : écrire `src/<app>/sourceJournal.ts` (lecture seule, filtrée par les droits du profil)
et l'ajouter à `SOURCES_JOURNAL`.

Le **Portefeuille** n'est pas dans le contexte du hub : l'hôte (`App.tsx`) donne un
`LecteurPortefeuilleJournal` (`ContexteHub.journalPortefeuille`) construit par
`creerLecteurPortefeuille` à partir des transactions et des points de valorisation déjà chargés.

### La boîte du journal (coach de décisions, météo, futures apps)

Une app sans source dépose ses faits au moment où ils arrivent :

```ts
import { deposerEvenementJournal } from '../hub/journal/boite';

deposerEvenementJournal(contexte.baseProfil, {
  id: 'decision-2026-10-13-1', famille: 'decisions', genre: 'decision',
  jour: '2026-10-13', heure: '17:00', titre: 'Garder le plan d’épargne mensuel', poids: 75,
});
deposerEvenementJournal(contexte.baseProfil, {
  id: 'meteo-2026-10-13', famille: 'meteo', genre: 'meteo', jour: '2026-10-13', titre: 'Ensoleillé, 19 °C',
});
```

Les événements sont rangés par mois (`journal.boite.AAAA-MM`, 600 au plus), dédoublonnés par identifiant. La
météo passe dans l'introduction, les décisions dans une section « Décisions ».

## Rédaction

Un texte naturel en français, écrit **localement par des modèles de phrases** : plusieurs tournures par
rubrique, accordées au nombre (« une tâche » / « 3 tâches »), au rythme de la journée (calme, normal, dense), au
week-end, au signe de la variation du portefeuille. Le choix est **reproductible** (graine = jour +
rubrique) : même journée, même texte ; deux jours voisins ne se ressemblent pas. Les listes longues sont
abrégées (« et 4 autres »), les épisodes regroupés (« ép. 4 à 6 »).

### Point d'extension IA (désactivé par défaut)

`ContexteHub.redacteurJournal` peut recevoir un `RedacteurExterne`. Il n'est appelé **que si** l'utilisateur
active « Rédaction par IA » dans les réglages du journal (interrupteur inactif tant qu'aucun rédacteur n'est
branché). Il ne reçoit que des faits (famille, genre, heure, titre, groupe, nombre, pourcentage) —
**jamais de montant ni d'identifiant** — et ne remplace que l'introduction, les sections et la clôture. Les
chiffres clés et le fait marquant restent calculés localement. Réponse invalide, erreur ou plus de 20 s :
les modèles de phrases écrivent (aucune page n'est perdue).

## Récapitulatifs

`recap.ts` compose le récap d'une semaine (lundi–dimanche) ou d'un mois à partir des pages : compteurs
additionnés, jour le plus chargé, variation du portefeuille composée séance après séance, humeur moyenne,
journées épinglées, faits marquants (3 par semaine, 5 par mois).

## Vérifications

```bash
npx tsc --noEmit
npx jest src/journal            # agrégation, texte, échéance et rattrapage, stockage, sources, récap, export, écran
npm run verifier
npx vite build
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-journal.mjs
```
