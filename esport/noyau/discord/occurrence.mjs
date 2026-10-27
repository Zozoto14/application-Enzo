/**
 * Tout ce qu'il faut pour montrer UNE occurrence d'un événement sur Discord
 * (embed d'annonce, de rappel, de relance, réponse à /rsvp) : l'occurrence
 * effective (exceptions comprises), la team, les convoqués, les réponses, la
 * carte et l'adversaire. Lu au moment de l'envoi : les compteurs sont à jour.
 */

import { servicesPlanning } from '../planning/service.mjs';
import { convoquesEvenement, estReunionStaff, membresTeam } from './convoques.mjs';
import { carteDans, embedEvenement } from './embeds.mjs';
import { formaterDelai, formaterInstant } from './formats.mjs';

const JOUR = 86_400_000;

/** Contexte d'une occurrence, ou `null` (événement supprimé, occurrence annulée, team supprimée). */
export async function contexteOccurrence(base, teamId, evenementId, occurrenceIso, maintenant = Date.now()) {
  const cle = Date.parse(occurrenceIso);
  if (!Number.isFinite(cle)) return null;
  const team = await base.premier('SELECT id, nom, jeu, fuseau, logo_url FROM teams WHERE id = ? AND supprimee_le IS NULL AND archivee_le IS NULL', [teamId]);
  if (!team) return null;
  const p = servicesPlanning({ base, maintenant: () => maintenant, noyau: { contexteTeam: null, exiger: null } });
  const toutes = await p.occurrencesTeam(teamId, cle - 32 * JOUR, cle + 32 * JOUR);
  const trouve = toutes.find(({ ev, o }) => ev.id === evenementId && o.cle === new Date(cle).toISOString());
  if (!trouve) return null;
  const { ev, o } = trouve;
  const membres = await membresTeam(base, teamId);
  const convoques = await convoquesEvenement(base, teamId, ev, o, membres);
  const modules = new Set((await base.tous('SELECT module FROM team_modules WHERE team_id = ? AND active = 1', [teamId])).map(l => l.module));
  const presenceActive = modules.has('attendance');
  const lignes = presenceActive ? await base.tous('SELECT compte_id, rsvp FROM presences WHERE evenement_id = ? AND occurrence = ?', [ev.id, o.cle]) : [];
  const rsvpDe = new Map(lignes.map(l => [l.compte_id, l.rsvp]));
  const reponses = presenceActive
    ? {
        oui: lignes.filter(l => l.rsvp === 'oui').length,
        peut_etre: lignes.filter(l => l.rsvp === 'peut_etre').length,
        non: lignes.filter(l => l.rsvp === 'non').length,
        sans: convoques.filter(c => !rsvpDe.get(c.compte) || rsvpDe.get(c.compte) === 'sans_reponse').length,
      }
    : null;
  const sansReponse = presenceActive ? convoques.filter(c => !rsvpDe.get(c.compte) || rsvpDe.get(c.compte) === 'sans_reponse') : [];
  let adversaire = null;
  if (ev.adversaire_id && modules.has('scouting')) {
    const a = await base.premier('SELECT nom, logo_url FROM adversaires WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [ev.adversaire_id, teamId]);
    if (a) adversaire = { nom: a.nom, logo: a.logo_url ?? null };
  }
  const titre = o.titre ?? ev.titre;
  return {
    team: { id: team.id, nom: team.nom, fuseau: team.fuseau, logo: team.logo_url ?? null },
    ev,
    occurrence: { cle: o.cle, titre, type: ev.type, debut: o.debut, fin: o.fin, lieu: o.lieu ?? ev.lieu ?? '' },
    membres,
    convoques,
    sansReponse,
    rsvpDe,
    reponses,
    presenceActive,
    modules,
    // Vignette d'une map citée : maps Valorant seulement (images Riot) ; aucune pour une team d'un autre jeu.
    carte: team.jeu === 'valorant' ? carteDans(titre, o.lieu ?? ev.lieu, o.description ?? ev.description) : null,
    adversaire,
    staff: estReunionStaff(ev, membres, o),
    termine: o.fin <= maintenant,
  };
}

/** Variables des modèles de messages pour une occurrence (titre, type, date, heure, délai, membres sans réponse). */
export function variablesOccurrence(c, maintenant, libelleType, langue = 'fr') {
  const quand = formaterInstant(c.team.fuseau, new Date(c.occurrence.debut).toISOString(), langue);
  return {
    team: c.team.nom,
    titre: c.occurrence.titre,
    type: libelleType(c.occurrence.type, langue),
    ...quand,
    delai: formaterDelai(c.occurrence.debut - maintenant, langue),
    membre: c.sansReponse.map(m => m.pseudo).join(', '),
    convoques: c.convoques.map(m => m.pseudo).join(', '),
  };
}

/** Embed d'une occurrence (genre : event_created, reminder_d1…). */
export function embedOccurrence(c, { genre, texte = '', lien = '', maintenant = Date.now(), langue = 'fr' }) {
  return embedEvenement({ genre, occurrence: c.occurrence, team: c.team, carte: c.carte, adversaire: c.adversaire, convoques: c.convoques, reponses: c.reponses, texte, lien, maintenant, langue });
}
