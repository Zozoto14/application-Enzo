/**
 * Dock de l'atelier de strats (une ligne en bas, repliable) :
 *  - les JOUEURS en puces (anneau à leur couleur, portrait de leur agent, nom) : un appui choisit le joueur
 *    actif, un second ouvre sa fiche (nom, rôle, agent) ; en lecture ou en présentation, un appui met son rôle
 *    en avant ;
 *  - les CAPACITÉS de l'agent choisi (C, Q, E, X avec leurs icônes ; spécialisations, gadgets et armes pour
 *    The Finals) : un appui arme la pose, ou on la GLISSE sur la map ;
 *  - la bande des AGENTS (classes pour The Finals, pions pour un jeu générique) avec le camp (alliés /
 *    ennemis, équipes adverses 1 à 3) et le filtre par rôle : un appui choisit l'agent à poser, ou on glisse
 *    son portrait sur la map.
 * Le glisser vers la map est géré par l'écran web (Editeur.web.tsx) d'après les identifiants de test.
 */

import React, { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { teinteTransparente, type ThemeHub } from '../../../../hub/themes';
import { Glyphe } from '../../../../ui/icones';
import { trAt, type CleAt } from '../../../i18n/atelier';
import { trSt, type CleSt } from '../../../i18n/strats2';
import { sourcesIcone, trouverAgent, type AgentAsset, type CapaciteAsset } from '../../../strats/assets';
import { COULEURS_EQUIPES } from '../../../strats/modeles';
import { IconeAsset, ROLES_AGENTS, agentsDuRole, capacitesOrdonnees } from '../Barres';
import { Bascule, BoutonIcone, DIM, PuceTexte, Separateur, attenueAtelier, mesurer, texteAtelier, type Format } from './briques';
import { AGENT_INCONNU, COULEUR_ENNEMI, type Ancre, type Camp, type EtatAtelier } from './useAtelier';

type EtatPresse = { pressed: boolean; hovered?: boolean };

/** Catégories de capacités d'un personnage, dans l'ordre d'affichage (The Finals : spécialisations, gadgets, armes). */
export function categoriesDe(agent: AgentAsset): string[] {
  const ordre = ['specialisation', 'gadget', 'arme'];
  const vues = new Set(agent.capacites.map(c => c.donnees?.categorie).filter((c): c is NonNullable<typeof c> => Boolean(c)));
  return ordre.filter(c => vues.has(c as never));
}

/** Capacités affichées dans le dock : C, Q, E, X dans l'ordre du jeu ; ou celles de la catégorie choisie. */
export function capacitesDuDock(agent: AgentAsset, categorie: string | null): CapaciteAsset[] {
  const categories = categoriesDe(agent);
  if (categories.length < 2) return capacitesOrdonnees(agent);
  const choisie = categorie && categories.includes(categorie) ? categorie : categories[0];
  return agent.capacites.filter(c => c.donnees?.categorie === choisie);
}

function PuceJoueur({ theme, a, i, compact, onFiche }: { theme: ThemeHub; a: EtatAtelier; i: number; compact: boolean; onFiche(i: number, ancre: Ancre | undefined): void }) {
  const ref = useRef<React.ComponentRef<typeof Pressable>>(null);
  const doc = a.doc;
  if (!doc) return null;
  const j = doc.joueurs[i];
  const agent = j.agent ? trouverAgent(a.assets, j.agent) : undefined;
  const lecteur = !a.peutModifier || a.presentation || a.temps !== undefined;
  const actif = lecteur ? a.surligne === i : a.joueur === i && !a.couleurLibre && a.camp === 'allie';
  return (
    <Pressable
      ref={ref}
      testID={`esport-joueur-${i}`}
      accessibilityRole="button"
      accessibilityLabel={lecteur ? trAt('dock.mettre_en_avant', { nom: j.nom }) : trSt('joueurs.choisir', { nom: j.nom, n: i + 1 })}
      accessibilityState={{ selected: actif }}
      onPress={() => {
        if (lecteur) a.setSurligne(a.surligne === i ? null : i);
        else if (actif) mesurer(ref.current, ancre => onFiche(i, ancre));
        else a.choisirJoueur(i);
      }}
      style={(etat: EtatPresse) => ({
        height: 52,
        minWidth: compact ? 52 : 112,
        maxWidth: compact ? 62 : 150,
        paddingHorizontal: compact ? 4 : 8,
        flexDirection: compact ? 'column' : 'row',
        alignItems: 'center',
        justifyContent: compact ? 'center' : 'flex-start',
        gap: compact ? 1 : 8,
        borderRadius: 12,
        borderWidth: actif ? 2 : 1,
        borderColor: actif ? j.couleur : theme.ligne,
        backgroundColor: actif ? teinteTransparente(j.couleur, 0.2) : etat.hovered ? teinteTransparente(theme.attenue, 0.12) : theme.fond,
      })}>
      <View style={{ width: compact ? 30 : 36, height: compact ? 30 : 36, borderRadius: 18, borderWidth: 2.5, borderColor: j.couleur, alignItems: 'center', justifyContent: 'center' }}>
        <IconeAsset theme={theme} url={sourcesIcone(agent)} nom={agent?.nom ?? j.nom} taille={compact ? 23 : 29} couleur={sourcesIcone(agent).length ? undefined : teinteTransparente(j.couleur, 0.55)} testID={`esport-joueur-${i}-portrait`} />
      </View>
      {compact ? (
        <Text style={{ ...texteAtelier(theme, 10, actif), maxWidth: 54 }} numberOfLines={1}>
          {j.nom}
        </Text>
      ) : (
        <View style={{ flexShrink: 1, minWidth: 0 }}>
          <Text style={texteAtelier(theme, 12, true)} numberOfLines={1}>
            {j.nom}
          </Text>
          <Text style={attenueAtelier(theme, 10)} numberOfLines={1}>
            {[j.role, agent?.nom].filter(Boolean).join(' · ') || `${i + 1}`}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

function PuceCapacite({ theme, c, actif, couleur, onPress }: { theme: ThemeHub; c: CapaciteAsset; actif: boolean; couleur: string; onPress(): void }) {
  return (
    <Pressable
      testID={`esport-capacite-${c.cle}`}
      accessibilityRole="button"
      accessibilityLabel={trSt('capacites.armer', { nom: c.nom, touche: c.touche })}
      accessibilityState={{ selected: actif }}
      onPress={onPress}
      style={(etat: EtatPresse) => ({
        height: 52,
        width: 60,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        borderRadius: 12,
        borderWidth: actif ? 2 : 1,
        borderColor: actif ? couleur : theme.ligne,
        backgroundColor: actif ? teinteTransparente(couleur, 0.22) : etat.hovered ? teinteTransparente(theme.attenue, 0.12) : theme.fond,
      })}>
      <View>
        <IconeAsset theme={theme} url={sourcesIcone(c)} nom={c.nom} taille={28} couleur="#1f2937" testID={`esport-capacite-${c.cle}-icone`} />
        {c.touche ? (
          <View style={{ position: 'absolute', right: -9, top: -4, minWidth: 16, height: 16, paddingHorizontal: 3, borderRadius: 5, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.ligne, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: theme.texte, fontSize: 9, fontWeight: '800' }}>{c.touche}</Text>
          </View>
        ) : null}
      </View>
      <Text style={{ ...attenueAtelier(theme, 9), maxWidth: 54 }} numberOfLines={1}>
        {c.nom}
      </Text>
    </Pressable>
  );
}

function PortraitAgent({ theme, agent, actif, couleur, onPress, taille, onEchec }: { theme: ThemeHub; agent: AgentAsset; actif: boolean; couleur: string; onPress(): void; taille: number; onEchec?(): void }) {
  return (
    <Pressable
      testID={`esport-agent-${agent.cle}`}
      accessibilityRole="button"
      accessibilityLabel={trSt('agents.choisir', { nom: agent.nom })}
      accessibilityState={{ selected: actif }}
      onPress={onPress}
      style={(etat: EtatPresse) => ({ width: taille + 8, height: taille + 8, borderRadius: (taille + 8) / 2, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: actif ? couleur : etat.hovered ? theme.ligne : 'transparent', backgroundColor: actif ? teinteTransparente(couleur, 0.25) : 'transparent' })}>
      {agent.cle === AGENT_INCONNU.cle ? (
        <View style={{ width: taille, height: taille, borderRadius: taille / 2, backgroundColor: '#1f2937', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#ffffff', fontWeight: '800', fontSize: taille * 0.5 }}>?</Text>
        </View>
      ) : (
        <IconeAsset theme={theme} url={sourcesIcone(agent)} nom={agent.nom} taille={taille} testID={`esport-agent-${agent.cle}-portrait`} onEchec={onEchec} />
      )}
    </Pressable>
  );
}

export function Dock({ theme, a, format }: { theme: ThemeHub; a: EtatAtelier; format: Format }) {
  const [echecs, setEchecs] = useState<ReadonlySet<string>>(() => new Set());
  const doc = a.doc;
  if (!doc) return null;
  const compact = format !== 'bureau';
  const lecteur = !a.peutModifier || a.presentation;
  const roles = ROLES_AGENTS.filter(r => a.agents.some(x => x.roleCle === r));
  const visibles = agentsDuRole(a.agents, a.roleFiltre);
  const categories = categoriesDe(a.agent);
  const capacites = capacitesDuDock(a.agent, a.categorie);
  // Message seulement quand l'image importée ET le CDN officiel ont échoué pour tous les agents affichés.
  const sansImages = visibles.length > 1 && visibles.some(x => echecs.has(x.cle)) && visibles.every(x => echecs.has(x.cle) || sourcesIcone(x).length === 0);
  const fiche = (i: number, ancre: Ancre | undefined) => a.setPopover({ cle: `joueur:${i}`, ancre });
  const joueurs = doc.joueurs.map((_, i) => <PuceJoueur key={i} theme={theme} a={a} i={i} compact={compact} onFiche={fiche} />);

  if (a.prefs.dockReplie) {
    return (
      <View testID="esport-atelier-dock" style={{ height: 30, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, backgroundColor: theme.surface, borderTopWidth: 1, borderTopColor: theme.ligne }}>
        <BoutonIcone theme={theme} icone="chevron-haut" libelle={trAt('dock.deplier')} taille={26} bulle="aucune" onPress={() => a.setPrefs({ dockReplie: false })} testID="esport-dock-replier" />
        {doc.joueurs.map((j, i) => (
          <Pressable key={i} testID={`esport-joueur-${i}`} accessibilityRole="button" accessibilityLabel={trSt('joueurs.choisir', { nom: j.nom, n: i + 1 })} onPress={() => (lecteur ? a.setSurligne(a.surligne === i ? null : i) : a.choisirJoueur(i))} style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: j.couleur, borderWidth: 2, borderColor: (lecteur ? a.surligne === i : a.joueur === i) ? theme.texte : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#0b0f17', fontSize: 10, fontWeight: '800' }}>{i + 1}</Text>
          </Pressable>
        ))}
        <Text style={{ ...attenueAtelier(theme, 11), flex: 1 }} numberOfLines={1}>
          {a.joueur !== null && doc.joueurs[a.joueur] ? doc.joueurs[a.joueur].nom : ''}
        </Text>
      </View>
    );
  }

  const cat = a.categorie && categories.includes(a.categorie) ? a.categorie : categories[0];
  const choixCategorie =
    categories.length > 1 ? (
      <View style={{ gap: 2 }}>
        {categories.map(c => (
          <Pressable key={c} testID={`esport-dock-categorie-${c}`} accessibilityRole="button" accessibilityState={{ selected: cat === c }} onPress={() => a.setCategorie(c)} style={{ height: 16, paddingHorizontal: 6, borderRadius: 5, justifyContent: 'center', backgroundColor: cat === c ? teinteTransparente(theme.accent, 0.3) : 'transparent' }}>
            <Text style={texteAtelier(theme, 10, cat === c)}>{trAt(`dock.categorie.${c}` as CleAt)}</Text>
          </Pressable>
        ))}
      </View>
    ) : null;
  const pucesCapacites = capacites.map(c => <PuceCapacite key={c.cle} theme={theme} c={c} couleur={a.couleur} actif={a.outil === 'capacite' && a.capacite?.cle === c.cle} onPress={() => a.choisirCapacite(c)} />);
  const camp = (
    <View style={{ gap: 3, alignItems: 'flex-start' }}>
      <Bascule<Camp> theme={theme} libelle={trSt('agents.camp')} valeur={a.camp} options={[['allie', trSt('agents.allie')], ['ennemi', trSt('agents.ennemi')]] as const} onChoisir={a.setCamp} testID="esport-agents-camp" hauteur={24} />
      {a.camp === 'ennemi' && a.def.equipesAdverses > 1 ? (
        <View style={{ flexDirection: 'row', gap: 3 }} accessibilityLabel={trSt('marqueur.equipe')}>
          {Array.from({ length: a.def.equipesAdverses }, (_, i) => (
            <Pressable key={i} testID={`esport-agents-equipe-${i + 1}`} accessibilityRole="button" accessibilityLabel={trSt('marqueur.equipe_n', { n: i + 1 })} accessibilityState={{ selected: a.equipe === i + 1 }} onPress={() => a.setEquipe(i + 1)} style={{ width: 24, height: 20, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: COULEURS_EQUIPES[i], opacity: a.equipe === i + 1 ? 1 : 0.4 }}>
              <Text style={{ color: '#0b0f17', fontSize: 10, fontWeight: '800' }}>{`E${i + 1}`}</Text>
            </Pressable>
          ))}
        </View>
      ) : roles.length > 1 ? (
        <Pressable testID="esport-agents-role" accessibilityRole="button" accessibilityLabel={trSt('agents.filtre')} onPress={() => a.setRoleFiltre(a.roleFiltre === null ? roles[0] : (roles[roles.indexOf(a.roleFiltre as (typeof roles)[number]) + 1] ?? null))} style={{ height: 20, paddingHorizontal: 6, borderRadius: 6, flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: a.roleFiltre ? theme.accent : theme.ligne }}>
          <Glyphe valeur="membres" style={{ color: theme.attenue, fontSize: 10 }} />
          <Text style={texteAtelier(theme, 10, Boolean(a.roleFiltre))} numberOfLines={1}>
            {a.roleFiltre ? trSt(`agents.role.${a.roleFiltre}` as CleSt) : trSt('agents.role_tous')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
  const portraits = (
    <>
      {a.camp === 'ennemi' ? <PortraitAgent theme={theme} agent={AGENT_INCONNU} actif={a.agent.cle === AGENT_INCONNU.cle && a.outil === 'agent'} couleur={a.couleur} onPress={() => a.choisirAgent(AGENT_INCONNU)} taille={compact ? 32 : 36} /> : null}
      {visibles.map(x => (
        <PortraitAgent key={x.cle} theme={theme} agent={x} actif={a.agent.cle === x.cle} couleur={a.camp === 'ennemi' ? a.couleur || COULEUR_ENNEMI : a.couleur} onPress={() => a.choisirAgent(x)} taille={compact ? 32 : 36} onEchec={() => setEchecs(e => (e.has(x.cle) ? e : new Set(e).add(x.cle)))} />
      ))}
      {sansImages ? (
        <Text style={{ ...attenueAtelier(theme, 10), maxWidth: 220, marginLeft: 6 }} numberOfLines={2} testID="esport-agents-sans-images">
          {trSt('agents.sans_images')}
        </Text>
      ) : null}
    </>
  );
  const grille = <BoutonIcone theme={theme} icone="grille" libelle={trAt('dock.tous_les_agents', { quoi: a.libelleAgent })} bulle="haut" onAncre={ancre => a.setPopover({ cle: 'agents', ancre })} testID="esport-dock-grille" taille={32} />;
  const tous = lecteur && a.surligne !== null ? <PuceTexte theme={theme} texte={trAt('dock.tous')} actif={false} onPress={() => a.setSurligne(null)} testID="esport-dock-tous" /> : null;
  const replier = (
    <View style={{ paddingLeft: 4 }}>
      <BoutonIcone theme={theme} icone="chevron-bas" libelle={trAt('dock.replier')} taille={26} bulle="aucune" onPress={() => a.setPrefs({ dockReplie: true })} testID="esport-dock-replier" />
    </View>
  );
  const style = { height: DIM.dock, flexDirection: 'row' as const, alignItems: 'center' as const, backgroundColor: theme.surface, borderTopWidth: 1, borderTopColor: theme.ligne };

  // Tablette et téléphone : une seule bande qui défile (joueurs, capacités, agents).
  if (compact) {
    return (
      <View testID="esport-atelier-dock" style={style}>
        {replier}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center', gap: 6, paddingHorizontal: 6 }} testID="esport-dock-joueurs" accessibilityLabel={trSt('joueurs.titre', { n: doc.joueurs.length })}>
          {joueurs}
          {tous}
          {lecteur ? null : (
            <>
              {capacites.length ? <Separateur theme={theme} /> : null}
              {capacites.length ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} testID="esport-barre-capacites" accessibilityLabel={trSt('capacites.barre', { nom: a.agent.nom })}>
                  {choixCategorie}
                  {pucesCapacites}
                </View>
              ) : null}
              <Separateur theme={theme} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} testID="esport-barre-agents" accessibilityLabel={a.libelleAgent}>
                {camp}
                {portraits}
              </View>
            </>
          )}
        </ScrollView>
        {lecteur ? null : grille}
      </View>
    );
  }

  return (
    <View testID="esport-atelier-dock" style={style}>
      {replier}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: lecteur ? 1 : 0, flexShrink: 1 }} contentContainerStyle={{ alignItems: 'center', gap: 6, paddingHorizontal: 6 }} testID="esport-dock-joueurs" accessibilityLabel={trSt('joueurs.titre', { n: doc.joueurs.length })}>
        {joueurs}
        {tous}
      </ScrollView>
      {lecteur ? null : (
        <>
          {capacites.length ? (
            <>
              <Separateur theme={theme} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6, flexShrink: 1 }} testID="esport-barre-capacites" accessibilityLabel={trSt('capacites.barre', { nom: a.agent.nom })}>
                {choixCategorie}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxWidth: categories.length > 1 ? 330 : undefined, flexGrow: 0 }} contentContainerStyle={{ gap: 4, alignItems: 'center' }}>
                  {pucesCapacites}
                </ScrollView>
              </View>
            </>
          ) : null}
          <Separateur theme={theme} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6, flex: 1, minWidth: 120 }} testID="esport-barre-agents" accessibilityLabel={a.libelleAgent}>
            {camp}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ gap: 2, alignItems: 'center' }} testID="esport-dock-agents">
              {portraits}
            </ScrollView>
            {grille}
          </View>
        </>
      )}
    </View>
  );
}

/** Grille de tous les agents (bulle « Tous les agents ») : filtre par rôle, portraits. */
export function GrilleAgents({ theme, a, onChoisi }: { theme: ThemeHub; a: EtatAtelier; onChoisi(): void }) {
  const roles = ROLES_AGENTS.filter(r => a.agents.some(x => x.roleCle === r));
  return (
    <View style={{ gap: 8, padding: 6 }} testID="esport-grille-agents">
      {roles.length > 1 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }} accessibilityLabel={trSt('agents.filtre')}>
          <PuceTexte theme={theme} texte={trSt('agents.role_tous')} actif={a.roleFiltre === null} onPress={() => a.setRoleFiltre(null)} testID="esport-agents-role-tous" hauteur={26} />
          {roles.map(r => (
            <PuceTexte key={r} theme={theme} texte={trSt(`agents.role.${r}` as CleSt)} actif={a.roleFiltre === r} onPress={() => a.setRoleFiltre(a.roleFiltre === r ? null : r)} testID={`esport-agents-role-${r}`} hauteur={26} />
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {agentsDuRole(a.agents, a.roleFiltre).map(x => (
          <Pressable
            key={x.cle}
            testID={`esport-grille-agent-${x.cle}`}
            accessibilityRole="button"
            accessibilityLabel={trSt('agents.choisir', { nom: x.nom })}
            onPress={() => {
              a.choisirAgent(x);
              onChoisi();
            }}
            style={{ width: 64, alignItems: 'center', gap: 2, paddingVertical: 4, borderRadius: 10, borderWidth: 1, borderColor: a.agent.cle === x.cle ? theme.accent : 'transparent', backgroundColor: a.agent.cle === x.cle ? teinteTransparente(theme.accent, 0.18) : 'transparent' }}>
            <IconeAsset theme={theme} url={sourcesIcone(x)} nom={x.nom} taille={38} />
            <Text style={{ ...texteAtelier(theme, 10), maxWidth: 60 }} numberOfLines={1}>
              {x.nom}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
