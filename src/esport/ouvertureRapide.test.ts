/**
 * Ouverture de l'Esport plus rapide (docs/performance.md) : le profil joint à POST /session est repris (pas de
 * GET /moi juste après), une seule fois et s'il a moins de 30 s ; le préchauffage du hub ouvre la session à l'avance.
 */
import { clientEsport, FRAICHEUR_MOI_MS, oublierSessions } from './client';

type Appel = { url: string; method?: string };
const MOI = { compte: 'lea12345', superAdmin: false, profil: { pseudo: 'Léa' }, peutCreerTeam: false };
function serveur() {
  const appels: Appel[] = [];
  const requete = async (url: string, init: Omit<Appel, 'url'> = {}) => {
    appels.push({ url, ...init });
    const corps = url.endsWith('/session') ? { session: 'es1.x.y', expire: new Date(Date.now() + 3600_000).toISOString(), heure: Date.now(), fonctions: [], ...MOI } : { ...MOI, profil: { pseudo: 'Léa (relu)' } };
    return { ok: true, status: 200, json: async () => corps };
  };
  return { appels, requete };
}
const config = { adresse: 'https://esport.test', jetonRelais: 'p1.lea12345.' + 'a'.repeat(64) };
const chemins = (s: { appels: Appel[] }) => s.appels.map(a => a.url.replace(config.adresse, ''));

beforeEach(() => oublierSessions());

it('session neuve : le profil reçu avec la session sert, sans GET /moi (un aller-retour de moins)', async () => {
  const s = serveur();
  const moi = await clientEsport(config, s.requete as never).ouvrir();
  expect(chemins(s)).toEqual(['/session']);
  expect(moi).toEqual(MOI);
  expect(moi).not.toHaveProperty('session');
  expect(moi).not.toHaveProperty('fonctions');
});

it('profil repris une seule fois : la réouverture relit /moi', async () => {
  const s = serveur();
  const c = clientEsport(config, s.requete as never);
  await c.ouvrir();
  const relu = await c.ouvrir();
  expect(chemins(s)).toEqual(['/session', '/moi']);
  expect(relu.profil?.pseudo).toBe('Léa (relu)');
});

it('session préchauffée par le hub il y a plus de 30 s : la session sert, le profil est relu', async () => {
  const s = serveur();
  let t = 1_000_000;
  const c = clientEsport(config, s.requete as never, () => t);
  await c.jetonSession!();
  t += FRAICHEUR_MOI_MS + 1;
  const moi = await c.ouvrir();
  expect(chemins(s)).toEqual(['/session', '/moi']);
  expect(moi.profil?.pseudo).toBe('Léa (relu)');
});
