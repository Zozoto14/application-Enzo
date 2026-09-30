# TSUZUKU : moteur (phase P1)

Streaming d'animes et de films, **sans serveur** : le moteur tourne sur
chaque appareil (Electron, iPhone/iPad, navigateur). Cette phase ne contient
que le **moteur pur et ses tests** : ni interface, ni integration au hub.
Il remplace le backend Express de Tsuzuku (`backend/`), dont la logique est
portee module par module.

## Regle de contenu

Le moteur ne fournit **aucune source** : `SOURCES_PAR_DEFAUT` est vide et
gelee. L'utilisateur branche lui-meme les sites qu'il a le droit d'utiliser
(sa mediatheque, un service dont il detient les droits, un site de diffusion
libre). Les plateformes legales annoncees par les catalogues (Jikan, AniList,
TMDB/JustWatch) restent proposees comme simples liens (`streamingLinks`), sans
integration. Aucun site de streaming non autorise n'est nomme dans le code,
les tests ni les fixtures (domaines `*-exemple.fr`).

## Architecture

`src/tsuzuku/moteur/`, TypeScript strict, JavaScript pur (ni `fs`, ni `http`,
ni `crypto` Node, ni `URL`/`fetch` supposes) : meme comportement sous Metro,
Vite et Jest. Point d'entree : `index.ts`.

| Module | Role |
| --- | --- |
| `adresse` | Analyse d'URL maison alignee sur WHATWG (l'`URL` de React Native est incomplet) : IPv4 decimal/octal/hexa, IPv6, `..`, `\`, ports |
| `garde` | Anti-SSRF : http(s) seulement, pas d'identifiants, hote public (ni localhost, ni prive, ni lien local/metadonnees cloud, ni `.local`/`.lan`/`.internal`, ni nom sans point), ports 80/443/8080/8443, DNS optionnel, nature du media (`hls`/`video`/`iframe`) |
| `reseau` | Interface `Reseau` **injectee** + `creerClient` : garde a chaque appel ET a chaque redirection (suivies par le moteur), delai, taille maximale, GET texte/JSON, POST JSON. `reseauDepuisFetch` adapte un `fetch` standard |
| `lecteurPage` | `htmlparser2` + `css-select` : selecteurs CSS sur du HTML tolerant, suggestions de selecteurs, detection de page rendue en JS |
| `appariement` | Scores de titres, VF/VOSTFR, variantes de recherche (« Saison 2 » retire), seuil de fiabilite |
| `sources` | Definitions de sources par selecteurs CSS (`search`, `episodes`, `player`, `movies.search/player`), langue `vf`/`vostfr`/`indifferent`, gestion de liste, import des anciens `sources.json` |
| `resolution` | Titre -> episodes -> lecteurs (iframe ou fichier direct mp4/m3u8/webm) ; films ; page collee a la main ; diagnostic |
| `catalogue` | Animes : Jikan (file serialisee, cache, 429) puis AniList en repli (disjoncteur 60 s). Films : TMDB (cle optionnelle, v3 ou Bearer) avec repli Jikan |
| `liensManuels` | Motif `{n}` (padding, decalage), extraction depuis une page de serie, corrections par episode, lien de film, mapping par titre |
| `bibliotheque` | Statuts, « vu ailleurs », historique borne (200), deja vu, import/export JSON, migration des anciens `backend/data/libraries/{userId}.json`, `DepotBibliotheque` sur l'interface `Stockage` |
| `outils`, `erreurs` | Horloge injectable, normalisation de texte, `ErreurMoteur` (code + statut HTTP) |

Les fonctions de logique sont pures ; les seules entrees/sorties passent par
`Reseau` et `Stockage`, fournis par la plateforme. Horloge, attente et
generateur d'identifiants sont injectables (tests deterministes).

## Interfaces a fournir

```ts
interface Reseau {           // reseau.ts
  requete(r: RequeteReseau): Promise<ReponseReseau>; // NE SUIT PAS les redirections (renvoie le 3xx + location),
                                                     // respecte delaiMs et tailleMax, n'envoie aucun cookie
  resoudre?(hote: string): Promise<string[]>;        // facultatif : DNS (Electron), pour refuser un nom qui resout en prive
}
interface Stockage {         // bibliotheque.ts : cle -> texte
  lire(cle: string): Promise<string | null>;
  ecrire(cle: string, valeur: string): Promise<void>;
  supprimer(cle: string): Promise<void>;
}
```

Assemblage type :

```ts
const client = creerClient(reseauDepuisFetch(fetch));            // ou un Reseau sur mesure
const catalogue = creerCatalogue({ client, cleTmdb: () => reglages.cleTmdb });
const depot = new DepotBibliotheque(stockage);
const fiches = await catalogue.animes.rechercher('Frieren');     // { source: 'jikan' | 'anilist', data }
const { episodes } = await trouverEpisodes({ client }, sources, { titres: [fiche.title, fiche.titleOriginal!] });
const lecteurs = await trouverLecteurs({ client }, sources, episodes[0].url);
```

## Brancher une source

Une source est un objet de selecteurs CSS (meme format que l'ancien
`sources.json`, qui se recharge tel quel via `importerSources`) :

```ts
const { liste } = ajouterSource([], {
  name: 'Ma mediatheque', baseUrl: 'https://mediatheque-exemple.fr', enabled: true, language: 'vostfr',
  search:   { path: '/recherche?q={query}', pathVf: '/recherche-vf?q={query}', item: 'ul.resultats li', title: 'a.titre', link: 'a.titre' },
  episodes: { item: 'ol.episodes li', number: '.num', title: '.nom', link: 'a' },
  player:   { iframe: 'div.lecteur iframe', options: 'select.lecteurs option' },
  movies:   { search: { path: '/films?q={query}', item: '.film', title: 'h3', year: '.an' }, player: { iframe: 'iframe.film' } },
});
```

`{query}` est remplace par le titre encode. Un selecteur vide desactive la
partie correspondante (pas de `movies.search.path` : source sans films).
`diagnostiquerRecherche` aide a regler les selecteurs (blocs trouves,
pistes, page rendue en JS). `baseUrl` doit etre publique : la garde refuse
le reste des la saisie et a chaque requete.

## Securite

- Toute requete passe par la garde ; les redirections sont suivies par le
  moteur, chaque saut re-verifie. La `Reseau` de la plateforme ne doit pas les
  suivre elle-meme.
- Les lecteurs extraits (iframe, video, `data-*`) visant une adresse non
  publique ou un schema autre que http(s) sont ecartes.
- La cle TMDB n'apparait dans aucun message d'erreur, journal ni cle de cache ;
  avec un jeton Bearer elle passe en en-tete.
- Imports (sauvegarde, anciens fichiers) : rien n'est cru sur parole (champs
  bornes, images http(s) seulement, statuts et notes valides).

## Limites

- Pas de rendu JavaScript : une page dont le contenu est construit cote
  client n'est pas lisible (le moteur le signale). Pas de contournement de
  protections anti-robot, pas de cookies.
- Dans un **navigateur**, `fetch` est soumis au CORS et ne voit pas les
  redirections (`redirect: 'manual'` est opaque) : il faut un relais (ou une
  `Reseau` sur mesure). Electron (processus principal) et React Native n'ont
  pas cette contrainte.
- Sans `resoudre` (DNS), un nom public pointant vers une IP privee n'est pas
  detecte (rebinding) ; a fournir sous Electron.
- Noms de domaine internationaux : fournir la forme `xn--` (pas d'IDNA).
- Un iframe affiche par l'interface peut etre refuse par le site (X-Frame-Options).
- Jikan : ~3 requetes/s, gere par une file interne ; AniList sans cle.
- L'appariement de titres est heuristique : en dessous du seuil, le moteur
  ecarte le candidat (`refuse`) plutot que de lire la mauvaise serie.
- Reste a faire (phases suivantes) : interface, enregistrement dans le hub,
  adaptateurs `Reseau`/`Stockage` par plateforme, synchronisation.

## Dependances ajoutees

| Paquet | Pourquoi |
| --- | --- |
| `htmlparser2` | Analyse HTML tolerante, 100 % JS |
| `domhandler`, `domutils` | Arbre DOM et utilitaires (texte, attributs) de htmlparser2 |
| `css-select` | Selecteurs CSS sur cet arbre (equivalent de cheerio sans sa couche jQuery) |

Toutes sont en JavaScript pur (aucun module natif), sans `fs`/`http`.
Compatibles Metro, Vite et Jest (verifie).

## Tests

`npx jest src/tsuzuku` : fixtures HTML neutres faites main, reponses
Jikan/AniList/TMDB simulees (`outilsTest.ts`, faux `Reseau`), aucun reseau
reel. Couvre l'anti-SSRF (IP decimales/octales/hexa/IPv6, ports, DNS,
redirections), les motifs `{n}`, la migration des anciennes bibliotheques, le
« vu ailleurs », VF/VOSTFR, les replis Jikan/AniList/TMDB.
