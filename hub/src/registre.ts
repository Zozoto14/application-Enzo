/**
 * Registre des apps du hub.
 *
 * Le hub ne fournit qu'une app à lui, l'Administration. Les autres sont
 * enregistrées par l'application hôte :
 *
 *     const REGISTRE = creerRegistre([APP_PORTEFEUILLE, appAdministration({ QrCode })]);
 *
 * **Ajouter une app = ajouter une définition à cette liste** : identifiant,
 * nom, icône, teinte, information en direct et écran racine. Le hub en fait
 * une tuile, l'Administration une case d'autorisation, sans autre
 * modification.
 *
 * L'identifiant est enregistré dans les autorisations des profils : ne le
 * changez pas une fois l'app livrée (sinon, ajoutez l'ancien à `IDS_HERITES`).
 */

import React from 'react';
import { Administration } from './Administration';
import { infoAdministration } from './infos';
import type { AppHub, ComposantQrCode, PropsRacineApp } from './types';

export const ID_ADMINISTRATION = 'administration';

/** Format des identifiants d'app (autorisations, préférences). */
export const MOTIF_ID_APP = /^[a-z0-9-]{2,32}$/;

export interface ServicesAdministration {
  /** Affiche l'URI TOTP d'un ami en QR code. */
  QrCode: ComposantQrCode;
}

/** L'app Administration, avec les services que l'hôte lui prête. */
export function appAdministration(services: ServicesAdministration): AppHub {
  const Racine = (props: PropsRacineApp) => React.createElement(Administration, { ...props, QrCode: services.QrCode });
  return {
    id: ID_ADMINISTRATION,
    nom: 'Administration',
    categorie: 'Admin',
    description: 'Comptes des amis, identifiants et accès aux apps.',
    icone: '⚙︎',
    teinte: 'admin',
    adminSeulement: true,
    // Il faut une plateforme qui sache créer le coffre d'un autre profil.
    disponible: contexte => Boolean(contexte.profils?.onCreerCompte),
    info: contexte => infoAdministration(contexte.profils?.tous),
    Racine,
  };
}

/** Vérifie les définitions (identifiants valides et uniques) et fige la liste. */
export function creerRegistre(apps: readonly AppHub[]): readonly AppHub[] {
  const vus = new Set<string>();
  for (const app of apps) {
    if (!MOTIF_ID_APP.test(app.id)) {
      throw new Error(`Identifiant d’app invalide : « ${app.id} ».`);
    }
    if (vus.has(app.id)) {
      throw new Error(`Identifiant d’app en double : « ${app.id} ».`);
    }
    vus.add(app.id);
  }
  return Object.freeze([...apps]);
}
