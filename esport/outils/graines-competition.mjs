/**
 * Graines de développement des modules Tournois et Résultats (migration 0022) : un tournoi en cours
 * (roster, deux phases, un match joué avec son résultat détaillé, un match à venir relié au planning),
 * un tournoi terminé (classement final, gains) et deux résultats hors tournoi (match officiel, scrim
 * réservé au staff). Passe par les services (mêmes contrôles que l'app).
 */

import { servicesTournois } from '../noyau/competition/tournois.mjs';
import { servicesResultats } from '../noyau/competition/resultats.mjs';
import { servicesPlanning } from '../noyau/planning/service.mjs';

export async function semerCompetition(base, teamId, { maintenant = () => Date.now(), noyau }) {
  const planning = servicesPlanning({ base, maintenant, noyau });
  const tournois = servicesTournois({ base, maintenant, socle: noyau, planning });
  const resultats = servicesResultats({ base, maintenant, socle: noyau });
  const zed = { compte: 'zed12345', superAdmin: false };
  const jour = decalage => new Date(maintenant() + decalage * 86_400_000).toISOString().slice(0, 10);
  const { adversaire: nova } = await resultats.creerAdversaire(zed, teamId, { nom: 'Team Nova' });
  const { adversaire: orion } = await resultats.creerAdversaire(zed, teamId, { nom: 'Orion Esports' });
  const roster = { titulaires: ['lea12345', 'kai12345', 'ines1234', 'sam12345', 'max12345'], remplacants: ['tom12345'] };

  // Tournoi en cours : poules puis élimination directe.
  const enCours = (
    await tournois.creer(zed, teamId, {
      nom: 'Coupe d’automne',
      organisateur: 'Ligue Exemple',
      lien: 'https://tournois-exemple.fr/coupe-automne',
      formatCle: '5v5',
      bo: 3,
      debut: jour(-2),
      fin: jour(5),
      phases: [{ type: 'poules', nom: 'Poules' }, { type: 'simple', nom: 'Playoffs' }],
      frais: 25,
      cashprize: 1500,
    })
  ).tournoi;
  await tournois.changerRoster(zed, teamId, enCours.id, roster);
  await tournois.inscrire(zed, teamId, enCours.id);
  await tournois.modifier(zed, teamId, enCours.id, { statut: 'en_cours' });
  const joue = await tournois.ajouterMatch(zed, teamId, enCours.id, { phase: 'p1', tour: 'Poule A · J1', date: jour(-1), heure: '20:00', adversaires: [{ id: orion.id }] });
  await resultats.creer(zed, teamId, {
    tournoiMatchId: joue.match,
    manches: [
      { carteCle: 'ascent', nous: 13, eux: 8 },
      { carteCle: 'lotus', miTemps: [[6, 6], [6, 6]], prolongations: [2, 0] },
    ],
    joueurs: [
      { compte: 'lea12345', personnages: ['jett'], stats: { kills: 41, deaths: 30 } },
      { compte: 'kai12345', personnages: ['omen'] },
      { compte: 'ines1234', personnages: ['sova'] },
      { compte: 'sam12345', personnages: ['killjoy'] },
      { compte: 'max12345', personnages: ['kay-o'] },
    ],
    mvp: 'lea12345',
  });
  await tournois.ajouterMatch(zed, teamId, enCours.id, { phase: 'p2', tour: 'Quart de finale', date: jour(2), heure: '21:00', adversaires: [{ id: nova.id }] });

  // Tournoi terminé.
  const fini = (await tournois.creer(zed, teamId, { nom: 'Open d’été', formatCle: '5v5', bo: 1, debut: jour(-40), fin: jour(-39), phases: [{ type: 'suisse', nom: 'Suisse' }] })).tournoi;
  await tournois.changerRoster(zed, teamId, fini.id, roster);
  const m1 = await tournois.ajouterMatch(zed, teamId, fini.id, { phase: 'p1', tour: 'Ronde 1', adversaires: [{ id: nova.id }] });
  await tournois.modifierMatch(zed, teamId, fini.id, m1.match, { issue: 'defaite', scoreTexte: '9-13' });
  await tournois.modifier(zed, teamId, fini.id, { statut: 'termine', classementFinal: 5, participants: 32, gains: 0 });

  // Hors tournoi : un match officiel et un scrim réservé au staff.
  await resultats.creer(zed, teamId, { genre: 'officiel', date: `${jour(-9)} 18:00`, bo: 1, adversaires: [{ id: nova.id }], manches: [{ carteCle: 'bind', nous: 11, eux: 13 }] });
  await resultats.creer(zed, teamId, { genre: 'scrim', date: `${jour(-4)} 21:00`, bo: 3, adversaires: [{ id: orion.id }], manches: [{ carteCle: 'haven', nous: 13, eux: 6 }, { carteCle: 'split', nous: 13, eux: 10 }], visibilite: 'staff' });
}
