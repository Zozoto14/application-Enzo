/**
 * Administration sur téléphone : accueil en liste de sections, listes de cartes à la place des
 * tableaux, formulaires en feuilles basses, confirmations fortes, règles de rang inchangées,
 * et bureau strictement inchangé (onglets, panneaux).
 */

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Administration } from '../../../Administration';
import { REGISTRE } from '../../../registre';
import { themeHub } from '../../../themes';
import type { ContexteHub } from '../../../types';
import type { ControleProfils } from '../../../../ui/ecrans/CarteProfils';
import type { Profil } from '../../../../profils/profils';
import { forcerModeAffichage } from '../../../../ui/mobile';
import { dateDuJour } from '../../../abonnements/abonnements';

const theme = themeHub('nuit');
const MAINTENANT = Date.parse('2026-06-15T10:00:00Z');

const fondateur: Profil = { id: 'principal', nom: 'Moi', admin: true, creeLe: '' };
const lea: Profil = { id: 'lea1234', nom: 'Léa', admin: false, creeLe: '2026-01-01', apps: ['portefeuille'], derniereConnexion: '2026-06-10T10:00:00Z', connexions: 4, sequestre: 'actif' };
const hugo: Profil = { id: 'hugo123', nom: 'Hugo', admin: false, creeLe: '2026-02-01', apps: ['portefeuille', 'tsuzuku'], invitationExpireLe: '2026-07-01T00:00:00Z', sequestre: 'actif' };
const marie: Profil = { id: 'marie12', nom: 'Marie', admin: false, creeLe: '2026-03-01', apps: [], actif: false, derniereConnexion: '2026-05-01T10:00:00Z' };

async function monter(options: { acteur?: Profil; tous?: Profil[]; controle?: Partial<ControleProfils>; enregistrer?: jest.Mock } = {}) {
  const stock = new Map<string, string>();
  const acteur = options.acteur ?? fondateur;
  const tous = options.tous ?? [acteur, lea, hugo, marie];
  const controle = {
    actuel: acteur,
    tous,
    onChanger: jest.fn(),
    onAjouter: jest.fn(),
    onSupprimer: jest.fn(async () => undefined),
    onRenommer: jest.fn(),
    onCreerCompte: jest.fn(async () => ({ motDePasse: 'mdp-genere-1234', secretTotp: 'JBSWY3DPEHPK3PXP', uriTotp: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP', codesRecuperation: ['AAAA-1111', 'BBBB-2222'] })),
    onModifierProfils: jest.fn(async () => undefined),
    onChangerRang: jest.fn(async () => ({ enAttente: false })),
    onRegenerer: jest.fn(),
    ...options.controle,
  } as unknown as ControleProfils;
  const verifierIdentite = jest.fn();
  const contexte: ContexteHub = {
    profil: acteur,
    profils: controle,
    maintenant: MAINTENANT,
    admin: {
      stockage: { lire: c => stock.get(c), ecrire: (c, v) => void stock.set(c, v) },
      verifierIdentite,
      etatCoffre: () => ({ totpActif: true, codesRecuperation: 8 }),
      enregistrerFichier: options.enregistrer ?? jest.fn(async () => true),
    },
  };
  const onRetour = jest.fn();
  const onParametres = jest.fn();
  const rendu = await render(<Administration contexte={contexte} theme={theme} registre={REGISTRE} onRetour={onRetour} onParametres={onParametres} />);
  return { controle, verifierIdentite, onRetour, onParametres, rendu };
}

describe('Administration : téléphone', () => {
  beforeEach(() => forcerModeAffichage('telephone'));
  afterEach(() => forcerModeAffichage('large'));

  it('accueil : une liste de sections (cellules), pas de barre d’onglets, rang et retour au hub', async () => {
    const { onRetour } = await monter();
    expect(await screen.findByTestId('admin-accueil')).toBeTruthy();
    for (const id of ['tableau', 'utilisateurs', 'applications', 'abonnements', 'securite', 'journal', 'reglages']) {
      expect(screen.getByTestId(`admin-onglet-${id}`)).toBeTruthy();
    }
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByTestId('admin-mon-rang')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('retour-hub'));
    expect(onRetour).toHaveBeenCalled();
  });

  it('un gestionnaire n’a que trois sections ; un administrateur n’a ni apps globales ni abonnements', async () => {
    await monter({ acteur: { ...lea, id: 'gest123', nom: 'Gaëlle', role: 'gestionnaire' }, tous: [], controle: { gestion: { comptes: [], apercu: [], autres: 2 } } });
    expect(await screen.findByTestId('admin-onglet-utilisateurs')).toBeTruthy();
    expect(screen.queryByTestId('admin-onglet-securite')).toBeNull();
    expect(screen.queryByTestId('admin-onglet-applications')).toBeNull();
    expect(screen.queryByTestId('admin-onglet-reglages')).toBeNull();
    expect(screen.getByTestId('admin-bandeau-gestionnaire')).toBeTruthy();
  });

  it('utilisateurs : des cartes (nom, rang, statut, connexion), pas de tableau ; recherche, filtres en feuille', async () => {
    await monter();
    await fireEvent.press(await screen.findByTestId('admin-onglet-utilisateurs'));
    expect(await screen.findByTestId('admin-liste')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByTestId('admin-ligne-lea1234')).toBeTruthy();
    expect(screen.getByTestId('admin-statut-lea1234')).toBeTruthy();
    expect(screen.getByTestId('admin-statut-marie12').props.children).toBe('Désactivé');
    await fireEvent.changeText(screen.getByTestId('admin-recherche'), 'hug');
    expect(screen.queryByTestId('admin-ligne-lea1234')).toBeNull();
    expect(screen.getByTestId('admin-ligne-hugo123')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('admin-recherche'), '');
    // Filtre par statut dans la feuille basse.
    await fireEvent.press(screen.getByTestId('admin-filtres-ouvrir'));
    await fireEvent.press(await screen.findByTestId('admin-filtres-statut'));
    await fireEvent.press(await screen.findByTestId('admin-filtres-statut-desactive'));
    await fireEvent.press(screen.getByTestId('admin-filtres-appliquer'));
    expect(screen.getByTestId('admin-ligne-marie12')).toBeTruthy();
    expect(screen.queryByTestId('admin-ligne-lea1234')).toBeNull();
  });

  it('fiche : sous-page « ‹ Utilisateurs », groupes de cellules, niveau d’une app dans une feuille', async () => {
    const { controle } = await monter();
    await fireEvent.press(await screen.findByTestId('admin-onglet-utilisateurs'));
    await fireEvent.press(await screen.findByTestId('admin-ligne-lea1234'));
    expect(await screen.findByTestId('admin-detail')).toBeTruthy();
    expect(screen.getByTestId('admin-fiche-statut')).toBeTruthy();
    expect(screen.getByTestId('admin-rang-changer')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('admin-niveau-lea1234-portefeuille'));
    await fireEvent.press(await screen.findByTestId('admin-niveau-lea1234-portefeuille-feuille-aucun'));
    await waitFor(() => expect(controle.onModifierProfils).toHaveBeenCalled());
    await fireEvent.press(screen.getByTestId('admin-retour'));
    expect(await screen.findByTestId('admin-liste')).toBeTruthy();
  });

  it('promouvoir : feuille de rang, texte de ce que le rang permet, vérification d’identité puis changement', async () => {
    const { controle, verifierIdentite } = await monter();
    await fireEvent.press(await screen.findByTestId('admin-onglet-utilisateurs'));
    await fireEvent.press(await screen.findByTestId('admin-ligne-lea1234'));
    await fireEvent.press(await screen.findByTestId('admin-rang-changer'));
    await fireEvent.press(await screen.findByTestId('admin-rang-choix-administrateur'));
    expect(screen.getByText(/Promouvoir Léa : Ami → Administrateur/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('admin-rang-confirmer'));
    // Identité exigée dans une feuille basse (mot de passe + code à 6 chiffres).
    await fireEvent.changeText(await screen.findByTestId('admin-identite-mdp'), 'mot-de-passe');
    await fireEvent.changeText(screen.getByTestId('admin-identite-code'), '123456');
    await fireEvent.press(screen.getByTestId('admin-identite-valider'));
    expect(await screen.findByTestId('admin-avis')).toBeTruthy();
    expect(verifierIdentite).toHaveBeenCalledWith('mot-de-passe', '123456');
    expect(controle.onChangerRang).toHaveBeenCalledWith('lea1234', 'administrateur');
  });

  it('promouvoir Fondateur exige de saisir le prénom ; les rangs restent ceux du bureau', async () => {
    await monter();
    await fireEvent.press(await screen.findByTestId('admin-onglet-utilisateurs'));
    await fireEvent.press(await screen.findByTestId('admin-ligne-lea1234'));
    await fireEvent.press(await screen.findByTestId('admin-rang-changer'));
    await fireEvent.press(await screen.findByTestId('admin-rang-choix-fondateur'));
    expect(screen.getByTestId('admin-rang-confirmer').props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByTestId('admin-rang-saisie'), 'Léa');
    expect(screen.getByTestId('admin-rang-confirmer').props.accessibilityState.disabled).toBe(false);
  });

  it('un administrateur ne voit pas les fondateurs et n’agit pas sur un pair (fiche en lecture seule)', async () => {
    const admin: Profil = { id: 'adm1234', nom: 'Hugo2', admin: false, creeLe: '2026-02-01', role: 'administrateur', titulaire: 'actif' };
    const pair: Profil = { id: 'pair123', nom: 'Paul', admin: false, creeLe: '2026-02-01', role: 'administrateur', titulaire: 'actif' };
    await monter({ acteur: admin, tous: [admin, pair, lea] });
    await fireEvent.press(await screen.findByTestId('admin-onglet-utilisateurs'));
    expect(screen.queryByTestId('admin-onglet-applications')).toBeNull();
    expect(screen.queryByTestId('admin-onglet-abonnements')).toBeNull();
    await fireEvent.press(await screen.findByTestId('admin-ligne-pair123'));
    expect(await screen.findByTestId('admin-fiche-lecture-seule')).toBeTruthy();
    expect(screen.queryByTestId('admin-rang-changer')).toBeNull();
    expect(screen.queryByTestId('admin-supprimer')).toBeNull();
  });

  it('suppression : feuille de confirmation forte, impossible sans saisir le prénom', async () => {
    const { controle } = await monter();
    await fireEvent.press(await screen.findByTestId('admin-onglet-utilisateurs'));
    await fireEvent.press(await screen.findByTestId('admin-ligne-lea1234'));
    await fireEvent.press(await screen.findByTestId('admin-supprimer'));
    const bouton = await screen.findByTestId('admin-confirmer');
    expect(bouton.props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByTestId('admin-confirmation-nom'), 'Lea');
    expect(screen.getByTestId('admin-confirmer').props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByTestId('admin-confirmation-nom'), 'Léa');
    expect(screen.getByTestId('admin-confirmer').props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(screen.getByTestId('admin-confirmer'));
    await fireEvent.changeText(await screen.findByTestId('admin-identite-mdp'), 'mot-de-passe');
    await fireEvent.changeText(screen.getByTestId('admin-identite-code'), '123456');
    await fireEvent.press(screen.getByTestId('admin-identite-valider'));
    await screen.findByTestId('admin-avis');
    expect(controle.onSupprimer).toHaveBeenCalledWith('lea1234');
  });

  it('création : bouton principal collé en bas, grisé tant que la transparence n’est pas confirmée ; identifiants à affichage unique', async () => {
    const { controle } = await monter();
    await fireEvent.press(await screen.findByTestId('admin-onglet-utilisateurs'));
    await fireEvent.press(await screen.findByTestId('admin-nouveau'));
    expect(await screen.findByTestId('admin-creation')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('admin-nom'), 'Lucas');
    expect(screen.getByTestId('admin-creer').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId('admin-nouveau-informe'));
    expect(screen.getByTestId('admin-creer').props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(screen.getByTestId('admin-creer'));
    expect(await screen.findByTestId('admin-identifiants')).toBeTruthy();
    expect(controle.onCreerCompte).toHaveBeenCalled();
    expect(screen.getByTestId('admin-mot-de-passe').props.children).toBe('mdp-genere-1234');
    expect(screen.getByTestId('admin-secret-totp').props.children).toBe('JBSWY3DPEHPK3PXP');
    expect(screen.getByTestId('admin-termine').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId('admin-transmis'));
    expect(screen.getByTestId('admin-termine').props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(screen.getByTestId('admin-termine'));
    expect(await screen.findByTestId('admin-liste')).toBeTruthy();
  });

  it('sélection : actions groupées en feuille, désactivation confirmée', async () => {
    const { controle } = await monter();
    await fireEvent.press(await screen.findByTestId('admin-onglet-utilisateurs'));
    await fireEvent.press(await screen.findByTestId('admin-selectionner'));
    await fireEvent.press(screen.getByTestId('admin-case-lea1234'));
    await fireEvent.press(screen.getByTestId('admin-groupe-ouvrir'));
    await fireEvent.press(await screen.findByTestId('admin-groupe-desactiver'));
    await fireEvent.press(await screen.findByTestId('admin-groupe-desactiver-confirmer'));
    await waitFor(() => expect(controle.onModifierProfils).toHaveBeenCalled());
  });

  it('applications : interrupteurs larges (rôle switch) pour activer et mettre en maintenance', async () => {
    const { controle } = await monter();
    await fireEvent.press(await screen.findByTestId('admin-onglet-applications'));
    const interrupteur = await screen.findByTestId('admin-app-active-tsuzuku');
    expect(interrupteur.props.accessibilityRole).toBe('switch');
    await fireEvent.press(interrupteur);
    await waitFor(() => expect(controle.onModifierProfils).toHaveBeenCalled());
    expect(screen.getByTestId('admin-app-maintenance-tsuzuku').props.accessibilityRole).toBe('switch');
  });

  it('abonnements : cartes avec « Marquer payé » sous le pouce, formulaire en feuille, actions dans « Plus »', async () => {
    await monter();
    await fireEvent.press(await screen.findByTestId('admin-onglet-abonnements'));
    expect(await screen.findByTestId('admin-abo-lea1234')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    await fireEvent.press(screen.getByTestId('admin-abo-paye-lea1234'));
    expect(await screen.findByTestId('admin-abo-form-paiement-lea1234')).toBeTruthy();
    expect(screen.getByTestId('admin-abo-form-montant')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('admin-abo-form-valider'));
    expect(await screen.findByTestId('admin-abo-info')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('admin-abo-plus-lea1234'));
    expect(await screen.findByTestId('admin-abo-historique-lea1234')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('admin-abo-historique-lea1234'));
    expect(await screen.findByTestId('admin-abo-historique-liste-lea1234')).toBeTruthy();
    expect(dateDuJour(MAINTENANT)).toBe('2026-06-15');
  });

  it('journal : cartes, recherche, filtres en feuille, export JSON/CSV dans une feuille', async () => {
    const enregistrer = jest.fn(async () => true);
    await monter({ enregistrer });
    await fireEvent.press(await screen.findByTestId('admin-onglet-journal'));
    expect(await screen.findByTestId('admin-journal-liste')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('admin-journal-recherche'), 'zzzz-introuvable');
    expect(screen.getByText('Aucun événement ne correspond.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('admin-journal-recherche'), '');
    await fireEvent.press(screen.getByTestId('admin-journal-filtres'));
    expect(await screen.findByTestId('admin-filtres-type')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('admin-filtres-fermer'));
    await fireEvent.press(screen.getByTestId('admin-journal-exporter'));
    await fireEvent.press(await screen.findByTestId('admin-journal-export-csv'));
    await screen.findByTestId('admin-journal-message');
    expect(enregistrer).toHaveBeenCalled();
    expect(enregistrer.mock.calls[0][0]).toMatch(/^journal-administration-.*\.csv$/);
  });

  it('sécurité et réglages : points en cellules, verrouillage en bouton principal, renvoi vers les Paramètres', async () => {
    const { onParametres } = await monter();
    await fireEvent.press(await screen.findByTestId('admin-onglet-securite'));
    expect(await screen.findByTestId('admin-verrouiller-panneau')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('admin-retour'));
    await fireEvent.press(await screen.findByTestId('admin-onglet-reglages'));
    await fireEvent.press(await screen.findByTestId('admin-ouvrir-parametres'));
    expect(onParametres).toHaveBeenCalledWith('administration');
  });

  it('tableau de bord : tuiles de chiffres et alertes en cellules', async () => {
    await monter();
    await fireEvent.press(await screen.findByTestId('admin-onglet-tableau'));
    expect(await screen.findByTestId('admin-stat-total')).toBeTruthy();
    expect(within(screen.getByTestId('admin-stat-total')).getByText('4')).toBeTruthy();
    expect(screen.getByTestId('admin-alertes')).toBeTruthy();
  });

  it('verrouillage manuel : le panneau demande mot de passe et code, dans un écran de téléphone', async () => {
    await monter();
    await fireEvent.press(await screen.findByTestId('admin-onglet-securite'));
    await fireEvent.press(await screen.findByTestId('admin-verrouiller-panneau'));
    expect(await screen.findByTestId('admin-verrouille')).toBeTruthy();
    expect(screen.getByTestId('admin-identite-code')).toBeTruthy();
  });
});

describe('Administration : bureau inchangé', () => {
  it('barre d’onglets (rôle tab), panneaux et tableau-liste comme avant', async () => {
    await monter();
    expect(await screen.findByTestId('app-administration')).toBeTruthy();
    expect(screen.queryByTestId('admin-accueil')).toBeNull();
    expect(screen.getAllByRole('tab').length).toBe(7);
    expect(screen.getByTestId('admin-section-tableau')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('admin-onglet-utilisateurs'));
    expect(await screen.findByTestId('admin-liste')).toBeTruthy();
    expect(screen.getByTestId('admin-tout-selectionner')).toBeTruthy();
    expect(screen.getByTestId('admin-filtre-statut-actif')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('admin-ligne-lea1234'));
    expect(await screen.findByTestId('admin-detail')).toBeTruthy();
    expect(screen.getByTestId('admin-niveau-lea1234-portefeuille-aucun')).toBeTruthy();
  });
});
