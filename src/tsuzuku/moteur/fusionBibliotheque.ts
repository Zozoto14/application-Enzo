/**
 * Fusion de la bibliotheque entre les appareils d'un meme compte (coffre
 * serveur, voir docs/synchro-relais.md « Tsuzuku »).
 *
 * Chaque titre voyage comme un enregistrement a part. Deux appareils qui
 * modifient le meme titre ne s'ecrasent pas : la fusion ci-dessous est
 * deterministe, commutative et idempotente (fusionner A et B, ou B et A, ou
 * refusionner le resultat, donne la meme chose), ce qui garantit que tous les
 * appareils convergent sans aller-retour sans fin.
 *
 * Un titre a deux parties, chacune avec son estampille (`_sync`, posee par
 * `DepotBibliotheque.modifier` a chaque modification) :
 *
 *  - la FICHE (titre, affiche, note, favori, commentaire, total...) : la
 *    modification la plus recente gagne (`_sync.fiche`) ;
 *  - la PROGRESSION (episode courant, statut, dates de visionnage, « vu
 *    ailleurs ») : on garde le MAXIMUM de `(generation, episode, date)`.
 *    Regarder un episode n'est jamais perdu parce qu'un autre appareil, hors
 *    ligne, en avait vu moins (le plus loin gagne, meme s'il est plus ancien).
 *    Revenir en arriere expres (episode corrige a la baisse) ouvre une
 *    nouvelle « generation » qui l'emporte sur l'ancienne progression.
 *
 * L'historique des episodes vus se fusionne par UNION (borne a 200, les plus
 * recents). Titres sans estampille (avant cette version) : la progression la
 * plus avancee gagne, et la fiche garde ce que chacun sait (favori, note,
 * commentaire non vides).
 */

import type { Entree, EvenementHistorique } from './bibliotheque';

/** Meme borne que `HISTORIQUE_MAX` de bibliotheque.ts (pas d'import de valeur : les deux modules s'importent). */
const HISTORIQUE_MAX = 200;

/** Champs de la progression ; tout le reste (hors `id`, `kind`, `_sync`) est la fiche. */
export const CHAMPS_PROGRESSION = ['currentEpisode', 'status', 'watchedAt', 'lastWatched', 'watchedElsewhere'] as const;

export interface EstampilleEntree {
  /** Derniere modification de la fiche (ISO). */
  fiche: string;
  /** Derniere modification de la progression (ISO). */
  progression: string;
  /** Monte quand la progression recule expres : la nouvelle generation l'emporte. */
  generation: number;
}

const HORS_FICHE = new Set<string>(['id', 'kind', '_sync', ...CHAMPS_PROGRESSION]);

export function estampille(e: Partial<Entree> | null | undefined): EstampilleEntree {
  const s = (e?._sync ?? {}) as Partial<EstampilleEntree>;
  return {
    fiche: typeof s.fiche === 'string' ? s.fiche : '',
    progression: typeof s.progression === 'string' ? s.progression : '',
    generation: Number.isInteger(s.generation) && (s.generation as number) >= 0 ? (s.generation as number) : 0,
  };
}

/** JSON aux cles triees : comparaison stable de deux valeurs. */
export function jsonStable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(jsonStable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as Record<string, unknown>)
      .filter(k => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map(k => `${JSON.stringify(k)}:${jsonStable((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

export function partieFiche(e: Entree): Record<string, unknown> {
  return Object.fromEntries(Object.entries(e).filter(([k]) => !HORS_FICHE.has(k)));
}

export function partieProgression(e: Entree): Record<string, unknown> {
  return Object.fromEntries(CHAMPS_PROGRESSION.map(k => [k, e[k] ?? null]));
}

const comparer = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** > 0 si la progression de `a` l'emporte sur celle de `b`. */
function comparerProgression(a: Entree, b: Entree): number {
  const sa = estampille(a);
  const sb = estampille(b);
  return (
    sa.generation - sb.generation ||
    (Number(a.currentEpisode) || 0) - (Number(b.currentEpisode) || 0) ||
    comparer(sa.progression, sb.progression) ||
    comparer(jsonStable(partieProgression(a)), jsonStable(partieProgression(b)))
  );
}

/** > 0 si la fiche de `a` l'emporte sur celle de `b`. */
function comparerFiche(a: Entree, b: Entree): number {
  return comparer(estampille(a).fiche, estampille(b).fiche) || comparer(jsonStable(partieFiche(a)), jsonStable(partieFiche(b)));
}

const vide = (v: unknown) => v === null || v === undefined || v === '' || v === false;

/**
 * Fusion de deux versions du MEME titre (meme `kind` et `id`). Ne modifie
 * ni `a` ni `b`.
 */
export function fusionnerEntrees(a: Entree, b: Entree): Entree {
  const progres = comparerProgression(a, b) >= 0 ? a : b;
  const ficheGagnante = comparerFiche(a, b) >= 0 ? a : b;
  const autre = ficheGagnante === a ? b : a;
  const fiche = partieFiche(ficheGagnante);
  if (!estampille(ficheGagnante).fiche && !estampille(autre).fiche) {
    // Avant les estampilles : on ne sait pas qui est le plus recent, chacun garde ce qu'il sait.
    for (const [k, v] of Object.entries(partieFiche(autre))) if (vide(fiche[k]) && !vide(v)) fiche[k] = v;
  }
  const sp = estampille(progres);
  const sf = estampille(ficheGagnante);
  return {
    ...fiche,
    id: a.id,
    kind: a.kind,
    ...partieProgression(progres),
    _sync: { fiche: sf.fiche, progression: sp.progression, generation: sp.generation },
  } as unknown as Entree;
}

/** Cle d'un evenement de l'historique (deux appareils ne le comptent qu'une fois). */
export const cleEvenement = (h: EvenementHistorique): string => `${h.kind}|${h.animeId}|${h.episode}|${h.watchedAt}`;

/** Union de deux historiques, les plus recents d'abord, borne a `HISTORIQUE_MAX`. */
export function fusionnerHistoriques(a: readonly EvenementHistorique[], b: readonly EvenementHistorique[]): EvenementHistorique[] {
  const parCle = new Map<string, EvenementHistorique>();
  for (const h of [...a, ...b]) {
    const cle = cleEvenement(h);
    const deja = parCle.get(cle);
    // Meme evenement vu deux fois : on garde une version stable (titre ou affiche mis a jour).
    if (!deja || jsonStable(h) > jsonStable(deja)) parCle.set(cle, h);
  }
  return [...parCle.entries()]
    .sort(([ca, x], [cb, y]) => comparer(String(y.watchedAt), String(x.watchedAt)) || comparer(ca, cb))
    .map(([, h]) => h)
    .slice(0, HISTORIQUE_MAX);
}

/**
 * Pose les estampilles d'une modification locale : compare chaque titre a sa
 * version d'avant. Titre nouveau : fiche et progression datees de `instant`.
 * Episode corrige a la baisse : nouvelle generation. Modifie `apres`.
 */
export function estampiller(avant: { anime: Entree[]; movies: Entree[] }, apres: { anime: Entree[]; movies: Entree[] }, instant: string): void {
  for (const genre of ['anime', 'movies'] as const) {
    const anciens = new Map(avant[genre].map(e => [String(e.id), e]));
    for (const e of apres[genre]) {
      const ancien = anciens.get(String(e.id));
      const s = estampille(ancien ?? e);
      if (!ancien) {
        e._sync = { fiche: s.fiche || instant, progression: s.progression || instant, generation: s.generation };
        continue;
      }
      const ficheChangee = jsonStable(partieFiche(ancien)) !== jsonStable(partieFiche(e));
      const progressionChangee = jsonStable(partieProgression(ancien)) !== jsonStable(partieProgression(e));
      if (!ficheChangee && !progressionChangee) {
        if (ancien._sync !== undefined) e._sync = ancien._sync;
        continue;
      }
      const recul = (Number(e.currentEpisode) || 0) < (Number(ancien.currentEpisode) || 0);
      e._sync = {
        fiche: ficheChangee ? instant : s.fiche,
        progression: progressionChangee ? instant : s.progression,
        generation: recul ? s.generation + 1 : s.generation,
      };
    }
  }
}
