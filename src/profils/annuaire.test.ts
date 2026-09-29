import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { ouvrirBaseNode } from '../db/pilotes/node';
import { aleatoireDeterministe } from '../securite/aleatoire';
import type { ParametresKdf } from '../securite/kdf';
import { codeTotp } from '../securite/totp';
import {
  cleEnveloppeAcces,
  descellerAvecContexte,
  genererCodeAcces,
  genererPaireSequestre,
  normaliserCode,
  ouvrirDepot,
  scellerPourAdmin,
} from '../securite/sequestre';
import { Session, contexteDerivation } from '../session/session';
import { stockageMemoire } from '../session/stockage-coffre';
import {
  aDesAmis,
  appliquerProfilsAdmin,
  codeAcces,
  deposerSequestre,
  ecrireAnnuaire,
  lireAnnuaire,
  noterConnexionAmi,
  ouvrirAnnuaireAdmin,
  ouvrirSequestre,
  profilAmi,
  regenererCodeAcces,
  revoquerSequestre,
  trouverCompte,
  type ClesAdmin,
} from './annuaire';
import { ajouterProfil, ecrireProfils, lireProfils, ID_PRINCIPAL } from './profils';

const KDF: ParametresKdf = { algorithme: 'argon2id', passes: 1, memoireKio: 64, fils: 1, longueurCle: 32 };
const T = 1_700_000_000_000;

function session(profil: string, graine: number) {
  return new Session({ stockage: stockageMemoire(), ouvrirBase: () => ouvrirBaseNode(), horloge: () => T, alea: aleatoireDeterministe(graine), kdf: KDF, profil });
}

function clesDe(s: Session): ClesAdmin {
  return { annuaire: hexToBytes(s.cleDerivee('annuaire')), sequestre: hexToBytes(s.cleDerivee('sequestre')) };
}

/** Appareil de départ : admin « Enzo » + deux amis, au format 2 (en clair). */
function appareilV2() {
  let liste = lireProfils(undefined).map(p => ({ ...p, nom: 'Enzo' }));
  liste = ajouterProfil(liste, 'Léa', 'lea0000001', '2026-09-01');
  liste = ajouterProfil(liste, 'Hugo', 'hugo000002', '2026-09-02', ['portefeuille']);
  return ecrireProfils(liste);
}

describe('séquestre : briques', () => {
  it('un dépôt ne s’ouvre qu’avec la clé privée et le bon contexte', () => {
    const alea = aleatoireDeterministe(3);
    const paire = genererPaireSequestre(alea);
    const autre = genererPaireSequestre(alea);
    const depot = scellerPourAdmin(bytesToHex(paire.publique), Uint8Array.from([1, 2, 3]), 'test/a', alea);
    expect(Array.from(ouvrirDepot(paire.privee, depot, 'test/a'))).toEqual([1, 2, 3]);
    expect(() => ouvrirDepot(autre.privee, depot, 'test/a')).toThrow();
    expect(() => ouvrirDepot(paire.privee, depot, 'test/b')).toThrow();
  });

  it('la clé d’enveloppe dépend du compte ET du code', () => {
    const { privee } = genererPaireSequestre(aleatoireDeterministe(4));
    const code = genererCodeAcces(aleatoireDeterministe(5));
    expect(code).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    const a = cleEnveloppeAcces(privee, 'lea0000001', code);
    expect(cleEnveloppeAcces(privee, 'lea0000001', code.toLowerCase().replace(/-/g, ' '))).toEqual(a);
    expect(cleEnveloppeAcces(privee, 'hugo000002', code)).not.toEqual(a);
    expect(cleEnveloppeAcces(privee, 'lea0000001', genererCodeAcces(aleatoireDeterministe(6)))).not.toEqual(a);
    expect(normaliserCode(' abcd efgh-2345 6789 ')).toBe('ABCD-EFGH-2345-6789');
  });
});

describe('isolation : clés dérivées propres à chaque profil', () => {
  it('le contexte de dérivation contient le profil (le principal garde l’historique)', () => {
    expect(contexteDerivation('synchro', 'principal')).toBe('applibourse/synchro/v1|');
    expect(contexteDerivation('synchro', 'lea0000001')).toBe('applibourse/synchro/profil/lea0000001/v1|');
  });

  it('même clé maîtresse, profils différents : clés d’usage différentes', () => {
    const a = session('lea0000001', 1);
    const b = session('hugo000002', 1);
    a.initialiser({ motDePasse: 'mot-de-passe-assez-long' });
    b.initialiser({ motDePasse: 'mot-de-passe-assez-long' });
    expect(a.cleDerivee('hub')).not.toBe(b.cleDerivee('hub'));
  });
});

describe('annuaire', () => {
  it('la migration retire les prénoms en clair et ne liste plus personne', () => {
    const admin = session(ID_PRINCIPAL, 7);
    admin.initialiser({ motDePasse: 'mot-de-passe-admin-long' });
    const avant = lireAnnuaire(appareilV2());
    expect(avant.heritage).toHaveLength(3);
    const vue = ouvrirAnnuaireAdmin(avant, clesDe(admin), aleatoireDeterministe(8));
    expect(vue.modifie).toBe(true);
    expect(vue.profils.map(p => p.nom)).toEqual(['Enzo', 'Léa', 'Hugo']);
    const disque = ecrireAnnuaire(vue.annuaire);
    expect(disque).not.toMatch(/Léa|Hugo|Enzo/);
    const relu = lireAnnuaire(disque);
    expect(aDesAmis(relu)).toBe(true);
    // On retrouve un compte par son prénom (sans accents ni casse)…
    expect(trouverCompte(relu, ' lea ')).toEqual({ id: 'lea0000001', nom: 'Léa', admin: false });
    expect(trouverCompte(relu, 'enzo')).toMatchObject({ id: ID_PRINCIPAL, admin: true, nom: 'Enzo' });
    expect(trouverCompte(relu, 'admin')).toMatchObject({ id: ID_PRINCIPAL, admin: true });
    // … et un prénom inconnu ne dit rien.
    expect(trouverCompte(relu, 'Zoé')).toBeUndefined();
  });

  it('un ami ne voit que lui-même : aucun autre compte, aucune donnée de l’admin', () => {
    const admin = session(ID_PRINCIPAL, 7);
    admin.initialiser({ motDePasse: 'mot-de-passe-admin-long' });
    const { annuaire } = ouvrirAnnuaireAdmin(lireAnnuaire(appareilV2()), clesDe(admin), aleatoireDeterministe(8));
    const vu = profilAmi(lireAnnuaire(ecrireAnnuaire(annuaire)), 'lea0000001', 'Léa');
    expect(vu).toEqual({ id: 'lea0000001', nom: 'Léa', admin: false, creeLe: '', apps: ['portefeuille'], actif: true });
    expect(JSON.stringify(vu)).not.toMatch(/Hugo|hugo000002|Enzo|politique/);
  });

  it('le bloc privé ne s’ouvre pas avec les clés d’un ami', () => {
    const admin = session(ID_PRINCIPAL, 7);
    admin.initialiser({ motDePasse: 'mot-de-passe-admin-long' });
    const { annuaire } = ouvrirAnnuaireAdmin(lireAnnuaire(appareilV2()), clesDe(admin), aleatoireDeterministe(8));
    const ami = session('lea0000001', 9);
    ami.initialiser({ motDePasse: 'mot-de-passe-ami-long' });
    expect(() => ouvrirAnnuaireAdmin(annuaire, clesDe(ami))).toThrow(/illisible|séquestre|clé/i);
    expect(() => codeAcces(annuaire, 'hugo000002', clesDe(ami))).toThrow();
  });
});

describe('séquestre de bout en bout', () => {
  function monter() {
    const admin = session(ID_PRINCIPAL, 11);
    admin.initialiser({ motDePasse: 'mot-de-passe-admin-long' });
    const cles = clesDe(admin);
    let annuaire = ouvrirAnnuaireAdmin(lireAnnuaire(appareilV2()), cles, aleatoireDeterministe(12)).annuaire;
    // Léa se connecte : elle dépose sa clé pour l'admin, sans pouvoir la relire.
    const lea = session('lea0000001', 13);
    const init = lea.initialiser({ motDePasse: 'mot-de-passe-lea-long' });
    const connexion = noterConnexionAmi(annuaire, 'lea0000001', new Date(T).toISOString(), 1, pub => lea.deposerPourSequestre(pub, 'lea0000001'));
    expect(connexion.comptes.find(c => c.id === 'lea0000001')?.sequestre.etat).toBe('depose');
    annuaire = lireAnnuaire(ecrireAnnuaire(connexion));
    return { admin, cles, annuaire, lea, init };
  }

  it('l’admin convertit le dépôt, obtient un code, et ouvre le compte avec', () => {
    const { cles, annuaire, lea, init } = monter();
    const vue = ouvrirAnnuaireAdmin(annuaire, cles, aleatoireDeterministe(14));
    const profilLea = vue.profils.find(p => p.id === 'lea0000001')!;
    expect(profilLea.sequestre).toBe('actif');
    expect(profilLea.connexions).toBe(1);
    expect(vue.profils.find(p => p.id === 'hugo000002')?.sequestre).toBe('attendu');
    const { code } = codeAcces(vue.annuaire, 'lea0000001', cles)!;
    expect(() => ouvrirSequestre(vue.annuaire, 'lea0000001', 'AAAA-BBBB-CCCC-DDDD', cles)).toThrow(/incorrect/);
    const cle = ouvrirSequestre(vue.annuaire, 'lea0000001', code, cles);
    // La clé ouvre bien le coffre de Léa, dans une session neuve.
    const coffreLea = lea.coffreActuel()!;
    const autre = new Session({ stockage: stockageMemoire(coffreLea), ouvrirBase: () => ouvrirBaseNode(), profil: 'lea0000001' });
    autre.ouvrirAvecCle(cle);
    expect(autre.statut()).toBe('deverrouille');
    expect(autre.cleDerivee('x')).toBe(lea.cleDerivee('x'));
    // Le mot de passe et le TOTP de Léa sont inchangés.
    autre.verrouiller();
    lea.verrouiller();
    lea.deverrouiller({ motDePasse: 'mot-de-passe-lea-long', codeTotp: codeTotp(init.secretTotp, T) });
    expect(lea.statut()).toBe('deverrouille');
  });

  it('une clé fausse ne rouvre pas un coffre', () => {
    const { lea } = monter();
    const autre = new Session({ stockage: stockageMemoire(lea.coffreActuel()), ouvrirBase: () => ouvrirBaseNode() });
    expect(() => autre.ouvrirAvecCle(new Uint8Array(32).fill(7))).toThrow(/refusée/);
    expect(autre.statut()).toBe('verrouille');
  });

  it('régénérer le code invalide l’ancien ; révoquer ferme l’accès', () => {
    const { cles, annuaire } = monter();
    let a = ouvrirAnnuaireAdmin(annuaire, cles, aleatoireDeterministe(15)).annuaire;
    const ancien = codeAcces(a, 'lea0000001', cles)!.code;
    const r = regenererCodeAcces(a, 'lea0000001', cles, aleatoireDeterministe(16));
    a = r.annuaire;
    expect(r.code).not.toBe(ancien);
    expect(() => ouvrirSequestre(a, 'lea0000001', ancien, cles)).toThrow(/incorrect/);
    ouvrirSequestre(a, 'lea0000001', r.code, cles).fill(0);
    a = revoquerSequestre(a, 'lea0000001', cles);
    expect(() => ouvrirSequestre(a, 'lea0000001', r.code, cles)).toThrow(/révoqué/);
    // Un compte révoqué ne redépose pas à la connexion suivante.
    const apres = noterConnexionAmi(a, 'lea0000001', new Date(T).toISOString(), 2, () => 'jamais');
    expect(apres.comptes.find(c => c.id === 'lea0000001')?.sequestre.etat).toBe('revoque');
  });

  it('une enveloppe d’un compte ne sert pas pour un autre', () => {
    const { cles, annuaire } = monter();
    const a = ouvrirAnnuaireAdmin(annuaire, cles, aleatoireDeterministe(17)).annuaire;
    const code = codeAcces(a, 'lea0000001', cles)!.code;
    const lea = a.comptes.find(c => c.id === 'lea0000001')!;
    const falsifie = { ...a, comptes: a.comptes.map(c => (c.id === 'hugo000002' ? { ...c, sequestre: lea.sequestre } : c)) };
    expect(() => ouvrirSequestre(falsifie, 'hugo000002', code, cles)).toThrow(/incorrect/);
  });

  it('l’ami ne peut pas relire son propre suivi ni son dépôt (réservés à l’admin)', () => {
    const { annuaire, lea } = monter();
    const entree = annuaire.comptes.find(c => c.id === 'lea0000001')!;
    const cleLea = hexToBytes(lea.cleDerivee('sequestre'));
    expect(() => ouvrirDepot(cleLea, entree.sequestre.depot!, 'sequestre/cle-maitresse/lea0000001')).toThrow();
    expect(() => descellerAvecContexte(cleLea, entree.suivi!.split('.')[1], 'annuaire/suivi/lea0000001')).toThrow();
  });

  it('régénération des identifiants : nouveau dépôt, nouvelle clé, l’admin suit', () => {
    const { cles, annuaire } = monter();
    let a = ouvrirAnnuaireAdmin(annuaire, cles, aleatoireDeterministe(18)).annuaire;
    const neuf = session('lea0000001', 19);
    neuf.initialiser({ motDePasse: 'nouveau-mot-de-passe-long' });
    a = deposerSequestre(a, 'lea0000001', neuf.deposerPourSequestre(a.admin.cleSequestre!, 'lea0000001'));
    a = ouvrirAnnuaireAdmin(a, cles, aleatoireDeterministe(20)).annuaire;
    const cle = ouvrirSequestre(a, 'lea0000001', codeAcces(a, 'lea0000001', cles)!.code, cles);
    const autre = new Session({ stockage: stockageMemoire(neuf.coffreActuel()), ouvrirBase: () => ouvrirBaseNode(), profil: 'lea0000001' });
    autre.ouvrirAvecCle(cle);
    expect(autre.cleDerivee('x')).toBe(neuf.cleDerivee('x'));
  });

  it('modifier les accès, renommer, supprimer : le bloc privé suit, aucun prénom en clair', () => {
    const { cles, annuaire } = monter();
    const vue = ouvrirAnnuaireAdmin(annuaire, cles, aleatoireDeterministe(21));
    const suivants = vue.profils
      .filter(p => p.id !== 'hugo000002')
      .map(p => (p.id === 'lea0000001' ? { ...p, nom: 'Léane', actif: false } : p));
    const a = appliquerProfilsAdmin(vue.annuaire, suivants, cles, aleatoireDeterministe(22));
    const disque = ecrireAnnuaire(a);
    expect(disque).not.toMatch(/Léane|Hugo|hugo000002/);
    const relu = lireAnnuaire(disque);
    expect(trouverCompte(relu, 'Léa')).toBeUndefined();
    expect(trouverCompte(relu, 'leane')).toMatchObject({ id: 'lea0000001', nom: 'Léane' });
    expect(profilAmi(relu, 'lea0000001', 'Léane').actif).toBe(false);
    expect(ouvrirAnnuaireAdmin(relu, cles).profils.map(p => p.nom)).toEqual(['Enzo', 'Léane']);
    expect(() => appliquerProfilsAdmin(relu, [...ouvrirAnnuaireAdmin(relu, cles).profils, { id: 'zzzzzz9999', nom: 'admin', admin: false, creeLe: '' }], cles)).toThrow(/réservé/);
  });
});
