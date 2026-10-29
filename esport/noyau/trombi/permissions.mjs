/**
 * Permissions du trombinoscope (migration 0030), sans dépendance : rôles de team (catalogue.json, groupe
 * « members ») et rôles CM (Équipe CM) les portent.
 */
export const PERMISSIONS_TROMBI = Object.freeze(['membres.trombi.voir', 'membres.trombi.editer']);

/**
 * Badges du trombinoscope (migration 0032) : gérer le catalogue du club (par une affectation CM « club ») et
 * attribuer / retirer les badges (club : tout le club ; rôle de team : les membres de cette team).
 */
export const PERMISSION_BADGES = 'membres.badges.gerer';
