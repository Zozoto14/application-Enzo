/**
 * Données fondamentales d'une valeur, depuis Yahoo Finance.
 *
 * Trois sources, toutes sans clé :
 *
 *  - `quoteSummary` : profil, ratios, consensus des analystes, actionnaires ;
 *  - `fundamentals-timeseries` : comptes annuels sur une dizaine d'années ;
 *  - `chart` avec `events=div` : cours hebdomadaires et dividendes versés.
 *
 * Aucune de ces interfaces n'est documentée : Yahoo peut les changer. La
 * lecture est donc défensive — un champ absent donne `null`, jamais une
 * exception — et chaque écran dit ce qui manque plutôt que d'afficher zéro.
 *
 * Sur le bureau, `fetch` passe par le processus principal, qui gère le
 * cookie et le jeton qu'exige `quoteSummary`.
 */

export type Nombre = number | null;

export interface PointAnnuel {
  /** Date de clôture de l'exercice, ISO. */
  date: string;
  valeur: number;
}

export interface Fiche {
  symbole: string;
  nom: string;
  devise: string;
  bourse: string;
  cours: Nombre;
  variationPct: Nombre;
  profil: {
    secteur?: string;
    industrie?: string;
    pays?: string;
    ville?: string;
    site?: string;
    employes: Nombre;
    description?: string;
  };
  marche: {
    capitalisation: Nombre;
    volumeMoyen: Nombre;
    plusHaut52: Nombre;
    plusBas52: Nombre;
    beta: Nombre;
    actions: Nombre;
  };
  valorisation: {
    per: Nombre;
    perPrevisionnel: Nombre;
    prixSurValeurComptable: Nombre;
    prixSurVentes: Nombre;
    evSurEbitda: Nombre;
    evSurCa: Nombre;
    peg: Nombre;
    valeurEntreprise: Nombre;
  };
  dividende: {
    /** En proportion : 0,03 pour 3 %. */
    rendement: Nombre;
    montantAnnuel: Nombre;
    tauxDistribution: Nombre;
    rendementMoyen5Ans: Nombre;
    dateDetachement?: string;
    datePaiement?: string;
  };
  marges: { brute: Nombre; operationnelle: Nombre; nette: Nombre; ebitda: Nombre };
  rentabilite: { roe: Nombre; roa: Nombre };
  sante: {
    dette: Nombre;
    tresorerie: Nombre;
    detteSurCapitaux: Nombre;
    liquiditeGenerale: Nombre;
    liquiditeImmediate: Nombre;
    fcf: Nombre;
    fluxOperationnel: Nombre;
  };
  croissance: { ca: Nombre; benefices: Nombre };
  bpa: { passe: Nombre; prevu: Nombre };
  analystes: {
    objectifBas: Nombre;
    objectifMoyen: Nombre;
    objectifHaut: Nombre;
    recommandation?: string;
    nombre: Nombre;
    tendance?: { fortAchat: number; achat: number; conserver: number; vente: number; forteVente: number };
  };
  resultats: {
    prochaineDate?: string;
    trimestres: Array<{ periode: string; reel: Nombre; estime: Nombre }>;
    estimations: Array<{ periode: string; fin?: string; bpa: Nombre; ca: Nombre; croissance: Nombre }>;
  };
  actionnaires: {
    inities: Nombre;
    institutions: Nombre;
    nombreInstitutions: Nombre;
    principaux: Array<{ nom: string; part: Nombre; actions: Nombre; valeur: Nombre; date?: string }>;
  };
  transactionsInities: Array<{
    nom: string;
    fonction?: string;
    texte?: string;
    actions: Nombre;
    valeur: Nombre;
    date?: string;
  }>;
}

export interface CoursEtDividendes {
  cours: Array<{ date: string; cloture: number }>;
  dividendes: Array<{ date: string; montant: number }>;
}

const BASE = 'https://query2.finance.yahoo.com';

const MODULES = [
  'price',
  'summaryDetail',
  'defaultKeyStatistics',
  'financialData',
  'assetProfile',
  'calendarEvents',
  'earnings',
  'earningsTrend',
  'recommendationTrend',
  'majorHoldersBreakdown',
  'institutionOwnership',
  'insiderTransactions',
];

/** Postes des comptes annuels demandés, sans le préfixe « annual ». */
export const POSTES = [
  'TotalRevenue',
  'CostOfRevenue',
  'GrossProfit',
  'OperatingExpense',
  'OperatingIncome',
  'EBITDA',
  'PretaxIncome',
  'TaxProvision',
  'NetIncome',
  'NetIncomeCommonStockholders',
  'BasicEPS',
  'DilutedEPS',
  'BasicAverageShares',
  'DilutedAverageShares',
  'TotalAssets',
  'TotalLiabilitiesNetMinorityInterest',
  'StockholdersEquity',
  'TotalDebt',
  'CashAndCashEquivalents',
  'WorkingCapital',
  'OperatingCashFlow',
  'CapitalExpenditure',
  'FreeCashFlow',
  'CashDividendsPaid',
  'RepurchaseOfCapitalStock',
] as const;

export type Poste = (typeof POSTES)[number];
export type Comptes = Partial<Record<Poste, PointAnnuel[]>>;

export type Recuperer = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class ErreurDonnees extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurDonnees';
  }
}

async function lireJson(url: string, recuperer: Recuperer): Promise<unknown> {
  let reponse;
  try {
    reponse = await recuperer(url);
  } catch (erreur) {
    throw new ErreurDonnees(
      `Yahoo Finance est injoignable : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
    );
  }
  if (!reponse.ok) {
    throw new ErreurDonnees(`Yahoo Finance a répondu ${reponse.status}.`);
  }
  return reponse.json();
}

// ------------------------------------------------------------ Lecture sûre

type Objet = Record<string, unknown>;

function objet(valeur: unknown): Objet {
  return valeur && typeof valeur === 'object' ? (valeur as Objet) : {};
}

/** Valeur numérique d'un champ Yahoo : `{ raw, fmt }` ou nombre nu. */
export function nombre(valeur: unknown): Nombre {
  if (typeof valeur === 'number') {
    return Number.isFinite(valeur) ? valeur : null;
  }
  const brut = objet(valeur).raw;
  return typeof brut === 'number' && Number.isFinite(brut) ? brut : null;
}

function texte(valeur: unknown): string | undefined {
  return typeof valeur === 'string' && valeur.trim() ? valeur.trim() : undefined;
}

/** Date ISO d'un horodatage Yahoo (secondes) ou d'un champ `{ raw }`. */
function dateDe(valeur: unknown): string | undefined {
  const secondes = nombre(valeur);
  if (secondes === null) {
    return texte(objet(valeur).fmt) ?? texte(valeur);
  }
  const date = new Date(secondes * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

// --------------------------------------------------------------- Résumé

export function lireFiche(symbole: string, json: unknown): Fiche {
  const enveloppe = objet(objet(json).quoteSummary);
  const resultat = objet(Array.isArray(enveloppe.result) ? enveloppe.result[0] : undefined);
  if (Object.keys(resultat).length === 0) {
    const erreur = objet(enveloppe.error);
    throw new ErreurDonnees(
      texte(erreur.description) ?? `Aucune donnée pour ${symbole} : symbole inconnu de Yahoo Finance ?`,
    );
  }

  const prix = objet(resultat.price);
  const detail = objet(resultat.summaryDetail);
  const cles = objet(resultat.defaultKeyStatistics);
  const financier = objet(resultat.financialData);
  const profil = objet(resultat.assetProfile);
  const calendrier = objet(resultat.calendarEvents);
  const resultats = objet(resultat.earnings);
  const tendanceBpa = objet(resultat.earningsTrend);
  const recommandations = objet(resultat.recommendationTrend);
  const detenteurs = objet(resultat.majorHoldersBreakdown);
  const institutions = objet(resultat.institutionOwnership);
  const inities = objet(resultat.insiderTransactions);

  const tendances = Array.isArray(recommandations.trend) ? recommandations.trend.map(objet) : [];
  const actuelle = tendances.find(t => t.period === '0m') ?? tendances[0];

  const trimestres = Array.isArray(objet(resultats.earningsChart).quarterly)
    ? (objet(resultats.earningsChart).quarterly as unknown[]).map(objet)
    : [];

  const estimations = Array.isArray(tendanceBpa.trend) ? tendanceBpa.trend.map(objet) : [];
  const datesResultats = objet(calendrier.earnings).earningsDate;

  const variation = nombre(prix.regularMarketChangePercent);

  return {
    symbole,
    nom: texte(prix.longName) ?? texte(prix.shortName) ?? symbole,
    devise: texte(prix.currency) ?? texte(detail.currency) ?? '',
    bourse: texte(prix.exchangeName) ?? '',
    cours: nombre(prix.regularMarketPrice) ?? nombre(financier.currentPrice),
    // Yahoo rend tantôt une proportion (0,0125), tantôt des points : on
    // ramène tout en pourcentage.
    variationPct: variation === null ? null : Math.abs(variation) < 1 ? variation * 100 : variation,
    profil: {
      secteur: texte(profil.sector),
      industrie: texte(profil.industry),
      pays: texte(profil.country),
      ville: texte(profil.city),
      site: texte(profil.website),
      employes: nombre(profil.fullTimeEmployees),
      description: texte(profil.longBusinessSummary),
    },
    marche: {
      capitalisation: nombre(prix.marketCap) ?? nombre(detail.marketCap),
      volumeMoyen: nombre(detail.averageVolume),
      plusHaut52: nombre(detail.fiftyTwoWeekHigh),
      plusBas52: nombre(detail.fiftyTwoWeekLow),
      beta: nombre(detail.beta) ?? nombre(cles.beta),
      actions: nombre(cles.sharesOutstanding),
    },
    valorisation: {
      per: nombre(detail.trailingPE),
      perPrevisionnel: nombre(detail.forwardPE) ?? nombre(cles.forwardPE),
      prixSurValeurComptable: nombre(cles.priceToBook),
      prixSurVentes: nombre(detail.priceToSalesTrailing12Months),
      evSurEbitda: nombre(cles.enterpriseToEbitda),
      evSurCa: nombre(cles.enterpriseToRevenue),
      peg: nombre(cles.pegRatio) ?? nombre(cles.trailingPegRatio),
      valeurEntreprise: nombre(cles.enterpriseValue),
    },
    dividende: {
      rendement: nombre(detail.dividendYield) ?? nombre(detail.trailingAnnualDividendYield),
      montantAnnuel: nombre(detail.dividendRate) ?? nombre(detail.trailingAnnualDividendRate),
      tauxDistribution: nombre(detail.payoutRatio),
      rendementMoyen5Ans: nombre(detail.fiveYearAvgDividendYield),
      dateDetachement: dateDe(detail.exDividendDate) ?? dateDe(calendrier.exDividendDate),
      datePaiement: dateDe(calendrier.dividendDate),
    },
    marges: {
      brute: nombre(financier.grossMargins),
      operationnelle: nombre(financier.operatingMargins),
      nette: nombre(financier.profitMargins),
      ebitda: nombre(financier.ebitdaMargins),
    },
    rentabilite: { roe: nombre(financier.returnOnEquity), roa: nombre(financier.returnOnAssets) },
    sante: {
      dette: nombre(financier.totalDebt),
      tresorerie: nombre(financier.totalCash),
      detteSurCapitaux: nombre(financier.debtToEquity),
      liquiditeGenerale: nombre(financier.currentRatio),
      liquiditeImmediate: nombre(financier.quickRatio),
      fcf: nombre(financier.freeCashflow),
      fluxOperationnel: nombre(financier.operatingCashflow),
    },
    croissance: { ca: nombre(financier.revenueGrowth), benefices: nombre(financier.earningsGrowth) },
    bpa: { passe: nombre(cles.trailingEps), prevu: nombre(cles.forwardEps) },
    analystes: {
      objectifBas: nombre(financier.targetLowPrice),
      objectifMoyen: nombre(financier.targetMeanPrice),
      objectifHaut: nombre(financier.targetHighPrice),
      recommandation: texte(financier.recommendationKey),
      nombre: nombre(financier.numberOfAnalystOpinions),
      tendance: actuelle
        ? {
            fortAchat: nombre(actuelle.strongBuy) ?? 0,
            achat: nombre(actuelle.buy) ?? 0,
            conserver: nombre(actuelle.hold) ?? 0,
            vente: nombre(actuelle.sell) ?? 0,
            forteVente: nombre(actuelle.strongSell) ?? 0,
          }
        : undefined,
    },
    resultats: {
      prochaineDate: Array.isArray(datesResultats) ? dateDe(datesResultats[0]) : undefined,
      trimestres: trimestres.map(trimestre => ({
        periode: texte(trimestre.date) ?? '',
        reel: nombre(trimestre.actual),
        estime: nombre(trimestre.estimate),
      })),
      estimations: estimations.map(estimation => ({
        periode: texte(estimation.period) ?? '',
        fin: texte(estimation.endDate),
        bpa: nombre(objet(estimation.earningsEstimate).avg),
        ca: nombre(objet(estimation.revenueEstimate).avg),
        croissance: nombre(estimation.growth),
      })),
    },
    actionnaires: {
      inities: nombre(detenteurs.insidersPercentHeld),
      institutions: nombre(detenteurs.institutionsPercentHeld),
      nombreInstitutions: nombre(detenteurs.institutionsCount),
      principaux: (Array.isArray(institutions.ownershipList) ? institutions.ownershipList : [])
        .map(objet)
        .map(ligne => ({
          nom: texte(ligne.organization) ?? '—',
          part: nombre(ligne.pctHeld),
          actions: nombre(ligne.position),
          valeur: nombre(ligne.value),
          date: dateDe(ligne.reportDate),
        })),
    },
    transactionsInities: (Array.isArray(inities.transactions) ? inities.transactions : [])
      .map(objet)
      .map(ligne => ({
        nom: texte(ligne.filerName) ?? '—',
        fonction: texte(ligne.filerRelation),
        texte: texte(ligne.transactionText),
        actions: nombre(ligne.shares),
        valeur: nombre(ligne.value),
        date: dateDe(ligne.startDate),
      })),
  };
}

// ------------------------------------------------------- Comptes annuels

export function lireComptes(json: unknown): Comptes {
  const resultats = objet(objet(json).timeseries).result;
  const comptes: Comptes = {};
  if (!Array.isArray(resultats)) {
    return comptes;
  }
  for (const bloc of resultats.map(objet)) {
    const type = objet(bloc.meta).type;
    const nom = Array.isArray(type) ? texte(type[0]) : texte(type);
    if (!nom?.startsWith('annual')) {
      continue;
    }
    const poste = nom.slice('annual'.length) as Poste;
    const valeurs = bloc[nom];
    if (!Array.isArray(valeurs)) {
      continue;
    }
    const points = valeurs
      .map(objet)
      .map(point => ({ date: texte(point.asOfDate) ?? '', valeur: nombre(point.reportedValue) }))
      .filter((point): point is PointAnnuel => Boolean(point.date) && point.valeur !== null)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    if (points.length > 0) {
      comptes[poste] = points;
    }
  }
  return comptes;
}

// ------------------------------------------------ Cours et dividendes

export function lireCoursEtDividendes(json: unknown): CoursEtDividendes {
  const graphique = objet(objet(json).chart);
  const resultat = objet(Array.isArray(graphique.result) ? graphique.result[0] : undefined);
  const horodatages = Array.isArray(resultat.timestamp) ? resultat.timestamp : [];
  const series = objet(resultat.indicators).quote;
  const quotes = objet(Array.isArray(series) ? series[0] : undefined);
  const clotures = Array.isArray(quotes.close) ? quotes.close : [];

  const cours: CoursEtDividendes['cours'] = [];
  horodatages.forEach((instant, index) => {
    const date = dateDe(instant);
    const cloture = clotures[index];
    if (date && typeof cloture === 'number' && Number.isFinite(cloture) && cloture > 0) {
      cours.push({ date, cloture });
    }
  });

  const evenements = objet(objet(resultat.events).dividends);
  const dividendes = Object.values(evenements)
    .map(objet)
    .map(ligne => ({ date: dateDe(ligne.date) ?? '', montant: nombre(ligne.amount) }))
    .filter((ligne): ligne is { date: string; montant: number } => Boolean(ligne.date) && ligne.montant !== null)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  return { cours, dividendes };
}

// ---------------------------------------------------------- Chargement

export interface DonneesValeur {
  fiche: Fiche;
  comptes: Comptes;
  historique: CoursEtDividendes;
  /** Parties qui n'ont pas pu être chargées, avec leur motif. */
  manques: string[];
}

/**
 * Charge tout ce que la fiche affiche.
 *
 * Seul le résumé est indispensable ; les comptes et l'historique peuvent
 * manquer sans empêcher d'afficher le reste.
 */
export async function chargerValeur(
  symbole: string,
  recuperer: Recuperer = fetch as unknown as Recuperer,
  maintenant: Date = new Date(),
): Promise<DonneesValeur> {
  const code = encodeURIComponent(symbole);
  const fin = Math.floor(maintenant.getTime() / 1000);
  const debut = fin - 16 * 365 * 86_400;

  const [resume, comptes, historique] = await Promise.allSettled([
    lireJson(`${BASE}/v10/finance/quoteSummary/${code}?modules=${MODULES.join(',')}`, recuperer),
    lireJson(
      `${BASE}/ws/fundamentals-timeseries/v1/finance/timeseries/${code}?type=${POSTES.map(poste => `annual${poste}`).join(',')}&period1=${debut}&period2=${fin}`,
      recuperer,
    ),
    lireJson(`${BASE}/v8/finance/chart/${code}?range=10y&interval=1wk&events=div`, recuperer),
  ]);

  if (resume.status === 'rejected') {
    throw resume.reason instanceof Error ? resume.reason : new ErreurDonnees(String(resume.reason));
  }

  const manques: string[] = [];
  const motif = (resultat: PromiseRejectedResult) =>
    resultat.reason instanceof Error ? resultat.reason.message : String(resultat.reason);
  if (comptes.status === 'rejected') {
    manques.push(`Comptes annuels : ${motif(comptes)}`);
  }
  if (historique.status === 'rejected') {
    manques.push(`Historique des cours : ${motif(historique)}`);
  }

  return {
    fiche: lireFiche(symbole, resume.value),
    comptes: comptes.status === 'fulfilled' ? lireComptes(comptes.value) : {},
    historique:
      historique.status === 'fulfilled' ? lireCoursEtDividendes(historique.value) : { cours: [], dividendes: [] },
    manques,
  };
}
