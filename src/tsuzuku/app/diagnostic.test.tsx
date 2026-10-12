/**
 * « Sur vos sources » : diagnostic détaillé exportable (sans secret), raisons
 * précises (anti-robot, source non configurée pour les animés, sources
 * désactivées), cache, et « Tester une source sur ce titre » depuis la fiche.
 * Pages neutres faites main (domaines *-exemple.fr).
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { REGISTRE } from '../../hub/registre';
import { themeHub } from '../../hub/themes';
import type { ContexteHub } from '../../hub/types';
import type { Profil } from '../../profils/profils';
import { stockageMemoire } from '../moteur/bibliotheque';
import { attenteNulle, fauxReseau, html, json } from '../moteur/outilsTest';
import { importerSources } from '../moteur/sources';
import { CLES } from '../plateforme/stockage';
import { SECTIONS_AIDE_CONFIGURATION } from './AideSources';
import { masquerAdresse, masquerTexte, texteDiagnostic } from './diagnosticTexte';
import { episodesDisponibles } from './resoudre';
import { TsuzukuEcrans } from './Racine';
import { creerServices } from './services';

const theme = themeHub('nuit');
const jikan = (id: number, titre: string) => ({ mal_id: id, title: titre, title_english: titre, synopsis: 'x', images: { jpg: { image_url: `https://img-exemple.fr/${id}.jpg` } }, episodes: 12, status: 'Currently Airing', year: 2025, type: 'TV', genres: [], studios: [], streaming: [] });
const media = (id: number, titre: string) => ({ id, idMal: id, title: { romaji: titre, english: titre, native: titre }, description: 'x', episodes: 12, status: 'RELEASING', format: 'TV', seasonYear: 2025, averageScore: 85, popularity: 1, genres: [], coverImage: { extraLarge: `https://img-exemple.fr/${id}.jpg` }, studios: { nodes: [] }, externalLinks: [] });

const RECHERCHE = '<ul class="res"><li><a href="/serie/1">Le Long Voyage</a></li></ul>';
const SERIE = '<ol class="eps"><li><a href="/serie/1/ep/1">Épisode 1</a></li><li><a href="/serie/1/ep/2">Épisode 2</a></li></ol>';
const BLOQUE = { statut: 503, entetes: { server: 'cloudflare' }, corps: '<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>' };

function routes(o: { bloque?: boolean } = {}) {
  return {
    'https://graphql.anilist.co': json({ data: { trending: { media: [media(1, 'The Long Voyage')] }, popular: { media: [] }, airing: { media: [] }, topRated: { media: [] }, movies: { media: [] } } }),
    'https://api.jikan.moe/v4/anime/1/full': json({ data: jikan(1, 'The Long Voyage') }),
    'https://api.jikan.moe/v4/anime/1/episodes': json({ data: [], pagination: { last_visible_page: 1 } }),
    'https://api.jikan.moe/v4/genres/anime': json({ data: [] }),
    'https://mediatheque-exemple.fr/recherche': o.bloque ? BLOQUE : html(RECHERCHE),
    'https://mediatheque-exemple.fr/serie/1/ep/1': html('<iframe src="https://lecteur-exemple.fr/embed/1"></iframe>'),
    'https://mediatheque-exemple.fr/serie/1': html(SERIE),
  };
}
const SOURCE = { id: 'src-a', name: 'Médiathèque exemple', baseUrl: 'https://mediatheque-exemple.fr', enabled: true, search: { path: '/recherche?q={query}&api_key=CLE-SECRETE-123', item: 'ul.res li', title: 'a', link: 'a' }, episodes: { item: 'ol.eps li', link: 'a' }, player: { iframe: 'iframe' } };

async function services(o: { bloque?: boolean; sources?: unknown[] } = {}) {
  const stockage = stockageMemoire();
  await stockage.ecrire(CLES.sources, JSON.stringify(importerSources(o.sources ?? [SOURCE]).sources));
  const reseau = fauxReseau(routes(o), { resoudre: async () => ['93.184.216.34'] });
  return { s: creerServices({ choix: { plateforme: 'pc', reseau, lectureSources: true }, stockage, rang: 'fondateur', catalogue: { attendre: attenteNulle } }), reseau, stockage };
}

describe('diagnostic exportable', () => {
  it('masque les secrets : identifiants, clés et jetons dans les adresses et le texte', () => {
    expect(masquerAdresse('https://u:mdp@a-exemple.fr/r?q=voyage&api_key=ABC&token=x&page=2')).toBe('https://a-exemple.fr/r?q=voyage&api_key=***&token=***&page=2');
    expect(masquerTexte('Erreur Bearer abc.def-123 sur https://a-exemple.fr/?sig=zz et 0123456789abcdef0123456789abcdef')).toBe('Erreur Bearer *** sur https://a-exemple.fr/?sig=*** et ***');
  });

  it('par source : URL appelée, statut HTTP, type, taille, détections, candidats et scores, raison du rejet', async () => {
    const { s } = await services();
    const d = await episodesDisponibles(s, { id: '1', titres: ['Un Titre Absent'] });
    const texte = texteDiagnostic(d.diagnostic, { oeuvre: 'Un Titre Absent', plateforme: 'app PC', quand: '2026-10-12T00:00:00.000Z' });
    expect(texte).toContain('Diagnostic Tsuzuku');
    expect(texte).toContain('Source « Médiathèque exemple » : titre non reconnu');
    expect(texte).toMatch(/« Un Titre Absent » → 1 résultat\(s\) \[HTTP 200 · text\/html · \d+ o · \d+ ms · extraction : sélecteurs CSS \(1 bloc\(s\) pour le sélecteur\)\]/);
    expect(texte).toContain('meilleurs candidats : « Le Long Voyage »');
    expect(texte).toContain('raison : Le meilleur résultat');
    expect(texte).toContain('api_key=***');
    expect(texte).not.toContain('CLE-SECRETE-123');
  });

  it('anti-robot : raison « bloquée », pas « aucun résultat », une seule requête', async () => {
    const { s, reseau } = await services({ bloque: true });
    const d = await episodesDisponibles(s, { id: '1', titres: ['The Long Voyage', 'Le Long Voyage'] });
    expect(d.diagnostic.raison).toBe('bloquee');
    expect(d.message).toMatch(/bloque les requêtes automatiques/);
    expect(reseau.urls().filter(u => u.includes('mediatheque-exemple.fr'))).toHaveLength(1);
    expect(texteDiagnostic(d.diagnostic)).toMatch(/HTTP 503 .*anti-robot : page « Just a moment… »/);
  });

  it('source pour les films seulement : la fiche le dit (avant : rien n’était affiché)', async () => {
    const { s } = await services({ sources: [{ ...SOURCE, search: { path: '' }, movies: { search: { path: '/films?q={query}', item: '.f' }, player: { iframe: 'iframe' } } }] });
    const d = await episodesDisponibles(s, { id: '1', titres: ['The Long Voyage'] });
    expect(d.diagnostic.raison).toBe('non-configuree');
    expect(d.message).toMatch(/pas configurées pour les animés.*films seulement/);
  });

  it('sources toutes désactivées : message précis', async () => {
    const { s } = await services({ sources: [{ ...SOURCE, enabled: false }] });
    const d = await episodesDisponibles(s, { id: '1', titres: ['The Long Voyage'] });
    expect(d.message).toMatch(/désactivées/);
  });

  it('cache : une source modifiée (nouvelle adresse, miroir) n’est jamais servie par l’ancien résultat', async () => {
    const { s, stockage, reseau } = await services();
    expect((await episodesDisponibles(s, { id: '1', titres: ['The Long Voyage', 'Le Long Voyage'] })).episodes).toHaveLength(2);
    const avant = reseau.appels.length;
    await episodesDisponibles(s, { id: '1', titres: ['The Long Voyage', 'Le Long Voyage'] });
    expect(reseau.appels.length).toBe(avant);
    await stockage.ecrire(CLES.sources, JSON.stringify(importerSources([{ ...SOURCE, search: { ...SOURCE.search, title: 'a[href]' } }]).sources));
    await episodesDisponibles(s, { id: '1', titres: ['The Long Voyage', 'Le Long Voyage'] });
    expect(reseau.appels.length).toBeGreaterThan(avant);
  });

  it('aide « Comment bien configurer une source » : modèles, {q}, {slug}, {n}, JSON, POST, limites, diagnostic', () => {
    const tout = SECTIONS_AIDE_CONFIGURATION.map(x => `${x.titre} ${x.texte} ${x.exemple ?? ''}`).join('\n');
    for (const mot of ['{query}', '{q}', '{slug}', '{n}', '"type": "json"', 'POST', 'anti-robot', 'Copier le diagnostic', 'linkFormat']) expect(tout).toContain(mot);
    expect(tout).not.toMatch(/https?:\/\/(?![\w-]+-exemple\.fr)/);
  });
});

describe('fiche : « Tester une source sur ce titre » et « Copier le diagnostic »', () => {
  const admin: Profil = { id: 'principal', nom: 'Moi', admin: true, creeLe: '' };
  async function ouvrirFiche(o: { bloque?: boolean } = {}) {
    const { s } = await services(o);
    const contexte: ContexteHub = { profil: admin };
    await render(<TsuzukuEcrans contexte={contexte} theme={theme} registre={REGISTRE} onRetour={() => undefined} onParametres={() => undefined} services={s} />);
    await fireEvent.press(await screen.findByTestId('carte-anime-1'));
    await screen.findByTestId('fiche-titre');
    return s;
  }

  it('source bloquée : message précis, détail copiable sans secret, test pas à pas lancé depuis la fiche', async () => {
    await ouvrirFiche({ bloque: true });
    expect(await screen.findByTestId('fiche-sources-echec-message')).toHaveTextContent(/bloque les requêtes automatiques/);
    await fireEvent.press(screen.getByTestId('fiche-sources-echec-detail-bouton'));
    expect(screen.getByTestId('fiche-sources-echec-detail')).toHaveTextContent(/HTTP 503/);
    await fireEvent.press(screen.getByTestId('fiche-sources-echec-copier'));
    const copie = screen.getByTestId('fiche-sources-echec-texte').props.value as string;
    expect(copie).toContain('Oeuvre : The Long Voyage');
    expect(copie).toContain('Plateforme : app PC');
    expect(copie).not.toContain('CLE-SECRETE-123');
    await fireEvent.press(await screen.findByTestId('fiche-tester-ouvrir'));
    await fireEvent.press(await screen.findByTestId('fiche-tester-src-a'));
    expect(await screen.findByTestId('fiche-test-src-a-recherche-ko')).toHaveTextContent(/bloque les requêtes automatiques/);
    expect(screen.getByTestId('fiche-test-src-a-episodes-saute')).toBeTruthy();
  });

  it('source qui marche : le test sur ce titre est OK de bout en bout', async () => {
    await ouvrirFiche();
    expect(await screen.findByTestId('fiche-sources-ok')).toHaveTextContent(/2 épisode\(s\)/);
    await fireEvent.press(await screen.findByTestId('fiche-tester-ouvrir'));
    await fireEvent.press(await screen.findByTestId('fiche-tester-src-a'));
    await waitFor(() => expect(screen.getByTestId('fiche-test-src-a-bilan')).toHaveTextContent(/Test réussi/));
    expect(screen.getByTestId('fiche-test-src-a-lecteur-ok')).toBeTruthy();
  });

  it('site relié au relais (Fondateur) : « via le relais » dans la fiche et le diagnostic copié', async () => {
    const { s: pc } = await services({ bloque: true });
    const site = creerServices({ choix: { plateforme: 'site', reseau: fauxReseau(routes({ bloque: true }), { resoudre: async () => ['93.184.216.34'] }), lectureSources: true, viaRelais: true }, stockage: pc.stockage, rang: 'fondateur', catalogue: { attendre: attenteNulle } });
    expect(site.viaRelais).toBe(true);
    await render(<TsuzukuEcrans contexte={{ profil: admin }} theme={theme} registre={REGISTRE} onRetour={() => undefined} onParametres={() => undefined} services={site} />);
    await fireEvent.press(await screen.findByTestId('carte-anime-1'));
    expect(await screen.findByTestId('fiche-sources-via-relais')).toHaveTextContent(/via le relais/);
    await screen.findByTestId('fiche-sources-echec-message');
    await fireEvent.press(screen.getByTestId('fiche-sources-echec-detail-bouton'));
    expect(screen.getByTestId('fiche-sources-echec-via-relais')).toHaveTextContent(/site web \(navigateur\), via le relais/);
    await fireEvent.press(screen.getByTestId('fiche-sources-echec-copier'));
    expect(screen.getByTestId('fiche-sources-echec-texte').props.value).toContain('Plateforme : site web (navigateur), via le relais');
  });

  it('un ami ne voit pas le test des sources', async () => {
    const { s } = await services();
    const ami = creerServices({ choix: { plateforme: 'pc', reseau: fauxReseau(routes()), lectureSources: true }, stockage: s.stockage, rang: 'ami', catalogue: { attendre: attenteNulle } });
    await render(<TsuzukuEcrans contexte={{ profil: { id: 'abcdef1234', nom: 'Lucas', admin: false, creeLe: '', apps: ['tsuzuku'], actif: true } }} theme={theme} registre={REGISTRE} onRetour={() => undefined} onParametres={() => undefined} services={ami} />);
    await fireEvent.press(await screen.findByTestId('carte-anime-1'));
    await screen.findByTestId('fiche-titre');
    expect(screen.queryByTestId('fiche-tester-ouvrir')).toBeNull();
  });
});
