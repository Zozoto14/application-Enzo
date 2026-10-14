/**
 * Tâches V3 : partage avec PLUSIEURS membres (amis et gestionnaires du hub),
 * droits par projet et par personne, invitations, retrait d'accès.
 *
 *  - Les membres sont invités par le Fondateur (`reglages.membres`, par
 *    identifiant de compte). Chacun a sa clé de membre (32 octets) : elle
 *    scelle ce qu'il renvoie. L'ami unique des V1/V2 (`reglages.ami`) reste
 *    un membre comme les autres, avec son code historique « ami » (ses
 *    traces passées restent les siennes).
 *  - Droits par projet (`projet.acces[compte]`) : lecture, écriture, ou
 *    admin du projet (écriture + listes, statuts et paramètres du projet). Le
 *    partage et la suppression du projet restent au Fondateur.
 *  - Chaque projet partagé a sa clé de partage (`reglages.clesProjets`). Elle
 *    part seulement chez ses membres ; ce qu'un membre renvoie pour ce projet
 *    est scellé par elle. Retirer quelqu'un d'un projet (ou de Tâches) fait
 *    TOURNER la clé : la nouvelle ne part que chez ceux qui restent, l'ancienne
 *    n'ouvre plus rien de nouveau, et le dépôt de l'ancien membre est réécrit
 *    sans le projet (ou effacé) au tour suivant.
 *
 * Pur : horloge, auteur et aléa passés en paramètre.
 */

import {
  changerChamps,
  COULEURS,
  ErreurTaches,
  idMembreValide,
  vivant,
  type Auteur,
  type Contexte,
  type DonneesTaches,
  type DroitMembre,
  type MembreTaches,
  type ModePartage,
  type Projet,
} from './modele';

export type DroitOuAucun = DroitMembre | 'aucun';

export interface Membre {
  /** Identifiant du compte. */
  compte: string;
  /** Code d'auteur : « ami » pour l'ami des V1/V2, sinon l'identifiant. */
  code: Auteur;
  nom: string;
  cle?: string;
  depuis?: string;
  rang?: 'ami' | 'gestionnaire' | 'administrateur';
  /** Peut créer ses propres projets. */
  perso?: boolean;
  /** L'ami des V1/V2. */
  historique?: boolean;
}

const hex = (o: Uint8Array) => [...o].map(b => b.toString(16).padStart(2, '0')).join('');
export const nouvelleCle = (alea: (n: number) => Uint8Array): string => hex(alea(32));

/** Code d'auteur d'un compte membre. */
export const codeMembre = (d: DonneesTaches, compte: string): Auteur => (compte === d.reglages.ami ? 'ami' : compte);
/** Compte d'un code d'auteur (undefined pour le Fondateur). */
export const compteDeCode = (d: DonneesTaches, code: Auteur): string | undefined => (code === 'fondateur' ? undefined : code === 'ami' ? d.reglages.ami : code);

/** Tous les membres (l'ami des V1/V2 compris), dans l'ordre des prénoms. */
export function listeMembres(d: DonneesTaches): Membre[] {
  const r: Membre[] = [];
  const g = d.reglages;
  if (g.ami && g.cle) r.push({ compte: g.ami, code: 'ami', nom: g.amiNom ?? 'Ami', cle: g.cle, historique: true });
  for (const [compte, m] of Object.entries(g.membres ?? {})) {
    if (compte === g.ami) continue;
    r.push({ compte, code: compte, nom: m.nom, cle: m.cle, depuis: m.depuis, ...(m.rang ? { rang: m.rang } : {}), ...(m.perso ? { perso: true } : {}) });
  }
  return r.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

export const membreDe = (d: DonneesTaches, compte: string): Membre | undefined => listeMembres(d).find(m => m.compte === compte);

/** Droit d'un compte sur un projet (données du Fondateur). */
export function droitDe(d: DonneesTaches, projetId: string, compte: string): DroitOuAucun {
  const p = d.projets[projetId];
  if (!p || p.auto) return 'aucun';
  const estMembre = compte === d.reglages.ami ? Boolean(d.reglages.cle) : Boolean(d.reglages.membres?.[compte]);
  if (!estMembre) return 'aucun';
  const a = p.acces?.[compte];
  if (a) return a;
  // L'ami des V1/V2 : le mode de partage du projet.
  if (compte === d.reglages.ami && p.partage !== 'aucun') return p.partage;
  return 'aucun';
}

export const peutEcrire = (droit: DroitOuAucun): boolean => droit === 'ecriture' || droit === 'admin';
export const modeDuDroit = (droit: DroitOuAucun): ModePartage => (droit === 'aucun' ? 'aucun' : droit === 'lecture' ? 'lecture' : 'ecriture');

/** Membres qui voient ce projet (vivant ou à la corbeille), avec leur droit. */
export function membresDuProjet(d: DonneesTaches, projetId: string): Array<Membre & { droit: DroitMembre }> {
  return listeMembres(d)
    .map(m => ({ ...m, droit: droitDe(d, projetId, m.compte) }))
    .filter((m): m is Membre & { droit: DroitMembre } => m.droit !== 'aucun');
}

export const projetPartage = (d: DonneesTaches, p: Projet): boolean => !p.auto && membresDuProjet(d, p.id).length > 0;

/** Initiales d'un prénom (« Léa Martin » → « LM », « Hugo » → « H »). */
export function initiales(nom: string): string {
  const mots = nom.trim().split(/[\s'’-]+/).filter(Boolean);
  if (!mots.length) return '?';
  return (mots.length > 1 ? mots[0][0] + mots[mots.length - 1][0] : mots[0][0]).toUpperCase();
}

/** Couleur stable d'une personne (le Fondateur et l'ami gardent celles des V1/V2, données par le thème). */
export function couleurMembre(code: Auteur): string {
  let h = 0;
  for (const c of code) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COULEURS[h % COULEURS.length];
}

// ------------------------------------------------------------------ Invitations, droits, retrait

/** Invite un compte (ami ou gestionnaire du hub) : il reçoit sa clé de membre ; aucun projet n'est encore partagé. */
export function inviterMembre(d: DonneesTaches, compte: string, nom: string, ctx: Contexte & { aleaOctets: (n: number) => Uint8Array }, rang?: 'ami' | 'gestionnaire' | 'administrateur'): DonneesTaches {
  if (ctx.auteur !== 'fondateur') throw new ErreurTaches('Seul le Fondateur invite.');
  if (!idMembreValide(compte)) throw new ErreurTaches('Compte invalide.');
  if (compte === d.reglages.ami && d.reglages.cle) return d;
  const actuels = d.reglages.membres ?? {};
  if (actuels[compte]) return d;
  if (Object.keys(actuels).length >= 30) throw new ErreurTaches('30 membres au plus.');
  const m: MembreTaches = { nom: nom.trim().slice(0, 40) || 'Membre', cle: nouvelleCle(ctx.aleaOctets), depuis: new Date(ctx.maintenant).toISOString(), ...(rang ? { rang } : {}) };
  return { ...d, reglages: changerChamps(d.reglages, { membres: { ...actuels, [compte]: m } }, ctx) };
}

/** Nouvelle clé pour un projet (la précédente est gardée pour les envois en route de ceux qui restent). */
function tournerCle(d: DonneesTaches, projetId: string, ctx: Contexte & { aleaOctets: (n: number) => Uint8Array }): DonneesTaches {
  const cles = d.reglages.clesProjets ?? {};
  const actuelle = cles[projetId];
  if (!actuelle) return d;
  const suivante = { cle: nouvelleCle(ctx.aleaOctets), avant: actuelle.cle, le: new Date(ctx.maintenant).toISOString() };
  return { ...d, reglages: changerChamps(d.reglages, { clesProjets: { ...cles, [projetId]: suivante } }, ctx) };
}

/** Clé de chaque projet partagé (créée au premier partage). */
export function assurerClesProjets(d: DonneesTaches, ctx: Contexte & { aleaOctets: (n: number) => Uint8Array }): DonneesTaches {
  const cles = { ...(d.reglages.clesProjets ?? {}) };
  let change = false;
  for (const p of Object.values(d.projets)) {
    if (!vivant(p) || cles[p.id] || !projetPartage(d, p)) continue;
    cles[p.id] = { cle: nouvelleCle(ctx.aleaOctets), le: new Date(ctx.maintenant).toISOString() };
    change = true;
  }
  return change ? { ...d, reglages: changerChamps(d.reglages, { clesProjets: cles }, ctx) } : d;
}

/** Change le droit d'un membre sur un projet. Retirer ou réduire à rien fait tourner la clé du projet. */
export function changerDroit(d: DonneesTaches, projetId: string, compte: string, droit: DroitOuAucun, ctx: Contexte & { aleaOctets: (n: number) => Uint8Array }): DonneesTaches {
  if (ctx.auteur !== 'fondateur') throw new ErreurTaches('Seul le Fondateur gère le partage.');
  const p = d.projets[projetId];
  if (!vivant(p)) throw new ErreurTaches('Projet introuvable.');
  if (p.auto && droit !== 'aucun') throw new ErreurTaches('Ce projet est tenu par une autre app : il ne se partage pas.');
  if (!membreDe(d, compte)) throw new ErreurTaches('Invitez d’abord cette personne.');
  const avant = droitDe(d, projetId, compte);
  if (avant === droit) return d;
  const acces = { ...(p.acces ?? {}) };
  if (droit === 'aucun') delete acces[compte];
  else acces[compte] = droit;
  const champs: Record<string, unknown> = { acces: Object.keys(acces).length ? acces : undefined };
  // L'ami des V1/V2 : `partage` suit, pour les appareils plus anciens.
  if (compte === d.reglages.ami) champs.partage = modeDuDroit(droit);
  let x: DonneesTaches = { ...d, projets: { ...d.projets, [projetId]: changerChamps(p, champs, ctx) } };
  if (droit === 'aucun') x = tournerCle(x, projetId, ctx);
  return assurerClesProjets(x, ctx);
}

/**
 * Retire un membre de Tâches : plus aucun droit, clés des projets qu'il
 * voyait tournées, clé de membre oubliée. Son dépôt est effacé au tour
 * suivant (il ne voit plus rien) ; ses traces passées restent.
 */
export function retirerMembre(d: DonneesTaches, compte: string, ctx: Contexte & { aleaOctets: (n: number) => Uint8Array }): DonneesTaches {
  if (ctx.auteur !== 'fondateur') throw new ErreurTaches('Seul le Fondateur retire un membre.');
  if (!membreDe(d, compte)) return d;
  let x = d;
  for (const p of Object.values(d.projets)) {
    if (droitDe(x, p.id, compte) === 'aucun' && !p.acces?.[compte]) continue;
    const acces = { ...(p.acces ?? {}) };
    delete acces[compte];
    const champs: Record<string, unknown> = { acces: Object.keys(acces).length ? acces : undefined };
    if (compte === d.reglages.ami) champs.partage = 'aucun';
    x = { ...x, projets: { ...x.projets, [p.id]: changerChamps(x.projets[p.id], champs, ctx) } };
    x = tournerCle(x, p.id, ctx);
  }
  if (compte === x.reglages.ami) {
    x = { ...x, reglages: changerChamps(x.reglages, { ami: undefined, amiNom: undefined, cle: undefined }, ctx) };
  }
  const membres = { ...(x.reglages.membres ?? {}) };
  if (membres[compte]) {
    delete membres[compte];
    x = { ...x, reglages: changerChamps(x.reglages, { membres: Object.keys(membres).length ? membres : undefined }, ctx) };
  }
  const notifs = { ...(x.reglages.notifsMembres ?? {}) };
  if (notifs[compte]) {
    delete notifs[compte];
    x = { ...x, reglages: changerChamps(x.reglages, { notifsMembres: Object.keys(notifs).length ? notifs : undefined }, ctx) };
  }
  return x;
}

/** Noms affichés (Fondateur, ami des V1/V2, membres) pour le Fondateur. */
export function nomsMembres(d: DonneesTaches, nomFondateur: string): Record<Auteur, string> {
  const r: Record<Auteur, string> = { fondateur: nomFondateur, ami: d.reglages.amiNom ?? 'Ami' };
  for (const m of listeMembres(d)) r[m.code] = m.nom;
  return r;
}

/**
 * Personnes à qui une tâche de ce projet peut être assignée (ou qui peuvent
 * être mentionnées) : le Fondateur et les membres qui voient le projet.
 */
export function personnesDuProjet(d: DonneesTaches, projetId: string, noms: Record<Auteur, string>, cote: { role: 'fondateur' | 'ami'; moi: Auteur }): Array<{ code: Auteur; nom: string }> {
  const r: Array<{ code: Auteur; nom: string }> = [{ code: 'fondateur', nom: noms.fondateur ?? 'Fondateur' }];
  if (cote.role === 'fondateur') {
    for (const m of membresDuProjet(d, projetId)) r.push({ code: m.code, nom: m.nom });
  } else {
    // Chez un membre : ceux que le Fondateur a publiés pour ce projet (par code d'auteur), et soi-même.
    const codes = new Set<Auteur>([cote.moi, ...Object.keys(d.projets[projetId]?.acces ?? {})]);
    for (const c of codes) if (c !== 'fondateur') r.push({ code: c, nom: noms[c] ?? 'Membre' });
  }
  const vus = new Set<string>();
  return r.filter(x => (vus.has(x.code) ? false : (vus.add(x.code), true)));
}

/** Un profil du hub tel que le voit le Fondateur (annuaire). */
export interface ProfilAcces {
  id: string;
  nom: string;
  admin?: boolean;
  actif?: boolean;
  apps?: string[];
  role?: string;
}

/**
 * L'accès à l'app (`taches` dans les apps du profil, donné par l'Administration
 * ou par une invitation) et la liste des membres ne font qu'un : un profil qui
 * reçoit l'app devient membre (sans projet, il voit un état vide) ; un membre
 * dont l'accès est fermé (ou le compte désactivé, ou supprimé) est retiré —
 * droits enlevés, clés des projets tournées, dépôt effacé au tour suivant.
 */
export function accorderAcces(d: DonneesTaches, profils: readonly ProfilAcces[], ctx: Contexte & { aleaOctets: (n: number) => Uint8Array }): DonneesTaches {
  if (ctx.auteur !== 'fondateur' || !profils.length) return d;
  let x = d;
  const parId = new Map(profils.map(p => [p.id, p]));
  const autorise = (p: ProfilAcces | undefined) => Boolean(p && !p.admin && p.actif !== false && (p.apps ?? []).includes('taches') && idMembreValide(p.id));
  for (const p of profils) {
    if (!autorise(p) || membreDe(x, p.id)) continue;
    x = inviterMembre(x, p.id, p.nom, ctx, p.role === 'gestionnaire' || p.role === 'administrateur' ? p.role : 'ami');
  }
  for (const m of listeMembres(x)) if (!autorise(parId.get(m.compte))) x = retirerMembre(x, m.compte, ctx);
  return x;
}

/** Le membre peut-il créer ses propres projets (rangés dans SA base chiffrée, que lui seul ouvre) ? */
export function changerPerso(d: DonneesTaches, compte: string, permis: boolean, ctx: Contexte): DonneesTaches {
  if (ctx.auteur !== 'fondateur') throw new ErreurTaches('Seul le Fondateur règle ce droit.');
  const m = d.reglages.membres?.[compte];
  if (!m) throw new ErreurTaches('Invitez d’abord cette personne.');
  if (Boolean(m.perso) === permis) return d;
  const suivant: MembreTaches = { ...m };
  if (permis) suivant.perso = true;
  else delete suivant.perso;
  return { ...d, reglages: changerChamps(d.reglages, { membres: { ...d.reglages.membres, [compte]: suivant } }, ctx) };
}
