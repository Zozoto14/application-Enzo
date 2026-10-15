/**
 * Lecteur du portefeuille pour le Journal automatique (contrat
 * `hub/journal/contrat.ts`, `LecteurPortefeuilleJournal`) : opérations d'un
 * jour et variation de la valeur, à partir des données déjà chargées par
 * l'hôte (base locale). Pur : rien n'est lu ni écrit ailleurs, rien ne part
 * sur le relais. Les montants sont rendus bruts ; le mode « valeurs masquées »
 * s'applique à l'affichage du journal.
 */

import type { Titre, Transaction } from '../core/domain/types';
import type { PointValorisation } from '../core/performance/rendements';
import type { EvenementJournal, LecteurPortefeuilleJournal, OperationJournal, SourceJournal } from '../hub/journal/contrat';

export interface EntreesPortefeuilleJournal {
  transactions: readonly Transaction[];
  titres: readonly Titre[];
  comptes?: ReadonlyArray<{ id: string; nom: string }>;
  points: readonly PointValorisation[];
}

function montantDe(t: Transaction): number | undefined {
  switch (t.type) {
    case 'ACHAT':
    case 'VENTE':
      return t.quantite.mul(t.prixUnitaire).toNumber();
    case 'DIVIDENDE':
      return t.montantNet.toNumber();
    default:
      return t.montant.toNumber();
  }
}

export function creerLecteurPortefeuille(e: EntreesPortefeuilleJournal): LecteurPortefeuilleJournal {
  const titres = new Map(e.titres.map(t => [t.id, t.nom || t.ticker || t.isin || 'Titre']));
  const comptes = new Map((e.comptes ?? []).map(c => [c.id, c.nom]));
  return {
    operations(jour) {
      return e.transactions
        .filter(t => t.date === jour)
        .map((t): OperationJournal => {
          const titreId = 'titreId' in t ? t.titreId : undefined;
          const quantite = t.type === 'ACHAT' || t.type === 'VENTE' ? t.quantite.toNumber() : undefined;
          const montant = montantDe(t);
          return {
            id: t.id,
            type: t.type,
            libelle: (titreId && titres.get(titreId)) || comptes.get(t.compteId) || 'Compte',
            ...(quantite !== undefined ? { quantite } : {}),
            ...(montant !== undefined ? { montant: Math.abs(montant) } : {}),
          };
        });
    },
    variation(jour) {
      // Le point du jour et celui qui le précède (jours sans cotation : le dernier point connu).
      const i = e.points.findIndex(p => p.date === jour);
      if (i <= 0) return undefined;
      const veille = e.points[i - 1];
      const point = e.points[i];
      if (!veille.valeurTotale.estPositif()) return undefined;
      const ecart = point.valeurTotale.sub(point.fluxExterne).sub(veille.valeurTotale);
      return { pourcentage: ecart.div(veille.valeurTotale).mul(100).toNumber(), montant: ecart.toNumber() };
    },
  };
}

const VERBES: Record<OperationJournal['type'], string> = { ACHAT: 'ACHAT', VENTE: 'VENTE', DIVIDENDE: 'DIVIDENDE', VERSEMENT: 'VERSEMENT', RETRAIT: 'RETRAIT', FRAIS: 'FRAIS' };

export const ID_SOURCE_PORTEFEUILLE = 'portefeuille';

export const SOURCE_PORTEFEUILLE: SourceJournal = {
  id: ID_SOURCE_PORTEFEUILLE,
  nom: 'Portefeuille',
  famille: 'portefeuille',
  lire(jour, contexte) {
    const lecteur = contexte.journalPortefeuille;
    if (!lecteur) return [];
    const sortie: EvenementJournal[] = lecteur.operations(jour).map(o => ({
      id: o.id,
      source: ID_SOURCE_PORTEFEUILLE,
      famille: 'portefeuille',
      genre: 'operation-bourse',
      jour,
      titre: o.libelle,
      groupe: VERBES[o.type],
      ...(o.quantite !== undefined ? { nombre: o.quantite } : {}),
      ...(o.montant !== undefined ? { montant: o.montant } : {}),
    }));
    const v = lecteur.variation(jour);
    if (v && Number.isFinite(v.pourcentage)) {
      sortie.push({
        id: `variation:${jour}`,
        source: ID_SOURCE_PORTEFEUILLE,
        famille: 'portefeuille',
        genre: 'variation-portefeuille',
        jour,
        titre: 'Variation du portefeuille',
        pourcentage: Math.round(v.pourcentage * 100) / 100,
        ...(v.montant !== undefined && Number.isFinite(v.montant) ? { montant: Math.round(v.montant * 100) / 100 } : {}),
      });
    }
    return sortie;
  },
};
