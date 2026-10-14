/**
 * Tâches (V2) : « Journal du jour » d'un projet (ce qu'on a fait, avec les
 * propositions du jour : tâches terminées et temps suivi) et « Débriefing »
 * (jour ou semaine) à lire par les autres membres du projet, à copier ou
 * exporter en Markdown / texte.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { teinteTransparente } from '../../hub/themes';
import { ajouterJours, debutSemaine, jourLisible } from '../dates';
import { ajouterEntree, debriefing, debriefingTexte, entrees, modifierEntree, propositions, supprimerEntree, type Proposition } from '../journal';
import { projetsDe, type EntreeJournal } from '../modele';
import { dureeLisible } from '../temps';
import type { Actions } from './actions';
import { attenueDe, Bouton, Champ, Dialogue, Libelle, Puce, texteDe } from './atomes';

type Onglet = 'journal' | 'debrief';

function LigneProposition({ a, p, onAjouter }: { a: Actions; p: Proposition; onAjouter(texte: string): void }) {
  const [texte, setTexte] = useState(`${p.texte}${p.minutes ? ` (${dureeLisible(p.minutes)})` : ''}`);
  return (
    <View style={[styles.rangee, { flexWrap: 'nowrap' }]} testID={`journal-proposition-${p.tacheId}`}>
      <Champ theme={a.theme} mobile={a.mobile} value={texte} onChangeText={setTexte} style={{ flex: 1 }} accessibilityLabel="Proposition à ajouter au journal" testID={`journal-proposition-texte-${p.tacheId}`} />
      <Bouton theme={a.theme} compact titre="＋" libelle="Ajouter au journal" onPress={() => onAjouter(texte)} desactive={!texte.trim()} testID={`journal-proposition-ajouter-${p.tacheId}`} />
    </View>
  );
}

function LigneEntree({ a, e, onOuvrir, onErreur }: { a: Actions; e: EntreeJournal; onOuvrir(id: string): void; onErreur(x: unknown): void }) {
  const theme = a.theme;
  const [edition, setEdition] = useState<string>();
  const t = e.tacheId ? a.etat.donnees.taches[e.tacheId] : undefined;
  const peut = a.droits(e.projetId).modifier && (e.auteur === a.etat.role || a.etat.role === 'fondateur');
  const essayer = (f: () => void) => {
    try {
      f();
    } catch (x) {
      onErreur(x);
    }
  };
  return (
    <View style={[styles.entree, { borderColor: theme.ligne, borderRadius: 10 }]} testID={`journal-entree-${e.id}`}>
      {edition !== undefined ? (
        <View style={[styles.rangee, { flexWrap: 'nowrap' }]}>
          <Champ theme={theme} mobile={a.mobile} value={edition} onChangeText={setEdition} autoFocus style={{ flex: 1 }} accessibilityLabel="Modifier l’entrée" testID={`journal-edition-${e.id}`} />
          <Bouton
            theme={theme}
            compact
            variante="plein"
            titre="OK"
            onPress={() =>
              essayer(() => {
                a.etat.maj((x, ctx) => modifierEntree(x, e.id, edition, ctx));
                setEdition(undefined);
              })
            }
            testID={`journal-edition-ok-${e.id}`}
          />
        </View>
      ) : (
        <Text style={texteDe(theme)}>
          {e.texte}
          {e.minutes ? <Text style={attenueDe(theme)}>{` · ${dureeLisible(e.minutes)}`}</Text> : null}
        </Text>
      )}
      <View style={styles.rangee}>
        <Text style={[attenueDe(theme), { flex: 1 }]}>
          {a.etat.noms[e.auteur]} · {new Date(e.creeLe).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
        </Text>
        {t ? <Bouton theme={theme} compact variante="discret" titre={`↗ ${t.titre.slice(0, 28)}`} libelle={`Ouvrir la tâche ${t.titre}`} onPress={() => onOuvrir(t.id)} /> : null}
        {peut && edition === undefined ? <Bouton theme={theme} compact variante="discret" titre="✎" libelle="Modifier l’entrée" onPress={() => setEdition(e.texte)} testID={`journal-modifier-${e.id}`} /> : null}
        {peut ? <Bouton theme={theme} compact variante="discret" titre="✕" libelle="Retirer l’entrée" onPress={() => essayer(() => a.etat.maj((x, ctx) => supprimerEntree(x, e.id, ctx)))} testID={`journal-retirer-${e.id}`} /> : null}
      </View>
    </View>
  );
}

export function DialogueJournal({
  a,
  projetId: projetDonne,
  tacheId,
  ongletInitial = 'journal',
  onFermer,
  onOuvrir,
  onErreur,
  onAvis,
  onExporter,
}: {
  a: Actions;
  projetId?: string;
  tacheId?: string;
  ongletInitial?: Onglet;
  onFermer(): void;
  onOuvrir(id: string): void;
  onErreur(e: unknown): void;
  onAvis(t: string): void;
  onExporter?(nom: string, contenu: string): void;
}) {
  const theme = a.theme;
  const d = a.etat.donnees;
  const role = a.etat.role;
  const ecrivables = projetsDe(d).filter(p => a.droits(p.id).modifier && !p.auto);
  const lisibles = projetsDe(d).filter(p => !p.auto);
  const [projetId, setProjetId] = useState<string | undefined>(projetDonne ?? (tacheId ? d.taches[tacheId]?.projetId : undefined) ?? ecrivables[0]?.id ?? lisibles[0]?.id);
  const [onglet, setOnglet] = useState<Onglet>(ongletInitial);
  const [jour, setJour] = useState(a.etat.aujourdhui);
  const [semaine, setSemaine] = useState(false);
  const [texte, setTexte] = useState('');
  const tache = tacheId ? d.taches[tacheId] : undefined;
  useEffect(() => setTexte(''), [projetId]);
  const p = projetId ? d.projets[projetId] : undefined;
  const ecrire = Boolean(p && a.droits(p.id).modifier);
  const essayer = (f: () => void) => {
    try {
      f();
    } catch (e) {
      onErreur(e);
    }
  };
  const ajouter = (t: string, lien?: { tacheId?: string; minutes?: number }) =>
    essayer(() => {
      if (!projetId) return;
      a.etat.maj((x, ctx) => ajouterEntree(x, { projetId, jour, texte: t, ...lien }, ctx).donnees);
      setTexte('');
    });
  const du = semaine ? debutSemaine(jour) : jour;
  const au = semaine ? ajouterJours(du, 6) : jour;
  const deb = projetId ? debriefing(d, projetId, du, au, a.etat.noms) : undefined;
  const copier = (format: 'markdown' | 'texte') => {
    if (!deb) return;
    const contenu = debriefingTexte(deb, format, a.etat.aujourdhui);
    const presse = (globalThis as { navigator?: { clipboard?: { writeText?(t: string): Promise<void> } } }).navigator?.clipboard;
    if (presse?.writeText) {
      presse.writeText(contenu).then(
        () => onAvis(format === 'markdown' ? 'Débriefing copié (Markdown).' : 'Débriefing copié (texte).'),
        () => onExporter?.(`debriefing-${deb.projet}-${du}.${format === 'markdown' ? 'md' : 'txt'}`, contenu),
      );
    } else onExporter?.(`debriefing-${deb.projet}-${du}.${format === 'markdown' ? 'md' : 'txt'}`, contenu);
  };
  const liste = projetId ? entrees(d, projetId, jour) : [];
  const props = projetId && ecrire && jour === a.etat.aujourdhui ? propositions(d, projetId, jour, role) : [];
  return (
    <Dialogue
      theme={theme}
      mobile={a.mobile}
      visible
      large
      titre={p ? `${p.icone ? `${p.icone} ` : ''}${p.nom}` : 'Journal du jour'}
      onFermer={onFermer}
      testID="dialogue-journal"
      pied={
        onglet === 'debrief' && deb ? (
          <>
            {a.aides?.secrets.ia.actif && a.etat.role === 'fondateur' ? <Bouton theme={theme} titre="✨ Résumer (IA)" onPress={() => a.aides!.ouvrirIA({ genre: 'resumer', projetId: deb.projetId, debriefing: debriefingTexte(deb, 'texte', a.etat.aujourdhui) })} testID="debrief-ia" /> : null}
            <Bouton theme={theme} titre="Copier en texte" onPress={() => copier('texte')} testID="debrief-copier-texte" />
            <Bouton theme={theme} titre="Copier (Markdown)" onPress={() => copier('markdown')} testID="debrief-copier" />
            {onExporter ? <Bouton theme={theme} variante="plein" titre="Exporter .md" onPress={() => onExporter(`debriefing-${deb.projet.replace(/[^\p{L}\p{N}]+/gu, '-')}-${du}.md`, debriefingTexte(deb, 'markdown', a.etat.aujourdhui))} testID="debrief-exporter" /> : null}
          </>
        ) : undefined
      }>
      <View style={styles.rangee}>
        <Puce theme={theme} grand={a.mobile} texte="📓 Journal du jour" couleur={theme.accent} actif={onglet === 'journal'} onPress={() => setOnglet('journal')} testID="journal-onglet-journal" />
        <Puce theme={theme} grand={a.mobile} texte="Débriefing" couleur={theme.accent} actif={onglet === 'debrief'} onPress={() => setOnglet('debrief')} testID="journal-onglet-debrief" />
      </View>
      {!projetDonne && lisibles.length > 1 ? (
        <View style={styles.rangee}>
          {(onglet === 'journal' ? (ecrivables.length ? ecrivables : lisibles) : lisibles).map(x => (
            <Puce key={x.id} theme={theme} grand={a.mobile} texte={`${x.icone ?? ''}${x.icone ? ' ' : ''}${x.nom}`} couleur={x.couleur} actif={projetId === x.id} onPress={() => setProjetId(x.id)} testID={`journal-projet-${x.id}`} />
          ))}
        </View>
      ) : null}
      <View style={styles.rangee}>
        <Bouton theme={theme} compact titre="‹" libelle={semaine && onglet === 'debrief' ? 'Semaine précédente' : 'Jour précédent'} onPress={() => setJour(ajouterJours(jour, semaine && onglet === 'debrief' ? -7 : -1))} testID="journal-precedent" />
        <Text style={[texteDe(theme), { fontWeight: '700' }]} testID="journal-jour">
          {semaine && onglet === 'debrief' ? `Semaine du ${jourLisible(du, a.etat.aujourdhui)}` : jourLisible(jour, a.etat.aujourdhui, true)}
        </Text>
        <Bouton theme={theme} compact titre="›" libelle={semaine && onglet === 'debrief' ? 'Semaine suivante' : 'Jour suivant'} onPress={() => setJour(ajouterJours(jour, semaine && onglet === 'debrief' ? 7 : 1))} testID="journal-suivant" />
        {jour !== a.etat.aujourdhui ? <Bouton theme={theme} compact variante="discret" titre="Aujourd’hui" onPress={() => setJour(a.etat.aujourdhui)} /> : null}
        {onglet === 'debrief' ? (
          <>
            <Puce theme={theme} grand={a.mobile} texte="Jour" couleur={theme.teintes.admin} actif={!semaine} onPress={() => setSemaine(false)} testID="debrief-jour" />
            <Puce theme={theme} grand={a.mobile} texte="Semaine" couleur={theme.teintes.admin} actif={semaine} onPress={() => setSemaine(true)} testID="debrief-semaine" />
          </>
        ) : null}
      </View>
      {!p ? <Text style={attenueDe(theme)}>Aucun projet.</Text> : null}
      {p && onglet === 'journal' ? (
        <>
          {ecrire ? (
            <>
              {tache ? <Text style={attenueDe(theme)}>Pour la tâche « {tache.titre} »</Text> : null}
              <View style={[styles.rangee, { flexWrap: 'nowrap' }]}>
                <Champ theme={theme} mobile={a.mobile} value={texte} onChangeText={setTexte} onSubmitEditing={() => texte.trim() && ajouter(texte, tache ? { tacheId: tache.id } : undefined)} placeholder="Ce que j’ai fait…" style={{ flex: 1 }} autoFocus={!a.mobile} testID="journal-champ" accessibilityLabel="Ce que j’ai fait" />
                <Bouton theme={theme} variante="plein" titre="Noter" desactive={!texte.trim()} onPress={() => ajouter(texte, tache ? { tacheId: tache.id } : undefined)} testID="journal-ajouter" />
              </View>
            </>
          ) : (
            <Text style={attenueDe(theme)}>Lecture seule : vous voyez le journal du projet.</Text>
          )}
          {props.length ? (
            <>
              <Libelle theme={theme}>PROPOSÉ D’APRÈS VOTRE JOURNÉE (MODIFIABLE)</Libelle>
              {props.map(x => (
                <LigneProposition key={x.cle} a={a} p={x} onAjouter={t => ajouter(t, { tacheId: x.tacheId, ...(x.minutes ? { minutes: x.minutes } : {}) })} />
              ))}
            </>
          ) : null}
          <Libelle theme={theme}>{`NOTÉ CE JOUR · ${liste.length}`}</Libelle>
          {liste.length === 0 ? <Text style={attenueDe(theme)}>Rien encore.</Text> : null}
          {liste.map(e => (
            <LigneEntree key={e.id} a={a} e={e} onOuvrir={onOuvrir} onErreur={onErreur} />
          ))}
        </>
      ) : null}
      {p && onglet === 'debrief' && deb ? (
        <View style={{ gap: 10 }} testID="debriefing">
          <View style={[styles.resume, { backgroundColor: teinteTransparente(theme.accent, 0.1), borderRadius: 12 }]} testID="debrief-resume">
            <Text style={[texteDe(theme), { fontWeight: '700' }]}>
              {deb.terminees.length} terminée{deb.terminees.length > 1 ? 's' : ''} · {dureeLisible(deb.minutes)} suivies · {deb.nbEntrees} entrée{deb.nbEntrees > 1 ? 's' : ''}
            </Text>
            {deb.terminees.map(t => (
              <Pressable key={t.id} accessibilityRole="link" onPress={() => onOuvrir(t.id)} style={styles.lien}>
                <Text style={[texteDe(theme), { color: theme.accent }]}>✓ {t.titre}</Text>
              </Pressable>
            ))}
          </View>
          {deb.parAuteur.map(x => (
            <View key={x.auteur} style={{ gap: 4 }} testID={`debrief-auteur-${x.auteur}`}>
              <Libelle theme={theme}>{`${x.nom.toUpperCase()}${x.minutes ? ` · ${dureeLisible(x.minutes)}` : ''}`}</Libelle>
              {x.groupes.map((g, i) => (
                <View key={g.tache?.id ?? `libre-${i}`} style={{ gap: 2 }}>
                  {g.tache ? (
                    <Pressable accessibilityRole="link" onPress={() => onOuvrir(g.tache!.id)} style={styles.lien}>
                      <Text style={[texteDe(theme), { color: theme.accent, fontWeight: '600' }]}>
                        {g.tache.titre}
                        {g.tache.terminee ? ' ✓' : ''}
                      </Text>
                    </Pressable>
                  ) : null}
                  {g.entrees.map(e => (
                    <Text key={e.id} style={[texteDe(theme), { paddingLeft: g.tache ? 14 : 0 }]}>
                      • {semaine ? `${jourLisible(e.jour, a.etat.aujourdhui)} · ` : ''}
                      {e.texte}
                      {e.minutes ? ` (${dureeLisible(e.minutes)})` : ''}
                    </Text>
                  ))}
                </View>
              ))}
              {!x.groupes.length ? <Text style={attenueDe(theme)}>Temps suivi, sans entrée au journal.</Text> : null}
            </View>
          ))}
          {!deb.parAuteur.length ? <Text style={attenueDe(theme)}>Rien de noté sur cette période.</Text> : null}
          <Libelle theme={theme}>CE QUI RESTE</Libelle>
          {[...deb.reste.retard.map(t => ['⚠ En retard', t] as const), ...deb.reste.attente.map(t => ['⏸ En attente', t] as const), ...deb.reste.aVenir.map(t => ['À venir', t] as const)].map(([l, t]) => (
            <Pressable key={`${l}-${t.id}`} accessibilityRole="link" onPress={() => onOuvrir(t.id)} style={styles.lien}>
              <Text style={texteDe(theme)}>
                {l} : <Text style={{ color: theme.accent }}>{t.titre}</Text>
              </Text>
            </Pressable>
          ))}
          <Text style={attenueDe(theme)}>{deb.reste.ouvertes} tâche(s) encore ouverte(s) dans le projet.</Text>
        </View>
      ) : null}
    </Dialogue>
  );
}

const styles = StyleSheet.create({
  rangee: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  entree: { borderWidth: 1, padding: 10, gap: 4 },
  resume: { padding: 12, gap: 4 },
  lien: { minHeight: 44, justifyContent: 'center' },
});
