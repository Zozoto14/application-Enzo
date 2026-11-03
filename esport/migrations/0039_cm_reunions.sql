-- Esport, migration 0039 : Réunions de l'équipe CM, « comme Teams » (docs/esport/cm-reunions.md).
--
-- 1. `cm_reunions` : réunions et rendez-vous de l'équipe CM (agenda du club, au-dessus des teams). Instants en UTC
--    (ISO 8601), heure murale gardée par le fuseau (`fuseau`) et la règle de récurrence hebdomadaire (`recurrence`,
--    JSON, même format que le planning des teams : planning/recurrence.mjs). Lieu : aucun, salon vocal Discord,
--    lien de visio externe, lieu physique (`lieu_genre`, `lieu`, `lien`). `rappel_minutes` : rappel avant chaque
--    occurrence (NULL : aucun). `genre` = 'rdv' : rendez-vous réservé sur un créneau proposé (`creneau_id`).
--    Annulation : `statut` = 'annulee' (la ligne reste, les participants sont prévenus).
-- 2. `cm_reunion_participants` : participants internes (équipe CM et, si besoin, autres membres du club) et leur
--    réponse (attente, accepte, peut_etre, refuse, propose : autre horaire proposé). L'organisateur y figure aussi.
-- 3. `cm_reunion_exceptions` : occurrence d'une série annulée seule (clé : ISO du début d'origine).
-- 4. `cm_reunion_notes` : ordre du jour et compte rendu. CONFIDENTIELS : lus par l'organisateur, les participants
--    et `cm.reunions.gerer` seulement ; jamais dans un événement du bus, un MP, un export iCal ni une IA externe.
--    `cm_reunion_taches` : tâches de suivi (éventuellement devenues une carte d'un tableau CM : `carte_id`).
-- 5. Disponibilités de chacun : créneaux hebdomadaires (`cm_dispo_regles`, heures murales « HH:MM » dans le fuseau
--    de saisie), exceptions datées (`cm_dispo_exceptions` : absence, congé, disponible en plus ; instants UTC),
--    statut du moment et fuseau du membre (`cm_reunion_profils`).
-- 6. Rendez-vous : offres (`cm_rdv_offres`) et leurs créneaux (`cm_rdv_creneaux`) ; un créneau n'est réservé qu'une
--    fois (UPDATE conditionnel `reserve_par IS NULL`, et index unique sur la réunion créée).
-- 7. Rappels : marque « déjà rappelé » par occurrence et par compte (`cm_reunion_rappels`) ; MP Discord du bot en file
--    (`cm_reunion_mp`, réessais) ; abonnements iCal (`cm_reunion_ical` : seule l'empreinte SHA-256 du jeton).
-- 8. Permissions `cm.reunions.voir` (voir l'agenda de l'équipe CM, créer ses réunions) et `cm.reunions.gerer`
--    (gérer toutes les réunions) : Responsable CM (les deux), Correspondant CM (voir), Second CEO (les deux).
--
-- SQL standard (PostgreSQL et SQLite), mêmes conventions que 0001 et 0023 (UUID et dates en TEXT, booléens 0/1,
-- JSON en TEXT). Pas de clé étrangère vers `comptes` (effacement RGPD par le serveur, comme le reste du CM).

CREATE TABLE cm_reunions (
  id TEXT PRIMARY KEY,
  genre TEXT NOT NULL DEFAULT 'reunion' CHECK (genre IN ('reunion', 'rdv')),
  titre TEXT NOT NULL,
  debut TEXT NOT NULL,
  fin TEXT NOT NULL,
  fuseau TEXT NOT NULL,
  recurrence TEXT,
  lieu_genre TEXT NOT NULL DEFAULT 'aucun' CHECK (lieu_genre IN ('aucun', 'discord', 'lien', 'lieu')),
  lieu TEXT NOT NULL DEFAULT '',
  lien TEXT,
  rappel_minutes INTEGER,
  organisateur_id TEXT,
  statut TEXT NOT NULL DEFAULT 'active' CHECK (statut IN ('active', 'annulee')),
  motif_annulation TEXT,
  creneau_id TEXT UNIQUE,
  version INTEGER NOT NULL DEFAULT 1,
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  maj_par TEXT,
  maj_le TEXT NOT NULL,
  annule_par TEXT,
  annule_le TEXT
);
CREATE INDEX cm_reunions_debut ON cm_reunions (statut, debut);
CREATE INDEX cm_reunions_organisateur ON cm_reunions (organisateur_id);

CREATE TABLE cm_reunion_participants (
  reunion_id TEXT NOT NULL REFERENCES cm_reunions (id) ON DELETE CASCADE,
  compte_id TEXT NOT NULL,
  reponse TEXT NOT NULL DEFAULT 'attente' CHECK (reponse IN ('attente', 'accepte', 'peut_etre', 'refuse', 'propose')),
  proposition_debut TEXT,
  proposition_fin TEXT,
  commentaire TEXT NOT NULL DEFAULT '',
  repondu_le TEXT,
  ajoute_le TEXT NOT NULL,
  PRIMARY KEY (reunion_id, compte_id)
);
CREATE INDEX cm_reunion_participants_compte ON cm_reunion_participants (compte_id);

CREATE TABLE cm_reunion_exceptions (
  reunion_id TEXT NOT NULL REFERENCES cm_reunions (id) ON DELETE CASCADE,
  occurrence TEXT NOT NULL,
  annulee INTEGER NOT NULL DEFAULT 1,
  maj_par TEXT,
  maj_le TEXT NOT NULL,
  PRIMARY KEY (reunion_id, occurrence)
);

CREATE TABLE cm_reunion_notes (
  reunion_id TEXT PRIMARY KEY REFERENCES cm_reunions (id) ON DELETE CASCADE,
  ordre_du_jour TEXT NOT NULL DEFAULT '',
  compte_rendu TEXT NOT NULL DEFAULT '',
  maj_par TEXT,
  maj_le TEXT NOT NULL
);

CREATE TABLE cm_reunion_taches (
  id TEXT PRIMARY KEY,
  reunion_id TEXT NOT NULL REFERENCES cm_reunions (id) ON DELETE CASCADE,
  texte TEXT NOT NULL,
  assigne_a TEXT,
  echeance TEXT,
  fait INTEGER NOT NULL DEFAULT 0,
  carte_id TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL
);
CREATE INDEX cm_reunion_taches_reunion ON cm_reunion_taches (reunion_id, position);

CREATE TABLE cm_dispo_regles (
  id TEXT PRIMARY KEY,
  compte_id TEXT NOT NULL,
  jour INTEGER NOT NULL CHECK (jour BETWEEN 1 AND 7),
  debut TEXT NOT NULL,
  fin TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('disponible', 'indisponible')),
  fuseau TEXT NOT NULL,
  cree_le TEXT NOT NULL
);
CREATE INDEX cm_dispo_regles_compte ON cm_dispo_regles (compte_id);

CREATE TABLE cm_dispo_exceptions (
  id TEXT PRIMARY KEY,
  compte_id TEXT NOT NULL,
  debut TEXT NOT NULL,
  fin TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('absence', 'conge', 'disponible')),
  note TEXT NOT NULL DEFAULT '',
  cree_le TEXT NOT NULL
);
CREATE INDEX cm_dispo_exceptions_compte ON cm_dispo_exceptions (compte_id, debut);

CREATE TABLE cm_reunion_profils (
  compte_id TEXT PRIMARY KEY,
  fuseau TEXT,
  statut TEXT CHECK (statut IS NULL OR statut IN ('disponible', 'occupe', 'absent', 'ne_pas_deranger')),
  message TEXT NOT NULL DEFAULT '',
  statut_jusqua TEXT,
  maj_le TEXT NOT NULL
);

CREATE TABLE cm_rdv_offres (
  id TEXT PRIMARY KEY,
  proprietaire_id TEXT,
  titre TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  duree_minutes INTEGER NOT NULL,
  fuseau TEXT NOT NULL,
  lieu_genre TEXT NOT NULL DEFAULT 'aucun' CHECK (lieu_genre IN ('aucun', 'discord', 'lien', 'lieu')),
  lieu TEXT NOT NULL DEFAULT '',
  lien TEXT,
  ouverte INTEGER NOT NULL DEFAULT 1,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL
);

CREATE TABLE cm_rdv_creneaux (
  id TEXT PRIMARY KEY,
  offre_id TEXT NOT NULL REFERENCES cm_rdv_offres (id) ON DELETE CASCADE,
  debut TEXT NOT NULL,
  fin TEXT NOT NULL,
  reserve_par TEXT,
  reserve_le TEXT,
  reunion_id TEXT,
  UNIQUE (offre_id, debut)
);
CREATE INDEX cm_rdv_creneaux_offre ON cm_rdv_creneaux (offre_id, debut);

CREATE TABLE cm_reunion_rappels (
  reunion_id TEXT NOT NULL REFERENCES cm_reunions (id) ON DELETE CASCADE,
  occurrence TEXT NOT NULL,
  compte_id TEXT NOT NULL,
  envoye_le TEXT NOT NULL,
  PRIMARY KEY (reunion_id, occurrence, compte_id)
);

CREATE TABLE cm_reunion_mp (
  id TEXT PRIMARY KEY,
  compte_id TEXT NOT NULL,
  reunion_id TEXT,
  occurrence TEXT,
  genre TEXT NOT NULL CHECK (genre IN ('rappel', 'annulee')),
  statut TEXT NOT NULL DEFAULT 'attente' CHECK (statut IN ('attente', 'envoye', 'abandonne')),
  essais INTEGER NOT NULL DEFAULT 0,
  prochain_essai_le TEXT NOT NULL,
  expire_le TEXT NOT NULL,
  verrou_jusqua TEXT,
  derniere_erreur TEXT,
  envoye_le TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL
);
CREATE INDEX cm_reunion_mp_statut ON cm_reunion_mp (statut, prochain_essai_le);

CREATE TABLE cm_reunion_ical (
  id TEXT PRIMARY KEY,
  compte_id TEXT NOT NULL,
  super_admin INTEGER NOT NULL DEFAULT 0,
  jeton_hash TEXT NOT NULL UNIQUE,
  libelle TEXT NOT NULL DEFAULT '',
  cree_le TEXT NOT NULL,
  dernier_acces_le TEXT,
  revoque_le TEXT
);
CREATE INDEX cm_reunion_ical_compte ON cm_reunion_ical (compte_id);

-- Permissions : rôles CM système (Responsable : voir et gérer ; Correspondant : voir) et Second CEO (les deux).
INSERT INTO cm_role_permissions (role_id, permission) SELECT id, 'cm.reunions.voir' FROM cm_roles WHERE cle_systeme IN ('responsable', 'correspondant');
INSERT INTO cm_role_permissions (role_id, permission) SELECT id, 'cm.reunions.gerer' FROM cm_roles WHERE cle_systeme = 'responsable';
INSERT INTO roles_globaux_permissions (role_id, permission) SELECT id, 'cm.reunions.voir' FROM roles_globaux WHERE id = 'role-global-second-ceo';
INSERT INTO roles_globaux_permissions (role_id, permission) SELECT id, 'cm.reunions.gerer' FROM roles_globaux WHERE id = 'role-global-second-ceo';
