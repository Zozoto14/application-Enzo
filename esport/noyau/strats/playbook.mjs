/**
 * Module « Playbook » (phase 6) : bibliothèque de la team par carte, side et
 * type, avec tags, statut (brouillon, validée, archivée) et favoris. Une
 * entrée pointe vers une strat de l'éditeur (sa miniature s'affiche dans la
 * grille) ou est purement textuelle.
 *
 * Droits : lecture pour tous les membres qui ont `playbook.view` (tous les
 * rôles système), gestion (`playbook.manage`) pour le Coach et l'Analyste.
 * La validation d'une entrée émet `playbook.validated` (journal,
 * notification in-app, Discord facultatif).
 */

import { evenement } from '../evenements.mjs';
import { autorise } from '../permissions.mjs';
import { echec, iso, jsonOu, nouvelId, texteLong, texteNettoye } from '../outils.mjs';
import { lignesParIds, pseudosDe } from '../requetes.mjs';
import { SIDES, TYPES_STRAT } from './document.mjs';
import { MODULE_STRATS, normaliser, tagsPropres } from './service.mjs';

export const MODULE_PLAYBOOK = 'playbook';
export const STATUTS_PLAYBOOK = ['brouillon', 'validee', 'archivee'];
const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MOTIF_CARTE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/**
 * Filtres combinés (purs, testés) : texte (titre, description, tags, carte ;
 * sans accents ni casse), carte, side, type, statut, tag, favoris. Par défaut
 * les entrées archivées sont masquées (`statut: 'tous'` les montre).
 */
export function filtrerPlaybook(entrees, f = {}) {
  const q = normaliser(f.q ?? '');
  const tag = normaliser(f.tag ?? '');
  return entrees.filter(e => {
    if (f.statut && f.statut !== 'tous') {
      if (e.statut !== f.statut) return false;
    } else if (!f.statut && e.statut === 'archivee') return false;
    if (f.carte && e.carte?.cle !== f.carte) return false;
    if (f.side && e.side !== f.side) return false;
    if (f.type && e.type !== f.type) return false;
    if (f.favoris && !e.favori) return false;
    if (tag && !e.tags.some(t => normaliser(t) === tag)) return false;
    if (q && !normaliser(`${e.titre} ${e.description} ${e.tags.join(' ')} ${e.carte?.nom ?? ''}`).includes(q)) return false;
    return true;
  });
}

/** Ordre de la grille : favoris d'abord, puis validées, brouillons, archivées ; puis les plus récentes. */
export function trierPlaybook(entrees) {
  const rang = { validee: 0, brouillon: 1, archivee: 2 };
  return [...entrees].sort((a, b) => Number(b.favori) - Number(a.favori) || rang[a.statut] - rang[b.statut] || (a.majLe < b.majLe ? 1 : a.majLe > b.majLe ? -1 : 0));
}

export function servicesPlaybook({ base, maintenant = () => Date.now(), socle, strats }) {
  const { contexteTeam } = socle;
  const peut = (ctx, p) => autorise(ctx.permissions, ctx.modules, p);

  function exiger(ctx, permission) {
    if (!ctx.modules.has(MODULE_PLAYBOOK)) throw echec(404, 'module-desactive', 'Ce module n’est pas activé pour cette team.');
    if (permission && !peut(ctx, permission)) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
  }

  async function entreeDeTeam(teamId, id) {
    if (typeof id !== 'string' || !MOTIF_UUID.test(id)) throw echec(404, 'entree-introuvable', 'Entrée introuvable.');
    const e = await base.premier('SELECT * FROM playbook_entrees WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [id, teamId]);
    if (!e) throw echec(404, 'entree-introuvable', 'Entrée introuvable.');
    return e;
  }

  /** Strat liée : de la même team, non supprimée, partagée avec la team. */
  async function stratLiable(teamId, stratId) {
    if (typeof stratId !== 'string' || !MOTIF_UUID.test(stratId)) throw echec(400, 'strat', 'Strat inconnue.');
    const s = await base.premier('SELECT * FROM strats WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [stratId, teamId]);
    if (!s) throw echec(400, 'strat', 'Strat inconnue dans cette team.');
    if (s.visibilite !== 'team') throw echec(400, 'strat-privee', 'Partagez d’abord cette strat avec la team.');
    return s;
  }

  async function entreesPubliques(ctx, lignes, origine) {
    const ids = [...new Set(lignes.map(l => l.strat_id).filter(Boolean))];
    const liees = new Map();
    // La strat liée n'apparaît que si le module Strats est actif (sa miniature reste celle du playbook).
    if (ids.length > 0 && ctx.modules.has(MODULE_STRATS)) {
      const strats = await lignesParIds(base, 'SELECT id, titre, miniature_id, visibilite, revision FROM strats WHERE team_id = ? AND supprime_le IS NULL AND id', ids, { paramsAvant: [ctx.team.id] });
      for (const s of strats) if (s.visibilite === 'team') liees.set(s.id, s);
    }
    const noms = await pseudosDe(base, lignes.flatMap(l => [l.cree_par, l.valide_par]));
    return Promise.all(
      lignes.map(async l => {
        const s = l.strat_id ? liees.get(l.strat_id) : undefined;
        return {
          id: l.id,
          jeu: l.jeu,
          titre: l.titre,
          carte: l.carte ? { cle: l.carte, nom: l.carte_nom ?? l.carte } : null,
          side: l.side ?? null,
          type: l.type,
          tags: jsonOu(l.tags, []),
          description: l.description,
          favori: Number(l.favori) === 1,
          statut: l.statut,
          strat: s ? { id: s.id, titre: s.titre, ouvrable: peut(ctx, 'strats.view') } : null,
          miniature: s ? await strats.lienMiniature(s.miniature_id, ctx.acteur.compte, origine) : null,
          validePar: l.valide_par ? { compte: l.valide_par, pseudo: noms[l.valide_par] ?? null } : null,
          valideLe: l.valide_le ?? null,
          creePar: { compte: l.cree_par, pseudo: noms[l.cree_par] ?? null },
          creeLe: l.cree_le,
          majLe: l.maj_le,
        };
      }),
    );
  }

  async function liste(acteur, teamId, filtres = {}, { origine } = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'playbook.view');
    for (const [cle, valides] of [['statut', [...STATUTS_PLAYBOOK, 'tous']], ['side', SIDES], ['type', TYPES_STRAT]]) {
      if (filtres[cle] && !valides.includes(filtres[cle])) throw echec(400, cle, `Filtre ${cle} inconnu.`);
    }
    const lignes = await base.tous('SELECT * FROM playbook_entrees WHERE team_id = ? AND supprime_le IS NULL ORDER BY maj_le DESC LIMIT 1000', [teamId]);
    const toutes = await entreesPubliques(ctx, lignes, origine);
    const entrees = trierPlaybook(filtrerPlaybook(toutes, filtres));
    // Facettes pour les filtres de l'app (sur toute la bibliothèque, archivées comprises).
    const cartes = [...new Map(toutes.filter(e => e.carte).map(e => [e.carte.cle, e.carte])).values()].sort((a, b) => a.nom.localeCompare(b.nom));
    const tags = [...new Set(toutes.flatMap(e => e.tags))].sort((a, b) => a.localeCompare(b, 'fr'));
    return { entrees, cartes, tags, total: toutes.length, gerer: peut(ctx, 'playbook.manage') };
  }

  async function lire(teamId, corps, partiel, entree) {
    const s = {};
    let strat;
    if (!partiel || corps?.stratId !== undefined) {
      if (corps?.stratId) {
        strat = await stratLiable(teamId, corps.stratId);
        s.strat_id = strat.id;
      } else s.strat_id = null;
    }
    if (!partiel || corps?.titre !== undefined) {
      s.titre = texteNettoye(corps?.titre ?? strat?.titre, 80);
      if (s.titre.length < 2) throw echec(400, 'titre', 'Titre : 2 caractères au moins.');
    }
    // Carte et side : ceux de la strat liée par défaut ; null : valable partout.
    if (!partiel || corps?.carte !== undefined || strat) {
      const c = corps?.carte !== undefined ? corps.carte : strat ? { cle: strat.carte, nom: strat.carte_nom } : null;
      if (c === null) {
        s.carte = null;
        s.carte_nom = null;
      } else {
        if (typeof c !== 'object' || !MOTIF_CARTE.test(c.cle ?? '')) throw echec(400, 'carte', 'Carte illisible.');
        s.carte = c.cle;
        s.carte_nom = texteNettoye(c.nom, 40) || c.cle;
      }
    }
    if (!partiel || corps?.side !== undefined || strat) {
      const side = corps?.side !== undefined ? corps.side : (strat?.side ?? null);
      if (side !== null && !SIDES.includes(side)) throw echec(400, 'side', 'Side : attaque ou défense.');
      s.side = side;
    }
    if (!partiel || corps?.type !== undefined) {
      const type = corps?.type ?? strat?.type ?? entree?.type ?? 'default';
      if (!TYPES_STRAT.includes(type)) throw echec(400, 'type', 'Type inconnu.');
      s.type = type;
    }
    if (!partiel || corps?.tags !== undefined) s.tags = JSON.stringify(tagsPropres(corps?.tags));
    if (!partiel || corps?.description !== undefined) s.description = texteLong(corps?.description, 4000);
    if (corps?.favori !== undefined) s.favori = corps.favori ? 1 : 0;
    if (corps?.statut !== undefined) {
      if (!STATUTS_PLAYBOOK.includes(corps.statut)) throw echec(400, 'statut', 'Statut : brouillon, validee ou archivee.');
      s.statut = corps.statut;
    }
    return s;
  }

  function evenementsStatut(ctx, id, titre, avant, apres, t, carte) {
    if (!apres || avant === apres) return [];
    const type = apres === 'validee' ? 'playbook.validated' : apres === 'archivee' ? 'playbook.archived' : 'playbook.updated';
    return [evenement(type, { teamId: ctx.team.id, acteur: ctx.acteur.compte, entiteType: 'playbook', entiteId: id, charge: { titre, de: avant, vers: apres, carte }, maintenant: t })];
  }

  async function creer(acteur, teamId, corps, { origine } = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'playbook.manage');
    if (corps?.stratId && !ctx.modules.has(MODULE_STRATS)) throw echec(400, 'strat', 'Le module Strats n’est pas activé.');
    const s = await lire(teamId, corps, false);
    const statut = s.statut ?? 'brouillon';
    const t = maintenant();
    const id = nouvelId();
    await base.lot([
      {
        sql: `INSERT INTO playbook_entrees (id, team_id, strat_id, jeu, titre, carte, carte_nom, side, type, tags, description, favori, statut, valide_par, valide_le, cree_par, cree_le, maj_le)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          id, teamId, s.strat_id, ctx.team.jeu === 'valorant' ? 'valorant' : 'autre', s.titre, s.carte, s.carte_nom, s.side, s.type, s.tags, s.description, s.favori ?? 0, statut,
          statut === 'validee' ? acteur.compte : null, statut === 'validee' ? iso(t) : null, acteur.compte, iso(t), iso(t),
        ],
      },
      evenement('playbook.created', { teamId, acteur: acteur.compte, entiteType: 'playbook', entiteId: id, charge: { titre: s.titre, strat: s.strat_id, statut }, maintenant: t }),
      ...evenementsStatut(ctx, id, s.titre, 'brouillon', statut, t, s.carte_nom),
    ]);
    return (await entreesPubliques(ctx, [await entreeDeTeam(teamId, id)], origine))[0];
  }

  async function modifier(acteur, teamId, id, corps, { origine } = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'playbook.manage');
    const e = await entreeDeTeam(teamId, id);
    const s = await lire(teamId, corps, true, e);
    const champs = Object.keys(s);
    if (champs.length > 0) {
      const t = maintenant();
      if (s.statut === 'validee' && e.statut !== 'validee') {
        s.valide_par = acteur.compte;
        s.valide_le = iso(t);
      }
      const cols = Object.keys(s);
      const titre = s.titre ?? e.titre;
      const statutChange = s.statut !== undefined && s.statut !== e.statut;
      await base.lot([
        { sql: `UPDATE playbook_entrees SET ${cols.map(c => `${c} = ?`).join(', ')}, maj_le = ? WHERE id = ?`, params: [...cols.map(c => s[c]), iso(t), id] },
        ...(statutChange
          ? evenementsStatut(ctx, id, titre, e.statut, s.statut, t, s.carte_nom ?? e.carte_nom)
          : [evenement('playbook.updated', { teamId, acteur: acteur.compte, entiteType: 'playbook', entiteId: id, charge: { titre, champs }, maintenant: t })]),
      ]);
    }
    return (await entreesPubliques(ctx, [await entreeDeTeam(teamId, id)], origine))[0];
  }

  async function supprimer(acteur, teamId, id) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'playbook.manage');
    const e = await entreeDeTeam(teamId, id);
    const t = maintenant();
    await base.lot([
      { sql: 'UPDATE playbook_entrees SET supprime_le = ?, maj_le = ? WHERE id = ?', params: [iso(t), iso(t), id] },
      evenement('playbook.deleted', { teamId, acteur: acteur.compte, entiteType: 'playbook', entiteId: id, charge: { titre: e.titre }, maintenant: t }),
    ]);
    return { ok: true };
  }

  return { liste, creer, modifier, supprimer };
}
