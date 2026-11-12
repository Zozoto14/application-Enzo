/**
 * Export iCalendar (RFC 5545) du planning d'une team. Fonction PURE.
 *
 * Chaque occurrence est un VEVENT autonome (UID stable par événement et par
 * occurrence), en UTC (`…Z`) : aucun VTIMEZONE à fournir, et les exceptions
 * (occurrence déplacée, annulée) sont déjà appliquées. Lignes en CRLF,
 * pliées à 75 octets, texte échappé.
 */

const encodeur = new TextEncoder();

/** Échappement d'une valeur TEXT (\\ ; , et retours à la ligne). */
export function echapper(texte) {
  return String(texte ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Pliage à 75 octets (UTF-8), sans couper un caractère. */
export function plier(ligne) {
  if (encodeur.encode(ligne).length <= 75) return ligne;
  const morceaux = [];
  let courant = '';
  let taille = 0;
  let limite = 75;
  for (const c of ligne) {
    const t = encodeur.encode(c).length;
    if (taille + t > limite) {
      morceaux.push(courant);
      courant = '';
      taille = 0;
      limite = 74; // la ligne de suite commence par une espace
    }
    courant += c;
    taille += t;
  }
  morceaux.push(courant);
  return morceaux.join('\r\n ');
}

/** Instant → « 20261020T180000Z ». */
export function dateIcs(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export const LIBELLES_TYPES = { scrim: 'Scrim', match: 'Match', training: 'Entraînement', meeting: 'Réunion', tournament: 'Tournoi', review: 'Review', other: 'Autre' };

/**
 * Calendrier : `{ nom, fuseau, maintenant (ms), domaine, occurrences }`, une
 * occurrence étant `{ evenementId, cle, debut, fin, titre, description, lieu, type, majLe }`.
 */
export function calendrierIcs({ nom, fuseau, maintenant, domaine = 'esport.applibourse', occurrences }) {
  const lignes = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AppliBourse//Esport planning//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${echapper(nom)}`,
    `X-WR-TIMEZONE:${fuseau}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  for (const o of occurrences) {
    const type = LIBELLES_TYPES[o.type] ?? 'Autre';
    lignes.push(
      'BEGIN:VEVENT',
      `UID:${o.evenementId}-${dateIcs(Date.parse(o.cle))}@${domaine}`,
      `DTSTAMP:${dateIcs(maintenant)}`,
      `DTSTART:${dateIcs(o.debut)}`,
      `DTEND:${dateIcs(o.fin)}`,
      `SUMMARY:${echapper(`[${type}] ${o.titre}`)}`,
      ...(o.description ? [`DESCRIPTION:${echapper(o.description)}`] : []),
      ...(o.lieu ? [`LOCATION:${echapper(o.lieu)}`] : []),
      `CATEGORIES:${echapper(type)}`,
      ...(o.majLe ? [`LAST-MODIFIED:${dateIcs(Date.parse(o.majLe))}`] : []),
      'END:VEVENT',
    );
  }
  lignes.push('END:VCALENDAR');
  return `${lignes.map(plier).join('\r\n')}\r\n`;
}
