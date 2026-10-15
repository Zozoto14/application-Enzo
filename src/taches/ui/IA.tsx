/**
 * Aide de l'IA (V3) : réglages (IA et GitHub), et la fenêtre qui montre ce
 * qui part AVANT l'envoi, puis un aperçu modifiable que l'on applique (ou
 * non). Rien n'est créé ni modifié sans « Appliquer ».
 */

import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { jourLisible } from '../dates';
import {
  anonymiser,
  appliquerDecoupage,
  appliquerPlanning,
  clientIA,
  demandeDecouper,
  demandePlanning,
  demandeResumer,
  iaDisponible,
  lireReponse,
  masquer,
  MODELE_IA_DEFAUT,
  MOTIF_CLE_IA,
  MOTIF_JETON_GITHUB,
  MOTIF_MODELE,
  resumeEnTexte,
  type ApercuIA,
  type ClientIA,
  type DemandeIA,
  type Secrets,
} from '../ia';
import { ajouterEntree } from '../journal';
import { pourQui, tachesVivantes } from '../modele';
import type { Actions, CibleIA } from './actions';
import { attenueDe, Bouton, CaseRonde, Champ, Dialogue, Libelle, Puce, texteDe } from './atomes';

type Etape = { e: 'avant' } | { e: 'attente' } | { e: 'apercu'; apercu: ApercuIA } | { e: 'erreur'; message: string };

const TITRES: Record<CibleIA['genre'], string> = { decouper: 'Découper en sous-tâches', resumer: 'Résumer le projet', planning: 'Proposer un planning de la semaine' };

export function DialogueIA({ a, cible, onFermer, onAvis, onErreur, client }: { a: Actions; cible: CibleIA; onFermer(): void; onAvis(t: string): void; onErreur(e: unknown): void; client?: ClientIA }) {
  const theme = a.theme;
  const d = a.etat.donnees;
  const reglages = a.aides!.secrets.ia;
  const [etape, setEtape] = useState<Etape>({ e: 'avant' });
  const demande = useMemo((): DemandeIA | Error => {
    try {
      if (cible.genre === 'decouper') return demandeDecouper(d, d.taches[cible.tacheId]);
      if (cible.genre === 'resumer') return demandeResumer(d, cible.projetId, a.etat.aujourdhui, cible.debriefing ? anonymiser(cible.debriefing, Object.values(a.etat.noms)) : undefined);
      const miennes = tachesVivantes(d).filter(t => !t.parentId && pourQui(t, 'fondateur'));
      return demandePlanning(d, miennes, a.etat.aujourdhui);
    } catch (e) {
      return e instanceof Error ? e : new Error(String(e));
    }
    // Calculée à l'ouverture : ce qui est montré est ce qui part.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const essai = reglages.mode === 'essai';
  const possible = essai || (iaDisponible() && Boolean(reglages.cle));
  const envoyer = () => {
    if (demande instanceof Error) return;
    setEtape({ e: 'attente' });
    (client ?? clientIA(reglages))
      .appeler(demande, reglages)
      .then(brut => setEtape({ e: 'apercu', apercu: lireReponse(demande, brut) }))
      .catch(e => setEtape({ e: 'erreur', message: e instanceof Error ? e.message : String(e) }));
  };
  const essayer = (f: () => void) => {
    try {
      f();
    } catch (e) {
      onErreur(e);
    }
  };
  let pied: React.ReactNode = null;
  let corps: React.ReactNode;
  if (demande instanceof Error) {
    corps = <Text style={texteDe(theme)}>{demande.message}</Text>;
  } else if (etape.e === 'avant' || etape.e === 'erreur') {
    corps = (
      <>
        {etape.e === 'erreur' ? (
          <Text style={[texteDe(theme), { color: theme.critique }]} testID="ia-erreur" accessibilityLiveRegion="polite">
            {etape.message}
          </Text>
        ) : null}
        <Libelle theme={theme}>{essai ? 'MODE ESSAI : RIEN N’EST ENVOYÉ' : `CE QUI SERA ENVOYÉ À ${reglages.modele.toUpperCase()} (ANTHROPIC)`}</Libelle>
        <Text style={attenueDe(theme)}>
          Le minimum : titres, statuts, échéances, estimations. Ni commentaires, ni prénoms, ni identifiants. Rien ne sera créé ni modifié sans votre « Appliquer ».
        </Text>
        <View style={[styles.boite, { borderColor: theme.ligne, borderRadius: 10 }]}>
          <Text selectable style={[styles.mono, { color: theme.texte }]} testID="ia-donnees">
            {demande.message}
          </Text>
        </View>
        {!possible ? (
          <Text style={[texteDe(theme), { color: theme.alerte }]} testID="ia-indisponible">
            {iaDisponible() ? 'Ajoutez votre clé de l’API Claude (👥 › IA et GitHub).' : 'L’aide de l’IA passe par l’application du PC : sur le site, il faudrait exposer votre clé au navigateur. Passez en mode essai pour découvrir.'}
          </Text>
        ) : null}
      </>
    );
    pied = (
      <>
        <Bouton theme={theme} titre="Annuler" onPress={onFermer} />
        <Bouton theme={theme} variante="plein" titre={essai ? 'Essayer (simulé)' : 'Envoyer'} desactive={!possible} onPress={envoyer} testID="ia-envoyer" />
      </>
    );
  } else if (etape.e === 'attente') {
    corps = (
      <Text style={texteDe(theme)} accessibilityLiveRegion="polite" testID="ia-attente">
        L’IA réfléchit…
      </Text>
    );
  } else {
    const ap = etape.apercu;
    if (ap.genre === 'decouper' && cible.genre === 'decouper') {
      const gardees = ap.sousTaches.filter(s => s.garder && s.titre.trim()).length;
      corps = <ApercuDecoupage a={a} apercu={ap} onChanger={x => setEtape({ e: 'apercu', apercu: x })} />;
      pied = (
        <>
          <Bouton theme={theme} titre="Ne rien faire" onPress={onFermer} />
          <Bouton
            theme={theme}
            variante="plein"
            titre={`Appliquer : créer ${gardees} sous-tâche${gardees > 1 ? 's' : ''}`}
            desactive={!gardees}
            onPress={() =>
              essayer(() => {
                let n = 0;
                a.etat.maj((x, ctx) => {
                  const r = appliquerDecoupage(x, cible.tacheId, ap, ctx);
                  n = r.creees;
                  return r.donnees;
                });
                onAvis(`${n} sous-tâche${n > 1 ? 's' : ''} créée${n > 1 ? 's' : ''}.`);
                onFermer();
              })
            }
            testID="ia-appliquer"
          />
        </>
      );
    } else if (ap.genre === 'resumer' && cible.genre === 'resumer') {
      corps = (
        <View style={{ gap: 8 }} testID="ia-resume">
          <Text style={[texteDe(theme), { lineHeight: 22 }]}>{ap.resume}</Text>
          {ap.points.length ? <Libelle theme={theme}>POINTS MARQUANTS</Libelle> : null}
          {ap.points.map((p, i) => (
            <Text key={i} style={texteDe(theme)}>• {p}</Text>
          ))}
          {ap.risques.length ? <Libelle theme={theme}>RISQUES</Libelle> : null}
          {ap.risques.map((p, i) => (
            <Text key={i} style={[texteDe(theme), { color: theme.alerte }]}>⚠ {p}</Text>
          ))}
        </View>
      );
      pied = (
        <>
          <Bouton theme={theme} titre="Fermer" onPress={onFermer} />
          <Bouton
            theme={theme}
            variante="plein"
            titre="Appliquer : noter au journal du jour"
            onPress={() =>
              essayer(() => {
                a.etat.maj((x, ctx) => ajouterEntree(x, { projetId: cible.projetId, jour: a.etat.aujourdhui, texte: `Résumé (IA) : ${resumeEnTexte(ap).replace(/\n+/g, ' ')}` }, ctx).donnees);
                onAvis('Résumé noté au journal du jour.');
                onFermer();
              })
            }
            testID="ia-appliquer"
          />
        </>
      );
    } else if (ap.genre === 'planning') {
      corps = <ApercuPlanning a={a} demande={demande} apercu={ap} />;
      const n = ap.jours.reduce((s, j) => s + j.taches.length, 0);
      pied = (
        <>
          <Bouton theme={theme} titre="Ne rien faire" onPress={onFermer} />
          <Bouton
            theme={theme}
            variante="plein"
            titre={`Appliquer : planifier ${n} tâche${n > 1 ? 's' : ''}`}
            onPress={() =>
              essayer(() => {
                let k = 0;
                a.etat.maj((x, ctx) => {
                  const r = appliquerPlanning(x, demande, ap, ctx);
                  k = r.planifiees;
                  return r.donnees;
                });
                onAvis(`${k} tâche${k > 1 ? 's' : ''} planifiée${k > 1 ? 's' : ''} (début posé ; voir la chronologie).`);
                onFermer();
              })
            }
            testID="ia-appliquer"
          />
        </>
      );
    }
  }
  return (
    <Dialogue theme={theme} mobile={a.mobile} visible large titre={`✨ ${TITRES[cible.genre]}`} onFermer={onFermer} testID="dialogue-ia" pied={pied}>
      {corps}
    </Dialogue>
  );
}

function ApercuDecoupage({ a, apercu, onChanger }: { a: Actions; apercu: Extract<ApercuIA, { genre: 'decouper' }>; onChanger(x: Extract<ApercuIA, { genre: 'decouper' }>): void }) {
  const theme = a.theme;
  return (
    <View style={{ gap: 6 }} testID="ia-apercu">
      <Text style={attenueDe(theme)}>Décochez ou corrigez avant d’appliquer.</Text>
      {apercu.sousTaches.map((s, i) => (
        <View key={i} style={styles.ligne} testID={`ia-sous-tache-${i}`}>
          <CaseRonde theme={theme} coche={s.garder} onPress={() => onChanger({ ...apercu, sousTaches: apercu.sousTaches.map((x, k) => (k === i ? { ...x, garder: !x.garder } : x)) })} libelle={`Garder « ${s.titre} »`} testID={`ia-garder-${i}`} />
          <TextInput value={s.titre} onChangeText={v => onChanger({ ...apercu, sousTaches: apercu.sousTaches.map((x, k) => (k === i ? { ...x, titre: v } : x)) })} accessibilityLabel={`Sous-tâche ${i + 1}`} style={[texteDe(theme), styles.champ, { borderColor: theme.ligne, opacity: s.garder ? 1 : 0.5 }]} />
          {s.minutes ? <Text style={attenueDe(theme)}>{s.minutes} min</Text> : null}
        </View>
      ))}
      {apercu.remarque ? <Text style={attenueDe(theme)}>{apercu.remarque}</Text> : null}
    </View>
  );
}

function ApercuPlanning({ a, demande, apercu }: { a: Actions; demande: DemandeIA; apercu: Extract<ApercuIA, { genre: 'planning' }> }) {
  const theme = a.theme;
  const d = a.etat.donnees;
  return (
    <View style={{ gap: 10 }} testID="ia-apercu">
      <Text style={attenueDe(theme)}>Appliquer pose le début de chaque tâche au jour proposé (rien d’autre ne change).</Text>
      {apercu.jours.map(j => (
        <View key={j.jour} style={{ gap: 4 }}>
          <Libelle theme={theme}>{jourLisible(j.jour, a.etat.aujourdhui, true).toUpperCase()}</Libelle>
          {j.taches.map(r => {
            const t = d.taches[demande.refs[r]];
            const apres = t?.echeance && j.jour > t.echeance.jour;
            return (
              <Text key={r} style={[texteDe(theme), apres ? { color: theme.critique } : null]}>
                • {t?.titre ?? r}
                {apres ? ' — après son échéance !' : ''}
              </Text>
            );
          })}
        </View>
      ))}
      {apercu.conseil ? <Text style={attenueDe(theme)}>{apercu.conseil}</Text> : null}
    </View>
  );
}

/** Réglages de l'IA et de GitHub (Fondateur, cet appareil). */
export function DialogueAides({ a, onFermer, onAvis, onErreur }: { a: Actions; onFermer(): void; onAvis(t: string): void; onErreur(e: unknown): void }) {
  const theme = a.theme;
  const aides = a.aides!;
  const s = aides.secrets;
  const [cle, setCle] = useState('');
  const [modele, setModele] = useState(s.ia.modele);
  const [jeton, setJeton] = useState('');
  const changer = (x: Secrets) => aides.changerSecrets(x);
  const enregistrerCle = () => {
    if (!MOTIF_CLE_IA.test(cle.trim())) return onErreur(new Error('Clé de l’API Claude non reconnue (elle commence par « sk-ant- »).'));
    changer({ ...s, ia: { ...s.ia, cle: cle.trim() } });
    setCle('');
    onAvis('Clé enregistrée dans la base chiffrée de cet appareil.');
  };
  const enregistrerJeton = () => {
    if (!MOTIF_JETON_GITHUB.test(jeton.trim())) return onErreur(new Error('Jeton GitHub non reconnu (github_pat_… ou ghp_…).'));
    changer({ ...s, github: { ...s.github, jeton: jeton.trim() } });
    setJeton('');
    onAvis('Jeton enregistré dans la base chiffrée de cet appareil.');
  };
  return (
    <Dialogue theme={theme} mobile={a.mobile} visible large titre="IA et GitHub" onFermer={onFermer} testID="dialogue-aides" description="Facultatifs, désactivés par défaut. Clé et jeton restent dans la base chiffrée de CET appareil : jamais dans le dépôt, jamais synchronisés, jamais envoyés à un membre.">
      <Libelle theme={theme}>AIDE DE L’IA (API CLAUDE)</Libelle>
      <View style={styles.rangee}>
        <Puce theme={theme} grand={a.mobile} texte={s.ia.actif ? 'Activée' : 'Désactivée'} couleur={s.ia.actif ? theme.ok : theme.attenue} actif={s.ia.actif} onPress={() => changer({ ...s, ia: { ...s.ia, actif: !s.ia.actif } })} testID="aides-ia-actif" />
        <Puce theme={theme} grand={a.mobile} texte="API Claude" couleur={theme.accent} actif={s.ia.mode === 'api'} onPress={() => changer({ ...s, ia: { ...s.ia, mode: 'api' } })} testID="aides-ia-mode-api" />
        <Puce theme={theme} grand={a.mobile} texte="Essai (simulé)" couleur={theme.accent} actif={s.ia.mode === 'essai'} onPress={() => changer({ ...s, ia: { ...s.ia, mode: 'essai' } })} testID="aides-ia-mode-essai" />
      </View>
      <Text style={attenueDe(theme)}>
        Découper une tâche, résumer un projet ou un débriefing, proposer un planning de la semaine. {iaDisponible() ? 'Les appels partent de l’application du PC.' : 'Sur le site, seul le mode essai fonctionne : l’appel réel passe par l’application du PC (la clé n’est jamais exposée au navigateur).'}
      </Text>
      <Text style={texteDe(theme)} testID="aides-ia-cle-etat">
        Clé : {s.ia.cle ? masquer(s.ia.cle) : 'aucune'}
      </Text>
      <View style={[styles.rangee, { flexWrap: 'nowrap' }]}>
        <Champ theme={theme} mobile={a.mobile} value={cle} onChangeText={setCle} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder="sk-ant-…" style={{ flex: 1 }} testID="aides-ia-cle" accessibilityLabel="Clé de l’API Claude" />
        <Bouton theme={theme} titre="Enregistrer" desactive={!cle.trim()} onPress={enregistrerCle} testID="aides-ia-cle-enregistrer" />
        {s.ia.cle ? <Bouton theme={theme} variante="danger" titre="Effacer" onPress={() => changer({ ...s, ia: { ...s.ia, cle: undefined } })} testID="aides-ia-cle-effacer" /> : null}
      </View>
      <View style={[styles.rangee, { flexWrap: 'nowrap' }]}>
        <Text style={[attenueDe(theme), { width: 70 }]}>Modèle</Text>
        <Champ
          theme={theme}
          mobile={a.mobile}
          value={modele}
          onChangeText={setModele}
          onBlur={() => (MOTIF_MODELE.test(modele.trim()) ? changer({ ...s, ia: { ...s.ia, modele: modele.trim() } }) : setModele(s.ia.modele))}
          autoCapitalize="none"
          placeholder={MODELE_IA_DEFAUT}
          style={{ flex: 1 }}
          testID="aides-ia-modele"
          accessibilityLabel="Modèle Claude"
        />
      </View>
      <Libelle theme={theme}>GITHUB</Libelle>
      <View style={styles.rangee}>
        <Puce theme={theme} grand={a.mobile} texte={s.github.actif ? 'Activé' : 'Désactivé'} couleur={s.github.actif ? theme.ok : theme.attenue} actif={s.github.actif} onPress={() => changer({ ...s, github: { ...s.github, actif: !s.github.actif } })} testID="aides-github-actif" />
        <Puce theme={theme} grand={a.mobile} texte="API GitHub" couleur={theme.accent} actif={s.github.mode === 'api'} onPress={() => changer({ ...s, github: { ...s.github, mode: 'api' } })} testID="aides-github-mode-api" />
        <Puce theme={theme} grand={a.mobile} texte="Essai (simulé)" couleur={theme.accent} actif={s.github.mode === 'essai'} onPress={() => changer({ ...s, github: { ...s.github, mode: 'essai' } })} testID="aides-github-mode-essai" />
      </View>
      <Text style={attenueDe(theme)}>
        Liez une tâche à un dépôt, une branche ou une PR ; son état (ouverte, fusionnée, CI) s’affiche, et la tâche peut passer « Faite » à la fusion. Jeton personnel en LECTURE seule (« fine-grained » : Contents, Pull requests et Checks en lecture).
      </Text>
      <Text style={texteDe(theme)} testID="aides-github-jeton-etat">
        Jeton : {s.github.jeton ? masquer(s.github.jeton) : 'aucun'}
      </Text>
      <View style={[styles.rangee, { flexWrap: 'nowrap' }]}>
        <Champ theme={theme} mobile={a.mobile} value={jeton} onChangeText={setJeton} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder="github_pat_…" style={{ flex: 1 }} testID="aides-github-jeton" accessibilityLabel="Jeton GitHub en lecture" />
        <Bouton theme={theme} titre="Enregistrer" desactive={!jeton.trim()} onPress={enregistrerJeton} testID="aides-github-jeton-enregistrer" />
        {s.github.jeton ? <Bouton theme={theme} variante="danger" titre="Effacer" onPress={() => changer({ ...s, github: { ...s.github, jeton: undefined } })} /> : null}
      </View>
      {s.github.actif ? <Bouton theme={theme} titre="↻ Relire l’état des PR maintenant" onPress={() => void aides.rafraichirGithub(true).then(() => onAvis('État des PR relu.'), onErreur)} testID="aides-github-relire" style={{ alignSelf: 'flex-start' }} /> : null}
    </Dialogue>
  );
}

const styles = StyleSheet.create({
  boite: { borderWidth: 1, padding: 10 },
  mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 15, lineHeight: 21 },
  ligne: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  champ: { flex: 1, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, minHeight: 40 },
  rangee: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
});
