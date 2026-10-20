/** Choix d'un PDF sur le site et sur PC (champ de fichier du navigateur). */

export interface PdfChoisi {
  octets: ArrayBuffer;
  nom: string;
  taille: number;
}

export const choixPdfDisponible = true;

export function choisirPdf(): Promise<PdfChoisi | undefined> {
  return new Promise(resoudre => {
    const doc = (globalThis as { document?: Document }).document;
    if (!doc) {
      resoudre(undefined);
      return;
    }
    const champ = doc.createElement('input');
    champ.type = 'file';
    champ.accept = 'application/pdf,.pdf';
    champ.style.display = 'none';
    champ.setAttribute('data-testid', 'esport-pdf-champ');
    champ.addEventListener('change', () => {
      const f = champ.files?.[0];
      champ.remove();
      if (!f) {
        resoudre(undefined);
        return;
      }
      void f.arrayBuffer().then(octets => resoudre({ octets, nom: f.name, taille: f.size }));
    });
    champ.addEventListener('cancel', () => {
      champ.remove();
      resoudre(undefined);
    });
    doc.body.appendChild(champ);
    champ.click();
  });
}
