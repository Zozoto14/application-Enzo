import type { Profil } from '../../profils/profils';
import { REGISTRE } from '../registre';
import { peutOuvrir } from '../permissions';
import {
  ajouterProfilPar,
  annulerInvitationPar,
  appliquerGroupePar,
  avecNotePar,
  avecReglagesPar,
  changerPolitiquePar,
  definirExpirationPar,
  definirNiveauxPar,
  definirRolePar,
  desactiverPar,
  exporterJournalPar,
  prolongerInvitationPar,
  reactiverPar,
  renommerProfilPar,
  supprimerProfilPar,
  suspendrePar,
} from './actions';
import { filtrerComptes } from './comptes';
import { donneesVides } from './donnees';
import { journaliser, lireEvenement } from './journal';
import { politiqueVide } from './politique';
import { ACTIONS_GESTIONNAIRE, ErreurPermission, autorise, exiger, roleDe, type ActionAdmin } from './roles';

const T = Date.parse('2026-09-29T12:00:00Z');
const admin: Profil = { id: 'principal', nom: 'Enzo', admin: true, creeLe: '' };
const gest: Profil = { id: 'lea0000001', nom: 'Léa', admin: false, creeLe: '', apps: ['portefeuille'], actif: true, role: 'gestionnaire' };
const gest2: Profil = { id: 'max0000004', nom: 'Max', admin: false, creeLe: '', apps: ['portefeuille'], actif: true, role: 'gestionnaire' };
const ami: Profil = { id: 'hugo000002', nom: 'Hugo', admin: false, creeLe: '', apps: ['portefeuille'], actif: true };
// Ami créé par la gestionnaire Léa, et ami créé par l'administrateur.
const zoe: Profil = { id: 'zoe0000003', nom: 'Zoé', admin: false, creeLe: '', apps: ['portefeuille'], actif: true, creePar: 'lea0000001' };
const liste = [admin, gest, gest2, ami, zoe];
const apps = REGISTRE;

const TOUTES: ActionAdmin[] = [
  'voir-tableau',
  'voir-journal',
  'creer-ami',
  'permissions-ami',
  'etat-ami',
  'invitation-ami',
  'regenerer-identifiants',
  'renommer-ami',
  'supprimer-ami',
  'notes',
  'changer-role',
  'exporter-journal',
  'reglages-admin',
  'reglages-securite',
  'politique-apps',
  'acces-sequestre',
  'ouvrir-compte',
  'modifier-admin',
];

describe('rôles : qui a le droit de quoi', () => {
  it('roleDe : administrateur, gestionnaire, ami (absent = ami), aucun profil = administrateur (appareil sans comptes)', () => {
    expect(roleDe(admin)).toBe('admin');
    expect(roleDe(gest)).toBe('gestionnaire');
    expect(roleDe(ami)).toBe('ami');
    expect(roleDe({ admin: false })).toBe('ami');
    expect(roleDe(undefined)).toBe('admin');
    // Un champ « role » retouché sur l'administrateur n'y change rien.
    expect(roleDe({ admin: true, role: 'ami' })).toBe('admin');
  });

  it('un simple ami échoue sur TOUTES les actions', () => {
    for (const action of TOUTES) {
      expect(autorise(ami, action, zoe).ok).toBe(false);
      expect(() => exiger(ami, action, zoe)).toThrow(ErreurPermission);
    }
    expect(autorise(undefined, 'voir-tableau').ok).toBe(false);
  });

  it('un gestionnaire n’a que les actions listées, et échoue sur toutes les autres', () => {
    for (const action of TOUTES) {
      const attendu = ACTIONS_GESTIONNAIRE.includes(action);
      expect(autorise(gest, action, zoe).ok).toBe(attendu);
    }
    for (const interdite of ['changer-role', 'exporter-journal', 'reglages-admin', 'reglages-securite', 'politique-apps', 'acces-sequestre', 'ouvrir-compte', 'modifier-admin', 'supprimer-ami', 'renommer-ami', 'notes'] as const) {
      expect(() => exiger(gest, interdite, zoe)).toThrow(ErreurPermission);
    }
  });

  it('l’administrateur peut tout, sauf agir sur lui-même comme sur un ami', () => {
    for (const action of TOUTES) {
      expect(autorise(admin, action, zoe).ok).toBe(true);
    }
    expect(autorise(admin, 'supprimer-ami', admin).ok).toBe(false);
    expect(autorise(admin, 'changer-role', admin).ok).toBe(false);
  });

  it('un gestionnaire ne touche ni l’administrateur, ni un autre gestionnaire, ni lui-même', () => {
    for (const action of ['permissions-ami', 'etat-ami', 'invitation-ami', 'regenerer-identifiants'] as const) {
      expect(autorise(gest, action, admin).ok).toBe(false);
      expect(autorise(gest, action, gest2).ok).toBe(false);
      expect(autorise(gest, action, gest).ok).toBe(false);
      expect(autorise(gest, action, { ...zoe }).ok).toBe(true);
    }
  });

  it('un gestionnaire ne régénère que les identifiants des amis qu’il a créés', () => {
    expect(autorise(gest, 'regenerer-identifiants', zoe).ok).toBe(true);
    expect(autorise(gest, 'regenerer-identifiants', ami).ok).toBe(false);
    expect(autorise(gest, 'regenerer-identifiants', { ...zoe, creePar: 'max0000004' }).ok).toBe(false);
    expect(autorise(gest, 'regenerer-identifiants', undefined).ok).toBe(false);
    // L'administrateur, lui, régénère pour tout ami.
    expect(autorise(admin, 'regenerer-identifiants', ami).ok).toBe(true);
  });
});

describe('actions vérifiées côté logique (pas seulement des boutons masqués)', () => {
  it('permissions, activation, suspension, invitation, expiration : le gestionnaire agit sur ses amis', () => {
    expect(definirNiveauxPar(gest, liste, 'zoe0000003', apps, { portefeuille: 'aucun' }).find(p => p.id === 'zoe0000003')?.apps).toEqual([]);
    expect(desactiverPar(gest, liste, 'zoe0000003').find(p => p.id === 'zoe0000003')?.actif).toBe(false);
    expect(reactiverPar(gest, desactiverPar(gest, liste, 'zoe0000003'), 'zoe0000003').find(p => p.id === 'zoe0000003')?.actif).toBe(true);
    expect(suspendrePar(gest, liste, 'zoe0000003', '2026-10-05T00:00:00Z', T).find(p => p.id === 'zoe0000003')?.desactiveJusquau).toBeDefined();
    expect(definirExpirationPar(gest, liste, 'zoe0000003', '2027-01-01T00:00:00Z')).toBeDefined();
    expect(prolongerInvitationPar(gest, liste, 'zoe0000003', 7, T)).toBeDefined();
    expect(annulerInvitationPar(gest, liste, 'zoe0000003', T)).toBeDefined();
    expect(ajouterProfilPar(gest, liste, 'Nina', 'nina000005', '2026-09-29').some(p => p.nom === 'Nina')).toBe(true);
  });

  it('un ami simple échoue partout : rien n’est modifié', () => {
    const essais: Array<() => unknown> = [
      () => definirNiveauxPar(ami, liste, 'zoe0000003', apps, { portefeuille: 'lecture' }),
      () => desactiverPar(ami, liste, 'zoe0000003'),
      () => reactiverPar(ami, liste, 'zoe0000003'),
      () => suspendrePar(ami, liste, 'zoe0000003', '2026-10-05T00:00:00Z', T),
      () => definirExpirationPar(ami, liste, 'zoe0000003', undefined),
      () => prolongerInvitationPar(ami, liste, 'zoe0000003', 7, T),
      () => annulerInvitationPar(ami, liste, 'zoe0000003', T),
      () => ajouterProfilPar(ami, liste, 'Nina', 'nina000005', '2026-09-29'),
      () => renommerProfilPar(ami, liste, 'zoe0000003', 'Zoe'),
      () => supprimerProfilPar(ami, liste, 'zoe0000003'),
      () => definirRolePar(ami, liste, 'zoe0000003', 'gestionnaire'),
      () => definirRolePar(ami, liste, 'hugo000002', 'gestionnaire'),
      () => changerPolitiquePar(ami, liste, politiqueVide()),
      () => avecReglagesPar(ami, donneesVides(), { verrouMinutes: 0 }, T),
      () => avecNotePar(ami, donneesVides(), liste, 'zoe0000003', 'x'),
      () => exporterJournalPar(ami, 'json', []),
      () => appliquerGroupePar(ami, liste, ['zoe0000003'], { genre: 'desactiver' }, apps, T),
    ];
    essais.forEach(essai => expect(essai).toThrow(ErreurPermission));
  });

  it('un gestionnaire échoue sur les actions interdites, y compris s’il tente de se promouvoir', () => {
    const essais: Array<() => unknown> = [
      () => renommerProfilPar(gest, liste, 'zoe0000003', 'Zoe'),
      () => supprimerProfilPar(gest, liste, 'zoe0000003'),
      // Promotion / rétrogradation d'autrui, de lui-même, d'un autre gestionnaire.
      () => definirRolePar(gest, liste, 'zoe0000003', 'gestionnaire'),
      () => definirRolePar(gest, liste, 'lea0000001', 'gestionnaire'),
      () => definirRolePar(gest, liste, 'max0000004', 'ami'),
      () => definirRolePar(gest, liste, 'principal', 'ami'),
      // Réglages globaux, sécurité, journal.
      () => changerPolitiquePar(gest, liste, politiqueVide()),
      () => avecReglagesPar(gest, donneesVides(), { verrouMinutes: 0 }, T),
      () => avecNotePar(gest, donneesVides(), liste, 'zoe0000003', 'x'),
      () => exporterJournalPar(gest, 'csv', []),
      // Agir sur l'administrateur, un autre gestionnaire, soi-même.
      () => definirNiveauxPar(gest, liste, 'principal', apps, {}),
      () => desactiverPar(gest, liste, 'principal'),
      () => desactiverPar(gest, liste, 'max0000004'),
      () => definirNiveauxPar(gest, liste, 'lea0000001', apps, { portefeuille: 'complet' }),
      () => suspendrePar(gest, liste, 'lea0000001', '2026-10-05T00:00:00Z', T),
    ];
    essais.forEach(essai => expect(essai).toThrow(ErreurPermission));
  });

  it('une action groupée est tout ou rien : un seul compte interdit et rien ne change', () => {
    expect(() => appliquerGroupePar(gest, liste, ['zoe0000003', 'max0000004'], { genre: 'desactiver' }, apps, T)).toThrow(ErreurPermission);
    expect(() => appliquerGroupePar(gest, liste, ['zoe0000003', 'principal'], { genre: 'niveaux', niveaux: {} }, apps, T)).toThrow(ErreurPermission);
    const ok = appliquerGroupePar(gest, liste, ['zoe0000003'], { genre: 'desactiver' }, apps, T);
    expect(ok.modifies).toEqual(['zoe0000003']);
  });
});

describe('promotion et rétrogradation (administrateur seulement)', () => {
  it('promeut un ami, puis le rétrograde ; idempotent', () => {
    const promu = definirRolePar(admin, liste, 'hugo000002', 'gestionnaire');
    expect(roleDe(promu.find(p => p.id === 'hugo000002'))).toBe('gestionnaire');
    expect(definirRolePar(admin, promu, 'hugo000002', 'gestionnaire')).toEqual(promu);
    const retro = definirRolePar(admin, promu, 'hugo000002', 'ami');
    expect(roleDe(retro.find(p => p.id === 'hugo000002'))).toBe('ami');
    expect(retro.find(p => p.id === 'hugo000002')).not.toHaveProperty('role');
    expect(definirRolePar(admin, retro, 'hugo000002', 'ami')).toEqual(retro);
    // Les autres comptes ne bougent pas.
    expect(retro.filter(p => p.id !== 'hugo000002')).toEqual(liste.filter(p => p.id !== 'hugo000002'));
  });

  it('on ne change pas le rôle de l’administrateur ni d’un profil inconnu', () => {
    expect(() => definirRolePar(admin, liste, 'principal', 'gestionnaire')).toThrow();
    expect(() => definirRolePar(admin, liste, 'absent00001', 'gestionnaire')).toThrow();
  });

  it('la liste des utilisateurs se filtre par rôle', () => {
    const ids = (role: 'ami' | 'gestionnaire' | 'tous') => filtrerComptes(liste, { role }, apps, T).map(p => p.id);
    expect(ids('gestionnaire')).toEqual(['lea0000001', 'max0000004']);
    expect(ids('ami')).toEqual(['hugo000002', 'zoe0000003']);
    expect(ids('tous')).toHaveLength(5);
  });
});

describe('accès au hub : la tuile Administration', () => {
  const administration = REGISTRE.find(a => a.id === 'administration')!;
  it('un gestionnaire l’ouvre, pas un simple ami (même avec « administration » dans ses apps retouchées)', () => {
    expect(peutOuvrir(administration, admin)).toBe(true);
    expect(peutOuvrir(administration, gest)).toBe(true);
    expect(peutOuvrir(administration, ami)).toBe(false);
    expect(peutOuvrir(administration, { ...ami, apps: ['portefeuille', 'administration'] })).toBe(false);
    expect(peutOuvrir({ id: 'autre', adminSeulement: true }, gest)).toBe(false);
  });
});

describe('journal : les actions d’un gestionnaire portent son nom', () => {
  it('l’acteur est conservé, nettoyé, et sans secret', () => {
    const e = lireEvenement({ date: '2026-09-29T10:00:00Z', type: 'permissions', action: 'Accès réglé', acteur: 'Léa' });
    expect(e?.acteur).toBe('Léa');
    const j = journaliser([], { type: 'role', action: 'Léa promue Gestionnaire', cible: 'lea0000001' }, T, 30);
    expect(j[0].type).toBe('role');
    const secret = lireEvenement({ date: '2026-09-29T10:00:00Z', type: 'compte', action: 'x', acteur: 'abcde-FGHJK-23456-mnpqr' });
    expect(secret?.acteur).toBe('[masqué]');
  });
});
