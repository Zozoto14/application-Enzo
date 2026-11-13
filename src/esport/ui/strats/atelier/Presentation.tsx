/**
 * Mode Présenter de l'atelier de strats (briefing) : la map en grand, plein écran ; titre et phase de l'étape ;
 * note et ordre des utilitaires dans un panneau repliable ; étapes au clavier (flèches, Espace) ou en
 * balayant ; lecture enchaînée ; pointeur laser (bouton, ou touche L tenue) ; « mon rôle » : un appui sur un
 * joueur estompe tout le reste (touches 1 à 5, 0 pour tout revoir).
 */

import React, { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View, type GestureResponderEvent } from 'react-native';
import { police, teinteTransparente, type ThemeHub } from '../../../../hub/themes';
import { trAt } from '../../../i18n/atelier';
import { trSt } from '../../../i18n/strats2';
import { ordreUtilitaires } from '../../../strats/document';
import type { Marges } from '../../../strats/geometrie';
import { NoteMarkdown } from '../../review/Note';
import type { PropsCanevas } from '../canevas/types';
import { couleurPhase, libellePhase } from '../Panneaux';
import { BoutonIcone, Separateur, attenueAtelier, texteAtelier, verre, type Format } from './briques';
import type { EtatAtelier } from './useAtelier';

export function Presentation({
  theme,
  a,
  format,
  fenetre,
  canevas,
  pleinEcran,
  onPleinEcran,
}: {
  theme: ThemeHub;
  a: EtatAtelier;
  format: Format;
  fenetre: { largeur: number; hauteur: number };
  canevas(props: PropsCanevas): React.ReactNode;
  pleinEcran?: boolean;
  onPleinEcran?(actif: boolean): void;
}) {
  const [panneau, setPanneau] = useState(format !== 'telephone');
  const depart = useRef<{ x: number; y: number } | undefined>(undefined);
  const doc = a.doc;
  const e = a.etapeCourante;
  if (!doc || !e || !a.propsCanevas) return null;
  const n = doc.etapes.length;
  const telephone = format === 'telephone';
  const largeurPanneau = panneau && !telephone ? Math.min(340, Math.round(fenetre.largeur * 0.3)) : 0;
  const hautPanneau = panneau && telephone ? Math.round(fenetre.hauteur * 0.3) : 0;
  const marges: Marges = { haut: 60, bas: 76 + hautPanneau, gauche: 8, droite: largeurPanneau + 8 };
  const fermer = () => {
    a.echap();
    onPleinEcran?.(false);
  };
  // Balayage horizontal (barre du bas, panneau de note) : étape précédente ou suivante.
  const balayage = {
    onStartShouldSetResponder: () => true,
    onResponderGrant: (ev: GestureResponderEvent) => {
      depart.current = { x: ev.nativeEvent.pageX, y: ev.nativeEvent.pageY };
    },
    onResponderRelease: (ev: GestureResponderEvent) => {
      const d = depart.current;
      depart.current = undefined;
      if (!d) return;
      const dx = ev.nativeEvent.pageX - d.x;
      if (Math.abs(dx) < 60 || Math.abs(ev.nativeEvent.pageY - d.y) > Math.abs(dx)) return;
      if (dx < 0) a.changerEtape(Math.min(n - 1, a.iEtape + 1));
      else a.changerEtape(Math.max(0, a.iEtape - 1));
    },
  };
  const utilitaires = ordreUtilitaires(e);
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#05070c', zIndex: 60 }} testID="esport-presentation">
      {canevas({ ...a.propsCanevas, largeur: fenetre.largeur, hauteur: fenetre.hauteur, marges, outil: 'main', lectureSeule: true, selection: [], onAction: () => undefined, onMenu: undefined, laser: a.laser ? (a.laserLibre ? 'libre' : 'appui') : undefined, fantome: false, testID: 'esport-presentation-canevas' })}
      {/* Titre de l'étape */}
      <View style={{ position: 'absolute', top: 10, left: 10, right: largeurPanneau + 10, flexDirection: 'row', alignItems: 'center', gap: 8 }} pointerEvents="box-none">
        <View style={[verre(theme, 12), { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, height: 44, flexShrink: 1 }]}>
          {e.phase ? (
            <View style={{ backgroundColor: couleurPhase(e.phase), borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ color: '#ffffff', fontWeight: '700', fontSize: 12 }}>{libellePhase(e.phase)}</Text>
            </View>
          ) : null}
          <Text style={{ color: theme.texte, fontSize: telephone ? 15 : 19, fontWeight: '800', flexShrink: 1, ...police(theme.policeTitre) }} numberOfLines={1} testID="esport-presentation-titre">
            {`${a.iEtape + 1}. ${e.titre}`}
          </Text>
          {telephone ? null : (
            <Text style={attenueAtelier(theme, 12)} numberOfLines={1}>
              {a.strat?.titre}
            </Text>
          )}
        </View>
        <View style={{ flex: 1 }} />
        <View style={[verre(theme, 12), { flexDirection: 'row', alignItems: 'center', padding: 3, gap: 2 }]}>
          <BoutonIcone theme={theme} icone="pointeur" libelle={trAt('presentation.laser')} raccourci="L" actif={a.laser} onPress={() => a.setLaser(!a.laser)} testID="esport-presentation-laser" />
          <BoutonIcone theme={theme} icone="note" libelle={trAt('presentation.note')} actif={panneau} onPress={() => setPanneau(!panneau)} testID="esport-presentation-note" />
          {onPleinEcran ? <BoutonIcone theme={theme} icone="cadrer" libelle={trAt('presentation.plein_ecran')} actif={pleinEcran} onPress={() => onPleinEcran(!pleinEcran)} testID="esport-presentation-plein-ecran" /> : null}
          <BoutonIcone theme={theme} icone="croix" libelle={trSt('presentation.fermer')} raccourci={trAt('aide.echap.t')} onPress={fermer} testID="esport-presentation-fermer" />
        </View>
      </View>
      {/* Note et utilitaires */}
      {panneau ? (
        <View
          {...balayage}
          testID="esport-presentation-panneau"
          style={[verre(theme, 14), telephone ? { position: 'absolute', left: 8, right: 8, bottom: 78, height: hautPanneau - 8 } : { position: 'absolute', top: 62, right: 8, bottom: 78, width: largeurPanneau - 8 }]}>
          <ScrollView contentContainerStyle={{ padding: 14, gap: 10 }}>
            <Text style={attenueAtelier(theme, 12)}>{[e.phase ? libellePhase(e.phase) : '', trSt('etape.secondes', { s: e.duree ?? 5 })].filter(Boolean).join(' · ')}</Text>
            {e.note ? <NoteMarkdown theme={theme} source={e.note} testID="esport-presentation-note-texte" /> : <Text style={attenueAtelier(theme, 13)}>{trAt('presentation.sans_note')}</Text>}
            {utilitaires.length ? (
              <View style={{ gap: 4, marginTop: 4 }}>
                <Text style={{ ...texteAtelier(theme, 11, true), color: theme.attenue, textTransform: 'uppercase', letterSpacing: 0.7 }}>{trSt('utilitaires.titre')}</Text>
                {utilitaires.map(c => (
                  <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, opacity: a.surligne === null || c.joueur === a.surligne ? 1 : 0.35 }}>
                    <Text style={{ ...texteAtelier(theme, 13, true), width: 18 }}>{c.ordre ?? '–'}</Text>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.couleur }} />
                    <Text style={{ ...texteAtelier(theme, 13), flex: 1 }} numberOfLines={1}>{`${c.nom}${c.joueur !== null && doc.joueurs[c.joueur] ? ` · ${doc.joueurs[c.joueur].nom}` : ''}`}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </ScrollView>
        </View>
      ) : null}
      {/* Commandes : étapes, lecture, joueurs */}
      <View {...balayage} style={{ position: 'absolute', left: 10, right: 10, bottom: 10, alignItems: 'center' }} pointerEvents="box-none">
        <View style={[verre(theme, 14), { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 5, maxWidth: '100%' }]} testID="esport-presentation-commandes">
          <BoutonIcone theme={theme} icone="precedent" libelle={trSt('lecture.precedente')} raccourci="←" desactive={a.iEtape === 0} onPress={() => a.changerEtape(a.iEtape - 1)} testID="esport-presentation-precedente" taille={44} bulle="haut" />
          <BoutonIcone theme={theme} icone={a.enLecture ? 'pause' : 'lecture'} libelle={a.enLecture ? trSt('lecture.pause') : trSt('lecture.lire')} raccourci="Espace" plein onPress={a.enLecture ? a.pause : a.lire} testID="esport-presentation-lecture" taille={44} bulle="haut" />
          <BoutonIcone theme={theme} icone="suivant" libelle={trSt('lecture.suivante')} raccourci="→" desactive={a.iEtape >= n - 1} onPress={() => a.changerEtape(a.iEtape + 1)} testID="esport-presentation-suivante" taille={44} bulle="haut" />
          <Text style={{ ...texteAtelier(theme, 13, true), minWidth: 44, textAlign: 'center', ...police(theme.policeChiffres) }} testID="esport-presentation-position">{`${a.iEtape + 1} / ${n}`}</Text>
          {telephone ? null : (
            <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center', paddingHorizontal: 4 }} accessibilityRole="tablist">
              {doc.etapes.map((x, i) => (
                <Pressable key={x.id} testID={`esport-presentation-etape-${i}`} accessibilityRole="tab" accessibilityState={{ selected: i === a.iEtape }} accessibilityLabel={`${i + 1}. ${x.titre}`} onPress={() => a.changerEtape(i)} style={{ width: i === a.iEtape ? 22 : 10, height: 10, borderRadius: 5, backgroundColor: i === a.iEtape ? theme.accent : teinteTransparente(theme.attenue, 0.5) }} />
              ))}
            </View>
          )}
          <Separateur theme={theme} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 4, alignItems: 'center' }} accessibilityLabel={trAt('presentation.mon_role')}>
            {doc.joueurs.map((j, i) => {
              const actif = a.surligne === i;
              return (
                <Pressable
                  key={i}
                  testID={`esport-presentation-joueur-${i}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: actif }}
                  accessibilityLabel={trAt('dock.mettre_en_avant', { nom: j.nom })}
                  onPress={() => a.setSurligne(actif ? null : i)}
                  style={{ height: 36, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 18, borderWidth: 2, borderColor: actif ? j.couleur : 'transparent', backgroundColor: actif ? teinteTransparente(j.couleur, 0.25) : teinteTransparente(theme.attenue, 0.14), opacity: a.surligne === null || actif ? 1 : 0.55 }}>
                  <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: j.couleur }} />
                  <Text style={texteAtelier(theme, 12, actif)} numberOfLines={1}>
                    {j.nom}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </View>
  );
}
