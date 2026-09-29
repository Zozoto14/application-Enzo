import { utf8ToBytes } from '@noble/hashes/utils.js';
import { aleatoireDeterministe } from './aleatoire';
import { versBase32 } from './encodage';
import {
  codeTotp,
  fenetreCourante,
  genererSecretTotp,
  uriOtpauth,
  verifierCodeTotp,
} from './totp';

/** Graine de la RFC 6238 pour SHA-1 : la chaîne ASCII « 12345678901234567890 ». */
const SECRET_RFC = versBase32(utf8ToBytes('12345678901234567890'));

describe('codeTotp', () => {
  it('reproduit les vecteurs de test de la RFC 6238', () => {
    // Ces six valeurs sont publiées dans l'annexe B de la RFC. Les reproduire
    // prouve que l'implémentation est conforme, donc interopérable avec
    // Google Authenticator.
    const vecteurs: Array<[number, string]> = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130'],
    ];

    for (const [secondes, attendu] of vecteurs) {
      expect(codeTotp(SECRET_RFC, secondes * 1000, { chiffres: 8 })).toBe(attendu);
    }
  });

  it('produit six chiffres par défaut', () => {
    expect(codeTotp(SECRET_RFC, 59_000)).toMatch(/^\d{6}$/);
  });

  it('conserve les zéros de tête', () => {
    // Le vecteur à T=1111111109 vaut 07081804 : un code tronqué en nombre
    // perdrait le zéro initial et deviendrait invalide.
    expect(codeTotp(SECRET_RFC, 1111111109 * 1000, { chiffres: 8 })).toBe('07081804');
  });

  it('change de code à chaque pas de temps', () => {
    const premier = codeTotp(SECRET_RFC, 0);
    const suivant = codeTotp(SECRET_RFC, 30_000);
    expect(premier).not.toBe(suivant);
  });

  it('reste stable à l’intérieur d’un même pas', () => {
    expect(codeTotp(SECRET_RFC, 0)).toBe(codeTotp(SECRET_RFC, 29_999));
  });

  it('accepte SHA-256 et SHA-512', () => {
    const sha256 = codeTotp(SECRET_RFC, 59_000, { algorithme: 'SHA256' });
    const sha512 = codeTotp(SECRET_RFC, 59_000, { algorithme: 'SHA512' });

    expect(sha256).toMatch(/^\d{6}$/);
    expect(sha512).toMatch(/^\d{6}$/);
    expect(sha256).not.toBe(sha512);
  });
});

describe('fenetreCourante', () => {
  it('découpe le temps en pas de 30 secondes', () => {
    expect(fenetreCourante(0)).toBe(0);
    expect(fenetreCourante(29_999)).toBe(0);
    expect(fenetreCourante(30_000)).toBe(1);
    expect(fenetreCourante(59_000)).toBe(1);
  });
});

describe('verifierCodeTotp', () => {
  const instant = 1_700_000_000_000;

  it('accepte le code de la fenêtre courante', () => {
    expect(verifierCodeTotp(SECRET_RFC, codeTotp(SECRET_RFC, instant), instant)).toBe(
      true,
    );
  });

  it('tolère une dérive d’horloge d’un pas', () => {
    const precedent = codeTotp(SECRET_RFC, instant - 30_000);
    const suivant = codeTotp(SECRET_RFC, instant + 30_000);

    expect(verifierCodeTotp(SECRET_RFC, precedent, instant)).toBe(true);
    expect(verifierCodeTotp(SECRET_RFC, suivant, instant)).toBe(true);
  });

  it('refuse au-delà de la fenêtre de tolérance', () => {
    const tropVieux = codeTotp(SECRET_RFC, instant - 90_000);
    expect(verifierCodeTotp(SECRET_RFC, tropVieux, instant)).toBe(false);
  });

  it('resserre la tolérance quand on le demande', () => {
    const precedent = codeTotp(SECRET_RFC, instant - 30_000);
    expect(verifierCodeTotp(SECRET_RFC, precedent, instant, { fenetre: 0 })).toBe(false);
  });

  it('refuse un code faux', () => {
    expect(verifierCodeTotp(SECRET_RFC, '000000', instant)).toBe(false);
  });

  it('ignore les espaces de saisie', () => {
    const code = codeTotp(SECRET_RFC, instant);
    const espace = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect(verifierCodeTotp(SECRET_RFC, espace, instant)).toBe(true);
  });

  it('refuse un code de la bonne longueur mais d’un autre secret', () => {
    const autre = genererSecretTotp(aleatoireDeterministe(7));
    expect(verifierCodeTotp(SECRET_RFC, codeTotp(autre, instant), instant)).toBe(false);
  });
});

describe('genererSecretTotp', () => {
  it('produit un secret de 160 bits en base32', () => {
    const secret = genererSecretTotp(aleatoireDeterministe(1));
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('produit un secret différent à chaque graine', () => {
    expect(genererSecretTotp(aleatoireDeterministe(1))).not.toBe(
      genererSecretTotp(aleatoireDeterministe(2)),
    );
  });
});

describe('uriOtpauth', () => {
  it('compose une URI lisible par les applications d’authentification', () => {
    const uri = uriOtpauth({ secret: SECRET_RFC, compte: 'moi@exemple.fr' });

    expect(uri).toContain('otpauth://totp/AppliBourse:moi%40exemple.fr');
    expect(uri).toContain(`secret=${SECRET_RFC}`);
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });

  it('échappe un émetteur contenant des caractères réservés', () => {
    const uri = uriOtpauth({
      secret: SECRET_RFC,
      compte: 'moi',
      emetteur: 'Appli Bourse & Co',
    });
    expect(uri).toContain('otpauth://totp/Appli%20Bourse%20%26%20Co:moi');
  });
});
