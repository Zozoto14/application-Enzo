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
  reponsesAppSeules,
  validerCategorie,
  validerCommandes,
  validerGeneral,
  validerHoraires,
  validerListeNoire,
  validerMessages,
  validerPanneau,
} from './reglages.mjs';
import { NOM_IMAGE_PANNEAU, chargePanneau } from './panneaux.mjs';
import { CATEGORIES_DEFAUT, CLES_SEMEES, PANNEAUX_DEFAUT, corpsModele, nomNormalise, textesPanneauModele } from './modeles.mjs';
import { diagnosticConnexion, diagnosticTickets } from './superviseur.mjs';
import { MESSAGE_DEFAUT as BIENVENUE_MESSAGE_DEFAUT, lireBienvenue, lireEtatBienvenue, noterTitulaires, texteBienvenue, validerBienvenue } from './bienvenue.mjs';
import { PERMISSIONS_REQUISES, P, idDiscord, manquantes, permissionsMembre, rest } from './discord.mjs';

/** Lien d'invitation : permissions du bot d'annonces (bot-discord.md) + celles des tickets (Gérer les salons, Gérer les rôles, Joindre des fichiers). */
/** (+ Réactions et Créer des fils privés : le bot ne peut refuser dans un salon que des permissions qu'il a lui-même.) */
const PERMISSIONS_INVITATION = (309237861376n | P.VOIR_SALON | P.GERER_SALONS | P.GERER_ROLES | P.ENVOYER | P.HISTORIQUE | P.JOINDRE_FICHIERS | P.INTEGRER_LIENS | P.REACTIONS | P.CREER_FILS_PRIVES | P.CREER_FILS_PUBLICS | P.ENVOYER_FILS).toString();
const TYPES_IMAGE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const IMAGE_MAX = 8 * 1024 * 1024;

/** Erreur d'un appel REST lisible par l'app : `discord-<statut>` (0 : injoignable), code JSON de Discord, étape. */
const erreurRest = (etape, r) => ({ erreur: `discord-${r.statut}`, erreurDetail: { etape, statut: r.statut, code: r.code ?? null } });
const ID_DISCORD = /^\d{5,25}$/;

export function servicesConfigTickets({ base, maintenant = () => Date.now(), stockage, fetch: fetchDiscord, jetonBot, applicationId = '', drive, serveurTickets = {}, cycle }) {
  const ev = (type, acteur, entiteType, entiteId, charge = {}) => evenement(type, { acteur: acteur.compte, entiteType, entiteId, charge, maintenant: maintenant() });

  async function moi(acteur) {
    const { droits } = await contexteTickets(base, acteur).catch(() => ({ droits: null }));
    const general = await lireGeneral(base);
    if (!droits) return { voir: false, repondre: false, gerer: false, configurer: false, actif: general.actif };
    return { voir: droits.voir, repondre: droits.repondre, gerer: droits.gerer, configurer: droits.configurer, fondateur: Boolean(droits.fondateur), actif: general.actif, bot: Boolean(jetonBot) };
  }

  async function etat(acteur) {
    const { droits } = await contexteTickets(base, acteur);
    const general = await lireGeneral(base);
    const t = maintenant();
    return {
      actif: general.actif,
      bot: Boolean(jetonBot),
      connexion: general.actif && jetonBot ? await diagnosticConnexion(base, t) : { mode: 'hors_ligne', depuis: null },
      // Diagnostic détaillé : pour qui configure les tickets seulement.
      ...(droits?.configurer ? { diagnostic: await diagnosticTickets(base, t, { jetonBot, general, serveurTickets }) } : {}),
    };
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
    await semerSiVide(acteur);
    const liste = await base.tous('SELECT * FROM tickets_liste_noire ORDER BY ajoute_le DESC LIMIT 1000', []);
    const tableaux = await base.tous("SELECT id, nom, cle_defaut FROM cm_tableaux WHERE portee = 'club' AND archive_le IS NULL ORDER BY position", []);
    return {
      general: await lireGeneral(base),
      messages: await lireMessages(base),
      messagesDefaut: MESSAGES_DEFAUT,
      horaires: await lireHoraires(base),
      commandes: await lireCommandes(base),
      bienvenue: await lireBienvenue(base),
      bienvenueEtat: await lireEtatBienvenue(base),
      bienvenueMessageDefaut: BIENVENUE_MESSAGE_DEFAUT,
      categories: await categories(),
      modeles: CATEGORIES_DEFAUT,
      modelesPanneaux: PANNEAUX_DEFAUT,
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

  /**
   * Réglages généraux. « Répondre uniquement depuis l'AppDashboard » changé : les droits des salons des tickets
   * ouverts sont remis à jour tout de suite (au mieux ; bilan rendu dans `reapplication`).
   */
  async function changerGeneral(acteur, corps) {
    await contexteTickets(base, acteur, { exiger: 'configurer' });
    const avant = await lireGeneral(base);
    const apres = validerGeneral(corps ?? {}, avant);
    const sortie = await changerReglage(acteur, 'general', apres);
    if (cycle && reponsesAppSeules(apres) !== reponsesAppSeules(avant)) return { ...sortie, reapplication: await cycle.reappliquerDroits() };
    return sortie;
  }
  async function changerMessages(acteur, corps) {
    await contexteTickets(base, acteur, { exiger: 'configurer' });
    return changerReglage(acteur, 'messages', { ...(await lireMessages(base)), ...validerMessages(corps) });
  }
  async function changerHoraires(acteur, corps) {
    await contexteTickets(base, acteur, { exiger: 'configurer' });
    return changerReglage(acteur, 'horaires', validerHoraires(corps));
  }
  /**
   * Bienvenue par rôle. À l'activation (ou au changement de rôle), les titulaires actuels du rôle sont notés sans
   * message ; si Discord refuse la liste des membres (intent « Server Members » non activé), seules les arrivées sur
   * le serveur après l'activation seront accueillies (rendu dans `titulaires`).
   */
  async function changerBienvenue(acteur, corps) {
    await contexteTickets(base, acteur, { exiger: 'configurer' });
    const general = await lireGeneral(base);
    const { reglages, recommencer } = validerBienvenue(corps ?? {}, await lireBienvenue(base), maintenant());
    if (reglages.actif && !general.guildId) throw echec(400, 'bienvenue-serveur', 'Choisissez d’abord le serveur Discord (onglet Général).');
    let titulaires = null;
    if (recommencer && jetonBot) {
      titulaires = await noterTitulaires({ base, fetch: fetchDiscord, jetonBot, guildId: general.guildId, roleId: reglages.roleId, maintenant });
      reglages.existantsNotes = titulaires.ok;
    }
    const sortie = await changerReglage(acteur, 'bienvenue', reglages);
    return titulaires ? { ...sortie, titulaires } : sortie;
  }

  /** Message d'essai dans le salon choisi (sans mentionner personne) : vérifie que le bot peut y écrire. */
  async function testerBienvenue(acteur) {
    await contexteTickets(base, acteur, { exiger: 'configurer' });
    const b = await lireBienvenue(base);
    const general = await lireGeneral(base);
    if (!jetonBot) return { ok: false, erreur: 'bot-absent' };
    if (!b.salonId) throw echec(400, 'bienvenue-salon', 'Choisissez le salon où publier la bienvenue.');
    const contenu = `🧪 ${texteBienvenue(b.message, { membreId: null, pseudo: acteur.nom || 'Nouveau membre', role: b.roleNom, serveur: general.guildNom ?? '' })}`;
    const r = await rest(fetchDiscord, jetonBot, 'POST', `/channels/${b.salonId}/messages`, { content: contenu, allowed_mentions: { parse: [] } });
    return r.ok ? { ok: true } : { ok: false, ...erreurRest('bienvenue', r) };
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

  // ---------------------------------------------------------------- Catégories par défaut (modeles.mjs)

  /**
   * Ajoute les modèles demandés (`cles`), dans l'ordre de la liste ; un modèle dont le nom (français ou anglais) est
   * déjà celui d'une catégorie est ignoré ; arrêt à la limite de 25 catégories. Rend `{ ajoutees, ignorees }` (clés).
   */
  async function creerModeles(acteur, cles) {
    const voulues = new Set(cles);
    const existants = new Set();
    for (const l of await base.tous('SELECT nom_fr, nom_en FROM tickets_categories WHERE supprime_le IS NULL', [])) {
      existants.add(nomNormalise(l.nom_fr));
      existants.add(nomNormalise(l.nom_en));
    }
    const roles = new Set((await rolesApp()).map(r => r.cle));
    const ajoutees = [];
    const ignorees = [];
    for (const m of CATEGORIES_DEFAUT) {
      if (!voulues.has(m.cle)) continue;
      if (existants.has(nomNormalise(m.nom.fr)) || existants.has(nomNormalise(m.nom.en))) {
        ignorees.push(m.cle);
        continue;
      }
      const n = await base.premier('SELECT COUNT(*) AS n FROM tickets_categories WHERE supprime_le IS NULL', []);
      if (Number(n?.n ?? 0) >= LIMITES.categories) {
        ignorees.push(m.cle);
        continue;
      }
      const { id, instruction } = await creerCategorie(base, acteur, corpsModele(m, roles), maintenant());
      await base.lot([instruction, ev('tickets.categorie_creee', acteur, 'ticket_categorie', id, { modele: m.cle })]);
      existants.add(nomNormalise(m.nom.fr));
      existants.add(nomNormalise(m.nom.en));
      ajoutees.push(m.cle);
    }
    return { ajoutees, ignorees };
  }

  /**
   * Première lecture de la configuration : sans AUCUNE catégorie (même supprimée), les catégories par défaut sont
   * créées. Une seule fois (réglage `categories_defaut`, posé avant : deux lectures simultanées n'en sèment qu'une) ;
   * une installation qui a déjà des catégories reçoit le réglage sans rien de créé.
   */
  async function semerSiVide(acteur) {
    if (await base.premier("SELECT cle FROM tickets_reglages WHERE cle = 'categories_defaut'", [])) return;
    const n = await base.premier('SELECT COUNT(*) AS n FROM tickets_categories', []);
    const vide = Number(n?.n ?? 0) === 0;
    const r = await base.executer("INSERT INTO tickets_reglages (cle, valeur, maj_par, maj_le) VALUES ('categories_defaut', ?, ?, ?) ON CONFLICT (cle) DO NOTHING", [JSON.stringify({ semees: vide }), acteur.compte ?? null, iso(maintenant())]);
    if (Number(r?.changements) !== 1 || !vide) return;
    await creerModeles(acteur, [...CLES_SEMEES]);
  }

  async function ajouterModeles(acteur, corps) {
    await contexteTickets(base, acteur, { exiger: 'configurer' });
    const cles = Array.isArray(corps?.cles) ? corps.cles.map(String).slice(0, CATEGORIES_DEFAUT.length) : null;
    if (!cles || !cles.length || cles.some(c => !CATEGORIES_DEFAUT.some(m => m.cle === c))) throw echec(400, 'modeles', 'Choisissez au moins une catégorie par défaut.');
    const r = await creerModeles(acteur, cles);
    return { ...r, categories: await categories() };
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
    return insererPanneau(acteur, corps);
  }

  async function insererPanneau(acteur, corps) {
    const s = await validerPanneau(base, corps ?? {}, { creation: true });
    if (s.image_element_id) await imagePanneau(acteur, s.image_element_id);
    const id = nouvelId();
    const t = iso(maintenant());
    const ligne = { id, ...s, cree_par: acteur.compte, cree_le: t, maj_le: t };
    const colonnes = Object.keys(ligne);
    await base.executer(`INSERT INTO tickets_panneaux (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`, Object.values(ligne));
    return panneauPublic(await panneau(id));
  }

  /**
   * Panneau par défaut (modeles.mjs : PANNEAUX_DEFAUT). Corps : `{ modele, evenement?, categorieId?, ajouterManquantes? }`.
   * Les catégories du modèle sont retrouvées par leur nom ; celles qui manquent sont créées depuis les catégories par
   * défaut si `ajouterManquantes`, sinon laissées de côté (rendues dans `ignorees`). `categorieId` (panneau d'événement) :
   * une catégorie existante à la place de celle du modèle. Un titre déjà pris reçoit « (2) », « (3) »… Le panneau n'est
   * PAS publié. Rend `{ panneau, ajoutees, ignorees, renomme, categories }`.
   */
  async function creerPanneauModele(acteur, corps) {
    await contexteTickets(base, acteur, { exiger: 'configurer' });
    const m = PANNEAUX_DEFAUT.find(x => x.cle === corps?.modele);
    if (!m) throw echec(400, 'modele', 'Panneau par défaut inconnu.');
    const n = await base.premier('SELECT COUNT(*) AS n FROM tickets_panneaux', []);
    if (Number(n?.n ?? 0) >= LIMITES.panneaux) throw echec(409, 'trop', `${LIMITES.panneaux} panneaux au plus.`);
    let evenement = '';
    if (m.evenement) {
      evenement = typeof corps.evenement === 'string' ? corps.evenement.replace(/\s+/g, ' ').trim() : '';
      if (!evenement || evenement.length > 100) throw echec(400, 'evenement', 'Nom de l’événement obligatoire (100 caractères au plus).');
    }
    let choisie = null;
    if (m.evenement && corps.categorieId !== undefined && corps.categorieId !== null && corps.categorieId !== '') {
      choisie = (await categories()).find(c => c.id === String(corps.categorieId));
      if (!choisie) throw echec(400, 'categories', 'Catégorie introuvable.');
    }
    const refs = choisie ? [] : m.categories === 'toutes' ? [...CLES_SEMEES] : [...m.categories];
    const trouver = (liste, cle) => {
      const modele = CATEGORIES_DEFAUT.find(x => x.cle === cle);
      const noms = new Set([nomNormalise(modele.nom.fr), nomNormalise(modele.nom.en)]);
      return liste.find(c => noms.has(nomNormalise(c.nom.fr)) || noms.has(nomNormalise(c.nom.en)));
    };
    const avant = await categories();
    const manquantes = refs.filter(cle => !trouver(avant, cle));
    let ajoutees = [];
    let ignorees = manquantes;
    if (manquantes.length && corps.ajouterManquantes === true) ({ ajoutees, ignorees } = await creerModeles(acteur, manquantes));
    const apres = await categories();
    const ids = choisie ? [choisie.id] : m.categories === 'toutes' ? apres.filter(c => c.actif).map(c => c.id) : refs.map(cle => trouver(apres, cle)?.id).filter(Boolean);
    const liste = ids.slice(0, 25);
    const general = await lireGeneral(base);
    const textes = textesPanneauModele(m, { evenement, appSeule: reponsesAppSeules(general), horaires: await lireHoraires(base) });
    // Titre déjà pris (français ou anglais) : « (2) », « (3) »…
    const pris = new Set();
    for (const l of await base.tous('SELECT titre FROM tickets_panneaux', [])) {
      const t = panneauPublic({ titre: l.titre }).titre;
      pris.add(nomNormalise(t.fr));
      pris.add(nomNormalise(t.en));
    }
    let titre = textes.titre;
    let k = 1;
    while (pris.has(nomNormalise(titre.fr)) || pris.has(nomNormalise(titre.en))) {
      k += 1;
      titre = { fr: `${textes.titre.fr.slice(0, 250)} (${k})`, en: `${textes.titre.en.slice(0, 250)} (${k})` };
    }
    const panneauCree = await insererPanneau(acteur, {
      titre,
      texte: textes.texte,
      couleur: m.couleur,
      style: m.style === 'auto' ? (liste.length > 5 ? 'menu' : 'boutons') : m.style,
      categories: liste,
      ...(m.libelleBouton && liste.length === 1 ? { libelles: { [liste[0]]: m.libelleBouton } } : {}),
    });
    return { panneau: panneauCree, ajoutees, ignorees, renomme: k > 1, categories: apres };
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
   * `serveur` (facultatif) : serveur CHOISI dans l'app mais pas encore enregistré ; ses catégories et salons sont lus
   * tout de suite (le serveur et la catégorie des tickets s'enregistrent ensuite ensemble). Il doit être un serveur où
   * est le bot. Erreur Discord : `erreur` (`discord-403`…), `erreurDetail` `{ etape, statut, code }` (50001 : Missing
   * Access, le bot n'est pas, ou plus, sur le serveur).
   */
  async function discord(acteur, { serveur: demande } = {}) {
    await contexteTickets(base, acteur, { exiger: 'configurer' });
    if (!jetonBot) return { bot: false };
    if (demande !== undefined && demande !== null && demande !== '' && (typeof demande !== 'string' || !ID_DISCORD.test(demande))) throw echec(400, 'serveur', 'Identifiant Discord invalide (chiffres seulement).');
    const general = await lireGeneral(base);
    const serveurs = await rest(fetchDiscord, jetonBot, 'GET', '/users/@me/guilds');
    const listeServeurs = serveurs.ok && Array.isArray(serveurs.corps) ? serveurs.corps.map(g => ({ id: String(g.id), nom: String(g.name ?? '') })) : [];
    if (!serveurs.ok) return { bot: true, serveurs: listeServeurs, ...erreurRest('serveurs', serveurs) };
    const guildId = demande || general.guildId;
    if (!guildId) return { bot: true, serveurs: listeServeurs, erreur: null };
    const enregistre = guildId === general.guildId;
    const serveur = { id: guildId, nom: listeServeurs.find(g => g.id === guildId)?.nom ?? (enregistre ? general.guildNom : '') ?? '', enregistre };
    // Le bot n'est pas (ou plus) sur ce serveur : rien à lire, l'app propose le lien d'invitation.
    if (!listeServeurs.some(g => g.id === guildId)) return { bot: true, serveurs: listeServeurs, serveur, erreur: 'bot-absent', erreurDetail: { etape: 'serveurs', statut: 0, code: null } };
    const [salons, roles, moiBot] = await Promise.all([
      rest(fetchDiscord, jetonBot, 'GET', `/guilds/${guildId}/channels`),
      rest(fetchDiscord, jetonBot, 'GET', `/guilds/${guildId}/roles`),
      rest(fetchDiscord, jetonBot, 'GET', `/users/@me`),
    ]);
    if (!salons.ok) return { bot: true, serveurs: listeServeurs, serveur, ...erreurRest('salons', salons) };
    if (!roles.ok) return { bot: true, serveurs: listeServeurs, serveur, ...erreurRest('roles', roles) };
    const botId = moiBot.corps?.id ?? applicationId;
    const membre = await rest(fetchDiscord, jetonBot, 'GET', `/guilds/${guildId}/members/${botId}`);
    const rolesBot = membre.ok ? (membre.corps?.roles ?? []) : [];
    const listeSalons = (Array.isArray(salons.corps) ? salons.corps : []).filter(s => [0, 4, 5, 15].includes(Number(s.type)));
    const perm = salon => permissionsMembre({ guildId, roles: roles.corps, membreRoles: rolesBot, salon, membreId: botId });
    const verif = id => {
      if (!id || !enregistre) return null;
      const s = listeSalons.find(x => x.id === id);
      return s ? { id, nom: s.name, manquantes: manquantes(perm(s)) } : { id, introuvable: true, manquantes: [] };
    };
    return {
      bot: true,
      serveurs: listeServeurs,
      serveur,
      erreur: null,
      salons: listeSalons.map(s => ({ id: s.id, nom: String(s.name ?? ''), type: Number(s.type) === 4 ? 'categorie' : 'texte', parent: s.parent_id ?? null, position: Number(s.position ?? 0) })).sort((a, b) => a.position - b.position),
      roles: (Array.isArray(roles.corps) ? roles.corps : []).filter(r => r.id !== guildId && !r.managed).map(r => ({ id: r.id, nom: String(r.name ?? ''), couleur: Number(r.color) ? `#${Number(r.color).toString(16).padStart(6, '0')}` : null, position: Number(r.position ?? 0) })).sort((a, b) => b.position - a.position),
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
    changerBienvenue,
    testerBienvenue,
    ajouterCategorie,
    modifierCategorie,
    supprimerCategorie,
    ordonnerCategories,
    ajouterModeles,
    ajouterPanneau,
    creerPanneauModele,
    modifierPanneau,
    supprimerPanneau,
    apercuPanneau,
    publierPanneau,
    ajouterListeNoire,
    retirerListeNoire,
    discord,
  };
}
