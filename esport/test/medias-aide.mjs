/**
 * Aides des tests des médias : petits fichiers fabriqués à la main (MP4 avec son atome `moov`, WAV,
 * MKV), et envoi par morceaux par l'API (comme l'app).
 */

import { createHash } from 'node:crypto';

const enc = new TextEncoder();
const u32 = n => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u16 = n => [(n >>> 8) & 0xff, n & 0xff];
const boite = (type, ...contenus) => {
  const corps = contenus.flatMap(c => [...c]);
  return Uint8Array.from([...u32(8 + corps.length), ...enc.encode(type), ...corps]);
};

/**
 * MP4 minimal (structure ISO-BMFF valide pour l'analyse : ftyp, moov/mvhd/trak/mdia/hdlr/minf/stbl/stsd,
 * mdat) : `codec` (avc1, hvc1…), `duree` (s), `taille` totale visée, `moovAuDebut`.
 */
export function mp4Factice({ codec = 'avc1', duree = 12, taille = 200_000, moovAuDebut = true, marque = 'isom' } = {}) {
  const ftyp = boite('ftyp', enc.encode(marque), u32(512), enc.encode('isommp41'));
  const mvhd = boite('mvhd', [0, 0, 0, 0], u32(0), u32(0), u32(1000), u32(Math.round(duree * 1000)), new Uint8Array(80));
  const hdlr = boite('hdlr', [0, 0, 0, 0], u32(0), enc.encode('vide'), new Uint8Array(12), [0]);
  const entree = boite(codec, new Uint8Array(70));
  const stsd = boite('stsd', [0, 0, 0, 0], u32(1), entree);
  const stbl = boite('stbl', stsd);
  const minf = boite('minf', stbl);
  const mdia = boite('mdia', hdlr, minf);
  const trak = boite('trak', mdia);
  const moov = boite('moov', mvhd, trak);
  const reste = Math.max(16, taille - ftyp.length - moov.length - 8);
  const donnees = new Uint8Array(reste);
  for (let i = 0; i < reste; i++) donnees[i] = (i * 31 + 7) & 0xff;
  const mdat = boite('mdat', donnees);
  const parties = moovAuDebut ? [ftyp, moov, mdat] : [ftyp, mdat, moov];
  const sortie = new Uint8Array(parties.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parties) {
    sortie.set(p, i);
    i += p.length;
  }
  return sortie;
}

/** WAV mono 16 kHz, `secondes` de signal. */
export function wavFactice(secondes = 2, frequence = 16000) {
  const n = Math.round(secondes * frequence);
  const donnees = new Uint8Array(n * 2);
  for (let i = 0; i < n; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * 440 * i) / frequence) * 8000);
    donnees[i * 2] = v & 0xff;
    donnees[i * 2 + 1] = (v >> 8) & 0xff;
  }
  const le32 = x => [x & 0xff, (x >>> 8) & 0xff, (x >>> 16) & 0xff, (x >>> 24) & 0xff];
  const le16 = x => [x & 0xff, (x >>> 8) & 0xff];
  const tete = Uint8Array.from([...enc.encode('RIFF'), ...le32(36 + donnees.length), ...enc.encode('WAVEfmt '), ...le32(16), ...le16(1), ...le16(1), ...le32(frequence), ...le32(frequence * 2), ...le16(2), ...le16(16), ...enc.encode('data'), ...le32(donnees.length)]);
  const sortie = new Uint8Array(tete.length + donnees.length);
  sortie.set(tete);
  sortie.set(donnees, tete.length);
  return sortie;
}

/** En-tête EBML d'un MKV (ou WebM) suivi de données. */
export function mkvFactice({ doc = 'matroska', taille = 5000 } = {}) {
  const tete = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x80 | doc.length, ...enc.encode(doc), ...enc.encode('V_MPEG4/ISO/AVC')]);
  const sortie = new Uint8Array(taille);
  sortie.set(tete);
  return sortie;
}

export const sha = o => createHash('sha256').update(o).digest('hex');

/**
 * Envoie `octets` par morceaux (comme l'app) ; rend `{ debut, morceaux: [réponses], fin }`.
 * `usage` : « review » ou « resumes » (section de l'URL). `arreterA` : s'arrête avant ce morceau.
 */
export async function envoyer(b, jeton, teamId, octets, { section = 'review', nom = 'match.mp4', arreterA, sha256 } = {}) {
  const base = `/teams/${teamId}/${section}/envois`;
  const debut = await b.appel(base, { methode: 'POST', jeton, corps: { nom, taille: octets.length, type: 'video/mp4' } });
  if (debut.statut !== 200) return { debut };
  const { id, tailleMorceau, morceaux } = debut.corps;
  const reponses = [];
  for (let i = 0; i < morceaux; i++) {
    if (arreterA === i) return { debut, morceaux: reponses, id };
    const part = octets.subarray(i * tailleMorceau, Math.min(octets.length, (i + 1) * tailleMorceau));
    const r = await morceau(b, jeton, `${base}/${id}`, i, part);
    reponses.push(r);
    if (r.statut !== 200) return { debut, morceaux: reponses, id };
  }
  const fin = await b.appel(`${base}/${id}/fin`, { methode: 'POST', jeton, corps: { sha256: sha256 ?? sha(octets) } });
  return { debut, morceaux: reponses, fin, id };
}

/** Un morceau : PUT binaire avec son SHA-256 (ou celui imposé). */
export async function morceau(b, jeton, cheminEnvoi, indice, octets, { empreinte } = {}) {
  const r = await b.traiter(
    new Request(`https://esport.test${cheminEnvoi}/morceaux/${indice}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${jeton}`, 'X-Sha256': empreinte ?? sha(octets), 'CF-Connecting-IP': '198.51.100.9' },
      body: octets,
    }),
  );
  const texte = await r.text();
  return { statut: r.status, corps: texte ? JSON.parse(texte) : null };
}
