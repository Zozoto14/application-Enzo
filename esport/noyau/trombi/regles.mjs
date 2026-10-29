/**
 * Trombinoscope : règles PURES (ni base, ni réseau, ni horloge implicite), testées sous Node.
 *
 *  - visibilité par champ (membres de ses teams / staff et CM / privé) et niveau d'un lecteur ;
 *  - validation des listes de la fiche : elo / rang par jeu, palmarès saisi, anciennes structures, réseaux
 *    sociaux pro (adresse https sur le domaine attendu, comme la page Réseaux du CM), postes et personnages
 *    par team (clés du profil de jeu de la team) ;
 *  - photo : JPEG, PNG ou WebP reconnus à leurs octets, carrée, côté et poids bornés, miniature comprise ;
 *  - palmarès CALCULÉ depuis les tournois et résultats du club (lignes lues par le service) ;
 *  - texte prêt pour un post (français ou anglais), sans aucun champ qui ne soit visible de tous les membres.
 */

import { echec, texteLong, texteNettoye } from '../outils.mjs';
import { dimensionsImage } from '../cm/visuels/images.mjs';
import { RESEAUX_COMPTES, adresseHttps, validerUrlProfil } from '../reseaux/regles.mjs';
import { ordinal } from '../competition/resume.mjs';
import { texte as T } from '../langues.mjs';

export { PERMISSIONS_TROMBI } from './permissions.mjs';

/** Champs dont le joueur règle la visibilité (pseudo, teams et postes : toujours visibles de qui voit la carte). */
export const CHAMPS_VISIBILITE = Object.freeze(['photo', 'nomReel', 'presentation', 'elos', 'palmares', 'structures', 'reseaux']);
/** `membres` : les membres de ses teams et le staff ; `staff` : le staff, le CM et le Fondateur ; `prive` : lui seul (et le Fondateur). */
export const NIVEAUX_VISIBILITE = Object.freeze(['membres', 'staff', 'prive']);
export const VISIBILITE_DEFAUT = Object.freeze({ photo: 'membres', nomReel: 'staff', presentation: 'membres', elos: 'membres', palmares: 'membres', structures: 'membres', reseaux: 'membres' });

/** Réseaux d'une fiche : ceux de la page Réseaux du CM, et « autre » (toute adresse https publique). */
export const RESEAUX_TROMBI = Object.freeze(['x', 'instagram', 'tiktok', 'twitch', 'youtube', 'autre']);

export const MAX = Object.freeze({ elos: 10, palmares: 60, structures: 30, reseaux: 12, postes: 5, personnages: 10 });

/** Photo : côté (px) et poids (octets) de l'image et de sa miniature. */
export const PHOTO = Object.freeze({ coteMin: 128, coteMax: 1024, tailleMax: 400 * 1024, miniCoteMin: 32, miniCoteMax: 256, miniTailleMax: 48 * 1024 });
export const TYPES_PHOTO = Object.freeze({ 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' });

const MOTIF_ID = /^[a-z0-9-]{1,40}$/;
const MOTIF_JOUR = /^(\d{4})-(\d{2})-(\d{2})$/;
const MOTIF_MOIS = /^(\d{4})-(\d{2})$/;
const MOTIF_ANNEE = /^(\d{4})$/;

const invalide = (code, message, details) => {
  const e = echec(400, code, message);
  if (details) e.details = details;
  return e;
};

// ------------------------------------------------------------------ Visibilité

/** Visibilité complète (défauts pour les champs absents ou illisibles). */
export function lireVisibiliteStockee(v) {
  const sortie = { ...VISIBILITE_DEFAUT };
  if (v && typeof v === 'object' && !Array.isArray(v)) for (const c of CHAMPS_VISIBILITE) if (NIVEAUX_VISIBILITE.includes(v[c])) sortie[c] = v[c];
  return sortie;
}

/** Visibilité saisie : un objet { champ: niveau } ; champ ou niveau inconnu : 400. */
export function lireVisibilite(v, actuelle = VISIBILITE_DEFAUT) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw invalide('visibilite', 'Visibilité illisible.');
  const sortie = lireVisibiliteStockee(actuelle);
  for (const [c, n] of Object.entries(v)) {
    if (!CHAMPS_VISIBILITE.includes(c) || !NIVEAUX_VISIBILITE.includes(n)) throw invalide('visibilite', 'Visibilité inconnue.', { champ: String(c).slice(0, 30) });
    sortie[c] = n;
  }
  return sortie;
}

/**
 * Niveau d'un lecteur sur une fiche : `moi` (le joueur, ou le Fondateur), `editeur` (membres.trombi.editer),
 * `staff` (membres.trombi.voir), `membre` (membre d'une même team).
 */
export const NIVEAUX_LECTEUR = Object.freeze(['moi', 'editeur', 'staff', 'membre']);

/** Le lecteur de ce niveau voit-il un champ de cette visibilité ? */
export function champVisible(niveau, visibilite) {
  if (niveau === 'moi') return true;
  if (niveau === 'editeur' || niveau === 'staff') return visibilite !== 'prive';
  return visibilite === 'membres';
}

/** Champs visibles d'une fiche pour un niveau de lecteur (Set). */
export function champsVisibles(niveau, visibilite) {
  const v = lireVisibiliteStockee(visibilite);
  return new Set(CHAMPS_VISIBILITE.filter(c => champVisible(niveau, v[c])));
}

// ------------------------------------------------------------------ Dates

/** Date d'un palmarès : AAAA, AAAA-MM ou AAAA-MM-JJ (valide) ; '' si vide ; 400 sinon. */
export function lireDatePartielle(v, code = 'date') {
  const t = String(v ?? '').trim();
  if (!t) return '';
  let a;
  let m = 1;
  let j = 1;
  let r;
  if ((r = MOTIF_JOUR.exec(t))) [a, m, j] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = MOTIF_MOIS.exec(t))) [a, m] = [Number(r[1]), Number(r[2])];
  else if ((r = MOTIF_ANNEE.exec(t))) a = Number(r[1]);
  else throw invalide(code, 'Date invalide (AAAA, AAAA-MM ou AAAA-MM-JJ).');
  const d = new Date(Date.UTC(a, m - 1, j));
  if (a < 1990 || a > 2100 || d.getUTCMonth() !== m - 1 || d.getUTCDate() !== j) throw invalide(code, 'Date invalide (AAAA, AAAA-MM ou AAAA-MM-JJ).');
  return t;
}

/** Comparaison de deux dates partielles (« 2024 » < « 2024-03 » < « 2024-03-02 » à égalité de début). */
const cleDate = d => (d ? `${d}${'-00-00'.slice(d.length - 4)}` : '');

// ------------------------------------------------------------------ Listes de la fiche

function liste(v, champ, max) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw invalide(champ, 'Liste illisible.');
  if (v.length > max) throw invalide(champ, `Trop d’éléments (${max} au plus).`);
  return v.map((x, index) => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) throw invalide(champ, 'Élément illisible.', { index });
    return [x, index];
  });
}

const idDe = (x, nouvelId) => (typeof x.id === 'string' && MOTIF_ID.test(x.id) ? x.id : nouvelId());

/** Clé de jeu saisie : '' (aucun) ou un jeu connu (profil de jeu). */
function lireJeu(v, jeux, champ, index, { obligatoire = false } = {}) {
  const t = String(v ?? '').trim();
  if (!t) {
    if (obligatoire) throw invalide(`${champ}-jeu`, 'Choisissez le jeu.', { index });
    return '';
  }
  if (!jeux.has(t)) throw invalide(`${champ}-jeu`, 'Jeu inconnu.', { index });
  return t;
}

/**
 * Elo / rang par jeu : `{ jeu, valeur, rang, pic, majLe }` — valeur libre (« 2450 », « Immortel 2 ») ou rang ;
 * un seul par jeu ; `majLe` (AAAA-MM-JJ) : posé à `aujourdhui` quand la valeur ou le rang change.
 */
export function lireElos(v, { jeux, actuels = [], aujourdhui }) {
  const vus = new Set();
  return liste(v, 'elos', MAX.elos).map(([x, index]) => {
    const jeu = lireJeu(x.jeu, jeux, 'elos', index, { obligatoire: true });
    if (vus.has(jeu)) throw invalide('elos-doublon', 'Un seul elo par jeu.', { index });
    vus.add(jeu);
    const valeur = texteNettoye(x.valeur, 40);
    const rang = texteNettoye(x.rang, 40);
    const pic = texteNettoye(x.pic, 40);
    if (!valeur && !rang) throw invalide('elos-valeur', 'Elo : une valeur ou un rang.', { index });
    const avant = actuels.find(a => a.jeu === jeu);
    const change = !avant || avant.valeur !== valeur || avant.rang !== rang;
    const saisie = x.majLe ? lireDatePartielle(x.majLe, 'elos-date') : '';
    if (saisie && !MOTIF_JOUR.test(saisie)) throw invalide('elos-date', 'Date de mise à jour : AAAA-MM-JJ.', { index });
    return { jeu, valeur, rang, pic, majLe: saisie || (change ? aujourdhui : (avant?.majLe ?? aujourdhui)) };
  });
}

/** Lien de preuve (https, public) : '' si vide. */
function lirePreuve(v, index) {
  const t = String(v ?? '').trim();
  if (!t) return '';
  const u = adresseHttps(t, 500);
  if (!u || !hotePublic(u.hostname)) throw invalide('palmares-preuve', 'Lien de preuve : adresse https://… publique.', { index });
  return u.toString();
}

/** Palmarès saisi : compétition, structure, date, placement (rang ou texte « Top 8 »), jeu, détails, preuve. */
export function lirePalmares(v, { jeux, nouvelId }) {
  const sortie = liste(v, 'palmares', MAX.palmares).map(([x, index]) => {
    const competition = texteNettoye(x.competition, 120);
    if (competition.length < 2) throw invalide('palmares-competition', 'Palmarès : nom de la compétition (2 caractères au moins).', { index });
    const placement = x.placement === undefined || x.placement === null || x.placement === '' ? null : Number(x.placement);
    if (placement !== null && (!Number.isInteger(placement) || placement < 1 || placement > 9999)) throw invalide('palmares-placement', 'Placement : un rang de 1 à 9999.', { index });
    const participants = x.participants === undefined || x.participants === null || x.participants === '' ? null : Number(x.participants);
    if (participants !== null && (!Number.isInteger(participants) || participants < 2 || participants > 100000)) throw invalide('palmares-participants', 'Participants : de 2 à 100 000.', { index });
    return {
      id: idDe(x, nouvelId),
      competition,
      structure: texteNettoye(x.structure, 80),
      date: lireDatePartielle(x.date, 'palmares-date'),
      placement,
      placementTexte: texteNettoye(x.placementTexte, 40),
      participants,
      jeu: lireJeu(x.jeu, jeux, 'palmares', index),
      details: texteLong(x.details, 600),
      preuve: lirePreuve(x.preuve, index),
    };
  });
  // Du plus récent au plus ancien (sans date : à la fin).
  return sortie.sort((a, b) => cleDate(b.date).localeCompare(cleDate(a.date)));
}

/** Anciennes structures : nom, jeu, période (AAAA ou AAAA-MM ; fin vide : jusqu'à son arrivée), rôle. */
export function lireStructures(v, { jeux, nouvelId }) {
  return liste(v, 'structures', MAX.structures)
    .map(([x, index]) => {
      const structure = texteNettoye(x.structure, 80);
      if (structure.length < 2) throw invalide('structures-nom', 'Ancienne structure : son nom (2 caractères au moins).', { index });
      const debut = lireDatePartielle(x.debut, 'structures-periode');
      const fin = lireDatePartielle(x.fin, 'structures-periode');
      if (debut && fin && cleDate(fin) < cleDate(debut)) throw invalide('structures-periode', 'La fin précède le début.', { index });
      return { id: idDe(x, nouvelId), structure, jeu: lireJeu(x.jeu, jeux, 'structures', index), debut, fin, role: texteNettoye(x.role, 60) };
    })
    .sort((a, b) => cleDate(b.debut).localeCompare(cleDate(a.debut)));
}

/** Nom d'hôte public : un nom de domaine (pas d'adresse IP, pas de « localhost », pas de nom local). */
export function hotePublic(hote) {
  const h = String(hote ?? '').toLowerCase().replace(/\.$/, '');
  if (!h || !h.includes('.') || h.startsWith('[')) return false;
  if (/^\d+(\.\d+){3}$/.test(h)) return false;
  if (/(^|\.)(localhost|local|internal|lan|home|test|invalid|example)$/.test(h)) return false;
  return /^[a-z0-9.-]+$/.test(h);
}

/**
 * Réseau validé : `{ reseau, url, identifiant, libelle }`, ou `{ erreur }` (`url` : pas https, mauvais domaine,
 * pas une adresse de profil ; `libelle` : « autre » sans nom).
 */
export function validerReseau(reseau, url, libelle = '') {
  if (!RESEAUX_TROMBI.includes(reseau)) return { erreur: 'reseau' };
  if (reseau !== 'autre') {
    const r = validerUrlProfil(url, reseau);
    return r.erreur ? { erreur: 'url' } : { reseau, url: r.url, identifiant: r.identifiant, libelle: '' };
  }
  const u = adresseHttps(url, 300);
  if (!u || !hotePublic(u.hostname)) return { erreur: 'url' };
  // Un réseau connu se saisit sous son nom (adresse vérifiée par réseau).
  if (Object.values(RESEAUX_COMPTES).some(r => r.hotes.some(x => u.hostname.toLowerCase() === x || u.hostname.toLowerCase().endsWith(`.${x}`)))) return { erreur: 'reseau-connu' };
  const nom = texteNettoye(libelle, 30);
  if (nom.length < 2) return { erreur: 'libelle' };
  return { reseau, url: u.toString(), identifiant: '', libelle: nom };
}

export function lireReseaux(v) {
  const vus = new Set();
  return liste(v, 'reseaux', MAX.reseaux).map(([x, index]) => {
    const r = validerReseau(String(x.reseau ?? ''), x.url, x.libelle);
    if (r.erreur) {
      const messages = {
        reseau: 'Réseau inconnu.',
        url: 'Adresse du profil invalide : https://… sur le site du réseau (profil, pas une publication).',
        'reseau-connu': 'Ce réseau a son propre choix dans la liste (adresse vérifiée).',
        libelle: 'Nom du site (2 caractères au moins).',
      };
      throw invalide(`reseau-${r.erreur}`, messages[r.erreur], { index, reseau: RESEAUX_TROMBI.includes(x.reseau) ? x.reseau : null });
    }
    const cle = `${r.reseau}:${r.url.toLowerCase()}`;
    if (vus.has(cle)) throw invalide('reseau-doublon', 'Ce profil est déjà dans la liste.', { index });
    vus.add(cle);
    return r;
  });
}

/**
 * Postes et personnages par team : `{ [teamId]: { postes: [cle], personnages: [cle] } }`, pour les teams du joueur
 * seulement, avec les clés du profil de jeu de chaque team (`profils` : Map teamId → { postes: Set, personnages: Set }).
 * Une team absente de la saisie garde sa valeur (`actuels`) ; une team vidée disparaît.
 */
export function lirePostes(v, { profils, actuels = {} }) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw invalide('postes', 'Postes illisibles.');
  const sortie = Object.fromEntries(Object.entries(actuels).filter(([id]) => profils.has(id)));
  for (const [teamId, x] of Object.entries(v)) {
    const p = profils.get(teamId);
    if (!p) throw invalide('postes-team', 'Postes : team inconnue (le joueur doit en être membre).');
    if (x === null) {
      delete sortie[teamId];
      continue;
    }
    if (!x || typeof x !== 'object') throw invalide('postes', 'Postes illisibles.');
    const lire = (l, ensemble, max, code) => {
      if (l === undefined) return [];
      if (!Array.isArray(l) || l.length > max || l.some(c => typeof c !== 'string' || !ensemble.has(c))) throw invalide(code, 'Clé inconnue du profil de jeu de la team.', { team: teamId });
      return [...new Set(l)];
    };
    const postes = lire(x.postes, p.postes, MAX.postes, 'postes-cle');
    const personnages = lire(x.personnages, p.personnages, MAX.personnages, 'personnages-cle');
    if (postes.length || personnages.length) sortie[teamId] = { postes, personnages };
    else delete sortie[teamId];
  }
  return sortie;
}

// ------------------------------------------------------------------ Photo

/** Base64 (standard ou d'adresse « data: ») → octets ; null si illisible. */
export function depuisBase64(texte, max) {
  if (typeof texte !== 'string') return null;
  const t = texte.replace(/^data:image\/[a-z]+;base64,/, '').replace(/\s+/g, '');
  // Un peu plus que le plafond : au-delà, « trop lourde » plutôt qu'« illisible ».
  if (!t || t.length > Math.ceil((max * 8) / 3) + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(t)) return null;
  try {
    return new Uint8Array(Buffer.from(t, 'base64'));
  } catch {
    return null;
  }
}

/**
 * Photo envoyée par l'app (déjà recadrée en carré et réduite) : `{ type, donnees, miniature }` en base64.
 * Vérifie le FORMAT aux octets (JPEG, PNG, WebP ; jamais un SVG ni un autre fichier), qu'il correspond au
 * type annoncé, que l'image est carrée, son côté et son poids. Rend `{ type, cote, taille, donnees, miniature }`.
 */
export function verifierPhoto(corps) {
  const type = corps?.type;
  if (!TYPES_PHOTO[type]) throw invalide('photo-format', 'Photo : JPEG, PNG ou WebP.');
  const verifier = (b64, { tailleMax, coteMin, coteMax }, code) => {
    const octets = depuisBase64(b64, tailleMax);
    if (!octets || octets.length === 0) throw invalide(code, 'Image illisible.');
    if (octets.length > tailleMax) throw invalide(`${code}-poids`, `Image trop lourde (${Math.round(tailleMax / 1024)} Ko au plus).`);
    const d = dimensionsImage(octets);
    if (!d || d.format !== TYPES_PHOTO[type]) throw invalide('photo-format', 'Le contenu n’est pas une image JPEG, PNG ou WebP du type annoncé.');
    if (d.largeur !== d.hauteur) throw invalide('photo-carree', 'La photo doit être carrée (recadrez-la).');
    if (d.largeur < coteMin || d.largeur > coteMax) throw invalide(`${code}-cote`, `Côté de ${coteMin} à ${coteMax} px.`);
    return { octets, cote: d.largeur };
  };
  const g = verifier(corps?.donnees, { tailleMax: PHOTO.tailleMax, coteMin: PHOTO.coteMin, coteMax: PHOTO.coteMax }, 'photo');
  const m = verifier(corps?.miniature, { tailleMax: PHOTO.miniTailleMax, coteMin: PHOTO.miniCoteMin, coteMax: PHOTO.miniCoteMax }, 'photo-miniature');
  if (m.cote > g.cote) throw invalide('photo-miniature-cote', 'La miniature est plus grande que la photo.');
  return { type, cote: g.cote, taille: g.octets.length, donnees: Buffer.from(g.octets).toString('base64'), miniature: Buffer.from(m.octets).toString('base64') };
}

export const adresseImage = (type, b64) => (b64 ? `data:${type};base64,${b64}` : null);

// ------------------------------------------------------------------ Palmarès calculé

/**
 * Palmarès calculé depuis les tournois et résultats du club (lignes déjà filtrées par le service : non
 * supprimés, publiables, jamais un résultat réservé au staff) :
 *  - `tournois` : [{ id, nom, teamId, teamNom, jeu, debut, fin, statut, placement, participants, role }] ;
 *  - `matchs` : [{ resultatId, tournoiId, teamId, issue, mvp }] (matchs où il a été aligné, ou MVP).
 * Rend `{ tournois: [...avec matchs joués, victoires, défaites, MVP], hors: { matchs, victoires, mvp } }`.
 */
export function palmaresCalcule({ tournois = [], matchs = [] }) {
  const parTournoi = new Map();
  const hors = { matchs: 0, victoires: 0, mvp: 0 };
  for (const m of matchs) {
    if (m.tournoiId) {
      const s = parTournoi.get(m.tournoiId) ?? { joues: 0, victoires: 0, defaites: 0, mvp: 0 };
      if (m.aligne !== false) {
        s.joues++;
        if (m.issue === 'victoire') s.victoires++;
        if (m.issue === 'defaite') s.defaites++;
      }
      if (m.mvp) s.mvp++;
      parTournoi.set(m.tournoiId, s);
    } else {
      if (m.aligne !== false) {
        hors.matchs++;
        if (m.issue === 'victoire') hors.victoires++;
      }
      if (m.mvp) hors.mvp++;
    }
  }
  const lignes = tournois
    .map(t => {
      const s = parTournoi.get(t.id) ?? { joues: 0, victoires: 0, defaites: 0, mvp: 0 };
      return { ...t, matchs: s.joues, victoires: s.victoires, defaites: s.defaites, mvp: s.mvp, calcule: true };
    })
    .filter(t => t.statut === 'termine' || t.statut === 'en_cours' || t.placement !== null || t.matchs > 0)
    .sort((a, b) => String(b.fin ?? b.debut ?? '').localeCompare(String(a.fin ?? a.debut ?? '')));
  return { tournois: lignes, hors };
}

// ------------------------------------------------------------------ Texte d'annonce

/** Placement lisible : « 1er / 64 », « Top 8 », « 3rd of 16 ». */
export function placementLisible({ placement, placementTexte, participants }, langue = 'fr') {
  if (placement) return participants ? T(langue, 'trombi.place_sur', { place: ordinal(placement, langue), n: participants }) : ordinal(placement, langue);
  return placementTexte || '';
}

/**
 * Texte prêt pour un post (annonce de recrue, présentation d'un joueur), dans une langue. Ne reprend QUE ce
 * que tous les membres peuvent voir (champs en visibilité « membres ») : jamais le nom réel ni un champ
 * réservé au staff ou privé, quel que soit le lecteur.
 * `fiche` : { pseudo, teams: [{ nom, jeuNom, postes: [nom] }], elos: [{ jeuNom, valeur, rang }], palmares, calcule,
 * structures, reseaux, visibilite }.
 */
export function texteFiche(fiche, langue = 'fr') {
  const v = lireVisibiliteStockee(fiche.visibilite);
  const public_ = c => v[c] === 'membres';
  const sep = langue === 'fr' ? ' : ' : ': ';
  const L = [fiche.pseudo];
  // Badges (migration 0032) : « Capitaine · Team Alpha, Streamer ».
  if (fiche.badges?.length) L.push(`${T(langue, 'trombi.texte.badges')}${sep}${fiche.badges.join(', ')}`);
  for (const t of fiche.teams ?? []) {
    const postes = (t.postes ?? []).join(' / ');
    L.push(`${T(langue, 'trombi.texte.team')}${sep}${t.nom}${t.jeuNom ? ` (${t.jeuNom})` : ''}${postes ? ` · ${postes}` : ''}`);
  }
  if (public_('elos')) for (const e of fiche.elos ?? []) L.push(`${T(langue, 'trombi.texte.elo')}${e.jeuNom ? ` ${e.jeuNom}` : ''}${sep}${[e.rang, e.valeur].filter(Boolean).join(' · ')}`);
  if (public_('palmares')) {
    const lignes = [];
    for (const p of fiche.palmares ?? []) {
      lignes.push(`• ${[placementLisible(p, langue), p.competition, p.structure ? `(${p.structure})` : '', p.date ? `— ${p.date.slice(0, 7)}` : ''].filter(Boolean).join(' ')}`);
    }
    for (const t of fiche.calcule?.tournois ?? []) {
      lignes.push(`• ${[placementLisible(t, langue), t.nom, t.teamNom ? `(${t.teamNom})` : ''].filter(Boolean).join(' ')}${t.mvp ? ` · MVP ×${t.mvp}` : ''}`);
    }
    if (lignes.length) L.push(`${T(langue, 'trombi.texte.palmares')}${sep.trimEnd()}`, ...lignes.slice(0, 8));
  }
  if (public_('structures') && fiche.structures?.length) L.push(`${T(langue, 'trombi.texte.structures')}${sep}${fiche.structures.slice(0, 5).map(s => s.structure).join(', ')}`);
  if (public_('reseaux')) for (const r of fiche.reseaux ?? []) L.push(`${r.reseau === 'autre' ? r.libelle : (RESEAUX_COMPTES[r.reseau]?.nom ?? r.reseau)}${sep}${r.url}`);
  return L.filter(Boolean).join('\n');
}
