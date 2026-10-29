/**
 * Transcription automatique des réunions, dans l'interface :
 *
 *  - `PanneauTranscription` : sur un dépôt (Mes dépôts, boîte du rédacteur) : statut, « Transcrire »
 *    (enregistrement sur le serveur) ou « Reprendre », progression, pause / reprise / arrêt, PDF de la
 *    transcription (ouvrir, télécharger), enregistrement (écouter), correction dans l'éditeur ;
 *  - `BandeauTranscriptions` : les transcriptions en cours dans l'onglet, sur tous les écrans de l'Esport
 *    (le travail continue quand on change d'écran) ;
 *  - `EditeurTranscription` : segments horodatés modifiables (correction des fautes), puis « Enregistrer »
 *    (le serveur régénère le PDF) ; bascule « relue par l'IA » / « brute » quand l'IA locale l'a relue.
 *
 * Whisper et l'extraction audio sont chargés par IMPORT DYNAMIQUE (`../../transcription/lancer`) au
 * premier « Transcrire » : rien dans le paquet principal.
 */

import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Text, TextInput, View } from 'react-native';
import { BoutonHub, Segments } from '../../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../../hub/themes';
import type { ClientEsport, Depot, QualiteTranscription, StatutTranscription } from '../../client';
import { apiMedias, type SegmentTranscription, type Transcription } from '../../medias/api';
import { timecode } from '../../transcription/audio';
import { capaciteAppareil } from '../../transcription/appareil';
import { travaux, type EtatTravail, type TravailTranscription } from '../../transcription/travail';
import { ouvrirLienDiffere } from '../ouvrirLien';
import { Retours, styles, useAgir } from '../commun';
import { tr } from '../../i18n';
import { traduireServeur } from '../../i18n/erreurs';
import { ChoixQualite, ProgressionServeur, libelleQualite, qualiteRetenue, useSuiviServeur } from './TranscriptionServeur';

export type LangueTranscription = 'fr' | 'en';

/** Lance (import dynamique) une transcription ; rend le travail. */
export async function demarrerTranscription(options: { client: ClientEsport; teamId: string; depot: Pick<Depot, 'id' | 'titre' | 'enregistrement'>; fichier?: Blob; langue?: LangueTranscription; recommencer?: boolean }): Promise<TravailTranscription> {
  const { lancerTranscription } = await import('../../transcription/lancer');
  return lancerTranscription(options);
}

/** État d'un travail de transcription (re-rendu à chaque progression). */
function useTravail(reunionId: string): EtatTravail | undefined {
  const lire = useCallback(() => travaux.de(reunionId)?.etat, [reunionId]);
  const abonner = useCallback((f: () => void) => {
    let detacher: (() => void) | undefined;
    const suivre = () => {
      detacher?.();
      detacher = travaux.de(reunionId)?.abonner(() => f());
      f();
    };
    const r = travaux.abonner(suivre);
    suivre();
    return () => {
      r();
      detacher?.();
    };
  }, [reunionId]);
  return useSyncExternalStore(abonner, lire, lire);
}

function useTousTravaux(): TravailTranscription[] {
  const [, forcer] = useState(0);
  useEffect(() => {
    const detachements = new Map<string, () => void>();
    const suivre = () => {
      for (const t of travaux.tous()) if (!detachements.has(t.options.reunionId)) detachements.set(t.options.reunionId, t.abonner(() => forcer(n => n + 1)));
      forcer(n => n + 1);
    };
    const r = travaux.abonner(suivre);
    suivre();
    return () => {
      r();
      for (const d of detachements.values()) d();
    };
  }, []);
  return travaux.tous();
}

export function libellePhase(e: EtatTravail): string {
  const pc = Math.floor(e.progression * 100);
  switch (e.phase) {
    case 'chargement-modele':
      return tr('transcription.phase.modele', { v: Math.floor(e.chargementModele * 100) });
    case 'extraction':
      return tr('transcription.phase.extraction');
    case 'transcription':
      return tr('transcription.phase.transcription', { v: pc, temps: timecode(e.secondes), duree: e.duree ? timecode(e.duree) : '…' });
    case 'pause':
      return tr('transcription.phase.pause', { v: pc });
    case 'enregistrement':
      return tr('transcription.phase.enregistrement');
    case 'termine':
      return tr('transcription.phase.termine');
    case 'annule':
      return tr('transcription.phase.annule');
    default:
      return tr('transcription.phase.erreur', { v: e.erreur ?? '' });
  }
}

export function libelleStatut(s: StatutTranscription): string {
  return tr(`transcription.statut.${s}` as 'transcription.statut.aucune');
}

function Progression({ theme, etat, testID }: { theme: ThemeHub; etat: EtatTravail; testID: string }) {
  const pc = Math.floor((etat.phase === 'chargement-modele' ? etat.chargementModele : etat.progression) * 100);
  return (
    <View style={{ gap: 4 }}>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={tr('transcription.progression')}
        accessibilityValue={{ min: 0, max: 100, now: pc }}
        style={{ height: 8, borderRadius: 999, backgroundColor: teinteTransparente(theme.accent, 0.18), overflow: 'hidden' }}>
        <View style={{ width: `${pc}%`, height: '100%', backgroundColor: etat.phase === 'erreur' ? theme.critique : etat.phase === 'termine' ? theme.ok : theme.accent }} />
      </View>
      <Text testID={`${testID}-etat`} style={{ color: etat.phase === 'erreur' ? theme.critique : theme.texte, fontSize: 13, ...police(theme.policeTexte) }}>
        {libellePhase(etat)}
      </Text>
    </View>
  );
}

function CommandesTravail({ theme, travail, etat, testID }: { theme: ThemeHub; travail: TravailTranscription; etat: EtatTravail; testID: string }) {
  if (!travail.enCours) return null;
  return (
    <View style={styles.ligne}>
      {etat.phase === 'pause' ? (
        <BoutonHub theme={theme} titre={tr('transcription.reprendre')} variante="plein" onPress={() => travail.reprendre()} testID={`${testID}-reprendre`} />
      ) : (
        <BoutonHub theme={theme} titre={tr('transcription.pause')} onPress={() => travail.pause()} testID={`${testID}-pause`} />
      )}
      <BoutonHub theme={theme} titre={tr('transcription.arreter')} onPress={() => travail.annuler()} testID={`${testID}-arreter`} libelle={tr('transcription.arreter_explication')} />
    </View>
  );
}

/** Bandeau des transcriptions en cours dans l'onglet (tous les écrans de l'Esport). */
export function BandeauTranscriptions({ theme }: { theme: ThemeHub }) {
  const liste = useTousTravaux();
  if (liste.length === 0) return null;
  return (
    <View testID="esport-transcriptions-bandeau" style={{ gap: 6, padding: 10, borderBottomWidth: 1, borderBottomColor: theme.ligne, backgroundColor: teinteTransparente(theme.accent, 0.08) }}>
      {liste.map(t => (
        <View key={t.options.reunionId} style={{ gap: 4 }} testID={`esport-transcription-bandeau-${t.options.reunionId}`}>
          <Text style={{ color: theme.texte, fontWeight: '700', fontSize: 13, ...police(theme.policeTexte) }} numberOfLines={1}>
            {tr('transcription.bandeau_titre', { titre: t.options.titre })}
          </Text>
          <Progression theme={theme} etat={t.etat} testID={`esport-transcription-bandeau-${t.options.reunionId}`} />
          <View style={styles.ligne}>
            <CommandesTravail theme={theme} travail={t} etat={t.etat} testID={`esport-transcription-bandeau-${t.options.reunionId}`} />
            {!t.enCours ? <BoutonHub theme={theme} titre={tr('discord.fermer')} onPress={() => travaux.retirer(t.options.reunionId)} testID={`esport-transcription-bandeau-${t.options.reunionId}-fermer`} /> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

/** Transcription d'un dépôt : statut, lancement, progression, PDF, éditeur. */
export function PanneauTranscription({ theme, client, teamId, depot, onChange }: { theme: ThemeHub; client: ClientEsport; teamId: string; depot: Depot; onChange?(): void }) {
  const api = useMemo(() => apiMedias(client, teamId), [client, teamId]);
  const etat = useTravail(depot.id);
  const travail = travaux.de(depot.id);
  // Langue choisie ici ; sans choix, le serveur prend celle de la team (Paramètres), le navigateur le français.
  const [langue, setLangue] = useState<LangueTranscription | undefined>();
  const [qualite, setQualite] = useState<QualiteTranscription | undefined>();
  const [editeur, setEditeur] = useState(false);
  const { enCours, erreur, avis, agir } = useAgir();
  const capacite = useMemo(() => capaciteAppareil(), []);
  const fin = etat?.phase === 'termine';
  // Transcription sur le serveur : suivie toutes les 15 s tant qu'elle tourne (on peut fermer l'app).
  const [statutLocal, setStatutLocal] = useState(depot.transcription?.statut ?? 'aucune');
  useEffect(() => setStatutLocal(depot.transcription?.statut ?? 'aucune'), [depot.transcription?.statut]);
  const statut = statutLocal;
  const suivi = useSuiviServeur({
    client,
    teamId,
    depotId: depot.id,
    initial: depot.transcription?.travail,
    actif: statut === 'serveur',
    onFini: t => {
      setStatutLocal(t.statut);
      onChange?.();
    },
  });
  const serveur = Boolean(depot.transcription?.serveur);
  useEffect(() => {
    if (fin) onChange?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fin]);
  if (!depot.enregistrement && statut === 'aucune') return null;
  const idt = `esport-transcription-${depot.id}`;
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  const peut = Boolean(depot.transcription?.peutTranscrire) && capacite.transcription;
  const lancer = (recommencer = false) =>
    void agir('transcrire', async () => {
      await demarrerTranscription({ client, teamId, depot, langue: langue ?? 'fr', recommencer });
    });
  const travailServeur = suivi.travail;
  const surServeur = statut === 'serveur';
  const echecServeur = statut === 'echec' && travailServeur?.statut === 'echec';
  const peutServeur = serveur && Boolean(depot.transcription?.peutTranscrire) && depot.enregistrement && !depot.enregistrement.supprime && !surServeur && statut !== 'externe' && !travail?.enCours;
  const qualites = depot.transcription?.qualites;
  const qualiteChoisie = qualiteRetenue(qualites, qualite);
  const lancerServeur = (q: QualiteTranscription | undefined = qualiteChoisie) =>
    void agir('serveur', async () => {
      const t = await api.demanderTranscriptionServeur(depot.id, langue, q);
      suivi.setTravail(t.travail ?? null);
      setStatutLocal(t.statut);
      onChange?.();
      return tr('transcription.serveur.demandee');
    });
  return (
    <View testID={idt} style={{ gap: 6, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 8 }}>
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <Text style={{ color: theme.texte, fontWeight: '700', ...police(theme.policeTexte) }}>{tr('transcription.titre')}</Text>
        <Text testID={`${idt}-statut`} style={attenue}>
          {libelleStatut(statut)}
        </Text>
      </View>
      {depot.enregistrement ? (
        <View style={styles.ligne}>
          <Text style={[attenue, { flex: 1 }]} numberOfLines={1}>
            {depot.enregistrement.supprime ? tr('transcription.enregistrement_supprime') : tr('transcription.enregistrement', { nom: depot.enregistrement.nom })}
          </Text>
          {!depot.enregistrement.supprime ? (
            <BoutonHub theme={theme} titre={tr('transcription.ecouter')} onPress={() => void agir('ecouter', () => ouvrirLienDiffere(async () => (await api.lienEnregistrement(depot.id)).url))} testID={`${idt}-ecouter`} />
          ) : null}
        </View>
      ) : null}
      {etat && travail ? (
        <>
          <Progression theme={theme} etat={etat} testID={idt} />
          <CommandesTravail theme={theme} travail={travail} etat={etat} testID={idt} />
        </>
      ) : null}
      {surServeur && travailServeur ? (
        <View style={{ gap: 6 }}>
          <ProgressionServeur theme={theme} travail={travailServeur} testID={idt} />
          <Text style={attenue}>{tr('transcription.serveur.fermer_app')}</Text>
          {depot.transcription?.peutTranscrire ? (
            <BoutonHub
              theme={theme}
              titre={tr('transcription.serveur.annuler')}
              desactive={Boolean(enCours)}
              onPress={() =>
                void agir('annuler', async () => {
                  const t = await api.annulerTranscriptionServeur(depot.id);
                  suivi.setTravail(t.travail ?? null);
                  setStatutLocal(t.statut);
                  onChange?.();
                })
              }
              testID={`${idt}-serveur-annuler`}
            />
          ) : null}
        </View>
      ) : null}
      {echecServeur ? (
        <Text testID={`${idt}-serveur-echec`} style={[attenue, { color: theme.critique }]}>
          {tr('transcription.serveur.echec_repli', { v: traduireServeur(travailServeur?.erreur ?? '') })}
        </Text>
      ) : null}
      {peutServeur && statut !== 'prete' ? (
        <View style={{ gap: 6 }}>
          <ChoixQualite theme={theme} qualites={qualites} valeur={qualiteChoisie} onChoisir={setQualite} dureeAudio={depot.enregistrement?.media?.duree} testID={`${idt}-qualite`} />
          <BoutonHub theme={theme} titre={echecServeur ? tr('transcription.serveur.reessayer') : tr('transcription.serveur.transcrire')} variante="plein" desactive={Boolean(enCours)} onPress={() => lancerServeur()} testID={`${idt}-serveur-lancer`} />
        </View>
      ) : null}
      {peutServeur && statut === 'prete' ? (
        <BoutonHub
          theme={theme}
          titre={depot.transcription?.meilleureQualite ? tr('transcription.serveur.retranscrire_meilleure', { qualite: libelleQualite(depot.transcription.meilleureQualite) }) : tr('transcription.serveur.retranscrire')}
          desactive={Boolean(enCours)}
          onPress={() => lancerServeur(depot.transcription?.meilleureQualite ?? qualiteChoisie)}
          testID={`${idt}-serveur-lancer`}
        />
      ) : null}
      {!travail?.enCours && peut && statut !== 'externe' && !surServeur && depot.enregistrement && !depot.enregistrement.supprime ? (
        <View style={{ gap: 6 }}>
          {capacite.iphone || capacite.faible ? <Text style={[attenue, { color: theme.alerte }]}>{tr('transcription.appareil_faible')}</Text> : null}
          <View style={[styles.ligne, { alignItems: 'flex-end' }]}>
            <Segments
              theme={theme}
              libelle={tr('transcription.langue')}
              valeur={langue ?? 'fr'}
              options={[
                ['fr', tr('transcription.francais')],
                ['en', tr('transcription.anglais')],
              ]}
              onChoisir={v => setLangue(v === 'en' ? 'en' : 'fr')}
              testID={`${idt}-langue`}
            />
            {statut === 'en_cours' ? (
              <BoutonHub theme={theme} titre={tr('transcription.reprendre_transcription')} variante="plein" desactive={Boolean(enCours)} onPress={() => lancer(false)} testID={`${idt}-lancer`} />
            ) : statut !== 'prete' ? (
              <BoutonHub theme={theme} titre={tr('transcription.transcrire')} variante="plein" desactive={Boolean(enCours)} onPress={() => lancer(true)} testID={`${idt}-lancer`} />
            ) : (
              <BoutonHub theme={theme} titre={tr('transcription.retranscrire')} desactive={Boolean(enCours)} onPress={() => lancer(true)} testID={`${idt}-lancer`} />
            )}
          </View>
        </View>
      ) : null}
      {!travail?.enCours && depot.transcription?.externe && depot.transcription.peutTranscrire && !['prete', 'externe', 'serveur'].includes(statut) && depot.enregistrement && !depot.enregistrement.supprime ? (
        <BoutonHub
          theme={theme}
          titre={tr('transcription.sur_le_serveur')}
          desactive={Boolean(enCours)}
          onPress={() =>
            void agir('externe', async () => {
              await api.demanderTranscriptionExterne(depot.id, langue ?? 'fr');
              onChange?.();
              return tr('transcription.sur_le_serveur_demandee');
            })
          }
          testID={`${idt}-externe`}
        />
      ) : null}
      {depot.transcription?.pdf ? (
        <View style={styles.ligne}>
          <BoutonHub theme={theme} titre={tr('transcription.ouvrir_pdf')} variante="plein" onPress={() => void agir('pdf', () => ouvrirLienDiffere(async () => (await api.lienTranscription(depot.id)).url))} testID={`${idt}-pdf`} />
          <BoutonHub theme={theme} titre={tr('resumes.telecharger')} onPress={() => void agir('pdf', () => ouvrirLienDiffere(async () => (await api.lienTranscription(depot.id, true)).url))} testID={`${idt}-telecharger`} />
        </View>
      ) : null}
      {statut === 'prete' || statut === 'en_cours' ? (
        <BoutonHub theme={theme} titre={editeur ? tr('transcription.fermer_editeur') : depot.transcription?.peutTranscrire ? tr('transcription.corriger') : tr('transcription.lire')} onPress={() => setEditeur(v => !v)} testID={`${idt}-editeur`} />
      ) : null}
      {editeur ? (
        <EditeurTranscription
          theme={theme}
          client={client}
          teamId={teamId}
          depotId={depot.id}
          onEnregistre={() => {
            onChange?.();
          }}
        />
      ) : null}
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe={idt} />
    </View>
  );
}

/** Éditeur des segments horodatés : correction du texte, puis enregistrement (PDF régénéré). */
export function EditeurTranscription({ theme, client, teamId, depotId, onEnregistre }: { theme: ThemeHub; client: ClientEsport; teamId: string; depotId: string; onEnregistre?(): void }) {
  const api = useMemo(() => apiMedias(client, teamId), [client, teamId]);
  const [t, setT] = useState<Transcription | undefined>();
  const [segments, setSegments] = useState<SegmentTranscription[]>([]);
  const [modifie, setModifie] = useState(false);
  // Version affichée : relue par l'IA locale (par défaut) ou brute (texte de Whisper tel quel).
  const [version, setVersion] = useState<'corrigee' | 'brute'>('corrigee');
  const { enCours, erreur, avis, agir } = useAgir();
  useEffect(() => {
    void agir('', async () => {
      const lu = await api.transcription(depotId);
      setT(lu);
      setSegments(lu.segments);
      setVersion('corrigee');
    });
  }, [agir, api, depotId]);
  if (!t) return <Retours theme={theme} erreur={erreur} prefixe="esport-transcription-editeur" />;
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  return (
    <View testID="esport-transcription-editeur" style={{ gap: 8 }}>
      <Text style={attenue}>
        {[t.moteur, t.qualite ? libelleQualite(t.qualite) : null, t.modifiePar?.pseudo && t.modifiePar.compte !== t.auteur?.compte ? tr('transcription.corrigee_par', { nom: t.modifiePar.pseudo }) : null, tr('transcription.segments', { n: t.segments.length })].filter(Boolean).join(' · ')}
      </Text>
      {t.segmentsBruts?.length ? (
        <View style={{ gap: 4 }}>
          <Segments
            theme={theme}
            libelle={tr('transcription.version.titre')}
            valeur={version}
            options={[
              ['corrigee', tr('transcription.version.corrigee')],
              ['brute', tr('transcription.version.brute')],
            ]}
            onChoisir={v => {
              const brute = v === 'brute';
              setVersion(brute ? 'brute' : 'corrigee');
              setSegments(brute ? (t.segmentsBruts ?? t.segments) : t.segments);
              // Garder la version brute = l'enregistrer comme texte de la transcription.
              setModifie(brute);
            }}
            testID="esport-transcription-version"
          />
          <Text style={attenue} testID="esport-transcription-version-explication">
            {version === 'brute' ? tr('transcription.version.explication_brute') : tr('transcription.version.explication_corrigee', { v: t.correction ?? '' })}
          </Text>
        </View>
      ) : null}
      {t.preResume.length ? (
        <View testID="esport-transcription-preresume" style={{ gap: 2, padding: 8, borderRadius: 8, backgroundColor: teinteTransparente(theme.accent, 0.08) }}>
          <Text style={{ color: theme.texte, fontWeight: '700', fontSize: 13, ...police(theme.policeTexte) }}>{tr('transcription.pre_resume')}</Text>
          {t.preResume.map((p, i) => (
            <Text key={i} style={{ color: theme.texte, fontSize: 13, ...police(theme.policeTexte) }}>
              • [{timecode(p.debut)}] {p.texte}
            </Text>
          ))}
        </View>
      ) : null}
      <View style={{ gap: 4, maxHeight: 480 }}>
        {segments.map((s, i) => (
          <View key={`${s.debut}-${i}`} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
            <Text style={{ color: theme.attenue, fontWeight: '700', minWidth: 72, paddingTop: 8, ...police(theme.policeChiffres) }}>{timecode(s.debut)}</Text>
            {t.peutModifier ? (
              <TextInput
                testID={`esport-transcription-segment-${i}`}
                accessibilityLabel={tr('transcription.segment_a', { v: timecode(s.debut) })}
                value={s.texte}
                multiline
                maxLength={2000}
                onChangeText={v => {
                  setModifie(true);
                  setSegments(l => l.map((x, j) => (j === i ? { ...x, texte: v } : x)));
                }}
                style={{ flex: 1, minHeight: 40, color: theme.texte, borderWidth: 1, borderColor: theme.ligne, borderRadius: 8, padding: 8, backgroundColor: theme.surface, ...police(theme.policeTexte) }}
              />
            ) : (
              <Text style={{ flex: 1, color: theme.texte, paddingTop: 8, ...police(theme.policeTexte) }}>{s.texte}</Text>
            )}
          </View>
        ))}
      </View>
      {t.peutModifier ? (
        <BoutonHub
          theme={theme}
          titre={enCours === 'enregistrer' ? tr('transcription.enregistrement_en_cours') : tr('transcription.enregistrer')}
          variante="plein"
          desactive={Boolean(enCours) || (!modifie && t.statut === 'prete')}
          onPress={() =>
            void agir('enregistrer', async () => {
              const r = await api.enregistrerTranscription(depotId, { segments, langue: t.langue, moteur: t.moteur || 'navigateur', ...(t.duree ? { duree: t.duree } : {}) });
              setT(r);
              setSegments(r.segments);
              setModifie(false);
              onEnregistre?.();
              return tr('transcription.enregistree');
            })
          }
          testID="esport-transcription-enregistrer"
        />
      ) : null}
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-transcription-editeur" />
    </View>
  );
}
