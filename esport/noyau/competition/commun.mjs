/**
 * Outils communs des modules « Tournois » et « Résultats » : contrôles d'accès (appartenance → module →
 * permission), profil du jeu, adversaires (ceux du scouting, création rapide), membres, saisies (dates,
 * instants dans le fuseau de la team, montants).
 */

import { evenement } from '../evenements.mjs';
import { autorise } from '../permissions.mjs';
import { echec, iso, nouvelId, texteNettoye } from '../outils.mjs';
import { lignesParIds } from '../requetes.mjs';
import { validerDonnees } from '../jeux/schema.mjs';
import { instantMural, lireDate, lireHeure, fuseauValide } from '../planning/temps.mjs';
import { lienSur } from '../review/markdown.mjs';

export const MODULE_TOURNOIS = 'tournois';
export const MODULE_RESULTATS = 'resultats';
export const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_ADVERSAIRES_TEAM = 200;

export const exigerUuid = (valeur, quoi) => {
  if (typeof valeur !== 'string' || !MOTIF_UUID.test(valeur)) throw echec(404, `${quoi}-introuvable`, 'Introuvable.');
  return valeur;
};

export const peut = (ctx, p) => autorise(ctx.permissions, ctx.modules, p);

/** Module activé (sinon 404), puis permission (sinon 403). */
export function exigerModule(ctx, module, permission) {
  if (!ctx.modules.has(module)) throw echec(404, 'module-desactive', 'Ce module n’est pas activé pour cette team.');
  if (permission && !peut(ctx, permission)) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
}

/** Profil du jeu `cle` (données validées, tolérant) ; profil vide si le jeu n'existe plus. */
export async function profilDuJeu(base, cle) {
  const j = await base.premier('SELECT cle, nom, couleur, base, donnees FROM jeux WHERE cle = ?', [cle]);
  let brut = {};
  try {
    brut = j ? JSON.parse(j.donnees) : {};
  } catch {
    brut = {};
  }
  return { cle, nom: j?.nom ?? cle, couleur: j?.couleur ?? '#8b8b9a', base: j?.base ?? null, donnees: validerDonnees(brut, { tolerant: true }).donnees };
}

/** Booléen saisi (true/false, 1/0). */
export const booleen = (v, repli) => (typeof v === 'boolean' ? v : v === 1 || v === '1' ? true : v === 0 || v === '0' ? false : repli);

/** Entier facultatif dans des bornes (400 `code` sinon). */
export function entierOuNull(v, code, min, max) {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) throw echec(400, code, 'Nombre hors limites.');
  return n;
}

/** Date AAAA-MM-JJ (ou null). */
export function lireJour(v, code = 'date') {
  if (v === undefined || v === null || v === '') return null;
  const d = lireDate(v);
  if (!d) throw echec(400, code, 'Date invalide (AAAA-MM-JJ).');
  return String(v).slice(0, 10);
}

/**
 * Instant saisi : ISO avec fuseau (« …Z », « …+02:00 »), ou heure murale « AAAA-MM-JJ HH:MM » (ou
 * « AAAA-MM-JJTHH:MM ») dans le fuseau de la team. Rend l'ISO UTC, ou null si vide.
 */
export function lireInstant(v, fuseau, code = 'date') {
  if (v === undefined || v === null || v === '') return null;
  const t = String(v).trim();
  const mural = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/.exec(t);
  let ms;
  if (mural) {
    const d = lireDate(mural[1]);
    const h = lireHeure(mural[2]);
    if (!d || h === undefined || h >= 1440 || !fuseauValide(fuseau)) throw echec(400, code, 'Date ou heure invalide.');
    ms = instantMural(fuseau, d, h);
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(t)) ms = Date.parse(t);
  else throw echec(400, code, 'Date ou heure invalide.');
  if (!Number.isFinite(ms) || ms < Date.UTC(2000, 0, 1) || ms > Date.UTC(2100, 0, 1)) throw echec(400, code, 'Date ou heure invalide.');
  return iso(ms);
}

/** Montant saisi en unités (« 12,50 », 12.5) → centimes ; null si vide. */
export function lireMontant(v, code = 'montant') {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 100_000_000) throw echec(400, code, 'Montant invalide.');
  return Math.round(n * 100);
}

export function lireDevise(v) {
  if (v === undefined || v === null || v === '') return 'EUR';
  const d = String(v).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(d)) throw echec(400, 'devise', 'Devise invalide (code à trois lettres : EUR, USD…).');
  return d;
}

/** Adresse https (lien du tournoi) ; null si vide. */
export function lireLien(v) {
  const t = String(v ?? '').trim();
  if (!t) return null;
  if (t.length > 500 || !/^https:\/\//i.test(t) || !lienSur(t)) throw echec(400, 'lien', 'Adresse invalide : https://… sans espace (500 caractères au plus).');
  return t;
}

// ------------------------------------------------------------------ Membres

/** Membres de la team (actifs, ou tous avec `tous`) : `{ compte, pseudo, statut, cle, proprietaire }`. */
export async function membresTeam(base, teamId, { tous = false } = {}) {
  const lignes = await base.tous(
    `SELECT m.compte_id, m.statut, r.cle_systeme, c.pseudo FROM membres m JOIN roles r ON r.id = m.role_id JOIN comptes c ON c.id = m.compte_id
      WHERE m.team_id = ? AND (m.statut = 'actif' OR ? = 1) ORDER BY LOWER(c.pseudo)`,
    [teamId, tous ? 1 : 0],
  );
  return lignes.map(l => ({ compte: l.compte_id, pseudo: l.pseudo, statut: l.statut, cle: l.cle_systeme ?? null, proprietaire: l.cle_systeme === 'proprietaire' }));
}

// ------------------------------------------------------------------ Adversaires

/** Adversaires de la team par identifiant (fiche du scouting, même supprimée : le nom reste lisible). */
export async function adversairesParId(base, teamId, ids) {
  const lignes = await lignesParIds(base, 'SELECT id, nom, logo_url, supprime_le FROM adversaires WHERE team_id = ? AND id', ids, { paramsAvant: [teamId] });
  return new Map(lignes.map(a => [a.id, { id: a.id, nom: a.nom, logoUrl: a.logo_url ?? null, supprime: Boolean(a.supprime_le) }]));
}

/**
 * Adversaires saisis : `[{ id }]` (fiche du scouting de la team, vivante) ou `[{ nom }]` (équipe sans
 * fiche, ex. une manche à plusieurs équipes). Rend `[{ id, nom }]` (nom = celui de la fiche).
 */
export async function lireAdversaires(base, teamId, saisie, { max = 63, garder = [] } = {}) {
  if (saisie === undefined || saisie === null) return [];
  if (!Array.isArray(saisie) || saisie.length > max) throw echec(400, 'adversaires', 'Liste d’adversaires illisible.');
  const ids = saisie.map(a => (typeof a === 'string' ? a : a?.id)).filter(x => typeof x === 'string' && x);
  for (const id of ids) if (!MOTIF_UUID.test(id)) throw echec(400, 'adversaire', 'Adversaire inconnu.');
  const fiches = await adversairesParId(base, teamId, ids);
  const sortie = [];
  const vus = new Set();
  for (const a of saisie) {
    const id = typeof a === 'string' ? a : typeof a?.id === 'string' && a.id ? a.id : null;
    if (id) {
      const f = fiches.get(id);
      // Une fiche supprimée depuis reste acceptée si elle était déjà là (modification d'un ancien match).
      const deja = garder.find(x => x?.id === id);
      if (!f || (f.supprime && !deja)) throw echec(400, 'adversaire', 'Adversaire inconnu.');
      if (vus.has(id)) continue;
      vus.add(id);
      sortie.push({ id, nom: f.supprime && deja?.nom ? deja.nom : f.nom });
    } else {
      const nom = texteNettoye(a?.nom, 60);
      if (nom.length < 1) throw echec(400, 'adversaire', 'Adversaire inconnu.');
      if (vus.has(`nom:${nom.toLowerCase()}`)) continue;
      vus.add(`nom:${nom.toLowerCase()}`);
      sortie.push({ id: null, nom });
    }
  }
  return sortie;
}

/** Adversaires d'une ligne (JSON stocké) avec le nom et le logo à jour de leur fiche. */
export function adversairesAffiches(stockes, fiches) {
  return (Array.isArray(stockes) ? stockes : []).map(a => {
    const f = a.id ? fiches.get(a.id) : null;
    return { id: a.id ?? null, nom: f && !f.supprime ? f.nom : a.nom, logoUrl: f && !f.supprime ? f.logoUrl : null, ...(a.place !== undefined ? { place: a.place, points: a.points ?? null } : {}) };
  });
}

/**
 * Création rapide d'un adversaire (fiche du scouting réduite au nom, et au logo facultatif) depuis un
 * tournoi ou un résultat. Rend `{ adversaire, lot }` (à exécuter par l'appelant).
 */
export async function adversaireRapide(base, { acteur, teamId, nom: brut, logoUrl, t }) {
  const nom = texteNettoye(brut, 60);
  if (nom.length < 2) throw echec(400, 'nom', 'Nom : 2 caractères au moins.');
  const existant = await base.premier('SELECT id, nom, logo_url FROM adversaires WHERE team_id = ? AND supprime_le IS NULL AND LOWER(nom) = ?', [teamId, nom.toLowerCase()]);
  if (existant) return { adversaire: { id: existant.id, nom: existant.nom, logoUrl: existant.logo_url ?? null }, lot: [], existait: true };
  const n = await base.premier('SELECT COUNT(*) AS n FROM adversaires WHERE team_id = ? AND supprime_le IS NULL', [teamId]);
  if (Number(n?.n ?? 0) >= MAX_ADVERSAIRES_TEAM) throw echec(409, 'trop-d-adversaires', `Une team garde ${MAX_ADVERSAIRES_TEAM} adversaires au plus.`);
  const logo = lireLienLogo(logoUrl);
  const id = nouvelId();
  return {
    adversaire: { id, nom, logoUrl: logo },
    existait: false,
    lot: [
      { sql: 'INSERT INTO adversaires (id, team_id, nom, logo_url, notes, cree_par, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', params: [id, teamId, nom, logo, '', acteur.compte, iso(t), iso(t)] },
      evenement('opponent.created', { teamId, acteur: acteur.compte, entiteType: 'adversaire', entiteId: id, charge: { nom, depuis: 'competition' }, maintenant: t }),
    ],
  };
}

function lireLienLogo(v) {
  const t = String(v ?? '').trim();
  if (!t) return null;
  if (t.length > 500 || !/^https:\/\//i.test(t) || !lienSur(t)) throw echec(400, 'logo', 'Adresse invalide : https://… sans espace (500 caractères au plus).');
  return t;
}
