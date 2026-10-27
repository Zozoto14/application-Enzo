/**
 * Messages Discord bilingues : le message part en ANGLAIS dans le salon, puis un
 * fil (thread) est ouvert sur lui avec la version FRANÇAISE (réglage par team,
 * activé par défaut : table `discord_bilingue`, migration 0020).
 *
 * Fonctions pures (noms de fil, nonce, motifs) et petites lectures en base
 * (Discord ID du Fondateur, anti-spam des alertes). L'envoi lui-même est une
 * tâche de la file (file.mjs, `traiterFile`) en trois étapes reprenables :
 *  1. message anglais (webhook avec ?wait=true, ou bot) → `message_id` retenu ;
 *  2. fil créé sur ce message par le BOT (POST /channels/{salon}/messages/{id}/threads) → `fil_id` ;
 *     salon forum (webhook) : le message anglais ouvre directement un post (`thread_name`) ;
 *  3. version française postée dans le fil (webhook ?thread_id=, ou bot).
 * Fil impossible (bot absent ou permission manquante) : PAS de second message
 * français ; une alerte dans le salon mentionne le Fondateur, au plus une fois
 * par salon et par 24 h.
 */

import { sha256Hex } from '../outils.mjs';
import { texte as T } from '../langues.mjs';
import { embedMessage } from './embeds.mjs';
import { construireCharge, nettoyerVariable } from './messages.mjs';

/** Une alerte « fil impossible » par salon et par période. */
export const PERIODE_ALERTE_FIL_MS = 24 * 3_600_000;
/** Durée d'archivage automatique des fils créés (minutes : 1 jour). */
export const ARCHIVAGE_FIL_MIN = 1440;
const MAX_NOM_FIL = 100;

/** Motifs d'un fil impossible : texte du journal / de l'écran (français, traduit par erreurs.json). */
export const MOTIFS_FIL = Object.freeze({
  bot_absent: 'Fil français impossible : bot Discord non configuré sur le serveur (DISCORD_BOT_TOKEN)',
  acces: 'Fil français impossible : le bot n’a pas accès à ce salon (Voir le salon)',
  creer_fil: 'Fil français impossible : permission « Créer des fils publics » manquante',
  ecrire_fil: 'Fil français impossible : permission « Envoyer des messages dans les fils » manquante',
});
export const texteMotifFil = (motif, statut) => MOTIFS_FIL[motif] ?? `Fil français impossible (HTTP ${statut ?? 0})`;

/** Nom d'un fil ou d'un post (1 à 100 caractères, une ligne). */
function borner(nom) {
  const n = nettoyerVariable(nom).replace(/\s+/g, ' ').trim();
  return (n.length > MAX_NOM_FIL ? `${n.slice(0, MAX_NOM_FIL - 1)}…` : n) || '🇫🇷 Version française';
}

/** Nom du fil français : « 🇫🇷 Version française · <titre de l'embed français> ». */
export function nomFil(chargeFr) {
  const titre = chargeFr?.embeds?.[0]?.title ?? '';
  return borner(titre ? T('fr', 'fil.nom', { titre }) : '🇫🇷 Version française');
}

/** Titre du post de forum (message anglais) : le titre de son embed. */
export const nomPost = charge => borner(charge?.embeds?.[0]?.title || 'Esport');

/** Adresse de webhook avec paramètres (`wait`, `thread_id`). */
export function avecParams(url, params) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

/**
 * Nonce d'un envoi du bot (≤ 25 caractères) : avec `enforce_nonce`, Discord ne crée pas deux fois le
 * même message si la même étape est rejouée dans les minutes qui suivent (réessai après une coupure).
 */
export async function nonceEnvoi(idLigne, etape) {
  return { nonce: (await sha256Hex(`esport-discord:${idLigne}:${etape}`)).slice(0, 25), enforce_nonce: true };
}

/**
 * Motif d'un refus de Discord pendant l'étape `creer` (fil) ou `ecrire` (version française) :
 * 50001 / 404 → accès au salon ; 50013 / 403 → permission de fil manquante ; autre → `autre`.
 */
export function motifRefusFil(r, etape) {
  if (r.code === 50001 || r.code === 10003 || r.statut === 404) return 'acces';
  if (r.code === 50013 || r.statut === 403) return etape === 'creer' ? 'creer_fil' : 'ecrire_fil';
  return 'autre';
}

/** Identifiant Discord du Fondateur (compte « principal ») : liaison /lier d'abord, sinon le Discord ID saisi. */
export async function discordFondateur(base) {
  const valide = v => (typeof v === 'string' && /^\d{5,25}$/.test(v) ? v : null);
  const lie = await base.premier("SELECT discord_user_id FROM discord_comptes WHERE compte_id = 'principal'", []);
  if (valide(lie?.discord_user_id)) return lie.discord_user_id;
  const fiche = await base.premier("SELECT discord_id FROM comptes WHERE id = 'principal'", []);
  if (valide(fiche?.discord_id)) return fiche.discord_id;
  // Liaison faite depuis une session du Fondateur (drapeau super_admin) sur un autre compte.
  const admin = await base.premier('SELECT discord_user_id FROM discord_comptes WHERE super_admin = 1 ORDER BY lie_le LIMIT 1', []);
  return valide(admin?.discord_user_id);
}

/**
 * Alerte « le bot ne peut pas créer le fil français » (anglais court puis français) : mentionne le
 * Fondateur (`fondateurId`) et lui seul ; sans identifiant, le texte « Fondateur » sans ping.
 */
export function chargeAlerteFil({ motif, statut, fondateurId, team = {}, maintenant = Date.now() }) {
  const permission = l => T(l, `fil.permission.${motif in MOTIFS_FIL ? motif : 'autre'}`, { statut: statut ?? 0 });
  const texte = `${T('en', 'fil.alerte.texte', { permission: permission('en') })}\n\n🇫🇷 ${T('fr', 'fil.alerte.texte', { permission: permission('fr') })}`;
  const embed = embedMessage({ cle: 'alerte_fil', titre: `${T('en', 'fil.alerte.titre')} · ${T('fr', 'fil.alerte.titre')}`, texte, team, maintenant });
  const charge = construireCharge(texte, { nomTeam: team.nom ?? '', embed, utilisateurs: fondateurId ? [fondateurId] : [], maintenant, langue: 'en' });
  if (!fondateurId) charge.content = T('fr', 'fil.fondateur');
  return charge;
}

/** Une alerte peut-elle partir dans ce salon (anti-spam : une par période) ? */
export async function alerteFilPermise(base, salonId, maintenant) {
  const l = await base.premier('SELECT alerte_le FROM discord_alertes_fil WHERE salon_id = ?', [salonId]);
  return !l || maintenant - Date.parse(l.alerte_le) >= PERIODE_ALERTE_FIL_MS;
}
