/**
 * Mise en page des messages Discord (bot ET webhook) : de vrais EMBEDS, une
 * couleur et un emoji par type d'événement (les couleurs de l'app), des champs
 * alignés (Quand avec horodatages Discord, Map ou adversaire, Convoqués,
 * Réponses), une miniature (carte, logo de l'adversaire ou de la team), un
 * pied de page et un lien « Ouvrir dans l'app » ; boutons RSVP stylés et
 * pagination. Fonctions PURES (aucune base, aucun réseau) : testées sous Node.
 *
 * Limites de Discord respectées par `bornerEmbed` : titre 256, description
 * 4096, 25 champs, nom de champ 256, valeur 1024, pied 2048, auteur 256, et
 * 6000 caractères au total par message (tous embeds confondus).
 *
 * Aucune mention ne peut sortir d'un embed : Discord n'y notifie jamais
 * personne, et tout texte venu des utilisateurs est neutralisé
 * (nettoyerTexteDiscord). Les seules mentions qui sonnent sont dans `content`,
 * listées une à une dans `allowed_mentions`.
 */

import { texte as T, texteNombre } from '../langues.mjs';
import { nettoyerTexteDiscord } from './messages.mjs';

export const LIMITES_EMBED = Object.freeze({ titre: 256, description: 4096, champs: 25, nomChamp: 256, valeurChamp: 1024, pied: 2048, auteur: 256, total: 6000, embeds: 10 });

/** Couleurs de l'app (src/esport/planning/libelles.ts) et accent du thème « nuit ». */
export const COULEURS_TYPES = Object.freeze({ training: '#2563eb', scrim: '#7c3aed', match: '#dc2626', tournament: '#d97706', meeting: '#0891b2', review: '#0d9488', other: '#64748b' });
export const ACCENT = '#5b8cff';
export const COULEUR_OK = '#16a34a';
export const COULEUR_ALERTE = '#d97706';
export const COULEUR_ERREUR = '#dc2626';
export const EMOJIS_TYPES = Object.freeze({ scrim: '⚔️', match: '🏆', training: '🎯', tournament: '🏟️', meeting: '📋', review: '🔎', other: '📅' });
export const NOMS_TYPES = Object.freeze({ scrim: 'Scrim', match: 'Match', training: 'Entraînement', tournament: 'Tournoi', meeting: 'Réunion', review: 'Review', other: 'Événement' });
/** Nom d'un type d'événement dans une langue (`NOMS_TYPES` : français). */
export const nomType = (type, langue = 'fr') => T(langue, `type.${type in NOMS_TYPES ? type : 'other'}`);

export const couleurEntier = hexa => Number.parseInt(String(hexa).replace('#', ''), 16) || 0;
export const couleurType = type => couleurEntier(COULEURS_TYPES[type] ?? COULEURS_TYPES.other);

/** Horodatage Discord : affiché dans l'heure locale de chaque lecteur (F : date complète, R : « dans 2 h »). */
export const horodatage = (ms, style = 'F') => `<t:${Math.floor(Number(ms) / 1000)}:${style}>`;

/** Bandeau de l'embed selon le message (`nom` : français ; `nomGenre` : dans une langue). */
export const GENRES = Object.freeze({
  event_created: { emoji: '📣', nom: 'Nouvel événement' },
  reminder_d1: { emoji: '⏰', nom: 'Rappel : c’est demain' },
  reminder_h1: { emoji: '⏳', nom: 'Rappel : c’est dans moins d’une heure' },
  event_now: { emoji: '🔴', nom: 'C’est maintenant !' },
  rsvp_missing: { emoji: '🔔', nom: 'Réponds pour cet événement' },
  rsvp_relance: { emoji: '🔔', nom: 'Relance : réponds pour cet événement' },
  rsvp_choix: { emoji: '🗳️', nom: 'Ta réponse' },
});

export const nomGenre = (genre, langue = 'fr') => T(langue, `genre.${genre in GENRES ? genre : 'event_created'}`);

/** Emoji et couleur des autres messages (résumés, tâches, membres…). */
const MESSAGES = {
  summary_published: { emoji: '📝', couleur: '#0891b2' },
  summary_submitted: { emoji: '📥', couleur: '#0891b2' },
  task_assigned: { emoji: '✅', couleur: '#16a34a' },
  task_due: { emoji: '⌛', couleur: '#d97706' },
  member_joined: { emoji: '👋', couleur: ACCENT },
  role_changed: { emoji: '🎖️', couleur: ACCENT },
  review_created: { emoji: '🎬', couleur: '#7c3aed' },
  strat_created: { emoji: '🗺️', couleur: '#7c3aed' },
  playbook_validated: { emoji: '📘', couleur: '#16a34a' },
  resource_created: { emoji: '📚', couleur: '#0d9488' },
  tournament_registered: { emoji: '📝', couleur: '#d97706' },
  match_announced: { emoji: '🏟️', couleur: '#d97706' },
  match_result: { emoji: '🏁', couleur: ACCENT },
  tournament_final: { emoji: '🏆', couleur: '#d97706' },
  test: { emoji: '🛰️', couleur: ACCENT },
  alerte_fil: { emoji: '⚠️', couleur: '#d97706' },
};

const texte = (v, max) => nettoyerTexteDiscord(v, max).trim();
const ligne = (v, max) => texte(v, max).replace(/\s*\n+\s*/g, ' ');
const https = v => (typeof v === 'string' && /^https:\/\/[^\s"<>]+$/.test(v) && v.length <= 2000 ? v : null);

// ------------------------------------------------------------------ Limites

const longueur = v => (typeof v === 'string' ? v.length : 0);

/** Caractères comptés par Discord pour un embed (titre, description, champs, pied, auteur). */
export function tailleEmbed(e) {
  return longueur(e.title) + longueur(e.description) + longueur(e.footer?.text) + longueur(e.author?.name) + (e.fields ?? []).reduce((n, f) => n + longueur(f.name) + longueur(f.value), 0);
}

const couper = (v, max) => (typeof v === 'string' && v.length > max ? `${v.slice(0, max - 1)}…` : v);

/** Embed ramené dans les limites de Discord (`budget` : caractères encore permis dans le message). */
export function bornerEmbed(embed, budget = LIMITES_EMBED.total) {
  const e = { ...embed };
  if (e.title !== undefined) e.title = couper(e.title, LIMITES_EMBED.titre);
  if (e.description !== undefined) e.description = couper(e.description, LIMITES_EMBED.description);
  if (e.author) e.author = { ...e.author, name: couper(e.author.name, LIMITES_EMBED.auteur) };
  if (e.footer) e.footer = { ...e.footer, text: couper(e.footer.text, LIMITES_EMBED.pied) };
  if (e.fields) {
    e.fields = e.fields
      .filter(f => f && f.name && f.value)
      .slice(0, LIMITES_EMBED.champs)
      .map(f => ({ ...f, name: couper(f.name, LIMITES_EMBED.nomChamp), value: couper(f.value, LIMITES_EMBED.valeurChamp) }));
  }
  // Total : on raccourcit d'abord la description, puis on retire les derniers champs.
  let exces = tailleEmbed(e) - budget;
  if (exces > 0 && e.description) {
    const garde = Math.max(0, e.description.length - exces - 1);
    e.description = garde > 0 ? `${e.description.slice(0, garde)}…` : undefined;
    exces = tailleEmbed(e) - budget;
  }
  while (exces > 0 && e.fields?.length) {
    e.fields.pop();
    exces = tailleEmbed(e) - budget;
  }
  if (exces > 0 && e.footer) e.footer = { ...e.footer, text: couper(e.footer.text, Math.max(2, e.footer.text.length - exces)) };
  if (e.fields && e.fields.length === 0) delete e.fields;
  return e;
}

/** Liste d'embeds bornée (10 au plus, 6000 caractères en tout). */
export function bornerEmbeds(embeds) {
  let reste = LIMITES_EMBED.total;
  const sortie = [];
  for (const e of embeds.slice(0, LIMITES_EMBED.embeds)) {
    if (reste <= 0) break;
    const b = bornerEmbed(e, reste);
    reste -= tailleEmbed(b);
    sortie.push(b);
  }
  return sortie;
}

// ------------------------------------------------------------------ Événements

/** Champ « Réponses » : ✅ / 🤔 / ❌ et ⏳ sans réponse. */
export function texteReponses(r = {}, langue = 'fr') {
  return `✅ **${r.oui ?? 0}** ${T(langue, 'rep.oui')} · 🤔 **${r.peut_etre ?? 0}** ${T(langue, 'rep.peut_etre')} · ❌ **${r.non ?? 0}** ${T(langue, 'rep.non')}${r.sans ? ` · ⏳ ${T(langue, 'rep.sans_reponse', { n: r.sans })}` : ''}`;
}

/**
 * Liste des convoqués pour un champ : les liés en `<@id>` (affiché comme un nom,
 * ne prévient personne dans un embed), les autres par leur pseudo. Tronquée
 * proprement (« et 4 autres ») sous 1024 caractères.
 */
export function texteConvoques(convoques = [], langue = 'fr') {
  if (convoques.length === 0) return T(langue, 'convoques.toute_la_team');
  const morceaux = convoques.map(c => (c.discordId && /^\d{5,25}$/.test(c.discordId) ? `<@${c.discordId}>` : ligne(c.pseudo, 40)));
  let sortie = '';
  for (let i = 0; i < morceaux.length; i++) {
    const suivant = sortie ? `${sortie} · ${morceaux[i]}` : morceaux[i];
    if (suivant.length > LIMITES_EMBED.valeurChamp - 30) {
      const reste = morceaux.length - i;
      return `${sortie} · ${texteNombre(langue, 'convoques.et_autres', reste)}`;
    }
    sortie = suivant;
  }
  return sortie;
}

/**
 * Embed d'un événement du planning.
 *  - `genre` : clé de GENRES (event_created, reminder_d1…) ;
 *  - `occurrence` : `{ titre, type, debut, fin, lieu }` (ms) ;
 *  - `team` : `{ nom, logo }` ; `carte` : `{ nom, image }` ; `adversaire` : `{ nom, logo }` ;
 *  - `convoques` : `[{ pseudo, discordId }]` ; `reponses` : `{ oui, peut_etre, non, sans }` (null : présence inactive) ;
 *  - `texte` : message de la team (modèle rendu) ; `lien` : adresse de l'app ; `maintenant` (ms).
 */
export function embedEvenement({ genre = 'event_created', occurrence, team = {}, carte = null, adversaire = null, convoques = [], reponses = null, texte: message = '', lien = '', maintenant = Date.now(), langue = 'fr' }) {
  const type = occurrence.type in EMOJIS_TYPES ? occurrence.type : 'other';
  const g = { emoji: (GENRES[genre] ?? GENRES.event_created).emoji, nom: nomGenre(genre, langue) };
  const champs = [{ name: `🕒 ${T(langue, 'embed.quand')}`, value: `${horodatage(occurrence.debut, 'F')}\n${horodatage(occurrence.debut, 'R')}`, inline: true }];
  if (occurrence.fin) champs.push({ name: `⌛ ${T(langue, 'embed.fin')}`, value: horodatage(occurrence.fin, 't'), inline: true });
  if (carte?.nom) champs.push({ name: `🗺️ ${T(langue, 'embed.map')}`, value: ligne(carte.nom, 60), inline: true });
  if (adversaire?.nom) champs.push({ name: `🆚 ${T(langue, 'embed.adversaire')}`, value: ligne(adversaire.nom, 80), inline: true });
  if (occurrence.lieu) champs.push({ name: `📍 ${T(langue, 'embed.lieu')}`, value: ligne(occurrence.lieu, 200), inline: true });
  champs.push({ name: `👥 ${T(langue, 'embed.convoques', { n: convoques.length })}`, value: texteConvoques(convoques, langue), inline: false });
  if (reponses) champs.push({ name: `🗳️ ${T(langue, 'embed.reponses')}`, value: texteReponses(reponses, langue), inline: false });
  const miniature = https(carte?.image) ?? https(adversaire?.logo) ?? https(team.logo);
  const lienApp = https(lien);
  const embed = {
    author: { name: `${g.emoji} ${g.nom}` },
    title: `${EMOJIS_TYPES[type]} ${nomType(type, langue)} · ${ligne(occurrence.titre, 200)}`,
    ...(lienApp ? { url: lienApp } : {}),
    color: couleurType(type),
    ...(message ? { description: texte(message, 1500) } : {}),
    fields: champs,
    ...(miniature ? { thumbnail: { url: miniature } } : {}),
    footer: { text: `${ligne(team.nom || 'Esport', 80)} · Esport`, ...(https(team.logo) ? { icon_url: team.logo } : {}) },
    timestamp: new Date(maintenant).toISOString(),
  };
  return bornerEmbed(embed);
}

/** Embed d'un message simple (résumé publié, tâche…) : `cle` donne l'emoji et la couleur. */
export function embedMessage({ cle = 'test', titre, texte: message = '', team = {}, lien = '', maintenant = Date.now(), couleur }) {
  const m = MESSAGES[cle] ?? { emoji: '🛰️', couleur: ACCENT };
  const lienApp = https(lien);
  return bornerEmbed({
    title: `${m.emoji} ${ligne(titre, 200)}`,
    ...(lienApp ? { url: lienApp } : {}),
    color: couleurEntier(couleur ?? m.couleur),
    ...(message ? { description: texte(message, 3000) } : {}),
    footer: { text: `${ligne(team.nom || 'Esport', 80)} · Esport`, ...(https(team.logo) ? { icon_url: team.logo } : {}) },
    timestamp: new Date(maintenant).toISOString(),
  });
}

/** Emoji d'un type de ressource. */
export const EMOJIS_RESSOURCE = Object.freeze({ lien: '🔗', youtube: '▶️', fichier: '📎', note: '📝' });

/**
 * Embed d'une ressource publiée (module Ressources) : titre (lien vers la ressource si c'est une page
 * web), catégorie, type, niveau, map ou agent, auteur, aperçu (description et image de la page, ou
 * miniature de la vidéo), message de la team, pied et horodatage. Tout texte est neutralisé.
 *  - `ressource` : `{ titre, genre, url, niveau, carte, agent, apercu: { titre, description, image, site } }` ;
 *  - `categorie` : nom affiché ; `auteur` : pseudo ; `texte` : modèle rendu ; `lien` : adresse de l'app.
 */
export function embedRessource({ ressource, categorie = '', auteur = '', texte: message = '', team = {}, lien = '', maintenant = Date.now(), langue = 'fr' }) {
  const genre = ressource.genre in EMOJIS_RESSOURCE ? ressource.genre : 'lien';
  const apercu = ressource.apercu ?? {};
  const champs = [{ name: `🗂️ ${T(langue, 'ressource.categorie')}`, value: ligne(categorie || T(langue, 'ressource.sans_categorie'), 80), inline: true }];
  champs.push({ name: `${EMOJIS_RESSOURCE[genre]} ${T(langue, 'ressource.type')}`, value: T(langue, `ressource.genre.${genre}`), inline: true });
  if (ressource.niveau) champs.push({ name: `📈 ${T(langue, 'ressource.niveau')}`, value: T(langue, `ressource.niveau.${ressource.niveau}`), inline: true });
  if (ressource.carte) champs.push({ name: `🗺️ ${T(langue, 'embed.map')}`, value: ligne(ressource.carte, 40), inline: true });
  if (ressource.agent) champs.push({ name: `🎭 ${T(langue, 'ressource.agent')}`, value: ligne(ressource.agent, 40), inline: true });
  if (auteur) champs.push({ name: `✍️ ${T(langue, 'ressource.par')}`, value: ligne(auteur, 60), inline: true });
  const cible = ressource.genre === 'lien' || ressource.genre === 'youtube' ? https(ressource.url) : null;
  const description = [message ? texte(message, 1200) : '', apercu.description ? `> ${ligne(apercu.description, 400)}` : ''].filter(Boolean).join('\n\n');
  const image = https(apercu.image);
  return bornerEmbed({
    author: { name: `📚 ${T(langue, 'ressource.entete')}${apercu.site ? ` · ${ligne(apercu.site, 60)}` : ''}` },
    title: `${EMOJIS_RESSOURCE[genre]} ${ligne(ressource.titre, 200)}`,
    ...(cible ?? https(lien) ? { url: cible ?? https(lien) } : {}),
    color: couleurEntier(MESSAGES.resource_created.couleur),
    ...(description ? { description } : {}),
    fields: champs,
    ...(image ? { image: { url: image } } : https(team.logo) ? { thumbnail: { url: team.logo } } : {}),
    footer: { text: `${ligne(team.nom || 'Esport', 80)} · Esport`, ...(https(team.logo) ? { icon_url: team.logo } : {}) },
    timestamp: new Date(maintenant).toISOString(),
  });
}

/** Boutons d'une ressource : « Ouvrir le lien » (page web ou vidéo) et « Ouvrir dans l'app ». */
export function boutonsRessource(urlRessource, lien, langue = 'fr') {
  const boutons = [];
  if (https(urlRessource)) boutons.push({ type: 2, style: 5, label: T(langue, 'ressource.ouvrir_lien'), emoji: { name: '🔗' }, url: urlRessource });
  if (https(lien)) boutons.push({ type: 2, style: 5, label: T(langue, 'bouton.ouvrir_app'), emoji: { name: '📲' }, url: lien });
  return boutons.length ? [{ type: 1, components: boutons }] : [];
}

/** Couleur d'un résultat : vert (victoire), rouge (défaite), gris (nul), or (podium d'un classement). */
function couleurResultat(r) {
  if (r.systeme === 'classement') return r.place === 1 ? '#d4a017' : r.place && r.place <= 3 ? '#16a34a' : ACCENT;
  return r.issue === 'victoire' ? COULEUR_OK : r.issue === 'defaite' ? COULEUR_ERREUR : '#64748b';
}

const EMOJI_ISSUE = { victoire: '✅', defaite: '❌', nul: '➖' };

/**
 * Embed d'un message « compétition » (modules Tournois et Résultats), tiré du RÉSUMÉ PUBLIABLE
 * (competition/resume.mjs) : annonce de match, résultat (score, maps et manches, MVP, alignés),
 * inscription ou classement final d'un tournoi (classement, parcours, gains). Tout texte est neutralisé.
 *  - `cle` : match_announced | match_result | tournament_registered | tournament_final ;
 *  - `resume` : résumé dans la langue du message ; `texte` : modèle rendu ; `lien` : adresse de l'app.
 */
export function embedCompetition({ cle, resume: r, texte: message = '', lien = '', maintenant = Date.now(), langue = 'fr' }) {
  const m = MESSAGES[cle] ?? { emoji: '🏆', couleur: ACCENT };
  const champs = [];
  const adversaires = (r.adversaires ?? []).map(a => ligne(a.nom, 40)).filter(Boolean);
  const pied = { text: `${ligne(r.team?.nom || 'Esport', 80)}${r.jeu?.nom ? ` · ${ligne(r.jeu.nom, 30)}` : ''} · Esport`, ...(https(r.team?.logo) ? { icon_url: r.team.logo } : {}) };
  const lienApp = https(lien);
  let entete;
  let titre;
  let couleur = m.couleur;
  const description = message ? texte(message, 1500) : '';
  let miniature = https(r.team?.logo);
  if (cle === 'match_result') {
    entete = `${m.emoji} ${T(langue, 'competition.entete.resultat')} · ${ligne(r.libelleGenre ?? '', 40)}`;
    titre = r.systeme === 'classement' ? `${r.place === 1 ? '🥇' : r.place === 2 ? '🥈' : r.place === 3 ? '🥉' : '🏁'} ${ligne(r.phrase, 200)}` : `${EMOJI_ISSUE[r.issue] ?? '🏁'} ${ligne(r.phrase, 200)}`;
    couleur = couleurResultat(r);
    if (r.tournoi) champs.push({ name: `🏟️ ${T(langue, 'competition.champ.tournoi')}`, value: ligne([r.tournoi.nom, r.tour].filter(Boolean).join(' · '), 120), inline: true });
    if (adversaires.length) champs.push({ name: `🆚 ${T(langue, adversaires.length > 1 ? 'competition.champ.adversaires' : 'embed.adversaire')}`, value: adversaires.slice(0, 8).join(', '), inline: true });
    if (r.format || r.bo) champs.push({ name: `🎮 ${T(langue, 'competition.champ.format')}`, value: [r.format?.libelle, r.bo && r.systeme === 'serie' ? `BO${r.bo}` : null].filter(Boolean).join(' · '), inline: true });
    if (r.systeme === 'classement') {
      if (r.participants) champs.push({ name: `📊 ${T(langue, 'competition.champ.classement')}`, value: T(langue, 'competition.place_sur', { place: r.libellePlace ?? '', n: r.participants }), inline: true });
      if (r.points !== null && r.points !== undefined) champs.push({ name: `🔢 ${T(langue, 'competition.champ.points')}`, value: T(langue, 'competition.points', { n: r.points }), inline: true });
    }
    const manches = (r.manches ?? []).map(x => {
      const nom = [x.carte, x.mode].filter(Boolean).map(v => ligne(v, 30)).join(' · ') || T(langue, 'competition.manche', { n: x.numero });
      if (r.systeme === 'classement') return `${nom} — ${x.place ? `#${x.place}` : '?'}${x.points !== null && x.points !== undefined ? ` · ${T(langue, 'competition.points', { n: x.points })}` : ''}`;
      return `${EMOJI_ISSUE[x.issue] ?? '·'} ${nom}${x.score ? ` — **${x.score}**` : ''}${x.prolongations ? ` (${T(langue, 'competition.prolongations')})` : ''}`;
    });
    if (manches.length) champs.push({ name: `🗺️ ${T(langue, 'competition.champ.manches')}`, value: manches.slice(0, 12).join('\n'), inline: false });
    if (r.mvp) champs.push({ name: `⭐ ${T(langue, 'competition.champ.mvp')}`, value: ligne(r.mvp, 40), inline: true });
    if (r.joueurs?.length) champs.push({ name: `👥 ${T(langue, 'competition.champ.joueurs')}`, value: r.joueurs.map(j => `${ligne(j.pseudo ?? '?', 30)}${j.personnages?.length ? ` (${j.personnages.slice(0, 3).map(p => ligne(p, 20)).join(', ')})` : ''}`).slice(0, 10).join(' · '), inline: false });
  } else if (cle === 'match_announced') {
    entete = `${m.emoji} ${T(langue, 'competition.entete.annonce')}`;
    titre = `🏟️ ${ligne(r.titre, 200)}`;
    if (Number.isFinite(Date.parse(r.debut))) champs.push({ name: `🕒 ${T(langue, 'embed.quand')}`, value: `${horodatage(Date.parse(r.debut), 'F')} · ${horodatage(Date.parse(r.debut), 'R')}`, inline: false });
    if (adversaires.length) champs.push({ name: `🆚 ${T(langue, adversaires.length > 1 ? 'competition.champ.adversaires' : 'embed.adversaire')}`, value: adversaires.slice(0, 8).join(', '), inline: true });
    if (r.format || r.bo) champs.push({ name: `🎮 ${T(langue, 'competition.champ.format')}`, value: [r.format?.libelle, r.bo ? `BO${r.bo}` : null].filter(Boolean).join(' · '), inline: true });
    if (r.lieu) champs.push({ name: `📍 ${T(langue, 'embed.lieu')}`, value: ligne(r.lieu, 100), inline: true });
    if (r.roster?.length) champs.push({ name: `👥 ${T(langue, 'competition.champ.roster')}`, value: r.roster.map(p => ligne(p, 30)).slice(0, 12).join(' · '), inline: false });
    const logoAdv = (r.adversaires ?? []).map(a => https(a.logoUrl)).find(Boolean);
    if (logoAdv) miniature = logoAdv;
  } else {
    // Tournoi : inscription ou classement final.
    const final = cle === 'tournament_final';
    entete = `${m.emoji} ${T(langue, final ? 'competition.entete.classement' : 'competition.entete.inscription')}`;
    titre = `${final ? (r.classementFinal === 1 ? '🥇' : r.classementFinal === 2 ? '🥈' : r.classementFinal === 3 ? '🥉' : '🏆') : '📝'} ${ligne(final ? r.phraseFinal : r.phraseInscription, 200)}`;
    if (final && r.classementFinal === 1) couleur = '#d4a017';
    if (r.organisateur) champs.push({ name: `🏢 ${T(langue, 'competition.champ.organisateur')}`, value: ligne(r.organisateur, 80), inline: true });
    if (r.debut) champs.push({ name: `📅 ${T(langue, 'competition.champ.dates')}`, value: r.fin && r.fin !== r.debut ? T(langue, 'competition.du_au', { debut: r.debut, fin: r.fin }) : r.debut, inline: true });
    if (r.format) champs.push({ name: `🎮 ${T(langue, 'competition.champ.format')}`, value: ligne(r.format.libelle, 40), inline: true });
    if (r.lieu) champs.push({ name: `📍 ${T(langue, 'embed.lieu')}`, value: ligne(r.lieu, 100), inline: true });
    if (final && r.texteClassement) champs.push({ name: `📊 ${T(langue, 'competition.champ.classement')}`, value: ligne(r.texteClassement, 60), inline: true });
    if (final && r.gains) champs.push({ name: `💰 ${T(langue, 'competition.champ.gains')}`, value: ligne(r.gains, 40), inline: true });
    if (final && r.parcours?.length) {
      const lignes = r.parcours.slice(0, 12).map(p => `${EMOJI_ISSUE[p.issue] ?? '·'} ${p.tour ? `${ligne(p.tour, 30)} — ` : ''}${p.adversaires.map(a => ligne(a.nom, 30)).join(', ') || '?'}${p.score ? ` **${ligne(p.score, 12)}**` : p.place ? ` #${p.place}` : ''}`);
      champs.push({ name: `🧭 ${T(langue, 'competition.champ.parcours')}`, value: lignes.join('\n'), inline: false });
    }
    if (r.roster?.length) champs.push({ name: `👥 ${T(langue, 'competition.champ.roster')}`, value: r.roster.map(p => ligne(p.pseudo, 30)).slice(0, 12).join(' · '), inline: false });
  }
  const cible = https(r.tournoi?.lien ?? r.lien) ?? lienApp;
  return bornerEmbed({
    author: { name: entete },
    title: titre,
    ...(cible ? { url: cible } : {}),
    color: couleurEntier(couleur),
    ...(description ? { description } : {}),
    fields: champs,
    ...(miniature ? { thumbnail: { url: miniature } } : {}),
    footer: pied,
    timestamp: new Date(maintenant).toISOString(),
  });
}

/** Boutons d'un message compétition : « Page du tournoi » (si https) et « Ouvrir dans l'app ». */
export function boutonsCompetition(lienTournoi, lien, langue = 'fr') {
  const boutons = [];
  if (https(lienTournoi)) boutons.push({ type: 2, style: 5, label: T(langue, 'competition.page_tournoi'), emoji: { name: '🏟️' }, url: lienTournoi });
  if (https(lien)) boutons.push({ type: 2, style: 5, label: T(langue, 'bouton.ouvrir_app'), emoji: { name: '📲' }, url: lien });
  return boutons.length ? [{ type: 1, components: boutons }] : [];
}

/** Embed de réponse à une commande : titre, couleur, lignes `{ nom, valeur }` en champs, pied facultatif. */
export function embedReponse({ titre, description = '', couleur = ACCENT, champs = [], pied = 'Esport', lien = '', miniature }) {
  const lienApp = https(lien);
  return bornerEmbed({
    title: ligne(titre, 250),
    ...(lienApp ? { url: lienApp } : {}),
    color: typeof couleur === 'number' ? couleur : couleurEntier(couleur),
    ...(description ? { description } : {}),
    ...(champs.length ? { fields: champs.map(c => ({ name: c.nom, value: c.valeur, inline: Boolean(c.inline) })) } : {}),
    ...(https(miniature) ? { thumbnail: { url: miniature } } : {}),
    footer: { text: pied },
  });
}

// ------------------------------------------------------------------ Composants

/** Occurrence (ISO) ⇄ texte court base 36 (identifiants de boutons, 100 caractères au plus). */
export const occurrenceCourte = iso => Date.parse(iso).toString(36);
export const occurrenceLongue = court => {
  const ms = Number.parseInt(String(court), 36);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

export const REPONSES_BOUTONS = Object.freeze({ o: 'oui', p: 'peut_etre', n: 'non' });

/** Boutons RSVP (vert Oui, gris Peut-être, rouge Non) et lien « Ouvrir dans l'app ». */
export function boutonsRsvp(evenementId, occurrenceIso, { lien = '', desactive = false, langue = 'fr' } = {}) {
  const base = `r:${evenementId}:${occurrenceCourte(occurrenceIso)}`;
  const boutons = [
    { type: 2, style: 3, label: T(langue, 'bouton.oui'), emoji: { name: '✅' }, custom_id: `${base}:o`, disabled: desactive },
    { type: 2, style: 2, label: T(langue, 'bouton.peut_etre'), emoji: { name: '🤔' }, custom_id: `${base}:p`, disabled: desactive },
    { type: 2, style: 4, label: T(langue, 'bouton.non'), emoji: { name: '❌' }, custom_id: `${base}:n`, disabled: desactive },
  ];
  if (https(lien)) boutons.push({ type: 2, style: 5, label: T(langue, 'bouton.ouvrir_app'), emoji: { name: '📲' }, url: lien });
  return [{ type: 1, components: boutons }];
}

/** Boutons d'un MP de test : mêmes libellés que la relance, mais ils répondent « Test reçu » et n'enregistrent rien. */
export function boutonsTestMp(langue = 'fr') {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 3, label: T(langue, 'bouton.oui'), emoji: { name: '✅' }, custom_id: 'tmp:o' },
        { type: 2, style: 2, label: T(langue, 'bouton.peut_etre'), emoji: { name: '🤔' }, custom_id: 'tmp:p' },
        { type: 2, style: 4, label: T(langue, 'bouton.non'), emoji: { name: '❌' }, custom_id: 'tmp:n' },
      ],
    },
  ];
}

/** Seul bouton lien « Ouvrir dans l'app » (webhooks : pas de boutons interactifs). */
export function boutonLien(lien, libelle, langue = 'fr') {
  return https(lien) ? [{ type: 1, components: [{ type: 2, style: 5, label: libelle ?? T(langue, 'bouton.ouvrir_app'), emoji: { name: '📲' }, url: lien }] }] : [];
}

/** Pagination : « ◀ Précédent » · « page / total » · « Suivant ▶ ». `cle` identifie la liste (100 caractères au plus). */
export function boutonsPagination(cle, page, pages, langue = 'fr') {
  if (pages <= 1) return [];
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 2, label: T(langue, 'bouton.precedent'), emoji: { name: '◀️' }, custom_id: `pg:${cle}:${page - 1}`, disabled: page <= 1 },
        { type: 2, style: 2, label: `${page} / ${pages}`, custom_id: `pg:noop:${page}`, disabled: true },
        { type: 2, style: 2, label: T(langue, 'bouton.suivant'), emoji: { name: '▶️' }, custom_id: `pg:${cle}:${page + 1}`, disabled: page >= pages },
      ],
    },
  ];
}

/** Découpe une liste en pages (`parPage` éléments). Rend `{ elements, page, pages }`. */
export function paginer(liste, page = 1, parPage = 6) {
  const pages = Math.max(1, Math.ceil(liste.length / parPage));
  const p = Math.min(Math.max(1, Math.floor(Number(page)) || 1), pages);
  return { elements: liste.slice((p - 1) * parPage, p * parPage), page: p, pages };
}

// ------------------------------------------------------------------ Cartes (Valorant)

/** Cartes connues (valorant-api.com) : nom → identifiant de l'image. */
const CARTES = {
  ascent: ['Ascent', '7eaecc1b-4337-bbf6-6ab9-04b8f06b3319'],
  bind: ['Bind', '2c9d57ec-4431-9c5e-2939-8f9ef6dd5cba'],
  haven: ['Haven', '2bee0dc9-4ffe-519b-1cbd-7fbe763a6047'],
  split: ['Split', 'd960549e-485c-e861-8d71-aa9d1aed12a2'],
  icebox: ['Icebox', 'e2ad5c54-4114-a870-9641-8ea21279579a'],
  breeze: ['Breeze', '2fb9a4fd-47b8-4e7d-a969-74b4046ebd53'],
  fracture: ['Fracture', 'b529448b-4d60-346e-e89e-00a4c527a405'],
  pearl: ['Pearl', 'fd267378-4d1d-484f-ff52-77821ed10dc2'],
  lotus: ['Lotus', '2fe4ed3a-450a-948b-6d6b-e89a78e680a9'],
  sunset: ['Sunset', '92584fbe-486a-b1b2-9faa-39b0f486b498'],
  abyss: ['Abyss', '224b0a95-48b9-f703-1bd8-67aca101a61f'],
};

/** Carte citée dans un texte (titre, lieu, description) : `{ cle, nom, image }` ou null. */
export function carteDans(...textes) {
  const t = textes.filter(Boolean).join(' ').toLowerCase();
  for (const [cle, [nom, id]] of Object.entries(CARTES)) {
    if (new RegExp(`(^|[^a-z])${cle}([^a-z]|$)`).test(t)) return { cle, nom, image: `https://media.valorant-api.com/maps/${id}/listviewicon.png` };
  }
  return null;
}

/** Image d'une carte par sa clé (« ascent »), si connue. */
export const imageCarte = cle => (CARTES[cle] ? `https://media.valorant-api.com/maps/${CARTES[cle][1]}/listviewicon.png` : null);
