/**
 * VF / VOSTFR côté app : préférence (série, séance, défaut), bascule dans le
 * lecteur (même numéro, une page de plus au plus), langue absente grisée et
 * expliquée, autres sources à la demande, progression commune aux deux
 * langues, rendu du sélecteur (fiche et lecteur). Fixtures neutres.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { Profil } from '../../profils/profils';
import { REGISTRE } from '../../hub/registre';
import { themeHub } from '../../hub/themes';
import { stockageMemoire } from '../moteur/bibliotheque';
import { attenteNulle, fauxReseau, html, json } from '../moteur/outilsTest';
import { importerSources } from '../moteur/sources';
import { CLES } from '../plateforme/stockage';
import { choisirLangue, langueVoulue, lirePreferencesLangue } from './langues';
import { episodesDisponibles, etatLangues, lireAnime } from './resoudre';
import { TsuzukuEcrans } from './Racine';
import { creerServices } from './services';
import { ecrireReglages, REGLAGES_DEFAUT } from './reglages';

const SITE = 'https://fiches-exemple.fr';
const AUTRE = 'https://doublage-exemple.fr';
const eps = (prefixe: string, n: number) => Array.from({ length: n }, (_, i) => `<li class="ep"><a href="${prefixe}/episode-${i + 1}">Épisode ${i + 1}</a></li>`).join('');
const lecteur = (id: string) => html(`<iframe src="https://lecteur-exemple.fr/embed/${id}"></iframe>`);

function routes(o: { vf?: boolean; nbVf?: number } = {}) {
  const r: Record<string, ReturnType<typeof html>> = {
    [`${SITE}/?s=`]: html(`<ul><li class="r"><a href="${SITE}/anime/voyage/">Le Long Voyage</a></li>${o.vf === false ? '' : `<li class="r"><a href="${SITE}/anime/voyage-vf/">Le Long Voyage (VF)</a></li>`}</ul>`),
    [`${SITE}/anime/voyage/`]: html(`<ul>${eps(`${SITE}/anime/voyage`, 3)}</ul>`),
    [`${SITE}/anime/voyage-vf/`]: html(`<ul>${eps(`${SITE}/anime/voyage-vf`, o.nbVf ?? 3)}</ul>`),
  };
  for (const n of [1, 2, 3]) {
    r[`${SITE}/anime/voyage/episode-${n}`] = lecteur(`vostfr-${n}`);
    r[`${SITE}/anime/voyage-vf/episode-${n}`] = lecteur(`vf-${n}`);
  }
  return r;
}

const SOURCE = { id: 'fiches', name: 'Fiches', baseUrl: SITE, enabled: true, search: { path: '/?s={query}', item: 'li.r', title: 'a', link: 'a' }, episodes: { item: 'li.ep', link: 'a' }, player: { iframe: 'iframe' } };

async function services(r: Record<string, unknown>, o: { langue?: 'vf' | 'vostfr' | 'indifferent'; sources?: object[] } = {}) {
  const reseau = fauxReseau(r as never);
  const stockage = stockageMemoire({ [CLES.reglages]: ecrireReglages({ ...REGLAGES_DEFAUT, langue: o.langue ?? 'vostfr' }) });
  const s = creerServices({ choix: { plateforme: 'pc', reseau, lectureSources: true }, stockage, estAdmin: true, catalogue: { attendre: attenteNulle } });
  await s.enregistrerSources(importerSources(o.sources ?? [SOURCE]).sources);
  return { s, reseau, stockage };
}
const pagesSerie = (reseau: ReturnType<typeof fauxReseau>) => reseau.urls().filter(u => /\/anime\/[^/]+\/$/.test(u));
const titres = ['Le Long Voyage'];

describe('préférence de langue', () => {
  it('réglage VOSTFR : un choix fait dans le lecteur est retenu pour la série (base du profil, cet appareil)', async () => {
    const { s, stockage } = await services({});
    expect(await langueVoulue(s, 'anime:1')).toEqual({ langue: 'vostfr', origine: 'reglage', auChoix: false });
    expect(await choisirLangue(s, 'anime:1', 'vf')).toBe('serie');
    expect(await langueVoulue(s, 'anime:1')).toMatchObject({ langue: 'vf', origine: 'serie' });
    expect(await langueVoulue(s, 'anime:2')).toMatchObject({ langue: 'vostfr', origine: 'reglage' });
    expect(lirePreferencesLangue(stockage.contenu.get(CLES.languesSeries))).toEqual({ 'anime:1': 'vf' });
  });

  it('« au choix à chaque fois » : rien n’est écrit, le choix vaut pour la séance', async () => {
    const { s, stockage } = await services({}, { langue: 'indifferent' });
    expect(await langueVoulue(s, 'anime:1')).toEqual({ langue: null, origine: 'aucune', auChoix: true });
    expect(await choisirLangue(s, 'anime:1', 'vf')).toBe('seance');
    expect(await langueVoulue(s, 'anime:1')).toMatchObject({ langue: 'vf', origine: 'seance' });
    expect(stockage.contenu.has(CLES.languesSeries)).toBe(false);
  });

  it('lecture tolérante (valeur retouchée ignorée)', () => {
    expect(lirePreferencesLangue('{"anime:1":"vf","anime:2":"klingon","anime:3":3}')).toEqual({ 'anime:1': 'vf' });
    expect(lirePreferencesLangue('oups')).toEqual({});
  });
});

describe('bascule VF ↔ VOSTFR dans le lecteur', () => {
  it('même numéro dans l’autre langue ; deux pages de série au plus ; la seconde bascule ne relit rien', async () => {
    const { s, reseau } = await services(routes());
    const vost = await lireAnime(s, { id: '1', titres, numero: 1, langue: 'vostfr' });
    expect(vost).toMatchObject({ origine: 'source', langue: 'vostfr' });
    expect(vost.lecteurs[0].url).toBe('https://lecteur-exemple.fr/embed/vostfr-1');
    // La page VF a été lue en parallèle (bornée) : le bouton VF est sûr.
    expect(vost.langues?.options.vf).toMatchObject({ etat: 'disponible', indice: '« VF » dans le titre' });
    expect(vost.langues?.options.vostfr).toMatchObject({ etat: 'disponible', presumee: true });
    expect(pagesSerie(reseau)).toHaveLength(2);

    const vf = await lireAnime(s, { id: '1', titres, numero: 1, langue: 'vf' });
    expect(vf).toMatchObject({ origine: 'source', langue: 'vf' });
    expect(vf.lecteurs[0].url).toBe('https://lecteur-exemple.fr/embed/vf-1');
    expect(vf.avisLangue).toBeUndefined();
    const retour = await lireAnime(s, { id: '1', titres, numero: 2, langue: 'vostfr' });
    expect(retour.lecteurs[0].url).toBe('https://lecteur-exemple.fr/embed/vostfr-2');
    expect(pagesSerie(reseau)).toHaveLength(2);
    expect(reseau.urls().filter(u => u.includes('?s='))).toHaveLength(1);
  });

  it('épisode absent dans la langue voulue : lecture dans l’autre, bouton grisé et raison', async () => {
    const { s } = await services(routes({ nbVf: 2 }));
    const l = await lireAnime(s, { id: '1', titres, numero: 3, langue: 'vf' });
    expect(l).toMatchObject({ origine: 'source', langue: 'vostfr' });
    expect(l.avisLangue).toMatch(/VF non disponible sur vos sources pour l’épisode 3 .*lecture en VOSTFR/);
    expect(l.langues?.options.vf).toMatchObject({ etat: 'absente', raison: expect.stringMatching(/l’épisode 3 n’est pas en VF .*épisodes 1–2/) });
  });

  it('VF absente de la source de la fiche : « à vérifier » sur les autres sources, trouvée à la demande', async () => {
    const autre = { id: 'doublage', name: 'Doublage', baseUrl: AUTRE, enabled: true, search: { path: '/?q={query}', item: 'li.r', title: 'a', link: 'a' }, episodes: { item: 'li.ep', link: 'a' }, player: { iframe: 'iframe' } };
    const { s, reseau } = await services(
      {
        ...routes({ vf: false }),
        [`${AUTRE}/?q=`]: html(`<ul><li class="r"><a href="${AUTRE}/serie/voyage-vf">Le Long Voyage VF</a></li></ul>`),
        [`${AUTRE}/serie/voyage-vf`]: html(`<ul>${eps(`${AUTRE}/serie/voyage-vf`, 3)}</ul>`),
        [`${AUTRE}/serie/voyage-vf/episode-1`]: lecteur('autre-vf-1'),
      },
      { sources: [{ ...SOURCE, language: 'vostfr' }, autre] },
    );
    const d = await episodesDisponibles(s, { id: '1', titres });
    expect(etatLangues(d, undefined, 1)?.options.vf).toMatchObject({ etat: 'a-verifier' });
    expect(reseau.urls().some(u => u.startsWith(AUTRE))).toBe(false);
    const l = await lireAnime(s, { id: '1', titres, numero: 1, langue: 'vf' });
    expect(l).toMatchObject({ langue: 'vf' });
    expect(l.lecteurs[0].url).toBe('https://lecteur-exemple.fr/embed/autre-vf-1');
    expect(l.langues?.options.vf).toMatchObject({ etat: 'disponible', source: 'Doublage' });
  });

  it('source qui ne distingue pas la langue : sélecteur absent (« Langue inconnue »)', async () => {
    const { s } = await services(routes({ vf: false }));
    const l = await lireAnime(s, { id: '1', titres, numero: 1, langue: 'vf' });
    expect(l.origine).toBe('source');
    expect(l.langue).toBeNull();
    expect(l.langues?.inconnue).toBe(true);
    expect(l.langues?.options.vf.raison).toMatch(/ne distingue pas la langue/);
  });
});

// ------------------------------------------------------------------ Écrans
const theme = themeHub('nuit');
const media = (id: number, titre: string) => ({ id, idMal: id, title: { romaji: titre, english: titre, native: titre }, description: 'x', episodes: 3, status: 'FINISHED', format: 'TV', seasonYear: 2025, averageScore: 80, popularity: 10, genres: ['Aventure'], coverImage: { extraLarge: `https://img-exemple.fr/${id}.jpg` }, studios: { nodes: [] }, externalLinks: [] });
const jikan = { mal_id: 1, title: 'Le Long Voyage', title_english: 'Le Long Voyage', synopsis: 'x', images: { jpg: { image_url: 'https://img-exemple.fr/1.jpg' } }, episodes: 3, status: 'Finished Airing', year: 2025, type: 'TV', genres: [], studios: [], streaming: [] };
const catalogue = {
  'https://graphql.anilist.co': json({ data: { trending: { media: [media(1, 'Le Long Voyage')] }, popular: { media: [] }, airing: { media: [] }, topRated: { media: [] }, movies: { media: [] } } }),
  'https://api.jikan.moe/v4/anime/1/full': json({ data: jikan }),
  'https://api.jikan.moe/v4/anime/1/episodes': json({ data: [], pagination: { last_visible_page: 1 } }),
};
const admin: Profil = { id: 'principal', nom: 'Moi', admin: true, creeLe: '' };

async function monter(r: Record<string, unknown>) {
  const { s, reseau } = await services({ ...r, ...catalogue });
  await render(<TsuzukuEcrans contexte={{ profil: admin }} theme={theme} registre={REGISTRE} onRetour={jest.fn()} onParametres={jest.fn()} services={s} />);
  return { s, reseau };
}

describe('écrans : sélecteur VF | VOSTFR', () => {
  it('fiche puis lecteur : bascule sur l’épisode 1, progression commune aux deux langues', async () => {
    const { s } = await monter(routes({ nbVf: 2 }));
    await fireEvent.press(await screen.findByTestId('carte-anime-1'));
    // Fiche : le sélecteur au-dessus des épisodes, VOSTFR (réglage) choisi.
    expect(await screen.findByTestId('fiche-langue-choix')).toBeTruthy();
    expect(screen.getByTestId('fiche-langue-choix-vostfr').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId('fiche-langue-choix-vf').props.accessibilityState).toMatchObject({ checked: false, disabled: false });
    await fireEvent.press(screen.getByTestId('episode-1'));
    await screen.findByTestId('lecteur-langue');
    expect(screen.getByTestId('lecteur-langue-vostfr').props.accessibilityLabel).toBe('VOSTFR, choisie, langue présumée');
    expect(screen.getByTestId('lecteur-langue-note').props.children).toMatch(/communs aux deux langues/);
    await waitFor(async () => expect((await s.depot.lire()).anime[0]?.currentEpisode).toBe(1));

    // Bascule en VF : même épisode, préférence retenue pour la série, progression inchangée.
    await fireEvent.press(screen.getByTestId('lecteur-langue-vf'));
    await waitFor(() => expect(screen.getByTestId('lecteur-langue-vf').props.accessibilityState).toMatchObject({ checked: true }));
    expect(screen.getByTestId('lecteur-titre').props.children).toMatch(/Épisode 1/);
    expect(screen.getByTestId('lecteur-langue-note').props.children).toMatch(/VF retenue pour cette série/);
    expect(await langueVoulue(s, 'anime:1')).toMatchObject({ langue: 'vf', origine: 'serie' });
    const db = await s.depot.lire();
    expect(db.anime).toHaveLength(1);
    expect(db.anime[0]).toMatchObject({ currentEpisode: 1, status: 'en_cours' });

    // Épisode 3 : absent en VF → lu en VOSTFR, VF grisée « non disponible sur vos sources ».
    await fireEvent.press(screen.getByTestId('lecteur-suivant'));
    await fireEvent.press(await screen.findByTestId('lecteur-suivant'));
    await screen.findByTestId('lecteur-langue-avis');
    await waitFor(() => expect(screen.getByTestId('lecteur-langue-vf').props.accessibilityState).toMatchObject({ disabled: true }));
    expect(screen.getByTestId('lecteur-langue-vf-etat').props.children).toBe('non disponible sur vos sources');
    expect(screen.getByTestId('lecteur-langue-vf-raison').props.children.join('')).toMatch(/l’épisode 3 n’est pas en VF/);
    await waitFor(async () => expect((await s.depot.lire()).anime[0]?.currentEpisode).toBe(3));
  });

  it('source muette : « Langue inconnue », pas de sélecteur', async () => {
    await monter(routes({ vf: false }));
    await fireEvent.press(await screen.findByTestId('carte-anime-1'));
    expect(await screen.findByTestId('fiche-langue-choix-inconnue')).toBeTruthy();
    expect(screen.queryByTestId('fiche-langue-choix-vf')).toBeNull();
  });
});
