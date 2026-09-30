/** Paramètres › Support et Paramètres › À propos (documents légaux) : simples entrées vers les pages. */

import React from 'react';
import { Text, View } from 'react-native';
import type { Ticket } from '../support/tickets';
import { AVERTISSEMENT_JURIDIQUE, derniereAcceptation, type Acceptation } from '../juridique/modele';
import { BoutonHub } from './Hub';
import { LiensJuridiques } from './PageJuridique';
import { police, type ThemeHub } from './themes';

export function ReglageSupport({ theme, tickets, onOuvrir }: { theme: ThemeHub; tickets: readonly Ticket[]; onOuvrir(): void }) {
  const attenue = { color: theme.attenue, fontSize: 13, lineHeight: 19, ...police(theme.policeTexte) };
  const enAttente = tickets.filter(t => t.statut === 'attente').length;
  return (
    <View style={{ gap: 10 }} testID="parametres-support">
      <Text style={attenue}>
        Un bug, une question, une idée ? Écrivez à l’équipe : votre message arrive directement dans son salon Discord. {tickets.length > 0 ? `Vous avez envoyé ${tickets.length} ticket${tickets.length > 1 ? 's' : ''}${enAttente ? ` (${enAttente} en attente de connexion)` : ''}.` : ''}
      </Text>
      <View style={{ alignSelf: 'flex-start' }}>
        <BoutonHub theme={theme} variante="plein" titre="Ouvrir le support" onPress={onOuvrir} testID="parametres-support-ouvrir" />
      </View>
    </View>
  );
}

export function ReglageJuridique({ theme, acceptations, onOuvrir }: { theme: ThemeHub; acceptations: readonly Acceptation[]; onOuvrir(id?: Parameters<React.ComponentProps<typeof LiensJuridiques>['onOuvrir']>[0]): void }) {
  const derniere = derniereAcceptation(acceptations);
  return (
    <View style={{ gap: 8 }} testID="parametres-juridique">
      <Text style={{ color: theme.attenue, fontSize: 13, lineHeight: 19, ...police(theme.policeTexte) }}>
        Conditions d’utilisation, confidentialité, cookies et stockage local, mentions légales. {derniere ? `Acceptés le ${derniere.date.slice(0, 10)} (version ${derniere.version}).` : ''}
      </Text>
      <Text style={{ color: theme.attenue, fontSize: 12, fontStyle: 'italic', ...police(theme.policeTexte) }}>{AVERTISSEMENT_JURIDIQUE}</Text>
      <View style={{ alignItems: 'flex-start' }}>
        <LiensJuridiques theme={theme} onOuvrir={onOuvrir} />
      </View>
    </View>
  );
}
