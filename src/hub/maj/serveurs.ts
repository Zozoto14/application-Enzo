/**
 * Version EN SERVICE du relais (GET /serveur/version, Fondateur) : commit chargé au démarrage, heure de démarrage,
 * pid, durée, et dernier commit déployé par deployer.sh. Un écart veut dire que le relais n'a pas redémarré après
 * le déploiement (page « Mises à jour », docs/mises-a-jour.md et docs/o2switch.md, « Dépannage »).
 */

import { appel, libelleProblemeRelais, type ProblemeRelais } from '../../messagerie/courriel';

export interface VersionServeur {
  app: string;
  commit: string | null;
  commitCourt?: string | null;
  demarreLe: string;
  pid: number;
  node: string;
  dureeS: number;
  codeDeploye: string | null;
  /** false : un autre commit a été déployé depuis le démarrage (redémarrage manquant) ; null : inconnu. */
  aJour: boolean | null;
}

export interface EtatVersionRelais {
  version?: VersionServeur;
  /** `ancien-relais` : la route n'existe pas, le relais tourne une version d'avant ce suivi (pas redémarré). */
  probleme?: ProblemeRelais;
  message?: string;
}

export async function versionRelais(): Promise<EtatVersionRelais> {
  const r = await appel<Partial<VersionServeur> & { motif?: string }>('/serveur/version');
  if (r.probleme) return { probleme: r.probleme, message: libelleProblemeRelais(r.probleme, r.statut) };
  if (r.statut === 404) return { probleme: 'ancien-relais', message: libelleProblemeRelais('ancien-relais') };
  const c = r.corps;
  if (r.statut !== 200 || !c || typeof c.demarreLe !== 'string') return { probleme: 'reponse', message: libelleProblemeRelais('reponse', r.statut) };
  return {
    version: {
      app: String(c.app ?? 'relais'),
      commit: typeof c.commit === 'string' ? c.commit : null,
      commitCourt: typeof c.commitCourt === 'string' ? c.commitCourt : null,
      demarreLe: c.demarreLe,
      pid: Number(c.pid ?? 0),
      node: String(c.node ?? ''),
      dureeS: Number(c.dureeS ?? 0),
      codeDeploye: typeof c.codeDeploye === 'string' ? c.codeDeploye : null,
      aJour: typeof c.aJour === 'boolean' ? c.aJour : null,
    },
  };
}
