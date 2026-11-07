/**
 * Fonctionnalités du bot Esport HQ affichées dans Administration › Bot Esport HQ › Fonctionnalités : un REGISTRE simple
 * (un tableau). Une fonctionnalité du bot (tickets, annonces, salons vocaux temporaires…) y ajoute son entrée :
 *  - `titre` / `description` : textes (traduits) de sa carte ;
 *  - `icone` : pictogramme MONOCHROME de l'app (src/ui/icones), jamais d'emoji ;
 *  - `Reglages` (facultatif) : son écran de réglages, affiché DANS l'onglet sous sa carte ;
 *  - `ouvrir` (facultatif) : un bouton qui mène à sa page (la page reste la seule source de ses réglages) ;
 *  - `bientot` : fonctionnalité annoncée, pas encore disponible (carte grisée, sans bouton).
 * Les permissions Discord d'une fonctionnalité se déclarent côté serveur, dans la liste centrale
 * esport/noyau/discord/permissions-bot.mjs (le lien d'invitation les demande toutes).
 */

import type React from 'react';
import type { ThemeHub } from '../../../hub/themes';
import type { NomIcone } from '../../../ui/icones';
import type { ClientEsport } from '../../client';
import { trBot } from '../../i18n/bot';
import type { EtatBotAdmin } from '../../bot/api';
import { ReglagesVocaux } from '../vocaux/ConfigVocaux';

/** Ce que l'onglet donne à une fonctionnalité (navigation vers les pages qui gardent les réglages). */
export interface ContexteBot {
  theme: ThemeHub;
  client: ClientEsport;
  large: boolean;
  etat: EtatBotAdmin;
  /** Tickets › Configuration, à une section (« general », « commandes »…). */
  ouvrirTickets?(section?: string): void;
  /** Page d'une team, à une section (« module:discord »…). */
  ouvrirTeam?(teamId: string, section?: string): void;
  /** Autre section de l'onglet Bot Esport HQ. */
  ouvrirSection(section: string): void;
}

export interface FonctionnaliteBot {
  id: string;
  titre(): string;
  description(): string;
  icone: NomIcone;
  /** État court (« Activée »…), facultatif. */
  etat?(ctx: ContexteBot): { texte: string; ton: 'ok' | 'neutre' | 'alerte' } | null;
  Reglages?: React.ComponentType<ContexteBot>;
  ouvrir?: { libelle(): string; action(ctx: ContexteBot): void; disponible?(ctx: ContexteBot): boolean };
  bientot?: boolean;
}

export const FONCTIONNALITES_BOT: FonctionnaliteBot[] = [
  {
    id: 'annonces',
    titre: () => trBot('fn.annonces'),
    description: () => trBot('fn.annonces_description'),
    icone: 'megaphone',
    ouvrir: { libelle: () => trBot('fn.annonces_ouvrir'), action: ctx => ctx.ouvrirSection('annonces') },
  },
  {
    id: 'tickets',
    titre: () => trBot('fn.tickets'),
    description: () => trBot('fn.tickets_description'),
    icone: 'billets',
    etat: ctx => (ctx.etat.tickets.actif ? { texte: trBot('fn.actif'), ton: 'ok' } : { texte: trBot('fn.inactif'), ton: 'neutre' }),
    ouvrir: { libelle: () => trBot('fn.tickets_ouvrir'), action: ctx => ctx.ouvrirTickets?.('connexion'), disponible: ctx => Boolean(ctx.ouvrirTickets) },
  },
  // Salons vocaux temporaires (docs/esport/vocaux.md) : leurs réglages s'affichent sous la carte (vocaux.configurer).
  {
    id: 'vocaux',
    titre: () => trBot('fn.vocaux'),
    description: () => trBot('fn.vocaux_description'),
    icone: 'micro',
    etat: ctx => (ctx.etat.vocaux?.actif ? { texte: trBot('fn.actif'), ton: 'ok' } : { texte: trBot('fn.inactif'), ton: 'neutre' }),
    Reglages: ReglagesVocaux,
  },
];

/** Fonctionnalités dans l'ordre d'affichage (copie : le registre ne se modifie qu'à son import). */
export const fonctionnalitesBot = (): readonly FonctionnaliteBot[] => [...FONCTIONNALITES_BOT];
