/**
 * Diagnostic d'un moteur d'IA externe (API principale « api » ou secondaire « api2 »), à lancer SUR LE SERVEUR :
 *
 *   node esport/outils/tester-ia.mjs api2 [--flux] [--ipv4] [--effort low|medium|high|aucun] [--comme-curl] [--delai 90]
 *
 * Lit la configuration COMME L'APP (fichier ~/.appdashboard/esport.env ou ESPORT_ENV, par le chargeur de l'app :
 * pas de `source`, qui casse sur `MAIL_FROM=Nom <adresse>`), construit EXACTEMENT la requête du test de connexion
 * de l'Administration IA, puis l'envoie trois fois :
 *   1. avec `fetch` (undici, transport des anciennes versions de l'app) : premier octet, fin ;
 *   2. avec node:https (transport actuel de l'app) : DNS, connexion TCP, TLS, premier octet, fin, adresse IP ;
 *   3. par le connecteur de l'app (test de connexion complet) : message d'erreur exact que l'app afficherait.
 * Pour chaque essai : statut HTTP, type, taille, extrait de la réponse.
 *
 *   --flux        réponse en flux (SSE), comme IA_API_FLUX=oui / IA_API2_FLUX=oui
 *   --ipv4        connexion en IPv4 seulement (node:https ; comme IA_IPV4=oui)
 *   --effort X    reasoning_effort envoyé (défaut : celui de l'app pour ce modèle) ; « aucun » : rien
 *   --comme-curl  corps minimal (sans temperature ni top_p, reasoning_effort low), pour comparer avec curl
 *   --delai N     délai total de chaque essai en secondes (défaut 90)
 *
 * LA CLÉ N'EST JAMAIS AFFICHÉE : seulement sa longueur et ses 6 premiers caractères ; toute trace de la clé (ou
 * d'une clé « nvapi-… » / « sk-… ») dans une réponse est masquée.
 */

import { promises as dns } from 'node:dns';
import { pathToFileURL } from 'node:url';
import { chargerEnv, fichierEnvParDefaut } from '../serveur/commun.mjs';
import { ADAPTATEURS, LIBELLES_ETAPES, TAILLE_MAX_REPONSE_IA, configIa, creerConnecteur, etapesTexte } from '../noyau/ia/connecteur.mjs';
import { MESSAGES_TEST, testerConnexion } from '../noyau/ia/assistant.mjs';
import { creerFetchIaNode } from '../adaptateurs/fetchIaNode.mjs';

const VARIABLES_PROXY = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy', 'NODE_USE_ENV_PROXY', 'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS'];

/** Arguments de la ligne de commande. */
export function lireArguments(args) {
  const o = { moteur: 'api2', flux: false, ipv4: false, effort: undefined, commeCurl: false, delaiS: 90, aide: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === 'api' || a === 'api2') o.moteur = a;
    else if (a === '--flux') o.flux = true;
    else if (a === '--ipv4') o.ipv4 = true;
    else if (a === '--comme-curl') o.commeCurl = true;
    else if (a === '--effort') o.effort = String(args[++i] ?? '').toLowerCase();
    else if (a === '--delai') o.delaiS = Math.min(1800, Math.max(1, Number.parseInt(args[++i], 10) || 90));
    else if (a === '-h' || a === '--help' || a === '--aide') o.aide = true;
    else throw new Error(`Argument inconnu : ${a} (voir --aide).`);
  }
  return o;
}

/** Masque la clé (et toute clé d'API reconnaissable) dans un texte. */
export function masquer(texte, cle) {
  let t = String(texte ?? '');
  if (cle && cle.length >= 4) t = t.split(cle).join('[clé masquée]');
  return t.replace(/nvapi-[A-Za-z0-9_-]{6,}/g, '[clé masquée]').replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[clé masquée]').replace(/Bearer\s+[^\s"']+/gi, 'Bearer [clé masquée]');
}

/** Présentation de la clé : longueur et 6 premiers caractères seulement. */
export const apercuCle = cle => (cle ? `présente, ${cle.length} caractères, commence par « ${cle.slice(0, 6)} »` : 'ABSENTE');

/** Corps et en-têtes de la requête : exactement ceux de l'app (test de connexion), ou la variante « comme curl ». */
export function requeteTest(config, { flux = false, effort, commeCurl = false } = {}) {
  const c = effort === undefined ? config : { ...config, effort: ['aucun', 'none', 'non'].includes(effort) ? null : effort };
  const { url, init } = ADAPTATEURS['openai-chat'].requete(c, MESSAGES_TEST.map(m => ({ ...m })), { json: true, maxJetons: 200, effort: effort === undefined ? 'low' : undefined, flux });
  if (commeCurl) {
    const corps = { model: config.modele, messages: MESSAGES_TEST.map(m => ({ ...m })), max_tokens: 4096, reasoning_effort: 'low', response_format: { type: 'json_object' }, stream: Boolean(flux) };
    if (flux) corps.stream_options = { include_usage: true };
    return { url, init: { ...init, body: JSON.stringify(corps) } };
  }
  return { url, init };
}

const ms = v => (Number.isFinite(v) ? (v >= 10_000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`) : '—');

/** Lit le corps (borné), en notant le temps de fin ; rend { texte, octets, finMs, erreur }. */
async function lireCorps(r, t0) {
  const lecteur = r.body?.getReader?.();
  if (!lecteur) return { texte: '', octets: 0, finMs: performance.now() - t0, erreur: null };
  const morceaux = [];
  let octets = 0;
  try {
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      octets += value.length;
      if (octets <= TAILLE_MAX_REPONSE_IA * 2) morceaux.push(value);
    }
  } catch (e) {
    return { texte: Buffer.concat(morceaux).toString('utf8'), octets, finMs: performance.now() - t0, erreur: e };
  }
  return { texte: Buffer.concat(morceaux).toString('utf8'), octets, finMs: performance.now() - t0, erreur: null };
}

/** Résumé d'une réponse : JSON (contenu, raisonnement : tailles) ou flux SSE (événements, [DONE]). */
export function resumerReponse(texte) {
  const t = String(texte ?? '');
  if (/^\s*(data|event|:)/.test(t)) {
    const lignes = t.split(/\r?\n/).filter(l => l.startsWith('data:'));
    let contenu = '';
    let raisonnement = 0;
    let fin = null;
    for (const l of lignes) {
      const d = l.slice(5).trim();
      if (d === '[DONE]') continue;
      try {
        const j = JSON.parse(d);
        const delta = j?.choices?.[0]?.delta ?? {};
        if (typeof delta.content === 'string') contenu += delta.content;
        for (const k of ['reasoning_content', 'reasoning']) if (typeof delta[k] === 'string') raisonnement += delta[k].length;
        if (typeof j?.choices?.[0]?.finish_reason === 'string') fin = j.choices[0].finish_reason;
      } catch {
        // ligne illisible : ignorée
      }
    }
    return `flux SSE : ${lignes.length} événements, [DONE] ${lignes.some(l => l.slice(5).trim() === '[DONE]') ? 'reçu' : 'ABSENT'}, fin ${fin ?? 'absente'}, contenu « ${contenu.slice(0, 200)} », raisonnement ${raisonnement} caractères`;
  }
  try {
    const j = JSON.parse(t);
    const m = j?.choices?.[0]?.message;
    if (m) {
      const r = typeof m.reasoning_content === 'string' ? m.reasoning_content.length : typeof m.reasoning === 'string' ? m.reasoning.length : 0;
      return `JSON : contenu « ${String(m.content ?? '').slice(0, 200)} », raisonnement ${r} caractères, fin ${j.choices[0].finish_reason ?? '?'}, jetons ${j.usage?.prompt_tokens ?? '?'} → ${j.usage?.completion_tokens ?? '?'}`;
    }
  } catch {
    // pas du JSON
  }
  return `extrait : ${t.slice(0, 400).replace(/\s+/g, ' ')}`;
}

/** Cause courte d'une erreur réseau (codes seulement). */
function cause(e) {
  const codes = [e?.name, e?.code, e?.cause?.code, e?.cause?.name, e?.phase ? `étape ${e.phase} (${LIBELLES_ETAPES[e.phase] ?? e.phase})` : null].filter(Boolean);
  return [...new Set(codes)].join(', ') || 'inconnue';
}

/** Un essai brut (fetch ou node:https) : temps, statut, taille, extrait. */
async function essai(nom, fetchFn, url, init, { delaiS, cle, ecrire }) {
  ecrire(`\n— ${nom}`);
  const t0 = performance.now();
  let r;
  try {
    r = await fetchFn(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(delaiS * 1000) });
  } catch (e) {
    ecrire(`  ÉCHEC après ${ms(performance.now() - t0)} avant toute réponse : ${cause(e)}`);
    if (e?.etapes) ecrire(`  étapes : ${etapesTexte(e.etapes)}`);
    return { ok: false };
  }
  const premierOctet = performance.now() - t0;
  const c = await lireCorps(r, t0);
  ecrire(`  HTTP ${r.status} ${r.headers.get('content-type') ?? '(sans type)'} ; premier octet ${ms(premierOctet)}, fin ${ms(c.finMs)}, ${c.octets} octets${r.headers.get('content-length') ? ` (Content-Length ${r.headers.get('content-length')})` : ''}`);
  if (r.etapesIa) ecrire(`  étapes : ${etapesTexte(r.etapesIa)}`);
  if (c.erreur) ecrire(`  LECTURE INTERROMPUE : ${cause(c.erreur)}`);
  ecrire(`  ${masquer(resumerReponse(c.texte), cle)}`);
  return { ok: r.ok && !c.erreur };
}

/** `fetchGlobal`, `transport` (fabrique du transport node:https) et `resoudre` (résolution DNS affichée) : injectables (tests). */
export async function principal(args, { env = process.env, ecrire = t => console.log(t), fetchGlobal = (...a) => globalThis.fetch(...a), transport = creerFetchIaNode, resoudre = true } = {}) {
  const o = lireArguments(args);
  if (o.aide) {
    ecrire('node esport/outils/tester-ia.mjs api|api2 [--flux] [--ipv4] [--effort low|medium|high|aucun] [--comme-curl] [--delai 90]');
    return 0;
  }
  const fichier = chargerEnv(env.ESPORT_ENV || fichierEnvParDefaut('esport'), env);
  const configs = configIa(env);
  const config = o.moteur === 'api2' ? configs.secondaire : configs;
  const cle = config.lireCle();
  const s = o.moteur === 'api2' ? '2' : '';
  ecrire(`Diagnostic IA — moteur ${o.moteur} — Node ${process.versions.node} (${process.platform})`);
  ecrire(`Configuration : ${fichier ?? 'aucun fichier esport.env trouvé (variables du processus seulement)'}`);
  ecrire(`  fournisseur ${config.fournisseur}, modèle ${config.modele || '(IA_MODELE' + s + ' absent)'}, adresse ${config.url || '(invalide)'}`);
  ecrire(`  clé IA_API${s}_CLE : ${apercuCle(cle)}`);
  ecrire(`  raisonnement ${config.raisonnement ? 'oui' : 'non'}, effort de l'app ${config.effort ?? 'aucun'}, flux ${config.flux ? 'oui' : 'non'} (essai : ${o.flux ? 'oui' : 'non'}), délai ${Math.round((config.delaiMs ?? 90_000) / 1000)} s, IA_IPV4 ${env.IA_IPV4 || 'non'}`);
  const proxy = VARIABLES_PROXY.filter(v => env[v]);
  ecrire(`  variables réseau présentes : ${proxy.length ? proxy.join(', ') : 'aucune'} (valeurs non affichées ; curl suit HTTPS_PROXY, fetch et node:https non)`);
  if (!config.actif) {
    ecrire(`Moteur non configuré : ${config.raison}.`);
    return 2;
  }
  const hote = new URL(config.url).hostname;
  if (resoudre) try {
    const t = performance.now();
    const adresses = await dns.lookup(hote, { all: true });
    ecrire(`DNS ${hote} (${ms(performance.now() - t)}) : ${adresses.map(a => `${a.address} (IPv${a.family})`).join(', ')}`);
  } catch (e) {
    ecrire(`DNS ${hote} : ÉCHEC (${cause(e)})`);
  }
  const { url, init } = requeteTest(config, { flux: o.flux, effort: o.effort, commeCurl: o.commeCurl });
  ecrire(`Requête : POST ${url}`);
  ecrire(`  en-têtes : ${Object.keys(init.headers).map(k => (k === 'Authorization' ? 'Authorization: Bearer [clé masquée]' : `${k}: ${init.headers[k]}`)).join(' ; ')}`);
  ecrire(`  corps : ${masquer(init.body, cle)}`);
  const contexte = { delaiS: o.delaiS, cle, ecrire };
  const a = await essai('1. fetch (undici)', fetchGlobal, url, init, contexte);
  const b = await essai(`2. node:https${o.ipv4 ? ' (IPv4)' : ''}`, transport({ ipv4: o.ipv4 }), url, init, contexte);
  ecrire('\n— 3. connecteur de l’app (test de connexion de l’Administration IA)');
  const lignes = [];
  const cx = creerConnecteur(o.effort === undefined ? config : { ...config, effort: ['aucun', 'none', 'non'].includes(o.effort) ? null : o.effort }, {
    fetch: transport({ ipv4: o.ipv4 }),
    journal: texte => lignes.push(texte),
  });
  const t0 = performance.now();
  let c = false;
  try {
    const r = await testerConnexion({ appeler: (_genre, messages, options) => cx.discuter(messages, { ...options, ...(o.flux ? { flux: true } : {}), ...(o.effort && o.effort !== 'low' ? { effort: o.effort } : {}) }), delaiMax: o.delaiS * 1000 });
    c = r.reponse;
    ecrire(`  ${r.reponse ? 'OK' : 'réponse reçue mais sans {"ok": true}'} en ${ms(performance.now() - t0)}`);
  } catch (e) {
    ecrire(`  ÉCHEC après ${ms(performance.now() - t0)} : ${e.code} — ${masquer(e.message, cle)}`);
  }
  for (const l of lignes) ecrire(`  journal : ${masquer(l, cle)}`);
  ecrire(`\nBilan : fetch ${a.ok ? 'OK' : 'ÉCHEC'}, node:https ${b.ok ? 'OK' : 'ÉCHEC'}, app ${c ? 'OK' : 'ÉCHEC'}.`);
  return a.ok && b.ok && c ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  principal(process.argv.slice(2)).then(
    code => process.exit(code),
    e => {
      console.error(`Erreur : ${masquer(e?.message ?? e, '')}`);
      process.exit(1);
    },
  );
}
