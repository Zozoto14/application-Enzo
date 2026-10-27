-- Esport, migration 0024 : Sponsors & partenaires (rubrique de l'espace CM). Voir docs/esport/sponsors.md.
--
-- SQL standard, compatible SQLite ET PostgreSQL (mêmes conventions que 0001 : UUID et dates ISO 8601 en
-- TEXT, booléens 0/1, JSON en TEXT, aucune fonction propre à un moteur). Montants en CENTIMES (INTEGER),
-- jours civils en « AAAA-MM-JJ » (heure de Paris), instants en ISO UTC. Positions en REAL.
--
-- Données SENSIBLES (contacts, montants, contrats) : visibles seulement avec les permissions du club
-- `sponsors.voir` / `sponsors.gerer` (rôles CM, affectation « club » ; le Fondateur a tout). Jamais dans le
-- journal d'une team (événements `sponsors.*` sans team).

-- 1. Étapes du pipeline (colonnes du Kanban). `cle` : étape par défaut (renommable, son rôle reste) ;
--    `issue` : ouverte, gagnee (« Signé » : conversion en partenaire) ou perdue (raison de la perte).
CREATE TABLE sp_etapes (
  id TEXT PRIMARY KEY,
  cle TEXT UNIQUE,
  nom TEXT,
  issue TEXT NOT NULL DEFAULT 'ouverte' CHECK (issue IN ('ouverte', 'gagnee', 'perdue')),
  couleur TEXT NOT NULL DEFAULT '#8b8b9a',
  position REAL NOT NULL DEFAULT 0,
  archive_le TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL
);

-- 2. Prospects : entreprises ou marques à démarcher. `teams` : JSON des teams concernées. `valeur_estimee`
--    en centimes. `prochaine_action_le` : instant ISO de la prochaine action (rappel : `rappel_envoye_le`).
CREATE TABLE sp_prospects (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  site TEXT NOT NULL DEFAULT '',
  secteur TEXT NOT NULL DEFAULT '',
  taille TEXT NOT NULL DEFAULT '' CHECK (taille IN ('', 'independant', 'tpe', 'pme', 'eti', 'grande')),
  source TEXT NOT NULL DEFAULT '',
  interet INTEGER NOT NULL DEFAULT 0,
  priorite TEXT NOT NULL DEFAULT 'normale' CHECK (priorite IN ('basse', 'normale', 'haute')),
  valeur_estimee INTEGER NOT NULL DEFAULT 0,
  etape_id TEXT NOT NULL REFERENCES sp_etapes (id),
  position REAL NOT NULL DEFAULT 0,
  responsable_id TEXT,
  teams TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  prochaine_action TEXT NOT NULL DEFAULT '',
  prochaine_action_le TEXT,
  rappel_envoye_le TEXT,
  raison_perte TEXT,
  perdu_le TEXT,
  signe_le TEXT,
  partenaire_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  maj_par TEXT,
  maj_le TEXT NOT NULL,
  supprime_le TEXT
);
CREATE INDEX sp_prospects_etape ON sp_prospects (etape_id, position);
CREATE INDEX sp_prospects_action ON sp_prospects (prochaine_action_le, rappel_envoye_le);

-- 3. Partenaires et sponsors (fiche). `niveau` : principal, officiel, partenaire, fournisseur, media.
--    `logo_piece_id` : pièce jointe image utilisée comme logo.
CREATE TABLE sp_partenaires (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  site TEXT NOT NULL DEFAULT '',
  secteur TEXT NOT NULL DEFAULT '',
  niveau TEXT NOT NULL DEFAULT 'partenaire' CHECK (niveau IN ('principal', 'officiel', 'partenaire', 'fournisseur', 'media')),
  statut TEXT NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'termine')),
  teams TEXT NOT NULL DEFAULT '[]',
  logo_piece_id TEXT,
  notes TEXT NOT NULL DEFAULT '',
  responsable_id TEXT,
  prospect_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  maj_par TEXT,
  maj_le TEXT NOT NULL,
  supprime_le TEXT
);

-- 4. Contrats d'un partenaire : dates (jours), montant en numéraire (centimes) et/ou dotation en nature
--    (description, valeur estimée), renouvellement, préavis (rappel avant la fin : `rappel_fin_le`).
CREATE TABLE sp_contrats (
  id TEXT PRIMARY KEY,
  partenaire_id TEXT NOT NULL REFERENCES sp_partenaires (id) ON DELETE CASCADE,
  intitule TEXT NOT NULL DEFAULT '',
  debut TEXT NOT NULL,
  fin TEXT NOT NULL,
  montant INTEGER NOT NULL DEFAULT 0,
  dotation TEXT NOT NULL DEFAULT '',
  valeur_dotation INTEGER NOT NULL DEFAULT 0,
  renouvellement TEXT NOT NULL DEFAULT 'manuel' CHECK (renouvellement IN ('manuel', 'tacite', 'aucun')),
  preavis_jours INTEGER NOT NULL DEFAULT 30,
  statut TEXT NOT NULL DEFAULT 'actif' CHECK (statut IN ('brouillon', 'actif', 'termine', 'resilie')),
  rappel_fin_le TEXT,
  notes TEXT NOT NULL DEFAULT '',
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  supprime_le TEXT
);
CREATE INDEX sp_contrats_partenaire ON sp_contrats (partenaire_id);
CREATE INDEX sp_contrats_fin ON sp_contrats (statut, fin);

-- 5. Contreparties / obligations envers un partenaire (logo sur chaque affiche, N posts par mois, mention en
--    stream, maillot…), par période (`frequence`), `quantite` attendue par période. `comptage` : « manuel »
--    (avancement saisi) ou « cartes » (les posts CM publiés qui cochent « mention sponsor » comptent).
CREATE TABLE sp_obligations (
  id TEXT PRIMARY KEY,
  partenaire_id TEXT NOT NULL REFERENCES sp_partenaires (id) ON DELETE CASCADE,
  contrat_id TEXT,
  intitule TEXT NOT NULL,
  genre TEXT NOT NULL DEFAULT 'autre' CHECK (genre IN ('posts', 'affiche', 'stream', 'maillot', 'evenement', 'autre')),
  comptage TEXT NOT NULL DEFAULT 'manuel' CHECK (comptage IN ('manuel', 'cartes')),
  frequence TEXT NOT NULL DEFAULT 'mensuelle' CHECK (frequence IN ('unique', 'hebdomadaire', 'mensuelle', 'trimestrielle', 'annuelle')),
  quantite INTEGER NOT NULL DEFAULT 1,
  debut TEXT NOT NULL,
  fin TEXT,
  rappel_jours INTEGER NOT NULL DEFAULT 7,
  responsable_id TEXT,
  notes TEXT NOT NULL DEFAULT '',
  archive_le TEXT,
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  supprime_le TEXT
);
CREATE INDEX sp_obligations_partenaire ON sp_obligations (partenaire_id);

-- 6. Avancement d'une obligation par période (clé : « 2026-10 », « 2026-T4 », « 2026 », « 2026-S43 »,
--    « unique ») : quantité faite à la main, note ; `rappel_le` : rappel « échéance proche » posé.
CREATE TABLE sp_suivi (
  id TEXT PRIMARY KEY,
  obligation_id TEXT NOT NULL REFERENCES sp_obligations (id) ON DELETE CASCADE,
  periode TEXT NOT NULL,
  fait INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  rappel_le TEXT,
  maj_par TEXT,
  maj_le TEXT NOT NULL,
  UNIQUE (obligation_id, periode)
);

-- 7. Contacts (DONNÉES PERSONNELLES : export et effacement par adresse, voir sponsors/rgpd.mjs) d'un prospect
--    ou d'un partenaire. `reseaux` : JSON de liens ou pseudos.
CREATE TABLE sp_contacts (
  id TEXT PRIMARY KEY,
  prospect_id TEXT,
  partenaire_id TEXT,
  nom TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  telephone TEXT NOT NULL DEFAULT '',
  reseaux TEXT NOT NULL DEFAULT '[]',
  principal INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL
);
CREATE INDEX sp_contacts_prospect ON sp_contacts (prospect_id);
CREATE INDEX sp_contacts_partenaire ON sp_contacts (partenaire_id);
CREATE INDEX sp_contacts_email ON sp_contacts (email);

-- 8. Historique des échanges (appel, e-mail, réunion, note) d'un prospect ou d'un partenaire.
CREATE TABLE sp_echanges (
  id TEXT PRIMARY KEY,
  prospect_id TEXT,
  partenaire_id TEXT,
  contact_id TEXT,
  genre TEXT NOT NULL CHECK (genre IN ('appel', 'email', 'reunion', 'note')),
  date TEXT NOT NULL,
  resume TEXT NOT NULL DEFAULT '',
  auteur_id TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  supprime_le TEXT
);
CREATE INDEX sp_echanges_prospect ON sp_echanges (prospect_id, date);
CREATE INDEX sp_echanges_partenaire ON sp_echanges (partenaire_id, date);

-- 9. Pièces jointes (deck, proposition, contrat, logo, facture…) : fichier déposé (stockage privé, table
--    `cm_fichiers`, portée « sponsors ») ou lien https.
CREATE TABLE sp_pieces (
  id TEXT PRIMARY KEY,
  prospect_id TEXT,
  partenaire_id TEXT,
  contrat_id TEXT,
  genre TEXT NOT NULL CHECK (genre IN ('fichier', 'lien')),
  categorie TEXT NOT NULL DEFAULT 'autre' CHECK (categorie IN ('deck', 'proposition', 'contrat', 'logo', 'facture', 'autre')),
  nom TEXT NOT NULL,
  url TEXT,
  fichier_id TEXT,
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  supprime_le TEXT
);
CREATE INDEX sp_pieces_prospect ON sp_pieces (prospect_id);
CREATE INDEX sp_pieces_partenaire ON sp_pieces (partenaire_id);

-- 10. Étapes par défaut du pipeline.
INSERT INTO sp_etapes (id, cle, nom, issue, couleur, position, cree_le, maj_le) VALUES ('sp-etape-a-contacter', 'a_contacter', NULL, 'ouverte', '#8590a2', 1024, '2026-10-27T00:00:00.000Z', '2026-10-27T00:00:00.000Z');
INSERT INTO sp_etapes (id, cle, nom, issue, couleur, position, cree_le, maj_le) VALUES ('sp-etape-contacte', 'contacte', NULL, 'ouverte', '#579dff', 2048, '2026-10-27T00:00:00.000Z', '2026-10-27T00:00:00.000Z');
INSERT INTO sp_etapes (id, cle, nom, issue, couleur, position, cree_le, maj_le) VALUES ('sp-etape-discussion', 'discussion', NULL, 'ouverte', '#6cc3e0', 3072, '2026-10-27T00:00:00.000Z', '2026-10-27T00:00:00.000Z');
INSERT INTO sp_etapes (id, cle, nom, issue, couleur, position, cree_le, maj_le) VALUES ('sp-etape-proposition', 'proposition', NULL, 'ouverte', '#9f8fef', 4096, '2026-10-27T00:00:00.000Z', '2026-10-27T00:00:00.000Z');
INSERT INTO sp_etapes (id, cle, nom, issue, couleur, position, cree_le, maj_le) VALUES ('sp-etape-negociation', 'negociation', NULL, 'ouverte', '#faa53d', 5120, '2026-10-27T00:00:00.000Z', '2026-10-27T00:00:00.000Z');
INSERT INTO sp_etapes (id, cle, nom, issue, couleur, position, cree_le, maj_le) VALUES ('sp-etape-signe', 'signe', NULL, 'gagnee', '#4bce97', 6144, '2026-10-27T00:00:00.000Z', '2026-10-27T00:00:00.000Z');
INSERT INTO sp_etapes (id, cle, nom, issue, couleur, position, cree_le, maj_le) VALUES ('sp-etape-perdu', 'perdu', NULL, 'perdue', '#f87462', 7168, '2026-10-27T00:00:00.000Z', '2026-10-27T00:00:00.000Z');

-- 11. Le rôle système « Responsable CM » reçoit les deux permissions Sponsors (modifiable par le Fondateur,
--     « Rétablir » les remet). Le « Correspondant CM » ne les a pas.
INSERT INTO cm_role_permissions (role_id, permission) SELECT id, 'sponsors.voir' FROM cm_roles WHERE cle_systeme = 'responsable'
  ON CONFLICT (role_id, permission) DO NOTHING;
INSERT INTO cm_role_permissions (role_id, permission) SELECT id, 'sponsors.gerer' FROM cm_roles WHERE cle_systeme = 'responsable'
  ON CONFLICT (role_id, permission) DO NOTHING;
