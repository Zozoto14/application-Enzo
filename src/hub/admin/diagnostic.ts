/**
 * Diagnostic des comptes dans l'Administration (docs/diagnostic-comptes.md) :
 *
 *  - nom affiché d'un compte dont le prénom manque (« (prénom inconnu) ») : pseudo Esport, puis
 *    adresse e-mail MASQUÉE, puis « Compte <début de l'identifiant> » ;
 *  - candidats à la réparation des prénoms (journal de l'Administration, pseudos Esport), toujours
 *    vérifiés contre l'empreinte du compte par l'annuaire (`reparerNomsAdmin`) ;
 *  - libellés des dernières tentatives de connexion relevées par le relais (codes d'issue), sans
 *    mot de passe ni adresse complète.
 */

import { NOM_INCONNU, type Profil } from '../../profils/profils';
import type { EvenementAudit } from './journal';

/** Adresse e-mail lisible sans être recopiable : « l•••a@g•••.com ». */
export function masquerEmail(email: string | undefined): string | undefined {
  const propre = (email ?? '').trim();
  const at = propre.lastIndexOf('@');
  if (at < 1 || at === propre.length - 1) return undefined;
  const local = propre.slice(0, at);
  const domaine = propre.slice(at + 1);
  const point = domaine.lastIndexOf('.');
  const nomDomaine = point > 0 ? domaine.slice(0, point) : domaine;
  const extension = point > 0 ? domaine.slice(point) : '';
  const masque = (t: string) => (t.length <= 2 ? `${t.slice(0, 1)}•••` : `${t.slice(0, 1)}•••${t.slice(-1)}`);
  return `${masque(local)}@${masque(nomDomaine)}${extension}`;
}

export type SourceNom = 'prenom' | 'pseudo-esport' | 'email' | 'identifiant';

export interface NomAffiche {
  nom: string;
  source: SourceNom;
  /** Initiale de l'avatar (« ? » faute de mieux : jamais la parenthèse du texte de remplacement). */
  initiale: string;
}

/** Ce qu'on affiche pour un compte, avec une solution de repli claire quand le prénom manque. */
export function nomAffiche(p: Pick<Profil, 'id' | 'nom' | 'nomInconnu'>, o: { pseudo?: string; email?: string } = {}): NomAffiche {
  const inconnu = p.nomInconnu === true || p.nom === NOM_INCONNU || !p.nom.trim();
  const initialeDe = (t: string) => {
    const lettre = [...t].find(c => /[\p{L}\p{N}]/u.test(c));
    return lettre ? lettre.toUpperCase() : '?';
  };
  if (!inconnu) return { nom: p.nom, source: 'prenom', initiale: initialeDe(p.nom) };
  if (o.pseudo?.trim()) return { nom: o.pseudo.trim(), source: 'pseudo-esport', initiale: initialeDe(o.pseudo) };
  const email = masquerEmail(o.email);
  if (email) return { nom: email, source: 'email', initiale: '?' };
  return { nom: `Compte ${p.id.slice(0, 6)}`, source: 'identifiant', initiale: '?' };
}

export const LIBELLES_SOURCE_NOM: Record<Exclude<SourceNom, 'prenom'>, string> = {
  'pseudo-esport': 'prénom à réparer, pseudo Esport',
  email: 'prénom à réparer, e-mail',
  identifiant: 'prénom à réparer',
};

/**
 * Candidats pour chaque compte sans prénom : prénoms notés au journal de l'Administration (les plus
 * récents d'abord), puis pseudo Esport. Ce ne sont que des candidats : l'annuaire ne retient que
 * celui dont l'empreinte est exactement celle du compte.
 */
export function candidatsNoms(ids: readonly string[], journal: readonly EvenementAudit[], pseudos: Readonly<Record<string, string>>): Record<string, string[]> {
  const sortie: Record<string, string[]> = {};
  const voulus = new Set(ids);
  for (const e of [...journal].sort((a, b) => (a.date < b.date ? 1 : -1))) {
    if (!e.cible || !voulus.has(e.cible) || !e.nomCible || e.nomCible === NOM_INCONNU) continue;
    (sortie[e.cible] ??= []).includes(e.nomCible) || sortie[e.cible].push(e.nomCible);
  }
  for (const id of ids) {
    const pseudo = pseudos[id];
    if (pseudo) (sortie[id] ??= []).includes(pseudo) || sortie[id].push(pseudo);
  }
  return sortie;
}

// --- Tentatives de connexion (relais) --------------------------------------------------

export type IssueConnexion =
  | 'succes'
  | 'succes-secours'
  | 'mauvais-mot-de-passe'
  | 'compte-introuvable'
  | 'verrouille'
  | 'adresse-limitee'
  | 'revoque'
  | 'a2f-requis'
  | 'a2f-code'
  | 'invitation-expiree'
  | 'invitation-utilisee'
  | 'invitation-revoquee'
  | 'invitation-inconnue'
  | 'invitation-ouverte'
  | 'jeton-refuse'
  | 'erreur-serveur'
  | 'debloque';

export const LIBELLES_ISSUE: Record<IssueConnexion, string> = {
  succes: 'Connexion réussie',
  'succes-secours': 'Connexion réussie (code de récupération)',
  'mauvais-mot-de-passe': 'Mauvais mot de passe',
  'compte-introuvable': 'Compte introuvable (identifiant mal saisi ou accès jamais créé)',
  verrouille: 'Verrouillé : trop d’essais sur cet identifiant',
  'adresse-limitee': 'Bloqué : trop d’échecs depuis cette connexion Internet (Wi-Fi partagé ?)',
  revoque: 'Accès révoqué',
  'a2f-requis': 'Code à six chiffres demandé',
  'a2f-code': 'Code à six chiffres faux',
  'invitation-expiree': 'Invitation expirée',
  'invitation-utilisee': 'Invitation déjà utilisée',
  'invitation-revoquee': 'Invitation remplacée ou annulée',
  'invitation-inconnue': 'Invitation introuvable',
  'invitation-ouverte': 'Invitation ouverte, mot de passe choisi',
  'jeton-refuse': 'Session expirée ou code d’accès refusé (Esport)',
  'erreur-serveur': 'Erreur du serveur',
  debloque: 'Débloqué par le Fondateur',
};

export const ISSUES_ECHEC: ReadonlySet<IssueConnexion> = new Set([
  'mauvais-mot-de-passe',
  'compte-introuvable',
  'verrouille',
  'adresse-limitee',
  'revoque',
  'a2f-code',
  'invitation-expiree',
  'invitation-utilisee',
  'invitation-revoquee',
  'invitation-inconnue',
  'jeton-refuse',
  'erreur-serveur',
]);

export function libelleIssue(issue: string): string {
  return (LIBELLES_ISSUE as Record<string, string>)[issue] ?? issue;
}

export interface TentativeConnexion {
  le: string;
  issue: string;
  ip: string;
}

export interface DiagnosticConnexion {
  tentatives: TentativeConnexion[];
  /** Verrou de l'identifiant (échecs comptés ; `jusqua` en ms, 0 si libre). */
  verrou: { echecs: number; jusqua: number } | null;
  /** Adresses limitées vues dans ses tentatives (masquées). */
  adresses: Array<{ ip: string; echecs: number; jusqua: number }>;
  /** Derniers identifiants inconnus essayés sur le serveur (tous comptes) : date et adresse masquée. */
  inconnus: Array<{ le: string; ip: string }>;
  revoque: boolean;
  heure: number;
}

/** Le compte est-il bloqué en ce moment (identifiant verrouillé ou adresse limitée) ? */
export function estBloque(d: DiagnosticConnexion | undefined): boolean {
  if (!d) return false;
  return Boolean((d.verrou && d.verrou.jusqua > d.heure) || d.adresses.some(a => a.jusqua > d.heure));
}

/** Résumé en une phrase de la dernière cause d'échec, ou undefined. */
export function causeProbable(d: DiagnosticConnexion | undefined): string | undefined {
  if (!d) return undefined;
  if (d.revoque) return 'Son accès est révoqué : rétablissez-le avant tout.';
  if (estBloque(d)) return 'Bloqué en ce moment (trop d’essais) : « Débloquer » le libère tout de suite.';
  const dernier = d.tentatives.find(t => t.issue !== 'debloque');
  if (!dernier || !ISSUES_ECHEC.has(dernier.issue as IssueConnexion)) return undefined;
  return `Dernier échec : ${libelleIssue(dernier.issue).toLowerCase()}.`;
}
