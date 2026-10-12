/**
 * Claude Office, onglet « Bureau » : un open space en ZONES THÉMATIQUES
 * dessiné DANS le hub (SVG isométrique sur le web et le PC, vues simplifiées
 * en natif ; aucun sprite ni serveur), sur le PC, le site et le téléphone. Un
 * personnage par session de Claude Code, qui va dans la zone de son activité
 * (atelier, salle des machines, bibliothèque, café web, réunion, réflexion…),
 * lève la main au guichet quand Claude attend ta réponse, et passe en salle
 * d'attente quand il a fini une tâche.
 *
 * En tête : check-list « Mise en route » (état réel), résumé « Aujourd'hui »,
 * pastilles « attend ta réponse » et « terminés à voir », aide « ? », bascule
 * Scène / Liste (mémorisée sur l'appareil), recherche dans l'historique,
 * filtre par projet. Toucher un agent ouvre son détail (chronologie).
 *
 * Sur le PC : journal local relu toutes les 2 s (« en direct »). Ailleurs :
 * copie chiffrée du relais, avec son âge, état calculé à la date du dépôt —
 * jamais présenté comme du direct. Voir docs/claude-office.md.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { police, type ThemeHub } from '../hub/themes';
import type { ContexteHub } from '../hub/types';
import { useMobile } from '../ui/mobile/useMobile';
import { useActiviteBureau, type ActiviteBureau } from './activiteBureau';
import { DetailAgent } from './DetailAgent';
import { LIBELLES_ETAT, compterBureau, deduireBureau, ilYA, libelleFraicheur, phraseAgent, type Agent } from './logiqueBureau';
import { etapesMiseEnRoute, type GenreAction } from './logiqueMiseEnRoute';
import { activiteAgent, apparence, entreesDemo, LIBELLES_ACTIVITE, TEINTES_ACTIVITE } from './logiqueScene';
import { phraseAujourdhui, resumeAujourdhui } from './logiqueStats';
import { Aide, MiseEnRoute } from './MiseEnRoute';
import { LIBELLE_HOOK_HISTORIQUE, type EtatClaudeOffice, type PontClaudeOffice } from './pont';
import { DELAIS_SALLE, delaiSalleMs, ecrirePrefsOffice, lirePrefsOffice, type DelaiSalle, type PrefsOffice } from './prefsOffice';
import { SceneOpenSpace } from './SceneOpenSpace';
import {
  DELAI_MIN_PRESENCE_MS, MAX_PRESENCES_JOUR, ecrireEtatPresence, ecrireEtatSynchro, lireEtatPresence, lireEtatSynchro, type EtatPresence, type EtatSynchroHistorique,
} from './synchroHistorique';
import { Bouton, Carte, Interrupteur, Puce, Segments, TAILLE } from './uiOffice';
import { ORDRE_ZONES, ZONES } from './zones';

/** Préférence « réduire les animations » du système (web : prefers-reduced-motion). */
export function useMouvementReduit(force?: boolean): boolean {
  const [reduit, setReduit] = useState(force ?? false);
  useEffect(() => {
    if (force !== undefined) {
      setReduit(force);
      return undefined;
    }
    let vivant = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then(v => vivant && setReduit(Boolean(v)))
      .catch(() => undefined);
    const abonnement = AccessibilityInfo.addEventListener?.('reduceMotionChanged', v => setReduit(Boolean(v)));
    return () => {
      vivant = false;
      abonnement?.remove?.();
    };
  }, [force]);
  return reduit;
}

/** Teinte d'activité assez contrastée pour du texte (≥ 4,5:1) : assombrie en thème clair, éclaircie en sombre. */
export function teinteLisible(hex: string, sombre: boolean): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const canal = (v: number) => Math.round(sombre ? v + (255 - v) * 0.3 : v * 0.6);
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => canal(v).toString(16).padStart(2, '0')).join('')}`;
}

/** Largeur de la scène en vue rapprochée (téléphone) : assez pour lire les personnages. */
const LARGEUR_RAPPROCHEE = 820;

export interface FiltreHistorique {
  session?: string;
  recherche?: string;
}

export interface PropsBureauVisuel {
  theme: ThemeHub;
  activite: Pick<ActiviteBureau, 'entrees' | 'references' | 'source' | 'lu'>;
  maintenant: number;
  /** Forcer « réduire les animations » (tests) ; sinon la préférence du système. */
  mouvementReduit?: boolean;
  /** Message de l'état vide, propre à la plateforme. */
  vide?: React.ReactNode;
  /** Sessions fictives affichées (mode « démo »). */
  demo?: boolean;
  /** Activer ou couper la démo ; absent : pas de bouton. */
  onDemo?(active: boolean): void;
  /** Réglages de l'appareil (vue, salle d'attente) ; absents : valeurs par défaut, non mémorisées. */
  prefs?: PrefsOffice;
  onPrefs?(p: PrefsOffice): void;
  /** Ouvrir l'onglet Historique, filtré. */
  onVoirHistorique?(f: FiltreHistorique): void;
  /** Bloc affiché en tête (check-list de mise en route). */
  entete?: React.ReactNode;
}

type ModeFiltre = 'avant' | 'masque';

/** Le dessin du bureau (sans chargement) : barre d'outils, scène ou liste, détail. */
export function BureauVisuel({ theme, activite, maintenant, mouvementReduit, vide, demo, onDemo, prefs: prefsDonnees, onPrefs, onVoirHistorique, entete }: PropsBureauVisuel) {
  const mobile = useMobile();
  const fenetre = useWindowDimensions();
  const reduit = useMouvementReduit(mouvementReduit);
  const [prefsLocales, setPrefsLocales] = useState(prefsDonnees ?? lirePrefsOffice(undefined));
  const prefs = prefsDonnees ?? prefsLocales;
  const changerPrefs = (p: PrefsOffice) => (onPrefs ? onPrefs(p) : setPrefsLocales(p));
  const [choisi, setChoisi] = useState<string>();
  const [dispo, setDispo] = useState<number>();
  const [rapproche, setRapproche] = useState(true);
  const [aide, setAide] = useState(false);
  const [zoneExpliquee, setZoneExpliquee] = useState<string>();
  const [filtre, setFiltre] = useState<{ projet: string; mode: ModeFiltre }>();
  const [recherche, setRecherche] = useState('');
  const defilement = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const vus = useMemo(() => new Set(prefs.vus), [prefs.vus]);
  const bureau = useMemo(
    () => deduireBureau(activite.entrees, { maintenant, references: activite.references, salle: { delaiMs: delaiSalleMs(prefs.delaiSalle), vus } }),
    [activite.entrees, activite.references, maintenant, prefs.delaiSalle, vus],
  );
  const compteurs = useMemo(() => compterBureau(bureau, activite.entrees, maintenant), [bureau, activite.entrees, maintenant]);
  const aujourdhui = useMemo(() => phraseAujourdhui(resumeAujourdhui(activite.entrees, maintenant)), [activite.entrees, maintenant]);
  const projets = useMemo(() => [...new Set(bureau.agents.map(a => a.projet ?? 'Projet inconnu'))].sort((a, b) => a.localeCompare(b, 'fr')), [bureau.agents]);
  const filtreActif = filtre && projets.includes(filtre.projet) ? filtre : undefined;
  const projetDe = (a: Agent) => a.projet ?? 'Projet inconnu';
  const agentsVus = filtreActif?.mode === 'masque' ? bureau.agents.filter(a => projetDe(a) !== filtreActif.projet) : bureau.agents;
  const estompes = useMemo(
    () => (filtreActif?.mode === 'avant' ? new Set(bureau.agents.filter(a => projetDe(a) !== filtreActif.projet).map(a => a.cle)) : undefined),
    [bureau.agents, filtreActif?.mode, filtreActif?.projet], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const detail = bureau.agents.find(a => a.cle === choisi);
  const enDirect = activite.source.genre === 'local' && !demo;
  const fraicheur = demo ? 'Démo · sessions fictives, aucune activité réelle' : libelleFraicheur(activite.source, maintenant);
  const largeurDispo = Math.max(280, Math.floor(dispo ?? Math.min(fenetre.width - 32, 1000)));
  const vueRapprochee = mobile && rapproche && largeurDispo < LARGEUR_RAPPROCHEE;
  const largeurScene = vueRapprochee ? LARGEUR_RAPPROCHEE : largeurDispo;
  const choisir = (cle: string) => setChoisi(c => (c === cle ? undefined : cle));
  const couleurPastille = demo ? '#E0803A' : enDirect ? theme.ok : theme.ligne;
  const attendent = bureau.agents.filter(a => a.etat === 'attend');
  const aVoir = bureau.agents.filter(a => a.salle);
  const marquerVu = (cleFin: string) => {
    changerPrefs({ ...prefs, vus: [...prefs.vus.filter(v => v !== cleFin), cleFin] });
    setChoisi(undefined);
  };
  const texte = { color: theme.texte, fontSize: TAILLE, lineHeight: 22, ...police(theme.policeTexte) };
  const attenue = { color: theme.attenue, fontSize: TAILLE, lineHeight: 22 };

  // Vue rapprochée : on part centré sur l'atelier et le guichet (une fois la vue mise en page).
  const centrer = () => {
    const x = Math.max(0, LARGEUR_RAPPROCHEE * 0.42 - largeurDispo / 2);
    const faire = () => defilement.current?.scrollTo?.({ x, animated: false });
    faire();
    if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(faire);
  };

  const compteursVue = (
    <View style={styles.compteurs} testID="bureau-compteurs">
      {([
        ['attendent', 'Attendent ta réponse', compteurs.attendent, TEINTES_ACTIVITE.attend],
        ['actifs', 'Au travail', compteurs.actifs, TEINTES_ACTIVITE.code],
        ['a-voir', 'Terminés à voir', compteurs.aVoir, ZONES.salle.teinte],
        ['inactifs', 'Inactifs', compteurs.inactifs, TEINTES_ACTIVITE.pause],
        ['termines', 'Sessions fermées', compteurs.termines, TEINTES_ACTIVITE.fini],
      ] as const).map(([id, libelle, valeur, teinte]) => (
        <View key={id} style={[styles.compteur, { borderColor: theme.ligne, borderRadius: theme.rayonMoyen, backgroundColor: theme.surface }]} accessibilityLabel={`${libelle} : ${valeur}`}>
          <View style={[styles.filet, { backgroundColor: teinte }]} />
          <Text style={[styles.nombre, { color: theme.texte }, police(theme.policeChiffres)]} testID={`bureau-compte-${id}`}>{valeur}</Text>
          <Text style={attenue} numberOfLines={2}>{libelle}</Text>
        </View>
      ))}
    </View>
  );

  const scene = (
    <SceneOpenSpace
      key={demo ? 'demo' : 'reel'}
      agents={agentsVus}
      charge={activite.lu}
      theme={theme}
      reduit={reduit}
      largeur={largeurScene}
      choisi={choisi}
      onChoisir={choisir}
      demo={demo}
      texteAgrandi={vueRapprochee}
      maintenant={maintenant}
      estompes={estompes}
    />
  );

  const carteAgent = (a: Agent, riche: boolean) => {
    const activiteA = activiteAgent(a);
    const teinte = a.fige ? theme.attenue : teinteLisible(a.etat === 'attend' ? TEINTES_ACTIVITE.attend : a.salle ? ZONES.salle.teinte : TEINTES_ACTIVITE[activiteA], theme.sombre);
    const ap = apparence(a);
    const selectionne = a.cle === choisi;
    const etat = a.salle ? `Terminé ${a.fin ? ilYA(a.fin, maintenant) : ''} · à voir` : a.fige ? `${LIBELLES_ETAT[a.etat]} (figé)` : LIBELLES_ETAT[a.etat];
    const ligne = a.etat === 'attend' ? a.attente : a.salle ? a.recap?.split('\n')[riche ? 1 : 0] ?? a.demande : a.demande;
    return (
      <Pressable
        key={a.cle}
        onPress={() => choisir(a.cle)}
        accessibilityRole="button"
        accessibilityLabel={`${a.projet ?? 'Projet inconnu'}${a.appareil ? `, ${a.appareil}` : ''}, ${ZONES[a.zone].nom} : ${phraseAgent(a, maintenant)}. ${a.salle ? 'Terminé, à voir. ' : ''}Dernière demande : ${a.demande ?? 'aucune'}. Ouvrir le détail`}
        accessibilityState={{ selected: selectionne }}
        testID={`bureau-agent-${a.session.slice(0, 12)}`}
        style={[styles.agent, { borderColor: selectionne ? theme.accent : a.etat === 'attend' ? TEINTES_ACTIVITE.attend : theme.ligne, backgroundColor: theme.surface, borderRadius: theme.rayonMoyen, width: mobile ? '100%' : undefined, opacity: estompes?.has(a.cle) ? 0.45 : 1 }]}
      >
        <View style={[styles.avatar, { backgroundColor: ap.haut, borderColor: teinte }]} aria-hidden importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <View style={[styles.avatarTete, { backgroundColor: ap.peau, borderTopColor: ap.cheveux }]} />
          {a.etat === 'attend' ? <View style={[styles.main, { backgroundColor: TEINTES_ACTIVITE.attend }]}><Text style={styles.mainTexte}>!</Text></View> : null}
        </View>
        <View style={styles.agentTexte}>
          <Text numberOfLines={1} style={{ color: theme.texte, fontSize: TAILLE + 1, fontWeight: '700' }}>
            {a.projet ?? 'Projet inconnu'}{a.appareil ? <Text style={{ color: theme.attenue, fontWeight: '400', fontSize: TAILLE }}>{` · ${a.appareil}`}</Text> : null}
          </Text>
          <View style={styles.ligneEtat}>
            <Text style={{ color: teinte, fontSize: TAILLE, fontWeight: '700' }} testID="bureau-etat-agent">{etat}</Text>
            <Text style={attenue}>{`${a.etat === 'outil' && !a.salle ? ` · ${LIBELLES_ACTIVITE[activiteA]}` : ''} · ${riche ? ZONES[a.zone].nom : ilYA(a.dernier, maintenant)}`}</Text>
          </View>
          <Text numberOfLines={riche ? 3 : 2} style={texte} testID="bureau-bulle">
            {ligne ?? (a.etat === 'termine' ? 'Session terminée' : 'Pas encore de demande')}
          </Text>
          {riche ? <Text style={attenue}>{`${a.demandes} demande(s) · ${a.outils} outil(s)${a.echecs ? ` · ${a.echecs} échec(s)` : ''} · depuis ${ilYA(a.debut, maintenant).replace('il y a ', '')}`}</Text> : null}
        </View>
      </Pressable>
    );
  };

  // Vue Liste : par zone, « attend ta réponse » puis « terminés récemment » d'abord.
  const groupes = ORDRE_ZONES.map(z => ({ z, agents: agentsVus.filter(a => a.zone === z) })).filter(g => g.agents.length);

  return (
    <View style={styles.colonne} testID="bureau-visuel" accessibilityLabel={`Bureau de Claude Office : ${compteurs.actifs} agent(s) au travail`}>
      {entete}
      <Text style={[texte, { fontWeight: '600' }]} testID="bureau-aujourdhui">{demo ? `${aujourdhui} (démo)` : aujourdhui}</Text>

      <View style={styles.entete}>
        <View style={[styles.pastille, { borderColor: couleurPastille, backgroundColor: theme.surface }]} testID="bureau-fraicheur">
          <Text style={{ color: demo ? (theme.sombre ? '#F4A261' : '#9A4A12') : enDirect ? theme.ok : theme.attenue, fontSize: TAILLE, fontWeight: '600' }}>
            {demo ? '◆ ' : enDirect ? '● ' : '◷ '}{fraicheur}
          </Text>
        </View>
        {attendent.length ? (
          <Bouton theme={theme} variante="plein" couleur={teinteLisible(TEINTES_ACTIVITE.attend, false)} titre={`✋ ${attendent.length} attend${attendent.length > 1 ? 'ent' : ''} ta réponse`} onPress={() => setChoisi(attendent[0].cle)} testID="bureau-pastille-attend" />
        ) : null}
        {aVoir.length ? (
          <Bouton theme={theme} variante="plein" couleur={teinteLisible(ZONES.salle.teinte, false)} titre={`✓ ${aVoir.length} terminé${aVoir.length > 1 ? 's' : ''} à voir`} onPress={() => setChoisi(aVoir[0].cle)} testID="bureau-pastille-a-voir" />
        ) : null}
      </View>

      <View style={styles.outils}>
        <Segments theme={theme} libelle="Affichage du bureau" valeurs={[['scene', 'Scène'], ['liste', 'Liste']] as const} valeur={prefs.vue} onChange={v => changerPrefs({ ...prefs, vue: v })} testID="bureau-vue" />
        <Bouton theme={theme} titre="?" libelle="Aide : comment lire le bureau" onPress={() => setAide(true)} testID="bureau-aide-ouvrir" />
        {onDemo ? (
          <Bouton
            theme={theme}
            variante={demo ? 'plein' : 'normal'}
            couleur={demo ? '#B85C1E' : undefined}
            titre={demo ? 'Quitter la démo' : 'Voir la démo'}
            libelle={demo ? 'Quitter la démo et revenir à l’activité réelle' : 'Voir la démo : sessions fictives animées'}
            onPress={() => {
              setChoisi(undefined);
              onDemo(!demo);
            }}
            testID="bureau-demo"
          />
        ) : null}
        {reduit ? <Text style={attenue} testID="bureau-mouvement">Animations réduites</Text> : null}
      </View>

      {mobile ? null : compteursVue}

      {prefs.vue === 'scene' ? (
        <View
          style={[styles.piece, { borderColor: theme.ligne, borderRadius: theme.rayonGrand, backgroundColor: theme.sombre ? '#121522' : '#EEF3F8' }]}
          testID={reduit ? 'bureau-piece-fixe' : 'bureau-piece-animee'}
          onLayout={e => setDispo(e.nativeEvent.layout.width)}
        >
          {vueRapprochee ? (
            <ScrollView
              ref={defilement}
              horizontal
              showsHorizontalScrollIndicator
              testID="bureau-scene-defilement"
              style={styles.defilement}
              onLayout={centrer}
              onContentSizeChange={centrer}
              aria-hidden
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
            >
              {scene}
            </ScrollView>
          ) : scene}
          {mobile && largeurDispo < LARGEUR_RAPPROCHEE ? (
            <View style={styles.barreScene}>
              <Text style={[attenue, { flex: 1 }]}>{vueRapprochee ? 'Fais glisser pour parcourir les zones.' : 'Vue d’ensemble de l’open space.'}</Text>
              <Bouton theme={theme} titre={vueRapprochee ? 'Vue d’ensemble' : 'Vue rapprochée'} onPress={() => setRapproche(v => !v)} testID="bureau-zoom" />
            </View>
          ) : null}
        </View>
      ) : null}

      {mobile ? compteursVue : null}
      {onVoirHistorique ? (
        <View style={styles.recherche}>
          <TextInput
            value={recherche}
            onChangeText={setRecherche}
            placeholder="Rechercher dans l’historique…"
            placeholderTextColor={theme.attenue}
            accessibilityLabel="Rechercher dans l’historique"
            inputMode="search"
            enterKeyHint="search"
            onSubmitEditing={() => onVoirHistorique({ recherche: recherche.trim() })}
            style={[styles.champ, { color: theme.texte, borderColor: theme.ligne, backgroundColor: theme.fond }]}
            testID="bureau-recherche"
          />
          <Bouton theme={theme} titre="Chercher" onPress={() => onVoirHistorique({ recherche: recherche.trim() })} testID="bureau-recherche-ok" />
        </View>
      ) : null}

      {projets.length > 1 ? (
        <ScrollView horizontal={mobile} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtres} style={mobile ? { flexGrow: 0 } : undefined} testID="bureau-filtres">
          <Text style={attenue}>Projets :</Text>
          <Puce theme={theme} titre="Tous" actif={!filtreActif} onPress={() => setFiltre(undefined)} testID="bureau-filtre-tous" />
          {projets.map(p => (
            <Puce key={p} theme={theme} titre={p} actif={filtreActif?.projet === p} onPress={() => setFiltre(f => (f?.projet === p ? undefined : { projet: p, mode: f?.mode ?? 'avant' }))} testID={`bureau-filtre-${p}`} libelle={`Projet ${p}`} />
          ))}
          {filtreActif ? (
            <Segments theme={theme} libelle="Effet du filtre" valeurs={[['avant', 'Mettre en avant'], ['masque', 'Masquer']] as const} valeur={filtreActif.mode} onChange={m => setFiltre({ projet: filtreActif.projet, mode: m })} testID="bureau-filtre-mode" />
          ) : null}
        </ScrollView>
      ) : null}


      {bureau.agents.length === 0 ? (
        <View style={[styles.vide, { borderColor: theme.ligne, borderRadius: theme.rayonMoyen, backgroundColor: theme.surface }]} testID="bureau-vide">
          {activite.lu ? vide : <Text style={attenue}>Lecture de l’activité…</Text>}
          {activite.lu && bureau.derniereActivite ? (
            <Text style={attenue} testID="bureau-derniere-activite">Dernière activité connue : {ilYA(bureau.derniereActivite, maintenant)}.</Text>
          ) : null}
          {activite.lu && onDemo && !demo ? (
            <Bouton theme={theme} titre="Voir la démo (sessions fictives)" onPress={() => onDemo(true)} testID="bureau-vide-demo" />
          ) : null}
        </View>
      ) : null}

      {prefs.vue === 'scene' ? (
        <View style={styles.legende} testID="bureau-legende" accessibilityLabel="Légende des zones de l’open space">
          {ORDRE_ZONES.map(z => (
            <Pressable
              key={z}
              accessibilityRole="button"
              accessibilityLabel={`${ZONES[z].nom} : ${ZONES[z].role}`}
              accessibilityState={{ expanded: zoneExpliquee === z }}
              onPress={() => setZoneExpliquee(e => (e === z ? undefined : z))}
              style={[styles.puceZone, { borderColor: zoneExpliquee === z ? ZONES[z].teinte : theme.ligne, backgroundColor: theme.surface }]}
              testID={`bureau-legende-${z}`}
            >
              <View style={[styles.rond, { backgroundColor: ZONES[z].teinte }]} aria-hidden />
              <Text style={{ color: theme.texte, fontSize: TAILLE }}>{ZONES[z].nom}</Text>
            </Pressable>
          ))}
          {zoneExpliquee ? <Text style={[attenue, { width: '100%' }]} testID="bureau-legende-explication">{ZONES[zoneExpliquee as keyof typeof ZONES].nom} : {ZONES[zoneExpliquee as keyof typeof ZONES].role}.</Text> : null}
        </View>
      ) : null}

      {bureau.enPlus || bureau.expirees ? (
        <Text style={attenue} testID="bureau-en-plus">
          {[bureau.enPlus ? `+${bureau.enPlus} autre(s) agent(s) non dessiné(s)` : '', bureau.expirees ? `${bureau.expirees} session(s) sans activité depuis plus de 3 h, rangée(s)` : ''].filter(Boolean).join(' · ')}
        </Text>
      ) : null}

      {agentsVus.length && prefs.vue === 'scene' ? (
        <View style={styles.colonne}>
          <Text style={[styles.titreListe, { color: theme.texte }]} accessibilityRole="header">
            {demo ? `Agents de la démo (${agentsVus.length})` : `Agents (${agentsVus.length})`}
          </Text>
          <View style={styles.liste} testID="bureau-postes">{agentsVus.map(a => carteAgent(a, false))}</View>
        </View>
      ) : null}
      {agentsVus.length && prefs.vue === 'liste' ? (
        <View style={styles.colonne} testID="bureau-liste">
          {groupes.map(g => (
            <View key={g.z} style={styles.colonne} testID={`bureau-groupe-${g.z}`}>
              <View style={styles.titreGroupe}>
                <View style={[styles.rond, { backgroundColor: ZONES[g.z].teinte }]} aria-hidden />
                <Text style={[styles.titreListe, { color: theme.texte }]} accessibilityRole="header">
                  {g.z === 'salle' ? 'Terminés récemment' : ZONES[g.z].nom} ({g.agents.length})
                </Text>
              </View>
              <View style={styles.liste}>{g.agents.map(a => carteAgent(a, true))}</View>
            </View>
          ))}
        </View>
      ) : null}

      <Aide theme={theme} visible={aide} onFermer={() => setAide(false)} />
      <DetailAgent
        theme={theme}
        agent={detail}
        entrees={activite.entrees}
        maintenant={maintenant}
        onFermer={() => setChoisi(undefined)}
        onVoirHistorique={onVoirHistorique ? s => { setChoisi(undefined); onVoirHistorique({ session: s }); } : undefined}
        onMarquerVu={marquerVu}
      />
    </View>
  );
}

/** Onglet « Bureau » complet : lecture de l'activité, mise en route, visuel, réglages, copie chiffrée. */
export function OngletBureau({ theme, contexte, office, mouvementReduit, horloge, debutDemo: debutDemoDonne, onDemo, onVoirHistorique }: {
  theme: ThemeHub; contexte: ContexteHub; office?: PontClaudeOffice; mouvementReduit?: boolean; horloge?: () => number;
  /** Démo pilotée par l'écran (partagée avec Historique et Statistiques) : date de début. */
  debutDemo?: number; onDemo?(active: boolean): void; onVoirHistorique?(f: FiltreHistorique): void;
}) {
  const pont = office?.historique;
  const service = contexte.historiqueOffice;
  const base = contexte.baseProfil;
  const activite = useActiviteBureau({ pont, service, base });
  const [maintenant, setMaintenant] = useState(() => (horloge ?? Date.now)());
  // Démo : sessions fictives (date de début), rien de réel n'est lu ni écrit.
  const [debutDemoLocal, setDebutDemoLocal] = useState<number>();
  const debutDemo = onDemo ? debutDemoDonne : debutDemoLocal;
  // L'âge des états change sans nouvel événement : on recalcule toutes les 5 s (chaque seconde en démo).
  useEffect(() => {
    const t = setInterval(() => setMaintenant((horloge ?? Date.now)()), debutDemo !== undefined ? 1_000 : 5_000);
    return () => clearInterval(t);
  }, [horloge, debutDemo]);
  const activiteDemo = useMemo(
    () => (debutDemo === undefined ? undefined : { entrees: entreesDemo(debutDemo, maintenant), references: {}, source: { genre: 'local' as const }, lu: true }),
    [debutDemo, maintenant],
  );
  const basculerDemo = (active: boolean) => {
    const t = (horloge ?? Date.now)();
    setMaintenant(t);
    if (onDemo) onDemo(active);
    else setDebutDemoLocal(active ? t : undefined);
  };
  const [prefs, setPrefs] = useState<PrefsOffice>(() => lirePrefsOffice(base));
  const changerPrefs = (p: PrefsOffice) => {
    setPrefs(p);
    ecrirePrefsOffice(base, p);
  };
  const [synchro, setSynchro] = useState<EtatSynchroHistorique>(() => lireEtatSynchro(base));
  const [presence, setPresence] = useState<EtatPresence>(() => lireEtatPresence(base));
  const [etatHook, setEtatHook] = useState<EtatClaudeOffice['historique']>();
  const [message, setMessage] = useState<string>();
  const [occupe, setOccupe] = useState(false);

  const lireHook = () => {
    if (!office || !pont) return;
    office.etat().then(e => setEtatHook(e.historique)).catch(() => undefined);
  };
  useEffect(() => {
    if (!office || !pont) return;
    let vivant = true;
    office.etat().then(e => vivant && setEtatHook(e.historique)).catch(() => undefined);
    return () => void (vivant = false);
  }, [office, pont]);

  // Les réglages de copie peuvent changer ailleurs (onglet Historique, dépôt en arrière-plan) : relus avec l'horloge.
  useEffect(() => {
    if (!pont) return;
    setSynchro(s => {
      const lu = lireEtatSynchro(base);
      return JSON.stringify(lu) === JSON.stringify(s) ? s : lu;
    });
  }, [pont, base, maintenant]);

  const basculerCopie = (active: boolean) => {
    const etat = { ...lireEtatSynchro(base), active, erreur: undefined };
    ecrireEtatSynchro(base, etat);
    setSynchro(etat);
    if (!active) {
      const p = { ...lireEtatPresence(base), active: false };
      ecrireEtatPresence(base, p);
      setPresence(p);
    }
    setMessage(active ? 'Copie chiffrée activée : premier dépôt dans la minute qui suit (puis au plus toutes les 15 min).' : 'Copie chiffrée désactivée : plus rien n’est déposé depuis ce PC.');
  };
  const basculerPresence = (active: boolean) => {
    const p = { ...lireEtatPresence(base), active, erreur: undefined };
    ecrireEtatPresence(base, p);
    setPresence(p);
  };
  const installerHook = async () => {
    if (!pont) return;
    setOccupe(true);
    try {
      const r = await pont.installerHooks(false);
      setMessage(r.annule ? 'Annulé : rien n’a été modifié.' : !r.ok ? r.erreur : r.ecrit ? 'Hook installé. Redémarre Claude Code : ses sessions apparaîtront ici.' : 'Rien à faire : déjà installé.');
      const e = await office?.etat().catch(() => undefined);
      if (e) setEtatHook(e.historique);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setOccupe(false);
    }
  };

  // Mise en route : état réel (hook, événements, copie, présence), mis à jour seul.
  const bureauReel = useMemo(() => deduireBureau(activite.entrees, { maintenant, references: activite.references }), [activite.entrees, activite.references, maintenant]);
  const etapes = etapesMiseEnRoute({
    maintenant, surPc: Boolean(pont), lu: activite.lu, relais: Boolean(service), ...(activite.erreur ? { erreur: activite.erreur } : {}),
    ...(etatHook ? { hook: etatHook } : {}), ...(bureauReel.derniereActivite !== undefined ? { derniereActivite: bureauReel.derniereActivite } : {}),
    ...(pont ? { copie: { active: synchro.active, ...(synchro.derniere ? { derniere: synchro.derniere } : {}), ...(synchro.erreur ? { erreur: synchro.erreur } : {}) }, presence: { active: presence.active, ...(presence.derniere ? { derniere: presence.derniere } : {}) } } : { depots: activite.depots }),
  });
  const agir = (g: GenreAction) => {
    if (g === 'installer-hook') void installerHook();
    else if (g === 'activer-copie') basculerCopie(true);
    else if (g === 'activer-presence') basculerPresence(true);
    else if (g === 'demo') basculerDemo(true);
    else {
      activite.relire();
      lireHook();
    }
  };

  // PC : notification système (désactivée par défaut) quand une session se met à attendre ta réponse.
  const notifiees = useRef<Set<string>>(new Set());
  const systeme = (globalThis as { applibourse?: { systeme?: { notifier?(t: string, c: string, d?: string): Promise<boolean> } } }).applibourse?.systeme;
  useEffect(() => {
    if (!pont || !prefs.notifierAttente || debutDemo !== undefined || !systeme?.notifier) return;
    for (const a of bureauReel.agents) {
      if (a.etat !== 'attend' || maintenant - a.dernier > 10 * 60_000) continue;
      const cle = `${a.cle}@${a.dernier}`;
      if (notifiees.current.has(cle)) continue;
      notifiees.current.add(cle);
      void systeme.notifier('Claude attend ta réponse', `${a.projet ?? 'Claude Code'} : ${a.attente ?? 'autorisation ou question en attente'}`, '').catch(() => undefined);
    }
  }, [bureauReel.agents, pont, prefs.notifierAttente, debutDemo, systeme, maintenant]);

  const texte = { color: theme.texte, fontSize: TAILLE, lineHeight: 22, ...police(theme.policeTexte) };
  const attenue = { color: theme.attenue, fontSize: TAILLE, lineHeight: 22 };
  const dernierDepot = activite.source.genre === 'relais' ? activite.source.date : undefined;

  const vide = pont ? (
    <Text style={texte} testID="bureau-vide-texte">
      {etatHook === 'absents'
        ? 'Personne au bureau : le hook d’historique n’est pas encore installé sur ce PC, donc Claude Code n’y note rien. Voir « Mise en route » ci-dessus.'
        : 'Personne au bureau pour l’instant. Lance Claude Code sur ce PC : chaque session y apparaîtra avec son personnage, en quelques secondes.'}
    </Text>
  ) : (
    <Text style={texte} testID="bureau-vide-texte">
      {service
        ? dernierDepot
          ? 'Aucun agent dans le dernier dépôt reçu : Claude Code ne travaillait pas à ce moment-là.'
          : 'Aucune activité reçue pour l’instant. Rien à installer ici : ce bureau s’affiche dès qu’un PC équipé dépose sa copie chiffrée (voir « Mise en route »).'
        : 'Ce bureau lit la copie chiffrée déposée sur le relais par le PC où tourne Claude Code. Elle est réservée au compte principal relié au relais : connecte-toi avec lui pour la voir ici.'}
    </Text>
  );

  return (
    <View style={styles.colonne} testID="bureau">
      <BureauVisuel
        theme={theme}
        activite={activiteDemo ?? activite}
        maintenant={maintenant}
        mouvementReduit={mouvementReduit}
        vide={vide}
        demo={activiteDemo !== undefined}
        onDemo={basculerDemo}
        prefs={prefs}
        onPrefs={changerPrefs}
        onVoirHistorique={onVoirHistorique}
        entete={debutDemo === undefined ? <MiseEnRoute theme={theme} etapes={etapes} onAction={agir} occupe={occupe} /> : null}
      />
      {activite.erreur ? <Text style={[attenue, { color: theme.critique }]} testID="bureau-erreur">{activite.erreur}</Text> : null}
      {message ? <Text style={texte} testID="bureau-message" accessibilityLiveRegion="polite">{message}</Text> : null}

      <Carte theme={theme} titre="Réglages du bureau" testID="bureau-reglages">
        <Text style={texte}>Salle d’attente : un agent qui a fini une tâche y reste</Text>
        <View style={styles.filtres}>
          {DELAIS_SALLE.map(d => (
            <Puce key={d} theme={theme} titre={d === 'vu' ? 'Jusqu’à ce que je l’aie vu' : `${d} min`} actif={prefs.delaiSalle === d} onPress={() => changerPrefs({ ...prefs, delaiSalle: d as DelaiSalle })} testID={`bureau-delai-salle-${d}`} />
          ))}
        </View>
        <Text style={attenue}>Le délai part de la fin réelle de la tâche (même sur le site). « Vu » est retenu sur cet appareil seulement.</Text>
        {pont ? (
          <Interrupteur
            theme={theme}
            libelle="Me prévenir quand Claude attend ma réponse"
            aide="Notification de Windows quand une session demande une autorisation ou pose une question (tant que l’onglet Bureau est ouvert)."
            valeur={prefs.notifierAttente}
            onChange={v => changerPrefs({ ...prefs, notifierAttente: v })}
            testID="bureau-notifier-attente"
          />
        ) : null}
      </Carte>

      {pont ? (
        <Carte theme={theme} titre="Voir ce bureau sur le site et le téléphone" testID="bureau-partage">
          {service ? (
            <>
              <Text style={attenue}>
                Le site et le téléphone ne peuvent pas lire ce PC : ils relisent une copie chiffrée (clé de synchronisation, le relais ne voit que du bruit) que ce PC dépose, au plus toutes les 15 min. Rien à installer sur ces appareils.
              </Text>
              <Interrupteur theme={theme} libelle="Déposer la copie chiffrée de ce PC" valeur={synchro.active} onChange={basculerCopie} testID="bureau-copie-active" />
              <Interrupteur
                theme={theme}
                libelle="Présence rapide"
                aide={`Pendant que Claude Code travaille, un petit dépôt de l’activité récente toutes les ${DELAI_MIN_PRESENCE_MS / 60_000} min (${MAX_PRESENCES_JOUR} par jour au plus, puis pause jusqu’au lendemain) : le bureau à distance est moins en retard. Rien n’est déposé quand rien ne change.`}
                valeur={presence.active && synchro.active}
                desactive={!synchro.active}
                onChange={basculerPresence}
                testID="bureau-presence-active"
              />
              <Text style={attenue} testID="bureau-dernier-depot">
                Dernier dépôt : {synchro.derniere ? new Date(synchro.derniere).toLocaleString('fr-FR') : 'jamais'}
                {presence.active && presence.derniere ? ` · présence : ${new Date(presence.derniere).toLocaleTimeString('fr-FR')}` : ''}
                {synchro.erreur ? ` · erreur : ${synchro.erreur}` : ''}
              </Text>
            </>
          ) : (
            <Text style={attenue}>
              Pour le voir ailleurs, relie le compte principal au relais (Paramètres › Synchronisation) : ce PC pourra alors déposer une copie chiffrée de son activité.
            </Text>
          )}
          {etatHook ? <Text style={attenue} testID="bureau-hook-etat">Hook d’historique : {LIBELLE_HOOK_HISTORIQUE[etatHook]}</Text> : null}
        </Carte>
      ) : null}

      <View style={[styles.avertissement, { borderColor: theme.alerte, backgroundColor: theme.surface, borderRadius: theme.rayonMoyen }]} testID="bureau-avertissement">
        <Text style={texte}>
          Ces bulles montrent ce que tu écris à Claude : traite cet écran comme un document personnel. Les secrets reconnus sont masqués, pas forcément tous. Le hook reste nécessaire sur le PC où tourne Claude Code ; rien n’est à installer sur les appareils où tu regardes.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  colonne: { gap: 12 },
  entete: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  outils: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  pastille: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, flexShrink: 1, minHeight: 44, justifyContent: 'center' },
  recherche: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  champ: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, minHeight: 44, fontSize: 16 },
  filtres: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  compteurs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  compteur: { borderWidth: StyleSheet.hairlineWidth, paddingVertical: 8, paddingHorizontal: 12, paddingLeft: 16, minWidth: 120, flexGrow: 1, flexBasis: 120, overflow: 'hidden' },
  filet: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  nombre: { fontSize: 22, fontWeight: '700' },
  piece: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', alignItems: 'center' },
  defilement: { alignSelf: 'stretch', width: '100%' },
  barreScene: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingBottom: 10, alignSelf: 'stretch' },
  legende: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  puceZone: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, minHeight: 44 },
  rond: { width: 12, height: 12, borderRadius: 6 },
  titreListe: { fontSize: 17, fontWeight: '700' },
  titreGroupe: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liste: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  agent: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 2, padding: 10, minHeight: 64, flexGrow: 1, flexBasis: 300, maxWidth: '100%' },
  avatar: { width: 44, height: 44, borderRadius: 22, borderWidth: 3, alignItems: 'center', justifyContent: 'flex-end' },
  avatarTete: { width: 20, height: 20, borderRadius: 10, borderTopWidth: 6, marginBottom: 7 },
  main: { position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  mainTexte: { color: '#FFFFFF', fontWeight: '900', fontSize: 15, lineHeight: 18 },
  agentTexte: { flex: 1, gap: 2, minWidth: 0 },
  ligneEtat: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  vide: { borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 10 },
  avertissement: { borderWidth: 1, padding: 12, gap: 6 },
});
