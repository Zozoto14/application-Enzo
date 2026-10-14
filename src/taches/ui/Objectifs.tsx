/**
 * Vue Objectifs (V3, Fondateur) : chaque objectif, sa progression (barre et
 * texte), son état, son échéance ; création et modification dans une fenêtre
 * (tâches et projets liés, ou saisie manuelle, cible chiffrée facultative).
 */

import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { teinteTransparente } from '../../hub/themes';
import { jourLisible, lireDateLibre, sansAccents } from '../dates';
import { creerObjectif, LIBELLES_ETAT_OBJECTIF, modifierObjectif, objectifsVivants, progression, supprimerObjectif, tachesDeLObjectif, type EtatObjectif } from '../objectifs';
import { projetsDe, tachesVivantes, type Objectif } from '../modele';
import type { Actions } from './actions';
import { attenueDe, Bouton, Champ, Dialogue, EtatVide, Libelle, Puce, texteDe, titreDe } from './atomes';

function couleurEtat(a: Actions, e: EtatObjectif): string {
  return e === 'atteint' ? a.theme.ok : e === 'retard' ? a.theme.critique : e === 'risque' ? a.theme.alerte : a.theme.accent;
}
const ICONES: Record<EtatObjectif, string> = { atteint: '✓', retard: '⚠', risque: '!', 'en-cours': '→' };

export function VueObjectifs({ a, onModifier, onNouveau }: { a: Actions; onModifier(id: string): void; onNouveau(): void }) {
  const theme = a.theme;
  const d = a.etat.donnees;
  const liste = objectifsVivants(d);
  if (!liste.length) {
    return (
      <EtatVide theme={theme} testID="objectifs-vide" titre="Aucun objectif" texte="Un objectif, c’est une cible avec une échéance (« Finir la v2 de Tsuzuku »). Sa progression se calcule avec les tâches et projets liés, ou se saisit à la main.">
        <Bouton theme={theme} variante="plein" titre="＋ Nouvel objectif" onPress={onNouveau} testID="objectif-nouveau" />
      </EtatVide>
    );
  }
  return (
    <View style={{ gap: 12 }} testID="vue-objectifs">
      <Bouton theme={theme} variante="plein" titre="＋ Nouvel objectif" onPress={onNouveau} testID="objectif-nouveau" style={{ alignSelf: 'flex-start' }} />
      {liste.map(o => {
        const p = progression(d, o, a.etat.aujourdhui);
        const c = couleurEtat(a, p.etat);
        return (
          <Pressable
            key={o.id}
            accessibilityRole="button"
            accessibilityLabel={`${o.titre}. ${LIBELLES_ETAT_OBJECTIF[p.etat]}. ${p.texte}.${o.echeance ? ` Échéance ${jourLisible(o.echeance, a.etat.aujourdhui, true)}.` : ''} Modifier.`}
            onPress={() => onModifier(o.id)}
            style={[styles.carte, { borderColor: theme.ligne, backgroundColor: theme.surface, borderRadius: Math.min(theme.rayonGrand, 16) }]}
            testID={`objectif-${o.id}`}>
            <View style={[styles.rangee, { justifyContent: 'space-between' }]}>
              <Text style={[titreDe(theme, 19), { flex: 1, minWidth: 160 }]}>{o.titre}</Text>
              <Puce theme={theme} texte={`${ICONES[p.etat]} ${LIBELLES_ETAT_OBJECTIF[p.etat]}`} couleur={c} testID={`objectif-etat-${o.id}`} />
            </View>
            {o.description ? <Text style={attenueDe(theme)}>{o.description}</Text> : null}
            <View style={{ height: 12, borderRadius: 6, backgroundColor: teinteTransparente(theme.attenue, 0.15), overflow: 'hidden' }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: p.pourcent }}>
              <View style={{ width: `${p.pourcent}%`, height: '100%', backgroundColor: c }} />
            </View>
            <View style={[styles.rangee, { justifyContent: 'space-between' }]}>
              <Text style={texteDe(theme)} testID={`objectif-progression-${o.id}`}>
                {p.texte}
              </Text>
              {o.echeance ? (
                <Text style={[attenueDe(theme), p.etat === 'retard' ? { color: theme.critique } : null]}>
                  Échéance {jourLisible(o.echeance, a.etat.aujourdhui)}
                  {p.joursRestants !== undefined && p.joursRestants >= 0 ? ` · ${p.joursRestants} j` : ''}
                </Text>
              ) : null}
            </View>
            {o.mode === 'taches' ? (
              <Text style={attenueDe(theme)} numberOfLines={2}>
                {[...o.projets.map(id => d.projets[id]?.nom).filter(Boolean).map(n => `Projet ${n}`), ...o.taches.map(id => d.taches[id]?.titre).filter(Boolean)].join(' · ') || 'Rien de lié'}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export function DialogueObjectif({ a, id, onFermer, onErreur, onAvis }: { a: Actions; id?: string; onFermer(): void; onErreur(e: unknown): void; onAvis(t: string): void }) {
  const theme = a.theme;
  const d = a.etat.donnees;
  const o: Objectif | undefined = id ? d.objectifs[id] : undefined;
  const [titre, setTitre] = useState(o?.titre ?? '');
  const [description, setDescription] = useState(o?.description ?? '');
  const [echeance, setEcheance] = useState(o?.echeance ? o.echeance.split('-').reverse().join('/') : '');
  const [mode, setMode] = useState<'taches' | 'manuel'>(o?.mode ?? 'taches');
  const [projets, setProjets] = useState<string[]>(o?.projets ?? []);
  const [taches, setTaches] = useState<string[]>(o?.taches ?? []);
  const [manuel, setManuel] = useState(String(o?.manuel ?? 0));
  const [cible, setCible] = useState(o?.cible ? String(o.cible) : '');
  const [unite, setUnite] = useState(o?.unite ?? '');
  const [atteint, setAtteint] = useState(o?.atteint !== undefined ? String(o.atteint) : '');
  const [recherche, setRecherche] = useState('');
  const [confirmer, setConfirmer] = useState(false);
  const candidates = useMemo(() => {
    const q = sansAccents(recherche.trim());
    return tachesVivantes(d)
      .filter(t => !t.parentId && (!q || sansAccents(t.titre).includes(q)))
      .slice(0, 12);
  }, [d, recherche]);
  const nombre = (x: string) => (x.trim() ? Number(x.replace(',', '.')) : undefined);
  const enregistrer = () => {
    try {
      const jour = echeance.trim() ? lireDateLibre(echeance, a.etat.aujourdhui)?.jour : undefined;
      if (echeance.trim() && !jour) throw new Error('Échéance non comprise (ex. 31/12, fin novembre → 30/11).');
      const n = nombre(manuel);
      const c = nombre(cible);
      const at = nombre(atteint);
      if ([n, c, at].some(v => v !== undefined && !Number.isFinite(v))) throw new Error('Saisissez des nombres.');
      const saisie = { titre, description, ...(jour ? { echeance: jour } : {}), mode, projets, taches, ...(n !== undefined ? { manuel: n } : {}), ...(c ? { cible: c } : {}), unite, ...(at !== undefined ? { atteint: at } : {}) };
      a.etat.maj((x, ctx) => (o ? modifierObjectif(x, o.id, { ...saisie, ...(jour ? {} : { echeance: undefined }), ...(c ? {} : { cible: undefined }) }, ctx) : creerObjectif(x, saisie, ctx).donnees));
      onAvis(o ? 'Objectif enregistré.' : 'Objectif créé.');
      onFermer();
    } catch (e) {
      onErreur(e);
    }
  };
  const basculer = (l: string[], x: string) => (l.includes(x) ? l.filter(y => y !== x) : [...l, x]);
  const lies = o ? tachesDeLObjectif(d, { ...o, projets, taches }).length : 0;
  return (
    <Dialogue
      theme={theme}
      mobile={a.mobile}
      visible
      large
      titre={o ? `Objectif « ${o.titre} »` : 'Nouvel objectif'}
      onFermer={onFermer}
      testID="dialogue-objectif"
      pied={<Bouton theme={theme} variante="plein" titre="Enregistrer" desactive={!titre.trim()} onPress={enregistrer} testID="objectif-enregistrer" />}>
      <Libelle theme={theme}>NOM</Libelle>
      <Champ theme={theme} mobile={a.mobile} value={titre} onChangeText={setTitre} placeholder="Finir la v2 de Tsuzuku" testID="objectif-titre" accessibilityLabel="Nom de l’objectif" />
      <Champ theme={theme} mobile={a.mobile} multiline value={description} onChangeText={setDescription} placeholder="Pourquoi, comment on saura que c’est fini…" testID="objectif-description" accessibilityLabel="Description" />
      <Libelle theme={theme}>ÉCHÉANCE</Libelle>
      <Champ theme={theme} mobile={a.mobile} value={echeance} onChangeText={setEcheance} placeholder="ex. 31/12, dans 3 semaines" testID="objectif-echeance" accessibilityLabel="Échéance de l’objectif" />
      <Libelle theme={theme}>PROGRESSION</Libelle>
      <View style={styles.rangee}>
        <Puce theme={theme} grand={a.mobile} texte="Calculée avec les tâches" couleur={theme.accent} actif={mode === 'taches'} onPress={() => setMode('taches')} testID="objectif-mode-taches" />
        <Puce theme={theme} grand={a.mobile} texte="Saisie à la main" couleur={theme.accent} actif={mode === 'manuel'} onPress={() => setMode('manuel')} testID="objectif-mode-manuel" />
      </View>
      {mode === 'taches' ? (
        <>
          <Text style={attenueDe(theme)}>Projets liés (toutes leurs tâches comptent) :</Text>
          <View style={styles.rangee}>
            {projetsDe(d).map(p => (
              <Puce key={p.id} theme={theme} grand={a.mobile} texte={p.nom} couleur={p.couleur} actif={projets.includes(p.id)} onPress={() => setProjets(l => basculer(l, p.id))} testID={`objectif-projet-${p.id}`} />
            ))}
          </View>
          <Text style={attenueDe(theme)}>Tâches liées :</Text>
          <Champ theme={theme} mobile={a.mobile} value={recherche} onChangeText={setRecherche} placeholder="Chercher une tâche" testID="objectif-recherche" accessibilityLabel="Chercher une tâche à lier" />
          <View style={styles.rangee}>
            {taches.map(tid => (
              <Puce key={tid} theme={theme} grand={a.mobile} texte={`✓ ${d.taches[tid]?.titre ?? '?'}`} couleur={theme.ok} actif onPress={() => setTaches(l => l.filter(x => x !== tid))} testID={`objectif-tache-lie-${tid}`} />
            ))}
          </View>
          <View style={styles.rangee}>
            {candidates
              .filter(t => !taches.includes(t.id))
              .map(t => (
                <Puce key={t.id} theme={theme} grand={a.mobile} texte={`＋ ${t.titre}`} couleur={theme.attenue} onPress={() => setTaches(l => [...l, t.id])} testID={`objectif-tache-${t.id}`} />
              ))}
          </View>
          {o ? <Text style={attenueDe(theme)}>{lies} tâche{lies > 1 ? 's' : ''} comptée{lies > 1 ? 's' : ''}.</Text> : null}
        </>
      ) : (
        <>
          <View style={[styles.rangee, { flexWrap: 'nowrap' }]}>
            <Text style={[attenueDe(theme), { width: 120 }]}>Avancement (%)</Text>
            <Champ theme={theme} mobile={a.mobile} value={manuel} onChangeText={setManuel} keyboardType="numeric" style={{ width: 100 }} testID="objectif-manuel" accessibilityLabel="Avancement en pour cent" />
          </View>
          <Text style={attenueDe(theme)}>Ou une cible chiffrée (elle remplace le pourcentage) :</Text>
          <View style={styles.rangee}>
            <Champ theme={theme} mobile={a.mobile} value={atteint} onChangeText={setAtteint} keyboardType="numeric" placeholder="Atteint" style={{ width: 100 }} testID="objectif-atteint" accessibilityLabel="Valeur atteinte" />
            <Text style={texteDe(theme)}>sur</Text>
            <Champ theme={theme} mobile={a.mobile} value={cible} onChangeText={setCible} keyboardType="numeric" placeholder="Cible" style={{ width: 100 }} testID="objectif-cible" accessibilityLabel="Cible" />
            <Champ theme={theme} mobile={a.mobile} value={unite} onChangeText={setUnite} placeholder="articles" style={{ width: 140 }} testID="objectif-unite" accessibilityLabel="Unité" />
          </View>
        </>
      )}
      {o ? (
        confirmer ? (
          <View style={styles.rangee}>
            <Bouton
              theme={theme}
              variante="danger"
              titre="Supprimer l’objectif"
              onPress={() => {
                try {
                  a.etat.maj((x, ctx) => supprimerObjectif(x, o.id, ctx));
                  onAvis('Objectif supprimé.');
                  onFermer();
                } catch (e) {
                  onErreur(e);
                }
              }}
              testID="objectif-supprimer-confirmer"
            />
            <Bouton theme={theme} titre="Annuler" onPress={() => setConfirmer(false)} />
          </View>
        ) : (
          <Bouton theme={theme} variante="danger" titre="Supprimer…" onPress={() => setConfirmer(true)} testID="objectif-supprimer" style={{ alignSelf: 'flex-start' }} />
        )
      ) : null}
    </Dialogue>
  );
}

const styles = StyleSheet.create({
  rangee: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  carte: { borderWidth: 1, padding: 16, gap: 10 },
});
