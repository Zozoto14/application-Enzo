/**
 * Profils de jeu (interface) : libellés et assets des modules depuis le profil du jeu de la team
 * (Valorant avec images Riot, autre jeu générique), jeu obligatoire à la création d'une team, page
 * « Jeux » (liste, assistant IA grisé sans clé, relecture d'un brouillon avec points incertains et images
 * non chargées d'office, validation explicite, différences acceptées / refusées une par une,
 * Administration de l'IA sans jamais la clé), modules Strats d'un autre jeu (sans mention Riot), anglais.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import { ModeAffichageForce } from '../ui/mobile';
import { CATALOGUE, type ClientEsport, type DetailTeam } from './client';
import { definirLangue } from './i18n';
import { phraseNotification } from './libelles';
import type { DonneesJeu, EtatIa, EtatMoteurIa, ListeJeux, ProfilJeu, PropositionJeu, TravailIa } from './jeux/api';
import { assetsDepuisProfil, cartesDuPool, libelleFormat, oublierProfilsTeams } from './jeux/profil';
import { assetsRepli } from './strats/assets';
import { Assistant } from './ui/Assistant';
import { Jeux } from './ui/jeux/Jeux';
import { PageTeam } from './ui/PageTeam';
import { fournirAssets } from './ui/strats/commun';

const theme = themeHub('nuit');

beforeEach(() => {
  oublierProfilsTeams();
  definirLangue('fr');
});
afterAll(() => fournirAssets(undefined));

const VIDE: DonneesJeu = { formats: [], score: null, modes: [], cartes: [], classes: [], personnages: [], roster: null, rolesJoueurs: [], champs: [], libelles: {}, sources: [] };

const FINALS: ProfilJeu = {
  cle: 'the-finals',
  nom: 'The Finals',
  couleur: '#d31f3c',
  icone: null,
  base: null,
  statut: 'actif',
  version: 2,
  donnees: {
    ...VIDE,
    formats: [{ cle: '3v3v3v3', nom: 'Tournoi', equipes: 4, joueursParEquipe: 3, bo: [1], notes: '' }],
    cartes: [
      { cle: 'carte-a', nom: 'Carte A', image: 'https://images-exemple.fr/a.png', actif: true, modes: [] },
      { cle: 'carte-b', nom: 'Carte B', image: null, actif: false, modes: [] },
    ],
    classes: [{ cle: 'light', nom: 'Light' }],
    personnages: [{ cle: 'build-leger', nom: 'Build léger', classe: 'light', image: 'https://images-exemple.fr/b.png', actif: true }],
    roster: { titulaires: 3, remplacants: 1 },
  },
};

const VALORANT: ProfilJeu = {
  cle: 'valorant',
  nom: 'Valorant',
  couleur: '#ff4655',
  icone: null,
  base: 'valorant',
  statut: 'actif',
  version: 1,
  donnees: {
    ...VIDE,
    formats: [{ cle: '5v5', nom: '5v5', equipes: 2, joueursParEquipe: 5, bo: [1, 3, 5], notes: '' }],
    cartes: [
      { cle: 'ascent', nom: 'Ascent', image: null, actif: true, modes: [] },
      { cle: 'breeze', nom: 'Breeze', image: null, actif: false, modes: [] },
      { cle: 'nouvelle', nom: 'Nouvelle', image: null, actif: true, modes: [] },
    ],
    classes: [{ cle: 'duelliste', nom: 'Duelliste' }],
    personnages: [{ cle: 'jett', nom: 'Jett', classe: 'duelliste', image: null, actif: true }],
  },
};

// ------------------------------------------------------------------ Fonctions pures

test('libellés de formats et assets des modules depuis le profil (Valorant avec Riot, autre jeu générique)', () => {
  expect(libelleFormat({ equipes: 2, joueursParEquipe: 5 })).toBe('5v5');
  expect(libelleFormat({ equipes: 4, joueursParEquipe: 3 })).toBe('3v3v3v3');
  expect(libelleFormat({ equipes: 20, joueursParEquipe: 3 })).toBe('20 × 3');
  const riot = { ...assetsRepli(0), cartes: assetsRepli(0).cartes.map(c => ({ ...c, minimap: `https://media.valorant-api.com/maps/${c.cle}/displayicon.png` })) };
  const v = assetsDepuisProfil(VALORANT, riot, 0);
  expect(v.jeu).toBe('valorant');
  expect(v.cartes.map(c => c.cle)).toEqual(['ascent', 'breeze', 'nouvelle']);
  expect(v.cartes[0].minimap).toBe('https://media.valorant-api.com/maps/ascent/displayicon.png');
  expect(v.cartes[2].minimap).toBeNull();
  expect(cartesDuPool(v).map(c => c.cle)).toEqual(['ascent', 'nouvelle']);
  expect(cartesDuPool(v, 'breeze').map(c => c.cle)).toEqual(['ascent', 'breeze', 'nouvelle']);
  expect(v.agents[0]).toMatchObject({ cle: 'jett', role: 'Duelliste', capacites: expect.any(Array) });
  expect(v.agents[0].capacites.length).toBe(4);
  const f = assetsDepuisProfil(FINALS, riot, 0);
  expect(f.jeu).toBe('the-finals');
  // Autre jeu : pas de fond de carte ni d'icône (le document d'une strat n'accepte que le CDN Riot), pas de capacités.
  expect(f.cartes.map(c => [c.cle, c.minimap, c.vignette])).toEqual([['carte-a', null, 'https://images-exemple.fr/a.png'], ['carte-b', null, null]]);
  expect(f.agents).toEqual([{ cle: 'build-leger', nom: 'Build léger', role: 'Light', icone: null, capacites: [], actif: true }]);
});

test('notifications des profils de jeu (globales, sans team)', () => {
  expect(phraseNotification({ id: 'n', type: 'jeu-maj-proposee', team: null, charge: { nom: 'Valorant', n: 3 }, lue: false, date: '' }, {})).toBe('Mises à jour proposées pour le profil Valorant : 3 changement(s) à valider');
  expect(phraseNotification({ id: 'n', type: 'jeu-brouillon-pret', team: null, charge: { nom: 'The Finals' }, lue: false, date: '' }, {})).toBe('Brouillon de profil de jeu prêt à relire : The Finals');
});

// ------------------------------------------------------------------ Création d'une team

const LISTE: ListeJeux = {
  gerer: false,
  jeux: [
    { ...VALORANT, resume: { formats: [{ nom: '5v5', libelle: '5v5', bo: [1, 3, 5] }], score: 'rounds', roster: { titulaires: 5, remplacants: 2 }, cartes: 12, cartesActives: 12, personnages: 27, modes: 1 } },
    { ...FINALS, resume: { formats: [{ nom: 'Tournoi', libelle: '3v3v3v3', bo: [1] }], score: 'placement', roster: { titulaires: 3, remplacants: 1 }, cartes: 2, cartesActives: 1, personnages: 1, modes: 0 } },
  ],
};

function clientAssistant(liste: ListeJeux | Error) {
  const creerTeam = jest.fn(async (t: { jeu: string }) => ({ team: { id: 't9', jeu: t.jeu } }) as unknown as DetailTeam);
  const requete = jest.fn(async (chemin: string) => {
    if (chemin === '/jeux') {
      if (liste instanceof Error) throw liste;
      return liste;
    }
    throw new Error(`inattendu : ${chemin}`);
  });
  return { client: { config: { adresse: 'https://esport.test', jetonRelais: 'x' }, requete, creerTeam } as unknown as ClientEsport, creerTeam, requete };
}

test('création d’une team : le jeu est OBLIGATOIRE, choisi parmi les profils (résumé), et envoyé au serveur', async () => {
  const { client, creerTeam } = clientAssistant(LISTE);
  const onJeux = jest.fn();
  await render(<Assistant theme={theme} client={client} onCreee={() => undefined} onAnnuler={() => undefined} onJeux={onJeux} />);
  await fireEvent.changeText(screen.getByTestId('esport-assistant-nom'), 'Finalistes');
  await fireEvent.press(screen.getByTestId('esport-assistant-suivant'));
  expect(await screen.findByTestId('esport-assistant-jeu-the-finals')).toBeTruthy();
  expect(screen.getByText('3v3v3v3 · 1 maps sur 2 · 1 personnages · roster 3 + 1')).toBeTruthy();
  // Aucun jeu choisi d'avance : « Suivant » refuse.
  await fireEvent.press(screen.getByTestId('esport-assistant-suivant'));
  expect(screen.getByText('Choisissez le jeu de la team.')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('esport-assistant-jeu-the-finals'));
  expect(screen.getByTestId('esport-assistant-jeu-the-finals').props.accessibilityState).toEqual({ checked: true });
  // Preset « complet » : sans « Valorant » pour un autre jeu.
  expect(screen.getByText('Team complète')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('esport-assistant-jeux'));
  expect(onJeux).toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('esport-assistant-suivant'));
  await fireEvent.press(screen.getByTestId('esport-assistant-creer'));
  await waitFor(() => expect(creerTeam).toHaveBeenCalledWith(expect.objectContaining({ nom: 'Finalistes', jeu: 'the-finals', preset: 'valorant_complet' })));
});

test('création d’une team : serveur sans profils de jeu → jeux du catalogue', async () => {
  const { client } = clientAssistant(new Error('route'));
  await render(<Assistant theme={theme} client={client} onCreee={() => undefined} onAnnuler={() => undefined} />);
  await fireEvent.changeText(screen.getByTestId('esport-assistant-nom'), 'Faucons');
  await fireEvent.press(screen.getByTestId('esport-assistant-suivant'));
  for (const j of CATALOGUE.jeux) expect(await screen.findByTestId(`esport-assistant-jeu-${j.cle}`)).toBeTruthy();
  expect(screen.queryByTestId('esport-assistant-jeux')).toBeNull();
});

// ------------------------------------------------------------------ Page « Jeux »

const ETAT: EtatIa = {
  configure: true,
  raison: null,
  fournisseur: 'mistral',
  modele: 'modele-exemple',
  hote: 'api.mistral.ai',
  format: 'openai-chat',
  recherche: 'serveur',
  cle: 'presente',
  disponible: true,
  lectureWeb: true,
  fondateur: true,
  reglages: { quotaAppels: 30, quotaVerifications: 8, autoActif: true },
  usage: { mois: '2026-10', appels: 4, verifications: 1, plafondAppels: 30, plafondVerifications: 8 },
  dernierAppel: { le: '2026-10-20T09:00:00.000Z', genre: 'verification', statut: 'ok', modele: 'modele-exemple', dureeMs: 2300, erreur: null, jeu: 'valorant' },
  verifications: [],
};

const BROUILLON: TravailIa = {
  id: 'b1',
  genre: 'brouillon',
  jeu: null,
  demande: { nom: 'The Finals' },
  statut: 'pret',
  declenchement: 'manuel',
  resultat: { cle: 'the-finals', nom: 'The Finals', couleur: '#d31f3c', donnees: FINALS.donnees, version: null, pagesLues: [{ url: 'https://wiki-exemple.fr/the-finals', titre: 'Wiki' }], pagesEchecs: [{ url: 'https://autre-exemple.fr/x', raison: 'ia-page' }] },
  sources: [],
  incertitudes: [{ chemin: 'cartes.carte-b', confiance: 'basse', note: 'Pas sûr qu’elle soit encore jouée.' }],
  avertissements: [{ chemin: 'cartes.2.image', raison: 'image' }],
  erreur: null,
  demandePar: { compte: 'principal', pseudo: 'Fondateur' },
  creeLe: '2026-10-20T09:00:00.000Z',
  majLe: '2026-10-20T09:00:00.000Z',
  finiLe: '2026-10-20T09:01:00.000Z',
};

const PROPOSITIONS: PropositionJeu[] = [
  { id: 'p-ajout', jeu: 'valorant', jeuNom: 'Valorant', section: 'cartes', operation: 'ajout', cle: 'nouvelle-map', avant: null, apres: { cle: 'nouvelle-map', nom: 'Nouvelle Map', image: null, actif: true, modes: [] }, justification: 'Ajoutée au pool.', sources: [{ url: 'https://wiki-exemple.fr/patch', titre: '' }], confiance: 'haute', versionBase: 1, statut: 'en_attente', creeLe: '' },
  { id: 'p-pool', jeu: 'valorant', jeuNom: 'Valorant', section: 'cartes', operation: 'modification', cle: 'breeze', avant: { cle: 'breeze', nom: 'Breeze', actif: true }, apres: { cle: 'breeze', nom: 'Breeze', actif: false }, justification: 'Retirée du pool.', sources: [], confiance: 'basse', versionBase: 1, statut: 'en_attente', creeLe: '' },
  { id: 'p-retrait', jeu: 'valorant', jeuNom: 'Valorant', section: 'personnages', operation: 'retrait', cle: 'iso', avant: { cle: 'iso', nom: 'Iso' }, apres: null, justification: '', sources: [], confiance: 'moyenne', versionBase: 1, statut: 'en_attente', creeLe: '' },
];

function clientJeux({ ia = true }: { ia?: boolean } = {}) {
  const requete = jest.fn(async (chemin: string, methode = 'GET', corps?: unknown): Promise<unknown> => {
    if (chemin === '/jeux?tous=1') return { ...LISTE, gerer: true, ia: { disponible: ia, raison: ia ? null : 'cle-absente' } };
    if (chemin === '/jeux/propositions') return { propositions: PROPOSITIONS };
    if (chemin === '/jeux/ia') return ia ? ETAT : { ...ETAT, configure: false, disponible: false, cle: 'absente', raison: 'cle-absente', modele: null };
    if (chemin === '/jeux/ia/gestionnaires') return { gestionnaires: [] };
    if (chemin === '/jeux/ia/test') return { ok: true, reponse: true, dureeMs: 1200, etat: ETAT };
    if (chemin.startsWith('/jeux/ia/travaux?')) return { travaux: [{ ...BROUILLON, resultat: null }] };
    if (chemin === '/jeux/ia/travaux/b1') return BROUILLON;
    if (chemin === '/jeux/ia/travaux/b1/valider' && methode === 'POST') return { ...FINALS, ...(corps as object) };
    if (chemin === '/jeux/valorant/propositions/decider') return { acceptees: 1, refusees: 1, obsoletes: 0, jeu: VALORANT };
    throw new Error(`inattendu : ${methode} ${chemin}`);
  });
  const client = { config: { adresse: 'https://esport.test', jetonRelais: 'x' }, requete, annuaire: async () => ({ comptes: [] }) } as unknown as ClientEsport;
  return { client, requete };
}

async function monterJeux(client: ClientEsport, fondateur = true) {
  return await render(
    <ModeAffichageForce mode="large">
      <Jeux theme={theme} client={client} large fondateur={fondateur} />
    </ModeAffichageForce>,
  );
}

test('page Jeux : profils (résumé, propositions en attente) ; sans clé, « Préparer avec l’IA » grisé et expliqué', async () => {
  const { client } = clientJeux({ ia: false });
  await monterJeux(client);
  const carte = await screen.findByTestId('esport-jeu-the-finals');
  expect(within(carte).getByText('3v3v3v3 (BO1)')).toBeTruthy();
  expect(within(carte).getByText('1 maps dans le pool sur 2 · 1 personnage · roster 3 + 1 · Classement')).toBeTruthy();
  expect(screen.getByTestId('esport-jeux-preparer-ia').props.accessibilityState).toMatchObject({ disabled: true });
  expect(screen.getByTestId('esport-jeux-ia-indisponible')).toBeTruthy();
  expect(screen.getByTestId('esport-jeux-onglet-maj')).toBeTruthy();
  expect(screen.getByText('Mises à jour (3)')).toBeTruthy();
});

test('brouillon de l’IA : sources, points incertains, éléments écartés ; images non chargées d’office ; validation explicite', async () => {
  const { client, requete } = clientJeux();
  await monterJeux(client);
  await fireEvent.press(await screen.findByTestId('esport-jeux-onglet-ia'));
  await fireEvent.press(await screen.findByTestId('esport-jeux-brouillon-b1-relire'));
  expect(await screen.findByTestId('esport-jeu-brouillon-meta')).toBeTruthy();
  expect(screen.getByText('wiki-exemple.fr · Wiki')).toBeTruthy();
  expect(screen.getByText('Pages illisibles : autre-exemple.fr')).toBeTruthy();
  expect(screen.getByText('1 point(s) incertain(s) signalé(s)')).toBeTruthy();
  expect(screen.getByText('Maps › n° 3 › image : image refusée (https vers un site public seulement)')).toBeTruthy();
  // La section des maps s'ouvre d'elle-même (point incertain) ; la map douteuse est signalée.
  const ligne = await screen.findByTestId('esport-jeu-brouillon-carte-1');
  expect(within(ligne).getByText('Pas sûr qu’elle soit encore jouée.')).toBeTruthy();
  // L'image n'est pas chargée : site affiché, aperçu sur demande.
  const premiere = screen.getByTestId('esport-jeu-brouillon-carte-0');
  expect(within(premiere).getByText('Hébergée sur images-exemple.fr')).toBeTruthy();
  expect(screen.queryByTestId('esport-jeu-brouillon-carte-0-image-vue')).toBeNull();
  expect(screen.queryByTestId('esport-jeu-brouillon-personnage-0-image-vue')).toBeNull();
  await fireEvent.press(screen.getByTestId('esport-jeu-brouillon-carte-0-image-apercu'));
  expect(screen.getByTestId('esport-jeu-brouillon-carte-0-image-vue')).toBeTruthy();
  // Correction puis validation : seulement maintenant, un appel d'écriture.
  expect(requete.mock.calls.some(c => c[1] === 'POST')).toBe(false);
  await fireEvent.changeText(screen.getByTestId('esport-jeu-brouillon-carte-1-nom'), 'Carte B corrigée');
  await fireEvent.press(screen.getByTestId('esport-jeu-brouillon-enregistrer'));
  await waitFor(() => expect(requete).toHaveBeenCalledWith('/jeux/ia/travaux/b1/valider', 'POST', expect.anything()));
  const corps = requete.mock.calls.find(c => c[0] === '/jeux/ia/travaux/b1/valider')?.[2] as { cle: string; donnees: DonneesJeu };
  expect(corps.cle).toBe('the-finals');
  expect(corps.donnees.cartes.map(c => c.nom)).toEqual(['Carte A', 'Carte B corrigée']);
  expect(corps.donnees.cartes[1].cle).toBe('carte-b');
});

test('mises à jour proposées : accepter, refuser ou plus tard, une par une ; correction du nom avant d’accepter', async () => {
  const { client, requete } = clientJeux();
  await monterJeux(client);
  await fireEvent.press(await screen.findByTestId('esport-jeux-onglet-maj'));
  expect(await screen.findByTestId('esport-jeux-proposition-p-pool')).toBeTruthy();
  expect(screen.getByTestId('esport-jeux-proposition-p-pool-diff-actif').props.children).toBe('actif : oui → non');
  expect(screen.getByText('Confiance basse')).toBeTruthy();
  const appliquer = screen.getByTestId('esport-jeux-maj-valorant-appliquer');
  expect(appliquer.props.accessibilityState).toMatchObject({ disabled: true });
  await fireEvent.press(screen.getByTestId('esport-jeux-proposition-p-ajout-decision-accepter'));
  await fireEvent.changeText(screen.getByTestId('esport-jeux-proposition-p-ajout-nom'), 'Nouvelle Map (corrigée)');
  await fireEvent.press(screen.getByTestId('esport-jeux-proposition-p-retrait-decision-refuser'));
  await fireEvent.press(screen.getByTestId('esport-jeux-maj-valorant-appliquer'));
  await waitFor(() =>
    expect(requete).toHaveBeenCalledWith('/jeux/valorant/propositions/decider', 'POST', {
      acceptees: ['p-ajout'],
      refusees: ['p-retrait'],
      corrections: { 'p-ajout': expect.objectContaining({ cle: 'nouvelle-map', nom: 'Nouvelle Map (corrigée)' }) },
    }),
  );
});

test('Administration IA (Fondateur) : fournisseur, modèle, clé présente sans sa valeur, quota, test de connexion ; absente pour un délégué', async () => {
  const { client, requete } = clientJeux();
  await monterJeux(client);
  await fireEvent.press(await screen.findByTestId('esport-jeux-onglet-admin'));
  expect(await screen.findByTestId('esport-jeux-admin-etat')).toBeTruthy();
  expect(screen.getByText('Mistral')).toBeTruthy();
  expect(screen.getByText('modele-exemple')).toBeTruthy();
  expect(screen.getByText('présente (jamais affichée)')).toBeTruthy();
  expect(screen.getByText('4 / 30')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('esport-jeux-admin-tester'));
  expect(await screen.findByText('Connexion réussie (1.2 s).')).toBeTruthy();
  await fireEvent.changeText(screen.getByTestId('esport-jeux-admin-quota-appels'), '50');
  expect(requete).toHaveBeenCalledWith('/jeux/ia/test', 'POST', {});
  const delegue = clientJeux();
  await monterJeux(delegue.client, false);
  expect(await screen.findByTestId('esport-jeux-onglet-ia')).toBeTruthy();
  expect(screen.queryByTestId('esport-jeux-onglet-admin')).toBeNull();
});

test('Administration IA : moteurs (clé présente sans sa valeur, confidentialité), test par moteur, ordre de repli par tâche, IA locale', async () => {
  const moteur = (id: 'api' | 'api2' | 'local', autres: Partial<EtatMoteurIa>): EtatMoteurIa => ({
    id,
    configure: true,
    raison: null,
    pret: true,
    fournisseur: 'nvidia',
    modele: null,
    hote: 'integrate.api.nvidia.com',
    cle: 'presente',
    externe: true,
    raisonnement: false,
    effort: null,
    images: false,
    appelsMois: 0,
    erreursMois: 0,
    plafond: null,
    latenceMoyenneMs: null,
    dernierAppel: null,
    ...autres,
  });
  const LOCAL: EtatIa = {
    ...ETAT,
    mode: 'api',
    modesPossibles: ['local', 'api', 'local-api'],
    reglages: { ...ETAT.reglages, quotaAppelsApi2: 200, mode: 'api' },
    usage: { ...ETAT.usage, appelsApi2: 7, plafondAppelsApi2: 200 },
    moteurs: [
      moteur('api', { modele: 'mistralai/mistral-large-4-1t-a52b', raisonnement: true, effort: 'high', images: true, appelsMois: 4, plafond: 30, latenceMoyenneMs: 12_300 }),
      moteur('api2', { modele: 'openai/gpt-oss-20b', raisonnement: true, appelsMois: 7, erreursMois: 2, plafond: 200, dernierAppel: { le: '2026-10-20T09:00:00.000Z', genre: 'traduction', statut: 'echec', dureeMs: 900, erreur: 'ia-limite-fournisseur' } }),
      moteur('local', { fournisseur: 'local', modele: 'Qwen2.5-7B-Instruct (Q4_K_M)', hote: null, cle: null, externe: false }),
    ],
    ordres: { profils: ['api', 'api2', 'local'], leger: ['api2', 'api', 'local'] },
    confidentialite: {
      locales: (['transcription', 'correction', 'resumes', 'suivi', 'strats'] as const).map(cle => ({ cle, libelle: cle, externeAutorise: false, le: null })),
      externes: [{ cle: 'profils', libelle: 'Profils' }, { cle: 'traduction', libelle: 'Traductions' }, { cle: 'cm', libelle: 'Posts CM' }],
    },
    local: { installe: true, raison: null, modele: 'qwen2.5-7b', nomModele: 'Qwen2.5-7B-Instruct (Q4_K_M)', threads: 8, contexte: 16384, enMarche: false, file: 0, derniereVitesse: { jetonsParSeconde: 6.4, le: null, source: 'requete' }, dernierTempsReponseMs: 41_500 },
  };
  const { client, requete } = clientJeux();
  const base = requete.getMockImplementation()!;
  requete.mockImplementation(async (chemin: string, methode = 'GET', corps?: unknown) => {
    if (chemin === '/jeux/ia') return LOCAL;
    if (chemin === '/jeux/ia/reglages') return LOCAL;
    if (chemin === '/jeux/ia/test') return { ok: true, reponse: true, dureeMs: 30_000, cible: 'local', etat: LOCAL };
    return base(chemin, methode, corps);
  });
  await monterJeux(client);
  await fireEvent.press(await screen.findByTestId('esport-jeux-onglet-admin'));
  const carte = await screen.findByTestId('esport-jeux-admin-local');
  expect(within(carte).getByText('Qwen2.5-7B-Instruct (Q4_K_M)')).toBeTruthy();
  expect(within(carte).getByText('arrêtée (démarre à la demande)')).toBeTruthy();
  expect(within(carte).getByText('6.4 jetons/s')).toBeTruthy();
  expect(within(carte).getByText('41.5 s')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('esport-jeux-admin-tester-local'));
  expect(await screen.findByText('Connexion réussie (30 s).')).toBeTruthy();
  expect(requete).toHaveBeenCalledWith('/jeux/ia/test', 'POST', { cible: 'local' });
  // Moteurs : fournisseur, modèle, clé présente (jamais sa valeur), appels, erreurs, avertissement de confidentialité.
  const moteurs = await screen.findByTestId('esport-jeux-admin-moteurs');
  expect(within(moteurs).getByText(/quittent le serveur/)).toBeTruthy();
  expect(within(screen.getByTestId('esport-jeux-admin-moteur-api')).getByText('mistralai/mistral-large-4-1t-a52b')).toBeTruthy();
  expect(within(screen.getByTestId('esport-jeux-admin-moteur-api')).getByText('4 / 30')).toBeTruthy();
  expect(within(screen.getByTestId('esport-jeux-admin-moteur-api')).getByText('oui (effort high)')).toBeTruthy();
  expect(within(screen.getByTestId('esport-jeux-admin-moteur-api2')).getByText('présente (jamais affichée)')).toBeTruthy();
  expect(within(screen.getByTestId('esport-jeux-admin-moteur-api2-erreurs')).getByText('2')).toBeTruthy();
  expect(screen.queryByTestId('esport-jeux-admin-moteur-local-cle')).toBeNull();
  await fireEvent.press(screen.getByTestId('esport-jeux-admin-moteur-api2-tester'));
  expect(requete).toHaveBeenCalledWith('/jeux/ia/test', 'POST', { cible: 'api2' });
  expect(await screen.findByTestId('esport-jeux-admin-moteur-api2-test')).toBeTruthy();
  // Ordre de repli : tâches légères, l'API principale passe devant ; retour à l'ordre par défaut des profils.
  expect(within(screen.getByTestId('esport-jeux-admin-ordre-leger')).getByText('1. API secondaire (openai/gpt-oss-20b)')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('esport-jeux-admin-ordre-leger-api-monter'));
  expect(requete).toHaveBeenCalledWith('/jeux/ia/reglages', 'PUT', { ordres: { leger: ['api', 'api2', 'local'] } });
  await fireEvent.press(screen.getByTestId('esport-jeux-admin-ordre-profils-local-retirer'));
  expect(requete).toHaveBeenCalledWith('/jeux/ia/reglages', 'PUT', { ordres: { profils: ['api', 'api2'] } });
  await fireEvent.press(screen.getByTestId('esport-jeux-admin-ordre-profils-defaut'));
  expect(requete).toHaveBeenCalledWith('/jeux/ia/reglages', 'PUT', { ordres: { profils: null } });
  // Confidentialité : réunions sur le serveur seulement ; levée par le Fondateur après confirmation.
  const conf = screen.getByTestId('esport-jeux-admin-taches-confidentielles');
  expect(within(conf).getByText('Relecture par l’IA des transcriptions de réunion')).toBeTruthy();
  expect(within(screen.getByTestId('esport-jeux-admin-tache-correction')).getByText('Sur le serveur seulement')).toBeTruthy();
  expect(within(conf).getByText('• Textes des posts CM')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('esport-jeux-admin-tache-correction-autoriser'));
  expect(requete).not.toHaveBeenCalledWith('/jeux/ia/reglages', 'PUT', { externes: { correction: true } });
  await fireEvent.press(screen.getByTestId('esport-jeux-admin-tache-correction-autoriser-confirmer'));
  expect(requete).toHaveBeenCalledWith('/jeux/ia/reglages', 'PUT', { externes: { correction: true } });
  // Plafond du moteur secondaire.
  await fireEvent.changeText(screen.getByTestId('esport-jeux-admin-quota-api2'), '150');
  await fireEvent.press(screen.getByTestId('esport-jeux-admin-quota-enregistrer'));
  expect(requete).toHaveBeenCalledWith('/jeux/ia/reglages', 'PUT', expect.objectContaining({ quotaAppelsApi2: 150 }));
});

test('Administration IA : test long en tâche de fond (résultat interrogé ensuite) ; IA locale tuée par l’hébergeur ; état de la transcription', async () => {
  jest.useFakeTimers();
  try {
    const ETAT2: EtatIa = {
      ...ETAT,
      local: { installe: false, raison: 'indisponible-hebergement', hebergement: { indisponible: true, tues: 2, max: 2, depuis: '2026-10-29T23:25:00.000Z' } },
      moteurs: [{ id: 'api', configure: true, raison: null, pret: true, fournisseur: 'nvidia', modele: 'mistralai/mistral-large-4-1t-a52b', hote: 'integrate.api.nvidia.com', cle: 'presente', externe: true, raisonnement: true, effort: 'high', images: false, appelsMois: 0, erreursMois: 0, plafond: 30, latenceMoyenneMs: null, dernierAppel: null }],
      ordres: { profils: ['api', 'local'], leger: ['api', 'local'] },
      transcription: {
        disponible: true,
        raison: null,
        moteur: 'auto',
        qualites: { rapide: { disponible: false, moteur: 'onnx', modele: null }, equilibree: { disponible: true, moteur: 'onnx', modele: 'turbo' }, maximale: { disponible: true, moteur: 'onnx', modele: 'large-v3' } },
        whispercpp: { installe: false, desactive: { le: '2026-10-29T23:25:00.000Z', raison: 'arrêté de force (SIGKILL) par l’hébergeur' } },
        dernierPassage: '2026-10-30T07:00:00.000Z',
        lanceur: { le: '2026-10-30T07:05:00.000Z', raison: 'déjà en cours (pid 4242)', n: 1 },
        file: { attente: 1, en_cours: 1, termine: 3, echec: 0, annule: 0 },
        bloques: 1,
      },
    };
    const { client, requete } = clientJeux();
    const base = requete.getMockImplementation()!;
    let interrogations = 0;
    requete.mockImplementation(async (chemin: string, methode = 'GET', corps?: unknown) => {
      if (chemin === '/jeux/ia') return ETAT2;
      if (chemin === '/jeux/ia/test') return { ok: null, enCours: true, test: { id: 't-1' }, etat: ETAT2 };
      if (chemin === '/jeux/ia/test/t-1') {
        interrogations += 1;
        return interrogations < 2 ? { ok: null, enCours: true, test: { id: 't-1' } } : { ok: true, enCours: false, reponse: true, dureeMs: 75_000, moteur: 'api', etat: ETAT2 };
      }
      return base(chemin, methode, corps);
    });
    await monterJeux(client);
    await fireEvent.press(await screen.findByTestId('esport-jeux-onglet-admin'));
    // IA locale arrêtée de force par l'hébergeur : expliquée, sautée, comment réessayer.
    const local = await screen.findByTestId('esport-jeux-admin-local');
    expect(within(local).getByText('indisponible sur cet hébergement')).toBeTruthy();
    expect(screen.getByTestId('esport-jeux-admin-local-indisponible').props.children).toMatch(/arrêté de force \(SIGKILL\) 2 fois .* sautée dans les ordres de repli .* rm ~\/\.appdashboard\/ia-locale\/etat\/hebergement\.json/);
    // Transcription : modèles ONNX, whisper.cpp désactivé (raison), décision du cron, file et travaux bloqués.
    const tr = screen.getByTestId('esport-jeux-admin-transcription');
    expect(within(tr).getByText('turbo (ONNX, dans Node)')).toBeTruthy();
    expect(screen.getByTestId('esport-jeux-admin-transcription-whispercpp-raison').props.children).toMatch(/arrêté de force par l’hébergeur \(arrêté de force \(SIGKILL\) par l’hébergeur\)/);
    expect(within(tr).getByText(/^déjà en cours \(pid 4242\)/)).toBeTruthy();
    expect(within(tr).getByText('1 en attente, 1 en cours, 0 en échec')).toBeTruthy();
    expect(screen.getByTestId('esport-jeux-admin-transcription-bloques').props.children).toMatch(/1 transcription\(s\) semblent bloquées/);
    // Test d'un moteur long : la requête rend tout de suite, le résultat est demandé ensuite (aucun « ne répond pas »).
    await fireEvent.press(screen.getByTestId('esport-jeux-admin-moteur-api-tester'));
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        jest.advanceTimersByTime(3000);
      });
    }
    expect(await screen.findByTestId('esport-jeux-admin-moteur-api-test')).toBeTruthy();
    expect(requete).toHaveBeenCalledWith('/jeux/ia/test/t-1');
    expect(interrogations).toBe(2);
    expect(screen.getByTestId('esport-jeux-admin-moteur-api-test').props.children).toMatch(/75/);
  } finally {
    jest.useRealTimers();
  }
});

test('anglais : la page Jeux suit la langue', async () => {
  definirLangue('en');
  const { client } = clientJeux({ ia: false });
  await monterJeux(client);
  expect(await screen.findByText('Games')).toBeTruthy();
  expect(screen.getByText('Prepare with AI')).toBeTruthy();
  expect(screen.getByText('Updates (3)')).toBeTruthy();
});

// ------------------------------------------------------------------ Modules d'une team d'un autre jeu

const detailFinals = (permissions: string[]): DetailTeam => ({
  team: { id: 't2', nom: 'Finalistes', slug: 'finalistes', jeu: 'the-finals', jeuNom: 'The Finals', description: '', logoUrl: null, fuseau: 'Europe/Paris', creeLe: '', archivee: false },
  modules: CATALOGUE.modules.map(m => ({ cle: m.cle, active: ['activity_log', 'strat_editor', 'playbook'].includes(m.cle) })),
  membres: 3,
  moi: { membreId: 'm1', role: { id: 'r1', nom: 'Coach', couleur: '#16a34a', cle: 'coach' }, permissions, superAdmin: false },
});

test('Strats d’une team The Finals : maps du profil (pool), pas de mention Riot ; aucun asset Riot chargé', async () => {
  fournirAssets(undefined);
  const fetchAvant = globalThis.fetch;
  const fetchEspion = jest.fn(async () => {
    throw new Error('réseau interdit');
  });
  (globalThis as { fetch?: unknown }).fetch = fetchEspion;
  try {
    const detail = detailFinals(['strats.view', 'strats.create', 'playbook.view']);
    const requete = jest.fn(async (chemin: string) => {
      if (chemin === '/teams/t2/jeu') return FINALS;
      if (chemin.startsWith('/teams/t2/strats')) return { strats: [] };
      throw new Error(`inattendu : ${chemin}`);
    });
    const client = { config: { adresse: 'https://esport.test', jetonRelais: 'x' }, requete, team: async () => detail, notifications: async () => ({ nonLues: 0, noms: {}, liste: [] }) } as unknown as ClientEsport;
    await render(
      <ModeAffichageForce mode="large">
        <PageTeam theme={theme} client={client} teamId="t2" large sectionInitiale="module:strat_editor" onQuitter={() => undefined} />
      </ModeAffichageForce>,
    );
    await fireEvent.press(await screen.findByTestId('esport-strats-nouvelle'));
    expect(await screen.findByTestId('esport-strats-carte-carte-a')).toBeTruthy();
    expect(screen.queryByTestId('esport-strats-carte-carte-b')).toBeNull();
    expect(screen.queryByTestId('esport-mention-riot')).toBeNull();
    expect(fetchEspion).not.toHaveBeenCalled();
  } finally {
    (globalThis as { fetch?: unknown }).fetch = fetchAvant;
    fournirAssets(assetsRepli(0));
  }
});
