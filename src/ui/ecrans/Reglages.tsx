/**
 * Réglages : fournisseur de cours et clé d'API.
 *
 * La clé est stockée dans la base chiffrée, donc illisible sans
 * déverrouillage. Le champ est masqué à la saisie et n'affiche jamais la clé
 * enregistrée en clair : on peut la remplacer, pas la relire.
 */

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { Alerte, Bouton, Carte, Champ, SousTitre, Titre, usePalette } from '../composants';
import { ESPACEMENT, RAYON, palettePour, stylesPartages } from '../theme';
import type { FournisseurCours } from '../../cours/fournisseur';

export interface ReglagesProps {
  fournisseurs: readonly FournisseurCours[];
  fournisseurActuel?: string;
  /** Vrai si une clé est déjà enregistrée. Sa valeur n'est jamais transmise. */
  cleEnregistree: boolean;
  onEnregistrer(fournisseurId: string, cle?: string): void;
  /** Ouvre l'attribution des symboles de cotation. */
  onSymboles?(): void;
  /** Nombre de valeurs détenues sans symbole, qui bloquent le rafraîchissement. */
  sansSymbole?: number;
  /** Charge l'historique des cours des valeurs qui ont un symbole. */
  onChargerHistorique?(): void;
  /** Nombre de valeurs prêtes à être chargées. */
  avecSymbole?: number;
  chargementEnCours?: boolean;
  messageHistorique?: string;
  onAnnuler(): void;
}

export function Reglages({
  fournisseurs,
  fournisseurActuel,
  cleEnregistree,
  onSymboles,
  sansSymbole,
  onChargerHistorique,
  avecSymbole,
  chargementEnCours,
  messageHistorique,
  onEnregistrer,
  onAnnuler,
}: ReglagesProps) {
  const sombre = useColorScheme() === 'dark';
  const palette = usePalette();
  const [choisi, setChoisi] = useState(fournisseurActuel ?? fournisseurs[0]?.id ?? '');
  const [cle, setCle] = useState('');

  const fournisseur = fournisseurs.find(candidat => candidat.id === choisi);
  const cleManquante = Boolean(fournisseur?.cleRequise) && !cleEnregistree && cle === '';

  return (
    <ScrollView
      style={[stylesPartages.ecran, { backgroundColor: palettePour(sombre).fond }]}
      contentContainerStyle={[stylesPartages.contenu, { paddingTop: ESPACEMENT.l }]}
      keyboardShouldPersistTaps="handled">
      <Titre>Cours automatiques</Titre>
      <SousTitre>
        Choisissez un fournisseur de cotations et renseignez sa clé d'API.
      </SousTitre>

      <Carte>
        <SousTitre>Fournisseur</SousTitre>
        <View style={styles.pastilles}>
          {fournisseurs.map(candidat => {
            const actif = candidat.id === choisi;
            return (
              <Pressable
                key={candidat.id}
                testID={`fournisseur-${candidat.id}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: actif }}
                onPress={() => setChoisi(candidat.id)}
                style={[
                  styles.pastille,
                  {
                    backgroundColor: actif ? palette.accent : 'transparent',
                    borderColor: actif ? palette.accent : palette.bordure,
                  },
                ]}>
                <Text style={{ color: actif ? palette.surAccent : palette.texte }}>
                  {candidat.libelle}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Carte>

      {fournisseur?.provisoire ? (
        <Alerte
          message={
            "Ce fournisseur n'a jamais été confronté à une vraie réponse : son " +
            'mapping est une hypothèse. Comparez le premier cours obtenu à ' +
            "celui de votre courtier avant de vous y fier."
          }
        />
      ) : null}

      <Champ
        etiquette="Clé d'API"
        value={cle}
        onChangeText={setCle}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={cleEnregistree ? 'Clé enregistrée — saisir pour remplacer' : ''}
        indication="Conservée dans la base chiffrée, illisible sans déverrouillage."
      />

      {cleManquante ? (
        <Alerte message="Ce fournisseur exige une clé d'API." />
      ) : null}

      {onSymboles ? (
        <Carte>
          <Text style={{ color: palette.texte, fontWeight: '600' }}>
            Symboles de cotation
          </Text>
          <SousTitre>
            {sansSymbole
              ? `${sansSymbole} valeur(s) détenue(s) n’ont pas de symbole : leurs cours ne peuvent pas être rafraîchis.`
              : 'Le symbole dit à quel marché demander le cours. Une même société cote parfois sur plusieurs places, à des cours différents.'}
          </SousTitre>
          <Bouton
            titre="Régler les symboles"
            testID="bouton-symboles"
            variante="discret"
            onPress={onSymboles}
          />
        </Carte>
      ) : null}

      {onChargerHistorique ? (
        <Carte>
          <Text style={{ color: palette.texte, fontWeight: '600' }}>
            Historique des cours
          </Text>
          <SousTitre>
            Sans historique, les onglets Performances et Risque restent muets
            plusieurs mois : il faut trente relevés pour une corrélation et
            quatre-vingt-dix jours pour annualiser un rendement. Ce chargement
            reprend deux ans d’un coup.
          </SousTitre>
          <SousTitre>
            Les cours retenus sont les clôtures brutes, pas les clôtures
            ajustées : vos dividendes sont déjà saisis comme opérations, et les
            compter deux fois gonflerait la performance.
          </SousTitre>
          <Bouton
            titre={chargementEnCours ? 'Chargement…' : 'Charger deux ans d’historique'}
            testID="bouton-charger-historique"
            variante="discret"
            desactive={chargementEnCours || avecSymbole === 0}
            onPress={onChargerHistorique}
          />
          {avecSymbole === 0 ? (
            <SousTitre>
              Aucune valeur n’a de symbole : réglez-les d’abord.
            </SousTitre>
          ) : null}
          {messageHistorique ? (
            <Text accessibilityLiveRegion="polite" style={{ color: palette.texte }}>
              {messageHistorique}
            </Text>
          ) : null}
        </Carte>
      ) : null}

      <Bouton
        titre="Enregistrer"
        testID="bouton-enregistrer-reglages"
        desactive={cleManquante || choisi === ''}
        onPress={() => onEnregistrer(choisi, cle || undefined)}
      />
      <Bouton titre="Retour" variante="discret" onPress={onAnnuler} />
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
