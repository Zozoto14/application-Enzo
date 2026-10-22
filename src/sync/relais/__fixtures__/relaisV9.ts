/**
 * Le VRAI relais (relais/relais.mjs, version 9) en mémoire, pour les tests : boîte et coffre
 * serveur en mémoire, `fetch` simulé. `horsLigne` coupe le réseau (l'appel lève, comme un vrai
 * `fetch` sans connexion). `appels` garde méthode et chemin de chaque requête.
 */

/* eslint-disable @typescript-eslint/no-var-requires */
const worker = { fetch: (require('../../../../relais/relais.mjs') as { traiterRequete(r: Request, env: unknown): Promise<Response> }).traiterRequete };
const { coffresMemoire } = require('../../../../relais/coffres.mjs') as { coffresMemoire(): unknown };
const { jetonDeProfil } = require('../../../../relais/relais.mjs') as { jetonDeProfil(j: string, id: string): Promise<string> };

export const RELAIS_V9 = 'https://relais.appdashboard.test';
export const JETON_V9 = 'jeton-maitre-v9-0123456789abcdef';

export interface RelaisV9 {
  requete: typeof fetch;
  env: { JETON: string; BOITE: { donnees: Map<string, string> } & Record<string, unknown>; COFFRES?: unknown };
  appels: Array<{ methode: string; chemin: string; statut: number }>;
  horsLigne: boolean;
  /** Adresse IP vue par le relais. */
  ip: string;
  jetonAmi(id: string): Promise<string>;
}

export function relaisV9({ avecCoffre = true }: { avecCoffre?: boolean } = {}): RelaisV9 {
  const donnees = new Map<string, string>();
  const metas = new Map<string, unknown>();
  const BOITE = {
    donnees,
    get: async (c: string) => (donnees.has(c) ? donnees.get(c)! : null),
    put: async (c: string, v: string, o?: { metadata?: unknown }) => {
      donnees.set(c, v);
      if (o?.metadata) metas.set(c, o.metadata);
      else metas.delete(c);
    },
    delete: async (c: string) => {
      donnees.delete(c);
      metas.delete(c);
    },
    list: async ({ prefix = '' }: { prefix?: string } = {}) => ({
      keys: [...donnees.keys()].filter(c => c.startsWith(prefix)).sort().map(name => ({ name, metadata: metas.get(name) })),
      list_complete: true,
    }),
  };
  const r: RelaisV9 = {
    env: { JETON: JETON_V9, BOITE, ...(avecCoffre ? { COFFRES: coffresMemoire() } : {}) },
    appels: [],
    horsLigne: false,
    ip: '198.51.100.20',
    jetonAmi: id => jetonDeProfil(JETON_V9, id),
    requete: (async (url: string | URL | Request, init: RequestInit = {}) => {
      if (r.horsLigne) throw new TypeError('Failed to fetch');
      const adresse = String(url);
      const entetes = new Headers((init.headers as Record<string, string>) ?? {});
      entetes.set('X-Adresse-Client', r.ip);
      const requete = new Request(adresse, { method: init.method ?? 'GET', headers: entetes, body: init.body as string | undefined });
      const reponse = await worker.fetch(requete, r.env);
      r.appels.push({ methode: init.method ?? 'GET', chemin: new URL(adresse).pathname, statut: reponse.status });
      return reponse;
    }) as unknown as typeof fetch,
  };
  return r;
}
