/**
 * Rappels de présence (cron) : pour chaque occurrence qui commence dans les
 * `rappelHeures` (réglage de la team, 24 h par défaut, 0 = jamais), chaque
 * joueur de la liste de présence qui n'a pas répondu reçoit UN rappel.
 *
 * Le rappel n'est pas envoyé d'ici : on publie l'événement de domaine
 * `attendance.reminder` dans l'outbox ; l'abonné des notifications in-app le
 * transforme en notification, et Discord (phase 4) s'y abonnera. Une seule
 * fois par joueur et par occurrence (`presences.rappel_le`).
 */

import { evenement } from '../evenements.mjs';
import { iso, jsonOu } from '../outils.mjs';
import { servicesPlanning } from './service.mjs';

/** Rend le nombre de rappels publiés. */
export async function rappelsPresence(base, { maintenant = Date.now(), limite = 500 } = {}) {
  const teams = await base.tous(
    `SELECT t.id FROM teams t
       JOIN team_modules a ON a.team_id = t.id AND a.module = 'attendance' AND a.active = 1
       JOIN team_modules p ON p.team_id = t.id AND p.module = 'planning' AND p.active = 1
      WHERE t.supprimee_le IS NULL AND t.archivee_le IS NULL`,
    [],
  );
  // Services sans contrôle d'accès : seules les lectures internes servent ici.
  const s = servicesPlanning({ base, maintenant: () => maintenant, noyau: { contexteTeam: null, exiger: null } });
  let envoyes = 0;
  for (const { id: teamId } of teams) {
    const { rappelHeures } = await s.reglages(teamId);
    if (!rappelHeures) continue;
    const a = (await s.occurrencesTeam(teamId, maintenant, maintenant + rappelHeures * 3_600_000)).filter(({ o }) => o.debut > maintenant);
    if (a.length === 0) continue;
    const membres = await s.membresActifs(teamId);
    for (const { ev, o } of a) {
      const lignes = await base.tous('SELECT compte_id, rsvp, rappel_le FROM presences WHERE evenement_id = ? AND occurrence = ?', [ev.id, o.cle]);
      const liste = s.roster(membres, ev, lignes.map(l => l.compte_id)).filter(m => m.a('attendance.rsvp_own'));
      for (const m of liste) {
        const l = lignes.find(x => x.compte_id === m.compte);
        if (l && (l.rsvp !== 'sans_reponse' || l.rappel_le)) continue;
        const t = iso(maintenant);
        await base.lot([
          {
            sql: `INSERT INTO presences (evenement_id, occurrence, compte_id, team_id, rappel_le, maj_le) VALUES (?, ?, ?, ?, ?, ?)
                  ON CONFLICT (evenement_id, occurrence, compte_id) DO UPDATE SET rappel_le = excluded.rappel_le`,
            params: [ev.id, o.cle, m.compte, teamId, t, t],
          },
          evenement('attendance.reminder', {
            teamId,
            acteur: null,
            entiteType: 'evenement',
            entiteId: ev.id,
            charge: { compte: m.compte, evenementId: ev.id, occurrence: o.cle, titre: o.titre ?? ev.titre, type: ev.type, debut: iso(o.debut), concernes: jsonOu(ev.concernes, []) },
            maintenant,
          }),
        ]);
        envoyes++;
        if (envoyes >= limite) return envoyes;
      }
    }
  }
  return envoyes;
}
