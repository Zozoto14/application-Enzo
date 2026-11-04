/**
 * Tickets : panneaux (messages fixes publiés par le bot, avec boutons ou menu déroulant) et message d'accueil d'un
 * ticket. Fonctions PURES : la même charge sert à la publication et à l'aperçu « comme sur Discord » de l'app.
 *
 * Identifiants des composants (custom_id, 100 caractères au plus) :
 *   tk:o:<catégorie>   bouton « ouvrir un ticket » d'une catégorie (panneau à boutons) ;
 *   tk:s               menu des catégories (panneau à menu ; valeur = catégorie) ;
 *   tk:c:<ticket>      prendre en charge ; tk:a:<ticket> ajouter quelqu'un ; tk:p:<ticket> priorité ;
 *   tk:x:<ticket>      fermer (demande de confirmation) ; tk:r:<ticket> rouvrir.
 */

import { bilingue, libelle2, nom2, ordreLangues, sur, surLong, t as tx } from './textes.mjs';

const couleurNum = c => Number.parseInt(String(c ?? '#5865f2').replace('#', ''), 16) || 0x5865f2;
export const NOM_IMAGE_PANNEAU = 'panneau.png';

/**
 * Charge Discord d'un panneau. `categories` : lignes publiques (reglages.mjs : categoriePublique) dans l'ordre voulu ;
 * `image` : true si une image du Drive est jointe (`attachment://panneau.png`).
 */
export function chargePanneau(panneau, categories, { mode = 'en_fr', image = false } = {}) {
  const opts = { mode: mode === 'auteur' ? 'en_fr' : mode };
  const titre = bilingue(panneau.titre, { ...opts, max: 256 }).replace(/\n\n> /g, ' · ').split('\n')[0].slice(0, 256);
  const embed = {
    title: titre,
    description: bilingue(panneau.texte, { ...opts, max: 4000 }) || undefined,
    color: couleurNum(panneau.couleur),
    ...(image ? { image: { url: `attachment://${NOM_IMAGE_PANNEAU}` } } : {}),
  };
  const actives = categories.filter(c => c.actif).slice(0, 25);
  let components = [];
  if (panneau.style === 'menu') {
    if (actives.length) {
      components = [
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: 'tk:s',
              placeholder: libelle2('choisir_categorie', { ...opts, max: 150 }),
              options: actives.map(c => ({ label: nom2(c.nom, { ...opts, max: 100 }), value: c.id, ...(nom2(c.description, { ...opts, max: 100 }) ? { description: nom2(c.description, { ...opts, max: 100 }) } : {}) })),
            },
          ],
        },
      ];
    }
  } else {
    for (let i = 0; i < actives.length; i += 5) {
      components.push({ type: 1, components: actives.slice(i, i + 5).map((c, j) => ({ type: 2, style: (i + j) % 2 === 0 ? 1 : 2, custom_id: `tk:o:${c.id}`, label: nom2(c.nom, { ...opts, max: 80 }) })) });
    }
  }
  return { embeds: [embed], components, allowed_mentions: { parse: [] } };
}

const NOMS_PRIORITE = { faible: 'p_faible', moyen: 'p_moyen', urgent: 'p_urgent', critique: 'p_critique' };
const COULEURS_PRIORITE = { faible: 0x4caf7a, moyen: 0x5865f2, urgent: 0xe8a23a, critique: 0xd9534f };
export const nomPriorite = (langue, p) => tx(langue, NOMS_PRIORITE[p] ?? 'p_moyen');

/** Boutons du message d'accueil d'un ticket ouvert. */
export function boutonsTicket(ticketId, opts) {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 1, custom_id: `tk:c:${ticketId}`, label: libelle2('b_prendre', opts) },
        { type: 2, style: 2, custom_id: `tk:a:${ticketId}`, label: libelle2('b_ajouter', opts) },
        { type: 2, style: 2, custom_id: `tk:p:${ticketId}`, label: libelle2('b_priorite', opts) },
        { type: 2, style: 4, custom_id: `tk:x:${ticketId}`, label: libelle2('b_fermer', opts) },
      ],
    },
  ];
}

/**
 * Message d'accueil d'un ticket : mention de l'auteur (et des rôles à prévenir), texte d'accueil bilingue, réponses
 * du formulaire, boutons. `accueil` : texte déjà composé (variables remplies).
 */
export function chargeAccueil({ ticket, categorie, accueil, mentions = [], opts }) {
  const champs = [];
  const reponses = Array.isArray(ticket.reponses) ? ticket.reponses : [];
  for (const r of reponses.slice(0, 5)) {
    champs.push({ name: nom2(r.libelle ?? { fr: r.id, en: r.id }, { ...opts, max: 256 }) || '—', value: surLong(r.valeur, 1000) || '—' });
  }
  champs.push({ name: libelle2('priorite', opts), value: [...new Set(ordreLangues(opts?.mode, opts?.langue).map(l => nomPriorite(l, ticket.priorite)))].join(' · '), inline: true });
  champs.push({ name: libelle2('categorie', opts), value: nom2(categorie.nom, opts), inline: true });
  return {
    content: [`<@${ticket.auteur_discord_id}>`, ...mentions.map(r => `<@&${r}>`)].join(' '),
    embeds: [{ title: titreTicket(ticket.numero, opts), description: accueil.slice(0, 4000), color: COULEURS_PRIORITE[ticket.priorite] ?? couleurNum(categorie.couleur), fields: champs }],
    components: boutonsTicket(ticket.id, opts),
    allowed_mentions: { users: [ticket.auteur_discord_id], roles: mentions.slice(0, 5) },
  };
}

/** Titre « Ticket n° 12 · Ticket #12 » (bilingue). */
export const titreTicket = (numero, opts) => [...new Set(ordreLangues(opts?.mode, opts?.langue).map(l => tx(l, 'ticket', { numero })))].join(' · ');

/** Nom de salon Discord à partir du modèle (minuscules, chiffres, tirets ; 100 caractères au plus). */
export function nomSalon(modele, { numero, pseudo, categorie }) {
  const brut = String(modele || 'ticket-{numero}')
    .replace(/\{numero\}/g, String(numero).padStart(4, '0'))
    .replace(/\{pseudo\}/g, sur(pseudo, 40))
    .replace(/\{categorie\}/g, sur(categorie, 40));
  const nom = brut
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
  return nom || `ticket-${numero}`;
}
