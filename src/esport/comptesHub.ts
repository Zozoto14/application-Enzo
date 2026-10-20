/**
 * Invitation directe depuis l'Esport : création du compte du hub (le MÊME
 * mécanisme que l'Administration), puis pré-enregistrement côté serveur Esport.
 *
 * Étapes de `creerCompteEsport` :
 *  1. contrôle côté serveur Esport (pseudo libre, teams et rôles valides) AVANT
 *     de créer quoi que ce soit dans le hub ;
 *  2. compte du hub : `ControleProfils.onCreerCompte` (rang Ami, modèle
 *     « Esport seulement » : apps ['esport'], badge Esport ; coffre, séquestre
 *     pour les rangs supérieurs, invitation de première connexion à usage
 *     unique : l'ami choisit SON mot de passe en ouvrant le lien) ;
 *  3. adresse e-mail et journal dans les données chiffrées de l'Administration
 *     (base du Fondateur : `admin/donnees.ts`), jamais sur le serveur Esport ;
 *  4. pré-enregistrement Esport (`POST /comptes`) : identifiant du compte,
 *     pseudo, teams et rôles. Le joueur voit ses teams dès sa première session.
 *
 * Possible seulement sur un appareil où le Fondateur est connecté (il faut ses
 * clés pour le séquestre, comme dans l'Administration) : voir `capaciteComptes`.
 */

import { avecEmailCreationPar, avecEnvoiPar, desactiverPar } from '../hub/admin/actions';
import { versAutorisations } from '../hub/admin/comptes';
import { erreurEmail, normaliserEmail, type CanalInvitation, LIBELLES_CANAL } from '../hub/admin/contacts';
import { avecEvenement, chargerDonnees, enregistrerDonnees, type DonneesAdmin } from '../hub/admin/donnees';
import type { EvenementAudit } from '../hub/admin/journal';
import type { ModeleInvitation } from '../hub/admin/modeleInvitation';
import { niveauxDuModele } from '../hub/admin/niveaux';
import { autorise, rangDe } from '../hub/admin/roles';
import type { AppHub, ContexteHub } from '../hub/types';
import type { InvitationAffichee } from '../profils/identifiants';
import type { Affectation, ClientEsport, CompteEsport } from './client';

/** Même règle que le serveur (esport/noyau/service.mjs) : le pseudo sert aussi d'identifiant dans le hub. */
export const MOTIF_PSEUDO = /^[\p{L}\p{N}][\p{L}\p{N} _.\-]{1,23}$/u;

export interface CapaciteComptes {
  /** Créer un compte (et renvoyer ou révoquer une invitation) est possible sur cet appareil. */
  creer: boolean;
  /** Sinon, pourquoi (affiché à la place du bouton). */
  raison?: string;
}

/**
 * Le Fondateur, connecté sur CET appareil (clés du séquestre, données de
 * l'Administration), et reconnu comme super admin par le serveur Esport.
 */
export function capaciteComptes(contexte: ContexteHub, superAdmin: boolean): CapaciteComptes {
  const controle = contexte.profils;
  const acteur = controle?.actuel;
  if (!superAdmin) {
    return { creer: false, raison: 'Seul le Fondateur crée des comptes (il faut ses clés du hub). Vous pouvez ajouter à vos teams un compte qui existe déjà.' };
  }
  if (!controle?.onCreerCompte || !contexte.admin || !acteur || controle.restreint || controle.sessionAdmin) {
    return { creer: false, raison: 'Créer un compte se fait sur un appareil où le Fondateur est connecté (comme dans l’Administration) : son PC ou son iPhone relié au relais.' };
  }
  if (rangDe(acteur) !== 'fondateur' || !autorise(acteur, 'creer-ami').ok) {
    return { creer: false, raison: 'Réservé au Fondateur.' };
  }
  return { creer: true };
}

export interface SaisieCompte {
  nom: string;
  email: string;
  affectations: Affectation[];
}

/** Problème de saisie (undefined : prêt à créer). */
export function erreurSaisie(saisie: SaisieCompte): string | undefined {
  const nom = saisie.nom.trim();
  if (!MOTIF_PSEUDO.test(nom)) return 'Nom ou pseudo : 2 à 24 caractères (lettres, chiffres, espace, _ . -).';
  if (!saisie.email.trim()) return 'L’adresse e-mail est obligatoire : c’est par elle que part l’invitation.';
  const email = erreurEmail(saisie.email);
  if (email) return email;
  if (saisie.affectations.length === 0) return 'Choisissez au moins une team et un rôle.';
  return undefined;
}

function optionsInvitation(donnees: DonneesAdmin) {
  const r = donnees.reglages;
  return { politique: { longueurMin: r.mdpLongueurMin, forceMin: Math.min(4, Math.max(1, r.mdpForceMin)) as 1 | 2 | 3 | 4 } };
}

function majDonnees(contexte: ContexteHub, changer: (d: DonneesAdmin) => DonneesAdmin): DonneesAdmin {
  const stockage = contexte.admin!.stockage;
  const suivantes = changer(chargerDonnees(stockage));
  enregistrerDonnees(stockage, suivantes);
  return suivantes;
}

function journaliser(contexte: ContexteHub, evenement: Omit<EvenementAudit, 'date'>, maintenant: number): void {
  majDonnees(contexte, d => avecEvenement(d, { ...evenement, app: 'esport' }, maintenant));
}

export interface CompteCree {
  id: string;
  nom: string;
  email: string;
  invitation: InvitationAffichee;
  /** Fiche Esport (pré-enregistrement réussi). */
  fiche: CompteEsport | null;
  /** Le compte du hub existe mais le pré-enregistrement Esport a échoué : à refaire (« Rattacher »). */
  erreurEsport?: string;
}

/** Crée le compte (hub + Esport). Lève si rien n'a été créé ; `erreurEsport` si seul le rattachement a échoué. */
export async function creerCompteEsport({
  contexte,
  registre,
  client,
  saisie,
  nomsTeams,
  maintenant = Date.now(),
}: {
  contexte: ContexteHub;
  registre: readonly AppHub[];
  client: ClientEsport;
  saisie: SaisieCompte;
  nomsTeams: string[];
  maintenant?: number;
}): Promise<CompteCree> {
  const probleme = erreurSaisie(saisie);
  if (probleme) throw new Error(probleme);
  const controle = contexte.profils!;
  const acteur = controle.actuel;
  const nom = saisie.nom.trim();
  const email = normaliserEmail(saisie.email);
  // 1. Serveur Esport d'abord : un pseudo pris ne doit pas laisser un compte du hub orphelin.
  await client.verifierPreinscription({ pseudo: nom, affectations: saisie.affectations });
  // 2. Compte du hub, comme l'Administration (modèle « Esport seulement »).
  const donnees = chargerDonnees(contexte.admin!.stockage);
  const { apps, niveaux } = versAutorisations(registre, niveauxDuModele(registre, 'esport'));
  const jours = donnees.reglages.invitationJours || 7;
  const valeurs = await controle.onCreerCompte!(nom, apps, { niveaux, invitationExpireLe: new Date(maintenant + jours * 86_400_000).toISOString() }, optionsInvitation(donnees));
  if (!valeurs.id) throw new Error('Le compte a été créé sans identifiant : ouvrez l’Administration pour le terminer.');
  const id = valeurs.id;
  // 3. Adresse (chiffrée, base du Fondateur) et journal de l'Administration.
  majDonnees(contexte, d =>
    avecEvenement(
      avecEmailCreationPar(acteur, d, id, email, maintenant),
      { type: 'compte', cible: id, nomCible: nom, app: 'esport', action: `Compte de ${nom} créé depuis l’Esport (Esport seulement ; teams : ${nomsTeams.join(', ')} ; adresse e-mail enregistrée)` },
      maintenant,
    ),
  );
  // 4. Pré-enregistrement Esport.
  try {
    const fiche = await client.preinscrire({ compte: id, pseudo: nom, affectations: saisie.affectations });
    return { id, nom, email, invitation: valeurs.invitation ?? { erreur: 'Invitation indisponible sur cet appareil.' }, fiche };
  } catch (e) {
    const texte = e instanceof Error ? e.message : String(e);
    return { id, nom, email, invitation: valeurs.invitation ?? { erreur: 'Invitation indisponible sur cet appareil.' }, fiche: null, erreurEsport: texte };
  }
}

/** Refait le pré-enregistrement Esport d'un compte du hub déjà créé (après un échec réseau). */
export async function rattacherCompte(client: ClientEsport, id: string, nom: string, affectations: Affectation[]): Promise<CompteEsport | null> {
  return client.preinscrire({ compte: id, pseudo: nom, affectations });
}

/** Nouveau lien d'invitation (l'ancien cesse de marcher) : même action que l'Administration. */
export async function renvoyerInvitation(contexte: ContexteHub, id: string, nom: string, maintenant = Date.now()): Promise<InvitationAffichee> {
  const controle = contexte.profils;
  if (!controle?.onInvitation || !contexte.admin) throw new Error('Renvoyer l’invitation se fait sur l’appareil du Fondateur (relié au relais avec le code maître).');
  const profil = controle.tous.find(p => p.id === id);
  if (profil?.derniereConnexion) throw new Error(`${nom} s’est déjà connecté : pour un mot de passe oublié, passez par l’Administration (« Réinitialiser l’accès »).`);
  const donnees = chargerDonnees(contexte.admin.stockage);
  const jours = donnees.reglages.invitationJours || 7;
  const invitation = await controle.onInvitation(id, jours, optionsInvitation(donnees));
  if (!invitation.erreur) {
    journaliser(contexte, { type: 'invitation', cible: id, nomCible: nom, action: `Nouvelle invitation de ${nom} préparée depuis l’Esport (${jours} j) : l’ancienne ne fonctionne plus` }, maintenant);
  }
  return invitation;
}

/**
 * Révoque l'accès d'un compte (invitation comprise) : le relais refuse son
 * jeton et le compte est désactivé dans le hub, comme « Révoquer l'accès » de
 * l'Administration (où l'on peut le rétablir).
 */
export async function revoquerCompte(contexte: ContexteHub, id: string, nom: string, maintenant = Date.now()): Promise<void> {
  const controle = contexte.profils;
  if (!controle?.onModifierProfils || !contexte.admin) throw new Error('Révoquer se fait sur l’appareil du Fondateur.');
  if (controle.onRevoquerConnexion) await controle.onRevoquerConnexion(id, true);
  await controle.onModifierProfils(desactiverPar(controle.actuel, controle.tous, id));
  journaliser(contexte, { type: 'compte', cible: id, nomCible: nom, action: `Accès de ${nom} révoqué depuis l’Esport (relais et compte désactivé)` }, maintenant);
}

/** Note une transmission d'invitation (historique du compte, journal sans l'adresse). */
export function noterEnvoiEsport(contexte: ContexteHub, id: string, nom: string, canal: CanalInvitation, maintenant = Date.now()): void {
  const controle = contexte.profils;
  if (!controle || !contexte.admin) return;
  try {
    majDonnees(contexte, d =>
      avecEvenement(
        avecEnvoiPar(controle.actuel, d, controle.tous, id, canal, maintenant),
        { type: 'invitation', cible: id, nomCible: nom, app: 'esport', action: `Invitation de ${nom} transmise (${LIBELLES_CANAL[canal].toLowerCase()})` },
        maintenant,
      ),
    );
  } catch {
    // Compte pas encore dans la liste de cet appareil (synchronisation en cours) : l'envoi reste valable.
  }
}

/** Adresse enregistrée d'un compte (données de l'Administration), pour le destinataire du `mailto:`. */
export function emailDe(contexte: ContexteHub, id: string): string | undefined {
  if (!contexte.admin) return undefined;
  return chargerDonnees(contexte.admin.stockage).contacts[id]?.email;
}

/** Modèle personnalisé de l'Administration, s'il y en a un (sinon : modèle Esport). */
export function modelePersonnalise(contexte: ContexteHub): ModeleInvitation | undefined {
  return contexte.admin ? chargerDonnees(contexte.admin.stockage).modeleInvitation : undefined;
}

const sansAccolades = (texte: string) => texte.replace(/[{}]/g, '').trim();

/** Message d'invitation Esport (variables du modèle de l'Administration ; les noms de teams sont du texte). */
export function modeleInvitationEsport(teams: readonly string[]): ModeleInvitation {
  const liste = teams.map(sansAccolades).filter(Boolean);
  const phraseTeams = liste.length === 0 ? 'dans l’Esport' : liste.length === 1 ? `dans la team ${liste[0]}` : `dans les teams ${liste.slice(0, -1).join(', ')} et ${liste[liste.length - 1]}`;
  return {
    objet: '{fondateur} t’invite dans l’Esport (AppDashboard)',
    corps: [
      'Salut {prenom} !',
      '',
      `{fondateur} t’a ajouté ${phraseTeams}.`,
      '',
      '1. Ouvre ce lien (sur ton téléphone ou ton ordinateur) :',
      '{lien}',
      '2. Choisis ton mot de passe ({longueur} caractères au moins). Ton identifiant : {prenom}',
      '3. Ouvre la tuile Esport : ta team est déjà là, aucun code à saisir.',
      '',
      'Le lien ne marche qu’une fois, jusqu’au {expiration}. Ne le transfère à personne.',
      '',
      'Si le lien ne s’ouvre pas : va sur {site}, touche « J’ai une invitation » et tape le code {code}.',
      'Plus tard, sur un autre appareil : {connexion} puis ton prénom et ton mot de passe.',
    ].join('\n'),
  };
}
