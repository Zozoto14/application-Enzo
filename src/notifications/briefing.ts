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
  /** Cours du point précédent : de quoi nommer les lignes qui ont bougé. */
  coursPrecedents?: ReadonlyMap<string, Decimal>;
  /**
   * Parler même quand rien n'a bougé. Sur l'ordinateur, le briefing est un
   * rendez-vous demandé : le taire avant l'ouverture ou le week-end, c'est
   * donner l'impression qu'il ne marche pas.
   */
  toujours?: boolean;
}

const SALUTATIONS: Record<MomentBriefing, string> = {
  matin: '☀︎ Avant ouverture',
  soir: '☾ Clôture',
};

/** Meilleure et moins bonne ligne depuis le point précédent. */
function mouvements(entrees: EntreesBriefing): string | undefined {
  if (!entrees.coursPrecedents) return undefined;
  const noms = new Map(entrees.titres.map(titre => [titre.id, titre.nom]));
  const variations: Array<{ nom: string; pct: number }> = [];
  for (const position of entrees.etat.positions) {
    const avant = entrees.coursPrecedents.get(position.titreId);
    const maintenant = entrees.cours.get(position.titreId);
    if (!avant || !maintenant || !avant.estPositif()) continue;
    const pct = maintenant.div(avant).sub(Decimal.de('1')).mul(100).toNumber();
    if (Math.abs(pct) >= 0.01) variations.push({ nom: noms.get(position.titreId) ?? position.titreId, pct });
  }
  if (variations.length === 0) return undefined;
  variations.sort((a, b) => b.pct - a.pct);
  const texte = (v: { nom: string; pct: number }) =>
    `${v.nom} ${formaterPourcentage(Decimal.de(v.pct.toFixed(2)))}`;
  const meilleure = variations[0];
  const pire = variations[variations.length - 1];
  if (variations.length === 1) return `${meilleure.pct >= 0 ? '▲' : '▼'} ${texte(meilleure)}`;
  return [meilleure.pct > 0 ? `▲ ${texte(meilleure)}` : undefined, pire.pct < 0 ? `▼ ${texte(pire)}` : undefined]
    .filter(Boolean)
    .join('  ·  ');
}

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

  const immobile = Boolean(evolution && evolution.enCentimes().estZero());
  // Rien n'a bougé : se taire plutôt que d'habituer à ignorer l'application
  // — sauf quand le briefing est un rendez-vous qu'on attend.
  if (immobile && !entrees.toujours) {
    return undefined;
  }

  const lignes: string[] = [];

  if (immobile) {
    lignes.push(
      entrees.moment === 'matin'
        ? '＝ Stable depuis le dernier point : les marchés n’ont pas encore ouvert.'
        : '＝ Stable depuis le dernier point.',
    );
  } else if (evolution && entrees.valeurPrecedente?.estPositif()) {
    const pourcent = evolution.div(entrees.valeurPrecedente).mul(100);
    lignes.push(
      `${evolution.estPositif() ? '▲' : '▼'} ${formaterMontant(evolution, { signeExplicite: true })} depuis le dernier point (${formaterPourcentage(pourcent)}).`,
    );
  }

  const bougent = mouvements(entrees);
  if (bougent && !immobile) {
    lignes.push(bougent);
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
      `⚠︎ ${manquants.length} valeur(s) sans cours, exclues du total : ${manquants.join(', ')}.`,
    );
  }

  return {
    titre: `${SALUTATIONS[entrees.moment]} — ${formaterMontant(agregats.valeurTotale)}`,
    // Une information par ligne : Windows et iOS les affichent l'une sous l'autre.
    corps: lignes.join('\n'),
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
