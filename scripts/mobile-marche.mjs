/**
 * Faux « marché » du Portefeuille pour les essais en émulation (aucune sortie réseau) :
 * les requêtes vers Yahoo Finance (cours, historique, recherche de symboles) reçoivent une série
 * déterministe (marche aléatoire à graine fixe, jours ouvrés), de quoi remplir les graphiques.
 */

const BASES = { 'AI.PA': 160, 'CW8.PA': 470, 'TTE.PA': 58, 'STLAP.PA': 14, 'EURUSD=X': 1.08, 'USDEUR=X': 0.93 };
const NOMS = { 'AI.PA': 'Air Liquide', 'CW8.PA': 'Amundi MSCI World UCITS ETF', 'TTE.PA': 'TotalEnergies', 'STLAP.PA': 'Stellantis' };

function graine(texte) {
  let h = 2166136261;
  for (const c of texte) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

function aleatoire(g) {
  let e = g;
  return () => {
    e = (Math.imul(e, 1664525) + 1013904223) >>> 0;
    return e / 4294967296;
  };
}

/** Série de clôtures quotidiennes (jours ouvrés) jusqu'à aujourd'hui. */
export function serie(symbole, jours) {
  const base = BASES[symbole] ?? 50 + (graine(symbole) % 100);
  const alea = aleatoire(graine(symbole));
  const points = [];
  const fin = new Date();
  fin.setUTCHours(12, 0, 0, 0);
  const total = Math.ceil(jours * 1.45) + 5;
  let cours = base * 0.8;
  const serieBrute = [];
  for (let i = total; i >= 0; i--) {
    const jour = new Date(fin.getTime() - i * 86_400_000);
    if (jour.getUTCDay() === 0 || jour.getUTCDay() === 6) continue;
    cours *= 1 + (alea() - 0.47) * 0.022;
    serieBrute.push([Math.floor(jour.getTime() / 1000), cours]);
  }
  // Recale la dernière clôture sur la base.
  const facteur = base / serieBrute[serieBrute.length - 1][1];
  for (const [t, c] of serieBrute) points.push([t, Number((c * facteur).toFixed(4))]);
  return points;
}

const PLAGES = { '1d': 1, '5d': 6, '1mo': 31, '3mo': 92, '6mo': 183, '1y': 366, '2y': 731, '5y': 1826, '10y': 3652, max: 1826, ytd: 300 };

export function repondreYahoo(url) {
  const u = new URL(url);
  if (u.pathname.startsWith('/v1/finance/search')) {
    const q = (u.searchParams.get('q') ?? '').toLowerCase();
    const quotes = Object.entries(NOMS)
      .filter(([s, n]) => s.toLowerCase().includes(q) || n.toLowerCase().includes(q) || q.length === 0)
      .map(([symbol, shortname]) => ({ symbol, shortname, exchange: 'PAR', quoteType: symbol === 'CW8.PA' ? 'ETF' : 'EQUITY', currency: 'EUR' }));
    return { quotes };
  }
  const m = /\/v8\/finance\/chart\/([^/?]+)/.exec(u.pathname);
  if (m) {
    const symbole = decodeURIComponent(m[1]);
    const jours = PLAGES[u.searchParams.get('range') ?? '1y'] ?? 366;
    const points = serie(symbole, jours);
    const dernier = points[points.length - 1];
    return {
      chart: {
        result: [
          {
            meta: { symbol: symbole, currency: symbole.endsWith('=X') ? 'EUR' : 'EUR', regularMarketPrice: dernier[1], regularMarketTime: dernier[0], chartPreviousClose: points[points.length - 2]?.[1] ?? dernier[1], longName: NOMS[symbole] ?? symbole },
            timestamp: points.map(p => p[0]),
            indicators: { quote: [{ close: points.map(p => p[1]) }] },
          },
        ],
        error: null,
      },
    };
  }
  return {};
}

/** Détourne Yahoo Finance vers le faux marché. */
export async function simulerMarche(contexte) {
  await contexte.route(url => /(^|\.)finance\.yahoo\.com$/.test(url.hostname), async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(repondreYahoo(route.request().url())), headers: { 'access-control-allow-origin': '*' } });
  });
}

/** Opérations d'un portefeuille d'essai (modèle générique). */
export const OPERATIONS_ESSAI = [
  'date,operation,libelle,isin,ticker,quantite,prix_unitaire,montant,frais,devise',
  '2024-03-04,versement,Virement initial,,,,,15000,,EUR',
  '2024-03-06,achat,Amundi MSCI World,LU1681043599,CW8.PA,12,420.50,,1,EUR',
  '2024-03-06,achat,Air Liquide,FR0000120073,AI.PA,20,168.20,,1.5,EUR',
  '2024-06-12,versement,Virement,,,,,3000,,EUR',
  '2024-06-14,achat,TotalEnergies,FR0000120271,TTE.PA,30,61.40,,1.2,EUR',
  '2024-09-02,dividende,Air Liquide,FR0000120073,AI.PA,,,31.00,,EUR',
  '2025-01-15,achat,Stellantis,NL00150001Q9,STLAP.PA,100,12.80,,2,EUR',
  '2025-03-10,vente,TotalEnergies,FR0000120271,TTE.PA,10,63.10,,1,EUR',
  '2025-05-20,dividende,TotalEnergies,FR0000120271,TTE.PA,,,42.30,,EUR',
  '2025-09-03,achat,Amundi MSCI World,LU1681043599,CW8.PA,6,455.00,,1,EUR',
  '2026-01-12,versement,Virement,,,,,2000,,EUR',
].join('\n');

/**
 * Le site de secours passe par la passerelle du relais, qui appelle Yahoo depuis le serveur (ici, le
 * même processus que le test) : on intercepte ce `fetch` sortant.
 */
export function simulerMarcheServeur() {
  const vrai = globalThis.fetch;
  if (vrai.__fauxMarche) return;
  const faux = async (entree, options) => {
    const url = typeof entree === 'string' ? entree : (entree.url ?? String(entree));
    if (/^https:\/\/query[12]\.finance\.yahoo\.com\//.test(url)) {
      return new Response(JSON.stringify(repondreYahoo(url)), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return vrai(entree, options);
  };
  faux.__fauxMarche = true;
  globalThis.fetch = faux;
}
