/**
 * Graines de développement : une team Valorant avec ses membres, un rôle
 * personnalisé, quelques actions journalisées, et son planning (événements,
 * disponibilités, présences : graines-planning.mjs). Passe par les services
 * (mêmes règles que l'API : invitations réelles, anti-escalade…).
 *
 *   node esport/outils/graines.mjs [fichier.db]   (base SQLite locale, migrée au besoin)
 */

import { pathToFileURL } from 'node:url';
import { distribuer } from '../noyau/evenements.mjs';
import { servicesEsport } from '../noyau/service.mjs';
import { semerPlanning } from './graines-planning.mjs';

export const COMPTES_GRAINES = [
  { compte: 'max12345', pseudo: 'Max', riotId: 'Max#EUW', role: 'manager', poste: 'IGL' },
  { compte: 'zed12345', pseudo: 'Zed', role: 'coach' },
  { compte: 'ana12345', pseudo: 'Ana', role: 'analyste' },
  { compte: 'lea12345', pseudo: 'Léa', riotId: 'Lea#1234', discord: 'lea_val', role: 'joueur', poste: 'Duelliste' },
  { compte: 'kai12345', pseudo: 'Kai', role: 'joueur', poste: 'Contrôleur' },
  { compte: 'ines1234', pseudo: 'Inès', role: 'joueur', poste: 'Initiateur' },
  { compte: 'sam12345', pseudo: 'Sam', role: 'joueur', poste: 'Sentinelle' },
  { compte: 'tom12345', pseudo: 'Tom', role: 'remplacant', poste: 'Flex' },
];

/** Sème la base (vide ou non) ; rend l'identifiant de la team créée. */
export async function semer(base, { maintenant = () => Date.now() } = {}) {
  const s = servicesEsport({ base, maintenant, creationTeams: 'fondateur' });
  const fondateur = { compte: 'principal', superAdmin: true };
  await s.majProfil(fondateur, { pseudo: 'Fondateur' });
  const { team } = await s.creerTeam(fondateur, {
    nom: 'Faucons Valorant',
    jeu: 'valorant',
    preset: 'valorant_complet',
    description: 'Team de démonstration (graines de développement).',
  });
  const roles = Object.fromEntries((await s.listeRoles(fondateur, team.id)).map(r => [r.cle ?? r.nom, r]));
  for (const c of COMPTES_GRAINES) {
    const acteur = { compte: c.compte, superAdmin: false };
    await s.majProfil(acteur, { pseudo: c.pseudo, riotId: c.riotId, discord: c.discord });
    const { code } = await s.creerInvitation(fondateur, team.id, { roleId: roles[c.role].id, libelle: `Graine ${c.pseudo}` });
    await s.accepterInvitation(acteur, { code }, null);
    if (c.poste) {
      const membre = (await s.listeMembres(fondateur, team.id)).find(m => m.compte === c.compte);
      await s.modifierMembre(acteur, team.id, membre.id, { posteJeu: c.poste });
    }
  }
  await s.creerRole(fondateur, team.id, { nom: 'Capitaine', couleur: '#f59e0b', permissions: ['members.view', 'planning.view', 'planning.create', 'attendance.mark', 'attendance.rsvp_own', 'availability.edit_own'] });
  await s.creerInvitation(fondateur, team.id, { roleId: roles.joueur.id, libelle: 'Essai joueur', joursValidite: 7, utilisationsMax: 3 });
  await semerPlanning(base, team.id, { maintenant });
  await distribuer(base, { maintenant: maintenant() });
  return team.id;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { baseSqliteMigree } = await import('../adaptateurs/sqlite.mjs');
  const chemin = process.argv[2] ?? 'esport/esport-local.db';
  const base = await baseSqliteMigree(chemin);
  const id = await semer(base);
  console.log(`Graines posées dans ${chemin} : team « Faucons Valorant » (${id}), ${COMPTES_GRAINES.length + 1} membres.`);
}
