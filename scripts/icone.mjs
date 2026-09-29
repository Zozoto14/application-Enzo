/**
 * Génère l'icône d'AppDashboard (logo du hub).
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
 *  - **Elle doit être celle d'AppDashboard** : le logo en grille du hub
 *    (carré arrondi, grille 2×2 et « + »), en blanc sur l'accent.
 *
 * Usage : node scripts/icone.mjs
 *
 * Écrit aussi les copies du site : bureau/public/icone-192.png (256 px, voir
 * le manifest) et icone-512.png.
 */

import { deflateSync } from 'node:zlib';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const SORTIE = join(ICI, '..', 'bureau', 'icone');
const PUBLIC = join(ICI, '..', 'bureau', 'public');

/** Couleurs du thème sombre de l'application. */
const ACCENT = [0x2f, 0x5b, 0xd8];
const TRAIT = [0xff, 0xff, 0xff];

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

/**
 * Logo d'AppDashboard : grille 2×2 dont la quatrième case est un « + ».
 * Même motif que `src/hub/LogoHub.web.tsx` (repère de 24, épaisseur 2,2),
 * centré et agrandi pour rester lisible à 16 pixels.
 */
const ECHELLE = 0.64 / 24; // le motif occupe 64 % du côté
const DEBUT = (1 - 24 * ECHELLE) / 2;
const EPAISSEUR = 2.2 * ECHELLE;
const CASES = [
  [3, 3],
  [14, 3],
  [3, 14],
];

const enPlan = v => DEBUT + v * ECHELLE;

/** Point dans un rectangle aux coins arrondis (fractions du côté). */
function dansRectArrondi(x, y, x0, y0, w, h, rayon) {
  const cx = Math.min(Math.max(x, x0 + rayon), x0 + w - rayon);
  const cy = Math.min(Math.max(y, y0 + rayon), y0 + h - rayon);
  return Math.hypot(x - cx, y - cy) <= rayon && x >= x0 && x <= x0 + w && y >= y0 && y <= y0 + h;
}

function surLeMotif(x, y) {
  const e = EPAISSEUR / 2;
  for (const [cx, cy] of CASES) {
    const x0 = enPlan(cx);
    const y0 = enPlan(cy);
    const cote = 7 * ECHELLE;
    const rayon = 2 * ECHELLE;
    const dehors = dansRectArrondi(x, y, x0 - e, y0 - e, cote + 2 * e, cote + 2 * e, rayon + e);
    const dedans = dansRectArrondi(x, y, x0 + e, y0 + e, cote - 2 * e, cote - 2 * e, Math.max(rayon - e, 0));
    if (dehors && !dedans) return true;
  }
  return (
    distanceSegment(x, y, enPlan(17.5), enPlan(14), enPlan(17.5), enPlan(21)) <= e ||
    distanceSegment(x, y, enPlan(14), enPlan(17.5), enPlan(21), enPlan(17.5)) <= e
  );
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
          const teinte = surLeMotif(x, y) ? TRAIT : ACCENT;

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

copyFileSync(join(SORTIE, 'icone-256.png'), join(PUBLIC, 'icone-192.png'));
copyFileSync(join(SORTIE, 'icone-512.png'), join(PUBLIC, 'icone-512.png'));
console.log('Copies du site : bureau/public/icone-192.png, icone-512.png');
