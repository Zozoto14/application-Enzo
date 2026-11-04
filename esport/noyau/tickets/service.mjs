/**
 * Tickets : services de l'app (configuration, état de la connexion Discord). Cycle de vie des tickets : cycle.mjs ;
 * conversation : conversation.mjs ; Gateway : superviseur.mjs. Documentation : docs/esport/tickets.md.
 *
 * Contrôles : chaque fonction appelle `contexteTickets` (404 sans voir ni configurer, 403 sans la permission voulue).
 * La configuration (`tickets.configurer`, ou le Fondateur) lit et écrit les réglages, les catégories, les panneaux et la
 * liste noire ; elle n'ouvre aucun ticket à elle seule.
 */

import { echec, iso, nouvelId } from '../outils.mjs';
import { evenement } from '../evenements.mjs';
import { contexteTickets } from './acces.mjs';
import { MESSAGES_DEFAUT, MODES_LANGUE } from './textes.mjs';
import {
  COMMANDES_STAFF,
  COMMANDES_TICKETS,
  ICONES,
  LIMITES,
  LIAISONS,
  PRIORITES,
  categoriePublique,
  creerCategorie,
  instructionReglage,
  lireCommandes,
  lireGeneral,
  lireHoraires,
  lireMessages,
  panneauPublic,
  validerCategorie,
  validerCommandes,
  validerGeneral,
  validerHoraires,
  validerListeNoire,
  validerMessages,
  validerPanneau,
} from './reglages.mjs';
import { NOM_IMAGE_PANNEAU, chargePanneau } from './panneaux.mjs';
import { diagnosticConnexion } from './superviseur.mjs';
import { PERMISSIONS_REQUISES, P, idDiscord, manquantes, permissionsMembre, rest } from './discord.mjs';

/** Lien d'invitation : permissions du bot d'annonces (bot-discord.md) + celles des tickets (Gérer les salons, Gérer les rôles, Joindre des fichiers). */
const PERMISSIONS_INVITATION = (309237861376n | P.VOIR_SALON | P.GERER_SALONS | P.GERER_ROLES | P.ENVOYER | P.HISTORIQUE | P.JOINDRE_FICHIERS | P.INTEGRER_LIENS).toString();
const TYPES_IMAGE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const IMAGE_MAX = 8 * 1024 * 1024;

export function servicesConfigTickets({ base, maintenant = () => Date.now(), stockage, fetch: fetchDiscord, jetonBot, applicationId = '', drive }) {
  const ev = (type, acteur, entiteType, entiteId, charge = {}) => evenement(type, { acteur: acteur.compte, entiteType, entiteId, charge, maintenant: maintenant() });

  async function moi(acteur) {
    const { droits } = await contexteTickets(base, acteur).catch(() => ({ droits: null }));
    const general = await lireGeneral(base);
    if (!droits) return { voir: false, repondre: false, gerer: false, configurer: false, actif: general.actif };
    return { voir: droits.voir, repondre: droits.repondre, gerer: droits.gerer, configurer: droits.configurer, fondateur: Boolean(droits.fondateur), actif: general.actif, bot: Boolean(jetonBot) };
  }

  async function etat(acteur) {
    await contexteTickets(base, acteur);
    const general = await lireGeneral(base);
    return { actif: general.actif, bot: Boolean(jetonBot), connexion: general.actif && jetonBot ? await diagnosticConnexion(base, maintenant()) : { mode: 'hors_ligne', depuis: null } };
  }

  async function categories() {
    return (await base.tous('SELECT * FROM tickets_categories WHERE supprime_le IS NULL ORDER BY position, nom_fr', [])).map(categoriePublique);
  }

  async function rolesApp() {
    const club = await base.tous('SELECT id, nom, couleur FROM roles_globaux ORDER BY systeme DESC, position, nom', []);
    const cm = await base.tous('SELECT id, nom, couleur FROM cm_roles ORDER BY systeme DESC, position, nom', []);
    return [...club.map(r => ({ cle: `club:${r.id}`, nom: r.nom, couleur: r.couleur, famille: 'club' })), ...cm.map(r => ({ cle: `cm:${r.id}`, nom: r.nom, couleur: r.couleur, famille: 'cm' }))];
  }

  async function config(acteur) {
    await contexteTickets(base, acteur, { exiger: 'configurer' });
    const liste = await base.tous('SELECT * FROM tickets_liste_noire ORDER BY ajoute_le DESC LIMIT 1000', []);
    const tableaux = await base.tous("SELECT id, nom, cle_defaut FROM cm_tableaux WHERE portee = 'club' AND archive_le IS NULL ORDER BY position", []);
    return {
      general: await lireGeneral(base),
      messages: await lireMessages(base),
      messagesDefaut: MESSAGES_DEFAUT,
      horaires: await lireHoraires(base),
      commandes: await lireCommandes(base),
      categories: await categories(),
      panneaux: (await base.tous('SELECT * FROM tickets_panneaux ORDER BY cree_le', [])).map(panneauPublic),
      listeNoire: liste.map(l => ({ discordId: l.discord_user_id, nom: l.nom, raison: l.raison, ajouteLe: l.ajoute_le })),
      rolesApp: await rolesApp(),
      tableauxCm: tableaux.map(t => ({ id: t.id, nom: t.nom ?? t.cle_defaut ?? t.id })),
      choix: { langues: MODES_LANGUE, icones: ICONES, priorites: PRIORITES, liaisons: LIAISONS, commandes: COMMANDES_TICKETS, commandesStaff: COMMANDES_STAFF, limites: LIMITES, permissionsBot: PERMISSIONS_REQUISES.map(([cle]) => cle) },
      bot: Boolean(jetonBot),
      lienInvitation: applicationId ? `https://discord.com/oauth2/authorize?client_id=${applicationId}&scope=bot%20applications.commands&permissions=${PERMISSIONS_INVITATION}` : null,
    };
  }

  async function changerReglage(acteur, cle, valeur) {
    await base.lot([instructionReglage(cle, valeur, acteur.compte, maintenant()), ev('tickets.config_modifiee', acteur, 'tickets', cle, { cle })]);
    return config(acteur);
  }

  async function changerGeneral(acteur, corps) {
    await contexteTickets(base, acteur, { exiger: 'configurer' });
    return changerReglage(acteur, 'general', validerGeneral(corps ?? {}, await lireGeneral(base)));
  }
  async function changerMessages(acteur, corps) {
    await contexteTickets(base, acteur, { exiger: 'configurer' });
    return changerReglage(acteur, 'messages', { ...(await lireMessages(base)), ...validerMessages(corps) });
  }
  async function changerHoraires(acteur, corps) {
    await contexteTickets(base, acteur, { exiger: 'configurer' });
    return changerReglage(acteur, 'horaires', validerHoraires(corps));
  }
  async function changerCommandes(acteur, corps) {
    await contexteTickets(base, acteur, { exiger: 'configurer' });
    return changerReglage(acteur, 'commandes', { ...(await lireCommandes(base)), ...validerCommandes(corps) });
  }

  // ---------------------------------------------------------------- Catégories

  async function ajouterCategorie(acteur, corps) {
    await contexteTickets(base, acteur, { exiger: 'configurer' });
    const { id, instruction } = await creerCategorie(base, acteur, corps ?? {}, maintenant());
    await base.lot([instruction, ev('tickets.categorie_creee', acteur, 'ticket_categorie', id)]);
    return { id, categories: await categories() };
  }

  async function modifierCategorie(acteur, id, corps) {
    await contexteTickets(base, acteur, { exiger: 'configurer' });
    if (!(await base.premier('SELECT id FROM tickets_categories WHERE id = ? AND supprime_le IS NULL', [id]))) throw echec(404, 'categorie', 'Catégorie introuvable.');
    const s = await validerCategorie(base, corps ?? {});
    const colonnes = Object.keys(s);
    if (colonnes.length) {
      await base.lot([
        { sql: `UPDATE tickets_categories SET ${colonnes.map(c => `${c} = ?`).join(', ')}, maj_le = ? WHERE id = ?`, params: [...Object.values(s), iso(maintenant()), id] },
        ev('tickets.categorie_modifiee', acteur, 'ticket_categorie', id),
      ]);
    }
    return { categories: await categories() };
  }

  async function supprimerCategorie(acteur, id) {
    await contexteTickets(base, acteur, { exiger: 'configurer' });
    if (!(await base.premier('SELECT id FROM tickets_categories WHERE id = ? AND supprime_le IS NULL', [id]))) throw echec(404, 'categorie', 'Catégorie introuvable.');
    const utilisee = await base.premier('SELECT id FROM tickets WHERE categorie_id = ? LIMIT 1', [id]);
    // Une catégorie qui a des tickets reste en base (leur historique la cite) ; sinon elle s'efface.
    await base.lot([
      utilisee ? { sql: 'UPDATE tickets_categories SET supprime_le = ?, actif = 0 WHERE id = ?', params: [iso(maintenant()), id] } : { sql: 'DELETE FROM tickets_categories WHERE id = ?', params: [id] },
      ev('tickets.categorie_supprimee', acteur, 'ticket_categorie', id),
    ]);
    return { categories: await categories() };
  }

  async function ordonnerCategories(acteur, corps) {
    await contexteTickets(base, acteur, { exiger: 'configurer' });
    const ordre = Array.isArray(corps?.ordre) ? corps.ordre.map(String).slice(0, LIMITES.categories) : null;
    if (!ordre) throw echec(400, 'ordre', 'Ordre illisible.');
    await base.lot(ordre.map((id, i) => ({ sql: 'UPDATE tickets_categories SET position = ? WHERE id = ?', params: [i, id] })));
    return { categories: await categories() };
  }

  // ---------------------------------------------------------------- Panneaux

  async function panneau(id) {
    const l = await base.premier('SELECT * FROM tickets_panneaux WHERE id = ?', [id]);
    if (!l) throw echec(404, 'panneau', 'Panneau introuvable.');
    return l;
  }

  async function ajouterPanneau(acteur, corps) {
    await contexteTickets(base, acteur, { exiger: 'configurer' });
    const n = await base.premier('SELECT COUNT(*) AS n FROM tickets_panneaux', []);
    if (Number(n?.n ?? 0) >= LIMITES.panneaux) throw echec(409, 'trop', `${LIMITES.panneaux} panneaux au plus.`);
    const s = await validerPanneau(base, corps ?? {}, { creation: true });
    if (s.image_element_id) await imagePanneau(acteur, s.image_element_id);
    const id = nouvelId();
    const t = iso(maintenant());
    const ligne = { id, ...s, cree_par: acteur.compte, cree_le: t, maj_le: t };
    const colonnes = Object.keys(ligne);
    await base.executer(`INSERT INTO tickets_panneaux (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`, Object.values(ligne));
    return panneauPublic(await panneau(id));
  }

  async function modifierPanneau(acteur, id, corps) {
    await contexteTickets(base, acteur, { exiger: 'configurer' });
    await panneau(id);
    const s = await validerPanneau(base, corps ?? {});
    if (s.image_element_id) await imagePanneau(acteur, s.image_element_id);
    const colonnes = Object.keys(s);
    if (colonnes.length) await base.executer(`UPDATE tickets_panneaux SET ${colonnes.map(c => `${c} = ?`).join(', ')}, maj_le = ? WHERE id = ?`, [...Object.values(s), iso(maintenant()), id]);
    return panneauPublic(await panneau(id));
  }

  async function supprimerPanneau(acteur, id) {
    await contexteTickets(base, acteur, { exiger: 'configurer' });
    const p = await panneau(id);
    // Le message publié est retiré de Discord (au mieux : un échec n'empêche pas la suppression).
    if (p.salon_id && p.message_id && jetonBot) await rest(fetchDiscord, jetonBot, 'DELETE', `/channels/${p.salon_id}/messages/${p.message_id}`);
    await base.executer('DELETE FROM tickets_panneaux WHERE id = ?', [id]);
    return { ok: true };
  }

  /** Image du Drive d'un panneau : visible de l'acteur, image de 8 Mo au plus. Rend `{ octets, type }`. */
  async function imagePanneau(acteur, elementId) {
    if (!drive) throw echec(400, 'image', 'Drive indisponible.');
    const f = await drive.fichierPourIntegration(acteur, elementId);
    if (!TYPES_IMAGE.has(f.type) || f.taille > IMAGE_MAX) throw echec(400, 'image', 'Image PNG, JPEG, GIF ou WebP de 8 Mo au plus.');
    const cm = await base.premier('SELECT cle_stockage, type_mime FROM cm_fichiers WHERE id = ?', [f.fichierId]);
    const objet = cm && stockage ? await stockage.lire(cm.cle_stockage) : null;
    if (!objet) throw echec(404, 'image', 'Image du Drive introuvable.');
    return { octets: objet.octets, type: cm.type_mime };
  }

  /** Charge Discord d'un panneau (aperçu « comme sur Discord » et publication). */
  async function charge(p) {
    const general = await lireGeneral(base);
    const cats = await categories();
    const voulues = panneauPublic(p).categories;
    const liste = voulues.map(id => cats.find(c => c.id === id)).filter(Boolean);
    return chargePanneau(panneauPublic(p), liste, { mode: general.langue, image: Boolean(p.image_element_id) });
  }

  async function apercuPanneau(acteur, id) {
    await contexteTickets(base, acteur, { exiger: 'configurer' });
    return { charge: await charge(await panneau(id)) };
  }

  /** Publie le panneau (ou met à jour le message déjà publié dans le même salon). */
  async function publierPanneau(acteur, id) {
    await contexteTickets(base, acteur, { exiger: 'configurer' });
    if (!jetonBot) throw echec(503, 'bot-absent', 'Bot Discord non configuré (DISCORD_BOT_TOKEN).');
    const p = await panneau(id);
    if (!p.salon_id) throw echec(400, 'salon', 'Choisissez le salon de publication.');
    const c = await charge(p);
    if (!c.components.length) throw echec(400, 'categories', 'Choisissez au moins une catégorie active.');
    const fichiers = p.image_element_id ? [{ nom: NOM_IMAGE_PANNEAU, ...(await imagePanneau(acteur, p.image_element_id)) }] : undefined;
    let r = null;
    if (p.message_id) {
      r = await rest(fetchDiscord, jetonBot, 'PATCH', `/channels/${p.salon_id}/messages/${p.message_id}`, { ...c, ...(fichiers ? {} : { attachments: [] }) }, { fichiers });
      // Message supprimé à la main sur Discord : republié.
      if (!r.ok && r.statut === 404) r = null;
    }
    if (!r) r = await rest(fetchDiscord, jetonBot, 'POST', `/channels/${p.salon_id}/messages`, c, { fichiers });
    const t = iso(maintenant());
    if (!r.ok) {
      const motif = r.statut === 403 ? 'permissions' : r.statut === 404 ? 'salon' : r.statut === 429 ? 'limite' : 'discord';
      await base.executer('UPDATE tickets_panneaux SET erreur = ?, maj_le = ? WHERE id = ?', [motif, t, id]);
      throw echec(502, `panneau-${motif}`, 'Discord a refusé la publication du panneau.');
    }
    await base.lot([
      { sql: 'UPDATE tickets_panneaux SET message_id = ?, publie_le = ?, erreur = NULL, maj_le = ? WHERE id = ?', params: [idDiscord(r.corps?.id) ?? p.message_id, t, t, id] },
      ev('tickets.panneau_publie', acteur, 'ticket_panneau', id),
    ]);
    return panneauPublic(await panneau(id));
  }

  // ---------------------------------------------------------------- Liste noire

  async function ajouterListeNoire(acteur, corps) {
    await contexteTickets(base, acteur, { exiger: 'configurer' });
    const v = validerListeNoire(corps);
    const n = await base.premier('SELECT COUNT(*) AS n FROM tickets_liste_noire', []);
    if (Number(n?.n ?? 0) >= LIMITES.listeNoire) throw echec(409, 'trop', 'Liste noire pleine.');
    await base.lot([
      {
        sql: 'INSERT INTO tickets_liste_noire (discord_user_id, nom, raison, ajoute_par, ajoute_le) VALUES (?, ?, ?, ?, ?) ON CONFLICT (discord_user_id) DO UPDATE SET nom = excluded.nom, raison = excluded.raison',
        params: [v.id, v.nom, v.raison, acteur.compte, iso(maintenant())],
      },
      ev('tickets.liste_noire', acteur, 'tickets', v.id, { ajout: true }),
    ]);
    return { ok: true };
  }

  async function retirerListeNoire(acteur, discordId) {
    await contexteTickets(base, acteur, { exiger: 'configurer' });
    await base.lot([{ sql: 'DELETE FROM tickets_liste_noire WHERE discord_user_id = ?', params: [String(discordId)] }, ev('tickets.liste_noire', acteur, 'tickets', String(discordId), { ajout: false })]);
    return { ok: true };
  }

  // ---------------------------------------------------------------- Serveur Discord (lecture, vérification)

  /**
   * Ce que l'app affiche du serveur Discord : serveurs où est le bot (pour en choisir un), salons et catégories,
   * rôles, et permissions du bot (au niveau du serveur, puis dans chaque catégorie / salon choisi), avec ce qui manque.
   */
  async function discord(acteur) {
    await contexteTickets(base, acteur, { exiger: 'configurer' });
    if (!jetonBot) return { bot: false };
    const general = await lireGeneral(base);
    const serveurs = await rest(fetchDiscord, jetonBot, 'GET', '/users/@me/guilds');
    const listeServeurs = serveurs.ok && Array.isArray(serveurs.corps) ? serveurs.corps.map(g => ({ id: g.id, nom: String(g.name ?? '') })) : [];
    if (!general.guildId) return { bot: true, serveurs: listeServeurs, erreur: serveurs.ok ? null : `discord-${serveurs.statut}` };
    const [salons, roles, moiBot] = await Promise.all([
      rest(fetchDiscord, jetonBot, 'GET', `/guilds/${general.guildId}/channels`),
      rest(fetchDiscord, jetonBot, 'GET', `/guilds/${general.guildId}/roles`),
      rest(fetchDiscord, jetonBot, 'GET', `/users/@me`),
    ]);
    if (!salons.ok || !roles.ok) return { bot: true, serveurs: listeServeurs, erreur: `discord-${salons.ok ? roles.statut : salons.statut}` };
    const botId = moiBot.corps?.id ?? applicationId;
    const membre = await rest(fetchDiscord, jetonBot, 'GET', `/guilds/${general.guildId}/members/${botId}`);
    const rolesBot = membre.ok ? (membre.corps?.roles ?? []) : [];
    const listeSalons = (salons.corps ?? []).filter(s => [0, 4, 5, 15].includes(Number(s.type)));
    const perm = salon => permissionsMembre({ guildId: general.guildId, roles: roles.corps, membreRoles: rolesBot, salon, membreId: botId });
    const verif = id => {
      if (!id) return null;
      const s = listeSalons.find(x => x.id === id);
      return s ? { id, nom: s.name, manquantes: manquantes(perm(s)) } : { id, introuvable: true, manquantes: [] };
    };
    return {
      bot: true,
      serveurs: listeServeurs,
      serveur: { id: general.guildId, nom: listeServeurs.find(g => g.id === general.guildId)?.nom ?? general.guildNom ?? '' },
      salons: listeSalons.map(s => ({ id: s.id, nom: String(s.name ?? ''), type: Number(s.type) === 4 ? 'categorie' : 'texte', parent: s.parent_id ?? null, position: Number(s.position ?? 0) })).sort((a, b) => a.position - b.position),
      roles: (roles.corps ?? []).filter(r => r.id !== general.guildId && !r.managed).map(r => ({ id: r.id, nom: String(r.name ?? ''), couleur: Number(r.color) ? `#${Number(r.color).toString(16).padStart(6, '0')}` : null, position: Number(r.position ?? 0) })).sort((a, b) => b.position - a.position),
      permissions: {
        membreTrouve: membre.ok,
        serveur: manquantes(perm(null)),
        ouverts: verif(general.categorieOuverts),
        archives: verif(general.categorieArchives),
        journaux: verif(general.salonJournaux),
      },
    };
  }

  return {
    moi,
    etat,
    config,
    categories,
    changerGeneral,
    changerMessages,
    changerHoraires,
    changerCommandes,
    ajouterCategorie,
    modifierCategorie,
    supprimerCategorie,
    ordonnerCategories,
    ajouterPanneau,
    modifierPanneau,
    supprimerPanneau,
    apercuPanneau,
    publierPanneau,
    ajouterListeNoire,
    retirerListeNoire,
    discord,
  };
}
