/**
 * Rôles staff SUPPLÉMENTAIRES d'un événement du club (docs/esport/evenements.md, « Rôles staff supplémentaires ») :
 * fonctions pures, sans base ni réseau (partagées par evenements-club/ et vocaux/).
 *
 * Colonne `club_evenements.staff_roles_sup` : JSON d'entrées `{ id, nom, label, couleur, supprimerFin, cree, membres }`
 * (l'ancien format, une liste d'identifiants, est relu avec `supprimerFin: false`) :
 *  - `cree` : rôle créé par l'événement (« Créer un rôle staff »), donné à `membres` (Discord ID) ;
 *  - `supprimerFin` : rôle supprimé de Discord à la fin ou à la suppression de l'événement (oui pour un rôle créé ; pour
 *    un rôle existant, oui par défaut après confirmation, désactivable) ;
 *  - `label` : libellé court du salon du staff (`{role}` du modèle « {role} — {pseudo} ») ; vide : dérivé du nom.
 * Jamais supprimés (choix refusé, revérifié avant la suppression) : @everyone, rôles gérés (intégrations, bots), rôles
 * avec Administrateur / Gérer le serveur / Gérer les rôles, rôles au niveau du bot ou au-dessus.
 */

/** Administrateur, Gérer le serveur, Gérer les rôles. */
export const PERMS_INTERDITES = (1n << 3n) | (1n << 5n) | (1n << 28n);
export const LIMITES_SUP = Object.freeze({ roles: 20, label: 40, membres: 50, nom: 100 });

const ID = /^\d{5,25}$/;

/** Entrées des rôles staff supplémentaires (JSON ou tableau), normalisées. */
export function lireSup(v) {
  let x = v;
  if (typeof v === 'string') {
    try {
      x = JSON.parse(v || '[]');
    } catch {
      x = [];
    }
  }
  if (!Array.isArray(x)) return [];
  const vus = new Set();
  const out = [];
  for (const e of x) {
    const o = typeof e === 'string' ? { id: e } : e && typeof e === 'object' ? e : null;
    if (!o || !ID.test(String(o.id)) || vus.has(String(o.id))) continue;
    vus.add(String(o.id));
    out.push({
      id: String(o.id),
      nom: typeof o.nom === 'string' ? o.nom.slice(0, LIMITES_SUP.nom) : '',
      label: typeof o.label === 'string' ? o.label.slice(0, LIMITES_SUP.label) : '',
      couleur: typeof o.couleur === 'string' && /^#[0-9a-f]{6}$/i.test(o.couleur) ? o.couleur.toLowerCase() : null,
      supprimerFin: o.supprimerFin === true,
      cree: o.cree === true,
      membres: Array.isArray(o.membres) ? [...new Set(o.membres.map(String).filter(m => /^\d{17,20}$/.test(m)))].slice(0, LIMITES_SUP.membres) : [],
    });
  }
  return out;
}

export const idsSup = v => lireSup(v).map(e => e.id);

/**
 * Libellé court d'un rôle pour le nom du salon du staff : nom du rôle sans le nom de l'événement, sans symboles
 * décoratifs ni emoji, espaces réduits (« ⟡ Casteur The Nuke End ⟡ » → « Casteur »). Vide : « Staff ».
 */
export function etiquetteRole(nomRole, nomEvenement = '') {
  let s = String(nomRole ?? '');
  const evt = String(nomEvenement ?? '').trim();
  if (evt) s = s.replace(new RegExp(evt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
  s = s
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s'’-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s'’-]+|[\s'’-]+$/g, '')
    .trim();
  return s.slice(0, LIMITES_SUP.label) || 'Staff';
}

/**
 * Peut-on supprimer ce rôle du serveur (`role` : { id, managed|gere, permissions, position }) ? Rend la raison du
 * refus (`everyone`, `gere`, `permissions`, `au-dessus-du-bot`) ou null.
 */
export function raisonInterdite(role, { guildId, positionBot }) {
  if (!role) return 'introuvable';
  if (String(role.id) === String(guildId)) return 'everyone';
  if (role.managed || role.gere) return 'gere';
  let p = 0n;
  try {
    p = BigInt(role.permissions ?? '0');
  } catch {
    p = 0n;
  }
  if (p & PERMS_INTERDITES) return 'permissions';
  if (positionBot !== null && positionBot !== undefined && Number(role.position ?? 0) >= Number(positionBot)) return 'au-dessus-du-bot';
  return null;
}

/**
 * Libellé `{role}` du salon du staff d'une personne, d'après le premier rôle qu'elle a dans cet ordre : rôles staff
 * supplémentaires (ordre de la liste), rôle staff de l'événement (« Staff »), rôles autorisés en plus du hub (ordre du
 * hub), rôles du staff des salons vocaux (ordre des réglages). `nomsRoles` : Map id → nom (cache de la Gateway).
 * Rend `{ label, roleId }` ou null si aucun de ces rôles.
 */
export function libelleStaff({ roles, sup = [], staffRoleId = null, hub = {}, rolesStaff = [], etiquettesStaff = {}, nomsRoles = new Map(), nomEvenement = '' }) {
  const a = new Set((roles ?? []).map(String));
  for (const e of sup) if (a.has(e.id)) return { roleId: e.id, label: e.label || etiquetteRole(e.nom || nomsRoles.get(e.id) || '', nomEvenement) };
  if (staffRoleId && a.has(String(staffRoleId))) return { roleId: String(staffRoleId), label: 'Staff' };
  for (const r of hub.rolesAutorises ?? []) if (a.has(r)) return { roleId: r, label: hub.etiquettes?.[r] || etiquetteRole(nomsRoles.get(r) || '', nomEvenement) };
  for (const r of rolesStaff ?? []) if (a.has(r)) return { roleId: r, label: etiquettesStaff?.[r] || etiquetteRole(nomsRoles.get(r) || '', nomEvenement) };
  return null;
}
