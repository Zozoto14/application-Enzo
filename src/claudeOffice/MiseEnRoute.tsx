/**
 * Claude Office : la check-list « Mise en route » (état réel, mis à jour
 * seul) et l'aide « Comment lire le bureau » (légende des zones, des
 * pastilles et des états). Voir logiqueMiseEnRoute.ts.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ThemeHub } from '../hub/themes';
import { FeuilleBasse } from '../ui/mobile/FeuilleBasse';
import {
  bandeauReduit, ecrireMemoireMiseEnRoute, lireMemoireMiseEnRoute, pointsARegler, toutEstPret, type Etape, type GenreAction, type MemoireMiseEnRoute, type Niveau,
} from './logiqueMiseEnRoute';
import { ICONES_ACTIVITE, LIBELLES_ACTIVITE, TEINTES_ACTIVITE, type Activite } from './logiqueScene';
import { Bouton, Carte, Commande, TAILLE } from './uiOffice';
import { CORRESPONDANCE_OUTILS, ORDRE_ZONES, ZONES } from './zones';

const PICTO: Record<Niveau, string> = { ok: '✓', info: 'i', attention: '!', erreur: '✕' };

export function couleurNiveau(theme: ThemeHub, n: Niveau): string {
  return n === 'ok' ? theme.ok : n === 'erreur' ? theme.critique : n === 'attention' ? theme.alerte : theme.attenue;
}

export function MiseEnRoute({ theme, etapes, onAction, occupe }: { theme: ThemeHub; etapes: readonly Etape[]; onAction(g: GenreAction): void; occupe?: boolean }) {
  const pret = toutEstPret(etapes);
  const [memoire, setMemoire] = useState<MemoireMiseEnRoute | undefined>(lireMemoireMiseEnRoute);
  const reduit = bandeauReduit(etapes, memoire);
  const points = pointsARegler(etapes);
  const changer = (r: boolean) => {
    const m = { reduit: r, points };
    setMemoire(m);
    ecrireMemoireMiseEnRoute(m);
  };
  if (reduit) {
    const rouge = etapes.some(e => e.niveau === 'erreur');
    const couleur = pret ? theme.ok : rouge ? theme.critique : theme.alerte;
    const titre = pret ? '✓ Mise en route : tout est prêt' : `Mise en route · ${points.length} point${points.length > 1 ? 's' : ''} à régler`;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${titre}. Afficher le détail`}
        accessibilityState={{ expanded: false }}
        aria-expanded={false}
        onPress={() => changer(false)}
        style={[styles.reduite, { borderColor: pret ? theme.ligne : couleur, backgroundColor: theme.surface, borderRadius: theme.rayonMoyen }]}
        testID="mise-en-route-reduite"
      >
        <View style={styles.ligneReduite}>
          {pret ? null : <View style={[styles.rondNiveau, { backgroundColor: couleur }]} aria-hidden testID={`mise-en-route-reduite-${rouge ? 'rouge' : 'orange'}`} />}
          <Text style={{ color: pret ? theme.ok : theme.texte, fontSize: TAILLE, fontWeight: '700', flexShrink: 1 }}>{titre}</Text>
        </View>
        <Text style={{ color: theme.accent, fontSize: TAILLE, fontWeight: '600' }}>Afficher ▾</Text>
      </Pressable>
    );
  }
  return (
    <Carte theme={theme} testID="mise-en-route" bordure={pret ? undefined : theme.alerte}>
      <View style={styles.entete}>
        <Text accessibilityRole="header" style={{ color: theme.texte, fontSize: 17, fontWeight: '700', flex: 1 }}>Mise en route</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Réduire la mise en route"
          accessibilityState={{ expanded: true }}
          aria-expanded
          onPress={() => changer(true)}
          style={({ pressed }) => [styles.reduire, { borderColor: theme.ligne, opacity: pressed ? 0.7 : 1 }]}
          testID="mise-en-route-reduire"
        >
          <Text style={{ color: theme.accent, fontSize: TAILLE, fontWeight: '600' }}>Réduire ▴</Text>
        </Pressable>
      </View>
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
      <Text style={t}>Un personnage = une session de Claude Code. Il marche jusqu’à la zone de ce qu’il fait (fondu si les animations sont réduites) et y reste au moins 12 s.</Text>
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
      <Text style={t}><Text style={{ fontWeight: '700', color: TEINTES_ACTIVITE.attend }}>Main levée et « ! » rouge</Text> : Claude attend ta réponse (autorisation ou question) : réponds dans Claude Code.</Text>
      <Text style={t}><Text style={{ fontWeight: '700', color: ZONES.salle.teinte }}>Salle d’attente</Text> : tâche finie. Touche-le pour voir ce qu’il a fait, puis « Marquer comme vu » ; sinon il repart après le délai choisi.</Text>
      <Text style={titre} accessibilityRole="header">D’où viennent les informations</Text>
      <Text style={t}><Text style={{ fontWeight: '700' }}>● En direct</Text> : sur le PC de Claude Code, relu toutes les 2 s.</Text>
      <Text style={t}><Text style={{ fontWeight: '700' }}>◷ Copie chiffrée · il y a X min</Text> : ailleurs, la copie déposée par le PC (15 min, ou 5 avec la présence rapide) : l’état au moment du dépôt, pas du direct.</Text>
      <Text style={t}><Text style={{ fontWeight: '700' }}>Gris et « figé »</Text> : copie de plus de 10 min : dernier état connu.</Text>
      <Text style={a}>Les bulles montrent ce que tu écris à Claude ; les secrets reconnus sont masqués, pas forcément tous.</Text>
    </FeuilleBasse>
  );
}

const styles = StyleSheet.create({
  reduite: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, minHeight: 48 },
  ligneReduite: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  rondNiveau: { width: 14, height: 14, borderRadius: 7 },
  entete: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reduire: { minHeight: 44, minWidth: 44, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, justifyContent: 'center' },
  ligne: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  pastille: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  texte: { flex: 1, gap: 4, minWidth: 0 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 4 },
  legende: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 8 },
  puce: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rond: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
