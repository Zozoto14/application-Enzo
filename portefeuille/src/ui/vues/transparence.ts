/**
 * Transparence : ce que vous détenez vraiment, ETF décomposés.
 *
 * Un ETF MSCI World, c'est environ 1 400 entreprises, dont trois quarts
 * américaines. Ajouté à vos actions en direct, cela donne votre exposition
 * réelle, par entreprise, pays et secteur. Les compositions sont des ordres
 * de grandeur (2025) : elles bougent avec les cours, et chaque ETF réplique
 * son indice à sa façon. Assez pour voir une concentration, pas pour
 * trancher au dixième près.
 *
 * S'y ajoutent les frais courants des ETF, en euros par an et sur vingt ans.
 */

import { indiceDeLigne, type CleIndice } from '../../podcast/impacts';

type Poids = Record<string, number>;

interface Composition {
  nom: string;
  entreprises: Poids;
  pays: Poids;
  secteurs: Poids;
  /** Frais courants typiques d'un ETF sur cet indice, en %/an. */
  fraisTypiques: number;
}

const COMPOSITIONS: Record<CleIndice, Composition> = {
  'msci-world': {
    nom: 'MSCI World',
    entreprises: { Nvidia: 5, Apple: 4.5, Microsoft: 4.5, Amazon: 2.8, Alphabet: 2.6, Meta: 2, Broadcom: 1.6, Tesla: 1.3, JPMorgan: 1, 'Eli Lilly': 0.8 },
    pays: { 'États-Unis': 72, Japon: 5, 'Royaume-Uni': 3.5, Canada: 3, France: 2.7, Suisse: 2.4, Allemagne: 2.3, Autres: 9.1 },
    secteurs: { Technologie: 26, Finance: 17, Industrie: 11, 'Consommation cyclique': 10, Santé: 9.5, Communication: 8.5, 'Consommation de base': 5.5, Énergie: 3.5, Matériaux: 3, 'Services publics': 2.6, Immobilier: 2 },
    fraisTypiques: 0.3,
  },
  sp500: {
    nom: 'S&P 500',
    entreprises: { Nvidia: 7, Apple: 6, Microsoft: 6, Amazon: 4, Alphabet: 4, Meta: 3, Broadcom: 2.5, Tesla: 2, Berkshire: 1.6, JPMorgan: 1.5 },
    pays: { 'États-Unis': 100 },
    secteurs: { Technologie: 33, Finance: 13.5, 'Consommation cyclique': 10.5, Communication: 10, Santé: 9, Industrie: 8.5, 'Consommation de base': 5.3, Énergie: 3, 'Services publics': 2.4, Immobilier: 2, Matériaux: 1.8 },
    fraisTypiques: 0.15,
  },
  nasdaq100: {
    nom: 'Nasdaq 100',
    entreprises: { Nvidia: 9, Microsoft: 8, Apple: 8, Amazon: 5.5, Alphabet: 5, Broadcom: 5, Meta: 3.5, Tesla: 3, Netflix: 2.5, Costco: 2.3 },
    pays: { 'États-Unis': 97, Autres: 3 },
    secteurs: { Technologie: 60, Communication: 16, 'Consommation cyclique': 13, Santé: 5, 'Consommation de base': 4, Industrie: 2 },
    fraisTypiques: 0.25,
  },
  cac40: {
    nom: 'CAC 40',
    entreprises: { LVMH: 9, 'Schneider Electric': 8, TotalEnergies: 7, Airbus: 6, 'Air Liquide': 6, Sanofi: 6, 'L’Oréal': 5, Safran: 5, Hermès: 4, 'BNP Paribas': 4 },
    pays: { France: 100 },
    secteurs: { Industrie: 24, 'Consommation cyclique': 22, Finance: 12, 'Consommation de base': 9, Santé: 8, Énergie: 7, Matériaux: 7, Technologie: 5, Communication: 3, 'Services publics': 3 },
    fraisTypiques: 0.25,
  },
  eurostoxx50: {
    nom: 'Euro Stoxx 50',
    entreprises: { ASML: 7, SAP: 7, LVMH: 4, Siemens: 4, TotalEnergies: 3.5, 'Schneider Electric': 3.5, Allianz: 3.3, 'Deutsche Telekom': 3, Sanofi: 3, Airbus: 3 },
    pays: { France: 36, Allemagne: 30, 'Pays-Bas': 15, Espagne: 7, Italie: 7, Autres: 5 },
    secteurs: { Technologie: 18, Finance: 20, Industrie: 16, 'Consommation cyclique': 14, 'Consommation de base': 7, Santé: 6, Énergie: 5, Communication: 5, 'Services publics': 5, Matériaux: 4 },
    fraisTypiques: 0.1,
  },
  emergents: {
    nom: 'MSCI Emerging Markets',
    entreprises: { TSMC: 10, Tencent: 5, Samsung: 3, Alibaba: 3, 'HDFC Bank': 1.5, Reliance: 1.2, Xiaomi: 1.2, Meituan: 1 },
    pays: { Chine: 27, Inde: 19, Taïwan: 19, 'Corée du Sud': 10, Brésil: 4.5, 'Arabie saoudite': 4, 'Afrique du Sud': 3, Mexique: 2, Autres: 11.5 },
    secteurs: { Technologie: 24, Finance: 23, 'Consommation cyclique': 13, Communication: 9, Industrie: 7, Matériaux: 6, 'Consommation de base': 5, Énergie: 5, Santé: 3.5, 'Services publics': 2.5, Immobilier: 2 },
    fraisTypiques: 0.3,
  },
};

/** Frais courants connus, par ISIN (%/an). */
const FRAIS_CONNUS: Record<string, number> = {
  LU1681043599: 0.38, // Amundi MSCI World Swap (CW8)
  FR0011550185: 0.15, // BNP Paribas Easy S&P 500 (ESE)
  LU1681038243: 0.23, // Amundi Nasdaq-100 (PUST)
  FR0011871128: 0.15, // Amundi PEA S&P 500 (PE500)
  IE0002XZSHO1: 0.25, // iShares MSCI World Swap PEA (WPEA)
  FR0013412020: 0.3, // Amundi PEA MSCI Emerging (PAEEM)
};

export interface LigneTransparence {
  titreId: string;
  nom: string;
  isin?: string;
  valeur: number;
  secteur?: string;
  zone?: string;
}

export interface PartExposition {
  nom: string;
  /** En % de vos titres. */
  poids: number;
  /** Lignes par lesquelles vous y êtes exposé. */
  via: string[];
}

export interface LigneFrais {
  titreId: string;
  nom: string;
  valeur: number;
  /** Frais courants, en %/an. */
  taux: number;
  /** Vrai si le taux vient de l'ISIN ou de votre saisie, faux s'il est typique de l'indice. */
  connu: boolean;
  annuel: number;
  /** Coût sur vingt ans, à 5 %/an de rendement brut. */
  vingtAns: number;
}

export interface VueTransparence {
  entreprises: PartExposition[];
  pays: PartExposition[];
  secteurs: PartExposition[];
  /** Part des titres qui passe par un ETF décomposé, en %. */
  partEtf: number;
  frais: LigneFrais[];
  fraisAnnuels: number;
  fraisVingtAns: number;
  /** Frais moyens pondérés sur l'ensemble des titres, en %. */
  fraisMoyens: number;
}

function ajouter(cible: Map<string, PartExposition>, nom: string, poids: number, via: string) {
  const existant = cible.get(nom) ?? { nom, poids: 0, via: [] };
  existant.poids += poids;
  if (!existant.via.includes(via)) existant.via.push(via);
  cible.set(nom, existant);
}

const trier = (parts: Map<string, PartExposition>) =>
  [...parts.values()].filter(part => part.poids > 0.05).sort((a, b) => b.poids - a.poids);

const RENDEMENT_BRUT = 0.05;
const ANNEES = 20;

/** Ce que coûtent des frais de `taux` % sur une somme placée vingt ans. */
export function coutSurVingtAns(valeur: number, taux: number): number {
  return valeur * (Math.pow(1 + RENDEMENT_BRUT, ANNEES) - Math.pow(1 + RENDEMENT_BRUT - taux / 100, ANNEES));
}

export function construireTransparence(
  lignes: readonly LigneTransparence[],
  fraisSaisis: Readonly<Record<string, number>> = {},
): VueTransparence {
  const total = lignes.reduce((somme, ligne) => somme + ligne.valeur, 0);
  const entreprises = new Map<string, PartExposition>();
  const pays = new Map<string, PartExposition>();
  const secteurs = new Map<string, PartExposition>();
  const frais: LigneFrais[] = [];
  let valeurEtf = 0;

  for (const ligne of lignes) {
    const poids = total > 0 ? (ligne.valeur / total) * 100 : 0;
    const indice = indiceDeLigne(ligne.nom);
    if (indice) {
      valeurEtf += ligne.valeur;
      const composition = COMPOSITIONS[indice];
      for (const [nom, part] of Object.entries(composition.entreprises)) ajouter(entreprises, nom, (poids * part) / 100, ligne.nom);
      const autres = 100 - Object.values(composition.entreprises).reduce((s, p) => s + p, 0);
      ajouter(entreprises, `Autres entreprises du ${composition.nom}`, (poids * autres) / 100, ligne.nom);
      for (const [nom, part] of Object.entries(composition.pays)) ajouter(pays, nom, (poids * part) / 100, ligne.nom);
      for (const [nom, part] of Object.entries(composition.secteurs)) ajouter(secteurs, nom, (poids * part) / 100, ligne.nom);

      const saisi = fraisSaisis[ligne.titreId];
      const connu = saisi ?? (ligne.isin ? FRAIS_CONNUS[ligne.isin] : undefined);
      const taux = connu ?? composition.fraisTypiques;
      frais.push({
        titreId: ligne.titreId,
        nom: ligne.nom,
        valeur: ligne.valeur,
        taux,
        connu: connu !== undefined,
        annuel: (ligne.valeur * taux) / 100,
        vingtAns: coutSurVingtAns(ligne.valeur, taux),
      });
    } else {
      ajouter(entreprises, ligne.nom, poids, ligne.nom);
      ajouter(pays, ligne.zone || 'Non renseigné', poids, ligne.nom);
      ajouter(secteurs, ligne.secteur || 'Non renseigné', poids, ligne.nom);
    }
  }

  const fraisAnnuels = frais.reduce((somme, ligne) => somme + ligne.annuel, 0);
  return {
    entreprises: trier(entreprises),
    pays: trier(pays),
    secteurs: trier(secteurs),
    partEtf: total > 0 ? (valeurEtf / total) * 100 : 0,
    frais,
    fraisAnnuels,
    fraisVingtAns: frais.reduce((somme, ligne) => somme + ligne.vingtAns, 0),
    fraisMoyens: total > 0 ? (fraisAnnuels / total) * 100 : 0,
  };
}
