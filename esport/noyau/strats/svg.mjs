/**
 * Rendu SVG d'une strat (page publique en lecture seule, `GET /partage/
 * strats/<jeton>`) : pur, sans dépendance. Le document est déjà validé
 * (document.mjs) : images limitées au CDN de valorant-api.com, textes
 * nettoyés ; tout texte est en plus échappé ici.
 *
 * MÊME langage visuel que l'atelier (jetons de design de plateau.json, lus aussi par l'app) : map rendue en plateau
 * (filtre SVG sur l'alpha de la minimap : sol teinté, liseré clair, fond sombre et vignettage), utilitaires
 * reconnaissables par genre (fumée, zone de feu, mur, flash, reconnaissance, fil, piège), pions avec la photo de
 * l'agent dans un anneau à la couleur du joueur, nom du joueur, tracés selon leur usage, textes à halo sombre.
 *
 * Repli hors ligne : chaque agent est d'abord un disque avec ses initiales, l'icône ne fait que s'y superposer (si
 * elle ne charge pas, la strat reste lisible). Les images relatives (`esport-assets/…`) ne sont pas servies par le
 * serveur Esport : elles sont ignorées ici.
 */

import { calqueDe } from './document.mjs';
import { echelleEffective } from './modeles.mjs';
import T from './plateau.json' with { type: 'json' };

export const MENTION_RIOT =
  'AppDashboard was created under Riot Games\' "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project.';

export function echapper(texte) {
  return String(texte ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const imageDistante = url => (typeof url === 'string' && url.startsWith('https://media.valorant-api.com/') ? url : null);

const cdnRiot = url => (typeof url === 'string' && /^https:\/\/media\.valorant-api\.com\/[A-Za-z0-9/_.-]{1,200}$/.test(url) ? url : null);

/**
 * Page publique : un pion ou une capacité posé sans icône (strat dessinée avant l'import des portraits) reprend
 * l'adresse du CDN officiel gardée dans le profil du jeu (`personnages[].source.url`, `officielles[].url`). Les
 * images du stockage du serveur (liens signés, qui expirent) n'entrent jamais dans la page. Une strat réglée sur
 * « Couleur : agent » y reçoit aussi l'accent du profil pour ses capacités. Rend un nouveau document.
 */
export function completerIcones(doc, donneesJeu) {
  const persos = new Map((donneesJeu?.personnages ?? []).map(p => [p.cle, p]));
  if (!persos.size) return doc;
  const touches = { Grenade: 'C', Ability1: 'Q', Ability2: 'E', Ultimate: 'X' };
  const icone = o => {
    const p = persos.get(o.agent);
    if (!p) return null;
    if (o.type === 'agent') return cdnRiot(p.source?.url);
    const off = (p.officielles ?? []).find(c => c.slot === o.capacite || c.touche === touches[o.capacite] || c.touche === o.capacite);
    return cdnRiot(off?.url);
  };
  // Strat réglée sur « Couleur : agent » : les capacités prennent l'accent saisi dans le profil (capacité, sinon personnage).
  const accent = o => {
    if (doc.couleurs !== 'agent' || o.type !== 'capacite') return null;
    const p = persos.get(o.agent);
    const propre = (p?.capacites ?? []).find(c => c.cle === o.capacite || (c.touche && c.touche.toUpperCase() === touches[o.capacite]))?.couleur;
    const c = propre ?? p?.couleur;
    return typeof c === 'string' && /^#[0-9a-f]{6}$/.test(c) ? c : null;
  };
  const completer = o => {
    if (o.type !== 'agent' && o.type !== 'capacite') return o;
    const i = !imageDistante(o.icone) ? icone(o) : null;
    const c = accent(o);
    return i || c ? { ...o, ...(i ? { icone: i } : {}), ...(c ? { couleur: c } : {}) } : o;
  };
  return { ...doc, etapes: doc.etapes.map(e => ({ ...e, objets: e.objets.map(completer) })) };
}
export const initiales = nom =>
  String(nom ?? '?')
    .split(/[\s/_-]+/)
    .filter(Boolean)
    .map(m => m[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';

const THEME = T.themes.tactique;
const POLICE = echapper(T.police);
const rad = a => (a * Math.PI) / 180;
const f1 = n => Number(n).toFixed(1);
const motif = cle => new RegExp(T.motifs[cle], 'i');
const MOTIFS = { fumees: motif('fumees'), feux: motif('feux'), pieges: motif('pieges'), blobs: motif('blobs'), flashs: motif('flashs') };

/** Couleur mêlée à une autre (`f` : part de la seconde) ; miroir de src/esport/strats/plateau.ts. */
function melanger(a, b, f) {
  const c = h => [1, 3, 5].map(i => Number.parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [c(a), c(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * f).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Genre graphique d'une capacité posée, d'après sa forme et son nom (miroir de `styleCapacite`,
 * src/esport/strats/plateau.ts ; la page publique n'a pas les caractéristiques du profil).
 */
export function genreCapacite(o) {
  const z = o.zone;
  const nom = String(o.nom ?? '');
  const ultime = o.capacite === 'Ultimate';
  if (!z) return { genre: 'icone', ultime, chaud: false };
  switch (z.forme) {
    case 'cercle':
      if (MOTIFS.blobs.test(nom)) return { genre: 'blob', ultime, chaud: false };
      if (MOTIFS.pieges.test(nom)) return { genre: 'piege', ultime, chaud: false };
      if (MOTIFS.fumees.test(nom)) return { genre: 'fumee', ultime, chaud: false };
      if (MOTIFS.feux.test(nom)) return { genre: 'zone', ultime, chaud: true };
      return { genre: z.rayon >= 12 ? 'aire' : 'zone', ultime, chaud: false };
    case 'mur':
      return { genre: 'mur', ultime, chaud: MOTIFS.feux.test(nom) || /blaze|brasier/i.test(nom) };
    case 'cone':
      return { genre: MOTIFS.flashs.test(nom) ? 'eclair' : 'cone', ultime, chaud: false };
    case 'trajet':
      return { genre: 'recon', ultime, chaud: false };
    case 'ligne':
      return { genre: 'fil', ultime, chaud: false };
    default:
      return { genre: 'bande', ultime, chaud: MOTIFS.feux.test(nom) };
  }
}

/** Texte à halo sombre (lisible sur la map comme sur une zone colorée). */
function texteHalo(x, y, contenu, taille, couleur = T.encre, plus = '') {
  return `<text x="${f1(x)}" y="${f1(y)}" font-size="${taille}" font-family="${POLICE}" font-weight="700" fill="${couleur}" stroke="${T.halo}" stroke-width="${f1(Math.max(2.4, taille * 0.2))}" stroke-linejoin="round" paint-order="stroke"${plus}>${echapper(contenu)}</text>`;
}

/** Pastille de nom (joueur sous son pion). */
function pastille(x, y, nom) {
  const texte = String(nom).slice(0, 14);
  const l = Math.max(30, texte.length * 7.4 + 14);
  return `<rect x="${f1(x - l / 2)}" y="${f1(y)}" width="${f1(l)}" height="19" rx="9.5" fill="${T.puce}" fill-opacity="0.86"/><text x="${f1(x)}" y="${f1(y + 14)}" text-anchor="middle" font-size="${T.typo.s}" font-family="${POLICE}" font-weight="700" fill="${T.encre}">${echapper(texte)}</text>`;
}

/**
 * Jeton rond : ombre, anneau de couleur, initiales, puis l'image DÉCOUPÉE en rond par-dessus (si elle ne charge pas,
 * les initiales restent). `id` : identifiant unique du découpage.
 */
function jeton(id, x, y, rayon, couleur, nom, icone, { anneau = T.pion.anneau, fond = '#111827', inconnu = false } = {}) {
  const img = imageDistante(icone);
  return [
    `<circle cx="${x}" cy="${y + 3}" r="${f1(rayon + anneau + 1)}" fill="#000000" fill-opacity="0.38"/>`,
    `<circle cx="${x}" cy="${y}" r="${f1(rayon + anneau)}" fill="${couleur}" stroke="${T.halo}" stroke-width="1.5"/>`,
    `<circle cx="${x}" cy="${y}" r="${f1(rayon + 0.6)}" fill="${T.halo}"/>`,
    `<circle cx="${x}" cy="${y}" r="${rayon}" fill="${inconnu ? '#1f2937' : fond}"/>`,
    `<text x="${x}" y="${f1(y + rayon * 0.32)}" text-anchor="middle" font-size="${f1(rayon * (inconnu ? 1.25 : 0.86))}" font-family="${POLICE}" font-weight="700" fill="#ffffff">${inconnu ? '?' : echapper(initiales(nom))}</text>`,
    img && !inconnu ? `<clipPath id="rond-${id}"><circle cx="${x}" cy="${y}" r="${rayon}"/></clipPath><image href="${echapper(img)}" x="${x - rayon}" y="${y - rayon}" width="${rayon * 2}" height="${rayon * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#rond-${id})"/>` : '',
  ].join('');
}

/** Secteur (cône de flash, de vision) : centre, angle et ouverture en degrés, portée en unités du repère. */
function secteur(x, y, angleDeg, ouverture, r, attributs) {
  if (ouverture >= 359) return `<circle cx="${x}" cy="${y}" r="${f1(r)}" ${attributs}/>`;
  const a = rad(angleDeg - ouverture / 2);
  const b = rad(angleDeg + ouverture / 2);
  const p = ang => `${f1(x + r * Math.cos(ang))} ${f1(y + r * Math.sin(ang))}`;
  return `<path d="M ${x} ${y} L ${p(a)} A ${f1(r)} ${f1(r)} 0 ${ouverture > 180 ? 1 : 0} 1 ${p(b)} Z" ${attributs}/>`;
}

/** Polyligne décalée perpendiculairement de `d` (mur double ; miroir de src/esport/strats/geometrie.ts). */
function decaler(points, d) {
  const n = points.length / 2;
  const sortie = [];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    const dx = points[b * 2] - points[a * 2];
    const dy = points[b * 2 + 1] - points[a * 2 + 1];
    const l = Math.hypot(dx, dy) || 1;
    sortie.push(points[i * 2] - (dy / l) * d, points[i * 2 + 1] + (dx / l) * d);
  }
  return sortie;
}

/** Dégradés d'une capacité (définis à côté de la forme : identifiants uniques par objet). */
function degrades(id, c, style, x, y, r) {
  const chaud = style.chaud ? melanger(c, '#f97316', 0.45) : c;
  if (style.genre === 'fumee')
    // Disque « sphère » : reflet clair décalé, bord dense.
    return `<radialGradient id="g-${id}" gradientUnits="userSpaceOnUse" cx="${f1(x - r * 0.28)}" cy="${f1(y - r * 0.3)}" r="${f1(r * 1.25)}"><stop offset="0" stop-color="${melanger(c, '#ffffff', 0.45)}" stop-opacity="0.5"/><stop offset="0.55" stop-color="${c}" stop-opacity="0.42"/><stop offset="1" stop-color="${melanger(c, '#000000', 0.35)}" stop-opacity="0.62"/></radialGradient>`;
  if (style.genre === 'eclair' || style.genre === 'cone')
    return `<radialGradient id="g-${id}" gradientUnits="userSpaceOnUse" cx="${x}" cy="${y}" r="${f1(r)}"><stop offset="0" stop-color="${melanger(c, '#ffffff', style.genre === 'eclair' ? 0.6 : 0.1)}" stop-opacity="${style.genre === 'eclair' ? 0.7 : 0.34}"/><stop offset="1" stop-color="${c}" stop-opacity="${style.genre === 'eclair' ? 0.04 : 0.12}"/></radialGradient>`;
  // Zone au sol : cœur chaud, bord net.
  return `<radialGradient id="g-${id}" gradientUnits="userSpaceOnUse" cx="${x}" cy="${y}" r="${f1(r)}"><stop offset="0" stop-color="${melanger(chaud, '#ffffff', style.chaud ? 0.35 : 0.1)}" stop-opacity="${style.chaud ? 0.55 : 0.3}"/><stop offset="1" stop-color="${chaud}" stop-opacity="${style.chaud ? 0.34 : 0.2}"/></radialGradient>`;
}

/**
 * Forme d'une zone de capacité (mètres → unités avec l'échelle `k` de la map), dessinée selon son genre.
 * `style` absent : déduit de l'objet (`genreCapacite`).
 */
export function zoneSvg(o, z, k, style = genreCapacite({ ...o, zone: z })) {
  const c = o.couleur;
  const id = String(o.id ?? 'z').replace(/[^A-Za-z0-9_-]/g, '');
  const bord = style.ultime ? T.capacite.ultimeBord : T.trait.normal;
  switch (z?.forme) {
    case 'cercle': {
      const r = z.rayon * k;
      const cercle = attributs => `<circle cx="${o.x}" cy="${o.y}" r="${f1(r)}" ${attributs}/>`;
      if (style.genre === 'fumee' && o.creux) return cercle(`fill="${c}" fill-opacity="0.08" stroke="${c}" stroke-width="${f1(Math.max(4, r * 0.22))}" stroke-opacity="0.55"`) + cercle(`fill="none" stroke="${melanger(c, '#ffffff', 0.35)}" stroke-width="${bord}"`);
      if (style.genre === 'piege') return cercle(`fill="${c}" fill-opacity="0.1" stroke="${c}" stroke-width="${bord}" stroke-dasharray="7 6"`) + `<circle cx="${o.x}" cy="${o.y}" r="${f1(Math.min(r * 0.4, 16))}" fill="${c}" fill-opacity="0.45"/>`;
      if (style.genre === 'aire') return cercle(`fill="${c}" fill-opacity="0.12" stroke="${c}" stroke-width="${bord}"`);
      return degrades(id, c, style, o.x, o.y, r) + cercle(`fill="url(#g-${id})" stroke="${style.genre === 'fumee' ? melanger(c, '#ffffff', 0.3) : style.chaud ? melanger(c, '#f97316', 0.45) : c}" stroke-width="${bord}"${style.genre === 'blob' ? ' stroke-dasharray="14 5"' : ''}`);
    }
    case 'cone': {
      const r = z.portee * k;
      return degrades(id, c, style, o.x, o.y, r) + secteur(o.x, o.y, z.angle, z.ouverture, r, `fill="url(#g-${id})" stroke="${c}" stroke-width="${T.trait.fin}" stroke-opacity="${style.genre === 'eclair' ? 0.5 : 0.9}"${style.genre === 'cone' ? ' stroke-dasharray="8 5"' : ''}`);
    }
    case 'mur':
    case 'ligne': {
      const l = z.longueur * k;
      const x2 = o.x + l * Math.cos(rad(z.angle));
      const y2 = o.y + l * Math.sin(rad(z.angle));
      const ep = z.forme === 'mur' ? Math.max(4, z.largeur * k) : 3;
      const teinte = style.chaud ? melanger(c, '#f97316', 0.45) : c;
      if (z.forme === 'mur' && (z.double || (Array.isArray(z.trace) && z.trace.length >= 2))) {
        // Mur tracé point par point (High Tide) et / ou double (Fast Lane) : polyligne(s).
        const pts = [o.x, o.y];
        if (Array.isArray(z.trace) && z.trace.length >= 2) for (let i = 0; i + 1 < z.trace.length; i += 2) pts.push(o.x + z.trace[i] * k, o.y + z.trace[i + 1] * k);
        else pts.push(x2, y2);
        const ligne = (q, e) => `<polyline points="${q.map(f1).join(' ')}" fill="none" stroke="${teinte}" stroke-width="${f1(e)}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.85"/>`;
        if (!z.double) return ligne(pts, ep);
        const d = Math.max(4, z.largeur * k) / 2;
        return ligne(decaler(pts, d), Math.max(2.5, 0.4 * k)) + ligne(decaler(pts, -d), Math.max(2.5, 0.4 * k));
      }
      if (z.forme === 'mur' && z.courbure) {
        const mx = (o.x + x2) / 2 - (l / 2) * z.courbure * Math.sin(rad(z.angle));
        const my = (o.y + y2) / 2 + (l / 2) * z.courbure * Math.cos(rad(z.angle));
        const d = `M ${o.x} ${o.y} Q ${f1(mx)} ${f1(my)} ${f1(x2)} ${f1(y2)}`;
        return `<path d="${d}" fill="none" stroke="${teinte}" stroke-width="${f1(ep + 8)}" stroke-linecap="round" stroke-opacity="0.2"/><path d="${d}" fill="none" stroke="${teinte}" stroke-width="${f1(ep)}" stroke-linecap="round" stroke-opacity="0.88"/>`;
      }
      if (z.forme === 'ligne') {
        // Fil : ligne fine, embouts aux deux bouts, zone de détection légère.
        const embout = (x, y) => `<circle cx="${f1(x)}" cy="${f1(y)}" r="5" fill="${T.puce}" stroke="${c}" stroke-width="2.2"/>`;
        return `<line x1="${o.x}" y1="${o.y}" x2="${f1(x2)}" y2="${f1(y2)}" stroke="${c}" stroke-width="12" stroke-linecap="round" stroke-opacity="0.16"/><line x1="${o.x}" y1="${o.y}" x2="${f1(x2)}" y2="${f1(y2)}" stroke="${c}" stroke-width="${ep}" stroke-linecap="round" stroke-dasharray="6 4"/>${embout(o.x, o.y)}${embout(x2, y2)}`;
      }
      // Mur droit : lueur large, bande nette.
      return `<line x1="${o.x}" y1="${o.y}" x2="${f1(x2)}" y2="${f1(y2)}" stroke="${teinte}" stroke-width="${f1(ep + 8)}" stroke-linecap="round" stroke-opacity="0.2"/><line x1="${o.x}" y1="${o.y}" x2="${f1(x2)}" y2="${f1(y2)}" stroke="${teinte}" stroke-width="${f1(ep)}" stroke-linecap="round" stroke-opacity="0.88"/>`;
    }
    case 'rect': {
      const l = z.longueur * k;
      const h = z.largeur * k;
      const teinte = style.chaud ? melanger(c, '#f97316', 0.45) : c;
      return `<rect x="${o.x}" y="${f1(o.y - h / 2)}" width="${f1(l)}" height="${f1(h)}" rx="3" transform="rotate(${z.angle} ${o.x} ${o.y})" fill="${teinte}" fill-opacity="0.26" stroke="${teinte}" stroke-width="${bord}"/>`;
    }
    case 'trajet':
      // Reconnaissance : trajet en tirets depuis le lanceur, anneau de révélation à l'arrivée.
      return `<line x1="${f1(o.x + z.dx)}" y1="${f1(o.y + z.dy)}" x2="${o.x}" y2="${o.y}" stroke="${c}" stroke-width="${T.trait.normal}" stroke-dasharray="9 7" stroke-linecap="round"/>${z.rayon ? `<circle cx="${o.x}" cy="${o.y}" r="${f1(z.rayon * k)}" fill="${c}" fill-opacity="0.1" stroke="${c}" stroke-width="${T.trait.fin}" stroke-dasharray="5 5"/><circle cx="${o.x}" cy="${o.y}" r="${f1(z.rayon * k * 0.55)}" fill="none" stroke="${c}" stroke-width="1" stroke-opacity="0.5"/>` : ''}`;
    default:
      return '';
  }
}

/** Glyphe d'un marqueur selon son genre (mêmes formes que l'atelier), avec sa lettre. */
function marqueurSvg(o) {
  const r = T.marqueur.rayon;
  const c = o.couleur;
  const contour = `stroke="${T.halo}" stroke-width="2.2" stroke-linejoin="round"`;
  const lettre = T.lettresMarqueur[o.genre];
  const texte = lettre ? `<text x="${o.x}" y="${f1(o.y + r * 0.38)}" text-anchor="middle" font-size="${f1(r * 1.05)}" font-family="${POLICE}" font-weight="700" fill="#ffffff" stroke="${T.halo}" stroke-width="2.2" paint-order="stroke">${echapper(lettre)}</text>` : '';
  let forme;
  if (o.genre === 'ennemi') forme = `<circle cx="${o.x}" cy="${o.y}" r="${r}" fill="${c}" ${contour}/><path d="M ${o.x - 6} ${o.y - 6} L ${o.x + 6} ${o.y + 6} M ${o.x + 6} ${o.y - 6} L ${o.x - 6} ${o.y + 6}" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>`;
  else if (o.genre === 'danger' || o.genre === 'tiers') forme = `<path d="M ${o.x} ${o.y - r - 3} L ${f1(o.x + (r + 3) * 0.95)} ${f1(o.y + (r + 3) * 0.62)} L ${f1(o.x - (r + 3) * 0.95)} ${f1(o.y + (r + 3) * 0.62)} Z" fill="${c}" ${contour}/>`;
  else if (o.genre === 'destruction-mur' || o.genre === 'destruction-sol')
    forme = `<rect x="${o.x - r}" y="${o.y - r}" width="${r * 2}" height="${r * 2}" rx="3" fill="${T.puce}" stroke="${c}" stroke-width="2.6"${o.genre === 'destruction-sol' ? ' stroke-dasharray="5 4"' : ''}/><path d="M ${o.x - 9} ${o.y - 10} L ${o.x - 2} ${o.y - 3} L ${o.x - 6} ${o.y + 1} L ${o.x + 3} ${o.y + 4} L ${o.x - 1} ${o.y + 10} M ${o.x - 2} ${o.y - 3} L ${o.x + 7} ${o.y - 8} M ${o.x + 3} ${o.y + 4} L ${o.x + 10} ${o.y + 6}" fill="none" stroke="${c}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>`;
  else if (o.genre === 'spawn' || o.genre === 'info' || o.genre === 'cashout' || o.genre === 'coffre') forme = `<circle cx="${o.x}" cy="${o.y}" r="${r}" fill="${c}" ${contour}/>`;
  else forme = `<rect x="${o.x - r * 0.82}" y="${o.y - r * 0.82}" width="${f1(r * 1.64)}" height="${f1(r * 1.64)}" rx="3" transform="rotate(45 ${o.x} ${o.y})" fill="${c}" ${contour}/>`;
  return `<circle cx="${o.x}" cy="${o.y + 2.5}" r="${r + 1}" fill="#000000" fill-opacity="0.3"/>${forme}${texte}${o.etiquette ? texteHalo(o.x, o.y + r + 20, o.etiquette, T.typo.m, T.encre, ' text-anchor="middle"') : ''}`;
}

/** Tirets d'un tracé selon son usage (déplacement plein, rotation en tirets, regard en pointillés). */
function tiretsTrace(o) {
  const usage = o.usage ?? (o.tirets ? 'rotation' : 'deplacement');
  if (usage === 'rotation') return ` stroke-dasharray="${f1(o.epaisseur * 2.8)} ${f1(o.epaisseur * 2)}"`;
  if (usage === 'regard') return ` stroke-dasharray="${f1(o.epaisseur * 0.4)} ${f1(o.epaisseur * 1.9)}"`;
  return '';
}

function objetSvg(o, k, doc) {
  const id = String(o.id).replace(/[^A-Za-z0-9_-]/g, '');
  switch (o.type) {
    case 'agent': {
      const r = T.pion.rayon;
      const joueur = typeof o.joueur === 'number' ? doc.joueurs?.[o.joueur] : undefined;
      const regard = typeof o.angle === 'number' ? secteur(o.x, o.y, o.angle, T.pion.ouvertureRegard, T.pion.regard, `fill="${o.couleur}" fill-opacity="0.45"`) : '';
      return regard + jeton(id, o.x, o.y, r, o.couleur, o.nom, o.icone, { inconnu: o.agent === 'inconnu' }) + (joueur?.nom ? pastille(o.x, o.y + r + T.pion.anneau + 4, joueur.nom) : '');
    }
    case 'capacite': {
      const style = genreCapacite(o);
      const r = T.capacite.puceRayon;
      const puce = [
        `<circle cx="${o.x}" cy="${o.y + 2}" r="${r + 2.5}" fill="#000000" fill-opacity="0.35"/>`,
        `<circle cx="${o.x}" cy="${o.y}" r="${r + 2}" fill="${T.puce}" stroke="${o.couleur}" stroke-width="${style.ultime ? 3 : 2.2}"/>`,
        jetonIcone(id, o.x, o.y, r - 1.5, o.nom, o.icone),
        typeof o.ordre === 'number' ? `<circle cx="${o.x + r + 1}" cy="${o.y - r - 1}" r="8.5" fill="${o.couleur}" stroke="${T.halo}" stroke-width="1.5"/><text x="${o.x + r + 1}" y="${f1(o.y - r + 3.2)}" text-anchor="middle" font-size="${T.typo.xs}" font-family="${POLICE}" font-weight="700" fill="${T.halo}">${o.ordre}</text>` : '',
        style.ultime ? `<circle cx="${o.x + r + 1}" cy="${o.y + r + 1}" r="7.5" fill="${T.puce}" stroke="#ffffff" stroke-width="1.2"/><text x="${o.x + r + 1}" y="${f1(o.y + r + 4.6)}" text-anchor="middle" font-size="10" font-family="${POLICE}" font-weight="700" fill="#ffffff">X</text>` : '',
      ].join('');
      return (o.zone ? zoneSvg(o, o.zone, k, style) : '') + puce;
    }
    case 'vision':
      return secteur(o.x, o.y, o.angle, o.ouverture, o.portee * k, `fill="${o.couleur}" fill-opacity="0.14" stroke="${o.couleur}" stroke-width="${T.trait.fin}" stroke-dasharray="6 5"`);
    case 'marqueur':
      return marqueurSvg(o);
    case 'fleche':
    case 'ligne': {
      const pts = [];
      for (let i = 0; i < o.points.length; i += 2) pts.push(`${o.points[i]},${o.points[i + 1]}`);
      return `<polyline points="${pts.join(' ')}" fill="none" stroke="${o.couleur}" stroke-width="${o.epaisseur}" stroke-linecap="round" stroke-linejoin="round"${tiretsTrace(o)}${o.type === 'fleche' ? ` marker-end="url(#pointe-${o.couleur.slice(1)})"` : ''}/>`;
    }
    case 'forme':
      return o.forme === 'rect'
        ? `<rect x="${o.x}" y="${o.y}" width="${o.l}" height="${o.h}" rx="3" fill="${o.remplie ? o.couleur : 'none'}" fill-opacity="0.22" stroke="${o.couleur}" stroke-width="${T.trait.normal}"/>`
        : `<ellipse cx="${o.x + o.l / 2}" cy="${o.y + o.h / 2}" rx="${o.l / 2}" ry="${o.h / 2}" fill="${o.remplie ? o.couleur : 'none'}" fill-opacity="0.22" stroke="${o.couleur}" stroke-width="${T.trait.normal}"/>`;
    case 'texte':
      return texteHalo(o.x, o.y + o.taille, o.texte, o.taille, o.couleur);
    default:
      return '';
  }
}

/** Icône d'une capacité dans sa puce sombre : initiales, puis l'image découpée en rond par-dessus. */
function jetonIcone(id, x, y, rayon, nom, icone) {
  const img = imageDistante(icone);
  return [
    `<text x="${x}" y="${f1(y + rayon * 0.34)}" text-anchor="middle" font-size="${f1(rayon * 0.86)}" font-family="${POLICE}" font-weight="700" fill="#ffffff">${echapper(initiales(nom))}</text>`,
    img ? `<clipPath id="rond-${id}"><circle cx="${x}" cy="${y}" r="${f1(rayon)}"/></clipPath><circle cx="${x}" cy="${y}" r="${f1(rayon)}" fill="${T.puce}" clip-path="url(#rond-${id})"/><image href="${echapper(img)}" x="${f1(x - rayon)}" y="${f1(y - rayon)}" width="${f1(rayon * 2)}" height="${f1(rayon * 2)}" clip-path="url(#rond-${id})"/>` : '',
  ].join('');
}

/**
 * Filtre « plateau » : la minimap (formes claires sur fond transparent) devient un sol sombre teinté, cerné d'un
 * liseré clair, avec un peu du relief d'origine. Primitives SVG courantes (Chromium, Safari, Firefox).
 */
const FILTRE_PLATEAU = [
  '<filter id="plateau" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">',
  '<feMorphology in="SourceAlpha" operator="dilate" radius="1.6" result="gras"/>',
  `<feFlood flood-color="${THEME.contour}"/><feComposite in2="gras" operator="in" result="lisere"/>`,
  `<feFlood flood-color="${THEME.sol}"/><feComposite in2="SourceAlpha" operator="in" result="sol"/>`,
  `<feComponentTransfer in="SourceGraphic" result="relief"><feFuncA type="linear" slope="${THEME.detail}"/></feComponentTransfer>`,
  '<feMerge><feMergeNode in="lisere"/><feMergeNode in="sol"/><feMergeNode in="relief"/></feMerge>',
  '</filter>',
].join('');

/** SVG d'une étape (calques masqués exclus), sur un carré de 1000. */
export function svgEtape(doc, index = 0) {
  const etape = doc.etapes[index];
  if (!etape) return '';
  const couleurs = new Set(etape.objets.filter(o => o.type === 'fleche').map(o => o.couleur));
  const pointes = [...couleurs]
    .map(c => `<marker id="pointe-${c.slice(1)}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${c}"/></marker>`)
    .join('');
  const fond = imageDistante(doc.carte.image);
  const visibles = etape.objets.filter(o => doc.calques?.[calqueDe(o)]?.visible !== false);
  const ordre = ['vision', 'utilitaires', 'marqueurs', 'dessins', 'texte'];
  const k = echelleEffective(doc.carte.echelle);
  // Zones, marqueurs et tracés d'abord ; les pions par-dessus (jamais cachés par une fumée ni par leur flèche), puis les textes.
  const rang = o => (o.type === 'agent' ? ordre.indexOf('dessins') + 0.5 : ordre.indexOf(calqueDe(o)));
  visibles.sort((a, b) => rang(a) - rang(b));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" role="img" aria-label="${echapper(`${doc.carte.nom}, ${etape.titre}`)}">`,
    `<defs>${pointes}${fond ? FILTRE_PLATEAU : ''}<radialGradient id="vignette" cx="50%" cy="50%" r="72%"><stop offset="0.55" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="${THEME.vignette}"/></radialGradient></defs>`,
    `<rect width="1000" height="1000" fill="${THEME.fond}"/>`,
    `<text x="500" y="520" text-anchor="middle" font-size="64" font-family="${POLICE}" font-weight="700" fill="${THEME.sol}">${echapper(doc.carte.nom)}</text>`,
    fond && doc.calques?.fond?.visible !== false ? `<image href="${echapper(fond)}" x="0" y="0" width="1000" height="1000" filter="url(#plateau)"/>` : '',
    '<rect width="1000" height="1000" fill="url(#vignette)"/>',
    visibles.map(o => objetSvg(o, k, doc)).join(''),
    '</svg>',
  ].join('');
}

const LIBELLES_SIDE = { attaque: 'Attaque', defense: 'Défense' };

/** Page HTML autonome d'une strat partagée (toutes les étapes, notes, mention Riot). */
export function pageStrat({ titre, type, notes, doc, libelleType }) {
  const etapes = doc.etapes
    .map(
      (e, i) => `<section><h2>${i + 1}. ${echapper(e.titre)}</h2><div class="carte">${svgEtape(doc, i)}</div>${e.note ? `<p class="note">${echapper(e.note).replace(/\n/g, '<br>')}</p>` : ''}</section>`,
    )
    .join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${echapper(titre)} · Strat</title><style>
:root{color-scheme:light dark;--fond:#f8fafc;--texte:#0f172a;--attenue:#475569;--ligne:#e2e8f0}
@media (prefers-color-scheme:dark){:root{--fond:#0b0f17;--texte:#e5e7eb;--attenue:#94a3b8;--ligne:#1f2937}}
body{margin:0;background:var(--fond);color:var(--texte);font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:860px;margin:0 auto;padding:16px}h1{font-size:24px;margin:8px 0}h2{font-size:18px}
.meta,.mention,.note{color:var(--attenue)}.carte{border:1px solid var(--ligne);border-radius:10px;overflow:hidden}
svg{display:block;width:100%;height:auto}.mention{font-size:12px;border-top:1px solid var(--ligne);padding-top:12px;margin-top:24px}
</style></head><body><main><h1>${echapper(titre)}</h1><p class="meta">${echapper(doc.carte.nom)}${doc.modele === 'thefinals' ? '' : ` · ${LIBELLES_SIDE[doc.side] ?? ''}`} · ${echapper(libelleType)} · lecture seule</p>${notes ? `<p>${echapper(notes).replace(/\n/g, '<br>')}</p>` : ''}${etapes}${doc.modele === 'valorant' || doc.jeu === 'valorant' ? `<p class="mention">${echapper(MENTION_RIOT)}</p>` : ''}</main></body></html>`;
}

/** En-têtes de la page publique : aucune ressource hors des images Riot (CDN valorant-api.com). */
export const CSP_PAGE_STRAT = "default-src 'none'; img-src https://media.valorant-api.com data:; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
