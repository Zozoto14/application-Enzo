/**
 * Relais en service sur cet appareil, connu hors de React.
 *
 * Le site de secours fait passer Yahoo et les médias par le relais : un
 * navigateur n'a pas le droit de les appeler lui-même. Le détour est posé
 * sur `fetch` avant même le déverrouillage, alors que la configuration vit
 * dans la base chiffrée ; ce petit registre fait le lien.
 */

export interface RelaisActif {
  relais: string;
  jeton: string;
}

let actif: RelaisActif | undefined;

export function definirRelaisActif(relais: RelaisActif | undefined): void {
  actif = relais;
}

export function relaisActif(): RelaisActif | undefined {
  return actif;
}
