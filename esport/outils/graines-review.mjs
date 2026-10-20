/**
 * Graines de développement de la review vidéo et du scouting (phase 5) : deux
 * adversaires (joueurs, tendances, VODs), un match du planning lié à
 * l'un d'eux, une review avec des repères de chaque catégorie et des
 * commentaires. Passe par les services, comme l'API.
 */

import { servicesReview } from '../noyau/review/service.mjs';
import { servicesScouting } from '../noyau/scouting/service.mjs';
import { servicesPlanning } from '../noyau/planning/service.mjs';

export async function semerReview(base, teamId, { maintenant = () => Date.now(), noyau }) {
  const review = servicesReview({ base, maintenant, socle: noyau });
  const scouting = servicesScouting({ base, maintenant, socle: noyau, review });
  const planning = servicesPlanning({ base, maintenant, noyau });
  const coach = { compte: 'zed12345', superAdmin: false };
  const ana = { compte: 'ana12345', superAdmin: false };
  const lea = { compte: 'lea12345', superAdmin: false };
  const kai = { compte: 'kai12345', superAdmin: false };

  const nova = await scouting.creer(coach, teamId, { nom: 'Team Nova', logoUrl: null, notes: 'Équipe rapide, aime les rushs B. IGL : Phantom.' });
  const orion = await scouting.creer(ana, teamId, { nom: 'Orion Esports', notes: 'Jeu lent, beaucoup d’utilitaires.' });
  await scouting.ajouterJoueur(coach, teamId, nova.id, { pseudo: 'Phantom', riotId: 'Phantom#EUW', role: 'Duelliste', agents: ['Jett', 'Raze'], notes: 'Prend les premiers duels.' });
  await scouting.ajouterJoueur(coach, teamId, nova.id, { pseudo: 'Nyx', riotId: 'Nyx#0042', role: 'Contrôleur', agents: ['Omen', 'Viper'] });
  await scouting.ajouterTendance(coach, teamId, nova.id, { map: 'Ascent', side: 'attaque', notes: 'Rush B dès le début, exécute A en fin de round.', tauxVictoire: 58, compos: [['Jett', 'Sova', 'Omen', 'Killjoy', 'Sage']] });
  await scouting.ajouterTendance(coach, teamId, nova.id, { map: 'Bind', side: 'defense', notes: 'Stack B, rotation tardive.', tauxVictoire: 44 });
  await scouting.ajouterJoueur(ana, teamId, orion.id, { pseudo: 'Atlas', role: 'Sentinelle', agents: ['Cypher'] });
  const vod = await scouting.ajouterVod(coach, teamId, nova.id, { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', titre: 'Finale de ligue contre Nova' });
  await scouting.ajouterVod(coach, teamId, nova.id, { url: 'https://www.twitch.tv/videos/123456789', titre: 'Stream Twitch (non YouTube)' });

  // Un match déjà joué contre Nova, relié à sa fiche (historique des confrontations).
  const jour = (decalage) => new Date(maintenant() + decalage * 86_400_000).toISOString().slice(0, 10);
  await planning.creer(coach, teamId, { type: 'match', titre: 'Match de ligue vs Nova', date: jour(-9), heureDebut: '18:00', heureFin: '20:00', adversaireId: nova.id });
  await planning.creer(coach, teamId, { type: 'scrim', titre: 'Scrim vs Nova', date: jour(3), heureDebut: '21:00', heureFin: '23:00', adversaireId: nova.id });

  // La review de la VOD de Nova, avec des repères de chaque catégorie.
  const { reviewId } = await scouting.ouvrirVodEnReview(coach, teamId, nova.id, vod.id, {});
  const r = (acteur, corps) => review.ajouterRepere(acteur, teamId, reviewId, corps);
  const e1 = await r(coach, { debut: 83, categorie: 'erreur', titre: 'Peek trop large', note: 'Il fallait **jouer le trade** :\n- attendre Kai\n- ne pas relancer seul', cible: 'lea12345' });
  await r(coach, { debut: 154, duree: 12, categorie: 'bonne_action', titre: 'Clutch 1v2', note: 'Bon *timing* de défuse.', cible: 'kai12345' });
  await r(ana, { debut: 241, categorie: 'utilitaires', titre: 'Fumée trop tôt', note: 'Voir [la lineup](https://exemple.invalid/lineup).' });
  await r(ana, { debut: 398, categorie: 'placement', titre: 'Trois joueurs sur le même site', cible: 'sam12345' });
  await r(coach, { debut: 512, categorie: 'comms', titre: 'Appel tardif', note: 'Annoncer le rush **avant** le contact.' });
  await review.commenter(lea, teamId, reviewId, e1.id, { texte: 'Compris, je repasserai derrière Kai.' });
  await review.commenter(kai, teamId, reviewId, e1.id, { texte: 'Je confirme, j’étais en retard sur l’appel.' });
}
