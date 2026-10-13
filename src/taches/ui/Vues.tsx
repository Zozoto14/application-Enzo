/**
 * Les quatre vues de Tâches : Liste (tableau modifiable en place, groupé),
 * Kanban (colonnes par statut, glisser-déposer souris / doigt, clavier),
 * Calendrier (mois / semaine, glisser une tâche pour changer sa date) et
 * « Ma journée ».
 */

import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { police, teinteTransparente } from '../../hub/themes';
import { ajouterJours, ajouterMois, debutSemaine, JOURS_COURTS, jourLisible, MOIS } from '../dates';
import { grilleMois, grilleSemaine, grouper, maJournee, tachesParJour, type GroupeTaches } from '../filtres';
import {
  elementsChecklist,
  estTerminee,
  LIBELLES_PRIORITE,
  sousTaches,
  statutDe,
  statutsDe,
  type Groupe,
  type Tache,
} from '../modele';
import type { Actions } from './actions';
import { attenueDe, Avatar, Bouton, CaseRonde, couleurPriorite, EtatVide, PastillePriorite, Puce, T, texteDe, titreDe } from './atomes';
import { useGlissable, useZoneDepot } from './glisser';

// ------------------------------------------------------------------ Morceaux communs

export function couleurAuteur(a: Actions, qui: 'fondateur' | 'ami'): string {
  return qui === 'fondateur' ? a.theme.teintes.portefeuille : a.theme.teintes.admin;
}

function libelleEcheance(a: Actions, t: Tache): { texte: string; couleur: string } | undefined {
  if (!t.echeance) return undefined;
  const auj = a.etat.aujourdhui;
  const ferme = estTerminee(a.etat.donnees, t);
  const couleur = ferme ? a.theme.attenue : t.echeance.jour < auj ? a.theme.critique : t.echeance.jour === auj ? a.theme.alerte : a.theme.attenue;
  const jour = jourLisible(t.echeance.jour, auj);
  return { texte: `${jour.charAt(0).toUpperCase()}${jour.slice(1)}${t.echeance.heure ? ` ${t.echeance.heure.replace(':', ' h ')}` : ''}${t.recurrence ? ' ↻' : ''}`, couleur };
}

function Compteurs({ a, t }: { a: Actions; t: Tache }) {
  const d = a.etat.donnees;
  const st = sousTaches(d, t.id);
  const cl = elementsChecklist(t);
  const com = Object.values(t.commentaires).filter(c => !c.supprime).length;
  const morceaux: string[] = [];
  if (st.length) morceaux.push(`↳ ${st.filter(s => estTerminee(d, s)).length}/${st.length}`);
  if (cl.length) morceaux.push(`☑ ${cl.filter(e => e.fait).length}/${cl.length}`);
  if (com) morceaux.push(`💬 ${com}`);
  if (!morceaux.length) return null;
  return <Text style={attenueDe(a.theme)}>{morceaux.join('   ')}</Text>;
}

/** Titre modifiable en place (Entrée ou sortie du champ valident, Échap annule). */
function TitreEnPlace({ a, t, modifiable, ferme }: { a: Actions; t: Tache; modifiable: boolean; ferme: boolean }) {
  const [edition, setEdition] = useState<string | undefined>();
  const theme = a.theme;
  if (edition !== undefined) {
    const valider = () => {
      if (edition.trim() && edition.trim() !== t.titre) a.changer(t.id, { titre: edition });
      setEdition(undefined);
    };
    return (
      <TextInput
        testID={`tache-titre-champ-${t.id}`}
        autoFocus
        value={edition}
        onChangeText={setEdition}
        onSubmitEditing={valider}
        onBlur={valider}
        onKeyPress={e => {
          if ((e.nativeEvent as { key?: string }).key === 'Escape') setEdition(undefined);
        }}
        accessibilityLabel="Titre de la tâche"
        style={[styles.champEnPlace, texteDe(theme, T.corps), { borderColor: theme.accent, backgroundColor: theme.fond, borderRadius: 6 }]}
      />
    );
  }
  return (
    <Pressable
      testID={`tache-titre-${t.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${t.titre}${modifiable ? ' (double-clic ou F2 pour renommer)' : ''}`}
      onPress={() => a.ouvrir(t.id)}
      onLongPress={modifiable && !a.mobile ? () => setEdition(t.titre) : undefined}
      {...({ onDoubleClick: modifiable ? () => setEdition(t.titre) : undefined, onKeyDown: (e: { key: string }) => e.key === 'F2' && modifiable && setEdition(t.titre) } as object)}
      style={{ flex: 1, minWidth: 0, justifyContent: 'center', minHeight: 36 }}>
      <Text numberOfLines={2} style={[texteDe(theme, T.corps), { fontWeight: '600', textDecorationLine: ferme ? 'line-through' : 'none', color: ferme ? theme.attenue : theme.texte }]}>
        {t.titre}
      </Text>
    </Pressable>
  );
}

// ------------------------------------------------------------------ Liste

const COLONNES = { statut: 132, priorite: 112, echeance: 150, assigne: 56, etiquettes: 170 } as const;

function LigneTache({ a, t, compacte }: { a: Actions; t: Tache; compacte: boolean }) {
  const theme = a.theme;
  const d = a.etat.donnees;
  const droits = a.droits(t.projetId);
  const statut = statutDe(d, t);
  const ferme = statut.ferme;
  const ech = libelleEcheance(a, t);
  const projet = d.projets[t.projetId];
  if (compacte) {
    return (
      <View testID={`ligne-${t.id}`} style={[styles.ligneMobile, { borderColor: theme.ligne, backgroundColor: theme.surface, borderRadius: Math.min(theme.rayonMoyen, 12) }]}>
        <CaseRonde theme={theme} coche={ferme} desactive={!droits.modifier} onPress={() => a.basculer(t.id)} libelle={`Terminer « ${t.titre} »`} testID={`case-${t.id}`} />
        <Pressable accessibilityRole="button" testID={`ouvrir-${t.id}`} onPress={() => a.ouvrir(t.id)} style={{ flex: 1, minWidth: 0, gap: 6, paddingVertical: 4 }}>
          <Text numberOfLines={2} style={[texteDe(theme, 17), { fontWeight: '600', textDecorationLine: ferme ? 'line-through' : 'none', color: ferme ? theme.attenue : theme.texte }]}>
            {t.titre}
          </Text>
          <View style={styles.meta}>
            <Puce theme={theme} texte={statut.nom} couleur={statut.couleur} />
            {t.priorite !== 'normale' ? <PastillePriorite theme={theme} priorite={t.priorite} /> : null}
            {ech ? <Text style={[attenueDe(theme), { color: ech.couleur }]}>{ech.texte}</Text> : null}
            {t.assigne ? <Avatar theme={theme} nom={a.etat.noms[t.assigne]} couleur={couleurAuteur(a, t.assigne)} taille={24} /> : null}
          </View>
          <Compteurs a={a} t={t} />
        </Pressable>
      </View>
    );
  }
  return (
    <View testID={`ligne-${t.id}`} style={[styles.ligne, { borderColor: theme.ligne }]}>
      <CaseRonde theme={theme} coche={ferme} desactive={!droits.modifier} onPress={() => a.basculer(t.id)} libelle={`Terminer « ${t.titre} »`} testID={`case-${t.id}`} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <TitreEnPlace a={a} t={t} modifiable={droits.modifier} ferme={ferme} />
        <View style={styles.meta}>
          {projet && a.etat.donnees ? <Text style={attenueDe(theme)} numberOfLines={1}>{projet.nom}</Text> : null}
          <Compteurs a={a} t={t} />
        </View>
      </View>
      <View style={{ width: COLONNES.statut }}>
        <Puce theme={theme} texte={statut.nom} couleur={statut.couleur} onPress={droits.modifier ? () => a.menuStatut(t) : undefined} testID={`statut-${t.id}`} libelle={`Statut : ${statut.nom}`} />
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Priorité : ${LIBELLES_PRIORITE[t.priorite]}`} disabled={!droits.modifier} onPress={() => a.menuPriorite(t)} testID={`priorite-${t.id}`} style={[styles.cellule, { width: COLONNES.priorite }]}>
        <PastillePriorite theme={theme} priorite={t.priorite} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Échéance : ${ech?.texte ?? 'aucune'}`} disabled={!droits.modifier} onPress={() => a.menuEcheance(t)} testID={`echeance-${t.id}`} style={[styles.cellule, { width: COLONNES.echeance }]}>
        <Text style={[texteDe(theme), { color: ech?.couleur ?? theme.attenue }]} numberOfLines={1}>
          {ech?.texte ?? '—'}
        </Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Assignée : ${t.assigne ? a.etat.noms[t.assigne] : 'personne'}`} disabled={!droits.modifier} onPress={() => a.menuAssigne(t)} testID={`assigne-${t.id}`} style={[styles.cellule, { width: COLONNES.assigne }]}>
        {t.assigne ? <Avatar theme={theme} nom={a.etat.noms[t.assigne]} couleur={couleurAuteur(a, t.assigne)} /> : <Text style={attenueDe(theme)}>—</Text>}
      </Pressable>
      <View style={[styles.cellule, { width: COLONNES.etiquettes, flexDirection: 'row', gap: 4, overflow: 'hidden' }]}>
        {t.etiquettes.slice(0, 2).map(e => (
          <Puce key={e} theme={theme} texte={`#${e}`} couleur={theme.teintes.anime} />
        ))}
        {t.etiquettes.length > 2 ? <Text style={attenueDe(theme)}>+{t.etiquettes.length - 2}</Text> : null}
      </View>
    </View>
  );
}

export function VueListe({ a, taches, groupe, projetId }: { a: Actions; taches: readonly Tache[]; groupe: Groupe; projetId?: string }) {
  const theme = a.theme;
  const { width } = useWindowDimensions();
  const compacte = a.mobile || width < 980;
  const groupes = grouper(a.etat.donnees, taches, groupe, a.etat.aujourdhui, projetId);
  const [replies, setReplies] = useState<Record<string, boolean>>({});
  return (
    <View testID="vue-liste" style={{ gap: 14 }}>
      {!compacte ? (
        <View style={[styles.ligne, styles.entete, { borderColor: theme.ligne }]}>
          <View style={{ width: 30 }} />
          <Text style={[attenueDe(theme), styles.colonneTitre, { flex: 1 }]}>Tâche</Text>
          <Text style={[attenueDe(theme), styles.colonneTitre, { width: COLONNES.statut }]}>Statut</Text>
          <Text style={[attenueDe(theme), styles.colonneTitre, { width: COLONNES.priorite }]}>Priorité</Text>
          <Text style={[attenueDe(theme), styles.colonneTitre, { width: COLONNES.echeance }]}>Échéance</Text>
          <Text style={[attenueDe(theme), styles.colonneTitre, { width: COLONNES.assigne }]}>Pour</Text>
          <Text style={[attenueDe(theme), styles.colonneTitre, { width: COLONNES.etiquettes }]}>Étiquettes</Text>
        </View>
      ) : null}
      {groupes.map(g => (
        <View key={g.cle} style={{ gap: compacte ? 8 : 0 }} testID={`groupe-${g.cle}`}>
          {groupe !== 'aucun' ? (
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: !replies[g.cle] }} onPress={() => setReplies(r => ({ ...r, [g.cle]: !r[g.cle] }))} style={styles.groupeTete}>
              <Text style={[attenueDe(theme), { width: 14 }]}>{replies[g.cle] ? '▸' : '▾'}</Text>
              {g.couleur ? <View style={[styles.point, { backgroundColor: g.couleur }]} /> : null}
              <Text style={[titreDe(theme, 16)]}>{g.titre}</Text>
              <Text style={attenueDe(theme)}>{g.taches.length}</Text>
            </Pressable>
          ) : null}
          {replies[g.cle] ? null : g.taches.length === 0 ? (
            <Text style={[attenueDe(theme), { paddingVertical: 8, paddingLeft: 36 }]}>Aucune tâche.</Text>
          ) : (
            g.taches.map(t => <LigneTache key={t.id} a={a} t={t} compacte={compacte} />)
          )}
        </View>
      ))}
    </View>
  );
}

// ------------------------------------------------------------------ Kanban

function CarteKanban({ a, t, colonnes, iColonne }: { a: Actions; t: Tache; colonnes: readonly GroupeTaches[]; iColonne: number }) {
  const theme = a.theme;
  const droits = a.droits(t.projetId);
  const ech = libelleEcheance(a, t);
  const ferme = estTerminee(a.etat.donnees, t);
  const { ref, glisse } = useGlissable({ actif: droits.modifier, onDeposer: zone => zone.startsWith('statut:') && a.versColonne(t, zone.slice(7)) });
  const surTouche = (e: { key: string; shiftKey?: boolean; altKey?: boolean; preventDefault(): void }) => {
    if (!droits.modifier || !(e.shiftKey || e.altKey)) return;
    const pas = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const cible = colonnes[iColonne + pas];
    if (pas && cible) {
      e.preventDefault();
      a.versColonne(t, cible.cle);
    }
  };
  return (
    <View ref={ref as never} testID={`carte-${t.id}`} style={[styles.carte, { backgroundColor: theme.surface, borderColor: glisse ? theme.accent : theme.ligne, borderRadius: Math.min(theme.rayonMoyen, 12), borderLeftColor: couleurPriorite(t.priorite, theme) }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t.titre}. Statut ${statutDe(a.etat.donnees, t).nom}.${droits.modifier ? ' Maj + flèche gauche ou droite pour changer de colonne.' : ''}`}
        onPress={() => a.ouvrir(t.id)}
        {...({ onKeyDown: surTouche } as object)}
        testID={`carte-ouvrir-${t.id}`}
        style={{ gap: 8 }}>
        <Text numberOfLines={3} style={[texteDe(theme, T.corps), { fontWeight: '600', textDecorationLine: ferme ? 'line-through' : 'none' }]}>
          {t.titre}
        </Text>
        {t.etiquettes.length ? (
          <View style={styles.meta}>
            {t.etiquettes.slice(0, 3).map(e => (
              <Puce key={e} theme={theme} texte={`#${e}`} couleur={theme.teintes.anime} />
            ))}
          </View>
        ) : null}
        <View style={[styles.meta, { justifyContent: 'space-between' }]}>
          <View style={styles.meta}>
            {t.priorite !== 'normale' ? <PastillePriorite theme={theme} priorite={t.priorite} compacte /> : null}
            {ech ? <Text style={[attenueDe(theme), { color: ech.couleur }]}>{ech.texte}</Text> : null}
            <Compteurs a={a} t={t} />
          </View>
          {t.assigne ? <Avatar theme={theme} nom={a.etat.noms[t.assigne]} couleur={couleurAuteur(a, t.assigne)} taille={24} /> : null}
        </View>
      </Pressable>
      {a.mobile && droits.modifier ? (
        <View style={[styles.meta, { justifyContent: 'space-between' }]}>
          <Bouton theme={theme} compact titre="‹" libelle="Colonne précédente" desactive={iColonne === 0} onPress={() => colonnes[iColonne - 1] && a.versColonne(t, colonnes[iColonne - 1].cle)} testID={`carte-gauche-${t.id}`} />
          <Bouton theme={theme} compact titre="Statut…" onPress={() => a.menuStatut(t)} testID={`carte-statut-${t.id}`} />
          <Bouton theme={theme} compact titre="›" libelle="Colonne suivante" desactive={iColonne >= colonnes.length - 1} onPress={() => colonnes[iColonne + 1] && a.versColonne(t, colonnes[iColonne + 1].cle)} testID={`carte-droite-${t.id}`} />
        </View>
      ) : null}
    </View>
  );
}

function ColonneKanban({ a, g, colonnes, i, largeur }: { a: Actions; g: GroupeTaches; colonnes: readonly GroupeTaches[]; i: number; largeur: number }) {
  const theme = a.theme;
  const zone = useZoneDepot(`statut:${g.cle}`);
  return (
    <View
      ref={zone.ref as never}
      testID={`colonne-${g.cle}`}
      style={[
        styles.colonne,
        { width: largeur, borderRadius: Math.min(theme.rayonGrand, 14), backgroundColor: zone.survolee ? teinteTransparente(theme.accent, 0.16) : teinteTransparente(theme.sombre ? '#FFFFFF' : '#000000', 0.035), borderColor: zone.survolee ? theme.accent : 'transparent' },
      ]}>
      <View style={styles.colonneTete}>
        <View style={[styles.point, { backgroundColor: g.couleur ?? theme.attenue }]} />
        <Text style={[titreDe(theme, 16), { flex: 1 }]} numberOfLines={1}>
          {g.titre}
        </Text>
        <Text style={attenueDe(theme)}>{g.taches.length}</Text>
      </View>
      {g.taches.length === 0 ? <Text style={[attenueDe(theme), { textAlign: 'center', paddingVertical: 18 }]}>Déposez une carte ici</Text> : null}
      {g.taches.map(t => (
        <CarteKanban key={t.id} a={a} t={t} colonnes={colonnes} iColonne={i} />
      ))}
    </View>
  );
}

export function VueKanban({ a, taches, projetId }: { a: Actions; taches: readonly Tache[]; projetId?: string }) {
  const { width } = useWindowDimensions();
  const colonnes = grouper(a.etat.donnees, taches, 'statut', a.etat.aujourdhui, projetId);
  const largeur = a.mobile ? Math.min(300, width - 56) : 282;
  return (
    <ScrollView horizontal testID="vue-kanban" contentContainerStyle={{ gap: 12, paddingBottom: 12, alignItems: 'flex-start' }} showsHorizontalScrollIndicator>
      {colonnes.map((g, i) => (
        <ColonneKanban key={g.cle} a={a} g={g} colonnes={colonnes} i={i} largeur={largeur} />
      ))}
    </ScrollView>
  );
}

// ------------------------------------------------------------------ Calendrier

function PuceCalendrier({ a, t }: { a: Actions; t: Tache }) {
  const theme = a.theme;
  const droits = a.droits(t.projetId);
  const ferme = estTerminee(a.etat.donnees, t);
  const { ref, glisse } = useGlissable({ actif: droits.modifier, onDeposer: zone => zone.startsWith('jour:') && a.changer(t.id, { echeance: { jour: zone.slice(5), ...(t.echeance?.heure ? { heure: t.echeance.heure } : {}) } }) });
  const c = couleurPriorite(t.priorite, theme);
  const surTouche = (e: { key: string; shiftKey?: boolean; preventDefault(): void }) => {
    if (!droits.modifier || !e.shiftKey || !t.echeance) return;
    const pas = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 }[e.key];
    if (pas) {
      e.preventDefault();
      a.changer(t.id, { echeance: { ...t.echeance, jour: ajouterJours(t.echeance.jour, pas) } });
    }
  };
  return (
    <View ref={ref as never} testID={`cal-tache-${t.id}`} style={[styles.puceCal, { backgroundColor: teinteTransparente(c, glisse ? 0.4 : 0.16), borderLeftColor: c, borderRadius: 6 }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t.titre}${droits.modifier ? '. Maj + flèches pour changer de jour.' : ''}`}
        onPress={() => a.ouvrir(t.id)}
        {...({ onKeyDown: surTouche } as object)}
        style={{ minHeight: 26, justifyContent: 'center' }}>
        <Text numberOfLines={1} style={[texteDe(theme, T.petit), { textDecorationLine: ferme ? 'line-through' : 'none', color: ferme ? theme.attenue : theme.texte }]}>
          {t.echeance?.heure ? `${t.echeance.heure} ` : ''}
          {t.titre}
        </Text>
      </Pressable>
    </View>
  );
}

function CaseJour({ a, jour, taches, moisCourant, hauteur, max, onChoisir, choisi }: { a: Actions; jour: string; taches: Tache[]; moisCourant: boolean; hauteur?: number; max: number; onChoisir?(): void; choisi?: boolean }) {
  const theme = a.theme;
  const zone = useZoneDepot(`jour:${jour}`);
  const auj = jour === a.etat.aujourdhui;
  const [tout, setTout] = useState(false);
  const visibles = tout ? taches : taches.slice(0, max);
  return (
    <View
      ref={zone.ref as never}
      testID={`jour-${jour}`}
      style={[
        styles.caseJour,
        {
          minHeight: hauteur,
          borderColor: zone.survolee ? theme.accent : theme.ligne,
          backgroundColor: zone.survolee ? teinteTransparente(theme.accent, 0.16) : choisi ? teinteTransparente(theme.accent, 0.08) : moisCourant ? 'transparent' : teinteTransparente(theme.sombre ? '#FFFFFF' : '#000000', 0.03),
        },
      ]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${jourLisible(jour, a.etat.aujourdhui, true)} : ${taches.length} tâche(s)`} onPress={onChoisir} style={styles.numeroJour} disabled={!onChoisir}>
        <Text style={[texteDe(theme, T.petit), { fontWeight: auj ? '800' : '500', color: auj ? theme.surAccent : moisCourant ? theme.texte : theme.attenue, backgroundColor: auj ? theme.accent : 'transparent', paddingHorizontal: 6, borderRadius: 10, overflow: 'hidden' }]}>
          {Number(jour.slice(8, 10))}
        </Text>
        {a.mobile && taches.length ? <View style={[styles.pointJour, { backgroundColor: theme.accent }]} /> : null}
      </Pressable>
      {a.mobile ? null : visibles.map(t => <PuceCalendrier key={t.id} a={a} t={t} />)}
      {!a.mobile && taches.length > max && !tout ? (
        <Pressable accessibilityRole="button" onPress={() => setTout(true)} style={{ minHeight: 24 }}>
          <Text style={attenueDe(theme)}>+{taches.length - max} autres</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ZoneSansDate({ a, taches }: { a: Actions; taches: readonly Tache[] }) {
  const theme = a.theme;
  return (
    <View testID="cal-sans-date" style={[styles.sansDate, { borderColor: theme.ligne, borderRadius: Math.min(theme.rayonMoyen, 12) }]}>
      <Text style={titreDe(theme, 16)}>Sans échéance</Text>
      <Text style={attenueDe(theme)}>Glissez une tâche sur un jour pour la planifier.</Text>
      <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ gap: 6 }}>
        {taches.length === 0 ? <Text style={attenueDe(theme)}>Tout est planifié.</Text> : taches.map(t => <PuceCalendrier key={t.id} a={a} t={t} />)}
      </ScrollView>
    </View>
  );
}

export function VueCalendrier({ a, taches, mode, onMode, jour, onJour }: { a: Actions; taches: readonly Tache[]; mode: 'mois' | 'semaine'; onMode(m: 'mois' | 'semaine'): void; jour: string; onJour(j: string): void }) {
  const theme = a.theme;
  const { width } = useWindowDimensions();
  const [choisi, setChoisi] = useState(a.etat.aujourdhui);
  const jours = mode === 'mois' ? grilleMois(jour) : grilleSemaine(jour);
  const parJour = useMemo(() => tachesParJour(taches, jours), [taches, jours.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const sansDate = taches.filter(t => !t.echeance && !estTerminee(a.etat.donnees, t));
  const moisCourant = jour.slice(0, 7);
  const titre = mode === 'mois' ? `${MOIS[Number(jour.slice(5, 7)) - 1]} ${jour.slice(0, 4)}` : `Semaine du ${jourLisible(debutSemaine(jour), a.etat.aujourdhui, true)}`;
  const avecColonne = !a.mobile && width >= 1180;
  const aller = (n: number) => onJour(mode === 'mois' ? ajouterMois(`${jour.slice(0, 8)}01`, n) : ajouterJours(jour, 7 * n));
  return (
    <View testID="vue-calendrier" style={{ gap: 12 }}>
      <View style={[styles.meta, { justifyContent: 'space-between' }]}>
        <View style={styles.meta}>
          <Bouton theme={theme} compact={!a.mobile} titre="‹" libelle={mode === 'mois' ? 'Mois précédent' : 'Semaine précédente'} onPress={() => aller(-1)} testID="cal-precedent" />
          <Text style={[titreDe(theme, 19), { minWidth: 160, textAlign: 'center', textTransform: 'capitalize' }]} testID="cal-titre">
            {titre}
          </Text>
          <Bouton theme={theme} compact={!a.mobile} titre="›" libelle={mode === 'mois' ? 'Mois suivant' : 'Semaine suivante'} onPress={() => aller(1)} testID="cal-suivant" />
          <Bouton theme={theme} compact={!a.mobile} titre="Aujourd’hui" onPress={() => onJour(a.etat.aujourdhui)} testID="cal-aujourdhui" />
        </View>
        <View style={styles.meta}>
          <Puce theme={theme} grand={a.mobile} texte="Mois" actif={mode === 'mois'} couleur={theme.accent} onPress={() => onMode('mois')} testID="cal-mode-mois" />
          <Puce theme={theme} grand={a.mobile} texte="Semaine" actif={mode === 'semaine'} couleur={theme.accent} onPress={() => onMode('semaine')} testID="cal-mode-semaine" />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          {mode === 'semaine' && a.mobile ? (
            <View style={{ gap: 8 }}>
              {jours.map(j => (
                <View key={j} style={[styles.jourSemaineMobile, { borderColor: theme.ligne, borderRadius: Math.min(theme.rayonMoyen, 12) }]}>
                  <Text style={[titreDe(theme, 16), { textTransform: 'capitalize' }]}>{jourLisible(j, a.etat.aujourdhui, true)}</Text>
                  {(parJour[j] ?? []).length === 0 ? <Text style={attenueDe(theme)}>Rien de prévu.</Text> : (parJour[j] ?? []).map(t => <PuceCalendrier key={t.id} a={a} t={t} />)}
                </View>
              ))}
            </View>
          ) : (
            <>
              <View style={styles.semaine}>
                {JOURS_COURTS.map(n => (
                  <Text key={n} style={[attenueDe(theme), styles.nomJour]}>
                    {n}
                  </Text>
                ))}
              </View>
              {Array.from({ length: jours.length / 7 }, (_, s) => (
                <View key={s} style={styles.semaine}>
                  {jours.slice(s * 7, s * 7 + 7).map(j => (
                    <CaseJour
                      key={j}
                      a={a}
                      jour={j}
                      taches={parJour[j] ?? []}
                      moisCourant={mode === 'semaine' || j.slice(0, 7) === moisCourant}
                      hauteur={a.mobile ? 52 : mode === 'semaine' ? 360 : 104}
                      max={mode === 'semaine' ? 30 : 3}
                      onChoisir={a.mobile ? () => setChoisi(j) : undefined}
                      choisi={a.mobile && choisi === j}
                    />
                  ))}
                </View>
              ))}
            </>
          )}
          {a.mobile && mode === 'mois' ? (
            <View style={{ gap: 8, marginTop: 12 }} testID="cal-jour-choisi">
              <Text style={[titreDe(theme, 17), { textTransform: 'capitalize' }]}>{jourLisible(choisi, a.etat.aujourdhui, true)}</Text>
              {(tachesParJour(taches, [choisi])[choisi] ?? []).length === 0 ? (
                <Text style={attenueDe(theme)}>Rien de prévu ce jour-là.</Text>
              ) : (
                (tachesParJour(taches, [choisi])[choisi] ?? []).map(t => <LigneTache key={t.id} a={a} t={t} compacte />)
              )}
            </View>
          ) : null}
        </View>
        {avecColonne ? <ZoneSansDate a={a} taches={sansDate} /> : null}
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ Ma journée

function LigneJournee({ a, t }: { a: Actions; t: Tache }) {
  const theme = a.theme;
  const d = a.etat.donnees;
  const droits = a.droits(t.projetId);
  const ech = libelleEcheance(a, t);
  const choisie = t.pourAujourdhui === a.etat.aujourdhui;
  return (
    <View testID={`journee-${t.id}`} style={[styles.ligneMobile, { borderColor: theme.ligne, backgroundColor: theme.surface, borderRadius: Math.min(theme.rayonMoyen, 12) }]}>
      <CaseRonde theme={theme} coche={estTerminee(d, t)} desactive={!droits.modifier} onPress={() => a.basculer(t.id)} libelle={`Terminer « ${t.titre} »`} testID={`case-${t.id}`} />
      <Pressable accessibilityRole="button" onPress={() => a.ouvrir(t.id)} style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text numberOfLines={2} style={[texteDe(theme, a.mobile ? 17 : T.fort), { fontWeight: '600' }]}>
          {t.titre}
        </Text>
        <View style={styles.meta}>
          <Text style={attenueDe(theme)} numberOfLines={1}>
            {d.projets[t.projetId]?.nom}
          </Text>
          {ech ? <Text style={[attenueDe(theme), { color: ech.couleur }]}>{ech.texte}</Text> : null}
          {t.priorite !== 'normale' ? <PastillePriorite theme={theme} priorite={t.priorite} compacte /> : null}
          {t.assigne ? <Avatar theme={theme} nom={a.etat.noms[t.assigne]} couleur={couleurAuteur(a, t.assigne)} taille={22} /> : null}
        </View>
      </Pressable>
      {droits.modifier ? (
        <Pressable
          testID={`journee-choisir-${t.id}`}
          accessibilityRole="button"
          accessibilityLabel={choisie ? 'Retirer de Ma journée' : 'Ajouter à Ma journée'}
          onPress={() => a.basculerJournee(t)}
          style={[styles.soleil, { backgroundColor: choisie ? teinteTransparente(theme.alerte, 0.2) : 'transparent', borderRadius: 22 }]}>
          <Text style={{ fontSize: 18, color: choisie ? theme.alerte : theme.attenue }}>☀︎</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function VueJournee({ a, taches, qui }: { a: Actions; taches: readonly Tache[]; qui: 'fondateur' | 'ami' }) {
  const theme = a.theme;
  const j = maJournee(a.etat.donnees, a.etat.aujourdhui, qui, taches);
  const sections: Array<[string, string, Tache[], string]> = [
    ['retard', 'En retard', j.retard, theme.critique],
    ['aujourdhui', 'Dû aujourd’hui', j.aujourdhui, theme.alerte],
    ['choisies', 'Choisies pour aujourd’hui', j.choisies, theme.accent],
    ['avenir', 'À venir (7 jours)', j.aVenir, theme.attenue],
  ];
  const vide = sections.every(s => s[2].length === 0);
  return (
    <View testID="vue-journee" style={{ gap: 18 }}>
      <View style={{ gap: 4 }}>
        <Text style={[titreDe(theme, a.mobile ? 24 : T.grand), { textTransform: 'capitalize' }]}>{jourLisible(a.etat.aujourdhui, '0000-00-00', true)}</Text>
        <Text style={attenueDe(theme)}>
          {j.retard.length + j.aujourdhui.length + j.choisies.length} tâche(s) pour aujourd’hui · {j.aVenir.length} cette semaine
        </Text>
      </View>
      {vide ? (
        <EtatVide
          theme={theme}
          testID="journee-vide"
          titre="Journée libre"
          texte="Rien en retard ni prévu aujourd’hui. Donnez une échéance à une tâche, ou touchez ☀︎ sur une tâche pour la choisir pour aujourd’hui."
        />
      ) : (
        sections
          .filter(s => s[2].length > 0)
          .map(([cle, titre, liste, couleur]) => (
            <View key={cle} style={{ gap: 8 }} testID={`journee-section-${cle}`}>
              <View style={styles.groupeTete}>
                <View style={[styles.point, { backgroundColor: couleur }]} />
                <Text style={titreDe(theme, 16)}>{titre}</Text>
                <Text style={attenueDe(theme)}>{liste.length}</Text>
              </View>
              {liste.map(t => (
                <LigneJournee key={t.id} a={a} t={t} />
              ))}
            </View>
          ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  ligne: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, paddingHorizontal: 6, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 52 },
  entete: { minHeight: 36, paddingVertical: 4 },
  colonneTitre: { fontWeight: '700', fontSize: 15 },
  ligneMobile: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderWidth: 1, minHeight: 56 },
  cellule: { minHeight: 40, justifyContent: 'center' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  champEnPlace: { borderWidth: 1, paddingHorizontal: 8, minHeight: 36, flex: 1 },
  groupeTete: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36 },
  point: { width: 10, height: 10, borderRadius: 5 },
  colonne: { padding: 10, gap: 10, borderWidth: 2 },
  colonneTete: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 },
  carte: { borderWidth: 1, borderLeftWidth: 4, padding: 12, gap: 8 },
  semaine: { flexDirection: 'row' },
  nomJour: { flex: 1, textAlign: 'center', paddingVertical: 4, fontWeight: '700', ...police(undefined) },
  caseJour: { flex: 1, minWidth: 0, borderWidth: StyleSheet.hairlineWidth, padding: 3, gap: 3 },
  numeroJour: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 24 },
  pointJour: { width: 6, height: 6, borderRadius: 3 },
  puceCal: { borderLeftWidth: 3, paddingHorizontal: 5 },
  sansDate: { width: 240, borderWidth: 1, padding: 12, gap: 8 },
  jourSemaineMobile: { borderWidth: 1, padding: 12, gap: 8 },
  soleil: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
