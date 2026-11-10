/**
 * Libellé court d'un rôle pour le salon du staff (`{role}` du modèle « {role} — {pseudo} »), comme le serveur
 * (esport/noyau/evenements-club/staff-sup.mjs, `etiquetteRole`) : nom du rôle sans le nom de l'événement, sans symboles
 * décoratifs ni emoji, espaces réduits ; « Staff » s'il ne reste rien. Sert d'exemple dans les champs de libellé.
 */
export function etiquetteRole(nomRole: string, nomEvenement = ''): string {
  let s = String(nomRole ?? '');
  const evt = String(nomEvenement ?? '').trim();
  if (evt) s = s.replace(new RegExp(evt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
  s = s
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s'’-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s'’-]+|[\s'’-]+$/g, '')
    .trim();
  return s.slice(0, 40) || 'Staff';
}
