/**
 * Page « Sources » de Tsuzuku et assistant guidé : visibilité par rang (onglet,
 * barre basse du téléphone, page, boutons), états vides (habilité ou non),
 * étapes de l'assistant, test pas à pas simulé, enregistrement et partage,
 * import/export sans clés. Pages neutres faites main (domaines *-exemple.fr).
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { Rang } from '../../hub/admin/roles';
import { REGISTRE } from '../../hub/registre';
import { themeHub } from '../../hub/themes';
import type { ContexteHub } from '../../hub/types';
import type { Profil } from '../../profils/profils';
import { forcerModeAffichage } from '../../ui/mobile';
import { stockageMemoire } from '../moteur/bibliotheque';
import { attenteNulle, fauxReseau, html, json } from '../moteur/outilsTest';
import { importerSources } from '../moteur/sources';
import { CLES } from '../plateforme/stockage';
import { ReglageSourcesTsuzuku } from './AdminTsuzuku';
import { exporterSources, importerExportSources } from './gestion';
import { TsuzukuEcrans } from './Racine';
import { creerServices } from './services';

const theme = themeHub('nuit');

const media = (id: number, titre: string) => ({
  id, idMal: id, title: { romaji: titre, english: titre, native: titre }, description: `Synopsis de ${titre}`, episodes: 12, status: 'RELEASING', format: 'TV',
  seasonYear: 2025, averageScore: 85, popularity: 100, genres: ['Action'], coverImage: { extraLarge: `https://img-exemple.fr/${id}.jpg` }, studios: { nodes: [] }, externalLinks: [],
});
const jikanAnime = (id: number, titre: string) => ({ mal_id: id, title: titre, title_english: titre, synopsis: `Synopsis de ${titre}`, images: { jpg: { image_url: `https://img-exemple.fr/${id}.jpg` } }, episodes: 12, status: 'Currently Airing', year: 2025, type: 'TV', genres: [{ name: 'Action' }], studios: [], streaming: [] });

// Médiathèque neutre : recherche → série → épisode → lecteur.
const PAGE_RECHERCHE = '<form action="/recherche"><input name="q"></form><ul class="res"><li class="carte"><a class="t" href="/serie/1">Le voyage</a></li><li class="carte"><a class="t" href="/serie/2">La rivière</a></li></ul>';
const PAGE_SERIE = '<ol class="eps"><li class="ep"><span class="n">1</span><a href="/serie/1/ep/1">Épisode 1</a></li><li class="ep"><span class="n">2</span><a href="/serie/1/ep/2">Épisode 2</a></li></ol>';
const PAGE_EPISODE = '<div class="lecteur"><iframe src="https://lecteur-exemple.fr/embed/1-1"></iframe></div>';
const JSON_IA = {
  name: 'Médiathèque exemple',
  baseUrl: 'https://mediatheque-exemple.fr',
  language: 'vostfr',
  search: { path: '/recherche?q={query}', item: 'ul.res li.carte', title: 'a.t', link: 'a.t' },
  episodes: { item: 'ol.eps li.ep', number: '.n', link: 'a' },
  player: { iframe: 'div.lecteur iframe' },
};

function routes() {
  return {
    'https://graphql.anilist.co': json({ data: { trending: { media: [media(1, 'Frieren')] }, popular: { media: [] }, airing: { media: [] }, topRated: { media: [] }, movies: { media: [] } } }),
    'https://api.jikan.moe/v4/anime/1/full': json({ data: jikanAnime(1, 'Frieren') }),
    'https://api.jikan.moe/v4/anime/1/episodes': json({ data: [{ mal_id: 1, title: 'Le voyage' }], pagination: { last_visible_page: 1 } }),
    'https://api.jikan.moe/v4/anime?q=Frieren': json({ data: [jikanAnime(1, 'Frieren')] }),
    'https://api.jikan.moe/v4/genres/anime': json({ data: [] }),
    'https://api.jikan.moe/v4/top/anime': json({ data: [jikanAnime(1, 'Frieren')], pagination: {} }),
    'https://mediatheque-exemple.fr/catalogue': html(PAGE_RECHERCHE),
    'https://mediatheque-exemple.fr/recherche?q=': html(PAGE_RECHERCHE),
    'https://mediatheque-exemple.fr/serie/1/ep/1': html(PAGE_EPISODE),
    'https://mediatheque-exemple.fr/serie/1': html(PAGE_SERIE),
  };
}

const profil = (rang: Rang): Profil => ({ id: rang === 'fondateur' ? 'principal' : 'abcdef1234', nom: rang, admin: rang === 'fondateur', creeLe: '', apps: ['tsuzuku'], actif: true });
const COMPTES: Profil[] = [
  { id: 'amiaaa01', nom: 'Alice', admin: false, creeLe: '', apps: ['tsuzuku'], actif: true },
  { id: 'amibbb02', nom: 'Bruno', admin: false, creeLe: '', apps: ['tsuzuku'], actif: true },
  { id: 'amiccc03', nom: 'Chloé', admin: false, creeLe: '', apps: [], actif: true },
];

async function monter(o: { rang?: Rang; lecture?: boolean; stockage?: ReturnType<typeof stockageMemoire> } = {}) {
  const rang = o.rang ?? 'fondateur';
  const reseau = fauxReseau(routes(), { resoudre: async () => ['93.184.216.34'] });
  const stockage = o.stockage ?? stockageMemoire();
  const lecture = o.lecture ?? true;
  const services = creerServices({ choix: { plateforme: lecture ? 'pc' : 'site', reseau, lectureSources: lecture }, stockage, rang, catalogue: { attendre: attenteNulle } });
  const onParametres = jest.fn();
  const contexte: ContexteHub = { profil: profil(rang), profils: { actuel: profil(rang), tous: [profil(rang), ...COMPTES] } as unknown as ContexteHub['profils'] };
  const rendu = await render(<TsuzukuEcrans contexte={contexte} theme={theme} registre={REGISTRE} onRetour={() => undefined} onParametres={onParametres} services={services} />);
  return { services, stockage, reseau, onParametres, ...rendu };
}

const texte = (id: string, v: string) => fireEvent.changeText(screen.getByTestId(id), v);
const avecSource = () => stockageMemoire({ [CLES.sources]: JSON.stringify(importerSources([{ ...JSON_IA, id: 'src-a', enabled: true }]).sources) });

// `jest.setup.js` force l'affichage « large » ; un test du téléphone le demande puis le rend.
afterEach(() => forcerModeAffichage('large'));

describe('Visibilité par rang : onglet, barre basse, page, boutons', () => {
  it('Fondateur : onglet « Sources » avec le nombre de sources actives, qui ouvre la page de gestion', async () => {
    await monter({ stockage: avecSource() });
    const onglet = await screen.findByTestId('onglet-app-sources');
    await waitFor(() => expect(screen.getByTestId('onglet-sources-badge')).toHaveTextContent('1'));
    expect(onglet.props.accessibilityLabel).toBe('Sources (1 active)');
    await fireEvent.press(onglet);
    expect(await screen.findByTestId('tsuzuku-sources')).toBeTruthy();
    expect(screen.getByTestId('sources-titre')).toBeTruthy();
    expect(await screen.findByTestId('source-src-a')).toBeTruthy();
    expect(screen.getByTestId('sources-ajouter')).toBeTruthy();
  });

  it.each(['administrateur', 'gestionnaire', 'ami'] as const)('%s : ni onglet, ni page, ni bouton d’ajout ou d’édition', async rang => {
    await monter({ rang });
    await screen.findByTestId('tsuzuku-accueil');
    expect(screen.queryByTestId('onglet-app-sources')).toBeNull();
    expect(screen.queryByTestId('sources-ajouter')).toBeNull();
    expect(await screen.findByTestId('sans-source-demander')).toBeTruthy();
    expect(screen.queryByTestId('sans-source-assistant')).toBeNull();
    // Même rendue par erreur, la page Sources ne montre rien et les services refusent (403).
    const { services } = await monter({ rang });
    await render(<ReglageSourcesTsuzuku theme={theme} base={{ lire: () => undefined, ecrire: () => undefined }} rang={rang} services={services} />);
    expect(screen.getByTestId('tsuzuku-admin-interdit')).toBeTruthy();
    await expect(services.enregistrerSources([])).rejects.toMatchObject({ statut: 403 });
    await expect(services.enregistrerTest('x', { ok: true, date: '', detail: '' })).rejects.toMatchObject({ statut: 403 });
  });

  it('téléphone : sections dans une barre basse, « Sources » avec pastille pour le Fondateur seulement', async () => {
    forcerModeAffichage('telephone');
    await monter({ stockage: avecSource() });
    expect(await screen.findByTestId('onglet-app')).toBeTruthy();
    expect(screen.getByTestId('onglet-app-bibliotheque')).toBeTruthy();
    expect(screen.queryByTestId('onglet-sources-badge')).toBeNull();
    await fireEvent.press(screen.getByTestId('onglet-app-sources'));
    expect(await screen.findByTestId('tsuzuku-sources')).toBeTruthy();
    await monter({ rang: 'ami' });
    expect(await screen.findByTestId('onglet-app-accueil')).toBeTruthy();
    expect(screen.queryByTestId('onglet-app-sources')).toBeNull();
  });
});

describe('États vides guidés', () => {
  it('Fondateur sans source : carte sur l’accueil, « Comment ça marche ? », puis l’assistant s’ouvre dans la page Sources', async () => {
    await monter();
    const carte = await screen.findByTestId('tsuzuku-sans-source');
    expect(carte).toHaveTextContent(/Aucune source configurée/);
    expect(carte).toHaveTextContent(/Tsuzuku a besoin d’au moins une source pour lire des épisodes et des films/);
    await fireEvent.press(screen.getByTestId('sans-source-aide'));
    expect(screen.getByTestId('sans-source-explication')).toHaveTextContent(/prompt/);
    await fireEvent.press(screen.getByTestId('sans-source-assistant'));
    expect(await screen.findByTestId('assistant-source')).toBeTruthy();
    expect(screen.getByTestId('assistant-etape-adresse')).toBeTruthy();
  });

  it('catalogue, recherche et fiche : la carte suit ; la fiche garde « coller un lien » et ajoute « Ajouter/modifier les sources »', async () => {
    await monter();
    await fireEvent.press(await screen.findByTestId('onglet-app-catalogue'));
    expect(await screen.findByTestId('tsuzuku-sans-source')).toBeTruthy();
    await texte('catalogue-recherche', 'Frieren');
    await fireEvent.press(screen.getByTestId('catalogue-chercher'));
    expect(await screen.findByTestId('tsuzuku-sans-source')).toBeTruthy();
    await fireEvent.press(await screen.findByTestId('carte-anime-1'));
    await screen.findByTestId('fiche-titre');
    expect(await screen.findByTestId('tsuzuku-sans-source')).toBeTruthy();
    expect(screen.getByTestId('lien-anime-ouvrir')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('fiche-gerer-sources'));
    expect(await screen.findByTestId('tsuzuku-sources')).toBeTruthy();
  });

  it('ami sans source : « Demande à l’administrateur », aucun lien d’édition ; fiche sans « Ajouter/modifier »', async () => {
    await monter({ rang: 'ami' });
    expect(await screen.findByTestId('sans-source-demander')).toHaveTextContent('Demande à l’administrateur d’ajouter des sources.');
    await fireEvent.press(await screen.findByTestId('carte-anime-1'));
    await screen.findByTestId('fiche-titre');
    expect(screen.getByTestId('lien-anime-ouvrir')).toBeTruthy();
    expect(screen.queryByTestId('fiche-gerer-sources')).toBeNull();
    expect(screen.queryByTestId('sans-source-assistant')).toBeNull();
  });

  it('avec une source active : plus de carte', async () => {
    await monter({ stockage: avecSource() });
    await screen.findByTestId('tsuzuku-accueil');
    await waitFor(() => expect(screen.getByTestId('onglet-sources-badge')).toHaveTextContent('1'));
    expect(screen.queryByTestId('tsuzuku-sans-source')).toBeNull();
  });
});

describe('Page Sources : ajout, assistant en 4 étapes, aide, partage', () => {
  async function ouvrirAssistant(o: Parameters<typeof monter>[0] = {}) {
    const m = await monter(o);
    await fireEvent.press(await screen.findByTestId('onglet-app-sources'));
    await fireEvent.press(await screen.findByTestId('sources-ajouter'));
    expect(screen.getByTestId('sources-assistant')).toHaveTextContent(/Avec l’assistant \(recommandé\)/);
    expect(screen.getByTestId('sources-json')).toHaveTextContent(/Saisir ou coller le JSON/);
    await fireEvent.press(screen.getByTestId('sources-assistant'));
    return m;
  }

  it('aide « ? » et lien vers les clés d’API', async () => {
    const { onParametres } = await monter();
    await fireEvent.press(await screen.findByTestId('onglet-app-sources'));
    await fireEvent.press(await screen.findByTestId('sources-aide-ouvrir'));
    const aide = screen.getByTestId('sources-aide');
    for (const motif of [/Qu’est-ce qu’une source/, /Comment marche l’assistant/, /Que mettre dans le prompt/, /Comment tester/, /N’ajoutez que des sources/]) expect(aide).toHaveTextContent(motif);
    expect(screen.getByTestId('sources-rappel')).toHaveTextContent('N’ajoutez que des sources dont vous avez le droit d’utiliser le contenu.');
    await fireEvent.press(screen.getByTestId('sources-cles'));
    expect(onParametres).toHaveBeenCalledWith('administration');
  });

  it('étape 1 : adresse vérifiée (anti-SSRF) avant toute requête', async () => {
    const { reseau } = await ouvrirAssistant();
    const avant = reseau.appels.length;
    for (const mauvaise of ['http://192.168.1.10/', 'http://localhost:3000', 'ftp://exemple.fr', 'https://exemple.fr:22/']) {
      await texte('assistant-adresse', mauvaise);
      await fireEvent.press(screen.getByTestId('assistant-analyser'));
      expect(await screen.findByTestId('assistant-erreur')).toHaveTextContent(/Adresse refusée/);
    }
    expect(reseau.appels.length).toBe(avant);
    expect(screen.getByTestId('assistant-etape-1').props.accessibilityState.selected).toBe(true);
  });

  it('parcours complet : analyse → prompt (copier, IA) → JSON invalide puis réparé → test pas à pas → enregistrement partagé → retour à la liste', async () => {
    const { services } = await ouvrirAssistant();
    await texte('assistant-adresse', 'mediatheque-exemple.fr/catalogue');
    await fireEvent.press(screen.getByTestId('assistant-cible-animes'));
    await fireEvent.press(screen.getByTestId('assistant-analyser'));
    // Étape 2 : prompt + consigne + liens vers des IA.
    const prompt = (await screen.findByTestId('assistant-prompt')).props.value as string;
    expect(screen.getByTestId('assistant-etape-2').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('assistant-consigne')).toHaveTextContent('Colle ce prompt dans l’IA de ton choix, puis reviens coller sa réponse.');
    expect(prompt).toContain('li.carte × 2');
    expect(prompt).toMatch(/sert aux ANIMÉS/);
    expect(screen.getByTestId('assistant-copier')).toBeTruthy();
    expect(screen.getByTestId('assistant-ouvrir-chatgpt')).toBeTruthy();
    expect(screen.getByTestId('assistant-ouvrir-claude')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('assistant-suivant'));
    // Étape 3 : JSON cassé → erreur avec ligne et colonne, réparation.
    await texte('assistant-json', '{\n  "name": "X",\n  "baseUrl": "https://mediatheque-exemple.fr",,\n}');
    await fireEvent.press(screen.getByTestId('assistant-verifier'));
    expect(await screen.findByTestId('assistant-invalide')).toHaveTextContent(/Ligne 3, colonne/);
    await fireEvent.press(screen.getByTestId('assistant-reparer'));
    const reparation = screen.getByTestId('assistant-prompt-reparation').props.value as string;
    expect(reparation).toMatch(/Ligne 3, colonne/);
    expect(reparation).toContain('"baseUrl": "https://mediatheque-exemple.fr",,');
    await texte('assistant-json', `\`\`\`json\n${JSON.stringify(JSON_IA, null, 2)}\n\`\`\``);
    await fireEvent.press(screen.getByTestId('assistant-verifier'));
    expect(await screen.findByTestId('assistant-valide')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('assistant-suivant'));
    // Étape 4 : test pas à pas (recherche → épisodes → lecteur).
    expect(screen.getByTestId('assistant-etape-4').props.accessibilityState.selected).toBe(true);
    await texte('assistant-titre-test', 'Le voyage');
    await fireEvent.press(screen.getByTestId('assistant-tester'));
    expect(await screen.findByTestId('assistant-test-recherche-ok')).toBeTruthy();
    expect(screen.getByTestId('assistant-test-episodes-ok')).toHaveTextContent(/2 épisode\(s\)/);
    expect(screen.getByTestId('assistant-test-lecteur-ok')).toHaveTextContent(/lecteur-exemple\.fr\/embed\/1-1/);
    expect(screen.getByTestId('assistant-test-bilan')).toHaveTextContent(/Test réussi/);
    // Enregistrement : nom, activée, partage avec une sélection.
    await texte('assistant-nom', 'Ma médiathèque');
    expect(screen.queryByTestId('assistant-partage-compte-amiccc03')).toBeNull();
    await fireEvent.press(screen.getByTestId('assistant-partage-selection'));
    await fireEvent.press(screen.getByTestId('assistant-partage-compte-amibbb02'));
    await fireEvent.press(screen.getByTestId('assistant-enregistrer'));
    // Retour à la liste, la source ajoutée en évidence, son dernier test OK, son partage.
    expect(await screen.findByTestId('source-nouvelle')).toBeTruthy();
    expect(screen.queryByTestId('assistant-source')).toBeNull();
    const [src] = await services.sourcesPropres();
    expect(src).toMatchObject({ name: 'Ma médiathèque', enabled: true, language: 'vostfr' });
    expect(await services.partages()).toEqual({ [src.id]: { mode: 'selection', comptes: ['amibbb02'] } });
    expect(screen.getByTestId(`source-test-${src.id}`)).toHaveTextContent(/Dernier test : OK/);
    expect(screen.getByTestId(`source-acces-${src.id}`)).toHaveTextContent('Partagée avec : Bruno');
    expect(screen.getByTestId('sources-recoit-amibbb02')).toHaveTextContent('Bruno : Ma médiathèque');
    expect(screen.getByTestId('sources-avis')).toHaveTextContent(/« Ma médiathèque » ajoutée/);
    await waitFor(() => expect(screen.getByTestId('onglet-sources-badge')).toHaveTextContent('1'));
  });

  it('test KO : les étapes suivantes ne sont pas jouées ; enregistrement désactivé et pour « moi seul »', async () => {
    const { services } = await ouvrirAssistant();
    await fireEvent.press(screen.getByTestId('assistant-direct-json'));
    await texte('assistant-json', JSON.stringify({ ...JSON_IA, search: { ...JSON_IA.search, item: 'div.introuvable' } }));
    await fireEvent.press(screen.getByTestId('assistant-verifier'));
    await fireEvent.press(await screen.findByTestId('assistant-suivant'));
    // Sélecteur faux ET titre absent du site : même le repérage automatique ne trouve rien.
    await texte('assistant-titre-test', 'Titre absent du site');
    await fireEvent.press(screen.getByTestId('assistant-tester'));
    expect(await screen.findByTestId('assistant-test-recherche-ko')).toBeTruthy();
    expect(screen.getByTestId('assistant-test-episodes-saute')).toBeTruthy();
    expect(screen.getByTestId('assistant-test-lecteur-saute')).toBeTruthy();
    expect(screen.getByTestId('assistant-test-bilan')).toHaveTextContent(/Test incomplet/);
    await fireEvent.press(screen.getByTestId('assistant-active-non'));
    await fireEvent.press(screen.getByTestId('assistant-enregistrer'));
    await waitFor(async () => expect(await services.sourcesPropres()).toHaveLength(1));
    const [src] = await services.sourcesPropres();
    expect(src.enabled).toBe(false);
    expect(await services.partages()).toEqual({});
    expect(await screen.findByTestId(`source-test-${src.id}`)).toHaveTextContent(/Dernier test : KO/);
  });

  it('« Saisir ou coller le JSON » commence à l’étape 3', async () => {
    await monter();
    await fireEvent.press(await screen.findByTestId('onglet-app-sources'));
    await fireEvent.press(await screen.findByTestId('sources-ajouter'));
    await fireEvent.press(screen.getByTestId('sources-json'));
    expect(screen.getByTestId('assistant-etape-reponse')).toBeTruthy();
    expect(screen.getByTestId('assistant-etape-3').props.accessibilityState.selected).toBe(true);
  });

  it('site web : coller le HTML, ou prompt sans extrait (l’IA analyse elle-même le site), sans aucune requête', async () => {
    const { reseau } = await ouvrirAssistant({ lecture: false });
    const avant = reseau.appels.length;
    expect(screen.getByTestId('assistant-site')).toHaveTextContent(/CORS/);
    await texte('assistant-adresse', 'https://mediatheque-exemple.fr/catalogue');
    await fireEvent.press(screen.getByTestId('assistant-sans-extrait'));
    const prompt = (await screen.findByTestId('assistant-prompt')).props.value as string;
    expect(prompt).toContain('Adresse du site : https://mediatheque-exemple.fr/catalogue');
    expect(prompt).toMatch(/analyse toi-même le site/);
    expect(reseau.appels.length).toBe(avant);
  });
});

describe('Import / export des sources', () => {
  const sources = importerSources([{ ...JSON_IA, id: 'src-a', enabled: true, userAgent: 'agent-propre-a-l-appareil' }]).sources;

  it('export : définitions seules, sans clé d’API, partage ni agent ; réimportable', () => {
    const texteExport = exporterSources([{ ...sources[0], cleTmdb: 'cle-secrete-0123456789' } as never], '2026-10-01T00:00:00Z');
    expect(texteExport).not.toMatch(/cle-secrete|cleTmdb|agent-propre|partage/);
    const lu = JSON.parse(texteExport);
    expect(lu).toMatchObject({ format: 'tsuzuku-sources', v: 1 });
    expect(importerExportSources(texteExport, []).sources.map(s => s.id)).toEqual(['src-a']);
  });

  it('import validé : adresse locale et sélecteur invalide écartés, doublons ignorés, texte illisible refusé', () => {
    const r = importerExportSources(
      JSON.stringify({ format: 'tsuzuku-sources', v: 1, sources: [...sources, { ...JSON_IA, id: 'local', baseUrl: 'http://localhost:8080' }, { ...JSON_IA, id: 'casse', search: { ...JSON_IA.search, item: 'li[[' } }, { ...JSON_IA, id: 'neuve' }] }),
      sources,
    );
    expect(r.sources.map(s => s.id)).toEqual(['neuve']);
    expect(r.ecartees).toBe(2);
    expect(r.doublons).toBe(1);
    expect(() => importerExportSources('pas du json', [])).toThrow(/illisible/);
  });

  it('dans la page : export à copier (sans la clé TMDB enregistrée), puis import', async () => {
    const stockage = avecSource();
    const { services } = await monter({ stockage });
    await services.enregistrerReglagesAvances({ cleTmdb: 'cle-tmdb-secrete-0123456789', delaiS: 15, tailleMaxMo: 8 });
    await fireEvent.press(await screen.findByTestId('onglet-app-sources'));
    await screen.findByTestId('source-src-a');
    await fireEvent.press(screen.getByTestId('sources-exporter'));
    const exporte = (await screen.findByTestId('sources-export-texte')).props.value as string;
    expect(exporte).toContain('"src-a"');
    expect(exporte).not.toContain('cle-tmdb-secrete');
    await texte('sources-import-texte', JSON.stringify({ format: 'tsuzuku-sources', v: 1, sources: [{ ...JSON_IA, id: 'src-b', name: 'Seconde' }, { ...JSON_IA, id: 'src-a' }] }));
    await fireEvent.press(screen.getByTestId('sources-importer'));
    expect(await screen.findByTestId('sources-avis')).toHaveTextContent(/1 source\(s\) importée\(s\), 1 déjà présente/);
    expect((await services.sourcesPropres()).map(s => s.id)).toEqual(['src-a', 'src-b']);
  });
});
