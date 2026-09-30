/**
 * `Reseau` du PC (Electron) : la fenêtre ne touche pas au réseau, elle
 * demande au processus principal (IPC `tsuzuku:requete`, bureau/electron/tsuzuku.mjs)
 * qui refait la garde anti-SSRF, vérifie le DNS à la connexion, ne suit aucune
 * redirection (le moteur re-vérifie chaque saut), n'envoie aucun cookie et
 * borne délai et taille.
 */

import { echec } from '../moteur/erreurs';
import type { ReponseReseau, RequeteReseau, Reseau } from '../moteur/reseau';

/** Ce que le préchargement expose (`window.applibourse.tsuzuku`). */
export interface PontTsuzuku {
  requete(r: RequeteReseau): Promise<ReponseReseau>;
  /** Déclare le site d'un lecteur (iframe) : sans cela, le processus principal refuse de le charger. */
  lecteur?(url: string): Promise<boolean>;
}

export function pontElectron(source: unknown = globalThis): PontTsuzuku | undefined {
  const pont = (source as { applibourse?: { tsuzuku?: PontTsuzuku } }).applibourse?.tsuzuku;
  return pont && typeof pont.requete === 'function' ? pont : undefined;
}

export function reseauElectron(pont: PontTsuzuku): Reseau {
  return {
    async requete(r) {
      let rep: ReponseReseau;
      try {
        rep = await pont.requete(r);
      } catch (erreur) {
        // Le message d'Electron enveloppe l'erreur d'origine (« Error invoking remote method… »).
        const brut = erreur instanceof Error ? erreur.message : String(erreur);
        const message = brut.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
        throw echec(message, /publique|refus|Port|Adresse|hôte/i.test(message) ? 'garde' : 'reseau', 502);
      }
      if (!rep || typeof rep.statut !== 'number' || typeof rep.corps !== 'string') {
        throw echec('Réponse illisible du processus principal', 'reseau', 502);
      }
      return { statut: rep.statut, entetes: rep.entetes ?? {}, corps: rep.corps };
    },
  };
}
