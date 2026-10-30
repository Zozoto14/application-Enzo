/**
 * Test des MP du bot (Réglages › Discord › « Tester les MP ») : le Fondateur (ou qui a `discord.manage`) vérifie
 * qu'un membre est joignable en message privé, sans attendre une vraie relance.
 *
 *  - `testerMp` : un MP de test à chaque membre choisi (langue du membre, boutons Oui / Peut-être / Non qui répondent
 *    « Test reçu »), résultat par membre avec la cause en clair ;
 *  - `simulerRelance` : sur un événement à venir, qui recevrait un MP, qui serait cité dans le salon, qui est déjà
 *    pingé, SANS rien envoyer ;
 *  - `relanceTest` : la vraie relance, en version « test », envoyée à UN membre.
 *
 * Un test n'écrit jamais dans le registre « déjà pingé » (discord_mentions), les MP envoyés (discord_mp_envois), les
 * joueurs injoignables, les réponses (présences) ni les convocations : seul le bus reçoit `discord.test_mp` (un par
 * membre testé), qui sert aussi de compteur anti-abus (10 tests par tranche de 10 minutes et par team).
 */

import { evenement } from '../evenements.mjs';
import { echec, iso } from '../outils.mjs';
import { texte as T } from '../langues.mjs';
import { servicesPlanning } from '../planning/service.mjs';
import { API_DISCORD, appelerDiscord, chargeMp, langueCompte, mentionsFaites, pingActif, relancesMpActives, serveurBot, sujetOccurrence } from './file.mjs';
import { membresTeam } from './convoques.mjs';
import { boutonsTestMp } from './embeds.mjs';
import { construireCharge } from './messages.mjs';
import { contexteOccurrence } from './occurrence.mjs';

export const TESTS_MAX = 10;
export const FENETRE_TESTS_MS = 10 * 60_000;
const JOUR = 86_400_000;
const HORIZON_JOURS = 14;

/** Motifs d'échec d'un test (traduits dans l'app, avec l'action à faire). */
export const MOTIFS_TEST_MP = ['non_lie', 'bot_non_configure', 'bot_absent', 'mp_fermes', 'introuvable', 'bot_bloque', 'limite', 'indisponible', 'refuse'];

/** Cause d'un échec de Discord (réponse de `appelerDiscord`). */
function motifDe(r) {
  if (r.statut === 401) return 'bot_bloque';
  if (r.statut === 429 || r.code === 40003) return 'limite';
  if (r.code === 50007) return 'mp_fermes';
  if (r.code === 10013 || r.statut === 404) return 'introuvable';
  if (r.statut === 403 || r.definitif) return 'refuse';
  return 'indisponible';
}

export function servicesTestMp({ base, maintenant, contexte, jetonBot, fetch: fetchDiscord, lienApp = '' }) {
  const planning = servicesPlanning({ base, maintenant, noyau: { contexteTeam: null, exiger: null } });

  /** Tests déjà faits dans la fenêtre (un par membre testé) et, s'il est plein, délai avant le suivant. */
  async function quota(teamId) {
    const t = maintenant();
    const l = await base.premier("SELECT COUNT(*) AS n, MIN(cree_le) AS premier FROM evenements WHERE team_id = ? AND type = 'discord.test_mp' AND cree_le > ?", [teamId, iso(t - FENETRE_TESTS_MS)]);
    const faits = Number(l?.n ?? 0);
    const attenteS = faits > 0 && l.premier ? Math.max(1, Math.ceil((Date.parse(l.premier) + FENETRE_TESTS_MS - t) / 1000)) : 0;
    return { max: TESTS_MAX, restant: Math.max(0, TESTS_MAX - faits), attenteS: faits >= TESTS_MAX ? attenteS : 0 };
  }

  async function exigerQuota(teamId, n) {
    const q = await quota(teamId);
    if (n > q.restant) {
      const e = echec(429, 'trop-de-tests-mp', 'Trop de tests de MP : 10 au plus toutes les 10 minutes pour une team.');
      e.attente = q.attenteS || Math.ceil(FENETRE_TESTS_MS / 1000);
      throw e;
    }
  }

  /** Le bot est-il prêt à envoyer des MP ? `null`, ou le motif qui l'en empêche. */
  async function botBloque(teamId) {
    if (!jetonBot) return 'bot_non_configure';
    if (!(await serveurBot(base, teamId))) return 'bot_absent';
    return null;
  }

  /** MP du bot : salon privé (POST /users/@me/channels) puis message. */
  async function envoyerMp(discordId, charge) {
    const salon = await appelerDiscord(fetchDiscord, `${API_DISCORD}/users/@me/channels`, { recipient_id: discordId }, { jetonBot, lireCorps: true });
    if (!salon.ok) return salon;
    if (!salon.messageId) return { ok: false, statut: 0, definitif: false, motif: 'Salon privé Discord sans identifiant' };
    return appelerDiscord(fetchDiscord, `${API_DISCORD}/channels/${salon.messageId}/messages`, charge, { jetonBot, lireCorps: true });
  }

  /** Envoie une charge de test à un membre ; rend `{ compte, pseudo, ok, motif?, attenteS? }`. */
  async function envoyerA(membre, teamId, fabriquer, bloque) {
    const base_ = { compte: membre.compte, pseudo: membre.pseudo };
    if (bloque) return { ...base_, ok: false, motif: bloque };
    if (!membre.discordId) return { ...base_, ok: false, motif: 'non_lie' };
    const r = await envoyerMp(membre.discordId, await fabriquer(membre));
    if (r.ok) return { ...base_, ok: true };
    return { ...base_, ok: false, motif: motifDe(r), ...(r.statut === 429 ? { attenteS: r.retryApresS } : {}) };
  }

  const evenementsTest = (acteur, teamId, resultats, extra = {}) =>
    resultats.map(r =>
      evenement('discord.test_mp', { teamId, acteur: acteur.compte, entiteType: 'discord', entiteId: teamId, charge: { compte: r.compte, ok: r.ok, ...(r.motif ? { motif: r.motif } : {}), ...extra }, maintenant: maintenant() }),
    );

  async function membresActifs(teamId) {
    return membresTeam(base, teamId);
  }

  /** Charge du MP de test simple, dans la langue du membre. */
  async function chargeTest(membre, team) {
    const langue = await langueCompte(base, membre.compte);
    const { username: _u, ...charge } = construireCharge(T(langue, 'test.mp.message', { team: team.nom }), {
      nomTeam: team.nom,
      titre: T(langue, 'test.mp.titre'),
      cle: 'test',
      composants: boutonsTestMp(langue),
      maintenant: maintenant(),
      langue,
    });
    return charge;
  }

  /** `GET /teams/:t/discord/testmp` : quota, membres testables et événements à venir (simulation). */
  async function etatTestMp(acteur, teamId) {
    const ctx = await contexte(acteur, teamId);
    const t = maintenant();
    const membres = await membresActifs(teamId);
    const occ = await planning.occurrencesTeam(teamId, t, t + HORIZON_JOURS * JOUR);
    return {
      botConfigure: Boolean(jetonBot),
      botLie: Boolean(await serveurBot(base, teamId)),
      quota: await quota(teamId),
      moi: acteur.compte,
      membres: membres.map(m => ({ compte: m.compte, pseudo: m.pseudo, discordId: Boolean(m.discordId) })),
      evenements: occ.slice(0, 25).map(({ ev, o }) => ({ evenementId: ev.id, occurrence: new Date(o.cle).toISOString(), titre: o.titre ?? ev.titre, type: ev.type, debut: new Date(o.debut).toISOString() })),
      team: ctx.team.nom,
    };
  }

  /** `POST /teams/:t/discord/testmp` { comptes? } : un MP de test à chaque membre choisi (par défaut : moi). */
  async function testerMp(acteur, teamId, corps) {
    const ctx = await contexte(acteur, teamId);
    const demandes = corps?.comptes === undefined ? [acteur.compte] : corps.comptes;
    if (!Array.isArray(demandes) || demandes.length === 0 || demandes.some(c => typeof c !== 'string')) throw echec(400, 'comptes-test', 'Choisissez au moins un membre à tester.');
    const comptes = [...new Set(demandes)];
    if (comptes.length > TESTS_MAX) throw echec(400, 'comptes-test-max', 'Au plus 10 membres à la fois.');
    const membres = await membresActifs(teamId);
    const choisis = comptes.map(c => membres.find(m => m.compte === c));
    if (choisis.some(m => !m)) throw echec(404, 'membre-test', 'Ce membre ne fait pas partie de la team.');
    await exigerQuota(teamId, choisis.length);
    const bloque = await botBloque(teamId);
    const resultats = [];
    for (const m of choisis) resultats.push(await envoyerA(m, teamId, mem => chargeTest(mem, ctx.team), bloque));
    await base.lot(evenementsTest(acteur, teamId, resultats, { mode: 'mp' }));
    return { resultats, quota: await quota(teamId) };
  }

  async function lireOccurrence(teamId, corps) {
    if (typeof corps?.evenementId !== 'string' || typeof corps?.occurrence !== 'string') throw echec(400, 'occurrence-test', 'Choisissez un événement à venir.');
    const c = await contexteOccurrence(base, teamId, corps.evenementId, corps.occurrence, maintenant());
    if (!c) throw echec(404, 'occurrence-test-absente', 'Événement introuvable ou occurrence annulée.');
    return c;
  }

  /** `POST …/testmp/simulation` { evenementId, occurrence } : qui recevrait la relance, sans rien envoyer. */
  async function simulerRelance(acteur, teamId, corps) {
    await contexte(acteur, teamId);
    const c = await lireOccurrence(teamId, corps);
    const relancesMp = await relancesMpActives(base, teamId);
    const motifBot = await botBloque(teamId);
    const pingOk = await pingActif(base, teamId, c.occurrence.type);
    const deja = await mentionsFaites(base, teamId, sujetOccurrence(c.ev.id, c.occurrence.cle));
    const refus = new Map((await base.tous('SELECT compte_id, motif FROM discord_injoignables WHERE team_id = ?', [teamId])).map(l => [l.compte_id, l.motif]));
    let rien = null;
    if (c.staff) rien = 'reunion_staff';
    else if (!c.presenceActive) rien = 'presence_inactive';
    else if (c.sansReponse.length === 0) rien = 'tous_ont_repondu';
    const membres = rien
      ? []
      : c.sansReponse.map(m => {
          const dejaPinge = Boolean(m.discordId && deja.has(m.discordId));
          let motif = null;
          if (motifBot) motif = motifBot;
          else if (!relancesMp) motif = 'option_coupee';
          else if (!m.discordId) motif = 'non_lie';
          else if (refus.has(m.compte)) motif = refus.get(m.compte);
          return {
            compte: m.compte,
            pseudo: m.pseudo,
            voie: motif ? 'salon' : 'mp',
            motif,
            dejaPinge,
            // Repli dans le salon : une mention au plus par événement, seulement si le ping est actif et le joueur lié.
            mention: Boolean(motif && !motifBot && pingOk && m.discordId && !dejaPinge),
          };
        });
    return {
      evenement: { evenementId: c.ev.id, occurrence: c.occurrence.cle, titre: c.occurrence.titre, type: c.occurrence.type, debut: new Date(c.occurrence.debut).toISOString() },
      relancesMp,
      botPret: !motifBot,
      rien,
      membres,
      dejaPinges: c.convoques.filter(m => m.discordId && deja.has(m.discordId)).map(m => ({ compte: m.compte, pseudo: m.pseudo })),
    };
  }

  /**
   * `POST …/testmp/relance` { evenementId, occurrence, compte } : la relance telle que ce membre la recevrait, marquée
   * « test », avec les boutons de test. Aucune réponse, aucune mention, aucun envoi retenu.
   */
  async function relanceTest(acteur, teamId, corps) {
    const ctx = await contexte(acteur, teamId);
    const c = await lireOccurrence(teamId, corps);
    const compte = corps?.compte === undefined ? acteur.compte : corps.compte;
    const membre = typeof compte === 'string' ? c.membres.find(m => m.compte === compte) : undefined;
    if (!membre) throw echec(404, 'membre-test', 'Ce membre ne fait pas partie de la team.');
    await exigerQuota(teamId, 1);
    const bloque = await botBloque(teamId);
    const fabriquer = async mem => {
      const langue = await langueCompte(base, mem.compte);
      const charge = await chargeMp(base, { team_id: teamId, cle: 'rsvp_relance', variables: '{}' }, c, mem, { team: ctx.team, lienApp, t: maintenant(), langue });
      return { ...charge, content: T(langue, 'test.mp.relance'), components: boutonsTestMp(langue) };
    };
    const resultat = await envoyerA(membre, teamId, fabriquer, bloque);
    await base.lot(evenementsTest(acteur, teamId, [resultat], { mode: 'relance', evenementId: c.ev.id }));
    return { resultats: [resultat], quota: await quota(teamId) };
  }

  return { etatTestMp, testerMp, simulerRelance, relanceTest };
}
