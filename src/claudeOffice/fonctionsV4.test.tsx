/**
 * Claude Office v4 (fonctionnalités) : personnalisation des agents (apparence
 * par projet et session), alertes (règles, seuils, anti-répétition, relais,
 * journal), récap (jour, semaine, exports masqués), raccourcis clavier
 * (inactifs en saisie), notes de session ; rendu de l'onglet Suivi (Récap,
 * Alertes, Équipe, Notes), de l'aide des raccourcis, du détail avec sa note,
 * clair et sombre ; pastille de la tuile ; droits inchangés.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { REGISTRE } from '../hub/registre';
import { appsVisibles } from '../hub/permissions';
import { themeHub } from '../hub/themes';
import type { ContexteHub } from '../hub/types';
import type { Profil } from '../profils/profils';
import { useAlertesOffice, CLE_JOURNAL_ALERTES, CLE_REGLAGES_ALERTES } from './alertesOffice';
import { DetailAgent } from './DetailAgent';
import { entreesDemoSuivi, equipeDemo, SESSION_DEMO_ATTENTE } from './demoSuivi';
import {
  apparenceAgent, apparenceDepuis, apparencePersonnalisee, brancherMagasinSuivi, changerNote, changerPerso, chercherNotes, CLE_EQUIPE, CLE_NOTES, EQUIPE_VIDE,
  equipeCourante, fusionnerApparence, lireEquipe, lireNotes, lirePerso, MAX_NOTE, modifierNote, modifierPerso, nomAgent, noteDe, reinitialiserMagasinSuivi, trierProjets,
} from './equipe';
import {
  ajouterAuJournal, ANTI_REPETITION_MS, ETAT_VIDE, evaluerAlertes, lireJournalAlertes, lireReglagesAlertes, libellePastille, marquerToutLu, MAX_JOURNAL, nonLues,
  REGLAGES_DEFAUT, type Alerte, type ReglagesAlertes,
} from './logiqueAlertes';
import { deduireBureau, couleurAgent } from './logiqueBureau';
import type { EntreeHistorique } from './logiqueHistorique';
import { calculerRecap, exporterRecapJson, exporterRecapMarkdown, exporterRecapTexte, faitsMarquants, phraseRecap } from './logiqueRecap';
import { apparence } from './logiqueScene';
import { actionClavier, agentVoisin, ecouterOffice, emettreOffice, estEnSaisie, RACCOURCIS } from './raccourcis';
import { ClaudeOffice } from './Racine';
import { APP_CLAUDE_OFFICE, ID_CLAUDE_OFFICE } from './registre';
import { infoClaudeOffice } from './resumeHub';
import { AideRaccourcis, Suivi } from './Suivi';

const nuit = themeHub('nuit');
const ivoire = themeHub('ivoire');
const T0 = Date.parse('2026-10-07T10:00:00Z');
const il = (min: number) => new Date(T0 - min * 60_000).toISOString();
let n = 0;
const ev = (min: number, extra: Partial<EntreeHistorique> = {}): EntreeHistorique => ({
  v: 1, id: `f${++n}`, ts: il(min), type: 'demande', appareil: 'PC', appareilId: 'aaaaaaaaaaaa', session: 'sess-a', projet: 'budget', ...extra,
});
const fausseBase = () => {
  const m = new Map<string, string>();
  return { lire: (c: string) => m.get(c), ecrire: (c: string, v: string) => void m.set(c, v), m };
};
const reglages = (c: Partial<{ [K in keyof ReglagesAlertes]: Partial<ReglagesAlertes[K]> }> = {}): ReglagesAlertes =>
  Object.fromEntries(Object.entries(REGLAGES_DEFAUT).map(([k, v]) => [k, { ...v, ...(c as Record<string, object>)[k] }])) as ReglagesAlertes;

afterEach(() => reinitialiserMagasinSuivi());

// ------------------------------------------------------------------ personnalisation

describe('équipe : apparence par projet et session', () => {
  it('la session l’emporte sur le projet, champ par champ ; couleur du projet par défaut', () => {
    let e = changerPerso(EQUIPE_VIDE, 'projets', 'budget', { surnom: 'Félix', couleur: '#e94f9b', accessoire: 'couronne', favori: true });
    e = changerPerso(e, 'sessions', 'sess-2', { accessoire: 'lunettes' });
    expect(apparenceDepuis(e, 'budget', 'sess-1')).toEqual({ surnom: 'Félix', couleur: '#E94F9B', accessoire: 'couronne', favori: true, personnalise: true });
    expect(apparenceDepuis(e, 'budget', 'sess-2')).toMatchObject({ surnom: 'Félix', accessoire: 'lunettes' });
    expect(apparenceDepuis(e, 'hub', 's')).toEqual({ couleur: couleurAgent('hub'), favori: false, personnalise: false });
    // Un perso vidé est retiré ; null réinitialise.
    expect(changerPerso(e, 'sessions', 'sess-2', { accessoire: undefined }).sessions['sess-2']).toBeUndefined();
    expect(changerPerso(e, 'projets', 'budget', null).projets.budget).toBeUndefined();
  });

  it('lecture prudente : couleurs, accessoires et surnoms invalides écartés', () => {
    expect(lirePerso({ surnom: '  a\u0007b  ', couleur: 'red', accessoire: 'fusée', favori: 'oui' })).toEqual({ surnom: 'a b' });
    expect(lirePerso({ surnom: 'x'.repeat(80) })?.surnom).toHaveLength(24);
    expect(lireEquipe('pas du json')).toEqual({ projets: {}, sessions: {} });
    expect(lireEquipe(JSON.stringify({ projets: { ok: { favori: true }, vide: {} } }))).toEqual({ projets: { ok: { favori: true } }, sessions: {} });
  });

  it('favoris d’abord ; nom affiché « Surnom (projet) », secrets masqués', () => {
    const e = changerPerso(changerPerso(EQUIPE_VIDE, 'projets', 'zeta', { favori: true }), 'projets', 'alpha', { surnom: 'sk-ant-abcdefghijklmnop' });
    expect(trierProjets(['beta', 'alpha', 'zeta', 'beta'], e)).toEqual(['zeta', 'alpha', 'beta']);
    expect(nomAgent('alpha', 's', e)).toBe('[secret masqué] (alpha)');
    expect(nomAgent(undefined, 's', e)).toBe('Projet inconnu');
  });

  it('magasin : modifier écrit dans la base du profil ; apparenceAgent et apparencePersonnalisee pour la scène', () => {
    const base = fausseBase();
    brancherMagasinSuivi(base);
    modifierPerso('projets', 'budget', { couleur: '#1F9D55', accessoire: 'casque' });
    expect(JSON.parse(base.m.get(CLE_EQUIPE)!).projets.budget).toEqual({ couleur: '#1F9D55', accessoire: 'casque' });
    expect(apparenceAgent('budget', 'x')).toMatchObject({ couleur: '#1F9D55', accessoire: 'casque' });
    const ag = { cle: 'PC|x', session: 'x', projet: 'budget' };
    expect(apparencePersonnalisee(ag)).toEqual({ ...apparence(ag), haut: '#1F9D55', accessoire: 'casque' });
    // Accessoire inconnu de la scène (couronne) : celui de la scène reste.
    modifierPerso('projets', 'budget', { accessoire: 'couronne' });
    expect(apparencePersonnalisee(ag).accessoire).toBe(apparence(ag).accessoire);
    expect(fusionnerApparence(apparence(ag), apparenceAgent('budget', 'x'), false).haut).toBe(apparence(ag).haut);
  });

  it('démo : données fictives en mémoire, rien n’est écrit ; retour au réel relu de la base', () => {
    const base = fausseBase();
    brancherMagasinSuivi(base);
    brancherMagasinSuivi(base, { equipe: equipeDemo(), notes: {} });
    expect(equipeCourante().projets.boutique?.surnom).toBe('Bob');
    modifierPerso('projets', 'boutique', { surnom: 'Max' });
    modifierNote('s1', 'note de démo');
    expect(base.m.size).toBe(0);
    brancherMagasinSuivi(base);
    expect(equipeCourante().projets.boutique).toBeUndefined();
    expect(noteDe('s1')).toBeUndefined();
  });
});

// ------------------------------------------------------------------ notes

describe('notes de session', () => {
  it('ajout, modification, suppression (texte vide), bornes ; recherche sans accents ni casse', () => {
    let notes = changerNote({}, 's1', '  Bug corrigé  ', 1000, 'budget');
    notes = changerNote(notes, 's2', 'À vérifier demain', 2000, 'hub');
    expect(notes.s1).toEqual({ texte: 'Bug corrigé', maj: 1000, projet: 'budget' });
    expect(chercherNotes(notes, 'a verifier').map(x => x.session)).toEqual(['s2']);
    expect(chercherNotes(notes, 'BUDGET').map(x => x.session)).toEqual(['s1']);
    expect(chercherNotes(notes, '').map(x => x.session)).toEqual(['s2', 's1']);
    expect(changerNote(notes, 's1', '   ', 3000).s1).toBeUndefined();
    expect(changerNote({}, 's', 'x'.repeat(900), 1).s.texte).toHaveLength(MAX_NOTE);
    expect(changerNote({}, 's', 'ligne 1\nligne 2\u0000', 1).s.texte).toBe('ligne 1\nligne 2');
  });

  it('lecture prudente ; magasin écrit la base', () => {
    expect(lireNotes(JSON.stringify({ a: { texte: 'ok', maj: 1 }, b: { texte: '', maj: 1 }, c: { texte: 'x' } }))).toEqual({ a: { texte: 'ok', maj: 1 } });
    expect(lireNotes('{')).toEqual({});
    const base = fausseBase();
    brancherMagasinSuivi(base);
    modifierNote('sess-a', 'à vérifier', 'budget', 5);
    expect(JSON.parse(base.m.get(CLE_NOTES)!)).toEqual({ 'sess-a': { texte: 'à vérifier', maj: 5, projet: 'budget' } });
  });
});

// ------------------------------------------------------------------ alertes

describe('alertes : règles sur les événements de l’historique', () => {
  const eval1 = (entrees: EntreeHistorique[], r = reglages(), etat = ETAT_VIDE, maintenant = T0, references?: Record<string, number>) =>
    evaluerAlertes(entrees, { maintenant, reglages: r, etat, ...(references ? { references } : {}) });

  it('attente : au-delà du seuil seulement, une fois par attente', () => {
    const j = [ev(20, { type: 'debut-session' }), ev(19), ev(6, { type: 'attente', outil: 'Bash', resume: 'Autoriser Bash (git push) ?', motif: 'permission' })];
    const r1 = eval1(j);
    expect(r1.nouvelles.map(a => a.regle)).toEqual(['attente']);
    expect(r1.nouvelles[0]).toMatchObject({ session: 'sess-a', projet: 'budget', detail: 'Autoriser Bash (git push) ?', lue: false });
    expect(r1.nouvelles[0].titre).toMatch(/budget attend ta réponse depuis 6 min/);
    expect(eval1(j, reglages({ attente: { seuil: 10 } })).nouvelles).toEqual([]);
    expect(eval1(j, reglages({ attente: { active: false } })).nouvelles).toEqual([]);
    // Anti-répétition : la même occurrence ne revient pas.
    expect(eval1(j, reglages(), r1.etat, T0 + 60_000).nouvelles).toEqual([]);
  });

  it('anti-répétition par règle et session : 10 min entre deux alertes, puis l’occurrence suivante passe', () => {
    const j1 = [ev(30), ev(8, { type: 'attente' })];
    const r1 = eval1(j1);
    expect(r1.nouvelles).toHaveLength(1);
    // Réponse, puis nouvelle attente de 6 min, 2 min après la première alerte : retenue.
    const j2 = [...j1, ev(7, { type: 'outil', outil: 'Bash' }), ev(1, { type: 'attente' })];
    const plus = (m: number) => T0 + m * 60_000;
    expect(eval1(j2, reglages(), r1.etat, plus(5)).nouvelles).toEqual([]);
    const r3 = eval1(j2, reglages(), r1.etat, T0 + ANTI_REPETITION_MS);
    expect(r3.nouvelles).toHaveLength(1);
    // Une autre session n'est pas retenue par la première.
    const autre = [ev(9, { session: 'sess-b', type: 'attente' })];
    expect(eval1([...j1, ...autre], reglages(), r1.etat, plus(1)).nouvelles.map(a => a.session)).toEqual(['sess-b']);
  });

  it('session longue : active depuis plus de X h (pas si fermée ou inactive)', () => {
    const j = [ev(150, { type: 'debut-session' }), ev(100), ev(2, { type: 'outil', outil: 'Edit' })];
    expect(eval1(j).nouvelles.map(a => a.regle)).toEqual(['session-longue']);
    expect(eval1(j, reglages({ 'session-longue': { seuil: 3 } })).nouvelles).toEqual([]);
    expect(eval1([...j, ev(1, { type: 'fin-session' })]).nouvelles.map(a => a.regle)).not.toContain('session-longue');
    expect(eval1([ev(150), ev(30, { type: 'outil' })]).nouvelles).toEqual([]);
  });

  it('erreurs d’affilée : N échecs de suite (un succès remet à zéro), une fois par série', () => {
    const o = (m: number, echec: boolean) => ev(m, { type: 'outil', outil: 'Bash', resume: 'npm test', echec });
    expect(eval1([ev(10), o(9, true), o(8, true), o(7, false), o(6, true)]).nouvelles).toEqual([]);
    const j = [ev(10), o(9, true), o(8, true), o(7, true), o(6, true)];
    const r = eval1(j);
    expect(r.nouvelles.map(a => a.regle)).toEqual(['erreurs']);
    expect(r.nouvelles[0].titre).toMatch(/3 erreurs d’outil d’affilée/);
    expect(eval1(j, reglages({ erreurs: { seuil: 5 } })).nouvelles).toEqual([]);
  });

  it('a fini : tâche d’au moins X min, fin-session après fin-reponse comptée une fois', () => {
    const j = [ev(14, { texte: 'Ajoute le sommaire' }), ev(10, { type: 'outil' }), ev(2, { type: 'fin-reponse' }), ev(1, { type: 'fin-session' })];
    const r = eval1(j);
    expect(r.nouvelles.map(a => a.regle)).toEqual(['fini']);
    expect(r.nouvelles[0]).toMatchObject({ detail: 'Ajoute le sommaire' });
    expect(r.nouvelles[0].titre).toMatch(/budget a fini \(12 min\)/);
    expect(eval1(j, reglages({ fini: { seuil: 15 } })).nouvelles).toEqual([]);
    expect(eval1(j, reglages({ fini: { seuil: 0 } })).nouvelles).toHaveLength(1);
  });

  it('fraîcheur : un fait ancien ne déclenche rien (rouvrir l’écran ne rejoue pas l’historique)', () => {
    expect(eval1([ev(80), ev(60, { type: 'fin-reponse' })]).nouvelles).toEqual([]);
    expect(eval1([ev(50), ev(45, { type: 'outil', echec: true }), ev(44, { type: 'outil', echec: true }), ev(43, { type: 'outil', echec: true })]).nouvelles).toEqual([]);
  });

  it('copie du relais : jugée à la date du dépôt', () => {
    const j = [ev(30), ev(12, { type: 'attente' })];
    // Dépôt fait 1 min après l'attente : elle n'attendait que depuis 1 min à ce moment-là.
    expect(eval1(j, reglages(), ETAT_VIDE, T0, { aaaaaaaaaaaa: T0 - 11 * 60_000 }).nouvelles).toEqual([]);
    expect(eval1(j, reglages(), ETAT_VIDE, T0, { aaaaaaaaaaaa: T0 - 2 * 60_000 }).nouvelles).toHaveLength(1);
  });

  it('démo : les quatre règles se déclenchent sur les sessions fictives', () => {
    const r = evaluerAlertes(entreesDemoSuivi(T0), { maintenant: T0, reglages: REGLAGES_DEFAUT, etat: ETAT_VIDE, demo: true });
    expect(r.nouvelles.map(a => a.regle).sort()).toEqual(['attente', 'erreurs', 'fini', 'session-longue']);
    expect(r.nouvelles.every(a => a.demo)).toBe(true);
    expect(JSON.stringify(r.nouvelles)).not.toContain('sk-ant-demo');
  });

  it('journal : récents d’abord, borné, lu ; pastille selon le badge ; lecture prudente', () => {
    const a = (id: string, regle: Alerte['regle'] = 'attente'): Alerte => ({ id, regle, ts: il(0), session: 's', cleSession: 'PC|s', titre: id, detail: '', lue: false });
    let j = ajouterAuJournal([], [a('1'), a('2', 'fini')]);
    expect(j.map(x => x.id)).toEqual(['2', '1']);
    expect(nonLues(j, REGLAGES_DEFAUT)).toBe(2);
    expect(nonLues(j, reglages({ fini: { badge: false } }))).toBe(1);
    j = marquerToutLu(j);
    expect(nonLues(j, REGLAGES_DEFAUT)).toBe(0);
    expect(ajouterAuJournal([], Array.from({ length: 250 }, (_, i) => a(String(i))))).toHaveLength(MAX_JOURNAL);
    expect(libellePastille(3)).toBe('3');
    expect(libellePastille(12)).toBe('9+');
    expect(lireReglagesAlertes('{"attente":{"seuil":7,"active":false},"fini":"x"}')).toEqual({ ...REGLAGES_DEFAUT, attente: { ...REGLAGES_DEFAUT.attente, active: false } });
    expect(lireJournalAlertes('nope')).toEqual({ journal: [], etat: { signalees: {}, dernieres: {} } });
    expect(lireJournalAlertes({ journal: [a('x'), { id: 1 }], etat: { signalees: { k: 1, z: 'x' } } }).journal).toHaveLength(1);
  });

  it('pastille de la tuile du hub : indicateur « Alertes » quand il y en a', () => {
    const resume = { actifs: 1, inactifs: 0, termines: 0, source: { genre: 'local' as const }, le: T0 };
    expect(infoClaudeOffice(resume)?.indicateurs.map(i => i.libelle)).toEqual(['Au travail', 'Inactifs']);
    expect(infoClaudeOffice({ ...resume, alertes: 12 })?.indicateurs).toContainEqual({ libelle: 'Alertes', valeur: '9+' });
  });
});

describe('alertes à l’exécution (useAlertesOffice)', () => {
  function Sonde(p: Parameters<typeof useAlertesOffice>[0] & { sortie: { nonLues?: number } }) {
    const a = useAlertesOffice(p);
    p.sortie.nonLues = a.nonLues;
    return null;
  }
  const globalPc = globalThis as { applibourse?: unknown };
  afterEach(() => delete globalPc.applibourse);

  it('journal rangé dans la base, notification système sur le PC seulement pour les règles qui la demandent, une fois', async () => {
    const base = fausseBase();
    base.ecrire(CLE_REGLAGES_ALERTES, JSON.stringify({ attente: { notifier: true } }));
    const notifier = jest.fn(async () => true);
    globalPc.applibourse = { systeme: { notifier } };
    const entrees = [ev(20), ev(6, { type: 'attente', resume: 'Autoriser ?' }), ev(10, { session: 's2', texte: 'x' }), ev(9, { session: 's2', type: 'outil' }), ev(2, { session: 's2', type: 'fin-reponse' })];
    const sortie: { nonLues?: number } = {};
    const vue = await render(<Sonde base={base} entrees={entrees} maintenant={T0} lu surPc sortie={sortie} />);
    expect(sortie.nonLues).toBe(2);
    expect(JSON.parse(base.m.get(CLE_JOURNAL_ALERTES)!).journal).toHaveLength(2);
    expect(notifier).toHaveBeenCalledTimes(1);
    expect(notifier).toHaveBeenCalledWith(expect.stringMatching(/attend ta réponse/), 'Autoriser ?', '');
    await vue.rerender(<Sonde base={base} entrees={[...entrees]} maintenant={T0 + 30_000} lu surPc sortie={sortie} />);
    expect(notifier).toHaveBeenCalledTimes(1);
    // Hors du PC : aucune notification.
    const base2 = fausseBase();
    await render(<Sonde base={base2} entrees={entrees} maintenant={T0} lu sortie={{}} />);
    expect(notifier).toHaveBeenCalledTimes(1);
  });

  it('démo : rien n’est écrit dans la base', async () => {
    const base = fausseBase();
    const sortie: { nonLues?: number } = {};
    await render(<Sonde base={base} entrees={entreesDemoSuivi(T0)} maintenant={T0} lu debutDemo={T0} sortie={sortie} />);
    expect(sortie.nonLues).toBe(4);
    expect(base.m.size).toBe(0);
  });
});

// ------------------------------------------------------------------ récap

describe('récap du jour et de la semaine', () => {
  const journal = () => {
    const s2 = { session: 'sess-b', projet: 'hub' };
    return [
      ev(60 * 24 * 3, { session: 'vieux', projet: 'carnet' }), // il y a 3 jours
      ev(120, { type: 'debut-session' }), ev(119, { texte: 'Ajoute un export (mot_de_passe=hunter2)' }),
      ev(118, { type: 'outil', outil: 'Read' }), ev(117, { type: 'outil', outil: 'Edit', echec: true }), ev(116, { type: 'outil', outil: 'Edit' }),
      ev(115, { type: 'attente' }), ev(105, { type: 'outil', outil: 'Bash' }), ev(104, { type: 'fin-reponse' }),
      ev(30, { ...s2, texte: 'Pousse la branche' }), ev(29, { ...s2, type: 'outil', outil: 'Bash' }), ev(28, { ...s2, type: 'fin-reponse' }),
    ];
  };

  it('compte sessions, demandes, outils, temps actif, projets, outils, faits marquants', () => {
    const r = calculerRecap(journal(), T0, 'jour');
    expect(r).toMatchObject({ sessions: 2, demandes: 2, outils: 5, erreurs: { total: 1 }, attentes: { total: 1, plusLongueMs: 10 * 60_000, projet: 'budget' } });
    expect(r.projets.map(p => p.nom)).toEqual(['budget', 'hub']);
    expect(r.outilsTop[0]).toEqual({ nom: 'Bash', n: 2 });
    expect(r.plusLongues[0]).toMatchObject({ projet: 'budget', dureeMs: 16 * 60_000 });
    // Écarts de plus de 5 min ignorés (l'attente de 10 min) : budget 6 min, hub 2 min.
    expect(r.actifMs).toBe((6 + 2) * 60_000);
    expect(phraseRecap(r)).toBe('2 sessions · 2 demandes · 8 min d’activité · 2 projets');
    const f = faitsMarquants(r);
    expect(f[0]).toMatch(/^Session la plus longue : budget, 16 min/);
    expect(f.join('\n')).toMatch(/1 erreur d’outil \(surtout budget : 1\)/);
    expect(f.join('\n')).toMatch(/1 attente de ta réponse \(la plus longue : 10 min, budget\)/);
    const semaine = calculerRecap(journal(), T0, 'semaine');
    expect(semaine.sessions).toBe(3);
    expect(semaine.projets.map(p => p.nom)).toContain('carnet');
    expect(phraseRecap(calculerRecap([], T0, 'jour'))).toMatch(/Pas encore d’activité/);
  });

  it('exports texte, Markdown et JSON : secrets masqués, JSON valide', () => {
    const r = calculerRecap(journal(), T0, 'jour');
    for (const e of [exporterRecapTexte(r), exporterRecapMarkdown(r), exporterRecapJson(r)]) {
      expect(e).not.toContain('hunter2');
      expect(e).toContain('budget');
    }
    expect(exporterRecapMarkdown(r)).toMatch(/\| budget \| 1 \| 1 \|/);
    const json = JSON.parse(exporterRecapJson(r));
    expect(json).toMatchObject({ format: 'claude-office-recap', version: 1, sessions: 2 });
    expect(exporterRecapTexte(r).split('\n')[0]).toMatch(/^Récap du /);
  });
});

// ------------------------------------------------------------------ raccourcis

describe('raccourcis clavier', () => {
  const champ = (tagName: string, extra: object = {}) => ({ tagName, ...extra });
  it('touches → actions ; majuscules comprises', () => {
    expect(actionClavier({ key: '?' })).toBe('aide');
    expect(actionClavier({ key: 'b' })).toBe('onglet-bureau');
    expect(actionClavier({ key: 'H' })).toBe('onglet-historique');
    expect(actionClavier({ key: 's' })).toBe('onglet-stats');
    expect(actionClavier({ key: '/' })).toBe('recherche');
    expect(actionClavier({ key: 'f' })).toBe('plein-ecran');
    expect(actionClavier({ key: 'Escape' })).toBe('fermer');
    expect(actionClavier({ key: 'j' })).toBe('agent-suivant');
    expect(actionClavier({ key: 'K' })).toBe('agent-precedent');
    expect(actionClavier({ key: 'x' })).toBeUndefined();
    expect(RACCOURCIS.map(r => r.action)).toHaveLength(9);
  });

  it('jamais actifs pendant la saisie ni avec Ctrl, Cmd, Alt', () => {
    for (const cible of [champ('INPUT'), champ('TEXTAREA'), champ('SELECT'), champ('DIV', { isContentEditable: true }), champ('DIV', { getAttribute: () => 'textbox' })]) {
      expect(estEnSaisie(cible)).toBe(true);
      expect(actionClavier({ key: 'b', target: cible })).toBeUndefined();
      expect(actionClavier({ key: 'Escape', target: cible })).toBeUndefined();
    }
    expect(estEnSaisie(champ('INPUT', { type: 'checkbox' }))).toBe(false);
    expect(actionClavier({ key: 'b', target: champ('BUTTON') })).toBe('onglet-bureau');
    expect(actionClavier({ key: 'f', ctrlKey: true })).toBeUndefined();
    expect(actionClavier({ key: 'k', metaKey: true })).toBeUndefined();
    expect(actionClavier({ key: 'j', altKey: true })).toBeUndefined();
    expect(actionClavier({ key: 'j', isComposing: true })).toBeUndefined();
  });

  it('agent suivant / précédent en boucle ; bus : le plus récent écouteur d’abord, faux sans écouteur', () => {
    expect(agentVoisin(['a', 'b', 'c'], undefined, 1)).toBe('a');
    expect(agentVoisin(['a', 'b', 'c'], undefined, -1)).toBe('c');
    expect(agentVoisin(['a', 'b', 'c'], 'c', 1)).toBe('a');
    expect(agentVoisin(['a', 'b', 'c'], 'a', -1)).toBe('c');
    expect(agentVoisin([], 'a', 1)).toBeUndefined();
    expect(emettreOffice('plein-ecran')).toBe(false);
    const vus: string[] = [];
    const r1 = ecouterOffice('plein-ecran', () => void vus.push('ancien'));
    const r2 = ecouterOffice('plein-ecran', () => { vus.push('scène'); return true; });
    expect(emettreOffice('plein-ecran')).toBe(true);
    expect(vus).toEqual(['scène']);
    r2();
    expect(emettreOffice('plein-ecran')).toBe(false);
    r1();
  });
});

// ------------------------------------------------------------------ rendu

const globalPont = globalThis as { applibourse?: unknown };

describe('rendu : onglet Suivi', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }));
  afterEach(() => {
    delete globalPont.applibourse;
    jest.useRealTimers();
  });

  it.each([['sombre', nuit], ['clair', ivoire]])('écran (%s) : onglet « Suivi », démo partagée → pastille, alertes, récap, équipe, notes', async (_nom, theme) => {
    {
      const base = fausseBase();
      await render(<ClaudeOffice contexte={{ baseProfil: base } as ContexteHub} theme={theme} registre={REGISTRE} onRetour={jest.fn()} />);
      await act(async () => undefined);
      await fireEvent.press(screen.getByTestId('bureau-demo'));
      await act(async () => void jest.advanceTimersByTime(5_000));
      expect(screen.getByTestId('claude-office-onglet-suivi')).toBeTruthy();
      expect(screen.getByText(/Suivi · 4/)).toBeTruthy();
      await fireEvent.press(screen.getByTestId('claude-office-onglet-suivi'));
      expect(screen.getByTestId('suivi-demo')).toBeTruthy();
      expect(screen.getByTestId('suivi-recap')).toBeTruthy();
      expect(screen.getByTestId('recap-phrase').props.children.join('')).toMatch(/sessions? · .* \(démo\)/);
      await fireEvent.press(screen.getByTestId('suivi-section-alertes'));
      for (const r of ['attente', 'erreurs', 'fini', 'session-longue']) expect(screen.getAllByTestId(`alerte-${r}`).length).toBeGreaterThan(0);
      // Le journal ouvert est lu : plus de pastille.
      expect(screen.queryByText(/Suivi · /)).toBeNull();
      await fireEvent.press(screen.getByTestId('suivi-section-equipe'));
      expect(screen.getByTestId('equipe-projet-boutique')).toBeTruthy();
      expect(screen.getAllByText('Bob').length).toBeGreaterThan(0);
      await fireEvent.press(screen.getByTestId('suivi-section-notes'));
      expect(screen.getByText(/les tests échouent sur la CI/)).toBeTruthy();
      // Démo : rien n'est écrit dans la base (ni équipe, ni notes, ni alertes).
      expect([...base.m.keys()].filter(k => /equipe|notes|alertes\.journal/.test(k))).toEqual([]);
    }
  });

  it('Équipe : personnaliser un projet (surnom, couleur, accessoire), favori, rangé dans la base', async () => {
    const base = fausseBase();
    brancherMagasinSuivi(base);
    const entrees = [ev(5, { projet: 'budget' }), ev(4, { projet: 'hub', session: 'sess-h' })];
    const alertes = { reglages: REGLAGES_DEFAUT, journal: [], nonLues: 0, changerReglages: jest.fn(), toutLu: jest.fn(), vider: jest.fn() };
    await render(<Suivi theme={nuit} contexte={{ baseProfil: base } as ContexteHub} section="equipe" alertes={alertes} maintenant={T0} activite={{ entrees, references: {} }} />);
    await act(async () => undefined);
    expect(screen.getByTestId('equipe-projet-budget')).toBeTruthy();
    expect(screen.getByTestId('equipe-session-sess-h')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('equipe-favori-hub'));
    expect(JSON.parse(base.m.get(CLE_EQUIPE)!).projets.hub).toEqual({ favori: true });
    await fireEvent.press(screen.getByTestId('equipe-modifier-budget'));
    expect(screen.getByTestId('equipe-editeur')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('equipe-surnom'), 'Félix');
    await fireEvent.press(screen.getByTestId('equipe-couleur-E94F9B'));
    await fireEvent.press(screen.getByTestId('equipe-accessoire-couronne'));
    expect(screen.getByTestId('equipe-apercu-nom').props.children).toBe('Félix (budget)');
    await fireEvent.press(screen.getByTestId('equipe-enregistrer'));
    expect(JSON.parse(base.m.get(CLE_EQUIPE)!).projets.budget).toEqual({ surnom: 'Félix', couleur: '#E94F9B', accessoire: 'couronne' });
    expect(screen.getAllByText('Félix')).toHaveLength(2);
    expect(screen.queryByTestId('equipe-editeur')).toBeNull();
  });

  const alertesFactices = (changer = jest.fn()) => ({ reglages: REGLAGES_DEFAUT, journal: [], nonLues: 0, changerReglages: changer, toutLu: jest.fn(), vider: jest.fn() });
  const propsAlertes = { theme: ivoire, contexte: {} as ContexteHub, section: 'alertes' as const, maintenant: T0, activite: { entrees: [], references: {} } };

  it('Alertes : réglages (activée, seuil, pastille) ; pas de notification de Windows hors du PC', async () => {
    const changer = jest.fn();
    await render(<Suivi {...propsAlertes} alertes={alertesFactices(changer)} />);
    expect(screen.getByTestId('alertes-vide')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('alertes-active-fini'));
    expect(changer).toHaveBeenLastCalledWith(expect.objectContaining({ fini: { ...REGLAGES_DEFAUT.fini, active: false } }));
    await fireEvent.press(screen.getByTestId('alertes-regler-attente'));
    await fireEvent.press(screen.getByTestId('alertes-seuil-attente-10'));
    expect(changer).toHaveBeenLastCalledWith(expect.objectContaining({ attente: { ...REGLAGES_DEFAUT.attente, seuil: 10 } }));
    expect(screen.getByTestId('alertes-badge-attente')).toBeTruthy();
    expect(screen.queryByTestId('alertes-notifier-attente')).toBeNull();
  });

  it('Alertes : sur le PC, la notification de Windows est proposée', async () => {
    const office = { historique: { lire: jest.fn(async () => ({ ok: true, entrees: [] })) } } as never;
    await render(<Suivi {...propsAlertes} office={office} alertes={alertesFactices()} />);
    await act(async () => undefined);
    await fireEvent.press(screen.getByTestId('alertes-regler-attente'));
    expect(screen.getByTestId('alertes-notifier-attente')).toBeTruthy();
  });

  it('Récap : copier (texte) ; sans presse-papiers, le texte s’affiche à sélectionner', async () => {
    const base = fausseBase();
    const ecrit = jest.fn(async (_t: string) => undefined);
    (globalThis as { navigator?: unknown }).navigator = { clipboard: { writeText: ecrit } };
    const alertes = { reglages: REGLAGES_DEFAUT, journal: [], nonLues: 0, changerReglages: jest.fn(), toutLu: jest.fn(), vider: jest.fn() };
    await render(<Suivi theme={nuit} contexte={{ baseProfil: base } as ContexteHub} debutDemo={T0} alertes={alertes} maintenant={T0} activite={{ entrees: [], references: {} }} />);
    await fireEvent.press(screen.getByTestId('recap-copier-texte'));
    await act(async () => undefined);
    expect(ecrit).toHaveBeenCalledWith(expect.stringMatching(/^Récap du /));
    expect(ecrit.mock.calls[0][0]).not.toContain('sk-ant-demo');
    expect(screen.getByTestId('recap-message').props.children).toMatch(/copié/);
    (globalThis as { navigator?: unknown }).navigator = {};
    await fireEvent.press(screen.getByTestId('recap-copier-markdown'));
    await act(async () => undefined);
    expect(screen.getByTestId('recap-texte').props.children).toMatch(/^## Récap du /);
    await fireEvent.press(screen.getByTestId('recap-periode-semaine'));
    expect(screen.getByTestId('suivi-recap')).toBeTruthy();
    delete (globalThis as { navigator?: unknown }).navigator;
  });

  it('Notes : ajoutée depuis le détail d’un agent', async () => {
    const base = fausseBase();
    brancherMagasinSuivi(base);
    const entrees = [ev(5, { texte: 'Corrige le bug' }), ev(4, { type: 'outil', outil: 'Edit' })];
    const agent = deduireBureau(entrees, { maintenant: T0 }).agents[0];
    await render(<DetailAgent theme={nuit} agent={agent} entrees={entrees} maintenant={T0} onFermer={jest.fn()} />);
    await fireEvent.press(screen.getByTestId('note-modifier-sess-a'));
    await fireEvent.changeText(screen.getByTestId('note-champ-sess-a'), 'Bug corrigé, à vérifier');
    await fireEvent.press(screen.getByTestId('note-enregistrer-sess-a'));
    expect(screen.getByTestId('note-texte-sess-a')).toBeTruthy();
    expect(JSON.parse(base.m.get(CLE_NOTES)!)['sess-a'].texte).toBe('Bug corrigé, à vérifier');
  });

  it('Notes : retrouvées par la recherche (sans accents ni casse)', async () => {
    brancherMagasinSuivi(fausseBase());
    modifierNote('sess-a', 'Bug corrigé, à vérifier', 'budget');
    await render(<Suivi theme={nuit} contexte={{} as ContexteHub} section="notes" alertes={alertesFactices()} maintenant={T0} activite={{ entrees: [], references: {} }} />);
    expect(screen.getByTestId('notes-ligne-sess-a')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('suivi-notes-recherche'), 'VERIFIER');
    expect(screen.getByTestId('notes-ligne-sess-a')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('suivi-notes-recherche'), 'introuvable');
    expect(screen.getByTestId('notes-vide')).toBeTruthy();
  });

  it('aide des raccourcis : chaque raccourci listé, avec sa description', async () => {
    await render(<AideRaccourcis theme={ivoire} visible onFermer={jest.fn()} />);
    expect(screen.getByTestId('raccourcis-aide')).toBeTruthy();
    for (const r of RACCOURCIS) expect(screen.getByText(r.description)).toBeTruthy();
    expect(screen.getByText(/Inactifs pendant la saisie/)).toBeTruthy();
  });
});

describe('droits inchangés', () => {
  it('Fondateur seul : un ami, un administrateur ne voient ni la tuile ni donc l’onglet Suivi', () => {
    const controle = { onCreerCompte: () => undefined } as unknown as ContexteHub['profils'];
    const compte = (role: Profil['role']): Profil => ({ id: 'abcdef1234', nom: 'Lucas', admin: false, creeLe: '', apps: [ID_CLAUDE_OFFICE], actif: true, role });
    const voit = (p: Profil) => appsVisibles(REGISTRE, { profil: p, profils: controle }).some(a => a.id === ID_CLAUDE_OFFICE);
    expect(voit(compte('fondateur'))).toBe(true);
    expect(voit(compte('ami'))).toBe(false);
    expect(voit(compte('administrateur'))).toBe(false);
    expect(APP_CLAUDE_OFFICE.adminSeulement).toBe(true);
  });

  it('démo de l’équipe : sessions et notes fictives liées aux sessions de la démo', () => {
    expect(equipeDemo().projets.facturation?.favori).toBe(true);
    expect(entreesDemoSuivi(T0).some(e => e.session === SESSION_DEMO_ATTENTE && e.type === 'attente')).toBe(true);
  });
});
