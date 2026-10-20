/**
 * Champ de note en Markdown limité, avec une petite barre d'outils au-dessus :
 * Gras (B), Italique (I), liste à puces, lien, et un aperçu du rendu.
 * Raccourcis Ctrl/Cmd+B et Ctrl/Cmd+I (site et app PC) : ils entourent la
 * sélection de `**…**` ou `*…*` (logique pure : review/formatage.ts).
 *
 * Le rendu de l'aperçu passe par les composants de l'app (NoteMarkdown),
 * jamais par du HTML brut ; le serveur nettoie toujours la note.
 * Boutons de 44 px : utilisables au doigt sur iPhone et iPad.
 */

import React, { useRef, useState } from 'react';
import { Platform, Pressable, Text, TextInput, View, type StyleProp, type TextInputKeyPressEvent, type ViewStyle } from 'react-native';
import { police, teinteTransparente, type ThemeHub } from '../../hub/themes';
import { useMobile } from '../../ui/mobile/useMobile';
import { appliquerFormat, formatDuRaccourci, type Format, type Selection } from '../review/formatage';
import { ESP, rayonControle, type EtatPresse } from './design';
import { NoteMarkdown } from './review/Note';

const BOUTONS: ReadonlyArray<{ format: Format; glyphe: string; nom: string; style?: object }> = [
  { format: 'gras', glyphe: 'B', nom: 'Gras (Ctrl+B)', style: { fontWeight: '900' } },
  { format: 'italique', glyphe: 'I', nom: 'Italique (Ctrl+I)', style: { fontStyle: 'italic', fontWeight: '700' } },
  { format: 'liste', glyphe: '•≡', nom: 'Liste à puces' },
  { format: 'lien', glyphe: '🔗', nom: 'Lien' },
];

type NoeudTexte = { selectionStart?: number; selectionEnd?: number; setSelectionRange?(a: number, b: number): void; focus?(): void };

export function ChampNote({
  theme,
  libelle,
  valeur,
  onChanger,
  testID,
  maxLength,
  placeholder,
  apercu = 'bouton',
  testIDApercu,
  style,
}: {
  theme: ThemeHub;
  libelle: string;
  valeur: string;
  onChanger(v: string): void;
  testID: string;
  maxLength?: number;
  placeholder?: string;
  /** Aperçu du rendu : sur demande (bouton), toujours (dès qu'il y a du texte) ou jamais. */
  apercu?: 'bouton' | 'toujours' | 'jamais';
  testIDApercu?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const mobile = useMobile();
  const champ = useRef<React.ComponentRef<typeof TextInput>>(null);
  const selection = useRef<Selection>({ start: valeur.length, end: valeur.length });
  const [forcee, setForcee] = useState<Selection | undefined>();
  const [voir, setVoir] = useState(false);
  const web = Platform.OS === 'web';

  /** Sélection courante : lue sur le champ du navigateur (fiable même après la perte du focus), sinon la dernière connue. */
  const lire = (): Selection => {
    const n = champ.current as unknown as NoeudTexte | null;
    if (n && typeof n.selectionStart === 'number' && typeof n.selectionEnd === 'number') return { start: n.selectionStart, end: n.selectionEnd };
    return selection.current;
  };

  const appliquer = (format: Format) => {
    const e = appliquerFormat(valeur, lire(), format);
    const texte = maxLength ? e.texte.slice(0, maxLength) : e.texte;
    const sel = { start: Math.min(e.selection.start, texte.length), end: Math.min(e.selection.end, texte.length) };
    selection.current = sel;
    onChanger(texte);
    if (web) {
      // Après le rendu : le focus revient au champ, la sélection entoure le texte mis en forme.
      setTimeout(() => {
        const n = champ.current as unknown as NoeudTexte | null;
        n?.focus?.();
        n?.setSelectionRange?.(sel.start, sel.end);
      }, 0);
    } else setForcee(sel);
  };

  const touche = (e: TextInputKeyPressEvent) => {
    const format = formatDuRaccourci(e.nativeEvent as unknown as Parameters<typeof formatDuRaccourci>[0]);
    if (!format) return;
    e.preventDefault();
    appliquer(format);
  };

  const montrerApercu = apercu === 'toujours' ? valeur.trim() !== '' : apercu === 'bouton' && voir && valeur.trim() !== '';
  const bouton = (etat: EtatPresse, actif = false): ViewStyle => ({
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: ESP.xs,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: rayonControle(theme) === 999 ? 22 : Math.max(4, rayonControle(theme) - 2),
    borderWidth: 1,
    borderColor: actif || etat.hovered || etat.focused ? theme.accent : 'transparent',
    backgroundColor: actif ? teinteTransparente(theme.accent, 0.16) : etat.pressed ? teinteTransparente(theme.attenue, 0.18) : 'transparent',
  });

  return (
    <View style={[{ gap: 4 }, style]}>
      <Text style={{ color: theme.texte, fontWeight: '600', fontSize: 13, ...police(theme.policeTexte) }}>{libelle}</Text>
      <View style={{ borderWidth: 1, borderColor: theme.ligne, borderRadius: Math.min(theme.rayonMoyen, 10), backgroundColor: theme.fond, overflow: 'hidden' }}>
        <View
          accessibilityRole="toolbar"
          accessibilityLabel={`Mise en forme : ${libelle}`}
          testID={`${testID}-outils`}
          style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 2, padding: 2, borderBottomWidth: 1, borderBottomColor: theme.ligne, backgroundColor: theme.surface }}>
          {BOUTONS.map(b => (
            <Pressable
              key={b.format}
              testID={`${testID}-${b.format}`}
              accessibilityRole="button"
              accessibilityLabel={b.nom}
              // Le focus reste dans le champ (souris) : la sélection n'est pas perdue.
              {...(web ? { onMouseDown: (e: { preventDefault(): void }) => e.preventDefault() } : {})}
              onPress={() => appliquer(b.format)}
              style={(etat: EtatPresse) => bouton(etat)}>
              <Text style={{ color: theme.texte, fontSize: 16, ...police(theme.policeTexte), ...b.style }}>{b.glyphe}</Text>
            </Pressable>
          ))}
          {apercu === 'bouton' ? (
            <Pressable
              testID={`${testID}-voir-apercu`}
              accessibilityRole="button"
              accessibilityState={{ selected: voir }}
              accessibilityLabel={voir ? 'Masquer l’aperçu' : 'Voir l’aperçu du rendu'}
              onPress={() => setVoir(v => !v)}
              style={(etat: EtatPresse) => ({ ...bouton(etat, voir), marginLeft: 'auto', paddingHorizontal: ESP.s })}>
              <Text style={{ color: theme.texte, fontSize: 13, fontWeight: '600', ...police(theme.policeTexte) }}>Aperçu</Text>
            </Pressable>
          ) : null}
        </View>
        <TextInput
          ref={champ}
          testID={testID}
          accessibilityLabel={libelle}
          value={valeur}
          onChangeText={onChanger}
          onKeyPress={touche}
          onSelectionChange={e => {
            selection.current = e.nativeEvent.selection;
            if (forcee) setForcee(undefined);
          }}
          selection={web ? undefined : forcee}
          placeholder={placeholder}
          placeholderTextColor={theme.attenue}
          autoCapitalize="sentences"
          multiline
          maxLength={maxLength}
          style={{
            color: theme.texte,
            fontSize: 15,
            paddingVertical: 8,
            paddingHorizontal: 10,
            minHeight: mobile ? 96 : 84,
            textAlignVertical: 'top',
            ...police(theme.policeTexte),
          }}
        />
      </View>
      {montrerApercu ? (
        <View style={{ gap: 4, padding: ESP.xs, borderRadius: Math.min(theme.rayonMoyen, 10), backgroundColor: teinteTransparente(theme.attenue, 0.08) }}>
          <Text style={{ color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) }}>Aperçu</Text>
          <NoteMarkdown theme={theme} source={valeur} testID={testIDApercu ?? `${testID}-apercu`} />
        </View>
      ) : null}
    </View>
  );
}
