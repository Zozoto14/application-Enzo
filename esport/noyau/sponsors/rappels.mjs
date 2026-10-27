/**
 * Sponsors : rappels (tâche cron, toutes les 5 minutes). Chaque rappel est posé UNE fois (marque en base,
 * réclamée par un UPDATE conditionnel : deux passages simultanés n'envoient rien en double), puis devient un
 * événement `sponsors.rappel_*` que bus.mjs transforme en notification (et donc en ligne du récapitulatif
 * e-mail) pour le responsable, ou à défaut pour les gestionnaires de la rubrique.
 *
 *  - prochaine action d'un prospect : le jour prévu (heure de Paris), pour un prospect encore « ouvert » ;
 *  - contrepartie : `rappel_jours` avant la fin de la période en cours si elle n'est pas atteinte ;
 *  - contrat actif : `preavis_jours` avant sa fin (30 par défaut).
 */

import { evenement } from '../evenements.mjs';
import { iso, nouvelId } from '../outils.mjs';
import { ajouterJours, ecartJours, jourDans } from './regles.mjs';
import { servicesSponsors } from './service.mjs';

export async function rappelsSponsors(base, { maintenant = Date.now(), limite = 200 } = {}) {
  const aujourd = jourDans(maintenant);
  const t = iso(maintenant);
  let poses = 0;
  const lot = [];
  const rappel = (type, entiteType, entiteId, charge) => lot.push(evenement(type, { teamId: null, acteur: null, entiteType, entiteId, charge, maintenant }));

  // 1. Prochaines actions (filtre large en SQL : jusqu'à demain en UTC ; précis ensuite).
  const actions = await base.tous(
    `SELECT p.id, p.nom, p.prochaine_action, p.prochaine_action_le, p.responsable_id, e.issue FROM sp_prospects p JOIN sp_etapes e ON e.id = p.etape_id
      WHERE p.supprime_le IS NULL AND p.prochaine_action_le IS NOT NULL AND p.rappel_envoye_le IS NULL AND p.prochaine_action_le <= ?
      ORDER BY p.prochaine_action_le LIMIT ?`,
    [new Date(maintenant + 2 * 86_400_000).toISOString(), limite],
  );
  for (const p of actions) {
    if (jourDans(Date.parse(p.prochaine_action_le)) > aujourd) continue;
    const r = await base.executer('UPDATE sp_prospects SET rappel_envoye_le = ? WHERE id = ? AND rappel_envoye_le IS NULL', [t, p.id]);
    if (r.changements !== 1 || p.issue !== 'ouverte') continue;
    rappel('sponsors.rappel_action', 'sp_prospect', p.id, { titre: p.nom, action: p.prochaine_action, quand: p.prochaine_action_le, responsable: p.responsable_id ?? null });
    poses++;
  }

  // 2. Contreparties dont la période en cours se termine bientôt sans être atteinte.
  const obligations = await base.tous(
    `SELECT o.*, p.nom AS partenaire_nom FROM sp_obligations o JOIN sp_partenaires p ON p.id = o.partenaire_id AND p.supprime_le IS NULL AND p.statut = 'actif'
      WHERE o.supprime_le IS NULL AND o.archive_le IS NULL AND o.debut <= ? AND (o.fin IS NULL OR o.fin >= ?) LIMIT 2000`,
    [aujourd, aujourd],
  );
  if (obligations.length) {
    const av = await servicesSponsors({ base, maintenant: () => maintenant }).avancement(obligations, aujourd, { historique: 1 });
    for (const o of obligations) {
      const c = av.get(o.id)?.courante;
      if (!c || c.etat !== 'a_faire' || ecartJours(aujourd, c.fin) > Number(o.rappel_jours)) continue;
      const deja = await base.premier('SELECT rappel_le FROM sp_suivi WHERE obligation_id = ? AND periode = ?', [o.id, c.cle]);
      if (deja?.rappel_le) continue;
      const r = deja
        ? await base.executer('UPDATE sp_suivi SET rappel_le = ? WHERE obligation_id = ? AND periode = ? AND rappel_le IS NULL', [t, o.id, c.cle])
        : await base.executer('INSERT INTO sp_suivi (id, obligation_id, periode, fait, note, rappel_le, maj_le) VALUES (?, ?, ?, 0, ?, ?, ?) ON CONFLICT (obligation_id, periode) DO NOTHING', [nouvelId(), o.id, c.cle, '', t, t]);
      if (r.changements !== 1) continue;
      rappel('sponsors.rappel_obligation', 'sp_obligation', o.id, { titre: o.partenaire_nom, partenaire: o.partenaire_id, intitule: o.intitule, periode: c.cle, fin: c.fin, fait: c.fait, quantite: c.quantite, responsable: o.responsable_id ?? null });
      poses++;
    }
  }

  // 3. Contrats actifs qui arrivent à leur fin (préavis).
  const contrats = await base.tous(
    `SELECT c.id, c.fin, c.preavis_jours, c.renouvellement, c.partenaire_id, p.nom, p.responsable_id FROM sp_contrats c JOIN sp_partenaires p ON p.id = c.partenaire_id AND p.supprime_le IS NULL
      WHERE c.supprime_le IS NULL AND c.statut = 'actif' AND c.rappel_fin_le IS NULL AND c.fin >= ? LIMIT ?`,
    [ajouterJours(aujourd, -30), limite],
  );
  for (const c of contrats) {
    const preavis = Math.max(Number(c.preavis_jours), 7);
    if (ecartJours(aujourd, c.fin) > preavis) continue;
    const r = await base.executer('UPDATE sp_contrats SET rappel_fin_le = ? WHERE id = ? AND rappel_fin_le IS NULL', [t, c.id]);
    if (r.changements !== 1) continue;
    rappel('sponsors.rappel_contrat', 'sp_contrat', c.id, { titre: c.nom, partenaire: c.partenaire_id, fin: c.fin, renouvellement: c.renouvellement, responsable: c.responsable_id ?? null });
    poses++;
  }
  if (lot.length) await base.lot(lot);
  return { poses };
}
