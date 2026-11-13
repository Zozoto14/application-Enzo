/**
 * Tiroir de l'atelier de strats (à droite ; feuille en bas sur tablette et téléphone), en onglets :
 *  - Sélection : inspecteur de l'objet choisi (dimensions en mètres, ordre, minutage, étage…) ; plusieurs
 *    objets : aligner, répartir, joueur, étage, verrou, dupliquer, supprimer ;
 *  - Étape : titre, phase, durée, note (éditeur riche), dupliquer / déplacer / vider / supprimer ;
 *  - Joueurs : nom, rôle, agent ou classe de chacun ; couleur des capacités (joueur ou agent) ;
 *  - Utilitaires : ordre de lancer ;
 *  - Calques : visibilité et verrou, puis l'affichage (thème de la map, atténuation, noms, légende, fantôme).
 * Fermé tant que rien n'est choisi (sauf épinglé) ; s'ouvre à la sélection ; se pose SUR le canevas, sans jamais
 * pousser la map.
 */

import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { BoutonHub, Case, Champ } from '../../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../../hub/themes';
import { Glyphe } from '../../../../ui/icones';
import { tr } from '../../../i18n';
import { trAt, type CleAt } from '../../../i18n/atelier';
import { trSt, type CleSt } from '../../../i18n/strats2';
import { CALQUES, ETAPES_MAX, type Calque } from '../../../strats/document';
import type { Alignement } from '../../../strats/geometrie';
import { THEMES_CARTE, themeCarte, type Attenuation } from '../../../strats/plateau';
import { ChampNote } from '../../ChampNote';
import { Choix } from '../../commun';
import { Inspecteur, ListeUtilitaires, PanneauJoueurs, couleurPhase, libellePhase } from '../Panneaux';
import { Bascule, BoutonIcone, DIM, PuceTexte, TitreSection, attenueAtelier, texteAtelier, verre, type Format } from './briques';
import type { EtatAtelier, OngletTiroir, Preferences } from './useAtelier';

/** Le tiroir est-il ouvert ? Épinglé par l'utilisateur, ou ouvert par une sélection (ou par « Note »). */
export const tiroirOuvert = (prefs: Preferences, tiroirAuto: boolean): boolean => prefs.tiroir === 'ouvert' || tiroirAuto;

const ONGLETS: ReadonlyArray<readonly [OngletTiroir, string, CleAt]> = [
  ['selection', 'selection', 'tiroir.selection'],
  ['etape', 'note', 'tiroir.etape'],
  ['joueurs', 'membres', 'tiroir.joueurs'],
  ['utilitaires', 'liste-ordonnee', 'tiroir.utilitaires'],
  ['calques', 'calques', 'tiroir.calques'],
];
const ALIGNEMENTS: ReadonlyArray<Alignement> = ['gauche', 'centre', 'droite', 'haut', 'milieu', 'bas'];

function Selection({ theme, a }: { theme: ThemeHub; a: EtatAtelier }) {
  const doc = a.doc;
  if (!doc) return null;
  const n = a.choisis.length;
  if (n === 0) {
    return (
      <View style={{ gap: 8, alignItems: 'center', paddingVertical: 24 }} testID="esport-tiroir-vide">
        <Glyphe valeur="selection" style={{ color: theme.attenue, fontSize: 22 }} />
        <Text style={{ ...attenueAtelier(theme, 12), textAlign: 'center' }}>{trAt('tiroir.selection_vide')}</Text>
      </View>
    );
  }
  const verrouilles = a.choisis.every(o => o.verrou);
  const communs = (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      <BoutonIcone theme={theme} icone={verrouilles ? 'cadenas-ouvert' : 'cadenas'} libelle={trAt(verrouilles ? 'menu.deverrouiller' : 'menu.verrouiller')} texte={trAt(verrouilles ? 'menu.deverrouiller' : 'menu.verrouiller')} bulle="aucune" onPress={() => a.verrouillerSelection(!verrouilles)} testID="esport-tiroir-verrou" taille={32} />
      <BoutonIcone theme={theme} icone="premier-plan" libelle={trAt('menu.premier_plan')} onPress={() => a.ordonnerSelection('avant')} testID="esport-tiroir-avant" taille={32} bulle="haut" />
      <BoutonIcone theme={theme} icone="arriere-plan" libelle={trAt('menu.arriere_plan')} onPress={() => a.ordonnerSelection('arriere')} testID="esport-tiroir-arriere" taille={32} bulle="haut" />
      <BoutonIcone theme={theme} icone="copier" libelle={trAt('menu.copier_suivante')} onPress={a.copierVersSuivante} testID="esport-tiroir-copier-suivante" taille={32} bulle="haut" />
    </View>
  );
  if (n === 1) {
    const o = a.choisis[0];
    return (
      <View style={{ gap: 12 }}>
        <Inspecteur theme={theme} cadre={false} doc={doc} etape={a.iEtape} objet={o} faire={a.faire} niveaux={a.niveaux} genres={a.def.marqueurs} onFermer={() => a.setSelection([])} onSupprimer={a.supprimerSelection} onDupliquer={a.dupliquerSelection} />
        {communs}
      </View>
    );
  }
  const avecJoueur = a.choisis.some(o => 'joueur' in o);
  return (
    <View style={{ gap: 12 }} testID="esport-tiroir-multi">
      <Text style={texteAtelier(theme, 14, true)} testID="esport-tiroir-multi-compte">
        {trAt('tiroir.n_objets', { n })}
      </Text>
      <TitreSection theme={theme}>{trAt('tiroir.aligner')}</TitreSection>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {ALIGNEMENTS.map(m => (
          <PuceTexte key={m} theme={theme} texte={trAt(`aligner.${m}` as CleAt)} actif={false} onPress={() => a.alignerSelection(m)} testID={`esport-aligner-${m}`} hauteur={28} />
        ))}
      </View>
      {n >= 3 ? (
        <>
          <TitreSection theme={theme}>{trAt('tiroir.repartir')}</TitreSection>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            <PuceTexte theme={theme} texte={trAt('repartir.horizontal')} actif={false} onPress={() => a.repartirSelection('horizontal')} testID="esport-repartir-horizontal" hauteur={28} />
            <PuceTexte theme={theme} texte={trAt('repartir.vertical')} actif={false} onPress={() => a.repartirSelection('vertical')} testID="esport-repartir-vertical" hauteur={28} />
          </View>
        </>
      ) : null}
      {avecJoueur ? (
        <>
          <TitreSection theme={theme}>{trAt('menu.joueur')}</TitreSection>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
            {doc.joueurs.map((j, i) => (
              <PuceTexte key={i} theme={theme} texte={j.nom} couleur={j.couleur} actif={false} onPress={() => a.affecterJoueur(i)} testID={`esport-tiroir-joueur-${i}`} hauteur={28} />
            ))}
          </View>
        </>
      ) : null}
      {a.niveaux.length ? (
        <>
          <TitreSection theme={theme}>{trSt('inspecteur.etage')}</TitreSection>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
            <PuceTexte theme={theme} texte={trSt('niveau.tous')} actif={false} onPress={() => a.affecterNiveau(null)} testID="esport-tiroir-niveau-tous" hauteur={28} />
            {a.niveaux.map(x => (
              <PuceTexte key={x.valeur} theme={theme} texte={x.nom} actif={false} onPress={() => a.affecterNiveau(x.valeur)} testID={`esport-tiroir-niveau-${x.valeur}`} hauteur={28} />
            ))}
          </View>
        </>
      ) : null}
      {communs}
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <BoutonHub theme={theme} titre={trSt('inspecteur.dupliquer')} onPress={a.dupliquerSelection} testID="esport-tiroir-dupliquer" />
        <BoutonHub theme={theme} titre={trSt('inspecteur.supprimer')} variante="danger" onPress={a.supprimerSelection} testID="esport-tiroir-supprimer" />
      </View>
    </View>
  );
}

const nombre = (v: string): number | null => {
  const n = Number(v.replace(',', '.'));
  return v.trim() === '' || !Number.isFinite(n) ? null : n;
};

function EtapeCourante({ theme, a }: { theme: ThemeHub; a: EtatAtelier }) {
  const doc = a.doc;
  const e = a.etapeCourante;
  const [duree, setDuree] = React.useState(String(e?.duree ?? 5));
  React.useEffect(() => setDuree(String(e?.duree ?? 5)), [e?.duree, e?.id]);
  if (!doc || !e) return null;
  if (!a.peutModifier) {
    return (
      <View style={{ gap: 8 }} testID="esport-tiroir-etape">
        <Text style={texteAtelier(theme, 15, true)}>{`${a.iEtape + 1}. ${e.titre}`}</Text>
        <Text style={attenueAtelier(theme, 12)}>{[e.phase ? libellePhase(e.phase) : '', trSt('etape.secondes', { s: e.duree ?? 5 })].filter(Boolean).join(' · ')}</Text>
        <Text style={texteAtelier(theme, 13)} testID="esport-etape-note-lecture">
          {e.note || tr('strats.editeur.pas_de_note')}
        </Text>
      </View>
    );
  }
  const n = doc.etapes.length;
  return (
    <View style={{ gap: 12 }} testID="esport-tiroir-etape">
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
        <Champ theme={theme} libelle={trSt('etape.titre')} valeur={e.titre} onChanger={titre => a.faire({ type: 'titreEtape', etape: a.iEtape, titre })} maxLength={60} style={{ flex: 1, minWidth: 120 }} testID="esport-tiroir-etape-titre" />
        <Champ
          theme={theme}
          libelle={trSt('etape.duree')}
          valeur={duree}
          onChanger={v => {
            setDuree(v);
            const x = nombre(v);
            if (x !== null) a.faire({ type: 'dureeEtape', etape: a.iEtape, duree: x });
          }}
          clavier="number-pad"
          maxLength={5}
          style={{ width: 86 }}
          testID="esport-etape-duree"
        />
      </View>
      <Choix
        theme={theme}
        libelle={trSt('etape.phase')}
        valeur={e.phase ?? ''}
        options={[{ id: '', nom: trSt('etape.sans_phase') }, ...a.def.phases.map(ph => ({ id: ph, nom: libellePhase(ph), couleur: couleurPhase(ph) }))]}
        onChoisir={v => a.faire({ type: 'phaseEtape', etape: a.iEtape, phase: v || null })}
        repliable={false}
        testID="esport-etape-phase"
      />
      <ChampNote theme={theme} libelle={trSt('etape.note')} valeur={e.note} onChanger={note => a.faire({ type: 'noteEtape', etape: a.iEtape, note })} maxLength={2000} testID="esport-etape-note" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <BoutonHub theme={theme} titre={trSt('etape.dupliquer')} desactive={n >= ETAPES_MAX} onPress={a.dupliquerEtape} testID="esport-etape-dupliquer" />
        <BoutonHub theme={theme} titre="←" libelle={trSt('etape.avancer')} desactive={a.iEtape === 0} onPress={() => a.deplacerEtape(a.iEtape, a.iEtape - 1)} testID="esport-etape-gauche" />
        <BoutonHub theme={theme} titre="→" libelle={trSt('etape.reculer')} desactive={a.iEtape >= n - 1} onPress={() => a.deplacerEtape(a.iEtape, a.iEtape + 1)} testID="esport-etape-droite" />
        <BoutonHub theme={theme} titre={trSt('etape.supprimer')} variante="danger" desactive={n <= 1} onPress={a.supprimerEtape} testID="esport-etape-supprimer" />
      </View>
    </View>
  );
}

function Calques({ theme, a }: { theme: ThemeHub; a: EtatAtelier }) {
  const doc = a.doc;
  if (!doc) return null;
  return (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 2 }} testID="esport-editeur-calques">
        {CALQUES.map((c: Calque) => (
          <View key={c} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 36, gap: 2 }}>
            <Text style={{ ...texteAtelier(theme, 13), flex: 1, opacity: doc.calques[c].visible ? 1 : 0.5 }}>{trSt(`calque.${c}` as CleSt)}</Text>
            <BoutonIcone theme={theme} icone={doc.calques[c].visible ? 'oeil' : 'oeil-barre'} libelle={`${doc.calques[c].visible ? tr('strats.editeur.masquer') : tr('strats.editeur.afficher')} ${trSt(`calque.${c}` as CleSt)}`} bulle="aucune" taille={32} onPress={() => a.faire({ type: 'calque', calque: c, champs: { visible: !doc.calques[c].visible } })} testID={`esport-calque-${c}-visible`} />
            {c !== 'fond' && c !== 'callouts' ? (
              <BoutonIcone theme={theme} icone={doc.calques[c].verrou ? 'cadenas' : 'cadenas-ouvert'} actif={doc.calques[c].verrou} libelle={`${doc.calques[c].verrou ? tr('strats.editeur.deverrouiller') : tr('strats.editeur.verrouiller')} ${trSt(`calque.${c}` as CleSt)}`} bulle="aucune" taille={32} onPress={() => a.faire({ type: 'calque', calque: c, champs: { verrou: !doc.calques[c].verrou } })} testID={`esport-calque-${c}-verrou`} />
            ) : (
              <View style={{ width: 32 }} />
            )}
          </View>
        ))}
      </View>
      <Affichage theme={theme} a={a} />
    </View>
  );
}

/** Réglages d'affichage (par utilisateur) : thème de la map, atténuation, noms, légende, fantôme, reprise. */
export function Affichage({ theme, a }: { theme: ThemeHub; a: EtatAtelier }) {
  return (
    <View style={{ gap: 10 }} testID="esport-atelier-affichage">
      <TitreSection theme={theme}>{trAt('affichage.theme')}</TitreSection>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }} accessibilityRole="radiogroup" accessibilityLabel={trAt('affichage.theme')}>
        {THEMES_CARTE.map(id => {
          const t = themeCarte(id);
          const actif = a.prefs.themeCarte === id;
          return (
            <Pressable key={id} testID={`esport-theme-carte-${id}`} accessibilityRole="radio" accessibilityState={{ checked: actif }} accessibilityLabel={trAt(`theme.${id}` as CleAt)} onPress={() => a.setPrefs({ themeCarte: id })} style={{ width: 72, gap: 4, alignItems: 'center' }}>
              <View style={{ width: 72, height: 44, borderRadius: 8, backgroundColor: t.fond, borderWidth: 2, borderColor: actif ? theme.accent : theme.ligne, alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: 40, height: 22, borderRadius: 5, backgroundColor: id === 'origine' ? '#9aa4b2' : t.sol, borderWidth: 1.5, borderColor: id === 'origine' ? '#cbd5e1' : t.contour }} />
              </View>
              <Text style={{ ...texteAtelier(theme, 10, actif), textAlign: 'center' }} numberOfLines={2}>
                {trAt(`theme.${id}` as CleAt)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <TitreSection theme={theme}>{trAt('affichage.attenuer')}</TitreSection>
      <Bascule theme={theme} libelle={trAt('affichage.attenuer')} valeur={String(a.prefs.attenuation)} options={[['0', trAt('attenuer.0')], ['1', trAt('attenuer.1')], ['2', trAt('attenuer.2')]] as const} onChoisir={v => a.setPrefs({ attenuation: Number(v) as Attenuation })} testID="esport-attenuer" hauteur={28} />
      <Case theme={theme} coche={a.prefs.noms} libelle={trAt('affichage.noms')} onChanger={noms => a.setPrefs({ noms })} testID="esport-affichage-noms" />
      <Case theme={theme} coche={a.prefs.legende} libelle={trAt('affichage.legende')} onChanger={legende => a.setPrefs({ legende })} testID="esport-affichage-legende" />
      {a.peutModifier ? <Case theme={theme} coche={a.prefs.fantome} libelle={trAt('affichage.fantome')} onChanger={fantome => a.setPrefs({ fantome })} testID="esport-affichage-fantome" /> : null}
      {a.peutModifier ? <Case theme={theme} coche={a.prefs.reprise} libelle={trAt('affichage.reprise')} onChanger={reprise => a.setPrefs({ reprise })} testID="esport-affichage-reprise" /> : null}
    </View>
  );
}

export function Tiroir({ theme, a, format, hauteur, extras }: { theme: ThemeHub; a: EtatAtelier; format: Format; hauteur: number; /** Sections ajoutées sous l'onglet Étape (lineups liés…). */ extras?: React.ReactNode }) {
  const doc = a.doc;
  if (!doc) return null;
  const feuille = format !== 'bureau';
  const fermer = () => {
    a.setTiroirAuto(false);
    a.setPrefs({ tiroir: 'auto' });
  };
  const onglets = a.peutModifier ? ONGLETS : ONGLETS.filter(o => o[0] !== 'selection');
  const courant = onglets.some(o => o[0] === a.onglet) ? a.onglet : 'etape';
  return (
    <View
      testID="esport-atelier-tiroir"
      style={[
        verre(theme, feuille ? 16 : 0),
        feuille
          ? { position: 'absolute', left: 0, right: 0, bottom: 0, height: Math.min(Math.round(hauteur * 0.5), 440), borderBottomLeftRadius: 0, borderBottomRightRadius: 0, zIndex: 20 }
          : { position: 'absolute', top: 0, right: 0, bottom: 0, width: DIM.tiroir, borderTopWidth: 0, borderRightWidth: 0, borderBottomWidth: 0, zIndex: 20 },
      ]}>
      {feuille ? <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: theme.ligne, marginTop: 6 }} /> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingTop: 6, gap: 2, borderBottomWidth: 1, borderBottomColor: theme.ligne }} accessibilityRole="tablist">
        {onglets.map(([id, icone, cle]) => {
          const actif = courant === id;
          return (
            <Pressable key={id} testID={`esport-tiroir-onglet-${id}`} accessibilityRole="tab" accessibilityState={{ selected: actif }} accessibilityLabel={trAt(cle)} onPress={() => a.setOnglet(id)} style={(etat: { pressed: boolean; hovered?: boolean }) => ({ flex: 1, height: 42, alignItems: 'center', justifyContent: 'center', gap: 2, borderBottomWidth: 2, borderBottomColor: actif ? theme.accent : 'transparent', backgroundColor: etat.hovered && !actif ? teinteTransparente(theme.attenue, 0.1) : 'transparent', borderTopLeftRadius: 8, borderTopRightRadius: 8 })}>
              <Glyphe valeur={icone} style={{ color: actif ? theme.accent : theme.attenue, fontSize: 14 }} />
              <Text style={{ ...texteAtelier(theme, 10, actif), color: actif ? theme.texte : theme.attenue }} numberOfLines={1}>
                {trAt(cle)}
              </Text>
              {id === 'selection' && a.choisis.length ? (
                <View style={{ position: 'absolute', top: 3, right: 6, minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: 8, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: theme.surAccent, fontSize: 10, fontWeight: '800' }}>{a.choisis.length}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
        <BoutonIcone theme={theme} icone="croix" libelle={trAt('tiroir.fermer')} onPress={fermer} testID="esport-tiroir-fermer" taille={34} bulle="aucune" />
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 12 }} keyboardShouldPersistTaps="handled">
        {courant === 'selection' ? <Selection theme={theme} a={a} /> : null}
        {courant === 'etape' ? (
          <>
            <EtapeCourante theme={theme} a={a} />
            {extras}
          </>
        ) : null}
        {courant === 'joueurs' ? (
          <View style={{ gap: 12 }}>
            {a.peutModifier && doc.modele !== 'generique' ? (
              <View style={{ gap: 6 }}>
                <TitreSection theme={theme}>{trAt('affichage.couleurs')}</TitreSection>
                <Bascule theme={theme} libelle={trAt('affichage.couleurs')} valeur={doc.couleurs ?? 'joueur'} options={[['joueur', trAt('couleurs.joueur')], ['agent', trAt('couleurs.agent', { quoi: a.libelleAgent.toLowerCase() })]] as const} onChoisir={couleurs => a.faire({ type: 'couleurs', couleurs })} testID="esport-couleurs" hauteur={28} />
              </View>
            ) : null}
            <PanneauJoueurs theme={theme} cadre={false} doc={doc} agents={a.agents.filter(x => x.cle !== 'pion')} joueur={a.couleurLibre ? null : a.joueur} onJoueur={a.choisirJoueur} faire={a.faire} modifiable={a.peutModifier} libelleAgent={a.libelleAgent} />
          </View>
        ) : null}
        {courant === 'utilitaires' ? <ListeUtilitaires theme={theme} cadre={false} doc={doc} etape={a.iEtape} faire={a.faire} modifiable={a.peutModifier} onChoisir={id => (a.setOutil('selection'), a.setSelection([id]))} /> : null}
        {courant === 'calques' ? <Calques theme={theme} a={a} /> : null}
      </ScrollView>
    </View>
  );
}
