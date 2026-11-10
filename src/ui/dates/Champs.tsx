/**
 * Champs de date de tout l'AppDashboard : un toucher ou un clic ouvre un calendrier (bulle), la
 * saisie au clavier reste possible et tolérante (« 9/11 », « 9 nov », « 09/11/2026 », ISO collé).
 *
 *  - `ChampDate`      : un jour ; valeur « AAAA-MM-JJ » (format `iso`, défaut) ou « JJ/MM/AAAA » (`fr`).
 *  - `ChampHeure`     : une heure « HH:MM » (pas de 5 ou 15 min, raccourcis).
 *  - `ChampDateHeure` : un instant mural « AAAA-MM-JJ HH:MM » (calendrier + heure dans la même bulle).
 *  - `ChampPeriode`   : deux jours « du / au » liés (le second ne peut précéder le premier) et
 *                       raccourcis de période (7 derniers jours, ce mois-ci…).
 *  - `BoutonCalendrier` : le seul bouton calendrier, pour un champ en langage naturel (Tâches).
 *
 * Les valeurs échangées avec les écrans gardent leur format d'avant. Tant que le texte saisi est
 * illisible, il est transmis tel quel : l'écran garde sa validation (« Date invalide… »).
 * Thèmes du hub, clair et sombre ; cibles tactiles de 44 px sur téléphone.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { police } from '../../hub/themes';
import { useMobile } from '../mobile/useMobile';
import { BoutonIcone, Calendrier, PanneauHeure, Pastille, type PaletteDates } from './Calendrier';
import { useLangueDates } from './langue';
import {
  analyserDate,
  analyserHeure,
  aujourdhui,
  ecrireValeur,
  estHeure,
  estJour,
  formaterLisible,
  formaterSaisie,
  jourPermis,
  jourRaccourci,
  lireInstantMural,
  lireValeur,
  periodeRaccourci,
  texteDates,
  type FormatDate,
  type IdRaccourci,
  type IdRaccourciPeriode,
  type LangueDates,
} from './logique';

export type { PaletteDates } from './Calendrier';

const RACCOURCIS_DEFAUT: readonly IdRaccourci[] = ['aujourdhui', 'demain', 'lundi', 'semaine'];
const PERIODES_DEFAUT: readonly IdRaccourciPeriode[] = ['7j', '30j', 'mois', 'mois-precedent'];
export const HEURES_RAPIDES: readonly string[] = ['09:00', '12:00', '14:00', '18:00', '20:00', '21:00'];

// --- Briques ------------------------------------------------------------------------------------

function Libelle({ palette, texte }: { palette: PaletteDates; texte: string }) {
  if (!texte) return null;
  return <Text style={{ color: palette.texte, fontWeight: '600', fontSize: 13, ...police(palette.policeTexte) }}>{texte}</Text>;
}

function MessageErreur({ palette, texte, testID }: { palette: PaletteDates; texte?: string; testID?: string }) {
  if (!texte) return null;
  return (
    <Text testID={testID} accessibilityLiveRegion="polite" style={{ color: palette.critique, fontSize: 12, ...police(palette.policeTexte) }}>
      {texte}
    </Text>
  );
}

/** Bulle par-dessus l'écran : centrée sur grand écran, posée en bas sur téléphone. Échap ou un toucher à côté la ferment. */
export function Flottant({
  palette,
  visible,
  onFermer,
  titre,
  children,
  testID,
  langue,
}: {
  palette: PaletteDates;
  visible: boolean;
  onFermer(): void;
  titre: string;
  children: React.ReactNode;
  testID: string;
  langue: LangueDates;
}) {
  const mobile = useMobile();
  const { height } = useWindowDimensions();
  if (!visible) return null;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onFermer} supportedOrientations={['portrait', 'landscape']}>
      <View style={{ flex: 1, justifyContent: mobile ? 'flex-end' : 'center', alignItems: 'center', padding: mobile ? 0 : 16 }}>
        <Pressable
          testID={`${testID}-fond`}
          accessibilityRole="button"
          accessibilityLabel={texteDates(langue, 'fermer')}
          onPress={onFermer}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: palette.sombre ? 'rgba(0,0,0,0.55)' : 'rgba(15,23,42,0.35)' }}
        />
        <View
          testID={testID}
          accessibilityViewIsModal
          accessibilityLabel={titre}
          {...(Platform.OS === 'web' ? ({ role: 'dialog', 'aria-modal': true } as object) : {})}
          style={{
            backgroundColor: palette.surface,
            borderColor: palette.ligne,
            borderWidth: 1,
            borderRadius: mobile ? 0 : Math.min(palette.rayonMoyen + 4, 16),
            borderTopLeftRadius: Math.min(palette.rayonMoyen + 4, 16),
            borderTopRightRadius: Math.min(palette.rayonMoyen + 4, 16),
            width: mobile ? '100%' : undefined,
            maxWidth: mobile ? undefined : 420,
            maxHeight: height * (mobile ? 0.9 : 0.92),
            shadowColor: '#000',
            shadowOpacity: 0.25,
            shadowRadius: 18,
            shadowOffset: { width: 0, height: 8 },
            elevation: 12,
          }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 14, paddingTop: 10 }}>
            <Text numberOfLines={1} style={{ flex: 1, color: palette.attenue, fontSize: 13, fontWeight: '600', ...police(palette.policeTexte) }}>
              {titre}
            </Text>
            <BoutonIcone palette={palette} nom="croix" libelle={texteDates(langue, 'fermer')} onPress={onFermer} testID={`${testID}-fermer`} taille={mobile ? 44 : 32} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 14, paddingTop: 8, gap: 12, paddingBottom: mobile ? 28 : 14 }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function styleSaisie(palette: PaletteDates, mobile: boolean, invalide: boolean) {
  return {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: mobile ? 16 : 14,
    minHeight: mobile ? 44 : 38,
    color: palette.texte,
    backgroundColor: palette.fond,
    borderColor: invalide ? palette.critique : palette.ligne,
    borderRadius: Math.min(palette.rayonMoyen, 10),
    ...police(palette.policeChiffres ?? palette.policeTexte),
  };
}

/**
 * Garde le texte du champ et ne le réécrit que si l'écran change la valeur lui-même. Un écran qui
 * ne garde que les valeurs lisibles (texte illisible → vide) n'efface pas la saisie en cours.
 */
function useTexteSynchronise(valeur: string, afficher: (v: string) => string, lisible: (v: string) => boolean) {
  const [texte, setTexte] = useState(() => afficher(valeur));
  const emise = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (valeur === emise.current) return;
    if (!valeur && emise.current !== undefined && !lisible(emise.current)) return;
    emise.current = undefined;
    setTexte(afficher(valeur));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seule la valeur de l'écran compte.
  }, [valeur]);
  return { texte, setTexte, emise };
}

// --- ChampDate ----------------------------------------------------------------------------------

export interface ProprietesChampDate {
  theme: PaletteDates;
  libelle: string;
  valeur: string;
  onChanger(v: string): void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  /** Format de la valeur échangée : « AAAA-MM-JJ » (défaut) ou « JJ/MM/AAAA ». */
  format?: FormatDate;
  min?: string;
  max?: string;
  desactive?: (iso: string) => boolean;
  /** Fuseau du « aujourd'hui » (team, club) ; à défaut, celui de l'appareil. */
  fuseau?: string;
  langue?: LangueDates;
  placeholder?: string;
  /** Raccourcis de la bulle ; `false` : aucun. */
  raccourcis?: readonly IdRaccourci[] | false;
  /** Bouton « Effacer » dans la bulle (défaut : oui). */
  effacable?: boolean;
  /** Période mise en évidence dans le calendrier. */
  plage?: { du?: string; au?: string };
  /** Actions propres en tête de bulle (raccourcis de période…). */
  actions?: ReadonlyArray<{ id: string; libelle: string; faire(): void }>;
  editable?: boolean;
  /** Petite aide sous le champ. */
  aide?: string;
  /** Pour les tests : « maintenant ». */
  maintenant?: number;
}

export function ChampDate({
  theme: palette,
  libelle,
  valeur,
  onChanger,
  testID = 'champ-date',
  style,
  format = 'iso',
  min,
  max,
  desactive,
  fuseau,
  langue: langueForcee,
  placeholder,
  raccourcis = RACCOURCIS_DEFAUT,
  effacable = true,
  plage,
  actions,
  editable = true,
  aide,
  maintenant,
}: ProprietesChampDate) {
  const mobile = useMobile();
  const langue = useLangueDates(langueForcee);
  const [ouvert, setOuvert] = useState(false);
  const [touche, setTouche] = useState(false);
  const afficher = (v: string) => {
    const iso = lireValeur(v, format);
    return iso ? formaterSaisie(iso) : v ?? '';
  };
  const { texte, setTexte, emise } = useTexteSynchronise(valeur, afficher, v => !!lireValeur(v, format));
  const reference = aujourdhui(fuseau, maintenant);
  const choisi = lireValeur(valeur, format);
  const lu = texte.trim() ? analyserDate(texte, reference) : undefined;
  const bornes = { min, max, desactive };
  const erreur = !texte.trim() || !touche ? undefined : !lu ? texteDates(langue, 'invalide') : !jourPermis(lu, bornes) ? texteDates(langue, 'horsBornes') : undefined;

  const emettre = (v: string) => {
    emise.current = v;
    onChanger(v);
  };
  const saisir = (t: string) => {
    setTexte(t);
    if (!t.trim()) return emettre('');
    const iso = analyserDate(t, reference);
    emettre(iso ? ecrireValeur(iso, format) : t);
  };
  const choisir = (iso: string) => {
    setTexte(formaterSaisie(iso));
    setTouche(true);
    emettre(ecrireValeur(iso, format));
    setOuvert(false);
  };
  const effacer = () => {
    setTexte('');
    emettre('');
    setOuvert(false);
  };

  return (
    <View style={[{ gap: 4 }, style]}>
      <Libelle palette={palette} texte={libelle} />
      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
        <TextInput
          testID={testID}
          accessibilityLabel={libelle}
          accessibilityHint={lu ? formaterLisible(lu, langue) : undefined}
          value={texte}
          onChangeText={saisir}
          onBlur={() => {
            setTouche(true);
            if (lu) setTexte(formaterSaisie(lu));
          }}
          editable={editable}
          placeholder={placeholder ?? texteDates(langue, 'placeholder')}
          placeholderTextColor={palette.attenue}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={40}
          inputMode="text"
          style={styleSaisie(palette, mobile, !!erreur)}
        />
        <BoutonIcone
          palette={palette}
          nom="calendrier"
          libelle={`${texteDates(langue, 'ouvrir')}${libelle ? ` : ${libelle}` : ''}`}
          onPress={() => setOuvert(true)}
          testID={`${testID}-ouvrir`}
          taille={mobile ? 44 : 38}
          desactive={!editable}
        />
      </View>
      <MessageErreur palette={palette} texte={erreur} testID={`${testID}-erreur`} />
      {aide ? <Text style={{ color: palette.attenue, fontSize: 12, ...police(palette.policeTexte) }}>{aide}</Text> : null}
      <Flottant palette={palette} visible={ouvert} onFermer={() => setOuvert(false)} titre={libelle || texteDates(langue, 'date')} testID={`${testID}-bulle`} langue={langue}>
        {actions?.length || raccourcis ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {(actions ?? []).map(a => (
              <Pastille
                key={a.id}
                palette={palette}
                libelle={a.libelle}
                mobile={mobile}
                testID={`${testID}-action-${a.id}`}
                onPress={() => {
                  a.faire();
                  setOuvert(false);
                }}
              />
            ))}
            {(raccourcis || []).map(id => {
              const jour = jourRaccourci(id, reference, choisi);
              return (
                <Pastille
                  key={id}
                  palette={palette}
                  libelle={texteDates(langue, id)}
                  actif={jour === choisi}
                  desactive={!jourPermis(jour, bornes)}
                  mobile={mobile}
                  testID={`${testID}-raccourci-${id}`}
                  onPress={() => choisir(jour)}
                />
              );
            })}
          </View>
        ) : null}
        <Calendrier
          palette={palette}
          langue={langue}
          valeur={choisi}
          plage={plage}
          min={min}
          max={max}
          desactive={desactive}
          reference={reference}
          onChoisir={choisir}
          testID={`${testID}-calendrier`}
          mobile={mobile}
        />
        {effacable && (choisi || texte) ? (
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
            <Pastille palette={palette} libelle={texteDates(langue, 'effacer')} onPress={effacer} testID={`${testID}-effacer`} mobile={mobile} />
          </View>
        ) : null}
      </Flottant>
    </View>
  );
}

// --- ChampHeure ---------------------------------------------------------------------------------

export interface ProprietesChampHeure {
  theme: PaletteDates;
  libelle: string;
  valeur: string;
  onChanger(v: string): void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  /** Pas des minutes proposées (5 ou 15, défaut 15). */
  pas?: number;
  /** Heures proposées en pastilles ; `[]` : aucune. */
  raccourcis?: readonly string[];
  langue?: LangueDates;
  placeholder?: string;
  editable?: boolean;
  onBlur?(): void;
  /** Nom lu par les lecteurs d'écran quand le libellé visible est ailleurs (`libelle` vide). */
  accessibilityLabel?: string;
}

export function ChampHeure({
  theme: palette,
  libelle,
  valeur,
  onChanger,
  testID = 'champ-heure',
  style,
  pas = 15,
  raccourcis = HEURES_RAPIDES,
  langue: langueForcee,
  placeholder,
  editable = true,
  onBlur,
  accessibilityLabel,
}: ProprietesChampHeure) {
  const mobile = useMobile();
  const langue = useLangueDates(langueForcee);
  const [ouvert, setOuvert] = useState(false);
  const [touche, setTouche] = useState(false);
  const { texte, setTexte, emise } = useTexteSynchronise(valeur, v => v ?? '', estHeure);
  const lu = texte.trim() ? analyserHeure(texte) : undefined;
  const erreur = touche && texte.trim() && !lu ? texteDates(langue, 'invalideHeure') : undefined;
  const emettre = (v: string) => {
    emise.current = v;
    onChanger(v);
  };
  const saisir = (t: string) => {
    setTexte(t);
    // Une heure « complète » part tout de suite (18:30, 18h30, 1830, 18h, 6pm) ; « 9 » attend la sortie du champ.
    const h = analyserHeure(t);
    const complete = /^\d{3,4}$/.test(t.trim()) || /[:h.]\s*\d{2}$/i.test(t.trim()) || /h$/i.test(t.trim()) || /(am|pm)$/i.test(t.trim()) || /^[a-z]+$/i.test(t.trim());
    emettre(t.trim() ? (h && complete ? h : t) : '');
  };
  const choisir = (h: string, fini: boolean) => {
    setTexte(h);
    setTouche(true);
    emettre(h);
    if (fini) setOuvert(false);
  };
  return (
    <View style={[{ gap: 4 }, style]}>
      <Libelle palette={palette} texte={libelle} />
      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
        <TextInput
          testID={testID}
          accessibilityLabel={accessibilityLabel ?? libelle}
          value={texte}
          onChangeText={saisir}
          onBlur={() => {
            setTouche(true);
            if (lu) {
              setTexte(lu);
              if (lu !== valeur) emettre(lu);
            }
            onBlur?.();
          }}
          editable={editable}
          placeholder={placeholder ?? texteDates(langue, 'placeholderHeure')}
          placeholderTextColor={palette.attenue}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={12}
          style={styleSaisie(palette, mobile, !!erreur)}
        />
        <BoutonIcone
          palette={palette}
          nom="chrono"
          libelle={`${texteDates(langue, 'ouvrirHeure')}${accessibilityLabel ?? libelle ? ` : ${accessibilityLabel ?? libelle}` : ''}`}
          onPress={() => setOuvert(true)}
          testID={`${testID}-ouvrir`}
          taille={mobile ? 44 : 38}
          desactive={!editable}
        />
      </View>
      <MessageErreur palette={palette} texte={erreur} testID={`${testID}-erreur`} />
      <Flottant palette={palette} visible={ouvert} onFermer={() => setOuvert(false)} titre={libelle || accessibilityLabel || texteDates(langue, 'heure')} testID={`${testID}-bulle`} langue={langue}>
        <PanneauHeure palette={palette} langue={langue} valeur={estHeure(valeur) ? valeur : lu} pas={pas} raccourcis={raccourcis} onChoisir={choisir} testID={`${testID}-panneau`} mobile={mobile} />
      </Flottant>
    </View>
  );
}

// --- ChampDateHeure -----------------------------------------------------------------------------

/** « 31/10 18h », « 2026-10-31 18:00 », « demain 9h » → « AAAA-MM-JJ HH:MM ». */
export function analyserInstant(texte: string, reference: string): string | undefined {
  const brut = lireInstantMural(texte);
  if (brut) return `${brut.date} ${brut.heure}`;
  const m = /^(.*?)(?:\s*(?:,|à|a|at|@|\s)\s*)(\S+)$/i.exec(texte.trim());
  if (!m) return undefined;
  const d = analyserDate(m[1], reference);
  const h = analyserHeure(m[2]);
  return d && h ? `${d} ${h}` : undefined;
}

export interface ProprietesChampDateHeure extends Omit<ProprietesChampDate, 'format' | 'plage' | 'actions' | 'aide'> {
  /** Heure prise quand seul le jour est choisi (défaut 12:00). */
  heureDefaut?: string;
  pas?: number;
  raccourcisHeure?: readonly string[];
}

export function ChampDateHeure({
  theme: palette,
  libelle,
  valeur,
  onChanger,
  testID = 'champ-date-heure',
  style,
  min,
  max,
  desactive,
  fuseau,
  langue: langueForcee,
  placeholder,
  raccourcis = RACCOURCIS_DEFAUT,
  effacable = true,
  editable = true,
  maintenant,
  heureDefaut = '12:00',
  pas = 15,
  raccourcisHeure = HEURES_RAPIDES,
}: ProprietesChampDateHeure) {
  const mobile = useMobile();
  const langue = useLangueDates(langueForcee);
  const [ouvert, setOuvert] = useState(false);
  const [touche, setTouche] = useState(false);
  const afficher = (v: string) => {
    const p = lireInstantMural(v);
    return p ? `${formaterSaisie(p.date)} ${p.heure}` : v ?? '';
  };
  const { texte, setTexte, emise } = useTexteSynchronise(valeur, afficher, v => !!lireInstantMural(v));
  const reference = aujourdhui(fuseau, maintenant);
  const actuel = lireInstantMural(valeur);
  const lu = texte.trim() ? analyserInstant(texte, reference) : undefined;
  const erreur = touche && texte.trim() && !lu ? texteDates(langue, 'invalide') : undefined;
  const emettre = (v: string) => {
    emise.current = v;
    onChanger(v);
  };
  const poser = (date: string, heure: string, fermer: boolean) => {
    const v = `${date} ${heure}`;
    setTexte(afficher(v));
    setTouche(true);
    emettre(v);
    if (fermer) setOuvert(false);
  };
  const bornes = { min, max, desactive };
  return (
    <View style={[{ gap: 4 }, style]}>
      <Libelle palette={palette} texte={libelle} />
      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
        <TextInput
          testID={testID}
          accessibilityLabel={libelle}
          value={texte}
          onChangeText={t => {
            setTexte(t);
            if (!t.trim()) return emettre('');
            const v = analyserInstant(t, reference);
            emettre(v ?? t);
          }}
          onBlur={() => {
            setTouche(true);
            if (lu) setTexte(afficher(lu));
          }}
          editable={editable}
          placeholder={placeholder ?? `${texteDates(langue, 'placeholder')} ${texteDates(langue, 'placeholderHeure')}`}
          placeholderTextColor={palette.attenue}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={40}
          style={styleSaisie(palette, mobile, !!erreur)}
        />
        <BoutonIcone palette={palette} nom="calendrier" libelle={`${texteDates(langue, 'ouvrir')}${libelle ? ` : ${libelle}` : ''}`} onPress={() => setOuvert(true)} testID={`${testID}-ouvrir`} taille={mobile ? 44 : 38} desactive={!editable} />
      </View>
      <MessageErreur palette={palette} texte={erreur} testID={`${testID}-erreur`} />
      <Flottant palette={palette} visible={ouvert} onFermer={() => setOuvert(false)} titre={libelle || texteDates(langue, 'date')} testID={`${testID}-bulle`} langue={langue}>
        {raccourcis ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {raccourcis.map(id => {
              const jour = jourRaccourci(id, reference, actuel?.date);
              return (
                <Pastille
                  key={id}
                  palette={palette}
                  libelle={texteDates(langue, id)}
                  actif={jour === actuel?.date}
                  desactive={!jourPermis(jour, bornes)}
                  mobile={mobile}
                  testID={`${testID}-raccourci-${id}`}
                  onPress={() => poser(jour, actuel?.heure ?? heureDefaut, false)}
                />
              );
            })}
          </View>
        ) : null}
        <Calendrier
          palette={palette}
          langue={langue}
          valeur={actuel?.date}
          min={min}
          max={max}
          desactive={desactive}
          reference={reference}
          onChoisir={iso => poser(iso, actuel?.heure ?? heureDefaut, false)}
          testID={`${testID}-calendrier`}
          mobile={mobile}
        />
        <PanneauHeure
          palette={palette}
          langue={langue}
          valeur={actuel?.heure}
          pas={pas}
          raccourcis={raccourcisHeure}
          onChoisir={(h, fini) => poser(actuel?.date ?? reference, h, fini)}
          testID={`${testID}-panneau`}
          mobile={mobile}
        />
        {effacable && (actuel || texte) ? (
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
            <Pastille
              palette={palette}
              libelle={texteDates(langue, 'effacer')}
              onPress={() => {
                setTexte('');
                emettre('');
                setOuvert(false);
              }}
              testID={`${testID}-effacer`}
              mobile={mobile}
            />
          </View>
        ) : null}
      </Flottant>
    </View>
  );
}

// --- ChampPeriode -------------------------------------------------------------------------------

export interface ProprietesChampPeriode {
  theme: PaletteDates;
  du: string;
  au: string;
  onDu(v: string): void;
  onAu(v: string): void;
  libelleDu?: string;
  libelleAu?: string;
  testIDDu?: string;
  testIDAu?: string;
  format?: FormatDate;
  min?: string;
  max?: string;
  fuseau?: string;
  langue?: LangueDates;
  /** Raccourcis de période dans les bulles ; `false` : aucun. */
  periodes?: readonly IdRaccourciPeriode[] | false;
  /** Style de chacun des deux champs. */
  styleChamp?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  maintenant?: number;
}

export function ChampPeriode({
  theme,
  du,
  au,
  onDu,
  onAu,
  libelleDu,
  libelleAu,
  testIDDu = 'periode-du',
  testIDAu = 'periode-au',
  format = 'iso',
  min,
  max,
  fuseau,
  langue: langueForcee,
  periodes = PERIODES_DEFAUT,
  styleChamp,
  style,
  maintenant,
}: ProprietesChampPeriode) {
  const langue = useLangueDates(langueForcee);
  const reference = aujourdhui(fuseau, maintenant);
  const isoDu = lireValeur(du, format);
  const isoAu = lireValeur(au, format);
  const actions = (periodes || []).map(id => ({
    id,
    libelle: texteDates(langue, id),
    faire: () => {
      const p = periodeRaccourci(id, reference);
      onDu(ecrireValeur(p.du, format));
      onAu(ecrireValeur(p.au, format));
    },
  }));
  const plage = { du: isoDu, au: isoAu };
  return (
    <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, style]}>
      <ChampDate
        theme={theme}
        libelle={libelleDu ?? texteDates(langue, 'du')}
        valeur={du}
        onChanger={onDu}
        testID={testIDDu}
        format={format}
        min={min}
        max={isoAu && (!max || isoAu < max) ? isoAu : max}
        fuseau={fuseau}
        langue={langue}
        raccourcis={false}
        actions={actions}
        plage={plage}
        style={[{ flexBasis: 170, flexGrow: 1 }, styleChamp]}
        maintenant={maintenant}
      />
      <ChampDate
        theme={theme}
        libelle={libelleAu ?? texteDates(langue, 'au')}
        valeur={au}
        onChanger={onAu}
        testID={testIDAu}
        format={format}
        min={isoDu && (!min || isoDu > min) ? isoDu : min}
        max={max}
        fuseau={fuseau}
        langue={langue}
        raccourcis={['aujourdhui']}
        actions={actions}
        plage={plage}
        style={[{ flexBasis: 170, flexGrow: 1 }, styleChamp]}
        maintenant={maintenant}
      />
    </View>
  );
}

// --- BoutonCalendrier ---------------------------------------------------------------------------

/** Bouton calendrier seul, à côté d'un champ en langage naturel (« demain », « dans 3 jours »). */
export function BoutonCalendrier({
  theme: palette,
  libelle,
  valeur,
  onChoisir,
  testID = 'bouton-calendrier',
  min,
  max,
  fuseau,
  langue: langueForcee,
  onEffacer,
}: {
  theme: PaletteDates;
  libelle: string;
  /** Jour déjà choisi (« AAAA-MM-JJ »), mis en évidence. */
  valeur?: string;
  onChoisir(iso: string): void;
  testID?: string;
  min?: string;
  max?: string;
  fuseau?: string;
  langue?: LangueDates;
  onEffacer?(): void;
}) {
  const mobile = useMobile();
  const langue = useLangueDates(langueForcee);
  const [ouvert, setOuvert] = useState(false);
  const reference = aujourdhui(fuseau);
  const choisi = valeur && estJour(valeur) ? valeur : undefined;
  const choisir = (iso: string) => {
    onChoisir(iso);
    setOuvert(false);
  };
  return (
    <>
      <BoutonIcone palette={palette} nom="calendrier" libelle={`${texteDates(langue, 'ouvrir')} : ${libelle}`} onPress={() => setOuvert(true)} testID={testID} taille={mobile ? 44 : 38} />
      <Flottant palette={palette} visible={ouvert} onFermer={() => setOuvert(false)} titre={libelle} testID={`${testID}-bulle`} langue={langue}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {RACCOURCIS_DEFAUT.map(id => {
            const jour = jourRaccourci(id, reference, choisi);
            return <Pastille key={id} palette={palette} libelle={texteDates(langue, id)} actif={jour === choisi} desactive={!jourPermis(jour, { min, max })} mobile={mobile} testID={`${testID}-raccourci-${id}`} onPress={() => choisir(jour)} />;
          })}
        </View>
        <Calendrier palette={palette} langue={langue} valeur={choisi} min={min} max={max} reference={reference} onChoisir={choisir} testID={`${testID}-calendrier`} mobile={mobile} />
        {onEffacer && choisi ? (
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
            <Pastille
              palette={palette}
              libelle={texteDates(langue, 'effacer')}
              onPress={() => {
                onEffacer();
                setOuvert(false);
              }}
              testID={`${testID}-effacer`}
              mobile={mobile}
            />
          </View>
        ) : null}
      </Flottant>
    </>
  );
}
