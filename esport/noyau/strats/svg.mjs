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

function cone(o, z) {
  const a = ((z.angle - z.ouverture / 2) * Math.PI) / 180;
  const b = ((z.angle + z.ouverture / 2) * Math.PI) / 180;
  const p = (ang, r) => `${(o.x + r * Math.cos(ang)).toFixed(1)} ${(o.y + r * Math.sin(ang)).toFixed(1)}`;
  return `<path d="M ${o.x} ${o.y} L ${p(a, z.rayon)} A ${z.rayon} ${z.rayon} 0 ${z.ouverture > 180 ? 1 : 0} 1 ${p(b, z.rayon)} Z" fill="${o.couleur}" fill-opacity="0.3" stroke="${o.couleur}" stroke-width="2"/>`;
}

function objetSvg(o) {
  switch (o.type) {
    case 'agent':
      return jeton(o.x, o.y, 22, o.couleur, o.nom, o.icone);
    case 'capacite': {
      const z = o.zone;
      let forme = '';
      if (z?.forme === 'cercle') forme = `<circle cx="${o.x}" cy="${o.y}" r="${z.rayon}" fill="${o.couleur}" fill-opacity="0.35" stroke="${o.couleur}" stroke-width="2"/>`;
      else if (z?.forme === 'mur') forme = `<line x1="${o.x}" y1="${o.y}" x2="${o.x + z.dx}" y2="${o.y + z.dy}" stroke="${o.couleur}" stroke-width="${z.epaisseur}" stroke-linecap="round" stroke-opacity="0.8"/>`;
      else if (z?.forme === 'cone') forme = cone(o, z);
      return forme + jeton(o.x, o.y, 14, o.couleur, o.nom, o.icone);
    }
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
  const ordre = ['utilitaires', 'dessins', 'texte'];
  visibles.sort((a, b) => ordre.indexOf(calqueDe(a)) - ordre.indexOf(calqueDe(b)));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" role="img" aria-label="${echapper(`${doc.carte.nom}, ${etape.titre}`)}">`,
    `<defs>${pointes}</defs>`,
    '<rect width="1000" height="1000" fill="#1f2937"/>',
    `<text x="500" y="520" text-anchor="middle" font-size="64" font-family="sans-serif" fill="#374151">${echapper(doc.carte.nom)}</text>`,
    fond && doc.calques?.fond?.visible !== false ? `<image href="${echapper(fond)}" x="0" y="0" width="1000" height="1000"/>` : '',
    visibles.map(objetSvg).join(''),
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
</style></head><body><main><h1>${echapper(titre)}</h1><p class="meta">${echapper(doc.carte.nom)} · ${LIBELLES_SIDE[doc.side] ?? ''} · ${echapper(libelleType)} · lecture seule</p>${notes ? `<p>${echapper(notes).replace(/\n/g, '<br>')}</p>` : ''}${etapes}<p class="mention">${echapper(MENTION_RIOT)}</p></main></body></html>`;
}

/** En-têtes de la page publique : aucune ressource hors des images Riot (CDN valorant-api.com). */
export const CSP_PAGE_STRAT = "default-src 'none'; img-src https://media.valorant-api.com data:; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
