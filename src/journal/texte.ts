/**
 * Petits outils de rédaction : tirage reproductible d'une variante, listes à la
 * française, pluriels, montants et pourcentages. Aucun hasard : une même
 * journée donne toujours le même texte (graine = jour + rubrique), deux jours
 * voisins n'ont pas les mêmes tournures.
 */

export const ESPACE_FIN = ' ';
export const ESPACE_INSECABLE = ' ';

/** Hash FNV-1a 32 bits d'une chaîne. */
export function hash(texte: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Générateur pseudo-aléatoire reproductible (mulberry32). */
export function generateur(graine: string): () => number {
  let a = hash(graine);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Choisit une variante, de façon reproductible pour cette graine. */
export function tirer<T>(variantes: readonly T[], graine: string): T {
  return variantes[hash(graine) % variantes.length];
}

/** « A, B et C ». */
export function liste(elements: readonly string[]): string {
  if (elements.length <= 1) return elements[0] ?? '';
  return `${elements.slice(0, -1).join(', ')} et ${elements[elements.length - 1]}`;
}

/** Liste bornée : « A, B, C et 2 autres ». */
export function listeCourte(elements: readonly string[], max = 4): string {
  if (elements.length <= max) return liste(elements);
  const reste = elements.length - max;
  return `${elements.slice(0, max).join(', ')} et ${reste} autre${reste > 1 ? 's' : ''}`;
}

/** « 1 tâche », « 3 tâches ». */
export const pluriel = (n: number, un: string, plusieurs = `${un}s`): string => `${n} ${n > 1 ? plusieurs : un}`;

function grouper(entier: string): string {
  return entier.replace(/\B(?=(\d{3})+(?!\d))/g, ESPACE_FIN);
}

/** « 1 234,50 € » (virgule décimale, espaces fines ; le signe seulement s'il est explicite). */
export function eur(valeur: number, signe = false): string {
  const arrondi = Math.round(Math.abs(valeur) * 100) / 100;
  const [e, f = ''] = arrondi.toFixed(2).split('.');
  const corps = f === '00' ? grouper(e) : `${grouper(e)},${f}`;
  const s = valeur < 0 && arrondi !== 0 ? '-' : signe && arrondi !== 0 ? '+' : '';
  return `${s}${corps}${ESPACE_INSECABLE}€`;
}

/** « +1,25 % » (signe explicite par défaut). */
export function pct(valeur: number, signe = true): string {
  const arrondi = Math.round(Math.abs(valeur) * 100) / 100;
  const corps = String(arrondi).replace('.', ',');
  const s = valeur < 0 && arrondi !== 0 ? '-' : signe && arrondi !== 0 ? '+' : '';
  return `${s}${corps}${ESPACE_INSECABLE}%`;
}

/** « 2 h 10 », « 45 min ». */
export function duree(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const reste = m % 60;
  return reste ? `${h} h ${String(reste).padStart(2, '0')}` : `${h} h`;
}

export const majuscule = (t: string): string => (t ? t[0].toUpperCase() + t.slice(1) : t);

/** Tronque proprement à `max` caractères, avec une ellipse. */
export function abreger(t: string, max = 80): string {
  const propre = t.replace(/\s+/g, ' ').trim();
  return propre.length <= max ? propre : `${propre.slice(0, max - 1).trimEnd()}…`;
}

/** Entre guillemets français. */
export const guill = (t: string): string => `« ${t} »`;

/** Termine par un point si la phrase n'a pas déjà une ponctuation finale. */
export const phrase = (t: string): string => (/[.!?…»)]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);
