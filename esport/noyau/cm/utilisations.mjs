/**
 * Fichiers de la section CM (`cm_fichiers`) partagés entre plusieurs usages : pièce jointe d'une carte, clip,
 * visuel généré, image importée dans l'éditeur, pièce d'un sponsor, version d'un fichier du Drive (migration
 * 0027). Une même ligne peut servir à plusieurs (une pièce jointe choisie dans le Drive pointe vers les octets
 * du Drive) : les octets ne sont effacés que quand PLUS RIEN ne s'en sert.
 */

import { iso } from '../outils.mjs';

/** Usages d'un fichier CM (hors Drive), du plus courant au plus rare. */
const USAGES_HORS_DRIVE = [
  'SELECT 1 AS x FROM cm_pieces WHERE fichier_id = ? AND supprime_le IS NULL',
  'SELECT 1 AS x FROM cm_clips WHERE fichier_id = ? AND supprime_le IS NULL',
  'SELECT 1 AS x FROM cm_visuels WHERE fichier_id = ? AND supprime_le IS NULL',
  'SELECT 1 AS x FROM cm_visuel_images WHERE fichier_id = ? AND supprime_le IS NULL',
  'SELECT 1 AS x FROM sp_pieces WHERE fichier_id = ? AND supprime_le IS NULL',
];

/** Le fichier sert-il ailleurs que dans le Drive ? */
export async function utiliseHorsDrive(base, fichierId) {
  for (const sql of USAGES_HORS_DRIVE) if (await base.premier(sql, [fichierId])) return true;
  return false;
}

/** Le fichier est-il une version d'un fichier du Drive (corbeille comprise) ? */
export async function utiliseParDrive(base, fichierId) {
  return Boolean(await base.premier('SELECT 1 AS x FROM cm_drive_versions WHERE fichier_id = ?', [fichierId]));
}

export async function fichierCmUtilise(base, fichierId) {
  return (await utiliseParDrive(base, fichierId)) || (await utiliseHorsDrive(base, fichierId));
}

/**
 * Efface les octets d'un fichier CM s'il ne sert plus à rien (la ligne reste, marquée supprimée).
 * `portee` : ne touche qu'aux fichiers de cette portée (rubrique Sponsors). Rend vrai si effacé.
 */
export async function effacerFichierCmSiOrphelin(base, stockage, fichierId, t, { portee } = {}) {
  if (!fichierId) return false;
  if (await fichierCmUtilise(base, fichierId)) return false;
  const f = await base.premier('SELECT * FROM cm_fichiers WHERE id = ? AND supprime_le IS NULL', [fichierId]);
  if (!f || (portee && f.portee !== portee)) return false;
  if (stockage) await stockage.supprimer(f.cle_stockage).catch(() => undefined);
  await base.executer('UPDATE cm_fichiers SET supprime_le = ? WHERE id = ? AND supprime_le IS NULL', [iso(t), f.id]);
  return true;
}
