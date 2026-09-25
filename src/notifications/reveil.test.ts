import { Decimal, d } from '../core/money/decimal';
import { rejouer } from '../core/portfolio/engine';
import { achat, compte, titre, versement } from '../core/testing/fixtures';
import type { SeuilAlerte } from './briefing';
import { CANAL_INDISPONIBLE, canalMemoire } from './envoi';
import { PLANNING_DEFAUT, type Planning } from './planification';
import {
  ETAT_PERSISTE_VIDE,
  elaguerEnvoyes,
  executerReveil,
  type DependancesReveil,
  type EtatPersiste,
} from './reveil';

/** 2026-09-21 est un lundi : briefings a 08:00 et 17:30. */
const LUNDI = (heure: number, minute = 0) => new Date(2026, 8, 21, heure, minute);

const pea = compte();
const airLiquide = titre();

function portefeuille() {
  return {
    etat: rejouer([pea], [versement('2026-01-05', 1000), achat('2026-01-10', 10, 100, 0)]),
    titres: [airLiquide],
  };
}

interface Montage {
  deps: DependancesReveil;
  canal: ReturnType<typeof canalMemoire>;
  enregistres: EtatPersiste[];
}

function monter(partiel: Partial<DependancesReveil> = {}): Montage {
  const canal = canalMemoire();
  const enregistres: EtatPersiste[] = [];

  const deps: DependancesReveil = {
    maintenant: LUNDI(8),
    planning: PLANNING_DEFAUT,
    seuils: [],
    etatPersiste: ETAT_PERSISTE_VIDE,
    canal,
    lirePortefeuille: async () => portefeuille(),
    rafraichirCours: async () => new Map([['air-liquide', d('110')]]),
    enregistrer: async etat => {
      enregistres.push(etat);
    },
    ...partiel,
  };

  return { deps, canal, enregistres };
}

describe('executerReveil', () => {
  it('envoie le briefing du matin quand il est dû', async () => {
    const { deps, canal } = monter();

    const resultat = await executerReveil(deps);

    expect(resultat.briefingsEnvoyes).toEqual(['briefing-2026-09-21-matin']);
    expect(canal.envoyees).toHaveLength(1);
    expect(canal.envoyees[0].titre).toMatch(/^Avant ouverture/);
  });

  it('ne touche à rien quand rien n’est dû', async () => {
    // 7h59 un lundi : le briefing de 8h n'est pas encore du, et aucun seuil
    // n'est surveille. Le reseau ne doit pas etre sollicite.
    const rafraichirCours = jest.fn();
    const { deps, enregistres } = monter({
      maintenant: LUNDI(7, 59),
      rafraichirCours,
    });

    const resultat = await executerReveil(deps);

    expect(resultat.motif).toBe('rien-a-faire');
    expect(rafraichirCours).not.toHaveBeenCalled();
    expect(enregistres).toEqual([]);
  });

  it('surveille les seuils même hors des heures de briefing', async () => {
    const seuils: readonly SeuilAlerte[] = [{ titreId: 'air-liquide', haut: d('105') }];
    const { deps, canal } = monter({ maintenant: LUNDI(13), seuils });

    const resultat = await executerReveil(deps);

    expect(resultat.briefingsEnvoyes).toEqual([]);
    expect(resultat.alertesEnvoyees).toEqual(['alerte-air-liquide-haut-2026-09-21']);
    expect(canal.envoyees[0].titre).toMatch(/franchit/);
  });

  it('ne renvoie pas une alerte déjà envoyée', async () => {
    const seuils: readonly SeuilAlerte[] = [{ titreId: 'air-liquide', haut: d('105') }];
    const { deps, canal } = monter({
      maintenant: LUNDI(13),
      seuils,
      etatPersiste: {
        ...ETAT_PERSISTE_VIDE,
        briefingsEnvoyes: ['alerte-air-liquide-haut-2026-09-21'],
      },
    });

    const resultat = await executerReveil(deps);

    expect(resultat.alertesEnvoyees).toEqual([]);
    expect(canal.envoyees).toHaveLength(0);
  });

  it('juge le franchissement contre le cours précédent', async () => {
    // Le cours etait deja au-dessus du seuil : ce n'est pas un franchissement.
    const seuils: readonly SeuilAlerte[] = [{ titreId: 'air-liquide', haut: d('105') }];
    const { deps } = monter({
      maintenant: LUNDI(13),
      seuils,
      etatPersiste: {
        ...ETAT_PERSISTE_VIDE,
        coursPrecedents: { 'air-liquide': '108' },
      },
    });

    expect((await executerReveil(deps)).alertesEnvoyees).toEqual([]);
  });

  describe('silences', () => {
    it('renonce si le module de notifications manque', async () => {
      const { deps, enregistres } = monter({ canal: CANAL_INDISPONIBLE });

      expect((await executerReveil(deps)).motif).toBe('canal-indisponible');
      expect(enregistres).toEqual([]);
    });

    it('renonce si l’utilisateur a refusé les notifications', async () => {
      const { deps, canal } = monter();
      canal.permissionAccordee = false;

      expect((await executerReveil(deps)).motif).toBe('permission-refusee');
    });

    it('renonce si le portefeuille est illisible', async () => {
      // Base verrouillee, par exemple : on ne plante pas, iOS le retiendrait.
      const { deps } = monter({
        lirePortefeuille: async () => {
          throw new Error('coffre verrouillé');
        },
      });

      expect((await executerReveil(deps)).motif).toBe('portefeuille-illisible');
    });
  });

  describe('marquage', () => {
    it('marque un briefing muet comme traité', async () => {
      // La valeur n'a pas bouge : rien a dire. Sans marque, on rappellerait
      // les cours a chaque reveil pendant quatre heures.
      const { deps, canal, enregistres } = monter({
        etatPersiste: { ...ETAT_PERSISTE_VIDE, valeurPrecedente: '1100' },
      });

      const resultat = await executerReveil(deps);

      expect(canal.envoyees).toHaveLength(0);
      expect(resultat.briefingsTus).toEqual(['briefing-2026-09-21-matin']);
      expect(enregistres[0].briefingsEnvoyes).toContain('briefing-2026-09-21-matin');
    });

    it('n’envoie pas deux fois le même briefing', async () => {
      const { deps, canal } = monter({
        maintenant: LUNDI(9),
        etatPersiste: {
          ...ETAT_PERSISTE_VIDE,
          briefingsEnvoyes: ['briefing-2026-09-21-matin'],
        },
      });

      await executerReveil(deps);

      expect(canal.envoyees).toHaveLength(0);
    });

    it('ne marque rien si l’affichage échoue', async () => {
      const canal = {
        ...canalMemoire(),
        afficher: async () => {
          throw new Error('notifee indisponible');
        },
      };
      const { deps, enregistres } = monter({ canal });

      const resultat = await executerReveil(deps);

      expect(resultat.briefingsEnvoyes).toEqual([]);
      expect(enregistres[0].briefingsEnvoyes).toEqual([]);
    });

    it('mémorise la valeur annoncée pour le prochain écart', async () => {
      const { deps, enregistres } = monter();

      await executerReveil(deps);

      expect(enregistres[0].valeurPrecedente).toBe(d('1100').toString());
    });

    it('mémorise les cours frais', async () => {
      const { deps, enregistres } = monter();

      await executerReveil(deps);

      expect(enregistres[0].coursPrecedents).toEqual({ 'air-liquide': d('110').toString() });
    });
  });

  describe('panne réseau', () => {
    it('reprend les derniers cours connus sans échouer', async () => {
      const { deps } = monter({
        etatPersiste: { ...ETAT_PERSISTE_VIDE, coursPrecedents: { 'air-liquide': '110' } },
        rafraichirCours: async () => {
          throw new Error('hors ligne');
        },
      });

      const resultat = await executerReveil(deps);

      expect(resultat.coursPerimes).toBe(true);
      expect(resultat.briefingsEnvoyes).toEqual(['briefing-2026-09-21-matin']);
    });

    it('ne remplace pas les cours précédents par des cours périmés', async () => {
      // Sinon on perdrait le point de comparaison des franchissements.
      const { deps, enregistres } = monter({
        etatPersiste: { ...ETAT_PERSISTE_VIDE, coursPrecedents: { 'air-liquide': '110' } },
        rafraichirCours: async () => {
          throw new Error('hors ligne');
        },
      });

      await executerReveil(deps);

      expect(enregistres[0].coursPrecedents).toEqual({ 'air-liquide': '110' });
    });

    it('se tait si la valeur figée n’a pas bougé', async () => {
      const { deps, canal } = monter({
        etatPersiste: {
          briefingsEnvoyes: [],
          valeurPrecedente: '1100',
          coursPrecedents: { 'air-liquide': '110' },
        },
        rafraichirCours: async () => {
          throw new Error('hors ligne');
        },
      });

      await executerReveil(deps);

      expect(canal.envoyees).toHaveLength(0);
    });
  });

  it('enchaîne matin et soir dans le bon ordre si les deux sont dus', async () => {
    const planning: Planning = {
      ...PLANNING_DEFAUT,
      lundi: { actif: true, matin: '08:00', soir: '10:00' },
    };
    const { deps, canal } = monter({ maintenant: LUNDI(11), planning });

    const resultat = await executerReveil(deps);

    // Le premier annonce la valeur ; le second n'a plus rien a dire.
    expect(resultat.briefingsEnvoyes).toEqual(['briefing-2026-09-21-matin']);
    expect(resultat.briefingsTus).toEqual(['briefing-2026-09-21-soir']);
    expect(canal.envoyees).toHaveLength(1);
  });

  it('ignore un cours précédent illisible plutôt que d’échouer', async () => {
    const seuils: readonly SeuilAlerte[] = [{ titreId: 'air-liquide', haut: d('105') }];
    const { deps } = monter({
      maintenant: LUNDI(13),
      seuils,
      etatPersiste: { ...ETAT_PERSISTE_VIDE, coursPrecedents: { 'air-liquide': 'abîmé' } },
    });

    // Cours precedent inconnu : le franchissement est annonce par prudence.
    expect((await executerReveil(deps)).alertesEnvoyees).toHaveLength(1);
  });

  it('ignore un seuil vide', async () => {
    const { deps } = monter({ maintenant: LUNDI(13), seuils: [{ titreId: 'air-liquide' }] });

    expect((await executerReveil(deps)).motif).toBe('rien-a-faire');
  });
});

describe('elaguerEnvoyes', () => {
  it('garde les identifiants récents', () => {
    const garde = elaguerEnvoyes(
      ['briefing-2026-09-21-matin', 'briefing-2026-09-20-soir'],
      LUNDI(12),
    );

    expect(garde).toHaveLength(2);
  });

  it('écarte les identifiants trop anciens', () => {
    const garde = elaguerEnvoyes(
      ['briefing-2026-09-21-matin', 'briefing-2026-09-01-soir'],
      LUNDI(12),
    );

    expect(garde).toEqual(['briefing-2026-09-21-matin']);
  });

  it('garde un identifiant qu’il ne sait pas dater', () => {
    // Le perdre ferait renvoyer une notification deja vue.
    expect(elaguerEnvoyes(['sans-date'], LUNDI(12))).toEqual(['sans-date']);
  });

  it('empêche la liste de grossir indéfiniment', async () => {
    const anciens = Array.from(
      { length: 200 },
      (_, index) => `briefing-2026-0${1 + (index % 8)}-0${1 + (index % 9)}-matin`,
    );

    expect(elaguerEnvoyes(anciens, LUNDI(12)).length).toBeLessThan(anciens.length);
  });
});

describe('sérialisation des cours', () => {
  it('fait un aller-retour par les cours persistés', async () => {
    const { deps, enregistres } = monter({
      rafraichirCours: async () => new Map([['air-liquide', d('110.25')]]),
    });

    await executerReveil(deps);
    const relu = Decimal.de(enregistres[0].coursPrecedents['air-liquide']);

    expect(relu.eq(d('110.25'))).toBe(true);
  });
});
