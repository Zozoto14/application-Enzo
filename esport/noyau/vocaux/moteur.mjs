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
 * RAPIDITÉ (docs/esport/vocaux.md, « Rapidité ») : le chemin critique d'une arrivée dans un hub est
 *   VOICE_STATE_UPDATE reçu → POST du salon → PATCH du membre (déplacement), rien d'autre :
 *  - salon du hub, catégorie, surcharges et positions lus dans le cache de la Gateway (GUILD_CREATE, CHANNEL_*),
 *    jamais de GET à Discord sauf s'il manque ;
 *  - l'enregistrement en base part EN MÊME TEMPS que le déplacement (Promise.all) ; un événement qui a besoin de la
 *    ligne (l'arrivée du membre dans son salon) attend cette écriture (`insertions`) ;
 *  - panneau de contrôle, état affiché dans l'app, salon des journaux : APRÈS le déplacement, en parallèle, sans
 *    bloquer l'événement suivant ;
 *  - FILE D'ÉTAT unique (cache, présences en base, rapprochement : rapide, sans réseau sauf transfert de propriété),
 *    et une VOIE PAR MEMBRE pour ce qui parle à Discord (création, déplacement) : deux membres sont servis en
 *    parallèle ; deux événements du même membre l'un après l'autre (jamais deux salons). Les suppressions de salons
 *    vides partent aussi hors de la file ;
 *  - mesures : chaque création note son temps (attente, préparation, création Discord, déplacement) dans l'état
 *    affiché par l'app (« Dernière création : X ms ») ; journal détaillé avec ESPORT_VOCAUX_MESURES=1 ;
 *  - transport persistant (adaptateurs/fetchDiscordNode.mjs, keep-alive) gardé chaud par un appel léger toutes les
 *    50 s tant que les salons vocaux sont activés (`garderChaud`).
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
  noterPanneau,
  salonsAvecOccupant,
  salonsDuProprietaire,
  salonsDuServeur,
  supprimerLigne,
  surchargesSalon,
  transferer,
} from './salons.mjs';

/** État affiché dans l'app (`tickets_etat`, clé `vocaux`) : dernière erreur, dernier salon créé et ses mesures. */
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
export const INTERVALLE_CHAUD_MS = 50_000;

const drapeau = v => Boolean(v) && !/^(0|non|no|false|off)$/i.test(String(v).trim());
const ms = v => Math.max(0, Math.round(v));

/**
 * Options : `base`, `fetch`, `jetonBot`, `maintenant`, `journal`, `botId()` (identifiant du bot, connu après READY),
 * `delaiMs` (tests : remplace le délai de suppression réglé), `tournoi` (salons d'équipe : `{ hub(ctx, hub, membre),
 * rolesEquipe(salon) }`), `mesures` (journal détaillé de chaque création ; ESPORT_VOCAUX_MESURES=1 par défaut),
 * `garderChaud` (transport persistant : appel léger toutes les `intervalleChaudMs` tant que les salons vocaux sont
 * activés), `horloge` (ms, performance.now par défaut).
 */
export function creerMoteurVocaux({
  base,
  fetch: fetchDiscord,
  jetonBot,
  maintenant = () => Date.now(),
  journal = console,
  botId = () => null,
  delaiMs = null,
  tournoi = { hub: gererHubTournoi, rolesEquipe },
  mesures = drapeau(globalThis.process?.env?.ESPORT_VOCAUX_MESURES),
  garderChaud = false,
  intervalleChaudMs = INTERVALLE_CHAUD_MS,
  horloge = () => performance.now(),
} = {}) {
  const cache = { pret: false, guildId: null, salons: new Map(), vocal: new Map() };
  const minuteries = new Map();
  /** File d'état (un travail à la fois). */
  let file = Promise.resolve();
  /** Voie de chaque membre (création, déplacement) : `userId` → dernière promesse. */
  const voies = new Map();
  /** Lignes en cours d'écriture : `salonId` → promesse (un événement qui lit la ligne l'attend). */
  const insertions = new Map();
  /** Suppressions de salons en cours (hors file) : `salonId` → promesse. */
  const suppressions = new Map();
  /** Travaux lancés hors de la file (voies, suites, suppressions) : `attendre()`. */
  const travaux = new Set();
  let etatFile = Promise.resolve();
  let chaud = null;
  let actifConnu = false;
  let arrete = false;

  const erreur = (quoi, e) => journal.error?.(`[esport] vocaux${quoi ? ` : ${quoi}` : ''} :`, e?.message ?? e);

  /** Suit un travail lancé hors de la file (jamais rejeté). */
  function suivre(p) {
    const q = Promise.resolve(p).catch(e => erreur('', e));
    travaux.add(q);
    q.finally(() => travaux.delete(q));
    return q;
  }

  /**
   * Ajoute un travail à la file d'état : `travail(apres)` ; `apres` reçoit les travaux lancés hors de la file pendant
   * ce travail. La promesse rendue se résout quand le travail ET ces travaux sont finis (les tests l'attendent) ; la
   * file, elle, passe au suivant dès la fin du travail. Erreurs journalisées, jamais propagées.
   */
  function enFile(travail) {
    const apres = [];
    const p = file.then(() => (arrete ? undefined : travail(apres)));
    file = p.catch(e => erreur('', e));
    return file.then(() => Promise.all(apres)).then(() => undefined);
  }

  /** Lance `travail` hors de la file, rattaché à l'événement en cours (`ctx.apres`). */
  function differer(ctx, travail) {
    const p = suivre(Promise.resolve().then(travail));
    ctx.apres?.push(p);
    return p;
  }

  /**
   * Voie d'un membre : ses travaux l'un après l'autre, en parallèle de ceux des autres. `travail(porteur)` peut poser
   * `porteur.suite` (ce qui suit le déplacement : la voie est libérée sans l'attendre). Rend une promesse résolue
   * quand le travail et sa suite sont finis.
   */
  function dansVoie(userId, travail) {
    const porteur = { suite: null };
    const avant = voies.get(userId) ?? Promise.resolve();
    const p = avant.then(() => (arrete ? undefined : travail(porteur))).catch(e => erreur('', e));
    voies.set(userId, p);
    p.finally(() => {
      if (voies.get(userId) === p) voies.delete(userId);
    });
    return p.then(() => porteur.suite);
  }

  async function contexte(apres) {
    const reglages = await lireVocaux(base);
    const general = await lireGeneral(base);
    actifConnu = Boolean(reglages.actif);
    const ctx = { base, fetch: fetchDiscord, jetonBot, maintenant, botId: botId(), guildId: general.guildId, reglages, general, mode: general.langue ?? 'auteur', journal, cache, apres };
    if (tournoi?.rolesEquipe) ctx.rolesEquipe = s => tournoi.rolesEquipe(ctx, s);
    return ctx;
  }

  const delaiDe = ctx => (delaiMs ?? Math.max(1, Number(ctx.reglages.delaiSuppressionS) || 15) * 1000);

  /** État affiché dans l'app : écritures l'une après l'autre (lecture puis fusion). */
  function noter(morceau, t) {
    const p = etatFile.then(() => noterEtat(base, morceau, t)).catch(() => undefined);
    etatFile = p;
    return p;
  }

  const noterErreur = (motif, r, t) => noter({ derniereErreur: { motif, statut: r?.statut ?? 0, code: r?.code ?? null, le: iso(t) } }, t);

  /** Ligne d'un salon, après son écriture si elle est en cours. */
  async function salonConnu(salonId) {
    const ins = insertions.get(salonId);
    if (ins) await ins;
    return lireSalon(base, salonId);
  }

  // ---------------------------------------------------------------- Connexion gardée chaude

  /** Appel léger (GET /users/@me) : la connexion persistante vers discord.com reste ouverte. */
  function chauffer() {
    if (!garderChaud || arrete || !jetonBot) return;
    void suivre(rest(fetchDiscord, jetonBot, 'GET', '/users/@me'));
  }

  function demarrerChaud() {
    if (!garderChaud || chaud || arrete) return;
    chaud = setInterval(() => {
      if (cache.pret && actifConnu) chauffer();
    }, intervalleChaudMs);
    chaud.unref?.();
  }

  function arreterChaud() {
    if (chaud) clearInterval(chaud);
    chaud = null;
  }

  // ---------------------------------------------------------------- Suppression des salons vides

  function planifier(ctx, salonId, depuis) {
    const attente = Math.max(0, Date.parse(depuis) + delaiDe(ctx) - ctx.maintenant());
    if (minuteries.has(salonId)) clearTimeout(minuteries.get(salonId));
    const m = setTimeout(() => {
      minuteries.delete(salonId);
      void enFile(async apres => supprimerSiVide(await contexte(apres), salonId));
    }, attente + 20);
    m.unref?.();
    minuteries.set(salonId, m);
  }

  function annuler(salonId) {
    if (minuteries.has(salonId)) clearTimeout(minuteries.get(salonId));
    minuteries.delete(salonId);
  }

  /**
   * Supprime le salon s'il est vide depuis le délai (`force` : tout de suite, rapprochement après redémarrage). La
   * décision est prise dans la file ; l'appel à Discord part hors de la file (il ne retarde aucune arrivée).
   */
  async function supprimerSiVide(ctx, salonId, { force = false } = {}) {
    if (suppressions.has(salonId)) return false;
    const s = await salonConnu(salonId);
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
    annuler(salonId);
    const p = (async () => {
      const r = await rest(fetchDiscord, jetonBot, 'DELETE', `/channels/${salonId}`, undefined, { raison: 'Esport HQ : salon vocal temporaire vide' });
      if (!r.ok && r.statut !== 404 && r.code !== 10003) {
        await noterErreur('suppression', r, t);
        return;
      }
      cache.salons.delete(salonId);
      await supprimerLigne(base, salonId);
      await journaliser(ctx, 'j_supprime', { nom: s.nom });
    })();
    suppressions.set(salonId, p);
    p.catch(() => undefined).finally(() => suppressions.delete(salonId));
    differer(ctx, () => p);
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

  /** Salon Discord : cache de la Gateway d'abord ; GET seulement s'il y manque. */
  async function salonDiscord(id) {
    if (cache.salons.has(id)) return cache.salons.get(id);
    const r = await rest(fetchDiscord, jetonBot, 'GET', `/channels/${id}`);
    if (!r.ok || !r.corps) return null;
    cache.salons.set(id, r.corps);
    return r.corps;
  }

  const deplacer = (ctx, userId, salonId) => rest(fetchDiscord, jetonBot, 'PATCH', `/guilds/${ctx.guildId}/members/${userId}`, { channel_id: salonId }, { raison: 'Esport HQ : salon vocal temporaire' });

  /** Mesures d'une création → état de l'app (et journal détaillé si demandé). */
  function mesurer(m, hub, r, d) {
    const o = {
      totalMs: ms(m.deplace - m.recu),
      attenteMs: ms(m.debut - m.recu),
      preparationMs: ms(m.envoi - m.debut),
      creationMs: ms(m.cree - m.envoi),
      deplacementMs: ms(m.deplace - m.cree),
      connexion: r?.connexion ?? null,
      deplace: Boolean(d?.ok),
      hubId: hub.id,
    };
    if (mesures) {
      journal.info?.(
        `[esport] vocaux : salon prêt en ${o.totalMs} ms (attente ${o.attenteMs} ms, préparation ${o.preparationMs} ms, création Discord ${o.creationMs} ms${o.connexion ? ` [connexion ${o.connexion}]` : ''}, déplacement ${o.deplacementMs} ms${d?.ok ? '' : ` refusé ${d?.statut ?? 0}`})`,
      );
    }
    return o;
  }

  /**
   * Crée un salon pour `membre` ({ id, nom }) depuis `hub`. `options` (salon d'équipe) : `{ nom, tournoiId, equipeId,
   * equipe }`. `porteur` (voie du membre) : `{ recu, suite }` — instant de réception de l'événement, et ce qui suit le
   * déplacement (panneau, état, journal), posé ici. Rend le salon créé (ou null si Discord refuse).
   */
  async function creerSalon(ctx, hub, membre, options = {}, porteur = {}) {
    const t = ctx.maintenant();
    const m = { recu: porteur.recu ?? horloge(), debut: horloge() };
    const hubSalon = await salonDiscord(hub.id);
    if (!hubSalon) {
      porteur.suite = suivre(noterErreur('hub-introuvable', { statut: 404 }, t));
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
      // Dans le corps de la création (aucun PATCH de position ensuite).
      position: Number(hubSalon.position ?? 0) + 1,
      ...(s.limite ? { user_limit: s.limite } : {}),
      permission_overwrites: surchargesSalon(s, { guildId: ctx.guildId, botId: ctx.botId, rolesStaff: ctx.reglages.rolesStaff, rolesEquipe }),
    };
    m.envoi = horloge();
    const r = await rest(fetchDiscord, jetonBot, 'POST', `/guilds/${ctx.guildId}/channels`, corps, { raison: `Esport HQ : salon vocal temporaire de ${membre.nom || membre.id}`.slice(0, 200) });
    m.cree = horloge();
    if (!r.ok || !r.corps?.id) {
      journal.error?.('[esport] vocaux : création refusée par Discord', r.statut, r.code ?? '');
      porteur.suite = suivre(Promise.all([noterErreur('creation', r, t), journaliser(ctx, 'j_echec', { membre: membre.nom || membre.id, statut: r.code ?? r.statut ?? 0 })]));
      return null;
    }
    s.salonId = String(r.corps.id);
    cache.salons.set(s.salonId, { ...r.corps, type: VOCAL });
    // Ligne écrite PENDANT le déplacement ; l'arrivée du membre dans son salon (événement suivant) l'attend.
    const insertion = insererSalon(base, s, t).then(
      () => true,
      e => {
        erreur('enregistrement du salon', e);
        return false;
      },
    );
    insertions.set(s.salonId, insertion);
    void insertion.finally(() => insertions.delete(s.salonId));
    const [d, enregistre] = await Promise.all([deplacer(ctx, membre.id, s.salonId), insertion]);
    m.deplace = horloge();
    // Membre parti entre-temps (ou refus) : le salon reste vide et sera supprimé après le délai.
    if (!d.ok) journal.warn?.('[esport] vocaux : déplacement refusé', d.statut, d.code ?? '');
    if (enregistre) planifier(ctx, s.salonId, s.videDepuis);
    const mesure = mesurer(m, hub, r, d);
    // Après le déplacement, en parallèle : panneau, état de l'app, journal.
    porteur.suite = suivre(
      Promise.allSettled([
        (async () => {
          const p = await rest(fetchDiscord, jetonBot, 'POST', `/channels/${s.salonId}/messages`, chargePanneau(s, { mode: ctx.mode, langue: 'fr', equipe: options.equipe ?? '' }));
          if (p.ok && p.corps?.id && enregistre) await noterPanneau(base, s.salonId, String(p.corps.id), ctx.maintenant());
        })(),
        noter({ dernierSalon: { le: iso(t), ok: true }, derniereCreation: { le: iso(t), ...mesure } }, t),
        journaliser(ctx, 'j_cree', { salon: `<#${s.salonId}>`, membre: membre.nom || membre.id }),
      ]).then(res => {
        for (const x of res) if (x.status === 'rejected') erreur('après la création', x.reason);
      }),
    );
    return s;
  }

  /** Arrivée dans un hub (voie du membre) : son salon existant (déplacé dedans), sinon un nouveau. */
  async function depuisHub(ctx, hub, membre, porteur = {}) {
    // Le membre a déjà quitté le hub (événement suivant traité entre-temps) : rien à faire.
    if (cache.vocal.get(membre.id)?.channelId !== hub.id) return;
    if (hub.tournoiId) {
      if (tournoi?.hub) await tournoi.hub(ctx, hub, membre, { creerSalon: (c, h, mb, o) => creerSalon(c, h, mb, o, porteur), deplacer, lireSalon: salonConnu });
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
    await creerSalon(ctx, hub, membre, {}, porteur);
  }

  /** Arrivée dans un hub confiée à la voie du membre (hors de la file d'état). */
  function servir(ctx, hub, membre, recu) {
    differer(ctx, () =>
      dansVoie(membre.id, porteur => {
        porteur.recu = recu;
        return depuisHub(ctx, hub, membre, porteur);
      }),
    );
  }

  // ---------------------------------------------------------------- Événements

  async function voix(d, apres, recu) {
    const ctx = await contexte(apres);
    if (!ctx.guildId || d?.guild_id !== ctx.guildId) return;
    const userId = String(d.user_id ?? '');
    if (!/^\d{5,25}$/.test(userId) || userId === ctx.botId || d.member?.user?.bot) return;
    const nom = nomMembre(d.member) || cache.vocal.get(userId)?.nom || userId;
    const vers = d.channel_id ? String(d.channel_id) : null;
    const roles = Array.isArray(d.member?.roles) ? d.member.roles : [];
    if (vers) cache.vocal.set(userId, { channelId: vers, nom, roles });
    else cache.vocal.delete(userId);
    // Arrivée dans un hub : confiée tout de suite à la voie du membre (les présences en base suivent, en parallèle).
    const hub = vers && ctx.reglages.actif ? ctx.reglages.hubs.find(h => h.id === vers) : null;
    if (hub) servir(ctx, hub, { id: userId, nom, roles, permissions: d.member?.permissions ?? null }, recu);
    for (const s of await salonsAvecOccupant(base, userId)) if (s.salonId !== vers) await quitter(ctx, s, userId);
    if (!vers || hub) return;
    const s = await salonConnu(vers);
    if (s) await entrer(ctx, s, userId, nom);
  }

  /** Après GUILD_CREATE (ou RESUMED avec un cache complet) : salons connus rapprochés de Discord. */
  async function rapprocher(apres) {
    const ctx = await contexte(apres);
    if (!ctx.guildId || cache.guildId !== ctx.guildId || !cache.pret) return;
    const t = ctx.maintenant();
    for (const s of await salonsDuServeur(base, ctx.guildId)) {
      if (insertions.has(s.salonId)) continue;
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
    // Personnes restées dans un hub pendant que le bot était absent : servies maintenant (chacune dans sa voie).
    if (!ctx.reglages.actif) return;
    for (const [userId, v] of [...cache.vocal.entries()]) {
      const hub = ctx.reglages.hubs.find(h => h.id === v.channelId);
      if (hub) servir(ctx, hub, { id: userId, nom: v.nom || userId, roles: v.roles ?? [] }, horloge());
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
      // Tout passe par la file d'état, dans l'ordre d'arrivée (le cache d'un GUILD_CREATE avant les états vocaux).
      case 'GUILD_CREATE':
        await enFile(async apres => {
          const general = await lireGeneral(base);
          if (!d?.id || String(d.id) !== general.guildId) return;
          guildCreate(d);
          // Connexion persistante ouverte tout de suite (la première création n'attend pas le DNS ni le TLS).
          chauffer();
          demarrerChaud();
          await rapprocher(apres);
        });
        return;
      case 'RESUMED':
        await enFile(async apres => {
          if (cache.pret) await rapprocher(apres);
        });
        return;
      case 'CHANNEL_CREATE':
      case 'CHANNEL_UPDATE':
        // Cache du salon d'un hub, de sa catégorie, de leurs surcharges et positions (file : après un GUILD_CREATE).
        await enFile(async () => {
          if (d?.id) cache.salons.set(String(d.id), d);
        });
        return;
      case 'CHANNEL_DELETE':
        if (!d?.id) return;
        cache.salons.delete(String(d.id));
        await enFile(async () => {
          annuler(String(d.id));
          if (await salonConnu(String(d.id))) await supprimerLigne(base, String(d.id));
        });
        return;
      case 'VOICE_STATE_UPDATE': {
        const recu = horloge();
        await enFile(apres => voix(d, apres, recu));
        return;
      }
      default:
    }
  }

  /** Passage du superviseur (toutes les 20 s, meneur) : salons vides arrivés au délai supprimés (rattrapage). */
  async function passage() {
    await enFile(async apres => {
      const ctx = await contexte(apres);
      if (!ctx.guildId) return;
      const t = ctx.maintenant();
      for (const s of await salonsDuServeur(base, ctx.guildId)) {
        if (s.occupants.length || insertions.has(s.salonId)) continue;
        if (!s.videDepuis) {
          await ecrireSalon(base, { ...s, videDepuis: iso(t) }, t);
          planifier(ctx, s.salonId, iso(t));
        } else if (t - Date.parse(s.videDepuis) >= delaiDe(ctx)) await supprimerSiVide(ctx, s.salonId);
        else if (!minuteries.has(s.salonId)) planifier(ctx, s.salonId, s.videDepuis);
      }
    });
  }

  /** Tout ce qui est en cours (file, voies, suites, suppressions) : fini. */
  async function attendre() {
    for (let i = 0; i < 50; i++) {
      const f = file;
      await f;
      await Promise.all([...travaux]);
      if (f === file && !travaux.size) return;
    }
  }

  return {
    evenement,
    passage,
    /** Fin du rôle de meneur (ou arrêt) : minuteries coupées, cache oublié (un autre processus prend le relais). */
    reinitialiser() {
      for (const m of minuteries.values()) clearTimeout(m);
      minuteries.clear();
      arreterChaud();
      cache.pret = false;
      cache.vocal = new Map();
    },
    arreter() {
      arrete = true;
      arreterChaud();
      for (const m of minuteries.values()) clearTimeout(m);
      minuteries.clear();
    },
    /** Tests et diagnostic. */
    etat: () => ({ pret: cache.pret, vocal: cache.vocal.size, salons: cache.salons.size, minuteries: minuteries.size, voies: voies.size, chaud: Boolean(chaud) }),
    attendre,
    cache,
  };
}
