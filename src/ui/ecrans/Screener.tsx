/**
 * Screener : des catégories d'actions prêtes à l'emploi, sur le modèle de
 * Baggr — France, PEA, Qualité, Croissance, Value, Dividendes, Petites
 * capitalisations —, un tableau triable, et chaque action à un clic de la
 * watchlist ou de sa fiche.
 */

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { Pressable, Text } from '../mobile/adaptatif';
import {
  CATEGORIES,
  REGIONS,
  type ActionScreener,
  type CleCategorie,
  type Region,
  type ResultatScreener,
  type TriScreener,
} from '../../fondamentaux/screener';
import { Alerte, Bouton, SousTitre, usePalette } from '../composants';
import { CarteSection, Pastille, Segments, Selecteur, Vide } from '../elements';
import { Tableau, type Colonne } from '../tableau';
import { useEnEuros } from '../../cours/change';
import { libellesEnEuros } from '../devises';
import { ESPACEMENT, RAYON, palettePour, stylesPartages, POLICE_TITRE } from '../theme';

export interface ScreenerProps {
  chargerScreener?(categorie: CleCategorie, region: Region, page: number, tri: TriScreener): Promise<ResultatScreener>;
  /** Symboles déjà en watchlist. */
  surveilles: ReadonlySet<string>;
  onSurveiller(action: ActionScreener): void;
  onOuvrirFiche(symbole: string): void;
  erreurAjout?: string;
}

const TRIS: Array<{ valeur: TriScreener; libelle: string }> = [
  { valeur: 'capitalisation', libelle: 'Capitalisation' },
  { valeur: 'variation', libelle: 'Variation du jour' },
  { valeur: 'rendement', libelle: 'Rendement du dividende' },
  { valeur: 'per', libelle: 'PER le plus bas' },
];

const nombreFr = (valeur: number, decimales = 2) =>
  valeur.toLocaleString('fr-FR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });

function compact(valeur: number | null, devise = ''): string {
  if (valeur === null) return '—';
  const absolu = Math.abs(valeur);
  const [diviseur, suffixe] =
    absolu >= 1e12 ? [1e12, ' Bn'] : absolu >= 1e9 ? [1e9, ' Md'] : absolu >= 1e6 ? [1e6, ' M'] : [1, ''];
  return `${nombreFr(valeur / diviseur, diviseur === 1 ? 0 : 1)}${suffixe}${devise ? ` ${devise}` : ''}`;
}

const DRAPEAUX: Record<string, string> = {
  US: '🇺🇸', FR: '🇫🇷', DE: '🇩🇪', GB: '🇬🇧', NL: '🇳🇱', CH: '🇨🇭', JP: '🇯🇵', CA: '🇨🇦', IT: '🇮🇹', ES: '🇪🇸',
  BE: '🇧🇪', IE: '🇮🇪', SE: '🇸🇪', DK: '🇩🇰', FI: '🇫🇮', NO: '🇳🇴', PT: '🇵🇹', AT: '🇦🇹', LU: '🇱🇺', TW: '🇹🇼',
};

export function Screener({ chargerScreener, surveilles, onSurveiller, onOuvrirFiche, erreurAjout }: ScreenerProps) {
  const palette = usePalette();
  const enEuros = useEnEuros();
  const [categorie, setCategorie] = useState<CleCategorie>('tout');
  const [region, setRegion] = useState<Region>('monde');
  const [tri, setTri] = useState<TriScreener>('capitalisation');
  const [page, setPage] = useState(0);
  const [etat, setEtat] = useState<{ actions: ActionScreener[]; total: number; chargement: boolean; erreur?: string }>({
    actions: [],
    total: 0,
    chargement: Boolean(chargerScreener),
  });
  const choisie = CATEGORIES.find(element => element.cle === categorie)!;

  useEffect(() => {
    if (!chargerScreener) return;
    let actif = true;
    setEtat(precedent => ({ ...precedent, chargement: true, erreur: undefined, ...(page === 0 ? { actions: [] } : {}) }));
    chargerScreener(categorie, region, page, tri)
      .then(resultat => {
        if (!actif) return;
        setEtat(precedent => ({
          actions: page === 0 ? resultat.actions : [...precedent.actions, ...resultat.actions],
          total: resultat.total,
          chargement: false,
        }));
      })
      .catch((e: unknown) => {
        if (actif) setEtat(precedent => ({ ...precedent, chargement: false, erreur: e instanceof Error ? e.message : String(e) }));
      });
    return () => {
      actif = false;
    };
  }, [chargerScreener, categorie, region, tri, page]);

  const changer = (action: () => void) => {
    action();
    setPage(0);
  };

  const colonnes: Colonne<ActionScreener>[] = [
    {
      cle: 'nom',
      titre: 'Nom',
      largeur: 230,
      extensible: 1,
      tri: action => action.nom,
      rendu: action => (
        <Pressable onPress={() => onOuvrirFiche(action.symbole)} style={styles.nom} accessibilityRole="link">
          <View style={[styles.logo, { backgroundColor: palette.surfaceHaute, borderColor: palette.bordure }]}>
            <Text style={{ color: palette.accent, fontWeight: '800', fontSize: 10 }}>
              {action.symbole.replace(/\..*$/, '').slice(0, 4)}
            </Text>
          </View>
          <View style={{ flexShrink: 1 }}>
            <Text numberOfLines={1} style={{ color: palette.texte, fontWeight: '600' }}>
              {action.nom}
            </Text>
            <Text numberOfLines={1} style={{ color: palette.accent, fontSize: 11 }}>
              {action.pays ? `${DRAPEAUX[action.pays.toUpperCase()] ?? ''} ` : ''}
              {action.symbole}
              {action.place ? ` · ${action.place}` : ''}
            </Text>
          </View>
        </Pressable>
      ),
    },
    {
      cle: 'cours',
      titre: 'Cours',
      largeur: 100,
      alignement: 'droite',
      tri: action => action.cours,
      rendu: action => {
        const prix = libellesEnEuros(action.cours, action.devise, enEuros);
        return (
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: palette.texte }}>{prix.principal}</Text>
            {prix.origine ? <Text style={{ color: palette.texteSecondaire, fontSize: 11 }}>{prix.origine}</Text> : null}
          </View>
        );
      },
    },
    {
      cle: 'variation',
      titre: 'Jour',
      largeur: 90,
      alignement: 'droite',
      tri: action => action.variation,
      rendu: action =>
        action.variation === null ? (
          <Text style={{ color: palette.texteSecondaire }}>—</Text>
        ) : (
          <Pastille
            texte={`${action.variation >= 0 ? '+' : ''}${nombreFr(action.variation)} %`}
            tendance={action.variation > 0 ? 'hausse' : action.variation < 0 ? 'baisse' : 'neutre'}
          />
        ),
    },
    {
      cle: 'capitalisation',
      titre: 'Capitalisation',
      largeur: 120,
      alignement: 'droite',
      tri: action => action.capitalisation,
      rendu: action => {
        const euros = action.capitalisation === null ? undefined : enEuros(action.capitalisation, action.devise);
        return (
          <Text style={{ color: palette.texte }}>
            {euros === undefined ? compact(action.capitalisation, action.devise) : compact(euros, '€')}
          </Text>
        );
      },
    },
    {
      cle: 'per',
      titre: 'PER',
      largeur: 70,
      alignement: 'droite',
      tri: action => action.per,
      rendu: action => <Text style={{ color: palette.texte }}>{action.per === null ? '—' : nombreFr(action.per, 1)}</Text>,
    },
    {
      cle: 'pb',
      titre: 'Cours/actif',
      largeur: 90,
      alignement: 'droite',
      tri: action => action.prixSurActif,
      rendu: action => (
        <Text style={{ color: palette.texte }}>{action.prixSurActif === null ? '—' : nombreFr(action.prixSurActif, 1)}</Text>
      ),
    },
    {
      cle: 'rendement',
      titre: 'Dividende',
      largeur: 90,
      alignement: 'droite',
      tri: action => action.rendement,
      rendu: action => (
        <Text style={{ color: action.rendement ? palette.hausse : palette.texteSecondaire }}>
          {action.rendement ? `${nombreFr(action.rendement)} %` : '—'}
        </Text>
      ),
    },
    {
      cle: 'actions',
      titre: 'Actions',
      largeur: 90,
      alignement: 'centre',
      rendu: action => {
        const suivie = surveilles.has(action.symbole.toUpperCase());
        return (
          <View style={{ flexDirection: 'row', gap: ESPACEMENT.m }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={suivie ? `${action.nom} est dans la watchlist` : `Ajouter ${action.nom} à la watchlist`}
              disabled={suivie}
              onPress={() => onSurveiller(action)}
              testID={`screener-suivre-${action.symbole}`}>
              <Text style={{ color: suivie ? palette.accent : palette.texte, fontSize: 17 }}>{suivie ? '★' : '☆'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Fiche de ${action.nom}`} onPress={() => onOuvrirFiche(action.symbole)}>
              <Text style={{ color: palette.texte, fontSize: 16 }}>↗</Text>
            </Pressable>
          </View>
        );
      },
    },
  ];

  return (
    <View style={[stylesPartages.ecran, { backgroundColor: palettePour().fond }]}>
      <ScrollView contentContainerStyle={styles.page}>
        <Text {...POLICE_TITRE} style={[styles.titre, { color: palette.texte }]} accessibilityRole="header">
          Screener
        </Text>

        <View style={styles.grille}>
          {CATEGORIES.map(element => {
            const active = element.cle === categorie;
            return (
              <Pressable
                key={element.cle}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => changer(() => setCategorie(element.cle))}
                testID={`categorie-${element.cle}`}
                style={({ pressed }) => [
                  styles.categorie,
                  {
                    backgroundColor: active ? palette.accentFond : pressed ? palette.surfaceHaute : palette.surface,
                    borderColor: active ? palette.accent : palette.bordure,
                  },
                ]}>
                <Text style={{ color: active ? palette.accent : palette.texte, fontWeight: '800', fontSize: 16 }}>
                  {element.emoji} {element.nom}
                </Text>
                <Text style={{ color: palette.texteSecondaire, fontSize: 12, lineHeight: 17 }} numberOfLines={3}>
                  {element.description}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.barre}>
          {choisie.regionImposee || choisie.cle === 'pea' ? (
            <SousTitre>
              {choisie.cle === 'pea' ? 'Union européenne et EEE' : 'France'} — imposé par la catégorie.
            </SousTitre>
          ) : (
            <Segments<Region>
              options={REGIONS.map(element => element.cle)}
              actif={region}
              onChoisir={valeur => changer(() => setRegion(valeur))}
              libelle={valeur => REGIONS.find(element => element.cle === valeur)!.libelle}
              prefixeTest="region-screener"
            />
          )}
          <Selecteur
            etiquette="Trier par"
            valeur={tri}
            options={TRIS}
            onChoisir={valeur => changer(() => setTri(valeur as TriScreener))}
            largeur={220}
          />
        </View>

        {erreurAjout ? <Alerte message={erreurAjout} /> : null}

        <CarteSection
          titre={`${choisie.emoji} ${choisie.nom}`}
          actions={
            etat.total > 0 ? (
              <Text style={{ color: palette.texteSecondaire }}>{etat.total.toLocaleString('fr-FR')} actions</Text>
            ) : undefined
          }>
          {!chargerScreener ? (
            <Vide>Le screener se charge dans l’application de bureau.</Vide>
          ) : etat.erreur && etat.actions.length === 0 ? (
            <Vide>Le screener n’a pas répondu : {etat.erreur}</Vide>
          ) : etat.chargement && etat.actions.length === 0 ? (
            <View style={styles.centre}>
              <ActivityIndicator color={palette.accent} />
            </View>
          ) : (
            <>
              <Tableau
                colonnes={colonnes}
                lignes={etat.actions}
                cle={action => action.symbole}
                vide="Aucune action ne remplit ces critères."
                testID="tableau-screener"
              />
              {etat.actions.length < etat.total ? (
                <View style={{ alignSelf: 'center' }}>
                  {etat.chargement ? (
                    <ActivityIndicator color={palette.accent} />
                  ) : (
                    <Bouton titre={`Voir ${Math.min(25, etat.total - etat.actions.length)} de plus`} variante="discret" onPress={() => setPage(page + 1)} />
                  )}
                </View>
              ) : null}
            </>
          )}
          <SousTitre>Données Yahoo Finance : derniers chiffres publiés. Un filtre n’est pas un conseil d’achat.</SousTitre>
        </CarteSection>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: ESPACEMENT.m + 4, gap: ESPACEMENT.m },
  titre: { fontSize: 26, fontWeight: '800' },
  grille: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.m },
  categorie: {
    flexGrow: 1,
    flexBasis: 230,
    minHeight: 104,
    borderWidth: 1,
    borderRadius: RAYON.m,
    padding: ESPACEMENT.m,
    gap: ESPACEMENT.s,
  },
  barre: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: ESPACEMENT.m },
  centre: { alignItems: 'center', paddingVertical: ESPACEMENT.xl },
  nom: { flexDirection: 'row', alignItems: 'center', gap: ESPACEMENT.s },
  logo: { width: 30, height: 30, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
