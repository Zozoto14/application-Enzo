/**
 * Morceaux V3 du détail d'une tâche : personnes assignées (plusieurs),
 * commentaires avec mentions « @prénom », chronologie (début, jalon,
 * dépendances « fin → début »), lien GitHub, aide de l'IA.
 */

import React, { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { teinteTransparente } from '../../hub/themes';
import { lireDateLibre } from '../dates';
import { bornes, decalerSuivantes, dependanceViolee, violationsDe } from '../gantt';
import { LIBELLES_CI, LIBELLES_ETAT_GITHUB, lireLienSaisi, texteLien, urlLien } from '../github';
import { completerMention, decouperMentions, suggestionsMention, trouverMentions, type Personne } from '../mentions';
import { personnesDuProjet } from '../membres';
import { ajouterCommentaire, assignesDe, estTerminee, modifierTache, type Tache } from '../modele';
import type { Actions } from './actions';
import { attenueDe, Avatar, Bouton, Champ, Libelle, Puce, texteDe } from './atomes';
import { couleurAuteur } from './Vues';
import { BoutonCalendrier, formaterSaisie } from '../../ui/dates';

export const personnesPour = (a: Actions, projetId: string): Personne[] => personnesDuProjet(a.etat.donnees, projetId, a.etat.noms, { role: a.etat.role, moi: a.etat.moi });

/** Les personnes assignées, en clair (avatar + prénom). */
export function ListeAssignes({ a, t }: { a: Actions; t: Tache }) {
  const l = assignesDe(t);
  if (!l.length) return <Text style={attenueDe(a.theme)}>Personne</Text>;
  return (
    <View style={styles.rangee}>
      {l.map(x => (
        <View key={x} style={styles.rangee}>
          <Avatar theme={a.theme} nom={a.etat.noms[x] ?? 'Membre'} couleur={couleurAuteur(a, x)} taille={24} />
          <Text style={texteDe(a.theme)}>
            {a.etat.noms[x] ?? 'Membre'}
            {x === a.etat.moi ? ' (moi)' : ''}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Texte d'un commentaire, mentions mises en valeur. */
export function TexteMentions({ a, texte, personnes }: { a: Actions; texte: string; personnes: readonly Personne[] }) {
  return (
    <Text style={[texteDe(a.theme), { lineHeight: 22 }]}>
      {decouperMentions(texte, personnes).map((m, i) =>
        m.mention ? (
          <Text key={i} style={{ color: couleurAuteur(a, m.mention), fontWeight: '700' }} accessibilityLabel={`mention de ${a.etat.noms[m.mention] ?? 'Membre'}`}>
            {m.texte}
          </Text>
        ) : (
          <Text key={i}>{m.texte}</Text>
        ),
      )}
    </Text>
  );
}

/** Saisie d'un commentaire : « @ » propose les personnes du projet ; les mentionnés sont notifiés selon leurs réglages. */
export function ChampCommentaire({ a, t, onErreur }: { a: Actions; t: Tache; onErreur(e: unknown): void }) {
  const [texte, setTexte] = useState('');
  const personnes = personnesPour(a, t.projetId);
  const suggestions = suggestionsMention(texte, personnes, a.etat.moi);
  const mentions = trouverMentions(texte, personnes, a.etat.moi);
  const publier = () => {
    try {
      a.etat.maj((x, ctx) => ajouterCommentaire(x, t.id, texte, ctx, mentions));
      setTexte('');
    } catch (e) {
      onErreur(e);
    }
  };
  return (
    <View style={{ gap: 8 }}>
      <Champ theme={a.theme} mobile={a.mobile} multiline value={texte} onChangeText={setTexte} placeholder="Écrire un commentaire… (@prénom pour mentionner)" testID="detail-commentaire-champ" accessibilityLabel="Nouveau commentaire" style={{ minHeight: 64 }} />
      {suggestions.length ? (
        <View style={styles.rangee} accessibilityLabel="Personnes à mentionner" testID="mention-suggestions">
          {suggestions.map(p => (
            <Puce key={p.code} theme={a.theme} grand={a.mobile} texte={`@${p.nom}`} couleur={couleurAuteur(a, p.code)} onPress={() => setTexte(completerMention(texte, p))} testID={`mention-choisir-${p.code}`} />
          ))}
        </View>
      ) : null}
      {mentions.length ? <Text style={attenueDe(a.theme)}>Notifié{mentions.length > 1 ? 's' : ''} : {mentions.map(m => a.etat.noms[m] ?? 'Membre').join(', ')}</Text> : null}
      <Bouton theme={a.theme} compact variante="plein" titre="Publier" desactive={!texte.trim()} onPress={publier} testID="detail-commentaire-publier" style={{ alignSelf: 'flex-start' }} />
    </View>
  );
}

const fr = (j?: string) => (j ? j.split('-').reverse().join('/') : '');

/** Chronologie : début, jalon, dépendances (« fin → début ») et leurs avertissements. */
export function SectionChronologie({ a, t, onAjouterDependance, onErreur, onAvis }: { a: Actions; t: Tache; onAjouterDependance(): void; onErreur(e: unknown): void; onAvis(t: string): void }) {
  const theme = a.theme;
  const d = a.etat.donnees;
  const m = a.droits(t.projetId).modifier;
  const [debut, setDebut] = useState(fr(t.debut));
  useEffect(() => setDebut(fr(t.debut)), [t.id, t.debut]);
  const essayer = (f: () => void) => {
    try {
      f();
    } catch (e) {
      onErreur(e);
    }
  };
  const validerDebut = (choisi?: string) => {
    const texte = (choisi ?? debut).trim();
    if (choisi !== undefined) setDebut(choisi);
    if (texte === fr(t.debut)) return;
    if (!texte) return essayer(() => a.changer(t.id, { debut: undefined }));
    const lu = lireDateLibre(texte, a.etat.aujourdhui);
    if (!lu) {
      onErreur(new Error('Date de début non comprise (ex. lundi, 15/11).'));
      setDebut(fr(t.debut));
      return;
    }
    essayer(() => a.changer(t.id, { debut: lu.jour }));
  };
  const violees = violationsDe(d, t.id);
  const b = bornes(t);
  return (
    <View style={styles.section} testID="detail-chronologie">
      <Libelle theme={theme}>CHRONOLOGIE</Libelle>
      <View style={[styles.rangee, { flexWrap: 'nowrap' }]}>
        <Text style={[attenueDe(theme), { width: 112 }]}>Début</Text>
        <Champ theme={theme} mobile={a.mobile} value={debut} editable={m} onChangeText={setDebut} onBlur={() => validerDebut()} onSubmitEditing={() => validerDebut()} placeholder={t.echeance ? 'ex. lundi, 15/11' : 'Donnez aussi une échéance'} style={{ flex: 1 }} testID="detail-debut" accessibilityLabel="Date de début" />
        {m ? <BoutonCalendrier theme={theme} libelle="Date de début" max={t.echeance?.jour} onChoisir={iso => validerDebut(formaterSaisie(iso))} testID="detail-debut-calendrier" /> : null}
      </View>
      {b ? <Text style={attenueDe(theme)}>{b.debut === b.fin ? `Le ${fr(b.debut)}` : `Du ${fr(b.debut)} au ${fr(b.fin)}`}</Text> : null}
      <View style={styles.rangee}>
        <Puce theme={theme} grand={a.mobile} texte={t.jalon ? '◆ Jalon' : '◇ Faire un jalon'} couleur={theme.teintes.quatre} actif={Boolean(t.jalon)} onPress={m ? () => essayer(() => a.changer(t.id, { jalon: !t.jalon })) : undefined} testID="detail-jalon" />
      </View>
      <Text style={attenueDe(theme)}>À finir avant (dépendances « fin → début ») :</Text>
      {(t.dependances ?? []).map(id => {
        const p = d.taches[id];
        const viole = dependanceViolee(d, id, t.id);
        return (
          <View key={id} style={[styles.rangee, { flexWrap: 'nowrap' }]} testID={`dependance-${id}`}>
            <Text style={{ color: viole ? theme.critique : theme.attenue, fontSize: 15 }}>{viole ? '⚠︎' : p && estTerminee(d, p) ? '✓' : '→'}</Text>
            <Pressable accessibilityRole="link" onPress={() => p && a.ouvrir(id)} style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}>
              <Text style={[texteDe(theme), { color: p ? theme.texte : theme.attenue }]} numberOfLines={2}>
                {p?.titre ?? 'Tâche introuvable'}
                {p && bornes(p) ? <Text style={attenueDe(theme)}>{`  · fin ${fr(bornes(p)!.fin)}`}</Text> : null}
              </Text>
            </Pressable>
            {m ? <Bouton theme={theme} compact variante="discret" titre="✕" libelle={`Retirer la dépendance à « ${p?.titre ?? ''} »`} onPress={() => essayer(() => a.changer(t.id, { dependances: (t.dependances ?? []).filter(x => x !== id) }))} testID={`dependance-retirer-${id}`} /> : null}
          </View>
        );
      })}
      {m ? <Bouton theme={theme} compact titre="＋ Dépend de…" onPress={onAjouterDependance} testID="detail-dependance-ajouter" style={{ alignSelf: 'flex-start' }} /> : null}
      {violees.length ? (
        <View style={[styles.alerte, { borderColor: theme.critique, backgroundColor: teinteTransparente(theme.critique, 0.08), borderRadius: 10 }]} testID="detail-dependance-violee" accessibilityRole="alert">
          <Text style={[texteDe(theme), { color: theme.critique }]}>
            ⚠︎ Commence avant la fin de {violees.map(x => `« ${d.taches[x]?.titre ?? '?'} »`).join(', ')}.
          </Text>
          {m ? (
            <Bouton
              theme={theme}
              compact
              titre="Décaler cette tâche et les suivantes"
              onPress={() =>
                essayer(() => {
                  let n = 0;
                  a.etat.maj((x, ctx) => {
                    let y = x;
                    for (const v of violees) {
                      const r = decalerSuivantes(y, v, ctx);
                      y = r.donnees;
                      n += r.decalees.length;
                    }
                    return y;
                  });
                  onAvis(`${n} tâche${n > 1 ? 's' : ''} décalée${n > 1 ? 's' : ''}.`);
                })
              }
              testID="detail-decaler"
              style={{ alignSelf: 'flex-start' }}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** Lien GitHub (Fondateur, si activé) : saisie, état de la PR et de la CI, « Faite quand fusionnée ». */
export function SectionGithub({ a, t, onErreur }: { a: Actions; t: Tache; onErreur(e: unknown): void }) {
  const theme = a.theme;
  const aides = a.aides;
  const [saisie, setSaisie] = useState(t.github ? texteLien(t.github) : '');
  useEffect(() => setSaisie(t.github ? texteLien(t.github) : ''), [t.id, t.github]);
  if (!aides || a.etat.role !== 'fondateur' || !aides.secrets.github.actif) return null;
  const etat = aides.github[t.id];
  const valider = () => {
    const texte = saisie.trim();
    if (!texte) {
      if (t.github) a.changer(t.id, { github: undefined });
      return;
    }
    const l = lireLienSaisi(texte);
    if (!l) {
      onErreur(new Error('Lien GitHub non compris (ex. proprio/depot#12, ou l’adresse de la PR).'));
      return;
    }
    if (!t.github || texteLien(t.github) !== texteLien(l)) a.changer(t.id, { github: { ...l, ...(t.github?.faiteSiFusion ? { faiteSiFusion: true } : {}) } });
  };
  return (
    <View style={styles.section} testID="detail-github">
      <Libelle theme={theme}>GITHUB</Libelle>
      <Champ theme={theme} mobile={a.mobile} value={saisie} onChangeText={setSaisie} onBlur={valider} onSubmitEditing={valider} placeholder="proprio/depot#12, proprio/depot@branche ou l’adresse de la PR" testID="detail-github-champ" accessibilityLabel="Lien GitHub (dépôt, branche ou PR)" />
      {t.github ? (
        <View style={styles.rangee}>
          {etat ? <Puce theme={theme} texte={`${LIBELLES_ETAT_GITHUB[etat.etat]}${etat.numero ? ` #${etat.numero}` : ''}`} couleur={etat.etat === 'fusionnee' ? theme.teintes.admin : etat.etat === 'ouverte' ? theme.ok : theme.attenue} testID="detail-github-etat" /> : <Text style={attenueDe(theme)}>État pas encore lu</Text>}
          {etat?.ci ? <Puce theme={theme} texte={LIBELLES_CI[etat.ci]} couleur={etat.ci === 'succes' ? theme.ok : etat.ci === 'echec' ? theme.critique : theme.alerte} testID="detail-github-ci" /> : null}
          <Bouton theme={theme} compact variante="discret" icone="externe" titre="Ouvrir" libelle="Ouvrir sur GitHub" onPress={() => void Linking.openURL(etat?.url || urlLien(t.github!))} />
          <Bouton theme={theme} compact titre="↻" libelle="Relire l’état sur GitHub" onPress={() => void aides.rafraichirGithub(true).catch(onErreur)} testID="detail-github-relire" />
        </View>
      ) : null}
      {t.github ? (
        <Puce theme={theme} grand={a.mobile} texte={t.github.faiteSiFusion ? '✓ Faite quand la PR est fusionnée' : 'Marquer Faite quand la PR est fusionnée'} couleur={theme.ok} actif={Boolean(t.github.faiteSiFusion)} onPress={() => a.changer(t.id, { github: { ...t.github!, faiteSiFusion: !t.github!.faiteSiFusion } })} testID="detail-github-fusion" />
      ) : null}
      {etat?.titre ? <Text style={attenueDe(theme)} numberOfLines={2}>{etat.titre}</Text> : null}
    </View>
  );
}

/** Raccourcis de l'IA dans le détail (Fondateur, si activée). */
export function BoutonsIA({ a, t }: { a: Actions; t: Tache }) {
  const aides = a.aides;
  if (!aides || a.etat.role !== 'fondateur' || !aides.secrets.ia.actif || !a.droits(t.projetId).modifier) return null;
  return (
    <View style={styles.rangee}>
      <Bouton theme={a.theme} compact icone="etincelles" titre="Découper en sous-tâches (IA)" onPress={() => aides.ouvrirIA({ genre: 'decouper', tacheId: t.id })} testID="detail-ia-decouper" />
    </View>
  );
}

/** Choix d'une dépendance : les autres tâches du projet (sans boucle). */
export function optionsDependance(a: Actions, t: Tache): Array<{ valeur: string; texte: string; detail?: string }> {
  const d = a.etat.donnees;
  return Object.values(d.taches)
    .filter(x => !x.supprime && x.projetId === t.projetId && x.id !== t.id && !(t.dependances ?? []).includes(x.id) && !(x.dependances ?? []).includes(t.id))
    .sort((x, y) => (bornes(x)?.fin ?? '9').localeCompare(bornes(y)?.fin ?? '9') || x.titre.localeCompare(y.titre))
    .slice(0, 80)
    .map(x => ({ valeur: x.id, texte: x.titre, ...(bornes(x) ? { detail: `Fin ${fr(bornes(x)!.fin)}` } : {}) }));
}

/** Ajoute une dépendance (refuse une boucle), et propose de décaler si elle est violée. */
export function ajouterDependance(a: Actions, t: Tache, avant: string): boolean {
  let viole = false;
  a.etat.maj((x, ctx) => {
    const y = modifierTache(x, t.id, { dependances: [...(x.taches[t.id]?.dependances ?? []), avant] }, ctx);
    viole = dependanceViolee(y, avant, t.id);
    return y;
  });
  return viole;
}

const styles = StyleSheet.create({
  rangee: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  section: { gap: 8 },
  alerte: { borderWidth: 1, padding: 10, gap: 8 },
});
