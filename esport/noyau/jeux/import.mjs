/**
 * Import des images de maps et de leur échelle (Administration › Jeux › « Importer les images et l'échelle »).
 * Aucune image n'est livrée avec l'app : le SERVEUR les télécharge à la demande du gestionnaire et les range
 * dans son stockage (comme une image déposée à la main, `jeu_images`), avec leur source.
 *
 *  - Valorant : API communautaire publique https://valorant-api.com/v1/maps : minimap (`displayIcon`, fond de
 *    l'éditeur), multiplicateurs (`xMultiplier`, `yMultiplier`, `xScalarToAdd`, `yScalarToAdd` : unités du jeu →
 *    coordonnées normalisées de la minimap ; 1 m = 100 unités du jeu) → échelle calculée sans calibrage à la
 *    main ; `callouts` (regionName, superRegionName, location) → repères nommés (sites, spawns, callouts).
 *  - The Finals : pas d'API officielle ; liste d'adresses d'images fournie (modifiable) par le gestionnaire, et
 *    une échelle APPROXIMATIVE par défaut, marquée « à vérifier » (calibrage à deux points pour la corriger).
 *
 * Réseau : https seulement, hôtes autorisés (Valorant) ou publics (adresses saisies), sans redirection, délai
 * borné, 10 Mo par image, type annoncé ET contenu vérifiés. Idempotent : une image inchangée (même empreinte)
 * n'est pas re-déposée ; un calibrage fait à la main n'est jamais écrasé.
 */

import { echec } from '../outils.mjs';
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
      const nom = `${c.superRegionName && !/^(mid|attacker side|defender side)$/i.test(c.superRegionName) ? `${c.superRegionName} ` : ''}${c.regionName}`.trim().slice(0, 30);
      return { nom, type: typeCallout(c), x: repere(Number(c.location.y) * xm + Number(m.xScalarToAdd ?? 0)), y: repere(Number(c.location.x) * ym + Number(m.yScalarToAdd ?? 0)) };
    })
    .filter(r => (vus.has(r.nom) ? false : (vus.add(r.nom), true)))
    .slice(0, 100);
  return { cle: cleDe(m.displayName), nom: m.displayName, minimap: m.displayIcon, competitive: Boolean(m.tacticalDescription), pxParMetre, reperes };
}

/** Échelle approximative par défaut d'une map de The Finals (à vérifier). */
export const echelleApproxTheFinals = () => echelleDepuisUnitesParMetre(Math.round((1000 / LARGEUR_APPROX_THEFINALS_M) * 1000) / 1000, 'approx');
