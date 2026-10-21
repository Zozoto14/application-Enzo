/**
 * Briques d'interface partagées par les sections de l'Administration :
 * panneaux, pastilles, champs, segments, cases. Couleurs et polices du thème
 * du hub ; cibles tactiles d'au moins 36 px (44 px sur téléphone) ; rôles d'accessibilité.
 */

import React from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import type { ControleProfils } from '../../../ui/ecrans/CarteProfils';
import type { Profil } from '../../../profils/profils';
import { police, teinteTransparente, type ThemeHub } from '../../themes';
import type { AppHub, ServicesAdmin } from '../../types';
import type { DonneesAdmin } from '../donnees';
import type { EvenementAudit } from '../journal';
import type { PolitiqueHub } from '../politique';
import type { RoleAdmin } from '../roles';
import { useMobile } from '../../../ui/mobile/useMobile';

export { BoutonHub } from '../../Hub';

/** Ce que chaque section reçoit de l'écran d'Administration. */
export interface OutilsAdmin {
  theme: ThemeHub;
  registre: readonly AppHub[];
  controle: ControleProfils;
  /** Le compte qui agit : chaque action est revérifiée contre son rôle (`roles.ts`). */
  acteur: Profil;
  role: RoleAdmin;
  /** Comptes que l'acteur peut voir et gérer (tous pour l'administrateur ; ses propres créations pour un gestionnaire). */
  tous: readonly Profil[];
  /** Tous les comptes de l'appareil, sans prénom pour un gestionnaire : chiffres du tableau de bord. */
  apercu: readonly Profil[];
  /** Politique globale des apps (activation, maintenance), lisible par tous. */
  politique?: PolitiqueHub;
  maintenant(): number;
  donnees: DonneesAdmin;
  majDonnees(changer: (donnees: DonneesAdmin) => DonneesAdmin): void;
  journaliser(evenement: Omit<EvenementAudit, 'date'>): void;
  /** Lance une action asynchrone avec indicateur, erreur et avis. */
  agir(libelle: string, action: () => Promise<string | void>): void;
  enCours?: string;
  /** Exécute `action` après une vérification d'identité récente (actions sensibles). */
  exigerIdentite(raison: string, action: () => void, forcer?: boolean): void;
  /** Transforme et enregistre la liste des profils, puis journalise. */
  modifierProfils(changer: (liste: readonly Profil[]) => Profil[], evenements: ReadonlyArray<Omit<EvenementAudit, 'date'>>, avis?: string): void;
  services?: ServicesAdmin;
  /** Ouvre la page Paramètres (unique), sur une section. */
  onParametres?(section?: import('../../recensement').IdSection): void;
  /** Ouvre une autre app du hub (ex. Abonnements depuis le tableau de bord). */
  onOuvrirApp?(id: string): void;
  /** Aller à une autre section (depuis le tableau de bord). */
  allerA(section: IdSection, cible?: string): void;
  large: boolean;
}

export type IdSection = 'tableau' | 'utilisateurs' | 'acces' | 'applications' | 'securite' | 'journal' | 'reglages' | 'support' | 'messagerie';

export function styleTitre(theme: ThemeHub) {
  return {
    color: theme.texte,
    fontWeight: theme.poidsTitre,
    textTransform: theme.majuscules ? ('uppercase' as const) : ('none' as const),
    ...police(theme.policeTitre),
  };
}

export function Panneau({ theme, children, style, testID }: { theme: ThemeHub; children: React.ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <View testID={testID} style={[commun.panneau, { borderColor: theme.ligne, backgroundColor: theme.surface, borderRadius: theme.rayonMoyen }, style]}>
      {children}
    </View>
  );
}

export function Intertitre({ theme, children }: { theme: ThemeHub; children: string }) {
  return (
    <Text style={[commun.intertitre, { color: theme.attenue, ...police(theme.policeTexte) }]} accessibilityRole="header">
      {children.toUpperCase()}
    </Text>
  );
}

export function Pilule({ theme, texte, couleur, testID }: { theme: ThemeHub; texte: string; couleur: string; testID?: string }) {
  return (
    <Text
      testID={testID}
      style={[
        commun.pilule,
        police(theme.policeChiffres),
        { color: theme.sombre ? couleur : theme.texte, borderColor: couleur, backgroundColor: teinteTransparente(couleur, 0.16), borderRadius: theme.rayonGrand ? 999 : 0 },
      ]}>
      {texte}
    </Text>
  );
}

export function Champ({
  theme,
  libelle,
  valeur,
  onChanger,
  testID,
  secret,
  placeholder,
  multiligne,
  clavier,
  maxLength,
  style,
}: {
  theme: ThemeHub;
  libelle: string;
  valeur: string;
  onChanger(v: string): void;
  testID?: string;
  secret?: boolean;
  placeholder?: string;
  multiligne?: boolean;
  clavier?: 'default' | 'number-pad';
  maxLength?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const mobile = useMobile();
  return (
    <View style={[{ gap: 4 }, style]}>
      <Text style={{ color: theme.texte, fontWeight: '600', fontSize: 13, ...police(theme.policeTexte) }}>{libelle}</Text>
      <TextInput
        testID={testID}
        accessibilityLabel={libelle}
        value={valeur}
        onChangeText={onChanger}
        secureTextEntry={secret}
        placeholder={placeholder}
        placeholderTextColor={theme.attenue}
        autoCapitalize="none"
        autoCorrect={false}
        multiline={multiligne}
        keyboardType={clavier}
        maxLength={maxLength}
        style={[
          commun.champ,
          { color: theme.texte, backgroundColor: theme.fond, borderColor: theme.ligne, borderRadius: Math.min(theme.rayonMoyen, 10), ...police(theme.policeTexte) },
          mobile && { minHeight: 44 },
          multiligne && { minHeight: 80, textAlignVertical: 'top' },
        ]}
      />
    </View>
  );
}

export function Segments<T extends string>({
  theme,
  libelle,
  valeur,
  options,
  onChoisir,
  testID,
}: {
  theme: ThemeHub;
  libelle: string;
  valeur: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChoisir(v: T): void;
  testID: string;
}) {
  const rayon = Math.min(theme.rayonMoyen, 10);
  // Téléphone : cibles de 44 px de haut.
  const mobile = useMobile();
  return (
    <View style={[commun.segments, { borderColor: theme.ligne, borderRadius: rayon }]} accessibilityRole="radiogroup" accessibilityLabel={libelle}>
      {options.map(([cle, texte]) => {
        const actif = cle === valeur;
        return (
          <Pressable
            key={cle}
            testID={`${testID}-${cle}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: actif }}
            accessibilityLabel={`${libelle} : ${texte}`}
            onPress={() => onChoisir(cle)}
            style={[commun.segment, mobile && { minHeight: 44 }, { backgroundColor: actif ? theme.accent : 'transparent' }]}>
            <Text style={{ color: actif ? theme.surAccent : theme.texte, fontWeight: '600', fontSize: 13, ...police(theme.policeTexte) }}>{texte}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Interrupteur({
  theme,
  libelle,
  valeur,
  onChanger,
  testID,
  desactive,
}: {
  theme: ThemeHub;
  libelle: string;
  valeur: boolean;
  onChanger(v: boolean): void;
  testID?: string;
  desactive?: boolean;
}) {
  return (
    <Switch
      testID={testID}
      accessibilityLabel={libelle}
      value={valeur}
      disabled={desactive}
      onValueChange={onChanger}
      trackColor={{ true: theme.teintes.admin, false: theme.ligne }}
    />
  );
}

/** Case à cocher accessible (sélection multiple). */
export function Case({ theme, coche, libelle, onChanger, testID }: { theme: ThemeHub; coche: boolean; libelle: string; onChanger(v: boolean): void; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: coche }}
      accessibilityLabel={libelle}
      onPress={() => onChanger(!coche)}
      // 22 px dessinés, 44 px touchables.
      hitSlop={11}
      style={[commun.case, { borderColor: coche ? theme.teintes.admin : theme.attenue, backgroundColor: coche ? theme.teintes.admin : 'transparent', borderRadius: 4 }]}>
      <Text style={{ color: theme.surAccent, fontSize: 13, fontWeight: '800' }}>{coche ? '✓' : ''}</Text>
    </Pressable>
  );
}

export function Avis({ theme, texte, genre, testID }: { theme: ThemeHub; texte: string; genre: 'ok' | 'alerte' | 'critique' | 'info'; testID?: string }) {
  const couleur = genre === 'ok' ? theme.ok : genre === 'alerte' ? theme.alerte : genre === 'critique' ? theme.critique : theme.accent;
  return (
    <Text
      testID={testID}
      accessibilityLiveRegion="polite"
      style={[commun.avis, { color: theme.texte, borderLeftColor: couleur, backgroundColor: teinteTransparente(couleur, 0.14), ...police(theme.policeTexte) }]}>
      {texte}
    </Text>
  );
}

/** Date lisible (fr-FR), ou « jamais ». */
export function dateLisible(iso: string | undefined, avecHeure = false): string {
  if (!iso) {
    return 'jamais';
  }
  const t = Date.parse(iso);
  if (Number.isNaN(t)) {
    return iso;
  }
  const d = new Date(t);
  return avecHeure
    ? d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('fr-FR');
}

/** « il y a 3 jours », « dans 2 jours ». */
export function relatif(iso: string | undefined, maintenant: number): string {
  if (!iso) {
    return 'jamais';
  }
  const ecart = Date.parse(iso) - maintenant;
  const jours = Math.round(Math.abs(ecart) / 86_400_000);
  const heures = Math.round(Math.abs(ecart) / 3_600_000);
  const quantite = jours >= 1 ? `${jours} jour${jours > 1 ? 's' : ''}` : heures >= 1 ? `${heures} h` : 'quelques minutes';
  return ecart < 0 ? `il y a ${quantite}` : `dans ${quantite}`;
}

/** AAAA-MM-JJ + n jours, en ISO (fin de journée UTC). */
export function dansJours(maintenant: number, jours: number): string {
  return new Date(maintenant + jours * 86_400_000).toISOString();
}

export const commun = StyleSheet.create({
  panneau: { borderWidth: 1, padding: 16, gap: 12, minWidth: 0 },
  intertitre: { fontSize: 11, fontWeight: '700', letterSpacing: 1.1, marginTop: 4 },
  pilule: { fontSize: 11, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden', borderWidth: 1 },
  champ: { borderWidth: 1, paddingVertical: 8, paddingHorizontal: 10, fontSize: 15, minHeight: 40 },
  segments: { flexDirection: 'row', flexWrap: 'wrap', borderWidth: 1, overflow: 'hidden', alignSelf: 'flex-start' },
  segment: { paddingVertical: 8, paddingHorizontal: 12, minHeight: 36, justifyContent: 'center' },
  case: { width: 22, height: 22, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  avis: { padding: 10, borderRadius: 8, fontSize: 13, borderLeftWidth: 4, overflow: 'hidden' },
  ligne: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  grille: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  carre: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
});
