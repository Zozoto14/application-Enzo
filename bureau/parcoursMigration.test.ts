/**
 * Parcours de connexion du bureau (Electron comme site : seul le `Stockage`
 * change) sur les fichiers d'un appareil mis à jour depuis 14a6bea :
 * liste des profils + coffre de l'administrateur historique, tels que cette
 * version les a écrits.
 *
 * Rejoue les étapes de `bureau/index.tsx` : lecture de l'annuaire → écran de
 * connexion → prénom → session du compte trouvé → déverrouillage avec les
 * identifiants d'avant → migration et prénom adopté → hub avec ses tuiles →
 * relance : le prénom mène directement au compte, les inconnus au leurre.
 */

import { hexToBytes } from '@noble/hashes/utils.js';
import { appsVisibles } from '../src/hub/permissions';
import { ID_ADMINISTRATION, ID_PORTEFEUILLE, REGISTRE } from '../src/hub/registre';
import type { ContexteHub } from '../src/hub/types';
import {
  COFFRE_ADMIN_14A6BEA,
  ID_AMIE_14A6BEA,
  MOT_DE_PASSE_ADMIN,
  PROFILS_14A6BEA,
  SECRET_TOTP_ADMIN,
} from '../src/profils/__fixtures__/ancienneVersion';
import { aDesAmis, adopterPrenomAdmin, ecrireAnnuaire, lireAnnuaire, ouvrirAnnuaireAdmin, trouverCompte } from '../src/profils/annuaire';
import { ID_PRINCIPAL } from '../src/profils/profils';
import { codeTotp } from '../src/securite/totp';
import { ouvrirSessionBureau } from './session';
import type { NomFichier, Stockage } from './stockage';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const initSqlJs = require('sql.js');

const encodeur = new TextEncoder();
const decodeur = new TextDecoder();

/** Dossier de données d'un appareil, en mémoire (même contrat qu'Electron et IndexedDB). */
function dossier(initial: Partial<Record<NomFichier, string>>): Stockage & { fichiers: Map<string, Uint8Array> } {
  const fichiers = new Map<string, Uint8Array>(Object.entries(initial).map(([nom, texte]) => [nom, encodeur.encode(texte as string)]));
  return {
    fichiers,
    surDisque: true,
    lire: async nom => fichiers.get(nom),
    ecrire: async (nom, octets) => {
      fichiers.set(nom, octets);
    },
    emplacement: async () => 'mémoire',
  };
}

async function lireAnnuaireDe(stockage: Stockage) {
  const brut = await stockage.lire('profils');
  return lireAnnuaire(brut && brut.length > 0 ? decodeur.decode(brut) : undefined);
}

describe('parcours : administrateur historique après la mise à jour', () => {
  it('prénom → mot de passe + code d’avant → hub avec tuiles ; puis relance', async () => {
    const fabrique = await initSqlJs();
    const stockage = dossier({ profils: PROFILS_14A6BEA, coffre: COFFRE_ADMIN_14A6BEA });

    // Démarrage : une amie existe, donc écran de connexion.
    const annuaire = await lireAnnuaireDe(stockage);
    expect(aDesAmis(annuaire)).toBe(true);

    // Il saisit son prénom — qu'aucune ancienne version ne lui a demandé.
    const compte = trouverCompte(annuaire, 'Enzo');
    expect(compte).toMatchObject({ id: ID_PRINCIPAL, admin: true, prenomAAdopter: 'Enzo' });

    // Son coffre historique, pas un leurre : ses identifiants l'ouvrent.
    const bureau = await ouvrirSessionBureau({ fabrique, stockage, profil: compte!.id, delaiEcriture: 0 });
    bureau.session.deverrouiller({ motDePasse: MOT_DE_PASSE_ADMIN, codeTotp: codeTotp(SECRET_TOTP_ADMIN, Date.now()) });
    expect(bureau.session.statut()).toBe('deverrouille');

    // Connexion notée : migration de l'annuaire et prénom adopté (onConnexion).
    const cles = { annuaire: hexToBytes(bureau.session.cleDerivee('annuaire')), sequestre: hexToBytes(bureau.session.cleDerivee('sequestre')) };
    const adopte = adopterPrenomAdmin(annuaire, compte!.prenomAAdopter!, cles);
    expect(adopte).toBeDefined();
    const vue = ouvrirAnnuaireAdmin(adopte!, cles);
    await stockage.ecrire('profils', encodeur.encode(ecrireAnnuaire(vue.annuaire)));

    // Hub de l'administrateur : Portefeuille + Administration.
    const contexte: ContexteHub = {
      profil: vue.profils[0],
      profils: { onCreerCompte: () => undefined, tous: vue.profils } as unknown as ContexteHub['profils'],
    };
    expect(vue.profils[0]).toMatchObject({ nom: 'Enzo', admin: true });
    expect(appsVisibles(REGISTRE, contexte).map(app => app.id)).toEqual([ID_PORTEFEUILLE, ID_ADMINISTRATION]);
    await bureau.vider();

    // Relance : le prénom est connu, l'amie aussi, un inconnu va au leurre.
    const relu = await lireAnnuaireDe(stockage);
    expect(relu.heritage).toBeUndefined();
    expect(trouverCompte(relu, 'enzo')).toEqual({ id: ID_PRINCIPAL, nom: 'Enzo', admin: true });
    expect(trouverCompte(relu, 'Léa')).toMatchObject({ id: ID_AMIE_14A6BEA, admin: false });
    expect(trouverCompte(relu, 'Paul')).toBeUndefined();
    // Le coffre historique n'a pas bougé.
    expect(decodeur.decode(stockage.fichiers.get('coffre'))).toBe(COFFRE_ADMIN_14A6BEA);
  }, 60_000);
});
