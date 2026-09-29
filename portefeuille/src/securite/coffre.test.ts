import { bytesToHex } from '@noble/hashes/utils.js';
import { aleatoireDeterministe } from './aleatoire';
import {
  ErreurDeverrouillage,
  LONGUEUR_CLE_MAITRESSE,
  changerMotDePasse,
  cleHexadecimale,
  creerCoffre,
  definirSecretTotp,
  deverrouillerParCodeRecuperation,
  deverrouillerParMotDePasse,
  lireSecretTotp,
  regenererCodesRecuperation,
  type Coffre,
} from './coffre';
import type { ParametresKdf } from './kdf';

/**
 * Paramètres allégés : les tests vérifient la mécanique du coffre, pas la
 * résistance d'Argon2id. Un test vérifie séparément que les paramètres réels
 * fonctionnent.
 */
const KDF_RAPIDE: ParametresKdf = {
  algorithme: 'argon2id',
  passes: 1,
  memoireKio: 64,
  fils: 1,
  longueurCle: 32,
};

const MOT_DE_PASSE = 'correct-cheval-batterie-agrafe';

function creer(graine = 1, nombreCodes = 3) {
  return creerCoffre({
    motDePasse: MOT_DE_PASSE,
    nombreCodes,
    kdf: KDF_RAPIDE,
    alea: aleatoireDeterministe(graine),
  });
}

describe('creerCoffre', () => {
  it('produit une clé maîtresse de 256 bits', () => {
    const { cleMaitresse } = creer();
    expect(cleMaitresse).toHaveLength(LONGUEUR_CLE_MAITRESSE);
  });

  it('crée une enveloppe par moyen de déverrouillage', () => {
    const { coffre } = creer(1, 5);

    expect(coffre.enveloppes.filter(e => e.usage === 'motdepasse')).toHaveLength(1);
    expect(coffre.enveloppes.filter(e => e.usage === 'recuperation')).toHaveLength(5);
  });

  it('donne un sel distinct à chaque enveloppe', () => {
    const { coffre } = creer(1, 5);
    const sels = coffre.enveloppes.map(e => e.sel);
    expect(new Set(sels).size).toBe(sels.length);
  });

  it('ne laisse apparaître ni le mot de passe ni la clé maîtresse', () => {
    const { coffre, cleMaitresse } = creer();
    const serialise = JSON.stringify(coffre);

    expect(serialise).not.toContain(MOT_DE_PASSE);
    expect(serialise).not.toContain(bytesToHex(cleMaitresse));
  });

  it('fonctionne avec les paramètres Argon2id réels', () => {
    const { coffre, cleMaitresse } = creerCoffre({
      motDePasse: MOT_DE_PASSE,
      nombreCodes: 1,
    });
    expect(deverrouillerParMotDePasse(coffre, MOT_DE_PASSE)).toEqual(cleMaitresse);
  });
});

describe('deverrouillerParMotDePasse', () => {
  it('restitue exactement la clé maîtresse', () => {
    const { coffre, cleMaitresse } = creer();
    expect(deverrouillerParMotDePasse(coffre, MOT_DE_PASSE)).toEqual(cleMaitresse);
  });

  it('refuse un mot de passe faux', () => {
    const { coffre } = creer();
    expect(() => deverrouillerParMotDePasse(coffre, 'pas-le-bon')).toThrow(
      ErreurDeverrouillage,
    );
  });

  it('refuse un mot de passe presque juste', () => {
    const { coffre } = creer();
    expect(() => deverrouillerParMotDePasse(coffre, `${MOT_DE_PASSE} `)).toThrow(
      ErreurDeverrouillage,
    );
  });

  it('détecte une enveloppe altérée', () => {
    const { coffre } = creer();
    const altere: Coffre = {
      ...coffre,
      enveloppes: coffre.enveloppes.map(enveloppe =>
        enveloppe.usage === 'motdepasse'
          ? { ...enveloppe, charge: `00${enveloppe.charge.slice(2)}` }
          : enveloppe,
      ),
    };

    // Le sceau Poly1305 fait échouer le déchiffrement : une enveloppe modifiée
    // ne peut pas produire une clé maîtresse silencieusement fausse.
    expect(() => deverrouillerParMotDePasse(altere, MOT_DE_PASSE)).toThrow(
      ErreurDeverrouillage,
    );
  });

  it('n’accepte pas un code de récupération comme mot de passe', () => {
    const { coffre, codesRecuperation } = creer();
    expect(() => deverrouillerParMotDePasse(coffre, codesRecuperation[0])).toThrow(
      ErreurDeverrouillage,
    );
  });
});

describe('deverrouillerParCodeRecuperation', () => {
  it('ouvre le coffre avec la même clé maîtresse que le mot de passe', () => {
    const { coffre, codesRecuperation, cleMaitresse } = creer();
    const resultat = deverrouillerParCodeRecuperation(coffre, codesRecuperation[1]);

    expect(resultat.cleMaitresse).toEqual(cleMaitresse);
  });

  it('consomme le code utilisé', () => {
    const { coffre, codesRecuperation } = creer(1, 3);
    const resultat = deverrouillerParCodeRecuperation(coffre, codesRecuperation[0]);

    expect(resultat.codesRestants).toBe(2);
    expect(() =>
      deverrouillerParCodeRecuperation(resultat.coffre, codesRecuperation[0]),
    ).toThrow(ErreurDeverrouillage);
  });

  it('laisse les autres codes utilisables', () => {
    const { coffre, codesRecuperation, cleMaitresse } = creer(1, 3);
    const premier = deverrouillerParCodeRecuperation(coffre, codesRecuperation[0]);
    const second = deverrouillerParCodeRecuperation(
      premier.coffre,
      codesRecuperation[1],
    );

    expect(second.cleMaitresse).toEqual(cleMaitresse);
    expect(second.codesRestants).toBe(1);
  });

  it('tolère la casse, les tirets et les confusions de lecture', () => {
    const { coffre, cleMaitresse, codesRecuperation } = creer();
    const recopie = codesRecuperation[0].toLowerCase().replace(/-/g, ' ');

    expect(deverrouillerParCodeRecuperation(coffre, recopie).cleMaitresse).toEqual(
      cleMaitresse,
    );
  });

  it('refuse un code inventé', () => {
    const { coffre } = creer();
    expect(() =>
      deverrouillerParCodeRecuperation(coffre, 'ZZZZ-ZZZZ-ZZZZ-ZZZZ'),
    ).toThrow(ErreurDeverrouillage);
  });
});

describe('changerMotDePasse', () => {
  it('ouvre avec le nouveau mot de passe et plus avec l’ancien', () => {
    const { coffre, cleMaitresse } = creer();
    const modifie = changerMotDePasse(coffre, cleMaitresse, 'nouveau-mot-de-passe', {
      kdf: KDF_RAPIDE,
      alea: aleatoireDeterministe(99),
    });

    expect(deverrouillerParMotDePasse(modifie, 'nouveau-mot-de-passe')).toEqual(
      cleMaitresse,
    );
    expect(() => deverrouillerParMotDePasse(modifie, MOT_DE_PASSE)).toThrow(
      ErreurDeverrouillage,
    );
  });

  it('ne change pas la clé maîtresse, donc ne touche pas à la base', () => {
    const { coffre, cleMaitresse } = creer();
    const modifie = changerMotDePasse(coffre, cleMaitresse, 'autre', {
      kdf: KDF_RAPIDE,
      alea: aleatoireDeterministe(99),
    });

    expect(cleHexadecimale(deverrouillerParMotDePasse(modifie, 'autre'))).toBe(
      cleHexadecimale(cleMaitresse),
    );
  });

  it('laisse les codes de récupération valides', () => {
    const { coffre, cleMaitresse, codesRecuperation } = creer();
    const modifie = changerMotDePasse(coffre, cleMaitresse, 'autre', {
      kdf: KDF_RAPIDE,
      alea: aleatoireDeterministe(99),
    });

    expect(
      deverrouillerParCodeRecuperation(modifie, codesRecuperation[0]).cleMaitresse,
    ).toEqual(cleMaitresse);
  });

  it('garde une seule enveloppe de mot de passe', () => {
    const { coffre, cleMaitresse } = creer();
    const modifie = changerMotDePasse(coffre, cleMaitresse, 'autre', {
      kdf: KDF_RAPIDE,
      alea: aleatoireDeterministe(99),
    });

    expect(modifie.enveloppes.filter(e => e.usage === 'motdepasse')).toHaveLength(1);
  });
});

describe('regenererCodesRecuperation', () => {
  it('invalide les anciens codes et active les nouveaux', () => {
    const { coffre, cleMaitresse, codesRecuperation } = creer(1, 3);
    const { coffre: renouvele, codesRecuperation: nouveaux } =
      regenererCodesRecuperation(coffre, cleMaitresse, {
        nombreCodes: 4,
        kdf: KDF_RAPIDE,
        alea: aleatoireDeterministe(42),
      });

    expect(nouveaux).toHaveLength(4);
    expect(() =>
      deverrouillerParCodeRecuperation(renouvele, codesRecuperation[0]),
    ).toThrow(ErreurDeverrouillage);
    expect(deverrouillerParCodeRecuperation(renouvele, nouveaux[0]).cleMaitresse).toEqual(
      cleMaitresse,
    );
  });

  it('laisse le mot de passe inchangé', () => {
    const { coffre, cleMaitresse } = creer();
    const { coffre: renouvele } = regenererCodesRecuperation(coffre, cleMaitresse, {
      kdf: KDF_RAPIDE,
      alea: aleatoireDeterministe(42),
    });

    expect(deverrouillerParMotDePasse(renouvele, MOT_DE_PASSE)).toEqual(cleMaitresse);
  });
});

describe('secret TOTP', () => {
  it('se scelle avec la clé maîtresse et se relit', () => {
    const { coffre, cleMaitresse } = creer();
    const avecTotp = definirSecretTotp(
      coffre,
      cleMaitresse,
      'JBSWY3DPEHPK3PXP',
      aleatoireDeterministe(5),
    );

    expect(lireSecretTotp(avecTotp, cleMaitresse)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('n’apparaît pas en clair dans le coffre', () => {
    const { coffre, cleMaitresse } = creer();
    const avecTotp = definirSecretTotp(
      coffre,
      cleMaitresse,
      'JBSWY3DPEHPK3PXP',
      aleatoireDeterministe(5),
    );

    expect(JSON.stringify(avecTotp)).not.toContain('JBSWY3DPEHPK3PXP');
  });

  it('renvoie undefined quand aucun secret n’est enregistré', () => {
    const { coffre, cleMaitresse } = creer();
    expect(lireSecretTotp(coffre, cleMaitresse)).toBeUndefined();
  });
});

describe('sérialisation', () => {
  it('survit à un aller-retour JSON', () => {
    const { coffre, cleMaitresse } = creer();
    const relu: Coffre = JSON.parse(JSON.stringify(coffre));

    expect(deverrouillerParMotDePasse(relu, MOT_DE_PASSE)).toEqual(cleMaitresse);
  });
});

describe('mot de passe long généré par un gestionnaire', () => {
  /**
   * Reproduit exactement le réglage Bitwarden visé : 128 caractères, majuscules,
   * minuscules, chiffres et caractères spéciaux, avec au moins 9 chiffres et
   * 9 caractères spéciaux.
   */
  function motDePasseGenere(graine: number): string {
    const alea = aleatoireDeterministe(graine);
    const MAJUSCULES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const MINUSCULES = 'abcdefghijklmnopqrstuvwxyz';
    const CHIFFRES = '0123456789';
    const SPECIAUX = '!@#$%^&*';
    const TOUT = MAJUSCULES + MINUSCULES + CHIFFRES + SPECIAUX;

    const octets = alea(128);
    const caracteres = [...octets].map(octet => TOUT[octet % TOUT.length]);

    // Garantit les minimums, comme le fait le générateur.
    for (let i = 0; i < 9; i++) {
      caracteres[i] = CHIFFRES[octets[i] % CHIFFRES.length];
      caracteres[i + 9] = SPECIAUX[octets[i + 9] % SPECIAUX.length];
    }
    return caracteres.join('');
  }

  const LONG = motDePasseGenere(42);

  it('respecte bien les contraintes du générateur', () => {
    expect(LONG).toHaveLength(128);
    expect((LONG.match(/[0-9]/g) ?? []).length).toBeGreaterThanOrEqual(9);
    expect((LONG.match(/[!@#$%^&*]/g) ?? []).length).toBeGreaterThanOrEqual(9);
    expect(LONG).toMatch(/[A-Z]/);
    expect(LONG).toMatch(/[a-z]/);
  });

  it('protège et rouvre le coffre', () => {
    // Aucune longueur maximale nulle part : ni dans la dérivation, ni dans les
    // champs de saisie, ni dans le coffre.
    const { coffre, cleMaitresse } = creerCoffre({
      motDePasse: LONG,
      nombreCodes: 2,
      kdf: KDF_RAPIDE,
      alea: aleatoireDeterministe(7),
    });

    expect(deverrouillerParMotDePasse(coffre, LONG)).toEqual(cleMaitresse);
  });

  it('refuse un mot de passe qui ne diffère que d’un caractère', () => {
    const { coffre } = creerCoffre({
      motDePasse: LONG,
      nombreCodes: 1,
      kdf: KDF_RAPIDE,
      alea: aleatoireDeterministe(7),
    });

    const presque = `${LONG.slice(0, 127)}${LONG[127] === 'A' ? 'B' : 'A'}`;
    expect(presque).toHaveLength(128);
    expect(() => deverrouillerParMotDePasse(coffre, presque)).toThrow(
      ErreurDeverrouillage,
    );
  });

  it('reste compatible avec les caractères spéciaux et le changement de mot de passe', () => {
    const { coffre, cleMaitresse } = creerCoffre({
      motDePasse: LONG,
      nombreCodes: 1,
      kdf: KDF_RAPIDE,
      alea: aleatoireDeterministe(7),
    });

    const autre = motDePasseGenere(99);
    const modifie = changerMotDePasse(coffre, cleMaitresse, autre, {
      kdf: KDF_RAPIDE,
      alea: aleatoireDeterministe(8),
    });

    expect(deverrouillerParMotDePasse(modifie, autre)).toEqual(cleMaitresse);
    expect(() => deverrouillerParMotDePasse(modifie, LONG)).toThrow(
      ErreurDeverrouillage,
    );
  });
});
