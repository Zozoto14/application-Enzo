/**
 * Pont entre un événement du club (Administration › Événements) et un tournoi du site LigneZero.
 *
 * Les équipes se créent et se modifient UNIQUEMENT dans l'app (le site n'a plus de bouton pour en créer) : l'app fait
 * foi. Un événement se lie à un tournoi du site (« Site LigneZero » dans sa fiche), puis :
 *  - équipe ajoutée dans l'app (à la main ou importée des tickets) → créée sur le site avec ses joueurs ;
 *  - équipe modifiée dans l'app (nom, TAG, joueurs, Discord ID, Embark ID) → modifiée sur le site ; une différence
 *    côté site (ancienne modification) est écrasée par la version de l'app ;
 *  - équipe retirée dans l'app → retirée du site ; retirée du site seulement → recréée sur le site ;
 *  - équipes déjà présentes sur le site avant le lien (anciennes inscriptions) : reprises dans l'événement, pas perdues.
 * Tout de suite après chaque changement fait dans l'app, toutes les 5 minutes par le cron, ou avec « Synchroniser ».
 *
 * Suivi : club_evenements.site_tournoi_id, club_evenement_equipes.site_equipe_id et site_empreinte (état commun lors
 * de la dernière synchronisation, pour savoir quel côté a changé) — migration 0070.
 */

import { echec, iso, jsonOu } from '../outils.mjs';
import { instructionReglage } from '../tickets/reglages.mjs';
import { equipesDe } from '../evenements-club/discord.mjs';

/** Acteur des synchronisations (cron, pont) : jamais issu d'une requête HTTP (comparé par identité). */
export const ACTEUR_SITE = Object.freeze({ superAdmin: true, compte: null, nom: 'Site LigneZero', systeme: true });

const ID_DISCORD = /^\d{17,20}$/;
const TAG = /^[\p{L}\p{N}]{1,6}$/u;
const UUID = /^[0-9a-f-]{36}$/i;

// ------------------------------------------------------------------ Conversions app ↔ site

export const posteDuRole = role => (/coach/i.test(role ?? '') ? 'coach' : /rempla|sub/i.test(role ?? '') ? 'remplacant' : 'joueur');
const roleDuPoste = poste => (poste === 'coach' ? 'Coach' : poste === 'remplacant' ? 'Remplaçant' : null);

/** Membres de l'app → joueurs du site (le premier joueur est capitaine). */
export function joueursSite(equipeSiteId, membres) {
  const capitaine = membres.findIndex(m => m.poste === 'joueur');
  return membres.map((m, i) => ({
    team_id: equipeSiteId,
    pseudo: (m.nom || String(m.embarkId ?? '').replace(/#\d+$/, '') || 'Joueur').slice(0, 40),
    role: roleDuPoste(m.poste),
    is_captain: i === capitaine,
    discord_id: m.discordId ?? null,
    embark_id: m.embarkId || null,
    sort_order: i,
  }));
}

/** Joueurs du site → membres de l'app. */
export function membresApp(joueurs) {
  return [...joueurs]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .slice(0, 10)
    .map(j => ({
      poste: posteDuRole(j.role),
      discordId: ID_DISCORD.test(String(j.discord_id ?? '')) ? String(j.discord_id) : null,
      nom: String(j.pseudo ?? '').slice(0, 100),
      embarkId: String(j.embark_id ?? '').slice(0, 60),
    }));
}

/** Empreinte d'une équipe (forme de l'app) : sert à savoir quel côté a changé depuis la dernière synchronisation. */
export function empreinte({ nom, tag, membres }) {
  return JSON.stringify([String(nom ?? '').trim(), String(tag ?? '').toUpperCase(), (membres ?? []).map(m => [m.poste, m.discordId ?? '', String(m.nom ?? '').trim(), String(m.embarkId ?? '').trim()])]);
}

/** TAG pour une équipe du site qui n'en a pas (ou déjà pris) : initiales du nom, numérotées si besoin. */
export function tagLibre(souhait, nom, pris) {
  const propre = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]/gu, '').toUpperCase();
  let base = propre(souhait).slice(0, 6);
  if (!base || !TAG.test(base)) {
    const mots = String(nom ?? '').split(/\s+/).map(propre).filter(Boolean);
    base = (mots.length > 1 ? mots.map(m => m[0]).join('') : mots[0] ?? 'EQ').slice(0, 4) || 'EQ';
  }
  if (!pris.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const t = `${base.slice(0, 6 - String(i).length)}${i}`;
    if (!pris.has(t)) return t;
  }
  return `EQ${Date.now() % 10000}`;
}

// ------------------------------------------------------------------ Pont

export function creerPontSite({ base, ev, site, maintenant = () => Date.now(), journal = console }) {
  const lireEtat = async id => jsonOu((await base.premier('SELECT valeur FROM tickets_reglages WHERE cle = ?', [`site_evenement:${id}`]))?.valeur, null);
  const ecrireEtat = async (id, etat) => {
    const i = instructionReglage(`site_evenement:${id}`, etat, null, maintenant());
    await base.executer(i.sql, i.params);
  };

  async function equipeSite(siteId, l) {
    await site.supprimerOu('tournament_players', 'team_id', siteId);
    if (l.membres.length) await site.inserer('tournament_players', joueursSite(siteId, l.membres));
  }

  /** Synchronise un événement lié ; rend le bilan (aussi gardé pour l'écran). */
  async function synchroniser(evenementId) {
    const evt = await base.premier('SELECT * FROM club_evenements WHERE id = ?', [evenementId]);
    if (!evt?.site_tournoi_id) return null;
    const bilan = { ok: true, envoyees: 0, recues: 0, majSite: 0, majApp: 0, supprimees: 0, erreurs: [], le: iso(maintenant()) }; // majApp, supprimees : toujours 0 (l'app fait foi)
    const noterErreur = (quoi, e) => bilan.erreurs.length < 10 && bilan.erreurs.push(`${quoi} : ${e?.message ?? e}`);
    try {
      const equipesS = await site.lister('tournament_teams', [{ col: 'tournament_id', op: 'eq', val: evt.site_tournoi_id }]);
      const joueursS = equipesS.length ? await site.lister('tournament_players', [{ col: 'team_id', op: 'in', val: equipesS.map(e => e.id) }]) : [];
      const sitePar = new Map(equipesS.map(e => [e.id, { ...e, membres: membresApp(joueursS.filter(j => j.team_id === e.id)) }]));
      const lignes = new Map((await base.tous('SELECT id, site_equipe_id, site_empreinte FROM club_evenement_equipes WHERE evenement_id = ?', [evenementId])).map(l => [l.id, l]));
      const locales = (await equipesDe(base, evenementId)).map(e => ({ ...e, ...lignes.get(e.id) }));
      const lies = new Set();
      const noterLien = (id, siteId, f) => base.executer('UPDATE club_evenement_equipes SET site_equipe_id = ?, site_empreinte = ? WHERE id = ?', [siteId, f, id]);

      for (const l of locales) {
        try {
          const fL = empreinte(l);
          if (!l.site_equipe_id) {
            const [s] = await site.inserer('tournament_teams', [{ tournament_id: evt.site_tournoi_id, name: l.nom, tag: l.tag }]);
            await equipeSite(s.id, l);
            await noterLien(l.id, s.id, fL);
            lies.add(s.id);
            bilan.envoyees++;
            continue;
          }
          const s = sitePar.get(l.site_equipe_id);
          if (!s) {
            // Disparue du site : l'app fait foi, elle y est recréée.
            const [n] = await site.inserer('tournament_teams', [{ tournament_id: evt.site_tournoi_id, name: l.nom, tag: l.tag }]);
            await equipeSite(n.id, l);
            await noterLien(l.id, n.id, fL);
            lies.add(n.id);
            bilan.envoyees++;
            continue;
          }
          lies.add(s.id);
          const fS = empreinte({ nom: s.name, tag: s.tag, membres: s.membres });
          if (fL !== fS) {
            await site.modifier('tournament_teams', s.id, { name: l.nom, tag: l.tag });
            await equipeSite(s.id, l);
            bilan.majSite++;
          }
          if (l.site_empreinte !== fL) await noterLien(l.id, s.id, fL);
        } catch (e) {
          noterErreur(l.nom, e);
        }
      }

      // Équipes présentes sur le site sans équipe de l'app (anciennes inscriptions) : reprises dans l'événement.
      const pris = new Set(locales.map(x => x.tag.toUpperCase()));
      for (const s of sitePar.values()) {
        if (lies.has(s.id) || locales.some(l => l.site_equipe_id === s.id)) continue;
        try {
          const tag = tagLibre(s.tag, s.name, pris);
          pris.add(tag);
          await ev.ajouterEquipes(ACTEUR_SITE, evenementId, { equipes: [{ nom: s.name, tag, membres: s.membres }] });
          const nouvelle = await base.premier('SELECT id FROM club_evenement_equipes WHERE evenement_id = ? AND UPPER(tag) = ?', [evenementId, tag]);
          if (nouvelle) await noterLien(nouvelle.id, s.id, empreinte({ nom: s.name, tag, membres: s.membres }));
          if (tag !== s.tag) await site.modifier('tournament_teams', s.id, { tag });
          bilan.recues++;
        } catch (e) {
          noterErreur(s.name, e);
        }
      }
    } catch (e) {
      noterErreur('site', e);
    }
    bilan.ok = bilan.erreurs.length === 0;
    await ecrireEtat(evenementId, bilan);
    if (!bilan.ok) journal.error?.('[esport] site LZ : synchronisation', bilan.erreurs.join(' ; '));
    return bilan;
  }

  // Une seule synchronisation à la fois par événement (le cron et un changement dans l'app peuvent se croiser).
  const enCours = new Map();
  const synchroniserUne = id => {
    if (!enCours.has(id)) enCours.set(id, synchroniser(id).finally(() => enCours.delete(id)));
    return enCours.get(id);
  };

  /** Branché sur l'événement : après un changement d'équipes fait dans l'app. */
  async function apres(evenementId) {
    await synchroniserUne(evenementId).catch(e => journal.error?.('[esport] site LZ', e?.message ?? e));
  }
  /** Équipe retirée dans l'app : retirée du site aussi. */
  async function equipeSupprimee(e) {
    if (e?.site_equipe_id) await site.supprimer('tournament_teams', e.site_equipe_id).catch(err => journal.error?.('[esport] site LZ : retrait', err?.message ?? err));
  }

  // ---------------------------------------------------------------- Routes (droits : ceux de l'événement)

  async function vue(acteur, id) {
    await ev.exiger(acteur);
    const evt = await base.premier('SELECT id, site_tournoi_id FROM club_evenements WHERE id = ?', [id]);
    if (!evt) throw echec(404, 'evenement-introuvable', 'Événement introuvable.');
    let tournois = [];
    let erreur = null;
    if (!site.configure) erreur = 'Site LigneZero introuvable sur cet hébergement (clé de service absente).';
    else {
      try {
        tournois = (await site.lister('tournaments', [], [{ col: 'created_at', asc: false }])).map(t => ({ id: t.id, nom: t.name, statut: t.status }));
      } catch (e) {
        erreur = e?.message ?? 'Site injoignable';
      }
    }
    return { tournoiId: evt.site_tournoi_id ?? null, tournois, erreur, etat: await lireEtat(id) };
  }

  async function lier(acteur, id, corps) {
    await ev.exiger(acteur);
    const tournoiId = corps?.tournoiId ?? null;
    if (tournoiId !== null && (typeof tournoiId !== 'string' || !UUID.test(tournoiId))) throw echec(400, 'site-tournoi', 'Tournoi du site invalide.');
    const evt = await base.premier('SELECT id, site_tournoi_id FROM club_evenements WHERE id = ?', [id]);
    if (!evt) throw echec(404, 'evenement-introuvable', 'Événement introuvable.');
    if (tournoiId) {
      const deja = await base.premier('SELECT nom FROM club_evenements WHERE site_tournoi_id = ? AND id <> ?', [tournoiId, id]);
      if (deja) throw echec(409, 'site-tournoi-pris', `Ce tournoi du site est déjà lié à l’événement « ${deja.nom} ».`);
    }
    if (tournoiId !== evt.site_tournoi_id) {
      await base.executer('UPDATE club_evenements SET site_tournoi_id = ? WHERE id = ?', [tournoiId, id]);
      // Nouveau lien (ou lien retiré) : on repart de zéro, sans rien supprimer d'un côté ni de l'autre.
      await base.executer('UPDATE club_evenement_equipes SET site_equipe_id = NULL, site_empreinte = NULL WHERE evenement_id = ?', [id]);
      if (tournoiId) await rapprocher(id, tournoiId);
    }
    if (tournoiId) await synchroniserUne(id);
    return vue(acteur, id);
  }

  /** Premier lien : les équipes déjà présentes des deux côtés (même nom ou même TAG) sont rapprochées, pas dupliquées. */
  async function rapprocher(id, tournoiId) {
    const equipesS = await site.lister('tournament_teams', [{ col: 'tournament_id', op: 'eq', val: tournoiId }]);
    const cle = s => String(s ?? '').trim().toLowerCase();
    const prises = new Set();
    for (const l of await base.tous('SELECT id, nom, tag FROM club_evenement_equipes WHERE evenement_id = ?', [id])) {
      const s = equipesS.find(x => !prises.has(x.id) && (cle(x.name) === cle(l.nom) || (x.tag && cle(x.tag) === cle(l.tag))));
      if (!s) continue;
      prises.add(s.id);
      // Empreinte vide : à la synchronisation qui suit, la version de l'app est envoyée au site.
      await base.executer('UPDATE club_evenement_equipes SET site_equipe_id = ?, site_empreinte = ? WHERE id = ?', [s.id, '', l.id]);
    }
  }

  async function synchroniserMaintenant(acteur, id) {
    await ev.exiger(acteur);
    const evt = await base.premier('SELECT site_tournoi_id FROM club_evenements WHERE id = ?', [id]);
    if (!evt) throw echec(404, 'evenement-introuvable', 'Événement introuvable.');
    if (!evt.site_tournoi_id) throw echec(400, 'site-non-lie', 'Choisissez d’abord le tournoi du site.');
    await synchroniserUne(id);
    return vue(acteur, id);
  }

  /** Cron : événements liés, ni terminés ni annulés. */
  async function tacheCron() {
    if (!site.configure) return { evenements: 0 };
    const liste = await base.tous("SELECT id FROM club_evenements WHERE site_tournoi_id IS NOT NULL AND statut NOT IN ('termine', 'annule')", []);
    for (const e of liste) await synchroniserUne(e.id);
    return { evenements: liste.length };
  }

  return { synchroniser: synchroniserUne, apres, equipeSupprimee, vue, lier, synchroniserMaintenant, tacheCron };
}
