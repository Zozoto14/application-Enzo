/**
 * MP Discord du bot pour les réunions de l'équipe CM (file `cm_reunion_mp`, migration 0039) : rappel avant une
 * réunion, annulation. Même mécanisme que les relances du planning (discord/file.mjs) : salon privé
 * (`POST /users/@me/channels`) puis message, nonce (un réessai ne double jamais un MP), 429 respecté, réessais
 * 1 min, 5 min, 15 min, 1 h, 3 h puis abandon ; le compte est joint par sa liaison /lier vérifiée, sinon le Discord ID
 * posé par le Fondateur ; le texte est dans SA langue (profil, sinon langue par défaut, sinon anglais).
 *
 * Le message ne contient QUE le titre, l'heure (dans le fuseau du membre) et le lien de visio : jamais l'ordre du
 * jour ni le compte rendu (notes confidentielles).
 *
 * Ce fichier n'importe pas evenements.mjs (cm/bus.mjs, que evenements.mjs importe, se sert de `mettreMpEnFile`).
 */

import { iso, jsonOu } from '../../outils.mjs';
import { texte as T } from '../../langues.mjs';
import { API_DISCORD, ATTENTES_ECHEC_S, ESSAIS_MAX, appelerDiscord, langueCompte } from '../../discord/file.mjs';
import { nonceEnvoi } from '../../discord/bilingue.mjs';
import { formaterInstant } from '../../discord/formats.mjs';

const BAIL_MS = 120_000;
const VALIDITE_ANNULATION_MS = 24 * 3_600_000;
const ACCENT = 0x5b8cff;

/** Abonné du bus : un MP par compte, idempotent (identifiant dérivé de l'événement). */
export async function mettreMpEnFile(base, ev, comptes, genre, occurrence) {
  const charge = jsonOu(ev.charge, {});
  const debut = Date.parse(charge.debut ?? occurrence ?? '');
  // Un rappel n'a plus de sens une fois la réunion commencée ; une annulation vaut 24 h.
  const expire = genre === 'rappel' && Number.isFinite(debut) ? debut : Date.parse(ev.cree_le) + VALIDITE_ANNULATION_MS;
  for (const compte of new Set(comptes.filter(Boolean))) {
    await base.executer(
      `INSERT INTO cm_reunion_mp (id, compte_id, reunion_id, occurrence, genre, statut, essais, prochain_essai_le, expire_le, cree_le, maj_le)
       VALUES (?, ?, ?, ?, ?, 'attente', 0, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      [`${ev.id}:${compte}`, compte, ev.entite_id ?? null, occurrence ?? null, genre, ev.cree_le, iso(expire), ev.cree_le, ev.cree_le],
    );
  }
}

async function discordDe(base, compte) {
  const l = await base.premier('SELECT c.discord_id, dc.discord_user_id FROM comptes c LEFT JOIN discord_comptes dc ON dc.compte_id = c.id WHERE c.id = ?', [compte]);
  return l?.discord_user_id ?? l?.discord_id ?? null;
}

/** Charge du MP (titre, heure dans le fuseau du membre, lieu ou lien) dans la langue du membre. */
export async function chargeMpReunion(base, ligne, { lienApp = '' } = {}) {
  const r = ligne.reunion_id ? await base.premier('SELECT * FROM cm_reunions WHERE id = ?', [ligne.reunion_id]) : null;
  if (!r) return null;
  if (ligne.genre === 'rappel' && r.statut !== 'active') return null;
  const langue = await langueCompte(base, ligne.compte_id);
  const profil = await base.premier('SELECT fuseau FROM cm_reunion_profils WHERE compte_id = ?', [ligne.compte_id]);
  const fuseau = profil?.fuseau || r.fuseau;
  const f = formaterInstant(fuseau, ligne.occurrence ?? r.debut, langue);
  const quand = `${f.date} · ${f.heure} (${fuseau})`;
  const lieu = r.lien ? r.lien : r.lieu || '';
  const description = [T(langue, `cm.reunion.mp.${ligne.genre}`, { titre: r.titre, quand }), lieu ? T(langue, 'cm.reunion.mp.lieu', { lieu }) : '', r.motif_annulation && ligne.genre === 'annulee' ? T(langue, 'cm.reunion.mp.motif', { motif: r.motif_annulation }) : '']
    .filter(Boolean)
    .join('\n');
  return {
    embeds: [{ title: T(langue, `cm.reunion.mp.titre_${ligne.genre}`).slice(0, 256), description: description.slice(0, 4000), color: ACCENT, ...(lienApp ? { url: lienApp } : {}) }],
    allowed_mentions: { parse: [] },
  };
}

/**
 * Envoie les MP dus. Options : `fetch`, `maintenant` (ms), `jetonBot`, `lienApp`, `limite`.
 * Rend `{ envoyes, abandonnes, reportes }`.
 */
export async function traiterMpReunions(base, { fetch: fetchDiscord = (...a) => globalThis.fetch(...a), maintenant = Date.now(), jetonBot, lienApp = '', limite = 50 } = {}) {
  const bilan = { envoyes: 0, abandonnes: 0, reportes: 0 };
  const t = maintenant;
  const dues = await base.tous("SELECT * FROM cm_reunion_mp WHERE statut = 'attente' AND prochain_essai_le <= ? AND (verrou_jusqua IS NULL OR verrou_jusqua < ?) ORDER BY cree_le, id LIMIT ?", [iso(t), iso(t), limite]);
  const abandonner = async (l, motif) => {
    await base.executer("UPDATE cm_reunion_mp SET statut = 'abandonne', derniere_erreur = ?, verrou_jusqua = NULL, maj_le = ? WHERE id = ?", [motif, iso(t), l.id]);
    bilan.abandonnes++;
  };
  for (const l of dues) {
    const pris = await base.executer("UPDATE cm_reunion_mp SET verrou_jusqua = ? WHERE id = ? AND statut = 'attente' AND (verrou_jusqua IS NULL OR verrou_jusqua < ?)", [iso(t + BAIL_MS), l.id, iso(t)]);
    if (pris.changements !== 1) continue;
    if (Date.parse(l.expire_le) <= t) {
      await abandonner(l, 'Expiré');
      continue;
    }
    if (!jetonBot) {
      await abandonner(l, 'Bot Discord non configuré sur le serveur (DISCORD_BOT_TOKEN)');
      continue;
    }
    const discordId = await discordDe(base, l.compte_id);
    if (!discordId) {
      await abandonner(l, 'Compte non lié à Discord');
      continue;
    }
    const charge = await chargeMpReunion(base, l, { lienApp });
    if (!charge) {
      await abandonner(l, 'Réunion supprimée ou annulée');
      continue;
    }
    const salon = await appelerDiscord(fetchDiscord, `${API_DISCORD}/users/@me/channels`, { recipient_id: discordId }, { jetonBot, lireCorps: true });
    const r = salon.ok
      ? salon.messageId
        ? await appelerDiscord(fetchDiscord, `${API_DISCORD}/channels/${salon.messageId}/messages`, { ...charge, ...(await nonceEnvoi(l.id, 'mp')) }, { jetonBot, lireCorps: true })
        : { ok: false, statut: 0, definitif: false, motif: 'Salon privé Discord sans identifiant' }
      : salon;
    if (r.ok) {
      await base.executer("UPDATE cm_reunion_mp SET statut = 'envoye', envoye_le = ?, essais = essais + 1, verrou_jusqua = NULL, maj_le = ? WHERE id = ?", [iso(t), iso(t), l.id]);
      bilan.envoyes++;
      continue;
    }
    if (r.statut === 429) {
      await base.executer('UPDATE cm_reunion_mp SET prochain_essai_le = ?, verrou_jusqua = NULL, derniere_erreur = ?, maj_le = ? WHERE id = ?', [iso(t + (r.retryApresS ?? 5) * 1000), r.motif ?? '429', iso(t), l.id]);
      bilan.reportes++;
      continue;
    }
    const essais = Number(l.essais) + 1;
    if (r.definitif || essais >= ESSAIS_MAX) {
      await base.executer('UPDATE cm_reunion_mp SET essais = ? WHERE id = ?', [essais, l.id]);
      await abandonner(l, r.code === 50007 ? 'MP fermés' : (r.motif ?? 'Refusé par Discord'));
      continue;
    }
    await base.executer('UPDATE cm_reunion_mp SET essais = ?, prochain_essai_le = ?, derniere_erreur = ?, verrou_jusqua = NULL, maj_le = ? WHERE id = ?', [essais, iso(t + ATTENTES_ECHEC_S[Math.min(essais - 1, ATTENTES_ECHEC_S.length - 1)] * 1000), r.motif ?? 'Échec', iso(t), l.id]);
    bilan.reportes++;
  }
  return bilan;
}
