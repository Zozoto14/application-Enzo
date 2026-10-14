/**
 * Temps de réponse côté app : cache des recherches sur les sources (seconde
 * ouverture sans requête, gardé sur l'appareil, invalidé quand une source
 * change, périmé servi puis rafraîchi), cache des lecteurs et préchargement
 * de l'épisode suivant / de l'autre langue, sources lentes en parallèle
 * (ordre de priorité, délai de grâce), mesures affichées dans le diagnostic.
 * Faux réseau à latence simulée, fixtures neutres.
 */
import { stockageMemoire } from '../moteur/bibliotheque';
import { attenteNulle, fauxReseau, html, type Reponse } from '../moteur/outilsTest';
import { importerSources } from '../moteur/sources';
import { CLES } from '../plateforme/stockage';
import { creerCache } from './cache';
import { lignesDiagnostic, texteMesure } from './diagnosticTexte';
import { episodesDisponibles, EPISODES_FRAIS_MS, lireAnime, prechargerEpisode } from './resoudre';
import { creerServices } from './services';
import { ecrireReglages, REGLAGES_DEFAUT } from './reglages';

const SITE = 'https://fiches-exemple.fr';
const LENT = 'https://lent-exemple.fr';
const eps = (prefixe: string, n: number) => Array.from({ length: n }, (_, i) => `<li class="ep"><a href="${prefixe}/episode-${i + 1}">Épisode ${i + 1}</a></li>`).join('');
const lecteur = (id: string) => html(`<iframe src="https://lecteur-exemple.fr/embed/${id}"></iframe>`);
const lent = (ms: number, r: ReturnType<typeof html>): Reponse => () => new Promise(ok => (setTimeout(() => ok(r), ms) as unknown as { unref?: () => void }).unref?.());

function routes(nb = 3): Record<string, Reponse> {
  const r: Record<string, Reponse> = {
    [`${SITE}/?s=`]: html(`<ul><li class="r"><a href="${SITE}/anime/voyage/">Le Long Voyage</a></li><li class="r"><a href="${SITE}/anime/voyage-vf/">Le Long Voyage (VF)</a></li></ul>`),
    [`${SITE}/anime/voyage/`]: html(`<ul>${eps(`${SITE}/anime/voyage`, nb)}</ul>`),
    [`${SITE}/anime/voyage-vf/`]: html(`<ul>${eps(`${SITE}/anime/voyage-vf`, nb)}</ul>`),
  };
  for (let n = 1; n <= 4; n += 1) {
    r[`${SITE}/anime/voyage/episode-${n}`] = lecteur(`vostfr-${n}`);
    r[`${SITE}/anime/voyage-vf/episode-${n}`] = lecteur(`vf-${n}`);
  }
  return r;
}
const S = (id: string, baseUrl: string, path = '/?s={query}') => ({ id, name: id, baseUrl, enabled: true, search: { path, item: 'li.r', title: 'a', link: 'a' }, episodes: { item: 'li.ep', link: 'a' }, player: { iframe: 'iframe' } });
const SOURCE = S('fiches', SITE);

async function services(r: Record<string, Reponse>, o: { sources?: object[]; stockage?: ReturnType<typeof stockageMemoire>; maintenant?: () => number } = {}) {
  const reseau = fauxReseau(r);
  const stockage = o.stockage ?? stockageMemoire({ [CLES.reglages]: ecrireReglages({ ...REGLAGES_DEFAUT, langue: 'vostfr' }) });
  const cache = creerCache(stockage, { delaiEcritureMs: 0, maintenant: o.maintenant });
  const s = creerServices({ choix: { plateforme: 'pc', reseau, lectureSources: true }, stockage, estAdmin: true, catalogue: { attendre: attenteNulle }, cache });
  if (!o.stockage) await s.enregistrerSources(importerSources(o.sources ?? [SOURCE]).sources);
  return { s, reseau, stockage, cache };
}
const titres = ['Le Long Voyage'];

describe('cache des recherches sur les sources', () => {
  it('seconde ouverture de la fiche : aucune requête, « depuis le cache » dans la mesure', async () => {
    const { s, reseau } = await services(routes());
    const d1 = await episodesDisponibles(s, { id: '1', titres });
    expect(d1.episodes).toHaveLength(3);
    expect(d1.mesure?.cache).toBeUndefined();
    expect(d1.mesure?.etapes.map(e => e.nom)).toEqual(['recherche', 'épisodes']);
    const avant = reseau.appels.length;
    const d2 = await episodesDisponibles(s, { id: '1', titres });
    expect(reseau.appels.length).toBe(avant);
    expect(d2.episodes).toEqual(d1.episodes);
    expect(d2.mesure?.cache).toMatchObject({ origine: 'memoire' });
    expect(texteMesure(d2.mesure)).toMatch(/^Depuis le cache \(cette séance/);
  });

  it('gardé sur l’appareil : un nouveau lancement (nouveaux services, même base) ne relit rien', async () => {
    const { s, reseau, stockage, cache } = await services(routes());
    await episodesDisponibles(s, { id: '1', titres });
    await cache.ecrireMaintenant();
    await new Promise<void>(ok => setTimeout(ok, 5));
    await cache.ecrireMaintenant();
    const n = reseau.appels.length;
    const relance = await services(routes(), { stockage });
    const d = await episodesDisponibles(relance.s, { id: '1', titres });
    expect(d.episodes).toHaveLength(3);
    expect(d.mesure?.cache).toMatchObject({ origine: 'appareil' });
    expect(relance.reseau.appels).toHaveLength(0);
    expect(reseau.appels).toHaveLength(n);
    // Relu, le résultat pointe vers la définition actuelle de la source.
    expect(d.resultat?.source).toEqual((await relance.s.sources())[0]);
  });

  it('invalidé quand la définition d’une source change (sélecteur, adresse) ou par « Rechercher à nouveau »', async () => {
    const { s, reseau } = await services(routes());
    await episodesDisponibles(s, { id: '1', titres });
    const n = reseau.appels.length;
    await s.enregistrerSources(importerSources([{ ...SOURCE, episodes: { item: 'ul li.ep', link: 'a' } }]).sources);
    const d = await episodesDisponibles(s, { id: '1', titres });
    expect(d.mesure?.cache).toBeUndefined();
    expect(reseau.appels.length).toBeGreaterThan(n);
    const m = reseau.appels.length;
    await episodesDisponibles(s, { id: '1', titres, forcer: true });
    expect(reseau.appels.length).toBeGreaterThan(m);
  });

  it('un échec n’est jamais gardé', async () => {
    const { s, reseau } = await services({});
    const d = await episodesDisponibles(s, { id: '1', titres });
    expect(d.episodes).toHaveLength(0);
    const n = reseau.appels.length;
    await episodesDisponibles(s, { id: '1', titres });
    expect(reseau.appels.length).toBeGreaterThan(n);
  });

  it('périmé (> 30 min) : servi tout de suite, rafraîchi en arrière-plan ; l’écran est prévenu s’il a changé', async () => {
    // Mise en cache datée d'il y a 31 min.
    let t = Date.now() - EPISODES_FRAIS_MS - 60_000;
    const r = routes(3);
    const { s, reseau } = await services(r, { maintenant: () => t });
    await episodesDisponibles(s, { id: '1', titres });
    t = Date.now();
    // Un épisode de plus est sorti depuis.
    r[`${SITE}/anime/voyage/`] = html(`<ul>${eps(`${SITE}/anime/voyage`, 4)}</ul>`);
    const avant = reseau.appels.length;
    const d = await episodesDisponibles(s, { id: '1', titres });
    expect(d.episodes).toHaveLength(3);
    expect(d.mesure?.cache?.ageMs).toBeGreaterThan(EPISODES_FRAIS_MS);
    expect(await d.rafraichissement).toBe(true);
    expect(reseau.appels.length).toBeGreaterThan(avant);
    const neuf = await episodesDisponibles(s, { id: '1', titres });
    expect(neuf.episodes).toHaveLength(4);
    expect(neuf.rafraichissement).toBeUndefined();
  });

  it('lecteur : épisode absent d’une liste venue du cache → recherche fraîche avant de conclure', async () => {
    const r = routes(3);
    const { s } = await services(r);
    await episodesDisponibles(s, { id: '1', titres });
    r[`${SITE}/anime/voyage/`] = html(`<ul>${eps(`${SITE}/anime/voyage`, 4)}</ul>`);
    const l = await lireAnime(s, { id: '1', titres, numero: 4, langue: 'vostfr' });
    expect(l).toMatchObject({ origine: 'source' });
    expect(l.lecteurs[0].url).toBe('https://lecteur-exemple.fr/embed/vostfr-4');
  });
});

describe('lecteurs : cache et préchargement', () => {
  it('épisode suivant et autre langue préchargés : la lecture suivante et la bascule ne lisent aucune page', async () => {
    const { s, reseau } = await services(routes());
    const l1 = await lireAnime(s, { id: '1', titres, numero: 1, langue: 'vostfr' });
    expect(l1.mesure?.etapes.map(e => e.nom)).toEqual(['épisodes', 'lecteur']);
    expect(await prechargerEpisode(s, { id: '1', titres, numero: 2, langue: 'vostfr' })).toBe(true);
    expect(await prechargerEpisode(s, { id: '1', titres, numero: 1, langue: 'vf' })).toBe(true);
    const n = reseau.appels.length;
    const l2 = await lireAnime(s, { id: '1', titres, numero: 2, langue: 'vostfr' });
    const vf = await lireAnime(s, { id: '1', titres, numero: 1, langue: 'vf' });
    expect(l2.lecteurs[0].url).toBe('https://lecteur-exemple.fr/embed/vostfr-2');
    expect(vf.lecteurs[0].url).toBe('https://lecteur-exemple.fr/embed/vf-1');
    expect(reseau.appels.length).toBe(n);
    expect(texteMesure(l2.mesure)).toMatch(/Depuis le cache/);
  });

  it('préchargement : rien pour une langue dont la liste n’est pas lue, ni pour un épisode inconnu', async () => {
    const { s, reseau } = await services(routes());
    await episodesDisponibles(s, { id: '1', titres, langue: 'vostfr' });
    const n = reseau.appels.length;
    expect(await prechargerEpisode(s, { id: '1', titres, numero: 1, langue: 'vf' })).toBe(false);
    expect(await prechargerEpisode(s, { id: '1', titres, numero: 99, langue: 'vostfr' })).toBe(false);
    expect(reseau.appels.length).toBe(n);
  });
});

describe('sources lentes : en parallèle, dans l’ordre de priorité', () => {
  it('source prioritaire lente et sans le titre : la suivante l’emporte après le délai de grâce, la lente est dite interrompue', async () => {
    const r: Record<string, Reponse> = { ...routes(), [`${LENT}/?s=`]: lent(5000, html('<ul><li class="r"><a href="/autre">Autre chose</a></li></ul>')) };
    const { s } = await services(r, { sources: [S('lente', LENT), SOURCE] });
    s.ctx.parallele = { relaisSourcesMs: 30, graceMs: 50 };
    const debut = Date.now();
    const d = await episodesDisponibles(s, { id: '1', titres });
    expect(Date.now() - debut).toBeLessThan(1500);
    expect(d.resultat?.source?.id).toBe('fiches');
    expect(d.diagnostic.sources.map(x => [x.sourceId, x.statut])).toEqual([
      ['lente', 'interrompue'],
      ['fiches', 'ok'],
    ]);
    expect(lignesDiagnostic(d.diagnostic).join('\n')).toMatch(/interrompue/);
  });

  it('les deux trouvent : la prioritaire l’emporte si elle répond dans le délai de grâce', async () => {
    const r: Record<string, Reponse> = {
      ...routes(),
      [`${LENT}/?s=`]: lent(80, html(`<ul><li class="r"><a href="${LENT}/anime/voyage/">Le Long Voyage</a></li></ul>`)),
      [`${LENT}/anime/voyage/`]: html(`<ul>${eps(`${LENT}/anime/voyage`, 2)}</ul>`),
    };
    const { s } = await services(r, { sources: [S('lente', LENT), SOURCE] });
    s.ctx.parallele = { relaisSourcesMs: 10, graceMs: 2000 };
    const d = await episodesDisponibles(s, { id: '1', titres });
    expect(d.resultat?.source?.id).toBe('lente');
    expect(d.episodes).toHaveLength(2);
  });
});
