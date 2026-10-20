/**
 * Régression : appareil mis à jour depuis une version d'avant le hub.
 *
 * Ces versions n'ont jamais demandé de prénom à l'administrateur (il
 * s'appelait « Moi »). La connexion par prénom l'envoyait donc au coffre
 * leurre dès qu'il saisissait le sien : « Mot de passe ou code incorrect »
 * avec les bons identifiants, et rien d'autre à voir. Données réelles
 * écrites par 14a6bea et d3bad69 (voir `__fixtures__/ancienneVersion.ts`).
 */

import { hexToBytes } from '@noble/hashes/utils.js';
import { ouvrirBaseNode } from '../db/pilotes/node';
import { appsVisibles } from '../hub/permissions';
import { ID_ADMINISTRATION, ID_PORTEFEUILLE, REGISTRE } from '../hub/registre';
import type { ContexteHub } from '../hub/types';
import { aleatoireDeterministe } from '../securite/aleatoire';
import type { Coffre } from '../securite/coffre';
import type { ParametresKdf } from '../securite/kdf';
import { codeTotp } from '../securite/totp';
import { Session } from '../session/session';
import { stockageMemoire } from '../session/stockage-coffre';
import {
  COFFRE_ADMIN_14A6BEA,
  ID_AMIE_14A6BEA,
  MOT_DE_PASSE_ADMIN,
  PROFILS_14A6BEA,
  PROFILS_D3BAD69,
  SECRET_TOTP_ADMIN,
} from './__fixtures__/ancienneVersion';
import {
  aDesAmis,
  adminSansPrenom,
  adopterPrenomAdmin,
  appliquerProfilsAdmin,
  ecrireAnnuaire,
  lireAnnuaire,
  ouvrirAnnuaireAdmin,
  profilAmi,
  trouverCompte,
  type Annuaire,
  type ClesAdmin,
} from './annuaire';
import { ajouterProfil, fichiersDuProfil, ID_PRINCIPAL } from './profils';

const T = 1_790_000_000_000;
const KDF: ParametresKdf = { algorithme: 'argon2id', passes: 1, memoireKio: 64, fils: 1, longueurCle: 32 };

function clesDe(s: Session): ClesAdmin {
  return { annuaire: hexToBytes(s.cleDerivee('annuaire')), sequestre: hexToBytes(s.cleDerivee('sequestre')) };
}

/** Session de l'administrateur telle que le bureau l'ouvre (profil principal). */
function sessionAdmin(coffre?: Coffre) {
  return new Session({ stockage: stockageMemoire(coffre), ouvrirBase: () => ouvrirBaseNode(), horloge: () => T, alea: aleatoireDeterministe(7), kdf: KDF, profil: ID_PRINCIPAL });
}

/** Administrateur neuf (coffre léger) pour les scénarios sans fixture de coffre. */
function adminNeuf(): Session {
  const s = sessionAdmin();
  const init = s.initialiser({ motDePasse: 'mot-de-passe-admin-long' });
  s.deverrouiller({ motDePasse: 'mot-de-passe-admin-long', codeTotp: codeTotp(init.secretTotp, T) });
  return s;
}

const relu = (a: Annuaire) => lireAnnuaire(ecrireAnnuaire(a));

describe.each([
  ['14a6bea (format 0)', PROFILS_14A6BEA],
  ['d3bad69 (hub v1)', PROFILS_D3BAD69],
])('liste des profils écrite par %s', (_version, brut) => {
  const annuaire = lireAnnuaire(brut);

  it('se lit comme une liste à migrer, avec un administrateur sans prénom', () => {
    expect(annuaire.heritage?.[0]).toMatchObject({ id: ID_PRINCIPAL, nom: 'Moi', admin: true });
    expect(aDesAmis(annuaire)).toBe(true);
    expect(adminSansPrenom(annuaire)).toBe(true);
  });

  it('le prénom de l’administrateur ouvre SON coffre (et non le leurre)', () => {
    const trouve = trouverCompte(annuaire, 'Enzo');
    expect(trouve).toEqual({ id: ID_PRINCIPAL, nom: 'Enzo', admin: true, prenomAAdopter: 'Enzo' });
    expect(fichiersDuProfil(trouve!.id).coffre).toBe('coffre');
    expect(trouverCompte(annuaire, 'admin')).toMatchObject({ id: ID_PRINCIPAL, admin: true });
    expect(trouverCompte(annuaire, 'admin')?.prenomAAdopter).toBeUndefined();
    expect(trouverCompte(annuaire, 'moi')).toMatchObject({ id: ID_PRINCIPAL, admin: true });
  });

  it('l’amie garde son compte, ses apps et n’ouvre jamais celui de l’administrateur', () => {
    const lea = trouverCompte(annuaire, 'lea');
    expect(lea).toMatchObject({ admin: false, nom: 'Léa' });
    expect(profilAmi(annuaire, lea!.id, lea!.nom).apps).toEqual([ID_PORTEFEUILLE]);
  });

  it('migration + prénom adopté : idempotente, sans perte, et le leurre protège ensuite les inconnus', () => {
    const admin = adminNeuf();
    const cles = clesDe(admin);
    const migre = adopterPrenomAdmin(annuaire, 'Enzo', cles, aleatoireDeterministe(3));
    expect(migre).toBeDefined();
    const disque = relu(migre!);
    expect(disque.heritage).toBeUndefined();
    expect(adminSansPrenom(disque)).toBe(false);
    expect(trouverCompte(disque, 'Enzo')).toEqual({ id: ID_PRINCIPAL, nom: 'Enzo', admin: true });
    expect(trouverCompte(disque, 'ENZO ')).toMatchObject({ id: ID_PRINCIPAL, admin: true });
    expect(trouverCompte(disque, 'Léa')).toMatchObject({ admin: false, nom: 'Léa' });
    // Prénom inconnu : le leurre, comme avant.
    expect(trouverCompte(disque, 'Paul')).toBeUndefined();
    // Une deuxième fois : rien ne change.
    expect(adopterPrenomAdmin(disque, 'Enzo', cles)).toBeUndefined();
    expect(adopterPrenomAdmin(disque, 'Autre', cles)).toBeUndefined();

    const vue = ouvrirAnnuaireAdmin(disque, cles);
    expect(vue.profils.map(p => [p.nom, p.admin])).toEqual([
      ['Enzo', true],
      ['Léa', false],
    ]);
    expect(vue.profils[1].apps).toEqual([ID_PORTEFEUILLE]);
    expect(vue.profils[1].anterieur).toBe(true);

    // Hub de l'administrateur migré : jamais sans tuile.
    const contexte: ContexteHub = { profil: vue.profils[0], profils: { onCreerCompte: () => undefined, tous: vue.profils } as unknown as ContexteHub['profils'] };
    expect(appsVisibles(REGISTRE, contexte).map(a => a.id)).toEqual([ID_PORTEFEUILLE, 'tsuzuku', 'esport', ID_ADMINISTRATION, 'claude-office']);
  });

  it('migré d’abord par « admin », le prénom est adopté à la connexion suivante', () => {
    const admin = adminNeuf();
    const cles = clesDe(admin);
    const parAdmin = relu(ouvrirAnnuaireAdmin(annuaire, cles).annuaire);
    expect(adminSansPrenom(parAdmin)).toBe(true);
    expect(trouverCompte(parAdmin, 'Enzo')).toMatchObject({ id: ID_PRINCIPAL, prenomAAdopter: 'Enzo' });
    expect(trouverCompte(parAdmin, 'Léa')).toMatchObject({ admin: false });
    const adopte = relu(adopterPrenomAdmin(parAdmin, 'Enzo', cles)!);
    expect(trouverCompte(adopte, 'Enzo')).toEqual({ id: ID_PRINCIPAL, nom: 'Enzo', admin: true });
    expect(trouverCompte(adopte, 'Inconnu')).toBeUndefined();
  });

  it('le prénom d’une amie ne peut pas être adopté par l’administrateur', () => {
    const cles = clesDe(adminNeuf());
    expect(adopterPrenomAdmin(annuaire, 'Léa', cles)).toBeUndefined();
    expect(adopterPrenomAdmin(annuaire, 'admin', cles)).toBeUndefined();
    expect(adopterPrenomAdmin(annuaire, '   ', cles)).toBeUndefined();
  });
});

describe('appareil sans liste des profils (compte unique historique)', () => {
  it('s’ouvre directement ; après l’ajout d’un ami, le prénom de l’administrateur l’ouvre encore', () => {
    const vide = lireAnnuaire(undefined);
    expect(aDesAmis(vide)).toBe(false);
    expect(adminSansPrenom(vide)).toBe(true);
    const admin = adminNeuf();
    const cles = clesDe(admin);
    const vue = ouvrirAnnuaireAdmin(vide, cles);
    const avecAmi = relu(appliquerProfilsAdmin(vue.annuaire, ajouterProfil(vue.profils, 'Hugo', 'hugo000002', '2026-09-29'), cles));
    expect(aDesAmis(avecAmi)).toBe(true);
    // Toujours « Moi » dans l'annuaire : le prénom saisi mène à lui.
    expect(trouverCompte(avecAmi, 'Enzo')).toMatchObject({ id: ID_PRINCIPAL, admin: true, prenomAAdopter: 'Enzo' });
    expect(trouverCompte(avecAmi, 'Hugo')).toMatchObject({ id: 'hugo000002', admin: false });
    const adopte = relu(adopterPrenomAdmin(avecAmi, 'Enzo', cles)!);
    expect(trouverCompte(adopte, 'Enzo')).toEqual({ id: ID_PRINCIPAL, nom: 'Enzo', admin: true });
    expect(trouverCompte(adopte, 'Hugo')).toMatchObject({ id: 'hugo000002' });
    expect(trouverCompte(adopte, 'Paul')).toBeUndefined();
  });
});

describe('coffre de l’administrateur créé par 14a6bea', () => {
  it('se déverrouille avec ses identifiants d’avant, par le compte que trouve son prénom', () => {
    const annuaire = lireAnnuaire(PROFILS_14A6BEA);
    const trouve = trouverCompte(annuaire, 'Enzo')!;
    expect(trouve.id).toBe(ID_PRINCIPAL);
    const s = sessionAdmin(JSON.parse(COFFRE_ADMIN_14A6BEA) as Coffre);
    expect(s.statut()).toBe('verrouille');
    s.deverrouiller({ motDePasse: MOT_DE_PASSE_ADMIN, codeTotp: codeTotp(SECRET_TOTP_ADMIN, T) });
    expect(s.statut()).toBe('deverrouille');
    // Et c'est bien lui qui migre l'annuaire, amie comprise.
    const migre = relu(adopterPrenomAdmin(annuaire, trouve.prenomAAdopter!, clesDe(s))!);
    expect(trouverCompte(migre, 'Enzo')).toEqual({ id: ID_PRINCIPAL, nom: 'Enzo', admin: true });
    expect(trouverCompte(migre, 'Léa')?.id).toBe(ID_AMIE_14A6BEA);
  }, 60_000);
});
