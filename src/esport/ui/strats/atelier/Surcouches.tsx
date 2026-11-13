/**
 * Surcouches de l'atelier de strats :
 *  - `MenuContextuel` (clic droit, appui long) : dupliquer, copier vers l'étape suivante, premier plan /
 *    arrière-plan, verrouiller, changer de joueur, changer d'étage (The Finals), supprimer ; sur le vide :
 *    coller, tout sélectionner, map entière ;
 *  - `LigneEtat` : UNE ligne en bas (ce que fait l'outil armé, la cote du geste en cours, le résultat d'une
 *    action), le callout sous le pointeur, la puce « Map non calibrée », le zoom ;
 *  - `Legende` : les capacités de l'étape et leur propriétaire ;
 *  - `Aide` : raccourcis clavier et gestes ; `Bandeaux` : conflit d'enregistrement, nouvelle version d'un autre.
 */

import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { BoutonHub } from '../../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../../hub/themes';
import { Glyphe } from '../../../../ui/icones';
import { tr } from '../../../i18n';
import { trAt, type CleAt } from '../../../i18n/atelier';
import { trSt, type CleSt } from '../../../i18n/strats2';
import { ordreUtilitaires } from '../../../strats/document';
import { couleurAffichee } from '../../../strats/plateau';
import { IconeAsset } from '../Barres';
import { sourcesIcone } from '../../../strats/assets';
import { MentionRiot } from '../commun';
import { Bulle, BoutonIcone, DIM, LigneMenu, Separateur, TitreSection, attenueAtelier, texteAtelier, verre, type Format } from './briques';
import type { EtatAtelier } from './useAtelier';

export function MenuContextuel({ theme, a, fenetre, feuille }: { theme: ThemeHub; a: EtatAtelier; fenetre: { largeur: number; hauteur: number }; feuille: boolean }) {
  const m = a.menu;
  const doc = a.doc;
  if (!m || !doc) return null;
  const fermer = () => a.setMenu(undefined);
  const faire = (action: () => void) => () => {
    fermer();
    action();
  };
  const objets = a.choisis;
  const verrouilles = objets.length > 0 && objets.every(o => o.verrou);
  const avecJoueur = objets.some(o => 'joueur' in o);
  return (
    <Bulle theme={theme} ancre={{ x: m.x, y: m.y, l: 0, h: 0 }} fenetre={fenetre} largeur={248} cote="point" feuille={feuille} onFermer={fermer} testID="esport-menu-contextuel">
      {m.ids.length ? (
        <>
          <LigneMenu theme={theme} icone="copier" texte={trSt('inspecteur.dupliquer')} raccourci="Ctrl+D" onPress={faire(a.dupliquerSelection)} testID="esport-menu-dupliquer" />
          <LigneMenu theme={theme} icone="suivant" texte={trAt('menu.copier_suivante')} onPress={faire(a.copierVersSuivante)} testID="esport-menu-copier-suivante" />
          <LigneMenu theme={theme} icone="premier-plan" texte={trAt('menu.premier_plan')} onPress={faire(() => a.ordonnerSelection('avant'))} testID="esport-menu-avant" />
          <LigneMenu theme={theme} icone="arriere-plan" texte={trAt('menu.arriere_plan')} onPress={faire(() => a.ordonnerSelection('arriere'))} testID="esport-menu-arriere" />
          <LigneMenu theme={theme} icone={verrouilles ? 'cadenas-ouvert' : 'cadenas'} texte={trAt(verrouilles ? 'menu.deverrouiller' : 'menu.verrouiller')} onPress={faire(() => a.verrouillerSelection(!verrouilles))} testID="esport-menu-verrou" />
          {avecJoueur ? (
            <>
              <View style={{ paddingHorizontal: 10, paddingTop: 8, paddingBottom: 2 }}>
                <TitreSection theme={theme}>{trAt('menu.joueur')}</TitreSection>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, paddingHorizontal: 8, paddingBottom: 4 }}>
                {doc.joueurs.map((j, i) => (
                  <Pressable key={i} testID={`esport-menu-joueur-${i}`} accessibilityRole="menuitem" accessibilityLabel={trSt('joueurs.choisir', { nom: j.nom, n: i + 1 })} onPress={faire(() => a.affecterJoueur(i))} style={{ height: 30, paddingHorizontal: 8, borderRadius: 15, flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: theme.ligne }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: j.couleur }} />
                    <Text style={texteAtelier(theme, 12)} numberOfLines={1}>
                      {j.nom}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}
          {a.niveaux.length ? (
            <>
              <View style={{ paddingHorizontal: 10, paddingTop: 8, paddingBottom: 2 }}>
                <TitreSection theme={theme}>{trAt('menu.etage')}</TitreSection>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, paddingHorizontal: 8, paddingBottom: 4 }}>
                {[{ valeur: null as number | null, nom: trSt('niveau.tous') }, ...a.niveaux].map(x => (
                  <Pressable key={String(x.valeur)} testID={`esport-menu-niveau-${x.valeur ?? 'tous'}`} accessibilityRole="menuitem" onPress={faire(() => a.affecterNiveau(x.valeur))} style={{ height: 30, paddingHorizontal: 9, borderRadius: 15, justifyContent: 'center', borderWidth: 1, borderColor: theme.ligne }}>
                    <Text style={texteAtelier(theme, 12)}>{x.nom}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}
          <Separateur theme={theme} vertical={false} />
          <LigneMenu theme={theme} icone="corbeille" texte={trAt('menu.supprimer')} raccourci="Suppr" danger onPress={faire(a.supprimerSelection)} testID="esport-menu-supprimer" />
        </>
      ) : (
        <>
          <LigneMenu theme={theme} icone="copier" texte={trAt('menu.coller')} raccourci="Ctrl+V" desactive={!a.pressePapier.length} onPress={faire(a.coller)} testID="esport-menu-coller" />
          <LigneMenu theme={theme} icone="selection" texte={trAt('menu.tout_selectionner')} raccourci="Ctrl+A" onPress={faire(a.toutSelectionner)} testID="esport-menu-tout" />
          <LigneMenu theme={theme} icone="cadrer" texte={trAt('rail.ajuster')} raccourci="0" onPress={faire(a.ajuster)} testID="esport-menu-ajuster" />
        </>
      )}
    </Bulle>
  );
}

/** Ce que fait l'outil armé, en une phrase. */
function conseil(a: EtatAtelier): string {
  if (!a.peutModifier) return tr('strats.editeur.lecture_seule_votre_role');
  if (a.temps !== undefined) return trAt('conseil.lecture');
  if (a.outil === 'capacite' && a.capacite) return trAt('conseil.capacite', { nom: a.capacite.nom });
  if (a.outil === 'agent') return trAt('conseil.agent', { nom: a.agent.nom });
  if (a.outil === 'texte' && !a.texte.trim()) return trAt('conseil.texte_vide');
  return trAt(`conseil.${a.outil}` as CleAt);
}

export function LigneEtat({ theme, a, format, onCalibrage }: { theme: ThemeHub; a: EtatAtelier; format: Format; onCalibrage(): void }) {
  const doc = a.doc;
  if (!doc) return null;
  const telephone = format === 'telephone';
  const texte = a.erreur ?? a.info ?? a.avis ?? conseil(a);
  const couleur = a.erreur ? theme.critique : a.info ? theme.texte : a.avis ? theme.ok : theme.attenue;
  const nonCalibree = Boolean(a.carteAsset && !a.carteAsset.echelle);
  const sansImage = !a.carteAsset?.minimap && !doc.carte.image;
  return (
    <View testID="esport-atelier-etat" style={{ height: DIM.etat, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, backgroundColor: theme.surface, borderTopWidth: 1, borderTopColor: theme.ligne }}>
      <Text style={{ ...texteAtelier(theme, 12), color: couleur, flex: 1 }} numberOfLines={1} testID={a.erreur ? 'esport-editeur-erreur' : a.avis && !a.info ? 'esport-editeur-avis' : 'esport-editeur-conseil'} accessibilityLiveRegion="polite">
        {texte}
      </Text>
      {telephone ? null : (
        <>
          {a.callout ? (
            <Text style={attenueAtelier(theme, 11)} numberOfLines={1} testID="esport-editeur-callout">
              {trSt('editeur.callout', { nom: a.callout })}
            </Text>
          ) : null}
          {nonCalibree || sansImage ? (
            <Pressable testID="esport-editeur-non-calibree" accessibilityRole="button" accessibilityLabel={trSt(sansImage ? 'editeur.sans_image' : 'editeur.non_calibree')} onPress={onCalibrage} style={{ height: 20, paddingHorizontal: 8, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: teinteTransparente(theme.alerte, 0.16), borderWidth: 1, borderColor: teinteTransparente(theme.alerte, 0.5) }}>
              <Glyphe valeur="alerte" style={{ color: theme.alerte, fontSize: 10 }} />
              <Text style={{ ...texteAtelier(theme, 11, true), color: theme.alerte }}>{trAt(sansImage ? 'etat.sans_image' : 'etat.non_calibree')}</Text>
            </Pressable>
          ) : null}
          <Text style={attenueAtelier(theme, 11)} testID="esport-editeur-resume">{`${trSt(`modele.${doc.modele}` as CleSt)} · ${tr('strats.editeur.version', { n: a.revision })}`}</Text>
        </>
      )}
    </View>
  );
}

/** Légende compacte : les capacités de l'étape, dans l'ordre, avec leur propriétaire. */
export function Legende({ theme, a }: { theme: ThemeHub; a: EtatAtelier }) {
  const doc = a.doc;
  const e = a.etapeCourante;
  if (!doc || !e) return null;
  const liste = ordreUtilitaires(e);
  if (!liste.length) return null;
  const visibles = liste.slice(0, 9);
  return (
    <View style={[verre(theme, 10), { width: 212, padding: 8, gap: 5 }]} testID="esport-atelier-legende" pointerEvents="none">
      <TitreSection theme={theme}>{trAt('legende.titre')}</TitreSection>
      {visibles.map(c => {
        const agent = a.assets?.agents.find(x => x.cle === c.agent);
        const cap = agent?.capacites.find(x => x.cle === c.capacite);
        const couleur = couleurAffichee(c.couleur, doc.couleurs, cap?.couleur ?? agent?.couleur);
        return (
          <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} testID={`esport-legende-${c.id}`}>
            <Text style={{ ...texteAtelier(theme, 10, true), width: 14, textAlign: 'right', color: theme.attenue }}>{c.ordre ?? '–'}</Text>
            <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: couleur, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b1220' }}>
              <IconeAsset theme={theme} url={sourcesIcone(cap, c.icone)} nom={c.nom} taille={16} couleur="#0b1220" />
            </View>
            <Text style={{ ...texteAtelier(theme, 11), flex: 1 }} numberOfLines={1}>
              {c.nom}
            </Text>
            <Text style={{ ...attenueAtelier(theme, 10), maxWidth: 64 }} numberOfLines={1}>
              {c.joueur !== null && doc.joueurs[c.joueur] ? doc.joueurs[c.joueur].nom : trSt('agents.ennemi')}
            </Text>
          </View>
        );
      })}
      {liste.length > visibles.length ? <Text style={attenueAtelier(theme, 10)}>{trAt('legende.autres', { n: liste.length - visibles.length })}</Text> : null}
    </View>
  );
}

const RACCOURCIS = ['outils', 'joueur', 'lecture', 'pan', 'zoom', 'ajuster', 'selection', 'menu', 'annuler', 'copier', 'supprimer', 'deplacer', 'tourner', 'etapes', 'aimant', 'enregistrer', 'echap'] as const;

export function Aide({ theme, a, fenetre }: { theme: ThemeHub; a: EtatAtelier; fenetre: { largeur: number; hauteur: number } }) {
  if (!a.aide) return null;
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 45, alignItems: 'center', justifyContent: 'center' }}>
      <Pressable testID="esport-editeur-raccourcis-fond" accessibilityRole="button" accessibilityLabel={trAt('tiroir.fermer')} onPress={() => a.setAide(false)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' }} />
      <View style={[verre(theme, 14), { width: Math.min(560, fenetre.largeur - 24), maxHeight: fenetre.hauteur - 48 }]} testID="esport-editeur-raccourcis">
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: theme.ligne }}>
          <Text style={{ ...texteAtelier(theme, 15, true), flex: 1 }}>{trAt('aide.titre')}</Text>
          <BoutonIcone theme={theme} icone="croix" libelle={trAt('tiroir.fermer')} onPress={() => a.setAide(false)} testID="esport-editeur-raccourcis-fermer" bulle="aucune" taille={32} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 12, gap: 6 }}>
          {RACCOURCIS.map(cle => (
            <View key={cle} style={{ flexDirection: 'row', gap: 12, alignItems: 'baseline' }}>
              <Text style={{ ...texteAtelier(theme, 13), flex: 3 }}>{trAt(`aide.${cle}` as CleAt)}</Text>
              <Text style={{ ...attenueAtelier(theme, 12), flex: 2, textAlign: 'right' }}>{trAt(`aide.${cle}.t` as CleAt)}</Text>
            </View>
          ))}
          <Text style={{ ...attenueAtelier(theme, 12), marginTop: 8 }}>{trSt('poignees.aide')}</Text>
          <Text style={attenueAtelier(theme, 12)}>{trAt('aide.presentation')}</Text>
          <MentionRiot theme={theme} jeu={a.assets?.jeu} />
        </ScrollView>
      </View>
    </View>
  );
}

/** Bandeaux qui demandent une décision : conflit d'enregistrement, nouvelle version enregistrée par un autre. */
export function Bandeaux({ theme, a }: { theme: ThemeHub; a: EtatAtelier }) {
  if (a.conflit === undefined && !a.distant) return null;
  return (
    <View style={{ position: 'absolute', top: DIM.marge, left: 0, right: 0, alignItems: 'center', zIndex: 30 }} pointerEvents="box-none">
      {a.conflit !== undefined ? (
        <View style={[verre(theme, 12), { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: 8, maxWidth: 720, borderColor: theme.critique }]} testID="esport-editeur-conflit">
          <Glyphe valeur="alerte" style={{ color: theme.critique, fontSize: 16 }} />
          <Text style={{ ...texteAtelier(theme, 13), flex: 1, minWidth: 180 }}>{trAt('conflit.texte')}</Text>
          <BoutonHub theme={theme} titre={tr('strats.editeur.recharger_la_version_du')} onPress={a.recharger} testID="esport-editeur-recharger" />
          <BoutonHub theme={theme} titre={tr('strats.editeur.garder_la_mienne_ecraser')} variante="danger" onPress={() => (a.setErreur(undefined), void a.enregistrer({ forcer: a.conflit || undefined }))} testID="esport-editeur-ecraser" />
        </View>
      ) : a.distant ? (
        <View style={[verre(theme, 12), { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: 8, maxWidth: 720, borderColor: theme.alerte }]} testID="esport-editeur-distant">
          <Text style={{ ...texteAtelier(theme, 13), flex: 1, minWidth: 180 }}>{trSt('temps_reel.nouvelle_version', { qui: a.distant.pseudo ?? '?', n: a.distant.revision })}</Text>
          <BoutonHub theme={theme} titre={tr('strats.editeur.recharger_la_version_du')} onPress={a.recharger} testID="esport-editeur-distant-recharger" />
        </View>
      ) : null}
    </View>
  );
}
