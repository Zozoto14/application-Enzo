import { titre } from '../../core/testing/fixtures';
import { ACCUEIL_BAGGR, erreurLien, lienValide, liensDe } from './liens';

const FICHE = 'https://app.baggr.fr/screener/1c7a9641-8abb-44f8-bd47-7874aa8cbf91';

describe('lienValide', () => {
  it('accepte une adresse web', () => {
    expect(lienValide(FICHE)).toBe(true);
    expect(lienValide('http://exemple.fr')).toBe(true);
  });

  it('refuse ce qui n’est pas une adresse', () => {
    expect(lienValide('')).toBe(false);
    expect(lienValide('app.baggr.fr/screener/abc')).toBe(false);
  });

  it('refuse un protocole exécutable', () => {
    // Le lien finira dans un `openURL` : un `javascript:` n'a rien a y faire,
    // meme sur sa propre machine.
    expect(lienValide('javascript:alert(1)')).toBe(false);
    expect(lienValide('file:///C:/Windows')).toBe(false);
  });

  it('tolère les espaces autour', () => {
    expect(lienValide(`  ${FICHE}  `)).toBe(true);
  });
});

describe('erreurLien', () => {
  it('ne dit rien sur un champ vide', () => {
    expect(erreurLien('')).toBeUndefined();
  });

  it('ne dit rien sur une adresse correcte', () => {
    expect(erreurLien(FICHE)).toBeUndefined();
  });

  it('explique ce qui est attendu', () => {
    expect(erreurLien('baggr')).toBe('Adresse attendue, commençant par https://');
  });
});

describe('liensDe', () => {
  describe('Baggr', () => {
    it('mène à la fiche exacte quand elle a été collée', () => {
      const vue = liensDe(titre({ lienExterne: FICHE }));
      const baggr = vue.find(lien => lien.cle === 'baggr')!;

      expect(baggr.url).toBe(FICHE);
      expect(baggr.libelle).toBe('Fiche Baggr');
      expect(baggr.direct).toBe(true);
    });

    it('renvoie à l’accueil tant qu’aucune fiche n’est collée', () => {
      // L'adresse d'une fiche est un identifiant opaque : la fabriquer
      // ouvrirait une page au hasard.
      const baggr = liensDe(titre())[0];

      expect(baggr.url).toBe(ACCUEIL_BAGGR);
      expect(baggr.direct).toBe(false);
      expect(baggr.aQuoiCaSert).toMatch(/Collez l’adresse de la fiche une fois/);
    });

    it('ignore un lien collé invalide plutôt que de l’ouvrir', () => {
      const baggr = liensDe(titre({ lienExterne: 'javascript:alert(1)' }))[0];

      expect(baggr.url).toBe(ACCUEIL_BAGGR);
      expect(baggr.direct).toBe(false);
    });
  });

  describe('Yahoo Finance', () => {
    it('se construit depuis le symbole', () => {
      const yahoo = liensDe(titre({ ticker: 'STLAP.PA' })).find(l => l.cle === 'yahoo')!;

      expect(yahoo.url).toBe('https://finance.yahoo.com/quote/STLAP.PA');
      expect(yahoo.direct).toBe(true);
    });

    it('disparaît quand le symbole n’est pas réglé', () => {
      const vue = liensDe(titre({ ticker: '' }));

      expect(vue.some(lien => lien.cle === 'yahoo')).toBe(false);
    });

    it('échappe un symbole inattendu', () => {
      const yahoo = liensDe(titre({ ticker: 'A B&C' })).find(l => l.cle === 'yahoo')!;

      expect(yahoo.url).toBe('https://finance.yahoo.com/quote/A%20B%26C');
    });
  });

  describe('Euronext', () => {
    it('se construit depuis l’ISIN', () => {
      const euronext = liensDe(titre()).find(lien => lien.cle === 'euronext')!;

      expect(euronext.url).toContain('FR0000120073');
    });
  });

  it('rend toujours au moins un lien', () => {
    // Meme sans symbole ni ISIN, on doit pouvoir aller chercher.
    expect(liensDe(titre({ ticker: '', isin: '' }))).toHaveLength(1);
  });

  it('dit à quoi sert chaque destination', () => {
    // Trois liens sans explication ne valent pas mieux qu'aucun.
    expect(liensDe(titre()).every(lien => lien.aQuoiCaSert.length > 10)).toBe(true);
  });
});
