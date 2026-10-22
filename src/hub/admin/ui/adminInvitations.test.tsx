/**
 * Administration (écran) : création d'un compte avec adresse e-mail → bouton
 * « Envoyer l'invitation par e-mail » (mailto pré-rempli), partage, historique ;
 * matrice comptes × apps ; action groupée « fermer une app » ; réglages
 * réservés (un Administrateur les lit, un Gestionnaire ne les voit pas).
 */

import React from 'react';
import { Linking, Share } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ID_PRINCIPAL, type Profil } from '../../../profils/profils';
import type { IdentifiantsAmi } from '../../../profils/identifiants';
import { Administration } from '../../Administration';
import { REGISTRE } from '../../registre';
import { themeHub } from '../../themes';
import type { ContexteHub, ServicesAdmin } from '../../types';
import type { ControleProfils } from '../../../ui/ecrans/CarteProfils';
import { chargerDonnees } from '../donnees';

const theme = themeHub('nuit');
const fondateur: Profil = { id: ID_PRINCIPAL, nom: 'Enzo', admin: true, creeLe: '' };
const hugo: Profil = { id: 'hugo000002', nom: 'Hugo', admin: false, creeLe: '2026-10-01', apps: ['portefeuille'], actif: true };
const zoe: Profil = { id: 'zoe0000003', nom: 'Zoé', admin: false, creeLe: '2026-10-01', apps: ['portefeuille'], actif: true, creePar: 'gest000001' };
const gest: Profil = { id: 'gest000001', nom: 'Léa', admin: false, creeLe: '', apps: [], actif: true, role: 'gestionnaire' };
const iris: Profil = { id: 'iris000005', nom: 'Iris', admin: false, creeLe: '', apps: [], actif: true, role: 'administrateur' };

const LIEN = 'https://site.exemple.fr/#invitation=AI1.secret-du-lien';

function contexte(actuel: Profil, tous: Profil[], options: Partial<ControleProfils> = {}) {
  const valeurs = new Map<string, string>();
  const stockage: ServicesAdmin['stockage'] = { lire: cle => valeurs.get(cle), ecrire: (cle, valeur) => void valeurs.set(cle, valeur) };
  const modifications: Profil[][] = [];
  const creations: unknown[][] = [];
  let liste = tous;
  const profils = {
    actuel,
    get tous() {
      return liste;
    },
    onChanger: () => undefined,
    onAjouter: async () => undefined,
    onSupprimer: async () => undefined,
    onRenommer: async () => undefined,
    onCreerCompte: async (...args: unknown[]): Promise<IdentifiantsAmi> => {
      creations.push(args);
      const nouveau: Profil = { id: 'lucas00009', nom: String(args[0]), admin: false, creeLe: '2026-10-15', apps: ['portefeuille'], actif: true };
      liste = [...liste, nouveau];
      return {
        id: 'lucas00009',
        motDePasse: 'abcde-FGHJK-23456-mnpqr',
        codesRecuperation: [],
        secretTotp: 'JBSWY3DPEHPK3PXP',
        uriTotp: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP',
        invitation: { lien: LIEN, expire: '2026-10-22T10:00:00Z', prenom: 'Lucas', fondateur: 'Enzo', site: 'https://site.exemple.fr', codeCourt: 'K7M2Q-9XH4T', longueur: 14, publie: true },
      };
    },
    onModifierProfils: async (suivants: readonly Profil[]) => {
      modifications.push([...suivants]);
      liste = [...suivants];
    },
    ...options,
  } as unknown as ControleProfils;
  const ctx: ContexteHub = { profil: actuel, profils, admin: { stockage, verifierIdentite: () => undefined, etatCoffre: () => undefined }, maintenant: Date.parse('2026-10-15T10:00:00Z') };
  return { ctx, modifications, creations, stockage };
}

const rendre = (ctx: ContexteHub) => render(<Administration contexte={ctx} theme={theme} registre={REGISTRE} onRetour={() => undefined} />);

describe('Administration : invitation par e-mail', () => {
  it('créer un compte avec une adresse : politique transmise, adresse chiffrée, bouton e-mail pré-rempli, historique', async () => {
    const ouvrir = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const partager = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction, activityType: undefined });
    const { ctx, creations, stockage } = contexte(fondateur, [fondateur, hugo]);
    await rendre(ctx);
    await fireEvent.press(screen.getByTestId('admin-onglet-utilisateurs'));
    await fireEvent.press(screen.getByTestId('admin-nouveau'));
    await fireEvent.changeText(screen.getByTestId('admin-nom'), 'Lucas');
    await fireEvent.changeText(screen.getByTestId('admin-nouveau-email'), 'lucas@exemple');
    expect(screen.getByTestId('admin-nouveau-email-erreur')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('admin-nouveau-email'), ' Lucas@Exemple.FR ');
    expect(screen.queryByTestId('admin-nouveau-email-erreur')).toBeNull();
    await fireEvent.press(screen.getByTestId('admin-nouveau-informe'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('admin-creer'));
      await new Promise<void>(r => setTimeout(r, 80));
    });
    expect(creations).toHaveLength(1);
    expect(creations[0][3]).toEqual({ politique: { longueurMin: 10, forceMin: 1 } });
    // L'adresse est rangée dans les données chiffrées de l'Administration (pas dans la liste des profils).
    expect(chargerDonnees(stockage).contacts.lucas00009.email).toBe('Lucas@exemple.fr');
    expect(JSON.stringify(ctx.profils!.tous)).not.toContain('exemple.fr');
    expect(screen.getByTestId('admin-invitation-destinataire')).toHaveTextContent(/Lucas@exemple\.fr/);
    expect(screen.getByTestId('admin-invitation-message')).toHaveTextContent(/14 caractères au moins/);

    await fireEvent.press(screen.getByTestId('admin-invitation-email'));
    expect(ouvrir).toHaveBeenCalledTimes(1);
    const url = ouvrir.mock.calls[0][0];
    expect(url.startsWith('mailto:Lucas@exemple.fr?subject=')).toBe(true);
    expect(decodeURIComponent(url.split('body=')[1])).toContain(LIEN);
    expect(decodeURIComponent(url.split('body=')[1])).not.toContain('abcde-FGHJK-23456-mnpqr');

    await act(async () => {
      fireEvent.press(screen.getByTestId('admin-invitation-partager'));
      await new Promise<void>(r => setTimeout(r, 10));
    });
    expect(partager).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining(LIEN) }));
    const envois = chargerDonnees(stockage).contacts.lucas00009.envois.map(e => e.canal);
    expect(envois).toEqual(['email', 'partage']);
    // Le journal dit « par e-mail », jamais l'adresse.
    const journal = JSON.stringify(chargerDonnees(stockage).journal);
    expect(journal).toMatch(/transmise \(e-mail\)/);
    expect(journal).not.toMatch(/exemple\.fr/);
    ouvrir.mockRestore();
    partager.mockRestore();
  });

  it('fiche : saisir l’adresse d’un compte existant, historique vide', async () => {
    const { ctx, stockage } = contexte(fondateur, [fondateur, hugo]);
    await rendre(ctx);
    await fireEvent.press(screen.getByTestId('admin-onglet-utilisateurs'));
    await fireEvent.press(screen.getByTestId('admin-ligne-hugo000002'));
    expect(screen.getByTestId('admin-historique-invitations')).toHaveTextContent(/Aucune invitation/);
    await fireEvent.changeText(screen.getByTestId('admin-fiche-email'), 'hugo@exemple.fr');
    await fireEvent.press(screen.getByTestId('admin-fiche-email-enregistrer'));
    expect(chargerDonnees(stockage).contacts.hugo000002.email).toBe('hugo@exemple.fr');
  });
});

describe('Administration : langue par défaut d’un compte', () => {
  it('création : Français par défaut, English au choix → fiche chiffrée, invitation proposée en anglais', async () => {
    const { ctx, stockage } = contexte(fondateur, [fondateur, hugo]);
    await rendre(ctx);
    await fireEvent.press(screen.getByTestId('admin-onglet-utilisateurs'));
    await fireEvent.press(screen.getByTestId('admin-nouveau'));
    expect(screen.getByTestId('admin-nouveau-langue-fr').props.accessibilityState?.checked ?? screen.getByTestId('admin-nouveau-langue-fr').props.accessibilityState?.selected).toBeTruthy();
    await fireEvent.press(screen.getByTestId('admin-nouveau-langue-en'));
    await fireEvent.changeText(screen.getByTestId('admin-nom'), 'Lucas');
    await fireEvent.changeText(screen.getByTestId('admin-nouveau-email'), 'lucas@exemple.com');
    await fireEvent.press(screen.getByTestId('admin-nouveau-informe'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('admin-creer'));
      await new Promise<void>(r => setTimeout(r, 80));
    });
    const donnees = chargerDonnees(stockage);
    expect(donnees.contacts.lucas00009.langue).toBe('en');
    expect(donnees.contacts.lucas00009.email).toBe('lucas@exemple.com');
    expect(JSON.stringify(ctx.profils!.tous)).not.toMatch(/"langue"/);
    expect(JSON.stringify(donnees.journal)).toMatch(/langue : English/);
    // Message d'invitation en anglais d'emblée (langue du compte).
    expect(screen.getByTestId('admin-invitation-message')).toHaveTextContent(/Open this link/);
  });

  it('fiche : régler la langue par défaut (journalisée), l’invitation suit', async () => {
    const { ctx, stockage } = contexte(fondateur, [fondateur, hugo]);
    await rendre(ctx);
    await fireEvent.press(screen.getByTestId('admin-onglet-utilisateurs'));
    await fireEvent.press(screen.getByTestId('admin-ligne-hugo000002'));
    expect(screen.getByTestId('admin-fiche-langue-enregistrer').props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId('admin-fiche-langue-en'));
    await fireEvent.press(screen.getByTestId('admin-fiche-langue-enregistrer'));
    expect(chargerDonnees(stockage).contacts.hugo000002.langue).toBe('en');
    expect(JSON.stringify(chargerDonnees(stockage).journal)).toMatch(/Langue par défaut de Hugo réglée sur English/);
    expect(await screen.findByTestId('admin-fiche-langue-retour')).toHaveTextContent(/English/);
  });
});

describe('Administration : matrice et actions groupées', () => {
  it('une case de la matrice change l’accès d’un compte à une app', async () => {
    const { ctx, modifications } = contexte(fondateur, [fondateur, hugo]);
    await rendre(ctx);
    await fireEvent.press(screen.getByTestId('admin-onglet-acces'));
    expect(screen.getByTestId('admin-matrice')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('admin-matrice-hugo000002-tsuzuku'));
      await new Promise<void>(r => setTimeout(r, 80));
    });
    expect(modifications).toHaveLength(1);
    expect(modifications[0].find(p => p.id === 'hugo000002')!.apps).toEqual(expect.arrayContaining(['portefeuille', 'tsuzuku']));
  });

  it('action groupée : fermer une app à la sélection', async () => {
    const autre: Profil = { ...hugo, id: 'max0000004', nom: 'Max' };
    const { ctx, modifications } = contexte(fondateur, [fondateur, hugo, autre]);
    await rendre(ctx);
    await fireEvent.press(screen.getByTestId('admin-onglet-utilisateurs'));
    await fireEvent.press(screen.getByTestId('admin-case-hugo000002'));
    await fireEvent.press(screen.getByTestId('admin-case-max0000004'));
    await fireEvent.press(screen.getByTestId('admin-groupe-app-portefeuille'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('admin-groupe-app-fermer'));
      await new Promise<void>(r => setTimeout(r, 80));
    });
    expect(modifications).toHaveLength(1);
    for (const id of ['hugo000002', 'max0000004']) expect(modifications[0].find(p => p.id === id)!.apps).not.toContain('portefeuille');
  });
});

describe('Administration : réglages réservés par rang', () => {
  it('Fondateur : réglages des comptes modifiables, modèle et sauvegarde', async () => {
    const { ctx, stockage } = contexte(fondateur, [fondateur, hugo]);
    await rendre(ctx);
    await fireEvent.press(screen.getByTestId('admin-onglet-reglages'));
    await fireEvent.changeText(screen.getByTestId('admin-rc-mdpLongueurMin'), '14');
    await fireEvent.press(screen.getByTestId('admin-rc-force-3'));
    await fireEvent.press(screen.getByTestId('admin-rc-enregistrer'));
    expect(chargerDonnees(stockage).reglages).toEqual(expect.objectContaining({ mdpLongueurMin: 14, mdpForceMin: 3 }));
    await fireEvent.changeText(screen.getByTestId('admin-modele-corps'), 'Coucou {prenom}');
    expect(screen.getByTestId('admin-modele-erreur')).toHaveTextContent(/\{lien\}/);
    await fireEvent.changeText(screen.getByTestId('admin-modele-corps'), 'Coucou {prenom} : {lien}');
    await fireEvent.press(screen.getByTestId('admin-modele-enregistrer'));
    expect(chargerDonnees(stockage).modeleInvitation?.corps).toBe('Coucou {prenom} : {lien}');
    expect(screen.getByTestId('admin-sauvegarde')).toBeTruthy();
  });

  it('Administrateur : réglages des comptes en lecture seule, pas de sauvegarde', async () => {
    const { ctx } = contexte(iris, [fondateur, iris, hugo]);
    await rendre(ctx);
    await fireEvent.press(screen.getByTestId('admin-onglet-reglages'));
    expect(screen.getByTestId('admin-reglages-comptes-lecture')).toBeTruthy();
    expect(screen.queryByTestId('admin-rc-enregistrer')).toBeNull();
    expect(screen.queryByTestId('admin-modele-enregistrer')).toBeNull();
    expect(screen.queryByTestId('admin-sauvegarde')).toBeNull();
  });

  it('Gestionnaire : ni section Réglages, ni sauvegarde ; la matrice ne montre que ses amis', async () => {
    const { ctx } = contexte(gest, [gest], { gestion: { comptes: [zoe], apercu: [zoe, hugo], autres: 1 } } as Partial<ControleProfils>);
    await rendre(ctx);
    expect(screen.queryByTestId('admin-onglet-reglages')).toBeNull();
    expect(screen.queryByTestId('admin-onglet-securite')).toBeNull();
    await fireEvent.press(screen.getByTestId('admin-onglet-acces'));
    expect(screen.getByTestId('admin-matrice-ligne-zoe0000003')).toBeTruthy();
    expect(screen.queryByTestId('admin-matrice-ligne-hugo000002')).toBeNull();
  });
});
