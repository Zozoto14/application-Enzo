/**
 * Esport, module Lineups (interface) : onglet selon le module et les permissions (« Lineups et placements » pour The
 * Finals), logique pure (filtres, facettes, regroupement des pins, arc, pose d'un point), grille et filtres rapides,
 * favoris, vue par map (pins, groupe, trajectoire, fiche à côté), fiche et visionneuse (flèches, balayage), pose des
 * points au toucher dans le formulaire, validation, bloc « Lineups liés » d'une strat, libellés, et l'assistant
 * d'écriture absent de tous les champs (contenu tactique).
 */

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import { ModeAffichageForce } from '../ui/mobile';
import { CATALOGUE, type ClientEsport, type DetailTeam } from './client';
import { oublierProfilsTeams } from './jeux/profil';
import { phraseJournal, phraseNotification } from './libelles';
import type { Lineup, ListeLineups } from './lineups/api';
import { controleArc, couleurPersonnage, facettes, filtrerLineups, filtresActifs, grouperPins, pointDepuisToucher, pointsArc, rayonRegroupement, sidesDuModele, trierLineups } from './lineups/logique';
import { assetsRepli } from './strats/assets';
import type { Strat } from './strats/api';
import { PageTeam, entreesBarre } from './ui/PageTeam';
import { colonnesGrille } from './ui/lineups/Filtres';
import { indexApresBalayage } from './ui/lineups/Visionneuse';
import { fournirAssets } from './ui/strats/commun';

const theme = themeHub('nuit');
const TOUS = ['activity_log', 'strat_editor', 'playbook', 'lineups'];

const detail = (permissions: string[], modules = TOUS, team: Partial<DetailTeam['team']> = {}): DetailTeam => ({
  team: { id: 't1', nom: 'Faucons', slug: 'faucons', jeu: 'valorant', description: '', logoUrl: null, fuseau: 'Europe/Paris', creeLe: '', archivee: false, ...team },
  modules: CATALOGUE.modules.map(m => ({ cle: m.cle, active: modules.includes(m.cle) })),
  membres: 3,
  moi: { membreId: 'm1', role: { id: 'r1', nom: 'Joueur', couleur: '#16a34a', cle: 'joueur' }, permissions, superAdmin: false },
});
const JOUEUR = ['members.view', 'strats.view', 'playbook.view', 'lineups.voir', 'lineups.proposer'];
const COACH = [...JOUEUR, 'strats.create', 'strats.update', 'strats.delete', 'lineups.gerer'];

const lien = (id: string) => ({ url: `https://esport.test/fichiers/${id}?sig=x`, expire: '2026-10-20T12:00:00.000Z' });
const lineup = (champs: Partial<Lineup> = {}): Lineup => ({
  id: 'l1',
  jeu: 'valorant',
  modele: 'valorant',
  titre: 'Smoke Heaven',
  carte: { cle: 'ascent', nom: 'Ascent' },
  personnage: { cle: 'omen', nom: 'Omen' },
  capacite: { cle: 'Ability2', nom: 'Dark Cover' },
  side: 'attaque',
  zone: { cle: 'a-heaven', nom: 'A Heaven' },
  posture: 'saut',
  visee: 'Coin haut de la fenêtre',
  timing: 'À 1:25',
  instructions: 'Collé au mur, sauter puis lancer.',
  difficulte: 2,
  tags: ['Exec A'],
  depart: { x: 400, y: 600 },
  arrivee: { x: 520, y: 380 },
  videoUrl: null,
  medias: [
    { id: 'm1', role: 'position', genre: 'image', type: 'image/png', taille: 1000, nom: 'position.png', lien: lien('f1') },
    { id: 'm2', role: 'visee', genre: 'image', type: 'image/png', taille: 1000, nom: 'visee.png', lien: lien('f2') },
    { id: 'm3', role: 'resultat', genre: 'image', type: 'image/png', taille: 1000, nom: 'resultat.png', lien: lien('f3') },
  ],
  statut: 'valide',
  validePar: { compte: 'zed12345', pseudo: 'Zed' },
  valideLe: '2026-10-20T09:00:00.000Z',
  favori: false,
  strats: [],
  creePar: { compte: 'lea12345', pseudo: 'Léa' },
  creeLe: '2026-10-20T08:00:00.000Z',
  majLe: '2026-10-20T09:00:00.000Z',
  moi: { modifier: false, supprimer: false, valider: false, lier: false },
  ...champs,
});

const L1 = lineup();
// Tout près de L1 sur la minimap : regroupés dans la vue par map.
const L2 = lineup({ id: 'l2', titre: 'Molly défaut A', personnage: { cle: 'brimstone', nom: 'Brimstone' }, capacite: { cle: 'Ability1', nom: 'Incendiary' }, zone: { cle: null, nom: 'Défaut A' }, side: 'attaque', tags: ['Post-plant'], depart: { x: 300, y: 500 }, arrivee: { x: 530, y: 390 }, medias: [], statut: 'propose', validePar: null, majLe: '2026-10-21T09:00:00.000Z' });
const L3 = lineup({ id: 'l3', titre: 'Recon B main', personnage: { cle: 'sova', nom: 'Sova' }, capacite: { cle: 'Ability2', nom: 'Recon Bolt' }, zone: null, side: 'defense', tags: [], depart: { x: 800, y: 200 }, arrivee: { x: 700, y: 150 }, medias: [], majLe: '2026-10-19T09:00:00.000Z' });
const L4 = lineup({ id: 'l4', titre: 'Mur mid Bind', carte: { cle: 'bind', nom: 'Bind' }, personnage: { cle: 'viper', nom: 'Viper' }, capacite: null, zone: null, side: 'defense', depart: null, arrivee: null, medias: [], favori: true });

const donnees = (lineups: Lineup[], droits = { proposer: true, gerer: false, lier: false }): ListeLineups => ({ lineups, total: lineups.length, droits, limites: { images: 4, tailleImage: 12 * 1024 * 1024, tailleVideo: 200 * 1024 * 1024 } });

let detailCourant: DetailTeam;
function fauxClient(requete: jest.Mock): ClientEsport {
  const non = async () => {
    throw new Error('non prévu');
  };
  return new Proxy(
    {
      config: { adresse: 'https://esport.test', jetonRelais: 'x' },
      team: async () => detailCourant,
      moi: async () => ({ compte: 'lea12345', superAdmin: false, profil: { pseudo: 'Léa', riotId: null, discord: null }, peutCreerTeam: false }),
      notifications: async () => ({ nonLues: 0, noms: {}, liste: [] }),
      requete,
    } as unknown as ClientEsport,
    { get: (cible, cle) => (cle in cible ? (cible as unknown as Record<string | symbol, unknown>)[cle] : non) },
  );
}

async function monter(client: ClientEsport, d: DetailTeam, section: 'module:lineups' | 'module:strat_editor' = 'module:lineups') {
  detailCourant = d;
  return await render(
    <ModeAffichageForce mode="large">
      <PageTeam theme={theme} client={client} teamId="t1" large sectionInitiale={section} onQuitter={() => undefined} />
    </ModeAffichageForce>,
  );
}

/** Faux serveur : la liste des lineups, et les écritures notées. */
function serveur(initiaux: Lineup[], droits = { proposer: true, gerer: false, lier: false }) {
  const lineups = [...initiaux];
  return jest.fn(async (chemin: string, methode?: string, corps?: unknown) => {
    if (chemin === '/teams/t1/lineups' && (!methode || methode === 'GET')) return donnees(lineups, droits);
    if (chemin === '/teams/t1/lineups' && methode === 'POST') {
      const cree = lineup({ id: 'nouveau', ...(corps as Partial<Lineup>), medias: [], statut: droits.gerer ? 'valide' : 'propose', moi: { modifier: true, supprimer: true, valider: droits.gerer, lier: false } });
      lineups.push(cree);
      return cree;
    }
    if (/^\/teams\/t1\/lineups\/[^/]+\/favori$/.test(chemin)) return { ok: true, favori: methode === 'PUT' };
    if (/^\/teams\/t1\/lineups\/[^/]+$/.test(chemin) && methode === 'PATCH') return { ...(lineups.find(l => chemin.endsWith(l.id)) ?? L1), ...(corps as Partial<Lineup>) };
    throw new Error(`inattendu : ${methode ?? 'GET'} ${chemin}`);
  });
}

beforeEach(() => {
  oublierProfilsTeams();
  fournirAssets(assetsRepli(0));
});
afterAll(() => fournirAssets(undefined));

describe('logique pure', () => {
  const tous = [L1, L2, L3, L4];

  it('filtres combinés, tri et facettes (seules les valeurs qui servent sont proposées)', () => {
    const titres = (f: Parameters<typeof filtrerLineups>[1]) => filtrerLineups(tous, f).map(l => l.titre);
    expect(titres({ carte: 'ascent' })).toEqual(['Smoke Heaven', 'Molly défaut A', 'Recon B main']);
    expect(titres({ personnage: 'omen', capacite: 'Ability2' })).toEqual(['Smoke Heaven']);
    expect(titres({ capacite: 'Ability2' })).toEqual(['Smoke Heaven', 'Recon B main']);
    expect(titres({ side: 'defense', carte: 'bind' })).toEqual(['Mur mid Bind']);
    expect(titres({ zone: 'a-heaven' })).toEqual(['Smoke Heaven']);
    expect(titres({ zone: 'defaut a' })).toEqual(['Molly défaut A']);
    expect(titres({ tag: 'post-plant' })).toEqual(['Molly défaut A']);
    expect(titres({ statut: 'propose' })).toEqual(['Molly défaut A']);
    expect(titres({ favoris: true })).toEqual(['Mur mid Bind']);
    expect(titres({ q: 'INCENDIARY' })).toEqual(['Molly défaut A']);
    expect(trierLineups(tous).map(l => l.id)).toEqual(['l4', 'l1', 'l3', 'l2']);
    const f = facettes(tous, { carte: 'ascent', personnage: 'omen' });
    expect(f.cartes).toEqual([{ id: 'ascent', nom: 'Ascent', n: 3 }, { id: 'bind', nom: 'Bind', n: 1 }]);
    expect(f.personnages.map(p => p.id)).toEqual(['brimstone', 'omen', 'sova']);
    expect(f.capacites).toEqual([{ id: 'Ability2', nom: 'Dark Cover', n: 1 }]);
    // Sans personnage choisi, « Ability2 » désigne la fumée d'Omen ET la flèche de Sova : la clé ambiguë n'est pas
    // proposée (elle le redevient une fois le personnage choisi) ; « Ability1 », d'un seul personnage, l'est.
    expect(facettes(tous, {}).capacites).toEqual([{ id: 'Ability1', nom: 'Incendiary', n: 1 }]);
    expect(facettes(tous, { personnage: 'sova' }).capacites).toEqual([{ id: 'Ability2', nom: 'Recon Bolt', n: 1 }]);
    expect(f.zones.map(z => z.id)).toEqual(['a-heaven', 'defaut a']);
    expect(filtresActifs({ carte: 'ascent', favoris: true, q: 'x' })).toBe(2);
    expect(sidesDuModele('valorant')).toEqual(['attaque', 'defense']);
    expect(sidesDuModele('thefinals')).toEqual(['cashout', 'final-round']);
  });

  it('grille : colonnes de même largeur selon la place (deux sur téléphone, quatre sur PC)', () => {
    expect(colonnesGrille(0, 236, 16)).toBe(1);
    expect(colonnesGrille(358, 150, 8)).toBe(2);
    expect(colonnesGrille(788, 236, 16)).toBe(3);
    expect(colonnesGrille(1124, 236, 16)).toBe(4);
  });

  it('pins : les lineups qui tombent au même endroit se regroupent, de façon stable', () => {
    const groupes = grouperPins(tous, 60);
    expect(groupes.map(g => g.lineups.map(l => l.id))).toEqual([['l1', 'l2'], ['l3']]);
    expect(groupes[0]).toMatchObject({ cle: 'l1+l2', x: 525, y: 385 });
    // Carte plus grande à l'écran : rayon plus petit, les deux pins se séparent.
    expect(rayonRegroupement(400)).toBe(76);
    expect(rayonRegroupement(3200)).toBe(10);
    expect(grouperPins(tous, 10).map(g => g.lineups.length)).toEqual([1, 1, 1]);
    expect(grouperPins([L4], 60)).toEqual([]);
  });

  it('trajectoire : arc tourné vers le haut, points intermédiaires ; point d’un toucher dans le repère de 1000', () => {
    const c = controleArc({ x: 200, y: 500 }, { x: 600, y: 500 });
    expect(c.x).toBe(400);
    expect(c.y).toBeLessThan(500);
    const points = pointsArc({ x: 200, y: 500 }, { x: 600, y: 500 }, 4);
    expect(points).toHaveLength(3);
    expect(points[1].x).toBeCloseTo(400);
    expect(points[1].y).toBeLessThan(500);
    expect(pointDepuisToucher(100, 300, 400, 400)).toEqual({ x: 250, y: 750 });
    expect(pointDepuisToucher(-20, 900, 400, 400)).toEqual({ x: 0, y: 1000 });
    expect(pointDepuisToucher(10, 10, 0, 0)).toBeNull();
    expect(couleurPersonnage({ cle: 'omen', roleCle: 'controleur', role: 'Contrôleur' })).toBe('#9B7BF7');
    expect(couleurPersonnage(undefined, 'Gadget')).toBe(couleurPersonnage(undefined, 'Gadget'));
  });

  it('visionneuse : un balayage vers la gauche passe à l’image suivante, borné à la liste', () => {
    expect(indexApresBalayage(0, -80, 3)).toBe(1);
    expect(indexApresBalayage(2, -80, 3)).toBe(2);
    expect(indexApresBalayage(1, 80, 3)).toBe(0);
    expect(indexApresBalayage(1, 20, 3)).toBe(1);
  });
});

describe('navigation et libellés', () => {
  it('l’onglet Lineups n’apparaît que si le module est activé ET le rôle peut le voir ; « Lineups et placements » pour The Finals', () => {
    expect(entreesBarre(detail(JOUEUR)).find(e => e.id === 'module:lineups')?.libelle).toBe('Lineups');
    expect(entreesBarre(detail(['members.view', 'strats.view'])).map(e => e.id)).not.toContain('module:lineups');
    expect(entreesBarre(detail(JOUEUR, ['activity_log', 'strat_editor'])).map(e => e.id)).not.toContain('module:lineups');
    expect(entreesBarre(detail(JOUEUR, TOUS, { jeu: 'the-finals', jeuModele: 'thefinals' })).find(e => e.id === 'module:lineups')?.libelle).toBe('Lineups et placements');
  });

  it('journal et notifications', () => {
    const e = (action: string, meta: Record<string, unknown>) => phraseJournal({ id: 'x', action, acteur: 'lea12345', entiteType: null, entiteId: null, meta, date: '' }, { lea12345: 'Léa' });
    expect(e('lineup.created', { titre: 'Smoke Heaven', carte: 'Ascent', statut: 'propose' })).toBe('Léa a proposé le lineup « Smoke Heaven » (Ascent)');
    expect(e('lineup.created', { titre: 'Smoke Heaven', carte: 'Ascent', statut: 'valide' })).toBe('Léa a ajouté le lineup « Smoke Heaven » (Ascent)');
    expect(e('lineup.validated', { titre: 'Smoke Heaven' })).toBe('Léa a validé le lineup « Smoke Heaven »');
    expect(e('lineup.linked', { titre: 'Smoke Heaven', stratTitre: 'Exec A' })).toBe('Léa a lié le lineup « Smoke Heaven » à la strat « Exec A »');
    const n = (type: string, charge: Record<string, unknown>) => phraseNotification({ id: 'n', type, team: { id: 't1', nom: 'Faucons' }, charge, lue: false, date: '' }, { lea12345: 'Léa' });
    expect(n('lineup-propose', { titre: 'Smoke Heaven', carte: 'Ascent', membre: 'lea12345' })).toBe('Léa propose un lineup pour Faucons : « Smoke Heaven » (Ascent)');
    expect(n('lineup-valide', { titre: 'Smoke Heaven' })).toBe('Votre lineup « Smoke Heaven » est validé (Faucons)');
  });
});

describe('grille et filtres rapides', () => {
  it('cartes avec image, pastilles et statut ; filtres appliqués sur place ; favoris par l’API', async () => {
    const requete = serveur([L1, L2, L3, L4]);
    await monter(fauxClient(requete), detail(JOUEUR));
    expect(await screen.findByTestId('esport-lineup-l1')).toBeTruthy();
    expect(screen.getByTestId('esport-lineups-compte').props.children).toBe('4 sur 4');
    // L'image d'abord quand il y en a une ; sinon l'aperçu de la minimap (points posés).
    expect(screen.getByTestId('esport-lineup-image-l1').props.source).toEqual({ uri: 'https://esport.test/fichiers/f1?sig=x' });
    expect(screen.queryByTestId('esport-lineup-image-l2')).toBeNull();
    expect(screen.getByTestId('esport-lineup-apercu-l2')).toBeTruthy();
    expect(within(screen.getByTestId('esport-lineup-carte-l2')).getByText('Proposé')).toBeTruthy();
    // Favoris en tête ; un seul appel pour la liste : les filtres ne redemandent rien au serveur.
    const ordre = () => screen.getAllByTestId(/^esport-lineup-l\d$/).map(n => n.props.testID);
    expect(ordre()).toEqual(['esport-lineup-l4', 'esport-lineup-l1', 'esport-lineup-l3', 'esport-lineup-l2']);
    await fireEvent.press(screen.getByTestId('esport-lineups-filtre-carte-ascent'));
    expect(ordre()).toEqual(['esport-lineup-l1', 'esport-lineup-l3', 'esport-lineup-l2']);
    await fireEvent.press(screen.getByTestId('esport-lineups-filtre-personnage-omen'));
    expect(ordre()).toEqual(['esport-lineup-l1']);
    expect(screen.getByTestId('esport-lineups-compte').props.children).toBe('1 sur 4');
    // La zone n'est proposée qu'une fois la map choisie ; la capacité suit le personnage.
    expect(screen.getByTestId('esport-lineups-filtre-zone-a-heaven')).toBeTruthy();
    expect(screen.getByTestId('esport-lineups-filtre-capacite-Ability2')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-lineups-filtre-statut-propose'));
    expect(await screen.findByTestId('esport-lineups-vide-filtres')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-lineups-filtres-effacer'));
    expect(ordre()).toHaveLength(4);
    await fireEvent.changeText(screen.getByTestId('esport-lineups-recherche'), 'recon');
    expect(ordre()).toEqual(['esport-lineup-l3']);
    await fireEvent.changeText(screen.getByTestId('esport-lineups-recherche'), '');
    await fireEvent.press(screen.getByTestId('esport-lineups-filtre-side-defense'));
    expect(ordre()).toEqual(['esport-lineup-l4', 'esport-lineup-l3']);
    expect(requete.mock.calls.filter(c => c[0] === '/teams/t1/lineups')).toHaveLength(1);
    // Favori : étoile de la carte, appel à l'API, effet immédiat.
    await fireEvent.press(screen.getByTestId('esport-lineup-favori-l3'));
    await waitFor(() => expect(requete).toHaveBeenCalledWith('/teams/t1/lineups/l3/favori', 'PUT', {}));
    expect(screen.getByTestId('esport-lineup-favori-l3').props.accessibilityState.selected).toBe(true);
    await fireEvent.press(screen.getByTestId('esport-lineups-filtre-favoris'));
    expect(ordre()).toEqual(['esport-lineup-l4', 'esport-lineup-l3']);
    expect(screen.getByTestId('esport-mention-riot')).toBeTruthy();
  });

  it('état vide : explique quoi faire ; le Remplaçant (lecture seule) n’a pas le bouton', async () => {
    await monter(fauxClient(serveur([])), detail(JOUEUR));
    expect(await screen.findByTestId('esport-lineups-vide')).toBeTruthy();
    expect(screen.getByText(/où se placer, où viser et où ça tombe/)).toBeTruthy();
    expect(screen.getByTestId('esport-lineups-vide-nouveau')).toBeTruthy();
    expect(screen.getAllByText('Proposer un lineup').length).toBeGreaterThan(0);
    await screen.unmount();
    await monter(fauxClient(serveur([], { proposer: false, gerer: false, lier: false })), detail(['members.view', 'lineups.voir']));
    expect(await screen.findByTestId('esport-lineups-vide')).toBeTruthy();
    expect(screen.queryByTestId('esport-lineups-vide-nouveau')).toBeNull();
    expect(screen.queryByTestId('esport-lineups-nouveau')).toBeNull();
  });
});

describe('vue par map', () => {
  it('un pin par lineup à son point d’arrivée, groupe pour les proches ; un pin touché montre la trajectoire et ouvre la fiche', async () => {
    await monter(fauxClient(serveur([L1, L2, L3, L4])), detail(JOUEUR));
    await screen.findByTestId('esport-lineup-l1');
    await fireEvent.press(screen.getByTestId('esport-lineups-vue-carte'));
    // Sans map choisie : celle qui a le plus de lineups (Ascent). L1 et L2 tombent au même endroit : un seul pin « 2 ».
    expect(screen.getByTestId('esport-lineups-carte-ascent').props.accessibilityState.checked).toBe(true);
    const groupe = screen.getByTestId('esport-lineups-carte-pin-l1+l2');
    expect(groupe.props.accessibilityLabel).toBe('2 lineups ici');
    expect(within(groupe).getByText('2')).toBeTruthy();
    const seul = screen.getByTestId('esport-lineups-carte-pin-l3');
    expect(seul.props.accessibilityLabel).toBe('Recon B main (Sova, Recon Bolt)');
    expect(seul.props.style).toMatchObject({ left: '70%', top: '15%' });
    expect(screen.queryByTestId('esport-lineups-carte-pin-l4')).toBeNull();
    expect(screen.getByTestId('esport-lineups-carte-aide')).toBeTruthy();
    // Pin touché : départ, arc et arrivée apparaissent ; la fiche s'ouvre à côté.
    expect(screen.queryByTestId('esport-lineups-carte-depart-l3')).toBeNull();
    await fireEvent.press(seul);
    expect(screen.getByTestId('esport-lineups-carte-depart-l3').props.style).toMatchObject({ left: '80%', top: '20%' });
    expect(screen.getByTestId('esport-lineups-carte-arrivee-l3')).toBeTruthy();
    expect(screen.getByTestId('esport-lineups-carte-arc-l3')).toBeTruthy();
    expect(within(screen.getByTestId('esport-lineup-fiche')).getByTestId('esport-lineup-titre').props.children).toBe('Recon B main');
    expect(screen.getByTestId('esport-lineups-carte-pin-l3').props.accessibilityState.selected).toBe(true);
    // Groupe touché : la liste de ses lineups ; en choisir un montre sa trajectoire et sa fiche.
    await fireEvent.press(screen.getByTestId('esport-lineups-carte-pin-l1+l2'));
    expect(screen.getByTestId('esport-lineups-groupe')).toBeTruthy();
    expect(screen.queryByTestId('esport-lineups-carte-depart-l3')).toBeNull();
    await fireEvent.press(screen.getByTestId('esport-lineups-groupe-l2'));
    expect(screen.getByTestId('esport-lineups-carte-arrivee-l2')).toBeTruthy();
    expect(within(screen.getByTestId('esport-lineup-fiche')).getByTestId('esport-lineup-titre').props.children).toBe('Molly défaut A');
    // Les filtres valent aussi sur la carte (par personnage) ; changer de map remet la sélection à zéro.
    await fireEvent.press(screen.getByTestId('esport-lineups-filtre-personnage-sova'));
    expect(screen.queryByTestId('esport-lineups-carte-pin-l1+l2')).toBeNull();
    expect(screen.getByTestId('esport-lineups-carte-pin-l3')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-lineups-filtres-effacer'));
    await fireEvent.press(screen.getByTestId('esport-lineups-carte-bind'));
    expect(screen.getByText('1 lineup de cette map n’a pas encore de point d’arrivée sur la minimap.')).toBeTruthy();
    expect(screen.queryByTestId('esport-lineup-fiche')).toBeNull();
  });
});

describe('fiche et visionneuse', () => {
  it('images par rôle, visionneuse (flèches, balayage du doigt), consignes, validation par le staff', async () => {
    const propose = lineup({ id: 'l9', statut: 'propose', validePar: null, moi: { modifier: true, supprimer: true, valider: true, lier: false } });
    const requete = serveur([propose], { proposer: true, gerer: true, lier: false });
    await monter(fauxClient(requete), detail(COACH));
    await fireEvent.press(await screen.findByTestId('esport-lineup-l9'));
    const fiche = await screen.findByTestId('esport-lineup-fiche');
    expect(within(fiche).getByText('Ascent · A Heaven')).toBeTruthy();
    expect(within(fiche).getByText('Omen')).toBeTruthy();
    expect(within(fiche).getByText('Dark Cover')).toBeTruthy();
    const consignes = within(screen.getByTestId('esport-lineup-consignes'));
    expect(consignes.getByText('Saut')).toBeTruthy();
    expect(consignes.getByText('Moyen')).toBeTruthy();
    expect(consignes.getByText('À 1:25')).toBeTruthy();
    expect(consignes.getByText('Collé au mur, sauter puis lancer.')).toBeTruthy();
    // Mini-carte de la fiche : départ et arrivée.
    expect(screen.getByTestId('esport-lineup-minicarte-depart-l9')).toBeTruthy();
    // Trois vignettes ; la grande image ouvre la visionneuse sur l'image choisie.
    await fireEvent.press(screen.getByTestId('esport-lineup-galerie-vignette-1'));
    await fireEvent.press(screen.getByTestId('esport-lineup-galerie-grande'));
    const titre = () => within(screen.getByTestId('esport-lineup-visionneuse-titre')).getByText(/Image/).props.children;
    expect(screen.getByTestId('esport-lineup-visionneuse-image').props.source).toEqual({ uri: 'https://esport.test/fichiers/f2?sig=x' });
    expect(titre()).toContain('Image 2 sur 3');
    await fireEvent.press(screen.getByTestId('esport-lineup-visionneuse-suivante'));
    expect(screen.getByTestId('esport-lineup-visionneuse-image').props.source).toEqual({ uri: 'https://esport.test/fichiers/f3?sig=x' });
    expect(screen.getByTestId('esport-lineup-visionneuse-suivante').props.accessibilityState.disabled).toBe(true);
    // Balayage vers la droite : image précédente ; deux fois : la première ; un petit geste ne change rien.
    const zone = screen.getByTestId('esport-lineup-visionneuse-zone');
    const balayer = async (de: number, a: number) => {
      await fireEvent(zone, 'touchStart', { nativeEvent: { pageX: de } });
      await fireEvent(zone, 'touchEnd', { nativeEvent: { pageX: a } });
    };
    await balayer(80, 260);
    expect(titre()).toContain('Image 2 sur 3');
    await balayer(80, 260);
    expect(screen.getByTestId('esport-lineup-visionneuse-image').props.source).toEqual({ uri: 'https://esport.test/fichiers/f1?sig=x' });
    await balayer(100, 120);
    expect(titre()).toContain('Image 1 sur 3');
    await balayer(300, 100);
    expect(titre()).toContain('Image 2 sur 3');
    await fireEvent.press(screen.getByTestId('esport-lineup-visionneuse-fermer'));
    expect(screen.queryByTestId('esport-lineup-visionneuse')).toBeNull();
    // Validation : le staff valide, l'API reçoit le statut, la pastille change.
    expect(within(screen.getByTestId('esport-lineup-statut')).getByText('Proposé')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-lineup-valider'));
    await waitFor(() => expect(requete).toHaveBeenCalledWith('/teams/t1/lineups/l9', 'PATCH', { statut: 'valide' }));
    expect(await within(screen.getByTestId('esport-lineup-statut')).findByText('Validé')).toBeTruthy();
    // Un joueur ne voit ni « Valider » ni « Modifier » sur le lineup d'un autre.
    await screen.unmount();
    await monter(fauxClient(serveur([L1])), detail(JOUEUR));
    await fireEvent.press(await screen.findByTestId('esport-lineup-l1'));
    await screen.findByTestId('esport-lineup-fiche');
    expect(screen.queryByTestId('esport-lineup-valider')).toBeNull();
    expect(screen.queryByTestId('esport-lineup-modifier')).toBeNull();
    expect(screen.queryByTestId('esport-lineup-supprimer')).toBeNull();
  });
});

describe('formulaire', () => {
  it('pose des points au toucher (position puis arrivée), envoi au serveur ; aucun assistant d’écriture', async () => {
    const requete = serveur([L1]);
    await monter(fauxClient(requete), detail(JOUEUR));
    await fireEvent.press(await screen.findByTestId('esport-lineups-nouveau'));
    expect(await screen.findByTestId('esport-lineup-formulaire')).toBeTruthy();
    // Incomplet : pas d'enregistrement possible ; pas de carte, pas de pose.
    expect(screen.getByTestId('esport-lineup-form-enregistrer').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText('Choisissez d’abord une map.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('esport-lineup-form-titre'), 'Flash A main');
    const { choisirDans } = require('../ui/selecteurs/deplier');
    await choisirDans('esport-lineup-form-carte', 'ascent');
    await choisirDans('esport-lineup-form-personnage', 'skye');
    await fireEvent.press(screen.getByTestId('esport-lineup-form-capacite-Ability2'));
    await fireEvent.press(screen.getByTestId('esport-lineup-form-side-attaque'));
    await fireEvent.press(screen.getByTestId('esport-lineup-form-posture-accroupi'));
    await fireEvent.press(screen.getByTestId('esport-lineup-form-difficulte-3'));
    await fireEvent.changeText(screen.getByTestId('esport-lineup-form-zone-libre'), 'A main');
    await fireEvent.changeText(screen.getByTestId('esport-lineup-form-instructions'), 'Viser le haut de la caisse.');
    await fireEvent.changeText(screen.getByTestId('esport-lineup-form-tags'), 'Flash, exec a');
    // La carte mesure 400 px : un toucher à (100, 300) pose la position à (250, 750) ; le suivant pose l'arrivée.
    await fireEvent(screen.getByTestId('esport-lineup-form-carte-points'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 400 } } });
    const zone = screen.getByTestId('esport-lineup-form-carte-points-toucher');
    expect(zone.props.accessibilityLabel).toBe('Carte de Ascent : touchez pour poser « Où je me place »');
    await fireEvent.press(zone, { nativeEvent: { locationX: 100, locationY: 300 } });
    expect(screen.getByTestId('esport-lineup-form-carte-points-depart-form').props.style).toMatchObject({ left: '25%', top: '75%' });
    expect(screen.getByTestId('esport-lineup-form-pose-arrivee').props.accessibilityState.checked).toBe(true);
    await fireEvent.press(screen.getByTestId('esport-lineup-form-carte-points-toucher'), { nativeEvent: { locationX: 200, locationY: 100 } });
    expect(screen.getByTestId('esport-lineup-form-carte-points-arrivee-form').props.style).toMatchObject({ left: '50%', top: '25%' });
    expect(screen.getByTestId('esport-lineup-form-carte-points-arc-form')).toBeTruthy();
    // Corriger la position : on rechoisit « Où je me place », puis on retouche.
    await fireEvent.press(screen.getByTestId('esport-lineup-form-pose-depart'));
    await fireEvent.press(screen.getByTestId('esport-lineup-form-carte-points-toucher'), { nativeEvent: { locationX: 40, locationY: 40 } });
    // Aucun champ du formulaire n'offre l'assistant d'écriture (contenu tactique).
    expect(screen.queryByTestId(/ecriture/)).toBeNull();
    expect(screen.queryByText(/Corriger|Traduire en anglais/)).toBeNull();
    await fireEvent.press(screen.getByTestId('esport-lineup-form-enregistrer'));
    await waitFor(() => expect(requete.mock.calls.some(c => c[1] === 'POST')).toBe(true));
    const corps = requete.mock.calls.find(c => c[0] === '/teams/t1/lineups' && c[1] === 'POST')?.[2];
    expect(corps).toMatchObject({
      titre: 'Flash A main',
      carte: { cle: 'ascent', nom: 'Ascent' },
      personnage: { cle: 'skye', nom: 'Skye' },
      capacite: { cle: 'Ability2' },
      side: 'attaque',
      zone: { cle: null, nom: 'A main' },
      posture: 'accroupi',
      difficulte: 3,
      instructions: 'Viser le haut de la caisse.',
      tags: ['Flash', 'exec a'],
      depart: { x: 100, y: 100 },
      arrivee: { x: 500, y: 250 },
      videoUrl: null,
    });
    // Un joueur ne choisit pas le statut : il propose.
    expect(corps).not.toHaveProperty('statut');
    // La fiche du nouveau lineup s'ouvre.
    expect(await screen.findByTestId('esport-lineup-fiche')).toBeTruthy();
  });
});

describe('strats : bloc « Lineups liés »', () => {
  const strat: Strat = {
    id: 's1',
    jeu: 'valorant',
    titre: 'Exécution A',
    carte: { cle: 'ascent', nom: 'Ascent' },
    side: 'attaque',
    type: 'execute',
    tags: [],
    notes: '',
    visibilite: 'team',
    revision: 1,
    versionDocument: 3,
    miniature: null,
    origine: null,
    creePar: { compte: 'zed12345', pseudo: 'Zed' },
    majPar: { compte: 'zed12345', pseudo: 'Zed' },
    creeLe: '2026-10-20T08:00:00.000Z',
    majLe: '2026-10-20T09:00:00.000Z',
    moi: { modifier: true, supprimer: true, partager: false },
  };

  it('liste les lineups de la strat avec leur étape ; lier et détacher passent par l’API', async () => {
    let lies = [{ ...L1, etape: 2 }];
    const requete = jest.fn(async (chemin: string, methode?: string, corps?: unknown) => {
      if (chemin.startsWith('/teams/t1/strats/s1/lineups')) return { strat: { id: 's1', titre: 'Exécution A' }, lineups: lies, droits: { proposer: true, gerer: true, lier: true } };
      if (chemin.startsWith('/teams/t1/strats')) return { strats: [strat] };
      if (chemin === '/teams/t1/lineups') return donnees([L1, L2, L3, L4], { proposer: true, gerer: true, lier: true });
      if (chemin === '/teams/t1/lineups/l3/strats/s1' && methode === 'PUT') {
        lies = [...lies, { ...L3, etape: (corps as { etape: number | null }).etape ?? null } as typeof lies[number]];
        return L3;
      }
      if (chemin === '/teams/t1/lineups/l1/strats/s1' && methode === 'DELETE') {
        lies = lies.filter(l => l.id !== 'l1');
        return L1;
      }
      throw new Error(`inattendu : ${methode ?? 'GET'} ${chemin}`);
    });
    await monter(fauxClient(requete), detail(COACH), 'module:strat_editor');
    await fireEvent.press(await screen.findByTestId('esport-strat-actions-s1'));
    await fireEvent.press(await screen.findByTestId('esport-strat-lineups-menu-s1'));
    const bloc = await screen.findByTestId('esport-strat-lineups-s1');
    expect(await within(bloc).findByTestId('esport-strat-lineup-l1')).toBeTruthy();
    expect(within(bloc).getByText('étape 2')).toBeTruthy();
    // Lier un autre lineup, à l'étape 3 (ceux de la map de la strat sont proposés d'abord).
    await fireEvent.press(screen.getByTestId('esport-strat-lineups-ajouter-s1'));
    await fireEvent.press(await screen.findByTestId('esport-strat-lineups-choix-s1-l3'));
    await fireEvent.changeText(screen.getByTestId('esport-strat-lineups-etape-s1'), '3');
    await fireEvent.press(screen.getByTestId('esport-strat-lineups-lier-s1'));
    await waitFor(() => expect(requete).toHaveBeenCalledWith('/teams/t1/lineups/l3/strats/s1', 'PUT', { etape: 3 }));
    expect(await within(bloc).findByTestId('esport-strat-lineup-l3')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-strat-lineup-detacher-l1'));
    await waitFor(() => expect(requete).toHaveBeenCalledWith('/teams/t1/lineups/l1/strats/s1', 'DELETE'));
    await waitFor(() => expect(within(screen.getByTestId('esport-strat-lineups-s1')).queryByTestId('esport-strat-lineup-l1')).toBeNull());
  });

  it('le menu « Lineups liés » n’existe pas sans le module Lineups', async () => {
    const requete = jest.fn(async (chemin: string) => {
      if (chemin.startsWith('/teams/t1/strats')) return { strats: [strat] };
      throw new Error(`inattendu : ${chemin}`);
    });
    await monter(fauxClient(requete), detail(COACH, ['activity_log', 'strat_editor', 'playbook']), 'module:strat_editor');
    await fireEvent.press(await screen.findByTestId('esport-strat-actions-s1'));
    await screen.findByTestId('esport-strat-dupliquer-s1');
    expect(screen.queryByTestId('esport-strat-lineups-menu-s1')).toBeNull();
  });
});
