/**
 * Invitation directe depuis l'Esport (écran) et page Membres :
 *  - le Fondateur crée un compte (nom, e-mail, team et rôle) : contrôle Esport
 *    d'abord, compte du hub « Esport seulement », adresse chiffrée dans
 *    l'Administration, pré-enregistrement Esport, e-mail d'invitation (mailto) ;
 *  - un Manager : pas de création de compte, anti-escalade dans la page Membres,
 *    ajout d'un compte existant ;
 *  - renvoi d'invitation ;
 *  - suppression dans l'Administration → retrait de l'Esport.
 */

import React from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Administration } from '../hub/Administration';
import { chargerDonnees } from '../hub/admin/donnees';
import { REGISTRE } from '../hub/registre';
import { themeHub } from '../hub/themes';
import type { ContexteHub, ServicesAdmin } from '../hub/types';
import type { IdentifiantsAmi, InvitationAffichee } from '../profils/identifiants';
import { ID_PRINCIPAL, type Profil } from '../profils/profils';
import type { ControleProfils } from '../ui/ecrans/CarteProfils';
import { ModeAffichageForce } from '../ui/mobile';
import { ErreurEsport, oublierSessions, type Annuaire, type ClientEsport, type CompteEsport } from './client';
import { modeleInvitationEsport } from './comptesHub';
import { fabrique } from './fabrique';
import { comptesHubSansEsport, comptesOrphelins, retirerCompteEsport } from './synchroAdmin';
import { oublierVerification } from './ui/Identite';
import { filtrerComptes } from './ui/MembresGlobal';
import { Esport } from './ui/RacineEsport';

const theme = themeHub('nuit');
const relaisReel = fabrique.relais;
const clientReel = fabrique.client;
const LIEN = 'https://site.exemple.fr/#invitation=AI1.secret-du-lien';
const fondateur: Profil = { id: ID_PRINCIPAL, nom: 'Enzo', admin: true, creeLe: '' };

beforeEach(() => {
  oublierVerification();
  fabrique.relais = () => ({ relais: 'https://applibourse-relais.enzo.workers.dev', jeton: 'jeton-maitre-de-test-0123456789' });
});
afterEach(() => {
  fabrique.relais = relaisReel;
  fabrique.client = clientReel;
  oublierSessions();
});

const ROLES = [
  { id: 'r-prop', nom: 'Propriétaire', couleur: '#d64545', cle: 'proprietaire', position: 0, systeme: true },
  { id: 'r-man', nom: 'Manager', couleur: '#f59e0b', cle: 'manager', position: 1, systeme: true },
  { id: 'r-jou', nom: 'Joueur', couleur: '#16a34a', cle: 'joueur', position: 4, systeme: true },
];

function annuaire(superAdmin: boolean, comptes: CompteEsport[] = []): Annuaire {
  const attribuable = (cle: string) => superAdmin || cle === 'joueur';
  return {
    superAdmin,
    peutCreerCompte: superAdmin,
    teams: [
      { id: 't1', nom: 'Faucons', slug: 'faucons', jeu: 'valorant', archivee: false, droits: { ajouter: true, roles: true, retirer: true }, roles: ROLES.map(r => ({ ...r, attribuable: attribuable(r.cle) })) },
      { id: 't2', nom: 'Aigles', slug: 'aigles', jeu: 'valorant', archivee: false, droits: { ajouter: true, roles: true, retirer: true }, roles: ROLES.map(r => ({ ...r, id: `${r.id}-2`, attribuable: attribuable(r.cle) })) },
    ],
    comptes,
  };
}

const compte = (id: string, pseudo: string, extra: Partial<CompteEsport> = {}): CompteEsport => ({
  compte: id,
  pseudo,
  riotId: null,
  discord: null,
  statut: 'actif',
  inviteLe: null,
  activeLe: null,
  moi: false,
  appartenances: [],
  ...extra,
});

function fauxClient(surcharges: Partial<ClientEsport>): ClientEsport {
  const non = async () => {
    throw new Error('non prévu');
  };
  return new Proxy({ config: { adresse: 'https://esport.test', jetonRelais: 'x' }, ...surcharges } as ClientEsport, {
    get: (cible, cle) => (cle in cible ? cible[cle as keyof ClientEsport] : cle === 'tableau' ? async () => ({ genereLe: '', teams: [], global: { resumesARediger: 0, evenementsSemaine: [], alertes: [] } }) : non),
  });
}

function contexteFondateur(tous: Profil[], options: Partial<ControleProfils> = {}) {
  const valeurs = new Map<string, string>();
  const stockage: ServicesAdmin['stockage'] = { lire: cle => valeurs.get(cle), ecrire: (cle, valeur) => void valeurs.set(cle, valeur) };
  const appels: string[] = [];
  const creations: unknown[][] = [];
  let liste = tous;
  const verifierIdentite = jest.fn();
  const profils = {
    actuel: fondateur,
    get tous() {
      return liste;
    },
    onChanger: () => undefined,
    onAjouter: async () => undefined,
    onSupprimer: async () => undefined,
    onRenommer: async () => undefined,
    onCreerCompte: async (...args: unknown[]): Promise<IdentifiantsAmi> => {
      appels.push('hub');
      creations.push(args);
      liste = [...liste, { id: 'lea0000001', nom: String(args[0]), admin: false, creeLe: '2026-10-20', apps: ['esport'], actif: true }];
      return {
        id: 'lea0000001',
        motDePasse: 'abcde-FGHJK-23456-mnpqr',
        codesRecuperation: [],
        secretTotp: 'JBSWY3DPEHPK3PXP',
        uriTotp: 'otpauth://totp/x',
        invitation: { lien: LIEN, expire: '2026-10-27T10:00:00Z', prenom: String(args[0]), fondateur: 'Enzo', longueur: 10, publie: true },
      };
    },
    onModifierProfils: async (suivants: readonly Profil[]) => {
      liste = [...suivants];
    },
    ...options,
  } as unknown as ControleProfils;
  const ctx: ContexteHub = { profil: fondateur, profils, admin: { stockage, verifierIdentite, etatCoffre: () => undefined }, maintenant: Date.parse('2026-10-20T10:00:00Z') };
  return { ctx, stockage, appels, creations, verifierIdentite };
}

const monter = (contexte: ContexteHub) =>
  render(
    <ModeAffichageForce mode="large">
      <Esport contexte={contexte} theme={theme} registre={REGISTRE} onRetour={() => undefined} />
    </ModeAffichageForce>,
  );

async function confirmerIdentite() {
  await screen.findByTestId('admin-identite');
  await fireEvent.changeText(screen.getByTestId('admin-identite-mdp'), 'mot-de-passe');
  await fireEvent.changeText(screen.getByTestId('admin-identite-code'), '123456');
  await act(async () => {
    fireEvent.press(screen.getByTestId('admin-identite-valider'));
    await new Promise<void>(r => setTimeout(r, 30));
  });
}

const moi = (superAdmin: boolean) => async () => ({ compte: superAdmin ? 'principal' : 'max12345', superAdmin, profil: { pseudo: superAdmin ? 'Enzo' : 'Max', riotId: null, discord: null }, peutCreerTeam: superAdmin });

describe('Esport › Membres : invitation directe', () => {
  it('Fondateur : nom, e-mail, team et rôle → contrôle Esport, compte du hub « Esport seulement », adresse chiffrée, pré-enregistrement, e-mail prêt', async () => {
    const ouvrir = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const { ctx, stockage, appels, creations, verifierIdentite } = contexteFondateur([fondateur]);
    const verifierPreinscription = jest.fn(async () => {
      appels.push('verification');
    });
    const preinscrire = jest.fn(async (c: { compte: string; pseudo: string }) => {
      appels.push('esport');
      return compte(c.compte, c.pseudo, { statut: 'invite' });
    });
    fabrique.client = () => fauxClient({ ouvrir: moi(true), annuaire: async () => annuaire(true), verifierPreinscription, preinscrire });
    await monter(ctx);
    await fireEvent.press(await screen.findByTestId('esport-nav-membres'));
    await fireEvent.press(await screen.findByTestId('esport-membres-creer'));
    await fireEvent.changeText(screen.getByTestId('esport-compte-nom'), 'Léa');
    await fireEvent.changeText(screen.getByTestId('esport-compte-email'), 'lea@exemple');
    expect(screen.getByTestId('esport-compte-etat')).toHaveTextContent(/Adresse e-mail invalide/);
    await fireEvent.changeText(screen.getByTestId('esport-compte-email'), ' Lea@Exemple.FR ');
    expect(screen.getByTestId('esport-compte-etat')).toHaveTextContent(/au moins une team/);
    await fireEvent.press(screen.getByTestId('esport-compte-team-faucons'));
    // Rôle Joueur proposé par défaut ; poste facultatif.
    await fireEvent.changeText(screen.getByTestId('esport-compte-poste-faucons'), 'Duelliste');
    await fireEvent.press(screen.getByTestId('esport-compte-creer'));
    // Vérification d'identité du Fondateur, comme dans l'Administration.
    await confirmerIdentite();
    expect(verifierIdentite).toHaveBeenCalledWith('mot-de-passe', '123456');
    await screen.findByTestId('esport-compte-cree');
    // Contrôle Esport AVANT le compte du hub, puis pré-enregistrement.
    expect(appels).toEqual(['verification', 'hub', 'esport']);
    expect(verifierPreinscription).toHaveBeenCalledWith({ pseudo: 'Léa', affectations: [{ teamId: 't1', roleId: 'r-jou', posteJeu: 'Duelliste' }] });
    expect(creations[0][0]).toBe('Léa');
    expect(creations[0][1]).toEqual(['esport']);
    expect(creations[0][3]).toEqual({ politique: { longueurMin: 10, forceMin: 1 } });
    expect(preinscrire).toHaveBeenCalledWith({ compte: 'lea0000001', pseudo: 'Léa', affectations: [{ teamId: 't1', roleId: 'r-jou', posteJeu: 'Duelliste' }] });
    // Adresse chiffrée dans l'Administration, journal sans l'adresse.
    expect(chargerDonnees(stockage).contacts.lea0000001.email).toBe('Lea@exemple.fr');
    expect(JSON.stringify(chargerDonnees(stockage).journal)).toMatch(/créé depuis l’Esport/);
    expect(JSON.stringify(chargerDonnees(stockage).journal)).not.toMatch(/exemple\.fr/);
    // E-mail d'invitation : mailto pré-rempli, avec le lien et la team, sans mot de passe.
    await fireEvent.press(screen.getByTestId('admin-invitation-email'));
    const url = ouvrir.mock.calls[0][0];
    expect(url.startsWith('mailto:Lea@exemple.fr?subject=')).toBe(true);
    const corps = decodeURIComponent(url.split('body=')[1]);
    expect(corps).toContain(LIEN);
    expect(corps).toMatch(/dans la team Faucons/);
    expect(corps).toMatch(/aucun code à saisir/);
    expect(corps).not.toContain('abcde-FGHJK-23456-mnpqr');
    expect(chargerDonnees(stockage).contacts.lea0000001.envois.map(e => e.canal)).toEqual(['email']);
    ouvrir.mockRestore();
  });

  it('pseudo déjà pris dans l’Esport : refus AVANT de créer le compte du hub', async () => {
    const { ctx, appels } = contexteFondateur([fondateur]);
    fabrique.client = () =>
      fauxClient({
        ouvrir: moi(true),
        annuaire: async () => annuaire(true),
        verifierPreinscription: async () => {
          throw new ErreurEsport('Ce pseudo est déjà pris dans l’Esport.', 409, 'pseudo-pris');
        },
      });
    await monter(ctx);
    await fireEvent.press(await screen.findByTestId('esport-nav-membres'));
    await fireEvent.press(await screen.findByTestId('esport-membres-creer'));
    await fireEvent.changeText(screen.getByTestId('esport-compte-nom'), 'Léa');
    await fireEvent.changeText(screen.getByTestId('esport-compte-email'), 'lea@exemple.fr');
    await fireEvent.press(screen.getByTestId('esport-compte-team-aigles'));
    await fireEvent.press(screen.getByTestId('esport-compte-creer'));
    await confirmerIdentite();
    await waitFor(() => expect(screen.getByTestId('esport-compte-erreur')).toHaveTextContent(/déjà pris/));
    expect(appels).toEqual([]);
  });

  it('Manager : pas de création de compte ; anti-escalade (Propriétaire non gérable, rôles au-dessus grisés) ; ajout d’un compte existant', async () => {
    const lea = compte('lea12345', 'Léa', { appartenances: [{ teamId: 't1', membreId: 'm-lea', role: { id: 'r-jou', nom: 'Joueur', couleur: '#16a34a', cle: 'joueur' }, posteJeu: null, statut: 'actif', rejointLe: '', gerable: true }] });
    const enzo = compte('principal', 'Enzo', { appartenances: [{ teamId: 't1', membreId: 'm-enzo', role: { id: 'r-prop', nom: 'Propriétaire', couleur: '#d64545', cle: 'proprietaire' }, posteJeu: null, statut: 'actif', rejointLe: '', gerable: false }] });
    const ajouterATeams = jest.fn(async () => lea);
    fabrique.client = () => fauxClient({ ouvrir: moi(false), annuaire: async () => annuaire(false, [enzo, lea]), ajouterATeams });
    await monter({ profil: { id: 'max12345', nom: 'Max', admin: false, creeLe: '', apps: ['esport'] } });
    await fireEvent.press(await screen.findByTestId('esport-nav-membres'));
    await screen.findByTestId('esport-compte-lea12345');
    expect(screen.queryByTestId('esport-membres-creer')).toBeNull();
    expect(screen.getByTestId('esport-membres-creation-indisponible')).toHaveTextContent(/Seul le Fondateur crée des comptes/);
    // Le Propriétaire : aucune action.
    await fireEvent.press(screen.getByLabelText('Gérer Enzo'));
    expect(screen.queryByTestId('esport-appartenance-suspendre-faucons-principal')).toBeNull();
    expect(screen.getByText(/Rôle au-dessus du vôtre/)).toBeTruthy();
    // Léa : rôle et suspension possibles, mais pas les rôles au-dessus du sien.
    await fireEvent.press(screen.getByLabelText('Gérer Léa'));
    expect(screen.getByTestId('esport-appartenance-suspendre-faucons-lea12345')).toBeTruthy();
    expect(screen.getByTestId('esport-appartenance-role-faucons-lea12345-r-prop').props.accessibilityState.disabled).toBe(true);
    // Ajouter Léa à la team Aigles, en Joueur.
    expect(screen.getByTestId('esport-ajout-deja-lea12345-faucons')).toHaveTextContent('déjà membre');
    await fireEvent.press(screen.getByTestId('esport-ajout-team-lea12345-aigles'));
    expect(screen.getByTestId('esport-ajout-role-lea12345-aigles-r-man-2').props.accessibilityState.disabled).toBe(true);
    await act(async () => {
      fireEvent.press(screen.getByTestId('esport-ajout-valider-lea12345'));
      await new Promise<void>(r => setTimeout(r, 20));
    });
    expect(ajouterATeams).toHaveBeenCalledWith('lea12345', { affectations: [{ teamId: 't2', roleId: 'r-jou-2' }] });
  });

  it('Fondateur : renvoyer l’invitation d’un invité (nouveau lien, message Esport)', async () => {
    const zoe: Profil = { id: 'zoe0000001', nom: 'Zoé', admin: false, creeLe: '', apps: ['esport'], actif: true };
    const onInvitation = jest.fn(async (): Promise<InvitationAffichee> => ({ lien: `${LIEN}-2`, expire: '2026-10-27T10:00:00Z', prenom: 'Zoé', longueur: 10 }));
    const { ctx } = contexteFondateur([fondateur, zoe], { onInvitation });
    const invitee = compte('zoe0000001', 'Zoé', {
      statut: 'invite',
      inviteLe: '2026-10-19T10:00:00Z',
      appartenances: [{ teamId: 't1', membreId: 'm-zoe', role: { id: 'r-jou', nom: 'Joueur', couleur: '#16a34a', cle: 'joueur' }, posteJeu: null, statut: 'actif', rejointLe: '', gerable: true }],
    });
    fabrique.client = () => fauxClient({ ouvrir: moi(true), annuaire: async () => annuaire(true, [invitee]) });
    await monter(ctx);
    await fireEvent.press(await screen.findByTestId('esport-nav-membres'));
    expect(await screen.findByTestId('esport-compte-statut-zoe0000001')).toHaveTextContent('Invité');
    // Filtre « Invités ».
    await fireEvent.press(screen.getByTestId('esport-membres-statut-actif'));
    expect(screen.queryByTestId('esport-compte-zoe0000001')).toBeNull();
    await fireEvent.press(screen.getByTestId('esport-membres-statut-invite'));
    await fireEvent.press(screen.getByLabelText('Gérer Zoé'));
    await fireEvent.press(screen.getByTestId('esport-renvoyer-zoe0000001'));
    await confirmerIdentite();
    await screen.findByTestId('admin-invitation');
    expect(onInvitation).toHaveBeenCalledWith('zoe0000001', 7, { politique: { longueurMin: 10, forceMin: 1 } });
    expect(screen.getByTestId('admin-invitation-message')).toHaveTextContent(/dans la team Faucons/);
  });
});

describe('Une seule source de vérité : suppression dans l’Administration', () => {
  it('supprimer un compte « Esport » dans l’Administration le retire de l’Esport', async () => {
    const lea: Profil = { id: 'lea0000001', nom: 'Léa', admin: false, creeLe: '2026-10-01', apps: ['esport'], actif: true };
    const retirerCompte = jest.fn(async () => ({ ok: true, retire: true, teams: 2 }));
    fabrique.client = () => fauxClient({ retirerCompte });
    const onSupprimer = jest.fn(async () => undefined);
    const { ctx, stockage } = contexteFondateur([fondateur, lea], { onSupprimer });
    await render(<Administration contexte={ctx} theme={theme} registre={REGISTRE} onRetour={() => undefined} />);
    await fireEvent.press(screen.getByTestId('admin-onglet-utilisateurs'));
    await fireEvent.press(screen.getByTestId('admin-ligne-lea0000001'));
    await fireEvent.press(screen.getByTestId('admin-supprimer'));
    await fireEvent.changeText(screen.getByTestId('admin-confirmation-nom'), 'Léa');
    await fireEvent.press(screen.getByTestId('admin-confirmer'));
    await confirmerIdentite();
    await waitFor(() => expect(retirerCompte).toHaveBeenCalledWith('lea0000001'));
    expect(onSupprimer).toHaveBeenCalledWith('lea0000001');
    await waitFor(() => expect(JSON.stringify(chargerDonnees(stockage).journal)).toMatch(/Léa retiré de l’Esport \(2 teams\)/));
  });

  it('retrait : Esport pas activé → rien ; serveur en panne → erreur (à reprendre depuis Esport › Membres)', async () => {
    fabrique.relais = () => undefined;
    expect(await retirerCompteEsport('lea0000001')).toEqual({ retire: false, teams: 0, inactif: true });
    fabrique.relais = () => ({ relais: 'https://applibourse-relais.enzo.workers.dev', jeton: 'jeton-maitre-de-test-0123456789' });
    fabrique.client = () =>
      fauxClient({
        retirerCompte: async () => {
          throw new Error('Erreur 500');
        },
      });
    await expect(retirerCompteEsport('lea0000001')).rejects.toThrow('Erreur 500');
  });

  it('comptes orphelins : seulement avec la liste complète des comptes du hub', () => {
    const comptes = [compte('principal', 'Enzo'), compte('lea0000001', 'Léa'), compte('vieux00001', 'Vieux')];
    expect(comptesOrphelins(comptes, [{ id: ID_PRINCIPAL }, { id: 'lea0000001' }], true).map(c => c.compte)).toEqual(['vieux00001']);
    expect(comptesOrphelins(comptes, [{ id: 'lea0000001' }], false)).toEqual([]);
  });
});

describe('Esport › Membres : comptes du hub créés dans l’Administration (sans fiche Esport)', () => {
  const luca: Profil = { id: 'luca000001', nom: 'LUCA', admin: false, creeLe: '2026-09-01', apps: ['esport', 'portefeuille'], actif: true };
  const sansEsport: Profil = { id: 'zoe0000001', nom: 'Zoé', admin: false, creeLe: '2026-09-01', apps: ['portefeuille'], actif: true };
  const desactive: Profil = { id: 'old0000001', nom: 'Ancien', admin: false, creeLe: '2026-09-01', apps: ['esport'], actif: false };

  it('aide pure : seulement les comptes du hub avec l’Esport, sans fiche, avec la liste complète', () => {
    const connus = [compte('principal', 'Enzo', { moi: true }), compte('lea0000001', 'Léa')];
    const lea: Profil = { id: 'lea0000001', nom: 'Léa', admin: false, creeLe: '', apps: ['esport'] };
    const r = comptesHubSansEsport(connus, [fondateur, luca, sansEsport, desactive, lea], true);
    expect(r.map(c => [c.compte, c.pseudo, c.horsEsport, c.appartenances.length])).toEqual([['luca000001', 'LUCA', true, 0]]);
    expect(comptesHubSansEsport(connus, [luca], false)).toEqual([]);
    expect(comptesHubSansEsport(connus, undefined, true)).toEqual([]);
  });

  it('Fondateur : LUCA apparaît « Jamais connecté · Sans team », compteur et filtre « Sans team », puis ajout à une team (pré-enregistrement)', async () => {
    const { ctx } = contexteFondateur([fondateur, luca, sansEsport]);
    let comptes = [compte('principal', 'Enzo', { moi: true, appartenances: [{ teamId: 't1', membreId: 'm0', role: { id: 'r-prop', nom: 'Propriétaire', couleur: '#d64545', cle: 'proprietaire' }, posteJeu: null, statut: 'actif', rejointLe: '', gerable: false }] })];
    const ajouterATeams = jest.fn(async (id: string, c: { pseudo?: string; affectations: Array<{ teamId: string; roleId: string }> }) => {
      const fiche = compte(id, c.pseudo ?? '?', { statut: 'invite', appartenances: [{ teamId: 't1', membreId: 'm9', role: { id: 'r-jou', nom: 'Joueur', couleur: '#16a34a', cle: 'joueur' }, posteJeu: null, statut: 'actif', rejointLe: '', gerable: true }] });
      comptes = [...comptes, fiche];
      return fiche;
    });
    fabrique.client = () => fauxClient({ ouvrir: moi(true), annuaire: async () => annuaire(true, comptes), ajouterATeams });
    await monter(ctx);
    await fireEvent.press(await screen.findByTestId('esport-nav-membres'));
    await screen.findByTestId('esport-compte-luca000001');
    expect(screen.queryByTestId('esport-compte-zoe0000001')).toBeNull();
    expect(screen.getByText('2 comptes, dont 1 sans team · 2 teams')).toBeTruthy();
    expect(screen.getByTestId('esport-compte-statut-luca000001')).toHaveTextContent('Jamais connecté');
    expect(screen.getByTestId('esport-compte-sans-team-luca000001')).toHaveTextContent('Sans team');
    // Filtre « Sans team » : LUCA seulement.
    await fireEvent.press(screen.getByTestId('esport-membres-statut-sansteam'));
    expect(screen.queryByTestId('esport-compte-principal')).toBeNull();
    expect(screen.getByTestId('esport-compte-luca000001')).toBeTruthy();
    // Ajouter à une team : pré-enregistrement (compte du relais + pseudo + team et rôle), pas un ajout de compte existant.
    await fireEvent.press(screen.getByLabelText('Gérer LUCA'));
    await fireEvent.press(screen.getByTestId('esport-ajout-team-luca000001-faucons'));
    await fireEvent.press(screen.getByTestId('esport-ajout-role-luca000001-faucons-r-jou'));
    // Pseudo du hub réutilisé : aucun champ à saisir.
    expect(screen.queryByTestId('esport-ajout-pseudo-luca000001')).toBeNull();
    await fireEvent.press(screen.getByTestId('esport-ajout-valider-luca000001'));
    await waitFor(() => expect(ajouterATeams).toHaveBeenCalledWith('luca000001', { pseudo: 'LUCA', affectations: [{ teamId: 't1', roleId: 'r-jou' }] }));
    expect(await screen.findByText('LUCA est ajouté à Faucons : il verra ses teams à sa prochaine ouverture de l’Esport.')).toBeTruthy();
    // Rechargé : LUCA a une fiche (invité) et une team ; plus « sans team ».
    await fireEvent.press(screen.getByTestId('esport-membres-statut-tous'));
    await waitFor(() => expect(screen.getByTestId('esport-compte-statut-luca000001')).toHaveTextContent('Invité'));
    expect(screen.queryByTestId('esport-compte-sans-team-luca000001')).toBeNull();
  });

  it('Manager (sans annuaire du hub) : rien de plus que l’annuaire du serveur', async () => {
    const { ctx } = contexteFondateur([fondateur, luca]);
    fabrique.client = () => fauxClient({ ouvrir: moi(false), annuaire: async () => annuaire(false, [compte('max12345', 'Max', { moi: true })]) });
    await monter({ ...ctx, profil: { ...fondateur, admin: false } });
    await fireEvent.press(await screen.findByTestId('esport-nav-membres'));
    await screen.findByTestId('esport-compte-max12345');
    expect(screen.queryByTestId('esport-compte-luca000001')).toBeNull();
  });
});

describe('Esport › Membres : ajouter un compte à plusieurs teams', () => {
  const luca: Profil = { id: 'luca000001', nom: 'LUCA', admin: false, creeLe: '2026-09-01', apps: ['esport'], actif: true };
  const rang = (teamId: string, membreId: string) => ({ teamId, membreId, role: { id: 'r-jou', nom: 'Joueur', couleur: '#16a34a', cle: 'joueur' }, posteJeu: null, statut: 'actif' as const, rejointLe: '', gerable: true });

  it('Fondateur : LUCA (jamais connecté) ajouté à DEUX teams en une fois, un rôle par team, sans ressaisir le pseudo', async () => {
    const { ctx } = contexteFondateur([fondateur, luca]);
    const ajouterATeams = jest.fn(async (id: string) => compte(id, 'LUCA', { statut: 'invite' }));
    fabrique.client = () => fauxClient({ ouvrir: moi(true), annuaire: async () => annuaire(true, []), ajouterATeams });
    await monter(ctx);
    await fireEvent.press(await screen.findByTestId('esport-nav-membres'));
    // Action disponible dès la ligne repliée.
    await fireEvent.press(await screen.findByTestId('esport-compte-ajouter-luca000001'));
    await fireEvent.press(screen.getByTestId('esport-ajout-team-luca000001-faucons'));
    await fireEvent.press(screen.getByTestId('esport-ajout-team-luca000001-aigles'));
    await fireEvent.press(screen.getByTestId('esport-ajout-role-luca000001-aigles-r-man-2'));
    await fireEvent.changeText(screen.getByTestId('esport-ajout-poste-luca000001-faucons'), 'Sentinelle');
    expect(screen.getByTestId('esport-ajout-valider-luca000001')).toHaveTextContent('Ajouter à 2 teams');
    await fireEvent.press(screen.getByTestId('esport-ajout-valider-luca000001'));
    await waitFor(() =>
      expect(ajouterATeams).toHaveBeenCalledWith('luca000001', {
        pseudo: 'LUCA',
        affectations: [
          { teamId: 't1', roleId: 'r-jou', posteJeu: 'Sentinelle' },
          { teamId: 't2', roleId: 'r-man-2' },
        ],
      }),
    );
    expect(await screen.findByTestId('esport-ajout-luca000001-avis')).toHaveTextContent(/LUCA est ajouté à Faucons et Aigles/);
  });

  it('compte déjà dans une team : l’action reste disponible, la team actuelle est grisée « déjà membre », les autres se cochent', async () => {
    const { ctx } = contexteFondateur([fondateur]);
    const ana = compte('ana0000001', 'Ana', { appartenances: [rang('t1', 'm-ana')] });
    const ajouterATeams = jest.fn(async () => ana);
    fabrique.client = () => fauxClient({ ouvrir: moi(true), annuaire: async () => annuaire(true, [ana]), ajouterATeams });
    await monter(ctx);
    await fireEvent.press(await screen.findByTestId('esport-nav-membres'));
    await fireEvent.press(await screen.findByTestId('esport-compte-ajouter-ana0000001'));
    expect(screen.getByTestId('esport-ajout-deja-ana0000001-faucons')).toHaveTextContent('déjà membre');
    expect(screen.queryByTestId('esport-ajout-team-ana0000001-faucons')).toBeNull();
    await fireEvent.press(screen.getByTestId('esport-ajout-team-ana0000001-aigles'));
    await fireEvent.press(screen.getByTestId('esport-ajout-valider-ana0000001'));
    await waitFor(() => expect(ajouterATeams).toHaveBeenCalledWith('ana0000001', { affectations: [{ teamId: 't2', roleId: 'r-jou-2' }] }));
  });

  it('compte déjà dans toutes les teams : message clair, aucun bouton inutile', async () => {
    const { ctx } = contexteFondateur([fondateur]);
    const ana = compte('ana0000001', 'Ana', { appartenances: [rang('t1', 'm1'), rang('t2', 'm2')] });
    fabrique.client = () => fauxClient({ ouvrir: moi(true), annuaire: async () => annuaire(true, [ana]) });
    await monter(ctx);
    await fireEvent.press(await screen.findByTestId('esport-nav-membres'));
    await fireEvent.press(await screen.findByLabelText('Gérer Ana'));
    expect(screen.getByTestId('esport-ajout-toutes-ana0000001')).toHaveTextContent(/déjà membre de toutes vos teams/);
    expect(screen.queryByTestId('esport-ajout-valider-ana0000001')).toBeNull();
  });

  it('erreur du serveur affichée sous le bouton (jamais d’échec silencieux) ; pseudo déjà pris → champ pour en choisir un autre', async () => {
    const { ctx } = contexteFondateur([fondateur, luca]);
    const ajouterATeams = jest
      .fn()
      .mockRejectedValueOnce(new ErreurEsport('Ce pseudo est déjà pris dans l’Esport.', 409, 'pseudo-pris'))
      .mockResolvedValueOnce(compte('luca000001', 'LUCA2', { statut: 'invite' }));
    fabrique.client = () => fauxClient({ ouvrir: moi(true), annuaire: async () => annuaire(true, []), ajouterATeams });
    await monter(ctx);
    await fireEvent.press(await screen.findByTestId('esport-nav-membres'));
    await fireEvent.press(await screen.findByTestId('esport-compte-ajouter-luca000001'));
    await fireEvent.press(screen.getByTestId('esport-ajout-team-luca000001-faucons'));
    await fireEvent.press(screen.getByTestId('esport-ajout-valider-luca000001'));
    expect(await screen.findByTestId('esport-ajout-luca000001-erreur')).toHaveTextContent('Ce pseudo est déjà pris dans l’Esport.');
    await fireEvent.changeText(await screen.findByTestId('esport-ajout-pseudo-luca000001'), 'LUCA2');
    await fireEvent.press(screen.getByTestId('esport-ajout-valider-luca000001'));
    await waitFor(() => expect(ajouterATeams).toHaveBeenLastCalledWith('luca000001', { pseudo: 'LUCA2', affectations: [{ teamId: 't1', roleId: 'r-jou' }] }));
  });

  it('doublon (compte déjà membre côté serveur) : erreur nette affichée', async () => {
    const { ctx } = contexteFondateur([fondateur, luca]);
    const ajouterATeams = jest.fn().mockRejectedValue(new ErreurEsport('LUCA est déjà membre de Faucons.', 409, 'deja-membre'));
    fabrique.client = () => fauxClient({ ouvrir: moi(true), annuaire: async () => annuaire(true, []), ajouterATeams });
    await monter(ctx);
    await fireEvent.press(await screen.findByTestId('esport-nav-membres'));
    await fireEvent.press(await screen.findByTestId('esport-compte-ajouter-luca000001'));
    await fireEvent.press(screen.getByTestId('esport-ajout-team-luca000001-faucons'));
    await fireEvent.press(screen.getByTestId('esport-ajout-valider-luca000001'));
    expect(await screen.findByTestId('esport-ajout-luca000001-erreur')).toHaveTextContent('LUCA est déjà membre de Faucons.');
  });
});

describe('Aides pures', () => {
  it('filtres de la page Membres : recherche, team, rôle, statut', () => {
    const a = (teamId: string, role: string, statut: 'actif' | 'suspendu' = 'actif') => ({ teamId, membreId: `${teamId}-${role}`, role: { id: role, nom: role, couleur: '#000000', cle: null }, posteJeu: null, statut, rejointLe: '', gerable: true });
    const comptes = [
      compte('a', 'Léa', { riotId: 'Lea#EUW', appartenances: [a('t1', 'Joueur')] }),
      compte('b', 'Max', { appartenances: [a('t1', 'Manager'), a('t2', 'Joueur')] }),
      compte('c', 'Zoé', { statut: 'invite', appartenances: [a('t2', 'Joueur')] }),
      compte('d', 'Kai', { appartenances: [a('t2', 'Joueur', 'suspendu')] }),
    ];
    const f = (x: Partial<Parameters<typeof filtrerComptes>[1]>) => filtrerComptes(comptes, { recherche: '', team: 'toutes', role: 'tous', statut: 'tous', ...x }).map(c => c.pseudo);
    expect(f({ recherche: 'euw' })).toEqual(['Léa']);
    expect(f({ team: 't1' })).toEqual(['Léa', 'Max']);
    expect(f({ team: 't1', role: 'Joueur' })).toEqual(['Léa']);
    expect(f({ statut: 'invite' })).toEqual(['Zoé']);
    expect(f({ statut: 'suspendu' })).toEqual(['Kai']);
    expect(f({ statut: 'actif' })).toEqual(['Léa', 'Max']);
    // « Sans team » : comptes sans aucune appartenance (dont ceux du hub sans fiche Esport).
    expect(filtrerComptes([...comptes, compte('e', 'Luca', { horsEsport: true, statut: 'invite' })], { recherche: '', team: 'toutes', role: 'tous', statut: 'sansteam' }).map(c => c.pseudo)).toEqual(['Luca']);
  });

  it('message Esport : variables du modèle, noms de teams en texte (sans accolades)', () => {
    const m = modeleInvitationEsport(['Faucons', 'Team {lien}']);
    expect(m.corps).toMatch(/dans les teams Faucons et Team lien/);
    expect(m.corps).toContain('{lien}');
    expect(m.objet).not.toContain('{lien}');
  });
});

describe('Esport › Membres : demandes de compte (« Créer des membres »)', () => {
  const DEMANDE = {
    id: 'd1',
    teamId: 't1',
    team: 'Faucons',
    teamSlug: 'faucons',
    role: { id: 'r-jou', nom: 'Joueur', couleur: '#16a34a', cle: 'joueur' },
    demandeur: 'lea12345',
    demandeurPseudo: 'Léa',
    pseudo: 'Noa',
    email: 'noa@exemple.fr',
    posteJeu: 'Sentinelle',
    message: 'Ma cousine',
    statut: 'en_attente' as const,
    compte: null,
    motif: '',
    creeLe: '2026-10-20T09:00:00Z',
    traiteLe: null,
  };

  it('Fondateur : badge « Demandes en attente », validation en un clic (création préremplie, demande close avec le pré-enregistrement)', async () => {
    const { ctx, appels } = contexteFondateur([fondateur]);
    const verifierPreinscription = jest.fn(async () => {
      appels.push('verification');
    });
    const preinscrire = jest.fn(async (c: { compte: string; pseudo: string }) => {
      appels.push('esport');
      return compte(c.compte, c.pseudo, { statut: 'invite' });
    });
    fabrique.client = () =>
      fauxClient({
        ouvrir: moi(true),
        annuaire: async () => ({ ...annuaire(true), demandesEnAttente: 1 }),
        demandes: async () => ({ demandes: [DEMANDE], enAttente: 1, fondateur: true }),
        verifierPreinscription,
        preinscrire,
      });
    await monter(ctx);
    await fireEvent.press(await screen.findByTestId('esport-nav-membres'));
    expect(await screen.findByTestId('esport-membres-badge-demandes')).toHaveTextContent('Demandes en attente : 1');
    expect(await screen.findByTestId('esport-demande-d1')).toHaveTextContent(/Proposé par Léa/);
    await fireEvent.press(screen.getByTestId('esport-demande-valider-d1'));
    // Saisie préremplie : nom, adresse, team et rôle de la demande.
    expect(screen.getByTestId('esport-compte-nom').props.value).toBe('Noa');
    expect(screen.getByTestId('esport-compte-email').props.value).toBe('noa@exemple.fr');
    await fireEvent.press(screen.getByTestId('esport-compte-creer'));
    await confirmerIdentite();
    await screen.findByTestId('esport-compte-cree');
    expect(appels).toEqual(['verification', 'hub', 'esport']);
    const affectations = [{ teamId: 't1', roleId: 'r-jou', posteJeu: 'Sentinelle' }];
    expect(verifierPreinscription).toHaveBeenCalledWith({ pseudo: 'Noa', affectations, demandeId: 'd1' });
    expect(preinscrire).toHaveBeenCalledWith({ compte: 'lea0000001', pseudo: 'Noa', affectations, demandeId: 'd1' });
  });

  it('Joueur autorisé : demande au Fondateur (nom, e-mail, team, rôle), statut suivi ; ajout d’un compte Esport existant par pseudo', async () => {
    const avecDroit: Annuaire = { ...annuaire(false), teams: annuaire(false).teams.map(t => ({ ...t, droits: { ajouter: false, demander: t.id === 't1', roles: false, retirer: false } })) };
    let demandes: (typeof DEMANDE)[] = [];
    const demanderCompte = jest.fn(async (d: { pseudo: string }) => {
      demandes = [{ ...DEMANDE, pseudo: d.pseudo }];
      return demandes[0];
    });
    const ajouterMembre = jest.fn(async () => null);
    fabrique.client = () => fauxClient({ ouvrir: moi(false), annuaire: async () => avecDroit, demandes: async () => ({ demandes, enAttente: demandes.length, fondateur: false }), demanderCompte, ajouterMembre });
    await monter({ profil: { id: 'lea12345', nom: 'Léa', admin: false, creeLe: '', apps: ['esport'] } });
    await fireEvent.press(await screen.findByTestId('esport-nav-membres'));
    await screen.findByTestId('esport-proposer');
    await fireEvent.changeText(screen.getByTestId('esport-proposer-pseudo'), 'Noa');
    await fireEvent.changeText(screen.getByTestId('esport-proposer-email'), 'noa@exemple.fr');
    await act(async () => {
      fireEvent.press(screen.getByTestId('esport-proposer-envoyer'));
      await new Promise<void>(r => setTimeout(r, 20));
    });
    expect(demanderCompte).toHaveBeenCalledWith({ teamId: 't1', roleId: 'r-jou', pseudo: 'Noa', email: 'noa@exemple.fr' });
    expect(await screen.findByTestId('esport-ma-demande-statut-d1')).toHaveTextContent('En attente');
    // Compte qui a déjà l'Esport : ajouté tout de suite, sans le Fondateur.
    await fireEvent.press(screen.getByTestId('esport-proposer-mode-existant'));
    await fireEvent.changeText(screen.getByTestId('esport-proposer-pseudo'), 'Bob');
    await act(async () => {
      fireEvent.press(screen.getByTestId('esport-proposer-envoyer'));
      await new Promise<void>(r => setTimeout(r, 20));
    });
    expect(ajouterMembre).toHaveBeenCalledWith('t1', { pseudo: 'Bob', roleId: 'r-jou' });
  });
});
