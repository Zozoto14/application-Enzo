-- Esport, migration 0060 : salons vocaux temporaires (« rejoindre pour créer ») du bot Esport HQ
-- (docs/esport/vocaux.md).
--
-- Demande du Fondateur : rejoindre un salon vocal « hub » (ex. « Créer un salon ») crée un salon vocal juste en
-- dessous, au nom du membre (« Salon de {pseudo} »), où il est déplacé et dont il devient propriétaire : panneau de
-- contrôle (renommer, verrouiller, limite, expulser, liste d'amis, transférer), salon supprimé une fois vide.
--
-- Réglages : `tickets_reglages`, clés 'vocaux' (hubs, rôles du staff, délai de suppression…) et 'vocaux_commandes'
-- (commandes /voc activées et rôles autorisés) — aucune table de réglages nouvelle.
-- `vocaux_salons` : un salon temporaire existant sur Discord (propriétaire, verrouillage, limite, liste d'amis,
--   personnes présentes, surcharges héritées du hub) : un redémarrage retrouve les salons, supprime ceux qui sont
--   vides et resynchronise les propriétaires. `tournoi_id` / `equipe_id` : salon d'une équipe d'un tournoi (hub de
--   tournoi, verrouillé sur le rôle de l'équipe).
--
-- Permission du club `vocaux.configurer` (catalogue.json) : le Fondateur l'a d'office, le Second CEO la reçoit.
--
-- SQL standard (PostgreSQL et SQLite).

CREATE TABLE vocaux_salons (
  salon_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  hub_id TEXT NOT NULL,
  proprietaire_id TEXT,
  proprietaire_nom TEXT NOT NULL DEFAULT '',
  nom TEXT NOT NULL DEFAULT '',
  verrouille INTEGER NOT NULL DEFAULT 0,
  limite INTEGER NOT NULL DEFAULT 0,
  -- JSON : [discordId] (liste d'amis : entrent même verrouillé) ; [{ id, nom }] (personnes présentes).
  amis TEXT NOT NULL DEFAULT '[]',
  occupants TEXT NOT NULL DEFAULT '[]',
  -- JSON : surcharges de permissions du hub (ou de la catégorie) au moment de la création, base des verrouillages.
  base_permissions TEXT NOT NULL DEFAULT '[]',
  panneau_id TEXT,
  tournoi_id TEXT,
  equipe_id TEXT,
  -- Vide depuis (suppression après le délai réglé) ; NULL : quelqu'un est dedans.
  vide_depuis TEXT,
  cree_le TEXT NOT NULL,
  maj_le TEXT NOT NULL
);

CREATE INDEX vocaux_salons_proprietaire ON vocaux_salons (proprietaire_id);
CREATE INDEX vocaux_salons_equipe ON vocaux_salons (equipe_id);

-- Second CEO : configuration des salons vocaux par défaut (le Fondateur peut la lui retirer).
INSERT INTO roles_globaux_permissions (role_id, permission) SELECT id, 'vocaux.configurer' FROM roles_globaux WHERE id = 'role-global-second-ceo';
