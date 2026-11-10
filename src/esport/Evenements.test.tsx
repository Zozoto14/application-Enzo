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
} from './evenements/api';
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

function fauxClient(
  fiche: FicheEvenement,
  liste: Evenement[] = [{ ...fiche.evenement, equipes: 1 }],
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
        ],
      };
    if (chemin === '/evenements/ev1' && !methode) return fiche;
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
  expect(await screen.findByTestId('esport-ev-hubs')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('esport-ev-position-lire'));
  await deplier('esport-ev-position');
  const bot = await screen.findByTestId(
    'esport-ev-position-720000000000000002',
  );
  expect(bot.props.accessibilityState).toMatchObject({ disabled: true });
  expect(screen.getByText('rôle du bot')).toBeTruthy();
  // Ordre de la hiérarchie : Esport HQ, Staff, Membre, puis « Tout en bas ».
  const ids = screen
    .getAllByRole('radio')
    .map(n => String(n.props.testID))
    .filter(id => id.startsWith('esport-ev-position-'));
  expect(ids).toEqual([
    'esport-ev-position-720000000000000002',
    'esport-ev-position-720000000000000001',
    'esport-ev-position-720000000000000003',
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
