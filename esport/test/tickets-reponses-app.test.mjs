/**
 * Tickets : catégories par défaut (modèles bilingues, formulaires dans les limites des fenêtres Discord ; semées
 * seulement sur une base sans catégorie ; bouton « Catégories par défaut » qui ignore les noms déjà pris) et réglage
 * « Répondre uniquement depuis l'AppDashboard » (activé par défaut) : personne n'écrit dans le salon (auteur, rôle de
 * la catégorie, personne ajoutée) ; le bot garde ses droits ; accueil avec la consigne et le bouton « Répondre » ;
 * l'auteur répond par une fenêtre du bot (message posté par le bot, enregistré comme un message Discord) ; le staff
 * répond depuis l'app ; changer le réglage remet à jour les salons ouverts (au mieux, échecs comptés).
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

test('réglage par défaut : personne n’écrit (auteur, rôle de la catégorie, personne ajoutée), le bot oui ; accueil avec consigne et « Répondre »', async () => {
  const p = await preparer();
  const conf = await p.k.api('/tickets/config');
  assert.equal(conf.corps.general.reponsesAppSeules, true, 'activé par défaut');
  const tk = await p.ouvrir();
  for (const id of [LEA, STAFF]) {
    const d = p.droits(tk, id);
    assert.ok(d.allow & VOIR && d.allow & HISTORIQUE, `${id} lit le salon`);
    assert.equal(d.allow & ENVOYER, 0n, `${id} n’a pas « Envoyer »`);
    assert.ok(d.deny & ENVOYER && d.deny & FILS && d.deny & CREER_FILS, `${id} : écrire, fils refusés`);
  }
  const bot = p.droits(tk, p.k.APP);
  assert.ok(bot.allow & ENVOYER && bot.allow & (1n << 4n), 'le bot garde ses droits');
  assert.equal(bot.deny, 0n);
  const accueil = p.k.discord.etat.messages.get(tk.salon_id)[0];
  assert.match(accueil.embeds[0].description, /lecture seule.*« Répondre ».*lien/s, 'consigne en français');
  assert.match(accueil.embeds[0].description, /read-only.*“Reply”/s, 'et en anglais');
  assert.doesNotMatch(accueil.embeds[0].description, /joindre des fichiers/);
  const boutons = accueil.components[0].components;
  assert.equal(boutons.length, 5, 'cinq boutons au plus par rangée');
  assert.equal(boutons[0].custom_id, `tk:rp:${tk.id}`);
  assert.equal(boutons[0].label, 'Répondre · Reply');
  // Personne ajoutée : lit seulement.
  await p.clic(`tk:as:${tk.id}`, { qui: KAI, roles: [STAFF], valeurs: [BOB], resolved: { users: { [BOB]: { id: BOB, username: 'bob' } } }, salon: tk.salon_id });
  const bob = p.droits(tk, BOB);
  assert.ok(bob.allow & VOIR);
  assert.ok(bob.deny & ENVOYER);
  // Réponse du staff depuis l'app : bouton « Répondre » dessous.
  const r = await p.k.api(`/tickets/${tk.id}/messages`, p.support.jeton, { methode: 'POST', corps: { texte: 'Bonjour, de quoi avez-vous besoin ?' } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  const post = p.k.discord.etat.messages.get(tk.salon_id).at(-1);
  assert.match(post.content, /^\*\*Staff · Support\*\* : Bonjour/);
  assert.equal(post.components[0].components[0].custom_id, `tk:rp:${tk.id}`);
  // Fermeture puis réouverture : toujours en lecture seule.
  await p.k.api(`/tickets/${tk.id}/fermer`, undefined, { methode: 'POST', corps: {} });
  assert.ok(p.droits(tk, LEA).deny & ENVOYER);
  await p.k.api(`/tickets/${tk.id}/rouvrir`, undefined, { methode: 'POST', corps: {} });
  assert.ok(p.droits(tk, LEA).deny & ENVOYER && p.droits(tk, STAFF).deny & ENVOYER, 'réouverture : lecture seule');
  const reouv = p.k.discord.etat.messages.get(tk.salon_id).at(-1);
  assert.equal(reouv.components[0].components[0].custom_id, `tk:rp:${tk.id}`);
});

test('réglage désactivé : comportement historique (chacun écrit, pas de bouton « Répondre ») ; consigne des fichiers', async () => {
  const p = await preparer({ general: { reponsesAppSeules: false } });
  const tk = await p.ouvrir();
  assert.ok(p.droits(tk, LEA).allow & ENVOYER);
  assert.equal(p.droits(tk, LEA).deny, 0n);
  assert.ok(p.droits(tk, STAFF).allow & ENVOYER);
  const accueil = p.k.discord.etat.messages.get(tk.salon_id)[0];
  assert.ok(!accueil.components[0].components.some(b => b.custom_id.startsWith('tk:rp:')));
  assert.match(accueil.embeds[0].description, /joindre des fichiers directement/);
});

test('fenêtre « Répondre » : l’auteur écrit, le bot poste et la conversation l’enregistre ; le staff est renvoyé vers l’app', async () => {
  const p = await preparer();
  const tk = await p.ouvrir();
  const dans = { salon: tk.salon_id };
  await p.k.api(`/tickets/${tk.id}/attente`, p.support.jeton, { methode: 'POST', corps: {} });
  assert.equal((await p.k.b.base.premier('SELECT statut FROM tickets WHERE id = ?', [tk.id])).statut, 'en_attente');
  const f = await p.clic(`tk:rp:${tk.id}`, dans);
  assert.equal(f.corps.type, 9, 'fenêtre');
  assert.equal(f.corps.data.custom_id, `tk:rm:${tk.id}`);
  const champ = f.corps.data.components[0].components[0];
  assert.deepEqual([champ.custom_id, champ.style, champ.required, champ.max_length], ['message', 2, true, 4000]);
  assert.ok(champ.label.length <= 45 && champ.placeholder.length <= 100);
  p.k.b.horloge.t += 60_000;
  const r = await p.fenetre(`tk:rm:${tk.id}`, { message: 'Voici ma capture : https://exemple.org/capture.png @everyone' }, dans);
  assert.equal(r.corps.data.content, 'Message envoyé dans le ticket.');
  const post = p.k.discord.etat.messages.get(tk.salon_id).at(-1);
  assert.equal(post.embeds[0].author.name, 'Léa');
  assert.match(post.embeds[0].description, /^Voici ma capture : https:\/\/exemple\.org\/capture\.png @​everyone$/, 'mentions neutralisées');
  assert.deepEqual(post.allowed_mentions, { parse: [] });
  assert.equal(post.components[0].components[0].custom_id, `tk:rp:${tk.id}`, 'bouton « Répondre » sous le message');
  const m = await p.k.b.base.premier("SELECT * FROM tickets_messages WHERE ticket_id = ? AND genre = 'discord' ORDER BY cree_le DESC LIMIT 1", [tk.id]);
  assert.equal(m.auteur_discord_id, LEA);
  assert.equal(Number(m.staff), 0);
  assert.equal(m.contenu, 'Voici ma capture : https://exemple.org/capture.png @everyone');
  assert.equal(m.discord_message_id, post.id);
  const l = await p.k.b.base.premier('SELECT * FROM tickets WHERE id = ?', [tk.id]);
  assert.equal(l.statut, 'ouvert', 'l’auteur a répondu : plus en attente');
  assert.equal(l.dernier_message_id, post.id);
  // Visible dans l'app comme un message de l'auteur.
  const d = await p.k.api(`/tickets/${tk.id}`, p.support.jeton);
  assert.ok(d.corps.messages.some(x => x.genre === 'discord' && !x.staff && x.contenu.startsWith('Voici ma capture')));
  // Message vide : refusé.
  assert.match((await p.fenetre(`tk:rm:${tk.id}`, { message: '   ' }, dans)).corps.data.content, /Message vide/);
  // Le staff (rôle Discord de la catégorie) : renvoyé vers l'app ; un inconnu : refusé.
  assert.match((await p.clic(`tk:rp:${tk.id}`, { qui: KAI, roles: [STAFF], ...dans })).corps.data.content, /AppDashboard/);
  assert.match((await p.clic(`tk:rp:${tk.id}`, { qui: BOB, ...dans })).corps.data.content, /Seuls l’auteur/);
  assert.match((await p.fenetre(`tk:rm:${tk.id}`, { message: 'intrus' }, { qui: BOB, ...dans })).corps.data.content, /Seuls l’auteur/);
  // Une personne ajoutée peut répondre.
  await p.clic(`tk:as:${tk.id}`, { qui: KAI, roles: [STAFF], valeurs: [BOB], resolved: { users: { [BOB]: { id: BOB, username: 'bob' } } }, ...dans });
  assert.equal((await p.clic(`tk:rp:${tk.id}`, { qui: BOB, ...dans })).corps.type, 9);
  // Bouton d'un autre salon : sans effet.
  assert.match((await p.clic(`tk:rp:${tk.id}`, { salon: '710000000000000013' })).corps.data.content, /salon d’un ticket/);
  // Ticket fermé : plus de réponse.
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
  assert.ok(p.droits(t2, BOB).deny & ENVOYER);
});

test('repli : Discord refuse les surcharges complètes (403) → « Envoyer des messages » refusé seul', async () => {
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
  const d = p.droits(tk, LEA);
  assert.equal(d.deny, ENVOYER);
  assert.equal(d.allow & ENVOYER, 0n);
});
