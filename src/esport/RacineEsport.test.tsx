/**
 * Écran Esport : serveur absent (« Esport pas encore activé », rien ne casse),
 * pseudo à choisir, navigation Dashboard · Teams · Membres, team visible sans
 * code, page d'une team.
 */

import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { REGISTRE } from '../hub/registre';
import { THEMES_HUB, themeHub } from '../hub/themes';
import { ModeAffichageForce } from '../ui/mobile';
import { CATALOGUE, DOC_ACTIVATION, ErreurEsport, oublierSessions, type ClientEsport } from './client';
import { Esport, fabrique } from './ui/RacineEsport';
import { fauxPlanning } from './planning/faux';

const theme = themeHub('nuit');
const relaisReel = fabrique.relais;
const clientReel = fabrique.client;

afterEach(() => {
  fabrique.relais = relaisReel;
  fabrique.client = clientReel;
  oublierSessions();
});

async function monter(props: Partial<React.ComponentProps<typeof Esport>> = {}, mode: 'large' | 'telephone' = 'large') {
  return render(
    <ModeAffichageForce mode={mode}>
      <Esport contexte={{}} theme={props.theme ?? theme} registre={REGISTRE} onRetour={() => undefined} {...props} />
    </ModeAffichageForce>,
  );
}

const DETAIL = {
  team: { id: 't1', nom: 'Faucons', slug: 'faucons', jeu: 'valorant', description: 'Team test', logoUrl: null, fuseau: 'Europe/Paris', creeLe: '', archivee: false },
  modules: CATALOGUE.modules.map(m => ({ cle: m.cle, active: ['activity_log', 'planning'].includes(m.cle) })),
  membres: 2,
  moi: { membreId: 'm1', role: { id: 'r1', nom: 'Joueur', couleur: '#16a34a', cle: 'joueur' }, permissions: ['members.view', 'planning.view'], superAdmin: false },
};

function fauxClient(surcharges: Partial<ClientEsport> = {}): ClientEsport {
  const non = async () => {
    throw new Error('non prévu');
  };
  return {
    config: { adresse: 'https://esport.test', jetonRelais: 'x' },
    sante: non,
    ouvrir: async () => ({ compte: 'lea12345', superAdmin: false, profil: { pseudo: 'Léa', riotId: null, discord: null }, peutCreerTeam: false }),
    moi: async () => ({ compte: 'lea12345', superAdmin: false, profil: { pseudo: 'Léa', riotId: null, discord: null }, peutCreerTeam: false }),
    majProfil: non,
    exporterMesDonnees: non,
    supprimerMesDonnees: non,
    teams: async () => [],
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
    tableau: async () => ({ genereLe: '', teams: [], global: { resumesARediger: 0, evenementsSemaine: [], alertes: [] } }),
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

describe('Esport', () => {
  it('appareil non relié au relais : « Esport pas encore activé », sans plantage', async () => {
    fabrique.relais = () => undefined;
    await monter();
    expect(await screen.findByTestId('esport-inactif')).toBeTruthy();
    expect(screen.getByText('Esport pas encore activé')).toBeTruthy();
  });

  it('serveur pas encore en ligne : « pas encore activé » et lien vers la marche à suivre (Fondateur)', async () => {
    fabrique.relais = () => ({ relais: 'https://relais.appdashboard.fr', jeton: 'jeton-maitre-de-test-0123456789' });
    fabrique.client = () => fauxClient({ ouvrir: async () => Promise.reject(new ErreurEsport('injoignable', 0, 'injoignable')) });
    const ouvrir = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await monter();
    await screen.findByTestId('esport-inactif');
    await fireEvent.press(screen.getByTestId('esport-doc'));
    expect(ouvrir).toHaveBeenCalledWith(DOC_ACTIVATION);
    ouvrir.mockRestore();
  });

  it('ami : pas de lien de doc, seulement « réessayer »', async () => {
    fabrique.relais = () => ({ relais: 'https://relais.appdashboard.fr', jeton: 'p1.lea12345.' + 'a'.repeat(64) });
    fabrique.client = () => fauxClient({ ouvrir: async () => Promise.reject(new ErreurEsport('ancien', 503, 'relais-ancien')) });
    await monter({ contexte: { profil: { id: 'lea12345', nom: 'Léa', admin: false, creeLe: '', apps: ['esport'] } } });
    await screen.findByTestId('esport-inactif');
    expect(screen.queryByTestId('esport-doc')).toBeNull();
    expect(screen.getByText(/Le Fondateur n’a pas encore activé l’Esport/)).toBeTruthy();
  });

  it('premier passage : pseudo obligatoire, mention des données en clair', async () => {
    const majProfil = jest.fn(async (p: { pseudo: string }) => ({ compte: 'lea12345', superAdmin: false, profil: { pseudo: p.pseudo, riotId: null, discord: null }, peutCreerTeam: false }));
    fabrique.relais = () => ({ relais: 'https://relais.appdashboard.fr', jeton: 'x'.repeat(20) });
    fabrique.client = () => fauxClient({ ouvrir: async () => ({ compte: 'lea12345', superAdmin: false, profil: null, peutCreerTeam: false }), majProfil });
    await monter();
    await screen.findByTestId('esport-profil-initial');
    expect(screen.getByTestId('esport-mention').props.children).toMatch(/en clair sur le serveur/);
    await fireEvent.changeText(screen.getByTestId('esport-pseudo'), 'Léa');
    await fireEvent.press(screen.getByTestId('esport-pseudo-valider'));
    expect(majProfil).toHaveBeenCalledWith({ pseudo: 'Léa', riotId: undefined, discord: undefined });
    // On arrive sur le Dashboard (navigation de premier niveau).
    expect(await screen.findByTestId('esport-dashboard')).toBeTruthy();
    expect(screen.getByTestId('esport-dashboard-vide')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-nav-teams'));
    expect(await screen.findByTestId('esport-teams')).toBeTruthy();
    expect(screen.queryByTestId('esport-creer')).toBeNull();
  });

  it('plus de code : la team où le Fondateur l’a ajouté est déjà là ; Teams et Dashboard l’ouvrent ; barre limitée aux modules', async () => {
    const teams = [{ ...DETAIL.team, membres: 2, modules: ['activity_log', 'planning'], role: { nom: 'Joueur', couleur: '#16a34a' }, suspendu: false }];
    fabrique.relais = () => ({ relais: 'https://relais.appdashboard.fr', jeton: 'x'.repeat(20) });
    fabrique.client = () =>
      fauxClient({
        teams: async () => teams,
        tableau: async () => ({
          genereLe: '',
          teams: [
            {
              team: DETAIL.team,
              role: { nom: 'Joueur', couleur: '#16a34a', cle: 'joueur' },
              effectif: { actifs: 2, invites: 0, suspendus: 0 },
              prochains: [{ teamId: 't1', evenementId: 'e1', cle: '2026-10-22T18:00:00.000Z', type: 'training', titre: 'Entraînement', debut: '2026-10-22T18:00:00.000Z', fin: '2026-10-22T20:00:00.000Z', lieu: '' }],
              presence: null,
              resumes: null,
              taches: { enRetard: 1 },
              derniereActivite: { date: '2026-10-20T08:00:00.000Z' },
            },
          ],
          global: { resumesARediger: 0, evenementsSemaine: [], alertes: [{ genre: 'taches', teamId: 't1', teamNom: 'Faucons', nombre: 1, texte: '1 tâche en retard' }] },
        }),
      });
    await monter();
    // Dashboard : la carte de la team, avec ses blocs autorisés.
    await screen.findByTestId('esport-dashboard-teams');
    expect(screen.getByTestId('esport-carte-taches-faucons')).toHaveTextContent(/1/);
    expect(screen.queryByTestId('esport-carte-presence-faucons')).toBeNull();
    expect(screen.getByTestId('esport-alerte-taches-t1')).toBeTruthy();
    // Teams : aucun champ de code, la team est listée.
    await fireEvent.press(screen.getByTestId('esport-nav-teams'));
    await screen.findByTestId('esport-teams');
    expect(screen.queryByTestId('esport-code')).toBeNull();
    expect(screen.queryByTestId('esport-rejoindre')).toBeNull();
    await fireEvent.press(await screen.findByTestId('esport-team-faucons'));
    await screen.findByTestId('esport-barre');
    // Sections : Accueil, Agenda (Planning seul : pas de sous-onglets), Équipe (Membres), Réglages ; pas de Jeu (aucun module).
    expect(screen.getByTestId('esport-section-agenda')).toBeTruthy();
    expect(screen.queryByTestId('esport-section-jeu')).toBeNull();
    expect(screen.queryByTestId('esport-onglet-module-scouting')).toBeNull();
    // Joueur : pas de journal (permission), mais Membres et Paramètres.
    await fireEvent.press(screen.getByTestId('esport-section-reglages'));
    expect(await screen.findByTestId('esport-parametres')).toBeTruthy();
    expect(screen.queryByTestId('esport-onglet-journal')).toBeNull();
    await fireEvent.press(screen.getByTestId('esport-section-equipe'));
    expect(await screen.findByTestId('esport-membres')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-section-agenda'));
    // Planning livré (phase 2) : l'écran s'ouvre ; un Joueur n'a pas le bouton de création.
    expect(await screen.findByTestId('esport-planning')).toBeTruthy();
    expect(screen.queryByTestId('esport-planning-nouveau')).toBeNull();
    // Retour : la liste des teams ; la carte du Dashboard ouvre aussi la team.
    await fireEvent.press(screen.getAllByTestId('esport-team-retour')[0]);
    await fireEvent.press(await screen.findByTestId('esport-nav-dashboard'));
    await fireEvent.press(await screen.findByTestId('esport-team-faucons'));
    expect(await screen.findByTestId('esport-barre')).toBeTruthy();
  });

  it('s’affiche dans les 8 thèmes (clairs et sombres) et sur téléphone', async () => {
    fabrique.relais = () => ({ relais: 'https://relais.appdashboard.fr', jeton: 'x'.repeat(20) });
    fabrique.client = () => fauxClient();
    expect(THEMES_HUB.length).toBe(8);
    for (const t of THEMES_HUB) {
      const { unmount } = await monter({ theme: t }, 'telephone');
      expect(await screen.findByTestId('esport-dashboard')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('esport-nav-membres'));
      await fireEvent.press(await screen.findByTestId('esport-membres-onglet-tous'));
      expect(await screen.findByTestId('esport-membres-global')).toBeTruthy();
      await unmount();
    }
  });
});
