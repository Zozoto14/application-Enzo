/**
 * Logique pure du lecteur maison (vidéo déposée) : pas image par image, cadence d'images estimée,
 * durée sûre (une vidéo enregistrée par un navigateur peut annoncer une durée infinie).
 */

/** Cadence par défaut quand elle n'est pas encore mesurée (images par seconde). */
export const FPS_DEFAUT = 30;

/** Instant après un pas d'une image (`sens` : 1 = image suivante, -1 = précédente), borné à la vidéo. */
export function pasImage(temps: number, sens: 1 | -1, fps: number = FPS_DEFAUT, duree = 0): number {
  const pas = 1 / (fps > 0 && Number.isFinite(fps) ? fps : FPS_DEFAUT);
  const t = Math.max(0, temps + sens * pas);
  return duree > 0 ? Math.min(t, duree) : t;
}

/**
 * Cadence estimée à partir des écarts entre images affichées (secondes, `requestVideoFrameCallback`) :
 * médiane des écarts plausibles, arrondie aux cadences courantes (24, 25, 30, 50, 60…).
 */
export function estimerFps(ecarts: readonly number[]): number {
  const bons = ecarts.filter(e => e > 1 / 241 && e < 1 / 5).sort((a, b) => a - b);
  if (bons.length < 3) return FPS_DEFAUT;
  const fps = 1 / bons[Math.floor(bons.length / 2)];
  const courantes = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 120, 144, 240];
  const proche = courantes.reduce((m, c) => (Math.abs(c - fps) < Math.abs(m - fps) ? c : m), courantes[0]);
  return Math.abs(proche - fps) / fps < 0.08 ? proche : Math.round(fps);
}

/** Durée utilisable : 0 si inconnue ou infinie. */
export const dureeSure = (d: number): number => (Number.isFinite(d) && d > 0 ? d : 0);
