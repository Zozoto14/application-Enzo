/**
 * Administration › Bot Esport HQ › Fonctionnalités (docs/esport/vocaux.md), écran : connexion exigée « en direct » (rappel quand elle
 * ne l'est pas), permissions du bot qui manquent, hubs (salon, catégorie, modèle, limite, verrouillage), rôles du
 * staff, délai, départ du propriétaire, journaux, enregistrement ; salons temporaires ouverts ; carte de l'onglet
 * Administration › Bot Esport HQ › Fonctionnalités, selon la permission.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import type { ClientEsport } from './client';
import { definirLangue } from './i18n';
import { ConfigVocaux, ReglagesVocaux } from './ui/vocaux/ConfigVocaux';
import { fonctionnalitesBot } from './ui/bot/sections';
import type { EtatBotAdmin } from './bot/api';
import type { ConfigVocaux as Config } from './vocaux/api';

const theme = themeHub('nuit');
afterEach(() => definirLangue('fr'));

function configDe(): Config {
  return {
    reglages: { actif: false, hubs: [], rolesStaff: [], delaiSuppressionS: 15, maxParMembre: 1, quandProprietairePart: 'transferer', salonJournaux: null },
    commandes: { renommer: { actif: true, roles: [] }, verrouiller: { actif: true, roles: [] } },
    serveur: { id: '700', nom: 'Club' },
    connexion: { mode: 'secours', depuis: '2026-11-04T10:00:00.000Z' },
    gatewayActivee: true,
    etat: { derniereErreur: { motif: 'creation', statut: 403, code: 50013, le: '2026-11-04T10:00:00.000Z' } },
    salons: [{ id: '901', nom: 'Salon de Léa', hubId: '751', proprietaireId: '81', proprietaireNom: 'Léa', verrouille: true, limite: 0, presents: 2, amis: 1, tournoiId: null, equipeId: null, videDepuis: null, creeLe: '2026-11-04T10:00:00.000Z' }],
    choix: { commandes: ['renommer', 'verrouiller'], modesProprietaire: ['transferer', 'garder'], limites: { hubs: 10, roles: 20, amis: 25, places: 99, delaiMinS: 5, delaiMaxS: 300, parMembreMax: 5, modele: 90 }, modeleDefaut: 'Salon de {pseudo}', modeleTournoiDefaut: '{tag} — {nom}', permissionsBot: ['voir_salons', 'gerer_salons', 'gerer_roles', 'connecter', 'deplacer_membres'] },
    bot: true,
    lienInvitation: 'https://discord.com/oauth2/authorize?client_id=1',
  };
}

function fauxClient(conf: Config) {
  const appels: Array<{ chemin: string; methode?: string; corps?: unknown }> = [];
  const requete = async (chemin: string, methode?: string, corps?: unknown): Promise<unknown> => {
    appels.push({ chemin, methode, corps });
    if (chemin === '/vocaux/config' && !methode) return conf;
    if (chemin === '/vocaux/config' && methode === 'PUT') return { ...conf, reglages: { ...conf.reglages, ...(corps as object) } };
    if (chemin === '/vocaux/config/commandes' && methode === 'PUT') return { ...conf, commandes: { ...conf.commandes, ...(corps as object) } };
    if (chemin === '/vocaux/discord')
      return {
        bot: true,
        serveur: { id: '700', nom: 'Club' },
        salons: [
          { id: '750', nom: 'Vocaux', type: 'categorie', parent: null, position: 1 },
          { id: '751', nom: 'Créer un salon', type: 'vocal', parent: '750', position: 2 },
          { id: '713', nom: 'journaux', type: 'texte', parent: null, position: 3 },
        ],
        roles: [{ id: '720', nom: 'Staff', couleur: null, position: 2 }],
        permissions: { membreTrouve: true, serveur: ['deplacer_membres'], hubs: [] },
      };
    throw new Error(`inattendu : ${methode ?? 'GET'} ${chemin}`);
  };
  return { client: { requete } as unknown as ClientEsport, appels };
}

test('connexion en secours : rappel « connexion en direct » ; permissions manquantes ; dernier refus ; salons ouverts', async () => {
  const conf = configDe();
  conf.reglages.actif = true;
  conf.reglages.hubs = [{ id: '751', nom: 'Créer un salon', categorieId: null, modeleNom: 'Salon de {pseudo}', limite: 0, verrouille: false, tournoiId: null, rolesAutorises: [] }];
  const { client } = fauxClient(conf);
  await render(<ConfigVocaux theme={theme} client={client} large />);
  await screen.findByTestId('esport-vc-connexion-requise');
  expect(screen.getByText(/nécessitent la connexion en direct/)).toBeTruthy();
  expect(screen.getByTestId('esport-vc-connexion-secours')).toBeTruthy();
  expect(await screen.findByText(/Il manque au bot : Déplacer des membres/)).toBeTruthy();
  expect(screen.getByTestId('esport-vc-derniere-erreur').props.children).toMatch(/creation \(code 50013\)/);
  expect(screen.getByText(/Salon de Léa · propriétaire : Léa · 2 présent/)).toBeTruthy();
  expect(screen.getByText('Verrouillé')).toBeTruthy();
});

test('hubs : ajout, salon, catégorie, modèle, limite, verrouillage ; staff, délai, départ du propriétaire, journaux ; enregistré', async () => {
  const { client, appels } = fauxClient(configDe());
  await render(<ConfigVocaux theme={theme} client={client} large />);
  await fireEvent.press(await screen.findByTestId('esport-vc-hub-ajouter'));
  await fireEvent.press(await screen.findByTestId('esport-vc-hub-0-salon-751'));
  await fireEvent.press(screen.getByTestId('esport-vc-hub-0-categorie-750'));
  expect(screen.getByTestId('esport-vc-hub-0-modele').props.value).toBe('Salon de {pseudo}');
  await fireEvent.changeText(screen.getByTestId('esport-vc-hub-0-modele'), 'Vocal de {pseudo}');
  await fireEvent.changeText(screen.getByTestId('esport-vc-hub-0-limite'), '5');
  await fireEvent(screen.getByTestId('esport-vc-hub-0-verrouille'), 'valueChange', true);
  await fireEvent(screen.getByTestId('esport-vc-actif'), 'valueChange', true);
  await fireEvent.press(screen.getByTestId('esport-vc-staff-720'));
  await fireEvent.changeText(screen.getByTestId('esport-vc-delai'), '30');
  await fireEvent.press(screen.getByTestId('esport-vc-proprietaire-garder'));
  await fireEvent.press(screen.getByTestId('esport-vc-journaux-713'));
  await fireEvent.press(screen.getByTestId('esport-vc-enregistrer'));
  await screen.findByText('Enregistré.');
  const put = appels.find(a => a.chemin === '/vocaux/config' && a.methode === 'PUT')!.corps as Record<string, unknown>;
  expect(put).toMatchObject({ actif: true, rolesStaff: ['720'], delaiSuppressionS: 30, quandProprietairePart: 'garder', salonJournaux: '713' });
  expect((put.hubs as unknown[])[0]).toMatchObject({ id: '751', nom: 'Créer un salon', categorieId: '750', modeleNom: 'Vocal de {pseudo}', limite: 5, verrouille: true });
});

test('hub de tournoi : tournoi lié, modèle des équipes, toujours verrouillé, rôles autorisés (casters) ; enregistré', async () => {
  const conf = configDe();
  conf.tournois = [{ id: 't1', nom: 'The Nuke End', team: 'Organisation' }];
  const { client, appels } = fauxClient(conf);
  await render(<ConfigVocaux theme={theme} client={client} large />);
  await fireEvent.press(await screen.findByTestId('esport-vc-hub-ajouter'));
  await fireEvent.press(await screen.findByTestId('esport-vc-hub-0-salon-751'));
  expect(screen.getByTestId('esport-vc-hub-0-verrouille')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('esport-vc-hub-0-tournoi-t1'));
  expect(screen.getByTestId('esport-vc-hub-0-modele').props.value).toBe('{tag} — {nom}');
  expect(screen.queryByTestId('esport-vc-hub-0-verrouille')).toBeNull();
  expect(screen.getByText(/reste verrouillé sur son rôle/)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('esport-vc-hub-0-roles-720'));
  await fireEvent.press(screen.getByTestId('esport-vc-enregistrer'));
  await screen.findByText('Enregistré.');
  const put = appels.find(a => a.chemin === '/vocaux/config' && a.methode === 'PUT')!.corps as { hubs: unknown[] };
  expect(put.hubs[0]).toMatchObject({ id: '751', tournoiId: 't1', modeleNom: '{tag} — {nom}', verrouille: true, rolesAutorises: ['720'] });
  // Retour à un hub ordinaire : le modèle par défaut revient.
  await fireEvent.press(screen.getByTestId('esport-vc-hub-0-tournoi--'));
  expect(screen.getByTestId('esport-vc-hub-0-modele').props.value).toBe('Salon de {pseudo}');
});

test('commandes /voc : désactiver une sous-commande, la réserver à un rôle ; enregistré', async () => {
  const { client, appels } = fauxClient(configDe());
  await render(<ConfigVocaux theme={theme} client={client} large />);
  expect(await screen.findByText('/voc renommer : renommer son salon')).toBeTruthy();
  await fireEvent(screen.getByTestId('esport-vc-cmd-renommer-actif'), 'valueChange', false);
  await fireEvent.press(await screen.findByTestId('esport-vc-cmd-verrouiller-roles-720'));
  await fireEvent.press(screen.getByTestId('esport-vc-cmd-enregistrer'));
  await screen.findByText('Enregistré.');
  const put = appels.find(a => a.chemin === '/vocaux/config/commandes' && a.methode === 'PUT')!.corps as Record<string, { actif: boolean; roles: string[] }>;
  expect(put.renommer).toEqual({ actif: false, roles: [] });
  expect(put.verrouiller).toEqual({ actif: true, roles: ['720'] });
});

test('anglais ; onglet Bot Esport HQ : carte « Salons vocaux temporaires » avec ses réglages (selon la permission)', async () => {
  definirLangue('en');
  const { client } = fauxClient(configDe());
  await render(<ConfigVocaux theme={theme} client={client} large />);
  expect(await screen.findByText(/require the live connection/)).toBeTruthy();
  definirLangue('fr');
  const carte = fonctionnalitesBot().find(f => f.id === 'vocaux')!;
  expect(carte.bientot).toBeFalsy();
  expect(carte.Reglages).toBe(ReglagesVocaux);
  const etat = { vocaux: { actif: true, configurer: true } } as unknown as EtatBotAdmin;
  const ctx = { theme, client, large: false, etat, ouvrirSection: () => undefined };
  expect(carte.etat?.(ctx)).toEqual({ texte: 'Activée', ton: 'ok' });
  const { unmount } = await render(<ReglagesVocaux {...ctx} />);
  expect(await screen.findByTestId('esport-vc-reglages')).toBeTruthy();
  expect(screen.queryByText('Salons vocaux temporaires')).toBeNull();
  await unmount();
  await render(<ReglagesVocaux {...ctx} etat={{ vocaux: { actif: false, configurer: false } } as unknown as EtatBotAdmin} />);
  expect(screen.getByText(/réservés à la permission/)).toBeTruthy();
});
