import { titre } from '../../core/testing/fixtures';
import {
  FORMULAIRE_TITRE_VIDE,
  compatibleAvec,
  isinValide,
  paysDeLIsin,
  validerTitre,
  type FormulaireTitre,
} from './titre';

describe('isinValide', () => {
  it('accepte des ISIN réels', () => {
    // Quatre valeurs réelles, dont deux tirées du portefeuille importé.
    expect(isinValide('NL00150001Q9')).toBe(true); // STELLANTIS
    expect(isinValide('LU1681043599')).toBe(true); // Amundi MSCI World
    expect(isinValide('FR0000120073')).toBe(true); // Air Liquide
    expect(isinValide('US0378331005')).toBe(true); // Apple
  });

  it('rejette une clé de contrôle fausse', () => {
    // Dernier chiffre modifié : c'est exactement ce que la clé doit attraper.
    expect(isinValide('NL00150001Q8')).toBe(false);
    expect(isinValide('FR0000120074')).toBe(false);
  });

  it('rejette une faute de frappe sur un chiffre du corps', () => {
    expect(isinValide('FR0000120063')).toBe(false);
    expect(isinValide('LU1681043589')).toBe(false);
  });

  it('rejette un format invalide', () => {
    expect(isinValide('FR123')).toBe(false);
    expect(isinValide('1R0000120073')).toBe(false);
    expect(isinValide('FR000012007A')).toBe(false);
    expect(isinValide('')).toBe(false);
  });

  it('tolère minuscules et espaces', () => {
    expect(isinValide('  fr0000120073 ')).toBe(true);
  });
});

describe('paysDeLIsin', () => {
  it('lit le pays d’émission', () => {
    expect(paysDeLIsin('NL00150001Q9')).toBe('NL');
    expect(paysDeLIsin('FR0000120073')).toBe('FR');
  });

  it('ne dit rien d’un ISIN mal formé', () => {
    expect(paysDeLIsin('FR123')).toBeUndefined();
  });
});

describe('validerTitre', () => {
  const formulaire = (partiel: Partial<FormulaireTitre>): FormulaireTitre => ({
    ...FORMULAIRE_TITRE_VIDE,
    nom: 'Stellantis',
    isin: 'NL00150001Q9',
    ...partiel,
  });

  const genererId = () => 'titre-1';

  it('construit la valeur attendue', () => {
    const { titre: cree, erreurs } = validerTitre(
      formulaire({ ticker: 'stla', secteur: 'Automobile', zoneGeographique: 'Europe' }),
      [],
      genererId,
    );

    expect(erreurs).toEqual({});
    expect(cree).toEqual({
      id: 'titre-1',
      isin: 'NL00150001Q9',
      nom: 'Stellantis',
      ticker: 'STLA',
      deviseCotation: 'EUR',
      secteur: 'Automobile',
      zoneGeographique: 'Europe',
      eligiblePEA: true,
    });
  });

  it('normalise l’ISIN saisi en minuscules', () => {
    const { titre: cree } = validerTitre(
      formulaire({ isin: 'nl00150001q9' }),
      [],
      genererId,
    );
    expect(cree!.isin).toBe('NL00150001Q9');
  });

  it('déduit un ticker de l’ISIN quand il n’est pas fourni', () => {
    const { titre: cree } = validerTitre(formulaire({}), [], genererId);
    expect(cree!.ticker).toBe('NL0015');
  });

  it('laisse vides les champs facultatifs non renseignés', () => {
    const { titre: cree } = validerTitre(formulaire({}), [], genererId);
    expect(cree!.secteur).toBeUndefined();
    expect(cree!.zoneGeographique).toBeUndefined();
  });

  describe('refus', () => {
    it('exige un nom', () => {
      const { erreurs } = validerTitre(formulaire({ nom: '  ' }), [], genererId);
      expect(erreurs.nom).toBe('Champ obligatoire');
    });

    it('signale une clé de contrôle fausse', () => {
      const { erreurs } = validerTitre(
        formulaire({ isin: 'NL00150001Q8' }),
        [],
        genererId,
      );
      expect(erreurs.isin).toMatch(/Clé de contrôle/);
    });

    it('distingue un format invalide d’une clé fausse', () => {
      const { erreurs } = validerTitre(formulaire({ isin: 'NL123' }), [], genererId);
      expect(erreurs.isin).toMatch(/Format attendu/);
    });

    it('refuse un doublon d’ISIN', () => {
      const existant = titre({ id: 'x', isin: 'NL00150001Q9' });
      const { erreurs } = validerTitre(formulaire({}), [existant], genererId);
      expect(erreurs.isin).toBe('Cette valeur existe déjà');
    });

    it('refuse une devise mal formée', () => {
      const { erreurs } = validerTitre(
        formulaire({ deviseCotation: 'euros' }),
        [],
        genererId,
      );
      expect(erreurs.deviseCotation).toMatch(/trois lettres/);
    });
  });
});

describe('compatibleAvec', () => {
  it('autorise tout sur un compte-titres', () => {
    expect(compatibleAvec(titre({ eligiblePEA: false }), 'CTO')).toBe(true);
  });

  it('restreint le PEA aux valeurs éligibles', () => {
    expect(compatibleAvec(titre({ eligiblePEA: true }), 'PEA')).toBe(true);
    expect(compatibleAvec(titre({ eligiblePEA: false }), 'PEA')).toBe(false);
    expect(compatibleAvec(titre({ eligiblePEA: false }), 'PEA_PME')).toBe(false);
  });
});
