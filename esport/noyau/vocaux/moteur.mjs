/**
 * Salons vocaux temporaires : moteur, branché sur la Gateway tenue par le processus meneur (tickets/superviseur.mjs).
 *
 *  - Intent GUILD_VOICE_STATES (1 << 7, non privilégié) : états vocaux mis en cache depuis GUILD_CREATE puis
 *    VOICE_STATE_UPDATE ; salons du serveur depuis GUILD_CREATE et CHANNEL_CREATE / UPDATE / DELETE ;
 *  - rejoindre un hub : salon vocal créé juste en dessous (même catégorie, position suivante, surcharges du hub),
 *    membre déplacé dedans, panneau de contrôle publié dans le salon (mention du propriétaire). Une personne qui a
 *    déjà son salon (« salons par membre » atteint) y est déplacée au lieu d'en créer un autre ;
 *  - quitter : la personne sort de la liste des présents (EN BASE : les interactions, traitées par n'importe quel
 *    processus, la lisent) ; propriétaire parti : propriété transmise à une personne restée (réglable) ; salon vide :
 *    supprimé après le délai réglé (minuterie, et rattrapage à chaque passage du superviseur, toutes les 20 s) ;
 *  - redémarrage : après GUILD_CREATE (nouvelle session), salons connus rapprochés de Discord (disparus oubliés, vides
 *    supprimés, présents et propriétaires resynchronisés) et personnes restées dans un hub servies ; après RESUMED,
 *    Discord rejoue les événements manqués.
 * Les événements sont traités UN PAR UN (file) : deux arrivées rapides dans un hub ne créent pas deux salons.
 * Salons d'équipe de tournoi (hub lié à un tournoi) : `tournoi.mjs` (`gererHubTournoi`, `rolesEquipe`).
 */

import { iso, jsonOu } from '../outils.mjs';
import { rest } from '../tickets/discord.mjs';
import { lireGeneral } from '../tickets/reglages.mjs';
import { lireVocaux, nomSalon } from './reglages.mjs';
import { gererHubTournoi, rolesEquipe } from './tournoi.mjs';
import {
  annoncerProprietaire,
  chargePanneau,
  ecrireSalon,
  insererSalon,
  journaliser,
  lireSalon,
  nomMembre,
  salonsAvecOccupant,
  salonsDuProprietaire,
  salonsDuServeur,
  supprimerLigne,
  surchargesSalon,
  transferer,
} from './salons.mjs';

/** État affiché dans l'app (`tickets_etat`, clé `vocaux`) : dernière erreur, dernier salon créé. */
export async function lireEtatVocaux(base) {
  const l = await base.premier("SELECT valeur, maj_le FROM tickets_etat WHERE cle = 'vocaux'", []);
  return l ? { ...jsonOu(l.valeur, {}), majLe: l.maj_le } : {};
}

async function noterEtat(base, morceau, t) {
  const actuel = await lireEtatVocaux(base);
  delete actuel.majLe;
  await base.executer(
    'INSERT INTO tickets_etat (cle, valeur, maj_le) VALUES (?, ?, ?) ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur, maj_le = excluded.maj_le',
    ['vocaux', JSON.stringify({ ...actuel, ...morceau }), iso(t)],
  );
}

export { INTENT_VOCAL } from '../tickets/bienvenue.mjs';
const VOCAL = 2;

/**
 * Options : `base`, `fetch`, `jetonBot`, `maintenant`, `journal`, `botId()` (identifiant du bot, connu après READY),
 * `delaiMs` (tests : remplace le délai de suppression réglé), `tournoi` (salons d'équipe : `{ hub(ctx, hub, membre),
 * rolesEquipe(salon) }`).
 */
export function creerMoteurVocaux({ base, fetch: fetchDiscord, jetonBot, maintenant = () => Date.now(), journal = console, botId = () => null, delaiMs = null, tournoi = { hub: gererHubTournoi, rolesEquipe } } = {}) {
  const cache = { pret: false, guildId: null, salons: new Map(), vocal: new Map() };
  const minuteries = new Map();
  let file = Promise.resolve();
  let arrete = false;

  /** Ajoute un travail à la file (un à la fois) ; rend sa promesse (erreurs journalisées, jamais propagées). */
  function enFile(travail) {
    const p = file.then(() => (arrete ? undefined : travail()));
    file = p.catch(e => journal.error?.('[esport] vocaux :', e?.message ?? e));
    return file;
  }

  async function contexte() {
    const reglages = await lireVocaux(base);
    const general = await lireGeneral(base);
    const ctx = { base, fetch: fetchDiscord, jetonBot, maintenant, botId: botId(), guildId: general.guildId, reglages, general, mode: general.langue ?? 'auteur', journal, cache };
    if (tournoi?.rolesEquipe) ctx.rolesEquipe = s => tournoi.rolesEquipe(ctx, s);
    return ctx;
  }

  const delaiDe = ctx => (delaiMs ?? Math.max(1, Number(ctx.reglages.delaiSuppressionS) || 15) * 1000);

  async function noterErreur(motif, r, t) {
    await noterEtat(base, { derniereErreur: { motif, statut: r?.statut ?? 0, code: r?.code ?? null, le: iso(t) } }, t).catch(() => undefined);
  }

  // ---------------------------------------------------------------- Suppression des salons vides

  function planifier(ctx, salonId, depuis) {
    const attente = Math.max(0, Date.parse(depuis) + delaiDe(ctx) - ctx.maintenant());
    if (minuteries.has(salonId)) clearTimeout(minuteries.get(salonId));
    const m = setTimeout(() => {
      minuteries.delete(salonId);
      void enFile(async () => supprimerSiVide(await contexte(), salonId));
    }, attente + 20);
    m.unref?.();
    minuteries.set(salonId, m);
  }

  function annuler(salonId) {
    if (minuteries.has(salonId)) clearTimeout(minuteries.get(salonId));
    minuteries.delete(salonId);
  }

  /** Supprime le salon s'il est vide depuis le délai (`force` : tout de suite, rapprochement après redémarrage). */
  async function supprimerSiVide(ctx, salonId, { force = false } = {}) {
    const s = await lireSalon(base, salonId);
    if (!s || (!s.videDepuis && !force) || s.occupants.length) return false;
    const t = ctx.maintenant();
    if (!force && t - Date.parse(s.videDepuis) < delaiDe(ctx) - 50) {
      planifier(ctx, salonId, s.videDepuis);
      return false;
    }
    // Cache complet : quelqu'un est pourtant dedans (événement manqué) → noté présent, pas supprimé.
    const presents = cache.pret ? [...cache.vocal.entries()].filter(([, v]) => v.channelId === salonId) : [];
    if (presents.length) {
      await ecrireSalon(base, { ...s, occupants: presents.map(([id, v]) => ({ id, nom: v.nom })), videDepuis: null }, t);
      return false;
    }
    const r = await rest(fetchDiscord, jetonBot, 'DELETE', `/channels/${salonId}`, undefined, { raison: 'Esport HQ : salon vocal temporaire vide' });
    if (!r.ok && r.statut !== 404 && r.code !== 10003) {
      await noterErreur('suppression', r, t);
      return false;
    }
    annuler(salonId);
    cache.salons.delete(salonId);
    await supprimerLigne(base, salonId);
    await journaliser(ctx, 'j_supprime', { nom: s.nom });
    return true;
  }

  // ---------------------------------------------------------------- Présences

  async function entrer(ctx, s, userId, nom) {
    annuler(s.salonId);
    if (s.occupants.some(o => o.id === userId) && !s.videDepuis) return;
    const occupants = s.occupants.some(o => o.id === userId) ? s.occupants : [...s.occupants, { id: userId, nom }];
    await ecrireSalon(base, { ...s, occupants, videDepuis: null }, ctx.maintenant());
  }

  async function quitter(ctx, s, userId) {
    const t = ctx.maintenant();
    const occupants = s.occupants.filter(o => o.id !== userId);
    if (!occupants.length) {
      const suivant = { ...s, occupants, videDepuis: iso(t) };
      await ecrireSalon(base, suivant, t);
      planifier(ctx, s.salonId, suivant.videDepuis);
      return;
    }
    const suivant = { ...s, occupants };
    await ecrireSalon(base, suivant, t);
    if (userId === s.proprietaireId && ctx.reglages.quandProprietairePart === 'transferer') await transmettre(ctx, suivant);
  }

  /** Propriétaire parti : la propriété passe à la personne arrivée la première parmi celles restées. */
  async function transmettre(ctx, s) {
    const suivant = s.occupants.find(o => o.id !== ctx.botId);
    if (!suivant) return;
    try {
      await transferer(ctx, s, suivant.id);
    } catch (e) {
      // Surcharges refusées : la propriété change quand même (le panneau et /voc suivent la base).
      await ecrireSalon(base, { ...s, proprietaireId: suivant.id, proprietaireNom: suivant.nom }, ctx.maintenant());
      await annoncerProprietaire(ctx, { ...s, proprietaireId: suivant.id }).catch(() => undefined);
      journal.warn?.('[esport] vocaux : transfert', e?.cle ?? e?.message ?? e);
    }
  }

  // ---------------------------------------------------------------- Création depuis un hub

  async function salonDiscord(id) {
    if (cache.salons.has(id)) return cache.salons.get(id);
    const r = await rest(fetchDiscord, jetonBot, 'GET', `/channels/${id}`);
    if (!r.ok || !r.corps) return null;
    cache.salons.set(id, r.corps);
    return r.corps;
  }

  const deplacer = (ctx, userId, salonId) => rest(fetchDiscord, jetonBot, 'PATCH', `/guilds/${ctx.guildId}/members/${userId}`, { channel_id: salonId }, { raison: 'Esport HQ : salon vocal temporaire' });

  /**
   * Crée un salon pour `membre` ({ id, nom }) depuis `hub`. `options` (salon d'équipe) : `{ nom, tournoiId, equipeId,
   * equipe }`. Rend le salon créé (ou null si Discord refuse).
   */
  async function creerSalon(ctx, hub, membre, options = {}) {
    const t = ctx.maintenant();
    const hubSalon = await salonDiscord(hub.id);
    if (!hubSalon) {
      await noterErreur('hub-introuvable', { statut: 404 }, t);
      return null;
    }
    const parent = hub.categorieId ?? hubSalon.parent_id ?? null;
    // Surcharges de départ : celles du hub (en général synchronisées sur sa catégorie), ou de la catégorie choisie.
    const source = hub.categorieId && hub.categorieId !== hubSalon.parent_id ? await salonDiscord(hub.categorieId) : hubSalon;
    const basePermissions = (source?.permission_overwrites ?? []).map(o => ({ id: String(o.id), type: Number(o.type) === 1 ? 1 : 0, allow: String(o.allow ?? '0'), deny: String(o.deny ?? '0') }));
    const nom = options.nom ?? nomSalon(hub.modeleNom, { pseudo: membre.nom || membre.id });
    const s = {
      salonId: null,
      guildId: ctx.guildId,
      hubId: hub.id,
      proprietaireId: membre.id,
      proprietaireNom: membre.nom,
      nom,
      verrouille: Boolean(hub.verrouille || options.tournoiId),
      limite: hub.limite || 0,
      amis: [],
      occupants: [],
      basePermissions,
      tournoiId: options.tournoiId ?? null,
      equipeId: options.equipeId ?? null,
      videDepuis: iso(t),
    };
    const rolesEquipe = s.equipeId && ctx.rolesEquipe ? await ctx.rolesEquipe(s) : [];
    const corps = {
      name: nom,
      type: VOCAL,
      ...(parent ? { parent_id: parent } : {}),
      position: Number(hubSalon.position ?? 0) + 1,
      ...(s.limite ? { user_limit: s.limite } : {}),
      permission_overwrites: surchargesSalon(s, { guildId: ctx.guildId, botId: ctx.botId, rolesStaff: ctx.reglages.rolesStaff, rolesEquipe }),
    };
    const r = await rest(fetchDiscord, jetonBot, 'POST', `/guilds/${ctx.guildId}/channels`, corps, { raison: `Esport HQ : salon vocal temporaire de ${membre.nom || membre.id}`.slice(0, 200) });
    if (!r.ok || !r.corps?.id) {
      await noterErreur('creation', r, t);
      await journaliser(ctx, 'j_echec', { membre: membre.nom || membre.id, statut: r.code ?? r.statut ?? 0 });
      journal.error?.('[esport] vocaux : création refusée par Discord', r.statut, r.code ?? '');
      return null;
    }
    s.salonId = String(r.corps.id);
    cache.salons.set(s.salonId, { ...r.corps, type: VOCAL });
    await insererSalon(base, s, t);
    planifier(ctx, s.salonId, s.videDepuis);
    // Le membre est déplacé dans son salon (son arrivée, VOICE_STATE_UPDATE, le notera présent).
    const d = await deplacer(ctx, membre.id, s.salonId);
    if (!d.ok) journal.warn?.('[esport] vocaux : déplacement refusé', d.statut, d.code ?? '');
    const p = await rest(fetchDiscord, jetonBot, 'POST', `/channels/${s.salonId}/messages`, chargePanneau(s, { mode: ctx.mode, langue: 'fr', equipe: options.equipe ?? '' }));
    if (p.ok && p.corps?.id) {
      const lu = await lireSalon(base, s.salonId);
      if (lu) await ecrireSalon(base, { ...lu, panneauId: String(p.corps.id) }, ctx.maintenant());
    }
    await noterEtat(base, { dernierSalon: { le: iso(t), ok: true } }, t).catch(() => undefined);
    await journaliser(ctx, 'j_cree', { salon: `<#${s.salonId}>`, membre: membre.nom || membre.id });
    return s;
  }

  /** Arrivée dans un hub : son salon existant (déplacé dedans), sinon un nouveau. */
  async function depuisHub(ctx, hub, membre) {
    if (hub.tournoiId) {
      if (tournoi?.hub) await tournoi.hub(ctx, hub, membre, { creerSalon, deplacer, lireSalon });
      return;
    }
    const existants = await salonsDuProprietaire(base, ctx.guildId, membre.id);
    if (existants.length >= Math.max(1, ctx.reglages.maxParMembre || 1)) {
      for (const s of existants) {
        const d = await deplacer(ctx, membre.id, s.salonId);
        if (d.ok) return;
        // Salon disparu (supprimé à la main) : oublié ; autre refus (personne déjà partie…) : rien de plus.
        if (d.statut === 404 || d.code === 10003) await supprimerLigne(base, s.salonId);
        else return;
      }
      // Ses salons ont disparu : on en crée un nouveau.
    }
    await creerSalon(ctx, hub, membre);
  }

  // ---------------------------------------------------------------- Événements

  async function voix(d) {
    const ctx = await contexte();
    if (!ctx.guildId || d?.guild_id !== ctx.guildId) return;
    const userId = String(d.user_id ?? '');
    if (!/^\d{5,25}$/.test(userId) || userId === ctx.botId || d.member?.user?.bot) return;
    const nom = nomMembre(d.member) || cache.vocal.get(userId)?.nom || userId;
    const apres = d.channel_id ? String(d.channel_id) : null;
    if (apres) cache.vocal.set(userId, { channelId: apres, nom, roles: Array.isArray(d.member?.roles) ? d.member.roles : [] });
    else cache.vocal.delete(userId);
    for (const s of await salonsAvecOccupant(base, userId)) if (s.salonId !== apres) await quitter(ctx, s, userId);
    if (!apres) return;
    const s = await lireSalon(base, apres);
    if (s) {
      await entrer(ctx, s, userId, nom);
      return;
    }
    if (!ctx.reglages.actif) return;
    const hub = ctx.reglages.hubs.find(h => h.id === apres);
    if (hub) await depuisHub(ctx, hub, { id: userId, nom, roles: Array.isArray(d.member?.roles) ? d.member.roles : [], permissions: d.member?.permissions ?? null });
  }

  /** Après GUILD_CREATE (ou RESUMED avec un cache complet) : salons connus rapprochés de Discord. */
  async function rapprocher() {
    const ctx = await contexte();
    if (!ctx.guildId || cache.guildId !== ctx.guildId || !cache.pret) return;
    const t = ctx.maintenant();
    for (const s of await salonsDuServeur(base, ctx.guildId)) {
      if (!cache.salons.has(s.salonId)) {
        annuler(s.salonId);
        await supprimerLigne(base, s.salonId);
        continue;
      }
      const presents = [...cache.vocal.entries()].filter(([, v]) => v.channelId === s.salonId).map(([id, v]) => ({ id, nom: s.occupants.find(o => o.id === id)?.nom || v.nom || id }));
      if (!presents.length) {
        await ecrireSalon(base, { ...s, occupants: [], videDepuis: s.videDepuis ?? iso(t) }, t);
        await supprimerSiVide(ctx, s.salonId, { force: true });
        continue;
      }
      // Présents d'abord dans l'ordre déjà connu (le premier arrivé hérite de la propriété).
      const ordre = [...s.occupants.filter(o => presents.some(p => p.id === o.id)), ...presents.filter(p => !s.occupants.some(o => o.id === p.id))];
      const suivant = { ...s, occupants: ordre, videDepuis: null };
      annuler(s.salonId);
      await ecrireSalon(base, suivant, t);
      if ((!s.proprietaireId || !ordre.some(o => o.id === s.proprietaireId)) && ctx.reglages.quandProprietairePart === 'transferer') await transmettre(ctx, suivant);
    }
    // Personnes restées dans un hub pendant que le bot était absent : servies maintenant.
    if (!ctx.reglages.actif) return;
    for (const [userId, v] of [...cache.vocal.entries()]) {
      const hub = ctx.reglages.hubs.find(h => h.id === v.channelId);
      if (hub) await depuisHub(ctx, hub, { id: userId, nom: v.nom || userId, roles: v.roles ?? [] });
    }
  }

  function guildCreate(d) {
    cache.guildId = String(d.id);
    cache.salons = new Map((d.channels ?? []).map(c => [String(c.id), c]));
    const membres = new Map((d.members ?? []).map(m => [String(m.user?.id), m]));
    cache.vocal = new Map();
    for (const v of d.voice_states ?? []) {
      if (!v?.channel_id || !v.user_id) continue;
      const m = v.member ?? membres.get(String(v.user_id));
      if (m?.user?.bot) continue;
      cache.vocal.set(String(v.user_id), { channelId: String(v.channel_id), nom: nomMembre(m) || String(v.user_id), roles: Array.isArray(m?.roles) ? m.roles : [] });
    }
    cache.pret = true;
  }

  async function evenement(type, d) {
    if (arrete) return;
    switch (type) {
      case 'READY':
        // Nouvelle session : le cache sera rempli par GUILD_CREATE.
        cache.pret = false;
        return;
      // Tout passe par la file, dans l'ordre d'arrivée (le cache d'un GUILD_CREATE avant les états vocaux suivants).
      case 'GUILD_CREATE':
        await enFile(async () => {
          const general = await lireGeneral(base);
          if (!d?.id || String(d.id) !== general.guildId) return;
          guildCreate(d);
          await rapprocher();
        });
        return;
      case 'RESUMED':
        await enFile(async () => {
          if (cache.pret) await rapprocher();
        });
        return;
      case 'CHANNEL_CREATE':
      case 'CHANNEL_UPDATE':
        await enFile(async () => {
          if (d?.id) cache.salons.set(String(d.id), d);
        });
        return;
      case 'CHANNEL_DELETE':
        if (!d?.id) return;
        cache.salons.delete(String(d.id));
        await enFile(async () => {
          annuler(String(d.id));
          if (await lireSalon(base, String(d.id))) await supprimerLigne(base, String(d.id));
        });
        return;
      case 'VOICE_STATE_UPDATE':
        await enFile(() => voix(d));
        return;
      default:
    }
  }

  /** Passage du superviseur (toutes les 20 s, meneur) : salons vides arrivés au délai supprimés (rattrapage). */
  async function passage() {
    await enFile(async () => {
      const ctx = await contexte();
      if (!ctx.guildId) return;
      const t = ctx.maintenant();
      for (const s of await salonsDuServeur(base, ctx.guildId)) {
        if (s.occupants.length) continue;
        if (!s.videDepuis) {
          await ecrireSalon(base, { ...s, videDepuis: iso(t) }, t);
          planifier(ctx, s.salonId, iso(t));
        } else if (t - Date.parse(s.videDepuis) >= delaiDe(ctx)) await supprimerSiVide(ctx, s.salonId);
        else if (!minuteries.has(s.salonId)) planifier(ctx, s.salonId, s.videDepuis);
      }
    });
  }

  return {
    evenement,
    passage,
    /** Fin du rôle de meneur (ou arrêt) : minuteries coupées, cache oublié (un autre processus prend le relais). */
    reinitialiser() {
      for (const m of minuteries.values()) clearTimeout(m);
      minuteries.clear();
      cache.pret = false;
      cache.vocal = new Map();
    },
    arreter() {
      arrete = true;
      for (const m of minuteries.values()) clearTimeout(m);
      minuteries.clear();
    },
    /** Tests et diagnostic. */
    etat: () => ({ pret: cache.pret, vocal: cache.vocal.size, salons: cache.salons.size, minuteries: minuteries.size }),
    attendre: () => file,
    cache,
  };
}
