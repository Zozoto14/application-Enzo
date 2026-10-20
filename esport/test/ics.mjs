/** Aide de test : vérification de la forme d'un fichier iCalendar. */
import assert from 'node:assert/strict';

/** Vérifie la forme d'un iCalendar (RFC 5545) : CRLF, lignes ≤ 75 octets, blocs équilibrés, propriétés requises. */
export function verifierIcs(texte) {
  assert.ok(texte.endsWith('\r\n'));
  assert.ok(!/[^\r]\n/.test(texte), 'fins de ligne CRLF');
  const brutes = texte.slice(0, -2).split('\r\n');
  for (const l of brutes) assert.ok(new TextEncoder().encode(l).length <= 75, `ligne trop longue : ${l}`);
  const lignes = [];
  for (const l of brutes) {
    if (l.startsWith(' ')) lignes[lignes.length - 1] += l.slice(1);
    else lignes.push(l);
  }
  assert.equal(lignes[0], 'BEGIN:VCALENDAR');
  assert.equal(lignes[lignes.length - 1], 'END:VCALENDAR');
  assert.ok(lignes.includes('VERSION:2.0'));
  assert.ok(lignes.some(l => l.startsWith('PRODID:')));
  const evenements = [];
  let courant;
  for (const l of lignes) {
    if (l === 'BEGIN:VEVENT') {
      assert.equal(courant, undefined, 'VEVENT imbriqué');
      courant = {};
    } else if (l === 'END:VEVENT') {
      for (const p of ['UID', 'DTSTAMP', 'DTSTART', 'DTEND', 'SUMMARY']) assert.ok(courant[p], `${p} manquant`);
      assert.match(courant.DTSTART, /^\d{8}T\d{6}Z$/);
      assert.ok(courant.DTEND > courant.DTSTART);
      evenements.push(courant);
      courant = undefined;
    } else if (courant) {
      const i = l.indexOf(':');
      courant[l.slice(0, i).split(';')[0]] = l.slice(i + 1);
    }
  }
  assert.equal(courant, undefined, 'VEVENT non fermé');
  assert.equal(new Set(evenements.map(e => e.UID)).size, evenements.length, 'UID uniques');
  return evenements;
}

