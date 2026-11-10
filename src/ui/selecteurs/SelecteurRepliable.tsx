/**
 * Sélecteur repliable : choix d'un ou plusieurs éléments dans une longue liste (rôles et salons
 * Discord, catégories, membres…) sans étaler toutes les pastilles à l'écran.
 *
 *  - Replié par défaut : libellé, résumé sur une ligne (« 3 rôles choisis : Staff, Coach, +1 »,
 *    « Aucun ») et bouton « Modifier ».
 *  - Déplié : recherche (au-delà de 6 éléments), « Tout » / « Aucun » (choix multiple), liste
 *    groupée (salons rangés par catégorie dans l'ordre de Discord, rôles dans l'ordre de la
 *    hiérarchie avec leur pastille de couleur), hauteur limitée avec défilement.
 *  - Rien n'est mémorisé d'une visite à l'autre : chaque écran s'ouvre replié.
 *
 * Chaque élément garde l'identifiant de test `${testID}-${id}` des anciennes pastilles.
 */

import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { police, teinteTransparente, type ThemeHub } from '../../hub/themes';
import { Icone } from '../icones';
import { useMobile } from '../mobile/useMobile';
import { useLangueDates } from '../dates/langue';
import type { LangueDates } from '../dates/logique';

export interface OptionSelecteur {
  id: string;
  nom: string;
  couleur?: string | null;
  /** Groupe d'affichage (catégorie Discord…), dans l'ordre d'apparition. */
  groupe?: string;
  desactive?: boolean;
  /** Petit texte après le nom (« 12 membres »…). */
  detail?: string;
}

export type NatureSelecteur = 'role' | 'salon' | 'categorie' | 'membre' | 'element';

type Commun = {
  theme: ThemeHub;
  libelle: string;
  options: readonly OptionSelecteur[];
  testID: string;
  /** Mots du résumé (« rôles », « salons »…). */
  nature?: NatureSelecteur;
  /** Résumé sans choix (défaut « Aucun »). */
  vide?: string;
  aide?: string;
  /** Déplié dès l'affichage (formulaire de création…). */
  ouvertParDefaut?: boolean;
  style?: StyleProp<ViewStyle>;
  langue?: LangueDates;
};

export type ProprietesSelecteur = Commun &
  (
    | { multiple: true; valeurs: readonly string[]; onChanger(v: string[]): void; max?: number }
    | { multiple?: false; valeur: string | null | undefined; onChoisir(id: string): void }
  );

const MOTS: Record<LangueDates, Record<NatureSelecteur, [string, string, string]>> = {
  fr: {
    role: ['rôle choisi', 'rôles choisis', 'rôles'],
    salon: ['salon choisi', 'salons choisis', 'salons'],
    categorie: ['catégorie choisie', 'catégories choisies', 'catégories'],
    membre: ['membre choisi', 'membres choisis', 'membres'],
    element: ['élément choisi', 'éléments choisis', 'éléments'],
  },
  en: {
    role: ['role selected', 'roles selected', 'roles'],
    salon: ['channel selected', 'channels selected', 'channels'],
    categorie: ['category selected', 'categories selected', 'categories'],
    membre: ['member selected', 'members selected', 'members'],
    element: ['item selected', 'items selected', 'items'],
  },
};
const TEXTES = {
  fr: { modifier: 'Modifier', choisir: 'Choisir', replier: 'Replier', aucun: 'Aucun', tout: 'Tout', rien: 'Aucun', rechercher: 'Rechercher', introuvable: 'Aucun résultat', vide: 'Rien à choisir', max: 'max.', sansGroupe: 'Sans catégorie' },
  en: { modifier: 'Edit', choisir: 'Choose', replier: 'Collapse', aucun: 'None', tout: 'All', rien: 'None', rechercher: 'Search', introuvable: 'No results', vide: 'Nothing to choose', max: 'max', sansGroupe: 'No category' },
} as const;

const sansAccents = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Résumé d'un choix multiple : « 3 rôles choisis : Staff, Coach, +1 ». */
export function resumeChoix(noms: readonly string[], nature: NatureSelecteur, langue: LangueDates, vide?: string): string {
  if (!noms.length) return vide ?? TEXTES[langue].aucun;
  const [un, plusieurs] = MOTS[langue][nature];
  const visibles = noms.slice(0, 2).join(', ');
  const reste = noms.length > 2 ? `, +${noms.length - 2}` : '';
  return `${noms.length} ${noms.length > 1 ? plusieurs : un}${langue === 'fr' ? ' : ' : ': '}${visibles}${reste}`;
}

/** Groupes d'affichage, dans l'ordre d'apparition des options. */
function grouper(options: readonly OptionSelecteur[]): Array<{ groupe?: string; options: OptionSelecteur[] }> {
  const groupes: Array<{ groupe?: string; options: OptionSelecteur[] }> = [];
  for (const o of options) {
    const g = groupes.find(x => x.groupe === o.groupe);
    if (g) g.options.push(o);
    else groupes.push({ groupe: o.groupe, options: [o] });
  }
  return groupes;
}

type EtatPresse = { pressed: boolean; hovered?: boolean; focused?: boolean };

export function SelecteurRepliable(props: ProprietesSelecteur) {
  const { theme, libelle, options, testID, nature = 'element', vide, aide, ouvertParDefaut, style } = props;
  const mobile = useMobile();
  const langue = useLangueDates(props.langue);
  const t = TEXTES[langue];
  const [ouvert, setOuvert] = useState(!!ouvertParDefaut);
  const [recherche, setRecherche] = useState('');
  const choisis = props.multiple ? props.valeurs : props.valeur ? [props.valeur] : [];
  const nomsChoisis = choisis.map(id => options.find(o => o.id === id)?.nom ?? id);
  const couleursChoisies = choisis.map(id => options.find(o => o.id === id)?.couleur).filter((c): c is string => !!c).slice(0, 3);
  const resume = props.multiple ? resumeChoix(nomsChoisis, nature, langue, vide) : nomsChoisis[0] ?? vide ?? t.aucun;
  const filtrees = useMemo(() => {
    const q = sansAccents(recherche.trim());
    return q ? options.filter(o => sansAccents(`${o.nom} ${o.groupe ?? ''}`).includes(q)) : options;
  }, [options, recherche]);
  const groupes = useMemo(() => grouper(filtrees), [filtrees]);
  const plein = props.multiple && props.max !== undefined && props.valeurs.length >= props.max;
  const choisissables = options.filter(o => !o.desactive);
  const peutToutChoisir = props.multiple && (props.max === undefined || props.max >= choisissables.length);
  const texteTitre = { color: theme.texte, fontWeight: '600' as const, fontSize: 13, ...police(theme.policeTexte) };

  const basculer = (o: OptionSelecteur) => {
    if (props.multiple) {
      const coche = props.valeurs.includes(o.id);
      props.onChanger(coche ? props.valeurs.filter(v => v !== o.id) : [...props.valeurs, o.id]);
    } else {
      props.onChoisir(o.id);
      setOuvert(false);
      setRecherche('');
    }
  };

  return (
    <View style={[{ gap: 6 }, style]} testID={`${testID}-selecteur`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <View style={{ flex: 1, minWidth: 160, gap: 2 }}>
          <Text style={texteTitre}>
            {libelle}
            {props.multiple && props.max !== undefined ? <Text style={{ color: theme.attenue, fontWeight: '400' }}>{` (${t.max} ${props.max})`}</Text> : null}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {couleursChoisies.length ? (
              <View style={{ flexDirection: 'row', gap: 2 }}>
                {couleursChoisies.map((c, i) => (
                  <View key={i} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c }} />
                ))}
              </View>
            ) : null}
            <Text style={{ flex: 1, color: choisis.length ? theme.texte : theme.attenue, fontSize: 13, ...police(theme.policeTexte) }} numberOfLines={2} testID={`${testID}-resume`}>
              {resume}
            </Text>
          </View>
        </View>
        <Pressable
          testID={`${testID}-modifier`}
          accessibilityRole="button"
          accessibilityState={{ expanded: ouvert }}
          accessibilityLabel={`${ouvert ? t.replier : choisis.length ? t.modifier : t.choisir} : ${libelle}`}
          onPress={() => {
            setOuvert(o => !o);
            setRecherche('');
          }}
          style={(e: EtatPresse) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            minHeight: mobile ? 44 : 34,
            paddingHorizontal: 12,
            borderRadius: Math.min(theme.rayonMoyen, 10),
            borderWidth: 1,
            borderColor: e.hovered || e.focused || ouvert ? theme.accent : theme.ligne,
            backgroundColor: e.pressed ? teinteTransparente(theme.accent, 0.16) : theme.surface,
          })}>
          <Text style={{ color: theme.texte, fontSize: 13, fontWeight: '600', ...police(theme.policeTexte) }}>{ouvert ? t.replier : choisis.length ? t.modifier : t.choisir}</Text>
          <Icone nom={ouvert ? 'chevron-haut' : 'chevron-bas'} taille={16} couleur={theme.texte} />
        </Pressable>
      </View>
      {aide ? <Text style={{ color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) }}>{aide}</Text> : null}
      {ouvert ? (
        <View testID={`${testID}-liste`} style={{ gap: 6, borderWidth: 1, borderColor: theme.ligne, borderRadius: Math.min(theme.rayonMoyen, 12), padding: 8, backgroundColor: theme.fond }}>
          {options.length > 6 || props.multiple ? (
            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {options.length > 6 ? (
                <TextInput
                  testID={`${testID}-recherche`}
                  accessibilityLabel={`${t.rechercher} : ${libelle}`}
                  value={recherche}
                  onChangeText={setRecherche}
                  placeholder={`${t.rechercher}…`}
                  placeholderTextColor={theme.attenue}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{
                    flexGrow: 1,
                    flexBasis: 160,
                    minWidth: 0,
                    minHeight: mobile ? 44 : 34,
                    borderWidth: 1,
                    borderColor: theme.ligne,
                    borderRadius: Math.min(theme.rayonMoyen, 10),
                    paddingHorizontal: 10,
                    color: theme.texte,
                    backgroundColor: theme.surface,
                    fontSize: mobile ? 16 : 14,
                    ...police(theme.policeTexte),
                  }}
                />
              ) : null}
              {props.multiple ? (
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {peutToutChoisir ? <PetitBouton theme={theme} titre={t.tout} onPress={() => props.onChanger(choisissables.map(o => o.id))} testID={`${testID}-tout`} mobile={mobile} /> : null}
                  <PetitBouton theme={theme} titre={t.rien} onPress={() => props.onChanger([])} testID={`${testID}-aucun`} mobile={mobile} desactive={!props.valeurs.length} />
                </View>
              ) : null}
            </View>
          ) : null}
          <ScrollView style={{ maxHeight: mobile ? 340 : 300 }} nestedScrollEnabled keyboardShouldPersistTaps="handled" accessibilityRole={props.multiple ? undefined : 'radiogroup'} accessibilityLabel={libelle}>
            {!options.length ? <Text style={{ color: theme.attenue, fontSize: 13, padding: 6 }}>{t.vide}</Text> : !filtrees.length ? <Text style={{ color: theme.attenue, fontSize: 13, padding: 6 }}>{t.introuvable}</Text> : null}
            {groupes.map(g => (
              <View key={g.groupe ?? '\u0000'} style={{ gap: 2, marginBottom: 4 }} testID={g.groupe ? `${testID}-groupe-${g.groupe}` : undefined}>
                {g.groupe !== undefined && groupes.length > 1 ? (
                  <Text accessibilityRole="header" style={{ color: theme.attenue, fontSize: 11, fontWeight: '700', paddingHorizontal: 6, paddingTop: 6, ...police(theme.policeTexte) }}>
                    {(g.groupe || t.sansGroupe).toUpperCase()}
                  </Text>
                ) : null}
                {g.options.map(o => {
                  const coche = choisis.includes(o.id);
                  const bloque = !!o.desactive || (!coche && !!plein);
                  return (
                    <Pressable
                      key={o.id}
                      testID={`${testID}-${o.id}`}
                      accessibilityRole={props.multiple ? 'checkbox' : 'radio'}
                      accessibilityState={{ checked: coche, disabled: bloque }}
                      accessibilityLabel={`${libelle} : ${o.nom}`}
                      disabled={bloque}
                      onPress={() => basculer(o)}
                      style={(e: EtatPresse) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 10,
                        minHeight: mobile ? 44 : 34,
                        paddingHorizontal: 8,
                        borderRadius: 8,
                        backgroundColor: coche ? teinteTransparente(o.couleur ?? theme.accent, 0.16) : e.hovered || e.focused ? teinteTransparente(theme.accent, 0.08) : 'transparent',
                        opacity: bloque ? 0.45 : 1,
                      })}>
                      <View
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: props.multiple ? 4 : 9,
                          borderWidth: 2,
                          borderColor: coche ? theme.accent : theme.attenue,
                          backgroundColor: coche ? theme.accent : 'transparent',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                        {coche ? <Icone nom="coche" taille={12} couleur={theme.surAccent} /> : null}
                      </View>
                      {o.couleur ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: o.couleur }} /> : null}
                      <Text style={{ flex: 1, color: theme.texte, fontSize: mobile ? 15 : 13, fontWeight: coche ? '700' : '500', ...police(theme.policeTexte) }} numberOfLines={1}>
                        {o.nom}
                        {o.detail ? <Text style={{ color: theme.attenue, fontWeight: '400' }}>{`  ${o.detail}`}</Text> : null}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function PetitBouton({ theme, titre, onPress, testID, mobile, desactive }: { theme: ThemeHub; titre: string; onPress(): void; testID: string; mobile: boolean; desactive?: boolean }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!desactive }}
      disabled={desactive}
      onPress={onPress}
      style={(e: EtatPresse) => ({
        minHeight: mobile ? 44 : 34,
        paddingHorizontal: 12,
        justifyContent: 'center',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: e.hovered || e.focused ? theme.accent : theme.ligne,
        backgroundColor: theme.surface,
        opacity: desactive ? 0.45 : 1,
      })}>
      <Text style={{ color: theme.texte, fontSize: 13, fontWeight: '600', ...police(theme.policeTexte) }}>{titre}</Text>
    </Pressable>
  );
}

/** Salons Discord rangés comme dans Discord : sans catégorie d'abord, puis par catégorie (positions). */
export function optionsSalons<T extends { id: string; nom: string; type: string; parent: string | null; position?: number }>(
  salons: readonly T[],
  types: readonly string[],
  nom: (s: T) => string = s => s.nom,
): OptionSelecteur[] {
  const pos = (s: T, i: number) => (typeof s.position === 'number' ? s.position : i);
  const index = new Map(salons.map((s, i) => [s.id, i]));
  const categories = salons.filter(s => s.type === 'categorie').sort((a, b) => pos(a, index.get(a.id)!) - pos(b, index.get(b.id)!));
  const rang = new Map(categories.map((c, i) => [c.id, i]));
  const nomCategorie = new Map(categories.map(c => [c.id, c.nom]));
  return salons
    .filter(s => types.includes(s.type))
    .map(s => ({ s, cat: s.type === 'categorie' ? -1 : s.parent && rang.has(s.parent) ? rang.get(s.parent)! : -1 }))
    .sort((a, b) => a.cat - b.cat || pos(a.s, index.get(a.s.id)!) - pos(b.s, index.get(b.s.id)!))
    .map(({ s }) => ({ id: s.id, nom: nom(s), groupe: s.type === 'categorie' ? undefined : s.parent ? nomCategorie.get(s.parent) ?? '' : '' }));
}

/** Rôles Discord dans l'ordre de la hiérarchie (le plus haut d'abord), avec leur couleur. */
export function optionsRoles<T extends { id: string; nom: string; couleur?: string | null; position?: number }>(roles: readonly T[]): OptionSelecteur[] {
  const avecPosition = roles.every(r => typeof r.position === 'number');
  const tries = avecPosition ? [...roles].sort((a, b) => (b.position ?? 0) - (a.position ?? 0)) : roles;
  return tries.map(r => ({ id: r.id, nom: r.nom, couleur: r.couleur ?? undefined }));
}
