/**
 * Salons vocaux temporaires (docs/esport/vocaux.md) : réglages, lus et validés ici. Fonctions sur la base, sans réseau.
 *
 * Rangés dans `tickets_reglages` (comme la bienvenue par rôle) :
 *  - `vocaux` : activation, hubs (chacun : salon vocal « hub », catégorie des salons créés, modèle du nom, limite de
 *    places et verrouillage par défaut ; hub d'événement : `tournoiId` = événement du club lié (Administration ›
 *    Événements) et rôles autorisés en plus), rôles du staff
 *    (contournent le verrouillage, utilisent les contrôles), délai de suppression d'un salon vide, salons par membre,
 *    ce qui se passe quand le propriétaire part, salon des journaux ;
 *  - `vocaux_commandes` : chaque sous-commande de /voc activée ou non, et ses rôles Discord autorisés.
 * Le serveur Discord est celui des tickets (Tickets › Configuration › Général).
 */

import { echec, jsonOu } from '../outils.mjs';

/** Sous-commandes de /voc. */
export const COMMANDES_VOCAUX = Object.freeze(['renommer', 'verrouiller', 'deverrouiller', 'expulser', 'ami-ajouter', 'ami-retirer', 'limite', 'proprietaire']);
/** Quand le propriétaire quitte son salon : la propriété passe à une personne restée, ou il la garde (il peut revenir). */
export const MODES_PROPRIETAIRE = Object.freeze(['transferer', 'garder']);
export const LIMITES_VOCAUX = Object.freeze({ hubs: 10, roles: 20, amis: 25, places: 99, delaiMinS: 5, delaiMaxS: 300, parMembreMax: 5, modele: 90 });
export const MODELE_DEFAUT = 'Salon de {pseudo}';
export const MODELE_TOURNOI_DEFAUT = '{tag} — {nom}';
/** Salon du staff dans un hub d'événement. */
export const MODELE_STAFF_DEFAUT = '{role} — {pseudo}';
/** Ancien modèle par défaut (avant {role}) : relu comme le nouveau. */
const MODELE_STAFF_ANCIEN = 'Staff — {pseudo}';
const LIBELLE_MAX = 40;

/** Libellés courts de rôles { roleId: libellé } (salon du staff : `{role}`). */
function etiquettes(v, valider = false) {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) {
    if (valider) throw echec(400, 'vocaux-etiquettes', 'Libellés des rôles illisibles.');
    return {};
  }
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (!ID.test(k) || typeof x !== 'string') {
      if (valider) throw echec(400, 'vocaux-etiquettes', 'Libellés des rôles illisibles.');
      continue;
    }
    const s = x.replace(/\s+/g, ' ').trim();
    if (s.length > LIBELLE_MAX) {
      if (valider) throw echec(400, 'vocaux-etiquettes', 'Libellé d’un rôle : 40 caractères au plus.');
      continue;
    }
    if (s) out[k] = s;
  }
  return out;
}

export const VOCAUX_DEFAUT = Object.freeze({
  actif: false,
  hubs: [],
  rolesStaff: [],
  delaiSuppressionS: 15,
  maxParMembre: 1,
  quandProprietairePart: 'transferer',
  salonJournaux: null,
});

const ID = /^\d{5,25}$/;
const idOuNull = (v, quoi) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !ID.test(v)) throw echec(400, quoi, 'Identifiant Discord invalide (chiffres seulement).');
  return v;
};
const ids = (v, max, quoi) => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > max || v.some(x => typeof x !== 'string' || !ID.test(x))) throw echec(400, quoi, `Liste d’identifiants Discord invalide (${max} au plus).`);
  return [...new Set(v)];
};
const entier = (v, min, max, quoi, defaut) => {
  if (v === undefined || v === null || v === '') return defaut;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw echec(400, quoi, `Valeur hors limites (${min} à ${max}).`);
  return n;
};

async function lire(base, cle) {
  const l = await base.premier('SELECT valeur FROM tickets_reglages WHERE cle = ?', [cle]);
  const v = jsonOu(l?.valeur, null);
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

/** Un hub tel qu'il est gardé (champs manquants : valeurs par défaut). */
export function hubPropre(h) {
  return {
    id: h.id,
    nom: typeof h.nom === 'string' ? h.nom : '',
    categorieId: h.categorieId ?? null,
    modeleNom: typeof h.modeleNom === 'string' && h.modeleNom.trim() ? h.modeleNom : h.tournoiId ? MODELE_TOURNOI_DEFAUT : MODELE_DEFAUT,
    limite: Number.isInteger(h.limite) ? h.limite : 0,
    verrouille: h.verrouille === true,
    tournoiId: h.tournoiId ?? null,
    rolesAutorises: Array.isArray(h.rolesAutorises) ? h.rolesAutorises.filter(x => ID.test(String(x))) : [],
    // Placer chaque salon créé juste sous le hub (PATCH des positions après le déplacement) : oui par défaut.
    placerSousHub: h.placerSousHub !== false,
    // Salon verrouillé : visible mais pas joignable pour les personnes sans accès (sinon caché) : non par défaut.
    visibleNonJoignable: h.visibleNonJoignable === true,
    // Hub caché aux personnes sans accès (surcharges du salon du hub gérées par le bot) : oui par défaut pour un hub
    // d'événement, non pour un hub ordinaire (qui demande alors des « rôles qui peuvent utiliser ce hub »).
    masquerHub: typeof h.masquerHub === 'boolean' ? h.masquerHub : Boolean(h.tournoiId),
    rolesHub: Array.isArray(h.rolesHub) ? h.rolesHub.filter(x => ID.test(String(x))) : [],
    modeleStaff: typeof h.modeleStaff === 'string' && h.modeleStaff.trim() && h.modeleStaff !== MODELE_STAFF_ANCIEN ? h.modeleStaff : MODELE_STAFF_DEFAUT,
    // Libellés courts des rôles autorisés en plus (salon du staff : `{role}`) ; absent : dérivé du nom du rôle.
    etiquettes: etiquettes(h.etiquettes),
  };
}

/** Le hub est-il caché par le bot ? Hub d'événement : selon l'option ; hub ordinaire : l'option ET des rôles choisis. */
export const hubMasque = h => Boolean(h?.masquerHub) && (Boolean(h.tournoiId) || (h.rolesHub ?? []).length > 0);

export async function lireVocaux(base) {
  const v = await lire(base, 'vocaux');
  const s = { ...VOCAUX_DEFAUT, ...v };
  s.hubs = (Array.isArray(s.hubs) ? s.hubs : []).filter(h => h && ID.test(String(h.id))).map(hubPropre);
  s.rolesStaff = Array.isArray(s.rolesStaff) ? s.rolesStaff.filter(x => ID.test(String(x))) : [];
  s.etiquettesStaff = etiquettes(s.etiquettesStaff);
  if (!MODES_PROPRIETAIRE.includes(s.quandProprietairePart)) s.quandProprietairePart = 'transferer';
  return s;
}

export async function lireCommandesVocaux(base) {
  const v = await lire(base, 'vocaux_commandes');
  return Object.fromEntries(COMMANDES_VOCAUX.map(c => [c, { actif: v[c]?.actif !== false, roles: Array.isArray(v[c]?.roles) ? v[c].roles.filter(x => ID.test(String(x))) : [] }]));
}

const MOTIF_TOURNOI = /^[0-9a-f-]{36}$/;

function modeleStaff(v) {
  const m = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  if (m.length > LIMITES_VOCAUX.modele) throw echec(400, 'vocaux-modele', 'Modèle du nom : 90 caractères au plus.');
  return m;
}

function validerHub(h, i) {
  if (!h || typeof h !== 'object') throw echec(400, 'vocaux-hub', 'Hub illisible.');
  const id = idOuNull(h.id, 'vocaux-hub');
  if (!id) throw echec(400, 'vocaux-hub', 'Choisissez le salon vocal de chaque hub.');
  const modele = typeof h.modeleNom === 'string' ? h.modeleNom.replace(/\s+/g, ' ').trim() : '';
  if (modele.length > LIMITES_VOCAUX.modele) throw echec(400, 'vocaux-modele', 'Modèle du nom : 90 caractères au plus.');
  let tournoiId = null;
  if (h.tournoiId !== undefined && h.tournoiId !== null && h.tournoiId !== '') {
    if (typeof h.tournoiId !== 'string' || !MOTIF_TOURNOI.test(h.tournoiId)) throw echec(400, 'vocaux-tournoi', 'Événement introuvable (Administration › Événements).');
    tournoiId = h.tournoiId;
  }
  return hubPropre({
    id,
    nom: typeof h.nom === 'string' ? h.nom.trim().slice(0, 100) : '',
    categorieId: idOuNull(h.categorieId, `vocaux-hub-${i + 1}-categorie`),
    modeleNom: modele,
    limite: entier(h.limite, 0, LIMITES_VOCAUX.places, 'vocaux-limite', 0),
    // Un hub d'événement crée toujours des salons verrouillés sur le rôle de l'équipe.
    verrouille: tournoiId ? true : h.verrouille === true,
    tournoiId,
    rolesAutorises: ids(h.rolesAutorises, LIMITES_VOCAUX.roles, 'vocaux-roles'),
    placerSousHub: h.placerSousHub !== false,
    visibleNonJoignable: h.visibleNonJoignable === true,
    masquerHub: typeof h.masquerHub === 'boolean' ? h.masquerHub : Boolean(tournoiId),
    rolesHub: tournoiId ? [] : ids(h.rolesHub, LIMITES_VOCAUX.roles, 'vocaux-roles-hub'),
    modeleStaff: modeleStaff(h.modeleStaff),
    etiquettes: etiquettes(h.etiquettes, true),
  });
}

/** Valide les réglages (fusion avec l'existant : seuls les champs fournis changent). */
export function validerVocaux(c, actuel) {
  const s = { ...actuel };
  if (!c || typeof c !== 'object') throw echec(400, 'vocaux', 'Réglages illisibles.');
  if (c.actif !== undefined) s.actif = c.actif === true;
  if (c.hubs !== undefined) {
    if (!Array.isArray(c.hubs) || c.hubs.length > LIMITES_VOCAUX.hubs) throw echec(400, 'vocaux-hub', '10 hubs au plus.');
    s.hubs = c.hubs.map(validerHub);
    if (new Set(s.hubs.map(h => h.id)).size !== s.hubs.length) throw echec(400, 'vocaux-hub', 'Le même salon est choisi pour deux hubs.');
  }
  if (c.rolesStaff !== undefined) s.rolesStaff = ids(c.rolesStaff, LIMITES_VOCAUX.roles, 'vocaux-staff');
  // Libellés courts des rôles du staff (salon du staff d'un hub d'événement : `{role}`).
  if (c.etiquettesStaff !== undefined) s.etiquettesStaff = etiquettes(c.etiquettesStaff, true);
  s.delaiSuppressionS = entier(c.delaiSuppressionS, LIMITES_VOCAUX.delaiMinS, LIMITES_VOCAUX.delaiMaxS, 'vocaux-delai', s.delaiSuppressionS);
  s.maxParMembre = entier(c.maxParMembre, 1, LIMITES_VOCAUX.parMembreMax, 'vocaux-par-membre', s.maxParMembre);
  if (c.quandProprietairePart !== undefined) {
    if (!MODES_PROPRIETAIRE.includes(c.quandProprietairePart)) throw echec(400, 'vocaux-proprietaire', 'Choix inconnu pour le départ du propriétaire.');
    s.quandProprietairePart = c.quandProprietairePart;
  }
  if (c.salonJournaux !== undefined) s.salonJournaux = idOuNull(c.salonJournaux, 'vocaux-journaux');
  if (s.actif && !s.hubs.length) throw echec(400, 'vocaux-hub', 'Ajoutez au moins un hub avant d’activer les salons vocaux.');
  return s;
}

export function validerCommandesVocaux(c) {
  const s = {};
  for (const nom of COMMANDES_VOCAUX) {
    const v = c?.[nom];
    if (!v) continue;
    s[nom] = { actif: v.actif !== false, roles: ids(v.roles, LIMITES_VOCAUX.roles, `commande-${nom}`) };
  }
  return s;
}

/**
 * Nom d'un salon créé : modèle et variables ({pseudo} ; {tag}, {nom} pour un salon d'équipe ; {role} pour le salon du
 * staff d'un hub d'événement), 100 caractères au plus.
 */
export function nomSalon(modele, vars) {
  const v = { pseudo: '', tag: '', nom: '', role: '', ...vars };
  const brut = String(modele || MODELE_DEFAUT).replace(/\{(pseudo|tag|nom|role)\}/g, (_, k) => String(v[k] ?? ''));
  return nettoyerNom(brut) || nettoyerNom(MODELE_DEFAUT.replace('{pseudo}', v.pseudo)) || 'Salon';
}

/** Nom de salon sûr : sans caractères de contrôle ni mentions, espaces réduits, 100 caractères au plus. */
export function nettoyerNom(v) {
  return String(v ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/@(everyone|here)/gi, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}
