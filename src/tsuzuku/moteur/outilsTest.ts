/** Aides de test : faux reseau deterministe, aucune requete reelle. */
import type { ReponseReseau, RequeteReseau, Reseau } from './reseau';

export type Reponse = Partial<ReponseReseau> | ((r: RequeteReseau) => Partial<ReponseReseau> | Promise<Partial<ReponseReseau>>);

export interface FauxReseau extends Reseau {
  appels: RequeteReseau[];
  urls(): string[];
}

/**
 * `routes` : adresse exacte (ou sous-chaine) -> reponse. Une adresse sans
 * route repond 404 : un test ne touche jamais autre chose que ses fixtures.
 */
export function fauxReseau(routes: Record<string, Reponse>, o: { resoudre?: (h: string) => Promise<string[]> } = {}): FauxReseau {
  const appels: RequeteReseau[] = [];
  return {
    appels,
    urls: () => appels.map(a => a.url),
    resoudre: o.resoudre,
    async requete(r) {
      appels.push(r);
      const cle = Object.keys(routes).find(k => r.url === k) ?? Object.keys(routes).find(k => r.url.includes(k));
      if (!cle) {
        return { statut: 404, entetes: {}, corps: '' };
      }
      const rep = routes[cle];
      const v = typeof rep === 'function' ? await rep(r) : rep;
      return { statut: v.statut ?? 200, entetes: v.entetes ?? {}, corps: v.corps ?? '' };
    },
  };
}

export const html = (corps: string) => ({ statut: 200, entetes: { 'content-type': 'text/html' }, corps: `<!doctype html><html><body>${corps}</body></html>` });
export const json = (o: unknown, statut = 200) => ({ statut, entetes: { 'content-type': 'application/json' }, corps: JSON.stringify(o) });
export const attenteNulle = async () => {};
