/**
 * Claude Office, onglet « Bureau » : un open space dessiné DANS le hub
 * (SVG isométrique sur le web et le PC, vues simplifiées en natif ; aucun
 * sprite ni serveur), sur le PC, le site et le téléphone. Un personnage par
 * session de Claude Code, qui arrive à son poste, tape, utilise ses outils,
 * réfléchit, boit un café, fête la fin de session et repart, selon l'état
 * déduit des derniers événements ; bulle avec la dernière demande résumée.
 * Sous la scène, la liste des agents (état, projet, dernière demande) porte
 * la même information pour le clavier et les lecteurs d'écran. Mode « démo »
 * (sessions fictives) activable depuis l'écran.
 *
 * Sur le PC : journal local relu toutes les 2 s (« en direct »). Ailleurs :
 * copie chiffrée du relais, avec son âge (« à jour il y a X min ») et l'état
 * calculé à la date du dépôt — jamais présenté comme du direct.
 * Animations coupées si le système demande de réduire les animations.
 * Voir docs/claude-office.md.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, Switch, Text, useWindowDimensions, View } from 'react-native';
import { BoutonHub } from '../hub/Hub';
import { police, type ThemeHub } from '../hub/themes';
import type { ContexteHub } from '../hub/types';
import { useMobile } from '../ui/mobile/useMobile';
import { useActiviteBureau, type ActiviteBureau } from './activiteBureau';
import {
  LIBELLES_ETAT, compterBureau, couleurAgent, deduireBureau, ilYA, libelleFraicheur, phraseAgent, resumerTexte,
} from './logiqueBureau';
import { ICONES_ACTIVITE, LIBELLES_ACTIVITE, TEINTES_ACTIVITE, activiteAgent, apparence, entreesDemo, type Activite } from './logiqueScene';
import { SceneOpenSpace } from './SceneOpenSpace';
import { LIBELLE_HOOK_HISTORIQUE, type EtatClaudeOffice, type PontClaudeOffice } from './pont';
import {
  DELAI_MIN_PRESENCE_MS, MAX_PRESENCES_JOUR, ecrireEtatPresence, ecrireEtatSynchro, lireEtatPresence, lireEtatSynchro, type EtatPresence, type EtatSynchroHistorique,
} from './synchroHistorique';

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

/** Légende de la scène : gadgets et états. */
const LEGENDE: readonly Activite[] = ['code', 'terminal', 'recherche', 'lecture', 'web', 'agent', 'pense', 'pause', 'fini'];

/** Largeur de la scène en vue rapprochée (téléphone) : assez pour lire les personnages. */
const LARGEUR_RAPPROCHEE = 780;

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
}

/** Le dessin du bureau (sans chargement) : open space, compteurs, fraîcheur, liste des agents. */
export function BureauVisuel({ theme, activite, maintenant, mouvementReduit, vide, demo, onDemo }: PropsBureauVisuel) {
  const mobile = useMobile();
  const fenetre = useWindowDimensions();
  const reduit = useMouvementReduit(mouvementReduit);
  const [choisi, setChoisi] = useState<string>();
  const [dispo, setDispo] = useState<number>();
  const [rapproche, setRapproche] = useState(true);
  const defilement = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const bureau = useMemo(
    () => deduireBureau(activite.entrees, { maintenant, references: activite.references }),
    [activite.entrees, activite.references, maintenant],
  );
  const compteurs = useMemo(() => compterBureau(bureau, activite.entrees, maintenant), [bureau, activite.entrees, maintenant]);
  const detail = bureau.agents.find(a => a.cle === choisi);
  const taille = mobile ? 15 : 14;
  const enDirect = activite.source.genre === 'local' && !demo;
  const fraicheur = demo ? 'Démo · sessions fictives, aucune activité réelle' : libelleFraicheur(activite.source, maintenant);
  const largeurDispo = Math.max(280, Math.floor(dispo ?? Math.min(fenetre.width - 32, 1000)));
  const vueRapprochee = mobile && rapproche && largeurDispo < LARGEUR_RAPPROCHEE;
  const largeurScene = vueRapprochee ? LARGEUR_RAPPROCHEE : largeurDispo;
  const choisir = (cle: string) => setChoisi(c => (c === cle ? undefined : cle));
  const couleurPastille = demo ? '#E0803A' : enDirect ? theme.ok : theme.ligne;

  // Vue rapprochée : on part centré sur les îlots (une fois la vue mise en page).
  const centrer = () => {
    const x = Math.max(0, LARGEUR_RAPPROCHEE * 0.56 - largeurDispo / 2);
    const faire = () => defilement.current?.scrollTo?.({ x, animated: false });
    faire();
    if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(faire);
  };

  const compteursVue = (
    <View style={styles.compteurs} testID="bureau-compteurs">
      {([
        ['actifs', 'Au travail', compteurs.actifs, TEINTES_ACTIVITE.code],
        ['inactifs', 'Inactifs', compteurs.inactifs, TEINTES_ACTIVITE.pause],
        ['termines', 'Terminés', compteurs.termines, TEINTES_ACTIVITE.fini],
        ['demandes', 'Demandes du jour', compteurs.demandesDuJour, TEINTES_ACTIVITE.web],
        ['outils', 'Outils du jour', compteurs.outilsDuJour, TEINTES_ACTIVITE.outil],
      ] as const).map(([id, libelle, valeur, teinte]) => (
        <View key={id} style={[styles.compteur, { borderColor: theme.ligne, borderRadius: theme.rayonMoyen, backgroundColor: theme.surface }]}>
          <View style={[styles.filet, { backgroundColor: teinte }]} />
          <Text style={[styles.nombre, { color: theme.texte }, police(theme.policeChiffres)]} testID={`bureau-compte-${id}`}>{valeur}</Text>
          <Text style={{ color: theme.attenue, fontSize: taille }}>{libelle}</Text>
        </View>
      ))}
    </View>
  );

  const scene = (
    <SceneOpenSpace
      key={demo ? 'demo' : 'reel'}
      agents={bureau.agents}
      charge={activite.lu}
      theme={theme}
      reduit={reduit}
      largeur={largeurScene}
      choisi={choisi}
      onChoisir={choisir}
      demo={demo}
      texteAgrandi={vueRapprochee}
      maintenant={maintenant}
    />
  );

  return (
    <View style={styles.colonne} testID="bureau-visuel" accessibilityLabel={`Bureau de Claude Office : ${compteurs.actifs} agent(s) au travail`}>
      <View style={styles.entete}>
        <View style={[styles.pastille, { borderColor: couleurPastille, backgroundColor: theme.surface }]} testID="bureau-fraicheur">
          <Text style={{ color: demo ? (theme.sombre ? '#F4A261' : '#9A4A12') : enDirect ? theme.ok : theme.attenue, fontSize: taille, fontWeight: '600' }}>
            {demo ? '◆ ' : enDirect ? '● ' : '◷ '}{fraicheur}
          </Text>
        </View>
        <View style={styles.enteteDroite}>
          <Text style={{ color: theme.attenue, fontSize: taille }} testID="bureau-mouvement">{reduit ? 'Animations réduites' : ''}</Text>
          {onDemo ? (
            <BoutonHub
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
        </View>
      </View>

      {mobile ? null : compteursVue}
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
            aria-hidden
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
          >
            {scene}
          </ScrollView>
        ) : scene}
        {mobile && largeurDispo < LARGEUR_RAPPROCHEE ? (
          <View style={styles.barreScene}>
            <Text style={{ color: theme.attenue, fontSize: taille, flex: 1 }}>{vueRapprochee ? 'Faites glisser pour parcourir l’open space.' : 'Vue d’ensemble de l’open space.'}</Text>
            <BoutonHub theme={theme} titre={vueRapprochee ? 'Vue d’ensemble' : 'Vue rapprochée'} onPress={() => setRapproche(v => !v)} testID="bureau-zoom" />
          </View>
        ) : null}
      </View>

      {mobile ? compteursVue : null}

      {bureau.agents.length === 0 ? (
        <View style={[styles.vide, { borderColor: theme.ligne, borderRadius: theme.rayonMoyen, backgroundColor: theme.surface }]} testID="bureau-vide">
          {activite.lu ? vide : <Text style={{ color: theme.attenue, fontSize: taille }}>Lecture de l’activité…</Text>}
          {activite.lu && bureau.derniereActivite ? (
            <Text style={{ color: theme.attenue, fontSize: taille }} testID="bureau-derniere-activite">
              Dernière activité connue : {ilYA(bureau.derniereActivite, maintenant)}.
            </Text>
          ) : null}
          {activite.lu && onDemo && !demo ? (
            <Text style={{ color: theme.attenue, fontSize: taille }}>Pour voir l’open space s’animer sans activité réelle : « Voir la démo ».</Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.legende} testID="bureau-legende" accessibilityLabel="Légende des gadgets de l’open space">
        {LEGENDE.map(a => (
          <View key={a} style={styles.puce}>
            <View style={[styles.rond, { borderColor: TEINTES_ACTIVITE[a], backgroundColor: theme.surface }]}>
              <Text style={{ color: TEINTES_ACTIVITE[a], fontSize: 11, fontWeight: '800' }} aria-hidden>{ICONES_ACTIVITE[a]}</Text>
            </View>
            <Text style={{ color: theme.attenue, fontSize: taille }}>{LIBELLES_ACTIVITE[a]}</Text>
          </View>
        ))}
      </View>

      {bureau.enPlus || bureau.expirees ? (
        <Text style={{ color: theme.attenue, fontSize: taille }} testID="bureau-en-plus">
          {[bureau.enPlus ? `+${bureau.enPlus} autre(s) agent(s) non dessiné(s)` : '', bureau.expirees ? `${bureau.expirees} session(s) sans activité depuis plus de 3 h, rangée(s)` : ''].filter(Boolean).join(' · ')}
        </Text>
      ) : null}

      {bureau.agents.length ? (
        <View style={styles.colonne}>
          <Text style={[styles.titreListe, { color: theme.texte }]} accessibilityRole="header">
            {demo ? `Agents de la démo (${bureau.agents.length})` : `Agents (${bureau.agents.length})`}
          </Text>
          <View style={styles.liste} testID="bureau-postes">
            {bureau.agents.map(a => {
              const activiteA = activiteAgent(a);
              const teinte = a.fige ? theme.attenue : teinteLisible(TEINTES_ACTIVITE[activiteA], theme.sombre);
              const ap = apparence(a);
              const selectionne = a.cle === choisi;
              return (
                <Pressable
                  key={a.cle}
                  onPress={() => choisir(a.cle)}
                  accessibilityRole="button"
                  accessibilityLabel={`${a.projet ?? 'Projet inconnu'}${a.appareil ? `, ${a.appareil}` : ''} : ${phraseAgent(a, maintenant)}. Dernière demande : ${a.demande ?? 'aucune'}`}
                  accessibilityState={{ selected: selectionne }}
                  testID={`bureau-agent-${a.session.slice(0, 12)}`}
                  style={[styles.agent, { borderColor: selectionne ? theme.accent : theme.ligne, backgroundColor: theme.surface, borderRadius: theme.rayonMoyen, width: mobile ? '100%' : undefined }]}
                >
                  <View style={[styles.avatar, { backgroundColor: ap.haut, borderColor: teinte }]} aria-hidden importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                    <View style={[styles.avatarTete, { backgroundColor: ap.peau, borderTopColor: ap.cheveux }]} />
                  </View>
                  <View style={styles.agentTexte}>
                    <Text numberOfLines={1} style={{ color: theme.texte, fontSize: taille + 1, fontWeight: '700' }}>
                      {a.projet ?? 'Projet inconnu'}{a.appareil ? <Text style={{ color: theme.attenue, fontWeight: '400', fontSize: taille }}>{` · ${a.appareil}`}</Text> : null}
                    </Text>
                    <View style={styles.ligneEtat}>
                      <Text style={{ color: teinte, fontSize: taille, fontWeight: '700' }} testID="bureau-etat-agent">
                        {a.fige ? `${LIBELLES_ETAT[a.etat]} (figé)` : LIBELLES_ETAT[a.etat]}
                      </Text>
                      <Text style={{ color: theme.attenue, fontSize: taille }}>
                        {`${a.etat === 'outil' ? ` · ${LIBELLES_ACTIVITE[activiteA]}` : ''} · ${ilYA(a.dernier, maintenant)}`}
                      </Text>
                    </View>
                    <Text numberOfLines={2} style={{ color: theme.texte, fontSize: taille, lineHeight: taille + 5 }} testID="bureau-bulle">
                      {a.demande ?? (a.etat === 'termine' ? 'Session terminée' : 'Pas encore de demande')}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {detail ? (
        <View style={[styles.carte, { backgroundColor: theme.surface, borderColor: couleurAgent(detail.projet ?? detail.cle), borderRadius: theme.rayonMoyen }]} testID="bureau-detail">
          <Text style={{ color: theme.texte, fontSize: taille + 1, fontWeight: '700' }}>{detail.projet ?? 'Projet inconnu'}{detail.appareil ? ` · ${detail.appareil}` : ''}</Text>
          <Text style={{ color: theme.texte, fontSize: taille }}>{phraseAgent(detail, maintenant)}</Text>
          {detail.demande ? <Text selectable style={{ color: theme.texte, fontSize: taille }}>Dernière demande : {resumerTexte(detail.demande, 300)}</Text> : null}
          <Text style={{ color: theme.attenue, fontSize: taille }}>
            Session {detail.session.slice(0, 8)} · depuis {ilYA(detail.debut, maintenant).replace('il y a ', '')} · {detail.demandes} demande(s), {detail.outils} outil(s)
            {detail.sousAgents ? `, ${detail.sousAgents} sous-agent(s)` : ''}{detail.echecs ? `, ${detail.echecs} échec(s)` : ''}
          </Text>
          <BoutonHub theme={theme} titre="Fermer" onPress={() => setChoisi(undefined)} testID="bureau-detail-fermer" />
        </View>
      ) : null}
    </View>
  );
}

function Interrupteur({ theme, libelle, aide, valeur, onChange, testID, desactive }: {
  theme: ThemeHub; libelle: string; aide?: string; valeur: boolean; onChange(v: boolean): void; testID: string; desactive?: boolean;
}) {
  const mobile = useMobile();
  const taille = mobile ? 15 : 14;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: valeur, disabled: desactive }}
      accessibilityLabel={libelle}
      disabled={desactive}
      onPress={() => onChange(!valeur)}
      style={[styles.interrupteur, desactive ? { opacity: 0.5 } : null]}
      testID={testID}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.texte, fontSize: taille }}>{libelle}</Text>
        {aide ? <Text style={{ color: theme.attenue, fontSize: taille, marginTop: 2 }}>{aide}</Text> : null}
      </View>
      {/* Simple témoin visuel : toute la ligne (44 px au moins) est l'interrupteur. */}
      <View pointerEvents="none" aria-hidden importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Switch value={valeur} disabled={desactive} />
      </View>
    </Pressable>
  );
}

/** Onglet « Bureau » complet : lecture de l'activité, visuel, état vide, copie chiffrée. */
export function OngletBureau({ theme, contexte, office, mouvementReduit, horloge }: {
  theme: ThemeHub; contexte: ContexteHub; office?: PontClaudeOffice; mouvementReduit?: boolean; horloge?: () => number;
}) {
  const mobile = useMobile();
  const taille = mobile ? 15 : 14;
  const pont = office?.historique;
  const service = contexte.historiqueOffice;
  const base = contexte.baseProfil;
  const activite = useActiviteBureau({ pont, service, base });
  const [maintenant, setMaintenant] = useState(() => (horloge ?? Date.now)());
  // Démo : sessions fictives (date de début), rien de réel n'est lu ni écrit.
  const [debutDemo, setDebutDemo] = useState<number>();
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
    setDebutDemo(active ? t : undefined);
  };
  const [synchro, setSynchro] = useState<EtatSynchroHistorique>(() => lireEtatSynchro(base));
  const [presence, setPresence] = useState<EtatPresence>(() => lireEtatPresence(base));
  const [etatHook, setEtatHook] = useState<EtatClaudeOffice['historique']>();
  const [message, setMessage] = useState<string>();
  const [occupe, setOccupe] = useState(false);

  useEffect(() => {
    if (!office || !pont) return;
    let vivant = true;
    office.etat().then(e => vivant && setEtatHook(e.historique)).catch(() => undefined);
    return () => void (vivant = false);
  }, [office, pont]);

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
      setMessage(r.annule ? 'Annulé : rien n’a été modifié.' : !r.ok ? r.erreur : r.ecrit ? 'Hook installé. Redémarrez Claude Code : ses sessions apparaîtront ici.' : 'Rien à faire : déjà installé.');
      const e = await office?.etat().catch(() => undefined);
      if (e) setEtatHook(e.historique);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setOccupe(false);
    }
  };

  const texte = { color: theme.texte, fontSize: taille, lineHeight: taille + 6, ...police(theme.policeTexte) };
  const attenue = { color: theme.attenue, fontSize: taille, lineHeight: taille + 6 };
  const dernierDepot = activite.source.genre === 'relais' ? activite.source.date : undefined;

  const vide = pont ? (
    <>
      <Text style={texte} testID="bureau-vide-texte">
        {etatHook === 'absents'
          ? 'Personne au bureau : le hook d’historique n’est pas encore installé sur ce PC, donc Claude Code n’y note rien.'
          : 'Personne au bureau pour l’instant. Lancez Claude Code sur ce PC : chaque session y apparaîtra avec son personnage, en quelques secondes.'}
      </Text>
      {etatHook === 'absents' ? (
        <BoutonHub theme={theme} variante="plein" titre="Installer le hook d’historique…" desactive={occupe} onPress={() => void installerHook()} testID="bureau-installer-hook" />
      ) : null}
    </>
  ) : (
    <>
      <Text style={texte} testID="bureau-vide-texte">
        {service
          ? dernierDepot
            ? 'Aucun agent dans le dernier dépôt reçu : Claude Code ne travaillait pas à ce moment-là.'
            : 'Aucune activité reçue pour l’instant. Rien à installer ici : ce bureau s’affiche dès qu’un PC équipé dépose sa copie chiffrée.'
          : 'Ce bureau lit la copie chiffrée déposée sur le relais par le PC où tourne Claude Code. Elle est réservée au compte principal relié au relais : connectez-vous avec lui pour la voir ici.'}
      </Text>
      <Text style={attenue}>
        1. Sur le PC où vous utilisez Claude Code : hook d’historique installé (bouton dans l’app PC, ou « npm run office:hooks »).{'\n'}
        2. Dans l’app PC, Claude Office › Bureau : activer « Déposer la copie chiffrée de ce PC ».{'\n'}
        3. Ici, rien à installer : le bureau se met à jour à chaque dépôt.
      </Text>
    </>
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
      />
      {activite.erreur ? <Text style={[attenue, { color: theme.critique }]} testID="bureau-erreur">{activite.erreur}</Text> : null}
      {message ? <Text style={texte} testID="bureau-message">{message}</Text> : null}

      {pont ? null : (
        <Text style={attenue} testID="bureau-delai">
          {service
            ? `Ici, pas de direct : l’état affiché est celui du dernier dépôt du PC${dernierDepot ? ` (${ilYA(dernierDepot, maintenant)})` : ''}. Le PC dépose au plus toutes les 15 min, ou toutes les 5 min pendant l’activité si sa « présence rapide » est activée. Relu ici chaque minute.`
            : 'Ici, pas de direct : le bureau ne peut que relire ce que le PC dépose sur le relais.'}
        </Text>
      )}

      {pont ? (
        <View style={[styles.carte, { backgroundColor: theme.surface, borderColor: theme.ligne, borderRadius: theme.rayonMoyen }]} testID="bureau-partage">
          <Text style={[styles.titreCarte, { color: theme.texte }]}>Voir ce bureau sur le site et le téléphone</Text>
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
              Pour le voir ailleurs, reliez le compte principal au relais (Paramètres › Synchronisation) : ce PC pourra alors déposer une copie chiffrée de son activité.
            </Text>
          )}
          {etatHook ? <Text style={attenue} testID="bureau-hook-etat">Hook d’historique : {LIBELLE_HOOK_HISTORIQUE[etatHook]}</Text> : null}
        </View>
      ) : null}

      <View style={[styles.avertissement, { borderColor: theme.alerte, backgroundColor: theme.surface, borderRadius: theme.rayonMoyen }]} testID="bureau-avertissement">
        <Text style={texte}>
          Ces bulles montrent ce que vous écrivez à Claude : traitez cet écran comme un document personnel. Les secrets reconnus sont masqués, pas forcément tous. Le hook reste nécessaire sur le PC où tourne Claude Code ; rien n’est à installer sur les appareils où vous regardez.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  colonne: { gap: 12 },
  entete: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  enteteDroite: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  pastille: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, flexShrink: 1 },
  compteurs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  compteur: { borderWidth: StyleSheet.hairlineWidth, paddingVertical: 8, paddingHorizontal: 12, paddingLeft: 16, minWidth: 104, flexGrow: 1, overflow: 'hidden' },
  filet: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  nombre: { fontSize: 22, fontWeight: '700' },
  piece: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', alignItems: 'center' },
  defilement: { alignSelf: 'stretch', width: '100%' },
  barreScene: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingBottom: 10, alignSelf: 'stretch' },
  legende: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 6 },
  puce: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rond: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  titreListe: { fontSize: 17, fontWeight: '700' },
  liste: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  agent: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 2, padding: 10, minHeight: 64, flexGrow: 1, flexBasis: 300, maxWidth: '100%' },
  avatar: { width: 40, height: 40, borderRadius: 20, borderWidth: 3, alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden' },
  avatarTete: { width: 20, height: 20, borderRadius: 10, borderTopWidth: 6, marginBottom: 6 },
  agentTexte: { flex: 1, gap: 2, minWidth: 0 },
  ligneEtat: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  vide: { borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 10 },
  carte: { borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 8 },
  titreCarte: { fontSize: 16, fontWeight: '700' },
  avertissement: { borderWidth: 1, padding: 12, gap: 6 },
  interrupteur: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
});
