/**
 * La page « Paramètres » : UNE seule, pour tout le hub et toutes ses apps.
 *
 * Elle est ouverte par le bouton « Paramètres » de l'en-tête (hub, portefeuille,
 * administration) ; chaque app n'a donc plus de réglages qui lui soient propres,
 * seulement un lien « Ouvrir les Paramètres » vers la bonne section.
 *
 *  - à gauche (bandeau défilant sur téléphone) : les sections ;
 *  - une recherche filtre tous les réglages d'un coup (titre, aide, mots-clés) ;
 *  - clavier : flèches/Début/Fin dans la liste des sections, « / » pour aller à la
 *    recherche, Échap efface la recherche puis ferme la page.
 *
 * La page ne sait pas dessiner les réglages : `rendu(id)` les fournit (l'hôte
 * connaît les données). Elle ne montre que ceux que `disponibles` déclare.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { BoutonHub } from './Hub';
import { IndicateurSynchro, type SynchroHub } from './IndicateurSynchro';
import { REGLAGES, reglagesDeSection, rechercher, section as sectionDef, sectionsVisibles, type IdReglage, type IdSection } from './recensement';
import { police, teinteTransparente, type ThemeHub } from './themes';
import { ecouterTouche } from './web';

export interface PageParametresProps {
  theme: ThemeHub;
  /** Section à montrer ; un changement de valeur (ou de `n`) y ramène la page. */
  section?: IdSection;
  n?: number;
  disponibles: readonly IdReglage[];
  rendu(id: IdReglage): React.ReactNode;
  /** État de la synchronisation, en pastille dans l'en-tête ; un clic ouvre la section Synchronisation. */
  synchro?: SynchroHub;
  /** Faux quand une fenêtre (le devblog) est ouverte par-dessus : elle garde Échap pour elle. */
  actif?: boolean;
  onFermer(): void;
}

type EtatPresse = { pressed: boolean; hovered?: boolean; focused?: boolean };
type ToucheReact = { key: string; preventDefault?(): void };

export function PageParametres({ theme, section, n, disponibles, rendu, synchro, actif = true, onFermer }: PageParametresProps) {
  const { width } = useWindowDimensions();
  const large = width >= 760;
  const sections = useMemo(() => sectionsVisibles(disponibles), [disponibles]);
  const premiere = sections[0]?.id ?? 'general';
  const [actuelle, setActuelle] = useState<IdSection>(section && sections.some(s => s.id === section) ? section : premiere);
  const [requete, setRequete] = useState('');
  const recherche = useRef<{ focus?(): void } | null>(null);
  const onglets = useRef(new Map<IdSection, unknown>());
  const requeteRef = useRef(requete);
  requeteRef.current = requete;

  useEffect(() => {
    if (section && sections.some(s => s.id === section)) {
      setActuelle(section);
      setRequete('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seule une nouvelle demande compte.
  }, [section, n]);

  // Échap efface d'abord la recherche, puis ferme la page.
  const surEchap = () => {
    if (requeteRef.current) {
      setRequete('');
    } else {
      onFermer();
    }
  };
  const surEchapRef = useRef(surEchap);
  surEchapRef.current = surEchap;
  useEffect(() => (actif ? ecouterTouche('Escape', () => surEchapRef.current()) : undefined), [actif]);
  useEffect(() => (actif ? ecouterTouche('/', () => recherche.current?.focus?.(), { ignorerChamps: true }) : undefined), [actif]);

  const enRecherche = requete.trim().length > 0;
  const resultats = useMemo(() => (enRecherche ? rechercher(requete, disponibles) : []), [enRecherche, requete, disponibles]);
  const total = resultats.reduce((somme, groupe) => somme + groupe.reglages.length, 0);
  const rayon = Math.min(theme.rayonMoyen, 10);
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const attenue = { color: theme.attenue, ...police(theme.policeTexte) };
  const titreStyle = {
    color: theme.texte,
    fontWeight: theme.poidsTitre,
    textTransform: theme.majuscules ? ('uppercase' as const) : ('none' as const),
    ...police(theme.policeTitre),
  };

  const aller = (id: IdSection, focus = false) => {
    setActuelle(id);
    setRequete('');
    if (focus) {
      (onglets.current.get(id) as { focus?(): void } | undefined)?.focus?.();
    }
  };
  const surTouche = (evenement: ToucheReact) => {
    // On part de l'onglet qui a le focus (à défaut, de la section ouverte).
    const focalise = (globalThis as { document?: { activeElement?: unknown } }).document?.activeElement;
    const enFocus = sections.find(s => onglets.current.get(s.id) === focalise)?.id ?? actuelle;
    const rang = sections.findIndex(s => s.id === enFocus);
    const suite: Record<string, number> = { ArrowDown: rang + 1, ArrowRight: rang + 1, ArrowUp: rang - 1, ArrowLeft: rang - 1, Home: 0, End: sections.length - 1 };
    if (!(evenement.key in suite) || sections.length === 0) {
      return;
    }
    evenement.preventDefault?.();
    const cible = sections[(suite[evenement.key] + sections.length) % sections.length];
    aller(cible.id, true);
  };

  const carte = (id: IdReglage, etiquette?: string) => {
    const contenu = rendu(id);
    if (contenu === null || contenu === undefined) {
      return null;
    }
    return (
      <View
        key={id}
        testID={`reglage-${id}`}
        style={[styles.carte, { backgroundColor: theme.surface, borderColor: theme.ligne, borderRadius: theme.rayonMoyen }]}>
        <Text style={[titreStyle, { fontSize: 17 }]} accessibilityRole="header">
          {TITRES[id]}
        </Text>
        {etiquette ? <Text style={[attenue, { fontSize: 12 }]}>{etiquette}</Text> : null}
        <View style={{ gap: 10 }}>{contenu}</View>
      </View>
    );
  };

  const entete = (
    <View style={styles.entete}>
      <BoutonHub theme={theme} titre="← Retour" libelle="Fermer les paramètres (Échap)" onPress={onFermer} testID="hub-parametres-fermer" />
      <Text style={[titreStyle, { fontSize: large ? 30 : 24, flex: 1 }]} accessibilityRole="header">
        Paramètres
      </Text>
      {synchro ? <IndicateurSynchro theme={theme} synchro={synchro} onPress={() => aller('synchro')} /> : null}
    </View>
  );

  const champ = (
    <View style={[styles.recherche, { backgroundColor: theme.surface, borderColor: theme.ligne, borderRadius: rayon }]}>
      <Text style={{ color: theme.attenue }}>⌕</Text>
      <TextInput
        ref={recherche as React.Ref<never>}
        testID="parametres-recherche"
        value={requete}
        onChangeText={setRequete}
        placeholder="Rechercher un réglage (thème, cours, sauvegarde…)   /"
        placeholderTextColor={theme.attenue}
        accessibilityLabel="Rechercher un réglage"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        // Dans un champ, le navigateur ne fait pas remonter Échap jusqu'au document : on le traite ici.
        onKeyPress={(evenement: { nativeEvent: { key: string } }) => {
          if (evenement.nativeEvent.key === 'Escape') {
            surEchap();
          }
        }}
        style={[texte, styles.champ, { outlineStyle: 'none' } as object]}
      />
      {enRecherche ? (
        <Pressable testID="parametres-recherche-effacer" accessibilityRole="button" accessibilityLabel="Effacer la recherche" onPress={() => setRequete('')} hitSlop={8}>
          <Text style={{ color: theme.attenue, fontSize: 16 }}>✕</Text>
        </Pressable>
      ) : null}
    </View>
  );

  const navigation = (
    <View
      accessibilityRole={'tablist' as never}
      accessibilityLabel="Sections des paramètres"
      // @ts-expect-error `onKeyDown` n'existe que sur le web.
      onKeyDown={surTouche}
      style={large ? styles.navLarge : styles.navEtroite}>
      {sections.map(s => {
        const actif = !enRecherche && s.id === actuelle;
        const compte = enRecherche ? resultats.find(groupe => groupe.section.id === s.id)?.reglages.length ?? 0 : undefined;
        return (
          <Pressable
            key={s.id}
            ref={(noeud: unknown) => {
              if (noeud) {
                onglets.current.set(s.id, noeud);
              } else {
                onglets.current.delete(s.id);
              }
            }}
            testID={`parametres-section-${s.id}`}
            accessibilityRole={'tab' as never}
            accessibilityState={{ selected: actif }}
            aria-selected={actif}
            accessibilityLabel={compte === undefined ? s.titre : `${s.titre}, ${compte} résultat${compte > 1 ? 's' : ''}`}
            onPress={() => aller(s.id)}
            style={(etat: EtatPresse) => [
              styles.onglet,
              {
                borderRadius: rayon,
                backgroundColor: actif ? theme.accent : etat.hovered ? teinteTransparente(theme.sombre ? '#FFFFFF' : '#000000', 0.06) : 'transparent',
                borderColor: actif ? theme.accent : etat.focused ? theme.accent : large ? 'transparent' : theme.ligne,
                opacity: compte === 0 ? 0.45 : 1,
              },
            ]}>
            <Text style={{ color: actif ? theme.surAccent : theme.texte, fontSize: 15 }}>{s.icone}</Text>
            <Text style={{ color: actif ? theme.surAccent : theme.texte, fontWeight: '600', fontSize: 14, ...police(theme.policeTexte) }} numberOfLines={1}>
              {s.titre}
            </Text>
            {compte !== undefined && compte > 0 ? (
              <Text style={{ color: theme.attenue, fontSize: 12, marginLeft: 'auto' }}>{compte}</Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );

  const contenu = enRecherche ? (
    <View style={{ gap: 14 }} testID="parametres-resultats">
      <Text accessibilityLiveRegion="polite" style={[attenue, { fontSize: 13 }]} testID="parametres-nombre">
        {total === 0 ? `Aucun réglage ne correspond à « ${requete.trim()} ».` : `${total} réglage${total > 1 ? 's' : ''} trouvé${total > 1 ? 's' : ''}.`}
      </Text>
      {resultats.map(groupe => (
        <View key={groupe.section.id} style={{ gap: 10 }}>
          <Text style={[styles.rubrique, { color: theme.attenue }]}>{groupe.section.titre.toUpperCase()}</Text>
          {groupe.reglages.map(r => carte(r.id, r.description))}
        </View>
      ))}
    </View>
  ) : (
    <View style={{ gap: 14 }} testID={`parametres-panneau-${actuelle}`}>
      <View>
        <Text style={[titreStyle, { fontSize: 22 }]} accessibilityRole="header">
          {sectionDef(actuelle).titre}
        </Text>
        <Text style={[attenue, { fontSize: 13, marginTop: 2 }]}>{sectionDef(actuelle).description}</Text>
      </View>
      {reglagesDeSection(actuelle, disponibles).map(r => carte(r.id))}
    </View>
  );

  return (
    <View style={[styles.racine, { backgroundColor: theme.fond }]} testID="hub-parametres" accessibilityLabel="Paramètres">
      <View style={styles.page}>
        {entete}
        {champ}
        <View style={large ? styles.corpsLarge : styles.corpsEtroit}>
          {large ? <View style={styles.colNav}>{navigation}</View> : <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.defBandeau} contentContainerStyle={{ paddingVertical: 2 }}>{navigation}</ScrollView>}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
            {contenu}
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

const TITRES = Object.fromEntries(REGLAGES.map(r => [r.id, r.titre])) as Record<IdReglage, string>;

const styles = StyleSheet.create({
  racine: { flex: 1 },
  page: { flex: 1, width: '100%', maxWidth: 1100, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 20, gap: 14 },
  entete: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  recherche: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, paddingHorizontal: 12, minHeight: 44 },
  champ: { flex: 1, fontSize: 15, paddingVertical: 8 },
  corpsLarge: { flex: 1, flexDirection: 'row', gap: 24 },
  corpsEtroit: { flex: 1, gap: 12 },
  colNav: { width: 230 },
  defBandeau: { flexGrow: 0, flexShrink: 0 },
  navLarge: { gap: 4 },
  navEtroite: { flexDirection: 'row', gap: 8 },
  onglet: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, minHeight: 44, borderWidth: 1 },
  carte: { borderWidth: 1, padding: 16, gap: 10 },
  rubrique: { fontSize: 11, fontWeight: '700', letterSpacing: 1.1 },
});
