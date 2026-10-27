/**
 * « Résumé publiable » d'un résultat, d'une annonce de match ou d'un tournoi : données propres (noms,
 * scores, maps, roster, classement), phrase courte en français ou en anglais et indicateur `publiable`.
 *
 * Service réutilisable : les embeds Discord (annonce de match, résultat, classement final) en sont
 * tirés, et la future section CM (annonces, visuels) s'appuiera dessus sans relire les tables. Ne
 * contrôle AUCUN droit : l'appelant (route avec permission, ou file Discord pour un message que la team
 * a choisi de publier) décide. Rien de « staff » n'est publiable (résultat staff : `publiable: false`).
 */

import { jsonOu } from '../outils.mjs';
import { lignesParIds, pseudosDe } from '../requetes.mjs';
import { libelleFormat } from '../jeux/schema.mjs';
import { localeIntl, texte as T } from '../langues.mjs';
import { formaterInstant } from '../discord/formats.mjs';
import { adversairesAffiches, adversairesParId, profilDuJeu } from './commun.mjs';
import { scoreCourt } from './score.mjs';

/** Rang lisible : « 1er », « 2e » (« 1re » au féminin) ; « 1st », « 2nd », « 3rd », « 11th ». */
export function ordinal(n, langue = 'fr', { feminin = false } = {}) {
  if (!Number.isInteger(n)) return '';
  if (langue === 'en') {
    const d = n % 10;
    const c = n % 100;
    const suffixe = c >= 11 && c <= 13 ? 'th' : d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th';
    return `${n}${suffixe}`;
  }
  return n === 1 ? (feminin ? '1re' : '1er') : `${n}e`;
}

/** Montant en centimes → « 1 500,00 € » / « €1,500.00 ». */
export function montant(centimes, devise = 'EUR', langue = 'fr') {
  if (centimes === null || centimes === undefined) return '';
  try {
    return new Intl.NumberFormat(localeIntl(langue), { style: 'currency', currency: devise }).format(Number(centimes) / 100);
  } catch {
    return `${(Number(centimes) / 100).toFixed(2)} ${devise}`;
  }
}

const libelleIssue = (issue, forfait, langue) => {
  const base = issue ? T(langue, `competition.issue.${issue}`) : '';
  return forfait && base ? T(langue, 'competition.forfait', { issue: base }) : base;
};

const nomsAdversaires = a => a.map(x => x.nom).filter(Boolean).slice(0, 4).join(', ') + (a.length > 4 ? '…' : '');

async function teamDe(base, teamId) {
  const t = await base.premier('SELECT id, nom, logo_url, fuseau FROM teams WHERE id = ? AND supprimee_le IS NULL', [teamId]);
  return t ? { id: t.id, nom: t.nom, logo: t.logo_url ?? null, fuseau: t.fuseau } : null;
}

/** Résumé d'un résultat (null s'il n'existe pas ou plus). */
export async function resumeResultat(base, teamId, id, { langue = 'fr' } = {}) {
  const r = await base.premier('SELECT * FROM resultats WHERE id = ? AND team_id = ?', [id, teamId]);
  const team = r ? await teamDe(base, teamId) : null;
  if (!r || !team) return null;
  const profil = await profilDuJeu(base, r.jeu);
  const manches = await base.tous('SELECT * FROM resultat_manches WHERE resultat_id = ? AND team_id = ? ORDER BY numero', [id, teamId]);
  const joueurs = await base.tous('SELECT * FROM resultat_joueurs WHERE resultat_id = ? AND team_id = ? ORDER BY position', [id, teamId]);
  const pseudos = await pseudosDe(base, [...joueurs.map(j => j.compte_id), r.mvp_id].filter(Boolean));
  const fiches = await adversairesParId(base, teamId, jsonOu(r.adversaires, []).map(a => a.id).filter(Boolean));
  const adversaires = adversairesAffiches(jsonOu(r.adversaires, []), fiches);
  const tournoi = r.tournoi_id ? await base.premier('SELECT id, nom, lien, supprime_le FROM tournois WHERE id = ? AND team_id = ?', [r.tournoi_id, teamId]) : null;
  const match = r.tournoi_match_id ? await base.premier('SELECT tour FROM tournoi_matchs WHERE id = ? AND team_id = ?', [r.tournoi_match_id, teamId]) : null;
  const persos = new Map(profil.donnees.personnages.map(p => [p.cle, p.nom]));
  const detail = jsonOu(r.score, {}).manches ?? [];
  const lesManches = manches.map(m => {
    const d = detail.find(x => x.numero === Number(m.numero))?.detail ?? {};
    const nous = m.score_nous === null ? null : Number(m.score_nous);
    const eux = m.score_eux === null ? null : Number(m.score_eux);
    return {
      numero: Number(m.numero),
      carte: m.carte_nom || null,
      mode: m.mode_nom || null,
      issue: m.issue ?? null,
      score: nous !== null && eux !== null ? `${nous}-${eux}` : '',
      prolongations: Boolean(d.enProlongations),
      place: m.place === null ? null : Number(m.place),
      points: m.points === null ? null : Number(m.points),
    };
  });
  const score = scoreCourt({ systeme: r.systeme, bo: Number(r.bo), forfait: r.forfait, manches: lesManches.map(m => ({ nous: m.score ? Number(m.score.split('-')[0]) : null, eux: m.score ? Number(m.score.split('-')[1]) : null })), manchesNous: r.manches_nous === null ? null : Number(r.manches_nous), manchesEux: r.manches_eux === null ? null : Number(r.manches_eux), place: r.place });
  const place = r.place === null ? null : Number(r.place);
  const participants = r.participants === null ? null : Number(r.participants);
  const issue = libelleIssue(r.issue, r.forfait, langue);
  const adv = nomsAdversaires(adversaires);
  let phrase;
  if (r.systeme === 'classement') {
    phrase = T(langue, 'competition.phrase.classement', { place: ordinal(place, langue, { feminin: true }) });
    if (participants) phrase = `${phrase} (${T(langue, 'competition.place_sur', { place: ordinal(place, langue), n: participants })})`;
  } else phrase = adv ? T(langue, 'competition.phrase.serie', { issue, score, adversaire: adv }) : T(langue, 'competition.phrase.serie_seule', { issue, score });
  const quand = formaterInstant(team.fuseau, r.date_match, langue);
  return {
    genre: 'resultat',
    id: r.id,
    publiable: Number(r.publiable) === 1 && r.visibilite === 'team' && !r.supprime_le,
    supprime: Boolean(r.supprime_le),
    genreMatch: r.genre,
    libelleGenre: T(langue, `competition.genre.${r.genre}`),
    date: r.date_match,
    quand,
    team,
    jeu: { cle: profil.cle, nom: profil.nom, couleur: profil.couleur, base: profil.base },
    format: (() => {
      const f = profil.donnees.formats.find(x => x.cle === r.format_cle);
      return f ? { nom: f.nom, libelle: libelleFormat(f) } : null;
    })(),
    tournoi: tournoi && !tournoi.supprime_le ? { id: tournoi.id, nom: tournoi.nom, lien: tournoi.lien ?? null } : null,
    tour: match?.tour || null,
    adversaires,
    systeme: r.systeme,
    bo: r.bo === null ? null : Number(r.bo),
    issue: r.issue ?? null,
    libelleIssue: issue,
    forfait: r.forfait ?? null,
    place,
    libellePlace: place ? ordinal(place, langue) : null,
    participants,
    points: r.points === null ? null : Number(r.points),
    score,
    manches: lesManches,
    mvp: r.mvp_id ? (pseudos[r.mvp_id] ?? null) : null,
    joueurs: joueurs.filter(j => j.compte_id).map(j => ({ pseudo: pseudos[j.compte_id] ?? null, personnages: jsonOu(j.personnages, []).map(p => persos.get(p) ?? p) })),
    titre: [tournoi && !tournoi.supprime_le ? tournoi.nom : T(langue, `competition.genre.${r.genre}`), match?.tour || null].filter(Boolean).join(' · '),
    phrase,
  };
}

/** Résumé d'un match de tournoi à venir (annonce) ; null s'il n'existe plus. */
export async function resumeAnnonce(base, teamId, matchId, { langue = 'fr' } = {}) {
  const m = await base.premier('SELECT * FROM tournoi_matchs WHERE id = ? AND team_id = ?', [matchId, teamId]);
  const tournoi = m ? await base.premier('SELECT * FROM tournois WHERE id = ? AND team_id = ?', [m.tournoi_id, teamId]) : null;
  const team = tournoi ? await teamDe(base, teamId) : null;
  if (!m || !tournoi || !team) return null;
  const profil = await profilDuJeu(base, tournoi.jeu);
  const fiches = await adversairesParId(base, teamId, jsonOu(m.adversaires, []).map(a => a.id).filter(Boolean));
  const adversaires = adversairesAffiches(jsonOu(m.adversaires, []), fiches);
  const roster = await base.tous("SELECT r.compte_id, c.pseudo FROM tournoi_roster r LEFT JOIN comptes c ON c.id = r.compte_id WHERE r.tournoi_id = ? AND r.role = 'titulaire' ORDER BY r.position", [tournoi.id]);
  const f = profil.donnees.formats.find(x => x.cle === tournoi.format_cle);
  const titre = [tournoi.nom, m.tour || null].filter(Boolean).join(' · ');
  const quand = m.debut ? formaterInstant(team.fuseau, m.debut, langue) : { date: '', heure: '' };
  const adv = nomsAdversaires(adversaires);
  return {
    genre: 'annonce',
    id: m.id,
    publiable: Number(tournoi.publiable) === 1 && !tournoi.supprime_le && !m.supprime_le && m.statut === 'a_jouer' && tournoi.statut !== 'annule' && Boolean(m.debut),
    team,
    jeu: { cle: profil.cle, nom: profil.nom, couleur: profil.couleur, base: profil.base },
    tournoi: { id: tournoi.id, nom: tournoi.nom, lien: tournoi.lien ?? null },
    tour: m.tour || null,
    debut: m.debut ?? null,
    fin: m.fin ?? null,
    quand,
    bo: m.bo === null ? (tournoi.bo === null ? null : Number(tournoi.bo)) : Number(m.bo),
    format: f ? { nom: f.nom, libelle: libelleFormat(f) } : null,
    lieu: Number(tournoi.en_ligne) === 1 ? T(langue, 'competition.en_ligne') : tournoi.lieu,
    adversaires,
    roster: roster.map(r => r.pseudo).filter(Boolean),
    titre,
    phrase: adv ? T(langue, 'competition.phrase.annonce', { titre, adversaire: adv, date: quand.date, heure: quand.heure }) : T(langue, 'competition.phrase.annonce_seule', { titre, date: quand.date, heure: quand.heure }),
  };
}

/** Résumé d'un tournoi (inscription, classement final, parcours) ; null s'il n'existe plus. */
export async function resumeTournoi(base, teamId, tournoiId, { langue = 'fr' } = {}) {
  const t = await base.premier('SELECT * FROM tournois WHERE id = ? AND team_id = ?', [tournoiId, teamId]);
  const team = t ? await teamDe(base, teamId) : null;
  if (!t || !team) return null;
  const profil = await profilDuJeu(base, t.jeu);
  const roster = await base.tous('SELECT r.role, c.pseudo FROM tournoi_roster r LEFT JOIN comptes c ON c.id = r.compte_id WHERE r.tournoi_id = ? ORDER BY r.role DESC, r.position', [t.id]);
  const matchs = await base.tous('SELECT * FROM tournoi_matchs WHERE tournoi_id = ? AND team_id = ? AND supprime_le IS NULL ORDER BY ordre, debut', [t.id, teamId]);
  const fiches = await adversairesParId(base, teamId, matchs.flatMap(m => jsonOu(m.adversaires, []).map(a => a.id)).filter(Boolean));
  // Résultats détaillés publiables seulement (un résultat staff ne sort pas : résultat rapide à la place).
  const resultats = new Map(
    (await lignesParIds(base, 'SELECT * FROM resultats WHERE team_id = ? AND supprime_le IS NULL AND id', matchs.map(m => m.resultat_id).filter(Boolean), { paramsAvant: [teamId] }))
      .filter(r => r.visibilite === 'team')
      .map(r => [r.id, r]),
  );
  const parcours = matchs
    .filter(m => m.statut !== 'annule')
    .map(m => {
      const r = m.resultat_id ? resultats.get(m.resultat_id) : null;
      const issue = r ? r.issue : m.issue === 'forfait_pour' ? 'victoire' : m.issue === 'forfait_contre' ? 'defaite' : (m.issue ?? null);
      const sc = r ? scoreCourt({ systeme: r.systeme, bo: Number(r.bo), forfait: r.forfait, manches: jsonOu(r.score, {}).manches ?? [], manchesNous: r.manches_nous === null ? null : Number(r.manches_nous), manchesEux: r.manches_eux === null ? null : Number(r.manches_eux), place: r.place }) : m.score_texte;
      const place = r ? (r.place === null ? null : Number(r.place)) : m.place === null ? null : Number(m.place);
      return { tour: m.tour || null, debut: m.debut ?? null, adversaires: adversairesAffiches(jsonOu(m.adversaires, []), fiches), issue, libelleIssue: libelleIssue(issue, r ? r.forfait : m.issue?.startsWith('forfait') ? 'oui' : null, langue), score: sc || '', place };
    });
  const classement = t.classement_final === null ? null : Number(t.classement_final);
  const participants = t.participants === null ? null : Number(t.participants);
  const f = profil.donnees.formats.find(x => x.cle === t.format_cle);
  const texteClassement = classement ? (participants ? T(langue, 'competition.place_sur', { place: ordinal(classement, langue), n: participants }) : ordinal(classement, langue)) : null;
  const bilanParcours = { victoires: parcours.filter(p => p.issue === 'victoire').length, defaites: parcours.filter(p => p.issue === 'defaite').length, nuls: parcours.filter(p => p.issue === 'nul').length };
  return {
    genre: 'tournoi',
    id: t.id,
    publiable: Number(t.publiable) === 1 && !t.supprime_le,
    supprime: Boolean(t.supprime_le),
    team,
    jeu: { cle: profil.cle, nom: profil.nom, couleur: profil.couleur, base: profil.base },
    nom: t.nom,
    organisateur: t.organisateur || null,
    lien: t.lien ?? null,
    debut: t.debut ?? null,
    fin: t.fin ?? null,
    enLigne: Number(t.en_ligne) === 1,
    lieu: Number(t.en_ligne) === 1 ? T(langue, 'competition.en_ligne') : t.lieu || null,
    format: f ? { nom: f.nom, libelle: libelleFormat(f) } : null,
    statut: t.statut,
    classementFinal: classement,
    participants,
    texteClassement,
    gains: t.gains_centimes === null ? null : montant(t.gains_centimes, t.devise, langue),
    cashprize: t.cashprize_centimes === null ? null : montant(t.cashprize_centimes, t.devise, langue),
    roster: roster.filter(r => r.pseudo).map(r => ({ pseudo: r.pseudo, role: r.role })),
    parcours,
    bilan: bilanParcours,
    titre: t.nom,
    phraseInscription: T(langue, 'competition.phrase.inscription', { tournoi: t.nom }),
    phraseFinal: texteClassement ? T(langue, 'competition.phrase.final', { tournoi: t.nom, classement: texteClassement }) : T(langue, 'competition.phrase.final_sans_place', { tournoi: t.nom }),
  };
}
