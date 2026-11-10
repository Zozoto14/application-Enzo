/**
 * Langues d'une version (VF ou VOSTFR) : constantes seules, sans l'analyseur HTML de langues.ts. Lues au démarrage
 * par la synchro (src/sync/relais/entitesTsuzukuDonnees.ts) : le fichier principal du site n'embarque pas htmlparser2.
 */

export type LangueVersion = 'vf' | 'vostfr';
export const LANGUES_VERSION: readonly LangueVersion[] = ['vf', 'vostfr'];
export const LIBELLE_LANGUE_VERSION: Record<LangueVersion, string> = { vf: 'VF', vostfr: 'VOSTFR' };
export const autreLangue = (l: LangueVersion): LangueVersion => (l === 'vf' ? 'vostfr' : 'vf');
