/**
 * Section CM : suggestions automatiques. Abonné du bus (événements existants des modules Tournois et
 * Résultats) qui propose des POSTS BROUILLON dans la liste « Idées » du tableau « Contenus » du club, avec
 * des textes FR / EN pré-remplis depuis le résumé publiable (competition/resume.mjs) :
 *
 *  - tournoi créé (`tournoi.cree`)                 → annonce de la participation ;
 *  - match de tournoi daté (`tournoi.match_planifie`) → annonce J-1 (la veille) et jour J (3 h avant) ;
 *  - résultat saisi (`match.resultat_saisi`)        → résultat ;
 *  - tournoi terminé (`tournoi.termine`)            → classement final.
 *
 * Seulement pour une team dont le module CM est activé, si les suggestions sont actives (Réglages de la
 * section, type par type), et si le contenu est PUBLIABLE (jamais un résultat staff ni un scrim non
 * publiable). Une seule carte par élément et par type (`origine_cle`, unique) ; tant que personne ne l'a
 * retouchée (`auto`), elle suit le match (redaté : nouvelles dates et textes ; supprimé : archivée).
 */

import { iso } from '../outils.mjs';
import { texte as T } from '../langues.mjs';
import { resumeAnnonce, resumeResultat, resumeTournoi } from '../competition/resume.mjs';
import { MODULE_CM, PORTEE_CLUB, activite, versionTableau } from './commun.mjs';
import { assurerTableauDefaut, instructionsCarte, listeDeCle, positionFin } from './tableaux.mjs';
import { lireReglagesCm } from './droits.mjs';
import { textesDepuisResume } from './equipe.mjs';

export const TYPES_DECLENCHEURS = Object.freeze(['tournoi.cree', 'tournoi.match_planifie', 'tournoi.match_supprime', 'match.resultat_saisi', 'match.resultat_supprime', 'tournoi.termine']);
const HEURE = 3_600_000;

async function moduleActif(base, teamId) {
  const l = await base.premier('SELECT active FROM team_modules WHERE team_id = ? AND module = ?', [teamId, MODULE_CM]);
  return Boolean(l && Number(l.active) === 1);
}

/** Crée la suggestion, ou met à jour celle que personne n'a retouchée. */
async function poser(base, { cle, titre, textes, liens, teamId, datePublication, reseaux }, t) {
  const existant = await base.premier('SELECT * FROM cm_cartes WHERE origine_cle = ?', [cle]);
  if (existant) {
    if (Number(existant.auto) !== 1 || existant.statut !== 'brouillon' || existant.supprime_le) return;
    await base.lot([
      { sql: 'UPDATE cm_cartes SET titre = ?, textes = ?, liens = ?, date_publication = ?, archive_le = NULL, version = version + 1, maj_le = ? WHERE id = ? AND auto = 1', params: [titre, JSON.stringify(textes), JSON.stringify(liens), datePublication, iso(t), existant.id] },
      versionTableau(existant.tableau_id, t),
    ]);
    return;
  }
  const tableau = await assurerTableauDefaut(base, PORTEE_CLUB, t);
  const liste = (await listeDeCle(base, tableau.id, 'idees')) ?? (await base.premier('SELECT * FROM cm_listes WHERE tableau_id = ? AND archive_le IS NULL ORDER BY position LIMIT 1', [tableau.id]));
  if (!liste) return;
  const { id, instructions } = instructionsCarte({ tableauId: tableau.id, listeId: liste.id, teamId, titre, position: await positionFin(base, liste.id), post: true, reseaux, textes, liens, datePublication, origine: 'suggestion', origineCle: cle, auto: true, terminee: Number(liste.fin) === 1, t });
  // Insertion seule d'abord (deux distributions du même événement : la seconde ne fait rien).
  const [premiere, ...reste] = instructions;
  const r = await base.executer(`${premiere.sql} ON CONFLICT DO NOTHING`, premiere.params);
  if (r.changements === 1) await base.lot([...reste.filter(x => !x.sql.startsWith('INSERT INTO cm_activite')), activite(id, tableau.id, null, 'suggestion', { cle: cle.split(':')[0] }, t)]);
}

async function archiver(base, cles, t) {
  for (const cle of cles) {
    const c = await base.premier("SELECT id, tableau_id FROM cm_cartes WHERE origine_cle = ? AND auto = 1 AND statut = 'brouillon' AND supprime_le IS NULL AND archive_le IS NULL", [cle]);
    if (c) await base.lot([{ sql: 'UPDATE cm_cartes SET archive_le = ?, version = version + 1 WHERE id = ?', params: [iso(t), c.id] }, versionTableau(c.tableau_id, t)]);
  }
}

export async function abonneCmSuggestions(base, ev) {
  if (!TYPES_DECLENCHEURS.includes(ev.type) || !ev.team_id || !ev.entite_id) return;
  if (!(await moduleActif(base, ev.team_id))) return;
  const reglages = (await lireReglagesCm(base)).suggestions;
  if (!reglages.actif) return;
  const t = Date.parse(ev.cree_le) || Date.now();
  const teamId = ev.team_id;
  const id = ev.entite_id;
  const commun = { teamId, reseaux: reglages.reseaux };
  const textes = (fr, en, prefixe) => textesDepuisResume({ fr, en, hashtags: reglages.hashtags, reseaux: reglages.reseaux, prefixe });

  if (ev.type === 'tournoi.match_supprime') return archiver(base, [`j1:${id}`, `jourj:${id}`], t);
  if (ev.type === 'match.resultat_supprime') return archiver(base, [`resultat:${id}`], t);

  if (ev.type === 'tournoi.cree' || ev.type === 'tournoi.termine') {
    const type = ev.type === 'tournoi.cree' ? 'tournoi' : 'final';
    if (!reglages.types[type]) return;
    const [fr, en] = [await resumeTournoi(base, teamId, id, { langue: 'fr' }), await resumeTournoi(base, teamId, id, { langue: 'en' })];
    if (!fr?.publiable || (type === 'final' && !fr.texteClassement)) return;
    const phrase = (r, lng) => ({ ...r, phrase: type === 'final' ? r.phraseFinal : r.phraseInscription, langue: lng });
    return poser(base, { ...commun, cle: `${type}:${id}`, titre: T('fr', `cm.suggestion.${type}`, { nom: fr.nom }), textes: textes(phrase(fr, 'fr'), phrase(en, 'en')), liens: { teamId, tournoiId: id }, datePublication: null }, t);
  }

  if (ev.type === 'match.resultat_saisi') {
    if (!reglages.types.resultat) return;
    const [fr, en] = [await resumeResultat(base, teamId, id, { langue: 'fr' }), await resumeResultat(base, teamId, id, { langue: 'en' })];
    if (!fr?.publiable) return;
    return poser(base, { ...commun, cle: `resultat:${id}`, titre: T('fr', 'cm.suggestion.resultat', { titre: fr.titre, phrase: fr.phrase }), textes: textes(fr, en), liens: { teamId, resultatId: id, ...(fr.tournoi ? { tournoiId: fr.tournoi.id } : {}) }, datePublication: null }, t);
  }

  // Match de tournoi daté (ou redaté) : annonce de la veille et du jour même, si le match est à venir.
  const [fr, en] = [await resumeAnnonce(base, teamId, id, { langue: 'fr' }), await resumeAnnonce(base, teamId, id, { langue: 'en' })];
  if (!fr?.publiable || !fr.debut) return;
  const debut = Date.parse(fr.debut);
  if (!Number.isFinite(debut) || debut <= t) return;
  const liens = { teamId, matchId: id, tournoiId: fr.tournoi.id };
  if (reglages.types.j1) await poser(base, { ...commun, cle: `j1:${id}`, titre: T('fr', 'cm.suggestion.j1', { titre: fr.titre }), textes: textes(fr, en, 'j1'), liens, datePublication: iso(Math.max(t, debut - 24 * HEURE)) }, t);
  if (reglages.types.jourj) await poser(base, { ...commun, cle: `jourj:${id}`, titre: T('fr', 'cm.suggestion.jourj', { titre: fr.titre }), textes: textes(fr, en, 'jourj'), liens, datePublication: iso(Math.max(t, debut - 3 * HEURE)) }, t);
}
