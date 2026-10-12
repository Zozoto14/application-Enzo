import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { Profil, RoleProfil } from '../profils/profils';
import { appsVisibles } from '../hub/permissions';
import { REGISTRE } from '../hub/registre';
import { themeHub } from '../hub/themes';
import type { ContexteHub } from '../hub/types';
import type { Espaces, ObjetEspace } from '../sync/relais/espaces';
import { jetonDeProfil } from '../sync/relais/portees';
import { BureauVisuel, OngletBureau } from './Bureau';
import { depuisDepots } from './activiteBureau';
import {
  EXPIRATION_MS, INACTIF_MS, MAX_AGENTS_AFFICHES, compterBureau, deduireBureau, etatDepuis, ilYA, libelleFraicheur, masquerAffichage, phraseAgent,
} from './logiqueBureau';
import type { EntreeHistorique } from './logiqueHistorique';
import type { LectureActivitePc, PontClaudeOffice, PontHistorique } from './pont';
import { APP_CLAUDE_OFFICE, ID_CLAUDE_OFFICE } from './registre';
import { infoClaudeOffice } from './resumeHub';
import {
  CLE_ETAT_PRESENCE, CLE_ETAT_SYNCHRO, DELAI_MIN_PRESENCE_MS, MAX_PRESENCES_JOUR, creerServiceHistorique, lireEtatPresence, lireEtatSynchro, presenceSiDue,
} from './synchroHistorique';

const theme = themeHub('nuit');
const T0 = Date.parse('2026-10-07T10:00:00Z');
const ilYaS = (s: number) => new Date(T0 - s * 1000).toISOString();
let n = 0;
const ev = (ts: string, extra: Partial<EntreeHistorique> = {}): EntreeHistorique => ({
  v: 1, id: `e${++n}`, ts, type: 'demande', appareil: 'PC-bureau', appareilId: 'aaaaaaaaaaaa', session: 'sess-a', projet: 'budget', ...extra,
});

/** Un petit journal : quatre sessions dans des états différents. */
function journal(): EntreeHistorique[] {
  return [
    ev(ilYaS(300), { session: 'sess-ecrit', projet: 'budget', texte: 'Ajoute un export CSV des dépenses' }),
    ev(ilYaS(20), { session: 'sess-ecrit', projet: 'budget', type: 'outil', outil: 'Edit', resume: 'export.ts' }),
    ev(ilYaS(200), { session: 'sess-outil', projet: 'tsuzuku', texte: 'Lance les tests, mon token est ghp_abcdefghijklmnopqrstuvwxyz0123456789' }),
    ev(ilYaS(10), { session: 'sess-outil', projet: 'tsuzuku', type: 'outil', outil: 'Bash', resume: 'npm test' }),
    ev(ilYaS(30), { session: 'sess-pense', projet: 'hub', texte: 'Pourquoi la tuile clignote ?' }),
    ev(ilYaS(900), { session: 'sess-pause', projet: 'relais', texte: 'Relis le worker' }),
    ev(ilYaS(800), { session: 'sess-pause', projet: 'relais', type: 'fin-reponse' }),
  ];
}

describe('bureau : déduction de l’état des agents', () => {
  it('un état par dernier événement : écrit, outil, réfléchit, inactif, terminé', () => {
    const e = (type: string, ageS: number, extra: Partial<EntreeHistorique> = {}) => etatDepuis(ev(ilYaS(ageS), { type, ...extra }), T0);
    expect(e('outil', 10, { outil: 'Edit' })).toBe('ecrit');
    expect(e('outil', 10, { outil: 'Write' })).toBe('ecrit');
    expect(e('outil', 10, { outil: 'Bash' })).toBe('outil');
    expect(e('outil', 120, { outil: 'Bash' })).toBe('reflechit');
    expect(e('demande', 30)).toBe('reflechit');
    expect(e('fin-sous-agent', 30)).toBe('reflechit');
    expect(e('fin-reponse', 5)).toBe('inactif');
    expect(e('debut-session', 5)).toBe('inactif');
    expect(e('demande', INACTIF_MS / 1000 + 1)).toBe('inactif');
    expect(e('fin-session', 5)).toBe('termine');
  });

  it('tri : ceux qui travaillent d’abord, puis par activité récente ; bulle résumée et secrets masqués', () => {
    const b = deduireBureau(journal(), { maintenant: T0 });
    expect(b.agents.map(a => [a.session, a.etat])).toEqual([
      ['sess-ecrit', 'ecrit'],
      ['sess-outil', 'outil'],
      ['sess-pense', 'reflechit'],
      ['sess-pause', 'inactif'],
    ]);
    const outil = b.agents[1];
    expect(outil.demande).toContain('[secret masqué]');
    expect(outil.demande).not.toContain('ghp_abcdef');
    expect(outil).toMatchObject({ outil: 'Bash', resumeOutil: 'npm test', demandes: 1, outils: 1, fige: false });
    expect(phraseAgent(b.agents[0], T0)).toBe('Écrit dans export.ts · à l’instant');
    expect(b.derniereActivite).toBe(T0 - 10_000);
  });

  it('sessions terminées puis rangées, sessions expirées comptées, au plus 12 personnages', () => {
    const fin = [ev(ilYaS(600), { session: 's-fin' }), ev(ilYaS(500), { session: 's-fin', type: 'fin-session' })];
    expect(deduireBureau(fin, { maintenant: T0 }).agents[0].etat).toBe('termine');
    // Terminée depuis plus de 30 min : quitte le bureau.
    expect(deduireBureau(fin, { maintenant: T0 + 40 * 60_000 }).agents).toHaveLength(0);
    // Plus aucun événement depuis 3 h : expirée.
    const vieille = deduireBureau([ev(new Date(T0 - EXPIRATION_MS - 1000).toISOString(), { session: 's-vieille' })], { maintenant: T0 });
    expect(vieille).toMatchObject({ agents: [], expirees: 1 });
    const foule = Array.from({ length: MAX_AGENTS_AFFICHES + 3 }, (_, i) => ev(ilYaS(i + 1), { session: `s${i}` }));
    const b = deduireBureau(foule, { maintenant: T0 });
    expect(b.agents).toHaveLength(MAX_AGENTS_AFFICHES);
    expect(b.enPlus).toBe(3);
  });

  it('copie du relais : état calculé à la date du dépôt, puis figé quand ce dépôt vieillit', () => {
    // Dépôt fait 20 s après un Edit : l'agent écrivait à ce moment-là.
    const depot = T0 - 7 * 60_000;
    const entrees = [ev(new Date(depot - 20_000).toISOString(), { type: 'outil', outil: 'Edit', resume: 'a.ts' })];
    const recent = deduireBureau(entrees, { maintenant: T0, references: { aaaaaaaaaaaa: depot } });
    expect(recent.agents[0]).toMatchObject({ etat: 'ecrit', fige: false, reference: depot });
    // Sans la référence (horloge actuelle), on aurait conclu autre chose : c'est bien la date du dépôt qui compte.
    expect(deduireBureau(entrees, { maintenant: T0 }).agents[0].etat).toBe('reflechit');
    const vieux = deduireBureau(entrees, { maintenant: depot + INACTIF_MS + 60_000, references: { aaaaaaaaaaaa: depot } });
    expect(vieux.agents[0].fige).toBe(true);
    expect(phraseAgent(vieux.agents[0], depot + INACTIF_MS + 60_000)).toMatch(/^Dernier état connu \(il y a 11 min\) : écrit dans a\.ts$/);
  });

  it('compteurs du jour, âge et libellés de fraîcheur, masquage d’appoint', () => {
    const entrees = journal();
    const b = deduireBureau(entrees, { maintenant: T0 });
    expect(compterBureau(b, entrees, T0)).toEqual({ attendent: 0, aVoir: 0, actifs: 3, inactifs: 1, termines: 0, demandesDuJour: 4, outilsDuJour: 2 });
    expect(ilYA(T0 - 10_000, T0)).toBe('à l’instant');
    expect(ilYA(T0 - 7 * 60_000, T0)).toBe('il y a 7 min');
    expect(ilYA(T0 - 3 * 3_600_000, T0)).toBe('il y a 3 h');
    expect(libelleFraicheur({ genre: 'local' }, T0)).toMatch(/^En direct/);
    expect(libelleFraicheur({ genre: 'relais', date: T0 - 7 * 60_000 }, T0)).toBe('Copie chiffrée · à jour il y a 7 min');
    expect(libelleFraicheur({ genre: 'relais' }, T0)).toMatch(/aucun dépôt/);
    expect(masquerAffichage('clé sk-ant-api03-abcdefghijkl et password=hunter2 et https://moi:mdp@exemple.fr')).toBe(
      'clé [secret masqué] et password=[secret masqué] et https://moi:[secret masqué]@exemple.fr',
    );
  });

  it('dépôts du relais : références par appareil, ceux de ce PC exclus', () => {
    const d = (appareilId: string, date: string) => ({ objet: `office-presence-${appareilId}`, genre: 'presence' as const, appareilId, date, entrees: [ev(date, { appareilId })] });
    const r = depuisDepots([d('aaaaaaaaaaaa', '2026-10-07T09:50:00Z'), d('bbbbbbbbbbbb', '2026-10-07T09:55:00Z')], 'aaaaaaaaaaaa');
    expect(r.references).toEqual({ bbbbbbbbbbbb: Date.parse('2026-10-07T09:55:00Z') });
    expect(r.entrees).toHaveLength(1);
    expect(r.date).toBe(Date.parse('2026-10-07T09:55:00Z'));
  });
});

// ------------------------------------------------------------------ relais simulé

function fauxEspaces() {
  const objets = new Map<string, ObjetEspace>();
  const espaces: Espaces & { objets: typeof objets } = {
    objets,
    lister: jest.fn(async () => Object.fromEntries([...objets].map(([nom, o]) => [nom, { date: o.date, taille: o.charge.length, auteur: 'maitre' }]))),
    lire: jest.fn(async (_id: string, nom: string) => objets.get(nom)),
    deposer: jest.fn(async (id: string, nom: string, charge: string, date: string) => {
      expect(id).toBe('principal');
      objets.set(nom, { date, charge, auteur: 'maitre' });
    }),
    supprimer: jest.fn(async (_id: string, nom: string) => void objets.delete(nom)),
  };
  return espaces;
}
const CONFIG = { relais: 'https://relais.test', jeton: 'jeton-maitre-de-test-0123456789', cle: '11'.repeat(32) };
function fausseBase(initial: Record<string, string> = {}) {
  const valeurs = new Map(Object.entries(initial));
  return { valeurs, lire: (c: string) => valeurs.get(c), ecrire: (c: string, v: string) => void valeurs.set(c, v), supprimer: (c: string) => void valeurs.delete(c) };
}

describe('bureau : présence rapide sur le relais (garde-fous)', () => {
  it('désactivée par défaut, exige la copie, chiffrée, sans contenu d’outil, bornée en rythme et par jour', async () => {
    const espaces = fauxEspaces();
    const service = creerServiceHistorique(CONFIG, { espaces })!;
    const base = fausseBase();
    const entrees = [...journal(), ev(ilYaS(5), { type: 'outil', outil: 'Bash', sortie: 'SORTIE-SECRETE', entree: 'ENTREE' })];
    const t = new Date(T0);
    expect(lireEtatPresence(base).active).toBe(false);
    expect((await presenceSiDue({ service, base, appareilId: 'aaaaaaaaaaaa', entrees, maintenant: t })).issue).toBe('desactivee');
    // Présence activée mais copie de l'historique désactivée : toujours rien.
    base.ecrire(CLE_ETAT_PRESENCE, JSON.stringify({ active: true }));
    expect((await presenceSiDue({ service, base, appareilId: 'aaaaaaaaaaaa', entrees, maintenant: t })).issue).toBe('desactivee');
    base.ecrire(CLE_ETAT_SYNCHRO, JSON.stringify({ active: true }));
    expect((await presenceSiDue({ service, base, appareilId: 'aaaaaaaaaaaa', entrees, maintenant: t })).issue).toBe('envoyee');
    const stocke = espaces.objets.get('office-presence-aaaaaaaaaaaa')!;
    for (const clair of ['export CSV', 'budget', 'PC-bureau', 'SORTIE-SECRETE', 'Bash']) expect(stocke.charge).not.toContain(clair);
    // Rythme : pas avant 5 min ; ensuite, rien si l'activité n'a pas changé.
    expect((await presenceSiDue({ service, base, appareilId: 'aaaaaaaaaaaa', entrees: [...entrees, ev(ilYaS(1))], maintenant: new Date(T0 + 60_000) })).issue).toBe('trop-tot');
    expect((await presenceSiDue({ service, base, appareilId: 'aaaaaaaaaaaa', entrees, maintenant: new Date(T0 + DELAI_MIN_PRESENCE_MS) })).issue).toBe('inchangee');
    expect(espaces.deposer).toHaveBeenCalledTimes(1);
    // Plafond quotidien atteint : pause jusqu'au lendemain.
    const jour = lireEtatPresence(base).jour!;
    base.ecrire(CLE_ETAT_PRESENCE, JSON.stringify({ ...lireEtatPresence(base), jour, depotsDuJour: MAX_PRESENCES_JOUR, derniere: new Date(T0 - DELAI_MIN_PRESENCE_MS).toISOString() }));
    expect((await presenceSiDue({ service, base, appareilId: 'aaaaaaaaaaaa', entrees: [...entrees, ev(ilYaS(1))], maintenant: t })).issue).toBe('plafond');

    // Relecture : la présence se rouvre, sans le contenu des outils ; un dépôt inchangé n'est pas relu.
    const lu = await service.lireActivite!({ historique: false });
    expect(lu.erreurs).toEqual([]);
    expect(lu.depots).toHaveLength(1);
    expect(lu.depots[0]).toMatchObject({ genre: 'presence', appareilId: 'aaaaaaaaaaaa', appareil: 'PC-bureau' });
    expect(JSON.stringify(lu.depots[0].entrees)).not.toContain('SORTIE-SECRETE');
    const lectures = (espaces.lire as jest.Mock).mock.calls.length;
    await service.lireActivite!({ historique: false, cache: lu.cache });
    expect((espaces.lire as jest.Mock).mock.calls.length).toBe(lectures);
  });

  it('les copies d’historique ne sont lues que si on les demande (la tuile s’en passe)', async () => {
    const espaces = fauxEspaces();
    const service = creerServiceHistorique(CONFIG, { espaces })!;
    await service.deposer('aaaaaaaaaaaa', journal(), new Date(T0).toISOString());
    expect((await service.lireActivite!({ historique: false })).depots).toHaveLength(0);
    expect(espaces.lire).not.toHaveBeenCalled();
    const tout = await service.lireActivite!({ historique: true });
    expect(tout.depots[0]).toMatchObject({ genre: 'historique', entrees: expect.any(Array) });
  });
});

// ------------------------------------------------------------------ rendu

describe('bureau : rendu', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }));
  afterEach(() => {
    delete (globalThis as { applibourse?: unknown }).applibourse;
    jest.useRealTimers();
  });

  it('agents, états, bulles, compteurs, « en direct » sur le PC ; animations coupées si réduites', async () => {
    await render(<BureauVisuel theme={theme} activite={{ entrees: journal(), references: {}, source: { genre: 'local' }, lu: true }} maintenant={T0} mouvementReduit />);
    expect(screen.getByTestId('bureau-fraicheur')).toBeTruthy();
    expect(screen.getByText(/En direct · journal de ce PC/)).toBeTruthy();
    // Compteurs, résumé et réglages d'affichage : repliés dans « Options ».
    expect(screen.queryByTestId('bureau-compteurs')).toBeNull();
    await fireEvent.press(screen.getByTestId('bureau-options'));
    expect(screen.getByTestId('bureau-compte-actifs').props.children).toBe(3);
    expect(screen.getAllByTestId('bureau-etat-agent').map(t => t.props.children)).toEqual(['Écrit du code', 'Utilise un outil', 'Réfléchit', 'Inactif']);
    const bulles = screen.getAllByTestId('bureau-bulle').map(t => t.props.children);
    expect(bulles[0]).toBe('Ajoute un export CSV des dépenses');
    expect(bulles.join()).not.toContain('ghp_');
    expect(screen.getByTestId('bureau-piece-fixe')).toBeTruthy();
    expect(screen.getByTestId('bureau-mouvement').props.children).toBe('Animations réduites');
    // Détail d'un agent au toucher.
    await fireEvent.press(screen.getByTestId('bureau-agent-sess-outil'));
    expect(screen.getByTestId('bureau-detail')).toBeTruthy();
    expect(screen.getByText(/Bash · npm test/)).toBeTruthy();
  });

  it('copie du relais : âge du dépôt, état figé quand il vieillit', async () => {
    const depot = T0 - 25 * 60_000;
    const entrees = [ev(new Date(depot - 30_000).toISOString(), { session: 'sess-x', type: 'outil', outil: 'Edit', resume: 'a.ts' })];
    await render(<BureauVisuel theme={theme} activite={{ entrees, references: { aaaaaaaaaaaa: depot }, source: { genre: 'relais', date: depot }, lu: true }} maintenant={T0} mouvementReduit />);
    expect(screen.getByText('◷ Copie chiffrée · à jour il y a 25 min')).toBeTruthy();
    expect(screen.getByTestId('bureau-etat-agent').props.children).toBe('Écrit du code (figé)');
  });

  it('bureau vide : état vide, sans aucun dépôt reçu', async () => {
    await render(<BureauVisuel theme={theme} activite={{ entrees: [], references: {}, source: { genre: 'relais' }, lu: true }} maintenant={T0} vide={<></>} mouvementReduit />);
    expect(screen.getByTestId('bureau-vide')).toBeTruthy();
    expect(screen.getByText(/aucun dépôt reçu/)).toBeTruthy();
  });

  it('PC : lecture par le pont (signature repassée, rien relu si inchangé), copie activable depuis le bureau', async () => {
    const entrees = journal().map(e => ({ ...e, ts: new Date(Date.parse(e.ts) - T0 + Date.now()).toISOString() }));
    const activite = jest.fn(async (connu?: string): Promise<LectureActivitePc> =>
      connu === 'sig-1' ? { ok: true, inchange: true, signature: 'sig-1' } : { ok: true, signature: 'sig-1', entrees, appareilId: 'aaaaaaaaaaaa', appareil: null });
    const historique = { lire: jest.fn(), activite, installerHooks: jest.fn() } as unknown as PontHistorique;
    const office = { etat: jest.fn(async () => ({ historique: 'installes' })), historique } as unknown as PontClaudeOffice;
    const fetchEspion = jest.spyOn(globalThis, 'fetch' as never).mockImplementation((() => Promise.reject(new Error('réseau interdit'))) as never);
    const espaces = fauxEspaces();
    const service = creerServiceHistorique(CONFIG, { espaces })!;
    const base = fausseBase();
    await render(<OngletBureau theme={theme} contexte={{ historiqueOffice: service, baseProfil: base }} office={office} mouvementReduit />);
    await act(async () => undefined);
    expect(activite).toHaveBeenNthCalledWith(1, '');
    expect(screen.getAllByTestId('bureau-etat-agent')).toHaveLength(4);
    await act(async () => void jest.advanceTimersByTime(2_000));
    expect(activite).toHaveBeenNthCalledWith(2, 'sig-1');
    expect(historique.lire).not.toHaveBeenCalled();
    // Copie désactivée : ce PC ne lit pas les dépôts des autres.
    expect(espaces.lister).not.toHaveBeenCalled();
    // Présence rapide grisée tant que la copie est coupée.
    expect(screen.getByTestId('bureau-presence-active').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId('bureau-copie-active'));
    expect(lireEtatSynchro(base).active).toBe(true);
    await fireEvent.press(screen.getByTestId('bureau-presence-active'));
    expect(lireEtatPresence(base).active).toBe(true);
    expect(screen.getByTestId('bureau-avertissement')).toBeTruthy();
    expect(fetchEspion).not.toHaveBeenCalled();
    fetchEspion.mockRestore();
  });

  it('PC sans le canal d’activité (application pas à jour) : le journal complet sert', async () => {
    const lire = jest.fn(async () => ({ ok: true, entrees: [ev(new Date().toISOString(), { session: 'sess-z' })], reglages: { appareilId: 'aaaaaaaaaaaa' } }));
    const office = { etat: jest.fn(async () => ({ historique: 'installes' })), historique: { lire } } as unknown as PontClaudeOffice;
    await render(<OngletBureau theme={theme} contexte={{}} office={office} mouvementReduit />);
    await act(async () => undefined);
    expect(lire).toHaveBeenCalled();
    expect(screen.getByTestId('bureau-etat-agent').props.children).toBe('Réfléchit');
  });

  it('PC sans hook : état vide qui propose l’installation, seulement au clic', async () => {
    const installerHooks = jest.fn(async () => ({ ok: false, annule: true }));
    const historique = { lire: jest.fn(), activite: jest.fn(async () => ({ ok: true, signature: 's', entrees: [] })), installerHooks } as unknown as PontHistorique;
    const office = { etat: jest.fn(async () => ({ historique: 'absents' })), historique } as unknown as PontClaudeOffice;
    await render(<OngletBureau theme={theme} contexte={{}} office={office} mouvementReduit />);
    await act(async () => undefined);
    expect(screen.getByTestId('bureau-vide-texte').props.children).toMatch(/hook d’historique n’est pas encore installé/);
    expect(installerHooks).not.toHaveBeenCalled();
    // La check-list « Mise en route » propose l'installation (bouton) et la commande à copier.
    expect(screen.getByTestId('mise-en-route-hook-niveau-erreur')).toBeTruthy();
    expect(screen.getByTestId('mise-en-route-commande-hook')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('mise-en-route-action-hook'));
    expect(installerHooks).toHaveBeenCalledWith(false);
    expect(screen.getByTestId('bureau-message').props.children).toMatch(/Annulé/);
  });

  it('site : lecture de la copie chiffrée simulée, âge affiché, pas de faux direct, aucun accès réseau direct', async () => {
    const fetchEspion = jest.spyOn(globalThis, 'fetch' as never).mockImplementation((() => Promise.reject(new Error('réseau interdit'))) as never);
    const espaces = fauxEspaces();
    const service = creerServiceHistorique(CONFIG, { espaces })!;
    const depot = new Date(Date.now() - 4 * 60_000);
    await service.deposerPresence!('aaaaaaaaaaaa', [ev(new Date(depot.getTime() - 15_000).toISOString(), { session: 'sess-loin', type: 'outil', outil: 'Bash', resume: 'npm test' })], depot.toISOString());
    await render(<OngletBureau theme={theme} contexte={{ historiqueOffice: service, baseProfil: fausseBase() }} mouvementReduit />);
    await act(async () => undefined);
    expect(screen.getByText('◷ Copie chiffrée · à jour il y a 4 min')).toBeTruthy();
    // État au moment du dépôt (outil 15 s avant) : affiché, avec son âge, pas comme du direct.
    expect(screen.getByTestId('bureau-etat-agent').props.children).toBe('Utilise un outil');
    expect(screen.getByTestId('mise-en-route-reduite')).toBeTruthy();
    expect(screen.queryByText(/En direct/)).toBeNull();
    expect(screen.queryByTestId('bureau-partage')).toBeNull();
    // Relu chaque minute (index seulement : le dépôt inchangé n'est pas relu).
    const lectures = (espaces.lire as jest.Mock).mock.calls.length;
    await act(async () => void jest.advanceTimersByTime(60_000));
    expect(espaces.lister).toHaveBeenCalledTimes(2);
    expect((espaces.lire as jest.Mock).mock.calls.length).toBe(lectures);
    expect(fetchEspion).not.toHaveBeenCalled();
    fetchEspion.mockRestore();
  });

  it('site sans service (pas le compte principal) : état vide pédagogique, rien n’est lu', async () => {
    const fetchEspion = jest.spyOn(globalThis, 'fetch' as never).mockImplementation((() => Promise.reject(new Error('réseau interdit'))) as never);
    await render(<OngletBureau theme={theme} contexte={{}} mouvementReduit />);
    await act(async () => undefined);
    expect(screen.getByTestId('bureau-vide-texte').props.children).toMatch(/réservée au compte principal/);
    expect(screen.getByText(/Aucune source d’activité/)).toBeTruthy();
    expect(fetchEspion).not.toHaveBeenCalled();
    fetchEspion.mockRestore();
  });
});

describe('bureau : animations (thème clair)', () => {
  it('sans « réduire les animations », la pièce est animée', async () => {
    await render(<BureauVisuel theme={themeHub('ivoire')} activite={{ entrees: journal(), references: {}, source: { genre: 'local' }, lu: true }} maintenant={T0} mouvementReduit={false} />);
    expect(screen.getByTestId('bureau-piece-animee')).toBeTruthy();
    expect(screen.queryByText('Animations réduites')).toBeNull();
  });
});

// ------------------------------------------------------------------ droits et tuile

describe('bureau : droits et tuile du hub', () => {
  const compte = (role?: RoleProfil): Profil => ({ id: 'abcdef1234', nom: 'Lucas', admin: false, creeLe: '', apps: [ID_CLAUDE_OFFICE], actif: true, role });
  const controle = { onCreerCompte: () => undefined } as unknown as ContexteHub['profils'];

  it('un ami (ou administrateur, gestionnaire) ne voit ni la tuile ni son état ; pas de copie pour un jeton de profil', () => {
    for (const role of ['ami', 'gestionnaire', 'administrateur'] as const) {
      expect(appsVisibles(REGISTRE, { profil: compte(role), profils: controle }).map(a => a.id)).not.toContain(ID_CLAUDE_OFFICE);
      expect(APP_CLAUDE_OFFICE.disponible?.({ profil: compte(role) })).toBe(false);
    }
    expect(creerServiceHistorique({ ...CONFIG, jeton: jetonDeProfil(CONFIG.jeton, 'abcdef1234') })).toBeUndefined();
  });

  it('tuile : agents au travail et fraîcheur (en direct sur le PC, âge ailleurs)', () => {
    expect(APP_CLAUDE_OFFICE.info?.({})).toBeUndefined();
    const local = infoClaudeOffice({ actifs: 2, inactifs: 1, termines: 0, source: { genre: 'local' }, le: T0 });
    expect(local).toEqual({ sousTitre: 'En direct sur ce PC', indicateurs: [{ libelle: 'Au travail', valeur: '2' }, { libelle: 'Inactifs', valeur: '1' }] });
    const distant = APP_CLAUDE_OFFICE.info?.({ claudeOffice: { actifs: 0, inactifs: 0, termines: 0, source: { genre: 'relais', date: T0 - 12 * 60_000 }, le: T0 } });
    expect(distant?.sousTitre).toBe('Copie chiffrée · à jour il y a 12 min');
    expect(distant?.pastille).toBe('DIFFÉRÉ');
    expect(local?.pastille).toBeUndefined();
  });
});
