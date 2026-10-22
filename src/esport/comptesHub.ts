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

import { avecEmailCreationPar, avecEnvoiPar, avecLangueComptePar, avecLangueCreationPar, desactiverPar } from '../hub/admin/actions';
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
import { NOM_LANGUE, langueCourante, tr, traduire, type Langue } from './i18n';

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
    return { creer: false, raison: tr('comptesHub.seul_le_fondateur_cree') };
  }
  if (!controle?.onCreerCompte || !contexte.admin || !acteur || controle.restreint || controle.sessionAdmin) {
    return { creer: false, raison: tr('comptesHub.creer_un_compte_se') };
  }
  if (rangDe(acteur) !== 'fondateur' || !autorise(acteur, 'creer-ami').ok) {
    return { creer: false, raison: tr('comptesHub.reserve_au_fondateur') };
  }
  return { creer: true };
}

export interface SaisieCompte {
  nom: string;
  email: string;
  /** Discord ID (17 à 20 chiffres), obligatoire : le bot pingue les convoqués avec. */
  discordId: string;
  /** Langue par défaut du compte (interface Esport tant qu'il n'a pas choisi la sienne, e-mails, bot Discord) ; français sans choix. */
  langue?: Langue;
  affectations: Affectation[];
  /** Validation d'une demande de compte (permission « Créer des membres ») : close avec le pré-enregistrement. */
  demandeId?: string;
}

/** Problème de saisie (undefined : prêt à créer). */
export function erreurSaisie(saisie: SaisieCompte): string | undefined {
  const nom = saisie.nom.trim();
  if (!MOTIF_PSEUDO.test(nom)) return tr('comptesHub.nom_ou_pseudo_2');
  if (!saisie.email.trim()) return tr('comptesHub.l_adresse_e_mail');
  const email = erreurEmail(saisie.email);
  if (email) return email;
  const discord = erreurDiscordId(saisie.discordId, true);
  if (discord) return discord;
  if (saisie.affectations.length === 0) return tr('comptesHub.choisissez_au_moins_une');
  return undefined;
}

/** Même règle que le serveur (esport/noyau/discordId.mjs) : 17 à 20 chiffres ; une mention collée est acceptée. */
export const MOTIF_DISCORD_ID = /^[1-9]\d{16,19}$/;
export const normaliserDiscordId = (v: string): string => v.trim().replace(/^<@!?(\d+)>$/, '$1').replace(/\s+/g, '');
export function erreurDiscordId(v: string, obligatoire: boolean): string | undefined {
  const id = normaliserDiscordId(v);
  if (!id) return obligatoire ? tr('discordId.obligatoire') : undefined;
  return MOTIF_DISCORD_ID.test(id) ? undefined : tr('discordId.invalide');
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
  discordId: string;
  langue: Langue;
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
  const discordId = normaliserDiscordId(saisie.discordId);
  await client.verifierPreinscription({ pseudo: nom, discordId, affectations: saisie.affectations, ...(saisie.demandeId ? { demandeId: saisie.demandeId } : {}) });
  // 2. Compte du hub, comme l'Administration (modèle « Esport seulement »).
  const donnees = chargerDonnees(contexte.admin!.stockage);
  const { apps, niveaux } = versAutorisations(registre, niveauxDuModele(registre, 'esport'));
  const jours = donnees.reglages.invitationJours || 7;
  const valeurs = await controle.onCreerCompte!(nom, apps, { niveaux, invitationExpireLe: new Date(maintenant + jours * 86_400_000).toISOString() }, optionsInvitation(donnees));
  if (!valeurs.id) throw new Error(tr('comptesHub.le_compte_a_ete'));
  const id = valeurs.id;
  // 3. Adresse et langue par défaut (chiffrées, base du Fondateur) et journal de l'Administration.
  const langue: Langue = saisie.langue === 'en' ? 'en' : 'fr';
  majDonnees(contexte, d =>
    avecEvenement(
      avecLangueCreationPar(acteur, avecEmailCreationPar(acteur, d, id, email, maintenant), id, langue),
      { type: 'compte', cible: id, nomCible: nom, app: 'esport', action: traduire('fr', 'comptesHub.compte_de_cree_depuis', { nom, v: nomsTeams.join(', ') }) },
      maintenant,
    ),
  );
  // 4. Pré-enregistrement Esport.
  try {
    const fiche = await client.preinscrire({ compte: id, pseudo: nom, discordId, langue, affectations: saisie.affectations, ...(saisie.demandeId ? { demandeId: saisie.demandeId } : {}) });
    return { id, nom, email, discordId, langue, invitation: valeurs.invitation ?? { erreur: tr('comptesHub.invitation_indisponible_sur_ce') }, fiche };
  } catch (e) {
    const texte = e instanceof Error ? e.message : String(e);
    return { id, nom, email, discordId, langue, invitation: valeurs.invitation ?? { erreur: tr('comptesHub.invitation_indisponible_sur_ce') }, fiche: null, erreurEsport: texte };
  }
}

/** Refait le pré-enregistrement Esport d'un compte du hub déjà créé (après un échec réseau). */
export async function rattacherCompte(client: ClientEsport, id: string, nom: string, affectations: Affectation[], demandeId?: string, discordId = '', langue: Langue = 'fr'): Promise<CompteEsport | null> {
  return client.preinscrire({ compte: id, pseudo: nom, discordId: normaliserDiscordId(discordId), langue, affectations, ...(demandeId ? { demandeId } : {}) });
}

/** Nouveau lien d'invitation (l'ancien cesse de marcher) : même action que l'Administration. */
export async function renvoyerInvitation(contexte: ContexteHub, id: string, nom: string, maintenant = Date.now()): Promise<InvitationAffichee> {
  const controle = contexte.profils;
  if (!controle?.onInvitation || !contexte.admin) throw new Error(tr('comptesHub.renvoyer_l_invitation_se'));
  const profil = controle.tous.find(p => p.id === id);
  if (profil?.derniereConnexion) throw new Error(tr('comptesHub.s_est_deja_connecte', { nom }));
  const donnees = chargerDonnees(contexte.admin.stockage);
  const jours = donnees.reglages.invitationJours || 7;
  const invitation = await controle.onInvitation(id, jours, optionsInvitation(donnees));
  if (!invitation.erreur) {
    journaliser(contexte, { type: 'invitation', cible: id, nomCible: nom, action: traduire('fr', 'comptesHub.nouvelle_invitation_de_prepare', { nom, jours }) }, maintenant);
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
  if (!controle?.onModifierProfils || !contexte.admin) throw new Error(tr('comptesHub.revoquer_se_fait_sur'));
  if (controle.onRevoquerConnexion) await controle.onRevoquerConnexion(id, true);
  await controle.onModifierProfils(desactiverPar(controle.actuel, controle.tous, id));
  journaliser(contexte, { type: 'compte', cible: id, nomCible: nom, action: traduire('fr', 'comptesHub.acces_de_revoque_depuis', { nom }) }, maintenant);
}

/** Note une transmission d'invitation (historique du compte, journal sans l'adresse). */
export function noterEnvoiEsport(contexte: ContexteHub, id: string, nom: string, canal: CanalInvitation, maintenant = Date.now()): void {
  const controle = contexte.profils;
  if (!controle || !contexte.admin) return;
  try {
    majDonnees(contexte, d =>
      avecEvenement(
        avecEnvoiPar(controle.actuel, d, controle.tous, id, canal, maintenant),
        { type: 'invitation', cible: id, nomCible: nom, app: 'esport', action: traduire('fr', 'comptesHub.invitation_de_transmise', { nom, v: LIBELLES_CANAL[canal].toLowerCase() }) },
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

/** Langue par défaut enregistrée dans la fiche d'un compte (données de l'Administration) ; français sans réglage. */
export function langueDe(contexte: ContexteHub, id: string): Langue {
  if (!contexte.admin) return 'fr';
  return chargerDonnees(contexte.admin.stockage).contacts[id]?.langue ?? 'fr';
}

/**
 * Change la langue par défaut d'un compte depuis l'Esport (Fondateur seulement : 403 côté serveur pour les autres) : serveur
 * Esport d'abord (interface, e-mails de récapitulatif, bot), puis la fiche de l'Administration (e-mails d'invitation,
 * de support, Messagerie) quand les données de l'Administration sont accessibles sur cet appareil.
 */
export async function changerLangueCompte(contexte: ContexteHub, client: ClientEsport | null, id: string, nom: string, langue: Langue, maintenant = Date.now()): Promise<CompteEsport | null> {
  // Compte sans fiche Esport (jamais connecté) : le serveur garde la langue en attente jusqu'à sa première ouverture de l'Esport.
  const fiche = client ? await client.majLangueDefaut(id, langue) : null;
  const controle = contexte.profils;
  if (contexte.admin && controle && controle.tous.some(p => p.id === id)) {
    try {
      majDonnees(contexte, d => avecLangueComptePar(controle.actuel, d, controle.tous, id, langue));
      journaliser(contexte, { type: 'compte', cible: id, nomCible: nom, action: traduire('fr', 'comptesHub.langue_de_regl_e', { nom, v: NOM_LANGUE[langue] }) }, maintenant);
    } catch {
      // Compte pas encore dans la liste de cet appareil (synchronisation en cours) : le serveur Esport a la bonne langue.
    }
  }
  return fiche;
}

/** Modèle personnalisé de l'Administration, s'il y en a un (sinon : modèle Esport). */
export function modelePersonnalise(contexte: ContexteHub): ModeleInvitation | undefined {
  return contexte.admin ? chargerDonnees(contexte.admin.stockage).modeleInvitation : undefined;
}

const sansAccolades = (texte: string) => texte.replace(/[{}]/g, '').trim();

/** Message d'invitation Esport (variables du modèle de l'Administration ; les noms de teams sont du texte). */
export function modeleInvitationEsport(teams: readonly string[], langue: Langue = langueCourante()): ModeleInvitation {
  const t = (cle: Parameters<typeof traduire>[1], vars?: Parameters<typeof traduire>[2]) => traduire(langue, cle, vars);
  const liste = teams.map(sansAccolades).filter(Boolean);
  const phraseTeams = liste.length === 0 ? t('comptesHub.dans_l_esport') : liste.length === 1 ? t('comptesHub.dans_la_team', { v: liste[0] }) : t('comptesHub.dans_les_teams_et', { v: liste.slice(0, -1).join(', '), v2: liste[liste.length - 1] });
  return {
    objet: t('comptesHub.t_invite_dans_l'),
    corps: [
      t('comptesHub.salut'),
      '',
      t('comptesHub.t_a_ajoute', { phraseTeams }),
      '',
      t('comptesHub.1_ouvre_ce_lien'),
      '{lien}',
      t('comptesHub.2_choisis_ton_mot'),
      t('comptesHub.3_ouvre_la_tuile'),
      '',
      t('comptesHub.le_lien_ne_marche'),
      '',
      t('comptesHub.si_le_lien_ne'),
      t('comptesHub.plus_tard_sur_un'),
    ].join('\n'),
  };
}
