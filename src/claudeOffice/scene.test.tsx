import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import { OngletBureau } from './Bureau';
import { couleurAgent, deduireBureau, type Agent, type EtatAgent } from './logiqueBureau';
import { entreeValide, type EntreeHistorique } from './logiqueHistorique';
import {
  ATTENTE_MAX, DUREE_FETE, NB_POSTES, POSTES, SEUIL_COLLISION, VOIES, activiteAgent, apparence, attribuerPostes, avancer, cheminArrivee, cheminDepart,
  choisirPoste, creerScene, distanceMinimale, entreesDemo, genreOutil, hacher, longueur, planifier, poses, reconcilier, vueDepuis, type EtatScene,
} from './logiqueScene';
import type { PropsScene } from './sceneTypes';

// La scène SVG du web (Jest résout sinon la version native).
const { SceneOpenSpace: SceneWeb } = require('./SceneOpenSpace.web') as { SceneOpenSpace: (p: PropsScene) => React.ReactElement };

const T0 = Date.parse('2026-10-07T10:00:00Z');
const agent = (cle: string, etat: EtatAgent = 'ecrit', extra: Partial<Agent> = {}): Agent => ({
  cle, session: cle, projet: 'budget', appareil: 'PC', etat, dernier: T0, debut: T0, demandes: 1, outils: 1, sousAgents: 0, echecs: 0, fige: false, reference: T0,
  demande: `Demande de ${cle}`, ...extra,
});
const cles = (n: number, prefixe = 'pc|s') => Array.from({ length: n }, (_, i) => `${prefixe}${i}`);

describe('scène : affectation des postes', () => {
  it('déterministe par identifiant, indépendante de l’ordre, stable pour ceux déjà placés', () => {
    const a = attribuerPostes(cles(8));
    const b = attribuerPostes([...cles(8)].reverse());
    expect([...a].sort()).toEqual([...b].sort());
    expect(new Set(a.values()).size).toBe(8);
    expect(choisirPoste('pc|x', new Set())).toBe(hacher('pc|x') % NB_POSTES);
    // Le poste voulu est pris : le suivant libre.
    const voulu = hacher('pc|x') % NB_POSTES;
    expect(choisirPoste('pc|x', new Set([voulu]))).toBe((voulu + 1) % NB_POSTES);
    // Déjà placés : on ne les bouge pas.
    const deja = new Map([['pc|s0', 11]]);
    expect(attribuerPostes(cles(3), deja).get('pc|s0')).toBe(11);
    // Plein : plus de poste.
    const plein = attribuerPostes(cles(NB_POSTES + 2));
    expect(plein.size).toBe(NB_POSTES);
    expect(choisirPoste('pc|y', new Set(plein.values()))).toBeUndefined();
  });

  it('douze postes en trois îlots, chemins de la porte au siège et retour', () => {
    expect(POSTES).toHaveLength(12);
    for (const p of POSTES) {
      const aller = cheminArrivee(p);
      const retour = cheminDepart(p);
      expect(aller[0].y).toBe(VOIES.dehors);
      expect(aller[aller.length - 1]).toEqual(p.siege);
      expect(retour[0]).toEqual(p.siege);
      expect(retour[retour.length - 1].y).toBe(VOIES.dehors);
      expect(longueur(aller)).toBeGreaterThan(5);
    }
  });
});

describe('scène : trajets sans collision', () => {
  function verifier(s: EtatScene) {
    expect(distanceMinimale(s.trajets)).toBeGreaterThanOrEqual(SEUIL_COLLISION - 0.08);
  }

  it('douze arrivées en même temps : file à l’entrée, aucun croisement trop proche', () => {
    const s = creerScene();
    reconcilier(s, [], 0, { anime: true });
    reconcilier(s, cles(12).map(c => agent(c)), 1, { anime: true });
    expect(s.trajets).toHaveLength(12);
    verifier(s);
    // Tous partent un jour, l'un après l'autre.
    const departs = s.trajets.map(t => t.debut).sort((a, b) => a - b);
    expect(departs[departs.length - 1]).toBeLessThan(1 + ATTENTE_MAX);
    expect(new Set(departs).size).toBe(12);
    expect(poses(s, 1).length).toBeLessThan(12); // les autres attendent dehors
  });

  it('arrivées et départs croisés : toujours la distance minimale', () => {
    const s = creerScene();
    reconcilier(s, cles(6, 'pc|a').map(c => agent(c)), 0, { anime: true });
    // Six repartent (fin de session), six autres arrivent au même moment.
    const liste = [...cles(6, 'pc|a').map(c => agent(c, 'termine')), ...cles(6, 'pc|b').map(c => agent(c))];
    reconcilier(s, liste, 5, { anime: true });
    for (let t = 5; t < 5 + DUREE_FETE + 1; t += 0.5) avancer(s, t);
    expect([...s.occupants.values()].filter(o => o.phase === 'depart')).toHaveLength(6);
    verifier(s);
  });

  it('planifier attend son tour plutôt que de foncer dans un autre marcheur', () => {
    const p = POSTES[0];
    const a = planifier([], 'a', cheminArrivee(p), 0);
    const b = planifier([a], 'b', cheminArrivee(p), 0);
    expect(a.debut).toBe(0);
    expect(b.debut).toBeGreaterThan(0);
    expect(distanceMinimale([a, b])).toBeGreaterThanOrEqual(SEUIL_COLLISION - 0.08);
  });
});

describe('scène : transitions d’état', () => {
  it('déjà là à l’ouverture : assis d’emblée ; terminés : bureau rangé', () => {
    const s = creerScene();
    reconcilier(s, [agent('pc|a'), agent('pc|b', 'termine')], 0, { anime: true });
    expect(s.occupants.get('pc|a')?.phase).toBe('assis');
    expect(s.occupants.get('pc|b')?.phase).toBe('parti');
    expect(s.trajets).toHaveLength(0);
  });

  it('arrive, s’assoit, fête la fin, range, repart, puis libère le poste', () => {
    const s = creerScene();
    reconcilier(s, [], 0, { anime: true });
    reconcilier(s, [agent('pc|n')], 1, { anime: true });
    const o = s.occupants.get('pc|n')!;
    expect(o.phase).toBe('arrivee');
    const marche = poses(s, 2)[0];
    expect(marche.mode).toBe('marche');
    avancer(s, 1 + o.trajet!.duree + 0.01);
    expect(o.phase).toBe('assis');
    expect(poses(s, 30)[0]).toMatchObject({ mode: 'assis', x: POSTES[o.poste].siege.x });
    reconcilier(s, [agent('pc|n', 'termine')], 40, { anime: true });
    expect(o.phase).toBe('fete');
    expect(poses(s, 40.5)[0].mode).toBe('fete');
    avancer(s, 40 + DUREE_FETE + 0.01);
    expect(o.phase).toBe('depart');
    avancer(s, 40 + DUREE_FETE + o.trajet!.duree + 0.1);
    expect(o.phase).toBe('parti');
    expect(poses(s, 60)).toHaveLength(0);
    // Quitte la liste : poste libéré.
    reconcilier(s, [], 70, { anime: true });
    expect(s.occupants.size).toBe(0);
  });

  it('retiré de la liste en plein travail : repart sans fête ; « réduire les animations » : tout est immédiat', () => {
    const s = creerScene();
    reconcilier(s, [agent('pc|x')], 0, { anime: true });
    reconcilier(s, [], 10, { anime: true });
    expect(s.occupants.get('pc|x')?.phase).toBe('depart');
    avancer(s, 30);
    expect(s.occupants.size).toBe(0);

    const r = creerScene();
    reconcilier(r, [], 0, { anime: false });
    reconcilier(r, [agent('pc|y')], 1, { anime: false });
    expect(r.occupants.get('pc|y')?.phase).toBe('assis');
    reconcilier(r, [agent('pc|y', 'termine')], 2, { anime: false });
    expect(r.occupants.get('pc|y')?.phase).toBe('parti');
    reconcilier(r, [], 3, { anime: false });
    expect(r.occupants.size).toBe(0);
    expect(r.trajets).toHaveLength(0);
  });

  it('vues : de face vers le bas, de dos vers la porte ; rangée du fond face à nous', () => {
    expect(vueDepuis({ x: 1, y: 0 })).toEqual({ vue: 'face', miroir: false });
    expect(vueDepuis({ x: 0, y: 1 })).toEqual({ vue: 'face', miroir: true });
    expect(vueDepuis({ x: 0, y: -1 })).toEqual({ vue: 'dos', miroir: false });
    expect(vueDepuis({ x: -1, y: 0 })).toEqual({ vue: 'dos', miroir: true });
    const s = creerScene();
    reconcilier(s, cles(12).map(c => agent(c)), 0, { anime: true });
    for (const p of poses(s, 0)) expect(p.vue).toBe(POSTES[p.poste].rangee === 0 ? 'face' : 'dos');
  });
});

describe('scène : apparence et gadgets', () => {
  it('apparence stable par session, haut à la couleur du projet, variée', () => {
    const a = apparence(agent('pc|1', 'ecrit', { session: 'abc', projet: 'tsuzuku' }));
    expect(apparence(agent('pc|1', 'ecrit', { session: 'abc', projet: 'tsuzuku' }))).toEqual(a);
    expect(a.haut).toBe(couleurAgent('tsuzuku'));
    const visages = new Set(cles(12).map(c => { const x = apparence(agent(c, 'ecrit', { session: c })); return `${x.peau}${x.cheveux}${x.coupe}${x.accessoire}`; }));
    expect(visages.size).toBeGreaterThanOrEqual(10);
  });

  it('gadget selon l’outil', () => {
    expect(genreOutil('Bash')).toBe('terminal');
    expect(genreOutil('Grep')).toBe('recherche');
    expect(genreOutil('Glob')).toBe('recherche');
    expect(genreOutil('Read')).toBe('lecture');
    expect(genreOutil('WebFetch')).toBe('web');
    expect(genreOutil('WebSearch')).toBe('web');
    expect(genreOutil('Task')).toBe('agent');
    expect(genreOutil('Edit')).toBe('code');
    expect(genreOutil('mcp__inconnu')).toBe('outil');
    expect(activiteAgent({ etat: 'outil', outil: 'Bash' })).toBe('terminal');
    expect(activiteAgent({ etat: 'ecrit', outil: 'Edit' })).toBe('code');
    expect(activiteAgent({ etat: 'reflechit' })).toBe('pense');
    expect(activiteAgent({ etat: 'inactif' })).toBe('pause');
    expect(activiteAgent({ etat: 'termine' })).toBe('fini');
  });
});

describe('scène : démo', () => {
  it('sessions fictives valides qui arrivent, varient, terminent et repartent', () => {
    expect(entreesDemo(T0, T0)).toEqual([]);
    const etats = new Set<string>();
    let maxAgents = 0;
    let termines = 0;
    for (let s = 0; s <= 240; s += 1) {
      const e = entreesDemo(T0, T0 + s * 1000);
      expect(e.every(entreeValide)).toBe(true);
      const b = deduireBureau(e, { maintenant: T0 + s * 1000 });
      for (const a of b.agents) etats.add(activiteAgent(a));
      termines += b.agents.filter(a => a.etat === 'termine').length ? 1 : 0;
      maxAgents = Math.max(maxAgents, b.agents.length);
      expect(e.length).toBeLessThan(200);
    }
    expect(maxAgents).toBeGreaterThanOrEqual(6);
    expect(maxAgents).toBeLessThanOrEqual(NB_POSTES);
    expect(termines).toBeGreaterThan(0);
    for (const a of ['code', 'terminal', 'recherche', 'lecture', 'web', 'agent', 'pense', 'pause', 'fini']) expect(etats).toContain(a);
    expect(entreesDemo(T0, T0 + 60_000).every(e => e.appareil === 'PC de démo')).toBe(true);
  });
});

// ------------------------------------------------------------------ rendu de la scène SVG (web)

function journal(): EntreeHistorique[] {
  const ts = (s: number) => new Date(T0 - s * 1000).toISOString();
  return [
    { v: 1, id: 'a1', ts: ts(60), type: 'demande', session: 'sess-a', appareilId: 'aaaa', projet: 'budget', texte: 'Ajoute un export, mon token ghp_abcdefghijklmnopqrstuvwxyz0123456789' },
    { v: 1, id: 'a2', ts: ts(5), type: 'outil', session: 'sess-a', appareilId: 'aaaa', projet: 'budget', outil: 'Bash', resume: 'npm test' },
    { v: 1, id: 'b1', ts: ts(30), type: 'demande', session: 'sess-b', appareilId: 'aaaa', projet: 'hub', texte: 'Pourquoi ?' },
  ];
}

describe('scène : rendu SVG', () => {
  const props = (extra: Partial<PropsScene> = {}): PropsScene => ({
    agents: deduireBureau(journal(), { maintenant: T0 }).agents, theme: themeHub('nuit'), reduit: true, largeur: 800, onChoisir: () => undefined, maintenant: T0, horloge: () => 0, ...extra,
  });
  // Rendu HTML réel (react-dom) : la scène est faite d'éléments SVG du DOM.
  const { renderToStaticMarkup } = require('react-dom/server') as { renderToStaticMarkup(e: React.ReactElement): string };
  const html = (p: PropsScene) => renderToStaticMarkup(<SceneWeb {...p} />);

  it('états, bulle masquée, réduit = scène fixe, thèmes jour et nuit', () => {
    const nuit = html(props());
    expect(nuit).toContain('data-testid="scene-fixe"');
    expect(nuit).toContain('aria-hidden="true"');
    expect(nuit).toContain('class="co-scene co-fixe"');
    expect(nuit).toContain('budget');
    expect(nuit).not.toContain('ghp_abcdef');
    expect(nuit).toContain('#2B3150'); // murs de nuit
    expect(nuit).toContain('class="co-m-assis co-a-terminal"');
    expect(nuit).toContain('class="co-m-assis co-a-pense"');
    const jour = html(props({ theme: themeHub('ivoire'), reduit: false }));
    expect(jour).toContain('data-testid="scene-animee"');
    expect(jour).toContain('prefers-reduced-motion');
    expect(jour).toContain('#F5F0E6'); // murs de jour
    expect(jour).toContain('class="co-scene"');
  });

  it('vide, démo étiquetée, bulle de l’agent choisi, figé grisé', () => {
    const vide = html(props({ agents: [], demo: true }));
    expect(vide).toContain('scene-demo');
    expect(vide).toContain('DÉMO');
    expect(vide).not.toContain('class="co-m-');
    expect(html(props({ choisi: 'aaaa|sess-b' }))).toContain('Pourquoi ?');
    const fige = deduireBureau(journal(), { maintenant: T0 + 30 * 60_000, references: { aaaa: T0 } }).agents;
    expect(fige.every(a => a.fige)).toBe(true);
    expect(html(props({ agents: fige }))).toContain('opacity="0.7"');
  });
});

// ------------------------------------------------------------------ démo dans l'onglet

describe('onglet Bureau : mode démo', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }));
  afterEach(() => jest.useRealTimers());

  it('activable depuis l’écran, clairement étiqueté, réversible, sans rien lire ni écrire de réel', async () => {
    const fetchEspion = jest.spyOn(globalThis, 'fetch' as never).mockImplementation((() => Promise.reject(new Error('réseau interdit'))) as never);
    let maintenant = T0;
    await render(<OngletBureau theme={themeHub('nuit')} contexte={{}} mouvementReduit horloge={() => maintenant} />);
    await act(async () => undefined);
    expect(screen.getByTestId('bureau-vide')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('bureau-demo'));
    expect(screen.getByTestId('bureau-fraicheur')).toBeTruthy();
    expect(screen.getByText(/Démo · sessions fictives/)).toBeTruthy();
    maintenant = T0 + 30_000;
    await act(async () => void jest.advanceTimersByTime(1_000));
    expect(screen.getAllByTestId('bureau-etat-agent').length).toBeGreaterThanOrEqual(5);
    expect(screen.getByText(/Agents de la démo/)).toBeTruthy();
    // Liste accessible : bouton, état, projet, dernière demande.
    const ligne = screen.getAllByRole('button').find(b => /Dernière demande/.test(b.props.accessibilityLabel ?? ''));
    expect(ligne?.props.accessibilityLabel).toMatch(/^[a-z-]+, PC de démo : .+\. Dernière demande : /);
    await fireEvent.press(screen.getByTestId('bureau-demo'));
    expect(screen.queryByText(/Démo · sessions fictives/)).toBeNull();
    expect(screen.getByTestId('bureau-vide')).toBeTruthy();
    expect(fetchEspion).not.toHaveBeenCalled();
    fetchEspion.mockRestore();
  });
});

describe('liste des agents : contrastes', () => {
  // Rapport de contraste WCAG entre deux couleurs #RRGGBB.
  const lum = (hex: string) => {
    const c = [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contraste = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  it('chaque teinte d’état reste lisible sur la surface des huit thèmes', () => {
    const { teinteLisible } = require('./Bureau') as typeof import('./Bureau');
    const { TEINTES_ACTIVITE } = require('./logiqueScene') as typeof import('./logiqueScene');
    const { THEMES_HUB } = require('../hub/themes') as typeof import('../hub/themes');
    for (const t of THEMES_HUB) {
      for (const c of Object.values(TEINTES_ACTIVITE)) expect(contraste(teinteLisible(c, t.sombre), t.surface)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
