/**
 * Mises à jour JavaScript téléchargées depuis le site de secours.
 *
 * Le PC publie, avec le site, un paquet signé par la clé privée des mises à
 * jour (`maj/manifeste.json` et `maj/main.jsbundle`). L'app iPhone vérifie
 * de temps en temps s'il y a plus récent, télécharge, et installe par le
 * gestionnaire habituel : signature, empreinte et numéro de version sont
 * contrôlés avant d'écrire quoi que ce soit. La nouvelle version s'applique
 * à l'ouverture suivante, avec retour arrière automatique si elle plante.
 *
 * Réinstaller l'app par AltStore n'est donc nécessaire que pour une
 * modification du code natif — rare.
 */

import type { GestionnaireMiseAJour, SystemeFichiers } from './application';
import type { Manifeste } from './manifeste';

export type ResultatTelechargement =
  | { etat: 'a-jour'; version: number }
  | { etat: 'installee'; version: number; notes?: string }
  | { etat: 'refusee'; motif: string };

export async function telechargerMiseAJour({
  site,
  gestionnaire,
  fichiers,
  requete = fetch,
}: {
  site: string;
  gestionnaire: GestionnaireMiseAJour;
  fichiers: SystemeFichiers;
  requete?: typeof fetch;
}): Promise<ResultatTelechargement> {
  const reponse = await requete(`${site}/maj/manifeste.json`, { cache: 'no-store' } as RequestInit);
  if (!reponse.ok) {
    return { etat: 'refusee', motif: `Pas de mise à jour publiée sur le site (${reponse.status}).` };
  }
  const manifeste = (await reponse.json()) as Manifeste;
  const actuel = await gestionnaire.etat();
  if (!(manifeste.version > actuel.version)) {
    return { etat: 'a-jour', version: actuel.version };
  }

  const paquet = await requete(`${site}/maj/main.jsbundle`, { cache: 'no-store' } as RequestInit);
  if (!paquet.ok) {
    return { etat: 'refusee', motif: `Paquet indisponible (${paquet.status}).` };
  }
  const dossier = `${fichiers.dossierDocuments}/maj-telechargee`;
  await fichiers.creerDossier(dossier);
  await fichiers.ecrireBinaire(`${dossier}/main.jsbundle`, new Uint8Array(await paquet.arrayBuffer()));
  await fichiers.ecrireTexte(`${dossier}/manifeste.json`, JSON.stringify(manifeste));
  try {
    const verification = await gestionnaire.installer(`${dossier}/main.jsbundle`, `${dossier}/manifeste.json`);
    return verification.valide
      ? { etat: 'installee', version: manifeste.version, notes: manifeste.notes }
      : { etat: 'refusee', motif: verification.motif ?? 'Paquet refusé.' };
  } finally {
    await fichiers.supprimer(`${dossier}/main.jsbundle`).catch(() => undefined);
    await fichiers.supprimer(`${dossier}/manifeste.json`).catch(() => undefined);
  }
}
