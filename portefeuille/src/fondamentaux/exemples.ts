/**
 * Réponses Yahoo Finance d'exemple, à la forme des vraies, pour les tests et
 * l'aperçu de développement. Les chiffres sont inventés.
 */

const r = (raw: number) => ({ raw, fmt: String(raw) });

export const RESUME_EXEMPLE = {
  quoteSummary: {
    result: [
      {
        price: {
          longName: 'Exemple Industries SA',
          currency: 'EUR',
          exchangeName: 'Paris',
          regularMarketPrice: r(52.4),
          regularMarketChangePercent: r(0.0125),
          marketCap: r(48_000_000_000),
        },
        summaryDetail: {
          trailingPE: r(18.2),
          forwardPE: r(15.9),
          dividendYield: r(0.031),
          dividendRate: r(1.62),
          payoutRatio: r(0.52),
          fiftyTwoWeekHigh: r(58.1),
          fiftyTwoWeekLow: r(41.3),
          beta: r(1.08),
          averageVolume: r(1_250_000),
          priceToSalesTrailing12Months: r(1.9),
          exDividendDate: r(1_780_000_000),
          fiveYearAvgDividendYield: 2.8,
        },
        defaultKeyStatistics: {
          priceToBook: r(2.4),
          enterpriseToEbitda: r(9.8),
          enterpriseToRevenue: r(2.1),
          pegRatio: r(1.6),
          enterpriseValue: r(55_000_000_000),
          sharesOutstanding: r(916_000_000),
          trailingEps: r(2.88),
          forwardEps: r(3.3),
        },
        financialData: {
          currentPrice: r(52.4),
          targetLowPrice: r(45),
          targetMeanPrice: r(60),
          targetHighPrice: r(72),
          recommendationKey: 'buy',
          numberOfAnalystOpinions: r(21),
          grossMargins: r(0.41),
          operatingMargins: r(0.17),
          profitMargins: r(0.11),
          ebitdaMargins: r(0.22),
          returnOnEquity: r(0.14),
          returnOnAssets: r(0.06),
          totalDebt: r(12_000_000_000),
          totalCash: r(5_000_000_000),
          debtToEquity: r(62.5),
          currentRatio: r(1.3),
          quickRatio: r(0.9),
          freeCashflow: r(2_600_000_000),
          operatingCashflow: r(4_100_000_000),
          revenueGrowth: r(0.052),
          earningsGrowth: r(0.08),
        },
        assetProfile: {
          sector: 'Industrials',
          industry: 'Specialty Industrial Machinery',
          country: 'France',
          city: 'Paris',
          website: 'https://example.com',
          fullTimeEmployees: 64000,
          longBusinessSummary: 'Exemple Industries designs and manufactures industrial equipment.',
        },
        calendarEvents: {
          earnings: { earningsDate: [r(1_793_000_000)] },
          dividendDate: r(1_781_000_000),
        },
        earnings: {
          earningsChart: {
            quarterly: [
              { date: '3Q2025', actual: r(0.71), estimate: r(0.68) },
              { date: '4Q2025', actual: r(0.66), estimate: r(0.7) },
            ],
          },
        },
        earningsTrend: {
          trend: [
            { period: '0y', endDate: '2026-12-31', growth: r(0.09), earningsEstimate: { avg: r(3.1) }, revenueEstimate: { avg: r(26_000_000_000) } },
            { period: '+1y', endDate: '2027-12-31', growth: r(0.07), earningsEstimate: { avg: r(3.3) }, revenueEstimate: { avg: r(27_500_000_000) } },
          ],
        },
        recommendationTrend: {
          trend: [{ period: '0m', strongBuy: 6, buy: 9, hold: 5, sell: 1, strongSell: 0 }],
        },
        majorHoldersBreakdown: {
          insidersPercentHeld: r(0.012),
          institutionsPercentHeld: r(0.47),
          institutionsCount: r(812),
        },
        institutionOwnership: {
          ownershipList: [
            { organization: 'Fonds A', pctHeld: r(0.061), position: r(55_000_000), value: r(2_880_000_000), reportDate: r(1_778_000_000) },
            { organization: 'Fonds B', pctHeld: r(0.034), position: r(31_000_000), value: r(1_620_000_000), reportDate: r(1_778_000_000) },
          ],
        },
        insiderTransactions: {
          transactions: [
            { filerName: 'Dupont Jean', filerRelation: 'Chief Executive Officer', transactionText: 'Sale at price 55.10', shares: r(20000), value: r(1_102_000), startDate: r(1_776_000_000) },
          ],
        },
      },
    ],
    error: null,
  },
};

function annuel(type: string, valeurs: number[]) {
  return {
    meta: { type: [type], symbol: ['EXA.PA'] },
    timestamp: valeurs.map((_, i) => 1_577_750_400 + i * 31_536_000),
    [type]: valeurs.map((valeur, i) => ({
      asOfDate: `${2019 + i}-12-31`,
      periodType: '12M',
      currencyCode: 'EUR',
      reportedValue: r(valeur),
    })),
  };
}

export const COMPTES_EXEMPLE = {
  timeseries: {
    result: [
      annuel('annualTotalRevenue', [19e9, 17.5e9, 20.2e9, 22.4e9, 23.8e9, 24.9e9, 25.3e9]),
      annuel('annualGrossProfit', [7.6e9, 6.9e9, 8.1e9, 9.1e9, 9.8e9, 10.2e9, 10.4e9]),
      annuel('annualOperatingIncome', [3e9, 2.4e9, 3.2e9, 3.8e9, 4.1e9, 4.3e9, 4.3e9]),
      annuel('annualNetIncome', [1.9e9, 1.3e9, 2e9, 2.4e9, 2.6e9, 2.7e9, 2.8e9]),
      annuel('annualDilutedEPS', [2.05, 1.41, 2.18, 2.6, 2.83, 2.94, 3.05]),
      annuel('annualDilutedAverageShares', [927e6, 922e6, 918e6, 923e6, 919e6, 918e6, 916e6]),
      annuel('annualFreeCashFlow', [1.8e9, 1.9e9, 2e9, 2.2e9, 2.4e9, 2.5e9, 2.6e9]),
      annuel('annualTotalDebt', [11e9, 12.5e9, 12e9, 11.8e9, 12.2e9, 12.1e9, 12e9]),
      annuel('annualCashAndCashEquivalents', [3e9, 4.2e9, 4e9, 4.5e9, 4.7e9, 4.9e9, 5e9]),
      annuel('annualStockholdersEquity', [16e9, 16.2e9, 17e9, 17.9e9, 18.6e9, 19.1e9, 19.2e9]),
      annuel('annualCashDividendsPaid', [-1.1e9, -0.9e9, -1.2e9, -1.3e9, -1.4e9, -1.45e9, -1.5e9]),
    ],
  },
};

export function historiqueExemple(): unknown {
  const debut = 1_600_000_000;
  const semaines = 300;
  const timestamp = Array.from({ length: semaines }, (_, i) => debut + i * 604_800);
  const close = timestamp.map((_, i) => 38 + i * 0.05 + Math.sin(i / 8) * 3);
  const dividends: Record<string, unknown> = {};
  for (let annee = 0; annee < 5; annee++) {
    const date = debut + (annee * 52 + 20) * 604_800;
    dividends[String(date)] = { amount: 1.2 + annee * 0.1, date };
  }
  return { chart: { result: [{ timestamp, indicators: { quote: [{ close }] }, events: { dividends } }] } };
}
