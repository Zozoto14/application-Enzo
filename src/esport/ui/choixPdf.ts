/**
 * Choix d'un PDF sur l'appareil. Sur iPhone et iPad (app native), pas de
 * sélecteur de fichiers intégré : `undefined` (l'interface invite à déposer
 * le PDF depuis le PC ou le site). La version web est dans `choixPdf.web.ts`.
 */

export interface PdfChoisi {
  octets: ArrayBuffer;
  nom: string;
  taille: number;
}

export const choixPdfDisponible = false;

export async function choisirPdf(): Promise<PdfChoisi | undefined> {
  return undefined;
}
