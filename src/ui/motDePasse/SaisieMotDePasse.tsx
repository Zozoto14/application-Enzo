/**
 * Saisie d'un NOUVEAU mot de passe, avec l'aide pour le choisir. Composant partagé par tous les
 * écrans où l'on choisit ou change un mot de passe : acceptation d'invitation, connexion par
 * identifiant du Fondateur (activation et changement dans Paramètres › Sécurité), mot de passe
 * oublié (code de récupération), création du coffre, archive de sauvegarde.
 *
 * Il réunit :
 *  - un encadré qui dit ce qui est accepté, le conseil de la phrase et le rappel (pas de
 *    réutilisation, gestionnaire de mots de passe) ;
 *  - les deux champs, un seul bouton « Afficher / Masquer » pour les deux ;
 *  - des messages précis (« Il manque 3 caractères », « Les deux mots de passe ne correspondent
 *    pas », « Attention : majuscules activées » sur le web) ;
 *  - l'indicateur de force avec sa phrase d'explication, et la liste des règles en direct (✓ / ○).
 *
 * Ce composant AFFICHE les règles ; la décision de valider reste à l'écran, qui applique le code
 * existant (`evaluerMotDePasse`, longueur du coffre). Il lit la même source : aucune règle inventée.
 * Textes en français et en anglais (voir `textes.ts`).
 */

import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Champ, usePalette } from '../composants';
import { ESPACEMENT, RAYON } from '../theme';
import { useMobile } from '../mobile/useMobile';
import { useLangue } from '../../esport/i18n';
import type { PolitiqueMdp } from '../../profils/invitation';
import { analyserMotDePasse, capsActif, lignesAide, type ProfilMdp } from './regles';
import { texte, type LangueSaisie } from './textes';
import { Icone } from '../icones';

/** Langue de l'écran : celle de l'invitation si elle en porte une, sinon celle du compte ou de l'appareil. */
export function useLangueSaisie(explicite?: LangueSaisie): LangueSaisie {
  const courante = useLangue();
  return explicite ?? courante;
}

const TAILLE = Platform.OS === 'web' ? 14 : 15;

function Bouton44({
  libelle,
  libelleLecteur,
  onPress,
  testID,
  desactive,
  alignDroite,
}: {
  libelle: string;
  libelleLecteur: string;
  onPress(): void;
  testID: string;
  desactive?: boolean;
  alignDroite?: boolean;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={libelleLecteur}
      accessibilityState={{ disabled: Boolean(desactive) }}
      disabled={desactive}
      onPress={onPress}
      testID={testID}
      hitSlop={4}
      style={[
        styles.bouton44,
        alignDroite ? { alignSelf: 'flex-end' } : { alignSelf: 'flex-start' },
        desactive ? { opacity: 0.5 } : null,
      ]}>
      <Text style={{ color: palette.accent, fontWeight: '600', fontSize: TAILLE + 1 }}>{libelle}</Text>
    </Pressable>
  );
}

/** Champ de mot de passe seul (mot de passe actuel, connexion), avec « Afficher / Masquer » de 44 px. */
export function ChampMotDePasse({
  etiquette,
  valeur,
  onChanger,
  nouveau = false,
  indication,
  onValider,
  testID,
  desactive = false,
  langue,
}: {
  etiquette: string;
  valeur: string;
  onChanger(v: string): void;
  nouveau?: boolean;
  indication?: string;
  onValider?(): void;
  testID: string;
  desactive?: boolean;
  langue?: LangueSaisie;
}) {
  const [visible, setVisible] = useState(false);
  const l = useLangueSaisie(langue);
  // Téléphone : le champ a déjà son bouton « Afficher » (ChampMobile, 44 px).
  const mobile = useMobile();
  return (
    <View style={{ gap: 4 }}>
      <Champ
        etiquette={etiquette}
        value={valeur}
        onChangeText={onChanger}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete={nouveau ? 'new-password' : 'current-password'}
        textContentType={nouveau ? 'newPassword' : 'password'}
        nature={nouveau ? 'nouveauMotDePasse' : 'motDePasse'}
        enterKeyHint={onValider ? 'go' : 'next'}
        onSubmitEditing={onValider}
        editable={!desactive}
        indication={indication}
        testID={testID}
      />
      {mobile ? null : (
        <Bouton44
          libelle={texte(l, visible ? 'bouton.masquer' : 'bouton.afficher')}
          libelleLecteur={texte(l, visible ? 'bouton.masquerLong' : 'bouton.afficherLong')}
          onPress={() => setVisible(v => !v)}
          testID={`${testID}-voir`}
          alignDroite
        />
      )}
    </View>
  );
}

export interface SaisieNouveauMotDePasseProps {
  profil: ProfilMdp;
  valeur: string;
  onChanger(v: string): void;
  confirmation: string;
  onChangerConfirmation(v: string): void;
  etiquette: string;
  etiquetteConfirmation: string;
  /** Identifiant (ou prénom) que le mot de passe ne doit pas reprendre (profil `ami`). */
  identifiant?: string;
  politique?: PolitiqueMdp;
  /** Profil `coffre` : longueur minimale (12 par défaut). */
  longueurMin?: number;
  langue?: LangueSaisie;
  desactive?: boolean;
  /** Entrée dans le champ de confirmation. */
  onValider?(): void;
  /** Identifiants de test des deux champs. */
  testIDs: { mdp: string; confirmation: string };
  /** Préfixe des autres éléments : `-aide`, `-force`, `-force-libelle`, `-regles`… */
  prefixe: string;
}

export function SaisieNouveauMotDePasse({
  profil,
  valeur,
  onChanger,
  confirmation,
  onChangerConfirmation,
  etiquette,
  etiquetteConfirmation,
  identifiant,
  politique,
  longueurMin,
  langue,
  desactive = false,
  onValider,
  testIDs,
  prefixe,
}: SaisieNouveauMotDePasseProps) {
  const palette = usePalette();
  const l = useLangueSaisie(langue);
  const [visible, setVisible] = useState(false);
  const [caps, setCaps] = useState(false);
  const enSaisie = useRef(false);

  const analyse = analyserMotDePasse({ profil, valeur, confirmation, identifiant, politique, longueurMin, langue: l });
  const aide = lignesAide(profil, l, { politique, longueurMin });
  const vide = valeur.length === 0;
  const couleursForce = [palette.danger, palette.danger, palette.accent, palette.hausse, palette.hausse];

  // Majuscules verrouillées (web seulement) : relu à chaque touche tant qu'un des champs a le focus.
  useEffect(() => {
    const doc = (globalThis as { document?: { addEventListener(t: string, f: (e: Event) => void, capture: boolean): void; removeEventListener(t: string, f: (e: Event) => void, capture: boolean): void } }).document;
    if (Platform.OS !== 'web' || !doc) return undefined;
    const maj = (e: Event) => {
      if (!enSaisie.current) return;
      const actif = capsActif(e);
      if (actif !== undefined) setCaps(actif);
    };
    doc.addEventListener('keydown', maj, true);
    doc.addEventListener('keyup', maj, true);
    return () => {
      doc.removeEventListener('keydown', maj, true);
      doc.removeEventListener('keyup', maj, true);
    };
  }, []);
  const auFocus = () => {
    enSaisie.current = true;
  };
  const alaPerteDuFocus = () => {
    enSaisie.current = false;
    setCaps(false);
  };

  const communs = {
    secureTextEntry: !visible,
    autoCapitalize: 'none' as const,
    autoCorrect: false,
    spellCheck: false,
    autoComplete: 'new-password' as const,
    textContentType: 'newPassword' as const,
    nature: 'nouveauMotDePasse' as const,
    editable: !desactive,
    boutonVoir: false,
    onFocus: auFocus,
    onBlur: alaPerteDuFocus,
  };

  return (
    <View style={{ gap: ESPACEMENT.s }}>
      {/* --- Ce qui est accepté --- */}
      <View style={[styles.cadre, { borderColor: palette.bordure, backgroundColor: palette.surfaceHaute }]} testID={`${prefixe}-aide`}>
        <Text accessibilityRole="header" style={{ color: palette.texte, fontWeight: '700', fontSize: TAILLE + 1 }}>
          {texte(l, 'aide.titre')}
        </Text>
        {aide.accepte.map(ligne => (
          <View key={ligne} style={styles.puce}>
            <Text style={{ color: palette.texteSecondaire, fontSize: TAILLE }}>•</Text>
            <Text style={{ color: palette.texte, fontSize: TAILLE, lineHeight: TAILLE + 7, flex: 1 }}>{ligne}</Text>
          </View>
        ))}
        <Text style={{ color: palette.texte, fontSize: TAILLE, lineHeight: TAILLE + 7, fontWeight: '600' }} testID={`${prefixe}-aide-conseil`}>
          <Icone nom="ampoule" /> {aide.conseil}
        </Text>
        <Text style={{ color: palette.texteSecondaire, fontSize: TAILLE, lineHeight: TAILLE + 7 }} testID={`${prefixe}-aide-rappel`}>
          <Icone nom="cadenas" /> {aide.rappel}
        </Text>
      </View>

      {/* --- Premier champ --- */}
      <Champ etiquette={etiquette} value={valeur} onChangeText={onChanger} testID={testIDs.mdp} {...communs} enterKeyHint="next" />
      <Bouton44
        libelle={texte(l, visible ? 'bouton.masquer' : 'bouton.afficher')}
        libelleLecteur={texte(l, visible ? 'bouton.masquerLong' : 'bouton.afficherLong')}
        onPress={() => setVisible(v => !v)}
        testID={`${testIDs.mdp}-voir`}
        alignDroite
      />
      {caps ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ color: palette.danger, fontWeight: '700', fontSize: TAILLE }} testID={`${prefixe}-majuscules`}>
          {`⇪ ${texte(l, 'erreur.majuscules')}`}
        </Text>
      ) : null}
      {analyse.problemes.length > 0 ? (
        <View accessibilityLiveRegion="polite" accessibilityRole="alert" testID={`${prefixe}-erreurs`}>
          {analyse.problemes.map(p => (
            <Text key={p} style={{ color: palette.danger, fontSize: TAILLE, lineHeight: TAILLE + 7 }}>
              {p}
            </Text>
          ))}
        </View>
      ) : null}

      {/* --- Force --- */}
      <View style={{ gap: 6 }} testID={`${prefixe}-force`}>
        <View style={{ flexDirection: 'row', gap: 4 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {[0, 1, 2, 3].map(i => (
            <View key={i} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: !vide && analyse.force > i ? couleursForce[analyse.force] : palette.bordure }} />
          ))}
        </View>
        <Text style={{ color: palette.texte, fontWeight: '700', fontSize: TAILLE }} testID={`${prefixe}-force-libelle`}>
          {analyse.libelleForceComplet}
        </Text>
        {analyse.explicationForce ? (
          <Text style={{ color: palette.texteSecondaire, fontSize: TAILLE, lineHeight: TAILLE + 7 }} testID={`${prefixe}-force-explication`}>
            {analyse.explicationForce}
          </Text>
        ) : null}
      </View>

      {/* --- Règles en direct --- */}
      <View style={{ gap: 2 }} testID={`${prefixe}-regles`} accessibilityRole="list">
        <Text style={{ color: palette.texteSecondaire, fontSize: TAILLE, fontWeight: '600' }}>{texte(l, 'regles.titre')}</Text>
        {analyse.regles.map(r => (
          <View
            key={r.id}
            accessible
            accessibilityRole="text"
            accessibilityLabel={texte(l, r.ok ? 'regle.ok' : 'regle.attente', { regle: r.libelle })}
            style={styles.regle}
            testID={`${prefixe}-regle-${r.id}`}>
            <Text style={{ color: r.ok ? palette.hausse : palette.texteSecondaire, fontWeight: '800', fontSize: TAILLE + 2, width: 22 }}>{r.ok ? '✓' : '○'}</Text>
            <Text style={{ color: palette.texte, fontSize: TAILLE, flex: 1 }}>{r.libelle}</Text>
          </View>
        ))}
      </View>

      {/* --- Confirmation --- */}
      <Champ
        etiquette={etiquetteConfirmation}
        value={confirmation}
        onChangeText={onChangerConfirmation}
        testID={testIDs.confirmation}
        {...communs}
        enterKeyHint={onValider ? 'go' : 'done'}
        onSubmitEditing={onValider}
      />
      {analyse.problemeConfirmation ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ color: palette.danger, fontSize: TAILLE, lineHeight: TAILLE + 7 }} testID={`${prefixe}-confirmation-erreur`}>
          {analyse.problemeConfirmation}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  cadre: { borderWidth: 1, borderRadius: RAYON.m, padding: ESPACEMENT.m, gap: ESPACEMENT.s },
  puce: { flexDirection: 'row', gap: 8 },
  regle: { flexDirection: 'row', alignItems: 'center', minHeight: 28 },
  bouton44: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: ESPACEMENT.m,
    borderRadius: RAYON.s,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
