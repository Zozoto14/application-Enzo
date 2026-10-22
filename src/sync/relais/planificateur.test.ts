import {
  DELAIS_REESSAI_MS,
  DELAI_MODIFICATION_MS,
  ECART_MIN_TOURS_MS,
  INTERVALLE_AVEC_AVIS_MS,
  INTERVALLE_SYNCHRO_MS,
  Planificateur,
  delaiReessai,
  type IssueTour,
  type Minuteries,
  type RaisonTour,
} from './planificateur';

/** Fausses minuteries pilotées à la main. */
function horlogeFausse() {
  let maintenant = 0;
  let suivant = 1;
  const taches = new Map<number, { a: number; action: () => void; pas?: number }>();
  const minuteries: Minuteries = {
    setTimeout: (action, ms) => {
      const id = suivant++;
      taches.set(id, { a: maintenant + ms, action });
      return id;
    },
    clearTimeout: id => void taches.delete(id as number),
    setInterval: (action, ms) => {
      const id = suivant++;
      taches.set(id, { a: maintenant + ms, action, pas: ms });
      return id;
    },
    clearInterval: id => void taches.delete(id as number),
  };
  const avancer = async (ms: number) => {
    const fin = maintenant + ms;
    for (;;) {
      const prochaine = [...taches.entries()].filter(([, t]) => t.a <= fin).sort((x, y) => x[1].a - y[1].a)[0];
      if (!prochaine) break;
      const [id, tache] = prochaine;
      maintenant = tache.a;
      if (tache.pas) tache.a += tache.pas;
      else taches.delete(id);
      tache.action();
      for (let i = 0; i < 10; i++) await Promise.resolve();
    }
    maintenant = fin;
  };
  return { minuteries, avancer, maintenant: () => maintenant, actives: () => taches.size };
}

const attendre = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe('Planificateur de synchro', () => {
  let h: ReturnType<typeof horlogeFausse>;
  let raisons: RaisonTour[];
  let issues: IssueTour[];
  let p: Planificateur;
  const creer = (defaut: IssueTour = true) => {
    p = new Planificateur(async raison => {
      raisons.push(raison);
      return issues.length > 0 ? issues.shift()! : defaut;
    }, h.minuteries, h.maintenant, { alea: () => 0 });
  };
  beforeEach(() => {
    h = horlogeFausse();
    raisons = [];
    issues = [];
  });

  it('premier tour immédiat après le déverrouillage : aucune attente, aucune minuterie', () => {
    creer();
    p.demarrer();
    // Le tour part pendant l'appel même : ni délai de modification (3 s), ni tic périodique (2 min).
    expect(raisons).toEqual(['ouverture']);
    // Seul le tic périodique est armé (une minuterie), pas de délai avant le premier tour.
    expect(h.actives()).toBe(1);
    p.arreter();
  });

  it('lance un tour à l’ouverture puis toutes les deux minutes', async () => {
    creer();
    p.demarrer();
    await attendre();
    expect(raisons).toEqual(['ouverture']);
    await h.avancer(INTERVALLE_SYNCHRO_MS);
    await h.avancer(INTERVALLE_SYNCHRO_MS);
    expect(raisons).toEqual(['ouverture', 'periodique', 'periodique']);
    p.arreter();
    await h.avancer(INTERVALLE_SYNCHRO_MS * 3);
    expect(raisons).toHaveLength(3);
    expect(h.actives()).toBe(0);
  });

  it('lance un tour au retour au premier plan et quand le réseau revient', async () => {
    creer();
    p.demarrer();
    await attendre();
    await h.avancer(ECART_MIN_TOURS_MS + 1);
    p.retourPremierPlan();
    await attendre();
    await h.avancer(ECART_MIN_TOURS_MS + 1);
    p.enLigne();
    await attendre();
    expect(raisons).toEqual(['ouverture', 'premier-plan', 'en-ligne']);
  });

  it('regroupe les retours au premier plan rapprochés (économie de lectures du relais)', async () => {
    creer();
    p.demarrer();
    await attendre();
    p.retourPremierPlan();
    p.retourPremierPlan();
    await attendre();
    expect(raisons).toEqual(['ouverture']);
  });

  it('une modification lance un tour après un court délai, les rafales n’en font qu’un', async () => {
    creer();
    p.demarrer();
    await attendre();
    p.modification();
    await h.avancer(DELAI_MODIFICATION_MS - 1000);
    p.modification();
    await h.avancer(DELAI_MODIFICATION_MS - 1000);
    expect(raisons).toEqual(['ouverture']);
    await h.avancer(1500);
    expect(raisons).toEqual(['ouverture', 'modification']);
  });

  it('réessaie après un échec à 1 s, 3 s, 10 s, 30 s, 2 min, 5 min, puis reste à 5 min (sans tic périodique)', async () => {
    creer(false);
    p.demarrer();
    await attendre();
    expect(p.echecsConsecutifs).toBe(1);
    let t = 0;
    for (const [i, delai] of [...DELAIS_REESSAI_MS, DELAIS_REESSAI_MS[DELAIS_REESSAI_MS.length - 1]].entries()) {
      await h.avancer(delai - 1);
      t += delai - 1;
      expect(raisons.filter(r => r === 'reessai')).toHaveLength(i);
      await h.avancer(1);
      t += 1;
      expect(raisons.filter(r => r === 'reessai')).toHaveLength(i + 1);
      expect(p.echecsConsecutifs).toBe(i + 2);
    }
    expect(raisons.includes('periodique')).toBe(false);
    expect(t).toBe(1_000 + 3_000 + 10_000 + 30_000 + 120_000 + 300_000 + 300_000);
  });

  it('les paliers de réessai', () => {
    expect([0, 1, 2, 3, 4, 5, 10].map(delaiReessai)).toEqual([1_000, 3_000, 10_000, 30_000, 120_000, 300_000, 300_000]);
  });

  it('un succès remet le compteur d’échecs à zéro et arrête les réessais', async () => {
    issues = [false, true];
    creer(true);
    p.demarrer();
    await attendre();
    expect(p.echecsConsecutifs).toBe(1);
    await h.avancer(1_000);
    expect(raisons.slice(0, 2)).toEqual(['ouverture', 'reessai']);
    expect(p.echecsConsecutifs).toBe(0);
    const n = raisons.length;
    await h.avancer(20_000);
    expect(raisons.length).toBe(n);
  });

  it('le retour en ligne n’attend pas la fin du palier de réessai', async () => {
    issues = [false, false];
    creer(true);
    p.demarrer();
    await attendre();
    await h.avancer(1_000); // second échec ; prochain palier : 3 s
    p.enLigne();
    await attendre();
    expect(raisons).toEqual(['ouverture', 'reessai', 'en-ligne']);
    expect(p.echecsConsecutifs).toBe(0);
  });

  it('une demande pendant un tour n’est pas perdue : un seul tour à la fois, puis un nouveau', async () => {
    let libere: (v: boolean) => void = () => undefined;
    let actifs = 0;
    let maxActifs = 0;
    const lancements: RaisonTour[] = [];
    p = new Planificateur(
      raison => {
        lancements.push(raison);
        actifs++;
        maxActifs = Math.max(maxActifs, actifs);
        return new Promise<boolean>(r => {
          libere = v => {
            actifs--;
            r(v);
          };
        });
      },
      h.minuteries,
      h.maintenant,
    );
    p.demarrer();
    await attendre();
    void p.manuel();
    void p.manuel();
    await attendre();
    expect(lancements).toEqual(['ouverture']);
    libere(true);
    await attendre();
    expect(lancements).toEqual(['ouverture', 'modification']);
    libere(true);
    await attendre();
    expect(maxActifs).toBe(1);
  });

  it('rappelle le tour quand un dépôt a été différé (délai minimal entre dépôts)', async () => {
    issues = [{ ok: true, rappelerDans: 20_000 }];
    creer(true);
    p.demarrer();
    await attendre();
    await h.avancer(20_400);
    expect(raisons).toEqual(['ouverture']);
    await h.avancer(200);
    expect(raisons).toEqual(['ouverture', 'differe']);
  });

  it('une exception dans le tour compte comme un échec', async () => {
    p = new Planificateur(async () => {
      throw new Error('boum');
    }, h.minuteries, h.maintenant);
    p.demarrer();
    await attendre();
    expect(p.echecsConsecutifs).toBe(1);
  });

  it('arrêté, il ne lance plus rien', async () => {
    creer(false);
    p.demarrer();
    await attendre();
    p.arreter();
    p.modification();
    p.enLigne();
    await h.avancer(60 * 60_000);
    expect(raisons).toEqual(['ouverture']);
  });

  it('micro-regroupement : une modification part ~150 ms après, une rafale continue part au plus tard au bout d’1 s', async () => {
    creer(true);
    p.demarrer();
    await attendre();
    raisons.length = 0;
    p.modification();
    await h.avancer(DELAI_MODIFICATION_MS - 1);
    expect(raisons).toEqual([]);
    await h.avancer(1);
    expect(raisons).toEqual(['modification']);
    // Frappes toutes les 100 ms pendant 3 s : un envoi par seconde au plus, jamais d'attente infinie.
    raisons.length = 0;
    for (let i = 0; i < 30; i++) {
      p.modification();
      await h.avancer(100);
    }
    await h.avancer(DELAI_MODIFICATION_MS);
    const n = raisons.filter(r => r === 'modification').length;
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(4);
  });

  it('délais réglables, avis du serveur immédiat, intervalle changé en route (filet de 3 min)', async () => {
    p = new Planificateur(
      async raison => {
        raisons.push(raison);
        return true;
      },
      h.minuteries,
      h.maintenant,
      { delaiModificationMs: 40, intervalleMs: INTERVALLE_SYNCHRO_MS },
    );
    p.demarrer();
    await attendre();
    raisons.length = 0;
    p.modification();
    await h.avancer(40);
    expect(raisons).toEqual(['modification']);
    p.notification();
    await attendre();
    expect(raisons).toEqual(['modification', 'notification']);
    p.definirIntervalle(INTERVALLE_AVEC_AVIS_MS);
    expect(p.intervalle).toBe(INTERVALLE_AVEC_AVIS_MS);
    raisons.length = 0;
    await h.avancer(INTERVALLE_SYNCHRO_MS * 2);
    expect(raisons).toEqual([]);
    await h.avancer(INTERVALLE_AVEC_AVIS_MS - INTERVALLE_SYNCHRO_MS * 2);
    expect(raisons).toEqual(['periodique']);
  });
});
