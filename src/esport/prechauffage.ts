/**
 * Préchauffage de l'Esport depuis le hub (docs/performance.md) : dès que le hub s'affiche pour un compte qui a
 * l'Esport, la session Esport est ouverte en arrière-plan (POST /session). Cela réveille le serveur Esport et le
 * relais s'ils dormaient (Passenger arrête une app sans requête : premier appel lent), et l'ouverture de l'Esport
 * n'attend plus ni l'adresse du serveur, ni la session, ni (dans les 30 s) le profil : il vient avec la session.
 * Silencieux : sans relais, hors ligne ou serveur absent, il ne se passe rien (l'Esport fera comme avant).
 */

import { trouverConfig } from './client';
import { fabrique } from './fabrique';

let enCours: Promise<void> | undefined;

export function prechaufferEsport(): Promise<void> {
  enCours ??= (async () => {
    try {
      const { config } = await trouverConfig(fabrique.relais());
      if (!config) return;
      await fabrique.client(config).jetonSession?.();
    } catch {
      // Rien : l'ouverture de l'Esport refera ces étapes et affichera l'erreur s'il y en a une.
    } finally {
      enCours = undefined;
    }
  })();
  return enCours;
}
