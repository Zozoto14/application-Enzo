/**
 * Rappels J-1 et H-1 des événements du planning pour Discord (cron).
 *
 * Comme les rappels de présence (planning/rappels.mjs), le cron ne parle pas
 * à Discord : il publie l'événement de domaine `event.reminder_d1` ou
 * `event.reminder_h1` dans l'outbox ; l'abonné Discord (file.mjs) en fait un
 * message si la team l'a activé. Une seule fois par occurrence et par rappel
 * (`discord_rappels`, clé primaire).
 *
 * Le cron passe toutes les 15 minutes : le rappel part au premier passage
 * après le seuil. H-1 : l'événement commence dans moins d'1 h. J-1 : dans
 * moins de 24 h mais plus de 2 h (un événement ajouté la veille au soir n'a pas
 * de « J-1 » qui ferait doublon avec H-1).
 *
 * Seuls les CONVOQUÉS sont rappelés : leurs pseudos remplissent la variable
 * {convoques} du message. Discord ne permet ici qu'une mention de RÔLE (pas de
 * mention par personne, faute d'identifiant Discord des membres) : la mention
 * configurée reste celle de la team ; le message nomme les convoqués.
 */

import { evenement } from '../evenements.mjs';
import { servicesPlanning } from '../planning/service.mjs';
import { iso } from '../outils.mjs';
import { evenementDiscord } from './catalogue.mjs';
import { modulesActifs, reglageEffectif } from './file.mjs';

const HEURE = 3_600_000;

/** Rend le nombre de rappels publiés. */
export async function rappelsDiscord(base, { maintenant = Date.now(), limite = 200 } = {}) {
  const teams = await base.tous(
    `SELECT t.id FROM teams t
       JOIN discord_webhooks w ON w.team_id = t.id
      WHERE t.supprimee_le IS NULL AND t.archivee_le IS NULL`,
    [],
  );
  const s = servicesPlanning({ base, maintenant: () => maintenant, noyau: { contexteTeam: null, exiger: null } });
  let publies = 0;
  for (const { id: teamId } of teams) {
    const actifs = await modulesActifs(base, teamId);
    if (!actifs.has('discord') || !actifs.has('planning')) continue;
    const lignes = await base.tous("SELECT cle, actif, modele, role_mention FROM discord_notification_settings WHERE team_id = ? AND cle IN ('reminder_d1', 'reminder_h1')", [teamId]);
    const permis = genre => reglageEffectif(evenementDiscord(`reminder_${genre}`), lignes.find(l => l.cle === `reminder_${genre}`)).actif;
    const genres = ['d1', 'h1'].filter(permis);
    if (genres.length === 0) continue;
    const proches = (await s.occurrencesTeam(teamId, maintenant, maintenant + 24 * HEURE)).filter(({ o }) => o.debut > maintenant);
    const membres = proches.length > 0 ? await s.membresActifs(teamId) : [];
    for (const { ev, o } of proches) {
      // Les CONVOQUÉS seulement : leur liste part dans le message ({convoques}) ; personne de convoqué, pas de rappel.
      const convoques = s.roster(membres, ev, o);
      if (convoques.length === 0) continue;
      const reste = o.debut - maintenant;
      for (const genre of genres) {
        const horsFenetre = genre === 'h1' ? reste > HEURE : reste > 24 * HEURE || reste <= 2 * HEURE;
        if (horsFenetre) continue;
        try {
          await base.lot([
            { sql: 'INSERT INTO discord_rappels (evenement_id, occurrence, genre, team_id, cree_le) VALUES (?, ?, ?, ?, ?)', params: [ev.id, o.cle, genre, teamId, iso(maintenant)] },
            evenement(`event.reminder_${genre}`, {
              teamId,
              acteur: null,
              entiteType: 'evenement',
              entiteId: ev.id,
              charge: { evenementId: ev.id, occurrence: o.cle, titre: o.titre ?? ev.titre, type: ev.type, debut: iso(o.debut), convoques: convoques.map(m => m.compte) },
              maintenant,
            }),
          ]);
          publies++;
        } catch (e) {
          // Rappel déjà publié (clé primaire) : normal, on passe. Toute autre erreur remonte.
          if (!/UNIQUE|PRIMARY|constraint/i.test(String(e?.message ?? e))) throw e;
        }
        if (publies >= limite) return publies;
      }
    }
  }
  return publies;
}
