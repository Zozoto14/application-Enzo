/**
 * Pilote automatique de semaine : algorithme de placement (pur, déterministe).
 *
 * Mêmes entrées, même semaine : aucune horloge, aucun hasard (tous les tris
 * se terminent par l'identifiant). Les règles :
 *
 *  1. Les événements à date fixe (relances, paiements, versement, dividendes)
 *     restent à leur jour ; un événement en retard est ramené au premier jour
 *     de travail. Ils comptent dans la charge.
 *  2. Les tâches sont triées par urgence : celles qui ont une échéance cette
 *     semaine (ou en retard) ou qui sont urgentes d'abord, par échéance
 *     croissante ; puis les hautes, normales, basses. Les récurrences de la
 *     semaine sont des occurrences à jour imposé.
 *  3. Chaque tâche prend un jour de travail entre son début et son échéance
 *     (toute la semaine si elle est en retard) où la charge maximale et les
 *     créneaux permettent encore de la loger : le plus tôt pour les urgentes,
 *     hautes et en retard ; le jour le moins chargé pour les autres. Sans
 *     place avant l'échéance : « non placée » (à arbitrer), jamais forcée.
 *  4. Dans la journée, les événements passent d'abord, puis les tâches par
 *     priorité et échéance ; l'heure se range dans les créneaux de travail.
 *  5. Récompenses : les soirs des jours où du travail est prévu (donc fini
 *     dans la charge permise), après le travail et à partir de l'heure de
 *     soirée, au plus N épisodes.
 */

import {
  FIN_SOIREE,
  RANG_PRIORITE_PILOTE,
  type BilanJour,
  type ElementSemaine,
  type EntreePilote,
  type EpisodeRecompense,
  type GenreEvenement,
  type ReglagesPilote,
  type Semaine,
  type TachePlanifiable,
} from './contrats';
import { ajouterJours, heureDeMinutes, instantLocal, jourSemaine, jourValide, minutesDe, septJours } from './jours';

const DUREE_EVENEMENT: Record<GenreEvenement, number> = { relance: 15, paiement: 10, versement: 15, dividende: 10 };
const GENRES_EVENEMENT: readonly string[] = ['relance', 'paiement', 'versement', 'dividende'];
const FIN_JOURNEE = 24 * 60 - 1;
const SANS_DATE = '9999-99-99';

export const estEvenement = (g: ElementSemaine['genre']): boolean => GENRES_EVENEMENT.includes(g);
const compte = (e: ElementSemaine) => e.genre !== 'episode';

interface Plage {
  a: number;
  b: number;
}

const plagesDe = (r: ReglagesPilote): Plage[] => r.creneaux.map(c => ({ a: minutesDe(c.debut), b: minutesDe(c.fin) }));
const plusLongCreneau = (r: ReglagesPilote): number => Math.max(15, ...plagesDe(r).map(p => p.b - p.a));
const cmpTexte = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const cmpOrdre = (a: ElementSemaine, b: ElementSemaine) => a.ordre - b.ordre || cmpTexte(a.id, b.id);

/** Ordre d'une journée à la génération : événements, puis tâches par priorité, échéance, identifiant. */
function cmpAuto(a: ElementSemaine, b: ElementSemaine): number {
  const ea = estEvenement(a.genre) ? 0 : 1;
  const eb = estEvenement(b.genre) ? 0 : 1;
  if (ea !== eb) return ea - eb;
  const pa = a.priorite ? RANG_PRIORITE_PILOTE[a.priorite] : 2;
  const pb = b.priorite ? RANG_PRIORITE_PILOTE[b.priorite] : 2;
  return pa - pb || cmpTexte(a.echeance ?? SANS_DATE, b.echeance ?? SANS_DATE) || cmpTexte(a.id, b.id);
}

/** Copie sans les champs donnés. */
const sansChamps = (e: ElementSemaine, ...cles: Array<keyof ElementSemaine>): ElementSemaine => {
  const copie = { ...e } as Record<string, unknown>;
  for (const c of cles) delete copie[c];
  return copie as unknown as ElementSemaine;
};
const sansHoraire = (e: ElementSemaine): ElementSemaine => sansChamps(e, 'debut', 'fin');

function soustraire(plages: Plage[], a: number, b: number): Plage[] {
  const sortie: Plage[] = [];
  for (const p of plages) {
    if (b <= p.a || a >= p.b) sortie.push(p);
    else {
      if (a > p.a) sortie.push({ a: p.a, b: a });
      if (b < p.b) sortie.push({ a: b, b: p.b });
    }
  }
  return sortie;
}

/** Un événement sans heure, un jour sans travail : une ligne « toute la journée », qui ne prend ni créneau ni charge. */
const journeeSeule = (e: ElementSemaine, off: boolean): boolean => off && estEvenement(e.genre) && !e.epingle;

/**
 * Range les éléments d'UN jour dans les créneaux : épinglés à leur heure, puis
 * les autres dans l'ordre (rang `ordre`) à la suite, puis les épisodes le soir.
 * Marque `surcharge` ce qui ne tient pas dans les créneaux ou dépasse la charge
 * maximale du jour. Pure.
 */
export function empaqueterJour(items: readonly ElementSemaine[], r: ReglagesPilote, jour: string): ElementSemaine[] {
  const off = r.joursOff.includes(jourSemaine(jour));
  const travail = items.filter(compte).sort(cmpOrdre);
  const episodes = items.filter(e => !compte(e)).sort(cmpOrdre);
  const epingles = travail.filter(e => e.epingle && e.debut);
  const libres = travail.filter(e => !(e.epingle && e.debut));
  let trous = plagesDe(r);
  for (const e of epingles) {
    const a = minutesDe(e.debut!);
    trous = soustraire(trous, a, a + e.dureeMin);
  }
  trous.sort((x, y) => x.a - y.a);
  const sortie: ElementSemaine[] = [];
  let cumul = 0;
  for (const e of epingles) {
    cumul += e.dureeMin;
    const a = minutesDe(e.debut!);
    sortie.push({ ...e, jour, fin: heureDeMinutes(a + e.dureeMin), surcharge: cumul > r.chargeMax || undefined, jourOff: off || undefined });
  }
  let t = 0;
  let curseur = trous[0]?.a ?? 0;
  for (const e of libres) {
    if (journeeSeule(e, off)) {
      sortie.push({ ...sansHoraire(e), jour, surcharge: undefined, jourOff: undefined });
      continue;
    }
    cumul += e.dureeMin;
    let place: number | undefined;
    for (let g = t; g < trous.length; g++) {
      const debut = g === t ? Math.max(trous[g].a, curseur) : trous[g].a;
      if (debut + e.dureeMin <= trous[g].b) {
        place = debut;
        t = g;
        curseur = debut + e.dureeMin;
        break;
      }
    }
    const trop = cumul > r.chargeMax;
    if (place === undefined) sortie.push({ ...sansHoraire(e), jour, surcharge: true, jourOff: off || undefined });
    else sortie.push({ ...e, jour, debut: heureDeMinutes(place), fin: heureDeMinutes(place + e.dureeMin), surcharge: trop || undefined, jourOff: off || undefined });
  }
  // Soirée : après le travail, à partir de l'heure de soirée.
  let debutSoir = minutesDe(r.soirDebut);
  for (const e of sortie) if (e.fin && compte(e)) debutSoir = Math.max(debutSoir, minutesDe(e.fin));
  const limite = minutesDe(FIN_SOIREE);
  for (const e of episodes) {
    const fin = debutSoir + e.dureeMin;
    sortie.push({ ...e, jour, debut: heureDeMinutes(debutSoir), fin: heureDeMinutes(Math.min(FIN_JOURNEE, fin)), surcharge: fin > limite || undefined, jourOff: undefined });
    debutSoir = fin;
  }
  return sortie.map(nettoyer).sort(trierJour);
}

function nettoyer(e: ElementSemaine): ElementSemaine {
  const sortie = { ...e } as unknown as Record<string, unknown>;
  for (const k of Object.keys(sortie)) if (sortie[k] === undefined) delete sortie[k];
  return sortie as unknown as ElementSemaine;
}

const trierJour = (a: ElementSemaine, b: ElementSemaine) => cmpTexte(a.debut ?? '~', b.debut ?? '~') || a.ordre - b.ordre || cmpTexte(a.id, b.id);
const trierSemaine = (a: ElementSemaine, b: ElementSemaine) => cmpTexte(a.jour, b.jour) || trierJour(a, b);

/** Charge d'un jour (minutes) : tout sauf les épisodes et les lignes « journée ». */
export const chargeDe = (items: readonly ElementSemaine[], r: ReglagesPilote, jour: string): number => {
  const off = r.joursOff.includes(jourSemaine(jour));
  return items.filter(e => compte(e) && !journeeSeule(e, off)).reduce((n, e) => n + e.dureeMin, 0);
};

function entierBorne(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(n)));
}

interface Candidat {
  el: ElementSemaine;
  candidats: string[];
  bucket: number;
  limite: string;
  tot: boolean;
  nonPlace?: 'jours-off';
}

/** Propose la semaine idéale. */
export function proposerSemaine(e: EntreePilote, genereLe = 0): Semaine {
  const r = e.reglages;
  const jours = septJours(e.debut);
  const dernier = jours[6];
  const off = new Set(r.joursOff);
  const ouvres = jours.filter(j => j >= e.aujourdhui && !off.has(jourSemaine(j)));
  const premier = ouvres[0];
  const parJour = new Map<string, ElementSemaine[]>(jours.map(j => [j, []]));
  const nonPlaces: ElementSemaine[] = [];
  const plafond = Math.min(r.chargeMax, plusLongCreneau(r));

  const remettreEnOrdre = (j: string) => {
    const liste = parJour.get(j)!;
    liste.sort(cmpAuto);
    liste.forEach((x, i) => (x.ordre = i));
  };

  // 1. Événements à date fixe.
  const evenements = [...e.evenements].sort((a, b) => cmpTexte(a.jour, b.jour) || cmpTexte(a.heure ?? '', b.heure ?? '') || cmpTexte(a.id, b.id));
  for (const ev of evenements) {
    if (!jourValide(ev.jour) || ev.jour > dernier) continue;
    const enRetard = Boolean(ev.retard) || ev.jour < e.aujourdhui || ev.jour < e.debut;
    const jour = enRetard ? (premier ?? jours.find(j => j >= e.aujourdhui) ?? jours[0]) : ev.jour;
    const el: ElementSemaine = {
      id: `${ev.genre}:${ev.id}`,
      genre: ev.genre,
      refId: ev.id,
      titre: ev.titre,
      ...(ev.detail ? { detail: ev.detail } : {}),
      jour,
      dureeMin: entierBorne(ev.dureeMin ?? DUREE_EVENEMENT[ev.genre], 5, 240),
      ...(enRetard ? { retard: true } : {}),
      ...(!enRetard && ev.heure ? { epingle: true, debut: ev.heure } : {}),
      ordre: 0,
    };
    parJour.get(jour)!.push(el);
  }
  for (const j of jours) remettreEnOrdre(j);

  // 2. Tâches et récurrences, en candidats.
  const tentative = (j: string, el: ElementSemaine): boolean => empaqueterJour([...parJour.get(j)!, { ...el, ordre: 9999 }], r, j).every(x => !x.surcharge);
  const liste: Candidat[] = [];
  const taches = [...e.taches].sort((a, b) => cmpTexte(a.id, b.id));
  const duree = (t: TachePlanifiable) => {
    const voulue = entierBorne(t.dureeMin ?? r.dureeDefaut, 5, 24 * 60);
    return { dureeMin: Math.min(voulue, plafond), plafonnee: voulue > plafond };
  };
  const base = (t: TachePlanifiable, id: string, genre: 'tache' | 'repetition'): ElementSemaine => {
    const d = duree(t);
    return {
      id,
      genre,
      refId: t.id,
      titre: t.titre,
      ...(t.projet ? { detail: t.projet } : {}),
      jour: '',
      dureeMin: d.dureeMin,
      priorite: t.priorite,
      ...(t.echeance ? { echeance: t.echeance } : {}),
      ...(d.plafonnee ? { plafonnee: true } : {}),
      ordre: 0,
    };
  };
  for (const t of taches) {
    const ech = t.echeance && jourValide(t.echeance) ? t.echeance : undefined;
    const retard = ech !== undefined && (premier === undefined ? ech < e.aujourdhui : ech < premier);
    const de = [premier ?? '', t.debut && jourValide(t.debut) ? t.debut : ''].reduce((a, b) => (a > b ? a : b));
    const a = retard || !ech ? dernier : ech < dernier ? ech : dernier;
    const el = base(t, `tache:${t.id}`, 'tache');
    const priorite = RANG_PRIORITE_PILOTE[t.priorite];
    const bucket = retard || (ech !== undefined && ech <= dernier) || t.priorite === 'urgente' ? 0 : Math.max(1, priorite);
    liste.push({ el: retard ? { ...el, retard: true } : el, candidats: ouvres.filter(j => j >= de && j <= a), bucket, limite: retard ? '0000-00-00' : (ech ?? SANS_DATE), tot: retard || priorite <= 1 });
    for (const rep of [...new Set(t.repetitions ?? [])].sort()) {
      if (!jourValide(rep) || rep < e.debut || rep > dernier || rep < e.aujourdhui || rep === ech) continue;
      liste.push({ el: { ...base(t, `repetition:${t.id}@${rep}`, 'repetition'), echeance: rep }, candidats: ouvres.filter(j => j === rep), bucket: 0, limite: rep, tot: true });
    }
  }
  liste.sort(
    (x, y) =>
      x.bucket - y.bucket ||
      cmpTexte(x.limite, y.limite) ||
      (x.el.genre === y.el.genre ? 0 : x.el.genre === 'repetition' ? -1 : 1) ||
      RANG_PRIORITE_PILOTE[x.el.priorite ?? 'normale'] - RANG_PRIORITE_PILOTE[y.el.priorite ?? 'normale'] ||
      cmpTexte(x.el.id, y.el.id),
  );

  // 3. Placement.
  for (const c of liste) {
    if (c.candidats.length === 0) {
      nonPlaces.push({ ...c.el, raison: 'jours-off' });
      continue;
    }
    const possibles = c.candidats.filter(j => tentative(j, c.el));
    if (possibles.length === 0) {
      nonPlaces.push({ ...c.el, raison: 'charge' });
      continue;
    }
    let choisi = possibles[0];
    if (!c.tot) {
      let mini = chargeDe(parJour.get(choisi)!, r, choisi);
      for (const j of possibles) {
        const ch = chargeDe(parJour.get(j)!, r, j);
        if (ch < mini) {
          mini = ch;
          choisi = j;
        }
      }
    }
    const el = { ...c.el, jour: choisi, ...(c.el.echeance && choisi > c.el.echeance ? { apresEcheance: true } : {}) };
    parJour.get(choisi)!.push(el);
    remettreEnOrdre(choisi);
  }

  // 4. Récompenses : le soir des jours où du travail est prévu.
  if (r.recompenses && e.episodes.length) {
    let suivant = 0;
    for (const j of ouvres) {
      const jourEl = empaqueterJour(parJour.get(j)!, r, j);
      const travail = jourEl.some(x => (x.genre === 'tache' || x.genre === 'repetition') && x.debut);
      if (!travail) continue;
      let fin = minutesDe(r.soirDebut);
      for (const x of jourEl) if (x.fin) fin = Math.max(fin, minutesDe(x.fin));
      let n = 0;
      while (suivant < e.episodes.length && n < r.episodesParJour) {
        const ep = e.episodes[suivant];
        const dMin = entierBorne(ep.dureeMin, 5, 240);
        if (fin + dMin > minutesDe(FIN_SOIREE)) break;
        parJour.get(j)!.push(elementEpisode(ep, j, 1000 + n, dMin));
        fin += dMin;
        n++;
        suivant++;
      }
    }
  }

  // 5. Heures.
  const elements = jours.flatMap(j => empaqueterJour(parJour.get(j)!, r, j));
  return { debut: e.debut, genereLe, elements: elements.sort(trierSemaine), nonPlaces: nonPlaces.sort(trierNonPlaces), retires: [] };
}

const trierNonPlaces = (a: ElementSemaine, b: ElementSemaine) => cmpTexte(a.echeance ?? SANS_DATE, b.echeance ?? SANS_DATE) || cmpTexte(a.id, b.id);

function elementEpisode(ep: EpisodeRecompense, jour: string, ordre: number, dureeMin: number): ElementSemaine {
  return { id: `episode:${ep.id}`, genre: 'episode', refId: ep.id, titre: `${ep.titre}, épisode ${ep.episode}`, jour, dureeMin, ordre, animeId: ep.animeId, episode: ep.episode };
}

// ------------------------------------------------------------------ Modifications de l'utilisateur

function repaquer(s: Semaine, r: ReglagesPilote, jours: readonly string[]): Semaine {
  let elements = s.elements;
  for (const j of new Set(jours)) {
    if (!j) continue;
    const du = elements.filter(e => e.jour === j);
    elements = [...elements.filter(e => e.jour !== j), ...empaqueterJour(du, r, j)];
  }
  return { ...s, elements: elements.sort(trierSemaine) };
}

const chercher = (s: Semaine, id: string): { el: ElementSemaine; liste: 'elements' | 'nonPlaces' | 'retires' } | undefined => {
  for (const liste of ['elements', 'nonPlaces', 'retires'] as const) {
    const el = s[liste].find(x => x.id === id);
    if (el) return { el, liste };
  }
  return undefined;
};

/**
 * Déplace un élément (ou place un élément non placé / retiré) sur un jour de
 * la semaine, à la fin de la journée. Ne refuse pas une surcharge : elle est
 * signalée (`surcharge`), l'utilisateur décide.
 */
export function deplacerElement(s: Semaine, r: ReglagesPilote, id: string, jour: string): Semaine {
  const trouve = chercher(s, id);
  if (!trouve || !septJours(s.debut).includes(jour)) return s;
  const { el, liste } = trouve;
  if (liste === 'elements' && el.jour === jour) return s;
  const ancien = liste === 'elements' ? el.jour : '';
  const ordre = Math.max(-1, ...s.elements.filter(x => x.jour === jour && compte(x)).map(x => x.ordre)) + 1;
  const nouveau: ElementSemaine = { ...sansChamps(el, 'debut', 'fin', 'raison', 'epingle', 'apresEcheance', 'surcharge'), jour, ordre: el.genre === 'episode' ? 1000 + ordre : ordre, ...(el.echeance && el.genre === 'tache' && jour > el.echeance ? { apresEcheance: true } : {}) };
  const suivante: Semaine = {
    ...s,
    elements: [...s.elements.filter(x => x.id !== id), nouveau],
    nonPlaces: s.nonPlaces.filter(x => x.id !== id),
    retires: s.retires.filter(x => x.id !== id),
  };
  return repaquer(suivante, r, [ancien, jour]);
}

/** Décale d'un nombre de jours, sans sortir de la semaine. */
export function decalerElement(s: Semaine, r: ReglagesPilote, id: string, delta: number): Semaine {
  const t = chercher(s, id);
  if (!t || !t.el.jour) return s;
  const jours = septJours(s.debut);
  const i = jours.indexOf(t.el.jour) + delta;
  return i < 0 || i > 6 ? s : deplacerElement(s, r, id, jours[i]);
}

/** Retire un élément de la semaine (on peut le remettre). */
export function retirerElement(s: Semaine, r: ReglagesPilote, id: string): Semaine {
  const trouve = chercher(s, id);
  if (!trouve || trouve.liste === 'retires') return s;
  const { el, liste } = trouve;
  const retire = { ...el, raison: 'retire' as const };
  const suivante: Semaine = {
    ...s,
    elements: s.elements.filter(x => x.id !== id),
    nonPlaces: s.nonPlaces.filter(x => x.id !== id),
    retires: [...s.retires, retire].sort(trierNonPlaces),
  };
  return repaquer(suivante, r, [liste === 'elements' ? el.jour : '']);
}

/** Remet un élément retiré à son jour d'origine (ou au premier jour de travail s'il n'en avait pas). */
export function remettreElement(s: Semaine, r: ReglagesPilote, id: string): Semaine {
  const el = s.retires.find(x => x.id === id);
  if (!el) return s;
  const jours = septJours(s.debut);
  const off = new Set(r.joursOff);
  const cible = jours.includes(el.jour) ? el.jour : (jours.find(j => !off.has(jourSemaine(j))) ?? jours[0]);
  return deplacerElement(s, r, id, cible);
}

// ------------------------------------------------------------------ Lecture

export function bilanJours(s: Semaine, r: ReglagesPilote): BilanJour[] {
  return septJours(s.debut).map(jour => {
    const du = s.elements.filter(e => e.jour === jour);
    const off = r.joursOff.includes(jourSemaine(jour));
    const charge = chargeDe(du, r, jour);
    return { jour, charge, capacite: off ? 0 : r.chargeMax, off, depasse: charge > r.chargeMax || du.some(e => e.surcharge), episodes: du.filter(e => e.genre === 'episode').length };
  });
}

export interface ResumeSemaine {
  taches: number;
  repetitions: number;
  relances: number;
  paiements: number;
  portefeuille: number;
  episodes: number;
  minutesTravail: number;
  nonPlaces: number;
}

export function resumerSemaine(s: Semaine): ResumeSemaine {
  const n = (f: (e: ElementSemaine) => boolean) => s.elements.filter(f).length;
  return {
    taches: n(e => e.genre === 'tache'),
    repetitions: n(e => e.genre === 'repetition'),
    relances: n(e => e.genre === 'relance'),
    paiements: n(e => e.genre === 'paiement'),
    portefeuille: n(e => e.genre === 'versement' || e.genre === 'dividende'),
    episodes: n(e => e.genre === 'episode'),
    minutesTravail: s.elements.filter(e => e.genre === 'tache' || e.genre === 'repetition').reduce((m, e) => m + e.dureeMin, 0),
    nonPlaces: s.nonPlaces.length,
  };
}

export interface EtatRecompense {
  /** Débloqué quand toutes les tâches du jour sont faites (visuel seulement : l'accès à Tsuzuku n'est jamais bloqué). */
  debloque: boolean;
  /** Tâches du jour pas encore faites. */
  restant: number;
}

/**
 * Récompenses d'une semaine : un épisode se « débloque » quand toutes les
 * tâches (réelles) placées le même jour sont faites. Un jour sans tâche réelle
 * (récurrences seules) est débloqué. `faites` : identifiants de tâches terminées.
 */
export function etatRecompenses(s: Semaine, faites: ReadonlySet<string>): Record<string, EtatRecompense> {
  const sortie: Record<string, EtatRecompense> = {};
  for (const ep of s.elements.filter(e => e.genre === 'episode')) {
    const restant = s.elements.filter(e => e.jour === ep.jour && e.genre === 'tache' && !faites.has(e.refId)).length;
    sortie[ep.id] = { debloque: restant === 0, restant };
  }
  return sortie;
}

// ------------------------------------------------------------------ Quand proposer

/**
 * Dernier passage du jour et de l'heure de la proposition (« dimanche 18 h »)
 * au plus tard à `maintenant`.
 */
export function derniereProposition(maintenant: number, r: Pick<ReglagesPilote, 'jour' | 'heure'>, aujourdhui: string): { instant: number; jour: string } {
  for (let i = 0; i <= 7; i++) {
    const jour = ajouterJours(aujourdhui, -i);
    if (jourSemaine(jour) !== r.jour) continue;
    const instant = instantLocal(jour, r.heure);
    if (instant <= maintenant) return { instant, jour };
  }
  const jour = ajouterJours(aujourdhui, -7);
  return { instant: instantLocal(jour, r.heure), jour };
}

/** Lundi de la semaine proposée : le premier lundi après le jour de la proposition. */
export function semaineProposee(maintenant: number, r: Pick<ReglagesPilote, 'jour' | 'heure'>, aujourdhui: string): { lundi: string; instant: number } {
  const p = derniereProposition(maintenant, r, aujourdhui);
  return { lundi: ajouterJours(p.jour, 8 - jourSemaine(p.jour)), instant: p.instant };
}
