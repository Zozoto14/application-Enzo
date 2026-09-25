/**
 * Aperçu de l'application sur poste fixe.
 *
 * Elle répond à une question de disposition, pas de données : les écrans
 * écrits pour l'iPhone tiennent-ils dans une coque de bureau — barre latérale
 * permanente, contenu en colonnes ? Elle monte donc le portefeuille avec des
 * valeurs en mémoire, sans base ni chiffrement.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, View, useColorScheme } from 'react-native';
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
import { Comparateur } from '../src/ui/ecrans/Comparateur';
import { Portefeuille } from '../src/ui/ecrans/Portefeuille';
import { Projection } from '../src/ui/ecrans/Projection';
import { Watchlist } from '../src/ui/ecrans/Watchlist';
import { ESPACEMENT, palettePour } from '../src/ui/theme';
import { Bureau, useFondDocument, type Destination } from './Bureau';

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
];

const ficheExemple = construireFiche(
  lireFiche('EXA.PA', RESUME_EXEMPLE),
  lireComptes(COMPTES_EXEMPLE),
  lireCoursEtDividendes(historiqueExemple()),
);

// ---------------------------------------------------------------- Aperçu

function Apercu() {
  const sombre = useColorScheme() === 'dark';
  const palette = palettePour(sombre);
  useFondDocument(sombre);

  const [destination, setDestination] = useState('portefeuille');
  const [compares, setCompares] = useState<readonly string[]>(['air-liquide', 'cw8']);
  const [champs, setChamps] = useState(CHAMPS_DEFAUT);

  return (
    <Bureau
      destinations={DESTINATIONS}
      actif={destination}
      onNaviguer={setDestination}
      pied="Aperçu"
      bandeau={
        <View style={[styles.bandeau, { borderColor: palette.bordure }]}>
          <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>
            Aperçu de disposition — données d’exemple, sans base ni chiffrement.
          </Text>
        </View>
      }>
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
      ) : null}

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
    </Bureau>
  );
}

const styles = StyleSheet.create({
  bandeau: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: ESPACEMENT.m,
    paddingVertical: ESPACEMENT.s,
  },
});

createRoot(document.getElementById('racine')!).render(
  <SafeAreaProvider>
    <Apercu />
  </SafeAreaProvider>,
);
