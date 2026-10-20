/**
 * Impression des notes en PDF : sans objet sur l'app iOS native (l'export
 * Markdown se partage à la place). Version web : `impression.web.ts`.
 */

export const impressionDisponible = false;

export async function imprimerNotes(_titre: string, _markdown: string): Promise<boolean> {
  return false;
}
