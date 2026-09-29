/**
 * Contrats du hub. Le hub ne connaît aucune app en particulier : chaque app
 * s'enregistre dans le registre (`creerRegistre`) avec une définition qui
 * respecte `AppHub`, et l'application hôte fournit le reste — profils,
 * données en direct des tuiles, stockage — par les interfaces ci-dessous.
 *
 * Ajouter une app = ajouter une définition au registre de l'hôte ; ni le hub
 * ni l'administration n'ont à changer.
 */

import type React from 'react';
import type { TeinteApp, ThemeHub } from './themes';

export type Tendance = 'hausse' | 'baisse' | 'neutre';

/** Ce qu'une tuile affiche en direct, calculé côté client. */
export interface InfoLive {
  /** Phrase courte sous le nom de l'app. */
  sousTitre?: string;
  indicateurs: ReadonlyArray<{ libelle: string; valeur: string; tendance?: Tendance }>;
}

/**
 * Ce que le hub sait d'un profil. Le type de profil de l'hôte doit au moins
 * porter ces champs (compatibilité structurelle, aucun import nécessaire).
 */
export interface ProfilHub {
  id: string;
  nom: string;
  admin: boolean;
  creeLe?: string;
  /** Apps ouvertes à ce profil (identifiants du registre). Sans objet pour l'administrateur. */
  apps?: string[];
  /** Faux : désactivé par l'administrateur, le profil ne s'ouvre plus. */
  actif?: boolean;
}

/** Identifiants d'un ami, générés par l'administrateur et montrés une seule fois. */
export interface IdentifiantsAmi {
  motDePasse: string;
  codesRecuperation: string[];
  secretTotp: string;
  uriTotp: string;
}

/**
 * Primitives de profils fournies par l'hôte. Les actions d'administration
 * sont absentes là où la plateforme ne sait pas créer le coffre d'un autre
 * profil : l'Administration est alors indisponible.
 */
export interface ControleProfilsHub {
  actuel: ProfilHub;
  tous: readonly ProfilHub[];
  onSupprimer(id: string): Promise<void>;
  /** Crée le compte d'un ami et rend ses identifiants, à montrer une fois. */
  onCreerCompte?(nom: string, apps: readonly string[]): Promise<IdentifiantsAmi>;
  /** Nouveau coffre pour l'ami : l'ancien, et les données qu'il scelle, sont effacés. */
  onRegenerer?(id: string): Promise<IdentifiantsAmi>;
  onAutoriser?(id: string, apps: readonly string[]): Promise<void>;
  onActiver?(id: string, actif: boolean): Promise<void>;
}

/** Ce que le hub sait au moment d'afficher les tuiles. */
export interface ContexteHub {
  /** Profil ouvert ; absent sur un appareil sans profils (un seul utilisateur, administrateur). */
  profil?: ProfilHub;
  profils?: ControleProfilsHub;
  /**
   * Données en direct publiées par les apps de l'hôte, par identifiant
   * d'app : chaque app lit les siennes dans `info` (ex. la valeur du
   * portefeuille). Le hub ne les interprète jamais.
   */
  donnees?: Readonly<Record<string, unknown>>;
}

export interface PropsRacineApp {
  contexte: ContexteHub;
  theme: ThemeHub;
  registre: readonly AppHub[];
  onRetour(): void;
}

export interface AppHub {
  /** Identifiant stable : c'est lui qui est enregistré dans les autorisations. */
  id: string;
  nom: string;
  /** Étiquette de la tuile (« Finance », « Admin »). */
  categorie: string;
  description: string;
  /** Pictogramme simple : aucune police d'icônes à embarquer. */
  icone: string;
  /** Emplacement de couleur, décliné par chaque thème du hub. */
  teinte: TeinteApp;
  /** Réservée à l'administrateur : jamais proposée dans les autorisations d'un ami. */
  adminSeulement?: boolean;
  /** Faux quand la plateforme ne peut pas la faire tourner (ex. pas de profils). */
  disponible?(contexte: ContexteHub): boolean;
  /** Information en direct de la tuile. */
  info?(contexte: ContexteHub): InfoLive | undefined;
  /**
   * Écran racine de l'app. Absent pour une app que l'hôte monte lui-même
   * (ex. le portefeuille, dont l'arbre est déjà celui de l'application) :
   * l'hôte se contente alors de l'afficher quand elle est ouverte.
   */
  Racine?: React.ComponentType<PropsRacineApp>;
}

/** Composant de QR code fourni par l'hôte (le hub n'embarque pas de générateur). */
export type ComposantQrCode = React.ComponentType<{ texte: string; legende: string; testID: string }>;
