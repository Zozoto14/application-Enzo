/**
 * Événements du trombinoscope (SANS team : jamais dans le journal d'une team ; la charge ne porte que le compte
 * concerné et le nom des champs modifiés, jamais leur contenu). Notification « trombi-modifiee » au joueur quand
 * un autre (staff, CM, Fondateur) complète ou corrige sa fiche.
 *
 * Ce fichier n'importe pas evenements.mjs (c'est lui qui nous importe).
 */

import { jsonOu } from '../outils.mjs';

export const TYPES_TROMBI = ['trombi.fiche_modifiee', 'trombi.photo_modifiee', 'trombi.photo_supprimee'];

export async function abonneTrombi(base, ev) {
  if (!TYPES_TROMBI.includes(ev.type)) return;
  const charge = jsonOu(ev.charge, {});
  if (!charge.compte || charge.compte === ev.acteur_id) return;
  if (!(await base.premier('SELECT id FROM comptes WHERE id = ?', [charge.compte]))) return;
  await base.executer(
    'INSERT INTO notifications (id, compte_id, team_id, type, charge, cree_le) VALUES (?, ?, NULL, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
    [`${ev.id}:${charge.compte}`, charge.compte, 'trombi-modifiee', JSON.stringify({ membre: ev.acteur_id, photo: ev.type !== 'trombi.fiche_modifiee' }), ev.cree_le],
  );
}
