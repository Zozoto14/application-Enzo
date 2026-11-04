/**
 * Dossiers des visuels de la section CM (migration 0041, docs/esport/visuels.md, partie « Dossiers ») : les
 * modèles du club et les visuels générés d'une portée (club ou team) se rangent dans une arborescence, comme le
 * Drive. Dossiers par défaut (créés au premier passage) : Annonces, Résultats, Recrues, Programmes, Sponsors,
 * Divers ; un modèle ou un visuel créé sans dossier va dans celui de son genre (annonce → Annonces…).
 *
 * Droits : lire avec `cm.voir` (club : qui voit la section quelque part, comme les modèles du club) ; créer,
 * renommer, déplacer, supprimer un dossier et y ranger avec `cm.editer` de la portée. Un dossier supprimé n'emporte
 * rien : son contenu (sous-dossiers, modèles, visuels) remonte dans son dossier parent.
 */

import { echec, iso, nouvelId, texteNettoye } from '../../outils.mjs';
import { PORTEE_CLUB, contexteCm, espaceCm, exiger, exigerEspaceCm, exigerUuid, lirePortee, porteesDe, teamDePortee } from '../commun.mjs';

export const CLES_DOSSIERS_VISUELS = Object.freeze(['annonces', 'resultats', 'recrues', 'programmes', 'sponsors', 'divers']);
/** Dossier par défaut d'un genre de visuel. */
export const DOSSIER_PAR_TYPE = Object.freeze({
  annonce: 'annonces',
  jour_match: 'annonces',
  lineup: 'annonces',
  banniere: 'annonces',
  resultat: 'resultats',
  classement: 'resultats',
  mvp: 'resultats',
  recrue: 'recrues',
  depart: 'recrues',
  programme: 'programmes',
  libre: 'divers',
});
const NOMS_DEFAUT = { annonces: 'Annonces', resultats: 'Résultats', recrues: 'Recrues', programmes: 'Programmes', sponsors: 'Sponsors', divers: 'Divers' };
/** Types des modèles par défaut (ceux du code de l'app) : rangeables dans un dossier sans changer le modèle. */
export const TYPES_DEFAUT = Object.freeze(Object.keys(DOSSIER_PAR_TYPE));
export const DOSSIERS_VISUELS_MAX = 500;
export const PROFONDEUR_VISUELS_MAX = 8;
const LOT_MAX = 200;

export function servicesDossiersVisuels({ base, maintenant = () => Date.now() }) {
  async function ctx(acteur, portee, permission) {
    const c = await contexteCm(base, acteur, lirePortee(portee ?? PORTEE_CLUB));
    exiger(c, permission);
    return c;
  }

  /** Lecture : `cm.voir` de la portée ; pour le club, lire l'espace « CM du club » suffit (équipe CM, jamais un rôle de team). */
  async function ctxLecture(acteur, portee) {
    const p = lirePortee(portee ?? PORTEE_CLUB);
    if (p === PORTEE_CLUB) {
      const x = exigerEspaceCm(espaceCm(await porteesDe(base, acteur)));
      return { portee: p, editer: x.club.has('cm.editer') };
    }
    const c = await contexteCm(base, acteur, p);
    exiger(c, 'cm.voir', 'cm.editer');
    return { portee: c.portee, editer: c.permissions.has('cm.editer') };
  }

  async function assurer(portee) {
    const existants = new Set((await base.tous('SELECT cle FROM cm_visuels_dossiers WHERE portee = ? AND cle IS NOT NULL', [portee])).map(l => l.cle));
    const manquants = CLES_DOSSIERS_VISUELS.filter(c => !existants.has(c));
    if (!manquants.length) return;
    const t = iso(maintenant());
    await base.lot(manquants.map(cle => ({ sql: 'INSERT INTO cm_visuels_dossiers (id, portee, team_id, parent_id, nom, cle, cree_le, maj_le) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?) ON CONFLICT DO NOTHING', params: [nouvelId(), portee, teamDePortee(portee), cle, t, t] })));
  }

  async function arbre(portee) {
    const lignes = await base.tous('SELECT * FROM cm_visuels_dossiers WHERE portee = ? ORDER BY cree_le, id LIMIT ?', [portee, DOSSIERS_VISUELS_MAX * 2]);
    return new Map(lignes.map(d => [d.id, d]));
  }

  const chaine = (map, d) => {
    const sortie = [];
    let x = d;
    for (let n = 0; x && n <= PROFONDEUR_VISUELS_MAX + 2; n++) {
      sortie.unshift(x);
      if (!x.parent_id) return sortie;
      x = map.get(x.parent_id);
    }
    return sortie;
  };

  function descendants(map, id) {
    const sortie = [id];
    for (let i = 0; i < sortie.length && sortie.length <= DOSSIERS_VISUELS_MAX * 2; i++) for (const d of map.values()) if (d.parent_id === sortie[i]) sortie.push(d.id);
    return sortie;
  }

  const publier = (d, n = {}) => ({ id: d.id, portee: d.portee, parentId: d.parent_id ?? null, nom: d.nom ?? null, cle: d.cle ?? null, systeme: Boolean(d.cle), modeles: n.modeles ?? 0, visuels: n.visuels ?? 0, creeLe: d.cree_le, majLe: d.maj_le });

  /** Dossier de la portée (null : racine) ; 404 s'il n'existe pas dans cette portée. */
  function cible(map, id) {
    if (id === null || id === undefined || id === '') return null;
    exigerUuid(id, 'dossier');
    const d = map.get(id);
    if (!d) throw echec(404, 'dossier-introuvable', 'Dossier introuvable.');
    return d;
  }

  /** `GET /cm/visuels/dossiers?portee` : arborescence de la portée, nombre de modèles et visuels par dossier. */
  async function lister(acteur, { portee } = {}) {
    const c = await ctxLecture(acteur, portee);
    await assurer(c.portee);
    const map = await arbre(c.portee);
    const n = new Map();
    for (const [table, cleN] of [['cm_modeles', 'modeles'], ['cm_visuels', 'visuels']]) {
      for (const l of await base.tous(`SELECT dossier_id, COUNT(*) AS n FROM ${table} WHERE portee = ? AND supprime_le IS NULL AND dossier_id IS NOT NULL GROUP BY dossier_id`, [c.portee])) {
        if (!n.has(l.dossier_id)) n.set(l.dossier_id, {});
        n.get(l.dossier_id)[cleN] = Number(l.n);
      }
    }
    // Modèles par défaut rangés (migration 0043) : un dossier disparu vaut la racine (la ligne est ignorée).
    const defauts = {};
    for (const l of await base.tous('SELECT type, dossier_id FROM cm_visuels_defauts WHERE portee = ?', [c.portee])) {
      if (!map.has(l.dossier_id) || !TYPES_DEFAUT.includes(l.type)) continue;
      defauts[l.type] = l.dossier_id;
      if (!n.has(l.dossier_id)) n.set(l.dossier_id, {});
      n.get(l.dossier_id).modeles = (n.get(l.dossier_id).modeles ?? 0) + 1;
    }
    return { portee: c.portee, editer: c.editer, dossiers: [...map.values()].map(d => publier(d, n.get(d.id))), defauts };
  }

  /** `POST /cm/visuels/dossiers { portee, parentId?, nom }` (cm.editer). */
  async function creer(acteur, corps) {
    const c = await ctx(acteur, corps?.portee, 'cm.editer');
    await assurer(c.portee);
    const map = await arbre(c.portee);
    const parent = cible(map, corps?.parentId ?? null);
    if (map.size >= DOSSIERS_VISUELS_MAX) throw echec(409, 'trop-de-dossiers', `${DOSSIERS_VISUELS_MAX} dossiers au plus.`);
    if (parent && chaine(map, parent).length >= PROFONDEUR_VISUELS_MAX) throw echec(409, 'trop-profond', `${PROFONDEUR_VISUELS_MAX} niveaux de dossiers au plus.`);
    const nom = texteNettoye(corps?.nom, 80);
    if (!nom) throw echec(400, 'nom', 'Nom du dossier : obligatoire.');
    const id = nouvelId();
    const t = iso(maintenant());
    await base.executer('INSERT INTO cm_visuels_dossiers (id, portee, team_id, parent_id, nom, cle, cree_par, cree_le, maj_par, maj_le) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)', [id, c.portee, teamDePortee(c.portee), parent?.id ?? null, nom, acteur.compte, t, acteur.compte, t]);
    return { id };
  }

  async function dossierEditable(acteur, id) {
    exigerUuid(id, 'dossier');
    const d = await base.premier('SELECT * FROM cm_visuels_dossiers WHERE id = ?', [id]);
    if (!d) throw echec(404, 'dossier-introuvable', 'Dossier introuvable.');
    const c = await ctx(acteur, d.portee, 'cm.editer').catch(e => {
      throw e.statut === 403 ? e : echec(404, 'dossier-introuvable', 'Dossier introuvable.');
    });
    return { d, c, map: await arbre(d.portee) };
  }

  /** Nouveau parent d'un dossier : jamais lui-même ni un de ses descendants ; un dossier par défaut reste à la racine. */
  function verifierParent(map, d, parent) {
    if (d.cle && parent) throw echec(409, 'dossier-systeme', 'Un dossier par défaut reste à la racine.');
    if (!parent) return;
    const sous = descendants(map, d.id);
    if (sous.includes(parent.id)) throw echec(409, 'deplacement-boucle', 'Un dossier ne se range pas dans lui-même ni dans ses sous-dossiers.');
    const hauteur = Math.max(...sous.map(x => chaine(map, map.get(x)).length - chaine(map, d).length));
    if (chaine(map, parent).length + 1 + hauteur > PROFONDEUR_VISUELS_MAX) throw echec(409, 'trop-profond', `${PROFONDEUR_VISUELS_MAX} niveaux de dossiers au plus.`);
  }

  /** `PATCH /cm/visuels/dossiers/:id { nom?, parentId? }` : renommer (nom null : nom par défaut), déplacer. */
  async function modifier(acteur, id, corps) {
    const { d, map } = await dossierEditable(acteur, id);
    const champs = {};
    if (corps?.nom !== undefined) {
      if (corps.nom === null && d.cle) champs.nom = null;
      else {
        const nom = texteNettoye(corps.nom, 80);
        if (!nom) throw echec(400, 'nom', 'Nom du dossier : obligatoire.');
        champs.nom = nom;
      }
    }
    if (corps?.parentId !== undefined) {
      const parent = cible(map, corps.parentId);
      verifierParent(map, d, parent);
      champs.parent_id = parent?.id ?? null;
    }
    const cles = Object.keys(champs);
    if (cles.length) await base.executer(`UPDATE cm_visuels_dossiers SET ${cles.map(k => `${k} = ?`).join(', ')}, maj_par = ?, maj_le = ? WHERE id = ?`, [...cles.map(k => champs[k]), acteur.compte, iso(maintenant()), d.id]);
    return { ok: true };
  }

  /** `DELETE /cm/visuels/dossiers/:id` : le contenu remonte dans le dossier parent ; un dossier par défaut reste. */
  async function supprimer(acteur, id) {
    const { d } = await dossierEditable(acteur, id);
    if (d.cle) throw echec(409, 'dossier-systeme', 'Un dossier par défaut ne se supprime pas (renommez-le si besoin).');
    const parent = d.parent_id ?? null;
    await base.lot([
      { sql: 'UPDATE cm_visuels_dossiers SET parent_id = ? WHERE parent_id = ?', params: [parent, d.id] },
      { sql: 'UPDATE cm_modeles SET dossier_id = ? WHERE dossier_id = ?', params: [parent, d.id] },
      { sql: 'UPDATE cm_visuels SET dossier_id = ? WHERE dossier_id = ?', params: [parent, d.id] },
      // Modèles par défaut rangés ici : ils remontent aussi (racine : retour à leur place d'origine).
      parent ? { sql: 'UPDATE cm_visuels_defauts SET dossier_id = ? WHERE dossier_id = ?', params: [parent, d.id] } : { sql: 'DELETE FROM cm_visuels_defauts WHERE dossier_id = ?', params: [d.id] },
      { sql: 'DELETE FROM cm_visuels_dossiers WHERE id = ?', params: [d.id] },
    ]);
    return { ok: true, parentId: parent };
  }

  /**
   * `POST /cm/visuels/deplacer { elements: [{ genre: modele | visuel | dossier, id }], dossierId }` : range des
   * modèles, des visuels et des dossiers dans un dossier (null : racine) de LEUR portée. Rend `{ faits, erreurs,
   * avant }` (`avant` : dossier d'avant de chaque élément, pour « Annuler »).
   *
   * Un modèle par défaut (`genre: 'defaut'`, `id` : son type) se range aussi, dans la portée `corps.portee` (ou celle
   * du dossier d'arrivée) : seul son rangement est mémorisé (`cm_visuels_defauts`), le modèle ne change pas ; la
   * racine le remet à sa place d'origine. Permission : cm.editer de la portée, comme pour les dossiers.
   */
  async function deplacer(acteur, corps) {
    const elements = corps?.elements;
    if (!Array.isArray(elements) || !elements.length || elements.length > LOT_MAX) throw echec(400, 'elements', `De 1 à ${LOT_MAX} éléments.`);
    const faits = [];
    const erreurs = [];
    const avant = {};
    const t = iso(maintenant());
    for (const e of elements) {
      try {
        const genre = ['modele', 'visuel', 'dossier', 'defaut'].includes(e?.genre) ? e.genre : null;
        if (!genre) throw echec(400, 'genre', 'Élément inconnu.');
        if (genre === 'defaut') {
          if (!TYPES_DEFAUT.includes(e?.id)) throw echec(404, 'modele-introuvable', 'Modèle introuvable.');
          const dossierId = corps?.dossierId ?? null;
          const arrivee = dossierId ? await base.premier('SELECT portee FROM cm_visuels_dossiers WHERE id = ?', [String(dossierId)]) : null;
          if (dossierId && !arrivee) throw echec(404, 'dossier-introuvable', 'Dossier introuvable.');
          const portee = lirePortee(corps?.portee ?? arrivee?.portee ?? PORTEE_CLUB);
          if (arrivee && arrivee.portee !== portee) throw echec(404, 'dossier-introuvable', 'Dossier introuvable.');
          await ctx(acteur, portee, 'cm.editer');
          const map = await arbre(portee);
          const dest = cible(map, dossierId);
          const ancien = await base.premier('SELECT dossier_id FROM cm_visuels_defauts WHERE portee = ? AND type = ?', [portee, e.id]);
          avant[e.id] = ancien && map.has(ancien.dossier_id) ? ancien.dossier_id : null;
          if (!dest) await base.executer('DELETE FROM cm_visuels_defauts WHERE portee = ? AND type = ?', [portee, e.id]);
          else await base.executer('INSERT INTO cm_visuels_defauts (portee, type, team_id, dossier_id, maj_par, maj_le) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (portee, type) DO UPDATE SET dossier_id = excluded.dossier_id, maj_par = excluded.maj_par, maj_le = excluded.maj_le', [portee, e.id, teamDePortee(portee), dest.id, acteur.compte, t]);
        } else if (genre === 'dossier') {
          const { d } = await dossierEditable(acteur, e?.id);
          await modifier(acteur, d.id, { parentId: corps?.dossierId ?? null });
          avant[d.id] = d.parent_id ?? null;
        } else {
          exigerUuid(e?.id, genre);
          const table = genre === 'modele' ? 'cm_modeles' : 'cm_visuels';
          const l = await base.premier(`SELECT id, portee, dossier_id FROM ${table} WHERE id = ? AND supprime_le IS NULL`, [e.id]);
          if (!l) throw echec(404, `${genre}-introuvable`, genre === 'modele' ? 'Modèle introuvable.' : 'Visuel introuvable.');
          await ctx(acteur, l.portee, 'cm.editer').catch(x => {
            throw x.statut === 403 ? x : echec(404, `${genre}-introuvable`, 'Introuvable.');
          });
          const map = await arbre(l.portee);
          const dest = cible(map, corps?.dossierId ?? null);
          await base.executer(`UPDATE ${table} SET dossier_id = ?, maj_le = ? WHERE id = ?`, [dest?.id ?? null, t, l.id]);
          avant[l.id] = l.dossier_id ?? null;
        }
        faits.push(e.id);
      } catch (err) {
        erreurs.push({ id: typeof e?.id === 'string' ? e.id : null, code: err?.code ?? 'erreur', erreur: err?.message ?? String(err) });
      }
    }
    return { faits, erreurs, avant };
  }

  /** `POST /cm/visuels/defauts/reinitialiser { portee }` : tous les modèles par défaut de la portée reviennent à leur place d'origine. */
  async function reinitialiserDefauts(acteur, corps) {
    const c = await ctx(acteur, corps?.portee, 'cm.editer');
    const n = Number((await base.premier('SELECT COUNT(*) AS n FROM cm_visuels_defauts WHERE portee = ?', [c.portee]))?.n ?? 0);
    await base.executer('DELETE FROM cm_visuels_defauts WHERE portee = ?', [c.portee]);
    return { ok: true, n };
  }

  /**
   * Dossier d'un nouveau modèle ou visuel : celui demandé (de la portée, sinon 404), ou le dossier par défaut de
   * son genre.
   */
  async function dossierPour(portee, type, demande) {
    await assurer(portee);
    if (demande !== undefined && demande !== '') {
      if (demande === null) return null;
      return cible(await arbre(portee), demande).id;
    }
    const cle = DOSSIER_PAR_TYPE[type] ?? 'divers';
    return (await base.premier('SELECT id FROM cm_visuels_dossiers WHERE portee = ? AND cle = ?', [portee, cle]))?.id ?? null;
  }

  return { lister, creer, modifier, supprimer, deplacer, reinitialiserDefauts, dossierPour, NOMS_DEFAUT };
}
