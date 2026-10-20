/**
 * Bascule français ↔ anglais des principaux écrans de l'Esport (Dashboard, Teams, Membres, page d'une
 * team, profil) : le texte change aussitôt, sans remonter l'application, et l'état reste (écran courant,
 * saisie). La langue du profil est enregistrée sur le compte.
 */

import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { REGISTRE } from '../../hub/registre';
import { themeHub } from '../../hub/themes';
import { ModeAffichageForce } from '../../ui/mobile';
import { CATALOGUE, oublierSessions, type ClientEsport } from '../client';
import { fauxPlanning } from '../planning/faux';
import { Esport, fabrique } from '../ui/RacineEsport';
import { definirLangue, langueCourante } from './index';

const theme = themeHub('nuit');
const relaisReel = fabrique.relais;
const clientReel = fabrique.client;

afterEach(() => {
  fabrique.relais = relaisReel;
  fabrique.client = clientReel;
  oublierSessions();
  definirLangue('fr');
});

const DETAIL = {
  team: { id: 't1', nom: 'Faucons', slug: 'faucons', jeu: 'valorant', description: '', logoUrl: null, fuseau: 'Europe/Paris', creeLe: '', archivee: false },
  modules: CATALOGUE.modules.map(m => ({ cle: m.cle, active: ['activity_log', 'planning'].includes(m.cle) })),
  membres: 2,
  moi: { membreId: 'm1', role: { id: 'r1', nom: 'Joueur', couleur: '#16a34a', cle: 'joueur' }, permissions: ['members.view', 'planning.view'], superAdmin: false },
};

function fauxClient(surcharges: Partial<ClientEsport> = {}): ClientEsport {
  const non = async () => {
    throw new Error('non prévu');
  };
  const moi = { compte: 'lea12345', superAdmin: false, profil: { pseudo: 'Léa', riotId: null, discord: null }, peutCreerTeam: false, langue: null };
  return {
    config: { adresse: 'https://esport.test', jetonRelais: 'x' },
    sante: non,
    ouvrir: async () => moi,
    moi: async () => moi,
    majProfil: non,
    majLangue: async l => ({ ...moi, langue: l }),
    exporterMesDonnees: non,
    supprimerMesDonnees: non,
    teams: async () => [{ ...DETAIL.team, membres: 2, modules: ['activity_log', 'planning'], role: { nom: 'Joueur', couleur: '#16a34a' }, suspendu: false }],
    creerTeam: non,
    team: async () => DETAIL,
    modifierTeam: non,
    supprimerTeam: non,
    changerModules: non,
    roles: async () => [],
    creerRole: non,
    modifierRole: non,
    supprimerRole: non,
    membres: async () => [],
    modifierMembre: non,
    retirerMembre: non,
    ajouterMembre: non,
    annuaire: async () => ({ superAdmin: false, peutCreerCompte: false, teams: [], comptes: [] }),
    tableau: async () => ({
      genereLe: '',
      teams: [
        {
          team: DETAIL.team,
          role: { nom: 'Joueur', couleur: '#16a34a', cle: 'joueur' },
          effectif: { actifs: 2, invites: 1, suspendus: 0 },
          prochains: [],
          presence: null,
          resumes: null,
          taches: { enRetard: 1 },
          derniereActivite: null,
        },
      ],
      global: { resumesARediger: 0, evenementsSemaine: [], alertes: [{ genre: 'taches', teamId: 't1', teamNom: 'Faucons', nombre: 2, texte: '2 tâches en retard' }] },
    }),
    verifierPreinscription: non,
    preinscrire: non,
    retirerCompte: non,
    journal: async () => ({ entrees: [], noms: {}, suite: null }),
    notifications: async () => ({ nonLues: 0, noms: {}, liste: [] }),
    marquerLues: non,
    requete: fauxPlanning(DETAIL.moi.permissions).requete,
    ...surcharges,
  } as ClientEsport;
}

async function monter(client = fauxClient()) {
  fabrique.relais = () => ({ relais: 'https://applibourse-relais.enzo.workers.dev', jeton: 'x'.repeat(20) });
  fabrique.client = () => client;
  return render(
    <ModeAffichageForce mode="large">
      <Esport contexte={{}} theme={theme} registre={REGISTRE} onRetour={() => undefined} />
    </ModeAffichageForce>,
  );
}

const basculer = (l: 'fr' | 'en') => act(() => definirLangue(l));

describe('bascule de langue', () => {
  it('Dashboard : textes, pluriels et alertes changent aussitôt, sans recharger', async () => {
    await monter();
    await screen.findByTestId('esport-dashboard');
    expect(screen.getByText('Toutes vos teams en un coup d’œil : chiffres clés, semaine à venir, alertes.')).toBeTruthy();
    expect(screen.getByTestId('esport-alerte-taches-t1')).toHaveTextContent(/Faucons · 2 tâches en retard/);
    await basculer('en');
    expect(screen.getByText('All your teams at a glance: key figures, the week ahead, alerts.')).toBeTruthy();
    expect(screen.getByTestId('esport-alerte-taches-t1')).toHaveTextContent(/Faucons · 2 overdue tasks/);
    expect(screen.getByText('2 active members')).toBeTruthy();
    expect(screen.getByText('1 invited member not signed in yet')).toBeTruthy();
    expect(screen.queryByText(/chiffres clés/)).toBeNull();
    await basculer('fr');
    expect(screen.getByTestId('esport-alerte-taches-t1')).toHaveTextContent(/Faucons · 2 tâches en retard/);
    expect(screen.getByText('1 invité pas encore connecté')).toBeTruthy();
  });

  it('Teams, Membres puis page d’une team : l’écran courant est conservé pendant la bascule', async () => {
    await monter();
    await screen.findByTestId('esport-dashboard');
    await basculer('en');
    await fireEvent.press(screen.getByTestId('esport-nav-teams'));
    await screen.findByTestId('esport-teams');
    expect(screen.getByText('My teams')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-nav-membres'));
    expect(await screen.findByTestId('esport-membres-global')).toBeTruthy();
    expect(screen.getAllByText('Members').length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByTestId('esport-nav-teams'));
    await fireEvent.press(await screen.findByTestId('esport-team-faucons'));
    await screen.findByTestId('esport-barre');
    // Rôle système et libellés du catalogue, en anglais.
    expect(within(screen.getByTestId('esport-mon-role')).getByText('Player')).toBeTruthy();
    expect(screen.getByTestId('esport-section-agenda')).toBeTruthy();
    // Bascule en plein écran de team : on reste sur la team.
    await basculer('fr');
    expect(screen.getByTestId('esport-barre')).toBeTruthy();
    expect(within(screen.getByTestId('esport-mon-role')).getByText('Joueur')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-section-reglages'));
    expect((await screen.findAllByText('Mon profil Esport')).length).toBeGreaterThan(0);
    await basculer('en');
    expect(screen.getAllByText('My Esport profile').length).toBeGreaterThan(0);
  });

  it('choisir English dans le profil : changement instantané et enregistré sur le compte', async () => {
    const majLangue = jest.fn(async (l: 'fr' | 'en') => ({ compte: 'lea12345', superAdmin: false, profil: { pseudo: 'Léa', riotId: null, discord: null }, peutCreerTeam: false, langue: l }));
    await monter(fauxClient({ majLangue }));
    await screen.findByTestId('esport-dashboard');
    await fireEvent.press(screen.getByTestId('esport-nav-teams'));
    await screen.findByTestId('esport-teams');
    await fireEvent.press(await screen.findByTestId('esport-mon-profil-ouvrir'));
    await fireEvent.press(await screen.findByTestId('esport-profil-langue-en'));
    expect(majLangue).toHaveBeenCalledWith('en');
    expect(langueCourante()).toBe('en');
    expect(await screen.findByText('Language saved.')).toBeTruthy();
    expect(screen.getByText('Save the profile')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-profil-langue-fr'));
    expect(majLangue).toHaveBeenLastCalledWith('fr');
    expect(screen.getByText('Enregistrer le profil')).toBeTruthy();
  });

  it('langue du compte appliquée à l’ouverture ; sans choix, langue de l’appareil', async () => {
    const moi = { compte: 'lea12345', superAdmin: false, profil: { pseudo: 'Léa', riotId: null, discord: null }, peutCreerTeam: false, langue: 'en' as const };
    const { unmount } = await monter(fauxClient({ ouvrir: async () => moi }));
    expect(await screen.findByText('All your teams at a glance: key figures, the week ahead, alerts.')).toBeTruthy();
    await unmount();
    // Un autre compte, sans langue choisie : on repart de la langue de l'appareil (français dans les tests).
    await monter();
    expect(await screen.findByText('Toutes vos teams en un coup d’œil : chiffres clés, semaine à venir, alertes.')).toBeTruthy();
    expect(langueCourante()).toBe('fr');
  });

  it('« Esport pas encore activé » (hors serveur) suit la langue de l’appareil puis celle choisie', async () => {
    fabrique.relais = () => undefined;
    (globalThis as { __ESPORT_LANGUE_APPAREIL__?: string }).__ESPORT_LANGUE_APPAREIL__ = 'en-GB';
    definirLangue('en');
    await render(
      <ModeAffichageForce mode="large">
        <Esport contexte={{}} theme={theme} registre={REGISTRE} onRetour={() => undefined} />
      </ModeAffichageForce>,
    );
    expect(await screen.findByText('Esport not enabled yet')).toBeTruthy();
    (globalThis as { __ESPORT_LANGUE_APPAREIL__?: string }).__ESPORT_LANGUE_APPAREIL__ = 'fr';
  });
});
