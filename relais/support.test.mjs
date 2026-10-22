import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relais, jetonDeProfil, nettoyerTexteDiscord, validerTicket } from './relais.mjs';

const JETON = 'jeton-de-test-0123456789abcdef';
const WEBHOOK = 'https://discord.com/api/webhooks/123456789012345678/SECRET-token-tres-secret_abcdef0123456789';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]).toString('base64');

function kvMemoire() {
  const donnees = new Map();
  return {
    donnees,
    get: async cle => (donnees.has(cle) ? donnees.get(cle) : null),
    put: async (cle, valeur) => void donnees.set(cle, valeur),
    delete: async cle => void donnees.delete(cle),
  };
}

/**
 * Faux Discord : remplace `fetch` le temps du test. `mode` : « forum » (accepte thread_name, refuse
 * sans : 220001) ou « texte » (refuse thread_name : 220003). Répond comme `?wait=true` (message JSON).
 */
function fauxDiscord({ statut = 200, mode = 'forum' } = {}) {
  const recus = [];
  const original = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async (url, options) => {
    const u = String(url);
    const charge = options?.body instanceof FormData ? JSON.parse(options.body.get('payload_json')) : JSON.parse(options?.body ?? '{}');
    recus.push({ url: u, options, charge });
    if (statut !== 200) return new Response(`erreur ${WEBHOOK}`, { status: statut });
    if (u.includes('/channels/')) return Response.json({ id: '900000000000000001' });
    const fil = new URL(u).searchParams.get('thread_id');
    if (!fil && mode === 'forum' && !charge.thread_name) return Response.json({ code: 220001, message: 'forum' }, { status: 400 });
    if (mode === 'texte' && charge.thread_name) return Response.json({ code: 220003, message: 'not forum' }, { status: 400 });
    n++;
    return Response.json({ id: `80000000000000000${n}`, channel_id: fil ?? (charge.thread_name ? `70000000000000000${n}` : '600000000000000000') });
  };
  return { recus, rendre: () => (globalThis.fetch = original) };
}

const ticket = (plus = {}) => ({ categorie: 'bug', titre: 'Le graphique ne charge pas', message: 'Depuis hier, le **graphique** du portefeuille reste vide.', auteur: 'Léa', technique: { version: '2026.10.21', plateforme: 'web', appareil: 'iPhone', app: 'portefeuille', langue: 'fr' }, ...plus });
const appel = (env, chemin, { methode = 'POST', corps, jeton = JETON, brut = false } = {}) =>
  relais.traiter(
    new Request(`https://relais.test${chemin}`, {
      method: methode,
      headers: { ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}), 'Content-Type': 'application/json' },
      ...(corps !== undefined ? { body: brut ? corps : JSON.stringify(corps) } : {}),
    }),
    env,
  );
const poster = (env, corps, jeton = JETON, brut = false) => appel(env, '/support', { corps, jeton, brut });
const envDe = (plus = {}) => ({ JETON, BOITE: kvMemoire(), DISCORD_WEBHOOK_URL: WEBHOOK, ...plus });

test('support : refus sans jeton, avec un mauvais jeton, et en GET sur /support', async () => {
  const env = envDe();
  const d = fauxDiscord();
  try {
    assert.equal((await poster(env, ticket(), '')).status, 401);
    assert.equal((await poster(env, ticket(), 'autre-jeton-0123456789ab')).status, 401);
    assert.equal((await appel(env, '/support', { methode: 'GET' })).status, 405);
    assert.equal(d.recus.length, 0, 'rien n’est parti vers Discord');
  } finally {
    d.rendre();
  }
});

test('support : une demande est rangée et annoncée dans un fil du forum (embed soigné)', async () => {
  const env = envDe({ LIEN_APP: 'https://appdashboard.fr' });
  const d = fauxDiscord();
  try {
    const ami = await jetonDeProfil(JETON, 'abc123def');
    const r = await poster(env, ticket(), ami);
    assert.equal(r.status, 200);
    const lu = await r.json();
    assert.equal(lu.ok, true);
    assert.equal(lu.discord, true);
    assert.equal(lu.ticket.statut, 'ouvert');
    assert.equal(lu.ticket.numero, 1);
    assert.ok(!('compte' in lu.ticket), 'l’auteur ne reçoit pas de champs du Fondateur');
    assert.equal(d.recus.length, 1, 'forum : le premier essai (avec thread_name) passe');
    assert.match(d.recus[0].url, /\?wait=true$/);
    const { charge } = d.recus[0];
    assert.deepEqual(charge.allowed_mentions, { parse: [] });
    assert.match(charge.thread_name, /^#1 · 🐞 Bug · Le graphique ne charge pas$/);
    const e = charge.embeds[0];
    assert.equal(e.color, 0xe5484d);
    assert.match(e.title, /Bug · Le graphique/);
    assert.match(e.author.name, /Léa · compte abc123/);
    assert.equal(e.url, 'https://appdashboard.fr/#/app/administration');
    assert.match(e.description, /\*\*graphique\*\*/);
    const champs = Object.fromEntries(e.fields.map(f => [f.name, f.value]));
    assert.equal(champs.App, 'portefeuille');
    assert.equal(champs.Version, '2026.10.21');
    assert.equal(champs.Appareil, 'iPhone · web');
    assert.equal(env.BOITE.donnees.get('support:mode'), 'forum');
    // Couleur par catégorie.
    await poster(env, ticket({ categorie: 'idee' }), ami);
    assert.equal(d.recus.at(-1).charge.embeds[0].color, 0xf5a524);
  } finally {
    d.rendre();
  }
});

test('support : salon texte détecté (220003), mode retenu ; anciennes catégories et « sujet » acceptés', async () => {
  const env = envDe();
  const d = fauxDiscord({ mode: 'texte' });
  try {
    const r = await poster(env, { categorie: 'demande', sujet: 'Ancienne app', message: 'Un ticket envoyé par une ancienne version.', numero: 7 });
    assert.equal(r.status, 200);
    const lu = await r.json();
    assert.equal(lu.numero, 7, 'l’ancienne app retrouve son numéro');
    assert.equal(lu.ticket.categorie, 'idee');
    assert.equal(d.recus.length, 2, 'essai forum refusé, puis message simple');
    assert.equal(env.BOITE.donnees.get('support:mode'), 'texte');
    await poster(env, ticket());
    assert.equal(d.recus.length, 3, 'mode retenu : un seul essai');
    assert.equal(d.recus[2].charge.thread_name, undefined);
  } finally {
    d.rendre();
  }
});

test('support : chacun ne voit que SES demandes ; le Fondateur voit tout', async () => {
  const env = envDe();
  const d = fauxDiscord();
  try {
    const lea = await jetonDeProfil(JETON, 'lea000001');
    const tom = await jetonDeProfil(JETON, 'tom000002');
    const idLea = (await (await poster(env, ticket({ titre: 'Demande de Léa' }), lea)).json()).ticket.id;
    await poster(env, ticket({ titre: 'Demande de Tom' }), tom);
    const deLea = await (await appel(env, '/support/tickets', { methode: 'GET', jeton: lea })).json();
    assert.deepEqual(deLea.tickets.map(t => t.titre), ['Demande de Léa']);
    const deTom = await (await appel(env, '/support/tickets?tous=1', { methode: 'GET', jeton: tom })).json();
    assert.deepEqual(deTom.tickets.map(t => t.titre), ['Demande de Tom'], '?tous=1 ne sert à rien sans le jeton maître');
    // Tom ne peut ni compléter, ni marquer lue la demande de Léa : 404 (rien ne fuit).
    assert.equal((await appel(env, `/support/tickets/${idLea}/messages`, { corps: { texte: 'je m’invite' }, jeton: tom })).status, 404);
    assert.equal((await appel(env, `/support/tickets/${idLea}/lu`, { jeton: tom })).status, 404);
    assert.equal((await appel(env, `/support/tickets/${idLea}/statut`, { corps: { statut: 'resolu' }, jeton: lea })).status, 403);
    const tout = await (await appel(env, '/support/tickets?tous=1', { methode: 'GET' })).json();
    assert.deepEqual(tout.tickets.map(t => t.titre).sort(), ['Demande de Léa', 'Demande de Tom']);
    assert.equal(tout.tickets.find(t => t.titre === 'Demande de Léa').compte, 'lea000001');
    assert.equal(tout.discord, 'ok');
  } finally {
    d.rendre();
  }
});

test('support : réponse du Fondateur → fil Discord, notification chez l’utilisateur, lue ensuite', async () => {
  const env = envDe();
  const d = fauxDiscord();
  try {
    const lea = await jetonDeProfil(JETON, 'lea000001');
    const cree = await (await poster(env, ticket(), lea)).json();
    const r = await appel(env, `/support/tickets/${cree.ticket.id}/messages`, { corps: { texte: 'Corrigé dans la **version 2026.10.22** @everyone' } });
    assert.equal(r.status, 200);
    const lu = await r.json();
    assert.equal(lu.ticket.statut, 'repondu');
    assert.equal(lu.discord, true);
    const reponse = d.recus.at(-1);
    assert.match(reponse.url, /thread_id=700000000000000001/, 'la réponse va dans le fil de la demande');
    assert.equal(reponse.charge.embeds[0].author.name, 'Réponse du Fondateur');
    assert.ok(!/@everyone/.test(reponse.charge.embeds[0].description));
    const vue = await (await appel(env, '/support/tickets', { methode: 'GET', jeton: lea })).json();
    assert.equal(vue.tickets[0].nonLus, 1);
    assert.equal(vue.tickets[0].messages[0].de, 'equipe');
    assert.equal((await appel(env, `/support/tickets/${cree.ticket.id}/lu`, { jeton: lea })).status, 200);
    const apres = await (await appel(env, '/support/tickets', { methode: 'GET', jeton: lea })).json();
    assert.equal(apres.tickets[0].nonLus, 0);
    // L'utilisateur complète : la demande se rouvre, le message part dans le fil.
    const c = await (await appel(env, `/support/tickets/${cree.ticket.id}/messages`, { corps: { texte: 'Merci, ça marche !' }, jeton: lea })).json();
    assert.equal(c.ticket.statut, 'ouvert');
    assert.equal(d.recus.at(-1).charge.embeds[0].color, 0x64748b);
    // Statut par le Fondateur.
    const s = await (await appel(env, `/support/tickets/${cree.ticket.id}/statut`, { corps: { statut: 'resolu' } })).json();
    assert.equal(s.ticket.statut, 'resolu');
  } finally {
    d.rendre();
  }
});

test('support : salon texte + bot du relais → la première réponse ouvre un fil sur le message', async () => {
  const env = envDe({ DISCORD_BOT_TOKEN: 'bot-token-de-test' });
  const d = fauxDiscord({ mode: 'texte' });
  try {
    const cree = await (await poster(env, ticket())).json();
    await appel(env, `/support/tickets/${cree.ticket.id}/messages`, { corps: { texte: 'Réponse dans un fil' } });
    const fil = d.recus.find(r => r.url.includes('/threads'));
    assert.ok(fil, 'le bot crée le fil');
    assert.equal(fil.options.headers.Authorization, 'Bot bot-token-de-test');
    assert.match(d.recus.at(-1).url, /thread_id=900000000000000001/);
  } finally {
    d.rendre();
  }
});

test('support : limite de débit par compte (5 par heure), les autres comptes ne sont pas touchés', async () => {
  const env = envDe();
  const d = fauxDiscord();
  try {
    const ami = await jetonDeProfil(JETON, 'abc123def');
    const autre = await jetonDeProfil(JETON, 'zzz999yyy');
    for (let i = 0; i < 5; i++) assert.equal((await poster(env, ticket(), ami)).status, 200);
    const refuse = await poster(env, ticket(), ami);
    assert.equal(refuse.status, 429);
    assert.ok(Number(refuse.headers.get('Retry-After')) > 0);
    assert.equal(d.recus.length, 5, 'la sixième n’atteint pas Discord');
    assert.equal((await poster(env, ticket(), autre)).status, 200);
    assert.equal((await poster(env, ticket())).status, 200, 'le jeton maître a son propre compteur');
  } finally {
    d.rendre();
  }
});

test('support : les mentions sont neutralisées (allowed_mentions vide, @everyone défait)', async () => {
  const env = envDe();
  const d = fauxDiscord();
  try {
    const r = await poster(env, ticket({ titre: '@everyone regardez', message: 'Coucou @here et <@123456789> et <@&987654321> ok ok ok', auteur: '@here' }));
    assert.equal(r.status, 200);
    const { charge } = d.recus[0];
    assert.deepEqual(charge.allowed_mentions, { parse: [] });
    const tout = `${charge.thread_name} ${charge.embeds[0].title} ${charge.embeds[0].description} ${charge.embeds[0].author.name}`;
    assert.ok(!/@everyone|@here/.test(tout), tout);
    assert.ok(!/<@\d|<@&\d/.test(tout), tout);
  } finally {
    d.rendre();
  }
});

test('support : texte tronqué, caractères de contrôle retirés, champs techniques en liste fermée', async () => {
  assert.equal(nettoyerTexteDiscord('a\u0000b‮c', 10), 'abc');
  assert.equal(nettoyerTexteDiscord('x'.repeat(50), 10).length, 10);
  const { ticket: t } = validerTicket(ticket({ message: 'm'.repeat(5000), technique: { version: '2026.10.06', plateforme: 'web', rang: 'ami', motDePasse: 'hunter2', jeton: JETON } }));
  assert.equal(t.message.length, 4000);
  assert.deepEqual(Object.keys(t.technique).sort(), ['plateforme', 'rang', 'version']);
  const env = envDe();
  const d = fauxDiscord();
  try {
    await poster(env, ticket({ technique: { version: '1', plateforme: 'web', motDePasse: 'hunter2' } }));
    assert.ok(!JSON.stringify(d.recus[0].charge).includes('hunter2'));
    assert.ok(![...env.BOITE.donnees.values()].some(v => String(v).includes('hunter2')), 'rien de tel n’est rangé non plus');
  } finally {
    d.rendre();
  }
});

test('support : demande invalide ou trop grosse refusée', async () => {
  const env = envDe();
  const d = fauxDiscord();
  try {
    assert.equal((await poster(env, ticket({ categorie: 'piratage' }))).status, 400);
    assert.equal((await poster(env, ticket({ titre: 'a' }))).status, 400);
    assert.equal((await poster(env, ticket({ message: 'court' }))).status, 400);
    assert.equal((await poster(env, '{pas du json', JETON, true)).status, 400);
    assert.equal((await poster(env, 'x'.repeat(7 * 1024 * 1024), JETON, true)).status, 413);
    assert.equal((await poster(env, ticket({ piece: { nom: 'x.exe', type: 'application/x-msdownload', donnees: PNG } }))).status, 400);
    assert.equal((await poster(env, ticket({ piece: { nom: 'x.png', type: 'image/png', donnees: Buffer.from('pas une image').toString('base64') } }))).status, 400);
    assert.equal(d.recus.length, 0);
  } finally {
    d.rendre();
  }
});

test('support : une capture PNG valide part en pièce jointe (multipart), jamais rangée après envoi', async () => {
  const env = envDe();
  const d = fauxDiscord();
  try {
    const r = await poster(env, ticket({ piece: { nom: 'Ma capture (1).PNG', type: 'image/png', donnees: PNG } }));
    assert.equal(r.status, 200);
    assert.equal((await r.json()).ticket.pieceNom, 'Ma-capture-1.png');
    const corps = d.recus[0].options.body;
    assert.ok(corps instanceof FormData);
    assert.equal(corps.get('files[0]').name, 'Ma-capture-1.png');
    const charge = JSON.parse(corps.get('payload_json'));
    assert.equal(charge.embeds[0].image.url, 'attachment://Ma-capture-1.png');
    assert.deepEqual(charge.attachments, [{ id: 0, filename: 'Ma-capture-1.png' }]);
    assert.ok(![...env.BOITE.donnees.keys()].some(k => k.startsWith('support:piece:')));
  } finally {
    d.rendre();
  }
});

test('support : webhook absent ou Discord en panne → demande rangée quand même, renvoi possible, rien ne fuit', async () => {
  for (const DISCORD_WEBHOOK_URL of [undefined, '', 'http://evil.test/hook', 'https://evil.test/api/webhooks/123456789/abcdefghijklmnop']) {
    const d = fauxDiscord();
    try {
      const r = await poster(envDe({ DISCORD_WEBHOOK_URL }), ticket());
      assert.equal(r.status, 200);
      const texte = await r.text();
      assert.match(texte, /pas configuré/);
      assert.ok(!texte.includes('evil.test'));
      assert.equal(d.recus.length, 0);
    } finally {
      d.rendre();
    }
  }
  const env = envDe();
  const panne = fauxDiscord({ statut: 500 });
  let id;
  try {
    const r = await poster(env, ticket({ piece: { nom: 'c.png', type: 'image/png', donnees: PNG } }));
    assert.equal(r.status, 200);
    const lu = await r.json();
    id = lu.ticket.id;
    assert.equal(lu.discord, false);
    assert.equal(lu.ticket.discord, 'echec');
    assert.ok(!JSON.stringify(lu).includes('SECRET'));
    const etat = await (await appel(env, '/support/etat', { methode: 'GET' })).json();
    assert.equal(etat.webhook, 'ok');
    assert.equal(etat.dernierEnvoi.ok, false);
    assert.equal(etat.dernierEnvoi.statut, 500);
    assert.ok(!JSON.stringify(etat).includes('SECRET'));
  } finally {
    panne.rendre();
  }
  const ok = fauxDiscord();
  try {
    const r = await appel(env, `/support/tickets/${id}/discord`);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).ticket.discord, 'envoye');
    assert.ok(ok.recus[0].options.body instanceof FormData, 'la capture gardée part avec le renvoi');
    assert.ok(![...env.BOITE.donnees.keys()].some(k => k.startsWith('support:piece:')), 'puis elle est effacée');
  } finally {
    ok.rendre();
  }
  const ami = await jetonDeProfil(JETON, 'abc123def');
  assert.equal((await appel(env, '/support/etat', { methode: 'GET', jeton: ami })).status, 403);
});

test('support : réponse du Fondateur avec e-mail (adresse jamais rangée)', async () => {
  const envoyes = [];
  const env = envDe({ ENVOYER_COURRIEL: async m => void envoyes.push(m) });
  const d = fauxDiscord();
  try {
    const lea = await jetonDeProfil(JETON, 'lea000001');
    const cree = await (await poster(env, ticket({ langue: 'en' }), lea)).json();
    const r = await (await appel(env, `/support/tickets/${cree.ticket.id}/messages`, { corps: { texte: 'Fixed!', courriel: { adresse: 'lea@exemple.fr' } } })).json();
    assert.equal(r.courriel.ok, true);
    assert.equal(envoyes.length, 1);
    assert.equal(envoyes[0].a, 'lea@exemple.fr');
    assert.match(envoyes[0].objet, /Reply to your request #1/);
    assert.match(envoyes[0].html, /Fixed!/);
    const tout = [...env.BOITE.donnees.values()].join('\n');
    assert.ok(!tout.includes('lea@exemple.fr'), 'adresse absente de la boîte');
    assert.ok(tout.includes('l***@e***.fr'), 'seulement masquée au journal');
  } finally {
    d.rendre();
  }
});

test('support : l’adresse du webhook n’apparaît nulle part dans le code du relais', async () => {
  const { readFileSync } = await import('node:fs');
  for (const f of ['./relais.mjs', './support.mjs', './courriel.mjs']) {
    assert.ok(!/discord(app)?\.com\/api\/webhooks\/\d/.test(readFileSync(new URL(f, import.meta.url), 'utf8')), f);
  }
});
