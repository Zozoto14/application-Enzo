/**
 * Garde-fou d'affichage : une erreur pendant le rendu d'un écran (hub, app
 * ouverte, compte entier) ne laisse jamais une page blanche. L'écran dit ce
 * qui s'est passé, avec le message technique, et propose de réessayer ou de
 * revenir à la connexion. Les données ne sont pas touchées.
 */

import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Bouton, SousTitre, Titre } from './composants';
import { ESPACEMENT, palettePour, stylesPartages } from './theme';

export interface GardeErreurProps {
  children: React.ReactNode;
  /** Ce qui n'a pas pu s'afficher (« le hub », « votre compte »…). */
  quoi?: string;
  /** Revenir à la connexion (changer de compte) ; absent : seul « Réessayer » est proposé. */
  onRevenir?: () => void;
}

interface Etat {
  erreur?: Error;
}

export class GardeErreur extends React.Component<GardeErreurProps, Etat> {
  state: Etat = {};

  static getDerivedStateFromError(erreur: unknown): Etat {
    return { erreur: erreur instanceof Error ? erreur : new Error(String(erreur)) };
  }

  componentDidCatch(erreur: unknown, info: { componentStack?: string | null }): void {
    console.error(`Affichage impossible (${this.props.quoi ?? 'écran'}) :`, erreur, info.componentStack ?? '');
  }

  render() {
    const { erreur } = this.state;
    if (!erreur) {
      return this.props.children;
    }
    const palette = palettePour();
    return (
      <ScrollView
        style={[stylesPartages.ecran, { backgroundColor: palette.fond }]}
        contentContainerStyle={[stylesPartages.contenu, stylesPartages.accueil, { paddingVertical: ESPACEMENT.xl, gap: ESPACEMENT.m }]}
        testID="garde-erreur">
        <Titre>Affichage impossible</Titre>
        <SousTitre>
          {`Une erreur empêche d’afficher ${this.props.quoi ?? 'cet écran'}. Vos données ne sont pas touchées : réessayez, ou revenez à la connexion.`}
        </SousTitre>
        <Text selectable style={{ color: palette.danger }} testID="garde-erreur-message">
          {erreur.message}
        </Text>
        <View style={{ gap: ESPACEMENT.s, maxWidth: 420, width: '100%' }}>
          <Bouton titre="Réessayer" onPress={() => this.setState({ erreur: undefined })} testID="garde-erreur-reessayer" />
          {this.props.onRevenir ? (
            <Bouton titre="Revenir à la connexion" variante="discret" onPress={this.props.onRevenir} testID="garde-erreur-revenir" />
          ) : null}
        </View>
      </ScrollView>
    );
  }
}
