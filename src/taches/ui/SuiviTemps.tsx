/**
 * Tâches (V2) : suivi du temps dans l'interface — section « Temps » du
 * détail (minuteur, saisie, estimation contre réel, entrées), pastille du
 * minuteur en cours dans l'en-tête, saisie manuelle, relevé hebdomadaire par
 * projet ou étiquette et export CSV ; section « Liens » (app d'origine,
 * sessions de Claude Code liées, qui ouvrent l'Historique filtré).
 */

import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { teinteTransparente } from '../../hub/themes';
import { ajouterJours, debutSemaine, jourLisible, lireDateLibre } from '../dates';
import { NOMS_APPS } from '../integrations/commun';
import { estTerminee, type Tache } from '../modele';
import { ajouterTemps, chronoLisible, chronoDe, dureeLisible, exporterTempsCsv, lireDuree, releveHebdo, supprimerTemps, tempsPasse, tempsVivants, type AxeReleve } from '../temps';
import type { Actions } from './actions';
import { attenueDe, Bouton, Champ, Dialogue, Libelle, Puce, texteDe } from './atomes';

/** Secondes qui défilent (seul l'affichage bouge : rien n'est écrit). */
export function useSecondes(actif: boolean): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    if (!actif) return undefined;
    const i = setInterval(() => setT(Date.now()), 1000);
    return () => clearInterval(i);
  }, [actif]);
  return t;
}

// ------------------------------------------------------------------ Section « Temps » du détail

export function SectionTemps({ a, t, onSaisir, onErreur }: { a: Actions; t: Tache; onSaisir(): void; onErreur(e: unknown): void }) {
  const theme = a.theme;
  const m = a.droits(t.projetId).modifier;
  const debut = chronoDe(t, a.etat.moi);
  const maintenant = useSecondes(Boolean(debut));
  const passe = tempsPasse(t);
  const [estimation, setEstimation] = useState(t.estimation ? dureeLisible(t.estimation) : '');
  useEffect(() => setEstimation(t.estimation ? dureeLisible(t.estimation) : ''), [t.id, t.estimation]);
  const entrees = tempsVivants(t).reverse();
  const ratio = t.estimation ? passe / t.estimation : 0;
  const validerEstimation = () => {
    const v = estimation.trim() ? lireDuree(estimation) : undefined;
    if (estimation.trim() && !v) {
      onErreur(new Error('Estimation non comprise (ex. 2h, 45 min, 1h30).'));
      return;
    }
    if (v !== t.estimation) a.changer(t.id, { estimation: v });
  };
  return (
    <View style={styles.section} testID="detail-temps">
      <Libelle theme={theme}>{`TEMPS${passe ? ` · ${dureeLisible(passe)}` : ''}${t.estimation ? ` sur ${dureeLisible(t.estimation)} estimées` : ''}`}</Libelle>
      {m ? (
        <View style={styles.rangee}>
          <Bouton
            theme={theme}
            variante={debut ? 'danger' : 'plein'}
            titre={debut ? `■ Arrêter · ${chronoLisible(maintenant - Date.parse(debut))}` : '▶ Démarrer le minuteur'}
            onPress={() => a.minuteur(t)}
            testID="detail-minuteur"
          />
          <Bouton theme={theme} titre="＋ Saisir du temps" onPress={onSaisir} testID="detail-temps-saisir" />
        </View>
      ) : null}
      {t.estimation ? (
        <View style={[styles.barre, { backgroundColor: theme.ligne }]} accessibilityLabel={`${dureeLisible(passe)} passées sur ${dureeLisible(t.estimation)} estimées`} testID="detail-temps-barre">
          <View style={{ width: `${Math.min(100, Math.round(ratio * 100))}%`, height: '100%', borderRadius: 4, backgroundColor: ratio > 1 ? theme.critique : ratio > 0.8 ? theme.alerte : theme.ok }} />
        </View>
      ) : null}
      {m ? (
        <View style={[styles.rangee, { flexWrap: 'nowrap' }]}>
          <Text style={[attenueDe(theme), { width: 112 }]}>Estimation</Text>
          <Champ theme={theme} mobile={a.mobile} value={estimation} onChangeText={setEstimation} onBlur={validerEstimation} onSubmitEditing={validerEstimation} placeholder="ex. 2h, 45 min" style={{ flex: 1 }} testID="detail-estimation" accessibilityLabel="Estimation du temps" />
        </View>
      ) : null}
      {entrees.slice(0, 8).map(e => (
        <View key={e.id} style={styles.rangee} testID={`temps-${e.id}`}>
          <Text style={[texteDe(theme), { fontWeight: '700', minWidth: 64 }]}>{dureeLisible(e.minutes)}</Text>
          <Text style={[attenueDe(theme), { flex: 1 }]} numberOfLines={2}>
            {jourLisible(e.jour, a.etat.aujourdhui)} · {a.etat.noms[e.auteur]}
            {e.debut ? ' · minuteur' : ' · saisie'}
            {e.note ? ` · ${e.note}` : ''}
          </Text>
          {m && (e.auteur === a.etat.role || a.etat.role === 'fondateur') ? (
            <Bouton theme={theme} compact variante="discret" titre="✕" libelle={`Retirer ${dureeLisible(e.minutes)}`} onPress={() => a.etat.maj((x, ctx) => supprimerTemps(x, t.id, e.id, ctx))} />
          ) : null}
        </View>
      ))}
      {entrees.length > 8 ? <Text style={attenueDe(theme)}>… et {entrees.length - 8} autre(s) (relevé hebdomadaire).</Text> : null}
      {!entrees.length && !debut ? <Text style={attenueDe(theme)}>Aucun temps noté.</Text> : null}
    </View>
  );
}

// ------------------------------------------------------------------ Section « Liens » du détail

export function SectionLiens({ a, t, onOuvrirSession, onOuvrirApp }: { a: Actions; t: Tache; onOuvrirSession(session: string): void; onOuvrirApp?(app: string): void }) {
  const theme = a.theme;
  if (a.etat.role !== 'fondateur' || (!t.source && !t.liensOffice?.length)) return null;
  const idApp = t.source ? ({ prospects: 'prospects', abonnements: 'abonnements', portefeuille: 'portefeuille', office: 'claude-office' } as const)[t.source.app] : undefined;
  return (
    <View style={styles.section} testID="detail-liens">
      <Libelle theme={theme}>LIENS</Libelle>
      {t.source ? (
        <View style={styles.rangee}>
          <Text style={[texteDe(theme), { flex: 1 }]}>Créée par {NOMS_APPS[t.source.app]} (sans doublon ; jamais montrée à l’ami)</Text>
          {onOuvrirApp && idApp && idApp !== 'portefeuille' ? <Bouton theme={theme} compact titre={`Ouvrir ${NOMS_APPS[t.source.app]}`} onPress={() => onOuvrirApp(idApp)} testID="detail-ouvrir-app" /> : null}
        </View>
      ) : null}
      {t.liensOffice?.length ? (
        <>
          <Text style={attenueDe(theme)}>Sessions de Claude Code liées (l’Historique s’ouvre filtré) :</Text>
          {t.liensOffice.map((l, i) => (
            <Pressable
              key={`${l.session}-${l.sousAgent ?? ''}-${i}`}
              accessibilityRole="link"
              accessibilityLabel={`Ouvrir la session ${l.projet ?? l.session.slice(0, 8)} dans l’Historique de Claude Office`}
              onPress={() => onOuvrirSession(l.session)}
              style={({ pressed }) => [styles.lien, { borderColor: theme.ligne, backgroundColor: pressed ? theme.ligne : 'transparent', borderRadius: 10 }]}
              testID={`detail-session-${i}`}>
              <Text style={{ color: theme.accent, fontSize: 17 }}>{l.sousAgent ? '✦' : '◆'}</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[texteDe(theme), { color: theme.accent, fontWeight: '600' }]} numberOfLines={1}>
                  {l.projet ?? 'Session'} · {l.session.slice(0, 8)}
                  {l.sousAgent ? ' · sous-agent' : ''}
                </Text>
                {l.libelle ? (
                  <Text style={attenueDe(theme)} numberOfLines={2}>
                    {l.libelle}
                  </Text>
                ) : null}
                <Text style={attenueDe(theme)}>{l.finVue ? `A fini le ${new Date(l.finVue).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'En attente de sa fin'}</Text>
              </View>
            </Pressable>
          ))}
        </>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ Pastille du minuteur (en-tête)

export function PastilleMinuteur({ a, t, debut, onOuvrir }: { a: Actions; t: Tache; debut: number; onOuvrir(): void }) {
  const theme = a.theme;
  const maintenant = useSecondes(true);
  return (
    <View style={[styles.pastille, { borderColor: theme.critique, backgroundColor: teinteTransparente(theme.critique, 0.1), borderRadius: Math.min(theme.rayonMoyen, 12) }]} testID="taches-minuteur">
      <Pressable accessibilityRole="button" accessibilityLabel={`Minuteur en cours sur « ${t.titre} » : ouvrir la tâche`} onPress={onOuvrir} style={styles.pastilleTexte}>
        <Text style={[texteDe(theme), { fontWeight: '700', fontVariant: ['tabular-nums'] }]}>⏱ {chronoLisible(maintenant - debut)}</Text>
        <Text style={[attenueDe(theme), { flexShrink: 1 }]} numberOfLines={1}>
          {t.titre}
        </Text>
      </Pressable>
      <Bouton theme={theme} compact variante="danger" titre="■" libelle="Arrêter le minuteur" onPress={() => a.minuteur(t)} testID="taches-minuteur-arreter" />
    </View>
  );
}

// ------------------------------------------------------------------ Saisie manuelle

export function DialogueTemps({ a, t, onFermer, onErreur }: { a: Actions; t: Tache; onFermer(): void; onErreur(e: unknown): void }) {
  const theme = a.theme;
  const [duree, setDuree] = useState('');
  const [jour, setJour] = useState('aujourd’hui');
  const [note, setNote] = useState('');
  const minutes = lireDuree(duree);
  const jourLu = lireDateLibre(jour, a.etat.aujourdhui) ?? (jour.trim() === 'hier' ? { jour: ajouterJours(a.etat.aujourdhui, -1) } : undefined);
  const valider = () => {
    try {
      if (!minutes || !jourLu) return;
      a.etat.maj((x, ctx) => ajouterTemps(x, t.id, { jour: jourLu.jour, minutes, note }, ctx));
      onFermer();
    } catch (e) {
      onErreur(e);
    }
  };
  return (
    <Dialogue
      theme={theme}
      mobile={a.mobile}
      visible
      titre="Saisir du temps"
      description={`Sur « ${t.titre} ». Écrivez « 45 min », « 1h30 », « 2 h ».`}
      onFermer={onFermer}
      testID="dialogue-temps"
      pied={<Bouton theme={theme} variante="plein" titre="Ajouter" desactive={!minutes || !jourLu} onPress={valider} testID="temps-valider" />}>
      <Libelle theme={theme}>DURÉE</Libelle>
      <Champ theme={theme} mobile={a.mobile} value={duree} onChangeText={setDuree} onSubmitEditing={valider} autoFocus={!a.mobile} placeholder="ex. 1h30" testID="temps-duree" accessibilityLabel="Durée" />
      <Text style={[attenueDe(theme), { color: duree && !minutes ? theme.critique : theme.attenue }]}>{minutes ? `→ ${dureeLisible(minutes)}` : duree ? 'Durée non comprise' : ' '}</Text>
      <Libelle theme={theme}>JOUR</Libelle>
      <Champ theme={theme} mobile={a.mobile} value={jour} onChangeText={setJour} placeholder="aujourd’hui, hier, 12/10" testID="temps-jour" accessibilityLabel="Jour" />
      <Text style={attenueDe(theme)}>{jourLu ? `→ ${jourLisible(jourLu.jour, a.etat.aujourdhui, true)}` : 'Jour non compris'}</Text>
      <Libelle theme={theme}>NOTE (FACULTATIVE)</Libelle>
      <Champ theme={theme} mobile={a.mobile} value={note} onChangeText={setNote} placeholder="ex. réunion client" testID="temps-note" accessibilityLabel="Note" />
    </Dialogue>
  );
}

// ------------------------------------------------------------------ Relevé hebdomadaire

const JOURS_COURTS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];

export function DialogueReleve({ a, onFermer, onExporter, onOuvrir }: { a: Actions; onFermer(): void; onExporter(nom: string, csv: string): void; onOuvrir(id: string): void }) {
  const theme = a.theme;
  const [debut, setDebut] = useState(() => debutSemaine(a.etat.aujourdhui));
  const [axe, setAxe] = useState<AxeReleve>('projet');
  const [moi, setMoi] = useState(false);
  const r = releveHebdo(a.etat.donnees, debut, axe, moi ? a.etat.role : undefined);
  const fin = ajouterJours(debut, 6);
  const fr = (j: string) => j.split('-').reverse().slice(0, 2).join('/');
  const largeur = a.mobile ? 40 : 56;
  return (
    <Dialogue
      theme={theme}
      mobile={a.mobile}
      visible
      large
      titre="Relevé du temps"
      description={`Semaine du ${fr(debut)} au ${fr(fin)} · total ${dureeLisible(r.total)}`}
      onFermer={onFermer}
      testID="dialogue-releve"
      pied={<Bouton theme={theme} variante="plein" titre="Exporter en CSV" onPress={() => onExporter(`temps-${debut}-${fin}.csv`, exporterTempsCsv(a.etat.donnees, debut, fin, a.etat.noms))} testID="releve-exporter" />}>
      <View style={styles.rangee}>
        <Bouton theme={theme} compact titre="‹ Semaine précédente" onPress={() => setDebut(ajouterJours(debut, -7))} testID="releve-precedente" />
        <Bouton theme={theme} compact titre="Cette semaine" onPress={() => setDebut(debutSemaine(a.etat.aujourdhui))} />
        <Bouton theme={theme} compact titre="Suivante ›" onPress={() => setDebut(ajouterJours(debut, 7))} testID="releve-suivante" />
      </View>
      <View style={styles.rangee}>
        <Puce theme={theme} grand={a.mobile} texte="Par projet" couleur={theme.accent} actif={axe === 'projet'} onPress={() => setAxe('projet')} testID="releve-axe-projet" />
        <Puce theme={theme} grand={a.mobile} texte="Par étiquette" couleur={theme.accent} actif={axe === 'etiquette'} onPress={() => setAxe('etiquette')} testID="releve-axe-etiquette" />
        <Puce theme={theme} grand={a.mobile} texte={moi ? 'Mon temps' : 'Tout le monde'} couleur={theme.teintes.admin} actif={moi} onPress={() => setMoi(x => !x)} testID="releve-qui" />
      </View>
      {r.lignes.length === 0 ? (
        <Text style={attenueDe(theme)} testID="releve-vide">
          Aucun temps noté cette semaine. Lancez le minuteur ▶ dans le détail d’une tâche, ou saisissez du temps.
        </Text>
      ) : (
        <ScrollView horizontal contentContainerStyle={{ flexGrow: 1 }}>
          <View testID="releve-tableau">
            <View style={[styles.ligneTableau, { borderColor: theme.ligne }]}>
              <Text style={[attenueDe(theme), styles.colNom]}>{axe === 'projet' ? 'Projet' : 'Étiquette'}</Text>
              {r.jours.map((j, i) => (
                <Text key={j} style={[attenueDe(theme), { width: largeur, textAlign: 'right' }]}>
                  {JOURS_COURTS[i]}
                </Text>
              ))}
              <Text style={[attenueDe(theme), { width: 72, textAlign: 'right', fontWeight: '700' }]}>Total</Text>
            </View>
            {r.lignes.map(l => (
              <View key={l.cle} style={[styles.ligneTableau, { borderColor: theme.ligne }]} testID={`releve-ligne-${l.cle}`}>
                <View style={[styles.colNom, styles.rangee, { flexWrap: 'nowrap' }]}>
                  {l.couleur ? <View style={[styles.point, { backgroundColor: l.couleur }]} /> : null}
                  <Text style={texteDe(theme)} numberOfLines={1}>
                    {l.libelle}
                  </Text>
                </View>
                {l.jours.map((m, i) => (
                  <Text key={i} style={[texteDe(theme), { width: largeur, textAlign: 'right', color: m ? theme.texte : theme.attenue }]}>
                    {m ? (m < 60 ? `${m}′` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`) : '·'}
                  </Text>
                ))}
                <Text style={[texteDe(theme), { width: 72, textAlign: 'right', fontWeight: '700' }]}>{dureeLisible(l.total)}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
      {r.estimations.length ? (
        <>
          <Libelle theme={theme}>ESTIMÉ CONTRE RÉEL (TOUT LE TEMPS PASSÉ)</Libelle>
          {r.estimations.slice(0, 12).map(e => {
            const t = a.etat.donnees.taches[e.tacheId];
            const ratio = e.reel / e.estimation;
            return (
              <Pressable key={e.tacheId} accessibilityRole="button" onPress={() => onOuvrir(e.tacheId)} style={styles.ligneEstimation} testID={`releve-estimation-${e.tacheId}`}>
                <Text style={[texteDe(theme), { flex: 1, textDecorationLine: t && estTerminee(a.etat.donnees, t) ? 'line-through' : 'none' }]} numberOfLines={1}>
                  {e.titre}
                </Text>
                <Text style={[texteDe(theme), { color: ratio > 1 ? theme.critique : theme.texte }]}>
                  {dureeLisible(e.reel)} / {dureeLisible(e.estimation)}
                </Text>
              </Pressable>
            );
          })}
        </>
      ) : null}
    </Dialogue>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  rangee: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  barre: { height: 8, borderRadius: 4, overflow: 'hidden' },
  lien: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, padding: 10, minHeight: 44 },
  pastille: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, paddingLeft: 10, maxWidth: 320 },
  pastilleTexte: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, flexShrink: 1 },
  ligneTableau: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 40, borderBottomWidth: StyleSheet.hairlineWidth },
  colNom: { width: 150 },
  point: { width: 10, height: 10, borderRadius: 5 },
  ligneEstimation: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
});
