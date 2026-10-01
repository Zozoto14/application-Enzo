/**
 * « Lier à mon compte » : sur un nouvel appareil (ou le site), récupère le
 * compte du PC par le relais. L'appareil s'ouvre ensuite avec le même mot de
 * passe et le même code d'authentification, et le portefeuille arrive par la
 * synchronisation.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Alerte, Bouton, Champ, SousTitre, usePalette } from '../composants';
import { ESPACEMENT, RAYON } from '../theme';
import { useMobile } from '../mobile/useMobile';
import { TEXTE } from '../mobile/jetons';

export interface OptionsLier {
  /** Code déjà connu (lien scanné, relais du PC) : rien à recopier. */
  codeConnu?: string;
  onLier(code: string): Promise<void>;
}

export function LierCompte({
  codeConnu,
  onLier,
  remplace = false,
}: OptionsLier & {
  /** Un compte existe déjà sur cet appareil : il sera remplacé. */
  remplace?: boolean;
}) {
  const palette = usePalette();
  const mobile = useMobile();
  const [code, setCode] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | undefined>();
  const utilise = code.trim() || codeConnu || '';

  const lier = () => {
    setErreur(undefined);
    setEnCours(true);
    onLier(utilise)
      .catch((e: unknown) => setErreur(e instanceof Error ? e.message : String(e)))
      .finally(() => setEnCours(false));
  };

  return (
    <View style={[styles.cadre, mobile && styles.cadreMobile, { borderColor: palette.accent, backgroundColor: palette.surface }]} testID="lier-compte">
      <Text style={{ color: palette.texte, fontWeight: '800', fontSize: 17 }}>🔗 Déjà un compte ailleurs ?</Text>
      <SousTitre>
        Liez cet appareil : il s’ouvrira avec le même prénom, le même mot de passe et le même code d’authentification
        qu’ailleurs, et votre portefeuille arrivera tout seul.
      </SousTitre>
      {codeConnu ? (
        <Text style={{ color: palette.hausse, fontWeight: '600', fontSize: mobile ? TEXTE.legende : undefined }} testID="code-connu">
          ✅ Code de liaison reconnu : rien à recopier.
        </Text>
      ) : (
        <Champ
          etiquette="Code de liaison"
          indication="Administrateur : sur le PC, Paramètres › Synchronisation › Appareils liés › Relier un autre appareil › Copier le code. Ami : le code de connexion envoyé par l’administrateur. Il commence par AB1."
          placeholder="AB1.…"
          value={code}
          onChangeText={setCode}
          autoCapitalize="none"
          autoCorrect={false}
          nature="codeLiaison"
          testID="champ-code-lier"
        />
      )}
      {remplace ? (
        <Text style={{ color: palette.texteSecondaire, fontSize: mobile ? TEXTE.legende : 13 }}>
          Le coffre actuel de cet appareil sera remplacé par celui de votre compte (sur le site, une sauvegarde de l’ancien
          vous est d’abord proposée).
        </Text>
      ) : null}
      {erreur ? <Alerte message={erreur} /> : null}
      <Bouton
        pleineLargeur
        titre={enCours ? 'Liaison…' : 'Lier à mon compte'}
        desactive={enCours || !utilise}
        onPress={lier}
        testID="bouton-lier-compte"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  cadre: { borderWidth: 1.5, borderRadius: RAYON.m, padding: ESPACEMENT.m, gap: ESPACEMENT.s },
  // Téléphone : déjà dans une feuille basse, sans cadre.
  cadreMobile: { borderWidth: 0, padding: 0, backgroundColor: 'transparent', gap: ESPACEMENT.m },
});
