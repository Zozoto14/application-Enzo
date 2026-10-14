# TSUZUKU : moteur (phase P1)

Streaming d'animes et de films, **sans serveur** : le moteur tourne sur
chaque appareil (Electron, iPhone/iPad, navigateur). La phase P1 est le
**moteur pur et ses tests** (`moteur/`) ; la phase P2 en fait une **app du hub**
(`app/`, `plateforme/`, voir la fin de ce fichier). Il remplace le backend
Express de Tsuzuku (`backend/`), dont la logique est portee module par module.

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
| `lecteurPage` | `htmlparser2` + `css-select` : selecteurs CSS sur du HTML tolerant, suggestions de selecteurs, detection de page rendue en JS (point de montage vide, un seul script suffit) |
| `extraction` | Extraction GENERIQUE quand les selecteurs ne trouvent rien : chemins JSON, listes JSON reperees seules, HTML dans du JSON (AJAX), JSON-LD, cartes `<article>`, liens titres, `og:title`/`h1` d'une page `{slug}`, episodes « Episode N / EP N / E01 / S2E03 / 第N話 / numero en fin d'adresse » (blocs masques, `<option>`, `data-*`), pagination, saisons, `<base href>`, `<meta refresh>` |
| `appariement` | Scores de titres, VF/VOSTFR, variantes de recherche (« Saison 2 » retire), seuil de fiabilite, cle de serie hors langue (`cleSerie`) |
| `langues` | Langue (VF / VOSTFR) d'un titre, d'une adresse, d'un bloc de page (onglets, `data-lang`, sections, `<optgroup>`) ou d'un objet JSON, avec son indice |
| `sources` | Definitions de sources par selecteurs CSS (`search`, `episodes`, `player`, `movies.search/player`), langue `vf`/`vostfr`/`indifferent`, gestion de liste, import des anciens `sources.json` |
| `resolution` | Titre -> episodes -> lecteurs (iframe ou fichier direct mp4/m3u8/webm) ; films ; page collee a la main ; diagnostic |
| `parallele` | Parallelisme borne et annulation : variantes du titre validees dans l'ordre (`courseOrdonnee`), sources en parallele avec priorite et delai de grace (`courseAvecPriorite`), client annulable |
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

`{query}` (alias `{q}`, `{search}`) est remplace par le titre encode ;
`{slug}` (« frieren-beyond-journeys-end ») fait du chemin l'adresse DIRECTE de
l'oeuvre (variantes `-2`, `-saison-2`, `-season-2`, `-vostfr`, `-vf` essayees,
404 = pas de resultat). Un selecteur vide desactive la partie correspondante
(pas de `movies.search.path` : source sans films).

Champs facultatifs de `search` (et `movies.search`) : `type` (`html` defaut,
ou `json` : `item`/`title`/`link`/`image`/`year` sont des chemins JSON comme
`data.resultats`, `title.rendered`), `method` (`GET`/`POST`), `body` (corps
encode du POST, memes variables), `linkFormat` (`/anime/{value}` quand l'API
donne un slug ou un id), `htmlPath` (fragment HTML dans un JSON). De
`episodes` : `type`, `linkFormat`, `next` (lien « page suivante »).

Si les selecteurs ne trouvent rien, `extraction.ts` prend le relais (voir le
tableau) ; le choix final passe TOUJOURS par l'appariement et son seuil.
`chercherSurDetail` rend ce que chaque requete a vu (statut HTTP, type,
taille, duree, redirection, page JavaScript, anti-robot, JSON, mode
d'extraction, candidats) ; `chercherOeuvre` s'arrete des la premiere erreur
valable pour toutes les variantes (anti-robot, cookies exiges, garde).
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
  client n'est pas lisible (le moteur le signale : « page construite en
  JavaScript ») ; il faut alors decrire l'API JSON du site (`type: json`).
  Pas de contournement de protections anti-robot (« Just a moment », captcha,
  403/503 de pare-feu, 429) : elles sont reconnues (`detecterBlocage`, code
  `anti-robot`) et affichees comme telles, jamais comme « aucun resultat ».
  Pas de cookies : un site qui redirige en boucle en posant des cookies est
  signale (code `cookies`).
- Dans un **navigateur**, `fetch` est soumis au CORS et ne voit pas les
  redirections (`redirect: 'manual'` est opaque) : il faut un relais (le site
  utilise la route `/tsuzuku/requete` du relais, Fondateur seulement). Electron (processus principal) et React Native n'ont
  pas cette contrainte.
- Sans `resoudre` (DNS), un nom public pointant vers une IP privee n'est pas
  detecte (rebinding) ; a fournir sous Electron.
- Noms de domaine internationaux : fournir la forme `xn--` (pas d'IDNA).
- Un iframe affiche par l'interface peut etre refuse par le site (X-Frame-Options).
- Jikan : ~3 requetes/s, gere par une file interne ; AniList sans cle.
- L'appariement de titres est heuristique : en dessous du seuil, le moteur
  ecarte le candidat (`refuse`) plutot que de lire la mauvaise serie.
- Reste a faire : voir « Phase 2 » ci-dessous (P3 a P6).

## Dependances ajoutees

| Paquet | Pourquoi |
| --- | --- |
| `htmlparser2` | Analyse HTML tolerante, 100 % JS |
| `@babel/plugin-transform-export-namespace-from` (dev) | Deja dans le lockfile (transitive) ; declaree et activee dans `babel.config.js` car Metro choisit le build ES de htmlparser2 (`export * as`) que le preset RN ne transforme pas |
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

`moteur/sitesSimules.test.ts` joue le moteur contre un VRAI serveur HTTP local
qui simule les comportements des sites (page JavaScript + API JSON, POST
AJAX, cartes d'articles, anti-robot, miroir + `<base href>`, ISO-8859-1, slug,
episodes pagines, onglets de saisons) ; `scripts/e2e-tsuzuku-sources-reel.mjs`
fait de meme dans le navigateur avec le vrai module du PC (decodage,
decompression, POST). Captures : `docs/captures-tsuzuku-sources-reel/`.

Temps de reponse : `moteur/parallele.test.ts` (ordre de validation, bornes, annulation, priorite,
delai de grace, resultat provisoire), `moteur/resolutionParallele.test.ts` (meme resultat que le
sequentiel, une seule requete vers un site qui bloque), `app/cache.test.ts` (bornes, persistance,
invalidation), `app/performance.test.ts` (seconde ouverture sans requete, perime servi puis
rafraichi, prechargement), `app/affichageProgressif.test.tsx` ; E2E `scripts/e2e-tsuzuku-perf.mjs`
(PC et site, seuils) et temps verifies dans `e2e-tsuzuku-sources-reel`, `-site-relais`, `-langues`.

## Phase 2 : Tsuzuku, app du hub

Meme mot de passe, memes profils, memes permissions que le hub ; aucun serveur.

### Ou est quoi

| Chemin | Role |
| --- | --- |
| `registre.ts` | Entree `id: 'tsuzuku'` du registre du hub (nom, icone, teinte `anime`, information en direct) |
| `app/Racine.tsx` | Ecran racine : « ← Hub » + Echap, selecteur Animes / Films, onglets Decouvrir · Catalogue · Ma bibliotheque (+ Sources avec le nombre de sources actives, rangs habilites) ; sur telephone, ces sections passent dans une barre basse (`BarreOnglets`) ; pied de page (`PiedTsuzuku.tsx`) |
| `app/Accueil`, `Catalogue`, `FicheAnime`, `FicheFilm`, `Lecteur`, `Bibliotheque`, `Import` | Ecrans React Native (390 px, accessibilite) |
| `app/Sources.tsx` | Page « Sources » (une seule implementation, deux entrees : onglet de l'app et Parametres › Administration › Tsuzuku · Sources) : liste (type, etat, dernier test, partage), « + Ajouter une source », aide « ? », qui recoit quoi, import/export JSON, lien vers les cles d'API |
| `app/AssistantSource.tsx` | Assistant en 4 etapes : adresse → prompt pour une IA → reponse (JSON) validee / « Reparer avec l'IA » → test pas a pas et enregistrement (nom, activee, partage) |
| `app/EtatSources.tsx` | Etats vides guides (accueil, catalogue, recherche, fiches) et « Ajouter/modifier les sources » (habilites seulement) |
| `app/AdminTsuzuku.tsx` | Rendus dans Parametres : Administration › Tsuzuku (sources, cles d'API) et Tsuzuku › Sources partagees |
| `app/gestion.ts` | Droits par rang, partage, sources recues, reglages techniques (donnees pures) |
| `plateforme/partage.ts` | Publication chiffree des sources partagees dans l'espace relais de chaque beneficiaire |
| `moteur/assistant.ts` | Assistant d'ajout : analyse de page, prompt pour une IA, validation du JSON |
| `app/LienAnime`, `LienFilm` | Liens manuels : episode + suivants (motif `{n}`) ; film : lien direct |
| `app/LecteurMedia.web.tsx` / `LecteurMedia.tsx` | Site et PC : iframe `sandbox`, `<video>`, HLS (hls.js charge a la demande). iPhone : « Ouvrir dans Safari » en attendant la WebView (P4) |
| `app/services.ts`, `resoudre.ts` | Assemblage du moteur par profil ; lien manuel puis sources -> lecteurs |
| `app/cache.ts` | Cache du profil (memoire + base chiffree, borne) : catalogue, episodes d'une fiche, lecteurs ; voir « Temps de reponse » |
| `app/reglages.ts`, `ParametresTsuzuku.tsx` | Reglages de confort (Parametres > Tsuzuku, tous) : langue par defaut (VF, VOSTFR, au choix a chaque fois), episode suivant auto, masquer les deja vus |
| `app/langues.ts`, `SelecteurLangue.tsx` | Langue retenue par serie (ou pour la seance) ; selecteur « VF \| VOSTFR » de la fiche et du lecteur (voir « VF ou VOSTFR ») |
| `app/resume.ts` | Information en direct de la tuile : « Reprendre <titre> · Ep. N » ou « N a voir » |
| `plateforme/reseau*.ts` | Adaptateurs `Reseau` (voir ci-dessous) |
| `plateforme/stockage.ts` | `Stockage` = base chiffree du profil courant |
| `../../bureau/electron/tsuzuku.mjs` | Reseau du processus principal d'Electron (garde anti-SSRF, DNS, sous-cadres) |

### Adaptateurs `Reseau`

| Plateforme | Adaptateur | Ce qu'il fait |
| --- | --- | --- |
| PC (Electron) | `reseauElectron` -> IPC `tsuzuku:requete` | Le processus principal refait la garde (http(s), ports 80/443/8080/8443, hote public, DNS verifie A LA CONNEXION via `lookup`), ne suit AUCUNE redirection (le moteur re-verifie chaque saut), n'envoie et ne garde AUCUN cookie (presence d'un Set-Cookie seulement signalee : `x-tsuzuku-cookie`), borne delai (30 s) et taille (16 Mo, decompresse compris), ne transmet que quelques en-tetes (dont Referer, Origin, X-Requested-With), decompresse (gzip/deflate/br) et DECODE le corps selon son jeu de caracteres (en-tete, `<meta charset>`, repli UTF-8 : ISO-8859-1/windows-1252 gardent leurs accents) |
| Site (navigateur) | `reseauSite` (`reseauRelais.ts`) | Jikan, AniList, TMDB en direct (CORS permis). Toute autre adresse passe par la route `POST /tsuzuku/requete` du relais (`relais/tsuzuku.mjs`), pour le SEUL compte Fondateur relie au relais (jeton maitre de la liaison, aucun nouveau secret ; transport `applibourse.tsuzukuRelais` pose par `bureau/web.ts`). Le relais refait la garde (voir « Site web : lecture par le relais »), rend les 3xx que le moteur suit et re-verifie. Sinon : refus clair (`MESSAGE_SITE` : relier le compte Fondateur au relais, ou app PC/iPhone). Catalogue, bibliotheque et liens manuels directs restent disponibles |
| iPhone/iPad | `reseauNatif` (`fetch` natif) | Le `fetch` de React Native suit lui-meme les redirections : l'adresse FINALE est re-verifiee apres coup et la reponse jetee si elle est privee (un saut intermediaire n'est pas empechable) |

Lecteurs (iframe) sur PC : la fenetre declare le site (`tsuzuku:lecteur`) ; le
processus principal n'accepte un sous-cadre que pour un hote declare et public
(`onBeforeRequest` + `will-frame-navigate`). L'iframe est en `sandbox` (pas de
navigation du parent, pas de fenetre).

### Site web : lecture par le relais (`POST /tsuzuku/requete`)

Le navigateur ne peut pas lire une page d'un autre site (CORS). Pour le compte Fondateur dont le site
est relie au relais avec le code du PC (jeton MAITRE), le moteur passe par le relais Cloudflare :

- `choisirReseau` (site) : `lectureSources` et `viaRelais` sont relus a chaque fois (la liaison peut
  arriver apres l'ouverture) ; `creerServices` ne les garde vrais que pour le rang **Fondateur**.
  Ami, Gestionnaire, Administrateur (jeton de profil) : message du site, aucun appel a la route ;
  le relais leur repond de toute facon 403.
- Fiche « Sur vos sources » : « Site web : lecture via le relais » ; diagnostic copie :
  « Plateforme : site web (navigateur), via le relais ».
- Erreurs du relais traduites (`erreurRelais`) : 404 → « mettez a jour le relais (GitHub › Actions ›
  « Deployer le relais », ou `npm run relais:deployer`) » ; 401 → relier de nouveau ; 403 → reserve au
  Fondateur relie (ou origine du site absente d'`ORIGINES_SITE`) ; 429 → trop de requetes, patienter ;
  injoignable → verifier la connexion / le deploiement.

Ce que la route refuse (tests : `relais/tsuzuku.test.mjs`) : tout jeton qui n'est pas le jeton maitre
(403) ; autre origine de navigateur que `ORIGINES_SITE` (CORS et 403) ; autre schema que http(s),
identifiants dans l'adresse, ports hors 80/443/8080/8443 ; toute IP ecrite en dur (privee, boucle
locale, lien local, metadonnees cloud, IPv4 mappee, notations decimale/octale/hexa) ; `localhost`,
`.local`, `.internal`, `.lan`, `.test`, `.arpa`, nom sans point, le relais lui-meme ; un nom qui RESOUT
(DNS sur HTTPS) vers une adresse non publique ; un corps de requete > 96 Kio (corps sortant > 64 Kio) ;
plus de 60 requetes par minute (compteur memoire du Worker, rien dans KV, 429 + Retry-After).
Elle ne suit aucune redirection, n'envoie que Accept, Accept-Language, Content-Type, Referer,
User-Agent et X-Requested-With (`XMLHttpRequest`), ne rend aucun Set-Cookie (signale par
`x-tsuzuku-cookie`), coupe a 15 s (504) et tronque la reponse a 2 Mo (`tronque: true`). Le Worker decode
le texte (en-tete, `<meta charset>`, ISO-8859-1 → windows-1252) ; un binaire revient en `bodyBase64`.
Journal : hote, statut, duree (ni adresse complete, ni corps). Reponses `Cache-Control: no-store`.

Limites honnetes : un Worker ne choisit pas l'IP de connexion, la verification DNS precede l'appel
(« DNS rebinding » possible entre les deux ; le reseau de Cloudflare n'atteint ni le reseau local de
l'utilisateur ni ses propres adresses internes) ; pas de rendu JavaScript (une SPA sans API JSON reste
illisible) ; les protections anti-robot visent souvent les adresses de Cloudflare elles-memes : un site
lisible depuis le PC peut repondre « Just a moment… » au relais (affiche comme tel, jamais contourne).
Offre gratuite des Workers : ~10 ms de calcul par requete (l'attente reseau ne compte pas) ; une tres
grosse page (proche de 2 Mo) peut depasser ce budget et revenir en erreur « injoignable ».
Deploiement sans PC : `docs/relais-deploiement-github.md`. E2E : `scripts/e2e-tsuzuku-site-relais.mjs`.

### Temps de reponse (`moteur/parallele.ts`, `app/cache.ts`)

Mesure : `scripts/e2e-tsuzuku-perf.mjs` (PC par le vrai pont Electron, site par le vrai relais),
contre un internet local neutre a latences realistes (200 a 800 ms par requete, une source
prioritaire lente a 3,5-4,5 s qui n'a pas le titre, 80 ms d'aller-retour navigateur → relais).
Tableau avant/apres : `docs/tsuzuku-performance.md`.

- **Variantes du titre en parallele** (`courseOrdonnee`) : la premiere requete part seule
  600 ms (un site rapide ou qui bloque ne recoit rien de plus), puis 3 au plus en vol ; les
  resultats sont VALIDES DANS L'ORDRE : titre retenu, requetes du diagnostic et arret (correspondance
  sure, anti-robot) sont exactement ceux du parcours sequentiel. Les requetes devenues inutiles
  sont annulees (`clientAnnulable` : plus rien ne part, la reponse en vol est ignoree).
- **Sources en parallele, priorite gardee** (`courseAvecPriorite`) : la source prioritaire part
  seule 1 s ; si elle n'a pas fini, les suivantes partent (3 au plus). La premiere DANS L'ORDRE qui
  trouve l'emporte ; une moins prioritaire qui a trouve n'attend une plus prioritaire encore en cours
  que 1,2 s, puis l'emporte (la lente est « interrompue » dans le diagnostic). Reglages :
  `ctx.parallele` (`PARALLELE` ; `{ variantes: 1, sources: 1 }` = l'ancien parcours).
- **Cache du profil** (`creerCache`) : en memoire, garde d'une ouverture de l'app a l'autre, et
  dans la base CHIFFREE du profil (`tsuzuku.cache` : IndexedDB sur le site, fichier sur le PC ;
  jamais en clair dans le navigateur, jamais synchronise), borne a 200 entrees / ~0,6 Mo,
  ecriture groupee. Catalogue (Jikan, AniList, TMDB) : frais 30 min, puis « perime mais servi »
  et rafraichi en arriere-plan jusqu'a 7 jours, requetes identiques simultanees groupees.
  Episodes d'une fiche : frais 30 min, perime servi jusqu'a 24 h (rafraichi derriere ; l'ecran se
  relit si quelque chose a change ; un echec du rafraichissement garde l'ancien resultat ; un
  episode absent d'une liste du cache relance une recherche fraiche). Lecteurs d'un episode : 20 min.
- **Prechargement** : pendant la lecture, la page du meme episode dans l'autre langue (bascule
  VF/VOSTFR immediate) puis celle de l'episode suivant (une page chacune, jamais une page de serie).
- **PC** : connexions gardees ouvertes par origine (`AGENTS` keep-alive de
  `bureau/electron/tsuzuku.mjs`) : plus de poignee de main TLS a chaque page d'un meme site.
- **Affichage** : la fiche s'affiche sans attendre les sources (« Recherche sur vos sources… 4 s ») ;
  cartes des rangees en petite affiche (`vignette` : AniList `large`, Jikan `image_url`, TMDB
  `w342`), les 8 premieres tout de suite, les autres au premier defilement de la rangee.
- **Relais** : inchange (une requete par appel, DNS deja garde 60 s, pre-vol CORS garde 10 min).

### Stockage et isolation

Les donnees sont des parametres de la base chiffree du profil ouvert, sous le
prefixe `tsuzuku.` (`tsuzuku.bibliotheque`, `tsuzuku.reglages`, `tsuzuku.mode`,
`tsuzuku.sources`, `tsuzuku.cache`). Une base par profil : la bibliotheque, les liens manuels et
la cle TMDB ne sont jamais partages entre profils. Les services (cache du
catalogue compris) sont recrees par profil.

### Sources et permissions (par rang)

- **Seuls les Fondateurs** ajoutent, modifient, suppriment, testent et partagent une source, et
  reglent les cles d'API (TMDB) et les options du moteur (delai, taille) : `RANGS_GESTION_SOURCES`
  dans `app/gestion.ts`, reverifie par les services (403), pas seulement par l'ecran. C'est l'option
  la plus protectrice : une source decide du contenu que d'autres comptes verront, comme les
  « apps globales », que les regles de rang reservent deja aux Fondateurs. Administrateurs,
  Gestionnaires et Amis n'utilisent que les sources qui leur sont partagees.
- Les sources se gerent dans l'onglet **Sources** de l'app (PC/tablette : en-tete ; telephone : barre
  basse) ou, a l'identique, dans **Parametres › Administration › Tsuzuku · Sources**. Les cles d'API
  restent dans Parametres › Administration › Tsuzuku · Cles d'API (lien depuis la page Sources). Le
  confort (VF/VOSTFR, episode suivant, deja vus) et les **sources partagees avec vous** sont dans
  Parametres › Tsuzuku. Les autres rangs n'ont ni onglet ni page : les ecrans leur disent de demander
  a l'administrateur quand aucune source n'est disponible.
- Cles d'API : dans la base chiffree du Fondateur (`tsuzuku.avance`), jamais publiees ni
  synchronisees en clair, jamais reaffichees en entier (`masquerCle`), jamais dans une
  publication de sources.
- Regle de contenu : aucune source preconfiguree, aucun site de streaming non autorise nomme
  (code, tests, doc : fixtures neutres faites main).

### Partage des sources (synchro par compte)

- Pour chaque source : « moi seul » (defaut), « tous les utilisateurs de Tsuzuku » (comptes actifs
  autorises a l'app) ou une selection (`tsuzuku.partages`, base du Fondateur).
- Deux objets par espace relais `/p/<id>/boite/` (voir `plateforme/partage.ts`) :
  `tsuzuku-cle` (cle PUBLIQUE X25519 de reception, deposee par le compte ; la privee reste dans sa
  base) et `tsuzuku-sources` (ses sources, scellees ECIES X25519 + XChaCha20-Poly1305 pour sa cle,
  usage lie a son identifiant ; ecrit par le jeton maitre SEUL : le relais refuse PUT/DELETE d'un
  jeton de profil). Aucun autre compte ni cle d'API dans la charge.
- Le compte historique publie a chaque tour (`synchroniserComptesAdmin`) ; le beneficiaire range sa
  copie en lecture seule (`tsuzuku.sources.partagees`) et l'active/desactive pour lui seul
  (`tsuzuku.sources.choix`). Retrait : liste vide publiee (ou objet efface), la copie se vide.
- Compatibilite : un appareil ancien ignore ces objets ; un relais ancien les accepte (seule la
  lecture seule cote ami demande le relais a jour). Un Fondateur autre que le compte historique
  gere des sources pour lui seul (le partage est publie par le compte historique).

### Assistant d'ajout par lien

Sources › « + Ajouter une source » › « Avec l'assistant (recommande) » (ou « Saisir ou coller le
JSON », qui commence a l'etape 3), en 4 etapes avec indicateur :

1. **Adresse** : `verifierAdresseSite` (http(s), hote public, ports usuels : anti-SSRF avant toute
   requete) et choix animes / films / les deux.
2. **Prompt** : la page est lue par le client reseau protege (2 Mo max) ; `analyserStructure` en tire
   un resume et `genererPrompt` compose le texte a copier (TOUT le format `FORMAT_SOURCE`, un exemple
   complet `EXEMPLE_SOURCE` sur un site fictif, l'extrait HTML, des regles : selecteurs robustes,
   verifier sur 2 exemples, ne renvoyer que du JSON). Boutons « Copier le prompt », « Ouvrir ChatGPT /
   Claude » (liens externes simples). Sur le site web (CORS) : coller le HTML, ou
   `genererPromptSansExtrait` (l'IA analyse elle-meme le site).
3. **Reponse** : `validerSourceJson` (schema du moteur, selecteurs CSS, `{query}`, adresse publique),
   erreurs une par ligne avec ligne/colonne pour un JSON casse (`positionErreurJson`) ; « Reparer avec
   l'IA » produit `genererPromptReparation` (erreurs + reponse precedente).
4. **Test et enregistrement** : `testerSourcePasAPas` (recherche → episodes → lecteur ; films :
   recherche → lecteur ; une etape en echec saute les suivantes), puis nom, activee, partage (moi
   seul / tous / selection). Le resultat du test est garde (`tsuzuku.sources.tests`) et affiche dans
   la liste.

Import/export : `exporterSources` (definitions seules : ni cle d'API, ni partage, ni agent) et
`importerExportSources` (schema + selecteurs, doublons ignores). Rappel affiche : « N'ajoutez que des
sources dont vous avez le droit d'utiliser le contenu. »

### « Ca ne trouve pas l'anime » : diagnostic

- Fiche › « Sur vos sources » › « Detail du diagnostic » : par source et par
  requete, adresse appelee (secrets masques), methode, statut HTTP, type de
  contenu, taille, duree, redirection, page JavaScript / anti-robot / JSON,
  mode d'extraction, nombre de candidats, meilleurs candidats et leur score,
  raison du rejet, lecture des episodes (pages, saison). « Copier le
  diagnostic » (`app/diagnosticTexte.ts`) : meme contenu en texte, sans cle
  d'API ni secret (parametres `key`, `token`, `sig`, `session`… masques).
- « Tester une source sur ce titre » (Fondateurs) : le test pas a pas de
  l'assistant, avec les titres de la fiche et la preference VF/VOSTFR.
- Raisons distinctes : `bloquee` (anti-robot), `non-configuree` (sources
  activees sans recherche d'animes), sources toutes desactivees.
- Aide « Comment bien configurer une source » (page Sources,
  `app/AideSources.tsx`).
- Le cache de la fiche (frais 30 min, puis servi aussitot et rafraichi en
  arriere-plan jusqu'a 24 h ; resultats trouves seulement) depend de TOUTE la
  definition des sources activees et du titre choisi a la main : une source
  modifiee n'est jamais servie par un ancien resultat. « Rechercher a nouveau »
  et « Reessayer » l'ignorent. Voir « Temps de reponse ».
- Temps : sous le resultat et dans le diagnostic (copie compris), « recherche
  1,2 s · episodes 0,8 s — total 2,0 s », ou « Depuis le cache (garde sur cet
  appareil, il y a 3 min) » ; une source abandonnee parce qu'une autre a trouve
  avant elle est dite « interrompue ».

### VF ou VOSTFR (`moteur/langues.ts`, `app/langues.ts`, `app/SelecteurLangue.tsx`)

Sur les sites, une meme serie existe souvent en deux fiches (« Titre » et « Titre (VF) »), ou une page
de serie propose les episodes par langue (onglets, sections), ou les adresses portent `-vf` / `-vostfr`.

- **Detection** (`langues.ts`), toujours avec un INDICE : titre (« (VF) », « VF », « VFF », « Dub »,
  « Doublé », « Version française », « French » seul ; « VOSTFR », « VOST », « VO », « Sub »,
  « Sous-titré »), adresse (chemin et requete seulement, jamais le nom du site), bloc de la page
  (`data-lang` / `data-langue` / `data-version`, `id`/`class` `vf`, `vostfr`, `tab-vf`… mais pas
  « sub-menu », titre de section juste avant la liste, `<optgroup label>`), objet JSON (`lang`,
  `version`, titre). « VF / VOSTFR » ensemble : inconnue.
- **Regroupement** (`variantesDeLangue`) : fiches de la MEME serie (meme `cleSerie` hors langue et
  episode, ressemblance >= seuil ; ni autre saison, ni film, ni resultat « Episode 12 »), la meilleure
  par langue. Une fiche SANS marqueur a cote d'une fiche marquee d'une seule langue est **presumee**
  de l'autre (« Titre » + « Titre (VF) » : « Titre » = VOSTFR), et dite presumee ; aucune marque : la
  langue declaree par la source (`language`), sinon rien.
- **Page de serie** (`lireEpisodesDetail`) : VF ET VOSTFR sur la meme page → deux listes numerotees
  separement (`parLangue`) ; blocs muets a cote de blocs « VF » aux memes numeros → presumes VOSTFR ;
  page entierement marquee → page dans cette langue ; sinon inconnue.
- **Sans requete inutile** : la premiere recherche suit la langue voulue ; l'autre langue est une page
  de plus, lue a la demande ou en parallele de l'episode (pour griser le bouton si l'episode y manque),
  donc 2 pages de serie au plus, gardees avec le resultat (cache de la fiche). Recherche dediee (`search.pathVf` /
  `pathVostfr`) : lancee seulement si on choisit cette langue. Langue absente de la source de la fiche
  et autres sources activees : « chercher sur vos autres sources », 2 sources au plus, au clic.
- **Ecrans** : selecteur segmente « VF | VOSTFR » dans le lecteur (au-dessus de la video) et au-dessus
  de la liste d'episodes de la fiche ; cibles de 48 px, textes de 15-16 px, groupe radio
  (`aria-checked`), Entree / espace / fleches au clavier, couleurs du theme (clair et sombre).
  Langue indisponible : grisee, « non disponible sur vos sources » et sa raison. Changer de langue
  recharge l'episode au meme numero ; une video directe reprend a la meme position (un iframe d'un
  autre site ne le permet pas : c'est dit). Episode absent dans la langue voulue : lu dans l'autre,
  avec un avis. Source qui ne distingue pas la langue : « Langue inconnue », pas de selecteur.
- **Preference** : Parametres › Tsuzuku › Langue par defaut (VF, VOSTFR, « au choix a chaque fois »).
  Un choix fait sur la fiche ou dans le lecteur est retenu pour la serie (`tsuzuku.langues`, base du
  profil) ; en « au choix a chaque fois », il ne vaut que pour la seance. Il n'existe pas d'entite
  synchronisee pour les reglages de confort de Tsuzuku : la preference reste **locale a l'appareil**
  (aucune ecriture de plus sur le relais).
- **Progression** commune : la bibliotheque ne connait que le numero ; un episode vu en VF est vu.
- **Diagnostic** : langue de chaque candidat (« (1000, VF) », « langue non marquee »), des blocs lus
  (« n° 1 [VF] »), versions trouvees (fiche, indice, presumee, episodes lus) et raison de chaque
  langue indisponible.
- **Limites** : une source qui ne marque la langue nulle part (ni titre, ni adresse, ni bloc) reste
  « Langue inconnue » ; la presomption « fiche muette = l'autre langue » peut se tromper sur un site
  qui ne marque que la VOSTFR et range la VF sans marqueur (elle est alors affichee « presumee ») ;
  pas de rendu JavaScript (onglets construits en JS sans API JSON : illisibles).
- Tests : `moteur/langues.test.ts`, `moteur/languesSeries.test.ts`, `app/langues.test.tsx` ; E2E
  `scripts/e2e-tsuzuku-langues.mjs` (captures `docs/captures-tsuzuku-langues/`).

### Reste a faire

- **P3** : synchro de la bibliotheque et des liens manuels entre appareils d'un meme compte.
- **P4** : WebView native (lecteur integre sur iPhone/iPad).
- **P5/P6** : voir le plan du hub.
- Site : la lecture des sources est ouverte au Fondateur relie au relais (ci-dessous) ; pas aux
  autres rangs (le relais ne connait que le jeton maitre comme Fondateur).
