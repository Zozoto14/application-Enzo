import { ID_PRINCIPAL, ajouterProfil, ecrireProfils, fichiersDuProfil, lireProfils, nouvelIdentifiant, renommerProfil, autoriserApps, activerProfil, profilOuvrable, supprimerProfil } from './profils';

describe('profils', () => {
  it('le profil principal existe toujours, et c’est l’administrateur', () => {
    const profils = lireProfils(undefined);
    expect(profils).toEqual([{ id: ID_PRINCIPAL, nom: 'Moi', admin: true, creeLe: '' }]);
    expect(lireProfils('pas du json')[0].admin).toBe(true);
  });

  it('ajoute un ami, qui n’est pas administrateur, et relit la liste', () => {
    const avec = ajouterProfil(lireProfils(undefined), '  Lucas ', 'abcdef1234', '2026-09-29');
    expect(avec[1]).toEqual({ id: 'abcdef1234', nom: 'Lucas', admin: false, creeLe: '2026-09-29', apps: ['portefeuille'], actif: true });
    const relus = lireProfils(ecrireProfils(avec));
    expect(relus.map(p => [p.nom, p.admin])).toEqual([['Moi', true], ['Lucas', false]]);
  });

  it('refuse un doublon, un nom vide, et la suppression de l’admin', () => {
    const avec = ajouterProfil(lireProfils(undefined), 'Lucas', 'abcdef1234', '');
    expect(() => ajouterProfil(avec, 'lucas', 'zzzzzz9999', '')).toThrow(/existe déjà/);
    expect(() => ajouterProfil(avec, '  ', 'zzzzzz9999', '')).toThrow(/prénom/);
    expect(() => supprimerProfil(avec, ID_PRINCIPAL)).toThrow(/administrateur/);
    expect(supprimerProfil(avec, 'abcdef1234')).toHaveLength(1);
  });

  it('renomme, sans toucher à l’admin', () => {
    const avec = renommerProfil(lireProfils(undefined), ID_PRINCIPAL, 'Enzo');
    expect(lireProfils(ecrireProfils(avec))[0]).toMatchObject({ nom: 'Enzo', admin: true });
  });

  it('ignore une entrée trafiquée qui se dirait admin ou viserait un autre fichier', () => {
    const profils = lireProfils(JSON.stringify([{ id: '../../x', nom: 'Pirate' }, { id: 'abcdef1234', nom: 'Ami', admin: true }]));
    expect(profils.map(p => p.id)).toEqual([ID_PRINCIPAL, 'abcdef1234']);
    expect(profils[1].admin).toBe(false);
  });

  it('range chaque profil dans ses propres fichiers', () => {
    expect(fichiersDuProfil(ID_PRINCIPAL)).toEqual({ coffre: 'coffre', portefeuille: 'portefeuille' });
    expect(fichiersDuProfil('abcdef1234')).toEqual({ coffre: 'coffre-abcdef1234', portefeuille: 'portefeuille-abcdef1234' });
    expect(nouvelIdentifiant(n => new Uint8Array(n).fill(3))).toBe('dddddddddd');
  });

  it('autorise des apps, désactive un ami, et relit le tout', () => {
    let profils = ajouterProfil(lireProfils(undefined), 'Lucas', 'abcdef1234', '', ['portefeuille', 'x', 'MAUVAIS ID']);
    expect(profils[1].apps).toEqual(['portefeuille']);
    profils = autoriserApps(profils, 'abcdef1234', ['a-b', 'a-b', 'portefeuille']);
    profils = activerProfil(profils, 'abcdef1234', false);
    const relus = lireProfils(ecrireProfils(profils));
    expect(relus[1]).toMatchObject({ apps: ['a-b', 'portefeuille'], actif: false });
    expect(profilOuvrable(relus[1])).toBe(false);
    expect(profilOuvrable(relus[0])).toBe(true);
    expect(() => autoriserApps(profils, ID_PRINCIPAL, [])).toThrow(/administrateur/);
    expect(() => activerProfil(profils, ID_PRINCIPAL, false)).toThrow(/administrateur/);
  });

  it('un ami enregistré avant le hub garde le portefeuille et reste actif', () => {
    const relus = lireProfils(JSON.stringify([{ id: 'abcdef1234', nom: 'Ancien', creeLe: '' }]));
    expect(relus[1]).toMatchObject({ apps: ['portefeuille'], actif: true });
  });
});
