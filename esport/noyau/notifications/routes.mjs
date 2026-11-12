/**
 * Routes du centre de notifications (docs/esport/notifications.md). Session obligatoire (api.mjs) ; chaque compte
 * ne lit et ne règle que les siennes. Rend `undefined` pour une adresse qui n'est pas la sienne.
 *
 *   GET  /notifications/centre       liste paginée (filtres : categories, team, auteur, du, au, nonLues, ordre, suite, limite)
 *   GET  /notifications/compteur     { nonLues }
 *   POST /notifications/centre/lues  { ids: [...] } ou { tout: true } → { nonLues }
 *   POST /notifications/cible        { cible } → { etat: 'ok' | 'supprime' | 'interdit', cible } (lien direct, cibles.mjs)
 *   GET  /notifications/preferences  { masquees, silencieuses, teams, typesMasques, types, categories }
 *   PUT  /notifications/preferences  { masquees?, silencieuses?, teams?, typesMasques? }
 */

export async function routesNotifications({ nc, acteur, chemin, methode, url, lireCorps, limite }) {
  if (chemin === '/notifications/centre' && methode === 'GET') return nc.liste(acteur, Object.fromEntries(url.searchParams));
  if (chemin === '/notifications/compteur' && methode === 'GET') return nc.compteur(acteur);
  if (chemin === '/notifications/centre/lues' && methode === 'POST') return nc.marquerLues(acteur, await lireCorps());
  if (chemin === '/notifications/cible' && methode === 'POST') return nc.verifier(acteur, await lireCorps());
  if (chemin === '/notifications/preferences') {
    if (methode === 'GET') return nc.preferences(acteur);
    if (methode === 'PUT') {
      await limite('profil', acteur.compte);
      return nc.changerPreferences(acteur, await lireCorps());
    }
  }
  return undefined;
}
