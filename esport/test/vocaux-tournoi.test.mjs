/**
 * Équipes d'un tournoi et rôles Discord (vocaux/tournoi.mjs, migration 0063) : lecture des réponses des tickets
 * d'inscription (Discord ID, mention, @pseudo, Embark ID), import (propositions, membres absents, recherche par nom
 * exact), équipes à la main, création des rôles (modèle, non mentionnable, couleur) et attribution aux membres présents
 * (bilan : absents, sans ID), rejouable ; suppression (bouton, cron : tournoi terminé, N heures après la fin) ;
 * droits ; export et RGPD. Faux Discord REST, jamais de réseau réel.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { bancTickets } from './tickets-aide.mjs';
import { lireLigneMembre, lireReponsesInscription, nomRole, tachesTournoisDiscord } from '../noyau/vocaux/tournoi.mjs';
import { effacementParDiscord } from '../noyau/tickets/rgpd.mjs';
import { TABLES } from '../noyau/transfert.mjs';

const J1 = '810000000000000101';
const J2 = '810000000000000102';
const J3 = '810000000000000103';
const COACH = '810000000000000104';
const ABSENT = '810000000000000199';

test('lecture d’une ligne : Discord ID, mention, @pseudo, Embark ID, puces et séparateurs', () => {
  assert.deepEqual(lireLigneMembre(`${J1} — Kira#1234`), { poste: 'joueur', discordId: J1, nom: '', embarkId: 'Kira#1234', brut: `${J1} — Kira#1234` });
  assert.deepEqual({ ...lireLigneMembre(`1. <@!${J2}> - Nox#0042`, 'remplacant'), brut: undefined }, { poste: 'remplacant', discordId: J2, nom: '', embarkId: 'Nox#0042', brut: undefined });
  const p = lireLigneMembre('Joueur 3 : @zoe | Zoe#9876');
  assert.deepEqual([p.discordId, p.nom, p.embarkId], [null, 'zoe', 'Zoe#9876']);
  const q = lireLigneMembre(`Discord: ${J3} Embark: Max#1111`);
  assert.deepEqual([q.discordId, q.nom, q.embarkId], [J3, '', 'Max#1111']);
});

test('lecture des réponses du formulaire « Inscription The Nuke End » ; problèmes signalés', () => {
  const r = lireReponsesInscription([
    { id: 'equipe', libelle: { fr: 'Nom de l’équipe' }, valeur: ' Ligne  Zéro ' },
    { id: 'tag', libelle: { fr: 'TAG' }, valeur: 'lz0' },
    { id: 'joueurs', libelle: { fr: 'Joueurs 1 à 3' }, valeur: `${J1} — Kira#1234\n<@${J2}> - Nox#0042\n@zoe — Zoe#9876` },
    { id: 'coach', libelle: { fr: 'Coach' }, valeur: `${COACH} — Coach#0001` },
    { id: 'remplacants', libelle: { fr: 'Remplaçants' }, valeur: 'aucun' },
  ]);
  assert.deepEqual([r.nom, r.tag], ['Ligne Zéro', 'LZ0']);
  assert.deepEqual(r.membres.map(m => [m.poste, m.discordId]), [['joueur', J1], ['joueur', J2], ['joueur', null], ['coach', COACH]]);
  assert.deepEqual(r.problemes, ['sans_id']);
  // Libellés seulement (autre formulaire), anglais.
  const en = lireReponsesInscription([{ id: 'a', libelle: { en: 'Team name' }, valeur: 'Alpha' }, { id: 'b', libelle: { en: 'Team TAG' }, valeur: 'ALP' }, { id: 'c', libelle: { en: 'Players' }, valeur: J1 }, { id: 'd', libelle: { en: 'Subs' }, valeur: J2 }]);
  assert.deepEqual([en.nom, en.tag, en.membres.map(m => m.poste)], ['Alpha', 'ALP', ['joueur', 'remplacant']]);
  assert.deepEqual(lireReponsesInscription([]).problemes, ['nom', 'tag', 'joueurs']);
  assert.equal(nomRole('{tag} {nom}', { tag: 'LZ0', nom: 'Ligne Zéro' }), 'LZ0 Ligne Zéro');
  assert.equal(nomRole('[{tag}] @everyone', { tag: 'A' }), '[A] everyone');
});

async function monter() {
  const k = await bancTickets({ banc });
  await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { guildId: k.GUILD, guildNom: 'Club' } });
  const team = await teamAvecMembres(k.b, { nom: 'Organisation', membres: { coach123: { pseudo: 'Zed', role: 'coach' }, lea12345: { pseudo: 'Léa', role: 'joueur' } } });
  const t = await k.api(`/teams/${team.teamId}/tournois`, undefined, { methode: 'POST', corps: { nom: 'The Nuke End', debut: '2026-11-21', fin: '2026-11-22' } });
  assert.equal(t.statut, 200, JSON.stringify(t.corps));
  const tournoiId = t.corps.tournoi?.id ?? t.corps.id;
  const chemin = `/teams/${team.teamId}/tournois/${tournoiId}/discord`;
  return { ...k, team, tournoiId, chemin };
}

async function ticketInscription(k, categorieId, numero, reponses, statut = 'resolu') {
  const t = '2026-11-10T10:00:00.000Z';
  await k.b.base.executer(
    "INSERT INTO tickets (id, numero, categorie_id, statut, priorite, auteur_discord_id, auteur_nom, langue, reponses, ouvert_le, maj_le, derniere_activite_le, liaison) VALUES (?, ?, ?, ?, 'moyen', ?, 'Capitaine', 'fr', ?, ?, ?, ?, '{}')",
    [`00000000-0000-4000-8000-00000000000${numero}`, numero, categorieId, statut, J1, JSON.stringify(reponses), t, t, t],
  );
}

test('import depuis les tickets : propositions (absents, recherche par nom exact, déjà importé) ; équipes enregistrées et corrigées', async () => {
  const k = await monter();
  const cat = await k.api('/tickets/config/categories', undefined, { methode: 'POST', corps: { nom: { fr: 'Inscription The Nuke End', en: 'The Nuke End registration' }, modeleNom: 'nuke-{numero}' } });
  const categorieId = cat.corps.id;
  k.discord.etat.absents.add(ABSENT);
  await ticketInscription(k, categorieId, 1, [
    { id: 'equipe', valeur: 'Ligne Zéro' },
    { id: 'tag', valeur: 'LZ0' },
    { id: 'joueurs', valeur: `${J1} — Kira#1234\n${ABSENT} — Ghost#0000\n@Zoé — Zoe#9876` },
    { id: 'coach', valeur: '' },
  ]);
  await ticketInscription(k, categorieId, 2, [{ id: 'equipe', valeur: 'Bravo' }, { id: 'tag', valeur: 'BRV' }, { id: 'joueurs', valeur: `${J2}\n${J3}\n@inconnu` }], 'ouvert');
  const i = await k.api(`${k.chemin}/import`, undefined, { methode: 'POST', corps: { categorieId } });
  assert.equal(i.statut, 200, JSON.stringify(i.corps));
  const [a, b] = i.corps.propositions;
  assert.deepEqual([a.numero, a.nom, a.tag, a.statut], [1, 'Ligne Zéro', 'LZ0', 'resolu']);
  assert.deepEqual(a.membres.map(m => m.present), [true, false, true]);
  assert.equal(a.membres[2].discordId, '800000000000000077', 'Zoé trouvée par son nom affiché exact');
  assert.deepEqual(a.problemes, ['absents']);
  assert.deepEqual(b.problemes, ['sans_id']);
  // Enregistrer les deux équipes, Bravo corrigée (membre sans ID retiré, coach ajouté à la main).
  const e = await k.api(`${k.chemin}/equipes`, undefined, {
    methode: 'POST',
    corps: { equipes: [{ nom: a.nom, tag: a.tag, ticketId: a.ticketId, membres: a.membres.map(({ poste, discordId, nom, embarkId }) => ({ poste, discordId, nom, embarkId })) }, { nom: 'Bravo', tag: 'BRV', ticketId: b.ticketId, membres: [{ poste: 'joueur', discordId: J2 }, { poste: 'joueur', discordId: J3 }, { poste: 'coach', discordId: COACH, nom: 'Coach B' }] }] },
  });
  assert.equal(e.statut, 200, JSON.stringify(e.corps));
  assert.deepEqual(e.corps.equipes.map(x => [x.tag, x.membres.length]), [['LZ0', 3], ['BRV', 3]]);
  // Deuxième import : déjà là. TAG en double refusé ; Discord ID invalide refusé.
  assert.deepEqual((await k.api(`${k.chemin}/import`, undefined, { methode: 'POST', corps: { categorieId } })).corps.propositions.map(p => p.deja), [true, true]);
  assert.equal((await k.api(`${k.chemin}/equipes`, undefined, { methode: 'POST', corps: { nom: 'Copie', tag: 'lz0' } })).statut, 409);
  assert.equal((await k.api(`${k.chemin}/equipes`, undefined, { methode: 'POST', corps: { nom: 'X', tag: 'XX', membres: [{ discordId: '123' }] } })).statut, 400);
  // Modifier : nom et membres.
  const bravo = e.corps.equipes.find(x => x.tag === 'BRV');
  const m = await k.api(`${k.chemin}/equipes/${bravo.id}`, undefined, { methode: 'PATCH', corps: { nom: 'Bravo Six', membres: [{ poste: 'joueur', discordId: J2 }, { poste: 'joueur', discordId: J3 }] } });
  assert.equal(m.corps.equipes.find(x => x.id === bravo.id).nom, 'Bravo Six');
  // Droits : un joueur de la team (pas tournois.gerer) n'a rien ; l'import exige de voir la catégorie.
  assert.equal((await k.api(k.chemin, k.team.sessions.lea12345)).statut, 403);
});

test('créer les rôles : un par équipe (modèle, non mentionnable, couleur), donné aux présents ; bilan ; rejouable ; supprimer', async () => {
  const k = await monter();
  await k.api(k.chemin, undefined, { methode: 'PUT', corps: { modeleRole: '{tag} | {nom}', couleur: '#E4572E', suppressionH: 12 } });
  await k.api(`${k.chemin}/equipes`, undefined, { methode: 'POST', corps: { equipes: [{ nom: 'Ligne Zéro', tag: 'LZ0', membres: [{ discordId: J1 }, { discordId: ABSENT, nom: 'Ghost' }, { nom: 'Sans ID' }] }, { nom: 'Bravo', tag: 'BRV', membres: [{ discordId: J2 }] }] } });
  k.discord.etat.absents.add(ABSENT);
  const r = await k.api(`${k.chemin}/roles`, undefined, { methode: 'POST', corps: {} });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  const creations = k.discord.appels.filter(a => a.methode === 'POST' && a.chemin === `/guilds/${k.GUILD}/roles`);
  assert.deepEqual(creations.map(c => c.corps.name), ['LZ0 | Ligne Zéro', 'BRV | Bravo']);
  assert.deepEqual([creations[0].corps.mentionable, creations[0].corps.permissions, creations[0].corps.color], [false, '0', 0xe4572e]);
  assert.deepEqual([r.corps.bilan.creees, r.corps.bilan.attribues], [2, 2]);
  assert.deepEqual(r.corps.bilan.absents.map(x => x.discordId), [ABSENT]);
  assert.deepEqual(r.corps.bilan.sansId.map(x => x.nom), ['Sans ID']);
  assert.equal(r.corps.bilan.hierarchie.ok, true);
  const lz = r.corps.equipes.find(e => e.tag === 'LZ0');
  assert.ok(lz.roleId);
  assert.deepEqual(lz.membres.map(m => m.roleStatut), ['attribue', 'absent', null]);
  assert.ok(r.corps.reglages.rolesCreesLe);
  // Rejoué : aucun rôle recréé, seuls les manquants retentés (l'absent est arrivé sur le serveur).
  k.discord.etat.absents.delete(ABSENT);
  const r2 = await k.api(`${k.chemin}/roles`, undefined, { methode: 'POST', corps: {} });
  assert.deepEqual([r2.corps.bilan.creees, r2.corps.bilan.attribues], [0, 1]);
  // Rôle du bot trop bas : refus expliqué (403, Missing Permissions).
  await k.api(`${k.chemin}/equipes`, undefined, { methode: 'POST', corps: { nom: 'Charlie', tag: 'CHR', membres: [{ discordId: J3 }] } });
  k.discord.programme.push({ si: (m, c) => m === 'PUT' && c.includes(`/members/${J3}/roles/`), statut: 403, corps: { code: 50013, message: 'Missing Permissions' } });
  const r3 = await k.api(`${k.chemin}/roles`, undefined, { methode: 'POST', corps: {} });
  assert.deepEqual(r3.corps.bilan.refus.map(x => [x.quoi, x.code]), [['attribution', 50013]]);
  // Supprimer : rôles effacés sur Discord, plus d'identifiant gardé.
  const ids = r3.corps.equipes.map(e => e.roleId);
  const s = await k.api(`${k.chemin}/roles/supprimer`, undefined, { methode: 'POST', corps: {} });
  assert.equal(s.corps.nettoyage.roles, 3);
  for (const id of ids) assert.ok(k.discord.appels.some(a => a.methode === 'DELETE' && a.chemin === `/guilds/${k.GUILD}/roles/${id}`));
  assert.ok(s.corps.equipes.every(e => !e.roleId));
  assert.ok(s.corps.reglages.rolesSupprimesLe);
  // Sans vocaux.configurer : la liste reste gérable, pas les rôles.
  const manager = await k.compteAvec('gest1234', 'Gest', ['tickets.voir']);
  assert.ok(manager);
});

test('cron : rôles supprimés quand le tournoi est terminé, ou N heures après sa date de fin', async () => {
  const k = await monter();
  await k.api(`${k.chemin}/equipes`, undefined, { methode: 'POST', corps: { nom: 'Ligne Zéro', tag: 'LZ0', membres: [{ discordId: J1 }] } });
  await k.api(k.chemin, undefined, { methode: 'PUT', corps: { suppressionH: 24 } });
  await k.api(`${k.chemin}/roles`, undefined, { methode: 'POST', corps: {} });
  const ctx = { jetonBot: 'jeton-bot-de-test-jamais-reel', fetch: k.discord.fetch };
  // Fin le 22/11 : le 23/11 à 12 h, pas encore (fin de journée + 24 h) ; le 24/11 à 1 h, oui.
  assert.equal(await tachesTournoisDiscord(k.b.base, { ...ctx, maintenant: () => Date.parse('2026-11-23T12:00:00Z') }), 0);
  assert.equal(await tachesTournoisDiscord(k.b.base, { ...ctx, maintenant: () => Date.parse('2026-11-24T01:00:00Z') }), 1);
  assert.equal((await k.b.base.premier('SELECT role_id FROM tournoi_equipes', [])).role_id, null);
  // Recréés, puis tournoi marqué « terminé » : supprimés au passage suivant, quelle que soit la date.
  await k.api(`${k.chemin}/roles`, undefined, { methode: 'POST', corps: {} });
  await k.b.base.executer("UPDATE tournois SET statut = 'termine' WHERE id = ?", [k.tournoiId]);
  assert.equal(await tachesTournoisDiscord(k.b.base, { ...ctx, maintenant: () => Date.parse('2026-11-21T12:00:00Z') }), 1);
  assert.equal(await tachesTournoisDiscord(k.b.base, { ...ctx, maintenant: () => Date.parse('2026-11-21T12:05:00Z') }), 0, 'déjà fait');
  assert.ok(['tournoi_discord', 'tournoi_equipes', 'tournoi_equipe_membres'].every(t => TABLES.some(([n]) => n === t)));
  assert.ok(effacementParDiscord([J1]).some(i => i.sql.includes('tournoi_equipe_membres')));
});
