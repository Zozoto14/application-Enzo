/**
 * Section « Réglages » de l'Administration : elle n'a plus de réglages à elle.
 * Le thème est celui de toute l'application, et les réglages du panneau
 * (journal, verrouillage, invitations) sont réunis dans la page Paramètres,
 * section Administration.
 */

import React from 'react';
import { Text, View } from 'react-native';
import { police } from '../../themes';
import { BoutonHub, Intertitre, Panneau, commun, type OutilsAdmin } from './commun';

export function Reglages({ outils }: { outils: OutilsAdmin }) {
  const { theme } = outils;
  const attenue = { color: theme.attenue, ...police(theme.policeTexte) };
  return (
    <View style={{ gap: 16 }} testID="admin-section-reglages">
      <Panneau theme={theme}>
        <Intertitre theme={theme}>Réglages</Intertitre>
        <Text style={[attenue, { fontSize: 14 }]}>
          Tous les réglages de l’application sont réunis dans la page Paramètres : le thème (un seul, pour toutes les pages), la
          synchronisation, la sécurité et, dans la section Administration, la rétention du journal, le verrouillage du panneau, la
          validité de l’identité, les comptes inactifs et la durée des invitations.
        </Text>
        <View style={commun.actions}>
          <BoutonHub
            theme={theme}
            variante="plein"
            couleur={theme.teintes.admin}
            titre="Ouvrir les Paramètres"
            onPress={() => outils.onParametres?.('administration')}
            testID="admin-ouvrir-parametres"
          />
        </View>
      </Panneau>
    </View>
  );
}
