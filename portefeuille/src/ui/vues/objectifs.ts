/**
 * Objectifs : où en est l'épargne, et comment placer le prochain versement.
 *
 * Deux calculs, tous deux sans vente : un PEA se gère mieux en orientant les
 * versements qu'en vendant (chaque vente sur un compte-titres est imposée).
 */

// ------------------------------------------------------------ Répartition

export interface LigneCible {
  titreId: string;
  nom: string;
  /** Valeur actuelle de la ligne, en euros. */
  valeur: number;
  /** Poids visé, en %. */
  cible: number;
  /** Dernier cours, pour dire combien de parts acheter. */
  cours?: number;
}

export interface AchatConseille {
  titreId: string;
  nom: string;
  montant: number;
  /** Parts entières que le montant permet d'acheter. */
  parts?: number;
  poidsAvant: number;
  poidsApres: number;
  cible: number;
}

/**
 * Répartit un versement pour rapprocher chaque ligne de sa cible, sans
 * rien vendre. Les lignes les plus en retard sont servies d'abord ; s'il
 * reste de l'argent une fois toutes les cibles rejointes, il suit les cibles.
 */
export function repartirVersement(lignes: readonly LigneCible[], versement: number): AchatConseille[] {
  const sommeCibles = lignes.reduce((total, ligne) => total + Math.max(0, ligne.cible), 0);
  if (sommeCibles <= 0 || versement <= 0) {
    return [];
  }
  const cibles = lignes.map(ligne => Math.max(0, ligne.cible) / sommeCibles);
  const totalAvant = lignes.reduce((total, ligne) => total + ligne.valeur, 0);
  const totalApres = totalAvant + versement;
  const manques = lignes.map((ligne, rang) => Math.max(0, cibles[rang] * totalApres - ligne.valeur));
  const sommeManques = manques.reduce((total, manque) => total + manque, 0);

  const montants =
    sommeManques >= versement
      ? manques.map(manque => (versement * manque) / sommeManques)
      : manques.map((manque, rang) => manque + (versement - sommeManques) * cibles[rang]);

  return lignes.map((ligne, rang) => {
    const montant = Math.round(montants[rang] * 100) / 100;
    return {
      titreId: ligne.titreId,
      nom: ligne.nom,
      montant,
      parts: ligne.cours && ligne.cours > 0 ? Math.floor(montant / ligne.cours) : undefined,
      poidsAvant: totalAvant > 0 ? (ligne.valeur / totalAvant) * 100 : 0,
      poidsApres: ((ligne.valeur + montant) / totalApres) * 100,
      cible: cibles[rang] * 100,
    };
  });
}

// ---------------------------------------------------------------- Objectif

export interface Objectif {
  /** Montant visé, en euros. */
  montant: number;
  /** Échéance, AAAA-MM-JJ. */
  date: string;
  /** Rendement annuel supposé, en %. */
  rendement: number;
}

export interface VueObjectif {
  progression: number;
  moisRestants: number;
  /** Ce que deviendrait la valeur actuelle, sans rien verser. */
  valeurSansVersement: number;
  /** Versement mensuel nécessaire ; 0 si les rendements suffisent. */
  versementMensuel: number;
  atteint: boolean;
  /** Trajectoire prévue, un point par mois, avec le versement nécessaire. */
  trajectoire: Array<{ date: string; valeur: number }>;
}

function moisEntre(debut: string, fin: string): number {
  const [a1, m1] = debut.split('-').map(Number);
  const [a2, m2] = fin.split('-').map(Number);
  return (a2 - a1) * 12 + (m2 - m1);
}

export function suivreObjectif(objectif: Objectif, valeurActuelle: number, aujourdhui: string): VueObjectif {
  const n = Math.max(0, moisEntre(aujourdhui, objectif.date));
  const r = Math.pow(1 + objectif.rendement / 100, 1 / 12) - 1;
  const croissance = Math.pow(1 + r, n);
  const valeurSansVersement = valeurActuelle * croissance;
  const manque = objectif.montant - valeurSansVersement;
  const versementMensuel =
    manque <= 0 ? 0 : n === 0 ? manque : r === 0 ? manque / n : (manque * r) / (croissance - 1);

  const trajectoire: Array<{ date: string; valeur: number }> = [];
  let valeur = valeurActuelle;
  const [annee, mois] = aujourdhui.split('-').map(Number);
  for (let rang = 0; rang <= n; rang++) {
    const date = new Date(Date.UTC(annee, mois - 1 + rang, 1)).toISOString().slice(0, 10);
    trajectoire.push({ date, valeur: Math.round(valeur) });
    valeur = valeur * (1 + r) + versementMensuel;
  }

  return {
    progression: objectif.montant > 0 ? Math.min(1, valeurActuelle / objectif.montant) : 0,
    moisRestants: n,
    valeurSansVersement,
    versementMensuel: Math.ceil(versementMensuel),
    atteint: valeurActuelle >= objectif.montant,
    trajectoire,
  };
}

/** Lit un objectif enregistré ; `undefined` s'il est absent ou illisible. */
export function objectifDepuisJson(brut: string | undefined): Objectif | undefined {
  try {
    const lu = JSON.parse(brut ?? '') as Partial<Objectif>;
    if (typeof lu.montant === 'number' && lu.montant > 0 && typeof lu.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(lu.date)) {
      return { montant: lu.montant, date: lu.date, rendement: typeof lu.rendement === 'number' ? lu.rendement : 5 };
    }
  } catch {
    // Illisible : pas d'objectif.
  }
  return undefined;
}
