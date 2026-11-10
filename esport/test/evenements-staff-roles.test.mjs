/**
 * Rôles staff supplémentaires d'un événement (evenements-club/staff-sup.mjs, docs/esport/evenements.md) : libellé
 * court du rôle (salon du staff « {role} — {pseudo} ») et ordre de priorité ; rôles existants choisis (refus des rôles
 * dangereux), « Supprimer ce rôle à la fin de l'événement » (oui par défaut, désactivable, revérifié avant la
 * suppression) ; « Créer un rôle staff » (appartient à l'événement, donné aux membres choisis, supprimé à la fin) ;
 * liste exacte des rôles supprimés annoncée. Faux Discord, jamais de réseau réel.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc } from './aide.mjs';
import { bancTickets } from './tickets-aide.mjs';
import { etiquetteRole, libelleStaff, lireSup, raisonInterdite } from '../noyau/evenements-club/staff-sup.mjs';

const SUP = '720000000000000090';
const AUTRE = '720000000000000091';
const ADMIN = '720000000000000092';
const GEREUR = '720000000000000093';
const INTEG = '720000000000000094';
const HAUT = '720000000000000095';
const ZED = '810000000000000301';

test('libellé court d’un rôle : nom sans l’événement, sans symboles ni emoji, espaces réduits ; « Staff » si vide', () => {
  assert.equal(etiquetteRole('⟡ Casteur The Nuke End ⟡', 'The Nuke End'), 'Casteur');
  assert.equal(etiquetteRole('🎙️ Commentateur — the nuke end', 'The Nuke End'), 'Commentateur');
  assert.equal(etiquetteRole('Admin   LAN • 2026', 'The Nuke End'), 'Admin LAN 2026');
  assert.equal(etiquetteRole('★ The Nuke End ★', 'The Nuke End'), 'Staff');
  assert.equal(etiquetteRole('', ''), 'Staff');
  assert.equal(etiquetteRole("Régie d'antenne", ''), "Régie d'antenne");
});

test('libellé du salon du staff : rôles staff supplémentaires (ordre de la liste), rôle staff, rôles autorisés du hub, staff des vocaux', () => {
  const sup = lireSup([{ id: SUP, nom: '⟡ Casteur The Nuke End ⟡' }, { id: AUTRE, nom: 'Arbitre', label: 'Arbitrage' }]);
  const hub = { rolesAutorises: ['720000000000000060', '720000000000000061'], etiquettes: { '720000000000000061': 'Prod' } };
  const base = { sup, staffRoleId: '720000000000000500', hub, rolesStaff: ['720000000000000001'], etiquettesStaff: {}, nomsRoles: new Map([['720000000000000060', 'Caster The Nuke End'], ['720000000000000001', 'Modération']]), nomEvenement: 'The Nuke End' };
  const l = roles => libelleStaff({ ...base, roles })?.label ?? null;
  assert.equal(l([AUTRE, SUP]), 'Casteur', 'ordre de la liste des rôles staff supplémentaires');
  assert.equal(l([AUTRE]), 'Arbitrage', 'libellé saisi');
  assert.equal(l(['720000000000000500', '720000000000000060']), 'Staff');
  assert.equal(l(['720000000000000061', '720000000000000060']), 'Caster', 'ordre des rôles autorisés du hub');
  assert.equal(l(['720000000000000061']), 'Prod');
  assert.equal(l(['720000000000000001']), 'Modération');
  assert.equal(l(['720000000000000999']), null);
  // Ancien format (identifiants) relu sans suppression à la fin.
  assert.deepEqual(lireSup(JSON.stringify([SUP])), [{ id: SUP, nom: '', label: '', couleur: null, supprimerFin: false, cree: false, membres: [] }]);
});

test('rôles interdits : @everyone, géré, Administrateur / Gérer le serveur / Gérer les rôles, au niveau du bot ou au-dessus', () => {
  const o = { guildId: '700000000000000001', positionBot: 3 };
  assert.equal(raisonInterdite({ id: '700000000000000001' }, o), 'everyone');
  assert.equal(raisonInterdite({ id: INTEG, managed: true }, o), 'gere');
  for (const p of [1n << 3n, 1n << 5n, 1n << 28n]) assert.equal(raisonInterdite({ id: ADMIN, permissions: String(p), position: 1 }, o), 'permissions');
  assert.equal(raisonInterdite({ id: HAUT, permissions: '0', position: 3 }, o), 'au-dessus-du-bot');
  assert.equal(raisonInterdite({ id: SUP, permissions: String(1n << 10n), position: 2 }, o), null);
});

async function monter() {
  const k = await bancTickets({ banc });
  await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { guildId: k.GUILD, guildNom: 'Club' } });
  k.discord.etat.listerCrees = true;
  for (const [id, name, extra] of [
    [SUP, '⟡ Casteur The Nuke End ⟡', {}],
    [AUTRE, 'Arbitre', {}],
    [ADMIN, 'Admin', { permissions: String(1n << 3n) }],
    [GEREUR, 'Gère les rôles', { permissions: String(1n << 28n) }],
    [INTEG, 'Intégration', { managed: true }],
    [HAUT, 'Direction', { position: 5 }],
  ])
    k.discord.etat.roles.set(id, { id, name, position: 1, permissions: '0', ...extra });
  const cat = (await k.api('/tickets/config/categories', undefined, { methode: 'POST', corps: { nom: { fr: 'Support', en: 'Support' }, modeleNom: 't-{numero}' } })).corps.id;
  const id = (await k.api('/evenements', undefined, { methode: 'POST', corps: { nom: 'The Nuke End' } })).corps.evenement.id;
  return { ...k, id, chemin: `/evenements/${id}`, cat };
}
const supprimes = k => k.discord.appels.filter(a => a.methode === 'DELETE' && /^\/guilds\/\d+\/roles\/\d+$/.test(a.chemin)).map(a => a.chemin.split('/').pop());

test('rôles existants : refus des rôles dangereux ; « supprimer à la fin » oui par défaut, désactivable ; liste annoncée ; supprimés à la fin après nouvelle vérification', async () => {
  const k = await monter();
  for (const [x, code] of [[ADMIN, 'evenement-staff-role-interdit'], [GEREUR, 'evenement-staff-role-interdit'], [INTEG, 'evenement-staff-role-interdit'], [HAUT, 'evenement-staff-role-interdit'], ['720000000000000777', 'evenement-staff-role-introuvable']]) {
    const r = await k.api(k.chemin, undefined, { methode: 'PATCH', corps: { discord: { staffRolesSup: [{ id: x }] } } });
    assert.deepEqual([r.statut, r.corps.code], [400, code], x);
  }
  const m = await k.api(k.chemin, undefined, { methode: 'PATCH', corps: { categoriesTickets: [k.cat], discord: { staffRolesSup: [{ id: SUP, label: '' }, { id: AUTRE, supprimerFin: false, label: 'Arbitrage' }] } } });
  assert.equal(m.statut, 200, JSON.stringify(m.corps));
  assert.deepEqual(m.corps.evenement.discord.staffRolesSup.map(e => [e.id, e.supprimerFin, e.cree, e.label]), [[SUP, true, false, ''], [AUTRE, false, false, 'Arbitrage']]);
  // La confirmation de suppression (et la fin) annonce exactement les rôles supprimés.
  const roles = m.corps.suppression.roles;
  assert.ok(roles.some(r => r.id === SUP && r.quoi === 'staff-existant'));
  assert.ok(!roles.some(r => r.id === AUTRE));
  // Fin : SUP supprimé (revérifié), AUTRE gardé (sauf ses accès ajoutés par l'événement).
  const fin = await k.api(`${k.chemin}/roles/supprimer`, undefined, { methode: 'POST', corps: {} });
  assert.equal(fin.statut, 200, JSON.stringify(fin.corps));
  assert.ok(supprimes(k).includes(SUP));
  assert.ok(!supprimes(k).includes(AUTRE));
  assert.deepEqual(fin.corps.evenement.discord.staffRolesSup.map(e => e.id), [AUTRE], 'le rôle supprimé quitte la liste');
  assert.ok(!JSON.parse((await k.b.base.premier('SELECT roles_discord FROM tickets_categories WHERE id = ?', [k.cat])).roles_discord).includes(AUTRE));
});

test('rôle devenu dangereux avant la fin : jamais supprimé (ignoré, noté) ; les autres le sont', async () => {
  const k = await monter();
  await k.api(k.chemin, undefined, { methode: 'PATCH', corps: { discord: { staffRolesSup: [{ id: SUP }, { id: AUTRE }] } } });
  k.discord.etat.roles.get(SUP).permissions = String(1n << 3n);
  const fin = await k.api(`${k.chemin}/roles/supprimer`, undefined, { methode: 'POST', corps: {} });
  assert.deepEqual(fin.corps.nettoyage.ignores.map(x => [x.id, x.raison]), [[SUP, 'permissions']]);
  assert.ok(!supprimes(k).includes(SUP));
  assert.ok(supprimes(k).includes(AUTRE));
});

test('« Créer un rôle staff » : créé (nom, couleur), donné aux membres choisis, mêmes droits ; appartient à l’événement et supprimé avec lui', async () => {
  const k = await monter();
  await k.api(k.chemin, undefined, { methode: 'PATCH', corps: { categoriesTickets: [k.cat] } });
  const r = await k.api(`${k.chemin}/staff-roles`, undefined, { methode: 'POST', corps: { nom: 'Casteur The Nuke End', couleur: '#E4572E', label: 'Casteur', membres: [ZED] } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  const e = r.corps.evenement.discord.staffRolesSup.at(-1);
  assert.deepEqual([e.nom, e.label, e.couleur, e.cree, e.supprimerFin, e.membres], ['Casteur The Nuke End', 'Casteur', '#e4572e', true, true, [ZED]]);
  assert.equal(k.discord.etat.roles.get(e.id).color, 0xe4572e);
  assert.ok(k.discord.appels.some(a => a.methode === 'PUT' && a.chemin === `/guilds/${k.GUILD}/members/${ZED}/roles/${e.id}`));
  assert.ok(JSON.parse((await k.b.base.premier('SELECT roles_discord FROM tickets_categories WHERE id = ?', [k.cat])).roles_discord).includes(e.id));
  assert.ok(r.corps.suppression.roles.some(x => x.id === e.id && x.quoi === 'staff-cree'));
  // Membre retiré du rôle créé : rôle retiré.
  await k.api(k.chemin, undefined, { methode: 'PATCH', corps: { discord: { staffRolesSup: [{ id: e.id, membres: [] }] } } });
  assert.ok(k.discord.appels.some(a => a.methode === 'DELETE' && a.chemin === `/guilds/${k.GUILD}/members/${ZED}/roles/${e.id}`));
  // Suppression de l'événement : le rôle créé part avec lui.
  assert.equal((await k.api(k.chemin, undefined, { methode: 'DELETE' })).statut, 200);
  assert.ok(supprimes(k).includes(e.id));
  // Sans nom : refusé.
  const id2 = (await k.api('/evenements', undefined, { methode: 'POST', corps: { nom: 'LAN' } })).corps.evenement.id;
  assert.equal((await k.api(`/evenements/${id2}/staff-roles`, undefined, { methode: 'POST', corps: { nom: ' ' } })).statut, 400);
});
