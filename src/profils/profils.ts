/**
 * Profils : plusieurs personnes sur le même appareil, chacune avec son
 * portefeuille, son mot de passe et son code d'authentification.
 *
 * Le profil principal est celui qui existait avant les profils : c'est
 * l'**administrateur**. Lui seul ajoute ou supprime un profil — depuis ses
 * Paramètres, donc déverrouillé. Il ne peut pas lire les autres : chaque
 * profil a son propre coffre, et son portefeuille est scellé par sa propre
 * clé.
 *
 * La liste ne contient que des prénoms et des identifiants : elle doit être
 * lisible avant tout déverrouillage, pour qu'on puisse choisir qui ouvre.
 */

export const ID_PRINCIPAL = 'principal';

export interface Profil {
  id: string;
  nom: string;
  admin: boolean;
  creeLe: string;
}

const PRINCIPAL: Profil = { id: ID_PRINCIPAL, nom: 'Moi', admin: true, creeLe: '' };
const MOTIF_ID = /^[a-z0-9]{6,16}$/;

/** Lit la liste enregistrée ; le profil principal y est toujours, en tête. */
export function lireProfils(brut: string | undefined): Profil[] {
  let lus: unknown = [];
  try {
    lus = brut ? JSON.parse(brut) : [];
  } catch {
    lus = [];
  }
  const liste = Array.isArray(lus) ? lus : [];
  const autres = liste
    .filter((p): p is Profil => !!p && typeof p.id === 'string' && p.id !== ID_PRINCIPAL && MOTIF_ID.test(p.id) && typeof p.nom === 'string')
    .map(p => ({ id: p.id, nom: p.nom, admin: false, creeLe: String(p.creeLe ?? '') }));
  const principal = liste.find(p => p?.id === ID_PRINCIPAL);
  return [{ ...PRINCIPAL, nom: typeof principal?.nom === 'string' ? principal.nom : PRINCIPAL.nom }, ...autres];
}

export function ecrireProfils(profils: readonly Profil[]): string {
  return JSON.stringify(profils.map(({ id, nom, creeLe }) => ({ id, nom, creeLe })));
}

export class ErreurProfil extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurProfil';
  }
}

export function ajouterProfil(
  profils: readonly Profil[],
  nom: string,
  id: string,
  maintenant: string,
): Profil[] {
  const propre = nom.trim().slice(0, 30);
  if (!propre) {
    throw new ErreurProfil('Donnez un prénom au profil.');
  }
  if (profils.some(p => p.nom.toLowerCase() === propre.toLowerCase())) {
    throw new ErreurProfil(`Un profil « ${propre} » existe déjà.`);
  }
  if (!MOTIF_ID.test(id)) {
    throw new ErreurProfil('Identifiant de profil invalide.');
  }
  return [...profils, { id, nom: propre, admin: false, creeLe: maintenant }];
}

export function supprimerProfil(profils: readonly Profil[], id: string): Profil[] {
  if (id === ID_PRINCIPAL) {
    throw new ErreurProfil('Le profil administrateur ne se supprime pas.');
  }
  return profils.filter(p => p.id !== id);
}

export function renommerProfil(profils: readonly Profil[], id: string, nom: string): Profil[] {
  const propre = nom.trim().slice(0, 30);
  if (!propre) {
    throw new ErreurProfil('Donnez un prénom au profil.');
  }
  return profils.map(p => (p.id === id ? { ...p, nom: propre } : p));
}

/** Fichiers d'un profil : ceux d'avant pour le principal, suffixés sinon. */
export function fichiersDuProfil(id: string): { coffre: string; portefeuille: string } {
  return id === ID_PRINCIPAL
    ? { coffre: 'coffre', portefeuille: 'portefeuille' }
    : { coffre: `coffre-${id}`, portefeuille: `portefeuille-${id}` };
}

/** Identifiant aléatoire de 10 caractères. */
export function nouvelIdentifiant(alea: (n: number) => Uint8Array): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(alea(10), octet => alphabet[octet % alphabet.length]).join('');
}
