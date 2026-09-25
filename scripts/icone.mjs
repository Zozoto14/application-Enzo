/**
 * Génère l'icône de l'application.
 *
 * Écrit un PNG sans aucune dépendance : le tracé est fait à la main, par
 * tests géométriques, puis encodé avec le `zlib` de Node. Une icône est un
 * livrable comme un autre — elle doit se régénérer d'une commande, pas se
 * retrouver dans un dossier sans qu'on sache d'où elle vient.
 *
 * Deux contraintes gouvernent le dessin :
 *
 *  - **Elle doit tenir à 16 pixels**, sa taille réelle dans la barre des
 *    tâches. D'où une silhouette pleine plutôt qu'un trait fin, et deux
 *    couleurs, pas six.
 *  - **Elle doit dire ce que fait l'application** : un bouclier pour ce qui
 *    est gardé, une courbe qui monte pour ce qui est suivi.
 *
 * Usage : node scripts/icone.mjs
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const SORTIE = join(ICI, '..', 'bureau', 'icone');

/** Couleurs du thème sombre de l'application. */
const FOND = [0x10, 0x13, 0x19];
const ACCENT = [0x2f, 0x5b, 0xd8];
const HAUSSE = [0x4a, 0xc5, 0x85];

/** Échantillons par axe et par pixel : c'est ce qui lisse les bords. */
const SUPER = 4;

// --------------------------------------------------------------- Géométrie

const melanger = (dessous, dessus, alpha) =>
  dessous.map((canal, index) => canal + (dessus[index] - canal) * alpha);

/** Distance d'un point au segment [a, b]. */
function distanceSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const longueur = dx * dx + dy * dy;
  const t = longueur === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / longueur));
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  return Math.hypot(px - qx, py - qy);
}

/** Point dans un carré aux coins arrondis, exprimé en fraction du côté. */
function dansCarreArrondi(x, y, rayon) {
  const cx = Math.min(Math.max(x, rayon), 1 - rayon);
  const cy = Math.min(Math.max(y, rayon), 1 - rayon);
  if (x >= rayon && x <= 1 - rayon) return y >= 0 && y <= 1;
  if (y >= rayon && y <= 1 - rayon) return x >= 0 && x <= 1;
  return Math.hypot(x - cx, y - cy) <= rayon;
}

/** Contour du bouclier, échantillonné une fois pour toutes. */
function contourBouclier() {
  const HAUT = 0.2;
  const EPAULE = 0.52;
  const BAS = 0.86;
  const DEMI = 0.27;

  const bezier = (t, p0, p1, p2) => {
    const u = 1 - t;
    return [
      u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
      u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
    ];
  };

  const points = [[0.5 - DEMI, HAUT], [0.5 + DEMI, HAUT], [0.5 + DEMI, EPAULE]];
  // Flanc droit, puis flanc gauche par symetrie : la pointe du bas est le
  // seul endroit ou les deux se rejoignent.
  for (let i = 1; i <= 24; i++) {
    points.push(bezier(i / 24, [0.5 + DEMI, EPAULE], [0.5 + DEMI, BAS - 0.04], [0.5, BAS]));
  }
  for (let i = 1; i <= 24; i++) {
    points.push(bezier(i / 24, [0.5, BAS], [0.5 - DEMI, BAS - 0.04], [0.5 - DEMI, EPAULE]));
  }
  return points;
}

const BOUCLIER = contourBouclier();

function dansPolygone(x, y, points) {
  let dedans = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      dedans = !dedans;
    }
  }
  return dedans;
}

/** Courbe ascendante, en fraction du côté. */
const COURBE = [
  [0.345, 0.635],
  [0.44, 0.545],
  [0.545, 0.6],
  [0.66, 0.44],
];
const EPAISSEUR = 0.045;

function surLaCourbe(x, y) {
  for (let i = 0; i < COURBE.length - 1; i++) {
    const [ax, ay] = COURBE[i];
    const [bx, by] = COURBE[i + 1];
    if (distanceSegment(x, y, ax, ay, bx, by) <= EPAISSEUR) {
      return true;
    }
  }
  // Pastille en bout de courbe : un disque survit a la reduction la ou une
  // fleche se brouille.
  const [fx, fy] = COURBE[COURBE.length - 1];
  return Math.hypot(x - fx, y - fy) <= EPAISSEUR * 1.5;
}

// ------------------------------------------------------------------- Rendu

function dessiner(taille) {
  const pixels = Buffer.alloc(taille * taille * 4);

  for (let py = 0; py < taille; py++) {
    for (let px = 0; px < taille; px++) {
      let couleur = [0, 0, 0];
      let opacite = 0;

      for (let sy = 0; sy < SUPER; sy++) {
        for (let sx = 0; sx < SUPER; sx++) {
          const x = (px + (sx + 0.5) / SUPER) / taille;
          const y = (py + (sy + 0.5) / SUPER) / taille;

          if (!dansCarreArrondi(x, y, 0.22)) {
            continue;
          }
          const teinte = surLaCourbe(x, y)
            ? HAUSSE
            : dansPolygone(x, y, BOUCLIER)
              ? ACCENT
              : FOND;

          couleur = [
            couleur[0] + teinte[0],
            couleur[1] + teinte[1],
            couleur[2] + teinte[2],
          ];
          opacite++;
        }
      }

      const total = SUPER * SUPER;
      const index = (py * taille + px) * 4;
      if (opacite === 0) {
        pixels.writeUInt32BE(0, index);
        continue;
      }
      // Les canaux sont pre-multiplies par le nombre d'echantillons couverts :
      // on divise par lui, pas par le total, sinon les bords s'assombrissent.
      pixels[index] = Math.round(couleur[0] / opacite);
      pixels[index + 1] = Math.round(couleur[1] / opacite);
      pixels[index + 2] = Math.round(couleur[2] / opacite);
      pixels[index + 3] = Math.round((opacite / total) * 255);
    }
  }

  return pixels;
}

// --------------------------------------------------------------- Encodage

function crc32(donnees) {
  let reste = 0xffffffff;
  for (const octet of donnees) {
    reste ^= octet;
    for (let bit = 0; bit < 8; bit++) {
      reste = reste & 1 ? (reste >>> 1) ^ 0xedb88320 : reste >>> 1;
    }
  }
  return (reste ^ 0xffffffff) >>> 0;
}

function bloc(type, donnees) {
  const entete = Buffer.alloc(8);
  entete.writeUInt32BE(donnees.length, 0);
  entete.write(type, 4, 'ascii');
  const corps = Buffer.concat([Buffer.from(type, 'ascii'), donnees]);
  const controle = Buffer.alloc(4);
  controle.writeUInt32BE(crc32(corps), 0);
  return Buffer.concat([entete, donnees, controle]);
}

function encoderPng(pixels, taille) {
  const brut = Buffer.alloc(taille * (taille * 4 + 1));
  for (let y = 0; y < taille; y++) {
    // Octet de filtre par ligne : 0, aucun filtre.
    brut[y * (taille * 4 + 1)] = 0;
    pixels.copy(brut, y * (taille * 4 + 1) + 1, y * taille * 4, (y + 1) * taille * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(taille, 0);
  ihdr.writeUInt32BE(taille, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // couleur vraie avec alpha
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloc('IHDR', ihdr),
    bloc('IDAT', deflateSync(brut, { level: 9 })),
    bloc('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ Sortie

mkdirSync(SORTIE, { recursive: true });

for (const taille of [512, 256, 64, 32, 16]) {
  const fichier = join(SORTIE, `icone-${taille}.png`);
  writeFileSync(fichier, encoderPng(dessiner(taille), taille));
  console.log(`${fichier} (${taille}×${taille})`);
}
