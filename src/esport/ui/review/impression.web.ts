/**
 * Impression des notes en PDF, sur le site et dans l'app PC : le document est
 * posé dans la page elle-même (#impression-esport), visible uniquement à
 * l'impression, puis `window.print()` ouvre la boîte d'impression du système
 * (« Enregistrer au format PDF »). Ni fenêtre ni cadre : l'app PC bloque les
 * deux. Le HTML vient de `documentImpression` (texte échappé).
 */

import { STYLE_IMPRESSION, documentImpression } from '../../review/impression';

export const impressionDisponible = true;

type Fenetre = { document?: Document; print?: () => void; addEventListener?: Window['addEventListener']; removeEventListener?: Window['removeEventListener'] };

export async function imprimerNotes(titre: string, markdown: string): Promise<boolean> {
  const g = globalThis as Fenetre;
  const doc = g.document;
  if (!doc || typeof g.print !== 'function') return false;
  doc.getElementById('impression-esport')?.remove();
  doc.getElementById('impression-esport-style')?.remove();
  const style = doc.createElement('style');
  style.id = 'impression-esport-style';
  style.textContent = STYLE_IMPRESSION;
  const zone = doc.createElement('div');
  zone.id = 'impression-esport';
  zone.innerHTML = documentImpression(titre, markdown);
  doc.head.appendChild(style);
  doc.body.appendChild(zone);
  const nettoyer = () => {
    zone.remove();
    style.remove();
    g.removeEventListener?.('afterprint', nettoyer);
  };
  g.addEventListener?.('afterprint', nettoyer);
  // Laisse au navigateur le temps de poser le document avant d'ouvrir la boîte d'impression.
  await new Promise(r => setTimeout(r, 50));
  g.print();
  return true;
}
