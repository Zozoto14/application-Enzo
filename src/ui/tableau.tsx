/**
 * Tableau de données : en-têtes triables, lignes cliquables, pied de totaux.
 *
 * Sur un écran large, il défile horizontalement plutôt que de tasser ses
 * colonnes. Sur téléphone (< 768 px), ce n'est plus un tableau : une liste de
 * cartes à 2–3 informations clés par ligne (titre, sous-titre, chiffre à
 * droite), un tri dans une feuille basse, et le détail complet de la ligne
 * dans une feuille basse au toucher. Les colonnes disent leur rôle par `mobile`.
 */

import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Pressable, Text } from './mobile/adaptatif';
import { usePalette } from './composants';
import { ESPACEMENT } from './theme';
import type { Palette } from './theme';
import { BoutonPrincipal } from './mobile/BoutonPrincipal';
import { FeuilleBasse } from './mobile/FeuilleBasse';
import { CONTROLE, ESPACE, TEXTE, nombres, rayonCarte, themeActif } from './mobile/jetons';
import { Cellule as CelluleListe, GroupeCellules } from './mobile/ListeCellules';
import { useMobile } from './mobile/useMobile';

export interface Colonne<T> {
  cle: string;
  titre: string;
  /** Largeur minimale, en points. */
  largeur: number;
  /** Part de la place restante. 0 : largeur fixe. */
  extensible?: number;
  alignement?: 'gauche' | 'droite' | 'centre';
  rendu(ligne: T): React.ReactNode;
  /**
   * Rôle de la colonne dans la carte du téléphone : `titre` (à gauche, en gras), `sous` (sous le titre),
   * `valeur` / `valeur2` (à droite, l'une sur l'autre), `detail` (feuille basse seulement, par défaut),
   * `masque` : jamais affichée sur téléphone.
   */
  mobile?: 'titre' | 'sous' | 'valeur' | 'valeur2' | 'detail' | 'masque';
  /** Contenu de la colonne dans la carte du téléphone (texte plus court, plusieurs champs en un). */
  renduMobile?(ligne: T): React.ReactNode;
  /** Valeur de tri ; sans elle, la colonne ne se trie pas. */
  tri?(ligne: T): number | string | null;
}

export interface TableauProps<T> {
  colonnes: readonly Colonne<T>[];
  lignes: readonly T[];
  cle(ligne: T): string;
  onPressLigne?(ligne: T): void;
  pied?: React.ReactNode;
  vide?: string;
  testID?: string;
  /** Téléphone : titre de la feuille de détail d'une ligne. */
  titreLigne?(ligne: T): string;
  /** Téléphone : libellé du bouton de la feuille de détail quand la ligne mène quelque part. */
  libelleOuvrir?: string;
  /** Téléphone seulement : action du bouton de la feuille de détail (sans rendre la ligne cliquable au bureau). */
  onOuvrirMobile?(ligne: T): void;
}

/** Aiguille : la liste de cartes sur téléphone, le tableau défilant ailleurs. */
export function Tableau<T>(props: TableauProps<T>) {
  return useMobile() ? <TableauMobile {...props} /> : <TableauBureau {...props} />;
}

type SensTri = { cle: string; sens: 1 | -1 } | null;

function trier<T>(colonnes: readonly Colonne<T>[], lignes: readonly T[], tri: SensTri): readonly T[] {
  const colonneTri = tri ? colonnes.find(colonne => colonne.cle === tri.cle) : undefined;
  return colonneTri?.tri && tri
    ? [...lignes].sort((a, b) => {
        const va = colonneTri.tri!(a);
        const vb = colonneTri.tri!(b);
        if (va === vb) return 0;
        if (va === null) return 1;
        if (vb === null) return -1;
        return (va < vb ? -1 : 1) * tri.sens;
      })
    : lignes;
}

/** Rôles des colonnes sur téléphone : ceux déclarés, ou à défaut le premier / le dernier chiffre. */
export function rolesMobile<T>(colonnes: readonly Colonne<T>[]): Array<'titre' | 'sous' | 'valeur' | 'valeur2' | 'detail' | 'masque'> {
  if (colonnes.some(colonne => colonne.mobile)) {
    return colonnes.map(colonne => colonne.mobile ?? 'detail');
  }
  return colonnes.map((_, rang) => (rang === 0 ? 'titre' : rang === colonnes.length - 1 ? 'valeur' : rang === 1 ? 'sous' : 'detail'));
}

function TableauBureau<T>({ colonnes, lignes, cle, onPressLigne, pied, vide, testID }: TableauProps<T>) {
  const palette = usePalette();
  const [tri, setTri] = useState<SensTri>(null);

  const triees = trier(colonnes, lignes, tri);

  const largeurMinimale = colonnes.reduce((somme, colonne) => somme + colonne.largeur, 0);
  const style = (colonne: Colonne<T>) => ({
    minWidth: colonne.largeur,
    flexBasis: colonne.largeur,
    flexGrow: colonne.extensible ?? 0,
    flexShrink: 0,
    alignItems:
      colonne.alignement === 'droite'
        ? ('flex-end' as const)
        : colonne.alignement === 'centre'
          ? ('center' as const)
          : ('flex-start' as const),
  });

  return (
    <ScrollView horizontal testID={testID} contentContainerStyle={{ flexGrow: 1 }}>
      <View style={{ minWidth: largeurMinimale, flexGrow: 1 }}>
        <View style={[styles.ligne, styles.entete, { borderBottomColor: palette.bordure }]}>
          {colonnes.map(colonne => {
            const actif = tri?.cle === colonne.cle;
            return (
              <Pressable
                key={colonne.cle}
                accessibilityRole={colonne.tri ? 'button' : undefined}
                disabled={!colonne.tri}
                onPress={() =>
                  setTri(precedent =>
                    precedent?.cle === colonne.cle
                      ? precedent.sens === -1
                        ? { cle: colonne.cle, sens: 1 }
                        : null
                      : { cle: colonne.cle, sens: -1 },
                  )
                }
                style={[styles.cellule, style(colonne)]}>
                <Text style={[styles.titre, { color: actif ? palette.accent : palette.texte }]} numberOfLines={1}>
                  {colonne.titre}
                  {actif ? (tri?.sens === -1 ? ' ↓' : ' ↑') : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {triees.length === 0 && vide ? (
          <Text style={[styles.vide, { color: palette.texteSecondaire }]}>{vide}</Text>
        ) : null}

        {triees.map((ligne, index) => {
          const cellules = colonnes.map(colonne => (
            <View key={colonne.cle} style={[styles.cellule, style(colonne)]}>
              {colonne.rendu(ligne)}
            </View>
          ));
          // Une ligne n'est un bouton que si elle mène quelque part : sinon,
          // un bouton désactivé désactiverait aussi les cases qu'elle contient.
          return onPressLigne ? (
            <Pressable
              key={`${cle(ligne)}-${index}`}
              accessibilityRole="button"
              onPress={() => onPressLigne(ligne)}
              style={({ pressed }) => [
                styles.ligne,
                { borderBottomColor: palette.bordure, backgroundColor: pressed ? palette.surfaceHaute : 'transparent' },
              ]}>
              {cellules}
            </Pressable>
          ) : (
            <View key={`${cle(ligne)}-${index}`} style={[styles.ligne, { borderBottomColor: palette.bordure }]}>
              {cellules}
            </View>
          );
        })}

        {pied ? <View style={[styles.pied, { borderTopColor: palette.bordure }]}>{pied}</View> : null}
      </View>
    </ScrollView>
  );
}

/** Texte de cellule standard. */
export function Cellule({
  children,
  couleur,
  gras,
  petit,
}: {
  children: React.ReactNode;
  couleur?: string;
  gras?: boolean;
  petit?: boolean;
}) {
  const palette = usePalette();
  const mobile = useMobile();
  return (
    <Text
      numberOfLines={mobile ? 2 : 1}
      style={{
        color: couleur ?? palette.texte,
        fontSize: mobile ? (petit ? TEXTE.legende : TEXTE.corps) : petit ? 11 : 12.5,
        fontWeight: gras ? '700' : '500',
        ...nombres(),
      }}>
      {children}
    </Text>
  );
}

// ------------------------------------------------------------------ Téléphone

function TableauMobile<T>({ colonnes, lignes, cle, onPressLigne: onPressBureau, onOuvrirMobile, pied, vide, testID, titreLigne, libelleOuvrir }: TableauProps<T>) {
  const onPressLigne = onPressBureau ?? onOuvrirMobile;
  const palette = usePalette();
  const theme = themeActif();
  const [tri, setTri] = useState<SensTri>(null);
  const [choixTri, setChoixTri] = useState(false);
  const [detail, setDetail] = useState<T | null>(null);
  const roles = rolesMobile(colonnes);
  const triees = trier(colonnes, lignes, tri);
  const dans = (role: string) => colonnes.filter((_, rang) => roles[rang] === role);
  const titres = dans('titre');
  const sous = dans('sous');
  const valeurs = dans('valeur');
  const valeurs2 = dans('valeur2');
  const colonnesTri = colonnes.filter(colonne => colonne.tri);
  const colonneTri = tri ? colonnes.find(colonne => colonne.cle === tri.cle) : undefined;
  const detaillable = Boolean(onPressLigne) || colonnes.some((_, rang) => roles[rang] === 'detail');
  const nomLigne = (ligne: T) =>
    titreLigne?.(ligne) ?? String((titres[0] ?? colonnes[0])?.tri?.(ligne) ?? '');

  return (
    <View testID={testID} style={{ gap: ESPACE.s }}>
      {colonnesTri.length > 1 && triees.length > 1 ? (
        <Pressable
          testID={testID ? `${testID}-tri` : undefined}
          accessibilityRole="button"
          accessibilityLabel={`Trier : ${colonneTri ? colonneTri.titre : 'ordre d’origine'}`}
          onPress={() => setChoixTri(true)}
          style={[styles.triMobile, { borderColor: palette.bordure, backgroundColor: palette.surfaceHaute }]}>
          <Text style={{ color: palette.texteSecondaire, fontSize: TEXTE.legende }}>Trier par</Text>
          <Text numberOfLines={1} style={{ color: palette.texte, fontSize: TEXTE.corps, fontWeight: '600', flex: 1, textAlign: 'right' }}>
            {colonneTri ? `${colonneTri.titre} ${tri?.sens === -1 ? '↓' : '↑'}` : 'Ordre d’origine'}
          </Text>
          <Text style={{ color: palette.texteSecondaire, fontSize: 20 }}>›</Text>
        </Pressable>
      ) : null}

      {triees.length === 0 && vide ? (
        <Text style={{ color: palette.texteSecondaire, fontSize: TEXTE.corps, paddingVertical: ESPACE.s }}>{vide}</Text>
      ) : null}

      {triees.length > 0 ? (
        <View style={[styles.listeMobile, { borderColor: palette.bordure, backgroundColor: palette.surface, borderRadius: rayonCarte(theme) }]}>
          {triees.map((ligne, index) => {
            const contenu = (
              <>
                <View style={styles.texteLigne}>
                  {titres.map(colonne => (
                    <View key={colonne.cle}>{(colonne.renduMobile ?? colonne.rendu)(ligne)}</View>
                  ))}
                  {sous.length > 0 ? (
                    <View style={styles.sousLigne}>
                      {sous.map(colonne => (
                        <View key={colonne.cle} style={{ flexShrink: 1 }}>
                          {(colonne.renduMobile ?? colonne.rendu)(ligne)}
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
                {valeurs.length + valeurs2.length > 0 ? (
                  <View style={styles.valeursLigne}>
                    {valeurs.map(colonne => (
                      <View key={colonne.cle} style={{ alignItems: 'flex-end' }}>
                        {(colonne.renduMobile ?? colonne.rendu)(ligne)}
                      </View>
                    ))}
                    {valeurs2.map(colonne => (
                      <View key={colonne.cle} style={{ alignItems: 'flex-end' }}>
                        {(colonne.renduMobile ?? colonne.rendu)(ligne)}
                      </View>
                    ))}
                  </View>
                ) : null}
                {detaillable ? <Text style={{ color: palette.texteSecondaire, fontSize: 24, lineHeight: 26 }}>›</Text> : null}
              </>
            );
            const clef = `${cle(ligne)}-${index}`;
            const bordure = index > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.bordure } : null;
            return detaillable ? (
              <Pressable
                key={clef}
                testID={testID ? `${testID}-ligne-${index}` : undefined}
                accessibilityRole="button"
                accessibilityLabel={nomLigne(ligne) || 'Détail de la ligne'}
                onPress={() => setDetail(ligne)}
                style={({ pressed }) => [styles.ligneMobile, bordure, { backgroundColor: pressed ? palette.surfaceHaute : 'transparent' }]}>
                {contenu}
              </Pressable>
            ) : (
              <View key={clef} style={[styles.ligneMobile, bordure]}>
                {contenu}
              </View>
            );
          })}
        </View>
      ) : null}

      {pied ? (
        <View style={[styles.piedMobile, { borderColor: palette.bordure, backgroundColor: palette.surface, borderRadius: rayonCarte(theme) }]}>{pied}</View>
      ) : null}

      <FeuilleBasse theme={theme} visible={choixTri} titre="Trier par" onFermer={() => setChoixTri(false)} testID="feuille-tri">
        <GroupeCellules theme={theme}>
          <CelluleListe
            theme={theme}
            titre="Ordre d’origine"
            coche={tri === null}
            onPress={() => {
              setTri(null);
              setChoixTri(false);
            }}
          />
          {colonnesTri.map(colonne => (
            <CelluleListe
              key={colonne.cle}
              theme={theme}
              titre={colonne.titre}
              valeur={tri?.cle === colonne.cle ? (tri.sens === -1 ? 'décroissant ↓' : 'croissant ↑') : undefined}
              coche={tri?.cle === colonne.cle}
              testID={testID ? `${testID}-tri-${colonne.cle}` : undefined}
              onPress={() => {
                setTri(precedent => (precedent?.cle === colonne.cle ? { cle: colonne.cle, sens: precedent.sens === -1 ? 1 : -1 } : { cle: colonne.cle, sens: -1 }));
                setChoixTri(false);
              }}
            />
          ))}
        </GroupeCellules>
      </FeuilleBasse>

      <FeuilleBasse
        theme={theme}
        visible={detail !== null}
        titre={detail !== null ? nomLigne(detail) || 'Détail' : 'Détail'}
        onFermer={() => setDetail(null)}
        testID="feuille-detail-ligne"
        pied={
          detail !== null && onPressLigne ? (
            <BoutonPrincipal
              theme={theme}
              titre={libelleOuvrir ?? 'Ouvrir la fiche'}
              testID="detail-ligne-ouvrir"
              onPress={() => {
                const ligne = detail;
                setDetail(null);
                onPressLigne(ligne);
              }}
            />
          ) : undefined
        }>
        {detail !== null ? (
          <View style={[styles.listeMobile, { borderColor: palette.bordure, backgroundColor: palette.surface, borderRadius: rayonCarte(theme) }]}>
            {colonnes
              .filter((_, rang) => roles[rang] !== 'masque')
              .map((colonne, rang) => (
                <View
                  key={colonne.cle}
                  style={[styles.ligneDetail, rang > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.bordure } : null]}>
                  <Text style={{ color: palette.texteSecondaire, fontSize: TEXTE.corps, flexShrink: 1 }}>{colonne.titre}</Text>
                  <View style={{ alignItems: 'flex-end', flexShrink: 1 }}>{colonne.rendu(detail)}</View>
                </View>
              ))}
          </View>
        ) : null}
      </FeuilleBasse>
    </View>
  );
}

/**
 * Couleur de fond d'une cellule de carte de chaleur : verte en hausse, rouge
 * en baisse, d'autant plus soutenue que l'écart est grand.
 */
export function couleurChaleur(palette: Palette, valeur: number | null, echelle: number): string {
  if (valeur === null || !Number.isFinite(valeur) || echelle <= 0) {
    return 'transparent';
  }
  const intensite = Math.min(1, Math.abs(valeur) / echelle);
  const alpha = (0.12 + intensite * 0.5).toFixed(2);
  return valeur >= 0 ? `rgba(52, 199, 123, ${alpha})` : `rgba(240, 82, 82, ${alpha})`;
}

const styles = StyleSheet.create({
  ligne: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    minHeight: 46,
  },
  entete: { minHeight: 38 },
  cellule: { paddingHorizontal: ESPACEMENT.s, justifyContent: 'center' },
  titre: { fontSize: 12, fontWeight: '700' },
  vide: { padding: ESPACEMENT.m, fontSize: 13 },
  triMobile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ESPACE.s,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: ESPACE.m,
    minHeight: CONTROLE.hauteur,
  },
  listeMobile: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  ligneMobile: { flexDirection: 'row', alignItems: 'center', gap: ESPACE.s, paddingHorizontal: ESPACE.m, paddingVertical: ESPACE.s + 2, minHeight: 64 },
  texteLigne: { flex: 1, minWidth: 0, gap: 2 },
  sousLigne: { flexDirection: 'row', flexWrap: 'wrap', columnGap: ESPACE.s + 4, rowGap: 0, alignItems: 'center' },
  valeursLigne: { alignItems: 'flex-end', gap: 2, flexShrink: 0, maxWidth: '48%' },
  ligneDetail: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: ESPACE.m, paddingHorizontal: ESPACE.m, paddingVertical: ESPACE.s, minHeight: CONTROLE.hauteur },
  piedMobile: { borderWidth: StyleSheet.hairlineWidth, padding: ESPACE.m, gap: ESPACE.xs + 2 },
  pied: {
    borderTopWidth: 1,
    paddingVertical: ESPACEMENT.s + 2,
    paddingHorizontal: ESPACEMENT.s,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: ESPACEMENT.m,
  },
});
