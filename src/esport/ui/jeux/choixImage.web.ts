/** Choix d'une image (fond de map) sur le site et sur PC : champ de fichier du navigateur, lu en base64. */

export interface ImageChoisie {
  type: string;
  /** Contenu en base64 (sans en-tête « data: »). */
  donnees: string;
  nom: string;
  taille: number;
}

export const choixImageDisponible = true;

export function choisirImage(): Promise<ImageChoisie | undefined> {
  return new Promise(resoudre => {
    const doc = (globalThis as { document?: Document }).document;
    if (!doc) {
      resoudre(undefined);
      return;
    }
    const champ = doc.createElement('input');
    champ.type = 'file';
    champ.accept = 'image/png,image/jpeg,image/webp';
    champ.style.display = 'none';
    champ.setAttribute('data-testid', 'esport-image-champ');
    champ.addEventListener('change', () => {
      const f = champ.files?.[0];
      champ.remove();
      if (!f) {
        resoudre(undefined);
        return;
      }
      const lecteur = new FileReader();
      lecteur.onload = () => {
        const url = String(lecteur.result ?? '');
        resoudre({ type: f.type, donnees: url.slice(url.indexOf(',') + 1), nom: f.name, taille: f.size });
      };
      lecteur.onerror = () => resoudre(undefined);
      lecteur.readAsDataURL(f);
    });
    champ.addEventListener('cancel', () => {
      champ.remove();
      resoudre(undefined);
    });
    doc.body.appendChild(champ);
    champ.click();
  });
}
