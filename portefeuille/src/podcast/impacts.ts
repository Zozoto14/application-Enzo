/**
 * Ce qu'une actualité change pour votre portefeuille.
 *
 * On ne prédit rien : personne ne sait si le S&P 500 montera demain. On
 * explique en revanche le lien, vérifiable, entre une nouvelle et vos
 * lignes — Apple pèse tant dans le MSCI World que vous détenez, une baisse
 * des taux soutient en général les actions, un dollar fort gonfle en euros
 * vos actifs américains. Les poids sont des ordres de grandeur (2025),
 * annoncés comme tels : ils bougent avec les cours.
 */

import type { ArticleMedia } from './medias';

export type CleIndice = 'sp500' | 'msci-world' | 'nasdaq100' | 'cac40' | 'eurostoxx50' | 'emergents';

const NOMS_INDICES: Record<CleIndice, string> = {
  sp500: 'S&P 500',
  'msci-world': 'MSCI World',
  nasdaq100: 'Nasdaq 100',
  cac40: 'CAC 40',
  eurostoxx50: 'Euro Stoxx 50',
  emergents: 'MSCI Emerging Markets',
};

interface Entreprise {
  nom: string;
  motif: RegExp;
  /** Poids approximatif dans chaque indice, en %. */
  poids: Partial<Record<CleIndice, number>>;
}

/** Les plus grosses capitalisations, celles qui font bouger les indices. */
const ENTREPRISES: readonly Entreprise[] = [
  { nom: 'Nvidia', motif: /\bnvidia\b/i, poids: { sp500: 7, 'msci-world': 5, nasdaq100: 9 } },
  { nom: 'Apple', motif: /\bapple\b|\biphone\b/i, poids: { sp500: 6, 'msci-world': 4.5, nasdaq100: 8 } },
  { nom: 'Microsoft', motif: /\bmicrosoft\b/i, poids: { sp500: 6, 'msci-world': 4.5, nasdaq100: 8 } },
  { nom: 'Amazon', motif: /\bamazon\b/i, poids: { sp500: 4, 'msci-world': 2.8, nasdaq100: 5.5 } },
  { nom: 'Alphabet', motif: /\balphabet\b|\bgoogle\b/i, poids: { sp500: 4, 'msci-world': 2.5, nasdaq100: 5 } },
  { nom: 'Meta', motif: /\bmeta\b|\bfacebook\b/i, poids: { sp500: 3, 'msci-world': 2, nasdaq100: 3.5 } },
  { nom: 'Broadcom', motif: /\bbroadcom\b/i, poids: { sp500: 2.5, 'msci-world': 1.6, nasdaq100: 5 } },
  { nom: 'Tesla', motif: /\btesla\b/i, poids: { sp500: 2, 'msci-world': 1.3, nasdaq100: 3 } },
  { nom: 'TSMC', motif: /\btsmc\b|\btaiwan semiconductor\b/i, poids: { emergents: 10 } },
  { nom: 'Tencent', motif: /\btencent\b/i, poids: { emergents: 5 } },
  { nom: 'LVMH', motif: /\blvmh\b/i, poids: { cac40: 9, eurostoxx50: 4 } },
  { nom: 'Schneider Electric', motif: /\bschneider\b/i, poids: { cac40: 8, eurostoxx50: 3.5 } },
  { nom: 'TotalEnergies', motif: /\btotal ?energies\b/i, poids: { cac40: 7, eurostoxx50: 3.5 } },
  { nom: 'Airbus', motif: /\bairbus\b/i, poids: { cac40: 6, eurostoxx50: 3 } },
  { nom: 'Air Liquide', motif: /\bair liquide\b/i, poids: { cac40: 6, eurostoxx50: 2.5 } },
  { nom: 'Sanofi', motif: /\bsanofi\b/i, poids: { cac40: 6, eurostoxx50: 3 } },
  { nom: 'L’Oréal', motif: /\bl[’']or[ée]al\b/i, poids: { cac40: 5, eurostoxx50: 2.5 } },
  { nom: 'Safran', motif: /\bsafran\b/i, poids: { cac40: 5, eurostoxx50: 2.5 } },
  { nom: 'Hermès', motif: /\bherm[èe]s\b/i, poids: { cac40: 4, eurostoxx50: 2 } },
  { nom: 'BNP Paribas', motif: /\bbnp\b/i, poids: { cac40: 4, eurostoxx50: 2 } },
  { nom: 'ASML', motif: /\basml\b/i, poids: { eurostoxx50: 7 } },
  { nom: 'SAP', motif: /\bsap\b/, poids: { eurostoxx50: 7 } },
];

interface Theme {
  motif: RegExp;
  /** Phrase dite quand vous avez des actions ; prudente par construction. */
  phrase: (expose: ExpositionPortefeuille) => string | undefined;
}

export interface LigneExposee {
  nom: string;
  /** Poids de la ligne dans vos titres, en %. */
  poids: number;
}

export interface ExpositionPortefeuille {
  /** Lignes qui répliquent un indice, par indice. */
  indices: Map<CleIndice, LigneExposee[]>;
  lignes: readonly LigneExposee[];
  /** Part des titres exposée aux États-Unis, en % (approximation). */
  partAmericaine: number;
}

const THEMES: readonly Theme[] = [
  {
    motif: /\b(bce|fed|r[ée]serve f[ée]d[ée]rale|banque centrale|taux directeurs?|interest rates?|rate cut|rate hike)\b/i,
    phrase: () =>
      'Les taux des banques centrales comptent pour toutes vos actions : en général, une baisse les soutient et une hausse les freine, surtout les valeurs de croissance.',
  },
  {
    motif: /\b(p[ée]trole|brent|baril|opep|oil prices?|crude)\b/i,
    phrase: expose =>
      expose.lignes.some(ligne => /total/i.test(ligne.nom))
        ? 'Le prix du pétrole fait bouger directement TotalEnergies, que vous détenez.'
        : 'Le pétrole pèse surtout sur les pétrolières et sur les coûts des industriels et des transporteurs.',
  },
  {
    motif: /\b(inflation|prix à la consommation|cpi)\b/i,
    phrase: () =>
      'Une inflation plus basse que prévu éloigne les hausses de taux, ce que les marchés d’actions accueillent en général bien ; plus haute, l’effet inverse.',
  },
  {
    motif: /\b(dollar|euro-dollar|eur\/usd|greenback)\b/i,
    phrase: expose =>
      expose.partAmericaine >= 20
        ? `Environ ${Math.round(expose.partAmericaine)} % de vos titres sont investis aux États-Unis : un dollar plus fort gonfle leur valeur en euros, un dollar plus faible la réduit.`
        : undefined,
  },
  {
    motif: /\b(droits de douane|tarifs douaniers|tariffs?|guerre commerciale|trade war)\b/i,
    phrase: () =>
      'Les droits de douane touchent d’abord les exportateurs : automobile, luxe, industrie. Les marchés y réagissent souvent vite, dans un sens comme dans l’autre.',
  },
  {
    motif: /\b(intelligence artificielle|\bia\b|artificial intelligence|\bai\b|semi-?conducteurs?|chips?)\b/i,
    phrase: expose =>
      expose.indices.has('nasdaq100') || expose.indices.has('sp500') || expose.indices.has('msci-world')
        ? 'L’intelligence artificielle porte les géants de la tech, qui forment une grosse part des indices américains et mondiaux que vous détenez.'
        : undefined,
  },
];

const POSITIF = /\b(bondit|grimpe|s[’']envole|record|progresse|hausse|d[ée]passe|relève|beats?|jumps?|surges?|rall(y|ies)|soars?|climbs?|gains?|raises? (its )?(guidance|outlook))\b/i;
const NEGATIF = /\b(chute|recule|baisse|plonge|d[ée][çc]oit|avertit|abaisse|lourde perte|falls?|drops?|slumps?|plunges?|misses|cuts? (its )?(guidance|outlook)|warns?)\b/i;

/** Sens d'un titre, à la louche : sert seulement à tourner la phrase. */
export function tonalite(texte: string): 'positive' | 'negative' | 'neutre' {
  const plus = POSITIF.test(texte);
  const moins = NEGATIF.test(texte);
  return plus && !moins ? 'positive' : moins && !plus ? 'negative' : 'neutre';
}

/** Quel indice une ligne réplique-t-elle ? D'après son nom. */
export function indiceDeLigne(nom: string): CleIndice | undefined {
  const n = nom.toLowerCase();
  if (/emerging|[ée]mergents?/.test(n)) return 'emergents';
  if (/msci ?world|world/.test(n)) return 'msci-world';
  if (/nasdaq/.test(n)) return 'nasdaq100';
  if (/s ?& ?p ?500|sp ?500|s&p/.test(n)) return 'sp500';
  if (/cac ?40/.test(n)) return 'cac40';
  if (/euro ?stoxx ?50|stoxx ?50/.test(n)) return 'eurostoxx50';
  return undefined;
}

/** Part américaine approximative de chaque indice, en %. */
const PART_AMERICAINE: Record<CleIndice, number> = {
  sp500: 100,
  nasdaq100: 100,
  'msci-world': 70,
  cac40: 0,
  eurostoxx50: 0,
  emergents: 0,
};

export function expositionDe(lignes: readonly LigneExposee[]): ExpositionPortefeuille {
  const indices = new Map<CleIndice, LigneExposee[]>();
  let partAmericaine = 0;
  for (const ligne of lignes) {
    const indice = indiceDeLigne(ligne.nom);
    if (indice) {
      indices.set(indice, [...(indices.get(indice) ?? []), ligne]);
      partAmericaine += (ligne.poids * PART_AMERICAINE[indice]) / 100;
    }
  }
  return { indices, lignes, partAmericaine };
}

const pct = (valeur: number) => `${valeur.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} pour cent`;

/**
 * « Pour vous » : une ou deux phrases qui relient l'article à vos lignes,
 * ou `undefined` si l'article ne vous concerne pas de façon identifiable.
 */
export function impactPourVous(article: ArticleMedia, expose: ExpositionPortefeuille): string | undefined {
  const texte = `${article.titre} ${article.resume}`;
  const phrases: string[] = [];

  const entreprise = ENTREPRISES.find(candidate => candidate.motif.test(texte));
  if (entreprise) {
    const detenue = expose.lignes.find(ligne => entreprise.motif.test(ligne.nom));
    const sens = tonalite(texte);
    if (detenue) {
      phrases.push(
        `Vous détenez ${entreprise.nom} en direct, pour ${pct(detenue.poids)} de vos titres : ${
          sens === 'positive'
            ? 'une nouvelle plutôt favorable pour cette ligne.'
            : sens === 'negative'
              ? 'une nouvelle qui peut peser sur cette ligne.'
              : 'une nouvelle à suivre de près.'
        }`,
      );
    }
    for (const [indice, lignes] of expose.indices) {
      const poids = entreprise.poids[indice];
      if (!poids) continue;
      const exposition = (lignes.reduce((total, ligne) => total + ligne.poids, 0) * poids) / 100;
      phrases.push(
        `${entreprise.nom} pèse environ ${pct(poids)} du ${NOMS_INDICES[indice]}, que vous détenez via ${lignes[0].nom} : ${
          sens === 'positive'
            ? `si le titre en profite, votre ligne en profite un peu aussi, à hauteur d’environ ${pct(exposition)} de vos titres.`
            : sens === 'negative'
              ? `si le titre recule, votre ligne le ressent un peu, à hauteur d’environ ${pct(exposition)} de vos titres.`
              : `cela représente environ ${pct(exposition)} de vos titres.`
        }`,
      );
      break;
    }
  }

  if (phrases.length === 0) {
    for (const theme of THEMES) {
      if (theme.motif.test(texte)) {
        const phrase = theme.phrase(expose);
        if (phrase) {
          phrases.push(phrase);
          break;
        }
      }
    }
  }

  return phrases.length > 0 ? `Pour vous : ${phrases.join(' ')}` : undefined;
}
