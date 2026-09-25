/**
 * Réglages des notifications.
 *
 * Deux sections : les briefings, programmés jour par jour, et les alertes de
 * cours, définies valeur par valeur.
 *
 * L'écran dit d'emblée ce que le système autorise réellement. Régler des
 * horaires alors que le module de notifications n'est pas dans le binaire, ou
 * que le réveil en arrière-plan est absent, produirait un silence
 * incompréhensible.
 */

import React, { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View, useColorScheme } from 'react-native';
import {
  JOURS,
  heureValide,
  type JourSemaine,
  type Planning,
  type ProchainBriefing,
} from '../../notifications/planification';
import { Alerte, Bouton, Carte, Champ, SousTitre, Titre as TitreEcran, usePalette } from '../composants';
import { ESPACEMENT, RAYON, palettePour, stylesPartages } from '../theme';

export interface SeuilAffiche {
  titreId: string;
  nom: string;
  haut: string;
  bas: string;
}

export interface NotificationsProps {
  /** Faux si @notifee n'est pas dans le binaire. */
  notificationsDisponibles: boolean;
  /** Faux si le réveil en arrière-plan n'est pas dans le binaire. */
  reveilDisponible: boolean;
  planning: Planning;
  onChangerPlanning(planning: Planning): void;
  prochain?: ProchainBriefing;
  seuils: readonly SeuilAffiche[];
  onChangerSeuil(titreId: string, champ: 'haut' | 'bas', valeur: string): void;
  onTester?(): void;
  onRetour(): void;
  message?: string;
}

const LIBELLES_JOUR: Record<JourSemaine, string> = {
  lundi: 'Lundi',
  mardi: 'Mardi',
  mercredi: 'Mercredi',
  jeudi: 'Jeudi',
  vendredi: 'Vendredi',
  samedi: 'Samedi',
  dimanche: 'Dimanche',
};

export function Notifications({
  notificationsDisponibles,
  reveilDisponible,
  planning,
  onChangerPlanning,
  prochain,
  seuils,
  onChangerSeuil,
  onTester,
  onRetour,
  message,
}: NotificationsProps) {
  const sombre = useColorScheme() === 'dark';
  const palette = usePalette();

  const modifierJour = (jour: JourSemaine, horaire: Partial<Planning[JourSemaine]>) => {
    onChangerPlanning({ ...planning, [jour]: { ...planning[jour], ...horaire } });
  };

  return (
    <ScrollView
      style={[stylesPartages.ecran, { backgroundColor: palettePour(sombre).fond }]}
      contentContainerStyle={[stylesPartages.contenu, { paddingTop: ESPACEMENT.l }]}
      keyboardShouldPersistTaps="handled">
      <TitreEcran>Notifications</TitreEcran>

      {!notificationsDisponibles ? (
        <Carte>
          <Text style={{ color: palette.danger, fontWeight: '600' }}>
            Notifications indisponibles
          </Text>
          <SousTitre>
            Le module de notifications n'est pas présent dans cette version de
            l'application. Les réglages ci-dessous seront conservés, mais rien
            ne sera envoyé.
          </SousTitre>
        </Carte>
      ) : null}

      {notificationsDisponibles && !reveilDisponible ? (
        <Carte>
          <Text style={{ color: palette.texte, fontWeight: '600' }}>
            Briefings figés à la dernière ouverture
          </Text>
          <SousTitre>
            Le réveil en arrière-plan n'est pas disponible. Les briefings
            partiront bien, mais avec les valeurs connues au moment où vous avez
            ouvert l'application pour la dernière fois, pas celles du jour.
          </SousTitre>
        </Carte>
      ) : null}

      {message ? (
        <Carte>
          <Text accessibilityLiveRegion="polite" style={{ color: palette.texte }}>
            {message}
          </Text>
        </Carte>
      ) : null}

      {/* --- Briefings --- */}
      <Carte>
        <Text style={[styles.sectionTitre, { color: palette.texte }]}>Briefings</Text>
        <SousTitre>
          Un résumé du portefeuille, le matin avant ouverture et le soir après
          clôture. Rien n'est envoyé si la valeur n'a pas bougé.
        </SousTitre>

        {prochain ? (
          <SousTitre>
            Prochain : {prochain.aujourdhui ? "aujourd'hui" : LIBELLES_JOUR[prochain.jour]}{' '}
            à {prochain.heure}.
          </SousTitre>
        ) : (
          <SousTitre>Aucun briefing programmé.</SousTitre>
        )}
      </Carte>

      {JOURS.map(jour => {
        const horaire = planning[jour];
        return (
          <Carte key={jour}>
            <View style={stylesPartages.ligne}>
              <Text style={{ color: palette.texte, fontWeight: '600' }}>
                {LIBELLES_JOUR[jour]}
              </Text>
              <Switch
                value={horaire.actif}
                onValueChange={actif => modifierJour(jour, { actif })}
                accessibilityLabel={`Briefings du ${LIBELLES_JOUR[jour].toLowerCase()}`}
              />
            </View>

            {horaire.actif ? (
              <View style={styles.heures}>
                <ChampHeure
                  etiquette="Matin"
                  jour={jour}
                  moment="matin"
                  valeur={horaire.matin ?? ''}
                  onChange={valeur => modifierJour(jour, { matin: valeur || undefined })}
                />
                <ChampHeure
                  etiquette="Soir"
                  jour={jour}
                  moment="soir"
                  valeur={horaire.soir ?? ''}
                  onChange={valeur => modifierJour(jour, { soir: valeur || undefined })}
                />
              </View>
            ) : null}
          </Carte>
        );
      })}

      {/* --- Alertes de cours --- */}
      <Carte>
        <Text style={[styles.sectionTitre, { color: palette.texte }]}>
          Alertes de cours
        </Text>
        <SousTitre>
          Vous êtes prévenu au franchissement d'un seuil, une seule fois par
          franchissement. Laissez vide pour ne pas surveiller.
        </SousTitre>

        {seuils.length === 0 ? (
          <SousTitre>
            Aucune valeur détenue. Les alertes portent sur vos positions.
          </SousTitre>
        ) : (
          seuils.map(seuil => (
            <View
              key={seuil.titreId}
              style={[styles.ligneSeuil, { borderColor: palette.bordure }]}>
              <Text style={{ color: palette.texte }}>{seuil.nom}</Text>
              <View style={styles.heures}>
                <View style={styles.moitie}>
                  <Champ
                    etiquette="Seuil bas"
                    value={seuil.bas}
                    onChangeText={valeur => onChangerSeuil(seuil.titreId, 'bas', valeur)}
                    keyboardType="decimal-pad"
                    placeholder="—"
                  />
                </View>
                <View style={styles.moitie}>
                  <Champ
                    etiquette="Seuil haut"
                    value={seuil.haut}
                    onChangeText={valeur => onChangerSeuil(seuil.titreId, 'haut', valeur)}
                    keyboardType="decimal-pad"
                    placeholder="—"
                  />
                </View>
              </View>
            </View>
          ))
        )}
      </Carte>

      {onTester && notificationsDisponibles ? (
        <Bouton
          titre="Envoyer une notification de test"
          testID="bouton-tester-notification"
          variante="discret"
          onPress={onTester}
        />
      ) : null}

      <Bouton titre="Retour" variante="discret" onPress={onRetour} />
    </ScrollView>
  );
}

/** Champ d'heure au format HH:MM, avec sa validation. */
function ChampHeure({
  etiquette,
  jour,
  moment,
  valeur,
  onChange,
}: {
  etiquette: string;
  jour: JourSemaine;
  moment: 'matin' | 'soir';
  valeur: string;
  onChange(valeur: string): void;
}) {
  const [saisie, setSaisie] = useState(valeur);
  const invalide = saisie !== '' && !heureValide(saisie);

  return (
    <View style={styles.moitie}>
      <Champ
        etiquette={etiquette}
        testID={`heure-${jour}-${moment}`}
        value={saisie}
        onChangeText={texte => {
          setSaisie(texte);
          // On ne remonte que ce qui est exploitable : une saisie en cours de
          // frappe ne doit pas effacer l'horaire enregistré.
          if (texte === '' || heureValide(texte)) {
            onChange(texte);
          }
        }}
        keyboardType="numbers-and-punctuation"
        placeholder="HH:MM"
        maxLength={5}
      />
      {invalide ? <Alerte message="Format attendu : HH:MM" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitre: { fontSize: 17, fontWeight: '700' },
  heures: { flexDirection: 'row', gap: ESPACEMENT.m },
  moitie: { flex: 1, minWidth: 120 },
  ligneSeuil: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: ESPACEMENT.s,
    gap: ESPACEMENT.xs,
    borderRadius: RAYON.s,
  },
});
