/**
 * Import des images de maps et de leur échelle (Administration › Jeux › « Importer les images et l'échelle »).
 * Aucune image n'est livrée avec l'app : le SERVEUR les télécharge à la demande du gestionnaire et les range
 * dans son stockage (comme une image déposée à la main, `jeu_images`), avec leur source.
 *
 *  - Valorant : API communautaire publique https://valorant-api.com/v1/maps : minimap (`displayIcon`, fond de
 *    l'éditeur), multiplicateurs (`xMultiplier`, `yMultiplier`, `xScalarToAdd`, `yScalarToAdd` : unités du jeu →
 *    coordonnées normalisées de la minimap ; 1 m = 100 unités du jeu) → échelle calculée sans calibrage à la
 *    main ; `callouts` (regionName, superRegionName, location) → repères nommés (sites, spawns, callouts).
 *    Vérifié sur l'API réelle (2026-11) : les maps hors compétition (Gauntlet, The Range, Skirmish, entraînement)
 *    ont `displayIcon` nul et des multiplicateurs à 0, les maps de Team Deathmatch une minimap mais des
 *    multiplicateurs à 0 : toutes écartées ici ; les minimaps sont carrées (1024 × 1024).
 *  - The Finals : pas d'API officielle ; proposition automatique depuis le wiki communautaire (wiki-thefinals.mjs,
 *    maps proposées à valider), ou adresses d'images fournies par le gestionnaire ; échelle APPROXIMATIVE par
 *    défaut, marquée « à vérifier » (calibrage à deux points pour la corriger).
 *
 * Réseau : https seulement, hôtes autorisés (Valorant) ou publics (adresses saisies), sans redirection, délai
 * borné, 10 Mo par image, type annoncé ET contenu vérifiés. Idempotent : une image inchangée (même empreinte)
 * n'est pas re-déposée ; un calibrage fait à la main n'est jamais écrasé.
 */

import { echec, texteLong, texteNettoye } from '../outils.mjs';
import { adresseAutorisee } from '../ressources/apercu.mjs';
import { cleDe } from './schema.mjs';

export const URL_MAPS_VALORANT = 'https://valorant-api.com/v1/maps';
export const HOTES_VALORANT = ['valorant-api.com', 'media.valorant-api.com'];
export const TAILLE_MAX_IMAGE_IMPORT = 10 * 1024 * 1024;
export const TAILLE_MAX_JSON_IMPORT = 5 * 1024 * 1024;
export const DELAI_IMPORT_MS = 15_000;
/** Unités du jeu par mètre (Valorant). */
export const UNITES_PAR_METRE_VALORANT = 100;
/**
 * The Finals : largeur approximative couverte par une vue de dessus d'arène (m) → échelle par défaut, À VÉRIFIER.
 * Hypothèse : l'image couvre environ 250 m de large (1000 unités du repère) ; corrigez par le calibrage.
 */
export const LARGEUR_APPROX_THEFINALS_M = 250;
export const CARTES_THEFINALS = ['Monaco', 'Seoul', 'Skyway Stadium', 'SYS$HORIZON', 'Las Vegas', 'Kyoto', 'Bernal', 'Fortune Stadium', 'Nozomi Citadel'];

const erreurImport = (code, message) => echec(502, code, message);

/** L'adresse est-elle https, publique, et (si `hotes`) sur un hôte autorisé ? */
export function adresseImportable(url, hotes) {
  if (typeof url !== 'string' || url.length > 500 || /["'<>\s\\]/.test(url)) return false;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  if (hotes && !hotes.includes(u.hostname)) return false;
  return adresseAutorisee(url);
}

/** Lit une réponse en refusant au-delà de `max` octets (sans tout charger). */
async function lireBorne(reponse, max) {
  const annoncee = Number(reponse.headers.get('content-length') ?? 0);
  if (annoncee > max) throw erreurImport('import-trop-gros', 'Fichier distant trop volumineux.');
  if (!reponse.body) return new Uint8Array(await reponse.arrayBuffer());
  const lecteur = reponse.body.getReader();
  const morceaux = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await lecteur.cancel().catch(() => undefined);
      throw erreurImport('import-trop-gros', 'Fichier distant trop volumineux.');
    }
    morceaux.push(value);
  }
  const octets = new Uint8Array(total);
  let i = 0;
  for (const m of morceaux) {
    octets.set(m, i);
    i += m.length;
  }
  return octets;
}

/** Téléchargement borné (délai, taille, type), sans redirection. Rend `{ octets, type }`. */
export async function telechargerBorne(fetchImport, url, { hotes, max, types, delai = DELAI_IMPORT_MS }) {
  if (!adresseImportable(url, hotes)) throw erreurImport('import-adresse', 'Adresse refusée (https vers un site public autorisé seulement).');
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), delai);
  try {
    let r;
    try {
      r = await fetchImport(url, { redirect: 'error', signal: ctrl.signal, headers: { Accept: types.join(', ') } });
    } catch {
      throw erreurImport('import-reseau', 'Site distant injoignable (réseau, délai dépassé ou redirection).');
    }
    if (!r.ok) throw erreurImport('import-http', `Le site distant a répondu ${r.status}.`);
    const type = String(r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!types.includes(type)) throw erreurImport('import-type', 'Type de fichier distant inattendu.');
    return { octets: await lireBorne(r, max), type };
  } finally {
    clearTimeout(minuteur);
  }
}

/** Échelle (repère carré de 1000) à partir des unités par mètre : deux points sur une ligne horizontale. */
export function echelleDepuisUnitesParMetre(pxParMetre, methode) {
  if (!(pxParMetre >= 0.5 && pxParMetre <= 100)) return null;
  const distance = [100, 50, 20, 10].find(d => d * pxParMetre <= 1000) ?? 10;
  const l = Math.round(distance * pxParMetre * 10) / 10;
  return { points: [0, 500, l, 500], distance, methode };
}

const repere = (x, y) => Math.round(Math.min(1010, Math.max(-10, x * 1000)) * 10) / 10;

/** Type de repère d'un callout de valorant-api.com (sites, spawns ; le reste : callout). */
function typeCallout(c) {
  const region = String(c.regionName ?? '').toLowerCase();
  const zone = String(c.superRegionName ?? '').toLowerCase();
  if (region === 'site') return 'site';
  if (region === 'spawn') return zone.includes('defender') ? 'spawn-defense' : 'spawn-attaque';
  return 'callout';
}

/**
 * Nom d'un callout de valorant-api.com : « A Main », « Mid Top » ; les spawns, dont la région est « Spawn »
 * des deux côtés, deviennent « Attacker Spawn » et « Defender Spawn » (sinon le second serait perdu au
 * dédoublonnage) ; les autres régions d'un côté (« Attacker Side ») gardent leur seul nom.
 */
function nomCallout(c) {
  const region = String(c.regionName).trim();
  const zone = String(c.superRegionName ?? '').trim();
  if (/^spawn$/i.test(region)) return /defender/i.test(zone) ? 'Defender Spawn' : 'Attacker Spawn';
  return `${zone && !/side$/i.test(zone) ? `${zone} ` : ''}${region}`.trim().slice(0, 30);
}

/**
 * Repères importés d'une map : remplacés à chaque import ; les repères posés à la main (sans `importe`) restent.
 * Rend `{ reperes, n }` (n : repères importés gardés).
 */
export function fusionnerReperes(existants, importes, max = 120) {
  const manuels = (existants ?? []).filter(r => !r.importe);
  const pris = new Set(manuels.map(r => r.cle));
  const nouveaux = importes
    .map(r => ({ ...r, cle: r.cle ?? cleDe(r.nom) }))
    .filter(r => r.cle && !pris.has(r.cle) && (pris.add(r.cle), true))
    .slice(0, Math.max(0, max - manuels.length))
    .map(r => ({ ...r, importe: true }));
  return { reperes: [...manuels, ...nouveaux], n: nouveaux.length };
}

/**
 * Une map de valorant-api.com → ce que l'import en garde : clé, nom, minimap, échelle (unités par mètre),
 * repères (callouts). Rend null si la map n'est pas jouable en compétition (pas de minimap ou de multiplicateurs).
 * Repère : coordonnées normalisées de la minimap (carrée, remplit le repère) : x = jeuY × xMultiplier + xScalarToAdd,
 * y = jeuX × yMultiplier + yScalarToAdd.
 */
export function mapValorant(m) {
  if (!m || typeof m.displayName !== 'string' || typeof m.displayIcon !== 'string') return null;
  const xm = Number(m.xMultiplier);
  const ym = Number(m.yMultiplier);
  if (!Number.isFinite(xm) || !Number.isFinite(ym) || xm === 0 || ym === 0) return null;
  const pxParMetre = Math.round(Math.abs(xm) * UNITES_PAR_METRE_VALORANT * 1000 * 1000) / 1000;
  const vus = new Set();
  const reperes = (Array.isArray(m.callouts) ? m.callouts : [])
    .filter(c => c?.location && Number.isFinite(Number(c.location.x)) && Number.isFinite(Number(c.location.y)) && typeof c.regionName === 'string')
    .map(c => {
      const nom = nomCallout(c);
      return { nom, type: typeCallout(c), x: repere(Number(c.location.y) * xm + Number(m.xScalarToAdd ?? 0)), y: repere(Number(c.location.x) * ym + Number(m.yScalarToAdd ?? 0)) };
    })
    .filter(r => (vus.has(r.nom) ? false : (vus.add(r.nom), true)))
    .slice(0, 100);
  return { cle: cleDe(m.displayName), nom: m.displayName, minimap: m.displayIcon, competitive: Boolean(m.tacticalDescription), pxParMetre, reperes };
}

/** Échelle approximative par défaut d'une map de The Finals (à vérifier). */
export const echelleApproxTheFinals = () => echelleDepuisUnitesParMetre(Math.round((1000 / LARGEUR_APPROX_THEFINALS_M) * 1000) / 1000, 'approx');

// ------------------------------------------------------------------ Agents et capacités (Valorant)

/**
 * Agents de valorant-api.com (« Importer agents et capacités ») : portrait (`displayIconSmall`, sinon
 * `displayIcon`), rôle et son icône, capacités Grenade / Ability1 / Ability2 / Ultimate (touches C, Q, E, X :
 * nom, description, icône ; la passive est ignorée). Réponse anglaise par défaut : les noms officiels sont ceux
 * des caractéristiques pré-remplies de l'éditeur (src/esport/jeux/modeles/valorant.ts), rapprochées par la touche.
 */
export const URL_AGENTS_VALORANT = 'https://valorant-api.com/v1/agents?isPlayableCharacter=true';
/** Emplacement Riot → touche par défaut du jeu. */
export const TOUCHES_VALORANT = { Grenade: 'C', Ability1: 'Q', Ability2: 'E', Ultimate: 'X' };
/** Rôle de valorant-api.com (anglais) → classe du profil Valorant (et son nom). */
export const ROLES_VALORANT = { duelist: ['duelliste', 'Duelliste'], initiator: ['initiateur', 'Initiateur'], controller: ['controleur', 'Contrôleur'], sentinel: ['sentinelle', 'Sentinelle'] };

const media = v => (typeof v === 'string' && /^https:\/\/media\.valorant-api\.com\/[A-Za-z0-9/_.-]{1,200}$/.test(v) ? v : null);

/** Un agent de valorant-api.com → ce que l'import en garde ; null s'il n'est pas jouable ou illisible. */
export function agentValorant(a) {
  if (!a || typeof a.displayName !== 'string' || !a.displayName.trim() || a.isPlayableCharacter === false) return null;
  const nom = texteNettoye(a.displayName, 40);
  const cle = cleDe(nom);
  if (!cle) return null;
  const roleNom = typeof a.role?.displayName === 'string' ? texteNettoye(a.role.displayName, 40) : '';
  const connu = ROLES_VALORANT[cleDe(roleNom)];
  const role = roleNom ? { cle: connu?.[0] ?? cleDe(roleNom), nom: connu?.[1] ?? roleNom, icone: media(a.role.displayIcon) } : null;
  const ordre = Object.keys(TOUCHES_VALORANT);
  const capacites = (Array.isArray(a.abilities) ? a.abilities : [])
    .filter(c => c && typeof c.slot === 'string' && c.slot in TOUCHES_VALORANT && typeof c.displayName === 'string' && c.displayName.trim())
    .sort((x, y) => ordre.indexOf(x.slot) - ordre.indexOf(y.slot))
    .map(c => ({ touche: TOUCHES_VALORANT[c.slot], slot: c.slot, nom: texteNettoye(c.displayName, 40), description: texteLong(c.description, 300), icone: media(c.displayIcon) }));
  return { cle, nom, portrait: media(a.displayIconSmall) ?? media(a.displayIcon), role, capacites };
}
