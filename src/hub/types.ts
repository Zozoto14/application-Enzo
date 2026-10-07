/**
 * Contrat d'une app du hub. Ajouter une app = ajouter une entrée au registre
 * (`registre.tsx`) qui respecte ce contrat ; ni le hub ni l'administration
 * n'ont à changer.
 */

import type React from 'react';
import type { ControleProfils } from '../ui/ecrans/CarteProfils';
import type { Profil, RoleProfil } from '../profils/profils';
import type { IdThemeHub, TeinteApp, ThemeHub } from './themes';
import type { NiveauAcces, NiveauDeclare } from './admin/niveaux';
import type { StockagePrefs } from './personnalisation';
import type { IdSection } from './recensement';
import type { ResumeTsuzuku } from '../tsuzuku/app/resume';
import type { BasePrefs } from '../tsuzuku/plateforme/stockage';
import type { ServiceHistoriqueRelais } from '../claudeOffice/synchroHistorique';

export type Tendance = 'hausse' | 'baisse' | 'neutre';

/** Ce qu'une tuile affiche en direct, calculé côté client. */
export interface InfoLive {
  /** Phrase courte sous le nom de l'app. */
  sousTitre?: string;
  indicateurs: ReadonlyArray<{ libelle: string; valeur: string; tendance?: Tendance }>;
}

/** Portefeuille déchiffré, résumé pour le hub. */
export interface ResumePortefeuille {
  /** Valeur totale, déjà mise en forme (et masquée en mode discret). */
  valeur: string;
  /** Variation de la dernière séance, si l'historique la permet. */
  variation?: { pourcentage: string; montant: string; tendance: Tendance; date: string };
  sansCompte: boolean;
}

/** Ce que le hub sait au moment d'afficher les tuiles. */
export interface ContexteHub {
  /** Profil ouvert ; absent sur un appareil sans profils (un seul utilisateur, administrateur). */
  profil?: Profil;
  profils?: ControleProfils;
  portefeuille?: ResumePortefeuille;
  /** Base chiffrée du profil ouvert (clé/valeur) : c'est là que les apps rangent leurs données. */
  baseProfil?: BasePrefs;
  /** Résumé de la bibliothèque Tsuzuku du profil, pour l'information en direct de sa tuile. */
  tsuzuku?: ResumeTsuzuku;
  /** Propose d'enregistrer un fichier (export) ; faux si l'utilisateur annule. */
  enregistrerFichier?(nom: string, contenu: string, type: string): Promise<boolean>;
  /** Services de l'administration ; présents seulement pour l'administrateur. */
  admin?: ServicesAdmin;
  /**
   * Copie chiffrée de l'historique de Claude Office sur le relais ; présente
   * seulement pour le compte principal relié au relais (jeton maître).
   */
  historiqueOffice?: ServiceHistoriqueRelais;
  /** Horloge injectable (tests) ; `Date.now` à défaut. */
  maintenant?: number;
}

/** État du coffre de l'administrateur, lisible sans rien déchiffrer. */
export interface EtatCoffre {
  totpActif: boolean;
  codesRecuperation: number;
}

/**
 * Ce que l'hôte donne à l'Administration. Rien ici ne rend un secret : on
 * peut vérifier l'identité de l'administrateur, pas relire son mot de passe.
 */
export interface ServicesAdmin {
  /** Clé/valeur de la base chiffrée de l'administrateur. */
  stockage: StockagePrefs;
  /**
   * Revérifie mot de passe + code TOTP, comme au déverrouillage (mêmes
   * temporisations après échecs). Lève en cas d'échec ; ne change rien sinon.
   */
  verifierIdentite(motDePasse: string, codeTotp: string): void;
  etatCoffre(): EtatCoffre | undefined;
  /** Propose d'enregistrer un fichier (export) ; faux si l'utilisateur annule. */
  enregistrerFichier?(nom: string, contenu: string, type: string): Promise<boolean>;
}

/**
 * Page du hub où l'app a sa tuile : « publique » (page « Applications », visible
 * selon les autorisations habituelles) ou « administration » (page
 * « Administration », qui n'apparaît qu'aux rangs habilités : elle n'existe
 * que si au moins une de ses apps est visible). Voir `pages.ts`.
 */
export type CategorieApp = 'publique' | 'administration';

export interface PropsRacineApp {
  contexte: ContexteHub;
  theme: ThemeHub;
  registre: readonly AppHub[];
  onRetour(): void;
  /** Niveau d'accès du profil à cette app (« complet » pour l'administrateur). */
  niveau?: NiveauAcces;
  /** Change le thème du hub (Réglages de l'Administration). */
  onTheme?(id: IdThemeHub): void;
  /** Ouvre la page Paramètres (unique) ; l'app n'a pas de réglages à elle. */
  onParametres?(section?: IdSection): void;
  /** Ouvre une autre app du hub (si le profil y a accès), par son identifiant. */
  onOuvrirApp?(id: string): void;
}

export interface AppHub {
  /** Identifiant stable : c'est lui qui est enregistré dans les autorisations. */
  id: string;
  nom: string;
  /** Étiquette de la tuile (« Finance », « Admin »). */
  categorie: string;
  /**
   * Page du hub où vit la tuile (voir `CategorieApp`). Absente : « publique ».
   * Une app réservée à l'administration déclare « administration ».
   */
  page?: CategorieApp;
  description: string;
  /** Pictogramme simple : aucune police d'icônes à embarquer. */
  icone: string;
  /** Emplacement de couleur, décliné par chaque thème du hub. */
  teinte: TeinteApp;
  /** Réservée à l'administrateur : jamais proposée dans les autorisations d'un ami. */
  adminSeulement?: boolean;
  /**
   * Avec `adminSeulement` : l'app s'ouvre aussi aux gestionnaires (rôle
   * limité, voir `admin/roles.ts`) ; elle s'adapte alors à leurs droits.
   */
  gestionnaire?: boolean;
  /**
   * Avec `adminSeulement` : rangs (hors compte historique, qui voit tout) qui
   * ouvrent l'app. Prioritaire sur `gestionnaire`. Ex. `['fondateur']`.
   */
  rangs?: readonly RoleProfil[];
  /**
   * Niveaux que l'app sait faire respecter, en plus de « aucun accès ».
   * Absent : un seul, l'accès complet. Ne déclarez « lecture » que si l'app
   * retire réellement la modification à ce niveau.
   */
  niveaux?: readonly NiveauDeclare[];
  /** Ce que change chaque niveau, affiché dans l'Administration. */
  descriptionNiveaux?: Partial<Record<NiveauDeclare, string>>;
  /** Faux quand la plateforme ne peut pas la faire tourner (ex. pas de profils). */
  disponible?(contexte: ContexteHub): boolean;
  /** Information en direct de la tuile. */
  info?(contexte: ContexteHub): InfoLive | undefined;
  /**
   * Écran racine de l'app. Absent pour le portefeuille : c'est l'application
   * historique, dont l'arbre est déjà monté par `App` (déverrouillage,
   * synchronisation, etc.) et qu'on se contente d'afficher.
   */
  Racine?: React.ComponentType<PropsRacineApp>;
}
