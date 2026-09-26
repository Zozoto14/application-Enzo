/**
 * Comparer deux périodes : cette année et la même période l'an dernier, ce
 * trimestre et le précédent, ce mois et le précédent.
 *
 * « Même période » compte : comparer neuf mois de 2026 à douze mois de 2025
 * ferait croire à un recul des dividendes qui n'est qu'un calendrier.
 */

import type { Transaction } from '../../core/domain/types';
import { facteursTwr, type FacteurDate } from '../../core/performance/cumul';
import type { PointValorisation } from '../../core/performance/rendements';

export type ChoixPeriodes = 'annee' | 'trimestre' | 'mois';

export interface Periode {
  debut: string;
  fin: string;
  libelle: string;
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function iso(annee: number, mois: number, jour: number): string {
  // Le jour est borné à la fin du mois (31 mars → 28 février).
  const dernier = new Date(Date.UTC(annee, mois + 1, 0)).getUTCDate();
  return `${annee}-${String(mois + 1).padStart(2, '0')}-${String(Math.min(jour, dernier)).padStart(2, '0')}`;
}

export function periodesComparees(choix: ChoixPeriodes, aujourdhui: string): { actuelle: Periode; precedente: Periode } {
  const [annee, moisUn, jour] = aujourdhui.split('-').map(Number);
  const mois = moisUn - 1;
  if (choix === 'annee') {
    return {
      actuelle: { debut: iso(annee, 0, 1), fin: aujourdhui, libelle: `${annee} (au ${jour} ${MOIS[mois]})` },
      precedente: { debut: iso(annee - 1, 0, 1), fin: iso(annee - 1, mois, jour), libelle: `${annee - 1} (même période)` },
    };
  }
  if (choix === 'trimestre') {
    const premierMois = mois - (mois % 3);
    const ecartJours = Math.round((Date.parse(`${aujourdhui}T00:00:00Z`) - Date.parse(`${iso(annee, premierMois, 1)}T00:00:00Z`)) / 86_400_000);
    const debutPrecedent = new Date(Date.UTC(annee, premierMois - 3, 1));
    const finPrecedente = new Date(debutPrecedent.getTime() + ecartJours * 86_400_000);
    return {
      actuelle: { debut: iso(annee, premierMois, 1), fin: aujourdhui, libelle: `T${premierMois / 3 + 1} ${annee}` },
      precedente: {
        debut: debutPrecedent.toISOString().slice(0, 10),
        fin: finPrecedente.toISOString().slice(0, 10),
        libelle: `T${((premierMois / 3 + 3) % 4) + 1} ${debutPrecedent.getUTCFullYear()} (même durée)`,
      },
    };
  }
  const precedent = new Date(Date.UTC(annee, mois - 1, 1));
  return {
    actuelle: { debut: iso(annee, mois, 1), fin: aujourdhui, libelle: `${MOIS[mois]} ${annee}` },
    precedente: {
      debut: precedent.toISOString().slice(0, 10),
      fin: iso(precedent.getUTCFullYear(), precedent.getUTCMonth(), jour),
      libelle: `${MOIS[precedent.getUTCMonth()]} ${precedent.getUTCFullYear()} (mêmes jours)`,
    },
  };
}

export interface MesuresPeriode {
  /** Performance TWR sur la période, en % ; null sans valorisations. */
  performance: number | null;
  /** Gain en euros : valeur de fin − valeur de début − flux. */
  gain: number | null;
  dividendes: number;
  versementsNets: number;
  achats: number;
  ventes: number;
  operations: number;
}

function facteurAu(facteurs: readonly FacteurDate[], date: string): number | undefined {
  let trouve: number | undefined;
  for (const point of facteurs) {
    if (point.date > date) break;
    trouve = point.facteur;
  }
  return trouve;
}

export function mesurerPeriode(
  periode: Periode,
  points: readonly PointValorisation[],
  transactions: readonly Transaction[],
): MesuresPeriode {
  const dans = transactions.filter(t => t.date >= periode.debut && t.date <= periode.fin);
  const somme = (liste: readonly Transaction[], lire: (t: Transaction) => number) => liste.reduce((total, t) => total + lire(t), 0);

  const facteurs = facteursTwr(points);
  const avantDebut = facteurAu(facteurs, periode.debut) ?? (facteurs[0] && facteurs[0].date <= periode.fin ? facteurs[0].facteur : undefined);
  const aLaFin = facteurAu(facteurs, periode.fin);
  const performance = avantDebut && aLaFin ? (aLaFin / avantDebut - 1) * 100 : null;

  const valeurAu = (date: string) => {
    let trouve: PointValorisation | undefined;
    for (const point of points) {
      if (point.date > date) break;
      trouve = point;
    }
    return trouve?.valeurTotale.toNumber();
  };
  const flux = points
    .filter(point => point.date > periode.debut && point.date <= periode.fin)
    .reduce((total, point) => total + point.fluxExterne.toNumber(), 0);
  const debut = valeurAu(periode.debut) ?? 0;
  const fin = valeurAu(periode.fin);

  return {
    performance,
    gain: fin === undefined ? null : fin - debut - flux,
    dividendes: somme(dans.filter(t => t.type === 'DIVIDENDE'), t => (t.type === 'DIVIDENDE' ? t.montantNet.toNumber() : 0)),
    versementsNets: somme(dans, t =>
      t.type === 'VERSEMENT' ? t.montant.toNumber() : t.type === 'RETRAIT' ? -t.montant.toNumber() : 0,
    ),
    achats: somme(dans, t => (t.type === 'ACHAT' ? t.quantite.toNumber() * t.prixUnitaire.toNumber() + t.frais.toNumber() : 0)),
    ventes: somme(dans, t => (t.type === 'VENTE' ? t.quantite.toNumber() * t.prixUnitaire.toNumber() - t.frais.toNumber() : 0)),
    operations: dans.length,
  };
}
