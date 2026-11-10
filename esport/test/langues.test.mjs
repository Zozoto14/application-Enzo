/**
 * Langues du serveur Esport (français / anglais) :
 *  - dictionnaires cohérents (mêmes clés, mêmes variables, pluriels complets) ;
 *  - tous les messages d'erreur du serveur ont une traduction anglaise (table partagée avec l'app) ;
 *  - langue du compte (migration 0012) et langue Discord de la team ;
 *  - messages Discord (webhook et embeds) dans la langue de la team ;
 *  - bot : réponses éphémères dans la langue du compte lié, sinon la locale de l'interaction ;
 *  - exports CSV dans la langue de l'app (Accept-Language) ;
 *  - commandes slash : mêmes noms, descriptions localisées en anglais.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { LANGUES, categoriePluriel, langueDepuisEntete, langueDepuisLocale, lireLangue, nomRoleSysteme, texte, texteNombre, traduireErreur } from '../noyau/langues.mjs';
import { EN } from '../noyau/textes/en.mjs';
import { FR } from '../noyau/textes/fr.mjs';
import { CLES_TEXTES_EN, EVENEMENTS_DISCORD, exemples, libelleTypeEvenement, textesEvenement } from '../noyau/discord/catalogue.mjs';
import { embedEvenement, texteConvoques, texteReponses, boutonsRsvp, boutonsPagination, nomType } from '../noyau/discord/embeds.mjs';
import { formaterDelai, formaterInstant } from '../noyau/discord/formats.mjs';
import { LOCALES_FRANCAIS, definitionsCommandes } from '../noyau/discord/bot/commandes.mjs';
import { lireDateSaisie } from '../noyau/discord/bot/interactions.mjs';
import { texteCharge } from '../noyau/discord/messages.mjs';
import { traiterFile } from '../noyau/discord/file.mjs';
import { banc, CLE, teamAvecMembres } from './aide.mjs';
import { URL_TEST } from './discord-aide.mjs';

const RACINE = fileURLToPath(new URL('../', import.meta.url));
const variables = t => [...t.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

// ------------------------------------------------------------------ Dictionnaires

test('dictionnaires serveur : mêmes clés, mêmes variables, pluriels complets, rien de vide', () => {
  assert.deepEqual(Object.keys(EN).sort(), Object.keys(FR).sort());
  for (const [cle, fr] of Object.entries(FR)) {
    assert.deepEqual(variables(EN[cle]), variables(fr), `variables de « ${cle} »`);
    assert.ok(EN[cle].trim() !== '' && fr.trim() !== '', cle);
    if (cle.endsWith('.one')) assert.ok(`${cle.slice(0, -4)}.other` in FR, `pluriel de ${cle}`);
    if (cle.endsWith('.other') && !['type.other', 'bot.strat.other'].includes(cle)) assert.ok(`${cle.slice(0, -6)}.one` in FR, `singulier de ${cle}`);
  }
});

test('textes : interpolation, pluriels (1 joueur / 2 joueurs ; 1 player / 2 players), langue inconnue → français', () => {
  assert.deepEqual([...LANGUES], ['fr', 'en']);
  assert.equal(texte('fr', 'embed.convoques', { n: 3 }), 'Convoqués (3)');
  assert.equal(texte('en', 'embed.convoques', { n: 3 }), 'Called up (3)');
  assert.equal(texteNombre('fr', 'convoques.et_autres', 1), 'et 1 autre');
  assert.equal(texteNombre('fr', 'convoques.et_autres', 4), 'et 4 autres');
  assert.equal(texteNombre('en', 'convoques.et_autres', 1), 'and 1 other');
  assert.equal(texteNombre('en', 'convoques.et_autres', 4), 'and 4 others');
  assert.equal(texteNombre('fr', 'bot.taches.ouvertes', 0), '0 ouverte');
  assert.equal(texteNombre('en', 'bot.planning.titre', 7), '🗓️ Schedule · next 7 days');
  assert.equal(texte('de', 'bot.rsvp.oui'), '✅ Oui');
  assert.equal(texte('en', 'cle.inconnue'), 'cle.inconnue');
  assert.equal(categoriePluriel('fr', 0), 'one');
  assert.equal(categoriePluriel('en', 0), 'other');
});

test('langue : valeurs valides, locale Discord, en-tête Accept-Language', () => {
  assert.equal(lireLangue('en'), 'en');
  assert.equal(lireLangue('fr'), 'fr');
  assert.equal(lireLangue('de'), null);
  assert.equal(lireLangue(undefined), null);
  assert.equal(langueDepuisLocale('en-US'), 'en');
  assert.equal(langueDepuisLocale('en-GB'), 'en');
  assert.equal(langueDepuisLocale('fr'), 'fr');
  assert.equal(langueDepuisLocale('de'), 'fr');
  assert.equal(langueDepuisLocale(undefined), 'fr');
  assert.equal(langueDepuisEntete('en-GB,en;q=0.9,fr;q=0.8'), 'en');
  assert.equal(langueDepuisEntete('fr-FR'), 'fr');
  assert.equal(langueDepuisEntete(''), null);
  assert.equal(nomRoleSysteme('en', 'Joueur'), 'Player');
  assert.equal(nomRoleSysteme('en', 'Capitaine'), 'Capitaine');
});

// ------------------------------------------------------------------ Messages d'erreur

function tousLesFichiers(dossier) {
  const sortie = [];
  for (const n of readdirSync(dossier)) {
    const p = join(dossier, n);
    if (statSync(p).isDirectory()) sortie.push(...tousLesFichiers(p));
    else if (n.endsWith('.mjs')) sortie.push(p);
  }
  return sortie;
}

test('erreurs : tout message de echec() du serveur a sa traduction anglaise (phrase exacte ou motif)', () => {
  const litteraux = new Set();
  const gabarits = new Set();
  const re = /echec\(\s*\d+\s*,\s*(?:'[a-z0-9-]+'|`[^`]*`)\s*,\s*(?:('(?:[^'\\]|\\.)*')|(`(?:[^`\\]|\\.|\$\{[^}]*\})*`))/g;
  for (const f of [...tousLesFichiers(join(RACINE, 'noyau')), ...tousLesFichiers(join(RACINE, 'adaptateurs'))]) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(re)) {
      if (m[1]) litteraux.add(m[1].slice(1, -1).replace(/\\'/g, "'"));
      else gabarits.add(m[2].slice(1, -1));
    }
  }
  // Messages passés en argument (anti-escalade, convocation, récurrence, dessin) et motifs de la file Discord.
  for (const f of tousLesFichiers(join(RACINE, 'noyau'))) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/(?:exigerRoleGerable\([^,]+,[^,]+,|refus\(|new Error\()\s*'((?:[^'\\]|\\.)*)'/g)) litteraux.add(m[1].replace(/\\'/g, "'"));
  }
  assert.ok(litteraux.size > 150, `messages relevés : ${litteraux.size}`);
  const sansTraduction = [...litteraux].filter(m => traduireErreur('en', m) === m && !m.startsWith('CLE_ESPORT'));
  assert.deepEqual(sansTraduction, []);
  for (const g of gabarits) {
    if (g.includes('(v =>') || g.includes(' ? ') || g.startsWith('${qui}')) continue; // gabarit imbriqué : couvert par le test de l'API ci-dessous
    const exemple = g.replace(/\$\{[^}]*\}/g, '3');
    assert.notEqual(traduireErreur('en', exemple), exemple, `gabarit sans motif : ${g}`);
  }
  assert.equal(traduireErreur('fr', 'Entrée introuvable.'), 'Entrée introuvable.');
  assert.equal(traduireErreur('en', 'Variable inconnue : {foo}. Variables permises : {titre}, {team}.'), 'Unknown variable: {foo}. Allowed variables: {titre}, {team}.');
});

test('erreurs : motifs de la file Discord (journal) traduits', () => {
  for (const [fr, en] of [
    ['Discord injoignable', 'Discord unreachable'],
    ['Webhook refusé ou supprimé (HTTP 404)', 'Webhook refused or deleted (HTTP 404)'],
    ['Message refusé par Discord (HTTP 400)', 'Message refused by Discord (HTTP 400)'],
    ['Erreur de Discord (HTTP 502)', 'Discord error (HTTP 502)'],
    ['Message périmé (trop ancien pour être utile)', 'Expired message (too old to be useful)'],
  ]) assert.equal(traduireErreur('en', fr), en);
});

// ------------------------------------------------------------------ Catalogue Discord

test('catalogue Discord : chaque type de message a son texte anglais, mêmes variables que le français', () => {
  assert.deepEqual([...CLES_TEXTES_EN].sort(), EVENEMENTS_DISCORD.map(e => e.cle).sort());
  for (const def of EVENEMENTS_DISCORD) {
    const fr = textesEvenement(def, 'fr');
    const en = textesEvenement(def, 'en');
    assert.notEqual(en.libelle, fr.libelle, def.cle);
    assert.notEqual(en.modele, fr.modele, def.cle);
    assert.deepEqual(Object.keys(en.variables).sort(), Object.keys(fr.variables).sort(), `variables de ${def.cle}`);
    assert.deepEqual(variables(en.modele), variables(fr.modele), `variables du modèle ${def.cle}`);
    for (const v of variables(en.modele)) assert.ok(v in en.variables, `${def.cle}: {${v}} non déclarée`);
  }
  assert.equal(libelleTypeEvenement('training', 'fr'), 'Entraînement');
  assert.equal(libelleTypeEvenement('training', 'en'), 'Practice');
  assert.equal(libelleTypeEvenement('inconnu', 'en'), 'Event');
  assert.equal(exemples('en').date, 'Tuesday 21 October');
});

// ------------------------------------------------------------------ Embeds et formats

test('embeds : champs, réponses, convoqués et boutons dans la langue demandée', () => {
  const DEBUT = Date.parse('2026-10-22T18:30:00.000Z');
  const args = { occurrence: { titre: 'Scrim vs Nova', type: 'scrim', debut: DEBUT, fin: DEBUT + 5_400_000, lieu: 'Salon vocal' }, team: { nom: 'Faucons' }, convoques: [{ pseudo: 'Max' }, { pseudo: 'Léa' }], reponses: { oui: 1, peut_etre: 0, non: 1, sans: 2 }, maintenant: DEBUT };
  const fr = embedEvenement({ ...args, genre: 'reminder_h1' });
  assert.equal(fr.author.name, '⏳ Rappel : c’est dans moins d’une heure');
  assert.deepEqual(fr.fields.map(f => f.name), ['🕒 Quand', '⌛ Fin', '📍 Lieu', '👥 Convoqués (2)', '🗳️ Réponses']);
  const en = embedEvenement({ ...args, genre: 'reminder_h1', langue: 'en' });
  assert.equal(en.author.name, '⏳ Reminder: starting in less than an hour');
  assert.deepEqual(en.fields.map(f => f.name), ['🕒 When', '⌛ Ends', '📍 Location', '👥 Called up (2)', '🗳️ Responses']);
  assert.match(en.title, /Scrim · Scrim vs Nova/);
  assert.match(en.fields.at(-1).value, /Yes · 🤔 \*\*0\*\* Maybe · ❌ \*\*1\*\* No · ⏳ 2 no response/);
  assert.equal(texteReponses({ oui: 1, sans: 3 }, 'en'), '✅ **1** Yes · 🤔 **0** Maybe · ❌ **0** No · ⏳ 3 no response');
  assert.equal(texteConvoques([], 'en'), 'The whole team');
  assert.equal(texteConvoques([], 'fr'), 'Toute la team');
  const beaucoup = Array.from({ length: 80 }, (_, i) => ({ pseudo: `Joueur-numero-${i}` }));
  assert.match(texteConvoques(beaucoup, 'en'), /· and \d+ others$/);
  assert.match(texteConvoques(beaucoup, 'fr'), /· et \d+ autres$/);
  const [ligne] = boutonsRsvp('6039e222-7104-44d3-8bd0-e8d1ca3de6aa', '2026-10-22T18:30:00.000Z', { lien: 'https://app.exemple', langue: 'en' });
  assert.deepEqual(ligne.components.map(c => c.label), ['Yes', 'Maybe', 'No', 'Open in the app']);
  const pg = boutonsPagination('taches', 2, 3, 'en')[0].components;
  assert.deepEqual([pg[0].label, pg[2].label], ['Previous', 'Next']);
  assert.equal(nomType('tournament', 'en'), 'Tournament');
});

test('dates et délais des messages : formats de la langue, fuseau de la team', () => {
  const fr = formaterInstant('Europe/Paris', '2026-10-21T18:30:00.000Z', 'fr');
  const en = formaterInstant('Europe/Paris', '2026-10-21T18:30:00.000Z', 'en');
  assert.deepEqual(fr, { date: 'mercredi 21 octobre', heure: '20:30' });
  assert.deepEqual(en, { date: 'Wednesday 21 October', heure: '20:30' });
  assert.equal(formaterDelai(30_000, 'en'), 'now');
  assert.equal(formaterDelai(45 * 60_000, 'en'), 'in 45 min');
  assert.equal(formaterDelai(20 * 3_600_000, 'en'), 'in 20 h');
  assert.equal(formaterDelai(72 * 3_600_000, 'en'), 'in 3 days');
  assert.equal(formaterDelai(72 * 3_600_000), 'dans 3 jours');
});

test('saisie de date du bot : « today » et « tomorrow » acceptés en plus d’« aujourd’hui » et « demain »', () => {
  const t = Date.parse('2026-10-20T10:00:00.000Z');
  assert.equal(lireDateSaisie('today', 'Europe/Paris', t), '2026-10-20');
  assert.equal(lireDateSaisie('tomorrow', 'Europe/Paris', t), '2026-10-21');
  assert.equal(lireDateSaisie('demain', 'Europe/Paris', t), '2026-10-21');
});

// ------------------------------------------------------------------ Slash commands

test('commandes slash : mêmes noms, descriptions et choix en anglais par défaut, traduits en français (fr), limites Discord respectées', () => {
  const defs = definitionsCommandes();
  assert.deepEqual(
    defs.map(d => d.name),
    ['aide', 'lier', 'delier', 'prochain', 'planning', 'rsvp', 'dispo', 'taches', 'strat', 'resume', 'evenement-creer', 'relancer', 'esport-lier-serveur', 'ticket', 'tickets', 'voc', 'role-temp'],
  );
  assert.deepEqual(LOCALES_FRANCAIS, ['fr']);
  const verifier = (o, chemin) => {
    assert.ok(o.description_localizations, `${chemin} sans traduction`);
    const fr = o.description_localizations.fr;
    assert.ok(fr && fr !== o.description, `${chemin} (fr)`);
    assert.ok(fr.length >= 1 && fr.length <= 100, `${chemin} : ${fr.length} caractères`);
    assert.ok(o.description.length <= 100, chemin);
    for (const c of o.choices ?? []) {
      assert.ok(c.name_localizations?.fr, `${chemin} choix ${c.value}`);
      assert.ok(c.name_localizations.fr.length <= 100);
    }
  };
  for (const d of defs) {
    verifier(d, d.name);
    for (const opt of d.options ?? []) verifier(opt, `${d.name}.${opt.name}`);
  }
  assert.equal(defs.find(d => d.name === 'aide').description, 'What the Esport bot can do');
  assert.equal(defs.find(d => d.name === 'aide').description_localizations.fr, 'Ce que sait faire le bot Esport');
  const creer = defs.find(d => d.name === 'evenement-creer');
  assert.equal(creer.options[0].choices[2].name, 'Tournament');
  assert.equal(creer.options[0].choices[2].name_localizations.fr, 'Tournoi');
  assert.equal(creer.options[0].choices[3].name_localizations.fr, 'Entraînement');
});

// ------------------------------------------------------------------ API : langue du compte et de la team

const MEMBRES = { max12345: { pseudo: 'Max', role: 'manager' }, lea12345: { pseudo: 'Léa', role: 'joueur' } };

test('langue du compte : absente par défaut, enregistrée par PUT /moi/langue, jamais écrasée par un PUT /moi sans langue', async () => {
  const b = await banc();
  const s = await b.session('principal', 'Fondateur');
  const moi = await b.appel('/moi', { jeton: s });
  assert.equal(moi.corps.langue, null);
  const en = await b.appel('/moi/langue', { methode: 'PUT', jeton: s, corps: { langue: 'en' } });
  assert.equal(en.statut, 200, JSON.stringify(en.corps));
  assert.equal(en.corps.langue, 'en');
  assert.equal((await b.appel('/moi', { jeton: s })).corps.langue, 'en');
  // Le profil est modifié sans langue : la langue choisie reste.
  const maj = await b.appel('/moi', { methode: 'PUT', jeton: s, corps: { pseudo: 'Fondateur' } });
  assert.equal(maj.corps.langue, 'en');
  // Avec une langue : prise en compte ; langue invalide : 400.
  assert.equal((await b.appel('/moi', { methode: 'PUT', jeton: s, corps: { pseudo: 'Fondateur', langue: 'fr' } })).corps.langue, 'fr');
  const mauvaise = await b.appel('/moi/langue', { methode: 'PUT', jeton: s, corps: { langue: 'de' } });
  assert.equal(mauvaise.statut, 400);
  assert.equal(mauvaise.corps.code, 'langue');
  assert.equal((await b.appel('/moi', { methode: 'PUT', jeton: s, corps: { pseudo: 'Fondateur', langue: 'es' } })).statut, 400);
  // L'export RGPD contient la langue.
  const exp = await b.appel('/moi/export', { jeton: s });
  assert.equal(exp.corps.profil.langue, 'fr');
});

test('langue du compte : un compte sans profil ne peut pas la régler (428) ; il faut une session', async () => {
  const b = await banc();
  const s = await b.session('lea12345');
  const r = await b.appel('/moi/langue', { methode: 'PUT', jeton: s, corps: { langue: 'en' } });
  assert.equal(r.statut, 428);
  assert.equal((await b.appel('/moi/langue', { methode: 'PUT', corps: { langue: 'en' } })).statut, 401);
});

test('langue Discord de la team : français par défaut, réglée par discord.manage, refusée aux autres', async () => {
  const b = await banc({ fetchDiscord: async () => new Response(null, { status: 204 }) });
  const A = await teamAvecMembres(b, { membres: MEMBRES });
  const d = `/teams/${A.teamId}/discord`;
  assert.equal((await b.appel(d, { jeton: A.sessions.max12345 })).corps.langue, 'fr');
  const refus = await b.appel(`${d}/langue`, { methode: 'PUT', jeton: A.sessions.lea12345, corps: { langue: 'en' } });
  assert.equal(refus.statut, 403);
  const ok = await b.appel(`${d}/langue`, { methode: 'PUT', jeton: A.sessions.max12345, corps: { langue: 'en' } });
  assert.equal(ok.statut, 200, JSON.stringify(ok.corps));
  assert.equal((await b.appel(d, { jeton: A.sessions.max12345 })).corps.langue, 'en');
  assert.equal((await b.appel(`${d}/langue`, { methode: 'PUT', jeton: A.sessions.max12345, corps: { langue: 'xx' } })).statut, 400);
  // Journalisé (sans changement : pas de nouvelle ligne).
  const avant = (await b.base.tous("SELECT id FROM journal WHERE team_id = ? AND action = 'discord.settings_changed'", [A.teamId])).length;
  await b.appel(`${d}/langue`, { methode: 'PUT', jeton: A.sessions.max12345, corps: { langue: 'en' } });
  assert.equal((await b.base.tous("SELECT id FROM journal WHERE team_id = ? AND action = 'discord.settings_changed'", [A.teamId])).length, avant);
});

test('écran Discord : libellés dans la langue de l’app (Accept-Language), modèles par défaut dans la langue de la team', async () => {
  const b = await banc();
  const A = await teamAvecMembres(b, { membres: MEMBRES });
  const d = `/teams/${A.teamId}/discord`;
  const fr = (await b.appel(d, { jeton: A.sessions.max12345 })).corps;
  assert.equal(fr.parametres[0].libelle, 'Nouvel événement au planning');
  assert.match(fr.parametres[0].modeleDefaut, /Nouvel événement/);
  const enUi = (await b.appel(d, { jeton: A.sessions.max12345, entetes: { 'Accept-Language': 'en-GB' } })).corps;
  assert.equal(enUi.parametres[0].libelle, 'New event on the schedule');
  assert.match(enUi.parametres[0].description, /A scrim, a match/);
  assert.equal(enUi.parametres[0].variables.find(v => v.nom === 'titre').description, 'Event title');
  assert.match(enUi.parametres[0].modeleDefaut, /Nouvel événement/, 'le modèle envoyé reste dans la langue de la team (français)');
  await b.appel(`${d}/langue`, { methode: 'PUT', jeton: A.sessions.max12345, corps: { langue: 'en' } });
  const mixte = (await b.appel(d, { jeton: A.sessions.max12345 })).corps;
  assert.equal(mixte.parametres[0].libelle, 'Nouvel événement au planning', 'interface en français');
  assert.match(mixte.parametres[0].modeleDefaut, /New event/);
  assert.match(mixte.parametres[0].apercu, /Tuesday 21 October/);
  assert.equal(mixte.exemples.heure, '20:30');
});

// ------------------------------------------------------------------ Webhook : messages dans la langue de la team

function fauxDiscord() {
  const appels = [];
  const fetch = async (url, init) => {
    appels.push({ url, corps: JSON.parse(init.body) });
    return new Response(null, { status: 204 });
  };
  return { appels, fetch };
}

async function webhookPret(langue) {
  const discord = fauxDiscord();
  const b = await banc({ fetchDiscord: discord.fetch });
  const A = await teamAvecMembres(b, { membres: MEMBRES });
  const d = `/teams/${A.teamId}/discord`;
  assert.equal((await b.appel(`${d}/webhook`, { methode: 'PUT', jeton: A.sessions.max12345, corps: { url: URL_TEST } })).statut, 200);
  if (langue) assert.equal((await b.appel(`${d}/langue`, { methode: 'PUT', jeton: A.sessions.max12345, corps: { langue } })).statut, 200);
  const evenement = () => b.appel(`/teams/${A.teamId}/planning`, { methode: 'POST', jeton: A.sessions.max12345, corps: { type: 'tournament', titre: 'Open Paris', date: '2026-10-22', heureDebut: '20:30', heureFin: '22:00' } });
  const envoyer = () => traiterFile(b.base, { cle: CLE, fetch: discord.fetch, maintenant: b.horloge.t });
  return { b, A, d, discord, evenement, envoyer };
}

test('webhook : une team en anglais reçoit l’annonce en anglais (modèle, type, date, embed) ; en français par défaut', async () => {
  const fr = await webhookPret();
  assert.equal((await fr.evenement()).statut, 200);
  await fr.envoyer();
  const msgFr = texteCharge(fr.discord.appels.at(-1).corps);
  assert.match(msgFr, /Nouvel événement\*\* : Open Paris \(Tournoi\), le jeudi 22 octobre à 20:30/);

  const en = await webhookPret('en');
  assert.equal((await en.evenement()).statut, 200);
  await en.envoyer();
  const charge = en.discord.appels.at(-1).corps;
  const msgEn = texteCharge(charge);
  assert.match(msgEn, /New event\*\*: Open Paris \(Tournament\), on Thursday 22 October at 20:30/);
  assert.doesNotMatch(msgEn, /Nouvel|Tournoi|jeudi/);
  assert.equal(charge.embeds[0].title, '🏟️ Tournament · Open Paris');
  assert.equal(charge.components?.[0]?.components?.at(-1)?.label ?? 'Open in the app', 'Open in the app');
});

test('webhook : un modèle personnalisé n’est jamais traduit ; le message de test suit la langue de la team', async () => {
  const p = await webhookPret('en');
  const modele = await p.b.appel(`${p.d}/parametres/event_created`, { methode: 'PUT', jeton: p.A.sessions.max12345, corps: { modele: 'Nouveau {type} : {titre}' } });
  assert.equal(modele.statut, 200, JSON.stringify(modele.corps));
  await p.evenement();
  await p.envoyer();
  assert.match(texteCharge(p.discord.appels.at(-1).corps), /Nouveau Tournament : Open Paris/);
  // Test du webhook : message en anglais, utilisateur pourtant en français.
  const test = await p.b.appel(`${p.d}/test`, { methode: 'POST', jeton: p.A.sessions.max12345, corps: {} });
  assert.equal(test.statut, 200, JSON.stringify(test.corps));
  const message = texteCharge(p.discord.appels.at(-1).corps);
  assert.match(message, /Test message: the webhook of Team Alpha works/);
  assert.match(message, /Test message/);
});

test('webhook : changer la langue de la team change les messages suivants, pas ceux déjà en file', async () => {
  const p = await webhookPret('en');
  await p.evenement();
  await p.b.appel(`${p.d}/langue`, { methode: 'PUT', jeton: p.A.sessions.max12345, corps: { langue: 'fr' } });
  await p.envoyer();
  assert.match(texteCharge(p.discord.appels.at(-1).corps), /New event\*\*: Open Paris/, 'le message en file garde la langue de sa création');
  await p.evenement();
  await p.envoyer();
  assert.match(texteCharge(p.discord.appels.at(-1).corps), /Nouvel événement\*\* : Open Paris/);
});

// ------------------------------------------------------------------ Exports CSV

test('exports CSV : en-têtes et valeurs dans la langue de l’app (Accept-Language), français sans en-tête', async () => {
  const b = await banc();
  const A = await teamAvecMembres(b, { membres: MEMBRES });
  const jeton = A.sessions.fondateur;
  const tache = await b.appel(`/teams/${A.teamId}/taches`, { methode: 'POST', jeton, corps: { titre: 'Revoir les lineups', priorite: 'haute' } });
  assert.equal(tache.statut, 200, JSON.stringify(tache.corps));
  const csvFr = (await b.appel(`/teams/${A.teamId}/taches/export.csv?format=json`, { jeton })).corps.contenu;
  assert.match(csvFr, /"Titre","Description","Objectif","Assigné","Échéance","Priorité","Statut","En retard"/);
  assert.match(csvFr, /"Haute","À faire","Non"/);
  const csvEn = (await b.appel(`/teams/${A.teamId}/taches/export.csv?format=json`, { jeton, entetes: { 'Accept-Language': 'en' } })).corps.contenu;
  assert.match(csvEn, /"Title","Description","Goal","Assignee","Due date","Priority","Status","Overdue"/);
  assert.match(csvEn, /"High","To do","No"/);
  const objEn = (await b.appel(`/teams/${A.teamId}/objectifs/export.csv?format=json`, { jeton, entetes: { 'Accept-Language': 'en-US' } })).corps.contenu;
  assert.match(objEn, /"Title","Description","For","Target date","Status"/);
  const jrnEn = (await b.appel(`/teams/${A.teamId}/journal/export.csv?format=json`, { jeton, entetes: { 'Accept-Language': 'en' } })).corps.contenu;
  assert.match(jrnEn, /"Date \(UTC\)","Member","Module","Action","Item","Identifier","Details"/);
  const presEn = (await b.appel(`/teams/${A.teamId}/presence/export.csv?format=json&debut=2026-10-01&fin=2026-10-31`, { jeton, entetes: { 'Accept-Language': 'en' } })).corps.contenu;
  assert.match(presEn, /"Date","Time","Event","Type","Player","Called up","Response","Announced delay \(min\)","Announced reason","Attendance","Late \(min\)","Reason","Note"/);
});
