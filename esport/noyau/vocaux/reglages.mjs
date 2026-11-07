/**
 * Salons vocaux temporaires (docs/esport/vocaux.md) : réglages, lus et validés ici. Fonctions sur la base, sans réseau.
 *
 * Rangés dans `tickets_reglages` (comme la bienvenue par rôle) :
 *  - `vocaux` : activation, hubs (chacun : salon vocal « hub », catégorie des salons créés, modèle du nom, limite de
 *    places et verrouillage par défaut ; hub de tournoi : tournoi lié et rôles autorisés en plus), rôles du staff
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
  };
}

export async function lireVocaux(base) {
  const v = await lire(base, 'vocaux');
  const s = { ...VOCAUX_DEFAUT, ...v };
  s.hubs = (Array.isArray(s.hubs) ? s.hubs : []).filter(h => h && ID.test(String(h.id))).map(hubPropre);
  s.rolesStaff = Array.isArray(s.rolesStaff) ? s.rolesStaff.filter(x => ID.test(String(x))) : [];
  if (!MODES_PROPRIETAIRE.includes(s.quandProprietairePart)) s.quandProprietairePart = 'transferer';
  return s;
}

export async function lireCommandesVocaux(base) {
  const v = await lire(base, 'vocaux_commandes');
  return Object.fromEntries(COMMANDES_VOCAUX.map(c => [c, { actif: v[c]?.actif !== false, roles: Array.isArray(v[c]?.roles) ? v[c].roles.filter(x => ID.test(String(x))) : [] }]));
}

const MOTIF_TOURNOI = /^[0-9a-f-]{36}$/;

function validerHub(h, i) {
  if (!h || typeof h !== 'object') throw echec(400, 'vocaux-hub', 'Hub illisible.');
  const id = idOuNull(h.id, 'vocaux-hub');
  if (!id) throw echec(400, 'vocaux-hub', 'Choisissez le salon vocal de chaque hub.');
  const modele = typeof h.modeleNom === 'string' ? h.modeleNom.replace(/\s+/g, ' ').trim() : '';
  if (modele.length > LIMITES_VOCAUX.modele) throw echec(400, 'vocaux-modele', 'Modèle du nom : 90 caractères au plus.');
  let tournoiId = null;
  if (h.tournoiId !== undefined && h.tournoiId !== null && h.tournoiId !== '') {
    if (typeof h.tournoiId !== 'string' || !MOTIF_TOURNOI.test(h.tournoiId)) throw echec(400, 'vocaux-tournoi', 'Tournoi introuvable.');
    tournoiId = h.tournoiId;
  }
  return hubPropre({
    id,
    nom: typeof h.nom === 'string' ? h.nom.trim().slice(0, 100) : '',
    categorieId: idOuNull(h.categorieId, `vocaux-hub-${i + 1}-categorie`),
    modeleNom: modele,
    limite: entier(h.limite, 0, LIMITES_VOCAUX.places, 'vocaux-limite', 0),
    // Un hub de tournoi crée toujours des salons verrouillés sur le rôle de l'équipe.
    verrouille: tournoiId ? true : h.verrouille === true,
    tournoiId,
    rolesAutorises: ids(h.rolesAutorises, LIMITES_VOCAUX.roles, 'vocaux-roles'),
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

/** Nom d'un salon créé : modèle et variables ({pseudo} ; {tag}, {nom} pour un salon d'équipe), 100 caractères au plus. */
export function nomSalon(modele, vars) {
  const v = { pseudo: '', tag: '', nom: '', ...vars };
  const brut = String(modele || MODELE_DEFAUT).replace(/\{(pseudo|tag|nom)\}/g, (_, k) => String(v[k] ?? ''));
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
