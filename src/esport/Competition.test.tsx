/**
 * Tournois et Résultats côté app : section « Compétition », liste et fiche d'un tournoi (création selon le
 * profil du jeu, roster, match ajouté au planning), saisie d'un résultat Valorant (BO3, aperçu de la
 * victoire, refus du serveur traduit), saisie d'un classement multi-équipes (barème), bilans, accueil,
 * phrases du journal et des notifications (FR / EN).
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import { ModeAffichageForce } from '../ui/mobile';
import { CATALOGUE, ErreurEsport, type ClientEsport, type DetailTeam, type Notification } from './client';
import type { DetailTournoi, FormulaireResultat, ListeResultats, ListeTournois, Resultat } from './competition/api';
import { apercuSerie, lireStatsTexte, systemeDe } from './competition/score';
import { definirLangue } from './i18n';
import { phraseJournal, phraseNotification } from './libelles';
import { fauxPlanning } from './planning/faux';
import { groupeDe, PageTeam, sectionsTeam } from './ui/PageTeam';

const theme = themeHub('nuit');
const MODULES = ['activity_log', 'planning', 'scouting', 'tournois', 'resultats'];
const STAFF = ['members.view', 'planning.view', 'planning.create', 'planning.update', 'planning.delete', 'scouting.view', 'tournois.voir', 'tournois.gerer', 'resultats.voir', 'resultats.saisir'];
const JOUEUR = ['members.view', 'planning.view', 'tournois.voir', 'resultats.voir'];
const TOURNOI = '11111111-1111-4111-8111-111111111111';
const MATCH = '22222222-2222-4222-8222-222222222222';
const NOVA = '33333333-3333-4333-8333-333333333333';
const RES = '44444444-4444-4444-8444-444444444444';

function detail(permissions: string[], modules = MODULES): DetailTeam {
  return {
    team: { id: 't1', nom: 'Faucons', slug: 'faucons', jeu: 'valorant', description: '', logoUrl: null, fuseau: 'Europe/Paris', creeLe: '', archivee: false },
    modules: CATALOGUE.modules.map(m => ({ cle: m.cle, active: modules.includes(m.cle) })),
    membres: 6,
    moi: { membreId: 'm1', role: { id: 'r1', nom: 'Coach', couleur: '#2563eb', cle: 'coach' }, permissions, superAdmin: false },
  };
}

const FORMAT_5V5 = { cle: '5v5', nom: '5v5', libelle: '5v5', equipes: 2, joueursParEquipe: 5, bo: [1, 3, 5] };
const MEMBRES = ['lea12345', 'kai12345', 'tom12345', 'sam12345', 'ivy12345', 'rem12345'].map(c => ({ compte: c, pseudo: c.slice(0, 3) }));

function tournoi(): DetailTournoi['tournoi'] {
  return {
    id: TOURNOI,
    nom: 'Coupe d’automne',
    organisateur: 'Ligue Exemple',
    lien: 'https://tournois-exemple.fr/coupe',
    jeu: 'valorant',
    format: FORMAT_5V5,
    formatCle: '5v5',
    bo: 3,
    debut: '2026-10-24',
    fin: '2026-10-25',
    enLigne: true,
    lieu: '',
    phases: [{ cle: 'p1', type: 'poules', nom: 'Poules' }],
    fraisCentimes: 2550,
    cashprizeCentimes: 150000,
    devise: 'EUR',
    cashprizeDetails: '',
    statut: 'inscrit',
    inscription: { limite: '2026-10-22T21:59:00.000Z', inscritLe: '2026-10-20T10:00:00.000Z' },
    checkin: { ouverture: null, limite: null, faitLe: null },
    classementFinal: null,
    participants: null,
    gainsCentimes: null,
    gainsNotes: '',
    notes: '',
    publiable: true,
    roster: [{ compte: 'lea12345', pseudo: 'Léa', role: 'titulaire' }],
    creeLe: '',
    majLe: '',
  };
}

function detailTournoi(droitsGerer: boolean): DetailTournoi {
  return {
    tournoi: tournoi(),
    matchs: [
      { id: MATCH, phase: 'p1', tour: 'Poule A', ordre: 0, debut: '2026-10-24T18:00:00.000Z', fin: '2026-10-24T19:30:00.000Z', bo: 3, adversaires: [{ id: NOVA, nom: 'Nova', logoUrl: null }], statut: 'a_jouer', issue: null, issueRapide: null, scoreTexte: '', place: null, resultatId: null, aResultat: false, evenementId: 'ev1', notes: '' },
    ],
    bilan: { joues: 0, victoires: 0, defaites: 0, nuls: 0 },
    rosterTaille: { titulairesMin: 5, titulairesMax: 5, remplacantsMax: 2 },
    droits: { gerer: droitsGerer, planning: true, planifier: droitsGerer, resultats: true, saisirResultats: droitsGerer, scouting: droitsGerer },
    jeu: { cle: 'valorant', nom: 'Valorant', couleur: '#ff4655', formats: [FORMAT_5V5], score: { type: 'rounds' }, roster: { titulairesMin: 5, titulairesMax: 5, remplacantsMax: 2 }, membres: MEMBRES },
    modules: { planning: true, resultats: true },
  };
}

function resultat(): Resultat {
  return {
    id: RES,
    genre: 'tournoi',
    tournoi: { id: TOURNOI, nom: 'Coupe d’automne' },
    tournoiMatchId: MATCH,
    tour: 'Poule A',
    evenementId: null,
    occurrence: null,
    date: '2026-10-19T18:00:00.000Z',
    jeu: { cle: 'valorant', nom: 'Valorant', couleur: '#ff4655' },
    format: { cle: '5v5', nom: '5v5', libelle: '5v5' },
    systeme: 'serie',
    bo: 3,
    adversaires: [{ id: NOVA, nom: 'Nova', logoUrl: null }],
    manches: [
      { numero: 1, carte: { cle: 'ascent', nom: 'Ascent' }, mode: null, issue: 'victoire', nous: 13, eux: 9, place: null, points: null, miTemps: null, prolongations: null, enProlongations: false, classement: [] },
      { numero: 2, carte: { cle: 'bind', nom: 'Bind' }, mode: null, issue: 'victoire', nous: 14, eux: 12, place: null, points: null, miTemps: [[6, 6], [6, 6]], prolongations: [2, 0], enProlongations: true, classement: [] },
    ],
    issue: 'victoire',
    forfait: null,
    manchesNous: 2,
    manchesEux: 0,
    place: null,
    points: null,
    participants: null,
    score: '2-0',
    joueurs: [{ compte: 'lea12345', pseudo: 'Léa', personnages: [{ cle: 'jett', nom: 'Jett' }], stats: { kills: 24 }, mvp: true }],
    mvp: { compte: 'lea12345', pseudo: 'Léa' },
    reviewId: null,
    visibilite: 'team',
    publiable: true,
    notes: '',
    saisiPar: 'coach123',
    creeLe: '',
    majLe: '',
  };
}

const BILAN: ListeResultats['bilan'] = {
  series: { joues: 4, victoires: 3, defaites: 1, nuls: 0, taux: 75 },
  classements: { joues: 0, placeMoyenne: null, top1: 0, top3: 0 },
  parCarte: [{ cle: 'ascent', nom: 'Ascent', joues: 3, victoires: 2, defaites: 1, nuls: 0, taux: 67, classements: { joues: 0, placeMoyenne: null } }],
  parAdversaire: [{ id: NOVA, nom: 'Nova', joues: 2, victoires: 2, defaites: 0, nuls: 0, taux: 100 }],
  forme: ['V', 'V', 'D', 'V'],
  enCours: { issue: 'victoire', n: 2 },
  recordVictoires: 2,
  recordDefaites: 1,
  rounds: { pour: 95, contre: 78 },
};

function formulaire(classement = false): FormulaireResultat {
  return {
    jeu: classement
      ? {
          cle: 'the-finals',
          nom: 'The Finals',
          couleur: '#d31f3c',
          formats: [{ cle: '3v3v3v3', nom: '3v3v3v3', libelle: '3v3v3v3', equipes: 4, joueursParEquipe: 3, bo: [1] }],
          score: { type: 'placement', bareme: [{ place: 1, points: 10 }, { place: 2, points: 6 }] },
          systeme: 'classement',
          cartes: [{ cle: 'monaco', nom: 'Monaco', actif: true, modes: [] }],
          modes: [],
          personnages: [{ cle: 'light', nom: 'Light', actif: true }],
          roster: { titulaires: 3, remplacants: 1 },
          libelles: {},
        }
      : {
          cle: 'valorant',
          nom: 'Valorant',
          couleur: '#ff4655',
          formats: [FORMAT_5V5],
          score: { type: 'rounds', roundsGagnants: 13, roundsParMiTemps: 12, prolongations: { active: true, regle: '' } },
          systeme: 'serie',
          cartes: [{ cle: 'ascent', nom: 'Ascent', actif: true, modes: [] }, { cle: 'bind', nom: 'Bind', actif: true, modes: [] }],
          modes: [{ cle: 'competition', nom: 'Compétition', formats: ['5v5'], actif: true }],
          personnages: [{ cle: 'jett', nom: 'Jett', actif: true }],
          roster: { titulaires: 5, remplacants: 2 },
          libelles: { personnages: 'Agents', cartes: 'Maps' },
        },
    membres: MEMBRES,
    matchsTournoi: [{ id: MATCH, tournoi: { id: TOURNOI, nom: 'Coupe d’automne' }, tour: 'Poule A', debut: '2026-10-19T18:00:00.000Z', bo: 3, formatCle: '5v5', adversaires: [{ id: NOVA, nom: 'Nova' }] }],
    evenements: [],
    reviews: [],
    adversaires: [{ id: NOVA, nom: 'Nova', logoUrl: null }],
    droits: { saisir: true, tournois: true, planning: true, scouting: true, review: false, adversaireRapide: true },
  };
}

async function monter(permissions: string[], section: 'module:tournois' | 'module:resultats' | 'accueil', { classement = false, refus = false } = {}) {
  const f = fauxPlanning(permissions);
  const appels: Array<{ chemin: string; methode: string; corps?: unknown }> = [];
  const gerer = permissions.includes('tournois.gerer');
  const requete = async <T,>(chemin: string, methode = 'GET', corps?: unknown): Promise<T> => {
    const c = chemin.split('?')[0];
    if (!/\/(tournois|resultats|competition)/.test(c)) return f.requete<T>(chemin, methode, corps);
    appels.push({ chemin, methode, corps });
    if (/\/tournois$/.test(c) && methode === 'GET') {
      const t = detailTournoi(gerer);
      return { tournois: [{ ...t.tournoi, matchs: 1, bilan: t.bilan, prochainMatch: t.matchs[0] }], droits: t.droits, jeu: t.jeu } satisfies ListeTournois as T;
    }
    if (/\/tournois$/.test(c) && methode === 'POST') return { ...detailTournoi(gerer), tournoi: { ...tournoi(), nom: (corps as { nom: string }).nom } } as T;
    if (/\/tournois\/[0-9a-f-]{36}(\/.*)?$/.test(c)) return { ...detailTournoi(gerer), ...(c.endsWith('/matchs') ? { match: 'm2', planning: { evenementId: 'ev2' } } : {}) } as T;
    if (/\/competition\/adversaires$/.test(c) && methode === 'GET') return { adversaires: [{ id: NOVA, nom: 'Nova', logoUrl: null }], droits: { creer: gerer, scouting: gerer } } as T;
    if (/\/competition\/accueil$/.test(c)) return { prochains: [{ id: MATCH, tournoi: { id: TOURNOI, nom: 'Coupe d’automne' }, tour: 'Poule A', debut: '2026-10-24T18:00:00.000Z', adversaires: [{ id: NOVA, nom: 'Nova' }] }], tournois: [], derniers: [{ id: RES, genre: 'tournoi', date: '2026-10-19T18:00:00.000Z', tournoi: null, adversaires: [{ id: NOVA, nom: 'Nova' }], systeme: 'serie', issue: 'victoire', place: null, score: '2-0' }], forme: ['V', 'V'], droits: { tournois: true, resultats: true, gerer, saisir: gerer } } as T;
    if (/\/resultats$/.test(c) && methode === 'GET') {
      return { resultats: [resultat()], total: 1, bilan: BILAN, filtres: { adversaires: [{ id: NOVA, nom: 'Nova', fiche: true }], cartes: [{ cle: 'ascent', nom: 'Ascent' }], tournois: [{ id: TOURNOI, nom: 'Coupe d’automne' }], jeux: [{ cle: 'valorant', nom: 'Valorant', couleur: '#ff4655' }] }, droits: formulaire().droits } satisfies ListeResultats as T;
    }
    if (/\/resultats\/formulaire$/.test(c)) return formulaire(classement) as T;
    if (/\/resultats$/.test(c) && methode === 'POST') {
      if (refus) throw new ErreurEsport('Score invalide.', 400, 'score-invalide', { chemin: 'manches.0', raison: 'ecart-prolongations' });
      return { resultat: resultat(), droits: formulaire().droits } as T;
    }
    if (/\/resultats\/[0-9a-f-]{36}$/.test(c)) return { resultat: resultat(), droits: formulaire().droits } as T;
    return { ok: true } as T;
  };
  const client = {
    config: { adresse: 'https://esport.test', jetonRelais: 'x' },
    team: async () => detail(permissions),
    notifications: async () => ({ nonLues: 0, noms: {}, liste: [] }),
    moi: async () => ({ compte: 'c', superAdmin: false, profil: { pseudo: 'Zed', riotId: null, discord: null }, peutCreerTeam: false }),
    requete,
    taches: async () => ({ taches: [] }),
    resumesTeam: async () => [],
    stats: async () => null,
  } as unknown as ClientEsport;
  await render(
    <ModeAffichageForce mode="large">
      <PageTeam theme={theme} client={client} teamId="t1" large sectionInitiale={section} onQuitter={() => undefined} />
    </ModeAffichageForce>,
  );
  return { appels };
}

afterEach(() => definirLangue('fr'));

describe('compétition (tournois, résultats)', () => {
  it('section « Compétition » : Tournois et Résultats pour tous les membres, seulement si les modules sont activés', () => {
    const competition = (p: string[], modules?: string[]) => sectionsTeam(detail(p, modules)).find(g => g.id === 'competition')?.entrees.map(e => e.id) ?? [];
    expect(competition(JOUEUR)).toEqual(['module:tournois', 'module:resultats']);
    expect(competition(STAFF, ['planning', 'resultats'])).toEqual(['module:resultats']);
    expect(competition(JOUEUR, ['planning'])).toEqual([]);
    expect(sectionsTeam(detail(JOUEUR)).map(g => g.id)).toEqual(['accueil', 'agenda', 'competition', 'equipe', 'reglages']);
  });

  it('petite largeur : plus de section « Compétition », Tournois et Résultats rangés dans « Agenda » (modules et permissions respectés)', () => {
    const agenda = (p: string[], modules?: string[]) => sectionsTeam(detail(p, modules), false).find(g => g.id === 'agenda')?.entrees.map(e => e.id) ?? [];
    expect(sectionsTeam(detail(JOUEUR), false).map(g => g.id)).toEqual(['accueil', 'agenda', 'equipe', 'reglages']);
    expect(agenda(JOUEUR, ['planning', 'tournois', 'resultats'])).toEqual(['module:planning', 'module:tournois', 'module:resultats']);
    expect(agenda(STAFF, ['planning', 'resultats'])).toEqual(['module:planning', 'module:resultats']);
    expect(sectionsTeam(detail(JOUEUR, ['tournois']), false).map(g => g.id)).toEqual(['accueil', 'agenda', 'equipe', 'reglages']);
    expect(groupeDe('module:tournois', false)).toBe('agenda');
    expect(groupeDe('module:resultats', false)).toBe('agenda');
    expect(groupeDe('module:tournois')).toBe('competition');
    expect(sectionsTeam(detail(JOUEUR)).map(g => g.id)).toContain('competition');
  });

  it('tournois (staff) : liste, création selon le profil du jeu, fiche, roster, match ajouté au planning', async () => {
    const { appels } = await monter(STAFF, 'module:tournois');
    expect(await screen.findByTestId(`esport-tournoi-${TOURNOI}`)).toBeTruthy();
    expect(screen.getByText('Coupe d’automne')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-tournois-nouveau'));
    expect(await screen.findByTestId('esport-tournoi-formulaire')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('esport-tournoi-nom'), 'Open d’hiver');
    await fireEvent.press(screen.getByTestId('esport-tournoi-bo-5'));
    await fireEvent.changeText(screen.getByTestId('esport-tournoi-debut'), '2026-12-05');
    await fireEvent.changeText(screen.getByTestId('esport-tournoi-inscription-date'), '2026-12-01');
    await fireEvent.press(screen.getByTestId('esport-tournoi-ajouter-phase'));
    await fireEvent.press(screen.getByTestId('esport-tournoi-phase-0-type-double'));
    await fireEvent.press(screen.getByTestId('esport-tournoi-enregistrer'));
    await waitFor(() => expect(appels.some(a => a.methode === 'POST' && /\/tournois$/.test(a.chemin))).toBe(true));
    expect(appels.find(a => a.methode === 'POST' && /\/tournois$/.test(a.chemin))?.corps).toMatchObject({ nom: 'Open d’hiver', formatCle: '5v5', bo: 5, debut: '2026-12-05', inscriptionLimite: '2026-12-01 23:59', phases: [{ type: 'double', nom: '' }], publiable: true });
    // Fiche : roster borné par le profil, puis un match daté (planning).
    expect(await screen.findByTestId('esport-tournoi-fiche')).toBeTruthy();
    expect(await screen.findByTestId(`esport-match-${MATCH}`)).toBeTruthy();
    // Tournoi extérieur : aucune carte « Équipes et rôles Discord » (tournois du club : Administration › Événements).
    expect(screen.queryByTestId('esport-eq')).toBeNull();
    expect(appels.some(a => a.chemin.includes('/discord') || a.chemin.startsWith('/evenements'))).toBe(false);
    await fireEvent.press(screen.getByTestId('esport-tournoi-roster-modifier'));
    await fireEvent.press(screen.getByTestId('esport-roster-kai12345'));
    expect(screen.getByTestId('esport-roster-compte').props.children).toBe('2 / 5 titulaires · 0 / 2 remplaçants');
    await fireEvent.press(screen.getByTestId('esport-roster-enregistrer'));
    await waitFor(() => expect(appels.some(a => a.chemin.endsWith('/roster'))).toBe(true));
    expect(appels.find(a => a.chemin.endsWith('/roster'))?.corps).toEqual({ titulaires: ['lea12345', 'kai12345'], remplacants: [] });
    await fireEvent.press(await screen.findByTestId('esport-tournoi-ajouter-match'));
    await fireEvent.changeText(await screen.findByTestId('esport-match-tour'), 'Quart de finale');
    await fireEvent.changeText(screen.getByTestId('esport-match-date'), '2026-10-25');
    await fireEvent.press(await screen.findByTestId(`esport-match-adversaires-${NOVA}`));
    await fireEvent.press(screen.getByTestId('esport-match-enregistrer'));
    await waitFor(() => expect(appels.some(a => a.methode === 'POST' && a.chemin.endsWith('/matchs'))).toBe(true));
    expect(appels.find(a => a.methode === 'POST' && a.chemin.endsWith('/matchs'))?.corps).toEqual({ phase: 'p1', tour: 'Quart de finale', date: '2026-10-25', heure: '20:00', dureeMin: 90, adversaires: [{ id: NOVA }] });
  });

  it('tournois (joueur) : lecture seule, aucun bouton de gestion', async () => {
    await monter(JOUEUR, 'module:tournois');
    await fireEvent.press(await screen.findByTestId(`esport-tournoi-${TOURNOI}`));
    expect(await screen.findByTestId('esport-tournoi-fiche')).toBeTruthy();
    expect(await screen.findByTestId(`esport-match-${MATCH}`)).toBeTruthy();
    expect(screen.queryByTestId('esport-tournoi-modifier')).toBeNull();
    expect(screen.queryByTestId('esport-tournoi-ajouter-match')).toBeNull();
    expect(screen.queryByTestId('esport-tournois-nouveau')).toBeNull();
  });

  it('résultats Valorant : bilans, saisie d’un BO3 (aperçu 2-1, mi-temps et prolongations), refus du serveur traduit', async () => {
    const { appels } = await monter(STAFF, 'module:resultats');
    expect(await screen.findByTestId(`esport-resultat-${RES}`)).toBeTruthy();
    expect(screen.getByTestId('esport-resultats-taux').props.children).toBe('75 %');
    expect(screen.getByTestId('esport-resultats-forme').props.children).toBe('V V D V');
    await fireEvent.press(screen.getByTestId('esport-resultats-onglet-bilans'));
    expect(await screen.findByTestId('esport-bilan-carte-ascent')).toBeTruthy();
    expect(screen.getByTestId(`esport-bilan-adversaire-${NOVA}`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-resultats-saisir'));
    expect(await screen.findByTestId('esport-resultat-formulaire')).toBeTruthy();
    expect(await screen.findByTestId('esport-resultat-regle')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-resultat-lien-match'));
    await fireEvent.press(await screen.findByTestId(`esport-resultat-match-${MATCH}`));
    await fireEvent.press(screen.getByTestId('esport-resultat-manche-0-carte-ascent'));
    await fireEvent.changeText(screen.getByTestId('esport-resultat-manche-0-nous'), '13');
    await fireEvent.changeText(screen.getByTestId('esport-resultat-manche-0-eux'), '9');
    await fireEvent.press(screen.getByTestId('esport-resultat-ajouter-manche'));
    await fireEvent.changeText(screen.getByTestId('esport-resultat-manche-1-nous'), '7');
    await fireEvent.changeText(screen.getByTestId('esport-resultat-manche-1-eux'), '13');
    await fireEvent.press(screen.getByTestId('esport-resultat-ajouter-manche'));
    await fireEvent.press(screen.getByTestId('esport-resultat-manche-2-detail'));
    for (const [h, c, v] of [[0, 0, '6'], [0, 1, '6'], [1, 0, '6'], [1, 1, '6']] as const) await fireEvent.changeText(screen.getByTestId(`esport-resultat-manche-2-mt${h}-${c}`), v);
    await fireEvent.changeText(screen.getByTestId('esport-resultat-manche-2-ot-0'), '2');
    expect(screen.getByTestId('esport-resultat-apercu')).toBeTruthy();
    expect(screen.getByText('Victoire 2-1')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-resultat-joueur-lea12345'));
    await fireEvent.press(screen.getByTestId('esport-resultat-mvp-lea12345'));
    await fireEvent.changeText(screen.getByTestId('esport-resultat-stats-lea12345'), 'kills=24, acs=268');
    await fireEvent.press(screen.getByTestId('esport-resultat-enregistrer'));
    await waitFor(() => expect(appels.some(a => a.methode === 'POST' && /\/resultats$/.test(a.chemin))).toBe(true));
    expect(appels.find(a => a.methode === 'POST' && /\/resultats$/.test(a.chemin))?.corps).toMatchObject({
      tournoiMatchId: MATCH,
      bo: 3,
      adversaires: [{ id: NOVA }],
      manches: [{ carteCle: 'ascent', nous: 13, eux: 9 }, { nous: 7, eux: 13 }, { miTemps: [[6, 6], [6, 6]], prolongations: [2, 0] }],
      joueurs: [{ compte: 'lea12345', personnages: [], stats: { kills: 24, acs: 268 } }],
      mvp: 'lea12345',
      visibilite: 'team',
      publiable: true,
    });
  });

  it('résultats : un refus du serveur (score) est expliqué, manche comprise', async () => {
    await monter(STAFF, 'module:resultats', { refus: true });
    await fireEvent.press(await screen.findByTestId('esport-resultats-saisir'));
    await fireEvent.changeText(await screen.findByTestId('esport-resultat-manche-0-nous'), '13');
    await fireEvent.changeText(screen.getByTestId('esport-resultat-manche-0-eux'), '12');
    await fireEvent.press(screen.getByTestId('esport-resultat-enregistrer'));
    expect((await screen.findByTestId('esport-resultat-formulaire-erreur')).props.children).toMatch(/^Manche 1 : en prolongations/);
  });

  it('classement multi-équipes : place et points du barème proposés', async () => {
    const { appels } = await monter(STAFF, 'module:resultats', { classement: true });
    await fireEvent.press(await screen.findByTestId('esport-resultats-saisir'));
    await fireEvent.changeText(await screen.findByTestId('esport-resultat-manche-0-place'), '2');
    expect(screen.getByTestId('esport-resultat-manche-0-points').props.placeholder).toBe('6');
    await fireEvent.changeText(screen.getByTestId('esport-resultat-participants'), '16');
    await fireEvent.press(screen.getByTestId('esport-resultat-enregistrer'));
    await waitFor(() => expect(appels.some(a => a.methode === 'POST' && /\/resultats$/.test(a.chemin))).toBe(true));
    expect(appels.find(a => a.methode === 'POST' && /\/resultats$/.test(a.chemin))?.corps).toMatchObject({ manches: [{ place: 2 }], placeFinale: null, participants: 16 });
  });

  it('accueil de la team : prochains matchs, derniers résultats et forme', async () => {
    await monter(JOUEUR, 'accueil');
    expect(await screen.findByTestId('esport-accueil-competition')).toBeTruthy();
    expect(screen.getByTestId('esport-accueil-forme').props.children).toBe('Forme : V V');
    expect(screen.getByTestId('esport-accueil-derniers-resultats')).toBeTruthy();
  });

  it('aperçu pur et phrases (journal, notifications) en français et en anglais', () => {
    expect(systemeDe(FORMAT_5V5, { type: 'rounds' })).toBe('serie');
    expect(systemeDe({ ...FORMAT_5V5, equipes: 4 }, null)).toBe('classement');
    expect(apercuSerie([{ nous: 13, eux: 5 }, { nous: 2, eux: 13 }], 3)).toEqual({ nous: 1, eux: 1, issue: null });
    expect(lireStatsTexte('kills=24, acs: 268\nrole=entry')).toEqual({ kills: 24, acs: 268, role: 'entry' });
    const e = (action: string, meta: Record<string, unknown>) => phraseJournal({ id: 'j', action, acteur: 'zed12345', entite: null, entiteId: null, meta, date: '' } as never, { zed12345: 'Zed' });
    expect(e('tournoi.inscrit', { nom: 'Coupe' })).toBe('Zed a inscrit la team à « Coupe »');
    expect(e('match.resultat_saisi', { score: '2-1', adversaire: 'Nova' })).toBe('Zed a saisi un résultat : 2-1 contre Nova');
    const n = (type: string, charge: Record<string, unknown>) => phraseNotification({ id: 'n', type, team: { id: 't1', nom: 'Faucons' }, charge, lue: false, date: '' } as Notification, {});
    expect(n('resultat-saisi', { issue: 'victoire', score: '2-1', adversaire: 'Nova' })).toBe('Résultat saisi (Faucons) : Victoire 2-1 contre Nova');
    expect(n('tournoi-termine', { nom: 'Coupe', place: 1 })).toBe('« Coupe » est terminé (Faucons) : 1er');
    definirLangue('en');
    expect(e('tournoi.inscrit', { nom: 'Cup' })).toBe('Zed registered the team for “Cup”');
    expect(n('resultat-saisi', { issue: 'defaite', score: '0-2', adversaire: 'Nova' })).toBe('Result entered (Faucons): Defeat 0-2 vs Nova');
    expect(n('tournoi-termine', { nom: 'Cup', place: 2 })).toBe('“Cup” is finished (Faucons): 2nd');
  });
});
