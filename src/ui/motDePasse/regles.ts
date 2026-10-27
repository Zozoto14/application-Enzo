/**
 * Règles affichées pendant la saisie d'un nouveau mot de passe.
 *
 * Aucune règle n'est inventée ici : l'aide décrit EXACTEMENT ce que le code accepte.
 *  - profil `ami` (invitation, connexion par identifiant du Fondateur, mot de passe oublié) :
 *    `detaillerMotDePasse` (src/profils/invitation.ts), qui sert aussi de garde à
 *    `evaluerMotDePasse` ; forme canonique (espaces au bord ignorés), 10 caractères au moins
 *    (plus si le Fondateur l'a durci), pas seulement des chiffres, pas l'identifiant, pas un mot de
 *    passe courant ou répétitif, force minimale éventuelle ;
 *  - profil `coffre` (création du coffre, récupération par code, archive de sauvegarde) :
 *    12 caractères au moins, comptés tels que saisis ; rien d'autre n'est exigé.
 */

import { LONGUEUR_MIN_AMI, POLITIQUE_MDP_DEFAUT, detaillerMotDePasse, formeCanonique, type PolitiqueMdp } from '../../profils/invitation';
import { libelleForce, texte, type CleTexte, type LangueSaisie } from './textes';

export type ProfilMdp = 'ami' | 'coffre';

/** Longueur minimale du coffre (identique à `LONGUEUR_MINIMALE_MOT_DE_PASSE` de PremierLancement). */
export const LONGUEUR_MIN_COFFRE = 12;

export interface EntreeAnalyse {
  profil: ProfilMdp;
  valeur: string;
  confirmation?: string;
  /** Identifiant (ou prénom) que le mot de passe ne doit pas reprendre (profil `ami`). */
  identifiant?: string;
  politique?: PolitiqueMdp;
  /** Profil `coffre` : longueur minimale (12 par défaut). */
  longueurMin?: number;
  /** Faux : pas de seconde saisie, donc pas de règle « identiques ». */
  avecConfirmation?: boolean;
  langue: LangueSaisie;
}

export interface RegleAffichee {
  id: 'longueur' | 'chiffres' | 'identifiant' | 'courant' | 'force' | 'identiques';
  libelle: string;
  ok: boolean;
}

export interface AnalyseMotDePasse {
  longueur: number;
  longueurMin: number;
  /** Caractères qui manquent encore (0 si la longueur suffit). */
  manque: number;
  force: 0 | 1 | 2 | 3 | 4;
  libelleForce: string;
  /** Phrase de lecture : « Force : Solide ». */
  libelleForceComplet: string;
  /** Ce que ce niveau veut dire, et comment monter d'un cran. */
  explicationForce: string;
  regles: RegleAffichee[];
  /** Problèmes précis du premier champ, vides tant que rien n'est saisi. */
  problemes: string[];
  /** Problème de la confirmation (« les deux mots de passe ne correspondent pas »). */
  problemeConfirmation?: string;
  /** Toutes les règles sont respectées. */
  valide: boolean;
}

const bornesForce = (n: number): 0 | 1 | 2 | 3 | 4 => Math.max(0, Math.min(4, n)) as 0 | 1 | 2 | 3 | 4;

function astuce(langue: LangueSaisie, longueur: number, classes: number, force: number): string {
  if (force >= 4) return '';
  if (longueur < 12) return texte(langue, 'force.astuce.12');
  if (classes < 3) return texte(langue, 'force.astuce.classes');
  if (longueur < 16) return texte(langue, 'force.astuce.16');
  if (longueur < 20) return texte(langue, 'force.astuce.20');
  return texte(langue, 'force.astuce.classes');
}

export function analyserMotDePasse(entree: EntreeAnalyse): AnalyseMotDePasse {
  const { profil, valeur, langue } = entree;
  const confirmation = entree.confirmation ?? '';
  const avecConfirmation = entree.avecConfirmation ?? true;
  const politique = entree.politique ?? POLITIQUE_MDP_DEFAUT;
  const vide = valeur.length === 0;
  const regles: RegleAffichee[] = [];
  const problemes: string[] = [];
  let longueur: number;
  let longueurMin: number;
  let forceBrute: 1 | 2 | 3 | 4;
  let classes: number;
  let forceRefus = false;
  let force: 0 | 1 | 2 | 3 | 4 = 0;

  if (profil === 'ami') {
    const d = detaillerMotDePasse(valeur, entree.identifiant ?? '', politique);
    longueur = d.longueur;
    longueurMin = d.longueurMin;
    forceBrute = d.force;
    classes = d.classes;
    regles.push({ id: 'longueur', libelle: texte(langue, 'regle.longueur', { min: longueurMin }), ok: d.longueurOk });
    regles.push({ id: 'chiffres', libelle: texte(langue, 'regle.chiffres'), ok: !vide && !d.queChiffres });
    if (entree.identifiant !== undefined) regles.push({ id: 'identifiant', libelle: texte(langue, 'regle.identifiant'), ok: !vide && !d.prenom });
    regles.push({ id: 'courant', libelle: texte(langue, 'regle.courant'), ok: !vide && !d.courant && !d.repetitif });
    const autresRefus = d.queChiffres || d.prenom || d.courant || d.repetitif || !d.longueurOk;
    forceRefus = !autresRefus && forceBrute < politique.forceMin;
    if (politique.forceMin > 1) {
      regles.push({ id: 'force', libelle: texte(langue, 'regle.force', { force: libelleForce(langue, politique.forceMin) }), ok: !vide && !autresRefus && !forceRefus });
    }
    if (!vide) {
      if (!d.longueurOk) problemes.push(texte(langue, d.longueurMin - d.longueur === 1 ? 'erreur.manque.one' : 'erreur.manque.other', { n: d.longueurMin - d.longueur }));
      if (d.queChiffres) problemes.push(texte(langue, 'erreur.chiffres'));
      if (d.prenom) problemes.push(texte(langue, 'erreur.identifiant'));
      if (d.courant) problemes.push(texte(langue, 'erreur.courant'));
      if (d.repetitif) problemes.push(texte(langue, 'erreur.repetitif'));
      if (forceRefus) problemes.push(texte(langue, 'erreur.force', { force: libelleForce(langue, politique.forceMin) }));
    }
    force = bornesForce(autresRefus ? 0 : forceBrute);
  } else {
    longueurMin = entree.longueurMin ?? LONGUEUR_MIN_COFFRE;
    longueur = valeur.length;
    // Même barème de force que pour les amis, mais seule la longueur minimale est exigée.
    const d = detaillerMotDePasse(valeur, '', { longueurMin: LONGUEUR_MIN_AMI, forceMin: 1 });
    forceBrute = d.force;
    classes = d.classes;
    regles.push({ id: 'longueur', libelle: texte(langue, 'regle.longueur', { min: longueurMin }), ok: longueur >= longueurMin });
    if (!vide && longueur < longueurMin) {
      problemes.push(texte(langue, longueurMin - longueur === 1 ? 'erreur.manque.one' : 'erreur.manque.other', { n: longueurMin - longueur }));
    }
    force = bornesForce(vide || longueur < longueurMin ? 0 : forceBrute);
  }

  const memes = profil === 'ami' ? formeCanonique(confirmation) === formeCanonique(valeur) : confirmation === valeur;
  let problemeConfirmation: string | undefined;
  if (avecConfirmation) {
    regles.push({ id: 'identiques', libelle: texte(langue, 'regle.identiques'), ok: !vide && confirmation.length > 0 && memes });
    if (confirmation.length > 0 && !memes) problemeConfirmation = texte(langue, 'erreur.differents');
  }

  const libelle = libelleForce(langue, force);
  const explicationForce = vide ? '' : [texte(langue, `force.sens.${force}` as CleTexte), astuce(langue, longueur, classes, force)].filter(Boolean).join(' ');
  return {
    longueur,
    longueurMin,
    manque: Math.max(0, longueurMin - longueur),
    force,
    libelleForce: libelle,
    libelleForceComplet: vide ? texte(langue, 'force.vide') : texte(langue, 'force.libelle', { niveau: libelle }),
    explicationForce,
    regles,
    problemes,
    problemeConfirmation,
    valide: regles.every(r => r.ok),
  };
}

/** Les lignes de l'encadré d'aide : ce qui est accepté, adapté au profil. */
export function lignesAide(profil: ProfilMdp, langue: LangueSaisie, options: { longueurMin?: number; politique?: PolitiqueMdp } = {}): { accepte: string[]; conseil: string; rappel: string } {
  const politique = options.politique ?? POLITIQUE_MDP_DEFAUT;
  const min = profil === 'ami' ? Math.max(LONGUEUR_MIN_AMI, politique.longueurMin) : (options.longueurMin ?? LONGUEUR_MIN_COFFRE);
  const accepte = [texte(langue, 'aide.longueur', { min }), texte(langue, 'aide.caracteres'), texte(langue, 'aide.majuscules')];
  if (profil === 'ami') {
    accepte.push(texte(langue, 'aide.bords.ignores'), texte(langue, 'aide.courbes'), texte(langue, 'aide.refuses'));
    if (politique.forceMin > 1) accepte.push(texte(langue, 'aide.forceMin', { force: libelleForce(langue, politique.forceMin) }));
  } else {
    accepte.push(texte(langue, 'aide.bords.gardes'), texte(langue, 'aide.sansMax'));
  }
  return { accepte, conseil: texte(langue, 'aide.conseil'), rappel: texte(langue, 'aide.rappel') };
}

/** Majuscules verrouillées ? Lu sur un évènement clavier du web (absent ailleurs : `undefined`). */
export function capsActif(evenement: unknown): boolean | undefined {
  const e = evenement as { getModifierState?: (touche: string) => boolean; nativeEvent?: { getModifierState?: (touche: string) => boolean } } | null | undefined;
  const lire = e?.getModifierState ? e : e?.nativeEvent?.getModifierState ? e.nativeEvent : undefined;
  if (!lire?.getModifierState) return undefined;
  try {
    return Boolean(lire.getModifierState('CapsLock'));
  } catch {
    return undefined;
  }
}
