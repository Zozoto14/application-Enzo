import { changerDEspace, cleLocale, profilCourant, stockageDuProfil, surChangementDeCompte } from './espace';
import { definirLiaisonEnAttente, definirRelaisActif, liaisonEnAttente, relaisActif } from '../sync/relais/actif';
import { definirDiscretion, discretionActive } from '../ui/discretion';

function memoire() {
  const donnees = new Map<string, string>();
  return {
    donnees,
    getItem: (cle: string) => donnees.get(cle) ?? null,
    setItem: (cle: string, valeur: string) => void donnees.set(cle, valeur),
    removeItem: (cle: string) => void donnees.delete(cle),
  };
}

afterEach(() => changerDEspace('principal'));

describe('isolation : état local et en mémoire par compte', () => {
  it('le principal garde ses clés historiques, un ami a les siennes', () => {
    expect(cleLocale('applibourse.theme', 'principal')).toBe('applibourse.theme');
    expect(cleLocale('applibourse.theme', 'lea0000001')).toBe('applibourse.theme@lea0000001');
  });

  it('un ami ne lit pas ce qu’un autre compte a rangé dans le stockage local', () => {
    const brut = memoire();
    changerDEspace('principal');
    stockageDuProfil(brut)!.setItem('applibourse.planningBriefings', 'planning-admin');
    changerDEspace('lea0000001');
    const vuParLea = stockageDuProfil(brut)!;
    expect(vuParLea.getItem('applibourse.planningBriefings')).toBeNull();
    vuParLea.setItem('applibourse.planningBriefings', 'planning-lea');
    changerDEspace('hugo000002');
    expect(stockageDuProfil(brut)!.getItem('applibourse.planningBriefings')).toBeNull();
    changerDEspace('principal');
    expect(stockageDuProfil(brut)!.getItem('applibourse.planningBriefings')).toBe('planning-admin');
  });

  it('changer de compte efface l’état en mémoire (relais, liaison, mode discret)', () => {
    changerDEspace('principal');
    definirRelaisActif({ relais: 'https://relais.exemple', jeton: 'jeton-secret' });
    definirLiaisonEnAttente('CODE-LIAISON');
    definirDiscretion(true);
    changerDEspace('lea0000001');
    expect(profilCourant()).toBe('lea0000001');
    expect(relaisActif()).toBeUndefined();
    expect(discretionActive()).toBe(false);
    // Le code de liaison de l'administrateur n'est pas visible depuis le compte de Léa.
    expect(liaisonEnAttente()).toBeUndefined();
  });

  it('une remise qui échoue n’empêche pas les autres', () => {
    let appelee = false;
    const retirer1 = surChangementDeCompte(() => {
      throw new Error('panne');
    });
    const retirer2 = surChangementDeCompte(() => {
      appelee = true;
    });
    changerDEspace('lea0000001');
    expect(appelee).toBe(true);
    retirer1();
    retirer2();
  });
});
