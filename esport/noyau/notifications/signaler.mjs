/**
 * Signalement d'une alerte technique (docs/esport/notifications.md « Alertes et avis ») : le module qui détecte une
 * erreur (salons de match, salons vocaux, rôles d'un événement, rôles temporaires) appelle `signalerAlerte` ; la ligne
 * du bus (événement `alerte.*`) est écrite, puis l'abonné `abonneAlertes` (alertes.mjs) prévient les bonnes personnes,
 * au plus une fois par fenêtre de 6 h et par destinataire (compteur).
 *
 * Au mieux : un échec d'écriture ne doit jamais empêcher le travail qui signale (synchronisation, expiration…).
 * Les passages périodiques (une minute) répètent souvent la même erreur : au plus un événement par clé et par quart
 * d'heure et par processus (le reste est compté par le dédoublonnage de l'abonné).
 */

import { evenement } from '../evenements.mjs';

const TYPES = Object.freeze({ salon_match: 'alerte.salon_match', vocal: 'alerte.vocal', role_evenement: 'alerte.role_evenement', role_temp: 'alerte.role_temp' });
export const PAUSE_SIGNALEMENT_MS = 15 * 60_000;
/** Dernier signalement par base et par clé (mémoire du processus). */
const vus = new WeakMap();

/**
 * `genre` : salon_match | vocal | role_evenement | role_temp. `cle` : la cible et le code (« salon:<événement>:<match>:<code> »),
 * qui dédoublonne. `charge` : `code` (cause : `sans-role`, `hierarchie`, `categorie-pleine`…) et identifiants (`evenement`,
 * `match`, `zone`…). Jamais de texte libre ni de jeton.
 */
export async function signalerAlerte(base, genre, { cle, charge = {}, teamId = null, maintenant = Date.now() }) {
  try {
    const type = TYPES[genre];
    if (!type || !cle) return false;
    const t = typeof maintenant === 'function' ? maintenant() : maintenant;
    let table = vus.get(base);
    if (!table) vus.set(base, (table = new Map()));
    const dernier = table.get(cle);
    if (dernier !== undefined && t - dernier >= 0 && t - dernier < PAUSE_SIGNALEMENT_MS) return false;
    table.set(cle, t);
    const i = evenement(type, { teamId, entiteType: 'alerte', entiteId: String(cle).slice(0, 200), charge: { ...charge, cle: String(cle).slice(0, 200) }, maintenant: t });
    await base.executer(i.sql, i.params);
    return true;
  } catch (e) {
    console.error('[esport] alerte non signalée', e?.message ?? e);
    return false;
  }
}

/** Code lisible d'un refus Discord : hiérarchie / permission (50013, 403), Discord injoignable, ou `discord-<statut>`. */
export function codeRefusDiscord(r) {
  if (!r) return 'discord';
  if (r.code === 50013 || r.statut === 403) return 'hierarchie';
  if (r.statut === 0) return 'injoignable';
  return `discord-${r.statut ?? 0}`;
}
