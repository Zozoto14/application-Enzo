/**
 * Claude Office : panneau « Détail d'un agent » (toucher un personnage ou une
 * carte) — projet, depuis quand, état, ce qu'il attend ou ce qu'il a fini,
 * compteurs et chronologie de la session (demandes, outils avec leur durée,
 * réflexions, attentes, fin). « Marquer comme vu » (salle d'attente) et
 * « Voir dans l'Historique » (filtré sur la session).
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ThemeHub } from '../hub/themes';
import { FeuilleBasse } from '../ui/mobile/FeuilleBasse';
import { couleurAgent, ilYA, LIBELLES_ETAT, phraseAgent, type Agent } from './logiqueBureau';
import { dureeCourte, heure, type EntreeHistorique } from './logiqueHistorique';
import { chronologieSession, type GenreEtape } from './logiqueStats';
import { TEINTES_ACTIVITE } from './logiqueScene';
import { Bouton, TAILLE } from './uiOffice';
import { ZONES } from './zones';

const ICONES: Record<GenreEtape, [string, string]> = {
  debut: ['⌂', ZONES.accueil.teinte], demande: ['›', '#5B8CFF'], outil: ['⚙', TEINTES_ACTIVITE.outil], reflexion: ['…', TEINTES_ACTIVITE.pense],
  attente: ['!', TEINTES_ACTIVITE.attend], reponse: ['✓', TEINTES_ACTIVITE.fini], 'sous-agent': ['✦', TEINTES_ACTIVITE.agent], fin: ['■', ZONES.salle.teinte],
};

export function DetailAgent({ theme, agent, entrees, maintenant, onFermer, onVoirHistorique, onMarquerVu }: {
  theme: ThemeHub; agent?: Agent; entrees: readonly EntreeHistorique[]; maintenant: number; onFermer(): void;
  onVoirHistorique?(session: string): void; onMarquerVu?(cleFin: string): void;
}) {
  const chrono = useMemo(() => (agent ? chronologieSession(entrees, agent.cle) : undefined), [agent, entrees]);
  if (!agent || !chrono) return null;
  const t = { color: theme.texte, fontSize: TAILLE, lineHeight: 22 };
  const a = { color: theme.attenue, fontSize: TAILLE, lineHeight: 22 };
  const compteurs = [
    ['Demandes', chrono.demandes], ['Outils', chrono.outils], ['Temps d’outils', chrono.dureeOutilsMs ? dureeCourte(chrono.dureeOutilsMs) : '—'],
    ['Échecs', chrono.echecs], ['Attentes', chrono.attentes],
  ] as const;
  return (
    <FeuilleBasse
      theme={theme}
      visible
      titre={`${agent.projet ?? 'Projet inconnu'}${agent.appareil ? ` · ${agent.appareil}` : ''}`}
      description={`${ZONES[agent.zone].nom} · ${agent.salle && agent.fin ? `terminé ${ilYA(agent.fin, maintenant)}, à voir` : phraseAgent(agent, maintenant)}`}
      onFermer={onFermer}
      testID="bureau-detail"
      pied={(
        <View style={styles.boutons}>
          {agent.salle && agent.cleFin && onMarquerVu ? <Bouton theme={theme} variante="plein" couleur={ZONES.salle.teinte} titre="Marquer comme vu" onPress={() => onMarquerVu(agent.cleFin!)} testID="bureau-detail-vu" /> : null}
          {onVoirHistorique ? <Bouton theme={theme} titre="Voir dans l’Historique" onPress={() => onVoirHistorique(agent.session)} testID="bureau-detail-historique" /> : null}
        </View>
      )}
    >
      <Text style={a} testID="bureau-detail-depuis">
        Session {agent.session.slice(0, 8)} · ouverte {ilYA(agent.debut, maintenant)} ({new Date(agent.debut).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}) · {LIBELLES_ETAT[agent.etat]}{agent.fige ? ' (dernier état connu, copie ancienne)' : ''}
      </Text>
      {agent.etat === 'attend' ? (
        <View style={[styles.encart, { borderColor: TEINTES_ACTIVITE.attend }]} testID="bureau-detail-attente">
          <Text style={[t, { fontWeight: '700', color: TEINTES_ACTIVITE.attend }]}>✋ Claude attend ta réponse</Text>
          <Text selectable style={t}>{agent.attente ?? 'Une autorisation ou une question en attente.'}</Text>
          <Text style={a}>Réponds dans Claude Code, sur le PC : le personnage repartira travailler.</Text>
        </View>
      ) : null}
      {agent.salle && agent.recap ? (
        <View style={[styles.encart, { borderColor: ZONES.salle.teinte }]} testID="bureau-detail-recap">
          <Text style={[t, { fontWeight: '700', color: ZONES.salle.teinte }]}>✓ Terminé {agent.fin ? ilYA(agent.fin, maintenant) : ''} : ce qu’il a fini</Text>
          <Text selectable style={t}>{agent.recap}</Text>
        </View>
      ) : null}
      <View style={styles.compteurs}>
        {compteurs.map(([l, v]) => (
          <View key={l} style={[styles.compteur, { borderColor: theme.ligne }]}>
            <Text style={{ color: theme.texte, fontSize: 18, fontWeight: '700' }}>{v}</Text>
            <Text style={a}>{l}</Text>
          </View>
        ))}
      </View>
      <Text style={[t, { fontWeight: '700' }]} accessibilityRole="header">Chronologie de la session</Text>
      {chrono.masquees ? <Text style={a}>{chrono.masquees} étape(s) plus ancienne(s) : voir l’Historique.</Text> : null}
      {chrono.etapes.length === 0 ? <Text style={a}>Aucun événement de cette session dans les données lues ici.</Text> : null}
      <View testID="bureau-detail-chronologie" style={{ gap: 2 }}>
        {chrono.etapes.map(e => {
          const [icone, couleur] = ICONES[e.genre];
          return (
            <View key={e.id} style={styles.etape} accessibilityLabel={`${heure(new Date(e.ts).toISOString())} : ${e.titre}${e.detail ? `, ${e.detail}` : ''}${e.dureeMs !== undefined ? `, ${dureeCourte(e.dureeMs)}` : ''}${e.echec ? ', échec' : ''}`}>
              <Text style={[a, styles.heure]}>{new Date(e.ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</Text>
              <View style={[styles.icone, { backgroundColor: e.echec ? theme.critique : couleur }]} aria-hidden><Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '800' }}>{icone}</Text></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[t, { fontWeight: '600' }]}>
                  {e.titre}
                  {e.dureeMs !== undefined ? <Text style={a}>{` · ${dureeCourte(e.dureeMs)}`}</Text> : null}
                  {e.echec ? <Text style={{ color: theme.critique }}> · échec</Text> : null}
                </Text>
                {e.detail ? <Text style={a} numberOfLines={3}>{e.detail}</Text> : null}
              </View>
            </View>
          );
        })}
      </View>
      <View style={[styles.filet, { backgroundColor: couleurAgent(agent.projet ?? agent.cle) }]} />
    </FeuilleBasse>
  );
}

const styles = StyleSheet.create({
  boutons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  encart: { borderWidth: 1.5, borderRadius: 10, padding: 10, gap: 4 },
  compteurs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  compteur: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, minWidth: 92, flexGrow: 1 },
  etape: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingVertical: 4 },
  heure: { width: 50, fontVariant: ['tabular-nums'] },
  icone: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  filet: { height: 3, borderRadius: 2, opacity: 0.6 },
});
