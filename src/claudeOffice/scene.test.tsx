import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import { OngletBureau } from './Bureau';
import { couleurAgent, deduireBureau, type Agent, type EtatAgent } from './logiqueBureau';
import { entreeValide, type EntreeHistorique } from './logiqueHistorique';
import {
  ATTENTE_MAX, DUREE_FETE, NB_PLACES, PLACES, RECTS_ZONES, SEJOUR_MIN, SEUIL_COLLISION, DEHORS, activiteAgent, apparence, avancer, changementDu, chemin, cheminArrivee,
  cheminDepart, choisirPlace, comptesZones, creerScene, distanceMinimale, entreesDemo, genreOutil, hacher, itineraire, longueur, placesDe, planifier, poses,
  prochaineEcheance, reconcilier, surLesVoies, vueDepuis, type EtatScene,
} from './logiqueScene';
import { ORDRE_ZONES, type Zone } from './zones';
import type { PropsScene } from './sceneTypes';

// La scène SVG du web (Jest résout sinon la version native).
const { SceneOpenSpace: SceneWeb } = require('./SceneOpenSpace.web') as { SceneOpenSpace: (p: PropsScene) => React.ReactElement };

const T0 = Date.parse('2026-10-07T10:00:00Z');
const agent = (cle: string, etat: EtatAgent = 'ecrit', extra: Partial<Agent> = {}): Agent => ({
  cle, session: cle, projet: 'budget', appareil: 'PC', etat, dernier: T0, debut: T0, demandes: 1, outils: 1, sousAgents: 0, echecs: 0, fige: false, reference: T0,
  demande: `Demande de ${cle}`, zone: etat === 'ecrit' ? 'atelier' : etat === 'attend' ? 'guichet' : etat === 'termine' ? 'salle' : 'reflexion', salle: false, ...extra,
});
const cles = (n: number, prefixe = 'pc|s') => Array.from({ length: n }, (_, i) => `${prefixe}${i}`);
const dans = (p: { x: number; y: number }, z: Zone) => { const r = RECTS_ZONES[z]; return p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1; };

describe('scène : plan en zones et places', () => {
  it('chaque zone a ses places, toutes dans son emprise, sans doublon ; assez pour douze agents dans l’atelier', () => {
    for (const z of ORDRE_ZONES) {
      expect(placesDe(z).length).toBeGreaterThanOrEqual(3);
      for (const p of placesDe(z)) expect(dans(p.pos, z)).toBe(true);
    }
    expect(placesDe('atelier')).toHaveLength(8);
    expect(placesDe('salle').length).toBeGreaterThanOrEqual(5);
    expect(new Set(PLACES.map(p => `${p.pos.x},${p.pos.y}`)).size).toBe(NB_PLACES);
    // Places espacées : deux personnages ne se chevauchent pas.
    for (const a of PLACES) for (const b of PLACES) if (a !== b) expect(Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y)).toBeGreaterThan(0.5);
  });

  it('place déterministe par identifiant dans sa zone, puis la suivante libre ; rien si la zone est pleine', () => {
    const voulue = choisirPlace('pc|x', 'atelier', new Set())!;
    expect(PLACES[voulue].zone).toBe('atelier');
    expect(choisirPlace('pc|x', 'atelier', new Set())).toBe(voulue);
    const autre = choisirPlace('pc|x', 'atelier', new Set([voulue]))!;
    expect(autre).not.toBe(voulue);
    expect(PLACES[autre].zone).toBe('atelier');
    expect(choisirPlace('pc|x', 'guichet', new Set(placesDe('guichet').map(p => p.index)))).toBeUndefined();
    expect(hacher('pc|x')).toBe(hacher('pc|x'));
  });

  it('itinéraires par les couloirs, sur la voie de droite selon le sens ; de la porte à chaque place et retour', () => {
    expect(itineraire({ c: 'H1', v: 6 }, { c: 'H2', v: 8 })).toEqual([{ x: 6, y: 5 }, { x: 4.7, y: 5 }, { x: 4.7, y: 10.4 }, { x: 8, y: 10.4 }]);
    // Aller vers la droite et revenir : deux voies distinctes.
    const aller = surLesVoies([{ x: 6, y: 5 }, { x: 12, y: 5 }]);
    const retour = surLesVoies([{ x: 12, y: 5 }, { x: 6, y: 5 }]);
    expect(Math.abs(aller[0].y - retour[0].y)).toBeCloseTo(0.6);
    for (const p of PLACES) {
      const a = cheminArrivee(p);
      const d = cheminDepart(p);
      expect(a[0].y).toBeCloseTo(DEHORS);
      expect(a[a.length - 1]).toEqual(p.pos);
      expect(d[0]).toEqual(p.pos);
      expect(d[d.length - 1].y).toBeCloseTo(DEHORS);
      // Segments horizontaux ou verticaux seulement (on suit les couloirs).
      for (let i = 1; i < a.length; i++) expect(Math.abs(a[i].x - a[i - 1].x) < 1e-6 || Math.abs(a[i].y - a[i - 1].y) < 1e-6).toBe(true);
      expect(longueur(a)).toBeGreaterThan(2);
    }
    const p = placesDe('bibliotheque')[0];
    const q = placesDe('salle')[0];
    const c = chemin(p, q);
    expect(c[0]).toEqual(p.pos);
    expect(c[c.length - 1]).toEqual(q.pos);
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
    const departs = s.trajets.map(t => t.debut).sort((a, b) => a - b);
    expect(departs[departs.length - 1]).toBeLessThan(1 + ATTENTE_MAX);
    expect(poses(s, 1).length).toBeLessThan(12);
    // Débordement : 12 agents voulant l'atelier (8 places) → les autres en zones de repli, sans place partagée.
    expect(new Set([...s.occupants.values()].map(o => o.place)).size).toBe(12);
  });

  it('changements de zone croisés : toujours la distance minimale', () => {
    const s = creerScene();
    reconcilier(s, cles(6, 'pc|a').map(c => agent(c)), 0, { anime: true });
    const liste = [...cles(6, 'pc|a').map(c => agent(c, 'outil', { zone: 'bibliotheque' })), ...cles(4, 'pc|b').map(c => agent(c))];
    reconcilier(s, liste, SEJOUR_MIN + 1, { anime: true });
    verifier(s);
  });

  it('planifier attend son tour plutôt que de foncer dans un autre marcheur', () => {
    const p = PLACES[0];
    const a = planifier([], 'a', cheminArrivee(p), 0);
    const b = planifier([a], 'b', cheminArrivee(p), 0);
    expect(a.debut).toBe(0);
    expect(b.debut).toBeGreaterThan(0);
    expect(distanceMinimale([a, b])).toBeGreaterThanOrEqual(SEUIL_COLLISION - 0.08);
  });
});

describe('scène : zones, hystérésis, salle d’attente', () => {
  it('déjà là à l’ouverture : chacun d’emblée dans sa zone ; sessions fermées et vues : pas dessinées', () => {
    const s = creerScene();
    reconcilier(s, [agent('pc|a'), agent('pc|b', 'outil', { zone: 'machines' }), agent('pc|c', 'termine', { salle: false })], 0, { anime: true });
    expect(PLACES[s.occupants.get('pc|a')!.place].zone).toBe('atelier');
    expect(PLACES[s.occupants.get('pc|b')!.place].zone).toBe('machines');
    expect(s.occupants.has('pc|c')).toBe(false);
    expect(s.trajets).toHaveLength(0);
  });

  it('hystérésis : il reste au moins le séjour minimal dans une zone, sauf vers le guichet ou la salle d’attente', () => {
    expect(changementDu({ voulue: 'atelier', depuisZone: 0 }, SEJOUR_MIN - 1)).toBe(false);
    expect(changementDu({ voulue: 'atelier', depuisZone: 0 }, SEJOUR_MIN)).toBe(true);
    expect(changementDu({ voulue: 'guichet', depuisZone: 0 }, 1)).toBe(true);
    const s = creerScene();
    reconcilier(s, [agent('pc|a', 'outil', { zone: 'bibliotheque' })], 0, { anime: true });
    const o = s.occupants.get('pc|a')!;
    // Rafale d'outils : la zone voulue change vite, il ne bouge pas avant le séjour minimal.
    reconcilier(s, [agent('pc|a', 'ecrit', { zone: 'atelier' })], 3, { anime: true });
    expect(o.phase).toBe('assis');
    expect(PLACES[o.place].zone).toBe('bibliotheque');
    expect(prochaineEcheance(s)).toBe(SEJOUR_MIN);
    avancer(s, SEJOUR_MIN + 0.1);
    expect(o.phase).toBe('marche');
    expect(PLACES[o.place].zone).toBe('atelier');
    // Arrivé : il ne repart pas tout de suite, même si on le rappelle à la bibliothèque.
    avancer(s, SEJOUR_MIN + 0.1 + o.trajet!.duree + o.trajet!.debut - (SEJOUR_MIN + 0.1) + 0.05);
    expect(o.phase).toBe('assis');
    reconcilier(s, [agent('pc|a', 'outil', { zone: 'bibliotheque' })], o.depuisZone + 2, { anime: true });
    expect(o.phase).toBe('assis');
    // Attend ta réponse : direct au guichet.
    reconcilier(s, [agent('pc|a', 'attend', { zone: 'guichet' })], o.depuisZone + 3, { anime: true });
    expect(o.phase).toBe('marche');
    expect(PLACES[o.place].zone).toBe('guichet');
  });

  it('fin de tâche : fête, salle d’attente, puis départ avec le carton une fois vue (ou retour en détente)', () => {
    const s = creerScene();
    reconcilier(s, [agent('pc|f')], 0, { anime: true });
    const o = s.occupants.get('pc|f')!;
    // Session terminée, à voir : petite fête puis salle d'attente.
    reconcilier(s, [agent('pc|f', 'termine', { zone: 'salle', salle: true })], 20, { anime: true });
    expect(o.phase).toBe('fete');
    avancer(s, 20 + DUREE_FETE + 0.01);
    expect(o.phase).toBe('marche');
    expect(PLACES[o.place].zone).toBe('salle');
    avancer(s, o.trajet!.debut + o.trajet!.duree + 0.01);
    expect(o.phase).toBe('assis');
    expect(comptesZones(s).presents.salle).toBe(1);
    expect(poses(s, 60)[0]).toMatchObject({ zone: 'salle', mode: 'assis' });
    // « Marquer comme vu » (ou délai écoulé) : il repart vers la porte, sans nouvelle fête.
    reconcilier(s, [agent('pc|f', 'termine', { zone: 'salle', salle: false })], 80, { anime: true });
    expect(o.phase).toBe('depart');
    expect(o.partir).toBe(true);
    avancer(s, o.trajet!.debut + o.trajet!.duree + 0.1);
    expect(o.phase).toBe('parti');
    expect(poses(s, 200)).toHaveLength(0);
    reconcilier(s, [], 210, { anime: true });
    expect(s.occupants.size).toBe(0);
  });

  it('salle d’attente pleine : les autres restent à leur place, comptés « sans place », sans chevauchement', () => {
    const s = creerScene();
    const n = placesDe('salle').length + 2;
    reconcilier(s, cles(n, 'pc|z').map(c => agent(c)), 0, { anime: true });
    reconcilier(s, cles(n, 'pc|z').map(c => agent(c, 'inactif', { zone: 'salle', salle: true })), 1, { anime: false });
    const places = [...s.occupants.values()].map(o => o.place);
    expect(new Set(places).size).toBe(n);
    expect(comptesZones(s).presents.salle).toBe(placesDe('salle').length);
    expect(comptesZones(s).sansPlace.salle).toBe(2);
  });

  it('« réduire les animations » : personne ne marche, changements instantanés (fondu)', () => {
    const r = creerScene();
    reconcilier(r, [], 0, { anime: false });
    reconcilier(r, [agent('pc|y')], 1, { anime: false });
    const o = r.occupants.get('pc|y')!;
    expect(o.phase).toBe('assis');
    reconcilier(r, [agent('pc|y', 'attend', { zone: 'guichet' })], 2, { anime: false });
    expect(o.phase).toBe('assis');
    expect(PLACES[o.place].zone).toBe('guichet');
    expect(o.teleporte).toBe(2);
    reconcilier(r, [], 3, { anime: false });
    expect(r.occupants.size).toBe(0);
    expect(r.trajets).toHaveLength(0);
  });

  it('vues : de face vers le bas, de dos vers le fond', () => {
    expect(vueDepuis({ x: 1, y: 0 })).toEqual({ vue: 'face', miroir: false });
    expect(vueDepuis({ x: 0, y: 1 })).toEqual({ vue: 'face', miroir: true });
    expect(vueDepuis({ x: 0, y: -1 })).toEqual({ vue: 'dos', miroir: false });
    expect(vueDepuis({ x: -1, y: 0 })).toEqual({ vue: 'dos', miroir: true });
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
    expect(activiteAgent({ etat: 'attend' })).toBe('attend');
    expect(activiteAgent({ etat: 'reflechit' })).toBe('pense');
    expect(activiteAgent({ etat: 'inactif' })).toBe('pause');
    expect(activiteAgent({ etat: 'inactif', salle: true })).toBe('fini');
    expect(activiteAgent({ etat: 'termine' })).toBe('fini');
  });
});

describe('scène : démo', () => {
  it('sessions fictives valides qui passent par toutes les zones, attendent au guichet et en salle d’attente', () => {
    const zones = new Set<string>();
    let maxAgents = 0;
    let salleMin = Infinity;
    let attentes = 0;
    for (let s = 0; s <= 300; s += 2) {
      const e = entreesDemo(T0, T0 + s * 1000);
      expect(e.every(entreeValide)).toBe(true);
      const b = deduireBureau(e, { maintenant: T0 + s * 1000 });
      for (const a of b.agents) zones.add(a.zone);
      salleMin = Math.min(salleMin, b.agents.filter(a => a.salle).length);
      attentes += b.agents.some(a => a.etat === 'attend') ? 1 : 0;
      maxAgents = Math.max(maxAgents, b.agents.length);
      expect(e.length).toBeLessThan(400);
    }
    for (const z of ORDRE_ZONES) expect(zones).toContain(z);
    expect(salleMin).toBeGreaterThanOrEqual(2);
    expect(attentes).toBeGreaterThan(0);
    expect(maxAgents).toBeLessThanOrEqual(12);
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
    expect(nuit).toMatch(/class="co-m-(assis|debout) co-a-terminal/);
    expect(nuit).toMatch(/class="co-m-(assis|debout) co-a-pense/);
    // Les zones et leur enseigne, avec le nombre d'agents présents.
    expect(nuit).toContain('data-testid="scene-zone-machines" data-nombre="1"');
    expect(nuit).toContain('data-testid="scene-zone-reflexion" data-nombre="1"');
    expect(nuit).toContain('Salle des machines');
    expect(nuit).toContain('data-zone="machines"');
    const jour = html(props({ theme: themeHub('ivoire'), reduit: false }));
    expect(jour).toContain('data-testid="scene-animee"');
    expect(jour).toContain('prefers-reduced-motion');
    expect(jour).toContain('#F5F0E6'); // murs de jour
    expect(jour).toContain('class="co-scene"');
  });

  it('vide, démo étiquetée, bulle de l’agent choisi, figé grisé', () => {
    // Attend ta réponse : main levée, pastille « ! », guichet allumé, bulle prioritaire.
    const attend = deduireBureau([...journal(), { v: 1, id: 'a3', ts: new Date(T0 - 2000).toISOString(), type: 'attente', session: 'sess-a', appareilId: 'aaaa', projet: 'budget', outil: 'Bash', resume: 'Autoriser Bash (git push) ?', motif: 'permission' }], { maintenant: T0 }).agents;
    const h = html(props({ agents: attend, reduit: false }));
    expect(h).toContain('data-testid="scene-attend"');
    expect(h).toContain('co-p-main');
    expect(h).toContain('data-zone="guichet"');
    expect(h).toContain('co-gyro');
    expect(h).toContain('attend ta réponse');
    expect(h).toContain('Autoriser Bash');
    // Estompés (filtre par projet) : presque transparents.
    expect(html(props({ estompes: new Set(['aaaa|sess-b']) }))).toContain('opacity="0.22"');
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
    expect(ligne?.props.accessibilityLabel).toMatch(/^[a-z-]+, PC de démo, [^:]+ : .+\. Dernière demande : .+Ouvrir le détail$/);
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
