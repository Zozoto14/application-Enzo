/**
 * Atelier de strats (éditeur plein écran, la map d'abord), piloté avec un FAUX canevas et une fausse API :
 * mise en page (barre du haut, rail d'outils, dock, frise, tiroir fermé par défaut, place laissée au canevas),
 * dock (joueur, capacité armée, agent, camp, rôle), nouvelle étape qui reprend les pions, sélection multiple
 * (supprimer, aligner, verrouiller), menu contextuel, enregistrement automatique (état, conflit, hors ligne),
 * Échap (ferme d'abord ce qui est ouvert) et raccourcis, téléphone (lecture d'abord), présentation.
 */

import React from 'react';
import { View } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import { ErreurEsport } from './client';
import type { ApiStrats, Strat } from './strats/api';
import type { AgentAsset, Assets, CacheImages } from './strats/assets';
import { appliquer, documentVide, type DocumentStrat, type ObjetStrat } from './strats/document';
import { Atelier } from './ui/strats/atelier/Atelier';
import { DIM } from './ui/strats/atelier/briques';
import { useAtelier, type EtatAtelier } from './ui/strats/atelier/useAtelier';
import type { ExportCanevas, PropsCanevas } from './ui/strats/canevas/types';

let mockFenetre = { width: 1440, height: 900, scale: 1, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockFenetre }));

const theme = themeHub('nuit');
const images: CacheImages = { obtenir: async () => null };

const capacites = (prefixe: string): AgentAsset['capacites'] => [
  { cle: 'Grenade', nom: `${prefixe} C`, icone: null, touche: 'C' },
  { cle: 'Ability1', nom: `${prefixe} Q`, icone: null, touche: 'Q' },
  { cle: 'Ability2', nom: `${prefixe} smoke`, icone: null, touche: 'E' },
  { cle: 'Ultimate', nom: `${prefixe} X`, icone: null, touche: 'X' },
];
const AGENTS: AgentAsset[] = [
  { cle: 'jett', nom: 'Jett', role: 'Duelliste', roleCle: 'duelliste', icone: 'https://media.valorant-api.com/agents/j/displayicon.png', capacites: capacites('Jett') },
  { cle: 'omen', nom: 'Omen', role: 'Contrôleur', roleCle: 'controleur', icone: null, capacites: capacites('Omen') },
  { cle: 'sova', nom: 'Sova', role: 'Initiateur', roleCle: 'initiateur', icone: null, capacites: capacites('Sova') },
];
const ASSETS: Assets = { jeu: 'valorant', modele: 'valorant', source: 'profil', cartes: [{ cle: 'ascent', nom: 'Ascent', minimap: null, vignette: null }], agents: AGENTS, majLe: 0 } as Assets;

const pion = (id: string, x: number, y: number, joueur: number | null = 0): ObjetStrat => ({ id, type: 'agent', x, y, agent: 'jett', nom: 'Jett', icone: null, joueur, couleur: '#22c55e' });
const fleche = (id: string, points: number[], joueur = 0): ObjetStrat => ({ id, type: 'fleche', points, couleur: '#22c55e', epaisseur: 5, tirets: false, joueur }) as ObjetStrat;
const fumee = (id: string, x: number, y: number): ObjetStrat => ({ id, type: 'capacite', x, y, agent: 'omen', capacite: 'Ability2', nom: 'Dark Cover', icone: null, joueur: 1, couleur: '#3b82f6', zone: { forme: 'cercle', rayon: 4.1 }, ordre: 1 });

function documentDe(...objets: ObjetStrat[]): DocumentStrat {
  let d = documentVide({ cle: 'ascent', nom: 'Ascent', image: null }, 'attaque', 'valorant', 'valorant');
  for (const objet of objets) d = appliquer(d, { type: 'ajouter', etape: 0, objet });
  return d;
}

/** Fausse API : une strat en mémoire, révision qui monte à chaque écriture ; `refuser` fait échouer l'écriture suivante. */
function fausseApi(initial: DocumentStrat, moi = { modifier: true, supprimer: true, partager: true }) {
  const etat = { doc: initial, revision: 1, titre: 'Exec A', refuser: undefined as Error | undefined };
  const strat = (): Strat => ({
    id: 's1',
    jeu: 'valorant',
    modele: 'valorant',
    titre: etat.titre,
    carte: { cle: 'ascent', nom: 'Ascent' },
    side: 'attaque',
    type: 'execute',
    tags: [],
    notes: '',
    visibilite: 'team',
    revision: etat.revision,
    versionDocument: 3,
    miniature: null,
    origine: null,
    creePar: { compte: 'c1', pseudo: 'Enzo' },
    majPar: { compte: 'c2', pseudo: 'Mira' },
    creeLe: '2026-01-01T00:00:00.000Z',
    majLe: '2026-01-01T00:00:00.000Z',
    moi,
    donnees: etat.doc,
  });
  const enregistrer = jest.fn(async (_t: string, _id: string, corps: { revision: number; donnees?: DocumentStrat; auto?: boolean; miniature?: string }) => {
    if (etat.refuser) {
      const e = etat.refuser;
      etat.refuser = undefined;
      throw e;
    }
    etat.revision += 1;
    if (corps.donnees) etat.doc = corps.donnees;
    return strat();
  });
  const api = {
    detail: jest.fn(async () => strat()),
    enregistrer,
    modifier: jest.fn(async (_t: string, _id: string, corps: { titre?: string }) => {
      if (corps.titre) etat.titre = corps.titre;
      etat.revision += 1;
      return strat();
    }),
    dupliquer: jest.fn(async () => ({ ...strat(), id: 's2' })),
    supprimer: jest.fn(async () => ({ ok: true as const })),
    creerEntree: jest.fn(async () => ({})),
    creerPartage: jest.fn(async () => ({ id: 'p1', url: 'https://exemple.test/esport/strat/jeton' })),
  };
  return { api: api as unknown as ApiStrats, enregistrer, detail: api.detail, modifier: api.modifier, etat };
}

/** Ce que le faux canevas a reçu au dernier rendu, et l'état de l'atelier (pour agir comme le ferait le canevas). */
const vu: { canevas?: PropsCanevas; atelier?: EtatAtelier } = {};
const exportCanevas: ExportCanevas = { png: () => 'data:image/png;base64,AAAA', miniature: () => 'data:image/jpeg;base64,MINI', versDocument: () => ({ x: 500, y: 500 }), deposer: () => true };

function FauxCanevas(p: PropsCanevas) {
  vu.canevas = p;
  const { onPret } = p;
  React.useEffect(() => onPret?.(exportCanevas), [onPret]);
  return <View testID="faux-canevas" />;
}

function Banc({ api, onRetour = jest.fn(), delaiAuto = 0, assets = ASSETS }: { api: ApiStrats; onRetour?: () => void; delaiAuto?: number; assets?: Assets }) {
  const a = useAtelier({ theme, api, teamId: 't1', stratId: 's1', large: true, assets, onRetour, onOuvrir: jest.fn(), onSupprimee: jest.fn(), images, delaiAuto });
  vu.atelier = a;
  return <Atelier theme={theme} a={a} canevas={props => <FauxCanevas {...props} />} />;
}

async function ouvrir(doc: DocumentStrat, options: { delaiAuto?: number; moi?: Strat['moi']; onRetour?: () => void; assets?: Assets } = {}) {
  const f = fausseApi(doc, options.moi);
  await render(<Banc api={f.api} delaiAuto={options.delaiAuto} onRetour={options.onRetour} assets={options.assets} />);
  await waitFor(() => expect(screen.getByTestId('faux-canevas')).toBeTruthy());
  return f;
}
const canevas = () => vu.canevas as PropsCanevas;
const atelier = () => vu.atelier as EtatAtelier;
const doc = () => atelier().doc as DocumentStrat;
const objets = (etape = 0) => doc().etapes[etape].objets;
const depuisCanevas = (f: (p: PropsCanevas) => void) => act(async () => f(canevas()));
/** Clic droit (ou appui long) comme le fait le canevas : l'objet visé est choisi, puis le menu est demandé. */
const clicDroit = (ids: string[], point = { x: 100, y: 100 }) => depuisCanevas(p => (ids.length ? p.onSelection(ids) : undefined, p.onMenu?.({ x: 400, y: 300, ids, point })));
const etatSauvegarde = () => screen.getByTestId('esport-editeur-enregistrer').props.dataSet.etat as string;

/** Clavier simulé : les écouteurs que l'atelier pose sur la fenêtre (phase de capture). */
const ecouteurs = new Map<string, Set<(e: unknown) => void>>();
async function touche(key: string, plus: Record<string, unknown> = {}) {
  const e = { key, code: key === ' ' ? 'Space' : key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, repeat: false, target: null, preventDefault: jest.fn(), stopPropagation: jest.fn(), ...plus };
  await act(async () => {
    for (const f of [...(ecouteurs.get('keydown') ?? [])]) f(e);
  });
  return e;
}

beforeEach(() => {
  mockFenetre = { width: 1440, height: 900, scale: 1, fontScale: 1 };
  vu.canevas = undefined;
  vu.atelier = undefined;
  ecouteurs.clear();
  const g = globalThis as unknown as Record<string, unknown>;
  g.addEventListener = (type: string, f: (e: unknown) => void) => {
    if (!ecouteurs.has(type)) ecouteurs.set(type, new Set());
    ecouteurs.get(type)?.add(f);
  };
  g.removeEventListener = (type: string, f: (e: unknown) => void) => ecouteurs.get(type)?.delete(f);
  const memoire = new Map<string, string>();
  g.localStorage = { getItem: (c: string) => memoire.get(c) ?? null, setItem: (c: string, v: string) => void memoire.set(c, v) };
});
afterEach(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  delete g.addEventListener;
  delete g.removeEventListener;
  delete g.localStorage;
});

describe('mise en page : la map d’abord', () => {
  it('PC 1440 × 900 : barre, rail de 11 outils, dock, frise, ligne d’état ; tiroir fermé ; le canevas a plus de 70 % de la fenêtre', async () => {
    await ouvrir(documentDe(pion('a', 100, 100)));
    for (const id of ['esport-atelier-haut', 'esport-atelier-rail', 'esport-atelier-dock', 'esport-atelier-frise', 'esport-atelier-etat']) expect(screen.getByTestId(id)).toBeTruthy();
    expect(screen.getAllByTestId(/^esport-outil-[a-z]+$/)).toHaveLength(11);
    // Info-bulle : nom de l'outil et raccourci.
    expect(screen.getByLabelText(/\(V\)$/)).toBeTruthy();
    expect(screen.getByLabelText(/\(E\)$/)).toBeTruthy();
    expect(screen.queryByTestId('esport-atelier-tiroir')).toBeNull();
    const { largeur, hauteur, marges } = canevas();
    expect(largeur).toBe(1440);
    expect(hauteur).toBe(900 - DIM.barre - DIM.dock - DIM.etat);
    expect(((largeur as number) * (hauteur as number)) / (1440 * 900)).toBeGreaterThanOrEqual(0.7);
    // La map se cadre à droite du rail et sous la frise ; le tiroir (fermé) ne lui prend rien.
    expect(marges).toMatchObject({ gauche: DIM.rail + DIM.marge, droite: 0 });
    expect(marges?.haut).toBeGreaterThan(DIM.frise);
    expect(screen.getByTestId('esport-editeur-titre').props.children).toBe('Exec A');
  });

  it('PC 1920 × 1080 et iPad portrait : toujours plus de 70 % et 60 % ; tiroir épinglé : la map se recentre', async () => {
    mockFenetre = { width: 1920, height: 1080, scale: 1, fontScale: 1 };
    const vue = await ouvrir(documentDe());
    expect(((canevas().largeur as number) * (canevas().hauteur as number)) / (1920 * 1080)).toBeGreaterThanOrEqual(0.7);
    await fireEvent.press(screen.getByTestId('esport-editeur-tiroir'));
    expect(screen.getByTestId('esport-atelier-tiroir')).toBeTruthy();
    expect(canevas().marges?.droite).toBe(DIM.tiroir);
    // Le canevas garde toute la place : le tiroir est posé dessus.
    expect(canevas().largeur).toBe(1920);
    await fireEvent.press(screen.getByTestId('esport-editeur-tiroir'));
    expect(screen.queryByTestId('esport-atelier-tiroir')).toBeNull();
    expect(vue.enregistrer).not.toHaveBeenCalled();
    await screen.unmount();
    mockFenetre = { width: 820, height: 1180, scale: 2, fontScale: 1 };
    await ouvrir(documentDe());
    expect(((canevas().largeur as number) * (canevas().hauteur as number)) / (820 * 1180)).toBeGreaterThanOrEqual(0.6);
    expect(screen.getByTestId('esport-atelier-rail')).toBeTruthy();
  });

  it('lecture seule : pas d’outils de pose, état « lecture », le canevas ne reçoit que la main', async () => {
    await ouvrir(documentDe(pion('a', 100, 100)), { moi: { modifier: false, supprimer: false, partager: false } });
    expect(etatSauvegarde()).toBe('lecture');
    expect(canevas().outil).toBe('main');
    expect(canevas().lectureSeule).toBe(true);
    expect(canevas().onMenu).toBeUndefined();
    await depuisCanevas(p => p.onAction({ type: 'supprimer', etape: 0, id: 'a' }));
    expect(objets()).toHaveLength(1);
  });
});

describe('dock : joueurs, capacités, agents', () => {
  it('choisir un joueur, armer une capacité, choisir un agent (il devient celui du joueur)', async () => {
    await ouvrir(documentDe());
    expect(canevas().joueur).toBe(0);
    await fireEvent.press(screen.getByTestId('esport-joueur-1'));
    expect(canevas().joueur).toBe(1);
    expect(canevas().couleur).toBe(doc().joueurs[1].couleur);
    // Un agent du dock : outil « agent » armé, agent du joueur courant mis à jour.
    await fireEvent.press(screen.getByTestId('esport-agent-omen'));
    expect(canevas().outil).toBe('agent');
    expect(canevas().agent?.cle).toBe('omen');
    expect(doc().joueurs[1].agent).toBe('omen');
    // Ses capacités dans l'ordre du jeu (C, Q, E, X) ; un clic arme la pose.
    expect(screen.getAllByTestId(/^esport-capacite-[A-Za-z0-9]+$/).map(e => e.props.testID)).toEqual(['esport-capacite-Grenade', 'esport-capacite-Ability1', 'esport-capacite-Ability2', 'esport-capacite-Ultimate']);
    await fireEvent.press(screen.getByTestId('esport-capacite-Ability2'));
    expect(canevas().outil).toBe('capacite');
    expect(canevas().capacite).toMatchObject({ cle: 'Ability2', nom: 'Omen smoke' });
    expect(screen.getByTestId('esport-capacite-Ability2').props.accessibilityState.selected).toBe(true);
  });

  it('portraits : image quand elle existe, initiales sinon ; filtre par rôle ; camp ennemi : pion rouge sans joueur', async () => {
    await ouvrir(documentDe());
    expect(screen.getByTestId('esport-agent-jett-portrait-image')).toBeTruthy();
    expect(screen.getByTestId('esport-agent-omen-portrait-initiales')).toBeTruthy();
    expect(screen.queryByTestId('esport-agents-sans-images')).toBeNull();
    // Filtre par rôle : le bouton du dock passe d'un rôle au suivant, puis revient à « Tous ».
    await fireEvent.press(screen.getByTestId('esport-agents-role'));
    expect(screen.getAllByTestId(/^esport-agent-[a-z]+$/).map(e => e.props.testID)).toEqual(['esport-agent-jett']);
    await fireEvent.press(screen.getByTestId('esport-agents-role'));
    expect(screen.getAllByTestId(/^esport-agent-[a-z]+$/).map(e => e.props.testID)).toEqual(['esport-agent-sova']);
    await fireEvent.press(screen.getByTestId('esport-agents-role'));
    await fireEvent.press(screen.getByTestId('esport-agents-role'));
    expect(screen.getAllByTestId(/^esport-agent-[a-z]+$/)).toHaveLength(3);
    // Grille « tous les agents » : filtre par rôle en puces, un clic choisit l'agent et ferme la grille.
    await fireEvent.press(screen.getByTestId('esport-dock-grille'));
    await fireEvent.press(screen.getByTestId('esport-agents-role-controleur'));
    expect(screen.getAllByTestId(/^esport-grille-agent-[a-z]+$/).map(e => e.props.testID)).toEqual(['esport-grille-agent-omen']);
    await fireEvent.press(screen.getByTestId('esport-grille-agent-omen'));
    expect(screen.queryByTestId('esport-grille-agents')).toBeNull();
    expect(canevas().agent?.cle).toBe('omen');
    await act(async () => atelier().setRoleFiltre(null));
    await act(async () => atelier().faire({ type: 'joueur', index: 0, champs: { agent: null } }));
    await fireEvent.press(screen.getByTestId('esport-agents-camp-ennemi'));
    await fireEvent.press(screen.getByTestId('esport-agent-sova'));
    expect(canevas().joueur).toBeNull();
    expect(canevas().couleur).toBe('#ef4444');
    // L'agent d'un ennemi ne devient pas celui du joueur courant.
    expect(doc().joueurs[0].agent ?? null).toBeNull();
    // Ennemi dont on ignore l'agent : pion « ? ».
    await fireEvent.press(screen.getByTestId('esport-agent-inconnu'));
    expect(canevas().agent?.cle).toBe('inconnu');
  });

  it('jeu sans personnages (générique) : un pion à la couleur du joueur', async () => {
    await ouvrir(documentVide({ cle: 'carte', nom: 'Carte', image: null }, 'attaque', 'autre', 'generique'), { assets: { ...ASSETS, jeu: 'autre', modele: 'generique', agents: [] } as Assets });
    expect(screen.getByTestId('esport-agent-pion')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-agent-pion'));
    expect(canevas().outil).toBe('agent');
    expect(canevas().agent?.cle).toBe('pion');
  });

  it('portrait importé en échec : le CDN officiel ensuite, puis les initiales ; message seulement si tout a échoué', async () => {
    const signe = (c: string) => `https://esport.test/jeux/images/${c}?c=x&exp=1&sig=s`;
    const agents: AgentAsset[] = [
      { ...AGENTS[0], icone: signe('jett'), iconeDoc: 'https://media.valorant-api.com/agents/j/displayicon.png' },
      { ...AGENTS[1], icone: signe('omen'), iconeDoc: 'https://ailleurs.example/omen.png', capacites: [{ cle: 'Ability2', nom: 'Dark Cover', icone: signe('cover'), touche: 'E' }, { cle: 'Grenade', nom: 'Shrouded Step', icone: null, touche: 'C' }] },
    ];
    await ouvrir(documentDe(), { assets: { ...ASSETS, agents } as Assets });
    expect(screen.getByTestId('esport-agent-jett-portrait-image').props.source).toEqual({ uri: signe('jett') });
    await fireEvent(screen.getByTestId('esport-agent-jett-portrait-image'), 'error');
    expect(screen.getByTestId('esport-agent-jett-portrait-image').props.source).toEqual({ uri: 'https://media.valorant-api.com/agents/j/displayicon.png' });
    // Hôte hors liste : jamais essayé (initiales directement après l'échec du lien signé).
    await fireEvent(screen.getByTestId('esport-agent-omen-portrait-image'), 'error');
    expect(screen.getByTestId('esport-agent-omen-portrait-initiales')).toBeTruthy();
    expect(screen.queryByTestId('esport-agents-sans-images')).toBeNull();
    await fireEvent(screen.getByTestId('esport-agent-jett-portrait-image'), 'error');
    expect(screen.getByTestId('esport-agent-jett-portrait-initiales')).toBeTruthy();
    expect(screen.getByTestId('esport-agents-sans-images')).toBeTruthy();
    // Capacités de l'agent choisi : icône quand elle existe, initiales sinon ; pastille du joueur : son portrait.
    await fireEvent.press(screen.getByTestId('esport-agent-omen'));
    expect(screen.getByTestId('esport-capacite-Ability2-icone-image')).toBeTruthy();
    expect(screen.getByTestId('esport-capacite-Grenade-icone-initiales')).toBeTruthy();
    expect(screen.getByTestId('esport-joueur-0-portrait-image').props.source).toEqual({ uri: signe('omen') });
  });

  it('The Finals : classes sans portraits officiels (initiales, sans message), équipes adverses 1 à 3', async () => {
    const classes: AgentAsset[] = ['light', 'medium', 'heavy'].map(cle => ({ cle, nom: cle[0].toUpperCase() + cle.slice(1), role: null, icone: null, capacites: [{ cle: 'goo', nom: 'Goo Grenade', icone: null, touche: '', donnees: { categorie: 'gadget' } as never }] }));
    await ouvrir(documentVide({ cle: 'monaco', nom: 'Monaco', image: null }, 'attaque', 'the-finals', 'thefinals'), { assets: { ...ASSETS, jeu: 'the-finals', modele: 'thefinals', agents: classes } as Assets });
    expect(doc().joueurs).toHaveLength(3);
    expect(screen.getByTestId('esport-agent-heavy-portrait-initiales')).toBeTruthy();
    expect(screen.queryByTestId('esport-agents-sans-images')).toBeNull();
    await fireEvent.press(screen.getByTestId('esport-agents-camp-ennemi'));
    await fireEvent.press(screen.getByTestId('esport-agents-equipe-2'));
    const equipe2 = canevas().couleur;
    await fireEvent.press(screen.getByTestId('esport-agents-equipe-3'));
    expect(canevas().couleur).not.toBe(equipe2);
    expect(canevas().joueur).toBeNull();
  });
});

describe('étapes', () => {
  it('nouvelle étape : elle reprend les pions à leur dernière position (réglage par défaut) ; annulable', async () => {
    await ouvrir(documentDe(pion('a', 100, 100), fleche('f', [100, 100, 420, 260]), fumee('c', 300, 300)));
    await fireEvent.press(screen.getByTestId('esport-etape-num-ajouter'));
    expect(doc().etapes).toHaveLength(2);
    expect(canevas().etape).toBe(1);
    expect(objets(1).map(o => [o.type, (o as { x: number }).x, (o as { y: number }).y])).toEqual([['agent', 420, 260]]);
    expect(screen.getByTestId('esport-etape-num-1').props.accessibilityState.selected).toBe(true);
    await act(async () => atelier().defaire());
    expect(doc().etapes).toHaveLength(1);
  });

  it('reprise désactivée : étape vide ; frise : aller à une étape, lecture', async () => {
    await ouvrir(documentDe(pion('a', 100, 100)));
    await act(async () => atelier().setPrefs({ reprise: false }));
    await fireEvent.press(screen.getByTestId('esport-etape-num-ajouter'));
    expect(objets(1)).toEqual([]);
    await fireEvent.press(screen.getByTestId('esport-etape-num-0'));
    expect(canevas().etape).toBe(0);
    await fireEvent.press(screen.getByTestId('esport-barre-lecture'));
    expect(canevas().temps).toBe(0);
    // Pendant la lecture, le canevas ne pose rien.
    expect(canevas().outil).toBe('main');
    await act(async () => atelier().arreter());
    expect(canevas().temps).toBeUndefined();
  });

  it('fantôme de l’étape précédente : réglage transmis au canevas et gardé pour la prochaine fois', async () => {
    await ouvrir(documentDe());
    expect(canevas().fantome).toBe(false);
    await act(async () => atelier().setPrefs({ fantome: true }));
    expect(canevas().fantome).toBe(true);
    expect(JSON.parse((globalThis as unknown as { localStorage: { getItem(c: string): string | null } }).localStorage.getItem('esport.strats.atelier.v1') as string)).toMatchObject({ fantome: true });
  });

  it('onglet « Étape » du tiroir : phases du modèle (Valorant), durée, note ; curseur de temps ; dupliquer, déplacer, supprimer', async () => {
    await ouvrir(documentDe(pion('a', 100, 100)));
    await fireEvent.press(screen.getByTestId('esport-etape-note-ouvrir'));
    expect(screen.getByTestId('esport-tiroir-etape')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-etape-phase-post-plant'));
    expect(doc().etapes[0].phase).toBe('post-plant');
    expect(screen.queryByTestId('esport-etape-phase-prise')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('esport-etape-duree'), '12');
    expect(doc().etapes[0].duree).toBe(12);
    await fireEvent.changeText(screen.getByTestId('esport-etape-titre'), 'Prise du site A');
    expect(doc().etapes[0].titre).toBe('Prise du site A');
    // La nouvelle étape garde la phase de la précédente.
    await fireEvent.press(screen.getByTestId('esport-etape-num-ajouter'));
    expect(doc().etapes[1].phase).toBe('post-plant');
    await fireEvent.press(screen.getByTestId('esport-etape-gauche'));
    expect(doc().etapes.map(e => e.titre)[1]).toBe('Prise du site A');
    expect(canevas().etape).toBe(0);
    await fireEvent.press(screen.getByTestId('esport-etape-dupliquer'));
    expect(doc().etapes).toHaveLength(3);
    await fireEvent.press(screen.getByTestId('esport-etape-supprimer'));
    expect(doc().etapes).toHaveLength(2);
    // Curseur de temps : toucher la piste place la lecture dans l'étape.
    const curseur = screen.getByTestId('esport-barre-curseur');
    await fireEvent(curseur, 'layout', { nativeEvent: { layout: { width: 100, height: 28, x: 0, y: 0 } } });
    await fireEvent(curseur, 'responderGrant', { nativeEvent: { locationX: 50 } });
    const duree = doc().etapes[canevas().etape].duree ?? 5;
    expect(canevas().temps).toBeCloseTo(duree / 2, 1);
    expect(JSON.stringify(screen.getByTestId('esport-lecture-temps').props.children)).toContain((duree / 2).toFixed(1));
    await fireEvent.press(screen.getByTestId('esport-lecture-arreter'));
    expect(canevas().temps).toBeUndefined();
  });

  it('The Finals : phases propres au modèle (prise, vol…)', async () => {
    await ouvrir(documentVide({ cle: 'monaco', nom: 'Monaco', image: null }, 'attaque', 'the-finals', 'thefinals'), { assets: { ...ASSETS, jeu: 'the-finals', modele: 'thefinals', agents: [] } as Assets });
    await fireEvent.press(screen.getByTestId('esport-etape-note-ouvrir'));
    expect(screen.getByTestId('esport-etape-phase-prise')).toBeTruthy();
    expect(screen.getByTestId('esport-etape-phase-vol')).toBeTruthy();
    expect(screen.queryByTestId('esport-etape-phase-post-plant')).toBeNull();
    // Étages : le sélecteur de la barre du haut n'existe que pour ce modèle.
    expect(screen.getByTestId('esport-editeur-niveau')).toBeTruthy();
  });
});

describe('sélection multiple et tiroir', () => {
  it('le tiroir s’ouvre sur une sélection (sans bouger la map) ; plusieurs objets : supprimer d’un coup, annulable', async () => {
    await ouvrir(documentDe(pion('a', 100, 100), pion('b', 300, 140, 1), fumee('c', 500, 500)));
    await depuisCanevas(p => p.onSelection(['a']));
    expect(screen.getByTestId('esport-atelier-tiroir')).toBeTruthy();
    expect(canevas().marges?.droite).toBe(0);
    await depuisCanevas(p => p.onSelection(['a', 'b', 'c']));
    expect(canevas().selection).toEqual(['a', 'b', 'c']);
    expect(screen.getByTestId('esport-tiroir-multi')).toBeTruthy();
    expect(JSON.stringify(screen.getByTestId('esport-tiroir-multi-compte').props.children)).toContain('3');
    await fireEvent.press(screen.getByTestId('esport-tiroir-supprimer'));
    expect(objets()).toEqual([]);
    expect(canevas().selection).toEqual([]);
    await act(async () => atelier().defaire());
    expect(objets().map(o => o.id)).toEqual(['a', 'b', 'c']);
  });

  it('aligner et répartir la sélection ; verrouiller : l’objet ne se supprime plus', async () => {
    await ouvrir(documentDe(pion('a', 100, 100), pion('b', 300, 140, 1), pion('c', 620, 220, 2)));
    await depuisCanevas(p => p.onSelection(['a', 'b', 'c']));
    await fireEvent.press(screen.getByTestId('esport-aligner-haut'));
    expect(new Set(objets().map(o => (o as { y: number }).y)).size).toBe(1);
    await fireEvent.press(screen.getByTestId('esport-repartir-horizontal'));
    expect(objets().map(o => (o as { x: number }).x)).toEqual([100, 360, 620]);
    await fireEvent.press(screen.getByTestId('esport-tiroir-verrou'));
    expect(objets().every(o => o.verrou)).toBe(true);
    await fireEvent.press(screen.getByTestId('esport-tiroir-supprimer'));
    expect(objets()).toHaveLength(3);
  });

  it('dupliquer la sélection : les copies deviennent la sélection', async () => {
    await ouvrir(documentDe(pion('a', 100, 100), pion('b', 300, 140, 1)));
    await depuisCanevas(p => p.onSelection(['a', 'b']));
    await fireEvent.press(screen.getByTestId('esport-tiroir-dupliquer'));
    expect(objets()).toHaveLength(4);
    expect(canevas().selection).toHaveLength(2);
    expect(canevas().selection).not.toContain('a');
  });

  it('calques (masquer, verrouiller) et affichage (thème de la map, atténuation, noms, légende) : par utilisateur', async () => {
    await ouvrir(documentDe(pion('a', 100, 100), fumee('c', 400, 400)));
    await fireEvent.press(screen.getByTestId('esport-editeur-tiroir'));
    await fireEvent.press(screen.getByTestId('esport-tiroir-onglet-calques'));
    await fireEvent.press(screen.getByTestId('esport-calque-utilitaires-visible'));
    expect(doc().calques.utilitaires.visible).toBe(false);
    await fireEvent.press(screen.getByTestId('esport-calque-marqueurs-verrou'));
    expect(doc().calques.marqueurs.verrou).toBe(true);
    expect(canevas().themeCarte).toBe('tactique');
    await fireEvent.press(screen.getByTestId('esport-theme-carte-contraste'));
    expect(canevas().themeCarte).toBe('contraste');
    await fireEvent.press(screen.getByTestId('esport-attenuer-2'));
    expect(canevas().attenuation).toBe(2);
    await fireEvent.press(screen.getByTestId('esport-affichage-noms'));
    expect(canevas().noms).toBe(false);
    expect(screen.queryByTestId('esport-atelier-legende')).toBeNull();
    await fireEvent.press(screen.getByTestId('esport-affichage-legende'));
    expect(screen.getByTestId('esport-atelier-legende')).toBeTruthy();
    expect(screen.getByTestId('esport-legende-c')).toBeTruthy();
    // Réglages d'affichage : gardés pour cet utilisateur, jamais dans le document.
    expect(JSON.parse((globalThis as unknown as { localStorage: { getItem(c: string): string | null } }).localStorage.getItem('esport.strats.atelier.v1') as string)).toMatchObject({ themeCarte: 'contraste', attenuation: 2, noms: false, legende: true, tiroir: 'ouvert' });
    expect(JSON.stringify(doc())).not.toContain('contraste');
  });

  it('options de l’outil : usage d’une flèche (déplacement, rotation, regard), trajet du joueur', async () => {
    await ouvrir(documentDe());
    expect(screen.queryByTestId('esport-atelier-options-panneau')).toBeNull();
    await fireEvent.press(screen.getByTestId('esport-outil-fleche'));
    expect(screen.getByTestId('esport-atelier-options-panneau')).toBeTruthy();
    expect(canevas().usage).toBe('deplacement');
    await fireEvent.press(screen.getByTestId('esport-usage-rotation'));
    expect(canevas().usage).toBe('rotation');
    expect(canevas().tirets).toBe(true);
    await fireEvent.press(screen.getByTestId('esport-usage-regard'));
    expect(canevas().usage).toBe('regard');
    expect(canevas().trajetJoueur).toBe(true);
    await fireEvent.press(screen.getByTestId('esport-trajet-joueur'));
    expect(canevas().trajetJoueur).toBe(false);
  });
});

describe('menu contextuel (clic droit, appui long)', () => {
  it('sur un objet : dupliquer, verrouiller, premier plan, changer de joueur, copier vers l’étape suivante, supprimer', async () => {
    await ouvrir(documentDe(pion('a', 100, 100), pion('b', 300, 140, 1)));
    await clicDroit(['a'], { x: 100, y: 100 });
    expect(screen.getByTestId('esport-menu-contextuel')).toBeTruthy();
    expect(canevas().selection).toEqual(['a']);
    await fireEvent.press(screen.getByTestId('esport-menu-avant'));
    expect(objets().map(o => o.id)).toEqual(['b', 'a']);
    expect(screen.queryByTestId('esport-menu-contextuel')).toBeNull();
    await clicDroit(['a'], { x: 100, y: 100 });
    await fireEvent.press(screen.getByTestId('esport-menu-joueur-2'));
    expect(objets().find(o => o.id === 'a')).toMatchObject({ joueur: 2, couleur: doc().joueurs[2].couleur });
    await clicDroit(['a'], { x: 100, y: 100 });
    await fireEvent.press(screen.getByTestId('esport-menu-copier-suivante'));
    // Pas d'étape suivante : elle est créée, avec la copie.
    expect(doc().etapes).toHaveLength(2);
    expect(objets(1)).toHaveLength(1);
    expect(objets(1)[0]).toMatchObject({ type: 'agent', x: 100, y: 100 });
    await clicDroit(['a'], { x: 100, y: 100 });
    await fireEvent.press(screen.getByTestId('esport-menu-verrou'));
    expect(objets().find(o => o.id === 'a')?.verrou).toBe(true);
    await clicDroit(['b'], { x: 300, y: 140 });
    await fireEvent.press(screen.getByTestId('esport-menu-supprimer'));
    expect(objets().map(o => o.id)).toEqual(['a']);
  });

  it('sur le vide : coller, tout sélectionner, ajuster la vue', async () => {
    await ouvrir(documentDe(pion('a', 100, 100), pion('b', 300, 140, 1)));
    await clicDroit([], { x: 700, y: 700 });
    expect(screen.queryByTestId('esport-menu-supprimer')).toBeNull();
    await fireEvent.press(screen.getByTestId('esport-menu-tout'));
    expect(canevas().selection).toEqual(['a', 'b']);
    await depuisCanevas(p => p.onVue({ echelle: 3, x: -200, y: -100 }));
    await clicDroit([], { x: 700, y: 700 });
    await fireEvent.press(screen.getByTestId('esport-menu-ajuster'));
    expect(canevas().vue).toEqual({ echelle: 1, x: 0, y: 0 });
  });
});

describe('enregistrement automatique', () => {
  it('un changement : « modifié », puis enregistré tout seul (avec `auto`), état « enregistré »', async () => {
    const f = await ouvrir(documentDe(pion('a', 100, 100)), { delaiAuto: 40 });
    expect(etatSauvegarde()).toBe('enregistre');
    await depuisCanevas(p => p.onAction({ type: 'deplacer', etape: 0, id: 'a', dx: 50, dy: 0 }));
    expect(etatSauvegarde()).toBe('modifie');
    await waitFor(() => expect(f.enregistrer).toHaveBeenCalledTimes(1));
    const corps = f.enregistrer.mock.calls[0][2];
    expect(corps).toMatchObject({ revision: 1, auto: true });
    expect(corps.donnees?.etapes[0].objets[0]).toMatchObject({ id: 'a', x: 150 });
    // Première écriture automatique : la miniature de la grille part avec.
    expect(corps.miniature).toBe('data:image/jpeg;base64,MINI');
    await waitFor(() => expect(etatSauvegarde()).toBe('enregistre'));
    // Rien de neuf : rien n'est renvoyé.
    await act(() => new Promise<void>(ok => setTimeout(ok, 90)));
    expect(f.enregistrer).toHaveBeenCalledTimes(1);
    // Écriture suivante : la révision reçue, sans miniature (une par minute au plus).
    await depuisCanevas(p => p.onAction({ type: 'deplacer', etape: 0, id: 'a', dx: 10, dy: 0 }));
    await waitFor(() => expect(f.enregistrer).toHaveBeenCalledTimes(2));
    expect(f.enregistrer.mock.calls[1][2]).toMatchObject({ revision: 2, auto: true });
    expect(f.enregistrer.mock.calls[1][2].miniature).toBeUndefined();
  });

  it('pendant un geste (glisser), l’enregistrement attend la fin du geste', async () => {
    const f = await ouvrir(documentDe(pion('a', 100, 100)), { delaiAuto: 30 });
    await depuisCanevas(p => (p.onOccupe?.(true), p.onAction({ type: 'deplacer', etape: 0, id: 'a', dx: 5, dy: 0 })));
    await act(() => new Promise<void>(ok => setTimeout(ok, 120)));
    expect(f.enregistrer).not.toHaveBeenCalled();
    await depuisCanevas(p => p.onOccupe?.(false));
    await waitFor(() => expect(f.enregistrer).toHaveBeenCalledTimes(1), { timeout: 2000 });
  });

  it('« Enregistrer » à la main : version explicite (sans `auto`), avec la miniature', async () => {
    const f = await ouvrir(documentDe(pion('a', 100, 100)));
    await depuisCanevas(p => p.onAction({ type: 'deplacer', etape: 0, id: 'a', dx: 50, dy: 0 }));
    await fireEvent.press(screen.getByTestId('esport-editeur-enregistrer'));
    await waitFor(() => expect(etatSauvegarde()).toBe('enregistre'));
    expect(f.enregistrer).toHaveBeenCalledTimes(1);
    expect(f.enregistrer.mock.calls[0][2].auto).toBeUndefined();
    expect(f.enregistrer.mock.calls[0][2].miniature).toBe('data:image/jpeg;base64,MINI');
  });

  it('conflit (quelqu’un a enregistré entre-temps) : bandeau, plus d’écriture automatique ; « Recharger » reprend la version du serveur', async () => {
    const f = await ouvrir(documentDe(pion('a', 100, 100)), { delaiAuto: 30 });
    f.etat.refuser = new ErreurEsport('Conflit', 409, 'conflit', { revision: 7 });
    await depuisCanevas(p => p.onAction({ type: 'deplacer', etape: 0, id: 'a', dx: 50, dy: 0 }));
    await waitFor(() => expect(screen.getByTestId('esport-editeur-conflit')).toBeTruthy());
    expect(etatSauvegarde()).toBe('conflit');
    await depuisCanevas(p => p.onAction({ type: 'deplacer', etape: 0, id: 'a', dx: 5, dy: 0 }));
    await act(() => new Promise<void>(ok => setTimeout(ok, 100)));
    expect(f.enregistrer).toHaveBeenCalledTimes(1);
    // « Garder la mienne » : écrit par-dessus la révision du serveur.
    await fireEvent.press(screen.getByTestId('esport-editeur-ecraser'));
    await waitFor(() => expect(f.enregistrer).toHaveBeenCalledTimes(2));
    expect(f.enregistrer.mock.calls[1][2]).toMatchObject({ revision: 7 });
    await waitFor(() => expect(screen.queryByTestId('esport-editeur-conflit')).toBeNull());
    expect(etatSauvegarde()).toBe('enregistre');
  });

  it('hors ligne : état « erreur », rien n’est perdu ; quitter demande avant de partir', async () => {
    const onRetour = jest.fn();
    const f = await ouvrir(documentDe(pion('a', 100, 100)), { delaiAuto: 30, onRetour });
    f.etat.refuser = new Error('réseau');
    await depuisCanevas(p => p.onAction({ type: 'deplacer', etape: 0, id: 'a', dx: 50, dy: 0 }));
    await waitFor(() => expect(etatSauvegarde()).toBe('erreur'));
    expect(objets()[0]).toMatchObject({ x: 150 });
    f.etat.refuser = new Error('réseau');
    await fireEvent.press(screen.getByTestId('esport-editeur-retour'));
    await waitFor(() => expect(screen.getByTestId('esport-editeur-dialogue-quitter')).toBeTruthy());
    expect(onRetour).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('esport-editeur-rester'));
    // Réseau revenu : « Enregistrer » passe, puis le retour ne demande plus rien.
    await fireEvent.press(screen.getByTestId('esport-editeur-enregistrer'));
    await waitFor(() => expect(etatSauvegarde()).toBe('enregistre'));
    await fireEvent.press(screen.getByTestId('esport-editeur-retour'));
    await waitFor(() => expect(onRetour).toHaveBeenCalledTimes(1));
  });

  it('retour avec des changements pas encore partis : ils sont enregistrés avant de quitter', async () => {
    const onRetour = jest.fn();
    const f = await ouvrir(documentDe(pion('a', 100, 100)), { onRetour });
    await depuisCanevas(p => p.onAction({ type: 'deplacer', etape: 0, id: 'a', dx: 50, dy: 0 }));
    await fireEvent.press(screen.getByTestId('esport-editeur-retour'));
    await waitFor(() => expect(onRetour).toHaveBeenCalled());
    expect(f.enregistrer).toHaveBeenCalledTimes(1);
    expect(f.etat.doc.etapes[0].objets[0]).toMatchObject({ x: 150 });
  });

  it('renommer la strat dans la barre du haut', async () => {
    const f = await ouvrir(documentDe());
    await fireEvent.press(screen.getByTestId('esport-editeur-titre'));
    await fireEvent.changeText(screen.getByTestId('esport-editeur-titre-champ'), 'Exec B rapide');
    await fireEvent(screen.getByTestId('esport-editeur-titre-champ'), 'submitEditing');
    await waitFor(() => expect(f.modifier).toHaveBeenCalledWith('t1', 's1', { titre: 'Exec B rapide' }));
    await waitFor(() => expect(screen.getByTestId('esport-editeur-titre').props.children).toBe('Exec B rapide'));
  });
});

describe('clavier', () => {
  it('Échap ferme d’abord ce qui est ouvert (menu, sélection, tiroir, outil) et ne quitte jamais l’atelier', async () => {
    const onRetour = jest.fn();
    await ouvrir(documentDe(pion('a', 100, 100)), { onRetour });
    await touche('c');
    expect(canevas().outil).toBe('capacite');
    await clicDroit(['a'], { x: 100, y: 100 });
    expect(screen.getByTestId('esport-menu-contextuel')).toBeTruthy();
    const e1 = await touche('Escape');
    expect(e1.preventDefault).toHaveBeenCalled();
    expect(e1.stopPropagation).toHaveBeenCalled();
    expect(screen.queryByTestId('esport-menu-contextuel')).toBeNull();
    expect(canevas().selection).toEqual(['a']);
    await touche('Escape');
    expect(canevas().selection).toEqual([]);
    expect(screen.queryByTestId('esport-atelier-tiroir')).toBeNull();
    expect(canevas().outil).toBe('capacite');
    await touche('Escape');
    expect(canevas().outil).toBe('selection');
    // Plus rien à fermer : Échap reste sans effet, et n'atteint pas le reste de l'app.
    const dernier = await touche('Escape');
    expect(dernier.stopPropagation).toHaveBeenCalled();
    expect(onRetour).not.toHaveBeenCalled();
  });

  it('raccourcis : outils, Suppr, Ctrl+Z / Ctrl+Maj+Z, Ctrl+A, Ctrl+D, zoom (+, -, 0), aide (?)', async () => {
    await ouvrir(documentDe(pion('a', 100, 100), pion('b', 300, 140, 1)));
    await touche('f');
    expect(canevas().outil).toBe('fleche');
    await touche('v');
    expect(canevas().outil).toBe('selection');
    await touche('a', { ctrlKey: true });
    expect(canevas().selection).toEqual(['a', 'b']);
    await touche('Delete');
    expect(objets()).toEqual([]);
    await touche('z', { ctrlKey: true });
    expect(objets()).toHaveLength(2);
    await touche('z', { ctrlKey: true, shiftKey: true });
    expect(objets()).toEqual([]);
    await touche('z', { ctrlKey: true });
    await depuisCanevas(p => p.onSelection(['a']));
    await touche('d', { ctrlKey: true });
    expect(objets()).toHaveLength(3);
    await touche('+');
    expect(canevas().vue.echelle).toBeGreaterThan(1);
    await touche('0');
    expect(canevas().vue).toEqual({ echelle: 1, x: 0, y: 0 });
    await touche('?');
    expect(screen.getByTestId('esport-editeur-raccourcis')).toBeTruthy();
    await touche('Escape');
    expect(screen.queryByTestId('esport-editeur-raccourcis')).toBeNull();
  });

  it('dans un champ de saisie, les lettres ne changent pas d’outil', async () => {
    await ouvrir(documentDe());
    await touche('f', { target: { tagName: 'INPUT' } });
    expect(canevas().outil).toBe('selection');
  });
});

describe('téléphone et présentation', () => {
  it('téléphone (390 px) : lecture d’abord ; « Modifier » ouvre les outils en bande', async () => {
    mockFenetre = { width: 390, height: 844, scale: 3, fontScale: 1 };
    await ouvrir(documentDe(pion('a', 100, 100)));
    expect(canevas().outil).toBe('main');
    expect(screen.queryByTestId('esport-atelier-rail')).toBeNull();
    expect(canevas().largeur).toBe(390);
    expect(((canevas().largeur as number) * (canevas().hauteur as number)) / (390 * 844)).toBeGreaterThanOrEqual(0.6);
    await fireEvent.press(screen.getByTestId('esport-atelier-mode-edition'));
    expect(screen.getByTestId('esport-atelier-rail')).toBeTruthy();
    expect(canevas().outil).toBe('selection');
    // Une sélection : le tiroir s'ouvre en feuille basse.
    await depuisCanevas(p => p.onSelection(['a']));
    expect(screen.getByTestId('esport-atelier-tiroir')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-atelier-mode-edition'));
    expect(canevas().outil).toBe('main');
  });

  it('présentation : titre et note de l’étape, étape suivante, « mon rôle » met un joueur en avant, laser', async () => {
    let d = documentDe(pion('a', 100, 100));
    d = appliquer(d, { type: 'titreEtape', etape: 0, titre: 'Prise du site' });
    d = appliquer(d, { type: 'noteEtape', etape: 0, note: 'On attend le flash.' });
    d = appliquer(d, { type: 'ajouterEtape', apres: 0 });
    await ouvrir(d);
    await fireEvent.press(screen.getByTestId('esport-editeur-presentation'));
    expect(screen.getByTestId('esport-presentation')).toBeTruthy();
    expect(screen.queryByTestId('esport-atelier-rail')).toBeNull();
    expect(JSON.stringify(screen.getByTestId('esport-presentation-titre').props.children)).toContain('Prise du site');
    expect(canevas().lectureSeule || canevas().outil === 'main').toBe(true);
    await fireEvent.press(screen.getByTestId('esport-presentation-joueur-0'));
    expect(canevas().surligne).toBe(0);
    await fireEvent.press(screen.getByTestId('esport-presentation-laser'));
    expect(canevas().laser).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-presentation-suivante'));
    expect(canevas().etape).toBe(1);
    await touche('ArrowLeft');
    expect(canevas().etape).toBe(0);
    await touche('Escape');
    expect(screen.queryByTestId('esport-presentation')).toBeNull();
    expect(canevas().surligne).toBeNull();
  });
});
