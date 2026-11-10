/**
 * Connexions Esport refusées « au hasard » (docs/diagnostic-comptes.md) : au chargement d'une page,
 * chaque requête lancée en parallèle ouvrait SA session (rafale de POST /session : limite de débit
 * par adresse atteinte pour tout le Wi-Fi du club, « Trop de demandes »). Une seule ouverture à la
 * fois, partagée ; idem quand la session expire ; échéance relative (horloge de l'appareil décalée).
 */
import { clientEsport, oublierSessions } from './client';

type Appel = { url: string; method?: string; headers?: Record<string, string> };
function serveur(reponses: (a: Appel) => { status: number; corps?: unknown }, delai = 5) {
  const appels: Appel[] = [];
  const requete = async (url: string, init: Omit<Appel, 'url'> = {}) => {
    const a = { url, ...init };
    appels.push(a);
    await new Promise<void>(r => setTimeout(r, delai));
    const r = reponses(a);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.corps };
  };
  return { appels, requete };
}
const config = { adresse: 'https://esport.test', jetonRelais: 'p1.lea12345.' + 'a'.repeat(64) };

describe('sessions Esport concurrentes', () => {
  beforeEach(() => oublierSessions());

  it('20 requêtes lancées ensemble : UNE seule ouverture de session', async () => {
    const s = serveur(a => (a.url.endsWith('/session') ? { status: 200, corps: { session: 'es1.x.y', expire: new Date(Date.now() + 3600_000).toISOString(), heure: Date.now() } } : { status: 200, corps: { teams: [] } }));
    const c = clientEsport(config, s.requete as never);
    await Promise.all(Array.from({ length: 20 }, () => c.teams()));
    expect(s.appels.filter(a => a.url.endsWith('/session'))).toHaveLength(1);
    expect(s.appels.filter(a => a.url.endsWith('/teams'))).toHaveLength(20);
  });

  it('session expirée (serveur redémarré) pendant 10 requêtes : une seule nouvelle session, chacune rejouée une fois', async () => {
    let n = 0;
    const s = serveur(a => {
      if (a.url.endsWith('/session')) return { status: 200, corps: { session: `es1.${++n}.y`, expire: new Date(Date.now() + 3600_000).toISOString(), heure: Date.now() } };
      return a.headers?.Authorization === 'Bearer es1.1.y' ? { status: 401, corps: { erreur: 'Session', code: 'session' } } : { status: 200, corps: { teams: [] } };
    });
    const c = clientEsport(config, s.requete as never);
    await c.teams().catch(() => undefined);
    await Promise.all(Array.from({ length: 10 }, () => c.teams()));
    expect(n).toBe(2);
  });

  it('horloge de l’appareil en retard d’une heure : la session reçue n’est pas crue expirée (pas de réouverture à chaque requête)', async () => {
    const decalage = -3600_000 * 2;
    const s = serveur(a => (a.url.endsWith('/session') ? { status: 200, corps: { session: 'es1.x.y', expire: new Date(Date.now() + 3600_000).toISOString(), heure: Date.now() } } : { status: 200, corps: { teams: [] } }));
    // Appareil en AVANCE de deux heures : sans échéance relative, la session paraît déjà expirée.
    const c = clientEsport(config, s.requete as never, () => Date.now() - decalage);
    await c.teams();
    await c.teams();
    await c.teams();
    expect(s.appels.filter(a => a.url.endsWith('/session'))).toHaveLength(1);
  });

  it('un échec d’ouverture n’est pas gardé : la requête suivante réessaie', async () => {
    let echec = true;
    const s = serveur(a => {
      if (a.url.endsWith('/session')) return echec ? { status: 429, corps: { erreur: 'Trop', code: 'trop-de-requetes' } } : { status: 200, corps: { session: 'es1.x.y', expire: new Date(Date.now() + 3600_000).toISOString(), heure: Date.now() } };
      return { status: 200, corps: { teams: [] } };
    });
    const c = clientEsport(config, s.requete as never);
    await expect(c.teams()).rejects.toMatchObject({ code: 'trop-de-requetes' });
    echec = false;
    await expect(c.teams()).resolves.toEqual([]);
  });
});
