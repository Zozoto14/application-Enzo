/**
 * Déverrouillage avec des identifiants JUSTES qui étaient refusés : erreur
 * technique masquée, saisie collée, horloge décalée, limiteur, coffre publié
 * par le PC après un changement de mot de passe.
 */
import { ouvrirBaseNode } from '../db/pilotes/node';
import { aleatoireDeterministe } from '../securite/aleatoire';
import * as kdf from '../securite/kdf';
import { ErreurCalculCle, ErreurDeverrouillage, type Coffre } from '../securite/coffre';
import { codeTotp, fenetreCourante } from '../securite/totp';
import { messageHorloge } from '../diagnostic/deverrouillage';
import {
  ErreurCoffreDifferent,
  ErreurTemporisation,
  MESSAGE_ECHEC,
  Session,
  normaliserCodeTotp,
  variantesMotDePasse,
} from './session';
import { stockageMemoire } from './stockage-coffre';

const KDF_RAPIDE: kdf.ParametresKdf = { algorithme: 'argon2id', passes: 1, memoireKio: 64, fils: 1, longueurCle: 32 };
// Début d'une fenêtre TOTP + 15 s : les décalages testés tombent sans ambiguïté.
const DEPART = (fenetreCourante(1_700_000_000_000) + 1) * 30_000 + 15_000;

function contexte(o: { motDePasse?: string; coffresAlternatifs?: () => Coffre[]; cleBase?: { attendue?: string }; graine?: number } = {}) {
  let maintenant = DEPART;
  const stockage = stockageMemoire();
  const cleBase = o.cleBase;
  const session = new Session({
    stockage,
    // Base « scellée » : seule la première clé qui l'a ouverte la rouvre (comme sur le bureau).
    ouvrirBase: cle => {
      if (cleBase) {
        cleBase.attendue ??= cle;
        if (cleBase.attendue !== cle) throw new Error('invalid tag');
      }
      return ouvrirBaseNode();
    },
    reinitialiserBase: () => {
      if (cleBase) cleBase.attendue = undefined;
    },
    horloge: () => maintenant,
    alea: aleatoireDeterministe(o.graine ?? 3),
    kdf: KDF_RAPIDE,
    coffresAlternatifs: o.coffresAlternatifs,
  });
  const { secretTotp } = session.initialiser({ motDePasse: o.motDePasse ?? 'cheval-correct-batterie-agrafe' });
  session.verrouiller();
  return {
    session,
    stockage,
    secretTotp,
    code: (decalageMs = 0) => codeTotp(secretTotp, maintenant + decalageMs),
    avancer: (ms: number) => {
      maintenant += ms;
    },
  };
}

afterEach(() => jest.restoreAllMocks());

describe('erreur technique ≠ échec d’authentification', () => {
  it('une dérivation impossible (mémoire refusée par Safari) lève ErreurCalculCle, sans compter de tentative', () => {
    const c = contexte();
    const espion = jest.spyOn(kdf, 'deriverCle').mockImplementation(() => {
      throw new RangeError('Out of memory');
    });
    for (let i = 0; i < 6; i++) {
      let erreur: unknown;
      try {
        c.session.deverrouiller({ motDePasse: 'cheval-correct-batterie-agrafe', codeTotp: c.code() });
      } catch (e) {
        erreur = e;
      }
      expect(erreur).toBeInstanceOf(ErreurCalculCle);
      expect(erreur).not.toBeInstanceOf(ErreurDeverrouillage);
      expect((erreur as Error).message).toMatch(/Impossible de calculer la clé sur cet appareil/);
      // Rien ne dit si le mot de passe est juste.
      expect((erreur as Error).message).not.toMatch(/incorrect/i);
    }
    expect(c.session.verrou().verrouille).toBe(false);
    espion.mockRestore();
    c.session.deverrouiller({ motDePasse: 'cheval-correct-batterie-agrafe', codeTotp: c.code() });
    expect(c.session.statut()).toBe('deverrouille');
  });

  it('un mot de passe faux reste un échec d’authentification au message unique', () => {
    const c = contexte();
    expect(() => c.session.deverrouiller({ motDePasse: 'faux', codeTotp: c.code() })).toThrow(MESSAGE_ECHEC);
    expect(() => c.session.deverrouiller({ motDePasse: 'cheval-correct-batterie-agrafe', codeTotp: '000000' === c.code() ? '111111' : '000000' })).toThrow(MESSAGE_ECHEC);
  });
});

describe('mot de passe collé : formes tolérées, compatibilité préservée', () => {
  it('espace final, retour à la ligne, caractère invisible : accepté', () => {
    const c = contexte();
    for (const colle of ['cheval-correct-batterie-agrafe ', 'cheval-correct-batterie-agrafe\n', '\tcheval-correct-batterie-agrafe\r\n', '​cheval-correct-batterie-agrafe﻿']) {
      c.session.deverrouiller({ motDePasse: colle, codeTotp: c.code() });
      expect(c.session.statut()).toBe('deverrouille');
      c.session.verrouiller();
    }
  });

  it('compatibilité : un mot de passe créé AVEC des espaces de bord s’ouvre toujours tel quel (forme brute essayée d’abord)', () => {
    const c = contexte({ motDePasse: '  espaces voulus  ' });
    c.session.deverrouiller({ motDePasse: '  espaces voulus  ', codeTotp: c.code() });
    expect(c.session.statut()).toBe('deverrouille');
  });

  it('NFC / NFD : un « é » composé ou décomposé ouvre le même coffre', () => {
    const nfc = 'café-crème-été'.normalize('NFC');
    const nfd = nfc.normalize('NFD');
    expect(nfd).not.toBe(nfc);
    const c = contexte({ motDePasse: nfc });
    c.session.deverrouiller({ motDePasse: nfd, codeTotp: c.code() });
    expect(c.session.statut()).toBe('deverrouille');
    // Coffre créé en NFD (ancien appareil) : la saisie brute NFD l'ouvre toujours.
    const d = contexte({ motDePasse: nfd });
    d.session.deverrouiller({ motDePasse: nfd, codeTotp: d.code() });
    expect(d.session.statut()).toBe('deverrouille');
  });

  it('formes essayées : brute d’abord, trois au plus, jamais vide', () => {
    expect(variantesMotDePasse('abc')).toEqual(['abc']);
    expect(variantesMotDePasse(' abc\n')).toEqual([' abc\n', 'abc']);
    expect(variantesMotDePasse('é ')).toEqual(['é ', 'é ', 'é']);
    expect(variantesMotDePasse('   ')).toEqual(['   ']);
  });

  it('une saisie fausse sous plusieurs formes ne compte qu’UNE tentative', () => {
    const c = contexte();
    for (let i = 0; i < 3; i++) {
      expect(() => c.session.deverrouiller({ motDePasse: ' faux\n', codeTotp: c.code() })).toThrow(ErreurDeverrouillage);
    }
    expect(c.session.verrou().verrouille).toBe(false);
  });

  it('code à six chiffres collé « 123 456 », en chiffres pleine chasse ou avec un invisible', () => {
    expect(normaliserCodeTotp('123 456')).toBe('123456');
    expect(normaliserCodeTotp('１２３４５６')).toBe('123456');
    expect(normaliserCodeTotp('​123456\n')).toBe('123456');
    const c = contexte();
    const code = c.code();
    c.session.deverrouiller({ motDePasse: 'cheval-correct-batterie-agrafe', codeTotp: `${code.slice(0, 3)} ${code.slice(3)}` });
    expect(c.session.statut()).toBe('deverrouille');
  });
});

describe('horloge de l’appareil décalée', () => {
  it('±35 s : toléré (fenêtre ±1 pas de 30 s)', () => {
    for (const decalage of [35_000, -35_000]) {
      const c = contexte();
      c.session.deverrouiller({ motDePasse: 'cheval-correct-batterie-agrafe', codeTotp: c.code(decalage) });
      expect(c.session.statut()).toBe('deverrouille');
    }
  });

  it('±90 s : refusé comme un code faux, et l’écart est expliqué', () => {
    for (const decalage of [90_000, -90_000]) {
      const c = contexte();
      expect(() => c.session.deverrouiller({ motDePasse: 'cheval-correct-batterie-agrafe', codeTotp: c.code(decalage) })).toThrow(MESSAGE_ECHEC);
    }
    expect(messageHorloge(-90_000)).toBe(
      'L’heure de cet appareil est décalée de 90 secondes (en retard) : activez le réglage automatique de la date et de l’heure, puis saisissez un nouveau code.',
    );
    expect(messageHorloge(15_000)).toBeUndefined();
    expect(messageHorloge(undefined)).toBeUndefined();
  });
});

describe('limiteur de tentatives', () => {
  it('3 échecs libres, puis 1 s, 2 s… ; le compte à rebours décroît ; un succès remet à zéro', () => {
    const c = contexte();
    const echouer = () => expect(() => c.session.deverrouiller({ motDePasse: 'faux', codeTotp: c.code() })).toThrow(ErreurDeverrouillage);
    echouer();
    echouer();
    echouer();
    expect(c.session.verrou().verrouille).toBe(false);
    echouer();
    expect(c.session.verrou()).toEqual({ verrouille: true, secondesRestantes: 1 });
    expect(() => c.session.deverrouiller({ motDePasse: 'cheval-correct-batterie-agrafe', codeTotp: c.code() })).toThrow(ErreurTemporisation);
    c.avancer(1_000);
    expect(c.session.verrou().verrouille).toBe(false);
    echouer();
    expect(c.session.verrou().secondesRestantes).toBe(2);
    c.avancer(1_100);
    expect(c.session.verrou().secondesRestantes).toBe(1);
    c.avancer(1_000);
    c.session.deverrouiller({ motDePasse: 'cheval-correct-batterie-agrafe', codeTotp: c.code() });
    c.session.verrouiller();
    expect(c.session.verrou().verrouille).toBe(false);
  });
});

describe('coffre publié par le PC (adopterCoffre, mot de passe changé ailleurs)', () => {
  it('régression : le PC change de mot de passe, le navigateur (ancien coffre) s’ouvre avec le NOUVEAU et adopte le coffre publié', () => {
    const pc = contexte({ motDePasse: 'ancien-mot-de-passe-long' });
    const base = { attendue: undefined as string | undefined };
    let publie: Coffre = pc.stockage.lire()!;
    const site = contexte({ coffresAlternatifs: () => [publie], cleBase: base });
    // Le navigateur adopte le coffre du PC (liaison) : base réinitialisée, même clé ensuite.
    site.session.adopterCoffre(pc.stockage.lire()!);
    site.session.deverrouiller({ motDePasse: 'ancien-mot-de-passe-long', codeTotp: pc.code() });
    site.session.verrouiller();

    // Sur le PC : changement de mot de passe, coffre republié.
    pc.session.changerMotDePasse('ancien-mot-de-passe-long', 'nouveau-mot-de-passe-long');
    publie = pc.stockage.lire()!;

    site.session.deverrouiller({ motDePasse: 'nouveau-mot-de-passe-long', codeTotp: pc.code() });
    expect(site.session.statut()).toBe('deverrouille');
    expect(site.stockage.lire()).toEqual(publie);
    expect(site.session.verrou().verrouille).toBe(false);
  });

  it('coffre d’un AUTRE compte publié : identifiants justes pour lui, mais la base d’ici ne s’ouvre pas → message clair, rien d’adopté', () => {
    const autre = contexte({ motDePasse: 'compte-du-pc-tres-long', graine: 99 });
    const site = contexte({ motDePasse: 'compte-cree-ici-autrefois', coffresAlternatifs: () => [autre.stockage.lire()!], cleBase: { attendue: undefined } });
    // La base d'ici a été ouverte par la clé du coffre d'ici (initialiser).
    const avant = site.stockage.lire();
    expect(() => site.session.deverrouiller({ motDePasse: 'compte-du-pc-tres-long', codeTotp: autre.code() })).toThrow(ErreurCoffreDifferent);
    expect(site.stockage.lire()).toBe(avant);
    expect(site.session.statut()).toBe('verrouille');
    // Les identifiants du coffre d'ici marchent toujours.
    site.session.deverrouiller({ motDePasse: 'compte-cree-ici-autrefois', codeTotp: site.code() });
    expect(site.session.statut()).toBe('deverrouille');
  });

  it('adopterCoffre refuse un coffre incomplet et ne touche alors à rien', () => {
    const c = contexte();
    const avant = c.stockage.lire();
    expect(() => c.session.adopterCoffre({ version: 1, enveloppes: [{ usage: 'motdepasse' }] } as unknown as Coffre)).toThrow('illisible');
    expect(c.stockage.lire()).toBe(avant);
  });
});
