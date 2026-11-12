/**
 * Administration › Événements (docs/esport/evenements.md) : liste et création ; fiche (réglages, rôle repère choisi
 * dans la hiérarchie du serveur, rôles au-dessus du bot grisés) ; équipes : import depuis les tickets (propositions,
 * problèmes, déjà importée décochée), ajout → bilan des rôles automatiques, correction, retrait, resynchronisation,
 * suppression des rôles ; sous-onglet visible selon la permission ; anglais.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import type { ClientEsport } from './client';
import { definirLangue } from './i18n';
import { PageEvenements } from './ui/evenements/PageEvenements';
import { sousOngletsAdmin } from './ui/administration/PageAdministration';
import type {
  ChoixEvenements,
  Evenement,
  FicheEvenement,
  PropositionEquipe,
  VocauxEvenement,
  VueSalonsMatch,
} from './evenements/api';
import type { Hub } from './vocaux/api';
import { choisirDans, deplier } from '../ui/selecteurs/deplier';

const theme = themeHub('nuit');
afterEach(() => definirLangue('fr'));

const choix: ChoixEvenements = {
  statuts: ['a_venir', 'en_cours', 'termine', 'annule'],
  postes: ['joueur', 'coach', 'remplacant'],
  jeux: [{ cle: 'arc_raiders', nom: 'ARC Raiders' }],
  limites: {
    equipes: 64,
    membres: 10,
    evenements: 200,
    nom: 80,
    description: 1000,
  },
  modeleDefaut: '{tag} {nom}',
  suppressionDefautH: 24,
};

function evenementDe(): Evenement {
  return {
    id: 'ev1',
    nom: 'The Nuke End',
    jeu: 'arc_raiders',
    debut: '2026-11-21',
    fin: '2026-11-22',
    statut: 'a_venir',
    description: '',
    categorieTicketId: 'cat1',
    categoriesTickets: [],
    discord: {
      rolesAuto: true,
      modeleRole: '{tag} {nom}',
      couleur: null,
      roleAncreId: null,
      suppressionH: 24,
      rolesCreesLe: null,
      rolesSupprimesLe: null,
      staffModele: 'Staff {evenement}',
      staffRoleId: null,
    },
    creeLe: '2026-11-10T10:00:00.000Z',
    majLe: '2026-11-10T10:00:00.000Z',
  };
}

function ficheDe(): FicheEvenement {
  return {
    evenement: evenementDe(),
    staff: [],
    equipes: [
      {
        id: 'e1',
        nom: 'Ligne Zéro',
        tag: 'LZ0',
        roleId: null,
        roleNom: null,
        ticketId: 'tk1',
        membres: [
          {
            id: 'm1',
            poste: 'joueur',
            discordId: '810000000000000101',
            nom: 'Kira',
            embarkId: 'Kira#1234',
            roleStatut: null,
          },
        ],
      },
    ],
    categoriesTickets: [
      {
        id: 'cat1',
        nom: {
          fr: 'Inscription The Nuke End',
          en: 'The Nuke End registration',
        },
      },
    ],
    serveur: { id: '700', nom: 'Club' },
    hubs: [{ id: '751', nom: 'Vocal équipe The Nuke End' }],
    droits: { importer: true, vocaux: true },
    bot: true,
    choix,
  };
}

const propositions: PropositionEquipe[] = [
  {
    ticketId: 'tk1',
    numero: 1,
    statut: 'resolu',
    auteur: 'Cap',
    nom: 'Ligne Zéro',
    tag: 'LZ0',
    membres: [],
    problemes: [],
    deja: true,
  },
  {
    ticketId: 'tk2',
    numero: 2,
    statut: 'resolu',
    auteur: 'Cap',
    nom: 'Bravo',
    tag: 'BRV',
    membres: [
      {
        poste: 'joueur',
        discordId: '810000000000000102',
        nom: '',
        embarkId: 'Nox#0042',
        present: true,
      },
      {
        poste: 'joueur',
        discordId: null,
        nom: 'inconnu',
        embarkId: '',
        present: null,
      },
    ],
    problemes: ['sans_id'],
    deja: false,
  },
];

const bilan = {
  creees: 1,
  attribues: 1,
  absents: [
    { equipe: 'BRV Bravo', nom: 'Ghost', discordId: '810000000000000199' },
  ],
  sansId: [{ equipe: 'BRV Bravo', nom: 'inconnu' }],
  refus: [],
  limite: false,
  hierarchie: { positionBot: 6, ok: true },
  position: { ok: true, deplaces: 2 },
};

function vocauxDe(peutModifier = true): VocauxEvenement {
  return {
    hubs: [{ id: '751', nom: 'Vocal équipe The Nuke End', categorieId: null, modeleNom: '{tag} — {nom}', limite: 0, verrouille: true, tournoiId: 'ev1', rolesAutorises: ['720000000000000060'] }],
    autresHubs: ['753'],
    actif: true,
    staffRole: { id: '990', nom: 'Staff The Nuke End' },
    peutModifier,
    choix: { limites: { hubs: 10, roles: 20, places: 99, modele: 90 }, modeleDefaut: '{tag} — {nom}' },
  };
}

function salonsMatchDe(): VueSalonsMatch {
  return {
    reglages: { actif: false, categorieId: null, modeleNom: '{round}-{equipes}', delaiSuppressionMin: 30, rappels: true, langue: 'bot', avanceH: 0, retentionJours: 0, ancreId: null },
    choix: { limites: { delaiMin: 5, delaiMax: 1440, modele: 80, avanceMax: 168, retentionMax: 3650 }, langues: ['bot', 'fr', 'en', 'fr_en', 'en_fr'], defaut: { actif: false, categorieId: null, modeleNom: '{round}-{equipes}', delaiSuppressionMin: 30, rappels: true, langue: 'bot', avanceH: 0, retentionJours: 0, ancreId: null } },
    lie: true,
    bot: true,
    erreurDiscord: null,
    erreurSite: null,
    categories: [{ id: '700000000000000060', nom: 'Matchs' }, { id: '700000000000000061', nom: 'Tickets' }],
    salonsTexte: [
      { id: '700000000000000060', nom: 'Matchs', type: 'categorie', parent: null, position: 1 },
      { id: '700000000000000070', nom: 'matchs-du-jour', type: 'texte', parent: '700000000000000060', position: 2 },
      { id: '700000000000000071', nom: 'general', type: 'texte', parent: null, position: 0 },
    ],
    salons: [{ id: 'sm1', cle: 'm:44444444-4444-4444-8444-000000000001', genre: 'match', titre: 'Upper bracket · Round 1 · Match 1', equipes: [{ nom: 'Ligne Zéro', tag: 'LZ0', role: true }, { nom: 'Delta', tag: 'DLT', role: false }], staff: [{ nom: 'Arbitre', present: true }, { nom: 'Ghost', present: false }], salonId: '730000000000000001', lien: 'https://discord.com/channels/700/730000000000000001', statut: 'termine', prevuLe: '2026-11-21T18:00:00.000Z', resultatLe: '2026-11-21T18:40:00.000Z', suppressionLe: '2026-11-21T19:10:00.000Z', supprimeLe: null, historique: false, nbMessages: 0, erreur: null }],
    matchs: [{ cle: 'l:55555555-5555-4555-8555-000000000001', genre: 'lobby', titre: 'Lobby 1 · Round 1', statut: 'pending', prevuLe: null, equipes: [{ nom: 'Ligne Zéro', tag: 'LZ0', role: true }, { nom: 'Bravo', tag: 'BRV', role: true }, { nom: 'Charlie', tag: 'CHA', role: true }] }],
    etat: { le: '2026-11-21T18:41:00.000Z', crees: 1, majs: 0, resultats: 1, annules: 0, supprimes: 0, attente: 0, limite: false, erreur: null },
  };
}
let salonsMatch = salonsMatchDe();
beforeEach(() => {
  salonsMatch = salonsMatchDe();
});

function fauxClient(
  fiche: FicheEvenement,
  liste: Evenement[] = [{ ...fiche.evenement, equipes: 1 }],
  vocaux: VocauxEvenement = vocauxDe(),
) {
  const appels: Array<{ chemin: string; methode?: string; corps?: unknown }> =
    [];
  const requete = async (
    chemin: string,
    methode?: string,
    corps?: unknown,
  ): Promise<unknown> => {
    appels.push({ chemin, methode, corps });
    if (chemin === '/evenements' && !methode)
      return { evenements: liste, choix, bot: true };
    if (chemin === '/evenements' && methode === 'POST')
      return {
        ...fiche,
        evenement: {
          ...fiche.evenement,
          id: 'ev2',
          nom: (corps as { nom: string }).nom,
        },
        equipes: [],
      };
    if (chemin.startsWith('/evenements/staff-candidats'))
      return { candidats: [{ discordId: '810000000000000301', nom: 'Zed', compteId: 'zed12345', source: 'app' }, { discordId: '800000000000000077', nom: 'Zoé', compteId: null, source: 'discord' }] };
    if (chemin === '/evenements/ev1/staff' && methode === 'POST') {
      const c = corps as { discordId: string; nom: string };
      fiche.staff = [...fiche.staff, { id: `s${fiche.staff.length}`, discordId: c.discordId, nom: c.nom, compteId: null, roleStatut: 'attribue' }];
      fiche.evenement.discord.staffRoleId = '990';
      return { ...fiche, discord: { erreur: null, staff: { cree: true, attribues: 1, retires: 0, absents: [], refus: [], categories: 2, vocaux: 1, roleId: '990' } } };
    }
    if (chemin === '/evenements/ev1/staff/s0' && methode === 'DELETE') {
      fiche.staff = fiche.staff.filter(m => m.id !== 's0');
      return { ...fiche };
    }
    if (chemin === '/evenements/roles-serveur')
      return {
        erreur: null,
        positionBot: 6,
        roles: [
          {
            id: '720000000000000002',
            nom: 'Esport HQ',
            position: 6,
            couleur: null,
            gere: true,
            bot: true,
            utilisable: false,
          },
          {
            id: '720000000000000001',
            nom: 'Staff',
            position: 5,
            couleur: '#e4572e',
            gere: false,
            bot: false,
            utilisable: true,
          },
          {
            id: '720000000000000003',
            nom: 'Membre',
            position: 2,
            couleur: null,
            gere: false,
            bot: false,
            utilisable: true,
          },
          {
            id: '720000000000000004',
            nom: 'Admin',
            position: 1,
            couleur: null,
            gere: false,
            bot: false,
            utilisable: true,
            interdit: 'permissions',
          },
        ],
      };
    if (chemin === '/evenements/ev1' && !methode) return fiche;
    if (chemin === '/evenements/ev1/staff-roles' && methode === 'POST') {
      const c = corps as { nom: string; label: string; couleur: string | null; membres: string[] };
      fiche.evenement.discord.staffRolesSup = [...(fiche.evenement.discord.staffRolesSup ?? []), { id: '991', nom: c.nom, label: c.label, couleur: c.couleur, supprimerFin: true, cree: true, membres: c.membres }];
      return { ...fiche };
    }
    if (chemin === '/evenements/ev1' && methode === 'DELETE') return { ok: true, hubs: fiche.suppression?.hubs ?? 0, vocauxDesactives: Boolean(fiche.suppression?.desactiveVocaux), nettoyage: { roles: 2, salons: 1, echecs: [], erreur: null } };
    if (chemin === '/evenements/ev1' && methode === 'PATCH')
      return {
        ...fiche,
        evenement: {
          ...fiche.evenement,
          discord: {
            ...fiche.evenement.discord,
            ...((corps as { discord: object }).discord ?? {}),
          },
        },
      };
    if (chemin === '/evenements/ev1/import')
      return { categorieId: 'cat1', propositions };
    if (chemin.startsWith('/evenements/ev1/site')) {
      const lie = chemin.endsWith('/synchro') || (methode === 'PUT' && (corps as { tournoiId: string | null }).tournoiId) ? 'tn1' : null;
      return {
        tournoiId: lie,
        tournois: [{ id: 'tn1', nom: 'The Nuke End', statut: 'registration' }],
        erreur: null,
        etat: lie ? { ok: true, le: '2026-11-10T10:00:00.000Z', envoyees: 2, recues: 1, majSite: 0, majApp: 0, supprimees: 0, erreurs: [] } : null,
      };
    }
    if (chemin === '/evenements/ev1/equipes' && methode === 'POST') {
      const ajout = (
        corps as {
          equipes: Array<{
            nom: string;
            tag: string;
            membres: FicheEvenement['equipes'][0]['membres'];
          }>;
        }
      ).equipes.map((e, i) => ({
        id: `n${i}`,
        roleId: '999',
        roleNom: null,
        ticketId: null,
        ...e,
      }));
      fiche.equipes = [...fiche.equipes, ...ajout];
      return { ...fiche, discord: { erreur: null, bilan } };
    }
    if (chemin === '/evenements/ev1/equipes/e1' && methode === 'PATCH')
      return {
        ...fiche,
        equipes: [
          { ...fiche.equipes[0], ...(corps as object) },
          ...fiche.equipes.slice(1),
        ],
        discord: {
          erreur: null,
          bilan: {
            ...bilan,
            creees: 0,
            absents: [],
            sansId: [],
            renommees: 1,
            retires: 1,
          },
        },
      };
    if (chemin === '/evenements/ev1/equipes/e1' && methode === 'DELETE')
      return {
        ...fiche,
        equipes: fiche.equipes.filter(e => e.id !== 'e1'),
        discord: { erreur: null, suppression: { role: true, salons: 1 } },
      };
    if (chemin === '/evenements/ev1/roles')
      return {
        ...fiche,
        discord: {
          erreur: null,
          bilan: {
            ...bilan,
            refus: [
              {
                equipe: 'BRV Bravo',
                quoi: 'attribution',
                statut: 403,
                code: 50013,
              },
            ],
          },
        },
      };
    if (chemin === '/evenements/ev1/roles/supprimer')
      return { ...fiche, nettoyage: { roles: 2, salons: 1, echecs: [] } };
    // Vocaux de l'événement (hubs) et salons / rôles du serveur.
    if (/^\/evenements\/[^/]+\/vocaux$/.test(chemin) && !methode) return { ...vocaux };
    if (/^\/evenements\/[^/]+\/vocaux$/.test(chemin) && methode === 'POST') {
      const c = corps as Partial<Hub>;
      vocaux.hubs = [...vocaux.hubs, { id: '', nom: '', categorieId: null, modeleNom: '{tag} — {nom}', limite: 0, rolesAutorises: [], ...c, verrouille: true, tournoiId: 'ev1' }];
      return { ...vocaux };
    }
    const unHub = /^\/evenements\/[^/]+\/vocaux\/(\d+)$/.exec(chemin);
    if (unHub && methode === 'PATCH') {
      vocaux.hubs = vocaux.hubs.map(h => (h.id === unHub[1] ? { ...h, ...(corps as Partial<Hub>) } : h));
      return { ...vocaux };
    }
    if (unHub && methode === 'DELETE') {
      vocaux.hubs = vocaux.hubs.filter(h => h.id !== unHub[1]);
      return { ...vocaux };
    }
    // Salons de match Discord.
    if (chemin === '/evenements/ev1/salons-match' && !methode) return salonsMatch;
    if (chemin === '/evenements/ev1/salons-match' && methode === 'PUT') {
      salonsMatch.reglages = { ...salonsMatch.reglages, ...(corps as object) };
      return salonsMatch;
    }
    if (chemin === '/evenements/ev1/salons-match/creer' && methode === 'POST') {
      salonsMatch.matchs = [];
      salonsMatch.salons = [...salonsMatch.salons, { ...salonsMatch.salons[0], id: 'sm2', cle: (corps as { cle: string }).cle, titre: 'Lobby 1 · Round 1', statut: 'ouvert', historique: false }];
      return salonsMatch;
    }
    if (chemin === '/evenements/ev1/salons-match/sm1/supprimer' && methode === 'POST') {
      salonsMatch.salons = salonsMatch.salons.map(x => (x.id === 'sm1' ? { ...x, statut: 'supprime' as const, lien: null, historique: true, supprimeLe: '2026-11-21T19:00:00.000Z' } : x));
      return salonsMatch;
    }
    if (chemin === '/evenements/ev1/salons-match/sm1/historique')
      return { salon: salonsMatch.salons[0], messages: [{ id: 'msg1', auteur: 'Kira', auteurId: '810000000000000101', bot: false, contenu: 'Prêts !', le: '2026-11-21T18:00:00.000Z', pieces: [{ nom: 'lineup.png', url: 'https://cdn.discordapp.com/a/lineup.png', taille: 2048 }], embeds: [] }] };
    if (chemin === '/vocaux/discord')
      return {
        bot: true,
        salons: [
          { id: '700000000000000050', nom: 'The Nuke End', type: 'categorie', parent: null, position: 1 },
          { id: '751', nom: 'Vocal équipe The Nuke End', type: 'vocal', parent: '700000000000000050', position: 2 },
          { id: '752', nom: 'Vocal casters', type: 'vocal', parent: '700000000000000050', position: 3 },
          { id: '753', nom: 'Créer un salon', type: 'vocal', parent: null, position: 0 },
        ],
        roles: [
          { id: '720000000000000060', nom: 'Caster', couleur: null, position: 4 },
          { id: '990', nom: 'Staff The Nuke End', couleur: null, position: 3 },
        ],
      };
    throw new Error(`inattendu : ${methode ?? 'GET'} ${chemin}`);
  };
  return { client: { requete } as unknown as ClientEsport, appels };
}

test('sous-onglet « Événements » : seulement avec la permission, avant Devblog', () => {
  expect(
    sousOngletsAdmin({ bot: true, evenements: true, devblog: true }),
  ).toEqual(['bot', 'evenements', 'devblog']);
  expect(sousOngletsAdmin({ bot: true })).toEqual(['bot']);
});

test('liste, création d’un événement (rôles automatiques par défaut), fiche ouverte', async () => {
  const { client, appels } = fauxClient(ficheDe(), []);
  await render(<PageEvenements theme={theme} client={client} large />);
  expect(await screen.findByTestId('esport-ev-vide')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('esport-ev-nouveau'));
  await fireEvent.changeText(
    screen.getByTestId('esport-ev-nom'),
    'LAN de Noël',
  );
  await fireEvent.changeText(
    screen.getByTestId('esport-ev-debut'),
    '2026-12-20',
  );
  await fireEvent.press(screen.getByTestId('esport-ev-jeu-arc_raiders'));
  expect(screen.getByTestId('esport-ev-roles-auto').props.value).toBe(true);
  await fireEvent.press(screen.getByTestId('esport-ev-creer'));
  expect(
    (await screen.findByTestId('esport-ev-fiche-nom')).props.children,
  ).toBe('LAN de Noël');
  const post = appels.find(
    a => a.chemin === '/evenements' && a.methode === 'POST',
  )!.corps as Record<string, unknown>;
  expect(post).toMatchObject({
    nom: 'LAN de Noël',
    debut: '2026-12-20',
    jeu: 'arc_raiders',
    statut: 'a_venir',
    discord: { rolesAuto: true, modeleRole: '{tag} {nom}', suppressionH: 24 },
  });
});

test('rôle repère : hiérarchie du serveur, rôle du bot grisé ; « juste en dessous de Staff » enregistré', async () => {
  const { client, appels } = fauxClient(ficheDe());
  await render(<PageEvenements theme={theme} client={client} large />);
  await fireEvent.press(await screen.findByTestId('esport-ev-ev1'));
  expect(await screen.findByTestId('esport-ev-vocaux')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('esport-ev-position-lire'));
  await deplier('esport-ev-position');
  const bot = await screen.findByTestId(
    'esport-ev-position-720000000000000002',
  );
  expect(bot.props.accessibilityState).toMatchObject({ disabled: true });
  expect(screen.getByText('rôle du bot')).toBeTruthy();
  // Ordre de la hiérarchie : Esport HQ, Staff, Membre, Admin, puis « Tout en bas ».
  const ids = screen
    .getAllByRole('radio')
    .map(n => String(n.props.testID))
    .filter(id => id.startsWith('esport-ev-position-'));
  expect(ids).toEqual([
    'esport-ev-position-720000000000000002',
    'esport-ev-position-720000000000000001',
    'esport-ev-position-720000000000000003',
    'esport-ev-position-720000000000000004',
    'esport-ev-position-bas',
  ]);
  await fireEvent.press(bot);
  expect(screen.queryByTestId('esport-ev-position-choisi')).toBeNull();
  await fireEvent.press(
    screen.getByTestId('esport-ev-position-720000000000000001'),
  );
  expect(screen.getByTestId('esport-ev-position-choisi').props.children).toBe(
    'Repère : Staff',
  );
  await fireEvent.press(screen.getByTestId('esport-ev-enregistrer'));
  await screen.findByText('Enregistré.');
  const patch = appels.find(a => a.methode === 'PATCH')!.corps as {
    discord: { roleAncreId: string };
  };
  expect(patch.discord.roleAncreId).toBe('720000000000000001');
});

test('équipes : import (problèmes, déjà importée décochée), ajout → bilan des rôles automatiques ; correction ; retrait ; resynchroniser ; supprimer les rôles', async () => {
  const { client, appels } = fauxClient(ficheDe());
  await render(<PageEvenements theme={theme} client={client} large />);
  await fireEvent.press(await screen.findByTestId('esport-ev-ev1'));
  await fireEvent.press(await screen.findByTestId('esport-eq-importer'));
  expect(await screen.findByTestId('esport-eq-prop-2-sans_id')).toBeTruthy();
  expect(screen.getByText('Déjà dans l’événement')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('esport-eq-import-ajouter'));
  await screen.findByText('1 équipe(s) ajoutée(s).');
  const post = appels.find(
    a => a.chemin.endsWith('/equipes') && a.methode === 'POST',
  )!.corps as { equipes: Array<{ tag: string; ticketId: string }> };
  expect(post.equipes.map(e => [e.tag, e.ticketId])).toEqual([['BRV', 'tk2']]);
  expect(screen.getByText('1 rôle(s) créé(s), 1 attribution(s).')).toBeTruthy();
  expect(screen.getByTestId('esport-eq-bilan-absents').props.children).toMatch(
    /Ghost \(BRV Bravo\)/,
  );
  expect(screen.getByTestId('esport-eq-position-ok')).toBeTruthy();
  // Correction d'un membre : bilan (renommé, rôle retiré).
  await fireEvent.press(screen.getByTestId('esport-eq-equipe-LZ0-modifier'));
  await fireEvent.changeText(
    screen.getByTestId('esport-eq-edition-LZ0-membre-0-discord'),
    '81 0000000000000111',
  );
  await fireEvent.press(
    screen.getByTestId('esport-eq-edition-LZ0-enregistrer'),
  );
  expect(await screen.findByText('1 rôle(s) renommé(s).')).toBeTruthy();
  expect(
    screen.getByText('Rôle retiré à 1 membre(s) enlevé(s) de leur équipe.'),
  ).toBeTruthy();
  const patch = appels.find(a => a.methode === 'PATCH')!.corps as {
    membres: Array<{ discordId: string | null }>;
  };
  expect(patch.membres[0].discordId).toBe('810000000000000111');
  // Resynchroniser : rôle du bot trop bas expliqué.
  await fireEvent.press(screen.getByTestId('esport-eq-resynchroniser'));
  expect(await screen.findByTestId('esport-eq-hierarchie')).toBeTruthy();
  // Retirer l'équipe : rôle et salon supprimés.
  await fireEvent.press(screen.getByTestId('esport-eq-equipe-LZ0-supprimer'));
  await fireEvent.press(
    screen.getByTestId('esport-eq-equipe-LZ0-supprimer-confirmer'),
  );
  expect(
    await screen.findByText(
      'Équipe retirée : rôle supprimé, 1 salon(s) vocal(aux) supprimé(s).',
    ),
  ).toBeTruthy();
  await fireEvent.press(screen.getByTestId('esport-eq-supprimer-roles'));
  await fireEvent.press(
    screen.getByTestId('esport-eq-supprimer-roles-confirmer'),
  );
  expect(
    await screen.findByText('2 rôle(s) et 1 salon(s) supprimé(s).'),
  ).toBeTruthy();
});

test('anglais : liste et statut', async () => {
  definirLangue('en');
  const { client } = fauxClient(ficheDe());
  await render(<PageEvenements theme={theme} client={client} large />);
  expect(await screen.findByText('Upcoming')).toBeTruthy();
  expect(
    screen.getByText(/2026-11-21 to 2026-11-22 · 1 team\(s\)/),
  ).toBeTruthy();
});

test('staff de l’événement : catégories de tickets de l’événement et nom du rôle enregistrés ; recherche, ajout (bilan), retrait', async () => {
  const { client, appels } = fauxClient(ficheDe());
  await render(<PageEvenements theme={theme} client={client} large />);
  await fireEvent.press(await screen.findByTestId('esport-ev-ev1'));
  await choisirDans('esport-ev-categories', 'cat1');
  await fireEvent.changeText(screen.getByTestId('esport-ev-staff-modele'), 'Staff {evenement} 2026');
  await fireEvent.press(screen.getByTestId('esport-ev-enregistrer'));
  await screen.findByText('Enregistré.');
  const patch = appels.find(a => a.methode === 'PATCH')!.corps as { categoriesTickets: string[]; discord: { staffModele: string } };
  expect([patch.categoriesTickets, patch.discord.staffModele]).toEqual([['cat1'], 'Staff {evenement} 2026']);
  expect(screen.getByText('Rôle staff pas encore créé')).toBeTruthy();
  await fireEvent.changeText(screen.getByTestId('esport-ev-staff-q'), 'ze');
  await fireEvent.press(screen.getByTestId('esport-ev-staff-chercher'));
  expect(await screen.findByText('Zed · membre de l’app')).toBeTruthy();
  expect(screen.getByText('Zoé · serveur Discord')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('esport-ev-staff-ajouter-810000000000000301'));
  expect(await screen.findByText(/Ajouté au staff\. Rôle staff : 1 attribution\(s\), 2 catégorie\(s\) de tickets, 1 salon\(s\) vocal\(aux\) ouverts\./)).toBeTruthy();
  expect(screen.getByText('Rôle staff créé')).toBeTruthy();
  expect(screen.getByTestId('esport-ev-staff-ajouter-810000000000000301').props.accessibilityState).toMatchObject({ disabled: true });
  await fireEvent.press(screen.getByTestId('esport-ev-staff-810000000000000301-retirer'));
  expect(await screen.findByText('Retiré du staff.')).toBeTruthy();
  expect(screen.queryByTestId('esport-ev-staff-810000000000000301')).toBeNull();
});

test('vocaux de l’événement : rôle staff automatique (ligne et puce), rôles des équipes ; ajout d’un hub (salons par catégorie, salons pris exclus), modification, retrait', async () => {
  const { client, appels } = fauxClient(ficheDe());
  await render(<PageEvenements theme={theme} client={client} large evenementInitial="ev1" />);
  expect((await screen.findByTestId('esport-ev-voc-staff')).props.children).toBe('Le rôle staff de l’événement « Staff The Nuke End » a accès automatiquement à tous les vocaux d’équipe.');
  expect(screen.getByTestId('esport-ev-voc-equipes')).toBeTruthy();
  expect(screen.getByTestId('esport-ev-voc-hub-751-resume').props.children).toBe('Vocal équipe The Nuke End · {tag} — {nom} · places illimitées');
  expect(screen.getByTestId('esport-ev-voc-hub-751-roles').props.children).toBe('Rôles autorisés en plus : Caster');
  expect(screen.getByText('Rôle staff « Staff The Nuke End » · inclus automatiquement')).toBeTruthy();
  // Ajout : salon choisi parmi les vocaux libres (le hub existant et celui d'un autre hub sont exclus).
  await fireEvent.press(screen.getByTestId('esport-ev-voc-ajouter'));
  await deplier('esport-ev-voc-salon');
  expect(screen.queryByTestId('esport-ev-voc-salon-751')).toBeNull();
  expect(screen.queryByTestId('esport-ev-voc-salon-753')).toBeNull();
  await choisirDans('esport-ev-voc-salon', '752');
  await fireEvent.changeText(screen.getByTestId('esport-ev-voc-limite'), '5');
  // Le rôle staff de l'événement n'est pas proposé (il est déjà inclus).
  await deplier('esport-ev-voc-roles');
  expect(screen.queryByTestId('esport-ev-voc-roles-990')).toBeNull();
  expect(screen.getByTestId('esport-ev-voc-staff-puce')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('esport-ev-voc-enregistrer'));
  expect(await screen.findByTestId('esport-ev-voc-hub-752')).toBeTruthy();
  const post = appels.find(a => a.chemin === '/evenements/ev1/vocaux' && a.methode === 'POST')!.corps;
  expect(post).toMatchObject({ id: '752', nom: 'Vocal casters', limite: 5, modeleNom: '{tag} — {nom}', rolesAutorises: [] });
  // Modifier : modèle du nom.
  await fireEvent.press(screen.getByTestId('esport-ev-voc-hub-751-modifier'));
  await fireEvent.changeText(screen.getByTestId('esport-ev-voc-modele'), 'Équipe {tag}');
  await fireEvent.press(screen.getByTestId('esport-ev-voc-enregistrer'));
  expect(await screen.findByText('Hub enregistré.')).toBeTruthy();
  expect(appels.find(a => a.chemin === '/evenements/ev1/vocaux/751' && a.methode === 'PATCH')!.corps).toMatchObject({ id: '751', modeleNom: 'Équipe {tag}', rolesAutorises: ['720000000000000060'] });
  // Retirer (confirmé).
  await fireEvent.press(screen.getByTestId('esport-ev-voc-hub-752-retirer'));
  await fireEvent.press(await screen.findByTestId('esport-ev-voc-hub-752-retirer-confirmer'));
  expect(await screen.findByText('Hub retiré.')).toBeTruthy();
  expect(appels.some(a => a.chemin === '/evenements/ev1/vocaux/752' && a.methode === 'DELETE')).toBe(true);
  expect(screen.queryByTestId('esport-ev-voc-hub-752')).toBeNull();
});

test('vocaux de l’événement : lecture seule sans vocaux.configurer (pas d’ajout ni de retrait, salons du serveur non lus)', async () => {
  const { client, appels } = fauxClient(ficheDe(), undefined, { ...vocauxDe(false), staffRole: null });
  await render(<PageEvenements theme={theme} client={client} large evenementInitial="ev1" />);
  expect(await screen.findByTestId('esport-ev-voc-sans-droit')).toBeTruthy();
  expect(screen.getByTestId('esport-ev-voc-staff').props.children).toMatch(/aura accès automatiquement/);
  expect(screen.getByText('Rôle staff de l’événement · inclus automatiquement')).toBeTruthy();
  expect(screen.queryByTestId('esport-ev-voc-ajouter')).toBeNull();
  expect(screen.queryByTestId('esport-ev-voc-hub-751-retirer')).toBeNull();
  expect(appels.some(a => a.chemin === '/vocaux/discord')).toBe(false);
});

test('supprimer un événement : la confirmation annonce hubs vocaux, salons d’équipe et rôles supprimés, et la désactivation des salons vocaux s’il ne reste aucun hub', async () => {
  const fiche = { ...ficheDe(), suppression: { hubs: 1, desactiveVocaux: true } };
  const { client, appels } = fauxClient(fiche);
  await render(<PageEvenements theme={theme} client={client} large evenementInitial="ev1" />);
  await fireEvent.press(await screen.findByTestId('esport-ev-supprimer'));
  // La fiche est relue avant d'afficher la confirmation (hubs à jour).
  expect((await screen.findByTestId('esport-ev-supprimer-message')).props.children).toBe('Les hubs vocaux, les salons d’équipe et les rôles Discord de l’événement seront aussi supprimés.');
  expect(screen.getByTestId('esport-ev-supprimer-hubs').props.children).toBe('1 hub(s) vocal(aux) de l’événement retiré(s) des salons vocaux temporaires.');
  expect(screen.getByText('C’est le seul hub du serveur : les salons vocaux temporaires seront désactivés.')).toBeTruthy();
  // Annuler : rien n'est supprimé.
  await fireEvent.press(screen.getByTestId('esport-ev-supprimer-annuler'));
  expect(screen.queryByTestId('esport-ev-supprimer-message')).toBeNull();
  expect(appels.some(a => a.methode === 'DELETE' && a.chemin === '/evenements/ev1')).toBe(false);
  // Confirmer : supprimé, retour à la liste.
  await fireEvent.press(screen.getByTestId('esport-ev-supprimer'));
  await fireEvent.press(await screen.findByTestId('esport-ev-supprimer-confirmer'));
  expect(await screen.findByText('Événement supprimé.')).toBeTruthy();
  expect(appels.some(a => a.methode === 'DELETE' && a.chemin === '/evenements/ev1')).toBe(true);
  expect(await screen.findByTestId('esport-ev-nouveau')).toBeTruthy();
});

test('supprimer un événement sans hub vocal : message général seulement (pas de désactivation annoncée)', async () => {
  const fiche = { ...ficheDe(), suppression: { hubs: 0, desactiveVocaux: false } };
  const { client } = fauxClient(fiche);
  await render(<PageEvenements theme={theme} client={client} large evenementInitial="ev1" />);
  await fireEvent.press(await screen.findByTestId('esport-ev-supprimer'));
  expect(await screen.findByTestId('esport-ev-supprimer-message')).toBeTruthy();
  expect(screen.queryByTestId('esport-ev-supprimer-hubs')).toBeNull();
  expect(screen.queryByTestId('esport-ev-supprimer-desactive')).toBeNull();
});

test('rôles staff supplémentaires : rôle existant (confirmation « sera SUPPRIMÉ », désactivable), rôles dangereux grisés, libellé ; enregistrés', async () => {
  const { client, appels } = fauxClient(ficheDe());
  await render(<PageEvenements theme={theme} client={client} large evenementInitial="ev1" />);
  await fireEvent.press(await screen.findByTestId('esport-ev-staff-roles-sup-lire'));
  await deplier('esport-ev-staff-sup-choisir');
  // Rôle du bot absent ; rôle avec Administrateur grisé, avec la raison.
  expect(screen.queryByTestId('esport-ev-staff-sup-choisir-720000000000000002')).toBeNull();
  expect(screen.getByTestId('esport-ev-staff-sup-choisir-720000000000000004').props.accessibilityState).toMatchObject({ disabled: true });
  expect(screen.getByText(/Admin · Administrateur, Gérer le serveur ou Gérer les rôles : impossible/)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('esport-ev-staff-sup-choisir-720000000000000001'));
  expect(screen.getByText(/« Staff » sera SUPPRIMÉ de Discord à la fin de l’événement, pour tous ses membres/)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('esport-ev-staff-sup-confirmer'));
  expect(screen.getByTestId('esport-ev-staff-sup-720000000000000001-supprimer').props.value).toBe(true);
  expect(screen.getByTestId('esport-ev-staff-sup-720000000000000001-alerte')).toBeTruthy();
  // Désactivable ; libellé (exemple dérivé du nom).
  await fireEvent(screen.getByTestId('esport-ev-staff-sup-720000000000000001-supprimer'), 'valueChange', false);
  expect(screen.queryByTestId('esport-ev-staff-sup-720000000000000001-alerte')).toBeNull();
  expect(screen.getByTestId('esport-ev-staff-sup-720000000000000001-label').props.placeholder).toBe('Staff');
  await fireEvent.changeText(screen.getByTestId('esport-ev-staff-sup-720000000000000001-label'), 'Orga');
  // Deuxième rôle, ajouté sans le supprimer.
  await choisirDans('esport-ev-staff-sup-choisir', '720000000000000003');
  await fireEvent.press(screen.getByTestId('esport-ev-staff-sup-garder'));
  await fireEvent.press(screen.getByTestId('esport-ev-enregistrer'));
  expect(await screen.findByText('Enregistré.')).toBeTruthy();
  const patch = appels.filter(a => a.chemin === '/evenements/ev1' && a.methode === 'PATCH').at(-1)!.corps as { discord: { staffRolesSup: unknown[] } };
  expect(patch.discord.staffRolesSup).toEqual([
    { id: '720000000000000001', label: 'Orga', supprimerFin: false },
    { id: '720000000000000003', label: '', supprimerFin: false },
  ]);
});

test('« Créer un rôle staff » : nom, couleur, libellé (exemple dérivé), membres du staff ; la confirmation de suppression liste les rôles supprimés', async () => {
  const fiche = { ...ficheDe(), staff: [{ id: 's0', discordId: '810000000000000301', nom: 'Zed', compteId: null, roleStatut: 'attribue' as const }], suppression: { hubs: 0, desactiveVocaux: false, roles: [{ id: '990', nom: 'Staff The Nuke End', quoi: 'staff' as const }, { id: '991', nom: 'Casteur The Nuke End', quoi: 'staff-cree' as const }, { id: '992', nom: 'LZ0 Ligne Zéro', quoi: 'equipe' as const }] } };
  const { client, appels } = fauxClient(fiche);
  await render(<PageEvenements theme={theme} client={client} large evenementInitial="ev1" />);
  await fireEvent.press(await screen.findByTestId('esport-ev-staff-sup-nouveau'));
  await fireEvent.changeText(screen.getByTestId('esport-ev-staff-sup-nom'), '⟡ Casteur The Nuke End ⟡');
  expect(screen.getByTestId('esport-ev-staff-sup-nouveau-label').props.placeholder).toBe('Casteur');
  await fireEvent.changeText(screen.getByTestId('esport-ev-staff-sup-couleur'), '#e4572e');
  await choisirDans('esport-ev-staff-sup-nouveau-membres', '810000000000000301');
  await fireEvent.press(screen.getByTestId('esport-ev-staff-sup-creer'));
  expect(await screen.findByText('Rôle staff créé.')).toBeTruthy();
  expect(appels.find(a => a.chemin === '/evenements/ev1/staff-roles')!.corps).toEqual({ nom: '⟡ Casteur The Nuke End ⟡', couleur: '#e4572e', label: '', membres: ['810000000000000301'] });
  // Fin de l'événement (« Supprimer les rôles ») et suppression : la liste exacte des rôles supprimés.
  expect(screen.getByTestId('esport-eq-roles-a-supprimer').props.children).toBe('Rôles Discord supprimés : Staff The Nuke End, Casteur The Nuke End, LZ0 Ligne Zéro.');
  await fireEvent.press(screen.getByTestId('esport-ev-supprimer'));
  expect((await screen.findByTestId('esport-ev-supprimer-roles')).props.children).toBe('Rôles Discord supprimés : Staff The Nuke End, Casteur The Nuke End, LZ0 Ligne Zéro.');
});

test('vocaux de l’événement : options du hub (sous le hub, visibles mais pas joignables, hub caché par défaut) et nom du salon du staff envoyés', async () => {
  const { client, appels } = fauxClient(ficheDe());
  await render(<PageEvenements theme={theme} client={client} large evenementInitial="ev1" />);
  await fireEvent.press(await screen.findByTestId('esport-ev-voc-ajouter'));
  expect(screen.getByTestId('esport-ev-voc-options-placer').props.value).toBe(true);
  expect(screen.getByTestId('esport-ev-voc-options-visible').props.value).toBe(false);
  expect(screen.getByTestId('esport-ev-voc-options-masquer').props.value).toBe(true);
  expect(screen.queryByTestId('esport-ev-voc-options-roles-hub-selecteur')).toBeNull();
  await choisirDans('esport-ev-voc-salon', '752');
  await fireEvent(screen.getByTestId('esport-ev-voc-options-visible'), 'valueChange', true);
  await fireEvent(screen.getByTestId('esport-ev-voc-options-placer'), 'valueChange', false);
  await fireEvent.changeText(screen.getByTestId('esport-ev-voc-modele-staff'), 'Régie {pseudo}');
  await fireEvent.press(screen.getByTestId('esport-ev-voc-enregistrer'));
  expect(await screen.findByTestId('esport-ev-voc-hub-752')).toBeTruthy();
  expect(appels.find(a => a.chemin === '/evenements/ev1/vocaux' && a.methode === 'POST')!.corps).toMatchObject({ id: '752', placerSousHub: false, visibleNonJoignable: true, masquerHub: true, modeleStaff: 'Régie {pseudo}' });
});

test('vocaux de l’événement : libellé de chaque rôle autorisé en plus ({role} du salon du staff), exemple dérivé du nom', async () => {
  const { client, appels } = fauxClient(ficheDe());
  await render(<PageEvenements theme={theme} client={client} large evenementInitial="ev1" />);
  await fireEvent.press(await screen.findByTestId('esport-ev-voc-hub-751-modifier'));
  const champ = await screen.findByTestId('esport-ev-voc-libelles-720000000000000060');
  expect(champ.props.placeholder).toBe('Caster');
  await fireEvent.changeText(champ, 'Cast');
  await fireEvent.press(screen.getByTestId('esport-ev-voc-enregistrer'));
  expect(await screen.findByText('Hub enregistré.')).toBeTruthy();
  expect(appels.find(a => a.chemin === '/evenements/ev1/vocaux/751' && a.methode === 'PATCH')!.corps).toMatchObject({ etiquettes: { '720000000000000060': 'Cast' } });
});

test('Site LigneZero : tournoi du site lié, équipes synchronisées, fiche relue', async () => {
  const { client, appels } = fauxClient(ficheDe());
  await render(<PageEvenements theme={theme} client={client} large evenementInitial="ev1" />);
  await fireEvent.press(await screen.findByTestId('esport-ev-site-tournoi-tn1'));
  await fireEvent.press(screen.getByTestId('esport-ev-site-lier'));
  expect(await screen.findByText('Lien enregistré, équipes synchronisées.')).toBeTruthy();
  expect(appels.find(a => a.chemin === '/evenements/ev1/site' && a.methode === 'PUT')!.corps).toEqual({ tournoiId: 'tn1' });
  expect(screen.getByTestId('esport-ev-site-dernier')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('esport-ev-site-synchro'));
  expect(await screen.findByText('Synchronisé avec le site.')).toBeTruthy();
  expect(appels.filter(a => a.chemin === '/evenements/ev1' && !a.methode).length).toBeGreaterThan(1);
});

test('salons de match : réglages (activé, catégorie, délai, rappels, langue) enregistrés', async () => {
  const { client, appels } = fauxClient(ficheDe());
  await render(<PageEvenements theme={theme} client={client} large evenementInitial="ev1" />);
  expect(await screen.findByTestId('esport-ev-salons-match')).toBeTruthy();
  await fireEvent(screen.getByTestId('esport-ev-sm-actif'), 'valueChange', true);
  await choisirDans('esport-ev-sm-categorie', '700000000000000060');
  await fireEvent.changeText(screen.getByTestId('esport-ev-sm-delai'), '45 min');
  expect(screen.getByText('Rappel 10 min avant')).toBeTruthy();
  await fireEvent(screen.getByTestId('esport-ev-sm-rappels'), 'valueChange', false);
  await fireEvent.press(screen.getByTestId('esport-ev-sm-langue-fr_en'));
  await fireEvent.changeText(screen.getByTestId('esport-ev-sm-modele'), '{phase}-{equipes}');
  await fireEvent.press(screen.getByTestId('esport-ev-sm-enregistrer'));
  expect(await screen.findByText('Réglages des salons de match enregistrés.')).toBeTruthy();
  expect(appels.find(a => a.chemin === '/evenements/ev1/salons-match' && a.methode === 'PUT')!.corps).toEqual({ actif: true, categorieId: '700000000000000060', modeleNom: '{phase}-{equipes}', delaiSuppressionMin: 45, rappels: false, langue: 'fr_en', avanceH: 0, retentionJours: 0, ancreId: null });
  expect(screen.getByTestId('esport-ev-sm-dernier')).toBeTruthy();
});

test('salons de match : liste (statut, équipe sans rôle, suppression programmée), créer, supprimer maintenant, historique', async () => {
  const { client, appels } = fauxClient(ficheDe());
  await render(<PageEvenements theme={theme} client={client} large evenementInitial="ev1" />);
  expect(await screen.findByTestId('esport-ev-sm-salon-sm1')).toBeTruthy();
  expect(screen.getByText('Upper bracket · Round 1 · Match 1')).toBeTruthy();
  expect(screen.getByText('[LZ0] Ligne Zéro - [DLT] Delta (sans rôle Discord)')).toBeTruthy();
  expect(screen.getByTestId('esport-ev-sm-salon-sm1-statut')).toBeTruthy();
  expect(screen.getByText('terminé')).toBeTruthy();
  expect(screen.getByTestId('esport-ev-sm-salon-sm1-dates').props.children).toMatch(/suppression : /);
  expect(screen.getByTestId('esport-ev-sm-salon-sm1-ouvrir')).toBeTruthy();
  expect(screen.getByTestId('esport-ev-sm-salon-sm1-staff').props.children).toBe('Staff assigné : Arbitre, Ghost (introuvable sur Discord)');
  expect(screen.queryByTestId('esport-ev-sm-salon-sm1-historique')).toBeNull();
  // Match du site sans salon : « Créer maintenant ».
  await fireEvent.press(screen.getByTestId('esport-ev-sm-match-l:55555555-5555-4555-8555-000000000001-creer'));
  expect(await screen.findByText('Salon créé.')).toBeTruthy();
  expect(appels.find(a => a.chemin === '/evenements/ev1/salons-match/creer')!.corps).toEqual({ cle: 'l:55555555-5555-4555-8555-000000000001' });
  expect(screen.getByTestId('esport-ev-sm-salon-sm2')).toBeTruthy();
  // Supprimer maintenant (confirmé), puis l'historique.
  await fireEvent.press(screen.getByTestId('esport-ev-sm-salon-sm1-supprimer'));
  await fireEvent.press(screen.getByTestId('esport-ev-sm-salon-sm1-supprimer-confirmer'));
  expect(await screen.findByText('Salon supprimé, historique enregistré.')).toBeTruthy();
  expect(screen.queryByTestId('esport-ev-sm-salon-sm1-ouvrir')).toBeNull();
  await fireEvent.press(screen.getByTestId('esport-ev-sm-salon-sm1-historique'));
  expect(await screen.findByTestId('esport-ev-sm-historique')).toBeTruthy();
  expect(screen.getByText('Prêts !')).toBeTruthy();
  expect(screen.getByText('Pièce jointe : lineup.png')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('esport-ev-sm-historique-fermer'));
  expect(screen.queryByTestId('esport-ev-sm-historique')).toBeNull();
});

test('salons de match : anglais, événement non lié au site', async () => {
  definirLangue('en');
  salonsMatch.lie = false;
  salonsMatch.salons = [];
  salonsMatch.matchs = [];
  const { client } = fauxClient(ficheDe());
  await render(<PageEvenements theme={theme} client={client} large evenementInitial="ev1" />);
  expect(await screen.findByText('Match channels')).toBeTruthy();
  expect(screen.getByTestId('esport-ev-sm-non-lie')).toBeTruthy();
  expect(screen.getByText('No match channel yet.')).toBeTruthy();
  expect(screen.queryByTestId('esport-ev-sm-synchro')).toBeNull();
});

test('salons de match : « Placer sous le salon » (salons écrits par catégorie), catégorie dérivée en lecture seule, retiré → catégorie', async () => {
  const { client, appels } = fauxClient(ficheDe());
  await render(<PageEvenements theme={theme} client={client} large evenementInitial="ev1" />);
  expect(await screen.findByTestId('esport-ev-sm-categorie-modifier')).toBeTruthy();
  await choisirDans('esport-ev-sm-ancre', '700000000000000070');
  expect(screen.queryByTestId('esport-ev-sm-categorie-modifier')).toBeNull();
  expect(screen.getByTestId('esport-ev-sm-categorie-ancre').props.children).toBe('Catégorie : Matchs (celle du salon choisi)');
  await fireEvent.press(screen.getByTestId('esport-ev-sm-enregistrer'));
  expect(await screen.findByText('Réglages des salons de match enregistrés.')).toBeTruthy();
  expect(appels.find(a => a.chemin === '/evenements/ev1/salons-match' && a.methode === 'PUT')!.corps).toMatchObject({ ancreId: '700000000000000070' });
  // Salon hors catégorie.
  await choisirDans('esport-ev-sm-ancre', '700000000000000071');
  expect(screen.getByTestId('esport-ev-sm-categorie-ancre').props.children).toBe('Catégorie : aucune (hors catégorie) (celle du salon choisi)');
  // Retiré : le sélecteur de catégorie revient.
  await choisirDans('esport-ev-sm-ancre', '-');
  expect(screen.getByTestId('esport-ev-sm-categorie-modifier')).toBeTruthy();
});
