import {
  DELAIS_REESSAI_MS,
  DELAI_MODIFICATION_MS,
  ECART_MIN_TOURS_MS,
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
    }, h.minuteries, h.maintenant);
  };
  beforeEach(() => {
    h = horlogeFausse();
    raisons = [];
    issues = [];
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

  it('réessaie après un échec à 5 s, 30 s, 2 min, 10 min, puis reste à 10 min (sans tic périodique)', async () => {
    creer(false);
    p.demarrer();
    await attendre();
    expect(p.echecsConsecutifs).toBe(1);
    let t = 0;
    for (const [i, delai] of [...DELAIS_REESSAI_MS, DELAIS_REESSAI_MS[3]].entries()) {
      await h.avancer(delai - 1);
      t += delai - 1;
      expect(raisons.filter(r => r === 'reessai')).toHaveLength(i);
      await h.avancer(1);
      t += 1;
      expect(raisons.filter(r => r === 'reessai')).toHaveLength(i + 1);
      expect(p.echecsConsecutifs).toBe(i + 2);
    }
    expect(raisons.includes('periodique')).toBe(false);
    expect(t).toBe(5_000 + 30_000 + 120_000 + 600_000 + 600_000);
  });

  it('les paliers de réessai', () => {
    expect([0, 1, 2, 3, 4, 10].map(delaiReessai)).toEqual([5_000, 30_000, 120_000, 600_000, 600_000, 600_000]);
  });

  it('un succès remet le compteur d’échecs à zéro et arrête les réessais', async () => {
    issues = [false, true];
    creer(true);
    p.demarrer();
    await attendre();
    expect(p.echecsConsecutifs).toBe(1);
    await h.avancer(5_000);
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
    await h.avancer(5_000); // second échec ; prochain palier : 30 s
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
});
