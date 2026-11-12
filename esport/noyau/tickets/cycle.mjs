/**
 * Tickets : cycle de vie (docs/esport/tickets.md, « Cycle de vie »). Utilisé par le bot (boutons, fenêtres,
 * commandes), par l'app (étape 3) et par le cron (fermeture automatique, archives, rétention).
 *
 *  - ouverture : contrôles (tickets activés, catégorie active, liste noire, plafond par personne, débit), numéro
 *    séquentiel, SALON PRIVÉ dans la catégorie Discord des tickets ouverts (droits : @everyone refusé ; l'auteur et les
 *    personnes ajoutées écrivent et envoient leurs fichiers ; les rôles Discord de la catégorie lisent seulement avec
 *    « Le staff répond uniquement depuis l'AppDashboard », par défaut ; le bot a tous ses droits), message d'accueil
 *    (réponses du formulaire, boutons), réponse hors horaires, journal ;
 *  - prise en charge, libération, assignation, priorité, attente, personnes ajoutées / retirées, renommage, transfert ;
 *    seuls les événements réglés dans « Messages automatiques dans le salon » (reglages.mjs : ANNONCES_DEFAUT) sont
 *    postés dans le salon ; les autres restent notés dans la conversation de l'app (message du bot non publié) et dans
 *    le salon des journaux du staff ;
 *  - mentions (« Mentionner » de l'app, /ticket ping) : le bot mentionne exactement les personnes et rôles choisis
 *    (allowed_mentions), 3 par minute et par ticket au plus ;
 *  - fermeture : derniers messages relus, statut, message de fermeture, salon VERROUILLÉ (l'auteur ne peut plus écrire)
 *    et déplacé dans la catégorie des archives, MP récapitulatif à l'auteur avec la demande de note (1 à 5, puis
 *    commentaire facultatif), journal ; transcript = la conversation gardée en base (transcript.mjs) ;
 *  - réouverture (salon remis en place, ou recréé s'il a été supprimé) ;
 *  - ticket permanent (jamais fermé automatiquement, avertissement en attente annulé), réglé par le staff ;
 *  - cron : avertissement avant la fermeture automatique, fermeture après le délai sans message (ticket permanent >
 *    réglage de la catégorie > réglage général : reglages.mjs, `delaiFermeture`), suppression des salons archivés
 *    après N jours, rétention (conversation et pièces effacées après N jours).
 *
 * Acteur : `{ discordId?, nom, compte? }` (personne sur Discord, ou compte de l'app). Les écritures Discord passent par
 * l'API REST du bot (discord.mjs) ; un échec Discord ne laisse jamais la base incohérente (statut d'abord, Discord
 * ensuite, au mieux).
 */

import { lienProfond } from '../notifications/cibles.mjs';
import { echec, iso, jsonOu, nouvelId } from '../outils.mjs';
import { evenement } from '../evenements.mjs';
import { limiter } from '../limites.mjs';
import { comptesDeCategorie, droitsTickets, voitCategorie } from './acces.mjs';
import { publierEnBase } from '../temps-reel/diffusion.mjs';
import { annoncer, ingererMessage, plusRecent, telechargeurCdn } from './conversation.mjs';
import { DROITS_BOT, DROITS_LECTURE, DROITS_PARTICIPANT, P, REFUS_ECRITURE, REFUS_ECRITURE_MINIMAL, idDiscord, rest } from './discord.mjs';
import { boutonsTicket, chargeAccueil, nomPriorite, nomSalon, titreTicket } from './panneaux.mjs';
import { STATUTS_OUVERTS, annonceActive, categoriePublique, dansHoraires, delaiFermeture, instructionReglage, lireGeneral, lireHoraires, lireMessages, lireReglage, reponsesAppSeules } from './reglages.mjs';
import { REPONSES_ANCIENNES, REPONSE_SALON } from './modeles.mjs';
import { bilingue, duree, langueDe, messageBilingue, messageRegle, nom2, remplir, sur, surLong, t as tx } from './textes.mjs';

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

  /**
   * Événement NON publié dans le salon (« Messages automatiques dans le salon » coupé pour lui) : noté dans la
   * conversation de l'app comme un message du bot sans message Discord (`discord_message_id` vide, envoi « ok » :
   * vue.mjs le montre « non publié sur Discord »), et une ligne dans le salon des journaux du staff.
   */
  async function noterSilencieux(ticket, general, texte, acteur) {
    await base.executer(
      `INSERT INTO tickets_messages (id, ticket_id, discord_message_id, genre, auteur_discord_id, auteur_compte_id, auteur_nom, staff, contenu, envoi, cree_le)
       VALUES (?, ?, NULL, 'systeme', ?, ?, ?, 1, ?, 'ok', ?)`,
      [nouvelId(), ticket.id, botId, acteur?.compte ?? null, 'Esport HQ', String(texte ?? '').slice(0, 8000), iso(maintenant())],
    );
    const optsJournal = { mode: general.langue === 'auteur' ? 'en_fr' : general.langue };
    const ligne = bilingue(l => tx(l, 'journal_evenement', { numero: ticket.numero, texte: ticket.salon_id ? `<#${ticket.salon_id}> · ${String(texte ?? '').split('\n')[0]}` : String(texte ?? '').split('\n')[0] }), optsJournal);
    await journalDiscord(general, { description: ligne.slice(0, 4000), color: 0x8b8b9a }).catch(() => undefined);
    return null;
  }

  /**
   * Message d'un événement du ticket : posté dans le salon si l'événement `cle` est activé (Configuration › Messages ›
   * « Messages automatiques dans le salon »), sinon noté sans bruit (noterSilencieux). `charge` : message Discord.
   */
  async function evenementSalon(ticket, general, cle, charge, texte, { acteur } = {}) {
    if (annonceActive(general, cle)) return posterSysteme(ticket, charge, texte);
    return noterSilencieux(ticket, general, texte, acteur);
  }

  /** Message court bilingue d'un événement (prise en charge, attente…), personnalisable (Configuration › Messages). */
  async function annonceSalon(ticket, general, messages, cle, vars, { acteur } = {}) {
    const texte = messageBilingue(messages, cle, vars, optsLangue(general, ticket));
    return evenementSalon(ticket, general, cle, { embeds: [{ description: texte.slice(0, 4000), color: 0x5865f2 }] }, texte, { acteur });
  }

  /** Texte fixe bilingue d'un événement (priorité, personne retirée, transfert…). */
  async function annonceFixe(ticket, general, cle, texte, couleur, { acteur } = {}) {
    return evenementSalon(ticket, general, cle, { embeds: [{ description: texte, color: couleur }] }, texte, { acteur });
  }

  async function journalDiscord(general, embed) {
    if (!general.salonJournaux) return;
    await appel('POST', `/channels/${general.salonJournaux}/messages`, { embeds: [embed], allowed_mentions: { parse: [] } });
  }

  const ev = (type, ticket, acteur, charge = {}) =>
    evenement(type, { acteur: acteur?.compte ?? null, entiteType: 'ticket', entiteId: ticket.id, charge: { numero: Number(ticket.numero), categorie: ticket.categorie_id, ...charge }, maintenant: maintenant() });

  // ---------------------------------------------------------------- Droits des salons

  /** Droits de l'auteur et des personnes ajoutées : ils écrivent et envoient leurs fichiers (ticket ouvert). */
  const DROITS_PERSONNE = Object.freeze({ allow: DROITS_PARTICIPANT, deny: '0' });
  /**
   * Droits des rôles Discord de la catégorie (le staff) : écrire (réglage désactivé), ou lire seulement (« Le staff
   * répond uniquement depuis l'AppDashboard », par défaut ; `minimal` : repli, seul « Envoyer des messages » refusé).
   */
  const droitsStaff = (general, { minimal = false } = {}) => (reponsesAppSeules(general) ? { allow: DROITS_LECTURE, deny: minimal ? REFUS_ECRITURE_MINIMAL : REFUS_ECRITURE } : { allow: DROITS_PARTICIPANT, deny: '0' });

  /**
   * Surcharges de droits d'un salon de ticket. L'auteur et les personnes ajoutées écrivent (ticket ouvert) ou lisent
   * seulement (`verrouille` : ticket fermé). Les rôles de la catégorie lisent sans écrire avec « Le staff répond
   * uniquement depuis l'AppDashboard » (par défaut). Le bot garde tous ses droits.
   */
  async function surcharges(ticket, cat, general, { verrouille = false, minimal = false } = {}) {
    const ajoutes = await base.tous('SELECT discord_user_id FROM tickets_membres WHERE ticket_id = ?', [ticket.id]);
    const droits = droitsStaff(general, { minimal });
    const personne = verrouille ? { allow: VOIR_HISTORIQUE, deny: P.ENVOYER.toString() } : DROITS_PERSONNE;
    const liste = [{ id: general.guildId, type: 0, allow: '0', deny: P.VOIR_SALON.toString() }];
    for (const r of cat?.rolesDiscord ?? []) if (r !== general.guildId) liste.push({ id: r, type: 0, ...droits });
    liste.push({ id: ticket.auteur_discord_id, type: 1, ...personne });
    for (const a of ajoutes) if (a.discord_user_id !== ticket.auteur_discord_id) liste.push({ id: a.discord_user_id, type: 1, ...personne });
    if (botId) liste.push({ id: botId, type: 1, allow: DROITS_BOT, deny: '0' });
    return liste;
  }

  /**
   * Écriture Discord qui porte des surcharges de droits (`corps(minimal)`) : si Discord refuse (403 : le bot ne peut
   * refuser que des permissions qu'il a), nouvel essai avec le refus minimal (« Envoyer des messages » seul), journalisé.
   */
  async function appelDroits(methode, chemin, corps, general, opts) {
    const r = await appel(methode, chemin, await corps(false), opts);
    if (r.ok || r.statut !== 403 || !reponsesAppSeules(general)) return r;
    console.error(`[esport] tickets : surcharges complètes refusées par Discord (${chemin}) ; repli sur « Envoyer des messages » refusé seul`);
    return appel(methode, chemin, await corps(true), opts);
  }

  async function creerSalon(ticket, cat, general) {
    const nom = nomSalon(cat.modeleNom, { numero: ticket.numero, pseudo: ticket.auteur_nom, categorie: cat.nom.en || cat.nom.fr });
    const r = await appelDroits(
      'POST',
      `/guilds/${general.guildId}/channels`,
      async minimal => ({ name: nom, type: 0, parent_id: general.categorieOuverts, topic: `${titreTicket(ticket.numero, { mode: 'en_fr' })} · ${nom2(cat.nom, { mode: 'en_fr' })}`.slice(0, 1024), permission_overwrites: await surcharges(ticket, cat, general, { minimal }) }),
      general,
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
      // Plus grand numéro en base, ou d'un ticket supprimé (migration 0056) : un numéro ne sert jamais deux fois.
      const m = await base.premier('SELECT MAX(numero) AS n FROM tickets', []);
      numero = Math.max(Number(m?.n ?? 0), await dernierNumeroSupprime()) + 1;
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
    // Consigne ajoutée à l'accueil : l'auteur écrit et envoie ses fichiers directement dans le salon.
    const accueil = bilingue(l => `${remplir(accueilRegle(l), vars(l)).trim()}\n\n${tx(l, 'consigne_fichiers')}`, opts);
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
    await annonceSalon(ticket, general, messages, 'prise_en_charge', { staff: acteur.discordId ? `<@${acteur.discordId}>` : sur(acteur.nom, 80) }, { acteur });
    return apres(ticket, 'ticket.pris', acteur);
  }

  async function liberer(ticket, acteur) {
    ouvert(ticket);
    await base.executer("UPDATE tickets SET responsable_discord_id = NULL, responsable_compte_id = NULL, responsable_nom = NULL, statut = 'ouvert' WHERE id = ?", [ticket.id]);
    const { general, messages } = await contexte();
    await annonceSalon(ticket, general, messages, 'liberation', {}, { acteur });
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
    await annonceFixe(ticket, general, 'priorite', texte, 0x5865f2, { acteur });
    return apres(ticket, 'ticket.priorite', acteur, { priorite: niveau });
  }

  async function attente(ticket, acteur) {
    ouvert(ticket);
    await base.executer("UPDATE tickets SET statut = 'en_attente' WHERE id = ?", [ticket.id]);
    const { general, messages } = await contexte();
    await annonceSalon(ticket, general, messages, 'attente', {}, { acteur });
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
    const general = await lireGeneral(base);
    const r = await appel('PUT', `/channels/${ticket.salon_id}/permissions/${id}`, { type: 1, ...DROITS_PERSONNE });
    if (!r.ok) throw refusTk('erreur', {}, 502);
    await base.executer('INSERT INTO tickets_membres (ticket_id, discord_user_id, nom, ajoute_par, ajoute_le) VALUES (?, ?, ?, ?, ?) ON CONFLICT (ticket_id, discord_user_id) DO NOTHING', [ticket.id, id, String(nom ?? '').slice(0, 100), acteur.compte ?? acteur.discordId ?? null, iso(maintenant())]);
    const texte = bilingue(l => tx(l, 'ajoute', { membre: `<@${id}>` }), optsLangue(general, ticket));
    await annonceFixe(ticket, general, 'ajoute', texte, 0x4caf7a, { acteur });
    return apres(ticket, 'ticket.membre', acteur, { ajout: true });
  }

  async function retirerMembre(ticket, acteur, { id }) {
    ouvert(ticket);
    if (!idDiscord(id) || id === ticket.auteur_discord_id) throw refusTk('erreur');
    await appel('DELETE', `/channels/${ticket.salon_id}/permissions/${id}`);
    await base.executer('DELETE FROM tickets_membres WHERE ticket_id = ? AND discord_user_id = ?', [ticket.id, id]);
    const { general } = await contexte();
    const texte = bilingue(l => tx(l, 'retire', { membre: `<@${id}>` }), optsLangue(general, ticket));
    await annonceFixe(ticket, general, 'retire', texte, 0xe8a23a, { acteur });
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
    const maj = await appelDroits('PATCH', `/channels/${ticket.salon_id}`, async minimal => ({ permission_overwrites: await surcharges(nouveau, cat, general, { minimal }) }), general);
    if (!maj.ok) console.error(`[esport] tickets : droits du salon du ticket ${ticket.numero} non mis à jour au transfert (${maj.motif ?? `HTTP ${maj.statut}`})`);
    const texte = bilingue(l => tx(l, 'transfere', { categorie: sur(l === 'fr' ? cat.nom.fr : cat.nom.en, 80) }), optsLangue(general, ticket));
    await annonceFixe(nouveau, general, 'transfere', texte, 0x5865f2, { acteur });
    return apres(nouveau, 'ticket.categorie', acteur, { de: ticket.categorie_id });
  }

  /**
   * Ticket permanent (`actif`) : jamais fermé automatiquement, quel que soit le réglage de sa catégorie ; un
   * avertissement d'inactivité en attente est annulé. Annoncé dans le salon d'un ticket ouvert. Rend la ligne.
   */
  async function permanent(ticket, acteur, actif) {
    if (!ticket) throw refusTk('pas_ticket', {}, 404);
    const voulu = actif === true;
    if ((Number(ticket.permanent) === 1) === voulu) return ticketPar(ticket.id);
    const t = maintenant();
    await base.executer('UPDATE tickets SET permanent = ?, permanent_par = ?, permanent_le = ?, avertissement_le = NULL WHERE id = ?', [voulu ? 1 : 0, voulu ? String(acteur?.nom ?? '').slice(0, 100) || null : null, voulu ? iso(t) : null, ticket.id]);
    if (ticket.statut !== 'ferme') {
      const { general } = await contexte();
      const texte = bilingue(l => tx(l, voulu ? 'permanent_actif' : 'permanent_inactif'), optsLangue(general, ticket));
      await annonceFixe(ticket, general, 'permanent', texte, 0x5865f2, { acteur });
    }
    return apres(ticket, 'ticket.permanent', acteur, { permanent: voulu });
  }

  // ---------------------------------------------------------------- Mentions (« Mentionner » de l'app, /ticket ping)

  /**
   * Le bot mentionne dans le salon EXACTEMENT les personnes et rôles choisis (`allowed_mentions` limité à eux ; un texte
   * facultatif, mentions neutralisées). Rôles : seulement ceux de la catégorie (jamais @everyone). 3 mentions par minute
   * et par ticket au plus (`tickets_ping`). Gardé dans la conversation (message du bot) avec les noms lisibles.
   * `cibles` : `[{ type: 'membre' | 'role', id, nom }]`. Rend la ligne du ticket.
   */
  async function mentionner(ticket, acteur, { cibles = [], message = '' } = {}) {
    ouvert(ticket);
    if (!ticket.salon_id || ticket.salon_supprime_le) throw refusTk('erreur', {}, 409);
    const cat = await categorie(ticket.categorie_id);
    const general = await lireGeneral(base);
    const liste = (Array.isArray(cibles) ? cibles : []).slice(0, 30);
    const membres = [];
    const roles = [];
    const noms = [];
    for (const c of liste) {
      const id = idDiscord(String(c?.id ?? ''));
      if (!id) continue;
      if (c?.type === 'role') {
        if (id === general.guildId || !(cat?.rolesDiscord ?? []).includes(id)) throw refusTk('ping_role_interdit', {}, 400);
        if (!roles.includes(id) && roles.length < 5) {
          roles.push(id);
          noms.push(`@${sur(c?.nom, 60) || id}`);
        }
      } else if (!membres.includes(id) && membres.length < 10) {
        membres.push(id);
        noms.push(sur(c?.nom, 60) || id);
      }
    }
    if (!membres.length && !roles.length) throw refusTk('ping_vide');
    const texteLibre = String(message ?? '').replace(/\r\n?/g, '\n').trim().slice(0, 500);
    try {
      await limiter(base, 'tickets_ping', ticket.id, maintenant());
    } catch {
      throw refusTk('ping_trop_vite', {}, 429);
    }
    const staff = acteur?.discordId ? `<@${acteur.discordId}>` : sur(acteur?.nom ?? 'Staff', 80);
    const mentions = [...membres.map(id => `<@${id}>`), ...roles.map(id => `<@&${id}>`)].join(' ');
    const corps = texteLibre ? `**${tx('fr', 'staff_prefixe', { pseudo: sur(acteur?.nom ?? 'Staff', 60) })}** : ${surLong(texteLibre, 500)}` : bilingue(l => tx(l, 'ping_defaut', { staff }), optsLangue(general, ticket));
    const contenu = `${mentions}\n${corps}`.slice(0, 2000);
    const trace = `${tx('fr', 'ping_trace', { qui: noms.join(', ') })}${texteLibre ? ` · ${texteLibre}` : ''}`;
    const r = await posterSysteme(ticket, { content: contenu, allowed_mentions: { parse: [], users: membres, roles } }, trace, { acteur: { discordId: acteur?.discordId ?? null, compte: acteur?.compte ?? null, nom: String(acteur?.nom ?? 'Staff') } });
    if (!r?.ok) throw refusTk('erreur', {}, 502);
    const t = maintenant();
    await base.lot([{ sql: 'UPDATE tickets SET maj_le = ?, derniere_activite_le = ?, avertissement_le = NULL WHERE id = ?', params: [iso(t), iso(t), ticket.id] }, ev('ticket.mention', ticket, acteur, { membres: membres.length, roles: roles.length })]);
    await annoncer(base, ticket.id, t, { acteur: acteur?.compte });
    return ticketPar(ticket.id);
  }

  /**
   * Droits des salons des tickets OUVERTS remis à jour : réglage « Le staff répond uniquement depuis l'AppDashboard »
   * changé, ou mise à niveau (migrerDroits). Au mieux ; un échec est journalisé, sans contenu ; arrêt sur limite de
   * débit (`limite`). Rend `{ ok, echecs, total, limite }`.
   */
  async function reappliquerDroits() {
    const general = await lireGeneral(base);
    const bilan = { ok: 0, echecs: 0, total: 0, limite: false };
    if (!jetonBot || !general.guildId) return bilan;
    const ouverts = await base.tous("SELECT * FROM tickets WHERE statut <> 'ferme' AND salon_id IS NOT NULL AND salon_supprime_le IS NULL ORDER BY ouvert_le LIMIT 200", []);
    bilan.total = ouverts.length;
    for (const tk of ouverts) {
      const cat = await categorie(tk.categorie_id);
      const r = await appelDroits('PATCH', `/channels/${tk.salon_id}`, async minimal => ({ permission_overwrites: await surcharges(tk, cat, general, { minimal }) }), general, { raison: 'Réglage des réponses' });
      if (r.ok) {
        bilan.ok++;
        continue;
      }
      bilan.echecs++;
      console.error(`[esport] tickets : droits du salon du ticket ${tk.numero} non mis à jour (${r.motif ?? `HTTP ${r.statut}`})`);
      if (r.statut === 429) {
        bilan.limite = true;
        break;
      }
    }
    return bilan;
  }

  /**
   * Mise à niveau, une seule fois (clé `migration_droits_v3`), au premier passage du cron après le déploiement :
   *  - salons des tickets ouverts : l'auteur et les personnes ajoutées peuvent de nouveau écrire et envoyer des
   *    fichiers (l'ancien réglage les mettait en lecture seule, avec un bouton « Répondre ») ; le staff garde le
   *    réglage « Le staff répond uniquement depuis l'AppDashboard » ;
   *  - textes des panneaux enregistrés : l'ancienne consigne (« utilisez le bouton Répondre ») remplacée par la
   *    nouvelle (à republier sur Discord).
   * Au mieux, journalisé ; refaite au passage suivant si Discord a imposé d'attendre (limite de débit). Rend le bilan,
   * ou null si déjà faite.
   */
  async function migrerDroits() {
    if (await base.premier("SELECT cle FROM tickets_reglages WHERE cle = 'migration_droits_v3'", [])) return null;
    const bilan = await reappliquerDroits();
    if (bilan.limite) {
      console.error(`[esport] tickets : mise à niveau des droits interrompue par Discord (limite de débit) : ${bilan.ok}/${bilan.total}, reprise au prochain passage`);
      return bilan;
    }
    let panneaux = 0;
    for (const p of await base.tous('SELECT id, texte FROM tickets_panneaux', [])) {
      const texte = jsonOu(p.texte, null);
      if (!texte || typeof texte !== 'object') continue;
      let change = false;
      for (const l of ['fr', 'en']) {
        if (typeof texte[l] !== 'string' || !texte[l].includes(REPONSES_ANCIENNES[l])) continue;
        texte[l] = texte[l].split(REPONSES_ANCIENNES[l]).join(REPONSE_SALON[l]);
        change = true;
      }
      if (!change) continue;
      await base.executer('UPDATE tickets_panneaux SET texte = ?, maj_le = ? WHERE id = ?', [JSON.stringify(texte), iso(maintenant()), p.id]);
      panneaux++;
    }
    await base.lot([instructionReglage('migration_droits_v3', { ...bilan, panneaux, le: iso(maintenant()) }, null, maintenant())]);
    console.log(`[esport] tickets : mise à niveau faite (droits de ${bilan.ok}/${bilan.total} salon(s) ouvert(s) remis à jour, ${bilan.echecs} échec(s) ; ${panneaux} texte(s) de panneau mis à jour, à republier)`);
    return { ...bilan, panneaux };
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
    // Statut d'abord (conditionnel : deux fermetures simultanées n'en font qu'une ; une fermeture automatique ne passe
    // pas sur un ticket rendu permanent entre-temps).
    const sql = auto
      ? "UPDATE tickets SET statut = 'ferme', ferme_le = ?, maj_le = ?, raison_fermeture = ?, ferme_par_nom = ? WHERE id = ? AND statut <> 'ferme' AND permanent = 0"
      : "UPDATE tickets SET statut = 'ferme', ferme_le = ?, maj_le = ?, raison_fermeture = ?, ferme_par_nom = ? WHERE id = ? AND statut <> 'ferme'";
    const r = await base.executer(sql, [iso(t), iso(t), auto ? 'inactivite' : sur(raison, 300) || null, auto ? null : String(acteur?.nom ?? '').slice(0, 100), ticket.id]);
    if (Number(r.changements) !== 1) throw refusTk('deja_ferme', {}, 409);
    const ferme = await ticketPar(ticket.id);
    const opts = optsLangue(general, ticket);
    if (!sansDiscord && ticket.salon_id) {
      const staff = acteur?.discordId ? `<@${acteur.discordId}>` : sur(acteur?.nom ?? 'Esport HQ', 80);
      const texte = messageBilingue(messages, 'fermeture', l => ({ staff, raison: texteRaison(l) }), opts);
      await evenementSalon(ferme, general, 'fermeture', { embeds: [{ description: texte.slice(0, 4000), color: 0xd9534f }], components: [{ type: 1, components: [{ type: 2, style: 2, custom_id: `tk:r:${ticket.id}`, label: [...new Set(['en', 'fr'].map(l => tx(l, 'b_rouvrir')))].join(' · ') }] }] }, texte, { acteur });
      // Salon verrouillé (l'auteur lit seulement), déplacé dans les archives.
      const maj = await appelDroits('PATCH', `/channels/${ticket.salon_id}`, async minimal => ({ ...(general.categorieArchives ? { parent_id: general.categorieArchives } : {}), permission_overwrites: await surcharges(ferme, cat, general, { verrouille: true, minimal }) }), general, { raison: `Ticket ${ticket.numero} fermé` });
      if (maj.ok) await base.executer('UPDATE tickets SET archive_le = ? WHERE id = ?', [iso(t), ticket.id]);
    }
    // MP récapitulatif à l'auteur (et demande de note si la catégorie la prévoit).
    const vars = l => ({ numero: ticket.numero, categorie: sur(l === 'fr' ? cat?.nom.fr : cat?.nom.en, 80), serveur: sur(general.guildNom || 'Discord', 80), raison: texteRaison(l), ouverture: dateCourte(l, ticket.ouvert_le), fermeture: dateCourte(l, iso(t)) });
    const recap = messageBilingue(messages, 'mp_recap', vars, opts);
    const note = cat?.satisfaction !== false && !sansDiscord;
    const demande = note ? messageBilingue(messages, 'demande_note', vars, opts) : '';
    if (annonceActive(general, 'mp_fermeture')) {
      await envoyerMp(ticket.auteur_discord_id, {
        embeds: [{ title: titreTicket(ticket.numero, opts), description: [recap, demande].filter(Boolean).join('\n\n').slice(0, 4000), color: 0x5865f2 }],
        ...(note ? { components: [{ type: 1, components: [1, 2, 3, 4, 5].map(n => ({ type: 2, style: n >= 4 ? 3 : n <= 2 ? 4 : 2, custom_id: `tk:n:${ticket.id}:${n}`, label: `${n}/5` })) }] } : {}),
      });
    }
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
    // Un ticket supprimé se restaure d'abord (restaurer, avec ou sans réouverture).
    if (ticket.supprime_le) throw refusTk('supprime_deja', {}, 409);
    const { general, messages } = await contexte();
    const cat = await categorie(ticket.categorie_id);
    const t = maintenant();
    const statutNouveau = ticket.responsable_compte_id || ticket.responsable_discord_id ? 'pris_en_charge' : 'ouvert';
    const r = await base.executer("UPDATE tickets SET statut = ?, ferme_le = NULL, raison_fermeture = NULL, ferme_par_nom = NULL, avertissement_le = NULL, archive_le = NULL, derniere_activite_le = ?, maj_le = ? WHERE id = ? AND statut = 'ferme'", [statutNouveau, iso(t), iso(t), ticket.id]);
    if (Number(r.changements) !== 1) throw refusTk('pas_ferme', {}, 409);
    let rouvert = await ticketPar(ticket.id);
    let remis = false;
    if (rouvert.salon_id && !rouvert.salon_supprime_le) {
      const maj = await appelDroits('PATCH', `/channels/${rouvert.salon_id}`, async minimal => ({ parent_id: general.categorieOuverts, permission_overwrites: await surcharges(rouvert, cat, general, { minimal }) }), general);
      remis = maj.ok;
      if (!maj.ok && maj.statut === 404) await base.executer('UPDATE tickets SET salon_supprime_le = ? WHERE id = ?', [iso(t), ticket.id]);
    }
    if (!remis) {
      const salon = await creerSalon(rouvert, cat ?? { modeleNom: 'ticket-{numero}', nom: { fr: '', en: '' }, rolesDiscord: [] }, general);
      if (salon.id) await base.executer('UPDATE tickets SET salon_id = ?, salon_nom = ?, salon_supprime_le = NULL, dernier_message_id = NULL WHERE id = ?', [salon.id, salon.nom, ticket.id]);
    }
    rouvert = await ticketPar(ticket.id);
    const texte = messageBilingue(messages, 'reouverture', { staff: acteur?.discordId ? `<@${acteur.discordId}>` : sur(acteur?.nom ?? '', 80) }, optsLangue(general, rouvert));
    await evenementSalon(rouvert, general, 'reouverture', { content: `<@${rouvert.auteur_discord_id}>`, embeds: [{ description: texte, color: 0x4caf7a }], components: boutonsTicket(rouvert.id, optsLangue(general, rouvert)), allowed_mentions: { users: [rouvert.auteur_discord_id] } }, texte, { acteur });
    return apres(rouvert, 'ticket.rouvert', acteur);
  }

  /** Note de satisfaction (l'auteur seulement, ticket fermé) ; une nouvelle note remplace la précédente. */
  async function noter(ticketId, discordId, note) {
    const ticket = await ticketPar(ticketId);
    if (!ticket || ticket.supprime_le || ticket.auteur_discord_id !== discordId) throw refusTk('pas_ticket', {}, 404);
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
    if (!ticket || ticket.supprime_le || ticket.auteur_discord_id !== discordId || !ticket.note) throw refusTk('pas_ticket', {}, 404);
    await base.executer('UPDATE tickets SET note_commentaire = ? WHERE id = ?', [String(texte ?? '').trim().slice(0, 1000) || null, ticket.id]);
    await annoncer(base, ticket.id, maintenant());
    return ticketPar(ticket.id);
  }

  // ---------------------------------------------------------------- Suppression d'un ticket fermé (migrations 0056 et 0065)

  async function dernierNumeroSupprime() {
    return Number(jsonOu((await base.premier("SELECT valeur FROM tickets_reglages WHERE cle = 'dernier_numero'", []))?.valeur, 0)) || 0;
  }

  /**
   * Supprime le salon Discord d'un ticket supprimé (au mieux) : 404 (déjà supprimé à la main) ignoré, tout autre échec
   * journalisé sans contenu (le cron réessaie). Un ticket supprimé (migration 0065) dont le salon a disparu est marqué
   * `salon_supprime_le`. Rend `{ ok, statut }`.
   */
  async function supprimerSalon(salonId, numero) {
    if (!salonId || !jetonBot) return { ok: true, statut: 0 };
    const r = await appel('DELETE', `/channels/${salonId}`, undefined, { raison: `Ticket ${numero} supprimé` });
    if (!r.ok && r.statut !== 404) console.error(`[esport] tickets : salon du ticket ${numero} non supprimé sur Discord (${r.motif ?? `HTTP ${r.statut}`})`);
    const ok = r.ok || r.statut === 404;
    if (ok) await base.executer('UPDATE tickets SET salon_supprime_le = COALESCE(salon_supprime_le, ?) WHERE salon_id = ? AND supprime_le IS NOT NULL', [iso(maintenant()), salonId]);
    return { ok, statut: r.statut };
  }

  const qui = (acteur, general) => (acteur?.discordId ? `<@${acteur.discordId}>` : sur(acteur?.nom ?? 'Esport HQ', 80));
  const optsJournal = general => ({ mode: general.langue === 'auteur' ? 'en_fr' : general.langue });

  /**
   * Supprime un ticket FERMÉ (« Supprimer ») : le salon Discord est supprimé tout de suite, mais le ticket reste
   * entièrement lisible dans l'app (conversation, notes, pièces, transcript, avis) pendant `retentionSuppressionJours`
   * (30 par défaut) : rubrique « Supprimés ». Le cron l'efface ensuite (`effacer`). `garderAvis` : choix appliqué à
   * l'effacement définitif (avis gardé anonyme pour les statistiques, ou supprimé aussi). `salonPlusTard` : le salon
   * n'est pas supprimé ici (commande tapée dans ce salon : la réponse part d'abord) ; rendu dans `salonId` pour
   * l'appelant, qui appelle `supprimerSalon`. Journal : qui, quel numéro, jamais le contenu.
   * Rend `{ numero, salonId, jours, effaceLe }`.
   */
  async function supprimer(ticket, acteur, { garderAvis = true, salonPlusTard = false } = {}) {
    if (!ticket) throw refusTk('pas_ticket', {}, 404);
    if (ticket.statut !== 'ferme') throw refusTk('supprimer_pas_ferme', {}, 409);
    if (ticket.supprime_le) throw refusTk('supprime_deja', {}, 409);
    const t = maintenant();
    const numero = Number(ticket.numero);
    const { general } = await contexte();
    const jours = general.retentionSuppressionJours;
    const effaceLe = iso(t + jours * J);
    // Conditionnel : deux suppressions (ou une réouverture) simultanées n'en font qu'une.
    const r = await base.executer("UPDATE tickets SET supprime_le = ?, supprime_par = ?, supprime_garder_avis = ?, maj_le = ? WHERE id = ? AND statut = 'ferme' AND supprime_le IS NULL", [iso(t), String(acteur?.nom ?? '').slice(0, 100) || null, garderAvis ? 1 : 0, iso(t), ticket.id]);
    if (Number(r.changements) !== 1) throw refusTk('supprime_deja', {}, 409);
    await base.lot([
      { sql: "DELETE FROM notifications WHERE categorie = 'tickets' AND charge LIKE ?", params: [`%"ticket":"${ticket.id}"%`] },
      ev('ticket.corbeille', ticket, acteur, { avisGarde: garderAvis && ticket.note !== null && ticket.note !== undefined, jours, par: String(acteur?.nom ?? '').slice(0, 100) || null }),
    ]);
    const salonId = ticket.salon_id && !ticket.salon_supprime_le ? ticket.salon_id : null;
    if (salonId && !salonPlusTard) await supprimerSalon(salonId, numero);
    const staff = qui(acteur, general);
    await journalDiscord(general, { description: bilingue(l => tx(l, 'journal_corbeille', { numero, staff, date: dateCourte(l, effaceLe) }), optsJournal(general)), color: 0x8b8b9a }).catch(() => undefined);
    await annoncer(base, ticket.id, t, { acteur: acteur?.compte });
    return { numero, salonId, jours, effaceLe };
  }

  /**
   * Restaure un ticket supprimé : la suppression prévue est annulée, le ticket redevient un ticket fermé (sans salon
   * Discord tant qu'on ne le rouvre pas). `rouvrir` : le rouvre aussitôt (un nouveau salon est créé). Rend le ticket.
   */
  async function restaurer(ticket, acteur, { rouvrir: veutRouvrir = false } = {}) {
    if (!ticket) throw refusTk('pas_ticket', {}, 404);
    if (!ticket.supprime_le) throw refusTk('pas_supprime', {}, 409);
    if (veutRouvrir && ticket.purge_le) throw refusTk('erreur', {}, 410);
    const t = maintenant();
    const r = await base.executer('UPDATE tickets SET supprime_le = NULL, supprime_par = NULL, supprime_garder_avis = 1, maj_le = ? WHERE id = ? AND supprime_le IS NOT NULL', [iso(t), ticket.id]);
    if (Number(r.changements) !== 1) throw refusTk('pas_supprime', {}, 409);
    const restaure = await ticketPar(ticket.id);
    await base.lot([ev('ticket.restaure', restaure, acteur, { rouvert: veutRouvrir })]);
    const { general } = await contexte();
    await journalDiscord(general, { description: bilingue(l => tx(l, 'journal_restaure', { numero: restaure.numero, staff: qui(acteur, general) }), optsJournal(general)), color: 0x4caf7a }).catch(() => undefined);
    await annoncer(base, ticket.id, t, { acteur: acteur?.compte });
    return veutRouvrir ? rouvrir(restaure, acteur) : restaure;
  }

  /**
   * Efface DÉFINITIVEMENT un ticket FERMÉ (« Supprimer définitivement maintenant », ou le cron `auto` à la fin du
   * délai) : conversation, notes internes, pièces jointes (octets du stockage compris), personnes ajoutées, « lu »,
   * notifications, et son salon Discord archivé s'il existe encore (au mieux). L'avis (note et commentaire) est gardé
   * ANONYME pour les statistiques (`garderAvis`, par défaut) ou supprimé aussi. `salonPlusTard` : le salon n'est pas
   * supprimé ici ; rendu dans `salonId` pour l'appelant. Journal : qui a supprimé quel numéro, jamais le contenu.
   * Rend `{ numero, salonId }`.
   */
  async function effacer(ticket, acteur, { garderAvis = true, salonPlusTard = false, auto = false } = {}) {
    if (!ticket) throw refusTk('pas_ticket', {}, 404);
    if (ticket.statut !== 'ferme') throw refusTk('supprimer_pas_ferme', {}, 409);
    const t = maintenant();
    const numero = Number(ticket.numero);
    const pieces = await base.tous('SELECT cle_stockage FROM tickets_pieces WHERE ticket_id = ? AND cle_stockage IS NOT NULL', [ticket.id]);
    const avis = garderAvis && ticket.note !== null && ticket.note !== undefined;
    // Chaque effacement est conditionné au ticket encore fermé (une réouverture simultanée ne perd rien).
    await base.lot([
      ...(avis
        ? [
            {
              sql: 'INSERT INTO tickets_avis_anonymes (id, categorie_id, note, commentaire, note_le, responsable_compte_id, responsable_discord_id, responsable_nom, cree_le) SELECT ?, categorie_id, note, note_commentaire, COALESCE(note_le, ferme_le, ?), responsable_compte_id, responsable_discord_id, responsable_nom, ? FROM tickets WHERE id = ? AND statut = ?',
              params: [nouvelId(), iso(t), iso(t), ticket.id, 'ferme'],
            },
          ]
        : []),
      { sql: "DELETE FROM tickets_pieces WHERE ticket_id IN (SELECT id FROM tickets WHERE id = ? AND statut = 'ferme')", params: [ticket.id] },
      { sql: "DELETE FROM tickets_messages WHERE ticket_id IN (SELECT id FROM tickets WHERE id = ? AND statut = 'ferme')", params: [ticket.id] },
      { sql: "DELETE FROM tickets_membres WHERE ticket_id IN (SELECT id FROM tickets WHERE id = ? AND statut = 'ferme')", params: [ticket.id] },
      { sql: "DELETE FROM tickets_lectures WHERE ticket_id IN (SELECT id FROM tickets WHERE id = ? AND statut = 'ferme')", params: [ticket.id] },
      { sql: "DELETE FROM notifications WHERE categorie = 'tickets' AND charge LIKE ?", params: [`%"ticket":"${ticket.id}"%`] },
      {
        sql: "INSERT INTO tickets_reglages (cle, valeur, maj_le) VALUES ('dernier_numero', ?, ?) ON CONFLICT (cle) DO UPDATE SET valeur = CASE WHEN CAST(tickets_reglages.valeur AS INTEGER) >= CAST(excluded.valeur AS INTEGER) THEN tickets_reglages.valeur ELSE excluded.valeur END, maj_le = excluded.maj_le",
        params: [String(numero), iso(t)],
      },
      { sql: "DELETE FROM tickets WHERE id = ? AND statut = 'ferme'", params: [ticket.id] },
      ev(auto ? 'ticket.purge' : 'ticket.supprime', ticket, auto ? null : acteur, { avisGarde: avis, corbeille: Boolean(ticket.supprime_le), ...(auto ? {} : { par: String(acteur?.nom ?? '').slice(0, 100) || null }) }),
    ]);
    if (await ticketPar(ticket.id)) throw refusTk('supprimer_pas_ferme', {}, 409);
    // Octets des pièces : après la base (une pièce orpheline ne se lit plus : sa ligne a disparu).
    for (const p of pieces) await stockage?.supprimer(p.cle_stockage).catch(() => undefined);
    const salonId = ticket.salon_id && !ticket.salon_supprime_le ? ticket.salon_id : null;
    if (salonId && !salonPlusTard) await supprimerSalon(salonId, numero);
    const { general } = await contexte();
    const texte = auto ? bilingue(l => tx(l, 'journal_purge', { numero }), optsJournal(general)) : bilingue(l => tx(l, 'journal_supprime', { numero, staff: qui(acteur, general) }), optsJournal(general));
    await journalDiscord(general, { description: texte, color: 0x8b8b9a }).catch(() => undefined);
    try {
      await publierEnBase(base, { sujet: 'tickets', cle: `ticket:${ticket.id}`, sonde: `/tickets/${ticket.id}`, action: 'supprime', ...(acteur?.compte ? { acteur: acteur.compte } : {}) }, t);
    } catch (e) {
      console.error('[esport] tickets : temps réel', e?.message ?? e);
    }
    return { numero, salonId };
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

  async function tachesCycle() {
    const { general, messages } = await contexte();
    const bilan = { avertis: 0, fermes: 0, salonsSupprimes: 0, purges: 0, corbeille: 0 };
    if (!general.actif || !jetonBot) return bilan;
    // Mise à niveau des droits des salons ouverts (une seule fois, au mieux : jamais bloquante).
    const migration = await migrerDroits().catch(e => (console.error('[esport] tickets : mise à niveau des droits', e?.message ?? e), null));
    if (migration) bilan.migration = migration;
    const t = maintenant();
    const cats = new Map((await base.tous('SELECT * FROM tickets_categories', [])).map(l => [l.id, categoriePublique(l)]));
    // Tickets permanents et catégories « Jamais » écartés d'emblée (ils ne prennent pas la place des autres) ; un
    // avertissement donné avant le passage de la catégorie à « Jamais » est oublié.
    await base.executer("UPDATE tickets SET avertissement_le = NULL WHERE statut <> 'ferme' AND avertissement_le IS NOT NULL AND categorie_id IN (SELECT id FROM tickets_categories WHERE fermeture_auto_h = 0)", []);
    const ouverts = await base.tous("SELECT * FROM tickets WHERE statut <> 'ferme' AND permanent = 0 AND categorie_id NOT IN (SELECT id FROM tickets_categories WHERE fermeture_auto_h = 0) ORDER BY derniere_activite_le LIMIT 500", []);
    for (const tk of ouverts) {
      if (bilan.avertis + bilan.fermes >= LOT_CRON) break;
      // Ticket permanent > réglage de la catégorie > réglage général (0 : jamais).
      const h = delaiFermeture(tk, cats.get(tk.categorie_id), general).heures;
      if (!h) {
        // Plus de fermeture prévue (réglage général à 0…) : un avertissement déjà donné est oublié.
        if (tk.avertissement_le) await base.executer('UPDATE tickets SET avertissement_le = NULL WHERE id = ?', [tk.id]);
        continue;
      }
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
    // Tickets supprimés (migration 0065) : salon Discord resté (échec de la suppression) réessayé, puis effacement
    // définitif une fois le délai écoulé (avis gardé anonyme ou supprimé selon le choix fait à la suppression).
    const sansSalon = await base.tous('SELECT id, numero, salon_id FROM tickets WHERE supprime_le IS NOT NULL AND salon_id IS NOT NULL AND salon_supprime_le IS NULL LIMIT ?', [LOT_CRON]);
    for (const tk of sansSalon) {
      const r = await supprimerSalon(tk.salon_id, tk.numero);
      if (r.ok) bilan.salonsSupprimes++;
      else if (r.statut === 429) break;
    }
    const echus = await base.tous('SELECT * FROM tickets WHERE supprime_le IS NOT NULL AND supprime_le < ? ORDER BY supprime_le LIMIT ?', [iso(t - general.retentionSuppressionJours * J), LOT_CRON]);
    for (const tk of echus) {
      try {
        await effacer(tk, { nom: 'Esport HQ' }, { garderAvis: Number(tk.supprime_garder_avis) !== 0, auto: true });
        bilan.corbeille++;
      } catch (e) {
        console.error('[esport] tickets : effacement d’un ticket supprimé', e?.message ?? e);
      }
    }
    bilan.purges = await purgerAnciens(t - general.retentionJours * J);
    // Avis anonymes (tickets supprimés) : leur commentaire suit la même rétention que les conversations.
    await base.executer('UPDATE tickets_avis_anonymes SET commentaire = NULL WHERE commentaire IS NOT NULL AND note_le < ?', [iso(t - general.retentionJours * J)]);
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
  async function mpCompte(compte, cle, vars, cible = null) {
    const lie = await base.premier('SELECT dc.discord_user_id, c.langue FROM discord_comptes dc LEFT JOIN comptes c ON c.id = dc.compte_id WHERE dc.compte_id = ?', [compte]);
    if (!lie) return;
    const langue = langueDe(lie.langue);
    // Lien direct vers le ticket (et son message) dans l'app : le même que celui de la notification (cibles.mjs).
    const lien = cible ? lienProfond(lienApp, cible) : '';
    await envoyerMp(lie.discord_user_id, { content: `${tx(langue, cle, vars)}${lien ? `\n${tx(langue, 'lien_app')} : <${lien}>` : ''}`.slice(0, 2000) });
  }

  /** Nouveau ticket : MP aux comptes qui traitent la catégorie et l'ont demandé (la cloche passe par le bus). */
  async function alerterNouveau(ticket, cat) {
    const comptes = [...(await comptesDeCategorie(base, ticket.categorie_id, { repondre: true }))].slice(0, 20);
    for (const c of comptes) {
      if (!(await preferences(c)).mpNouveau) continue;
      await mpCompte(c, 'mp_nouveau', { numero: ticket.numero, categorie: sur(cat.nom.fr, 80), salon: `<#${ticket.salon_id}>` }, { v: 1, g: 'ticket', ticket: ticket.id }).catch(() => undefined);
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
    if ((await preferences(resp)).mpMessage) await mpCompte(resp, 'mp_message', { numero: ticket.numero, auteur: sur(message.auteurNom, 80), salon: `<#${ticket.salon_id}>` }, { v: 1, g: 'ticket', ticket: ticket.id, message: message.id }).catch(() => undefined);
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
    permanent,
    mentionner,
    reappliquerDroits,
    migrerDroits,
    surcharges,
    fermer,
    rouvrir,
    noter,
    commenterNote,
    salonSupprime,
    supprimer,
    restaurer,
    effacer,
    supprimerSalon,
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
