/**
 * Suppression et corbeille de Tâches : menu « ⋯ » d'un espace / projet /
 * liste, confirmation qui dit ce qui part (« 3 projets, 42 tâches ») avec
 * l'option de déplacer le contenu avant, et la corbeille (30 jours) d'où
 * restaurer ou supprimer définitivement.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { teinteTransparente } from '../../hub/themes';
import { bilanSuppression, ciblesDeplacement, DUREE_CORBEILLE_JOURS, elementsCorbeille, LIBELLES_GENRE, texteContenu, type ElementCorbeille, type Genre } from '../corbeille';
import { COLLECTION } from '../corbeille';
import { membresDuProjet } from '../membres';
import { listesDe, vivant, type Entite } from '../modele';
import type { Actions } from './actions';
import { attenueDe, Bouton, Dialogue, Libelle, Options, texteDe } from './atomes';

type Fermer = () => void;

const ICONES: Record<Genre, string> = { espace: '▣', projet: '●', liste: '☰', tache: '☐' };

function nomDe(a: Actions, genre: Genre, id: string): string {
  const e = a.etat.donnees[COLLECTION[genre]][id] as (Entite & { nom?: string; titre?: string }) | undefined;
  return (genre === 'tache' ? e?.titre : e?.nom) ?? '';
}

// ------------------------------------------------------------------ Menu « ⋯ »

export interface ElementMenu {
  texte: string;
  detail?: string;
  danger?: boolean;
  testID: string;
  action(): void;
}

export function DialogueMenu({ a, titre, elements, onFermer, testID }: { a: Actions; titre: string; elements: readonly ElementMenu[]; onFermer: Fermer; testID: string }) {
  return (
    <Dialogue theme={a.theme} mobile={a.mobile} visible titre={titre} onFermer={onFermer} testID={testID}>
      <View style={{ gap: 6 }}>
        {elements.map(e => (
          <Bouton
            key={e.testID}
            theme={a.theme}
            titre={e.texte}
            variante={e.danger ? 'danger' : 'normal'}
            libelle={e.detail ? `${e.texte} — ${e.detail}` : e.texte}
            onPress={() => {
              onFermer();
              e.action();
            }}
            testID={e.testID}
            style={styles.ligneMenu}
          />
        ))}
      </View>
    </Dialogue>
  );
}

// ------------------------------------------------------------------ Confirmation

export function DialogueSuppression({ a, genre, id, onFermer, onConfirmer }: { a: Actions; genre: Genre; id: string; onFermer: Fermer; onConfirmer(deplacerVers?: string): void }) {
  const theme = a.theme;
  const d = a.etat.donnees;
  const e = d[COLLECTION[genre]][id] as Entite | undefined;
  const cibles = ciblesDeplacement(d, genre, id);
  const bilan = bilanSuppression(d, genre, id);
  const contenu = texteContenu(bilan, genre);
  // Membres qui voient les projets supprimés (V3 : plusieurs ; l'ami des V1/V2 compris).
  const projetsTouches = genre === 'projet' ? [id] : genre === 'espace' ? Object.values(d.projets).filter(p => vivant(p) && p.espaceId === id).map(p => p.id) : [];
  const nomsTouches = [...new Set(projetsTouches.flatMap(pid => membresDuProjet(d, pid).map(m => m.nom)))];
  const avecQui = nomsTouches.length > 1 ? `${nomsTouches.slice(0, -1).join(', ')} et ${nomsTouches.at(-1)}` : (nomsTouches[0] ?? '');
  const aDuContenu = genre !== 'tache' && contenu !== 'vide';
  const [mode, setMode] = useState<'corbeille' | 'deplacer'>('corbeille');
  const [cible, setCible] = useState<string | undefined>(cibles[0]?.id);
  if (!vivant(e)) return null;
  const nom = nomDe(a, genre, id);
  const derniere = genre === 'liste' && listesDe(d, (e as Entite & { projetId: string }).projetId).length <= 1;
  const derniereEspace = genre === 'espace' && cibles.length === 0;
  const article = genre === 'liste' || genre === 'tache' ? 'la' : 'le';
  const titre = genre === 'tache' ? `Supprimer « ${nom} » ?` : `Supprimer ${genre === 'espace' ? 'l’espace' : `${article} ${LIBELLES_GENRE[genre].toLowerCase()}`} « ${nom} » ?`;
  const quoi = genre === 'espace' ? 'les projets' : genre === 'projet' ? 'les listes et leurs tâches' : 'les tâches';
  const vers = genre === 'espace' ? 'vers l’espace' : genre === 'projet' ? 'vers le projet' : 'vers la liste';
  const deplacer = mode === 'deplacer' && aDuContenu && cible;
  return (
    <Dialogue
      theme={theme}
      mobile={a.mobile}
      visible
      titre={titre}
      onFermer={onFermer}
      testID="dialogue-suppression"
      pied={
        <>
          <Bouton theme={theme} titre="Annuler" variante="discret" onPress={onFermer} testID="suppression-annuler" />
          <Bouton
            theme={theme}
            titre={deplacer ? 'Déplacer et supprimer' : 'Mettre à la corbeille'}
            variante="danger"
            desactive={derniere || (mode === 'deplacer' && !cible)}
            onPress={() => {
              onFermer();
              onConfirmer(deplacer ? cible : undefined);
            }}
            testID="suppression-confirmer"
          />
        </>
      }>
      {derniere ? (
        <Text style={texteDe(theme)} testID="suppression-bilan">
          C’est la seule liste du projet : un projet garde au moins une liste. Supprimez plutôt le projet, ou créez d’abord une autre liste.
        </Text>
      ) : (
        <Text style={texteDe(theme)} testID="suppression-bilan">
          {genre === 'tache' ? (contenu === 'vide' ? 'La tâche' : `La tâche et ${contenu}`) : `Contenu : ${contenu}.`} {genre === 'tache' ? 'ira' : 'Tout ira'} à la corbeille {DUREE_CORBEILLE_JOURS} jours : « Annuler » pendant 10 s, puis restauration possible depuis la corbeille.
        </Text>
      )}
      {bilan.partages > 0 && avecQui ? (
        <Text style={[texteDe(theme), { color: theme.alerte }]} testID="suppression-partage">
          {bilan.partages > 1 ? `${bilan.partages} projets sont partagés` : 'Un projet est partagé'} avec {avecQui} : {bilan.partages > 1 ? 'ils disparaîtront' : 'il disparaîtra'} aussi chez {nomsTouches.length > 1 ? 'eux' : avecQui}
          {mode === 'deplacer' && genre === 'espace' ? ' (sauf si vous déplacez les projets, qui restent partagés)' : ''}.
        </Text>
      ) : null}
      {derniereEspace ? <Text style={attenueDe(theme)}>C’est votre dernier espace : un espace « Personnel » vide le remplacera.</Text> : null}
      {aDuContenu && !derniere ? (
        <>
          <Libelle theme={theme}>SON CONTENU</Libelle>
          <Options
            theme={theme}
            valeur={mode}
            onChoisir={v => setMode(v)}
            testID="suppression-mode"
            options={[
              { valeur: 'corbeille', texte: 'Tout mettre à la corbeille', detail: contenu },
              ...(cibles.length ? [{ valeur: 'deplacer' as const, texte: `Déplacer d’abord ${quoi}`, detail: `${vers} de votre choix, puis supprimer ${genre === 'espace' ? 'l’espace' : genre === 'projet' ? 'le projet' : 'la liste'} vide` }] : []),
            ]}
          />
          {mode === 'deplacer' ? (
            <>
              <Libelle theme={theme}>{`DÉPLACER ${vers.toUpperCase()}`}</Libelle>
              <Options theme={theme} valeur={cible} onChoisir={setCible} options={cibles.map(c => ({ valeur: c.id, texte: c.nom }))} testID="suppression-cible" />
            </>
          ) : null}
        </>
      ) : null}
    </Dialogue>
  );
}

// ------------------------------------------------------------------ Corbeille

function LigneCorbeille({ a, e, onRestaurer, onEffacer }: { a: Actions; e: ElementCorbeille; onRestaurer(): void; onEffacer(): void }) {
  const theme = a.theme;
  const [confirmer, setConfirmer] = useState(false);
  const fondateur = a.etat.role === 'fondateur';
  const date = new Date(e.supprimeLe).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  return (
    <View style={[styles.ligne, { borderColor: theme.ligne, borderRadius: Math.min(theme.rayonMoyen, 10) }]} testID={`corbeille-${e.id}`}>
      <View style={styles.rangee}>
        <Text style={{ color: theme.attenue, fontSize: 17, width: 22, textAlign: 'center' }}>{ICONES[e.genre]}</Text>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={[texteDe(theme), { fontWeight: '700' }]} numberOfLines={2}>
            {LIBELLES_GENRE[e.genre]} « {e.nom} »
          </Text>
          <Text style={attenueDe(theme)}>
            {[e.ou, e.contenu && e.contenu !== 'vide' ? e.contenu : '', `supprimé${e.genre === 'liste' || e.genre === 'tache' ? 'e' : ''} le ${date}`, `encore ${e.resteJours} j`].filter(Boolean).join(' · ')}
          </Text>
          {e.raison ? <Text style={[attenueDe(theme), { color: theme.alerte }]}>{e.raison}</Text> : null}
        </View>
      </View>
      {confirmer ? (
        <View style={styles.rangee}>
          <Text style={[texteDe(theme), { flex: 1, minWidth: 160 }]}>Supprimer définitivement ? C’est irréversible.</Text>
          <Bouton theme={theme} titre="Non" onPress={() => setConfirmer(false)} testID={`corbeille-effacer-non-${e.id}`} />
          <Bouton theme={theme} variante="danger" titre="Supprimer" onPress={onEffacer} testID={`corbeille-effacer-oui-${e.id}`} />
        </View>
      ) : (
        <View style={[styles.rangee, { justifyContent: 'flex-end' }]}>
          {fondateur ? <Bouton theme={theme} variante="discret" titre="Supprimer définitivement" onPress={() => setConfirmer(true)} testID={`corbeille-effacer-${e.id}`} /> : null}
          <Bouton theme={theme} variante="plein" titre="Restaurer" desactive={!e.restaurable} onPress={onRestaurer} testID={`corbeille-restaurer-${e.id}`} />
        </View>
      )}
    </View>
  );
}

export function DialogueCorbeille({ a, onFermer, onRestaurer, onEffacer, onVider }: { a: Actions; onFermer: Fermer; onRestaurer(e: ElementCorbeille): void; onEffacer(e: ElementCorbeille): void; onVider(): void }) {
  const theme = a.theme;
  const elements = elementsCorbeille(a.etat.donnees, a.etat.maintenant(), a.etat.role);
  const [vider, setVider] = useState(false);
  const fondateur = a.etat.role === 'fondateur';
  return (
    <Dialogue
      theme={theme}
      mobile={a.mobile}
      visible
      large
      titre="Corbeille"
      description={`Ce que vous supprimez reste ${DUREE_CORBEILLE_JOURS} jours ici, puis s’efface. Restaurer rend tout ce qui a été supprimé ensemble${fondateur && a.etat.donnees.reglages.amiNom ? ` (et un projet partagé réapparaît chez ${a.etat.donnees.reglages.amiNom})` : ''}.`}
      onFermer={onFermer}
      testID="dialogue-corbeille"
      pied={
        fondateur && elements.length ? (
          vider ? (
            <>
              <Bouton theme={theme} titre="Non" onPress={() => setVider(false)} />
              <Bouton
                theme={theme}
                variante="danger"
                titre={`Tout supprimer définitivement (${elements.length})`}
                onPress={() => {
                  setVider(false);
                  onVider();
                }}
                testID="corbeille-vider-confirmer"
              />
            </>
          ) : (
            <Bouton theme={theme} variante="danger" titre="Vider la corbeille" onPress={() => setVider(true)} testID="corbeille-vider" />
          )
        ) : undefined
      }>
      {elements.length === 0 ? (
        <Text style={attenueDe(theme)} testID="corbeille-vide">
          La corbeille est vide.
        </Text>
      ) : null}
      {elements.map(e => (
        <LigneCorbeille key={`${e.genre}-${e.id}`} a={a} e={e} onRestaurer={() => onRestaurer(e)} onEffacer={() => onEffacer(e)} />
      ))}
    </Dialogue>
  );
}

/** Avis « … supprimé — Annuler » (10 s). */
export function AvisAnnulable({ a, texte, onAnnuler, bas }: { a: Actions; texte: string; onAnnuler(): void; bas: number }) {
  const theme = a.theme;
  return (
    <View pointerEvents="box-none" style={[styles.avis, { bottom: bas }]}>
      <View style={[styles.avisBoite, { backgroundColor: theme.texte, borderRadius: Math.min(theme.rayonMoyen, 10) }]} testID="taches-annulable">
        <Text style={[texteDe(theme), { color: theme.fond, flexShrink: 1 }]} accessibilityLiveRegion="polite">
          {texte}
        </Text>
        <Bouton theme={theme} titre="Annuler" variante="plein" onPress={onAnnuler} testID="taches-annuler" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rangee: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  ligne: { borderWidth: 1, padding: 10, gap: 8 },
  ligneMenu: { alignItems: 'flex-start' },
  avis: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: 16 },
  avisBoite: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingRight: 6, paddingVertical: 6, maxWidth: 640, borderWidth: 1, borderColor: teinteTransparente('#000000', 0.1) },
});
