/**
 * Module « Ressources » (clé `resources`) : le canal de ressources de la team, rangé en catégories
 * configurables. Une ressource est un lien web (aperçu récupéré par le serveur, protégé contre la
 * SSRF : apercu.mjs), une vidéo YouTube (lecteur intégré, « Ouvrir en review vidéo »), un fichier
 * déposé (PDF, image, vidéo, archive : même envoi par morceaux que les vidéos, stockage privé) ou une
 * simple note (Markdown limité, comme les notes de review).
 *
 * Contrôles, dans l'ordre : session (api.mjs) → appartenance à la team (contexteTeam) → module
 * `resources` activé → permission :
 *  - `resources.view` : lire le canal, réagir, commenter, favoris (tous les rôles système) ;
 *  - `resources.post` : publier (staff et Fondateur). Sans elle, si la team a coché « les joueurs
 *    peuvent proposer », une ressource part dans la FILE DE VALIDATION du staff ;
 *  - `resources.manage` : modifier ou supprimer celles des autres, épingler, gérer les catégories,
 *    valider ou refuser les propositions, réglages.
 * Visibilité par ressource : toute la team, ou le staff seulement (ceux qui publient ou gèrent) ; une
 * ressource invisible répond 404, comme celle d'une autre team.
 *
 * Bus : resource.* et resource_category.* (journal, notifications in-app, Discord « Nouvelle
 * ressource » pour les seules ressources publiées et visibles de toute la team).
 */

import { evenement } from '../evenements.mjs';
import { autorise } from '../permissions.mjs';
import { echec, iso, jsonOu, nouvelId, texteNettoye } from '../outils.mjs';
import { lignesParIds, pseudosDe } from '../requetes.mjs';
import { NOTE_MAX, lienSur, nettoyerNote } from '../review/markdown.mjs';
import { adresseYoutube, extraireYoutube } from '../review/youtube.mjs';
import { normaliser, tagsPropres } from '../strats/service.mjs';
import { chiffrerWebhook, finDeWebhook, masquerWebhook, validerUrlWebhook } from '../discord/chiffrement.mjs';
import { fichierPublic } from '../medias/service.mjs';
import { recupererApercu, telechargeurFetch } from './apercu.mjs';

export const MODULE_RESSOURCES = 'resources';
export const GENRES_RESSOURCE = ['lien', 'youtube', 'fichier', 'note'];
export const NIVEAUX = ['debutant', 'intermediaire', 'avance'];
export const VISIBILITES = ['team', 'staff'];
/** Réactions permises (une fois chacune par membre et par ressource). */
export const EMOJIS = ['👍', '🔥', '❤️', '😂', '🤯', '👀'];
/** Catégories créées à la première ouverture du module : [clé, nom français]. */
export const CATEGORIES_DEFAUT = [
  ['guides', 'Guides'],
  ['videos_pros', 'Vidéos pros'],
  ['lineups', 'Lineups'],
  ['aim', 'Aim et entraînement'],
  ['outils', 'Outils'],
  ['mental', 'Mental'],
  ['divers', 'Divers'],
];
export const CATEGORIES_MAX = 30;
export const RESSOURCES_MAX = 2000;
export const COMMENTAIRE_MAX = 2000;
export const TEAMS_MULTI_MAX = 20;
/** Fichiers déposés : lien de lecture de 2 h (comme une vidéo). */
const DUREE_LIEN_FICHIER_MS = 2 * 3600 * 1000;
const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MOTIF_CLE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MOTIF_SALON = /^[0-9]{5,25}$/;

const exigerUuid = (v, quoi, message) => {
  if (typeof v !== 'string' || !MOTIF_UUID.test(v)) throw echec(404, `${quoi}-introuvable`, message);
  return v;
};

/** Repère facultatif du jeu (carte ou agent) : `{ cle, nom }` ou null. */
function lireRepereJeu(v, quoi) {
  if (v === null || v === undefined || v === '') return { cle: null, nom: null };
  if (typeof v !== 'object' || !MOTIF_CLE.test(String(v.cle ?? ''))) throw echec(400, quoi, quoi === 'carte' ? 'Carte illisible.' : 'Agent illisible.');
  return { cle: v.cle, nom: texteNettoye(v.nom, 40) || v.cle };
}

/**
 * Filtres combinés (purs, testés) : catégorie (`sans` : sans catégorie), tag, carte, agent, genre,
 * auteur, niveau, favoris, texte (titre, description, tags, aperçu, carte, agent ; sans accents ni casse).
 */
export function filtrerRessources(liste, f = {}) {
  const q = normaliser(f.q ?? '');
  const tag = normaliser(f.tag ?? '');
  return liste.filter(r => {
    if (f.categorie === 'sans' ? r.categorie !== null : f.categorie && r.categorie?.id !== f.categorie) return false;
    if (f.genre && r.genre !== f.genre) return false;
    if (f.carte && r.carte?.cle !== f.carte) return false;
    if (f.agent && r.agent?.cle !== f.agent) return false;
    if (f.niveau && r.niveau !== f.niveau) return false;
    if (f.auteur && r.auteur?.compte !== f.auteur) return false;
    if (f.favoris && !r.favori) return false;
    if (tag && !r.tags.some(t => normaliser(t) === tag)) return false;
    if (q) {
      const texte = normaliser([r.titre, r.description, r.tags.join(' '), r.apercu?.titre, r.apercu?.description, r.apercu?.site, r.carte?.nom, r.agent?.nom, r.fichier?.nom].filter(Boolean).join(' '));
      if (!texte.includes(q)) return false;
    }
    return true;
  });
}

/** Ordre du fil : épinglées d'abord, puis la plus récente en premier. */
export function trierRessources(liste) {
  const date = r => r.publieLe ?? r.creeLe;
  return [...liste].sort((a, b) => Number(b.epingle) - Number(a.epingle) || (date(a) < date(b) ? 1 : date(a) > date(b) ? -1 : 0));
}

/**
 * `socle` : services du cœur ; `medias` : envois par morceaux et liens signés ; `review` : création
 * d'une review depuis une vidéo ; `cleDiscord` : secret de chiffrement des webhooks ; `apercu` :
 * `{ telecharger, resoudre }` (téléchargeur protégé ; défaut : fetch du runtime).
 */
export function servicesRessources({ base, maintenant = () => Date.now(), socle, medias, review, cleDiscord, apercu = {} }) {
  const { contexteTeam } = socle;
  const peut = (ctx, p) => autorise(ctx.permissions, ctx.modules, p);
  const telecharger = apercu.telecharger ?? telechargeurFetch();
  const resoudre = apercu.resoudre;

  // -------------------------------------------------------------- Contexte et droits

  async function reglagesDe(teamId) {
    const l = await base.premier('SELECT * FROM ressource_reglages WHERE team_id = ?', [teamId]);
    return { propositions: Number(l?.propositions ?? 0) === 1, salonId: l?.discord_salon_id ?? null, webhook: l?.discord_webhook ?? null, webhookFin: l?.discord_webhook_fin ?? null };
  }

  /** Appartenance → module → resources.view ; rend le contexte et les droits du membre dans le canal. */
  async function contexte(acteur, teamId) {
    const ctx = await contexteTeam(acteur, teamId);
    if (!ctx.modules.has(MODULE_RESSOURCES)) throw echec(404, 'module-desactive', 'Ce module n’est pas activé pour cette team.');
    if (!peut(ctx, 'resources.view')) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const reglages = await reglagesDe(teamId);
    const poster = peut(ctx, 'resources.post');
    const gerer = peut(ctx, 'resources.manage');
    ctx.droits = { poster, gerer, staff: poster || gerer, proposer: !poster && reglages.propositions, discord: peut(ctx, 'discord.manage') };
    ctx.reglages = reglages;
    return ctx;
  }

  const exigerGerer = ctx => {
    if (!ctx.droits.gerer) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
  };

  /** La ressource est-elle visible du membre ? (une ressource invisible est « introuvable »). */
  function visible(ctx, r) {
    if (r.supprime_le) return false;
    if (r.statut === 'publiee') return r.visibilite === 'team' || ctx.droits.staff;
    return ctx.droits.gerer || r.auteur_id === ctx.acteur.compte;
  }

  async function ressourceVisible(ctx, id) {
    exigerUuid(id, 'ressource', 'Ressource introuvable.');
    const r = await base.premier('SELECT * FROM ressources WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [id, ctx.team.id]);
    if (!r || !visible(ctx, r)) throw echec(404, 'ressource-introuvable', 'Ressource introuvable.');
    return r;
  }

  const peutModifier = (ctx, r) => ctx.droits.gerer || (r.auteur_id === ctx.acteur.compte && (ctx.droits.poster || r.statut !== 'publiee'));
  const peutSupprimer = (ctx, r) => ctx.droits.gerer || r.auteur_id === ctx.acteur.compte;

  // -------------------------------------------------------------- Catégories

  /** Crée les catégories par défaut si la team n'en a jamais eu (idempotent : index unique). */
  async function assurerCategories(teamId) {
    const n = await base.premier('SELECT COUNT(*) AS n FROM ressource_categories WHERE team_id = ?', [teamId]);
    if (Number(n?.n ?? 0) > 0) return;
    const t = iso(maintenant());
    await base.lot(
      CATEGORIES_DEFAUT.map(([cle, nom], i) => ({
        sql: 'INSERT INTO ressource_categories (id, team_id, nom, cle_defaut, position, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (team_id, cle_defaut) DO NOTHING',
        params: [nouvelId(), teamId, nom, cle, i, t, t],
      })),
    );
  }

  async function categoriesDe(teamId) {
    await assurerCategories(teamId);
    return base.tous('SELECT * FROM ressource_categories WHERE team_id = ? AND supprime_le IS NULL ORDER BY position, cree_le, id', [teamId]);
  }

  const categoriePublique = c => (c ? { id: c.id, nom: c.nom, cleDefaut: c.cle_defaut ?? null, position: Number(c.position) } : null);

  async function categorieDeTeam(teamId, id) {
    exigerUuid(id, 'categorie', 'Catégorie introuvable.');
    const c = await base.premier('SELECT * FROM ressource_categories WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [id, teamId]);
    if (!c) throw echec(404, 'categorie-introuvable', 'Catégorie introuvable.');
    return c;
  }

  function lireNomCategorie(v) {
    const nom = texteNettoye(v, 40);
    if (nom.length < 2) throw echec(400, 'nom', 'Nom de la catégorie : 2 caractères au moins.');
    return nom;
  }

  async function nomLibre(teamId, nom, sauf) {
    const autres = await base.tous('SELECT id, nom FROM ressource_categories WHERE team_id = ? AND supprime_le IS NULL', [teamId]);
    if (autres.some(c => c.id !== sauf && normaliser(c.nom) === normaliser(nom))) throw echec(409, 'categorie-existe', 'Une catégorie porte déjà ce nom.');
  }

  async function creerCategorie(acteur, teamId, corps) {
    const ctx = await contexte(acteur, teamId);
    exigerGerer(ctx);
    const existantes = await categoriesDe(teamId);
    if (existantes.length >= CATEGORIES_MAX) throw echec(409, 'trop-de-categories', `Une team a ${CATEGORIES_MAX} catégories au plus.`);
    const nom = lireNomCategorie(corps?.nom);
    await nomLibre(teamId, nom);
    const t = maintenant();
    const id = nouvelId();
    const position = existantes.reduce((m, c) => Math.max(m, Number(c.position)), -1) + 1;
    await base.lot([
      { sql: 'INSERT INTO ressource_categories (id, team_id, nom, cle_defaut, position, cree_le, maj_le) VALUES (?, ?, ?, NULL, ?, ?, ?)', params: [id, teamId, nom, position, iso(t), iso(t)] },
      evenement('resource_category.created', { teamId, acteur: acteur.compte, entiteType: 'ressource_categorie', entiteId: id, charge: { nom }, maintenant: t }),
    ]);
    return categoriePublique(await categorieDeTeam(teamId, id));
  }

  async function modifierCategorie(acteur, teamId, id, corps) {
    const ctx = await contexte(acteur, teamId);
    exigerGerer(ctx);
    const c = await categorieDeTeam(teamId, id);
    const nom = lireNomCategorie(corps?.nom);
    if (nom !== c.nom) {
      await nomLibre(teamId, nom, id);
      const t = maintenant();
      // Renommée : ce n'est plus la catégorie par défaut (son nom n'est plus traduit).
      await base.lot([
        { sql: 'UPDATE ressource_categories SET nom = ?, cle_defaut = NULL, maj_le = ? WHERE id = ? AND team_id = ?', params: [nom, iso(t), id, teamId] },
        evenement('resource_category.updated', { teamId, acteur: acteur.compte, entiteType: 'ressource_categorie', entiteId: id, charge: { de: c.nom, nom }, maintenant: t }),
      ]);
    }
    return categoriePublique(await categorieDeTeam(teamId, id));
  }

  /** Supprime une catégorie : ses ressources restent, « sans catégorie ». */
  async function supprimerCategorie(acteur, teamId, id) {
    const ctx = await contexte(acteur, teamId);
    exigerGerer(ctx);
    const c = await categorieDeTeam(teamId, id);
    const t = maintenant();
    await base.lot([
      { sql: 'UPDATE ressource_categories SET supprime_le = ?, cle_defaut = NULL, maj_le = ? WHERE id = ? AND team_id = ?', params: [iso(t), iso(t), id, teamId] },
      { sql: 'UPDATE ressources SET categorie_id = NULL WHERE categorie_id = ? AND team_id = ?', params: [id, teamId] },
      evenement('resource_category.deleted', { teamId, acteur: acteur.compte, entiteType: 'ressource_categorie', entiteId: id, charge: { nom: c.nom }, maintenant: t }),
    ]);
    return { ok: true, categories: (await categoriesDe(teamId)).map(categoriePublique) };
  }

  /** Nouvel ordre des catégories : `ids` dans l'ordre voulu (toutes celles de la team). */
  async function ordonnerCategories(acteur, teamId, corps) {
    const ctx = await contexte(acteur, teamId);
    exigerGerer(ctx);
    const actuelles = await categoriesDe(teamId);
    const ids = Array.isArray(corps?.ids) ? corps.ids : null;
    if (!ids || ids.length !== actuelles.length || new Set(ids).size !== ids.length || !ids.every(i => actuelles.some(c => c.id === i))) {
      throw echec(400, 'ordre', 'Ordre illisible : donnez toutes les catégories, une fois chacune.');
    }
    const t = maintenant();
    await base.lot([
      ...ids.map((id, position) => ({ sql: 'UPDATE ressource_categories SET position = ?, maj_le = ? WHERE id = ? AND team_id = ?', params: [position, iso(t), id, teamId] })),
      evenement('resource_category.reordered', { teamId, acteur: acteur.compte, entiteType: 'ressource_categorie', entiteId: null, charge: {}, maintenant: t }),
    ]);
    return { categories: (await categoriesDe(teamId)).map(categoriePublique) };
  }

  // -------------------------------------------------------------- Lecture

  /** Réactions, commentaires, favoris et fichiers de plusieurs ressources (requêtes groupées). */
  async function ressourcesPubliques(ctx, lignes, { derniereVisite = null } = {}) {
    const ids = lignes.map(r => r.id);
    const moi = ctx.acteur.compte;
    const reactions = new Map();
    for (const x of await lignesParIds(base, 'SELECT ressource_id, emoji, compte_id FROM ressource_reactions WHERE team_id = ? AND ressource_id', ids, { paramsAvant: [ctx.team.id] })) {
      const parEmoji = reactions.get(x.ressource_id) ?? new Map();
      const e = parEmoji.get(x.emoji) ?? { emoji: x.emoji, n: 0, moi: false };
      e.n++;
      if (x.compte_id === moi) e.moi = true;
      parEmoji.set(x.emoji, e);
      reactions.set(x.ressource_id, parEmoji);
    }
    const commentaires = new Map(
      (await lignesParIds(base, 'SELECT ressource_id, COUNT(*) AS n FROM ressource_commentaires WHERE team_id = ? AND supprime_le IS NULL AND ressource_id', ids, { paramsAvant: [ctx.team.id], apres: 'GROUP BY ressource_id' })).map(l => [l.ressource_id, Number(l.n)]),
    );
    const favoris = new Set((await lignesParIds(base, 'SELECT ressource_id FROM ressource_favoris WHERE compte_id = ? AND ressource_id', ids, { paramsAvant: [moi] })).map(l => l.ressource_id));
    const fichiers = new Map((await lignesParIds(base, 'SELECT * FROM fichiers WHERE team_id = ? AND id', lignes.map(r => r.fichier_id), { paramsAvant: [ctx.team.id] })).map(f => [f.id, f]));
    const categories = new Map((await base.tous('SELECT * FROM ressource_categories WHERE team_id = ? AND supprime_le IS NULL', [ctx.team.id])).map(c => [c.id, c]));
    const noms = await pseudosDe(base, lignes.flatMap(r => [r.auteur_id, r.valide_par]));
    return lignes.map(r => {
      const f = r.fichier_id ? fichiers.get(r.fichier_id) : null;
      const auteur = r.auteur_id ? { compte: r.auteur_id, pseudo: noms[r.auteur_id] ?? null } : null;
      const publieLe = r.publie_le ?? null;
      return {
        id: r.id,
        genre: r.genre,
        titre: r.titre,
        description: r.description,
        url: r.url ?? null,
        videoId: r.video_id ?? null,
        fichier: f ? fichierPublic(f) : null,
        apercu: jsonOu(r.apercu, null),
        tags: jsonOu(r.tags, []),
        carte: r.carte ? { cle: r.carte, nom: r.carte_nom ?? r.carte } : null,
        agent: r.agent ? { cle: r.agent, nom: r.agent_nom ?? r.agent } : null,
        niveau: r.niveau ?? null,
        visibilite: r.visibilite,
        statut: r.statut,
        motifRefus: r.statut === 'refusee' ? (r.motif_refus ?? '') : null,
        epingle: Number(r.epingle) === 1,
        favori: favoris.has(r.id),
        categorie: categoriePublique(r.categorie_id ? categories.get(r.categorie_id) : null),
        auteur,
        validePar: r.valide_par ? { compte: r.valide_par, pseudo: noms[r.valide_par] ?? null } : null,
        multiTeams: Boolean(r.groupe_id),
        reviewId: r.review_id ?? null,
        reactions: [...(reactions.get(r.id)?.values() ?? [])].sort((a, b) => EMOJIS.indexOf(a.emoji) - EMOJIS.indexOf(b.emoji)),
        commentaires: commentaires.get(r.id) ?? 0,
        nouveau: Boolean(r.statut === 'publiee' && publieLe && derniereVisite && publieLe > derniereVisite && r.auteur_id !== moi),
        creeLe: r.cree_le,
        majLe: r.maj_le,
        publieLe,
        moi: { modifier: peutModifier(ctx, r), supprimer: peutSupprimer(ctx, r), epingler: ctx.droits.gerer, valider: ctx.droits.gerer && r.statut === 'proposee' },
      };
    });
  }

  /**
   * Le fil du canal. Filtres : `categorie`, `tag`, `carte`, `agent`, `genre`, `auteur`, `niveau`,
   * `favoris`, `q` ; `file=1` : la file de validation (propositions en attente ; staff), `miennes=1` :
   * mes propositions. Rend aussi les catégories, les facettes, le compteur « nouveau depuis ma
   * dernière visite » et mes droits.
   */
  async function liste(acteur, teamId, filtres = {}) {
    const ctx = await contexte(acteur, teamId);
    if (filtres.genre && !GENRES_RESSOURCE.includes(filtres.genre)) throw echec(400, 'genre', 'Filtre genre inconnu.');
    if (filtres.niveau && !NIVEAUX.includes(filtres.niveau)) throw echec(400, 'niveau', 'Filtre niveau inconnu.');
    const categories = await categoriesDe(teamId);
    const lignes = await base.tous('SELECT * FROM ressources WHERE team_id = ? AND supprime_le IS NULL ORDER BY cree_le DESC LIMIT ?', [teamId, RESSOURCES_MAX]);
    const visibles = lignes.filter(r => visible(ctx, r));
    const visite = await base.premier('SELECT vu_le FROM ressource_visites WHERE team_id = ? AND compte_id = ?', [teamId, acteur.compte]);
    const derniereVisite = visite?.vu_le ?? null;
    const toutes = await ressourcesPubliques(ctx, visibles, { derniereVisite });
    const publiees = toutes.filter(r => r.statut === 'publiee');
    const enAttente = toutes.filter(r => r.statut === 'proposee');
    let base_ = publiees;
    if (filtres.file) base_ = ctx.droits.gerer ? enAttente : [];
    else if (filtres.miennes) base_ = toutes.filter(r => r.statut !== 'publiee' && r.auteur?.compte === acteur.compte);
    const ressources = trierRessources(filtrerRessources(base_, filtres));
    const parCategorie = {};
    for (const r of publiees) {
      const k = r.categorie?.id ?? 'sans';
      parCategorie[k] = (parCategorie[k] ?? 0) + 1;
    }
    const unique = (l, cle) => [...new Map(l.filter(Boolean).map(x => [x[cle], x])).values()];
    return {
      ressources,
      categories: categories.map(c => ({ ...categoriePublique(c), n: parCategorie[c.id] ?? 0 })),
      sansCategorie: parCategorie.sans ?? 0,
      tags: [...new Set(publiees.flatMap(r => r.tags))].sort((a, b) => a.localeCompare(b, 'fr')),
      cartes: unique(publiees.map(r => r.carte), 'cle').sort((a, b) => a.nom.localeCompare(b.nom)),
      agents: unique(publiees.map(r => r.agent), 'cle').sort((a, b) => a.nom.localeCompare(b.nom)),
      auteurs: unique(publiees.map(r => r.auteur), 'compte'),
      total: publiees.length,
      nouveaux: publiees.filter(r => r.nouveau).length,
      derniereVisite,
      file: ctx.droits.gerer ? enAttente.length : 0,
      mesPropositions: toutes.filter(r => r.statut !== 'publiee' && r.auteur?.compte === acteur.compte).length,
      emojis: EMOJIS,
      moi: { ...ctx.droits, propositionsOuvertes: ctx.reglages.propositions },
    };
  }

  /** Marque le canal comme vu (le compteur « nouveau » repart de zéro). */
  async function marquerVu(acteur, teamId) {
    await contexte(acteur, teamId);
    const t = iso(maintenant());
    await base.executer(
      'INSERT INTO ressource_visites (team_id, compte_id, vu_le) VALUES (?, ?, ?) ON CONFLICT (team_id, compte_id) DO UPDATE SET vu_le = excluded.vu_le',
      [teamId, acteur.compte, t],
    );
    return { vuLe: t };
  }

  async function detail(acteur, teamId, id) {
    const ctx = await contexte(acteur, teamId);
    const r = await ressourceVisible(ctx, id);
    const [publique] = await ressourcesPubliques(ctx, [r]);
    const lignes = await base.tous('SELECT * FROM ressource_commentaires WHERE ressource_id = ? AND team_id = ? AND supprime_le IS NULL ORDER BY cree_le, id LIMIT 500', [id, teamId]);
    const noms = await pseudosDe(base, lignes.map(c => c.auteur_id));
    return {
      ...publique,
      listeCommentaires: lignes.map(c => ({
        id: c.id,
        texte: c.texte,
        auteur: c.auteur_id ? { compte: c.auteur_id, pseudo: noms[c.auteur_id] ?? null } : null,
        creeLe: c.cree_le,
        supprimable: ctx.droits.gerer || (c.auteur_id !== null && c.auteur_id === acteur.compte),
      })),
    };
  }

  // -------------------------------------------------------------- Aperçu de lien

  /** Aperçu d'un lien (formulaire de l'app) : réservé à qui peut publier ou proposer. */
  async function apercuLien(acteur, teamId, corps) {
    const ctx = await contexte(acteur, teamId);
    if (!ctx.droits.poster && !ctx.droits.proposer) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const yt = extraireYoutube(corps?.url);
    if (yt) return { url: adresseYoutube(yt.id), youtube: yt.id, titre: null, description: null, image: `https://i.ytimg.com/vi/${yt.id}/hqdefault.jpg`, site: 'YouTube' };
    return recupererApercu(corps?.url, { telecharger, resoudre, maintenant });
  }

  /** Aperçu d'un lien au moment de publier : au mieux (une page muette n'empêche pas de publier). */
  async function apercuAuMieux(url) {
    try {
      return await recupererApercu(url, { telecharger, resoudre, maintenant });
    } catch (e) {
      if (e?.code === 'apercu-adresse') throw e;
      return null;
    }
  }

  // -------------------------------------------------------------- Saisie

  /**
   * Champs d'une ressource saisie. `partiel` : modification (seuls les champs fournis). Rend les
   * colonnes à écrire, et `apercu` à récupérer (adresse d'un lien).
   */
  async function lireSaisie(ctx, corps, partiel, existante) {
    const s = {};
    const champ = n => corps?.[n] !== undefined;
    let genre = existante?.genre;
    if (!partiel) {
      genre = corps?.genre;
      if (!GENRES_RESSOURCE.includes(genre)) throw echec(400, 'genre', 'Type de ressource : lien, youtube, fichier ou note.');
    }
    // Lien ou vidéo YouTube : l'adresse (un lien YouTube devient une vidéo).
    if ((!partiel && (genre === 'lien' || genre === 'youtube')) || (partiel && champ('url') && (genre === 'lien' || genre === 'youtube'))) {
      const yt = extraireYoutube(corps?.url);
      if (genre === 'youtube' || (yt && !partiel)) {
        if (!yt) throw echec(400, 'url-youtube', 'Adresse YouTube non reconnue.');
        genre = 'youtube';
        s.url = adresseYoutube(yt.id);
        s.video_id = yt.id;
        s.apercu = JSON.stringify({ titre: null, description: null, image: `https://i.ytimg.com/vi/${yt.id}/hqdefault.jpg`, site: 'YouTube' });
      } else {
        const url = String(corps?.url ?? '').trim();
        if (!url || url.length > 2048 || !lienSur(url)) throw echec(400, 'url', 'Adresse invalide : http(s) seulement.');
        s.url = url;
        s.video_id = null;
        s._apercu = url;
      }
    }
    if (!partiel) s.genre = genre;
    if (!partiel || champ('titre')) s.titre = texteNettoye(corps?.titre, 120);
    if (!partiel || champ('description')) s.description = nettoyerNote(corps?.description ?? '', NOTE_MAX);
    if (!partiel || champ('tags')) s.tags = JSON.stringify(tagsPropres(corps?.tags));
    if (!partiel || champ('carte')) {
      const c = lireRepereJeu(corps?.carte, 'carte');
      s.carte = c.cle;
      s.carte_nom = c.nom;
    }
    if (!partiel || champ('agent')) {
      const a = lireRepereJeu(corps?.agent, 'agent');
      s.agent = a.cle;
      s.agent_nom = a.nom;
    }
    if (!partiel || champ('niveau')) {
      const n = corps?.niveau ?? null;
      if (n !== null && n !== '' && !NIVEAUX.includes(n)) throw echec(400, 'niveau', 'Niveau : débutant, intermédiaire ou avancé.');
      s.niveau = n || null;
    }
    if (!partiel || champ('visibilite')) {
      const v = corps?.visibilite ?? 'team';
      if (!VISIBILITES.includes(v)) throw echec(400, 'visibilite', 'Visibilité : toute la team ou le staff seulement.');
      // Réservé au staff : un joueur ne voit pas les ressources du staff, il ne peut pas en créer.
      if (v === 'staff' && !ctx.droits.staff) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
      s.visibilite = v;
    }
    if (!partiel || champ('categorieId')) {
      if (corps?.categorieId) s.categorie_id = (await categorieDeTeam(ctx.team.id, corps.categorieId)).id;
      else if (partiel) s.categorie_id = null;
      else {
        const cats = await categoriesDe(ctx.team.id);
        s.categorie_id = (cats.find(c => c.cle_defaut === 'divers') ?? cats.at(-1))?.id ?? null;
      }
    }
    if (champ('epingle')) {
      if (!ctx.droits.gerer) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
      s.epingle = corps.epingle ? 1 : 0;
    }
    return s;
  }

  /** Titre final (repli : titre de l'aperçu, nom du fichier, adresse) et contrôles par genre. */
  function completer(s, { apercu, fichier, genre }) {
    if (apercu) s.apercu = JSON.stringify({ titre: apercu.titre, description: apercu.description, image: apercu.image, site: apercu.site });
    if (!s.titre) s.titre = texteNettoye(apercu?.titre ?? fichier?.nom_original ?? (s.url ? new URL(s.url).hostname : ''), 120);
    if (s.titre.length < 2) throw echec(400, 'titre', 'Titre : 2 caractères au moins.');
    if (genre === 'note' && !s.description) throw echec(400, 'note-vide', 'Une note a besoin d’un texte.');
  }

  const chargeEvenement = (r, categorie) => ({ titre: r.titre, genre: r.genre, categorie: categorie?.nom ?? null, visibilite: r.visibilite, statut: r.statut, auteur: r.auteur_id ?? null });

  async function nomCategorie(teamId, id) {
    if (!id) return null;
    return base.premier('SELECT nom FROM ressource_categories WHERE id = ? AND team_id = ?', [id, teamId]);
  }

  /**
   * Instructions d'insertion d'une ressource dans une team (création, publication multi-teams).
   * `statut` : publiee ou proposee.
   */
  function instructionsCreation(ctx, s, { id, statut, groupeId = null, fichierInstr = [], fichierId = null, t, categorie }) {
    const ligne = { ...s, id, statut, auteur_id: ctx.acteur.compte };
    const evenementType = statut === 'publiee' ? 'resource.created' : 'resource.proposed';
    return [
      ...fichierInstr,
      {
        sql: `INSERT INTO ressources (id, team_id, categorie_id, genre, titre, description, url, video_id, fichier_id, apercu, tags, carte, carte_nom, agent, agent_nom, niveau, visibilite, statut, epingle, auteur_id, groupe_id, cree_le, maj_le, publie_le)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          id, ctx.team.id, s.categorie_id ?? null, s.genre, s.titre, s.description ?? '', s.url ?? null, s.video_id ?? null, fichierId, s.apercu ?? null, s.tags ?? '[]',
          s.carte ?? null, s.carte_nom ?? null, s.agent ?? null, s.agent_nom ?? null, s.niveau ?? null, s.visibilite ?? 'team', statut, s.epingle ?? 0, ctx.acteur.compte, groupeId,
          iso(t), iso(t), statut === 'publiee' ? iso(t) : null,
        ],
      },
      evenement(evenementType, { teamId: ctx.team.id, acteur: ctx.acteur.compte, entiteType: 'ressource', entiteId: id, charge: { ...chargeEvenement(ligne, categorie), ...(groupeId ? { multi: true } : {}) }, maintenant: t }),
    ];
  }

  // -------------------------------------------------------------- Écriture

  async function creer(acteur, teamId, corps) {
    const ctx = await contexte(acteur, teamId);
    if (!ctx.droits.poster && !ctx.droits.proposer) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const n = await base.premier('SELECT COUNT(*) AS n FROM ressources WHERE team_id = ? AND supprime_le IS NULL', [teamId]);
    if (Number(n?.n ?? 0) >= RESSOURCES_MAX) throw echec(409, 'trop-de-ressources', `Une team garde ${RESSOURCES_MAX} ressources au plus.`);
    const s = await lireSaisie(ctx, corps, false);
    // Proposition d'un joueur : visible de toute la team une fois validée, jamais épinglée par lui.
    const statut = ctx.droits.poster ? 'publiee' : 'proposee';
    if (statut === 'proposee') {
      s.visibilite = 'team';
      s.epingle = 0;
    }
    const id = nouvelId();
    let rattachement = null;
    if (s.genre === 'fichier') {
      if (!medias) throw echec(503, 'stockage-absent', 'Le stockage des fichiers n’est pas branché sur le serveur Esport.');
      if (typeof corps?.envoi !== 'string') throw echec(400, 'envoi', 'Déposez d’abord le fichier.');
      rattachement = await medias.preparerRattachement(ctx, corps.envoi, 'ressource', { entiteType: 'ressource_fichier', entiteId: id });
    }
    const apercu = s._apercu ? await apercuAuMieux(s._apercu) : null;
    delete s._apercu;
    completer(s, { apercu, fichier: rattachement?.envoi, genre: s.genre });
    const t = maintenant();
    const categorie = await nomCategorie(teamId, s.categorie_id);
    await base.lot(instructionsCreation(ctx, s, { id, statut, t, categorie, fichierInstr: rattachement?.instructions ?? [], fichierId: rattachement?.fichierId ?? null }));
    return detail(acteur, teamId, id);
  }

  async function modifier(acteur, teamId, id, corps) {
    const ctx = await contexte(acteur, teamId);
    const r = await ressourceVisible(ctx, id);
    if (!peutModifier(ctx, r)) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const s = await lireSaisie(ctx, corps, true, r);
    if (r.statut !== 'publiee' && !ctx.droits.gerer) s.visibilite = 'team';
    const apercu = s._apercu ? await apercuAuMieux(s._apercu) : undefined;
    delete s._apercu;
    if (apercu !== undefined) s.apercu = apercu ? JSON.stringify({ titre: apercu.titre, description: apercu.description, image: apercu.image, site: apercu.site }) : null;
    if (s.titre !== undefined && s.titre.length < 2) throw echec(400, 'titre', 'Titre : 2 caractères au moins.');
    if (r.genre === 'note' && s.description === '') throw echec(400, 'note-vide', 'Une note a besoin d’un texte.');
    // Une proposition refusée puis corrigée par son auteur repart dans la file.
    if (r.statut === 'refusee' && r.auteur_id === acteur.compte && !ctx.droits.gerer) {
      s.statut = 'proposee';
      s.motif_refus = null;
    }
    const cols = Object.keys(s);
    if (cols.length === 0) return detail(acteur, teamId, id);
    const t = maintenant();
    const epingleSeul = cols.length === 1 && cols[0] === 'epingle';
    const titre = s.titre ?? r.titre;
    await base.lot([
      { sql: `UPDATE ressources SET ${cols.map(c => `${c} = ?`).join(', ')}, maj_le = ? WHERE id = ? AND team_id = ?`, params: [...cols.map(c => s[c]), iso(t), id, teamId] },
      epingleSeul
        ? evenement('resource.pinned', { teamId, acteur: acteur.compte, entiteType: 'ressource', entiteId: id, charge: { titre, epingle: s.epingle === 1 }, maintenant: t })
        : evenement(s.statut === 'proposee' ? 'resource.proposed' : 'resource.updated', { teamId, acteur: acteur.compte, entiteType: 'ressource', entiteId: id, charge: { titre, champs: cols }, maintenant: t }),
    ]);
    return detail(acteur, teamId, id);
  }

  async function supprimer(acteur, teamId, id) {
    const ctx = await contexte(acteur, teamId);
    const r = await ressourceVisible(ctx, id);
    if (!peutSupprimer(ctx, r)) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const t = maintenant();
    await base.lot([
      { sql: 'UPDATE ressources SET supprime_le = ?, maj_le = ? WHERE id = ? AND team_id = ?', params: [iso(t), iso(t), id, teamId] },
      { sql: 'DELETE FROM ressource_favoris WHERE ressource_id = ?', params: [id] },
      evenement('resource.deleted', { teamId, acteur: acteur.compte, entiteType: 'ressource', entiteId: id, charge: { titre: r.titre, auteur: r.auteur_id ?? null }, maintenant: t }),
    ]);
    // Fichier déposé : plus lisible avec la ressource, ses octets sont effacés (espace libéré).
    if (r.fichier_id) await medias?.effacerOctets(r.fichier_id);
    return { ok: true };
  }

  /** File de validation : valider (publier) une proposition, éventuellement dans une autre catégorie. */
  async function valider(acteur, teamId, id, corps) {
    const ctx = await contexte(acteur, teamId);
    const r = await ressourceVisible(ctx, id);
    exigerGerer(ctx);
    if (r.statut !== 'proposee') throw echec(409, 'pas-proposee', 'Cette ressource n’attend pas de validation.');
    const categorieId = corps?.categorieId ? (await categorieDeTeam(teamId, corps.categorieId)).id : r.categorie_id;
    const t = maintenant();
    const categorie = await nomCategorie(teamId, categorieId);
    await base.lot([
      {
        sql: "UPDATE ressources SET statut = 'publiee', categorie_id = ?, valide_par = ?, valide_le = ?, publie_le = ?, motif_refus = NULL, maj_le = ? WHERE id = ? AND team_id = ? AND statut = 'proposee'",
        params: [categorieId, acteur.compte, iso(t), iso(t), iso(t), id, teamId],
      },
      evenement('resource.validated', { teamId, acteur: acteur.compte, entiteType: 'ressource', entiteId: id, charge: { ...chargeEvenement({ ...r, statut: 'publiee' }, categorie) }, maintenant: t }),
    ]);
    return detail(acteur, teamId, id);
  }

  async function refuser(acteur, teamId, id, corps) {
    const ctx = await contexte(acteur, teamId);
    const r = await ressourceVisible(ctx, id);
    exigerGerer(ctx);
    if (r.statut !== 'proposee') throw echec(409, 'pas-proposee', 'Cette ressource n’attend pas de validation.');
    const motif = texteNettoye(corps?.motif, 300);
    const t = maintenant();
    await base.lot([
      { sql: "UPDATE ressources SET statut = 'refusee', motif_refus = ?, valide_par = ?, valide_le = ?, maj_le = ? WHERE id = ? AND team_id = ?", params: [motif, acteur.compte, iso(t), iso(t), id, teamId] },
      evenement('resource.refused', { teamId, acteur: acteur.compte, entiteType: 'ressource', entiteId: id, charge: { titre: r.titre, auteur: r.auteur_id ?? null, motif }, maintenant: t }),
    ]);
    return detail(acteur, teamId, id);
  }

  // -------------------------------------------------------------- Favoris, réactions, commentaires

  async function favori(acteur, teamId, id, actif) {
    const ctx = await contexte(acteur, teamId);
    await ressourceVisible(ctx, id);
    if (actif) {
      await base.executer('INSERT INTO ressource_favoris (ressource_id, compte_id, team_id, cree_le) VALUES (?, ?, ?, ?) ON CONFLICT (ressource_id, compte_id) DO NOTHING', [id, acteur.compte, teamId, iso(maintenant())]);
    } else {
      await base.executer('DELETE FROM ressource_favoris WHERE ressource_id = ? AND compte_id = ?', [id, acteur.compte]);
    }
    return { favori: Boolean(actif) };
  }

  const exigerPubliee = r => {
    if (r.statut !== 'publiee') throw echec(409, 'pas-publiee', 'Cette ressource n’est pas encore publiée.');
  };

  async function reagir(acteur, teamId, id, corps) {
    const ctx = await contexte(acteur, teamId);
    const r = await ressourceVisible(ctx, id);
    exigerPubliee(r);
    const emoji = corps?.emoji;
    if (!EMOJIS.includes(emoji)) throw echec(400, 'emoji', 'Réaction inconnue.');
    const actif = corps?.actif !== false;
    const t = maintenant();
    const deja = await base.premier('SELECT id FROM ressource_reactions WHERE ressource_id = ? AND compte_id = ? AND emoji = ?', [id, acteur.compte, emoji]);
    if (actif && !deja) {
      await base.lot([
        { sql: 'INSERT INTO ressource_reactions (id, ressource_id, team_id, compte_id, emoji, cree_le) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (ressource_id, compte_id, emoji) DO NOTHING', params: [nouvelId(), id, teamId, acteur.compte, emoji, iso(t)] },
        evenement('resource.reaction_changed', { teamId, acteur: acteur.compte, entiteType: 'ressource', entiteId: id, charge: { titre: r.titre, emoji, actif: true }, maintenant: t }),
      ]);
    } else if (!actif && deja) {
      await base.lot([
        { sql: 'DELETE FROM ressource_reactions WHERE id = ?', params: [deja.id] },
        evenement('resource.reaction_changed', { teamId, acteur: acteur.compte, entiteType: 'ressource', entiteId: id, charge: { titre: r.titre, emoji, actif: false }, maintenant: t }),
      ]);
    }
    const [publique] = await ressourcesPubliques(ctx, [r]);
    return { reactions: publique.reactions };
  }

  async function commenter(acteur, teamId, id, corps) {
    const ctx = await contexte(acteur, teamId);
    const r = await ressourceVisible(ctx, id);
    exigerPubliee(r);
    const texte = nettoyerNote(corps?.texte ?? '', COMMENTAIRE_MAX);
    if (!texte) throw echec(400, 'commentaire-vide', 'Le commentaire est vide.');
    const t = maintenant();
    const cid = nouvelId();
    await base.lot([
      { sql: 'INSERT INTO ressource_commentaires (id, ressource_id, team_id, auteur_id, texte, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?)', params: [cid, id, teamId, acteur.compte, texte, iso(t), iso(t)] },
      evenement('resource.commented', { teamId, acteur: acteur.compte, entiteType: 'ressource', entiteId: id, charge: { titre: r.titre, auteur: r.auteur_id ?? null }, maintenant: t }),
    ]);
    return detail(acteur, teamId, id);
  }

  async function supprimerCommentaire(acteur, teamId, id, commentaireId) {
    const ctx = await contexte(acteur, teamId);
    const r = await ressourceVisible(ctx, id);
    exigerUuid(commentaireId, 'commentaire', 'Commentaire introuvable.');
    const c = await base.premier('SELECT * FROM ressource_commentaires WHERE id = ? AND ressource_id = ? AND team_id = ? AND supprime_le IS NULL', [commentaireId, id, teamId]);
    if (!c) throw echec(404, 'commentaire-introuvable', 'Commentaire introuvable.');
    if (!ctx.droits.gerer && c.auteur_id !== acteur.compte) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const t = maintenant();
    await base.lot([
      { sql: 'UPDATE ressource_commentaires SET supprime_le = ?, maj_le = ? WHERE id = ?', params: [iso(t), iso(t), commentaireId] },
      evenement('resource.comment_deleted', { teamId, acteur: acteur.compte, entiteType: 'ressource', entiteId: id, charge: { titre: r.titre }, maintenant: t }),
    ]);
    return detail(acteur, teamId, id);
  }

  // -------------------------------------------------------------- Fichier, review

  /** Lien signé (2 h) du fichier déposé : affiché (PDF, image, vidéo) ou téléchargé (archive). */
  async function lienFichier(acteur, teamId, id, corps) {
    const ctx = await contexte(acteur, teamId);
    const r = await ressourceVisible(ctx, id);
    if (r.genre !== 'fichier' || !r.fichier_id || !medias) throw echec(404, 'fichier-introuvable', 'Fichier introuvable (supprimé ?).');
    const f = await medias.fichier(r.fichier_id);
    const archive = /zip|7z|rar|octet-stream/.test(f?.type_mime ?? '');
    return medias.lienMedia(acteur, f, { telecharger: Boolean(corps?.telecharger) || archive, duree: DUREE_LIEN_FICHIER_MS });
  }

  /** « Ouvrir en review vidéo » : crée la review de cette vidéo YouTube (ou rouvre la précédente). */
  async function ouvrirEnReview(acteur, teamId, id) {
    const ctx = await contexte(acteur, teamId);
    const r = await ressourceVisible(ctx, id);
    if (r.genre !== 'youtube') throw echec(400, 'pas-youtube', 'Seules les vidéos YouTube s’ouvrent en review.');
    if (!review || !ctx.modules.has('video_review')) throw echec(404, 'module-desactive', 'Ce module n’est pas activé pour cette team.');
    review.exiger(ctx, 'video_review.view');
    if (r.review_id) {
      const existante = await base.premier('SELECT id FROM reviews WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [r.review_id, teamId]);
      if (existante) return { reviewId: existante.id, cree: false };
    }
    review.exiger(ctx, 'video_review.create');
    const t = maintenant();
    const { id: reviewId, instructions } = await review.preparerCreation(ctx, acteur, { titre: r.titre, url: r.url, reference: texteNettoye(`Ressource : ${r.titre}`, 120) }, { ressourceId: id });
    await base.lot([...instructions, { sql: 'UPDATE ressources SET review_id = ?, maj_le = ? WHERE id = ? AND team_id = ?', params: [reviewId, iso(t), id, teamId] }]);
    return { reviewId, cree: true };
  }

  // -------------------------------------------------------------- Réglages

  function reglagesPublics(ctx, r) {
    return {
      propositions: r.propositions,
      discord: ctx.droits.discord
        ? { salonId: r.salonId, webhook: r.webhook ? { configure: true, masque: masquerWebhook(r.webhookFin ?? '') } : { configure: false } }
        : null,
    };
  }

  async function lireReglages(acteur, teamId) {
    const ctx = await contexte(acteur, teamId);
    exigerGerer(ctx);
    return reglagesPublics(ctx, ctx.reglages);
  }

  /**
   * Réglages (resources.manage) : `propositions` (les joueurs peuvent proposer) ; salon Discord dédié
   * (discord.manage en plus) : `discord.salonId` (salon du bot, identifiant numérique, null pour le
   * salon de la team) et `discord.webhook` (adresse d'un webhook propre, null pour l'effacer).
   */
  async function changerReglages(acteur, teamId, corps) {
    const ctx = await contexte(acteur, teamId);
    exigerGerer(ctx);
    const r = { ...ctx.reglages };
    const champs = [];
    if (corps?.propositions !== undefined) {
      r.propositions = Boolean(corps.propositions);
      champs.push('propositions');
    }
    if (corps?.discord !== undefined) {
      if (!ctx.droits.discord) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
      const d = corps.discord ?? {};
      if (d.salonId !== undefined) {
        const salon = d.salonId === null || d.salonId === '' ? null : String(d.salonId).trim();
        if (salon !== null && !MOTIF_SALON.test(salon)) throw echec(400, 'salon', 'Salon Discord : son identifiant numérique (clic droit sur le salon › Copier l’identifiant).');
        r.salonId = salon;
        champs.push('salon');
      }
      if (d.webhook !== undefined) {
        if (d.webhook === null || d.webhook === '') {
          r.webhook = null;
          r.webhookFin = null;
        } else {
          const url = validerUrlWebhook(d.webhook);
          r.webhook = await chiffrerWebhook(cleDiscord, teamId, url);
          r.webhookFin = finDeWebhook(url);
        }
        champs.push('webhook');
      }
    }
    if (champs.length === 0) return reglagesPublics(ctx, r);
    const t = maintenant();
    await base.lot([
      {
        sql: `INSERT INTO ressource_reglages (team_id, propositions, discord_salon_id, discord_webhook, discord_webhook_fin, maj_le) VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT (team_id) DO UPDATE SET propositions = excluded.propositions, discord_salon_id = excluded.discord_salon_id, discord_webhook = excluded.discord_webhook, discord_webhook_fin = excluded.discord_webhook_fin, maj_le = excluded.maj_le`,
        params: [teamId, r.propositions ? 1 : 0, r.salonId, r.webhook, r.webhookFin, iso(t)],
      },
      // Jamais l'adresse du webhook dans le journal : seulement ce qui a changé.
      evenement('resources.settings_changed', { teamId, acteur: acteur.compte, entiteType: 'team', entiteId: teamId, charge: { champs, propositions: r.propositions }, maintenant: t }),
    ]);
    return reglagesPublics(ctx, r);
  }

  // -------------------------------------------------------------- Plusieurs teams (Esport global)

  /** Teams où l'acteur peut publier (module activé, resources.post), avec leurs catégories. */
  async function teamsPublication(acteur) {
    const sortie = [];
    for (const ctx of await socle.contextesDe(acteur)) {
      if (!ctx.modules.has(MODULE_RESSOURCES) || !peut(ctx, 'resources.post')) continue;
      sortie.push({ id: ctx.team.id, nom: ctx.team.nom, slug: ctx.team.slug, categories: (await categoriesDe(ctx.team.id)).map(categoriePublique) });
    }
    return { teams: sortie };
  }

  /**
   * Publie la même ressource (lien, vidéo YouTube ou note) dans plusieurs teams d'un coup, tout ou
   * rien : chaque team est vérifiée (appartenance → module → resources.post) avant la moindre
   * écriture. `categorie` : `{ cleDefaut }` ou `{ nom }` ; absente de la team : elle y est créée (nom),
   * ou « Divers ». Une seule récupération d'aperçu pour toutes les teams.
   */
  async function publierMulti(acteur, corps) {
    const ids = Array.isArray(corps?.teams) ? [...new Set(corps.teams)] : [];
    if (ids.length === 0) throw echec(400, 'teams', 'Choisissez au moins une team.');
    if (ids.length > TEAMS_MULTI_MAX) throw echec(400, 'teams', `${TEAMS_MULTI_MAX} teams au plus d’un coup.`);
    if (corps?.genre === 'fichier') throw echec(400, 'genre', 'Un fichier se dépose dans une team à la fois.');
    const contextes = [];
    for (const teamId of ids) {
      const ctx = await contexte(acteur, teamId);
      if (!ctx.droits.poster) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
      contextes.push(ctx);
    }
    const voulue = corps?.categorie ?? {};
    const saisieBase = await lireSaisie(contextes[0], { ...corps, categorieId: undefined }, false);
    const apercu = saisieBase._apercu ? await apercuAuMieux(saisieBase._apercu) : null;
    delete saisieBase._apercu;
    completer(saisieBase, { apercu, genre: saisieBase.genre });
    const nomVoulu = voulue.nom ? lireNomCategorie(voulue.nom) : null;
    const t = maintenant();
    const groupeId = nouvelId();
    const lot = [];
    const creees = [];
    for (const ctx of contextes) {
      const cats = await categoriesDe(ctx.team.id);
      let categorie = voulue.cleDefaut ? cats.find(c => c.cle_defaut === voulue.cleDefaut) : nomVoulu ? cats.find(c => normaliser(c.nom) === normaliser(nomVoulu)) : null;
      if (!categorie && nomVoulu && cats.length < CATEGORIES_MAX) {
        categorie = { id: nouvelId(), nom: nomVoulu };
        const position = cats.reduce((m, c) => Math.max(m, Number(c.position)), -1) + 1;
        lot.push(
          { sql: 'INSERT INTO ressource_categories (id, team_id, nom, cle_defaut, position, cree_le, maj_le) VALUES (?, ?, ?, NULL, ?, ?, ?)', params: [categorie.id, ctx.team.id, nomVoulu, position, iso(t), iso(t)] },
          evenement('resource_category.created', { teamId: ctx.team.id, acteur: acteur.compte, entiteType: 'ressource_categorie', entiteId: categorie.id, charge: { nom: nomVoulu }, maintenant: t }),
        );
      }
      categorie ??= cats.find(c => c.cle_defaut === 'divers') ?? cats.at(-1) ?? null;
      const id = nouvelId();
      lot.push(...instructionsCreation(ctx, { ...saisieBase, categorie_id: categorie?.id ?? null }, { id, statut: 'publiee', groupeId, t, categorie }));
      creees.push({ teamId: ctx.team.id, team: ctx.team.nom, id });
    }
    await base.lot(lot);
    return { groupe: groupeId, ressources: creees };
  }

  return {
    liste,
    detail,
    marquerVu,
    apercuLien,
    creer,
    modifier,
    supprimer,
    valider,
    refuser,
    favori,
    reagir,
    commenter,
    supprimerCommentaire,
    lienFichier,
    ouvrirEnReview,
    creerCategorie,
    modifierCategorie,
    supprimerCategorie,
    ordonnerCategories,
    lireReglages,
    changerReglages,
    teamsPublication,
    publierMulti,
  };
}
