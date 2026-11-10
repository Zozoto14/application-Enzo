/**
 * Redemande du mot de passe et du code TOTP de l'administrateur (Administration, Paramètres, Abonnements, Esport).
 * Fichier à part : les Paramètres du hub l'affichent sans charger tout le panneau d'administration.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BoutonHub, Champ, Panneau, styleTitre } from './admin/ui/commun';
import { teinteTransparente, type ThemeHub } from './themes';

/** Redemande mot de passe + code TOTP de l'administrateur. */
export function FormulaireIdentite({
  theme,
  raison,
  enCours,
  onValider,
  onAnnuler,
}: {
  theme: ThemeHub;
  raison: string;
  enCours: boolean;
  onValider(motDePasse: string, code: string): void;
  onAnnuler?(): void;
}) {
  const [motDePasse, setMotDePasse] = useState('');
  const [code, setCode] = useState('');
  return (
    <Panneau theme={theme} testID="admin-identite" style={{ borderColor: theme.teintes.admin, backgroundColor: teinteTransparente(theme.teintes.admin, 0.06), marginVertical: 8 }}>
      <Text style={[styleTitre(theme), { fontSize: 18 }]}>Vérification d’identité</Text>
      <Text style={{ color: theme.attenue, fontSize: 13 }}>
        {raison} : saisissez votre mot de passe et le code de votre application d’authentification (mêmes vérifications qu’au déverrouillage).
      </Text>
      <Champ theme={theme} libelle="Mot de passe" valeur={motDePasse} onChanger={setMotDePasse} secret testID="admin-identite-mdp" />
      <Champ theme={theme} libelle="Code à 6 chiffres" valeur={code} onChanger={v => setCode(v.replace(/[^\d]/g, ''))} clavier="number-pad" maxLength={6} testID="admin-identite-code" />
      <View style={styles.actions}>
        <BoutonHub
          theme={theme}
          variante="plein"
          couleur={theme.teintes.admin}
          titre={enCours ? 'Vérification…' : 'Confirmer'}
          desactive={enCours || !motDePasse || code.length !== 6}
          onPress={() => {
            onValider(motDePasse, code);
            setMotDePasse('');
            setCode('');
          }}
          testID="admin-identite-valider"
        />
        {onAnnuler ? <BoutonHub theme={theme} titre="Annuler" onPress={onAnnuler} testID="admin-identite-annuler" /> : null}
      </View>
    </Panneau>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
});
