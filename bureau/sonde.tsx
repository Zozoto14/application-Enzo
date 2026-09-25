/**
 * Aperçu de l'application sur poste fixe.
 *
 * Elle répond à une question de disposition, pas de données : les écrans
 * écrits pour l'iPhone tiennent-ils dans une coque de bureau — barre latérale
 * permanente, contenu en colonnes ? Elle monte donc le portefeuille avec des
 * valeurs en mémoire, sans base ni chiffrement.
 */

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
import { useFondDocument } from './Bureau';
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
  { cle: 'surveillance', libelle: 'Surveillance', glyphe: '★' },
  { cle: 'comparateur', libelle: 'Comparer', glyphe: '⇄' },
  { cle: 'projection', libelle: 'Projection', glyphe: '◔' },
  { cle: 'fiche', libelle: 'Fiche', glyphe: '◧' },
  { cle: 'podcast', libelle: 'Podcast', glyphe: '♫' },
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
});

const ficheExemple = construireFiche(
  lireFiche('EXA.PA', RESUME_EXEMPLE),
  lireComptes(COMPTES_EXEMPLE),
  lireCoursEtDividendes(historiqueExemple()),
);

// ---------------------------------------------------------------- Aperçu

function Apercu() {
  const sombre = useColorScheme() === 'dark';
  useFondDocument(sombre);

  const [destination, setDestination] = useState('portefeuille');
  const [compares, setCompares] = useState<readonly string[]>(['air-liquide', 'cw8']);
  const [champs, setChamps] = useState(CHAMPS_DEFAUT);

  return (
    <Coque destinations={DESTINATIONS} actif={destination} onNaviguer={setDestination} onVerrouiller={() => undefined}>
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

      {destination === 'surveillance' ? (
        <Watchlist
          vue={construireWatchlist({
            watchlist: [{ titreId: 'cw8', ajouteLe: '2025-03-12', coursAjout: d('612') }],
            titres,
            cours,
            titresDetenus: new Set(etat.positions.map(position => position.titreId)),
            seuils: { cw8: { haut: '720', bas: '600' } },
          })}
          onAjouter={() => undefined}
          onRetirer={() => undefined}
          onChangerSeuil={() => undefined}
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
