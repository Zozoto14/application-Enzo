/**
 * Suivi des mises à jour du dashboard (docs/mises-a-jour.md) : routes branchées par api.mjs, après l'authentification.
 *
 *   GET   /deploiement            état : versions (site, serveur, relais), dernier déploiement, journal filtré, GitHub
 *   POST  /deploiement/verifier   « Vérifier maintenant » : drapeau lu par deployer.sh au prochain passage du cron
 *
 * Réservé au Fondateur et aux comptes à qui il confie la permission du club `deploiement.voir` (désactivée par
 * défaut, même pour le Second CEO) ; tout autre compte reçoit 404. Le service lui-même (lecture de fichiers,
 * GitHub) vit côté Node (esport/serveur/deploiement.mjs) : sans lui (serveur local, tests), 404 « indisponible ».
 */

import { aGlobale } from './roles/globales.mjs';
import { echec } from './outils.mjs';

export const PERMISSION_DEPLOIEMENT = 'deploiement.voir';

export async function routesDeploiement({ deploiement, base, acteur, chemin, methode: m, limite }) {
  if (chemin !== '/deploiement' && !chemin.startsWith('/deploiement/')) return undefined;
  if (!(await aGlobale(base, acteur, PERMISSION_DEPLOIEMENT))) throw echec(404, 'route', 'Adresse inconnue.');
  if (!deploiement) throw echec(404, 'deploiement-indisponible', 'Suivi des mises à jour indisponible sur ce serveur.');
  if (chemin === '/deploiement' && m === 'GET') return deploiement.etat();
  if (chemin === '/deploiement/verifier' && m === 'POST') {
    await limite('deploiement', acteur.compte);
    const r = await deploiement.demanderVerification();
    if (!r?.demande) throw echec(503, 'deploiement-drapeau', 'Impossible de déposer la demande de vérification (dossier ~/.appdashboard).');
    return r;
  }
  throw echec(404, 'route', 'Adresse inconnue.');
}
