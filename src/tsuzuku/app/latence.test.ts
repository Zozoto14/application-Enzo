/**
 * Latence (2e passe) : sources connues pour être lentes, cache du relais
 * (indications envoyées, « frais » pour Réessayer), préchargement d'intention
 * borné (carte, accueil, épisode). Faux réseau, fixtures neutres.
 */
import { stockageMemoire } from '../moteur/bibliotheque';
import { mapperAnimeJikan, mapperMediaAnilist } from '../moteur/catalogue';
import { attenteNulle, fauxReseau, html, json, type Reponse } from '../moteur/outilsTest';
import { importerSources } from '../moteur/sources';
import { CLES } from '../plateforme/stockage';
import { lireReponseRelais, reseauRelais, type DemandeRelais } from '../plateforme/reseauRelais';
import { creerCache } from './cache';
import { creerSuiviLatences, HOTES_MAX, SEUIL_LENTE_MS } from './latences';
import { intentionAnime, intentionEpisode, poigneesIntention, prechargerFichesAccueil } from './precharge';
import { episodesDisponibles, lecteursDeLEpisode } from './resoudre';
import { creerServices } from './services';
import { ecrireReglages, REGLAGES_DEFAUT } from './reglages';

const SITE = 'https://fiches-exemple.fr';
const LENT = 'https://lent-exemple.fr';
const JIKAN = 'https://api.jikan.moe/v4';
const eps = (prefixe: string, n: number) => Array.from({ length: n }, (_, i) => `<li class="ep"><a href="${prefixe}/episode-${i + 1}">Épisode ${i + 1}</a></li>`).join('');
const apres = <T>(ms: number, v: T): (() => Promise<T>) => () => new Promise<T>(ok => (setTimeout(() => ok(v), ms) as unknown as { unref?: () => void }).unref?.());
const S = (id: string, baseUrl: string) => ({ id, name: id, baseUrl, enabled: true, search: { path: '/?s={query}', item: 'li.r', title: 'a', link: 'a' }, episodes: { item: 'li.ep', link: 'a' }, player: { iframe: 'iframe' } });

const animeJikan = {
  mal_id: 1,
  title: 'Nagai Tabi',
  title_english: 'The Long Voyage',
  title_japanese: '長い旅',
  titles: [
    { type: 'Default', title: 'Nagai Tabi' },
    { type: 'English', title: 'The Long Voyage' },
    { type: 'French', title: 'Le Long Voyage' },
  ],
  episodes: 3,
};

function routes(plus: Record<string, Reponse> = {}): Record<string, Reponse> {
  return {
    [`${SITE}/?s=`]: html(`<ul><li class="r"><a href="${SITE}/anime/voyage/">Le Long Voyage</a></li></ul>`),
    [`${SITE}/anime/voyage/`]: html(`<ul>${eps(`${SITE}/anime/voyage`, 3)}</ul>`),
    [`${SITE}/anime/voyage/episode-2`]: html('<iframe src="https://lecteur-exemple.fr/embed/2"></iframe>'),
    [`${JIKAN}/anime/1/full`]: json({ data: animeJikan }),
    ...plus,
  };
}

async function services(r: Record<string, Reponse>, sources: object[] = [S('fiches', SITE)]) {
  const reseau = fauxReseau(r);
  const stockage = stockageMemoire({ [CLES.reglages]: ecrireReglages({ ...REGLAGES_DEFAUT, langue: 'vostfr' }) });
  const cache = creerCache(stockage, { delaiEcritureMs: 0 });
  const s = creerServices({ choix: { plateforme: 'pc', reseau, lectureSources: true }, stockage, estAdmin: true, catalogue: { attendre: attenteNulle }, cache });
  await s.enregistrerSources(importerSources(sources).sources);
  return { s, reseau, stockage, cache };
}
const titres = ['Le Long Voyage'];
const attendre = (ms: number) => new Promise<void>(ok => setTimeout(() => ok(), ms));

describe('temps typique de chaque site (sources connues pour être lentes)', () => {
  it('moyenne glissante par hôte, 2 mesures au moins avant de conclure, gardée sur l’appareil', async () => {
    const cache = creerCache(stockageMemoire(), { delaiEcritureMs: 0 });
    const l = creerSuiviLatences(cache, { differeMs: 5 });
    l.noter('https://lent-exemple.fr/?s=a', 4000);
    expect(l.typique('https://lent-exemple.fr/x')).toBeUndefined();
    expect(l.estLente('https://lent-exemple.fr/')).toBe(false);
    l.noter('https://LENT-exemple.fr/serie', 3600);
    expect(l.typique('https://lent-exemple.fr/')).toBeGreaterThan(3000);
    expect(l.estLente('https://lent-exemple.fr/')).toBe(true);
    l.noter('https://vif-exemple.fr/a', 300);
    l.noter('https://vif-exemple.fr/b', 500);
    expect(l.estLente('https://vif-exemple.fr/')).toBe(false);
    expect(SEUIL_LENTE_MS).toBe(1500);
    // Un site qui s'améliore cesse d'être « lent ».
    for (let i = 0; i < 8; i += 1) l.noter('https://lent-exemple.fr/', 200);
    expect(l.estLente('https://lent-exemple.fr/')).toBe(false);
    // Rangé plus tard (jamais pendant une recherche), puis relu par un nouveau lancement (même cache du profil).
    expect((await cache.lire('latences'))).toBeUndefined();
    await attendre(30);
    const relu = creerSuiviLatences(cache);
    await relu.charger();
    expect(relu.typique('https://vif-exemple.fr/')).toBe(l.typique('https://vif-exemple.fr/'));
    expect(relu.estLente).toBeInstanceOf(Function);
    // Borné.
    for (let i = 0; i < HOTES_MAX + 10; i += 1) l.noter(`https://h${i}-exemple.fr/`, 10);
    expect(l.typique('https://vif-exemple.fr/')).toBeUndefined();
  });

  it('les services chronomètrent chaque page lue ; une page servie par le cache du relais ne compte pas', async () => {
    let hit = false;
    const page = () => ({ ...html('<p>x</p>'), entetes: (hit ? { 'x-tsuzuku-relais-cache': 'HIT' } : {}) as Record<string, string> });
    const { s } = await services({ [`${LENT}/`]: async () => (await apres(40, page())()) });
    await s.client.texte(`${LENT}/a`);
    await s.client.texte(`${LENT}/b`);
    const avant = s.latences.typique(`${LENT}/`);
    expect(avant).toBeGreaterThanOrEqual(30);
    hit = true;
    await s.client.texte(`${LENT}/c`);
    expect(s.latences.typique(`${LENT}/`)).toBe(avant);
  });

  it('source prioritaire connue pour être lente : la suivante part aussitôt (sinon après 1 s), même résultat, même diagnostic', async () => {
    const lent = apres(2600, html('<ul><li class="r"><a href="/autre">Autre chose</a></li></ul>'));
    const essai = async (connue: boolean) => {
      const { s, reseau } = await services(routes({ [`${LENT}/?s=`]: lent }), [S('lent', LENT), S('fiches', SITE)]);
      if (connue) {
        s.latences.noter(`${LENT}/`, 3000);
        s.latences.noter(`${LENT}/`, 3000);
      }
      const debut = Date.now();
      const quand: number[] = [];
      const origine = reseau.requete.bind(reseau);
      reseau.requete = async r => {
        if (r.url.startsWith(SITE)) quand.push(Date.now() - debut);
        return origine(r);
      };
      const d = await episodesDisponibles(s, { id: '1', titres });
      return { premier: quand[0], d };
    };
    const connue = await essai(true);
    const inconnue = await essai(false);
    expect(connue.premier).toBeLessThan(300);
    expect(inconnue.premier).toBeGreaterThanOrEqual(900);
    expect(connue.d.resultat?.source?.id).toBe('fiches');
    expect(connue.d.episodes).toEqual(inconnue.d.episodes);
    expect(connue.d.diagnostic.sources.map(x => [x.sourceId, x.statut])).toEqual(inconnue.d.diagnostic.sources.map(x => [x.sourceId, x.statut]));
  });
});

describe('délai de grâce : abrégé quand la prioritaire, connue lente, ne peut pas finir à temps', () => {
  it('résultat aussitôt, diagnostic « connue pour être lente » ; temps inconnu : attente de 1,2 s comme avant', async () => {
    const essai = async (typique?: number) => {
      const { s } = await services(routes({ [`${LENT}/?s=`]: apres(3000, html('<ul><li class="r"><a href="/autre">Autre chose</a></li></ul>')) }), [S('lent', LENT), S('fiches', SITE)]);
      if (typique) for (let i = 0; i < 2; i += 1) s.latences.noter(`${LENT}/`, typique);
      const debut = Date.now();
      const d = await episodesDisponibles(s, { id: '1', titres });
      return { ms: Date.now() - debut, d };
    };
    const connue = await essai(4000);
    expect(connue.d.resultat?.source?.id).toBe('fiches');
    expect(connue.ms).toBeLessThan(800);
    const lent = connue.d.diagnostic.sources.find(x => x.sourceId === 'lent');
    expect(lent?.statut).toBe('interrompue');
    expect(lent?.raison).toMatch(/connue pour être lente/);
    const inconnue = await essai();
    expect(inconnue.d.resultat?.source?.id).toBe('fiches');
    expect(inconnue.ms).toBeGreaterThanOrEqual(2100);
    expect(inconnue.d.diagnostic.sources.find(x => x.sourceId === 'lent')?.raison).toMatch(/n’avait pas répondu 1,2 s plus tard/);
  });
});

describe('cache du relais : ce que le site demande', () => {
  it('recherche (GET) et pages : indication de cache ; « Réessayer » et rafraîchissement : frais', async () => {
    const { s, reseau } = await services(routes());
    await episodesDisponibles(s, { id: '1', titres });
    const parUrl = (debut: string) => reseau.appels.filter(a => a.url.startsWith(debut)).map(a => a.cache);
    expect(parUrl(`${SITE}/?s=`)[0]).toEqual({ nature: 'recherche' });
    expect(parUrl(`${SITE}/anime/voyage/`)[0]).toEqual({ nature: 'page' });
    reseau.appels.length = 0;
    await episodesDisponibles(s, { id: '1', titres, forcer: true });
    expect(reseau.appels.length).toBeGreaterThan(0);
    expect(reseau.appels.every(a => a.cache?.frais === true)).toBe(true);
    reseau.appels.length = 0;
    await lecteursDeLEpisode(s, `${SITE}/anime/voyage/episode-2`, { forcer: true });
    expect(reseau.appels[0].cache).toEqual({ nature: 'page', frais: true });
  });

  it('un envoi (POST) ne demande jamais de cache ; le transport ne transmet l’indication qu’en GET', async () => {
    const { s, reseau } = await services({ [`${SITE}/ajax`]: html('<p>ok</p>') });
    await s.client.envoyerFormulaire(`${SITE}/ajax`, 'q=1');
    expect(reseau.appels[0].cache).toBeUndefined();
    const envoyees: DemandeRelais[] = [];
    const transport = { disponible: () => true, envoyer: async (d: DemandeRelais) => (envoyees.push(d), { statut: 200, json: { status: 200, texte: 'ok', cache: 'HIT', ageS: 12 } }) };
    const r = reseauRelais(transport);
    const rep = await r.requete({ url: `${SITE}/a`, methode: 'GET', entetes: {}, delaiMs: 1000, tailleMax: 1000, cache: { nature: 'page' } });
    await r.requete({ url: `${SITE}/b`, methode: 'POST', entetes: {}, corps: 'x', delaiMs: 1000, tailleMax: 1000, cache: { nature: 'page' } });
    await r.requete({ url: `${SITE}/c`, methode: 'GET', entetes: {}, delaiMs: 1000, tailleMax: 1000 });
    expect(envoyees.map(d => d.cache)).toEqual([{ nature: 'page' }, undefined, undefined]);
    expect(rep.entetes['x-tsuzuku-relais-cache']).toBe('HIT');
    // Un ancien relais ne renvoie pas `cache` : rien n'est inventé.
    expect(lireReponseRelais({ status: 200, texte: 'x' }).entetes['x-tsuzuku-relais-cache']).toBeUndefined();
  });
});

describe('préchargement d’intention (borné)', () => {
  it('carte Jikan touchée : la recherche sur les sources part tout de suite, la fiche la rejoint (une seule recherche)', async () => {
    let finFiche: () => void = () => undefined;
    const fiche = new Promise<void>(ok => (finFiche = () => ok()));
    const { s, reseau } = await services(routes({ [`${JIKAN}/anime/1/full`]: async () => (await fiche, json({ data: animeJikan })) }));
    const carte = mapperAnimeJikan(animeJikan)!;
    intentionAnime(s, carte);
    await attendre(30);
    // La fiche complète n'est pas encore arrivée : la source est déjà interrogée.
    expect(reseau.urls().some(u => u.startsWith(`${SITE}/?s=`))).toBe(true);
    finFiche();
    const d = await episodesDisponibles(s, { id: '1', titres: ['The Long Voyage', 'Nagai Tabi', 'Le Long Voyage'] });
    expect(d.episodes).toHaveLength(3);
    expect(reseau.urls().filter(u => u.startsWith(`${SITE}/anime/voyage/`) && !u.includes('episode'))).toHaveLength(1);
    // Une seconde intention sur la même carte ne relance rien.
    const n = reseau.appels.length;
    intentionAnime(s, carte);
    await attendre(20);
    expect(reseau.appels.length).toBe(n);
  });

  it('recherche d’avance finie sans rien trouver (site qui bloque) : la fiche ouverte juste après ne la refait pas', async () => {
    const { s, reseau } = await services({ [`${SITE}/?s=`]: { statut: 403, entetes: { 'content-type': 'text/html' }, corps: '<title>Just a moment...</title>' } });
    intentionAnime(s, mapperAnimeJikan(animeJikan)!);
    await attendre(80);
    const n = reseau.urls().filter(u => u.startsWith(`${SITE}/?s=`)).length;
    expect(n).toBe(1);
    const d = await episodesDisponibles(s, { id: '1', titres: ['The Long Voyage'] });
    expect(d.diagnostic.raison).toBe('bloquee');
    expect(reseau.urls().filter(u => u.startsWith(`${SITE}/?s=`))).toHaveLength(1);
    // « Réessayer » relit le site.
    await episodesDisponibles(s, { id: '1', titres: ['The Long Voyage'], forcer: true });
    expect(reseau.urls().filter(u => u.startsWith(`${SITE}/?s=`))).toHaveLength(2);
  });

  it('carte AniList (sans titre français) : la recherche attend la fiche complète ; une seule recherche d’intention à la fois', async () => {
    const { s, reseau } = await services(
      routes({
        [`${SITE}/?s=`]: apres(150, html(`<ul><li class="r"><a href="${SITE}/anime/voyage/">Le Long Voyage</a></li></ul>`)),
        [`${JIKAN}/anime/2/full`]: json({ data: { ...animeJikan, mal_id: 2, title: 'Autre', title_english: 'Other', titles: [] } }),
      }),
    );
    const carte = mapperMediaAnilist({ id: 9, idMal: 1, title: { romaji: 'Nagai Tabi', english: 'The Long Voyage' } })!;
    intentionAnime(s, carte);
    await attendre(60);
    const urls = reseau.urls();
    const iFiche = urls.indexOf(`${JIKAN}/anime/1/full`);
    const iSource = urls.findIndex(u => u.startsWith(`${SITE}/?s=`));
    expect(iFiche).toBeGreaterThanOrEqual(0);
    expect(iSource).toBeGreaterThan(iFiche);
    // Pendant que cette recherche d'intention est en vol, une autre carte touchée n'en lance pas une seconde.
    intentionAnime(s, mapperAnimeJikan({ ...animeJikan, mal_id: 2, title: 'Autre', title_english: 'Other', titles: [] })!);
    await attendre(60);
    expect(reseau.urls().filter(u => u.startsWith(`${SITE}/?s=`) && /Other|Autre/.test(decodeURIComponent(u)))).toHaveLength(0);
    expect(reseau.urls()).toContain(`${JIKAN}/anime/2/full`);
  });

  it('accueil : 4 fiches au plus, l’une après l’autre, après un temps de calme ; arrêtable', async () => {
    const r: Record<string, Reponse> = {};
    for (let i = 1; i <= 8; i += 1) r[`${JIKAN}/anime/${i}/full`] = apres(20, json({ data: { ...animeJikan, mal_id: i } }));
    const { s, reseau } = await services(r);
    const fiches = Array.from({ length: 8 }, (_, i) => ({ id: i + 1 }));
    prechargerFichesAccueil(s, fiches, { calmeMs: 10 });
    await attendre(400);
    expect(reseau.urls().filter(u => u.startsWith(JIKAN))).toEqual([1, 2, 3, 4].map(i => `${JIKAN}/anime/${i}/full`));
    // Arrêté avant le temps de calme : rien ne part.
    const autre = await services(r);
    prechargerFichesAccueil(autre.s, fiches, { calmeMs: 50 })();
    await attendre(120);
    expect(autre.reseau.appels).toHaveLength(0);
    // Jamais de page des sources.
    expect(reseau.urls().some(u => u.startsWith(SITE))).toBe(false);
  });

  it('ligne d’épisode touchée : sa page est lue d’avance, le clic la retrouve sans requête', async () => {
    const { s, reseau } = await services(routes());
    await episodesDisponibles(s, { id: '1', titres });
    intentionEpisode(s, { id: '1', titres, numero: 2 });
    await attendre(30);
    expect(reseau.urls().filter(u => u.endsWith('/episode-2'))).toHaveLength(1);
    const n = reseau.appels.length;
    const l = await lecteursDeLEpisode(s, `${SITE}/anime/voyage/episode-2`);
    expect(l.lecteurs.length).toBeGreaterThan(0);
    expect(reseau.appels.length).toBe(n);
  });

  it('poignées : toucher = tout de suite ; survol = après 250 ms ; quitter la carte annule', () => {
    jest.useFakeTimers();
    try {
      const action = jest.fn();
      const p = poigneesIntention(action);
      p.onHoverIn();
      jest.advanceTimersByTime(200);
      p.onHoverOut();
      jest.advanceTimersByTime(500);
      expect(action).not.toHaveBeenCalled();
      p.onHoverIn();
      jest.advanceTimersByTime(250);
      expect(action).toHaveBeenCalledTimes(1);
      p.onPressIn();
      expect(action).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});

