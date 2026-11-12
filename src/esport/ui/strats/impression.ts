/**
 * Document imprimable d'une strat (export PDF par l'impression du navigateur) : en-tête (map, side,
 * économie, modèle), joueurs et leurs agents ou classes, puis chaque étape (image, phase, durée, ordre des
 * utilitaires, note). Pur : rend une page HTML autonome, tout texte échappé, images en data URL.
 */

import type { Strat } from '../../strats/api';
import type { AgentAsset } from '../../strats/assets';
import { ordreUtilitaires, type DocumentStrat } from '../../strats/document';
import { MODELES } from '../../strats/modeles';
import { LIBELLES_SIDE } from '../../strats/libelles';
import { trSt, type CleSt } from '../../i18n/strats2';

export const echapper = (t: string): string => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

export function documentImpression({ strat, doc, images, agents }: { strat: Strat; doc: DocumentStrat; images: string[]; agents: AgentAsset[] }): string {
  const def = MODELES[doc.modele];
  const nomAgent = (cle: string | null) => (cle ? (agents.find(a => a.cle === cle)?.nom ?? cle) : '');
  const meta = [doc.carte.nom, def.sides ? LIBELLES_SIDE[doc.side] : '', doc.economie ? trSt(`economie.${doc.economie}` as CleSt) : '', trSt(`modele.${doc.modele}` as CleSt)].filter(Boolean).join(' · ');
  const joueurs = doc.joueurs
    .map((j, i) => `<li><span class="pastille" style="background:${/^#[0-9a-f]{6}$/i.test(j.couleur) ? j.couleur : '#888888'}"></span>${i + 1}. ${echapper(j.nom)}${j.agent ? ` : ${echapper(nomAgent(j.agent))}` : ''}${j.role ? ` (${echapper(j.role)})` : ''}</li>`)
    .join('');
  const etapes = doc.etapes
    .map((e, i) => {
      const utilitaires = ordreUtilitaires(e)
        .map(c => `<li>${c.ordre ?? '–'}. ${echapper(c.nom)}${c.joueur !== null && doc.joueurs[c.joueur] ? ` (${echapper(doc.joueurs[c.joueur].nom)})` : ''}${typeof c.t === 'number' ? ` · ${c.t} s` : ''}</li>`)
        .join('');
      const phase = e.phase ? `${echapper(trSt(`phase.${e.phase}` as CleSt))} · ` : '';
      return `<section><h2>${i + 1}. ${echapper(e.titre)}</h2><p class="meta">${phase}${echapper(trSt('etape.secondes', { s: e.duree ?? 5 }))}</p>${images[i] && /^data:image\/png;base64,/.test(images[i]) ? `<img src="${images[i]}" alt="">` : ''}${utilitaires ? `<h3>${echapper(trSt('utilitaires.titre'))}</h3><ol class="liste">${utilitaires}</ol>` : ''}${e.note ? `<p class="note">${echapper(e.note).replace(/\n/g, '<br>')}</p>` : ''}</section>`;
    })
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${echapper(strat.titre)}</title><style>
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#111827;margin:24px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:0 0 4px}h3{font-size:14px;margin:8px 0 4px}
.meta{color:#475569;margin:0 0 8px}.note{white-space:normal;color:#1f2937}
section{page-break-inside:avoid;break-inside:avoid;margin:18px 0;border-top:1px solid #e2e8f0;padding-top:12px}
img{width:100%;max-width:640px;border-radius:8px;border:1px solid #e2e8f0}
ul,ol.liste{list-style:none;padding:0;margin:0}.pastille{display:inline-block;width:10px;height:10px;border-radius:5px;margin-right:6px}
</style></head><body><h1>${echapper(strat.titre)}</h1><p class="meta">${echapper(meta)}</p>${strat.notes ? `<p>${echapper(strat.notes).replace(/\n/g, '<br>')}</p>` : ''}<h3>${echapper(trSt('joueurs.titre', { n: doc.joueurs.length }))}</h3><ul>${joueurs}</ul>${etapes}</body></html>`;
}
