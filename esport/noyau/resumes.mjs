/**
 * Module « Résumés de réunions » (phase 3, besoin prioritaire).
 *
 * Côté membre : dépôt d'une réunion (lien de l'enregistrement, type, date,
 * titre, note), historique de ses dépôts, lecture du PDF quand le résumé est
 * prêt. Côté rédacteur (Fondateur partout, et les rôles qui ont
 * `meeting_summaries.write_summary`) : boîte de réception de toutes les teams
 * accessibles, « Nouveau » / « Vu », statuts À résumer → En cours → Terminé,
 * dépôt du PDF (Terminé automatiquement), remplacement avec historique.
 *
 * Contrôles, dans l'ordre : authentification (api.mjs) → appartenance
 * (`contexteTeam`) → module activé → permission. Visibilité d'un résumé : le
 * déposant, les rédacteurs, `view_all`, et les lecteurs (`view_summary`) si le
 * type de réunion est ouvert à la team (« team ») ou s'ils ont
 * `meeting_summaries.view_staff` (type « staff »). Un dépôt invisible répond
 * 404, comme une team étrangère.
 */

import { evenement } from './evenements.mjs';
import { cheminSigne, cleStockageResume, empreinteSha256, lireOctets, nomOriginal, validerPdf, verifierEntetesPdf, verifierLien } from './fichiers.mjs';
import { autorise } from './permissions.mjs';
import { echec, iso, jsonOu, nouvelId, texteLong, texteNettoye } from './outils.mjs';
import { lignesParIds, pseudosDe } from './requetes.mjs';
import { fichierPublic } from './medias/service.mjs';
import { pdfTranscription } from './medias/pdf.mjs';
import { LANGUES_TRANSCRIPTION, preResume, transcrireParApi, validerSegments } from './medias/transcription.mjs';

export const MODULE_RESUMES = 'meeting_summaries';
export const STATUTS_REUNION = ['a_resumer', 'en_cours', 'termine'];
export const VISIBILITES = ['team', 'staff'];
const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MOTIF_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MOTIF_COULEUR = /^#[0-9a-fA-F]{6}$/;
const MOTIF_COMPTE = /^(principal|[a-z0-9]{6,16})$/;
const TRIS = ['recent', 'ancien', 'date', 'statut'];

const P = {
  deposer: 'meeting_summaries.submit',
  tout: 'meeting_summaries.view_all',
  rediger: 'meeting_summaries.write_summary',
  lire: 'meeting_summaries.view_summary',
  staff: 'meeting_summaries.view_staff',
};

export function dateValide(texte) {
  if (typeof texte !== 'string' || !MOTIF_DATE.test(texte)) return false;
  const d = new Date(`${texte}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texte;
}

/** Lien d'un enregistrement : http(s) seulement (jamais javascript:, data:…). */
export function lienValide(texte) {
  if (typeof texte !== 'string' || texte.length > 500) return false;
  try {
    const u = new URL(texte);
    return (u.protocol === 'https:' || u.protocol === 'http:') && Boolean(u.hostname);
  } catch {
    return false;
  }
}

const exigerUuid = (valeur, quoi) => {
  if (typeof valeur !== 'string' || !MOTIF_UUID.test(valeur)) throw echec(404, `${quoi}-introuvable`, 'Introuvable.');
  return valeur;
};

/**
 * `socle` : `contexteTeam(acteur, teamId)` de service.mjs (appartenance et
 * permissions effectives). `stockage` : interface de fichiers (facultative :
 * sans elle, le dépôt de PDF répond 503).
 */
export function servicesResumes({ base, stockage, cleSession, maintenant = () => Date.now(), socle, medias, transcriptionExterne = { actif: false }, fetchTranscription }) {
  const { contexteTeam } = socle;
  const peut = (ctx, permission) => autorise(ctx.permissions, ctx.modules, permission);

  function exigerModule(ctx) {
    if (!ctx.modules.has(MODULE_RESUMES)) throw echec(404, 'module-desactive', 'Ce module n’est pas activé pour cette team.');
  }
  function exigerUne(ctx, ...permissions) {
    exigerModule(ctx);
    if (!permissions.some(p => peut(ctx, p))) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
  }
  const redacteur = ctx => peut(ctx, P.rediger);
  const lecteurDeTout = ctx => peut(ctx, P.rediger) || peut(ctx, P.tout);

  /** L'acteur voit-il ce dépôt (et son PDF) ? */
  function visible(ctx, r, type) {
    if (r.depose_par === ctx.acteur.compte || lecteurDeTout(ctx)) return true;
    if (!peut(ctx, P.lire)) return false;
    return (type?.visibilite ?? 'team') === 'team' || peut(ctx, P.staff);
  }

  async function noms(ids) {
    return pseudosDe(base, ids);
  }

  const typePublic = t => ({ id: t.id, nom: t.nom, couleur: t.couleur, visibilite: t.visibilite, global: t.team_id == null, position: Number(t.position) });

  async function typesDeTeam(teamId, avecSupprimes = false) {
    const lignes = await base.tous(
      `SELECT * FROM types_reunion WHERE (team_id IS NULL OR team_id = ?) ${avecSupprimes ? '' : 'AND supprime_le IS NULL'} ORDER BY position, nom`,
      [teamId],
    );
    return lignes;
  }

  function reunionPublique(r, type, pseudos, ctx, team, enregistrements = new Map()) {
    const enr = r.enregistrement_id ? enregistrements.get(r.enregistrement_id) : null;
    return {
      id: r.id,
      team: { id: r.team_id, nom: team?.nom ?? null },
      titre: r.titre,
      lien: r.lien,
      type: type ? typePublic(type) : null,
      dateReunion: r.date_reunion,
      note: r.note,
      statut: r.statut,
      deposePar: { compte: r.depose_par, pseudo: pseudos[r.depose_par] ?? null },
      creeLe: r.cree_le,
      majLe: r.maj_le,
      resume: r.fichier_id ? { fichierId: r.fichier_id, le: r.resume_le, par: r.resume_par ? { compte: r.resume_par, pseudo: pseudos[r.resume_par] ?? null } : null } : null,
      nouveau: !r.vu_le,
      vu: r.vu_le ? { le: r.vu_le, par: r.vu_par } : null,
      moi: { deposant: r.depose_par === ctx.acteur.compte, redacteur: redacteur(ctx) },
      // Enregistrement déposé (vidéo ou audio) et transcription automatique.
      enregistrement: enr ? fichierPublic(enr) : null,
      transcription: {
        statut: r.transcription_statut ?? 'aucune',
        pdf: Boolean(r.transcription_pdf_id),
        peutTranscrire: Boolean(enr && !enr.supprime_le) && (r.depose_par === ctx.acteur.compte || redacteur(ctx)),
        // Point d'extension : transcription par une API externe, si le serveur l'a activée.
        externe: Boolean(transcriptionExterne?.actif),
      },
    };
  }

  async function publier(lignes, ctxParTeam) {
    const pseudos = await noms(lignes.flatMap(l => [l.depose_par, l.resume_par]));
    const types = new Map((await lignesParIds(base, 'SELECT * FROM types_reunion WHERE id', lignes.map(l => l.type_id))).map(y => [y.id, y]));
    const enregistrements = new Map((await lignesParIds(base, 'SELECT * FROM fichiers WHERE id', lignes.map(l => l.enregistrement_id))).map(f => [f.id, f]));
    const sortie = [];
    for (const l of lignes) {
      const ctx = ctxParTeam.get(l.team_id);
      sortie.push(reunionPublique(l, types.get(l.type_id), pseudos, ctx, ctx.team, enregistrements));
    }
    return sortie;
  }

  async function reunionDeTeam(ctx, reunionId) {
    exigerUuid(reunionId, 'reunion');
    const r = await base.premier('SELECT * FROM reunions WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [reunionId, ctx.team.id]);
    if (!r) throw echec(404, 'reunion-introuvable', 'Dépôt introuvable.');
    const type = await base.premier('SELECT * FROM types_reunion WHERE id = ?', [r.type_id]);
    if (!visible(ctx, r, type)) throw echec(404, 'reunion-introuvable', 'Dépôt introuvable.');
    return { r, type };
  }

  // -------------------------------------------------------------- Types de réunion

  async function typesReunion(acteur, teamId) {
    const ctx = await contexteTeam(acteur, teamId);
    exigerModule(ctx);
    return (await typesDeTeam(teamId)).map(typePublic);
  }

  function lireType(corps, partiel) {
    const sortie = {};
    if (!partiel || corps?.nom !== undefined) {
      const nom = texteNettoye(corps?.nom, 40);
      if (nom.length < 2) throw echec(400, 'nom', 'Nom du type : 2 caractères au moins.');
      sortie.nom = nom;
    }
    if (!partiel || corps?.couleur !== undefined) {
      const couleur = corps?.couleur ?? '#64748b';
      if (!MOTIF_COULEUR.test(couleur)) throw echec(400, 'couleur', 'Couleur : #RRGGBB.');
      sortie.couleur = couleur.toLowerCase();
    }
    if (!partiel || corps?.visibilite !== undefined) {
      const v = corps?.visibilite ?? 'team';
      if (!VISIBILITES.includes(v)) throw echec(400, 'visibilite', 'Visibilité : « team » ou « staff ».');
      sortie.visibilite = v;
    }
    return sortie;
  }

  async function creerTypeReunion(acteur, teamId, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exigerUne(ctx, P.rediger);
    const global = Boolean(corps?.global);
    if (global && !acteur.superAdmin) throw echec(403, 'super-admin', 'Seul le Fondateur crée des types globaux.');
    const saisi = lireType(corps, false);
    const existants = await typesDeTeam(teamId);
    if (existants.some(t => t.nom.toLocaleLowerCase('fr') === saisi.nom.toLocaleLowerCase('fr'))) throw echec(409, 'nom-pris', 'Ce type existe déjà.');
    const t = maintenant();
    const id = nouvelId();
    const position = existants.reduce((m, x) => Math.max(m, Number(x.position)), 0) + 1;
    await base.lot([
      {
        sql: 'INSERT INTO types_reunion (id, team_id, nom, couleur, visibilite, position, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        params: [id, global ? null : teamId, saisi.nom, saisi.couleur, saisi.visibilite, position, iso(t), iso(t)],
      },
      evenement('meeting_type.created', { teamId, acteur: acteur.compte, entiteType: 'type_reunion', entiteId: id, charge: { nom: saisi.nom, visibilite: saisi.visibilite, global }, maintenant: t }),
    ]);
    return typePublic(await base.premier('SELECT * FROM types_reunion WHERE id = ?', [id]));
  }

  async function typeModifiable(ctx, typeId) {
    exigerUuid(typeId, 'type');
    const type = await base.premier('SELECT * FROM types_reunion WHERE id = ? AND (team_id IS NULL OR team_id = ?) AND supprime_le IS NULL', [typeId, ctx.team.id]);
    if (!type) throw echec(404, 'type-introuvable', 'Type de réunion introuvable.');
    if (type.team_id == null && !ctx.acteur.superAdmin) throw echec(403, 'type-global', 'Ce type est commun à toutes les teams : seul le Fondateur le modifie.');
    return type;
  }

  async function modifierTypeReunion(acteur, teamId, typeId, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exigerUne(ctx, P.rediger);
    const type = await typeModifiable(ctx, typeId);
    const saisi = lireType(corps, true);
    const t = maintenant();
    await base.lot([
      {
        sql: 'UPDATE types_reunion SET nom = ?, couleur = ?, visibilite = ?, maj_le = ? WHERE id = ?',
        params: [saisi.nom ?? type.nom, saisi.couleur ?? type.couleur, saisi.visibilite ?? type.visibilite, iso(t), typeId],
      },
      evenement('meeting_type.updated', { teamId, acteur: acteur.compte, entiteType: 'type_reunion', entiteId: typeId, charge: { nom: saisi.nom ?? type.nom, visibilite: saisi.visibilite ?? type.visibilite }, maintenant: t }),
    ]);
    return typePublic(await base.premier('SELECT * FROM types_reunion WHERE id = ?', [typeId]));
  }

  async function supprimerTypeReunion(acteur, teamId, typeId) {
    const ctx = await contexteTeam(acteur, teamId);
    exigerUne(ctx, P.rediger);
    const type = await typeModifiable(ctx, typeId);
    const t = maintenant();
    // Suppression logique : les dépôts existants gardent leur type (et sa visibilité).
    await base.lot([
      { sql: 'UPDATE types_reunion SET supprime_le = ?, maj_le = ? WHERE id = ?', params: [iso(t), iso(t), typeId] },
      evenement('meeting_type.deleted', { teamId, acteur: acteur.compte, entiteType: 'type_reunion', entiteId: typeId, charge: { nom: type.nom }, maintenant: t }),
    ]);
    return { ok: true };
  }

  // -------------------------------------------------------------- Dépôts (membre)

  async function deposer(acteur, teamId, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exigerUne(ctx, P.deposer);
    const lien = String(corps?.lien ?? '').trim();
    // L'enregistrement est soit DÉPOSÉ (envoi par morceaux déjà terminé), soit un lien externe ; les deux sont possibles.
    const envoiId = corps?.envoi ?? null;
    if (!envoiId && !lienValide(lien)) throw echec(400, 'lien', 'Lien de l’enregistrement : une adresse http(s) valide.');
    if (lien && !lienValide(lien)) throw echec(400, 'lien', 'Lien de l’enregistrement : une adresse http(s) valide.');
    const titre = texteNettoye(corps?.titre, 120);
    if (titre.length < 2) throw echec(400, 'titre', 'Titre : 2 caractères au moins.');
    const date = String(corps?.dateReunion ?? '');
    if (!dateValide(date)) throw echec(400, 'date', 'Date de la réunion : AAAA-MM-JJ.');
    exigerUuid(corps?.typeId, 'type');
    const type = await base.premier('SELECT * FROM types_reunion WHERE id = ? AND (team_id IS NULL OR team_id = ?) AND supprime_le IS NULL', [corps.typeId, teamId]);
    if (!type) throw echec(400, 'type', 'Type de réunion inconnu.');
    const note = texteLong(corps?.note, 2000);
    const t = maintenant();
    const id = nouvelId();
    let rattachement = null;
    if (envoiId) {
      if (!medias) throw echec(503, 'stockage-absent', 'Le stockage des fichiers n’est pas branché sur le serveur Esport.');
      rattachement = await medias.preparerRattachement(ctx, envoiId, 'reunion', { entiteType: 'reunion_enregistrement', entiteId: id });
    }
    await base.lot([
      ...(rattachement?.instructions ?? []),
      {
        sql: `INSERT INTO reunions (id, team_id, depose_par, lien, type_id, date_reunion, titre, note, statut, enregistrement_id, transcription_statut, cree_le, maj_le)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'a_resumer', ?, ?, ?, ?)`,
        params: [id, teamId, acteur.compte, lien, type.id, date, titre, note, rattachement?.fichierId ?? null, rattachement ? 'a_faire' : 'aucune', iso(t), iso(t)],
      },
      evenement('meeting.submitted', { teamId, acteur: acteur.compte, entiteType: 'reunion', entiteId: id, charge: { titre, type: type.nom, dateReunion: date, ...(rattachement ? { enregistrement: true } : {}) }, maintenant: t }),
    ]);
    return (await publier([await base.premier('SELECT * FROM reunions WHERE id = ?', [id])], new Map([[teamId, ctx]])))[0];
  }

  async function mesDepots(acteur, teamId) {
    const ctx = await contexteTeam(acteur, teamId);
    exigerUne(ctx, P.deposer, P.lire, P.rediger, P.tout);
    const lignes = await base.tous('SELECT * FROM reunions WHERE team_id = ? AND depose_par = ? AND supprime_le IS NULL ORDER BY cree_le DESC LIMIT 200', [teamId, acteur.compte]);
    return publier(lignes, new Map([[teamId, ctx]]));
  }

  /** Résumés terminés que l'acteur peut lire (accueil de la team, bibliothèque). */
  async function resumesTeam(acteur, teamId, { limite } = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exigerUne(ctx, P.lire, P.rediger, P.tout, P.deposer);
    const n = Math.min(100, Math.max(1, Number(limite) || 20));
    const lignes = await base.tous("SELECT * FROM reunions WHERE team_id = ? AND statut = 'termine' AND supprime_le IS NULL ORDER BY resume_le DESC, id DESC LIMIT 300", [teamId]);
    const types = new Map((await typesDeTeam(teamId, true)).map(t => [t.id, t]));
    return publier(lignes.filter(r => visible(ctx, r, types.get(r.type_id))).slice(0, n), new Map([[teamId, ctx]]));
  }

  async function detail(acteur, teamId, reunionId) {
    const ctx = await contexteTeam(acteur, teamId);
    exigerModule(ctx);
    const { r } = await reunionDeTeam(ctx, reunionId);
    const [publie] = await publier([r], new Map([[teamId, ctx]]));
    const historique = lecteurDeTout(ctx)
      ? await base.tous("SELECT * FROM fichiers WHERE entite_type = 'reunion' AND entite_id = ? ORDER BY CASE WHEN remplace_le IS NULL THEN 0 ELSE 1 END, remplace_le DESC, cree_le DESC, id DESC", [r.id])
      : r.fichier_id
        ? await base.tous('SELECT * FROM fichiers WHERE id = ?', [r.fichier_id])
        : [];
    const pseudos = await noms(historique.map(f => f.depose_par));
    return {
      ...publie,
      fichiers: historique.map(f => ({
        id: f.id,
        nom: f.nom_original,
        taille: Number(f.taille),
        type: f.type_mime,
        deposePar: { compte: f.depose_par, pseudo: pseudos[f.depose_par] ?? null },
        le: f.cree_le,
        actuel: f.id === r.fichier_id,
        remplaceLe: f.remplace_le ?? null,
      })),
    };
  }

  async function supprimerDepot(acteur, teamId, reunionId) {
    const ctx = await contexteTeam(acteur, teamId);
    exigerModule(ctx);
    const { r } = await reunionDeTeam(ctx, reunionId);
    const proprePasCommence = r.depose_par === acteur.compte && r.statut === 'a_resumer';
    if (!proprePasCommence && !redacteur(ctx)) throw echec(403, 'permission', 'Seul un rédacteur supprime un dépôt déjà pris en charge.');
    const t = maintenant();
    await base.lot([
      { sql: 'UPDATE reunions SET supprime_le = ?, maj_le = ? WHERE id = ?', params: [iso(t), iso(t), r.id] },
      evenement('meeting.deleted', { teamId, acteur: acteur.compte, entiteType: 'reunion', entiteId: r.id, charge: { titre: r.titre }, maintenant: t }),
    ]);
    // L'enregistrement (gros fichier) n'est plus lisible : ses octets sont effacés.
    if (r.enregistrement_id) await medias?.effacerOctets(r.enregistrement_id);
    return { ok: true };
  }

  // -------------------------------------------------------------- Rédacteur

  /** Teams où l'acteur voit la boîte de réception (module activé ; rédacteur ou view_all). */
  async function contextesBoite(acteur) {
    const ids = acteur.superAdmin
      ? await base.tous("SELECT t.id FROM teams t JOIN team_modules tm ON tm.team_id = t.id AND tm.module = ? AND tm.active = 1 WHERE t.supprimee_le IS NULL ORDER BY t.nom", [MODULE_RESUMES])
      : await base.tous(
          "SELECT t.id FROM membres m JOIN teams t ON t.id = m.team_id WHERE m.compte_id = ? AND m.statut = 'actif' AND t.supprimee_le IS NULL ORDER BY t.nom",
          [acteur.compte],
        );
    const sortie = new Map();
    for (const { id } of ids) {
      const ctx = await contexteTeam(acteur, id).catch(() => null);
      if (ctx && ctx.modules.has(MODULE_RESUMES) && lecteurDeTout(ctx)) sortie.set(id, ctx);
    }
    return sortie;
  }

  async function boite(acteur, filtres = {}) {
    const contextes = await contextesBoite(acteur);
    const teams = [...contextes.values()].map(c => ({ id: c.team.id, nom: c.team.nom, redacteur: redacteur(c) }));
    if (contextes.size === 0) return { depots: [], teams: [], types: [], attente: 0, nouveaux: 0, total: 0 };
    let ids = [...contextes.keys()];
    if (filtres.team) {
      if (!contextes.has(filtres.team)) throw echec(404, 'team-introuvable', 'Team introuvable.');
      ids = [filtres.team];
    }
    const conditions = [`team_id IN (${ids.map(() => '?').join(', ')})`, 'supprime_le IS NULL'];
    const params = [...ids];
    // Compteurs (sur toutes les teams accessibles, sans les autres filtres).
    const toutes = [...contextes.keys()];
    const compte = async extra =>
      Number((await base.premier(`SELECT COUNT(*) AS n FROM reunions WHERE team_id IN (${toutes.map(() => '?').join(', ')}) AND supprime_le IS NULL AND ${extra}`, toutes))?.n ?? 0);
    const attente = await compte("statut <> 'termine'");
    const nouveaux = await compte('vu_le IS NULL');
    if (filtres.statut) {
      if (!STATUTS_REUNION.includes(filtres.statut)) throw echec(400, 'statut', 'Statut inconnu.');
      conditions.push('statut = ?');
      params.push(filtres.statut);
    }
    if (filtres.type) {
      exigerUuid(filtres.type, 'type');
      conditions.push('type_id = ?');
      params.push(filtres.type);
    }
    if (filtres.du) {
      if (!dateValide(filtres.du)) throw echec(400, 'date', 'Date de début : AAAA-MM-JJ.');
      conditions.push('date_reunion >= ?');
      params.push(filtres.du);
    }
    if (filtres.au) {
      if (!dateValide(filtres.au)) throw echec(400, 'date', 'Date de fin : AAAA-MM-JJ.');
      conditions.push('date_reunion <= ?');
      params.push(filtres.au);
    }
    if (filtres.deposePar) {
      if (!MOTIF_COMPTE.test(filtres.deposePar)) throw echec(400, 'deposant', 'Déposant inconnu.');
      conditions.push('depose_par = ?');
      params.push(filtres.deposePar);
    }
    if (filtres.nouveaux) conditions.push('vu_le IS NULL');
    const tri = TRIS.includes(filtres.tri) ? filtres.tri : 'recent';
    const ordre = {
      recent: 'cree_le DESC, id DESC',
      ancien: 'cree_le ASC, id ASC',
      date: 'date_reunion DESC, cree_le DESC',
      // À résumer d'abord, puis En cours, puis Terminé ; les plus anciens d'abord dans chaque statut.
      statut: "CASE statut WHEN 'a_resumer' THEN 0 WHEN 'en_cours' THEN 1 ELSE 2 END, cree_le ASC",
    }[tri];
    const limite = Math.min(500, Math.max(1, Number(filtres.limite) || 200));
    const lignes = await base.tous(`SELECT * FROM reunions WHERE ${conditions.join(' AND ')} ORDER BY ${ordre} LIMIT ?`, [...params, limite]);
    const depots = await publier(lignes, contextes);
    // Déposants et types proposés dans les filtres.
    const deposants = await base.tous(`SELECT DISTINCT depose_par FROM reunions WHERE team_id IN (${toutes.map(() => '?').join(', ')}) AND supprime_le IS NULL`, toutes);
    const pseudos = await noms(deposants.map(d => d.depose_par));
    const types = await base.tous(
      `SELECT * FROM types_reunion WHERE (team_id IS NULL OR team_id IN (${toutes.map(() => '?').join(', ')})) AND supprime_le IS NULL ORDER BY position, nom`,
      toutes,
    );
    return {
      depots,
      teams,
      types: types.map(typePublic),
      deposants: deposants.map(d => ({ compte: d.depose_par, pseudo: pseudos[d.depose_par] ?? null })),
      attente,
      nouveaux,
      total: depots.length,
    };
  }

  async function marquerVu(acteur, teamId, reunionId) {
    const ctx = await contexteTeam(acteur, teamId);
    exigerUne(ctx, P.rediger);
    const { r } = await reunionDeTeam(ctx, reunionId);
    if (!r.vu_le) await base.executer('UPDATE reunions SET vu_le = ?, vu_par = ? WHERE id = ? AND vu_le IS NULL', [iso(maintenant()), acteur.compte, r.id]);
    return detail(acteur, teamId, reunionId);
  }

  async function changerStatut(acteur, teamId, reunionId, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exigerUne(ctx, P.rediger);
    const { r } = await reunionDeTeam(ctx, reunionId);
    const vers = corps?.statut;
    if (!STATUTS_REUNION.includes(vers)) throw echec(400, 'statut', 'Statut inconnu (a_resumer, en_cours, termine).');
    if (vers === r.statut) return detail(acteur, teamId, reunionId);
    if (vers === 'termine' && !r.fichier_id) throw echec(409, 'pdf-requis', 'Déposez d’abord le PDF du résumé : il passe alors en Terminé tout seul.');
    const t = maintenant();
    const lot = [
      { sql: 'UPDATE reunions SET statut = ?, vu_le = COALESCE(vu_le, ?), vu_par = COALESCE(vu_par, ?), maj_le = ? WHERE id = ?', params: [vers, iso(t), acteur.compte, iso(t), r.id] },
      evenement('meeting.status_changed', { teamId, acteur: acteur.compte, entiteType: 'reunion', entiteId: r.id, charge: { titre: r.titre, de: r.statut, vers }, maintenant: t }),
    ];
    if (vers === 'termine') {
      lot.push(evenement('meeting.summary_published', { teamId, acteur: acteur.compte, entiteType: 'reunion', entiteId: r.id, charge: { titre: r.titre, deposePar: r.depose_par, remplacement: false }, maintenant: t }));
    }
    await base.lot(lot);
    return detail(acteur, teamId, reunionId);
  }

  /**
   * Dépôt (ou remplacement) du PDF du résumé : contrôles de droits AVANT de
   * lire le corps, puis type annoncé, taille et octets magiques. Le fichier
   * part dans le stockage sous un nom aléatoire ; l'ancien reste (historique).
   */
  async function deposerPdf(acteur, teamId, reunionId, requete) {
    const ctx = await contexteTeam(acteur, teamId);
    exigerUne(ctx, P.rediger);
    const { r } = await reunionDeTeam(ctx, reunionId);
    if (!stockage) throw echec(503, 'stockage-absent', 'Le stockage des fichiers (R2) n’est pas branché sur le serveur Esport : voir docs/esport/deploiement.md.');
    const contentType = requete.headers.get('Content-Type');
    verifierEntetesPdf({ contentType, tailleAnnoncee: requete.headers.get('Content-Length') ?? 0 });
    const octets = await lireOctets(requete);
    validerPdf({ contentType, octets });
    const t = maintenant();
    const fichierId = nouvelId();
    const cle = cleStockageResume(teamId);
    const nom = nomOriginal(requete.headers.get('X-Nom-Fichier'));
    await stockage.deposer(cle, octets, { type: 'application/pdf' });
    const remplacement = Boolean(r.fichier_id);
    try {
      await base.lot([
        { sql: 'UPDATE fichiers SET remplace_le = ? WHERE entite_type = ? AND entite_id = ? AND remplace_le IS NULL', params: [iso(t), 'reunion', r.id] },
        {
          sql: `INSERT INTO fichiers (id, team_id, entite_type, entite_id, cle_stockage, type_mime, taille, nom_original, empreinte, depose_par, cree_le)
                VALUES (?, ?, 'reunion', ?, ?, 'application/pdf', ?, ?, ?, ?, ?)`,
          params: [fichierId, teamId, r.id, cle, octets.length, nom, await empreinteSha256(octets), acteur.compte, iso(t)],
        },
        {
          sql: `UPDATE reunions SET fichier_id = ?, statut = 'termine', resume_par = ?, resume_le = ?, vu_le = COALESCE(vu_le, ?), vu_par = COALESCE(vu_par, ?), maj_le = ? WHERE id = ?`,
          params: [fichierId, acteur.compte, iso(t), iso(t), acteur.compte, iso(t), r.id],
        },
        ...(r.statut !== 'termine'
          ? [evenement('meeting.status_changed', { teamId, acteur: acteur.compte, entiteType: 'reunion', entiteId: r.id, charge: { titre: r.titre, de: r.statut, vers: 'termine', automatique: true }, maintenant: t })]
          : []),
        evenement('meeting.summary_published', {
          teamId,
          acteur: acteur.compte,
          entiteType: 'reunion',
          entiteId: r.id,
          charge: { titre: r.titre, deposePar: r.depose_par, remplacement, fichier: fichierId, taille: octets.length },
          maintenant: t,
        }),
      ]);
    } catch (e) {
      // La base a refusé : on ne laisse pas d'objet orphelin dans le stockage.
      await stockage.supprimer(cle).catch(() => undefined);
      throw e;
    }
    return detail(acteur, teamId, reunionId);
  }

  /** Lien signé (quelques minutes) vers le PDF actuel, ou une ancienne version (rédacteurs, view_all). */
  async function lienFichier(acteur, teamId, reunionId, corps = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exigerModule(ctx);
    const { r } = await reunionDeTeam(ctx, reunionId);
    const fichierId = corps?.fichierId ?? r.fichier_id;
    if (!fichierId) throw echec(404, 'pas-de-pdf', 'Le résumé n’est pas encore prêt.');
    exigerUuid(fichierId, 'fichier');
    if (fichierId !== r.fichier_id && !lecteurDeTout(ctx)) throw echec(404, 'fichier-introuvable', 'Fichier introuvable.');
    const f = await base.premier("SELECT id FROM fichiers WHERE id = ? AND entite_type = 'reunion' AND entite_id = ? AND team_id = ?", [fichierId, r.id, teamId]);
    if (!f) throw echec(404, 'fichier-introuvable', 'Fichier introuvable.');
    return cheminSigne(cleSession, { fichierId, compte: acteur.compte, maintenant: maintenant(), telecharger: Boolean(corps?.telecharger) });
  }

  /** Lecture par lien signé (sans session : le lien a été délivré après vérification des droits). */
  async function lireFichierSigne(fichierId, params) {
    exigerUuid(fichierId, 'fichier');
    const { compte, telecharger } = await verifierLien(cleSession, fichierId, params, maintenant());
    const f = await base.premier('SELECT f.* FROM fichiers f JOIN teams t ON t.id = f.team_id WHERE f.id = ? AND t.supprimee_le IS NULL', [fichierId]);
    if (!f) throw echec(404, 'fichier-introuvable', 'Fichier introuvable.');
    // Le lien vaut quelques minutes, mais un membre retiré ou suspendu entre-temps ne lit plus rien.
    if (compte !== 'principal' && !(await base.premier("SELECT id FROM membres WHERE team_id = ? AND compte_id = ? AND statut = 'actif'", [f.team_id, compte]))) {
      throw echec(403, 'lien-invalide', 'Lien de fichier invalide.');
    }
    if (!stockage) throw echec(503, 'stockage-absent', 'Le stockage des fichiers n’est pas branché.');
    const objet = await stockage.lire(f.cle_stockage);
    if (!objet) throw echec(404, 'fichier-introuvable', 'Fichier introuvable.');
    return { octets: objet.octets, type: f.type_mime, nom: f.nom_original, telecharger };
  }

  // -------------------------------------------------------------- Enregistrement et transcription

  /** Le déposant et les rédacteurs transcrivent et corrigent ; les autres lecteurs du dépôt lisent seulement. */
  const peutEcrireTranscription = (ctx, r) => r.depose_par === ctx.acteur.compte || redacteur(ctx);

  /** Lien signé (2 h) vers l'enregistrement déposé : mêmes règles de visibilité que le dépôt. */
  async function lienEnregistrement(acteur, teamId, reunionId, corps = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exigerModule(ctx);
    const { r } = await reunionDeTeam(ctx, reunionId);
    if (!r.enregistrement_id || !medias) throw echec(404, 'pas-d-enregistrement', 'Aucun enregistrement déposé pour cette réunion.');
    return medias.lienMedia(acteur, await medias.fichier(r.enregistrement_id), { telecharger: Boolean(corps?.telecharger) });
  }

  async function transcriptionPublique(ctx, r) {
    const x = await base.premier('SELECT * FROM transcriptions WHERE reunion_id = ? AND team_id = ?', [r.id, r.team_id]);
    const pdf = r.transcription_pdf_id ? await base.premier('SELECT * FROM fichiers WHERE id = ?', [r.transcription_pdf_id]) : null;
    const noms = await noms_([x?.auteur_id, x?.modifie_par]);
    return {
      statut: r.transcription_statut ?? 'aucune',
      langue: x?.langue ?? 'fr',
      moteur: x?.moteur ?? '',
      segments: jsonOu(x?.segments, []).map(([debut, fin, texte]) => ({ debut, fin, texte })),
      duree: x?.duree_s ?? null,
      progression: Number(x?.progression_s ?? 0),
      partielle: x ? Number(x.partielle) === 1 : true,
      preResume: jsonOu(x?.pre_resume, []),
      erreur: x?.erreur || null,
      pdf: pdf && !pdf.supprime_le ? fichierPublic(pdf) : null,
      auteur: x?.auteur_id ? { compte: x.auteur_id, pseudo: noms[x.auteur_id] ?? null } : null,
      modifiePar: x?.modifie_par ? { compte: x.modifie_par, pseudo: noms[x.modifie_par] ?? null } : null,
      majLe: x?.maj_le ?? null,
      enregistrement: r.enregistrement_id ? fichierPublic(await base.premier('SELECT * FROM fichiers WHERE id = ?', [r.enregistrement_id])) : null,
      peutModifier: peutEcrireTranscription(ctx, r),
      externe: Boolean(transcriptionExterne?.actif),
    };
  }
  const noms_ = ids => noms(ids.filter(Boolean));

  async function transcription(acteur, teamId, reunionId) {
    const ctx = await contexteTeam(acteur, teamId);
    exigerModule(ctx);
    const { r } = await reunionDeTeam(ctx, reunionId);
    return transcriptionPublique(ctx, r);
  }

  /**
   * Enregistre une transcription (partielle pendant le travail, pour reprendre après une coupure ;
   * complète à la fin). Complète : pré-résumé, PDF généré et attaché (« reunion_transcription »),
   * statut « prete », notification au déposant et aux rédacteurs la première fois.
   */
  async function sauverTranscription(ctx, r, type, s) {
    const t = maintenant();
    const existante = await base.premier('SELECT * FROM transcriptions WHERE reunion_id = ?', [r.id]);
    const resume = s.partielle ? [] : preResume(s.segments);
    const duree = s.duree ?? (s.segments.length ? s.segments[s.segments.length - 1][1] : null);
    const lot = [];
    if (existante) {
      lot.push({
        sql: 'UPDATE transcriptions SET langue = ?, moteur = ?, segments = ?, duree_s = ?, progression_s = ?, partielle = ?, pre_resume = ?, erreur = ?, modifie_par = ?, maj_le = ? WHERE id = ?',
        params: [s.langue, s.moteur, JSON.stringify(s.segments), duree, s.progression, s.partielle ? 1 : 0, JSON.stringify(resume), '', s.compte, iso(t), existante.id],
      });
    } else {
      lot.push({
        sql: `INSERT INTO transcriptions (id, team_id, reunion_id, langue, moteur, segments, duree_s, progression_s, partielle, pre_resume, erreur, auteur_id, modifie_par, cree_le, maj_le)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?)`,
        params: [nouvelId(), r.team_id, r.id, s.langue, s.moteur, JSON.stringify(s.segments), duree, s.progression, s.partielle ? 1 : 0, JSON.stringify(resume), s.compte, s.compte, iso(t), iso(t)],
      });
    }
    let pdfId = null;
    let cle = null;
    if (!s.partielle && stockage) {
      const octets = pdfTranscription(
        { titre: r.titre, team: ctx.team.nom, type: type?.nom ?? '', date: r.date_reunion, duree, langue: s.langue, moteur: s.moteur, genereLe: iso(t), langueDoc: s.langueDoc === 'en' ? 'en' : 'fr' },
        s.segments,
        resume,
      );
      pdfId = nouvelId();
      cle = cleStockageResume(r.team_id);
      await stockage.deposer(cle, octets, { type: 'application/pdf' });
      lot.push({
        sql: `INSERT INTO fichiers (id, team_id, entite_type, entite_id, cle_stockage, type_mime, taille, nom_original, empreinte, depose_par, cree_le)
              VALUES (?, ?, 'reunion_transcription', ?, ?, 'application/pdf', ?, ?, ?, ?, ?)`,
        params: [pdfId, r.team_id, r.id, cle, octets.length, nomOriginal(`Transcription - ${r.titre}.pdf`), await empreinteSha256(octets), s.compte ?? '', iso(t)],
      });
    }
    const statut = s.partielle ? 'en_cours' : 'prete';
    lot.push({
      sql: 'UPDATE reunions SET transcription_statut = ?, transcription_pdf_id = ?, maj_le = ? WHERE id = ?',
      params: [statut, pdfId ?? (s.partielle ? r.transcription_pdf_id : null), iso(t), r.id],
    });
    if (!s.partielle) {
      const premiere = r.transcription_statut !== 'prete';
      lot.push(
        evenement(premiere ? 'meeting.transcription_ready' : 'meeting.transcription_updated', {
          teamId: r.team_id,
          acteur: s.compte,
          entiteType: 'reunion',
          entiteId: r.id,
          charge: { titre: r.titre, deposePar: r.depose_par, segments: s.segments.length, moteur: s.moteur },
          maintenant: t,
        }),
      );
    }
    try {
      await base.lot(lot);
    } catch (e) {
      if (cle) await stockage.supprimer(cle).catch(() => undefined);
      throw e;
    }
    // L'ancien PDF de transcription est remplacé (le texte reste la référence) : ses octets sont effacés.
    if (pdfId && r.transcription_pdf_id && r.transcription_pdf_id !== pdfId) await medias?.effacerOctets(r.transcription_pdf_id);
  }

  async function enregistrerTranscription(acteur, teamId, reunionId, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exigerModule(ctx);
    const { r, type } = await reunionDeTeam(ctx, reunionId);
    if (!peutEcrireTranscription(ctx, r)) throw echec(403, 'permission', 'Seuls le déposant et les rédacteurs modifient la transcription.');
    const segments = validerSegments(corps?.segments);
    const langue = LANGUES_TRANSCRIPTION.includes(corps?.langue) ? corps.langue : 'fr';
    const moteur = texteNettoye(corps?.moteur, 60) || 'navigateur';
    const duree = Number.isFinite(Number(corps?.duree)) && Number(corps.duree) > 0 ? Math.min(86400, Math.round(Number(corps.duree) * 10) / 10) : null;
    const partielle = corps?.partielle === true;
    const progression = Number.isFinite(Number(corps?.progression)) ? Math.max(0, Math.min(86400, Number(corps.progression))) : (duree ?? 0);
    await sauverTranscription(ctx, r, type, { segments, langue, moteur, duree, partielle, progression, compte: acteur.compte, langueDoc: acteur.langue });
    return transcriptionPublique(ctx, await base.premier('SELECT * FROM reunions WHERE id = ?', [r.id]));
  }

  /** Lien signé (5 min) vers le PDF de transcription : mêmes règles de visibilité que le dépôt. */
  async function lienTranscription(acteur, teamId, reunionId, corps = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exigerModule(ctx);
    const { r } = await reunionDeTeam(ctx, reunionId);
    if (!r.transcription_pdf_id) throw echec(404, 'pas-de-transcription', 'La transcription n’est pas encore prête.');
    const f = await base.premier("SELECT id, supprime_le FROM fichiers WHERE id = ? AND entite_type = 'reunion_transcription' AND team_id = ?", [r.transcription_pdf_id, teamId]);
    if (!f || f.supprime_le) throw echec(404, 'pas-de-transcription', 'La transcription n’est pas encore prête.');
    return cheminSigne(cleSession, { fichierId: f.id, compte: acteur.compte, maintenant: maintenant(), telecharger: Boolean(corps?.telecharger) });
  }

  /** Point d'extension (désactivé par défaut) : demande la transcription par l'API externe ; le cron la fait. */
  async function demanderTranscriptionExterne(acteur, teamId, reunionId, corps = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exigerModule(ctx);
    const { r } = await reunionDeTeam(ctx, reunionId);
    if (!peutEcrireTranscription(ctx, r)) throw echec(403, 'permission', 'Seuls le déposant et les rédacteurs modifient la transcription.');
    if (!transcriptionExterne?.actif) throw echec(503, 'transcription-externe-desactivee', 'La transcription par le serveur n’est pas activée : transcrivez dans le navigateur.');
    if (!r.enregistrement_id) throw echec(404, 'pas-d-enregistrement', 'Aucun enregistrement déposé pour cette réunion.');
    const langue = LANGUES_TRANSCRIPTION.includes(corps?.langue) ? corps.langue : 'fr';
    const t = iso(maintenant());
    const existante = await base.premier('SELECT id FROM transcriptions WHERE reunion_id = ?', [r.id]);
    await base.lot([
      existante
        ? { sql: "UPDATE transcriptions SET langue = ?, erreur = '', modifie_par = ?, maj_le = ? WHERE id = ?", params: [langue, acteur.compte, t, existante.id] }
        : {
            sql: "INSERT INTO transcriptions (id, team_id, reunion_id, langue, moteur, segments, partielle, auteur_id, modifie_par, cree_le, maj_le) VALUES (?, ?, ?, ?, 'api', '[]', 1, ?, ?, ?, ?)",
            params: [nouvelId(), teamId, r.id, langue, acteur.compte, acteur.compte, t, t],
          },
      { sql: "UPDATE reunions SET transcription_statut = 'externe', maj_le = ? WHERE id = ?", params: [t, r.id] },
    ]);
    return transcriptionPublique(ctx, await base.premier('SELECT * FROM reunions WHERE id = ?', [r.id]));
  }

  /** Cron : transcriptions demandées à l'API externe (quelques-unes par passage). Rend le nombre traité. */
  async function traiterTranscriptionsExternes({ limite = 2 } = {}) {
    if (!transcriptionExterne?.actif || !stockage) return 0;
    const lignes = await base.tous("SELECT * FROM reunions WHERE transcription_statut = 'externe' AND supprime_le IS NULL ORDER BY maj_le LIMIT ?", [limite]);
    let n = 0;
    for (const r of lignes) {
      const x = await base.premier('SELECT * FROM transcriptions WHERE reunion_id = ?', [r.id]);
      const team = await base.premier('SELECT * FROM teams WHERE id = ?', [r.team_id]);
      const type = await base.premier('SELECT * FROM types_reunion WHERE id = ?', [r.type_id]);
      const f = r.enregistrement_id ? await base.premier('SELECT * FROM fichiers WHERE id = ?', [r.enregistrement_id]) : null;
      const compte = x?.modifie_par ?? x?.auteur_id ?? r.depose_par;
      try {
        if (!f || f.supprime_le) throw new Error('Enregistrement introuvable.');
        if (Number(f.taille) > transcriptionExterne.tailleMax) throw new Error('Enregistrement trop gros pour l’API de transcription.');
        const objet = await stockage.lire(f.cle_stockage);
        if (!objet) throw new Error('Enregistrement introuvable.');
        const { segments, duree } = await transcrireParApi({ octets: objet.octets, nom: f.nom_original, type: f.type_mime, langue: x?.langue ?? 'fr', config: transcriptionExterne, fetch: fetchTranscription });
        const profil = await base.premier('SELECT langue FROM comptes WHERE id = ?', [compte]);
        await sauverTranscription({ team, acteur: { compte } }, r, type, { segments, langue: x?.langue ?? 'fr', moteur: `API (${transcriptionExterne.modele})`, duree, partielle: false, progression: duree ?? 0, compte, langueDoc: profil?.langue });
      } catch (e) {
        const t = iso(maintenant());
        await base.lot([
          { sql: "UPDATE reunions SET transcription_statut = 'echec', maj_le = ? WHERE id = ?", params: [t, r.id] },
          { sql: 'UPDATE transcriptions SET erreur = ?, maj_le = ? WHERE reunion_id = ?', params: [String(e?.message ?? e).slice(0, 200), t, r.id] },
        ]);
      }
      n++;
    }
    return n;
  }

  return {
    typesReunion,
    creerTypeReunion,
    modifierTypeReunion,
    supprimerTypeReunion,
    deposer,
    mesDepots,
    resumesTeam,
    detail,
    supprimerDepot,
    boite,
    marquerVu,
    changerStatut,
    deposerPdf,
    lienFichier,
    lireFichierSigne,
    lienEnregistrement,
    transcription,
    enregistrerTranscription,
    lienTranscription,
    demanderTranscriptionExterne,
    traiterTranscriptionsExternes,
  };
}
