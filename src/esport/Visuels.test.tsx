/**
 * Visuels CM côté app :
 *  - champs dynamiques et PLAN DE RENDU (vérification structurelle de ce qui sera dessiné) selon le profil :
 *    Valorant BO3 (issue, score de série, maps), classement multi-équipes (place, points, équipes), conditions ;
 *  - modèles par défaut : 11 genres × 4 formats, champs connus, textes dans le cadre et les zones sûres ;
 *  - sérialisation / désérialisation tolérante (entrées hostiles : adresse d'image, calque inconnu) ;
 *  - opérations de l'éditeur : historique, ordre, duplication, magnétisme, alignement ;
 *  - écrans : panneau « Visuels » d'une carte post (proposition, à régénérer, génération sur mobile),
 *    galerie, charte (lecture seule sans cm.gerer, enregistrement).
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import type { ClientEsport } from './client';
import { apiCm } from './cm/api';
import { CHARTE_DEFAUT, couleurDe, lireCharte, policeDe } from './cm/visuels/charte';
import { CHAMPS_LISTES, CHAMPS_TEXTE, champsDe, conditionRemplie, remplir } from './cm/visuels/champs';
import { aimanter, aligner, annuler, appliquer, ecrireDocument, executer, historique, horsZone, lireDocument, retablir, ZONES_SURES } from './cm/visuels/document';
import { documentEffectif } from './cm/visuels/generation';
import { documentsDefaut, modeleDefaut } from './cm/visuels/modeles';
import { pointsForme, planifier, type ElementPlan } from './cm/visuels/plan';
import { CLES_FORMATS, FORMATS, TYPES_VISUEL, type DonneesVisuel } from './cm/visuels/types';
import { definirLangue } from './i18n';
import { CharteClub } from './ui/cm/visuels/Charte';
import { PanneauVisuelsCarte } from './ui/cm/visuels/VisuelsCarte';
import { apiVisuels } from './cm/visuels/api';
import { Visuels } from './ui/cm/visuels/Visuels';
import type { MoiCm } from './cm/api';

const theme = themeHub('nuit');
const CARTE = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const TEAM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RES = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

afterEach(() => definirLangue('fr'));

/** Données telles que le serveur les rend pour un résultat Valorant BO3 (2-1 contre Nova). */
function donneesBo3(): DonneesVisuel {
  const langue = (issue: string, defaite: string) => ({
    champs: { team: 'Team Alpha', adversaire: 'Nova', score: '2-1', score_nous: '2', score_eux: '1', issue, victoire: '1', tournoi: 'Coupe', tour: 'Finale', heure: '20:00', fuseau: 'CEST', bo: 'BO3', mvp: 'Kai', club: 'Faucons', jeu: 'Valorant', place: '', points: '' },
    listes: {
      manches: [
        { numero: '1', carte: 'Ascent', score: '13-9', issue, victoire: true },
        { numero: '2', carte: 'Bind', score: '7-13', issue: defaite, victoire: false },
        { numero: '3', carte: 'Haven', score: '14-12', issue, victoire: true },
      ],
    },
  });
  return { systeme: 'serie', jeu: { cle: 'valorant', base: 'valorant' }, team: { id: TEAM, nom: 'Team Alpha' }, fr: langue('Victoire', 'Défaite'), en: langue('Victory', 'Defeat'), images: { map_1: { asset: 'map:ascent' } }, empreinte: 'e1' };
}

/** Classement multi-équipes (The Finals, 4 équipes) : 1re place, 16 points. */
function donneesFinals(): DonneesVisuel {
  const langue = (place: string, deux: string) => ({
    champs: { team: 'Squad', adversaire: 'Orion, Vega, Lynx', score: '#1', score_nous: '', score_eux: '', issue: '', victoire: '', place, points: '16', classement: `${place} / 4`, club: 'Faucons', jeu: 'The Finals' },
    listes: {
      manches: [{ numero: '1', carte: 'Monaco', place: deux, points: '6' }],
      classement: [
        { place: '1', place_texte: place, equipe: 'Squad', points: '16', nous: true },
        { place: '2', place_texte: deux, equipe: 'Orion', points: '11', nous: false },
      ],
    },
  });
  return { systeme: 'classement', jeu: { cle: 'the-finals', base: null }, team: { id: TEAM, nom: 'Squad' }, fr: langue('1er', '2e'), en: langue('1st', '2nd'), images: {}, empreinte: 'e2' };
}

const textes = (els: ElementPlan[]) => els.flatMap(e => (e.type === 'texte' ? [e.texte] : e.type === 'liste' ? e.lignes.map(l => l.texte) : []));

describe('visuels : champs dynamiques et plan de rendu', () => {
  it('remplir : champs connus remplacés, inconnus gardés, pas d’interprétation', () => {
    expect(remplir('{team} vs {adversaire} {inconnu}', { team: 'Alpha', adversaire: '<b>Nova</b>' })).toBe('Alpha vs <b>Nova</b> {inconnu}');
    expect(champsDe('{a} et {b} et {a}')).toEqual(['a', 'b']);
  });

  it('résultat Valorant BO3 : issue en couleur de victoire, score de série, détail des maps ; rien du classement', () => {
    const plan = planifier(modeleDefaut('resultat', 'portrait'), CHARTE_DEFAUT, donneesBo3(), 'fr');
    const t = textes(plan.elements);
    expect(t).toEqual(expect.arrayContaining(['VICTOIRE', '2', '1', 'TEAM ALPHA  VS  NOVA', 'ASCENT      13-9', 'BIND      7-13', 'HAVEN      14-12']));
    const issue = plan.elements.find(e => e.id === 'a-issue-v');
    expect(issue && issue.type === 'texte' && issue.remplissage).toEqual({ type: 'uni', couleur: CHARTE_DEFAUT.couleurs.victoire });
    expect(plan.elements.some(e => e.id === 'a-issue-d')).toBe(false);
    expect(plan.elements.some(e => e.id === 'a-place' || e.id === 'b-equipes')).toBe(false);
    const maps = plan.elements.find(e => e.id === 'b-maps');
    expect(maps?.type === 'liste' && maps.lignes.map(l => l.enAvant)).toEqual([true, false, true]);
    // Image de la map 1 (asset du jeu), jamais une adresse.
    const fond = plan.elements.find(e => e.id === 'fond-image');
    expect(fond?.type === 'image' && fond.source).toEqual({ asset: 'map:ascent' });
    // Anglais : mêmes calques, textes anglais.
    expect(textes(planifier(modeleDefaut('resultat', 'portrait'), CHARTE_DEFAUT, donneesBo3(), 'en').elements)).toContain('VICTORY');
  });

  it('résultat multi-équipes : place, points et classement des équipes ; aucun score de série', () => {
    const plan = planifier(modeleDefaut('resultat', 'story'), CHARTE_DEFAUT, donneesFinals(), 'en');
    const t = textes(plan.elements);
    expect(t).toEqual(expect.arrayContaining(['1st', '16 points', '1ST    SQUAD    16', '2ND    ORION    11']));
    expect(plan.elements.some(e => ['a-score-nous', 'a-score-eux', 'b-maps', 'a-issue-v'].includes(e.id))).toBe(false);
    const equipes = plan.elements.find(e => e.id === 'b-equipes');
    expect(equipes?.type === 'liste' && equipes.lignes[0].enAvant).toBe(true);
    // Défaite (série) : l'issue prend la couleur de défaite.
    const d = donneesBo3();
    d.fr.champs = { ...d.fr.champs, victoire: '', issue: 'Défaite' };
    const p2 = planifier(modeleDefaut('resultat', 'carre'), CHARTE_DEFAUT, d, 'fr');
    const issue = p2.elements.find(e => e.id === 'a-issue-d');
    expect(issue?.type === 'texte' && issue.remplissage).toEqual({ type: 'uni', couleur: CHARTE_DEFAUT.couleurs.defaite });
  });

  it('conditions, charte (jetons, polices, néon, glitch), logo absent → monogramme', () => {
    const d = donneesBo3();
    expect(conditionRemplie('serie', d, 'fr')).toBe(true);
    expect(conditionRemplie('!classement', d, 'fr')).toBe(true);
    expect(conditionRemplie('champ:bo', d, 'fr')).toBe(true);
    expect(conditionRemplie('champ:cashprize', d, 'fr')).toBe(false);
    expect(conditionRemplie('champ:manches', d, 'fr')).toBe(true);
    const charte = lireCharte({ couleurs: { primaire: '#123456' }, polices: { titre: 'Chakra Petch' }, effets: { neon: 0, glitch: false } });
    expect(couleurDe('charte:primaire', charte)).toBe('#123456');
    expect(policeDe('charte:titre', charte)).toBe('Chakra Petch');
    const plan = planifier(modeleDefaut('annonce', 'carre'), charte, d, 'fr');
    const vs = plan.elements.find(e => e.id === 'a-vs');
    expect(vs?.type === 'texte' && [vs.police, vs.glitch, vs.lueur]).toEqual(['Chakra Petch', null, null]);
    const logo = plan.elements.find(e => e.id === 'a-logo-adv');
    expect(logo?.type === 'logo' && [logo.source, logo.monogramme]).toEqual([null, 'NO']);
    expect(planifier(modeleDefaut('annonce', 'carre'), CHARTE_DEFAUT, d, 'fr').elements.find(e => e.id === 'a-vs')).toMatchObject({ glitch: { couleurs: ['#00f0ff', '#ff2bd6'] } });
  });
});

describe('visuels : modèles par défaut', () => {
  const connus = new Set<string>([...CHAMPS_TEXTE, ...Object.values(CHAMPS_LISTES).flat()]);
  it('11 genres × 4 formats, à la taille du format, champs connus, dans le cadre ; story dans les zones sûres', () => {
    expect(TYPES_VISUEL).toHaveLength(11);
    for (const type of TYPES_VISUEL) {
      for (const f of CLES_FORMATS) {
        const doc = modeleDefaut(type, f);
        const { largeur: W, hauteur: H } = FORMATS[f];
        expect(doc.format).toBe(f);
        expect(doc.calques.length).toBeGreaterThan(5);
        expect(new Set(doc.calques.map(c => c.id)).size).toBe(doc.calques.length);
        for (const c of doc.calques) {
          const t = c.type === 'texte' ? c.texte.fr + c.texte.en : c.type === 'liste' ? c.ligne.fr + c.ligne.en : '';
          for (const ch of champsDe(t)) expect(connus.has(ch)).toBe(true);
          if (c.type === 'texte' || c.type === 'liste' || c.type === 'logo') {
            expect(c.x >= 0 && c.y >= 0 && c.x + c.l <= W && c.y + c.h <= H).toBe(true);
          }
        }
        if (f === 'story') expect(horsZone(doc, ZONES_SURES.story[0])).toEqual([]);
        // La sérialisation relit exactement le même document.
        expect(lireDocument(JSON.parse(ecrireDocument(doc)), f)).toEqual(doc);
      }
    }
    expect(Object.keys(documentsDefaut('mvp'))).toEqual(['carre', 'portrait', 'story', 'paysage']);
  });

  it('document effectif d’un visuel : retouche, sinon modèle du club, sinon modèle par défaut', () => {
    const retouche = { ...modeleDefaut('libre', 'carre'), calques: [] };
    expect(documentEffectif({ document: retouche, modele: 'defaut:libre', type: 'libre', format: 'carre' }).calques).toEqual([]);
    const club = { ...modeleDefaut('mvp', 'story'), fond: { type: 'uni' as const, couleur: '#000000' } };
    expect(documentEffectif({ document: null, modele: RES, type: 'mvp', format: 'story' }, { documents: { story: club } }).fond).toEqual({ type: 'uni', couleur: '#000000' });
    expect(documentEffectif({ document: null, modele: 'defaut:mvp', type: 'mvp', format: 'story' })).toEqual(modeleDefaut('mvp', 'story'));
  });
});

describe('visuels : lecture tolérante et opérations de l’éditeur', () => {
  it('entrées hostiles : adresse d’image, data:, calque inconnu, couleurs et nombres invalides', () => {
    const doc = lireDocument({
      format: 'carre',
      calques: [
        { id: 'a', type: 'image', source: { url: 'https://site-exemple.fr/x.png' } },
        { id: 'b', type: 'image', source: { fichier: 'data:image/png;base64,AAAA' } },
        { id: 'c', type: 'script', code: 'alert(1)' },
        { id: 'd', type: 'texte', texte: 'Salut\u0007 {team}', couleur: { type: 'uni', couleur: 'url(javascript:1)' }, taille: 1e9, x: Number.NaN },
        { id: 'd', type: 'forme', forme: 'etoile' },
      ],
    });
    expect(doc.calques.map(c => c.type)).toEqual(['texte', 'forme']);
    const t = doc.calques[0];
    expect(t.type === 'texte' && [t.texte.fr, t.couleur, t.taille, t.x]).toEqual(['Salut {team}', { type: 'uni', couleur: '#ffffff' }, 800, 0]);
    expect(doc.calques[1].id).not.toBe('d');
    expect(doc.calques[1].type === 'forme' && doc.calques[1].forme).toBe('rect');
    expect(lireDocument(null, 'story')).toEqual({ v: 1, format: 'story', fond: null, effets: null, calques: [] });
  });

  it('historique (annuler, rétablir, fusion), ordre, duplication, suppression', () => {
    let h = historique(modeleDefaut('libre', 'carre'));
    const id = h.present.calques[0].id;
    h = appliquer(h, { type: 'modifier', id, valeurs: { x: 10 } });
    h = appliquer(h, { type: 'modifier', id, valeurs: { x: 11 } }, { fusion: true });
    expect(h.passe).toHaveLength(1);
    h = annuler(h);
    expect(h.present.calques[0].x).not.toBe(11);
    h = retablir(h);
    expect(h.present.calques[0].x).toBe(11);
    let d = executer(h.present, { type: 'ordre', id, sens: 'premier' });
    expect(d.calques[d.calques.length - 1].id).toBe(id);
    d = executer(d, { type: 'dupliquer', id, nouvelId: 'copie' });
    expect(d.calques[d.calques.length - 1]).toMatchObject({ id: 'copie', x: 35 });
    d = executer(d, { type: 'supprimer', id: 'copie' });
    expect(d.calques.some(c => c.id === 'copie')).toBe(false);
  });

  it('magnétisme (centre, bords, autres calques) et alignement ; formes', () => {
    const r = aimanter({ x: 437, y: 100, l: 200, h: 50 }, [{ x: 10, y: 300, l: 100, h: 100 }], 1080, 1080, 8);
    expect(r.x).toBe(440);
    expect(r.guides).toContainEqual({ sens: 'v', position: 540 });
    expect(aimanter({ x: 12, y: 296, l: 50, h: 50 }, [{ x: 10, y: 300, l: 100, h: 100 }], 1080, 1080, 8)).toMatchObject({ x: 10, y: 300 });
    expect(aligner({ x: 5, y: 5, l: 100, h: 100 }, 'centreH', 1080, 1350)).toEqual({ x: 490, y: 5 });
    expect(aligner({ x: 5, y: 5, l: 100, h: 100 }, 'bas', 1080, 1350)).toEqual({ x: 5, y: 1250 });
    expect(pointsForme('chanfrein', 100, 50, 10)).toEqual([10, 0, 100, 0, 100, 40, 90, 50, 0, 50, 0, 10]);
  });
});

// ------------------------------------------------------------------ Écrans

const D_RESULTATS = '11111111-1111-4111-8111-111111111111';
const D_PLAYOFFS = '22222222-2222-4222-8222-222222222222';
const dossierVi = (id: string, cle: string | null, nom: string | null, parentId: string | null = null) => ({ id, portee: 'club', parentId, nom, cle, systeme: Boolean(cle), modeles: 0, visuels: 0, creeLe: '', majLe: '' });
const DOSSIERS = [
  dossierVi(D_RESULTATS, 'resultats', null),
  dossierVi('33333333-3333-4333-8333-333333333333', 'annonces', null),
  dossierVi(D_PLAYOFFS, null, 'Playoffs', D_RESULTATS),
];

function fauxClient(o: { gerer?: boolean; visuels?: unknown[] } = {}) {
  const appels: Array<{ chemin: string; methode: string; corps?: unknown }> = [];
  const visuel = {
    id: 'v1',
    portee: 'club',
    teamId: null,
    carteId: CARTE,
    pieceId: 'p1',
    fichierId: 'f1',
    nom: 'Match officiel',
    modele: 'defaut:resultat',
    type: 'resultat',
    format: 'portrait',
    langue: 'fr',
    source: { genre: 'resultat', teamId: TEAM, id: RES, date: null },
    retouche: true,
    document: null,
    donnees: donneesBo3(),
    erreurDonnees: null,
    perime: { donnees: true, charte: false, modele: false },
    renduLe: '2026-10-27T10:00:00.000Z',
    version: 3,
    creePar: null,
    majLe: '',
  };
  const requete = async <R,>(chemin: string, methode = 'GET', corps?: unknown): Promise<R> => {
    appels.push({ chemin, methode, corps });
    const c = chemin.split('?')[0];
    if (c === `/cm/cartes/${CARTE}/visuels`) return { visuels: o.visuels ?? [visuel], proposition: { type: 'resultat', source: { genre: 'resultat', teamId: TEAM, id: RES, date: null } }, suggestion: 'resultat', portee: 'club', editer: true } as R;
    if (c === '/cm/charte' && methode === 'GET') return { charte: CHARTE_DEFAUT, version: 2, majLe: null, defaut: CHARTE_DEFAUT, gerer: o.gerer ?? true, teams: [{ id: TEAM, nom: 'Team Alpha' }] } as R;
    if (c === '/cm/charte' && methode === 'PUT') return { charte: { ...CHARTE_DEFAUT, club: 'Faucons' }, version: 3, majLe: null, defaut: CHARTE_DEFAUT, gerer: true, teams: [] } as R;
    if (c === '/cm/modeles') return { modeles: [], noms: {}, editer: { club: true, teams: [] } } as R;
    if (c === '/cm/visuels/dossiers') return { portee: 'club', editer: true, dossiers: DOSSIERS } as R;
    if (c === '/cm/visuels/deplacer') return { faits: ['v1'], erreurs: [], avant: { v1: D_PLAYOFFS } } as R;
    if (c === '/cm/visuels' && methode === 'GET') return { visuels: [{ ...visuel, dossierId: D_PLAYOFFS }] } as R;
    if (c === `/cm/teams/${TEAM}/matchs`) return { resultats: [{ id: RES, titre: 'Match officiel', phrase: 'Victoire 2-1', date: '' }], matchs: [], tournois: [] } as R;
    if (c === '/cm/visuels' && methode === 'POST') return { visuel: { ...visuel, id: `v-${appels.length}`, format: (corps as { format: string }).format, langue: (corps as { langue: string }).langue, fichierId: null, retouche: false, perime: null } } as R;
    if (c.endsWith('/lien')) return { url: 'https://esport.test/cm/fichiers/f1?sig=x', expire: '' } as R;
    return { ok: true } as R;
  };
  const client = { config: { adresse: 'https://esport.test', jetonRelais: 'x' }, requete } as unknown as ClientEsport;
  return { client, appels };
}

describe('visuels : écrans', () => {
  it('carte post : proposition de la suggestion, visuel retouché à régénérer ; « Générer » crée un visuel par format et langue (rendu sur PC)', async () => {
    const { client, appels } = fauxClient();
    const onChange = jest.fn();
    await render(<PanneauVisuelsCarte theme={theme} apiCm={apiCm(client)} carteId={CARTE} teams={[{ id: TEAM, nom: 'Team Alpha' }]} onChange={onChange} />);
    expect(await screen.findByText('Suggestion automatique : Résultat')).toBeTruthy();
    expect(screen.getByText('Les données ont changé depuis le rendu.')).toBeTruthy();
    expect(screen.getByText('Retouché')).toBeTruthy();
    // Sur l'app mobile (tests) : pas de rendu, donc pas de « Régénérer » ; « Retoucher » et « Télécharger » restent.
    expect(screen.queryByTestId('esport-vi-carte-regenerer-v1')).toBeNull();
    expect(screen.getByTestId('esport-vi-carte-telecharger-v1')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-vi-carte-generer'));
    expect(await screen.findByTestId('esport-vi-generer-volet')).toBeTruthy();
    expect(screen.getByText('Le rendu se fait sur le site ou l’app PC.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-vi-generer-format-story'));
    await waitFor(() => expect(screen.getByText('Générer les 4 visuels')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('esport-vi-generer-ok'));
    await waitFor(() => expect(appels.filter(a => a.chemin === '/cm/visuels' && a.methode === 'POST')).toHaveLength(4));
    const corps = appels.filter(a => a.chemin === '/cm/visuels' && a.methode === 'POST').map(a => a.corps as { format: string; langue: string; modele: string; carteId: string; source: { genre: string; id: string } });
    expect(corps.map(c => `${c.format}-${c.langue}`).sort()).toEqual(['portrait-en', 'portrait-fr', 'story-en', 'story-fr']);
    expect(corps[0]).toMatchObject({ modele: 'defaut:resultat', carteId: CARTE, source: { genre: 'resultat', id: RES } });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it('génération depuis une carte : rangée dans un dossier choisi', async () => {
    const { client, appels } = fauxClient();
    await render(<PanneauVisuelsCarte theme={theme} apiCm={apiCm(client)} carteId={CARTE} teams={[{ id: TEAM, nom: 'Team Alpha' }]} onChange={() => undefined} />);
    await fireEvent.press(await screen.findByTestId('esport-vi-carte-generer'));
    await fireEvent.press(await screen.findByTestId(`esport-vi-generer-dossier-${D_PLAYOFFS}`));
    expect(screen.getByText('Résultats › Playoffs')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-vi-generer-ok'));
    await waitFor(() => expect(appels.filter(a => a.chemin === '/cm/visuels' && a.methode === 'POST').length).toBeGreaterThan(0));
    expect((appels.find(a => a.chemin === '/cm/visuels' && a.methode === 'POST')?.corps as { dossierId: string }).dossierId).toBe(D_PLAYOFFS);
  });

  it('dossiers des visuels : dossiers par défaut traduits, ouvrir un dossier (fil d’Ariane), ranger par le menu puis « Annuler »', async () => {
    const { client, appels } = fauxClient();
    const moi: MoiCm = { espace: true, club: ['cm.voir', 'cm.editer'], teams: [], gerer: true };
    await render(<Visuels theme={theme} apiCm={apiCm(client)} large moi={moi} />);
    await fireEvent.press(await screen.findByTestId('esport-vi-onglet-visuels'));
    expect(await screen.findByTestId(`esport-vi-visuels-dossier-${D_RESULTATS}`)).toBeTruthy();
    expect(screen.getAllByText('Annonces').length).toBeGreaterThan(0);
    // Le visuel est dans « Playoffs » (sous « Résultats ») : pas à la racine.
    expect(screen.queryByTestId('esport-vi-visuels-visuel-v1')).toBeNull();
    await fireEvent.press(screen.getByTestId(`esport-vi-visuels-dossier-${D_RESULTATS}`));
    await fireEvent.press(await screen.findByTestId(`esport-vi-visuels-dossier-${D_PLAYOFFS}`));
    expect(await screen.findByTestId('esport-vi-visuels-visuel-v1')).toBeTruthy();
    expect(screen.getByTestId(`esport-vi-visuels-ariane-${D_RESULTATS}`)).toBeTruthy();
    // Menu « ⋯ » › Déplacer vers… › racine.
    await fireEvent.press(screen.getByTestId('esport-vi-visuels-visuel-v1-menu'));
    await fireEvent.press(await screen.findByText('Déplacer vers…'));
    await fireEvent.press(await screen.findByTestId('esport-vi-visuels-destination-racine'));
    await fireEvent.press(screen.getByTestId('esport-vi-visuels-destination-ok'));
    await waitFor(() => expect(appels.some(a => a.chemin === '/cm/visuels/deplacer')).toBe(true));
    expect(appels.find(a => a.chemin === '/cm/visuels/deplacer')?.corps).toEqual({ elements: [{ genre: 'visuel', id: 'v1' }], dossierId: null });
    await fireEvent.press(await screen.findByTestId('esport-vi-visuels-toast-annuler'));
    await waitFor(() => expect(appels.filter(a => a.chemin === '/cm/visuels/deplacer').length).toBe(2));
    expect(appels.filter(a => a.chemin === '/cm/visuels/deplacer')[1].corps).toEqual({ elements: [{ genre: 'visuel', id: 'v1' }], dossierId: D_PLAYOFFS });
  });

  it('serveur sans visuels : pas de panneau', async () => {
    const client = { config: { adresse: 'https://esport.test' }, requete: async () => ({ ok: true }) } as unknown as ClientEsport;
    await render(<PanneauVisuelsCarte theme={theme} apiCm={apiCm(client)} carteId={CARTE} teams={[]} onChange={() => undefined} />);
    expect(screen.queryByTestId('esport-vi-carte')).toBeNull();
  });

  it('charte : lecture seule sans cm.gerer', async () => {
    const lecture = fauxClient({ gerer: false });
    await render(<CharteClub theme={theme} api={apiVisuels(lecture.client)} large />);
    expect(await screen.findByText('Seul le gestionnaire de la section (cm.gerer) modifie la charte.')).toBeTruthy();
    expect(screen.queryByTestId('esport-vi-charte-enregistrer')).toBeNull();
  });

  it('charte : enregistrement (nom du club, palette) avec la version lue', async () => {
    const { client, appels } = fauxClient();
    await render(<CharteClub theme={theme} api={apiVisuels(client)} large />);
    await fireEvent.changeText(await screen.findByTestId('esport-vi-charte-club'), 'Faucons');
    await fireEvent.changeText(screen.getByTestId('esport-vi-charte-couleur-primaire'), '#FF0000');
    await fireEvent.press(screen.getByTestId('esport-vi-charte-enregistrer'));
    await waitFor(() => expect(appels.some(a => a.chemin === '/cm/charte' && a.methode === 'PUT')).toBe(true));
    const put = appels.find(a => a.methode === 'PUT')?.corps as { charte: { club: string; couleurs: { primaire: string } }; version: number };
    expect([put.charte.club, put.charte.couleurs.primaire, put.version]).toEqual(['Faucons', '#ff0000', 2]);
    expect(await screen.findByText('Charte enregistrée : les modèles la suivent.')).toBeTruthy();
  });
});
