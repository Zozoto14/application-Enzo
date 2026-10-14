/**
 * Réactivité perçue : la fiche s'affiche (titre, épisodes du catalogue) sans
 * attendre les sources ; « Sur vos sources » dit qu'il cherche, puis le
 * résultat et son temps ; rouverte, la fiche répond depuis le cache. Le
 * lecteur affiche aussi son temps. Fixtures neutres, réseau simulé lent.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { Profil } from '../../profils/profils';
import { REGISTRE } from '../../hub/registre';
import { themeHub } from '../../hub/themes';
import { stockageMemoire } from '../moteur/bibliotheque';
import { attenteNulle, fauxReseau, html, json, type Reponse } from '../moteur/outilsTest';
import { importerSources } from '../moteur/sources';
import { TsuzukuEcrans } from './Racine';
import { creerServices } from './services';
import { creerCache } from './cache';

const SITE = 'https://fiches-exemple.fr';
const lent = (ms: number, r: ReturnType<typeof html>): Reponse => () => new Promise(ok => setTimeout(() => ok(r), ms));
const media = { id: 1, idMal: 1, title: { romaji: 'Le Long Voyage', english: 'Le Long Voyage', native: 'Nagai Tabi' }, description: 'Synopsis neutre', episodes: 3, status: 'FINISHED', format: 'TV', seasonYear: 2024, averageScore: 80, popularity: 10, genres: ['Aventure'], coverImage: { extraLarge: 'https://img-exemple.fr/1.jpg' }, studios: { nodes: [] }, externalLinks: [] };
const jikan = { mal_id: 1, title: 'Le Long Voyage', title_english: 'Le Long Voyage', synopsis: 'Synopsis neutre', images: { jpg: { image_url: 'https://img-exemple.fr/1.jpg' } }, episodes: 3, status: 'Finished Airing', year: 2024, type: 'TV', genres: [], studios: [], streaming: [] };
const routes: Record<string, Reponse> = {
  'https://graphql.anilist.co': json({ data: { trending: { media: [media] }, popular: { media: [] }, airing: { media: [] }, topRated: { media: [] }, movies: { media: [] } } }),
  'https://api.jikan.moe/v4/anime/1/full': json({ data: jikan }),
  'https://api.jikan.moe/v4/anime/1/episodes': json({ data: [], pagination: { last_visible_page: 1 } }),
  [`${SITE}/?s=`]: lent(250, html(`<ul><li class="r"><a href="${SITE}/anime/voyage/">Le Long Voyage</a></li></ul>`)),
  [`${SITE}/anime/voyage/episode-`]: html('<iframe src="https://lecteur-exemple.fr/embed/1"></iframe>'),
  [`${SITE}/anime/voyage/`]: lent(150, html(`<ul>${[1, 2, 3].map(n => `<li class="ep"><a href="${SITE}/anime/voyage/episode-${n}">Épisode ${n}</a></li>`).join('')}</ul>`)),
};
const admin: Profil = { id: 'principal', nom: 'Moi', admin: true, creeLe: '' };

it('fiche : affichée avant la fin de la recherche, puis le résultat, son temps, et le cache à la seconde ouverture', async () => {
  const reseau = fauxReseau(routes);
  const stockage = stockageMemoire();
  const s = creerServices({ choix: { plateforme: 'pc', reseau, lectureSources: true }, stockage, rang: 'fondateur', catalogue: { attendre: attenteNulle }, cache: creerCache(stockage, { delaiEcritureMs: 0 }) });
  await s.enregistrerSources(importerSources([{ id: 'f', name: 'Fiches', baseUrl: SITE, enabled: true, search: { path: '/?s={query}', item: 'li.r', title: 'a', link: 'a' }, episodes: { item: 'li.ep', link: 'a' }, player: { iframe: 'iframe' } }]).sources);
  await render(<TsuzukuEcrans contexte={{ profil: admin }} theme={themeHub('nuit')} registre={REGISTRE} onRetour={jest.fn()} services={s} />);
  await fireEvent.press(await screen.findByTestId('carte-anime-1'));
  // Le titre et la liste d'épisodes du catalogue sont là pendant que les sources cherchent.
  expect(await screen.findByTestId('fiche-titre')).toBeTruthy();
  expect(await screen.findByTestId('episode-3')).toBeTruthy();
  expect(screen.getByTestId('fiche-sources-recherche')).toBeTruthy();
  expect(await screen.findByTestId('fiche-sources-ok', {}, { timeout: 3000 })).toBeTruthy();
  expect(screen.getByTestId('fiche-sources-mesure').props.children).toMatch(/recherche \d,\d s · épisodes \d,\d s — total \d,\d s/);
  // Seconde ouverture : aucune requête, « Depuis le cache ».
  await fireEvent.press(screen.getByTestId('fiche-retour'));
  const n = reseau.appels.length;
  await fireEvent.press(await screen.findByTestId('carte-anime-1'));
  expect(await screen.findByTestId('fiche-sources-ok')).toBeTruthy();
  expect(screen.getByTestId('fiche-sources-mesure').props.children).toMatch(/^Depuis le cache/);
  expect(reseau.appels.filter(a => a.url.startsWith(SITE)).length).toBe(reseau.appels.slice(0, n).filter(a => a.url.startsWith(SITE)).length);
  // Le lecteur affiche son temps (liste d'épisodes depuis le cache).
  await fireEvent.press(screen.getByTestId('episode-2'));
  expect(await screen.findByTestId('lecteur-mesure', {}, { timeout: 3000 })).toBeTruthy();
  expect(screen.getByTestId('lecteur-mesure').props.children).toMatch(/épisodes \d,\d s · lecteur \d,\d s/);
});
