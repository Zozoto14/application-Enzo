/**
 * Convocations d'un événement du planning. Fonctions PURES.
 *
 * Une convocation est une RÈGLE, pas une simple liste figée :
 *
 *   { groupes: ['joueurs' | 'staff' | 'tous'], membres: [comptes],
 *     exclus: [comptes], proprietaires: [comptes] }
 *
 *  - `groupes` : raccourcis résolus à la lecture. « joueurs » = rôles Joueur
 *    et Remplaçant ; « staff » = Coach, Analyste, Manager ; « tous » = tous
 *    les membres actifs SAUF les Propriétaires. Un rôle personnalisé compte
 *    dans le staff s'il marque la présence ou crée au planning, sinon dans les
 *    joueurs s'il répond aux convocations (RSVP).
 *  - `membres` : choix nominatifs (en plus des groupes) ; `exclus` : retirés
 *    d'un groupe ; `proprietaires` : Propriétaires convoqués, un par un.
 *  - Les Propriétaires et le Fondateur (super admin, compte « principal ») ne
 *    sont JAMAIS convoqués par un groupe : seulement s'ils sont cochés.
 *  - Sans aucun choix : les joueurs (`CONVOCATION_DEFAUT`).
 *
 * Arrivée plus tard dans la team : un membre est convoqué par un groupe aux
 * occurrences qui se terminent APRÈS son arrivée (`rejointLe`), jamais aux
 * occurrences passées (ses statistiques ne se remplissent pas de « non
 * marqué » pour des séances d'avant lui). Un choix nominatif vaut toujours.
 */

export const GROUPES_CONVOCATION = ['joueurs', 'staff', 'tous'];
const CLES_JOUEURS = ['joueur', 'remplacant'];
const CLES_STAFF = ['manager', 'coach', 'analyste'];
const MAX_LISTE = 60;
export const CONVOCATION_DEFAUT = Object.freeze({ groupes: ['joueurs'], membres: [], exclus: [], proprietaires: [] });

const liste = v => (Array.isArray(v) ? [...new Set(v.filter(x => typeof x === 'string' && x.length > 0 && x.length <= 40))].sort() : []);

/** Forme propre d'une convocation (objet ou JSON) ; `null` si illisible. */
export function normaliserConvocation(valeur) {
  let v = valeur;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  return {
    groupes: GROUPES_CONVOCATION.filter(g => Array.isArray(v.groupes) && v.groupes.includes(g)),
    membres: liste(v.membres),
    exclus: liste(v.exclus),
    proprietaires: liste(v.proprietaires),
  };
}

/** Une convocation vide (personne n'est choisi) ? */
export const convocationVide = c => c.groupes.length === 0 && c.membres.length === 0 && c.proprietaires.length === 0;

/**
 * Convocation stockée d'un événement (ou d'une exception) : la colonne
 * `convocation`, sinon l'ancienne colonne `concernes` (avant la migration
 * 0009 : '[]' = toute la team sauf les Propriétaires).
 */
export function convocationDe(ligne) {
  const c = ligne?.convocation ? normaliserConvocation(ligne.convocation) : null;
  if (c) return c;
  let anciens = [];
  try {
    anciens = JSON.parse(ligne?.concernes ?? '[]');
  } catch {
    anciens = [];
  }
  return Array.isArray(anciens) && anciens.length > 0 ? { groupes: [], membres: liste(anciens), exclus: [], proprietaires: [] } : { groupes: ['tous'], membres: [], exclus: [], proprietaires: [] };
}

/**
 * Groupe d'un membre : 'proprietaire' (Propriétaire ou Fondateur), 'joueurs',
 * 'staff' ou 'autres'. `m` : `{ compte, cle (rôle système), proprietaire, perms: Set }`.
 */
export function groupeDe(m) {
  if (m.proprietaire || m.compte === 'principal') return 'proprietaire';
  if (CLES_JOUEURS.includes(m.cle)) return 'joueurs';
  if (CLES_STAFF.includes(m.cle)) return 'staff';
  if (m.cle) return 'autres';
  const a = p => Boolean(m.perms?.has?.(p));
  if (a('attendance.mark') || a('planning.create')) return 'staff';
  if (a('attendance.rsvp_own')) return 'joueurs';
  return 'autres';
}

/**
 * Le membre est-il convoqué ? `fin` (ms) : fin de l'occurrence, pour la règle
 * d'arrivée (un groupe ne convoque pas aux séances terminées avant l'arrivée).
 */
export function estConvoque(convocation, m, fin) {
  const c = convocation ?? CONVOCATION_DEFAUT;
  const g = groupeDe(m);
  if (g === 'proprietaire') return c.proprietaires.includes(m.compte) || c.membres.includes(m.compte);
  if (c.exclus.includes(m.compte)) return false;
  if (c.membres.includes(m.compte)) return true;
  if (!(c.groupes.includes('tous') || c.groupes.includes(g))) return false;
  if (fin === undefined || !m.rejointLe) return true;
  const arrivee = Date.parse(m.rejointLe);
  return Number.isNaN(arrivee) || arrivee < fin;
}

/** Membres convoqués parmi `membres` (actifs), dans leur ordre. */
export function convoques(convocation, membres, fin) {
  return membres.filter(m => estConvoque(convocation, m, fin));
}

/**
 * Convocation saisie → forme stockée, contrôlée contre les membres actifs de
 * la team (`membres` : `[{ compte, cle, proprietaire, perms }]`). Un
 * Propriétaire choisi dans `membres` passe dans `proprietaires` ; un
 * non-Propriétaire dans `proprietaires` passe dans `membres`. Un compte
 * inconnu lève (`inconnus`). Personne de choisi : les joueurs.
 */
export function preparerConvocation(saisie, membres) {
  const brute = normaliserConvocation(saisie);
  if (!brute) {
    const e = new Error('Convocation illisible.');
    e.code = 'illisible';
    throw e;
  }
  const parCompte = new Map(membres.map(m => [m.compte, m]));
  const tous = [...brute.membres, ...brute.proprietaires];
  if (tous.length + brute.exclus.length > 3 * MAX_LISTE) {
    const e = new Error('Trop de membres choisis.');
    e.code = 'trop';
    throw e;
  }
  const inconnus = tous.filter(c => !parCompte.has(c));
  if (inconnus.length > 0) {
    const e = new Error('Un membre choisi ne fait pas partie de la team.');
    e.code = 'inconnu';
    e.inconnus = inconnus;
    throw e;
  }
  const estProprio = c => groupeDe(parCompte.get(c)) === 'proprietaire';
  const sortie = {
    groupes: brute.groupes.includes('tous') ? ['tous'] : brute.groupes,
    membres: tous.filter(c => !estProprio(c)).sort(),
    exclus: brute.exclus.filter(c => parCompte.has(c) && !estProprio(c)).sort(),
    proprietaires: tous.filter(estProprio).sort(),
  };
  sortie.membres = [...new Set(sortie.membres)];
  sortie.proprietaires = [...new Set(sortie.proprietaires)];
  // Un exclu choisi nommément : le choix nominatif l'emporte.
  sortie.exclus = sortie.exclus.filter(c => !sortie.membres.includes(c));
  if (convocationVide(sortie)) return { ...CONVOCATION_DEFAUT, exclus: sortie.exclus };
  return sortie;
}

/** Ancienne saisie (`concernes` : liste de comptes ; vide = défaut). */
export function convocationDepuisListe(concernes) {
  const l = liste(concernes);
  return l.length === 0 ? { ...CONVOCATION_DEFAUT } : { groupes: [], membres: l, exclus: [], proprietaires: [] };
}
