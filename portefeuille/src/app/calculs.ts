/**
 * Calculs purs tirés du portefeuille, utilisés par plusieurs écrans.
 * Sortis d'App.tsx : ils se lisent et se testent sans l'interface.
 */

import type { Compte, Titre, Transaction } from '../core/domain/types';
import { Decimal } from '../core/money/decimal';
import type { EtatPortefeuille } from '../core/portfolio/engine';
import { totaux, valoriserPositions } from '../core/portfolio/valorisation';
import type { LigneVendable } from '../ui/vues/simulationVente';
import type { LigneCible } from '../ui/vues/objectifs';

/**
 * Dividendes encaisses sur douze mois glissants, par titre.
 * Le comparateur en a besoin pour rapporter un rendement au prix de revient.
 */
export function dividendesParTitre(
  transactions: readonly Transaction[],
  aujourdhui: string,
): Map<string, Decimal> {
  const [annee, mois, jour] = aujourdhui.split('-');
  const debut = `${Number(annee) - 1}-${mois}-${jour}`;

  const cumuls = new Map<string, Decimal>();
  for (const transaction of transactions) {
    if (transaction.type !== 'DIVIDENDE' || transaction.date <= debut) {
      continue;
    }
    cumuls.set(
      transaction.titreId,
      (cumuls.get(transaction.titreId) ?? Decimal.ZERO).add(transaction.montantNet),
    );
  }
  return cumuls;
}

/** Positions proposées au simulateur de vente, avec la valeur de leur plan. */
export function lignesVendables(
  contenu: { etat: EtatPortefeuille; comptes: readonly Compte[]; titres: readonly Titre[] },
  cours: ReadonlyMap<string, Decimal>,
): LigneVendable[] {
  const noms = new Map(contenu.titres.map(titre => [titre.id, titre.nom]));
  return contenu.etat.positions
    .filter(position => position.quantite.estPositif())
    .flatMap(position => {
      const compte = contenu.comptes.find(candidat => candidat.id === position.compteId);
      if (!compte) return [];
      const etatCompte = contenu.etat.comptes.get(compte.id);
      const pea = compte.type === 'PEA' || compte.type === 'PEA_PME';
      const valeurPlan = pea
        ? totaux(
            valoriserPositions(contenu.etat.positions.filter(p => p.compteId === compte.id), cours).valorisees,
            etatCompte ? [etatCompte] : [],
          ).valeurTotale.toNumber()
        : undefined;
      return [
        {
          cle: `${compte.id}|${position.titreId}`,
          libelle: `${noms.get(position.titreId) ?? position.titreId} · ${compte.nom}`,
          enveloppe: pea ? ('PEA' as const) : ('CTO' as const),
          dateOuverture: compte.dateOuverture,
          quantite: position.quantite.toNumber(),
          pru: position.pru.toNumber(),
          cours: cours.get(position.titreId)?.toNumber(),
          valeurPlan,
          versementsPlan: pea ? etatCompte?.versementsCumules.toNumber() : undefined,
        },
      ];
    });
}

/**
 * Lignes de l'écran Objectifs : une par valeur détenue (tous comptes),
 * avec sa cible enregistrée, ou son poids actuel à défaut.
 */
export function lignesCibles(
  contenu: { etat: EtatPortefeuille; titres: readonly Titre[] },
  cours: ReadonlyMap<string, Decimal>,
  ciblesBrutes: string | undefined,
): LigneCible[] {
  let cibles: Record<string, string> = {};
  try {
    cibles = JSON.parse(ciblesBrutes ?? '{}');
  } catch {
    cibles = {};
  }
  const { valorisees } = valoriserPositions(contenu.etat.positions, cours);
  const parTitre = new Map<string, number>();
  for (const position of valorisees) {
    parTitre.set(position.titreId, (parTitre.get(position.titreId) ?? 0) + position.valeurMarche.toNumber());
  }
  const total = [...parTitre.values()].reduce((somme, valeur) => somme + valeur, 0);
  return [...parTitre.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([titreId, valeur]) => {
      const saisie = Number((cibles[titreId] ?? '').replace(',', '.'));
      return {
        titreId,
        nom: contenu.titres.find(titre => titre.id === titreId)?.nom ?? titreId,
        valeur,
        cible: cibles[titreId] !== undefined && Number.isFinite(saisie)
          ? saisie
          : total > 0 ? Math.round((valeur / total) * 1000) / 10 : 0,
        cours: cours.get(titreId)?.toNumber(),
      };
    });
}
