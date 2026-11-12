/**
 * Barres de l'éditeur de strats (React Native : site, app PC, testables sans canevas), inspirées des outils de
 * plan tactique courants (ergonomie seulement : aucune donnée ni image tierce) :
 *  - `BarreAgents` : portraits des agents du jeu (images importées dans le profil, initiales sinon), filtre par
 *    rôle (Duellistes, Initiateurs, Contrôleurs, Sentinelles), camp des pions posés (alliés / ennemis) ;
 *  - `BarreCapacites` : les capacités de l'agent choisi (C, Q, E, X) avec leur icône ; un clic ARME la pose ;
 *  - `GrilleOutils` : outils de l'éditeur en grille, icônes monochromes de l'interface (src/ui/icones) ;
 *  - `BarreEtapes` : étapes 1 à N, lecture et curseur de temps ; « Supprimer tout / l'étape ».
 * Les icônes du jeu (portraits, capacités) sont des IMAGES ; celles de l'interface, des tracés monochromes.
 */

import React, { useState } from 'react';
import { Image, Pressable, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { police, teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { initiales, type AgentAsset, type CapaciteAsset } from '../../strats/assets';
import { trSt, type CleSt } from '../../i18n/strats2';
import { Glyphe } from '../../../ui/icones';

/** Portrait ou icône d'un asset du jeu, rond ; initiales sur fond neutre si l'image manque ou ne charge pas. */
export function IconeAsset({ theme, url, nom, couleur, taille = 30, testID }: { theme: ThemeHub; url: string | null | undefined; nom: string; couleur?: string; taille?: number; testID?: string }) {
  const [echec, setEchec] = useState(false);
  if (url && !echec)
    return <Image testID={testID ? `${testID}-image` : undefined} source={{ uri: url }} onError={() => setEchec(true)} style={{ width: taille, height: taille, borderRadius: taille / 2, backgroundColor: couleur ?? '#111827' }} accessibilityLabel={nom} />;
  return (
    <View testID={testID ? `${testID}-initiales` : undefined} style={{ width: taille, height: taille, borderRadius: taille / 2, backgroundColor: couleur ?? teinteTransparente(theme.attenue, 0.4), alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#ffffff', fontSize: taille * 0.38, fontWeight: '800' }}>{initiales(nom)}</Text>
    </View>
  );
}

/** Bouton carré d'au moins 40 px (cible tactile), état choisi visible. */
export function Pastille({ theme, actif, onPress, libelle, testID, children, couleur, desactive }: { theme: ThemeHub; actif: boolean; onPress(): void; libelle: string; testID: string; children: React.ReactNode; couleur?: string; desactive?: boolean }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={libelle}
      accessibilityState={{ selected: actif, disabled: desactive }}
      disabled={desactive}
      onPress={onPress}
      style={{
        minWidth: 40,
        minHeight: 40,
        paddingHorizontal: 6,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: Math.min(theme.rayonMoyen, 10),
        borderWidth: actif ? 2 : 1,
        borderColor: actif ? (couleur ?? theme.accent) : theme.ligne,
        backgroundColor: actif ? teinteTransparente(couleur ?? theme.accent, 0.22) : theme.surface,
        opacity: desactive ? 0.45 : 1,
      }}>
      {children}
    </Pressable>
  );
}

// ------------------------------------------------------------------ Agents

export const ROLES_AGENTS = ['duelliste', 'initiateur', 'controleur', 'sentinelle'] as const;
export type Camp = 'allie' | 'ennemi';
/** Couleur des pions et capacités ennemis. */
export const COULEUR_ENNEMI = '#ef4444';

/** Agents du rôle choisi (null : tous). */
export const agentsDuRole = (agents: AgentAsset[], role: string | null): AgentAsset[] => (role ? agents.filter(a => a.roleCle === role) : agents);

export function BarreAgents({
  theme,
  agents,
  agentCle,
  onAgent,
  role,
  onRole,
  camp,
  onCamp,
  libelle,
}: {
  theme: ThemeHub;
  agents: AgentAsset[];
  agentCle: string | undefined;
  onAgent(a: AgentAsset): void;
  role: string | null;
  onRole(r: string | null): void;
  camp: Camp;
  onCamp(c: Camp): void;
  /** Mot du jeu (« Agents », « Classes »…). */
  libelle?: string;
}) {
  const roles = ROLES_AGENTS.filter(r => agents.some(a => a.roleCle === r));
  const visibles = agentsDuRole(agents, role);
  const sansImages = agents.length > 0 && agents.every(a => !a.icone);
  const puce = (actif: boolean, texte: string, onPress: () => void, testID: string, couleur?: string) => (
    <Pressable
      key={testID}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: actif }}
      onPress={onPress}
      style={{ minHeight: 32, paddingHorizontal: 10, justifyContent: 'center', borderRadius: 16, borderWidth: 1, borderColor: actif ? (couleur ?? theme.accent) : theme.ligne, backgroundColor: actif ? teinteTransparente(couleur ?? theme.accent, 0.22) : 'transparent' }}>
      <Text style={{ color: theme.texte, fontSize: 12, fontWeight: actif ? '700' : '500', ...police(theme.policeTexte) }}>{texte}</Text>
    </Pressable>
  );
  return (
    <View style={{ gap: 6, borderWidth: 1, borderColor: theme.ligne, borderRadius: 10, padding: 8, backgroundColor: theme.surface }} testID="esport-barre-agents" accessibilityLabel={libelle ?? trSt('agents.barre')}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {roles.length > 1 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }} accessibilityLabel={trSt('agents.filtre')}>
            {puce(role === null, trSt('agents.role_tous'), () => onRole(null), 'esport-agents-role-tous')}
            {roles.map(r => puce(role === r, trSt(`agents.role.${r}` as CleSt), () => onRole(role === r ? null : r), `esport-agents-role-${r}`))}
          </View>
        ) : null}
        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: 'row', gap: 4 }} accessibilityLabel={trSt('agents.camp')}>
          {puce(camp === 'allie', trSt('agents.allie'), () => onCamp('allie'), 'esport-agents-camp-allie', '#22c55e')}
          {puce(camp === 'ennemi', trSt('agents.ennemi'), () => onCamp('ennemi'), 'esport-agents-camp-ennemi', COULEUR_ENNEMI)}
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {visibles.map(a => (
          <Pastille key={a.cle} theme={theme} actif={agentCle === a.cle} couleur={camp === 'ennemi' ? COULEUR_ENNEMI : undefined} onPress={() => onAgent(a)} libelle={trSt('agents.choisir', { nom: a.nom })} testID={`esport-agent-${a.cle}`}>
            <IconeAsset theme={theme} url={a.icone} nom={a.nom} taille={34} testID={`esport-agent-${a.cle}-portrait`} />
          </Pastille>
        ))}
      </View>
      {sansImages ? (
        <Text style={{ color: theme.attenue, fontSize: 11, ...police(theme.policeTexte) }} testID="esport-agents-sans-images">
          {trSt('agents.sans_images')}
        </Text>
      ) : null}
    </View>
  );
}

/** Ordre des capacités dans la barre (comme le jeu) : C, Q, E, X, puis les autres. */
const ORDRE_TOUCHES = ['C', 'Q', 'E', 'X'];
export const capacitesOrdonnees = (agent: AgentAsset): CapaciteAsset[] =>
  [...agent.capacites].sort((a, b) => {
    const ia = ORDRE_TOUCHES.indexOf(a.touche.toUpperCase());
    const ib = ORDRE_TOUCHES.indexOf(b.touche.toUpperCase());
    return (ia < 0 ? 9 : ia) - (ib < 0 ? 9 : ib);
  });

export function BarreCapacites({ theme, agent, capaciteCle, armee, onCapacite }: { theme: ThemeHub; agent: AgentAsset; capaciteCle: string | undefined; armee: boolean; onCapacite(c: CapaciteAsset): void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }} testID="esport-barre-capacites" accessibilityLabel={trSt('capacites.barre', { nom: agent.nom })}>
      <IconeAsset theme={theme} url={agent.icone} nom={agent.nom} taille={36} />
      {capacitesOrdonnees(agent).map(c => (
        <Pastille key={c.cle} theme={theme} actif={armee && capaciteCle === c.cle} onPress={() => onCapacite(c)} libelle={trSt('capacites.armer', { nom: c.nom, touche: c.touche })} testID={`esport-capacite-${c.cle}`}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 170, paddingVertical: 2 }}>
            <IconeAsset theme={theme} url={c.icone} nom={c.nom} taille={28} couleur="#1f2937" testID={`esport-capacite-${c.cle}-icone`} />
            <View style={{ minWidth: 0 }}>
              <Text style={{ color: theme.texte, fontSize: 12, fontWeight: '800' }}>{c.touche}</Text>
              <Text style={{ color: theme.attenue, fontSize: 10, maxWidth: 110 }} numberOfLines={1}>
                {c.nom}
              </Text>
            </View>
          </View>
        </Pastille>
      ))}
    </View>
  );
}

// ------------------------------------------------------------------ Outils

export interface OutilGrille {
  id: string;
  icone: string;
  libelle: string;
  raccourci?: string;
}

export function GrilleOutils({ theme, outils, actif, onOutil, colonnes = 4, testID = 'esport-editeur-outils' }: { theme: ThemeHub; outils: ReadonlyArray<OutilGrille>; actif: string; onOutil(id: string): void; colonnes?: number; testID?: string }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, maxWidth: colonnes * 48 }} accessibilityRole="toolbar" accessibilityLabel={trSt('gauche.outils')} testID={testID}>
      {outils.map(o => (
        <Pastille key={o.id} theme={theme} actif={actif === o.id} onPress={() => onOutil(o.id)} libelle={o.raccourci ? `${o.libelle} (${o.raccourci})` : o.libelle} testID={`esport-outil-${o.id}`}>
          <Glyphe valeur={o.icone} style={{ color: theme.texte, fontSize: 17 }} />
        </Pastille>
      ))}
    </View>
  );
}

// ------------------------------------------------------------------ Étapes

/** Curseur horizontal (temps dans l'étape) : toucher ou glisser sur la piste. */
export function Curseur({ theme, valeur, max, onChanger, libelle, testID }: { theme: ThemeHub; valeur: number; max: number; onChanger(v: number): void; libelle: string; testID: string }) {
  const [largeur, setLargeur] = useState(0);
  const depuis = (e: GestureResponderEvent) => {
    if (largeur <= 0) return;
    const x = Math.max(0, Math.min(largeur, e.nativeEvent.locationX));
    onChanger(Math.round((x / largeur) * max * 10) / 10);
  };
  const f = max > 0 ? Math.max(0, Math.min(1, valeur / max)) : 0;
  return (
    <View
      testID={testID}
      accessibilityRole="adjustable"
      accessibilityLabel={libelle}
      accessibilityValue={{ min: 0, max, now: valeur }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={e => onChanger(Math.max(0, Math.min(max, Math.round((valeur + (e.nativeEvent.actionName === 'increment' ? 0.5 : -0.5)) * 10) / 10)))}
      onLayout={(e: LayoutChangeEvent) => setLargeur(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={depuis}
      onResponderMove={depuis}
      style={{ height: 28, justifyContent: 'center', flex: 1, minWidth: 80 }}>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: teinteTransparente(theme.attenue, 0.3) }} pointerEvents="none">
        <View style={{ width: `${f * 100}%`, height: 6, borderRadius: 3, backgroundColor: theme.accent }} />
      </View>
      <View pointerEvents="none" style={{ position: 'absolute', left: `${f * 100}%`, marginLeft: -9, width: 18, height: 18, borderRadius: 9, backgroundColor: '#ffffff', borderWidth: 2, borderColor: theme.accent }} />
    </View>
  );
}

export function BarreEtapes({
  theme,
  n,
  etape,
  onEtape,
  onAjouter,
  peutAjouter,
  duree,
  temps,
  enLecture,
  onLire,
  onPause,
  onTemps,
  onSupprimerTout,
  onSupprimerEtape,
  modifiable,
}: {
  theme: ThemeHub;
  n: number;
  etape: number;
  onEtape(i: number): void;
  onAjouter(): void;
  peutAjouter: boolean;
  duree: number;
  temps: number | undefined;
  enLecture: boolean;
  onLire(): void;
  onPause(): void;
  onTemps(t: number): void;
  onSupprimerTout(): void;
  onSupprimerEtape(): void;
  modifiable: boolean;
}) {
  const attenue = { color: theme.attenue, fontSize: 11, ...police(theme.policeTexte) };
  return (
    <View style={{ gap: 6 }} testID="esport-barre-etapes">
      <Text style={attenue}>{trSt('gauche.etapes')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }} accessibilityRole="tablist">
        {Array.from({ length: n }, (_, i) => (
          <Pastille key={i} theme={theme} actif={i === etape} onPress={() => onEtape(i)} libelle={trSt('gauche.etape_n', { n: i + 1 })} testID={`esport-etape-num-${i}`}>
            <Text style={{ color: theme.texte, fontWeight: i === etape ? '800' : '500' }}>{i + 1}</Text>
          </Pastille>
        ))}
        {modifiable ? (
          <Pastille theme={theme} actif={false} desactive={!peutAjouter} onPress={onAjouter} libelle={trSt('gauche.ajouter_etape')} testID="esport-etape-num-ajouter">
            <Glyphe valeur="plus" style={{ color: theme.texte, fontSize: 16 }} />
          </Pastille>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pastille theme={theme} actif={enLecture} onPress={enLecture ? onPause : onLire} libelle={enLecture ? trSt('lecture.pause') : trSt('lecture.lire')} testID="esport-barre-lecture">
          <Glyphe valeur={enLecture ? 'pause' : 'lecture'} style={{ color: theme.texte, fontSize: 16 }} />
        </Pastille>
        <Curseur theme={theme} valeur={temps ?? 0} max={duree} onChanger={onTemps} libelle={trSt('gauche.curseur')} testID="esport-barre-curseur" />
        <Text style={attenue}>{`${(temps ?? 0).toFixed(1)} / ${duree} s`}</Text>
      </View>
      {modifiable ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Glyphe valeur="corbeille" style={{ color: theme.attenue, fontSize: 14 }} />
          <Text style={attenue}>{trSt('gauche.supprimer')}</Text>
          <Pressable testID="esport-supprimer-tout" accessibilityRole="button" accessibilityLabel={trSt('gauche.supprimer_tout_libelle')} onPress={onSupprimerTout} style={{ minHeight: 32, paddingHorizontal: 10, justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: theme.critique }}>
            <Text style={{ color: theme.critique, fontSize: 12, fontWeight: '700' }}>{trSt('gauche.supprimer_tout')}</Text>
          </Pressable>
          <Pressable testID="esport-supprimer-etape" accessibilityRole="button" accessibilityLabel={trSt('gauche.supprimer_etape_libelle')} onPress={onSupprimerEtape} style={{ minHeight: 32, paddingHorizontal: 10, justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: theme.critique }}>
            <Text style={{ color: theme.critique, fontSize: 12, fontWeight: '700' }}>{trSt('gauche.supprimer_etape')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
