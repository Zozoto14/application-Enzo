import { ouvrirBaseNode } from '../db/pilotes/node';
import { aleatoireDeterministe } from '../securite/aleatoire';
import { exempterTotp, totpExige, deverrouillerParMotDePasse } from '../securite/coffre';
import type { ParametresKdf } from '../securite/kdf';
import { codeTotp } from '../securite/totp';
import { ErreurInvitationUtilisee, MESSAGE_ECHEC, Session, variantesMotDePasse } from '../session/session';
import { stockageMemoire } from '../session/stockage-coffre';
import { creerAccesAmi } from './identifiants';
import {
  type ContenuInvitation,
  cleIdentifiant,
  decoderInvitation,
  empreinteIdentifiant,
  encoderInvitation,
  evaluerMotDePasse,
  formeCanonique,
  invitationExpiree,
  lienConnexion,
  lienInvitation,
  messageErreur,
  messageInvitation,
  normaliserCodeCourt,
  normaliserIdentifiant,
  nouveauCodeCourt,
  nouveauSecret,
  ouvrirAcces,
  ouvrirContenu,
  preparerAcces,
  preuveAcces,
  relaisDuLien,
  scellerContenu,
  secretsCodeCourt,
  secretsInvitation,
} from './invitation';

const KDF: ParametresKdf = { algorithme: 'argon2id', passes: 1, memoireKio: 64, fils: 1, longueurCle: 32 };
const HORLOGE = 1_700_000_000_000;
const JETON = `p1.lea12345.${'a'.repeat(64)}`;

function contenu(o: Partial<ContenuInvitation> = {}): ContenuInvitation {
  return { v: 1, compte: 'lea12345', prenom: 'Léa', jeton: JETON, relais: 'https://relais.exemple.workers.dev', site: 'https://site.pages.dev', mdp: 'abcde-FGHJK-23456-mnpqr', expire: new Date(HORLOGE + 7 * 86_400_000).toISOString(), fondateur: 'Enzo', creeLe: new Date(HORLOGE).toISOString(), ...o };
}

function session(stockage = stockageMemoire()) {
  return new Session({ stockage, ouvrirBase: () => ouvrirBaseNode(), horloge: () => HORLOGE, alea: aleatoireDeterministe(5), kdf: KDF, profil: 'lea12345' });
}

describe('saisies robustes', () => {
  it('identifiant : insensible à la casse, aux accents (NFC/NFD), aux espaces et invisibles', () => {
    const nfd = 'Léa';
    expect(cleIdentifiant('  LÉA ')).toBe(cleIdentifiant('léa'));
    expect(cleIdentifiant(nfd)).toBe(cleIdentifiant('Léa'));
    expect(cleIdentifiant('Léa​\n')).toBe('lea');
    expect(normaliserIdentifiant('  Jean   Pierre ')).toBe('Jean Pierre');
    expect(empreinteIdentifiant('LEA')).toBe(empreinteIdentifiant(' léa'));
    expect(empreinteIdentifiant('Léa')).not.toBe(empreinteIdentifiant('Lucas'));
  });

  it('mot de passe : NFC, bords, invisibles, guillemets typographiques — le milieu intact', () => {
    expect(formeCanonique('  été 2026!\n')).toBe('été 2026!');
    expect(formeCanonique('été 2026')).toBe('été 2026');
    expect(formeCanonique('l’ami “du” sud​')).toBe('l\'ami "du" sud');
    expect(formeCanonique('a  b')).toBe('a  b');
    expect(formeCanonique('a b')).toBe('a b');
    expect(formeCanonique('MotDePasse\r\n')).toBe('MotDePasse');
  });

  it('règles et indicateur de force', () => {
    expect(evaluerMotDePasse('court').valide).toBe(false);
    expect(evaluerMotDePasse('1234567890123').erreurs).toContain('Pas seulement des chiffres.');
    expect(evaluerMotDePasse('Lea2026!!', 'Léa').valide).toBe(false);
    expect(evaluerMotDePasse('léa-2026-x', 'Léa').erreurs).toContain('Pas ton prénom (ou presque).');
    expect(evaluerMotDePasse('azerty1234').valide).toBe(false);
    expect(evaluerMotDePasse('aaaaaaaaaaaa').valide).toBe(false);
    const bon = evaluerMotDePasse('Été à Biarritz 2026', 'Léa');
    expect(bon.valide).toBe(true);
    expect(bon.force).toBeGreaterThanOrEqual(3);
    expect(evaluerMotDePasse('girafe-volante').force).toBeGreaterThanOrEqual(1);
    // Espaces au bord ignorés pour la longueur.
    expect(evaluerMotDePasse('  abcdefghi  ').valide).toBe(false);
  });

  it('variantes : coffre canonique → une seule dérivation ; ancien coffre → saisie brute d’abord', () => {
    expect(variantesMotDePasse(' Été\n', true)).toEqual(['Été']);
    expect(variantesMotDePasse('x’y ')[0]).toBe('x’y ');
    expect(variantesMotDePasse('x’y ')).toContain("x'y");
  });
});

describe('code d’invitation', () => {
  it('mode relais : seul le secret voyage, relu même abîmé par une messagerie', () => {
    const secret = nouveauSecret(aleatoireDeterministe(1));
    const code = encoderInvitation({ mode: 'relais', relais: 'https://r.workers.dev', site: 'https://s.pages.dev', secret });
    const lien = lienInvitation('https://s.pages.dev/', code);
    expect(lien).toMatch(/^https:\/\/s\.pages\.dev\/#invitation=AI1\./);
    const coupe = `« ${lien.slice(0, 40)}\n${lien.slice(40)} »`;
    expect(decoderInvitation(coupe)).toEqual({ mode: 'relais', relais: 'https://r.workers.dev', site: 'https://s.pages.dev', secret });
    expect(decoderInvitation(encodeURIComponent(lien))).toEqual(decoderInvitation(lien));
    expect(decoderInvitation('AI1.abc')).toBeUndefined();
    expect(decoderInvitation('rien')).toBeUndefined();
  });

  it('mode lien (ancien relais) : le contenu est dans le lien, validé', () => {
    const code = encoderInvitation({ mode: 'lien', relais: 'https://r.workers.dev', contenu: contenu() });
    const lu = decoderInvitation(code);
    expect(lu?.mode).toBe('lien');
    expect(lu && lu.mode === 'lien' ? lu.contenu.prenom : '').toBe('Léa');
    // Jeton d'un autre compte : refusé.
    const triche = encoderInvitation({ mode: 'lien', relais: 'https://r.workers.dev', contenu: contenu({ jeton: `p1.autre1234.${'b'.repeat(64)}` }) });
    expect(decoderInvitation(triche)).toBeUndefined();
  });

  it('contenu scellé : relu avec le secret, illisible avec un autre', () => {
    const secret = nouveauSecret(aleatoireDeterministe(2));
    const s = secretsInvitation(secret);
    expect(s.id).toMatch(/^[0-9a-f]{32}$/);
    expect(s.verif).not.toContain(s.preuve);
    const charge = scellerContenu(contenu(), s, aleatoireDeterministe(3));
    expect(charge).not.toContain('Léa');
    expect(charge).not.toContain('abcde');
    expect(ouvrirContenu(charge, s).mdp).toBe('abcde-FGHJK-23456-mnpqr');
    expect(() => ouvrirContenu(charge, secretsInvitation(nouveauSecret(aleatoireDeterministe(9))))).toThrow(/incomplet ou abîmé/);
  });

  it('code court : 10 caractères, tolère casse, tirets, confusions O/0 et I/1', () => {
    const code = nouveauCodeCourt(aleatoireDeterministe(4));
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
    expect(normaliserCodeCourt(code.toLowerCase().replace('-', ' '))).toBe(code);
    expect(normaliserCodeCourt('abc')).toBeUndefined();
    const a = secretsCodeCourt(code, KDF);
    expect(secretsCodeCourt(code.toLowerCase(), KDF)).toEqual(a);
    expect(secretsCodeCourt('K7M2Q-9XH4T', KDF).id).not.toBe(a.id);
  });

  it('expiration (heure du relais)', () => {
    const c = contenu();
    expect(invitationExpiree(c, HORLOGE)).toBe(false);
    expect(invitationExpiree(c, HORLOGE + 8 * 86_400_000)).toBe(true);
  });

  it('liens de connexion des appareils suivants', () => {
    const lien = lienConnexion('https://s.pages.dev', 'https://r.x.workers.dev/');
    expect(relaisDuLien(lien.slice(lien.indexOf('#')))).toBe('https://r.x.workers.dev');
    expect(relaisDuLien('#relais=http%3A%2F%2Fpas-https')).toBeUndefined();
  });

  it('message prêt à coller : lien, identifiant, date, sans mot de passe', () => {
    const texte = messageInvitation({ prenom: 'Léa', fondateur: 'Enzo', lien: 'https://s/#invitation=AI1.x', expire: new Date(HORLOGE).toISOString(), codeCourt: 'K7M2Q-9XH4T', site: 'https://s', lienConnexion: 'https://s/#relais=r' });
    expect(texte).toContain('https://s/#invitation=AI1.x');
    expect(texte).toContain('Ton identifiant : Léa');
    expect(texte).toContain('K7M2Q-9XH4T');
    expect(texte).not.toMatch(/mot de passe\s*:/i);
  });

  it('messages d’erreur précis et actionnables', () => {
    expect(messageErreur('non-publie', { qui: 'Enzo' })).toMatch(/demande à Enzo d’ouvrir AppDashboard/);
    expect(messageErreur('invitation-expiree', { qui: 'Enzo' })).toMatch(/expiré.*Enzo/);
    expect(messageErreur('trop-de-tentatives', { attenteS: 300 })).toMatch(/5 min/);
    expect(messageErreur('relais-ancien')).toMatch(/mis à jour/);
    expect(messageErreur('identifiant-inconnu')).not.toBe(messageErreur('mot-de-passe'));
  });
});

describe('accès par identifiant (relais v6)', () => {
  it('le relais ne garde rien d’ouvrable ; le bon mot de passe (même saisi autrement) rouvre', () => {
    const depot = preparerAcces('Été à Biarritz', { v: 1, compte: 'lea12345', prenom: 'Léa', jeton: JETON, relais: 'https://r.workers.dev' }, aleatoireDeterministe(8), KDF);
    expect(JSON.stringify(depot)).not.toContain(JETON);
    expect(JSON.stringify(depot)).not.toContain('Biarritz');
    const { cle, preuve } = preuveAcces(' Été à Biarritz\n', depot.sel, depot.kdf);
    expect(depot.verif).not.toBe(preuve);
    expect(ouvrirAcces(depot.charge, cle, 'lea12345').jeton).toBe(JETON);
    const faux = preuveAcces('été à biarritz', depot.sel, depot.kdf);
    expect(faux.preuve).not.toBe(preuve);
    expect(() => ouvrirAcces(depot.charge, faux.cle, 'lea12345')).toThrow(/incorrect/);
    expect(() => ouvrirAcces(depot.charge, cle, 'autre1234')).toThrow();
  });
});

describe('acceptation d’une invitation (coffre)', () => {
  it('le mot de passe choisi remplace le temporaire, sans code TOTP, une seule fois', () => {
    const stockage = stockageMemoire();
    const createur = session(stockage);
    const ids = creerAccesAmi(createur, 'Léa', aleatoireDeterministe(6));
    // Appareil de l'ami : même coffre.
    const ami = session(stockage);
    const coffre = ami.accepterInvitation(ids.motDePasse, '  Été à Biarritz 2026\n');
    expect(ami.statut()).toBe('deverrouille');
    expect(coffre.canonique).toBe(true);
    expect(ami.etatCoffre()?.codeDemande).toBe(false);
    ami.verrouiller();
    // Sans code, saisie en NFD avec retour à la ligne : ouvre.
    ami.deverrouiller({ motDePasse: 'Été à Biarritz 2026\r\n', codeTotp: '' });
    expect(ami.statut()).toBe('deverrouille');
    ami.verrouiller();
    // L'ancien mot de passe temporaire ne marche plus, ni le TOTP seul.
    expect(() => ami.deverrouiller({ motDePasse: ids.motDePasse, codeTotp: codeTotp(ids.secretTotp, HORLOGE) })).toThrow(MESSAGE_ECHEC);
    // Invitation rejouée : refusée avec un message précis.
    const autre = session(stockage);
    expect(() => autre.accepterInvitation(ids.motDePasse, 'nouveau-mot-de-passe')).toThrow(ErreurInvitationUtilisee);
    // La marque d'exemption est liée à la clé : recopiée sur un autre coffre, elle n'exempte de rien.
    const cle = deverrouillerParMotDePasse(coffre, 'Été à Biarritz 2026');
    expect(totpExige(coffre, cle)).toBe(false);
    const autreCoffre = exempterTotp(coffre, new Uint8Array(32).fill(1));
    expect(totpExige({ ...coffre, sansTotp: autreCoffre.sansTotp }, cle)).toBe(true);
  });

  it('un coffre d’ami ancien (sans exemption) exige toujours le code TOTP', () => {
    const stockage = stockageMemoire();
    const ids = creerAccesAmi(session(stockage), 'Hugo', aleatoireDeterministe(7));
    const ami = session(stockage);
    expect(ami.etatCoffre()?.codeDemande).toBe(true);
    expect(() => ami.deverrouiller({ motDePasse: ids.motDePasse, codeTotp: '' })).toThrow(MESSAGE_ECHEC);
    ami.deverrouiller({ motDePasse: `${ids.motDePasse}\n`, codeTotp: codeTotp(ids.secretTotp, HORLOGE) });
    expect(ami.statut()).toBe('deverrouille');
  });
});
