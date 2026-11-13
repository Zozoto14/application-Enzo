/**
 * Atelier de strats : la MISE EN PAGE plein écran, la map d'abord.
 *
 *   barre du haut (48 px)
 *   ┌ rail d'outils ┐  frise des étapes (flottante)            ┌ tiroir (posé SUR le canevas) ┐
 *   │               │           CANEVAS : toute la place       │ Sélection · Étape · Joueurs… │
 *   └───────────────┘                                          └──────────────────────────────┘
 *   dock (joueurs · capacités · agents)                                    ligne d'état
 *
 * Le canevas reçoit sa taille et les MARGES occupées par l'interface : la map s'y cadre entière et centrée.
 * Tablette : tiroir en feuille basse ; téléphone : lecture d'abord (lecture animée, étapes, notes, « mon
 * rôle »), l'édition s'ouvre par « Modifier » (outils en bande, options et tiroir en feuilles).
 *
 * Composant React Native sans canevas : celui-ci est fourni par l'écran (`canevas`, Konva sur le web ; un faux
 * dans les tests).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { BoutonHub, Champ } from '../../../../hub/admin/ui/commun';
import { police, type ThemeHub } from '../../../../hub/themes';
import { Glyphe } from '../../../../ui/icones';
import { cartesDuPool } from '../../../jeux/profil';
import { tr } from '../../../i18n';
import { trAt, type CleAt } from '../../../i18n/atelier';
import { trSt, type CleSt } from '../../../i18n/strats2';
import { trSs } from '../../../i18n/stratsSuppr';
import { ETAPES_MAX } from '../../../strats/document';
import type { Marges } from '../../../strats/geometrie';
import type { PropsCanevas } from '../canevas/types';
import { MentionRiot } from '../commun';
import { ConfirmationSuppression } from '../Suppression';
import { BarreHaut } from './BarreHaut';
import { Bulle, BoutonIcone, DIM, LigneMenu, PuceTexte, Separateur, TitreSection, attenueAtelier, formatPour, texteAtelier, verre } from './briques';
import { Dock, GrilleAgents } from './Dock';
import { FriseEtapes } from './FriseEtapes';
import { Presentation } from './Presentation';
import { OptionsOutil, OUTILS_A_OPTIONS, PanneauOptions, RailOutils } from './RailOutils';
import { Aide, Bandeaux, Legende, LigneEtat, MenuContextuel } from './Surcouches';
import { Affichage, Tiroir, tiroirOuvert } from './Tiroir';
import type { EtatAtelier } from './useAtelier';

export interface PropsAtelier {
  theme: ThemeHub;
  a: EtatAtelier;
  /** Rendu du canevas (Konva sur le web). */
  canevas(props: PropsCanevas): React.ReactNode;
  /** Comparaison côte à côte, dans la place du canevas. */
  comparaison?(zone: { largeur: number; hauteur: number }): React.ReactNode;
  /** Page imprimable (export PDF) à partir des images des étapes. */
  impression?(images: string[]): string;
  pleinEcran?: boolean;
  onPleinEcran?(actif: boolean): void;
  /** Ouvrir Administration › Jeux (calibrer la map) ; absent : l'endroit est seulement indiqué. */
  onAdminJeux?(): void;
  /** Sections ajoutées dans le tiroir (onglet Étape). */
  extrasTiroir?: React.ReactNode;
  copier?(texte: string): void;
}

export function Atelier({ theme, a, canevas, comparaison, impression, pleinEcran, onPleinEcran, onAdminJeux, extrasTiroir, copier }: PropsAtelier) {
  const fenetre0 = useWindowDimensions();
  const fenetre = useMemo(() => ({ largeur: fenetre0.width, hauteur: fenetre0.height }), [fenetre0.width, fenetre0.height]);
  const format = formatPour(fenetre.largeur);
  const telephone = format === 'telephone';
  const bureau = format === 'bureau';
  const [zone, setZone] = useState({ largeur: 0, hauteur: 0 });
  const [optionsRepliees, setOptionsRepliees] = useState(false);
  const surZone = (ev: LayoutChangeEvent) => {
    const { width, height } = ev.nativeEvent.layout;
    setZone(z => (Math.abs(z.largeur - width) < 1 && Math.abs(z.hauteur - height) < 1 ? z : { largeur: Math.round(width), hauteur: Math.round(height) }));
  };
  const { doc, strat } = a;
  const edition = a.peutModifier && (!telephone || a.modeEdition);
  const dockHaut = a.prefs.dockReplie ? 30 : DIM.dock;
  const basFixe = dockHaut + (telephone ? 0 : DIM.etat) + (telephone && edition ? 56 : 0);
  // Taille du canevas : mesurée ; avant la première mesure, celle de la fenêtre moins les barres.
  const largeur = zone.largeur || fenetre.largeur;
  const hauteur = zone.hauteur || Math.max(120, fenetre.hauteur - DIM.barre - basFixe);
  a.taille.current = { largeur, hauteur };
  const ouvert = tiroirOuvert(a.prefs, a.tiroirAuto) && !a.comparer;
  const railVisible = !telephone && (a.peutModifier || true);
  const marges: Marges = useMemo(
    () => ({
      haut: DIM.frise + DIM.marge + 4,
      bas: 4,
      gauche: railVisible ? DIM.rail + DIM.marge : 0,
      // Tiroir épinglé (bureau) : la map se centre dans la place restante ; ouvert par une sélection, il ne la bouge pas.
      droite: bureau && a.prefs.tiroir === 'ouvert' ? DIM.tiroir : 0,
    }),
    [bureau, a.prefs.tiroir, railVisible],
  );

  // Présentation : vrai plein écran quand le navigateur le permet.
  useEffect(() => {
    if (a.presentation) onPleinEcran?.(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.presentation]);

  if (!doc || !strat || !a.propsCanevas) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.fond }} testID="esport-editeur-chargement">
        <View style={{ height: DIM.barre, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, backgroundColor: theme.surface, borderBottomWidth: 1, borderBottomColor: theme.ligne }}>
          <BoutonIcone theme={theme} icone="fleche-gauche" libelle={trAt('haut.retour')} texte={trAt('haut.strats')} bulle="aucune" onPress={a.quitterSansEnregistrer} testID="esport-editeur-retour" />
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>
          {a.erreur ? (
            <>
              <Text style={{ ...texteAtelier(theme, 14), color: theme.critique, textAlign: 'center' }} testID="esport-editeur-erreur">
                {a.erreur}
              </Text>
              <BoutonHub theme={theme} titre={trAt('chargement.reessayer')} onPress={a.recharger} testID="esport-editeur-reessayer" />
            </>
          ) : (
            <Text style={attenueAtelier(theme, 14)}>{tr('strats.editeur.chargement_de_la_strat')}</Text>
          )}
        </View>
      </View>
    );
  }

  const fermerBulle = () => a.setPopover(undefined);
  const puis = (action: () => void) => () => {
    fermerBulle();
    action();
  };
  const p = a.popover;
  const feuille = telephone;
  const n = doc.etapes.length;

  // ---------------------------------------------------------------- Contenu des bulles
  const listeCartes = cartesDuPool(a.assets, doc.carte.cle).map(c => (
    <LigneMenu
      key={c.cle}
      theme={theme}
      texte={c.nom}
      coche={c.cle === doc.carte.cle}
      onPress={puis(() => a.faire({ type: 'carte', carte: { cle: c.cle, nom: c.nom, image: c.minimap && /^https:\/\/media\.valorant-api\.com\//.test(c.minimap) ? c.minimap : null, echelle: c.echelle ?? null } }))}
      testID={`esport-editeur-carte-${c.cle}`}
    />
  ));
  const listeModes = a.def.modes.map(m => <LigneMenu key={m} theme={theme} texte={trSt(`mode.${m}` as CleSt)} coche={(doc.mode ?? a.def.modes[0]) === m} onPress={puis(() => a.faire({ type: 'mode', mode: m }))} testID={`esport-editeur-mode-${m}`} />);
  const listeEconomie = [
    <LigneMenu key="aucune" theme={theme} texte={trSt('economie.aucune')} coche={!doc.economie} onPress={puis(() => a.faire({ type: 'economie', economie: null }))} testID="esport-editeur-economie-aucune" />,
    ...a.def.economie.map(x => <LigneMenu key={x} theme={theme} texte={trSt(`economie.${x}` as CleSt)} coche={doc.economie === x} onPress={puis(() => a.faire({ type: 'economie', economie: x }))} testID={`esport-editeur-economie-${x}`} />),
  ];
  const listeExport = (
    <>
      <LigneMenu theme={theme} icone="image" texte={tr('strats.editeur.exporter_en_png')} onPress={puis(() => void a.exporterPng())} testID="esport-editeur-png" />
      <LigneMenu theme={theme} icone="image" texte={trSt('export.png_tout')} onPress={puis(() => void a.exporterToutesPng())} testID="esport-editeur-png-tout" />
      {impression ? <LigneMenu theme={theme} icone="document" texte={trSt('export.pdf')} onPress={puis(() => void a.exporterPdf(impression))} testID="esport-editeur-pdf" /> : null}
    </>
  );
  const sectionTitre = (cle: CleAt | string) => (
    <View style={{ paddingHorizontal: 10, paddingTop: 8, paddingBottom: 2 }}>
      <TitreSection theme={theme}>{cle.includes('.') ? trAt(cle as CleAt) : cle}</TitreSection>
    </View>
  );

  let bulle: React.ReactNode = null;
  if (p?.cle === 'carte') bulle = <Bulle theme={theme} ancre={p.ancre} fenetre={fenetre} feuille={feuille} titre={trSt('gauche.carte')} onFermer={fermerBulle} testID="esport-bulle-carte">{listeCartes}</Bulle>;
  else if (p?.cle === 'mode') bulle = <Bulle theme={theme} ancre={p.ancre} fenetre={fenetre} feuille={feuille} titre={trSt('mode.titre')} onFermer={fermerBulle} testID="esport-bulle-mode">{listeModes}</Bulle>;
  else if (p?.cle === 'economie') bulle = <Bulle theme={theme} ancre={p.ancre} fenetre={fenetre} feuille={feuille} titre={trSt('economie.titre')} largeur={220} onFermer={fermerBulle} testID="esport-bulle-economie">{listeEconomie}</Bulle>;
  else if (p?.cle === 'export') bulle = <Bulle theme={theme} ancre={p.ancre} fenetre={fenetre} feuille={feuille} titre={trAt('haut.exporter')} onFermer={fermerBulle} testID="esport-bulle-export">{listeExport}</Bulle>;
  else if (p?.cle === 'reglages') {
    // Tablette et téléphone : map, attaque / défense, mode, économie et étage dans une même bulle.
    bulle = (
      <Bulle theme={theme} ancre={p.ancre} fenetre={fenetre} feuille={feuille} largeur={300} onFermer={fermerBulle} testID="esport-bulle-reglages">
        {a.peutModifier ? (
          <>
            {a.def.sides ? (
              <View style={{ flexDirection: 'row', gap: 6, padding: 8 }}>
                {(['attaque', 'defense'] as const).map(s => (
                  <PuceTexte key={s} theme={theme} texte={s === 'attaque' ? tr('strats.editeur.attaque') : tr('strats.editeur.defense')} actif={doc.side === s} couleur={s === 'attaque' ? '#ef4444' : '#3b82f6'} onPress={() => a.faire({ type: 'side', side: s })} testID={`esport-editeur-side-${s}`} hauteur={34} />
                ))}
              </View>
            ) : null}
            {a.def.modes.length ? sectionTitre(trSt('mode.titre')) : null}
            {listeModes}
            {a.def.economie.length ? sectionTitre(trSt('economie.titre')) : null}
            {a.def.economie.length ? listeEconomie : null}
          </>
        ) : null}
        {a.niveaux.length ? (
          <>
            {sectionTitre(trSt('niveau.etage'))}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, paddingHorizontal: 8, paddingBottom: 6 }}>
              <PuceTexte theme={theme} texte={trSt('niveau.tous')} actif={a.niveau === null} onPress={() => a.setNiveau(null)} testID="esport-editeur-niveau-tous" />
              {a.niveaux.map(x => (
                <PuceTexte key={x.valeur} theme={theme} texte={x.nom} actif={a.niveau === x.valeur} onPress={() => a.setNiveau(x.valeur)} testID={`esport-editeur-niveau-${x.valeur}`} />
              ))}
            </View>
          </>
        ) : null}
        {a.peutModifier ? sectionTitre(trSt('gauche.carte')) : null}
        {a.peutModifier ? listeCartes : null}
      </Bulle>
    );
  } else if (p?.cle === 'plus') {
    bulle = (
      <Bulle theme={theme} ancre={p.ancre} fenetre={fenetre} feuille={feuille} largeur={270} onFermer={fermerBulle} testID="esport-bulle-plus">
        {telephone ? <LigneMenu theme={theme} icone="carte" texte={`${trSt('gauche.carte')} : ${doc.carte.nom}`} onPress={() => a.setPopover({ cle: 'reglages' })} testID="esport-plus-reglages" /> : null}
        {telephone && a.peutModifier ? (
          <>
            <LigneMenu theme={theme} icone="annuler" texte={trAt('haut.annuler')} desactive={!a.historique?.passe.length} onPress={a.defaire} testID="esport-plus-annuler" />
            <LigneMenu theme={theme} icone="retablir" texte={trAt('haut.retablir')} desactive={!a.historique?.futur.length} onPress={a.refaire} testID="esport-plus-retablir" />
          </>
        ) : null}
        {!bureau ? (
          <>
            {comparaison && !telephone ? <LigneMenu theme={theme} icone="colonnes" texte={trSt('comparer.ouvrir')} coche={a.comparer} onPress={puis(() => a.setComparer(!a.comparer))} testID="esport-plus-comparer" /> : null}
            {listeExport}
            <Separateur theme={theme} vertical={false} />
          </>
        ) : null}
        <LigneMenu theme={theme} icone="palette" texte={trAt('plus.affichage')} onPress={() => a.setPopover({ cle: 'affichage', ancre: p.ancre })} testID="esport-plus-affichage" />
        <LigneMenu theme={theme} icone="liste" texte={trAt('affichage.legende')} coche={a.prefs.legende} onPress={() => a.setPrefs({ legende: !a.prefs.legende })} testID="esport-plus-legende" />
        {a.peutModifier ? <LigneMenu theme={theme} icone="fantome" texte={trAt('affichage.fantome')} coche={a.prefs.fantome} onPress={() => a.setPrefs({ fantome: !a.prefs.fantome })} testID="esport-plus-fantome" /> : null}
        <LigneMenu theme={theme} icone="question" texte={trAt('rail.aide')} raccourci="?" onPress={puis(() => a.setAide(true))} testID="esport-plus-aide" />
        <Separateur theme={theme} vertical={false} />
        {a.peutModifier ? <LigneMenu theme={theme} icone="copier" texte={tr('strats.editeur.dupliquer_la_strat')} onPress={puis(() => void a.dupliquerStrat())} testID="esport-editeur-dupliquer" /> : null}
        {strat.moi.partager ? <LigneMenu theme={theme} icone="partager" texte={trAt('plus.partager')} onPress={puis(() => void a.creerPartage())} testID="esport-editeur-partager" /> : null}
        {a.peutModifier && strat.visibilite === 'team' ? <LigneMenu theme={theme} icone="carnet" texte={tr('strats.playbook.ajouter_au_playbook')} onPress={puis(() => void a.ajouterAuPlaybook())} testID="esport-editeur-playbook" /> : null}
        {strat.moi.supprimer ? <LigneMenu theme={theme} icone="corbeille" texte={trSs('supprimer')} danger onPress={puis(() => a.setConfirmation('supprimer'))} testID="esport-editeur-supprimer" /> : null}
        <View style={{ padding: 8 }}>
          <MentionRiot theme={theme} jeu={a.assets?.jeu} />
        </View>
      </Bulle>
    );
  } else if (p?.cle === 'etape') {
    bulle = (
      <Bulle theme={theme} ancre={p.ancre} fenetre={fenetre} feuille={feuille} largeur={260} onFermer={fermerBulle} testID="esport-bulle-etape">
        {telephone ? <LigneMenu theme={theme} icone="plus" texte={trAt(a.prefs.reprise ? 'frise.ajouter_reprise' : 'frise.ajouter')} desactive={n >= ETAPES_MAX} onPress={puis(a.ajouterEtape)} testID="esport-etape-num-ajouter" /> : null}
        <LigneMenu theme={theme} icone="copier" texte={trSt('etape.dupliquer')} raccourci="Ctrl+D" desactive={n >= ETAPES_MAX} onPress={puis(a.dupliquerEtape)} testID="esport-etape-dupliquer" />
        <LigneMenu theme={theme} icone="chevron-gauche" texte={trSt('etape.avancer')} desactive={a.iEtape === 0} onPress={puis(() => a.deplacerEtape(a.iEtape, a.iEtape - 1))} testID="esport-etape-gauche" />
        <LigneMenu theme={theme} icone="chevron-droite" texte={trSt('etape.reculer')} desactive={a.iEtape >= n - 1} onPress={puis(() => a.deplacerEtape(a.iEtape, a.iEtape + 1))} testID="esport-etape-droite" />
        <LigneMenu theme={theme} icone="fantome" texte={trAt('affichage.reprise')} coche={a.prefs.reprise} onPress={() => a.setPrefs({ reprise: !a.prefs.reprise })} testID="esport-etape-reprise" />
        <Separateur theme={theme} vertical={false} />
        <LigneMenu theme={theme} icone="gomme" texte={trSt('gauche.supprimer_etape_libelle')} onPress={puis(() => (a.faire({ type: 'vider', etape: a.iEtape }), a.setSelection([])))} testID="esport-supprimer-etape" />
        <LigneMenu theme={theme} icone="gomme" texte={trSt('gauche.supprimer_tout_libelle')} onPress={puis(() => (a.faire({ type: 'viderTout' }), a.setSelection([])))} testID="esport-supprimer-tout" />
        <LigneMenu theme={theme} icone="corbeille" texte={trSt('etape.supprimer')} danger desactive={n <= 1} onPress={puis(a.supprimerEtape)} testID="esport-etape-supprimer" />
      </Bulle>
    );
  } else if (p?.cle.startsWith('joueur:')) {
    const i = Number(p.cle.slice(7));
    const j = doc.joueurs[i];
    if (j) {
      bulle = (
        <Bulle theme={theme} ancre={p.ancre} fenetre={fenetre} feuille={feuille} largeur={320} cote="haut" onFermer={fermerBulle} testID="esport-bulle-joueur">
          <View style={{ padding: 8, gap: 10 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Champ theme={theme} libelle={trSt('joueurs.nom')} valeur={j.nom} onChanger={nom => a.faire({ type: 'joueur', index: i, champs: { nom: nom.slice(0, 24) } })} maxLength={24} style={{ flex: 1 }} testID={`esport-joueur-nom-${i}`} />
              <Champ theme={theme} libelle={trSt('joueurs.role')} valeur={j.role ?? ''} onChanger={role => a.faire({ type: 'joueur', index: i, champs: { role: role.slice(0, 24) || null } })} maxLength={24} style={{ width: 110 }} testID={`esport-joueur-role-${i}`} />
            </View>
            {a.agents.some(x => x.cle !== 'pion') ? (
              <>
                <TitreSection theme={theme}>{a.libelleAgent}</TitreSection>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }} testID={`esport-joueur-agent-${i}`}>
                  <PuceTexte theme={theme} texte={trSt('joueurs.aucun')} actif={!j.agent} onPress={() => a.faire({ type: 'joueur', index: i, champs: { agent: null } })} testID={`esport-joueur-agent-${i}-aucun`} hauteur={28} />
                  {a.agents.map(x => (
                    <PuceTexte key={x.cle} theme={theme} texte={x.nom} actif={j.agent === x.cle} onPress={() => a.faire({ type: 'joueur', index: i, champs: { agent: x.cle } })} testID={`esport-joueur-agent-${i}-${x.cle}`} hauteur={28} />
                  ))}
                </View>
              </>
            ) : null}
          </View>
        </Bulle>
      );
    }
  } else if (p?.cle === 'agents') bulle = <Bulle theme={theme} ancre={p.ancre} fenetre={fenetre} feuille={feuille} largeur={440} cote="haut" titre={a.libelleAgent} onFermer={fermerBulle} testID="esport-bulle-agents"><GrilleAgents theme={theme} a={a} onChoisi={fermerBulle} /></Bulle>;
  else if (p?.cle === 'affichage') bulle = <Bulle theme={theme} ancre={p.ancre} fenetre={fenetre} feuille={feuille} largeur={340} titre={trAt('plus.affichage')} onFermer={fermerBulle} testID="esport-bulle-affichage"><View style={{ padding: 8 }}><Affichage theme={theme} a={a} /></View></Bulle>;
  else if (p?.cle === 'options') bulle = <Bulle theme={theme} fenetre={fenetre} feuille onFermer={fermerBulle} testID="esport-bulle-options"><View style={{ padding: 8 }}><OptionsOutil theme={theme} a={a} /></View></Bulle>;
  else if (p?.cle === 'calibrage') {
    bulle = (
      <Bulle theme={theme} ancre={p.ancre} fenetre={fenetre} feuille={feuille} largeur={340} cote="haut" onFermer={fermerBulle} testID="esport-bulle-calibrage">
        <View style={{ padding: 10, gap: 10 }}>
          <Text style={texteAtelier(theme, 13)}>{trSt(!a.carteAsset?.minimap && !doc.carte.image ? 'editeur.sans_image' : 'editeur.non_calibree')}</Text>
          {onAdminJeux ? <BoutonHub theme={theme} titre={trAt('etat.ouvrir_jeux')} onPress={puis(onAdminJeux)} testID="esport-editeur-admin-jeux" /> : null}
        </View>
      </Bulle>
    );
  }

  // ---------------------------------------------------------------- Dialogues (confirmation, lien de partage)
  const dialogue = (contenu: React.ReactNode, testID: string, onFermer: () => void) => (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={trAt('tiroir.fermer')} onPress={onFermer} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' }} testID={`${testID}-fond`} />
      <View style={[verre(theme, 14), { width: Math.min(460, fenetre.largeur - 24), padding: 14, gap: 12 }]} testID={testID}>
        {contenu}
      </View>
    </View>
  );

  if (a.presentation) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.fond }} testID="esport-editeur">
        <Presentation theme={theme} a={a} format={format} fenetre={fenetre} canevas={canevas} pleinEcran={pleinEcran} onPleinEcran={onPleinEcran} />
      </View>
    );
  }

  const hautFrise = DIM.marge;
  const sousFrise = DIM.marge + DIM.frise + 6;
  return (
    <View style={{ flex: 1, backgroundColor: theme.fond }} testID="esport-editeur" {...({ dataSet: { format } } as object)}>
      <BarreHaut theme={theme} a={a} format={format} largeur={fenetre.largeur} />
      <View style={{ flex: 1, minHeight: 0 }}>
        <View style={{ flex: 1, minHeight: 0, overflow: 'hidden' }} onLayout={surZone} testID="esport-atelier-zone">
          {a.comparer && comparaison ? (
            comparaison({ largeur, hauteur })
          ) : (
            <View style={{ position: 'absolute', top: 0, left: 0, width: largeur, height: hauteur }}>{canevas({ ...a.propsCanevas, largeur, hauteur, marges, ...(telephone && !a.modeEdition ? { outil: 'main' as const } : {}) })}</View>
          )}
          {/* Rail d'outils, options de l'outil */}
          {railVisible && !a.comparer ? (
            <View style={{ position: 'absolute', left: DIM.marge, top: DIM.marge, zIndex: 10 }} pointerEvents="box-none">
              <RailOutils theme={theme} a={a} hauteurMax={hauteur - DIM.marge * 2} tactile={format === 'tablette'} />
            </View>
          ) : null}
          {!telephone && !a.comparer ? (
            <View style={{ position: 'absolute', left: DIM.rail + DIM.marge * 2 + (format === 'tablette' ? 6 : 0), top: sousFrise, zIndex: 9 }} pointerEvents="box-none">
              <PanneauOptions theme={theme} a={a} replie={optionsRepliees} onReplier={setOptionsRepliees} />
            </View>
          ) : null}
          {/* Frise des étapes */}
          <View style={{ position: 'absolute', top: hautFrise, left: telephone ? DIM.marge : DIM.rail + DIM.marge * 2 + 6, right: telephone ? DIM.marge : DIM.rail + DIM.marge * 2 + 6, alignItems: 'center', zIndex: 8 }} pointerEvents="box-none">
            <FriseEtapes theme={theme} a={a} format={format} largeurMax={telephone ? largeur - DIM.marge * 2 : Math.max(280, largeur - (DIM.rail + DIM.marge * 2 + 6) * 2)} />
          </View>
          {a.prefs.legende && !a.comparer ? (
            <View style={{ position: 'absolute', top: sousFrise, right: DIM.marge + (bureau && ouvert ? DIM.tiroir : 0), zIndex: 7 }} pointerEvents="none">
              <Legende theme={theme} a={a} />
            </View>
          ) : null}
          <Bandeaux theme={theme} a={a} />
          {/* Téléphone : « Modifier » ouvre l'édition ; les réglages de l'outil s'ouvrent en feuille. */}
          {telephone && a.peutModifier ? (
            <View style={{ position: 'absolute', right: DIM.marge, bottom: DIM.marge, flexDirection: 'row', gap: 6, zIndex: 9 }}>
              {a.modeEdition && OUTILS_A_OPTIONS.includes(a.outil) ? <BoutonIcone theme={theme} icone="reglages" libelle={trAt('options.titre')} texte={trAt('options.titre')} bulle="aucune" onPress={() => a.setPopover({ cle: 'options' })} testID="esport-atelier-options-ouvrir" /> : null}
              <View style={[verre(theme, 12)]}>
                <BoutonIcone theme={theme} icone={a.modeEdition ? 'valide' : 'crayon'} libelle={trAt(a.modeEdition ? 'telephone.terminer' : 'telephone.modifier')} texte={trAt(a.modeEdition ? 'telephone.terminer' : 'telephone.modifier')} bulle="aucune" plein={!a.modeEdition} onPress={() => a.setModeEdition(!a.modeEdition)} testID="esport-atelier-mode-edition" />
              </View>
            </View>
          ) : null}
          {telephone && (a.erreur || a.avis) ? (
            <View style={{ position: 'absolute', left: DIM.marge, right: 110, bottom: DIM.marge, zIndex: 9 }} pointerEvents="none">
              <View style={[verre(theme, 10), { paddingHorizontal: 10, paddingVertical: 6 }]}>
                <Text style={{ ...texteAtelier(theme, 12), color: a.erreur ? theme.critique : theme.ok }} numberOfLines={2} testID={a.erreur ? 'esport-editeur-erreur' : 'esport-editeur-avis'}>
                  {a.erreur ?? a.avis}
                </Text>
              </View>
            </View>
          ) : null}
          {ouvert && bureau ? <Tiroir theme={theme} a={a} format={format} hauteur={hauteur} extras={extrasTiroir} /> : null}
        </View>
        {telephone && edition ? (
          <View style={{ paddingVertical: 4, backgroundColor: theme.surface, borderTopWidth: 1, borderTopColor: theme.ligne }}>
            <RailOutils theme={theme} a={a} horizontal tactile />
          </View>
        ) : null}
        <Dock theme={theme} a={telephone && !a.modeEdition ? ({ ...a, peutModifier: false } as EtatAtelier) : a} format={format} />
        {telephone ? null : <LigneEtat theme={theme} a={a} format={format} onCalibrage={() => a.setPopover({ cle: 'calibrage', ancre: { x: fenetre.largeur - 260, y: fenetre.hauteur - DIM.etat, l: 0, h: 0 } })} />}
      </View>
      {ouvert && !bureau ? <Tiroir theme={theme} a={a} format={format} hauteur={fenetre.hauteur} extras={extrasTiroir} /> : null}
      {bulle}
      <MenuContextuel theme={theme} a={a} fenetre={fenetre} feuille={telephone} />
      <Aide theme={theme} a={a} fenetre={fenetre} />
      {a.confirmation === 'supprimer' && strat.moi.supprimer
        ? dialogue(
            <ConfirmationSuppression theme={theme} testID="esport-editeur-supprimer-confirmation" titre={trSs('confirm.titre', { titre: strat.titre })} texte={trSs('confirm.texte')} oui={trSs('confirm.oui')} desactive={Boolean(a.enCours)} onAnnuler={() => a.setConfirmation(undefined)} onConfirmer={() => void a.supprimerStrat()} />,
            'esport-editeur-dialogue-supprimer',
            () => a.setConfirmation(undefined),
          )
        : null}
      {a.confirmation === 'quitter'
        ? dialogue(
            <>
              <Text style={texteAtelier(theme, 15, true)}>{trAt('quitter.titre')}</Text>
              <Text style={attenueAtelier(theme, 13)}>{a.erreur ?? trAt('quitter.texte')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }}>
                <BoutonHub theme={theme} titre={trAt('quitter.rester')} variante="plein" onPress={() => a.setConfirmation(undefined)} testID="esport-editeur-rester" />
                <BoutonHub theme={theme} titre={trAt('quitter.sans_enregistrer')} variante="danger" onPress={a.quitterSansEnregistrer} testID="esport-editeur-quitter-sans" />
              </View>
            </>,
            'esport-editeur-dialogue-quitter',
            () => a.setConfirmation(undefined),
          )
        : null}
      {a.partage
        ? dialogue(
            <>
              <Text style={texteAtelier(theme, 15, true)}>{trAt('partage.titre')}</Text>
              <Text style={attenueAtelier(theme, 13)}>{trAt('partage.texte')}</Text>
              <TextInput testID="esport-editeur-partage-lien" accessibilityLabel={trAt('partage.titre')} value={a.partage} editable={false} selectTextOnFocus style={{ height: 38, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.fond, color: theme.texte, fontSize: 13, ...police(theme.policeChiffres) }} />
              <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
                {copier ? <BoutonHub theme={theme} titre={trAt('partage.copier')} variante="plein" onPress={() => copier(a.partage as string)} testID="esport-editeur-partage-copier" /> : null}
                <BoutonHub theme={theme} titre={trAt('tiroir.fermer')} onPress={() => a.setPartage(undefined)} testID="esport-editeur-partage-fermer" />
              </View>
            </>,
            'esport-editeur-dialogue-partage',
            () => a.setPartage(undefined),
          )
        : null}
      {a.enCours === 'export' || a.enCours === 'duplication' || a.enCours === 'suppression' ? (
        <View style={{ position: 'absolute', top: DIM.barre + 10, alignSelf: 'center', zIndex: 55 }} pointerEvents="none">
          <View style={[verre(theme, 10), { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 34 }]}>
            <Glyphe valeur="sablier" style={{ color: theme.attenue, fontSize: 13 }} />
            <Text style={texteAtelier(theme, 12)}>{trAt('etat.en_cours')}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}
