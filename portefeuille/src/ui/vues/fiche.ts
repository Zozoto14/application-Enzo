/**
 * Modèle de vue de la fiche valeur.
 *
 * Les données brutes viennent de `fondamentaux/yahoo.ts`. Ici, on les met en
 * forme, on calcule ce qui se déduit — croissances, historiques de PER et de
 * rendement, profil quantitatif — et on prépare les états financiers en
 * tableau.
 *
 * Deux conventions : un chiffre absent s'affiche « — », jamais 0 ; et tout ce
 * qui est calculé ici plutôt que fourni par la source le dit dans son libellé
 * (« note maison », « prix juste estimé »).
 */

import type { CoursEtDividendes, Comptes, Fiche, Nombre, PointAnnuel, Poste } from '../../fondamentaux/yahoo';
import { formaterDate, formaterMontant, formaterPourcentage, tendance, type Tendance } from '../format';

export interface ValeurSignee {
  texte: string;
  tendance: Tendance;
}

export interface LigneInfo {
  libelle: string;
  valeur: string;
  tendance?: Tendance;
}

export interface BlocInfo {
  titre: string;
  lignes: LigneInfo[];
}

export interface GraphiqueAnnuel {
  titre: string;
  unite: 'montant' | 'pourcentage' | 'nombre';
  barres: Array<{ libelle: string; valeur: number }>;
  /** Croissance annuelle moyenne sur la période, quand elle a un sens. */
  cagr?: string;
}

export interface LigneFinance {
  libelle: string;
  valeurs: Array<string>;
  variations: Array<ValeurSignee | null>;
  /** Valeurs brutes, pour le comparateur. */
  brut: Array<number | null>;
  important?: boolean;
}

export interface EtatFinancier {
  titre: string;
  lignes: LigneFinance[];
}

export interface VueFiche {
  entete: {
    nom: string;
    symbole: string;
    bourse: string;
    devise: string;
    /** Code ISO de la devise de cotation (« PLN »), pour la conversion en euros. */
    deviseCode: string;
    /** Cours brut, dans la devise de cotation. */
    coursBrut: number | null;
    cours: string;
    variation: ValeurSignee | null;
    note: string;
  };
  informations: BlocInfo[];
  profil: Array<{ libelle: string; valeur: number }>;
  description?: string;
  cours: Array<{ date: string; valeur: number }>;
  objectifs?: { bas: number; moyen: number; haut: number; cours: number; texte: string; potentiel: ValeurSignee };
  quantitatif: GraphiqueAnnuel[];
  dividende: {
    metriques: LigneInfo[];
    parAnnee: Array<{ libelle: string; valeur: number }>;
    croissance: Array<{ libelle: string; valeur: number }>;
    rendement: Array<{ date: string; valeur: number }>;
    rendementMedian: number | null;
    versements: Array<{ date: string; montant: string }>;
  };
  resultats: {
    prochaineDate?: string;
    surprises: Array<{ libelle: string; reel: number | null; estime: number | null; ecart: ValeurSignee | null }>;
    recommandations: Array<{ libelle: string; valeur: number; couleur: 'fort-achat' | 'achat' | 'conserver' | 'vente' | 'forte-vente' }>;
    consensus?: string;
    estimations: Array<{ periode: string; bpa: string; ca: string; croissance: string }>;
  };
  finances: { annees: string[]; dates: string[]; etats: EtatFinancier[] };
  valorisation: {
    metriques: LigneInfo[];
    per: Array<{ date: string; valeur: number }>;
    perMedian: number | null;
    parametres: ParametresPrixJuste;
  };
  societe: {
    capital: Array<{ libelle: string; valeur: number }>;
    actionnaires: Array<{ nom: string; part: string; actions: string; valeur: string; date: string }>;
    inities: Array<{ nom: string; fonction: string; operation: string; actions: string; valeur: string; date: string }>;
  };
  manques: string[];
}

// ------------------------------------------------------------ Formats

export function formaterCompact(valeur: Nombre, devise = ''): string {
  if (valeur === null) {
    return '—';
  }
  const absolu = Math.abs(valeur);
  const [diviseur, suffixe] =
    absolu >= 1e12 ? [1e12, ' Bn'] : absolu >= 1e9 ? [1e9, ' Md'] : absolu >= 1e6 ? [1e6, ' M'] : absolu >= 1e4 ? [1e3, ' k'] : [1, ''];
  const texte = (valeur / diviseur).toLocaleString('fr-FR', {
    minimumFractionDigits: diviseur === 1 ? 2 : 1,
    maximumFractionDigits: diviseur === 1 ? 2 : 1,
  });
  return `${texte}${suffixe}${devise ? ` ${devise}` : ''}`;
}

const DEVISES: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF', JPY: '¥' };

const proportion = (valeur: Nombre, decimales = 2) =>
  valeur === null ? '—' : formaterPourcentage(valeur * 100, decimales, { signeExplicite: false });
const proportionSignee = (valeur: Nombre, decimales = 2) =>
  valeur === null ? '—' : formaterPourcentage(valeur * 100, decimales);
const ratio = (valeur: Nombre, decimales = 2) =>
  valeur === null ? '—' : formaterMontant(valeur, { decimales, devise: null });

function borner(valeur: number, bas: number, haut: number): number {
  return Math.max(0, Math.min(1, (valeur - bas) / (haut - bas)));
}

function mediane(valeurs: readonly number[]): number | null {
  if (valeurs.length === 0) {
    return null;
  }
  const tries = [...valeurs].sort((a, b) => a - b);
  const milieu = Math.floor(tries.length / 2);
  return tries.length % 2 ? tries[milieu] : (tries[milieu - 1] + tries[milieu]) / 2;
}

/** Croissance annuelle moyenne entre la première et la dernière valeur. */
export function cagr(points: readonly PointAnnuel[] | undefined): number | null {
  if (!points || points.length < 2) {
    return null;
  }
  const premier = points[0];
  const dernier = points[points.length - 1];
  const annees = (Date.parse(dernier.date) - Date.parse(premier.date)) / (365.25 * 86_400_000);
  if (premier.valeur <= 0 || dernier.valeur <= 0 || annees <= 0) {
    return null;
  }
  return (dernier.valeur / premier.valeur) ** (1 / annees) - 1;
}

const annee = (date: string) => `FY${date.slice(2, 4)}`;

// ------------------------------------------------------- Prix juste

export interface ParametresPrixJuste {
  /** Bénéfice par action de départ. */
  bpa: number;
  /** Croissance annuelle attendue du BPA, en pourcentage. */
  croissance: number;
  annees: number;
  /** PER appliqué à la fin de la période. */
  perSortie: number;
  /** Rendement annuel exigé, en pourcentage. */
  rendementExige: number;
  /** Taux de distribution, en proportion, pour compter les dividendes. */
  distribution: number;
  inclureDividendes: boolean;
}

export interface PrixJuste {
  prix: number;
  /** Écart entre prix juste et cours, en pourcentage du prix juste. */
  margeSecurite: number | null;
  /** Rendement annuel attendu en achetant au cours actuel. */
  rendementAttendu: number | null;
  projection: Array<{ annee: number; bpa: number; prix: number }>;
}

/**
 * Prix juste par actualisation des bénéfices futurs.
 *
 * Le BPA croît au taux choisi ; à la fin de la période, l'action vaut ce BPA
 * multiplié par le PER de sortie ; ce prix, et les dividendes perçus en
 * chemin, sont ramenés à aujourd'hui au rendement exigé. Tout repose sur
 * les hypothèses : c'est un calculateur, pas une prévision.
 */
export function calculerPrixJuste(parametres: ParametresPrixJuste, cours: number | null): PrixJuste {
  const g = parametres.croissance / 100;
  const r = parametres.rendementExige / 100;
  const n = Math.max(1, Math.round(parametres.annees));
  let actualise = 0;
  let bpa = parametres.bpa;
  const projection: PrixJuste['projection'] = [];
  for (let t = 1; t <= n; t++) {
    bpa *= 1 + g;
    if (parametres.inclureDividendes) {
      actualise += (bpa * parametres.distribution) / (1 + r) ** t;
    }
    projection.push({ annee: t, bpa, prix: bpa * parametres.perSortie });
  }
  const prix = actualise + (bpa * parametres.perSortie) / (1 + r) ** n;
  let rendementAttendu: number | null = null;
  if (cours && cours > 0) {
    const final = bpa * parametres.perSortie;
    rendementAttendu = ((final / cours) ** (1 / n) - 1) * 100;
  }
  return {
    prix,
    margeSecurite: cours && prix > 0 ? ((prix - cours) / prix) * 100 : null,
    rendementAttendu,
    projection,
  };
}

// ----------------------------------------------------- États financiers

const ETATS: Array<{ titre: string; lignes: Array<{ poste: Poste; libelle: string; important?: boolean; parAction?: boolean }> }> = [
  {
    titre: 'Compte de résultat',
    lignes: [
      { poste: 'TotalRevenue', libelle: 'Chiffre d’affaires', important: true },
      { poste: 'CostOfRevenue', libelle: 'Coût des marchandises vendues' },
      { poste: 'GrossProfit', libelle: 'Résultat brut', important: true },
      { poste: 'OperatingExpense', libelle: 'Charges d’exploitation' },
      { poste: 'OperatingIncome', libelle: 'Résultat d’exploitation', important: true },
      { poste: 'EBITDA', libelle: 'EBITDA' },
      { poste: 'PretaxIncome', libelle: 'Résultat avant impôt' },
      { poste: 'TaxProvision', libelle: 'Charge d’impôt' },
      { poste: 'NetIncome', libelle: 'Résultat net', important: true },
      { poste: 'BasicEPS', libelle: 'BPA de base', parAction: true },
      { poste: 'DilutedEPS', libelle: 'BPA dilué', parAction: true, important: true },
      { poste: 'DilutedAverageShares', libelle: 'Actions en circulation (diluées)' },
    ],
  },
  {
    titre: 'Bilan',
    lignes: [
      { poste: 'TotalAssets', libelle: 'Total de l’actif', important: true },
      { poste: 'TotalLiabilitiesNetMinorityInterest', libelle: 'Total du passif' },
      { poste: 'StockholdersEquity', libelle: 'Capitaux propres', important: true },
      { poste: 'TotalDebt', libelle: 'Dette totale' },
      { poste: 'CashAndCashEquivalents', libelle: 'Trésorerie' },
      { poste: 'WorkingCapital', libelle: 'Besoin en fonds de roulement' },
    ],
  },
  {
    titre: 'Flux de trésorerie',
    lignes: [
      { poste: 'OperatingCashFlow', libelle: 'Flux d’exploitation', important: true },
      { poste: 'CapitalExpenditure', libelle: 'Investissements (capex)' },
      { poste: 'FreeCashFlow', libelle: 'Free cash flow', important: true },
      { poste: 'CashDividendsPaid', libelle: 'Dividendes versés' },
      { poste: 'RepurchaseOfCapitalStock', libelle: 'Rachats d’actions' },
    ],
  },
];

export function etatsFinanciers(comptes: Comptes): { annees: string[]; dates: string[]; etats: EtatFinancier[] } {
  const dates = [...new Set(Object.values(comptes).flatMap(points => (points ?? []).map(point => point.date)))].sort();
  const annees = dates.map(annee);
  const etats = ETATS.map(etat => ({
    titre: etat.titre,
    lignes: etat.lignes
      .filter(ligne => (comptes[ligne.poste] ?? []).length > 0)
      .map(ligne => {
        const parDate = new Map((comptes[ligne.poste] ?? []).map(point => [point.date, point.valeur]));
        const brut = dates.map(date => parDate.get(date) ?? null);
        return {
          libelle: ligne.libelle,
          important: ligne.important,
          brut,
          valeurs: brut.map(valeur =>
            valeur === null ? '—' : ligne.parAction ? ratio(valeur) : formaterCompact(valeur),
          ),
          variations: brut.map((valeur, index) => {
            const avant = index > 0 ? brut[index - 1] : null;
            if (valeur === null || avant === null || avant === 0) {
              return null;
            }
            const variation = ((valeur - avant) / Math.abs(avant)) * 100;
            return { texte: formaterPourcentage(variation), tendance: tendance(variation) };
          }),
        };
      }),
  })).filter(etat => etat.lignes.length > 0);
  return { annees, dates, etats };
}

// ------------------------------------------------------------ Fiche

export function construireFiche(
  fiche: Fiche,
  comptes: Comptes,
  historique: CoursEtDividendes,
  manques: readonly string[] = [],
): VueFiche {
  const symboleDevise = DEVISES[fiche.devise] ?? fiche.devise;
  const argent = (valeur: Nombre) =>
    valeur === null ? '—' : `${formaterMontant(valeur, { devise: null })} ${symboleDevise}`.trim();

  // Historique : rendement du dividende et PER, semaine par semaine.
  const cours = historique.cours.map(point => ({ date: point.date, valeur: point.cloture }));
  const rendement: Array<{ date: string; valeur: number }> = [];
  for (const point of historique.cours) {
    const depuis = new Date(Date.parse(point.date) - 365 * 86_400_000).toISOString().slice(0, 10);
    const ttm = historique.dividendes
      .filter(div => div.date > depuis && div.date <= point.date)
      .reduce((somme, div) => somme + div.montant, 0);
    if (historique.dividendes.length > 0 && historique.dividendes[0].date <= point.date) {
      rendement.push({ date: point.date, valeur: (ttm / point.cloture) * 100 });
    }
  }
  const bpaAnnuels = comptes.DilutedEPS ?? comptes.BasicEPS ?? [];
  const per: Array<{ date: string; valeur: number }> = [];
  for (const point of historique.cours) {
    const connu = [...bpaAnnuels].reverse().find(bpa => bpa.date <= point.date);
    if (connu && connu.valeur > 0) {
      per.push({ date: point.date, valeur: point.cloture / connu.valeur });
    }
  }

  // Performance sur un an, pour le profil.
  const dernier = historique.cours[historique.cours.length - 1];
  const ilYaUnAn = dernier
    ? [...historique.cours].reverse().find(point => Date.parse(point.date) <= Date.parse(dernier.date) - 365 * 86_400_000)
    : undefined;
  const momentum = dernier && ilYaUnAn ? dernier.cloture / ilYaUnAn.cloture - 1 : null;
  const croissanceCa = cagr(comptes.TotalRevenue) ?? fiche.croissance.ca;

  const axes = [
    {
      libelle: 'Rentabilité',
      valeur:
        fiche.rentabilite.roe === null && fiche.marges.nette === null
          ? null
          : ((fiche.rentabilite.roe === null ? 0.5 : borner(fiche.rentabilite.roe, 0, 0.3)) +
              (fiche.marges.nette === null ? 0.5 : borner(fiche.marges.nette, 0, 0.25))) /
            2,
    },
    { libelle: 'Croissance', valeur: croissanceCa === null ? null : borner(croissanceCa, -0.1, 0.25) },
    {
      libelle: 'Santé',
      valeur: fiche.sante.detteSurCapitaux === null ? null : 1 - borner(fiche.sante.detteSurCapitaux, 0, 200),
    },
    {
      libelle: 'Valorisation',
      valeur: fiche.valorisation.per === null ? null : 1 - borner(fiche.valorisation.per, 8, 45),
    },
    { libelle: 'Dividende', valeur: fiche.dividende.rendement === null ? 0 : borner(fiche.dividende.rendement, 0, 0.06) },
    { libelle: 'Momentum', valeur: momentum === null ? null : borner(momentum, -0.3, 0.5) },
  ];
  const connus = axes.filter(axe => axe.valeur !== null) as Array<{ libelle: string; valeur: number }>;
  const note = connus.length > 0 ? (connus.reduce((s, a) => s + a.valeur, 0) / connus.length) * 20 : null;

  // Dividendes par année civile.
  const parAnnee = new Map<string, number>();
  for (const div of historique.dividendes) {
    parAnnee.set(div.date.slice(0, 4), (parAnnee.get(div.date.slice(0, 4)) ?? 0) + div.montant);
  }
  const annees = [...parAnnee.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const croissanceDiv = annees.slice(1).map(([libelle, valeur], index) => ({
    libelle,
    valeur: annees[index][1] > 0 ? (valeur / annees[index][1] - 1) * 100 : 0,
  }));
  const moisEntreVersements =
    historique.dividendes.length >= 2
      ? (Date.parse(historique.dividendes[historique.dividendes.length - 1].date) -
          Date.parse(historique.dividendes[Math.max(0, historique.dividendes.length - 5)].date)) /
        (Math.min(4, historique.dividendes.length - 1) * 30.44 * 86_400_000)
      : null;
  const frequence =
    moisEntreVersements === null
      ? '—'
      : moisEntreVersements < 2
        ? 'Mensuel'
        : moisEntreVersements < 4.5
          ? 'Trimestriel'
          : moisEntreVersements < 8
            ? 'Semestriel'
            : 'Annuel';

  const tendanceReco = fiche.analystes.tendance;
  const recommandations = tendanceReco
    ? ([
        { libelle: 'Achat fort', valeur: tendanceReco.fortAchat, couleur: 'fort-achat' },
        { libelle: 'Achat', valeur: tendanceReco.achat, couleur: 'achat' },
        { libelle: 'Conserver', valeur: tendanceReco.conserver, couleur: 'conserver' },
        { libelle: 'Vente', valeur: tendanceReco.vente, couleur: 'vente' },
        { libelle: 'Vente forte', valeur: tendanceReco.forteVente, couleur: 'forte-vente' },
      ] as const).filter(part => part.valeur > 0)
    : [];

  const LIBELLES_PERIODE: Record<string, string> = {
    '0q': 'Trimestre en cours',
    '+1q': 'Trimestre prochain',
    '0y': 'Exercice en cours',
    '+1y': 'Exercice prochain',
  };

  const graphique = (
    titre: string,
    poste: Poste,
    unite: GraphiqueAnnuel['unite'] = 'montant',
    signeInverse = false,
  ): GraphiqueAnnuel | undefined => {
    const points = comptes[poste];
    if (!points || points.length === 0) {
      return undefined;
    }
    const valeurs = points.map(point => ({ libelle: annee(point.date), valeur: signeInverse ? -point.valeur : point.valeur }));
    const croissance = cagr(points.map(point => ({ date: point.date, valeur: signeInverse ? -point.valeur : point.valeur })));
    return { titre, unite, barres: valeurs, cagr: croissance === null ? undefined : formaterPourcentage(croissance * 100) };
  };

  const marges = (numerateur: Poste): GraphiqueAnnuel | undefined => {
    const ca = new Map((comptes.TotalRevenue ?? []).map(point => [point.date, point.valeur]));
    const points = (comptes[numerateur] ?? []).filter(point => (ca.get(point.date) ?? 0) > 0);
    if (points.length === 0) {
      return undefined;
    }
    return {
      titre: '',
      unite: 'pourcentage',
      barres: points.map(point => ({ libelle: annee(point.date), valeur: (point.valeur / ca.get(point.date)!) * 100 })),
    };
  };
  const margeBrute = marges('GrossProfit');
  const margeOp = marges('OperatingIncome');
  const margeNette = marges('NetIncome');

  const quantitatif = [
    graphique('Chiffre d’affaires', 'TotalRevenue'),
    graphique('Bénéfices', 'NetIncome'),
    graphique('Free cash flow', 'FreeCashFlow'),
    graphique('EBITDA', 'EBITDA'),
    margeBrute ? { ...margeBrute, titre: 'Marge brute' } : undefined,
    margeOp ? { ...margeOp, titre: 'Marge d’exploitation' } : undefined,
    margeNette ? { ...margeNette, titre: 'Marge nette' } : undefined,
    graphique('BPA dilué', 'DilutedEPS', 'nombre'),
    graphique('Actions en circulation', 'DilutedAverageShares'),
    graphique('Dette totale', 'TotalDebt'),
    graphique('Trésorerie', 'CashAndCashEquivalents'),
    graphique('Dividendes versés', 'CashDividendsPaid', 'montant', true),
  ].filter((element): element is GraphiqueAnnuel => Boolean(element));

  const bpaDepart = fiche.bpa.passe ?? bpaAnnuels[bpaAnnuels.length - 1]?.valeur ?? 1;
  const croissanceBpa = cagr(bpaAnnuels);
  const perMedian = mediane(per.map(point => point.valeur));

  const variation = fiche.variationPct;
  const cible = fiche.analystes;

  return {
    entete: {
      nom: fiche.nom,
      symbole: fiche.symbole,
      bourse: fiche.bourse,
      devise: symboleDevise,
      deviseCode: fiche.devise,
      coursBrut: fiche.cours,
      cours: fiche.cours === null ? '—' : formaterMontant(fiche.cours, { devise: null }),
      variation: variation === null ? null : { texte: formaterPourcentage(variation), tendance: tendance(variation) },
      note: note === null ? '—' : `${note.toFixed(1).replace('.', ',')}/20`,
    },
    informations: [
      {
        titre: 'Profil',
        lignes: [
          { libelle: 'Secteur', valeur: fiche.profil.secteur ?? '—' },
          { libelle: 'Industrie', valeur: fiche.profil.industrie ?? '—' },
          { libelle: 'Pays', valeur: fiche.profil.pays ?? '—' },
          { libelle: 'Employés', valeur: fiche.profil.employes === null ? '—' : fiche.profil.employes.toLocaleString('fr-FR') },
          { libelle: 'Site web', valeur: fiche.profil.site?.replace(/^https?:\/\//, '') ?? '—' },
        ],
      },
      {
        titre: 'Marché',
        lignes: [
          { libelle: 'Capitalisation', valeur: formaterCompact(fiche.marche.capitalisation, symboleDevise) },
          { libelle: 'Volume moyen', valeur: formaterCompact(fiche.marche.volumeMoyen) },
          { libelle: 'Plus haut 52 sem.', valeur: argent(fiche.marche.plusHaut52) },
          { libelle: 'Plus bas 52 sem.', valeur: argent(fiche.marche.plusBas52) },
          { libelle: 'Bêta', valeur: ratio(fiche.marche.beta) },
        ],
      },
      {
        titre: 'Valorisation',
        lignes: [
          { libelle: 'PER', valeur: ratio(fiche.valorisation.per) },
          { libelle: 'PER prévisionnel', valeur: ratio(fiche.valorisation.perPrevisionnel) },
          { libelle: 'Cours / valeur comptable', valeur: ratio(fiche.valorisation.prixSurValeurComptable) },
          { libelle: 'Cours / ventes', valeur: ratio(fiche.valorisation.prixSurVentes) },
          { libelle: 'VE / EBITDA', valeur: ratio(fiche.valorisation.evSurEbitda) },
          { libelle: 'PEG', valeur: ratio(fiche.valorisation.peg) },
        ],
      },
      {
        titre: 'Dividende',
        lignes: [
          { libelle: 'Rendement', valeur: proportion(fiche.dividende.rendement) },
          { libelle: 'Dividende annuel', valeur: argent(fiche.dividende.montantAnnuel) },
          { libelle: 'Taux de distribution', valeur: proportion(fiche.dividende.tauxDistribution) },
          { libelle: 'Détachement', valeur: fiche.dividende.dateDetachement ? formaterDate(fiche.dividende.dateDetachement) : '—' },
        ],
      },
      {
        titre: 'Marges',
        lignes: [
          { libelle: 'Marge brute', valeur: proportion(fiche.marges.brute) },
          { libelle: 'Marge d’exploitation', valeur: proportion(fiche.marges.operationnelle) },
          { libelle: 'Marge EBITDA', valeur: proportion(fiche.marges.ebitda) },
          { libelle: 'Marge nette', valeur: proportion(fiche.marges.nette) },
        ],
      },
      {
        titre: 'Rentabilité et croissance',
        lignes: [
          { libelle: 'ROE', valeur: proportion(fiche.rentabilite.roe) },
          { libelle: 'ROA', valeur: proportion(fiche.rentabilite.roa) },
          { libelle: 'Croissance du CA', valeur: proportionSignee(fiche.croissance.ca), tendance: tendance(fiche.croissance.ca) },
          {
            libelle: 'Croissance des bénéfices',
            valeur: proportionSignee(fiche.croissance.benefices),
            tendance: tendance(fiche.croissance.benefices),
          },
        ],
      },
      {
        titre: 'Santé financière',
        lignes: [
          { libelle: 'Dette totale', valeur: formaterCompact(fiche.sante.dette, symboleDevise) },
          { libelle: 'Trésorerie', valeur: formaterCompact(fiche.sante.tresorerie, symboleDevise) },
          { libelle: 'Dette / capitaux propres', valeur: fiche.sante.detteSurCapitaux === null ? '—' : `${ratio(fiche.sante.detteSurCapitaux, 1)} %` },
          { libelle: 'Liquidité générale', valeur: ratio(fiche.sante.liquiditeGenerale) },
          { libelle: 'Free cash flow', valeur: formaterCompact(fiche.sante.fcf, symboleDevise) },
        ],
      },
    ],
    profil: axes.map(axe => ({ libelle: axe.libelle, valeur: axe.valeur ?? 0 })),
    description: fiche.profil.description,
    cours,
    objectifs:
      cible.objectifBas !== null && cible.objectifMoyen !== null && cible.objectifHaut !== null && fiche.cours !== null
        ? {
            bas: cible.objectifBas,
            moyen: cible.objectifMoyen,
            haut: cible.objectifHaut,
            cours: fiche.cours,
            texte: `${cible.nombre ?? '?'} analystes · objectif moyen ${argent(cible.objectifMoyen)}`,
            potentiel: {
              texte: formaterPourcentage((cible.objectifMoyen / fiche.cours - 1) * 100),
              tendance: tendance(cible.objectifMoyen - fiche.cours),
            },
          }
        : undefined,
    quantitatif,
    dividende: {
      metriques: [
        { libelle: 'Rendement', valeur: proportion(fiche.dividende.rendement) },
        { libelle: 'Taux de distribution', valeur: proportion(fiche.dividende.tauxDistribution) },
        { libelle: 'Fréquence', valeur: frequence },
        { libelle: 'Rendement moyen 5 ans', valeur: fiche.dividende.rendementMoyen5Ans === null ? '—' : `${ratio(fiche.dividende.rendementMoyen5Ans)} %` },
        {
          libelle: 'Dernier versement',
          valeur: historique.dividendes.length
            ? `${formaterDate(historique.dividendes[historique.dividendes.length - 1].date)} · ${argent(historique.dividendes[historique.dividendes.length - 1].montant)}`
            : '—',
        },
        { libelle: 'Prochain paiement', valeur: fiche.dividende.datePaiement ? formaterDate(fiche.dividende.datePaiement) : '—' },
        {
          libelle: 'Croissance annuelle (CAGR)',
          valeur:
            annees.length >= 3
              ? formaterPourcentage(
                  ((annees[annees.length - 2][1] / annees[0][1]) ** (1 / Math.max(1, annees.length - 2)) - 1) * 100,
                )
              : '—',
        },
      ],
      parAnnee: annees.map(([libelle, valeur]) => ({ libelle, valeur })),
      croissance: croissanceDiv,
      rendement,
      rendementMedian: mediane(rendement.map(point => point.valeur)),
      versements: [...historique.dividendes]
        .reverse()
        .map(div => ({ date: formaterDate(div.date), montant: argent(div.montant) })),
    },
    resultats: {
      prochaineDate: fiche.resultats.prochaineDate ? formaterDate(fiche.resultats.prochaineDate) : undefined,
      surprises: fiche.resultats.trimestres.map(trimestre => {
        const ecart =
          trimestre.reel !== null && trimestre.estime !== null && trimestre.estime !== 0
            ? ((trimestre.reel - trimestre.estime) / Math.abs(trimestre.estime)) * 100
            : null;
        return {
          libelle: trimestre.periode,
          reel: trimestre.reel,
          estime: trimestre.estime,
          ecart: ecart === null ? null : { texte: formaterPourcentage(ecart), tendance: tendance(ecart) },
        };
      }),
      recommandations: [...recommandations],
      consensus: cible.recommandation
        ? ({ strong_buy: 'Achat fort', buy: 'Achat', hold: 'Conserver', sell: 'Vente', strong_sell: 'Vente forte', underperform: 'Sous-performance', none: '—' } as Record<string, string>)[cible.recommandation] ?? cible.recommandation
        : undefined,
      estimations: fiche.resultats.estimations.map(estimation => ({
        periode: `${LIBELLES_PERIODE[estimation.periode] ?? estimation.periode}${estimation.fin ? ` (${formaterDate(estimation.fin)})` : ''}`,
        bpa: estimation.bpa === null ? '—' : argent(estimation.bpa),
        ca: formaterCompact(estimation.ca, symboleDevise),
        croissance: proportionSignee(estimation.croissance),
      })),
    },
    finances: etatsFinanciers(comptes),
    valorisation: {
      metriques: [
        { libelle: 'PER', valeur: ratio(fiche.valorisation.per) },
        { libelle: 'PER médian (historique)', valeur: ratio(perMedian) },
        { libelle: 'PER prévisionnel', valeur: ratio(fiche.valorisation.perPrevisionnel) },
        { libelle: 'PEG', valeur: ratio(fiche.valorisation.peg) },
        { libelle: 'VE / EBITDA', valeur: ratio(fiche.valorisation.evSurEbitda) },
        { libelle: 'Cours / valeur comptable', valeur: ratio(fiche.valorisation.prixSurValeurComptable) },
        {
          libelle: 'Rendement des bénéfices',
          valeur: fiche.valorisation.per ? formaterPourcentage(100 / fiche.valorisation.per, 2, { signeExplicite: false }) : '—',
        },
        {
          libelle: 'Rendement du FCF',
          valeur:
            fiche.sante.fcf !== null && fiche.marche.capitalisation
              ? formaterPourcentage((fiche.sante.fcf / fiche.marche.capitalisation) * 100, 2, { signeExplicite: false })
              : '—',
        },
      ],
      per,
      perMedian,
      parametres: {
        bpa: Number(bpaDepart.toFixed(2)),
        croissance: Number(Math.max(0, Math.min(25, (croissanceBpa ?? fiche.croissance.benefices ?? 0.05) * 100)).toFixed(1)),
        annees: 10,
        perSortie: Number((perMedian ?? fiche.valorisation.per ?? 15).toFixed(1)),
        rendementExige: 10,
        distribution: fiche.dividende.tauxDistribution ?? 0,
        inclureDividendes: true,
      },
    },
    societe: {
      capital: [
        ...(fiche.actionnaires.institutions !== null ? [{ libelle: 'Institutionnels', valeur: fiche.actionnaires.institutions * 100 }] : []),
        ...(fiche.actionnaires.inities !== null ? [{ libelle: 'Dirigeants et initiés', valeur: fiche.actionnaires.inities * 100 }] : []),
        ...(fiche.actionnaires.institutions !== null || fiche.actionnaires.inities !== null
          ? [
              {
                libelle: 'Flottant (public)',
                valeur: Math.max(0, 100 - (fiche.actionnaires.institutions ?? 0) * 100 - (fiche.actionnaires.inities ?? 0) * 100),
              },
            ]
          : []),
      ],
      actionnaires: fiche.actionnaires.principaux.map(ligne => ({
        nom: ligne.nom,
        part: proportion(ligne.part),
        actions: formaterCompact(ligne.actions),
        valeur: formaterCompact(ligne.valeur, symboleDevise),
        date: ligne.date ? formaterDate(ligne.date) : '—',
      })),
      inities: fiche.transactionsInities.map(ligne => ({
        nom: ligne.nom,
        fonction: ligne.fonction ?? '—',
        operation: ligne.texte ?? '—',
        actions: formaterCompact(ligne.actions),
        valeur: formaterCompact(ligne.valeur, symboleDevise),
        date: ligne.date ? formaterDate(ligne.date) : '—',
      })),
    },
    manques: [...manques],
  };
}
