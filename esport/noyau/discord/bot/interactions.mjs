/**
 * Bot Discord de l'Esport par INTERACTIONS HTTP (slash commands, boutons,
 * menus) : Discord appelle POST /discord/interactions ; aucune connexion
 * permanente (gateway), adapté à un Worker. Cœur portable (Request/Response).
 *
 *  1. Signature Ed25519 vérifiée (signature.mjs) ; PING → PONG.
 *  2. L'utilisateur Discord doit être LIÉ à un compte Esport (/lier), sinon :
 *     « Lie ton compte avec /lier ».
 *  3. Chaque commande appelle les MÊMES services que l'API (planning, présence,
 *     dispos, tâches, playbook, résumés) avec l'acteur du compte lié : mêmes
 *     contrôles (appartenance → module → permission), mêmes événements de
 *     domaine (journal). Une commande n'agit QUE sur les teams liées au
 *     serveur Discord où elle est tapée.
 *  4. Réponse en moins de 3 s ; au-delà de `delaiDiffere`, réponse différée
 *     (type 5/6) puis suivi (PATCH du message d'origine) en arrière-plan.
 *
 * Toutes les réponses personnelles sont éphémères (seul l'auteur les voit),
 * et aucune ne peut mentionner qui que ce soit (`allowed_mentions.parse: []`).
 */

import { evenement } from '../../evenements.mjs';
import { ErreurEsport, echec, jsonOu } from '../../outils.mjs';
import { ajouterJours, dateLocale, lireDate, lireHeure, texteDate, texteHeure } from '../../planning/temps.mjs';
import { convocationParGroupe } from '../convoques.mjs';
import {
  ACCENT,
  COULEUR_ALERTE,
  COULEUR_ERREUR,
  COULEUR_OK,
  EMOJIS_TYPES,
  NOMS_TYPES,
  REPONSES_BOUTONS,
  boutonLien,
  boutonsPagination,
  boutonsRsvp,
  bornerEmbeds,
  couleurType,
  embedReponse,
  horodatage,
  imageCarte,
  occurrenceCourte,
  occurrenceLongue,
  paginer,
} from '../embeds.mjs';
import { API_DISCORD } from '../file.mjs';
import { nettoyerVariable } from '../messages.mjs';
import { contexteOccurrence, embedOccurrence } from '../occurrence.mjs';
import { verifierSignature } from './signature.mjs';

const TYPE = { PING: 1, COMMANDE: 2, COMPOSANT: 3, AUTOCOMPLETE: 4 };
const REPONSE = { PONG: 1, MESSAGE: 4, DIFFERE: 5, DIFFERE_MAJ: 6, MAJ: 7, CHOIX: 8 };
const EPHEMERE = 64;
const TAILLE_MAX = 64 * 1024;
const JOUR = 86_400_000;
const PERMISSION_ADMIN = 0x8n;
const PERMISSION_GERER_SERVEUR = 0x20n;
const LENT = Symbol('lent');
const ICONES_RSVP = { oui: '✅ Oui', peut_etre: '🤔 Peut-être', non: '❌ Non', sans_reponse: '⏳ Pas encore répondu' };
const SIDES = { attaque: '🗡️ Attaque', defense: '🛡️ Défense' };
const TYPES_STRAT = { default: 'Default', execute: 'Execute', eco: 'Éco', pistol: 'Pistol', retake: 'Retake', other: 'Autre' };
const JOURS = ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

const json = (corps, statut = 200) => new Response(JSON.stringify(corps), { status: statut, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

/** Message éphémère (par défaut) sans aucune mention possible. */
function message({ embeds = [], components = [], ephemere = true, content } = {}) {
  return { type: REPONSE.MESSAGE, data: { ...(content ? { content } : {}), embeds: bornerEmbeds(embeds), components, flags: ephemere ? EPHEMERE : 0, allowed_mentions: { parse: [] } } };
}
const miseAJour = ({ embeds = [], components = [] }) => ({ type: REPONSE.MAJ, data: { embeds: bornerEmbeds(embeds), components, allowed_mentions: { parse: [] } } });
const avis = (titre, description, couleur = ACCENT, extra = {}) => message({ embeds: [embedReponse({ titre, description, couleur, ...extra })] });
const erreur = texte => avis('⚠️ Impossible', texte, COULEUR_ERREUR);

const PAS_LIE = () =>
  avis(
    '🔗 Lie ton compte avec /lier',
    'Ton compte Discord n’est pas encore lié à l’Esport.\n\n**1.** Dans l’app : **Esport › Mon profil › Lier mon Discord**.\n**2.** Tape ici `/lier code:XXXX-XXXX` avec le code affiché (valable 10 minutes).',
    COULEUR_ALERTE,
  );

/** Option d'une commande (premier niveau). */
const opt = (i, nom) => (i.data?.options ?? []).find(o => o.name === nom)?.value;

/** Message lisible d'une erreur des services. */
function texteErreur(e) {
  if (!(e instanceof ErreurEsport)) {
    console.error('[esport] bot', e);
    return 'Erreur interne du serveur Esport. Réessaie dans un instant.';
  }
  if (e.code === 'permission') return 'Tu n’as pas la permission de faire cela dans cette team.';
  if (e.code === 'module-desactive') return 'Ce module n’est pas activé pour cette team.';
  if (e.code === 'team-introuvable') return 'Tu n’es pas membre de cette team.';
  if (e.code === 'non-concerne') return 'Tu n’es pas convoqué à cet événement.';
  if (e.code === 'trop-de-requetes') return 'Trop de demandes en peu de temps : réessaie dans un moment.';
  return e.message;
}

/** Date saisie : « 2026-10-24 », « 24/10 », « 24/10/2026 », « aujourd'hui », « demain ». */
export function lireDateSaisie(saisie, fuseau, maintenant) {
  const t = String(saisie ?? '').trim().toLowerCase().replace(/’/g, "'");
  const auj = dateLocale(fuseau, maintenant);
  if (/^aujourd'?hui$/.test(t)) return texteDate(auj);
  if (t === 'demain') return texteDate(ajouterJours(auj, 1));
  const iso = lireDate(t);
  if (iso) return texteDate(iso);
  const m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}))?$/.exec(t);
  if (!m) return null;
  const pad = n => String(n).padStart(2, '0');
  let annee = m[3] ? Number(m[3]) : auj.annee;
  let d = lireDate(`${annee}-${pad(m[2])}-${pad(m[1])}`);
  if (d && !m[3] && texteDate(d) < texteDate(auj)) {
    annee += 1;
    d = lireDate(`${annee}-${pad(m[2])}-${pad(m[1])}`);
  }
  return d ? texteDate(d) : null;
}

/** Heure saisie : « 20:30 », « 20h30 », « 20h » → « 20:30 » ; sinon null. */
export function lireHeureSaisie(saisie) {
  const m = /^(\d{1,2})\s*[:hH]\s*(\d{2})?$/.exec(String(saisie ?? '').trim());
  if (!m) return null;
  const minutes = lireHeure(`${m[1].padStart(2, '0')}:${m[2] ?? '00'}`);
  return minutes === undefined || minutes >= 1440 ? null : texteHeure(minutes);
}

/**
 * Fabrique le bot. `services` : { noyau, planning, resumes, objectifs, playbook, liaisons } ;
 * `config` : { applicationId, publicKey } ; `fetch` : réseau (simulé en test) ; `limite(genre, qui)`.
 * `attenteDiffere()` : promesse au-delà de laquelle la réponse devient différée (≈ 2 s).
 */
export function creerBot({ base, maintenant = () => Date.now(), services, config = {}, fetch: fetchDiscord = (...a) => globalThis.fetch(...a), lienApp = '', limite = async () => {}, attenteDiffere }) {
  const { noyau, planning: p, resumes, objectifs, playbook, liaisons } = services;
  const lien = /^https:\/\//.test(lienApp) ? lienApp : '';
  const attendreLent = attenteDiffere ?? (() => new Promise(ok => setTimeout(ok, 2000).unref?.()));

  // ------------------------------------------------------------ Contexte

  async function acteurDe(utilisateur) {
    const l = await base.premier('SELECT dc.compte_id, dc.super_admin FROM discord_comptes dc JOIN comptes c ON c.id = dc.compte_id WHERE dc.discord_user_id = ?', [utilisateur.id]);
    return l ? { compte: l.compte_id, superAdmin: Number(l.super_admin) === 1 } : null;
  }

  /** Teams liées à ce serveur où l'acteur peut entrer (membre actif, ou Fondateur). */
  async function teamsDuServeur(guildId, acteur) {
    if (!guildId) return [];
    const lignes = await base.tous('SELECT team_id FROM discord_serveurs WHERE guild_id = ? ORDER BY team_id', [guildId]);
    const sortie = [];
    for (const { team_id: id } of lignes) {
      const ctx = await noyau.contexteTeam(acteur, id).catch(() => null);
      if (ctx) sortie.push(ctx);
    }
    return sortie.sort((a, b) => a.team.nom.localeCompare(b.team.nom, 'fr'));
  }

  /** La team visée : l'option `team` (liée à ce serveur), ou la seule team possible. */
  function teamVisee(contextes, choix) {
    if (choix) {
      const ctx = contextes.find(c => c.team.id === choix || c.team.nom.toLocaleLowerCase('fr') === String(choix).toLocaleLowerCase('fr'));
      if (!ctx) throw echec(404, 'team-hors-serveur', 'Cette team n’est pas liée à ce serveur, ou tu n’en es pas membre.');
      return ctx;
    }
    if (contextes.length === 1) return contextes[0];
    throw echec(400, 'team-ambigue', `Ce serveur porte plusieurs teams : précise l’option « team » (${contextes.map(c => c.team.nom).join(', ')}).`);
  }

  async function journaliser(teamId, acteur, commande) {
    await base.lot([evenement('discord.command_used', { teamId, acteur: acteur.compte, entiteType: 'discord', entiteId: teamId, charge: { commande }, maintenant: maintenant() })]);
  }

  /** Événement du planning ↔ team liée à CE serveur (isolation entre serveurs). */
  async function evenementDuServeur(evId, guildId) {
    if (typeof evId !== 'string' || !/^[0-9a-f-]{36}$/.test(evId)) return null;
    return base.premier(
      `SELECT e.id, e.team_id FROM planning_evenements e JOIN discord_serveurs s ON s.team_id = e.team_id
        WHERE e.id = ? AND s.guild_id = ? AND e.supprime_le IS NULL`,
      [evId, guildId ?? ''],
    );
  }

  /** Préambule commun : compte lié, teams du serveur. Rend `{ acteur, contextes }` ou une réponse. */
  async function preparer(i, { serveur = true } = {}) {
    const utilisateur = i.member?.user ?? i.user;
    const acteur = await acteurDe(utilisateur);
    if (!acteur) return { reponse: PAS_LIE() };
    if (!serveur) return { acteur };
    if (!i.guild_id) return { reponse: erreur('Cette commande se tape dans le serveur Discord de la team.') };
    const lie = await base.premier('SELECT team_id FROM discord_serveurs WHERE guild_id = ? LIMIT 1', [i.guild_id]);
    if (!lie) return { reponse: erreur('Ce serveur n’est lié à aucune team Esport : un admin du serveur tape `/esport-lier-serveur` avec le code de l’app.') };
    const contextes = await teamsDuServeur(i.guild_id, acteur);
    if (contextes.length === 0) return { reponse: erreur('Tu n’es membre d’aucune team liée à ce serveur.') };
    return { acteur, contextes };
  }

  const peut = (ctx, permission) => {
    try {
      noyau.exiger(ctx, permission);
      return true;
    } catch {
      return false;
    }
  };

  // ------------------------------------------------------------ Occurrences

  const ligneOccurrence = (o, { team, monRsvp } = {}) => {
    const debut = Date.parse(o.debut);
    const type = EMOJIS_TYPES[o.type] ? o.type : 'other';
    return {
      nom: `${EMOJIS_TYPES[type]} ${nettoyerVariable(o.titre)}`,
      valeur: [`${horodatage(debut, 'f')} · ${horodatage(debut, 'R')}`, team ? `🏷️ ${nettoyerVariable(team)}` : '', monRsvp ? `Ta réponse : ${ICONES_RSVP[monRsvp] ?? ICONES_RSVP.sans_reponse}` : ''].filter(Boolean).join('\n'),
    };
  };

  /** Occurrences à venir des teams (planning.view), filtrées par `garder`. */
  async function aVenir(acteur, contextes, { jours = 14, garder = () => true } = {}) {
    const t = maintenant();
    const sortie = [];
    for (const ctx of contextes) {
      if (!peut(ctx, 'planning.view')) continue;
      const r = await p.liste(acteur, ctx.team.id);
      for (const o of r.occurrences) {
        const debut = Date.parse(o.debut);
        if (Date.parse(o.fin) <= t || debut > t + jours * JOUR) continue;
        // Règle des convocations du planning (convoqueMoi), la même que dans l'app.
        const convoque = Boolean(o.convoqueMoi ?? o.concerneMoi);
        if (garder({ o, ctx, convoque })) sortie.push({ o, ctx, convoque });
      }
    }
    return sortie.sort((a, b) => Date.parse(a.o.debut) - Date.parse(b.o.debut));
  }

  // ------------------------------------------------------------ Commandes

  async function aide() {
    const champs = [
      { nom: '🔗 /lier · /delier', valeur: 'Lier (ou délier) ton compte Discord à ton compte Esport.' },
      { nom: '📅 /prochain', valeur: 'Tes prochains événements, là où tu es convoqué.' },
      { nom: '🗓️ /planning [jours]', valeur: 'Les événements de la team (7 jours par défaut).' },
      { nom: '🗳️ /rsvp', valeur: 'Choisir un événement, puis Oui, Peut-être ou Non.' },
      { nom: '🟢 /dispo', valeur: 'Tes disponibilités de la semaine.' },
      { nom: '✅ /taches', valeur: 'Tes tâches ouvertes et en retard.' },
      { nom: '🗺️ /strat map:', valeur: 'Les strats validées du playbook pour une map.' },
      { nom: '📥 /resume', valeur: 'Déposer le lien d’une réunion à résumer.' },
      { nom: '🛠️ Staff', valeur: '`/evenement-creer` crée un événement ; `/relancer` relance les convoqués sans réponse.' },
      { nom: '⚙️ Admin du serveur', valeur: '`/esport-lier-serveur code:` lie ce serveur à une team (code dans l’app : Discord › Lier un serveur Discord).' },
    ];
    return message({ embeds: [embedReponse({ titre: '🛰️ Bot Esport · aide', description: 'Les annonces des scrims, matchs et tournois arrivent dans le salon de la team, avec les convoqués mentionnés et des boutons pour répondre.', champs, lien })], components: boutonLien(lien) });
  }

  async function lier(i) {
    const utilisateur = i.member?.user ?? i.user;
    await limite('discord_lier', utilisateur.id);
    const ligne = await liaisons.consommerCode('compte', opt(i, 'code'));
    if (!ligne) return erreur('Code invalide, déjà utilisé ou expiré (10 minutes). Demande un nouveau code dans l’app : **Mon profil › Lier mon Discord**.');
    await liaisons.lierCompte(ligne, utilisateur);
    const profil = await base.premier('SELECT pseudo FROM comptes WHERE id = ?', [ligne.compte_id]);
    return avis('✅ Compte lié', `Ton Discord est lié au compte Esport de **${nettoyerVariable(profil?.pseudo ?? 'ton compte')}**. Tu seras mentionné quand tu es convoqué. \`/aide\` pour la suite.`, COULEUR_OK);
  }

  async function delier(i) {
    const { acteur, reponse } = await preparer(i, { serveur: false });
    if (reponse) return reponse;
    await liaisons.delierCompte(acteur, { origine: 'discord' });
    return avis('🔓 Compte délié', 'Ton Discord n’est plus lié à l’Esport : tu ne seras plus mentionné. Tu peux le relier à tout moment avec `/lier`.', COULEUR_OK);
  }

  async function lierServeur(i) {
    const utilisateur = i.member?.user ?? i.user;
    if (!i.guild_id || !i.member) return erreur('Cette commande se tape dans un serveur Discord.');
    let droits = 0n;
    try {
      droits = BigInt(i.member.permissions ?? '0');
    } catch {
      droits = 0n;
    }
    if ((droits & (PERMISSION_ADMIN | PERMISSION_GERER_SERVEUR)) === 0n) return erreur('Seul un administrateur du serveur Discord (droit « Gérer le serveur ») peut le lier à une team.');
    await limite('discord_lier', utilisateur.id);
    const ligne = await liaisons.consommerCode('serveur', opt(i, 'code'));
    if (!ligne) return erreur('Code invalide, déjà utilisé ou expiré (10 minutes). Demande un nouveau code dans l’app : **Discord › Lier un serveur Discord**.');
    const salonId = opt(i, 'salon') ?? i.channel_id ?? i.channel?.id;
    if (!/^\d{5,25}$/.test(String(salonId ?? ''))) return erreur('Salon introuvable.');
    const salonNom = i.data?.resolved?.channels?.[salonId]?.name ?? (salonId === (i.channel_id ?? i.channel?.id) ? i.channel?.name : '') ?? '';
    const team = await liaisons.lierServeur(ligne, { guildId: i.guild_id, salonId: String(salonId), salonNom, discordUserId: utilisateur.id });
    return avis('🔗 Serveur lié', `Ce serveur est lié à la team **${nettoyerVariable(team.nom)}**. Les annonces arriveront dans <#${salonId}>.\n\nLes joueurs lient maintenant leur compte : **Mon profil › Lier mon Discord** dans l’app, puis \`/lier\` ici.`, COULEUR_OK);
  }

  async function prochain(i, page = 1) {
    const { acteur, contextes, reponse } = await preparer(i);
    if (reponse) return reponse;
    const liste = await aVenir(acteur, contextes, { jours: 30, garder: ({ convoque }) => convoque });
    for (const ctx of contextes) await journaliser(ctx.team.id, acteur, 'prochain');
    const pg = paginer(liste, page, 5);
    const plusieurs = contextes.length > 1;
    const embed = embedReponse({
      titre: '📅 Tes prochains événements',
      description: liste.length ? `${liste.length} événement${liste.length > 1 ? 's' : ''} où tu es convoqué, dans les 30 prochains jours.` : 'Aucun événement à venir où tu es convoqué. Profites-en !',
      champs: pg.elements.map(({ o, ctx }) => ligneOccurrence(o, { team: plusieurs ? ctx.team.nom : null, monRsvp: o.monRsvp })),
      couleur: pg.elements[0] ? couleurType(pg.elements[0].o.type) : ACCENT,
      pied: `Page ${pg.page} / ${pg.pages} · Esport`,
      lien,
    });
    return { embeds: [embed], components: [...boutonsPagination('prochain', pg.page, pg.pages), ...(liste.length ? [] : boutonLien(lien))] };
  }

  async function planningCmd(i, page = 1, args = {}) {
    const { acteur, contextes, reponse } = await preparer(i);
    if (reponse) return reponse;
    const jours = Math.min(30, Math.max(1, Number(args.jours ?? opt(i, 'jours') ?? 7) || 7));
    const choix = args.team ?? opt(i, 'team');
    const cibles = choix ? [teamVisee(contextes, choix)] : contextes;
    const liste = await aVenir(acteur, cibles, { jours });
    for (const ctx of cibles) await journaliser(ctx.team.id, acteur, 'planning');
    const pg = paginer(liste, page, 6);
    const embed = embedReponse({
      titre: `🗓️ Planning · ${jours} prochain${jours > 1 ? 's' : ''} jour${jours > 1 ? 's' : ''}`,
      description: liste.length ? (cibles.length === 1 ? `Team **${nettoyerVariable(cibles[0].team.nom)}**` : `${cibles.length} teams`) : 'Rien de prévu sur cette période.',
      champs: pg.elements.map(({ o, ctx, convoque }) => ({ ...ligneOccurrence(o, { team: cibles.length > 1 ? ctx.team.nom : null }), nom: `${ligneOccurrence(o).nom}${convoque ? ' · 📌 toi' : ''}` })),
      pied: `Page ${pg.page} / ${pg.pages} · Esport`,
      lien,
    });
    const cle = ['planning', jours, choix ? cibles[0].team.id : ''].filter(x => x !== '').join('.');
    return { embeds: [embed], components: [...boutonsPagination(cle, pg.page, pg.pages), ...boutonLien(lien)] };
  }

  async function rsvp(i) {
    const { acteur, contextes, reponse } = await preparer(i);
    if (reponse) return reponse;
    const liste = (await aVenir(acteur, contextes, { jours: 14, garder: ({ convoque, ctx }) => convoque && peut(ctx, 'attendance.rsvp_own') })).slice(0, 25);
    if (liste.length === 0) return avis('🗳️ Rien à répondre', 'Aucun événement des 14 prochains jours ne t’attend.', ACCENT);
    const options = liste.map(({ o, ctx }) => {
      const type = EMOJIS_TYPES[o.type] ? o.type : 'other';
      return {
        label: nettoyerVariable(o.titre).slice(0, 100) || 'Événement',
        description: `${NOMS_TYPES[type]} · ${o.jour} ${o.heureDebut}${contextes.length > 1 ? ` · ${ctx.team.nom}` : ''} · ${ICONES_RSVP[o.monRsvp] ?? ICONES_RSVP.sans_reponse}`.slice(0, 100),
        value: `${o.evenementId}|${occurrenceCourte(o.cle)}`,
        emoji: { name: EMOJIS_TYPES[type] },
      };
    });
    return message({
      embeds: [embedReponse({ titre: '🗳️ Répondre à un événement', description: 'Choisis l’événement, puis réponds avec les boutons.' })],
      components: [{ type: 1, components: [{ type: 3, custom_id: 'rs', placeholder: 'Choisis un événement', options }] }],
    });
  }

  /** Embed d'une occurrence, avec boutons RSVP (réponse à /rsvp, menu). */
  async function carteRsvp(i, evId, occIso) {
    const { acteur, reponse } = await preparer(i);
    if (reponse) return reponse;
    const ev = await evenementDuServeur(evId, i.guild_id);
    if (!ev) return erreur('Événement introuvable sur ce serveur.');
    await noyau.contexteTeam(acteur, ev.team_id);
    const c = await contexteOccurrence(base, ev.team_id, evId, occIso, maintenant());
    if (!c || c.termine) return erreur('Cet événement est terminé ou annulé.');
    const moi = c.rsvpDe.get(acteur.compte) ?? 'sans_reponse';
    const embed = embedOccurrence(c, { genre: 'rsvp_choix', texte: `Ta réponse actuelle : **${ICONES_RSVP[moi]}**`, lien, maintenant: maintenant() });
    return miseAJour({ embeds: [embed], components: boutonsRsvp(evId, c.occurrence.cle, { lien }) });
  }

  async function bouttonRsvp(i, [evId, occCourte, choix]) {
    const { acteur, reponse } = await preparer(i);
    if (reponse) return reponse;
    const rsvpChoisi = REPONSES_BOUTONS[choix];
    const occIso = occurrenceLongue(occCourte);
    const ev = await evenementDuServeur(evId, i.guild_id);
    if (!rsvpChoisi || !occIso || !ev) return erreur('Événement introuvable sur ce serveur.');
    await p.repondre(acteur, ev.team_id, evId, occIso, { rsvp: rsvpChoisi });
    const c = await contexteOccurrence(base, ev.team_id, evId, occIso, maintenant());
    const titre = c ? nettoyerVariable(c.occurrence.titre) : 'cet événement';
    return avis(`${ICONES_RSVP[rsvpChoisi].split(' ')[0]} C’est noté`, `Ta réponse pour **${titre}** : **${ICONES_RSVP[rsvpChoisi]}**. L’app est à jour.`, COULEUR_OK);
  }

  async function dispo(i) {
    const { acteur, contextes, reponse } = await preparer(i);
    if (reponse) return reponse;
    const embeds = [];
    for (const ctx of contextes.filter(c => peut(c, 'availability.edit_own'))) {
      const d = await p.mesDispos(acteur, ctx.team.id);
      await journaliser(ctx.team.id, acteur, 'dispo');
      const champs = [];
      for (let jour = 1; jour <= 7; jour++) {
        const regles = d.regles.filter(r => r.jour === jour);
        champs.push({ nom: JOURS[jour], valeur: regles.length ? regles.map(r => `${r.type === 'indisponible' ? '🔴' : '🟢'} ${r.debut}–${r.fin}`).join('\n') : '—', inline: true });
      }
      const semaine = d.exceptions.filter(x => Date.parse(x.debut) < maintenant() + 7 * JOUR).slice(0, 8);
      if (semaine.length) champs.push({ nom: '📌 Exceptions cette semaine', valeur: semaine.map(x => `${x.type === 'indisponible' ? '🔴' : '🟢'} ${x.jour} ${x.heureDebut}–${x.heureFin}${x.note ? ` · ${nettoyerVariable(x.note)}` : ''}`).join('\n') });
      embeds.push(embedReponse({ titre: `🟢 Tes disponibilités · ${nettoyerVariable(ctx.team.nom)}`, description: d.regles.length ? `Fuseau : ${d.fuseau}. 🟢 disponible · 🔴 indisponible.` : 'Tu n’as encore rien saisi : ouvre l’app pour remplir ta semaine type.', champs, couleur: COULEUR_OK, lien }));
    }
    if (embeds.length === 0) return erreur('Le module Disponibilités n’est pas activé pour tes teams, ou tu n’as pas la permission de saisir tes dispos.');
    return message({ embeds, components: boutonLien(lien, 'Modifier dans l’app') });
  }

  async function taches(i, page = 1) {
    const { acteur, contextes, reponse } = await preparer(i);
    if (reponse) return reponse;
    const liste = [];
    let accessible = false;
    for (const ctx of contextes.filter(c => peut(c, 'goals_tasks.view'))) {
      accessible = true;
      const r = await objectifs.taches(acteur, ctx.team.id, { filtre: 'miennes' });
      await journaliser(ctx.team.id, acteur, 'taches');
      for (const t of r.taches.filter(x => x.statut !== 'fait')) liste.push({ t, ctx });
    }
    if (!accessible) return erreur('Le module Objectifs et tâches n’est pas activé pour tes teams.');
    liste.sort((a, b) => Number(b.t.enRetard) - Number(a.t.enRetard) || (a.t.echeance ?? '9999').localeCompare(b.t.echeance ?? '9999'));
    const retard = liste.filter(x => x.t.enRetard).length;
    const pg = paginer(liste, page, 6);
    const embed = embedReponse({
      titre: '✅ Tes tâches',
      description: liste.length ? `${liste.length} ouverte${liste.length > 1 ? 's' : ''}${retard ? ` · 🔴 **${retard} en retard**` : ''}` : 'Aucune tâche ouverte. Bravo !',
      couleur: retard ? COULEUR_ERREUR : COULEUR_OK,
      champs: pg.elements.map(({ t, ctx }) => ({
        nom: `${t.enRetard ? '🔴' : t.statut === 'en_cours' ? '🟡' : '⚪'} ${nettoyerVariable(t.titre)}`,
        valeur: [t.echeance ? `Échéance : ${t.echeance.split('-').reverse().join('/')}${t.enRetard ? ' (**en retard**)' : ''}` : 'Sans échéance', `Priorité : ${t.priorite}`, contextes.length > 1 ? `🏷️ ${nettoyerVariable(ctx.team.nom)}` : ''].filter(Boolean).join(' · '),
      })),
      pied: `Page ${pg.page} / ${pg.pages} · Esport`,
      lien,
    });
    return { embeds: [embed], components: [...boutonsPagination('taches', pg.page, pg.pages), ...boutonLien(lien)] };
  }

  const normaliser = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  async function strat(i, page = 1, args = {}) {
    const { acteur, contextes, reponse } = await preparer(i);
    if (reponse) return reponse;
    const ctx = teamVisee(contextes, args.team ?? opt(i, 'team'));
    const carteSaisie = normaliser(args.map ?? opt(i, 'map'));
    const r = await playbook.liste(acteur, ctx.team.id, { statut: 'validee' });
    await journaliser(ctx.team.id, acteur, 'strat');
    const carte = r.cartes.find(c => normaliser(c.cle) === carteSaisie || normaliser(c.nom) === carteSaisie) ?? { cle: carteSaisie.replace(/[^a-z0-9-]/g, ''), nom: args.map ?? opt(i, 'map') };
    const entrees = r.entrees.filter(e => e.carte?.cle === carte.cle);
    const pg = paginer(entrees, page, 6);
    const embed = embedReponse({
      titre: `🗺️ Strats validées · ${nettoyerVariable(carte.nom)}`,
      description: entrees.length ? `${entrees.length} entrée${entrees.length > 1 ? 's' : ''} validée${entrees.length > 1 ? 's' : ''} du playbook de **${nettoyerVariable(ctx.team.nom)}**.` : 'Aucune strat validée pour cette map dans le playbook.',
      champs: pg.elements.map(e => ({
        nom: `${e.favori ? '⭐ ' : ''}${nettoyerVariable(e.titre)}`,
        valeur: [[e.side ? SIDES[e.side] : '', TYPES_STRAT[e.type] ?? e.type].filter(Boolean).join(' · '), e.description ? nettoyerVariable(e.description).slice(0, 180) : '', e.tags.length ? e.tags.map(t => `\`${nettoyerVariable(t)}\``).join(' ') : ''].filter(Boolean).join('\n'),
      })),
      couleur: couleurType('scrim'),
      miniature: imageCarte(carte.cle),
      pied: `Page ${pg.page} / ${pg.pages} · Esport`,
      lien,
    });
    return { embeds: [embed], components: [...boutonsPagination(`strat.${carte.cle}.${ctx.team.id}`.slice(0, 80), pg.page, pg.pages), ...boutonLien(lien, 'Ouvrir le playbook')] };
  }

  async function resume(i) {
    const { acteur, contextes, reponse } = await preparer(i);
    if (reponse) return reponse;
    const ctx = teamVisee(contextes, opt(i, 'team'));
    const dateReunion = texteDate(dateLocale(ctx.team.fuseau, maintenant()));
    const depot = await resumes.deposer(acteur, ctx.team.id, { titre: opt(i, 'titre'), lien: String(opt(i, 'lien') ?? ''), typeId: opt(i, 'type'), dateReunion });
    await journaliser(ctx.team.id, acteur, 'resume');
    return avis('📥 Réunion déposée', `**${nettoyerVariable(depot.titre ?? opt(i, 'titre'))}** est dans la boîte des rédacteurs de **${nettoyerVariable(ctx.team.nom)}**. Tu seras prévenu quand le résumé sera publié.`, COULEUR_OK);
  }

  async function evenementCreer(i) {
    const { acteur, contextes, reponse } = await preparer(i);
    if (reponse) return reponse;
    const ctx = teamVisee(contextes, opt(i, 'team'));
    noyau.exiger(ctx, 'planning.create');
    const date = lireDateSaisie(opt(i, 'date'), ctx.team.fuseau, maintenant());
    if (!date) return erreur('Date illisible : 2026-10-24, 24/10, aujourd’hui ou demain.');
    const heure = lireHeureSaisie(opt(i, 'heure'));
    if (!heure) return erreur('Heure illisible : 20:30 ou 20h30.');
    const duree = Math.min(1440, Math.max(15, Number(opt(i, 'duree') ?? 120) || 120));
    const debutMin = lireHeure(heure);
    const groupe = ['joueurs', 'staff', 'tous'].includes(opt(i, 'convoques')) ? opt(i, 'convoques') : 'joueurs';
    const cree = await p.creer(acteur, ctx.team.id, { type: opt(i, 'type'), titre: opt(i, 'titre'), date, heureDebut: heure, heureFin: texteHeure((debutMin + duree) % 1440), convocation: convocationParGroupe(groupe) });
    const nombre = (cree.concernes ?? []).length;
    await journaliser(ctx.team.id, acteur, 'evenement-creer');
    const debut = Date.parse(cree.debut);
    const type = EMOJIS_TYPES[cree.type] ? cree.type : 'other';
    return avis(
      `${EMOJIS_TYPES[type]} Événement créé`,
      `**${nettoyerVariable(cree.titre)}** (${NOMS_TYPES[type]}) le ${horodatage(debut, 'F')}, ${horodatage(debut, 'R')}.\nConvoqués : **${groupe === 'tous' ? 'tous (sauf les Propriétaires)' : groupe}** (${nombre}). L’annonce part dans le salon de la team (si elle est activée).`,
      COULEUR_OK,
    );
  }

  async function relancer(i) {
    const { acteur, reponse } = await preparer(i);
    if (reponse) return reponse;
    const [evId, occCourte] = String(opt(i, 'evenement') ?? '').split('|');
    const occIso = occurrenceLongue(occCourte);
    const ev = await evenementDuServeur(evId, i.guild_id);
    if (!ev || !occIso) return erreur('Événement introuvable sur ce serveur : choisis-le dans la liste proposée.');
    const ctx = await noyau.contexteTeam(acteur, ev.team_id);
    noyau.exiger(ctx, 'planning.view');
    noyau.exiger(ctx, 'attendance.mark');
    const c = await contexteOccurrence(base, ev.team_id, evId, occIso, maintenant());
    if (!c || c.termine) return erreur('Cet événement est terminé ou annulé.');
    if (c.sansReponse.length === 0) return avis('👌 Personne à relancer', 'Tous les convoqués ont déjà répondu.', COULEUR_OK);
    await limite('discord_relance', `${evId}:${c.occurrence.cle}`);
    const t = maintenant();
    await base.lot([
      evenement('attendance.relance', {
        teamId: ev.team_id,
        acteur: acteur.compte,
        entiteType: 'evenement',
        entiteId: evId,
        charge: { evenementId: evId, occurrence: c.occurrence.cle, titre: c.occurrence.titre, type: c.occurrence.type, debut: new Date(c.occurrence.debut).toISOString(), sansReponse: c.sansReponse.length, origine: 'discord' },
        maintenant: t,
      }),
    ]);
    const lies = c.sansReponse.filter(m => m.discordId).length;
    return avis('🔔 Relance envoyée', `${c.sansReponse.length} convoqué${c.sansReponse.length > 1 ? 's' : ''} sans réponse pour **${nettoyerVariable(c.occurrence.titre)}** : ${lies} mentionné${lies > 1 ? 's' : ''} (comptes liés), les autres cités par leur pseudo. Un seul message, dans le salon de la team.`, COULEUR_OK);
  }

  // ------------------------------------------------------------ Autocomplétion

  async function autocomplete(i) {
    const choix = [];
    const focus = (i.data?.options ?? []).find(o => o.focused);
    const saisie = normaliser(focus?.value);
    const { acteur, contextes } = await preparer(i);
    if (acteur && contextes) {
      if (focus?.name === 'team') {
        for (const c of contextes) choix.push({ name: c.team.nom.slice(0, 100), value: c.team.id });
      } else if (i.data.name === 'strat' && focus?.name === 'map') {
        const vues = new Map();
        for (const c of contextes.filter(x => peut(x, 'playbook.view'))) {
          for (const carte of (await playbook.liste(acteur, c.team.id, { statut: 'validee' })).cartes) vues.set(carte.cle, carte.nom);
        }
        for (const [cle, nom] of vues) choix.push({ name: nom.slice(0, 100), value: cle });
      } else if (i.data.name === 'resume' && focus?.name === 'type') {
        const ctx = contextes.find(c => c.team.id === opt(i, 'team')) ?? contextes[0];
        for (const t of await resumes.typesReunion(acteur, ctx.team.id).catch(() => [])) choix.push({ name: `${t.nom}${t.visibilite === 'staff' ? ' (staff)' : ''}`.slice(0, 100), value: t.id });
      } else if (i.data.name === 'relancer' && focus?.name === 'evenement') {
        const liste = await aVenir(acteur, contextes, { jours: 14, garder: ({ ctx }) => peut(ctx, 'attendance.mark') });
        for (const { o, ctx } of liste) {
          const type = EMOJIS_TYPES[o.type] ? o.type : 'other';
          choix.push({ name: `${EMOJIS_TYPES[type]} ${o.titre} · ${o.jour} ${o.heureDebut}${contextes.length > 1 ? ` · ${ctx.team.nom}` : ''}`.slice(0, 100), value: `${o.evenementId}|${occurrenceCourte(o.cle)}` });
        }
      }
    }
    const filtres = choix.filter(c => !saisie || normaliser(c.name).includes(saisie)).slice(0, 25);
    return { type: REPONSE.CHOIX, data: { choices: filtres } };
  }

  // ------------------------------------------------------------ Aiguillage

  const COMMANDES = {
    aide,
    lier,
    delier,
    'esport-lier-serveur': lierServeur,
    prochain: i => prochain(i).then(r => (r.type ? r : message(r))),
    planning: i => planningCmd(i).then(r => (r.type ? r : message(r))),
    rsvp,
    dispo,
    taches: i => taches(i).then(r => (r.type ? r : message(r))),
    strat: i => strat(i).then(r => (r.type ? r : message(r))),
    resume,
    'evenement-creer': evenementCreer,
    relancer,
  };

  /** Pagination : `pg:<liste>[.<arguments>]:<page>` → la même liste, page demandée (mise à jour du message). */
  async function paginer_(i, cle, page) {
    const [liste, a, b] = cle.split('.');
    const n = Number(page);
    let r;
    if (liste === 'prochain') r = await prochain(i, n);
    else if (liste === 'planning') r = await planningCmd(i, n, { jours: a, team: b });
    else if (liste === 'taches') r = await taches(i, n);
    else if (liste === 'strat') r = await strat(i, n, { map: a, team: b });
    else return erreur('Liste inconnue.');
    return r.type ? r : miseAJour(r);
  }

  async function executer(i) {
    try {
      if (i.type === TYPE.COMMANDE) {
        const f = COMMANDES[i.data?.name];
        return f ? await f(i) : erreur('Commande inconnue : relance l’enregistrement des commandes (workflow Esport).');
      }
      if (i.type === TYPE.COMPOSANT) {
        const id = String(i.data?.custom_id ?? '');
        if (id === 'rs') {
          const [evId, occ] = String(i.data?.values?.[0] ?? '').split('|');
          return await carteRsvp(i, evId, occurrenceLongue(occ));
        }
        const r = /^r:([0-9a-f-]{36}):([0-9a-z]{1,12}):([opn])$/.exec(id);
        if (r) return await bouttonRsvp(i, r.slice(1));
        const pg = /^pg:([a-z0-9.-]{1,90}):(\d{1,4})$/.exec(id);
        if (pg) return await paginer_(i, pg[1], pg[2]);
        return erreur('Bouton inconnu ou expiré.');
      }
      return erreur('Interaction inconnue.');
    } catch (e) {
      return erreur(texteErreur(e));
    }
  }

  /** Suivi d'une réponse différée : remplace le message d'origine par la réponse finale. */
  async function suivi(i, reponse) {
    const { flags: _f, ...data } = reponse.data ?? {};
    await fetchDiscord(`${API_DISCORD}/webhooks/${config.applicationId}/${i.token}/messages/@original`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, allowed_mentions: { parse: [] } }),
      redirect: 'manual',
    });
  }

  /** Traite POST /discord/interactions. `attendre(promesse)` : waitUntil du Worker (suivi des réponses différées). */
  async function traiter(requete, { attendre } = {}) {
    if (!config.publicKey || !config.applicationId) return json({ erreur: 'Bot Discord non configuré (DISCORD_PUBLIC_KEY, DISCORD_APPLICATION_ID).', code: 'bot-absent' }, 503);
    const longueur = Number(requete.headers.get('Content-Length') ?? 0);
    if (longueur > TAILLE_MAX) return json({ erreur: 'Requête trop volumineuse.' }, 413);
    const corps = await requete.text();
    if (corps.length > TAILLE_MAX) return json({ erreur: 'Requête trop volumineuse.' }, 413);
    const verif = await verifierSignature({
      clePublique: config.publicKey,
      signature: requete.headers.get('X-Signature-Ed25519'),
      horodatage: requete.headers.get('X-Signature-Timestamp'),
      corps,
      maintenant: maintenant(),
    });
    if (!verif.ok) return json({ erreur: 'Signature invalide.', code: 'signature' }, 401);
    const i = jsonOu(corps, null);
    if (!i || typeof i !== 'object') return json({ erreur: 'Requête illisible.' }, 400);
    if (i.type === TYPE.PING) return json({ type: REPONSE.PONG });
    const utilisateur = i.member?.user ?? i.user;
    if (!utilisateur || !/^\d{5,25}$/.test(String(utilisateur.id ?? ''))) return json({ erreur: 'Utilisateur Discord absent.' }, 400);
    if (i.type === TYPE.AUTOCOMPLETE) {
      try {
        return json(await autocomplete(i));
      } catch {
        return json({ type: REPONSE.CHOIX, data: { choices: [] } });
      }
    }
    try {
      await limite('discord_commande', utilisateur.id);
    } catch (e) {
      return json(erreur(texteErreur(e)));
    }
    const travail = executer(i);
    const premier = await Promise.race([travail, attendreLent().then(() => LENT)]);
    if (premier !== LENT) return json(premier);
    // Trop lent pour les 3 s de Discord : réponse différée, puis suivi en arrière-plan.
    const majMessage = i.type === TYPE.COMPOSANT && /^(pg:|rs$)/.test(String(i.data?.custom_id ?? ''));
    const suite = travail.then(r => suivi(i, r)).catch(e => console.error('[esport] bot suivi', e));
    if (attendre) attendre(suite);
    return json(majMessage ? { type: REPONSE.DIFFERE_MAJ } : { type: REPONSE.DIFFERE, data: { flags: EPHEMERE } });
  }

  return { traiter, executer };
}
