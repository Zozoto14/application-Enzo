/**
 * Tickets : réglages (Tickets › Configuration), lus et validés ici. Fonctions sur la base, sans réseau.
 *
 *  - `general`  : serveur Discord lié, catégories Discord (tickets ouverts, archives), salon des journaux, langue des
 *                 messages, fermeture automatique, suppression des salons archivés, rétention, pièces jointes ;
 *  - `messages` : textes personnalisés FR / EN (vide : texte par défaut, textes.mjs) ;
 *  - `horaires` : horaires du support et réponse automatique hors horaires (facultatif) ;
 *  - `commandes`: chaque commande slash activée ou non, et ses rôles Discord autorisés.
 * Catégories de tickets, panneaux et liste noire : tables à part (validations ci-dessous).
 */

import { echec, iso, jsonOu, nouvelId } from '../outils.mjs';
import { CLES_MESSAGES, MODES_LANGUE } from './textes.mjs';

export const PRIORITES = Object.freeze(['faible', 'moyen', 'urgent', 'critique']);
export const STATUTS = Object.freeze(['ouvert', 'pris_en_charge', 'en_attente', 'resolu', 'ferme']);
export const STATUTS_OUVERTS = Object.freeze(['ouvert', 'pris_en_charge', 'en_attente', 'resolu']);
/** Icônes proposées pour une catégorie (pictogrammes MONOCHROMES de l'app, src/ui/icones). */
export const ICONES = Object.freeze(['billets', 'question', 'membres', 'manette', 'trophee', 'megaphone', 'outils', 'alerte', 'bouclier', 'bulle', 'partenaires', 'calendrier', 'enveloppe', 'bug']);
/** Liaisons facultatives d'une catégorie. */
export const LIAISONS = Object.freeze(['aucune', 'sponsors', 'cm', 'fiche']);
/** Commandes slash des tickets (sous-commandes de /ticket, et /tickets). */
export const COMMANDES_TICKETS = Object.freeze(['ouvrir', 'fermer', 'prendre', 'liberer', 'ajouter', 'retirer', 'renommer', 'priorite', 'transferer', 'rouvrir', 'transcript', 'note', 'attente', 'stats', 'panneau', 'permanent', 'supprimer', 'ping', 'tickets']);
/** Commandes réservées au staff (rôles de la catégorie ou compte lié autorisé), en plus des rôles réglés. */
export const COMMANDES_STAFF = Object.freeze(['prendre', 'liberer', 'ajouter', 'retirer', 'renommer', 'priorite', 'transferer', 'rouvrir', 'transcript', 'note', 'attente', 'stats', 'panneau', 'permanent', 'supprimer', 'ping']);

export const LIMITES = Object.freeze({ categories: 25, champs: 5, panneaux: 20, listeNoire: 1000, roles: 20, mentions: 5, plages: 21 });

export const GENERAL_DEFAUT = Object.freeze({
  actif: false,
  guildId: null,
  guildNom: '',
  categorieOuverts: null,
  categorieArchives: null,
  salonJournaux: null,
  langue: 'auteur',
  fermetureAutoH: 168,
  avertissementH: 24,
  suppressionArchivesJours: 7,
  retentionJours: 365,
  // Ticket supprimé : lisible dans l'app (Supprimés) ce nombre de jours, puis effacé définitivement (migration 0065).
  retentionSuppressionJours: 30,
  copierPieces: true,
  pieceMaxMo: 8,
  // « Le staff répond uniquement depuis l'AppDashboard » : les rôles Discord des catégories lisent les salons des
  // tickets sans y écrire (discord.mjs : DROITS_LECTURE, REFUS_ECRITURE) ; l'auteur et les personnes ajoutées écrivent
  // et envoient leurs fichiers directement dans le salon. Activé par défaut.
  reponsesAppSeules: true,
  // Messages automatiques postés dans le salon du ticket (ANNONCES_DEFAUT) ; un événement coupé reste noté dans l'app
  // (conversation) et dans le salon des journaux du staff.
  annonces: {},
});
/** Le réglage « Le staff répond uniquement depuis l'AppDashboard » est-il actif ? (absent : oui, c'est le défaut) */
export const reponsesAppSeules = general => general?.reponsesAppSeules !== false;

/**
 * Messages automatiques dans le salon d'un ticket (Configuration › Messages, « Messages automatiques dans le salon »),
 * par événement. Par défaut, seul ce qui compte pour l'auteur est posté : prise en charge, personne ajoutée (elle sait
 * ainsi pourquoi elle voit le salon), réponse hors horaires, avertissement avant la fermeture automatique, fermeture,
 * réouverture, et le MP récapitulatif à la fermeture. L'accueil, les réponses du staff et les mentions (« Mentionner »)
 * sont toujours postés.
 */
export const ANNONCES_DEFAUT = Object.freeze({
  prise_en_charge: true,
  liberation: false,
  attente: false,
  priorite: false,
  ajoute: true,
  retire: false,
  transfere: false,
  permanent: false,
  hors_horaires: true,
  avertissement: true,
  fermeture: true,
  reouverture: true,
  mp_fermeture: true,
});
export const CLES_ANNONCES = Object.freeze(Object.keys(ANNONCES_DEFAUT));
/** Réglage complet des messages automatiques (défauts complétés). */
export const annoncesDe = general => Object.fromEntries(CLES_ANNONCES.map(c => [c, typeof general?.annonces?.[c] === 'boolean' ? general.annonces[c] : ANNONCES_DEFAUT[c]]));
/** Cet événement est-il posté dans le salon (ou envoyé en MP pour `mp_fermeture`) ? */
export const annonceActive = (general, cle) => annoncesDe(general)[cle] !== false;
export const HORAIRES_DEFAUT = Object.freeze({ actif: false, fuseau: 'Europe/Paris', plages: [] });

const ID = /^\d{5,25}$/;
const idOuNull = (v, quoi) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !ID.test(v)) throw echec(400, quoi, 'Identifiant Discord invalide (chiffres seulement).');
  return v;
};
const entier = (v, min, max, quoi, defaut) => {
  if (v === undefined) return defaut;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw echec(400, quoi, `Valeur hors limites (${min} à ${max}).`);
  return n;
};
const texte = (v, max, quoi, { requis = false } = {}) => {
  if (v === undefined || v === null) {
    if (requis) throw echec(400, quoi, 'Champ obligatoire.');
    return '';
  }
  if (typeof v !== 'string') throw echec(400, quoi, 'Texte attendu.');
  const s = v.replace(/\r\n?/g, '\n').trim();
  if (requis && !s) throw echec(400, quoi, 'Champ obligatoire.');
  if (s.length > max) throw echec(400, quoi, `${max} caractères au plus.`);
  return s;
};
const deuxLangues = (v, max, quoi, opts) => ({ fr: texte(v?.fr, max, `${quoi}-fr`, opts), en: texte(v?.en, max, `${quoi}-en`, opts) });
const ids = (v, max, quoi) => {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > max || v.some(x => typeof x !== 'string' || !ID.test(x))) throw echec(400, quoi, `Liste d’identifiants Discord invalide (${max} au plus).`);
  return [...new Set(v)];
};
const couleur = (v, defaut = '#5865f2') => {
  if (v === undefined) return defaut;
  if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) throw echec(400, 'couleur', 'Couleur : #rrggbb.');
  return v.toLowerCase();
};

// ------------------------------------------------------------------ Réglages par clé

export async function lireReglage(base, cle, defaut) {
  const l = await base.premier('SELECT valeur FROM tickets_reglages WHERE cle = ?', [cle]);
  const v = jsonOu(l?.valeur, null);
  return v && typeof v === 'object' && !Array.isArray(v) ? { ...defaut, ...v } : { ...defaut };
}

export const lireGeneral = async base => {
  const g = await lireReglage(base, 'general', GENERAL_DEFAUT);
  return { ...g, annonces: annoncesDe(g) };
};
export const lireMessages = base => lireReglage(base, 'messages', {});
export const lireHoraires = base => lireReglage(base, 'horaires', HORAIRES_DEFAUT);
export async function lireCommandes(base) {
  const v = await lireReglage(base, 'commandes', {});
  return Object.fromEntries(COMMANDES_TICKETS.map(c => [c, { actif: v[c]?.actif !== false, roles: Array.isArray(v[c]?.roles) ? v[c].roles.filter(x => ID.test(String(x))) : [] }]));
}

export function instructionReglage(cle, valeur, compte, t) {
  return {
    sql: 'INSERT INTO tickets_reglages (cle, valeur, maj_par, maj_le) VALUES (?, ?, ?, ?) ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur, maj_par = excluded.maj_par, maj_le = excluded.maj_le',
    params: [cle, JSON.stringify(valeur), compte ?? null, iso(t)],
  };
}

/** Valide les réglages généraux (fusion avec l'existant : seuls les champs fournis changent). */
export function validerGeneral(c, actuel) {
  const s = { ...actuel };
  if (c.actif !== undefined) s.actif = c.actif === true;
  if (c.guildId !== undefined) s.guildId = idOuNull(c.guildId, 'serveur');
  if (c.guildNom !== undefined) s.guildNom = texte(c.guildNom, 100, 'serveur');
  if (c.categorieOuverts !== undefined) s.categorieOuverts = idOuNull(c.categorieOuverts, 'categorie-ouverts');
  if (c.categorieArchives !== undefined) s.categorieArchives = idOuNull(c.categorieArchives, 'categorie-archives');
  if (c.salonJournaux !== undefined) s.salonJournaux = idOuNull(c.salonJournaux, 'salon-journaux');
  if (c.langue !== undefined) {
    if (!MODES_LANGUE.includes(c.langue)) throw echec(400, 'langue', 'Langue des messages inconnue.');
    s.langue = c.langue;
  }
  s.fermetureAutoH = entier(c.fermetureAutoH, 0, 2160, 'fermeture', s.fermetureAutoH);
  s.avertissementH = entier(c.avertissementH, 0, 168, 'avertissement', s.avertissementH);
  s.suppressionArchivesJours = entier(c.suppressionArchivesJours, 0, 365, 'suppression', s.suppressionArchivesJours);
  s.retentionJours = entier(c.retentionJours, 7, 3650, 'retention', s.retentionJours);
  s.retentionSuppressionJours = entier(c.retentionSuppressionJours, 1, 365, 'retention-suppression', s.retentionSuppressionJours);
  if (c.copierPieces !== undefined) s.copierPieces = c.copierPieces === true;
  if (c.reponsesAppSeules !== undefined) s.reponsesAppSeules = c.reponsesAppSeules !== false;
  if (c.annonces !== undefined) {
    if (!c.annonces || typeof c.annonces !== 'object' || Array.isArray(c.annonces)) throw echec(400, 'annonces', 'Messages automatiques illisibles.');
    const a = annoncesDe(s);
    for (const cle of CLES_ANNONCES) if (c.annonces[cle] !== undefined) a[cle] = c.annonces[cle] === true;
    s.annonces = a;
  }
  s.pieceMaxMo = entier(c.pieceMaxMo, 1, 25, 'piece', s.pieceMaxMo);
  if (s.actif && (!s.guildId || !s.categorieOuverts)) throw echec(400, 'incomplet', 'Choisissez le serveur et la catégorie Discord des tickets ouverts avant d’activer.');
  return s;
}

export function validerMessages(c) {
  if (!c || typeof c !== 'object') throw echec(400, 'messages', 'Messages illisibles.');
  const s = {};
  for (const cle of CLES_MESSAGES) if (c[cle] !== undefined) s[cle] = deuxLangues(c[cle], 1500, `message-${cle}`);
  return s;
}

const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;
export function validerHoraires(c) {
  const plages = Array.isArray(c?.plages) ? c.plages : [];
  if (plages.length > LIMITES.plages) throw echec(400, 'plages', `${LIMITES.plages} plages au plus.`);
  const fuseau = typeof c?.fuseau === 'string' && c.fuseau.length <= 60 ? c.fuseau : 'Europe/Paris';
  try {
    new Intl.DateTimeFormat('fr', { timeZone: fuseau });
  } catch {
    throw echec(400, 'fuseau', 'Fuseau horaire inconnu.');
  }
  return {
    actif: c?.actif === true,
    fuseau,
    plages: plages.map(p => {
      const jour = entier(p?.jour, 1, 7, 'jour');
      if (!HEURE.test(p?.debut ?? '') || !HEURE.test(p?.fin ?? '') || p.debut >= p.fin) throw echec(400, 'plage', 'Plage horaire : HH:MM, début avant fin.');
      return { jour, debut: p.debut, fin: p.fin };
    }),
  };
}

export function validerCommandes(c) {
  const s = {};
  for (const nom of COMMANDES_TICKETS) {
    const v = c?.[nom];
    if (!v) continue;
    s[nom] = { actif: v.actif !== false, roles: ids(v.roles, LIMITES.roles, `commande-${nom}`) };
  }
  return s;
}

/** Le support est-il ouvert à cet instant (horaires actifs) ? */
export function dansHoraires(horaires, t) {
  if (!horaires?.actif || !horaires.plages?.length) return true;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: horaires.fuseau, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t)).map(p => [p.type, p.value]));
  const jour = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday) + 1;
  const hm = `${parts.hour}:${parts.minute}`;
  return horaires.plages.some(p => p.jour === jour && hm >= p.debut && hm < p.fin);
}

// ------------------------------------------------------------------ Catégories

export function categoriePublique(l) {
  return {
    id: l.id,
    nom: { fr: l.nom_fr, en: l.nom_en },
    description: { fr: l.description_fr, en: l.description_en },
    icone: l.icone,
    couleur: l.couleur,
    position: Number(l.position),
    actif: Number(l.actif) === 1,
    rolesDiscord: jsonOu(l.roles_discord, []),
    rolesApp: jsonOu(l.roles_app, []),
    formulaire: jsonOu(l.formulaire, []),
    accueil: { fr: '', en: '', ...jsonOu(l.accueil, {}) },
    modeleNom: l.modele_nom,
    maxOuverts: Number(l.max_ouverts),
    fermetureAutoH: l.fermeture_auto_h === null || l.fermeture_auto_h === undefined ? null : Number(l.fermeture_auto_h),
    fermetureStaffSeul: Number(l.fermeture_staff_seul) === 1,
    satisfaction: Number(l.satisfaction) === 1,
    prioriteDefaut: l.priorite_defaut,
    mentions: jsonOu(l.mentions, []),
    liaison: { type: 'aucune', ...jsonOu(l.liaison, {}) },
  };
}

/**
 * Délai de fermeture automatique d'un ticket, en heures (0 : jamais), et d'où il vient. Ordre de priorité : ticket
 * permanent (`tickets.permanent`, jamais) > réglage de la catégorie (`fermetureAutoH` : null = général, 0 = jamais,
 * N heures) > réglage général (0 = jamais). `cat` : catégorie publique (categoriePublique) ou absente.
 */
export function delaiFermeture(ticket, cat, general) {
  if (Number(ticket?.permanent) === 1) return { heures: 0, source: 'ticket' };
  if (cat && cat.fermetureAutoH !== null && cat.fermetureAutoH !== undefined) return { heures: Math.max(0, Number(cat.fermetureAutoH) || 0), source: 'categorie' };
  return { heures: Math.max(0, Number(general?.fermetureAutoH) || 0), source: 'general' };
}

const MOTIF_CHAMP = /^[a-z0-9_-]{1,40}$/;
function validerFormulaire(v) {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > LIMITES.champs) throw echec(400, 'formulaire', `Formulaire : ${LIMITES.champs} champs au plus (limite des fenêtres Discord).`);
  const vus = new Set();
  return v.map((c, i) => {
    const id = typeof c?.id === 'string' && MOTIF_CHAMP.test(c.id) ? c.id : `champ${i + 1}`;
    if (vus.has(id)) throw echec(400, 'formulaire', 'Deux champs ont le même identifiant.');
    vus.add(id);
    const libelle = deuxLangues(c?.libelle, 45, 'champ-libelle');
    if (!libelle.fr && !libelle.en) throw echec(400, 'champ-libelle', 'Chaque champ a un libellé (45 caractères au plus).');
    const max = entier(c?.max, 1, 4000, 'champ-max', c?.style === 'long' ? 1000 : 100);
    const min = entier(c?.min, 0, 4000, 'champ-min', 0);
    if (min > max) throw echec(400, 'champ-min', 'Longueur minimale plus grande que la maximale.');
    return { id, libelle, style: c?.style === 'long' ? 'long' : 'court', requis: c?.requis !== false, placeholder: deuxLangues(c?.placeholder, 100, 'champ-placeholder'), min, max };
  });
}

/** Valide une catégorie (création : tous les champs ; modification : ceux fournis). Rend les colonnes. */
export async function validerCategorie(base, c, { creation = false } = {}) {
  const s = {};
  if (creation || c.nom !== undefined) {
    const nom = deuxLangues(c.nom, 60, 'nom');
    if (!nom.fr && !nom.en) throw echec(400, 'nom', 'Nom de la catégorie obligatoire (60 caractères au plus).');
    s.nom_fr = nom.fr || nom.en;
    s.nom_en = nom.en || nom.fr;
  }
  if (c.description !== undefined) {
    const d = deuxLangues(c.description, 100, 'description');
    s.description_fr = d.fr;
    s.description_en = d.en;
  }
  if (c.icone !== undefined) {
    if (!ICONES.includes(c.icone)) throw echec(400, 'icone', 'Icône inconnue.');
    s.icone = c.icone;
  }
  if (c.couleur !== undefined) s.couleur = couleur(c.couleur);
  if (c.position !== undefined) s.position = entier(c.position, 0, 1000, 'position');
  if (c.actif !== undefined) s.actif = c.actif === false ? 0 : 1;
  if (c.rolesDiscord !== undefined) s.roles_discord = JSON.stringify(ids(c.rolesDiscord, LIMITES.roles, 'roles-discord'));
  if (c.rolesApp !== undefined) {
    if (!Array.isArray(c.rolesApp) || c.rolesApp.length > LIMITES.roles) throw echec(400, 'roles-app', 'Rôles de l’app illisibles.');
    const sortie = [];
    for (const r of c.rolesApp) {
      const m = /^(club|cm):([A-Za-z0-9_-]{1,64})$/.exec(String(r));
      if (!m) throw echec(400, 'roles-app', 'Rôle de l’app illisible.');
      const table = m[1] === 'club' ? 'roles_globaux' : 'cm_roles';
      if (!(await base.premier(`SELECT id FROM ${table} WHERE id = ?`, [m[2]]))) throw echec(400, 'roles-app', 'Rôle de l’app introuvable.');
      sortie.push(r);
    }
    s.roles_app = JSON.stringify([...new Set(sortie)]);
  }
  const formulaire = validerFormulaire(c.formulaire);
  if (formulaire) s.formulaire = JSON.stringify(formulaire);
  if (c.accueil !== undefined) s.accueil = JSON.stringify(deuxLangues(c.accueil, 1500, 'accueil'));
  if (c.modeleNom !== undefined) {
    const m = texte(c.modeleNom, 80, 'modele-nom', { requis: true });
    if (!m.includes('{numero}')) throw echec(400, 'modele-nom', 'Le modèle du nom de salon doit contenir {numero}.');
    s.modele_nom = m;
  }
  if (c.maxOuverts !== undefined) s.max_ouverts = entier(c.maxOuverts, 1, 10, 'max-ouverts');
  if (c.fermetureAutoH !== undefined) s.fermeture_auto_h = c.fermetureAutoH === null ? null : entier(c.fermetureAutoH, 0, 2160, 'fermeture');
  if (c.fermetureStaffSeul !== undefined) s.fermeture_staff_seul = c.fermetureStaffSeul === true ? 1 : 0;
  if (c.satisfaction !== undefined) s.satisfaction = c.satisfaction === false ? 0 : 1;
  if (c.prioriteDefaut !== undefined) {
    if (!PRIORITES.includes(c.prioriteDefaut)) throw echec(400, 'priorite', 'Priorité inconnue.');
    s.priorite_defaut = c.prioriteDefaut;
  }
  if (c.mentions !== undefined) s.mentions = JSON.stringify(ids(c.mentions, LIMITES.mentions, 'mentions'));
  if (c.liaison !== undefined) {
    const type = LIAISONS.includes(c.liaison?.type) ? c.liaison.type : 'aucune';
    const l = { type };
    if (type === 'cm') {
      const tableau = typeof c.liaison.tableauId === 'string' ? c.liaison.tableauId : '';
      if (!(await base.premier('SELECT id FROM cm_tableaux WHERE id = ? AND archive_le IS NULL', [tableau]))) throw echec(400, 'liaison', 'Choisissez le tableau CM des demandes.');
      l.tableauId = tableau;
    }
    s.liaison = JSON.stringify(l);
  }
  return s;
}

export async function creerCategorie(base, acteur, c, t) {
  const n = await base.premier('SELECT COUNT(*) AS n FROM tickets_categories WHERE supprime_le IS NULL', []);
  if (Number(n?.n ?? 0) >= LIMITES.categories) throw echec(409, 'trop', `${LIMITES.categories} catégories au plus (limite des menus Discord).`);
  const s = await validerCategorie(base, c, { creation: true });
  const id = nouvelId();
  const pos = await base.premier('SELECT MAX(position) AS p FROM tickets_categories', []);
  const ligne = { id, position: Number(pos?.p ?? -1) + 1, ...s, cree_le: iso(t), maj_le: iso(t) };
  const colonnes = Object.keys(ligne);
  return { id, instruction: { sql: `INSERT INTO tickets_categories (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`, params: Object.values(ligne) } };
}

// ------------------------------------------------------------------ Panneaux

/** Libellés propres des boutons (migration 0057) : { idCatégorie: { fr, en } }, objet vide par défaut. */
function libellesLus(v) {
  const o = jsonOu(v, {});
  return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
}

export function panneauPublic(l) {
  return {
    id: l.id,
    titre: { fr: '', en: '', ...jsonOu(l.titre, {}) },
    texte: { fr: '', en: '', ...jsonOu(l.texte, {}) },
    couleur: l.couleur,
    imageElementId: l.image_element_id ?? null,
    style: l.style,
    categories: jsonOu(l.categories, []),
    libelles: libellesLus(l.libelles),
    salonId: l.salon_id ?? null,
    messageId: l.message_id ?? null,
    publieLe: l.publie_le ?? null,
    erreur: l.erreur ?? null,
    majLe: l.maj_le,
  };
}

export async function validerPanneau(base, c, { creation = false } = {}) {
  const s = {};
  if (creation || c.titre !== undefined) {
    const titre = deuxLangues(c.titre, 256, 'titre');
    if (!titre.fr && !titre.en) throw echec(400, 'titre', 'Titre du panneau obligatoire (256 caractères au plus).');
    s.titre = JSON.stringify(titre);
  }
  if (c.texte !== undefined) s.texte = JSON.stringify(deuxLangues(c.texte, 1800, 'texte'));
  if (c.couleur !== undefined) s.couleur = couleur(c.couleur);
  if (c.style !== undefined) {
    if (!['boutons', 'menu'].includes(c.style)) throw echec(400, 'style', 'Style : boutons ou menu.');
    s.style = c.style;
  }
  if (c.imageElementId !== undefined) {
    if (c.imageElementId !== null && (typeof c.imageElementId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(c.imageElementId))) throw echec(400, 'image', 'Image du Drive illisible.');
    s.image_element_id = c.imageElementId;
  }
  if (c.categories !== undefined) {
    if (!Array.isArray(c.categories) || c.categories.length > 25) throw echec(400, 'categories', '25 catégories au plus par panneau.');
    for (const id of c.categories) if (!(await base.premier('SELECT id FROM tickets_categories WHERE id = ? AND supprime_le IS NULL', [String(id)]))) throw echec(400, 'categories', 'Catégorie introuvable.');
    s.categories = JSON.stringify([...new Set(c.categories.map(String))]);
  }
  if (c.libelles !== undefined) {
    if (c.libelles === null || typeof c.libelles !== 'object' || Array.isArray(c.libelles) || Object.keys(c.libelles).length > 25) throw echec(400, 'libelles', 'Libellés des boutons illisibles (25 au plus).');
    const propres = {};
    for (const [id, v] of Object.entries(c.libelles)) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw echec(400, 'libelles', 'Libellés des boutons illisibles.');
      const l = deuxLangues(v, 80, 'libelle');
      if (l.fr || l.en) propres[id] = l;
    }
    s.libelles = JSON.stringify(propres);
  }
  if (c.salonId !== undefined) s.salon_id = idOuNull(c.salonId, 'salon');
  return s;
}

// ------------------------------------------------------------------ Liste noire

export function validerListeNoire(c) {
  const id = idOuNull(c?.discordId, 'discord-id');
  if (!id) throw echec(400, 'discord-id', 'Identifiant Discord obligatoire.');
  return { id, nom: texte(c?.nom, 100, 'nom'), raison: texte(c?.raison, 300, 'raison') };
}
