/**
 * Tickets dans l'app (docs/esport/tickets.md, « Tickets dans l'app ») : liste filtrée, non lus, conversation, réponse
 * depuis l'app (le bot poste « Staff · pseudo : … », pièces jointes de l'appareil ou du Drive), notes internes (JAMAIS
 * envoyées sur Discord), actions (prendre, statut, priorité, assigner, catégorie, personnes, ticket permanent, fermer,
 * rouvrir),
 * transcript, liaisons (prospect Sponsors, carte CM, fiche), statistiques, préférences de MP.
 *
 * Chaque route vérifie les droits du moment (acces.mjs) : un ticket d'une catégorie que l'acteur ne voit pas rend 404,
 * comme un ticket inexistant. Le temps réel rejoue `GET /tickets/:id` au nom de chaque destinataire.
 */

import { echec, iso, jsonOu, nouvelId } from '../outils.mjs';
import { evenement } from '../evenements.mjs';
import { cheminSigne, verifierLien } from '../fichiers.mjs';
import { reponseFichierStocke } from '../medias/lecture.mjs';
import { accesAvis, comptesDeCategorie, contexteTickets, gereAvis, voitCategorie } from './acces.mjs';
import { annoncer, instructionPiece } from './conversation.mjs';
import { estRefus } from './cycle.mjs';
import { idDiscord, rest } from './discord.mjs';
import { rangeeRepondre } from './panneaux.mjs';
import { PRIORITES, STATUTS, categoriePublique, delaiFermeture, instructionReglage, lireGeneral, lireReglage, reponsesAppSeules } from './reglages.mjs';
import { surLong, t as tx } from './textes.mjs';
import { transcriptHtml } from './transcript.mjs';

const MOTIF_ID = /^[0-9a-f-]{36}$/;
const TEXTE_MAX = 1800;
const NOTE_MAX = 4000;
const PIECES_MAX = 3;
// Sous la limite de corps de requête de l'hébergeur (le JSON porte les fichiers en base64 : + 33 %).
const PIECE_MAX = 5 * 1024 * 1024;
const TOTAL_MAX = 5 * 1024 * 1024;
const TYPES_PIECE = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain|video\/mp4|application\/zip)$/;
const DUREE_LIEN = 5 * 60_000;

const mediane = l => {
  const v = l.filter(x => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const moyenne = l => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : null);
const ms = (a, b) => (a && b ? Date.parse(b) - Date.parse(a) : NaN);

export function servicesVueTickets({ base, maintenant = () => Date.now(), stockage, cycle, cleSession, drive, fetch: fetchDiscord, jetonBot, liaisons = {} }) {
  // ---------------------------------------------------------------- Accès

  async function ticketVisible(acteur, id, { exiger } = {}) {
    const ctx = await contexteTickets(base, acteur);
    if (!ctx.droits.voir || !MOTIF_ID.test(String(id))) throw echec(404, 'ticket', 'Ticket introuvable.');
    const ticket = await base.premier('SELECT * FROM tickets WHERE id = ?', [id]);
    if (!ticket || !voitCategorie(ctx.droits, ticket.categorie_id)) throw echec(404, 'ticket', 'Ticket introuvable.');
    if (exiger && !ctx.droits[exiger]) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    return { ...ctx, ticket };
  }

  async function pseudoDe(compte) {
    return (await base.premier('SELECT pseudo FROM comptes WHERE id = ?', [compte]))?.pseudo ?? null;
  }

  /** Condition SQL des catégories visibles (alias `t`). */
  function filtreCategories(droits) {
    if (droits.tout) return { sql: '1 = 1', params: [] };
    const ids = [...droits.categories];
    if (!ids.length) return { sql: '1 = 0', params: [] };
    return { sql: `t.categorie_id IN (${ids.map(() => '?').join(', ')})`, params: ids };
  }

  // ---------------------------------------------------------------- Liste

  const resume = (l, cats, compte) => ({
    id: l.id,
    numero: Number(l.numero),
    categorie: cats.get(l.categorie_id) ?? { id: l.categorie_id, nom: { fr: '?', en: '?' }, couleur: '#8b8b9a', icone: 'billets' },
    statut: l.statut,
    priorite: l.priorite,
    auteur: { discordId: l.auteur_discord_id, nom: l.auteur_nom, compte: l.auteur_compte_id ?? null },
    responsable: l.responsable_nom ? { nom: l.responsable_nom, compte: l.responsable_compte_id ?? null, discordId: l.responsable_discord_id ?? null, moi: Boolean(compte && l.responsable_compte_id === compte) } : null,
    ouvertLe: l.ouvert_le,
    derniereActivite: l.derniere_activite_le,
    fermeLe: l.ferme_le ?? null,
    note: l.note === null || l.note === undefined ? null : Number(l.note),
    nonLu: Boolean(l.dernier_autre && (!l.lu_le || l.dernier_autre > l.lu_le)),
    permanent: Number(l.permanent) === 1,
  });

  async function categoriesMap() {
    return new Map((await base.tous('SELECT * FROM tickets_categories', [])).map(c => {
      const p = categoriePublique(c);
      return [c.id, { id: p.id, nom: p.nom, couleur: p.couleur, icone: p.icone, actif: p.actif && !c.supprime_le }];
    }));
  }

  /** Lignes visibles avec « dernier message d'un autre » et « lu jusqu'à » de l'acteur. */
  async function lignes(acteur, droits, { where = [], params = [], limite = 200 } = {}) {
    const visible = filtreCategories(droits);
    const conditions = [visible.sql, ...where];
    return base.tous(
      `SELECT t.*, l.lu_le AS lu_le,
              (SELECT MAX(m.cree_le) FROM tickets_messages m WHERE m.ticket_id = t.id AND m.genre <> 'systeme' AND COALESCE(m.auteur_compte_id, '') <> ?) AS dernier_autre
         FROM tickets t LEFT JOIN tickets_lectures l ON l.ticket_id = t.id AND l.compte_id = ?
        WHERE ${conditions.join(' AND ')}
        ORDER BY t.derniere_activite_le DESC LIMIT ?`,
      [acteur.compte, acteur.compte, ...visible.params, ...params, limite],
    );
  }

  async function liste(acteur, f = {}) {
    const { droits } = await contexteTickets(base, acteur);
    if (!droits.voir) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const where = [];
    const params = [];
    const statut = String(f.statut ?? 'ouverts');
    if (statut === 'ouverts') where.push("t.statut <> 'ferme'");
    else if (STATUTS.includes(statut)) {
      where.push('t.statut = ?');
      params.push(statut);
    }
    if (f.categorie) {
      where.push('t.categorie_id = ?');
      params.push(String(f.categorie));
    }
    if (f.priorite && PRIORITES.includes(f.priorite)) {
      where.push('t.priorite = ?');
      params.push(f.priorite);
    }
    if (f.responsable === 'moi') {
      where.push('t.responsable_compte_id = ?');
      params.push(acteur.compte);
    } else if (f.responsable === 'personne') where.push('t.responsable_compte_id IS NULL AND t.responsable_discord_id IS NULL');
    else if (f.responsable) {
      where.push('t.responsable_compte_id = ?');
      params.push(String(f.responsable));
    }
    if (f.auteur) {
      where.push('(t.auteur_nom LIKE ? OR t.auteur_discord_id = ?)');
      params.push(`%${String(f.auteur).slice(0, 60)}%`, String(f.auteur));
    }
    if (f.du && /^\d{4}-\d{2}-\d{2}$/.test(f.du)) {
      where.push('t.ouvert_le >= ?');
      params.push(`${f.du}T00:00:00.000Z`);
    }
    if (f.au && /^\d{4}-\d{2}-\d{2}$/.test(f.au)) {
      where.push('t.ouvert_le <= ?');
      params.push(`${f.au}T23:59:59.999Z`);
    }
    if (f.q) {
      const q = String(f.q).trim().slice(0, 80);
      if (/^#?\d{1,7}$/.test(q)) {
        where.push('t.numero = ?');
        params.push(Number(q.replace('#', '')));
      } else if (q) {
        // Recherche dans le nom de l'auteur, le salon, les réponses du formulaire et la conversation (notes comprises :
        // seulement pour qui voit le ticket, ce que garantit le filtre des catégories).
        where.push("(t.auteur_nom LIKE ? OR t.salon_nom LIKE ? OR t.reponses LIKE ? OR EXISTS (SELECT 1 FROM tickets_messages m WHERE m.ticket_id = t.id AND m.contenu LIKE ?))");
        params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
      }
    }
    const cats = await categoriesMap();
    const ls = await lignes(acteur, droits, { where, params });
    const visibles = [...cats.values()].filter(c => voitCategorie(droits, c.id));
    return { tickets: ls.map(l => resume(l, cats, acteur.compte)), categories: visibles, droits: { repondre: droits.repondre, gerer: droits.gerer, configurer: droits.configurer, supprimer: droits.gerer || droits.configurer } };
  }

  /** Nombre de tickets ouverts avec du nouveau pour l'acteur (compteur de la navigation). */
  async function compteur(acteur) {
    const { droits } = await contexteTickets(base, acteur);
    if (!droits.voir) return { nonLus: 0 };
    const ls = await lignes(acteur, droits, { where: ["t.statut <> 'ferme'"], limite: 500 });
    return { nonLus: ls.filter(l => l.dernier_autre && (!l.lu_le || l.dernier_autre > l.lu_le)).length, ouverts: ls.length };
  }

  // ---------------------------------------------------------------- Détail

  async function detail(acteur, id) {
    const { ticket, droits } = await ticketVisible(acteur, id);
    const cats = await categoriesMap();
    const lu = await base.premier('SELECT lu_le FROM tickets_lectures WHERE compte_id = ? AND ticket_id = ?', [acteur.compte, id]);
    const messages = await base.tous('SELECT * FROM tickets_messages WHERE ticket_id = ? ORDER BY cree_le, id LIMIT 2000', [id]);
    const pieces = await base.tous('SELECT id, message_id, nom, type_mime, taille, statut, url_origine FROM tickets_pieces WHERE ticket_id = ? ORDER BY cree_le', [id]);
    const membres = await base.tous('SELECT discord_user_id, nom, ajoute_le FROM tickets_membres WHERE ticket_id = ? ORDER BY ajoute_le', [id]);
    const parMessage = new Map();
    for (const p of pieces) {
      if (!parMessage.has(p.message_id)) parMessage.set(p.message_id, []);
      parMessage.get(p.message_id).push({ id: p.id, nom: p.nom, type: p.type_mime, taille: Number(p.taille), copiee: p.statut === 'copiee', url: p.statut === 'referencee' ? p.url_origine : null });
    }
    const cat = await base.premier('SELECT * FROM tickets_categories WHERE id = ?', [ticket.categorie_id]);
    const catPublique = cat ? categoriePublique(cat) : null;
    // Fermeture automatique : délai en heures (0 : jamais) et d'où il vient (ticket permanent > catégorie > général).
    const delai = delaiFermeture(ticket, catPublique, await lireGeneral(base));
    return {
      ...resume({ ...ticket, lu_le: lu?.lu_le ?? null, dernier_autre: null }, cats, acteur.compte),
      nonLuDepuis: lu?.lu_le ?? null,
      salon: ticket.salon_id ? { id: ticket.salon_id, nom: ticket.salon_nom, supprime: Boolean(ticket.salon_supprime_le) } : null,
      reponses: jsonOu(ticket.reponses, []),
      raison: ticket.raison_fermeture ?? null,
      noteCommentaire: ticket.note_commentaire ?? null,
      noteLe: ticket.note_le ?? null,
      liaison: { type: 'aucune', ...jsonOu(ticket.liaison, {}) },
      liaisonCategorie: cat ? { type: 'aucune', ...jsonOu(cat.liaison, {}) } : { type: 'aucune' },
      purge: Boolean(ticket.purge_le),
      fermeture: { heures: delai.heures, source: delai.source, staffSeul: Boolean(catPublique?.fermetureStaffSeul), permanentPar: ticket.permanent_par ?? null, permanentLe: ticket.permanent_le ?? null },
      membres: membres.map(m => ({ discordId: m.discord_user_id, nom: m.nom, depuis: m.ajoute_le })),
      messages: messages.map(m => ({
        id: m.id,
        genre: m.genre,
        auteur: { nom: m.auteur_nom, discordId: m.auteur_discord_id ?? null, compte: m.auteur_compte_id ?? null },
        staff: Number(m.staff) === 1,
        contenu: m.contenu,
        envoi: m.envoi,
        le: m.cree_le,
        modifieLe: m.modifie_le ?? null,
        supprimeLe: m.supprime_le ?? null,
        pieces: parMessage.get(m.id) ?? [],
      })),
      droits: { repondre: droits.repondre, gerer: droits.gerer, supprimer: gereAvis(droits, ticket.categorie_id) },
    };
  }

  async function marquerLu(acteur, id) {
    await ticketVisible(acteur, id);
    const t = iso(maintenant());
    await base.executer('INSERT INTO tickets_lectures (compte_id, ticket_id, lu_le) VALUES (?, ?, ?) ON CONFLICT (compte_id, ticket_id) DO UPDATE SET lu_le = excluded.lu_le', [acteur.compte, id, t]);
    return { ok: true, luLe: t };
  }

  // ---------------------------------------------------------------- Réponse depuis l'app, notes internes

  /** Pièces d'une réponse : fichiers de l'appareil (base64) et fichiers du Drive visibles de l'acteur. */
  async function lirePieces(acteur, corps) {
    const sortie = [];
    let total = 0;
    for (const f of Array.isArray(corps?.pieces) ? corps.pieces.slice(0, PIECES_MAX + 1) : []) {
      const type = String(f?.type ?? '').split(';')[0];
      if (!TYPES_PIECE.test(type)) throw echec(415, 'type-fichier', 'Type de fichier refusé (images, PDF, texte, MP4, ZIP).');
      let octets;
      try {
        octets = Uint8Array.from(Buffer.from(String(f?.base64 ?? ''), 'base64'));
      } catch {
        throw echec(400, 'fichier', 'Fichier illisible.');
      }
      if (!octets.length) throw echec(400, 'fichier-vide', 'Fichier vide.');
      if (octets.length > PIECE_MAX) throw echec(413, 'fichier-trop-gros', 'Pièce jointe trop volumineuse : 5 Mo au plus.');
      total += octets.length;
      sortie.push({ nom: String(f?.nom ?? 'fichier').replace(/[^\w.\- ()[\]]+/g, '_').slice(0, 100) || 'fichier', type, octets });
    }
    for (const id of Array.isArray(corps?.drive) ? corps.drive.slice(0, PIECES_MAX + 1) : []) {
      if (!drive) throw echec(400, 'drive', 'Drive indisponible.');
      const f = await drive.fichierPourIntegration(acteur, String(id));
      if (f.taille > PIECE_MAX) throw echec(413, 'fichier-trop-gros', 'Pièce jointe trop volumineuse : 5 Mo au plus.');
      const cm = await base.premier('SELECT cle_stockage, type_mime FROM cm_fichiers WHERE id = ?', [f.fichierId]);
      const objet = cm && stockage ? await stockage.lire(cm.cle_stockage) : null;
      if (!objet) throw echec(404, 'fichier-introuvable', 'Fichier du Drive introuvable.');
      total += objet.octets.length;
      sortie.push({ nom: String(f.nom).slice(0, 100), type: cm.type_mime, octets: objet.octets });
    }
    if (sortie.length > PIECES_MAX) throw echec(400, 'pieces', '3 pièces jointes au plus.');
    if (total > TOTAL_MAX) throw echec(413, 'fichier-trop-gros', 'Pièces jointes trop volumineuses : 5 Mo au plus en tout.');
    return sortie;
  }

  async function repondre(acteur, id, corps) {
    const { ticket } = await ticketVisible(acteur, id, { exiger: 'repondre' });
    if (ticket.statut === 'ferme') throw echec(409, 'ticket-ferme', 'Ce ticket est fermé : rouvrez-le pour répondre.');
    if (!ticket.salon_id || ticket.salon_supprime_le) throw echec(409, 'salon', 'Le salon Discord de ce ticket n’existe plus.');
    const texte = String(corps?.texte ?? '').replace(/\r\n?/g, '\n').trim();
    const pieces = await lirePieces(acteur, corps);
    if (!texte && !pieces.length) throw echec(400, 'texte', 'Message vide.');
    if (texte.length > TEXTE_MAX) throw echec(400, 'texte', `${TEXTE_MAX} caractères au plus.`);
    if (!jetonBot) throw echec(503, 'bot-absent', 'Bot Discord non configuré (DISCORD_BOT_TOKEN).');
    const pseudo = (await pseudoDe(acteur.compte)) ?? (acteur.superAdmin ? 'Fondateur' : 'Staff');
    // « Staff · pseudo » est le même dans les deux langues ; le texte du staff part tel quel (mentions neutralisées).
    const contenu = `**${tx('fr', 'staff_prefixe', { pseudo: surLong(pseudo, 60) })}** : ${surLong(texte, TEXTE_MAX)}`.slice(0, 2000);
    // Salon en lecture seule : bouton « Répondre » sous la réponse du staff (l'auteur répond par une fenêtre du bot).
    const general = await lireGeneral(base);
    const boutons = rangeeRepondre(ticket.id, { mode: general.langue, langue: ticket.langue ?? 'en' }, reponsesAppSeules(general));
    const r = await rest(fetchDiscord, jetonBot, 'POST', `/channels/${ticket.salon_id}/messages`, { content: contenu, allowed_mentions: { parse: [] }, ...(boutons.length ? { components: boutons } : {}) }, { fichiers: pieces.length ? pieces.map(p => ({ nom: p.nom, type: p.type, octets: p.octets })) : undefined });
    if (!r.ok) throw echec(502, 'discord', r.statut === 429 ? 'Discord demande d’attendre : réessayez dans un instant.' : 'Discord a refusé le message (permissions du bot ?).');
    const t = maintenant();
    const messageId = nouvelId();
    const lignesPieces = [];
    for (const p of pieces) {
      const pid = nouvelId();
      const cle = stockage ? `tickets/${ticket.id}/${pid}` : null;
      if (cle) await stockage.deposer(cle, p.octets, { type: p.type });
      lignesPieces.push({ id: pid, ticket_id: ticket.id, message_id: messageId, nom: p.nom, type_mime: p.type, taille: p.octets.length, cle_stockage: cle, url_origine: null, statut: cle ? 'copiee' : 'referencee', cree_le: iso(t) });
    }
    const discordId = idDiscord(r.corps?.id);
    await base.lot([
      {
        sql: `INSERT INTO tickets_messages (id, ticket_id, discord_message_id, genre, auteur_discord_id, auteur_compte_id, auteur_nom, staff, contenu, envoi, cree_le)
              VALUES (?, ?, ?, 'app', ?, ?, ?, 1, ?, 'ok', ?)`,
        params: [messageId, ticket.id, discordId, cycle.botId, acteur.compte, pseudo, texte, iso(t)],
      },
      ...lignesPieces.map(instructionPiece),
      {
        sql: `UPDATE tickets SET derniere_activite_le = ?, maj_le = ?, avertissement_le = NULL,
                premiere_reponse_le = COALESCE(premiere_reponse_le, ?), dernier_message_id = COALESCE(?, dernier_message_id) WHERE id = ?`,
        params: [iso(t), iso(t), iso(t), discordId, ticket.id],
      },
      { sql: 'INSERT INTO tickets_lectures (compte_id, ticket_id, lu_le) VALUES (?, ?, ?) ON CONFLICT (compte_id, ticket_id) DO UPDATE SET lu_le = excluded.lu_le', params: [acteur.compte, ticket.id, iso(t)] },
    ]);
    await annoncer(base, ticket.id, t, { acteur: acteur.compte });
    return detail(acteur, id);
  }

  /** Note interne : gardée dans l'app, JAMAIS envoyée sur Discord. */
  async function noter(acteur, id, corps) {
    const { ticket } = await ticketVisible(acteur, id, { exiger: 'repondre' });
    const texte = String(corps?.texte ?? '').replace(/\r\n?/g, '\n').trim();
    if (!texte) throw echec(400, 'texte', 'Message vide.');
    if (texte.length > NOTE_MAX) throw echec(400, 'texte', `${NOTE_MAX} caractères au plus.`);
    const t = maintenant();
    const pseudo = (await pseudoDe(acteur.compte)) ?? 'Staff';
    await base.lot([
      { sql: "INSERT INTO tickets_messages (id, ticket_id, genre, auteur_compte_id, auteur_nom, staff, contenu, envoi, cree_le) VALUES (?, ?, 'note', ?, ?, 1, ?, 'ok', ?)", params: [nouvelId(), ticket.id, acteur.compte, pseudo, texte, iso(t)] },
      { sql: 'INSERT INTO tickets_lectures (compte_id, ticket_id, lu_le) VALUES (?, ?, ?) ON CONFLICT (compte_id, ticket_id) DO UPDATE SET lu_le = excluded.lu_le', params: [acteur.compte, ticket.id, iso(t)] },
    ]);
    await annoncer(base, ticket.id, t, { acteur: acteur.compte });
    return detail(acteur, id);
  }

  // ---------------------------------------------------------------- Actions

  const nomActeur = async acteur => {
    const lie = await base.premier('SELECT discord_user_id FROM discord_comptes WHERE compte_id = ?', [acteur.compte]);
    return { compte: acteur.compte, nom: (await pseudoDe(acteur.compte)) ?? 'Staff', discordId: lie?.discord_user_id ?? null };
  };

  const ACTIONS = {
    prendre: { droit: 'repondre', faire: (tk, a, _c, ac) => cycle.prendre(tk, ac, { forcer: false }) },
    liberer: { droit: 'repondre', faire: (tk, a, _c, ac) => cycle.liberer(tk, ac) },
    attente: { droit: 'repondre', faire: (tk, a, _c, ac) => cycle.attente(tk, ac) },
    statut: { droit: 'repondre', faire: (tk, a, c, ac) => cycle.statut(tk, ac, String(c?.statut ?? '')) },
    priorite: { droit: 'repondre', faire: (tk, a, c, ac) => cycle.priorite(tk, ac, String(c?.priorite ?? '')) },
    fermer: { droit: 'repondre', faire: (tk, a, c, ac) => cycle.fermer(tk, ac, { raison: String(c?.raison ?? '').slice(0, 300) }) },
    rouvrir: { droit: 'repondre', faire: (tk, a, _c, ac) => cycle.rouvrir(tk, ac) },
    assigner: {
      droit: 'gerer',
      async faire(tk, a, c, ac) {
        const compte = String(c?.compte ?? '');
        if (!(await comptesDeCategorie(base, tk.categorie_id, { repondre: true })).has(compte)) throw echec(400, 'compte', 'Ce compte ne traite pas cette catégorie.');
        const lie = await base.premier('SELECT discord_user_id FROM discord_comptes WHERE compte_id = ?', [compte]);
        return cycle.assigner(tk, ac, { compte, nom: (await pseudoDe(compte)) ?? compte, discordId: lie?.discord_user_id ?? null });
      },
    },
    categorie: { droit: 'gerer', faire: (tk, a, c, ac) => cycle.transferer(tk, ac, String(c?.categorie ?? '')) },
    ajouter: { droit: 'gerer', faire: (tk, a, c, ac) => cycle.ajouterMembre(tk, ac, { id: String(c?.discordId ?? ''), nom: String(c?.nom ?? '') }) },
    retirer: { droit: 'gerer', faire: (tk, a, c, ac) => cycle.retirerMembre(tk, ac, { id: String(c?.discordId ?? '') }) },
    permanent: { droit: 'gerer', faire: (tk, a, c, ac) => cycle.permanent(tk, ac, c?.permanent === true) },
  };

  async function action(acteur, id, nom, corps) {
    const def = ACTIONS[nom];
    if (!def) throw echec(404, 'route', 'Adresse inconnue.');
    const { ticket } = await ticketVisible(acteur, id, { exiger: def.droit });
    try {
      await def.faire(ticket, acteur, corps, await nomActeur(acteur));
    } catch (e) {
      if (estRefus(e)) throw echec(e.statut ?? 400, `ticket-${e.cle}`, tx('fr', e.cle, e.vars));
      throw e;
    }
    return detail(acteur, id);
  }

  async function assignables(acteur, id) {
    const { ticket } = await ticketVisible(acteur, id, { exiger: 'gerer' });
    const comptes = [...(await comptesDeCategorie(base, ticket.categorie_id, { repondre: true }))];
    const noms = comptes.length ? await base.tous(`SELECT id, pseudo FROM comptes WHERE id IN (${comptes.map(() => '?').join(', ')})`, comptes) : [];
    return { comptes: noms.map(n => ({ compte: n.id, pseudo: n.pseudo })).sort((a, b) => String(a.pseudo).localeCompare(String(b.pseudo), 'fr')) };
  }

  // ---------------------------------------------------------------- Transcript, pièces

  async function transcript(acteur, id, { langue = 'fr' } = {}) {
    const { ticket } = await ticketVisible(acteur, id, { exiger: 'gerer' });
    const cat = await base.premier('SELECT nom_fr, nom_en FROM tickets_categories WHERE id = ?', [ticket.categorie_id]);
    const messages = await base.tous('SELECT * FROM tickets_messages WHERE ticket_id = ? ORDER BY cree_le, id', [id]);
    const pieces = await base.tous('SELECT * FROM tickets_pieces WHERE ticket_id = ?', [id]);
    return { ...transcriptHtml({ ticket, categorie: langue === 'en' ? cat?.nom_en : cat?.nom_fr, messages, pieces, langue, notes: true, maintenant: maintenant() }), type: 'text/html' };
  }

  /** Lien signé (5 min) vers une pièce copiée, après contrôle d'accès au ticket. */
  async function lienPiece(acteur, id, pieceId, { telecharger = false } = {}) {
    await ticketVisible(acteur, id);
    const p = await base.premier('SELECT * FROM tickets_pieces WHERE id = ? AND ticket_id = ?', [pieceId, id]);
    if (!p || !p.cle_stockage) throw echec(404, 'fichier-introuvable', 'Fichier introuvable.');
    const lien = await cheminSigne(cleSession, { fichierId: p.id, compte: acteur.compte, maintenant: maintenant(), duree: DUREE_LIEN, telecharger, genre: 'ticket' });
    return { chemin: lien.chemin, expire: lien.expire };
  }

  /** Lecture d'une pièce par lien signé : l'accès au ticket est REVÉRIFIÉ (un droit retiré entre-temps ferme le lien). */
  async function servirPiece(pieceId, params, requete) {
    if (!MOTIF_ID.test(pieceId)) throw echec(404, 'fichier-introuvable', 'Fichier introuvable.');
    const { compte, telecharger } = await verifierLien(cleSession, pieceId, params, maintenant(), { genre: 'ticket' });
    const p = await base.premier('SELECT * FROM tickets_pieces WHERE id = ?', [pieceId]);
    if (!p || !p.cle_stockage || !stockage) throw echec(404, 'fichier-introuvable', 'Fichier introuvable.');
    const ticket = await base.premier('SELECT categorie_id FROM tickets WHERE id = ?', [p.ticket_id]);
    const superAdmin = compte === 'principal';
    const { droits } = await contexteTickets(base, { compte, superAdmin }).catch(() => ({ droits: { voir: false } }));
    if (!ticket || !voitCategorie(droits, ticket.categorie_id)) throw echec(403, 'lien-invalide', 'Lien de fichier invalide.');
    const reponse = await reponseFichierStocke({ stockage, f: { cle_stockage: p.cle_stockage, type_mime: p.type_mime, taille: p.taille, nom_original: p.nom }, requete, telecharger });
    if (!reponse) throw echec(404, 'fichier-introuvable', 'Fichier introuvable.');
    return reponse;
  }

  // ---------------------------------------------------------------- Liaisons

  async function lier(acteur, id, corps) {
    const { ticket } = await ticketVisible(acteur, id, { exiger: 'repondre' });
    const type = String(corps?.type ?? '');
    const titre = `Ticket ${ticket.numero} · ${ticket.auteur_nom || ticket.auteur_discord_id}`.slice(0, 120);
    const resumeTicket = jsonOu(ticket.reponses, []).map(r => `${r.libelle?.fr ?? r.id} : ${r.valeur}`).join('\n').slice(0, 4000);
    let liaison;
    if (type === 'aucune') liaison = { type: 'aucune' };
    else if (type === 'sponsors') {
      if (!liaisons.creerProspect) throw echec(400, 'liaison', 'Liaison indisponible.');
      const p = corps?.id ? await liaisons.prospect(acteur, String(corps.id)) : await liaisons.creerProspect(acteur, { nom: String(corps?.nom ?? '').trim() || titre, source: `Discord · ticket ${ticket.numero}`, notes: resumeTicket });
      liaison = { type, id: p.id, titre: p.nom ?? titre };
    } else if (type === 'cm') {
      if (!liaisons.creerCarte) throw echec(400, 'liaison', 'Liaison indisponible.');
      const cat = await base.premier('SELECT liaison FROM tickets_categories WHERE id = ?', [ticket.categorie_id]);
      const tableau = String(corps?.tableauId ?? jsonOu(cat?.liaison, {}).tableauId ?? '');
      const c = corps?.id ? await liaisons.carte(acteur, String(corps.id)) : await liaisons.creerCarte(acteur, tableau, { titre, description: resumeTicket });
      liaison = { type, id: c.id, titre: c.titre ?? titre, tableauId: c.tableauId ?? tableau };
    } else if (type === 'fiche') {
      if (!ticket.auteur_compte_id) throw echec(400, 'liaison', 'L’auteur n’a pas de compte Esport lié (/lier).');
      liaison = { type, compte: ticket.auteur_compte_id, titre: (await pseudoDe(ticket.auteur_compte_id)) ?? ticket.auteur_nom };
    } else throw echec(400, 'liaison', 'Liaison inconnue.');
    const t = maintenant();
    await base.lot([{ sql: 'UPDATE tickets SET liaison = ?, maj_le = ? WHERE id = ?', params: [JSON.stringify(liaison), iso(t), ticket.id] }, evenement('ticket.liaison', { acteur: acteur.compte, entiteType: 'ticket', entiteId: ticket.id, charge: { numero: Number(ticket.numero), categorie: ticket.categorie_id, type }, maintenant: t })]);
    await annoncer(base, ticket.id, t, { acteur: acteur.compte });
    return detail(acteur, id);
  }

  // ---------------------------------------------------------------- Statistiques

  async function stats(acteur, { du, au } = {}) {
    const { droits } = await contexteTickets(base, acteur);
    if (!droits.gerer) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const fin = au && /^\d{4}-\d{2}-\d{2}$/.test(au) ? `${au}T23:59:59.999Z` : iso(maintenant());
    const debut = du && /^\d{4}-\d{2}-\d{2}$/.test(du) ? `${du}T00:00:00.000Z` : iso(Date.parse(fin) - 30 * 86_400_000);
    const cats = await categoriesMap();
    const ls = await base.tous('SELECT * FROM tickets WHERE (ouvert_le >= ? AND ouvert_le <= ?) OR (ferme_le >= ? AND ferme_le <= ?)', [debut, fin, debut, fin]);
    const ouverts = await base.tous("SELECT categorie_id, COUNT(*) AS n FROM tickets WHERE statut <> 'ferme' GROUP BY categorie_id", []);
    // Avis gardés (anonymes) des tickets supprimés : comptés dans la satisfaction de la période (date de l'avis).
    const anonymes = await base.tous('SELECT categorie_id, note, responsable_compte_id, responsable_discord_id, responsable_nom FROM tickets_avis_anonymes WHERE note_le >= ? AND note_le <= ?', [debut, fin]);
    const bloc = (l, anon = []) => {
      const crees = l.filter(x => x.ouvert_le >= debut && x.ouvert_le <= fin);
      const fermes = l.filter(x => x.ferme_le && x.ferme_le >= debut && x.ferme_le <= fin);
      const notes = [...l, ...anon].filter(x => x.note !== null && x.note !== undefined).map(x => Number(x.note));
      return {
        crees: crees.length,
        fermes: fermes.length,
        premiereReponseMs: mediane(crees.map(x => ms(x.ouvert_le, x.premiere_reponse_le))),
        resolutionMs: mediane(fermes.map(x => ms(x.ouvert_le, x.ferme_le))),
        satisfaction: moyenne(notes),
        notes: notes.length,
      };
    };
    const parCategorie = [...cats.values()]
      .map(c => ({ categorie: c, ouverts: Number(ouverts.find(o => o.categorie_id === c.id)?.n ?? 0), ...bloc(ls.filter(x => x.categorie_id === c.id), anonymes.filter(x => x.categorie_id === c.id)) }))
      .filter(x => x.crees || x.fermes || x.ouverts || x.notes);
    const responsables = new Map();
    const parQui = (x, genre) => {
      if (!x.responsable_nom) return;
      const cle = x.responsable_compte_id ?? `d:${x.responsable_discord_id}`;
      if (!responsables.has(cle)) responsables.set(cle, { nom: x.responsable_nom, compte: x.responsable_compte_id ?? null, lignes: [], anon: [] });
      responsables.get(cle)[genre].push(x);
    };
    for (const x of ls) parQui(x, 'lignes');
    for (const x of anonymes) parQui(x, 'anon');
    return {
      du: debut.slice(0, 10),
      au: fin.slice(0, 10),
      total: { ouverts: ouverts.reduce((s, o) => s + Number(o.n), 0), ...bloc(ls, anonymes) },
      parCategorie,
      parResponsable: [...responsables.values()].map(r => ({ nom: r.nom, compte: r.compte, ...bloc(r.lignes, r.anon) })).sort((a, b) => b.fermes - a.fermes),
    };
  }

  // ---------------------------------------------------------------- Avis de satisfaction (migration 0056)

  /**
   * Avis des tickets (note 1 à 5, commentaire facultatif) et avis gardés anonymes des tickets supprimés, des seules
   * catégories que l'acteur gère (`gereAvis`). Filtres : catégorie, note, période (date de l'avis), responsable ;
   * tri : date ou note. Moyenne, nombre et répartition portent sur les mêmes filtres SAUF la note (la répartition
   * montre toujours les cinq notes). Rend au plus 500 avis.
   */
  async function avis(acteur, f = {}) {
    const { droits } = await contexteTickets(base, acteur);
    if (!accesAvis(droits)) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const cats = await categoriesMap();
    const visibles = [...cats.values()].filter(c => gereAvis(droits, c.id));
    const ids = visibles.map(c => c.id);
    const debut = f.du && /^\d{4}-\d{2}-\d{2}$/.test(f.du) ? `${f.du}T00:00:00.000Z` : null;
    const fin = f.au && /^\d{4}-\d{2}-\d{2}$/.test(f.au) ? `${f.au}T23:59:59.999Z` : null;
    const categorie = f.categorie && ids.includes(String(f.categorie)) ? String(f.categorie) : f.categorie ? '__aucune__' : null;
    const lignesAvis = [];
    if (ids.length) {
      const where = ['note IS NOT NULL', `categorie_id IN (${ids.map(() => '?').join(', ')})`];
      const params = [...ids];
      if (categorie) {
        where.push('categorie_id = ?');
        params.push(categorie);
      }
      if (debut) {
        where.push('COALESCE(note_le, ferme_le) >= ?');
        params.push(debut);
      }
      if (fin) {
        where.push('COALESCE(note_le, ferme_le) <= ?');
        params.push(fin);
      }
      const conditions = where.join(' AND ');
      const tks = await base.tous(`SELECT id, numero, categorie_id, auteur_nom, auteur_discord_id, salon_nom, responsable_compte_id, responsable_discord_id, responsable_nom, note, note_commentaire, note_le, ferme_le FROM tickets WHERE ${conditions} ORDER BY COALESCE(note_le, ferme_le) DESC LIMIT 5000`, params);
      const whereA = where.filter(w => !w.startsWith('note IS')).map(w => w.replace('COALESCE(note_le, ferme_le)', 'note_le'));
      const condition = whereA.join(' AND ');
      const anon = await base.tous(`SELECT * FROM tickets_avis_anonymes WHERE ${condition} ORDER BY note_le DESC LIMIT 5000`, params);
      for (const l of tks) lignesAvis.push({ ...l, commentaire: l.note_commentaire, le: l.note_le ?? l.ferme_le, anonyme: false });
      for (const l of anon) lignesAvis.push({ ...l, id: `anon:${l.id}`, numero: null, commentaire: l.commentaire, le: l.note_le, anonyme: true });
    }
    const cleQui = l => (l.responsable_compte_id ? `c:${l.responsable_compte_id}` : l.responsable_discord_id ? `d:${l.responsable_discord_id}` : l.responsable_nom ? `n:${l.responsable_nom}` : 'personne');
    const responsables = new Map();
    for (const l of lignesAvis) if (l.responsable_nom && !responsables.has(cleQui(l))) responsables.set(cleQui(l), l.responsable_nom);
    const parQui = f.responsable ? lignesAvis.filter(l => cleQui(l) === String(f.responsable)) : lignesAvis;
    const repartition = [1, 2, 3, 4, 5].map(n => parQui.filter(l => Number(l.note) === n).length);
    const note = Number(f.note);
    const filtres = Number.isInteger(note) && note >= 1 && note <= 5 ? parQui.filter(l => Number(l.note) === note) : parQui;
    const tri = f.tri === 'note_haut' ? (a, b) => b.note - a.note || String(b.le).localeCompare(String(a.le)) : f.tri === 'note_bas' ? (a, b) => a.note - b.note || String(b.le).localeCompare(String(a.le)) : f.tri === 'ancien' ? (a, b) => String(a.le).localeCompare(String(b.le)) : (a, b) => String(b.le).localeCompare(String(a.le));
    const inconnue = id => ({ id, nom: { fr: '?', en: '?' }, couleur: '#8b8b9a', icone: 'billets', actif: false });
    return {
      total: parQui.length,
      moyenne: parQui.length ? parQui.reduce((s, l) => s + Number(l.note), 0) / parQui.length : null,
      repartition,
      avis: filtres
        .map(l => ({ ...l, note: Number(l.note) }))
        .sort(tri)
        .slice(0, 500)
        .map(l => ({
          id: l.id,
          ticketId: l.anonyme ? null : l.id,
          numero: l.anonyme ? null : Number(l.numero),
          salon: l.anonyme ? null : (l.salon_nom ?? null),
          anonyme: l.anonyme,
          categorie: cats.get(l.categorie_id) ?? inconnue(l.categorie_id),
          note: l.note,
          commentaire: l.commentaire ?? null,
          auteur: l.anonyme ? null : l.auteur_nom || null,
          responsable: l.responsable_nom ? { nom: l.responsable_nom, cle: cleQui(l) } : null,
          le: l.le,
        })),
      categories: visibles,
      responsables: [...responsables.entries()].map(([cle, nom]) => ({ cle, nom })).sort((a, b) => String(a.nom).localeCompare(String(b.nom), 'fr')),
      voirTickets: droits.voir,
    };
  }

  // ---------------------------------------------------------------- Suppression d'un ticket fermé (migration 0056)

  /** Un ticket fermé, supprimé définitivement (cycle.mjs, `supprimer`). `garderAvis` : vrai par défaut. */
  async function supprimer(acteur, id, corps) {
    const { ticket, droits } = await ticketVisible(acteur, id);
    if (!gereAvis(droits, ticket.categorie_id)) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    try {
      const r = await cycle.supprimer(ticket, await nomActeur(acteur), { garderAvis: corps?.garderAvis !== false });
      return { ok: true, numero: r.numero };
    } catch (e) {
      if (estRefus(e)) throw echec(e.statut ?? 400, `ticket-${e.cle}`, tx('fr', e.cle, e.vars));
      throw e;
    }
  }

  /** Suppression groupée (liste des tickets fermés) : 50 au plus ; rend ce qui a été supprimé et ce qui a échoué. */
  async function supprimerPlusieurs(acteur, corps) {
    const { droits } = await contexteTickets(base, acteur);
    if (!droits.voir || !accesAvis(droits)) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const ids = Array.isArray(corps?.ids) ? [...new Set(corps.ids.map(String))] : [];
    if (!ids.length || ids.length > 50) throw echec(400, 'ids', 'Choisissez de 1 à 50 tickets.');
    const supprimes = [];
    const echecs = [];
    for (const id of ids) {
      try {
        supprimes.push((await supprimer(acteur, id, corps)).numero);
      } catch (e) {
        echecs.push({ id, code: e?.code ?? 'erreur' });
      }
    }
    return { supprimes, echecs };
  }

  // ---------------------------------------------------------------- Préférences (MP Discord)

  async function preferences(acteur) {
    await contexteTickets(base, acteur);
    const p = await lireReglage(base, `pref:${acteur.compte}`, { mpNouveau: false, mpMessage: true });
    return { mpNouveau: p.mpNouveau === true, mpMessage: p.mpMessage !== false };
  }
  async function changerPreferences(acteur, corps) {
    await contexteTickets(base, acteur);
    const v = { mpNouveau: corps?.mpNouveau === true, mpMessage: corps?.mpMessage !== false };
    await base.lot([instructionReglage(`pref:${acteur.compte}`, v, acteur.compte, maintenant())]);
    return v;
  }

  return { liste, compteur, detail, marquerLu, repondre, noter, action, assignables, transcript, lienPiece, servirPiece, lier, stats, avis, supprimer, supprimerPlusieurs, preferences, changerPreferences };
}
