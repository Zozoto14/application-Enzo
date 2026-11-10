/**
 * Inscriptions d'un événement du club (docs/esport/evenements.md) : lecture des réponses des tickets d'inscription
 * (formulaire de la catégorie, ex. « Inscription The Nuke End ») et nom des rôles Discord des équipes. Fonctions pures,
 * sans base ni réseau. Les réponses sont lues ICI, jamais envoyées à une IA.
 */

export const POSTES = Object.freeze(['joueur', 'coach', 'remplacant']);
export const MODELE_ROLE_DEFAUT = '{tag} {nom}';
export const LIMITES_EQUIPES = Object.freeze({
  equipes: 64,
  membres: 10,
  resolutions: 150,
});

// ------------------------------------------------------------------ Lecture des réponses d'inscription

const MENTION = /<@!?(\d{17,20})>/;
const ID_LIBRE = /(?:^|[^\d])(\d{17,20})(?!\d)/;
const EMBARK = /([^\s|,;:—–<>@]+#\d{4})(?!\d)/;
const PUCE =
  /^\s*(?:[-*•·]+|\d+\s*[.)]|(?:joueur|player|sub|rempla[cç]ant|coach)\s*\d*\s*[:.)-])\s*/i;

/** Une ligne « Discord ID — Embark ID » (mention, ID, @pseudo, Embark ID « nom#1234 », dans tout ordre). */
export function lireLigneMembre(ligne, poste = 'joueur') {
  const brut = String(ligne ?? '')
    .trim()
    .slice(0, 300);
  let reste = brut.replace(PUCE, '');
  let discordId = null;
  const m = MENTION.exec(reste) ?? ID_LIBRE.exec(reste);
  if (m) {
    discordId = m[1];
    reste = reste.replace(m[0].startsWith('<') ? m[0] : m[1], ' ');
  }
  let embarkId = '';
  const e = EMBARK.exec(reste);
  if (e) {
    embarkId = e[1].slice(0, 60);
    reste = reste.replace(e[1], ' ');
  }
  const nom = reste
    .replace(/[—–|,;:()[\]]/g, ' ')
    .replace(/(^|\s)-+(?=\s|$)/g, ' ')
    .replace(/@/g, '')
    .replace(/\b(discord|embark|id)\b\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return { poste, discordId, nom, embarkId, brut };
}

const lignes = v =>
  String(v ?? '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !/^[-—–_.\s]*$/.test(l));
const libelleDe = r =>
  `${r?.libelle?.fr ?? ''} ${r?.libelle?.en ?? ''} ${
    r?.id ?? ''
  }`.toLowerCase();

/**
 * Réponses du formulaire d'un ticket d'inscription (`[{ id, libelle, valeur }]`) → `{ nom, tag, membres, problemes }`.
 * Champs reconnus par leur identifiant (equipe, tag, joueurs, coach, remplacants : catégorie « Inscription The Nuke
 * End ») ou leur libellé (équipe / team, tag, joueur / player, coach, remplaçant / sub).
 */
export function lireReponsesInscription(reponses) {
  const liste = Array.isArray(reponses) ? reponses : [];
  const champ = (ids, motif) =>
    liste.find(r => ids.includes(String(r?.id ?? ''))) ??
    liste.find(r => motif.test(libelleDe(r)));
  const nom = String(
    champ(['equipe', 'nom', 'team'], /(équipe|equipe|team)/)?.valeur ?? '',
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  const tag = String(champ(['tag'], /\btag\b/)?.valeur ?? '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toUpperCase()
    .slice(0, 6);
  const membres = [];
  for (const [poste, ids, motif] of [
    ['joueur', ['joueurs', 'players'], /(joueur|player)/],
    ['coach', ['coach'], /coach/],
    ['remplacant', ['remplacants', 'subs'], /(rempla|\bsubs?\b)/],
  ]) {
    for (const l of lignes(champ(ids, motif)?.valeur))
      if (!/^(aucun|none|n\/a|-|non|no)$/i.test(l))
        membres.push(lireLigneMembre(l, poste));
  }
  const problemes = [];
  if (!nom) problemes.push('nom');
  if (!tag) problemes.push('tag');
  if (!membres.some(x => x.poste === 'joueur')) problemes.push('joueurs');
  if (membres.some(x => !x.discordId)) problemes.push('sans_id');
  return {
    nom,
    tag,
    membres: membres.slice(0, LIMITES_EQUIPES.membres),
    problemes,
  };
}

/** Nom du rôle d'une équipe : modèle et variables {tag}, {nom} (100 caractères au plus). */
export function nomRole(modele, { tag = '', nom = '' }) {
  const s = String(modele || MODELE_ROLE_DEFAUT)
    .replace(/\{(tag|nom)\}/g, (_, k) => (k === 'tag' ? tag : nom))
    .replace(/@(everyone|here)/gi, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return (s || `${tag} ${nom}`.trim() || 'Team').slice(0, 100);
}
