import { hexToBytes } from '@noble/hashes/utils.js';
import { ouvrirBaseNode } from '../db/pilotes/node';
import { definirRolePar } from '../hub/admin/actions';
import { roleDe } from '../hub/admin/roles';
import { aleatoireDeterministe } from '../securite/aleatoire';
import type { ParametresKdf } from '../securite/kdf';
import { Session } from '../session/session';
import { stockageMemoire } from '../session/stockage-coffre';
import {
  adopterPrenomAdmin,
  ajouterCompteGere,
  ajouterEvenementGestion,
  apercuAnonyme,
  appliquerAccesGeres,
  appliquerProfilsAdmin,
  compteGere,
  ecrireAnnuaire,
  lireAnnuaire,
  ouvrirAnnuaireAdmin,
  profilAmi,
  roleDuCompte,
  type Annuaire,
  type ClesAdmin,
} from './annuaire';
import { ajouterProfil, ecrireProfils, lireProfils, type Profil } from './profils';

const KDF: ParametresKdf = { algorithme: 'argon2id', passes: 1, memoireKio: 64, fils: 1, longueurCle: 32 };
const T = 1_700_000_000_000;
const MAINTENANT = new Date(T).toISOString();

function cles(): ClesAdmin {
  const s = new Session({ stockage: stockageMemoire(), ouvrirBase: () => ouvrirBaseNode(), horloge: () => T, alea: aleatoireDeterministe(1), kdf: KDF, profil: 'principal' });
  s.initialiser({ motDePasse: 'mot-de-passe-assez-long' });
  return { annuaire: hexToBytes(s.cleDerivee('annuaire')), sequestre: hexToBytes(s.cleDerivee('sequestre')) };
}

/** Appareil migré : admin « Enzo », amis Léa (promue gestionnaire) et Hugo. */
function appareil() {
  const k = cles();
  let liste = lireProfils(undefined).map(p => ({ ...p, nom: 'Enzo' }));
  liste = ajouterProfil(liste, 'Léa', 'lea0000001', '2026-09-01');
  liste = ajouterProfil(liste, 'Hugo', 'hugo000002', '2026-09-02', ['portefeuille']);
  const vue = ouvrirAnnuaireAdmin(lireAnnuaire(ecrireProfils(liste)), k, aleatoireDeterministe(2), MAINTENANT);
  const admin = vue.profils[0];
  const promus = definirRolePar(admin, vue.profils, 'lea0000001', 'gestionnaire');
  const annuaire = appliquerProfilsAdmin(vue.annuaire, promus, k, aleatoireDeterministe(3));
  return { k, annuaire, admin };
}

describe('rôle : migration et persistance', () => {
  it('une liste enregistrée sans rôle migre avec le rôle « ami », sans perte, et de façon idempotente', () => {
    let liste = lireProfils(undefined);
    liste = ajouterProfil(liste, 'Léa', 'lea0000001', '2026-09-01', ['portefeuille'], { invitationExpireLe: '2026-10-01T00:00:00.000Z' });
    const ancien = ecrireProfils(liste);
    expect(ancien).not.toContain('"role"');
    const lue = lireProfils(ancien);
    expect(roleDe(lue[1])).toBe('ami');
    expect(lue[1]).toMatchObject({ nom: 'Léa', apps: ['portefeuille'], invitationExpireLe: '2026-10-01T00:00:00.000Z', actif: true });
    // lire ∘ écrire ∘ lire = lire, et la relecture ne change plus rien.
    expect(lireProfils(ecrireProfils(lue))).toEqual(lue);
    expect(ecrireProfils(lireProfils(ecrireProfils(lue)))).toBe(ecrireProfils(lue));
  });

  it('le rôle gestionnaire survit à l’écriture ; une valeur inconnue retombe sur « ami »', () => {
    const liste = ajouterProfil(lireProfils(undefined), 'Léa', 'lea0000001', '2026-09-01');
    const promu = liste.map(p => (p.id === 'lea0000001' ? { ...p, role: 'gestionnaire' as const } : p));
    expect(roleDe(lireProfils(ecrireProfils(promu))[1])).toBe('gestionnaire');
    const truque = JSON.parse(ecrireProfils(promu));
    truque[1].role = 'admin';
    expect(roleDe(lireProfils(JSON.stringify(truque))[1])).toBe('ami');
  });

  it('un ancien annuaire au format 3 (sans rôle) se relit avec des amis ordinaires', () => {
    const { annuaire } = appareil();
    const brut = JSON.parse(ecrireAnnuaire(annuaire));
    for (const c of brut.comptes) delete c.acces.role;
    const relu = lireAnnuaire(JSON.stringify(brut));
    expect(relu.comptes.every(c => roleDuCompte(relu, c.id) === 'ami')).toBe(true);
    expect(lireAnnuaire(ecrireAnnuaire(relu))).toEqual(relu);
  });

  it('la promotion est portée par l’annuaire : l’ami promu la lit à sa connexion, pas les autres', () => {
    const { annuaire } = appareil();
    expect(roleDuCompte(annuaire, 'lea0000001')).toBe('gestionnaire');
    expect(profilAmi(annuaire, 'lea0000001', 'Léa').role).toBe('gestionnaire');
    expect(profilAmi(annuaire, 'hugo000002', 'Hugo').role).toBeUndefined();
  });

  it('la rétrogradation retire le rôle', () => {
    const { k, annuaire } = appareil();
    const vue = ouvrirAnnuaireAdmin(annuaire, k, aleatoireDeterministe(4), MAINTENANT);
    expect(roleDe(vue.profils.find(p => p.id === 'lea0000001'))).toBe('gestionnaire');
    const admin = vue.profils[0];
    const suivant = appliquerProfilsAdmin(vue.annuaire, definirRolePar(admin, vue.profils, 'lea0000001', 'ami'), k, aleatoireDeterministe(5));
    expect(roleDuCompte(suivant, 'lea0000001')).toBe('ami');
  });
});

describe('gestionnaire : ce que l’annuaire lui permet', () => {
  const nouveau = { id: 'zoe0000003', nom: 'Zoé', gestionnaireId: 'lea0000001', apps: ['portefeuille'] };

  it('crée un ami : l’annuaire ne contient jamais son prénom en clair, l’administrateur le retrouve avec le créateur', () => {
    const { k, annuaire } = appareil();
    const apres = ajouterCompteGere(annuaire, nouveau, MAINTENANT, aleatoireDeterministe(6));
    const brut = ecrireAnnuaire(apres);
    expect(brut).not.toContain('Zoé');
    expect(brut).not.toContain('Léa');
    expect(roleDuCompte(apres, 'zoe0000003')).toBe('ami');
    const vue = ouvrirAnnuaireAdmin(lireAnnuaire(brut), k, aleatoireDeterministe(7), MAINTENANT);
    const zoe = vue.profils.find(p => p.id === 'zoe0000003') as Profil;
    expect(zoe.nom).toBe('Zoé');
    expect(zoe.creePar).toBe('lea0000001');
    expect(zoe.creeLe).toBe(MAINTENANT.slice(0, 10));
    expect(vue.annuaire.comptes.find(c => c.id === 'zoe0000003')?.creation).toBeUndefined();
    // Et la relecture ne perd rien.
    const encore = ouvrirAnnuaireAdmin(lireAnnuaire(ecrireAnnuaire(vue.annuaire)), k, aleatoireDeterministe(8), MAINTENANT);
    expect(encore.profils.find(p => p.id === 'zoe0000003')?.creePar).toBe('lea0000001');
  });

  it('un prénom déjà pris (ou réservé) est refusé sans dire lequel', () => {
    const { annuaire } = appareil();
    for (const nom of ['Hugo', 'hugo', 'Enzo', 'Admin']) {
      expect(() => ajouterCompteGere(annuaire, { ...nouveau, nom }, MAINTENANT)).toThrow('Ce prénom n’est pas disponible');
    }
  });

  it('un simple ami (ou un compte inconnu) ne peut ni créer, ni régler, ni journaliser', () => {
    const { annuaire } = appareil();
    expect(() => ajouterCompteGere(annuaire, { ...nouveau, gestionnaireId: 'hugo000002' }, MAINTENANT)).toThrow('pas gestionnaire');
    expect(() => appliquerAccesGeres(annuaire, 'hugo000002', [], new Set())).toThrow('pas gestionnaire');
    expect(() => ajouterEvenementGestion(annuaire, 'hugo000002', { type: 'compte', action: 'x', date: MAINTENANT })).toThrow('pas gestionnaire');
    expect(() => ajouterCompteGere(annuaire, { ...nouveau, gestionnaireId: 'inconnu0001' }, MAINTENANT)).toThrow();
  });

  it('ne modifie que l’accès des comptes qu’il gère : ni lui-même, ni un autre gestionnaire, ni un compte hors carnet', () => {
    const { k, annuaire } = appareil();
    const avec = ajouterCompteGere(annuaire, nouveau, MAINTENANT, aleatoireDeterministe(6));
    const zoe = compteGere(avec, 'zoe0000003', 'Zoé', 'lea0000001') as Profil;
    const ids = new Set(['zoe0000003']);
    // Autorisé : couper l'accès de Zoé.
    const coupe = appliquerAccesGeres(avec, 'lea0000001', [{ ...zoe, actif: false, apps: [] }], ids);
    expect(coupe.comptes.find(c => c.id === 'zoe0000003')?.acces).toMatchObject({ actif: false, apps: [] });
    // Rien d'autre ne bouge : Hugo, Léa, séquestres, politique, bloc privé, clés.
    expect(coupe.comptes.find(c => c.id === 'hugo000002')).toEqual(avec.comptes.find(c => c.id === 'hugo000002'));
    expect(coupe.comptes.find(c => c.id === 'lea0000001')).toEqual(avec.comptes.find(c => c.id === 'lea0000001'));
    expect(coupe.prive).toBe(avec.prive);
    expect(coupe.admin).toEqual(avec.admin);
    expect(coupe.politique).toEqual(avec.politique);
    // Refusé : Hugo (hors carnet), Léa elle-même.
    const hugo = { id: 'hugo000002', nom: 'Hugo', admin: false, creeLe: '', apps: ['portefeuille'], actif: false } as Profil;
    expect(() => appliquerAccesGeres(avec, 'lea0000001', [hugo], ids)).toThrow('ne fait pas partie');
    const lea = { id: 'lea0000001', nom: 'Léa', admin: false, creeLe: '', apps: ['portefeuille'], actif: true, role: 'ami' } as Profil;
    expect(() => appliquerAccesGeres(avec, 'lea0000001', [lea], new Set(['lea0000001']))).toThrow('ne fait pas partie');
    // Refusé : un compte du carnet devenu gestionnaire entre-temps.
    const promu = appliquerProfilsAdmin(
      ouvrirAnnuaireAdmin(avec, k, aleatoireDeterministe(9), MAINTENANT).annuaire,
      definirRolePar(
        { id: 'principal', admin: true },
        ouvrirAnnuaireAdmin(avec, k, aleatoireDeterministe(9), MAINTENANT).profils,
        'zoe0000003',
        'gestionnaire',
      ),
      k,
      aleatoireDeterministe(10),
    );
    expect(() => appliquerAccesGeres(promu, 'lea0000001', [zoe], ids)).toThrow('ne peut pas agir');
  });

  it('un gestionnaire ne peut pas s’attribuer le rôle en passant par l’écriture des accès', () => {
    const { annuaire } = appareil();
    const avec = ajouterCompteGere(annuaire, nouveau, MAINTENANT, aleatoireDeterministe(6));
    const zoe = { ...(compteGere(avec, 'zoe0000003', 'Zoé', 'lea0000001') as Profil), role: 'gestionnaire' as const };
    const suivant = appliquerAccesGeres(avec, 'lea0000001', [zoe], new Set(['zoe0000003']));
    expect(roleDuCompte(suivant, 'zoe0000003')).toBe('ami');
  });

  it('ses actions arrivent au journal de l’administrateur, avec son nom, puis la file est vidée', () => {
    const { k, annuaire } = appareil();
    let a: Annuaire = ajouterCompteGere(annuaire, nouveau, MAINTENANT, aleatoireDeterministe(6));
    a = ajouterEvenementGestion(a, 'lea0000001', { type: 'compte', action: 'Compte de Zoé créé', cible: 'zoe0000003', nomCible: 'Zoé', date: MAINTENANT }, aleatoireDeterministe(11));
    a = ajouterEvenementGestion(a, 'lea0000001', { type: 'permissions', action: 'Accès réglé', cible: 'zoe0000003', date: MAINTENANT }, aleatoireDeterministe(12));
    expect(ecrireAnnuaire(a)).not.toContain('Compte de Zoé');
    const vue = ouvrirAnnuaireAdmin(lireAnnuaire(ecrireAnnuaire(a)), k, aleatoireDeterministe(13), MAINTENANT);
    expect(vue.evenementsGestion.map(e => [e.type, e.acteur])).toEqual([
      ['compte', 'Léa'],
      ['permissions', 'Léa'],
    ]);
    expect(vue.annuaire.journalGestion).toBeUndefined();
    expect(ouvrirAnnuaireAdmin(vue.annuaire, k, aleatoireDeterministe(14), MAINTENANT).evenementsGestion).toEqual([]);
  });

  it('l’adoption du prénom de l’administrateur ne perd pas les actions en attente', () => {
    const { k, annuaire } = appareil();
    const avec = ajouterEvenementGestion(annuaire, 'lea0000001', { type: 'compte', action: 'Action en attente', date: MAINTENANT }, aleatoireDeterministe(21));
    // Administrateur historique sans prénom : « Moi » (jamais nommé).
    const sansPrenom = { ...avec, admin: { ...avec.admin, empreinte: undefined, nom: undefined } };
    const adopte = adopterPrenomAdmin(sansPrenom, 'Enzo', k, aleatoireDeterministe(22), MAINTENANT);
    expect(adopte).toBeDefined();
    const vue = ouvrirAnnuaireAdmin(adopte as Annuaire, k, aleatoireDeterministe(23), MAINTENANT);
    expect(vue.evenementsGestion.map(e => e.action)).toEqual(['Action en attente']);
  });

  it('un dépôt de journal signé d’un non-gestionnaire est ignoré, et aucun secret ne passe', () => {
    const { k, annuaire } = appareil();
    // Un ami quelconque fabrique une entrée avec la clé publique : la vérification est côté administrateur.
    const faux = { ...annuaire, comptes: annuaire.comptes.map(c => (c.id === 'hugo000002' ? { ...c, acces: { ...c.acces, role: 'gestionnaire' as const } } : c)) };
    const forge = ajouterEvenementGestion(faux, 'hugo000002', { type: 'compte', action: 'Faux', date: MAINTENANT });
    const vue = ouvrirAnnuaireAdmin(lireAnnuaire(ecrireAnnuaire({ ...forge, comptes: annuaire.comptes })), k, aleatoireDeterministe(15), MAINTENANT);
    expect(vue.evenementsGestion).toEqual([]);
    let a = ajouterEvenementGestion(annuaire, 'lea0000001', { type: 'identifiants', action: 'Régénéré : abcde-FGHJK-23456-mnpqr', date: MAINTENANT });
    a = lireAnnuaire(ecrireAnnuaire(a));
    const propre = ouvrirAnnuaireAdmin(a, k, aleatoireDeterministe(16), MAINTENANT).evenementsGestion;
    expect(propre[0].action).not.toContain('abcde-FGHJK');
  });

  it('un dépôt de création ne remplace jamais un prénom déjà connu de l’administrateur', () => {
    const { k, annuaire } = appareil();
    const vue = ouvrirAnnuaireAdmin(annuaire, k, aleatoireDeterministe(17), MAINTENANT);
    const avec = ajouterCompteGere(vue.annuaire, nouveau, MAINTENANT, aleatoireDeterministe(18));
    const ouvert = ouvrirAnnuaireAdmin(avec, k, aleatoireDeterministe(19), MAINTENANT);
    // Rejeu d'un vieux dépôt de création sur un compte connu : ignoré.
    const rejoue = { ...ouvert.annuaire, comptes: ouvert.annuaire.comptes.map(c => (c.id === 'zoe0000003' ? { ...c, creation: avec.comptes.find(x => x.id === 'zoe0000003')?.creation } : c)) };
    const encore = ouvrirAnnuaireAdmin(rejoue, k, aleatoireDeterministe(20), MAINTENANT);
    expect(encore.profils.find(p => p.id === 'zoe0000003')?.nom).toBe('Zoé');
  });
});

describe('isolation : ce qu’un gestionnaire reçoit', () => {
  it('l’aperçu des comptes ne porte aucun prénom (chiffres seulement)', () => {
    const { annuaire } = appareil();
    const avec = ajouterCompteGere(annuaire, { id: 'zoe0000003', nom: 'Zoé', gestionnaireId: 'lea0000001', apps: ['portefeuille'] }, MAINTENANT, aleatoireDeterministe(6));
    const apercu = apercuAnonyme(avec);
    expect(apercu).toHaveLength(4);
    const texte = JSON.stringify(apercu);
    for (const nom of ['Léa', 'Hugo', 'Zoé', 'Enzo']) {
      expect(texte).not.toContain(nom);
    }
    expect(apercu.filter(p => p.admin)).toHaveLength(1);
  });

  it('le fichier de l’annuaire ne nomme personne, gestionnaire compris', () => {
    const { annuaire } = appareil();
    const brut = ecrireAnnuaire(annuaire);
    for (const nom of ['Léa', 'Hugo', 'Enzo']) {
      expect(brut).not.toContain(nom);
    }
  });

  it('un gestionnaire ne voit un compte de l’annuaire que sous le prénom qu’il a lui-même saisi', () => {
    const { annuaire } = appareil();
    expect(compteGere(annuaire, 'hugo000002', 'Hugo', 'lea0000001')?.nom).toBe('Hugo');
    expect(compteGere(annuaire, 'absent00001', 'X', 'lea0000001')).toBeUndefined();
    // Le carnet (voir gestion.ts) est le seul lieu où ce prénom vit : l'annuaire, lui, reste muet.
    expect(ecrireAnnuaire(annuaire)).not.toContain('Hugo');
  });
});
