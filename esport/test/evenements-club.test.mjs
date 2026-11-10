/**
 * Événements organisés par le club (Administration › Événements, evenements-club/, migration 0064) : création et
 * droits (evenements.gerer), lecture des inscriptions (tickets), import, rôles AUTOMATIQUES à l'ajout d'une équipe
 * (création, position sous le rôle repère : charge PATCH, refus d'un repère au-dessus du bot), membres ajoutés /
 * retirés, équipe renommée ou retirée, resynchronisation, nettoyage de fin (bouton, cron), reprise des tables de la
 * migration 0063, hub vocal lié à un événement ; export et RGPD. Faux Discord REST, jamais de réseau réel.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { bancTickets } from './tickets-aide.mjs';
import { baseVierge, lireMigrations } from './base.mjs';
import { appliquerMigrations } from '../noyau/migrations.mjs';
import {
  lireLigneMembre,
  lireReponsesInscription,
  nomRole,
} from '../noyau/evenements-club/inscriptions.mjs';
import {
  positionsSous,
  tachesEvenementsDiscord,
} from '../noyau/evenements-club/discord.mjs';
import { effacementParDiscord } from '../noyau/tickets/rgpd.mjs';
import { TABLES, reprendreTablesTournoi } from '../noyau/transfert.mjs';

const J1 = '810000000000000101';
const J2 = '810000000000000102';
const J3 = '810000000000000103';
const COACH = '810000000000000104';
const ABSENT = '810000000000000199';
const STAFF_R = '720000000000000001';
const BOT_R = '720000000000000002';

async function monter({ corps = {} } = {}) {
  const k = await bancTickets({ banc });
  await k.api('/tickets/config/general', undefined, {
    methode: 'PUT',
    corps: { guildId: k.GUILD, guildNom: 'Club' },
  });
  const e = await k.api('/evenements', undefined, {
    methode: 'POST',
    corps: {
      nom: 'The Nuke End',
      debut: '2026-11-21',
      fin: '2026-11-22',
      ...corps,
    },
  });
  assert.equal(e.statut, 200, JSON.stringify(e.corps));
  const id = e.corps.evenement.id;
  return { ...k, id, chemin: `/evenements/${id}`, fiche: e.corps };
}

async function ticketInscription(
  k,
  categorieId,
  numero,
  reponses,
  statut = 'resolu',
) {
  const t = '2026-11-10T10:00:00.000Z';
  await k.b.base.executer(
    "INSERT INTO tickets (id, numero, categorie_id, statut, priorite, auteur_discord_id, auteur_nom, langue, reponses, ouvert_le, maj_le, derniere_activite_le, liaison) VALUES (?, ?, ?, ?, 'moyen', ?, 'Capitaine', 'fr', ?, ?, ?, ?, '{}')",
    [
      `00000000-0000-4000-8000-00000000000${numero}`,
      numero,
      categorieId,
      statut,
      J1,
      JSON.stringify(reponses),
      t,
      t,
      t,
    ],
  );
}

const creationsRoles = k =>
  k.discord.appels.filter(
    a => a.methode === 'POST' && a.chemin === `/guilds/${k.GUILD}/roles`,
  );
const patchsPositions = k =>
  k.discord.appels.filter(
    a => a.methode === 'PATCH' && a.chemin === `/guilds/${k.GUILD}/roles`,
  );

test('événements : création, liste, modification, validation ; droits (evenements.gerer, Fondateur)', async () => {
  const k = await monter({ corps: { jeu: 'valorant', statut: 'a_venir' } });
  assert.deepEqual(
    [
      k.fiche.evenement.nom,
      k.fiche.evenement.statut,
      k.fiche.evenement.discord.rolesAuto,
      k.fiche.evenement.discord.suppressionH,
      k.fiche.evenement.discord.modeleRole,
    ],
    ['The Nuke End', 'a_venir', true, 24, '{tag} {nom}'],
  );
  const l = await k.api('/evenements');
  assert.deepEqual(
    l.corps.evenements.map(e => [e.nom, e.equipes]),
    [['The Nuke End', 0]],
  );
  assert.ok(l.corps.choix.statuts.includes('annule'));
  const m = await k.api(k.chemin, undefined, {
    methode: 'PATCH',
    corps: {
      statut: 'en_cours',
      discord: { couleur: '#E4572E', suppressionH: 12 },
    },
  });
  assert.equal(m.statut, 200, JSON.stringify(m.corps));
  assert.deepEqual(
    [
      m.corps.evenement.statut,
      m.corps.evenement.discord.couleur,
      m.corps.evenement.discord.suppressionH,
    ],
    ['en_cours', '#e4572e', 12],
  );
  assert.equal(
    (
      await k.api(k.chemin, undefined, {
        methode: 'PATCH',
        corps: { fin: '2026-11-01' },
      })
    ).statut,
    400,
    'fin avant début',
  );
  assert.equal(
    (
      await k.api(k.chemin, undefined, {
        methode: 'PATCH',
        corps: { statut: 'bof' },
      })
    ).statut,
    400,
  );
  assert.equal(
    (
      await k.api(k.chemin, undefined, {
        methode: 'PATCH',
        corps: { discord: { modeleRole: 'Equipe' } },
      })
    ).statut,
    400,
  );
  assert.equal(
    (
      await k.api('/evenements', undefined, {
        methode: 'POST',
        corps: { nom: '' },
      })
    ).statut,
    400,
  );
  // Droits : sans evenements.gerer, rien ; avec, tout.
  const sans = await k.compteAvec('tick1234', 'Tick', ['tickets.voir']);
  assert.equal((await k.api('/evenements', sans.jeton)).statut, 403);
  assert.equal((await k.api(k.chemin, sans.jeton)).statut, 403);
  const avec = await k.compteAvec('ceo12345', 'Ceo', ['evenements.gerer']);
  assert.equal((await k.api(k.chemin, avec.jeton)).statut, 200);
  const moi = await k.api('/moi', avec.jeton);
  assert.equal(moi.corps.peutGererEvenements, true);
  // Suppression.
  const autre = await k.api('/evenements', undefined, {
    methode: 'POST',
    corps: { nom: 'LAN' },
  });
  assert.equal(
    (
      await k.api(`/evenements/${autre.corps.evenement.id}`, avec.jeton, {
        methode: 'DELETE',
      })
    ).statut,
    200,
  );
  assert.equal(
    (await k.api(`/evenements/${autre.corps.evenement.id}`)).statut,
    404,
  );
});

test('lecture d’une ligne : Discord ID, mention, @pseudo, Embark ID, puces et séparateurs', () => {
  assert.deepEqual(lireLigneMembre(`${J1} — Kira#1234`), {
    poste: 'joueur',
    discordId: J1,
    nom: '',
    embarkId: 'Kira#1234',
    brut: `${J1} — Kira#1234`,
  });
  assert.deepEqual(
    {
      ...lireLigneMembre(`1. <@!${J2}> - Nox#0042`, 'remplacant'),
      brut: undefined,
    },
    {
      poste: 'remplacant',
      discordId: J2,
      nom: '',
      embarkId: 'Nox#0042',
      brut: undefined,
    },
  );
  const p = lireLigneMembre('Joueur 3 : @zoe | Zoe#9876');
  assert.deepEqual([p.discordId, p.nom, p.embarkId], [null, 'zoe', 'Zoe#9876']);
  const q = lireLigneMembre(`Discord: ${J3} Embark: Max#1111`);
  assert.deepEqual([q.discordId, q.nom, q.embarkId], [J3, '', 'Max#1111']);
});

test('lecture des réponses du formulaire « Inscription The Nuke End » ; problèmes signalés', () => {
  const r = lireReponsesInscription([
    {
      id: 'equipe',
      libelle: { fr: 'Nom de l’équipe' },
      valeur: ' Ligne  Zéro ',
    },
    { id: 'tag', libelle: { fr: 'TAG' }, valeur: 'lz0' },
    {
      id: 'joueurs',
      libelle: { fr: 'Joueurs 1 à 3' },
      valeur: `${J1} — Kira#1234\n<@${J2}> - Nox#0042\n@zoe — Zoe#9876`,
    },
    { id: 'coach', libelle: { fr: 'Coach' }, valeur: `${COACH} — Coach#0001` },
    { id: 'remplacants', libelle: { fr: 'Remplaçants' }, valeur: 'aucun' },
  ]);
  assert.deepEqual([r.nom, r.tag], ['Ligne Zéro', 'LZ0']);
  assert.deepEqual(
    r.membres.map(m => [m.poste, m.discordId]),
    [
      ['joueur', J1],
      ['joueur', J2],
      ['joueur', null],
      ['coach', COACH],
    ],
  );
  assert.deepEqual(r.problemes, ['sans_id']);
  // Libellés seulement (autre formulaire), anglais.
  const en = lireReponsesInscription([
    { id: 'a', libelle: { en: 'Team name' }, valeur: 'Alpha' },
    { id: 'b', libelle: { en: 'Team TAG' }, valeur: 'ALP' },
    { id: 'c', libelle: { en: 'Players' }, valeur: J1 },
    { id: 'd', libelle: { en: 'Subs' }, valeur: J2 },
  ]);
  assert.deepEqual(
    [en.nom, en.tag, en.membres.map(m => m.poste)],
    ['Alpha', 'ALP', ['joueur', 'remplacant']],
  );
  assert.deepEqual(lireReponsesInscription([]).problemes, [
    'nom',
    'tag',
    'joueurs',
  ]);
  assert.equal(
    nomRole('{tag} {nom}', { tag: 'LZ0', nom: 'Ligne Zéro' }),
    'LZ0 Ligne Zéro',
  );
  assert.equal(nomRole('[{tag}] @everyone', { tag: 'A' }), '[A] everyone');
});

test('import depuis les tickets : propositions ; équipes importées → rôles créés AUTOMATIQUEMENT et donnés aux présents', async () => {
  const k = await monter();
  const cat = await k.api('/tickets/config/categories', undefined, {
    methode: 'POST',
    corps: {
      nom: { fr: 'Inscription The Nuke End', en: 'The Nuke End registration' },
      modeleNom: 'nuke-{numero}',
    },
  });
  const categorieId = cat.corps.id;
  await k.api(k.chemin, undefined, {
    methode: 'PATCH',
    corps: { categorieTicketId: categorieId },
  });
  k.discord.etat.absents.add(ABSENT);
  await ticketInscription(k, categorieId, 1, [
    { id: 'equipe', valeur: 'Ligne Zéro' },
    { id: 'tag', valeur: 'LZ0' },
    {
      id: 'joueurs',
      valeur: `${J1} — Kira#1234\n${ABSENT} — Ghost#0000\n@Zoé — Zoe#9876`,
    },
    { id: 'coach', valeur: '' },
  ]);
  await ticketInscription(
    k,
    categorieId,
    2,
    [
      { id: 'equipe', valeur: 'Bravo' },
      { id: 'tag', valeur: 'BRV' },
      { id: 'joueurs', valeur: `${J2}\n${J3}\n@inconnu` },
    ],
    'ouvert',
  );
  const i = await k.api(`${k.chemin}/import`, undefined, {
    methode: 'POST',
    corps: {},
  });
  assert.equal(i.statut, 200, JSON.stringify(i.corps));
  const [a, b] = i.corps.propositions;
  assert.deepEqual(
    [a.numero, a.nom, a.tag, a.statut],
    [1, 'Ligne Zéro', 'LZ0', 'resolu'],
  );
  assert.deepEqual(
    a.membres.map(m => m.present),
    [true, false, true],
  );
  assert.equal(
    a.membres[2].discordId,
    '800000000000000077',
    'Zoé trouvée par son nom affiché exact',
  );
  assert.deepEqual(a.problemes, ['absents']);
  assert.deepEqual(b.problemes, ['sans_id']);
  const e = await k.api(`${k.chemin}/equipes`, undefined, {
    methode: 'POST',
    corps: {
      equipes: [
        {
          nom: a.nom,
          tag: a.tag,
          ticketId: a.ticketId,
          membres: a.membres.map(({ poste, discordId, nom, embarkId }) => ({
            poste,
            discordId,
            nom,
            embarkId,
          })),
        },
        {
          nom: 'Bravo',
          tag: 'BRV',
          ticketId: b.ticketId,
          membres: [
            { poste: 'joueur', discordId: J2 },
            { poste: 'coach', discordId: COACH },
            { poste: 'joueur', nom: 'Sans ID' },
          ],
        },
      ],
    },
  });
  assert.equal(e.statut, 200, JSON.stringify(e.corps));
  // Rôles automatiques : un par équipe, modèle, non mentionnable, sans permission ; donnés aux présents.
  assert.deepEqual(
    creationsRoles(k).map(c => [
      c.corps.name,
      c.corps.mentionable,
      c.corps.permissions,
    ]),
    [
      ['LZ0 Ligne Zéro', false, '0'],
      ['BRV Bravo', false, '0'],
    ],
  );
  assert.equal(e.corps.discord.erreur, null);
  assert.deepEqual(
    [e.corps.discord.bilan.creees, e.corps.discord.bilan.attribues],
    [2, 4],
  );
  assert.deepEqual(
    e.corps.discord.bilan.absents.map(x => x.discordId),
    [ABSENT],
  );
  assert.deepEqual(
    e.corps.discord.bilan.sansId.map(x => x.nom),
    ['Sans ID'],
  );
  const lz = e.corps.equipes.find(x => x.tag === 'LZ0');
  assert.ok(lz.roleId);
  assert.deepEqual(
    lz.membres.map(m => m.roleStatut),
    ['attribue', 'absent', 'attribue'],
  );
  assert.ok(e.corps.evenement.discord.rolesCreesLe);
  // Deuxième import : déjà là ; TAG en double et Discord ID invalide refusés.
  assert.deepEqual(
    (
      await k.api(`${k.chemin}/import`, undefined, {
        methode: 'POST',
        corps: { categorieId },
      })
    ).corps.propositions.map(p => p.deja),
    [true, true],
  );
  assert.equal(
    (
      await k.api(`${k.chemin}/equipes`, undefined, {
        methode: 'POST',
        corps: { nom: 'Copie', tag: 'lz0' },
      })
    ).statut,
    409,
  );
  assert.equal(
    (
      await k.api(`${k.chemin}/equipes`, undefined, {
        methode: 'POST',
        corps: { nom: 'X', tag: 'XX', membres: [{ discordId: '123' }] },
      })
    ).statut,
    400,
  );
  // L'import exige de voir la catégorie de tickets.
  const ceo = await k.compteAvec('ceo12345', 'Ceo', ['evenements.gerer']);
  assert.equal(
    (
      await k.api(`${k.chemin}/import`, ceo.jeton, {
        methode: 'POST',
        corps: { categorieId },
      })
    ).statut,
    403,
  );
});

test('rôles automatiques : membre ajouté / retiré, équipe renommée, équipe retirée (rôle supprimé) ; rôles coupés', async () => {
  const k = await monter();
  const e = await k.api(`${k.chemin}/equipes`, undefined, {
    methode: 'POST',
    corps: {
      nom: 'Ligne Zéro',
      tag: 'LZ0',
      membres: [{ discordId: J1 }, { discordId: J2 }],
    },
  });
  const lz = e.corps.equipes[0];
  const roleId = lz.roleId;
  assert.ok(roleId);
  // Membre retiré (J2) et ajouté (J3) ; équipe renommée : le rôle suit.
  const m = await k.api(`${k.chemin}/equipes/${lz.id}`, undefined, {
    methode: 'PATCH',
    corps: {
      nom: 'Ligne Un',
      tag: 'LZ1',
      membres: [{ discordId: J1 }, { discordId: J3 }],
    },
  });
  assert.equal(m.statut, 200, JSON.stringify(m.corps));
  assert.ok(
    k.discord.appels.some(
      a =>
        a.methode === 'DELETE' &&
        a.chemin === `/guilds/${k.GUILD}/members/${J2}/roles/${roleId}`,
    ),
    'rôle retiré à J2',
  );
  assert.ok(
    k.discord.appels.some(
      a =>
        a.methode === 'PUT' &&
        a.chemin === `/guilds/${k.GUILD}/members/${J3}/roles/${roleId}`,
    ),
    'rôle donné à J3',
  );
  assert.equal(
    k.discord.appels.filter(
      a =>
        a.methode === 'PUT' &&
        a.chemin === `/guilds/${k.GUILD}/members/${J1}/roles/${roleId}`,
    ).length,
    1,
    'J1 pas rattribué',
  );
  assert.equal(k.discord.etat.roles.get(roleId).name, 'LZ1 Ligne Un');
  assert.deepEqual(
    [
      m.corps.discord.bilan.renommees,
      m.corps.discord.bilan.retires,
      m.corps.discord.bilan.attribues,
    ],
    [1, 1, 1],
  );
  // Modèle changé dans les réglages : renommé aussi.
  await k.api(k.chemin, undefined, {
    methode: 'PATCH',
    corps: { discord: { modeleRole: '[{tag}] {nom}' } },
  });
  assert.equal(k.discord.etat.roles.get(roleId).name, '[LZ1] Ligne Un');
  // Équipe retirée : rôle supprimé.
  const s = await k.api(`${k.chemin}/equipes/${lz.id}`, undefined, {
    methode: 'DELETE',
  });
  assert.equal(s.statut, 200);
  assert.ok(!k.discord.etat.roles.has(roleId));
  assert.equal(s.corps.equipes.length, 0);
  // Rôles automatiques coupés : l'équipe s'enregistre sans rôle ; « Resynchroniser » le crée.
  await k.api(k.chemin, undefined, {
    methode: 'PATCH',
    corps: { discord: { rolesAuto: false } },
  });
  const n = creationsRoles(k).length;
  const b = await k.api(`${k.chemin}/equipes`, undefined, {
    methode: 'POST',
    corps: { nom: 'Bravo', tag: 'BRV', membres: [{ discordId: J2 }] },
  });
  assert.equal(creationsRoles(k).length, n);
  assert.equal(b.corps.equipes[0].roleId, null);
  const r = await k.api(`${k.chemin}/roles`, undefined, {
    methode: 'POST',
    corps: {},
  });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.deepEqual(
    [r.corps.discord.bilan.creees, r.corps.discord.bilan.attribues],
    [1, 1],
  );
  // Rôle du bot trop bas pour attribuer : refus expliqué (403, Missing Permissions).
  await k.api(`${k.chemin}/equipes`, undefined, {
    methode: 'POST',
    corps: { nom: 'Charlie', tag: 'CHR', membres: [] },
  });
  const chr = (await k.api(k.chemin)).corps.equipes.find(x => x.tag === 'CHR');
  k.discord.programme.push({
    si: (mm, c) => mm === 'PUT' && c.includes(`/members/${J3}/roles/`),
    statut: 403,
    corps: { code: 50013, message: 'Missing Permissions' },
  });
  await k.api(k.chemin, undefined, {
    methode: 'PATCH',
    corps: { discord: { rolesAuto: true } },
  });
  const c = await k.api(`${k.chemin}/equipes/${chr.id}`, undefined, {
    methode: 'PATCH',
    corps: { membres: [{ discordId: J3 }] },
  });
  assert.deepEqual(
    c.corps.discord.bilan.refus.map(x => [x.quoi, x.code]),
    [['attribution', 50013]],
  );
});

test('position : rôles placés juste en dessous du rôle choisi (charge PATCH) ; repère au-dessus du bot refusé', async () => {
  // Calcul pur : Membre (3), Staff (6), Esport HQ (7) ; deux rôles d'équipe nés en bas (1, 2).
  const roles = [
    { id: 'a', position: 1 },
    { id: 'b', position: 2 },
    { id: 'membre', position: 3 },
    { id: 'x', position: 4 },
    { id: 'y', position: 5 },
    { id: 'staff', position: 6 },
    { id: 'bot', position: 7 },
  ];
  const charge = positionsSous(roles, 'staff', ['a', 'b']);
  const finale = new Map(roles.map(r => [r.id, r.position]));
  for (const c of charge) finale.set(c.id, c.position);
  const ordre = [...finale].sort((p, q) => q[1] - p[1]).map(([id]) => id);
  assert.deepEqual(ordre, ['bot', 'staff', 'a', 'b', 'y', 'x', 'membre']);
  assert.ok(
    !charge.some(c => ['bot', 'staff'].includes(c.id)),
    'ni le repère ni le bot ne bougent',
  );
  assert.deepEqual(positionsSous(roles, 'inconnu', ['a']), []);

  const k = await monter();
  k.discord.etat.listerCrees = true;
  // Comme sur Discord, les rôles créés naissent en bas et poussent les autres vers le haut : Staff 5, Esport HQ 6.
  k.discord.etat.positions.set(STAFF_R, 5);
  k.discord.etat.positions.set(BOT_R, 6);
  // Repère : le rôle du bot lui-même, refusé (le bot ne place des rôles que sous le sien).
  const refus = await k.api(k.chemin, undefined, {
    methode: 'PATCH',
    corps: { discord: { roleAncreId: BOT_R } },
  });
  assert.equal(refus.statut, 400);
  assert.match(
    refus.corps.erreur?.message ?? JSON.stringify(refus.corps),
    /au-dessus du rôle du bot/,
  );
  assert.equal(
    (
      await k.api(k.chemin, undefined, {
        methode: 'PATCH',
        corps: { discord: { roleAncreId: '720000000000009999' } },
      })
    ).statut,
    400,
    'rôle inconnu',
  );
  // Rôles du serveur pour le choix : hiérarchie, le plus haut d'abord ; utilisable = sous le bot.
  const rs = await k.api('/evenements/roles-serveur');
  assert.deepEqual(
    rs.corps.roles.map(r => [r.id, r.utilisable]),
    [
      [BOT_R, false],
      [STAFF_R, true],
    ],
  );
  assert.equal(rs.corps.positionBot, 6);
  // Repère Staff (2) : les rôles créés passent juste dessous.
  assert.equal(
    (
      await k.api(k.chemin, undefined, {
        methode: 'PATCH',
        corps: { discord: { roleAncreId: STAFF_R } },
      })
    ).statut,
    200,
  );
  const e = await k.api(`${k.chemin}/equipes`, undefined, {
    methode: 'POST',
    corps: {
      equipes: [
        { nom: 'Ligne Zéro', tag: 'LZ0' },
        { nom: 'Bravo', tag: 'BRV' },
      ],
    },
  });
  const [lz, brv] = e.corps.equipes.map(x => x.roleId);
  const p = patchsPositions(k).at(-1);
  assert.ok(p, 'PATCH des positions');
  const pos = new Map(p.corps.map(x => [x.id, x.position]));
  assert.ok(
    pos.get(lz) > pos.get(brv),
    'la première équipe juste sous le repère',
  );
  assert.deepEqual([pos.get(lz), pos.get(brv)], [4, 3], 'juste sous Staff (5)');
  assert.ok(!pos.has(BOT_R));
  assert.deepEqual(e.corps.discord.bilan.position, {
    ok: true,
    deplaces: p.corps.length,
  });
});

test('fin : « Supprimer les rôles », cron (terminé, annulé, N heures après la fin) ; plus de création automatique ensuite', async () => {
  const k = await monter();
  await k.api(k.chemin, undefined, {
    methode: 'PATCH',
    corps: { discord: { suppressionH: 24 } },
  });
  await k.api(`${k.chemin}/equipes`, undefined, {
    methode: 'POST',
    corps: { nom: 'Ligne Zéro', tag: 'LZ0', membres: [{ discordId: J1 }] },
  });
  const ctx = {
    jetonBot: 'jeton-bot-de-test-jamais-reel',
    fetch: k.discord.fetch,
  };
  // Fin le 22/11 : le 23/11 à 12 h, pas encore (fin de journée + 24 h) ; le 24/11 à 1 h, oui.
  assert.equal(
    await tachesEvenementsDiscord(k.b.base, {
      ...ctx,
      maintenant: () => Date.parse('2026-11-23T12:00:00Z'),
    }),
    0,
  );
  assert.equal(
    await tachesEvenementsDiscord(k.b.base, {
      ...ctx,
      maintenant: () => Date.parse('2026-11-24T01:00:00Z'),
    }),
    1,
  );
  assert.equal(
    (await k.b.base.premier('SELECT role_id FROM club_evenement_equipes', []))
      .role_id,
    null,
  );
  assert.equal(k.discord.etat.roles.size, 0);
  // Nettoyé : une équipe ajoutée ensuite n'a pas de rôle automatique.
  const n = creationsRoles(k).length;
  await k.api(`${k.chemin}/equipes`, undefined, {
    methode: 'POST',
    corps: { nom: 'Bravo', tag: 'BRV', membres: [{ discordId: J2 }] },
  });
  assert.equal(creationsRoles(k).length, n);
  // Resynchronisés, puis événement « terminé » : supprimés au passage suivant ; resynchroniser refusé.
  await k.api(`${k.chemin}/roles`, undefined, { methode: 'POST', corps: {} });
  assert.equal(k.discord.etat.roles.size, 2);
  await k.api(k.chemin, undefined, {
    methode: 'PATCH',
    corps: { statut: 'termine' },
  });
  assert.equal(
    await tachesEvenementsDiscord(k.b.base, {
      ...ctx,
      maintenant: () => Date.parse('2026-11-21T12:00:00Z'),
    }),
    1,
  );
  assert.equal(
    await tachesEvenementsDiscord(k.b.base, {
      ...ctx,
      maintenant: () => Date.parse('2026-11-21T12:05:00Z'),
    }),
    0,
    'déjà fait',
  );
  assert.equal(
    (
      await k.api(`${k.chemin}/roles`, undefined, {
        methode: 'POST',
        corps: {},
      })
    ).statut,
    409,
  );
  // Bouton « Supprimer les rôles » (annulé : rien de plus à faire).
  await k.api(k.chemin, undefined, {
    methode: 'PATCH',
    corps: { statut: 'en_cours' },
  });
  await k.api(`${k.chemin}/roles`, undefined, { methode: 'POST', corps: {} });
  const s = await k.api(`${k.chemin}/roles/supprimer`, undefined, {
    methode: 'POST',
    corps: {},
  });
  assert.deepEqual(
    [
      s.corps.nettoyage.roles,
      s.corps.equipes.every(x => !x.roleId),
      Boolean(s.corps.evenement.discord.rolesSupprimesLe),
    ],
    [2, true, true],
  );
  // Export et RGPD.
  assert.ok(
    [
      'club_evenements',
      'club_evenement_equipes',
      'club_evenement_membres',
    ].every(t => TABLES.some(([nn]) => nn === t)),
  );
  assert.ok(
    !TABLES.some(
      ([nn]) => nn.startsWith('tournoi_equipe') || nn === 'tournoi_discord',
    ),
  );
  const rgpd = effacementParDiscord([J1]).find(x =>
    x.sql.includes('club_evenement_membres'),
  );
  await k.b.base.executer(rgpd.sql, rgpd.params);
  assert.equal(
    (
      await k.b.base.premier(
        'SELECT COUNT(*) AS n FROM club_evenement_membres WHERE discord_id = ?',
        [J1],
      )
    ).n,
    0,
  );
});

test('migration 0064 : les équipes d’un tournoi de team (0063) deviennent un événement du club (même identifiant) ; anciennes tables supprimées', async () => {
  const base = await baseVierge();
  const toutes = lireMigrations();
  await appliquerMigrations(
    base,
    toutes.filter(m => m.nom < '0064'),
  );
  const t = '2026-11-07T10:00:00.000Z';
  const TID = '11111111-2222-4333-8444-555555555555';
  await base.executer(
    "INSERT INTO teams (id, nom, slug, jeu, cree_par, cree_le, maj_le) VALUES ('team-lz0', 'The Final LZ0', 'the-final-lz0', 'arc_raiders', 'principal', ?, ?)",
    [t, t],
  );
  await base.executer(
    "INSERT INTO tournois (id, team_id, nom, jeu, debut, fin, statut, cree_le, maj_le) VALUES (?, 'team-lz0', 'The Nuke End', 'arc_raiders', '2026-11-21', '2026-11-22', 'inscrit', ?, ?)",
    [TID, t, t],
  );
  await base.executer(
    "INSERT INTO tournoi_discord (tournoi_id, team_id, modele_role, couleur, suppression_h, categorie_ticket_id, roles_crees_le, maj_le) VALUES (?, 'team-lz0', '[{tag}] {nom}', '#e4572e', 12, 'cat-1', ?, ?)",
    [TID, t, t],
  );
  await base.executer(
    "INSERT INTO tournoi_equipes (id, tournoi_id, team_id, nom, tag, role_id, position, cree_le, maj_le) VALUES ('00000000-0000-4000-8000-000000000001', ?, 'team-lz0', 'Ligne Zéro', 'LZ0', '720000000000000071', 0, ?, ?)",
    [TID, t, t],
  );
  await base.executer(
    "INSERT INTO tournoi_equipe_membres (id, equipe_id, poste, discord_id, nom, embark_id, role_statut, position) VALUES ('m1', '00000000-0000-4000-8000-000000000001', 'joueur', ?, 'Kira', 'Kira#1234', 'attribue', 0)",
    [J1],
  );
  assert.deepEqual(
    await appliquerMigrations(
      base,
      toutes.filter(m => m.nom < '0065'),
    ),
    ['0064_evenements_club.sql'],
  );
  const e = await base.premier('SELECT * FROM club_evenements WHERE id = ?', [
    TID,
  ]);
  assert.deepEqual(
    [
      e.nom,
      e.statut,
      e.modele_role,
      e.couleur,
      Number(e.suppression_h),
      e.categorie_ticket_id,
      Number(e.roles_auto),
      Boolean(e.roles_crees_le),
    ],
    [
      'The Nuke End',
      'a_venir',
      '[{tag}] {nom}',
      '#e4572e',
      12,
      'cat-1',
      1,
      true,
    ],
  );
  const q = await base.premier('SELECT * FROM club_evenement_equipes', []);
  assert.deepEqual(
    [q.evenement_id, q.tag, q.role_id],
    [TID, 'LZ0', '720000000000000071'],
  );
  const m = await base.premier('SELECT * FROM club_evenement_membres', []);
  assert.deepEqual(
    [m.discord_id, m.embark_id, m.role_statut],
    [J1, 'Kira#1234', 'attribue'],
  );
  await assert.rejects(base.premier('SELECT * FROM tournoi_equipes', []));
  // Export d'avant 0064 : même reprise à l'import.
  const tables = reprendreTablesTournoi({
    tournois: [
      {
        id: TID,
        nom: 'The Nuke End',
        jeu: 'arc_raiders',
        statut: 'termine',
        cree_le: t,
        maj_le: t,
      },
    ],
    tournoi_equipes: [
      { id: 'e1', tournoi_id: TID, nom: 'A', tag: 'A', cree_le: t, maj_le: t },
    ],
    tournoi_equipe_membres: [
      {
        id: 'm1',
        equipe_id: 'e1',
        poste: 'joueur',
        discord_id: J1,
        nom: '',
        embark_id: '',
        role_statut: null,
        position: 0,
      },
    ],
  });
  assert.deepEqual(
    [
      tables.club_evenements[0].statut,
      tables.club_evenement_equipes[0].evenement_id,
      tables.club_evenement_membres.length,
      'tournoi_equipes' in tables,
    ],
    ['termine', TID, 1, false],
  );
  await base.fermer?.();
});

// ------------------------------------------------------------------ Hub vocal d'un événement

const GUILD = '700000000000000001';
const BOT = '424242424242424242';
const CAT = '710000000000000050';
const HUB_T = '710000000000000052';
const STAFF = '720000000000000001';
const CASTER = '720000000000000060';
const R1 = '720000000000000071';
const R2 = '720000000000000072';
const TOURNOI = '11111111-2222-4333-8444-555555555555';
const PV_CONNECT = 1n << 20n;
const silencieux = { error() {}, warn() {} };

async function monterHub() {
  const { baseMigree } = await import('./base.mjs');
  const { fauxDiscordRest } = await import('./tickets-aide.mjs');
  const { creerMoteurVocaux } = await import('../noyau/vocaux/moteur.mjs');
  const { creerBotVocaux } = await import('../noyau/vocaux/bot.mjs');
  const base = await baseMigree();
  const t = '2026-11-20T10:00:00.000Z';
  await base.executer(
    'INSERT INTO tickets_reglages (cle, valeur, maj_le) VALUES (?, ?, ?)',
    [
      'general',
      JSON.stringify({
        actif: false,
        guildId: GUILD,
        guildNom: 'Club',
        langue: 'fr',
      }),
      t,
    ],
  );
  await base.executer(
    'INSERT INTO tickets_reglages (cle, valeur, maj_le) VALUES (?, ?, ?)',
    [
      'vocaux',
      JSON.stringify({
        actif: true,
        hubs: [
          {
            id: HUB_T,
            nom: 'Vocal équipe The Nuke End',
            modeleNom: '{tag} — {nom}',
            limite: 0,
            verrouille: true,
            tournoiId: TOURNOI,
            rolesAutorises: [CASTER],
          },
        ],
        rolesStaff: [STAFF],
        delaiSuppressionS: 5,
        maxParMembre: 1,
        quandProprietairePart: 'transferer',
      }),
      t,
    ],
  );
  await base.executer(
    "INSERT INTO club_evenements (id, nom, statut, cree_le, maj_le) VALUES (?, 'The Nuke End', 'en_cours', ?, ?)",
    [TOURNOI, t, t],
  );
  for (const [id, nom, tag, role, pos] of [
    ['e1', 'Ligne Zéro', 'LZ0', R1, 0],
    ['e2', 'Bravo', 'BRV', R2, 1],
  ]) {
    await base.executer(
      'INSERT INTO club_evenement_equipes (id, evenement_id, nom, tag, role_id, position, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        `00000000-0000-4000-8000-0000000000${id === 'e1' ? '01' : '02'}`,
        TOURNOI,
        nom,
        tag,
        role,
        pos,
        t,
        t,
      ],
    );
  }
  const rest = fauxDiscordRest();
  rest.etat.salons.set(CAT, {
    id: CAT,
    type: 4,
    name: 'The Nuke End',
    guild_id: GUILD,
    position: 2,
    permission_overwrites: [],
  });
  rest.etat.salons.set(HUB_T, {
    id: HUB_T,
    type: 2,
    name: 'Vocal équipe The Nuke End',
    guild_id: GUILD,
    parent_id: CAT,
    position: 3,
    permission_overwrites: [],
  });
  for (const r of [R1, R2])
    rest.etat.roles.set(r, {
      id: r,
      name: r === R1 ? 'LZ0 Ligne Zéro' : 'BRV Bravo',
    });
  const moteur = creerMoteurVocaux({
    base,
    fetch: rest.fetch,
    jetonBot: 'jeton-bot-de-test-jamais-reel',
    botId: () => BOT,
    delaiMs: 60,
    journal: silencieux,
  });
  await moteur.evenement('GUILD_CREATE', {
    id: GUILD,
    channels: [...rest.etat.salons.values()],
    voice_states: [],
    members: [],
  });
  const bot = creerBotVocaux({
    base,
    fetch: rest.fetch,
    jetonBot: 'jeton-bot-de-test-jamais-reel',
    botId: BOT,
  });
  return { base, rest, moteur, bot };
}

const vsT = (userId, channelId, nom, roles = []) => ({
  guild_id: GUILD,
  user_id: userId,
  channel_id: channelId,
  member: {
    user: { id: userId, username: nom.toLowerCase() },
    nick: nom,
    roles,
  },
});
const creationsT = rest =>
  rest.appels.filter(
    a => a.methode === 'POST' && a.chemin === `/guilds/${GUILD}/channels`,
  );

test('hub de l’événement : sans rôle d’équipe → déconnecté et prévenu en MP ; avec : salon de l’équipe verrouillé sur son rôle', async () => {
  const k = await monterHub();
  // Personne sans équipe : déconnectée du hub, MP d'explication, aucun salon.
  await k.moteur.evenement(
    'VOICE_STATE_UPDATE',
    vsT(J3, HUB_T, 'Intrus', ['720000000000000999']),
  );
  assert.equal(creationsT(k.rest).length, 0);
  assert.deepEqual(
    k.rest.appels.find(a => a.chemin === `/guilds/${GUILD}/members/${J3}`)
      .corps,
    { channel_id: null },
  );
  assert.equal(
    k.rest.appels.find(a => a.chemin === '/users/@me/channels').corps
      .recipient_id,
    J3,
  );
  const mp = k.rest.etat.mp.at(-1);
  assert.match(
    mp.content,
    /réservé aux équipes inscrites à l’événement The Nuke End/,
  );
  // Joueur de Ligne Zéro : salon « LZ0 — Ligne Zéro », verrouillé : @everyone refusé, rôle de l'équipe, staff et casters admis.
  await k.moteur.evenement('VOICE_STATE_UPDATE', vsT(J1, HUB_T, 'Kira', [R1]));
  const [c] = creationsT(k.rest);
  assert.equal(c.corps.name, 'LZ0 — Ligne Zéro');
  const de = id => c.corps.permission_overwrites.find(o => o.id === id);
  assert.equal(BigInt(de(GUILD).deny) & PV_CONNECT, PV_CONNECT);
  for (const id of [R1, STAFF, CASTER, J1])
    assert.equal(BigInt(de(id).allow) & PV_CONNECT, PV_CONNECT, id);
  assert.ok(!de(R2), 'l’autre équipe n’entre pas');
  const salon = [...k.rest.etat.salons.values()].find(
    s => s.name === 'LZ0 — Ligne Zéro',
  ).id;
  const ligne = await k.base.premier(
    'SELECT tournoi_id, equipe_id, verrouille FROM vocaux_salons WHERE salon_id = ?',
    [salon],
  );
  assert.deepEqual([ligne.tournoi_id, Number(ligne.verrouille)], [TOURNOI, 1]);
  // Panneau : ni renommer ni déverrouiller (boutons grisés), pas de liste d'amis.
  const panneau = k.rest.etat.messages.get(salon)[0];
  const boutons = panneau.components.flatMap(r => r.components);
  assert.equal(
    boutons.find(b => b.custom_id === `vc:r:${salon}`).disabled,
    true,
  );
  assert.equal(
    boutons.find(b => b.custom_id === `vc:u:${salon}`).disabled,
    true,
  );
  assert.ok(!boutons.some(b => b.custom_id === `vc:a:${salon}`));
  assert.match(panneau.embeds[0].description, /équipe \*\*LZ0 Ligne Zéro\*\*/);
  await k.moteur.evenement('VOICE_STATE_UPDATE', vsT(J1, salon, 'Kira', [R1]));
  // Coéquipier : déplacé dans le salon de l'équipe, pas de deuxième salon ; l'autre équipe a le sien.
  await k.moteur.evenement('VOICE_STATE_UPDATE', vsT(J2, HUB_T, 'Nox', [R1]));
  assert.equal(creationsT(k.rest).length, 1);
  assert.deepEqual(
    k.rest.appels
      .filter(a => a.chemin === `/guilds/${GUILD}/members/${J2}`)
      .at(-1).corps,
    { channel_id: salon },
  );
  await k.moteur.evenement('VOICE_STATE_UPDATE', vsT(J2, salon, 'Nox', [R1]));
  await k.moteur.evenement(
    'VOICE_STATE_UPDATE',
    vsT(COACH, HUB_T, 'Zed', [R2]),
  );
  assert.equal(creationsT(k.rest).length, 2);
  assert.equal(creationsT(k.rest)[1].corps.name, 'BRV — Bravo');
  // Les joueurs ne peuvent ni déverrouiller ni renommer ; ils peuvent expulser.
  const clic = (id, extra = {}) => ({
    type: 3,
    guild_id: GUILD,
    channel_id: salon,
    locale: 'fr',
    member: { user: { id: J1 }, roles: [R1], permissions: '0' },
    data: { custom_id: id, ...extra },
  });
  assert.match(
    (await k.bot.interaction(clic(`vc:u:${salon}`))).data.content,
    /reste verrouillé sur le rôle de l’équipe/,
  );
  assert.match(
    (await k.bot.interaction(clic(`vc:r:${salon}`))).data.content,
    /nom d’un salon d’équipe de tournoi est fixe/,
  );
  const voc = {
    type: 2,
    guild_id: GUILD,
    channel_id: salon,
    locale: 'fr',
    member: { user: { id: J1 }, roles: [R1], permissions: '0' },
    data: {
      name: 'voc',
      options: [{ type: 1, name: 'deverrouiller', options: [] }],
    },
  };
  assert.match((await k.bot.interaction(voc)).data.content, /reste verrouillé/);
  assert.match(
    (await k.bot.interaction(clic(`vc:ks:${salon}`, { values: [J2] }))).data
      .content,
    /expulsé/,
  );
  // Verrouiller (recalcul des surcharges) garde le rôle de l'équipe et les casters.
  await k.bot.interaction(clic(`vc:l:${salon}`));
  const patch = k.rest.appels
    .filter(a => a.methode === 'PATCH' && a.chemin === `/channels/${salon}`)
    .at(-1);
  assert.ok(
    [R1, CASTER].every(
      id =>
        BigInt(patch.corps.permission_overwrites.find(o => o.id === id).allow) &
        PV_CONNECT,
    ),
  );
  k.moteur.arreter();
});

test('fin de l’événement : rôles et salons des équipes supprimés ensemble', async () => {
  const k = await monterHub();
  await k.moteur.evenement('VOICE_STATE_UPDATE', vsT(J1, HUB_T, 'Kira', [R1]));
  const salon = [...k.rest.etat.salons.values()].find(
    s => s.name === 'LZ0 — Ligne Zéro',
  ).id;
  const { nettoyerEvenement } = await import(
    '../noyau/evenements-club/discord.mjs'
  );
  const r = await nettoyerEvenement(
    {
      base: k.base,
      fetch: k.rest.fetch,
      jetonBot: 'jeton-bot-de-test-jamais-reel',
      guildId: GUILD,
      maintenant: () => Date.now(),
    },
    TOURNOI,
  );
  assert.deepEqual([r.roles, r.salons, r.echecs.length], [2, 1, 0]);
  assert.ok(!k.rest.etat.salons.has(salon));
  assert.equal(k.rest.etat.roles.size, 0);
  assert.equal(
    (await k.base.tous('SELECT * FROM vocaux_salons', [])).length,
    0,
  );
  k.moteur.arreter();
});

test('application : hubs d’événement créés seulement dans la fiche de l’événement ; Bot Esport HQ les garde en lecture seule ; retirer l’équipe supprime son salon', async () => {
  const k = await monter();
  const vocaux = `${k.chemin}/vocaux`;
  // Bot Esport HQ : un hub d'événement n'y est plus créé (ni un hub ordinaire passé en hub d'événement).
  const r0 = await k.api('/vocaux/config', undefined, {
    methode: 'PUT',
    corps: { actif: true, hubs: [{ id: HUB_T, tournoiId: k.id }] },
  });
  assert.equal(r0.statut, 400);
  assert.equal(r0.corps.code, 'vocaux-hub-evenement');
  // Fiche de l'événement : aucun hub, modèle par défaut des équipes.
  const v0 = await k.api(vocaux);
  assert.equal(v0.statut, 200, JSON.stringify(v0.corps));
  assert.deepEqual([v0.corps.hubs, v0.corps.peutModifier, v0.corps.staffRole, v0.corps.choix.modeleDefaut], [[], true, null, '{tag} — {nom}']);
  const r = await k.api(vocaux, undefined, {
    methode: 'POST',
    corps: { id: HUB_T, nom: 'Vocal équipe', categorieId: CAT, rolesAutorises: [CASTER], verrouille: false, tournoiId: TOURNOI, limite: 5 },
  });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  // L'événement et le verrouillage sont imposés ; modèle par défaut des équipes.
  assert.deepEqual(r.corps.hubs, [{ id: HUB_T, nom: 'Vocal équipe', categorieId: CAT, modeleNom: '{tag} — {nom}', limite: 5, verrouille: true, tournoiId: k.id, rolesAutorises: [CASTER], placerSousHub: true, visibleNonJoignable: false, masquerHub: true, rolesHub: [], modeleStaff: '{role} — {pseudo}', etiquettes: {} }]);
  // Même stockage : les réglages des salons vocaux le montrent.
  const c = await k.api('/vocaux/config');
  assert.deepEqual(c.corps.reglages.hubs.map(h => [h.id, h.tournoiId]), [[HUB_T, k.id]]);
  assert.deepEqual(c.corps.evenements.find(e => e.id === k.id)?.staffRole, null);
  assert.deepEqual((await k.api(k.chemin)).corps.hubs.map(h => h.id), [HUB_T]);
  // Modifier depuis la fiche.
  const m = await k.api(`${vocaux}/${HUB_T}`, undefined, { methode: 'PATCH', corps: { modeleNom: 'Équipe {tag}', rolesAutorises: [] } });
  assert.equal(m.statut, 200, JSON.stringify(m.corps));
  assert.deepEqual([m.corps.hubs[0].modeleNom, m.corps.hubs[0].rolesAutorises, m.corps.hubs[0].limite, m.corps.hubs[0].categorieId], ['Équipe {tag}', [], 5, CAT]);
  // Bot Esport HQ renvoie une copie ancienne du hub d'événement (ou l'omet) : la version de la fiche est gardée,
  // les hubs ordinaires changent normalement.
  const HUB_N = '710000000000000053';
  const r2 = await k.api('/vocaux/config', undefined, {
    methode: 'PUT',
    corps: { actif: true, hubs: [{ id: HUB_N }, { id: HUB_T, tournoiId: k.id, modeleNom: 'vieux', rolesAutorises: [CASTER] }] },
  });
  assert.equal(r2.statut, 200, JSON.stringify(r2.corps));
  assert.deepEqual(r2.corps.reglages.hubs.map(h => [h.id, h.tournoiId, h.modeleNom]), [[HUB_N, null, 'Salon de {pseudo}'], [HUB_T, k.id, 'Équipe {tag}']]);
  const r3 = await k.api('/vocaux/config', undefined, { methode: 'PUT', corps: { hubs: [] } });
  assert.deepEqual(r3.corps.reglages.hubs.map(h => h.id), [HUB_T], 'omis : le hub d’événement reste');
  // Un salon déjà pris par un autre hub est refusé ; un hub d'un autre événement est introuvable ici.
  await k.api('/vocaux/config', undefined, { methode: 'PUT', corps: { hubs: [{ id: HUB_N }] } });
  assert.equal((await k.api(vocaux, undefined, { methode: 'POST', corps: { id: HUB_N } })).statut, 400);
  assert.deepEqual((await k.api(vocaux)).corps.autresHubs, [HUB_N]);
  assert.equal((await k.api(`${vocaux}/${HUB_N}`, undefined, { methode: 'PATCH', corps: { limite: 2 } })).statut, 404);
  assert.equal((await k.api(`${vocaux}/${HUB_N}`, undefined, { methode: 'DELETE' })).statut, 404);
  assert.equal((await k.api('/evenements/11111111-2222-4333-8444-000000000000/vocaux')).statut, 404);
  // Droits : lire avec evenements.gerer ; modifier demande en plus vocaux.configurer.
  const ev = await k.compteAvec('ceo12345', 'Ceo', ['evenements.gerer']);
  const lu = await k.api(vocaux, ev.jeton);
  assert.deepEqual([lu.statut, lu.corps.peutModifier, lu.corps.hubs.length], [200, false, 1]);
  assert.equal((await k.api(`${vocaux}/${HUB_T}`, ev.jeton, { methode: 'PATCH', corps: { limite: 1 } })).statut, 403);
  assert.equal((await k.api(vocaux, ev.jeton, { methode: 'POST', corps: { id: '710000000000000054' } })).statut, 403);
  const vc = await k.compteAvec('voc12345', 'Voc', ['vocaux.configurer']);
  assert.equal((await k.api(vocaux, vc.jeton)).statut, 403, 'la fiche de l’événement demande evenements.gerer');
  const deux = await k.compteAvec('sec12345', 'Second', ['evenements.gerer', 'vocaux.configurer']);
  const p2 = await k.api(`${vocaux}/${HUB_T}`, deux.jeton, { methode: 'PATCH', corps: { limite: 3 } });
  assert.deepEqual([p2.statut, p2.corps.hubs[0].limite], [200, 3]);
  // Équipe retirée : son salon vocal (hub de l'événement) supprimé avec son rôle.
  const e = await k.api(`${k.chemin}/equipes`, undefined, {
    methode: 'POST',
    corps: { nom: 'Ligne Zéro', tag: 'LZ0' },
  });
  const eq = e.corps.equipes[0];
  const t = new Date().toISOString();
  await k.b.base.executer(
    "INSERT INTO vocaux_salons (salon_id, guild_id, hub_id, proprietaire_id, tournoi_id, equipe_id, cree_le, maj_le) VALUES ('710000000000000099', ?, ?, ?, ?, ?, ?, ?)",
    [k.GUILD, HUB_T, J1, k.id, eq.id, t, t],
  );
  await k.api(`${k.chemin}/equipes/${eq.id}`, undefined, { methode: 'DELETE' });
  assert.ok(
    k.discord.appels.some(
      a =>
        a.methode === 'DELETE' && a.chemin === '/channels/710000000000000099',
    ),
  );
  assert.equal(
    (await k.b.base.tous('SELECT * FROM vocaux_salons', [])).length,
    0,
  );
  // Retirer le hub depuis la fiche : dernier hub retiré → salons désactivés.
  await k.api('/vocaux/config', undefined, { methode: 'PUT', corps: { hubs: [] } });
  const sans = await k.api(`${vocaux}/${HUB_T}`, undefined, { methode: 'DELETE' });
  assert.deepEqual([sans.statut, sans.corps.hubs, sans.corps.actif], [200, [], false]);
  assert.equal((await k.api(k.chemin, undefined, { methode: 'DELETE' })).statut, 200);
});

// ------------------------------------------------------------------ Rôle staff de l'événement

test('rôle staff : créé (nom de l’événement), donné au staff, ajouté aux catégories de tickets et aux salons d’équipe ; retiré ; supprimé à la fin', async () => {
  const k = await monter();
  const STAFF1 = '810000000000000301';
  const STAFF2 = '810000000000000302';
  const cat = async nom => (await k.api('/tickets/config/categories', undefined, { methode: 'POST', corps: { nom: { fr: nom, en: nom }, modeleNom: 't-{numero}' } })).corps.id;
  const inscription = await cat('Inscription The Nuke End');
  const support = await cat('Support The Nuke End');
  await ticketInscription(k, inscription, 1, [], 'ouvert');
  await k.b.base.executer("UPDATE tickets SET salon_id = '710000000000000777'", []);
  // Une équipe et son salon vocal (hub de l'événement) déjà ouvert.
  const e = await k.api(`${k.chemin}/equipes`, undefined, { methode: 'POST', corps: { nom: 'Ligne Zéro', tag: 'LZ0' } });
  const eq = e.corps.equipes[0];
  const t = new Date().toISOString();
  await k.b.base.executer("INSERT INTO vocaux_salons (salon_id, guild_id, hub_id, proprietaire_id, tournoi_id, equipe_id, cree_le, maj_le) VALUES ('710000000000000888', ?, '710000000000000052', ?, ?, ?, ?, ?)", [k.GUILD, J1, k.id, eq.id, t, t]);
  // Catégories de l'événement et modèle du nom.
  const m = await k.api(k.chemin, undefined, { methode: 'PATCH', corps: { categoriesTickets: [inscription, support], discord: { staffModele: 'Staff {evenement}' } } });
  assert.equal(m.statut, 200, JSON.stringify(m.corps));
  const roleId = m.corps.evenement.discord.staffRoleId;
  assert.ok(roleId, 'rôle staff créé dès qu’une catégorie est choisie');
  assert.equal(k.discord.etat.roles.get(roleId).name, 'Staff The Nuke End');
  assert.deepEqual(m.corps.evenement.categoriesTickets, [inscription, support]);
  const rolesDe = async id => JSON.parse((await k.b.base.premier('SELECT roles_discord FROM tickets_categories WHERE id = ?', [id])).roles_discord);
  assert.ok((await rolesDe(inscription)).includes(roleId));
  assert.ok((await rolesDe(support)).includes(roleId));
  const tk = k.discord.appels.find(a => a.methode === 'PUT' && a.chemin === `/channels/710000000000000777/permissions/${roleId}`);
  assert.ok(tk, 'ticket déjà ouvert : salon ouvert au rôle staff');
  const vocal = k.discord.appels.find(a => a.methode === 'PUT' && a.chemin === `/channels/710000000000000888/permissions/${roleId}`);
  assert.ok(vocal, 'salon d’équipe ouvert au rôle staff');
  assert.equal(BigInt(vocal.corps.allow) & ((1n << 10n) | (1n << 20n)), (1n << 10n) | (1n << 20n));
  // Les salons d'équipe créés ensuite l'ont dès leur création (rôles qui ouvrent le salon).
  const { rolesEquipe } = await import('../noyau/vocaux/tournoi.mjs');
  assert.ok((await rolesEquipe({ base: k.b.base, reglages: { hubs: [] } }, { equipeId: eq.id, hubId: 'x' })).includes(roleId));
  // Candidats : compte de l'app au Discord lié, puis membres du serveur.
  await k.b.base.executer("INSERT INTO discord_comptes (compte_id, discord_user_id, discord_nom, lie_le) VALUES ('zed12345', ?, 'zedcaster', ?)", [STAFF1, t]);
  const cands = await k.api('/evenements/staff-candidats?q=zed');
  assert.deepEqual(cands.corps.candidats.map(c => [c.discordId, c.source]), [[STAFF1, 'app']]);
  assert.ok((await k.api('/evenements/staff-candidats?q=zo')).corps.candidats.some(c => c.discordId === '800000000000000077' && c.source === 'discord'));
  // Staff ajouté : rôle donné ; deuxième personne aussi. Le rôle existant est réappliqué aux salons d'équipe ouverts
  // (un salon ouvert avant, ou dont la surcharge a été retirée à la main, le récupère).
  const putsVocal = () => k.discord.appels.filter(a => a.methode === 'PUT' && a.chemin === `/channels/710000000000000888/permissions/${roleId}`).length;
  const avantStaff = putsVocal();
  const s1 = await k.api(`${k.chemin}/staff`, undefined, { methode: 'POST', corps: { discordId: STAFF1, nom: 'Zed' } });
  assert.equal(putsVocal(), avantStaff + 1, 'rôle staff réappliqué au salon d’équipe ouvert');
  assert.equal(s1.statut, 200, JSON.stringify(s1.corps));
  assert.deepEqual(s1.corps.staff.map(x => [x.discordId, x.compteId, x.roleStatut]), [[STAFF1, 'zed12345', 'attribue']]);
  const s2 = await k.api(`${k.chemin}/staff`, undefined, { methode: 'POST', corps: { discordId: STAFF2 } });
  assert.ok(k.discord.appels.some(a => a.methode === 'PUT' && a.chemin === `/guilds/${k.GUILD}/members/${STAFF2}/roles/${roleId}`));
  // Retiré du staff : rôle retiré.
  const zed = s2.corps.staff.find(x => x.discordId === STAFF1);
  await k.api(`${k.chemin}/staff/${zed.id}`, undefined, { methode: 'DELETE' });
  assert.ok(k.discord.appels.some(a => a.methode === 'DELETE' && a.chemin === `/guilds/${k.GUILD}/members/${STAFF1}/roles/${roleId}`));
  // Une catégorie retirée de l'événement : le rôle n'y traite plus les tickets.
  await k.api(k.chemin, undefined, { methode: 'PATCH', corps: { categoriesTickets: [inscription] } });
  assert.ok(!(await rolesDe(support)).includes(roleId));
  assert.ok((await rolesDe(inscription)).includes(roleId));
  // Fin : rôle staff supprimé avec les rôles des équipes, retiré des catégories de tickets.
  const fin = await k.api(`${k.chemin}/roles/supprimer`, undefined, { methode: 'POST', corps: {} });
  assert.equal(fin.corps.nettoyage.roles, 2);
  assert.ok(!k.discord.etat.roles.has(roleId));
  assert.ok(!(await rolesDe(inscription)).includes(roleId));
  assert.equal(fin.corps.evenement.discord.staffRoleId, null);
  assert.ok(fin.corps.staff.every(x => x.roleStatut === null));
  assert.ok(TABLES.some(([n]) => n === 'club_evenement_staff'));
  assert.ok(effacementParDiscord([STAFF2]).some(i => i.sql.includes('club_evenement_staff')));
});

test('rôle staff de l’événement : dans les surcharges des salons créés par le hub (et après verrouillage) ; affiché dans la fiche', async () => {
  const k = await monterHub();
  const STAFF_EVT = '720000000000000500';
  await k.base.executer("UPDATE club_evenements SET staff_role_id = ?, staff_role_nom = 'Staff The Nuke End' WHERE id = ?", [STAFF_EVT, TOURNOI]);
  await k.moteur.evenement('VOICE_STATE_UPDATE', vsT(J1, HUB_T, 'Kira', [R1]));
  const [c] = creationsT(k.rest);
  const de = id => c.corps.permission_overwrites.find(o => o.id === id);
  assert.ok(de(STAFF_EVT), 'surcharge du rôle staff de l’événement à la création');
  assert.equal(BigInt(de(STAFF_EVT).allow) & ((1n << 10n) | PV_CONNECT), (1n << 10n) | PV_CONNECT);
  const salon = [...k.rest.etat.salons.values()].find(s => s.name === 'LZ0 — Ligne Zéro').id;
  await k.moteur.evenement('VOICE_STATE_UPDATE', vsT(J1, salon, 'Kira', [R1]));
  await k.bot.interaction({ type: 3, guild_id: GUILD, channel_id: salon, locale: 'fr', member: { user: { id: J1 }, roles: [R1], permissions: '0' }, data: { custom_id: `vc:l:${salon}` } });
  const patch = k.rest.appels.filter(a => a.methode === 'PATCH' && a.chemin === `/channels/${salon}`).at(-1);
  assert.ok(BigInt(patch.corps.permission_overwrites.find(o => o.id === STAFF_EVT).allow) & PV_CONNECT, 'gardée au recalcul');
  k.moteur.arreter();
});

test('suppression d’un événement : ses hubs vocaux retirés (même stockage), salons d’équipe et rôles supprimés, rôle staff retiré des tickets ; au mieux si Discord refuse', async () => {
  const k = await monter();
  const HUB_N = '710000000000000053';
  const cat = (await k.api('/tickets/config/categories', undefined, { methode: 'POST', corps: { nom: { fr: 'Inscription', en: 'Registration' }, modeleNom: 't-{numero}' } })).corps.id;
  // Un hub ordinaire actif, puis le hub de l'événement ; une équipe (rôle) ; le rôle staff (catégorie de tickets).
  assert.equal((await k.api('/vocaux/config', undefined, { methode: 'PUT', corps: { actif: true, hubs: [{ id: HUB_N }] } })).statut, 200);
  assert.equal((await k.api(`${k.chemin}/vocaux`, undefined, { methode: 'POST', corps: { id: HUB_T } })).statut, 200);
  const eq = (await k.api(`${k.chemin}/equipes`, undefined, { methode: 'POST', corps: { nom: 'Ligne Zéro', tag: 'LZ0' } })).corps.equipes[0];
  const m = await k.api(k.chemin, undefined, { methode: 'PATCH', corps: { categoriesTickets: [cat] } });
  const staff = m.corps.evenement.discord.staffRoleId;
  assert.ok(staff && eq.roleId);
  const t = new Date().toISOString();
  k.discord.etat.salons.set('710000000000000099', { id: '710000000000000099', type: 2, name: 'LZ0 — Ligne Zéro', guild_id: k.GUILD, permission_overwrites: [] });
  await k.b.base.executer("INSERT INTO vocaux_salons (salon_id, guild_id, hub_id, proprietaire_id, tournoi_id, equipe_id, cree_le, maj_le) VALUES ('710000000000000099', ?, ?, ?, ?, ?, ?, ?)", [k.GUILD, HUB_T, J1, k.id, eq.id, t, t]);
  // La fiche annonce ce que la suppression emporte (un hub ; les salons vocaux restent actifs : un autre hub).
  assert.deepEqual((await k.api(k.chemin)).corps.suppression, { hubs: 1, desactiveVocaux: false, roles: [{ id: staff, nom: 'Staff The Nuke End', quoi: 'staff' }, { id: eq.roleId, nom: 'LZ0 Ligne Zéro', quoi: 'equipe' }] });
  const d = await k.api(k.chemin, undefined, { methode: 'DELETE' });
  assert.equal(d.statut, 200, JSON.stringify(d.corps));
  assert.deepEqual([d.corps.hubs, d.corps.vocauxDesactives, d.corps.nettoyage.salons, d.corps.nettoyage.roles, d.corps.nettoyage.echecs], [1, false, 1, 2, []]);
  const conf = (await k.api('/vocaux/config')).corps.reglages;
  assert.deepEqual([conf.actif, conf.hubs.map(h => h.id)], [true, [HUB_N]]);
  for (const chemin of ['/channels/710000000000000099', `/guilds/${k.GUILD}/roles/${eq.roleId}`, `/guilds/${k.GUILD}/roles/${staff}`])
    assert.ok(k.discord.appels.some(a => a.methode === 'DELETE' && a.chemin === chemin), chemin);
  assert.ok(!JSON.parse((await k.b.base.premier('SELECT roles_discord FROM tickets_categories WHERE id = ?', [cat])).roles_discord).includes(staff));
  assert.equal((await k.b.base.tous('SELECT * FROM vocaux_salons', [])).length, 0);
  assert.equal((await k.b.base.tous('SELECT * FROM club_evenement_equipes', [])).length, 0);
  assert.equal((await k.api(k.chemin)).statut, 404);

  // Deuxième événement, seul hub du serveur : la fiche annonce la désactivation ; Discord refuse un rôle → suppression
  // quand même (au mieux, notée au journal), hub retiré, salons vocaux désactivés.
  const e2 = (await k.api('/evenements', undefined, { methode: 'POST', corps: { nom: 'LAN' } })).corps.evenement.id;
  assert.equal((await k.api('/vocaux/config', undefined, { methode: 'PUT', corps: { actif: false, hubs: [] } })).statut, 200);
  await k.api(`/evenements/${e2}/vocaux`, undefined, { methode: 'POST', corps: { id: HUB_T } });
  await k.api('/vocaux/config', undefined, { methode: 'PUT', corps: { actif: true } });
  const eq2 = (await k.api(`/evenements/${e2}/equipes`, undefined, { methode: 'POST', corps: { nom: 'Bravo', tag: 'BRV' } })).corps.equipes[0];
  assert.deepEqual((await k.api(`/evenements/${e2}`)).corps.suppression.desactiveVocaux, true);
  k.discord.programme.push({ statut: 403, corps: { code: 50013, message: 'Missing Permissions' }, si: (meth, ch) => meth === 'DELETE' && ch === `/guilds/${k.GUILD}/roles/${eq2.roleId}` });
  const d2 = await k.api(`/evenements/${e2}`, undefined, { methode: 'DELETE' });
  assert.equal(d2.statut, 200, JSON.stringify(d2.corps));
  assert.deepEqual([d2.corps.vocauxDesactives, d2.corps.nettoyage.echecs.map(x => x.statut)], [true, [403]]);
  const conf2 = (await k.api('/vocaux/config')).corps.reglages;
  assert.deepEqual([conf2.actif, conf2.hubs], [false, []]);
  assert.equal((await k.api(`/evenements/${e2}`)).statut, 404);
});

test('hub de l’événement : le staff (rôle staff, rôles staff supplémentaires, rôles autorisés, staff des salons vocaux) a son propre salon ; équipe prioritaire ; les autres refusés ; nettoyé à la fin', async () => {
  const k = await monterHub();
  const STAFF_EVT = '720000000000000500';
  const SUP = '720000000000000501';
  await k.base.executer("UPDATE club_evenements SET staff_role_id = ?, staff_role_nom = 'Staff The Nuke End', staff_roles_sup = ? WHERE id = ?", [STAFF_EVT, JSON.stringify([{ id: SUP, nom: '⟡ Casteur The Nuke End ⟡' }]), TOURNOI]);
  // Libellés : rôle staff supplémentaire dérivé de son nom ; rôle autorisé du hub dérivé du nom lu par la Gateway ;
  // rôle du staff des salons vocaux : libellé saisi.
  await k.moteur.evenement('GUILD_ROLE_CREATE', { guild_id: GUILD, role: { id: CASTER, name: 'Caster • The Nuke End' } });
  const v = JSON.parse((await k.base.premier("SELECT valeur FROM tickets_reglages WHERE cle = 'vocaux'", [])).valeur);
  await k.base.executer("UPDATE tickets_reglages SET valeur = ? WHERE cle = 'vocaux'", [JSON.stringify({ ...v, etiquettesStaff: { [STAFF]: 'Modo' } })]);
  const ZED = '810000000000000401';
  // Rôle staff de l'événement : salon « Staff — Zed », verrouillé sur le staff (pas sur les équipes).
  await k.moteur.evenement('VOICE_STATE_UPDATE', vsT(ZED, HUB_T, 'Zed', [STAFF_EVT]));
  await k.moteur.attendre();
  const [c] = creationsT(k.rest);
  assert.equal(c.corps.name, 'Staff — Zed');
  const de = id => c.corps.permission_overwrites.find(o => o.id === id);
  assert.equal(BigInt(de(GUILD).deny) & PV_CONNECT, PV_CONNECT);
  for (const id of [STAFF_EVT, SUP, CASTER, STAFF, ZED]) assert.equal(BigInt(de(id).allow) & PV_CONNECT, PV_CONNECT, id);
  assert.ok(!de(R1) && !de(R2), 'les rôles des équipes n’y entrent pas');
  const salon = [...k.rest.etat.salons.values()].find(s => s.name === 'Staff — Zed').id;
  const ligne = await k.base.premier('SELECT tournoi_id, equipe_id, proprietaire_id FROM vocaux_salons WHERE salon_id = ?', [salon]);
  assert.deepEqual([ligne.tournoi_id, ligne.equipe_id, ligne.proprietaire_id], [TOURNOI, null, ZED]);
  // Contrôles ordinaires : renommer et déverrouiller possibles, liste d'amis présente.
  const boutons = k.rest.etat.messages.get(salon)[0].components.flatMap(r => r.components);
  assert.ok(!boutons.find(b => b.custom_id === `vc:r:${salon}`).disabled);
  assert.ok(boutons.some(b => b.custom_id === `vc:a:${salon}`));
  await k.moteur.evenement('VOICE_STATE_UPDATE', vsT(ZED, salon, 'Zed', [STAFF_EVT]));
  // Revenir par le hub : ramené dans son salon (un seul par personne).
  await k.moteur.evenement('VOICE_STATE_UPDATE', vsT(ZED, HUB_T, 'Zed', [STAFF_EVT]));
  await k.moteur.attendre();
  assert.equal(creationsT(k.rest).length, 1);
  assert.deepEqual(k.rest.appels.filter(a => a.chemin === `/guilds/${GUILD}/members/${ZED}`).at(-1).corps, { channel_id: salon });
  // Rôle staff supplémentaire, rôle autorisé du hub (caster), staff des salons vocaux : leur salon aussi.
  for (const [id, nom, roles, attendu] of [
    ['810000000000000402', 'Sup', [SUP], 'Casteur — Sup'],
    ['810000000000000403', 'Cas', [CASTER], 'Caster — Cas'],
    ['810000000000000404', 'Mod', [STAFF], 'Modo — Mod'],
    // Plusieurs rôles : rôles staff supplémentaires, puis rôle staff, puis rôles autorisés, puis staff des vocaux.
    ['810000000000000405', 'Multi', [STAFF, CASTER, STAFF_EVT, SUP], 'Casteur — Multi'],
    ['810000000000000406', 'Duo', [STAFF, CASTER, STAFF_EVT], 'Staff — Duo'],
    ['810000000000000407', 'Trio', [STAFF, CASTER], 'Caster — Trio'],
  ]) {
    await k.moteur.evenement('VOICE_STATE_UPDATE', vsT(id, HUB_T, nom, roles));
    await k.moteur.attendre();
    assert.equal(creationsT(k.rest).at(-1).corps.name, attendu, nom);
  }
  // Rôle d'une équipe ET du staff : l'équipe passe d'abord.
  await k.moteur.evenement('VOICE_STATE_UPDATE', vsT(J1, HUB_T, 'Kira', [R1, STAFF_EVT]));
  await k.moteur.attendre();
  assert.equal(creationsT(k.rest).at(-1).corps.name, 'LZ0 — Ligne Zéro');
  // Ni équipe ni staff : refusé, MP qui mentionne le staff.
  const n = creationsT(k.rest).length;
  await k.moteur.evenement('VOICE_STATE_UPDATE', vsT(J3, HUB_T, 'Intrus', ['720000000000000999']));
  await k.moteur.attendre();
  assert.equal(creationsT(k.rest).length, n);
  assert.match(k.rest.etat.mp.at(-1).content, /et à son staff/);
  // Fin de l'événement : salons d'équipe et du staff supprimés ensemble.
  const { nettoyerEvenement } = await import('../noyau/evenements-club/discord.mjs');
  await nettoyerEvenement({ base: k.base, fetch: k.rest.fetch, jetonBot: 'jeton-bot-de-test-jamais-reel', guildId: GUILD, maintenant: () => Date.now() }, TOURNOI);
  assert.ok(k.rest.appels.some(a => a.methode === 'DELETE' && a.chemin === `/channels/${salon}`));
  assert.equal((await k.base.tous('SELECT * FROM vocaux_salons WHERE tournoi_id = ?', [TOURNOI])).length, 0);
  k.moteur.arreter();
});
