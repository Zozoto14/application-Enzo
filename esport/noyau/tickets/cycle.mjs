/**
 * Tickets : cycle de vie (docs/esport/tickets.md, « Cycle de vie »). Utilisé par le bot (boutons, fenêtres,
 * commandes), par l'app (étape 3) et par le cron (fermeture automatique, archives, rétention).
 *
 *  - ouverture : contrôles (tickets activés, catégorie active, liste noire, plafond par personne, débit), numéro
 *    séquentiel, SALON PRIVÉ dans la catégorie Discord des tickets ouverts (droits : @everyone refusé ; l'auteur, les
 *    rôles Discord de la catégorie et le bot autorisés), message d'accueil (réponses du formulaire, boutons), réponse
 *    hors horaires, journal ;
 *  - prise en charge, libération, assignation, priorité, attente, personnes ajoutées / retirées, renommage, transfert ;
 *  - fermeture : derniers messages relus, statut, message de fermeture, salon VERROUILLÉ (l'auteur ne peut plus écrire)
 *    et déplacé dans la catégorie des archives, MP récapitulatif à l'auteur avec la demande de note (1 à 5, puis
 *    commentaire facultatif), journal ; transcript = la conversation gardée en base (transcript.mjs) ;
 *  - réouverture (salon remis en place, ou recréé s'il a été supprimé) ;
 *  - cron : avertissement avant la fermeture automatique, fermeture après le délai sans message, suppression des
 *    salons archivés après N jours, rétention (conversation et pièces effacées après N jours).
 *
 * Acteur : `{ discordId?, nom, compte? }` (personne sur Discord, ou compte de l'app). Les écritures Discord passent par
 * l'API REST du bot (discord.mjs) ; un échec Discord ne laisse jamais la base incohérente (statut d'abord, Discord
 * ensuite, au mieux).
 */

import { echec, iso, jsonOu, nouvelId } from '../outils.mjs';
import { evenement } from '../evenements.mjs';
import { limiter } from '../limites.mjs';
import { comptesDeCategorie, droitsTickets, voitCategorie } from './acces.mjs';
import { publierEnBase } from '../temps-reel/diffusion.mjs';
import { annoncer, ingererMessage, plusRecent, telechargeurCdn } from './conversation.mjs';
import { DROITS_BOT, DROITS_PARTICIPANT, P, idDiscord, rest } from './discord.mjs';
import { boutonsTicket, chargeAccueil, nomPriorite, nomSalon, titreTicket } from './panneaux.mjs';
import { STATUTS_OUVERTS, categoriePublique, dansHoraires, lireGeneral, lireHoraires, lireMessages, lireReglage } from './reglages.mjs';
import { bilingue, duree, langueDe, messageBilingue, messageRegle, nom2, remplir, sur, t as tx } from './textes.mjs';

const H = 3_600_000;
const J = 24 * H;
const LOT_CRON = 20;
const VOIR_HISTORIQUE = (P.VOIR_SALON | P.HISTORIQUE).toString();

/** Erreur métier des tickets : `cle` = texte du bot (textes.mjs) à montrer, `vars`. */
export class RefusTicket extends Error {
  constructor(cle, vars = {}, statut = 400) {
    super(cle);
    this.cle = cle;
    this.vars = vars;
    this.statut = statut;
  }
}
const refusTk = (cle, vars, statut) => new RefusTicket(cle, vars, statut);

export function servicesCycleTickets({ base, maintenant = () => Date.now(), stockage, fetch: fetchDiscord = (...a) => globalThis.fetch(...a), jetonBot, applicationId = '', lienApp = '' }) {
  const botId = applicationId || null;
  const appel = (methode, chemin, corps, opts) => rest(fetchDiscord, jetonBot, methode, chemin, corps, opts);
  const telecharger = telechargeurCdn(fetchDiscord);

  async function contexte() {
    const [general, messages, horaires] = await Promise.all([lireGeneral(base), lireMessages(base), lireHoraires(base)]);
    return { general, messages, horaires };
  }
  const optsLangue = (general, ticket) => ({ mode: general.langue, langue: ticket?.langue ?? 'en' });

  async function categorie(id) {
    const l = await base.premier('SELECT * FROM tickets_categories WHERE id = ?', [id]);
    return l ? categoriePublique(l) : null;
  }
  async function ticketPar(id) {
    return base.premier('SELECT * FROM tickets WHERE id = ?', [id]);
  }
  async function ticketDuSalon(salonId) {
    return salonId ? base.premier('SELECT * FROM tickets WHERE salon_id = ? ORDER BY ouvert_le DESC LIMIT 1', [salonId]) : null;
  }

  // ---------------------------------------------------------------- Messages du bot

  /** Message du bot dans le salon du ticket, gardé dans la conversation (genre « systeme »). */
  async function posterSysteme(ticket, charge, texte, { genre = 'systeme', acteur } = {}) {
    if (!ticket.salon_id || ticket.salon_supprime_le) return null;
    const r = await appel('POST', `/channels/${ticket.salon_id}/messages`, { allowed_mentions: { parse: [] }, ...charge });
    const t = maintenant();
    const discordId = r.ok ? idDiscord(r.corps?.id) : null;
    await base.executer(
      `INSERT INTO tickets_messages (id, ticket_id, discord_message_id, genre, auteur_discord_id, auteur_compte_id, auteur_nom, staff, contenu, envoi, cree_le)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [nouvelId(), ticket.id, discordId, genre, acteur?.discordId ?? botId, acteur?.compte ?? null, acteur?.nom ?? 'Esport HQ', String(texte ?? '').slice(0, 8000), r.ok ? 'ok' : 'echec', iso(t)],
    );
    if (discordId) await base.executer('UPDATE tickets SET dernier_message_id = ? WHERE id = ?', [plusRecent(ticket.dernier_message_id, discordId), ticket.id]);
    return r;
  }

  /** Message court bilingue dans le salon (prise en charge, attente…). */
  async function annonceSalon(ticket, general, messages, cle, vars) {
    const texte = messageBilingue(messages, cle, vars, optsLangue(general, ticket));
    return posterSysteme(ticket, { embeds: [{ description: texte.slice(0, 4000), color: 0x5865f2 }] }, texte);
  }

  async function journalDiscord(general, embed) {
    if (!general.salonJournaux) return;
    await appel('POST', `/channels/${general.salonJournaux}/messages`, { embeds: [embed], allowed_mentions: { parse: [] } });
  }

  const ev = (type, ticket, acteur, charge = {}) =>
    evenement(type, { acteur: acteur?.compte ?? null, entiteType: 'ticket', entiteId: ticket.id, charge: { numero: Number(ticket.numero), categorie: ticket.categorie_id, ...charge }, maintenant: maintenant() });

  // ---------------------------------------------------------------- Droits des salons

  /** Surcharges de droits d'un salon de ticket. `verrouille` : l'auteur et les personnes ajoutées lisent seulement. */
  async function surcharges(ticket, cat, general, { verrouille = false } = {}) {
    const ajoutes = await base.tous('SELECT discord_user_id FROM tickets_membres WHERE ticket_id = ?', [ticket.id]);
    const participant = verrouille ? VOIR_HISTORIQUE : DROITS_PARTICIPANT;
    const liste = [{ id: general.guildId, type: 0, allow: '0', deny: P.VOIR_SALON.toString() }];
    for (const r of cat?.rolesDiscord ?? []) if (r !== general.guildId) liste.push({ id: r, type: 0, allow: DROITS_PARTICIPANT, deny: '0' });
    liste.push({ id: ticket.auteur_discord_id, type: 1, allow: participant, deny: verrouille ? P.ENVOYER.toString() : '0' });
    for (const a of ajoutes) if (a.discord_user_id !== ticket.auteur_discord_id) liste.push({ id: a.discord_user_id, type: 1, allow: participant, deny: verrouille ? P.ENVOYER.toString() : '0' });
    if (botId) liste.push({ id: botId, type: 1, allow: DROITS_BOT, deny: '0' });
    return liste;
  }

  async function creerSalon(ticket, cat, general) {
    const nom = nomSalon(cat.modeleNom, { numero: ticket.numero, pseudo: ticket.auteur_nom, categorie: cat.nom.en || cat.nom.fr });
    const r = await appel(
      'POST',
      `/guilds/${general.guildId}/channels`,
      { name: nom, type: 0, parent_id: general.categorieOuverts, topic: `${titreTicket(ticket.numero, { mode: 'en_fr' })} · ${nom2(cat.nom, { mode: 'en_fr' })}`.slice(0, 1024), permission_overwrites: await surcharges(ticket, cat, general) },
      { raison: `Ticket ${ticket.numero}` },
    );
    return r.ok ? { id: idDiscord(r.corps?.id), nom } : { erreur: r };
  }

  // ---------------------------------------------------------------- Ouverture

  /** Contrôles d'ouverture (aussi avant d'afficher le formulaire) ; rend `{ cat, general }`. */
  async function verifierOuverture({ categorieId, auteurId, guildId }) {
    const general = await lireGeneral(base);
    if (!jetonBot || !general.actif || !general.guildId || !general.categorieOuverts) throw refusTk('non_configure');
    if (guildId && guildId !== general.guildId) throw refusTk('autre_serveur');
    const cat = await categorie(categorieId);
    if (!cat || !cat.actif || (await base.premier('SELECT supprime_le FROM tickets_categories WHERE id = ?', [categorieId]))?.supprime_le) throw refusTk('categorie_inactive');
    if (await base.premier('SELECT discord_user_id FROM tickets_liste_noire WHERE discord_user_id = ?', [auteurId])) throw refusTk('liste_noire', {}, 403);
    const ouverts = await base.tous(`SELECT salon_id FROM tickets WHERE auteur_discord_id = ? AND categorie_id = ? AND statut <> 'ferme'`, [auteurId, categorieId]);
    if (ouverts.length >= cat.maxOuverts) throw refusTk('max_ouverts', { n: ouverts.length, salons: ouverts.map(o => (o.salon_id ? `<#${o.salon_id}>` : '—')).join(' ') });
    return { cat, general };
  }

  /**
   * Ouvre un ticket. `auteur` : `{ id, nom }` (utilisateur Discord), `langue` ('fr'|'en'), `reponses` : `[{ id, valeur }]`
   * (champs du formulaire). Rend la ligne du ticket.
   */
  async function ouvrir({ categorieId, auteur, langue = 'en', reponses = [], guildId }) {
    const { cat, general } = await verifierOuverture({ categorieId, auteurId: auteur.id, guildId });
    try {
      await limiter(base, 'tickets_ouverture', auteur.id, maintenant());
    } catch {
      throw refusTk('erreur', {}, 429);
    }
    const { messages, horaires } = await contexte();
    // Réponses : seulement les champs du formulaire, bornées ; obligatoires vérifiés.
    const valeurs = new Map((Array.isArray(reponses) ? reponses : []).map(r => [String(r?.id ?? ''), String(r?.valeur ?? '')]));
    const lues = cat.formulaire.map(c => ({ id: c.id, libelle: c.libelle, valeur: (valeurs.get(c.id) ?? '').slice(0, c.max).trim() }));
    if (cat.formulaire.some((c, i) => c.requis && !lues[i].valeur)) throw refusTk('erreur');
    const t = maintenant();
    const id = nouvelId();
    let numero = 0;
    for (let essai = 0; essai < 8; essai++) {
      const m = await base.premier('SELECT MAX(numero) AS n FROM tickets', []);
      numero = Number(m?.n ?? 0) + 1;
      try {
        await base.executer(
          `INSERT INTO tickets (id, numero, categorie_id, statut, priorite, auteur_discord_id, auteur_nom, auteur_compte_id, langue, reponses, ouvert_le, maj_le, derniere_activite_le, liaison)
           VALUES (?, ?, ?, 'ouvert', ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')`,
          [id, numero, cat.id, cat.prioriteDefaut, auteur.id, String(auteur.nom ?? '').slice(0, 100), (await base.premier('SELECT compte_id FROM discord_comptes WHERE discord_user_id = ?', [auteur.id]))?.compte_id ?? null, langueDe(langue), JSON.stringify(lues), iso(t), iso(t), iso(t)],
        );
        break;
      } catch (e) {
        if (!/UNIQUE|unique|duplicate|constraint/i.test(String(e?.message)) || essai === 7) throw e;
      }
    }
    // Double clic (deux ouvertures simultanées) : le plafond est revérifié après l'insertion, avant de créer le salon.
    const enCours = await base.premier("SELECT COUNT(*) AS n FROM tickets WHERE auteur_discord_id = ? AND categorie_id = ? AND statut <> 'ferme'", [auteur.id, cat.id]);
    if (Number(enCours?.n ?? 0) > cat.maxOuverts) {
      await base.executer('DELETE FROM tickets WHERE id = ?', [id]);
      throw refusTk('max_ouverts', { n: cat.maxOuverts, salons: '' });
    }
    let ticket = await ticketPar(id);
    const salon = await creerSalon(ticket, cat, general);
    if (!salon.id) {
      // Salon impossible (permissions du bot…) : le ticket n'existe pas ; le staff est prévenu dans le journal.
      await base.executer('DELETE FROM tickets WHERE id = ?', [id]);
      await journalDiscord(general, { title: titreTicket(numero, { mode: general.langue === 'auteur' ? 'en_fr' : general.langue }), description: `${tx('en', 'creation_impossible')}\n> ${tx('fr', 'creation_impossible')} (HTTP ${salon.erreur?.statut ?? '?'})`, color: 0xd9534f });
      throw refusTk('creation_impossible', {}, 502);
    }
    await base.executer('UPDATE tickets SET salon_id = ?, salon_nom = ? WHERE id = ?', [salon.id, salon.nom, id]);
    ticket = await ticketPar(id);
    const opts = optsLangue(general, ticket);
    const vars = l => ({ utilisateur: `<@${auteur.id}>`, pseudo: sur(auteur.nom, 80), numero, categorie: sur(l === 'fr' ? cat.nom.fr : cat.nom.en, 80) });
    const accueilRegle = l => (cat.accueil?.[l]?.trim() ? cat.accueil[l] : messageRegle(messages, 'accueil', l));
    const accueil = bilingue(l => remplir(accueilRegle(l), vars(l)), opts);
    const charge = chargeAccueil({ ticket: { ...ticket, reponses: lues }, categorie: cat, accueil, mentions: cat.mentions, opts });
    await posterSysteme(ticket, charge, accueil);
    if (horaires.actif && !dansHoraires(horaires, t)) {
      const plages = horaires.plages.map(p => `${p.jour}:${p.debut}-${p.fin}`).join(', ');
      await annonceSalon(ticket, general, messages, 'hors_horaires', { horaires: `${plages} (${horaires.fuseau})` });
    }
    await base.lot([ev('ticket.ouvert', ticket, null, { auteur: sur(auteur.nom, 80), nomCategorie: cat.nom.fr })]);
    await journalDiscord(general, { description: bilingue(l => tx(l, 'journal_ouvert', { numero, auteur: `<@${auteur.id}>`, categorie: sur(l === 'fr' ? cat.nom.fr : cat.nom.en, 80) }), { mode: general.langue === 'auteur' ? 'en_fr' : general.langue }), color: 0x4caf7a });
    await annoncer(base, id, t);
    await alerterNouveau(await ticketPar(id), cat).catch(e => console.error('[esport] tickets : alerte', e?.message ?? e));
    return ticketPar(id);
  }

  // ---------------------------------------------------------------- Actions du staff

  const ouvert = ticket => {
    if (!ticket) throw refusTk('pas_ticket', {}, 404);
    if (ticket.statut === 'ferme') throw refusTk('deja_ferme', {}, 409);
  };

  async function apres(ticket, type, acteur, charge = {}) {
    const t = maintenant();
    await base.lot([{ sql: 'UPDATE tickets SET maj_le = ? WHERE id = ?', params: [iso(t), ticket.id] }, ev(type, ticket, acteur, charge)]);
    await annoncer(base, ticket.id, t, { acteur: acteur?.compte });
    return ticketPar(ticket.id);
  }

  async function prendre(ticket, acteur, { forcer = false } = {}) {
    ouvert(ticket);
    const deja = ticket.responsable_discord_id || ticket.responsable_compte_id;
    const memePersonne = (acteur.discordId && acteur.discordId === ticket.responsable_discord_id) || (acteur.compte && acteur.compte === ticket.responsable_compte_id);
    if (deja && !memePersonne && !forcer) throw refusTk('deja_pris', { staff: sur(ticket.responsable_nom, 80) }, 409);
    const t = maintenant();
    await base.executer("UPDATE tickets SET responsable_discord_id = ?, responsable_compte_id = ?, responsable_nom = ?, statut = 'pris_en_charge', pris_le = COALESCE(pris_le, ?) WHERE id = ?", [acteur.discordId ?? null, acteur.compte ?? null, String(acteur.nom ?? '').slice(0, 100), iso(t), ticket.id]);
    const { general, messages } = await contexte();
    await annonceSalon(ticket, general, messages, 'prise_en_charge', { staff: acteur.discordId ? `<@${acteur.discordId}>` : sur(acteur.nom, 80) });
    return apres(ticket, 'ticket.pris', acteur);
  }

  async function liberer(ticket, acteur) {
    ouvert(ticket);
    await base.executer("UPDATE tickets SET responsable_discord_id = NULL, responsable_compte_id = NULL, responsable_nom = NULL, statut = 'ouvert' WHERE id = ?", [ticket.id]);
    const { general, messages } = await contexte();
    await annonceSalon(ticket, general, messages, 'liberation', {});
    return apres(ticket, 'ticket.libere', acteur);
  }

  /** Assigne un compte de l'app (il doit voir la catégorie : vérifié par l'appelant). */
  async function assigner(ticket, acteur, { compte, nom, discordId }) {
    ouvert(ticket);
    const t = maintenant();
    await base.executer("UPDATE tickets SET responsable_compte_id = ?, responsable_discord_id = ?, responsable_nom = ?, statut = CASE WHEN statut = 'ouvert' THEN 'pris_en_charge' ELSE statut END, pris_le = COALESCE(pris_le, ?) WHERE id = ?", [compte, discordId ?? null, String(nom ?? '').slice(0, 100), iso(t), ticket.id]);
    return apres(ticket, 'ticket.assigne', acteur, { compte });
  }

  async function priorite(ticket, acteur, niveau) {
    ouvert(ticket);
    if (!['faible', 'moyen', 'urgent', 'critique'].includes(niveau)) throw refusTk('erreur');
    await base.executer('UPDATE tickets SET priorite = ? WHERE id = ?', [niveau, ticket.id]);
    const { general } = await contexte();
    const texte = bilingue(l => tx(l, 'priorite_changee', { priorite: nomPriorite(l, niveau) }), optsLangue(general, ticket));
    await posterSysteme(ticket, { embeds: [{ description: texte, color: 0x5865f2 }] }, texte);
    return apres(ticket, 'ticket.priorite', acteur, { priorite: niveau });
  }

  async function attente(ticket, acteur) {
    ouvert(ticket);
    await base.executer("UPDATE tickets SET statut = 'en_attente' WHERE id = ?", [ticket.id]);
    const { general, messages } = await contexte();
    await annonceSalon(ticket, general, messages, 'attente', {});
    return apres(ticket, 'ticket.statut', acteur, { statut: 'en_attente' });
  }

  async function statut(ticket, acteur, s) {
    ouvert(ticket);
    if (!STATUTS_OUVERTS.includes(s)) throw refusTk('erreur');
    if (s === 'en_attente') return attente(ticket, acteur);
    await base.executer('UPDATE tickets SET statut = ? WHERE id = ?', [s, ticket.id]);
    return apres(ticket, 'ticket.statut', acteur, { statut: s });
  }

  async function ajouterMembre(ticket, acteur, { id, nom }) {
    ouvert(ticket);
    if (!idDiscord(id)) throw refusTk('erreur');
    if (id === ticket.auteur_discord_id) return ticket;
    const r = await appel('PUT', `/channels/${ticket.salon_id}/permissions/${id}`, { type: 1, allow: DROITS_PARTICIPANT, deny: '0' });
    if (!r.ok) throw refusTk('erreur', {}, 502);
    await base.executer('INSERT INTO tickets_membres (ticket_id, discord_user_id, nom, ajoute_par, ajoute_le) VALUES (?, ?, ?, ?, ?) ON CONFLICT (ticket_id, discord_user_id) DO NOTHING', [ticket.id, id, String(nom ?? '').slice(0, 100), acteur.compte ?? acteur.discordId ?? null, iso(maintenant())]);
    const { general } = await contexte();
    const texte = bilingue(l => tx(l, 'ajoute', { membre: `<@${id}>` }), optsLangue(general, ticket));
    await posterSysteme(ticket, { embeds: [{ description: texte, color: 0x4caf7a }] }, texte);
    return apres(ticket, 'ticket.membre', acteur, { ajout: true });
  }

  async function retirerMembre(ticket, acteur, { id }) {
    ouvert(ticket);
    if (!idDiscord(id) || id === ticket.auteur_discord_id) throw refusTk('erreur');
    await appel('DELETE', `/channels/${ticket.salon_id}/permissions/${id}`);
    await base.executer('DELETE FROM tickets_membres WHERE ticket_id = ? AND discord_user_id = ?', [ticket.id, id]);
    const { general } = await contexte();
    const texte = bilingue(l => tx(l, 'retire', { membre: `<@${id}>` }), optsLangue(general, ticket));
    await posterSysteme(ticket, { embeds: [{ description: texte, color: 0xe8a23a }] }, texte);
    return apres(ticket, 'ticket.membre', acteur, { ajout: false });
  }

  async function renommer(ticket, acteur, nomVoulu) {
    ouvert(ticket);
    const nom = nomSalon(String(nomVoulu ?? '').includes('{numero}') ? nomVoulu : `${nomVoulu}`, { numero: ticket.numero, pseudo: ticket.auteur_nom, categorie: '' });
    if (!nom || nom.length < 2) throw refusTk('nom_invalide');
    const r = await appel('PATCH', `/channels/${ticket.salon_id}`, { name: nom });
    if (!r.ok) throw refusTk('erreur', {}, 502);
    await base.executer('UPDATE tickets SET salon_nom = ? WHERE id = ?', [nom, ticket.id]);
    return { ticket: await apres(ticket, 'ticket.renomme', acteur), nom };
  }

  async function transferer(ticket, acteur, categorieId) {
    ouvert(ticket);
    const cat = await categorie(categorieId);
    if (!cat || !cat.actif) throw refusTk('categorie_inactive');
    if (cat.id === ticket.categorie_id) return ticket;
    const { general } = await contexte();
    await base.executer('UPDATE tickets SET categorie_id = ? WHERE id = ?', [cat.id, ticket.id]);
    const nouveau = await ticketPar(ticket.id);
    await appel('PATCH', `/channels/${ticket.salon_id}`, { permission_overwrites: await surcharges(nouveau, cat, general) });
    const texte = bilingue(l => tx(l, 'transfere', { categorie: sur(l === 'fr' ? cat.nom.fr : cat.nom.en, 80) }), optsLangue(general, ticket));
    await posterSysteme(nouveau, { embeds: [{ description: texte, color: 0x5865f2 }] }, texte);
    return apres(nouveau, 'ticket.categorie', acteur, { de: ticket.categorie_id });
  }

  // ---------------------------------------------------------------- Fermeture, réouverture, note

  /** Derniers messages du salon relus avant la fermeture (le transcript est complet même sans Gateway). */
  async function rattraper(ticket) {
    if (!ticket.salon_id || ticket.salon_supprime_le) return;
    const apresId = ticket.dernier_message_id ? `&after=${ticket.dernier_message_id}` : '';
    const r = await appel('GET', `/channels/${ticket.salon_id}/messages?limit=100${apresId}`);
    if (!r.ok || !Array.isArray(r.corps)) return;
    const reglages = await lireGeneral(base);
    for (const m of [...r.corps].reverse()) await ingererMessage({ base, stockage, reglages, telecharger, botId, maintenant, estStaffCompte, surNouveau }, { ...m, channel_id: ticket.salon_id });
  }

  const dateCourte = (l, iso8601) => new Intl.DateTimeFormat(l === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(new Date(iso8601));

  /**
   * Ferme le ticket. `raison` facultative ; `auto` : fermeture automatique (inactivité) ; `sansDiscord` : le salon a
   * disparu (rien à poster).
   */
  async function fermer(ticket, acteur, { raison = '', auto = false, sansDiscord = false } = {}) {
    ouvert(ticket);
    if (!sansDiscord) await rattraper(ticket).catch(() => undefined);
    const t = maintenant();
    const { general, messages } = await contexte();
    const cat = await categorie(ticket.categorie_id);
    const texteRaison = l => (auto ? tx(l, 'raison_inactivite') : sur(raison, 300) || tx(l, 'raison_defaut'));
    // Statut d'abord (conditionnel : deux fermetures simultanées n'en font qu'une).
    const r = await base.executer("UPDATE tickets SET statut = 'ferme', ferme_le = ?, maj_le = ?, raison_fermeture = ?, ferme_par_nom = ? WHERE id = ? AND statut <> 'ferme'", [iso(t), iso(t), auto ? 'inactivite' : sur(raison, 300) || null, auto ? null : String(acteur?.nom ?? '').slice(0, 100), ticket.id]);
    if (Number(r.changements) !== 1) throw refusTk('deja_ferme', {}, 409);
    const ferme = await ticketPar(ticket.id);
    const opts = optsLangue(general, ticket);
    if (!sansDiscord && ticket.salon_id) {
      const staff = acteur?.discordId ? `<@${acteur.discordId}>` : sur(acteur?.nom ?? 'Esport HQ', 80);
      const texte = messageBilingue(messages, 'fermeture', l => ({ staff, raison: texteRaison(l) }), opts);
      await posterSysteme(ferme, { embeds: [{ description: texte.slice(0, 4000), color: 0xd9534f }], components: [{ type: 1, components: [{ type: 2, style: 2, custom_id: `tk:r:${ticket.id}`, label: [...new Set(['en', 'fr'].map(l => tx(l, 'b_rouvrir')))].join(' · ') }] }] }, texte);
      // Salon verrouillé (l'auteur lit seulement), déplacé dans les archives.
      const maj = await appel('PATCH', `/channels/${ticket.salon_id}`, { ...(general.categorieArchives ? { parent_id: general.categorieArchives } : {}), permission_overwrites: await surcharges(ferme, cat, general, { verrouille: true }) }, { raison: `Ticket ${ticket.numero} fermé` });
      if (maj.ok) await base.executer('UPDATE tickets SET archive_le = ? WHERE id = ?', [iso(t), ticket.id]);
    }
    // MP récapitulatif à l'auteur (et demande de note si la catégorie la prévoit).
    const vars = l => ({ numero: ticket.numero, categorie: sur(l === 'fr' ? cat?.nom.fr : cat?.nom.en, 80), serveur: sur(general.guildNom || 'Discord', 80), raison: texteRaison(l), ouverture: dateCourte(l, ticket.ouvert_le), fermeture: dateCourte(l, iso(t)) });
    const recap = messageBilingue(messages, 'mp_recap', vars, opts);
    const note = cat?.satisfaction !== false && !sansDiscord;
    const demande = note ? messageBilingue(messages, 'demande_note', vars, opts) : '';
    await envoyerMp(ticket.auteur_discord_id, {
      embeds: [{ title: titreTicket(ticket.numero, opts), description: [recap, demande].filter(Boolean).join('\n\n').slice(0, 4000), color: 0x5865f2 }],
      ...(note ? { components: [{ type: 1, components: [1, 2, 3, 4, 5].map(n => ({ type: 2, style: n >= 4 ? 3 : n <= 2 ? 4 : 2, custom_id: `tk:n:${ticket.id}:${n}`, label: `${n}/5` })) }] } : {}),
    });
    await base.lot([ev('ticket.ferme', ferme, acteur, { auto })]);
    await journalDiscord(general, { description: bilingue(l => tx(l, 'journal_ferme', { numero: ticket.numero, staff: acteur?.discordId ? `<@${acteur.discordId}>` : sur(acteur?.nom ?? 'Esport HQ', 80), raison: texteRaison(l) }), { mode: general.langue === 'auteur' ? 'en_fr' : general.langue }), color: 0xd9534f });
    await annoncer(base, ticket.id, t, { acteur: acteur?.compte });
    return ticketPar(ticket.id);
  }

  async function envoyerMp(discordId, charge, fichiers) {
    const canal = await appel('POST', '/users/@me/channels', { recipient_id: discordId });
    if (!canal.ok || !idDiscord(canal.corps?.id)) return null;
    const r = await appel('POST', `/channels/${canal.corps.id}/messages`, { allowed_mentions: { parse: [] }, ...charge }, fichiers ? { fichiers } : undefined);
    return r.ok ? r : null;
  }

  async function rouvrir(ticket, acteur) {
    if (!ticket) throw refusTk('pas_ticket', {}, 404);
    if (ticket.statut !== 'ferme') throw refusTk('pas_ferme', {}, 409);
    if (ticket.purge_le) throw refusTk('erreur', {}, 410);
    const { general, messages } = await contexte();
    const cat = await categorie(ticket.categorie_id);
    const t = maintenant();
    const statutNouveau = ticket.responsable_compte_id || ticket.responsable_discord_id ? 'pris_en_charge' : 'ouvert';
    const r = await base.executer("UPDATE tickets SET statut = ?, ferme_le = NULL, raison_fermeture = NULL, ferme_par_nom = NULL, avertissement_le = NULL, archive_le = NULL, derniere_activite_le = ?, maj_le = ? WHERE id = ? AND statut = 'ferme'", [statutNouveau, iso(t), iso(t), ticket.id]);
    if (Number(r.changements) !== 1) throw refusTk('pas_ferme', {}, 409);
    let rouvert = await ticketPar(ticket.id);
    let remis = false;
    if (rouvert.salon_id && !rouvert.salon_supprime_le) {
      const maj = await appel('PATCH', `/channels/${rouvert.salon_id}`, { parent_id: general.categorieOuverts, permission_overwrites: await surcharges(rouvert, cat, general) });
      remis = maj.ok;
      if (!maj.ok && maj.statut === 404) await base.executer('UPDATE tickets SET salon_supprime_le = ? WHERE id = ?', [iso(t), ticket.id]);
    }
    if (!remis) {
      const salon = await creerSalon(rouvert, cat ?? { modeleNom: 'ticket-{numero}', nom: { fr: '', en: '' }, rolesDiscord: [] }, general);
      if (salon.id) await base.executer('UPDATE tickets SET salon_id = ?, salon_nom = ?, salon_supprime_le = NULL, dernier_message_id = NULL WHERE id = ?', [salon.id, salon.nom, ticket.id]);
    }
    rouvert = await ticketPar(ticket.id);
    const texte = messageBilingue(messages, 'reouverture', { staff: acteur?.discordId ? `<@${acteur.discordId}>` : sur(acteur?.nom ?? '', 80) }, optsLangue(general, rouvert));
    await posterSysteme(rouvert, { content: `<@${rouvert.auteur_discord_id}>`, embeds: [{ description: texte, color: 0x4caf7a }], components: boutonsTicket(rouvert.id, optsLangue(general, rouvert)), allowed_mentions: { users: [rouvert.auteur_discord_id] } }, texte);
    return apres(rouvert, 'ticket.rouvert', acteur);
  }

  /** Note de satisfaction (l'auteur seulement, ticket fermé) ; une nouvelle note remplace la précédente. */
  async function noter(ticketId, discordId, note) {
    const ticket = await ticketPar(ticketId);
    if (!ticket || ticket.auteur_discord_id !== discordId) throw refusTk('pas_ticket', {}, 404);
    if (ticket.statut !== 'ferme') throw refusTk('pas_ferme', {}, 409);
    const n = Number(note);
    if (!Number.isInteger(n) || n < 1 || n > 5) throw refusTk('erreur');
    const t = maintenant();
    await base.lot([{ sql: 'UPDATE tickets SET note = ?, note_le = ? WHERE id = ?', params: [n, iso(t), ticket.id] }, ev('ticket.note', ticket, null, { note: n, responsable: ticket.responsable_compte_id })]);
    const { general } = await contexte();
    await journalDiscord(general, { description: bilingue(l => tx(l, 'journal_note', { numero: ticket.numero, note: n }), { mode: general.langue === 'auteur' ? 'en_fr' : general.langue }), color: 0xe8a23a });
    await annoncer(base, ticket.id, t);
    return ticketPar(ticket.id);
  }

  async function commenterNote(ticketId, discordId, texte) {
    const ticket = await ticketPar(ticketId);
    if (!ticket || ticket.auteur_discord_id !== discordId || !ticket.note) throw refusTk('pas_ticket', {}, 404);
    await base.executer('UPDATE tickets SET note_commentaire = ? WHERE id = ?', [String(texte ?? '').trim().slice(0, 1000) || null, ticket.id]);
    await annoncer(base, ticket.id, maintenant());
    return ticketPar(ticket.id);
  }

  /** Le salon d'un ticket a été supprimé sur Discord : noté ; un ticket encore ouvert est fermé (sans message). */
  async function salonSupprime(salonId) {
    const ticket = await ticketDuSalon(salonId);
    if (!ticket) return null;
    await base.executer('UPDATE tickets SET salon_supprime_le = COALESCE(salon_supprime_le, ?) WHERE id = ?', [iso(maintenant()), ticket.id]);
    if (ticket.statut !== 'ferme') return fermer({ ...ticket, salon_supprime_le: iso(maintenant()) }, { nom: 'Discord' }, { raison: 'salon supprimé', sansDiscord: true }).catch(() => null);
    return ticket;
  }

  // ---------------------------------------------------------------- Cron

  /** Délai de fermeture automatique d'un ticket (heures ; 0 : jamais). */
  const delaiFermeture = (cat, general) => (cat?.fermetureAutoH === null || cat?.fermetureAutoH === undefined ? general.fermetureAutoH : cat.fermetureAutoH);

  async function tachesCycle() {
    const { general, messages } = await contexte();
    const bilan = { avertis: 0, fermes: 0, salonsSupprimes: 0, purges: 0 };
    if (!general.actif || !jetonBot) return bilan;
    const t = maintenant();
    const cats = new Map((await base.tous('SELECT * FROM tickets_categories', [])).map(l => [l.id, categoriePublique(l)]));
    const ouverts = await base.tous("SELECT * FROM tickets WHERE statut <> 'ferme' ORDER BY derniere_activite_le LIMIT 500", []);
    for (const tk of ouverts) {
      if (bilan.avertis + bilan.fermes >= LOT_CRON) break;
      const h = delaiFermeture(cats.get(tk.categorie_id), general);
      if (!h) continue;
      const inactif = t - Date.parse(tk.derniere_activite_le);
      if (inactif >= h * H) {
        await fermer(tk, { nom: 'Esport HQ' }, { auto: true }).catch(e => console.error('[esport] tickets : fermeture automatique', e?.message ?? e));
        bilan.fermes++;
      } else if (general.avertissementH > 0 && !tk.avertissement_le && inactif >= Math.max(0, h - general.avertissementH) * H) {
        const reste = Math.max(1, Math.round((h * H - inactif) / H));
        await annonceSalon(tk, general, messages, 'avertissement', l => ({ delai: duree(l, reste) }));
        await base.executer('UPDATE tickets SET avertissement_le = ? WHERE id = ?', [iso(t), tk.id]);
        await annoncer(base, tk.id, t);
        bilan.avertis++;
      }
    }
    if (general.suppressionArchivesJours > 0) {
      const aSupprimer = await base.tous("SELECT id, salon_id FROM tickets WHERE statut = 'ferme' AND salon_id IS NOT NULL AND salon_supprime_le IS NULL AND ferme_le < ? LIMIT ?", [iso(t - general.suppressionArchivesJours * J), LOT_CRON]);
      for (const tk of aSupprimer) {
        const r = await appel('DELETE', `/channels/${tk.salon_id}`, undefined, { raison: 'Ticket archivé' });
        if (r.ok || r.statut === 404) {
          await base.executer('UPDATE tickets SET salon_supprime_le = ? WHERE id = ?', [iso(t), tk.id]);
          bilan.salonsSupprimes++;
        } else if (r.statut === 429) break;
      }
    }
    bilan.purges = await purgerAnciens(t - general.retentionJours * J);
    bilan.pieces = await piecesEffacees();
    return bilan;
  }

  /** Pièces des messages effacés (RGPD) : octets et lignes supprimés. */
  async function piecesEffacees() {
    const lignes = await base.tous("SELECT p.id, p.cle_stockage FROM tickets_pieces p JOIN tickets_messages m ON m.id = p.message_id WHERE m.supprime_le IS NOT NULL AND m.contenu = '' LIMIT 200", []);
    for (const p of lignes) {
      if (p.cle_stockage) await stockage?.supprimer(p.cle_stockage).catch(() => undefined);
      await base.executer('DELETE FROM tickets_pieces WHERE id = ?', [p.id]);
    }
    return lignes.length;
  }

  /** Rétention : conversation, pièces (octets compris), personnes ajoutées et réponses effacées ; la ligne reste (statistiques). */
  async function purgerAnciens(limite, { ids } = {}) {
    const lignes = ids ? await base.tous(`SELECT id FROM tickets WHERE id IN (${ids.map(() => '?').join(', ')})`, ids) : await base.tous("SELECT id FROM tickets WHERE statut = 'ferme' AND purge_le IS NULL AND ferme_le < ? LIMIT 50", [iso(limite)]);
    for (const { id } of lignes) {
      for (const p of await base.tous('SELECT cle_stockage FROM tickets_pieces WHERE ticket_id = ? AND cle_stockage IS NOT NULL', [id])) await stockage?.supprimer(p.cle_stockage).catch(() => undefined);
      await base.lot([
        { sql: 'DELETE FROM tickets_pieces WHERE ticket_id = ?', params: [id] },
        { sql: 'DELETE FROM tickets_messages WHERE ticket_id = ?', params: [id] },
        { sql: 'DELETE FROM tickets_membres WHERE ticket_id = ?', params: [id] },
        { sql: "UPDATE tickets SET reponses = '[]', note_commentaire = NULL, raison_fermeture = NULL, auteur_nom = '', purge_le = ? WHERE id = ?", params: [iso(maintenant()), id] },
      ]);
    }
    return lignes.length;
  }

  // ---------------------------------------------------------------- Alertes du staff (cloche et MP Discord)

  const preferences = compte => lireReglage(base, `pref:${compte}`, { mpNouveau: false, mpMessage: true });

  /** MP Discord à un compte de l'app (s'il a lié son Discord), dans sa langue. */
  async function mpCompte(compte, cle, vars) {
    const lie = await base.premier('SELECT dc.discord_user_id, c.langue FROM discord_comptes dc LEFT JOIN comptes c ON c.id = dc.compte_id WHERE dc.compte_id = ?', [compte]);
    if (!lie) return;
    await envoyerMp(lie.discord_user_id, { content: tx(langueDe(lie.langue), cle, vars).slice(0, 2000) });
  }

  /** Nouveau ticket : MP aux comptes qui traitent la catégorie et l'ont demandé (la cloche passe par le bus). */
  async function alerterNouveau(ticket, cat) {
    const comptes = [...(await comptesDeCategorie(base, ticket.categorie_id, { repondre: true }))].slice(0, 20);
    for (const c of comptes) {
      if (!(await preferences(c)).mpNouveau) continue;
      await mpCompte(c, 'mp_nouveau', { numero: ticket.numero, categorie: sur(cat.nom.fr, 80), salon: `<#${ticket.salon_id}>` }).catch(() => undefined);
    }
  }

  /**
   * Nouveau message de l'auteur (ou d'une personne ajoutée) dans un ticket pris en charge : notification au responsable
   * (s'il voit encore la catégorie), une seule tant qu'elle n'est pas lue ; MP s'il l'a demandé.
   */
  async function surNouveau(ticket, message) {
    if (message.staff || !ticket.responsable_compte_id) return;
    const resp = ticket.responsable_compte_id;
    if (!(await comptesDeCategorie(base, ticket.categorie_id)).has(resp)) return;
    const deja = await base.premier("SELECT id FROM notifications WHERE compte_id = ? AND type = 'tk-message' AND lue_le IS NULL AND charge LIKE ?", [resp, `%"ticket":"${ticket.id}"%`]);
    if (deja) return;
    const t = maintenant();
    const cat = await categorie(ticket.categorie_id);
    await base.executer(
      'INSERT INTO notifications (id, compte_id, team_id, type, charge, cree_le, categorie, ticket_categorie_id) VALUES (?, ?, NULL, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
      [`${message.id}:${resp}`, resp, 'tk-message', JSON.stringify({ numero: Number(ticket.numero), ticket: ticket.id, categorie: ticket.categorie_id, nom: cat?.nom.fr ?? null }), iso(t), 'tickets', ticket.categorie_id],
    );
    await publierEnBase(base, { sujet: `compte:${resp}`, action: 'cree' }, t).catch(() => undefined);
    if ((await preferences(resp)).mpMessage) await mpCompte(resp, 'mp_message', { numero: ticket.numero, auteur: sur(message.auteurNom, 80), salon: `<#${ticket.salon_id}>` }).catch(() => undefined);
  }

  /** Message reçu d'un compte Discord lié à un compte de l'app qui répond aux tickets de cette catégorie : du staff. */
  async function estStaffCompte(discordId, categorieId) {
    const lie = await base.premier('SELECT compte_id, super_admin FROM discord_comptes WHERE discord_user_id = ?', [discordId]);
    if (!lie) return false;
    const d = await droitsTickets(base, { compte: lie.compte_id, superAdmin: Number(lie.super_admin) === 1 });
    return d.repondre && voitCategorie(d, categorieId);
  }

  /** Rappels pour la Gateway (superviseur) et la relecture : staff reconnu par son compte lié, salon supprimé. */
  const contexteIngestion = { surSalonSupprime: salonSupprime, estStaffCompte, surNouveau };

  return {
    verifierOuverture,
    ouvrir,
    prendre,
    liberer,
    assigner,
    priorite,
    attente,
    statut,
    ajouterMembre,
    retirerMembre,
    renommer,
    transferer,
    fermer,
    rouvrir,
    noter,
    commenterNote,
    salonSupprime,
    tachesCycle,
    purgerAnciens,
    posterSysteme,
    envoyerMp,
    ticketPar,
    ticketDuSalon,
    categorie,
    contexte,
    contexteIngestion,
    estStaffCompte,
    surNouveau,
    piecesEffacees,
    botId,
    lienApp,
    echec,
  };
}

export const estRefus = e => e instanceof RefusTicket;
export { jsonOu };
