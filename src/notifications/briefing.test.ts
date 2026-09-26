import { d } from '../core/money/decimal';
import { rejouer } from '../core/portfolio/engine';
import { achat, compte, titre, versement } from '../core/testing/fixtures';
import {
  alertesDeclenchees,
  composerBriefing,
  type EntreesBriefing,
  type SeuilAlerte,
} from './briefing';

const INSEC = ' ';
const FINE = ' ';
const pea = compte();
const airLiquide = titre();

function entrees(partiel: Partial<EntreesBriefing> = {}): EntreesBriefing {
  const etat = rejouer([pea], [versement('2026-01-05', 1000), achat('2026-01-10', 10, 100, 0)]);
  return {
    moment: 'soir',
    etat,
    titres: [airLiquide],
    cours: new Map([['air-liquide', d('110')]]),
    date: '2026-09-22',
    ...partiel,
  };
}

describe('composerBriefing', () => {
  it('annonce la valeur totale dans le titre', () => {
    // 10 titres a 110 plus 0 de liquidites restantes.
    const briefing = composerBriefing(entrees())!;

    expect(briefing.titre).toBe(`🌙 Clôture — 1${FINE}100,00${INSEC}€`);
  });

  it('distingue le matin du soir', () => {
    expect(composerBriefing(entrees({ moment: 'matin' }))!.titre).toMatch(
      /^☀️ Avant ouverture/,
    );
  });

  it('mentionne la plus-value latente', () => {
    const briefing = composerBriefing(entrees())!;
    expect(briefing.corps).toMatch(/Plus-value latente : \+100,00/);
  });

  it('mesure l’évolution depuis le point précédent', () => {
    const briefing = composerBriefing(entrees({ valeurPrecedente: d('1000') }))!;

    expect(briefing.corps).toMatch(/\+100,00.*depuis le dernier point/);
    expect(briefing.corps).toMatch(/\+10,00/);
  });

  it('nomme la ligne qui a le plus bougé, une information par ligne', () => {
    const briefing = composerBriefing(
      entrees({ valeurPrecedente: d('1000'), coursPrecedents: new Map([['air-liquide', d('100')]]) }),
    )!;
    expect(briefing.corps).toMatch(/🏆 Air Liquide \+10,00/);
    expect(briefing.corps.split('\n').length).toBeGreaterThanOrEqual(3);
    expect(briefing.corps).toMatch(/^▲ /);
  });

  it('porte un identifiant stable, pour remplacer le briefing du jour', () => {
    const briefing = composerBriefing(entrees())!;
    expect(briefing.identifiant).toBe('briefing-2026-09-22-soir');
  });

  describe('silences', () => {
    it('se tait quand la valeur n’a pas bougé d’un centime', () => {
      // Un briefing identique la veille et le lendemain finit par etre ignore,
      // et avec lui ceux qui comptent.
      expect(composerBriefing(entrees({ valeurPrecedente: d('1100') }))).toBeUndefined();
    });

    it('parle quand même si on le lui demande, en disant que rien n’a bougé', () => {
      const briefing = composerBriefing(entrees({ moment: 'matin', valeurPrecedente: d('1100'), toujours: true }))!;
      expect(briefing.corps).toMatch(/Stable depuis le dernier point : les marchés n’ont pas encore ouvert/);
    });

    it('parle pour une variation d’un centime', () => {
      expect(
        composerBriefing(entrees({ valeurPrecedente: d('1099.99') })),
      ).toBeDefined();
    });

    it('se tait sans compte', () => {
      const vide = rejouer([], []);
      expect(composerBriefing(entrees({ etat: vide }))).toBeUndefined();
    });

    it('se tait sur un portefeuille sans position ni liquidités', () => {
      const vide = rejouer([pea], []);
      expect(composerBriefing(entrees({ etat: vide }))).toBeUndefined();
    });

    it('parle d’un portefeuille sans position mais avec des liquidités', () => {
      const liquide = rejouer([pea], [versement('2026-01-05', 500)]);
      const briefing = composerBriefing(entrees({ etat: liquide, cours: new Map() }))!;

      expect(briefing.titre).toMatch(/500,00/);
    });
  });

  it('nomme les valeurs exclues du total faute de cours', () => {
    // Un total ampute sans explication vaut moins qu'un total absent.
    const briefing = composerBriefing(entrees({ cours: new Map() }))!;

    expect(briefing.corps).toMatch(/1 valeur\(s\) sans cours/);
    expect(briefing.corps).toMatch(/Air Liquide/);
  });
});

describe('alertesDeclenchees', () => {
  const titres = [airLiquide];
  const seuils: SeuilAlerte[] = [
    { titreId: 'air-liquide', haut: d('120'), bas: d('90') },
  ];

  const evaluer = (actuel: string, precedent?: string) =>
    alertesDeclenchees(
      seuils,
      new Map([['air-liquide', d(actuel)]]),
      precedent ? new Map([['air-liquide', d(precedent)]]) : new Map(),
      titres,
      '2026-09-22',
    );

  it('déclenche au franchissement du seuil haut', () => {
    const alertes = evaluer('125', '110');

    expect(alertes).toHaveLength(1);
    expect(alertes[0].sens).toBe('haut');
    expect(alertes[0].titre).toBe(`Air Liquide franchit 120,00${INSEC}€`);
    expect(alertes[0].corps).toMatch(/125,00/);
  });

  it('déclenche au franchissement du seuil bas', () => {
    const alertes = evaluer('85', '95');

    expect(alertes[0].sens).toBe('bas');
    expect(alertes[0].titre).toMatch(/passe sous 90,00/);
  });

  it('ne répète pas une alerte tant que le cours reste au-delà', () => {
    // Sans cette regle, une valeur durablement sous son seuil alerterait a
    // chaque verification, et l'utilisateur couperait tout.
    expect(evaluer('85', '80')).toEqual([]);
    expect(evaluer('125', '130')).toEqual([]);
  });

  it('déclenche sur le premier cours connu, faute de précédent', () => {
    expect(evaluer('125')).toHaveLength(1);
  });

  it('reste muet entre les seuils', () => {
    expect(evaluer('105', '100')).toEqual([]);
  });

  it('déclenche exactement au seuil', () => {
    expect(evaluer('120', '110')).toHaveLength(1);
    expect(evaluer('90', '95')).toHaveLength(1);
  });

  it('ignore un titre sans cours', () => {
    expect(
      alertesDeclenchees(seuils, new Map(), new Map(), titres, '2026-09-22'),
    ).toEqual([]);
  });

  it('accepte un seuil unilatéral', () => {
    const alertes = alertesDeclenchees(
      [{ titreId: 'air-liquide', bas: d('90') }],
      new Map([['air-liquide', d('200')]]),
      new Map([['air-liquide', d('100')]]),
      titres,
      '2026-09-22',
    );
    expect(alertes).toEqual([]);
  });

  it('porte un identifiant distinct par titre, sens et jour', () => {
    expect(evaluer('125', '110')[0].identifiant).toBe(
      'alerte-air-liquide-haut-2026-09-22',
    );
  });
});

describe('canal de notifications', () => {
  const {
    CANAL_INDISPONIBLE,
    canalDepuisNotifee,
    canalMemoire,
  } = require('./envoi');

  it('remplace une notification de même identifiant au lieu de l’empiler', async () => {
    // Trois briefings identiques dans le centre de notifications, et
    // l'utilisateur coupe tout.
    const canal = canalMemoire();

    await canal.afficher({ identifiant: 'b-1', titre: 'Matin', corps: '1 000 €' });
    await canal.afficher({ identifiant: 'b-1', titre: 'Matin', corps: '1 100 €' });

    expect(canal.envoyees).toHaveLength(1);
    expect(canal.envoyees[0].corps).toBe('1 100 €');
  });

  it('empile des notifications d’identifiants distincts', async () => {
    const canal = canalMemoire();
    await canal.afficher({ identifiant: 'b-1', titre: 'Matin', corps: 'x' });
    await canal.afficher({ identifiant: 'b-2', titre: 'Soir', corps: 'y' });

    expect(canal.envoyees).toHaveLength(2);
  });

  it('annule une notification', async () => {
    const canal = canalMemoire();
    await canal.afficher({ identifiant: 'b-1', titre: 'Matin', corps: 'x' });
    await canal.annuler('b-1');

    expect(canal.envoyees).toEqual([]);
  });

  describe('adaptation de notifee', () => {
    it('renvoie undefined quand le module est absent', () => {
      expect(canalDepuisNotifee(undefined)).toBeUndefined();
      expect(canalDepuisNotifee({})).toBeUndefined();
    });

    it('accepte le module exporté par défaut', () => {
      const faux = { default: { displayNotification: async () => undefined } };
      expect(canalDepuisNotifee(faux)?.disponible).toBe(true);
    });

    it('transmet titre et corps au système', async () => {
      const appels: unknown[] = [];
      const canal = canalDepuisNotifee({
        displayNotification: async (n: unknown) => void appels.push(n),
        createChannel: async () => undefined,
      })!;

      await canal.afficher({ identifiant: 'b-1', titre: 'Clôture', corps: '1 100 €' });

      expect(appels[0]).toMatchObject({
        id: 'b-1',
        title: 'Clôture',
        body: '1 100 €',
      });
    });

    it('ne crée le canal Android qu’une fois', async () => {
      let creations = 0;
      const canal = canalDepuisNotifee({
        displayNotification: async () => undefined,
        createChannel: async () => void creations++,
      })!;

      await canal.afficher({ identifiant: 'a', titre: 't', corps: 'c' });
      await canal.afficher({ identifiant: 'b', titre: 't', corps: 'c' });

      expect(creations).toBe(1);
    });

    it('traduit le refus de permission', async () => {
      const refus = canalDepuisNotifee({
        displayNotification: async () => undefined,
        requestPermission: async () => ({ authorizationStatus: 0 }),
      })!;
      expect(await refus.demanderPermission()).toBe(false);

      const accord = canalDepuisNotifee({
        displayNotification: async () => undefined,
        requestPermission: async () => ({ authorizationStatus: 1 }),
      })!;
      expect(await accord.demanderPermission()).toBe(true);
    });
  });

  it('expose un canal inerte quand le module manque', async () => {
    expect(CANAL_INDISPONIBLE.disponible).toBe(false);
    expect(await CANAL_INDISPONIBLE.demanderPermission()).toBe(false);
    // N'echoue pas : un appel sur un canal absent ne doit rien casser.
    await expect(
      CANAL_INDISPONIBLE.afficher({ identifiant: 'a', titre: 't', corps: 'c' }),
    ).resolves.toBeUndefined();
  });
});
