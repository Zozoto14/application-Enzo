/**
 * Médias de l'Esport : vidéos déposées pour la review, enregistrements des réunions, espace utilisé.
 *
 * ENVOI PAR MORCEAUX (reprise après coupure), routes sous la section du module concerné :
 *
 *   POST   /teams/:t/review/envois                      début { nom, taille, type? }  (video_review.create)
 *   POST   /teams/:t/resumes/envois                     idem pour une réunion          (meeting_summaries.submit)
 *   GET    /teams/:t/(review|resumes)/envois/:e         état (reprise : prochain morceau attendu)
 *   PUT    /teams/:t/(review|resumes)/envois/:e/morceaux/:i   un morceau (corps binaire, en-tête X-Sha256)
 *   POST   /teams/:t/(review|resumes)/envois/:e/fin     { sha256 } : vérifie le fichier entier
 *   DELETE /teams/:t/(review|resumes)/envois/:e         annuler
 *
 * Contrôles, dans l'ordre : session (api.mjs) → appartenance → module → permission → envoi à SOI (un
 * envoi d'un autre membre est introuvable) → plafond (ESPORT_VIDEO_MAX, 10 Go par défaut) → morceaux
 * dans l'ordre, taille exacte, SHA-256 de chaque morceau → octets magiques au premier morceau (MP4, MOV,
 * WebM, MKV ; audio en plus pour une réunion) → SHA-256 du fichier entier à la fin. Aucune conversion :
 * le fichier est gardé tel quel, sous un nom aléatoire, dans le stockage privé.
 *
 * Un envoi terminé est ensuite RATTACHÉ (review créée, réunion déposée) : il devient une ligne de
 * `fichiers` (« review_video », « reunion_enregistrement »). Le cron efface au bout de 24 h les envois
 * inachevés et ceux jamais rattachés.
 *
 * ESPACE UTILISÉ (Paramètres de la team, `team.manage`) : GET /teams/:t/espace, et
 * DELETE /teams/:t/espace/:fichier (permission du module : video_review.delete pour une vidéo,
 * meeting_summaries.write_summary pour un enregistrement, une transcription ou une ancienne version
 * de résumé).
 */

import { evenement } from '../evenements.mjs';
import { cheminSigne, empreinteSha256, verifierLien } from '../fichiers.mjs';
import { autorise } from '../permissions.mjs';
import { echec, iso, jsonOu, nouvelId, texteNettoye } from '../outils.mjs';
import { lignesParIds, pseudosDe } from '../requetes.mjs';
import { FORMATS, FORMATS_PERMIS, analyserDebut, analysePublique, completerAvecFin } from './formats.mjs';
import { reponseFichierStocke } from './lecture.mjs';
import { ajouter, exporterEtat, importerEtat, nouvelEtat, terminer } from './sha256.mjs';
import { lireTaille } from './tailles.mjs';

export { lireTaille };

const Mio = 1024 * 1024;
export const PLAFOND_DEFAUT = 10 * 1024 * Mio;
export const MORCEAU_DEFAUT = 8 * Mio;
export const MORCEAU_MIN = Mio;
export const MORCEAU_MAX = 64 * Mio;
/** Envois inachevés (ou jamais rattachés) effacés par le cron après ce délai. */
export const DELAI_ABANDON_MS = 24 * 3600 * 1000;
/** Lien signé d'une vidéo ou d'un enregistrement : 2 heures (l'app en redemande un s'il expire). */
export const DUREE_LIEN_MEDIA_MS = 2 * 3600 * 1000;
/** Liens de l'export RGPD : 72 heures. */
export const DUREE_LIEN_EXPORT_MS = 72 * 3600 * 1000;
const ENVOIS_OUVERTS_MAX = 5;
const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MOTIF_SHA = /^[0-9a-f]{64}$/;

export const USAGES = {
  review: { module: 'video_review', permission: 'video_review.create', dossier: 'videos' },
  reunion: { module: 'meeting_summaries', permission: 'meeting_summaries.submit', dossier: 'reunions' },
  // Ressources : publier (resources.post), ou proposer quand la team l'ouvre aux joueurs (voir `autoriser`).
  ressource: {
    module: 'resources',
    permission: 'resources.post',
    dossier: 'ressources',
    autoriser: async (base, ctx) =>
      ctx.permissions.has('resources.view') && Number((await base.premier('SELECT propositions FROM ressource_reglages WHERE team_id = ?', [ctx.team.id]))?.propositions ?? 0) === 1,
  },
  // Section CM (migration 0023) : pièces jointes et clips, pour le club (sans team) ou une team. Le contexte
  // (droits sur la portée) est fourni par la section CM (`brancherContexte`) ; les fichiers vont dans `cm_fichiers`.
  cm: { module: null, permission: null, dossier: 'cm', externe: true },
  // Drive de la section CM (migration 0027) : mêmes portées, formats étendus, plafond et quota du Drive (le
  // contexte fourni par le Drive porte `plafond` et `avantEnvoi`) ; les fichiers vont aussi dans `cm_fichiers`.
  drive: { module: null, permission: null, dossier: 'drive', externe: true },
};

/** Natures de fichiers (entite_type) affichées dans « Espace utilisé », et la permission qui les supprime. */
export const NATURES = {
  review_video: { nature: 'video', permission: 'video_review.delete' },
  reunion_enregistrement: { nature: 'enregistrement', permission: 'meeting_summaries.write_summary' },
  reunion_transcription: { nature: 'transcription', permission: 'meeting_summaries.write_summary' },
  reunion: { nature: 'resume', permission: 'meeting_summaries.write_summary' },
  strat: { nature: 'miniature', permission: null },
  ressource_fichier: { nature: 'ressource', permission: 'resources.manage' },
};

/**
 * Réglages des médias depuis l'environnement : ESPORT_VIDEO_MAX (plafond par fichier, « 10G » par
 * défaut) et ESPORT_TAILLE_MORCEAU (taille des morceaux, « 8M » par défaut, de 1 à 64 Mio ; un
 * minimum peut être imposé).
 */
export function configMedias(env = {}, { minimum = MORCEAU_MIN } = {}) {
  const plafond = lireTaille(env.ESPORT_VIDEO_MAX, PLAFOND_DEFAUT);
  const morceau = Math.min(MORCEAU_MAX, Math.max(minimum, lireTaille(env.ESPORT_TAILLE_MORCEAU, MORCEAU_DEFAUT)));
  return { plafond, tailleMorceau: morceau };
}

const exigerUuid = (valeur, quoi) => {
  if (typeof valeur !== 'string' || !MOTIF_UUID.test(valeur)) throw echec(404, `${quoi}-introuvable`, 'Introuvable.');
  return valeur;
};

/** Nom d'origine affichable et sûr (sans chemin ni caractère spécial). */
export function nomMedia(brut, repli = 'video') {
  const nom = texteNettoye(brut, 140).replace(/[\\/:*?"<>|]/g, '_');
  return nom || repli;
}

/** Lit exactement `attendu` octets du corps (refus au-delà, sans tout charger d'abord). */
async function lireMorceau(requete, attendu) {
  const annoncee = Number(requete.headers.get('Content-Length') ?? attendu);
  if (annoncee > attendu) throw echec(413, 'morceau-trop-gros', 'Morceau trop gros.');
  if (!requete.body) return new Uint8Array(0);
  const lecteur = requete.body.getReader();
  const morceaux = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    total += value.length;
    if (total > attendu) {
      await lecteur.cancel().catch(() => undefined);
      throw echec(413, 'morceau-trop-gros', 'Morceau trop gros.');
    }
    morceaux.push(value);
  }
  if (morceaux.length === 1) return morceaux[0];
  const octets = new Uint8Array(total);
  let i = 0;
  for (const m of morceaux) {
    octets.set(m, i);
    i += m.length;
  }
  return octets;
}

/** Partie publique d'une ligne de `fichiers` (vidéo, enregistrement, PDF). */
export function fichierPublic(f) {
  if (!f) return null;
  const meta = jsonOu(f.meta, null);
  return {
    id: f.id,
    nom: f.nom_original,
    taille: Number(f.taille),
    type: f.type_mime,
    creeLe: f.cree_le,
    supprime: Boolean(f.supprime_le),
    ...(meta ? { media: analysePublique(meta) } : {}),
  };
}

/**
 * Efface les envois inachevés depuis plus de 24 h, et les envois terminés jamais rattachés (cron).
 * Rend le nombre d'envois effacés.
 */
export async function nettoyerEnvois(base, stockage, { maintenant = Date.now(), delai = DELAI_ABANDON_MS } = {}) {
  const limite = iso(maintenant - delai);
  const vieux = await base.tous("SELECT * FROM envois WHERE maj_le < ? AND (statut = 'en_cours' OR fichier_id IS NULL) ORDER BY maj_le LIMIT 500", [limite]);
  let n = 0;
  for (const e of vieux) {
    if (stockage) {
      if (e.statut === 'en_cours') await stockage.abandonnerEnvoi?.(e.cle_stockage, { jeton: e.jeton_stockage }).catch(() => undefined);
      else await stockage.supprimer(e.cle_stockage).catch(() => undefined);
    }
    n += (await base.executer('DELETE FROM envois WHERE id = ? AND maj_le < ? AND fichier_id IS NULL', [e.id, limite])).changements;
  }
  return n;
}

/**
 * `socle` : services du cœur (contexteTeam). `config` : `{ plafond, tailleMorceau }` (configMedias).
 */
export function servicesMedias({ base, stockage, cleSession, maintenant = () => Date.now(), socle, config = configMedias() }) {
  const { contexteTeam } = socle;
  const peut = (ctx, p) => autorise(ctx.permissions, ctx.modules, p);
  /** Contextes fournis par d'autres services pour les usages « externes » (section CM : portée club ou team). */
  const contextesExternes = new Map();
  const portee = ctx => ctx.portee ?? ctx.team.id;

  function exiger(ctx, permission) {
    const [module] = permission.split('.');
    const mod = { video_review: 'video_review', meeting_summaries: 'meeting_summaries', resources: 'resources' }[module] ?? null;
    if (mod && !ctx.modules.has(mod)) throw echec(404, 'module-desactive', 'Ce module n’est pas activé pour cette team.');
    if (!peut(ctx, permission)) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
  }

  async function contexteEnvoi(acteur, teamId, usage) {
    const u = USAGES[usage];
    if (!u) throw echec(404, 'route', 'Adresse inconnue.');
    if (u.externe) {
      const resoudre = contextesExternes.get(usage);
      if (!resoudre) throw echec(404, 'route', 'Adresse inconnue.');
      const ctx = await resoudre(acteur, teamId);
      if (!stockage || typeof stockage.debuterEnvoi !== 'function') throw echec(503, 'stockage-absent', 'Le stockage des fichiers n’est pas branché sur le serveur Esport.');
      return ctx;
    }
    const ctx = await contexteTeam(acteur, teamId);
    if (!ctx.modules.has(u.module)) throw echec(404, 'module-desactive', 'Ce module n’est pas activé pour cette team.');
    if (!peut(ctx, u.permission) && !(u.autoriser && (await u.autoriser(base, ctx)))) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    if (!stockage || typeof stockage.debuterEnvoi !== 'function') throw echec(503, 'stockage-absent', 'Le stockage des fichiers n’est pas branché sur le serveur Esport.');
    return ctx;
  }

  async function envoiDe(ctx, usage, id) {
    exigerUuid(id, 'envoi');
    const e = await base.premier('SELECT * FROM envois WHERE id = ? AND portee = ? AND usage = ? AND compte_id = ?', [id, portee(ctx), usage, ctx.acteur.compte]);
    if (!e) throw echec(404, 'envoi-introuvable', 'Envoi introuvable (annulé ou effacé après 24 h) : recommencez.');
    return e;
  }

  const taillePrevue = (e, indice) => (indice < Number(e.morceaux) - 1 ? Number(e.taille_morceau) : Number(e.taille) - Number(e.taille_morceau) * (Number(e.morceaux) - 1));

  function etatPublic(e) {
    const recus = Number(e.recus);
    const analyse = jsonOu(e.meta_media, null);
    return {
      id: e.id,
      usage: e.usage,
      nom: e.nom_original,
      taille: Number(e.taille),
      tailleMorceau: Number(e.taille_morceau),
      morceaux: Number(e.morceaux),
      recus,
      octetsRecus: Math.min(Number(e.taille), recus * Number(e.taille_morceau)),
      statut: e.statut,
      rattache: Boolean(e.fichier_id),
      media: analysePublique(analyse),
      creeLe: e.cree_le,
      majLe: e.maj_le,
    };
  }

  // -------------------------------------------------------------- Envoi

  async function debuterEnvoi(acteur, teamId, usage, corps) {
    const ctx = await contexteEnvoi(acteur, teamId, usage);
    const taille = Number(corps?.taille);
    if (!Number.isSafeInteger(taille) || taille <= 0) throw echec(400, 'taille', 'Taille du fichier invalide.');
    const plafond = Math.min(config.plafond, ctx.plafond ?? config.plafond);
    if (taille > plafond) {
      const e = echec(413, 'fichier-trop-gros', `Fichier trop gros : ${Math.floor(plafond / Mio)} Mo au plus.`);
      e.details = { plafond };
      throw e;
    }
    // Drive : quota (espace utilisé + envois en cours + ce fichier).
    if (ctx.avantEnvoi) await ctx.avantEnvoi(taille);
    const ouverts = await base.premier("SELECT COUNT(*) AS n FROM envois WHERE compte_id = ? AND statut = 'en_cours'", [acteur.compte]);
    if (Number(ouverts?.n ?? 0) >= ENVOIS_OUVERTS_MAX) throw echec(429, 'trop-d-envois', 'Trop d’envois en cours : terminez-en ou annulez-en un.');
    const nom = nomMedia(corps?.nom, { review: 'video', reunion: 'enregistrement', ressource: 'fichier', cm: 'fichier', drive: 'fichier' }[usage]);
    const typeAnnonce = texteNettoye(corps?.type, 100);
    const tailleMorceau = config.tailleMorceau;
    const morceaux = Math.ceil(taille / tailleMorceau);
    const id = nouvelId();
    const cle = ctx.team.id ? `teams/${ctx.team.id}/${USAGES[usage].dossier}/${nouvelId()}.media` : `club/${USAGES[usage].dossier}/${nouvelId()}.media`;
    const jeton = String((await stockage.debuterEnvoi(cle, { type: 'application/octet-stream' })) ?? '');
    const t = iso(maintenant());
    try {
      await base.executer(
        `INSERT INTO envois (id, team_id, portee, compte_id, usage, nom_original, type_annonce, taille, taille_morceau, morceaux, recus, empreinte_etat, jeton_stockage, cle_stockage, statut, cree_le, maj_le)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'en_cours', ?, ?)`,
        [id, ctx.team.id ?? null, portee(ctx), acteur.compte, usage, nom, typeAnnonce, taille, tailleMorceau, morceaux, exporterEtat(nouvelEtat()), jeton, cle, t, t],
      );
    } catch (err) {
      await stockage.abandonnerEnvoi(cle, { jeton }).catch(() => undefined);
      throw err;
    }
    return etatPublic(await base.premier('SELECT * FROM envois WHERE id = ?', [id]));
  }

  async function etatEnvoi(acteur, teamId, usage, id) {
    const ctx = await contexteEnvoi(acteur, teamId, usage);
    return etatPublic(await envoiDe(ctx, usage, id));
  }

  /** Abandon : octets effacés, ligne supprimée (rien ne reste). */
  async function oublier(e) {
    if (e.statut === 'en_cours') await stockage.abandonnerEnvoi(e.cle_stockage, { jeton: e.jeton_stockage }).catch(() => undefined);
    else await stockage.supprimer(e.cle_stockage).catch(() => undefined);
    await base.executer('DELETE FROM envois WHERE id = ? AND fichier_id IS NULL', [e.id]);
  }

  async function recevoirMorceau(acteur, teamId, usage, id, indiceTexte, requete) {
    const ctx = await contexteEnvoi(acteur, teamId, usage);
    const e = await envoiDe(ctx, usage, id);
    if (e.statut !== 'en_cours') throw echec(409, 'envoi-termine', 'Cet envoi est déjà terminé.');
    const indice = Number(indiceTexte);
    if (!/^\d{1,7}$/.test(String(indiceTexte)) || indice >= Number(e.morceaux)) throw echec(400, 'indice', 'Numéro de morceau invalide.');
    const sha = String(requete.headers.get('X-Sha256') ?? '').trim().toLowerCase();
    if (!MOTIF_SHA.test(sha)) throw echec(400, 'empreinte', 'Empreinte SHA-256 du morceau absente (en-tête X-Sha256).');
    const recus = Number(e.recus);
    const empreintes = jsonOu(e.empreintes, []);
    if (indice < recus) {
      // Morceau déjà reçu (réponse perdue pendant une coupure) : rien à réécrire s'il est identique.
      await requete.body?.cancel().catch(() => undefined);
      if (empreintes[indice] !== sha) throw echec(409, 'morceau-different', 'Ce morceau a déjà été reçu avec un autre contenu : recommencez l’envoi.');
      return etatPublic(e);
    }
    if (indice > recus) {
      await requete.body?.cancel().catch(() => undefined);
      const err = echec(409, 'morceau-hors-ordre', 'Morceau hors ordre : reprenez au morceau attendu.');
      err.details = { attendu: recus };
      throw err;
    }
    const attendu = taillePrevue(e, indice);
    const octets = await lireMorceau(requete, attendu);
    if (octets.length !== attendu) {
      const err = echec(400, 'taille-morceau', 'Taille du morceau inattendue.');
      err.details = { attendu, recu: octets.length };
      throw err;
    }
    if ((await empreinteSha256(octets)) !== sha) throw echec(422, 'empreinte-morceau', 'Morceau abîmé pendant l’envoi (SHA-256 différent) : renvoyez-le.');
    let analyse = null;
    if (indice === 0) {
      analyse = analyserDebut(octets, { etendu: usage === 'drive' });
      if (!analyse || !FORMATS_PERMIS[usage].includes(analyse.format)) {
        await oublier(e);
        if (usage === 'drive') throw echec(415, 'format-fichier', 'Type de fichier refusé : images, vidéos, audio, PDF, polices, archives, PSD ou texte (jamais de page web ni de programme).');
        if (usage === 'ressource' || usage === 'cm') throw echec(415, 'format-fichier', 'Fichier non reconnu : PDF, image (PNG, JPEG, GIF, WebP), vidéo (MP4, MOV, WebM, MKV) ou archive (ZIP, 7z, RAR).');
        throw echec(415, 'format-video', usage === 'review' ? 'Ce fichier n’est pas une vidéo reconnue (MP4, MOV, WebM ou MKV).' : 'Ce fichier n’est ni une vidéo ni un audio reconnu (MP4, MOV, WebM, MKV, M4A, MP3, WAV, OGG, FLAC).');
      }
    }
    const etiquette = await stockage.ecrireMorceau(e.cle_stockage, { jeton: e.jeton_stockage, indice, decalage: indice * Number(e.taille_morceau), octets });
    const etat = ajouter(importerEtat(e.empreinte_etat), octets);
    const etiquettes = jsonOu(e.etiquettes, []);
    etiquettes[indice] = String(etiquette ?? '');
    empreintes[indice] = sha;
    const t = iso(maintenant());
    const r = await base.executer(
      'UPDATE envois SET recus = ?, empreinte_etat = ?, empreintes = ?, etiquettes = ?, meta_media = COALESCE(?, meta_media), maj_le = ? WHERE id = ? AND recus = ? AND statut = ?',
      [recus + 1, exporterEtat(etat), JSON.stringify(empreintes), JSON.stringify(etiquettes), analyse ? JSON.stringify(analyse) : null, t, e.id, recus, 'en_cours'],
    );
    if (r.changements !== 1) throw echec(409, 'envoi-concurrent', 'Ce morceau est déjà en cours d’envoi : reprenez l’envoi.');
    return etatPublic(await base.premier('SELECT * FROM envois WHERE id = ?', [e.id]));
  }

  async function terminerEnvoi(acteur, teamId, usage, id, corps) {
    const ctx = await contexteEnvoi(acteur, teamId, usage);
    const e = await envoiDe(ctx, usage, id);
    if (e.statut === 'termine') return etatPublic(e);
    if (Number(e.recus) !== Number(e.morceaux)) {
      const err = echec(409, 'envoi-incomplet', 'Il manque des morceaux : reprenez l’envoi.');
      err.details = { attendu: Number(e.recus) };
      throw err;
    }
    const sha = String(corps?.sha256 ?? '').trim().toLowerCase();
    if (!MOTIF_SHA.test(sha)) throw echec(400, 'empreinte', 'Empreinte SHA-256 du fichier absente.');
    const calcule = terminer(importerEtat(e.empreinte_etat));
    if (calcule !== sha) {
      await oublier(e);
      throw echec(422, 'empreinte-fichier', 'Le fichier reçu ne correspond pas à l’original (SHA-256 différent) : recommencez l’envoi.');
    }
    let analyse = jsonOu(e.meta_media, null);
    const mime = FORMATS[analyse?.format]?.mime ?? 'application/octet-stream';
    await stockage.terminerEnvoi(e.cle_stockage, { jeton: e.jeton_stockage, etiquettes: jsonOu(e.etiquettes, []), type: mime });
    if (analyse?.moovAuDebut === false && typeof stockage.lireTranche === 'function') {
      // MP4 enregistré sans « faststart » : les métadonnées (codec, durée) sont à la fin du fichier.
      const taille = Number(e.taille);
      const debut = Math.max(0, taille - 8 * Mio);
      const tranche = await stockage.lireTranche(e.cle_stockage, debut, taille - 1).catch(() => null);
      if (tranche) analyse = completerAvecFin(analyse, tranche.octets ?? new Uint8Array(await new Response(tranche.flux).arrayBuffer()));
    }
    await base.executer("UPDATE envois SET statut = 'termine', empreinte = ?, meta_media = ?, maj_le = ? WHERE id = ? AND statut = 'en_cours'", [sha, JSON.stringify(analyse), iso(maintenant()), e.id]);
    return etatPublic(await base.premier('SELECT * FROM envois WHERE id = ?', [e.id]));
  }

  async function annulerEnvoi(acteur, teamId, usage, id) {
    const ctx = await contexteEnvoi(acteur, teamId, usage);
    const e = await envoiDe(ctx, usage, id);
    if (e.fichier_id) throw echec(409, 'envoi-rattache', 'Ce fichier est déjà utilisé.');
    await oublier(e);
    return { ok: true };
  }

  /**
   * Rattache un envoi terminé (à soi, de la team, pour cet usage, pas encore utilisé) à une entité :
   * rend `{ fichierId, instructions, analyse }` (instructions SQL à mettre dans le lot de la création).
   */
  async function preparerRattachement(ctx, envoiId, usage, { entiteType, entiteId }) {
    const e = await envoiDe(ctx, usage, envoiId);
    if (e.statut !== 'termine') throw echec(409, 'envoi-incomplet', 'Il manque des morceaux : reprenez l’envoi.');
    if (e.fichier_id) throw echec(409, 'envoi-rattache', 'Ce fichier est déjà utilisé.');
    const analyse = jsonOu(e.meta_media, null);
    const fichierId = nouvelId();
    const t = iso(maintenant());
    if (USAGES[usage]?.externe) {
      return {
        fichierId,
        analyse,
        envoi: e,
        instructions: [
          {
            sql: `INSERT INTO cm_fichiers (id, portee, team_id, cle_stockage, type_mime, taille, nom_original, empreinte, depose_par, meta, cree_le)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            params: [fichierId, portee(ctx), ctx.team.id ?? null, e.cle_stockage, FORMATS[analyse?.format]?.mime ?? 'application/octet-stream', Number(e.taille), e.nom_original, e.empreinte, ctx.acteur.compte, JSON.stringify(analyse), t],
          },
          { sql: 'UPDATE envois SET fichier_id = ?, maj_le = ? WHERE id = ? AND fichier_id IS NULL', params: [fichierId, t, e.id] },
        ],
      };
    }
    return {
      fichierId,
      analyse,
      envoi: e,
      instructions: [
        {
          sql: `INSERT INTO fichiers (id, team_id, entite_type, entite_id, cle_stockage, type_mime, taille, nom_original, empreinte, depose_par, cree_le, meta)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params: [fichierId, ctx.team.id, entiteType, entiteId, e.cle_stockage, FORMATS[analyse?.format]?.mime ?? 'application/octet-stream', Number(e.taille), e.nom_original, e.empreinte, ctx.acteur.compte, t, JSON.stringify(analyse)],
        },
        { sql: 'UPDATE envois SET fichier_id = ?, maj_le = ? WHERE id = ? AND fichier_id IS NULL', params: [fichierId, t, e.id] },
      ],
    };
  }

  /** Efface les octets d'un fichier (la ligne reste, marquée supprimée). */
  async function effacerOctets(fichierId) {
    if (!fichierId) return;
    const f = await base.premier('SELECT * FROM fichiers WHERE id = ? AND supprime_le IS NULL', [fichierId]);
    if (!f) return;
    if (stockage) await stockage.supprimer(f.cle_stockage).catch(() => undefined);
    await base.executer('UPDATE fichiers SET supprime_le = ? WHERE id = ?', [iso(maintenant()), f.id]);
  }

  async function fichier(id) {
    if (!id) return null;
    return base.premier('SELECT * FROM fichiers WHERE id = ?', [id]);
  }

  /** Lien signé (2 h) vers un média de la team ; droits déjà vérifiés par l'appelant. */
  async function lienMedia(acteur, f, { telecharger = false, duree = DUREE_LIEN_MEDIA_MS } = {}) {
    if (!f || f.supprime_le) throw echec(404, 'fichier-introuvable', 'Fichier introuvable (supprimé ?).');
    return cheminSigne(cleSession, { fichierId: f.id, compte: acteur.compte, maintenant: maintenant(), duree, telecharger });
  }

  // -------------------------------------------------------------- Lecture par lien signé

  /** Fichier (PDF, vidéo, enregistrement) par lien signé, entier ou par plage (Range → 206). */
  async function servirFichierSigne(fichierId, params, requete) {
    exigerUuid(fichierId, 'fichier');
    const { compte, telecharger } = await verifierLien(cleSession, fichierId, params, maintenant());
    const f = await base.premier('SELECT f.* FROM fichiers f JOIN teams t ON t.id = f.team_id WHERE f.id = ? AND t.supprimee_le IS NULL', [fichierId]);
    if (!f || f.supprime_le) throw echec(404, 'fichier-introuvable', 'Fichier introuvable.');
    // Le lien vaut quelques minutes (2 h pour une vidéo), mais un membre retiré ou suspendu entre-temps ne lit plus rien.
    if (compte !== 'principal' && !(await base.premier("SELECT id FROM membres WHERE team_id = ? AND compte_id = ? AND statut = 'actif'", [f.team_id, compte]))) {
      throw echec(403, 'lien-invalide', 'Lien de fichier invalide.');
    }
    if (!stockage) throw echec(503, 'stockage-absent', 'Le stockage des fichiers n’est pas branché.');
    const reponse = await reponseFichierStocke({ stockage, f, requete, telecharger });
    if (!reponse) throw echec(404, 'fichier-introuvable', 'Fichier introuvable.');
    return reponse;
  }

  // -------------------------------------------------------------- Espace utilisé

  function peutSupprimerFichier(ctx, f) {
    const n = NATURES[f.entite_type];
    if (!n?.permission || f.supprime_le) return false;
    // Le résumé PDF ACTUEL ne s'efface pas ici (on le remplace) ; ses anciennes versions, si.
    if (f.entite_type === 'reunion' && !f.remplace_le) return false;
    return peut(ctx, n.permission);
  }

  async function espace(acteur, teamId) {
    const ctx = await contexteTeam(acteur, teamId);
    if (!peut(ctx, 'team.manage')) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const lignes = await base.tous('SELECT * FROM fichiers WHERE team_id = ? AND supprime_le IS NULL ORDER BY cree_le DESC, id LIMIT 5000', [teamId]);
    const reviews = new Map((await lignesParIds(base, 'SELECT id, titre FROM reviews WHERE team_id = ? AND id', lignes.filter(f => f.entite_type === 'review_video').map(f => f.entite_id), { paramsAvant: [teamId] })).map(r => [r.id, r.titre]));
    const reunions = new Map((await lignesParIds(base, 'SELECT id, titre FROM reunions WHERE team_id = ? AND id', lignes.filter(f => f.entite_type.startsWith('reunion')).map(f => f.entite_id), { paramsAvant: [teamId] })).map(r => [r.id, r.titre]));
    const strats = new Map((await lignesParIds(base, 'SELECT id, titre FROM strats WHERE team_id = ? AND id', lignes.filter(f => f.entite_type === 'strat').map(f => f.entite_id), { paramsAvant: [teamId] })).map(r => [r.id, r.titre]));
    const ressources = new Map((await lignesParIds(base, 'SELECT id, titre FROM ressources WHERE team_id = ? AND id', lignes.filter(f => f.entite_type === 'ressource_fichier').map(f => f.entite_id), { paramsAvant: [teamId] })).map(r => [r.id, r.titre]));
    const noms = await pseudosDe(base, lignes.map(f => f.depose_par));
    const titre = f => (f.entite_type === 'review_video' ? reviews.get(f.entite_id) : f.entite_type === 'strat' ? strats.get(f.entite_id) : f.entite_type === 'ressource_fichier' ? ressources.get(f.entite_id) : reunions.get(f.entite_id)) ?? null;
    const fichiers = lignes.map(f => ({
      ...fichierPublic(f),
      nature: NATURES[f.entite_type]?.nature ?? 'autre',
      ancienneVersion: Boolean(f.remplace_le),
      cible: { type: f.entite_type, id: f.entite_id, titre: titre(f) },
      deposePar: { compte: f.depose_par, pseudo: noms[f.depose_par] ?? null },
      peutSupprimer: peutSupprimerFichier(ctx, f),
    }));
    const envois = await base.tous("SELECT * FROM envois WHERE team_id = ? AND (statut = 'en_cours' OR fichier_id IS NULL) ORDER BY maj_le DESC LIMIT 500", [teamId]);
    const nomsEnvois = await pseudosDe(base, envois.map(e => e.compte_id));
    const enCours = envois.map(e => ({ ...etatPublic(e), compte: { compte: e.compte_id, pseudo: nomsEnvois[e.compte_id] ?? null } }));
    const parNature = {};
    for (const f of fichiers) parNature[f.nature] = (parNature[f.nature] ?? 0) + f.taille;
    const enCoursOctets = enCours.reduce((n, e) => n + (e.statut === 'termine' ? e.taille : e.octetsRecus), 0);
    return {
      total: fichiers.reduce((n, f) => n + f.taille, 0) + enCoursOctets,
      parNature: { ...parNature, envois: enCoursOctets },
      fichiers,
      envois: enCours,
      plafond: config.plafond,
      tailleMorceau: config.tailleMorceau,
      delaiAbandonHeures: DELAI_ABANDON_MS / 3600_000,
    };
  }

  async function supprimerFichierEspace(acteur, teamId, fichierId) {
    const ctx = await contexteTeam(acteur, teamId);
    exigerUuid(fichierId, 'fichier');
    const f = await base.premier('SELECT * FROM fichiers WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [fichierId, teamId]);
    if (!f) throw echec(404, 'fichier-introuvable', 'Fichier introuvable.');
    const n = NATURES[f.entite_type];
    if (!n?.permission) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    exiger(ctx, n.permission);
    if (f.entite_type === 'reunion' && !f.remplace_le) throw echec(409, 'resume-actuel', 'Le résumé actuel ne se supprime pas ici : remplacez-le d’abord.');
    if (stockage) await stockage.supprimer(f.cle_stockage).catch(() => undefined);
    const t = maintenant();
    const lot = [{ sql: 'UPDATE fichiers SET supprime_le = ? WHERE id = ? AND team_id = ?', params: [iso(t), f.id, teamId] }];
    if (f.entite_type === 'reunion_transcription') lot.push({ sql: 'UPDATE reunions SET transcription_pdf_id = NULL WHERE transcription_pdf_id = ? AND team_id = ?', params: [f.id, teamId] });
    lot.push(evenement('media.deleted', { teamId, acteur: acteur.compte, entiteType: 'fichier', entiteId: f.id, charge: { nom: f.nom_original, nature: n.nature, taille: Number(f.taille) }, maintenant: t }));
    await base.lot(lot);
    return espace(acteur, teamId).catch(() => ({ ok: true }));
  }

  // -------------------------------------------------------------- RGPD

  /**
   * Vidéos et enregistrements déposés par le compte, et transcriptions de ses réunions : liste et liens
   * signés (72 h, téléchargement). `origine` : adresse du serveur (préfixe des liens).
   */
  async function exportRgpd(compte, origine = '') {
    const deposes = await base.tous(
      "SELECT f.*, t.nom AS team_nom FROM fichiers f JOIN teams t ON t.id = f.team_id WHERE f.depose_par = ? AND f.entite_type IN ('review_video', 'reunion_enregistrement', 'ressource_fichier') AND f.supprime_le IS NULL ORDER BY f.cree_le LIMIT 2000",
      [compte],
    );
    const transcrits = await base.tous(
      `SELECT x.*, r.titre, r.date_reunion, r.transcription_pdf_id, t.nom AS team_nom FROM transcriptions x JOIN reunions r ON r.id = x.reunion_id JOIN teams t ON t.id = x.team_id
       WHERE r.depose_par = ? AND r.supprime_le IS NULL ORDER BY x.cree_le LIMIT 2000`,
      [compte],
    );
    const lien = async id => {
      if (!id) return null;
      const { chemin, expire } = await cheminSigne(cleSession, { fichierId: id, compte, maintenant: maintenant(), duree: DUREE_LIEN_EXPORT_MS, telecharger: true });
      return { url: `${origine}${chemin}`, expire: iso(expire) };
    };
    const medias = [];
    for (const f of deposes) {
      medias.push({ team: f.team_nom, nature: NATURES[f.entite_type]?.nature, nom: f.nom_original, taille: Number(f.taille), deposeLe: f.cree_le, lien: await lien(f.id) });
    }
    const transcriptions = [];
    for (const x of transcrits) {
      const segments = jsonOu(x.segments, []);
      transcriptions.push({
        team: x.team_nom,
        reunion: x.titre,
        date: x.date_reunion,
        langue: x.langue,
        segments: segments.length,
        texte: segments.map(s => s[2]).join(' ').slice(0, 200_000),
        pdf: await lien(x.transcription_pdf_id),
        majLe: x.maj_le,
      });
    }
    return { mediasDeposes: medias, transcriptions };
  }

  /** Section CM : contexte d'envoi d'un usage externe (`(acteur, portee) → { acteur, team: { id }, portee }`). */
  function brancherContexte(usage, resoudre) {
    contextesExternes.set(usage, resoudre);
  }

  return {
    config,
    brancherContexte,
    debuterEnvoi,
    etatEnvoi,
    recevoirMorceau,
    terminerEnvoi,
    annulerEnvoi,
    preparerRattachement,
    effacerOctets,
    fichier,
    lienMedia,
    servirFichierSigne,
    espace,
    supprimerFichierEspace,
    exportRgpd,
  };
}
