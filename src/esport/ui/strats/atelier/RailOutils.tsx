/**
 * Rail d'outils de l'atelier de strats (vertical, à gauche ; horizontal sur téléphone) : sélection, main,
 * pion, capacité, flèche, ligne, forme, texte, marqueur, vision, gomme ; puis aimantation, map retournée ;
 * zoom et aide en bas. Chaque bouton a son info-bulle (nom et raccourci). `OptionsOutil` : les réglages de
 * l'outil armé (zone d'une capacité, type de marqueur, usage d'une flèche, texte à poser, couleur libre).
 */

import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Champ } from '../../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../../hub/themes';
import { tr } from '../../../i18n';
import { trAt, type CleAt } from '../../../i18n/atelier';
import { trSt, type CleSt } from '../../../i18n/strats2';
import { COULEURS_LIBRES, FORMES_ZONE, USAGES_TRACE, type FormeZone, type UsageTrace } from '../../../strats/document';
import type { Outil } from '../canevas/types';
import { FicheCapacite } from '../Panneaux';
import { Bascule, BoutonIcone, DIM, PuceTexte, Separateur, TitreSection, attenueAtelier, texteAtelier, verre } from './briques';
import type { EtatAtelier } from './useAtelier';

/** Outils : icônes MONOCHROMES de l'interface (src/ui/icones) ; les images du jeu sont réservées aux agents et capacités. */
export const OUTILS: ReadonlyArray<readonly [Outil, string, CleSt, string]> = [
  ['selection', 'selection', 'outil.selection', 'V'],
  ['main', 'main', 'outil.main', 'H'],
  ['agent', 'personne', 'outil.agent', 'A'],
  ['capacite', 'etincelles', 'outil.capacite', 'C'],
  ['fleche', 'fleche-diagonale', 'outil.fleche', 'F'],
  ['ligne', 'trait', 'outil.ligne', 'L'],
  ['forme', 'carre', 'outil.forme', 'R'],
  ['texte', 'texte', 'outil.texte', 'T'],
  ['marqueur', 'losange', 'outil.marqueur', 'M'],
  ['vision', 'oeil', 'outil.vision', 'O'],
  ['gomme', 'gomme', 'outil.gomme', 'E'],
];
/** Outils qui ont des réglages (panneau « Options »). */
export const OUTILS_A_OPTIONS: ReadonlyArray<Outil> = ['capacite', 'fleche', 'ligne', 'forme', 'texte', 'marqueur', 'vision'];

export function RailOutils({ theme, a, horizontal = false, hauteurMax, tactile = false }: { theme: ThemeHub; a: EtatAtelier; horizontal?: boolean; hauteurMax?: number; tactile?: boolean }) {
  const taille = tactile ? 44 : DIM.bouton;
  const cote = horizontal ? 'haut' : 'droite';
  const outils = OUTILS.map(([id, icone, cle, raccourci]) => (
    <BoutonIcone key={id} theme={theme} icone={icone} libelle={trSt(cle)} raccourci={raccourci} actif={a.outil === id} onPress={() => a.setOutil(id)} testID={`esport-outil-${id}`} taille={taille} bulle={cote} />
  ));
  const reglages = (
    <>
      <BoutonIcone theme={theme} icone="aimant" libelle={trAt('rail.aimant')} raccourci="G" actif={Boolean(a.aimant)} onPress={() => a.setAimant(a.aimant ? 0 : 10)} testID="esport-editeur-aimant" taille={taille} bulle={cote} />
      <BoutonIcone theme={theme} icone="synchro" libelle={trSt('outil.retourner')} actif={a.rotation === 180} onPress={() => a.setRotation(a.rotation ? 0 : 180)} testID="esport-editeur-retourner" taille={taille} bulle={cote} />
    </>
  );
  const zoom = (
    <>
      <BoutonIcone theme={theme} icone="plus" libelle={tr('strats.editeur.zoomer')} raccourci="+" onPress={() => a.zoom(1.25)} testID="esport-editeur-zoom-plus" taille={taille} bulle={cote} />
      <BoutonIcone theme={theme} libelle={trAt('rail.ajuster')} raccourci="0" onPress={a.ajuster} testID="esport-editeur-zoom-zero" taille={taille} bulle={cote} enfants={<Text style={{ ...texteAtelier(theme, 10, true), color: theme.attenue }}>{`${Math.round(a.vue.echelle * 100)}`}</Text>} />
      <BoutonIcone theme={theme} icone="moins" libelle={tr('strats.editeur.dezoomer')} raccourci="-" onPress={() => a.zoom(1 / 1.25)} testID="esport-editeur-zoom-moins" taille={taille} bulle={cote} />
      <BoutonIcone theme={theme} icone="question" libelle={trAt('rail.aide')} raccourci="?" actif={a.aide} onPress={() => a.setAide(!a.aide)} testID="esport-editeur-aide" taille={taille} bulle={cote} />
    </>
  );
  if (horizontal) {
    return (
      <View style={[verre(theme, 12), { marginHorizontal: DIM.marge }]} testID="esport-atelier-rail" accessibilityRole="toolbar" accessibilityLabel={trSt('gauche.outils')}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 4, gap: 2, alignItems: 'center' }}>
          {a.peutModifier ? outils : null}
          {a.peutModifier ? <Separateur theme={theme} /> : null}
          {a.peutModifier ? reglages : null}
          {zoom}
        </ScrollView>
      </View>
    );
  }
  return (
    <View testID="esport-atelier-rail" accessibilityRole="toolbar" accessibilityLabel={trSt('gauche.outils')} style={[verre(theme, 12), { padding: 4, gap: 2, flexDirection: 'column', flexWrap: 'wrap', maxHeight: hauteurMax, alignContent: 'flex-start' }]}>
      {a.peutModifier ? outils : null}
      {a.peutModifier ? <Separateur theme={theme} vertical={false} /> : null}
      {a.peutModifier ? reglages : null}
      {a.peutModifier ? <Separateur theme={theme} vertical={false} /> : null}
      {zoom}
    </View>
  );
}

function Couleurs({ theme, a }: { theme: ThemeHub; a: EtatAtelier }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }} accessibilityLabel={trAt('options.couleur')}>
      <Pressable testID="esport-couleur-joueur" accessibilityRole="button" accessibilityLabel={trAt('options.couleur_joueur')} accessibilityState={{ selected: !a.couleurLibre }} onPress={() => a.setCouleurLibre(undefined)} style={{ height: 26, paddingHorizontal: 8, borderRadius: 13, justifyContent: 'center', borderWidth: 1.5, borderColor: !a.couleurLibre ? theme.accent : theme.ligne }}>
        <Text style={texteAtelier(theme, 11, !a.couleurLibre)}>{trAt('options.couleur_joueur')}</Text>
      </Pressable>
      {COULEURS_LIBRES.map(c => (
        <Pressable key={c} testID={`esport-couleur-${c.slice(1)}`} accessibilityRole="button" accessibilityLabel={tr('strats.editeur.couleur', { c })} accessibilityState={{ selected: a.couleurLibre === c }} onPress={() => a.setCouleurLibre(c)} style={{ width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: a.couleurLibre === c ? theme.accent : 'transparent' }}>
          <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: c, borderWidth: 1, borderColor: theme.ligne }} />
        </Pressable>
      ))}
    </View>
  );
}

/** Réglages de l'outil armé ; rien si l'outil n'en a pas. */
export function OptionsOutil({ theme, a }: { theme: ThemeHub; a: EtatAtelier }) {
  const { outil, def } = a;
  if (!OUTILS_A_OPTIONS.includes(outil) || !a.peutModifier) return null;
  const m = a.marqueur;
  return (
    <View style={{ gap: 10 }} testID="esport-atelier-options">
      {outil === 'capacite' ? (
        <>
          <FicheCapacite theme={theme} capacite={a.capacite} />
          {a.capacite?.description ? (
            <Text style={attenueAtelier(theme, 11)} numberOfLines={3}>
              {a.capacite.description}
            </Text>
          ) : null}
          <TitreSection theme={theme}>{tr('strats.editeur.zone')}</TitreSection>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
            {(['auto', ...FORMES_ZONE, 'aucune'] as Array<FormeZone | 'auto' | 'aucune'>).map(f => (
              <PuceTexte key={f} theme={theme} texte={f === 'auto' ? trSt('forme.auto') : f === 'aucune' ? tr('strats.editeur.icone_seule') : trAt(`forme.court.${f}` as CleAt)} actif={a.formeZone === f} onPress={() => a.setFormeZone(f)} testID={`esport-zone-${f}`} hauteur={28} />
            ))}
          </View>
        </>
      ) : null}
      {outil === 'marqueur' ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }} testID="esport-editeur-marqueurs">
            {def.marqueurs.map(g => (
              <PuceTexte key={g} theme={theme} texte={trSt(`marqueur.${g}` as CleSt)} actif={m.genre === g} onPress={() => a.setMarqueur({ ...m, genre: g })} testID={`esport-marqueur-${g}`} hauteur={28} />
            ))}
          </View>
          {m.genre === 'ennemi' && def.equipesAdverses > 1 ? (
            <Bascule theme={theme} libelle={trSt('marqueur.equipe')} valeur={String(m.equipe ?? 1)} options={Array.from({ length: def.equipesAdverses }, (_, i) => [String(i + 1), trSt('marqueur.equipe_n', { n: i + 1 })] as const)} onChoisir={v => a.setMarqueur({ ...m, equipe: Number(v) })} testID="esport-marqueur-equipe" hauteur={28} />
          ) : null}
          <Champ theme={theme} libelle={trSt('marqueur.etiquette')} valeur={m.etiquette} onChanger={v => a.setMarqueur({ ...m, etiquette: v.slice(0, 40) })} maxLength={40} testID="esport-marqueur-etiquette" />
          <Couleurs theme={theme} a={a} />
        </>
      ) : null}
      {outil === 'vision' ? (
        <>
          <Bascule theme={theme} libelle={trSt('inspecteur.ouverture')} valeur={String(a.vision.ouverture)} options={[['60', '60°'], ['90', '90°'], ['120', '120°'], ['360', '360°']] as const} onChoisir={v => a.setVision({ ...a.vision, ouverture: Number(v) })} testID="esport-vision-ouverture" hauteur={28} />
          <Bascule theme={theme} libelle={trSt('inspecteur.portee')} valeur={String(a.vision.portee)} options={[['15', '15 m'], ['30', '30 m'], ['50', '50 m']] as const} onChoisir={v => a.setVision({ ...a.vision, portee: Number(v) })} testID="esport-vision-portee" hauteur={28} />
        </>
      ) : null}
      {outil === 'texte' ? (
        <>
          <Champ theme={theme} libelle={tr('strats.editeur.texte_a_poser_touchez')} valeur={a.texte} onChanger={a.setTexte} maxLength={200} testID="esport-editeur-texte" />
          <Couleurs theme={theme} a={a} />
        </>
      ) : null}
      {outil === 'forme' ? (
        <>
          <Bascule<'rect' | 'ellipse'> theme={theme} libelle={tr('strats.editeur.forme')} valeur={a.formeDessin} options={[['rect', tr('strats.editeur.rectangle')], ['ellipse', tr('strats.editeur.ellipse')]]} onChoisir={a.setFormeDessin} testID="esport-forme" hauteur={28} />
          <Couleurs theme={theme} a={a} />
        </>
      ) : null}
      {outil === 'fleche' || outil === 'ligne' ? (
        <>
          <TitreSection theme={theme}>{trAt('options.usage')}</TitreSection>
          <Bascule<UsageTrace> theme={theme} libelle={trAt('options.usage')} valeur={a.usage} options={USAGES_TRACE.map(u => [u, trAt(`usage.${u}` as CleAt)] as const)} onChoisir={a.setUsage} testID="esport-usage" hauteur={28} />
          {outil === 'fleche' ? (
            <Pressable testID="esport-trajet-joueur" accessibilityRole="checkbox" accessibilityState={{ checked: a.trajetJoueur }} onPress={() => a.setTrajetJoueur(!a.trajetJoueur)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 28 }}>
              <View style={{ width: 16, height: 16, borderRadius: 4, borderWidth: 1.5, borderColor: a.trajetJoueur ? theme.accent : theme.attenue, backgroundColor: a.trajetJoueur ? theme.accent : 'transparent' }} />
              <Text style={{ ...texteAtelier(theme, 12), flex: 1 }}>{trAt('options.trajet_joueur')}</Text>
            </Pressable>
          ) : null}
          <Couleurs theme={theme} a={a} />
        </>
      ) : null}
    </View>
  );
}

/** Panneau flottant des options de l'outil, à droite du rail (repliable). */
export function PanneauOptions({ theme, a, replie, onReplier }: { theme: ThemeHub; a: EtatAtelier; replie: boolean; onReplier(r: boolean): void }) {
  if (!OUTILS_A_OPTIONS.includes(a.outil) || !a.peutModifier) return null;
  const outil = OUTILS.find(o => o[0] === a.outil);
  return (
    <View style={[verre(theme, 12), { width: replie ? undefined : 236, overflow: 'hidden' }]} testID="esport-atelier-options-panneau">
      <Pressable testID="esport-atelier-options-replier" accessibilityRole="button" accessibilityState={{ expanded: !replie }} accessibilityLabel={trAt('options.titre')} onPress={() => onReplier(!replie)} style={{ height: 32, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: teinteTransparente(theme.attenue, 0.08) }}>
        <Text style={{ ...texteAtelier(theme, 12, true), flex: replie ? undefined : 1 }} numberOfLines={1}>
          {outil ? trSt(outil[2]) : trAt('options.titre')}
        </Text>
        <Text style={attenueAtelier(theme, 11)}>{replie ? '▸' : '▾'}</Text>
      </Pressable>
      {replie ? null : (
        <View style={{ padding: 10 }}>
          <OptionsOutil theme={theme} a={a} />
        </View>
      )}
    </View>
  );
}
