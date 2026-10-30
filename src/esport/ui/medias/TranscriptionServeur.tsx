/**
 * Transcription SUR LE SERVEUR, dans l'interface (migration 0016) :
 *
 *  - `ProgressionServeur` : état du travail de la file (en attente, pourcentage, temps restant estimé,
 *    nouvel essai, échec) ; `useSuiviServeur` le rafraîchit toutes les 15 s tant qu'il tourne ;
 *  - `ChoixModeTranscription` : au dépôt, « Serveur (automatique) », « Navigateur (ce PC) » ou « API
 *    externe », selon ce que le serveur propose ;
 *  - `ChoixQualite` : Rapide / Équilibrée / Maximale (whisper.cpp), avec la durée estimée ;
 *  - `ReglagesTranscriptionTeam` : Paramètres de la team (`team.manage`) : mode, langue, qualité, relecture par
 *    l'IA locale, glossaire de la team (pseudos, termes : ajoutés au vocabulaire de Whisper).
 *
 * Le calcul se fait sur le serveur : on peut fermer l'app, le déposant et les rédacteurs sont prévenus
 * quand le PDF est prêt.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { BoutonHub, Case, Segments } from '../../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../../hub/themes';
import type { ClientEsport, ModeTranscription, QualiteProposee, QualiteTranscription, TravailServeur } from '../../client';
import { apiMedias, type ReglagesTranscription, type Transcription } from '../../medias/api';
import { traduireServeur } from '../../i18n/erreurs';
import { tr } from '../../i18n';
import { Intertitre, Panneau, Retours, styles, useAgir } from '../commun';

/** « 12 min », « 1 h 05 », « moins d'une minute ». */
export function dureeRestante(secondes: number): string {
  const s = Math.max(0, Math.round(secondes));
  if (s < 60) return tr('transcription.serveur.moins_d_une_minute');
  const min = Math.round(s / 60);
  if (min < 60) return tr('transcription.serveur.minutes', { n: min });
  return tr('transcription.serveur.heures', { h: Math.floor(min / 60), m: String(min % 60).padStart(2, '0') });
}

/** Phrase d'état d'un travail du serveur. */
export function libelleTravailServeur(w: TravailServeur): string {
  switch (w.statut) {
    case 'attente': {
      const heure = (v: string) => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      // Après un échec : la raison, l'heure du nouvel essai et les essais restants (jamais « démarre dans 5 minutes » à tort).
      if (w.prochainEssai) {
        const raison = w.erreur ? traduireServeur(w.erreur) : '';
        return tr(raison ? 'transcription.serveur.nouvel_essai_raison' : 'transcription.serveur.nouvel_essai', { heure: heure(w.prochainEssai), raison, n: w.essaisRestants ?? 1 });
      }
      if (w.bloque) return tr('transcription.serveur.bloque', { heure: w.attenteDepuis ? heure(w.attenteDepuis) : '—', raison: w.erreur ? ` (${traduireServeur(w.erreur)})` : '' });
      if (w.progression > 0) return tr('transcription.serveur.reprise', { v: w.pourcentage });
      return w.rang > 0 ? tr('transcription.serveur.en_file', { n: w.rang }) : tr('transcription.serveur.en_file_premiere');
    }
    case 'en_cours':
      if (w.bloque) return tr('transcription.serveur.bloque_en_cours', { v: w.pourcentage });
      if (w.etape === 'correction') return tr('transcription.serveur.correction', { n: w.correctionFaite ?? 0 });
      if (w.restantS != null && w.restantS < 60) return tr('transcription.serveur.en_cours_presque', { v: w.pourcentage });
      return w.restantS != null
        ? tr('transcription.serveur.en_cours', { v: w.pourcentage, reste: dureeRestante(w.restantS) })
        : tr('transcription.serveur.en_cours_sans_estimation', { v: w.pourcentage });
    case 'termine':
      return tr('transcription.phase.termine');
    case 'annule':
      return tr('transcription.serveur.annulee');
    default:
      return tr('transcription.serveur.echec', { v: traduireServeur(w.erreur ?? '') });
  }
}

/** Barre de progression du travail du serveur (même allure que celle du navigateur). */
export function ProgressionServeur({ theme, travail, testID }: { theme: ThemeHub; travail: TravailServeur; testID: string }) {
  const pc = travail.statut === 'termine' ? 100 : travail.pourcentage;
  const couleur = travail.statut === 'echec' ? theme.critique : travail.statut === 'termine' ? theme.ok : theme.accent;
  return (
    <View style={{ gap: 4 }} testID={`${testID}-serveur`}>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={tr('transcription.serveur.progression')}
        accessibilityValue={{ min: 0, max: 100, now: pc }}
        style={{ height: 8, borderRadius: 999, backgroundColor: teinteTransparente(theme.accent, 0.18), overflow: 'hidden' }}>
        <View style={{ width: `${pc}%`, height: '100%', backgroundColor: couleur }} />
      </View>
      <Text testID={`${testID}-serveur-etat`} style={{ color: travail.statut === 'echec' ? theme.critique : theme.texte, fontSize: 13, ...police(theme.policeTexte) }}>
        {libelleTravailServeur(travail)}
      </Text>
    </View>
  );
}

/** Intervalle de rafraîchissement pendant que le serveur transcrit. */
export const SUIVI_MS = 15_000;

/**
 * Suit le travail du serveur d'un dépôt : rafraîchit toutes les 15 s tant qu'il est en file ou en
 * cours ; `onFini` est appelé quand il se termine (prête ou échec), pour recharger la liste.
 */
export function useSuiviServeur(options: { client: ClientEsport; teamId: string; depotId: string; initial: TravailServeur | null | undefined; actif: boolean; onFini?(t: Transcription): void }) {
  const { client, teamId, depotId, initial, actif, onFini } = options;
  const api = useMemo(() => apiMedias(client, teamId), [client, teamId]);
  const [travail, setTravail] = useState<TravailServeur | null>(initial ?? null);
  const rappel = useRef(onFini);
  rappel.current = onFini;
  useEffect(() => setTravail(initial ?? null), [initial]);
  const rafraichir = useCallback(async () => {
    const t = await api.transcription(depotId);
    setTravail(t.travail ?? null);
    if (t.statut !== 'serveur') rappel.current?.(t);
    return t;
  }, [api, depotId]);
  useEffect(() => {
    if (!actif) return undefined;
    const id = setInterval(() => void rafraichir().catch(() => undefined), SUIVI_MS);
    return () => clearInterval(id);
  }, [actif, rafraichir]);
  return { travail, setTravail, rafraichir };
}

/** Réglages de transcription de la team (mode effectif, modes disponibles), chargés une fois. */
export function useReglagesTranscription(client: ClientEsport, teamId: string) {
  const api = useMemo(() => apiMedias(client, teamId), [client, teamId]);
  const [reglages, setReglages] = useState<ReglagesTranscription | undefined>();
  useEffect(() => {
    let vivant = true;
    api.reglagesTranscription().then(
      r => vivant && setReglages(r),
      () => undefined,
    );
    return () => {
      vivant = false;
    };
  }, [api]);
  return { reglages, setReglages, api };
}

export const libelleMode = (m: ModeTranscription): string => tr(`transcription.mode.${m}` as 'transcription.mode.serveur');

/** Modes proposés au dépôt : le serveur s'il est installé, le navigateur si l'appareil sait transcrire, l'API si activée. */
export function modesProposes(reglages: ReglagesTranscription | undefined, navigateurPossible: boolean): ModeTranscription[] {
  const d = reglages?.disponibles ?? { serveur: false, navigateur: true, externe: false };
  const sortie: ModeTranscription[] = [];
  if (d.serveur) sortie.push('serveur');
  if (navigateurPossible) sortie.push('navigateur');
  if (d.externe) sortie.push('externe');
  return sortie;
}

/** Mode présélectionné : celui de la team s'il est proposé, sinon le premier proposé. */
export function modeParDefaut(reglages: ReglagesTranscription | undefined, proposes: ModeTranscription[]): ModeTranscription | undefined {
  if (reglages && proposes.includes(reglages.mode)) return reglages.mode;
  return proposes[0];
}

/** Choix du mode au dépôt (Segments) + explication du mode choisi. */
export function ChoixModeTranscription({ theme, modes, valeur, onChoisir, serveurAbsent }: { theme: ThemeHub; modes: ModeTranscription[]; valeur: ModeTranscription; onChoisir(m: ModeTranscription): void; serveurAbsent: boolean }) {
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  return (
    <View style={{ gap: 4 }}>
      {modes.length > 1 ? <Segments theme={theme} libelle={tr('transcription.mode.titre')} valeur={valeur} options={modes.map(m => [m, libelleMode(m)] as const)} onChoisir={onChoisir} testID="esport-depot-mode-transcription" /> : null}
      <Text style={attenue} testID="esport-depot-mode-explication">
        {tr(`transcription.mode.explication_${valeur}` as 'transcription.mode.explication_serveur')}
      </Text>
      {serveurAbsent ? <Text style={[attenue, { color: theme.alerte }]}>{tr('transcription.mode.serveur_absent')}</Text> : null}
    </View>
  );
}

/** Pauses de ménagement du serveur (TRANSCRIPTION_REPOS par défaut) comprises dans les estimations. */
const REPOS = 0.25;

/** Durée estimée d'une transcription : « 12 min » pour `dureeAudio` secondes (ou par heure de réunion sans durée). */
export function estimationQualite(q: QualiteProposee | undefined, dureeAudio?: number | null): string | null {
  if (!q?.facteur) return null;
  return dureeRestante(q.facteur * (dureeAudio && dureeAudio > 0 ? dureeAudio : 3600) * (1 + REPOS));
}

export const libelleQualite = (q: QualiteTranscription): string => tr(`transcription.qualite.${q}` as 'transcription.qualite.equilibree');

/** Qualité choisie parmi celles disponibles : la demandée, sinon l'équilibrée, sinon la première. */
export function qualiteRetenue(qualites: QualiteProposee[] | undefined, voulue: QualiteTranscription | null | undefined): QualiteTranscription | undefined {
  const dispo = (qualites ?? []).filter(q => q.disponible);
  return (dispo.find(q => q.cle === voulue) ?? dispo.find(q => q.cle === 'equilibree') ?? dispo[0])?.cle;
}

/** Choix de la qualité (Rapide, Équilibrée, Maximale) et durée estimée pour cet enregistrement. */
export function ChoixQualite({ theme, qualites, valeur, onChoisir, dureeAudio, testID }: { theme: ThemeHub; qualites: QualiteProposee[] | undefined; valeur: QualiteTranscription | null | undefined; onChoisir(q: QualiteTranscription): void; dureeAudio?: number | null; testID: string }) {
  const dispo = (qualites ?? []).filter(q => q.disponible);
  const cle = qualiteRetenue(qualites, valeur);
  if (!cle) return null;
  const q = dispo.find(x => x.cle === cle);
  const estimation = estimationQualite(q, dureeAudio);
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  return (
    <View style={{ gap: 4 }} testID={testID}>
      {dispo.length > 1 ? <Segments theme={theme} libelle={tr('transcription.qualite.titre')} valeur={cle} options={dispo.map(x => [x.cle, libelleQualite(x.cle)] as const)} onChoisir={onChoisir} testID={`${testID}-segments`} /> : null}
      <Text style={attenue} testID={`${testID}-explication`}>
        {tr(`transcription.qualite.explication_${cle}` as 'transcription.qualite.explication_equilibree')}
        {estimation ? ` ${dureeAudio ? tr('transcription.qualite.estimation', { duree: estimation }) : tr('transcription.qualite.estimation_heure', { duree: estimation })}` : ''}
      </Text>
    </View>
  );
}

/** Paramètres de la team : mode, langue, qualité, relecture par l'IA locale et glossaire de la transcription. */
export function ReglagesTranscriptionTeam({ theme, client, teamId }: { theme: ThemeHub; client: ClientEsport; teamId: string }) {
  const { reglages, setReglages, api } = useReglagesTranscription(client, teamId);
  const { erreur, avis, agir } = useAgir();
  const [glossaire, setGlossaire] = useState<string | undefined>();
  if (!reglages?.modifiable) return null;
  const changer = (corps: Parameters<typeof api.changerReglagesTranscription>[0]) =>
    void agir('reglages', async () => {
      setReglages(await api.changerReglagesTranscription(corps));
      return tr('transcription.reglages.enregistres');
    });
  const qualitesDispo = (reglages.qualites ?? []).filter(q => q.disponible);
  const modes = (['serveur', 'navigateur', 'externe'] as const).filter(m => reglages.disponibles[m]);
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  return (
    <Panneau theme={theme} testID="esport-parametres-transcription">
      <Intertitre theme={theme}>{tr('transcription.reglages.titre')}</Intertitre>
      <Segments
        theme={theme}
        libelle={tr('transcription.mode.titre')}
        valeur={reglages.mode}
        options={modes.map(m => [m, libelleMode(m)] as const)}
        onChoisir={m =>
          void agir('mode', async () => {
            setReglages(await api.changerModeTranscription(m));
            return tr('transcription.reglages.enregistre');
          })
        }
        testID="esport-parametres-transcription-mode"
      />
      <Text style={attenue}>{tr(`transcription.mode.explication_${reglages.mode}` as 'transcription.mode.explication_serveur')}</Text>
      {reglages.disponibles.serveur ? null : <Text style={[attenue, { color: theme.alerte }]}>{tr('transcription.mode.serveur_absent')}</Text>}
      <Segments
        theme={theme}
        libelle={tr('transcription.langue')}
        valeur={reglages.langue ?? 'fr'}
        options={[
          ['fr', tr('transcription.francais')],
          ['en', tr('transcription.anglais')],
          ['auto', tr('transcription.langue_auto')],
        ]}
        onChoisir={v => changer({ langue: v === 'en' ? 'en' : v === 'auto' ? 'auto' : 'fr' })}
        testID="esport-parametres-transcription-langue"
      />
      {qualitesDispo.length ? (
        <ChoixQualite theme={theme} qualites={reglages.qualites} valeur={reglages.qualite} onChoisir={q => changer({ qualite: q })} testID="esport-parametres-transcription-qualite" />
      ) : reglages.disponibles.serveur ? (
        <Text style={attenue}>{tr('transcription.reglages.modele', { modele: reglages.modele })}</Text>
      ) : null}
      {reglages.correctionDisponible ? (
        <View style={styles.ligne}>
          <Case theme={theme} coche={reglages.correction !== false} libelle={tr('transcription.reglages.correction')} onChanger={v => changer({ correction: v })} testID="esport-parametres-transcription-correction" />
          <Text style={{ color: theme.texte, flex: 1, ...police(theme.policeTexte) }}>{tr('transcription.reglages.correction')}</Text>
        </View>
      ) : reglages.disponibles.serveur ? (
        <Text style={attenue}>{tr('transcription.reglages.correction_absente')}</Text>
      ) : null}
      <Text style={{ color: theme.texte, fontWeight: '700', fontSize: 13, ...police(theme.policeTexte) }}>{tr('transcription.reglages.glossaire')}</Text>
      <Text style={attenue}>{tr('transcription.reglages.glossaire_explication')}</Text>
      <TextInput
        testID="esport-parametres-transcription-glossaire"
        accessibilityLabel={tr('transcription.reglages.glossaire')}
        value={glossaire ?? reglages.glossaire ?? ''}
        onChangeText={setGlossaire}
        multiline
        maxLength={2000}
        placeholder={tr('transcription.reglages.glossaire_exemple')}
        placeholderTextColor={theme.attenue}
        style={{ minHeight: 70, color: theme.texte, borderWidth: 1, borderColor: theme.ligne, borderRadius: 8, padding: 8, backgroundColor: theme.surface, ...police(theme.policeTexte) }}
      />
      {glossaire !== undefined && glossaire !== (reglages.glossaire ?? '') ? (
        <BoutonHub
          theme={theme}
          titre={tr('transcription.reglages.glossaire_enregistrer')}
          variante="plein"
          onPress={() => {
            changer({ glossaire });
            setGlossaire(undefined);
          }}
          testID="esport-parametres-transcription-glossaire-enregistrer"
        />
      ) : null}
      {reglages.choisi ? (
        <BoutonHub
          theme={theme}
          titre={tr('transcription.reglages.par_defaut')}
          onPress={() =>
            void agir('mode', async () => {
              setReglages(await api.changerModeTranscription(null));
              return tr('transcription.reglages.enregistre');
            })
          }
          testID="esport-parametres-transcription-defaut"
        />
      ) : null}
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-parametres-transcription" />
    </Panneau>
  );
}
