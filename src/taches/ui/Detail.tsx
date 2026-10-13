/**
 * Détail d'une tâche : panneau latéral (PC, iPad) ou page plein écran
 * (iPhone). Titre, propriétés (statut, priorité, échéance, personne,
 * récurrence, rappels, Ma journée, liste), étiquettes, description (liens
 * cliquables), sous-tâches, checklist, commentaires et historique.
 *
 * Les textes sont enregistrés à la validation (sortie du champ, Entrée,
 * « Enregistrer »), jamais à chaque frappe.
 */

import React, { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { teinteTransparente } from '../../hub/themes';
import { decrireRecurrence } from '../recurrence';
import { libelleDelai } from '../rappels';
import {
  ajouterCommentaire,
  ajouterElement,
  changerElement,
  commentairesDe,
  creerTache,
  decouperLiens,
  elementsChecklist,
  estTerminee,
  LIBELLES_PRIORITE,
  listesDe,
  sousTaches,
  statutDe,
  supprimerCommentaire,
  supprimerTache,
  vivant,
  type Tache,
} from '../modele';
import { jourLisible } from '../dates';
import type { Actions } from './actions';
import { attenueDe, Avatar, Bouton, CaseRonde, Champ, Libelle, PastillePriorite, Puce, T, texteDe, titreDe } from './atomes';
import { couleurAuteur } from './Vues';

export interface PropsDetail {
  a: Actions;
  id: string;
  onFermer(): void;
  onRecurrence(t: Tache): void;
  onRappels(t: Tache): void;
  onListe(t: Tache): void;
  onErreur(e: unknown): void;
  onAvis(texte: string): void;
}

function Propriete({ a, libelle, children, onPress, testID, desactive }: { a: Actions; libelle: string; children: React.ReactNode; onPress?(): void; testID?: string; desactive?: boolean }) {
  return (
    <View style={styles.propriete}>
      <Text style={[attenueDe(a.theme), { width: 112 }]}>{libelle}</Text>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={libelle}
        disabled={desactive || !onPress}
        onPress={onPress}
        style={({ pressed }) => [styles.valeur, { borderRadius: 8, backgroundColor: pressed ? a.theme.ligne : 'transparent' }]}>
        {children}
      </Pressable>
    </View>
  );
}

function TexteAvecLiens({ a, texte }: { a: Actions; texte: string }) {
  return (
    <Text style={[texteDe(a.theme), { lineHeight: 22 }]} testID="detail-description-apercu">
      {decouperLiens(texte).map((m, i) =>
        m.lien ? (
          <Text key={i} accessibilityRole="link" style={{ color: a.theme.accent, textDecorationLine: 'underline' }} onPress={() => void Linking.openURL(m.lien!)}>
            {m.texte}
          </Text>
        ) : (
          <Text key={i}>{m.texte}</Text>
        ),
      )}
    </Text>
  );
}

export function DetailTache({ a, id, onFermer, onRecurrence, onRappels, onListe, onErreur, onAvis }: PropsDetail) {
  const theme = a.theme;
  const d = a.etat.donnees;
  const t = d.taches[id];
  const [titre, setTitre] = useState(t?.titre ?? '');
  const [description, setDescription] = useState(t?.description ?? '');
  const [editionDescription, setEditionDescription] = useState(false);
  const [etiquette, setEtiquette] = useState('');
  const [element, setElement] = useState('');
  const [sousTache, setSousTache] = useState('');
  const [commentaire, setCommentaire] = useState('');
  const [historique, setHistorique] = useState(false);
  const [confirmer, setConfirmer] = useState(false);
  // Nouvelle tâche ouverte, ou modifiée ailleurs (synchronisation) : les champs suivent.
  useEffect(() => {
    setTitre(t?.titre ?? '');
  }, [id, t?.titre]);
  useEffect(() => {
    if (!editionDescription) setDescription(t?.description ?? '');
  }, [id, t?.description, editionDescription]);
  useEffect(() => {
    setConfirmer(false);
    setEditionDescription(false);
  }, [id]);

  if (!vivant(t)) {
    return (
      <View style={[styles.racine, { backgroundColor: theme.surface }]} testID="detail-tache">
        <View style={styles.tete}>
          <Text style={[titreDe(theme, 18), { flex: 1 }]}>Tâche introuvable</Text>
          <Bouton theme={theme} variante="discret" titre="✕" libelle="Fermer le détail" onPress={onFermer} testID="detail-fermer" />
        </View>
        <Text style={[attenueDe(theme), { padding: 16 }]}>Elle a été supprimée, ou son projet n’est plus partagé avec vous.</Text>
      </View>
    );
  }
  const droits = a.droits(t.projetId);
  const m = droits.modifier;
  const statut = statutDe(d, t);
  const projet = d.projets[t.projetId];
  const liste = d.listes[t.listeId];
  const espace = projet ? d.espaces[projet.espaceId] : undefined;
  const parent = t.parentId ? d.taches[t.parentId] : undefined;
  const essayer = (f: () => void) => {
    try {
      f();
    } catch (e) {
      onErreur(e);
    }
  };
  const validerTitre = () => {
    if (titre.trim() && titre.trim() !== t.titre) essayer(() => a.changer(t.id, { titre }));
    else setTitre(t.titre);
  };
  const validerDescription = () => {
    setEditionDescription(false);
    if (description !== t.description) essayer(() => a.changer(t.id, { description }));
  };
  const ajouterEtiquette = () => {
    const e = etiquette.trim().replace(/^#/, '');
    if (!e) return;
    essayer(() => a.changer(t.id, { etiquettes: [...t.etiquettes, e] }));
    setEtiquette('');
  };
  const st = sousTaches(d, t.id);
  const cl = elementsChecklist(t);
  const commentaires = commentairesDe(t);
  const ech = t.echeance ? `${jourLisible(t.echeance.jour, a.etat.aujourdhui, true)}${t.echeance.heure ? ` à ${t.echeance.heure.replace(':', ' h ')}` : ''}` : 'Aucune';
  const choisie = t.pourAujourdhui === a.etat.aujourdhui;
  return (
    <View style={[styles.racine, { backgroundColor: theme.surface }]} testID="detail-tache">
      <View style={[styles.tete, { borderColor: theme.ligne }]}>
        <Text style={[attenueDe(theme), { flex: 1 }]} numberOfLines={1}>
          {[espace?.nom, projet?.nom, liste?.nom].filter(Boolean).join(' › ')}
        </Text>
        {droits.mode === 'lecture' ? <Puce theme={theme} texte="Lecture seule" couleur={theme.alerte} testID="detail-lecture-seule" /> : null}
        <Bouton theme={theme} variante="discret" titre={a.mobile ? 'Fermer' : '✕'} libelle="Fermer le détail" onPress={onFermer} testID="detail-fermer" />
      </View>
      <ScrollView contentContainerStyle={styles.corps} keyboardShouldPersistTaps="handled">
        {parent ? (
          <Pressable accessibilityRole="link" onPress={() => a.ouvrir(parent.id)} style={{ minHeight: 32, justifyContent: 'center' }}>
            <Text style={[attenueDe(theme), { color: theme.accent }]}>↑ {parent.titre}</Text>
          </Pressable>
        ) : null}
        <View style={styles.ligneTitre}>
          <CaseRonde theme={theme} coche={statut.ferme} desactive={!m} onPress={() => a.basculer(t.id)} libelle="Terminer la tâche" testID="detail-terminer" />
          <TextInput
            testID="detail-titre"
            value={titre}
            editable={m}
            onChangeText={setTitre}
            onBlur={validerTitre}
            onSubmitEditing={validerTitre}
            multiline={false}
            accessibilityLabel="Titre"
            style={[titreDe(theme, a.mobile ? 22 : 21), styles.champTitre, { color: theme.texte }]}
          />
        </View>

        <View style={{ gap: 2 }}>
          <Propriete a={a} libelle="Statut" onPress={m ? () => a.menuStatut(t) : undefined} testID="detail-statut">
            <Puce theme={theme} texte={statut.nom} couleur={statut.couleur} />
          </Propriete>
          <Propriete a={a} libelle="Priorité" onPress={m ? () => a.menuPriorite(t) : undefined} testID="detail-priorite">
            <PastillePriorite theme={theme} priorite={t.priorite} />
          </Propriete>
          <Propriete a={a} libelle="Échéance" onPress={m ? () => a.menuEcheance(t) : undefined} testID="detail-echeance">
            <Text style={[texteDe(theme), { textTransform: 'capitalize' }]}>{ech}</Text>
          </Propriete>
          <Propriete a={a} libelle="Pour" onPress={m ? () => a.menuAssigne(t) : undefined} testID="detail-assigne">
            {t.assigne ? (
              <View style={styles.rangee}>
                <Avatar theme={theme} nom={a.etat.noms[t.assigne]} couleur={couleurAuteur(a, t.assigne)} />
                <Text style={texteDe(theme)}>{a.etat.noms[t.assigne]}{t.assigne === a.etat.role ? ' (moi)' : ''}</Text>
              </View>
            ) : (
              <Text style={attenueDe(theme)}>Personne</Text>
            )}
          </Propriete>
          <Propriete a={a} libelle="Récurrence" onPress={m ? () => onRecurrence(t) : undefined} testID="detail-recurrence">
            <Text style={texteDe(theme)}>{decrireRecurrence(t.recurrence)}</Text>
          </Propriete>
          <Propriete a={a} libelle="Rappels" onPress={m ? () => onRappels(t) : undefined} testID="detail-rappels">
            <Text style={t.rappels.length ? texteDe(theme) : attenueDe(theme)}>{t.rappels.length ? t.rappels.map(libelleDelai).join(', ') : t.echeance ? 'Aucun' : 'Aucun (donnez une échéance)'}</Text>
          </Propriete>
          <Propriete a={a} libelle="Ma journée" onPress={m ? () => a.basculerJournee(t) : undefined} testID="detail-journee">
            <Text style={[texteDe(theme), { color: choisie ? theme.alerte : theme.attenue }]}>{choisie ? '☀︎ Choisie pour aujourd’hui' : 'Ajouter à ma journée'}</Text>
          </Propriete>
          <Propriete a={a} libelle="Liste" onPress={m && listesDe(d, t.projetId).length > 1 && !t.parentId ? () => onListe(t) : undefined} testID="detail-liste">
            <Text style={texteDe(theme)}>{liste?.nom}</Text>
          </Propriete>
        </View>

        <View style={styles.section}>
          <Libelle theme={theme}>ÉTIQUETTES</Libelle>
          <View style={styles.rangee}>
            {t.etiquettes.map(e => (
              <Puce key={e} theme={theme} texte={`#${e}${m ? '  ✕' : ''}`} couleur={theme.teintes.anime} grand={a.mobile} onPress={m ? () => essayer(() => a.changer(t.id, { etiquettes: t.etiquettes.filter(x => x !== e) })) : undefined} libelle={`Retirer l’étiquette ${e}`} testID={`detail-etiquette-${e}`} />
            ))}
            {t.etiquettes.length === 0 && !m ? <Text style={attenueDe(theme)}>Aucune</Text> : null}
          </View>
          {m ? <Champ theme={theme} mobile={a.mobile} value={etiquette} onChangeText={setEtiquette} onSubmitEditing={ajouterEtiquette} placeholder="Nouvelle étiquette puis Entrée" testID="detail-etiquette-champ" accessibilityLabel="Nouvelle étiquette" /> : null}
        </View>

        <View style={styles.section}>
          <Libelle theme={theme}>DESCRIPTION</Libelle>
          {m && (editionDescription || !t.description) ? (
            <>
              <Champ
                theme={theme}
                mobile={a.mobile}
                multiline
                value={description}
                onChangeText={setDescription}
                onFocus={() => setEditionDescription(true)}
                onBlur={validerDescription}
                placeholder="Notes, liens (https://…)"
                testID="detail-description"
                accessibilityLabel="Description"
              />
              {editionDescription ? <Bouton theme={theme} compact titre="Enregistrer" variante="plein" onPress={validerDescription} testID="detail-description-ok" style={{ alignSelf: 'flex-start' }} /> : null}
            </>
          ) : t.description ? (
            <Pressable accessibilityRole={m ? 'button' : undefined} accessibilityLabel={m ? 'Modifier la description' : undefined} disabled={!m} onPress={() => setEditionDescription(true)} style={[styles.apercu, { borderColor: theme.ligne, borderRadius: 8 }]}>
              <TexteAvecLiens a={a} texte={t.description} />
            </Pressable>
          ) : (
            <Text style={attenueDe(theme)}>Aucune description.</Text>
          )}
        </View>

        {!t.parentId ? (
          <View style={styles.section}>
            <Libelle theme={theme}>{`SOUS-TÂCHES${st.length ? ` · ${st.filter(s => estTerminee(d, s)).length}/${st.length}` : ''}`}</Libelle>
            {st.map(s => (
              <View key={s.id} style={styles.rangee}>
                <CaseRonde theme={theme} coche={estTerminee(d, s)} desactive={!m} onPress={() => a.basculer(s.id)} libelle={`Terminer « ${s.titre} »`} testID={`sous-tache-case-${s.id}`} />
                <Pressable accessibilityRole="button" onPress={() => a.ouvrir(s.id)} style={{ flex: 1, minHeight: 36, justifyContent: 'center' }} testID={`sous-tache-${s.id}`}>
                  <Text style={[texteDe(theme), { textDecorationLine: estTerminee(d, s) ? 'line-through' : 'none' }]}>{s.titre}</Text>
                </Pressable>
              </View>
            ))}
            {m ? (
              <Champ
                theme={theme}
                mobile={a.mobile}
                value={sousTache}
                onChangeText={setSousTache}
                onSubmitEditing={() =>
                  sousTache.trim() &&
                  essayer(() => {
                    a.etat.maj((x, ctx) => creerTache(x, { titre: sousTache, listeId: t.listeId, parentId: t.id }, ctx).donnees);
                    setSousTache('');
                  })
                }
                placeholder="Ajouter une sous-tâche puis Entrée"
                testID="detail-sous-tache-champ"
                accessibilityLabel="Nouvelle sous-tâche"
              />
            ) : null}
          </View>
        ) : null}

        <View style={styles.section}>
          <Libelle theme={theme}>{`CHECKLIST${cl.length ? ` · ${cl.filter(e => e.fait).length}/${cl.length}` : ''}`}</Libelle>
          {cl.length ? (
            <View style={[styles.progression, { backgroundColor: theme.ligne }]}>
              <View style={{ width: `${Math.round((100 * cl.filter(e => e.fait).length) / cl.length)}%`, height: '100%', backgroundColor: theme.ok, borderRadius: 3 }} />
            </View>
          ) : null}
          {cl.map(e => (
            <View key={e.id} style={styles.rangee} testID={`checklist-${e.id}`}>
              <CaseRonde theme={theme} couleur={theme.accent} coche={e.fait} desactive={!m} onPress={() => essayer(() => a.etat.maj((x, ctx) => changerElement(x, t.id, e.id, { fait: !e.fait }, ctx)))} libelle={e.texte} testID={`checklist-case-${e.id}`} />
              <Text style={[texteDe(theme), { flex: 1, textDecorationLine: e.fait ? 'line-through' : 'none', color: e.fait ? theme.attenue : theme.texte }]}>{e.texte}</Text>
              {m ? <Bouton theme={theme} variante="discret" compact titre="✕" libelle={`Retirer « ${e.texte} »`} onPress={() => essayer(() => a.etat.maj((x, ctx) => changerElement(x, t.id, e.id, { supprime: true }, ctx)))} /> : null}
            </View>
          ))}
          {m ? (
            <Champ
              theme={theme}
              mobile={a.mobile}
              value={element}
              onChangeText={setElement}
              onSubmitEditing={() =>
                element.trim() &&
                essayer(() => {
                  a.etat.maj((x, ctx) => ajouterElement(x, t.id, element, ctx));
                  setElement('');
                })
              }
              placeholder="Ajouter un élément puis Entrée"
              testID="detail-checklist-champ"
              accessibilityLabel="Nouvel élément de checklist"
            />
          ) : null}
        </View>

        <View style={styles.section}>
          <Libelle theme={theme}>{`COMMENTAIRES${commentaires.length ? ` · ${commentaires.length}` : ''}`}</Libelle>
          {commentaires.map(c => (
            <View key={c.id} style={[styles.commentaire, { backgroundColor: teinteTransparente(couleurAuteur(a, c.auteur), 0.1), borderRadius: 10 }]} testID={`commentaire-${c.id}`}>
              <View style={styles.rangee}>
                <Avatar theme={theme} nom={a.etat.noms[c.auteur]} couleur={couleurAuteur(a, c.auteur)} taille={24} />
                <Text style={[texteDe(theme), { fontWeight: '700' }]}>{a.etat.noms[c.auteur]}</Text>
                <Text style={[attenueDe(theme), { flex: 1 }]}>{new Date(c.date).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text>
                {m && (c.auteur === a.etat.role || a.etat.role === 'fondateur') ? (
                  <Bouton theme={theme} variante="discret" compact titre="✕" libelle="Supprimer le commentaire" onPress={() => essayer(() => a.etat.maj((x, ctx) => supprimerCommentaire(x, t.id, c.id, ctx)))} />
                ) : null}
              </View>
              <TexteAvecLiens a={a} texte={c.texte} />
            </View>
          ))}
          {m ? (
            <View style={{ gap: 8 }}>
              <Champ theme={theme} mobile={a.mobile} multiline value={commentaire} onChangeText={setCommentaire} placeholder="Écrire un commentaire…" testID="detail-commentaire-champ" accessibilityLabel="Nouveau commentaire" style={{ minHeight: 64 }} />
              <Bouton
                theme={theme}
                compact
                variante="plein"
                titre="Publier"
                desactive={!commentaire.trim()}
                onPress={() =>
                  essayer(() => {
                    a.etat.maj((x, ctx) => ajouterCommentaire(x, t.id, commentaire, ctx));
                    setCommentaire('');
                  })
                }
                testID="detail-commentaire-publier"
                style={{ alignSelf: 'flex-start' }}
              />
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: historique }} onPress={() => setHistorique(h => !h)} style={{ minHeight: 36, justifyContent: 'center' }} testID="detail-historique">
            <Libelle theme={theme}>{`${historique ? '▾' : '▸'} HISTORIQUE · ${t.historique.length}`}</Libelle>
          </Pressable>
          {historique
            ? [...t.historique].reverse().map(e => (
                <View key={e.id} style={{ gap: 2 }}>
                  <Text style={texteDe(theme, T.petit)}>
                    <Text style={{ fontWeight: '700' }}>{a.etat.noms[e.auteur]}</Text> · {e.texte}
                  </Text>
                  <Text style={attenueDe(theme)}>
                    {new Date(e.date).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    {e.avant ? ` · avant : « ${e.avant.slice(0, 120)}${e.avant.length > 120 ? '…' : ''} »` : ''}
                  </Text>
                </View>
              ))
            : null}
        </View>

        {m ? (
          <View style={[styles.section, { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.ligne, paddingTop: 14 }]}>
            {confirmer ? (
              <View style={{ gap: 8 }}>
                <Text style={texteDe(theme)}>Supprimer « {t.titre} »{st.length ? ` et ses ${st.length} sous-tâche(s)` : ''} ?</Text>
                <View style={styles.rangee}>
                  <Bouton
                    theme={theme}
                    variante="danger"
                    titre="Supprimer"
                    onPress={() =>
                      essayer(() => {
                        a.etat.maj((x, ctx) => supprimerTache(x, t.id, ctx));
                        onAvis('Tâche supprimée.');
                        onFermer();
                      })
                    }
                    testID="detail-supprimer-confirmer"
                  />
                  <Bouton theme={theme} titre="Annuler" onPress={() => setConfirmer(false)} />
                </View>
              </View>
            ) : (
              <Bouton theme={theme} variante="danger" titre="Supprimer la tâche" onPress={() => setConfirmer(true)} testID="detail-supprimer" style={{ alignSelf: 'flex-start' }} />
            )}
          </View>
        ) : null}
        <Text style={[attenueDe(theme), { marginTop: 4 }]}>
          Créée par {a.etat.noms[t.creePar]} le {new Date(t.creeLe).toLocaleDateString('fr-FR')} · {LIBELLES_PRIORITE[t.priorite].toLowerCase()}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  racine: { flex: 1, minHeight: 0 },
  tete: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 16, paddingRight: 6, minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth },
  corps: { padding: 16, gap: 16, paddingBottom: 40 },
  ligneTitre: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  champTitre: { flex: 1, minHeight: 44, paddingVertical: 4 },
  propriete: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  valeur: { flex: 1, minHeight: 40, justifyContent: 'center', paddingHorizontal: 8 },
  section: { gap: 8 },
  rangee: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  apercu: { borderWidth: StyleSheet.hairlineWidth, padding: 10 },
  progression: { height: 6, borderRadius: 3, overflow: 'hidden' },
  commentaire: { padding: 10, gap: 6 },
});
