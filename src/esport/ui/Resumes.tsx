/**
 * Module « Résumés de réunions » de l'Esport (phase 3).
 *
 *  - Membre : déposer une réunion (lien, type, date, titre, note), suivre
 *    ses dépôts, ouvrir ou télécharger le PDF quand le résumé est prêt ;
 *    bibliothèque des résumés lisibles de la team.
 *  - Rédacteur (Fondateur, rôles avec `meeting_summaries.write_summary`) :
 *    boîte de réception (toutes les teams accessibles, ou celle de la page),
 *    filtres et tri, « Nouveau » / « Vu », statuts, dépôt et remplacement du
 *    PDF (Terminé automatiquement), historique des versions ; types de
 *    réunion et leur visibilité.
 *
 * Les droits sont vérifiés par le serveur ; l'interface n'affiche que ce
 * qu'il permet. Le PDF s'ouvre par un lien signé valable quelques minutes.
 */

import { useCible } from './notifications/Cible';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { BoutonHub, Case, Champ, Segments } from '../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../hub/themes';
import { nomTypeReunion, type Boite, type ClientEsport, type Depot, type DetailDepot, type DetailTeam, type FiltresBoite, type StatutDepot, type TypeReunion } from '../client';
import { LIBELLES_STATUT_DEPOT, aujourdhui, dateCourte, dateJour, lireDateSaisie, tailleLisible } from '../libelles';
import { choisirPdf, choixPdfDisponible } from './choixPdf';
import { ouvrirLienDiffere } from './ouvrirLien';
import { ChampNote } from './ChampNote';
import { BoutonConfirme, Choix, PastilleRole, Retours, styles, useAgir, Intertitre, Panneau } from './commun';
import { NoteMarkdown } from './review/Note';
import { Carte, ESP, EnTetePage, EtatVide, Onglets } from './design';
import { ACCEPT_REUNION, choisirFichier, choixFichierDisponible, type FichierNavigateur } from '../medias/choixFichier';
import { capaciteAppareil } from '../transcription/appareil';
import { BarreEnvoi, InfosFichier, useEnvoi } from './medias/EnvoiMedia';
import { PanneauTranscription, demarrerTranscription, type LangueTranscription } from './medias/Transcription';
import { ChoixModeTranscription, ChoixQualite, modeParDefaut, modesProposes, qualiteRetenue, useReglagesTranscription } from './medias/TranscriptionServeur';
import type { ModeTranscription, QualiteTranscription } from '../client';
import { tr, trn } from '../i18n';
import { ChampDate, ChampPeriode } from '../../ui/dates';

type VueResumes = 'deposer' | 'miens' | 'bibliotheque' | 'boite' | 'types';

const COULEURS_STATUT = (theme: ThemeHub): Record<StatutDepot, string> => ({ a_resumer: theme.alerte, en_cours: theme.accent, termine: theme.ok });

export function PastilleStatut({ theme, statut, testID }: { theme: ThemeHub; statut: StatutDepot; testID?: string }) {
  return <PastilleRole theme={theme} nom={LIBELLES_STATUT_DEPOT[statut]} couleur={COULEURS_STATUT(theme)[statut]} testID={testID} />;
}

export function BadgeNouveau({ theme, testID }: { theme: ThemeHub; testID?: string }) {
  return (
    <Text testID={testID} style={{ color: theme.surAccent, backgroundColor: theme.accent, fontSize: 11, fontWeight: '800', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, overflow: 'hidden' }}>
      {tr('resumes.nouveau')}</Text>
  );
}

/** Ouvre le PDF (lien signé, quelques minutes) dans le lecteur du système. */
export function ouvrirPdf(client: ClientEsport, teamId: string, depotId: string, options: { fichierId?: string; telecharger?: boolean } = {}) {
  return ouvrirLienDiffere(async () => (await client.lienPdf(teamId, depotId, options)).url);
}

/** Libellés courts des vues (iPhone). */
const COURTS_RESUMES: Partial<Record<VueResumes, string>> = { get boite() {
      return tr('resumes.boite');
    }, get types() {
      return tr('resumes.types');
    }, get bibliotheque() {
      return tr('resumes.resumes');
    }, get miens() {
      return tr('resumes.mes_depots');
    } };

export function SectionResumes({ theme, client, detail, large }: { theme: ThemeHub; client: ClientEsport; detail: DetailTeam; large: boolean }) {
  const peut = (p: string) => detail.moi.permissions.includes(p);
  const redacteur = peut('meeting_summaries.write_summary');
  const options = useMemo(() => {
    const o: Array<readonly [VueResumes, string]> = [];
    if (peut('meeting_summaries.submit')) o.push(['deposer', tr('resumes.deposer')], ['miens', tr('resumes.mes_depots')]);
    if (peut('meeting_summaries.view_summary') || peut('meeting_summaries.view_all') || redacteur) o.push(['bibliotheque', tr('resumes.resumes')]);
    if (redacteur || peut('meeting_summaries.view_all')) o.push(['boite', tr('racineEsport.boite_de_reception')]);
    if (redacteur) o.push(['types', tr('resumes.types_de_reunion')]);
    return o;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail]);
  const [vue, setVue] = useState<VueResumes>(options[0]?.[0] ?? 'bibliotheque');
  const active = options.some(o => o[0] === vue) ? vue : (options[0]?.[0] ?? 'bibliotheque');
  return (
    <View style={{ gap: ESP.l }} testID="esport-resumes">
      <EnTetePage
        theme={theme}
        large={large}
        titre={tr('resumes.resumes_de_reunions')}
        sous={tr('resumes.deposez_l_enregistrement_d')}
        action={
          options.some(o => o[0] === 'deposer') && active !== 'deposer' ? (
            <BoutonHub theme={theme} titre={tr('resumes.deposer_une_reunion')} variante="plein" onPress={() => setVue('deposer')} testID="esport-resumes-nouveau" />
          ) : undefined
        }
      />
      {options.length > 1 ? (
        <Onglets
          theme={theme}
          prefixe="esport-resumes-vue"
          actif={active}
          defilant={!large && options.length > 3}
          pleineLargeur={!large && options.length <= 3}
          onChoisir={v => setVue(v as VueResumes)}
          entrees={options.map(([id, nom]) => ({ id, libelle: large ? nom : (COURTS_RESUMES[id] ?? nom), description: nom }))}
        />
      ) : null}
      {options.length === 0 ? (
        <Carte theme={theme}>
          <EtatVide theme={theme} glyphe="✎" titre={tr('resumes.pas_d_acces_aux')} texte={tr('resumes.votre_role_ne_donne')} />
        </Carte>
      ) : null}
      {active === 'deposer' ? <FormulaireDepot theme={theme} client={client} teamId={detail.team.id} onDepose={() => setVue('miens')} /> : null}
      {active === 'miens' ? <MesDepots theme={theme} client={client} teamId={detail.team.id} /> : null}
      {active === 'bibliotheque' ? <Bibliotheque theme={theme} client={client} teamId={detail.team.id} /> : null}
      {active === 'boite' ? <BoiteResumes theme={theme} client={client} large={large} teamFixe={detail.team.id} /> : null}
      {active === 'types' ? <TypesReunion theme={theme} client={client} teamId={detail.team.id} superAdmin={detail.moi.superAdmin} /> : null}
    </View>
  );
}

// ------------------------------------------------------------------ Membre

function FormulaireDepot({ theme, client, teamId, onDepose }: { theme: ThemeHub; client: ClientEsport; teamId: string; onDepose(): void }) {
  const [types, setTypes] = useState<TypeReunion[]>([]);
  // L'enregistrement est déposé directement (par défaut sur le site et le PC) ; le lien externe reste possible.
  const [mode, setMode] = useState<'fichier' | 'lien'>(choixFichierDisponible ? 'fichier' : 'lien');
  const [fichier, setFichier] = useState<FichierNavigateur | undefined>();
  const capacite = useMemo(() => capaciteAppareil(), []);
  // Où transcrire : sur le serveur (automatique, même depuis un iPhone), dans ce navigateur, ou par l'API externe.
  const { reglages } = useReglagesTranscription(client, teamId);
  const modes = useMemo(() => modesProposes(reglages, capacite.transcription), [reglages, capacite.transcription]);
  const [modeChoisi, setModeChoisi] = useState<ModeTranscription | undefined>();
  const modeTranscription = modeChoisi && modes.includes(modeChoisi) ? modeChoisi : modeParDefaut(reglages, modes);
  const [transcrireChoisi, setTranscrire] = useState<boolean | undefined>();
  // Cochée par défaut sur le serveur (partout) ; dans le navigateur, seulement sur un PC assez puissant.
  const transcrire = transcrireChoisi ?? (modeTranscription === 'serveur' || modeTranscription === 'externe' || (modeTranscription === 'navigateur' && !capacite.iphone && !capacite.faible));
  // Langue : celle choisie ici, sinon celle de la team (Paramètres ; « auto » = détection, sur le serveur).
  const [langueChoisie, setLangue] = useState<LangueTranscription | 'auto' | undefined>();
  const langueTeam = reglages?.langue ?? 'fr';
  const langue = langueChoisie ?? (modeTranscription === 'serveur' ? langueTeam : langueTeam === 'en' ? 'en' : 'fr');
  const [qualite, setQualite] = useState<QualiteTranscription | undefined>();
  const qualiteChoisie = qualiteRetenue(reglages?.qualites, qualite ?? reglages?.qualite);
  const envoi = useEnvoi();
  const [lien, setLien] = useState('');
  const [typeId, setTypeId] = useState<string | undefined>();
  const [date, setDate] = useState(dateJour(aujourdhui()));
  const [titre, setTitre] = useState('');
  const [note, setNote] = useState('');
  const { enCours, erreur, avis, agir, setErreur } = useAgir();
  useEffect(() => {
    void agir('', async () => {
      const t = await client.typesReunion(teamId);
      setTypes(t);
      setTypeId(prec => prec ?? t[0]?.id);
    });
  }, [agir, client, teamId]);
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  const type = types.find(t => t.id === typeId);
  return (
    <Panneau theme={theme} style={{ maxWidth: 820 }} testID="esport-depot-formulaire">
      <Intertitre theme={theme}>{tr('resumes.nouveau_depot')}</Intertitre>
      {choixFichierDisponible ? (
        <Segments
          theme={theme}
          libelle={tr('transcription.depot.mode')}
          valeur={mode}
          options={[
            ['fichier', tr('transcription.depot.fichier')],
            ['lien', tr('transcription.depot.lien')],
          ]}
          onChoisir={v => setMode(v === 'lien' ? 'lien' : 'fichier')}
          testID="esport-depot-mode"
        />
      ) : null}
      {mode === 'fichier' ? (
        <View style={{ gap: 8 }}>
          <View style={[styles.ligne, { alignItems: 'center' }]}>
            <BoutonHub
              theme={theme}
              titre={fichier ? tr('medias.changer_de_fichier') : tr('transcription.depot.choisir')}
              desactive={envoi.enCours}
              onPress={() =>
                void choisirFichier(ACCEPT_REUNION, 'esport-depot-fichier-champ').then(f => {
                  if (!f) return;
                  setFichier(f);
                  envoi.effacer();
                  if (titre.trim().length < 2) setTitre(f.nom.replace(/\.[a-z0-9]{2,4}$/i, '').slice(0, 120));
                })
              }
              testID="esport-depot-fichier"
            />
            {fichier ? <InfosFichier theme={theme} nom={fichier.nom} taille={fichier.taille} testID="esport-depot-fichier-infos" /> : null}
          </View>
          <Text style={attenue}>{tr('transcription.depot.formats')}</Text>
          <BarreEnvoi theme={theme} progression={envoi.progression} enCours={envoi.enCours} onAnnuler={envoi.annuler} testID="esport-depot-envoi" />
          <Champ theme={theme} libelle={tr('transcription.depot.lien_facultatif')} valeur={lien} onChanger={setLien} placeholder="https://…" maxLength={500} testID="esport-depot-lien" />
          {modeTranscription ? (
            <View style={{ gap: 6 }}>
              <View style={styles.ligne}>
                <Case theme={theme} coche={transcrire} libelle={tr('transcription.depot.transcrire')} onChanger={setTranscrire} testID="esport-depot-transcrire" />
                <Text style={{ color: theme.texte, flex: 1, ...police(theme.policeTexte) }}>{tr('transcription.depot.transcrire')}</Text>
              </View>
              {transcrire ? <ChoixModeTranscription theme={theme} modes={modes} valeur={modeTranscription} onChoisir={setModeChoisi} serveurAbsent={Boolean(reglages) && !reglages?.disponibles.serveur} /> : null}
              {transcrire ? (
                <Segments
                  theme={theme}
                  libelle={tr('transcription.langue')}
                  valeur={langue}
                  options={[
                    ['fr', tr('transcription.francais')],
                    ['en', tr('transcription.anglais')],
                    ...(modeTranscription === 'serveur' ? ([['auto', tr('transcription.langue_auto')]] as const) : []),
                  ]}
                  onChoisir={v => setLangue(v === 'en' ? 'en' : v === 'auto' ? 'auto' : 'fr')}
                  testID="esport-depot-langue"
                />
              ) : null}
              {transcrire && modeTranscription === 'serveur' ? <ChoixQualite theme={theme} qualites={reglages?.qualites} valeur={qualiteChoisie} onChoisir={setQualite} testID="esport-depot-qualite" /> : null}
              {modeTranscription === 'navigateur' && (capacite.iphone || capacite.faible) ? <Text style={attenue}>{tr('transcription.appareil_faible')}</Text> : null}
            </View>
          ) : null}
        </View>
      ) : (
        <Champ theme={theme} libelle={tr('resumes.lien_de_l_enregistrement')} valeur={lien} onChanger={setLien} placeholder="https://…" maxLength={500} testID="esport-depot-lien" />
      )}
      <Choix theme={theme} libelle={tr('resumes.type_de_reunion')} valeur={typeId} options={types.map(t => ({ id: t.id, nom: t.visibilite === 'staff' && !/staff/i.test(t.nom) ? tr('resumes.staff_2', { nom: nomTypeReunion(t.nom) }) : nomTypeReunion(t.nom), couleur: t.couleur }))} onChoisir={setTypeId} testID="esport-depot-type" />
      {type?.visibilite === 'staff' ? <Text style={attenue}>{tr('resumes.resume_visible_du_staff')}</Text> : null}
      <View style={[styles.ligne, { alignItems: 'flex-start' }]}>
        <ChampDate theme={theme} format="fr" libelle={tr('resumes.date_jj_mm_aaaa')} valeur={date} onChanger={setDate} testID="esport-depot-date" style={{ minWidth: 160 }} />
        <Champ theme={theme} libelle={tr('objectifs.titre')} valeur={titre} onChanger={setTitre} maxLength={120} testID="esport-depot-titre" style={{ flex: 1, minWidth: 220 }} />
      </View>
      <ChampNote theme={theme} libelle={tr('resumes.note_facultative')} valeur={note} onChanger={setNote} maxLength={2000} testID="esport-depot-note" />
      <BoutonHub
        theme={theme}
        titre={enCours === 'depot' ? (envoi.enCours ? tr('medias.envoi.envoi_en_cours') : tr('resumes.envoi')) : tr('resumes.deposer_la_reunion')}
        variante="plein"
        desactive={Boolean(enCours) || (mode === 'fichier' ? !fichier : !lien.trim()) || titre.trim().length < 2 || !typeId}
        onPress={() => {
          const iso = lireDateSaisie(date);
          if (!iso) {
            setErreur(tr('resumes.date_jj_mm_aaaa_2'));
            return;
          }
          void agir('depot', async () => {
            let suite: string | undefined;
            if (mode === 'fichier' && fichier) {
              // Envoi par morceaux (reprise possible), puis dépôt avec cet enregistrement.
              const { etat, oublier } = await envoi.lancer({ client, teamId, section: 'resumes', fichier });
              const depot = await client.deposerReunion(teamId, {
                envoi: etat.id,
                ...(lien.trim() ? { lien: lien.trim() } : {}),
                typeId: typeId!,
                dateReunion: iso,
                titre: titre.trim(),
                note: note.trim() || undefined,
                ...(transcrire && modeTranscription ? { transcription: modeTranscription, langue: modeTranscription === 'serveur' ? langue : langue === 'en' ? 'en' : 'fr', ...(modeTranscription === 'serveur' && qualiteChoisie ? { qualite: qualiteChoisie } : {}) } : {}),
              });
              oublier();
              const statutT = depot.transcription?.statut;
              // Le serveur (ou l'API) s'en charge : rien à faire ici.
              if (transcrire && (statutT === 'serveur' || statutT === 'externe')) suite = statutT === 'serveur' ? tr('transcription.depot.depose_serveur') : tr('transcription.sur_le_serveur_demandee');
              // Navigateur choisi, ou serveur indisponible : transcription dans ce navigateur, avec le fichier encore
              // ouvert (rien à retélécharger) ; elle continue en arrière-plan.
              else if (transcrire && capacite.transcription) {
                await demarrerTranscription({ client, teamId, depot, fichier: fichier.fichier as Blob, langue: langue === 'en' ? 'en' : 'fr' });
                suite = modeTranscription === 'navigateur' ? tr('transcription.depot.depose_et_transcription') : tr('transcription.depot.repli_navigateur');
              } else if (transcrire) suite = tr('transcription.depot.repli_plus_tard');
              setFichier(undefined);
              envoi.effacer();
            } else {
              await client.deposerReunion(teamId, { lien: lien.trim(), typeId: typeId!, dateReunion: iso, titre: titre.trim(), note: note.trim() || undefined });
            }
            setLien('');
            setTitre('');
            setNote('');
            onDepose();
            return suite ?? tr('resumes.reunion_deposee_le_redacteur');
          });
        }}
        testID="esport-depot-envoyer"
      />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-depot" />
    </Panneau>
  );
}

function LigneDepot({
  theme,
  depot,
  onOuvrirPdf,
  onSupprimer,
  avecDeposant,
  client,
  teamId,
  onChange,
}: {
  theme: ThemeHub;
  depot: Depot;
  onOuvrirPdf?(telecharger: boolean): void;
  onSupprimer?(): void;
  avecDeposant?: boolean;
  client?: ClientEsport;
  teamId?: string;
  onChange?(): void;
}) {
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 8, gap: 4 }} testID={`esport-depot-${depot.id}`}>
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <Text style={{ color: theme.texte, fontWeight: '700', flexShrink: 1, ...police(theme.policeTexte) }}>{depot.titre}</Text>
        <PastilleStatut theme={theme} statut={depot.statut} testID={`esport-depot-statut-${depot.id}`} />
      </View>
      <Text style={attenue}>
        {depot.type?.nom ?? tr('resumes.type_supprime')} · {tr('resumes.reunion_du', { date: dateJour(depot.dateReunion) })}
        {avecDeposant ? tr('resumes.depose_par', { nom: depot.deposePar.pseudo ?? tr('resumes.un_compte_supprime') }) : tr('resumes.depose_le', { v: dateCourte(depot.creeLe) })}
      </Text>
      {onOuvrirPdf || onSupprimer ? (
        <View style={styles.ligne}>
          {onOuvrirPdf && depot.resume ? (
            <>
              <BoutonHub theme={theme} titre={tr('resumes.ouvrir_le_pdf')} variante="plein" onPress={() => onOuvrirPdf(false)} testID={`esport-depot-pdf-${depot.id}`} />
              <BoutonHub theme={theme} titre={tr('resumes.telecharger')} onPress={() => onOuvrirPdf(true)} testID={`esport-depot-telecharger-${depot.id}`} />
            </>
          ) : null}
          {onSupprimer ? <BoutonConfirme theme={theme} titre={tr('resumes.retirer')} confirmation={tr('resumes.oui_retirer_ce_depot')} onConfirme={onSupprimer} testID={`esport-depot-retirer-${depot.id}`} /> : null}
        </View>
      ) : null}
      {client && teamId ? <PanneauTranscription theme={theme} client={client} teamId={teamId} depot={depot} onChange={onChange} /> : null}
    </View>
  );
}

function MesDepots({ theme, client, teamId }: { theme: ThemeHub; client: ClientEsport; teamId: string }) {
  const [depots, setDepots] = useState<Depot[] | undefined>();
  const { erreur, avis, agir } = useAgir();
  const charger = useCallback(() => agir('', async () => setDepots(await client.mesDepots(teamId))), [agir, client, teamId]);
  useEffect(() => {
    void charger();
  }, [charger]);
  return (
    <Panneau theme={theme} testID="esport-mes-depots">
      <Intertitre theme={theme}>{tr('resumes.mes_depots')}</Intertitre>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-mes-depots" />
      {depots?.length === 0 ? <Text style={{ color: theme.attenue }}>{tr('resumes.aucun_depot_pour_l')}</Text> : null}
      {depots?.map(d => (
        <LigneDepot
          key={d.id}
          theme={theme}
          depot={d}
          client={client}
          teamId={teamId}
          onChange={() => void charger()}
          onOuvrirPdf={telecharger => void agir('PDF', () => ouvrirPdf(client, teamId, d.id, { telecharger }))}
          onSupprimer={
            d.statut === 'a_resumer'
              ? () =>
                  void agir('retrait', async () => {
                    await client.supprimerDepot(teamId, d.id);
                    setDepots(await client.mesDepots(teamId));
                    return tr('resumes.depot_retire');
                  })
              : undefined
          }
        />
      ))}
    </Panneau>
  );
}

function Bibliotheque({ theme, client, teamId }: { theme: ThemeHub; client: ClientEsport; teamId: string }) {
  const [resumes, setResumes] = useState<Depot[] | undefined>();
  const { erreur, agir } = useAgir();
  useEffect(() => {
    void agir('', async () => setResumes(await client.resumesTeam(teamId, 50)));
  }, [agir, client, teamId]);
  return (
    <Panneau theme={theme} testID="esport-bibliotheque">
      <Intertitre theme={theme}>{tr('resumes.resumes_de_la_team')}</Intertitre>
      <Retours theme={theme} erreur={erreur} prefixe="esport-bibliotheque" />
      {resumes?.length === 0 ? <Text style={{ color: theme.attenue }}>{tr('accueilPhase3.aucun_resume_publie_pour')}</Text> : null}
      {resumes?.map(d => (
        <LigneDepot key={d.id} theme={theme} depot={d} avecDeposant client={client} teamId={teamId} onOuvrirPdf={telecharger => void agir('PDF', () => ouvrirPdf(client, teamId, d.id, { telecharger }))} />
      ))}
    </Panneau>
  );
}

// ------------------------------------------------------------------ Rédacteur

const optionsStatut = (): ReadonlyArray<readonly ['' | StatutDepot, string]> => [
  ['', tr('journal.tous')],
  ['a_resumer', tr('libelles.a_resumer')],
  ['en_cours', tr('libelles.en_cours')],
  ['termine', tr('creationCompte.termine')],
];
const optionsTri = (): ReadonlyArray<readonly [NonNullable<FiltresBoite['tri']>, string]> => [
  ['recent', tr('resumes.plus_recents')],
  ['ancien', tr('resumes.plus_anciens')],
  ['statut', tr('resumes.par_statut')],
  ['date', tr('resumes.date_de_reunion')],
];

/**
 * Boîte de réception du rédacteur : toutes les teams accessibles (ou
 * `teamFixe`), filtres, tri, compteurs ; le détail s'ouvre à côté (PC) ou
 * en dessous (téléphone) et marque le dépôt « Vu ».
 */
export function BoiteResumes({ theme, client, large, teamFixe, onCompteurs }: { theme: ThemeHub; client: ClientEsport; large: boolean; teamFixe?: string; onCompteurs?(b: Boite): void }) {
  const [filtres, setFiltres] = useState<FiltresBoite>({ tri: 'recent' });
  const [du, setDu] = useState('');
  const [au, setAu] = useState('');
  const [boite, setBoite] = useState<Boite | undefined>();
  const [ouvert, setOuvert] = useState<{ teamId: string; id: string } | undefined>();
  const { enCours, erreur, agir, setErreur } = useAgir();
  // Lien direct d'une notification (dépôt, transcription prête, résumé publié) : le dépôt s'ouvre.
  useCible('resumes', c => {
    if (c.g === 'reunion' && typeof c.reunion === 'string' && typeof c.team === 'string') setOuvert({ teamId: c.team, id: c.reunion });
  });
  // Rappel du parent gardé dans une référence : une fonction recréée à chaque rendu ne relance pas le chargement.
  const rappel = useRef(onCompteurs);
  rappel.current = onCompteurs;

  const charger = useCallback(
    () =>
      agir('boite', async () => {
        const b = await client.boiteResumes({ ...filtres, team: teamFixe ?? filtres.team });
        setBoite(b);
        rappel.current?.(b);
      }),
    [agir, client, filtres, teamFixe],
  );
  useEffect(() => {
    void charger();
  }, [charger]);

  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  const appliquerDates = () => {
    const d = du.trim() ? lireDateSaisie(du) : undefined;
    const a = au.trim() ? lireDateSaisie(au) : undefined;
    if ((du.trim() && !d) || (au.trim() && !a)) {
      setErreur(tr('journal.dates_jj_mm_aaaa'));
      return;
    }
    setFiltres(f => ({ ...f, du: d, au: a }));
  };

  const liste = (
    <View style={{ gap: 12, flex: large && ouvert ? 1 : undefined, minWidth: 0 }}>
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <Text style={{ color: theme.texte, fontSize: 16, fontWeight: '800', ...police(theme.policeTitre) }} testID="esport-boite-compteur">
          {boite ? tr('resumes.boite_resume', { attente: boite.attente, nouveaux: trn('resumes.nouveaux', boite.nouveaux) }) : tr('racineEsport.boite_de_reception')}
        </Text>
        <BoutonHub theme={theme} titre={enCours === 'boite' ? tr('resumes.actualisation') : tr('resumes.actualiser')} onPress={() => void charger()} testID="esport-boite-actualiser" />
      </View>
      <Panneau theme={theme} testID="esport-boite-filtres">
        <Segments theme={theme} libelle={tr('membresGlobal.statut')} valeur={filtres.statut ?? ''} options={optionsStatut()} onChoisir={v => setFiltres(f => ({ ...f, statut: v || undefined }))} testID="esport-boite-statut" />
        {!teamFixe && (boite?.teams.length ?? 0) > 1 ? (
          <Choix
            theme={theme}
            libelle={tr('demandesCompte.team')}
            valeur={filtres.team ?? ''}
            options={[{ id: '', nom: tr('journal.toutes') }, ...(boite?.teams ?? []).map(t => ({ id: t.id, nom: t.nom }))]}
            onChoisir={v => setFiltres(f => ({ ...f, team: v || undefined }))}
            testID="esport-boite-team"
          />
        ) : null}
        {(boite?.types.length ?? 0) > 0 ? (
          <Choix
            theme={theme}
            libelle={tr('resumes.type')}
            valeur={filtres.type ?? ''}
            options={[{ id: '', nom: tr('journal.tous') }, ...(boite?.types ?? []).map(t => ({ id: t.id, nom: nomTypeReunion(t.nom), couleur: t.couleur }))]}
            onChoisir={v => setFiltres(f => ({ ...f, type: v || undefined }))}
            testID="esport-boite-type"
          />
        ) : null}
        {(boite?.deposants.length ?? 0) > 1 ? (
          <Choix
            theme={theme}
            libelle={tr('resumes.deposant')}
            valeur={filtres.deposePar ?? ''}
            options={[{ id: '', nom: tr('journal.tous') }, ...(boite?.deposants ?? []).map(d => ({ id: d.compte, nom: d.pseudo ?? tr('resumes.compte_supprime') }))]}
            onChoisir={v => setFiltres(f => ({ ...f, deposePar: v || undefined }))}
            testID="esport-boite-deposant"
          />
        ) : null}
        <View style={[styles.ligne, { alignItems: 'flex-end' }]}>
          <ChampPeriode theme={theme} format="fr" libelleDu={tr('journal.du_jj_mm_aaaa')} libelleAu={tr('resumes.au')} du={du} au={au} onDu={setDu} onAu={setAu} testIDDu="esport-boite-du" testIDAu="esport-boite-au" style={{ flexGrow: 1, flexBasis: 360 }} styleChamp={{ maxWidth: 220 }} />
          <BoutonHub theme={theme} titre={tr('resumes.appliquer')} onPress={appliquerDates} testID="esport-boite-dates" />
        </View>
        <View style={styles.ligne}>
          <Case theme={theme} coche={Boolean(filtres.nouveaux)} libelle={tr('resumes.nouveaux_seulement')} onChanger={v => setFiltres(f => ({ ...f, nouveaux: v || undefined }))} testID="esport-boite-nouveaux" />
          <Text style={{ color: theme.texte, ...police(theme.policeTexte) }}>{tr('resumes.nouveaux_seulement')}</Text>
        </View>
        <Segments theme={theme} libelle={tr('resumes.tri')} valeur={filtres.tri ?? 'recent'} options={optionsTri()} onChoisir={tri => setFiltres(f => ({ ...f, tri }))} testID="esport-boite-tri" />
      </Panneau>
      <Retours theme={theme} erreur={erreur} prefixe="esport-boite" />
      <View style={{ gap: 8 }} testID="esport-boite-liste">
        {boite?.depots.length === 0 ? <Text style={attenue}>{tr('resumes.aucun_depot_ne_correspond')}</Text> : null}
        {boite?.depots.map(d => {
          const choisi = ouvert?.id === d.id;
          return (
            <Pressable
              key={d.id}
              testID={`esport-boite-depot-${d.id}`}
              accessibilityRole="button"
              accessibilityLabel={tr('resumes.ouvrir', { titre: d.titre })}
              onPress={() => setOuvert({ teamId: d.team.id, id: d.id })}
              style={{
                borderWidth: 1,
                borderColor: choisi ? theme.accent : theme.ligne,
                backgroundColor: choisi ? teinteTransparente(theme.accent, 0.1) : theme.surface,
                borderRadius: Math.min(theme.rayonMoyen, 12),
                padding: 12,
                gap: 4,
              }}>
              <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
                <View style={[styles.ligne, { flexShrink: 1 }]}>
                  {d.nouveau ? <BadgeNouveau theme={theme} testID={`esport-boite-nouveau-${d.id}`} /> : null}
                  <Text style={{ color: theme.texte, fontWeight: d.nouveau ? '800' : '600', flexShrink: 1, ...police(theme.policeTexte) }}>{d.titre}</Text>
                </View>
                <PastilleStatut theme={theme} statut={d.statut} />
              </View>
              <Text style={attenue}>
                {teamFixe ? '' : `${d.team.nom ?? tr('demandesCompte.team')} · `}
                {d.type?.nom ?? tr('resumes.type_supprime')} · {dateJour(d.dateReunion)} · {d.deposePar.pseudo ?? tr('resumes.compte_supprime')}{tr('resumes.depose_le', { v: dateCourte(d.creeLe) })}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const detail = ouvert ? (
    <DetailDepotRedacteur
      key={ouvert.id}
      theme={theme}
      client={client}
      teamId={ouvert.teamId}
      depotId={ouvert.id}
      onChange={() => void charger()}
      onFermer={() => setOuvert(undefined)}
    />
  ) : null;

  return (
    <View testID="esport-boite" style={large ? { flexDirection: 'row', gap: 16, alignItems: 'flex-start' } : { gap: 16 }}>
      {liste}
      {detail ? <View style={large ? { flex: 1, minWidth: 0 } : undefined}>{detail}</View> : null}
    </View>
  );
}

function DetailDepotRedacteur({
  theme,
  client,
  teamId,
  depotId,
  onChange,
  onFermer,
}: {
  theme: ThemeHub;
  client: ClientEsport;
  teamId: string;
  depotId: string;
  onChange(): void;
  onFermer(): void;
}) {
  const [d, setD] = useState<DetailDepot | undefined>();
  const { enCours, erreur, avis, agir } = useAgir();
  useEffect(() => {
    void agir('', async () => {
      const lu = await client.depot(teamId, depotId);
      // Ouvrir un dépôt « Nouveau » le marque « Vu » (rédacteur seulement).
      if (lu.nouveau && lu.moi.redacteur) {
        setD(await client.marquerVu(teamId, depotId));
        onChange();
      } else setD(lu);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agir, client, teamId, depotId]);
  if (!d) return <Retours theme={theme} erreur={erreur} prefixe="esport-detail-depot" />;
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const changer = (statut: StatutDepot) =>
    void agir('statut', async () => {
      setD(await client.changerStatutDepot(teamId, depotId, statut));
      onChange();
      return tr('resumes.statut', { v: LIBELLES_STATUT_DEPOT[statut] });
    });
  return (
    <Panneau theme={theme} testID="esport-detail-depot">
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <Text style={[texte, { fontSize: 17, fontWeight: '800', flexShrink: 1 }]}>{d.titre}</Text>
        <BoutonHub theme={theme} titre={tr('discord.fermer')} onPress={onFermer} testID="esport-detail-fermer" />
      </View>
      <View style={styles.ligne}>
        <PastilleStatut theme={theme} statut={d.statut} testID="esport-detail-statut" />
        {d.type ? <PastilleRole theme={theme} nom={d.type.visibilite === 'staff' ? tr('resumes.staff_3', { nom: nomTypeReunion(d.type.nom) }) : nomTypeReunion(d.type.nom)} couleur={d.type.couleur} /> : null}
        {d.vu ? <Text style={attenue}>{tr('resumes.vu_le', { v: dateCourte(d.vu.le) })}</Text> : null}
      </View>
      <Text style={attenue}>
        {tr('resumes.detail_ligne', { team: d.team.nom ?? tr('demandesCompte.team'), date: dateJour(d.dateReunion), nom: d.deposePar.pseudo ?? tr('resumes.un_compte_supprime'), creeLe: dateCourte(d.creeLe) })}
      </Text>
      {d.lien ? (
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(d.lien)} testID="esport-detail-lien">
          <Text style={{ color: theme.accent, textDecorationLine: 'underline', ...police(theme.policeTexte) }} numberOfLines={2}>
            {d.lien}
          </Text>
        </Pressable>
      ) : null}
      <PanneauTranscription
        theme={theme}
        client={client}
        teamId={teamId}
        depot={d}
        onChange={() => {
          void client.depot(teamId, depotId).then(setD, () => undefined);
          onChange();
        }}
      />
      {d.note ? <NoteMarkdown theme={theme} source={d.note} testID="esport-detail-note" /> : null}
      {d.moi.redacteur ? (
        <>
          <Intertitre theme={theme}>{tr('membresGlobal.statut')}</Intertitre>
          <View style={styles.ligne}>
            {(['a_resumer', 'en_cours', 'termine'] as const).map(s => (
              <BoutonHub
                key={s}
                theme={theme}
                titre={LIBELLES_STATUT_DEPOT[s]}
                variante={d.statut === s ? 'plein' : 'normal'}
                desactive={Boolean(enCours) || d.statut === s || (s === 'termine' && !d.resume)}
                onPress={() => changer(s)}
                testID={`esport-detail-statut-${s}`}
              />
            ))}
          </View>
          {!d.resume ? <Text style={attenue}>{tr('resumes.termine_se_pose_tout')}</Text> : null}
          <Intertitre theme={theme}>{tr('resumes.resume_en_pdf')}</Intertitre>
          {choixPdfDisponible ? (
            <BoutonHub
              theme={theme}
              titre={enCours === 'PDF' ? tr('resumes.envoi_du_pdf') : d.resume ? tr('resumes.remplacer_le_pdf') : tr('resumes.deposer_le_pdf')}
              variante="plein"
              desactive={Boolean(enCours)}
              onPress={() =>
                void agir('PDF', async () => {
                  const f = await choisirPdf();
                  if (!f) return;
                  if (f.taille > 20 * 1024 * 1024) throw new Error(tr('resumes.pdf_trop_volumineux_20'));
                  setD(await client.envoyerPdf(teamId, depotId, f.octets, f.nom));
                  onChange();
                  return d.resume ? tr('resumes.pdf_remplace_l_ancien') : tr('resumes.resume_publie_le_deposant');
                })
              }
              testID="esport-detail-pdf"
            />
          ) : (
            <Text style={attenue}>{tr('resumes.deposez_le_pdf_depuis')}</Text>
          )}
        </>
      ) : null}
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-detail" />
      {d.fichiers.length > 0 ? (
        <View style={{ gap: 6 }} testID="esport-detail-historique">
          <Intertitre theme={theme}>{d.fichiers.length > 1 ? tr('resumes.versions_du_pdf') : 'PDF'}</Intertitre>
          {d.fichiers.map(f => (
            <View key={f.id} style={[styles.ligne, { borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 6 }]} testID={`esport-detail-fichier-${f.id}`}>
              <Text style={[texte, { flex: 1, minWidth: 160, fontWeight: f.actuel ? '700' : '400' }]}>
                {f.nom} <Text style={attenue}>· {tailleLisible(f.taille)} · {dateCourte(f.le)}{f.actuel ? tr('resumes.actuel') : tr('resumes.remplace')}</Text>
              </Text>
              <BoutonHub theme={theme} titre={tr('resumes.ouvrir_2')} onPress={() => void agir('ouvrir', () => ouvrirPdf(client, teamId, depotId, { fichierId: f.id }))} testID={`esport-detail-ouvrir-${f.id}`} />
            </View>
          ))}
        </View>
      ) : null}
    </Panneau>
  );
}

// ------------------------------------------------------------------ Types de réunion

function TypesReunion({ theme, client, teamId, superAdmin }: { theme: ThemeHub; client: ClientEsport; teamId: string; superAdmin: boolean }) {
  const [types, setTypes] = useState<TypeReunion[] | undefined>();
  const [nom, setNom] = useState('');
  const [visibilite, setVisibilite] = useState<'team' | 'staff'>('team');
  const { enCours, erreur, avis, agir } = useAgir();
  const recharger = useCallback(async () => setTypes(await client.typesReunion(teamId)), [client, teamId]);
  useEffect(() => {
    void agir('', recharger);
  }, [agir, recharger]);
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  return (
    <Panneau theme={theme} testID="esport-types-reunion">
      <Intertitre theme={theme}>{tr('resumes.types_de_reunion')}</Intertitre>
      <Text style={attenue}>{tr('resumes.team_les_membres_qui')}</Text>
      {types?.map(t => {
        const modifiable = !t.global || superAdmin;
        return (
          <View key={t.id} style={[styles.ligne, { borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 6 }]} testID={`esport-type-${t.id}`}>
            <PastilleRole theme={theme} nom={nomTypeReunion(t.nom)} couleur={t.couleur} />
            <Text style={[attenue, { flex: 1 }]}>{t.global ? tr('resumes.commun_a_toutes_les') : tr('resumes.propre_a_la_team')}</Text>
            {modifiable ? (
              <Segments
                theme={theme}
                libelle={tr('resumes.visibilite_de', { nom: nomTypeReunion(t.nom) })}
                valeur={t.visibilite}
                options={[
                  ['team', tr('demandesCompte.team')],
                  ['staff', tr('resumes.staff')],
                ]}
                onChoisir={v =>
                  void agir('type', async () => {
                    await client.modifierTypeReunion(teamId, t.id, { visibilite: v });
                    await recharger();
                    return tr(v === 'staff' ? 'resumes.visible_staff' : 'resumes.visible_team', { nom: nomTypeReunion(t.nom) });
                  })
                }
                testID={`esport-type-visibilite-${t.id}`}
              />
            ) : (
              <Text style={attenue}>{t.visibilite === 'staff' ? tr('resumes.staff') : tr('demandesCompte.team')}</Text>
            )}
            {modifiable ? (
              <BoutonConfirme
                theme={theme}
                titre={tr('discord.supprimer')}
                confirmation={tr('objectifs.oui')}
                onConfirme={() =>
                  void agir('type', async () => {
                    await client.supprimerTypeReunion(teamId, t.id);
                    await recharger();
                    return tr('resumes.supprime_les_depots_existants', { nom: nomTypeReunion(t.nom) });
                  })
                }
                testID={`esport-type-supprimer-${t.id}`}
              />
            ) : null}
          </View>
        );
      })}
      <View style={[styles.ligne, { alignItems: 'flex-end' }]}>
        <Champ theme={theme} libelle={tr('resumes.nouveau_type')} valeur={nom} onChanger={setNom} maxLength={40} testID="esport-type-nom" style={{ flex: 1, minWidth: 180 }} />
        <Segments
          theme={theme}
          libelle={tr('resumes.visibilite')}
          valeur={visibilite}
          options={[
            ['team', tr('demandesCompte.team')],
            ['staff', tr('resumes.staff')],
          ]}
          onChoisir={v => setVisibilite(v as 'team' | 'staff')}
          testID="esport-type-nouvelle-visibilite"
        />
        <BoutonHub
          theme={theme}
          titre={tr('ajoutTeams.ajouter')}
          variante="plein"
          desactive={Boolean(enCours) || nom.trim().length < 2}
          onPress={() =>
            void agir('type', async () => {
              await client.creerTypeReunion(teamId, { nom: nom.trim(), visibilite });
              setNom('');
              await recharger();
              return tr('resumes.type_ajoute');
            })
          }
          testID="esport-type-ajouter"
        />
      </View>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-types" />
    </Panneau>
  );
}
