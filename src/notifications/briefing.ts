/**
 * Composition des notifications de briefing.
 *
 * Remplace le widget écarté : répond à la même question — combien vaut mon
 * portefeuille aujourd'hui ? — sans extension ni entitlement, et sans que la
 * donnée quitte l'application.
 *
 * Tout le texte est composé ici, en données pures. L'envoi lui-même est
 * l'affaire de l'adaptateur natif, qui ne décide de rien.
 *
 * Une règle gouverne la rédaction : **une notification qui ne dit rien de
 * nouveau ne doit pas être envoyée**. Un briefing quotidien identique la
 * veille et le lendemain finit par être ignoré, et avec lui ceux qui
 * comptaient.
 */

import { Decimal } from '../core/money/decimal';
import type { Titre } from '../core/domain/types';
import type { EtatPortefeuille } from '../core/portfolio/engine';
import { totaux, valoriserPositions } from '../core/portfolio/valorisation';
import { formaterMontant, formaterPourcentage } from '../ui/format';

export type MomentBriefing = 'matin' | 'soir';

export interface Briefing {
  titre: string;
  corps: string;
  /** Valeur totale annoncee, a memoriser pour mesurer le prochain ecart. */
  valeur: Decimal;
  /** Identifiant stable, pour qu'un briefing remplace le précédent du jour. */
  identifiant: string;
}

export interface EntreesBriefing {
  moment: MomentBriefing;
  etat: EtatPortefeuille;
  titres: readonly Titre[];
  cours: ReadonlyMap<string, Decimal>;
  /** Valeur totale du briefing précédent, pour mesurer l'évolution. */
  valeurPrecedente?: Decimal;
  /** Date du jour, au format ISO. */
  date: string;
}

const SALUTATIONS: Record<MomentBriefing, string> = {
  matin: 'Avant ouverture',
  soir: 'Clôture',
};

/**
 * Compose le briefing, ou renvoie `undefined` s'il n'y a rien à dire.
 *
 * Trois cas de silence : aucun compte, aucune position valorisable, et un
 * portefeuille dont la valeur n'a pas bougé d'un centime.
 */
export function composerBriefing(entrees: EntreesBriefing): Briefing | undefined {
  const { valorisees, sansCours } = valoriserPositions(entrees.etat.positions, entrees.cours);
  const agregats = totaux(valorisees, [...entrees.etat.comptes.values()]);

  if (entrees.etat.comptes.size === 0) {
    return undefined;
  }

  // Un portefeuille sans position ni liquidites n'a rien a dire. En revanche,
  // des positions qu'on ne sait pas valoriser meritent d'etre signalees :
  // c'est meme le moment ou l'information est la plus utile.
  const vraimentVide =
    entrees.etat.positions.length === 0 && agregats.cash.estZero();
  if (vraimentVide) {
    return undefined;
  }

  const evolution = entrees.valeurPrecedente
    ? agregats.valeurTotale.sub(entrees.valeurPrecedente)
    : undefined;

  // Rien n'a bougé : se taire plutôt que d'habituer à ignorer l'application.
  if (evolution && evolution.enCentimes().estZero()) {
    return undefined;
  }

  const lignes: string[] = [];

  if (evolution && entrees.valeurPrecedente?.estPositif()) {
    const pourcent = evolution.div(entrees.valeurPrecedente).mul(100);
    lignes.push(
      `${formaterMontant(evolution, { signeExplicite: true })} depuis le dernier point (${formaterPourcentage(pourcent)}).`,
    );
  }

  if (agregats.plusValueLatentePct) {
    lignes.push(
      `Plus-value latente : ${formaterMontant(agregats.plusValueLatente, {
        signeExplicite: true,
      })} (${formaterPourcentage(agregats.plusValueLatentePct)}).`,
    );
  }

  // Un total amputé sans explication vaut moins qu'un total absent : on le dit.
  if (sansCours.length > 0) {
    const noms = new Map(entrees.titres.map(titre => [titre.id, titre.nom]));
    const manquants = sansCours.map(position => noms.get(position.titreId) ?? position.titreId);
    lignes.push(
      `${manquants.length} valeur(s) sans cours, exclues du total : ${manquants.join(', ')}.`,
    );
  }

  return {
    titre: `${SALUTATIONS[entrees.moment]} — ${formaterMontant(agregats.valeurTotale)}`,
    corps: lignes.join(' '),
    valeur: agregats.valeurTotale,
    identifiant: `briefing-${entrees.date}-${entrees.moment}`,
  };
}

export interface SeuilAlerte {
  titreId: string;
  /** Alerte si le cours passe au-dessus. */
  haut?: Decimal;
  /** Alerte si le cours passe en dessous. */
  bas?: Decimal;
}

export interface AlerteDeclenchee {
  titreId: string;
  nom: string;
  sens: 'haut' | 'bas';
  seuil: Decimal;
  cours: Decimal;
  titre: string;
  corps: string;
  identifiant: string;
}

/**
 * Alertes de cours franchies.
 *
 * Le franchissement se juge par rapport au **cours précédent**, pas seulement
 * au seuil : sans cela, une valeur durablement sous son seuil bas déclencherait
 * une alerte à chaque vérification, et l'utilisateur les couperait toutes.
 */
export function alertesDeclenchees(
  seuils: readonly SeuilAlerte[],
  coursActuels: ReadonlyMap<string, Decimal>,
  coursPrecedents: ReadonlyMap<string, Decimal>,
  titres: readonly Titre[],
  date: string,
): AlerteDeclenchee[] {
  const noms = new Map(titres.map(titre => [titre.id, titre.nom]));
  const declenchees: AlerteDeclenchee[] = [];

  for (const seuil of seuils) {
    const actuel = coursActuels.get(seuil.titreId);
    if (!actuel) {
      continue;
    }
    const precedent = coursPrecedents.get(seuil.titreId);
    const nom = noms.get(seuil.titreId) ?? seuil.titreId;

    if (seuil.haut && actuel.gte(seuil.haut) && (!precedent || precedent.lt(seuil.haut))) {
      declenchees.push({
        titreId: seuil.titreId,
        nom,
        sens: 'haut',
        seuil: seuil.haut,
        cours: actuel,
        titre: `${nom} franchit ${formaterMontant(seuil.haut)}`,
        corps: `Cours actuel : ${formaterMontant(actuel)}.`,
        identifiant: `alerte-${seuil.titreId}-haut-${date}`,
      });
    }

    if (seuil.bas && actuel.lte(seuil.bas) && (!precedent || precedent.gt(seuil.bas))) {
      declenchees.push({
        titreId: seuil.titreId,
        nom,
        sens: 'bas',
        seuil: seuil.bas,
        cours: actuel,
        titre: `${nom} passe sous ${formaterMontant(seuil.bas)}`,
        corps: `Cours actuel : ${formaterMontant(actuel)}.`,
        identifiant: `alerte-${seuil.titreId}-bas-${date}`,
      });
    }
  }

  return declenchees;
}
