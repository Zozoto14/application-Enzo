/**
 * Activité réseau de Tsuzuku (pages des sources, catalogue) : combien de
 * requêtes sont en vol, et depuis quand c'est calme. Le cache du profil attend
 * le calme pour écrire la base chiffrée (une écriture bloque le fil principal
 * un instant : jamais pendant qu'un résultat arrive).
 */

let enVol = 0;
let derniereFin = 0;

export function debutActivite(): void {
  enVol += 1;
}

export function finActivite(maintenant = Date.now()): void {
  enVol = Math.max(0, enVol - 1);
  derniereFin = maintenant;
}

/** Vrai si aucune requête n'est en vol depuis `depuisMs`. */
export function reseauCalme(depuisMs = 400, maintenant = Date.now()): boolean {
  return enVol === 0 && maintenant - derniereFin >= depuisMs;
}

/** Tests. */
export function reinitialiserActivite(): void {
  enVol = 0;
  derniereFin = 0;
}
