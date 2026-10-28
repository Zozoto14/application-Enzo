/**
 * Module « Strats » (phase 6) : éditeur de stratégies sur la minimap.
 *
 *  - Une strat = un document JSON versionné (document.mjs), validé ici, avec
 *    un verrou optimiste (`revision`) et l'historique des enregistrements
 *    (`strat_versions`, les 30 derniers).
 *  - Miniature : image (JPEG ou PNG, 256 Ko au plus) générée par l'app à
 *    l'enregistrement, stockée par l'interface de stockage (disque en
 *    production) dans `fichiers`, lue par un lien signé d'une heure. Sans
 *    stockage branché, la strat s'enregistre sans miniature.
 *  - Partage : visibilité « team » (toute la team qui a strats.view) ou
 *    « privée » (son auteur, et le staff qui a strats.delete) ; lien de
 *    lecture seule signé et révocable (strats.share), servi sans session par
 *    `GET /partage/strats/<jeton>` (page HTML ou JSON).
 *  - Duplication (strats.create).
 *
 * Contrôles, dans l'ordre : appartenance (contexteTeam) → module
 * `strat_editor` activé (sinon 404) → permission (sinon 403).
 */

import { evenement } from '../evenements.mjs';
import { cheminSigne, empreinteSha256 } from '../fichiers.mjs';
import { autorise } from '../permissions.mjs';
import { ErreurEsport, base64url, depuisBase64url, echec, egal, iso, jsonOu, nouvelId, texteLong, texteNettoye } from '../outils.mjs';
import { pseudosDe } from '../requetes.mjs';
import { SIDES, TYPES_STRAT, documentVide, validerDocument } from './document.mjs';

export const MODULE_STRATS = 'strat_editor';
export const VERSIONS_GARDEES = 30;
export const DUREE_CORBEILLE_STRATS_MS = 30 * 86_400_000;
export const TAILLE_MAX_MINIATURE = 256 * 1024;
export const DUREE_LIEN_MINIATURE_MS = 60 * 60 * 1000;
export const LIBELLES_TYPES = { default: 'Default', execute: 'Exécution', eco: 'Éco', pistol: 'Pistol', retake: 'Retake', other: 'Autre' };
const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MOTIF_JETON = /^sp1\.([0-9a-f]{32})\.([A-Za-z0-9_-]{43})$/;
const MOTIF_TAG = /^[\p{L}\p{N}][\p{L}\p{N} _'-]{0,23}$/u;
const TAGS_MAX = 12;
const encodeur = new TextEncoder();

const exigerUuid = (valeur, quoi) => {
  if (typeof valeur !== 'string' || !MOTIF_UUID.test(valeur)) throw echec(404, `${quoi}-introuvable`, 'Introuvable.');
  return valeur;
};

/** Tags saisis : nettoyés, sans doublon (insensible à la casse), 12 au plus. */
export function tagsPropres(v) {
  if (v === undefined || v === null) return [];
  const liste = Array.isArray(v) ? v : String(v).split(',');
  const vus = new Set();
  const sortie = [];
  for (const brut of liste) {
    const t = texteNettoye(brut, 24);
    if (!t) continue;
    if (!MOTIF_TAG.test(t)) throw echec(400, 'tag', `Tag illisible : ${t.slice(0, 24)}`);
    const k = t.toLocaleLowerCase('fr');
    if (vus.has(k)) continue;
    vus.add(k);
    sortie.push(t);
  }
  if (sortie.length > TAGS_MAX) throw echec(400, 'tags', `${TAGS_MAX} tags au plus.`);
  return sortie;
}

/** Image de miniature : data URL JPEG ou PNG (octets magiques vérifiés), taille bornée. */
export function lireMiniature(dataUrl) {
  const m = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
  if (!m) throw echec(400, 'miniature', 'Miniature illisible (PNG ou JPEG en data URL).');
  if ((m[2].length * 3) / 4 > TAILLE_MAX_MINIATURE + 4) throw echec(413, 'miniature-trop-grosse', 'Miniature trop volumineuse (256 Ko au plus).');
  const octets = depuisBase64url(m[2].replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
  if (octets.length === 0 || octets.length > TAILLE_MAX_MINIATURE) throw echec(413, 'miniature-trop-grosse', 'Miniature trop volumineuse (256 Ko au plus).');
  const png = octets[0] === 0x89 && octets[1] === 0x50 && octets[2] === 0x4e && octets[3] === 0x47;
  const jpeg = octets[0] === 0xff && octets[1] === 0xd8 && octets[2] === 0xff;
  if ((m[1] === 'image/png' && !png) || (m[1] === 'image/jpeg' && !jpeg)) throw echec(415, 'miniature-invalide', 'Ce fichier n’est pas une vraie image.');
  return { octets, type: m[1], extension: png ? 'png' : 'jpg' };
}

async function hmac(secret, texte) {
  if (typeof secret !== 'string' || secret.length < 32) throw echec(503, 'non-configure', 'Le serveur Esport n’a pas de clé de session (CLE_ESPORT).');
  const cle = await globalThis.crypto.subtle.importKey('raw', encodeur.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64url(await globalThis.crypto.subtle.sign('HMAC', cle, encodeur.encode(texte)));
}

/** Jeton de lien en lecture seule : `sp1.<id du lien>.<signature>`. */
export async function jetonPartage(secret, partageId, stratId) {
  return `sp1.${partageId.replace(/-/g, '')}.${await hmac(secret, `strat-partage|${partageId}|${stratId}`)}`;
}

const uuidDepuisHex = h => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;

export function servicesStrats({ base, stockage, cleSession, maintenant = () => Date.now(), socle }) {
  const { contexteTeam } = socle;
  const peut = (ctx, p) => autorise(ctx.permissions, ctx.modules, p);

  function exiger(ctx, permission) {
    if (!ctx.modules.has(MODULE_STRATS)) throw echec(404, 'module-desactive', 'Ce module n’est pas activé pour cette team.');
    if (permission && !peut(ctx, permission)) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
  }

  /** Une strat privée n'est visible que de son auteur, du staff (strats.delete) et du super admin. */
  const visible = (ctx, s) => s.visibilite === 'team' || s.cree_par === ctx.acteur.compte || ctx.acteur.superAdmin || peut(ctx, 'strats.delete');

  async function stratDeTeam(ctx, id) {
    exigerUuid(id, 'strat');
    const s = await base.premier('SELECT * FROM strats WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [id, ctx.team.id]);
    if (!s || !visible(ctx, s)) throw echec(404, 'strat-introuvable', 'Strat introuvable.');
    return s;
  }

  const pseudos = ids => pseudosDe(base, ids);

  /** Lien signé (1 h) vers la miniature, à préfixer par l'adresse du serveur (`origine`). */
  async function lienMiniature(fichierId, compte, origine = '') {
    if (!fichierId || !stockage || !cleSession) return null;
    const { chemin, expire } = await cheminSigne(cleSession, { fichierId, compte, maintenant: maintenant(), duree: DUREE_LIEN_MINIATURE_MS });
    return { url: `${origine}${chemin}`, expire: iso(expire) };
  }

  async function stratPublique(ctx, s, noms, { origine, avecDonnees = false } = {}) {
    return {
      id: s.id,
      jeu: s.jeu,
      titre: s.titre,
      carte: { cle: s.carte, nom: s.carte_nom },
      side: s.side,
      type: s.type,
      tags: jsonOu(s.tags, []),
      notes: s.notes,
      visibilite: s.visibilite,
      revision: Number(s.revision),
      versionDocument: Number(s.version_document),
      miniature: await lienMiniature(s.miniature_id, ctx.acteur.compte, origine),
      origine: s.origine_id ?? null,
      creePar: { compte: s.cree_par, pseudo: noms[s.cree_par] ?? null },
      majPar: { compte: s.maj_par, pseudo: noms[s.maj_par] ?? null },
      creeLe: s.cree_le,
      majLe: s.maj_le,
      moi: {
        modifier: peut(ctx, 'strats.update'),
        supprimer: peut(ctx, 'strats.delete') || (s.cree_par === ctx.acteur.compte && peut(ctx, 'strats.create')),
        partager: peut(ctx, 'strats.share'),
      },
      ...(avecDonnees ? { donnees: JSON.parse(s.donnees) } : {}),
    };
  }

  // -------------------------------------------------------------- Lecture

  async function liste(acteur, teamId, filtres = {}, { origine } = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'strats.view');
    const lignes = await base.tous(
      'SELECT id, team_id, jeu, titre, carte, carte_nom, side, type, tags, notes, visibilite, revision, version_document, miniature_id, origine_id, cree_par, cree_le, maj_par, maj_le FROM strats WHERE team_id = ? AND supprime_le IS NULL ORDER BY maj_le DESC LIMIT 500',
      [teamId],
    );
    const q = normaliser(filtres.q ?? '');
    const tag = normaliser(filtres.tag ?? '');
    const retenues = lignes.filter(
      s =>
        visible(ctx, s) &&
        (!filtres.carte || s.carte === filtres.carte) &&
        (!filtres.side || s.side === filtres.side) &&
        (!filtres.type || s.type === filtres.type) &&
        (!tag || jsonOu(s.tags, []).some(t => normaliser(t) === tag)) &&
        (!q || normaliser(`${s.titre} ${s.carte_nom} ${s.notes} ${jsonOu(s.tags, []).join(' ')}`).includes(q)),
    );
    const noms = await pseudos(retenues.flatMap(s => [s.cree_par, s.maj_par]));
    return Promise.all(retenues.map(s => stratPublique(ctx, s, noms, { origine })));
  }

  async function detail(acteur, teamId, id, { origine } = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'strats.view');
    const s = await stratDeTeam(ctx, id);
    return stratPublique(ctx, s, await pseudos([s.cree_par, s.maj_par]), { origine, avecDonnees: true });
  }

  // -------------------------------------------------------------- Écriture

  function meta(corps, partiel) {
    const m = {};
    if (!partiel || corps?.titre !== undefined) {
      m.titre = texteNettoye(corps?.titre, 80);
      if (m.titre.length < 2) throw echec(400, 'titre', 'Titre : 2 caractères au moins.');
    }
    if (!partiel || corps?.type !== undefined) {
      const type = corps?.type ?? 'default';
      if (!TYPES_STRAT.includes(type)) throw echec(400, 'type', 'Type de strat inconnu.');
      m.type = type;
    }
    if (!partiel || corps?.tags !== undefined) m.tags = JSON.stringify(tagsPropres(corps?.tags));
    if (!partiel || corps?.notes !== undefined) m.notes = texteLong(corps?.notes, 4000);
    if (corps?.visibilite !== undefined) {
      if (!['team', 'privee'].includes(corps.visibilite)) throw echec(400, 'visibilite', 'Visibilité : team ou privee.');
      m.visibilite = corps.visibilite;
    }
    return m;
  }

  /** Dépose la miniature (si un stockage est branché) ; rend les instructions SQL et l'ancienne clé à effacer. */
  async function preparerMiniature(ctx, stratId, dataUrl, ancienId, t) {
    if (dataUrl === undefined || dataUrl === null) return { instructions: [], miniatureId: ancienId ?? null };
    const { octets, type, extension } = lireMiniature(dataUrl);
    if (!stockage) return { instructions: [], miniatureId: ancienId ?? null, sansStockage: true };
    const id = nouvelId();
    const cle = `teams/${ctx.team.id}/strats/${nouvelId()}.${extension}`;
    await stockage.deposer(cle, octets, { type });
    const instructions = [
      {
        sql: 'INSERT INTO fichiers (id, team_id, entite_type, entite_id, cle_stockage, type_mime, taille, nom_original, empreinte, depose_par, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        params: [id, ctx.team.id, 'strat', stratId, cle, type, octets.length, `miniature.${extension}`, await empreinteSha256(octets), ctx.acteur.compte, iso(t)],
      },
    ];
    if (ancienId) instructions.push({ sql: 'UPDATE fichiers SET remplace_le = ? WHERE id = ?', params: [iso(t), ancienId] });
    return { instructions, miniatureId: id, nouvelleCle: cle };
  }

  async function effacerAncienne(ancienId) {
    if (!ancienId || !stockage) return;
    const f = await base.premier('SELECT cle_stockage FROM fichiers WHERE id = ?', [ancienId]);
    // La ligne de `fichiers` reste (remplace_le) ; seuls les octets disparaissent.
    if (f) await stockage.supprimer(f.cle_stockage).catch(() => undefined);
  }

  async function creer(acteur, teamId, corps, { origine } = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'strats.create');
    const m = meta(corps, false);
    const jeu = ctx.team.jeu === 'valorant' ? 'valorant' : 'autre';
    let doc;
    if (corps?.donnees !== undefined) doc = validerDocument(corps.donnees);
    else {
      if (!SIDES.includes(corps?.side ?? 'attaque')) throw echec(400, 'side', 'Side : attaque ou défense.');
      doc = documentVide({ carte: corps?.carte, side: corps?.side ?? 'attaque', jeu });
    }
    const t = maintenant();
    const id = nouvelId();
    const miniature = await preparerMiniature(ctx, id, corps?.miniature, null, t);
    const texte = JSON.stringify(doc);
    await base.lot([
      {
        sql: `INSERT INTO strats (id, team_id, jeu, titre, carte, carte_nom, side, type, donnees, version_document, revision, miniature_id, tags, notes, visibilite, cree_par, cree_le, maj_par, maj_le)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?, ?, ?, ?, ?, ?)`,
        params: [id, teamId, doc.jeu, m.titre, doc.carte.cle, doc.carte.nom, doc.side, m.type, texte, doc.version, m.tags, m.notes, m.visibilite ?? 'team', acteur.compte, iso(t), acteur.compte, iso(t)],
      },
      ...miniature.instructions,
      ...(miniature.miniatureId ? [{ sql: 'UPDATE strats SET miniature_id = ? WHERE id = ?', params: [miniature.miniatureId, id] }] : []),
      { sql: 'INSERT INTO strat_versions (id, strat_id, team_id, revision, donnees, cree_par, cree_le) VALUES (?, ?, ?, 1, ?, ?, ?)', params: [nouvelId(), id, teamId, texte, acteur.compte, iso(t)] },
      evenement('strat.created', { teamId, acteur: acteur.compte, entiteType: 'strat', entiteId: id, charge: { titre: m.titre, carte: doc.carte.nom, side: doc.side, type: m.type }, maintenant: t }),
    ]);
    return detail(acteur, teamId, id, { origine });
  }

  /** Enregistre le document (et, au besoin, titre, type, tags, notes, miniature). `revision` : celle sur laquelle l'app a travaillé. */
  async function enregistrer(acteur, teamId, id, corps, { origine } = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'strats.update');
    const s = await stratDeTeam(ctx, id);
    if (!Number.isInteger(corps?.revision)) throw echec(400, 'revision', 'Révision attendue (verrou optimiste).');
    if (corps.revision !== Number(s.revision)) {
      const e = echec(409, 'conflit', 'Quelqu’un a enregistré cette strat entre-temps : rechargez-la (vos changements restent dans l’éditeur).');
      e.details = { revision: Number(s.revision) };
      throw e;
    }
    const m = meta(corps, true);
    if (m.visibilite && s.cree_par !== acteur.compte && !acteur.superAdmin && !peut(ctx, 'strats.delete')) throw echec(403, 'permission', 'Seul l’auteur (ou le staff) change la visibilité.');
    const doc = corps.donnees === undefined ? JSON.parse(s.donnees) : validerDocument(corps.donnees);
    const texte = JSON.stringify(doc);
    const t = maintenant();
    const revision = Number(s.revision) + 1;
    const miniature = await preparerMiniature(ctx, id, corps.miniature, s.miniature_id, t);
    const champs = Object.keys(m);
    try {
      await base.lot([
        // D'abord la version : l'unicité (strat, révision) refuse un enregistrement concurrent.
        { sql: 'INSERT INTO strat_versions (id, strat_id, team_id, revision, donnees, cree_par, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?)', params: [nouvelId(), id, teamId, revision, texte, acteur.compte, iso(t)] },
        ...miniature.instructions,
        {
          sql: `UPDATE strats SET donnees = ?, version_document = ?, carte = ?, carte_nom = ?, side = ?, jeu = ?, revision = ?, miniature_id = ?, maj_par = ?, maj_le = ?${champs.map(c => `, ${c} = ?`).join('')} WHERE id = ? AND revision = ?`,
          params: [texte, doc.version, doc.carte.cle, doc.carte.nom, doc.side, doc.jeu, revision, miniature.miniatureId, acteur.compte, iso(t), ...champs.map(c => m[c]), id, Number(s.revision)],
        },
        { sql: 'DELETE FROM strat_versions WHERE strat_id = ? AND revision <= ?', params: [id, revision - VERSIONS_GARDEES] },
        evenement('strat.updated', { teamId, acteur: acteur.compte, entiteType: 'strat', entiteId: id, charge: { titre: m.titre ?? s.titre, revision, champs }, maintenant: t }),
      ]);
    } catch (e) {
      if (miniature.nouvelleCle) await stockage.supprimer(miniature.nouvelleCle).catch(() => undefined);
      if (/UNIQUE|unique|constraint/i.test(String(e?.message))) throw echec(409, 'conflit', 'Quelqu’un a enregistré cette strat entre-temps : rechargez-la.');
      throw e;
    }
    if (miniature.nouvelleCle) await effacerAncienne(s.miniature_id);
    const sortie = await detail(acteur, teamId, id, { origine });
    return miniature.sansStockage ? { ...sortie, avertissement: 'miniature-non-stockee' } : sortie;
  }

  /** Titre, type, tags, notes, visibilité (sans toucher au document). */
  async function modifier(acteur, teamId, id, corps, { origine } = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'strats.update');
    const s = await stratDeTeam(ctx, id);
    return enregistrer(acteur, teamId, id, { ...corps, donnees: undefined, miniature: undefined, revision: Number(s.revision) }, { origine });
  }

  async function dupliquer(acteur, teamId, id, corps, { origine } = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'strats.create');
    const s = await stratDeTeam(ctx, id);
    const titre = texteNettoye(corps?.titre, 80) || `${s.titre} (copie)`.slice(0, 80);
    const t = maintenant();
    const nouvel = nouvelId();
    await base.lot([
      {
        sql: `INSERT INTO strats (id, team_id, jeu, titre, carte, carte_nom, side, type, donnees, version_document, revision, miniature_id, tags, notes, visibilite, origine_id, cree_par, cree_le, maj_par, maj_le)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [nouvel, teamId, s.jeu, titre, s.carte, s.carte_nom, s.side, s.type, s.donnees, s.version_document, s.tags, s.notes, 'team', s.id, acteur.compte, iso(t), acteur.compte, iso(t)],
      },
      { sql: 'INSERT INTO strat_versions (id, strat_id, team_id, revision, donnees, cree_par, cree_le) VALUES (?, ?, ?, 1, ?, ?, ?)', params: [nouvelId(), nouvel, teamId, s.donnees, acteur.compte, iso(t)] },
      evenement('strat.duplicated', { teamId, acteur: acteur.compte, entiteType: 'strat', entiteId: nouvel, charge: { titre, source: s.id, sourceTitre: s.titre }, maintenant: t }),
    ]);
    // La miniature est recopiée (nouvel objet) : supprimer l'original ne la casse pas.
    if (s.miniature_id && stockage) {
      const f = await base.premier('SELECT * FROM fichiers WHERE id = ?', [s.miniature_id]);
      const objet = f ? await stockage.lire(f.cle_stockage) : null;
      if (objet) {
        const fid = nouvelId();
        const cle = `teams/${teamId}/strats/${nouvelId()}.${f.type_mime === 'image/png' ? 'png' : 'jpg'}`;
        await stockage.deposer(cle, objet.octets, { type: f.type_mime });
        await base.lot([
          {
            sql: 'INSERT INTO fichiers (id, team_id, entite_type, entite_id, cle_stockage, type_mime, taille, nom_original, empreinte, depose_par, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            params: [fid, teamId, 'strat', nouvel, cle, f.type_mime, f.taille, f.nom_original, f.empreinte, acteur.compte, iso(t)],
          },
          { sql: 'UPDATE strats SET miniature_id = ? WHERE id = ?', params: [fid, nouvel] },
        ]);
      }
    }
    return detail(acteur, teamId, nouvel, { origine });
  }

  /** Droit de supprimer (ou de restaurer) une strat : strats.delete, ou son auteur qui a strats.create. */
  const peutSupprimer = (ctx, s) => peut(ctx, 'strats.delete') || (s.cree_par === ctx.acteur.compte && peut(ctx, 'strats.create'));

  /** Met une strat à la corbeille (suppression logique, restaurable 30 jours). */
  async function mettreALaCorbeille(ctx, id) {
    const s = await stratDeTeam(ctx, id);
    if (!peutSupprimer(ctx, s)) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const t = maintenant();
    // Les liens de lecture seule sont révoqués (ils ne reviennent pas à la restauration). Le playbook GARDE le lien
    // vers la strat : l'entrée s'affiche sans elle tant qu'elle est à la corbeille et la retrouve à la restauration.
    await base.lot([
      { sql: 'UPDATE strats SET supprime_le = ?, supprime_par = ?, maj_le = ? WHERE id = ?', params: [iso(t), ctx.acteur.compte, iso(t), id] },
      { sql: 'UPDATE strat_partages SET revoque_le = ? WHERE strat_id = ? AND revoque_le IS NULL', params: [iso(t), id] },
      evenement('strat.deleted', { teamId: ctx.team.id, acteur: ctx.acteur.compte, entiteType: 'strat', entiteId: id, charge: { titre: s.titre }, maintenant: t }),
    ]);
  }

  async function supprimer(acteur, teamId, id) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'strats.view');
    await mettreALaCorbeille(ctx, id);
    return { ok: true };
  }

  /** Suppression de plusieurs strats d'un coup (50 au plus) : celles qui échouent sont listées avec leur code. */
  async function supprimerLot(acteur, teamId, ids) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'strats.view');
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 50) throw echec(400, 'ids', 'Choisissez de 1 à 50 strats.');
    const supprimees = [];
    const echecs = [];
    for (const id of [...new Set(ids)]) {
      try {
        await mettreALaCorbeille(ctx, id);
        supprimees.push(id);
      } catch (e) {
        if (!(e instanceof ErreurEsport)) throw e;
        echecs.push({ id, code: e.code });
      }
    }
    return { ok: true, supprimees, echecs };
  }

  // -------------------------------------------------------------- Corbeille (30 jours)

  const expiration = ligne => iso(Date.parse(ligne.supprime_le) + DUREE_CORBEILLE_STRATS_MS);

  /** Strats à la corbeille depuis moins de 30 jours que l'acteur peut restaurer. */
  async function corbeille(acteur, teamId, { origine } = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'strats.view');
    const limite = iso(maintenant() - DUREE_CORBEILLE_STRATS_MS);
    const lignes = await base.tous(
      'SELECT id, team_id, titre, carte, carte_nom, side, type, visibilite, miniature_id, cree_par, supprime_le, supprime_par FROM strats WHERE team_id = ? AND supprime_le IS NOT NULL AND supprime_le >= ? ORDER BY supprime_le DESC LIMIT 200',
      [teamId, limite],
    );
    const retenues = lignes.filter(s => visible(ctx, s) && peutSupprimer(ctx, s));
    const noms = await pseudos(retenues.flatMap(s => [s.supprime_par]).filter(Boolean));
    return Promise.all(
      retenues.map(async s => ({
        id: s.id,
        titre: s.titre,
        carte: { cle: s.carte, nom: s.carte_nom },
        side: s.side,
        type: s.type,
        visibilite: s.visibilite,
        miniature: await lienMiniature(s.miniature_id, ctx.acteur.compte, origine),
        supprimeLe: s.supprime_le,
        supprimePar: s.supprime_par ? { compte: s.supprime_par, pseudo: noms[s.supprime_par] ?? null } : null,
        expireLe: expiration(s),
      })),
    );
  }

  /** Remet une strat de la corbeille (30 jours au plus) ; les liens de partage révoqués restent révoqués. */
  async function restaurer(acteur, teamId, id, { origine } = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'strats.view');
    exigerUuid(id, 'strat');
    const s = await base.premier('SELECT * FROM strats WHERE id = ? AND team_id = ? AND supprime_le IS NOT NULL', [id, teamId]);
    if (!s || !visible(ctx, s) || s.supprime_le < iso(maintenant() - DUREE_CORBEILLE_STRATS_MS)) throw echec(404, 'strat-introuvable', 'Strat introuvable dans la corbeille.');
    if (!peutSupprimer(ctx, s)) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const t = maintenant();
    await base.lot([
      { sql: 'UPDATE strats SET supprime_le = NULL, supprime_par = NULL, maj_le = ? WHERE id = ?', params: [iso(t), id] },
      evenement('strat.restored', { teamId, acteur: acteur.compte, entiteType: 'strat', entiteId: id, charge: { titre: s.titre }, maintenant: t }),
    ]);
    return detail(acteur, teamId, id, { origine });
  }

  // -------------------------------------------------------------- Historique

  async function versions(acteur, teamId, id) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'strats.view');
    await stratDeTeam(ctx, id);
    const lignes = await base.tous('SELECT revision, cree_par, cree_le FROM strat_versions WHERE strat_id = ? ORDER BY revision DESC', [id]);
    const noms = await pseudos(lignes.map(l => l.cree_par));
    return lignes.map(l => ({ revision: Number(l.revision), par: { compte: l.cree_par, pseudo: noms[l.cree_par] ?? null }, le: l.cree_le }));
  }

  async function version(acteur, teamId, id, revision) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'strats.view');
    await stratDeTeam(ctx, id);
    const r = Number(revision);
    if (!Number.isInteger(r) || r < 1) throw echec(404, 'version-introuvable', 'Version introuvable.');
    const l = await base.premier('SELECT * FROM strat_versions WHERE strat_id = ? AND revision = ?', [id, r]);
    if (!l) throw echec(404, 'version-introuvable', 'Version introuvable.');
    // Une ancienne version est relue à travers la migration : toujours au format courant.
    return { revision: r, le: l.cree_le, donnees: validerDocument(JSON.parse(l.donnees)) };
  }

  // -------------------------------------------------------------- Liens de lecture seule

  const partagePublic = (p, jeton, origine) => ({
    id: p.id,
    libelle: p.libelle,
    creeLe: p.cree_le,
    expireLe: p.expire_le ?? null,
    revoque: Boolean(p.revoque_le),
    dernierAcces: p.dernier_acces_le ?? null,
    ...(jeton ? { jeton, url: `${origine ?? ''}/partage/strats/${jeton}` } : {}),
  });

  async function partages(acteur, teamId, id) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'strats.share');
    await stratDeTeam(ctx, id);
    const lignes = await base.tous('SELECT * FROM strat_partages WHERE strat_id = ? ORDER BY cree_le DESC LIMIT 20', [id]);
    return lignes.map(p => partagePublic(p));
  }

  async function creerPartage(acteur, teamId, id, corps, { origine } = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'strats.share');
    const s = await stratDeTeam(ctx, id);
    const actifs = await base.premier('SELECT COUNT(*) AS n FROM strat_partages WHERE strat_id = ? AND revoque_le IS NULL', [id]);
    if (Number(actifs?.n ?? 0) >= 5) throw echec(409, 'trop-de-liens', 'Cinq liens actifs au plus : révoquez-en un d’abord.');
    let expire = null;
    if (corps?.jours !== undefined && corps?.jours !== null) {
      if (!Number.isInteger(corps.jours) || corps.jours < 1 || corps.jours > 365) throw echec(400, 'jours', 'Validité : 1 à 365 jours.');
      expire = iso(maintenant() + corps.jours * 86_400_000);
    }
    const t = maintenant();
    const pid = nouvelId();
    const libelle = texteNettoye(corps?.libelle, 60) || 'Lien de lecture';
    const jeton = await jetonPartage(cleSession, pid, id);
    await base.lot([
      { sql: 'INSERT INTO strat_partages (id, team_id, strat_id, libelle, cree_par, cree_le, expire_le) VALUES (?, ?, ?, ?, ?, ?, ?)', params: [pid, teamId, id, libelle, acteur.compte, iso(t), expire] },
      evenement('strat.share_created', { teamId, acteur: acteur.compte, entiteType: 'strat', entiteId: id, charge: { titre: s.titre, libelle, expire }, maintenant: t }),
    ]);
    return partagePublic({ id: pid, libelle, cree_le: iso(t), expire_le: expire }, jeton, origine);
  }

  async function revoquerPartage(acteur, teamId, id, partageId) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'strats.share');
    const s = await stratDeTeam(ctx, id);
    exigerUuid(partageId, 'lien');
    const p = await base.premier('SELECT * FROM strat_partages WHERE id = ? AND strat_id = ? AND team_id = ?', [partageId, id, teamId]);
    if (!p) throw echec(404, 'lien-introuvable', 'Lien introuvable.');
    if (p.revoque_le) return { ok: true };
    const t = maintenant();
    await base.lot([
      { sql: 'UPDATE strat_partages SET revoque_le = ? WHERE id = ?', params: [iso(t), partageId] },
      evenement('strat.share_revoked', { teamId, acteur: acteur.compte, entiteType: 'strat', entiteId: id, charge: { titre: s.titre, libelle: p.libelle }, maintenant: t }),
    ]);
    return { ok: true };
  }

  /**
   * Lecture publique par jeton (sans session) : signature valide, lien ni
   * révoqué ni expiré, strat et team présentes, module encore activé. Sinon
   * 404, sans dire pourquoi.
   */
  async function lirePartage(jeton) {
    const inconnu = () => echec(404, 'partage-inconnu', 'Lien de strat introuvable ou révoqué.');
    const m = MOTIF_JETON.exec(String(jeton ?? ''));
    if (!m) throw inconnu();
    const pid = uuidDepuisHex(m[1]);
    const p = await base.premier('SELECT * FROM strat_partages WHERE id = ?', [pid]);
    if (!p) throw inconnu();
    if (!egal(m[2], await hmac(cleSession, `strat-partage|${pid}|${p.strat_id}`))) throw inconnu();
    if (p.revoque_le || (p.expire_le && p.expire_le <= iso(maintenant()))) throw inconnu();
    const s = await base.premier(
      `SELECT s.* FROM strats s JOIN teams t ON t.id = s.team_id
        JOIN team_modules tm ON tm.team_id = s.team_id AND tm.module = 'strat_editor' AND tm.active = 1
       WHERE s.id = ? AND s.supprime_le IS NULL AND t.supprimee_le IS NULL`,
      [p.strat_id],
    );
    if (!s) throw inconnu();
    await base.executer('UPDATE strat_partages SET dernier_acces_le = ? WHERE id = ?', [iso(maintenant()), pid]);
    return {
      titre: s.titre,
      type: s.type,
      libelleType: LIBELLES_TYPES[s.type] ?? s.type,
      notes: s.notes,
      tags: jsonOu(s.tags, []),
      majLe: s.maj_le,
      donnees: validerDocument(JSON.parse(s.donnees)),
    };
  }

  return { liste, detail, creer, enregistrer, modifier, dupliquer, supprimer, supprimerLot, corbeille, restaurer, versions, version, partages, creerPartage, revoquerPartage, lirePartage, lienMiniature, peut, exiger, visible };
}

/** Texte comparable (minuscules, sans accents) pour la recherche. */
export function normaliser(texte) {
  return String(texte ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Cron : efface définitivement les strats et entrées du playbook à la corbeille depuis plus de 30 jours.
 * Une strat effacée emporte son historique, ses liens de partage et sa miniature (lignes, puis octets) ; les entrées
 * du playbook qui la citaient restent, sans strat liée, et une copie perd sa référence d'origine. Rend les nombres effacés.
 */
export async function purgerCorbeilleStrats(base, stockage, { maintenant = Date.now(), duree = DUREE_CORBEILLE_STRATS_MS, limite = 200 } = {}) {
  const avant = iso(maintenant - duree);
  const strats = await base.tous('SELECT id FROM strats WHERE supprime_le IS NOT NULL AND supprime_le < ? ORDER BY supprime_le LIMIT ?', [avant, limite]);
  for (const { id } of strats) {
    const fichiers = await base.tous("SELECT cle_stockage FROM fichiers WHERE entite_type = 'strat' AND entite_id = ?", [id]);
    await base.lot([
      { sql: 'UPDATE playbook_entrees SET strat_id = NULL WHERE strat_id = ?', params: [id] },
      { sql: 'UPDATE strats SET origine_id = NULL WHERE origine_id = ?', params: [id] },
      { sql: 'DELETE FROM strat_versions WHERE strat_id = ?', params: [id] },
      { sql: 'DELETE FROM strat_partages WHERE strat_id = ?', params: [id] },
      { sql: 'DELETE FROM strats WHERE id = ?', params: [id] },
      { sql: "DELETE FROM fichiers WHERE entite_type = 'strat' AND entite_id = ?", params: [id] },
    ]);
    if (stockage) for (const f of fichiers) await stockage.supprimer(f.cle_stockage).catch(() => undefined);
  }
  const entrees = await base.tous('SELECT id FROM playbook_entrees WHERE supprime_le IS NOT NULL AND supprime_le < ? ORDER BY supprime_le LIMIT ?', [avant, limite]);
  for (const { id } of entrees) await base.executer('DELETE FROM playbook_entrees WHERE id = ?', [id]);
  return { strats: strats.length, entrees: entrees.length };
}
