/**
 * Petites commandes des écrans des visuels : nombre, couleur (jetons de la charte ou #RRGGBB), police,
 * liste déroulante simple en pastilles, section repliable. Communes à l'éditeur (site, PC), à la charte et
 * à la retouche sur téléphone.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Champ } from '../../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../../hub/themes';
import { couleurDe } from '../../../cm/visuels/charte';
import { CLES_COULEURS, POLICES, ROLES_POLICES, type Charte, type Couleur, type RefPolice } from '../../../cm/visuels/types';
import { trVi, type CleVi } from '../../../i18n/visuels';
import { styles } from '../../commun';
import { ESP, attenue, texte, type EtatPresse } from '../../design';

/** Champ numérique : la valeur n'est appliquée que si elle est lisible et dans les bornes. */
export function ChampNombre({ theme, libelle, valeur, onChanger, min, max, testID, largeur = 96 }: { theme: ThemeHub; libelle: string; valeur: number; onChanger(v: number): void; min: number; max: number; testID: string; largeur?: number }) {
  const [saisie, setSaisie] = useState(String(Math.round(valeur * 100) / 100));
  useEffect(() => setSaisie(String(Math.round(valeur * 100) / 100)), [valeur]);
  return (
    <Champ
      theme={theme}
      libelle={libelle}
      valeur={saisie}
      clavier="number-pad"
      maxLength={8}
      testID={testID}
      style={{ width: largeur }}
      onChanger={v => {
        setSaisie(v);
        const n = Number(v.replace(',', '.'));
        if (v.trim() !== '' && Number.isFinite(n) && n >= min && n <= max) onChanger(n);
      }}
    />
  );
}

/** Pastilles de choix (une valeur parmi quelques-unes). */
export function Pastilles<T extends string | number>({ theme, libelle, valeur, options, onChoisir, testID }: { theme: ThemeHub; libelle: string; valeur: T; options: ReadonlyArray<readonly [T, string]>; onChoisir(v: T): void; testID: string }) {
  return (
    <View style={{ gap: 4, maxWidth: '100%', flexShrink: 1 }}>
      <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{libelle}</Text>
      <View style={[styles.ligne, { gap: 4, flexWrap: 'wrap' }]} accessibilityRole="radiogroup" accessibilityLabel={libelle}>
        {options.map(([v, nom]) => {
          const actif = v === valeur;
          return (
            <Pressable
              key={String(v)}
              accessibilityRole="radio"
              accessibilityState={{ checked: actif }}
              accessibilityLabel={nom}
              onPress={() => onChoisir(v)}
              testID={`${testID}-${String(v).replace(/[^\w-]/g, '_')}`}
              style={(e: EtatPresse) => ({ minHeight: 36, paddingHorizontal: ESP.s, justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: actif ? theme.accent : theme.ligne, backgroundColor: actif ? theme.accent : e.hovered ? theme.surface : 'transparent' })}>
              <Text style={{ ...texte(theme, 13), color: actif ? theme.surAccent : theme.texte, fontWeight: actif ? '700' : '500' }}>{nom}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Couleur d'un calque : un jeton de la charte (suit la charte) ou une couleur libre #RRGGBB. */
export function CouleurChoix({ theme, libelle, valeur, charte, onChanger, testID }: { theme: ThemeHub; libelle: string; valeur: Couleur; charte: Charte; onChanger(c: Couleur): void; testID: string }) {
  const libre = !valeur.startsWith('charte:');
  const [hex, setHex] = useState(libre ? valeur : '');
  useEffect(() => setHex(valeur.startsWith('charte:') ? '' : valeur), [valeur]);
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{libelle}</Text>
      <View style={[styles.ligne, { gap: 4 }]} accessibilityRole="radiogroup" accessibilityLabel={libelle}>
        {CLES_COULEURS.map(k => {
          const jeton = `charte:${k}`;
          const actif = valeur === jeton;
          const nom = trVi(`charte.couleur.${k}` as CleVi);
          return (
            <Pressable
              key={k}
              accessibilityRole="radio"
              accessibilityState={{ checked: actif }}
              accessibilityLabel={nom}
              onPress={() => onChanger(jeton)}
              testID={`${testID}-${k}`}
              style={{ width: 32, height: 32, borderRadius: 8, borderWidth: actif ? 3 : 1, borderColor: actif ? theme.accent : theme.ligne, backgroundColor: couleurDe(jeton, charte) }}
            />
          );
        })}
        <Champ
          theme={theme}
          libelle={trVi('charte.hex')}
          valeur={hex}
          maxLength={9}
          testID={`${testID}-hex`}
          style={{ width: 130 }}
          onChanger={v => {
            setHex(v);
            if (/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(v.trim())) onChanger(v.trim().toLowerCase());
          }}
        />
      </View>
    </View>
  );
}

/** Police : un rôle de la charte (suit la charte) ou une des polices embarquées. */
export function PoliceChoix({ theme, valeur, charte, onChanger, testID }: { theme: ThemeHub; valeur: RefPolice; charte: Charte; onChanger(p: RefPolice): void; testID: string }) {
  const options: Array<readonly [RefPolice, string]> = [
    ...ROLES_POLICES.map(r => [`charte:${r}` as RefPolice, `${trVi(`charte.police.${r}` as CleVi)} (${charte.polices[r]})`] as const),
    ...POLICES.map(p => [p, p] as const),
  ];
  return <Pastilles theme={theme} libelle={trVi('editeur.police')} valeur={valeur} options={options} onChoisir={onChanger} testID={testID} />;
}

/** Section repliable d'un panneau de propriétés. */
export function Section({ theme, titre, children, ouverte = true, testID }: { theme: ThemeHub; titre: string; children: React.ReactNode; ouverte?: boolean; testID: string }) {
  const [o, setO] = useState(ouverte);
  return (
    <View style={{ gap: ESP.xs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xs }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: o }} onPress={() => setO(!o)} testID={testID} style={{ minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{titre}</Text>
        <Text style={attenue(theme, 14)}>{o ? '▾' : '▸'}</Text>
      </Pressable>
      {o ? <View style={{ gap: ESP.xs }}>{children}</View> : null}
    </View>
  );
}
