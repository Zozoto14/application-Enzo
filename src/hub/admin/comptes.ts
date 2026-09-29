/**
 * Comptes vus par l'Administration : statut, recherche, filtres, tri,
 * actions groupées, alertes et statistiques du tableau de bord.
 *
 * Données pures : l'horloge est passée en argument, rien n'est enregistré
 * ici. Les fonctions qui modifient la liste des profils rendent une nouvelle
 * liste, que l'hôte enregistre (et revalide) comme les autres.
 */

import { ErreurProfil, ID_PRINCIPAL, motifFermeture, type Profil } from '../../profils/profils';
import type { AppHub } from '../types';
import { ajusterNiveau, type NiveauAcces, type Niveaux } from './niveaux';
import { etatApp, type PolitiqueHub } from './politique';

const JOUR = 86_400_000;

export type StatutCompte = 'admin' | 'actif' | 'invite' | 'invitation-expiree' | 'suspendu' | 'desactive' | 'expire';

export const LIBELLES_STATUT: Record<StatutCompte, string> = {
  admin: 'Administrateur',
  actif: 'Actif',
  invite: 'Invitation en attente',
  'invitation-expiree': 'Invitation expirée',
  suspendu: 'Suspendu',
  desactive: 'Désactivé',
  expire: 'Accès expiré',
};

export function statutCompte(profil: Profil, maintenant: number): StatutCompte {
  if (profil.admin) {
    return 'admin';
  }
  if (profil.actif === false) {
    const fin = profil.desactiveJusquau ? Date.parse(profil.desactiveJusquau) : Number.NaN;
    if (Number.isNaN(fin)) {
      return 'desactive';
    }
    if (maintenant < fin) {
      return 'suspendu';
    }
  }
  if (profil.expireLe && maintenant >= Date.parse(profil.expireLe)) {
    return 'expire';
  }
  if (profil.invitationExpireLe && !profil.derniereConnexion) {
    return maintenant >= Date.parse(profil.invitationExpireLe) ? 'invitation-expiree' : 'invite';
  }
  return 'actif';
}

/** Vrai quand le profil s'ouvre aujourd'hui (même règle que le choix du profil). */
export function compteOuvrable(profil: Profil, maintenant: number): boolean {
  return motifFermeture(profil, maintenant) === undefined;
}

// --- Niveaux par app -----------------------------------------------------------

/** Niveau effectif d'un profil sur une app (l'administrateur a tout). */
export function niveauProfil(profil: Pick<Profil, 'admin' | 'apps' | 'niveaux'> | undefined, app: Pick<AppHub, 'id' | 'adminSeulement' | 'niveaux'>): NiveauAcces {
  if (!profil || profil.admin) {
    return 'complet';
  }
  if (app.adminSeulement || !(profil.apps ?? []).includes(app.id)) {
    return 'aucun';
  }
  const voulu = profil.niveaux?.[app.id] ?? 'complet';
  // Une app qui ne connaît plus la lecture seule ne l'ouvre pas en grand pour autant.
  return ajusterNiveau(app, voulu);
}

/** Tous les niveaux d'un profil sur les apps attribuables. */
export function niveauxProfil(profil: Profil, apps: readonly AppHub[]): Niveaux {
  return Object.fromEntries(apps.filter(app => !app.adminSeulement).map(app => [app.id, niveauProfil(profil, app)]));
}

/** Traduit des niveaux en liste d'apps + niveaux restreints (format enregistré). */
export function versAutorisations(apps: readonly AppHub[], niveaux: Niveaux): { apps: string[]; niveaux?: Record<string, NiveauAcces> } {
  const ouvertes: string[] = [];
  const restreints: Record<string, NiveauAcces> = {};
  for (const app of apps) {
    if (app.adminSeulement) {
      continue;
    }
    const niveau = ajusterNiveau(app, niveaux[app.id] ?? 'aucun');
    if (niveau === 'aucun') {
      continue;
    }
    ouvertes.push(app.id);
    if (niveau === 'lecture') {
      restreints[app.id] = 'lecture';
    }
  }
  return Object.keys(restreints).length > 0 ? { apps: ouvertes, niveaux: restreints } : { apps: ouvertes };
}

function exigerAmi(profils: readonly Profil[], id: string): Profil {
  if (id === ID_PRINCIPAL) {
    throw new ErreurProfil('Action impossible sur le profil administrateur.');
  }
  const profil = profils.find(p => p.id === id);
  if (!profil) {
    throw new ErreurProfil('Profil introuvable.');
  }
  return profil;
}

function remplacer(profils: readonly Profil[], id: string, changer: (p: Profil) => Profil): Profil[] {
  exigerAmi(profils, id);
  return profils.map(p => (p.id === id ? changer({ ...p }) : p));
}

export function definirNiveaux(profils: readonly Profil[], id: string, apps: readonly AppHub[], niveaux: Niveaux): Profil[] {
  const autorisations = versAutorisations(apps, niveaux);
  return remplacer(profils, id, p => {
    p.apps = autorisations.apps;
    if (autorisations.niveaux) {
      p.niveaux = autorisations.niveaux;
    } else {
      delete p.niveaux;
    }
    return p;
  });
}

/** Désactivation temporaire : le compte se rouvre seul à `jusquau` (ISO). */
export function suspendre(profils: readonly Profil[], id: string, jusquau: string, maintenant: number): Profil[] {
  const fin = Date.parse(jusquau);
  if (Number.isNaN(fin) || fin <= maintenant) {
    throw new ErreurProfil('Choisissez une date de fin dans le futur.');
  }
  return remplacer(profils, id, p => ({ ...p, actif: false, desactiveJusquau: new Date(fin).toISOString() }));
}

export function desactiver(profils: readonly Profil[], id: string): Profil[] {
  return remplacer(profils, id, p => {
    delete p.desactiveJusquau;
    return { ...p, actif: false };
  });
}

export function reactiver(profils: readonly Profil[], id: string): Profil[] {
  return remplacer(profils, id, p => {
    delete p.desactiveJusquau;
    return { ...p, actif: true };
  });
}

/** Prolonge (ou relance) l'invitation d'un compte jamais ouvert. */
export function prolongerInvitation(profils: readonly Profil[], id: string, jours: number, maintenant: number): Profil[] {
  const profil = exigerAmi(profils, id);
  if (profil.derniereConnexion) {
    throw new ErreurProfil('Ce compte a déjà été ouvert : l’invitation est acceptée.');
  }
  const base = Math.max(maintenant, profil.invitationExpireLe ? Date.parse(profil.invitationExpireLe) : maintenant);
  return remplacer(profils, id, p => ({ ...p, invitationExpireLe: new Date(base + Math.max(1, jours) * JOUR).toISOString() }));
}

/** Annule l'invitation : le compte ne s'ouvre plus (on peut la prolonger ensuite, ou le supprimer). */
export function annulerInvitation(profils: readonly Profil[], id: string, maintenant: number): Profil[] {
  const profil = exigerAmi(profils, id);
  if (profil.derniereConnexion) {
    throw new ErreurProfil('Ce compte a déjà été ouvert : il n’y a plus d’invitation à annuler.');
  }
  return remplacer(profils, id, p => ({ ...p, invitationExpireLe: new Date(maintenant).toISOString() }));
}

/** Fixe (ou retire) la fin d'accès du compte. */
export function definirExpiration(profils: readonly Profil[], id: string, expireLe: string | undefined): Profil[] {
  if (expireLe !== undefined && Number.isNaN(Date.parse(expireLe))) {
    throw new ErreurProfil('Date d’expiration invalide.');
  }
  return remplacer(profils, id, p => {
    if (expireLe) {
      p.expireLe = new Date(Date.parse(expireLe)).toISOString();
    } else {
      delete p.expireLe;
    }
    return p;
  });
}

export function changerPolitique(profils: readonly Profil[], politique: PolitiqueHub): Profil[] {
  return profils.map(p => (p.admin ? { ...p, politique } : p));
}

// --- Actions groupées ----------------------------------------------------------

export type ActionGroupee =
  | { genre: 'desactiver' }
  | { genre: 'reactiver' }
  | { genre: 'niveaux'; niveaux: Niveaux }
  | { genre: 'prolonger'; jours: number };

/** Applique une action à plusieurs comptes ; l'administrateur est toujours écarté. */
export function appliquerGroupe(
  profils: readonly Profil[],
  ids: readonly string[],
  action: ActionGroupee,
  apps: readonly AppHub[],
  maintenant: number,
): { profils: Profil[]; modifies: string[] } {
  let liste = [...profils];
  const modifies: string[] = [];
  for (const id of ids) {
    const profil = liste.find(p => p.id === id);
    if (!profil || profil.admin) {
      continue;
    }
    if (action.genre === 'desactiver') {
      liste = desactiver(liste, id);
    } else if (action.genre === 'reactiver') {
      liste = reactiver(liste, id);
    } else if (action.genre === 'niveaux') {
      liste = definirNiveaux(liste, id, apps, action.niveaux);
    } else {
      if (profil.derniereConnexion) {
        continue;
      }
      liste = prolongerInvitation(liste, id, action.jours, maintenant);
    }
    modifies.push(id);
  }
  return { profils: liste, modifies };
}

// --- Recherche, filtres, tri ---------------------------------------------------

export type TriComptes = 'nom' | 'creation' | 'connexion' | 'statut';

export interface FiltreComptes {
  recherche?: string;
  statut?: StatutCompte | 'tous';
  /** Identifiant d'app : seuls les comptes qui y ont accès. */
  app?: string;
  tri?: TriComptes;
}

function normaliser(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

const RANG_STATUT: Record<StatutCompte, number> = {
  admin: 0,
  'invitation-expiree': 1,
  invite: 2,
  expire: 3,
  suspendu: 4,
  desactive: 5,
  actif: 6,
};

export function filtrerComptes(profils: readonly Profil[], filtre: FiltreComptes, apps: readonly AppHub[], maintenant: number): Profil[] {
  const cherche = filtre.recherche ? normaliser(filtre.recherche) : '';
  const app = filtre.app ? apps.find(a => a.id === filtre.app) : undefined;
  const gardes = profils.filter(p => {
    if (cherche && !normaliser(p.nom).includes(cherche)) {
      return false;
    }
    if (filtre.statut && filtre.statut !== 'tous' && statutCompte(p, maintenant) !== filtre.statut) {
      return false;
    }
    if (filtre.app && (!app || niveauProfil(p, app) === 'aucun')) {
      return false;
    }
    return true;
  });
  const tri = filtre.tri ?? 'nom';
  const date = (v: string | undefined) => (v ? Date.parse(v) || 0 : 0);
  return gardes.sort((a, b) => {
    // L'administrateur reste en tête.
    if (a.admin !== b.admin) {
      return a.admin ? -1 : 1;
    }
    switch (tri) {
      case 'creation':
        return date(b.creeLe) - date(a.creeLe) || a.nom.localeCompare(b.nom, 'fr');
      case 'connexion':
        return date(b.derniereConnexion) - date(a.derniereConnexion) || a.nom.localeCompare(b.nom, 'fr');
      case 'statut':
        return RANG_STATUT[statutCompte(a, maintenant)] - RANG_STATUT[statutCompte(b, maintenant)] || a.nom.localeCompare(b.nom, 'fr');
      default:
        return a.nom.localeCompare(b.nom, 'fr');
    }
  });
}

// --- Tableau de bord -----------------------------------------------------------

export interface Statistiques {
  total: number;
  actifs: number;
  desactives: number;
  invites: number;
  /** Utilisateurs (admin compris) par app visible du registre. */
  parApp: Array<{ app: AppHub; utilisateurs: number; active: boolean; maintenance: boolean }>;
  derniereActivite?: { nom: string; date: string };
}

export function statistiques(profils: readonly Profil[], registre: readonly AppHub[], politique: PolitiqueHub | undefined, maintenant: number): Statistiques {
  const amis = profils.filter(p => !p.admin);
  const statuts = amis.map(p => statutCompte(p, maintenant));
  const recent = [...profils]
    .filter(p => p.derniereConnexion)
    .sort((a, b) => Date.parse(b.derniereConnexion!) - Date.parse(a.derniereConnexion!))[0];
  return {
    total: profils.length,
    actifs: statuts.filter(s => s === 'actif').length,
    desactives: statuts.filter(s => s === 'desactive' || s === 'suspendu' || s === 'expire').length,
    invites: statuts.filter(s => s === 'invite' || s === 'invitation-expiree').length,
    parApp: registre.map(app => {
      const etat = etatApp(politique, app.id);
      return {
        app,
        utilisateurs: profils.filter(p => compteOuvrable(p, maintenant) && niveauProfil(p, app) !== 'aucun').length,
        active: etat.active,
        maintenance: etat.maintenance !== undefined,
      };
    }),
    derniereActivite: recent ? { nom: recent.nom, date: recent.derniereConnexion! } : undefined,
  };
}

export type GenreAlerte = 'jamais-connecte' | 'inactif' | 'invitation-expiree' | 'invitation-proche' | 'acces-expire' | 'securite' | 'sequestre-absent';

export interface AlerteAdmin {
  genre: GenreAlerte;
  gravite: 'info' | 'alerte' | 'critique';
  message: string;
  cible?: string;
}

/** Alertes des comptes (la sécurité du coffre est ajoutée par `alertesSecurite`). */
export function alertesComptes(profils: readonly Profil[], maintenant: number, inactifJours: number): AlerteAdmin[] {
  const alertes: AlerteAdmin[] = [];
  for (const p of profils) {
    if (p.admin) {
      continue;
    }
    const statut = statutCompte(p, maintenant);
    if (p.sequestre === 'attendu' || p.sequestre === 'absent') {
      alertes.push({
        genre: 'sequestre-absent',
        gravite: 'info',
        cible: p.id,
        message: `${p.nom} : séquestre absent, à créer à la prochaine connexion de l’ami ou par régénération d’identifiants.`,
      });
    }
    if (statut === 'invitation-expiree') {
      alertes.push({ genre: 'invitation-expiree', gravite: 'alerte', cible: p.id, message: `Invitation de ${p.nom} expirée sans avoir été acceptée.` });
      continue;
    }
    if (statut === 'expire') {
      alertes.push({ genre: 'acces-expire', gravite: 'info', cible: p.id, message: `L’accès de ${p.nom} a expiré.` });
      continue;
    }
    if (statut === 'invite' && p.invitationExpireLe && Date.parse(p.invitationExpireLe) - maintenant < 2 * JOUR) {
      alertes.push({ genre: 'invitation-proche', gravite: 'info', cible: p.id, message: `L’invitation de ${p.nom} expire bientôt.` });
    }
    if (!p.derniereConnexion && !p.anterieur && statut !== 'invite') {
      alertes.push({ genre: 'jamais-connecte', gravite: 'alerte', cible: p.id, message: `Identifiants de ${p.nom} jamais utilisés : le compte n’a jamais été ouvert.` });
      continue;
    }
    if (p.derniereConnexion && statut === 'actif' && maintenant - Date.parse(p.derniereConnexion) > inactifJours * JOUR) {
      alertes.push({ genre: 'inactif', gravite: 'info', cible: p.id, message: `${p.nom} ne s’est pas connecté depuis plus de ${inactifJours} jours.` });
    }
  }
  return alertes;
}

/**
 * Connexions des amis survenues depuis la dernière visite de l'Administration :
 * le journal de l'administrateur est chiffré par sa clé, un ami ne peut pas y
 * écrire ; on reporte donc ses ouvertures (lues dans la liste des profils)
 * quand l'administrateur ouvre son panneau.
 */
export function nouvellesConnexions(profils: readonly Profil[], vues: Readonly<Record<string, number>>): Array<{ profil: Profil; nombre: number }> {
  return profils
    .filter(p => !p.admin && (p.connexions ?? 0) > (vues[p.id] ?? 0) && p.derniereConnexion)
    .map(p => ({ profil: p, nombre: (p.connexions ?? 0) - (vues[p.id] ?? 0) }));
}

// --- Récapitulatif -------------------------------------------------------------

/** Récapitulatif non sensible d'un compte (avant suppression) : aucun identifiant de connexion. */
export function recapitulatif(profil: Profil, registre: readonly AppHub[], maintenant: number): string {
  const lignes = [
    `Récapitulatif du compte « ${profil.nom} »`,
    `Édité le ${new Date(maintenant).toISOString()}`,
    '',
    `Créé le : ${profil.creeLe || 'inconnu'}`,
    `Statut : ${LIBELLES_STATUT[statutCompte(profil, maintenant)]}`,
    `Dernière connexion sur cet appareil : ${profil.derniereConnexion ?? 'jamais'}`,
    `Nombre d’ouvertures : ${profil.connexions ?? 0}`,
    'Accès :',
    ...registre
      .filter(app => !app.adminSeulement)
      .map(app => {
        const niveau = niveauProfil(profil, app);
        return `  - ${app.nom} : ${niveau === 'aucun' ? 'aucun accès' : niveau === 'lecture' ? 'lecture seule' : 'accès complet'}`;
      }),
    '',
    'Ce document ne contient ni mot de passe, ni clé d’authentification, ni code de récupération.',
  ];
  return lignes.join('\n');
}
