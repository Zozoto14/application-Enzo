/**
 * Fusion « dernier gagnant » d'un petit document partagé (annuaire des
 * comptes, données d'administration), clé par clé, avec suppressions datées.
 *
 * Même principe que `moteur.ts` pour le portefeuille, sans base de données :
 * on compare le document à celui du tour précédent (`connus`) pour dater ce
 * qui a changé ici ; une clé disparue devient une suppression datée
 * (« pierre tombale ») qui voyage elle aussi. Pour chaque clé, l'événement le
 * plus récent (valeur ou suppression) l'emporte ; à date égale, l'ordre des
 * empreintes départage — les deux côtés choisissent donc la même chose.
 *
 * Certaines clés ne se remplacent pas mais se RÉUNISSENT (journal par union) :
 * `fusions[prefixe](a, b)` décide alors de la valeur, sans date ni suppression.
 */

import { empreinte as empreinteBrute } from './entites';

/** Forme canonique (clés triées, à toute profondeur) : même empreinte quel que soit l'ordre. */
function canonique(valeur: unknown): unknown {
  if (Array.isArray(valeur)) return valeur.map(canonique);
  if (valeur && typeof valeur === 'object') {
    return Object.fromEntries(
      Object.keys(valeur as Record<string, unknown>)
        .sort()
        .filter(cle => (valeur as Record<string, unknown>)[cle] !== undefined)
        .map(cle => [cle, canonique((valeur as Record<string, unknown>)[cle])]),
    );
  }
  return valeur;
}

export const empreinte = (valeur: unknown): string => empreinteBrute(canonique(valeur));

export type Valeurs = Record<string, unknown>;

export interface DocumentLww {
  v: 1;
  entites: Valeurs;
  dates: Record<string, string>;
  supprimes: Record<string, string>;
}

export interface EtatLww {
  connus: Record<string, string>;
  dates: Record<string, string>;
  supprimes: Record<string, string>;
  /** Date du document distant déjà lu (rien à refaire s'il n'a pas bougé). */
  distantLu?: string;
  /** Empreinte du dernier document publié. */
  publie?: string;
}

export const etatLwwVide = (): EtatLww => ({ connus: {}, dates: {}, supprimes: {} });

/** Date « inconnue » : plus ancienne que tout, ce qui vient d'ailleurs l'emporte. */
export const DATE_INCONNUE = '1970-01-01T00:00:00.000Z';
const DUREE_SUPPRESSIONS_MS = 365 * 86_400_000;

export type Fusions = Record<string, (locale: unknown, distante: unknown) => unknown>;

function fusionPour(cle: string, fusions: Fusions): ((a: unknown, b: unknown) => unknown) | undefined {
  const prefixe = Object.keys(fusions).find(p => cle === p || cle.startsWith(`${p}:`));
  return prefixe === undefined ? undefined : fusions[prefixe];
}

export function lireEtatLww(brut: string | null | undefined): EtatLww {
  try {
    const o = brut ? (JSON.parse(brut) as Partial<EtatLww>) : {};
    const dict = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : {});
    return {
      connus: dict(o.connus),
      dates: dict(o.dates),
      supprimes: dict(o.supprimes),
      ...(typeof o.distantLu === 'string' ? { distantLu: o.distantLu } : {}),
      ...(typeof o.publie === 'string' ? { publie: o.publie } : {}),
    };
  } catch {
    return etatLwwVide();
  }
}

export function lireDocumentLww(brut: unknown): DocumentLww | undefined {
  const o = typeof brut === 'string' ? (() => { try { return JSON.parse(brut) as unknown; } catch { return undefined; } })() : brut;
  if (!o || typeof o !== 'object') return undefined;
  const d = o as Partial<DocumentLww>;
  const dict = <T,>(v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, T>) : {});
  if (d.v !== 1) return undefined;
  return { v: 1, entites: dict(d.entites), dates: dict<string>(d.dates), supprimes: dict<string>(d.supprimes) };
}

/**
 * Date les changements faits ici depuis le tour précédent. Au tout premier
 * tour (rien de connu), les valeurs locales reçoivent une date inconnue :
 * face à un document distant, c'est lui qui l'emporte (un appareil qui se
 * relie adopte ce qui existe déjà), et à défaut elles partent telles quelles.
 */
export function noterLocal(etat: EtatLww, locales: Valeurs, maintenant: string, fusions: Fusions = {}): EtatLww {
  const premier = Object.keys(etat.connus).length === 0;
  const dates = { ...etat.dates };
  const supprimes = { ...etat.supprimes };
  const connus: Record<string, string> = {};
  for (const [cle, valeur] of Object.entries(locales)) {
    connus[cle] = empreinte(valeur);
    if (etat.connus[cle] !== connus[cle]) {
      dates[cle] = premier ? dates[cle] ?? DATE_INCONNUE : maintenant;
      delete supprimes[cle];
    }
  }
  for (const cle of Object.keys(etat.connus)) {
    if (!(cle in locales) && !fusionPour(cle, fusions)) {
      supprimes[cle] = maintenant;
      delete dates[cle];
    }
  }
  const limite = new Date(Date.parse(maintenant) - DUREE_SUPPRESSIONS_MS).toISOString();
  for (const [cle, date] of Object.entries(supprimes)) {
    if (date < limite) delete supprimes[cle];
  }
  return { ...etat, connus, dates, supprimes };
}

export interface ResultatLww {
  /** Valeurs fusionnées, à écrire ici si `changeIci`. */
  entites: Valeurs;
  etat: EtatLww;
  document: DocumentLww;
  /** Le résultat diffère de ce qui est ici. */
  changeIci: boolean;
  /** Le résultat diffère de ce qui est sur le relais : à publier. */
  aPublier: boolean;
  /** Clés retirées ici par une suppression venue d'ailleurs. */
  retirees: string[];
}

/** Fusionne l'état local (déjà noté) avec le document distant (ou rien). */
export function fusionner(
  locales: Valeurs,
  etatNote: EtatLww,
  distant: DocumentLww | undefined,
  fusions: Fusions = {},
): ResultatLww {
  const entites: Valeurs = {};
  const dates: Record<string, string> = {};
  const supprimes: Record<string, string> = {};
  const d = distant ?? { v: 1 as const, entites: {}, dates: {}, supprimes: {} };
  const cles = new Set([
    ...Object.keys(locales),
    ...Object.keys(etatNote.supprimes),
    ...Object.keys(d.entites),
    ...Object.keys(d.supprimes),
  ]);
  const retirees: string[] = [];
  for (const cle of [...cles].sort()) {
    const union = fusionPour(cle, fusions);
    if (union) {
      const a = locales[cle];
      const b = d.entites[cle];
      const valeur = a === undefined ? b : b === undefined ? a : union(a, b);
      if (valeur !== undefined) {
        entites[cle] = valeur;
        const date = [etatNote.dates[cle], d.dates[cle]].filter(Boolean).sort().pop();
        if (date) dates[cle] = date;
      }
      continue;
    }
    // Candidats : [date, empreinte, valeur | suppression].
    type Candidat = { date: string; h: string; valeur?: unknown; supprime?: true };
    const candidats: Candidat[] = [];
    if (cle in locales) candidats.push({ date: etatNote.dates[cle] ?? DATE_INCONNUE, h: empreinte(locales[cle]), valeur: locales[cle] });
    if (etatNote.supprimes[cle]) candidats.push({ date: etatNote.supprimes[cle], h: '', supprime: true });
    if (cle in d.entites) candidats.push({ date: d.dates[cle] ?? DATE_INCONNUE, h: empreinte(d.entites[cle]), valeur: d.entites[cle] });
    if (d.supprimes[cle]) candidats.push({ date: d.supprimes[cle], h: '', supprime: true });
    candidats.sort((x, y) => (x.date === y.date ? (x.h < y.h ? -1 : x.h > y.h ? 1 : 0) : x.date < y.date ? -1 : 1));
    const gagnant = candidats[candidats.length - 1];
    if (!gagnant) continue;
    if (gagnant.supprime) {
      supprimes[cle] = gagnant.date;
      if (cle in locales) retirees.push(cle);
    } else {
      entites[cle] = gagnant.valeur;
      dates[cle] = gagnant.date;
    }
  }
  const document: DocumentLww = { v: 1, entites, dates, supprimes };
  const connus = Object.fromEntries(Object.entries(entites).map(([cle, valeur]) => [cle, empreinte(valeur)]));
  const changeIci = empreinte(Object.keys(entites).sort().map(c => [c, connus[c]])) !== empreinte(Object.keys(locales).sort().map(c => [c, empreinte(locales[c])]));
  const signature = empreinte(document);
  const aPublier = !distant || signature !== empreinte(d);
  return {
    entites,
    etat: { ...etatNote, connus, dates, supprimes, publie: aPublier ? signature : etatNote.publie },
    document,
    changeIci,
    aPublier,
    retirees,
  };
}
