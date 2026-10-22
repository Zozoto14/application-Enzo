/**
 * Parcours d'accès d'un ami (voir docs/connexion-amis.md) :
 *
 *  - côté Fondateur : `creerInvitation` (lien, code court, message prêt à
 *    coller), à la création du compte, pour « Renvoyer une invitation » ou
 *    « Réinitialiser l'accès » ;
 *  - côté ami : `chargerInvitation` (le lien est-il encore bon ? pour qui ?),
 *    `accepterInvitation` (son mot de passe remplace le temporaire, son coffre
 *    est publié, l'invitation est consommée, son accès par identifiant est
 *    déposé), puis `connecterParIdentifiant` sur ses appareils suivants.
 *
 * Tout est chiffré de bout en bout : le relais ne reçoit que des charges
 * scellées, des empreintes et le coffre (enveloppes Argon2id), jamais un mot
 * de passe, une clé ou un jeton en clair hors du jeton de l'appelant.
 */

import { ErreurInvitationUtilisee, coffreApresInvitation, coffreValide } from '../src/session/session';
import type { Coffre } from '../src/securite/coffre';
import type { ParametresKdf } from '../src/securite/kdf';
import { aleatoireParDefaut, type SourceAleatoire } from '../src/securite/aleatoire';
import {
  ErreurInvitation,
  empreinteIdentifiant,
  encoderInvitation,
  evaluerMotDePasse,
  invitationExpiree,
  lienConnexion,
  lienInvitation,
  messageErreur,
  messageInvitation,
  nouveauCodeCourt,
  politiqueContenu,
  politiqueDeContenu,
  nouveauSecret,
  ouvrirAcces,
  ouvrirContenu,
  preparerAcces,
  preparerSecours,
  preuveAcces,
  preuveSecours,
  scellerContenu,
  secretsCodeCourt,
  secretsInvitation,
  type ContenuAcces,
  type ContenuInvitation,
  type LienInvitation,
  type PolitiqueMdp,
  type SecretsInvitation,
} from '../src/profils/invitation';
import {
  heureRelais,
  lireInvitationRelais,
  revoquerCompte,
  supprimerAcces,
  lireSelAcces,
  ouvrirAccesRelais,
  publierAcces,
  publierInvitation,
  relaisAJour,
  utiliserInvitationRelais,
  versionRelais,
} from '../src/sync/relais/connexionAmis';
import { espacesDuRelais, octetsEnCharge, chargeEnOctets } from '../src/sync/relais/espaces';
import { encoderLiaison, type Liaison } from '../src/sync/relais/liaison';
import { jetonDeProfil } from '../src/sync/relais/portees';
import { ErreurRelais } from '../src/sync/relais/synchroniser';
import { SITE_PRINCIPAL, choisirSite } from '../src/config/site';
import { viderCoffreServeur } from '../src/sync/relais/coffreServeur';
import { preparerLiaison, type CompteRelie } from './synchroComptes';

type Fetch = typeof fetch;

// ------------------------------------------------------------ Côté Fondateur

export interface InvitationCreee {
  /** Lien à envoyer (secret dans le fragment). */
  lien: string;
  /** Code court à taper sur le site (relais à jour, et site connu). */
  codeCourt?: string;
  /** Message prêt à coller (lien + instructions). */
  message: string;
  expire: string;
  /** `relais` : usage unique et expiration tenus par le relais ; `lien` : relais pas encore mis à jour. */
  mode: 'relais' | 'lien';
  /** Lien des appareils suivants (site + adresse du relais, rien de secret). */
  lienConnexion?: string;
  /** Message à montrer au Fondateur (relais à mettre à jour…). */
  avertissement?: string;
  /** Éléments du message, pour le modèle personnalisé de l'Administration (rien de secret hors du lien). */
  prenom: string;
  fondateur?: string;
  site: string;
  longueur: number;
}

export interface OptionsCreation {
  maitre: Liaison;
  compte: string;
  prenom: string;
  /** Mot de passe TEMPORAIRE du coffre de l'ami. */
  motDePasse: string;
  fondateur?: string;
  jours: number;
  /** Adresse du site (défaut : celle de src/config/site.json, si vérifiée). */
  site?: string;
  requete?: Fetch;
  alea?: SourceAleatoire;
  maintenant?: () => number;
  /** Paramètres de dérivation du code court (tests). */
  kdfCodeCourt?: ParametresKdf;
  /** Politique du mot de passe que l'ami choisira (Administration › Réglages) ; absente : règles de base. */
  politique?: PolitiqueMdp;
}

/** Adresse du site où l'ami ouvre son lien (repli : l'adresse de la page en cours). */
export function siteDesLiens(site?: string): string {
  const choisi = choisirSite(site) ?? choisirSite(undefined);
  if (choisi) return choisi;
  const origine = (globalThis as { location?: { origin?: string } }).location?.origin;
  return origine && /^https?:\/\//.test(origine) ? origine : SITE_PRINCIPAL;
}

export async function creerInvitation(o: OptionsCreation): Promise<InvitationCreee> {
  const alea = o.alea ?? aleatoireParDefaut;
  const maintenant = (o.maintenant ?? Date.now)();
  const jours = Math.min(90, Math.max(1, Math.round(o.jours || 7)));
  const expire = new Date(maintenant + jours * 86_400_000).toISOString();
  const site = o.site ?? siteDesLiens(o.maitre.site);
  const contenu: ContenuInvitation = {
    v: 1,
    compte: o.compte,
    prenom: o.prenom.trim().slice(0, 30),
    jeton: jetonDeProfil(o.maitre.jeton, o.compte),
    relais: o.maitre.relais,
    ...(o.maitre.site ? { site: o.maitre.site } : {}),
    mdp: o.motDePasse,
    expire,
    ...(o.fondateur && o.fondateur !== 'Moi' ? { fondateur: o.fondateur.trim().slice(0, 30) } : {}),
    creeLe: new Date(maintenant).toISOString(),
    ...politiqueContenu(o.politique),
  };
  const version = await versionRelais(o.maitre, o.requete);
  const longueur = contenu.politique?.l ?? 10;
  const elements = { prenom: contenu.prenom, fondateur: contenu.fondateur, expire, site, lienConnexion: lienConnexion(site, o.maitre.relais), longueur };
  if (relaisAJour(version)) {
    const secret = nouveauSecret(alea);
    const secrets = secretsInvitation(secret);
    const codeCourt = nouveauCodeCourt(alea);
    const court = secretsCodeCourt(codeCourt, o.kdfCodeCourt);
    await publierInvitation(
      o.maitre,
      {
        id: secrets.id,
        profil: o.compte,
        expire,
        charge: scellerContenu(contenu, secrets, alea),
        verif: secrets.verif,
        acces: empreinteIdentifiant(contenu.prenom),
        court: { id: court.id, charge: scellerContenu(contenu, court, alea), verif: court.verif },
      },
      o.requete,
    );
    const lien = lienInvitation(site, encoderInvitation({ mode: 'relais', relais: o.maitre.relais, ...(o.maitre.site ? { site: o.maitre.site } : {}), secret }));
    return {
      lien,
      codeCourt,
      expire,
      mode: 'relais',
      lienConnexion: elements.lienConnexion,
      message: messageInvitation({ ...elements, lien, codeCourt }),
      prenom: elements.prenom,
      ...(elements.fondateur ? { fondateur: elements.fondateur } : {}),
      site,
      longueur,
    };
  }
  // Relais pas encore redéployé : le contenu voyage dans le lien (le mot de passe temporaire n'y sert qu'une fois).
  const lien = lienInvitation(site, encoderInvitation({ mode: 'lien', relais: o.maitre.relais, ...(o.maitre.site ? { site: o.maitre.site } : {}), contenu }));
  return {
    lien,
    expire,
    mode: 'lien',
    message: messageInvitation({ ...elements, lienConnexion: undefined, lien }),
    prenom: elements.prenom,
    ...(elements.fondateur ? { fondateur: elements.fondateur } : {}),
    site,
    longueur,
    avertissement:
      version === undefined
        ? 'Relais injoignable pour l’instant : l’invitation marche quand même (lien complet), mais pensez à garder l’app ouverte pour publier le compte.'
        : 'Relais à mettre à jour (serveur o2switch, docs/o2switch.md) : en attendant, le lien marche, mais l’usage unique et l’expiration sont vérifiés par l’appareil, et la connexion par identifiant sur un nouvel appareil n’est pas disponible.',
  };
}

/** Bilan du nettoyage d'un compte supprimé sur le relais. */
export interface NettoyageRelais {
  /** Objets effacés de son espace (`p/<id>/boite/…` : coffre, portefeuille, annuaire, suivi…). */
  objets: number;
  /** Accès par identifiant retiré. */
  acces: boolean;
  /** Jeton de profil révoqué (un appareil resté connecté est refusé). */
  revoque: boolean;
  /** Ce qui n'a pas pu être fait (relais ancien, injoignable…). */
  restes: string[];
}

/**
 * Efface les copies d'un compte SUPPRIMÉ sur le relais (jeton maître) : tous
 * les objets de son espace, son accès par identifiant, et révoque son jeton
 * de profil pour qu'un appareil resté connecté n'écrive plus rien. Chaque
 * étape est tentée même si une autre échoue ; aucune route nouvelle (relais 6).
 */
export async function nettoyerCompteRelais(maitre: Liaison, compte: string, prenom: string, requete?: Fetch): Promise<NettoyageRelais> {
  const bilan: NettoyageRelais = { objets: 0, acces: false, revoque: false, restes: [] };
  const espaces = espacesDuRelais(maitre, requete);
  try {
    const objets = await espaces.lister(compte);
    for (const nom of Object.keys(objets)) {
      try {
        await espaces.supprimer(compte, nom);
        bilan.objets++;
      } catch (e) {
        bilan.restes.push(`${nom} : ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } catch (e) {
    bilan.restes.push(`espace du compte : ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    // Version 9 : son coffre serveur (données chiffrées par sa clé) part aussi.
    await viderCoffreServeur(maitre, compte, requete);
  } catch (e) {
    bilan.restes.push(`coffre serveur : ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    await supprimerAcces(maitre, empreinteIdentifiant(prenom), requete);
    bilan.acces = true;
  } catch (e) {
    bilan.restes.push(`accès par identifiant : ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    await revoquerCompte(maitre, compte, true, requete);
    bilan.revoque = true;
  } catch (e) {
    bilan.restes.push(e instanceof ErreurInvitation && e.code === 'relais-ancien' ? 'révocation : relais à mettre à jour' : `révocation : ${e instanceof Error ? e.message : String(e)}`);
  }
  return bilan;
}

// ------------------------------------------------------------ Côté ami

export interface InvitationChargee {
  lien: LienInvitation;
  contenu: ContenuInvitation;
  /** Secrets de l'invitation sur le relais (mode relais), pour la consommer. */
  secrets?: SecretsInvitation;
}

/** Ouvre une invitation : vérifie qu'elle est encore bonne et dit pour qui elle est. */
export async function chargerInvitation(lien: LienInvitation, requete?: Fetch, maintenant: () => number = Date.now): Promise<InvitationChargee> {
  if (lien.mode === 'relais') {
    const secrets = secretsInvitation(lien.secret);
    const lu = await lireInvitationRelais(lien.relais, secrets.id, undefined, requete);
    const contenu = ouvrirContenu(lu.charge, secrets);
    return { lien, contenu, secrets };
  }
  // Ancien relais : l'expiration est jugée à l'heure du relais (horloge de l'appareil possiblement décalée).
  const contenu = lien.contenu;
  const heure = (await heureRelais({ relais: contenu.relais, jeton: contenu.jeton }, requete)) ?? maintenant();
  if (invitationExpiree(contenu, heure)) {
    throw new ErreurInvitation('invitation-expiree', messageErreur('invitation-expiree', { qui: contenu.fondateur }));
  }
  return { lien, contenu };
}

/** Code court tapé sur le site (relais connu du site). */
export async function chargerCodeCourt(relais: string, code: string, requete?: Fetch, kdf?: ParametresKdf): Promise<InvitationChargee> {
  const secrets = secretsCodeCourt(code, kdf);
  const lu = await lireInvitationRelais(relais, secrets.id, undefined, requete);
  const contenu = ouvrirContenu(lu.charge, secrets);
  return { lien: { mode: 'relais', relais, secret: '' }, contenu, secrets };
}

const liaisonDe = (c: Pick<ContenuInvitation, 'relais' | 'jeton' | 'site'>): Liaison => ({ relais: c.relais, jeton: c.jeton, ...(c.site ? { site: c.site } : {}) });

/** Prépare la liaison du compte ; « pas encore publié » devient un message précis. */
async function relierCompte(liaison: Liaison, qui: string | undefined, requete?: Fetch): Promise<CompteRelie> {
  try {
    return await preparerLiaison(encoderLiaison(liaison), requete);
  } catch (erreur) {
    if (erreur instanceof ErreurRelais) {
      if (erreur.statut === 404) throw new ErreurInvitation('non-publie', messageErreur('non-publie', { qui }));
      if (erreur.statut === 403) throw new ErreurInvitation('acces-revoque', messageErreur('acces-revoque', { qui }));
      if (erreur.statut === undefined && /injoignable/i.test(erreur.message)) throw new ErreurInvitation('relais-injoignable');
    }
    throw erreur;
  }
}

export interface Acceptation {
  relie: CompteRelie;
  contenu: ContenuInvitation;
  /** Coffre rescellé par le mot de passe choisi, tel que publié (octets et date du dépôt). */
  coffre: Coffre;
  octets: Uint8Array;
  date: string;
  /** Ce qui n'a pas marché sans empêcher la connexion (accès par identifiant…). */
  avertissements: string[];
}

export interface OptionsAcceptation {
  invitation: InvitationChargee;
  motDePasse: string;
  requete?: Fetch;
  alea?: SourceAleatoire;
  kdf?: ParametresKdf;
  maintenant?: () => Date;
}

/**
 * L'ami choisit son mot de passe : son coffre (tiré du relais) est rescellé,
 * publié AVANT que l'invitation soit consommée (un échec réseau ne la brûle
 * pas), puis son accès par identifiant est déposé.
 */
export async function accepterInvitation(o: OptionsAcceptation): Promise<Acceptation> {
  const { contenu } = o.invitation;
  const qui = contenu.fondateur;
  // La politique réglée par le Fondateur est revérifiée ici, pas seulement par l'écran.
  const evaluation = evaluerMotDePasse(o.motDePasse, contenu.prenom, politiqueDeContenu(contenu));
  if (!evaluation.valide) throw new Error(`Mot de passe refusé : ${evaluation.erreurs.join(' ')}`);
  const liaison = liaisonDe(contenu);
  const relie = await relierCompte(liaison, qui, o.requete);
  const espaces = espacesDuRelais(liaison, o.requete);
  let distant;
  try {
    distant = await espaces.lire(contenu.compte, 'coffre');
  } catch (erreur) {
    if (erreur instanceof ErreurRelais && /injoignable/i.test(erreur.message)) throw new ErreurInvitation('relais-injoignable');
    throw erreur;
  }
  if (!distant) throw new ErreurInvitation('non-publie', messageErreur('non-publie', { qui }));
  let coffre: unknown;
  try {
    coffre = JSON.parse(new TextDecoder().decode(chargeEnOctets(distant.charge)));
  } catch {
    coffre = undefined;
  }
  if (!coffreValide(coffre)) throw new ErreurInvitation('non-publie', messageErreur('non-publie', { qui }));
  let resultat;
  try {
    resultat = coffreApresInvitation(coffre, contenu.mdp, o.motDePasse, { kdf: o.kdf, alea: o.alea });
  } catch (erreur) {
    if (erreur instanceof ErreurInvitationUtilisee) throw new ErreurInvitation('invitation-utilisee');
    throw erreur;
  }
  resultat.cle.fill(0);
  const octets = new TextEncoder().encode(JSON.stringify(resultat.coffre));
  // Toujours postérieure au dépôt distant : les autres appareils (et le Fondateur) la verront plus récente.
  let date = (o.maintenant ?? (() => new Date()))().toISOString();
  if (date <= distant.date) date = new Date(Date.parse(distant.date) + 1).toISOString();
  try {
    await espaces.deposer(contenu.compte, 'coffre', octetsEnCharge(octets), date);
  } catch (erreur) {
    if (erreur instanceof ErreurRelais && erreur.statut === 403) throw new ErreurInvitation('acces-revoque', messageErreur('acces-revoque', { qui }));
    throw new ErreurInvitation('relais-injoignable');
  }
  const avertissements: string[] = [];
  if (o.invitation.secrets) {
    await utiliserInvitationRelais(contenu.relais, o.invitation.secrets.id, o.invitation.secrets.preuve, o.requete).catch(e =>
      avertissements.push(`Invitation : ${e instanceof Error ? e.message : String(e)}`),
    );
  }
  // Accès par identifiant (appareils suivants) : relais à jour seulement.
  const acces: ContenuAcces = { v: 1, compte: contenu.compte, prenom: contenu.prenom, jeton: contenu.jeton, relais: contenu.relais, ...(contenu.site ? { site: contenu.site } : {}) };
  await publierAcces(liaison, empreinteIdentifiant(contenu.prenom), preparerAcces(o.motDePasse, acces, o.alea, o.kdf), o.requete).catch(e =>
    avertissements.push(e instanceof ErreurInvitation && e.code === 'relais-ancien' ? 'Connexion par identifiant sur un autre appareil : relais à mettre à jour.' : `Accès par identifiant : ${e instanceof Error ? e.message : String(e)}`),
  );
  return { relie, contenu, coffre: resultat.coffre, octets, date, avertissements };
}

/** Republie l'accès par identifiant (mot de passe changé, ou dépôt manqué à l'acceptation). */
export async function republierAcces(liaison: Liaison, compte: string, prenom: string, motDePasse: string, requete?: Fetch, alea?: SourceAleatoire, kdf?: ParametresKdf): Promise<void> {
  const acces: ContenuAcces = { v: 1, compte, prenom, jeton: liaison.jeton, relais: liaison.relais, ...(liaison.site ? { site: liaison.site } : {}) };
  await publierAcces(liaison, empreinteIdentifiant(prenom), preparerAcces(motDePasse, acces, alea, kdf), requete);
}

export interface ConnexionIdentifiant {
  relie: CompteRelie;
  acces: ContenuAcces;
  /** Vrai pour le Fondateur (compte `principal`, session ouverte par son mot de passe). */
  fondateur: boolean;
  /** Connexion par code de récupération : rang du code utilisé (à retirer de l'accès de secours). */
  secours?: number;
}

/**
 * Nouvel appareil : identifiant + mot de passe, POUR TOUS (Fondateur compris, version 9). Le relais
 * vérifie une preuve tirée du mot de passe (Argon2id puis HKDF, séparée de la clé qui ouvre la
 * charge : il ne voit ni l'un ni l'autre) et freine les essais ; il rend de quoi retrouver le compte,
 * scellé par une clé tirée du même mot de passe. Le Fondateur reçoit en plus un jeton de SESSION
 * (le jeton maître reste sur le serveur). Un identifiant inconnu échoue exactement comme un mauvais
 * mot de passe. Compte avec validation en deux étapes : `code` (six chiffres), vérifié par le serveur ;
 * sans lui, `ErreurInvitation('a2f-requis')`.
 */
export async function connecterParIdentifiant(relais: string, identifiant: string, motDePasse: string, requete?: Fetch, code?: string): Promise<ConnexionIdentifiant> {
  const h = empreinteIdentifiant(identifiant);
  const { sel, kdf } = await lireSelAcces(relais, h, requete);
  const { cle, preuve } = preuveAcces(motDePasse, sel, kdf);
  try {
    // Validation en deux étapes (version 10) : sans code, le serveur répond `a2f-requis` (rien d'autre).
    const ouvert = await ouvrirAccesRelais(relais, h, preuve, requete, 'ouvrir', code);
    return await terminerConnexion(ouvert, cle, requete);
  } finally {
    cle.fill(0);
  }
}

/** « Mot de passe oublié » : identifiant + un code de récupération (accès de secours). */
export async function connecterParSecours(relais: string, identifiant: string, code: string, requete?: Fetch): Promise<ConnexionIdentifiant> {
  const h = empreinteIdentifiant(identifiant);
  const lu = await lireSelAcces(relais, h, requete);
  if (!lu.secours) throw new ErreurInvitation('relais-ancien');
  const { cle, preuve } = preuveSecours(code, lu.secours.sel, lu.secours.kdf);
  try {
    const ouvert = await ouvrirAccesRelais(relais, h, preuve, requete, 'secours');
    return await terminerConnexion(ouvert, cle, requete);
  } finally {
    cle.fill(0);
  }
}

async function terminerConnexion(ouvert: { compte: string; charge: string; jeton?: string; secours?: number }, cle: Uint8Array, requete?: Fetch): Promise<ConnexionIdentifiant> {
  const acces = ouvrirAcces(ouvert.charge, cle, ouvert.compte);
  const fondateur = ouvert.compte === 'principal';
  const jeton = fondateur ? ouvert.jeton : acces.jeton;
  if (!jeton) throw new ErreurInvitation('relais-ancien');
  const relie = await relierCompte({ relais: acces.relais, jeton, ...(acces.site ? { site: acces.site } : {}) }, undefined, requete);
  return { relie, acces, fondateur, ...(ouvert.secours !== undefined ? { secours: ouvert.secours } : {}) };
}

export interface AccesFondateur {
  /** Liaison du Fondateur (jeton maître du PC, ou sa session). */
  maitre: Liaison;
  /** Identifiant choisi (son prénom, par exemple) : majuscules, accents et espaces ne comptent pas. */
  identifiant: string;
  motDePasse: string;
  /** Codes de récupération en clair (accès de secours si le mot de passe est oublié). */
  codes?: readonly string[];
  requete?: Fetch;
  alea?: SourceAleatoire;
  kdf?: ParametresKdf;
}

/**
 * Publie l'accès par identifiant du Fondateur (migration de son compte) : preuve tirée du mot de
 * passe, charge scellée (relais, site, identifiant ; jamais de jeton), accès de secours par codes de
 * récupération. 409 « identifiant-pris » si un autre compte l'a déjà.
 */
export async function publierAccesFondateur(o: AccesFondateur): Promise<string> {
  const identifiant = o.identifiant.trim().slice(0, 30);
  const contenu: ContenuAcces = { v: 1, compte: 'principal', prenom: identifiant, relais: o.maitre.relais, ...(o.maitre.site ? { site: o.maitre.site } : {}) };
  const h = empreinteIdentifiant(identifiant);
  const depot = preparerAcces(o.motDePasse, contenu, o.alea, o.kdf);
  if (o.codes && o.codes.length > 0) depot.secours = preparerSecours(o.codes, contenu, o.alea, o.kdf);
  await publierAcces(o.maitre, h, depot, o.requete);
  return h;
}
