/**
 * Langue choisie (VF / VOSTFR) : par série, et par défaut dans Paramètres ›
 * Tsuzuku (VF, VOSTFR, ou « au choix à chaque fois »).
 *
 * Rangement : la base du profil (`tsuzuku.langues`), synchronisée avec le
 * coffre serveur du compte (une entrée par série, `tsuzuku:langue:<série>`) :
 * le choix fait sur le PC vaut aussi sur le téléphone et le site.
 *
 * « Au choix à chaque fois » : rien n'est retenu entre deux ouvertures de
 * l'app ; le choix fait dans le lecteur vaut pour la séance (mémoire vive).
 *
 * La progression (vu, reprendre) ne dépend JAMAIS de la langue : un épisode vu
 * en VF est vu (la bibliothèque ne connaît que le numéro).
 */

import { LANGUES_VERSION, type LangueVersion } from '../moteur/langues';
import { CLES } from '../plateforme/stockage';
import type { ServicesTsuzuku } from './services';

export type OrigineLangue = 'serie' | 'seance' | 'reglage' | 'aucune';

/** Choix de la séance (« au choix à chaque fois ») : mémoire vive, par profil. */
const seances = new WeakMap<object, Map<string, LangueVersion>>();

export function lirePreferencesLangue(texte: string | null | undefined): Record<string, LangueVersion> {
  try {
    const o = texte ? (JSON.parse(texte) as unknown) : {};
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
    return Object.fromEntries(
      Object.entries(o as Record<string, unknown>)
        .filter(([k, v]) => k.length <= 120 && LANGUES_VERSION.includes(v as LangueVersion))
        .slice(0, 2000) as Array<[string, LangueVersion]>,
    );
  } catch {
    return {};
  }
}

/** Langue à jouer pour une série : choix de la série, de la séance, puis réglage par défaut. */
export async function langueVoulue(s: Pick<ServicesTsuzuku, 'stockage' | 'reglages'>, cle: string): Promise<{ langue: LangueVersion | null; origine: OrigineLangue; auChoix: boolean }> {
  const reglage = (await s.reglages()).langue;
  const auChoix = reglage === 'indifferent';
  const serie = lirePreferencesLangue(await s.stockage.lire(CLES.languesSeries))[cle];
  if (serie && !auChoix) return { langue: serie, origine: 'serie', auChoix };
  const seance = seances.get(s)?.get(cle);
  if (seance) return { langue: seance, origine: 'seance', auChoix };
  if (!auChoix) return { langue: reglage, origine: 'reglage', auChoix };
  return { langue: null, origine: 'aucune', auChoix };
}

/**
 * Retient le choix fait sur la fiche ou dans le lecteur : pour la série
 * (réglage VF ou VOSTFR), ou pour la séance seulement (« au choix à chaque fois »).
 */
export async function choisirLangue(s: Pick<ServicesTsuzuku, 'stockage' | 'reglages'>, cle: string, langue: LangueVersion): Promise<OrigineLangue> {
  const carte = seances.get(s) ?? new Map<string, LangueVersion>();
  seances.set(s, carte);
  carte.set(cle, langue);
  if ((await s.reglages()).langue === 'indifferent') return 'seance';
  const tous = lirePreferencesLangue(await s.stockage.lire(CLES.languesSeries));
  tous[cle] = langue;
  await s.stockage.ecrire(CLES.languesSeries, JSON.stringify(tous));
  return 'serie';
}
