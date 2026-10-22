/**
 * Collecteur d'usage : lots (100 au plus, un envoi par intervalle, seulement s'il y a quelque chose),
 * durée des pages, envoi `keepalive` au départ, pas de rafale (un envoi à la fois, recul après échec),
 * arrêt quand le Fondateur coupe la collecte, erreurs JS dédoublonnées, actions clés et appareil.
 */

import { actionDAppel, appareilDe, creerCollecteur, type LotUsage } from './collecteur';

function banc(reponse: (lot: LotUsage, keepalive: boolean) => Promise<{ actif?: boolean } | undefined> = async () => ({ actif: true })) {
  const horloge = { t: 1_000_000 };
  let tic: (() => void) | undefined;
  const envois: Array<{ lot: LotUsage; keepalive: boolean }> = [];
  const intervalles: number[] = [];
  let arrete = false;
  const c = creerCollecteur({
    envoyer: (lot, { keepalive }) => {
      envois.push({ lot, keepalive });
      return reponse(lot, keepalive);
    },
    appareil: 'pc',
    langue: () => 'fr',
    maintenant: () => horloge.t,
    intervalleMs: 45_000,
    minuterie: {
      setInterval: (f, ms) => {
        tic = f;
        intervalles.push(ms);
        return 1;
      },
      clearInterval: () => {
        arrete = true;
      },
    },
    hasard: () => `session${envois.length}abcdef`,
  });
  const attendre = async (ms: number) => {
    horloge.t += ms;
    tic?.();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { c, horloge, envois, intervalles, attendre, estArrete: () => arrete };
}

test('lots : un envoi par intervalle de 45 s, rien quand il ne se passe rien, la durée de chaque page', async () => {
  const { c, envois, intervalles, attendre, horloge } = banc();
  expect(intervalles).toEqual([45_000]);
  c.page('esport.dashboard');
  horloge.t += 12_000;
  c.page('team.agenda.planning', 'team-1');
  horloge.t += 30_000;
  c.page('team.agenda.planning', 'team-1'); // même page : rien
  c.page('team.jeu.strats', 'team-1');
  expect(envois).toHaveLength(0); // rien ne part avant l'intervalle
  await attendre(45_000);
  expect(envois).toHaveLength(1);
  const { lot } = envois[0];
  expect(lot.appareil).toBe('pc');
  expect(lot.langue).toBe('fr');
  expect(lot.session).toMatch(/^session/);
  expect(lot.evenements.map(e => [e.g, e.a ?? e.p, e.d, e.t])).toEqual([
    ['action', 'connexion', undefined, undefined],
    ['page', 'esport.dashboard', 12_000, undefined],
    ['page', 'team.agenda.planning', 30_000, 'team-1'],
  ]);
  expect(lot.evenements[1].il).toBe(45_000 + 30_000);
  // Plus rien à envoyer : aucune requête aux tics suivants.
  await attendre(45_000);
  await attendre(45_000);
  expect(envois).toHaveLength(1);
});

test('sans rafale : 100 événements au plus par lot, un seul envoi en cours, recul après un échec', async () => {
  let reussir = false;
  let liberer: (() => void) | undefined;
  const { c, envois, attendre } = banc(
    () =>
      new Promise((ok, ko) => {
        if (reussir) liberer = () => ok({ actif: true });
        else ko(new Error('réseau'));
      }),
  );
  for (let i = 0; i < 250; i++) c.action('rsvp', 'team-1');
  await attendre(45_000);
  expect(envois).toHaveLength(1);
  expect(envois[0].lot.evenements).toHaveLength(100);
  // Échec : les événements restent ; deux intervalles sont sautés avant l'essai suivant.
  await attendre(45_000);
  expect(envois).toHaveLength(1);
  reussir = true;
  await attendre(45_000);
  expect(envois).toHaveLength(2);
  expect(envois[1].lot.evenements).toHaveLength(100);
  // Envoi en cours (pas de réponse) : le tic suivant n'en lance pas un second.
  await attendre(45_000);
  expect(envois).toHaveLength(2);
  liberer?.();
  await attendre(0);
  await attendre(45_000);
  expect(envois).toHaveLength(3);
  expect(c.etat.enAttente).toBe(251 - 200);
});

test('départ de la page : durée notée et lot envoyé avec keepalive, nouvelle session après 30 minutes', async () => {
  const { c, envois, horloge, attendre } = banc();
  c.page('team.equipe.goals_tasks', 'team-2');
  horloge.t += 20_000;
  c.masquer();
  await Promise.resolve();
  await Promise.resolve();
  expect(envois).toHaveLength(1);
  expect(envois[0].keepalive).toBe(true);
  expect(envois[0].lot.evenements.find(e => e.g === 'page')).toMatchObject({ p: 'team.equipe.goals_tasks', d: 20_000, t: 'team-2' });
  // Masqué : rien ne part au tic, et le temps en arrière-plan ne compte pas.
  horloge.t += 31 * 60_000;
  await attendre(45_000);
  expect(envois).toHaveLength(1);
  const premiere = envois[0].lot.session;
  c.montrer();
  horloge.t += 5_000;
  c.page('esport.dashboard');
  await attendre(45_000);
  expect(envois).toHaveLength(2);
  expect(envois[1].keepalive).toBe(false);
  expect(envois[1].lot.session).not.toBe(premiere);
  expect(envois[1].lot.evenements.map(e => [e.a ?? e.p, e.d])).toEqual([
    ['connexion', undefined],
    ['team.equipe.goals_tasks', 5_000],
  ]);
});

test('collecte coupée par le Fondateur : le collecteur s’arrête et n’envoie plus rien', async () => {
  const { c, envois, attendre, estArrete } = banc(async () => ({ actif: false }));
  c.page('esport.teams');
  c.action('rsvp');
  await attendre(45_000);
  expect(envois).toHaveLength(1);
  expect(estArrete()).toBe(true);
  expect(c.etat.actif).toBe(false);
  c.action('rsvp');
  c.masquer();
  await attendre(45_000);
  expect(envois).toHaveLength(1);
});

test('erreurs JS : message et page, une même erreur au plus une fois par minute', async () => {
  const { c, envois, attendre, horloge } = banc();
  c.page('team.jeu.resources', 't');
  c.erreur('TypeError: x is undefined');
  c.erreur('TypeError: x is undefined');
  horloge.t += 61_000;
  c.erreur('TypeError: x is undefined');
  c.erreur('');
  await attendre(45_000);
  const erreurs = envois[0].lot.evenements.filter(e => e.g === 'erreur');
  expect(erreurs).toHaveLength(2);
  expect(erreurs[0]).toMatchObject({ m: 'TypeError: x is undefined', p: 'team.jeu.resources' });
});

test('actions clés : déduites des appels réussis de l’API', () => {
  const t = '0b8f2f5e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
  expect(actionDAppel('POST', `/teams/${t}/planning`)).toEqual({ action: 'evenement.cree', team: t });
  expect(actionDAppel('PUT', `/teams/${t}/planning/e1/occurrences/2026-10-20T18%3A00%3A00.000Z/rsvp`)).toEqual({ action: 'rsvp', team: t });
  expect(actionDAppel('POST', `/teams/${t}/resumes`)?.action).toBe('resume.depose');
  expect(actionDAppel('POST', `/teams/${t}/review/r1/reperes`)?.action).toBe('repere.ajoute');
  expect(actionDAppel('POST', `/teams/${t}/ressources`)?.action).toBe('ressource.publiee');
  expect(actionDAppel('POST', `/teams/${t}/strats`)?.action).toBe('strat.creee');
  expect(actionDAppel('GET', `/teams/${t}/planning`)).toBeUndefined();
  expect(actionDAppel('POST', '/usage')).toBeUndefined();
});

test('type d’appareil : PC, tablette, téléphone, app PC', () => {
  expect(appareilDe({ os: 'ios', isPad: true })).toBe('tablette');
  expect(appareilDe({ os: 'ios', isPad: false })).toBe('telephone');
  expect(appareilDe({ os: 'android', largeur: 800 })).toBe('tablette');
  expect(appareilDe({ os: 'web', electron: true, userAgent: 'Mozilla/5.0 (Windows NT 10.0) Electron/30' })).toBe('app_pc');
  expect(appareilDe({ os: 'web', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148' })).toBe('telephone');
  expect(appareilDe({ os: 'web', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 })).toBe('tablette');
  expect(appareilDe({ os: 'web', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })).toBe('pc');
});
