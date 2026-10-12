/**
 * Claude Office : la check-list « Mise en route » (état réel, mis à jour
 * seul) et l'aide « Comment lire le bureau » (légende des zones, des
 * pastilles et des états). Voir logiqueMiseEnRoute.ts.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ThemeHub } from '../hub/themes';
import { FeuilleBasse } from '../ui/mobile/FeuilleBasse';
import { toutEstPret, type Etape, type GenreAction, type Niveau } from './logiqueMiseEnRoute';
import { ICONES_ACTIVITE, LIBELLES_ACTIVITE, TEINTES_ACTIVITE, type Activite } from './logiqueScene';
import { Bouton, Carte, Commande, TAILLE } from './uiOffice';
import { CORRESPONDANCE_OUTILS, ORDRE_ZONES, ZONES } from './zones';

const PICTO: Record<Niveau, string> = { ok: '✓', info: 'i', attention: '!', erreur: '✕' };

export function couleurNiveau(theme: ThemeHub, n: Niveau): string {
  return n === 'ok' ? theme.ok : n === 'erreur' ? theme.critique : n === 'attention' ? theme.alerte : theme.attenue;
}

export function MiseEnRoute({ theme, etapes, onAction, occupe }: { theme: ThemeHub; etapes: readonly Etape[]; onAction(g: GenreAction): void; occupe?: boolean }) {
  const pret = toutEstPret(etapes);
  const [ouvert, setOuvert] = useState(false);
  if (pret && !ouvert) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Mise en route : tout est prêt. Afficher le détail"
        onPress={() => setOuvert(true)}
        style={[styles.reduite, { borderColor: theme.ligne, backgroundColor: theme.surface, borderRadius: theme.rayonMoyen }]}
        testID="mise-en-route-reduite"
      >
        <Text style={{ color: theme.ok, fontSize: TAILLE, fontWeight: '700' }}>✓ Mise en route : tout est prêt</Text>
        <Text style={{ color: theme.accent, fontSize: TAILLE }}>Détails</Text>
      </Pressable>
    );
  }
  return (
    <Carte theme={theme} titre="Mise en route" testID="mise-en-route" bordure={pret ? undefined : theme.alerte}>
      {etapes.map(e => (
        <View key={e.id} style={styles.ligne} testID={`mise-en-route-${e.id}`} accessibilityLabel={`${e.titre}${e.detail ? `. ${e.detail}` : ''}`}>
          <View style={[styles.pastille, { backgroundColor: couleurNiveau(theme, e.niveau) }]} aria-hidden>
            <Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: 14 }}>{PICTO[e.niveau]}</Text>
          </View>
          <View style={styles.texte}>
            <Text style={{ color: theme.texte, fontSize: TAILLE, fontWeight: '600' }} testID={`mise-en-route-${e.id}-niveau-${e.niveau}`}>{e.titre}</Text>
            {e.detail ? <Text style={{ color: theme.attenue, fontSize: TAILLE, lineHeight: 21 }}>{e.detail}</Text> : null}
            {e.action || e.commande ? (
              <View style={styles.actions}>
                {e.action ? <Bouton theme={theme} variante={e.niveau === 'erreur' ? 'plein' : 'normal'} titre={e.action.titre} desactive={occupe} onPress={() => onAction(e.action!.genre)} testID={`mise-en-route-action-${e.id}`} /> : null}
                {e.commande ? <Commande theme={theme} commande={e.commande} testID={`mise-en-route-commande-${e.id}`} /> : null}
              </View>
            ) : null}
          </View>
        </View>
      ))}
      {pret ? <Bouton theme={theme} variante="discret" titre="Réduire" onPress={() => setOuvert(false)} testID="mise-en-route-reduire" /> : null}
    </Carte>
  );
}

const LEGENDE: readonly Activite[] = ['attend', 'code', 'terminal', 'recherche', 'lecture', 'web', 'agent', 'pense', 'pause', 'fini'];

/** « ? » : comment lire le bureau, en mots simples. */
export function Aide({ theme, visible, onFermer }: { theme: ThemeHub; visible: boolean; onFermer(): void }) {
  const t = { color: theme.texte, fontSize: TAILLE, lineHeight: 22 };
  const a = { color: theme.attenue, fontSize: TAILLE, lineHeight: 22 };
  const titre = { color: theme.texte, fontSize: 17, fontWeight: '700' as const, marginTop: 6 };
  return (
    <FeuilleBasse theme={theme} visible={visible} titre="Comment lire le bureau" onFermer={onFermer} testID="bureau-aide">
      <Text style={t}>Chaque personnage est une session de Claude Code. Il va dans la zone de ce qu’il fait en ce moment, en marchant (un simple fondu si les animations sont réduites). Il reste au moins une douzaine de secondes dans une zone, pour ne pas faire d’aller-retour à chaque outil.</Text>
      <Text style={titre} accessibilityRole="header">Les zones</Text>
      {ORDRE_ZONES.map(z => (
        <View key={z} style={styles.ligne}>
          <View style={[styles.pastille, { backgroundColor: ZONES[z].teinte }]} aria-hidden><Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 12 }}>{ZONES[z].icone.slice(0, 2)}</Text></View>
          <Text style={[t, styles.texte]}><Text style={{ fontWeight: '700' }}>{ZONES[z].nom}</Text> : {ZONES[z].role}.</Text>
        </View>
      ))}
      <Text style={a}>Outils → zone : {CORRESPONDANCE_OUTILS.map(c => `${c.exemples} → ${ZONES[c.zone].nom}`).join(' ; ')} ; tout autre outil → Atelier code.</Text>
      <Text style={titre} accessibilityRole="header">Les pastilles au-dessus des têtes</Text>
      <View style={styles.legende}>
        {LEGENDE.map(x => (
          <View key={x} style={styles.puce}>
            <View style={[styles.rond, { borderColor: TEINTES_ACTIVITE[x], backgroundColor: x === 'attend' ? TEINTES_ACTIVITE[x] : theme.surface }]} aria-hidden>
              <Text style={{ color: x === 'attend' ? '#FFFFFF' : TEINTES_ACTIVITE[x], fontSize: 12, fontWeight: '800' }}>{ICONES_ACTIVITE[x]}</Text>
            </View>
            <Text style={t}>{LIBELLES_ACTIVITE[x]}</Text>
          </View>
        ))}
      </View>
      <Text style={t}><Text style={{ fontWeight: '700', color: TEINTES_ACTIVITE.attend }}>Main levée et « ! » rouge</Text> : Claude attend ta réponse (une autorisation ou une question). Va dans Claude Code pour répondre ; le personnage repart travailler dès que c’est fait.</Text>
      <Text style={t}><Text style={{ fontWeight: '700', color: ZONES.salle.teinte }}>Salle d’attente</Text> : il vient de finir une tâche. Touche-le pour voir ce qu’il a fait, puis « Marquer comme vu » ; sinon il repart tout seul après le délai choisi (réglages du bureau).</Text>
      <Text style={titre} accessibilityRole="header">D’où viennent les informations</Text>
      <Text style={t}><Text style={{ fontWeight: '700' }}>● En direct</Text> : sur le PC où tourne Claude Code, le journal est relu toutes les 2 secondes.</Text>
      <Text style={t}><Text style={{ fontWeight: '700' }}>◷ Copie chiffrée · il y a X min</Text> : sur le site, le téléphone ou un autre PC, on relit la copie que le PC dépose (toutes les 15 min, ou 5 min avec la présence rapide). Ce n’est pas du direct : le bureau montre l’état au moment du dépôt.</Text>
      <Text style={t}><Text style={{ fontWeight: '700' }}>Gris et « figé »</Text> : la copie a plus de 10 minutes. Le personnage montre son dernier état connu, pas ce qu’il fait maintenant.</Text>
      <Text style={a}>Les bulles montrent ce que tu écris à Claude ; les secrets reconnus sont masqués, pas forcément tous.</Text>
    </FeuilleBasse>
  );
}

const styles = StyleSheet.create({
  reduite: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, minHeight: 48 },
  ligne: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  pastille: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  texte: { flex: 1, gap: 4, minWidth: 0 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 4 },
  legende: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 8 },
  puce: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rond: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
