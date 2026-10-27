/**
 * Visuels de la section CM (migration 0025, docs/esport/visuels.md) : charte graphique du club, modèles
 * personnalisés (et leurs versions), images importées, visuels générés (rendu PNG / JPEG fait par l'app,
 * vérifié et rangé ici, joint à une carte post).
 *
 * Droits (mêmes portées que la section CM, commun.mjs) :
 *  - charte : lecture pour qui voit la section (cm.voir quelque part), modification `cm.gerer` du club ;
 *  - modèles et visuels : lecture `cm.voir` de leur portée (un modèle du club est lisible par toutes les
 *    portées), création / modification `cm.editer` de la portée ;
 *  - données d'une source (résultat, match, tournoi, membres…) : `cm.editer` sur la team, contenu PUBLIABLE
 *    seulement (jamais un résultat staff ni un scrim non publiable : 409 `non-publiable`).
 *
 * Sécurité : documents validés (document.mjs : aucune adresse d'image, textes nettoyés, tailles bornées),
 * images importées vérifiées (format PNG / JPEG / GIF / WebP, 15 Mo, 8192 px), rendu vérifié (PNG ou JPEG,
 * taille EXACTE du format, 25 Mo). Les fichiers sont des fichiers CM privés lus par lien signé.
 */

import { evenement } from '../../evenements.mjs';
import { echec, iso, jsonOu, nouvelId, texteNettoye } from '../../outils.mjs';
import { pseudosDe } from '../../requetes.mjs';
import { cheminSigne } from '../../fichiers.mjs';
import { PORTEE_CLUB, contexteCm, exiger, exigerUuid, lirePortee, peut, porteesDe, teamDePortee, MOTIF_UUID } from '../commun.mjs';
import { DUREE_LIEN_CM_MS } from '../tableaux.mjs';
import { CHARTE_DEFAUT, CLES_FORMATS, FORMATS, LANGUES_VISUEL, TYPES_VISUEL, DocumentInvalide, erreurDocument, fichiersDuDocument, lireCharte, lireDocument, lireDocuments } from './document.mjs';
import { GENRES_SOURCE, donneesVisuel } from './champs.mjs';
import { OCTETS_ENTETE, TAILLE_MAX_IMAGE, TAILLE_MAX_RENDU, dimensionsAcceptables, dimensionsImage } from './images.mjs';

const MAX_MODELES = 300;
const MAX_VERSIONS = 30;
const MAX_VISUELS_CARTE = 12;
const FORMATS_IMAGE = ['png', 'jpeg', 'gif', 'webp'];
const FORMATS_RENDU = ['png', 'jpeg'];
const MOTIF_MODELE_DEFAUT = /^defaut:([a-z_]+)$/;

/** Lit un document (ou des documents) saisi : 400 `document-invalide` avec le chemin fautif. */
function valider(fn, v) {
  try {
    return fn(v);
  } catch (e) {
    throw erreurDocument(e);
  }
}

/** Octets d'une tranche du stockage (mémoire : `octets` ; disque : `flux`). */
async function lireDebut(stockage, cle, n) {
  const r = await stockage?.lireTranche?.(cle, 0, n - 1);
  if (!r) return new Uint8Array();
  if (r.octets) return new Uint8Array(r.octets);
  const morceaux = [];
  let total = 0;
  const lecteur = r.flux.getReader();
  try {
    while (total < n) {
      const { value, done } = await lecteur.read();
      if (done) break;
      morceaux.push(value);
      total += value.length;
    }
  } finally {
    await lecteur.cancel().catch(() => undefined);
  }
  const sortie = new Uint8Array(Math.min(total, n));
  let i = 0;
  for (const m of morceaux) {
    const part = m.subarray(0, Math.min(m.length, sortie.length - i));
    sortie.set(part, i);
    i += part.length;
    if (i >= sortie.length) break;
  }
  return sortie;
}

export function servicesVisuelsCm({ base, maintenant = () => Date.now(), medias, cleSession, stockage, tableaux }) {
  // ---------------------------------------------------------------- Contextes

  /** Contexte d'une portée avec une des permissions (404 si la portée n'est pas visible, 403 sans la permission). */
  async function ctxPortee(acteur, portee, ...permissions) {
    const ctx = await contexteCm(base, acteur, lirePortee(portee));
    exiger(ctx, ...permissions);
    return ctx;
  }

  /** L'acteur voit-il la section CM quelque part ? (lecture de la charte, des modèles du club). */
  async function voitSection(acteur) {
    const p = await porteesDe(base, acteur);
    if (!(p.club.has('cm.voir') || [...p.teams.values()].some(s => s.has('cm.voir')))) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    return p;
  }

  // ---------------------------------------------------------------- Charte

  async function charteLigne() {
    const l = await base.premier("SELECT * FROM cm_charte WHERE id = 'club'", []);
    const valeur = l ? lireCharte(jsonOu(l.valeur, {}), CHARTE_DEFAUT) : lireCharte({}, CHARTE_DEFAUT);
    return { valeur, version: l ? Number(l.version) : 0, majLe: l?.maj_le ?? null, majPar: l?.maj_par ?? null };
  }

  /** `GET /cm/charte` : charte (valeurs par défaut complétées), version, droits, teams (logos par team). */
  async function charte(acteur) {
    const p = await voitSection(acteur);
    const c = await charteLigne();
    const teams = [...p.noms.values()].map(t => ({ id: t.id, nom: t.nom }));
    return { charte: c.valeur, version: c.version, majLe: c.majLe, defaut: CHARTE_DEFAUT, gerer: p.club.has('cm.gerer'), teams };
  }

  /** `PUT /cm/charte` (cm.gerer du club) : palette, polices, effets, logos, nom du club ; `{ reinitialiser: true }` revient au thème par défaut (logos et nom gardés). */
  async function changerCharte(acteur, corps) {
    await ctxPortee(acteur, PORTEE_CLUB, 'cm.gerer');
    const actuelle = await charteLigne();
    if (corps?.version !== undefined && Number(corps.version) !== actuelle.version) throw echec(409, 'conflit', 'La charte a changé entre-temps : rechargez-la.');
    let valeur;
    if (corps?.reinitialiser === true) valeur = { ...lireCharte({}, CHARTE_DEFAUT), club: actuelle.valeur.club, logos: actuelle.valeur.logos };
    else valeur = valider(v => lireCharte(v, actuelle.valeur), corps?.charte ?? {});
    // Logos : des images importées (cm_visuel_images), du club ou de la team concernée.
    const logos = [valeur.logos.club, ...Object.values(valeur.logos.teams)].filter(Boolean);
    for (const f of new Set(logos)) {
      const img = await base.premier('SELECT portee FROM cm_visuel_images WHERE fichier_id = ? AND supprime_le IS NULL', [f]);
      if (!img) throw echec(400, 'logo', 'Logo : importez d’abord l’image.');
    }
    for (const [team, f] of Object.entries(valeur.logos.teams)) {
      if (!(await base.premier('SELECT id FROM teams WHERE id = ? AND supprimee_le IS NULL', [team]))) delete valeur.logos.teams[team];
      else {
        const img = await base.premier('SELECT portee FROM cm_visuel_images WHERE fichier_id = ?', [f]);
        if (img.portee !== PORTEE_CLUB && img.portee !== team) throw echec(400, 'logo', 'Logo : image d’une autre team.');
      }
    }
    const t = iso(maintenant());
    await base.lot([
      actuelle.version === 0
        ? { sql: "INSERT INTO cm_charte (id, valeur, version, maj_par, maj_le) VALUES ('club', ?, 1, ?, ?) ON CONFLICT (id) DO UPDATE SET valeur = excluded.valeur, version = cm_charte.version + 1, maj_par = excluded.maj_par, maj_le = excluded.maj_le", params: [JSON.stringify(valeur), acteur.compte, t] }
        : { sql: "UPDATE cm_charte SET valeur = ?, version = version + 1, maj_par = ?, maj_le = ? WHERE id = 'club'", params: [JSON.stringify(valeur), acteur.compte, t] },
      evenement('cm.charte_modifiee', { acteur: acteur.compte, entiteType: 'cm_charte', entiteId: 'club', charge: { reinitialisee: corps?.reinitialiser === true }, maintenant: maintenant() }),
    ]);
    return charte(acteur);
  }

  // ---------------------------------------------------------------- Images importées

  /** Rattache un envoi terminé (image) à la portée : `{ fichierId, largeur, hauteur }`. */
  async function rattacherImage(ctx, envoi, { formats, tailleMax, attendu, entiteType }) {
    if (!medias) throw echec(503, 'stockage-absent', 'Le stockage des fichiers n’est pas branché sur le serveur Esport.');
    const r = await medias.preparerRattachement(tableaux.contexteEnvoi(ctx, ctx.portee), envoi, 'cm', { entiteType, entiteId: ctx.portee });
    if (!formats.includes(r.analyse?.format)) {
      if (attendu) throw echec(415, 'format-image', 'Rendu : PNG ou JPEG.');
      throw echec(415, 'format-image', 'Image : PNG, JPEG, GIF ou WebP.');
    }
    if (Number(r.envoi.taille) > tailleMax) throw echec(413, 'image-trop-grosse', `Image trop lourde : ${Math.floor(tailleMax / 1048576)} Mo au plus.`);
    const dim = dimensionsImage(await lireDebut(stockage, r.envoi.cle_stockage, OCTETS_ENTETE));
    if (!dimensionsAcceptables(dim)) throw echec(400, 'image-dimensions', 'Image illisible ou trop grande (8192 px de côté au plus).');
    if (attendu && (dim.largeur !== attendu.largeur || dim.hauteur !== attendu.hauteur)) {
      const e = echec(400, 'rendu-dimensions', `Le rendu doit faire exactement ${attendu.largeur}×${attendu.hauteur} px.`);
      e.details = { attendu, recu: { largeur: dim.largeur, hauteur: dim.hauteur } };
      throw e;
    }
    return { ...r, dim };
  }

  /** `POST /cm/visuels/images { portee, envoi }` : image importée dans l'éditeur (fond, photo, logo). */
  async function importerImage(acteur, corps) {
    const ctx = await ctxPortee(acteur, corps?.portee, 'cm.editer', 'cm.gerer');
    const r = await rattacherImage(ctx, corps?.envoi, { formats: FORMATS_IMAGE, tailleMax: TAILLE_MAX_IMAGE, entiteType: 'cm_visuel_image' });
    const nom = texteNettoye(r.envoi.nom_original, 140);
    await base.lot([
      ...r.instructions,
      { sql: 'INSERT INTO cm_visuel_images (fichier_id, portee, team_id, nom, largeur, hauteur, cree_par, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', params: [r.fichierId, ctx.portee, teamDePortee(ctx.portee), nom, r.dim.largeur, r.dim.hauteur, acteur.compte, iso(maintenant())] },
    ]);
    return { fichierId: r.fichierId, nom, largeur: r.dim.largeur, hauteur: r.dim.hauteur, portee: ctx.portee };
  }

  /** `GET /cm/visuels/images?portee` : images de la portée et du club. */
  async function images(acteur, { portee } = {}) {
    const ctx = await ctxPortee(acteur, portee ?? PORTEE_CLUB, 'cm.voir', 'cm.editer');
    const lignes = await base.tous("SELECT * FROM cm_visuel_images WHERE (portee = ? OR portee = 'club') AND supprime_le IS NULL ORDER BY cree_le DESC LIMIT 200", [ctx.portee]);
    return { images: lignes.map(l => ({ fichierId: l.fichier_id, portee: l.portee, nom: l.nom, largeur: l.largeur === null ? null : Number(l.largeur), hauteur: l.hauteur === null ? null : Number(l.hauteur), creeLe: l.cree_le })) };
  }

  /**
   * L'acteur peut-il lire ce fichier d'image ou de rendu ? Image du club (logos, fonds) : toute personne qui
   * voit la section ; sinon cm.voir sur sa portée.
   */
  async function fichierLisible(acteur, fichierId) {
    exigerUuid(fichierId, 'fichier');
    const f = await base.premier('SELECT id, portee FROM cm_fichiers WHERE id = ? AND supprime_le IS NULL', [fichierId]);
    const image = f ? await base.premier('SELECT portee FROM cm_visuel_images WHERE fichier_id = ? AND supprime_le IS NULL', [fichierId]) : null;
    const visuel = f && !image ? await base.premier('SELECT id FROM cm_visuels WHERE fichier_id = ? AND supprime_le IS NULL', [fichierId]) : null;
    if (!f || (!image && !visuel)) throw echec(404, 'fichier-introuvable', 'Fichier introuvable.');
    if (image?.portee === PORTEE_CLUB) await voitSection(acteur);
    else await ctxPortee(acteur, f.portee, 'cm.voir');
    return f;
  }

  /** `POST /cm/visuels/fichiers/:id/lien` : lien signé (2 h) vers une image importée ou un rendu. */
  async function lienFichier(acteur, fichierId, corps) {
    const f = await fichierLisible(acteur, fichierId);
    return cheminSigne(cleSession, { fichierId: f.id, compte: acteur.compte, maintenant: maintenant(), duree: DUREE_LIEN_CM_MS, telecharger: corps?.telecharger === true, genre: 'cm' });
  }

  /** Les images d'un document existent-elles dans la portée (ou au club) ? */
  async function verifierImages(portee, docs) {
    const ids = [...new Set(docs.flatMap(d => fichiersDuDocument(d)))];
    for (const id of ids) {
      const l = await base.premier('SELECT portee FROM cm_visuel_images WHERE fichier_id = ? AND supprime_le IS NULL', [id]);
      if (!l || (l.portee !== PORTEE_CLUB && l.portee !== portee)) throw echec(400, 'image-inconnue', 'Image inconnue : importez-la dans l’éditeur.');
    }
  }

  // ---------------------------------------------------------------- Modèles personnalisés

  const modelePublic = (m, noms = {}, { documents = false } = {}) => ({
    id: m.id,
    portee: m.portee,
    teamId: m.team_id ?? null,
    nom: m.nom,
    type: m.type,
    base: m.base ?? null,
    formats: Object.keys(jsonOu(m.documents, {})),
    version: Number(m.version),
    creePar: m.cree_par ?? null,
    majPar: m.maj_par ?? null,
    majLe: m.maj_le,
    ...(documents ? { documents: jsonOu(m.documents, {}) } : {}),
    noms,
  });

  async function modeleVisible(acteur, id, ...permissions) {
    exigerUuid(id, 'modele');
    const m = await base.premier('SELECT * FROM cm_modeles WHERE id = ? AND supprime_le IS NULL', [id]);
    if (!m) throw echec(404, 'modele-introuvable', 'Modèle introuvable.');
    if (permissions.length) {
      const ctx = await ctxPortee(acteur, m.portee, ...permissions).catch(e => {
        throw e.statut === 403 ? e : echec(404, 'modele-introuvable', 'Modèle introuvable.');
      });
      return { m, ctx };
    }
    if (m.portee === PORTEE_CLUB) await voitSection(acteur);
    else
      await ctxPortee(acteur, m.portee, 'cm.voir').catch(() => {
        throw echec(404, 'modele-introuvable', 'Modèle introuvable.');
      });
    return { m, ctx: null };
  }

  const lireType = v => {
    if (!TYPES_VISUEL.includes(v)) throw echec(400, 'type', 'Genre de visuel inconnu.');
    return v;
  };
  const lireNom = (v, repli) => {
    const n = texteNettoye(v, 80);
    if (n.length < 1 && !repli) throw echec(400, 'nom', 'Nom obligatoire.');
    return n || repli;
  };

  /** `GET /cm/modeles?portee` : modèles personnalisés visibles (club, et teams où l'on voit la section). */
  async function modeles(acteur, { portee } = {}) {
    const p = await voitSection(acteur);
    const portees = [PORTEE_CLUB, ...[...p.teams].filter(([, s]) => s.has('cm.voir')).map(([id]) => id)].filter(x => !portee || x === portee || x === PORTEE_CLUB);
    const lignes = await base.tous(`SELECT * FROM cm_modeles WHERE supprime_le IS NULL AND portee IN (${portees.map(() => '?').join(', ')}) ORDER BY maj_le DESC LIMIT 300`, portees);
    const noms = await pseudosDe(base, lignes.flatMap(l => [l.cree_par, l.maj_par]).filter(Boolean));
    return {
      modeles: lignes.map(l => modelePublic(l)),
      noms,
      editer: { club: p.club.has('cm.editer'), teams: [...p.teams].filter(([, s]) => s.has('cm.editer')).map(([id]) => id) },
    };
  }

  async function modele(acteur, id) {
    const { m } = await modeleVisible(acteur, id);
    return { modele: modelePublic(m, await pseudosDe(base, [m.cree_par, m.maj_par].filter(Boolean)), { documents: true }) };
  }

  /** `POST /cm/modeles { portee, nom, type, base, documents }` (cm.editer de la portée). */
  async function creerModele(acteur, corps) {
    const ctx = await ctxPortee(acteur, corps?.portee ?? PORTEE_CLUB, 'cm.editer');
    const type = lireType(corps?.type);
    const nom = lireNom(corps?.nom);
    const documents = valider(lireDocuments, corps?.documents);
    await verifierImages(ctx.portee, Object.values(documents));
    const n = await base.premier('SELECT COUNT(*) AS n FROM cm_modeles WHERE supprime_le IS NULL', []);
    if (Number(n?.n ?? 0) >= MAX_MODELES) throw echec(409, 'trop-de-modeles', `${MAX_MODELES} modèles au plus.`);
    const baseModele = typeof corps?.base === 'string' && (MOTIF_MODELE_DEFAUT.test(corps.base) || MOTIF_UUID.test(corps.base)) ? corps.base : null;
    const id = nouvelId();
    const t = iso(maintenant());
    await base.lot([
      { sql: 'INSERT INTO cm_modeles (id, portee, team_id, nom, type, base, documents, version, cree_par, cree_le, maj_par, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)', params: [id, ctx.portee, teamDePortee(ctx.portee), nom, type, baseModele, JSON.stringify(documents), acteur.compte, t, acteur.compte, t] },
      evenement('cm.modele_cree', { teamId: teamDePortee(ctx.portee), acteur: acteur.compte, entiteType: 'cm_modele', entiteId: id, charge: { nom, type, portee: ctx.portee }, maintenant: maintenant() }),
    ]);
    return modele(acteur, id);
  }

  /** `PATCH /cm/modeles/:id { nom?, documents?, version }` : l'ancienne version est gardée (30 au plus). */
  async function modifierModele(acteur, id, corps) {
    const { m, ctx } = await modeleVisible(acteur, id, 'cm.editer');
    if (corps?.version === undefined || Number(corps.version) !== Number(m.version)) throw echec(409, 'conflit', 'Ce modèle a été modifié entre-temps : rechargez-le.');
    const nom = corps.nom === undefined ? m.nom : lireNom(corps.nom);
    const documents = corps.documents === undefined ? jsonOu(m.documents, {}) : valider(lireDocuments, corps.documents);
    await verifierImages(ctx.portee, Object.values(documents));
    const t = iso(maintenant());
    const lot = [
      { sql: 'INSERT INTO cm_modele_versions (id, modele_id, version, nom, documents, cree_par, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?)', params: [nouvelId(), m.id, Number(m.version), m.nom, m.documents, m.maj_par ?? m.cree_par ?? null, m.maj_le] },
      { sql: 'UPDATE cm_modeles SET nom = ?, documents = ?, version = version + 1, maj_par = ?, maj_le = ? WHERE id = ? AND version = ?', params: [nom, JSON.stringify(documents), acteur.compte, t, m.id, Number(m.version)] },
      evenement('cm.modele_modifie', { teamId: m.team_id ?? null, acteur: acteur.compte, entiteType: 'cm_modele', entiteId: m.id, charge: { nom, version: Number(m.version) + 1 }, maintenant: maintenant() }),
    ];
    await base.lot(lot);
    const anciennes = await base.tous('SELECT id FROM cm_modele_versions WHERE modele_id = ? ORDER BY version DESC', [m.id]);
    for (const v of anciennes.slice(MAX_VERSIONS)) await base.executer('DELETE FROM cm_modele_versions WHERE id = ?', [v.id]);
    return modele(acteur, m.id);
  }

  async function supprimerModele(acteur, id) {
    const { m } = await modeleVisible(acteur, id, 'cm.editer');
    await base.lot([
      { sql: 'UPDATE cm_modeles SET supprime_le = ? WHERE id = ?', params: [iso(maintenant()), m.id] },
      evenement('cm.modele_supprime', { teamId: m.team_id ?? null, acteur: acteur.compte, entiteType: 'cm_modele', entiteId: m.id, charge: { nom: m.nom }, maintenant: maintenant() }),
    ]);
    return { ok: true };
  }

  /** `POST /cm/modeles/:id/dupliquer { nom?, portee? }` : copie (version 1) dans une portée où l'on peut éditer. */
  async function dupliquerModele(acteur, id, corps) {
    const { m } = await modeleVisible(acteur, id);
    return creerModele(acteur, { portee: corps?.portee ?? m.portee, nom: lireNom(corps?.nom, `${m.nom} (2)`.slice(0, 80)), type: m.type, base: m.id, documents: jsonOu(m.documents, {}) });
  }

  async function versionsModele(acteur, id) {
    const { m } = await modeleVisible(acteur, id);
    const lignes = await base.tous('SELECT version, nom, cree_par, cree_le FROM cm_modele_versions WHERE modele_id = ? ORDER BY version DESC', [m.id]);
    const noms = await pseudosDe(base, lignes.map(l => l.cree_par).filter(Boolean));
    return { actuelle: Number(m.version), versions: lignes.map(l => ({ version: Number(l.version), nom: l.nom, auteur: l.cree_par ?? null, date: l.cree_le })), noms };
  }

  async function versionModele(acteur, id, version) {
    const { m } = await modeleVisible(acteur, id);
    const l = await base.premier('SELECT * FROM cm_modele_versions WHERE modele_id = ? AND version = ?', [m.id, Number(version)]);
    if (!l) throw echec(404, 'version-introuvable', 'Version introuvable.');
    return { version: Number(l.version), nom: l.nom, documents: jsonOu(l.documents, {}), date: l.cree_le };
  }

  /** `POST /cm/modeles/:id/versions/:v/restaurer { version }` : la version choisie devient la nouvelle version. */
  async function restaurerModele(acteur, id, version, corps) {
    const v = await versionModele(acteur, id, version);
    return modifierModele(acteur, id, { version: corps?.version, nom: v.nom, documents: v.documents });
  }

  // ---------------------------------------------------------------- Sources de données

  /**
   * Source d'un visuel saisie : `{ genre, teamId?, id?, date? }`. La team doit être dans la portée (portée
   * d'une team : elle-même ; club : une team où l'acteur peut éditer). Rend la source normalisée.
   */
  async function lireSource(acteur, portee, v) {
    const genre = GENRES_SOURCE.includes(v?.genre) ? v.genre : 'libre';
    let teamId = v?.teamId === undefined || v?.teamId === null || v?.teamId === '' ? null : exigerUuid(v.teamId, 'team');
    if (portee !== PORTEE_CLUB) {
      if (teamId && teamId !== portee) throw echec(400, 'source', 'Source d’une autre team.');
      teamId = portee;
    }
    if (['resultat', 'annonce', 'tournoi', 'membre', 'equipe'].includes(genre) && !teamId) throw echec(400, 'source', 'Choisissez la team.');
    if (teamId) {
      const ctx = await contexteCm(base, acteur, teamId).catch(() => {
        throw echec(404, 'team-introuvable', 'Team introuvable.');
      });
      exiger(ctx, 'cm.editer');
    }
    const id = ['resultat', 'annonce', 'tournoi'].includes(genre) ? exigerUuid(v?.id, 'element') : genre === 'membre' ? (typeof v?.id === 'string' && /^(principal|[a-z0-9]{6,16})$/.test(v.id) ? v.id : (() => { throw echec(404, 'membre-introuvable', 'Membre introuvable.'); })()) : null;
    const date = genre === 'semaine' ? (typeof v?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.date) ? v.date : iso(maintenant()).slice(0, 10)) : null;
    return { genre, teamId, id, date };
  }

  /** Teams du programme de la semaine pour une portée « club » : celles où l'acteur peut éditer. */
  async function teamsEditables(acteur) {
    const p = await porteesDe(base, acteur);
    return [...p.teams].filter(([, s]) => s.has('cm.editer')).map(([id]) => id);
  }

  async function donneesDe(acteur, source) {
    const d = await donneesVisuel(base, source, { teams: source.genre === 'semaine' && !source.teamId ? await teamsEditables(acteur) : [] });
    if (!d) throw echec(404, 'element-introuvable', 'Introuvable.');
    if (!d.publiable) throw echec(409, 'non-publiable', 'Ce contenu n’est pas publiable (réservé au staff, scrim non publiable, annulé…).');
    return d;
  }

  /** `GET /cm/visuels/donnees?portee&genre&teamId&id&date` : données (FR et EN) pour l'aperçu dans l'éditeur. */
  async function donnees(acteur, q) {
    const ctx = await ctxPortee(acteur, q.portee ?? PORTEE_CLUB, 'cm.editer');
    const source = await lireSource(acteur, ctx.portee, q);
    return { source, donnees: await donneesDe(acteur, source) };
  }

  // ---------------------------------------------------------------- Visuels

  async function versionCharte() {
    const l = await base.premier("SELECT version FROM cm_charte WHERE id = 'club'", []);
    return l ? Number(l.version) : 0;
  }

  /** Modèle d'un visuel : « defaut:<type> » ou un modèle personnalisé visible (sa version). */
  async function lireModeleRef(acteur, ref, portee) {
    const d = MOTIF_MODELE_DEFAUT.exec(String(ref ?? ''));
    if (d) {
      if (!TYPES_VISUEL.includes(d[1])) throw echec(400, 'modele', 'Modèle inconnu.');
      return { ref: `defaut:${d[1]}`, type: d[1], version: null, ligne: null };
    }
    const { m } = await modeleVisible(acteur, ref);
    if (m.portee !== PORTEE_CLUB && m.portee !== portee) throw echec(400, 'modele', 'Modèle d’une autre team.');
    return { ref: m.id, type: m.type, version: Number(m.version), ligne: m };
  }

  async function visuelPublic(acteur, v, { avecDonnees = false } = {}) {
    const source = jsonOu(v.source, {});
    let perime = null;
    let donneesActuelles = null;
    let erreurDonnees = null;
    if (avecDonnees) {
      try {
        donneesActuelles = await donneesDe(acteur, source);
      } catch (e) {
        erreurDonnees = e.code ?? 'donnees';
      }
      const modeleActuel = MOTIF_MODELE_DEFAUT.test(v.modele) ? null : await base.premier('SELECT version, supprime_le FROM cm_modeles WHERE id = ?', [v.modele]);
      perime = v.fichier_id
        ? {
            donnees: Boolean(donneesActuelles && v.donnees_empreinte && donneesActuelles.empreinte !== v.donnees_empreinte),
            charte: (await versionCharte()) !== Number(v.charte_version ?? 0),
            modele: Boolean(modeleActuel && !v.retouche && Number(modeleActuel.version) !== Number(v.modele_version ?? 0)),
          }
        : null;
    }
    return {
      id: v.id,
      portee: v.portee,
      teamId: v.team_id ?? null,
      carteId: v.carte_id ?? null,
      pieceId: v.piece_id ?? null,
      fichierId: v.fichier_id ?? null,
      nom: v.nom,
      modele: v.modele,
      type: v.type,
      format: v.format,
      langue: v.langue,
      source,
      retouche: Number(v.retouche) === 1,
      ...(avecDonnees ? { document: jsonOu(v.document, null), donnees: donneesActuelles, erreurDonnees, perime } : {}),
      renduLe: v.rendu_le ?? null,
      version: Number(v.version),
      creePar: v.cree_par ?? null,
      majLe: v.maj_le,
    };
  }

  async function visuelVisible(acteur, id, ...permissions) {
    exigerUuid(id, 'visuel');
    const v = await base.premier('SELECT * FROM cm_visuels WHERE id = ? AND supprime_le IS NULL', [id]);
    if (!v) throw echec(404, 'visuel-introuvable', 'Visuel introuvable.');
    const ctx = await ctxPortee(acteur, v.portee, ...(permissions.length ? permissions : ['cm.voir'])).catch(e => {
      throw e.statut === 403 && permissions.length ? e : echec(404, 'visuel-introuvable', 'Visuel introuvable.');
    });
    return { v, ctx };
  }

  /** `GET /cm/visuels?portee&carte` : visuels visibles (les plus récents d'abord). */
  async function visuels(acteur, { portee, carte } = {}) {
    if (carte) {
      const { tableau } = await tableaux.carteVisible(acteur, carte);
      const lignes = await base.tous('SELECT * FROM cm_visuels WHERE carte_id = ? AND supprime_le IS NULL ORDER BY cree_le', [carte]);
      return { visuels: await Promise.all(lignes.map(l => visuelPublic(acteur, l, { avecDonnees: true }))), portee: tableau.portee };
    }
    const p = await voitSection(acteur);
    const portees = [...(p.club.has('cm.voir') ? [PORTEE_CLUB] : []), ...[...p.teams].filter(([, s]) => s.has('cm.voir')).map(([id]) => id)].filter(x => !portee || x === portee);
    if (!portees.length) return { visuels: [] };
    const lignes = await base.tous(`SELECT * FROM cm_visuels WHERE supprime_le IS NULL AND portee IN (${portees.map(() => '?').join(', ')}) ORDER BY maj_le DESC LIMIT 100`, portees);
    return { visuels: await Promise.all(lignes.map(l => visuelPublic(acteur, l))) };
  }

  async function visuel(acteur, id) {
    const { v } = await visuelVisible(acteur, id);
    return { visuel: await visuelPublic(acteur, v, { avecDonnees: true }) };
  }

  const lireFormat = v => {
    if (!CLES_FORMATS.includes(v)) throw echec(400, 'format', 'Format : carre, portrait, story ou paysage.');
    return v;
  };
  const lireLangueVisuel = v => {
    if (!LANGUES_VISUEL.includes(v)) throw echec(400, 'langue', 'Langue : fr ou en.');
    return v;
  };

  /**
   * `POST /cm/visuels { portee?, carteId?, modele, format, langue, source, nom? }` : nouveau visuel (cm.editer).
   * Depuis une carte : la portée est celle de son tableau.
   */
  async function creerVisuel(acteur, corps) {
    let portee = corps?.portee ?? PORTEE_CLUB;
    let carteId = null;
    if (corps?.carteId) {
      const { carte: c, tableau, ctx } = await tableaux.carteVisible(acteur, corps.carteId);
      exiger(ctx, 'cm.editer');
      portee = tableau.portee;
      carteId = c.id;
      const n = await base.premier('SELECT COUNT(*) AS n FROM cm_visuels WHERE carte_id = ? AND supprime_le IS NULL', [c.id]);
      if (Number(n?.n ?? 0) >= MAX_VISUELS_CARTE) throw echec(409, 'trop-de-visuels', `${MAX_VISUELS_CARTE} visuels au plus par carte.`);
    }
    const ctx = await ctxPortee(acteur, portee, 'cm.editer');
    const modeleRef = await lireModeleRef(acteur, corps?.modele, ctx.portee);
    const format = lireFormat(corps?.format);
    if (modeleRef.ligne && !jsonOu(modeleRef.ligne.documents, {})[format]) throw echec(400, 'format', 'Ce modèle n’existe pas dans ce format.');
    const langue = lireLangueVisuel(corps?.langue);
    const source = await lireSource(acteur, ctx.portee, corps?.source);
    const d = await donneesDe(acteur, source);
    const id = nouvelId();
    const t = iso(maintenant());
    const nom = texteNettoye(corps?.nom, 120) || texteNettoye(d[langue].champs.titre || d[langue].champs.joueur || d[langue].champs.semaine || d[langue].champs.team, 120) || modeleRef.type;
    await base.executer(
      'INSERT INTO cm_visuels (id, portee, team_id, carte_id, nom, modele, type, format, langue, source, retouche, version, cree_par, cree_le, maj_par, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?)',
      [id, ctx.portee, teamDePortee(ctx.portee), carteId, nom, modeleRef.ref, modeleRef.type, format, langue, JSON.stringify(source), acteur.compte, t, acteur.compte, t],
    );
    return visuel(acteur, id);
  }

  /**
   * `PATCH /cm/visuels/:id { version, nom?, document? (null : revenir au modèle), format?, langue?, modele?, source? }`.
   * Un document fourni marque le visuel « retouché » : il ne suit plus le modèle (les champs dynamiques, eux,
   * suivent toujours les données).
   */
  async function modifierVisuel(acteur, id, corps) {
    const { v, ctx } = await visuelVisible(acteur, id, 'cm.editer');
    if (corps?.version === undefined || Number(corps.version) !== Number(v.version)) throw echec(409, 'conflit', 'Ce visuel a été modifié entre-temps : rechargez-le.');
    const champs = {};
    if (corps.nom !== undefined) champs.nom = texteNettoye(corps.nom, 120) || v.nom;
    if (corps.format !== undefined) champs.format = lireFormat(corps.format);
    if (corps.langue !== undefined) champs.langue = lireLangueVisuel(corps.langue);
    if (corps.modele !== undefined) {
      const m = await lireModeleRef(acteur, corps.modele, ctx.portee);
      champs.modele = m.ref;
      champs.type = m.type;
    }
    if (corps.source !== undefined) {
      const s = await lireSource(acteur, ctx.portee, corps.source);
      await donneesDe(acteur, s);
      champs.source = JSON.stringify(s);
    }
    if (corps.document !== undefined) {
      if (corps.document === null) {
        champs.document = null;
        champs.retouche = 0;
      } else {
        const doc = valider(x => lireDocument(x), corps.document);
        if (doc.format !== (champs.format ?? v.format)) throw erreurDocument(new DocumentInvalide('document.format', 'format'));
        await verifierImages(ctx.portee, [doc]);
        champs.document = JSON.stringify(doc);
        champs.retouche = 1;
      }
    } else if (champs.format && v.document) {
      // Changer le format d'un visuel retouché : la retouche (faite pour l'ancien format) est abandonnée.
      champs.document = null;
      champs.retouche = 0;
    }
    const cles = Object.keys(champs);
    if (!cles.length) return visuel(acteur, v.id);
    await base.executer(`UPDATE cm_visuels SET ${cles.map(k => `${k} = ?`).join(', ')}, version = version + 1, maj_par = ?, maj_le = ? WHERE id = ? AND version = ?`, [...cles.map(k => champs[k]), acteur.compte, iso(maintenant()), v.id, Number(v.version)]);
    return visuel(acteur, v.id);
  }

  async function supprimerVisuel(acteur, id) {
    const { v } = await visuelVisible(acteur, id, 'cm.editer');
    const t = maintenant();
    await base.executer('UPDATE cm_visuels SET supprime_le = ? WHERE id = ?', [iso(t), v.id]);
    // La pièce jointe éventuelle reste sur la carte ; les octets ne partent que s'ils ne servent plus.
    if (v.fichier_id) await tableaux.effacerFichierSiOrphelin(v.fichier_id, t);
    return { ok: true };
  }

  /** Nom de fichier du rendu : « resultat-portrait-fr.png ». */
  const nomRendu = (v, ext) => `${texteNettoye(v.nom, 80).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').toLowerCase() || v.type}-${v.format}-${v.langue}.${ext}`;

  /**
   * `POST /cm/visuels/:id/rendu { envoi, empreinte, version }` : le rendu (PNG ou JPEG, taille exacte du format)
   * fait par l'app avec les données d'empreinte `empreinte`. Données changées depuis : 409 `donnees-changees`
   * (l'app relit et régénère). Visuel lié à une carte : le rendu y est joint (il remplace le précédent).
   */
  async function rendu(acteur, id, corps) {
    const { v, ctx } = await visuelVisible(acteur, id, 'cm.editer');
    if (corps?.version !== undefined && Number(corps.version) !== Number(v.version)) throw echec(409, 'conflit', 'Ce visuel a été modifié entre-temps : rechargez-le.');
    const d = await donneesDe(acteur, jsonOu(v.source, {}));
    if (corps?.empreinte !== d.empreinte) {
      const e = echec(409, 'donnees-changees', 'Les données ont changé depuis l’ouverture : le visuel va être régénéré.');
      e.details = { empreinte: d.empreinte };
      throw e;
    }
    const r = await rattacherImage(ctx, corps?.envoi, { formats: FORMATS_RENDU, tailleMax: TAILLE_MAX_RENDU, attendu: FORMATS[v.format], entiteType: 'cm_visuel' });
    const modeleVersion = MOTIF_MODELE_DEFAUT.test(v.modele) ? null : Number((await base.premier('SELECT version FROM cm_modeles WHERE id = ?', [v.modele]))?.version ?? 0);
    const t = maintenant();
    const ancien = v.fichier_id;
    await base.lot([
      ...r.instructions,
      { sql: 'UPDATE cm_visuels SET fichier_id = ?, donnees_empreinte = ?, charte_version = ?, modele_version = ?, rendu_le = ?, rendu_par = ?, version = version + 1, maj_le = ? WHERE id = ?', params: [r.fichierId, d.empreinte, await versionCharte(), modeleVersion, iso(t), acteur.compte, iso(t), v.id] },
      evenement('cm.visuel_genere', { teamId: v.team_id ?? null, acteur: acteur.compte, entiteType: 'cm_visuel', entiteId: v.id, charge: { nom: v.nom, type: v.type, format: v.format, langue: v.langue, carte: v.carte_id ?? null }, maintenant: t }),
    ]);
    if (v.carte_id) {
      const carte = await base.premier('SELECT id FROM cm_cartes WHERE id = ? AND supprime_le IS NULL', [v.carte_id]);
      if (carte) {
        const { pieceId } = await tableaux.attacherFichier(acteur, v.carte_id, { fichierId: r.fichierId, nom: nomRendu(v, r.analyse.format === 'jpeg' ? 'jpg' : 'png'), remplacer: v.piece_id });
        await base.executer('UPDATE cm_visuels SET piece_id = ? WHERE id = ?', [pieceId, v.id]);
      }
    }
    if (ancien && ancien !== r.fichierId) await tableaux.effacerFichierSiOrphelin(ancien, t);
    return visuel(acteur, v.id);
  }

  /** `POST /cm/visuels/:id/carte { carteId }` : lie le visuel à une carte (de la même portée) et y joint son rendu. */
  async function lierCarte(acteur, id, corps) {
    const { v } = await visuelVisible(acteur, id, 'cm.editer');
    const { carte: c, tableau, ctx } = await tableaux.carteVisible(acteur, corps?.carteId);
    exiger(ctx, 'cm.editer');
    if (tableau.portee !== v.portee) throw echec(400, 'portee', 'Carte d’une autre portée.');
    let pieceId = null;
    if (v.fichier_id) pieceId = (await tableaux.attacherFichier(acteur, c.id, { fichierId: v.fichier_id, nom: nomRendu(v, 'png') })).pieceId;
    await base.executer('UPDATE cm_visuels SET carte_id = ?, piece_id = ?, version = version + 1, maj_le = ? WHERE id = ?', [c.id, pieceId, iso(maintenant()), v.id]);
    return visuel(acteur, v.id);
  }

  /** `POST /cm/visuels/:id/lien { telecharger }` : lien signé vers le dernier rendu. */
  async function lienRendu(acteur, id, corps) {
    const { v } = await visuelVisible(acteur, id);
    if (!v.fichier_id) throw echec(404, 'rendu-absent', 'Ce visuel n’a pas encore été généré.');
    return cheminSigne(cleSession, { fichierId: v.fichier_id, compte: acteur.compte, maintenant: maintenant(), duree: DUREE_LIEN_CM_MS, telecharger: corps?.telecharger === true, genre: 'cm' });
  }

  /**
   * `GET /cm/cartes/:id/visuels` : visuels de la carte et PROPOSITION (genre de visuel et source tirés des
   * liens de la carte ou de la suggestion automatique qui l'a créée).
   */
  async function visuelsCarte(acteur, carteId) {
    const { carte: c, tableau, ctx } = await tableaux.carteVisible(acteur, carteId);
    const liens = jsonOu(c.liens, {});
    const suggestion = typeof c.origine_cle === 'string' ? c.origine_cle.split(':')[0] : null;
    const teamId = liens.teamId ?? c.team_id ?? (tableau.portee !== PORTEE_CLUB ? tableau.portee : null);
    const PAR_SUGGESTION = { tournoi: ['banniere', 'tournoi'], j1: ['annonce', 'annonce'], jourj: ['jour_match', 'annonce'], resultat: ['resultat', 'resultat'], final: ['classement', 'tournoi'] };
    let proposition = null;
    if (suggestion && PAR_SUGGESTION[suggestion]) {
      const [type, genre] = PAR_SUGGESTION[suggestion];
      const id = genre === 'resultat' ? liens.resultatId : genre === 'annonce' ? liens.matchId : liens.tournoiId;
      if (id && teamId) proposition = { type, source: { genre, teamId, id } };
    } else if (teamId && liens.resultatId) proposition = { type: 'resultat', source: { genre: 'resultat', teamId, id: liens.resultatId } };
    else if (teamId && liens.matchId) proposition = { type: 'annonce', source: { genre: 'annonce', teamId, id: liens.matchId } };
    else if (teamId && liens.tournoiId) proposition = { type: 'banniere', source: { genre: 'tournoi', teamId, id: liens.tournoiId } };
    else if (teamId && Array.isArray(liens.membres) && liens.membres.length) proposition = { type: 'mvp', source: { genre: 'membre', teamId, id: liens.membres[0] } };
    const lignes = await base.tous('SELECT * FROM cm_visuels WHERE carte_id = ? AND supprime_le IS NULL ORDER BY cree_le', [c.id]);
    return {
      visuels: await Promise.all(lignes.map(l => visuelPublic(acteur, l, { avecDonnees: true }))),
      proposition,
      suggestion,
      portee: tableau.portee,
      editer: peut(ctx, 'cm.editer'),
    };
  }

  return {
    charte,
    changerCharte,
    importerImage,
    images,
    lienFichier,
    modeles,
    modele,
    creerModele,
    modifierModele,
    supprimerModele,
    dupliquerModele,
    versionsModele,
    versionModele,
    restaurerModele,
    donnees,
    visuels,
    visuel,
    creerVisuel,
    modifierVisuel,
    supprimerVisuel,
    rendu,
    lierCarte,
    lienRendu,
    visuelsCarte,
  };
}
