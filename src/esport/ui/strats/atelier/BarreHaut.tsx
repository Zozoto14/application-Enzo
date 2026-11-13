/**
 * Barre du haut de l'atelier de strats (une ligne, 48 px) : retour, titre (renommé sur place), map, attaque /
 * défense ou mode, économie (Valorant), étage (The Finals), annuler / rétablir, état de l'enregistrement
 * (automatique ; un appui enregistre tout de suite), personnes présentes, Présenter, Comparer, Exporter,
 * tiroir, menu « Plus ». Les choix s'ouvrent en bulles (rendues par l'atelier) ; sur tablette et téléphone,
 * ce qui ne tient pas passe dans la bulle de la map ou dans « Plus ».
 */

import React, { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { police, teinteTransparente, type ThemeHub } from '../../../../hub/themes';
import { Glyphe } from '../../../../ui/icones';
import { tr } from '../../../i18n';
import { trAt, type CleAt } from '../../../i18n/atelier';
import { trSt, type CleSt } from '../../../i18n/strats2';
import { BoutonIcone, DIM, Separateur, mesurer, texteAtelier, type Format } from './briques';
import { tiroirOuvert } from './Tiroir';
import type { Ancre, EtatAtelier, EtatSauvegarde } from './useAtelier';


const ETATS: Record<EtatSauvegarde, { icone: string; cle: CleAt; court: CleAt }> = {
  lecture: { icone: 'oeil', cle: 'etat.lecture', court: 'etat.lecture' },
  enregistre: { icone: 'valide', cle: 'etat.enregistre', court: 'etat.enregistre' },
  modifie: { icone: 'crayon', cle: 'etat.modifie', court: 'etat.modifie_court' },
  enregistrement: { icone: 'synchro', cle: 'etat.enregistrement', court: 'etat.enregistrement' },
  erreur: { icone: 'alerte', cle: 'etat.erreur', court: 'etat.erreur_court' },
  conflit: { icone: 'alerte', cle: 'etat.conflit', court: 'etat.conflit' },
};

/** Titre de la strat : un appui le rend modifiable ; Entrée ou la perte du focus l'enregistre. */
function TitreStrat({ theme, titre, modifiable, onRenommer }: { theme: ThemeHub; titre: string; modifiable: boolean; onRenommer(t: string): void }) {
  const [edition, setEdition] = useState(false);
  const [valeur, setValeur] = useState(titre);
  useEffect(() => {
    if (!edition) setValeur(titre);
  }, [titre, edition]);
  const style = { color: theme.texte, fontSize: 15, fontWeight: '700' as const, ...police(theme.policeTitre) };
  const valider = () => {
    setEdition(false);
    if (valeur.trim() && valeur.trim() !== titre) onRenommer(valeur);
    else setValeur(titre);
  };
  if (edition) {
    return (
      <TextInput
        testID="esport-editeur-titre-champ"
        accessibilityLabel={trAt('haut.renommer')}
        value={valeur}
        onChangeText={setValeur}
        onBlur={valider}
        onSubmitEditing={valider}
        autoFocus
        maxLength={80}
        selectTextOnFocus
        style={[style, { flex: 1, minWidth: 80, height: 32, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, borderColor: theme.accent, backgroundColor: theme.fond }]}
      />
    );
  }
  return (
    <Pressable
      accessibilityRole={modifiable ? 'button' : 'text'}
      accessibilityLabel={modifiable ? `${titre}. ${trAt('haut.renommer')}` : titre}
      disabled={!modifiable}
      onPress={() => setEdition(true)}
      style={(etat: { pressed: boolean; hovered?: boolean }) => ({ flexShrink: 1, minWidth: 40, height: 32, paddingHorizontal: 8, borderRadius: 8, justifyContent: 'center', backgroundColor: etat.hovered && modifiable ? teinteTransparente(theme.attenue, 0.12) : 'transparent' })}>
      <Text style={style} numberOfLines={1} testID="esport-editeur-titre">
        {titre}
      </Text>
    </Pressable>
  );
}

/** Bouton à libellé et chevron qui ouvre une bulle (map, mode, économie). */
function Selecteur({ theme, icone, texte, libelle, testID, onAncre, largeurMax = 170 }: { theme: ThemeHub; icone?: string; texte: string; libelle: string; testID: string; onAncre(a: Ancre | undefined): void; largeurMax?: number }) {
  const ref = React.useRef<React.ComponentRef<typeof Pressable>>(null);
  return (
    <Pressable
      ref={ref}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${libelle} : ${texte}`}
      onPress={() => mesurer(ref.current, onAncre)}
      style={(etat: { pressed: boolean; hovered?: boolean }) => ({ height: 32, maxWidth: largeurMax, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 9, borderWidth: 1, borderColor: etat.hovered ? theme.accent : theme.ligne, backgroundColor: theme.fond })}>
      {icone ? <Glyphe valeur={icone} style={{ color: theme.attenue, fontSize: 14 }} /> : null}
      <Text style={{ ...texteAtelier(theme, 13, true), flexShrink: 1 }} numberOfLines={1}>
        {texte}
      </Text>
      <Glyphe valeur="chevron-bas" style={{ color: theme.attenue, fontSize: 12 }} />
    </Pressable>
  );
}

export function BarreHaut({ theme, a, format, largeur }: { theme: ThemeHub; a: EtatAtelier; format: Format; largeur: number }) {
  const { doc, strat, def } = a;
  if (!doc || !strat) return null;
  const bureau = format === 'bureau';
  const telephone = format === 'telephone';
  const large = largeur >= 1360;
  const etat = ETATS[a.sauvegarde];
  const couleurEtat = a.sauvegarde === 'enregistre' ? theme.ok : a.sauvegarde === 'erreur' || a.sauvegarde === 'conflit' ? theme.critique : a.sauvegarde === 'modifie' ? theme.alerte : theme.attenue;
  const bulle = (cle: string) => (ancre: Ancre | undefined) => a.setPopover({ cle, ancre });
  const iNiveau = a.niveau === null ? -1 : a.niveaux.findIndex(n => n.valeur === a.niveau);
  return (
    <View
      testID="esport-atelier-haut"
      accessibilityRole="toolbar"
      style={{ height: DIM.barre, flexDirection: 'row', alignItems: 'center', gap: telephone ? 2 : 6, paddingHorizontal: telephone ? 4 : 8, backgroundColor: theme.surface, borderBottomWidth: 1, borderBottomColor: theme.ligne, zIndex: 5 }}>
      <BoutonIcone theme={theme} icone="fleche-gauche" libelle={trAt('haut.retour')} onPress={() => void a.quitter()} testID="esport-editeur-retour" texte={large ? trAt('haut.strats') : undefined} bulle={large ? 'aucune' : 'bas'} />
      {telephone ? null : <Separateur theme={theme} />}
      <TitreStrat theme={theme} titre={strat.titre} modifiable={a.peutModifier} onRenommer={a.renommer} />
      {telephone ? null : (
        <Selecteur theme={theme} icone="carte" texte={doc.carte.nom} libelle={trSt('gauche.carte')} testID="esport-editeur-carte" onAncre={bulle(bureau ? 'carte' : 'reglages')} largeurMax={bureau ? 180 : 130} />
      )}
      {bureau && def.sides && a.peutModifier ? (
        <View style={{ flexDirection: 'row', height: 32, borderRadius: 9, borderWidth: 1, borderColor: theme.ligne, overflow: 'hidden' }} accessibilityRole="radiogroup" accessibilityLabel={tr('scouting.scouting.side')}>
          {(['attaque', 'defense'] as const).map(s => (
            <Pressable key={s} testID={`esport-editeur-side-${s}`} accessibilityRole="radio" accessibilityState={{ checked: doc.side === s }} onPress={() => a.faire({ type: 'side', side: s })} style={{ paddingHorizontal: 11, justifyContent: 'center', backgroundColor: doc.side === s ? (s === 'attaque' ? teinteTransparente('#ef4444', 0.3) : teinteTransparente('#3b82f6', 0.3)) : 'transparent' }}>
              <Text style={texteAtelier(theme, 12, doc.side === s)}>{s === 'attaque' ? tr('strats.editeur.attaque') : tr('strats.editeur.defense')}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {bureau && def.modes.length && a.peutModifier ? <Selecteur theme={theme} texte={trAt(`mode.court.${doc.mode ?? def.modes[0]}` as CleAt)} libelle={trSt('mode.titre')} testID="esport-editeur-mode" onAncre={bulle('mode')} /> : null}
      {bureau && def.economie.length && a.peutModifier ? (
        <Selecteur theme={theme} icone="billets" texte={doc.economie ? trSt(`economie.${doc.economie}` as CleSt) : trSt('economie.titre')} libelle={trSt('economie.titre')} testID="esport-editeur-economie" onAncre={bulle('economie')} largeurMax={140} />
      ) : null}
      {bureau && a.niveaux.length ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', height: 32, borderRadius: 9, borderWidth: 1, borderColor: theme.ligne }} accessibilityLabel={trSt('niveau.etage')} testID="esport-editeur-niveau">
          <BoutonIcone theme={theme} icone="chevron-bas" libelle={trAt('haut.etage_dessous')} taille={30} desactive={iNiveau < 0} onPress={() => a.setNiveau(iNiveau <= 0 ? null : a.niveaux[iNiveau - 1].valeur)} testID="esport-editeur-niveau-moins" />
          <Text style={{ ...texteAtelier(theme, 12, true), minWidth: 62, textAlign: 'center' }} testID="esport-editeur-niveau-nom" numberOfLines={1}>
            {iNiveau < 0 ? trAt('haut.etages_tous') : a.niveaux[iNiveau].nom}
          </Text>
          <BoutonIcone theme={theme} icone="chevron-haut" libelle={trAt('haut.etage_dessus')} taille={30} desactive={iNiveau >= a.niveaux.length - 1} onPress={() => a.setNiveau(a.niveaux[iNiveau + 1].valeur)} testID="esport-editeur-niveau-plus" />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 4 }} />
      {a.peutModifier && !telephone ? (
        <>
          <BoutonIcone theme={theme} icone="annuler" libelle={trAt('haut.annuler')} raccourci="Ctrl+Z" desactive={!a.historique?.passe.length} onPress={a.defaire} testID="esport-editeur-annuler" />
          <BoutonIcone theme={theme} icone="retablir" libelle={trAt('haut.retablir')} raccourci="Ctrl+Maj+Z" desactive={!a.historique?.futur.length} onPress={a.refaire} testID="esport-editeur-retablir" />
        </>
      ) : null}
      <Pressable
        testID="esport-editeur-enregistrer"
        accessibilityRole="button"
        accessibilityLabel={`${trAt(etat.cle)}${a.peutModifier ? `. ${trAt('etat.enregistrer_maintenant')}` : ''}`}
        disabled={!a.peutModifier || a.sauvegarde === 'enregistrement'}
        onPress={() => void a.enregistrer()}
        {...({ dataSet: { etat: a.sauvegarde } } as object)}
        style={(e: { pressed: boolean; hovered?: boolean }) => ({ height: 32, paddingHorizontal: bureau ? 10 : 8, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 9, borderWidth: 1, borderColor: e.hovered ? couleurEtat : 'transparent', backgroundColor: teinteTransparente(couleurEtat, 0.12) })}>
        <Glyphe valeur={etat.icone} style={{ color: couleurEtat, fontSize: 14 }} />
        {telephone ? null : (
          <Text style={{ ...texteAtelier(theme, 12, true), color: couleurEtat }} numberOfLines={1} testID="esport-editeur-etat">
            {trAt(large ? etat.cle : etat.court)}
          </Text>
        )}
      </Pressable>
      {telephone ? null : <Separateur theme={theme} />}
      <BoutonIcone theme={theme} icone="presentation" libelle={trSt('presentation.ouvrir')} texte={large ? trSt('presentation.ouvrir') : undefined} bulle={large ? 'aucune' : 'bas'} onPress={() => (a.setPresentation(true), a.setSelection([]))} testID="esport-editeur-presentation" />
      {bureau ? <BoutonIcone theme={theme} icone="colonnes" libelle={trSt('comparer.ouvrir')} texte={large ? trSt('comparer.ouvrir') : undefined} bulle={large ? 'aucune' : 'bas'} actif={a.comparer} onPress={() => a.setComparer(!a.comparer)} testID="esport-editeur-comparer" /> : null}
      {bureau ? <BoutonIcone theme={theme} icone="telecharger" libelle={trAt('haut.exporter')} texte={large ? trAt('haut.exporter') : undefined} bulle={large ? 'aucune' : 'bas'} onAncre={bulle('export')} testID="esport-editeur-exporter" /> : null}
      {bureau ? <BoutonIcone theme={theme} icone="panneau-droit" libelle={trAt('haut.tiroir')} actif={tiroirOuvert(a.prefs, a.tiroirAuto)} onPress={() => (a.setPrefs({ tiroir: tiroirOuvert(a.prefs, a.tiroirAuto) ? 'auto' : 'ouvert' }), a.setTiroirAuto(false))} testID="esport-editeur-tiroir" /> : null}
      <BoutonIcone theme={theme} icone="points" libelle={trAt('haut.plus')} onAncre={bulle('plus')} testID="esport-editeur-plus" />
    </View>
  );
}
