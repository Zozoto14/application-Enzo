import { genererCodeAcces } from '../../securite/sequestre';
import { aleatoireDeterministe } from '../../securite/aleatoire';
import type { Profil } from '../../profils/profils';
import { alertesComptes } from './comptes';
import { exporterCsv, exporterJson, journaliser, LIBELLES_TYPE, nettoyerTexte } from './journal';

const T = Date.parse('2026-09-29T12:00:00Z');

describe('journal d’audit : aucun secret', () => {
  it('masque codes d’accès, mots de passe générés, clés TOTP et codes de récupération', () => {
    for (let graine = 1; graine < 30; graine++) {
      const code = genererCodeAcces(aleatoireDeterministe(graine));
      expect(nettoyerTexte(`code ${code} affiché`)).not.toContain(code);
    }
    expect(nettoyerTexte('mdp abcde-FGHJK-23456-mnpqr')).toContain('[masqué]');
    expect(nettoyerTexte('clé JBSWY3DPEHPK3PXP')).toContain('[masqué]');
    expect(nettoyerTexte('otpauth://totp/x?secret=ABC')).toBe('[masqué]');
  });

  it('les exports ne contiennent que des entrées nettoyées', () => {
    const code = genererCodeAcces(aleatoireDeterministe(3));
    const journal = journaliser([], { type: 'acces-admin', action: `Code ${code}`, cible: 'lea0000001', nomCible: 'Léa' }, T, 30);
    expect(exporterJson(journal)).not.toContain(code);
    expect(exporterCsv(journal)).not.toContain(code);
    expect(LIBELLES_TYPE['acces-admin']).toBe('Accès administrateur');
  });
});

describe('alertes : séquestre absent (migration)', () => {
  it('signale un compte ami sans séquestre à l’administrateur', () => {
    const ami: Profil = { id: 'lea0000001', nom: 'Léa', admin: false, creeLe: '', apps: ['portefeuille'], actif: true, sequestre: 'attendu', derniereConnexion: '2026-09-28T10:00:00Z' };
    const alertes = alertesComptes([ami], T, 30);
    expect(alertes.find(a => a.genre === 'sequestre-absent')?.message).toMatch(/séquestre absent, à créer à la prochaine connexion de l’ami ou par régénération d’identifiants/);
    expect(alertesComptes([{ ...ami, sequestre: 'actif' }], T, 30).some(a => a.genre === 'sequestre-absent')).toBe(false);
  });
});
