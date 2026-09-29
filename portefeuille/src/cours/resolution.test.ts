import { titre } from '../core/testing/fixtures';
import { meilleurCandidat, resoudreSymboles, type Chercher } from './resolution';

const candidat = (symbole: string, paris: boolean, type = 'EQUITY') => ({ symbole, nom: symbole, place: paris ? 'PAR' : 'NYQ', paris, type });

describe('résolution des symboles', () => {
  it('préfère la cotation parisienne, et une action à une option', () => {
    expect(
      meilleurCandidat([candidat('STLA', false), candidat('STLAX', true, 'OPTION'), candidat('STLAP.PA', true)])?.symbole,
    ).toBe('STLAP.PA');
  });

  it('cherche par ISIN, puis par nom, sans toucher aux symboles déjà réglés', async () => {
    const requetes: string[] = [];
    const chercher: Chercher = async requete => {
      requetes.push(requete);
      if (requete === 'NL00150001Q9') return { candidats: [] };
      if (requete === 'STELLANTIS') return { candidats: [candidat('STLAP.PA', true)] };
      if (requete === 'LU1681043599') return { candidats: [candidat('CW8.PA', true, 'ETF')] };
      return { candidats: [] };
    };
    const resultat = await resoudreSymboles(
      [
        titre({ id: 'stla', isin: 'NL00150001Q9', nom: 'STELLANTIS', ticker: '' }),
        titre({ id: 'cw8', isin: 'LU1681043599', nom: 'AMUNDI', ticker: '' }),
        titre({ id: 'ai', ticker: 'AI.PA' }),
        titre({ id: 'x', isin: 'XX0000000000', nom: 'INCONNUE', ticker: '' }),
      ],
      chercher,
    );
    expect(resultat.trouves).toEqual(new Map([['stla', 'STLAP.PA'], ['cw8', 'CW8.PA']]));
    expect(resultat.introuvables).toEqual(['INCONNUE']);
    expect(requetes).not.toContain('AI');
  });
});
