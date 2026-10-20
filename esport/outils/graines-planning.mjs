/**
 * Graines de développement du planning (phase 2) : une série d'entraînements
 * (mardi et jeudi 20:00, commencée il y a trois semaines), un scrim, un match,
 * une réunion, un tournoi, des disponibilités, des réponses et des présences
 * marquées (statistiques non vides). Passe par les services, comme l'API.
 */

import { servicesEsport } from '../noyau/service.mjs';
import { servicesPlanning } from '../noyau/planning/service.mjs';
import { ajouterJours, dateLocale, lundiDe, texteDate } from '../noyau/planning/temps.mjs';

const FUSEAU = 'Europe/Paris';

export async function semerPlanning(base, teamId, { maintenant = () => Date.now() } = {}) {
  const noyau = servicesEsport({ base, maintenant, creationTeams: 'fondateur' });
  const p = servicesPlanning({ base, maintenant, noyau });
  const fondateur = { compte: 'principal', superAdmin: true };
  const coach = { compte: 'zed12345', superAdmin: false };
  const joueur = compte => ({ compte, superAdmin: false });
  const lundi = lundiDe(dateLocale(FUSEAU, maintenant()));
  const jour = n => texteDate(ajouterJours(lundi, n));
  // Les membres semés sont arrivés il y a un mois : ils sont convoqués (groupe « joueurs ») aux séances passées.
  await base.executer('UPDATE membres SET rejoint_le = ? WHERE team_id = ?', [new Date(maintenant() - 30 * 86_400_000).toISOString(), teamId]);

  const entrainement = await p.creer(coach, teamId, {
    type: 'training',
    titre: 'Entraînement',
    description: 'Échauffement aim, puis exécutions sur la map de la semaine.',
    lieu: 'Discord · salon Entraînement',
    date: jour(-20),
    heureDebut: '20:00',
    heureFin: '22:00',
    recurrence: { jours: [2, 4] },
  });
  await p.creer(coach, teamId, { type: 'scrim', titre: 'Scrim vs Nébuleuse', date: jour(2), heureDebut: '21:00', heureFin: '23:00', lieu: 'Lobby personnalisé' });
  await p.creer(coach, teamId, { type: 'match', titre: 'Match de ligue · J4', date: jour(5), heureDebut: '18:00', heureFin: '20:30', concernes: ['lea12345', 'kai12345', 'ines1234', 'sam12345', 'max12345'] });
  await p.creer(fondateur, teamId, { type: 'meeting', titre: 'Réunion hebdo', date: jour(6), heureDebut: '19:00', heureFin: '20:00', recurrence: { jours: [7], nombre: 8 } });
  await p.creer(fondateur, teamId, { type: 'tournament', titre: 'Coupe d’automne', date: jour(12), heureDebut: '14:00', heureFin: '21:00', lieu: 'https://exemple.invalid/coupe' });
  await p.creer(coach, teamId, { type: 'other', titre: 'Soirée cohésion', date: jour(9), heureDebut: '20:30', heureFin: '23:00' });

  // Disponibilités récurrentes des joueurs.
  const soirs = (debut, fin, jours = [1, 2, 3, 4, 5]) => jours.map(j => ({ jour: j, debut, fin }));
  await p.remplacerRegles(joueur('lea12345'), teamId, { regles: [...soirs('19:00', '23:00'), { jour: 6, debut: '14:00', fin: '20:00' }] });
  await p.remplacerRegles(joueur('kai12345'), teamId, { regles: soirs('20:00', '23:30') });
  await p.remplacerRegles(joueur('ines1234'), teamId, { regles: [...soirs('18:00', '22:00', [1, 2, 3, 4]), { jour: 7, debut: '15:00', fin: '19:00' }] });
  await p.remplacerRegles(joueur('sam12345'), teamId, { regles: [...soirs('20:00', '24:00', [2, 3, 4, 5]), { jour: 6, debut: '10:00', fin: '18:00' }] });
  await p.remplacerRegles(joueur('tom12345'), teamId, { regles: soirs('21:00', '23:00', [1, 3, 5]) });
  await p.ajouterException(joueur('kai12345'), teamId, { date: jour(3), heureDebut: '18:00', heureFin: '23:59', type: 'indisponible', note: 'Examen' });

  // Présences des entraînements passés, et quelques réponses pour les prochains.
  const t = maintenant();
  const passees = (await p.occurrencesTeam(teamId, t - 21 * 86_400_000, t)).filter(({ ev, o }) => ev.id === entrainement.id && o.fin <= t);
  const motifs = ['present', 'present', 'retard', 'present', 'absent', 'excuse'];
  for (const [i, { o }] of passees.entries()) {
    await p.marquer(coach, teamId, entrainement.id, o.cle, {
      marques: [
        { compte: 'lea12345', reel: 'present' },
        { compte: 'kai12345', reel: motifs[i % motifs.length], ...(motifs[i % motifs.length] === 'retard' ? { retardMinutes: 10 } : motifs[i % motifs.length] === 'excuse' ? { motif: 'Examen' } : {}) },
        { compte: 'ines1234', reel: i % 3 === 0 ? 'retard' : 'present', ...(i % 3 === 0 ? { retardMinutes: 5 + 5 * (i % 2) } : {}) },
        { compte: 'sam12345', reel: i % 4 === 1 ? 'absent' : 'present' },
        { compte: 'tom12345', reel: i % 2 === 0 ? 'excuse' : 'present', ...(i % 2 === 0 ? { motif: 'Travail' } : {}) },
      ],
    });
  }
  const prochaines = (await p.occurrencesTeam(teamId, t, t + 7 * 86_400_000)).filter(({ ev }) => ev.id === entrainement.id).slice(0, 2);
  for (const { o } of prochaines) {
    await p.repondre(joueur('kai12345'), teamId, entrainement.id, o.cle, { rsvp: 'oui' });
    await p.repondre(joueur('sam12345'), teamId, entrainement.id, o.cle, { rsvp: 'peut_etre' });
    await p.repondre(joueur('ines1234'), teamId, entrainement.id, o.cle, { rsvp: 'oui', retardPrevu: 15 });
    await p.repondre(joueur('tom12345'), teamId, entrainement.id, o.cle, { rsvp: 'non', motif: 'Déplacement' });
  }
  await p.changerReglages(fondateur, teamId, { effectifMin: 4, rappelHeures: 24 });
}
