/**
 * Visuels CM : DONNÉES d'un visuel (valeurs des champs dynamiques « {adversaire} », « {score} »… et des
 * listes), en français ET en anglais, tirées des résumés publiables (competition/resume.mjs), des membres
 * (pseudos seulement) et de la charte (logos). Ne contrôle AUCUN droit : le service vérifie la portée, la
 * permission et que le contenu est publiable avant d'appeler.
 *
 * Sources (`{ genre, teamId, id, date }`) :
 *   resultat  un résultat (série : score + détail des maps / manches ; classement : place, points, classement
 *             des équipes) ;            annonce   un match de tournoi à venir (date, heure, fuseau, roster) ;
 *   tournoi   un tournoi (inscription, parcours, classement final) ; membre  un membre (recrue, départ, MVP) ;
 *   equipe    le roster actuel d'une team ;   semaine   le programme d'une semaine (matchs de tournoi publiables) ;
 *   libre     rien que la team / le club.
 *
 * Rend `{ systeme, fr: { champs, listes }, en: { champs, listes }, images, empreinte }`. Les images sont des
 * RÉFÉRENCES (fichier CM de la charte, asset du jeu) : jamais une adresse externe.
 */

import { jsonOu, sha256Hex } from '../../outils.mjs';
import { localeIntl, texte as T } from '../../langues.mjs';
import { formaterInstant } from '../../discord/formats.mjs';
import { ajouterJours, dateLocale, instantMural, lireDate, lundiDe, texteDate } from '../../planning/temps.mjs';
import { resumeAnnonce, resumeResultat, resumeTournoi, ordinal } from '../../competition/resume.mjs';
import { adversairesAffiches, adversairesParId } from '../../competition/commun.mjs';

export const GENRES_SOURCE = Object.freeze(['resultat', 'annonce', 'tournoi', 'membre', 'equipe', 'semaine', 'libre']);
export const FUSEAU_CLUB = 'Europe/Paris';

/** Noms des champs texte (documentés dans l'éditeur ; un champ inconnu reste écrit tel quel). */
export const CHAMPS_TEXTE = Object.freeze([
  'club', 'team', 'jeu', 'titre', 'phrase', 'date', 'date_courte', 'jour', 'heure', 'fuseau', 'date_heure', 'tournoi', 'tour', 'lieu', 'format', 'bo',
  'adversaire', 'adversaires', 'score', 'score_nous', 'score_eux', 'issue', 'place', 'participants', 'points', 'classement', 'mvp', 'mvp_agent',
  'genre_match', 'cashprize', 'gains', 'organisateur', 'bilan', 'joueur', 'poste', 'semaine', 'victoire',
]);

const LANGUES = ['fr', 'en'];
const texteOu = v => (v === null || v === undefined ? '' : String(v));

/** Morceaux de date dans le fuseau : date longue, date courte, jour court, heure, fuseau (« CEST »). */
export function morceauxDate(fuseau, instant, langue) {
  if (!instant) return { date: '', date_courte: '', jour: '', heure: '', fuseau: '', date_heure: '' };
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) return { date: '', date_courte: '', jour: '', heure: '', fuseau: '', date_heure: '' };
  const { date, heure } = formaterInstant(fuseau, instant, langue);
  const locale = localeIntl(langue);
  const f = o => {
    try {
      return new Intl.DateTimeFormat(locale, { timeZone: fuseau, ...o }).format(d);
    } catch {
      return '';
    }
  };
  let tz = '';
  try {
    tz = new Intl.DateTimeFormat('en-GB', { timeZone: fuseau, timeZoneName: 'short' }).formatToParts(d).find(p => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    tz = '';
  }
  const courte = langue === 'en' ? f({ day: '2-digit', month: 'short' }) : f({ day: '2-digit', month: '2-digit' });
  return { date, date_courte: courte, jour: f({ weekday: 'short' }).replace('.', ''), heure, fuseau: tz, date_heure: [date, [heure, tz].filter(Boolean).join(' ')].filter(Boolean).join(' · ') };
}

async function charteLogos(base) {
  const l = await base.premier("SELECT valeur FROM cm_charte WHERE id = 'club'", []);
  const v = jsonOu(l?.valeur, {});
  return { club: typeof v.club === 'string' ? v.club : '', logoClub: v.logos?.club ?? null, logosTeams: v.logos?.teams ?? {} };
}

async function teamLigne(base, teamId) {
  if (!teamId) return null;
  return base.premier('SELECT id, nom, fuseau, jeu FROM teams WHERE id = ? AND supprimee_le IS NULL', [teamId]);
}

/** Classement des équipes d'un résultat « classement » : total des manches (classement complet), sinon la dernière manche. */
export function classementEquipes(manchesScore, nomTeam, { place = null, points = null } = {}) {
  const manches = Array.isArray(manchesScore) ? manchesScore : [];
  if (!manches.length) return place ? [{ place, equipe: nomTeam, points: points === null ? '' : String(points), nous: true }] : [];
  const cle = x => x.id ?? `nom:${String(x.nom ?? '').toLowerCase()}`;
  const complet = manches.length > 1 && manches.every(m => Array.isArray(m.classement) && m.classement.length === manches[0].classement?.length && m.classement.length > 0);
  let lignes;
  if (complet) {
    const totaux = new Map([['__nous', { equipe: nomTeam, points: 0, places: 0, nous: true }]]);
    for (const m of manches) {
      const n = totaux.get('__nous');
      n.points += Number(m.points ?? 0);
      n.places += Number(m.place ?? 0);
      for (const x of m.classement) {
        const t = totaux.get(cle(x)) ?? { equipe: x.nom ?? '', points: 0, places: 0, nous: false };
        t.points += Number(x.points ?? 0);
        t.places += Number(x.place ?? 0);
        totaux.set(cle(x), t);
      }
    }
    lignes = [...totaux.values()].sort((a, b) => b.points - a.points || a.places - b.places).map((t, i) => ({ place: i + 1, equipe: t.equipe, points: String(t.points), nous: t.nous }));
    if (place) {
      // La place finale enregistrée (saisie ou calculée par le serveur) fait foi pour notre équipe.
      const nous = lignes.find(l => l.nous);
      if (nous && nous.place !== place) {
        const autres = lignes.filter(l => !l.nous);
        autres.splice(place - 1, 0, nous);
        lignes = autres.map((l, i) => ({ ...l, place: i + 1 }));
      }
    }
  } else {
    const m = manches[manches.length - 1];
    lignes = [{ place: Number(m.place), equipe: nomTeam, points: m.points === null || m.points === undefined ? '' : String(m.points), nous: true }, ...(m.classement ?? []).map(x => ({ place: Number(x.place), equipe: x.nom ?? '', points: x.points === null || x.points === undefined ? '' : String(x.points), nous: false }))].sort((a, b) => a.place - b.place);
  }
  return lignes.map(l => ({ place: String(l.place), place_texte: '', equipe: l.equipe, points: l.points, nous: l.nous }));
}

function ligneClassement(l, langue) {
  return { ...l, place_texte: ordinal(Number(l.place), langue) };
}

async function donneesResultat(base, teamId, id) {
  const fr = await resumeResultat(base, teamId, id, { langue: 'fr' });
  if (!fr) return null;
  const en = await resumeResultat(base, teamId, id, { langue: 'en' });
  const r = await base.premier('SELECT score, mvp_id FROM resultats WHERE id = ? AND team_id = ?', [id, teamId]);
  const cles = await base.tous('SELECT numero, carte_cle FROM resultat_manches WHERE resultat_id = ? AND team_id = ? ORDER BY numero', [id, teamId]);
  const mvp = r?.mvp_id ? await base.premier('SELECT personnages FROM resultat_joueurs WHERE resultat_id = ? AND team_id = ? AND compte_id = ?', [id, teamId, r.mvp_id]) : null;
  const persoMvp = jsonOu(mvp?.personnages, [])[0] ?? null;
  const manchesScore = jsonOu(r?.score, {}).manches ?? [];
  const parLangue = x => {
    const langue = x === fr ? 'fr' : 'en';
    const nomTeam = x.team.nom;
    const champs = {
      titre: x.titre,
      phrase: x.phrase,
      tournoi: x.tournoi?.nom ?? '',
      tour: x.tour ?? '',
      format: x.format?.libelle ?? '',
      bo: x.bo ? `BO${x.bo}` : '',
      adversaire: x.adversaires.map(a => a.nom).filter(Boolean).slice(0, 4).join(', '),
      adversaires: x.adversaires.map(a => a.nom).filter(Boolean).join(', '),
      score: x.score ?? '',
      score_nous: x.systeme === 'serie' ? texteOu(x.score?.split('-')[0]?.trim()) : '',
      score_eux: x.systeme === 'serie' ? texteOu(x.score?.split('-')[1]?.trim()) : '',
      issue: x.libelleIssue ?? '',
      // « 1 » pour une victoire : sert de condition d'affichage (« champ:victoire ») dans les modèles.
      victoire: x.issue === 'victoire' ? '1' : '',
      place: x.place ? ordinal(x.place, langue) : '',
      participants: texteOu(x.participants),
      points: texteOu(x.points),
      classement: x.place ? (x.participants ? T(langue, 'competition.place_sur', { place: ordinal(x.place, langue), n: x.participants }) : ordinal(x.place, langue)) : '',
      mvp: x.mvp ?? '',
      mvp_agent: (persoMvp && x.joueurs.find(j => j.pseudo === x.mvp)?.personnages[0]) || '',
      genre_match: x.libelleGenre ?? '',
      ...morceauxDate(x.team.fuseau, x.date, langue),
    };
    // Série : une ligne par map / manche ; classement : une ligne par manche (place, points).
    const manches = x.manches.map(m => ({ numero: String(m.numero), carte: m.carte ?? '', mode: m.mode ?? '', score: m.score || (m.issue ? T(langue, `competition.issue.${m.issue}`) : ''), issue: m.issue ? T(langue, `competition.issue.${m.issue}`) : '', place: m.place ? ordinal(m.place, langue) : '', points: texteOu(m.points), victoire: m.issue === 'victoire' }));
    const classement = x.systeme === 'classement' ? classementEquipes(manchesScore, nomTeam, { place: x.place, points: x.points }).map(l => ligneClassement(l, langue)) : [];
    const roster = x.joueurs.filter(j => j.pseudo).map(j => ({ pseudo: j.pseudo, role: j.personnages.join(', ') }));
    return { champs, listes: { manches, classement, roster } };
  };
  const images = {};
  cles.slice(0, 5).forEach((m, i) => {
    if (m.carte_cle) images[`map_${i + 1}`] = { asset: `map:${m.carte_cle}` };
  });
  if (persoMvp && /^[a-z0-9][a-z0-9-]{0,39}$/.test(persoMvp)) images.agent_mvp = { asset: `agent:${persoMvp}` };
  return { publiable: fr.publiable, systeme: fr.systeme, team: fr.team, fr: parLangue(fr), en: parLangue(en), images };
}

async function donneesAnnonce(base, teamId, id) {
  const fr = await resumeAnnonce(base, teamId, id, { langue: 'fr' });
  if (!fr) return null;
  const en = await resumeAnnonce(base, teamId, id, { langue: 'en' });
  const m = await base.premier('SELECT phase FROM tournoi_matchs WHERE id = ? AND team_id = ?', [id, teamId]);
  const parLangue = (x, langue) => ({
    champs: {
      titre: x.titre,
      phrase: x.phrase,
      tournoi: x.tournoi.nom,
      tour: [m?.phase, x.tour].filter(Boolean).join(' · '),
      format: x.format?.libelle ?? '',
      bo: x.bo ? `BO${x.bo}` : '',
      lieu: x.lieu ?? '',
      adversaire: x.adversaires.map(a => a.nom).filter(Boolean).slice(0, 4).join(', '),
      adversaires: x.adversaires.map(a => a.nom).filter(Boolean).join(', '),
      ...morceauxDate(x.team.fuseau, x.debut, langue),
    },
    listes: { roster: x.roster.map(p => ({ pseudo: p, role: T(langue, 'visuel.roster.titulaire') })) },
  });
  return { publiable: fr.publiable, systeme: null, team: fr.team, fr: parLangue(fr, 'fr'), en: parLangue(en, 'en'), images: {} };
}

async function donneesTournoi(base, teamId, id) {
  const fr = await resumeTournoi(base, teamId, id, { langue: 'fr' });
  if (!fr) return null;
  const en = await resumeTournoi(base, teamId, id, { langue: 'en' });
  const parLangue = (x, langue) => {
    const b = x.bilan;
    return {
      champs: {
        titre: x.titre,
        phrase: x.texteClassement ? x.phraseFinal : x.phraseInscription,
        tournoi: x.nom,
        lieu: x.lieu ?? '',
        format: x.format?.libelle ?? '',
        classement: x.texteClassement ?? '',
        place: x.classementFinal ? ordinal(x.classementFinal, langue) : '',
        participants: texteOu(x.participants),
        cashprize: x.cashprize ?? '',
        gains: x.gains ?? '',
        organisateur: x.organisateur ?? '',
        bilan: b.victoires + b.defaites + b.nuls ? (b.nuls ? T(langue, 'visuel.bilan_nuls', { v: b.victoires, n: b.nuls, d: b.defaites }) : T(langue, 'visuel.bilan', { v: b.victoires, d: b.defaites })) : '',
        ...morceauxDate(x.team.fuseau, x.debut, langue),
      },
      listes: {
        roster: x.roster.map(r => ({ pseudo: r.pseudo, role: T(langue, `visuel.roster.${r.role === 'remplacant' ? 'remplacant' : 'titulaire'}`) })),
        parcours: x.parcours.map(p => ({ tour: p.tour ?? '', adversaire: p.adversaires.map(a => a.nom).filter(Boolean).join(', '), score: p.score ?? (p.place ? ordinal(p.place, langue) : ''), issue: p.libelleIssue ?? '', victoire: p.issue === 'victoire' })),
      },
    };
  };
  return { publiable: fr.publiable, systeme: null, team: fr.team, fr: parLangue(fr, 'fr'), en: parLangue(en, 'en'), images: {} };
}

async function donneesMembre(base, teamId, compte) {
  const m = await base.premier('SELECT m.statut, r.cle_systeme, r.nom AS role_nom, c.pseudo FROM membres m JOIN roles r ON r.id = m.role_id JOIN comptes c ON c.id = m.compte_id WHERE m.team_id = ? AND m.compte_id = ?', [teamId, compte]);
  const team = await teamLigne(base, teamId);
  if (!m || !team) return null;
  const poste = langue => (m.cle_systeme ? T(langue, `role.${m.cle_systeme}`) : m.role_nom);
  const parLangue = langue => ({ champs: { joueur: m.pseudo, poste: poste(langue) }, listes: {} });
  return { publiable: true, systeme: null, team: { id: team.id, nom: team.nom, fuseau: team.fuseau }, fr: parLangue('fr'), en: parLangue('en'), images: {} };
}

const ORDRE_ROLES = ['joueur', 'remplacant', 'coach', 'analyste', 'manager', 'proprietaire'];

async function donneesEquipe(base, teamId) {
  const team = await teamLigne(base, teamId);
  if (!team) return null;
  const membres = await base.tous("SELECT r.cle_systeme, r.nom AS role_nom, c.pseudo FROM membres m JOIN roles r ON r.id = m.role_id JOIN comptes c ON c.id = m.compte_id WHERE m.team_id = ? AND m.statut = 'actif' ORDER BY c.pseudo_cle", [teamId]);
  const rang = m => (ORDRE_ROLES.includes(m.cle_systeme) ? ORDRE_ROLES.indexOf(m.cle_systeme) : 2.5);
  const tries = [...membres].sort((a, b) => rang(a) - rang(b));
  const parLangue = langue => ({ champs: {}, listes: { roster: tries.slice(0, 20).map(m => ({ pseudo: m.pseudo, role: m.cle_systeme ? T(langue, `role.${m.cle_systeme}`) : m.role_nom })) } });
  return { publiable: true, systeme: null, team: { id: team.id, nom: team.nom, fuseau: team.fuseau }, fr: parLangue('fr'), en: parLangue('en'), images: {} };
}

/** Programme d'une semaine (lundi → dimanche dans le fuseau) : matchs de tournoi publiables des teams données. */
async function donneesSemaine(base, teamIds, date, fuseau) {
  const jour = lireDate(date) ?? dateLocale(fuseau, Date.now());
  const lundi = lundiDe(jour);
  const du = instantMural(fuseau, lundi, 0);
  const au = instantMural(fuseau, ajouterJours(lundi, 7), 0);
  const lignes = [];
  for (const teamId of teamIds.slice(0, 50)) {
    const matchs = await base.tous(
      `SELECT m.id, m.debut, m.tour, m.adversaires, t.nom AS tournoi, tm.nom AS team, tm.fuseau FROM tournoi_matchs m JOIN tournois t ON t.id = m.tournoi_id JOIN teams tm ON tm.id = m.team_id
        WHERE m.team_id = ? AND m.supprime_le IS NULL AND t.supprime_le IS NULL AND t.publiable = 1 AND t.statut <> 'annule' AND m.statut <> 'annule' AND m.debut >= ? AND m.debut < ? ORDER BY m.debut`,
      [teamId, new Date(du).toISOString(), new Date(au).toISOString()],
    );
    const fiches = await adversairesParId(base, teamId, matchs.flatMap(m => jsonOu(m.adversaires, []).map(a => a.id)).filter(Boolean));
    for (const m of matchs) lignes.push({ ...m, adv: adversairesAffiches(jsonOu(m.adversaires, []), fiches).map(a => a.nom).filter(Boolean).join(', ') });
  }
  lignes.sort((a, b) => (a.debut < b.debut ? -1 : a.debut > b.debut ? 1 : 0));
  const dim = ajouterJours(lundi, 6);
  const parLangue = langue => {
    const fmt = d => {
      try {
        return new Intl.DateTimeFormat(localeIntl(langue), { timeZone: 'UTC', day: '2-digit', month: langue === 'en' ? 'short' : '2-digit' }).format(new Date(`${texteDate(d)}T12:00:00Z`));
      } catch {
        return texteDate(d);
      }
    };
    return {
      champs: { semaine: T(langue, 'visuel.semaine', { du: fmt(lundi), au: fmt(dim) }), phrase: lignes.length ? '' : T(langue, 'visuel.programme_vide') },
      listes: {
        programme: lignes.slice(0, 30).map(l => {
          const d = morceauxDate(fuseau, l.debut, langue);
          return { jour: d.jour, date: d.date_courte, heure: d.heure, fuseau: d.fuseau, team: l.team, adversaire: l.adv, tournoi: l.tournoi, tour: l.tour ?? '' };
        }),
      },
    };
  };
  return { publiable: true, systeme: null, team: null, fr: parLangue('fr'), en: parLangue('en'), images: {} };
}

/** JSON trié (clés dans l'ordre) : empreinte stable. */
const ordonne = o => (Array.isArray(o) ? o.map(ordonne) : o && typeof o === 'object' ? Object.fromEntries(Object.keys(o).sort().map(k => [k, ordonne(o[k])])) : o);

/**
 * Données d'un visuel. `source` déjà lue par le service (`genre`, `teamId`, `id`, `date`), `teams` : teams
 * de la semaine (programme). Rend null si l'élément n'existe pas.
 */
export async function donneesVisuel(base, source, { teams = [] } = {}) {
  const logos = await charteLogos(base);
  let d;
  switch (source.genre) {
    case 'resultat':
      d = await donneesResultat(base, source.teamId, source.id);
      break;
    case 'annonce':
      d = await donneesAnnonce(base, source.teamId, source.id);
      break;
    case 'tournoi':
      d = await donneesTournoi(base, source.teamId, source.id);
      break;
    case 'membre':
      d = await donneesMembre(base, source.teamId, source.id);
      break;
    case 'equipe':
      d = await donneesEquipe(base, source.teamId);
      break;
    case 'semaine': {
      const team = source.teamId ? await teamLigne(base, source.teamId) : null;
      d = await donneesSemaine(base, source.teamId ? [source.teamId] : teams, source.date, team?.fuseau ?? FUSEAU_CLUB);
      if (d && team) d.team = { id: team.id, nom: team.nom, fuseau: team.fuseau };
      break;
    }
    default: {
      const team = await teamLigne(base, source.teamId);
      d = { publiable: true, systeme: null, team: team ? { id: team.id, nom: team.nom, fuseau: team.fuseau } : null, fr: { champs: {}, listes: {} }, en: { champs: {}, listes: {} }, images: {} };
    }
  }
  if (!d) return null;
  const jeu = d.team ? (await teamLigne(base, d.team.id))?.jeu ?? null : null;
  const profil = jeu ? await base.premier('SELECT nom, base FROM jeux WHERE cle = ?', [jeu]) : null;
  for (const langue of LANGUES) {
    const c = d[langue].champs;
    c.club = logos.club;
    c.team = d.team?.nom ?? logos.club;
    c.jeu = profil?.nom ?? '';
    for (const k of CHAMPS_TEXTE) if (c[k] === undefined || c[k] === null) c[k] = '';
    for (const k of Object.keys(c)) c[k] = String(c[k]).slice(0, 300);
  }
  const images = { ...d.images };
  if (logos.logoClub) images.logo_club = { fichier: logos.logoClub };
  if (d.team && logos.logosTeams[d.team.id]) images.logo_team = { fichier: logos.logosTeams[d.team.id] };
  else if (logos.logoClub) images.logo_team = { fichier: logos.logoClub };
  const sortie = { publiable: d.publiable, systeme: d.systeme, jeu: profil ? { cle: jeu, base: profil.base ?? null } : null, team: d.team ? { id: d.team.id, nom: d.team.nom } : null, fr: d.fr, en: d.en, images };
  sortie.empreinte = await sha256Hex(JSON.stringify(ordonne({ systeme: sortie.systeme, fr: sortie.fr, en: sortie.en, images })));
  return sortie;
}
