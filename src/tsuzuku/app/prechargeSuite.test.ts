/** Préchargement de la suite (autre langue, épisode suivant) : une requête à la fois, annulation, économie de données. Fixtures *-exemple.fr. */
import { stockageMemoire } from '../moteur/bibliotheque';
import { attenteNulle, fauxReseau, html, json, type Reponse } from '../moteur/outilsTest';
import { importerSources } from '../moteur/sources';
import { CLES } from '../plateforme/stockage';
import { creerCache } from './cache';
import { CALME_SUITE_MS, creerFileSuite, economieDeDonnees, fileSuiteDe, prechargerSuite } from './prechargeSuite';
import { episodesDisponibles, lecteursDeLEpisode } from './resoudre';
import { creerServices } from './services';
import { ecrireReglages, REGLAGES_DEFAUT } from './reglages';

const SITE = 'https://fiches-exemple.fr';
const JIKAN = 'https://api.jikan.moe/v4';
const eps = (n: number) => Array.from({ length: n }, (_, i) => `<li class="ep"><a href="${SITE}/anime/voyage/episode-${i + 1}">Épisode ${i + 1}</a></li>`).join('');
const S = { id: 'fiches', name: 'fiches', baseUrl: SITE, enabled: true, search: { path: '/?s={query}', item: 'li.r', title: 'a', link: 'a' }, episodes: { item: 'li.ep', link: 'a' }, player: { iframe: 'iframe' } };
const routes = (plus: Record<string, Reponse> = {}): Record<string, Reponse> => ({
  [`${SITE}/?s=`]: html(`<ul><li class="r"><a href="${SITE}/anime/voyage/">Le Long Voyage</a></li></ul>`),
  [`${SITE}/anime/voyage/`]: html(`<ul>${eps(4)}</ul>`),
  [`${SITE}/anime/voyage/episode-2`]: html('<iframe src="https://lecteur-exemple.fr/embed/2"></iframe>'),
  [`${SITE}/anime/voyage/episode-3`]: html('<iframe src="https://lecteur-exemple.fr/embed/3"></iframe>'),
  [`${JIKAN}/anime/1/full`]: json({ data: { mal_id: 1, title: 'Nagai Tabi', titles: [{ type: 'French', title: 'Le Long Voyage' }], episodes: 4 } }),
  ...plus,
});
async function services(r: Record<string, Reponse>) {
  const reseau = fauxReseau(r);
  const stockage = stockageMemoire({ [CLES.reglages]: ecrireReglages({ ...REGLAGES_DEFAUT, langue: 'vostfr' }) });
  const cache = creerCache(stockage, { delaiEcritureMs: 0 });
  const s = creerServices({ choix: { plateforme: 'pc', reseau, lectureSources: true }, stockage, estAdmin: true, catalogue: { attendre: attenteNulle }, cache });
  await s.enregistrerSources(importerSources([S]).sources);
  return { s, reseau };
}
const attendre = (ms: number) => new Promise<void>(ok => setTimeout(() => ok(), ms));
const pages = (reseau: ReturnType<typeof fauxReseau>, motif: string) => reseau.appels.filter(a => a.url.includes(motif)).length;
const titres = ['Le Long Voyage'];

describe('file de préchargement (une requête à la fois, annulable)', () => {
  it('attend le temps de calme, puis passe les étapes l’une après l’autre', async () => {
    const f = creerFileSuite();
    const journal: string[] = [];
    let enVol = 0;
    let max = 0;
    const etape = (nom: string) => async () => {
      enVol++;
      max = Math.max(max, enVol);
      journal.push(`debut ${nom}`);
      await attendre(15);
      journal.push(`fin ${nom}`);
      enVol--;
    };
    f.lancer([etape('a'), etape('b')], { calmeMs: 30 });
    await attendre(10);
    expect(journal).toEqual([]);
    await attendre(120);
    expect(journal).toEqual(['debut a', 'fin a', 'debut b', 'fin b']);
    expect(max).toBe(1);
    expect(f.enCours()).toBe(false);
  });
  it('annulée avant le calme : rien ne part', async () => {
    const f = creerFileSuite();
    const etape = jest.fn(async () => undefined);
    const annuler = f.lancer([etape], { calmeMs: 20 });
    annuler();
    await attendre(60);
    expect(etape).not.toHaveBeenCalled();
    expect(f.enCours()).toBe(false);
  });
  it('annulée pendant une étape : la suivante ne part pas, et l’étape en cours voit le signal', async () => {
    const f = creerFileSuite();
    let vu: boolean | undefined;
    const b = jest.fn(async () => undefined);
    const annuler = f.lancer(
      [
        async signal => {
          await attendre(30);
          vu = signal.annule;
        },
        b,
      ],
      { calmeMs: 0 },
    );
    await attendre(10);
    annuler();
    await attendre(60);
    expect(vu).toBe(true);
    expect(b).not.toHaveBeenCalled();
  });
  it('lancer une autre suite (autre animé) annule la précédente', async () => {
    const f = creerFileSuite();
    const ancienne = jest.fn(async () => undefined);
    const nouvelle = jest.fn(async () => undefined);
    f.lancer([ancienne], { calmeMs: 20 });
    f.lancer([nouvelle], { calmeMs: 0 });
    await attendre(60);
    expect(ancienne).not.toHaveBeenCalled();
    expect(nouvelle).toHaveBeenCalledTimes(1);
  });
  it('une étape qui échoue n’empêche pas la suivante ni ne lève', async () => {
    const f = creerFileSuite();
    const b = jest.fn(async () => undefined);
    f.lancer([() => Promise.reject(new Error('réseau')), b], { calmeMs: 0 });
    await attendre(30);
    expect(b).toHaveBeenCalledTimes(1);
  });
  it('une seule file par profil', () => {
    const cle = {};
    expect(fileSuiteDe(cle)).toBe(fileSuiteDe(cle));
    expect(fileSuiteDe(cle)).not.toBe(fileSuiteDe({}));
  });
});

describe('économie de données', () => {
  it('détectée par saveData ou une connexion 2G', () => {
    expect(economieDeDonnees({ connection: { saveData: true } })).toBe(true);
    expect(economieDeDonnees({ connection: { effectiveType: '2g' } })).toBe(true);
    expect(economieDeDonnees({ connection: { effectiveType: 'slow-2g' } })).toBe(true);
    expect(economieDeDonnees({ connection: { effectiveType: '4g' } })).toBe(false);
    expect(economieDeDonnees({})).toBe(false);
    expect(economieDeDonnees(undefined)).toBe(false);
  });
});

describe('épisode suivant préparé en arrière-plan', () => {
  it('lit la page de l’épisode suivant (une fois), garde ses lecteurs, sans rien lancer d’autre', async () => {
    const { s, reseau } = await services(routes());
    // L'épisode courant (2) est lu comme le lecteur le ferait : liste d'épisodes en cache.
    await episodesDisponibles(s, { id: '1', titres });
    expect(pages(reseau, 'episode-3')).toBe(0);
    const annuler = prechargerSuite(s, { id: '1', titres, numero: 2, langue: null, suivant: true }, { calmeMs: 0, economie: false });
    await attendre(80);
    expect(pages(reseau, 'episode-3')).toBe(1);
    expect(pages(reseau, 'episode-4')).toBe(0);
    expect(pages(reseau, 'episode-2')).toBe(0);
    // « Suivant » : lecteurs servis par le cache, aucune requête de plus.
    const avant = reseau.appels.length;
    const r = await lecteursDeLEpisode(s, `${SITE}/anime/voyage/episode-3`);
    expect(r.lecteurs[0].url).toBe('https://lecteur-exemple.fr/embed/3');
    expect(r.cache).toBeTruthy();
    expect(reseau.appels.length).toBe(avant);
    annuler();
  });
  it('annulé (changement d’animé ou d’épisode) avant le calme : aucune requête', async () => {
    const { s, reseau } = await services(routes());
    await episodesDisponibles(s, { id: '1', titres });
    const avant = reseau.appels.length;
    const annuler = prechargerSuite(s, { id: '1', titres, numero: 2, langue: null, suivant: true }, { calmeMs: 30, economie: false });
    annuler();
    await attendre(80);
    expect(reseau.appels.length).toBe(avant);
  });
  it('un autre animé annule le préchargement du précédent', async () => {
    const { s, reseau } = await services(routes());
    await episodesDisponibles(s, { id: '1', titres });
    prechargerSuite(s, { id: '1', titres, numero: 2, langue: null, suivant: true }, { calmeMs: 30, economie: false });
    // Autre animé (non résolu : aucune source ne l'a) : il remplace la file.
    prechargerSuite(s, { id: '99', titres: ['Autre Titre Inconnu'], numero: 1, langue: null, suivant: true }, { calmeMs: 0, economie: false });
    await attendre(120);
    expect(pages(reseau, 'episode-3')).toBe(0);
  });
  it('rien en économie de données, ni sans lecture des sources, ni sans suite à préparer', async () => {
    const { s, reseau } = await services(routes());
    await episodesDisponibles(s, { id: '1', titres });
    const avant = reseau.appels.length;
    prechargerSuite(s, { id: '1', titres, numero: 2, langue: null, suivant: true }, { calmeMs: 0, economie: true });
    prechargerSuite(s, { id: '1', titres, numero: 2, langue: null, suivant: false }, { calmeMs: 0, economie: false });
    await attendre(60);
    expect(reseau.appels.length).toBe(avant);
    expect(fileSuiteDe(s).enCours()).toBe(false);
  });
  it('le temps de calme par défaut laisse le lecteur courant se charger d’abord', () => {
    expect(CALME_SUITE_MS).toBeGreaterThanOrEqual(300);
  });
});
