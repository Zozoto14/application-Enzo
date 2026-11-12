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
import { choisirDans } from '../ui/selecteurs/deplier';

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

function fauxClient(conf: Config, rolesPlus: Array<{ id: string; nom: string; couleur: string | null; position: number }> = []) {
  const appels: Array<{ chemin: string; methode?: string; corps?: unknown }> = [];
  const requete = async (chemin: string, methode?: string, corps?: unknown): Promise<unknown> => {
    appels.push({ chemin, methode, corps });
    if (chemin === '/vocaux/config' && !methode) return conf;
    if (chemin === '/vocaux/config' && methode === 'PUT') return { ...conf, reglages: { ...conf.reglages, ...(corps as object) } };
    if (chemin === '/vocaux/config/commandes' && methode === 'PUT') return { ...conf, commandes: { ...conf.commandes, ...(corps as object) } };
    if (chemin === '/vocaux/goat' && methode === 'POST') return { ...conf, reglages: { ...conf.reglages, rolesPassePartout: [...(conf.reglages.rolesPassePartout ?? []), '731'] }, etat: { passePartout: { cibles: 4, couverts: 3, ajoutes: 3, restaures: 0, echecs: [{ id: '905', nom: 'Salle privée', statut: 403, code: 50013 }], reste: 0, limiteDebit: false, le: '2026-11-04T10:00:00.000Z' } }, roleCree: { id: '731', nom: 'Goat', positionne: true } };
    if (chemin === '/vocaux/passe-partout/synchroniser' && methode === 'POST') return conf;
    if (chemin === '/vocaux/discord')
      return {
        bot: true,
        serveur: { id: '700', nom: 'Club' },
        salons: [
          { id: '750', nom: 'Vocaux', type: 'categorie', parent: null, position: 1 },
          { id: '751', nom: 'Créer un salon', type: 'vocal', parent: '750', position: 2 },
          { id: '713', nom: 'journaux', type: 'texte', parent: null, position: 3 },
        ],
        roles: [{ id: '720', nom: 'Staff', couleur: null, position: 2 }, ...rolesPlus],
        positionBot: 5,
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
  await choisirDans('esport-vc-hub-0-salon', '751');
  await choisirDans('esport-vc-hub-0-categorie', '750');
  expect(screen.getByTestId('esport-vc-hub-0-modele').props.value).toBe('Salon de {pseudo}');
  await fireEvent.changeText(screen.getByTestId('esport-vc-hub-0-modele'), 'Vocal de {pseudo}');
  await fireEvent.changeText(screen.getByTestId('esport-vc-hub-0-limite'), '5');
  await fireEvent(screen.getByTestId('esport-vc-hub-0-verrouille'), 'valueChange', true);
  await fireEvent(screen.getByTestId('esport-vc-actif'), 'valueChange', true);
  await choisirDans('esport-vc-staff', '720');
  // Libellé du rôle du staff dans le nom du salon du staff d'un hub d'événement (exemple : nom du rôle).
  expect(screen.getByTestId('esport-vc-staff-libelles-720').props.placeholder).toBe('Staff');
  await fireEvent.changeText(screen.getByTestId('esport-vc-staff-libelles-720'), 'Modo');
  await fireEvent.changeText(screen.getByTestId('esport-vc-delai'), '30');
  await fireEvent.press(screen.getByTestId('esport-vc-proprietaire-garder'));
  await choisirDans('esport-vc-journaux', '713');
  await fireEvent.press(screen.getByTestId('esport-vc-enregistrer'));
  await screen.findByText('Enregistré.');
  const put = appels.find(a => a.chemin === '/vocaux/config' && a.methode === 'PUT')!.corps as Record<string, unknown>;
  expect(put).toMatchObject({ etiquettesStaff: { 720: 'Modo' } });
  expect(put).toMatchObject({ actif: true, rolesStaff: ['720'], delaiSuppressionS: 30, quandProprietairePart: 'garder', salonJournaux: '713' });
  expect((put.hubs as unknown[])[0]).toMatchObject({ id: '751', nom: 'Créer un salon', categorieId: '750', modeleNom: 'Vocal de {pseudo}', limite: 5, verrouille: true });
});

test('hub d’événement : ligne compacte en lecture seule « configuré dans Événements », rôles autorisés avec le rôle staff inclus, « Ouvrir l’événement » ; renvoyé tel quel', async () => {
  const conf = configDe();
  conf.peutGererEvenements = true;
  conf.evenements = [{ id: 'e1', nom: 'The Nuke End', statut: 'a_venir', debut: '2026-11-21', equipes: 8, staffRole: { id: '990', nom: 'Staff The Nuke End' } }];
  const evt = { id: '752', nom: 'Vocal équipe The Nuke End', categorieId: null, modeleNom: '{tag} — {nom}', limite: 0, verrouille: true, tournoiId: 'e1', rolesAutorises: ['720'] };
  conf.reglages.hubs = [{ id: '751', nom: 'Créer un salon', categorieId: null, modeleNom: 'Salon de {pseudo}', limite: 0, verrouille: false, tournoiId: null, rolesAutorises: [] }, evt];
  const ouvrir = jest.fn();
  const { client, appels } = fauxClient(conf);
  await render(<ConfigVocaux theme={theme} client={client} large onEvenements={ouvrir} />);
  expect((await screen.findByTestId('esport-vc-hub-1-evenement-ligne')).props.children).toBe('Hub de l’événement The Nuke End — configuré dans Événements');
  expect((await screen.findByText(/rôles autorisés en plus : Staff/)).props.children).toBe('Vocal équipe The Nuke End · rôles autorisés en plus : Staff');
  expect(screen.getByText('Rôle staff « Staff The Nuke End » · inclus automatiquement')).toBeTruthy();
  // Aucune édition ni bascule : ni réglages dépliables, ni option « Hub d'événement », ni retrait.
  expect(screen.queryByTestId('esport-vc-hub-1-entete')).toBeNull();
  expect(screen.queryByTestId('esport-vc-hub-1-retirer')).toBeNull();
  await fireEvent.press(screen.getByTestId('esport-vc-hub-0-entete'));
  expect(screen.getByTestId('esport-vc-hub-0-details')).toBeTruthy();
  expect(screen.queryByTestId('esport-vc-hub-0-evenement')).toBeNull();
  expect(screen.queryByText(/Hub d’événement \(/)).toBeNull();
  await fireEvent.press(screen.getByTestId('esport-vc-hub-1-ouvrir-evenement'));
  expect(ouvrir).toHaveBeenCalledWith('e1');
  // Enregistrer : le hub d'événement est renvoyé sans changement (le serveur garde la version de la fiche).
  await fireEvent.press(screen.getByTestId('esport-vc-enregistrer'));
  await screen.findByText('Enregistré.');
  const put = appels.find(a => a.chemin === '/vocaux/config' && a.methode === 'PUT')!.corps as { hubs: unknown[] };
  expect(put.hubs[1]).toMatchObject({ id: '752', tournoiId: 'e1', rolesAutorises: ['720'] });
});

test('hubs ordinaires : pas d’option d’événement ; repliés avec résumé ; sans evenements.gerer, pas de bouton vers l’événement', async () => {
  const conf = configDe();
  conf.peutGererEvenements = false;
  conf.evenements = [{ id: 'e1', nom: 'The Nuke End', statut: 'a_venir', debut: null, equipes: 0, staffRole: null }];
  conf.reglages.hubs = [
    { id: '751', nom: 'Créer un salon', categorieId: null, modeleNom: 'Salon de {pseudo}', limite: 0, verrouille: false, tournoiId: null, rolesAutorises: [] },
    { id: '752', nom: 'Salon privé', categorieId: null, modeleNom: 'Salon de {pseudo}', limite: 0, verrouille: true, tournoiId: null, rolesAutorises: [] },
    { id: '753', nom: 'Vocal équipe', categorieId: null, modeleNom: '{tag} — {nom}', limite: 0, verrouille: true, tournoiId: 'e1', rolesAutorises: [] },
  ];
  const { client } = fauxClient(conf);
  await render(<ConfigVocaux theme={theme} client={client} large onEvenements={jest.fn()} />);
  expect((await screen.findByTestId('esport-vc-hub-1-resume')).props.children).toBe('Salon privé · verrouillé');
  expect(screen.queryByTestId('esport-vc-hub-0-details')).toBeNull();
  expect(screen.getByText('Rôle staff de l’événement · inclus automatiquement')).toBeTruthy();
  expect(screen.queryByTestId('esport-vc-hub-2-ouvrir-evenement')).toBeNull();
  // Un hub ajouté ici est toujours ordinaire.
  await fireEvent.press(screen.getByTestId('esport-vc-hub-ajouter'));
  expect(screen.getByTestId('esport-vc-hub-3-verrouille')).toBeTruthy();
  expect(screen.queryByTestId('esport-vc-hub-3-evenement')).toBeNull();
});

test('options d’un hub ordinaire : placé sous le hub (oui), visibles mais pas joignables (non), cacher le hub seulement avec des rôles ; enregistrées', async () => {
  const { client, appels } = fauxClient(configDe());
  await render(<ConfigVocaux theme={theme} client={client} large />);
  await fireEvent.press(await screen.findByTestId('esport-vc-hub-ajouter'));
  await choisirDans('esport-vc-hub-0-salon', '751');
  expect(screen.getByTestId('esport-vc-hub-0-options-placer').props.value).toBe(true);
  expect(screen.getByTestId('esport-vc-hub-0-options-visible').props.value).toBe(false);
  // Sans rôle choisi : l'option « cacher le hub » est grisée.
  const masquer = screen.getByTestId('esport-vc-hub-0-options-masquer');
  expect([masquer.props.value, masquer.props.disabled]).toEqual([false, true]);
  expect(screen.getByText('Choisissez d’abord les rôles qui peuvent utiliser ce hub.')).toBeTruthy();
  await choisirDans('esport-vc-hub-0-options-roles-hub', '720');
  expect(screen.getByTestId('esport-vc-hub-0-options-masquer').props.disabled).toBe(false);
  await fireEvent(screen.getByTestId('esport-vc-hub-0-options-masquer'), 'valueChange', true);
  await fireEvent(screen.getByTestId('esport-vc-hub-0-options-visible'), 'valueChange', true);
  await fireEvent.press(screen.getByTestId('esport-vc-enregistrer'));
  await screen.findByText('Enregistré.');
  const put = appels.find(a => a.chemin === '/vocaux/config' && a.methode === 'PUT')!.corps as { hubs: unknown[] };
  expect(put.hubs[0]).toMatchObject({ id: '751', placerSousHub: true, visibleNonJoignable: true, masquerHub: true, rolesHub: ['720'] });
});

test('commandes /voc : désactiver une sous-commande, la réserver à un rôle ; enregistré', async () => {
  const { client, appels } = fauxClient(configDe());
  await render(<ConfigVocaux theme={theme} client={client} large />);
  expect(await screen.findByText('/voc renommer : renommer son salon')).toBeTruthy();
  await fireEvent(screen.getByTestId('esport-vc-cmd-renommer-actif'), 'valueChange', false);
  await choisirDans('esport-vc-cmd-verrouiller-roles', '720');
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

test('carte « Accès à toutes les vocs » : créer le rôle Goat (sans permission côté serveur), liste des rôles, option « tous les salons », bilan et échecs, enregistrement partiel', async () => {
  const conf = configDe();
  const { client, appels } = fauxClient(conf, [{ id: '740', nom: 'Légende', couleur: null, position: 9 }]);
  await render(<ConfigVocaux theme={theme} client={client} large />);
  await screen.findByTestId('esport-vc-passe-partout');
  expect(screen.getByText(/Aucune permission de serveur/)).toBeTruthy();
  expect(screen.queryByTestId('esport-vc-passe-etat')).toBeNull();
  // Création : nom vide (défaut Goat côté serveur), couleur modifiable.
  expect(screen.getByTestId('esport-vc-goat-nom').props.placeholder).toBe('Goat');
  await fireEvent.changeText(screen.getByTestId('esport-vc-goat-couleur'), '#ff8800');
  await fireEvent.press(screen.getByTestId('esport-vc-goat-creer'));
  await screen.findByText(/Rôle « Goat » créé et ajouté/);
  const creation = appels.find(a => a.chemin === '/vocaux/goat')!;
  expect(creation).toMatchObject({ methode: 'POST', corps: { couleur: '#ff8800' } });
  expect(JSON.stringify(creation.corps)).not.toMatch(/permission/);
  // Bilan : salons couverts, échec noté avec le code de Discord.
  expect(screen.getByTestId('esport-vc-passe-etat')).toBeTruthy();
  expect(screen.getByText(/Salons couverts : 3 sur 4 · ajoutés : 3 · rendus : 0 · échecs : 1/)).toBeTruthy();
  expect(screen.getByTestId('esport-vc-passe-echec-905').props.children).toBe('Refusé par Discord : Salle privée (code 50013).');
  // Rôle placé au-dessus du bot : avertissement ; option coupée ; enregistrement partiel (hubs non envoyés).
  await choisirDans('esport-vc-passe-roles', '740');
  expect(screen.getByTestId('esport-vc-passe-au-dessus').props.children).toMatch(/Légende/);
  await fireEvent(screen.getByTestId('esport-vc-passe-tous'), 'valueChange', false);
  await fireEvent.press(screen.getByTestId('esport-vc-passe-enregistrer'));
  await screen.findByText('Enregistré.');
  const put = appels.find(a => a.chemin === '/vocaux/config' && a.methode === 'PUT')!.corps as Record<string, unknown>;
  expect(put).toEqual({ rolesPassePartout: ['731', '740'], passePartoutTous: false });
  await fireEvent.press(screen.getByTestId('esport-vc-passe-synchroniser'));
  expect(appels.some(a => a.chemin === '/vocaux/passe-partout/synchroniser' && a.methode === 'POST')).toBe(true);
});
