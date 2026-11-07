/**
 * Tickets : catégories par défaut (modèles bilingues, formulaires dans les limites des fenêtres Discord ; semées
 * seulement sur une base sans catégorie ; bouton « Catégories par défaut » qui ignore les noms déjà pris) et réglage
 * « Le staff répond uniquement depuis l'AppDashboard » (activé par défaut) : les rôles de la catégorie lisent sans
 * écrire ; l'auteur et les personnes ajoutées écrivent et envoient leurs fichiers ; le bot garde ses droits ; plus
 * aucun bouton « Répondre » (un ancien bouton répond en éphémère, sans rien poster) ; changer le réglage remet à jour
 * les salons ouverts (au mieux, échecs comptés) ; mise à niveau des salons ouverts au premier passage du cron.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc } from './aide.mjs';
import { bancTickets } from './tickets-aide.mjs';
import { CATEGORIES_DEFAUT, CLES_SEMEES, corpsModele } from '../noyau/tickets/modeles.mjs';
import { ICONES, LIMITES, PRIORITES } from '../noyau/tickets/reglages.mjs';

const OUVERTS = '710000000000000010';
const ARCHIVES = '710000000000000011';
const STAFF = '720000000000000001';
const LEA = '800000000000000001';
const BOB = '800000000000000002';
const KAI = '800000000000000003';
const ENVOYER = 1n << 11n;
const FILS = 1n << 38n;
const CREER_FILS = 1n << 35n;
const VOIR = 1n << 10n;
const HISTORIQUE = 1n << 16n;
const JOINDRE = 1n << 15n;
const LIENS = 1n << 14n;

test('catégories par défaut : bilingues, icônes monochromes, formulaires dans les limites de Discord', () => {
  assert.ok(CATEGORIES_DEFAUT.length >= 9 && CATEGORIES_DEFAUT.length <= LIMITES.categories);
  const cles = new Set();
  const noms = new Set();
  for (const m of CATEGORIES_DEFAUT) {
    assert.ok(!cles.has(m.cle), m.cle);
    cles.add(m.cle);
    for (const l of ['fr', 'en']) {
      assert.ok(m.nom[l] && m.nom[l].length <= 45, `${m.cle} nom ${l} (titre de fenêtre : 45)`);
      assert.ok(!noms.has(m.nom[l].toLowerCase()), `nom en double : ${m.nom[l]}`);
      noms.add(m.nom[l].toLowerCase());
      assert.ok(m.description[l] && m.description[l].length <= 100, `${m.cle} description ${l}`);
      // Aucun pictogramme coloré dans les textes (emojis) : seulement des lettres, chiffres et ponctuation.
      assert.doesNotMatch(`${m.nom[l]} ${m.description[l]}`, /\p{Extended_Pictographic}/u);
    }
    assert.ok(ICONES.includes(m.icone), `${m.cle} icône`);
    assert.match(m.couleur, /^#[0-9a-f]{6}$/);
    assert.ok(m.modeleNom.includes('{numero}'));
    assert.ok(!m.prioriteDefaut || PRIORITES.includes(m.prioriteDefaut));
    assert.ok(m.formulaire.length >= 1 && m.formulaire.length <= 5, `${m.cle} : 1 à 5 champs`);
    const ids = new Set();
    for (const c of m.formulaire) {
      assert.match(c.id, /^[a-z0-9_-]{1,40}$/);
      assert.ok(!ids.has(c.id));
      ids.add(c.id);
      assert.ok(['court', 'long'].includes(c.style));
      assert.equal(typeof c.requis, 'boolean');
      assert.ok(c.max >= 1 && c.max <= 4000 && c.min <= c.max);
      for (const l of ['fr', 'en']) {
        assert.ok(c.libelle[l] && c.libelle[l].length <= 45, `${m.cle}.${c.id} libellé ${l} : ${c.libelle[l]?.length}`);
        assert.ok(c.placeholder[l].length <= 100, `${m.cle}.${c.id} exemple ${l}`);
        assert.doesNotMatch(`${c.libelle[l]} ${c.placeholder[l]}`, /\p{Extended_Pictographic}/u);
      }
    }
    assert.ok(m.formulaire.some(c => c.requis), `${m.cle} : au moins un champ obligatoire`);
  }
  for (const c of ['support', 'recrutement', 'staff', 'partenariat', 'signalement', 'scrim', 'contenu', 'appdashboard', 'autre']) assert.ok(cles.has(c), c);
  const part = CATEGORIES_DEFAUT.find(m => m.cle === 'partenariat');
  assert.equal(part.fermetureAutoH, 0, 'Partenariat : jamais fermé automatiquement');
  assert.equal(part.fermetureStaffSeul, true, 'Partenariat : seul le staff ferme');
  // Rôles suggérés gardés seulement s'ils existent.
  assert.deepEqual(corpsModele(part).rolesApp, []);
  assert.deepEqual(corpsModele(part, new Set(['club:role-global-second-ceo'])).rolesApp, ['club:role-global-second-ceo']);
});

test('semis : base sans catégorie → catégories par défaut une seule fois (rôles du catalogue) ; jamais recréées', async () => {
  const k = await bancTickets({ banc, modeles: true });
  const c1 = await k.api('/tickets/config');
  assert.equal(c1.statut, 200, JSON.stringify(c1.corps));
  const semees = CATEGORIES_DEFAUT.filter(m => !m.evenement);
  assert.equal(c1.corps.categories.length, semees.length);
  assert.deepEqual(c1.corps.categories.map(c => c.nom.fr), semees.map(m => m.nom.fr), 'dans l’ordre des modèles, sans les événements');
  assert.deepEqual(CLES_SEMEES, semees.map(m => m.cle));
  assert.ok(!c1.corps.categories.some(c => c.nom.fr === 'Inscription The Nuke End'), 'tournoi jamais semé');
  assert.equal(c1.corps.modeles.length, CATEGORIES_DEFAUT.length, 'modèles rendus à l’app');
  const part = c1.corps.categories.find(c => c.nom.fr === 'Partenariat & sponsoring');
  assert.equal(part.fermetureAutoH, 0);
  assert.equal(part.fermetureStaffSeul, true);
  assert.deepEqual(part.rolesApp, ['club:role-global-second-ceo']);
  assert.deepEqual(part.rolesDiscord, [], 'rôles Discord à choisir');
  assert.deepEqual(c1.corps.categories.find(c => c.nom.fr === 'Contenu & médias').rolesApp, ['cm:cm-role-responsable']);
  assert.deepEqual(c1.corps.categories.find(c => c.nom.fr === 'Recrutement joueur').rolesApp, []);
  assert.equal(c1.corps.categories.find(c => c.nom.fr === 'Recrutement joueur').formulaire.length, 5);
  // Une deuxième lecture ne sème rien ; une catégorie supprimée ne revient pas.
  assert.equal((await k.api('/tickets/config')).corps.categories.length, semees.length);
  await k.api(`/tickets/config/categories/${part.id}`, undefined, { methode: 'DELETE' });
  for (const c of (await k.api('/tickets/config')).corps.categories) await k.api(`/tickets/config/categories/${c.id}`, undefined, { methode: 'DELETE' });
  assert.equal((await k.api('/tickets/config')).corps.categories.length, 0, 'tout supprimé : rien n’est resemé');
});

test('semis : une installation qui a déjà une catégorie (« Test ») n’est pas touchée ; le bouton ajoute les cochées sans doublon', async () => {
  const k = await bancTickets({ banc, modeles: true });
  const test0 = await k.api('/tickets/config/categories', undefined, { methode: 'POST', corps: { nom: { fr: 'Test', en: 'Test' } } });
  assert.equal(test0.statut, 200);
  const c = await k.api('/tickets/config');
  assert.deepEqual(c.corps.categories.map(x => x.nom.fr), ['Test']);
  // Une catégorie « autre » existe déjà (casse et accents ignorés) : le modèle est ignoré.
  await k.api('/tickets/config/categories', undefined, { methode: 'POST', corps: { nom: { fr: 'AUTRE', en: 'Misc' } } });
  const r = await k.api('/tickets/config/categories/defaut', undefined, { methode: 'POST', corps: { cles: ['support', 'autre', 'partenariat'] } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.deepEqual(r.corps.ajoutees, ['support', 'partenariat']);
  assert.deepEqual(r.corps.ignorees, ['autre']);
  assert.deepEqual(r.corps.categories.map(x => x.nom.fr), ['Test', 'AUTRE', 'Support général', 'Partenariat & sponsoring']);
  // Deuxième clic : tout est déjà là.
  const r2 = await k.api('/tickets/config/categories/defaut', undefined, { methode: 'POST', corps: { cles: ['support'] } });
  assert.deepEqual([r2.corps.ajoutees, r2.corps.ignorees], [[], ['support']]);
  assert.equal((await k.api('/tickets/config/categories/defaut', undefined, { methode: 'POST', corps: { cles: ['inconnu'] } })).statut, 400);
  assert.equal((await k.api('/tickets/config/categories/defaut', undefined, { methode: 'POST', corps: { cles: [] } })).statut, 400);
  // Réservé à qui configure.
  const sans = await k.compteAvec('voir1234', 'Voir', ['tickets.voir']);
  assert.equal((await k.api('/tickets/config/categories/defaut', sans.jeton, { methode: 'POST', corps: { cles: ['scrim'] } })).statut, 403);
});

async function preparer({ general = {} } = {}) {
  const k = await bancTickets({ banc });
  const g = await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { guildId: k.GUILD, guildNom: 'Club', categorieOuverts: OUVERTS, categorieArchives: ARCHIVES, actif: true, ...general } });
  assert.equal(g.statut, 200, JSON.stringify(g.corps));
  const support = await k.compteAvec('supp1234', 'Support', ['tickets.repondre']);
  const cat = (await k.api('/tickets/config/categories', undefined, { methode: 'POST', corps: { nom: { fr: 'Aide', en: 'Help' }, rolesDiscord: [STAFF], rolesApp: [`club:${support.roleId}`] } })).corps;
  const membre = (id, roles = []) => ({ user: { id, username: `u${id.slice(-3)}`, global_name: id === LEA ? 'Léa' : `Membre ${id.slice(-3)}` }, roles, permissions: '0' });
  const clic = (custom_id, { qui = LEA, roles = [], salon = '710000000000000013', valeurs, resolved } = {}) =>
    k.interaction({ type: 3, locale: 'fr', guild_id: k.GUILD, channel_id: salon, member: membre(qui, roles), data: { custom_id, component_type: valeurs ? 3 : 2, ...(valeurs ? { values: valeurs } : {}), ...(resolved ? { resolved } : {}) } });
  const fenetre = (custom_id, valeurs, { qui = LEA, roles = [], salon } = {}) =>
    k.interaction({ type: 5, locale: 'fr', guild_id: k.GUILD, channel_id: salon, member: membre(qui, roles), data: { custom_id, components: Object.entries(valeurs).map(([id, value]) => ({ type: 1, components: [{ type: 4, custom_id: id, value }] })) } });
  const ouvrir = async () => {
    const r = await clic(`tk:o:${cat.id}`);
    assert.match(r.corps.data.content, /Ticket créé/, JSON.stringify(r.corps));
    return k.b.base.premier('SELECT * FROM tickets ORDER BY numero DESC LIMIT 1', []);
  };
  const droits = (tk, id) => {
    const o = k.discord.etat.salons.get(tk.salon_id).permission_overwrites.find(x => x.id === id);
    return o ? { allow: BigInt(o.allow), deny: BigInt(o.deny) } : null;
  };
  return { k, support, cat, clic, fenetre, ouvrir, droits };
}

/** Aucun composant « Répondre » (tk:rp / tk:rm) dans aucun message posté par le bot. */
function sansRepondre(k) {
  for (const a of k.discord.appels.filter(x => x.methode === 'POST' && /\/messages$/.test(x.chemin))) assert.doesNotMatch(JSON.stringify(a.corps ?? {}), /tk:r[pm]:/, `bouton « Répondre » dans ${a.chemin}`);
}

test('réglage par défaut : l’auteur et les personnes ajoutées écrivent et joignent des fichiers, le staff lit seulement, le bot tout ; pas de « Répondre »', async () => {
  const p = await preparer();
  const conf = await p.k.api('/tickets/config');
  assert.equal(conf.corps.general.reponsesAppSeules, true, 'activé par défaut');
  const tk = await p.ouvrir();
  const lea = p.droits(tk, LEA);
  assert.ok(lea.allow & VOIR && lea.allow & HISTORIQUE && lea.allow & ENVOYER && lea.allow & JOINDRE && lea.allow & LIENS, 'l’auteur écrit et joint des fichiers');
  assert.equal(lea.deny, 0n);
  const staff = p.droits(tk, STAFF);
  assert.ok(staff.allow & VOIR && staff.allow & HISTORIQUE, 'le staff lit le salon');
  assert.equal(staff.allow & ENVOYER, 0n);
  assert.ok(staff.deny & ENVOYER && staff.deny & FILS && staff.deny & CREER_FILS, 'le staff n’écrit pas sur Discord');
  const bot = p.droits(tk, p.k.APP);
  assert.ok(bot.allow & ENVOYER && bot.allow & (1n << 4n), 'le bot garde ses droits');
  assert.equal(bot.deny, 0n);
  const accueil = p.k.discord.etat.messages.get(tk.salon_id)[0];
  assert.match(accueil.embeds[0].description, /écrire et envoyer vos fichiers.*directement dans ce salon/s, 'consigne en français');
  assert.match(accueil.embeds[0].description, /write and send your files.*directly in this channel/s, 'et en anglais');
  assert.doesNotMatch(accueil.embeds[0].description, /Répondre|Reply|lecture seule|read-only/);
  const boutons = accueil.components[0].components;
  assert.deepEqual(boutons.map(b => b.custom_id.split(':')[1]), ['c', 'a', 'p', 'x'], 'quatre boutons, sans « Répondre »');
  // Personne ajoutée : écrit aussi.
  await p.clic(`tk:as:${tk.id}`, { qui: KAI, roles: [STAFF], valeurs: [BOB], resolved: { users: { [BOB]: { id: BOB, username: 'bob' } } }, salon: tk.salon_id });
  const bob = p.droits(tk, BOB);
  assert.ok(bob.allow & VOIR && bob.allow & ENVOYER && bob.allow & JOINDRE);
  assert.equal(bob.deny, 0n);
  // Réponse du staff depuis l'app : sans bouton.
  const r = await p.k.api(`/tickets/${tk.id}/messages`, p.support.jeton, { methode: 'POST', corps: { texte: 'Bonjour, de quoi avez-vous besoin ?' } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  const post = p.k.discord.etat.messages.get(tk.salon_id).at(-1);
  assert.match(post.content, /^\*\*Staff · Support\*\* : Bonjour/);
  assert.equal(post.components, undefined);
  // Fermeture : l'auteur et la personne ajoutée lisent seulement ; réouverture : ils écrivent de nouveau.
  await p.k.api(`/tickets/${tk.id}/fermer`, undefined, { methode: 'POST', corps: {} });
  assert.ok(p.droits(tk, LEA).deny & ENVOYER && p.droits(tk, BOB).deny & ENVOYER);
  await p.k.api(`/tickets/${tk.id}/rouvrir`, undefined, { methode: 'POST', corps: {} });
  assert.ok(p.droits(tk, LEA).allow & ENVOYER && p.droits(tk, BOB).allow & ENVOYER, 'réouverture : ils écrivent');
  assert.ok(p.droits(tk, STAFF).deny & ENVOYER, 'réouverture : le staff lit seulement');
  sansRepondre(p.k);
});

test('réglage désactivé : le staff écrit aussi sur Discord ; mêmes droits pour l’auteur ; consigne des fichiers', async () => {
  const p = await preparer({ general: { reponsesAppSeules: false } });
  const tk = await p.ouvrir();
  assert.ok(p.droits(tk, LEA).allow & ENVOYER);
  assert.equal(p.droits(tk, LEA).deny, 0n);
  assert.ok(p.droits(tk, STAFF).allow & ENVOYER);
  assert.equal(p.droits(tk, STAFF).deny, 0n);
  const accueil = p.k.discord.etat.messages.get(tk.salon_id)[0];
  assert.match(accueil.embeds[0].description, /envoyer vos fichiers/);
  sansRepondre(p.k);
});

test('ancien bouton « Répondre » (messages d’avant la mise à jour) : réponse éphémère, rien n’est posté', async () => {
  const p = await preparer();
  const tk = await p.ouvrir();
  const dans = { salon: tk.salon_id };
  const avant = p.k.discord.etat.messages.get(tk.salon_id).length;
  const a = await p.clic(`tk:rp:${tk.id}`, dans);
  assert.equal(a.corps.type, 4);
  assert.equal(a.corps.data.flags, 64);
  assert.match(a.corps.data.content, /écrivez et envoyez vos fichiers directement dans ce salon/);
  // Fenêtre ouverte avant la mise à jour : rien n'est posté non plus.
  assert.match((await p.fenetre(`tk:rm:${tk.id}`, { message: 'bonjour' }, dans)).corps.data.content, /directement dans ce salon/);
  // Le staff : renvoyé vers l'app.
  assert.match((await p.clic(`tk:rp:${tk.id}`, { qui: KAI, roles: [STAFF], ...dans })).corps.data.content, /AppDashboard/);
  assert.equal(p.k.discord.etat.messages.get(tk.salon_id).length, avant, 'rien posté');
  // Bouton d'un autre salon : sans effet ; ticket fermé : refusé.
  assert.match((await p.clic(`tk:rp:${tk.id}`, { salon: '710000000000000013' })).corps.data.content, /salon d’un ticket/);
  await p.k.api(`/tickets/${tk.id}/fermer`, undefined, { methode: 'POST', corps: {} });
  assert.match((await p.clic(`tk:rp:${tk.id}`, dans)).corps.data.content, /déjà fermé/);
});

test('changer le réglage remet à jour les salons des tickets ouverts (échec compté et journalisé, sans bloquer)', async () => {
  const p = await preparer();
  const t1 = await p.ouvrir();
  const r1 = await p.clic(`tk:o:${p.cat.id}`, { qui: BOB });
  assert.match(r1.corps.data.content, /Ticket créé/);
  const t2 = await p.k.b.base.premier('SELECT * FROM tickets ORDER BY numero DESC LIMIT 1', []);
  const off = await p.k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { reponsesAppSeules: false } });
  assert.equal(off.statut, 200, JSON.stringify(off.corps));
  assert.deepEqual(off.corps.reapplication, { ok: 2, echecs: 0, total: 2 });
  assert.ok(p.droits(t1, LEA).allow & ENVOYER && p.droits(t2, BOB).allow & ENVOYER && p.droits(t1, STAFF).allow & ENVOYER);
  // Même valeur : rien n'est refait.
  const meme = await p.k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { reponsesAppSeules: false } });
  assert.equal(meme.corps.reapplication, undefined);
  // Réactivé, un salon refuse (Discord 500) : l'autre est mis à jour, l'échec compté.
  p.k.discord.programme.push({ si: (m, c) => m === 'PATCH' && c === `/channels/${t1.salon_id}`, statut: 500, corps: { message: 'x' } });
  const erreurs = [];
  const origine = console.error;
  console.error = (...a) => erreurs.push(a.join(' '));
  let on;
  try {
    on = await p.k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { reponsesAppSeules: true } });
  } finally {
    console.error = origine;
  }
  assert.deepEqual(on.corps.reapplication, { ok: 1, echecs: 1, total: 2 });
  assert.ok(erreurs.some(e => e.includes(`ticket ${t1.numero}`)), 'échec journalisé (sans contenu)');
  assert.ok(p.droits(t2, STAFF).deny & ENVOYER, 'le staff lit seulement');
  assert.ok(p.droits(t2, BOB).allow & ENVOYER && !(p.droits(t2, BOB).deny & ENVOYER), 'l’auteur écrit toujours');
});

test('mise à niveau au premier passage du cron : salons ouverts en lecture seule rouverts à l’auteur, panneaux réécrits, une seule fois', async () => {
  const p = await preparer();
  const t1 = await p.ouvrir();
  const r1 = await p.clic(`tk:o:${p.cat.id}`, { qui: BOB });
  assert.match(r1.corps.data.content, /Ticket créé/);
  const t2 = await p.k.b.base.premier('SELECT * FROM tickets ORDER BY numero DESC LIMIT 1', []);
  // Salons d'avant la mise à jour : l'auteur en lecture seule.
  for (const [tk, qui] of [[t1, LEA], [t2, BOB]]) {
    const s = p.k.discord.etat.salons.get(tk.salon_id);
    s.permission_overwrites = s.permission_overwrites.map(o => (o.id === qui ? { ...o, allow: String(VOIR | HISTORIQUE), deny: String(ENVOYER | FILS) } : o));
    assert.ok(p.droits(tk, qui).deny & ENVOYER);
  }
  // Panneau enregistré avec l'ancienne consigne.
  const ancien = { fr: 'Ouvrez un ticket. Pour écrire dans votre ticket, utilisez le bouton **Répondre** du bot : le staff vous répond dans le même salon.', en: 'Open a ticket. To write in your ticket, use the bot’s **Reply** button: the staff answers you in the same channel.' };
  const pan = await p.k.api('/tickets/config/panneaux', undefined, { methode: 'POST', corps: { titre: { fr: 'Aide', en: 'Help' }, texte: ancien, categories: [p.cat.id] } });
  assert.equal(pan.statut, 200, JSON.stringify(pan.corps));
  // Simule une installation d'avant : la mise à niveau n'a pas encore eu lieu.
  await p.k.b.base.executer("DELETE FROM tickets_reglages WHERE cle = 'migration_droits_v3'", []);
  const cycle = p.k.b.traiter.ticketsCycle;
  // Premier passage : Discord impose d'attendre sur le premier salon → refaite au passage suivant.
  p.k.discord.programme.push({ si: (m, c) => m === 'PATCH' && c === `/channels/${t1.salon_id}`, statut: 429, corps: { retry_after: 120 } });
  const origineErr = console.error;
  const origineLog = console.log;
  const journal = [];
  console.error = (...a) => journal.push(a.join(' '));
  console.log = (...a) => journal.push(a.join(' '));
  let b2;
  let b3;
  try {
    const b1 = await cycle.tachesCycle();
    assert.equal(b1.migration.limite, true, 'interrompue par la limite de débit');
    assert.ok(p.droits(t1, LEA).deny & ENVOYER, 'pas encore remis');
    b2 = await cycle.tachesCycle();
    b3 = await cycle.tachesCycle();
  } finally {
    console.error = origineErr;
    console.log = origineLog;
  }
  assert.deepEqual([b2.migration.ok, b2.migration.echecs, b2.migration.total, b2.migration.panneaux], [2, 0, 2, 1]);
  assert.equal(b3.migration, undefined, 'une seule fois');
  for (const [tk, qui] of [[t1, LEA], [t2, BOB]]) {
    assert.ok(p.droits(tk, qui).allow & ENVOYER && p.droits(tk, qui).allow & JOINDRE, 'l’auteur écrit de nouveau');
    assert.equal(p.droits(tk, qui).deny, 0n);
    assert.ok(p.droits(tk, STAFF).deny & ENVOYER, 'le staff reste en lecture seule');
  }
  assert.ok(journal.some(l => l.includes('mise à niveau faite')), 'journalisé');
  const lu = (await p.k.api('/tickets/config')).corps.panneaux.find(x => x.id === pan.corps.id);
  assert.match(lu.texte.fr, /^Ouvrez un ticket\. Écrivez et envoyez vos fichiers directement dans votre ticket/);
  assert.match(lu.texte.en, /Write and send your files directly/);
  assert.doesNotMatch(lu.texte.fr + lu.texte.en, /Répondre|Reply/);
});

test('repli : Discord refuse les surcharges complètes (403) → « Envoyer des messages » refusé seul au staff ; l’auteur écrit', async () => {
  const p = await preparer();
  p.k.discord.programme.push({ si: (m, c) => m === 'POST' && c === `/guilds/${p.k.GUILD}/channels`, statut: 403, corps: { code: 50013, message: 'Missing Permissions' } });
  const origine = console.error;
  console.error = () => undefined;
  let tk;
  try {
    tk = await p.ouvrir();
  } finally {
    console.error = origine;
  }
  const d = p.droits(tk, STAFF);
  assert.equal(d.deny, ENVOYER);
  assert.equal(d.allow & ENVOYER, 0n);
  assert.ok(p.droits(tk, LEA).allow & ENVOYER);
});
