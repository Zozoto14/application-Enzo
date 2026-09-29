/**
 * Bandeau « nouvelle version disponible ».
 *
 * Au lancement, l'application demande au processus principal si GitHub porte
 * un code plus récent que celui qui l'a compilée. Si oui, un bandeau le dit,
 * avec ce qui a changé, et propose de lancer la mise à jour — qui recompile
 * et réinstalle l'application dans une fenêtre à part.
 *
 * Rien ne se passe sans clic : une mise à jour ferme l'application, et on ne
 * ferme pas une application sous les yeux de quelqu'un qui saisit une
 * opération.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ESPACEMENT, RAYON, type Palette } from '../src/ui/theme';
import { pont, type EtatMiseAJourBureau } from './stockage';

/** Au-delà, la liste des nouveautés est tronquée : le bandeau reste un bandeau. */
const NOUVEAUTES_AFFICHEES = 3;

export function BandeauMiseAJour({ palette }: { palette: Palette }) {
  const [etat, setEtat] = useState<EtatMiseAJourBureau>();
  const [masque, setMasque] = useState(false);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    const maj = pont()?.maj;
    if (!maj) {
      return;
    }
    let vivant = true;
    maj
      .verifier()
      .then(resultat => {
        if (vivant) {
          setEtat(resultat);
        }
        if (resultat.etat === 'erreur') {
          // Pas de réseau, identifiants git absents… Rien de grave pour
          // l'utilisateur : l'application reste utilisable, on le note.
          console.warn('Vérification de mise à jour impossible :', resultat.motif);
        }
      })
      .catch(erreur => console.warn('Vérification de mise à jour impossible :', erreur));
    return () => {
      vivant = false;
    };
  }, []);

  if (masque || !etat) {
    return null;
  }

  if (etat.etat === 'appliquee') {
    // Déjà en place : on informe, sans rien demander.
    const premieres = etat.nouveautes.slice(0, NOUVEAUTES_AFFICHEES);
    return (
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[styles.bandeau, { backgroundColor: palette.surface, borderColor: palette.hausse }]}>
        <View style={styles.texte}>
          <Text style={[styles.titre, { color: palette.texte }]}>Application mise à jour</Text>
          {premieres.map((ligne, index) => (
            <Text key={`${index}-${ligne}`} numberOfLines={1} style={{ color: palette.texteSecondaire, fontSize: 13 }}>
              • {ligne}
            </Text>
          ))}
          {etat.nouveautes.length > premieres.length ? (
            <Text style={{ color: palette.texteSecondaire, fontSize: 13 }}>
              … et {etat.nouveautes.length - premieres.length} autre(s).
            </Text>
          ) : null}
        </View>
        <Pressable
          testID="bouton-compris"
          accessibilityRole="button"
          onPress={() => setMasque(true)}
          style={({ pressed }) => [
            styles.bouton,
            { borderColor: palette.bordure, borderWidth: 1, opacity: pressed ? 0.8 : 1 },
          ]}>
          <Text style={[styles.libelle, { color: palette.texte }]}>OK</Text>
        </Pressable>
      </View>
    );
  }

  if (etat.etat !== 'disponible') {
    return null;
  }

  const installer = async () => {
    setEnCours(true);
    const lance = await pont()?.maj?.installer();
    if (!lance) {
      setEnCours(false);
    }
  };

  const nombre = etat.nouveautes.length;
  const affichees = etat.nouveautes.slice(0, NOUVEAUTES_AFFICHEES);

  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.bandeau, { backgroundColor: palette.surface, borderColor: palette.accent }]}>
      <View style={styles.texte}>
        <Text style={[styles.titre, { color: palette.texte }]}>
          Réinstallation nécessaire
        </Text>
        <Text style={{ color: palette.texteSecondaire, fontSize: 13 }}>
          L’interface est à jour, mais {nombre > 1 ? `${nombre} modifications touchent` : 'une modification touche'} le
          moteur de l’application, qui ne se remplace qu’en réinstallant :
        </Text>
        {affichees.map((ligne, index) => (
          <Text
            key={`${index}-${ligne}`}
            numberOfLines={1}
            style={{ color: palette.texteSecondaire, fontSize: 13 }}>
            • {ligne}
          </Text>
        ))}
        {nombre > affichees.length ? (
          <Text style={{ color: palette.texteSecondaire, fontSize: 13 }}>
            … et {nombre - affichees.length} autre(s).
          </Text>
        ) : null}
        {enCours ? (
          <Text style={{ color: palette.texte, fontSize: 13, marginTop: ESPACEMENT.xs }}>
            Une fenêtre de mise à jour s’ouvre. L’application va se fermer ;
            suivez l’installeur à la fin de la compilation.
          </Text>
        ) : null}
      </View>

      <View style={styles.actions}>
        <Pressable
          testID="bouton-mettre-a-jour"
          accessibilityRole="button"
          disabled={enCours}
          onPress={installer}
          style={({ pressed }) => [
            styles.bouton,
            { backgroundColor: palette.accentPlein, opacity: enCours ? 0.5 : pressed ? 0.8 : 1 },
          ]}>
          <Text style={[styles.libelle, { color: palette.surAccent }]}>
            {enCours ? 'Lancement…' : 'Réinstaller'}
          </Text>
        </Pressable>
        <Pressable
          testID="bouton-plus-tard"
          accessibilityRole="button"
          disabled={enCours}
          onPress={() => setMasque(true)}
          style={({ pressed }) => [
            styles.bouton,
            { borderColor: palette.bordure, borderWidth: 1, opacity: pressed ? 0.8 : 1 },
          ]}>
          <Text style={[styles.libelle, { color: palette.texte }]}>Plus tard</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bandeau: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: ESPACEMENT.m,
    margin: ESPACEMENT.m,
    marginBottom: 0,
    padding: ESPACEMENT.m,
    borderWidth: 1,
    borderRadius: RAYON.m,
  },
  texte: { flex: 1, minWidth: 260, gap: 2 },
  titre: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  actions: { flexDirection: 'row', gap: ESPACEMENT.s },
  bouton: {
    borderRadius: RAYON.s,
    paddingVertical: ESPACEMENT.s + 2,
    paddingHorizontal: ESPACEMENT.m,
    minHeight: 44,
    justifyContent: 'center',
  },
  libelle: { fontSize: 14, fontWeight: '600' },
});
