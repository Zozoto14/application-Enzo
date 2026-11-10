-- Esport, migration 0069 : la Team CM s'appelle « CM du club » (docs/esport/cm.md, « Le CM du club, une team »).
--
-- Une seule entité : l'espace « CM du club » EST la team (plus de carte « Team CM » à côté de la tuile). Seuls le nom
-- et l'adresse courte changent (« cm-du-club » si elle est libre) ; identifiant, membres, rôles, Drive, tableaux,
-- planning restent tels quels. Rejouable sans effet : seule une team encore nommée « Team CM » est renommée (un nom
-- choisi depuis par le Fondateur est gardé). Même instruction dans la reprise d'esport/noyau/cm/teamCm.mjs.
--
-- SQL standard (PostgreSQL et SQLite).

-- Reprise (debut)
UPDATE teams SET nom = 'CM du club', slug = CASE WHEN EXISTS (SELECT 1 FROM teams x WHERE x.slug = 'cm-du-club' AND x.id <> '00000000-0000-4000-8000-00000000c0de') THEN slug ELSE 'cm-du-club' END WHERE id = '00000000-0000-4000-8000-00000000c0de' AND nom = 'Team CM';
-- Reprise (fin)
