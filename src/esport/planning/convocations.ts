/**
 * Convocations côté app : même règle que le serveur
 * (esport/noyau/planning/convocations.mjs), pour le sélecteur du formulaire.
 * Fonctions PURES (testées).
 *
 *  - Raccourcis : « Joueurs » (Joueur, Remplaçant), « Staff » (Coach,
 *    Analyste, Manager), « Tout le monde » (tous SAUF les Propriétaires) ;
 *  - choix personne par personne (un retrait d'un groupe = exclusion) ;
 *  - « Propriétaires à convoquer » : seuls les Propriétaires cochés.
 * Aucun choix : les joueurs.
 */

import type { Convocation, GroupeConvocation, MembreConvocable } from './api';
import { tr, trn } from '../i18n';

export const CONVOCATION_DEFAUT: Convocation = { groupes: ['joueurs'], membres: [], exclus: [], proprietaires: [] };

export const GROUPES: ReadonlyArray<{ cle: GroupeConvocation; nom: string; detail: string }> = [
  { cle: 'joueurs', get nom() {
      return tr('planning.convocations.joueurs');
    }, get detail() {
      return tr('planning.convocations.joueur_et_remplacant');
    } },
  { cle: 'staff', get nom() {
      return tr('resumes.staff');
    }, get detail() {
      return tr('planning.convocations.coach_analyste_manager');
    } },
  { cle: 'tous', get nom() {
      return tr('planning.convocations.tout_le_monde');
    }, get detail() {
      return tr('planning.convocations.tous_sauf_les_proprietaires');
    } },
];

const sans = (l: readonly string[], x: string) => l.filter(y => y !== x);
const avec = (l: readonly string[], x: string) => (l.includes(x) ? [...l] : [...l, x].sort());

export function estProprietaire(m: MembreConvocable): boolean {
  return m.groupe === 'proprietaire';
}

/** Le membre est-il convoqué par cette convocation (sans la règle d'arrivée, connue du seul serveur) ? */
export function estConvoque(c: Convocation, m: MembreConvocable): boolean {
  if (estProprietaire(m)) return c.proprietaires.includes(m.compte) || c.membres.includes(m.compte);
  if (c.exclus.includes(m.compte)) return false;
  if (c.membres.includes(m.compte)) return true;
  return c.groupes.includes('tous') || ((m.groupe === 'joueurs' || m.groupe === 'staff') && c.groupes.includes(m.groupe));
}

/** Le raccourci est-il actif ? (« Joueurs » l'est aussi sous « Tout le monde ».) */
export function groupeActif(c: Convocation, g: GroupeConvocation): boolean {
  return c.groupes.includes(g) || (g !== 'tous' && c.groupes.includes('tous'));
}

/** Active ou retire un raccourci. Retirer « Joueurs » sous « Tout le monde » garde le reste (le Staff). */
export function basculerGroupe(c: Convocation, g: GroupeConvocation): Convocation {
  if (g === 'tous') return { ...c, groupes: c.groupes.includes('tous') ? [] : ['tous'], exclus: c.groupes.includes('tous') ? c.exclus : [] };
  if (c.groupes.includes('tous')) return { ...c, groupes: g === 'joueurs' ? ['staff'] : ['joueurs'] };
  const groupes = c.groupes.includes(g) ? c.groupes.filter(x => x !== g) : [...c.groupes, g];
  return { ...c, groupes };
}

/** Coche ou décoche une personne (non Propriétaire) : choix nominatif, ou exclusion d'un groupe. */
export function basculerMembre(c: Convocation, m: MembreConvocable): Convocation {
  if (estProprietaire(m)) return basculerProprietaire(c, m.compte);
  if (estConvoque(c, m)) {
    if (c.membres.includes(m.compte)) {
      const suite = { ...c, membres: sans(c.membres, m.compte) };
      return estConvoque(suite, m) ? { ...suite, exclus: avec(suite.exclus, m.compte) } : suite;
    }
    return { ...c, exclus: avec(c.exclus, m.compte) };
  }
  const suite = { ...c, exclus: sans(c.exclus, m.compte) };
  return estConvoque(suite, m) ? suite : { ...suite, membres: avec(suite.membres, m.compte) };
}

export function basculerProprietaire(c: Convocation, compte: string): Convocation {
  const coche = c.proprietaires.includes(compte) || c.membres.includes(compte);
  return coche ? { ...c, proprietaires: sans(c.proprietaires, compte), membres: sans(c.membres, compte) } : { ...c, proprietaires: avec(c.proprietaires, compte) };
}

/** Personne de choisi : le serveur prendra les joueurs. */
export const convocationVide = (c: Convocation) => c.groupes.length === 0 && c.membres.length === 0 && c.proprietaires.length === 0;

/** Comptes convoqués parmi `membres` (aucun choix : les joueurs). */
export function convoquesParmi(c: Convocation, membres: readonly MembreConvocable[]): MembreConvocable[] {
  const effective = convocationVide(c) ? { ...CONVOCATION_DEFAUT, exclus: c.exclus } : c;
  return membres.filter(m => estConvoque(effective, m));
}

/** Résumé court : « Joueurs · 2 Propriétaires · 6 convoqués ». */
export function resumeConvocation(c: Convocation, membres: readonly MembreConvocable[]): string {
  const morceaux: string[] = [];
  const effective = convocationVide(c) ? CONVOCATION_DEFAUT : c;
  for (const g of GROUPES) if (effective.groupes.includes(g.cle)) morceaux.push(g.nom);
  if (effective.membres.length) morceaux.push(tr('planning.convocations.au_choix', { length: effective.membres.length }));
  if (effective.proprietaires.length) morceaux.push(trn('planning.convocations.proprietaires', effective.proprietaires.length));
  const n = convoquesParmi(c, membres).length;
  return tr('planning.convocations.resume', { liste: morceaux.join(' · ') || tr('planning.convocations.personne'), convoques: trn('planning.convocations.convoques', n) });
}

/** Deux convocations identiques (pour n'envoyer une liste propre à une date que si elle change) ? */
export function memeConvocation(a: Convocation | undefined | null, b: Convocation | undefined | null): boolean {
  const n = (c: Convocation | undefined | null) => (c ? JSON.stringify({ g: [...c.groupes].sort(), m: [...c.membres].sort(), e: [...c.exclus].sort(), p: [...c.proprietaires].sort() }) : '');
  return n(a) === n(b);
}
