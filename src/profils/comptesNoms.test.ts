/**
 * « (prénom inconnu) » partout dans Administration › Utilisateurs (docs/diagnostic-comptes.md).
 *
 * Cause : le bloc privé de l'annuaire (prénoms, dates, codes d'accès, scellé pour le Fondateur)
 * était écarté EN SILENCE à la relecture au-delà de 4096 caractères, soit dès ~14 comptes dont le
 * séquestre est actif. Le texte de remplacement était ensuite rescellé comme prénom à la moindre
 * modification (empreinte du compte changée, ou « prénom déjà pris » pour deux comptes), et la
 * synchronisation sans clés laissait un bloc privé en écraser un autre.
 */
import { hexToBytes } from '@noble/hashes/utils.js';
import { ouvrirBaseNode } from '../db/pilotes/node';
import { aleatoireDeterministe } from '../securite/aleatoire';
import type { ParametresKdf } from '../securite/kdf';
import { empreinteNom } from '../securite/sequestre';
import { Session } from '../session/session';
import { stockageMemoire } from '../session/stockage-coffre';
import { etatLwwVide, noterLocal, fusionner } from '../sync/relais/fusionLww';
import {
  TAILLE_MAX_BLOC_PRIVE,
  appliquerProfilsAdmin,
  deposerSequestre,
  ecrireAnnuaire,
  lireAnnuaire,
  ouvrirAnnuaireAdmin,
  reparerNomsAdmin,
  trouverCompte,
  type Annuaire,
  type ClesAdmin,
} from './annuaire';
import { NOM_INCONNU, ajouterProfil, renommerProfil } from './profils';
import { entitesAnnuaire, fusionnerAnnuaire } from './synchroAnnuaire';

const KDF: ParametresKdf = { algorithme: 'argon2id', passes: 1, memoireKio: 64, fils: 1, longueurCle: 32 };
const T = 1_700_000_000_000;
const session = (profil: string, graine: number) =>
  new Session({ stockage: stockageMemoire(), ouvrirBase: () => ouvrirBaseNode(), horloge: () => T, alea: aleatoireDeterministe(graine), kdf: KDF, profil });

const admin = session('principal', 1);
admin.initialiser({ motDePasse: 'mot-de-passe-admin-long' });
const cles = (): ClesAdmin => ({ annuaire: hexToBytes(admin.cleDerivee('annuaire')), sequestre: hexToBytes(admin.cleDerivee('sequestre')) });
const ami = session('ami0000001', 2);
ami.initialiser({ motDePasse: 'mot-de-passe-ami-long' });

const PSEUDOS = ['Kaizen', 'Lyra', 'Neo_77', 'Mira.v', 'Zéphyr', 'Tom-B', 'Ayaka', 'Rook', 'Vex', 'Nami', 'Orion', 'Sol', 'Juno', 'Kenji', 'Lou', 'Iris', 'Hugo'];
const idDe = (i: number) => `esp${String(i).padStart(7, '0')}`;
const relire = (a: Annuaire) => lireAnnuaire(ecrireAnnuaire(a));

/** Un club réaliste : 17 comptes Esport créés par le Fondateur, chacun connecté une fois (séquestre converti, code d'accès). */
function club(): Annuaire {
  const alea = aleatoireDeterministe(7);
  let vue = ouvrirAnnuaireAdmin(lireAnnuaire(undefined), cles(), alea);
  let a = vue.annuaire;
  PSEUDOS.forEach((pseudo, i) => {
    vue = ouvrirAnnuaireAdmin(a, cles(), alea);
    a = appliquerProfilsAdmin(vue.annuaire, ajouterProfil(vue.profils, pseudo, idDe(i), '2026-10-01', ['esport']), cles(), alea);
    a = deposerSequestre(a, idDe(i), ami.deposerPourSequestre(a.admin.cleSequestre!, idDe(i)));
  });
  // Ouverture par le Fondateur : dépôts convertis en enveloppes + codes d'accès (le bloc privé grossit).
  return ouvrirAnnuaireAdmin(a, cles(), alea).annuaire;
}

describe('bloc privé : taille', () => {
  const a = club();
  it('au-delà de 4096 caractères (17 comptes avec code d’accès), il survit à l’écriture et à la relecture', () => {
    expect(a.prive!.length).toBeGreaterThan(4096);
    expect(a.prive!.length).toBeLessThan(TAILLE_MAX_BLOC_PRIVE);
    const relu = relire(a);
    expect(relu.prive).toBe(a.prive);
    const vue = ouvrirAnnuaireAdmin(relu, cles(), aleatoireDeterministe(8));
    expect(vue.profils.filter(p => p.nomInconnu)).toEqual([]);
    expect(vue.profils.slice(1).map(p => p.nom)).toEqual(PSEUDOS);
  });
  it('et voyage tel quel dans la synchronisation (entités puis annuaire recomposé)', () => {
    const doc = fusionner(entitesAnnuaire(a), noterLocal(etatLwwVide(), entitesAnnuaire(a), new Date(T).toISOString()), undefined);
    expect(doc.document.entites.prive).toBe(a.prive);
  });
});

describe('prénom inconnu : jamais enregistré comme prénom', () => {
  const a = club();
  const perdu: Annuaire = { ...a, prive: undefined };
  it('affiché « (prénom inconnu) » et marqué, mais une modification ne le scelle pas', () => {
    const vue = ouvrirAnnuaireAdmin(perdu, cles(), aleatoireDeterministe(9));
    const inconnus = vue.profils.filter(p => p.nomInconnu);
    expect(inconnus).toHaveLength(PSEUDOS.length);
    expect(inconnus.every(p => p.nom === NOM_INCONNU)).toBe(true);
    // Avant : « Le prénom « (prénom inconnu) » est déjà pris ou réservé. » (toute action refusée).
    const modifie = appliquerProfilsAdmin(
      vue.annuaire,
      vue.profils.map(p => (p.id === idDe(0) ? { ...p, apps: ['esport', 'taches'] } : p)),
      cles(),
      aleatoireDeterministe(10),
    );
    // Les empreintes ne changent pas : chacun se retrouve encore par son prénom.
    PSEUDOS.forEach((pseudo, i) => expect(trouverCompte(modifie, pseudo)?.id).toBe(idDe(i)));
    expect(trouverCompte(modifie, NOM_INCONNU)?.id ?? '').not.toMatch(/^esp/);
    expect(modifie.comptes.find(c => c.id === idDe(0))?.acces.apps).toEqual(['esport', 'taches']);
  });
  it('un ancien bloc qui contient le texte de remplacement comme prénom le traite comme inconnu', () => {
    const vue = ouvrirAnnuaireAdmin(perdu, cles(), aleatoireDeterministe(11));
    // Ancienne version : un seul compte inconnu → son « prénom » scellé était le texte de remplacement.
    const seul = vue.profils.map(p => (p.id === idDe(1) ? { ...p, nomInconnu: undefined } : p));
    const avant = appliquerProfilsAdmin(vue.annuaire, seul.filter(p => !p.nomInconnu || p.admin), cles(), aleatoireDeterministe(12));
    const relu = ouvrirAnnuaireAdmin(avant, cles(), aleatoireDeterministe(13));
    expect(relu.profils.find(p => p.id === idDe(1))?.nomInconnu).toBe(true);
  });
  it('renommer depuis la fiche remplace le texte de remplacement (rescellé avec le prénom saisi)', () => {
    const vue = ouvrirAnnuaireAdmin(perdu, cles(), aleatoireDeterministe(14));
    const suivant = appliquerProfilsAdmin(vue.annuaire, renommerProfil(vue.profils, idDe(2), 'Neo_77'), cles(), aleatoireDeterministe(15));
    expect(ouvrirAnnuaireAdmin(suivant, cles(), aleatoireDeterministe(16)).profils.find(p => p.id === idDe(2))).toMatchObject({ nom: 'Neo_77' });
    expect(trouverCompte(suivant, 'Neo_77')?.id).toBe(idDe(2));
  });
});

describe('réparation des prénoms', () => {
  const a = club();
  const perdu: Annuaire = { ...a, prive: undefined };
  it('ne retient qu’un candidat dont l’empreinte est celle du compte (pseudo Esport, journal)', () => {
    const vue = ouvrirAnnuaireAdmin(perdu, cles(), aleatoireDeterministe(17));
    const candidats: Record<string, string[]> = {};
    PSEUDOS.forEach((pseudo, i) => (candidats[idDe(i)] = i === 3 ? ['Pseudo changé dans l’Esport'] : ['Mauvais', pseudo]));
    const bilan = reparerNomsAdmin(vue.annuaire, cles(), candidats, aleatoireDeterministe(18));
    expect(Object.keys(bilan.repares)).toHaveLength(PSEUDOS.length - 1);
    expect(bilan.restants).toEqual([idDe(3)]);
    const apres = ouvrirAnnuaireAdmin(relire(bilan.annuaire), cles(), aleatoireDeterministe(19));
    expect(apres.profils.find(p => p.id === idDe(0))).toMatchObject({ nom: 'Kaizen' });
    expect(apres.profils.find(p => p.id === idDe(0))?.nomInconnu).toBeUndefined();
    expect(apres.profils.find(p => p.id === idDe(3))?.nomInconnu).toBe(true);
    // Les codes d'accès gardés : rien d'autre ne bouge.
    expect(bilan.annuaire.comptes.map(c => c.empreinte)).toEqual(vue.annuaire.comptes.map(c => c.empreinte));
  });
  it('un compte abîmé (empreinte du texte de remplacement) reprend son seul candidat, rescellé', () => {
    const vue = ouvrirAnnuaireAdmin(perdu, cles(), aleatoireDeterministe(20));
    const abime: Annuaire = { ...vue.annuaire, comptes: vue.annuaire.comptes.map(c => (c.id === idDe(5) ? { ...c, empreinte: empreinteNom(vue.annuaire.sel, NOM_INCONNU) } : c)) };
    const bilan = reparerNomsAdmin(abime, cles(), { [idDe(5)]: ['Tom-B'] }, aleatoireDeterministe(21));
    expect(bilan.repares).toEqual({ [idDe(5)]: 'Tom-B' });
    expect(trouverCompte(bilan.annuaire, 'Tom-B')?.id).toBe(idDe(5));
    // Deux candidats : rien n'est deviné.
    expect(reparerNomsAdmin(abime, cles(), { [idDe(5)]: ['Tom-B', 'Tom'] }, aleatoireDeterministe(22)).repares).toEqual({});
  });
});

describe('synchronisation : un bloc privé n’en écrase plus un autre', () => {
  const maintenant = (m: number) => new Date(T + m * 60_000).toISOString();
  it('sans clés (avant déverrouillage), le perdant est gardé de côté, puis réuni au tour suivant avec les clés', () => {
    const alea = aleatoireDeterministe(30);
    const base = ouvrirAnnuaireAdmin(lireAnnuaire(undefined), cles(), alea);
    const commun = appliquerProfilsAdmin(base.annuaire, ajouterProfil(base.profils, 'Kaizen', idDe(0), '2026-10-01', ['esport']), cles(), alea);
    // L'iPad ajoute Lyra et publie.
    const vueIpad = ouvrirAnnuaireAdmin(commun, cles(), alea);
    const ipad = appliquerProfilsAdmin(vueIpad.annuaire, ajouterProfil(vueIpad.profils, 'Lyra', idDe(1), '2026-10-02', ['esport']), cles(), alea);
    const etatIpad = noterLocal(etatLwwVide(), entitesAnnuaire(commun), maintenant(0));
    const publie = fusionnerAnnuaire(ipad, etatIpad, undefined, maintenant(1)).document;
    // Le PC avait réécrit SON bloc privé (code d'accès d'un ancien dépôt…), sans le publier, puis redémarre.
    const etatPc = noterLocal(etatLwwVide(), entitesAnnuaire(commun), maintenant(0));
    const pc: Annuaire = { ...commun, prive: appliquerProfilsAdmin(commun, ouvrirAnnuaireAdmin(commun, cles(), alea).profils, cles(), alea).prive };
    // Avant le déverrouillage : pas de clés. Le bloc du PC (plus récent) gagne, celui de l'iPad est mis de côté.
    const sansCles = fusionnerAnnuaire(pc, etatPc, publie, maintenant(5));
    expect(sansCles.privesEcartes).toHaveLength(1);
    const etatSuivant = sansCles.etat;
    // Déverrouillé : réunion des deux blocs, Lyra retrouvée.
    const avecCles = fusionnerAnnuaire(sansCles.annuaire, etatSuivant, sansCles.document, maintenant(6), cles(), alea, sansCles.privesEcartes);
    expect(avecCles.privesEcartes).toEqual([]);
    const noms = ouvrirAnnuaireAdmin(avecCles.annuaire, cles(), alea).profils.map(p => p.nom);
    expect(noms).toEqual(expect.arrayContaining(['Kaizen', 'Lyra']));
    expect(noms).not.toContain(NOM_INCONNU);
    expect(avecCles.aPublier).toBe(true);
  });
});
