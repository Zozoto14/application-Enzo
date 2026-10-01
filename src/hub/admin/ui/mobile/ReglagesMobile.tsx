/** Réglages de l'Administration, version téléphone : renvoi vers les Paramètres, bouton principal collé en bas. */

import React from 'react';
import { BoutonPrincipal } from '../../../../ui/mobile';
import type { OutilsAdmin } from '../commun';
import { Aide, CadreAdmin } from './briques';

export function Reglages({ outils, onRetour }: { outils: OutilsAdmin; onRetour(): void }) {
  const { theme } = outils;
  return (
    <CadreAdmin
      theme={theme}
      titre="Réglages"
      libelleRetour="Admin"
      onRetour={onRetour}
      testID="admin-section-reglages"
      pied={<BoutonPrincipal theme={theme} titre="Ouvrir les Paramètres" onPress={() => outils.onParametres?.('administration')} testID="admin-ouvrir-parametres" />}>
      <Aide theme={theme}>
        Tous les réglages de l’application sont réunis dans la page Paramètres : le thème (un seul, pour toutes les pages), la synchronisation, la sécurité et, dans la section Administration, la rétention du journal, le verrouillage du panneau, la validité de l’identité, les comptes inactifs et la durée des invitations.
      </Aide>
    </CadreAdmin>
  );
}
