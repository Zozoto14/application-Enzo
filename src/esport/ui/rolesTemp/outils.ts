/** Durées et dates des rôles temporaires (affichage), sans dépendance à l'interface. */

import { formaterDate } from '../../i18n';
import { trRt } from '../../i18n/rolesTemp';

const MIN = 60_000;
const H = 60 * MIN;

/** « 45 min », « 3 h », « 2 j 4 h » : temps restant (arrondi à l'unité utile). */
export function dureeRestante(ms: number): string {
  if (ms < H) return trRt('min', { n: Math.max(1, Math.ceil(ms / MIN)) });
  const heures = Math.floor(ms / H);
  if (heures < 48) return trRt('h', { n: heures });
  const j = Math.floor(heures / 24);
  const reste = heures % 24;
  return reste ? `${trRt('j', { n: j })} ${trRt('h', { n: reste })}` : trRt('j', { n: j });
}

/** Durée en heures : « 24 h » ou « 3 j » (multiple de 24 à partir de 48 h). */
export function dureeH(heures: number): string {
  return heures >= 48 && heures % 24 === 0 ? trRt('j', { n: heures / 24 }) : trRt('h', { n: heures });
}

export const dateHeure = (iso: string): string => formaterDate(iso, { dateStyle: 'medium', timeStyle: 'short' });

export const entier = (v: string): number => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
};
