/**
 * Section CM, côté team (module `cm`) : page CM de la team, dépôt d'informations par le correspondant,
 * matchs et résultats publiables (pour lier un clip ou un post), pré-remplissage d'un post depuis le
 * résumé publiable (competition/resume.mjs), membres de la team (liens d'un post vers des joueurs).
 *
 * Le CM ne lit QUE ce qui est publiable : jamais un résultat « staff », un scrim non publiable, les notes,
 * le scouting détaillé ni les strats.
 */

import { lecteurTableaux } from './acces.mjs';
import { evenement } from '../evenements.mjs';
import { echec, iso, nouvelId, texteNettoye } from '../outils.mjs';
import { pseudosDe } from '../requetes.mjs';
import { NOTE_MAX, lienSur, nettoyerNote } from '../review/markdown.mjs';
import { lireLangue, texte as T } from '../langues.mjs';
import { resumeAnnonce, resumeResultat, resumeTournoi } from '../competition/resume.mjs';
import { contexteCm, exiger, exigerUuid, peut } from './commun.mjs';
import { assurerTableauDefaut, instructionsCarte, listeDeCle, positionFin } from './tableaux.mjs';
import { lireReglagesCm } from './droits.mjs';
import { CLES_RESEAUX } from './reseaux.mjs';

export const GENRES_DEPOT = Object.freeze(['info', 'photo', 'actu', 'recrue', 'resultat', 'evenement', 'autre']);
const MAX_LIENS_DEPOT = 5;
const MAX_FICHIERS_DEPOT = 5;

/** Textes d'un post pré-remplis depuis un résumé publiable (FR et EN, mêmes textes pour chaque réseau). */
export function textesDepuisResume({ fr, en, hashtags = '', reseaux = CLES_RESEAUX, prefixe = null }) {
  const compose = (r, langue) => {
    const tete = prefixe ? T(langue, `cm.prefixe.${prefixe}`) : '';
    const corps = r ? `${r.team?.nom ? `${r.team.nom} · ` : ''}${r.phrase ?? r.phraseFinal ?? ''}` : '';
    return [tete ? `${tete} ${corps}` : corps, hashtags.trim()].filter(Boolean).join('\n\n');
  };
  return Object.fromEntries(reseaux.map(x => [x, { fr: compose(fr, 'fr'), en: compose(en, 'en') }]));
}

export function servicesEquipeCm({ base, maintenant = () => Date.now(), medias }) {
  async function ctxTeam(acteur, teamId) {
    exigerUuid(teamId, 'team');
    return contexteCm(base, acteur, teamId);
  }

  /** `GET /cm/teams/:t` : la partie CM de la team (droits, tableaux, derniers dépôts, mes clips). */
  async function page(acteur, teamId) {
    const ctx = await ctxTeam(acteur, teamId);
    if (!['cm.voir', 'cm.deposer', 'cm.clips.proposer'].some(p => peut(ctx, p))) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const t = maintenant();
    if (peut(ctx, 'cm.voir') || peut(ctx, 'cm.deposer')) await assurerTableauDefaut(base, teamId, t);
    const lecteur = lecteurTableaux(base, acteur);
    // Tableaux restreints dont l'acteur n'est pas (migration 0046) : ni le tableau ni les dépôts qui y sont passés.
    const lignes = peut(ctx, 'cm.voir') ? await lecteur.filtrer(await base.tous('SELECT * FROM cm_tableaux WHERE portee = ? AND supprime_le IS NULL AND archive_le IS NULL ORDER BY cle_defaut, position, cree_le', [teamId])) : [];
    const interdits = new Set(await lecteur.interdits());
    // Sans cm.voir (dépôt seulement) : ses propres dépôts.
    const condition = peut(ctx, 'cm.voir') ? '' : 'AND c.cree_par = ?';
    const depots = peut(ctx, 'cm.voir') || peut(ctx, 'cm.deposer')
      ? await base.tous(
          `SELECT c.id, c.titre, c.depot_genre, c.cree_par, c.cree_le, c.statut, c.post, c.tableau_id, l.nom AS liste_nom, l.cle AS liste_cle FROM cm_cartes c JOIN cm_tableaux t ON t.id = c.tableau_id JOIN cm_listes l ON l.id = c.liste_id
            WHERE t.portee = ? AND c.origine = 'depot' AND c.supprime_le IS NULL ${condition} ORDER BY c.cree_le DESC LIMIT 30`,
          peut(ctx, 'cm.voir') ? [teamId] : [teamId, acteur.compte],
        )
      : [];
    const depotsVus = depots.filter(d => !interdits.has(d.tableau_id));
    const noms = await pseudosDe(base, depotsVus.map(d => d.cree_par).filter(Boolean));
    return {
      team: { id: ctx.team.id, nom: ctx.team.nom, slug: ctx.team.slug, logoUrl: ctx.team.logo_url ?? null, fuseau: ctx.team.fuseau },
      permissions: [...ctx.permissions].sort(),
      tableaux: lignes.map(t => ({ id: t.id, nom: t.nom ?? null, cleDefaut: t.cle_defaut ?? null, couleur: t.couleur, version: Number(t.version), acces: t.acces === 'restreint' ? 'restreint' : 'tous' })),
      depots: depotsVus.map(d => ({ id: d.id, titre: d.titre, genre: d.depot_genre ?? 'autre', auteur: d.cree_par ?? null, creeLe: d.cree_le, statut: d.statut ?? null, liste: { nom: d.liste_nom ?? null, cle: d.liste_cle ?? null }, tableauId: d.tableau_id })),
      noms,
      genres: [...GENRES_DEPOT],
    };
  }

  /**
   * `POST /cm/teams/:t/depots` `{ genre, titre, description, liens: [url], envois: [id] }` : le correspondant
   * dépose une information (actu, photo, recrue…) : une carte arrive dans « Idées » du tableau CM de la team,
   * avec ses liens et fichiers en pièces jointes. Le CM commun est prévenu.
   */
  async function deposer(acteur, teamId, corps) {
    const ctx = await ctxTeam(acteur, teamId);
    exiger(ctx, 'cm.deposer');
    const genre = GENRES_DEPOT.includes(corps?.genre) ? corps.genre : 'autre';
    const titre = texteNettoye(corps?.titre, 200);
    if (titre.length < 2) throw echec(400, 'titre', 'Titre : 2 caractères au moins.');
    const description = nettoyerNote(corps?.description ?? '', NOTE_MAX);
    const liens = Array.isArray(corps?.liens) ? corps.liens.map(u => String(u ?? '').trim()).filter(Boolean) : [];
    if (liens.length > MAX_LIENS_DEPOT || liens.some(u => u.length > 2000 || !/^https:\/\//i.test(u) || !lienSur(u))) throw echec(400, 'lien', 'Adresse invalide : https://… sans espace (5 au plus).');
    const envois = Array.isArray(corps?.envois) ? corps.envois : [];
    if (envois.length > MAX_FICHIERS_DEPOT) throw echec(400, 'envois', `${MAX_FICHIERS_DEPOT} fichiers au plus.`);
    const t = maintenant();
    const tableau = await assurerTableauDefaut(base, teamId, t);
    const liste = (await listeDeCle(base, tableau.id, 'idees')) ?? (await base.premier('SELECT * FROM cm_listes WHERE tableau_id = ? AND archive_le IS NULL ORDER BY position LIMIT 1', [tableau.id]));
    if (!liste) throw echec(409, 'liste-absente', 'Le tableau de la team n’a plus de liste ouverte.');
    const { id, instructions } = instructionsCarte({ tableauId: tableau.id, listeId: liste.id, teamId, titre, description, position: await positionFin(base, liste.id), origine: 'depot', depotGenre: genre, acteur: acteur.compte, t });
    const lot = [...instructions];
    for (const url of liens) lot.push({ sql: "INSERT INTO cm_pieces (id, carte_id, genre, nom, url, cree_par, cree_le) VALUES (?, ?, 'lien', ?, ?, ?, ?)", params: [nouvelId(), id, url.slice(0, 140), url, acteur.compte, iso(t)] });
    for (const envoi of envois) {
      if (!medias) throw echec(503, 'stockage-absent', 'Le stockage des fichiers n’est pas branché sur le serveur Esport.');
      const pieceId = nouvelId();
      const r = await medias.preparerRattachement({ acteur, team: { id: teamId }, portee: teamId }, envoi, 'cm', { entiteType: 'cm_piece', entiteId: pieceId });
      lot.push(...r.instructions, { sql: "INSERT INTO cm_pieces (id, carte_id, genre, nom, fichier_id, cree_par, cree_le) VALUES (?, ?, 'fichier', ?, ?, ?, ?)", params: [pieceId, id, r.envoi.nom_original, r.fichierId, acteur.compte, iso(t)] });
    }
    lot.push(evenement('cm.depot', { teamId, acteur: acteur.compte, entiteType: 'cm_carte', entiteId: id, charge: { titre, genre, tableau: tableau.id }, maintenant: t }));
    await base.lot(lot);
    return { id, tableauId: tableau.id };
  }

  /** `GET /cm/teams/:t/matchs` : matchs de tournoi et résultats PUBLIABLES de la team (lier un clip ou un post). */
  async function matchs(acteur, teamId, { langue } = {}) {
    const ctx = await ctxTeam(acteur, teamId);
    exiger(ctx, 'cm.voir', 'cm.clips.proposer', 'cm.deposer');
    const lng = lireLangue(langue) ?? acteur.langue ?? 'fr';
    const resultats = await base.tous("SELECT id FROM resultats WHERE team_id = ? AND supprime_le IS NULL AND visibilite = 'team' AND publiable = 1 ORDER BY date_match DESC LIMIT 30", [teamId]);
    const parcours = await base.tous(
      "SELECT m.id FROM tournoi_matchs m JOIN tournois t ON t.id = m.tournoi_id WHERE m.team_id = ? AND m.supprime_le IS NULL AND t.supprime_le IS NULL AND t.publiable = 1 AND m.debut IS NOT NULL ORDER BY m.debut DESC LIMIT 30",
      [teamId],
    );
    const tournois = await base.tous("SELECT id FROM tournois WHERE team_id = ? AND supprime_le IS NULL AND publiable = 1 AND statut <> 'annule' ORDER BY debut DESC LIMIT 20", [teamId]);
    const sortieR = [];
    for (const r of resultats) {
      const x = await resumeResultat(base, teamId, r.id, { langue: lng });
      if (x?.publiable) sortieR.push({ id: x.id, titre: x.titre, phrase: x.phrase, date: x.date });
    }
    const sortieM = [];
    for (const m of parcours) {
      const x = await resumeAnnonce(base, teamId, m.id, { langue: lng });
      if (x) sortieM.push({ id: x.id, titre: x.titre, adversaires: x.adversaires.map(a => a.nom), debut: x.debut, tournoiId: x.tournoi.id });
    }
    const sortieT = [];
    for (const t of tournois) {
      const x = await resumeTournoi(base, teamId, t.id, { langue: lng });
      if (x?.publiable) sortieT.push({ id: x.id, nom: x.nom, debut: x.debut, statut: x.statut });
    }
    return { resultats: sortieR, matchs: sortieM, tournois: sortieT };
  }

  /**
   * `GET /cm/teams/:t/resume?genre=resultat|annonce|tournoi&id=` : résumé publiable en français ET en anglais,
   * et des textes de post pré-remplis (cm.editer). 409 si ce n'est pas publiable (staff, scrim non publiable…).
   */
  async function prerempli(acteur, teamId, { genre, id, prefixe } = {}) {
    const ctx = await ctxTeam(acteur, teamId);
    exiger(ctx, 'cm.editer');
    exigerUuid(id, 'element');
    const lire = { resultat: resumeResultat, annonce: resumeAnnonce, tournoi: resumeTournoi }[genre];
    if (!lire) throw echec(400, 'genre', 'Genre inconnu (resultat, annonce, tournoi).');
    const [fr, en] = [await lire(base, teamId, id, { langue: 'fr' }), await lire(base, teamId, id, { langue: 'en' })];
    if (!fr) throw echec(404, 'element-introuvable', 'Introuvable.');
    if (!fr.publiable) throw echec(409, 'non-publiable', 'Ce contenu n’est pas publiable (réservé au staff, scrim non publiable, annulé…).');
    const reglages = (await lireReglagesCm(base)).suggestions;
    const phraseTournoi = (r, lng) => (r ? { ...r, phrase: r.texteClassement ? r.phraseFinal : r.phraseInscription, langue: lng } : r);
    const resumes = genre === 'tournoi' ? { fr: phraseTournoi(fr, 'fr'), en: phraseTournoi(en, 'en') } : { fr, en };
    const pref = ['j1', 'jourj'].includes(prefixe) ? prefixe : null;
    return {
      fr: resumes.fr,
      en: resumes.en,
      titre: fr.titre ?? fr.nom,
      textes: textesDepuisResume({ ...resumes, hashtags: reglages.hashtags, reseaux: CLES_RESEAUX, prefixe: pref }),
      liens: { teamId, ...(genre === 'resultat' ? { resultatId: id } : genre === 'annonce' ? { matchId: id, tournoiId: fr.tournoi?.id } : { tournoiId: id }) },
    };
  }

  /** `GET /cm/teams/:t/membres` : pseudos des membres actifs (lier un post à des joueurs). */
  async function membres(acteur, teamId) {
    const ctx = await ctxTeam(acteur, teamId);
    exiger(ctx, 'cm.voir', 'cm.editer');
    const lignes = await base.tous("SELECT m.compte_id, c.pseudo FROM membres m JOIN comptes c ON c.id = m.compte_id WHERE m.team_id = ? AND m.statut = 'actif' ORDER BY c.pseudo_cle", [teamId]);
    return { membres: lignes.map(l => ({ compte: l.compte_id, pseudo: l.pseudo })) };
  }

  return { page, deposer, matchs, prerempli, membres };
}
