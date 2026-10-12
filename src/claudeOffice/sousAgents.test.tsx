/**
 * Claude Office v4 : sous-agents (logique pure) — appariement début / lancement / fin, parallèles,
 * imbriqués, événements manquants (ancien hook, début sans fin, fin sans début), outils attribués,
 * états et durées, copie du relais, statistiques, récap, démo ; carte des Statistiques.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import type { ContexteHub } from '../hub/types';
import type { EntreeHistorique } from './logiqueHistorique';
import { calculerRecap, faitsMarquants } from './logiqueRecap';
import {
  CYCLE_DEMO_SOUS_AGENTS, entreesDemoSousAgents, EXPIRATION_SOUS_AGENT_MS, SESSION_DEMO_SOUS_AGENTS, sousAgents, sousAgentsEnCours, statsSousAgents,
} from './logiqueSousAgents';
import { chronologieSession } from './logiqueStats';
import { Statistiques } from './Statistiques';

const T0 = Date.parse('2026-10-07T10:00:00Z');
const a = (s: number) => new Date(T0 + s * 1000).toISOString();
let n = 0;
const ev = (s: number, type: string, extra: Partial<EntreeHistorique> = {}): EntreeHistorique => ({
  v: 1, id: `s${++n}`, ts: a(s), type, appareil: 'PC', appareilId: 'aaaaaaaaaaaa', session: 'sess', projet: 'budget', ...extra,
});
const CLE = 'aaaaaaaaaaaa|sess';
const de = (entrees: EntreeHistorique[], maintenant = T0 + 120_000, references?: Record<string, number>) => sousAgents(entrees, { maintenant, ...(references ? { references } : {}) })[CLE] ?? [];

describe('sous-agents : hook v4 complet', () => {
  it('trois en parallèle : début, lancement (description, type, modèle, arrière-plan), outils attribués, fin, états, durées', () => {
    const j = [
      ev(0, 'demande', { texte: 'x' }),
      ev(1, 'debut-sous-agent', { agent: 'A', agentType: 'Explore' }),
      ev(1.2, 'outil', { outil: 'Agent', resume: 'Trouver les API', sousAgentType: 'Explore', modele: 'haiku', arrierePlan: true, agentLance: 'A', duree: 100 }),
      ev(2, 'debut-sous-agent', { agent: 'B', agentType: 'Explore' }),
      ev(2.2, 'outil', { outil: 'Agent', resume: 'Lister les styles', sousAgentType: 'Explore', arrierePlan: true, duree: 100 }),
      ev(3, 'debut-sous-agent', { agent: 'C', agentType: 'general-purpose' }),
      ev(5, 'outil', { agent: 'A', agentType: 'Explore', outil: 'Grep' }),
      ev(6, 'outil', { agent: 'A', agentType: 'Explore', outil: 'Read' }),
      ev(7, 'outil', { agent: 'A', agentType: 'Explore', outil: 'Read', echec: true }),
      ev(8, 'outil', { agent: 'C', agentType: 'general-purpose', outil: 'Edit' }),
      ev(20, 'fin-sous-agent', { agent: 'A', agentType: 'Explore' }),
      ev(30, 'fin-sous-agent', { agent: 'C', agentType: 'general-purpose' }),
      ev(30.5, 'outil', { outil: 'Agent', resume: 'Appliquer', sousAgentType: 'general-purpose', arrierePlan: false, duree: 27_600, echec: true }),
    ];
    const l = de(j);
    expect(l.map(x => x.id)).toEqual(['A', 'B', 'C']);
    const [A, B, C] = l;
    expect(A).toMatchObject({ parent: 'sess', profondeur: 1, description: 'Trouver les API', type: 'Explore', modele: 'haiku', arrierePlan: true, etat: 'termine', dureeMs: 19_000, nbOutils: 3, echecs: 1 });
    expect(A.outils).toEqual([{ nom: 'Read', n: 2 }, { nom: 'Grep', n: 1 }]);
    // B : lancement sans identifiant rattaché par type et date ; pas de fin : en cours.
    expect(B).toMatchObject({ description: 'Lister les styles', etat: 'en-cours', dureeMs: 118_000 });
    // C : premier plan, lancement en échec.
    expect(C).toMatchObject({ description: 'Appliquer', etat: 'echec', arrierePlan: false, fin: T0 + 30_000, nbOutils: 1 });
    expect(sousAgentsEnCours(l).map(x => x.id)).toEqual(['B']);
  });

  it('imbriqués : un lancement fait DANS un sous-agent a ce sous-agent pour parent', () => {
    const j = [
      ev(0, 'debut-sous-agent', { agent: 'P', agentType: 'general-purpose' }),
      ev(5, 'debut-sous-agent', { agent: 'E', agentType: 'Plan' }),
      ev(9, 'fin-sous-agent', { agent: 'E', agentType: 'Plan' }),
      ev(9.2, 'outil', { agent: 'P', outil: 'Agent', resume: 'Planifier', sousAgentType: 'Plan', agentLance: 'E', duree: 4_200 }),
      ev(12, 'fin-sous-agent', { agent: 'P' }),
    ];
    const [P, E] = de(j);
    expect(P).toMatchObject({ id: 'P', profondeur: 1, parent: 'sess', etat: 'termine' });
    expect(E).toMatchObject({ id: 'E', profondeur: 2, parent: 'P', description: 'Planifier', etat: 'termine', dureeMs: 4_000 });
    // Le lancement n'est pas compté comme outil du parent.
    expect(P.nbOutils).toBe(0);
  });
});

describe('sous-agents : événements manquants', () => {
  it('ancien hook (sans SubagentStart ni identifiants) : lancements au premier plan, fins sans id appariées, pas de doublon', () => {
    const j = [
      ev(10, 'fin-sous-agent'),
      ev(10.3, 'outil', { outil: 'Task', resume: 'Revue du code', duree: 9_000 }),
      ev(30, 'fin-sous-agent'),
      ev(30.2, 'outil', { outil: 'Task', resume: 'Tests', duree: 15_000 }),
    ];
    const l = de(j);
    expect(l).toHaveLength(2);
    expect(l.map(x => [x.description, x.etat, Math.round(x.dureeMs / 1000)])).toEqual([['Revue du code', 'termine', 9], ['Tests', 'termine', 15]]);
  });

  it('début sans fin : en cours, puis « sans nouvelles » après le délai ou à la fin de la session', () => {
    const j = [ev(0, 'debut-sous-agent', { agent: 'X', agentType: 'Explore' }), ev(60, 'outil', { agent: 'X', outil: 'Read' })];
    expect(de(j, T0 + 120_000)[0].etat).toBe('en-cours');
    const tard = de(j, T0 + 60_000 + EXPIRATION_SOUS_AGENT_MS + 1);
    expect(tard[0]).toMatchObject({ etat: 'expire', dureeMs: 60_000, dernier: T0 + 60_000 });
    expect(de([...j, ev(90, 'fin-session')])[0].etat).toBe('expire');
  });

  it('fin sans début : sous-agent au début inconnu (estimé) ; outils d’un id inconnu : sous-agent créé', () => {
    const l = de([ev(40, 'outil', { agent: 'Y', outil: 'Grep' }), ev(50, 'fin-sous-agent', { agent: 'Y', agentType: 'Explore' }), ev(70, 'fin-sous-agent', { agent: 'Z' })]);
    expect(l.map(x => [x.id, x.debutInconnu, x.etat, x.dureeMs])).toEqual([['Y', true, 'termine', 10_000], ['Z', true, 'termine', 0]]);
    expect(l[0].type).toBe('Explore');
  });

  it('lancement en arrière-plan sans début ni fin : en cours ; échec d’un lancement sans fin : échec', () => {
    const l = de([ev(0, 'outil', { outil: 'Agent', resume: 'Fond', arrierePlan: true, duree: 50 }), ev(5, 'outil', { outil: 'Agent', resume: 'Raté', duree: 10, echec: true })]);
    expect(l.map(x => [x.description, x.etat])).toEqual([['Fond', 'en-cours'], ['Raté', 'echec']]);
  });

  it('copie du relais : jugée à la date du dépôt ; sessions sans sous-agent absentes', () => {
    const j = [ev(0, 'debut-sous-agent', { agent: 'X' })];
    expect(de(j, T0 + 3 * 3_600_000, { aaaaaaaaaaaa: T0 + 60_000 })[0]).toMatchObject({ etat: 'en-cours', dureeMs: 60_000 });
    expect(sousAgents([ev(0, 'demande'), ev(1, 'outil', { outil: 'Read' })], { maintenant: T0 })).toEqual({});
  });
});

describe('sous-agents : statistiques, récap, chronologie, démo', () => {
  const journee = () => [
    ev(0, 'debut-sous-agent', { agent: 'A', agentType: 'Explore' }), ev(1, 'debut-sous-agent', { agent: 'B', agentType: 'Explore' }),
    ev(2, 'debut-sous-agent', { agent: 'C', agentType: 'Plan' }), ev(10, 'fin-sous-agent', { agent: 'A' }), ev(20, 'fin-sous-agent', { agent: 'B' }),
    ev(30, 'fin-sous-agent', { agent: 'C' }),
    ev(100, 'debut-sous-agent', { agent: 'D', agentType: 'Explore', session: 'autre' }), ev(110, 'fin-sous-agent', { agent: 'D', session: 'autre' }),
  ];

  it('par jour, par session, en parallèle, types, durée moyenne', () => {
    const s = statsSousAgents(journee(), T0 + 3_600_000, 7);
    expect(s).toMatchObject({ total: 4, sessions: 2, maxParSession: 3, maxParalleles: 3, echecs: 0, dureeMoyenneMs: (10 + 19 + 28 + 10) * 250 });
    expect(s.types).toEqual([{ nom: 'Explore', n: 3 }, { nom: 'Plan', n: 1 }]);
    expect(s.parJour).toHaveLength(7);
    expect(s.parJour[6].n).toBe(4);
    expect(statsSousAgents(journee(), T0 + 10 * 86_400_000, 7).total).toBe(0);
  });

  it('récap : sous-agents comptés et cités dans les faits marquants', () => {
    const r = calculerRecap(journee(), T0 + 3_600_000, 'jour');
    expect(r.sousAgents).toEqual({ total: 4, maxParalleles: 3, types: [{ nom: 'Explore', n: 3 }, { nom: 'Plan', n: 1 }] });
    expect(faitsMarquants(r).join('\n')).toMatch(/4 sous-agents \(Explore ×3, Plan ×1\), jusqu’à 3 en parallèle/);
  });

  it('chronologie de la session : début et fin de sous-agent, avec leur type', () => {
    const c = chronologieSession(journee(), CLE);
    expect(c.etapes.filter(e => e.genre === 'sous-agent').map(e => e.titre).slice(0, 2)).toEqual(['Sous-agent lancé (Explore)', 'Sous-agent lancé (Explore)']);
  });

  it('démo : trois sous-agents en parallèle (dont un imbriqué et un en échec), cycle après cycle', () => {
    const debut = T0;
    const pendant = sousAgents(entreesDemoSousAgents(debut, debut + 20_000), { maintenant: debut + 20_000 })[`demo00000000|${SESSION_DEMO_SOUS_AGENTS}`];
    expect(sousAgentsEnCours(pendant)).toHaveLength(4);
    expect(pendant.find(x => x.type === 'Plan')).toMatchObject({ profondeur: 2 });
    const apres = sousAgents(entreesDemoSousAgents(debut, debut + 60_000), { maintenant: debut + 60_000 })[`demo00000000|${SESSION_DEMO_SOUS_AGENTS}`];
    expect(apres.map(x => x.etat).sort()).toEqual(['echec', 'termine', 'termine', 'termine']);
    expect(apres.find(x => x.type === 'general-purpose')?.description).toBe('Appliquer le plan et lancer les tests');
    const cycle2 = debut + (CYCLE_DEMO_SOUS_AGENTS + 20) * 1000;
    expect(sousAgentsEnCours(sousAgents(entreesDemoSousAgents(debut, cycle2), { maintenant: cycle2 })[`demo00000000|${SESSION_DEMO_SOUS_AGENTS}`])).toHaveLength(4);
  });

  it('Statistiques : carte « Sous-agents » (démo)', async () => {
    // L'historique fictif de 30 jours contient aussi des outils Task (hook d'avant la v4) : comptés comme sous-agents.
    await render(<Statistiques theme={themeHub('nuit')} contexte={{} as ContexteHub} debutDemo={Date.now() - 60_000} />);
    expect(screen.getByTestId('stats-sous-agents')).toBeTruthy();
    expect(screen.getByTestId('stats-sous-agents-resume').props.children.join('')).toMatch(/\d+ sous-agents dans \d+ sessions · jusqu’à 4 pour une session · jusqu’à 4 en parallèle · 1 en échec/);
  });
});
