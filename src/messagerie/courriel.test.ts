import { libelleErreurCourriel } from './courriel';

describe('libelleErreurCourriel', () => {
  it('certificat SMTP : indique SMTP_HOST=<nom du serveur>', () => {
    expect(libelleErreurCourriel('smtp-certificat')).toBe('certificat SMTP ne correspond pas au nom du serveur : utilise SMTP_HOST=<nom du serveur> (celui affiché par cPanel)');
  });
  it('authentification : message clair', () => {
    expect(libelleErreurCourriel('smtp-authentification')).toContain('SMTP_USER');
  });
  it('serveur injoignable et code inconnu', () => {
    expect(libelleErreurCourriel('smtp-injoignable')).toBe('serveur SMTP injoignable');
    expect(libelleErreurCourriel(undefined)).toBe('');
    expect(libelleErreurCourriel('autre')).toBe('autre');
  });
});
