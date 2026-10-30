/**
 * Envoi des devblogs sur Discord (file `devblog_discord`, migration 0036 ; docs/esport/devblog.md).
 *
 * Règle du club : message principal en ANGLAIS dans le salon, puis fil « 🇫🇷 Version française » ouvert par le
 * bot sur ce message, avec la version française. Texte Markdown Discord (pas d'embed), dans la DA du devblog
 * (regles.mjs) ; au-delà de 2000 caractères, plusieurs messages à la suite (anglais dans le salon, français dans
 * le fil). « @here » (case cochée par défaut) : une seule fois, à la fin du message anglais, jamais dans le fil ;
 * une correction ne mentionne plus personne.
 *
 * Étapes reprenables, enregistrées une à une (un réessai ne reposte jamais un message déjà parti) : messages
 * anglais (`message_ids`), fil (`fil_id`), messages français (`fr_message_ids`). Nonce du bot ; 429 respecté ;
 * réessais 1 min, 5 min, 15 min, 1 h, 3 h puis abandon. Fil impossible (bot absent, permission manquante) :
 * l'anglais reste, l'erreur est affichée dans l'éditeur.
 *
 * Correction (`operation` = 'editer') : chaque message déjà posté est réédité (PATCH) ; un morceau en plus est
 * posté à la suite, un morceau en trop est supprimé. Premier message anglais supprimé dans Discord : tout est
 * reposté (sans mention).
 *
 * Salons : salon d'une team ou salon du club par webhook (resoudreCible de la page Réseaux), ou salon du club lié
 * au bot (`bot:club`, réglage `salon_bot`).
 */

import { iso, jsonOu } from '../outils.mjs';
import { API_DISCORD, ATTENTES_ECHEC_S, ESSAIS_MAX, appelerDiscord } from '../discord/file.mjs';
import { ARCHIVAGE_FIL_MIN, avecParams, motifRefusFil, nonceEnvoi, texteMotifFil } from '../discord/bilingue.mjs';
import { resoudreCible } from '../reseaux/annonces.mjs';
import { contenuVide, empreinteTextes, messagesDiscord, nomFilDevblog } from './regles.mjs';

const BAIL_MS = 120_000;
/** Nom affiché des messages postés par webhook. */
export const EXPEDITEUR_DEVBLOG = 'Devblog';
/** Aperçus de liens supprimés (SUPPRESS_EMBEDS) : le texte reste lisible, comme le devblog posté à la main. */
const SANS_APERCU = 4;

/** Charge d'un message : texte seul ; mention @here autorisée seulement si `here`. */
export function chargeDevblog(contenu, { here = false, webhook = false } = {}) {
  return {
    content: contenu,
    allowed_mentions: { parse: here ? ['everyone'] : [] },
    flags: SANS_APERCU,
    ...(webhook ? { username: EXPEDITEUR_DEVBLOG } : {}),
  };
}

async function salonDe(base, ligne, { cle, jetonBot }) {
  if (ligne.cible === 'bot:club') {
    const r = jsonOu((await base.premier("SELECT valeur FROM devblog_reglages WHERE cle = 'salon_bot'", []))?.valeur, null);
    if (!r?.id) return { abandon: 'Salon du bot non réglé' };
    if (!jetonBot) return { abandon: 'Bot Discord non configuré sur le serveur (DISCORD_BOT_TOKEN)' };
    return { canal: 'bot', salonId: r.id };
  }
  const c = await resoudreCible(base, { cible: ligne.cible, teamId: ligne.team_id, salonId: ligne.salon_id }, { cle, jetonBot });
  if (c.abandon) return c;
  return { canal: c.canal, url: c.url, salonId: c.salonId };
}

/**
 * Envoie les publications dues. Options : `cle` (secret des webhooks), `fetch`, `maintenant` (ms), `jetonBot`,
 * `limite`. Rend `{ envoyes, abandonnes, reportes }`.
 */
export async function traiterDevblogDiscord(base, { cle, fetch: fetchDiscord = (...a) => globalThis.fetch(...a), maintenant = Date.now(), jetonBot, limite = 10 } = {}) {
  const bilan = { envoyes: 0, abandonnes: 0, reportes: 0 };
  const t = maintenant;
  const dues = await base.tous(
    "SELECT * FROM devblog_discord WHERE statut = 'attente' AND prochain_essai_le <= ? AND (verrou_jusqua IS NULL OR verrou_jusqua < ?) ORDER BY cree_le, id LIMIT ?",
    [iso(t), iso(t), limite],
  );
  for (const brute of dues) {
    const pris = await base.executer("UPDATE devblog_discord SET verrou_jusqua = ? WHERE id = ? AND statut = 'attente' AND (verrou_jusqua IS NULL OR verrou_jusqua < ?)", [iso(t + BAIL_MS), brute.id, iso(t)]);
    if (pris.changements !== 1) continue;
    try {
      await traiterLigne(base, brute, { cle, fetchDiscord, t, jetonBot, bilan });
    } catch (e) {
      // Erreur inattendue : la ligne est relâchée (réessai plus tard), jamais bloquée.
      await base.executer('UPDATE devblog_discord SET verrou_jusqua = NULL, derniere_erreur = ?, prochain_essai_le = ?, maj_le = ? WHERE id = ?', [String(e?.message ?? e).slice(0, 200), iso(t + 60_000), iso(t), brute.id]);
      bilan.reportes++;
    }
  }
  return bilan;
}

async function traiterLigne(base, ligne, { cle, fetchDiscord, t, jetonBot, bilan }) {
  const maj = champs => {
    const cles = Object.keys(champs);
    return base.executer(`UPDATE devblog_discord SET ${cles.map(k => `${k} = ?`).join(', ')}, maj_le = ? WHERE id = ?`, [...cles.map(k => champs[k]), iso(t), ligne.id]);
  };
  const abandonner = async motif => {
    await maj({ statut: 'abandonne', derniere_erreur: motif, verrou_jusqua: null });
    bilan.abandonnes++;
  };
  const echouer = async r => {
    if (r.statut === 429) {
      await maj({ prochain_essai_le: iso(t + r.retryApresS * 1000), verrou_jusqua: null, derniere_erreur: r.motif });
      bilan.reportes++;
      return;
    }
    const essais = Number(ligne.essais) + 1;
    if (r.definitif || essais >= ESSAIS_MAX) {
      await maj({ essais });
      await abandonner(r.motif);
      return;
    }
    await maj({ essais, prochain_essai_le: iso(t + ATTENTES_ECHEC_S[Math.min(essais - 1, ATTENTES_ECHEC_S.length - 1)] * 1000), derniere_erreur: r.motif, verrou_jusqua: null });
    bilan.reportes++;
  };

  const e = await base.premier('SELECT * FROM devblog_entrees WHERE id = ?', [ligne.entree_id]);
  if (!e || e.statut !== 'publie') return abandonner('Devblog repassé en brouillon ou supprimé');
  const c = await salonDe(base, ligne, { cle, jetonBot });
  if (c.abandon) return abandonner(c.abandon);
  const canal = ligne.canal ?? c.canal;
  if (ligne.canal && canal !== c.canal) return abandonner('Salon Discord changé depuis la publication : messages non modifiables');
  const bot = canal === 'bot';
  const opts = (extra = {}) => ({ ...(bot ? { jetonBot } : {}), ...extra });
  const entree = { date: e.date_maj, version: e.version, contenuFr: jsonOu(e.contenu_fr, contenuVide()), contenuEn: jsonOu(e.contenu_en, contenuVide()) };
  const edition = ligne.operation === 'editer';
  const here = Number(ligne.mention_here) === 1;
  const textes = messagesDiscord(entree, { here });
  // Une correction ne notifie personne (le texte garde son « @here », sans ping).
  const pingPermis = !edition;
  let ids = jsonOu(ligne.message_ids, []);
  let frIds = jsonOu(ligne.fr_message_ids, []);
  let salonMessage = ligne.message_salon_id ?? (bot ? c.salonId : null);
  let filId = ligne.fil_id ?? null;
  let forum = Number(ligne.forum) === 1;
  const revision = Number(ligne.revision ?? 0);

  // Adresses : un message du salon (ou du post de forum), un message du fil.
  const urlPoster = dansFil => (bot ? `${API_DISCORD}/channels/${dansFil ? filId : salonMessage}/messages` : avecParams(c.url, { wait: 'true', ...(dansFil && filId ? { thread_id: filId } : {}) }));
  const urlMessage = (id, dansFil) => (bot ? `${API_DISCORD}/channels/${dansFil ? filId : salonMessage}/messages/${id}` : avecParams(`${c.url}/messages/${id}`, dansFil && filId ? { thread_id: filId } : {}));
  const poster = async (texte, { dansFil, ping, etape }) => {
    const charge = chargeDevblog(texte, { here: ping, webhook: !bot });
    if (bot) Object.assign(charge, await nonceEnvoi(`dv:${ligne.id}:${revision}`, etape));
    return appelerDiscord(fetchDiscord, urlPoster(dansFil), charge, opts({ lireCorps: true }));
  };

  // ---- 1. Messages anglais (salon ; dans un salon forum, le premier ouvre le post et les suivants y répondent).
  if (edition && ids.length) {
    // Correction : rééditer ce qui existe.
    for (let i = 0; i < Math.min(ids.length, textes.en.length); i++) {
      const r = await appelerDiscord(fetchDiscord, urlMessage(ids[i], forum), { content: textes.en[i], allowed_mentions: { parse: [] }, flags: SANS_APERCU }, opts({ methode: 'PATCH' }));
      if (r.ok) continue;
      if (r.statut === 404 && i === 0) {
        // Premier message supprimé dans Discord : on repart de zéro (nouveau message, nouveau fil), sans mention.
        await maj({ message_ids: '[]', fr_message_ids: '[]', fil_id: null, message_salon_id: null, forum: 0, operation: 'poster', revision: revision + 1, mention_here: 0, verrou_jusqua: null, prochain_essai_le: iso(t) });
        return traiterLigne(base, { ...ligne, message_ids: '[]', fr_message_ids: '[]', fil_id: null, message_salon_id: null, forum: 0, operation: 'poster', revision: revision + 1, mention_here: 0 }, { cle, fetchDiscord, t, jetonBot, bilan });
      }
      if (r.statut === 404) {
        // Morceau supprimé à la main : il sera reposté à la suite.
        ids = ids.slice(0, i);
        await maj({ message_ids: JSON.stringify(ids) });
        break;
      }
      return echouer(r);
    }
    // Morceaux en trop (texte raccourci) : supprimés.
    while (ids.length > textes.en.length) {
      const id = ids.at(-1);
      const r = await appelerDiscord(fetchDiscord, urlMessage(id, forum), undefined, opts({ methode: 'DELETE' }));
      if (!r.ok && r.statut !== 404) return echouer(r);
      ids = ids.slice(0, -1);
      await maj({ message_ids: JSON.stringify(ids) });
    }
  }
  for (let i = ids.length; i < textes.en.length; i++) {
    const dernier = i === textes.en.length - 1;
    let r = await poster(textes.en[i], { dansFil: forum && i > 0, ping: pingPermis && here && dernier, etape: `en${i}` });
    if (!bot && i === 0 && r.statut === 400 && r.code === 220001) {
      // Salon forum (webhook) : le premier message ouvre un post.
      const charge = { ...chargeDevblog(textes.en[0], { here: pingPermis && here && dernier, webhook: true }), thread_name: (entree.contenuEn.titre ? `DEVBLOG — ${entree.contenuEn.titre}` : 'DEVBLOG').slice(0, 100) };
      r = await appelerDiscord(fetchDiscord, avecParams(c.url, { wait: 'true' }), charge, { lireCorps: true });
      if (r.ok) {
        forum = true;
        filId = r.salonId ?? r.messageId;
      }
    }
    if (!r.ok) return echouer(r);
    if (i === 0) salonMessage = r.salonId ?? salonMessage;
    ids = [...ids, r.messageId ?? null];
    await maj({ message_ids: JSON.stringify(ids), message_salon_id: salonMessage, canal: c.canal, forum: forum ? 1 : 0, ...(forum ? { fil_id: filId } : {}) });
  }

  // ---- 2. Le fil « 🇫🇷 Version française », ouvert par le bot sur le premier message anglais.
  const terminer = async (erreur = null) => {
    await maj({ statut: 'envoye', envoye_le: iso(t), derniere_erreur: erreur, verrou_jusqua: null, empreinte: empreinteTextes(messagesDiscord(entree, { here: false })) });
    bilan.envoyes++;
  };
  if (!filId) {
    if (!jetonBot || !salonMessage || !ids[0]) return terminer(`Version française non publiée : ${texteMotifFil(jetonBot ? 'acces' : 'bot_absent')}`);
    const r = await appelerDiscord(fetchDiscord, `${API_DISCORD}/channels/${salonMessage}/messages/${ids[0]}/threads`, { name: nomFilDevblog(entree.contenuFr.titre), auto_archive_duration: ARCHIVAGE_FIL_MIN }, { jetonBot, lireCorps: true });
    if (r.ok || r.code === 160004) {
      filId = (r.ok && r.messageId) || ids[0];
      await maj({ fil_id: filId });
    } else if (r.definitif) {
      return terminer(texteMotifFil(motifRefusFil(r, 'creer'), r.statut));
    } else {
      return echouer(r);
    }
  }

  // ---- 3. Messages français dans le fil (jamais de mention). Dans un post de forum, ils suivent l'anglais.
  if (edition && frIds.length) {
    for (let i = 0; i < Math.min(frIds.length, textes.fr.length); i++) {
      const r = await appelerDiscord(fetchDiscord, urlMessage(frIds[i], true), { content: textes.fr[i], allowed_mentions: { parse: [] }, flags: SANS_APERCU }, opts({ methode: 'PATCH' }));
      if (r.ok) continue;
      if (r.statut === 404) {
        frIds = frIds.slice(0, i);
        await maj({ fr_message_ids: JSON.stringify(frIds) });
        break;
      }
      return echouer(r);
    }
    while (frIds.length > textes.fr.length) {
      const r = await appelerDiscord(fetchDiscord, urlMessage(frIds.at(-1), true), undefined, opts({ methode: 'DELETE' }));
      if (!r.ok && r.statut !== 404) return echouer(r);
      frIds = frIds.slice(0, -1);
      await maj({ fr_message_ids: JSON.stringify(frIds) });
    }
  }
  for (let i = frIds.length; i < textes.fr.length; i++) {
    const r = await poster(textes.fr[i], { dansFil: true, ping: false, etape: `fr${i}` });
    if (!r.ok) {
      if (r.definitif) return terminer(texteMotifFil(motifRefusFil(r, 'ecrire'), r.statut));
      return echouer(r);
    }
    frIds = [...frIds, r.messageId ?? null];
    await maj({ fr_message_ids: JSON.stringify(frIds) });
  }
  return terminer();
}
