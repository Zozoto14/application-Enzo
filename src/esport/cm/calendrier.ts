/**
 * Cartes datées au calendrier du CM (migration 0074, docs/esport/cm.md, « Cartes au calendrier ») : outils purs (testés,
 * CmCalendrierCartes.test.tsx). Le calendrier s'affiche à l'heure du club (Europe/Paris) ; un déplacement garde l'heure
 * MURALE de l'échéance dans ce fuseau (changement d'heure compris) et part au serveur en instant UTC (ISO).
 */

/** Parties murales (« AAAA-MM-JJ », « HH:MM ») d'un instant dans un fuseau. */
export function partiesMurales(ms: number, fuseau: string): { date: string; heure: string } {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, heure: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
}

/** Instant UTC (ISO) d'une heure murale `date` `heure` dans `fuseau` (deux passes : l'écart du fuseau peut changer). */
export function instantMural(date: string, heure: string, fuseau: string): string {
  const [a, m, j] = date.split('-').map(Number);
  const [h, mi] = heure.split(':').map(Number);
  const voulu = Date.UTC(a, m - 1, j, h, mi);
  const ecart = (t: number) => {
    const p = partiesMurales(t, fuseau);
    const [pa, pm, pj] = p.date.split('-').map(Number);
    const [ph, pmi] = p.heure.split(':').map(Number);
    return Date.UTC(pa, pm - 1, pj, ph, pmi) - t;
  };
  let t = voulu - ecart(voulu);
  t = voulu - ecart(t);
  return new Date(t).toISOString();
}

/** Nouvelle échéance quand une carte est déposée sur le jour `jour` : même heure murale (fuseau du club). */
export function deplacerAuJour(echeance: string, jour: string, fuseau: string): string {
  return instantMural(jour, partiesMurales(Date.parse(echeance), fuseau).heure, fuseau);
}

/** Saisie « AAAA-MM-JJ HH:MM » (champ date et heure) → instant UTC (ISO) ; null si vide ou illisible. */
export function saisieVersInstant(v: string | null | undefined, fuseau: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?$/.exec(String(v ?? '').trim());
  return m ? instantMural(m[1], m[2] ?? '12:00', fuseau) : null;
}

/** Fin d'une échéance qui a une durée (minutes) ; null sinon. */
export function finEcheance(echeance: string, duree: number | null | undefined): string | null {
  if (!duree) return null;
  const t = Date.parse(echeance);
  return Number.isNaN(t) ? null : new Date(t + duree * 60_000).toISOString();
}

export interface CaseJour {
  jour: string;
  x: number;
  y: number;
  l: number;
  h: number;
}

/** Jour de la grille sous le pointeur (coordonnées de la fenêtre), ou undefined. */
export function jourSous(cases: readonly CaseJour[], x: number, y: number): string | undefined {
  return cases.find(c => x >= c.x && x < c.x + c.l && y >= c.y && y < c.y + c.h)?.jour;
}
