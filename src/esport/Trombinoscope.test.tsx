/**
 * Trombinoscope (page Membres) : Membres s'ouvre sur le Trombinoscope, « Tous les membres » garde la liste ; pas de
 * nouvelle entrée dans la navigation (barre du bas du téléphone) ; grille, recherche et filtres ; fiche détaillée
 * (nom réel masqué, palmarès calculé distingué, champs réservés absents pour un joueur) ; édition de sa fiche
 * (réseaux vérifiés avant l'envoi) ; texte d'annonce copié ; règles pures (filtres, adresses des réseaux).
 * Badges (migration 0032) : puces sur la carte (3 et « +N », ordre du catalogue), filtre par badge, attribution
 * depuis la fiche, badge à plusieurs membres, catalogue (suppression avec le nombre de membres).
 */

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { REGISTRE } from '../hub/registre';
import { themeHub } from '../hub/themes';
import { ModeAffichageForce } from '../ui/mobile';
import { oublierSessions, type ClientEsport, type Moi } from './client';
import { definirLangue } from './i18n';
import { navEsport } from './ui/CadreEsport';
import { Esport, fabrique } from './ui/RacineEsport';
import { badgesVisibles, filtrerCartes, reseauDeviner, urlPlausible, type BadgeAffiche, type BadgeCatalogue, type CarteTrombi, type FicheTrombi, type Trombinoscope } from './trombi/api';

const theme = themeHub('nuit');
const relaisReel = fabrique.relais;
const clientReel = fabrique.client;

/** L'acteur gère-t-il le catalogue (permission membres.badges.gerer) ? Annoncé par la fiche (`attribution.gerer`). */
let gererCatalogue = true;

afterEach(() => {
  gererCatalogue = true;
  fabrique.relais = relaisReel;
  fabrique.client = clientReel;
  oublierSessions();
  definirLangue('fr');
});

const teamA = { id: 'team-a', nom: 'Team Alpha', slug: 'team-alpha', logoUrl: null, jeu: 'valorant', jeuNom: 'Valorant' };
const teamB = { id: 'team-b', nom: 'Team Beta', slug: 'team-beta', logoUrl: null, jeu: 'autre', jeuNom: 'Autre jeu' };
const roleJoueur = { nom: 'Joueur', couleur: '#16a34a', cle: 'joueur' };
const carte = (compte: string, pseudo: string, t: typeof teamA, postes: Array<{ cle: string; nom: string }>, extra: Partial<CarteTrombi> = {}): CarteTrombi => ({
  compte,
  pseudo,
  photo: null,
  teams: [{ ...t, role: roleJoueur, postes, personnages: [], posteLibre: null, rejointLe: '2026-01-01' }],
  elo: null,
  reseaux: [],
  palmares: 0,
  badges: [],
  peutEditer: false,
  peutBadges: true,
  moi: false,
  ...extra,
});

const badge = (id: string, nom: string, position: number, extra: Partial<BadgeCatalogue> = {}): BadgeCatalogue => ({ id, nom, couleur: '#5b8cff', icone: '', position, auto: null, autoActif: true, reserve: false, membres: 1, ...extra });
const CATALOGUE: BadgeCatalogue[] = [
  badge('badge-ceo', 'CEO', 0, { auto: 'fondateur', icone: '★', membres: 0 }),
  badge('badge-capitaine', 'Capitaine', 1, { membres: 2 }),
  badge('badge-igl', 'IGL', 2),
  badge('badge-streamer', 'Streamer', 3),
  badge('badge-rookie', 'Rookie', 4),
];
const affiche = (b: BadgeCatalogue, teamNom: string | null = null): BadgeAffiche => ({ id: b.id, nom: b.nom, couleur: b.couleur, icone: b.icone, auto: Boolean(b.auto), teamId: teamNom ? 'team-a' : null, teamNom });

const TROMBI: Trombinoscope = {
  droits: { voir: 'club', editer: true, badges: { gerer: true, attribuer: true, fondateur: false } },
  badges: CATALOGUE,
  teams: [teamA, teamB],
  jeux: [
    { cle: 'valorant', nom: 'Valorant', rolesJoueurs: [{ cle: 'duelliste', nom: 'Duelliste' }, { cle: 'igl', nom: 'IGL' }] },
    { cle: 'autre', nom: 'Autre jeu', rolesJoueurs: [] },
  ],
  fiches: [
    carte('tom12345', 'Tom', teamA, [{ cle: 'igl', nom: 'IGL' }], { elo: { jeu: 'valorant', jeuNom: 'Valorant', valeur: '2450', rang: 'Immortel 2', pic: '', majLe: '2026-10-01' }, reseaux: [{ reseau: 'x', url: 'https://x.com/Tom_GG', libelle: '' }], palmares: 2, badges: [affiche(CATALOGUE[1], 'Team Alpha'), affiche(CATALOGUE[2]), affiche(CATALOGUE[3]), affiche(CATALOGUE[4])] }),
    carte('lea12345', 'Léa', teamA, [{ cle: 'duelliste', nom: 'Duelliste' }], { moi: true, peutEditer: true }),
    carte('zoe12345', 'Zoé', teamB, [], { badges: [affiche(CATALOGUE[4])] }),
  ],
};

const ficheTom = (niveau: FicheTrombi['niveau']): FicheTrombi => ({
  compte: 'tom12345',
  pseudo: 'Tom',
  niveau,
  peutEditer: niveau !== 'membre',
  peutRegler: false,
  version: 3,
  majLe: '2026-10-01T00:00:00.000Z',
  teams: TROMBI.fiches[0].teams,
  photo: null,
  champs: { photo: true, nomReel: niveau !== 'membre', presentation: true, elos: niveau !== 'membre', palmares: true, structures: true, reseaux: true },
  nomReel: niveau !== 'membre' ? 'Thomas Exemple' : null,
  presentation: 'Entry fragger',
  elos: niveau !== 'membre' ? [{ jeu: 'valorant', jeuNom: 'Valorant', valeur: '2450', rang: 'Immortel 2', pic: '', majLe: '2026-10-01' }] : null,
  palmares: [{ id: 'p1', competition: 'Ligue Beta', structure: 'Ancienne Team', date: '2025-03', placement: 3, placementTexte: '', participants: 64, jeu: 'valorant', jeuNom: 'Valorant', details: '', preuve: '' }],
  calcule: {
    tournois: [{ id: 't1', nom: 'Coupe Gamma', teamId: 'team-a', teamNom: 'Team Alpha', jeu: 'valorant', jeuNom: 'Valorant', debut: '2026-09-01', fin: '2026-09-03', statut: 'termine', placement: 1, participants: 16, role: 'titulaire', matchs: 4, victoires: 4, defaites: 0, mvp: 2, calcule: true }],
    hors: { matchs: 0, victoires: 0, mvp: 0 },
  },
  structures: [],
  reseaux: [{ reseau: 'x', url: 'https://x.com/Tom_GG', identifiant: 'Tom_GG', libelle: '' }],
  badges: TROMBI.fiches[0].badges,
  ...(niveau !== 'membre'
    ? { attribution: { portees: [{ id: 'club', nom: null }, { id: 'team-a', nom: 'Team Alpha' }], actuelles: [{ id: 'badge-capitaine', portee: 'team-a' }, { id: 'badge-igl', portee: 'club' }], catalogue: CATALOGUE, fondateur: false, gerer: gererCatalogue } }
    : {}),
});

const ficheLea: FicheTrombi = {
  ...ficheTom('moi'),
  compte: 'lea12345',
  pseudo: 'Léa',
  teams: TROMBI.fiches[1].teams,
  peutEditer: true,
  peutRegler: true,
  version: 1,
  nomReel: '',
  presentation: '',
  elos: [],
  palmares: [],
  calcule: { tournois: [], hors: { matchs: 0, victoires: 0, mvp: 0 } },
  reseaux: [],
  visibilite: { photo: 'membres', nomReel: 'staff', presentation: 'membres', elos: 'membres', palmares: 'membres', structures: 'membres', reseaux: 'membres' },
  saisie: { jeux: [{ cle: 'valorant', nom: 'Valorant' }], profils: [{ teamId: 'team-a', jeu: 'valorant', rolesJoueurs: [{ cle: 'duelliste', nom: 'Duelliste' }, { cle: 'igl', nom: 'IGL' }], personnages: [] }] },
};

function fauxClient(niveau: FicheTrombi['niveau']) {
  const appels: Array<{ chemin: string; methode: string; corps?: unknown }> = [];
  let catalogue = [...CATALOGUE];
  const moi = { compte: 'lea12345', superAdmin: false, profil: { pseudo: 'Léa', riotId: null, discord: null }, peutCreerTeam: false, peutGererJeux: false, langue: 'fr' } as Moi;
  const requete = async <R,>(chemin: string, methode = 'GET', corps?: unknown): Promise<R> => {
    appels.push({ chemin, methode, corps });
    const c = chemin.split('?')[0];
    if (c === '/cm/moi') return { espace: false, sponsors: [], club: [], teams: [], gerer: false } as R;
    if (c === '/trombi') return TROMBI as R;
    if (c === '/trombi/fiches/tom12345') return ficheTom(niveau) as R;
    if (c === '/trombi/fiches/lea12345' && methode === 'PATCH') return { ...ficheLea, version: 2, ...(corps as object) } as R;
    if (c === '/trombi/fiches/lea12345' || c === '/trombi/fiches/moi') return ficheLea as R;
    if (c === '/trombi/badges' && methode === 'POST') {
      const { nom, couleur, icone } = corps as { nom: string; couleur: string; icone?: string };
      catalogue = [...catalogue, badge('badge-pilier', nom, catalogue.length, { couleur, icone: icone ?? '', membres: 0 })];
      return { badges: catalogue } as R;
    }
    if (c === '/trombi/badges/badge-igl' && methode === 'PATCH') {
      catalogue = catalogue.map(b => (b.id === 'badge-igl' ? { ...b, ...(corps as object) } : b));
      return { badges: catalogue } as R;
    }
    if (c === '/trombi/badges' && methode === 'GET') return { droits: TROMBI.droits.badges, badges: CATALOGUE } as R;
    if (c === '/trombi/badges/badge-capitaine' && methode === 'DELETE') return { badges: CATALOGUE.filter(b => b.id !== 'badge-capitaine'), retires: 2 } as R;
    if (c === '/trombi/badges/badge-rookie/membres') return { modifies: 2 } as R;
    if (c === '/trombi/fiches/tom12345/badges') return ficheTom(niveau) as R;
    if (c === '/trombi/fiches/tom12345/texte') return { fr: 'Tom\nTeam : Team Alpha (Valorant) · IGL', en: 'Tom\nTeam: Team Alpha (Valorant) · IGL' } as R;
    return { ok: true } as R;
  };
  const client = {
    config: { adresse: 'https://esport.test', jetonRelais: 'x' },
    ouvrir: async () => moi,
    moi: async () => moi,
    teams: async () => [],
    annuaire: async () => ({ superAdmin: false, teams: [], comptes: [], demandesEnAttente: 0 }),
    notifications: async () => ({ nonLues: 0, noms: {}, liste: [] }),
    boiteResumes: async () => ({ attente: 0, nouveaux: 0, teams: [] }),
    tableau: async () => ({ genereLe: '', teams: [], global: { resumesARediger: 0, evenementsSemaine: [], alertes: [] } }),
    requete,
  } as unknown as ClientEsport;
  return { client, appels };
}

async function monter(niveau: FicheTrombi['niveau'] = 'staff', mode: 'large' | 'telephone' = 'large') {
  const { client, appels } = fauxClient(niveau);
  fabrique.relais = () => ({ relais: 'https://relais.appdashboard.fr', jeton: 'x'.repeat(20) });
  fabrique.client = () => client;
  await render(
    <ModeAffichageForce mode={mode}>
      <Esport contexte={{}} theme={theme} registre={REGISTRE} onRetour={() => undefined} />
    </ModeAffichageForce>,
  );
  await screen.findByTestId('esport-dashboard');
  await fireEvent.press(screen.getByTestId('esport-nav-membres'));
  await screen.findByTestId('esport-trombi-grille');
  return appels;
}

const selectionne = (id: string) => screen.getByTestId(id).props.accessibilityState?.selected;

describe('règles du trombinoscope', () => {
  it('filtres : recherche (pseudo, poste, rang), team, jeu, poste du profil', () => {
    const f = { recherche: '', team: 'toutes', jeu: 'tous', poste: 'tous' };
    expect(filtrerCartes(TROMBI.fiches, f)).toHaveLength(3);
    expect(filtrerCartes(TROMBI.fiches, { ...f, recherche: 'immortel' }).map(c => c.pseudo)).toEqual(['Tom']);
    expect(filtrerCartes(TROMBI.fiches, { ...f, recherche: 'duel' }).map(c => c.pseudo)).toEqual(['Léa']);
    expect(filtrerCartes(TROMBI.fiches, { ...f, team: 'team-b' }).map(c => c.pseudo)).toEqual(['Zoé']);
    expect(filtrerCartes(TROMBI.fiches, { ...f, jeu: 'valorant', poste: 'igl' }).map(c => c.pseudo)).toEqual(['Tom']);
    // Badges : filtre et recherche par nom de badge.
    expect(filtrerCartes(TROMBI.fiches, { ...f, badge: 'badge-rookie' }).map(c => c.pseudo)).toEqual(['Tom', 'Zoé']);
    expect(filtrerCartes(TROMBI.fiches, { ...f, badge: 'badge-capitaine' }).map(c => c.pseudo)).toEqual(['Tom']);
    expect(filtrerCartes(TROMBI.fiches, { ...f, recherche: 'streamer' }).map(c => c.pseudo)).toEqual(['Tom']);
    expect(badgesVisibles([1, 2, 3, 4, 5])).toEqual({ visibles: [1, 2, 3], reste: 2 });
    expect(badgesVisibles([1])).toEqual({ visibles: [1], reste: 0 });
  });

  it('adresses des réseaux : https, domaine du réseau, « autre » hors des réseaux connus', () => {
    expect(urlPlausible('x', 'https://x.com/Tom_GG')).toBe(true);
    expect(urlPlausible('x', 'http://x.com/Tom_GG')).toBe(false);
    expect(urlPlausible('instagram', 'https://x.com/tom')).toBe(false);
    expect(urlPlausible('twitch', 'https://www.twitch.tv.site-pirate.fr/tom')).toBe(false);
    expect(urlPlausible('autre', 'https://portfolio-exemple.fr/tom')).toBe(true);
    expect(urlPlausible('autre', 'https://x.com/tom')).toBe(false);
    expect(urlPlausible('autre', 'https://192.168.0.1/tom')).toBe(false);
    expect(reseauDeviner('https://www.youtube.com/@tom')).toBe('youtube');
    expect(reseauDeviner('https://portfolio-exemple.fr')).toBe('autre');
  });
});

describe('page Membres', () => {
  it.each(['large', 'telephone'] as const)('(%s) s’ouvre sur le Trombinoscope ; « Tous les membres » garde la liste ; pas de nouvelle entrée de navigation', async mode => {
    await monter('staff', mode);
    expect(navEsport(false, false).map(n => n.cle)).toEqual(['dashboard', 'teams', 'membres']);
    expect(selectionne('esport-membres-onglet-trombi')).toBe(true);
    expect(screen.getByTestId('esport-trombi')).toBeTruthy();
    expect(screen.getByText('3 fiches · tout le club')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-membres-onglet-tous'));
    expect(await screen.findByTestId('esport-membres-global')).toBeTruthy();
    expect(screen.queryByTestId('esport-trombi')).toBeNull();
  });

  it('cartes, recherche et filtres', async () => {
    await monter();
    const grille = screen.getByTestId('esport-trombi-grille');
    expect(within(grille).getByText('Tom')).toBeTruthy();
    expect(screen.getByTestId('esport-trombi-carte-tom12345-elo')).toHaveTextContent('Immortel 2 · 2450');
    expect(within(screen.getByTestId('esport-trombi-carte-tom12345')).getByText('2 titres')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('esport-trombi-recherche'), 'zoé');
    expect(screen.queryByTestId('esport-trombi-carte-tom12345')).toBeNull();
    expect(screen.getByTestId('esport-trombi-carte-zoe12345')).toBeTruthy();
    // Filtres repliés à cette largeur : on les ouvre.
    await fireEvent.press(screen.getByTestId('esport-trombi-filtres'));
    await fireEvent.press(screen.getByTestId('esport-trombi-filtres-effacer'));
    await fireEvent.press(screen.getByTestId('esport-trombi-filtre-poste-igl'));
    expect(screen.getByTestId('esport-trombi-carte-tom12345')).toBeTruthy();
    expect(screen.queryByTestId('esport-trombi-carte-lea12345')).toBeNull();
  });

  it('fiche (staff / CM) : nom réel masqué par défaut, elo, palmarès saisi et calculé distingués, texte d’annonce copié', async () => {
    const appels = await monter('staff');
    const presse = { writeText: jest.fn(async () => undefined) };
    Object.defineProperty(globalThis, 'navigator', { value: { clipboard: presse }, configurable: true });
    await fireEvent.press(screen.getByTestId('esport-trombi-carte-tom12345'));
    const fiche = await screen.findByTestId('esport-trombi-fiche-tom12345');
    expect(screen.queryByTestId('esport-trombi-fiche-nom-reel')).toBeNull();
    await fireEvent.press(screen.getByTestId('esport-trombi-fiche-nom-afficher'));
    expect(screen.getByTestId('esport-trombi-fiche-nom-reel')).toHaveTextContent('Thomas Exemple');
    expect(within(fiche).getByTestId('esport-trombi-fiche-elos')).toHaveTextContent(/Immortel 2 · 2450/);
    expect(within(fiche).getByText('3e / 64 · Ligue Beta')).toBeTruthy();
    const calcule = within(fiche).getByTestId('esport-trombi-fiche-calcule');
    expect(calcule).toHaveTextContent(/Calculé automatiquement/);
    expect(calcule).toHaveTextContent(/1er \/ 16 · Coupe Gamma/);
    expect(calcule).toHaveTextContent(/MVP ×2/);
    await fireEvent.press(screen.getByTestId('esport-trombi-fiche-copier-fr'));
    await waitFor(() => expect(presse.writeText).toHaveBeenCalledWith('Tom\nTeam : Team Alpha (Valorant) · IGL'));
    expect(appels.some(a => a.chemin === '/trombi/fiches/tom12345/texte')).toBe(true);
    expect(await screen.findByText('Texte copié : prêt pour un post.')).toBeTruthy();
  });

  it('joueur sans droit : ni elo réservé, ni nom réel, ni bouton Modifier', async () => {
    await monter('membre');
    await fireEvent.press(screen.getByTestId('esport-trombi-carte-tom12345'));
    await screen.findByTestId('esport-trombi-fiche-tom12345');
    expect(screen.queryByTestId('esport-trombi-fiche-nom-afficher')).toBeNull();
    expect(screen.queryByTestId('esport-trombi-fiche-elos')).toBeNull();
    expect(screen.queryByTestId('esport-trombi-fiche-modifier')).toBeNull();
    expect(screen.getByText('Certaines informations sont réservées au staff et au CM.')).toBeTruthy();
  });

  it('« Ma fiche » : réseau vérifié avant l’envoi, postes du profil, visibilité ; PATCH avec la version attendue', async () => {
    const appels = await monter('staff');
    await fireEvent.press(screen.getByTestId('esport-trombi-ma-fiche'));
    await screen.findByTestId('esport-trombi-editeur');
    await fireEvent.changeText(screen.getByTestId('esport-trombi-presentation'), 'Duelliste agressive');
    await fireEvent.press(screen.getByTestId('esport-trombi-postes-team-alpha-igl'));
    await fireEvent.press(screen.getByTestId('esport-trombi-reseau-ajouter'));
    await fireEvent.press(screen.getByTestId('esport-trombi-reseau-0-choix-instagram'));
    await fireEvent.changeText(screen.getByTestId('esport-trombi-reseau-0-url'), 'http://www.instagram.com/lea');
    expect(screen.getByTestId('esport-trombi-reseau-0-invalide')).toBeTruthy();
    expect(screen.getByTestId('esport-trombi-enregistrer').props.accessibilityState?.disabled).toBe(true);
    await fireEvent.changeText(screen.getByTestId('esport-trombi-reseau-0-url'), 'https://www.instagram.com/lea.gg/');
    expect(screen.queryByTestId('esport-trombi-reseau-0-invalide')).toBeNull();
    await fireEvent.press(screen.getByTestId('esport-trombi-visibilite-elos-staff'));
    await fireEvent.press(screen.getByTestId('esport-trombi-enregistrer'));
    await waitFor(() => expect(appels.some(a => a.methode === 'PATCH')).toBe(true));
    const corps = appels.find(a => a.methode === 'PATCH')!.corps as Record<string, unknown>;
    expect(corps).toMatchObject({
      versionAttendue: 1,
      presentation: 'Duelliste agressive',
      reseaux: [{ reseau: 'instagram', url: 'https://www.instagram.com/lea.gg/' }],
      postes: { 'team-a': { postes: ['duelliste', 'igl'], personnages: [] } },
      visibilite: { elos: 'staff', nomReel: 'staff' },
    });
  });

  it('badges : 3 puces et « +N » sur la carte (ordre du catalogue), filtre par badge', async () => {
    await monter();
    const puces = screen.getByTestId('esport-trombi-carte-tom12345-badges');
    expect(within(puces).getByText('Capitaine · Team Alpha')).toBeTruthy();
    expect(within(puces).getByText('IGL')).toBeTruthy();
    expect(within(puces).getByText('Streamer')).toBeTruthy();
    expect(within(puces).queryByText('Rookie')).toBeNull();
    expect(screen.getByTestId('esport-trombi-carte-tom12345-badges-plus')).toHaveTextContent('+1');
    await fireEvent.press(screen.getByTestId('esport-trombi-filtres'));
    await fireEvent.press(screen.getByTestId('esport-trombi-filtre-badge-badge-rookie'));
    expect(screen.getByTestId('esport-trombi-carte-zoe12345')).toBeTruthy();
    expect(screen.queryByTestId('esport-trombi-carte-lea12345')).toBeNull();
  });

  it('badges : attribution depuis la fiche (badge de team et global), badges automatiques non cochables', async () => {
    const appels = await monter('staff');
    await fireEvent.press(screen.getByTestId('esport-trombi-carte-tom12345'));
    await screen.findByTestId('esport-trombi-fiche-tom12345');
    expect(within(screen.getByTestId('esport-trombi-fiche-badges')).getByText('Rookie')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-trombi-fiche-badges-attribuer'));
    await screen.findByTestId('esport-trombi-badges-membre');
    expect(screen.queryByTestId('esport-trombi-badges-membre-badge-ceo-club')).toBeNull();
    expect(screen.getByTestId('esport-trombi-badges-membre-badge-capitaine-team-a').props.accessibilityState?.checked).toBe(true);
    await fireEvent.press(screen.getByTestId('esport-trombi-badges-membre-badge-igl-club'));
    await fireEvent.press(screen.getByTestId('esport-trombi-badges-membre-badge-streamer-club'));
    await fireEvent.press(screen.getByTestId('esport-trombi-badges-membre-ok'));
    await waitFor(() => expect(appels.some(a => a.chemin === '/trombi/fiches/tom12345/badges')).toBe(true));
    const corps = appels.find(a => a.chemin === '/trombi/fiches/tom12345/badges')!.corps as { badges: Array<{ id: string; portee: string }> };
    expect(corps.badges).toEqual([{ id: 'badge-capitaine', portee: 'team-a' }, { id: 'badge-streamer', portee: 'club' }]);
  });

  it('badges : un badge à plusieurs membres ; catalogue (suppression avec le nombre de membres)', async () => {
    const appels = await monter('staff');
    await fireEvent.press(screen.getByTestId('esport-menu'));
    await fireEvent.press(await screen.findByTestId('esport-trombi-selection'));
    await fireEvent.press(screen.getByTestId('esport-trombi-carte-tom12345'));
    await fireEvent.press(screen.getByTestId('esport-trombi-carte-zoe12345'));
    expect(screen.getByText('2 membres sélectionnés')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-trombi-selection-badge-badge-rookie'));
    expect(screen.queryByTestId('esport-trombi-selection-badge-badge-ceo')).toBeNull();
    await fireEvent.press(screen.getByTestId('esport-trombi-selection-attribuer'));
    await waitFor(() => expect(appels.some(a => a.chemin === '/trombi/badges/badge-rookie/membres')).toBe(true));
    expect(appels.find(a => a.chemin === '/trombi/badges/badge-rookie/membres')!.corps).toEqual({ comptes: ['tom12345', 'zoe12345'], retirer: false });
    expect(await screen.findByText('Badge mis à jour pour 2 membres.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-trombi-selection-terminer'));
    // Catalogue.
    await fireEvent.press(screen.getByTestId('esport-menu'));
    await fireEvent.press(await screen.findByTestId('esport-trombi-badges-gerer'));
    await screen.findByTestId('esport-trombi-badges');
    expect(screen.getByTestId('esport-trombi-badges-badge-ceo-auto')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-trombi-badges-badge-capitaine-modifier'));
    await fireEvent.press(screen.getByTestId('esport-trombi-badges-badge-capitaine-supprimer'));
    expect(screen.getByText('Supprimer définitivement « Capitaine » ? Il sera retiré de 2 membres.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-trombi-badges-badge-capitaine-supprimer-ok'));
    await waitFor(() => expect(appels.some(a => a.chemin === '/trombi/badges/badge-capitaine' && a.methode === 'DELETE')).toBe(true));
    expect(await screen.findByText('Badge supprimé : retiré de 2 membres.')).toBeTruthy();
  });

  it('badges : « + Nouveau badge » depuis le panneau d’attribution — créé, ajouté à la liste et coché dans sa section, cases déjà cochées conservées', async () => {
    const appels = await monter('staff');
    await fireEvent.press(screen.getByTestId('esport-trombi-carte-tom12345'));
    await screen.findByTestId('esport-trombi-fiche-tom12345');
    await fireEvent.press(screen.getByTestId('esport-trombi-fiche-badges-attribuer'));
    await screen.findByTestId('esport-trombi-badges-membre');
    // Une case cochée à la main, non enregistrée, avant la création.
    await fireEvent.press(screen.getByTestId('esport-trombi-badges-membre-badge-streamer-club'));
    await fireEvent.press(screen.getByTestId('esport-trombi-badges-membre-nouveau-team-a'));
    expect(screen.getByTestId('esport-trombi-badges-membre-creation-ok').props.accessibilityState?.disabled).toBe(true);
    await fireEvent.changeText(screen.getByTestId('esport-trombi-badges-membre-creation-nom'), 'Pilier');
    await fireEvent.changeText(screen.getByTestId('esport-trombi-badges-membre-creation-icone'), '🛡️');
    await fireEvent.press(screen.getByTestId('esport-trombi-badges-membre-creation-ok'));
    await waitFor(() => expect(appels.find(a => a.chemin === '/trombi/badges' && a.methode === 'POST')).toBeTruthy());
    expect(appels.find(a => a.chemin === '/trombi/badges' && a.methode === 'POST')!.corps).toMatchObject({ nom: 'Pilier', icone: '🛡️' });
    const caseNeuve = await screen.findByTestId('esport-trombi-badges-membre-badge-pilier-team-a');
    expect(caseNeuve.props.accessibilityState?.checked).toBe(true);
    expect(screen.getByTestId('esport-trombi-badges-membre-badge-pilier-club').props.accessibilityState?.checked).toBe(false);
    expect(screen.getByTestId('esport-trombi-badges-membre-badge-streamer-club').props.accessibilityState?.checked).toBe(true);
    expect(screen.getByTestId('esport-trombi-badges-membre-badge-igl-club').props.accessibilityState?.checked).toBe(true);
    await fireEvent.press(screen.getByTestId('esport-trombi-badges-membre-ok'));
    await waitFor(() => expect(appels.some(a => a.chemin === '/trombi/fiches/tom12345/badges')).toBe(true));
    const corps = appels.find(a => a.chemin === '/trombi/fiches/tom12345/badges')!.corps as { badges: Array<{ id: string; portee: string }> };
    expect(corps.badges).toEqual(expect.arrayContaining([{ id: 'badge-pilier', portee: 'team-a' }, { id: 'badge-streamer', portee: 'club' }, { id: 'badge-capitaine', portee: 'team-a' }]));
  });

  it('badges : le crayon modifie un badge depuis le panneau ; les cases cochées restent', async () => {
    const appels = await monter('staff');
    await fireEvent.press(screen.getByTestId('esport-trombi-carte-tom12345'));
    await screen.findByTestId('esport-trombi-fiche-tom12345');
    await fireEvent.press(screen.getByTestId('esport-trombi-fiche-badges-attribuer'));
    await screen.findByTestId('esport-trombi-badges-membre');
    await fireEvent.press(screen.getByTestId('esport-trombi-badges-membre-badge-rookie-club'));
    await fireEvent.press(screen.getByTestId('esport-trombi-badges-membre-modifier-badge-igl-club'));
    await fireEvent.changeText(screen.getByTestId('esport-trombi-badges-membre-edition-nom'), 'In-game leader');
    await fireEvent.press(screen.getByTestId('esport-trombi-badges-membre-edition-couleur-f87462'));
    await fireEvent.press(screen.getByTestId('esport-trombi-badges-membre-edition-ok'));
    await waitFor(() => expect(appels.some(a => a.chemin === '/trombi/badges/badge-igl' && a.methode === 'PATCH')).toBe(true));
    expect(appels.find(a => a.chemin === '/trombi/badges/badge-igl')!.corps).toMatchObject({ nom: 'In-game leader', couleur: '#f87462' });
    expect((await screen.findAllByText('In-game leader')).length).toBeGreaterThan(0);
    expect(screen.getByTestId('esport-trombi-badges-membre-badge-igl-club').props.accessibilityState?.checked).toBe(true);
    expect(screen.getByTestId('esport-trombi-badges-membre-badge-rookie-club').props.accessibilityState?.checked).toBe(true);
    // Gestionnaire complet, sans perdre les cases.
    await fireEvent.press(screen.getByTestId('esport-trombi-badges-membre-gerer'));
    await screen.findByTestId('esport-trombi-badges-membre-gestionnaire');
    await fireEvent.press(screen.getByTestId('esport-trombi-badges-membre-gestion-retour'));
    expect((await screen.findByTestId('esport-trombi-badges-membre-badge-rookie-club')).props.accessibilityState?.checked).toBe(true);
  });

  it('badges : sans la permission du catalogue, le panneau ne propose ni création, ni crayon, ni gestionnaire', async () => {
    gererCatalogue = false;
    await monter('staff');
    await fireEvent.press(screen.getByTestId('esport-trombi-carte-tom12345'));
    await screen.findByTestId('esport-trombi-fiche-tom12345');
    await fireEvent.press(screen.getByTestId('esport-trombi-fiche-badges-attribuer'));
    await screen.findByTestId('esport-trombi-badges-membre');
    expect(screen.queryByTestId('esport-trombi-badges-membre-nouveau-club')).toBeNull();
    expect(screen.queryByTestId('esport-trombi-badges-membre-modifier-badge-igl-club')).toBeNull();
    expect(screen.queryByTestId('esport-trombi-badges-membre-gerer')).toBeNull();
  });

  it('badges : bouton « Gérer les badges » visible dans l’en-tête avec la permission, absent sans', async () => {
    await monter('staff');
    await fireEvent.press(screen.getByTestId('esport-trombi-badges-gerer-bouton'));
    await screen.findByTestId('esport-trombi-badges');
  });

  it('badges : pas de bouton « Gérer les badges » dans l’en-tête sans la permission', async () => {
    const sauve = TROMBI.droits.badges.gerer;
    TROMBI.droits.badges.gerer = false;
    try {
      await monter('staff');
      expect(screen.queryByTestId('esport-trombi-badges-gerer-bouton')).toBeNull();
    } finally {
      TROMBI.droits.badges.gerer = sauve;
    }
  });
});
