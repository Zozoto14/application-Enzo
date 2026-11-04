/**
 * Tickets : interactions Discord (boutons des panneaux, menus, fenêtres, commandes /ticket et /tickets), branchées
 * dans le bot existant (discord/bot/interactions.mjs : même adresse, signature vérifiée). Une interaction des tickets
 * ne demande PAS de compte lié : tout membre du serveur du club peut ouvrir un ticket.
 *
 * Qui est « staff » d'un ticket (prendre en charge, ajouter quelqu'un, priorité, rouvrir…) : un membre qui a un des
 * rôles Discord de la catégorie, un administrateur du serveur, ou une personne dont le compte Esport lié voit la
 * catégorie et a `tickets.repondre`. L'auteur peut fermer son propre ticket.
 *
 * Identifiants (`custom_id`) : voir panneaux.mjs ; en plus, `tk:f:<catégorie>` (fenêtre du formulaire), `tk:as:` et
 * `tk:ps:` (choix d'une personne, d'une priorité), `tk:xc:` / `tk:xr:` / `tk:xm:` (confirmation, raison, fenêtre de la
 * raison), `tk:n:<ticket>:<note>` et `tk:nc:<ticket>:<note>` (note dans le MP, puis commentaire).
 *
 * `interaction(i)` rend la réponse à donner à Discord, ou `undefined` si l'interaction n'est pas pour les tickets.
 */

import { lireLangue } from '../langues.mjs';
import { droitsTickets, voitCategorie } from './acces.mjs';
import { estRefus } from './cycle.mjs';
import { nomDiscord } from './conversation.mjs';
import { nomPriorite } from './panneaux.mjs';
import { lireCommandes, lireGeneral } from './reglages.mjs';
import { t } from './textes.mjs';

const EPHEMERE = 64;
const T = { COMMANDE: 2, COMPOSANT: 3, AUTOCOMPLETE: 4, FENETRE: 5 };
const PERMISSION_ADMIN = 0x8n;

export const estInteractionTickets = i => {
  const id = String(i?.data?.custom_id ?? '');
  return id.startsWith('tk:') || ((i?.type === T.COMMANDE || i?.type === T.AUTOCOMPLETE) && ['ticket', 'tickets'].includes(i?.data?.name));
};

const avis = texte => ({ type: 4, data: { content: String(texte).slice(0, 2000), flags: EPHEMERE, allowed_mentions: { parse: [] } } });
const fenetre = (custom_id, titre, champs) => ({ type: 9, data: { custom_id, title: String(titre).slice(0, 45) || 'Ticket', components: champs.map(c => ({ type: 1, components: [c] })) } });
const valeursFenetre = i => Object.fromEntries((i.data?.components ?? []).flatMap(r => r.components ?? []).map(c => [String(c.custom_id), String(c.value ?? '')]));
/** Sous-commande et options de /ticket (ou options de /tickets). */
function commande(i) {
  const premier = i.data?.options?.[0];
  if (i.data?.name === 'ticket' && premier && Number(premier.type) === 1) return { nom: premier.name, options: Object.fromEntries((premier.options ?? []).map(o => [o.name, o.value])) };
  return { nom: 'tickets', options: Object.fromEntries((i.data?.options ?? []).map(o => [o.name, o.value])) };
}

export function creerBotTickets({ base, maintenant = () => Date.now(), cycle }) {
  async function langueDe(i) {
    const u = i.member?.user ?? i.user;
    const l = u?.id ? await base.premier('SELECT c.langue FROM discord_comptes dc JOIN comptes c ON c.id = dc.compte_id WHERE dc.discord_user_id = ?', [u.id]) : null;
    return lireLangue(l?.langue) ?? (/^fr([-_]|$)/i.test(String(i.locale ?? '')) ? 'fr' : 'en');
  }

  /** La personne qui agit : `{ discordId, nom, compte? }` (compte Esport lié, s'il y en a un). */
  async function acteurDe(i) {
    const u = i.member?.user ?? i.user;
    const lie = await base.premier('SELECT compte_id, super_admin FROM discord_comptes WHERE discord_user_id = ?', [u.id]);
    return { discordId: u.id, nom: nomDiscord(u), compte: lie?.compte_id ?? null, superAdmin: Number(lie?.super_admin) === 1 };
  }

  const adminServeur = i => {
    try {
      return (BigInt(i.member?.permissions ?? '0') & PERMISSION_ADMIN) !== 0n;
    } catch {
      return false;
    }
  };

  /** La personne est-elle du staff de ce ticket ? */
  async function estStaff(i, ticket, acteur) {
    if (adminServeur(i)) return true;
    const cat = await cycle.categorie(ticket.categorie_id);
    const roles = i.member?.roles ?? [];
    if ((cat?.rolesDiscord ?? []).some(r => roles.includes(r))) return true;
    if (!acteur.compte) return false;
    const d = await droitsTickets(base, { compte: acteur.compte, superAdmin: acteur.superAdmin });
    return d.repondre && voitCategorie(d, ticket.categorie_id);
  }

  /** Ticket visé par un bouton : il doit être dans le salon de l'interaction (ou, pour un MP, appartenir à l'auteur). */
  async function ticketDuBouton(i, id) {
    const ticket = await cycle.ticketPar(id);
    if (!ticket || (i.guild_id && ticket.salon_id !== i.channel_id)) throw new RefusLocal('pas_ticket');
    return ticket;
  }

  async function exigerStaff(i, ticket, acteur) {
    if (!(await estStaff(i, ticket, acteur))) throw new RefusLocal('pas_staff');
  }

  /** Commande activée, et réservée à certains rôles Discord si la configuration le dit (sauf administrateur). */
  async function exigerCommande(i, nom) {
    const c = (await lireCommandes(base))[nom];
    if (!c || c.actif === false) throw new RefusLocal('commande_desactivee');
    if (c.roles.length && !adminServeur(i) && !c.roles.some(r => (i.member?.roles ?? []).includes(r))) throw new RefusLocal('commande_interdite');
  }

  // ---------------------------------------------------------------- Ouverture

  async function categoriesActives() {
    return (await base.tous('SELECT id, nom_fr, nom_en, description_fr, description_en FROM tickets_categories WHERE actif = 1 AND supprime_le IS NULL ORDER BY position, nom_fr', [])).slice(0, 25);
  }

  async function menuCategories(langue) {
    const cats = await categoriesActives();
    if (!cats.length) throw new RefusLocal('categorie_inactive');
    return {
      type: 4,
      data: {
        flags: EPHEMERE,
        allowed_mentions: { parse: [] },
        components: [{ type: 1, components: [{ type: 3, custom_id: 'tk:s', placeholder: t(langue, 'choisir_categorie'), options: cats.map(c => ({ label: (langue === 'fr' ? c.nom_fr : c.nom_en).slice(0, 100), value: c.id, ...((langue === 'fr' ? c.description_fr : c.description_en) ? { description: (langue === 'fr' ? c.description_fr : c.description_en).slice(0, 100) } : {}) })) }] }],
      },
    };
  }

  /** Bouton, menu ou commande : la fenêtre du formulaire, ou le ticket tout de suite s'il n'y a pas de formulaire. */
  async function demanderOuverture(i, categorieId, langue) {
    const u = i.member?.user ?? i.user;
    const { cat } = await cycle.verifierOuverture({ categorieId, auteurId: u.id, guildId: i.guild_id ?? 'mp' });
    if (!cat.formulaire.length) return creer(i, categorieId, [], langue);
    const lib = v => (v?.[langue] || v?.fr || v?.en || '').trim();
    return fenetre(
      `tk:f:${cat.id}`,
      lib(cat.nom),
      cat.formulaire.map(c => ({ type: 4, custom_id: c.id, style: c.style === 'long' ? 2 : 1, label: lib(c.libelle).slice(0, 45) || c.id, required: c.requis, max_length: Math.min(4000, c.max), ...(c.min ? { min_length: c.min } : {}), ...(lib(c.placeholder) ? { placeholder: lib(c.placeholder).slice(0, 100) } : {}) })),
    );
  }

  async function creer(i, categorieId, reponses, langue) {
    const u = i.member?.user ?? i.user;
    const tk = await cycle.ouvrir({ categorieId, auteur: { id: u.id, nom: nomDiscord(u) }, langue, reponses, guildId: i.guild_id ?? 'mp' });
    return avis(t(langue, 'cree', { salon: `<#${tk.salon_id}>` }));
  }

  // ---------------------------------------------------------------- Composants

  async function composant(i, langue) {
    const id = String(i.data?.custom_id ?? '');
    const acteur = await acteurDe(i);
    if (id === 'tk:s') return demanderOuverture(i, String(i.data?.values?.[0] ?? ''), langue);
    let m = /^tk:o:([A-Za-z0-9-]{1,64})$/.exec(id);
    if (m) return demanderOuverture(i, m[1], langue);
    // Note dans le MP (l'auteur seulement) : enregistrée tout de suite, puis fenêtre du commentaire facultatif.
    m = /^tk:n:([0-9a-f-]{36}):([1-5])$/.exec(id);
    if (m) {
      await cycle.noter(m[1], acteur.discordId, Number(m[2]));
      return fenetre(`tk:nc:${m[1]}:${m[2]}`, t(langue, 'note_titre'), [{ type: 4, custom_id: 'commentaire', style: 2, label: t(langue, 'commentaire').slice(0, 45), placeholder: t(langue, 'commentaire_placeholder').slice(0, 100), required: false, max_length: 1000 }]);
    }
    m = /^tk:([a-z]{1,2}):([0-9a-f-]{36})$/.exec(id);
    if (!m) return avis(t(langue, 'erreur'));
    const [, action, ticketId] = m;
    const ticket = await ticketDuBouton(i, ticketId);
    const auteur = ticket.auteur_discord_id === acteur.discordId;
    switch (action) {
      case 'c':
        await exigerStaff(i, ticket, acteur);
        await cycle.prendre(ticket, acteur);
        return avis(t(langue, 'pris', { staff: acteur.nom }));
      case 'a':
        await exigerStaff(i, ticket, acteur);
        return { type: 4, data: { flags: EPHEMERE, allowed_mentions: { parse: [] }, components: [{ type: 1, components: [{ type: 5, custom_id: `tk:as:${ticket.id}`, placeholder: t(langue, 'choisir_membre') }] }] } };
      case 'as': {
        await exigerStaff(i, ticket, acteur);
        const cible = String(i.data?.values?.[0] ?? '');
        const u = i.data?.resolved?.users?.[cible];
        await cycle.ajouterMembre(ticket, acteur, { id: cible, nom: nomDiscord(u ?? { id: cible }) });
        return avis(t(langue, 'ajoute', { membre: nomDiscord(u ?? { id: cible }) }));
      }
      case 'p':
        await exigerStaff(i, ticket, acteur);
        return { type: 4, data: { flags: EPHEMERE, allowed_mentions: { parse: [] }, components: [{ type: 1, components: [{ type: 3, custom_id: `tk:ps:${ticket.id}`, placeholder: t(langue, 'choisir_priorite'), options: ['faible', 'moyen', 'urgent', 'critique'].map(p => ({ label: nomPriorite(langue, p), value: p, default: p === ticket.priorite })) }] }] } };
      case 'ps':
        await exigerStaff(i, ticket, acteur);
        await cycle.priorite(ticket, acteur, String(i.data?.values?.[0] ?? ''));
        return avis(t(langue, 'priorite_changee', { priorite: nomPriorite(langue, String(i.data?.values?.[0])) }));
      case 'x':
        if (!auteur) await exigerStaff(i, ticket, acteur);
        if (ticket.statut === 'ferme') throw new RefusLocal('deja_ferme');
        return {
          type: 4,
          data: {
            flags: EPHEMERE,
            content: t(langue, 'confirmer_fermeture', { numero: ticket.numero }),
            allowed_mentions: { parse: [] },
            components: [{ type: 1, components: [{ type: 2, style: 4, custom_id: `tk:xc:${ticket.id}`, label: t(langue, 'b_confirmer') }, { type: 2, style: 2, custom_id: `tk:xr:${ticket.id}`, label: t(langue, 'b_raison') }] }],
          },
        };
      case 'xc':
        if (!auteur) await exigerStaff(i, ticket, acteur);
        await cycle.fermer(ticket, acteur);
        return avis(t(langue, 'ferme_ok'));
      case 'xr':
        if (!auteur) await exigerStaff(i, ticket, acteur);
        return fenetre(`tk:xm:${ticket.id}`, t(langue, 'b_fermer'), [{ type: 4, custom_id: 'raison', style: 2, label: t(langue, 'raison').slice(0, 45), placeholder: t(langue, 'raison_placeholder').slice(0, 100), required: false, max_length: 300 }]);
      case 'r': {
        await exigerStaff(i, ticket, acteur);
        const r = await cycle.rouvrir(ticket, acteur);
        return avis(t(langue, 'rouvert_ok', { salon: `<#${r.salon_id}>` }));
      }
      default:
        return avis(t(langue, 'erreur'));
    }
  }

  // ---------------------------------------------------------------- Fenêtres

  async function fenetreRecue(i, langue) {
    const id = String(i.data?.custom_id ?? '');
    const v = valeursFenetre(i);
    const acteur = await acteurDe(i);
    let m = /^tk:f:([A-Za-z0-9-]{1,64})$/.exec(id);
    if (m) return creer(i, m[1], Object.entries(v).map(([cle, valeur]) => ({ id: cle, valeur })), langue);
    m = /^tk:xm:([0-9a-f-]{36})$/.exec(id);
    if (m) {
      const ticket = await ticketDuBouton(i, m[1]);
      if (ticket.auteur_discord_id !== acteur.discordId) await exigerStaff(i, ticket, acteur);
      await cycle.fermer(ticket, acteur, { raison: v.raison ?? '' });
      return avis(t(langue, 'ferme_ok'));
    }
    m = /^tk:nc:([0-9a-f-]{36}):([1-5])$/.exec(id);
    if (m) {
      await cycle.commenterNote(m[1], acteur.discordId, v.commentaire ?? '');
      const { messages } = await cycle.contexte();
      const merci = messages?.merci_note?.[langue]?.trim() ? messages.merci_note[langue] : t(langue, 'note_merci');
      return avis(merci.replace(/\{note\}/g, m[2]));
    }
    return avis(t(langue, 'erreur'));
  }

  // ---------------------------------------------------------------- Commandes

  /** Commandes /ticket <sous-commande> et /tickets. `extra` : sous-commandes ajoutées (étape 4). */
  const COMMANDES = {
    async ouvrir(i, o, langue) {
      if (o.categorie) return demanderOuverture(i, String(o.categorie), langue);
      const cats = await categoriesActives();
      if (cats.length === 1) return demanderOuverture(i, cats[0].id, langue);
      return menuCategories(langue);
    },
    async fermer(i, o, langue, acteur) {
      const ticket = await cycle.ticketDuSalon(i.channel_id);
      if (!ticket) throw new RefusLocal('pas_ticket');
      if (ticket.auteur_discord_id !== acteur.discordId) await exigerStaff(i, ticket, acteur);
      await cycle.fermer(ticket, acteur, { raison: o.raison ?? '' });
      return avis(t(langue, 'ferme_ok'));
    },
  };

  async function commandeRecue(i, langue) {
    const { nom, options } = commande(i);
    const f = COMMANDES[nom];
    if (!f) return avis(t(langue, 'erreur'));
    const general = await lireGeneral(base);
    if (!general.actif || !general.guildId) throw new RefusLocal('non_configure');
    if (i.guild_id !== general.guildId) throw new RefusLocal('autre_serveur');
    await exigerCommande(i, nom === 'tickets' ? 'tickets' : nom);
    return f(i, options, langue, await acteurDe(i));
  }

  async function autocomplete(i, langue) {
    const focus = (i.data?.options?.[0]?.options ?? i.data?.options ?? []).find(o => o.focused);
    const saisie = String(focus?.value ?? '').toLowerCase();
    let choix = [];
    if (focus?.name === 'categorie') choix = (await categoriesActives()).map(c => ({ name: (langue === 'fr' ? c.nom_fr : c.nom_en).slice(0, 100), value: c.id }));
    if (focus?.name === 'panneau') choix = (await base.tous('SELECT id, titre FROM tickets_panneaux ORDER BY cree_le', [])).map(p => ({ name: String(JSON.parse(p.titre)?.[langue] || JSON.parse(p.titre)?.fr || p.id).slice(0, 100), value: p.id }));
    return { type: 8, data: { choices: choix.filter(c => !saisie || c.name.toLowerCase().includes(saisie)).slice(0, 25) } };
  }

  async function interaction(i) {
    if (!estInteractionTickets(i)) return undefined;
    const langue = await langueDe(i);
    try {
      if (i.type === T.AUTOCOMPLETE) return await autocomplete(i, langue);
      if (i.type === T.COMMANDE) return await commandeRecue(i, langue);
      if (i.type === T.COMPOSANT) return await composant(i, langue);
      if (i.type === T.FENETRE) return await fenetreRecue(i, langue);
      return avis(t(langue, 'erreur'));
    } catch (e) {
      if (e instanceof RefusLocal || estRefus(e)) return avis(t(langue, e.cle ?? e.message, e.vars ?? {}));
      console.error('[esport] tickets : interaction', e?.message ?? e);
      return avis(t(langue, 'erreur'));
    }
  }

  return { interaction, COMMANDES, estStaff, acteurDe, exigerStaff, avis, maintenant };
}

class RefusLocal extends Error {
  constructor(cle, vars = {}) {
    super(cle);
    this.cle = cle;
    this.vars = vars;
  }
}
