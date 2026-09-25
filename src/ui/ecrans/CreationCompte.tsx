/**
 * Création d'un compte.
 *
 * Premier écran utile après le déverrouillage initial : sans compte, ni
 * saisie ni import ne sont possibles.
 */

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import type { Compte, TypeCompte } from '../../core/domain/types';
import { Alerte, Bouton, Carte, Champ, SousTitre, Titre, usePalette } from '../composants';
import { ESPACEMENT, RAYON, palettePour, stylesPartages } from '../theme';
import {
  FORMULAIRE_COMPTE_VIDE,
  LIBELLES_TYPE_COMPTE,
  indicationDate,
  validerCompte,
  type ErreursCompte,
  type FormulaireCompte,
} from '../vues/compte';

export interface CreationCompteProps {
  comptesExistants: readonly Compte[];
  onCreer(compte: Compte): void;
  onAnnuler?: () => void;
  genererId?(): string;
}

const TYPES: TypeCompte[] = ['PEA', 'PEA_PME', 'CTO'];

export function CreationCompte({
  comptesExistants,
  onCreer,
  onAnnuler,
  genererId,
}: CreationCompteProps) {
  const sombre = useColorScheme() === 'dark';
  const palette = usePalette();
  const [formulaire, setFormulaire] = useState<FormulaireCompte>(
    FORMULAIRE_COMPTE_VIDE,
  );
  const [erreurs, setErreurs] = useState<ErreursCompte>({});

  const modifier = (champ: keyof FormulaireCompte, valeur: string) => {
    setFormulaire(precedent => ({ ...precedent, [champ]: valeur }));
    setErreurs(precedent => ({ ...precedent, [champ]: undefined }));
  };

  const creer = () => {
    const resultat = validerCompte(
      formulaire,
      comptesExistants,
      genererId ?? (() => `compte-${Date.now()}`),
    );
    setErreurs(resultat.erreurs);
    if (resultat.compte) {
      onCreer(resultat.compte);
    }
  };

  return (
    <ScrollView
      style={[stylesPartages.ecran, { backgroundColor: palettePour(sombre).fond }]}
      contentContainerStyle={[stylesPartages.contenu, { paddingTop: ESPACEMENT.l }]}
      keyboardShouldPersistTaps="handled">
      <Titre>Nouveau compte</Titre>

      <Carte>
        <SousTitre>Enveloppe</SousTitre>
        <View style={styles.pastilles}>
          {TYPES.map(type => {
            const actif = type === formulaire.type;
            return (
              <Pressable
                key={type}
                testID={`type-compte-${type}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: actif }}
                onPress={() => modifier('type', type)}
                style={[
                  styles.pastille,
                  {
                    backgroundColor: actif ? palette.accent : 'transparent',
                    borderColor: actif ? palette.accent : palette.bordure,
                  },
                ]}>
                <Text style={{ color: actif ? palette.surAccent : palette.texte }}>
                  {LIBELLES_TYPE_COMPTE[type]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Carte>

      <Champ
        etiquette="Nom"
        value={formulaire.nom}
        onChangeText={texte => modifier('nom', texte)}
        placeholder="PEA BoursoBank"
      />
      {erreurs.nom ? <Alerte message={erreurs.nom} /> : null}

      <Champ
        etiquette="Date d'ouverture"
        value={formulaire.dateOuverture}
        onChangeText={texte => modifier('dateOuverture', texte)}
        placeholder="JJ/MM/AAAA"
        keyboardType="numbers-and-punctuation"
        indication={indicationDate(formulaire.type)}
      />
      {erreurs.dateOuverture ? <Alerte message={erreurs.dateOuverture} /> : null}

      <Champ
        etiquette="Devise"
        value={formulaire.devise}
        onChangeText={texte => modifier('devise', texte)}
        autoCapitalize="characters"
        maxLength={3}
      />
      {erreurs.devise ? <Alerte message={erreurs.devise} /> : null}

      <Bouton titre="Créer le compte" testID="bouton-creer-compte" onPress={creer} />
      {onAnnuler ? (
        <Bouton titre="Annuler" variante="discret" onPress={onAnnuler} />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pastilles: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.s },
  pastille: {
    borderRadius: RAYON.l,
    borderWidth: 1,
    paddingVertical: ESPACEMENT.xs + 2,
    paddingHorizontal: ESPACEMENT.m - 4,
  },
});
