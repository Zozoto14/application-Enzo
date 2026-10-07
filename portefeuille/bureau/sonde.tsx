/**
 * Aperçu de l'application sur poste fixe.
 *
 * Elle répond à une question de disposition, pas de données : les écrans
 * écrits pour l'iPhone tiennent-ils dans une coque de bureau — barre latérale
 * permanente, contenu en colonnes ? Elle monte donc le portefeuille avec des
 * valeurs en mémoire, sans base ni chiffrement.
 */

import '@fontsource/manrope/400.css';
import '@fontsource/manrope/500.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/manrope/800.css';
import '@fontsource/fraunces/400.css';
import '@fontsource/fraunces/500.css';
import '@fontsource/fraunces/600.css';
import '@fontsource/dm-serif-display/400.css';
import React, { useState } from 'react';
import { useColorScheme } from 'react-native';
import { createRoot } from 'react-dom/client';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { d } from '../src/core/money/decimal';
import { rejouer } from '../src/core/portfolio/engine';
import { serieValorisation, type CoursDate } from '../src/core/performance/serie';
import { achat, compte, dividende, titre, versement } from '../src/core/testing/fixtures';
import { construireComparaison } from '../src/ui/vues/comparaison';
import { construireComparateur } from '../src/ui/vues/comparateur';
import { construireDashboard } from '../src/ui/vues/dashboard';
import { construireDividendes } from '../src/ui/vues/dividendes';
import { construireFlux, construireImpots, construirePerformance } from '../src/ui/vues/onglets';
import { CHAMPS_DEFAUT, construireProjection } from '../src/ui/vues/projection';
import { construireRisque } from '../src/ui/vues/risque';
import { construireWatchlist } from '../src/ui/vues/watchlist';
import { construireResume } from '../src/ui/vues/resume';
import { INDICES } from '../src/cours/indices';
import { COMPTES_EXEMPLE, RESUME_EXEMPLE, historiqueExemple } from '../src/fondamentaux/exemples';
import { lireComptes, lireCoursEtDividendes, lireFiche } from '../src/fondamentaux/yahoo';
import { construireFiche } from '../src/ui/vues/fiche';
import { FicheValeur } from '../src/ui/ecrans/FicheValeur';
import { ComparateurFinancier } from '../src/ui/ecrans/ComparateurFinancier';
import { Comparateur } from '../src/ui/ecrans/Comparateur';
import { Portefeuille } from '../src/ui/ecrans/Portefeuille';
import { Projection } from '../src/ui/ecrans/Projection';
import { Watchlist } from '../src/ui/ecrans/Watchlist';
import { Recherche } from '../src/ui/ecrans/Recherche';
import { Screener } from '../src/ui/ecrans/Screener';
import type { ResultatTheses } from '../src/fondamentaux/theses';
import { useFondDocument } from './Bureau';
import { definirDiscretion } from '../src/ui/discretion';
import { Objectifs } from '../src/ui/ecrans/Objectifs';
import { definirTheme } from '../src/ui/theme';
import { LecteurFlottant } from '../src/ui/lecturePodcast';
import { Coque, type Destination } from '../src/ui/Navigation';
import { Podcast } from '../src/ui/ecrans/Podcast';
import { construireEpisode } from '../src/podcast/episode';

// ------------------------------------------------------------ Jeu d'essai

const pea = compte();
const airLiquide = titre();
const monde = titre({
  id: 'cw8',
  isin: 'LU1681043599',
  nom: 'Amundi MSCI World',
  ticker: 'CW8.PA',
  secteur: 'Diversifié',
});

const transactions = [
  versement('2024-10-01', 20000),
  achat('2024-10-05', 42, 157.1, 5),
  achat('2024-10-05', 17, 620, 5, { titreId: 'cw8' }),
  dividende('2025-05-15', 198.4),
  dividende('2026-05-15', 211.2),
];

const etat = rejouer([pea], transactions);
const comptes = [pea];
const titres = [airLiquide, monde];
const cours = new Map([
  ['air-liquide', d('177')],
  ['cw8', d('703.73')],
]);

/** Série quotidienne synthétique, pour que les mesures aient de quoi parler. */
function serie(depart: number, jours: number, amplitude: number): CoursDate[] {
  const points: CoursDate[] = [];
  for (let index = 0; index < jours; index++) {
    const date = new Date(2024, 9, 1 + index);
    points.push({
      date: date.toISOString().slice(0, 10),
      cloture: d(
        (depart * (1 + (index / jours) * 0.18 + Math.sin(index / 7) * amplitude)).toFixed(4),
      ),
    });
  }
  return points;
}

const historique = new Map<string, CoursDate[]>([
  ['air-liquide', serie(157, 260, 0.05)],
  ['cw8', serie(620, 260, 0.03)],
]);

const points = serieValorisation({ comptes: [pea], transactions, cours: historique });

/** Référence d'exemple, pour voir la seconde courbe. */
const referenceExemple = serie(100, 260, 0.02);

const DESTINATIONS: readonly Destination[] = [
  { cle: 'portefeuille', libelle: 'Portefeuille', glyphe: '▦' },
  { cle: 'recherche', libelle: 'Recherche', glyphe: '⌕' },
  { cle: 'screener', libelle: 'Screener', glyphe: '▤' },
  { cle: 'surveillance', libelle: 'Surveillance', glyphe: '★' },
  { cle: 'comparateur', libelle: 'Comparer', glyphe: '⇄' },
  { cle: 'projection', libelle: 'Projection', glyphe: '◔' },
  { cle: 'fiche', libelle: 'Fiche', glyphe: '◧' },
  { cle: 'podcast', libelle: 'Podcast', glyphe: '♫' },
  { cle: 'objectifs', libelle: 'Objectifs', glyphe: '◎' },
];

const episodeExemple = construireEpisode({
  aujourdhui: '2025-06-17',
  valeurTotale: 19000,
  totalReturn: 1450,
  totalReturnPct: 8.3,
  seance: { montant: 112, pourcentage: 0.6 },
  lignes: [
    { nom: 'Amundi MSCI World', variationJour: 0.8, latentPct: 12.4, poids: 58 },
    { nom: 'Air Liquide', variationJour: 1.9, latentPct: 21, poids: 24 },
    { nom: 'Stellantis', variationJour: -2.3, latentPct: -17.5, poids: 18 },
  ],
  valeurs: [
    {
      nom: 'Air Liquide',
      actualites: [
        { titre: 'Air Liquide signe un contrat d’hydrogène en Allemagne', source: 'Les Echos', date: '2025-06-16', langue: 'fr' },
        { titre: 'Air Liquide shares rise after new hydrogen deal', source: 'Reuters', date: '2025-06-16', langue: 'en' },
      ],
      consensus: 'Achat',
      objectifMoyen: 195,
      cours: 178,
      devise: 'EUR',
      prochainsResultats: '2025-07-29',
    },
  ],
  indices: [
    { nom: 'CAC 40', seancePct: 0.4 },
    { nom: 'S&P 500', seancePct: -0.2 },
  ],
  actualitesMarche: [{ titre: 'La BCE maintient ses taux', source: 'Boursorama', date: '2025-06-17', langue: 'fr' }],
  sujet: { titre: 'Le PRU', court: 'Le prix de revient unitaire.', detail: 'Il inclut les frais d’achat.' },
  presse: [
    { titre: 'La BCE laisse ses taux inchangés et reste prudente', resume: 'L’institution de Francfort maintient son taux de dépôt. Elle surveille une inflation qui reflue lentement.', source: 'Les Echos', date: '2025-06-17', langue: 'fr', lien: 'https://www.lesechos.fr' },
    { titre: 'Le luxe marque le pas en Chine', resume: 'Les ventes des grandes maisons ralentissent au deuxième trimestre. Les investisseurs guettent les résultats de LVMH.', source: 'Le Monde', date: '2025-06-17', langue: 'fr' },
    { titre: 'Le pétrole recule après la hausse des stocks américains', resume: 'Le baril de Brent perd près de deux pour cent. Les réserves ont augmenté plus que prévu.', source: 'Le Figaro', date: '2025-06-17', langue: 'fr' },
    { titre: 'L’inflation française ralentit en mai', resume: 'Les prix à la consommation progressent de 0,7 % sur un an selon l’Insee. L’énergie tire l’indice vers le bas.', source: 'franceinfo', date: '2025-06-17', langue: 'fr' },
    { titre: 'Nvidia tops $4 trillion as AI rally extends', resume: 'The chipmaker became the most valuable company in the world. Investors keep betting on AI spending.', source: 'CNBC', date: '2025-06-17', langue: 'en' },
    { titre: 'La BCE laisse ses taux inchangés, sans surprise', resume: 'Christine Lagarde reste prudente sur la suite.', source: 'Le Figaro', date: '2025-06-17', langue: 'fr' },
    { titre: 'Ce petit ETF va exploser en 2026, selon un analyste', resume: 'Un placement présenté comme sans risque.', source: 'bourse-express-gratuit.net', date: '2025-06-17', langue: 'fr' },
    { titre: 'Treasury yields slip ahead of Fed decision', resume: 'The 10-year yield fell to 4.3%. Traders expect rates to stay on hold.', source: 'MarketWatch', date: '2025-06-17', langue: 'en' },
  ],
  cibleMinutes: 10,
});

const ficheExemple = construireFiche(
  lireFiche('EXA.PA', RESUME_EXEMPLE),
  lireComptes(COMPTES_EXEMPLE),
  lireCoursEtDividendes(historiqueExemple()),
);

// Thèses d'exemple : l'aperçu ne va pas sur le réseau.
const thesesExemple = async (valeur: { nom: string }): Promise<ResultatTheses> => ({
  theses: [
    { titre: 'Jusqu’où peut aller Nvidia ?', resume: 'Les centres de données tirent la croissance, mais la valorisation suppose que la demande en puces IA reste soutenue plusieurs années.', source: 'Seeking Alpha', auteur: 'Julien M.', date: '2026-09-14', lien: 'https://seekingalpha.com', langue: 'en', genre: 'analyse', ton: 'optimiste', valeur: valeur.nom },
    { titre: 'Le maillon faible de l’IA', resume: 'Dépendance à TSMC, clients qui conçoivent leurs propres puces : les risques que le marché oublie.', source: 'Reddit · r/vosfinances', auteur: '/u/marc_antoine', date: '2026-08-27', langue: 'fr', genre: 'discussion', ton: 'prudent', valeur: valeur.nom },
    { titre: 'Faut-il encore acheter Nvidia après son record ?', resume: '', source: 'Investir', date: '2026-08-20', langue: 'fr', genre: 'presse', valeur: valeur.nom },
  ],
  actualites: [
    { titre: 'Nvidia dévoile sa nouvelle génération de puces', resume: '', source: 'Les Echos', date: '2026-09-20', langue: 'fr' },
  ],
  echecs: 0,
  sources: 5,
});

// ---------------------------------------------------------------- Aperçu

// Thème de l'aperçu : ?theme=ivoire, sauge…
definirTheme(new URLSearchParams(location.search).get('theme') ?? undefined);

function Apercu() {
  const sombre = useColorScheme() === 'dark';
  useFondDocument(sombre);

  const [destination, setDestination] = useState('portefeuille');
  const [discret, setDiscret] = useState(false);
  definirDiscretion(discret);
  const [compares, setCompares] = useState<readonly string[]>(['air-liquide', 'cw8']);
  const [champs, setChamps] = useState(CHAMPS_DEFAUT);

  return (
    <Coque destinations={DESTINATIONS} actif={destination} onNaviguer={setDestination} onVerrouiller={() => undefined} discret={discret} onBasculerDiscretion={() => setDiscret(!discret)} flottant={destination !== 'podcast' ? <LecteurFlottant onOuvrir={() => setDestination('podcast')} /> : null}>
      {destination === 'portefeuille' ? (
        <Portefeuille
          dashboard={construireDashboard({ etat, comptes, titres, cours })}
          resume={construireResume({
            etat,
            comptes,
            titres,
            transactions,
            cours,
            points,
            reference: { nom: 'S&P 500', serie: referenceExemple },
            aujourdhui: '2025-06-17',
          })}
          aujourdhui="2025-06-17"
          analyse={{
            etat,
            comptes,
            titres,
            transactions,
            cours,
            historique,
            points,
            indice: { nom: 'S&P 500', serie: referenceExemple },
            aujourdhui: '2025-06-17',
          }}
          optionsIndices={INDICES.map(indice => ({ valeur: indice.id, libelle: indice.nom }))}
          indiceActif={INDICES[0].id}
          onChoisirIndice={() => undefined}
          onAjouterTransaction={() => undefined}
          onImporter={() => undefined}
          onRafraichirCours={() => undefined}
          onReglages={() => undefined}
          performance={construirePerformance({ points, transactions })}
          comparaison={construireComparaison({ points, titres, historique })}
          dividendes={construireDividendes({
            etat,
            transactions,
            comptes,
            titres,
            cours,
            aujourdhui: '2026-09-25',
          })}
          risque={construireRisque({ etat, titres, cours, historique })}
          flux={construireFlux(transactions, comptes)}
          impots={construireImpots({
            etat,
            comptes,
            cessions: etat.cessions,
            aujourdhui: '2026-09-25',
            cours,
          })}
        />
      ) : null}

      {destination === 'fiche' ? (
        <FicheValeur
          symbole="EXA.PA"
          vue={ficheExemple}
          onRetour={() => setDestination('portefeuille')}
          onSurveiller={() => undefined}
        />
      ) : null}

      {destination === 'screener' ? (
        <Screener
          chargerScreener={async () => ({
            total: 51234,
            actions: [
              ['NVDA', 'NVIDIA Corporation', 225.07, 0.22, 5.45e12, 52.1, 40.2, 0.02, 'US'],
              ['AAPL', 'Apple Inc.', 262.3, -0.41, 5.0e12, 38.4, 55.1, 0.4, 'US'],
              ['MSFT', 'Microsoft Corporation', 505.1, 0.85, 3.83e12, 36.2, 11.3, 0.7, 'US'],
              ['TSM', 'Taiwan Semiconductor', 290.4, 1.9, 2.02e12, 28.7, 8.1, 1.1, 'TW'],
              ['MC.PA', 'LVMH Moët Hennessy', 612.4, -1.2, 3.05e11, 24.3, 5.2, 2.1, 'FR'],
            ].map(([symbole, nom, cours, variation, capitalisation, per, pb, rendement, pays]) => ({
              symbole: symbole as string, nom: nom as string, place: '', devise: symbole === 'MC.PA' ? 'EUR' : 'USD',
              cours: cours as number, variation: variation as number, capitalisation: capitalisation as number,
              per: per as number, prixSurActif: pb as number, rendement: rendement as number, pays: pays as string,
            })),
          })}
          surveilles={new Set(['NVDA'])}
          onSurveiller={() => undefined}
          onOuvrirFiche={() => undefined}
        />
      ) : null}

      {destination === 'recherche' ? (
        <Recherche
          onRechercher={async () => [
            { symbole: 'NVDA', nom: 'NVIDIA Corporation', place: 'NMS', devise: 'USD', type: 'EQUITY', paris: false },
            { symbole: 'NVD.DE', nom: 'NVIDIA Corporation', place: 'GER', devise: 'EUR', type: 'EQUITY', paris: false },
          ]}
          surveilles={new Set(['NVD.DE'])}
          onSurveiller={() => undefined}
          onOuvrirFiche={() => undefined}
          chargerTheses={thesesExemple}
        />
      ) : null}

      {destination === 'surveillance' ? (
        <Watchlist
          vue={construireWatchlist({
            watchlist: [
            { titreId: 'cw8', ajouteLe: '2025-03-12', coursAjout: d('612') },
            { titreId: 'air-liquide', ajouteLe: '2025-04-02', coursAjout: d('150') },
          ],
            titres,
            cours,
            titresDetenus: new Set(etat.positions.map(position => position.titreId)),
            seuils: { cw8: { haut: '720', bas: '600' } },
          })}
          onAjouter={() => undefined}
          onRetirer={() => undefined}
          onChangerSeuil={() => undefined}
          onRechercher={() => setDestination('recherche')}
          chargerTheses={thesesExemple}
          chargerFiche={async () => ficheExemple}
          onOuvrirFiche={() => setDestination('fiche')}
          onRetour={() => setDestination('portefeuille')}
        />
      ) : null}

      {destination === 'comparateur' ? (
        <ComparateurFinancier
          societes={[
            { symbole: 'EXA.PA', nom: 'Exemple Industries SA', comptes: lireComptes(COMPTES_EXEMPLE) },
            {
              symbole: 'AUT.PA',
              nom: 'Autre Groupe',
              comptes: Object.fromEntries(
                Object.entries(lireComptes(COMPTES_EXEMPLE)).map(([poste, points]) => [
                  poste,
                  (points ?? []).map((point, index) => ({ ...point, valeur: point.valeur * (0.4 + index * 0.08) })),
                ]),
              ),
            },
          ]}
          suggestions={[{ symbole: 'CW8.PA', nom: 'Amundi MSCI World' }]}
          onAjouter={() => undefined}
          onRetirer={() => undefined}
          onRechercher={async () => []}
          onRetour={() => setDestination('portefeuille')}
          comparaisonCours={
        <Comparateur
          vue={construireComparateur({
            retenus: compares,
            titres,
            etat,
            cours,
            historique,
            dividendesDouzeMois: new Map([['air-liquide', d('211.2')]]),
            surveilles: new Set(['cw8']),
          })}
          onBasculer={titreId =>
            setCompares(precedent =>
              precedent.includes(titreId)
                ? precedent.filter(id => id !== titreId)
                : [...precedent, titreId],
            )
          }
          onRetour={() => setDestination('portefeuille')}
        />
          }
        />
      ) : null}

      {destination === 'objectifs' ? (
        <Objectifs
          objectif={{ montant: 50000, date: '2031-06-30', rendement: 5 }}
          valeurActuelle={19000}
          aujourdhui="2026-09-25"
          onEnregistrerObjectif={() => undefined}
          lignes={[
            { titreId: 'cw8', nom: 'Amundi MSCI World', valeur: 11700, cible: 70, cours: 585 },
            { titreId: 'ai', nom: 'Air Liquide', valeur: 4600, cible: 20, cours: 178 },
            { titreId: 'stla', nom: 'Stellantis', valeur: 2700, cible: 10, cours: 9 },
          ]}
          onChangerCible={() => undefined}
        />
      ) : null}
      {destination === 'podcast' ? <Podcast episode={episodeExemple} onGenerer={() => undefined} /> : null}
      {destination === 'projection' ? (
        <Projection
          champs={champs}
          vue={construireProjection({ champs, capitalActuel: d('19000') })}
          capitalActuel="19 000,00 €"
          onChanger={(champ, valeur) =>
            setChamps(precedent => ({ ...precedent, [champ]: valeur }))
          }
          onRetour={() => setDestination('portefeuille')}
        />
      ) : null}
    </Coque>
  );
}

createRoot(document.getElementById('racine')!).render(
  <SafeAreaProvider>
    <Apercu />
  </SafeAreaProvider>,
);
