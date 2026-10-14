/**
 * Vue Tableau de bord (V3) : par projet (projet choisi) ou global.
 * Graphiques légers en vues (aucune dépendance), aux couleurs du thème ; une
 * seule série par graphique (pas de légende nécessaire, le titre la nomme) ;
 * chaque valeur est aussi écrite (étiquettes et « Voir les valeurs en
 * tableau »), pour les lecteurs d'écran et l'impression.
 */

import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { teinteTransparente } from '../../hub/themes';
import { jourLisible } from '../dates';
import { projetsDe } from '../modele';
import { avancementProjets, statistiques } from '../tableauBord';
import { dureeLisible } from '../temps';
import type { Actions } from './actions';
import { attenueDe, Bouton, Libelle, texteDe, titreDe } from './atomes';
import { couleurAuteur } from './Vues';

const fr = (j: string) => j.split('-').reverse().slice(0, 2).join('/');

function Carte({ a, titre, children, testID }: { a: Actions; titre: string; children: React.ReactNode; testID?: string }) {
  return (
    <View style={[styles.carte, { borderColor: a.theme.ligne, backgroundColor: a.theme.surface, borderRadius: Math.min(a.theme.rayonGrand, 16) }]} testID={testID}>
      <Libelle theme={a.theme}>{titre.toUpperCase()}</Libelle>
      {children}
    </View>
  );
}

/** Barres verticales d'une série (valeur au-dessus de chaque barre, libellé dessous). */
function Colonnes({ a, valeurs, couleur, hauteur = 120, marque, libelle }: { a: Actions; valeurs: Array<{ cle: string; libelle: string; valeur: number; texte?: string }>; couleur: string; hauteur?: number; marque?: number[]; libelle: string }) {
  const max = Math.max(1, ...valeurs.map(v => v.valeur), ...(marque ?? []));
  const peu = valeurs.length <= 10;
  return (
    <View accessibilityLabel={`${libelle} : ${valeurs.map(v => `${v.libelle} ${v.texte ?? v.valeur}`).join(', ')}`} accessibilityRole="image">
      <View style={[styles.colonnes, { height: hauteur + 22 }]}>
        {valeurs.map((v, i) => (
          <View key={v.cle} style={styles.colonne} {...({ title: `${v.libelle} : ${v.texte ?? v.valeur}` } as object)}>
            {peu ? <Text style={[attenueDe(a.theme), styles.valeur]}>{v.texte ?? v.valeur}</Text> : null}
            <View style={{ height: hauteur, justifyContent: 'flex-end', width: '100%', alignItems: 'center' }}>
              {marque ? <View style={[styles.marque, { bottom: (marque[i] / max) * hauteur, backgroundColor: a.theme.texte }]} /> : null}
              <View style={{ width: '70%', maxWidth: 28, height: Math.max(v.valeur ? 3 : 0, (v.valeur / max) * hauteur), backgroundColor: couleur, borderTopLeftRadius: 4, borderTopRightRadius: 4 }} />
            </View>
          </View>
        ))}
      </View>
      <View style={styles.colonnes}>
        {valeurs.map((v, i) => (
          <Text key={v.cle} numberOfLines={1} style={[attenueDe(a.theme), styles.libelleColonne]}>
            {peu || i % Math.ceil(valeurs.length / 7) === 0 ? v.libelle : ''}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** Barres horizontales (une ligne par élément, valeur écrite au bout). */
function Barres({ a, lignes }: { a: Actions; lignes: Array<{ cle: string; libelle: string; valeur: number; texte: string; couleur: string }> }) {
  const max = Math.max(1, ...lignes.map(l => l.valeur));
  return (
    <View style={{ gap: 8 }}>
      {lignes.map(l => (
        <View key={l.cle} style={styles.ligneBarre} accessibilityLabel={`${l.libelle} : ${l.texte}`}>
          <Text numberOfLines={1} style={[texteDe(a.theme), { width: a.mobile ? 96 : 140 }]}>
            {l.libelle}
          </Text>
          <View style={{ flex: 1, height: 14, backgroundColor: teinteTransparente(a.theme.attenue, 0.12), borderRadius: 4, overflow: 'hidden' }}>
            <View style={{ width: `${(l.valeur / max) * 100}%`, height: '100%', backgroundColor: l.couleur, borderRadius: 4 }} />
          </View>
          <Text style={[texteDe(a.theme), { minWidth: 64, textAlign: 'right' }]}>{l.texte}</Text>
        </View>
      ))}
    </View>
  );
}

export function VueTableau({ a, projetId }: { a: Actions; projetId?: string }) {
  const theme = a.theme;
  const d = a.etat.donnees;
  const [tableau, setTableau] = useState(false);
  const s = useMemo(() => statistiques(d, a.etat.aujourdhui, projetId), [d, a.etat.aujourdhui, projetId]);
  const projets = useMemo(() => (projetId ? [] : avancementProjets(d, projetsDe(d).map(p => ({ id: p.id, nom: p.nom, couleur: p.couleur })))), [d, projetId]);
  const nom = (q: string) => (q === 'personne' ? 'Personne' : (a.etat.noms[q] ?? 'Membre'));
  const tempsPct = s.temps.estime ? Math.round((s.temps.passeEstimees / s.temps.estime) * 100) : 0;
  const burn = s.burndown;
  const derniers = burn.jours.length > 21 ? burn.jours.length - 21 : 0;
  return (
    <View style={{ gap: 14 }} testID="vue-tableau">
      <View style={[styles.rangee, { justifyContent: 'space-between' }]}>
        <Text style={attenueDe(theme)}>{projetId ? `Projet « ${d.projets[projetId]?.nom ?? ''} »` : 'Tous les projets visibles'} · sous-tâches non comptées</Text>
        <Bouton theme={theme} compact titre={tableau ? 'Voir les graphiques' : 'Voir les valeurs en tableau'} onPress={() => setTableau(x => !x)} testID="tableau-valeurs" />
      </View>
      <View style={[styles.grille, a.mobile && { flexDirection: 'column' }]}>
        <Carte a={a} titre="Avancement" testID="tableau-avancement">
          <Text style={[titreDe(theme, 34)]} accessibilityLabel={`${s.pourcent} pour cent des tâches terminées`}>
            {s.pourcent} %
          </Text>
          <View style={{ height: 10, borderRadius: 5, backgroundColor: teinteTransparente(theme.attenue, 0.15), overflow: 'hidden' }}>
            <View style={{ width: `${s.pourcent}%`, height: '100%', backgroundColor: theme.ok }} />
          </View>
          <Text style={attenueDe(theme)}>
            {s.faites} terminée{s.faites > 1 ? 's' : ''} sur {s.total}
          </Text>
        </Carte>
        <Carte a={a} titre="En retard" testID="tableau-retard">
          <Text style={[titreDe(theme, 34), { color: s.retard.length ? theme.critique : theme.texte }]}>{s.retard.length}</Text>
          {s.retard.slice(0, 4).map(t => (
            <Pressable key={t.id} accessibilityRole="button" onPress={() => a.ouvrir(t.id)} style={{ minHeight: 32, justifyContent: 'center' }}>
              <Text numberOfLines={1} style={texteDe(theme)}>
                ⚠ {t.titre} <Text style={attenueDe(theme)}>· {jourLisible(t.echeance!.jour, a.etat.aujourdhui)}</Text>
              </Text>
            </Pressable>
          ))}
          {!s.retard.length ? <Text style={attenueDe(theme)}>Rien en retard.</Text> : null}
        </Carte>
        <Carte a={a} titre="Temps passé contre estimé" testID="tableau-temps">
          <Text style={titreDe(theme, 24)}>{s.temps.estime ? `${tempsPct} %` : '—'}</Text>
          <Text style={attenueDe(theme)}>
            {s.temps.nbEstimees ? `${dureeLisible(s.temps.passeEstimees)} passées sur ${dureeLisible(s.temps.estime)} estimées (${s.temps.nbEstimees} tâche${s.temps.nbEstimees > 1 ? 's' : ''}, ${s.temps.depassees} dépassée${s.temps.depassees > 1 ? 's' : ''})` : 'Aucune tâche estimée.'}
          </Text>
          <Text style={attenueDe(theme)}>Temps suivi en tout : {dureeLisible(s.temps.passe)}</Text>
        </Carte>
      </View>
      {tableau ? (
        <Carte a={a} titre="Valeurs" testID="tableau-texte">
          <Text style={texteDe(theme)}>Terminées par semaine : {s.parSemaine.map(x => `semaine du ${fr(x.semaine)} : ${x.nombre}`).join(' ; ')}.</Text>
          <Text style={texteDe(theme)}>Par statut : {s.parStatut.map(x => `${x.nom} : ${x.nombre}`).join(' ; ')}.</Text>
          <Text style={texteDe(theme)}>Charge : {s.charge.map(c => `${nom(c.qui)} : ${c.ouvertes} ouverte(s)${c.estimation ? `, ${dureeLisible(Math.round(c.estimation))} restantes estimées` : ''}`).join(' ; ') || 'aucune tâche ouverte'}.</Text>
          <Text style={texteDe(theme)}>
            Burndown (tâches restantes) : {burn.jours.slice(derniers).map((j, i) => `${fr(j)} : ${burn.restantes[derniers + i]}`).join(' ; ')}
            {burn.cible ? ` ; objectif : 0 le ${fr(burn.cible)}` : ''}.
          </Text>
          {projets.length ? <Text style={texteDe(theme)}>Projets : {projets.map(p => `${p.nom} : ${p.pourcent} % (${p.faites}/${p.total})`).join(' ; ')}.</Text> : null}
        </Carte>
      ) : (
        <View style={[styles.grille, a.mobile && { flexDirection: 'column' }]}>
          <Carte a={a} titre="Tâches terminées par semaine" testID="tableau-semaines">
            <Colonnes a={a} libelle="Tâches terminées par semaine" couleur={theme.accent} valeurs={s.parSemaine.map(x => ({ cle: x.semaine, libelle: fr(x.semaine), valeur: x.nombre }))} />
          </Carte>
          <Carte a={a} titre={`Burndown${burn.cible ? ` (objectif 0 le ${fr(burn.cible)})` : ''}`} testID="tableau-burndown">
            <Colonnes a={a} libelle="Tâches restantes par jour" couleur={theme.teintes.anime} marque={burn.ideal.slice(derniers)} valeurs={burn.jours.slice(derniers).map((j, i) => ({ cle: j, libelle: fr(j), valeur: burn.restantes[derniers + i] }))} />
            <Text style={attenueDe(theme)}>Barres : tâches restantes ; trait : rythme idéal jusqu’à l’objectif.</Text>
          </Carte>
        </View>
      )}
      {!tableau ? (
        <View style={[styles.grille, a.mobile && { flexDirection: 'column' }]}>
          <Carte a={a} titre="Par statut" testID="tableau-statuts">
            <Barres a={a} lignes={s.parStatut.map(x => ({ cle: x.id, libelle: x.nom, valeur: x.nombre, texte: String(x.nombre), couleur: x.couleur }))} />
          </Carte>
          <Carte a={a} titre="Charge par personne (tâches ouvertes)" testID="tableau-charge">
            {s.charge.length ? (
              <Barres a={a} lignes={s.charge.map(c => ({ cle: c.qui, libelle: nom(c.qui), valeur: c.ouvertes, texte: `${c.ouvertes}${c.estimation ? ` · ${dureeLisible(Math.round(c.estimation))}` : ''}`, couleur: c.qui === 'personne' ? theme.attenue : couleurAuteur(a, c.qui) }))} />
            ) : (
              <Text style={attenueDe(theme)}>Aucune tâche ouverte.</Text>
            )}
          </Carte>
        </View>
      ) : null}
      {projets.length && !tableau ? (
        <Carte a={a} titre="Avancement par projet" testID="tableau-projets">
          <Barres a={a} lignes={projets.map(p => ({ cle: p.id, libelle: p.nom, valeur: p.pourcent, texte: `${p.pourcent} % · ${p.faites}/${p.total}`, couleur: p.couleur }))} />
        </Carte>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rangee: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  grille: { flexDirection: 'row', gap: 14, flexWrap: 'wrap' },
  carte: { flex: 1, minWidth: 260, borderWidth: 1, padding: 16, gap: 10 },
  colonnes: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  colonne: { flex: 1, alignItems: 'center' },
  valeur: { fontSize: 15, marginBottom: 2 },
  marque: { position: 'absolute', height: 2, width: '80%', opacity: 0.7 },
  libelleColonne: { flex: 1, textAlign: 'center', fontSize: 15 },
  ligneBarre: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 32 },
});
