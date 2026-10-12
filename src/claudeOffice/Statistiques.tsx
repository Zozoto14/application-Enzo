/**
 * Claude Office : onglet « Statistiques » — requêtes par jour (7 ou 30 j),
 * heures d'activité (jour × heure), outils les plus utilisés (avec leur durée
 * moyenne quand le hook la connaît), projets les plus actifs, durée moyenne
 * des sessions. Calculé SUR L'APPAREIL depuis l'historique : le journal sur
 * le PC, la copie chiffrée ailleurs. Graphiques en simples vues (aucune
 * dépendance), chacun résumé en une phrase pour les lecteurs d'écran.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { police, teinteTransparente, type ThemeHub } from '../hub/themes';
import type { ContexteHub } from '../hub/types';
import { dureeCourte, fusionner, libelleJour, type EntreeHistorique } from './logiqueHistorique';
import { calculerStatistiques, historiqueDemo } from './logiqueStats';
import { entreesDemo } from './logiqueScene';
import type { PontClaudeOffice } from './pont';
import { lireEtatSynchro } from './synchroHistorique';
import { Bouton, Carte, Segments, TAILLE } from './uiOffice';

const JOURS_SEMAINE = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const JOURS_LONGS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

interface Donnees {
  entrees: EntreeHistorique[];
  erreur?: string;
  lu: boolean;
}

/** Tout l'historique lisible ici : journal du PC (et copies des autres PC si la copie est active), ou copies du relais. */
function useHistoriqueComplet(office: PontClaudeOffice | undefined, contexte: ContexteHub, actif: boolean): Donnees & { relire(): void } {
  const pont = office?.historique;
  const service = contexte.historiqueOffice;
  const [d, setD] = useState<Donnees>({ entrees: [], lu: false });
  const relire = useCallback(() => {
    if (!actif) return;
    let vivant = true;
    void (async () => {
      const erreurs: string[] = [];
      let local: EntreeHistorique[] = [];
      let distant: EntreeHistorique[] = [];
      if (pont) {
        try {
          const r = await pont.lire();
          if (!r.ok) erreurs.push(`Journal illisible : ${r.erreur ?? 'erreur inconnue'}`);
          local = r.entrees ?? [];
        } catch (e) {
          erreurs.push(`Journal illisible : ${(e as Error).message}`);
        }
      }
      if (service && (!pont || lireEtatSynchro(contexte.baseProfil).active)) {
        try {
          const r = await service.lireTout();
          distant = r.entrees;
          if (r.erreurs.length) erreurs.push(`Relais : ${r.erreurs.join(' ; ')}`);
        } catch (e) {
          erreurs.push(`Relais injoignable : ${(e as Error).message}`);
        }
      }
      if (vivant) setD({ entrees: fusionner(local, distant), lu: true, ...(erreurs.length ? { erreur: erreurs.join('\n') } : {}) });
    })();
    return () => void (vivant = false);
  }, [actif, pont, service, contexte.baseProfil]);
  useEffect(() => relire(), [relire]);
  return { ...d, relire };
}

function Barres({ theme, valeurs, libelles, couleur, hauteur = 120, testID, resume }: {
  theme: ThemeHub; valeurs: number[]; libelles: string[]; couleur: string; hauteur?: number; testID: string; resume: string;
}) {
  const max = Math.max(1, ...valeurs);
  const repere = (i: number) => i === 0 || i === valeurs.length - 1 || (valeurs.length > 10 && i === Math.floor(valeurs.length / 2));
  return (
    <View accessible accessibilityLabel={resume} testID={testID}>
      <View style={[styles.barres, { height: hauteur, borderBottomColor: theme.ligne }]}>
        {valeurs.map((v, i) => (
          <View key={i} style={styles.colonneBarre}>
            {v && valeurs.length <= 10 ? <Text style={{ color: theme.attenue, fontSize: TAILLE, textAlign: 'center' }} aria-hidden>{v}</Text> : null}
            <View style={{ height: Math.max(v ? 3 : 0, (v / max) * (hauteur - (valeurs.length > 10 ? 4 : 24))), backgroundColor: couleur, borderTopLeftRadius: 4, borderTopRightRadius: 4 }} />
          </View>
        ))}
      </View>
      <View style={styles.axe} aria-hidden>
        {libelles.map((l, i) => (
          <Text key={i} style={{ flex: 1, color: theme.attenue, fontSize: TAILLE, textAlign: i === 0 ? 'left' : i === libelles.length - 1 ? 'right' : 'center' }} numberOfLines={1}>{repere(i) ? l : ''}</Text>
        ))}
      </View>
    </View>
  );
}

function Classement({ theme, lignes, couleur, testID }: { theme: ThemeHub; lignes: Array<{ nom: string; valeur: number; note?: string }>; couleur: string; testID: string }) {
  const max = Math.max(1, ...lignes.map(l => l.valeur));
  return (
    <View style={{ gap: 8 }} testID={testID}>
      {lignes.map(l => (
        <View key={l.nom} accessible accessibilityLabel={`${l.nom} : ${l.valeur}${l.note ? `, ${l.note}` : ''}`} style={{ gap: 4 }}>
          <View style={styles.ligneClassement}>
            <Text style={{ color: theme.texte, fontSize: TAILLE, fontWeight: '600', flex: 1 }} numberOfLines={1}>{l.nom}</Text>
            <Text style={{ color: theme.attenue, fontSize: TAILLE }}>{l.valeur}{l.note ? ` · ${l.note}` : ''}</Text>
          </View>
          <View style={[styles.piste, { backgroundColor: teinteTransparente(couleur, 0.15) }]}>
            <View style={{ width: `${(l.valeur / max) * 100}%`, height: '100%', backgroundColor: couleur, borderRadius: 4 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function Statistiques({ theme, contexte, office, debutDemo, horloge }: { theme: ThemeHub; contexte: ContexteHub; office?: PontClaudeOffice; debutDemo?: number; horloge?: () => number }) {
  const demo = debutDemo !== undefined;
  const reel = useHistoriqueComplet(office, contexte, !demo);
  const [jours, setJours] = useState<'7' | '30'>('7');
  const maintenant = (horloge ?? Date.now)();
  const minute = Math.floor(maintenant / 60_000);
  const entrees = useMemo(
    () => (demo ? fusionner(historiqueDemo(maintenant), entreesDemo(debutDemo!, maintenant)) : reel.entrees),
    [demo, debutDemo, reel.entrees, minute], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const s = useMemo(() => calculerStatistiques(entrees, maintenant, jours === '7' ? 7 : 30), [entrees, jours, minute]); // eslint-disable-line react-hooks/exhaustive-deps
  const accent = theme.accent.startsWith('#') ? theme.accent : '#5B8CFF';
  const attenue = { color: theme.attenue, fontSize: TAILLE, lineHeight: 22 };
  const texte = { color: theme.texte, fontSize: TAILLE, lineHeight: 22, ...police(theme.policeTexte) };

  if (!demo && !reel.lu) return <Text style={attenue} testID="stats-chargement">Lecture de l’historique…</Text>;

  const jourMax = s.parJour.reduce((m, j) => (j.demandes > m.demandes ? j : m), s.parJour[0]);
  let caseMax = { j: 0, h: 0 };
  s.chaleur.forEach((ligne, j) => ligne.forEach((v, h) => { if (v > s.chaleur[caseMax.j][caseMax.h]) caseMax = { j, h }; }));
  const libelleCourt = (jour: string) => {
    const [, mois, j] = jour.split('-');
    return `${Number(j)}/${Number(mois)}`;
  };

  return (
    <View style={styles.colonne} testID="stats">
      {demo ? <Text style={[texte, { color: theme.sombre ? '#F4A261' : '#9A4A12', fontWeight: '700' }]} testID="stats-demo">◆ Démo : 30 jours d’historique fictif</Text> : null}
      <View style={styles.entete}>
        <Segments theme={theme} libelle="Période" valeurs={[['7', '7 jours'], ['30', '30 jours']] as const} valeur={jours} onChange={v => setJours(v)} testID="stats-periode" />
        {!demo ? <Bouton theme={theme} titre="Actualiser" onPress={reel.relire} testID="stats-actualiser" /> : null}
      </View>
      <Text style={attenue}>Calculé sur cet appareil à partir de {office?.historique ? 'du journal de ce PC' : 'la copie chiffrée reçue du PC'}{demo ? ' (ici : données fictives)' : ''} ; rien n’est envoyé.</Text>
      {!demo && reel.erreur ? (
        <Carte theme={theme} bordure={theme.critique} testID="stats-erreur">
          <Text style={[texte, { color: theme.critique }]}>{reel.erreur}</Text>
          <Bouton theme={theme} titre="Réessayer" onPress={reel.relire} testID="stats-reessayer" />
        </Carte>
      ) : null}

      {s.totalDemandes + s.totalOutils === 0 ? (
        <Carte theme={theme} testID="stats-vide">
          <Text style={texte}>Aucune activité sur les {s.jours} derniers jours.</Text>
          <Text style={attenue}>
            {office?.historique ? 'Elles viennent du journal de ce PC : voir Bureau › Mise en route.' : 'Elles viennent de la copie chiffrée du PC : voir Bureau › Mise en route.'}
          </Text>
        </Carte>
      ) : (
        <>
          <View style={styles.kpis}>
            {[
              ['Demandes', String(s.totalDemandes), 'demandes'],
              ['Sessions', String(s.sessions), 'sessions'],
              ['Durée moyenne d’une session', s.dureeMoyenneSessionMs ? dureeCourte(s.dureeMoyenneSessionMs) : '—', 'duree'],
              ['Temps actif', dureeCourte(s.actifMs), 'actif'],
            ].map(([l, v, id]) => (
              <View key={id} style={[styles.kpi, { borderColor: theme.ligne, backgroundColor: theme.surface, borderRadius: theme.rayonMoyen }]} accessible accessibilityLabel={`${l} : ${v}`}>
                <Text style={[{ color: theme.texte, fontSize: 22, fontWeight: '700' }, police(theme.policeChiffres)]} testID={`stats-kpi-${id}`}>{v}</Text>
                <Text style={attenue}>{l}</Text>
              </View>
            ))}
          </View>
          <Carte theme={theme} titre="Requêtes par jour" testID="stats-jours">
            <Barres
              theme={theme}
              valeurs={s.parJour.map(j => j.demandes)}
              libelles={s.parJour.map(j => libelleCourt(j.jour))}
              couleur={accent}
              testID="stats-barres"
              resume={`Requêtes par jour sur ${s.jours} jours : ${s.totalDemandes} au total ; jour le plus actif : ${libelleJour(jourMax.jour, maintenant)} avec ${jourMax.demandes}.`}
            />
            <Text style={attenue}>Jour le plus actif : {libelleJour(jourMax.jour, maintenant).toLowerCase()} ({jourMax.demandes} demande{jourMax.demandes > 1 ? 's' : ''}).</Text>
          </Carte>
          <Carte theme={theme} titre="Heures d’activité" testID="stats-chaleur">
            <View accessible accessibilityLabel={s.maxChaleur ? `Carte de chaleur jour par heure ; moment le plus actif : ${JOURS_LONGS[caseMax.j]} vers ${caseMax.h} h.` : 'Aucune activité.'}>
              {s.chaleur.map((ligne, j) => (
                <View key={j} style={styles.ligneChaleur}>
                  <Text style={[attenue, styles.jourChaleur]} aria-hidden>{JOURS_SEMAINE[j]}</Text>
                  {ligne.map((v, h) => (
                    <View key={h} style={[styles.case, { backgroundColor: v ? teinteTransparente(accent, 0.15 + 0.85 * (v / Math.max(1, s.maxChaleur))) : teinteTransparente(theme.sombre ? '#FFFFFF' : '#000000', 0.05) }]} />
                  ))}
                </View>
              ))}
              <View style={styles.ligneChaleur} aria-hidden>
                <Text style={[attenue, styles.jourChaleur]}> </Text>
                {[0, 6, 12, 18].map(h => <Text key={h} style={[attenue, { flex: 6 }]}>{h} h</Text>)}
              </View>
            </View>
            {s.maxChaleur ? <Text style={attenue}>Moment le plus actif : {JOURS_LONGS[caseMax.j]} vers {caseMax.h} h.</Text> : null}
          </Carte>
          <Carte theme={theme} titre="Outils les plus utilisés" testID="stats-outils">
            <Classement theme={theme} couleur="#E07A3A" testID="stats-outils-liste" lignes={s.outils.map(o => ({ nom: o.nom, valeur: o.n, ...(o.dureeMoyMs !== undefined ? { note: `${dureeCourte(o.dureeMoyMs)} en moyenne` } : {}) }))} />
          </Carte>
          <Carte theme={theme} titre="Projets les plus actifs" testID="stats-projets">
            <Classement theme={theme} couleur="#3FB37F" testID="stats-projets-liste" lignes={s.projets.map(p => ({ nom: p.nom, valeur: p.demandes, note: `${p.sessions} session${p.sessions > 1 ? 's' : ''}` }))} />
          </Carte>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  colonne: { gap: 12 },
  entete: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kpi: { borderWidth: StyleSheet.hairlineWidth, padding: 12, minWidth: 150, flexGrow: 1, flexBasis: 150 },
  barres: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, borderBottomWidth: 1 },
  colonneBarre: { flex: 1, justifyContent: 'flex-end' },
  axe: { flexDirection: 'row', marginTop: 4 },
  ligneChaleur: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 2 },
  jourChaleur: { width: 40 },
  case: { flex: 1, height: 18, borderRadius: 3 },
  ligneClassement: { flexDirection: 'row', gap: 8, alignItems: 'baseline' },
  piste: { height: 10, borderRadius: 5, overflow: 'hidden' },
});
