/**
 * Écran « Quoi de neuf » : les nouveautés d'une version, aux couleurs du
 * thème du hub. Deux usages :
 *  - à l'ouverture, une fois par profil, pour la dernière version ;
 *  - depuis Paramètres › Nouveautés, l'historique complet.
 *
 * L'illustration est dessinée en vues (aucune image) : un schéma simple de
 * ce que la version change.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { BoutonHub } from '../Hub';
import { police, teinteTransparente, type ThemeHub } from '../themes';
import { ecouterTouche } from '../web';
import { fonctionnalitesPour } from './devblog';
import { ENTREES, type CibleEssai, type EntreeDevblog, type Illustration } from './entrees';

export interface DevblogProps {
  theme: ThemeHub;
  admin: boolean;
  /** Entrée à présenter ; absente : historique de toutes les versions. */
  entree?: EntreeDevblog;
  onFermer(): void;
  onEssayer(cible: CibleEssai): void;
  /** Lance la visite guidée des nouveautés de cette entrée. */
  onVisite?(entree: EntreeDevblog): void;
  /** Cibles réellement disponibles pour ce profil (« Essayer » masqué sinon). */
  disponible(cible: CibleEssai): boolean;
}

export function Devblog({ theme, admin, entree, onFermer, onEssayer, onVisite, disponible }: DevblogProps) {
  const { width, height } = useWindowDimensions();
  const [ouverte, setOuverte] = useState<string | undefined>(entree?.version ?? ENTREES[0]?.version);
  useEffect(() => ecouterTouche('Escape', onFermer), [onFermer]);
  const etroit = width < 640;
  const liste = entree ? [entree] : ENTREES;
  const titre = { color: theme.texte, fontWeight: theme.poidsTitre, ...police(theme.policeTitre) };
  const attenue = { color: theme.attenue, ...police(theme.policeTexte) };

  return (
    <View style={[StyleSheet.absoluteFill, styles.voile, { backgroundColor: teinteTransparente('#000000', 0.5) }]} testID="devblog">
      <View
        accessibilityRole={'dialog' as never}
        accessibilityLabel={entree ? `Quoi de neuf : ${entree.titre}` : 'Historique des nouveautés'}
        aria-modal
        style={[
          styles.panneau,
          {
            backgroundColor: theme.surface,
            borderColor: theme.ligne,
            borderRadius: etroit ? 0 : theme.rayonMoyen,
            width: etroit ? width : Math.min(720, width - 48),
            maxHeight: etroit ? height : height - 48,
          },
          etroit && { height },
        ]}>
        <ScrollView contentContainerStyle={{ gap: 18, padding: 22 }}>
          <Text style={[attenue, styles.surtitre, { color: theme.accent }]}>{entree ? `QUOI DE NEUF · VERSION ${entree.version}` : 'NOUVEAUTÉS'}</Text>
          {!entree ? (
            <Text style={[titre, { fontSize: 28 }]} accessibilityRole="header">
              Historique des versions
            </Text>
          ) : null}
          {liste.map(e => {
            const deplie = Boolean(entree) || ouverte === e.version;
            const fonctions = fonctionnalitesPour(e, admin);
            return (
              <View key={e.version} style={{ gap: 14 }} testID={`devblog-entree-${e.version}`}>
                {entree ? null : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: deplie }}
                    onPress={() => setOuverte(deplie ? undefined : e.version)}
                    style={[styles.ligneHistorique, { borderColor: theme.ligne, borderRadius: Math.min(theme.rayonMoyen, 10) }]}>
                    <Text style={[attenue, police(theme.policeChiffres), { fontSize: 12 }]}>{e.date}</Text>
                    <Text style={[titre, { flex: 1, fontSize: 16 }]}>{e.titre}</Text>
                    <Text style={attenue}>{deplie ? '▾' : '▸'}</Text>
                  </Pressable>
                )}
                {deplie ? (
                  <>
                    {entree ? (
                      <Text style={[titre, { fontSize: etroit ? 26 : 32, letterSpacing: -0.5 }]} accessibilityRole="header">
                        {e.titre}
                      </Text>
                    ) : null}
                    <Text style={[attenue, { fontSize: 15, lineHeight: 22 }]}>{e.resume}</Text>
                    <Schema theme={theme} genre={e.illustration} />
                    <View style={{ gap: 10 }}>
                      {fonctions.map(f => (
                        <View key={f.id} style={[styles.fonction, { borderColor: theme.ligne, backgroundColor: theme.fond, borderRadius: Math.min(theme.rayonMoyen, 12) }]} testID={`devblog-fonction-${f.id}`}>
                          <View style={[styles.pastille, { backgroundColor: teinteTransparente(theme.accent, 0.16), borderRadius: Math.min(theme.rayonMoyen, 10) }]}>
                            <Text style={{ fontSize: 18, color: theme.accent }}>{f.emoji}</Text>
                          </View>
                          <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
                            <Text style={[titre, { fontSize: 16 }]}>{f.titre}</Text>
                            <Text style={[attenue, { fontSize: 13.5, lineHeight: 19 }]}>{f.texte}</Text>
                          </View>
                          {f.essayer && disponible(f.essayer) ? (
                            <BoutonHub theme={theme} titre="Essayer →" onPress={() => onEssayer(f.essayer!)} testID={`devblog-essayer-${f.id}`} />
                          ) : null}
                        </View>
                      ))}
                    </View>
                    {entree && onVisite ? (
                      <Text style={[attenue, { fontSize: 13 }]}>Préférez une présentation pas à pas ? Lancez la visite guidée des nouveautés.</Text>
                    ) : null}
                  </>
                ) : null}
              </View>
            );
          })}
          <View style={[styles.actions, { justifyContent: 'flex-end' }]}>
            {entree && onVisite ? <BoutonHub theme={theme} titre="Visite guidée" onPress={() => onVisite(entree)} testID="devblog-visite" /> : null}
            <BoutonHub theme={theme} variante="plein" titre={entree ? 'Compris' : 'Fermer'} onPress={onFermer} testID="devblog-fermer" />
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

/** Schéma inline : une mini-maquette du hub et de ce qui change. */
function Schema({ theme, genre }: { theme: ThemeHub; genre: Illustration }) {
  const tuile = (couleur: string, large = false, libelle?: string) => (
    <View style={[styles.tuile, { backgroundColor: teinteTransparente(couleur, 0.22), borderColor: couleur, borderRadius: Math.min(theme.rayonMoyen, 8), flexGrow: large ? 2 : 1 }]}>
      {libelle ? <Text style={{ color: theme.texte, fontSize: 11, fontWeight: '700' }}>{libelle}</Text> : null}
    </View>
  );
  const compte = (nom: string, couleur: string) => (
    <View style={[styles.compte, { borderColor: couleur, borderRadius: Math.min(theme.rayonMoyen, 10) }]}>
      <Text style={{ color: couleur, fontWeight: '800' }}>🔒</Text>
      <Text style={{ color: theme.texte, fontSize: 11, fontWeight: '600' }}>{nom}</Text>
    </View>
  );
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="Schéma : le hub avec ses tuiles et ses boutons, et des comptes séparés chacun dans son coffre, l’administrateur pouvant ouvrir celui d’un ami avec un code."
      style={[styles.schema, { backgroundColor: theme.fond, borderColor: theme.ligne, borderRadius: theme.rayonMoyen }]}
      testID="devblog-schema">
      <View style={{ flex: 3, gap: 8, minWidth: 220 }}>
        <View style={[styles.actions, { justifyContent: 'space-between' }]}>
          <Text style={{ color: theme.texte, fontWeight: '800', fontSize: 12 }}>▦ Hub</Text>
          <View style={styles.actions}>
            <Text style={[styles.puce, { borderColor: theme.accent, color: theme.accent }]}>⟳ Mettre à jour</Text>
            <Text style={[styles.puce, { borderColor: theme.ligne, color: theme.texte }]}>⚙ Paramètres</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {tuile(theme.teintes.portefeuille, true, genre === 'hub' ? 'Portefeuille' : undefined)}
          {tuile(theme.teintes.admin, false, 'Admin')}
        </View>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {tuile(theme.accent)}
          {tuile(theme.teintes.portefeuille)}
          {tuile(theme.teintes.admin)}
        </View>
      </View>
      <View style={{ flex: 2, gap: 8, minWidth: 160, justifyContent: 'center' }}>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {compte('Admin', theme.teintes.admin)}
          {compte('Ami A', theme.accent)}
          {compte('Ami B', theme.teintes.portefeuille)}
        </View>
        <Text style={{ color: theme.attenue, fontSize: 11 }}>Chaque compte dans son coffre. 🗝 code d’accès → l’admin ouvre un compte ami, journalisé.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  voile: { zIndex: 60, alignItems: 'center', justifyContent: 'center' },
  panneau: { borderWidth: 1, overflow: 'hidden' },
  surtitre: { fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  fonction: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: 1, flexWrap: 'wrap' },
  pastille: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  schema: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, padding: 16, borderWidth: 1 },
  tuile: { height: 38, borderWidth: 1.5, alignItems: 'flex-start', justifyContent: 'flex-end', padding: 5 },
  compte: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 8, borderWidth: 1.5 },
  puce: { fontSize: 10, fontWeight: '700', borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  ligneHistorique: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: 1 },
});
