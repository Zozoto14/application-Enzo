import { ouvrirBaseNode } from '../db/pilotes/node';
import { DepotComptes } from '../db/depots';
import { compte } from '../core/testing/fixtures';
import { aleatoireDeterministe } from '../securite/aleatoire';
import { ErreurDeverrouillage } from '../securite/coffre';
import type { ParametresKdf } from '../securite/kdf';
import { codeTotp } from '../securite/totp';
import { ErreurSession, ErreurTemporisation, Session } from './session';
import { stockageMemoire } from './stockage-coffre';

/** Paramètres allégés : ces tests vérifient l'enchaînement, pas Argon2id. */
const KDF_RAPIDE: ParametresKdf = {
  algorithme: 'argon2id',
  passes: 1,
  memoireKio: 64,
  fils: 1,
  longueurCle: 32,
};

const MOT_DE_PASSE = 'correct-cheval-batterie-agrafe';
const DEPART = 1_700_000_000_000;

function creerSession(options: { instant?: number } = {}) {
  let maintenant = options.instant ?? DEPART;
  const stockage = stockageMemoire();
  const basesOuvertes: string[] = [];

  const session = new Session({
    stockage,
    // node:sqlite ne connaît pas SQLCipher : la clé est enregistrée pour être
    // vérifiée par les tests, mais elle ne chiffre rien ici. Ce sont donc
    // l'enchaînement et la gestion de la clé qui sont testés, pas le
    // chiffrement lui-même, couvert par les tests du coffre.
    ouvrirBase: cle => {
      basesOuvertes.push(cle);
      return ouvrirBaseNode();
    },
    horloge: () => maintenant,
    alea: aleatoireDeterministe(1),
    kdf: KDF_RAPIDE,
  });

  return {
    session,
    stockage,
    basesOuvertes,
    avancer: (ms: number) => {
      maintenant += ms;
    },
    maintenant: () => maintenant,
  };
}

function demarrer() {
  const contexte = creerSession();
  const initialisation = contexte.session.initialiser({ motDePasse: MOT_DE_PASSE });
  return { ...contexte, initialisation };
}

describe('premier lancement', () => {
  it('part de l’état non initialisé', () => {
    expect(creerSession().session.statut()).toBe('non-initialise');
  });

  it('crée le coffre, le secret TOTP et les codes, puis ouvre la base', () => {
    const { session, initialisation, basesOuvertes } = demarrer();

    expect(session.statut()).toBe('deverrouille');
    expect(initialisation.codesRecuperation).toHaveLength(10);
    expect(initialisation.secretTotp).toMatch(/^[A-Z2-7]{32}$/);
    expect(initialisation.uriTotp).toContain('otpauth://totp/');
    expect(basesOuvertes).toHaveLength(1);
    expect(basesOuvertes[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('migre la base à l’ouverture', () => {
    const { session } = demarrer();
    // Si les migrations n'avaient pas tourné, cette écriture échouerait.
    new DepotComptes(session.base()).enregistrer(compte());
    expect(new DepotComptes(session.base()).tous()).toHaveLength(1);
  });

  it('persiste le coffre', () => {
    const { stockage } = demarrer();
    expect(stockage.lire()).toBeDefined();
  });

  it('refuse une seconde initialisation', () => {
    const { session } = demarrer();
    expect(() => session.initialiser({ motDePasse: 'autre' })).toThrow(ErreurSession);
  });
});

describe('déverrouillage', () => {
  it('accepte le bon mot de passe et le bon code', () => {
    const { session, initialisation, maintenant } = demarrer();
    session.verrouiller();
    expect(session.statut()).toBe('verrouille');

    session.deverrouiller({
      motDePasse: MOT_DE_PASSE,
      codeTotp: codeTotp(initialisation.secretTotp, maintenant()),
    });

    expect(session.statut()).toBe('deverrouille');
  });

  it('refuse un mot de passe faux', () => {
    const { session, initialisation, maintenant } = demarrer();
    session.verrouiller();

    expect(() =>
      session.deverrouiller({
        motDePasse: 'pas-le-bon',
        codeTotp: codeTotp(initialisation.secretTotp, maintenant()),
      }),
    ).toThrow(ErreurDeverrouillage);
    expect(session.statut()).toBe('verrouille');
  });

  it('refuse un code TOTP faux même avec le bon mot de passe', () => {
    const { session } = demarrer();
    session.verrouiller();

    expect(() =>
      session.deverrouiller({ motDePasse: MOT_DE_PASSE, codeTotp: '000000' }),
    ).toThrow(ErreurDeverrouillage);
    expect(session.statut()).toBe('verrouille');
  });

  it('ne dit pas lequel des deux facteurs est faux', () => {
    const { session, initialisation, maintenant } = demarrer();
    session.verrouiller();

    const motDePasseFaux = (() => {
      try {
        session.deverrouiller({
          motDePasse: 'faux',
          codeTotp: codeTotp(initialisation.secretTotp, maintenant()),
        });
      } catch (erreur) {
        return (erreur as Error).message;
      }
    })();

    const codeFaux = (() => {
      try {
        session.deverrouiller({ motDePasse: MOT_DE_PASSE, codeTotp: '000000' });
      } catch (erreur) {
        return (erreur as Error).message;
      }
    })();

    expect(motDePasseFaux).toBe(codeFaux);
  });

  it('accepte un code de la fenêtre précédente', () => {
    const { session, initialisation, maintenant, avancer } = demarrer();
    session.verrouiller();
    const code = codeTotp(initialisation.secretTotp, maintenant());

    avancer(30_000);
    expect(() =>
      session.deverrouiller({ motDePasse: MOT_DE_PASSE, codeTotp: code }),
    ).not.toThrow();
  });

  it('refuse un code périmé', () => {
    const { session, initialisation, maintenant, avancer } = demarrer();
    session.verrouiller();
    const code = codeTotp(initialisation.secretTotp, maintenant());

    avancer(120_000);
    expect(() =>
      session.deverrouiller({ motDePasse: MOT_DE_PASSE, codeTotp: code }),
    ).toThrow(ErreurDeverrouillage);
  });

  it('refuse toute tentative sur une application non initialisée', () => {
    const { session } = creerSession();
    expect(() =>
      session.deverrouiller({ motDePasse: MOT_DE_PASSE, codeTotp: '000000' }),
    ).toThrow(ErreurSession);
  });
});

describe('temporisation après échecs', () => {
  it('se déclenche après quatre échecs', () => {
    const { session } = demarrer();
    session.verrouiller();

    for (let i = 0; i < 4; i++) {
      expect(() =>
        session.deverrouiller({ motDePasse: 'faux', codeTotp: '000000' }),
      ).toThrow();
    }

    expect(session.verrou().verrouille).toBe(true);
  });

  it('refuse même les bons identifiants pendant la temporisation', () => {
    const { session, initialisation, maintenant } = demarrer();
    session.verrouiller();

    for (let i = 0; i < 6; i++) {
      try {
        session.deverrouiller({ motDePasse: 'faux', codeTotp: '000000' });
      } catch {
        // échec attendu
      }
    }

    expect(() =>
      session.deverrouiller({
        motDePasse: MOT_DE_PASSE,
        codeTotp: codeTotp(initialisation.secretTotp, maintenant()),
      }),
    ).toThrow(ErreurTemporisation);
  });

  it('laisse réessayer une fois la temporisation écoulée', () => {
    const { session, initialisation, maintenant, avancer } = demarrer();
    session.verrouiller();

    for (let i = 0; i < 4; i++) {
      try {
        session.deverrouiller({ motDePasse: 'faux', codeTotp: '000000' });
      } catch {
        // échec attendu
      }
    }

    avancer(10_000);
    session.deverrouiller({
      motDePasse: MOT_DE_PASSE,
      codeTotp: codeTotp(initialisation.secretTotp, maintenant()),
    });
    expect(session.statut()).toBe('deverrouille');
  });

  it('remet le compteur à zéro après un succès', () => {
    const { session, initialisation, maintenant, avancer } = demarrer();
    session.verrouiller();

    try {
      session.deverrouiller({ motDePasse: 'faux', codeTotp: '000000' });
    } catch {
      // échec attendu
    }

    avancer(1000);
    session.deverrouiller({
      motDePasse: MOT_DE_PASSE,
      codeTotp: codeTotp(initialisation.secretTotp, maintenant()),
    });
    session.verrouiller();

    expect(session.verrou().verrouille).toBe(false);
  });
});

describe('verrouillage', () => {
  it('ferme la base et interdit d’y accéder', () => {
    const { session } = demarrer();
    session.verrouiller();

    expect(() => session.base()).toThrow(/verrouillée/);
  });

  it('rouvre la même base après déverrouillage, sans perte de données', () => {
    // `verrouiller` remet aussi la clé à zéro en mémoire, mais cette remise à
    // zéro n'est pas observable depuis l'extérieur : elle relève de l'hygiène,
    // pas d'une garantie testable ici.
    const { session, basesOuvertes, initialisation, maintenant } = demarrer();
    const premiere = basesOuvertes[0];

    session.verrouiller();
    session.deverrouiller({
      motDePasse: MOT_DE_PASSE,
      codeTotp: codeTotp(initialisation.secretTotp, maintenant()),
    });

    // Même clé maîtresse, donc même base : le verrouillage n'a pas perdu les données.
    expect(basesOuvertes[1]).toBe(premiere);
  });
});

describe('raccourci biométrique', () => {
  it('est disponible après un déverrouillage récent', () => {
    const { session, avancer } = demarrer();
    avancer(5 * 60_000);
    expect(session.raccourciBiometriqueDisponible()).toBe(true);
  });

  it('expire passé la fenêtre', () => {
    const { session, avancer } = demarrer();
    avancer(16 * 60_000);
    expect(session.raccourciBiometriqueDisponible()).toBe(false);
  });

  it('est indisponible tant que rien n’est initialisé', () => {
    expect(creerSession().session.raccourciBiometriqueDisponible()).toBe(false);
  });

  it('redevient indisponible après un échec', () => {
    const { session } = demarrer();
    session.verrouiller();
    try {
      session.deverrouiller({ motDePasse: 'faux', codeTotp: '000000' });
    } catch {
      // échec attendu
    }
    expect(session.raccourciBiometriqueDisponible()).toBe(false);
  });
});

describe('récupération', () => {
  it('reprend la main avec un code et impose un nouveau mot de passe', () => {
    const { session, initialisation } = demarrer();
    session.verrouiller();

    const resultat = session.recuperer({
      codeRecuperation: initialisation.codesRecuperation[0],
      nouveauMotDePasse: 'nouveau-mot-de-passe',
    });

    expect(session.statut()).toBe('deverrouille');
    expect(resultat.codesRestants).toBe(9);
  });

  it('ouvre la même base qu’avant, donc ne perd pas les données', () => {
    const { session, initialisation, basesOuvertes } = demarrer();
    new DepotComptes(session.base()).enregistrer(compte());
    session.verrouiller();

    session.recuperer({
      codeRecuperation: initialisation.codesRecuperation[0],
      nouveauMotDePasse: 'nouveau-mot-de-passe',
    });

    expect(basesOuvertes[1]).toBe(basesOuvertes[0]);
  });

  it('rend l’ancien mot de passe inutilisable et le nouveau valide', () => {
    const { session, initialisation, maintenant } = demarrer();
    session.verrouiller();
    session.recuperer({
      codeRecuperation: initialisation.codesRecuperation[0],
      nouveauMotDePasse: 'nouveau-mot-de-passe',
    });
    session.verrouiller();

    const code = codeTotp(initialisation.secretTotp, maintenant());
    expect(() =>
      session.deverrouiller({ motDePasse: MOT_DE_PASSE, codeTotp: code }),
    ).toThrow(ErreurDeverrouillage);

    session.deverrouiller({ motDePasse: 'nouveau-mot-de-passe', codeTotp: code });
    expect(session.statut()).toBe('deverrouille');
  });

  it('consomme le code utilisé', () => {
    const { session, initialisation } = demarrer();
    session.verrouiller();
    session.recuperer({
      codeRecuperation: initialisation.codesRecuperation[0],
      nouveauMotDePasse: 'nouveau',
    });
    session.verrouiller();

    expect(() =>
      session.recuperer({
        codeRecuperation: initialisation.codesRecuperation[0],
        nouveauMotDePasse: 'encore-un-autre',
      }),
    ).toThrow(ErreurDeverrouillage);
  });

  it('conserve le secret TOTP', () => {
    const { session, initialisation, maintenant } = demarrer();
    session.verrouiller();
    session.recuperer({
      codeRecuperation: initialisation.codesRecuperation[0],
      nouveauMotDePasse: 'nouveau',
    });
    session.verrouiller();

    expect(() =>
      session.deverrouiller({
        motDePasse: 'nouveau',
        codeTotp: codeTotp(initialisation.secretTotp, maintenant()),
      }),
    ).not.toThrow();
  });

  it('compte un code faux comme un échec', () => {
    const { session } = demarrer();
    session.verrouiller();

    for (let i = 0; i < 4; i++) {
      try {
        session.recuperer({
          codeRecuperation: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ',
          nouveauMotDePasse: 'x',
        });
      } catch {
        // échec attendu
      }
    }
    expect(session.verrou().verrouille).toBe(true);
  });
});

describe('changement de mot de passe', () => {
  it('exige de connaître l’ancien', () => {
    const { session } = demarrer();
    expect(() => session.changerMotDePasse('pas-le-bon', 'nouveau')).toThrow(
      ErreurDeverrouillage,
    );
  });

  it('remplace l’ancien mot de passe', () => {
    const { session, initialisation, maintenant } = demarrer();
    session.changerMotDePasse(MOT_DE_PASSE, 'nouveau-mot-de-passe');
    session.verrouiller();

    const code = codeTotp(initialisation.secretTotp, maintenant());
    expect(() =>
      session.deverrouiller({ motDePasse: MOT_DE_PASSE, codeTotp: code }),
    ).toThrow(ErreurDeverrouillage);
    expect(() =>
      session.deverrouiller({ motDePasse: 'nouveau-mot-de-passe', codeTotp: code }),
    ).not.toThrow();
  });

  it('ne change pas la base ouverte', () => {
    const { session, initialisation, basesOuvertes, maintenant } = demarrer();
    session.changerMotDePasse(MOT_DE_PASSE, 'nouveau');
    session.verrouiller();
    session.deverrouiller({
      motDePasse: 'nouveau',
      codeTotp: codeTotp(initialisation.secretTotp, maintenant()),
    });

    expect(basesOuvertes[1]).toBe(basesOuvertes[0]);
  });
});

describe('renouvellement des codes de récupération', () => {
  it('invalide les anciens codes', () => {
    const { session, initialisation } = demarrer();
    const nouveaux = session.renouvelerCodesRecuperation(5);
    session.verrouiller();

    expect(nouveaux).toHaveLength(5);
    expect(() =>
      session.recuperer({
        codeRecuperation: initialisation.codesRecuperation[0],
        nouveauMotDePasse: 'x',
      }),
    ).toThrow(ErreurDeverrouillage);
  });

  it('exige une session déverrouillée', () => {
    const { session } = demarrer();
    session.verrouiller();
    expect(() => session.renouvelerCodesRecuperation()).toThrow(/verrouillée/);
  });
});
