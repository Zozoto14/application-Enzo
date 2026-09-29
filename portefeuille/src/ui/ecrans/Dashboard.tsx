/**
 * Tableau de bord.
 *
 * L'écran ne calcule rien : il reçoit une `VueDashboard` déjà formatée
 * (`vues/dashboard.ts`), ce qui laisse toute la logique testable sans rendu.
 *
 * Il tient à dire deux choses que l'on cache souvent :
 *  - un portefeuille vide est annoncé comme tel, au lieu d'afficher « 0,00 € »
 *    qui se confond avec une erreur de chargement ;
 *  - les titres dont le cours manque sont nommés, parce qu'ils sont exclus des
 *    totaux et qu'un patrimoine amputé sans explication est pire qu'un chiffre
 *    absent.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { Bouton, Carte, SousTitre, Titre, Variation, usePalette } from '../composants';
import { ESPACEMENT, RAYON, palettePour, stylesPartages } from '../theme';
import type { LignePosition, VueDashboard } from '../vues/dashboard';

export interface DashboardProps {
  vue: VueDashboard;
  onAjouterTransaction?: () => void;
  onImporter?: () => void;
  onCreerCompte?: () => void;
  onReglages?: () => void;
  onRafraichirCours?: () => void;
  /** Resume du dernier rafraichissement, affiche tel quel. */
  messageCours?: string;
  rafraichissementEnCours?: boolean;
  onVerrouiller?: () => void;
}

export function Dashboard({
  vue,
  onAjouterTransaction,
  onImporter,
  onCreerCompte,
  onReglages,
  onRafraichirCours,
  messageCours,
  rafraichissementEnCours = false,
  onVerrouiller,
}: DashboardProps) {
  const sombre = useColorScheme() === 'dark';
  const palette = usePalette();

  return (
    <ScrollView
      style={[stylesPartages.ecran, { backgroundColor: palettePour(sombre).fond }]}
      contentContainerStyle={[stylesPartages.contenu, { paddingTop: ESPACEMENT.l }]}>
      <View style={stylesPartages.ligne}>
        <Titre>Portefeuille</Titre>
        {onVerrouiller ? (
          <Bouton titre="Verrouiller" variante="discret" onPress={onVerrouiller} />
        ) : null}
      </View>

      <Carte>
        <SousTitre>Valeur totale</SousTitre>
        <Text style={[styles.total, { color: palette.texte }]}>{vue.valeurTotale}</Text>
        <View style={[stylesPartages.ligne, { justifyContent: 'flex-start', gap: ESPACEMENT.s }]}>
          <Variation valeur={vue.plusValueLatente} tendance={vue.tendance} />
          <Variation valeur={vue.plusValueLatentePct} tendance={vue.tendance} taille={14} />
        </View>
        <View style={stylesPartages.ligne}>
          <SousTitre>Titres {vue.valeurTitres}</SousTitre>
          <SousTitre>Liquidités {vue.cash}</SousTitre>
        </View>
      </Carte>

      {vue.sansCompte ? (
        <Carte>
          <Text style={{ color: palette.texte }}>Aucun compte pour l'instant.</Text>
          <SousTitre>
            Créez d'abord un compte : c'est lui qui portera vos positions et
            vos liquidités.
          </SousTitre>
        </Carte>
      ) : vue.portefeuilleVide ? (
        <Carte>
          <Text style={{ color: palette.texte }}>
            Aucune position pour l'instant.
          </Text>
          <SousTitre>
            Importez vos positions depuis votre courtier ou saisissez une
            première opération.
          </SousTitre>
        </Carte>
      ) : null}

      {vue.titresSansCours.length > 0 ? (
        <Carte>
          <Text style={{ color: palette.danger, fontWeight: '600' }}>
            Cours inconnu, valeurs exclues du total
          </Text>
          <SousTitre>{vue.titresSansCours.join(', ')}</SousTitre>
        </Carte>
      ) : null}

      {vue.positions.length > 0 ? (
        <Carte>
          <Text style={[styles.sectionTitre, { color: palette.texte }]}>Positions</Text>
          {vue.positions.map(position => (
            <LigneDePosition key={position.titreId} position={position} />
          ))}
        </Carte>
      ) : null}

      {vue.repartitionParCompte.length > 1 ? (
        <Carte>
          <Text style={[styles.sectionTitre, { color: palette.texte }]}>
            Répartition par compte
          </Text>
          {vue.repartitionParCompte.map(ligne => (
            <View key={ligne.cle} style={{ gap: ESPACEMENT.xs }}>
              <View style={stylesPartages.ligne}>
                <Text style={{ color: palette.texte }}>{ligne.cle}</Text>
                <SousTitre>
                  {ligne.valeur} · {ligne.pourcentage}
                </SousTitre>
              </View>
              <View style={[styles.jauge, { backgroundColor: palette.bordure }]}>
                <View
                  style={[
                    styles.jaugeRemplie,
                    { backgroundColor: palette.accent, flex: ligne.fraction },
                  ]}
                />
                <View style={{ flex: 1 - ligne.fraction }} />
              </View>
            </View>
          ))}
        </Carte>
      ) : null}

      {onCreerCompte ? (
        <Bouton
          titre="Créer un compte"
          testID="bouton-creer-compte-depuis-tableau"
          variante={vue.sansCompte ? 'plein' : 'discret'}
          onPress={onCreerCompte}
        />
      ) : null}

      {onAjouterTransaction && !vue.sansCompte ? (
        <Bouton
          titre="Saisir une opération"
          testID="bouton-ajouter"
          onPress={onAjouterTransaction}
        />
      ) : null}

      {messageCours ? (
        <Carte>
          <Text accessibilityLiveRegion="polite" style={{ color: palette.texte }}>
            {messageCours}
          </Text>
        </Carte>
      ) : null}

      {onRafraichirCours && !vue.sansCompte ? (
        <Bouton
          titre={rafraichissementEnCours ? 'Récupération…' : 'Rafraîchir les cours'}
          testID="bouton-rafraichir-cours"
          variante="discret"
          desactive={rafraichissementEnCours}
          onPress={onRafraichirCours}
        />
      ) : null}

      {onReglages ? (
        <Bouton
          titre="Réglages"
          testID="bouton-reglages"
          variante="discret"
          onPress={onReglages}
        />
      ) : null}

      {onImporter && !vue.sansCompte ? (
        <Bouton
          titre="Importer des positions"
          testID="bouton-importer-positions"
          variante="discret"
          onPress={onImporter}
        />
      ) : null}
    </ScrollView>
  );
}

function LigneDePosition({ position }: { position: LignePosition }) {
  const palette = usePalette();
  return (
    <View style={[styles.position, { borderColor: palette.bordure }]}>
      <View style={stylesPartages.ligne}>
        <Text style={[styles.nom, { color: palette.texte }]} numberOfLines={1}>
          {position.nom}
        </Text>
        <Text style={{ color: palette.texte, fontWeight: '600' }}>
          {position.valeur}
        </Text>
      </View>
      <View style={stylesPartages.ligne}>
        <SousTitre>{position.resume}</SousTitre>
        <Variation
          valeur={`${position.plusValue} (${position.plusValuePct})`}
          tendance={position.tendance}
          taille={13}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  total: { fontSize: 34, fontWeight: '700' },
  sectionTitre: { fontSize: 17, fontWeight: '700' },
  position: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: ESPACEMENT.s,
    gap: ESPACEMENT.xs,
  },
  nom: { fontSize: 15, fontWeight: '600', flex: 1, marginRight: ESPACEMENT.s },
  jauge: {
    flexDirection: 'row',
    height: 6,
    borderRadius: RAYON.s,
    overflow: 'hidden',
  },
  jaugeRemplie: { height: 6 },
});
