/**
 * `Reseau` de l'iPhone/iPad (React Native) : `fetch` natif, sans CORS.
 *
 * Limite : le `fetch` de React Native suit lui-même les redirections
 * (`redirect: 'manual'` n'y est pas honoré). On ne voit donc pas chaque saut ;
 * on re-vérifie APRÈS COUP l'adresse finale (`Response.url`) avec la garde du
 * moteur, et on jette la réponse si elle vient d'une adresse non publique. Un
 * saut intermédiaire vers le réseau local n'est donc pas empêché mais son
 * contenu n'est jamais rendu. Aucun cookie n'est envoyé (`credentials: 'omit'`).
 */

import { echec } from '../moteur/erreurs';
import { urlPubliqueSure } from '../moteur/garde';
import { reseauDepuisFetch, type FonctionFetch, type ReponseReseau, type Reseau } from '../moteur/reseau';

interface ReponseAvecUrl {
  url?: string;
}

export function reseauNatif(fetchFn?: FonctionFetch): Reseau {
  const brut = fetchFn ?? ((globalThis as { fetch?: unknown }).fetch as FonctionFetch | undefined);
  if (!brut) {
    return {
      requete: async () => {
        throw echec('Réseau indisponible', 'reseau', 502);
      },
    };
  }
  let dernier: string | undefined;
  const interne = reseauDepuisFetch(async (url, init) => {
    const rep = await brut(url, init);
    dernier = (rep as unknown as ReponseAvecUrl).url || undefined;
    return rep;
  });
  return {
    async requete(r): Promise<ReponseReseau> {
      dernier = undefined;
      const rep = await interne.requete(r);
      if (dernier && dernier !== r.url && urlPubliqueSure(dernier) === null) {
        throw echec('Redirection vers une adresse non publique refusée', 'garde', 502);
      }
      return rep;
    },
  };
}
