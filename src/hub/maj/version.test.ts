import {
  ANTI_BOUCLE_MS,
  INTERVALLE_VERIFICATION_MS,
  PAS_AUTO_MS,
  SEUILS,
  dateDuBuild,
  decisionAuto,
  definirMajAuto,
  dejaRechargePour,
  estPlusRecente,
  lireVersion,
  majAutoActive,
  marquerSaisie,
  noterRechargement,
  saisieEnCours,
  surveillerVersion,
  type CibleEvenements,
  type DocumentLike,
  type VersionBuild,
} from './version';

const T0 = Date.parse('2026-10-30T12:00:00.000Z');
const v = (id: string, commit: string | null, date: string | null): VersionBuild => ({ id, commit, date });
const ANCIENNE = v('aaaaaaa-1', 'a'.repeat(40), '2026-10-30T10:00:00.000Z');
const NOUVELLE = v('bbbbbbb-2', 'b'.repeat(40), '2026-10-30T11:00:00.000Z');

describe('comparaison de versions', () => {
  it('ne voit une nouvelle version que si le serveur a un build plus récent', () => {
    expect(estPlusRecente(ANCIENNE, NOUVELLE)).toBe(true);
    expect(estPlusRecente(NOUVELLE, ANCIENNE)).toBe(false);
    expect(estPlusRecente(ANCIENNE, ANCIENNE)).toBe(false);
    expect(estPlusRecente(ANCIENNE, { ...ANCIENNE, id: 'aaaaaaa-3', date: '2026-10-30T12:00:00.000Z' })).toBe(false);
    expect(estPlusRecente(undefined, NOUVELLE)).toBe(false);
    expect(estPlusRecente(ANCIENNE, undefined)).toBe(false);
  });

  it('comprend l’ancien format de version.json (id « commit-date en base 36 »)', () => {
    const ancienFormat = { id: `ccccccc-${(T0 + 1000).toString(36)}` };
    expect(dateDuBuild(ancienFormat)).toBe(T0 + 1000);
    expect(estPlusRecente(v('ddddddd-x', null, new Date(T0).toISOString()), ancienFormat)).toBe(true);
    expect(estPlusRecente(v('ddddddd-x', null, new Date(T0 + 5000).toISOString()), ancienFormat)).toBe(false);
    expect(estPlusRecente(v('sans-date', null, null), v('autre', null, null))).toBe(true);
  });

  it('lit version.json avec tolérance', () => {
    expect(lireVersion({ id: 'x-1', commit: 'abc', date: 'd' })).toEqual({ id: 'x-1', commit: 'abc', date: 'd' });
    expect(lireVersion({ id: 'x-1' })).toEqual({ id: 'x-1', commit: null, date: null });
    expect(lireVersion({})).toBeUndefined();
    expect(lireVersion('texte')).toBeUndefined();
    expect(lireVersion(null)).toBeUndefined();
  });
});

const champ = (valeur = '', extra: Record<string, unknown> = {}) => ({ tagName: 'INPUT', type: 'text', value: valeur, isConnected: true, ...extra });

describe('saisie en cours : jamais de rechargement qui perdrait un formulaire', () => {
  afterEach(() => marquerSaisie('test', false));

  it('reconnaît un champ actif, un texte tapé pas encore envoyé, une saisie signalée, un média en lecture', () => {
    expect(saisieEnCours({ activeElement: champ() })).toBe(true);
    expect(saisieEnCours({ activeElement: { tagName: 'TEXTAREA' } })).toBe(true);
    expect(saisieEnCours({ activeElement: { tagName: 'DIV', isContentEditable: true } })).toBe(true);
    expect(saisieEnCours({ activeElement: { tagName: 'INPUT', type: 'checkbox' } })).toBe(false);
    expect(saisieEnCours({ activeElement: { tagName: 'BUTTON' } })).toBe(false);
    expect(saisieEnCours({ activeElement: champ('', { readOnly: true }) })).toBe(false);
    // Texte tapé puis champ quitté : toujours en cours tant que le champ existe et n'est pas vide.
    expect(saisieEnCours({ activeElement: null }, [champ('Bonjour')])).toBe(true);
    expect(saisieEnCours({ activeElement: null }, [champ('   ')])).toBe(false);
    expect(saisieEnCours({ activeElement: null }, [champ('envoyé', { isConnected: false })])).toBe(false);
    marquerSaisie('test', true);
    expect(saisieEnCours({ activeElement: null })).toBe(true);
    marquerSaisie('test', false);
    const medias = (paused: boolean) => ({ activeElement: null, querySelectorAll: () => [{ tagName: 'VIDEO', paused, ended: false }] });
    expect(saisieEnCours(medias(false))).toBe(true);
    expect(saisieEnCours(medias(true))).toBe(false);
    expect(saisieEnCours(undefined)).toBe(false);
  });

  it('décide : proposer (option coupée), attendre (saisie, app utilisée), recharger (inactive ou en arrière-plan)', () => {
    const base = { auto: true, saisie: false, inactifDepuisMs: 0, sessionOuverte: false };
    expect(decisionAuto({ ...base, auto: false, cacheDepuisMs: 3_600_000 })).toBe('proposer');
    expect(decisionAuto({ ...base, saisie: true, cacheDepuisMs: 3_600_000, inactifDepuisMs: 3_600_000 })).toBe('attendre');
    expect(decisionAuto(base)).toBe('attendre');
    expect(decisionAuto({ ...base, cacheDepuisMs: SEUILS.verrouille.cache })).toBe('recharger');
    expect(decisionAuto({ ...base, inactifDepuisMs: SEUILS.verrouille.inactif })).toBe('recharger');
    // Compte ouvert : il faudra le rouvrir, on attend plus longtemps.
    expect(decisionAuto({ ...base, sessionOuverte: true, cacheDepuisMs: 5 * 60_000 })).toBe('attendre');
    expect(decisionAuto({ ...base, sessionOuverte: true, cacheDepuisMs: SEUILS.ouverte.cache })).toBe('recharger');
    expect(decisionAuto({ ...base, sessionOuverte: true, inactifDepuisMs: SEUILS.ouverte.inactif })).toBe('recharger');
  });
});

function stockageMemoire() {
  const m = new Map<string, string>();
  return { getItem: (c: string) => m.get(c) ?? null, setItem: (c: string, x: string) => void m.set(c, x) };
}

describe('préférence et anti-boucle', () => {
  it('« Mettre à jour automatiquement » est activé par défaut et se coupe', () => {
    const s = stockageMemoire();
    expect(majAutoActive(s)).toBe(true);
    definirMajAuto(false, s);
    expect(majAutoActive(s)).toBe(false);
    definirMajAuto(true, s);
    expect(majAutoActive(s)).toBe(true);
    expect(majAutoActive(undefined)).toBe(true);
  });

  it('un seul rechargement automatique par version et par 10 minutes', () => {
    const s = stockageMemoire();
    expect(dejaRechargePour('v2', T0, s)).toBe(false);
    noterRechargement('v2', T0, s);
    expect(dejaRechargePour('v2', T0 + 1000, s)).toBe(true);
    expect(dejaRechargePour('v3', T0 + 1000, s)).toBe(false);
    expect(dejaRechargePour('v2', T0 + ANTI_BOUCLE_MS + 1, s)).toBe(false);
  });
});

/** Environnement simulé : document et fenêtre à événements, minuteries manuelles, horloge réglable. */
function environnement({ distante = NOUVELLE as VersionBuild | undefined, auto = true, ouverte = false } = {}) {
  const horloge = { t: T0 };
  const ecouteurs = new Map<string, Set<(e: { target?: unknown }) => void>>();
  const cible = (): CibleEvenements => ({
    addEventListener: (type, f) => {
      if (!ecouteurs.has(type)) ecouteurs.set(type, new Set());
      ecouteurs.get(type)!.add(f);
    },
    removeEventListener: (type, f) => void ecouteurs.get(type)?.delete(f),
  });
  const doc: DocumentLike & CibleEvenements & { activeElement: unknown; visibilityState: string } = { ...cible(), activeElement: null, visibilityState: 'visible' };
  const minuteries: Array<{ f: () => void; ms: number }> = [];
  const etat = { distante, lectures: 0, rechargements: 0, deja: new Set<string>(), auto, ouverte };
  const env = {
    locale: ANCIENNE,
    lire: async () => {
      etat.lectures += 1;
      return etat.distante;
    },
    maintenant: () => horloge.t,
    document: doc as DocumentLike & CibleEvenements,
    fenetre: cible(),
    minuterie: { setInterval: (f: () => void, ms: number) => minuteries.push({ f, ms }), clearInterval: () => undefined },
    recharger: () => {
      etat.rechargements += 1;
    },
    auto: () => etat.auto,
    sessionOuverte: () => etat.ouverte,
    dejaRecharge: (id: string) => etat.deja.has(id),
    noterRechargement: (id: string) => void etat.deja.add(id),
  };
  const emettre = (type: string, e: { target?: unknown } = {}) => ecouteurs.get(type)?.forEach(f => f(e));
  const tic = (ms: number) => {
    horloge.t += ms;
    for (const m of minuteries) if (m.ms === PAS_AUTO_MS || (m.ms === INTERVALLE_VERIFICATION_MS && ms >= INTERVALLE_VERIFICATION_MS)) m.f();
  };
  return { env, etat, horloge, doc, emettre, tic, minuteries };
}

const attendre = () => new Promise<void>(r => setTimeout(() => r(), 0));

describe('surveillance de la version', () => {
  afterEach(() => marquerSaisie('formulaire', false));

  it('vérifie au démarrage, toutes les 3 minutes et au retour au premier plan (au plus toutes les 30 s)', async () => {
    const { env, etat, horloge, doc, emettre, minuteries } = environnement({ distante: ANCIENNE });
    const s = surveillerVersion(env);
    await attendre();
    expect(etat.lectures).toBe(1);
    expect(minuteries.map(m => m.ms).sort()).toEqual([PAS_AUTO_MS, INTERVALLE_VERIFICATION_MS].sort());
    emettre('focus');
    await attendre();
    expect(etat.lectures).toBe(1);
    horloge.t += 31_000;
    doc.visibilityState = 'visible';
    emettre('visibilitychange');
    await attendre();
    expect(etat.lectures).toBe(2);
    minuteries.find(m => m.ms === INTERVALLE_VERIFICATION_MS)!.f();
    await attendre();
    expect(etat.lectures).toBe(3);
    expect(s.etat().disponible).toBeUndefined();
    s.arreter();
  });

  it('nouvelle version : bandeau, puis rechargement automatique une fois l’app en arrière-plan', async () => {
    const { env, etat, doc, emettre, tic } = environnement();
    const s = surveillerVersion(env);
    const vu = jest.fn();
    s.abonner(vu);
    await attendre();
    expect(s.etat().disponible?.id).toBe(NOUVELLE.id);
    expect(vu).toHaveBeenCalled();
    expect(etat.rechargements).toBe(0);
    doc.visibilityState = 'hidden';
    emettre('visibilitychange');
    tic(PAS_AUTO_MS);
    expect(etat.rechargements).toBe(1);
    expect(s.etat().rechargement).toBe(true);
    s.arreter();
  });

  it('ne recharge jamais pendant une saisie (champ actif, texte tapé, saisie signalée), même longtemps inactive', async () => {
    const { env, etat, doc, emettre, tic } = environnement();
    const s = surveillerVersion(env);
    await attendre();
    doc.visibilityState = 'hidden';
    emettre('visibilitychange');
    // Champ actif.
    doc.activeElement = champ();
    tic(60 * 60_000);
    expect(etat.rechargements).toBe(0);
    // Champ quitté, mais du texte tapé et pas envoyé.
    const brouillon = champ('Compte rendu du match');
    emettre('input', { target: brouillon });
    doc.activeElement = null;
    tic(60 * 60_000);
    expect(etat.rechargements).toBe(0);
    // Saisie signalée par un écran.
    brouillon.value = '';
    marquerSaisie('formulaire', true);
    tic(60 * 60_000);
    expect(etat.rechargements).toBe(0);
    // Plus rien en cours : rechargement.
    marquerSaisie('formulaire', false);
    tic(PAS_AUTO_MS);
    expect(etat.rechargements).toBe(1);
    expect(s.etat().disponible?.id).toBe(NOUVELLE.id);
    s.arreter();
  });

  it('app utilisée au premier plan : attend ; option coupée : jamais d’automatique, le clic recharge', async () => {
    const { env, etat, emettre, tic, horloge } = environnement({ ouverte: true });
    const s = surveillerVersion(env);
    await attendre();
    for (let i = 0; i < 10; i++) {
      horloge.t += 60_000;
      emettre('pointerdown');
      tic(PAS_AUTO_MS);
    }
    expect(etat.rechargements).toBe(0);
    tic(SEUILS.ouverte.inactif);
    expect(etat.rechargements).toBe(1);
    s.arreter();

    const e2 = environnement({ auto: false });
    const s2 = surveillerVersion(e2.env);
    await attendre();
    e2.doc.visibilityState = 'hidden';
    e2.emettre('visibilitychange');
    e2.tic(24 * 60 * 60_000);
    expect(e2.etat.rechargements).toBe(0);
    await s2.mettreAJour();
    expect(e2.etat.rechargements).toBe(1);
    s2.arreter();
  });

  it('anti-boucle : pas de second rechargement automatique vers la même version', async () => {
    const { env, etat, doc, emettre, tic } = environnement();
    etat.deja.add(NOUVELLE.id);
    const s = surveillerVersion(env);
    await attendre();
    doc.visibilityState = 'hidden';
    emettre('visibilitychange');
    tic(60 * 60_000);
    expect(etat.rechargements).toBe(0);
    expect(s.etat().disponible?.id).toBe(NOUVELLE.id);
    s.arreter();
  });

  it('sans version locale (app native, développement) : ne fait rien', async () => {
    const { env, etat, minuteries } = environnement();
    const s = surveillerVersion({ ...env, locale: undefined });
    await attendre();
    expect(etat.lectures).toBe(0);
    expect(minuteries).toHaveLength(0);
    s.arreter();
  });
});
