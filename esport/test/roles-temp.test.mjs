/**
 * Rôles Discord temporaires des teams (migration 0066, docs/esport/bot-discord.md) : commande /role-temp (donner,
 * retirer, liste) dans le payload d'enregistrement ; team de l'appelant résolue depuis son compte lié (une team, plusieurs
 * teams avec l'option `equipe`, rôle non autorisé, compte non lié) ; octroi, prolongation, retrait ; échéance par le cron
 * (horloge simulée) avec 404, limite de débit et hiérarchie des rôles ; commandes désactivables / réservées à des rôles ;
 * réglages et liste dans l'app (droits). Faux Discord, jamais de réseau réel.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { attendre, bancTickets, fauxDiscordRest, fauxGateway } from './tickets-aide.mjs';
import { baseMigree } from './base.mjs';
import { creerSuperviseurTickets } from '../noyau/tickets/superviseur.mjs';
import { appelEnregistrement, definitionsCommandes, SOUS_COMMANDES_ROLE_TEMP } from '../noyau/discord/bot/commandes.mjs';
import { LIMITES_ROLES_TEMP, REGLAGES_DEFAUT, validerCommandesRolesTemp, validerReglagesEquipe } from '../noyau/roles-temp/reglages.mjs';
import { ESSAIS_MAX, expirerRolesTemp, lireDuree, octroiActif } from '../noyau/roles-temp/moteur.mjs';
import { equipesDuMembre } from '../noyau/roles-temp/equipes.mjs';
import { TABLES } from '../noyau/transfert.mjs';
import { tachesPlanifiees } from '../noyau/cron.mjs';
import { distribuer } from '../noyau/evenements.mjs';

const JETON = 'jeton-bot-de-test-jamais-reel';
const H = 3_600_000;
const ROLE_TF = '730000000000000001';
const ROLE_VAL = '730000000000000002';
// Noms de rôles Discord avec de l'Unicode fantaisie : affichés tels quels.
const NOM_TF = '⟡ 🎤𝙄𝙣𝙩𝙚𝙧𝙫𝙚𝙣𝙖𝙣𝙩 𝙏𝙁 ⟡';
const NOM_VAL = '⟡ 🎤Intervenant VAL ⟡';
const JOURNAL = '710000000000000013';
const COACH_TF = '810000000000000001';
const COACH_DEUX = '810000000000000002';
const JOUEUR = '810000000000000003';
const MANAGER = '810000000000000004';
const TO1 = '820000000000000001';
const TO2 = '820000000000000002';
const TO3 = '820000000000000003';

async function monter({ mp = true, journal = true } = {}) {
  const k = await bancTickets({ banc });
  const { b, discord } = k;
  // Le faux Discord liste aussi les rôles créés (etat.roles) : ceux des teams.
  discord.etat.listerCrees = true;
  await b.base.executer('INSERT INTO tickets_reglages (cle, valeur, maj_le) VALUES (?, ?, ?) ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur', ['general', JSON.stringify({ actif: false, guildId: k.GUILD, guildNom: 'Ligne Zéro', langue: 'fr_en' }), '2026-01-01T00:00:00.000Z']);
  discord.etat.roles.set(ROLE_TF, { id: ROLE_TF, name: NOM_TF, position: 10, color: 0 });
  discord.etat.roles.set(ROLE_VAL, { id: ROLE_VAL, name: NOM_VAL, position: 2, color: 0 });
  const tf = await teamAvecMembres(b, { nom: 'The Final LZ0', membres: { coachtf01: { pseudo: 'Coach TF', role: 'coach' }, coachmul1: { pseudo: 'Coach Multi', role: 'coach' }, joueur001: { pseudo: 'Joueur', role: 'joueur' }, manager01: { pseudo: 'Manager', role: 'manager' } } });
  const val = await teamAvecMembres(b, { nom: 'Valorant LZ0', membres: { coachmul1: { pseudo: 'Coach Multi', role: 'coach' } } });
  const lier = async (compte, discordId, superAdmin = 0) => b.base.executer("INSERT INTO discord_comptes (compte_id, discord_user_id, discord_nom, super_admin, lie_le) VALUES (?, ?, 'x', ?, '2026-01-01T00:00:00.000Z')", [compte, discordId, superAdmin]);
  await lier('coachtf01', COACH_TF);
  await lier('coachmul1', COACH_DEUX);
  await lier('joueur001', JOUEUR);
  await lier('manager01', MANAGER);
  const regler = (equipe, role, nom, extra = {}) => k.api(`/teams/${equipe.teamId}/roles-temporaires/reglages`, k.fondateur, { methode: 'PUT', corps: { actif: true, roleId: role, roleNom: nom, salonJournalId: journal ? JOURNAL : null, mp, ...extra } });
  const r1 = await regler(tf, ROLE_TF, NOM_TF);
  assert.equal(r1.statut, 200, JSON.stringify(r1.corps));
  const r2 = await regler(val, ROLE_VAL, NOM_VAL);
  assert.equal(r2.statut, 200, JSON.stringify(r2.corps));
  const cmd = (qui, sous, options = {}, { roles = [], permissions = '0', guild = k.GUILD, type = 2, focus, resolved } = {}) =>
    k.interaction({
      type,
      locale: 'fr',
      guild_id: guild,
      channel_id: '710000000000000013',
      member: { user: { id: qui, username: `u${qui.slice(-3)}` }, roles, permissions },
      data: { name: 'role-temp', options: [{ type: 1, name: sous, options: Object.entries(options).map(([name, value]) => ({ name, value, ...(focus === name ? { focused: true } : {}) })) }], resolved: resolved ?? { users: Object.fromEntries([TO1, TO2, TO3].map(id => [id, { id, username: `to${id.slice(-1)}` }])), members: { [TO1]: { nick: 'Try-Out Un' } } } },
    });
  const contenu = r => r.corps.data.content;
  const maintenant = () => b.horloge.t;
  return { ...k, tf, val, lier, regler, cmd, contenu, maintenant };
}

test('définitions : /role-temp (donner, retirer, liste) dans le payload d’enregistrement, FR / EN, limites de Discord', () => {
  const defs = definitionsCommandes();
  const c = defs.find(d => d.name === 'role-temp');
  assert.ok(c, 'commande présente dans les commandes à enregistrer');
  assert.deepEqual(c.options.map(o => o.name), ['donner', 'retirer', 'liste']);
  assert.deepEqual(c.contexts, [0]);
  assert.ok(appelEnregistrement('123456789012345678').corps.some(d => d.name === 'role-temp'));
  for (const s of SOUS_COMMANDES_ROLE_TEMP) {
    assert.equal(s.type, 1);
    assert.ok(s.description.length <= 100 && s.description_localizations.fr.length <= 100, s.name);
    // Options obligatoires avant les facultatives ; noms ASCII courts.
    const requis = (s.options ?? []).map(o => Boolean(o.required));
    assert.deepEqual(requis, [...requis].sort((a, b) => Number(b) - Number(a)), `${s.name} : ordre des options`);
    for (const o of s.options ?? []) assert.ok(/^[a-z]{1,32}$/.test(o.name) && o.description_localizations.fr && o.description.length <= 100, `${s.name}.${o.name}`);
  }
  const donner = SOUS_COMMANDES_ROLE_TEMP[0];
  assert.deepEqual(donner.options.map(o => o.name), ['membre', 'duree', 'raison', 'equipe']);
  assert.equal(donner.options.find(o => o.name === 'equipe').autocomplete, true);
  assert.equal(donner.options.find(o => o.name === 'membre').type, 6);
});

test('durées saisies : 24h, 90m, 2j, 1h30, nombre seul (heures) ; réglages validés (bornes, rôle requis, rôles de la team)', () => {
  assert.equal(lireDuree('24h'), 24 * H);
  assert.equal(lireDuree('90m'), 90 * 60_000);
  assert.equal(lireDuree('2j'), 48 * H);
  assert.equal(lireDuree('2 d'), 48 * H);
  assert.equal(lireDuree('1h30'), 90 * 60_000);
  assert.equal(lireDuree('36'), 36 * H);
  assert.equal(lireDuree('bientôt'), null);
  assert.equal(lireDuree(''), null);
  const vide = { ...REGLAGES_DEFAUT, rolesAutorises: [] };
  assert.throws(() => validerReglagesEquipe({ actif: true }, vide), /Choisissez le rôle/);
  assert.throws(() => validerReglagesEquipe({ dureeDefautH: 0 }, vide), /hors limites/);
  assert.throws(() => validerReglagesEquipe({ dureeDefautH: LIMITES_ROLES_TEMP.dureeMaxH + 1 }, vide), /hors limites/);
  assert.throws(() => validerReglagesEquipe({ maxSimultanes: 0 }, vide), /hors limites/);
  assert.throws(() => validerReglagesEquipe({ roleId: 'abc' }, vide), /Identifiant Discord/);
  assert.throws(() => validerReglagesEquipe({ rolesAutorises: ['x'] }, vide), /Liste de rôles/);
  const s = validerReglagesEquipe({ actif: true, roleId: ROLE_TF, roleNom: `  ${NOM_TF}  `, dureeDefautH: 48, maxSimultanes: 3 }, vide);
  assert.deepEqual([s.roleNom, s.dureeDefautH, s.maxSimultanes, s.mp], [NOM_TF, 48, 3, true]);
  assert.throws(() => validerCommandesRolesTemp({ donner: { roles: ['x'] } }), /Liste d’identifiants/);
});

test('team de l’appelant : une team, plusieurs teams, rôle non autorisé, compte non lié, Fondateur', async () => {
  const k = await monter();
  const base = k.b.base;
  const seule = await equipesDuMembre(base, COACH_TF, k.GUILD);
  assert.deepEqual(seule.equipes.map(e => e.nom), ['The Final LZ0']);
  const plusieurs = await equipesDuMembre(base, COACH_DEUX, k.GUILD);
  assert.deepEqual(plusieurs.equipes.map(e => e.nom), ['The Final LZ0', 'Valorant LZ0']);
  assert.deepEqual((await equipesDuMembre(base, MANAGER, k.GUILD)).equipes.map(e => e.nom), ['The Final LZ0'], 'Manager autorisé par défaut');
  const joueur = await equipesDuMembre(base, JOUEUR, k.GUILD);
  assert.deepEqual([joueur.equipes.length, joueur.raison], [0, 'pas_autorise']);
  const inconnu = await equipesDuMembre(base, '899999999999999999', k.GUILD);
  assert.deepEqual([inconnu.lie, inconnu.raison], [false, 'lier']);
  assert.equal((await equipesDuMembre(base, COACH_TF, '799999999999999999')).raison, 'autre_serveur');
  // Rôle de la team autorisé en plus : le Joueur peut alors donner le rôle.
  const joueurRole = tf => tf.roles.joueur.id;
  assert.equal((await k.regler(k.tf, ROLE_TF, NOM_TF, { rolesAutorises: [joueurRole(k.tf)] })).statut, 200);
  assert.deepEqual((await equipesDuMembre(base, JOUEUR, k.GUILD)).equipes.map(e => e.nom), ['The Final LZ0']);
  assert.deepEqual((await equipesDuMembre(base, COACH_TF, k.GUILD)).equipes.length, 0, 'liste explicite : le Coach n’est plus autorisé d’office');
  // Rôles temporaires désactivés pour la team : « non configuré ».
  await k.api(`/teams/${k.val.teamId}/roles-temporaires/reglages`, k.fondateur, { methode: 'PUT', corps: { actif: false } });
  const sansVal = await equipesDuMembre(base, COACH_DEUX, k.GUILD);
  assert.deepEqual(sansVal.equipes.map(e => e.nom), []);
  assert.equal(sansVal.raison, 'non_configure', 'autorisé dans cette team, mais rôle temporaire désactivé');
});

test('/role-temp donner : rôle ajouté (PUT), octroi noté, réponse éphémère, MP, journal ; redonner prolonge sans raccourcir', async () => {
  const k = await monter();
  const r = await k.cmd(COACH_TF, 'donner', { membre: TO1, raison: 'Try-out du samedi' });
  assert.equal(r.corps.data.flags, 64);
  assert.match(k.contenu(r), /donné à <@820000000000000001> pour The Final LZ0/);
  assert.ok(k.contenu(r).includes(NOM_TF), 'nom du rôle affiché tel quel');
  const put = k.discord.appels.find(a => a.methode === 'PUT' && a.chemin === `/guilds/${k.GUILD}/members/${TO1}/roles/${ROLE_TF}`);
  assert.ok(put, 'PUT /guilds/{g}/members/{id}/roles/{role}');
  assert.ok(put.entetes['X-Audit-Log-Reason'], 'raison dans le journal d’audit');
  const o = await octroiActif(k.b.base, k.tf.teamId, TO1);
  assert.deepEqual([o.roleId, o.roleNom, o.accordeParDiscordId, o.raison, o.statut, o.membreNom], [ROLE_TF, NOM_TF, COACH_TF, 'Try-out du samedi', 'actif', 'Try-Out Un']);
  assert.equal(Date.parse(o.expireLe), k.maintenant() + 24 * H, '24 h par défaut');
  assert.equal(o.accordePar, 'coachtf01');
  // MP à la personne, message dans le salon des journaux (bilingue : français puis anglais en citation).
  assert.equal(k.discord.etat.mp.length, 1);
  assert.match(k.discord.etat.mp[0].content, /Tu as reçu le rôle/);
  assert.match(k.discord.etat.mp[0].content, /> You received the role/);
  const journal = k.discord.appels.find(a => a.chemin === `/channels/${JOURNAL}/messages`);
  assert.match(journal.corps.content, /a donné le rôle/);
  assert.deepEqual(journal.corps.allowed_mentions, { parse: [] });
  const evt = await k.b.base.tous("SELECT action FROM journal WHERE team_id = ? AND action = 'discord.role_temp_given'", [k.tf.teamId]);
  assert.equal(evt.length, 1);
  // Redonner 6 h : l'échéance (24 h) n'est jamais raccourcie ; 48 h : prolongée.
  k.b.horloge.t += 2 * H;
  const encore = await k.cmd(COACH_TF, 'donner', { membre: TO1, duree: '6h' });
  assert.match(k.contenu(encore), /déjà le rôle/);
  assert.equal(Date.parse((await octroiActif(k.b.base, k.tf.teamId, TO1)).expireLe), Date.parse(o.expireLe));
  await k.cmd(COACH_TF, 'donner', { membre: TO1, duree: '2j' });
  assert.equal(Date.parse((await octroiActif(k.b.base, k.tf.teamId, TO1)).expireLe), k.maintenant() + 48 * H);
  assert.equal(Number((await k.b.base.premier("SELECT COUNT(*) AS n FROM roles_temp_octrois WHERE statut = 'actif'", [])).n), 1, 'un seul octroi actif par personne');
  assert.equal(k.discord.etat.mp.length, 1, 'pas de nouveau MP pour une prolongation');
});

test('/role-temp : plusieurs teams (option equipe, autocomplétion limitée à ses teams), refus du Joueur et d’un compte non lié', async () => {
  const k = await monter();
  const ambigu = await k.cmd(COACH_DEUX, 'donner', { membre: TO1 });
  assert.match(k.contenu(ambigu), /plusieurs teams : précise l’option « equipe » \(The Final LZ0, Valorant LZ0\)/);
  assert.equal(k.discord.appels.filter(a => a.methode === 'PUT').length, 0);
  const val = await k.cmd(COACH_DEUX, 'donner', { membre: TO1, equipe: 'valorant lz0' });
  assert.ok(k.contenu(val).includes(NOM_VAL) && /Valorant LZ0/.test(k.contenu(val)));
  assert.ok(k.discord.appels.some(a => a.methode === 'PUT' && a.chemin.endsWith(`/roles/${ROLE_VAL}`)), 'rôle de la team choisie');
  const inconnue = await k.cmd(COACH_TF, 'donner', { membre: TO2, equipe: 'Valorant LZ0' });
  assert.match(k.contenu(inconnue), /pas parmi les tiennes/);
  const auto = await k.cmd(COACH_DEUX, 'donner', { equipe: 'val', membre: TO1 }, { type: 4, focus: 'equipe' });
  assert.equal(auto.corps.type, 8);
  assert.deepEqual(auto.corps.data.choices.map(c => c.name), ['Valorant LZ0']);
  const autoCoach = await k.cmd(COACH_TF, 'donner', { equipe: '' }, { type: 4, focus: 'equipe' });
  assert.deepEqual(autoCoach.corps.data.choices.map(c => c.name), ['The Final LZ0'], 'seulement SES teams');
  const duree = await k.cmd(COACH_TF, 'donner', { duree: '36h' }, { type: 4, focus: 'duree' });
  assert.equal(duree.corps.data.choices[0].value, '36h');
  assert.match(k.contenu(await k.cmd(JOUEUR, 'donner', { membre: TO1 })), /pas le droit de donner/);
  assert.match(k.contenu(await k.cmd('899999999999999999', 'donner', { membre: TO1 })), /Lie d’abord ton compte/);
  assert.match(k.contenu(await k.cmd(COACH_TF, 'donner', { membre: TO1 }, { guild: '799999999999999999' })), /serveur Discord de la team/);
  assert.match(k.contenu(await k.cmd(COACH_TF, 'donner', { membre: TO2, duree: 'demain' })), /Durée invalide/);
  assert.match(k.contenu(await k.cmd(COACH_TF, 'donner', { membre: TO2, duree: '45m' })), /Durée hors limites/);
  assert.match(k.contenu(await k.cmd(COACH_TF, 'donner', { membre: TO2, duree: '31j' })), /Durée hors limites/);
  const bot = await k.cmd(COACH_TF, 'donner', { membre: '424242424242424243' }, { resolved: { users: { '424242424242424243': { id: '424242424242424243', username: 'robot', bot: true } } } });
  assert.match(k.contenu(bot), /pas un bot/);
  // Anglais selon la locale Discord.
  const en = await k.interaction({ type: 2, locale: 'en-US', guild_id: k.GUILD, channel_id: JOURNAL, member: { user: { id: JOUEUR }, roles: [], permissions: '0' }, data: { name: 'role-temp', options: [{ type: 1, name: 'liste', options: [] }] } });
  assert.match(k.contenu(en), /not allowed|You are not allowed/);
});

test('/role-temp liste et retirer : octrois actifs, retrait (DELETE), octroi clos, personne sans rôle', async () => {
  const k = await monter();
  assert.match(k.contenu(await k.cmd(COACH_TF, 'liste')), /Aucun rôle temporaire actif pour The Final LZ0/);
  await k.cmd(COACH_TF, 'donner', { membre: TO1, raison: 'TO' });
  await k.cmd(MANAGER, 'donner', { membre: TO2, duree: '2j' });
  const liste = k.contenu(await k.cmd(COACH_TF, 'liste'));
  assert.match(liste, /2 actif\(s\) sur 10/);
  assert.ok(liste.includes(NOM_TF) && liste.includes(`<@${TO1}>`) && liste.includes(`<@${TO2}>`) && liste.includes('(TO)'));
  const retire = await k.cmd(COACH_TF, 'retirer', { membre: TO1 });
  assert.match(k.contenu(retire), /est retiré à <@820000000000000001>/);
  assert.ok(k.discord.appels.some(a => a.methode === 'DELETE' && a.chemin === `/guilds/${k.GUILD}/members/${TO1}/roles/${ROLE_TF}`));
  assert.equal(await octroiActif(k.b.base, k.tf.teamId, TO1), null);
  assert.equal((await k.b.base.premier('SELECT statut, retire_par FROM roles_temp_octrois WHERE membre_discord_id = ?', [TO1])).statut, 'retire');
  assert.match(k.contenu(await k.cmd(COACH_TF, 'retirer', { membre: TO1 })), /n’a pas de rôle temporaire actif/);
  // Coach de deux teams : retirer sans equipe trouve la bonne team.
  await k.cmd(COACH_DEUX, 'donner', { membre: TO3, equipe: 'Valorant LZ0' });
  assert.match(k.contenu(await k.cmd(COACH_DEUX, 'retirer', { membre: TO3 })), /Valorant LZ0/);
  assert.match(k.contenu(await k.cmd(COACH_DEUX, 'liste')), /Aucun rôle temporaire actif pour Valorant LZ0/);
  assert.equal(Number((await k.b.base.premier("SELECT COUNT(*) AS n FROM roles_temp_octrois WHERE statut = 'retire'", [])).n), 2);
});

test('maximum simultané : refus au-delà, prolonger une personne déjà servie reste permis', async () => {
  const k = await monter();
  assert.equal((await k.regler(k.tf, ROLE_TF, NOM_TF, { maxSimultanes: 2 })).statut, 200);
  await k.cmd(COACH_TF, 'donner', { membre: TO1 });
  await k.cmd(COACH_TF, 'donner', { membre: TO2 });
  assert.match(k.contenu(await k.cmd(COACH_TF, 'donner', { membre: TO3 })), /Limite atteinte : 2 personne\(s\)/);
  assert.match(k.contenu(await k.cmd(COACH_TF, 'donner', { membre: TO2, duree: '3j' })), /déjà le rôle/);
  await k.cmd(COACH_TF, 'retirer', { membre: TO1 });
  assert.match(k.contenu(await k.cmd(COACH_TF, 'donner', { membre: TO3 })), /donné à/);
});

test('échéance : le cron retire le rôle à l’heure (horloge simulée), octroi clos, journal ; rien avant', async () => {
  const k = await monter();
  await k.cmd(COACH_TF, 'donner', { membre: TO1, duree: '1h' });
  await k.cmd(COACH_TF, 'donner', { membre: TO2, duree: '24h' });
  const deletes = () => k.discord.appels.filter(a => a.methode === 'DELETE' && a.chemin.includes('/roles/'));
  const lancer = () => expirerRolesTemp(k.b.base, { fetch: k.discord.fetch, jetonBot: JETON, maintenant: k.maintenant });
  k.b.horloge.t += 59 * 60_000;
  assert.deepEqual(await lancer(), { retires: 0, reportes: 0, abandons: 0 });
  assert.equal(deletes().length, 0);
  k.b.horloge.t += 2 * 60_000;
  // Par la tâche planifiée du cron (toutes les 5 minutes).
  const rapport = await tachesPlanifiees(k.b.base, { jetonBot: JETON, fetch: k.discord.fetch, maintenant: k.maintenant, journal: { error() {} } });
  assert.deepEqual(rapport.find(r => r.tache === 'rôles Discord temporaires'), { tache: 'rôles Discord temporaires', ok: true });
  assert.deepEqual(deletes().map(a => a.chemin), [`/guilds/${k.GUILD}/members/${TO1}/roles/${ROLE_TF}`]);
  assert.equal((await k.b.base.premier('SELECT statut FROM roles_temp_octrois WHERE membre_discord_id = ?', [TO1])).statut, 'expire');
  assert.ok(await octroiActif(k.b.base, k.tf.teamId, TO2), 'la deuxième personne garde son rôle');
  const textes = k.discord.appels.filter(a => a.chemin === `/channels/${JOURNAL}/messages`).map(a => a.corps.content);
  assert.ok(textes.some(t => /est arrivé à échéance et a été retiré/.test(t)));
  assert.equal((await lancer()).retires, 0, 'idempotent : rien à refaire');
  assert.equal(deletes().length, 1);
  k.b.horloge.t += 24 * H;
  assert.equal((await lancer()).retires, 1);
  assert.equal(Number((await k.b.base.premier("SELECT COUNT(*) AS n FROM roles_temp_octrois WHERE statut = 'actif'", [])).n), 0);
});

test('échéance : personne partie ou rôle supprimé (404) = octroi clos ; limite de débit = nouvel essai après retry_after ; sans jeton, rien', async () => {
  const k = await monter();
  await k.cmd(COACH_TF, 'donner', { membre: TO1, duree: '1h' });
  await k.cmd(COACH_TF, 'donner', { membre: TO2, duree: '1h' });
  await k.cmd(COACH_TF, 'donner', { membre: TO3, duree: '1h' });
  k.b.horloge.t += 2 * H;
  assert.deepEqual(await expirerRolesTemp(k.b.base, { fetch: k.discord.fetch, maintenant: k.maintenant }), { retires: 0, reportes: 0, abandons: 0 }, 'sans jeton du bot');
  const lancer = () => expirerRolesTemp(k.b.base, { fetch: k.discord.fetch, jetonBot: JETON, maintenant: k.maintenant });
  // 1. Personne partie du serveur (10007) ; 2. limite de débit (429, 30 s) ; 3. rôle supprimé de Discord (10011).
  k.discord.etat.absents.add(TO1);
  k.discord.programme.push({ si: (m, c) => m === 'DELETE' && c.includes(TO1), statut: 404, corps: { code: 10007 } });
  k.discord.programme.push({ si: (m, c) => m === 'DELETE' && c.includes(TO2), statut: 429, corps: { retry_after: 30, message: 'limite' }, entetes: { 'Retry-After': '30' } });
  k.discord.programme.push({ si: (m, c) => m === 'DELETE' && c.includes(TO3), statut: 404, corps: { code: 10011 } });
  const bilan = await lancer();
  assert.deepEqual(bilan, { retires: 2, reportes: 1, abandons: 0 });
  const statut = id => k.b.base.premier('SELECT statut, essais, prochain_essai_le, erreur FROM roles_temp_octrois WHERE membre_discord_id = ?', [id]);
  assert.equal((await statut(TO1)).statut, 'expire');
  assert.equal((await statut(TO3)).statut, 'expire');
  const limite = await statut(TO2);
  assert.deepEqual([limite.statut, limite.essais], ['actif', 1]);
  assert.equal(Date.parse(limite.prochain_essai_le), k.maintenant() + 30_000, 'nouvel essai après retry_after');
  assert.deepEqual(await lancer(), { retires: 0, reportes: 0, abandons: 0 }, 'trop tôt');
  k.b.horloge.t += 31_000;
  assert.equal((await lancer()).retires, 1);
  assert.equal((await statut(TO2)).statut, 'expire');
});

test('échéance : hiérarchie des rôles (403) = essais espacés puis abandon et message au journal, explication claire', async () => {
  const k = await monter();
  await k.cmd(COACH_TF, 'donner', { membre: TO1, duree: '1h' });
  k.b.horloge.t += 2 * H;
  const lancer = () => expirerRolesTemp(k.b.base, { fetch: k.discord.fetch, jetonBot: JETON, maintenant: k.maintenant });
  const refuser = () => k.discord.programme.push({ si: (m, c) => m === 'DELETE' && c.includes('/roles/'), statut: 403, corps: { code: 50013, message: 'Missing Permissions' } });
  refuser();
  assert.deepEqual(await lancer(), { retires: 0, reportes: 1, abandons: 0 });
  const l1 = await k.b.base.premier('SELECT essais, erreur, prochain_essai_le FROM roles_temp_octrois WHERE membre_discord_id = ?', [TO1]);
  assert.equal(l1.essais, 1);
  assert.match(l1.erreur, /Le rôle du bot \(Esport HQ\) est au même niveau ou sous le rôle/);
  assert.equal(Date.parse(l1.prochain_essai_le), k.maintenant() + 5 * 60_000, 'premier nouvel essai : 5 minutes');
  const echec1 = k.discord.appels.filter(a => a.chemin === `/channels/${JOURNAL}/messages`).map(a => a.corps.content);
  assert.ok(echec1.some(t => /Impossible de retirer le rôle/.test(t)), 'le journal est prévenu au premier échec');
  // Les essais suivants s'espacent et s'arrêtent à ESSAIS_MAX.
  let derniere = 0;
  for (let n = 1; n < ESSAIS_MAX; n++) {
    k.b.horloge.t += 7 * H;
    refuser();
    const b = await lancer();
    derniere = b.abandons;
  }
  assert.equal(derniere, 1);
  const fin = await k.b.base.premier('SELECT statut, essais FROM roles_temp_octrois WHERE membre_discord_id = ?', [TO1]);
  assert.deepEqual([fin.statut, fin.essais], ['echec', ESSAIS_MAX]);
  assert.ok(k.discord.appels.filter(a => a.chemin === `/channels/${JOURNAL}/messages`).some(a => /Abandon/.test(a.corps.content)));
  assert.deepEqual(await lancer(), { retires: 0, reportes: 0, abandons: 0 });
});

test('donner : hiérarchie des rôles (le bot est sous le rôle temporaire) expliquée clairement, rien n’est noté', async () => {
  const k = await monter();
  // Rôle 10 (TF) au-dessus du bot (position 3) : Discord refuse (403) ; le diagnostic nomme les deux rôles.
  k.discord.programme.push({ si: (m, c) => m === 'PUT' && c.includes('/roles/'), statut: 403, corps: { code: 50013, message: 'Missing Permissions' } });
  const r = await k.cmd(COACH_TF, 'donner', { membre: TO1 });
  assert.equal(r.corps.data.flags, 64);
  assert.match(k.contenu(r), /Le rôle du bot \(\*\*Esport HQ\*\*\) est au même niveau ou sous le rôle \*\*⟡ 🎤𝙄𝙣𝙩𝙚𝙧𝙫𝙚𝙣𝙖𝙣𝙩 𝙏𝙁 ⟡\*\*/);
  assert.match(k.contenu(r), /glisse « Esport HQ » au-dessus/);
  assert.equal(await octroiActif(k.b.base, k.tf.teamId, TO1), null);
  assert.equal(k.discord.etat.mp.length, 0);
  // Personne absente du serveur (10007), rôle disparu (10011), limite de débit (429).
  k.discord.etat.absents.add(TO2);
  assert.match(k.contenu(await k.cmd(COACH_TF, 'donner', { membre: TO2 })), /n’est pas \(ou plus\) sur le serveur Discord/);
  k.discord.programme.push({ si: (m, c) => m === 'PUT', statut: 404, corps: { code: 10011 } });
  assert.match(k.contenu(await k.cmd(COACH_TF, 'donner', { membre: TO3 })), /n’existe plus sur Discord/);
  k.discord.programme.push({ si: (m, c) => m === 'PUT', statut: 429, corps: { retry_after: 20 }, entetes: { 'Retry-After': '20' } });
  assert.match(k.contenu(await k.cmd(COACH_TF, 'donner', { membre: TO3 })), /réessaie dans 20 s/);
  assert.equal(Number((await k.b.base.premier('SELECT COUNT(*) AS n FROM roles_temp_octrois', [])).n), 0);
});

test('commandes : désactivables et réservées à des rôles Discord, comme les autres commandes du bot', async () => {
  const k = await monter();
  const STAFF = '720000000000000001';
  const r = await k.api('/roles-temp/config/commandes', k.fondateur, { methode: 'PUT', corps: { donner: { actif: true, roles: [STAFF] }, retirer: { actif: false, roles: [] } } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.deepEqual(r.corps.commandes.donner, { actif: true, roles: [STAFF] });
  assert.equal(r.corps.commandes.liste.actif, true, 'les autres gardent leur valeur par défaut');
  assert.match(k.contenu(await k.cmd(COACH_TF, 'donner', { membre: TO1 })), /réservée à certains rôles/);
  assert.match(k.contenu(await k.cmd(COACH_TF, 'donner', { membre: TO1 }, { roles: [STAFF] })), /donné à/);
  assert.match(k.contenu(await k.cmd(COACH_TF, 'donner', { membre: TO2 }, { permissions: '8' })), /donné à/, 'administrateur du serveur : jamais bloqué par les rôles');
  assert.match(k.contenu(await k.cmd(COACH_TF, 'retirer', { membre: TO1 })), /désactivée/);
  assert.equal((await k.api('/roles-temp/config', k.fondateur)).corps.choix.commandes.join(), 'donner,retirer,liste');
});

test('app : réglages (rôle choisi sur Discord, nom Unicode gardé, hiérarchie signalée), droits, liste, donner / prolonger / retirer, recherche', async () => {
  const k = await monter();
  const chemin = `/teams/${k.tf.teamId}/roles-temporaires`;
  // Le Coach voit la liste mais ne règle rien ; le Joueur n'a aucun accès.
  const coach = k.tf.sessions.coachtf01;
  const vueCoach = await k.api(chemin, coach);
  assert.equal(vueCoach.statut, 200);
  assert.deepEqual([vueCoach.corps.peutGerer, vueCoach.corps.peutRegler], [true, false]);
  assert.equal(vueCoach.corps.reglages.roleId, undefined, 'réglages complets réservés à discord.manage');
  assert.equal((await k.api(chemin, k.tf.sessions.joueur001)).statut, 403);
  assert.equal((await k.api(`${chemin}/reglages`, coach, { methode: 'PUT', corps: { dureeDefautH: 12 } })).statut, 403);
  const vueManager = await k.api(chemin, k.tf.sessions.manager01);
  assert.equal(vueManager.corps.peutRegler, true);
  assert.equal(vueManager.corps.reglages.roleNom, NOM_TF);
  assert.deepEqual(vueManager.corps.rolesEquipe.filter(r => r.defaut).map(r => r.cle).sort(), ['coach', 'manager', 'proprietaire']);
  // Rôles du serveur Discord (sans @everyone ni rôle géré), position du bot.
  const srv = await k.api(`${chemin}/discord`, k.tf.sessions.manager01);
  assert.equal(srv.corps.gererRoles, true);
  assert.equal(srv.corps.positionBot, 3);
  assert.ok(srv.corps.roles.some(r => r.id === ROLE_TF && r.nom === NOM_TF));
  assert.ok(!srv.corps.roles.some(r => r.nom === 'Esport HQ'), 'rôle géré non proposé');
  // Réglages : nom relu chez Discord, avertissement de hiérarchie (rôle 10 > bot 3), durée 1 h – 30 j, rôle inexistant refusé.
  const reg = await k.api(`${chemin}/reglages`, k.tf.sessions.manager01, { methode: 'PUT', corps: { dureeDefautH: 12, roleNom: 'faux nom' } });
  assert.equal(reg.statut, 200, JSON.stringify(reg.corps));
  assert.equal(reg.corps.reglages.roleNom, NOM_TF);
  assert.equal(reg.corps.avertissement, 'hierarchie');
  assert.equal((await k.api(`${chemin}/reglages`, k.fondateur, { methode: 'PUT', corps: { dureeDefautH: 721 } })).statut, 400);
  assert.equal((await k.api(`${chemin}/reglages`, k.fondateur, { methode: 'PUT', corps: { roleId: '739999999999999999' } })).statut, 400);
  assert.equal((await k.api(`${chemin}/reglages`, k.fondateur, { methode: 'PUT', corps: { rolesAutorises: [k.val.roles.coach.id] } })).statut, 400, 'rôle d’une autre team');
  // Recherche d'une personne, puis donner avec la durée par défaut de la team (12 h), prolonger de 24 h, retirer.
  const recherche = await k.api(`${chemin}/membres?q=zo`, coach);
  assert.deepEqual(recherche.corps.membres.map(m => m.nom), ['Zoé', 'Zorro le Grand']);
  const donne = await k.api(chemin, coach, { methode: 'POST', corps: { membreId: '800000000000000077', membreNom: 'Zoé', raison: 'Remplace un joueur' } });
  assert.equal(donne.statut, 200, JSON.stringify(donne.corps));
  assert.equal(Date.parse(donne.corps.octroi.expireLe), k.maintenant() + 12 * H);
  assert.equal(donne.corps.prolonge, false);
  assert.equal((await k.api(chemin, coach, { methode: 'POST', corps: { membreId: 'abc' } })).statut, 400);
  assert.equal((await k.api(chemin, k.tf.sessions.joueur001, { methode: 'POST', corps: { membreId: '800000000000000077' } })).statut, 403);
  const liste = (await k.api(chemin, coach)).corps.actifs;
  assert.equal(liste.length, 1);
  assert.deepEqual([liste[0].membreNom, liste[0].accordeParNom, liste[0].raison], ['Zoé', 'Coach TF', 'Remplace un joueur']);
  const id = liste[0].id;
  const pro = await k.api(`${chemin}/${id}/prolonger`, coach, { methode: 'POST', corps: { dureeH: 24 } });
  assert.equal(pro.statut, 200);
  assert.equal(Date.parse(pro.corps.octroi.expireLe), k.maintenant() + 36 * H);
  assert.equal((await k.api(`${chemin}/${id}/prolonger`, coach, { methode: 'POST', corps: { dureeH: 0 } })).statut, 400);
  const retire = await k.api(`${chemin}/${id}`, coach, { methode: 'DELETE' });
  assert.equal(retire.statut, 200);
  assert.deepEqual((await k.api(chemin, coach)).corps.actifs, []);
  assert.equal((await k.api(`${chemin}/${id}`, coach, { methode: 'DELETE' })).statut, 404);
  // Autre team : un Coach de TF n'a aucun droit sur Valorant LZ0.
  assert.equal((await k.api(`/teams/${k.val.teamId}/roles-temporaires`, coach)).statut, 404);
  // Vue d'ensemble de l'Administration › Bot Esport HQ.
  const club = (await k.api('/roles-temp/config', k.fondateur)).corps;
  // Le CM du club (migration 0068) figure aussi, sans rôle temporaire réglé.
  assert.deepEqual(club.equipes.map(e => [e.nom, e.actif, e.roleNom]), [['CM du club', false, ''], ['The Final LZ0', true, NOM_TF], ['Valorant LZ0', true, NOM_VAL]]);
  assert.equal((await k.api('/roles-temp/config', coach)).statut, 404);
  assert.equal((await k.api('/bot-discord', k.fondateur)).corps.rolesTemp.actif, true);
});

test('données : tables dans l’export / import de la base, effacement RGPD par Discord ID', async () => {
  const k = await monter();
  assert.ok(['roles_temp_reglages', 'roles_temp_octrois'].every(t => TABLES.some(([n]) => n === t)));
  await k.cmd(COACH_TF, 'donner', { membre: TO1, raison: 'perso' });
  await k.cmd(COACH_TF, 'donner', { membre: TO2 });
  await k.cmd(COACH_TF, 'retirer', { membre: TO2 });
  const { effacementParDiscord } = await import('../noyau/tickets/rgpd.mjs');
  await k.b.base.lot(effacementParDiscord([TO1, TO2], null, k.maintenant()));
  const l1 = await k.b.base.premier('SELECT membre_nom, raison, statut FROM roles_temp_octrois WHERE membre_discord_id = ?', [TO1]);
  assert.deepEqual([l1.membre_nom, l1.raison, l1.statut], ['', '', 'actif'], 'l’octroi actif reste (le rôle doit être retiré) mais sans données personnelles');
  assert.equal(await k.b.base.premier('SELECT * FROM roles_temp_octrois WHERE membre_discord_id = ?', [TO2]), null, 'octroi terminé effacé');
});

test('processus qui tient la connexion en direct : il retire lui-même les rôles échus à son passage (sans attendre le cron)', async () => {
  const base = await baseMigree();
  const GUILD = '700000000000000001';
  await base.executer('INSERT INTO tickets_reglages (cle, valeur, maj_le) VALUES (?, ?, ?)', ['general', JSON.stringify({ actif: true, guildId: GUILD, guildNom: 'Ligne Zéro', langue: 'fr' }), '2026-01-01T00:00:00.000Z']);
  const gw = await fauxGateway({ intervalle: 1000 });
  const rest = fauxDiscordRest({ gateway: gw });
  rest.etat.roles.set(ROLE_TF, { id: ROLE_TF, name: NOM_TF, position: 2 });
  const ligne = (id, membre, expire) =>
    base.executer(
      "INSERT INTO roles_temp_octrois (id, team_id, guild_id, role_id, role_nom, membre_discord_id, statut, accorde_le, expire_le, maj_le) VALUES (?, 't1', ?, ?, ?, ?, 'actif', '2026-01-01T00:00:00.000Z', ?, '2026-01-01T00:00:00.000Z')",
      [id, GUILD, ROLE_TF, NOM_TF, membre, expire],
    );
  await ligne('o-echu', TO1, '2026-01-02T00:00:00.000Z');
  await ligne('o-futur', TO2, '2999-01-01T00:00:00.000Z');
  const sup = creerSuperviseurTickets({ base, jetonBot: JETON, fetch: rest.fetch, identifiant: 'p', intervalle: 1_000_000, gateway: { attenteMin: 20, attenteMax: 200, hasard: () => 0.5 }, journal: { error() {}, warn() {} } });
  try {
    assert.equal((await sup.passage()).meneur, true);
    const statut = id => base.premier('SELECT statut FROM roles_temp_octrois WHERE id = ?', [id]).then(l => l.statut);
    await attendre(async () => (await statut('o-echu')) === 'expire');
    assert.equal(await statut('o-futur'), 'actif');
    assert.ok(rest.appels.some(a => a.methode === 'DELETE' && a.chemin === `/guilds/${GUILD}/members/${TO1}/roles/${ROLE_TF}`));
  } finally {
    await sup.arreter();
    await gw.arreter();
  }
});

test('échéance refusée (hiérarchie) : alerte pour discord.manage de la team et le Fondateur, une notification avec compteur, lien vers « Rôles temporaires »', async () => {
  const k = await monter();
  await k.cmd(COACH_TF, 'donner', { membre: TO1, duree: '1h' });
  k.b.horloge.t += 2 * H;
  const lancer = () => expirerRolesTemp(k.b.base, { fetch: k.discord.fetch, jetonBot: JETON, maintenant: k.maintenant });
  const refuser = () => k.discord.programme.push({ si: (m, c) => m === 'DELETE' && c.includes('/roles/'), statut: 403, corps: { code: 50013, message: 'Missing Permissions' } });
  const recues = async compte => {
    await distribuer(k.b.base, { maintenant: k.maintenant() });
    const r = await k.b.appel('/notifications/centre?limite=100', { jeton: await k.b.session(compte) });
    return r.corps.liste.filter(n => n.type === 'role-temp-alerte');
  };
  refuser();
  await lancer();
  const premiere = await recues('manager01');
  assert.equal(premiere.length, 1);
  assert.deepEqual(premiere[0].cible, { v: 1, g: 'alerte_discord', zone: 'role_temp', team: k.tf.teamId });
  assert.deepEqual([premiere[0].charge.code, premiere[0].charge.quoi, premiere[0].charge.compteur], ['hierarchie', 'expiration', 1]);
  assert.equal((await recues('principal')).length, 1, 'le Fondateur aussi');
  assert.equal((await recues('coachtf01')).length, 0, 'un coach n’a pas discord.manage');
  assert.equal((await recues('joueur001')).length, 0);
  assert.equal((await recues('coachmul1')).length, 0, 'une autre team');
  // Nouveaux essais (5 puis 10 minutes plus tard) : même erreur, même cible → une seule notification, compteur.
  k.b.horloge.t += 5 * 60_000 + 1000;
  refuser();
  await lancer();
  k.b.horloge.t += 10 * 60_000 + 1000;
  refuser();
  await lancer();
  const apres = await recues('manager01');
  assert.equal(apres.length, 1);
  assert.equal(apres[0].id, premiere[0].id);
  assert.ok(apres[0].charge.compteur >= 2, `compteur ${apres[0].charge.compteur}`);
});
