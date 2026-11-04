-- Esport, migration 0054 : système de tickets Discord (docs/esport/tickets.md).
--
-- Un seul serveur Discord (celui du club) ; un SALON PRIVÉ par ticket, dans une catégorie Discord ; le bot reçoit
-- les messages en temps réel par la Gateway (un seul processus « meneur » pour tout le compte, bail ci-dessous),
-- avec relecture REST de secours. Tout se règle dans l'app (Tickets › Configuration).
--
-- `tickets_reglages` : réglages par clé (JSON) : 'general' (serveur, catégories Discord, salon des journaux, langue,
--   délais), 'messages' (textes personnalisés FR/EN), 'horaires' (support et réponse hors horaires), 'commandes'
--   (commandes slash activées et rôles autorisés).
-- `tickets_categories` : catégories de tickets (nom, description FR/EN, icône, couleur, ordre, actif), rôles Discord
--   et rôles de l'app qui les traitent, formulaire (5 champs au plus : limite des modals Discord), message d'accueil,
--   modèle de nom de salon, plafond par personne, fermeture automatique, satisfaction, priorité par défaut, mentions,
--   liaison facultative (Sponsors, tableau CM, fiche).
-- `tickets_panneaux` : messages fixes publiés par le bot (boutons ou menu) ; `tickets_liste_noire` : comptes Discord
--   interdits d'ouvrir un ticket.
-- `tickets` : un ticket (numéro séquentiel, statut, priorité aux quatre niveaux d'urgence du CM, auteur Discord,
--   salon, responsable, réponses du formulaire, dates du cycle de vie, note de satisfaction, liaison).
-- `tickets_messages` : la conversation (messages Discord reçus, réponses envoyées depuis l'app, notes internes JAMAIS
--   envoyées sur Discord, messages du système) ; `tickets_pieces` : pièces jointes (copiées dans le stockage privé
--   du serveur, ou seulement référencées) ; `tickets_membres` : personnes ajoutées au salon ; `tickets_lectures` :
--   « lu jusqu'à » de chaque compte (pastilles rouges des non lus).
-- `tickets_bail` : bail du processus meneur de la Gateway (renouvelé, repris par un autre processus s'il meurt) ;
--   `tickets_etat` : état de la connexion Discord (en direct / secours / hors ligne), session à reprendre.
--
-- Permissions du club `tickets.voir`, `tickets.repondre`, `tickets.gerer`, `tickets.configurer` (catalogue.json) :
-- le Fondateur les a d'office ; le Second CEO les reçoit par défaut ; les autres rôles, par la page Rôles et
-- permissions. Données SENSIBLES : jamais envoyées à une IA externe ; rétention réglable ; RGPD (export, effacement).
--
-- SQL standard (PostgreSQL et SQLite).

CREATE TABLE tickets_reglages (
  cle TEXT PRIMARY KEY,
  valeur TEXT NOT NULL,
  maj_par TEXT,
  maj_le TEXT NOT NULL
);

CREATE TABLE tickets_categories (
  id TEXT PRIMARY KEY,
  nom_fr TEXT NOT NULL,
  nom_en TEXT NOT NULL,
  description_fr TEXT NOT NULL DEFAULT '',
  description_en TEXT NOT NULL DEFAULT '',
  icone TEXT NOT NULL DEFAULT 'billets',
  couleur TEXT NOT NULL DEFAULT '#5865f2',
  position INTEGER NOT NULL DEFAULT 0,
  actif INTEGER NOT NULL DEFAULT 1,
  roles_discord TEXT NOT NULL DEFAULT '[]',
  roles_app TEXT NOT NULL DEFAULT '[]',
  formulaire TEXT NOT NULL DEFAULT '[]',
  accueil TEXT NOT NULL DEFAULT '{}',
  modele_nom TEXT NOT NULL DEFAULT 'ticket-{numero}-{pseudo}',
  max_ouverts INTEGER NOT NULL DEFAULT 1,
  fermeture_auto_h INTEGER,
  satisfaction INTEGER NOT NULL DEFAULT 1,
  priorite_defaut TEXT NOT NULL DEFAULT 'moyen' CHECK (priorite_defaut IN ('faible', 'moyen', 'urgent', 'critique')),
  mentions TEXT NOT NULL DEFAULT '[]',
  liaison TEXT NOT NULL DEFAULT '{}',
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  supprime_le TEXT
);

CREATE TABLE tickets_panneaux (
  id TEXT PRIMARY KEY,
  titre TEXT NOT NULL,
  texte TEXT NOT NULL DEFAULT '',
  couleur TEXT NOT NULL DEFAULT '#5865f2',
  image_element_id TEXT,
  style TEXT NOT NULL DEFAULT 'boutons' CHECK (style IN ('boutons', 'menu')),
  categories TEXT NOT NULL DEFAULT '[]',
  salon_id TEXT,
  message_id TEXT,
  publie_le TEXT,
  erreur TEXT,
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL
);

CREATE TABLE tickets_liste_noire (
  discord_user_id TEXT PRIMARY KEY,
  nom TEXT NOT NULL DEFAULT '',
  raison TEXT NOT NULL DEFAULT '',
  ajoute_par TEXT,
  ajoute_le TEXT NOT NULL
);

CREATE TABLE tickets (
  id TEXT PRIMARY KEY,
  numero INTEGER NOT NULL UNIQUE,
  categorie_id TEXT NOT NULL REFERENCES tickets_categories (id),
  statut TEXT NOT NULL DEFAULT 'ouvert' CHECK (statut IN ('ouvert', 'pris_en_charge', 'en_attente', 'resolu', 'ferme')),
  priorite TEXT NOT NULL DEFAULT 'moyen' CHECK (priorite IN ('faible', 'moyen', 'urgent', 'critique')),
  auteur_discord_id TEXT NOT NULL,
  auteur_nom TEXT NOT NULL DEFAULT '',
  auteur_compte_id TEXT,
  langue TEXT NOT NULL DEFAULT 'en',
  salon_id TEXT,
  salon_nom TEXT,
  responsable_compte_id TEXT,
  responsable_discord_id TEXT,
  responsable_nom TEXT,
  reponses TEXT NOT NULL DEFAULT '[]',
  raison_fermeture TEXT,
  ferme_par_nom TEXT,
  ouvert_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  derniere_activite_le TEXT NOT NULL,
  premiere_reponse_le TEXT,
  pris_le TEXT,
  ferme_le TEXT,
  avertissement_le TEXT,
  archive_le TEXT,
  salon_supprime_le TEXT,
  note INTEGER CHECK (note IS NULL OR (note >= 1 AND note <= 5)),
  note_commentaire TEXT,
  note_le TEXT,
  liaison TEXT NOT NULL DEFAULT '{}',
  dernier_message_id TEXT,
  releve_le TEXT,
  purge_le TEXT
);
CREATE INDEX tickets_statut ON tickets (statut, derniere_activite_le);
CREATE INDEX tickets_auteur ON tickets (auteur_discord_id, statut);
CREATE INDEX tickets_salon ON tickets (salon_id);
CREATE INDEX tickets_categorie ON tickets (categorie_id, statut);

CREATE TABLE tickets_messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
  discord_message_id TEXT,
  genre TEXT NOT NULL CHECK (genre IN ('discord', 'app', 'note', 'systeme')),
  auteur_discord_id TEXT,
  auteur_compte_id TEXT,
  auteur_nom TEXT NOT NULL DEFAULT '',
  staff INTEGER NOT NULL DEFAULT 0,
  contenu TEXT NOT NULL DEFAULT '',
  envoi TEXT NOT NULL DEFAULT 'ok' CHECK (envoi IN ('ok', 'attente', 'echec')),
  cree_le TEXT NOT NULL,
  modifie_le TEXT,
  supprime_le TEXT,
  UNIQUE (ticket_id, discord_message_id)
);
CREATE INDEX tickets_messages_ticket ON tickets_messages (ticket_id, cree_le);

CREATE TABLE tickets_pieces (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
  message_id TEXT REFERENCES tickets_messages (id) ON DELETE CASCADE,
  nom TEXT NOT NULL,
  type_mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  taille INTEGER NOT NULL DEFAULT 0,
  cle_stockage TEXT,
  url_origine TEXT,
  statut TEXT NOT NULL CHECK (statut IN ('copiee', 'referencee')),
  cree_le TEXT NOT NULL
);
CREATE INDEX tickets_pieces_ticket ON tickets_pieces (ticket_id);

CREATE TABLE tickets_membres (
  ticket_id TEXT NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
  discord_user_id TEXT NOT NULL,
  nom TEXT NOT NULL DEFAULT '',
  ajoute_par TEXT,
  ajoute_le TEXT NOT NULL,
  PRIMARY KEY (ticket_id, discord_user_id)
);

CREATE TABLE tickets_lectures (
  compte_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
  lu_le TEXT NOT NULL,
  PRIMARY KEY (compte_id, ticket_id)
);

CREATE TABLE tickets_bail (
  id TEXT PRIMARY KEY,
  titulaire TEXT,
  expire_le TEXT NOT NULL,
  maj_le TEXT NOT NULL
);

CREATE TABLE tickets_etat (
  cle TEXT PRIMARY KEY,
  valeur TEXT NOT NULL,
  maj_le TEXT NOT NULL
);

-- Notifications personnelles des tickets : la catégorie de ticket (relue à chaque lecture : un compte qui ne voit
-- plus cette catégorie ne voit plus ses notifications).
ALTER TABLE notifications ADD COLUMN ticket_categorie_id TEXT;

-- Second CEO : les quatre permissions des tickets par défaut (le Fondateur peut les lui retirer).
INSERT INTO roles_globaux_permissions (role_id, permission) SELECT id, 'tickets.voir' FROM roles_globaux WHERE id = 'role-global-second-ceo';
INSERT INTO roles_globaux_permissions (role_id, permission) SELECT id, 'tickets.repondre' FROM roles_globaux WHERE id = 'role-global-second-ceo';
INSERT INTO roles_globaux_permissions (role_id, permission) SELECT id, 'tickets.gerer' FROM roles_globaux WHERE id = 'role-global-second-ceo';
INSERT INTO roles_globaux_permissions (role_id, permission) SELECT id, 'tickets.configurer' FROM roles_globaux WHERE id = 'role-global-second-ceo';
