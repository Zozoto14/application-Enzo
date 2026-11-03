/**
 * Journal automatique : modèle d'une page et stockage dans la base chiffrée du
 * PROFIL ouvert (clé/valeur, `BasePrefs`).
 *
 * Une page par jour, regroupées par mois : une clé `journal.mois.AAAA-MM`
 * contient toutes les pages du mois (un seul enregistrement, une seule
 * écriture par page). Les clés ne sont pas dans la synchronisation du relais :
 * le journal n'ajoute AUCUNE écriture sur le relais (limite d'environ 1000 par
 * jour). Tout ce qui vient de la base est revalidé à la lecture.
 */

import type { FamilleEvenement } from '../hub/journal/contrat';
import { FAMILLES } from '../hub/journal/contrat';
import { jourValide, moisDe, moisValide } from './dates';
import type { NomIcone } from '../ui/icones/traces';

/** Ce que l'hôte donne : la base clé/valeur du profil (même forme que `BasePrefs` de Tsuzuku). */
export interface BaseJournal {
  lire(cle: string): string | undefined | null;
  ecrire(cle: string, valeur: string): void;
}

export const CLES_JOURNAL = {
  reglages: 'journal.reglages',
  /** Pages d'un mois : `journal.mois.AAAA-MM`. */
  mois: 'journal.mois.',
  /** Liste des mois qui ont au moins une page. */
  index: 'journal.index',
  /** Petit résumé (nombre de pages, épinglées) : la tuile du hub le lit sans ouvrir les mois. */
  resume: 'journal.resume',
} as const;

// ------------------------------------------------------------------ Humeur

export type Humeur = 1 | 2 | 3 | 4 | 5;
/** Humeurs du jour : icône monochrome (visage, src/ui/icones) et libellé ; l'export écrit le libellé seul. */
export const HUMEURS: ReadonlyArray<{ valeur: Humeur; icone: NomIcone; libelle: string }> = [
  { valeur: 1, icone: 'triste', libelle: 'Difficile' },
  { valeur: 2, icone: 'bof', libelle: 'Bof' },
  { valeur: 3, icone: 'moyen', libelle: 'Moyenne' },
  { valeur: 4, icone: 'content', libelle: 'Bonne' },
  { valeur: 5, icone: 'ravi', libelle: 'Excellente' },
];
export const humeurValide = (v: unknown): v is Humeur => v === 1 || v === 2 || v === 3 || v === 4 || v === 5;
export const libelleHumeur = (h: Humeur | undefined): string => HUMEURS.find(x => x.valeur === h)?.libelle ?? '';
export const iconeHumeur = (h: Humeur | undefined): NomIcone | undefined => HUMEURS.find(x => x.valeur === h)?.icone;

// ------------------------------------------------------------------ Réglages

export interface ReglagesJournal {
  v: 1;
  /** Écriture automatique chaque soir. */
  actif: boolean;
  /** Heure de l'écriture (12–23). */
  heure: number;
  /** Premier jour couvert (AAAA-MM-JJ) : le journal ne remonte pas avant le jour de son activation. */
  depuis: string;
  /** Rédaction par IA (point d'extension) : désactivée par défaut, ne fait rien sans rédacteur branché. */
  ia: boolean;
}

export const HEURE_DEFAUT = 21;
export const HEURE_MIN = 12;
export const HEURE_MAX = 23;
export const bornerHeure = (h: unknown): number => {
  const n = typeof h === 'number' && Number.isFinite(h) ? Math.round(h) : HEURE_DEFAUT;
  return Math.min(HEURE_MAX, Math.max(HEURE_MIN, n));
};

export function reglagesParDefaut(aujourdhui: string): ReglagesJournal {
  return { v: 1, actif: true, heure: HEURE_DEFAUT, depuis: aujourdhui, ia: false };
}

/** Réglages enregistrés, ou `undefined` si le journal n'a jamais été activé sur ce profil. */
export function lireReglages(base: Pick<BaseJournal, 'lire'> | undefined): ReglagesJournal | undefined {
  try {
    const brut = base?.lire(CLES_JOURNAL.reglages);
    if (!brut) return undefined;
    const o = JSON.parse(brut) as Partial<ReglagesJournal> | null;
    if (!o || typeof o !== 'object' || !jourValide(o.depuis)) return undefined;
    return { v: 1, actif: o.actif !== false, heure: bornerHeure(o.heure), depuis: o.depuis, ia: o.ia === true };
  } catch {
    return undefined;
  }
}

export function ecrireReglages(base: BaseJournal, reglages: ReglagesJournal): void {
  base.ecrire(CLES_JOURNAL.reglages, JSON.stringify({ ...reglages, heure: bornerHeure(reglages.heure) }));
}

// ------------------------------------------------------------------ Page

export interface SectionPage {
  id: string;
  titre: string;
  famille?: FamilleEvenement;
  paragraphes: string[];
}

export interface ChiffreCle {
  id: string;
  libelle: string;
  valeur: string;
}

export interface FaitMarquant {
  texte: string;
  famille: FamilleEvenement;
}

/** Partie rédigée par l'app (régénérable sans toucher à la note ni à l'humeur). */
export interface TexteAuto {
  /** « Une journée bien remplie » : sous le titre de la page. */
  accroche: string;
  intro: string;
  sections: SectionPage[];
  chiffres: ChiffreCle[];
  marquant?: FaitMarquant;
  cloture: string;
  /** Qui a écrit : les modèles de phrases, le rédacteur externe (IA), ou personne (page créée par une note avant l'écriture automatique). */
  moteur: 'modeles' | 'ia' | 'vide';
}

export interface PageJournal {
  v: 1;
  jour: string;
  auto: TexteAuto;
  /** Compteurs de la journée, additionnés par les récapitulatifs (clés : voir `agregation.ts`). */
  compteurs: Record<string, number>;
  /** Nombre d'événements lus ce jour-là (0 : journée calme). */
  nbEvenements: number;
  /** Sources qui n'ont pas répondu (la page a été écrite sans elles). */
  sourcesEnEchec?: string[];
  /** Note personnelle de l'utilisateur. */
  note?: string;
  humeur?: Humeur;
  epingle?: boolean;
  /** Horodatage ISO de l'écriture automatique. */
  ecritLe: string;
  /** Horodatage ISO de la dernière modification de la note, de l'humeur ou de l'épingle. */
  modifieLe?: string;
}

export const BORNES_JOURNAL = { note: 8000, texte: 4000, sections: 12, paragraphes: 12, chiffres: 12 } as const;

const chaine = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, max) : '');
const famille = (v: unknown): FamilleEvenement => (FAMILLES as readonly unknown[]).includes(v) ? (v as FamilleEvenement) : 'autre';

function texteAutoValide(brut: unknown): TexteAuto | undefined {
  const o = brut as Partial<TexteAuto> | null;
  if (!o || typeof o !== 'object') return undefined;
  const sections = (Array.isArray(o.sections) ? o.sections : []).slice(0, BORNES_JOURNAL.sections).flatMap((s): SectionPage[] => {
    const x = s as Partial<SectionPage> | null;
    if (!x || typeof x !== 'object' || typeof x.titre !== 'string') return [];
    const paragraphes = (Array.isArray(x.paragraphes) ? x.paragraphes : []).slice(0, BORNES_JOURNAL.paragraphes).map(p => chaine(p, BORNES_JOURNAL.texte)).filter(Boolean);
    return [{ id: chaine(x.id, 40), titre: chaine(x.titre, 120), ...(x.famille ? { famille: famille(x.famille) } : {}), paragraphes }];
  });
  const chiffres = (Array.isArray(o.chiffres) ? o.chiffres : []).slice(0, BORNES_JOURNAL.chiffres).flatMap((c): ChiffreCle[] => {
    const x = c as Partial<ChiffreCle> | null;
    return x && typeof x.libelle === 'string' && typeof x.valeur === 'string' ? [{ id: chaine(x.id, 40), libelle: chaine(x.libelle, 80), valeur: chaine(x.valeur, 80) }] : [];
  });
  const m = o.marquant as Partial<FaitMarquant> | undefined;
  return {
    accroche: chaine(o.accroche, 200),
    intro: chaine(o.intro, BORNES_JOURNAL.texte),
    sections,
    chiffres,
    ...(m && typeof m.texte === 'string' ? { marquant: { texte: chaine(m.texte, BORNES_JOURNAL.texte), famille: famille(m.famille) } } : {}),
    cloture: chaine(o.cloture, BORNES_JOURNAL.texte),
    moteur: o.moteur === 'ia' ? 'ia' : o.moteur === 'vide' ? 'vide' : 'modeles',
  };
}

/** Page revalidée (tout ce qui vient de la base passe par là), ou `undefined`. */
export function pageValide(brut: unknown): PageJournal | undefined {
  const o = brut as Partial<PageJournal> | null;
  if (!o || typeof o !== 'object' || !jourValide(o.jour)) return undefined;
  const auto = texteAutoValide(o.auto);
  if (!auto) return undefined;
  const compteurs: Record<string, number> = {};
  if (o.compteurs && typeof o.compteurs === 'object') {
    for (const [k, v] of Object.entries(o.compteurs).slice(0, 40)) if (typeof v === 'number' && Number.isFinite(v)) compteurs[chaine(k, 40)] = v;
  }
  const note = chaine(o.note, BORNES_JOURNAL.note);
  return {
    v: 1,
    jour: o.jour,
    auto,
    compteurs,
    nbEvenements: typeof o.nbEvenements === 'number' && o.nbEvenements >= 0 ? Math.floor(o.nbEvenements) : 0,
    ...(Array.isArray(o.sourcesEnEchec) ? { sourcesEnEchec: o.sourcesEnEchec.filter((s): s is string => typeof s === 'string').slice(0, 12).map(s => chaine(s, 60)) } : {}),
    ...(note ? { note } : {}),
    ...(humeurValide(o.humeur) ? { humeur: o.humeur } : {}),
    ...(o.epingle === true ? { epingle: true } : {}),
    ecritLe: typeof o.ecritLe === 'string' ? chaine(o.ecritLe, 40) : '',
    ...(typeof o.modifieLe === 'string' ? { modifieLe: chaine(o.modifieLe, 40) } : {}),
  };
}

// ------------------------------------------------------------------ Stockage par mois

export type PagesDuMois = Record<string, PageJournal>;

export function lireMois(base: Pick<BaseJournal, 'lire'> | undefined, mois: string): PagesDuMois {
  if (!moisValide(mois)) return {};
  try {
    const brut = base?.lire(CLES_JOURNAL.mois + mois);
    if (!brut) return {};
    const o = JSON.parse(brut) as { pages?: Record<string, unknown> } | null;
    const sortie: PagesDuMois = {};
    for (const [jour, p] of Object.entries(o?.pages ?? {})) {
      const page = pageValide(p);
      if (page && page.jour === jour && moisDe(jour) === mois) sortie[jour] = page;
    }
    return sortie;
  } catch {
    return {};
  }
}

export function lireIndex(base: Pick<BaseJournal, 'lire'> | undefined): string[] {
  try {
    const brut = base?.lire(CLES_JOURNAL.index);
    const liste = brut ? (JSON.parse(brut) as unknown) : [];
    return Array.isArray(liste) ? [...new Set(liste.filter(moisValide))].sort() : [];
  } catch {
    return [];
  }
}

export function lirePage(base: Pick<BaseJournal, 'lire'> | undefined, jour: string): PageJournal | undefined {
  return lireMois(base, moisDe(jour))[jour];
}

export interface ResumeJournal {
  pages: number;
  epinglees: number;
}

/** Résumé tenu à jour à chaque écriture ; recalculé (une fois) s'il manque. */
export function lireResume(base: Pick<BaseJournal, 'lire'> | undefined): ResumeJournal {
  try {
    const o = JSON.parse(base?.lire(CLES_JOURNAL.resume) ?? 'null') as Partial<ResumeJournal> | null;
    if (o && typeof o.pages === 'number' && typeof o.epinglees === 'number') return { pages: Math.max(0, o.pages), epinglees: Math.max(0, o.epinglees) };
  } catch {
    // Résumé illisible : recalculé ci-dessous.
  }
  const toutes = lireIndex(base).flatMap(m => Object.values(lireMois(base, m))).filter(p => p.auto.moteur !== 'vide');
  return { pages: toutes.length, epinglees: toutes.filter(p => p.epingle).length };
}

/** Enregistre (remplace) une page : relit le mois, change SA page, réécrit le mois — une seule écriture de page. */
export function ecrirePage(base: BaseJournal, page: PageJournal): void {
  const mois = moisDe(page.jour);
  const pages = lireMois(base, mois);
  const avant = pages[page.jour];
  const resumeAvant = lireResume(base);
  pages[page.jour] = page;
  base.ecrire(CLES_JOURNAL.mois + mois, JSON.stringify({ v: 1, pages }));
  const index = lireIndex(base);
  if (!index.includes(mois)) base.ecrire(CLES_JOURNAL.index, JSON.stringify([...index, mois].sort()));
  const compte = (p: PageJournal | undefined) => (p && p.auto.moteur !== 'vide' ? 1 : 0);
  const epingle = (p: PageJournal | undefined) => (p && p.epingle && p.auto.moteur !== 'vide' ? 1 : 0);
  base.ecrire(
    CLES_JOURNAL.resume,
    JSON.stringify({ pages: Math.max(0, resumeAvant.pages + compte(page) - compte(avant)), epinglees: Math.max(0, resumeAvant.epinglees + epingle(page) - epingle(avant)) }),
  );
}

/** Toutes les pages (du plus ancien au plus récent) : les mois sont lus un par un. */
export function toutesLesPages(base: Pick<BaseJournal, 'lire'> | undefined): PageJournal[] {
  return lireIndex(base)
    .flatMap(mois => Object.values(lireMois(base, mois)))
    .sort((a, b) => (a.jour < b.jour ? -1 : 1));
}

/** Pages d'une période (bornes incluses), triées. */
export function pagesEntre(base: Pick<BaseJournal, 'lire'> | undefined, du: string, au: string): PageJournal[] {
  const mois = lireIndex(base).filter(m => m >= moisDe(du) && m <= moisDe(au));
  return mois.flatMap(m => Object.values(lireMois(base, m))).filter(p => p.jour >= du && p.jour <= au).sort((a, b) => (a.jour < b.jour ? -1 : 1));
}

// ------------------------------------------------------------------ Modifications de l'utilisateur

export interface ModificationPage {
  note?: string;
  humeur?: Humeur | null;
  epingle?: boolean;
}

/** Page sans texte automatique : l'utilisateur écrit avant que l'app l'ait fait (l'écriture du soir la complétera). */
export function pageVide(jour: string, maintenant: number): PageJournal {
  return {
    v: 1,
    jour,
    auto: { accroche: '', intro: '', sections: [], chiffres: [], cloture: '', moteur: 'vide' },
    compteurs: {},
    nbEvenements: 0,
    ecritLe: new Date(maintenant).toISOString(),
  };
}

/** Applique la note, l'humeur ou l'épingle à une page (créée vide si besoin) ; `undefined` si le jour est invalide. */
export function modifierPage(base: BaseJournal, jour: string, m: ModificationPage, maintenant: number): PageJournal | undefined {
  if (!jourValide(jour)) return undefined;
  const page = lirePage(base, jour) ?? pageVide(jour, maintenant);
  const suivante: PageJournal = { ...page, modifieLe: new Date(maintenant).toISOString() };
  if (m.note !== undefined) {
    const note = chaine(m.note, BORNES_JOURNAL.note);
    if (note.trim()) suivante.note = note;
    else delete suivante.note;
  }
  if (m.humeur !== undefined) {
    if (m.humeur === null) delete suivante.humeur;
    else if (humeurValide(m.humeur)) suivante.humeur = m.humeur;
  }
  if (m.epingle !== undefined) {
    if (m.epingle) suivante.epingle = true;
    else delete suivante.epingle;
  }
  ecrirePage(base, suivante);
  return suivante;
}
