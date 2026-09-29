import { definirDiscretion, masquerMontants } from './discretion';
import { d } from '../core/money/decimal';
import { formaterMontant, formaterPourcentage } from './format';

describe('mode discret', () => {
  afterEach(() => definirDiscretion(false));

  it('masque les euros, garde les pourcentages', () => {
    definirDiscretion(true);
    expect(masquerMontants('Gain : +1 234,56 € (+5,2 %)')).toBe('Gain : •••• € (+5,2 %)');
    expect(masquerMontants('-3,1 k€')).toBe('•••• €');
    expect(formaterMontant('1234.5')).toBe('••••\u00a0€');
    expect(formaterPourcentage(d('5.2'))).toBe('+5,20\u00a0%');
  });

  it('ne touche à rien quand il est coupé', () => {
    expect(masquerMontants('12 €')).toBe('12 €');
    expect(formaterMontant('12')).toBe('12,00 €');
  });
});
