/**
 * Calendrier (grille d'un mois, semaine du lundi) et panneau d'heures des sélecteurs de dates.
 * Rendus dans la bulle (`Flottant`) des champs, mêmes composants sur le site, le PC et le téléphone.
 *
 * Clavier (site et PC) : flèches (jour, semaine), Page préc./suiv. (mois, Maj : année),
 * Début/Fin (semaine), Entrée ou Espace (choisir), Échap (fermer, géré par la bulle).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { Icone } from '../icones';
import { police, teinteTransparente, type ThemeHub } from '../../hub/themes';
import {
  ajouterJours,
  ajouterMois,
  debutMois,
  formaterComplet,
  grilleMois,
  joursCourts,
  jourPermis,
  lundiDe,
  minutesProposees,
  parties,
  texteDates,
  titreMois,
  type LangueDates,
} from './logique';

/** Couleurs utiles aux sélecteurs : un thème du hub convient tel quel. */
export type PaletteDates = Pick<ThemeHub, 'sombre' | 'fond' | 'surface' | 'texte' | 'attenue' | 'ligne' | 'accent' | 'surAccent' | 'critique' | 'rayonMoyen'> & {
  policeTexte?: string;
  policeChiffres?: string;
};

type EtatPresse = { pressed: boolean; hovered?: boolean; focused?: boolean };
type Focalisable = { focus?: () => void };
/** `onKeyDown` existe sur le site (react-native-web), pas dans les types natifs. */
const clavier = (f: (e: { key: string; shiftKey?: boolean; preventDefault?: () => void }) => void) => (Platform.OS === 'web' ? ({ onKeyDown: f } as object) : {});

export function BoutonIcone({
  palette,
  nom,
  libelle,
  onPress,
  testID,
  taille = 36,
  desactive,
}: {
  palette: PaletteDates;
  nom: React.ComponentProps<typeof Icone>['nom'];
  libelle: string;
  onPress(): void;
  testID?: string;
  taille?: number;
  desactive?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={libelle}
      accessibilityState={{ disabled: !!desactive }}
      disabled={desactive}
      onPress={onPress}
      hitSlop={4}
      style={(e: EtatPresse) => ({
        width: taille,
        height: taille,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: Math.min(palette.rayonMoyen, 10),
        borderWidth: 1,
        borderColor: e.hovered || e.focused ? palette.accent : palette.ligne,
        backgroundColor: e.pressed ? teinteTransparente(palette.accent, 0.16) : palette.surface,
        opacity: desactive ? 0.4 : 1,
      })}>
      <Icone nom={nom} taille={18} couleur={palette.texte} />
    </Pressable>
  );
}

/** Petite pastille d'action (raccourcis « Aujourd'hui », « 18:00 »…). */
export function Pastille({
  palette,
  libelle,
  onPress,
  actif,
  testID,
  mobile,
  desactive,
}: {
  palette: PaletteDates;
  libelle: string;
  onPress(): void;
  actif?: boolean;
  testID?: string;
  mobile?: boolean;
  desactive?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={libelle}
      accessibilityState={{ selected: !!actif, disabled: !!desactive }}
      disabled={desactive}
      onPress={onPress}
      style={(e: EtatPresse) => ({
        minHeight: mobile ? 40 : 32,
        paddingHorizontal: 10,
        justifyContent: 'center',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: actif || e.hovered || e.focused ? palette.accent : palette.ligne,
        backgroundColor: actif ? teinteTransparente(palette.accent, 0.2) : e.pressed ? teinteTransparente(palette.accent, 0.1) : palette.surface,
        opacity: desactive ? 0.4 : 1,
      })}>
      <Text style={{ color: palette.texte, fontSize: 13, fontWeight: actif ? '700' : '500', ...police(palette.policeTexte) }}>{libelle}</Text>
    </Pressable>
  );
}

export interface ProprietesCalendrier {
  palette: PaletteDates;
  langue: LangueDates;
  /** Jour choisi (« AAAA-MM-JJ »). */
  valeur?: string;
  /** Période mise en évidence (sélecteur de période). */
  plage?: { du?: string; au?: string };
  min?: string;
  max?: string;
  desactive?: (iso: string) => boolean;
  /** Aujourd'hui (fuseau du champ). */
  reference: string;
  onChoisir(iso: string): void;
  testID: string;
  mobile?: boolean;
}

export function Calendrier({ palette, langue, valeur, plage, min, max, desactive, reference, onChoisir, testID, mobile }: ProprietesCalendrier) {
  const depart = valeur ?? plage?.du ?? plage?.au ?? reference;
  const [mois, setMois] = useState(() => debutMois(depart));
  const [curseur, setCurseur] = useState(depart);
  const refs = useRef(new Map<string, Focalisable | null>());
  const doitFocaliser = useRef(true);
  const { annee, mois: m } = parties(mois);
  const jours = useMemo(() => grilleMois(annee, m), [annee, m]);
  const cote = mobile ? 44 : 38;

  useEffect(() => {
    if (!doitFocaliser.current) return;
    doitFocaliser.current = false;
    // Le temps que la bulle s'affiche (site) : le jour courant prend le focus clavier.
    const essais = [40, 160, 400].map(d => setTimeout(() => refs.current.get(curseur)?.focus?.(), d));
    return () => essais.forEach(clearTimeout);
  }, [curseur, mois]);

  const deplacer = (iso: string) => {
    doitFocaliser.current = true;
    setCurseur(iso);
    if (debutMois(iso) !== mois) setMois(debutMois(iso));
  };
  const changerMois = (n: number) => {
    const nouveau = ajouterMois(mois, n);
    setMois(nouveau);
    setCurseur(ajouterMois(curseur, n));
  };
  const touche = (e: { key: string; shiftKey?: boolean; preventDefault?: () => void }) => {
    const iso = curseur;
    const pas: Record<string, () => string> = {
      ArrowLeft: () => ajouterJours(iso, -1),
      ArrowRight: () => ajouterJours(iso, 1),
      ArrowUp: () => ajouterJours(iso, -7),
      ArrowDown: () => ajouterJours(iso, 7),
      PageUp: () => ajouterMois(iso, e.shiftKey ? -12 : -1),
      PageDown: () => ajouterMois(iso, e.shiftKey ? 12 : 1),
      Home: () => lundiDe(iso),
      End: () => ajouterJours(lundiDe(iso), 6),
    };
    const f = pas[e.key];
    if (!f) return;
    e.preventDefault?.();
    deplacer(f());
  };

  const enPlage = (iso: string) => !!(plage?.du && plage?.au && iso >= plage.du && iso <= plage.au);
  const texteJour = { ...police(palette.policeChiffres ?? palette.policeTexte), fontSize: mobile ? 16 : 14 };

  return (
    <View testID={testID} style={{ gap: 6, alignSelf: 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <BoutonIcone palette={palette} nom="chevron-gauche" libelle={texteDates(langue, 'precedent')} onPress={() => changerMois(-1)} testID={`${testID}-precedent`} taille={mobile ? 44 : 36} />
        <Text
          accessibilityRole="header"
          accessibilityLiveRegion="polite"
          testID={`${testID}-titre`}
          style={{ color: palette.texte, fontWeight: '700', fontSize: 15, textTransform: 'capitalize', ...police(palette.policeTexte) }}>
          {titreMois(annee, m, langue)}
        </Text>
        <BoutonIcone palette={palette} nom="chevron-droite" libelle={texteDates(langue, 'suivant')} onPress={() => changerMois(1)} testID={`${testID}-suivant`} taille={mobile ? 44 : 36} />
      </View>
      <View style={{ flexDirection: 'row' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {joursCourts(langue).map((j, i) => (
          <Text key={i} style={{ width: cote, textAlign: 'center', color: palette.attenue, fontSize: 12, fontWeight: '600', ...police(palette.policeTexte) }}>
            {j}
          </Text>
        ))}
      </View>
      <View accessibilityRole={'grid' as never} accessibilityLabel={titreMois(annee, m, langue)} {...clavier(touche)}>
        {[0, 1, 2, 3, 4, 5].map(semaine => (
          <View key={semaine} style={{ flexDirection: 'row' }} accessibilityRole={'row' as never}>
            {jours.slice(semaine * 7, semaine * 7 + 7).map(iso => {
              const dansMois = iso.slice(0, 7) === mois.slice(0, 7);
              const permis = jourPermis(iso, { min, max, desactive });
              const choisi = iso === valeur || iso === plage?.du || iso === plage?.au;
              const estAujourdhui = iso === reference;
              const intervalle = !choisi && enPlage(iso);
              return (
                <Pressable
                  key={iso}
                  ref={(r: unknown) => {
                    refs.current.set(iso, r as Focalisable | null);
                  }}
                  testID={`${testID}-jour-${iso}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${formaterComplet(iso, langue)}${permis ? '' : ` (${texteDates(langue, 'indisponible')})`}`}
                  accessibilityState={{ selected: choisi, disabled: !permis }}
                  disabled={!permis}
                  focusable={iso === curseur}
                  onFocus={() => iso !== curseur && setCurseur(iso)}
                  onPress={() => onChoisir(iso)}
                  style={(e: EtatPresse) => ({
                    width: cote,
                    height: cote,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: cote / 2,
                    borderWidth: estAujourdhui || e.focused ? 2 : 0,
                    borderColor: e.focused ? palette.texte : palette.accent,
                    backgroundColor: choisi ? palette.accent : intervalle ? teinteTransparente(palette.accent, 0.18) : e.hovered && permis ? teinteTransparente(palette.accent, 0.12) : 'transparent',
                  })}>
                  <Text
                    style={{
                      ...texteJour,
                      color: choisi ? palette.surAccent : permis ? (dansMois ? palette.texte : palette.attenue) : palette.attenue,
                      opacity: permis ? (dansMois ? 1 : 0.6) : 0.35,
                      fontWeight: choisi || estAujourdhui ? '800' : '500',
                      textDecorationLine: permis ? 'none' : 'line-through',
                    }}>
                    {Number(iso.slice(8, 10))}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

/** Choix d'une heure : raccourcis, puis heures et minutes (pas de 5 ou 15 min). */
export function PanneauHeure({
  palette,
  langue,
  valeur,
  pas,
  raccourcis,
  onChoisir,
  testID,
  mobile,
}: {
  palette: PaletteDates;
  langue: LangueDates;
  valeur?: string;
  pas: number;
  raccourcis: readonly string[];
  /** `fini` : les minutes sont choisies, la bulle peut se fermer. */
  onChoisir(heure: string, fini: boolean): void;
  testID: string;
  mobile?: boolean;
}) {
  const h = valeur ? Number(valeur.slice(0, 2)) : undefined;
  const min = valeur ? Number(valeur.slice(3, 5)) : undefined;
  const deux = (n: number) => String(n).padStart(2, '0');
  const cellule = mobile ? 44 : 36;
  const intertitre = { color: palette.attenue, fontSize: 12, fontWeight: '700' as const, ...police(palette.policeTexte) };
  const case_ = (libelle: string, actif: boolean, onPress: () => void, id: string, a11y: string) => (
    <Pressable
      key={id}
      testID={`${testID}-${id}`}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ selected: actif }}
      onPress={onPress}
      style={(e: EtatPresse) => ({
        width: cellule + 4,
        height: cellule,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: Math.min(palette.rayonMoyen, 8),
        borderWidth: e.focused ? 2 : 1,
        borderColor: actif ? palette.accent : e.hovered || e.focused ? palette.accent : palette.ligne,
        backgroundColor: actif ? palette.accent : palette.surface,
      })}>
      <Text style={{ color: actif ? palette.surAccent : palette.texte, fontSize: mobile ? 15 : 13, fontWeight: actif ? '800' : '500', ...police(palette.policeChiffres ?? palette.policeTexte) }}>{libelle}</Text>
    </Pressable>
  );
  return (
    <View testID={testID} style={{ gap: 8 }}>
      {raccourcis.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {raccourcis.map(r => (
            <Pastille key={r} palette={palette} libelle={r} actif={r === valeur} onPress={() => onChoisir(r, true)} testID={`${testID}-raccourci-${r}`} mobile={mobile} />
          ))}
        </View>
      ) : null}
      <Text style={intertitre}>{texteDates(langue, 'heures').toUpperCase()}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, maxWidth: (cellule + 8) * (mobile ? 6 : 8) }}>
        {Array.from({ length: 24 }, (_, i) => case_(deux(i), i === h, () => onChoisir(`${deux(i)}:${deux(min !== undefined && min % pas === 0 ? min : 0)}`, false), `h-${deux(i)}`, `${deux(i)} h`))}
      </View>
      <Text style={intertitre}>{texteDates(langue, 'minutes').toUpperCase()}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, maxWidth: (cellule + 8) * (mobile ? 6 : 8) }}>
        {minutesProposees(pas).map(mn => case_(`:${deux(mn)}`, mn === min, () => onChoisir(`${deux(h ?? 12)}:${deux(mn)}`, true), `m-${deux(mn)}`, `${deux(h ?? 12)}:${deux(mn)}`))}
      </View>
    </View>
  );
}
