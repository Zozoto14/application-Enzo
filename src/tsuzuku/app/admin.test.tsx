/**
 * Paramètres de Tsuzuku : Administration › Tsuzuku (sources, partage,
 * assistant, clés d'API) réservée aux Fondateurs ; Paramètres › Tsuzuku
 * (sources partagées, confort) pour tous. Pages neutres faites main.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { themeHub } from '../../hub/themes';
import type { Rang } from '../../hub/admin/roles';
import { stockageMemoire } from '../moteur/bibliotheque';
import { attenteNulle, fauxReseau, html } from '../moteur/outilsTest';
import { importerSources } from '../moteur/sources';
import { CLES } from '../plateforme/stockage';
import { ReglageAvancesTsuzuku, ReglageSourcesPartagees, ReglageSourcesTsuzuku } from './AdminTsuzuku';
import { creerServices } from './services';

const theme = themeHub('nuit');
const base = () => {
  const m = new Map<string, string>();
  return { m, lire: (c: string) => m.get(c), ecrire: (c: string, v: string) => void m.set(c, v) };
};

const PAGE = `<html><head><title>Médiathèque exemple</title></head><body>
<form action="/recherche"><input name="q"></form>
<ul class="res"><li class="carte"><a class="t" href="/o/1">Le voyage</a></li><li class="carte"><a class="t" href="/o/2">La rivière</a></li></ul>
</body></html>`;
const RESULTATS = `<ul class="res"><li class="carte"><a class="t" href="/o/1">Le voyage</a></li></ul>`;

async function monter(Composant: typeof ReglageSourcesTsuzuku, rang: Rang, o: { stockage?: ReturnType<typeof stockageMemoire>; comptes?: { id: string; nom: string }[]; lecture?: boolean } = {}) {
  const reseau = fauxReseau(
    {
      'https://mediatheque-exemple.fr/catalogue': html(PAGE),
      'https://mediatheque-exemple.fr/recherche?q=': html(RESULTATS),
    },
    { resoudre: async () => ['93.184.216.34'] },
  );
  const stockage = o.stockage ?? stockageMemoire();
  const lecture = o.lecture ?? true;
  const services = creerServices({ choix: { plateforme: lecture ? 'pc' : 'site', reseau, lectureSources: lecture }, stockage, rang, catalogue: { attendre: attenteNulle } });
  const rendu = await render(<Composant theme={theme} base={base()} rang={rang} services={services} comptes={o.comptes} />);
  return { services, stockage, reseau, ...rendu };
}

const texte = (id: string, v: string) => fireEvent.changeText(screen.getByTestId(id), v);
const COMPTES = [
  { id: 'amiaaa01', nom: 'Alice' },
  { id: 'amibbb02', nom: 'Bruno' },
];

describe('Administration › Tsuzuku : réservé aux Fondateurs', () => {
  it.each(['administrateur', 'gestionnaire', 'ami'] as const)('%s : ni sources, ni sélecteurs, ni clés', async rang => {
    const { unmount } = await monter(ReglageSourcesTsuzuku, rang);
    expect(screen.getByTestId('tsuzuku-admin-interdit')).toBeTruthy();
    expect(screen.queryByTestId('source-ajouter')).toBeNull();
    expect(screen.queryByTestId('sources-assistant')).toBeNull();
    await unmount();
    await monter(ReglageAvancesTsuzuku, rang);
    expect(screen.getByTestId('tsuzuku-admin-interdit')).toBeTruthy();
    expect(screen.queryByTestId('tsuzuku-cle-tmdb')).toBeNull();
  });
});

describe('Administration › Tsuzuku › Sources', () => {
  it('vides par défaut ; le Fondateur en ajoute une, l’active, la supprime', async () => {
    const { services } = await monter(ReglageSourcesTsuzuku, 'fondateur');
    expect(await screen.findByTestId('sources-vide')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('sources-ajouter'));
    await fireEvent.press(screen.getByTestId('source-ajouter'));
    await texte('source-nom', 'Ma médiathèque');
    await texte('source-adresse', 'https://mediatheque-exemple.fr');
    await texte('source-champ-search.path', '/recherche?q={query}');
    await texte('source-champ-search.item', 'li.res');
    await texte('source-champ-movies.search.path', '/films?q={query}');
    await texte('source-champ-movies.search.item', 'li.film');
    await fireEvent.press(screen.getByTestId('source-langue-vf'));
    await fireEvent.press(screen.getByTestId('source-enregistrer'));
    await waitFor(async () => expect(await services.sources()).toHaveLength(1));
    const [src] = await services.sources();
    expect(src).toMatchObject({ name: 'Ma médiathèque', language: 'vf', enabled: true, baseUrl: 'https://mediatheque-exemple.fr/' });
    await fireEvent.press(await screen.findByTestId(`source-activer-${src.id}`));
    await waitFor(async () => expect((await services.sources())[0].enabled).toBe(false));
    await fireEvent.press(screen.getByTestId(`source-supprimer-${src.id}`));
    await waitFor(async () => expect(await services.sources()).toEqual([]));
  });

  it('refuse une adresse non publique avec un message', async () => {
    await monter(ReglageSourcesTsuzuku, 'fondateur');
    await fireEvent.press(await screen.findByTestId('sources-ajouter'));
    await fireEvent.press(screen.getByTestId('source-ajouter'));
    await texte('source-nom', 'Maison');
    await texte('source-adresse', 'http://192.168.1.10');
    await fireEvent.press(screen.getByTestId('source-enregistrer'));
    expect(await screen.findByTestId('sources-erreur')).toBeTruthy();
  });

  it('importe un ancien sources.json (entrées invalides écartées)', async () => {
    const { services } = await monter(ReglageSourcesTsuzuku, 'fondateur');
    const ancien = { sources: [{ id: 'a', name: 'A', baseUrl: 'https://a-exemple.fr', enabled: true, search: { path: '/s?q={query}', item: 'li' } }, { name: 'Locale', baseUrl: 'http://localhost:3000' }] };
    await texte('sources-import-texte', JSON.stringify(ancien));
    await fireEvent.press(screen.getByTestId('sources-importer'));
    expect((await screen.findByTestId('sources-avis')).props.children).toMatch(/1 source\(s\) importée\(s\), 1 écartée/);
    expect((await services.sources()).map(s => s.id)).toEqual(['a']);
  });

  it('partage : personne par défaut, puis « une sélection » (Alice seule), puis retrait', async () => {
    const stockage = stockageMemoire({ [CLES.sources]: JSON.stringify(importerSources([{ id: 'src-a', name: 'Médiathèque A', baseUrl: 'https://mediatheque-exemple.fr', enabled: true, search: { path: '/r?q={query}', item: 'li' } }]).sources) });
    const { services } = await monter(ReglageSourcesTsuzuku, 'fondateur', { stockage, comptes: COMPTES });
    expect((await screen.findByTestId('source-acces-src-a')).props.children).toMatch(/vous seul/);
    await fireEvent.press(screen.getByTestId('source-partage-src-a-selection'));
    await fireEvent.press(await screen.findByTestId('source-partage-src-a-compte-amiaaa01'));
    await waitFor(async () => expect(await services.partages()).toEqual({ 'src-a': { mode: 'selection', comptes: ['amiaaa01'] } }));
    expect(screen.getByTestId('source-acces-src-a').props.children).toBe('Partagée avec : Alice');
    expect(screen.getByTestId('sources-recoit-amiaaa01').props.children.join('')).toBe('Alice : Médiathèque A');
    expect(screen.getByTestId('sources-recoit-amibbb02').props.children.join('')).toBe('Bruno : rien');
    await fireEvent.press(screen.getByTestId('source-partage-src-a-personne'));
    await waitFor(async () => expect((await services.partages())['src-a'].mode).toBe('personne'));
  });

  it('assistant (4 étapes) : rappel des droits, analyse d’une page neutre, prompt, JSON validé, test pas à pas, enregistrement', async () => {
    const { services, reseau } = await monter(ReglageSourcesTsuzuku, 'fondateur');
    await fireEvent.press(await screen.findByTestId('sources-ajouter'));
    await fireEvent.press(screen.getByTestId('sources-assistant'));
    expect(screen.getByTestId('assistant-rappel').props.children).toBe('N’ajoutez que des sources dont vous avez le droit d’utiliser le contenu.');
    expect(screen.getByTestId('assistant-etape-1').props.accessibilityState.selected).toBe(true);
    await texte('assistant-adresse', 'https://mediatheque-exemple.fr/catalogue');
    await fireEvent.press(screen.getByTestId('assistant-analyser'));
    const prompt = (await screen.findByTestId('assistant-prompt')).props.value as string;
    expect(screen.getByTestId('assistant-etape-2').props.accessibilityState.selected).toBe(true);
    expect(prompt).toContain('li.carte × 2');
    expect(prompt).toContain('"movies"');
    expect(reseau.urls()).toEqual(['https://mediatheque-exemple.fr/catalogue']);
    await fireEvent.press(screen.getByTestId('assistant-suivant'));
    // JSON invalide : refusé avec le motif.
    await texte('assistant-json', '{"name":"X","baseUrl":"https://mediatheque-exemple.fr","search":{"path":"/recherche","item":"li"}}');
    await fireEvent.press(screen.getByTestId('assistant-verifier'));
    expect((await screen.findByTestId('assistant-invalide')).props.children).toMatch(/\{query\}/);
    expect(screen.queryByTestId('assistant-enregistrer')).toBeNull();
    // JSON valide : test pas à pas puis enregistrement.
    await texte('assistant-json', '```json\n{"name":"Médiathèque exemple","baseUrl":"https://mediatheque-exemple.fr","language":"vostfr","search":{"path":"/recherche?q={query}","item":"ul.res li.carte","title":"a.t","link":"a.t"},"episodes":{"item":"li.ep","number":".n"},"player":{"iframe":"iframe"}}\n```');
    await fireEvent.press(screen.getByTestId('assistant-verifier'));
    expect(await screen.findByTestId('assistant-valide')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('assistant-suivant'));
    await texte('assistant-titre-test', 'Le voyage');
    await fireEvent.press(screen.getByTestId('assistant-tester'));
    expect(await screen.findByTestId('assistant-test-recherche-ok')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('assistant-enregistrer'));
    await waitFor(async () => expect((await services.sourcesPropres()).map(s => s.name)).toEqual(['Médiathèque exemple']));
    expect(await services.partages()).toEqual({});
  });

  it('assistant sur le site : on colle le code HTML (aucune requête)', async () => {
    const { reseau } = await monter(ReglageSourcesTsuzuku, 'fondateur', { lecture: false });
    await fireEvent.press(await screen.findByTestId('sources-ajouter'));
    await fireEvent.press(screen.getByTestId('sources-assistant'));
    expect(screen.getByTestId('assistant-site')).toBeTruthy();
    await texte('assistant-html', PAGE);
    await fireEvent.press(screen.getByTestId('assistant-analyser'));
    expect(((await screen.findByTestId('assistant-prompt')).props.value as string)).toContain('GET /recherche ; champs : q');
    expect(reseau.appels).toHaveLength(0);
  });
});

describe('Administration › Tsuzuku › Clés d’API', () => {
  it('la clé TMDB est enregistrée puis jamais réaffichée en entier ; effaçable', async () => {
    const { services } = await monter(ReglageAvancesTsuzuku, 'fondateur');
    await screen.findByTestId('tsuzuku-cle-tmdb');
    await texte('tsuzuku-cle-tmdb', 'cle-tmdb-secrete-0123456789');
    await fireEvent.press(screen.getByTestId('tsuzuku-cle-enregistrer'));
    await waitFor(() => expect(screen.getByTestId('tsuzuku-cle-etat').props.children).toMatch(/Clé enregistrée/));
    expect(JSON.stringify(screen.toJSON())).not.toContain('cle-tmdb-secrete-0123456789');
    expect(screen.getByTestId('tsuzuku-cle-etat').props.children).toContain('6789');
    expect((await services.reglagesAvances()).cleTmdb).toBe('cle-tmdb-secrete-0123456789');
    await fireEvent.press(screen.getByTestId('tsuzuku-cle-effacer'));
    await waitFor(async () => expect((await services.reglagesAvances()).cleTmdb).toBe(''));
  });

  it('options avancées bornées', async () => {
    const { services } = await monter(ReglageAvancesTsuzuku, 'fondateur');
    await screen.findByTestId('tsuzuku-avance-delai');
    await texte('tsuzuku-avance-delai', '500');
    await fireEvent.press(screen.getByTestId('tsuzuku-avance-delai-appliquer'));
    await waitFor(async () => expect((await services.reglagesAvances()).delaiS).toBe(60));
  });
});

describe('Paramètres › Tsuzuku › Sources partagées avec vous (ami)', () => {
  const recues = (sources: object[]) => JSON.stringify({ date: '2026-09-30T10:00:00Z', sources: importerSources(sources).sources });

  it('rien de partagé : message clair', async () => {
    await monter(ReglageSourcesPartagees, 'ami');
    expect(await screen.findByTestId('sources-partagees-vide')).toBeTruthy();
  });

  it('voit nom, type et état ; active/désactive pour lui seul, sans sélecteurs ni adresse', async () => {
    const stockage = stockageMemoire({ [CLES.sourcesRecues]: recues([{ id: 'src-a', name: 'Médiathèque A', baseUrl: 'https://mediatheque-exemple.fr', enabled: true, search: { path: '/r?q={query}', item: 'li.secret-selecteur' } }]) });
    const { services } = await monter(ReglageSourcesPartagees, 'ami', { stockage });
    expect(await screen.findByText('Médiathèque A')).toBeTruthy();
    const arbre = JSON.stringify(screen.toJSON());
    expect(arbre).not.toContain('li.secret-selecteur');
    expect(arbre).not.toContain('mediatheque-exemple.fr');
    expect(screen.queryByTestId('source-modifier-src-a')).toBeNull();
    await fireEvent.press(screen.getByTestId('source-partagee-activer-src-a'));
    await waitFor(async () => expect((await services.sources())[0].enabled).toBe(false));
    // La copie reçue n'est pas modifiée : seul son choix l'est.
    expect(JSON.parse(stockage.contenu.get(CLES.sourcesRecues)!).sources[0].enabled).toBe(true);
    await expect(services.enregistrerSources([])).rejects.toMatchObject({ statut: 403 });
  });
});
