/**
 * Frise des étapes de l'atelier de strats (une ligne compacte, flottante sous la barre du haut) : lecture /
 * pause, arrêt, curseur de temps et durée ; étapes 1 à N à la couleur de leur phase (un appui l'affiche, on
 * les RÉORDONNE en les glissant : geste géré par l'écran web) ; ajout ; titre de l'étape courante modifiable
 * sur place ; la note s'ouvre dans le tiroir ; menu de l'étape (dupliquer, déplacer, vider, supprimer).
 * Téléphone : lecture, étape précédente / suivante, titre, note.
 */

import React from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { police, teinteTransparente, type ThemeHub } from '../../../../hub/themes';
import { trAt } from '../../../i18n/atelier';
import { trSt } from '../../../i18n/strats2';
import { ETAPES_MAX } from '../../../strats/document';
import { Curseur } from '../Barres';
import { couleurPhase, libellePhase } from '../Panneaux';
import { BoutonIcone, DIM, Separateur, attenueAtelier, texteAtelier, verre, type Format } from './briques';
import type { EtatAtelier } from './useAtelier';

export function FriseEtapes({ theme, a, format, largeurMax }: { theme: ThemeHub; a: EtatAtelier; format: Format; largeurMax: number }) {
  const doc = a.doc;
  const e = a.etapeCourante;
  if (!doc || !e) return null;
  const telephone = format === 'telephone';
  const duree = e.duree ?? 5;
  const n = doc.etapes.length;
  const lecture = (
    <>
      <BoutonIcone theme={theme} icone={a.enLecture ? 'pause' : 'lecture'} libelle={a.enLecture ? trSt('lecture.pause') : trSt('lecture.lire')} actif={a.enLecture} onPress={a.enLecture ? a.pause : a.lire} testID="esport-barre-lecture" taille={34} />
      {a.temps !== undefined ? <BoutonIcone theme={theme} icone="stop" libelle={trSt('lecture.arreter')} onPress={a.arreter} testID="esport-lecture-arreter" taille={34} /> : null}
    </>
  );
  const note = (
    <BoutonIcone
      theme={theme}
      icone="note"
      libelle={trAt('frise.note')}
      actif={Boolean(e.note)}
      onPress={() => {
        a.setOnglet('etape');
        a.setTiroirAuto(true);
      }}
      testID="esport-etape-note-ouvrir"
      taille={34}
    />
  );
  if (telephone) {
    return (
      <View style={[verre(theme, 12), { height: DIM.frise, flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 4, maxWidth: largeurMax }]} testID="esport-atelier-frise">
        {lecture}
        <BoutonIcone theme={theme} icone="chevron-gauche" libelle={trSt('lecture.precedente')} desactive={a.iEtape === 0} onPress={() => a.changerEtape(a.iEtape - 1)} testID="esport-etape-precedente" taille={34} bulle="aucune" />
        <View style={{ flex: 1, minWidth: 0, borderLeftWidth: 3, borderLeftColor: couleurPhase(e.phase), paddingLeft: 6 }}>
          <Text style={texteAtelier(theme, 12, true)} numberOfLines={1} testID="esport-etape-position">
            {`${a.iEtape + 1}/${n} · ${e.titre}`}
          </Text>
          <Text style={attenueAtelier(theme, 10)} numberOfLines={1}>
            {a.temps !== undefined ? trSt('lecture.temps', { t: a.temps.toFixed(1), d: duree }) : [e.phase ? libellePhase(e.phase) : '', trSt('etape.secondes', { s: duree })].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <BoutonIcone theme={theme} icone="chevron-droite" libelle={trSt('lecture.suivante')} desactive={a.iEtape >= n - 1} onPress={() => a.changerEtape(a.iEtape + 1)} testID="esport-etape-suivante" taille={34} bulle="aucune" />
        {note}
        {a.peutModifier ? <BoutonIcone theme={theme} icone="points" libelle={trAt('frise.menu')} onAncre={ancre => a.setPopover({ cle: 'etape', ancre })} testID="esport-etape-menu" taille={34} bulle="aucune" /> : null}
      </View>
    );
  }
  return (
    <View style={[verre(theme, 12), { height: DIM.frise, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, maxWidth: largeurMax }]} testID="esport-atelier-frise">
      {lecture}
      <View style={{ width: format === 'bureau' ? 110 : 70 }}>
        <Curseur theme={theme} valeur={a.temps ?? 0} max={duree} onChanger={a.allerTemps} libelle={trSt('gauche.curseur')} testID="esport-barre-curseur" />
      </View>
      <Text style={{ ...attenueAtelier(theme, 11), minWidth: 62, ...police(theme.policeChiffres) }} testID="esport-lecture-temps">{`${(a.temps ?? 0).toFixed(1)} / ${duree} s`}</Text>
      <Separateur theme={theme} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexShrink: 1, flexGrow: 0 }} contentContainerStyle={{ gap: 3, alignItems: 'center' }} accessibilityRole="tablist" accessibilityLabel={trSt('etape.etapes')} testID="esport-frise-etapes">
        {doc.etapes.map((x, i) => {
          const actif = i === a.iEtape;
          const cible = a.glisseEtape?.vers === i && a.glisseEtape.de !== i;
          return (
            <Pressable
              key={x.id}
              testID={`esport-etape-num-${i}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: actif }}
              accessibilityLabel={`${trSt('gauche.etape_n', { n: i + 1 })} : ${x.titre}${x.phase ? ` (${libellePhase(x.phase)})` : ''}`}
              onPress={() => a.changerEtape(i)}
              style={(etat: { pressed: boolean; hovered?: boolean }) => ({
                minWidth: 30,
                height: 32,
                paddingHorizontal: 6,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 8,
                borderWidth: actif || cible ? 2 : 1,
                borderColor: cible ? theme.ok : actif ? theme.accent : theme.ligne,
                borderBottomWidth: 4,
                borderBottomColor: couleurPhase(x.phase),
                backgroundColor: actif ? teinteTransparente(theme.accent, 0.2) : etat.hovered ? teinteTransparente(theme.attenue, 0.12) : 'transparent',
                opacity: a.glisseEtape?.de === i ? 0.45 : 1,
              })}>
              <Text style={texteAtelier(theme, 12, actif)}>{i + 1}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {a.peutModifier ? <BoutonIcone theme={theme} icone="plus" libelle={trAt(a.prefs.reprise ? 'frise.ajouter_reprise' : 'frise.ajouter')} desactive={n >= ETAPES_MAX} onPress={a.ajouterEtape} testID="esport-etape-num-ajouter" taille={32} /> : null}
      <Separateur theme={theme} />
      {a.peutModifier ? (
        <TextInput
          testID="esport-etape-titre"
          accessibilityLabel={trSt('etape.titre')}
          value={e.titre}
          onChangeText={titre => a.faire({ type: 'titreEtape', etape: a.iEtape, titre })}
          maxLength={60}
          style={{ width: format === 'bureau' ? 170 : 110, height: 30, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.fond, color: theme.texte, fontSize: 13, fontWeight: '600', ...police(theme.policeTexte) }}
        />
      ) : (
        <Text style={{ ...texteAtelier(theme, 13, true), maxWidth: 180 }} numberOfLines={1}>
          {e.titre}
        </Text>
      )}
      <Text style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} testID="esport-etape-position" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {trSt('etape.position', { n: a.iEtape + 1, total: n })}
      </Text>
      {note}
      {a.peutModifier ? <BoutonIcone theme={theme} icone="points" libelle={trAt('frise.menu')} onAncre={ancre => a.setPopover({ cle: 'etape', ancre })} testID="esport-etape-menu" taille={32} /> : null}
    </View>
  );
}
