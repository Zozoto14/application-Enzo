/**
 * Routes HTTP de la phase 4 (Discord), branchées par api.mjs. Session déjà
 * vérifiée ; appartenance, module `discord` et permission `discord.manage`
 * sont contrôlés dans service.mjs.
 *
 *   GET    /teams/:t/discord                     état : webhook MASQUÉ, réglages, derniers envois
 *   PUT    /teams/:t/discord/webhook             enregistrer / remplacer l'adresse ({ url })
 *   DELETE /teams/:t/discord/webhook             supprimer le webhook
 *   POST   /teams/:t/discord/test                envoyer un message de test
 *   PUT    /teams/:t/discord/langue              { langue } : langue d'un message unique (sans fil français)
 *   PUT    /teams/:t/discord/bilingue            { filFr } : anglais d'abord + fil français (défaut : oui)
 *   PUT    /teams/:t/discord/mp                  { relancesMp } : relances et messages d'un joueur seul par MP (défaut : oui)
 *   GET|POST /teams/:t/discord/testmp            tester les MP du bot : état (quota, membres, événements) / envoi aux membres choisis { comptes }
 *   POST   /teams/:t/discord/testmp/simulation   { evenementId, occurrence } : qui recevrait la relance (rien n'est envoyé)
 *   POST   /teams/:t/discord/testmp/relance      { evenementId, occurrence, compte } : relance de test à UN membre (rien n'est enregistré)
 *   PUT|PATCH /teams/:t/discord/parametres/:cle  { actif?, modele?, roleMention? }
 */

import { echec } from '../outils.mjs';
import { servicesDiscord } from './service.mjs';

export { servicesDiscord };

export async function routerDiscord(d, { methode: m, chemin, acteur, lireCorps }) {
  const r = /^\/teams\/([^/]+)\/discord(?:\/([a-z]+))?(?:\/([a-z_0-9]+))?$/.exec(chemin);
  if (!r) return undefined;
  const [, teamId, section, sousId] = r;
  if (!section && !sousId && m === 'GET') return d.etat(acteur, teamId);
  if (section === 'webhook' && !sousId) {
    if (m === 'PUT' || m === 'POST') return d.definirWebhook(acteur, teamId, await lireCorps());
    if (m === 'DELETE') return d.supprimerWebhook(acteur, teamId);
  }
  if (section === 'test' && !sousId && m === 'POST') return d.tester(acteur, teamId);
  if (section === 'testmp') {
    if (!sousId && m === 'GET') return d.etatTestMp(acteur, teamId);
    if (!sousId && m === 'POST') return d.testerMp(acteur, teamId, await lireCorps());
    if (sousId === 'simulation' && m === 'POST') return d.simulerRelance(acteur, teamId, await lireCorps());
    if (sousId === 'relance' && m === 'POST') return d.relanceTest(acteur, teamId, await lireCorps());
  }
  if (section === 'langue' && !sousId && (m === 'PUT' || m === 'PATCH')) return d.majLangue(acteur, teamId, await lireCorps());
  if (section === 'bilingue' && !sousId && (m === 'PUT' || m === 'PATCH')) return d.majBilingue(acteur, teamId, await lireCorps());
  if (section === 'mp' && !sousId && (m === 'PUT' || m === 'PATCH')) return d.majMp(acteur, teamId, await lireCorps());
  if (section === 'parametres' && sousId && (m === 'PUT' || m === 'PATCH')) return d.majParametre(acteur, teamId, sousId, await lireCorps());
  throw echec(404, 'route', 'Adresse inconnue.');
}
