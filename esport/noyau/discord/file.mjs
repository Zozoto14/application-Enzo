/**
 * Notifications Discord : abonné du bus (événement de domaine → file d'envoi)
 * et traitement de la file (envoi, réessais, limite de débit, abandon).
 *
 *  - `abonneDiscord(base, ev)` : abonné du bus d'événements (evenements.mjs),
 *    comme le journal et les notifications in-app ; les autres modules ne
 *    l'appellent jamais. Il ne fait AUCUN appel réseau : il ajoute une ligne
 *    à la file `discord_file` (idempotent : un événement traité deux fois ne
 *    met qu'un message en file).
 *  - `traiterFile(base, options)` : envoie les messages dus. Appelée juste
 *    après la requête (envoi rapide) et par le cron (réessais).
 *
 * Réessais : après un échec réseau ou une erreur 5xx de Discord, nouvel essai
 * dans 1 min, 5 min, 15 min, 1 h puis 3 h ; abandon après `ESSAIS_MAX`
 * essais. Limite de débit (HTTP 429) : on attend `retry_after` (en-tête ou
 * corps), pour ce message ET pour tous ceux de la team, sans compter d'essai.
 * Un refus définitif (webhook supprimé, requête refusée) abandonne tout de
 * suite. Chaque échec et chaque abandon est consigné dans le journal
 * d'activité de la team (jamais l'adresse du webhook ni la réponse de Discord).
 */

import { iso, jsonOu, nouvelId } from '../outils.mjs';
import { dechiffrerWebhook } from './chiffrement.mjs';
import { clesPourType, evenementDiscord, libelleTypeEvenement } from './catalogue.mjs';
import { construireCharge, rendreModele } from './messages.mjs';

export const ESSAIS_MAX = 6;
/** Attente (secondes) après le n-ième échec (n = 1…). */
export const ATTENTES_ECHEC_S = [60, 300, 900, 3600, 10_800];
const VALIDITE_MESSAGE_MS = 24 * 3_600_000;
const BAIL_MS = 120_000;
const DELAI_ENVOI_MS = 8000;
const CONSERVATION_MS = 30 * 86_400_000;

// ------------------------------------------------------------------ Variables d'un message

const dateJour = texte => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(texte ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(texte ?? '');
};

/** Date longue et heure d'un instant dans le fuseau de la team. */
export function formaterInstant(fuseau, instantIso) {
  const d = new Date(instantIso);
  if (Number.isNaN(d.getTime())) return { date: '', heure: '' };
  try {
    return {
      date: new Intl.DateTimeFormat('fr-FR', { timeZone: fuseau, weekday: 'long', day: 'numeric', month: 'long' }).format(d),
      heure: new Intl.DateTimeFormat('fr-FR', { timeZone: fuseau, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d),
    };
  } catch {
    return { date: d.toISOString().slice(0, 10), heure: d.toISOString().slice(11, 16) };
  }
}

/** « dans 45 min », « dans 5 h », « dans 2 jours ». */
export function formaterDelai(ms) {
  if (ms <= 60_000) return 'maintenant';
  if (ms < 90 * 60_000) return `dans ${Math.round(ms / 60_000)} min`;
  if (ms < 48 * 3_600_000) return `dans ${Math.round(ms / 3_600_000)} h`;
  return `dans ${Math.round(ms / 86_400_000)} jours`;
}

async function pseudoDe(base, compte) {
  if (typeof compte !== 'string' || !compte) return '';
  const l = await base.premier('SELECT pseudo FROM comptes WHERE id = ?', [compte]);
  return l?.pseudo ?? (compte === 'principal' ? 'Le Fondateur' : 'Un membre');
}

/** Variables du message pour un événement de domaine ; `null` : rien à envoyer. */
async function variablesDe(base, ev, cle, charge, team) {
  const t = Date.parse(ev.cree_le);
  const base_ = { team: team.nom };
  const quand = charge.debut ? formaterInstant(team.fuseau, charge.debut) : { date: '', heure: '' };
  const instant = { titre: charge.titre ?? '', type: libelleTypeEvenement(charge.type), ...quand };
  switch (cle) {
    case 'event_created':
      return { ...base_, ...instant, acteur: await pseudoDe(base, ev.acteur_id) };
    case 'reminder_d1':
    case 'reminder_h1':
      return { ...base_, ...instant, delai: formaterDelai(Date.parse(charge.debut) - t) };
    case 'rsvp_missing':
      return { ...base_, ...instant, membre: await pseudoDe(base, charge.compte) };
    case 'summary_published': {
      // Les réunions de type « staff » ne sortent jamais du staff : rien n'est publié sur Discord.
      const r = await base.premier(
        'SELECT y.visibilite FROM reunions r JOIN types_reunion y ON y.id = r.type_id WHERE r.id = ? AND r.team_id = ?',
        [ev.entite_id, ev.team_id],
      );
      if (!r || r.visibilite === 'staff') return null;
      return { ...base_, titre: charge.titre ?? '', acteur: await pseudoDe(base, ev.acteur_id), membre: await pseudoDe(base, charge.deposePar) };
    }
    case 'summary_submitted':
      return { ...base_, titre: charge.titre ?? '', type: charge.type ?? '', date: dateJour(charge.dateReunion), membre: await pseudoDe(base, ev.acteur_id) };
    case 'task_assigned':
      return {
        ...base_,
        titre: charge.titre ?? '',
        assigne: await pseudoDe(base, charge.assigne),
        echeance: charge.echeance ? `, pour le ${dateJour(charge.echeance)}` : '',
        acteur: await pseudoDe(base, ev.acteur_id),
      };
    case 'task_due':
      return {
        ...base_,
        titre: charge.titre ?? '',
        assigne: await pseudoDe(base, charge.assigne),
        echeance: dateJour(charge.echeance),
        etat: charge.retard ? 'en retard' : 'échéance proche',
      };
    case 'member_joined':
      return { ...base_, membre: await pseudoDe(base, ev.acteur_id), role: charge.role ?? '' };
    case 'role_changed':
      return { ...base_, membre: await pseudoDe(base, charge.compte), de: charge.de ?? '', vers: charge.vers ?? '', acteur: await pseudoDe(base, ev.acteur_id) };
    case 'review_created':
      return { ...base_, titre: charge.titre ?? '', acteur: await pseudoDe(base, ev.acteur_id) };
    case 'strat_created':
      return { ...base_, titre: charge.titre ?? '', carte: charge.carte ?? '', side: charge.side === 'defense' ? 'Défense' : 'Attaque', acteur: await pseudoDe(base, ev.acteur_id) };
    case 'playbook_validated':
      return { ...base_, titre: charge.titre ?? '', surCarte: charge.carte ? ` sur ${charge.carte}` : '', acteur: await pseudoDe(base, ev.acteur_id) };
    default:
      return null;
  }
}

// ------------------------------------------------------------------ Abonné du bus

/** Modules actifs d'une team. */
export async function modulesActifs(base, teamId) {
  const l = await base.tous('SELECT module FROM team_modules WHERE team_id = ? AND active = 1', [teamId]);
  return new Set(l.map(x => x.module));
}

/** Réglage effectif d'un type de message : ligne de la team, sinon valeurs par défaut du catalogue. */
export function reglageEffectif(def, ligne) {
  return {
    actif: ligne ? Number(ligne.actif) === 1 : def.defaut,
    modele: ligne?.modele || def.modele,
    personnalise: Boolean(ligne?.modele),
    roleMention: ligne?.role_mention ?? null,
  };
}

/** Abonné du bus : met en file les messages Discord que l'événement déclenche. */
export async function abonneDiscord(base, ev) {
  if (ev.type === 'team.deleted' && ev.team_id) {
    // Team supprimée : l'adresse du webhook (secret) et la file disparaissent avec elle.
    await base.executer('DELETE FROM discord_file WHERE team_id = ?', [ev.team_id]);
    await base.executer('DELETE FROM discord_webhooks WHERE team_id = ?', [ev.team_id]);
    return;
  }
  const cles = clesPourType(ev.type);
  if (cles.length === 0 || !ev.team_id) return;
  if (!(await base.premier('SELECT team_id FROM discord_webhooks WHERE team_id = ?', [ev.team_id]))) return;
  const team = await base.premier('SELECT nom, fuseau FROM teams WHERE id = ? AND supprimee_le IS NULL AND archivee_le IS NULL', [ev.team_id]);
  if (!team) return;
  const actifs = await modulesActifs(base, ev.team_id);
  if (!actifs.has('discord')) return;
  const charge = jsonOu(ev.charge, {});
  for (const cle of cles) {
    const def = evenementDiscord(cle);
    if (!def.modules.every(m => actifs.has(m))) continue;
    const reglage = reglageEffectif(def, await base.premier('SELECT * FROM discord_notification_settings WHERE team_id = ? AND cle = ?', [ev.team_id, cle]));
    if (!reglage.actif) continue;
    const variables = await variablesDe(base, ev, cle, charge, team);
    if (!variables) continue;
    const creeMs = Date.parse(ev.cree_le);
    // Un rappel n'a plus de sens une fois l'événement commencé ; les autres messages valent 24 h.
    const debut = Date.parse(charge.debut);
    const expire = cle.startsWith('reminder_') && Number.isFinite(debut) ? debut : creeMs + VALIDITE_MESSAGE_MS;
    await base.executer(
      `INSERT INTO discord_file (id, team_id, evenement_id, cle, modele, variables, role_mention, statut, essais, prochain_essai_le, expire_le, cree_le, maj_le)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'attente', 0, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      [`${ev.id}:${cle}`, ev.team_id, ev.id, cle, reglage.modele, JSON.stringify(variables), reglage.roleMention, ev.cree_le, iso(expire), ev.cree_le, ev.cree_le],
    );
  }
}

// ------------------------------------------------------------------ Envoi

/**
 * POST sur le webhook. Rend `{ ok }`, ou `{ ok: false, statut, retryApresS?, definitif, motif }`.
 * Ne lit jamais la réponse de Discord au-delà de `retry_after` (elle peut citer le webhook), ne suit
 * aucune redirection.
 */
export async function posterWebhook(fetchDiscord, url, charge) {
  let r;
  try {
    r = await fetchDiscord(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(charge),
      redirect: 'manual',
      signal: AbortSignal.timeout(DELAI_ENVOI_MS),
    });
  } catch {
    return { ok: false, statut: 0, definitif: false, motif: 'Discord injoignable' };
  }
  if (r.status >= 200 && r.status < 300) return { ok: true, statut: r.status };
  if (r.status === 429) {
    let corps = {};
    try {
      corps = await r.json();
    } catch {
      corps = {};
    }
    const entete = Number(r.headers?.get?.('Retry-After'));
    const duCorps = Number(corps?.retry_after);
    const s = Math.max(Number.isFinite(entete) ? entete : 0, Number.isFinite(duCorps) ? duCorps : 0, 1);
    return { ok: false, statut: 429, retryApresS: Math.min(Math.ceil(s), 3600), definitif: false, motif: 'Limite de débit de Discord' };
  }
  if (r.status >= 300 && r.status < 400) return { ok: false, statut: r.status, definitif: true, motif: 'Redirection refusée' };
  if ([401, 403, 404].includes(r.status)) return { ok: false, statut: r.status, definitif: true, webhookPerdu: true, motif: `Webhook refusé ou supprimé (HTTP ${r.status})` };
  if (r.status >= 400 && r.status < 500) return { ok: false, statut: r.status, definitif: true, motif: `Message refusé par Discord (HTTP ${r.status})` };
  return { ok: false, statut: r.status, definitif: false, motif: `Erreur de Discord (HTTP ${r.status})` };
}

async function consigner(base, ligne, action, meta, t) {
  await base.executer(
    "INSERT INTO journal (id, team_id, acteur_id, action, entite_type, entite_id, meta, cree_le) VALUES (?, ?, NULL, ?, 'discord', ?, ?, ?)",
    [nouvelId(), ligne.team_id, action, ligne.id, JSON.stringify({ cle: ligne.cle, ...meta }), iso(t)],
  );
}

/**
 * Envoie les messages dus. Options : `cle` (secret de chiffrement), `fetch`,
 * `maintenant` (ms), `limite`, `lienApp` (adresse de l'app pour {lien}).
 * Rend `{ envoyes, abandonnes, reportes }`.
 */
export async function traiterFile(base, { cle, fetch: fetchDiscord = (...a) => globalThis.fetch(...a), maintenant = Date.now(), limite = 50, lienApp = '' } = {}) {
  const bilan = { envoyes: 0, abandonnes: 0, reportes: 0 };
  const t = maintenant;
  const dues = await base.tous(
    `SELECT * FROM discord_file WHERE statut = 'attente' AND prochain_essai_le <= ? AND (verrou_jusqua IS NULL OR verrou_jusqua < ?)
      ORDER BY cree_le, id LIMIT ?`,
    [iso(t), iso(t), limite],
  );
  const teamsBloquees = new Set();

  async function abandonner(ligne, motif, { journal = true } = {}) {
    await base.executer("UPDATE discord_file SET statut = 'abandonne', derniere_erreur = ?, verrou_jusqua = NULL, maj_le = ? WHERE id = ?", [motif, iso(t), ligne.id]);
    if (journal) await consigner(base, ligne, 'discord.delivery_abandoned', { essais: Number(ligne.essais), motif }, t);
    bilan.abandonnes++;
  }

  for (const ligne of dues) {
    if (teamsBloquees.has(ligne.team_id)) continue;
    // Bail : un seul traitement à la fois par message (requête et cron simultanés).
    const pris = await base.executer(
      "UPDATE discord_file SET verrou_jusqua = ? WHERE id = ? AND statut = 'attente' AND (verrou_jusqua IS NULL OR verrou_jusqua < ?)",
      [iso(t + BAIL_MS), ligne.id, iso(t)],
    );
    if (pris.changements !== 1) continue;

    if (Date.parse(ligne.expire_le) <= t) {
      await abandonner(ligne, 'Message périmé (trop ancien pour être utile)');
      continue;
    }
    const team = await base.premier('SELECT nom FROM teams WHERE id = ? AND supprimee_le IS NULL AND archivee_le IS NULL', [ligne.team_id]);
    const webhook = await base.premier('SELECT * FROM discord_webhooks WHERE team_id = ?', [ligne.team_id]);
    if (!team || !webhook) {
      await abandonner(ligne, 'Team ou webhook supprimé', { journal: false });
      continue;
    }
    if (!(await modulesActifs(base, ligne.team_id)).has('discord')) {
      await abandonner(ligne, 'Module Discord désactivé', { journal: false });
      continue;
    }
    if (webhook.bloque_jusqua && Date.parse(webhook.bloque_jusqua) > t) {
      await base.executer('UPDATE discord_file SET prochain_essai_le = ?, verrou_jusqua = NULL WHERE id = ?', [webhook.bloque_jusqua, ligne.id]);
      bilan.reportes++;
      teamsBloquees.add(ligne.team_id);
      continue;
    }
    const url = await dechiffrerWebhook(cle, ligne.team_id, webhook.url_chiffree);
    if (!url) {
      await abandonner(ligne, 'Adresse du webhook illisible (clé de chiffrement changée ?) : saisissez-la à nouveau');
      continue;
    }

    const variables = jsonOu(ligne.variables, {});
    const contenu = rendreModele(ligne.modele, { ...variables, lien: lienApp });
    const resultat = await posterWebhook(fetchDiscord, url, construireCharge(contenu, { roleId: ligne.role_mention, nomTeam: team.nom }));

    if (resultat.ok) {
      await base.lot([
        { sql: "UPDATE discord_file SET statut = 'envoye', envoye_le = ?, essais = essais + 1, derniere_erreur = NULL, verrou_jusqua = NULL, maj_le = ? WHERE id = ?", params: [iso(t), iso(t), ligne.id] },
        { sql: 'UPDATE discord_webhooks SET dernier_succes_le = ?, bloque_jusqua = NULL WHERE team_id = ?', params: [iso(t), ligne.team_id] },
      ]);
      bilan.envoyes++;
      continue;
    }
    if (resultat.statut === 429) {
      // Limite de débit : on obéit à Discord, pour toute la team, sans compter d'essai.
      const jusqua = iso(t + resultat.retryApresS * 1000);
      await base.lot([
        { sql: 'UPDATE discord_file SET prochain_essai_le = ?, verrou_jusqua = NULL, derniere_erreur = ?, maj_le = ? WHERE id = ?', params: [jusqua, resultat.motif, iso(t), ligne.id] },
        { sql: 'UPDATE discord_webhooks SET bloque_jusqua = ? WHERE team_id = ?', params: [jusqua, ligne.team_id] },
      ]);
      teamsBloquees.add(ligne.team_id);
      bilan.reportes++;
      continue;
    }

    const essais = Number(ligne.essais) + 1;
    await base.executer('UPDATE discord_webhooks SET dernier_echec_le = ?, invalide_le = CASE WHEN ? = 1 THEN ? ELSE invalide_le END WHERE team_id = ?', [iso(t), resultat.webhookPerdu ? 1 : 0, iso(t), ligne.team_id]);
    if (resultat.definitif || essais >= ESSAIS_MAX) {
      await base.executer('UPDATE discord_file SET essais = ? WHERE id = ?', [essais, ligne.id]);
      await abandonner({ ...ligne, essais }, resultat.motif);
      continue;
    }
    await base.executer(
      'UPDATE discord_file SET essais = ?, prochain_essai_le = ?, derniere_erreur = ?, verrou_jusqua = NULL, maj_le = ? WHERE id = ?',
      [essais, iso(t + ATTENTES_ECHEC_S[Math.min(essais - 1, ATTENTES_ECHEC_S.length - 1)] * 1000), resultat.motif, iso(t), ligne.id],
    );
    await consigner(base, ligne, 'discord.delivery_failed', { essai: essais, sur: ESSAIS_MAX, motif: resultat.motif }, t);
    bilan.reportes++;
  }

  // Ménage : envois terminés depuis plus de 30 jours, rappels très anciens.
  await base.executer("DELETE FROM discord_file WHERE statut != 'attente' AND maj_le < ?", [iso(t - CONSERVATION_MS)]);
  await base.executer('DELETE FROM discord_rappels WHERE cree_le < ?', [iso(t - 2 * CONSERVATION_MS)]);
  return bilan;
}
