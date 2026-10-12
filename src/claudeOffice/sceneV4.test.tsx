/**
 * Claude Office v4 (scène) : caméra (zoom et panoramique bornés, vue de départ,
 * cadrage d'une zone, inertie, suivi), placement des cartes de survol sans
 * sortie d'écran, relecture de la journée (bureau reconstruit à l'instant t),
 * rendu du plateau (cartes, plein écran, ambiance, relecture, animations
 * réduites), contrastes des commandes sur les huit thèmes, bandeau « Mise en
 * route » réductible.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { THEMES_HUB, themeHub } from '../hub/themes';
import {
  borner, bornesEchelle, cadrer, contenir, deplacer, facteurMolette, hauteurPlateau, inertie, placerCarte, rectZone, suivre, versEcran, versScene,
  vueInitiale, vueVisible, zoomerEn, type Camera, type Taille,
} from './logiqueCamera';
import { deduireBureau, type Agent } from './logiqueBureau';
import type { EntreeHistorique } from './logiqueHistorique';
import { bandeauReduit, CLE_MEMOIRE_MISE_EN_ROUTE, pointsARegler, type Etape } from './logiqueMiseEnRoute';
import { avancerRelecture, bornesJournee, bureauA, demarrerRelecture, densite, entreesAvant, trierEntrees } from './logiqueRelecture';
import { HAUTEUR_SCENE, LARGEUR_SCENE } from './logiqueScene';
import { MiseEnRoute } from './MiseEnRoute';
import type { PropsPlateau } from './plateauTypes';
import { ORDRE_ZONES } from './zones';

const T0 = Date.parse('2026-10-07T10:00:00Z');
const PC: Taille = { l: 1400, h: 690 };
const IPAD_PORTRAIT: Taille = { l: 788, h: hauteurPlateau(788, 980) };
const IPHONE: Taille = { l: 358, h: hauteurPlateau(358, 600) };

describe('caméra : zoom et panoramique bornés', () => {
  it('l’échelle reste entre la vue d’ensemble et un zoom serré ; la vue ne se perd jamais hors de l’open space', () => {
    for (const c of [PC, IPAD_PORTRAIT, IPHONE]) {
      const { min, max } = bornesEchelle(c);
      expect(min).toBeCloseTo(contenir(c));
      expect(borner({ s: 0.01, cx: 0, cy: 0 }, c).s).toBeCloseTo(min);
      expect(borner({ s: 99, cx: 0, cy: 0 }, c).s).toBeCloseTo(max);
      // Très loin à droite et en bas : ramené au bord (marge comprise).
      const loin = borner({ s: max, cx: 1e6, cy: 1e6 }, c);
      const v = vueVisible(loin, c);
      expect(v.x + v.l).toBeLessThanOrEqual(LARGEUR_SCENE + 30 + 1e-6);
      expect(v.y + v.h).toBeLessThanOrEqual(HAUTEUR_SCENE + 30 + 1e-6);
      // Vue d'ensemble : centrée.
      const ensemble = borner({ s: min, cx: 0, cy: 0 }, c);
      expect(ensemble.cx).toBeCloseTo(LARGEUR_SCENE / 2);
      // Valeurs absurdes : pas de NaN.
      expect(Number.isFinite(borner({ s: Number.NaN, cx: Number.NaN, cy: 1 }, c).cx)).toBe(true);
    }
  });

  it('zoom autour du pointeur (le point sous la souris reste en place), panoramique, molette bornée', () => {
    const c = PC;
    const cam = vueInitiale(c);
    const pointeur = { x: 900, y: 300 };
    const avant = versScene(cam, c, pointeur);
    const apres = zoomerEn(cam, 2, pointeur, c);
    expect(apres.s).toBeCloseTo(cam.s * 2);
    const ici = versEcran(apres, c, avant);
    expect(ici.x).toBeCloseTo(pointeur.x, 0);
    expect(ici.y).toBeCloseTo(pointeur.y, 0);
    // Glisser vers la droite montre ce qui est à gauche.
    const z = zoomerEn(cam, 3, { x: 700, y: 345 }, c);
    expect(deplacer(z, 100, 0, c).cx).toBeLessThan(z.cx);
    // Molette : un cran raisonnable, des valeurs folles bornées.
    expect(facteurMolette(-100)).toBeGreaterThan(1);
    expect(facteurMolette(100)).toBeLessThan(1);
    expect(facteurMolette(1e9)).toBeCloseTo(facteurMolette(240));
    expect(facteurMolette(3, 1)).toBeCloseTo(facteurMolette(48));
  });

  it('vue de départ : tout l’open space sur PC, vue rapprochée lisible et cadre rempli sur iPhone et iPad portrait', () => {
    const pc = vueInitiale(PC);
    expect(pc.s).toBeCloseTo(contenir(PC));
    const tel = vueInitiale(IPHONE);
    expect(tel.s).toBeGreaterThanOrEqual(0.7); // personnages lisibles
    expect(vueVisible(tel, IPHONE).h).toBeLessThanOrEqual(HAUTEUR_SCENE + 1);
    expect(IPHONE.h).toBeGreaterThan(500);
    const ipad = vueInitiale(IPAD_PORTRAIT);
    expect(ipad.s).toBeGreaterThan(contenir(IPAD_PORTRAIT));
    expect(vueVisible(ipad, IPAD_PORTRAIT).h).toBeLessThanOrEqual(HAUTEUR_SCENE + 1);
    // Hauteur du plateau : jamais plus que la place disponible, jamais minuscule.
    expect(hauteurPlateau(1400, 400)).toBe(400);
    expect(hauteurPlateau(358, 100)).toBe(280);
  });

  it('double-tap sur une zone : elle est cadrée entièrement ; inertie amortie ; suivi qui rejoint l’agent', () => {
    for (const z of ORDRE_ZONES) {
      const r = rectZone(z);
      const cam = cadrer(r, PC);
      const v = vueVisible(cam, PC);
      expect(v.x).toBeLessThanOrEqual(r.x + 1);
      expect(v.x + v.l).toBeGreaterThanOrEqual(r.x + r.l - 1);
      expect(cam.s).toBeGreaterThan(contenir(PC));
    }
    let v = { x: 2, y: -1 };
    let parcouru = 0;
    let fini = false;
    for (let k = 0; k < 200 && !fini; k++) {
      const pas = inertie(v, 16);
      expect(Math.hypot(pas.v.x, pas.v.y)).toBeLessThan(Math.hypot(v.x, v.y));
      parcouru += pas.d.x;
      v = pas.v;
      fini = pas.fini;
    }
    expect(fini).toBe(true);
    expect(parcouru).toBeGreaterThan(100);
    expect(parcouru).toBeLessThan(600); // inertie légère
    // Suivi : la caméra converge vers la cible, et y va d'un coup sans animations.
    const c = PC;
    let cam: Camera = { s: contenir(c) * 3, cx: 300, cy: 300 };
    const cible = { x: 800, y: 400 };
    for (let k = 0; k < 120; k++) cam = suivre(cam, cible, 16, c);
    expect(Math.abs(cam.cx - cible.x)).toBeLessThan(2);
    expect(suivre({ s: contenir(c) * 3, cx: 300, cy: 300 }, cible, 16, c, true).cx).toBeCloseTo(800);
  });
});

describe('cartes de survol : jamais hors de l’écran', () => {
  it('au-dessus de préférence, sinon dessous ou à côté ; toujours dans le cadre, même dans les coins', () => {
    const carte = { l: 300, h: 180 };
    expect(placerCarte({ x: 600, y: 400, l: 40, h: 90 }, carte, PC).cote).toBe('haut');
    expect(placerCarte({ x: 600, y: 20, l: 40, h: 90 }, carte, PC).cote).toBe('bas');
    for (const cadre of [PC, IPHONE, { l: 320, h: 260 }]) {
      for (let x = -50; x <= cadre.l + 50; x += 37) {
        for (let y = -50; y <= cadre.h + 50; y += 41) {
          const p = placerCarte({ x, y, l: 40, h: 90 }, { l: Math.min(carte.l, cadre.l - 16), h: carte.h }, cadre);
          expect(p.x).toBeGreaterThanOrEqual(8);
          expect(p.y).toBeGreaterThanOrEqual(8);
          expect(p.x + Math.min(carte.l, cadre.l - 16)).toBeLessThanOrEqual(cadre.l - 8 + 1e-6);
          if (cadre.h > carte.h + 16) expect(p.y + carte.h).toBeLessThanOrEqual(cadre.h - 8 + 1e-6);
        }
      }
    }
  });
});

// ------------------------------------------------------------------ relecture

let n = 0;
const ev = (s: number, extra: Partial<EntreeHistorique>): EntreeHistorique => ({
  v: 1, id: `r${++n}`, ts: new Date(T0 + s * 1000).toISOString(), type: 'demande', appareil: 'PC', appareilId: 'aaaaaaaaaaaa', session: 'sess-a', projet: 'budget', ...extra,
});
const journee = (): EntreeHistorique[] => [
  ev(0, { type: 'debut-session' }),
  ev(10, { type: 'demande', texte: 'Ajoute un export' }),
  ev(30, { type: 'outil', outil: 'Read', resume: 'export.ts' }),
  ev(400, { type: 'outil', outil: 'Edit', resume: 'export.ts' }),
  ev(420, { type: 'attente', outil: 'Bash', resume: 'Autoriser Bash ?', motif: 'permission' }),
  ev(600, { type: 'fin-reponse' }),
  ev(300, { type: 'demande', session: 'sess-b', projet: 'hub', texte: 'Plus tard' }),
];

describe('relecture de la journée', () => {
  it('reconstruit le bureau à l’instant t : présents, états et zones d’alors', () => {
    const triees = trierEntrees(journee());
    expect(entreesAvant(triees, T0 + 30_000)).toHaveLength(3);
    expect(entreesAvant(triees, T0 - 1)).toHaveLength(0);
    expect(bureauA(triees, T0 - 1000).agents).toHaveLength(0);
    const a35 = bureauA(triees, T0 + 35_000);
    expect(a35.agents.map(a => a.cle)).toEqual(['aaaaaaaaaaaa|sess-a']);
    expect(a35.agents[0].zone).toBe('bibliotheque');
    const a405 = bureauA(triees, T0 + 405_000);
    expect(a405.agents.find(a => a.session === 'sess-a')?.etat).toBe('ecrit');
    expect(a405.agents.find(a => a.session === 'sess-b')?.zone).toBe('reflexion');
    const a430 = bureauA(triees, T0 + 430_000);
    expect(a430.agents.find(a => a.session === 'sess-a')?.zone).toBe('guichet');
    const a610 = bureauA(triees, T0 + 610_000);
    expect(a610.agents.find(a => a.session === 'sess-a')?.salle).toBe(true);
    // Jamais figé (on rejoue, ce n'est pas une copie ancienne), même venu d'une copie du relais.
    expect(a610.agents.every(a => !a.fige)).toBe(true);
    // Fin de la relecture = le bureau d'aujourd'hui.
    expect(bureauA(triees, T0 + 700_000).agents.map(a => a.etat)).toEqual(deduireBureau(journee(), { maintenant: T0 + 700_000 }).agents.map(a => a.etat));
  });

  it('bornes du jour, lecture accélérée qui s’arrête au bout, densité de l’activité', () => {
    const { debut, fin } = bornesJournee(journee(), T0 + 3_600_000);
    expect(debut).toBe(T0 - 60_000);
    expect(fin).toBe(T0 + 3_600_000);
    expect(bornesJournee([], T0).debut).toBe(T0 - 2 * 3_600_000);
    let r = demarrerRelecture(journee(), T0 + 600_000, 60);
    expect(r.t).toBe(r.debut);
    expect(r.lecture).toBe(true);
    r = avancerRelecture(r, 250);
    expect(r.t - r.debut).toBe(15_000); // ×60 : 250 ms → 15 s
    r = avancerRelecture({ ...r, vitesse: 10 }, 250);
    expect(r.t - r.debut).toBe(17_500);
    for (let k = 0; k < 400 && r.lecture; k++) r = avancerRelecture(r, 250);
    expect(r.lecture).toBe(false);
    expect(r.t).toBe(r.fin);
    expect(avancerRelecture(r, 250)).toBe(r);
    const d = densite(journee(), T0 - 60_000, T0 + 660_000, 12);
    expect(d).toHaveLength(12);
    expect(d.reduce((a, b) => a + b, 0)).toBe(7);
  });
});

// ------------------------------------------------------------------ rendu du plateau (web)

describe('plateau : rendu', () => {
  const { renderToStaticMarkup } = require('react-dom/server') as { renderToStaticMarkup(e: React.ReactElement): string };
  const { PlateauScene } = require('./PlateauScene.web') as { PlateauScene: (p: PropsPlateau) => React.ReactElement };
  const agents = bureauA(trierEntrees(journee()), T0 + 425_000).agents;
  const props = (extra: Partial<PropsPlateau> = {}): PropsPlateau => ({
    agents, theme: themeHub('nuit'), reduit: false, maintenant: T0 + 425_000, onDetail: () => undefined, largeur: 1000, horloge: () => 0, ...extra,
  });
  const html = (p: PropsPlateau) => renderToStaticMarkup(<PlateauScene {...p} />);

  it('peu de texte par défaut : pas de carte, cibles accessibles (≥ 44 px), commandes de zoom, plein écran, ambiance', () => {
    const h = html(props({ onRelecture: () => undefined }));
    expect(h).toContain('data-testid="bureau-plateau"');
    expect(h).toContain('data-mode="normal"');
    expect(h).not.toContain('scene-carte');
    expect(h).not.toContain('Ajoute un export');
    expect(h).toContain('class="co-cible"');
    expect(h).toContain('aria-label="budget, Attend ta réponse');
    expect(h).toContain('max(60px,calc(48px * var(--co-inv,1)))');
    for (const id of ['scene-zoom-plus', 'scene-zoom-moins', 'scene-recentrer', 'scene-plein-ecran', 'scene-ambiance', 'scene-minicarte-basculer', 'scene-relecture-ouvrir']) expect(h).toContain(`data-testid="${id}"`);
    expect(h).toContain('data-co-zone="guichet"');
    expect(h).toContain('prefers-reduced-motion');
  });

  it('carte d’un agent (survol, focus ou premier tap) : projet, état, depuis quand, demande, outil ; décrite pour les lecteurs d’écran', () => {
    const cle = agents.find(a => a.session === 'sess-a')!.cle;
    const h = html(props({ initial: { apercu: cle } }));
    expect(h).toContain('data-testid="scene-carte"');
    expect(h).toContain('budget');
    expect(h).toContain('Attend ta réponse · Attend ta réponse');
    expect(h).toContain('Autoriser Bash ?');
    expect(h).toContain('« Ajoute un export »');
    expect(h).toContain('Dernière activité');
    expect(h).toContain('data-testid="scene-carte-detail"');
    expect(h).toContain('Suivre cet agent');
    expect(h).toMatch(/aria-describedby="(co-\d+-desc)"[\s\S]*id="\1"/);
    // Suivi en cours : bouton « Ne plus suivre » et pastille.
    const suivi = html(props({ initial: { apercu: cle, suivi: cle } }));
    expect(suivi).toContain('Ne plus suivre');
    expect(suivi).toContain('data-testid="scene-suivi"');
  });

  it('carte d’une zone : nom, nombre, rôle ; au guichet, qui attend', () => {
    const h = html(props({ initial: { zone: 'guichet' } }));
    expect(h).toContain('data-testid="scene-carte-zone"');
    expect(h).toContain('1 agent');
    expect(h).toContain('Attendent ta réponse : budget');
    expect(h).toContain('data-testid="scene-zone-survolee"');
    expect(html(props({ initial: { zone: 'cafe' } }))).toContain('personne');
  });

  it('plein écran (immersif), écran d’ambiance sans interface, relecture, animations réduites', () => {
    const imm = html(props({ initial: { immersif: true }, attendent: agents.filter(a => a.etat === 'attend') }));
    expect(imm).toContain('co-plateau co-immersif');
    expect(imm).toContain('data-mode="immersif"');
    expect(imm).toContain('data-testid="scene-puce-attend"');
    const amb = html(props({ initial: { ambiance: true } }));
    expect(amb).toContain('data-mode="ambiance"');
    expect(amb).not.toContain('scene-zoom-plus');
    expect(amb).not.toContain('class="co-cible"');
    const r = demarrerRelecture(journee(), T0 + 600_000);
    const rel = html(props({ relecture: { r, densite: [1, 3, 0, 2], onLecture: () => undefined, onVitesse: () => undefined, onAller: () => undefined, onQuitter: () => undefined } }));
    for (const id of ['scene-relecture', 'scene-relecture-lecture', 'scene-relecture-x10', 'scene-relecture-x60', 'scene-relecture-curseur', 'scene-relecture-quitter', 'scene-puce-relecture']) expect(rel).toContain(`data-testid="${id}"`);
    expect(rel).toContain('aria-checked="true"');
    expect(html(props({ reduit: true }))).toContain('class="co-scene co-fixe"');
    expect(html(props({ initial: { minicarte: true } }))).toContain('data-testid="scene-minicarte"');
    expect(html(props({ initial: { minicarte: false } }))).not.toContain('data-testid="scene-minicarte"');
  });
});

describe('commandes du plateau : contrastes sur les huit thèmes', () => {
  const lum = (hex: string) => {
    const c = [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contraste = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, k) => k - m); return (x + 0.05) / (y + 0.05); };
  it('textes des boutons, cartes et barre de relecture lisibles (≥ 4,5:1) ; couleurs d’état des cartes aussi', () => {
    const { teinteAgent } = require('./PlateauScene.web') as { teinteAgent(a: Agent): string };
    const { teinteLisible } = require('./Bureau') as typeof import('./Bureau');
    expect(THEMES_HUB).toHaveLength(8);
    const agents = bureauA(trierEntrees(journee()), T0 + 425_000).agents;
    for (const t of THEMES_HUB) {
      expect(contraste(t.texte, t.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contraste(t.attenue, t.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contraste(t.surAccent, t.accent)).toBeGreaterThanOrEqual(4.5);
      for (const a of agents) expect(contraste(teinteLisible(teinteAgent(a), t.sombre), t.surface)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

// ------------------------------------------------------------------ mise en route réductible

describe('bandeau « Mise en route » réductible', () => {
  const etapes = (rouges: Array<Etape['id']>): Etape[] => (['hook', 'evenement', 'copie', 'presence'] as const).map(id => ({ id, niveau: rouges.includes(id) ? 'erreur' : 'ok', titre: `Ligne ${id}` }));

  it('réduit à la main même avec un point rouge ; rouvert seulement par un NOUVEAU point rouge', () => {
    expect(pointsARegler(etapes(['evenement']))).toEqual(['evenement']);
    expect(bandeauReduit(etapes(['evenement']), undefined)).toBe(false);
    expect(bandeauReduit(etapes(['evenement']), { reduit: true, points: ['evenement'] })).toBe(true);
    expect(bandeauReduit(etapes(['evenement', 'copie']), { reduit: true, points: ['evenement'] })).toBe(false);
    expect(bandeauReduit(etapes([]), { reduit: true, points: ['evenement'] })).toBe(true);
    expect(bandeauReduit(etapes([]), undefined)).toBe(true); // tout est prêt : une ligne
    expect(bandeauReduit(etapes([]), { reduit: false, points: [] })).toBe(false);
  });

  it('rendu ouvert puis réduit (une ligne « 1 point à régler »), mémorisé sur l’appareil, rouvert par un nouveau point rouge', async () => {
    const memoire = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (c: string) => memoire.get(c) ?? null, setItem: (c: string, v: string) => void memoire.set(c, v) };
    try {
      const theme = themeHub('nuit');
      const vue = await render(<MiseEnRoute theme={theme} etapes={etapes(['evenement'])} onAction={() => undefined} />);
      expect(screen.getByTestId('mise-en-route')).toBeTruthy();
      expect(screen.getByTestId('mise-en-route-reduire').props.accessibilityState).toEqual({ expanded: true });
      await fireEvent.press(screen.getByTestId('mise-en-route-reduire'));
      expect(screen.queryByTestId('mise-en-route')).toBeNull();
      expect(screen.getByText('Mise en route · 1 point à régler')).toBeTruthy();
      expect(screen.getByTestId('mise-en-route-reduite-rouge', { includeHiddenElements: true })).toBeTruthy();
      expect(screen.getByTestId('mise-en-route-reduite').props.accessibilityState).toEqual({ expanded: false });
      expect(JSON.parse(memoire.get(CLE_MEMOIRE_MISE_EN_ROUTE)!)).toEqual({ reduit: true, points: ['evenement'] });
      await vue.unmount();
      // Rechargement : toujours réduit (le même point rouge ne le rouvre pas).
      const v2 = await render(<MiseEnRoute theme={theme} etapes={etapes(['evenement'])} onAction={() => undefined} />);
      expect(screen.getByTestId('mise-en-route-reduite')).toBeTruthy();
      // Un nouveau point passe au rouge : il se rouvre.
      await v2.unmount();
      await render(<MiseEnRoute theme={theme} etapes={etapes(['evenement', 'copie'])} onAction={() => undefined} />);
      expect(screen.getByTestId('mise-en-route')).toBeTruthy();
      // Rouvert à la main depuis la ligne réduite.
      await fireEvent.press(screen.getByTestId('mise-en-route-reduire'));
      await fireEvent.press(screen.getByTestId('mise-en-route-reduite'));
      expect(screen.getByTestId('mise-en-route')).toBeTruthy();
      expect(JSON.parse(memoire.get(CLE_MEMOIRE_MISE_EN_ROUTE)!).reduit).toBe(false);
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});

// ------------------------------------------------------------------ sous-agents

describe('sous-agents dans la scène', () => {
  const {
    compterParParent, deduireSousAgents, DUREE_RENDU_MS, MAX_MINIS, placerSousAgents, sousAgentsDemo, sousAgentsVisibles, zoneSousAgent,
  } = require('./sousAgentsScene') as typeof import('./sousAgentsScene');
  const historique = (): EntreeHistorique[] => [
    ev(0, { type: 'demande', texte: 'Audit' }),
    ev(60, { type: 'outil', outil: 'Task', resume: 'Explore : cherche les usages', duree: 40_000 }),
    ev(70, { type: 'outil', outil: 'Agent', resume: 'Vérifie les tests', duree: 50_000, echec: true }),
    ev(80, { type: 'outil', outil: 'Read', resume: 'a.ts', duree: 100 }),
  ];

  it('déduits de l’historique (Task / Agent avec durée) : en cours pendant la relecture, puis terminés ou en échec', () => {
    const a30 = deduireSousAgents(historique(), T0 + 30_000);
    expect(a30.map(s => [s.etat, s.debut])).toEqual([['en-cours', T0 + 20_000], ['en-cours', T0 + 20_000]]);
    expect(a30[0].parent).toBe('aaaaaaaaaaaa|sess-a');
    expect(a30[0].description).toBe('Explore : cherche les usages');
    const a90 = deduireSousAgents(historique(), T0 + 90_000);
    expect(a90.map(s => s.etat)).toEqual(['termine', 'echec']);
    expect(a90[0].fin).toBe(T0 + 60_000);
    expect(deduireSousAgents(historique(), T0 + 10_000)).toHaveLength(0);
    expect(compterParParent(a30).get('aaaaaaaaaaaa|sess-a')).toBe(2);
    expect(compterParParent(a90).size).toBe(0);
  });

  it('visibles : en cours, puis « rendu » quelques secondes, puis disparus ; parents absents ignorés ; au-delà de 6, « +N »', () => {
    const parents = new Set(['aaaaaaaaaaaa|sess-a']);
    const liste = deduireSousAgents(historique(), T0 + 61_000);
    const v = sousAgentsVisibles(liste, parents, T0 + 61_000);
    expect(v.visibles.map(s => s.phase).sort()).toEqual(['rendu', 'travaille']);
    expect(sousAgentsVisibles(deduireSousAgents(historique(), T0 + 200_000), parents, T0 + 200_000).visibles).toHaveLength(0);
    expect(sousAgentsVisibles(liste, new Set(), T0 + 61_000).visibles).toHaveLength(0);
    const beaucoup = Array.from({ length: 9 }, (_, k) => ({ id: `s${k}`, parent: 'p', debut: T0 + k, etat: 'en-cours' as const }));
    const r = sousAgentsVisibles(beaucoup, new Set(['p']), T0 + 100);
    expect(r.visibles).toHaveLength(MAX_MINIS);
    expect(r.enPlus).toBe(3);
    expect(DUREE_RENDU_MS).toBeGreaterThan(2000);
  });

  it('placés sans collision : zone de leur activité, sinon près du parent ; rendu = au parent', () => {
    expect(zoneSousAgent({ type: 'Explore' })).toBe('bibliotheque');
    expect(zoneSousAgent({ type: 'Plan' })).toBe('reunion');
    expect(zoneSousAgent({ type: 'general-purpose', description: 'Lance les tests' })).toBe('machines');
    expect(zoneSousAgent({ type: 'general-purpose' })).toBeUndefined();
    const vis = Array.from({ length: 6 }, (_, k) => ({ id: `s${k}`, parent: k % 2 ? 'p1' : 'p2', debut: T0 + k, etat: 'en-cours' as const, phase: 'travaille' as const, type: k < 3 ? 'Explore' : 'general-purpose' }));
    const pos = placerSousAgents(vis, cle => (cle === 'p1' ? { x: 8, y: 7 } : { x: 3, y: 12 }));
    const pts = [...pos.values()];
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)).toBeGreaterThan(0.5);
    const rendu = placerSousAgents([{ ...vis[3], phase: 'rendu' }], () => ({ x: 8, y: 7 }));
    expect(Math.hypot(rendu.get('s3')!.x - 8, rendu.get('s3')!.y - 7)).toBeLessThan(0.6);
  });

  it('démo : deux ou trois sous-agents en parallèle, rattachés à des sessions de la démo', () => {
    const { entreesDemo } = require('./logiqueScene') as typeof import('./logiqueScene');
    let max = 0;
    for (let s = 20; s <= 300; s += 5) {
      const agents = deduireBureau(entreesDemo(T0, T0 + s * 1000), { maintenant: T0 + s * 1000 }).agents;
      const sa = sousAgentsDemo(T0, T0 + s * 1000, agents);
      const cles = new Set(agents.map(a => a.cle));
      expect(sa.every(x => cles.has(x.parent))).toBe(true);
      max = Math.max(max, sa.filter(x => x.etat === 'en-cours').length);
    }
    expect(max).toBeGreaterThanOrEqual(2);
    expect(max).toBeLessThanOrEqual(3);
  });

  it('intégration : module de données — visible dès SubagentStart (en direct), fin par SubagentStop ; repli Task / Agent pour un ancien hook', () => {
    const { sousAgentsDepuisHistorique } = require('./sousAgentsScene') as typeof import('./sousAgentsScene');
    const direct = [
      ev(0, { type: 'demande', texte: 'Audit' }),
      ev(5, { type: 'debut-sous-agent', agent: 'ag-1', agentType: 'Explore' }),
      ev(8, { type: 'outil', outil: 'Grep', resume: 'export', agent: 'ag-1', agentType: 'Explore', duree: 300 }),
    ];
    // Lancé il y a une seconde, l'outil Agent n'est pas encore noté : déjà là, en cours.
    const a6 = sousAgentsDepuisHistorique(direct, T0 + 6_000);
    expect(a6).toEqual([expect.objectContaining({ id: 'ag-1', parent: 'aaaaaaaaaaaa|sess-a', type: 'Explore', etat: 'en-cours', debut: T0 + 5_000 })]);
    expect(sousAgentsVisibles(a6, new Set(['aaaaaaaaaaaa|sess-a']), T0 + 6_000).visibles).toHaveLength(1);
    // Avant son début (relecture) : absent.
    expect(sousAgentsDepuisHistorique(direct, T0 + 4_000)).toHaveLength(0);
    const fini = [...direct, ev(20, { type: 'fin-sous-agent', agent: 'ag-1', agentType: 'Explore' }), ev(21, { type: 'outil', outil: 'Agent', resume: 'Cherche les usages', sousAgentType: 'Explore', agentLance: 'ag-1', duree: 16_000 })];
    const a30 = sousAgentsDepuisHistorique(fini, T0 + 30_000);
    expect(a30).toEqual([expect.objectContaining({ id: 'ag-1', etat: 'termine', fin: T0 + 20_000, description: 'Cherche les usages' })]);
    // Ancien hook (aucun SubagentStart) : la déduction Task / Agent prend le relais, relecture comprise.
    expect(sousAgentsDepuisHistorique(historique(), T0 + 30_000).map(s => s.etat)).toEqual(['en-cours', 'en-cours']);
    // Copie du relais : un sous-agent sans nouvelles depuis longtemps n'est plus dessiné.
    const vieux = sousAgentsDepuisHistorique(direct, T0 + 3 * 3_600_000);
    expect(vieux[0].etat).toBe('termine');
    expect(sousAgentsVisibles(vieux, new Set(['aaaaaaaaaaaa|sess-a']), T0 + 3 * 3_600_000).visibles).toHaveLength(0);
  });

  it('Équipe : surnom au survol (carte), dans la cible accessible et la pastille de suivi', () => {
    const { renderToStaticMarkup } = require('react-dom/server') as { renderToStaticMarkup(e: React.ReactElement): string };
    const { PlateauScene } = require('./PlateauScene.web') as { PlateauScene: (p: PropsPlateau) => React.ReactElement };
    const equipe = require('./equipe') as typeof import('./equipe');
    equipe.reinitialiserMagasinSuivi();
    equipe.brancherMagasinSuivi(undefined, { equipe: { projets: { budget: { surnom: 'Bérénice', couleur: '#E94F9B', accessoire: 'couronne' } }, sessions: {} }, notes: {} });
    try {
      const t = T0 + 30_000;
      const agents = bureauA(trierEntrees(historique()), t).agents;
      const props: PropsPlateau = { agents, theme: themeHub('ivoire'), reduit: true, maintenant: t, onDetail: () => undefined, largeur: 1000, horloge: () => 0 };
      const h = renderToStaticMarkup(<PlateauScene {...props} initial={{ apercu: agents[0].cle, suivi: agents[0].cle }} />);
      expect(h).toContain('data-testid="scene-carte-surnom">Bérénice<');
      expect(h).toContain('aria-label="Bérénice (budget), ');
      expect(h).toContain('◎ Suivi : Bérénice (budget)');
      // Couleur du haut choisie dans l'Équipe.
      expect(h).toContain('#E94F9B');
    } finally {
      equipe.reinitialiserMagasinSuivi();
    }
  });

  it('rendu : mini-personnage avec sa cible accessible, compteur sur le parent, carte « Sous-agent de … »', () => {
    const { renderToStaticMarkup } = require('react-dom/server') as { renderToStaticMarkup(e: React.ReactElement): string };
    const { PlateauScene } = require('./PlateauScene.web') as { PlateauScene: (p: PropsPlateau) => React.ReactElement };
    const t = T0 + 30_000;
    const agents = bureauA(trierEntrees(historique()), t).agents;
    const sousAgents = deduireSousAgents(historique(), t);
    const props: PropsPlateau = { agents, theme: themeHub('ivoire'), reduit: true, maintenant: t, onDetail: () => undefined, largeur: 1000, horloge: () => 0, sousAgents };
    const h = renderToStaticMarkup(<PlateauScene {...props} />);
    expect(h.match(/data-sous="/g)).toHaveLength(2);
    expect(h).toContain('aria-label="Sous-agent de budget : Explore : cherche les usages (Task), en cours');
    expect(h).toContain('data-testid="scene-compteur-sous-agents" data-nombre="2"');
    const carte = renderToStaticMarkup(<PlateauScene {...props} initial={{ sousAgent: sousAgents[0].id }} />);
    expect(carte).toContain('data-testid="scene-carte-sous"');
    expect(carte).toContain('Sous-agent de budget');
    expect(carte).toContain('« Explore : cherche les usages »');
    expect(carte).toContain('Vient de démarrer');
    expect(carte).toContain('data-testid="scene-lien-sous-agent"');
  });
});
