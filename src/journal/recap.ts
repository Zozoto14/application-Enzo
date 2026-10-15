/**
 * Récapitulatifs hebdomadaire (du lundi au dimanche) et mensuel, générés à
 * partir des pages déjà écrites : compteurs additionnés, jours forts, humeur
 * moyenne, faits marquants. Même principe de rédaction que les pages (modèles
 * de phrases reproductibles, aucune IA). Pur.
 */

import { COMPTEURS } from './agregation';
import { debutMois, debutSemaine, finMois, finSemaine, jourCourt, jourLongMaj, moisLong, semaineLongue } from './dates';
import { emojiHumeur, libelleHumeur, type ChiffreCle, type FaitMarquant, type Humeur, type PageJournal, type SectionPage } from './modele';
import { duree, eur, liste, majuscule, pct, pluriel, tirer } from './texte';

export type PeriodeRecap = 'semaine' | 'mois';

export interface Recap {
  periode: PeriodeRecap;
  du: string;
  au: string;
  titre: string;
  intro: string;
  sections: SectionPage[];
  chiffres: ChiffreCle[];
  marquants: Array<FaitMarquant & { jour: string }>;
  /** Humeur moyenne arrondie, si au moins une page en porte une. */
  humeur?: { moyenne: number; arrondie: Humeur; pages: number };
  /** Jour le plus chargé. */
  jourFort?: { jour: string; evenements: number };
  pages: number;
  /** Jours de la période (jusqu'à aujourd'hui) sans page. */
  jours: number;
  /** Compteurs totaux de la période. */
  totaux: Record<string, number>;
}

export function bornesRecap(periode: PeriodeRecap, jour: string): { du: string; au: string } {
  return periode === 'semaine' ? { du: debutSemaine(jour), au: finSemaine(jour) } : { du: debutMois(jour), au: finMois(jour) };
}

const somme = (pages: readonly PageJournal[], cle: string) => pages.reduce((t, p) => t + (p.compteurs[cle] ?? 0), 0);

/** Compose le récapitulatif d'une période à partir des pages (celles qui sont dans les bornes). */
export function composerRecap(periode: PeriodeRecap, jour: string, toutes: readonly PageJournal[], aujourdhui: string): Recap {
  const { du, au } = bornesRecap(periode, jour);
  const pages = toutes.filter(p => p.jour >= du && p.jour <= au && p.auto.moteur !== 'vide').sort((a, b) => (a.jour < b.jour ? -1 : 1));
  const fin = au < aujourdhui ? au : aujourdhui;
  const jours = fin < du ? 0 : Math.round((Date.parse(`${fin}T12:00:00Z`) - Date.parse(`${du}T12:00:00Z`)) / 86_400_000) + 1;
  const graine = `${du}|recap|${periode}`;
  const nom = periode === 'semaine' ? 'cette semaine' : 'ce mois-ci';
  const t = (cle: string) => somme(pages, cle);
  const totaux: Record<string, number> = {};
  for (const cle of Object.values(COMPTEURS)) if (cle !== COMPTEURS.variation) totaux[cle] = t(cle);
  // Variation composée des séances connues.
  const variations = pages.flatMap(p => (COMPTEURS.variation in p.compteurs ? [p.compteurs[COMPTEURS.variation]] : []));
  const variationTotale = variations.length ? (variations.reduce((a, v) => a * (1 + v / 100), 1) - 1) * 100 : undefined;
  if (variationTotale !== undefined) totaux[COMPTEURS.variation] = Math.round(variationTotale * 100) / 100;

  const titre = periode === 'semaine' ? `Récap de la ${semaineLongue(du)}` : `Récap de ${moisLong(du.slice(0, 7))}`;
  const sections: SectionPage[] = [];
  const ajouter = (id: string, titreSection: string, paragraphes: string[]) => paragraphes.length && sections.push({ id, titre: titreSection, paragraphes });

  const actives = pages.filter(p => p.nbEvenements > 0);
  const fort = [...pages].sort((a, b) => b.nbEvenements - a.nbEvenements || (a.jour < b.jour ? -1 : 1))[0];
  const jourFort = fort && fort.nbEvenements > 0 ? { jour: fort.jour, evenements: fort.nbEvenements } : undefined;
  const humeurs = pages.flatMap(p => (p.humeur ? [p.humeur] : []));
  const moyenne = humeurs.length ? humeurs.reduce((a, h) => a + h, 0) / humeurs.length : undefined;
  const humeur = moyenne !== undefined ? { moyenne: Math.round(moyenne * 10) / 10, arrondie: Math.min(5, Math.max(1, Math.round(moyenne))) as Humeur, pages: humeurs.length } : undefined;

  let intro: string;
  if (pages.length === 0) {
    intro = tirer([`Aucune page n’a été écrite ${nom} : le carnet est resté fermé.`, `Rien dans le carnet ${nom} pour l’instant.`], graine);
  } else {
    intro = tirer(
      [
        `${majuscule(nom)}, le carnet compte ${pluriel(pages.length, 'page')} sur ${pluriel(jours, 'jour')}, dont ${pluriel(actives.length, 'journée active', 'journées actives')}.`,
        `${pluriel(pages.length, 'page')} écrites ${nom} (${pluriel(actives.length, 'journée')} avec de l’activité).`,
        `Voici ${nom} en ${pluriel(pages.length, 'page')} : ${pluriel(actives.length, 'journée')} où il s’est passé quelque chose.`,
      ],
      graine,
    );
  }
  if (jourFort) intro += ` ${tirer([`Le jour le plus chargé : ${jourLongMaj(jourFort.jour, false).toLowerCase()} (${pluriel(jourFort.evenements, 'événement')}).`, `Pic d’activité le ${jourLongMaj(jourFort.jour, false).toLowerCase()}, avec ${pluriel(jourFort.evenements, 'événement')}.`], `${graine}|fort`)}`;

  if (pages.length > 0) {
    // Tâches
    const finies = t(COMPTEURS.tachesTerminees);
    const creees = t(COMPTEURS.tachesCreees);
    if (finies || creees) {
      const p: string[] = [];
      if (finies) p.push(tirer([`${majuscule(pluriel(finies, 'tâche'))} terminées ${nom}${creees ? `, pour ${pluriel(creees, 'tâche créée', 'tâches créées')}` : ''}.`, `J’ai bouclé ${pluriel(finies, 'tâche')} ${nom}${creees ? ` et en ai ouvert ${creees}` : ''}.`], `${graine}|t`));
      else p.push(`${majuscule(pluriel(creees, 'tâche créée', 'tâches créées'))} ${nom}, aucune terminée.`);
      if (finies && creees) p.push(finies >= creees ? 'La liste a diminué : bon signe.' : 'La liste a grossi plus vite qu’elle ne s’est vidée.');
      ajouter('taches', 'Les tâches', p);
    }
    // Claude
    const sessions = t(COMPTEURS.sessions);
    if (sessions) ajouter('office', 'Avec Claude', [tirer([`${majuscule(pluriel(sessions, 'session'))} de Claude terminées${t(COMPTEURS.minutesOffice) ? `, soit ${duree(t(COMPTEURS.minutesOffice))} de travail` : ''}.`, `Claude a mené ${pluriel(sessions, 'session')} à leur terme${t(COMPTEURS.minutesOffice) ? ` (${duree(t(COMPTEURS.minutesOffice))})` : ''}.`], `${graine}|o`)]);
    // Tsuzuku
    const eps = t(COMPTEURS.episodes);
    if (eps) ajouter('tsuzuku', 'Détente', [tirer([`${majuscule(pluriel(eps, 'épisode'))} vus ${nom}.`, `Côté détente : ${pluriel(eps, 'épisode')} ${nom}.`], `${graine}|e`)]);
    // Bourse
    const ops = t(COMPTEURS.operations);
    const bourse: string[] = [];
    if (ops) bourse.push(tirer([`${majuscule(pluriel(ops, 'opération'))} enregistrées ${nom} (${pluriel(t(COMPTEURS.achats), 'achat')}, ${pluriel(t(COMPTEURS.ventes), 'vente')}${t(COMPTEURS.dividendes) ? `, ${pluriel(t(COMPTEURS.dividendes), 'dividende')}` : ''}).`, `Le portefeuille a connu ${pluriel(ops, 'opération')} ${nom}.`], `${graine}|b`));
    if (variationTotale !== undefined) bourse.push(`Sur les séances consignées, le portefeuille ${variationTotale >= 0 ? 'gagne' : 'cède'} environ ${pct(Math.abs(variationTotale), false)} ${nom}.`);
    ajouter('portefeuille', 'Côté bourse', bourse);
    // Affaires
    const affaires: string[] = [];
    if (t(COMPTEURS.paiements)) affaires.push(`${majuscule(pluriel(t(COMPTEURS.paiements), 'paiement'))} d’abonnement reçus${t(COMPTEURS.encaisse) ? `, ${eur(t(COMPTEURS.encaisse))} au total` : ''}.`);
    if (t(COMPTEURS.relances)) affaires.push(`${majuscule(pluriel(t(COMPTEURS.relances), 'relance'))} de prospects.`);
    ajouter('affaires', 'Côté affaires', affaires);
    if (t(COMPTEURS.decisions)) ajouter('decisions', 'Décisions', [`${majuscule(pluriel(t(COMPTEURS.decisions), 'décision'))} enregistrées ${nom}.`]);
    if (humeur) {
      ajouter('humeur', 'Humeur', [`Humeur moyenne ${emojiHumeur(humeur.arrondie)} « ${libelleHumeur(humeur.arrondie).toLowerCase()} » (${humeur.moyenne.toString().replace('.', ',')}/5 sur ${pluriel(humeur.pages, 'page')}).`]);
    }
    const epinglees = pages.filter(p => p.epingle);
    if (epinglees.length) ajouter('epingles', 'Jours épinglés', [`À garder : ${liste(epinglees.map(p => jourCourt(p.jour)))}.`]);
  }

  const chiffres: ChiffreCle[] = [];
  const c = (id: string, libelle: string, valeur: string) => chiffres.push({ id, libelle, valeur });
  c('pages', 'Pages écrites', `${pages.length}/${jours}`);
  if (totaux[COMPTEURS.tachesTerminees]) c('taches-finies', 'Tâches terminées', String(totaux[COMPTEURS.tachesTerminees]));
  if (totaux[COMPTEURS.tachesCreees]) c('taches-creees', 'Tâches créées', String(totaux[COMPTEURS.tachesCreees]));
  if (totaux[COMPTEURS.sessions]) c('sessions', 'Sessions Claude', totaux[COMPTEURS.minutesOffice] ? `${totaux[COMPTEURS.sessions]} · ${duree(totaux[COMPTEURS.minutesOffice])}` : String(totaux[COMPTEURS.sessions]));
  if (totaux[COMPTEURS.episodes]) c('episodes', 'Épisodes vus', String(totaux[COMPTEURS.episodes]));
  if (totaux[COMPTEURS.operations]) c('operations', 'Opérations en bourse', String(totaux[COMPTEURS.operations]));
  if (variationTotale !== undefined) c('variation', 'Portefeuille', pct(variationTotale));
  if (totaux[COMPTEURS.paiements]) c('paiements', 'Abonnements encaissés', totaux[COMPTEURS.encaisse] ? eur(totaux[COMPTEURS.encaisse]) : String(totaux[COMPTEURS.paiements]));
  if (totaux[COMPTEURS.relances]) c('relances', 'Prospects relancés', String(totaux[COMPTEURS.relances]));
  if (totaux[COMPTEURS.decisions]) c('decisions', 'Décisions', String(totaux[COMPTEURS.decisions]));
  if (humeur) c('humeur', 'Humeur moyenne', `${emojiHumeur(humeur.arrondie)} ${humeur.moyenne.toString().replace('.', ',')}/5`);

  const marquants = [...pages]
    .filter(p => p.auto.marquant)
    .sort((a, b) => b.nbEvenements - a.nbEvenements || (a.jour < b.jour ? -1 : 1))
    .slice(0, periode === 'semaine' ? 3 : 5)
    .sort((a, b) => (a.jour < b.jour ? -1 : 1))
    .map(p => ({ ...p.auto.marquant!, jour: p.jour }));

  return { periode, du, au, titre, intro, sections, chiffres, marquants, ...(humeur ? { humeur } : {}), ...(jourFort ? { jourFort } : {}), pages: pages.length, jours, totaux };
}
