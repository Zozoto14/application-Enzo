import { formulaireDepuisCompte, validerCompte } from './compte';


describe('modification d’un compte', () => {
  const existant = { id: 'pea', nom: 'PEA BoursoBank', type: 'PEA' as const, dateOuverture: '2019-03-15', devise: 'EUR' };

  it('préremplit le formulaire et garde l’identifiant', () => {
    const formulaire = formulaireDepuisCompte(existant);
    expect(formulaire).toEqual({ nom: 'PEA BoursoBank', type: 'PEA', dateOuverture: '15/03/2019', devise: 'EUR' });
    const resultat = validerCompte({ ...formulaire, nom: 'Mon PEA' }, [existant], () => 'nouveau', existant);
    expect(resultat.compte).toEqual({ ...existant, nom: 'Mon PEA' });
  });

  it('accepte de garder son propre nom, refuse celui d’un autre compte', () => {
    const autre = { ...existant, id: 'cto', nom: 'CTO' };
    expect(validerCompte(formulaireDepuisCompte(existant), [existant, autre], () => 'x', existant).erreurs).toEqual({});
    expect(
      validerCompte({ ...formulaireDepuisCompte(existant), nom: 'cto' }, [existant, autre], () => 'x', existant).erreurs.nom,
    ).toBe('Un compte porte déjà ce nom');
  });
});
