/**
 * Permissions du trombinoscope (migration 0030), sans dépendance : rôles de team (catalogue.json, groupe
 * « members ») et rôles CM (Équipe CM) les portent.
 */
export const PERMISSIONS_TROMBI = Object.freeze(['membres.trombi.voir', 'membres.trombi.editer']);
