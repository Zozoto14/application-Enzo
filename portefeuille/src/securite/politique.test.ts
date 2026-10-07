import {
  ETAT_INITIAL,
  POLITIQUE_DEFAUT,
  apresEchec,
  apresSucces,
  evaluerVerrou,
  raccourciBiometriqueAutorise,
  temporisationApresEchecs,
} from './politique';

const MAINTENANT = 1_700_000_000_000;
const MINUTE = 60_000;

describe('raccourciBiometriqueAutorise', () => {
  it('refuse tant qu’aucune authentification complète n’a eu lieu', () => {
    expect(raccourciBiometriqueAutorise(ETAT_INITIAL, MAINTENANT)).toBe(false);
  });

  it('autorise une réouverture rapprochée', () => {
    const etat = apresSucces(MAINTENANT - 5 * MINUTE);
    expect(raccourciBiometriqueAutorise(etat, MAINTENANT)).toBe(true);
  });

  it('refuse passé la fenêtre', () => {
    const etat = apresSucces(MAINTENANT - 16 * MINUTE);
    expect(raccourciBiometriqueAutorise(etat, MAINTENANT)).toBe(false);
  });

  it('refuse juste après la limite, accepte juste avant', () => {
    const limite = POLITIQUE_DEFAUT.fenetreBiometrieMinutes * MINUTE;
    expect(raccourciBiometriqueAutorise(apresSucces(MAINTENANT - limite), MAINTENANT)).toBe(
      true,
    );
    expect(
      raccourciBiometriqueAutorise(apresSucces(MAINTENANT - limite - 1), MAINTENANT),
    ).toBe(false);
  });

  it('refuse si un échec est en cours', () => {
    const etat = apresEchec(apresSucces(MAINTENANT - MINUTE), MAINTENANT);
    expect(raccourciBiometriqueAutorise(etat, MAINTENANT)).toBe(false);
  });

  it('refuse si l’horloge a reculé', () => {
    // Sinon, reculer la date de l’appareil offrirait une fenêtre sans fin.
    const etat = apresSucces(MAINTENANT + MINUTE);
    expect(raccourciBiometriqueAutorise(etat, MAINTENANT)).toBe(false);
  });
});

describe('temporisationApresEchecs', () => {
  it('ne pénalise pas les premiers essais', () => {
    expect(temporisationApresEchecs(0)).toBe(0);
    expect(temporisationApresEchecs(3)).toBe(0);
  });

  it('croît de façon exponentielle ensuite', () => {
    expect(temporisationApresEchecs(4)).toBe(1);
    expect(temporisationApresEchecs(5)).toBe(2);
    expect(temporisationApresEchecs(6)).toBe(4);
    expect(temporisationApresEchecs(10)).toBe(64);
  });

  it('plafonne la temporisation', () => {
    // Sans plafond, une série d’erreurs de frappe condamnerait l’accès.
    expect(temporisationApresEchecs(50)).toBe(POLITIQUE_DEFAUT.temporisationMaxSecondes);
  });
});

describe('evaluerVerrou', () => {
  it('laisse passer quand aucune temporisation n’est due', () => {
    expect(evaluerVerrou(ETAT_INITIAL, MAINTENANT)).toEqual({
      verrouille: false,
      secondesRestantes: 0,
    });
  });

  it('verrouille pendant la temporisation et décompte', () => {
    const etat = { tentativesEchouees: 6, dernierEchecMs: MAINTENANT - 1000 };
    expect(evaluerVerrou(etat, MAINTENANT)).toEqual({
      verrouille: true,
      secondesRestantes: 3,
    });
  });

  it('libère une fois la temporisation écoulée', () => {
    const etat = { tentativesEchouees: 6, dernierEchecMs: MAINTENANT - 10_000 };
    expect(evaluerVerrou(etat, MAINTENANT).verrouille).toBe(false);
  });
});

describe('enchaînement des tentatives', () => {
  it('cumule les échecs puis repart à zéro après un succès', () => {
    let etat = ETAT_INITIAL;
    etat = apresEchec(etat, MAINTENANT);
    etat = apresEchec(etat, MAINTENANT + 1000);
    expect(etat.tentativesEchouees).toBe(2);

    etat = apresSucces(MAINTENANT + 2000);
    expect(etat.tentativesEchouees).toBe(0);
    expect(evaluerVerrou(etat, MAINTENANT + 2000).verrouille).toBe(false);
    expect(raccourciBiometriqueAutorise(etat, MAINTENANT + 2000)).toBe(true);
  });
});
