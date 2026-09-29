import { d } from '../core/money/decimal';
import { rejouer } from '../core/portfolio/engine';
import { achat, compte, titre, versement } from '../core/testing/fixtures';
import { canalMemoire } from './envoi';
import { PLANNING_DEFAUT } from './planification';
import { ETAT_PERSISTE_VIDE, type DependancesReveil, type ResultatReveil } from './reveil';
import {
  GARDE_MILLISECONDES,
  INTERVALLE_MINUTES,
  enregistrerReveil,
} from './tache-fond';

const LUNDI_8H = new Date(2026, 8, 21, 8, 0);
const pea = compte();
const airLiquide = titre();

function dependances(partiel: Partial<DependancesReveil> = {}): DependancesReveil {
  return {
    maintenant: LUNDI_8H,
    planning: PLANNING_DEFAUT,
    seuils: [],
    etatPersiste: ETAT_PERSISTE_VIDE,
    canal: canalMemoire(),
    lirePortefeuille: async () => ({
      etat: rejouer([pea], [versement('2026-01-05', 1000), achat('2026-01-10', 10, 100, 0)]),
      titres: [airLiquide],
    }),
    rafraichirCours: async () => new Map([['air-liquide', d('110')]]),
    enregistrer: async () => undefined,
    ...partiel,
  };
}

/** Faux module natif, qui retient la tâche pour la déclencher à la main. */
function moduleFactice(options: { echouer?: boolean } = {}) {
  const etat = {
    finis: [] as string[],
    configuration: undefined as Record<string, unknown> | undefined,
    tache: undefined as ((id: string) => void | Promise<void>) | undefined,
    expiration: undefined as ((id: string) => void | Promise<void>) | undefined,
  };

  return {
    etat,
    module: {
      configure: async (
        configuration: Record<string, unknown>,
        tache: (id: string) => void | Promise<void>,
        expiration: (id: string) => void | Promise<void>,
      ) => {
        if (options.echouer) {
          throw new Error('réveil refusé par le système');
        }
        etat.configuration = configuration;
        etat.tache = tache;
        etat.expiration = expiration;
        return 1;
      },
      finish: (id: string) => {
        etat.finis.push(id);
      },
    },
  };
}

describe('enregistrerReveil', () => {
  it('déclare l’application intéressée par les réveils', async () => {
    const factice = moduleFactice();

    const enregistrement = await enregistrerReveil({
      dependances: async () => dependances(),
      moduleFond: factice.module,
    });

    expect(enregistrement.disponible).toBe(true);
    expect(factice.etat.configuration).toMatchObject({
      minimumFetchInterval: INTERVALLE_MINUTES,
      stopOnTerminate: false,
      startOnBoot: true,
    });
  });

  it('exécute un réveil et signale la fin à iOS', async () => {
    const factice = moduleFactice();
    const journal: (ResultatReveil | undefined)[] = [];

    await enregistrerReveil({
      dependances: async () => dependances(),
      journaliser: resultat => journal.push(resultat),
      moduleFond: factice.module,
    });
    await factice.etat.tache!('tache-1');

    expect(journal[0]?.briefingsEnvoyes).toEqual(['briefing-2026-09-21-matin']);
    // Sans finish(), iOS tue la tache et en accorde de moins en moins.
    expect(factice.etat.finis).toEqual(['tache-1']);
  });

  it('signale la fin même quand le réveil échoue', async () => {
    const factice = moduleFactice();
    const journal: (ResultatReveil | undefined)[] = [];

    await enregistrerReveil({
      dependances: async () => {
        throw new Error('coffre verrouillé');
      },
      journaliser: resultat => journal.push(resultat),
      moduleFond: factice.module,
    });
    await factice.etat.tache!('tache-2');

    expect(journal).toEqual([undefined]);
    expect(factice.etat.finis).toEqual(['tache-2']);
  });

  it('rend la main au bout du délai de garde', async () => {
    const factice = moduleFactice();
    const journal: (ResultatReveil | undefined)[] = [];

    await enregistrerReveil({
      // Un reveil qui ne revient jamais : le minuteur doit trancher.
      dependances: () => new Promise<DependancesReveil>(() => undefined),
      journaliser: resultat => journal.push(resultat),
      moduleFond: factice.module,
      gardeMillisecondes: 10,
    });
    await factice.etat.tache!('tache-3');

    expect(journal).toEqual([undefined]);
    expect(factice.etat.finis).toEqual(['tache-3']);
  });

  it('clôture proprement quand iOS reprend la main', async () => {
    const factice = moduleFactice();

    await enregistrerReveil({
      dependances: async () => dependances(),
      moduleFond: factice.module,
    });
    await factice.etat.expiration!('tache-4');

    expect(factice.etat.finis).toEqual(['tache-4']);
  });

  describe('indisponibilité', () => {
    it('le dit plutôt que d’échouer quand le module manque', async () => {
      const enregistrement = await enregistrerReveil({
        dependances: async () => dependances(),
        moduleFond: { rien: true },
      });

      expect(enregistrement.disponible).toBe(false);
      expect(enregistrement.raison).toBeDefined();
    });

    it('le dit quand le système refuse le réveil', async () => {
      const factice = moduleFactice({ echouer: true });

      const enregistrement = await enregistrerReveil({
        dependances: async () => dependances(),
        moduleFond: factice.module,
      });

      expect(enregistrement.disponible).toBe(false);
      expect(enregistrement.raison).toMatch(/refusé/);
    });
  });

  it('expose un délai de garde inférieur à la fenêtre iOS', () => {
    // iOS accorde une trentaine de secondes : on rend la main avant.
    expect(GARDE_MILLISECONDES).toBeLessThan(30_000);
  });
});
