/**
 * Génération d'un visuel : document effectif (retouche du visuel, sinon le modèle du club, sinon le modèle
 * par défaut), rendu en image (site et PC : generateur.web.ts), envoi par morceaux dans la section CM puis
 * `POST /cm/visuels/:id/rendu` (le serveur vérifie la taille exacte et joint l'image à la carte post).
 * Données changées entre-temps (409 `donnees-changees`) : on relit le visuel et on refait le rendu une fois.
 */

import { ErreurEsport } from '../../client';
import { envoyerFichier, type FichierLocal } from '../../medias/envoi';
import { estRefDefaut, type ApiVisuels, type ModeleComplet, type Visuel } from './api';
import { rendreImage } from './generateur';
import { lireDocument } from './document';
import { modeleDefaut } from './modeles';
import type { Charte, DocumentVisuel, DonneesVisuel, Langue } from './types';

export interface OptionsRendu {
  api: ApiVisuels;
  document: DocumentVisuel;
  charte: Charte;
  donnees: DonneesVisuel;
  langue: Langue;
  type?: 'png' | 'jpeg';
}

/** Document à dessiner pour un visuel. `modele` : le modèle du club s'il en vient un. */
export function documentEffectif(v: Pick<Visuel, 'document' | 'modele' | 'type' | 'format'>, modele?: Pick<ModeleComplet, 'documents'> | null): DocumentVisuel {
  if (v.document) return lireDocument(v.document, v.format);
  if (!estRefDefaut(v.modele) && modele?.documents[v.format]) return lireDocument(modele.documents[v.format], v.format);
  return modeleDefaut(v.type, v.format);
}

/** Fichier local (envoi par morceaux) depuis un Blob rendu. */
export function fichierDepuisBlob(blob: Blob, nom: string): FichierLocal {
  return {
    nom,
    taille: blob.size,
    type: blob.type,
    // Unique à chaque rendu : deux rendus identiques ne reprennent pas le même envoi.
    derniereModif: Date.now() + Math.floor(Math.random() * 1000),
    // Blob du navigateur (le type de React Native ne déclare pas arrayBuffer).
    lire: async (debut, fin) => new Uint8Array(await (blob.slice(debut, fin) as unknown as { arrayBuffer(): Promise<ArrayBuffer> }).arrayBuffer()),
  };
}

/** Rend, envoie et rattache le rendu d'un visuel ; rend le visuel à jour (ou null si le rendu est impossible ici). */
export async function genererVisuel(api: ApiVisuels, visuel: Visuel, charte: Charte, modele?: Pick<ModeleComplet, 'documents'> | null, essai = 0): Promise<Visuel | null> {
  if (!visuel.donnees) throw new ErreurEsport('donnees', 409, 'donnees-indisponibles');
  const blob = await rendreImage({ api, document: documentEffectif(visuel, modele), charte, donnees: visuel.donnees, langue: visuel.langue });
  if (!blob) return null;
  const { etat, oublier } = await envoyerFichier({ client: api.client, teamId: visuel.portee, section: 'cm', fichier: fichierDepuisBlob(blob, `${visuel.type}-${visuel.format}-${visuel.langue}.png`) });
  try {
    const r = await api.rendu(visuel.id, etat.id, visuel.donnees.empreinte);
    oublier();
    return r.visuel;
  } catch (e) {
    oublier();
    if (e instanceof ErreurEsport && e.code === 'donnees-changees' && essai === 0) return genererVisuel(api, (await api.visuel(visuel.id)).visuel, charte, modele, 1);
    throw e;
  }
}
