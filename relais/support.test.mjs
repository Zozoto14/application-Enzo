import { test } from 'node:test';
import assert from 'node:assert/strict';
import relais, { jetonDeProfil, nettoyerTexteDiscord, validerTicket } from './worker.mjs';

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

/** Faux Discord : remplace `fetch` le temps du test et garde ce qu'il a reçu. */
function fauxDiscord(statut = 204) {
  const recus = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    recus.push({ url: String(url), options });
    return new Response(statut === 204 ? null : `erreur ${WEBHOOK}`, { status: statut });
  };
  return { recus, rendre: () => (globalThis.fetch = original) };
}

const ticket = (plus = {}) => ({ categorie: 'bug', sujet: 'Le graphique ne charge pas', message: 'Depuis hier, le graphique du portefeuille reste vide.', numero: 7, ...plus });
const poster = (env, corps, jeton = JETON, brut = false) =>
  relais.fetch(
    new Request('https://relais.test/support', { method: 'POST', headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' }, body: brut ? corps : JSON.stringify(corps) }),
    env,
  );

test('support : refus sans jeton, avec un mauvais jeton, et en GET', async () => {
  const env = { JETON, BOITE: kvMemoire(), DISCORD_WEBHOOK_URL: WEBHOOK };
  const d = fauxDiscord();
  try {
    const sans = await relais.fetch(new Request('https://relais.test/support', { method: 'POST', body: JSON.stringify(ticket()) }), env);
    assert.equal(sans.status, 401);
    assert.equal((await poster(env, ticket(), 'autre-jeton-0123456789ab')).status, 401);
    const get = await relais.fetch(new Request('https://relais.test/support', { headers: { Authorization: `Bearer ${JETON}` } }), env);
    assert.equal(get.status, 405);
    assert.equal(d.recus.length, 0, 'rien n’est parti vers Discord');
  } finally {
    d.rendre();
  }
});

test('support : un ticket valide est relayé à Discord (jeton maître et jeton de profil)', async () => {
  const env = { JETON, BOITE: kvMemoire(), DISCORD_WEBHOOK_URL: WEBHOOK };
  const d = fauxDiscord();
  try {
    const r = await poster(env, ticket());
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, numero: 7 });
    assert.equal(d.recus.length, 1);
    assert.equal(d.recus[0].url, WEBHOOK);
    const charge = JSON.parse(d.recus[0].options.body);
    assert.deepEqual(charge.allowed_mentions, { parse: [] });
    assert.match(charge.embeds[0].title, /^#7 · Bug · Le graphique ne charge pas$/);
    assert.match(charge.embeds[0].description, /graphique du portefeuille/);

    const jetonAmi = await jetonDeProfil(JETON, 'abc123def');
    assert.equal((await poster(env, ticket({ categorie: 'question' }), jetonAmi)).status, 200);
    assert.equal(d.recus.length, 2);
  } finally {
    d.rendre();
  }
});

test('support : limite de débit par profil (5 par heure), les autres profils ne sont pas touchés', async () => {
  const env = { JETON, BOITE: kvMemoire(), DISCORD_WEBHOOK_URL: WEBHOOK };
  const d = fauxDiscord();
  try {
    const ami = await jetonDeProfil(JETON, 'abc123def');
    const autre = await jetonDeProfil(JETON, 'zzz999yyy');
    for (let i = 0; i < 5; i++) assert.equal((await poster(env, ticket(), ami)).status, 200);
    const refuse = await poster(env, ticket(), ami);
    assert.equal(refuse.status, 429);
    assert.ok(Number(refuse.headers.get('Retry-After')) > 0);
    assert.equal(d.recus.length, 5, 'le sixième n’atteint pas Discord');
    assert.equal((await poster(env, ticket(), autre)).status, 200);
    assert.equal((await poster(env, ticket())).status, 200, 'le jeton maître a son propre compteur');
  } finally {
    d.rendre();
  }
});

test('support : la limite fonctionne aussi sans KV (compteur en mémoire)', async () => {
  const env = { JETON, DISCORD_WEBHOOK_URL: WEBHOOK };
  const d = fauxDiscord();
  try {
    const ami = await jetonDeProfil(JETON, 'memoire01');
    for (let i = 0; i < 5; i++) assert.equal((await poster(env, ticket(), ami)).status, 200);
    assert.equal((await poster(env, ticket(), ami)).status, 429);
  } finally {
    d.rendre();
  }
});

test('support : les mentions sont neutralisées (allowed_mentions vide, @everyone défait)', async () => {
  const env = { JETON, BOITE: kvMemoire(), DISCORD_WEBHOOK_URL: WEBHOOK };
  const d = fauxDiscord();
  try {
    const r = await poster(env, ticket({ sujet: '@everyone regardez', message: 'Coucou @here et <@123456789> et <@&987654321> ok ok ok' }));
    assert.equal(r.status, 200);
    const charge = JSON.parse(d.recus[0].options.body);
    assert.deepEqual(charge.allowed_mentions, { parse: [] });
    const tout = `${charge.embeds[0].title} ${charge.embeds[0].description}`;
    assert.ok(!/@everyone|@here/.test(tout), tout);
    assert.ok(!/<@\d|<@&\d/.test(tout), tout);
  } finally {
    d.rendre();
  }
});

test('support : texte tronqué, caractères de contrôle retirés, champs techniques en liste fermée', async () => {
  assert.equal(nettoyerTexteDiscord('a\u0000b‮c', 10), 'abc');
  assert.equal(nettoyerTexteDiscord('x'.repeat(50), 10).length, 10);
  const { ticket: t } = validerTicket(
    ticket({ message: 'm'.repeat(5000), technique: { version: '2026.10.06', plateforme: 'web', rang: 'ami', compte: 'ab12cd', motDePasse: 'hunter2', jeton: JETON } }),
  );
  assert.equal(t.message.length, 2000);
  assert.deepEqual(Object.keys(t.technique).sort(), ['compte', 'plateforme', 'rang', 'version']);
  const env = { JETON, BOITE: kvMemoire(), DISCORD_WEBHOOK_URL: WEBHOOK };
  const d = fauxDiscord();
  try {
    await poster(env, ticket({ technique: { version: '1', plateforme: 'web', motDePasse: 'hunter2' } }));
    assert.ok(!d.recus[0].options.body.includes('hunter2'));
  } finally {
    d.rendre();
  }
});

test('support : ticket invalide ou trop gros refusé', async () => {
  const env = { JETON, BOITE: kvMemoire(), DISCORD_WEBHOOK_URL: WEBHOOK };
  const d = fauxDiscord();
  try {
    assert.equal((await poster(env, ticket({ categorie: 'piratage' }))).status, 400);
    assert.equal((await poster(env, ticket({ sujet: 'a' }))).status, 400);
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

test('support : une capture PNG valide part en pièce jointe (multipart)', async () => {
  const env = { JETON, BOITE: kvMemoire(), DISCORD_WEBHOOK_URL: WEBHOOK };
  const d = fauxDiscord();
  try {
    const r = await poster(env, ticket({ piece: { nom: 'Ma capture (1).PNG', type: 'image/png', donnees: PNG } }));
    assert.equal(r.status, 200);
    const corps = d.recus[0].options.body;
    assert.ok(corps instanceof FormData);
    assert.equal(corps.get('files[0]').name, 'Ma-capture-1.png');
    assert.equal(JSON.parse(corps.get('payload_json')).allowed_mentions.parse.length, 0);
  } finally {
    d.rendre();
  }
});

test('support : webhook absent, mal formé ou refusé par Discord → erreur propre, sans fuite', async () => {
  const d = fauxDiscord();
  try {
    for (const DISCORD_WEBHOOK_URL of [undefined, '', 'http://evil.test/hook', 'https://evil.test/api/webhooks/123456789/abcdefghijklmnop']) {
      const r = await poster({ JETON, BOITE: kvMemoire(), DISCORD_WEBHOOK_URL }, ticket());
      assert.equal(r.status, 503);
      const texte = await r.text();
      assert.match(texte, /pas configuré/);
      assert.ok(!texte.includes('evil.test'));
    }
    assert.equal(d.recus.length, 0);
  } finally {
    d.rendre();
  }
  const refus = fauxDiscord(404);
  try {
    const r = await poster({ JETON, BOITE: kvMemoire(), DISCORD_WEBHOOK_URL: WEBHOOK }, ticket());
    assert.equal(r.status, 502);
    const texte = await r.text();
    assert.ok(!texte.includes('SECRET') && !texte.includes('webhooks'), texte);
  } finally {
    refus.rendre();
  }
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error(`connexion refusée vers ${WEBHOOK}`);
  };
  try {
    const r = await poster({ JETON, BOITE: kvMemoire(), DISCORD_WEBHOOK_URL: WEBHOOK }, ticket());
    assert.equal(r.status, 502);
    assert.ok(!(await r.text()).includes('SECRET'));
  } finally {
    globalThis.fetch = original;
  }
});

test('support : un échec de Discord ne consomme pas la limite', async () => {
  const env = { JETON, BOITE: kvMemoire(), DISCORD_WEBHOOK_URL: WEBHOOK };
  const d = fauxDiscord(500);
  try {
    for (let i = 0; i < 7; i++) assert.equal((await poster(env, ticket())).status, 502);
  } finally {
    d.rendre();
  }
  const ok = fauxDiscord();
  try {
    assert.equal((await poster(env, ticket())).status, 200);
  } finally {
    ok.rendre();
  }
});

test('support : l’adresse du webhook n’apparaît nulle part dans le code du relais ni du client', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('./worker.mjs', import.meta.url), 'utf8');
  assert.ok(!/discord(app)?\.com\/api\/webhooks\/\d/.test(source));
});
