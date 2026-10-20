/**
 * Barre d'outils du dessin sur la vidéo : outils (flèche, cercle, rectangle,
 * trait libre, texte, gomme), couleurs, épaisseur, annuler / rétablir,
 * enregistrer ou quitter. Cibles de 44 px (iPad au doigt).
 */

import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { BoutonHub, Champ } from '../../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { COULEURS_DESSIN, EPAISSEURS_DESSIN, OUTILS_DESSIN, TEXTE_DESSIN_MAX, type OutilDessin } from '../../review/dessin';
import { formatTemps } from '../../review/libelles';
import { Panneau, styles } from '../commun';
import { ESP, rayonControle, type EtatPresse } from '../design';
import { tr, trn } from '../../i18n';

export function BarreDessin({
  theme,
  instant,
  rattache,
  outil,
  couleur,
  epaisseur,
  texte,
  formes,
  peutAnnuler,
  peutRetablir,
  enCours,
  onOutil,
  onCouleur,
  onEpaisseur,
  onTexte,
  onAnnuler,
  onRetablir,
  onEnregistrer,
  onQuitter,
}: {
  theme: ThemeHub;
  instant: number;
  /** Titre du repère auquel le dessin sera rattaché (sinon, un repère est créé). */
  rattache?: string;
  outil: OutilDessin;
  couleur: string;
  epaisseur: number;
  texte: string;
  formes: number;
  peutAnnuler: boolean;
  peutRetablir: boolean;
  enCours?: boolean;
  onOutil(o: OutilDessin): void;
  onCouleur(c: string): void;
  onEpaisseur(e: number): void;
  onTexte(t: string): void;
  onAnnuler(): void;
  onRetablir(): void;
  onEnregistrer(): void;
  onQuitter(): void;
}) {
  const pastille = (actif: boolean) => (etat: EtatPresse) => ({
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: ESP.xs,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: actif ? 2 : 1,
    borderColor: actif ? theme.accent : etat.hovered || etat.focused ? theme.accent : theme.ligne,
    backgroundColor: actif ? teinteTransparente(theme.accent, 0.18) : theme.surface,
    borderRadius: rayonControle(theme),
  });
  return (
    <Panneau theme={theme} testID="esport-dessin-barre" style={{ padding: ESP.m, gap: ESP.s }}>
      <Text accessibilityRole="header" style={{ color: theme.texte, fontWeight: '800', fontSize: 16, ...police(theme.policeTitre) }}>
        {tr('review.barreDessin.dessin_a', { v: formatTemps(instant) })}</Text>
      <Text style={{ color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) }}>
        {rattache ? tr('review.barreDessin.rattache_au_repere', { rattache }) : tr('review.barreDessin.un_repere_sera_cree')} {tr('review.barreDessin.video_en_pause')}
      </Text>
      <View style={styles.ligne} accessibilityRole="radiogroup" accessibilityLabel={tr('review.barreDessin.outil_de_dessin')}>
        {OUTILS_DESSIN.map(o => (
          <Pressable
            key={o.cle}
            testID={`esport-dessin-outil-${o.cle}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: outil === o.cle }}
            accessibilityLabel={o.nom}
            onPress={() => onOutil(o.cle)}
            style={pastille(outil === o.cle)}>
            <Text style={{ color: theme.texte, fontSize: 18, fontWeight: '700' }}>{o.glyphe}</Text>
          </Pressable>
        ))}
      </View>
      {outil === 'texte' ? (
        <Champ theme={theme} libelle={tr('review.barreDessin.texte_a_poser_touchez')} valeur={texte} onChanger={onTexte} maxLength={TEXTE_DESSIN_MAX} testID="esport-dessin-texte" />
      ) : null}
      <View style={styles.ligne} accessibilityRole="radiogroup" accessibilityLabel={tr('membresRoles.couleur')}>
        {COULEURS_DESSIN.map(c => (
          <Pressable
            key={c.cle}
            testID={`esport-dessin-couleur-${c.cle.slice(1)}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: couleur === c.cle }}
            accessibilityLabel={tr('review.barreDessin.couleur', { nom: c.nom })}
            onPress={() => onCouleur(c.cle)}
            style={pastille(couleur === c.cle)}>
            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: c.cle, borderWidth: 1, borderColor: theme.ligne }} />
          </Pressable>
        ))}
        <View style={{ width: ESP.xs }} />
        {EPAISSEURS_DESSIN.map(e => (
          <Pressable
            key={e.cle}
            testID={`esport-dessin-epaisseur-${e.cle}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: epaisseur === e.cle }}
            accessibilityLabel={tr('review.barreDessin.epaisseur', { nom: e.nom })}
            onPress={() => onEpaisseur(e.cle)}
            style={pastille(epaisseur === e.cle)}>
            <View style={{ width: 24, height: Math.max(2, e.cle), borderRadius: e.cle, backgroundColor: theme.texte }} />
          </Pressable>
        ))}
      </View>
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <View style={styles.ligne}>
          <BoutonHub theme={theme} titre={tr('review.barreDessin.annuler')} onPress={onAnnuler} desactive={!peutAnnuler} testID="esport-dessin-annuler" libelle={tr('review.barreDessin.annuler_la_derniere_forme')} />
          <BoutonHub theme={theme} titre={tr('review.barreDessin.retablir')} onPress={onRetablir} desactive={!peutRetablir} testID="esport-dessin-retablir" libelle={tr('review.barreDessin.retablir_2')} />
          <Text testID="esport-dessin-nombre" style={{ color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) }}>
            {trn('review.barreDessin.formes', formes)}
          </Text>
        </View>
        <View style={styles.ligne}>
          <BoutonHub theme={theme} titre={tr('review.barreDessin.quitter_sans_enregistrer')} onPress={onQuitter} testID="esport-dessin-quitter" />
          <BoutonHub theme={theme} titre={tr('review.barreDessin.enregistrer_le_dessin')} variante="plein" onPress={onEnregistrer} desactive={enCours} testID="esport-dessin-enregistrer" />
        </View>
      </View>
    </Panneau>
  );
}
