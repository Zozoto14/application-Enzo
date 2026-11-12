/** Aides des tests des strats : un document d'exemple, une petite image JPEG. */
import { documentVide } from '../noyau/strats/document.mjs';

export const ASCENT = { cle: 'ascent', nom: 'Ascent', image: 'https://media.valorant-api.com/maps/7eaecc1b/displayicon.png' };

export function docExemple() {
  const d = documentVide({ carte: ASCENT, side: 'attaque' });
  d.etapes[0].objets.push(
    { id: 'a1', type: 'agent', x: 400, y: 600, agent: 'omen', nom: 'Omen', icone: 'https://media.valorant-api.com/agents/8e253930/displayicon.png', joueur: 1, couleur: '#3b82f6' },
    { id: 'c1', type: 'capacite', x: 520, y: 380, agent: 'omen', capacite: 'Ability2', nom: 'Dark Cover', icone: null, joueur: 1, couleur: '#3b82f6', zone: { forme: 'cercle', rayon: 4.1 } },
    { id: 'f1', type: 'fleche', points: [400, 600, 450, 500, 520, 420], couleur: '#EF4444', epaisseur: 5 },
    { id: 't1', type: 'texte', x: 100, y: 100, texte: 'Exécution A', couleur: '#ffffff', taille: 28 },
  );
  return d;
}


/** Une « image » JPEG minimale (octets magiques corrects) en data URL. */
export function jpegDataUrl(taille = 64) {
  const octets = new Uint8Array(taille);
  octets.set([0xff, 0xd8, 0xff, 0xe0]);
  return `data:image/jpeg;base64,${Buffer.from(octets).toString('base64')}`;
}
