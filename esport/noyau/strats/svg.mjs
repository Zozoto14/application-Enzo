/**
 * Rendu SVG d'une strat (page publique en lecture seule, `GET /partage/
 * strats/<jeton>`) : pur, sans dépendance. Le document est déjà validé
 * (document.mjs) : images limitées au CDN de valorant-api.com, textes
 * nettoyés ; tout texte est en plus échappé ici.
 *
 * Repli hors ligne : chaque agent est d'abord un disque de couleur avec ses
 * initiales, l'icône ne fait que s'y superposer (si elle ne charge pas, la
 * strat reste lisible). Les images relatives (`esport-assets/…`) ne sont pas
 * servies par le serveur Esport : elles sont ignorées ici.
 */

import { calqueDe } from './document.mjs';
import { echelleEffective } from './modeles.mjs';

export const MENTION_RIOT =
  'AppDashboard was created under Riot Games\' "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project.';

export function echapper(texte) {
  return String(texte ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const imageDistante = url => (typeof url === 'string' && url.startsWith('https://media.valorant-api.com/') ? url : null);
export const initiales = nom =>
  String(nom ?? '?')
    .split(/[\s/_-]+/)
    .filter(Boolean)
    .map(m => m[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';

function jeton(x, y, rayon, couleur, nom, icone) {
  const img = imageDistante(icone);
  return [
    `<circle cx="${x}" cy="${y}" r="${rayon}" fill="${couleur}" stroke="#ffffff" stroke-width="2"/>`,
    `<text x="${x}" y="${y + rayon * 0.35}" text-anchor="middle" font-size="${rayon}" font-family="sans-serif" font-weight="700" fill="#ffffff">${echapper(initiales(nom))}</text>`,
    img ? `<image href="${echapper(img)}" x="${x - rayon * 0.85}" y="${y - rayon * 0.85}" width="${rayon * 1.7}" height="${rayon * 1.7}"/>` : '',
  ].join('');
}

const rad = a => (a * Math.PI) / 180;
const f1 = n => Number(n).toFixed(1);

/** Secteur (cône de flash, de vision) : centre, angle et ouverture en degrés, portée en unités du repère. */
function secteur(x, y, angleDeg, ouverture, r, couleur, opacite = 0.3) {
  if (ouverture >= 359) return `<circle cx="${x}" cy="${y}" r="${f1(r)}" fill="${couleur}" fill-opacity="${opacite}" stroke="${couleur}" stroke-width="2"/>`;
  const a = rad(angleDeg - ouverture / 2);
  const b = rad(angleDeg + ouverture / 2);
  const p = ang => `${f1(x + r * Math.cos(ang))} ${f1(y + r * Math.sin(ang))}`;
  return `<path d="M ${x} ${y} L ${p(a)} A ${f1(r)} ${f1(r)} 0 ${ouverture > 180 ? 1 : 0} 1 ${p(b)} Z" fill="${couleur}" fill-opacity="${opacite}" stroke="${couleur}" stroke-width="2"/>`;
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

/** Forme d'une zone de capacité (mètres → unités avec l'échelle `k` de la map). */
export function zoneSvg(o, z, k) {
  const c = o.couleur;
  switch (z?.forme) {
    case 'cercle':
      return `<circle cx="${o.x}" cy="${o.y}" r="${f1(z.rayon * k)}" fill="${c}" fill-opacity="0.35" stroke="${c}" stroke-width="2"/>`;
    case 'cone':
      return secteur(o.x, o.y, z.angle, z.ouverture, z.portee * k, c);
    case 'mur':
    case 'ligne': {
      const l = z.longueur * k;
      const x2 = o.x + l * Math.cos(rad(z.angle));
      const y2 = o.y + l * Math.sin(rad(z.angle));
      const ep = z.forme === 'mur' ? Math.max(2, z.largeur * k) : 3;
      if (z.forme === 'mur' && (z.double || (Array.isArray(z.trace) && z.trace.length >= 2))) {
        // Mur tracé point par point (High Tide) et / ou double (Fast Lane) : polyligne(s).
        const pts = [o.x, o.y];
        if (Array.isArray(z.trace) && z.trace.length >= 2) for (let i = 0; i + 1 < z.trace.length; i += 2) pts.push(o.x + z.trace[i] * k, o.y + z.trace[i + 1] * k);
        else pts.push(x2, y2);
        const ligne = (q, e) => `<polyline points="${q.map(f1).join(' ')}" fill="none" stroke="${c}" stroke-width="${f1(e)}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.8"/>`;
        if (!z.double) return ligne(pts, ep);
        const d = Math.max(4, z.largeur * k) / 2;
        return ligne(decaler(pts, d), Math.max(2, 0.4 * k)) + ligne(decaler(pts, -d), Math.max(2, 0.4 * k));
      }
      if (z.forme === 'mur' && z.courbure) {
        const mx = (o.x + x2) / 2 - (l / 2) * z.courbure * Math.sin(rad(z.angle));
        const my = (o.y + y2) / 2 + (l / 2) * z.courbure * Math.cos(rad(z.angle));
        return `<path d="M ${o.x} ${o.y} Q ${f1(mx)} ${f1(my)} ${f1(x2)} ${f1(y2)}" fill="none" stroke="${c}" stroke-width="${f1(ep)}" stroke-linecap="round" stroke-opacity="0.8"/>`;
      }
      return `<line x1="${o.x}" y1="${o.y}" x2="${f1(x2)}" y2="${f1(y2)}" stroke="${c}" stroke-width="${f1(ep)}" stroke-linecap="round" stroke-opacity="0.8"${z.forme === 'ligne' ? ' stroke-dasharray="6 4"' : ''}/>`;
    }
    case 'rect': {
      const l = z.longueur * k;
      const h = z.largeur * k;
      return `<rect x="${o.x}" y="${f1(o.y - h / 2)}" width="${f1(l)}" height="${f1(h)}" transform="rotate(${z.angle} ${o.x} ${o.y})" fill="${c}" fill-opacity="0.3" stroke="${c}" stroke-width="2"/>`;
    }
    case 'trajet':
      return `<line x1="${f1(o.x + z.dx)}" y1="${f1(o.y + z.dy)}" x2="${o.x}" y2="${o.y}" stroke="${c}" stroke-width="2" stroke-dasharray="8 6"/>${z.rayon ? `<circle cx="${o.x}" cy="${o.y}" r="${f1(z.rayon * k)}" fill="${c}" fill-opacity="0.15" stroke="${c}" stroke-width="2" stroke-dasharray="4 4"/>` : ''}`;
    default:
      return '';
  }
}

function objetSvg(o, k) {
  switch (o.type) {
    case 'agent':
      return jeton(o.x, o.y, 22, o.couleur, o.nom, o.icone);
    case 'capacite':
      return zoneSvg(o, o.zone, k) + jeton(o.x, o.y, 14, o.couleur, o.nom, o.icone) + (o.ordre ? `<text x="${o.x + 14}" y="${o.y - 12}" font-size="16" font-family="sans-serif" font-weight="700" fill="#ffffff" stroke="#000000" stroke-width="0.6" paint-order="stroke">${o.ordre}</text>` : '');
    case 'vision':
      return secteur(o.x, o.y, o.angle, o.ouverture, o.portee * k, o.couleur, 0.15);
    case 'marqueur':
      return `<rect x="${o.x - 12}" y="${o.y - 12}" width="24" height="24" transform="rotate(45 ${o.x} ${o.y})" fill="${o.couleur}" stroke="#000000" stroke-width="2"/>${o.etiquette ? `<text x="${o.x}" y="${o.y + 34}" text-anchor="middle" font-size="18" font-family="sans-serif" font-weight="700" fill="#ffffff" stroke="#000000" stroke-width="0.6" paint-order="stroke">${echapper(o.etiquette)}</text>` : ''}`;
    case 'fleche':
    case 'ligne': {
      const pts = [];
      for (let i = 0; i < o.points.length; i += 2) pts.push(`${o.points[i]},${o.points[i + 1]}`);
      return `<polyline points="${pts.join(' ')}" fill="none" stroke="${o.couleur}" stroke-width="${o.epaisseur}" stroke-linecap="round" stroke-linejoin="round"${o.tirets ? ' stroke-dasharray="12 8"' : ''}${o.type === 'fleche' ? ` marker-end="url(#pointe-${o.couleur.slice(1)})"` : ''}/>`;
    }
    case 'forme':
      return o.forme === 'rect'
        ? `<rect x="${o.x}" y="${o.y}" width="${o.l}" height="${o.h}" fill="${o.remplie ? o.couleur : 'none'}" fill-opacity="0.3" stroke="${o.couleur}" stroke-width="3"/>`
        : `<ellipse cx="${o.x + o.l / 2}" cy="${o.y + o.h / 2}" rx="${o.l / 2}" ry="${o.h / 2}" fill="${o.remplie ? o.couleur : 'none'}" fill-opacity="0.3" stroke="${o.couleur}" stroke-width="3"/>`;
    case 'texte':
      return `<text x="${o.x}" y="${o.y + o.taille}" font-size="${o.taille}" font-family="sans-serif" font-weight="700" fill="${o.couleur}" stroke="#000000" stroke-width="0.6" paint-order="stroke">${echapper(o.texte)}</text>`;
    default:
      return '';
  }
}

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
  visibles.sort((a, b) => ordre.indexOf(calqueDe(a)) - ordre.indexOf(calqueDe(b)));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" role="img" aria-label="${echapper(`${doc.carte.nom}, ${etape.titre}`)}">`,
    `<defs>${pointes}</defs>`,
    '<rect width="1000" height="1000" fill="#1f2937"/>',
    `<text x="500" y="520" text-anchor="middle" font-size="64" font-family="sans-serif" fill="#374151">${echapper(doc.carte.nom)}</text>`,
    fond && doc.calques?.fond?.visible !== false ? `<image href="${echapper(fond)}" x="0" y="0" width="1000" height="1000"/>` : '',
    visibles.map(o => objetSvg(o, k)).join(''),
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
