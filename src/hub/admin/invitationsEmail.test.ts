/**
 * Administration : adresse e-mail et invitation par messagerie (mailto),
 * modèle du message, réglages des comptes, actions groupées, droits par rang,
 * sauvegarde chiffrée, tableau de bord.
 */

import type { Profil } from '../../profils/profils';
import { evaluerMotDePasse, lirePolitiqueMdp, politiqueContenu, POLITIQUE_MDP_DEFAUT } from '../../profils/invitation';
import { aleatoireDeterministe } from '../../securite/aleatoire';
import type { ParametresKdf } from '../../securite/kdf';
import { REGISTRE } from '../registre';
import {
  appliquerGroupePar,
  avecEmailCreationPar,
  avecEmailPar,
  avecEnvoiPar,
  avecLangueComptePar,
  avecLangueCreationPar,
  avecModeleInvitationPar,
  avecReglagesComptesPar,
  avecReglagesPar,
  definirNiveauxPar,
  verifierGroupe,
  verifierGroupeRang,
} from './actions';
import { alertesComptes, definirNiveaux, statistiques } from './comptes';
import { avecEmail, avecEnvoi, avecLangue, emailValide, erreurEmail, langueDuCompte, langueEffective, lireContacts, normaliserEmail, sansContact } from './contacts';
import { donneesVides, ecrireDonnees, lireDonnees, REGLAGES_DEFAUT } from './donnees';
import { donneesDepuisEntites, entitesDonnees } from './fusionDonnees';
import { encoderParametre, lienMailto, LONGUEUR_MAX_MAILTO, MODELE_INVITATION_DEFAUT, prenomFondateur, rendreModele, rendreTexte, validerModele, type ValeursModele } from './modeleInvitation';
import { autorise, ErreurPermission } from './roles';
import { exporterSauvegarde, exporterSauvegardePar, importerSauvegarde, importerSauvegardePar } from './sauvegarde';
import { niveauSuivant } from './ui/Matrice';

const T = Date.parse('2026-10-15T10:00:00Z');
const fondateur: Profil = { id: 'principal', nom: 'Enzo', admin: true, creeLe: '' };
const administrateur: Profil = { id: 'adm0000005', nom: 'Iris', admin: false, creeLe: '', apps: [], actif: true, role: 'administrateur' };
const gest: Profil = { id: 'lea0000001', nom: 'Léa', admin: false, creeLe: '', apps: ['portefeuille'], actif: true, role: 'gestionnaire' };
const hugo: Profil = { id: 'hugo000002', nom: 'Hugo', admin: false, creeLe: '', apps: ['portefeuille', 'taches'], niveaux: { taches: 'lecture' }, actif: true };
const zoe: Profil = { id: 'zoe0000003', nom: 'Zoé', admin: false, creeLe: '', apps: ['portefeuille'], actif: true, creePar: 'lea0000001' };
const liste = [fondateur, administrateur, gest, hugo, zoe];
const KDF: ParametresKdf = { algorithme: 'argon2id', passes: 1, memoireKio: 64, fils: 1, longueurCle: 32 };

const VALEURS: ValeursModele = {
  prenom: 'Léa',
  lien: 'https://site.exemple.fr/#invitation=AI1.abc-DEF_123',
  expiration: '22 octobre',
  fondateur: 'Enzo',
  code: 'K7M2Q-9XH4T',
  site: 'https://site.exemple.fr',
  connexion: 'https://site.exemple.fr/#relais=https://relais.exemple.fr',
  longueur: '12',
};

describe('adresse e-mail : validation et normalisation', () => {
  it('accepte les adresses courantes, refuse les fautes', () => {
    for (const ok of ['lea@exemple.fr', 'Lea.Martin+amis@sous.exemple.fr', "o'neil@exemple.co.uk"]) expect(emailValide(ok)).toBe(true);
    for (const ko of ['', 'lea', 'lea@', '@exemple.fr', 'lea@exemple', 'lea@@exemple.fr', 'lé a@exemple.fr', '.lea@exemple.fr', 'lea..m@exemple.fr', 'lea@exemple.f', 'lea@-exemple.fr']) expect(emailValide(ko)).toBe(false);
  });

  it('normalise (espaces, « mailto: », domaine en minuscules) ; vide = facultatif', () => {
    expect(normaliserEmail('  mailto:Lea.Martin@Exemple.FR ')).toBe('Lea.Martin@exemple.fr');
    expect(erreurEmail('')).toBeUndefined();
    expect(erreurEmail('  ')).toBeUndefined();
    expect(erreurEmail('lea@exemple')).toMatch(/invalide/);
  });
});

describe('contacts : stockage chiffré avec les données de l’Administration', () => {
  it('enregistre, efface, note les envois (relance) et relit défensivement', () => {
    let d = avecEmail(donneesVides(), 'hugo000002', ' Hugo@Exemple.FR ', T);
    expect(d.contacts.hugo000002.email).toBe('Hugo@exemple.fr');
    expect(() => avecEmail(d, 'hugo000002', 'pas-une-adresse', T)).toThrow(/invalide/);
    d = avecEnvoi(d, 'hugo000002', 'email', T);
    d = avecEnvoi(d, 'hugo000002', 'copie', T + 1000);
    expect(d.contacts.hugo000002.envois.map(e => [e.canal, Boolean(e.relance)])).toEqual([
      ['email', false],
      ['copie', true],
    ]);
    // Relu tel quel ; une adresse invalide ou un canal inconnu sont écartés.
    const relu = lireDonnees(ecrireDonnees(d));
    expect(relu.contacts).toEqual(d.contacts);
    expect(lireContacts({ hugo000002: { email: 'x', envois: [{ date: 'n', canal: 'pigeon' }] }, 'MAUVAIS ID': { email: 'a@exemple.fr' } })).toEqual({});
    expect(avecEmail(d, 'hugo000002', '', T).contacts.hugo000002.email).toBeUndefined();
    expect(sansContact(d, 'hugo000002').contacts).toEqual({});
  });

  it('l’adresse ne va que dans les données de l’Administration (synchronisées scellées), jamais dans la liste des profils', () => {
    const d = avecEmail(donneesVides(), 'hugo000002', 'hugo@exemple.fr', T);
    const entites = entitesDonnees(d);
    expect(entites['contact:hugo000002']).toEqual(d.contacts.hugo000002);
    expect(donneesDepuisEntites(entites, T).contacts).toEqual(d.contacts);
    // La liste des profils (lisible par le hub des amis, publiée dans l’annuaire) ne change pas.
    const apres = definirNiveaux(liste, 'hugo000002', REGISTRE, { portefeuille: 'complet' });
    expect(JSON.stringify(apres)).not.toContain('hugo@exemple.fr');
  });

  it('droits : un gestionnaire sur ses amis, un administrateur sous lui ; jamais sur un rang égal ou supérieur', () => {
    const d = donneesVides();
    expect(avecEmailPar(gest, d, liste, 'zoe0000003', 'zoe@exemple.fr', T).contacts.zoe0000003.email).toBe('zoe@exemple.fr');
    expect(() => avecEmailPar(gest, d, liste, 'adm0000005', 'iris@exemple.fr', T)).toThrow(ErreurPermission);
    expect(() => avecEmailPar(administrateur, d, liste, 'principal', 'enzo@exemple.fr', T)).toThrow(ErreurPermission);
    expect(avecEnvoiPar(administrateur, d, liste, 'hugo000002', 'partage', T).contacts.hugo000002.envois).toHaveLength(1);
    expect(avecEmailCreationPar(gest, d, 'nouv000009', 'nouv@exemple.fr', T).contacts.nouv000009.email).toBe('nouv@exemple.fr');
    expect(() => avecEmailCreationPar(hugo, d, 'nouv000009', 'nouv@exemple.fr', T)).toThrow(ErreurPermission);
  });
});

describe('langue par défaut d’un compte (fiche de l’Administration)', () => {
  it('français sans réglage ; enregistrée avec l’adresse, relue, synchronisée, effacée avec le contact', () => {
    let d = avecEmail(donneesVides(), 'hugo000002', 'hugo@exemple.fr', T);
    expect(langueDuCompte(d.contacts.hugo000002)).toBe('fr');
    d = avecLangue(d, 'hugo000002', 'en');
    expect(d.contacts.hugo000002.langue).toBe('en');
    expect(d.contacts.hugo000002.email).toBe('hugo@exemple.fr');
    // Changer l'adresse ou noter un envoi ne perd pas la langue.
    d = avecEnvoi(avecEmail(d, 'hugo000002', 'hugo2@exemple.fr', T), 'hugo000002', 'email', T);
    expect(langueDuCompte(d.contacts.hugo000002)).toBe('en');
    // Relue défensivement (valeur inconnue écartée) et synchronisée telle quelle.
    expect(lireDonnees(ecrireDonnees(d)).contacts).toEqual(d.contacts);
    expect(lireContacts({ hugo000002: { email: 'hugo@exemple.fr', langue: 'de', envois: [] } }).hugo000002.langue).toBeUndefined();
    expect(donneesDepuisEntites(entitesDonnees(d), T).contacts.hugo000002.langue).toBe('en');
    // Une langue seule (compte sans adresse) est gardée aussi.
    expect(lireContacts({ zoe0000003: { langue: 'en', envois: [] } }).zoe0000003.langue).toBe('en');
    expect(() => avecLangue(d, 'hugo000002', 'de' as never)).toThrow(/Langue/);
    expect(langueDuCompte(avecLangue(d, 'hugo000002', undefined).contacts.hugo000002)).toBe('fr');
  });

  it('langue effective d’un e-mail : le choix de l’utilisateur (Esport) prime, puis la langue par défaut du serveur Esport, puis la fiche, puis le français', () => {
    const contact = { langue: 'en' as const, envois: [] };
    expect(langueEffective(undefined)).toBe('fr');
    expect(langueEffective(contact)).toBe('en');
    expect(langueEffective(contact, { langueChoisie: null, langueDefaut: 'fr' })).toBe('fr');
    expect(langueEffective({ envois: [] }, { langueChoisie: 'en', langueDefaut: 'fr' })).toBe('en');
    expect(langueEffective(contact, { langueChoisie: 'fr', langueDefaut: 'en' })).toBe('fr');
  });

  it('droits : comme l’adresse (gestionnaire sur ses amis, jamais sur un rang égal ou supérieur) ; création par un rang qui crée des amis', () => {
    const d = donneesVides();
    expect(avecLangueComptePar(gest, d, liste, 'zoe0000003', 'en').contacts.zoe0000003.langue).toBe('en');
    expect(() => avecLangueComptePar(gest, d, liste, 'adm0000005', 'en')).toThrow(ErreurPermission);
    expect(avecLangueCreationPar(gest, d, 'nouv000009', 'en').contacts.nouv000009.langue).toBe('en');
    expect(() => avecLangueCreationPar(hugo, d, 'nouv000009', 'en')).toThrow(ErreurPermission);
  });
});

describe('modèle du message d’invitation', () => {
  it('rend les variables ; une ligne dont la variable facultative est vide disparaît', () => {
    const complet = rendreModele(undefined, VALEURS);
    expect(complet.objet).toBe('Enzo t’invite sur AppDashboard');
    expect(complet.corps).toContain(VALEURS.lien);
    expect(complet.corps).toContain('Ton identifiant : Léa');
    expect(complet.corps).toContain('12 caractères au moins');
    expect(complet.corps).toContain('jusqu’au 22 octobre');
    expect(complet.corps).toContain('tape le code K7M2Q-9XH4T');
    const sansCode = rendreModele(undefined, { ...VALEURS, code: '', site: '', connexion: '' });
    expect(sansCode.corps).not.toMatch(/code|\{|autre appareil/);
    expect(sansCode.corps).not.toMatch(/\n{3,}/);
    expect(rendreTexte('A {inconnue} B', VALEURS)).toBe('A {inconnue} B');
    expect(prenomFondateur('Moi')).toBe('Ton administrateur');
    expect(prenomFondateur('Moi', 'en')).toBe('Your administrator');
    expect(prenomFondateur(' Enzo ')).toBe('Enzo');
  });

  it('valide : {lien} obligatoire, pas dans l’objet, variables connues, longueurs bornées', () => {
    expect(validerModele(MODELE_INVITATION_DEFAUT)).toEqual([]);
    expect(validerModele({ objet: 'Invitation', corps: 'Salut {prenom}' }).join(' ')).toMatch(/\{lien\}/);
    expect(validerModele({ objet: '{lien}', corps: '{lien}' }).join(' ')).toMatch(/objet/);
    expect(validerModele({ objet: 'X', corps: '{lien} {pseudo}' }).join(' ')).toMatch(/Variable inconnue : \{pseudo\}/);
    expect(validerModele({ objet: '', corps: '{lien}' }).join(' ')).toMatch(/objet est vide/);
    expect(validerModele({ objet: 'X', corps: `{lien}${'a'.repeat(2001)}` }).join(' ')).toMatch(/2000/);
  });

  it('enregistrement : Fondateur seulement ; modèle invalide refusé ; undefined rétablit le défaut', () => {
    const modele = { objet: 'Bienvenue {prenom}', corps: 'Coucou {prenom} :\n{lien}\nÀ bientôt, {fondateur}' };
    const d = avecModeleInvitationPar(fondateur, donneesVides(), modele);
    expect(lireDonnees(ecrireDonnees(d)).modeleInvitation).toEqual(modele);
    expect(avecModeleInvitationPar(fondateur, d, undefined).modeleInvitation).toBeUndefined();
    expect(() => avecModeleInvitationPar(fondateur, donneesVides(), { objet: 'X', corps: 'sans lien' })).toThrow(/\{lien\}/);
    expect(() => avecModeleInvitationPar(administrateur, donneesVides(), modele)).toThrow(ErreurPermission);
    expect(() => avecModeleInvitationPar(gest, donneesVides(), modele)).toThrow(ErreurPermission);
    expect(donneesDepuisEntites(entitesDonnees(d), T).modeleInvitation).toEqual(modele);
  });
});

describe('lien mailto : encodage et taille', () => {
  it('destinataire, objet et corps encodés (accents en UTF-8, retours à la ligne en CRLF, # et & protégés)', () => {
    const message = rendreModele(undefined, VALEURS);
    const { url, raccourci } = lienMailto('lea.martin+amis@exemple.fr', message, VALEURS);
    expect(raccourci).toBe(false);
    expect(url.startsWith('mailto:lea.martin%2Bamis@exemple.fr?subject=')).toBe(true);
    expect(url).not.toMatch(/\s/);
    expect(url).toContain('%0D%0A');
    expect(url).toContain(encodeURIComponent('é'));
    expect(url).toContain('%23invitation%3DAI1.abc-DEF_123');
    const [, requete] = url.split('?');
    const params = new Map(requete.split('&').map(p => p.split('=') as [string, string]));
    expect(decodeURIComponent(params.get('subject')!)).toBe('Enzo t’invite sur AppDashboard');
    expect(decodeURIComponent(params.get('body')!)).toBe(message.corps.replace(/\n/g, '\r\n'));
    expect(encoderParametre('a & b = c ?')).toBe('a%20%26%20b%20%3D%20c%20%3F');
  });

  it('sans adresse : messagerie ouverte sans destinataire', () => {
    expect(lienMailto(undefined, rendreModele(undefined, VALEURS), VALEURS).url.startsWith('mailto:?subject=')).toBe(true);
  });

  it('trop long : version courte qui garde le lien, puis le lien seul ; jamais au-delà de la limite', () => {
    const long = { objet: 'Invitation', corps: `{lien}\n${'é'.repeat(1500)}` };
    const message = rendreModele(long, VALEURS);
    const court = lienMailto('lea@exemple.fr', message, VALEURS);
    expect(court.raccourci).toBe(true);
    expect(court.url.length).toBeLessThanOrEqual(LONGUEUR_MAX_MAILTO);
    expect(decodeURIComponent(court.url.split('body=')[1])).toContain(VALEURS.lien);
    const lienEnorme = { ...VALEURS, lien: `https://site.exemple.fr/#invitation=AI1.${'x'.repeat(1900)}` };
    const minimal = lienMailto('lea@exemple.fr', rendreModele(undefined, lienEnorme), lienEnorme);
    expect(decodeURIComponent(minimal.url.split('body=')[1])).toBe(lienEnorme.lien);
  });
});

describe('politique du mot de passe des amis', () => {
  it('durcit les règles de base : longueur et force minimales ; lecture bornée', () => {
    const politique = { longueurMin: 16, forceMin: 3 as const };
    expect(evaluerMotDePasse('Été à Biarritz', 'Léa', politique).erreurs.join(' ')).toMatch(/16 caractères/);
    expect(evaluerMotDePasse('abcdefghijklmnop', 'Léa', politique).erreurs.join(' ')).toMatch(/Solide/);
    expect(evaluerMotDePasse('Été à Biarritz 2026', 'Léa', politique).valide).toBe(true);
    expect(evaluerMotDePasse('abcdefghijklmnop', 'Léa').valide).toBe(true);
    expect(lirePolitiqueMdp({ l: 3, f: 9 })).toEqual({ longueurMin: 10, forceMin: 4 });
    expect(lirePolitiqueMdp({ longueurMin: 200, forceMin: 0 })).toEqual({ longueurMin: 64, forceMin: 1 });
    expect(lirePolitiqueMdp('x')).toBeUndefined();
    expect(politiqueContenu(POLITIQUE_MDP_DEFAUT)).toEqual({});
    expect(politiqueContenu({ longueurMin: 12, forceMin: 2 })).toEqual({ politique: { l: 12, f: 2 } });
  });
});

describe('réglages des comptes', () => {
  it('Fondateur seulement ; bornés ; les autres clés sont ignorées', () => {
    const d = avecReglagesComptesPar(fondateur, donneesVides(), { mdpLongueurMin: 3, mdpForceMin: 9, appareilsMax: 7, invitationJours: 30, verrouMinutes: 0 }, T);
    expect(d.reglages).toEqual({ ...REGLAGES_DEFAUT, mdpLongueurMin: 10, mdpForceMin: 4, appareilsMax: 7, invitationJours: 30 });
    expect(() => avecReglagesComptesPar(administrateur, donneesVides(), { appareilsMax: 2 }, T)).toThrow(ErreurPermission);
    expect(() => avecReglagesComptesPar(gest, donneesVides(), { appareilsMax: 2 }, T)).toThrow(ErreurPermission);
    // Les réglages du panneau restent ouverts à l’Administrateur, inchangés.
    expect(avecReglagesPar(administrateur, donneesVides(), { verrouMinutes: 10 }, T).reglages.verrouMinutes).toBe(10);
    // Anciennes données (sans ces clés) : valeurs par défaut.
    expect(lireDonnees(JSON.stringify({ reglages: { verrouMinutes: 9 } })).reglages).toEqual({ ...REGLAGES_DEFAUT, verrouMinutes: 9 });
  });

  it('droits par rang des nouvelles actions', () => {
    expect(autorise(fondateur, 'reglages-comptes').ok).toBe(true);
    expect(autorise(fondateur, 'sauvegarde-admin').ok).toBe(true);
    for (const acteur of [administrateur, gest]) {
      expect(autorise(acteur, 'reglages-comptes').ok).toBe(false);
      expect(autorise(acteur, 'sauvegarde-admin').ok).toBe(false);
    }
    expect(autorise(gest, 'contact-ami', zoe).ok).toBe(true);
    expect(autorise(hugo, 'contact-ami', zoe).ok).toBe(false);
  });
});

describe('actions groupées', () => {
  it('ouvrir / fermer UNE app sans toucher aux autres (même source de vérité que la fiche)', () => {
    const tsuzuku = REGISTRE.find(a => a.id === 'tsuzuku')!;
    const ouvert = appliquerGroupePar(fondateur, liste, ['hugo000002', 'zoe0000003'], { genre: 'app', app: 'tsuzuku', niveau: 'complet' }, REGISTRE, T).profils;
    expect(ouvert.find(p => p.id === 'hugo000002')!.apps).toEqual(expect.arrayContaining(['portefeuille', 'taches', 'tsuzuku']));
    expect(ouvert.find(p => p.id === 'hugo000002')!.niveaux).toEqual({ taches: 'lecture' });
    expect(ouvert.find(p => p.id === 'zoe0000003')!.apps).toEqual(expect.arrayContaining(['portefeuille', 'tsuzuku']));
    const ferme = appliquerGroupePar(fondateur, ouvert, ['hugo000002'], { genre: 'app', app: 'portefeuille', niveau: 'aucun' }, REGISTRE, T).profils;
    expect(ferme.find(p => p.id === 'hugo000002')!.apps).toEqual(expect.arrayContaining(['taches', 'tsuzuku']));
    expect(ferme.find(p => p.id === 'hugo000002')!.apps).not.toContain('portefeuille');
    expect(tsuzuku).toBeDefined();
    // Tout ou rien : un compte interdit (rang égal) dans la sélection, rien ne change.
    expect(() => appliquerGroupePar(administrateur, liste, ['hugo000002', 'adm0000005'], { genre: 'app', app: 'tsuzuku', niveau: 'complet' }, REGISTRE, T)).toThrow(ErreurPermission);
  });

  it('un modèle appliqué à une liste partielle d’apps garde l’accès aux apps hors liste', () => {
    const portefeuille = REGISTRE.filter(a => a.id === 'portefeuille');
    const apres = definirNiveauxPar(fondateur, liste, 'hugo000002', portefeuille, { portefeuille: 'complet' });
    const h = apres.find(p => p.id === 'hugo000002')!;
    expect(h.apps).toEqual(expect.arrayContaining(['portefeuille', 'taches']));
    expect(h.niveaux).toEqual({ taches: 'lecture' });
    const ferme = definirNiveauxPar(fondateur, apres, 'hugo000002', portefeuille, { portefeuille: 'aucun' }).find(p => p.id === 'hugo000002')!;
    expect(ferme.apps).toEqual(['taches']);
  });

  it('renvoyer, révoquer, changer de rang : toute la sélection vérifiée avant la première action', () => {
    expect(() => verifierGroupe(fondateur, 'regenerer-identifiants', liste, ['hugo000002', 'zoe0000003'])).not.toThrow();
    expect(() => verifierGroupe(gest, 'regenerer-identifiants', liste, ['zoe0000003', 'hugo000002'])).toThrow(/qu’il a lui-même créés/);
    expect(() => verifierGroupe(fondateur, 'etat-ami', liste, [])).toThrow(/Aucun compte/);
    expect(() => verifierGroupeRang(administrateur, liste, ['hugo000002', 'zoe0000003'], 'gestionnaire')).not.toThrow();
    expect(() => verifierGroupeRang(administrateur, liste, ['hugo000002'], 'administrateur')).toThrow(/Seul un Fondateur/);
    expect(() => verifierGroupeRang(gest, liste, ['zoe0000003'], 'ami')).toThrow(ErreurPermission);
  });

  it('matrice : le niveau suivant suit ce que l’app propose', () => {
    const portefeuille = REGISTRE.find(a => a.id === 'portefeuille')!;
    expect(niveauSuivant(portefeuille, 'aucun')).not.toBe('aucun');
    let n = niveauSuivant(portefeuille, 'aucun');
    const vus = new Set(['aucun', n]);
    for (let i = 0; i < 3; i++) {
      n = niveauSuivant(portefeuille, n);
      vus.add(n);
    }
    expect(vus.has('complet')).toBe(true);
  });
});

describe('tableau de bord', () => {
  it('invitations expirées, appareils, dernières connexions ; alerte au-delà du nombre d’appareils réglé', () => {
    const vieux: Profil = { ...zoe, id: 'old0000007', nom: 'Old', invitationExpireLe: '2026-10-01T00:00:00Z' };
    const nomade: Profil = { ...hugo, derniereConnexion: '2026-10-14T10:00:00Z', appareils: [1, 2, 3, 4, 5, 6].map(i => ({ nom: `Appareil ${i}`, vu: '2026-10-14T10:00:00Z' })) };
    const stats = statistiques([fondateur, nomade, vieux], REGISTRE, undefined, T);
    expect(stats.expirees).toBe(1);
    expect(stats.appareils).toBe(6);
    expect(stats.dernieresConnexions).toEqual([{ id: 'hugo000002', nom: 'Hugo', date: '2026-10-14T10:00:00Z' }]);
    expect(alertesComptes([nomade], T, 30, 5).find(a => a.genre === 'appareils')?.message).toMatch(/6 appareils/);
    expect(alertesComptes([nomade], T, 30, 6).some(a => a.genre === 'appareils')).toBe(false);
    expect(alertesComptes([nomade], T, 30).some(a => a.genre === 'appareils')).toBe(false);
  });
});

describe('sauvegarde chiffrée de l’Administration', () => {
  it('aller-retour par la phrase ; mauvaise phrase, fichier étranger : erreurs claires ; rien de lisible en clair', () => {
    const d = avecEmail(donneesVides(), 'hugo000002', 'hugo@exemple.fr', T);
    const fichier = exporterSauvegarde(d, 'une phrase assez longue', T, aleatoireDeterministe(4), KDF);
    expect(fichier).not.toContain('hugo@exemple.fr');
    expect(importerSauvegarde(fichier, 'une phrase assez longue').contacts).toEqual(d.contacts);
    expect(() => importerSauvegarde(fichier, 'une autre phrase longue')).toThrow(/incorrecte/);
    expect(() => importerSauvegarde('{"format":"autre"}', 'une phrase assez longue')).toThrow(/pas une sauvegarde/);
    expect(() => exporterSauvegarde(d, 'courte', T)).toThrow(/12 caractères/);
  });

  it('Fondateur seulement', () => {
    expect(() => exporterSauvegardePar(administrateur, donneesVides(), 'une phrase assez longue', T)).toThrow(ErreurPermission);
    expect(() => importerSauvegardePar(gest, '{}', 'x')).toThrow(ErreurPermission);
    expect(exporterSauvegardePar(fondateur, donneesVides(), 'une phrase assez longue', T, aleatoireDeterministe(2), KDF)).toContain('appdashboard-administration');
  });
});
