/**
 * Géométrie des graphiques, en fonctions pures.
 *
 * Tout ce qui se calcule — échelles, graduations, tracés, découpage d'un
 * treemap — vit ici, sans React ni SVG. Les composants n'ont plus qu'à poser
 * des formes aux coordonnées rendues, et ces calculs se testent sans rendu.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rectangle {
  x: number;
  y: number;
  largeur: number;
  hauteur: number;
}

/** Projette linéairement un domaine sur une plage de pixels. */
export function echelle(
  domaine: readonly [number, number],
  plage: readonly [number, number],
): (valeur: number) => number {
  const [d0, d1] = domaine;
  const [p0, p1] = plage;
  const ecart = d1 - d0;
  if (ecart === 0 || !Number.isFinite(ecart)) {
    // Domaine plat : tout au milieu plutôt qu'une division par zéro.
    const milieu = (p0 + p1) / 2;
    return () => milieu;
  }
  return valeur => p0 + ((valeur - d0) / ecart) * (p1 - p0);
}

/** Arrondit un pas à 1, 2, 2,5 ou 5 fois une puissance de dix. */
function pasLisible(brut: number): number {
  if (brut <= 0 || !Number.isFinite(brut)) {
    return 1;
  }
  const puissance = 10 ** Math.floor(Math.log10(brut));
  const fraction = brut / puissance;
  const lisible = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return lisible * puissance;
}

/**
 * Graduations lisibles couvrant `[min, max]`.
 *
 * Renvoie le domaine arrondi aux graduations extrêmes : la courbe tient
 * entièrement dans le cadre, et le premier et le dernier trait tombent sur
 * des nombres ronds.
 */
export function graduations(
  min: number,
  max: number,
  cible = 5,
): { valeurs: number[]; domaine: [number, number] } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { valeurs: [0, 1], domaine: [0, 1] };
  }
  let bas = Math.min(min, max);
  let haut = Math.max(min, max);
  if (bas === haut) {
    // Série plate : on ouvre une fenêtre autour de la valeur.
    const marge = bas === 0 ? 1 : Math.abs(bas) * 0.1;
    bas -= marge;
    haut += marge;
  }

  const pas = pasLisible((haut - bas) / Math.max(1, cible));
  const debut = Math.floor(bas / pas) * pas;
  const fin = Math.ceil(haut / pas) * pas;

  const valeurs: number[] = [];
  // Arrondi à la précision du pas : 0,1 + 0,2 ne doit pas afficher 0,30000000004.
  const decimales = Math.max(0, -Math.floor(Math.log10(pas)) + 1);
  for (let valeur = debut; valeur <= fin + pas / 2; valeur += pas) {
    valeurs.push(Number(valeur.toFixed(decimales)));
  }
  return { valeurs, domaine: [debut, fin] };
}

/** Tracé polygonal : chaque point relié au suivant par un segment. */
export function cheminLigne(points: readonly Point[]): string {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${arrondir(point.x)},${arrondir(point.y)}`)
    .join('');
}

/**
 * Tracé lissé, sans dépassement.
 *
 * Interpolation cubique monotone (Fritsch–Carlson) : la courbe passe par
 * chaque point et ne crée jamais de bosse qui n'existe pas dans les données.
 * Une spline ordinaire, elle, dessinerait un creux sous le minimum réel —
 * fâcheux sur un graphique de cours.
 */
export function cheminCourbe(points: readonly Point[]): string {
  const n = points.length;
  if (n < 3) {
    return cheminLigne(points);
  }

  const pentes: number[] = [];
  const deltas: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    deltas.push(dx === 0 ? 0 : (points[i + 1].y - points[i].y) / dx);
  }

  pentes.push(deltas[0]);
  for (let i = 1; i < n - 1; i++) {
    if (deltas[i - 1] * deltas[i] <= 0) {
      pentes.push(0);
    } else {
      pentes.push((deltas[i - 1] + deltas[i]) / 2);
    }
  }
  pentes.push(deltas[n - 2]);

  // Bride les pentes pour garantir la monotonie entre deux points.
  for (let i = 0; i < n - 1; i++) {
    if (deltas[i] === 0) {
      pentes[i] = 0;
      pentes[i + 1] = 0;
      continue;
    }
    const a = pentes[i] / deltas[i];
    const b = pentes[i + 1] / deltas[i];
    const norme = a * a + b * b;
    if (norme > 9) {
      const t = 3 / Math.sqrt(norme);
      pentes[i] = t * a * deltas[i];
      pentes[i + 1] = t * b * deltas[i];
    }
  }

  let chemin = `M${arrondir(points[0].x)},${arrondir(points[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const dx = (p1.x - p0.x) / 3;
    chemin +=
      `C${arrondir(p0.x + dx)},${arrondir(p0.y + pentes[i] * dx)}` +
      ` ${arrondir(p1.x - dx)},${arrondir(p1.y - pentes[i + 1] * dx)}` +
      ` ${arrondir(p1.x)},${arrondir(p1.y)}`;
  }
  return chemin;
}

/** Ferme un tracé jusqu'à une ligne de base, pour remplir l'aire dessous. */
export function cheminAire(tracé: string, points: readonly Point[], base: number): string {
  if (points.length === 0) {
    return '';
  }
  const premier = points[0];
  const dernier = points[points.length - 1];
  return `${tracé}L${arrondir(dernier.x)},${arrondir(base)}L${arrondir(premier.x)},${arrondir(base)}Z`;
}

function polaire(cx: number, cy: number, rayon: number, angle: number): Point {
  // Angle 0 en haut, sens horaire : l'usage des graphiques circulaires.
  return {
    x: cx + rayon * Math.sin(angle),
    y: cy - rayon * Math.cos(angle),
  };
}

/** Secteur d'anneau entre deux angles, en radians. */
export function arcAnneau(
  cx: number,
  cy: number,
  rayonExterieur: number,
  rayonInterieur: number,
  debut: number,
  fin: number,
): string {
  // Un anneau complet ne se trace pas d'un seul arc : ses extrémités se
  // confondraient. On le coupe juste avant le tour.
  const finEffective = fin - debut >= Math.PI * 2 ? debut + Math.PI * 2 - 1e-4 : fin;
  const grand = finEffective - debut > Math.PI ? 1 : 0;

  const e0 = polaire(cx, cy, rayonExterieur, debut);
  const e1 = polaire(cx, cy, rayonExterieur, finEffective);
  const i1 = polaire(cx, cy, rayonInterieur, finEffective);
  const i0 = polaire(cx, cy, rayonInterieur, debut);

  return (
    `M${arrondir(e0.x)},${arrondir(e0.y)}` +
    `A${rayonExterieur},${rayonExterieur} 0 ${grand} 1 ${arrondir(e1.x)},${arrondir(e1.y)}` +
    `L${arrondir(i1.x)},${arrondir(i1.y)}` +
    `A${rayonInterieur},${rayonInterieur} 0 ${grand} 0 ${arrondir(i0.x)},${arrondir(i0.y)}Z`
  );
}

/** Point milieu d'un secteur, pour y accrocher une étiquette. */
export function milieuArc(
  cx: number,
  cy: number,
  rayon: number,
  debut: number,
  fin: number,
): Point {
  return polaire(cx, cy, rayon, (debut + fin) / 2);
}

export interface ElementTreemap {
  valeur: number;
}

/**
 * Treemap « squarifié » (Bruls, Huizing, van Wijk).
 *
 * Range les éléments, du plus gros au plus petit, en rangées dont les
 * rectangles restent aussi proches du carré que possible : des carrés se
 * comparent d'un coup d'œil, des lanières non.
 *
 * Renvoie un rectangle par élément, dans l'ordre d'entrée.
 */
export function treemap(
  elements: readonly ElementTreemap[],
  cadre: Rectangle,
): Rectangle[] {
  const resultat: Rectangle[] = elements.map(() => ({ x: cadre.x, y: cadre.y, largeur: 0, hauteur: 0 }));
  const total = elements.reduce((somme, element) => somme + Math.max(0, element.valeur), 0);
  if (total <= 0 || cadre.largeur <= 0 || cadre.hauteur <= 0) {
    return resultat;
  }

  const echelleAire = (cadre.largeur * cadre.hauteur) / total;
  const ordre = elements
    .map((element, index) => ({ index, aire: Math.max(0, element.valeur) * echelleAire }))
    .filter(element => element.aire > 0)
    .sort((a, b) => b.aire - a.aire);

  let libre: Rectangle = { ...cadre };
  let rangee: typeof ordre = [];

  const pire = (ligne: typeof ordre, cote: number): number => {
    const somme = ligne.reduce((s, e) => s + e.aire, 0);
    const max = Math.max(...ligne.map(e => e.aire));
    const min = Math.min(...ligne.map(e => e.aire));
    return Math.max((cote * cote * max) / (somme * somme), (somme * somme) / (cote * cote * min));
  };

  const poser = (ligne: typeof ordre) => {
    const somme = ligne.reduce((s, e) => s + e.aire, 0);
    if (libre.largeur >= libre.hauteur) {
      // Colonne à gauche de l'espace libre.
      const largeur = somme / libre.hauteur;
      let y = libre.y;
      for (const element of ligne) {
        const hauteur = element.aire / largeur;
        resultat[element.index] = { x: libre.x, y, largeur, hauteur };
        y += hauteur;
      }
      libre = { x: libre.x + largeur, y: libre.y, largeur: libre.largeur - largeur, hauteur: libre.hauteur };
    } else {
      // Rangée en haut de l'espace libre.
      const hauteur = somme / libre.largeur;
      let x = libre.x;
      for (const element of ligne) {
        const largeur = element.aire / hauteur;
        resultat[element.index] = { x, y: libre.y, largeur, hauteur };
        x += largeur;
      }
      libre = { x: libre.x, y: libre.y + hauteur, largeur: libre.largeur, hauteur: libre.hauteur - hauteur };
    }
  };

  for (const element of ordre) {
    const cote = Math.min(libre.largeur, libre.hauteur);
    if (rangee.length === 0 || pire([...rangee, element], cote) <= pire(rangee, cote)) {
      rangee.push(element);
    } else {
      poser(rangee);
      rangee = [element];
    }
  }
  if (rangee.length > 0) {
    poser(rangee);
  }

  return resultat;
}

const MOIS_COURTS = [
  'Janv.',
  'Févr.',
  'Mars',
  'Avr.',
  'Mai',
  'Juin',
  'Juil.',
  'Août',
  'Sept.',
  'Oct.',
  'Nov.',
  'Déc.',
];

/** « 2026-08-03 » devient « Août 2026 ». */
export function moisAnnee(iso: string): string {
  const mois = Number(iso.slice(5, 7));
  const annee = iso.slice(0, 4);
  return `${MOIS_COURTS[mois - 1] ?? iso.slice(5, 7)} ${annee}`;
}

/** Libellé court d'un mois seul : « Août ». */
export function moisCourt(numero: number): string {
  return MOIS_COURTS[numero - 1] ?? String(numero);
}

/**
 * Indices des dates à étiqueter sur un axe.
 *
 * Répartis régulièrement, premier et dernier compris, sans jamais dépasser
 * `maximum` étiquettes : au-delà, elles se chevauchent.
 */
export function indicesEtiquettes(nombre: number, maximum: number): number[] {
  if (nombre <= 0) {
    return [];
  }
  if (nombre <= maximum) {
    return Array.from({ length: nombre }, (_, index) => index);
  }
  const indices = new Set<number>();
  for (let i = 0; i < maximum; i++) {
    indices.add(Math.round((i * (nombre - 1)) / (maximum - 1)));
  }
  return [...indices].sort((a, b) => a - b);
}

/** Indice du point le plus proche d'une abscisse, pour le survol. */
export function plusProche(abscisses: readonly number[], x: number): number {
  if (abscisses.length === 0) {
    return -1;
  }
  let meilleur = 0;
  let distance = Infinity;
  for (let index = 0; index < abscisses.length; index++) {
    const ecart = Math.abs(abscisses[index] - x);
    if (ecart < distance) {
      distance = ecart;
      meilleur = index;
    }
  }
  return meilleur;
}

function arrondir(valeur: number): number {
  return Math.round(valeur * 100) / 100;
}
