import { utf8ToBytes } from '@noble/hashes/utils.js';
import {
  TAILLE_MAXIMALE_DEFAUT,
  VERSION_FORMAT,
  corpsSigne,
  empreinteDe,
  genererClesSignature,
  signerPaquet,
  verifierPaquet,
  type Manifeste,
} from './manifeste';

const CLES = genererClesSignature();
const AUTRES_CLES = genererClesSignature();
const PAQUET = utf8ToBytes('var app = 1; // paquet javascript');

function signer(version = 2): Manifeste {
  return signerPaquet(PAQUET, {
    version,
    date: '2026-09-22',
    clePrivee: CLES.privee,
    notes: 'Tableau de bord enrichi',
  });
}

const contexte = (versionInstallee = 1) => ({
  clePublique: CLES.publique,
  versionInstallee,
});

describe('genererClesSignature', () => {
  it('produit une paire utilisable', () => {
    expect(CLES.privee).toMatch(/^[0-9a-f]{64}$/);
    expect(CLES.publique).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produit une paire différente à chaque appel', () => {
    expect(genererClesSignature().privee).not.toBe(genererClesSignature().privee);
  });
});

describe('corpsSigne', () => {
  it('ne dépend pas de l’ordre des clés de l’objet', () => {
    // La signature doit survivre au passage du PC à l'appareil, où l'ordre
    // d'énumération d'un objet n'est pas garanti identique.
    const champs = { format: 1, version: 2, date: '2026-09-22', empreinte: 'ab', taille: 3 };
    const inverse = { taille: 3, empreinte: 'ab', date: '2026-09-22', version: 2, format: 1 };

    expect(corpsSigne(champs)).toEqual(corpsSigne(inverse));
  });
});

describe('signerPaquet', () => {
  it('décrit fidèlement le paquet', () => {
    const manifeste = signer();

    expect(manifeste.format).toBe(VERSION_FORMAT);
    expect(manifeste.version).toBe(2);
    expect(manifeste.taille).toBe(PAQUET.length);
    expect(manifeste.empreinte).toBe(empreinteDe(PAQUET));
    expect(manifeste.signature).toMatch(/^[0-9a-f]{128}$/);
    expect(manifeste.notes).toBe('Tableau de bord enrichi');
  });

  it('refuse un numéro de version absurde', () => {
    expect(() =>
      signerPaquet(PAQUET, { version: 0, date: '2026-09-22', clePrivee: CLES.privee }),
    ).toThrow(/version invalide/);
  });
});

describe('verifierPaquet', () => {
  it('accepte un paquet authentique et plus récent', () => {
    expect(verifierPaquet(PAQUET, signer(), contexte())).toEqual({ valide: true });
  });

  it('refuse un paquet signé par une autre clé', () => {
    // Le cas qui compte vraiment : du code injecté dans une application qui
    // détient la clé de chiffrement du portefeuille.
    const intrus = signerPaquet(PAQUET, {
      version: 2,
      date: '2026-09-22',
      clePrivee: AUTRES_CLES.privee,
    });

    const resultat = verifierPaquet(PAQUET, intrus, contexte());
    expect(resultat.valide).toBe(false);
    expect(resultat.motif).toMatch(/Signature invalide/);
  });

  it('refuse un paquet modifié après signature', () => {
    const manifeste = signer();
    const altere = utf8ToBytes('var app = 1; // paquet javascript MODIFIE');

    const resultat = verifierPaquet(altere, manifeste, contexte());
    expect(resultat.valide).toBe(false);
    // La taille change ici ; le test suivant couvre le cas à taille égale.
    expect(resultat.motif).toBeDefined();
  });

  it('refuse une modification qui conserve la taille', () => {
    const manifeste = signer();
    const memeTaille = utf8ToBytes('var app = 9; // paquet javascript');
    expect(memeTaille.length).toBe(PAQUET.length);

    const resultat = verifierPaquet(memeTaille, manifeste, contexte());
    expect(resultat.motif).toMatch(/empreinte/i);
  });

  it('refuse un manifeste dont l’empreinte a été réécrite', () => {
    // Réécrire l'empreinte invalide la signature, qui porte dessus.
    const manifeste = { ...signer(), empreinte: empreinteDe(utf8ToBytes('autre')) };
    const resultat = verifierPaquet(PAQUET, manifeste, contexte());

    expect(resultat.valide).toBe(false);
  });

  describe('rejeu', () => {
    it('refuse une version antérieure', () => {
      const resultat = verifierPaquet(PAQUET, signer(2), contexte(5));
      expect(resultat.motif).toMatch(/pas plus récent/);
    });

    it('refuse la version déjà installée', () => {
      // Sans cette règle, un ancien paquet authentique pourrait être
      // réinstallé pour ramener une faille déjà corrigée.
      const resultat = verifierPaquet(PAQUET, signer(3), contexte(3));
      expect(resultat.valide).toBe(false);
    });
  });

  describe('garde-fous', () => {
    it('refuse un format de manifeste inconnu', () => {
      const resultat = verifierPaquet(PAQUET, { ...signer(), format: 99 }, contexte());
      expect(resultat.motif).toMatch(/Format de manifeste inconnu/);
    });

    it('refuse une taille annoncée fausse', () => {
      const resultat = verifierPaquet(PAQUET, { ...signer(), taille: 12 }, contexte());
      expect(resultat.motif).toMatch(/taille/i);
    });

    it('refuse un paquet vide', () => {
      const vide = new Uint8Array(0);
      const manifeste = signerPaquet(vide, {
        version: 2,
        date: '2026-09-22',
        clePrivee: CLES.privee,
      });
      expect(verifierPaquet(vide, manifeste, contexte()).motif).toMatch(/aberrante/);
    });

    it('refuse un paquet au-delà de la taille maximale', () => {
      const resultat = verifierPaquet(PAQUET, signer(), {
        ...contexte(),
        tailleMaximale: 5,
      });
      expect(resultat.motif).toMatch(/aberrante/);
    });

    it('refuse une signature illisible', () => {
      const resultat = verifierPaquet(
        PAQUET,
        { ...signer(), signature: 'pas de l’hexadécimal' },
        contexte(),
      );
      expect(resultat.motif).toMatch(/illisible/);
    });

    it('expose une taille maximale raisonnable', () => {
      expect(TAILLE_MAXIMALE_DEFAUT).toBe(32 * 1024 * 1024);
    });
  });
});
