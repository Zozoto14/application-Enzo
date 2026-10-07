/**
 * Modèle de vue de l'onglet Dividendes.
 *
 * Deux rendements cohabitent, et les confondre est l'erreur classique :
 *
 * - le **rendement sur prix de revient** rapporte les dividendes à ce que la
 *   ligne a coûté. Il ne bouge pas quand le cours bouge, et il monte avec les
 *   années : c'est la mesure du détenteur.
 * - le **rendement courant** les rapporte à la valeur d'aujourd'hui. C'est ce
 *   qu'un acheteur obtiendrait en achetant maintenant.
 *
 * Les deux sont affichés côte à côte, chacun avec son explication.
 *
 * Aucune projection n'est inventée. La seule avancée admise est le report des
 * douze derniers mois, présenté comme tel — et refusé quand l'historique ne
 * couvre pas douze mois, où il ne mesurerait qu'un trou.
 */

import { Decimal } from '../../core/money/decimal';
import type { Compte, Titre, Transaction } from '../../core/domain/types';
import type { EtatPortefeuille } from '../../core/portfolio/engine';
import { formaterDate, formaterMontant, formaterPourcentage, tendance, type Tendance } from '../format';

/** Un dividende encaissé, tel qu'on le montre dans l'historique. */
export interface LigneDividende {
  date: string;
  titre: string;
  compte: string;
  net: string;
  /** Retenue à la source, quand le brut est connu. */
  retenue?: string;
}

export interface LigneAnneeDividendes {
  annee: string;
  total: string;
  /** Écart avec l'année précédente, quand elle existe. */
  evolution?: string;
  tendance: Tendance;
  /** Poids relatif, pour dessiner une barre. */
  fraction: number;
  /** Montant, pour un graphique. */
  valeur: number;
}

export interface LigneMois {
  /** Mois abrégé, « janv. ». */
  mois: string;
  total: string;
  fraction: number;
  /** Montant, pour un graphique. */
  valeur: number;
  /** Vrai si rien n'a été encaissé ce mois-là. */
  vide: boolean;
}

export interface LigneTitreDividendes {
  titreId: string;
  nom: string;
  total: string;
  /** Part dans le total encaissé. */
  part: string;
  fraction: number;
  /** Encaissé sur les douze derniers mois. */
  douzeMois: string;
  /** Dividendes sur douze mois rapportés au prix de revient de la ligne. */
  rendementSurRevient?: string;
  /** Dividendes sur douze mois rapportés à la valeur actuelle. */
  rendementCourant?: string;
  /** Renseigné quand un rendement n'a pas pu être calculé. */
  motifRendement?: string;
}

export interface VueDividendes {
  total: string;
  douzeMois: string;
  /** Moyenne mensuelle sur les douze derniers mois. */
  moyenneMensuelle: string;
  rendementSurRevient: MesureDividende;
  rendementCourant: MesureDividende;
  retenueTotale?: string;
  parAnnee: LigneAnneeDividendes[];
  parMois: LigneMois[];
  parTitre: LigneTitreDividendes[];
  derniers: LigneDividende[];
  aucunDividende: boolean;
  /** Explication affichée quand l'historique ne porte pas douze mois. */
  messageHistorique?: string;
  /** Les douze prochains mois, estimés. */
  calendrier: VueCalendrierDividendes;
}

export interface MoisCalendrier {
  /** « 2026-10 ». */
  cle: string;
  /** « oct. 2026 ». */
  libelle: string;
  valeur: number;
  total: string;
  lignes: Array<{ nom: string; valeur: number; montant: string; date: string; source?: 'versements' | 'historique' }>;
}

export interface VueCalendrierDividendes {
  mois: MoisCalendrier[];
  total: string;
  valeurTotale: number;
  /** Vrai si aucun dividende n'est attendu faute d'historique. */
  vide: boolean;
  /** Salaire passif : total annuel et moyenne par mois. */
  parMoisMoyen: string;
  /** Rendement du portefeuille en dividendes, si la valeur est connue. */
  rendement?: string;
  /** Vrai si une partie vient de l'historique des valeurs et pas de vos versements. */
  depuisHistorique: boolean;
}

/** Dividendes versés par action (historique de la valeur), dans sa devise. */
export interface DividendesParAction {
  devise: string;
  versements: ReadonlyArray<{ date: string; montant: number }>;
}

const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/**
 * Dividendes attendus sur les douze prochains mois.
 *
 * Hypothèse simple et dite comme telle : chaque valeur détenue verse à la
 * même période que l'an dernier, le même montant par action. Le montant
 * reçu l'an dernier est donc ramené à la quantité détenue aujourd'hui.
 */
export function calendrierDividendes(entrees: {
  etat: EtatPortefeuille;
  transactions: readonly Transaction[];
  titres: readonly Titre[];
  aujourdhui: string;
  /**
   * Historique par action, pour les valeurs dont aucun dividende n'a été
   * saisi (portefeuille importé depuis un relevé, achat récent).
   */
  parAction?: ReadonlyMap<string, DividendesParAction>;
  /** Conversion en euros ; sans elle, seules les valeurs en euros comptent. */
  versEuros?(montant: number, devise: string): number | undefined;
  /** Valeur du portefeuille, pour le rendement. */
  valeurPortefeuille?: number;
}): VueCalendrierDividendes {
  const noms = new Map(entrees.titres.map(titre => [titre.id, titre.nom]));
  const detenu = new Map<string, Decimal>();
  for (const position of entrees.etat.positions) {
    detenu.set(position.titreId, (detenu.get(position.titreId) ?? Decimal.ZERO).add(position.quantite));
  }

  const ordonnees = [...entrees.transactions].sort((a, b) => a.date.localeCompare(b.date));
  const quantiteAu = (titreId: string, date: string) => {
    let quantite = Decimal.ZERO;
    for (const transaction of ordonnees) {
      if (transaction.date > date) break;
      if (transaction.type === 'ACHAT' && transaction.titreId === titreId) quantite = quantite.add(transaction.quantite);
      if (transaction.type === 'VENTE' && transaction.titreId === titreId) quantite = quantite.sub(transaction.quantite);
    }
    return quantite;
  };

  const avecVersements = new Set<string>();
  const debut = new Date(`${entrees.aujourdhui}T12:00:00Z`);
  const ilYAUnAn = new Date(debut);
  ilYAUnAn.setUTCFullYear(debut.getUTCFullYear() - 1);
  const limite = ilYAUnAn.toISOString().slice(0, 10);

  const mois: MoisCalendrier[] = Array.from({ length: 12 }, (_, rang) => {
    const date = new Date(Date.UTC(debut.getUTCFullYear(), debut.getUTCMonth() + rang, 1));
    return {
      cle: date.toISOString().slice(0, 7),
      libelle: `${MOIS_COURTS[date.getUTCMonth()]} ${date.getUTCFullYear()}`,
      valeur: 0,
      total: '',
      lignes: [],
    };
  });

  for (const transaction of ordonnees) {
    if (transaction.type !== 'DIVIDENDE' || transaction.date <= limite || transaction.date > entrees.aujourdhui) {
      continue;
    }
    const aujourdhuiDetenu = detenu.get(transaction.titreId);
    const alors = quantiteAu(transaction.titreId, transaction.date);
    if (!aujourdhuiDetenu?.estPositif() || !alors.estPositif()) {
      continue;
    }
    // Même mois, un an plus tard.
    const annee = Number(transaction.date.slice(0, 4)) + 1;
    const cle = `${annee}-${transaction.date.slice(5, 7)}`;
    const cible = mois.find(candidat => candidat.cle === cle);
    if (!cible) continue;
    const valeur = transaction.montantNet.mul(aujourdhuiDetenu).div(alors).toNumber();
    cible.valeur += valeur;
    cible.lignes.push({
      nom: noms.get(transaction.titreId) ?? transaction.titreId,
      valeur,
      montant: formaterMontant(Decimal.de(valeur.toFixed(2))),
      date: `vers le ${Number(transaction.date.slice(8, 10))} ${MOIS_COURTS[Number(transaction.date.slice(5, 7)) - 1]}`,
      source: 'versements',
    });
    avecVersements.add(transaction.titreId);
  }

  // Valeurs sans dividende saisi : l'historique par action, ramené à la
  // quantité détenue aujourd'hui, un an plus tard.
  let depuisHistorique = false;
  for (const [titreId, quantite] of detenu) {
    if (avecVersements.has(titreId) || !quantite.estPositif()) continue;
    const historique = entrees.parAction?.get(titreId);
    if (!historique) continue;
    for (const versement of historique.versements) {
      if (versement.date <= limite || versement.date > entrees.aujourdhui) continue;
      const brut = versement.montant * quantite.toNumber();
      const euros = historique.devise === 'EUR' ? brut : entrees.versEuros?.(brut, historique.devise);
      if (euros === undefined || euros <= 0) continue;
      const cle = `${Number(versement.date.slice(0, 4)) + 1}-${versement.date.slice(5, 7)}`;
      const cible = mois.find(candidat => candidat.cle === cle);
      if (!cible) continue;
      cible.valeur += euros;
      cible.lignes.push({
        nom: noms.get(titreId) ?? titreId,
        valeur: euros,
        montant: formaterMontant(Decimal.de(euros.toFixed(2))),
        date: `vers le ${Number(versement.date.slice(8, 10))} ${MOIS_COURTS[Number(versement.date.slice(5, 7)) - 1]}`,
        source: 'historique',
      });
      depuisHistorique = true;
    }
  }

  const valeurTotale = mois.reduce((somme, ligne) => somme + ligne.valeur, 0);
  for (const ligne of mois) {
    ligne.total = formaterMontant(Decimal.de(ligne.valeur.toFixed(2)));
  }
  return {
    mois,
    total: formaterMontant(Decimal.de(valeurTotale.toFixed(2))),
    valeurTotale,
    vide: valeurTotale === 0,
    parMoisMoyen: formaterMontant(Decimal.de((valeurTotale / 12).toFixed(2))),
    rendement:
      entrees.valeurPortefeuille && entrees.valeurPortefeuille > 0 && valeurTotale > 0
        ? formaterPourcentage(Decimal.de(((valeurTotale / entrees.valeurPortefeuille) * 100).toFixed(4)), 2, { signeExplicite: false })
        : undefined,
    depuisHistorique,
  };
}

export interface MesureDividende {
  valeur: string | null;
  motif?: string;
}

export interface EntreesDividendes {
  etat: EtatPortefeuille;
  transactions: readonly Transaction[];
  comptes: readonly Compte[];
  titres: readonly Titre[];
  cours: ReadonlyMap<string, Decimal>;
  /** Date du jour, au format ISO. */
  aujourdhui: string;
  parAction?: ReadonlyMap<string, DividendesParAction>;
  versEuros?(montant: number, devise: string): number | undefined;
  valeurPortefeuille?: number;
}

const MOIS_ABREGES = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
];

/** Date ISO d'il y a douze mois, bornes de la fenêtre glissante. */
function ilYaUnAn(aujourdhui: string): string {
  const [annee, mois, jour] = aujourdhui.split('-');
  return `${Number(annee) - 1}-${mois}-${jour}`;
}

function moisPrecedents(aujourdhui: string, nombre: number): string[] {
  const annee = Number(aujourdhui.slice(0, 4));
  const mois = Number(aujourdhui.slice(5, 7));
  const cles: string[] = [];

  for (let recul = nombre - 1; recul >= 0; recul--) {
    const total = annee * 12 + (mois - 1) - recul;
    const a = Math.floor(total / 12);
    const m = (total % 12) + 1;
    cles.push(`${a}-${String(m).padStart(2, '0')}`);
  }
  return cles;
}

function rendement(
  dividendes: Decimal,
  base: Decimal,
): { valeur: Decimal; affichage: string } | undefined {
  if (!base.estPositif()) {
    return undefined;
  }
  const valeur = dividendes.div(base).mul(100);
  // Un rendement est un niveau, pas une variation : pas de signe explicite.
  return { valeur, affichage: formaterPourcentage(valeur, 2, { signeExplicite: false }) };
}

export function construireDividendes(entrees: EntreesDividendes): VueDividendes {
  const nomDuTitre = new Map(entrees.titres.map(titre => [titre.id, titre.nom]));
  const nomDuCompte = new Map(entrees.comptes.map(compte => [compte.id, compte.nom]));

  const dividendes = entrees.transactions
    .filter(
      (transaction): transaction is Extract<Transaction, { type: 'DIVIDENDE' }> =>
        transaction.type === 'DIVIDENDE',
    )
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const debutFenetre = ilYaUnAn(entrees.aujourdhui);

  let total = Decimal.ZERO;
  let douzeMois = Decimal.ZERO;
  let retenue = Decimal.ZERO;
  const parAnnee = new Map<string, Decimal>();
  const parMois = new Map<string, Decimal>();
  const parTitre = new Map<string, { total: Decimal; douzeMois: Decimal }>();

  for (const dividende of dividendes) {
    const net = dividende.montantNet;
    total = total.add(net);

    if (dividende.montantBrut) {
      retenue = retenue.add(dividende.montantBrut.sub(net));
    }

    const annee = dividende.date.slice(0, 4);
    parAnnee.set(annee, (parAnnee.get(annee) ?? Decimal.ZERO).add(net));

    const cleMois = dividende.date.slice(0, 7);
    parMois.set(cleMois, (parMois.get(cleMois) ?? Decimal.ZERO).add(net));

    const cumul = parTitre.get(dividende.titreId) ?? {
      total: Decimal.ZERO,
      douzeMois: Decimal.ZERO,
    };
    cumul.total = cumul.total.add(net);

    const dansLaFenetre = dividende.date > debutFenetre;
    if (dansLaFenetre) {
      douzeMois = douzeMois.add(net);
      cumul.douzeMois = cumul.douzeMois.add(net);
    }
    parTitre.set(dividende.titreId, cumul);
  }

  // Bases de rendement : le prix de revient des lignes encore détenues, et
  // leur valeur actuelle. Une ligne vendue a pu verser des dividendes, mais
  // elle n'a plus ni coût ni valeur à rapporter.
  let revientDetenu = Decimal.ZERO;
  let valeurDetenue = Decimal.ZERO;
  const revientParTitre = new Map<string, Decimal>();
  const valeurParTitre = new Map<string, Decimal>();

  for (const position of entrees.etat.positions) {
    revientDetenu = revientDetenu.add(position.coutTotal);
    revientParTitre.set(
      position.titreId,
      (revientParTitre.get(position.titreId) ?? Decimal.ZERO).add(position.coutTotal),
    );

    const cours = entrees.cours.get(position.titreId);
    if (cours) {
      const valeur = position.quantite.mul(cours);
      valeurDetenue = valeurDetenue.add(valeur);
      valeurParTitre.set(
        position.titreId,
        (valeurParTitre.get(position.titreId) ?? Decimal.ZERO).add(valeur),
      );
    }
  }

  // L'historique porte-t-il seulement douze mois ? Sinon le rendement compare
  // une fenetre pleine a une fenetre trouee, et sous-estime toujours.
  const premiere = dividendes.length > 0 ? dividendes[dividendes.length - 1].date : undefined;
  const historiqueComplet = premiere !== undefined && premiere <= debutFenetre;
  const motifHistorique = historiqueComplet
    ? undefined
    : dividendes.length === 0
      ? 'Aucun dividende encaissé.'
      : `Le premier dividende date du ${formaterDate(premiere!)} : moins de douze mois d’historique. Le rendement se calculera sur une année pleine.`;

  const surRevient = historiqueComplet ? rendement(douzeMois, revientDetenu) : undefined;
  const courant = historiqueComplet ? rendement(douzeMois, valeurDetenue) : undefined;

  const maximumAnnee = [...parAnnee.values()].reduce(
    (max, valeur) => Decimal.max(max, valeur),
    Decimal.ZERO,
  );

  const anneesTriees = [...parAnnee.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const lignesAnnees: LigneAnneeDividendes[] = anneesTriees.map(([annee, montant], index) => {
    // Les annees sont triees du plus recent au plus ancien : la precedente
    // est donc la suivante dans le tableau.
    const anterieure = anneesTriees[index + 1];
    const ecart = anterieure ? montant.sub(anterieure[1]) : undefined;

    return {
      annee,
      total: formaterMontant(montant),
      evolution: ecart ? formaterMontant(ecart, { signeExplicite: true }) : undefined,
      tendance: tendance(ecart ?? null),
      fraction: maximumAnnee.estPositif() ? montant.div(maximumAnnee).toNumber() : 0,
      valeur: montant.toNumber(),
    };
  });

  const clesMois = moisPrecedents(entrees.aujourdhui, 12);
  const montantsMois = clesMois.map(cle => parMois.get(cle) ?? Decimal.ZERO);
  const maximumMois = montantsMois.reduce(
    (max, valeur) => Decimal.max(max, valeur),
    Decimal.ZERO,
  );

  const lignesMois: LigneMois[] = clesMois.map((cle, index) => {
    const montant = montantsMois[index];
    return {
      mois: MOIS_ABREGES[Number(cle.slice(5, 7)) - 1],
      total: formaterMontant(montant),
      fraction: maximumMois.estPositif() ? montant.div(maximumMois).toNumber() : 0,
      valeur: montant.toNumber(),
      vide: montant.estZero(),
    };
  });

  const lignesTitres: LigneTitreDividendes[] = [...parTitre.entries()]
    .sort((a, b) => (a[1].total.lt(b[1].total) ? 1 : -1))
    .map(([titreId, cumul]) => {
      const revient = revientParTitre.get(titreId) ?? Decimal.ZERO;
      const valeur = valeurParTitre.get(titreId) ?? Decimal.ZERO;
      const surRevientTitre = historiqueComplet
        ? rendement(cumul.douzeMois, revient)
        : undefined;
      const courantTitre = historiqueComplet ? rendement(cumul.douzeMois, valeur) : undefined;

      const motif = !historiqueComplet
        ? motifHistorique
        : revient.estZero()
          ? 'Ligne soldée : plus de prix de revient auquel rapporter ces dividendes.'
          : valeur.estZero()
            ? 'Cours inconnu : le rendement courant ne peut pas être calculé.'
            : undefined;

      return {
        titreId,
        nom: nomDuTitre.get(titreId) ?? titreId,
        total: formaterMontant(cumul.total),
        part: total.estPositif()
          ? formaterPourcentage(cumul.total.div(total).mul(100), 1, { signeExplicite: false })
          : formaterPourcentage(Decimal.ZERO, 1, { signeExplicite: false }),
        fraction: total.estPositif() ? cumul.total.div(total).toNumber() : 0,
        douzeMois: formaterMontant(cumul.douzeMois),
        rendementSurRevient: surRevientTitre?.affichage,
        rendementCourant: courantTitre?.affichage,
        motifRendement: motif,
      };
    });

  return {
    total: formaterMontant(total),
    douzeMois: formaterMontant(douzeMois),
    moyenneMensuelle: formaterMontant(douzeMois.div(12)),
    rendementSurRevient: {
      valeur: surRevient?.affichage ?? null,
      motif: surRevient
        ? undefined
        : (motifHistorique ??
          'Aucune ligne détenue : le rendement se rapporte aux positions ouvertes.'),
    },
    rendementCourant: {
      valeur: courant?.affichage ?? null,
      motif: courant
        ? undefined
        : (motifHistorique ??
          'Cours inconnus : rafraîchissez les cours pour obtenir le rendement courant.'),
    },
    retenueTotale: retenue.estPositif() ? formaterMontant(retenue) : undefined,
    parAnnee: lignesAnnees,
    parMois: lignesMois,
    parTitre: lignesTitres,
    derniers: dividendes.slice(0, 20).map(dividende => ({
      date: formaterDate(dividende.date),
      titre: nomDuTitre.get(dividende.titreId) ?? dividende.titreId,
      compte: nomDuCompte.get(dividende.compteId) ?? dividende.compteId,
      net: formaterMontant(dividende.montantNet),
      retenue: dividende.montantBrut
        ? formaterMontant(dividende.montantBrut.sub(dividende.montantNet))
        : undefined,
    })),
    aucunDividende: dividendes.length === 0,
    messageHistorique: motifHistorique,
    calendrier: calendrierDividendes(entrees),
  };
}
