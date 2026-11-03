/**
 * Section CM : accès RESTREINT à un tableau (migration 0046, docs/esport/cm.md, « Accès au tableau »).
 *
 * Un tableau est visible de « tous ceux qui ont accès au CM » de sa portée (`acces = 'tous'`, défaut et valeur de
 * tous les tableaux existants), ou RESTREINT (`acces = 'restreint'`) : seulement les personnes et les rôles choisis
 * (`cm_tableau_acces`), chacun avec un niveau :
 *  - 'voir'     : lecture seule (le tableau, ses cartes, commentaires et pièces ; aucune écriture, pas même un
 *                 commentaire ni une validation) ;
 *  - 'modifier' : les permissions CM habituelles du compte sur la portée (cm.editer, cm.valider…).
 * Le Fondateur (CEO, super admin) voit et modifie toujours tout. L'accès au tableau ne DONNE jamais rien : il
 * s'ajoute aux contrôles de la portée (cm.voir d'abord, puis les permissions), il ne fait que retirer.
 *
 * Un rôle compte pour qui l'a AUJOURD'HUI (relu à chaque requête : un retrait vaut tout de suite) :
 *  - rôle CM : affectation « club », ou affectation de la team du tableau (membre actif de cette team) ;
 *  - rôle du club : `roles_globaux_affectations` ;
 *  - rôle de team : membre ACTIF de la team avec ce rôle.
 *
 * Module sans état : chaque appel relit la base.
 */

import { lignesParIds } from '../requetes.mjs';

export const ACCES_TABLEAU = Object.freeze(['tous', 'restreint']);
export const GENRES_ACCES = Object.freeze(['compte', 'role_cm', 'role_club', 'role_team']);
export const NIVEAUX_ACCES = Object.freeze(['voir', 'modifier']);
export const MAX_REGLES_ACCES = 100;
const RANG = { voir: 1, modifier: 2 };
const FONDATEUR = 'principal';

export const estRestreint = tb => tb?.acces === 'restreint';

/**
 * Niveau de chaque compte qui a accès à un tableau RESTREINT : `Map<compte, 'voir' | 'modifier'>` (le Fondateur
 * n'y figure pas : il a tout, d'office). `regles` : celles à évaluer (par défaut, celles enregistrées) — sert aussi
 * à vérifier une modification AVANT de l'enregistrer (garde-fou).
 */
export async function niveauxTableau(base, tb, regles = null) {
  const lignes = regles ?? (await base.tous('SELECT genre, cible, niveau FROM cm_tableau_acces WHERE tableau_id = ?', [tb.id]));
  const sortie = new Map();
  const ajouter = (compte, niveau) => {
    if (!compte || !RANG[niveau]) return;
    if ((RANG[sortie.get(compte)] ?? 0) < RANG[niveau]) sortie.set(compte, niveau);
  };
  const parGenre = genre => {
    const m = new Map();
    for (const r of lignes) if (r.genre === genre) m.set(r.cible, (RANG[m.get(r.cible)] ?? 0) < RANG[r.niveau] ? r.niveau : m.get(r.cible));
    return m;
  };
  for (const [compte, niveau] of parGenre('compte')) ajouter(compte, niveau);
  const rolesCm = parGenre('role_cm');
  if (rolesCm.size) {
    const portees = tb.team_id ? ['club', tb.team_id] : ['club'];
    const aff = await lignesParIds(base, `SELECT a.compte_id, a.role_id, a.portee FROM cm_affectations a WHERE a.portee IN (${portees.map(() => '?').join(', ')}) AND a.role_id`, [...rolesCm.keys()], { paramsAvant: portees });
    const actifs = tb.team_id ? new Set((await base.tous("SELECT compte_id FROM membres WHERE team_id = ? AND statut = 'actif'", [tb.team_id])).map(l => l.compte_id)) : new Set();
    for (const a of aff) if (a.portee === 'club' || actifs.has(a.compte_id)) ajouter(a.compte_id, rolesCm.get(a.role_id));
  }
  const rolesClub = parGenre('role_club');
  if (rolesClub.size) for (const a of await lignesParIds(base, 'SELECT compte_id, role_id FROM roles_globaux_affectations WHERE role_id', [...rolesClub.keys()])) ajouter(a.compte_id, rolesClub.get(a.role_id));
  const rolesTeam = parGenre('role_team');
  if (rolesTeam.size) for (const m of await lignesParIds(base, "SELECT compte_id, role_id FROM membres WHERE statut = 'actif' AND role_id", [...rolesTeam.keys()])) ajouter(m.compte_id, rolesTeam.get(m.role_id));
  sortie.delete(FONDATEUR);
  return sortie;
}

/**
 * Niveau d'accès d'un acteur à un tableau : 'modifier', 'voir', ou null (il ne le voit pas). Un tableau ouvert à
 * tous rend 'modifier' (les permissions de la portée s'appliquent seules) ; le Fondateur, toujours 'modifier'.
 */
export async function niveauTableau(base, acteur, tb) {
  if (!estRestreint(tb) || acteur?.superAdmin || acteur?.compte === FONDATEUR) return 'modifier';
  if (!acteur?.compte) return null;
  return (await niveauxTableau(base, tb)).get(acteur.compte) ?? null;
}

/**
 * Lecteur de plusieurs tableaux (listes, recherche, calendrier, notifications…) : mémorise les niveaux calculés.
 * `niveau(tb)` (ligne de `cm_tableaux`, avec `acces`) ; `interdits()` : identifiants des tableaux restreints que
 * l'acteur ne voit pas (supprimés compris).
 */
export function lecteurTableaux(base, acteur) {
  const cache = new Map();
  const fondateur = Boolean(acteur?.superAdmin) || acteur?.compte === FONDATEUR;
  async function niveau(tb) {
    if (!estRestreint(tb) || fondateur) return 'modifier';
    if (!cache.has(tb.id)) cache.set(tb.id, niveauTableau(base, acteur, tb));
    return cache.get(tb.id);
  }
  let interditsP;
  function interdits() {
    if (fondateur) return Promise.resolve([]);
    interditsP ??= (async () => {
      const sortie = [];
      for (const tb of await base.tous("SELECT id, portee, team_id, acces FROM cm_tableaux WHERE acces = 'restreint'", [])) if (!(await niveau(tb))) sortie.push(tb.id);
      return sortie;
    })();
    return interditsP;
  }
  /** Garde les tableaux visibles (avec `niveau`) parmi des lignes de `cm_tableaux`. */
  async function filtrer(lignes) {
    const sortie = [];
    for (const tb of lignes) {
      const n = await niveau(tb);
      if (n) sortie.push({ ...tb, niveau: n });
    }
    return sortie;
  }
  return { niveau, interdits, filtrer };
}

/** Permissions effectives sur un tableau : 'voir' ne garde que la lecture. */
export function permissionsAuNiveau(permissions, niveau) {
  if (niveau === 'modifier') return permissions;
  return new Set([...permissions].filter(p => p === 'cm.voir'));
}

/**
 * Condition SQL « hors des tableaux interdits » sur des lignes qui désignent une entité (`entite_type`,
 * `entite_id` : journal, fil des notifications) : le tableau, ses cartes et les visuels générés depuis ses cartes.
 * `{ sql, params }` ; toujours vraie si rien n'est interdit.
 */
export function horsTableauxInterdits(alias, interdits) {
  if (!interdits.length) return { sql: '1 = 1', params: [] };
  const m = interdits.map(() => '?').join(', ');
  const a = alias ? `${alias}.` : '';
  // COALESCE : une ligne sans entité (NULL) doit rester visible (NOT NULL serait faux).
  const t = `COALESCE(${a}entite_type, '')`;
  const i = `COALESCE(${a}entite_id, '')`;
  return {
    sql: `NOT ((${t} = 'cm_tableau' AND ${i} IN (${m})) OR (${t} = 'cm_carte' AND ${i} IN (SELECT ki.id FROM cm_cartes ki WHERE ki.tableau_id IN (${m}))) OR (${t} = 'cm_visuel' AND ${i} IN (SELECT vi.id FROM cm_visuels vi JOIN cm_cartes kv ON kv.id = vi.carte_id WHERE kv.tableau_id IN (${m}))))`,
    params: [...interdits, ...interdits, ...interdits],
  };
}
