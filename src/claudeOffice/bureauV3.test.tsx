/**
 * Claude Office v3 : zones thématiques (outil → zone, rafales), « attend ta
 * réponse », salle d'attente (délai réel, « vu » local), résumé du jour,
 * statistiques, chronologie, check-list de mise en route, réglages de
 * l'appareil, et leur rendu (détail, liste par zone, filtres, aide,
 * statistiques, historique filtré, démo).
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import { BureauVisuel, OngletBureau } from './Bureau';
import { compterBureau, deduireBureau, DELAI_SALLE_DEFAUT_MS, recapFin } from './logiqueBureau';
import type { EntreeHistorique } from './logiqueHistorique';
import { COPIE_ANCIENNE_MS, etapesMiseEnRoute, toutEstPret } from './logiqueMiseEnRoute';
import { calculerStatistiques, chronologieSession, historiqueDemo, phraseAujourdhui, resumeAujourdhui } from './logiqueStats';
import { CLE_PREFS_OFFICE, delaiSalleMs, ecrirePrefsOffice, lirePrefsOffice, MAX_VUS } from './prefsOffice';
import type { PontClaudeOffice, PontHistorique } from './pont';
import { ClaudeOffice } from './Racine';
import { REGISTRE } from '../hub/registre';
import { Statistiques } from './Statistiques';
import type { DepotActivite } from './synchroHistorique';
import { CORRESPONDANCE_OUTILS, ZONES, zoneOutil, zoneVoulue } from './zones';

const theme = themeHub('nuit');
const T0 = Date.parse('2026-10-07T10:00:00Z');
const il = (s: number) => new Date(T0 - s * 1000).toISOString();
let n = 0;
const ev = (ts: string, extra: Partial<EntreeHistorique> = {}): EntreeHistorique => ({
  v: 1, id: `v${++n}`, ts, type: 'demande', appareil: 'PC-bureau', appareilId: 'aaaaaaaaaaaa', session: 'sess-a', projet: 'budget', ...extra,
});
const fausseBase = () => {
  const m = new Map<string, string>();
  return { lire: (c: string) => m.get(c), ecrire: (c: string, v: string) => void m.set(c, v), m };
};

describe('zones : outil → zone, rafales', () => {
  it('table de correspondance centralisée, outils MCP compris, inconnus à l’atelier', () => {
    expect(zoneOutil('Edit')).toBe('atelier');
    expect(zoneOutil('MultiEdit')).toBe('atelier');
    expect(zoneOutil('NotebookEdit')).toBe('atelier');
    expect(zoneOutil('Bash')).toBe('machines');
    expect(zoneOutil('PowerShell')).toBe('machines');
    expect(zoneOutil('Read')).toBe('bibliotheque');
    expect(zoneOutil('Grep')).toBe('bibliotheque');
    expect(zoneOutil('Glob')).toBe('bibliotheque');
    expect(zoneOutil('WebFetch')).toBe('cafe');
    expect(zoneOutil('WebSearch')).toBe('cafe');
    expect(zoneOutil('mcp__Claude_Browser__navigate')).toBe('cafe');
    expect(zoneOutil('Task')).toBe('reunion');
    expect(zoneOutil('TodoWrite')).toBe('reunion');
    expect(zoneOutil('ExitPlanMode')).toBe('reunion');
    expect(zoneOutil('mcp__github__search_code')).toBe('bibliotheque');
    expect(zoneOutil('mcp__inconnu__faire')).toBe('atelier');
    expect(zoneOutil(undefined)).toBe('atelier');
    // Chaque ligne de la table est documentée par des exemples, et ses exemples y mènent.
    for (const c of CORRESPONDANCE_OUTILS) for (const x of c.exemples.split(', ').filter(e => /^[A-Z][a-zA-Z]+$/.test(e))) expect(zoneOutil(x)).toBe(c.zone);
  });

  it('zone voulue : état d’abord, puis vote de la dernière rafale (les plus récents pèsent plus)', () => {
    const o = (s: number, outil: string) => ev(il(s), { type: 'outil', outil });
    expect(zoneVoulue([o(5, 'Read')], 'outil', true)).toBe('salle');
    expect(zoneVoulue([o(5, 'Read')], 'attend', false)).toBe('guichet');
    expect(zoneVoulue([ev(il(5), { type: 'debut-session' })], 'inactif', false)).toBe('accueil');
    expect(zoneVoulue([ev(il(50)), ev(il(5), { type: 'fin-reponse' })], 'inactif', false)).toBe('detente');
    expect(zoneVoulue([ev(il(5))], 'reflechit', false)).toBe('reflexion');
    // Rafale de lectures puis une écriture récente : l'écriture gagne (récence) ; trois lectures récentes contre une : la bibliothèque.
    expect(zoneVoulue([o(18, 'Read'), o(14, 'Grep'), o(10, 'Glob'), o(1, 'Edit')], 'ecrit', false)).toBe('atelier');
    expect(zoneVoulue([o(4, 'Edit'), o(3, 'Read'), o(2, 'Grep'), o(1, 'Read')], 'outil', false)).toBe('bibliotheque');
    // Outils hors de la rafale (plus de 20 s avant le dernier) : ignorés.
    expect(zoneVoulue([o(60, 'Bash'), o(59, 'Bash'), o(58, 'Bash'), o(2, 'WebFetch')], 'outil', false)).toBe('cafe');
  });
});

describe('attend ta réponse et salle d’attente', () => {
  it('une attente en dernier événement : état « attend », message masqué, priorité dans la liste et les compteurs', () => {
    const e = [
      ev(il(60), { session: 's-code' }), ev(il(5), { session: 's-code', type: 'outil', outil: 'Edit' }),
      ev(il(40), { session: 's-attend' }), ev(il(3), { session: 's-attend', type: 'attente', outil: 'Bash', motif: 'permission', resume: 'Autoriser Bash : export TOKEN=sk-ant-abcdefghijklmnopqrstuvwxyz ?' }),
    ];
    const b = deduireBureau(e, { maintenant: T0 });
    expect(b.agents[0]).toMatchObject({ session: 's-attend', etat: 'attend', zone: 'guichet' });
    expect(b.agents[0].attente).toContain('[secret masqué]');
    expect(compterBureau(b, e, T0)).toMatchObject({ attendent: 1, actifs: 1 });
    // Il répond : l'outil reprend, l'attente disparaît.
    const repris = deduireBureau([...e, ev(il(1), { session: 's-attend', type: 'outil', outil: 'Bash' })], { maintenant: T0 });
    expect(repris.agents.find(a => a.session === 's-attend')?.etat).toBe('outil');
  });

  it('salle d’attente : délai compté depuis la fin RÉELLE (même pour une copie), « vu » local, « jusqu’à vu »', () => {
    const fin = [ev(il(300), { session: 's-f', texte: 'Ajoute un export' }), ev(il(250), { session: 's-f', type: 'outil', outil: 'Edit', resume: 'export.ts' }), ev(il(120), { session: 's-f', type: 'fin-reponse' })];
    const a = deduireBureau(fin, { maintenant: T0 }).agents[0];
    expect(a).toMatchObject({ salle: true, zone: 'salle', fin: T0 - 120_000, etat: 'inactif' });
    expect(a.recap).toContain('Demande : Ajoute un export');
    expect(a.recap).toContain('Fichiers modifiés : export.ts');
    // Délai écoulé (5 min par défaut, depuis la fin, pas depuis l'affichage) : détente.
    expect(deduireBureau(fin, { maintenant: T0 + DELAI_SALLE_DEFAUT_MS }).agents[0]).toMatchObject({ salle: false, zone: 'detente' });
    // Copie du relais déposée bien après la fin : le délai part toujours de la fin.
    expect(deduireBureau(fin, { maintenant: T0 + 4 * 60_000, references: { aaaaaaaaaaaa: T0 + 3 * 60_000 } }).agents[0].salle).toBe(false);
    // « Vu » sur cet appareil : il repart.
    expect(deduireBureau(fin, { maintenant: T0, salle: { delaiMs: 60_000 * 5, vus: new Set([a.cleFin!]) } }).agents[0].salle).toBe(false);
    // « Jusqu'à ce que je l'aie vu » : reste même après des heures… tant que la session n'a pas expiré.
    expect(deduireBureau(fin, { maintenant: T0 + 2 * 3_600_000, salle: { delaiMs: null } }).agents[0].salle).toBe(true);
    // Session fermée et vue : elle quitte la salle (le personnage repart avec son carton).
    const ferme = [...fin.slice(0, 2), ev(il(100), { session: 's-f', type: 'fin-session' })];
    const f = deduireBureau(ferme, { maintenant: T0 }).agents[0];
    expect(f).toMatchObject({ etat: 'termine', salle: true });
    expect(deduireBureau(ferme, { maintenant: T0, salle: { delaiMs: null, vus: new Set([f.cleFin!]) } }).agents[0]).toMatchObject({ etat: 'termine', salle: false });
  });

  it('récapitulatif : réponse si l’historique la contient, sinon outils et fichiers', () => {
    expect(recapFin([ev(il(9), { texte: 'Fais X' }), ev(il(5), { type: 'fin-reponse', sortie: 'C’est fait, clé sk-ant-abcdefghijklmnop masquée' })])).toMatch(/^Demande : Fais X\nRéponse : C’est fait, clé \[secret masqué\]/);
    expect(recapFin([ev(il(9), { texte: 'Y' }), ev(il(8), { type: 'outil', outil: 'Bash' }), ev(il(7), { type: 'outil', outil: 'Bash' }), ev(il(6), { type: 'outil', outil: 'Write', resume: 'a.ts' })])).toBe('Demande : Y\nOutils : Bash ×2, Write\nFichiers modifiés : a.ts');
  });
});

describe('résumé du jour, statistiques, chronologie', () => {
  const journee = () => [
    ev(new Date(T0 - 3_600_000).toISOString(), { session: 's1', projet: 'budget' }),
    ev(new Date(T0 - 3_600_000 + 120_000).toISOString(), { session: 's1', type: 'outil', outil: 'Edit', duree: 1_000 }),
    ev(new Date(T0 - 3_600_000 + 240_000).toISOString(), { session: 's1', type: 'outil', outil: 'Bash', duree: 5_000 }),
    ev(new Date(T0 - 600_000).toISOString(), { session: 's2', projet: 'hub' }),
    ev(new Date(T0 - 300_000).toISOString(), { session: 's2', projet: 'hub', type: 'outil', outil: 'Edit', duree: 3_000 }),
    ev(new Date(T0 - 2 * 86_400_000).toISOString(), { session: 's0', projet: 'vieux' }),
  ];

  it('aujourd’hui en une ligne : sessions, demandes, temps actif (écarts < 5 min), dernier projet', () => {
    const r = resumeAujourdhui(journee(), T0);
    expect(r).toEqual({ sessions: 2, demandes: 2, actifMs: 240_000 + 300_000, dernierProjet: 'hub' });
    expect(phraseAujourdhui(r)).toBe('Aujourd’hui : 2 sessions · 2 demandes · 9 min d’activité · dernier projet : hub');
    expect(phraseAujourdhui(resumeAujourdhui([], T0))).toMatch(/pas encore/);
  });

  it('statistiques sur 7 et 30 jours : jours, chaleur jour × heure, outils (durée moyenne), projets, sessions', () => {
    const s = calculerStatistiques(journee(), T0, 7);
    expect(s.parJour).toHaveLength(7);
    expect(s.parJour[6].demandes).toBe(2);
    expect(s.totalDemandes).toBe(3);
    expect(s.outils[0]).toEqual({ nom: 'Edit', n: 2, dureeMoyMs: 2_000 });
    expect(s.projets[0].nom).toBe('budget');
    expect(s.chaleur.flat().reduce((a, b) => a + b, 0)).toBe(6);
    expect(s.maxChaleur).toBeGreaterThanOrEqual(1);
    expect(s.sessions).toBe(3);
    expect(s.dureeMoyenneSessionMs).toBe((240_000 + 300_000) / 2);
    expect(calculerStatistiques(journee(), T0, 30).parJour).toHaveLength(30);
    const demo = calculerStatistiques(historiqueDemo(T0), T0, 30);
    expect(demo.totalDemandes).toBeGreaterThan(20);
    expect(demo.outils.every(o => o.dureeMoyMs !== undefined)).toBe(true);
  });

  it('chronologie d’une session : demandes, outils avec durée, réflexions, attentes (dédoublonnées), fin', () => {
    const e = [
      ev(il(200), { session: 'sx', type: 'debut-session', resume: 'startup' }),
      ev(il(190), { session: 'sx', texte: 'Corrige le test' }),
      ev(il(140), { session: 'sx', type: 'outil', outil: 'Read', resume: 'a.ts', duree: 2_000 }),
      ev(il(120), { session: 'sx', type: 'attente', motif: 'permission', resume: 'Autoriser Bash ?' }),
      ev(il(119), { session: 'sx', type: 'attente', motif: 'permission', resume: 'Autoriser Bash ?' }),
      ev(il(100), { session: 'sx', type: 'outil', outil: 'Bash', resume: 'npm test', duree: 9_000, echec: true }),
      ev(il(90), { session: 'sx', type: 'fin-reponse' }),
      ev(il(10), { session: 'autre' }),
    ];
    const c = chronologieSession(e, 'aaaaaaaaaaaa|sx');
    expect(c.etapes.map(x => x.genre)).toEqual(['debut', 'demande', 'reflexion', 'outil', 'reflexion', 'attente', 'outil', 'reponse']);
    expect(c.etapes[2].dureeMs).toBe(48_000);
    expect(c.etapes[6]).toMatchObject({ titre: 'Bash', dureeMs: 9_000, echec: true });
    expect(c).toMatchObject({ demandes: 1, outils: 2, echecs: 1, attentes: 2, dureeOutilsMs: 11_000 });
  });
});

describe('mise en route : check-list d’état réel', () => {
  const base = { maintenant: T0, lu: true, relais: true };
  it('PC : hook absent ou à mettre à jour (action + commande), aucun événement, copie coupée ; tout vert sinon', () => {
    const rouge = etapesMiseEnRoute({ ...base, surPc: true, hook: 'absents', copie: { active: false }, presence: { active: false } });
    expect(rouge.find(e => e.id === 'hook')).toMatchObject({ niveau: 'erreur', action: { genre: 'installer-hook' }, commande: 'npm run office:hooks' });
    expect(rouge.find(e => e.id === 'evenement')).toMatchObject({ niveau: 'erreur', action: { genre: 'demo' } });
    expect(rouge.find(e => e.id === 'copie')).toMatchObject({ niveau: 'attention', action: { genre: 'activer-copie' } });
    expect(toutEstPret(rouge)).toBe(false);
    expect(etapesMiseEnRoute({ ...base, surPc: true, hook: 'incomplet' }).find(e => e.id === 'hook')).toMatchObject({ niveau: 'attention', action: { titre: 'Mettre à jour le hook…' } });
    const vert = etapesMiseEnRoute({ ...base, surPc: true, hook: 'installes', derniereActivite: T0 - 60_000, copie: { active: true, derniere: il(120) }, presence: { active: true } });
    expect(vert.map(e => e.niveau)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(vert[1].titre).toBe('Dernier événement reçu il y a 1 min');
    expect(toutEstPret(vert)).toBe(true);
    // Journal illisible : erreur explicite, « Réessayer ».
    expect(etapesMiseEnRoute({ ...base, surPc: true, hook: 'installes', erreur: 'Journal : EACCES' }).find(e => e.id === 'evenement')).toMatchObject({ niveau: 'erreur', titre: 'Journal illisible', action: { genre: 'reessayer' } });
  });

  it('site : pas de compte principal, relais injoignable, aucune copie (commande à copier), copie ancienne, appareils', () => {
    expect(etapesMiseEnRoute({ ...base, surPc: false, relais: false })[0]).toMatchObject({ id: 'relais', niveau: 'erreur' });
    expect(etapesMiseEnRoute({ ...base, surPc: false, erreur: 'Relais : 503', depots: [] })[0]).toMatchObject({ niveau: 'erreur', titre: 'Relais injoignable', action: { genre: 'reessayer' } });
    expect(etapesMiseEnRoute({ ...base, surPc: false, depots: [] }).find(e => e.id === 'copie')).toMatchObject({ niveau: 'erreur', commande: 'npm run office:hooks' });
    const depot = (date: number, genre: DepotActivite['genre'] = 'historique'): DepotActivite => ({ objet: `o-${genre}`, genre, appareilId: 'aaaaaaaaaaaa', appareil: 'PC-BUREAU', date: new Date(date).toISOString(), entrees: [] });
    const vieux = etapesMiseEnRoute({ ...base, surPc: false, depots: [depot(T0 - COPIE_ANCIENNE_MS - 60_000)], derniereActivite: T0 - 2 * 3_600_000 });
    expect(vieux.find(e => e.id === 'copie')).toMatchObject({ niveau: 'attention' });
    expect(vieux.find(e => e.id === 'appareils')?.titre).toBe('Copie venant de : PC-BUREAU (il y a 1 h)');
    expect(vieux.find(e => e.id === 'presence')).toMatchObject({ niveau: 'info' });
    const frais = etapesMiseEnRoute({ ...base, surPc: false, depots: [depot(T0 - 60_000), depot(T0 - 30_000, 'presence')], derniereActivite: T0 - 40_000 });
    expect(toutEstPret(frais)).toBe(true);
  });
});

describe('réglages de l’appareil', () => {
  it('lus avec des valeurs par défaut sûres, « vus » bornés, rien d’inconnu gardé', () => {
    const b = fausseBase();
    expect(lirePrefsOffice(b)).toEqual({ vue: 'scene', delaiSalle: 5, vus: [], notifierAttente: false });
    b.ecrire(CLE_PREFS_OFFICE, '{pas du json');
    expect(lirePrefsOffice(b).vue).toBe('scene');
    ecrirePrefsOffice(b, { vue: 'liste', delaiSalle: 'vu', vus: Array.from({ length: MAX_VUS + 10 }, (_, i) => `v${i}`), notifierAttente: true });
    const p = lirePrefsOffice(b);
    expect(p).toMatchObject({ vue: 'liste', delaiSalle: 'vu', notifierAttente: true });
    expect(p.vus).toHaveLength(MAX_VUS);
    expect(delaiSalleMs('vu')).toBeNull();
    expect(delaiSalleMs(10)).toBe(600_000);
  });
});

// ------------------------------------------------------------------ rendu

const journal = () => [
  ev(il(300), { session: 'sess-fini', projet: 'budget', texte: 'Ajoute un export CSV' }),
  ev(il(250), { session: 'sess-fini', projet: 'budget', type: 'outil', outil: 'Edit', resume: 'export.ts', duree: 1_200 }),
  ev(il(60), { session: 'sess-fini', projet: 'budget', type: 'fin-reponse' }),
  ev(il(200), { session: 'sess-attend', projet: 'hub', texte: 'Pousse la branche' }),
  ev(il(5), { session: 'sess-attend', projet: 'hub', type: 'attente', motif: 'permission', outil: 'Bash', resume: 'Autoriser Bash (git push) ?' }),
  ev(il(30), { session: 'sess-lit', projet: 'relais', texte: 'Lis le worker' }),
  ev(il(8), { session: 'sess-lit', projet: 'relais', type: 'outil', outil: 'Read', resume: 'relais.mjs' }),
];

describe('rendu : bureau v3', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }));
  afterEach(() => {
    delete (globalThis as { applibourse?: unknown }).applibourse;
    jest.useRealTimers();
  });

  it('pastilles « attend ta réponse » et « terminés à voir », détail (chronologie), « Marquer comme vu », « Voir dans l’Historique »', async () => {
    const onVoir = jest.fn();
    await render(<BureauVisuel theme={theme} activite={{ entrees: journal(), references: {}, source: { genre: 'local' }, lu: true }} maintenant={T0} mouvementReduit onVoirHistorique={onVoir} />);
    await fireEvent.press(screen.getByTestId('bureau-options'));
    expect(screen.getByTestId('bureau-aujourdhui').props.children).toMatch(/^Aujourd’hui : 3 sessions · 3 demandes/);
    expect(screen.getByTestId('bureau-compte-attendent').props.children).toBe(1);
    expect(screen.getByTestId('bureau-compte-a-voir').props.children).toBe(1);
    expect(screen.getAllByTestId('bureau-etat-agent')[0].props.children).toBe('Attend ta réponse');
    // La pastille ouvre le détail de celui qui attend.
    await fireEvent.press(screen.getByTestId('bureau-pastille-attend'));
    expect(within(screen.getByTestId('bureau-detail-attente')).getByText('Autoriser Bash (git push) ?')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('bureau-detail-fermer'));
    // Terminé à voir : récapitulatif, chronologie avec la durée de l'outil, puis « vu ».
    await fireEvent.press(screen.getByTestId('bureau-pastille-a-voir'));
    expect(screen.getByTestId('bureau-detail-recap')).toBeTruthy();
    expect(within(screen.getByTestId('bureau-detail-chronologie')).getByText(/1 s/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('bureau-detail-vu'));
    expect(screen.queryByTestId('bureau-detail')).toBeNull();
    expect(screen.getByTestId('bureau-compte-a-voir').props.children).toBe(0);
    // « Voir dans l'Historique » : filtré sur la session.
    await fireEvent.press(screen.getByTestId('bureau-agent-sess-lit'));
    await fireEvent.press(screen.getByTestId('bureau-detail-historique'));
    expect(onVoir).toHaveBeenCalledWith({ session: 'sess-lit' });
    // Recherche rapide.
    await fireEvent.changeText(screen.getByTestId('bureau-recherche'), ' export ');
    await fireEvent.press(screen.getByTestId('bureau-recherche-ok'));
    expect(onVoir).toHaveBeenLastCalledWith({ recherche: 'export' });
  });

  it('vue Liste groupée par zone (terminés récemment), filtres par projet (mettre en avant, masquer), aide « ? »', async () => {
    const onPrefs = jest.fn();
    const prefs = { vue: 'liste' as const, delaiSalle: 5 as const, vus: [], notifierAttente: false };
    await render(<BureauVisuel theme={themeHub('ivoire')} activite={{ entrees: journal(), references: {}, source: { genre: 'local' }, lu: true }} maintenant={T0} mouvementReduit prefs={prefs} onPrefs={onPrefs} />);
    expect(screen.queryByTestId('bureau-piece-fixe')).toBeNull();
    expect(screen.getByTestId('bureau-groupe-guichet')).toBeTruthy();
    expect(within(screen.getByTestId('bureau-groupe-salle')).getByText(/Terminés récemment/)).toBeTruthy();
    expect(screen.getByTestId('bureau-groupe-bibliotheque')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('bureau-vue-scene'));
    expect(onPrefs).toHaveBeenCalledWith({ ...prefs, vue: 'scene' });
    await fireEvent.press(screen.getByTestId('bureau-options'));
    await fireEvent.press(screen.getByTestId('bureau-filtre-hub'));
    // Filtre actif : rappelé dans la barre d'outils (et retiré d'un geste).
    expect(screen.getByTestId('bureau-filtre-actif')).toBeTruthy();
    expect(StyleSheet.flatten(screen.getByTestId('bureau-agent-sess-lit').props.style).opacity).toBe(0.45);
    await fireEvent.press(screen.getByTestId('bureau-filtre-mode-masque'));
    expect(screen.queryByTestId('bureau-agent-sess-attend')).toBeNull();
    expect(screen.getByTestId('bureau-agent-sess-lit')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('bureau-filtre-tous'));
    expect(screen.getByTestId('bureau-agent-sess-attend')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('bureau-aide-ouvrir'));
    expect(screen.getByTestId('bureau-aide')).toBeTruthy();
    expect(screen.getByText(/Main levée et « ! » rouge/)).toBeTruthy();
    expect(screen.getByText(/Copie chiffrée · il y a X min/)).toBeTruthy();
  });

  it('PC : réglages mémorisés (délai de la salle, notification désactivée par défaut, puis envoyée une fois par attente)', async () => {
    const notifier = jest.fn(async () => true);
    const entrees = journal().map(e => ({ ...e, ts: new Date(Date.parse(e.ts) - T0 + Date.now()).toISOString() }));
    const historique = { lire: jest.fn(), activite: jest.fn(async () => ({ ok: true, signature: 's', entrees, appareilId: 'aaaaaaaaaaaa' })), installerHooks: jest.fn() } as unknown as PontHistorique;
    (globalThis as { applibourse?: unknown }).applibourse = { bureau: true, systeme: { notifier } };
    const office = { etat: jest.fn(async () => ({ historique: 'incomplet' })), historique } as unknown as PontClaudeOffice;
    const base = fausseBase();
    await render(<OngletBureau theme={theme} contexte={{ baseProfil: base }} office={office} mouvementReduit />);
    await act(async () => undefined);
    expect(screen.getByTestId('mise-en-route-hook-niveau-attention')).toBeTruthy();
    expect(notifier).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('bureau-delai-salle-vu'));
    expect(lirePrefsOffice(base).delaiSalle).toBe('vu');
    await fireEvent.press(screen.getByTestId('bureau-notifier-attente'));
    await act(async () => void jest.advanceTimersByTime(5_000));
    expect(notifier).toHaveBeenCalledTimes(1);
    expect(notifier).toHaveBeenCalledWith('Claude attend ta réponse', 'hub : Autoriser Bash (git push) ?', '');
    await act(async () => void jest.advanceTimersByTime(10_000));
    expect(notifier).toHaveBeenCalledTimes(1);
  });

  it('statistiques : état vide explicite, erreur avec « Réessayer », démo complète', async () => {
    const lire = jest.fn(async () => ({ ok: false, erreur: 'EACCES' }));
    const office = { historique: { lire } } as unknown as PontClaudeOffice;
    await render(<Statistiques theme={theme} contexte={{}} office={office} horloge={() => T0} />);
    await act(async () => undefined);
    expect(screen.getByTestId('stats-erreur')).toBeTruthy();
    expect(screen.getByText(/Journal illisible : EACCES/)).toBeTruthy();
    expect(screen.getByTestId('stats-vide')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('stats-reessayer'));
    expect(lire).toHaveBeenCalledTimes(2);
    await render(<Statistiques theme={themeHub('ivoire')} contexte={{}} debutDemo={T0 - 60_000} horloge={() => T0} />);
    expect(screen.getByTestId('stats-demo')).toBeTruthy();
    expect(screen.getByTestId('stats-barres').props.accessibilityLabel).toMatch(/Requêtes par jour sur 7 jours/);
    await fireEvent.press(screen.getByTestId('stats-periode-30'));
    expect(screen.getByTestId('stats-barres').props.accessibilityLabel).toMatch(/sur 30 jours/);
    expect(screen.getByTestId('stats-chaleur')).toBeTruthy();
    expect(screen.getByTestId('stats-outils-liste')).toBeTruthy();
    expect(screen.getByTestId('stats-projets-liste')).toBeTruthy();
  });

  it('écran : démo partagée (bureau, historique, statistiques), parcours détail → historique filtré sur la session', async () => {
    jest.useRealTimers();
    await render(<ClaudeOffice contexte={{}} theme={theme} registre={REGISTRE} onRetour={jest.fn()} />);
    await act(async () => undefined);
    await fireEvent.press(screen.getByTestId('bureau-demo'));
    await fireEvent.press(screen.getByTestId('claude-office-onglet-stats'));
    expect(screen.getByTestId('stats-demo')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('claude-office-onglet-historique'));
    expect(screen.getByTestId('historique-demo')).toBeTruthy();
    expect(screen.queryByTestId('historique-supprimer-tout')).toBeNull();
    await fireEvent.press(screen.getByTestId('claude-office-onglet-bureau'));
    const carte = screen.getAllByRole('button').find(b => /PC de démo/.test(b.props.accessibilityLabel ?? ''))!;
    await fireEvent.press(carte);
    await fireEvent.press(screen.getByTestId('bureau-detail-historique'));
    expect(screen.getByTestId('historique-filtre-session')).toBeTruthy();
    const compte = Number(screen.getByTestId('historique-compte-sessions').props.children);
    expect(compte).toBe(1);
    await fireEvent.press(screen.getByTestId('historique-filtre-session'));
    expect(Number(screen.getByTestId('historique-compte-sessions').props.children)).toBeGreaterThan(1);
  });

  it('libellés des zones : simples et sans jargon', () => {
    for (const z of Object.values(ZONES)) {
      expect(z.nom.length).toBeLessThan(24);
      expect(z.role).not.toMatch(/hook|PostToolUse|KV/);
    }
  });
});
