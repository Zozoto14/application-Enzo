/**
 * ZIP EN FLUX (sans compression, « stored ») d'un dossier du Drive : les fichiers sont lus l'un après l'autre
 * dans le stockage et envoyés au fur et à mesure ; le serveur n'a jamais tout le dossier en mémoire et
 * n'écrit rien sur le disque. Pas de ZIP64 : moins de 4 Gio et moins de 65 535 entrées (regles.mjs borne
 * bien en dessous). Noms en UTF-8 (drapeau 11). Le CRC-32 de chaque fichier n'est connu qu'après l'avoir lu :
 * il suit les données (descripteur, drapeau 3) et figure dans le répertoire central.
 *
 * Les médias (photos, vidéos, archives) sont déjà compressés : les recompresser coûterait du temps de
 * processeur sur un hébergement mutualisé pour presque rien.
 */

const TABLE_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 incrémental : `crc32(octets, precedent)`. */
export function crc32(octets, precedent = 0) {
  let c = (precedent ^ 0xffffffff) >>> 0;
  for (let i = 0; i < octets.length; i++) c = TABLE_CRC[(c ^ octets[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();

/** Date et heure DOS (heure locale de Paris n'a pas de sens ici : UTC, précision 2 s). */
function dateDos(instant) {
  const d = new Date(Number.isFinite(instant) ? instant : Date.now());
  const annee = Math.min(2107, Math.max(1980, d.getUTCFullYear()));
  return {
    heure: ((d.getUTCHours() & 0x1f) << 11) | ((d.getUTCMinutes() & 0x3f) << 5) | ((d.getUTCSeconds() >> 1) & 0x1f),
    date: (((annee - 1980) & 0x7f) << 9) | (((d.getUTCMonth() + 1) & 0xf) << 5) | (d.getUTCDate() & 0x1f),
  };
}

function entete(taille) {
  const o = new Uint8Array(taille);
  const v = new DataView(o.buffer);
  return { o, v };
}

/** Taille du ZIP final pour ces entrées (`[{ chemin, taille }]`). */
export function tailleZip(entrees) {
  let n = 22;
  for (const e of entrees) {
    const nom = enc.encode(e.chemin).length;
    n += 30 + nom + Number(e.taille) + 16 + 46 + nom;
  }
  return n;
}

/**
 * Flux du ZIP. `entrees` : `[{ chemin, taille, date (ms), lire() → ReadableStream | Uint8Array | null }]`.
 * Un fichier illisible ou de taille différente de celle annoncée interrompt le flux (erreur) : un ZIP
 * tronqué vaut mieux qu'un ZIP faux.
 */
export function fluxZip(entrees) {
  const central = [];
  let decalage = 0;
  let i = 0;
  let lecteur = null;
  let courant = null;
  const FLAGS = 0x0808;

  const debutEntree = e => {
    const nom = enc.encode(e.chemin);
    const { heure, date } = dateDos(e.date);
    const { o, v } = entete(30 + nom.length);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, FLAGS, true);
    v.setUint16(8, 0, true);
    v.setUint16(10, heure, true);
    v.setUint16(12, date, true);
    v.setUint32(14, 0, true);
    v.setUint32(18, Number(e.taille), true);
    v.setUint32(22, Number(e.taille), true);
    v.setUint16(26, nom.length, true);
    v.setUint16(28, 0, true);
    o.set(nom, 30);
    courant = { e, nom, heure, date, crc: 0, lus: 0, debut: decalage };
    decalage += o.length;
    return o;
  };

  const finEntree = () => {
    const c = courant;
    if (c.lus !== Number(c.e.taille)) throw new Error(`Taille inattendue pour ${c.e.chemin}.`);
    const { o, v } = entete(16);
    v.setUint32(0, 0x08074b50, true);
    v.setUint32(4, c.crc, true);
    v.setUint32(8, c.lus, true);
    v.setUint32(12, c.lus, true);
    decalage += 16;
    central.push(c);
    courant = null;
    return o;
  };

  const repertoire = () => {
    const parties = [];
    let taille = 0;
    for (const c of central) {
      const { o, v } = entete(46 + c.nom.length);
      v.setUint32(0, 0x02014b50, true);
      v.setUint16(4, 0x0314, true);
      v.setUint16(6, 20, true);
      v.setUint16(8, FLAGS, true);
      v.setUint16(10, 0, true);
      v.setUint16(12, c.heure, true);
      v.setUint16(14, c.date, true);
      v.setUint32(16, c.crc, true);
      v.setUint32(20, c.lus, true);
      v.setUint32(24, c.lus, true);
      v.setUint16(28, c.nom.length, true);
      // Attributs externes : fichier ordinaire en lecture (rw-r--r--), jamais exécutable.
      v.setUint32(38, (0o100644 << 16) >>> 0, true);
      v.setUint32(42, c.debut, true);
      o.set(c.nom, 46);
      parties.push(o);
      taille += o.length;
    }
    const { o, v } = entete(22);
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, central.length, true);
    v.setUint16(10, central.length, true);
    v.setUint32(12, taille, true);
    v.setUint32(16, decalage, true);
    parties.push(o);
    return parties;
  };

  return new ReadableStream({
    async pull(controleur) {
      try {
        for (;;) {
          if (lecteur) {
            const { done, value } = await lecteur.read();
            if (!done) {
              const morceau = value instanceof Uint8Array ? value : new Uint8Array(value);
              courant.crc = crc32(morceau, courant.crc);
              courant.lus += morceau.length;
              decalage += morceau.length;
              controleur.enqueue(morceau);
              return;
            }
            lecteur = null;
            controleur.enqueue(finEntree());
            return;
          }
          if (i >= entrees.length) {
            for (const p of repertoire()) controleur.enqueue(p);
            controleur.close();
            return;
          }
          const e = entrees[i++];
          controleur.enqueue(debutEntree(e));
          if (Number(e.taille) === 0) {
            controleur.enqueue(finEntree());
            return;
          }
          const source = await e.lire();
          if (!source) throw new Error(`Fichier illisible : ${e.chemin}.`);
          if (source instanceof Uint8Array) {
            courant.crc = crc32(source, 0);
            courant.lus = source.length;
            decalage += source.length;
            controleur.enqueue(source);
            controleur.enqueue(finEntree());
            return;
          }
          lecteur = source.getReader();
          return;
        }
      } catch (err) {
        controleur.error(err);
      }
    },
    async cancel() {
      await lecteur?.cancel().catch(() => undefined);
    },
  });
}
