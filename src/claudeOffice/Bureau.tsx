/**
 * Claude Office, onglet « Bureau » : le bureau des agents dessiné DANS le hub
 * (vues React Native, aucun sprite ni serveur), sur le PC, le site et le
 * téléphone. Un personnage par session de Claude Code, animé selon l'état
 * déduit des derniers événements (écrit / outil / réfléchit / inactif /
 * terminé), avec la dernière demande résumée dans sa bulle.
 *
 * Sur le PC : journal local relu toutes les 2 s (« en direct »). Ailleurs :
 * copie chiffrée du relais, avec son âge (« à jour il y a X min ») et l'état
 * calculé à la date du dépôt — jamais présenté comme du direct.
 * Animations coupées si le système demande de réduire les animations.
 * Voir docs/claude-office.md.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { BoutonHub } from '../hub/Hub';
import { police, type ThemeHub } from '../hub/themes';
import type { ContexteHub } from '../hub/types';
import { useMobile } from '../ui/mobile/useMobile';
import { useActiviteBureau, type ActiviteBureau } from './activiteBureau';
import {
  LIBELLES_ETAT, compterBureau, couleurAgent, deduireBureau, estActif, ilYA, libelleFraicheur, phraseAgent, resumerTexte, type Agent, type EtatAgent,
} from './logiqueBureau';
import { LIBELLE_HOOK_HISTORIQUE, type EtatClaudeOffice, type PontClaudeOffice } from './pont';
import {
  DELAI_MIN_PRESENCE_MS, MAX_PRESENCES_JOUR, ecrireEtatPresence, ecrireEtatSynchro, lireEtatPresence, lireEtatSynchro, type EtatPresence, type EtatSynchroHistorique,
} from './synchroHistorique';

const NATIF = Platform.OS !== 'web';

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

/** Boucle d'animation 0 → 1 → 0, arrêtée si `actif` est faux. */
function useBoucle(actif: boolean, duree: number, aller = true): Animated.Value {
  const valeur = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!actif) {
      valeur.setValue(0);
      return undefined;
    }
    const sequence = aller
      ? Animated.sequence([
        Animated.timing(valeur, { toValue: 1, duration: duree / 2, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIF }),
        Animated.timing(valeur, { toValue: 0, duration: duree / 2, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIF }),
      ])
      : Animated.timing(valeur, { toValue: 1, duration: duree, easing: Easing.linear, useNativeDriver: NATIF });
    const boucle = Animated.loop(sequence);
    boucle.start();
    return () => boucle.stop();
  }, [actif, duree, aller, valeur]);
  return valeur;
}

interface Couleurs {
  sol: string;
  mur: string;
  plinthe: string;
  bureau: string;
  bureauOmbre: string;
  ecran: string;
  ecranAllume: string;
  code: string;
  peau: string;
  cheveux: string;
  chaise: string;
  bulle: string;
  bulleTexte: string;
}

function couleursScene(theme: ThemeHub): Couleurs {
  return theme.sombre
    ? {
      sol: '#1E2433', mur: '#262E40', plinthe: '#151A26', bureau: '#8A6A48', bureauOmbre: '#5E4732', ecran: '#0D1018', ecranAllume: '#16243A',
      code: '#6FE3A5', peau: '#E8B996', cheveux: '#3B2A20', chaise: '#3A4258', bulle: '#F4F6FA', bulleTexte: '#151A26',
    }
    : {
      sol: '#E9E3D6', mur: '#F6F1E6', plinthe: '#CFC6B4', bureau: '#B98A5A', bureauOmbre: '#8C6640', ecran: '#2A2F3A', ecranAllume: '#1E3352',
      code: '#7CF0B4', peau: '#E7B48F', cheveux: '#4A3426', chaise: '#7D8597', bulle: '#FFFFFF', bulleTexte: '#1A1D24',
    };
}

const ICONES_ETAT: Record<EtatAgent, string> = { ecrit: '</>', outil: '⚙', reflechit: '…', inactif: 'z', termine: '✓' };

/** Un poste de travail : bureau, écran, chaise et personnage, animés selon l'état. */
function Poste({ agent, theme, couleurs, anime, maintenant, selectionne, onPress, largeur, mobile }: {
  agent: Agent; theme: ThemeHub; couleurs: Couleurs; anime: boolean; maintenant: number; selectionne: boolean; onPress(): void; largeur: number; mobile: boolean;
}) {
  const vivant = anime && !agent.fige;
  const etat = agent.etat;
  const frappe = useBoucle(vivant && etat === 'ecrit', 360);
  const rotation = useBoucle(vivant && etat === 'outil', 1600, false);
  const pensee = useBoucle(vivant && etat === 'reflechit', 1400);
  const sommeil = useBoucle(vivant && etat === 'inactif', 2600);
  const teinte = couleurAgent(agent.projet ?? agent.cle);
  const present = etat !== 'termine';
  const texteBulle = agent.demande ?? (etat === 'termine' ? 'Session terminée' : 'Pas encore de demande');
  const taille = mobile ? 15 : 14;
  const libelleAcces = `${agent.projet ?? 'Projet inconnu'}${agent.appareil ? `, ${agent.appareil}` : ''} : ${phraseAgent(agent, maintenant)}. Dernière demande : ${agent.demande ?? 'aucune'}`;
  const bras = frappe.interpolate({ inputRange: [0, 1], outputRange: [0, -3] });
  const tourne = rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const opacitePensee = pensee.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });
  const montee = sommeil.interpolate({ inputRange: [0, 1], outputRange: [0, -8] });

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={libelleAcces}
      accessibilityState={{ selected: selectionne }}
      testID={`bureau-agent-${agent.session.slice(0, 12)}`}
      style={[styles.poste, { width: largeur, borderColor: selectionne ? theme.accent : 'transparent' }]}
    >
      {/* Bulle : dernière demande résumée. */}
      <View style={[styles.bulle, { backgroundColor: couleurs.bulle, borderColor: teinte }]}>
        <Text numberOfLines={3} style={{ color: couleurs.bulleTexte, fontSize: taille, lineHeight: taille + 5 }} testID="bureau-bulle">
          {texteBulle}
        </Text>
        <View style={[styles.queueBulle, { borderTopColor: teinte }]} />
      </View>

      {/* Scène : icône d'état, personnage, bureau, écran. */}
      <View style={styles.scene} aria-hidden importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <View style={styles.iconeEtat}>
          {etat === 'outil' ? (
            <Animated.Text style={[styles.icone, { color: teinte, transform: [{ rotate: tourne }] }]}>{ICONES_ETAT.outil}</Animated.Text>
          ) : etat === 'reflechit' ? (
            <Animated.Text style={[styles.icone, { color: theme.attenue, opacity: opacitePensee }]}>{ICONES_ETAT.reflechit}</Animated.Text>
          ) : etat === 'inactif' ? (
            <Animated.Text style={[styles.icone, { color: theme.attenue, transform: [{ translateY: montee }] }]}>z<Text style={{ fontSize: 12 }}>z</Text></Animated.Text>
          ) : (
            <Text style={[styles.icone, { color: etat === 'termine' ? theme.ok : teinte }]}>{ICONES_ETAT[etat]}</Text>
          )}
        </View>
        {/* Chaise (derrière). */}
        <View style={[styles.dossier, { backgroundColor: couleurs.chaise }]} />
        {present ? (
          <View style={[styles.personnage, agent.fige ? { opacity: 0.55 } : null]}>
            <View style={[styles.cheveux, { backgroundColor: couleurs.cheveux }]} />
            <View style={[styles.tete, { backgroundColor: couleurs.peau }]}>
              <View style={[styles.oeil, { left: 5, backgroundColor: couleurs.cheveux, height: etat === 'inactif' ? 1 : 3 }]} />
              <View style={[styles.oeil, { right: 5, backgroundColor: couleurs.cheveux, height: etat === 'inactif' ? 1 : 3 }]} />
            </View>
            <View style={[styles.corps, { backgroundColor: teinte }]} />
            <Animated.View style={[styles.bras, { backgroundColor: teinte, transform: [{ translateY: bras }] }]} />
          </View>
        ) : null}
        {/* Bureau et écran. */}
        <View style={[styles.ecran, { backgroundColor: estActif(etat) && !agent.fige ? couleurs.ecranAllume : couleurs.ecran }]}>
          {etat === 'ecrit' ? (
            <>
              <View style={[styles.ligneCode, { width: 22, backgroundColor: couleurs.code }]} />
              <View style={[styles.ligneCode, { width: 14, marginLeft: 4, backgroundColor: couleurs.code }]} />
              <View style={[styles.ligneCode, { width: 18, backgroundColor: couleurs.code }]} />
            </>
          ) : etat === 'outil' ? (
            <View style={[styles.ligneCode, { width: 26, backgroundColor: teinte }]} />
          ) : null}
        </View>
        <View style={[styles.pied, { backgroundColor: couleurs.ecran }]} />
        <View style={[styles.plateau, { backgroundColor: couleurs.bureau, borderBottomColor: couleurs.bureauOmbre }]} />
        {etat === 'inactif' && present ? <View style={[styles.tasse, { borderColor: theme.attenue }]} /> : null}
      </View>

      {/* Étiquette lisible. */}
      <Text numberOfLines={1} style={[styles.nomPoste, { color: theme.texte, fontSize: taille }]}>
        {agent.projet ?? 'Projet inconnu'}
      </Text>
      <Text numberOfLines={2} style={{ color: estActif(agent.etat) && !agent.fige ? teinte : theme.attenue, fontSize: taille, textAlign: 'center', lineHeight: taille + 4 }} testID="bureau-etat-agent">
        {agent.fige ? `${LIBELLES_ETAT[etat]} (figé)` : LIBELLES_ETAT[etat]}
      </Text>
    </Pressable>
  );
}

/** Bureau vide : un poste sans personne. */
function BureauVide({ couleurs }: { couleurs: Couleurs }) {
  return (
    <View style={[styles.scene, { alignSelf: 'center' }]} aria-hidden importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <View style={[styles.dossier, { backgroundColor: couleurs.chaise }]} />
      <View style={[styles.ecran, { backgroundColor: couleurs.ecran }]} />
      <View style={[styles.pied, { backgroundColor: couleurs.ecran }]} />
      <View style={[styles.plateau, { backgroundColor: couleurs.bureau, borderBottomColor: couleurs.bureauOmbre }]} />
    </View>
  );
}

export interface PropsBureauVisuel {
  theme: ThemeHub;
  activite: Pick<ActiviteBureau, 'entrees' | 'references' | 'source' | 'lu'>;
  maintenant: number;
  /** Forcer « réduire les animations » (tests) ; sinon la préférence du système. */
  mouvementReduit?: boolean;
  /** Message de l'état vide, propre à la plateforme. */
  vide?: React.ReactNode;
}

/** Le dessin du bureau (sans chargement) : agents, compteurs, fraîcheur. */
export function BureauVisuel({ theme, activite, maintenant, mouvementReduit, vide }: PropsBureauVisuel) {
  const mobile = useMobile();
  const reduit = useMouvementReduit(mouvementReduit);
  const couleurs = couleursScene(theme);
  const [choisi, setChoisi] = useState<string>();
  const bureau = useMemo(
    () => deduireBureau(activite.entrees, { maintenant, references: activite.references }),
    [activite.entrees, activite.references, maintenant],
  );
  const compteurs = useMemo(() => compterBureau(bureau, activite.entrees, maintenant), [bureau, activite.entrees, maintenant]);
  const detail = bureau.agents.find(a => a.cle === choisi);
  const taille = mobile ? 15 : 14;
  const enDirect = activite.source.genre === 'local';
  const largeurPoste = mobile ? 158 : 184;
  const fraicheur = libelleFraicheur(activite.source, maintenant);

  return (
    <View style={styles.colonne} testID="bureau-visuel" accessibilityLabel={`Bureau de Claude Office : ${compteurs.actifs} agent(s) au travail`}>
      <View style={styles.entete}>
        <View style={[styles.pastille, { borderColor: enDirect ? theme.ok : theme.ligne, backgroundColor: theme.surface }]} testID="bureau-fraicheur">
          <Text style={{ color: enDirect ? theme.ok : theme.attenue, fontSize: taille, fontWeight: '600' }}>{enDirect ? '● ' : '◷ '}{fraicheur}</Text>
        </View>
        <Text style={{ color: theme.attenue, fontSize: taille }} testID="bureau-mouvement">{reduit ? 'Animations réduites' : ''}</Text>
      </View>

      <View style={styles.compteurs} testID="bureau-compteurs">
        {([
          ['actifs', 'Au travail', compteurs.actifs],
          ['inactifs', 'Inactifs', compteurs.inactifs],
          ['termines', 'Terminés', compteurs.termines],
          ['demandes', 'Demandes du jour', compteurs.demandesDuJour],
          ['outils', 'Outils du jour', compteurs.outilsDuJour],
        ] as const).map(([id, libelle, valeur]) => (
          <View key={id} style={[styles.compteur, { borderColor: theme.ligne, borderRadius: theme.rayonMoyen, backgroundColor: theme.surface }]}>
            <Text style={[styles.nombre, { color: theme.texte }, police(theme.policeChiffres)]} testID={`bureau-compte-${id}`}>{valeur}</Text>
            <Text style={{ color: theme.attenue, fontSize: taille }}>{libelle}</Text>
          </View>
        ))}
      </View>

      <View style={[styles.piece, { backgroundColor: couleurs.sol, borderColor: theme.ligne, borderRadius: theme.rayonMoyen }]} testID={reduit ? 'bureau-piece-fixe' : 'bureau-piece-animee'}>
        <View style={[styles.mur, { backgroundColor: couleurs.mur, borderBottomColor: couleurs.plinthe }]}>
          <View style={[styles.fenetre, { borderColor: couleurs.plinthe, backgroundColor: theme.sombre ? '#22324F' : '#CFE6F7' }]} />
          <View style={[styles.plante, { backgroundColor: '#4E9A6A' }]} />
        </View>
        {bureau.agents.length === 0 ? (
          <View style={styles.vide} testID="bureau-vide">
            {activite.lu ? <BureauVide couleurs={couleurs} /> : null}
            <View style={styles.texteVide}>
              {activite.lu ? vide : <Text style={{ color: theme.attenue, fontSize: taille }}>Lecture de l’activité…</Text>}
              {activite.lu && bureau.derniereActivite ? (
                <Text style={{ color: theme.attenue, fontSize: taille }} testID="bureau-derniere-activite">
                  Dernière activité connue : {ilYA(bureau.derniereActivite, maintenant)}.
                </Text>
              ) : null}
            </View>
          </View>
        ) : (
          <View style={styles.postes} testID="bureau-postes">
            {bureau.agents.map(a => (
              <Poste
                key={a.cle}
                agent={a}
                theme={theme}
                couleurs={couleurs}
                anime={!reduit}
                maintenant={maintenant}
                selectionne={a.cle === choisi}
                onPress={() => setChoisi(c => (c === a.cle ? undefined : a.cle))}
                largeur={largeurPoste}
                mobile={mobile}
              />
            ))}
          </View>
        )}
        {bureau.enPlus || bureau.expirees ? (
          <Text style={{ color: theme.attenue, fontSize: taille, padding: 10 }} testID="bureau-en-plus">
            {[bureau.enPlus ? `+${bureau.enPlus} autre(s) agent(s) non dessiné(s)` : '', bureau.expirees ? `${bureau.expirees} session(s) sans activité depuis plus de 3 h, rangée(s)` : ''].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
      </View>

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
  // L'âge des états change sans nouvel événement : on recalcule toutes les 5 s.
  useEffect(() => {
    const t = setInterval(() => setMaintenant((horloge ?? Date.now)()), 5_000);
    return () => clearInterval(t);
  }, [horloge]);
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
      <BureauVisuel theme={theme} activite={activite} maintenant={maintenant} mouvementReduit={mouvementReduit} vide={vide} />
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
  pastille: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, flexShrink: 1 },
  compteurs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  compteur: { borderWidth: StyleSheet.hairlineWidth, paddingVertical: 6, paddingHorizontal: 10, minWidth: 96, flexGrow: 1 },
  nombre: { fontSize: 20, fontWeight: '700' },
  piece: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  mur: { height: 44, borderBottomWidth: 4, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 18 },
  fenetre: { width: 70, height: 30, borderWidth: 3, borderBottomWidth: 0, marginBottom: 0 },
  plante: { width: 16, height: 22, borderTopLeftRadius: 8, borderTopRightRadius: 8 },
  postes: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, padding: 10 },
  poste: { alignItems: 'center', paddingVertical: 8, paddingHorizontal: 6, borderWidth: 2, borderRadius: 10, minHeight: 44, gap: 4 },
  bulle: { borderWidth: 2, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6, alignSelf: 'stretch', minHeight: 48 },
  queueBulle: {
    position: 'absolute', bottom: -9, left: '50%', marginLeft: -7, width: 0, height: 0,
    borderLeftWidth: 7, borderRightWidth: 7, borderTopWidth: 8, borderLeftColor: 'transparent', borderRightColor: 'transparent',
  },
  scene: { width: 120, height: 104, marginTop: 6 },
  iconeEtat: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', height: 24 },
  icone: { fontSize: 18, fontWeight: '700' },
  dossier: { position: 'absolute', left: 42, top: 34, width: 36, height: 34, borderRadius: 6 },
  personnage: { position: 'absolute', left: 44, top: 22, width: 32, alignItems: 'center' },
  cheveux: { width: 24, height: 7, borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  tete: { width: 22, height: 18, borderBottomLeftRadius: 4, borderBottomRightRadius: 4 },
  oeil: { position: 'absolute', top: 6, width: 3 },
  corps: { width: 30, height: 22, borderTopLeftRadius: 8, borderTopRightRadius: 8, marginTop: 1 },
  bras: { position: 'absolute', top: 46, width: 38, height: 6, borderRadius: 3 },
  ecran: { position: 'absolute', left: 74, top: 44, width: 36, height: 26, borderRadius: 3, padding: 4, gap: 3 },
  ligneCode: { height: 3, borderRadius: 1 },
  pied: { position: 'absolute', left: 89, top: 70, width: 6, height: 6 },
  plateau: { position: 'absolute', left: 8, right: 8, top: 76, height: 12, borderBottomWidth: 6, borderRadius: 2 },
  tasse: { position: 'absolute', left: 22, top: 66, width: 9, height: 10, borderWidth: 2, borderTopWidth: 0, borderBottomLeftRadius: 3, borderBottomRightRadius: 3 },
  nomPoste: { fontWeight: '700', maxWidth: '100%' },
  vide: { padding: 16, gap: 12, alignItems: 'stretch' },
  texteVide: { gap: 8 },
  carte: { borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 8 },
  titreCarte: { fontSize: 16, fontWeight: '700' },
  avertissement: { borderWidth: 1, padding: 12, gap: 6 },
  interrupteur: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
});
