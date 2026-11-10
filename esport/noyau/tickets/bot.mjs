/**
 * Tickets : interactions Discord (boutons des panneaux, menus, fenêtres, commandes /ticket et /tickets), branchées
 * dans le bot existant (discord/bot/interactions.mjs : même adresse, signature vérifiée). Une interaction des tickets
 * ne demande PAS de compte lié : tout membre du serveur du club peut ouvrir un ticket.
 *
 * Qui est « staff » d'un ticket (prendre en charge, ajouter quelqu'un, priorité, rouvrir…) : un membre qui a un des
 * rôles Discord de la catégorie, un administrateur du serveur, ou une personne dont le compte Esport lié voit la
 * catégorie et a `tickets.repondre`. L'auteur peut fermer son propre ticket, sauf dans une catégorie réglée sur « Seul le
 * staff peut fermer » (migration 0055).
 *
 * Identifiants (`custom_id`) : voir panneaux.mjs ; en plus, `tk:f:<catégorie>` (fenêtre du formulaire), `tk:as:` et
 * `tk:ps:` (choix d'une personne, d'une priorité), `tk:xc:` / `tk:xr:` / `tk:xm:` (confirmation, raison, fenêtre de la
 * raison), `tk:n:<ticket>:<note>` et `tk:nc:<ticket>:<note>` (note dans le MP, puis commentaire), `tk:dc:<ticket>:<g|s>`
 * (suppression confirmée d'un ticket fermé, avis gardé anonyme ou supprimé). `tk:rp:<ticket>` / `tk:rm:<ticket>` :
 * ancien bouton « Répondre » (retiré : l'auteur et les personnes ajoutées écrivent directement dans le salon) ; un
 * ancien message qui le montre encore reçoit une réponse éphémère, sans rien poster. Boutons et fenêtres ne
 * s'enregistrent pas auprès de Discord (seules les commandes slash le sont).
 *
 * `interaction(i)` rend la réponse à donner à Discord, ou `undefined` si l'interaction n'est pas pour les tickets. Une
 * réponse peut porter `apres` (fonction) : travail lancé par interactions.mjs une fois la réponse partie (JSON.stringify
 * ignore les fonctions).
 */

import { lireLangue } from '../langues.mjs';
import { droitsTickets, gereAvis, voitCategorie } from './acces.mjs';
import { iso, nouvelId } from '../outils.mjs';
import { annoncer } from './conversation.mjs';
import { transcriptHtml } from './transcript.mjs';
import { estRefus } from './cycle.mjs';
import { nomDiscord } from './conversation.mjs';
import { nomPriorite } from './panneaux.mjs';
import { lireCommandes, lireGeneral, reponsesAppSeules } from './reglages.mjs';
import { t } from './textes.mjs';

const EPHEMERE = 64;
const T = { COMMANDE: 2, COMPOSANT: 3, AUTOCOMPLETE: 4, FENETRE: 5 };
const PERMISSION_ADMIN = 0x8n;
const PERMISSION_GERER_SERVEUR = 0x20n;
const MEDIANE = l => {
  const v = l.filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};

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

/** Délai avant de supprimer le salon d'un ticket supprimé par /ticket supprimer (la réponse part d'abord). */
export const REGLAGES_SUPPRESSION = { delaiSalonMs: 3000 };
const patienter = ms => new Promise(ok => (ms > 0 ? setTimeout(ok, ms).unref?.() : ok()));

export function creerBotTickets({ base, maintenant = () => Date.now(), cycle, config }) {
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

  /** Fermer un ticket : le staff, ou son auteur (sauf catégorie « Seul le staff peut fermer »). */
  async function exigerFermeture(i, ticket, acteur) {
    if (ticket.auteur_discord_id !== acteur.discordId) return exigerStaff(i, ticket, acteur);
    if (!(await cycle.categorie(ticket.categorie_id))?.fermetureStaffSeul) return;
    if (!(await estStaff(i, ticket, acteur))) throw new RefusLocal('fermeture_staff');
  }

  /** Commande activée, et réservée à certains rôles Discord si la configuration le dit (sauf administrateur). */
  async function exigerCommande(i, nom) {
    const c = (await lireCommandes(base))[nom];
    if (!c || c.actif === false) throw new RefusLocal('commande_desactivee');
    if (c.roles.length && !adminServeur(i) && !c.roles.some(r => (i.member?.roles ?? []).includes(r))) throw new RefusLocal('commande_interdite');
  }

  /**
   * Supprimer un ticket fermé (/ticket supprimer ; le salon disparaît, le ticket reste 30 j dans l'app) : compte Esport lié avec `tickets.gerer`, ou `tickets.configurer`
   * pour une catégorie de ses rôles (gereAvis) ; jamais un simple rôle Discord (c'est irréversible).
   */
  async function exigerSuppression(ticket, acteur) {
    if (ticket.statut !== 'ferme') throw new RefusLocal('supprimer_pas_ferme');
    if (ticket.supprime_le) throw new RefusLocal('supprime_deja');
    const d = acteur.compte ? await droitsTickets(base, { compte: acteur.compte, superAdmin: acteur.superAdmin }) : null;
    if (!d || !gereAvis(d, ticket.categorie_id)) throw new RefusLocal('supprimer_droits');
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
    // Suppression confirmée (/ticket supprimer) : `g` garde l'avis anonyme à l'effacement définitif, `s` le supprime aussi. Le salon est
    // supprimé APRÈS la réponse (`apres`, lancé par interactions.mjs) : Discord ne pourrait plus l'afficher.
    m = /^tk:dc:([0-9a-f-]{36}):([gs])$/.exec(id);
    if (m) {
      await exigerCommande(i, 'supprimer');
      const ticket = await ticketDuBouton(i, m[1]);
      await exigerSuppression(ticket, acteur);
      const r = await cycle.supprimer(ticket, acteur, { garderAvis: m[2] === 'g', salonPlusTard: true });
      return { ...avis(t(langue, 'supprime_ok', { numero: r.numero, jours: r.jours })), apres: r.salonId ? () => patienter(REGLAGES_SUPPRESSION.delaiSalonMs).then(() => cycle.supprimerSalon(r.salonId, r.numero)) : undefined };
    }
    m = /^tk:([a-z]{1,2}):([0-9a-f-]{36})$/.exec(id);
    if (!m) return avis(t(langue, 'erreur'));
    const [, action, ticketId] = m;
    const ticket = await ticketDuBouton(i, ticketId);
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
        await exigerFermeture(i, ticket, acteur);
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
        await exigerFermeture(i, ticket, acteur);
        await cycle.fermer(ticket, acteur);
        return avis(t(langue, 'ferme_ok'));
      case 'xr':
        await exigerFermeture(i, ticket, acteur);
        return fenetre(`tk:xm:${ticket.id}`, t(langue, 'b_fermer'), [{ type: 4, custom_id: 'raison', style: 2, label: t(langue, 'raison').slice(0, 45), placeholder: t(langue, 'raison_placeholder').slice(0, 100), required: false, max_length: 300 }]);
      // Ancien bouton « Répondre » (retiré) : rien n'est posté ; l'auteur écrit directement dans le salon.
      case 'rp':
        return ancienRepondre(i, ticket, acteur, langue);
      case 'r': {
        await exigerStaff(i, ticket, acteur);
        const r = await cycle.rouvrir(ticket, acteur);
        return avis(t(langue, 'rouvert_ok', { salon: `<#${r.salon_id}>` }));
      }
      default:
        return avis(t(langue, 'erreur'));
    }
  }

  /** Ancien bouton « Répondre » : le staff (réglage actif) est renvoyé vers l'app, les autres écrivent dans le salon. */
  async function ancienRepondre(i, ticket, acteur, langue) {
    if (ticket.statut === 'ferme') throw new RefusLocal('deja_ferme');
    if (reponsesAppSeules(await lireGeneral(base)) && (await estStaff(i, ticket, acteur))) return avis(t(langue, 'repondre_staff', { lien: cycle.lienApp ? ` ${cycle.lienApp}` : '' }));
    return avis(t(langue, 'ecrire_direct'));
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
      await exigerFermeture(i, ticket, acteur);
      await cycle.fermer(ticket, acteur, { raison: v.raison ?? '' });
      return avis(t(langue, 'ferme_ok'));
    }
    // Fenêtre de l'ancien bouton « Répondre », ouverte avant la mise à jour : rien n'est posté.
    m = /^tk:rm:([0-9a-f-]{36})$/.exec(id);
    if (m) return ancienRepondre(i, await ticketDuBouton(i, m[1]), acteur, langue);
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
      await exigerFermeture(i, ticket, acteur);
      await cycle.fermer(ticket, acteur, { raison: o.raison ?? '' });
      return avis(t(langue, 'ferme_ok'));
    },
  };

  /** Ticket du salon où la commande est tapée, et contrôle du staff (sauf `auteurPermis`). */
  async function ticketIci(i, acteur, { staff = true } = {}) {
    const ticket = await cycle.ticketDuSalon(i.channel_id);
    if (!ticket) throw new RefusLocal('pas_ticket');
    if (staff) await exigerStaff(i, ticket, acteur);
    return ticket;
  }

  /** Catégories dont la personne est du staff (toutes pour un administrateur ou un compte lié qui gère les tickets). */
  async function categoriesDuStaff(i, acteur) {
    const toutes = await base.tous('SELECT id, nom_fr, nom_en, roles_discord FROM tickets_categories', []);
    if (adminServeur(i)) return toutes;
    const d = acteur.compte ? await droitsTickets(base, { compte: acteur.compte, superAdmin: acteur.superAdmin }) : null;
    const roles = i.member?.roles ?? [];
    return toutes.filter(c => (d?.repondre && voitCategorie(d, c.id)) || JSON.parse(c.roles_discord || '[]').some(r => roles.includes(r)));
  }

  const nomCategorie = (c, langue) => (langue === 'fr' ? c.nom_fr : c.nom_en) || c.nom_fr;
  const salon = tk => (tk.salon_id ? `<#${tk.salon_id}>` : `#${tk.numero}`);

  Object.assign(COMMANDES, {
    async prendre(i, o, langue, acteur) {
      await cycle.prendre(await ticketIci(i, acteur), acteur);
      return avis(t(langue, 'pris', { staff: acteur.nom }));
    },
    async liberer(i, o, langue, acteur) {
      await cycle.liberer(await ticketIci(i, acteur), acteur);
      return avis(t(langue, 'libere'));
    },
    async ajouter(i, o, langue, acteur) {
      const u = i.data?.resolved?.users?.[o.membre];
      await cycle.ajouterMembre(await ticketIci(i, acteur), acteur, { id: String(o.membre ?? ''), nom: nomDiscord(u ?? { id: o.membre }) });
      return avis(t(langue, 'ajoute', { membre: nomDiscord(u ?? { id: o.membre }) }));
    },
    async retirer(i, o, langue, acteur) {
      const u = i.data?.resolved?.users?.[o.membre];
      await cycle.retirerMembre(await ticketIci(i, acteur), acteur, { id: String(o.membre ?? '') });
      return avis(t(langue, 'retire', { membre: nomDiscord(u ?? { id: o.membre }) }));
    },
    async renommer(i, o, langue, acteur) {
      const r = await cycle.renommer(await ticketIci(i, acteur), acteur, String(o.nom ?? ''));
      return avis(t(langue, 'renomme', { nom: r.nom }));
    },
    async priorite(i, o, langue, acteur) {
      await cycle.priorite(await ticketIci(i, acteur), acteur, String(o.niveau ?? ''));
      return avis(t(langue, 'priorite_changee', { priorite: nomPriorite(langue, String(o.niveau)) }));
    },
    async transferer(i, o, langue, acteur) {
      const tk = await cycle.transferer(await ticketIci(i, acteur), acteur, String(o.categorie ?? ''));
      const c = await cycle.categorie(tk.categorie_id);
      return avis(t(langue, 'transfere', { categorie: (langue === 'fr' ? c?.nom.fr : c?.nom.en) ?? '' }));
    },
    async rouvrir(i, o, langue, acteur) {
      const r = await cycle.rouvrir(await ticketIci(i, acteur), acteur);
      return avis(t(langue, 'rouvert_ok', { salon: salon(r) }));
    },
    async attente(i, o, langue, acteur) {
      await cycle.attente(await ticketIci(i, acteur), acteur);
      return avis(t(langue, 'attente_ok'));
    },
    /** Note interne : enregistrée dans l'app, JAMAIS postée sur Discord (réponse éphémère seulement). */
    async note(i, o, langue, acteur) {
      const tk = await ticketIci(i, acteur);
      const texte = String(o.texte ?? '').trim().slice(0, 1500);
      if (!texte) throw new RefusLocal('erreur');
      const t0 = maintenant();
      await base.executer("INSERT INTO tickets_messages (id, ticket_id, genre, auteur_discord_id, auteur_compte_id, auteur_nom, staff, contenu, envoi, cree_le) VALUES (?, ?, 'note', ?, ?, ?, 1, ?, 'ok', ?)", [nouvelId(), tk.id, acteur.discordId, acteur.compte, acteur.nom, texte, iso(t0)]);
      await annoncer(base, tk.id, t0, { acteur: acteur.compte ?? undefined });
      return avis(t(langue, 'note_interne_ok'));
    },
    /** Transcript en MP au membre du staff : SANS les notes internes (elles ne passent jamais par Discord ; l'app les a). */
    async transcript(i, o, langue, acteur) {
      const tk = await ticketIci(i, acteur);
      const cat = await base.premier('SELECT nom_fr, nom_en FROM tickets_categories WHERE id = ?', [tk.categorie_id]);
      const messages = await base.tous('SELECT * FROM tickets_messages WHERE ticket_id = ? ORDER BY cree_le, id', [tk.id]);
      const pieces = await base.tous('SELECT * FROM tickets_pieces WHERE ticket_id = ?', [tk.id]);
      const tr = transcriptHtml({ ticket: tk, categorie: langue === 'fr' ? cat?.nom_fr : cat?.nom_en, messages, pieces, langue, notes: false, maintenant: maintenant() });
      const ok = await cycle.envoyerMp(acteur.discordId, { content: t(langue, 'transcript_ok', { numero: tk.numero }) }, [{ nom: tr.nom, type: 'text/html', octets: new TextEncoder().encode(tr.contenu) }]);
      return avis(t(langue, ok ? 'transcript_mp' : 'transcript_mp_impossible'));
    },
    /**
     * Supprimer définitivement ce ticket FERMÉ (`avis` : garder, par défaut, ou supprimer l'avis de l'auteur) :
     * demande d'abord une confirmation (bouton), éphémère.
     */
    async supprimer(i, o, langue, acteur) {
      const tk = await ticketIci(i, acteur, { staff: false });
      await exigerSuppression(tk, acteur);
      const garder = o.avis !== 'supprimer';
      return {
        type: 4,
        data: {
          flags: EPHEMERE,
          content: t(langue, 'supprimer_confirmer', { numero: tk.numero, jours: (await lireGeneral(base)).retentionSuppressionJours, avis: t(langue, garder ? 'supprimer_avis_garde' : 'supprimer_avis_efface') }).slice(0, 2000),
          allowed_mentions: { parse: [] },
          components: [{ type: 1, components: [{ type: 2, style: 4, custom_id: `tk:dc:${tk.id}:${garder ? 'g' : 's'}`, label: t(langue, 'b_supprimer') }] }],
        },
      };
    },
    /**
     * Mentionner une personne ou un rôle de la catégorie dans ce ticket (`qui` : utilisateur ou rôle ; `message`
     * facultatif) : le bot poste la mention, limitée exactement à cette cible (3 par minute et par ticket).
     */
    async ping(i, o, langue, acteur) {
      const tk = await ticketIci(i, acteur);
      const id = String(o.qui ?? '');
      const role = i.data?.resolved?.roles?.[id];
      const u = i.data?.resolved?.users?.[id];
      const membre = i.data?.resolved?.members?.[id];
      const cible = role ? { type: 'role', id, nom: role.name } : { type: 'membre', id, nom: membre?.nick || nomDiscord(u ?? { id }) };
      await cycle.mentionner(tk, acteur, { cibles: [cible], message: String(o.message ?? '') });
      return avis(t(langue, 'ping_ok'));
    },
    /** Ticket permanent (`etat` : on / off) : jamais fermé automatiquement ; avertissement en attente annulé. */
    async permanent(i, o, langue, acteur) {
      if (o.etat !== 'on' && o.etat !== 'off') throw new RefusLocal('erreur');
      await cycle.permanent(await ticketIci(i, acteur), acteur, o.etat === 'on');
      return avis(t(langue, o.etat === 'on' ? 'permanent_actif' : 'permanent_inactif'));
    },
    async stats(i, o, langue, acteur) {
      const cats = await categoriesDuStaff(i, acteur);
      if (!cats.length) throw new RefusLocal('pas_staff');
      const depuis = iso(maintenant() - 30 * 86_400_000);
      const lignes = [];
      const toutes = [];
      // Tickets supprimés (migration 0065) : plus comptés, mais leur avis reste (sauf s'il doit être supprimé avec eux).
      const avisSupprimes = [];
      for (const c of cats.slice(0, 20)) {
        const tous = await base.tous('SELECT statut, ouvert_le, ferme_le, premiere_reponse_le, note, supprime_le, supprime_garder_avis FROM tickets WHERE categorie_id = ? AND (ouvert_le >= ? OR statut <> ?)', [c.id, depuis, 'ferme']);
        const ls = tous.filter(x => !x.supprime_le);
        avisSupprimes.push(...tous.filter(x => x.supprime_le && Number(x.supprime_garder_avis) !== 0));
        toutes.push(...ls);
        lignes.push(t(langue, 'stats_ligne', { categorie: nomCategorie(c, langue), ouverts: ls.filter(x => x.statut !== 'ferme').length, crees: ls.filter(x => x.ouvert_le >= depuis).length, fermes: ls.filter(x => x.ferme_le && x.ferme_le >= depuis).length }));
      }
      const ms = (a, b) => (a && b ? Date.parse(b) - Date.parse(a) : NaN);
      const h = v => (v === null ? '—' : `${Math.round(v / 3_600_000)} h`);
      const notes = [...toutes, ...avisSupprimes].filter(x => x.note !== null && x.note !== undefined).map(x => Number(x.note));
      return {
        type: 4,
        data: {
          flags: EPHEMERE,
          allowed_mentions: { parse: [] },
          embeds: [
            {
              title: t(langue, 'stats'),
              description: lignes.join('\n').slice(0, 3500),
              color: 0x5865f2,
              fields: [
                { name: t(langue, 'stats_reponse'), value: h(MEDIANE(toutes.map(x => ms(x.ouvert_le, x.premiere_reponse_le)))), inline: true },
                { name: t(langue, 'stats_resolution'), value: h(MEDIANE(toutes.filter(x => x.ferme_le).map(x => ms(x.ouvert_le, x.ferme_le)))), inline: true },
                { name: t(langue, 'stats_note'), value: notes.length ? `${(notes.reduce((a, b) => a + b, 0) / notes.length).toFixed(1)}/5 (${notes.length})` : '—', inline: true },
              ],
            },
          ],
        },
      };
    },
    /** Republier un panneau : administrateur du serveur, ou compte lié qui configure les tickets. */
    async panneau(i, o, langue, acteur) {
      let droits = false;
      try {
        droits = (BigInt(i.member?.permissions ?? '0') & (PERMISSION_ADMIN | PERMISSION_GERER_SERVEUR)) !== 0n;
      } catch {
        droits = false;
      }
      const d = acteur.compte ? await droitsTickets(base, { compte: acteur.compte, superAdmin: acteur.superAdmin }) : null;
      if (!droits && !d?.configurer) throw new RefusLocal('panneau_droits');
      const panneaux = await base.tous('SELECT id FROM tickets_panneaux ORDER BY cree_le', []);
      const id = o.panneau ? String(o.panneau) : panneaux.length === 1 ? panneaux[0].id : null;
      if (!id || !panneaux.some(p => p.id === id)) throw new RefusLocal('panneau_introuvable');
      // Compte lié qui configure : ses droits ; administrateur du serveur sans compte lié : publication du panneau déjà réglé.
      const qui = d?.configurer ? { compte: acteur.compte, superAdmin: acteur.superAdmin } : { compte: 'principal', superAdmin: true };
      await config.publierPanneau(qui, id);
      return avis(t(langue, 'panneau_publie'));
    },
    /** /tickets : mes tickets ouverts ; `liste: file` (staff) : tickets non pris en charge de mes catégories. */
    async tickets(i, o, langue, acteur) {
      if (o.liste === 'file') {
        const cats = await categoriesDuStaff(i, acteur);
        if (!cats.length) throw new RefusLocal('pas_staff');
        const ls = await base.tous(`SELECT numero, salon_id, priorite, ouvert_le, categorie_id FROM tickets WHERE statut <> 'ferme' AND responsable_compte_id IS NULL AND responsable_discord_id IS NULL AND categorie_id IN (${cats.map(() => '?').join(', ')}) ORDER BY ouvert_le LIMIT 15`, cats.map(c => c.id));
        const nom = new Map(cats.map(c => [c.id, nomCategorie(c, langue)]));
        return avis(ls.length ? [`**${t(langue, 'file')}**`, ...ls.map(x => `${salon(x)} · ${nom.get(x.categorie_id)} · ${nomPriorite(langue, x.priorite)}`)].join('\n') : t(langue, 'file_vide'));
      }
      const ls = await base.tous("SELECT numero, salon_id, statut, categorie_id FROM tickets WHERE auteur_discord_id = ? AND statut <> 'ferme' ORDER BY ouvert_le LIMIT 15", [acteur.discordId]);
      return avis(ls.length ? [`**${t(langue, 'mes_tickets')}**`, ...ls.map(x => `${salon(x)} · ${t(langue, `s_${x.statut}`)}`)].join('\n') : t(langue, 'aucun_ticket'));
    },
  });

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
