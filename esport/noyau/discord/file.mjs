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
 *
 * Pings (migration 0031, docs/esport/discord.md) : un joueur n'est mentionné dans le salon qu'UNE fois par
 * occurrence du planning (registre `discord_mentions`) ; les relances et les messages qui ne concernent qu'un
 * convoqué partent en MP (`phaseMp`), avec repli dans le salon pour qui n'a pas pu être joint.
 */

import { iso, jsonOu, nouvelId } from '../outils.mjs';
import { dechiffrerWebhook } from './chiffrement.mjs';
import { CLES_COMPETITION, CLES_OCCURRENCE, clesPourType, evenementDiscord, libelleTypeEvenement, textesEvenement } from './catalogue.mjs';
import { lireLangue, nomRoleSysteme, texte as T } from '../langues.mjs';
import { estReunionStaff, membresTeam } from './convoques.mjs';
import { boutonLien, boutonsCompetition, boutonsRessource, boutonsRsvp, embedCompetition, embedRessource } from './embeds.mjs';
import { resumeAnnonce, resumeResultat, resumeTournoi } from '../competition/resume.mjs';
import { formaterDelai, formaterInstant } from './formats.mjs';
import { construireCharge, rendreModele } from './messages.mjs';
import { contexteOccurrence, embedOccurrence, variablesOccurrence } from './occurrence.mjs';
import { ARCHIVAGE_FIL_MIN, alerteFilPermise, avecParams, chargeAlerteFil, discordFondateur, motifRefusFil, nomFil, nomPost, nonceEnvoi, texteMotifFil } from './bilingue.mjs';

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

export { formaterDelai, formaterInstant };

async function pseudoDe(base, compte, langue = 'fr') {
  if (typeof compte !== 'string' || !compte) return '';
  const l = await base.premier('SELECT pseudo FROM comptes WHERE id = ?', [compte]);
  return l?.pseudo ?? T(langue, compte === 'principal' ? 'var.fondateur' : 'var.un_membre');
}

/** Pseudos d'une liste de comptes, séparés par des virgules (« toute la team » pour un ancien rappel sans liste). */
async function pseudosListe(base, comptes, langue = 'fr') {
  if (!Array.isArray(comptes)) return T(langue, 'var.toute_la_team');
  const noms = [];
  for (const c of comptes.slice(0, 30)) noms.push(await pseudoDe(base, c, langue));
  return noms.join(', ') + (comptes.length > 30 ? '…' : '');
}

/** Réunion d'un type « staff » (ou introuvable) : rien ne sort sur Discord. */
async function reunionStaff(base, ev) {
  const r = await base.premier('SELECT y.visibilite FROM reunions r JOIN types_reunion y ON y.id = r.type_id WHERE r.id = ? AND r.team_id = ?', [ev.entite_id, ev.team_id]);
  return !r || r.visibilite === 'staff';
}

/** Variables du message pour un événement de domaine ; `null` : rien à envoyer. */
async function variablesDe(base, ev, cle, charge, team, L) {
  const t = Date.parse(ev.cree_le);
  // Langue du message (anglais, ou langue de la team sans fil français) : mémorisée avec lui (`_langue`), pour qu'il parte tel quel.
  const pseudo = compte => pseudoDe(base, compte, L);
  const role = nom => nomRoleSysteme(L, nom);
  const base_ = { team: team.nom, _langue: L };
  const quand = charge.debut ? formaterInstant(team.fuseau, charge.debut, L) : { date: '', heure: '' };
  // Occurrence montrée (embed, boutons RSVP, mentions) : relue au moment de l'envoi.
  const occurrence = charge.occurrence ?? charge.debut ?? null;
  const evenementId = charge.evenementId ?? ev.entite_id ?? null;
  const instant = { titre: charge.titre ?? '', type: libelleTypeEvenement(charge.type, L), ...quand, evenementId, occurrence };
  switch (cle) {
    case 'event_created':
      // Événement d'un match de tournoi : l'annonce « Match à venir » (plus riche) le remplace, si elle est active.
      if (charge.tournoiMatchId && (await annonceTournoiActive(base, ev.team_id))) return null;
      return { ...base_, ...instant, acteur: await pseudo(ev.acteur_id) };
    case 'tournament_registered':
    case 'tournament_final': {
      const r = await resumeTournoi(base, ev.team_id, ev.entite_id, { langue: L });
      if (!r || !r.publiable) return null;
      const jour = r.debut ? formaterInstant(team.fuseau, `${r.debut}T12:00:00.000Z`, L).date : '';
      return { ...base_, tournoi: r.nom, dates: jour ? T(L, 'var.le_jour', { date: jour }) : '', resultat: r.phraseFinal, classement: r.texteClassement ?? '', gains: r.gains ?? '', acteur: await pseudo(ev.acteur_id), _competition: { genre: 'tournoi', id: r.id } };
    }
    case 'match_announced': {
      const r = await resumeAnnonce(base, ev.team_id, ev.entite_id, { langue: L });
      if (!r || !r.publiable) return null;
      return { ...base_, titre: r.titre, tournoi: r.tournoi.nom, tour: r.tour ?? '', adversaire: r.adversaires.map(a => a.nom).join(', ') || '?', date: r.quand.date, heure: r.quand.heure, _competition: { genre: 'annonce', id: r.id } };
    }
    case 'match_result': {
      const r = await resumeResultat(base, ev.team_id, ev.entite_id, { langue: L });
      if (!r || !r.publiable) return null;
      return {
        ...base_,
        resultat: r.phrase,
        issue: r.libelleIssue,
        score: r.score,
        adversaire: r.adversaires.map(a => a.nom).join(', '),
        place: r.libellePlace ?? '',
        titre: r.titre,
        tournoi: r.tournoi?.nom ?? '',
        acteur: await pseudo(ev.acteur_id),
        _competition: { genre: 'resultat', id: r.id },
      };
    }
    case 'reminder_d1':
    case 'reminder_h1':
      return { ...base_, ...instant, delai: formaterDelai(Date.parse(charge.debut) - t, L), convoques: await pseudosListe(base, charge.convoques, L) };
    case 'event_now':
      return { ...base_, ...instant, delai: formaterDelai(Date.parse(charge.debut) - t, L), convoques: await pseudosListe(base, charge.convoques, L) };
    case 'rsvp_missing':
      return { ...base_, ...instant, membre: await pseudo(charge.compte) };
    case 'rsvp_relance':
      return { ...base_, ...instant, membre: '' };
    case 'summary_published': {
      // Les réunions de type « staff » ne sortent jamais du staff : rien n'est publié sur Discord.
      if (await reunionStaff(base, ev)) return null;
      return { ...base_, titre: charge.titre ?? '', acteur: await pseudo(ev.acteur_id), membre: await pseudo(charge.deposePar) };
    }
    case 'summary_submitted':
      // Même règle au dépôt : le titre d'une réunion staff ne part pas sur le salon de la team.
      if (await reunionStaff(base, ev)) return null;
      return { ...base_, titre: charge.titre ?? '', type: charge.type ?? '', date: dateJour(charge.dateReunion), membre: await pseudo(ev.acteur_id) };
    case 'task_assigned':
      return {
        ...base_,
        titre: charge.titre ?? '',
        assigne: await pseudo(charge.assigne),
        echeance: charge.echeance ? T(L, 'var.pour_le', { date: dateJour(charge.echeance) }) : '',
        acteur: await pseudo(ev.acteur_id),
      };
    case 'task_due':
      return {
        ...base_,
        titre: charge.titre ?? '',
        assigne: await pseudo(charge.assigne),
        echeance: dateJour(charge.echeance),
        etat: T(L, charge.retard ? 'var.en_retard' : 'var.echeance_proche'),
      };
    case 'member_joined':
      return { ...base_, membre: await pseudo(ev.acteur_id), role: role(charge.role ?? '') };
    case 'account_requested':
      // Jamais l'adresse e-mail : seulement le pseudo proposé et le rôle.
      return { ...base_, membre: charge.pseudo ?? '', role: role(charge.role ?? ''), acteur: await pseudo(ev.acteur_id) };
    case 'role_changed':
      return { ...base_, membre: await pseudo(charge.compte), de: role(charge.de ?? ''), vers: role(charge.vers ?? ''), acteur: await pseudo(ev.acteur_id) };
    case 'review_created':
      return { ...base_, titre: charge.titre ?? '', acteur: await pseudo(ev.acteur_id) };
    case 'strat_created': {
      // Une strat privée (brouillon de son auteur) n'est jamais annoncée.
      const s = await base.premier('SELECT visibilite FROM strats WHERE id = ? AND team_id = ?', [ev.entite_id, ev.team_id]);
      if (!s || s.visibilite !== 'team') return null;
      return { ...base_, titre: charge.titre ?? '', carte: charge.carte ?? '', side: T(L, charge.side === 'defense' ? 'var.defense' : 'var.attaque'), acteur: await pseudo(ev.acteur_id) };
    }
    case 'playbook_validated':
      return { ...base_, titre: charge.titre ?? '', surCarte: charge.carte ? T(L, 'var.sur_carte', { carte: charge.carte }) : '', acteur: await pseudo(ev.acteur_id) };
    case 'resource_created': {
      // Seulement une ressource publiée, visible de toute la team (jamais « staff seulement »), encore là.
      const r = await ressourceAnnoncable(base, ev.entite_id, ev.team_id);
      if (!r) return null;
      return { ...base_, titre: r.titre, categorie: await nomCategorieRessource(base, r, L), genre: T(L, `ressource.genre.${r.genre}`), acteur: await pseudo(r.auteur_id), _ressource: r.id };
    }
    default:
      return null;
  }
}

/** Annonce « Match à venir » active pour la team (module Tournois activé et message activé) ? */
async function annonceTournoiActive(base, teamId) {
  const module = await base.premier("SELECT active FROM team_modules WHERE team_id = ? AND module = 'tournois'", [teamId]);
  if (!module || Number(module.active) !== 1) return false;
  const ligne = await base.premier("SELECT * FROM discord_notification_settings WHERE team_id = ? AND cle = 'match_announced'", [teamId]);
  return reglageEffectif(evenementDiscord('match_announced'), ligne).actif;
}

/** Résumé publiable d'un message compétition (relu à l'envoi) ; null s'il a disparu. */
function resumeCompetition(base, teamId, c, langue) {
  if (c.genre === 'resultat') return resumeResultat(base, teamId, c.id, { langue });
  if (c.genre === 'annonce') return resumeAnnonce(base, teamId, c.id, { langue });
  return resumeTournoi(base, teamId, c.id, { langue });
}

/** Ressource publiée et visible de toute la team (sinon null : rien ne part sur Discord). */
async function ressourceAnnoncable(base, id, teamId) {
  if (!id) return null;
  const r = await base.premier('SELECT * FROM ressources WHERE id = ? AND team_id = ?', [id, teamId]);
  if (!r || r.supprime_le || r.statut !== 'publiee' || r.visibilite !== 'team') return null;
  return r;
}

/** Nom affiché de la catégorie d'une ressource (une catégorie par défaut est traduite). */
async function nomCategorieRessource(base, r, langue) {
  const c = r.categorie_id ? await base.premier('SELECT nom, cle_defaut, supprime_le FROM ressource_categories WHERE id = ? AND team_id = ?', [r.categorie_id, r.team_id]) : null;
  if (!c || c.supprime_le) return T(langue, 'ressource.sans_categorie');
  return c.cle_defaut ? T(langue, `ressource.cat.${c.cle_defaut}`) : c.nom;
}

/**
 * Salon dédié aux ressources (Ressources › Réglages) : salon du bot (`discord_salon_id`, si le bot est
 * lié) ou webhook propre (chiffré). Rend `{ canal, salonId, webhook }` ou null (salon de la team).
 */
async function cibleRessources(base, teamId, serveur) {
  const r = await base.premier('SELECT discord_salon_id, discord_webhook FROM ressource_reglages WHERE team_id = ?', [teamId]);
  if (r?.discord_salon_id && serveur) return { canal: 'bot', salonId: r.discord_salon_id, webhook: null };
  if (r?.discord_webhook) return { canal: 'webhook', salonId: null, webhook: r.discord_webhook };
  return null;
}

// ------------------------------------------------------------------ Abonné du bus

/** Modules actifs d'une team. */
export async function modulesActifs(base, teamId) {
  const l = await base.tous('SELECT module FROM team_modules WHERE team_id = ? AND active = 1', [teamId]);
  return new Set(l.map(x => x.module));
}

/** Réglage effectif d'un type de message : ligne de la team, sinon valeurs par défaut du catalogue. */
export function reglageEffectif(def, ligne, langue = 'fr') {
  return {
    actif: ligne ? Number(ligne.actif) === 1 : def.defaut,
    modele: ligne?.modele || textesEvenement(def, langue).modele,
    personnalise: Boolean(ligne?.modele),
    roleMention: ligne?.role_mention ?? null,
  };
}

/** Fil français activé pour la team (ligne absente : oui, c'est le défaut). */
export async function filFrActif(base, teamId) {
  const l = await base.premier('SELECT fil_fr FROM discord_bilingue WHERE team_id = ?', [teamId]);
  return !l || Number(l.fil_fr) === 1;
}

/** Serveur Discord lié par le bot pour une team (null : pas de bot, le webhook sert de repli). */
export const serveurBot = (base, teamId) => base.premier('SELECT * FROM discord_serveurs WHERE team_id = ?', [teamId]);

/**
 * Identifiant de la ligne de file. Les relances (RSVP manquant, /relancer)
 * sont GROUPÉES : une seule ligne par occurrence et par heure, quel que soit le
 * nombre de joueurs sans réponse.
 */
function idDeLigne(ev, cle, variables) {
  if ((cle === 'rsvp_missing' || cle === 'rsvp_relance') && variables.evenementId && variables.occurrence) {
    return `${cle}:${variables.evenementId}:${variables.occurrence}:${String(ev.cree_le).slice(0, 13)}`;
  }
  return `${ev.id}:${cle}`;
}

/** Réponse d'un joueur : l'annonce du bot pour cette occurrence est rééditée (compteurs à jour). */
async function majAnnonce(base, ev) {
  const charge = jsonOu(ev.charge, {});
  const occurrence = charge.occurrence;
  if (!ev.entite_id || !occurrence) return;
  const annonce = await base.premier('SELECT * FROM discord_annonces WHERE evenement_id = ? AND occurrence = ? AND team_id = ?', [ev.entite_id, occurrence, ev.team_id]);
  if (!annonce || !(await serveurBot(base, ev.team_id))) return;
  // L'édition garde la langue du message posté ; une annonce d'avant la migration 0020 (sans langue) était
  // dans la langue de la team.
  const langue = lireLangue(annonce.langue) ?? lireLangue((await base.premier('SELECT langue_discord FROM teams WHERE id = ?', [ev.team_id]))?.langue_discord) ?? 'fr';
  // Une seule édition en attente par annonce : plusieurs réponses rapprochées ne font qu'une édition.
  await base.executer(
    `INSERT INTO discord_file (id, team_id, evenement_id, cle, modele, variables, statut, essais, prochain_essai_le, expire_le, cree_le, maj_le, canal, operation, salon_id)
     VALUES (?, ?, ?, 'event_created', '', ?, 'attente', 0, ?, ?, ?, ?, 'bot', 'editer', ?)
     ON CONFLICT (id) DO UPDATE SET statut = 'attente', essais = 0, prochain_essai_le = excluded.prochain_essai_le, expire_le = excluded.expire_le, derniere_erreur = NULL, maj_le = excluded.maj_le`,
    [`maj:${ev.entite_id}:${occurrence}`, ev.team_id, ev.id, JSON.stringify({ evenementId: ev.entite_id, occurrence, _langue: langue }), ev.cree_le, iso(Date.parse(ev.cree_le) + VALIDITE_MESSAGE_MS), ev.cree_le, ev.cree_le, annonce.salon_id],
  );
}

/** Abonné du bus : met en file les messages Discord que l'événement déclenche. */
export async function abonneDiscord(base, ev) {
  if (ev.type === 'team.deleted' && ev.team_id) {
    // Team supprimée : l'adresse du webhook (secret), la liaison du bot et la file disparaissent avec elle.
    for (const table of ['discord_file', 'discord_webhooks', 'discord_serveurs', 'discord_annonces', 'discord_debuts', 'discord_bot_pings', 'discord_codes', 'discord_bilingue', 'discord_alertes_fil', 'discord_mp_reglages', 'discord_mentions', 'discord_mp_envois', 'discord_injoignables']) {
      await base.executer(`DELETE FROM ${table} WHERE team_id = ?`, [ev.team_id]);
    }
    return;
  }
  if (ev.type === 'attendance.rsvp' && ev.team_id) {
    await majAnnonce(base, ev);
    return;
  }
  const cles = clesPourType(ev.type);
  if (cles.length === 0 || !ev.team_id) return;
  // Le bot (serveur lié) a la priorité ; sinon le webhook ; sinon rien. Ressources : salon dédié possible.
  const serveur = await serveurBot(base, ev.team_id);
  const dedie = cles.includes('resource_created') ? await cibleRessources(base, ev.team_id, serveur) : null;
  if (!serveur && !dedie && !(await base.premier('SELECT team_id FROM discord_webhooks WHERE team_id = ?', [ev.team_id]))) return;
  const team = await base.premier('SELECT nom, fuseau, langue_discord FROM teams WHERE id = ? AND supprimee_le IS NULL AND archivee_le IS NULL', [ev.team_id]);
  if (!team) return;
  // Fil français (défaut) : le message part en anglais, sa version française dans un fil (`_fil`).
  const bilingue = await filFrActif(base, ev.team_id);
  const langue = bilingue ? 'en' : (lireLangue(team.langue_discord) ?? 'fr');
  const actifs = await modulesActifs(base, ev.team_id);
  if (!actifs.has('discord')) return;
  const charge = jsonOu(ev.charge, {});
  let membres;
  for (const cle of cles) {
    const def = evenementDiscord(cle);
    if (!def.modules.every(m => actifs.has(m))) continue;
    const ligneReglage = await base.premier('SELECT * FROM discord_notification_settings WHERE team_id = ? AND cle = ?', [ev.team_id, cle]);
    const reglage = reglageEffectif(def, ligneReglage, langue);
    if (!reglage.actif) continue;
    const variables = await variablesDe(base, ev, cle, charge, team, langue);
    if (!variables) continue;
    if (bilingue) {
      // Version française, préparée dès maintenant (comme l'anglais) : modèle et variables en français.
      const fr = await variablesDe(base, ev, cle, charge, team, 'fr');
      if (fr) variables._fil = { modele: reglageEffectif(def, ligneReglage, 'fr').modele, variables: fr };
    }
    if (CLES_OCCURRENCE.includes(cle) && variables.evenementId) {
      // Réunion staff : jamais annoncée publiquement (ni bot, ni webhook).
      const evPlanning = await base.premier('SELECT type, concernes, convocation FROM planning_evenements WHERE id = ? AND team_id = ?', [variables.evenementId, ev.team_id]);
      membres ??= await membresTeam(base, ev.team_id);
      if (evPlanning && estReunionStaff(evPlanning, membres)) continue;
    }
    const creeMs = Date.parse(ev.cree_le);
    // Un rappel n'a plus de sens une fois l'événement commencé ; « c'est maintenant » vaut 30 min ; les autres 24 h.
    const debut = Date.parse(charge.debut);
    const expire = cle.startsWith('reminder_') && Number.isFinite(debut) ? debut : cle === 'event_now' && Number.isFinite(debut) ? debut + 30 * 60_000 : creeMs + VALIDITE_MESSAGE_MS;
    const cible = cle === 'resource_created' && dedie ? dedie : { canal: serveur ? 'bot' : 'webhook', salonId: serveur?.salon_id ?? null, webhook: null };
    await base.executer(
      `INSERT INTO discord_file (id, team_id, evenement_id, cle, modele, variables, role_mention, statut, essais, prochain_essai_le, expire_le, cree_le, maj_le, canal, salon_id, webhook_chiffre)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'attente', 0, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      [idDeLigne(ev, cle, variables), ev.team_id, ev.id, cle, reglage.modele, JSON.stringify(variables), reglage.roleMention, ev.cree_le, iso(expire), ev.cree_le, ev.cree_le, cible.canal, cible.salonId, cible.webhook],
    );
  }
}

// ------------------------------------------------------------------ Envoi

export const API_DISCORD = 'https://discord.com/api/v10';
const AGENT = 'DiscordBot (https://github.com/Zozoto14/application-Enzo, 1)';

/**
 * Appel à Discord (webhook, ou API du bot avec `jetonBot`). Rend `{ ok, statut, corps? }`, ou
 * `{ ok: false, statut, retryApresS?, definitif, motif }`. Ne lit la réponse que pour `retry_after`
 * (429) et, si `lireCorps`, l'identifiant du message créé ; ne suit aucune redirection.
 *
 * `fichiers` (facultatif ; annonces des posts CM, reseaux/annonces.mjs) : `[{ nom, type, octets }]` envoyés en
 * pièces jointes (multipart : `payload_json` + `files[n]`) ; l'embed peut les citer par `attachment://<nom>`. Avec
 * `lireCorps`, la réponse rend aussi `imageUrl` : l'adresse (CDN de Discord) de l'image du premier embed.
 */
export async function appelerDiscord(fetchDiscord, url, charge, { methode = 'POST', jetonBot, lireCorps = false, fichiers } = {}) {
  let r;
  const multipart = Array.isArray(fichiers) && fichiers.length > 0;
  let corpsRequete = JSON.stringify(charge);
  if (multipart) {
    corpsRequete = new FormData();
    corpsRequete.append('payload_json', JSON.stringify({ ...charge, attachments: fichiers.map((f, i) => ({ id: i, filename: f.nom })) }));
    fichiers.forEach((f, i) => corpsRequete.append(`files[${i}]`, new Blob([f.octets], { type: f.type }), f.nom));
  }
  try {
    r = await fetchDiscord(url, {
      method: methode,
      // Multipart : le Content-Type (et sa frontière) est posé par fetch.
      headers: { ...(multipart ? {} : { 'Content-Type': 'application/json' }), ...(jetonBot ? { Authorization: `Bot ${jetonBot}`, 'User-Agent': AGENT } : {}) },
      body: corpsRequete,
      redirect: 'manual',
      signal: AbortSignal.timeout(DELAI_ENVOI_MS),
    });
  } catch {
    return { ok: false, statut: 0, definitif: false, motif: 'Discord injoignable' };
  }
  const quoi = jetonBot ? 'Bot ou salon' : 'Webhook';
  if (r.status >= 200 && r.status < 300) {
    if (!lireCorps) return { ok: true, statut: r.status };
    let corps = null;
    try {
      corps = await r.json();
    } catch {
      corps = null;
    }
    const id = v => (typeof v === 'string' && /^\d{5,25}$/.test(v) ? v : null);
    // `salonId` : salon du message créé (webhook avec ?wait=true : salon réel, ou post de forum).
    const image = corps?.embeds?.[0]?.image?.url;
    return { ok: true, statut: r.status, messageId: id(corps?.id), salonId: id(corps?.channel_id), imageUrl: typeof image === 'string' && /^https:\/\/[^\s"<>]+$/.test(image) && image.length <= 2000 ? image : null };
  }
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
  // Code d'erreur JSON de Discord (50001 : accès, 50013 : permission manquante, 160004 : fil déjà créé, 220001 : salon forum).
  let code = null;
  try {
    const corps = await r.json();
    code = Number.isInteger(corps?.code) ? corps.code : null;
  } catch {
    code = null;
  }
  if ([401, 403, 404].includes(r.status)) return { ok: false, statut: r.status, code, definitif: true, webhookPerdu: true, motif: `${quoi} refusé ou supprimé (HTTP ${r.status})` };
  if (r.status >= 400 && r.status < 500) return { ok: false, statut: r.status, code, definitif: true, motif: `Message refusé par Discord (HTTP ${r.status})` };
  return { ok: false, statut: r.status, definitif: false, motif: `Erreur de Discord (HTTP ${r.status})` };
}

/** POST sur le webhook (historique : même contrat qu'avant le bot). */
export const posterWebhook = (fetchDiscord, url, charge) => appelerDiscord(fetchDiscord, url, charge);

async function consigner(base, ligne, action, meta, t) {
  await base.executer(
    "INSERT INTO journal (id, team_id, acteur_id, action, entite_type, entite_id, meta, cree_le) VALUES (?, ?, NULL, ?, 'discord', ?, ?, ?)",
    [nouvelId(), ligne.team_id, action, ligne.id, JSON.stringify({ cle: ligne.cle, ...meta }), iso(t)],
  );
}

/** Pings de la team par type d'événement (ligne absente : activé). */
export async function pingActif(base, teamId, type) {
  const l = await base.premier('SELECT ping FROM discord_bot_pings WHERE team_id = ? AND type_evenement = ?', [teamId, type]);
  return !l || Number(l.ping) === 1;
}

/** Relances (RSVP manquant, /relancer) : elles visent les convoqués SANS réponse. */
export const estRelance = cle => cle === 'rsvp_missing' || cle === 'rsvp_relance';

/** Sujet du registre des mentions (`discord_mentions`) pour une occurrence du planning. */
export const sujetOccurrence = (evenementId, occurrence) => `occ:${evenementId}:${occurrence}`;

/** Cibles déjà mentionnées dans le salon pour ce sujet (identifiants Discord, ou `role:<id>`). */
export async function mentionsFaites(base, teamId, sujet) {
  const l = await base.tous('SELECT cible FROM discord_mentions WHERE team_id = ? AND sujet = ?', [teamId, sujet]);
  return new Set(l.map(x => x.cible));
}

/** Option « Relances par MP » de la team (ligne absente : activée). */
export async function relancesMpActives(base, teamId) {
  const l = await base.premier('SELECT relances_mp FROM discord_mp_reglages WHERE team_id = ?', [teamId]);
  return !l || Number(l.relances_mp) === 1;
}

/** Comptes qu'aucun MP n'a joints pour cette tâche (bilan des MP), ou `null` si la tâche n'est pas passée par les MP. */
export function bilanMp(ligne) {
  if (ligne?.mp_bilan === null || ligne?.mp_bilan === undefined) return null;
  const b = jsonOu(ligne.mp_bilan, null);
  return new Set(Array.isArray(b?.echecs) ? b.echecs.map(String) : []);
}

/** Langue d'un MP : celle du profil du joueur, sinon sa langue par défaut (réglée par le Fondateur), sinon l'anglais. */
export async function langueCompte(base, compte) {
  const l = await base.premier('SELECT langue, langue_defaut FROM comptes WHERE id = ?', [compte]);
  return lireLangue(l?.langue) ?? lireLangue(l?.langue_defaut) ?? 'en';
}

/** Motif d'un MP impossible, pour Réglages › Discord : MP fermés (50007), utilisateur introuvable, autre refus. */
export function motifMp(r) {
  if (r.code === 50007) return 'mp_fermes';
  if (r.code === 10013 || r.statut === 404) return 'introuvable';
  return 'refuse';
}

/**
 * Charge d'une ligne de file. Rend `{ charge }`, ou `{ abandon: motif }` (rien à envoyer).
 * Les messages d'une occurrence sont reconstruits ICI, au moment de l'envoi (compteurs à jour).
 */
async function chargeDeLigne(base, ligne, { team, bot, lienApp, t, mentions = true }) {
  // `mentions: false` : version française du fil, jamais de mention (les pings restent sur le message principal).
  const roleId = mentions ? ligne.role_mention : null;
  const variables = jsonOu(ligne.variables, {});
  const langue = lireLangue(variables._langue) ?? 'fr';
  const occurrence = CLES_OCCURRENCE.includes(ligne.cle) && variables.evenementId && variables.occurrence;
  if (ligne.cle === 'resource_created') {
    // Relue au moment de l'envoi : passée « staff seulement », supprimée ou dépubliée entre-temps → rien ne part.
    const r = await ressourceAnnoncable(base, variables._ressource, ligne.team_id);
    if (!r) return { abandon: 'Ressource supprimée ou réservée au staff', silencieux: true };
    const contenu = rendreModele(ligne.modele, { ...variables, lien: lienApp });
    const embed = embedRessource({
      ressource: { titre: r.titre, genre: r.genre, url: r.url, niveau: r.niveau, carte: r.carte_nom, agent: r.agent_nom, apercu: jsonOu(r.apercu, null) },
      categorie: variables.categorie ?? '',
      auteur: variables.acteur ?? '',
      texte: contenu,
      team: { nom: team.nom, logo: team.logo_url },
      lien: lienApp,
      maintenant: t,
      langue,
    });
    return { charge: construireCharge(contenu, { roleId, nomTeam: team.nom, embed, composants: boutonsRessource(r.genre === 'fichier' || r.genre === 'note' ? null : r.url, lienApp, langue), maintenant: t, langue }) };
  }
  if (CLES_COMPETITION.includes(ligne.cle) && variables._competition) {
    // Relu au moment de l'envoi : supprimé, passé « staff » ou « non publiable » entre-temps → rien ne part.
    const r = await resumeCompetition(base, ligne.team_id, variables._competition, langue);
    if (!r || !r.publiable) return { abandon: 'Plus publiable', silencieux: true };
    const contenu = rendreModele(ligne.modele, { ...variables, lien: lienApp });
    const embed = embedCompetition({ cle: ligne.cle, resume: r, texte: contenu, lien: lienApp, maintenant: t, langue });
    return { charge: construireCharge(contenu, { roleId, nomTeam: team.nom, embed, composants: boutonsCompetition(r.tournoi?.lien ?? r.lien, lienApp, langue), maintenant: t, langue }) };
  }
  if (!occurrence) {
    const contenu = rendreModele(ligne.modele, { ...variables, lien: lienApp });
    const def = evenementDiscord(ligne.cle);
    return { charge: construireCharge(contenu, { roleId, nomTeam: team.nom, logoTeam: team.logo_url, cle: ligne.cle, titre: def ? textesEvenement(def, langue).libelle : T(langue, 'message.titre_defaut'), lien: lienApp, composants: boutonLien(lienApp, undefined, langue), maintenant: t, langue }) };
  }
  const c = await contexteOccurrence(base, ligne.team_id, variables.evenementId, variables.occurrence, t);
  if (!c) return { abandon: 'Événement supprimé ou occurrence annulée' };
  if (c.staff) return { abandon: 'Réunion staff : jamais annoncée publiquement' };
  // Rappels, « c'est maintenant », relances : seulement s'il y a des convoqués (l'annonce part toujours).
  if (c.convoques.length === 0 && ligne.cle !== 'event_created') return { abandon: 'Personne n’est convoqué', silencieux: true };
  const relance = estRelance(ligne.cle);
  if (relance && c.sansReponse.length === 0) return { abandon: 'Tout le monde a déjà répondu', silencieux: true };
  // Après les MP (relances, joueur seul) : le salon ne vise plus que les comptes qu'aucun MP n'a joints.
  const bilan = bilanMp(ligne);
  let cibles = relance ? c.sansReponse : c.convoques;
  if (bilan) {
    cibles = cibles.filter(m => bilan.has(m.compte));
    if (cibles.length === 0) return { abandon: relance ? 'Tout le monde a déjà répondu' : 'Personne n’est convoqué', silencieux: true };
  }
  let genre = ligne.cle;
  let modele = ligne.modele;
  if (ligne.operation === 'editer') {
    const annonce = await base.premier('SELECT cle FROM discord_annonces WHERE evenement_id = ? AND occurrence = ?', [variables.evenementId, variables.occurrence]);
    genre = annonce?.cle ?? 'event_created';
    const def = evenementDiscord(genre);
    modele = reglageEffectif(def, await base.premier('SELECT * FROM discord_notification_settings WHERE team_id = ? AND cle = ?', [ligne.team_id, genre]), langue).modele;
  }
  const vars = { ...variablesOccurrence(c, t, libelleTypeEvenement, langue), acteur: variables.acteur ?? '', lien: lienApp };
  if (relance && bilan) vars.membre = cibles.map(m => m.pseudo).join(', ');
  const texte = rendreModele(modele, vars);
  const embed = embedOccurrence(c, { genre, texte, lien: lienApp, maintenant: t, langue });
  const rsvpPossible = bot && c.presenceActive && !c.termine;
  const composants = rsvpPossible ? boutonsRsvp(c.ev.id, c.occurrence.cle, { lien: lienApp, langue }) : boutonLien(lienApp, undefined, langue);
  // Un ping UNE SEULE FOIS par occurrence (registre `discord_mentions`) : un joueur déjà mentionné (annonce,
  // rappel précédent…) ne l'est plus ; le rôle configuré non plus. Un rôle mentionné couvre les convoqués : jamais
  // rôle + mention individuelle dans le même message. Mentions individuelles : bot seulement, convoqués liés,
  // et seulement si la team garde le ping pour ce type. Jamais dans une édition ni dans le fil français.
  let utilisateurs = [];
  let role = null;
  let pings = null;
  if (mentions && ligne.operation !== 'editer') {
    const sujet = sujetOccurrence(c.ev.id, c.occurrence.cle);
    const deja = await mentionsFaites(base, ligne.team_id, sujet);
    role = roleId && !deja.has(`role:${roleId}`) ? roleId : null;
    const ids = bot && (await pingActif(base, ligne.team_id, c.occurrence.type)) ? [...new Set(cibles.map(m => m.discordId).filter(Boolean))] : [];
    utilisateurs = role ? [] : ids.filter(id => !deja.has(id));
    pings = { sujet, cibles: role ? [`role:${role}`, ...ids] : utilisateurs };
  }
  const charge = construireCharge(texte, { roleId: role, nomTeam: team.nom, embed, utilisateurs, composants, maintenant: t, langue });
  return { charge, contexte: c, genre, pings };
}

/**
 * MP d'une occurrence pour UN joueur (relance, ou message qui ne concerne que lui), dans SA langue : modèle
 * de la team (ou modèle par défaut dans cette langue), embed de l'occurrence, boutons RSVP (ils marchent en MP).
 * Aucune mention, aucun nom d'expéditeur (API du bot).
 */
export async function chargeMp(base, ligne, c, membre, { team, lienApp, t, langue }) {
  const def = evenementDiscord(ligne.cle);
  const reglage = reglageEffectif(def, await base.premier('SELECT * FROM discord_notification_settings WHERE team_id = ? AND cle = ?', [ligne.team_id, ligne.cle]), langue);
  const variables = jsonOu(ligne.variables, {});
  const vars = { ...variablesOccurrence(c, t, libelleTypeEvenement, langue), acteur: variables.acteur ?? '', lien: lienApp, ...(estRelance(ligne.cle) ? { membre: membre.pseudo } : {}) };
  const texte = rendreModele(reglage.modele, vars);
  const embed = embedOccurrence(c, { genre: ligne.cle, texte, lien: lienApp, maintenant: t, langue });
  const composants = c.presenceActive && !c.termine ? boutonsRsvp(c.ev.id, c.occurrence.cle, { lien: lienApp, langue }) : boutonLien(lienApp, undefined, langue);
  const { username: _u, ...charge } = construireCharge(texte, { nomTeam: team.nom, embed, composants, maintenant: t, langue });
  return charge;
}

/**
 * Envoie les messages dus. Options : `cle` (secret de chiffrement des webhooks), `fetch`,
 * `maintenant` (ms), `limite`, `lienApp` (adresse de l'app), `jetonBot` (DISCORD_BOT_TOKEN : sans lui,
 * les messages du bot sont abandonnés). Rend `{ envoyes, abandonnes, reportes }`.
 *
 * Message bilingue (`_fil` dans ses variables) : une seule tâche, en trois étapes reprenables
 * (anglais, fil, français : bilingue.mjs). Chaque étape réussie est enregistrée AVANT la suivante :
 * un réessai (429, erreur réseau, 5xx) ne reposte jamais l'anglais ni ne recrée le fil.
 */
export async function traiterFile(base, { cle, fetch: fetchDiscord = (...a) => globalThis.fetch(...a), maintenant = Date.now(), limite = 50, lienApp = '', jetonBot } = {}) {
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

  /** Envoi terminé (le message principal est parti) ; `erreur` : la version française n'a pas pu suivre. */
  async function terminer(ligne, { erreur = null, lot = [] } = {}) {
    await base.lot([
      { sql: "UPDATE discord_file SET statut = 'envoye', envoye_le = ?, essais = essais + 1, derniere_erreur = ?, verrou_jusqua = NULL, maj_le = ? WHERE id = ?", params: [iso(t), erreur, iso(t), ligne.id] },
      ...lot,
    ]);
    bilan.envoyes++;
  }

  /** Échec d'un appel : 429 (attente de Discord, sans compter d'essai), réessai plus tard, ou abandon. */
  async function echouer(ligne, resultat, { table, cleBlocage, methode = 'POST', apresMax } = {}) {
    if (resultat.statut === 429) {
      // Limite de débit : on obéit à Discord, pour toute la team, sans compter d'essai.
      const jusqua = iso(t + resultat.retryApresS * 1000);
      await base.lot([
        { sql: 'UPDATE discord_file SET prochain_essai_le = ?, verrou_jusqua = NULL, derniere_erreur = ?, maj_le = ? WHERE id = ?', params: [jusqua, resultat.motif, iso(t), ligne.id] },
        ...(table ? [{ sql: `UPDATE ${table} SET bloque_jusqua = ? WHERE team_id = ?`, params: [jusqua, ligne.team_id] }] : []),
      ]);
      if (cleBlocage) teamsBloquees.add(cleBlocage);
      bilan.reportes++;
      return;
    }
    const essais = Number(ligne.essais) + 1;
    if (table) {
      // Une annonce supprimée dans Discord (édition en 404) n'invalide pas le salon.
      const perdu = resultat.webhookPerdu && methode !== 'PATCH';
      await base.executer(`UPDATE ${table} SET dernier_echec_le = ?, invalide_le = CASE WHEN ? = 1 THEN ? ELSE invalide_le END WHERE team_id = ?`, [iso(t), perdu ? 1 : 0, iso(t), ligne.team_id]);
    }
    if (methode === 'PATCH' && resultat.statut === 404) await base.executer('DELETE FROM discord_annonces WHERE evenement_id = ? AND occurrence = ?', [jsonOu(ligne.variables, {}).evenementId, jsonOu(ligne.variables, {}).occurrence]);
    if (resultat.definitif || essais >= ESSAIS_MAX) {
      await base.executer('UPDATE discord_file SET essais = ? WHERE id = ?', [essais, ligne.id]);
      if (apresMax) return apresMax(essais);
      await abandonner({ ...ligne, essais }, resultat.motif);
      return;
    }
    await base.executer(
      'UPDATE discord_file SET essais = ?, prochain_essai_le = ?, derniere_erreur = ?, verrou_jusqua = NULL, maj_le = ? WHERE id = ?',
      [essais, iso(t + ATTENTES_ECHEC_S[Math.min(essais - 1, ATTENTES_ECHEC_S.length - 1)] * 1000), resultat.motif, iso(t), ligne.id],
    );
    await consigner(base, ligne, 'discord.delivery_failed', { essai: essais, sur: ESSAIS_MAX, motif: resultat.motif }, t);
    bilan.reportes++;
  }

  /** Mentions faites par le message principal : retenues (avec son envoi) pour ne jamais pinger deux fois. */
  const retenirMentions = (ligne, pings) =>
    (pings?.cibles ?? []).map(cible => ({
      sql: 'INSERT INTO discord_mentions (team_id, sujet, cible, ligne_id, cree_le) VALUES (?, ?, ?, ?, ?) ON CONFLICT (team_id, sujet, cible) DO NOTHING',
      params: [ligne.team_id, pings.sujet, cible, ligne.id, iso(t)],
    }));

  /** MP du bot : salon privé (POST /users/@me/channels) puis message, avec un nonce (réessai sans doublon). */
  async function envoyerMp(discordId, charge, ligneId) {
    const salon = await appelerDiscord(fetchDiscord, `${API_DISCORD}/users/@me/channels`, { recipient_id: discordId }, { jetonBot, lireCorps: true });
    if (!salon.ok) return salon;
    if (!salon.messageId) return { ok: false, statut: 0, definitif: false, motif: 'Salon privé Discord sans identifiant' };
    return appelerDiscord(fetchDiscord, `${API_DISCORD}/channels/${salon.messageId}/messages`, { ...charge, ...(await nonceEnvoi(ligneId, `mp:${discordId}`)) }, { jetonBot, lireCorps: true });
  }

  /**
   * Étape « MP » d'un message d'occurrence du bot (avant le salon) : relance (RSVP manquant, /relancer) ou message
   * qui ne concerne qu'UN convoqué (sans rôle) → un MP à chaque joueur visé, dans sa langue, si la team garde
   * « Relances par MP ». Chaque MP réussi est retenu (`discord_mp_envois`) : un réessai ne le renvoie pas.
   * MP impossible (compte non lié, MP fermés : 50007…) → journal, Réglages › Discord, et repli dans le salon
   * pour ces joueurs seulement (`mp_bilan`), avec au plus une mention par événement.
   * Rend 'suite' (passer au salon) ou 'stop' (tâche terminée, reportée ou abandonnée).
   */
  async function phaseMp(ligne, { team, cleBlocage }) {
    const deja = bilanMp(ligne);
    if (deja) {
      if (deja.size > 0) return 'suite';
      await terminer(ligne);
      return 'stop';
    }
    if (!(await relancesMpActives(base, ligne.team_id))) return 'suite';
    const v = jsonOu(ligne.variables, {});
    const c = await contexteOccurrence(base, ligne.team_id, v.evenementId, v.occurrence, t);
    // Événement disparu, réunion staff : le salon décidera (abandon), comme avant.
    if (!c || c.staff) return 'suite';
    const relance = estRelance(ligne.cle);
    const cibles = relance ? c.sansReponse : c.convoques;
    if (cibles.length === 0) return 'suite';
    // Seuil « joueur seul » : un message qui ne concerne qu'UN convoqué, sans rôle à mentionner, part en MP ;
    // dès deux convoqués (ou avec un rôle), c'est une annonce d'équipe : elle reste dans le salon.
    const seul = c.convoques.length === 1 && !ligne.role_mention && (await pingActif(base, ligne.team_id, c.occurrence.type));
    if (!relance && !seul) return 'suite';
    const envoyes = new Set((await base.tous('SELECT discord_user_id FROM discord_mp_envois WHERE ligne_id = ?', [ligne.id])).map(l => l.discord_user_id));
    const echecs = [];
    const vus = new Set();
    for (const m of cibles) {
      if (!m.discordId) {
        echecs.push(m.compte);
        continue;
      }
      // Deux comptes avec le même Discord : un seul MP.
      if (vus.has(m.discordId)) continue;
      vus.add(m.discordId);
      if (envoyes.has(m.discordId)) continue;
      const charge = await chargeMp(base, ligne, c, m, { team, lienApp, t, langue: await langueCompte(base, m.compte) });
      const r = await envoyerMp(m.discordId, charge, ligne.id);
      if (r.ok) {
        await base.lot([
          { sql: 'INSERT INTO discord_mp_envois (ligne_id, discord_user_id, team_id, compte_id, message_id, envoye_le) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (ligne_id, discord_user_id) DO NOTHING', params: [ligne.id, m.discordId, ligne.team_id, m.compte, r.messageId ?? null, iso(t)] },
          { sql: 'DELETE FROM discord_injoignables WHERE team_id = ? AND compte_id = ?', params: [ligne.team_id, m.compte] },
        ]);
        continue;
      }
      if (r.statut === 401) {
        // Jeton du bot refusé : rien ne partira, ni en MP ni dans le salon.
        await echouer(ligne, r, { table: 'discord_serveurs', cleBlocage });
        return 'stop';
      }
      // 429 (on attend Discord) ou panne passagère : réessai de la tâche ; les MP déjà partis ne repartent pas.
      if (r.statut === 429 || (!r.definitif && Number(ligne.essais) + 1 < ESSAIS_MAX)) {
        await echouer(ligne, r, { cleBlocage });
        return 'stop';
      }
      echecs.push(m.compte);
      const motif = motifMp(r);
      // Refus de Discord (MP fermés…) : le joueur a une action à faire (Réglages › Discord). Pannes répétées : journal seulement.
      if (r.definitif) {
        await base.executer(
          `INSERT INTO discord_injoignables (team_id, compte_id, discord_user_id, motif, depuis_le, maj_le) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (team_id, compte_id) DO UPDATE SET discord_user_id = excluded.discord_user_id, motif = excluded.motif, maj_le = excluded.maj_le`,
          [ligne.team_id, m.compte, m.discordId, motif, iso(t), iso(t)],
        );
      }
      await consigner(base, ligne, 'discord.dm_failed', { compte: m.compte, motif, code: r.code ?? null, statut: r.statut }, t);
    }
    ligne.mp_bilan = JSON.stringify({ echecs: [...new Set(echecs)] });
    const retenir = { sql: 'UPDATE discord_file SET mp_bilan = ?, maj_le = ? WHERE id = ?', params: [ligne.mp_bilan, iso(t), ligne.id] };
    if (echecs.length === 0) {
      // Tout le monde a reçu son MP : rien dans le salon.
      await terminer(ligne, { lot: [retenir] });
      return 'stop';
    }
    await base.lot([retenir]);
    return 'suite';
  }

  /** Annonce d'une occurrence par le bot : retenue pour être éditée quand les réponses changent. */
  function retenirAnnonce(ligne, prepare, salonId, messageId, langue) {
    return {
      sql: `INSERT INTO discord_annonces (evenement_id, occurrence, team_id, salon_id, message_id, cle, cree_le, maj_le, langue, fr_salon_id, fr_message_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
            ON CONFLICT (evenement_id, occurrence) DO UPDATE SET salon_id = excluded.salon_id, message_id = excluded.message_id, cle = excluded.cle, maj_le = excluded.maj_le,
              langue = excluded.langue, fr_salon_id = NULL, fr_message_id = NULL`,
      params: [prepare.contexte.ev.id, prepare.contexte.occurrence.cle, ligne.team_id, salonId, messageId, prepare.genre, iso(t), iso(t), langue],
    };
  }
  const annoncable = (bot, prepare) => bot && prepare.contexte && !['rsvp_missing', 'rsvp_relance'].includes(prepare.genre);

  /** État du fil français vu dans Réglages › Discord (dernier fil créé, dernier échec et son motif). */
  const etatFil = (teamId, motif) =>
    motif
      ? {
          sql: `INSERT INTO discord_bilingue (team_id, fil_fr, dernier_echec_fil_le, dernier_echec_fil_motif, maj_le) VALUES (?, 1, ?, ?, ?)
                ON CONFLICT (team_id) DO UPDATE SET dernier_echec_fil_le = excluded.dernier_echec_fil_le, dernier_echec_fil_motif = excluded.dernier_echec_fil_motif`,
          params: [teamId, iso(t), motif, iso(t)],
        }
      : {
          sql: `INSERT INTO discord_bilingue (team_id, fil_fr, dernier_fil_le, maj_le) VALUES (?, 1, ?, ?)
                ON CONFLICT (team_id) DO UPDATE SET dernier_fil_le = excluded.dernier_fil_le`,
          params: [teamId, iso(t), iso(t)],
        };

  /**
   * Fil impossible (bot absent, permission ou accès manquant) : le message anglais est déjà parti ; PAS de
   * second message en français. Une alerte mentionne le Fondateur dans le salon, au plus une par salon et
   * par 24 h ; l'état est gardé pour Réglages › Discord et le journal.
   */
  async function filImpossible(ligne, { motif, statut, bot, url, salonId, team }) {
    const texte = texteMotifFil(motif, statut);
    await consigner(base, ligne, 'discord.french_thread_unavailable', { motif: texte }, t);
    const salon = salonId ?? `webhook:${ligne.team_id}`;
    if (await alerteFilPermise(base, salon, t)) {
      const fondateurId = await discordFondateur(base);
      if (!fondateurId) await consigner(base, ligne, 'discord.founder_discord_missing', { motif: 'Discord ID du Fondateur non renseigné : alerte sans mention' }, t);
      let charge = chargeAlerteFil({ motif, statut, fondateurId, team: { nom: team.nom, logo: team.logo_url }, maintenant: t });
      // Par le bot, il faut son jeton et un salon connu ; sinon (webhook), l'alerte passe par le webhook du message.
      const parBot = bot && jetonBot && salonId;
      if (parBot) {
        const { username: _u, ...reste } = charge;
        charge = reste;
      }
      const r = parBot
        ? await appelerDiscord(fetchDiscord, `${API_DISCORD}/channels/${salonId}/messages`, charge, { jetonBot })
        : bot
          ? { ok: false, motif: 'Bot Discord non configuré sur le serveur (DISCORD_BOT_TOKEN)' }
          : await appelerDiscord(fetchDiscord, url, charge);
      if (r.ok) {
        await base.executer(
          `INSERT INTO discord_alertes_fil (salon_id, team_id, motif, alerte_le) VALUES (?, ?, ?, ?)
           ON CONFLICT (salon_id) DO UPDATE SET team_id = excluded.team_id, motif = excluded.motif, alerte_le = excluded.alerte_le`,
          [salon, ligne.team_id, motif, iso(t)],
        );
      } else {
        await consigner(base, ligne, 'discord.french_alert_failed', { motif: r.motif }, t);
      }
    }
    await terminer(ligne, { erreur: texte, lot: [etatFil(ligne.team_id, texte)] });
  }

  /** Message bilingue : anglais (étape 1), fil (étape 2), français dans le fil (étape 3). */
  async function envoyerBilingue(ligne, { bot, url, charge, prepare, team, table, cible, cleBlocage }) {
    const v = jsonOu(ligne.variables, {});
    let messageId = ligne.message_id ?? null;
    let salonId = ligne.message_salon_id ?? null;
    let filId = ligne.fil_id ?? null;
    const salonBot = ligne.salon_id || cible.salon_id || null;

    // Étape 1 : le message anglais (mentions comprises).
    if (!messageId) {
      let r = bot
        ? await appelerDiscord(fetchDiscord, url, { ...charge, ...(await nonceEnvoi(ligne.id, 'en')) }, { jetonBot, lireCorps: true })
        : await appelerDiscord(fetchDiscord, avecParams(url, { wait: 'true' }), charge, { lireCorps: true });
      let forum = false;
      if (!bot && r.statut === 400 && r.code === 220001) {
        // Salon forum : le message anglais ouvre un post (titre anglais) ; le français y répondra.
        r = await appelerDiscord(fetchDiscord, avecParams(url, { wait: 'true' }), { ...charge, thread_name: nomPost(charge) }, { lireCorps: true });
        forum = r.ok;
      }
      if (!r.ok) return echouer(ligne, r, { table, cleBlocage });
      const succes = table ? [{ sql: `UPDATE ${table} SET dernier_succes_le = ?, bloque_jusqua = NULL WHERE team_id = ?`, params: [iso(t), ligne.team_id] }] : [];
      if (!r.messageId) {
        // Réponse sans identifiant (rare) : l'anglais est parti, impossible d'y accrocher un fil.
        await terminer(ligne, { erreur: 'Version française non publiée : identifiant du message absent', lot: [...succes, ...retenirMentions(ligne, prepare.pings)] });
        return;
      }
      messageId = r.messageId;
      salonId = r.salonId ?? (bot ? salonBot : null);
      // Post de forum : le message de départ porte l'identifiant du post (son fil).
      if (forum) filId = r.salonId ?? messageId;
      await base.lot([
        { sql: 'UPDATE discord_file SET message_id = ?, message_salon_id = ?, fil_id = ?, maj_le = ? WHERE id = ?', params: [messageId, salonId, filId, iso(t), ligne.id] },
        ...succes,
        ...retenirMentions(ligne, prepare.pings),
        ...(annoncable(bot, prepare) ? [retenirAnnonce(ligne, prepare, salonId, messageId, 'en')] : []),
      ]);
    }

    // Version française : même message, traduit, sans aucune mention.
    const ligneFr = { ...ligne, modele: v._fil.modele ?? ligne.modele, variables: JSON.stringify({ ...(v._fil.variables ?? {}), _langue: 'fr' }) };
    const fr = await chargeDeLigne(base, ligneFr, { team, bot, lienApp, t, mentions: false });
    if (fr.abandon) {
      await terminer(ligne, { erreur: fr.silencieux ? null : fr.abandon });
      return;
    }
    let chargeFr = fr.charge;
    if (bot) {
      const { username: _u, ...reste } = chargeFr;
      chargeFr = reste;
    }
    const refus = async (r, etape) => filImpossible(ligne, { motif: motifRefusFil(r, etape), statut: r.statut, bot, url, salonId, team });
    const plusTard = r =>
      echouer(ligne, r, {
        cleBlocage,
        // Réessais épuisés : l'anglais reste, la version française est perdue (journal), sans alerte.
        apresMax: () => terminer(ligne, { erreur: `Version française non publiée : ${r.motif}`, lot: [etatFil(ligne.team_id, `Version française non publiée : ${r.motif}`)] }),
      });

    // Étape 2 : le fil, créé par le bot sur le message anglais.
    if (!filId) {
      if (!jetonBot || !salonId) return filImpossible(ligne, { motif: jetonBot ? 'acces' : 'bot_absent', bot, url, salonId, team });
      const r = await appelerDiscord(fetchDiscord, `${API_DISCORD}/channels/${salonId}/messages/${messageId}/threads`, { name: nomFil(chargeFr), auto_archive_duration: ARCHIVAGE_FIL_MIN }, { jetonBot, lireCorps: true });
      if (r.ok || r.code === 160004) {
        // Un fil ouvert sur un message porte l'identifiant de ce message (160004 : déjà créé, réessai).
        filId = (r.ok && r.messageId) || messageId;
        await base.executer('UPDATE discord_file SET fil_id = ?, maj_le = ? WHERE id = ?', [filId, iso(t), ligne.id]);
      } else if (r.definitif) {
        return refus(r, 'creer');
      } else {
        return plusTard(r);
      }
    }

    // Étape 3 : la version française dans le fil (boutons RSVP compris : ils marchent aussi là).
    const r = bot
      ? await appelerDiscord(fetchDiscord, `${API_DISCORD}/channels/${filId}/messages`, { ...chargeFr, ...(await nonceEnvoi(ligne.id, 'fr')) }, { jetonBot, lireCorps: true })
      : await appelerDiscord(fetchDiscord, avecParams(url, { wait: 'true', thread_id: filId }), chargeFr, { lireCorps: true });
    if (r.ok) {
      const lot = [etatFil(ligne.team_id, null)];
      if (annoncable(bot, prepare) && r.messageId) {
        lot.push({ sql: 'UPDATE discord_annonces SET fr_salon_id = ?, fr_message_id = ? WHERE evenement_id = ? AND occurrence = ? AND team_id = ?', params: [filId, r.messageId, prepare.contexte.ev.id, prepare.contexte.occurrence.cle, ligne.team_id] });
      }
      await terminer(ligne, { lot });
      return;
    }
    if (r.definitif) return refus(r, 'ecrire');
    return plusTard(r);
  }

  for (const ligne of dues) {
    const bot = ligne.canal === 'bot';
    const cleBlocage = `${bot ? 'bot' : 'webhook'}:${ligne.team_id}`;
    if (teamsBloquees.has(cleBlocage)) continue;
    // Bail : un seul traitement à la fois par message (requête et cron simultanés).
    const pris = await base.executer(
      "UPDATE discord_file SET verrou_jusqua = ? WHERE id = ? AND statut = 'attente' AND (verrou_jusqua IS NULL OR verrou_jusqua < ?)",
      [iso(t + BAIL_MS), ligne.id, iso(t)],
    );
    if (pris.changements !== 1) continue;

    // Message anglais déjà parti (envoi bilingue en cours) : on ne l'« abandonne » jamais, l'envoi est fini
    // sans sa version française, avec le motif.
    const commence = Boolean(ligne.message_id);
    const arreter = (motif, options) => (commence ? terminer(ligne, { erreur: `Version française non publiée : ${motif}` }) : abandonner(ligne, motif, options));
    if (Date.parse(ligne.expire_le) <= t) {
      if (commence) await terminer(ligne, { erreur: 'Version française non publiée : message périmé' });
      else await abandonner(ligne, 'Message périmé (trop ancien pour être utile)', { journal: ligne.operation !== 'editer' });
      continue;
    }
    const team = await base.premier('SELECT nom, logo_url FROM teams WHERE id = ? AND supprimee_le IS NULL AND archivee_le IS NULL', [ligne.team_id]);
    // Webhook propre (salon dédié aux ressources) : pas de ligne de suivi dans discord_webhooks.
    const propre = !bot && Boolean(ligne.webhook_chiffre);
    const cible = bot ? await serveurBot(base, ligne.team_id) : propre ? {} : await base.premier('SELECT * FROM discord_webhooks WHERE team_id = ?', [ligne.team_id]);
    const table = bot ? 'discord_serveurs' : propre ? null : 'discord_webhooks';
    if (!team || !cible) {
      await arreter(bot ? 'Team ou serveur Discord délié' : 'Team ou webhook supprimé', { journal: false });
      continue;
    }
    if (!(await modulesActifs(base, ligne.team_id)).has('discord')) {
      await arreter('Module Discord désactivé', { journal: false });
      continue;
    }
    if (cible.bloque_jusqua && Date.parse(cible.bloque_jusqua) > t) {
      await base.executer('UPDATE discord_file SET prochain_essai_le = ?, verrou_jusqua = NULL WHERE id = ?', [cible.bloque_jusqua, ligne.id]);
      bilan.reportes++;
      teamsBloquees.add(cleBlocage);
      continue;
    }
    let url;
    let methode = 'POST';
    let annonce = null;
    if (bot) {
      if (!jetonBot) {
        await arreter('Bot Discord non configuré sur le serveur (DISCORD_BOT_TOKEN)');
        continue;
      }
      if (ligne.operation === 'editer') {
        const v = jsonOu(ligne.variables, {});
        annonce = await base.premier('SELECT * FROM discord_annonces WHERE evenement_id = ? AND occurrence = ? AND team_id = ?', [v.evenementId, v.occurrence, ligne.team_id]);
        if (!annonce) {
          await abandonner(ligne, 'Annonce introuvable', { journal: false });
          continue;
        }
        url = `${API_DISCORD}/channels/${annonce.salon_id}/messages/${annonce.message_id}`;
        methode = 'PATCH';
      } else {
        url = `${API_DISCORD}/channels/${ligne.salon_id || cible.salon_id}/messages`;
      }
    } else {
      url = await dechiffrerWebhook(cle, ligne.team_id, propre ? ligne.webhook_chiffre : cible.url_chiffree);
      if (!url) {
        if (commence) await terminer(ligne, { erreur: 'Version française non publiée : adresse du webhook illisible' });
        else await abandonner(ligne, 'Adresse du webhook illisible (clé de chiffrement changée ?) : saisissez-la à nouveau');
        continue;
      }
    }

    // Relance, ou message d'un joueur seul : d'abord les MP (repli dans le salon pour qui n'a pas pu être joint).
    const occurrenceBot = bot && methode === 'POST' && !commence && CLES_OCCURRENCE.includes(ligne.cle);
    if (occurrenceBot && (await phaseMp(ligne, { team, cleBlocage })) === 'stop') continue;
    const prepare = await chargeDeLigne(base, ligne, { team, bot, lienApp, t });
    if (prepare.abandon) {
      if (commence) await terminer(ligne, { erreur: prepare.silencieux ? null : prepare.abandon });
      else await abandonner(ligne, prepare.abandon, { journal: false });
      continue;
    }
    let charge = prepare.charge;
    if (bot) {
      // API du bot : pas de nom d'expéditeur ; une édition ne touche ni au texte ni aux mentions.
      const { username: _u, ...reste } = charge;
      charge = methode === 'PATCH' ? { embeds: reste.embeds, components: reste.components ?? [], allowed_mentions: { parse: [] } } : reste;
    }
    const fil = jsonOu(ligne.variables, {})._fil;
    if (methode === 'POST' && fil && typeof fil === 'object') {
      await envoyerBilingue(ligne, { bot, url, charge, prepare, team, table, cible, cleBlocage });
      continue;
    }
    const resultat = await appelerDiscord(fetchDiscord, url, charge, { methode, jetonBot: bot ? jetonBot : undefined, lireCorps: bot && methode === 'POST' });

    if (resultat.ok) {
      const lot = [...(table ? [{ sql: `UPDATE ${table} SET dernier_succes_le = ?, bloque_jusqua = NULL WHERE team_id = ?`, params: [iso(t), ligne.team_id] }] : []), ...retenirMentions(ligne, prepare.pings)];
      if (methode === 'POST' && resultat.messageId && annoncable(bot, prepare)) {
        lot.push(retenirAnnonce(ligne, prepare, ligne.salon_id || cible.salon_id, resultat.messageId, lireLangue(jsonOu(ligne.variables, {})._langue) ?? 'fr'));
      }
      if (methode === 'PATCH' && annonce?.fr_message_id && annonce?.fr_salon_id) {
        // Annonce bilingue : la version française du fil est rééditée aussi (au mieux : un échec n'annule rien).
        const v = jsonOu(ligne.variables, {});
        const fr = await chargeDeLigne(base, { ...ligne, variables: JSON.stringify({ ...v, _langue: 'fr' }) }, { team, bot, lienApp, t, mentions: false });
        if (fr.charge) {
          await appelerDiscord(fetchDiscord, `${API_DISCORD}/channels/${annonce.fr_salon_id}/messages/${annonce.fr_message_id}`, { embeds: fr.charge.embeds, components: fr.charge.components ?? [], allowed_mentions: { parse: [] } }, { methode: 'PATCH', jetonBot });
        }
      }
      await terminer(ligne, { lot });
      continue;
    }
    await echouer(ligne, resultat, { table, cleBlocage, methode });
  }

  // Ménage : envois terminés depuis plus de 30 jours, rappels, annonces et alertes très anciens.
  await base.executer("DELETE FROM discord_file WHERE statut != 'attente' AND maj_le < ?", [iso(t - CONSERVATION_MS)]);
  await base.executer('DELETE FROM discord_rappels WHERE cree_le < ?', [iso(t - 2 * CONSERVATION_MS)]);
  await base.executer('DELETE FROM discord_debuts WHERE cree_le < ?', [iso(t - 2 * CONSERVATION_MS)]);
  await base.executer('DELETE FROM discord_annonces WHERE maj_le < ?', [iso(t - 2 * CONSERVATION_MS)]);
  await base.executer('DELETE FROM discord_alertes_fil WHERE alerte_le < ?', [iso(t - CONSERVATION_MS)]);
  await base.executer('DELETE FROM discord_mp_envois WHERE envoye_le < ?', [iso(t - CONSERVATION_MS)]);
  await base.executer('DELETE FROM discord_mentions WHERE cree_le < ?', [iso(t - 2 * CONSERVATION_MS)]);
  return bilan;
}
