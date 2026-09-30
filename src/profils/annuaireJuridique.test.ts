import { ecrireAnnuaire, lireAnnuaire } from './annuaire';
import { annuaireDepuisEntites, entitesAnnuaire, projectionAmi } from './synchroAnnuaire';
import { modifierDocument } from '../juridique/modele';

const base = () => lireAnnuaire(undefined);

describe('textes légaux dans l’annuaire', () => {
  const docs = modifierDocument(undefined, 'conditions', '## Mes conditions\n\nTexte', 'Zoé', '2026-10-06T10:00:00Z');

  it('se relisent après écriture et voyagent comme entrée synchronisée', () => {
    const a = { ...base(), juridique: docs };
    expect(lireAnnuaire(ecrireAnnuaire(a)).juridique).toEqual(docs);
    expect(entitesAnnuaire(a).juridique).toEqual(docs);
    expect(annuaireDepuisEntites(entitesAnnuaire(a)).juridique).toEqual(docs);
  });

  it('un annuaire sans texte modifié n’a pas d’entrée (modèle par défaut)', () => {
    expect(entitesAnnuaire(base())).not.toHaveProperty('juridique');
  });

  it('une valeur illisible reçue du relais est écartée', () => {
    const brut = JSON.stringify({ ...JSON.parse(ecrireAnnuaire(base())), juridique: { revision: 'x', documents: 3 } });
    expect(lireAnnuaire(brut).juridique).toBeUndefined();
  });

  it('la projection d’un ami porte les textes légaux', () => {
    const a = { ...base(), sel: 'ab'.repeat(16), juridique: docs, comptes: [{ id: 'abc1234567', empreinte: 'a'.repeat(64), nom: 'b'.repeat(40), acces: {}, sequestre: { etat: 'attendu' as const } }] };
    expect(projectionAmi(a as never, 'abc1234567')?.juridique).toEqual(docs);
  });
});
