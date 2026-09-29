/**
 * Journal des décisions : chaque achat et chaque vente, avec la raison
 * qu'on s'était donnée, et ce qui s'est passé depuis.
 *
 * Un achat se juge au cours d'aujourd'hui. Une vente aussi, mais à
 * l'envers : si l'action a baissé depuis, vendre était le bon choix ; si
 * elle a monté, la vente a fait manquer la hausse. Relire ses décisions
 * avec leur raison, c'est apprendre de soi plus que du marché.
 */

import type { Titre, Transaction } from '../../core/domain/types';
import type { Decimal } from '../../core/money/decimal';
import type { Carnet } from './carnet';

export type Verdict = 'bon' | 'mauvais' | 'neutre';

export interface LigneJournal {
  transactionId: string;
  date: string;
  type: 'ACHAT' | 'VENTE';
  titreId: string;
  nom: string;
  quantite: number;
  prix: number;
  /** Raison notée sur l'opération. */
  note?: string;
  /** Thèse du carnet pour cette valeur, s'il y en a une. */
  these?: string;
  coursActuel?: number;
  /** Variation du cours depuis la décision, en %. */
  depuisPct?: number;
  /** Gain de l'achat, ou hausse manquée (négatif) / baisse évitée (positif) de la vente. */
  effetEuros?: number;
  verdict?: Verdict;
  phrase: string;
}

export interface VueJournal {
  lignes: LigneJournal[];
  /** Part des décisions qui se sont révélées bonnes, en %. */
  tauxReussite?: number;
  decisionsJugees: number;
}

const euros = (valeur: number) => `${Math.abs(valeur).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`;
const pct = (valeur: number) => `${valeur >= 0 ? '+' : '−'}${Math.abs(valeur).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;

export function construireJournal(entrees: {
  transactions: readonly Transaction[];
  titres: readonly Titre[];
  cours: ReadonlyMap<string, Decimal>;
  carnet?: Carnet;
}): VueJournal {
  const noms = new Map(entrees.titres.map(titre => [titre.id, titre.nom]));
  const lignes: LigneJournal[] = [];
  for (const transaction of entrees.transactions) {
    if (transaction.type !== 'ACHAT' && transaction.type !== 'VENTE') continue;
    const quantite = transaction.quantite.toNumber();
    const prix = transaction.prixUnitaire.toNumber();
    const coursActuel = entrees.cours.get(transaction.titreId)?.toNumber();
    const ligne: LigneJournal = {
      transactionId: transaction.id,
      date: transaction.date,
      type: transaction.type,
      titreId: transaction.titreId,
      nom: noms.get(transaction.titreId) ?? transaction.titreId,
      quantite,
      prix,
      note: transaction.note?.trim() || undefined,
      these: entrees.carnet?.[transaction.titreId]?.pourquoi?.trim() || undefined,
      coursActuel,
      phrase: 'Cours actuel inconnu : impossible de juger cette décision pour l’instant.',
    };
    if (coursActuel !== undefined && prix > 0) {
      const depuisPct = (coursActuel / prix - 1) * 100;
      ligne.depuisPct = depuisPct;
      if (transaction.type === 'ACHAT') {
        ligne.effetEuros = quantite * (coursActuel - prix);
        ligne.verdict = Math.abs(depuisPct) < 1 ? 'neutre' : depuisPct > 0 ? 'bon' : 'mauvais';
        ligne.phrase =
          ligne.verdict === 'neutre'
            ? 'Le cours n’a presque pas bougé depuis cet achat.'
            : `Depuis cet achat, ${pct(depuisPct)} : ${depuisPct > 0 ? 'un gain' : 'une perte'} de ${euros(ligne.effetEuros)} sur ces titres.`;
      } else {
        // Pour une vente, une baisse ensuite est une bonne nouvelle.
        ligne.effetEuros = quantite * (prix - coursActuel);
        ligne.verdict = Math.abs(depuisPct) < 1 ? 'neutre' : depuisPct < 0 ? 'bon' : 'mauvais';
        ligne.phrase =
          ligne.verdict === 'neutre'
            ? 'Le cours n’a presque pas bougé depuis cette vente.'
            : depuisPct < 0
              ? `Depuis la vente, ${pct(depuisPct)} : vendre vous a évité ${euros(ligne.effetEuros)} de baisse.`
              : `Depuis la vente, ${pct(depuisPct)} : la vente a fait manquer ${euros(ligne.effetEuros)} de hausse.`;
      }
    }
    lignes.push(ligne);
  }
  lignes.sort((a, b) => b.date.localeCompare(a.date));
  const jugees = lignes.filter(ligne => ligne.verdict && ligne.verdict !== 'neutre');
  return {
    lignes,
    decisionsJugees: jugees.length,
    tauxReussite: jugees.length > 0 ? (jugees.filter(ligne => ligne.verdict === 'bon').length / jugees.length) * 100 : undefined,
  };
}
