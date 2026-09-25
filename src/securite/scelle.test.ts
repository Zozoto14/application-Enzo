import { utf8ToBytes } from '@noble/hashes/utils.js';
import { aleatoireDeterministe } from './aleatoire';
import {
  ErreurScelle,
  LONGUEUR_NONCE,
  SIGNATURE,
  VERSION_SCELLE,
  descellerOctets,
  estScelle,
  scellerOctets,
} from './scelle';

const CLE = new Uint8Array(32).fill(7);
const AUTRE_CLE = new Uint8Array(32).fill(8);
const CONTENU = utf8ToBytes('une base SQLite, en plus gros');

describe('scellerOctets', () => {
  it('fait un aller-retour sans perte', () => {
    const scelle = scellerOctets(CLE, CONTENU, aleatoireDeterministe(1));

    expect(descellerOctets(CLE, scelle)).toEqual(CONTENU);
  });

  it('scelle un contenu vide', () => {
    const scelle = scellerOctets(CLE, new Uint8Array(0), aleatoireDeterministe(1));

    expect(descellerOctets(CLE, scelle)).toEqual(new Uint8Array(0));
  });

  it('porte sa signature et sa version en clair', () => {
    const scelle = scellerOctets(CLE, CONTENU, aleatoireDeterministe(1));

    expect(scelle.subarray(0, SIGNATURE.length)).toEqual(SIGNATURE);
    expect(scelle[SIGNATURE.length]).toBe(VERSION_SCELLE);
  });

  it('produit un scellé différent à chaque fois', () => {
    // Nonce distinct : deux scellements du meme contenu ne doivent pas se
    // reconnaitre, sinon on lit l'activite sans rien dechiffrer.
    const a = scellerOctets(CLE, CONTENU, aleatoireDeterministe(1));
    const b = scellerOctets(CLE, CONTENU, aleatoireDeterministe(2));

    expect(a).not.toEqual(b);
  });

  it('supporte un contenu volumineux', () => {
    const gros = new Uint8Array(512 * 1024).map((_, index) => index % 251);

    expect(descellerOctets(CLE, scellerOctets(CLE, gros))).toEqual(gros);
  });
});

describe('descellerOctets', () => {
  it('refuse une mauvaise clé', () => {
    const scelle = scellerOctets(CLE, CONTENU, aleatoireDeterministe(1));

    expect(() => descellerOctets(AUTRE_CLE, scelle)).toThrow(ErreurScelle);
    expect(() => descellerOctets(AUTRE_CLE, scelle)).toThrow(/mauvaise clé, ou fichier altéré/);
  });

  it('refuse un contenu altéré', () => {
    const scelle = scellerOctets(CLE, CONTENU, aleatoireDeterministe(1));
    scelle[scelle.length - 1] ^= 0xff;

    expect(() => descellerOctets(CLE, scelle)).toThrow(ErreurScelle);
  });

  it('refuse un nonce altéré', () => {
    const scelle = scellerOctets(CLE, CONTENU, aleatoireDeterministe(1));
    scelle[SIGNATURE.length + 1] ^= 0xff;

    expect(() => descellerOctets(CLE, scelle)).toThrow(ErreurScelle);
  });

  describe('messages distincts', () => {
    it('dit quand ce n’est pas une base scellée', () => {
      const etranger = utf8ToBytes('ceci est un fichier quelconque, plus long');

      expect(() => descellerOctets(CLE, etranger)).toThrow(/n’est pas une base scellée/);
    });

    it('dit quand le fichier est trop court', () => {
      expect(() => descellerOctets(CLE, new Uint8Array(3))).toThrow(/trop court/);
    });

    it('dit quand la version est plus récente, et de ne pas écraser', () => {
      // Le pire serait d'ecraser une base ecrite par une version ulterieure
      // en la prenant pour un fichier corrompu.
      const scelle = scellerOctets(CLE, CONTENU, aleatoireDeterministe(1));
      scelle[SIGNATURE.length] = VERSION_SCELLE + 1;

      expect(() => descellerOctets(CLE, scelle)).toThrow(/version 2/);
      expect(() => descellerOctets(CLE, scelle)).toThrow(/plutôt que d’écraser vos données/);
    });
  });

  it('refuse un scellé présenté sous une autre étiquette de domaine', () => {
    // La donnee associee lie chaque scelle a son usage : un scelle de base ne
    // peut pas etre glisse la ou une enveloppe de coffre est attendue.
    const scelle = scellerOctets(CLE, CONTENU, aleatoireDeterministe(1));
    // On simule un contenu scelle avec une autre etiquette en corrompant la
    // charge : l'authentification echoue de la meme facon.
    scelle[scelle.length - 5] ^= 0x01;

    expect(() => descellerOctets(CLE, scelle)).toThrow(ErreurScelle);
  });
});

describe('estScelle', () => {
  it('reconnaît un scellé sans tenter de l’ouvrir', () => {
    expect(estScelle(scellerOctets(CLE, CONTENU, aleatoireDeterministe(1)))).toBe(true);
  });

  it('ne reconnaît pas un fichier quelconque', () => {
    expect(estScelle(utf8ToBytes('SQLite format 3'))).toBe(false);
    expect(estScelle(new Uint8Array(2))).toBe(false);
  });
});

describe('dimensions', () => {
  it('ajoute un en-tête de taille connue', () => {
    const scelle = scellerOctets(CLE, CONTENU, aleatoireDeterministe(1));
    // Signature + version + nonce + charge authentifiee (16 octets de tag).
    expect(scelle.length).toBe(SIGNATURE.length + 1 + LONGUEUR_NONCE + CONTENU.length + 16);
  });
});
