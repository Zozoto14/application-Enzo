/**
 * Rendu d'un visuel en image sur le site et l'app PC : Konva (rendu.web.ts) chargé à la demande, polices
 * embarquées, images lues par lien signé. Le PNG / JPEG fait exactement la taille du format.
 */

import { obtenirAssets } from '../../ui/strats/commun';
import type { OptionsRendu } from './generation';
import { planifier } from './plan';

export const renduDisponible = true;

type ModuleRendu = typeof import('./rendu.web');
let module: Promise<ModuleRendu> | undefined;
const chargerModule = (): Promise<ModuleRendu> => (module ??= import('./rendu.web'));

const chargeurs = new WeakMap<object, ReturnType<ModuleRendu['creerChargeurImages']>>();

/** Chargeur d'images (un par client : les liens signés et le cache vont avec le serveur). */
function chargeurDe(m: ModuleRendu, o: OptionsRendu) {
  let c = chargeurs.get(o.api);
  if (!c) {
    c = m.creerChargeurImages({ lienFichier: async id => (await o.api.lienFichier(id)).url, assets: () => obtenirAssets().catch(() => undefined) });
    chargeurs.set(o.api, c);
  }
  return c;
}

export async function rendreImage(o: OptionsRendu): Promise<Blob | null> {
  const m = await chargerModule();
  const plan = planifier(o.document, o.charte, o.donnees, o.langue);
  return m.rendreBlob(plan, await m.chargerImages(plan, chargeurDe(m, o)), o.type ?? 'png');
}

/** File d'attente des miniatures (une à la fois : la page reste fluide). */
let file: Promise<unknown> = Promise.resolve();

export function rendreMiniature(o: OptionsRendu, largeur = 320): Promise<string | null> {
  const travail = file.then(async () => {
    const m = await chargerModule();
    const plan = planifier(o.document, o.charte, o.donnees, o.langue);
    return m.rendreMiniature(plan, await m.chargerImages(plan, chargeurDe(m, o)), largeur);
  });
  file = travail.catch(() => undefined);
  return travail.catch(() => null);
}
