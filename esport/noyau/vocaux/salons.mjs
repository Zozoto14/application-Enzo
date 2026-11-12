/**
 * Salons vocaux temporaires : état en base (`vocaux_salons`), surcharges de permissions, actions du propriétaire et
 * panneau de contrôle. Partagé par le moteur (événements de la Gateway, processus meneur) et par les interactions
 * (boutons, fenêtres, /voc : n'importe quel processus de l'app) : tout l'état utile est EN BASE (propriétaire, liste
 * d'amis, verrouillage, personnes présentes), jamais seulement en mémoire.
 *
 * Verrouiller = refuser « Se connecter » à @everyone, l'accorder au propriétaire, à sa liste d'amis, aux rôles du staff
 * (et, salon d'équipe de tournoi, au rôle de l'équipe et aux rôles autorisés du hub) ; déverrouiller = revenir aux
 * surcharges du hub. Les surcharges sont toujours RECALCULÉES depuis l'état (une seule requête PATCH du salon).
 */

import { iso, jsonOu } from '../outils.mjs';
import { rest } from '../tickets/discord.mjs';
import { LIMITES_VOCAUX, nettoyerNom } from './reglages.mjs';
import { libelleVocal, tv, tv2 } from './textes.mjs';

/** Bits de permissions Discord utiles ici. */
export const PV = Object.freeze({
  GERER_SALONS: 1n << 4n,
  FLUX: 1n << 9n,
  VOIR: 1n << 10n,
  ENVOYER: 1n << 11n,
  INTEGRER: 1n << 14n,
  HISTORIQUE: 1n << 16n,
  CONNECTER: 1n << 20n,
  PARLER: 1n << 21n,
  DEPLACER: 1n << 24n,
  VAD: 1n << 25n,
  GERER_ROLES: 1n << 28n,
});
/** Droits du bot dans un salon temporaire (déplacer, renommer, écrire le panneau dans le salon). */
export const DROITS_BOT_VOCAL = PV.VOIR | PV.CONNECTER | PV.DEPLACER | PV.GERER_SALONS | PV.ENVOYER | PV.INTEGRER | PV.HISTORIQUE;
const ENTRER = PV.VOIR | PV.CONNECTER;
/**
 * Accès « passe-partout » (rôle Goat, docs/esport/vocaux.md) : voir, se connecter, parler, partager l'écran, détection
 * de la voix. JAMAIS déplacer, couper le micro ou le son, gérer le salon ni gérer les rôles : le rôle n'a que ces
 * surcharges de salon, aucune permission de serveur.
 */
export const DROITS_PASSE_PARTOUT = PV.VOIR | PV.CONNECTER | PV.PARLER | PV.FLUX | PV.VAD;

/** Refus lisible (clé de textes.mjs) : rendu en message éphémère. */
export class RefusVocal extends Error {
  constructor(cle, vars = {}) {
    super(cle);
    this.cle = cle;
    this.vars = vars;
  }
}

export const nomMembre = m => String(m?.nick || m?.user?.global_name || m?.user?.username || '').slice(0, 100);
const tableau = v => {
  const a = jsonOu(v, []);
  return Array.isArray(a) ? a : [];
};

/** Ligne de base → objet. */
export function salonLu(l) {
  if (!l) return null;
  return {
    salonId: l.salon_id,
    guildId: l.guild_id,
    hubId: l.hub_id,
    proprietaireId: l.proprietaire_id ?? null,
    proprietaireNom: l.proprietaire_nom ?? '',
    nom: l.nom ?? '',
    verrouille: Number(l.verrouille) === 1,
    limite: Number(l.limite) || 0,
    amis: tableau(l.amis).filter(a => a && typeof a.id === 'string'),
    occupants: tableau(l.occupants).filter(o => o && typeof o.id === 'string'),
    basePermissions: tableau(l.base_permissions),
    panneauId: l.panneau_id ?? null,
    tournoiId: l.tournoi_id ?? null,
    equipeId: l.equipe_id ?? null,
    videDepuis: l.vide_depuis ?? null,
    creeLe: l.cree_le,
  };
}

export async function lireSalon(base, salonId) {
  if (!salonId) return null;
  return salonLu(await base.premier('SELECT * FROM vocaux_salons WHERE salon_id = ?', [String(salonId)]));
}

export async function salonsDuServeur(base, guildId) {
  return (await base.tous('SELECT * FROM vocaux_salons WHERE guild_id = ? ORDER BY cree_le', [guildId])).map(salonLu);
}

/** Salons où cette personne est notée présente (recherche dans le JSON, puis vérification exacte). */
export async function salonsAvecOccupant(base, userId) {
  const lignes = await base.tous('SELECT * FROM vocaux_salons WHERE occupants LIKE ?', [`%"${userId}"%`]);
  return lignes.map(salonLu).filter(s => s.occupants.some(o => o.id === userId));
}

/** Salons des hubs ordinaires (hors salons des hubs d'événement) dont cette personne est propriétaire. */
export async function salonsDuProprietaire(base, guildId, userId) {
  return (await base.tous('SELECT * FROM vocaux_salons WHERE guild_id = ? AND proprietaire_id = ? AND equipe_id IS NULL AND tournoi_id IS NULL ORDER BY cree_le', [guildId, userId])).map(salonLu);
}

/** Enregistre les champs modifiables d'un salon. */
export async function ecrireSalon(base, s, t) {
  await base.executer(
    'UPDATE vocaux_salons SET proprietaire_id = ?, proprietaire_nom = ?, nom = ?, verrouille = ?, limite = ?, amis = ?, occupants = ?, panneau_id = ?, vide_depuis = ?, maj_le = ? WHERE salon_id = ?',
    [s.proprietaireId, s.proprietaireNom ?? '', s.nom ?? '', s.verrouille ? 1 : 0, s.limite ?? 0, JSON.stringify(s.amis ?? []), JSON.stringify(s.occupants ?? []), s.panneauId ?? null, s.videDepuis ?? null, iso(t), s.salonId],
  );
}

export async function insererSalon(base, s, t) {
  await base.executer(
    'INSERT INTO vocaux_salons (salon_id, guild_id, hub_id, proprietaire_id, proprietaire_nom, nom, verrouille, limite, amis, occupants, base_permissions, panneau_id, tournoi_id, equipe_id, vide_depuis, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [s.salonId, s.guildId, s.hubId, s.proprietaireId, s.proprietaireNom ?? '', s.nom ?? '', s.verrouille ? 1 : 0, s.limite ?? 0, JSON.stringify(s.amis ?? []), JSON.stringify(s.occupants ?? []), JSON.stringify(s.basePermissions ?? []), s.panneauId ?? null, s.tournoiId ?? null, s.equipeId ?? null, s.videDepuis ?? null, iso(t), iso(t)],
  );
}

/** Panneau publié : seul `panneau_id` est écrit (les présences, écrites en même temps par la file, restent). */
export async function noterPanneau(base, salonId, panneauId, t) {
  await base.executer('UPDATE vocaux_salons SET panneau_id = ?, maj_le = ? WHERE salon_id = ?', [panneauId, iso(t), salonId]);
}

export const supprimerLigne = (base, salonId) => base.executer('DELETE FROM vocaux_salons WHERE salon_id = ?', [salonId]);

/**
 * Surcharges du salon, recalculées depuis son état. `ctx` : `guildId`, `botId`, `rolesStaff`, `rolesEquipe` (rôle de
 * l'équipe et rôles autorisés du hub, salon de tournoi), `visibleNonJoignable` (option du hub).
 *
 * Salon VERROUILLÉ (dont tout salon d'équipe) : les personnes sans accès (@everyone et les rôles des surcharges de
 * départ, celles du hub) ont « Se connecter » refusé ; « Voir le salon » leur est REFUSÉ (salon caché, par défaut) ou,
 * avec l'option « visibles mais pas joignables », ACCORDÉ — sauf si le hub le refusait déjà à @everyone (catégorie
 * privée : on n'élargit pas). Rôles autorisés, propriétaire, amis, staff, rôle de l'équipe et bot : voir et se
 * connecter. Salon ouvert : surcharges du hub, plus le propriétaire et le bot.
 */
export function surchargesSalon(s, { guildId, botId, rolesStaff = [], rolesEquipe = [], rolesPasse = [], visibleNonJoignable = false }) {
  const m = new Map();
  for (const o of s.basePermissions ?? []) {
    if (!o?.id) continue;
    m.set(o.id, { id: String(o.id), type: Number(o.type) === 1 ? 1 : 0, allow: BigInt(o.allow ?? '0'), deny: BigInt(o.deny ?? '0') });
  }
  const regler = (id, type, allow = 0n, deny = 0n) => {
    const o = m.get(id) ?? { id, type, allow: 0n, deny: 0n };
    o.allow = (o.allow | allow) & ~deny;
    o.deny = (o.deny | deny) & ~allow;
    m.set(id, o);
  };
  if (s.verrouille) {
    const passe = rolesPasse.filter(r => r && r !== guildId);
    const admis = new Set([...rolesStaff, ...rolesEquipe, ...passe].filter(Boolean));
    const cachePrive = ((m.get(guildId)?.deny ?? 0n) & PV.VOIR) !== 0n;
    const sansAcces = id => {
      if (visibleNonJoignable && !cachePrive) regler(id, 0, PV.VOIR, PV.CONNECTER);
      else regler(id, 0, 0n, PV.VOIR | PV.CONNECTER);
    };
    sansAcces(guildId);
    for (const o of [...m.values()]) if (o.type === 0 && o.id !== guildId && !admis.has(o.id)) sansAcces(o.id);
    for (const r of admis) if (r !== guildId) regler(r, 0, ENTRER);
    for (const a of s.amis ?? []) regler(a.id, 1, ENTRER);
  }
  // Passe-partout : l'autorisation du rôle l'emporte sur les refus de @everyone, de la catégorie et du verrouillage (le
  // salon peut être verrouillé, ces rôles y entrent). Ajoutée en dernier : seules les droits ci-dessus, rien d'autre.
  for (const r of rolesPasse) if (r && r !== guildId) regler(r, 0, DROITS_PASSE_PARTOUT);
  if (s.proprietaireId) regler(s.proprietaireId, 1, ENTRER);
  if (botId) regler(botId, 1, DROITS_BOT_VOCAL);
  return [...m.values()].map(o => ({ id: o.id, type: o.type, allow: o.allow.toString(), deny: o.deny.toString() }));
}

/** Erreur Discord → refus lisible (429 sur un renommage : délai en minutes). */
function refusDiscord(r, { renommage = false } = {}) {
  if (r.statut === 429 && renommage) return new RefusVocal('renommer_limite', { minutes: Math.max(1, Math.ceil((r.retryApresS ?? 600) / 60)) });
  if (r.statut === 404 || r.code === 10003) return new RefusVocal('pas_salon');
  return new RefusVocal('discord_refus', { statut: r.code ?? r.statut ?? 0 });
}

/**
 * Contexte d'une action : `base`, `fetch`, `jetonBot`, `maintenant`, `botId`, `guildId`, `reglages` (vocaux),
 * `mode` (langue des messages des tickets), `rolesEquipe(s)` (async : rôles de l'équipe d'un salon de tournoi).
 */
async function rolesEquipeDe(ctx, s) {
  return (s.equipeId || s.tournoiId) && ctx.rolesEquipe ? await ctx.rolesEquipe(s) : [];
}

/** Option « visibles mais pas joignables » du hub d'un salon. */
export const visibleDe = (reglages, s) => Boolean(reglages?.hubs?.find(h => h.id === s.hubId)?.visibleNonJoignable);

export async function appliquerSurcharges(ctx, s) {
  const surcharges = surchargesSalon(s, { guildId: ctx.guildId, botId: ctx.botId, rolesStaff: ctx.reglages.rolesStaff, rolesEquipe: await rolesEquipeDe(ctx, s), rolesPasse: ctx.reglages.rolesPassePartout ?? [], visibleNonJoignable: visibleDe(ctx.reglages, s) });
  const r = await rest(ctx.fetch, ctx.jetonBot, 'PATCH', `/channels/${s.salonId}`, { permission_overwrites: surcharges }, { raison: 'Esport HQ : salon vocal temporaire' });
  if (!r.ok) throw refusDiscord(r);
  return surcharges;
}

export async function verrouiller(ctx, s, verrou) {
  if (s.equipeId && !verrou) throw new RefusVocal('tournoi_verrou');
  const suivant = { ...s, verrouille: Boolean(verrou) };
  await appliquerSurcharges(ctx, suivant);
  await ecrireSalon(ctx.base, suivant, ctx.maintenant());
  return suivant;
}

export async function renommer(ctx, s, nom) {
  if (s.equipeId) throw new RefusVocal('tournoi_nom');
  const propre = nettoyerNom(nom);
  if (!propre) throw new RefusVocal('nom_invalide');
  const r = await rest(ctx.fetch, ctx.jetonBot, 'PATCH', `/channels/${s.salonId}`, { name: propre }, { raison: 'Esport HQ : renommé par son propriétaire' });
  if (!r.ok) throw refusDiscord(r, { renommage: true });
  const suivant = { ...s, nom: propre };
  await ecrireSalon(ctx.base, suivant, ctx.maintenant());
  return suivant;
}

export async function limiter(ctx, s, places) {
  const n = Number(places);
  if (!Number.isInteger(n) || n < 0 || n > LIMITES_VOCAUX.places) throw new RefusVocal('limite_invalide');
  const r = await rest(ctx.fetch, ctx.jetonBot, 'PATCH', `/channels/${s.salonId}`, { user_limit: n });
  if (!r.ok) throw refusDiscord(r);
  const suivant = { ...s, limite: n };
  await ecrireSalon(ctx.base, suivant, ctx.maintenant());
  return suivant;
}

/** Déconnecte une personne présente (PATCH du membre, salon null) ; retirée de la liste d'amis. */
export async function expulser(ctx, s, cibleId) {
  const present = s.occupants.find(o => o.id === cibleId);
  if (!present) throw new RefusVocal('pas_present', { membre: `<@${cibleId}>` });
  if (cibleId === ctx.botId) throw new RefusVocal('pas_bot');
  const r = await rest(ctx.fetch, ctx.jetonBot, 'PATCH', `/guilds/${ctx.guildId}/members/${cibleId}`, { channel_id: null }, { raison: 'Esport HQ : expulsé du salon vocal temporaire' });
  if (!r.ok) throw refusDiscord(r);
  let suivant = { ...s, occupants: s.occupants.filter(o => o.id !== cibleId) };
  if (s.amis.some(a => a.id === cibleId)) {
    suivant = { ...suivant, amis: s.amis.filter(a => a.id !== cibleId) };
    if (suivant.verrouille) await appliquerSurcharges(ctx, suivant);
  }
  await ecrireSalon(ctx.base, suivant, ctx.maintenant());
  return { salon: suivant, nom: present.nom };
}

/** Ajoute des personnes à la liste d'amis (`personnes` : [{ id, nom, bot? }]). */
export async function ajouterAmis(ctx, s, personnes) {
  const nouvelles = personnes.filter(p => p.id && !p.bot && p.id !== s.proprietaireId && !s.amis.some(a => a.id === p.id));
  if (personnes.length && personnes.every(p => p.bot)) throw new RefusVocal('pas_bot');
  if (s.amis.length + nouvelles.length > LIMITES_VOCAUX.amis) throw new RefusVocal('amis_plein');
  const suivant = { ...s, amis: [...s.amis, ...nouvelles.map(p => ({ id: p.id, nom: String(p.nom ?? '').slice(0, 100) }))] };
  if (nouvelles.length && suivant.verrouille) await appliquerSurcharges(ctx, suivant);
  await ecrireSalon(ctx.base, suivant, ctx.maintenant());
  return suivant;
}

export async function retirerAmi(ctx, s, id) {
  if (!s.amis.some(a => a.id === id)) throw new RefusVocal('pas_ami', { membre: `<@${id}>` });
  const suivant = { ...s, amis: s.amis.filter(a => a.id !== id) };
  if (suivant.verrouille) await appliquerSurcharges(ctx, suivant);
  await ecrireSalon(ctx.base, suivant, ctx.maintenant());
  return suivant;
}

/** Donne la propriété à une personne présente dans le salon. `annoncer` : message dans le salon. */
export async function transferer(ctx, s, cibleId, { annoncer = true } = {}) {
  if (cibleId === s.proprietaireId) throw new RefusVocal('deja_proprietaire', { membre: `<@${cibleId}>` });
  const present = s.occupants.find(o => o.id === cibleId);
  if (!present) throw new RefusVocal('pas_present', { membre: `<@${cibleId}>` });
  const suivant = { ...s, proprietaireId: cibleId, proprietaireNom: present.nom || '' };
  await appliquerSurcharges(ctx, suivant);
  await ecrireSalon(ctx.base, suivant, ctx.maintenant());
  if (annoncer) await annoncerProprietaire(ctx, suivant);
  return suivant;
}

export async function annoncerProprietaire(ctx, s) {
  await rest(ctx.fetch, ctx.jetonBot, 'POST', `/channels/${s.salonId}/messages`, {
    content: tv2('nouveau_proprietaire', { membre: `<@${s.proprietaireId}>` }, { mode: ctx.mode, langue: 'fr', max: 1900 }),
    allowed_mentions: { parse: [], users: [s.proprietaireId] },
  });
}

// ------------------------------------------------------------------ Panneau de contrôle

const bouton = (style, id, cle, opts, desactive = false) => ({ type: 2, style, custom_id: id, label: libelleVocal(cle, opts), ...(desactive ? { disabled: true } : {}) });

/**
 * Message du panneau (dans le salon vocal lui-même, son fil de discussion intégré) : mention du propriétaire, état, et
 * les boutons. Salon d'équipe de tournoi : ni renommer, ni déverrouiller. `opts` : `{ mode, langue, equipe }`.
 */
export function chargePanneau(s, { mode = 'auteur', langue = 'fr', equipe = '' } = {}) {
  const o = { mode, langue };
  const deux = cle => libelleVocal(cle, o);
  // Salon d'équipe (événement) : ni renommer, ni déverrouiller, ni liste d'amis. Salon du staff d'un hub d'événement :
  // contrôles ordinaires.
  const tournoi = Boolean(s.equipeId);
  const description = tournoi ? tv2('panneau_tournoi', { proprietaire: `<@${s.proprietaireId}>`, equipe }, { ...o, max: 1500 }) : tv2('panneau_texte', { proprietaire: `<@${s.proprietaireId}>` }, { ...o, max: 1500 });
  const amis = s.amis.length ? s.amis.slice(0, 15).map(a => `<@${a.id}>`).join(' ') : deux('aucun');
  return {
    content: s.proprietaireId ? `<@${s.proprietaireId}>` : '',
    allowed_mentions: { parse: [], users: s.proprietaireId ? [s.proprietaireId] : [] },
    embeds: [
      {
        title: (s.nom || 'Salon').slice(0, 256),
        description,
        color: 0x5865f2,
        fields: [
          { name: deux('etat_proprietaire'), value: s.proprietaireId ? `<@${s.proprietaireId}>` : deux('aucun'), inline: true },
          { name: deux('etat_acces'), value: deux(s.verrouille ? 'verrouille' : 'ouvert'), inline: true },
          { name: deux('etat_places'), value: s.limite ? String(s.limite) : deux('illimite'), inline: true },
          ...(tournoi ? [] : [{ name: deux('etat_amis'), value: amis.slice(0, 1024), inline: false }]),
        ],
      },
    ],
    components: [
      {
        type: 1,
        components: [
          bouton(2, `vc:r:${s.salonId}`, 'b_renommer', o, tournoi),
          s.verrouille ? bouton(2, `vc:u:${s.salonId}`, 'b_deverrouiller', o, tournoi) : bouton(2, `vc:l:${s.salonId}`, 'b_verrouiller', o),
          bouton(2, `vc:n:${s.salonId}`, 'b_limite', o),
        ],
      },
      {
        type: 1,
        components: [bouton(4, `vc:k:${s.salonId}`, 'b_expulser', o), ...(tournoi ? [] : [bouton(2, `vc:a:${s.salonId}`, 'b_amis', o)]), bouton(2, `vc:t:${s.salonId}`, 'b_transferer', o)],
      },
    ],
  };
}

/** Met à jour le panneau publié (au mieux : un échec ne bloque rien). */
export async function majPanneau(ctx, s, extra = {}) {
  if (!s?.panneauId) return false;
  const c = chargePanneau(s, { mode: ctx.mode, langue: 'fr', ...extra });
  const r = await rest(ctx.fetch, ctx.jetonBot, 'PATCH', `/channels/${s.salonId}/messages/${s.panneauId}`, { embeds: c.embeds, components: c.components, allowed_mentions: { parse: [] } });
  return r.ok;
}

/** Message du salon des journaux (facultatif), sans mention. */
export async function journaliser(ctx, cle, vars) {
  const salon = ctx.reglages?.salonJournaux;
  if (!salon) return;
  await rest(ctx.fetch, ctx.jetonBot, 'POST', `/channels/${salon}/messages`, { content: tv2(cle, vars, { mode: ctx.mode, langue: 'fr', max: 1900 }), allowed_mentions: { parse: [] } }).catch(() => undefined);
}

export { tv };
