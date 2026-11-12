/**
 * Module « Ressources » : le canal de ressources de la team (liens, vidéos YouTube, fichiers déposés,
 * notes), rangé en catégories configurables.
 *
 *  - Fil façon canal : liste chronologique ou grille, épinglées d'abord ; catégories en pastilles,
 *    recherche, filtres (tag, map, agent, type, niveau, auteur, favoris) ; compteur « nouveau depuis
 *    ma dernière visite » ; favoris personnels ; réactions et commentaires.
 *  - Détail (volet) : aperçu du lien, lecteur YouTube intégré et « Ouvrir en review vidéo », fichier
 *    (image affichée, PDF et vidéo ouverts, archive téléchargée), note riche.
 *  - Publier (staff) ou proposer (joueurs, si la team l'ouvre) : file de validation pour le staff.
 *  - Gérer les catégories (créer, renommer, réordonner, supprimer) et les réglages (propositions,
 *    salon Discord dédié).
 *
 * Droits vérifiés par le serveur (esport/noyau/ressources/service.mjs) ; l'écran n'affiche que ce que
 * le serveur permet.
 */

import { useCible } from '../notifications/Cible';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { BoutonHub, Champ, Segments } from '../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { dateCourte } from '../../libelles';
import {
  GENRES_RESSOURCE,
  NIVEAUX_RESSOURCE,
  apiRessources,
  type ApercuLien,
  type ApiRessources,
  type CanalRessources,
  type CategorieRessource,
  type DetailRessource,
  type FiltresRessources,
  type GenreRessource,
  type NiveauRessource,
  type ReglagesRessources,
  type Ressource,
  type SaisieRessource,
  type VisibiliteRessource,
} from '../../ressources/api';
import { GLYPHES_GENRE, nomCategorie, nomGenre, nomNiveau } from '../../ressources/libelles';
import { Icone } from '../../../ui/icones';
import { extraireYoutube, miniatureYoutube } from '../../review/youtube';
import { lireTags } from '../../strats/libelles';
import { ACCEPT_RESSOURCE, choisirFichier, choixFichierDisponible, type FichierNavigateur } from '../../medias/choixFichier';
import { tr, trn } from '../../i18n';
import { ChampNote } from '../ChampNote';
import { BoutonConfirme, Choix, Panneau, Retours, styles, useAgir } from '../commun';
import { Badge, Carte, ESP, EnTetePage, EtatVide, Grille, Onglets, Pliable, SqueletteCartes, TYPO, Volet, attenue, texte, type EtatPresse } from '../design';
import { BarreEnvoi, InfosFichier, useEnvoi } from '../medias/EnvoiMedia';
import type { PropsModule } from '../modules';
import { ouvrirLienDiffere } from '../ouvrirLien';
import { Lecteur } from '../review/Lecteur';
import { NoteMarkdown } from '../review/Note';
import { Filtre, useAssetsTeam } from '../strats/commun';
import { agentsActifs, cartesDuPool } from '../../jeux/profil';

type Onglet = 'fil' | 'file' | 'miennes';
type Vue = 'liste' | 'grille';

const CLE_VUE = 'esport-ressources-vue';
type Stockage = { getItem(c: string): string | null; setItem(c: string, v: string): void };
function vueMemorisee(): Vue {
  try {
    return (globalThis as { localStorage?: Stockage }).localStorage?.getItem(CLE_VUE) === 'grille' ? 'grille' : 'liste';
  } catch {
    return 'liste';
  }
}
function memoriserVue(v: Vue): void {
  try {
    (globalThis as { localStorage?: Stockage }).localStorage?.setItem(CLE_VUE, v);
  } catch {
    // Préférence de confort : sans stockage, on garde la liste.
  }
}

/** Image d'aperçu d'une ressource (page web, miniature YouTube), ou null. */
function imageDe(r: Ressource): string | null {
  if (r.genre === 'youtube' && r.videoId) return miniatureYoutube(r.videoId);
  return r.apercu?.image ?? null;
}

export function Ressources({ theme, client, detail, large, onAller }: PropsModule) {
  const teamId = detail.team.id;
  const api = useMemo(() => apiRessources(client), [client]);
  const [donnees, setDonnees] = useState<CanalRessources | undefined>();
  const [onglet, setOnglet] = useState<Onglet>('fil');
  const [filtres, setFiltres] = useState<FiltresRessources>({});
  const [recherche, setRecherche] = useState('');
  const [vue, setVue] = useState<Vue>(vueMemorisee);
  const [ouverte, setOuverte] = useState<string | undefined>();
  // Lien direct d'une notification : l'élément visé s'ouvre.
  useCible('ressources', c => {
    if (c.g === 'ressource' && typeof c.ressource === 'string') setOuverte(c.ressource);
  });
  const [edition, setEdition] = useState<{ ressource?: DetailRessource } | undefined>();
  const [categoriesOuvert, setCategoriesOuvert] = useState(false);
  const [reglagesOuvert, setReglagesOuvert] = useState(false);
  const [nouveaux, setNouveaux] = useState<{ n: number; ids: Set<string> } | undefined>();
  const vuEnvoye = useRef(false);
  const { erreur, avis, agir } = useAgir();
  const reviewActif = detail.modules.some(m => m.cle === 'video_review' && m.active) && detail.moi.permissions.includes('video_review.view');

  const recharger = useCallback(async () => {
    const d = await api.canal(teamId, { ...filtres, q: recherche.trim() || undefined, file: onglet === 'file' || undefined, miennes: onglet === 'miennes' || undefined });
    setDonnees(d);
    // Compteur « nouveau depuis ma dernière visite » : figé à l'ouverture, puis le canal est marqué vu.
    if (!vuEnvoye.current) {
      vuEnvoye.current = true;
      setNouveaux({ n: d.nouveaux, ids: new Set(d.ressources.filter(r => r.nouveau).map(r => r.id)) });
      void api.vu(teamId).catch(() => undefined);
    }
  }, [api, teamId, filtres, recherche, onglet]);
  useEffect(() => {
    void agir('', recharger);
  }, [agir, recharger]);

  const moi = donnees?.moi;
  const peutAjouter = Boolean(moi?.poster || moi?.proposer);
  const categories = donnees?.categories ?? [];
  const ongletsVisibles: Array<{ id: Onglet; libelle: string }> = [{ id: 'fil', libelle: tr('ressources.onglet.fil') }];
  if (moi?.gerer) ongletsVisibles.push({ id: 'file', libelle: tr('ressources.onglet.file', { n: donnees?.file ?? 0 }) });
  if (moi?.proposer || (donnees?.mesPropositions ?? 0) > 0) ongletsVisibles.push({ id: 'miennes', libelle: tr('ressources.onglet.miennes', { n: donnees?.mesPropositions ?? 0 }) });

  const resumeFiltres = [
    filtres.tag ? `#${filtres.tag}` : '',
    filtres.carte ? (donnees?.cartes.find(c => c.cle === filtres.carte)?.nom ?? filtres.carte) : '',
    filtres.agent ? (donnees?.agents.find(c => c.cle === filtres.agent)?.nom ?? filtres.agent) : '',
    filtres.genre ? nomGenre(filtres.genre) : '',
    filtres.niveau ? nomNiveau(filtres.niveau) : '',
    filtres.auteur ? (donnees?.auteurs.find(a => a.compte === filtres.auteur)?.pseudo ?? '?') : '',
    filtres.favoris ? tr('ressources.favoris') : '',
  ].filter(Boolean);

  const ouvrirDetail = (id: string) => setOuverte(id);
  const liste = donnees?.ressources ?? [];
  const estNouveau = (r: Ressource) => Boolean(nouveaux?.ids.has(r.id));

  return (
    <View style={{ gap: ESP.l }} testID="esport-ressources">
      <EnTetePage
        theme={theme}
        large={large}
        titre={tr('ressources.titre')}
        sous={tr('ressources.sous')}
        action={
          peutAjouter ? (
            <BoutonHub theme={theme} titre={moi?.poster ? tr('ressources.nouvelle') : tr('ressources.proposer')} variante="plein" onPress={() => setEdition({})} testID="esport-ressources-nouvelle" />
          ) : undefined
        }
        actions={[
          moi?.gerer && { titre: tr('ressources.gerer_categories'), onPress: () => setCategoriesOuvert(true), testID: 'esport-ressources-categories' },
          moi?.gerer && { titre: tr('ressources.reglages'), onPress: () => setReglagesOuvert(true), testID: 'esport-ressources-reglages' },
        ]}
      />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-ressources" />
      {nouveaux && nouveaux.n > 0 ? (
        <View style={[styles.ligne, { gap: ESP.xs }]}>
          <Badge theme={theme} ton="accent" texte={trn('ressources.nouveaux', nouveaux.n)} testID="esport-ressources-nouveaux" />
        </View>
      ) : null}
      {ongletsVisibles.length > 1 ? (
        <Onglets theme={theme} prefixe="esport-ressources-onglet" testID="esport-ressources-onglets" actif={onglet} onChoisir={id => setOnglet(id as Onglet)} entrees={ongletsVisibles} pleineLargeur={!large} />
      ) : null}
      {onglet === 'fil' ? (
        <ScrollView horizontal={!large} showsHorizontalScrollIndicator={false} contentContainerStyle={large ? { flexGrow: 1 } : undefined}>
        <View style={[styles.ligne, { gap: ESP.xs }, large ? null : { flexWrap: 'nowrap' }]} accessibilityRole="radiogroup" accessibilityLabel={tr('ressources.categories')} testID="esport-ressources-categories-filtre">
          <PastilleCategorie theme={theme} libelle={tr('ressources.toutes', { n: donnees?.total ?? 0 })} actif={!filtres.categorie} onPress={() => setFiltres(f => ({ ...f, categorie: undefined }))} testID="esport-ressources-cat-tous" />
          {categories.map(c => (
            <PastilleCategorie key={c.id} theme={theme} libelle={`${nomCategorie(c)} · ${c.n ?? 0}`} actif={filtres.categorie === c.id} onPress={() => setFiltres(f => ({ ...f, categorie: f.categorie === c.id ? undefined : c.id }))} testID={`esport-ressources-cat-${c.id}`} />
          ))}
          {donnees?.sansCategorie ? (
            <PastilleCategorie theme={theme} libelle={`${tr('ressources.sans_categorie')} · ${donnees.sansCategorie}`} actif={filtres.categorie === 'sans'} onPress={() => setFiltres(f => ({ ...f, categorie: f.categorie === 'sans' ? undefined : 'sans' }))} testID="esport-ressources-cat-sans" />
          ) : null}
        </View>
        </ScrollView>
      ) : null}
      <View style={[styles.ligne, { gap: ESP.s, alignItems: 'flex-end' }]}>
        <Champ theme={theme} libelle={tr('membresGlobal.rechercher')} valeur={recherche} onChanger={setRecherche} placeholder={tr('ressources.recherche_placeholder')} maxLength={60} style={{ flexGrow: 1, flexBasis: 240, maxWidth: 480 }} testID="esport-ressources-recherche" />
        <Segments<Vue>
          theme={theme}
          libelle={tr('ressources.affichage')}
          valeur={vue}
          options={[['liste', tr('ressources.vue.liste')], ['grille', tr('ressources.vue.grille')]]}
          onChoisir={v => {
            setVue(v);
            memoriserVue(v);
          }}
          testID="esport-ressources-vue"
        />
      </View>
      <Pliable theme={theme} titre={tr('planning.planning.filtres')} resume={resumeFiltres.join(' · ') || tr('planning.planning.filtre_aucun')} ouvertParDefaut={false} testID="esport-ressources-filtres-ouvrir">
        <Panneau theme={theme} testID="esport-ressources-filtres">
          <Filtre<GenreRessource> theme={theme} libelle={tr('resumes.type')} valeur={filtres.genre ?? ''} options={[['', tr('journal.tous')], ...GENRES_RESSOURCE.map(g => [g, nomGenre(g)] as const)]} onChoisir={v => setFiltres(f => ({ ...f, genre: v || undefined }))} testID="esport-ressources-filtre-genre" />
          <Filtre<NiveauRessource> theme={theme} libelle={tr('ressources.niveau')} valeur={filtres.niveau ?? ''} options={[['', tr('journal.tous')], ...NIVEAUX_RESSOURCE.map(n => [n, nomNiveau(n)] as const)]} onChoisir={v => setFiltres(f => ({ ...f, niveau: v || undefined }))} testID="esport-ressources-filtre-niveau" />
          {donnees?.tags.length ? <Filtre theme={theme} libelle={tr('strats.playbook.tag')} valeur={filtres.tag ?? ''} options={[['', tr('journal.tous')], ...donnees.tags.map(t => [t, `#${t}`] as const)]} onChoisir={v => setFiltres(f => ({ ...f, tag: v || undefined }))} testID="esport-ressources-filtre-tag" /> : null}
          {donnees?.cartes.length ? <Filtre theme={theme} libelle={tr('strats.editeur.carte')} valeur={filtres.carte ?? ''} options={[['', tr('journal.toutes')], ...donnees.cartes.map(c => [c.cle, c.nom] as const)]} onChoisir={v => setFiltres(f => ({ ...f, carte: v || undefined }))} testID="esport-ressources-filtre-carte" /> : null}
          {donnees?.agents.length ? <Filtre theme={theme} libelle={tr('ressources.agent')} valeur={filtres.agent ?? ''} options={[['', tr('journal.tous')], ...donnees.agents.map(c => [c.cle, c.nom] as const)]} onChoisir={v => setFiltres(f => ({ ...f, agent: v || undefined }))} testID="esport-ressources-filtre-agent" /> : null}
          {donnees?.auteurs.length ? <Filtre theme={theme} libelle={tr('ressources.auteur')} valeur={filtres.auteur ?? ''} options={[['', tr('journal.tous')], ...donnees.auteurs.map(a => [a.compte, a.pseudo ?? '?'] as const)]} onChoisir={v => setFiltres(f => ({ ...f, auteur: v || undefined }))} testID="esport-ressources-filtre-auteur" /> : null}
          <Filtre<'1'> theme={theme} libelle={tr('ressources.favoris')} valeur={filtres.favoris ? '1' : ''} options={[['', tr('strats.playbook.tout')], ['1', tr('ressources.mes_favoris')]]} onChoisir={v => setFiltres(f => ({ ...f, favoris: v === '1' || undefined }))} testID="esport-ressources-filtre-favoris" />
        </Panneau>
      </Pliable>
      {!donnees && !erreur ? <SqueletteCartes theme={theme} n={large ? 3 : 2} large={large} /> : null}
      {donnees && liste.length === 0 ? (
        <Carte theme={theme} testID="esport-ressources-vide">
          <EtatVide
            theme={theme}
            glyphe="bibliotheque"
            titre={onglet === 'file' ? tr('ressources.vide.file') : onglet === 'miennes' ? tr('ressources.vide.miennes') : donnees.total === 0 ? tr('ressources.vide.titre') : tr('ressources.vide.filtres')}
            texte={onglet === 'fil' && donnees.total === 0 ? tr(peutAjouter ? 'ressources.vide.texte_staff' : 'ressources.vide.texte') : undefined}
            action={onglet === 'fil' && donnees.total === 0 && peutAjouter ? { titre: moi?.poster ? tr('ressources.nouvelle') : tr('ressources.proposer'), onPress: () => setEdition({}), testID: 'esport-ressources-vide-ajouter' } : undefined}
          />
        </Carte>
      ) : null}
      {liste.length ? (
        vue === 'grille' ? (
          <Grille min={large ? 260 : 300} testID="esport-ressources-grille">
            {liste.map(r => (
              <CarteRessource key={r.id} theme={theme} r={r} grille nouveau={estNouveau(r)} onOuvrir={() => ouvrirDetail(r.id)} />
            ))}
          </Grille>
        ) : (
          <View style={{ gap: ESP.s }} testID="esport-ressources-liste">
            {liste.map(r => (
              <CarteRessource key={r.id} theme={theme} r={r} nouveau={estNouveau(r)} onOuvrir={() => ouvrirDetail(r.id)} />
            ))}
          </View>
        )
      ) : null}
      {ouverte ? (
        <DetailVolet
          theme={theme}
          api={api}
          teamId={teamId}
          id={ouverte}
          large={large}
          emojis={donnees?.emojis ?? []}
          reviewActif={reviewActif}
          onFermer={() => setOuverte(undefined)}
          onChange={() => void agir('', recharger)}
          onModifier={r => {
            setOuverte(undefined);
            setEdition({ ressource: r });
          }}
          onReview={reviewId => {
            setOuverte(undefined);
            onAller('module:video_review', undefined, reviewId);
          }}
        />
      ) : null}
      {edition ? (
        <FormulaireRessource
          theme={theme}
          client={client}
          api={api}
          teamId={teamId}
          large={large}
          categories={categories}
          droits={{ staff: Boolean(moi?.staff), poster: Boolean(moi?.poster), gerer: Boolean(moi?.gerer) }}
          existante={edition.ressource}
          onFermer={() => setEdition(undefined)}
          onEnregistree={(r, message) => {
            setEdition(undefined);
            void agir('', async () => {
              await recharger();
              return message;
            });
            if (r.statut === 'publiee') setOuverte(r.id);
          }}
        />
      ) : null}
      {categoriesOuvert ? <GestionCategories theme={theme} api={api} teamId={teamId} categories={categories} onFermer={() => setCategoriesOuvert(false)} onChange={() => void agir('', recharger)} /> : null}
      {reglagesOuvert ? <ReglagesVolet theme={theme} api={api} teamId={teamId} onFermer={() => setReglagesOuvert(false)} onChange={() => void agir('', recharger)} /> : null}
    </View>
  );
}

// ------------------------------------------------------------------ Pastilles et cartes

function PastilleCategorie({ theme, libelle, actif, onPress, testID }: { theme: ThemeHub; libelle: string; actif: boolean; onPress(): void; testID: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ checked: actif }}
      accessibilityLabel={libelle}
      onPress={onPress}
      style={(etat: EtatPresse) => ({
        minHeight: 44,
        justifyContent: 'center',
        paddingHorizontal: ESP.s,
        borderRadius: theme.rayonGrand ? 999 : 6,
        borderWidth: 1,
        borderColor: actif || etat.hovered ? theme.accent : theme.ligne,
        backgroundColor: actif ? teinteTransparente(theme.accent, 0.18) : theme.surface,
      })}>
      <Text style={{ ...texte(theme, 14), fontWeight: actif ? '700' : '500' }}>{libelle}</Text>
    </Pressable>
  );
}

function CarteRessource({ theme, r, grille, nouveau, onOuvrir }: { theme: ThemeHub; r: Ressource; grille?: boolean; nouveau: boolean; onOuvrir(): void }) {
  const image = imageDe(r);
  const auteur = r.auteur?.pseudo ?? tr('jr.compte_supprime');
  const quand = r.publieLe ?? r.creeLe;
  const reactions = r.reactions.reduce((n, x) => n + x.n, 0);
  return (
    <Carte theme={theme} dense onPress={onOuvrir} libelle={tr('ressources.ouvrir_ressource', { titre: r.titre })} testID={`esport-ressource-${r.id}`} accent={r.epingle ? theme.accent : undefined} style={grille ? { height: '100%' } : undefined}>
      <View style={grille ? { gap: ESP.s } : { flexDirection: 'row', gap: ESP.m, alignItems: 'flex-start' }}>
        {image ? (
          <Image
            source={{ uri: image }}
            accessibilityIgnoresInvertColors
            accessibilityLabel={tr('ressources.apercu_image')}
            style={grille ? { width: '100%', aspectRatio: 16 / 9, borderRadius: 8, backgroundColor: theme.fond } : { width: 120, height: 68, borderRadius: 8, backgroundColor: theme.fond }}
          />
        ) : (
          <View style={grille ? { width: '100%', aspectRatio: 16 / 9, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: teinteTransparente(theme.accent, 0.08) } : { width: 52, height: 52, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: teinteTransparente(theme.accent, 0.1) }}>
            <Icone nom={GLYPHES_GENRE[r.genre]} taille={grille ? 34 : 24} couleur={theme.texte} />
          </View>
        )}
        <View style={{ flex: grille ? undefined : 1, minWidth: 0, gap: ESP.xxs }}>
          <Text style={{ ...texte(theme, 16), fontWeight: '700' }} numberOfLines={2} testID={`esport-ressource-${r.id}-titre`}>
            {r.epingle ? <><Icone nom="epingle" libelle={tr('suivi.epinglee')} /> </> : null}
            {r.titre}
          </Text>
          <View style={[styles.ligne, { gap: 6 }]}>
            {nouveau ? <Badge theme={theme} ton="accent" texte={tr('ressources.nouveau')} testID={`esport-ressource-${r.id}-nouveau`} /> : null}
            <Badge theme={theme} texte={nomCategorie(r.categorie)} />
            <Badge theme={theme} icone={GLYPHES_GENRE[r.genre]} texte={nomGenre(r.genre)} />
            {r.niveau ? <Badge theme={theme} texte={nomNiveau(r.niveau)} /> : null}
            {r.visibilite === 'staff' ? <Badge theme={theme} ton="alerte" texte={tr('ressources.staff_seulement')} testID={`esport-ressource-${r.id}-staff`} /> : null}
            {r.statut === 'proposee' ? <Badge theme={theme} ton="alerte" texte={tr('ressources.statut.proposee')} /> : null}
            {r.statut === 'refusee' ? <Badge theme={theme} ton="critique" texte={tr('ressources.statut.refusee')} /> : null}
          </View>
          {r.apercu?.description && !grille ? (
            <Text style={attenue(theme, TYPO.texte)} numberOfLines={2}>
              {r.apercu.description}
            </Text>
          ) : null}
          <Text style={attenue(theme)} numberOfLines={1}>
            {[auteur, dateCourte(quand), r.carte?.nom, r.agent?.nom, ...r.tags.map(t => `#${t}`)].filter(Boolean).join(' · ')}
          </Text>
          <Text style={attenue(theme)} testID={`esport-ressource-${r.id}-compteurs`}>
            {[r.favori ? '★' : '', reactions ? `${r.reactions.map(x => x.emoji).join('')} ${reactions}` : ''].filter(Boolean).join('   ')}
            {r.commentaires ? <>{r.favori || reactions ? '   ' : ''}<Icone nom="bulle" /> {r.commentaires}</> : null}
          </Text>
        </View>
      </View>
    </Carte>
  );
}

// ------------------------------------------------------------------ Détail

function CarteApercu({ theme, apercu, url, testID }: { theme: ThemeHub; apercu: ApercuLien | null; url: string | null; testID?: string }) {
  if (!apercu && !url) return null;
  return (
    <View testID={testID} style={{ borderWidth: 1, borderColor: theme.ligne, borderRadius: 10, overflow: 'hidden', backgroundColor: theme.surface }}>
      {apercu?.image ? <Image source={{ uri: apercu.image }} accessibilityIgnoresInvertColors accessibilityLabel={tr('ressources.apercu_image')} style={{ width: '100%', aspectRatio: 1.91, backgroundColor: theme.fond }} /> : null}
      <View style={{ padding: ESP.s, gap: 4 }}>
        {apercu?.site ? <Text style={attenue(theme)}>{apercu.site}</Text> : null}
        {apercu?.titre ? <Text style={{ ...texte(theme, 15), fontWeight: '700' }}>{apercu.titre}</Text> : null}
        {apercu?.description ? (
          <Text style={attenue(theme, TYPO.texte)} numberOfLines={4}>
            {apercu.description}
          </Text>
        ) : null}
        {url ? (
          <Text style={{ ...attenue(theme), color: theme.accent }} numberOfLines={1}>
            {url}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function ouvrirAdresse(url: string): void {
  const ouvrir = (globalThis as { open?: (u: string, cible: string, options?: string) => unknown }).open;
  if (ouvrir) ouvrir(url, '_blank', 'noopener,noreferrer');
  else void Linking.openURL(url);
}

function DetailVolet({
  theme,
  api,
  teamId,
  id,
  large,
  emojis,
  reviewActif,
  onFermer,
  onChange,
  onModifier,
  onReview,
}: {
  theme: ThemeHub;
  api: ApiRessources;
  teamId: string;
  id: string;
  large: boolean;
  emojis: string[];
  reviewActif: boolean;
  onFermer(): void;
  onChange(): void;
  onModifier(r: DetailRessource): void;
  onReview(reviewId: string): void;
}) {
  const [r, setR] = useState<DetailRessource | undefined>();
  const [commentaire, setCommentaire] = useState('');
  const [motif, setMotif] = useState('');
  const [imageFichier, setImageFichier] = useState<string | undefined>();
  const { enCours, erreur, avis, agir } = useAgir();
  const charger = useCallback(async () => setR(await api.detail(teamId, id)), [api, teamId, id]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);
  const estImage = Boolean(r?.fichier && r.fichier.type.startsWith('image/'));
  useEffect(() => {
    if (!estImage || !r) return;
    api.lienFichier(teamId, r.id).then(l => setImageFichier(l.url), () => undefined);
  }, [api, teamId, r, estImage]);
  const changer = (action: () => Promise<unknown>, message?: string) =>
    void agir('action', async () => {
      await action();
      await charger();
      onChange();
      return message;
    });

  return (
    <Volet theme={theme} visible titre={r?.titre ?? tr('ressources.titre')} onFermer={onFermer} testID="esport-ressource-detail" largeur={large ? 640 : 560}>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-ressource-detail" />
      {!r ? null : (
        <View style={{ gap: ESP.m }}>
          <View style={[styles.ligne, { gap: 6 }]}>
            <Badge theme={theme} texte={nomCategorie(r.categorie)} />
            <Badge theme={theme} icone={GLYPHES_GENRE[r.genre]} texte={nomGenre(r.genre)} />
            {r.niveau ? <Badge theme={theme} texte={nomNiveau(r.niveau)} /> : null}
            {r.visibilite === 'staff' ? <Badge theme={theme} ton="alerte" texte={tr('ressources.staff_seulement')} /> : null}
            {r.statut !== 'publiee' ? <Badge theme={theme} ton={r.statut === 'refusee' ? 'critique' : 'alerte'} texte={tr(r.statut === 'refusee' ? 'ressources.statut.refusee' : 'ressources.statut.proposee')} /> : null}
            {r.epingle ? <Badge theme={theme} ton="accent" texte={tr('ressources.epinglee')} /> : null}
          </View>
          <Text style={attenue(theme)} testID="esport-ressource-detail-auteur">
            {tr('ressources.par_le', { auteur: r.auteur?.pseudo ?? tr('jr.compte_supprime'), date: dateCourte(r.publieLe ?? r.creeLe) })}
            {r.validePar && r.statut === 'publiee' ? tr('ressources.validee_par', { nom: r.validePar.pseudo ?? '?' }) : ''}
          </Text>
          {r.statut === 'refusee' && r.motifRefus ? <Text style={{ ...texte(theme), color: theme.critique }}>{tr('ressources.motif_refus', { motif: r.motifRefus })}</Text> : null}

          {r.genre === 'youtube' && r.videoId ? (
            <View style={{ gap: ESP.s }} testID="esport-ressource-video">
              <Lecteur theme={theme} videoId={r.videoId} depart={extraireYoutube(r.url)?.debut ?? 0} large={large} onPret={() => undefined} />
              <View style={styles.ligne}>
                {reviewActif ? (
                  <BoutonHub
                    theme={theme}
                    titre={tr('ressources.ouvrir_en_review')}
                    variante="plein"
                    desactive={Boolean(enCours)}
                    onPress={() =>
                      void agir('review', async () => {
                        const o = await api.ouvrirEnReview(teamId, r.id);
                        onReview(o.reviewId);
                      })
                    }
                    testID="esport-ressource-ouvrir-review"
                  />
                ) : null}
                {r.url ? <BoutonHub theme={theme} titre={tr('ressources.ouvrir_youtube')} onPress={() => ouvrirAdresse(r.url ?? '')} testID="esport-ressource-ouvrir" /> : null}
              </View>
            </View>
          ) : null}
          {r.genre === 'lien' ? (
            <View style={{ gap: ESP.s }}>
              <CarteApercu theme={theme} apercu={r.apercu} url={r.url} testID="esport-ressource-apercu" />
              {r.url ? <BoutonHub theme={theme} titre={tr('ressources.ouvrir_lien')} variante="plein" onPress={() => ouvrirAdresse(r.url ?? '')} testID="esport-ressource-ouvrir" /> : null}
            </View>
          ) : null}
          {r.genre === 'fichier' && r.fichier ? (
            <View style={{ gap: ESP.s }} testID="esport-ressource-fichier">
              {estImage && imageFichier ? <Image source={{ uri: imageFichier }} accessibilityLabel={r.fichier.nom} style={{ width: '100%', aspectRatio: 16 / 10, borderRadius: 8, resizeMode: 'contain', backgroundColor: theme.fond }} testID="esport-ressource-image" /> : null}
              <InfosFichier theme={theme} nom={r.fichier.nom} taille={r.fichier.taille} testID="esport-ressource-fichier-infos" />
              {r.fichier.supprime ? (
                <Text style={attenue(theme)}>{tr('ressources.fichier_supprime')}</Text>
              ) : (
                <View style={styles.ligne}>
                  <BoutonHub theme={theme} titre={tr('ressources.ouvrir_fichier')} variante="plein" onPress={() => void agir('fichier', () => ouvrirLienDiffere(async () => (await api.lienFichier(teamId, r.id)).url))} testID="esport-ressource-ouvrir" />
                  <BoutonHub theme={theme} titre={tr('ressources.telecharger')} onPress={() => void agir('fichier', () => ouvrirLienDiffere(async () => (await api.lienFichier(teamId, r.id, true)).url))} testID="esport-ressource-telecharger" />
                </View>
              )}
            </View>
          ) : null}
          {r.description ? (
            <Panneau theme={theme} testID="esport-ressource-description">
              <NoteMarkdown theme={theme} source={r.description} />
            </Panneau>
          ) : null}
          {r.tags.length || r.carte || r.agent ? (
            <Text style={attenue(theme)}>{[r.carte?.nom, r.agent?.nom, ...r.tags.map(t => `#${t}`)].filter(Boolean).join(' · ')}</Text>
          ) : null}

          {r.statut === 'publiee' ? (
            <View style={{ gap: ESP.s }}>
              <View style={[styles.ligne, { gap: 6 }]} accessibilityLabel={tr('ressources.reactions')} testID="esport-ressource-reactions">
                {emojis.map((e, i) => {
                  const x = r.reactions.find(y => y.emoji === e);
                  const moi = Boolean(x?.moi);
                  return (
                    <Pressable
                      key={e}
                      testID={`esport-ressource-reagir-${i}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: moi }}
                      accessibilityLabel={tr('ressources.reagir', { emoji: e, n: x?.n ?? 0 })}
                      onPress={() =>
                        void agir('reaction', async () => {
                          const { reactions } = await api.reagir(teamId, r.id, e, !moi);
                          setR({ ...r, reactions });
                          onChange();
                        })
                      }
                      style={(etat: EtatPresse) => ({
                        minHeight: 44,
                        minWidth: 52,
                        paddingHorizontal: 10,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 4,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: moi ? theme.accent : theme.ligne,
                        backgroundColor: moi ? teinteTransparente(theme.accent, 0.18) : etat.hovered ? teinteTransparente(theme.attenue, 0.12) : theme.surface,
                      })}>
                      <Text style={{ fontSize: 16 }}>{e}</Text>
                      {x?.n ? (
                        <Text style={{ ...texte(theme, 14), fontWeight: moi ? '800' : '600' }} testID={`esport-ressource-reagir-${i}-n`}>
                          {x.n}
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })}
                <Pressable
                  testID="esport-ressource-favori"
                  accessibilityRole="button"
                  accessibilityState={{ selected: r.favori }}
                  accessibilityLabel={r.favori ? tr('strats.playbook.retirer_des_favoris') : tr('strats.playbook.ajouter_aux_favoris')}
                  onPress={() => changer(() => api.favori(teamId, r.id, !r.favori))}
                  style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: r.favori ? theme.alerte : theme.attenue, fontSize: 22 }}>{r.favori ? '★' : '☆'}</Text>
                </Pressable>
              </View>
              <Text style={{ ...texte(theme, TYPO.titreCarte), fontWeight: '700' }} accessibilityRole="header">
                {trn('ressources.commentaires', r.listeCommentaires.length)}
              </Text>
              <View style={{ gap: ESP.xs }} testID="esport-ressource-commentaires">
                {r.listeCommentaires.map(c => (
                  <View key={c.id} style={{ gap: 2, paddingVertical: ESP.xxs, borderBottomWidth: 1, borderBottomColor: theme.ligne }} testID={`esport-ressource-commentaire-${c.id}`}>
                    <Text style={attenue(theme)}>{`${c.auteur?.pseudo ?? tr('jr.compte_supprime')} · ${dateCourte(c.creeLe)}`}</Text>
                    <NoteMarkdown theme={theme} source={c.texte} />
                    {c.supprimable ? (
                      <View style={{ alignSelf: 'flex-start' }}>
                        <BoutonConfirme theme={theme} titre={tr('resumes.retirer')} confirmation={tr('planning.disponibilites.oui_retirer')} onConfirme={() => changer(() => api.supprimerCommentaire(teamId, r.id, c.id))} testID={`esport-ressource-commentaire-${c.id}-supprimer`} />
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>
              <Champ theme={theme} libelle={tr('ressources.ajouter_commentaire')} valeur={commentaire} onChanger={setCommentaire} multiligne maxLength={2000} testID="esport-ressource-commentaire" />
              <View style={{ alignSelf: 'flex-start' }}>
                <BoutonHub
                  theme={theme}
                  titre={tr('ressources.commenter')}
                  variante="plein"
                  desactive={Boolean(enCours) || !commentaire.trim()}
                  onPress={() =>
                    void agir('commentaire', async () => {
                      setR(await api.commenter(teamId, r.id, commentaire));
                      setCommentaire('');
                      onChange();
                    })
                  }
                  testID="esport-ressource-commenter"
                />
              </View>
            </View>
          ) : null}

          {r.moi.valider ? (
            <Panneau theme={theme} testID="esport-ressource-validation">
              <Text style={{ ...texte(theme), fontWeight: '700' }}>{tr('ressources.a_valider')}</Text>
              <Champ theme={theme} libelle={tr('ressources.motif_facultatif')} valeur={motif} onChanger={setMotif} maxLength={300} testID="esport-ressource-motif" />
              <View style={styles.ligne}>
                <BoutonHub theme={theme} titre={tr('demandesCompte.valider')} variante="plein" onPress={() => changer(() => api.valider(teamId, r.id), tr('ressources.validee'))} testID="esport-ressource-valider" />
                <BoutonHub theme={theme} titre={tr('ressources.refuser')} variante="danger" onPress={() => changer(() => api.refuser(teamId, r.id, motif.trim()), tr('ressources.refusee'))} testID="esport-ressource-refuser" />
              </View>
            </Panneau>
          ) : null}
          <View style={styles.ligne}>
            {r.moi.modifier ? <BoutonHub theme={theme} titre={tr('ressources.modifier')} onPress={() => onModifier(r)} testID="esport-ressource-modifier" /> : null}
            {r.moi.epingler && r.statut === 'publiee' ? <BoutonHub theme={theme} titre={r.epingle ? tr('ressources.desepingler') : tr('ressources.epingler')} onPress={() => changer(() => api.modifier(teamId, r.id, { epingle: !r.epingle }))} testID="esport-ressource-epingler" /> : null}
            {r.moi.supprimer ? (
              <BoutonConfirme
                theme={theme}
                titre={tr('ressources.supprimer')}
                confirmation={tr('ressources.oui_supprimer')}
                onConfirme={() =>
                  void agir('suppression', async () => {
                    await api.supprimer(teamId, r.id);
                    onChange();
                    onFermer();
                  })
                }
                testID="esport-ressource-supprimer"
              />
            ) : null}
          </View>
        </View>
      )}
    </Volet>
  );
}

// ------------------------------------------------------------------ Formulaire

function FormulaireRessource({
  theme,
  client,
  api,
  teamId,
  large,
  categories,
  droits,
  existante,
  onFermer,
  onEnregistree,
}: {
  theme: ThemeHub;
  client: PropsModule['client'];
  api: ApiRessources;
  teamId: string;
  large: boolean;
  categories: CategorieRessource[];
  droits: { staff: boolean; poster: boolean; gerer: boolean };
  existante?: DetailRessource;
  onFermer(): void;
  onEnregistree(r: DetailRessource, message?: string): void;
}) {
  // Maps et personnages du profil de jeu de la team.
  const assets = useAssetsTeam(client, teamId);
  const [genre, setGenre] = useState<GenreRessource>(existante?.genre ?? 'lien');
  const [url, setUrl] = useState(existante?.url ?? '');
  const [apercu, setApercu] = useState<ApercuLien | null | undefined>(existante?.apercu ?? undefined);
  const [titre, setTitre] = useState(existante?.titre ?? '');
  const [description, setDescription] = useState(existante?.description ?? '');
  const [categorieId, setCategorieId] = useState<string>(existante?.categorie?.id ?? categories.find(c => c.cleDefaut === 'divers')?.id ?? categories[0]?.id ?? '');
  const [tags, setTags] = useState((existante?.tags ?? []).join(', '));
  const [carte, setCarte] = useState(existante?.carte?.cle ?? '');
  const [agent, setAgent] = useState(existante?.agent?.cle ?? '');
  const [niveau, setNiveau] = useState<NiveauRessource | ''>(existante?.niveau ?? '');
  const [visibilite, setVisibilite] = useState<VisibiliteRessource>(existante?.visibilite ?? 'team');
  const [fichier, setFichier] = useState<FichierNavigateur | undefined>();
  const envoi = useEnvoi();
  const { enCours, erreur, avis, agir } = useAgir();
  const cartes = cartesDuPool(assets, existante?.carte?.cle);
  const agents = agentsActifs(assets);
  const youtube = genre === 'youtube' || (genre === 'lien' && extraireYoutube(url));
  const genres = GENRES_RESSOURCE.filter(g => g !== 'fichier' || choixFichierDisponible || existante?.genre === 'fichier');

  const corps = (): SaisieRessource => {
    const c = cartes.find(x => x.cle === carte) ?? (existante?.carte?.cle === carte ? existante.carte : undefined);
    const a = agents.find(x => x.cle === agent) ?? (existante?.agent?.cle === agent ? existante.agent : undefined);
    return {
      titre: titre.trim(),
      description,
      categorieId: categorieId || null,
      tags: lireTags(tags),
      carte: c ? { cle: c.cle, nom: c.nom } : null,
      agent: a ? { cle: a.cle, nom: a.nom } : null,
      niveau: niveau || null,
      ...(droits.staff ? { visibilite } : {}),
      ...(genre === 'lien' || genre === 'youtube' ? { url: url.trim() } : {}),
    };
  };

  const enregistrer = () =>
    void agir('enregistrer', async () => {
      if (existante) {
        const r = await api.modifier(teamId, existante.id, corps());
        onEnregistree(r, tr('ressources.enregistree'));
        return;
      }
      let envoiId: string | undefined;
      let oublier: (() => void) | undefined;
      if (genre === 'fichier') {
        if (!fichier) return;
        const fait = await envoi.lancer({ client, teamId, section: 'ressources', fichier });
        envoiId = fait.etat.id;
        oublier = fait.oublier;
      }
      const r = await api.creer(teamId, { ...corps(), genre, ...(envoiId ? { envoi: envoiId } : {}) });
      oublier?.();
      onEnregistree(r, r.statut === 'proposee' ? tr('ressources.proposee_envoyee') : tr('ressources.publiee'));
    });

  const titreRequis = genre === 'note' || (genre === 'fichier' && !fichier);
  const pret = !enCours && !envoi.enCours && (genre === 'fichier' ? Boolean(fichier) || Boolean(existante) : genre === 'note' ? description.trim().length > 0 && titre.trim().length >= 2 : url.trim().length > 0) && (!titreRequis || titre.trim().length >= 2 || genre === 'fichier');

  return (
    <Volet theme={theme} visible titre={existante ? tr('ressources.modifier_titre') : droits.poster ? tr('ressources.nouvelle') : tr('ressources.proposer')} onFermer={onFermer} testID="esport-ressource-form" largeur={large ? 640 : 560}>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-ressource-form" />
      {!droits.poster && !existante ? <Text style={attenue(theme, TYPO.texte)}>{tr('ressources.proposition_explication')}</Text> : null}
      {!existante ? <Choix<GenreRessource> theme={theme} libelle={tr('resumes.type')} valeur={genre} options={genres.map(g => ({ id: g, nom: nomGenre(g) }))} onChoisir={setGenre} testID="esport-ressource-genre" /> : null}
      {genre === 'lien' || genre === 'youtube' ? (
        <View style={{ gap: ESP.xs }}>
          <Champ theme={theme} libelle={genre === 'youtube' ? tr('ressources.adresse_youtube') : tr('ressources.adresse')} valeur={url} onChanger={v => {
              setUrl(v);
              setApercu(undefined);
            }} placeholder="https://" maxLength={2048} testID="esport-ressource-url" />
          {genre === 'lien' && !youtube ? (
            <View style={{ alignSelf: 'flex-start' }}>
              <BoutonHub
                theme={theme}
                titre={tr('ressources.recuperer_apercu')}
                desactive={!url.trim() || Boolean(enCours)}
                onPress={() =>
                  void agir('apercu', async () => {
                    const a = await api.apercu(teamId, url.trim());
                    setApercu(a);
                    if (!titre.trim() && a.titre) setTitre(a.titre.slice(0, 120));
                  })
                }
                testID="esport-ressource-apercu-recuperer"
              />
            </View>
          ) : null}
          {youtube ? <Text style={attenue(theme)} testID="esport-ressource-youtube-reconnue">{extraireYoutube(url) ? tr('ressources.youtube_reconnue', { id: extraireYoutube(url)?.id ?? '' }) : tr('ressources.youtube_non_reconnue')}</Text> : null}
          {apercu && genre === 'lien' ? <CarteApercu theme={theme} apercu={apercu} url={null} testID="esport-ressource-apercu-carte" /> : null}
        </View>
      ) : null}
      {genre === 'fichier' && !existante ? (
        <View style={{ gap: ESP.xs }}>
          <View style={styles.ligne}>
            <BoutonHub
              theme={theme}
              titre={fichier ? tr('medias.changer_de_fichier') : tr('ressources.choisir_fichier')}
              desactive={envoi.enCours}
              onPress={() =>
                void choisirFichier(ACCEPT_RESSOURCE, 'esport-ressource-fichier-champ').then(f => {
                  if (!f) return;
                  setFichier(f);
                  envoi.effacer();
                  if (titre.trim().length < 2) setTitre(f.nom.replace(/\.[a-z0-9]{2,4}$/i, '').slice(0, 120));
                })
              }
              testID="esport-ressource-fichier-choisir"
            />
            {fichier ? <InfosFichier theme={theme} nom={fichier.nom} taille={fichier.taille} testID="esport-ressource-fichier-choisi" /> : null}
          </View>
          <Text style={attenue(theme)}>{tr('ressources.formats_fichier')}</Text>
          <BarreEnvoi theme={theme} progression={envoi.progression} enCours={envoi.enCours} onAnnuler={envoi.annuler} testID="esport-ressource-envoi" />
        </View>
      ) : null}
      <Champ theme={theme} libelle={genre === 'lien' ? tr('ressources.titre_facultatif') : tr('objectifs.titre')} valeur={titre} onChanger={setTitre} maxLength={120} testID="esport-ressource-titre" />
      <ChampNote theme={theme} libelle={genre === 'note' ? tr('ressources.texte_note') : tr('ressources.description')} valeur={description} onChanger={setDescription} maxLength={8000} testID="esport-ressource-description" apercu="bouton" />
      {categories.length ? <Choix theme={theme} libelle={tr('ressources.categorie')} valeur={categorieId} options={categories.map(c => ({ id: c.id, nom: nomCategorie(c) }))} onChoisir={setCategorieId} testID="esport-ressource-categorie" /> : null}
      <Champ theme={theme} libelle={tr('strats.playbook.tags_separes_par_des')} valeur={tags} onChanger={setTags} maxLength={200} testID="esport-ressource-tags" />
      <Pliable theme={theme} titre={tr('ressources.precisions')} resume={[cartes.find(c => c.cle === carte)?.nom ?? existante?.carte?.nom, agents.find(a => a.cle === agent)?.nom ?? existante?.agent?.nom, niveau ? nomNiveau(niveau) : ''].filter(Boolean).join(' · ') || tr('planning.planning.filtre_aucun')} testID="esport-ressource-precisions">
        <Choix theme={theme} libelle={tr('ressources.niveau')} valeur={niveau} options={[{ id: '', nom: tr('ressources.tous_niveaux') }, ...NIVEAUX_RESSOURCE.map(n => ({ id: n, nom: nomNiveau(n) }))]} onChoisir={v => setNiveau(v as NiveauRessource | '')} testID="esport-ressource-niveau" />
        <Choix theme={theme} libelle={tr('strats.editeur.carte')} valeur={carte} options={[{ id: '', nom: tr('journal.toutes') }, ...cartes.map(c => ({ id: c.cle, nom: c.nom }))]} onChoisir={setCarte} testID="esport-ressource-carte" />
        <Choix theme={theme} libelle={tr('ressources.agent')} valeur={agent} options={[{ id: '', nom: tr('journal.tous') }, ...agents.map(a => ({ id: a.cle, nom: a.nom }))]} onChoisir={setAgent} testID="esport-ressource-agent" />
      </Pliable>
      {droits.staff ? (
        <Segments<VisibiliteRessource> theme={theme} libelle={tr('resumes.visibilite')} valeur={visibilite} options={[['team', tr('ressources.visibilite.team')], ['staff', tr('ressources.visibilite.staff')]]} onChoisir={setVisibilite} testID="esport-ressource-visibilite" />
      ) : null}
      <BoutonHub
        theme={theme}
        titre={envoi.enCours ? tr('medias.envoi.envoi_en_cours') : existante ? tr('discord.enregistrer') : droits.poster ? tr('ressources.publier') : tr('ressources.envoyer_proposition')}
        variante="plein"
        desactive={!pret}
        onPress={enregistrer}
        testID="esport-ressource-publier"
      />
    </Volet>
  );
}

// ------------------------------------------------------------------ Catégories

function GestionCategories({ theme, api, teamId, categories, onFermer, onChange }: { theme: ThemeHub; api: ApiRessources; teamId: string; categories: CategorieRessource[]; onFermer(): void; onChange(): void }) {
  const [liste, setListe] = useState(categories);
  const [noms, setNoms] = useState<Record<string, string>>(() => Object.fromEntries(categories.map(c => [c.id, nomCategorie(c)])));
  const [nouvelle, setNouvelle] = useState('');
  const { enCours, erreur, avis, agir } = useAgir();
  const appliquer = (l: CategorieRessource[]) => {
    setListe(l);
    setNoms(Object.fromEntries(l.map(c => [c.id, nomCategorie(c)])));
    onChange();
  };
  const deplacer = (i: number, d: -1 | 1) =>
    void agir('ordre', async () => {
      const ids = liste.map(c => c.id);
      [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
      appliquer((await api.ordonnerCategories(teamId, ids)).categories);
    });
  return (
    <Volet theme={theme} visible titre={tr('ressources.gerer_categories')} onFermer={onFermer} testID="esport-ressources-categories-volet">
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-categories" />
      <Text style={attenue(theme, TYPO.texte)}>{tr('ressources.categories_explication')}</Text>
      {liste.map((c, i) => (
        <View key={c.id} style={{ gap: ESP.xxs, paddingBottom: ESP.s, borderBottomWidth: 1, borderBottomColor: theme.ligne }} testID={`esport-categorie-${c.id}`}>
          <Champ theme={theme} libelle={tr('ressources.nom_categorie', { n: i + 1 })} valeur={noms[c.id] ?? ''} onChanger={v => setNoms(n => ({ ...n, [c.id]: v }))} maxLength={40} testID={`esport-categorie-${c.id}-nom`} />
          <View style={styles.ligne}>
            <BoutonHub
              theme={theme}
              titre={tr('ressources.renommer')}
              desactive={Boolean(enCours) || (noms[c.id] ?? '').trim().length < 2 || noms[c.id] === nomCategorie(c)}
              onPress={() =>
                void agir('renommer', async () => {
                  const maj = await api.renommerCategorie(teamId, c.id, (noms[c.id] ?? '').trim());
                  appliquer(liste.map(x => (x.id === c.id ? maj : x)));
                  return tr('ressources.categorie_renommee');
                })
              }
              testID={`esport-categorie-${c.id}-renommer`}
            />
            <BoutonHub theme={theme} titre="↑" libelle={tr('ressources.monter')} desactive={i === 0 || Boolean(enCours)} onPress={() => deplacer(i, -1)} testID={`esport-categorie-${c.id}-monter`} />
            <BoutonHub theme={theme} titre="↓" libelle={tr('ressources.descendre')} desactive={i === liste.length - 1 || Boolean(enCours)} onPress={() => deplacer(i, 1)} testID={`esport-categorie-${c.id}-descendre`} />
            <BoutonConfirme
              theme={theme}
              titre={tr('ressources.supprimer')}
              confirmation={tr('ressources.oui_supprimer_categorie')}
              onConfirme={() =>
                void agir('suppression', async () => {
                  appliquer((await api.supprimerCategorie(teamId, c.id)).categories);
                  return tr('ressources.categorie_supprimee');
                })
              }
              testID={`esport-categorie-${c.id}-supprimer`}
            />
          </View>
        </View>
      ))}
      <Champ theme={theme} libelle={tr('ressources.nouvelle_categorie')} valeur={nouvelle} onChanger={setNouvelle} maxLength={40} testID="esport-categorie-nouvelle" />
      <View style={{ alignSelf: 'flex-start' }}>
        <BoutonHub
          theme={theme}
          titre={tr('ressources.ajouter_categorie')}
          variante="plein"
          desactive={Boolean(enCours) || nouvelle.trim().length < 2}
          onPress={() =>
            void agir('creer', async () => {
              const c = await api.creerCategorie(teamId, nouvelle.trim());
              setNouvelle('');
              appliquer([...liste, c]);
              return tr('ressources.categorie_creee');
            })
          }
          testID="esport-categorie-ajouter"
        />
      </View>
    </Volet>
  );
}

// ------------------------------------------------------------------ Réglages

function ReglagesVolet({ theme, api, teamId, onFermer, onChange }: { theme: ThemeHub; api: ApiRessources; teamId: string; onFermer(): void; onChange(): void }) {
  const [reglages, setReglages] = useState<ReglagesRessources | undefined>();
  const [salon, setSalon] = useState('');
  const [webhook, setWebhook] = useState('');
  const { enCours, erreur, avis, agir } = useAgir();
  useEffect(() => {
    void agir('', async () => {
      const r = await api.reglages(teamId);
      setReglages(r);
      setSalon(r.discord?.salonId ?? '');
    });
  }, [agir, api, teamId]);
  const changer = (corps: Parameters<ApiRessources['changerReglages']>[1], message: string) =>
    void agir('reglages', async () => {
      setReglages(await api.changerReglages(teamId, corps));
      onChange();
      return message;
    });
  return (
    <Volet theme={theme} visible titre={tr('ressources.reglages')} onFermer={onFermer} testID="esport-ressources-reglages-volet">
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-ressources-reglages" />
      {reglages ? (
        <View style={{ gap: ESP.m }}>
          <Panneau theme={theme}>
            <Text style={{ ...texte(theme), fontWeight: '700' }}>{tr('ressources.propositions_titre')}</Text>
            <Text style={attenue(theme, TYPO.texte)}>{tr('ressources.propositions_explication')}</Text>
            <Segments<'oui' | 'non'> theme={theme} libelle={tr('ressources.propositions_titre')} valeur={reglages.propositions ? 'oui' : 'non'} options={[['non', tr('ressources.propositions_non')], ['oui', tr('ressources.propositions_oui')]]} onChoisir={v => changer({ propositions: v === 'oui' }, tr('ressources.reglages_enregistres'))} testID="esport-ressources-propositions" />
          </Panneau>
          {reglages.discord ? (
            <Panneau theme={theme} testID="esport-ressources-discord">
              <Text style={{ ...texte(theme), fontWeight: '700' }}>{tr('ressources.discord_titre')}</Text>
              <Text style={attenue(theme, TYPO.texte)}>{tr('ressources.discord_explication')}</Text>
              <Champ theme={theme} libelle={tr('ressources.discord_salon')} valeur={salon} onChanger={setSalon} maxLength={25} placeholder="123456789012345678" testID="esport-ressources-discord-salon" />
              <View style={{ alignSelf: 'flex-start' }}>
                <BoutonHub theme={theme} titre={tr('discord.enregistrer')} desactive={Boolean(enCours)} onPress={() => changer({ discord: { salonId: salon.trim() || null } }, tr('ressources.reglages_enregistres'))} testID="esport-ressources-discord-salon-enregistrer" />
              </View>
              <Text style={attenue(theme)}>{reglages.discord.webhook.configure ? tr('ressources.discord_webhook_actuel', { masque: reglages.discord.webhook.masque ?? '' }) : tr('ressources.discord_webhook_aucun')}</Text>
              <Champ theme={theme} libelle={tr('ressources.discord_webhook')} valeur={webhook} onChanger={setWebhook} secret maxLength={400} placeholder="https://discord.com/api/webhooks/…" testID="esport-ressources-discord-webhook" />
              <View style={styles.ligne}>
                <BoutonHub
                  theme={theme}
                  titre={tr('discord.enregistrer')}
                  desactive={Boolean(enCours) || !webhook.trim()}
                  onPress={() => {
                    changer({ discord: { webhook: webhook.trim() } }, tr('ressources.reglages_enregistres'));
                    setWebhook('');
                  }}
                  testID="esport-ressources-discord-webhook-enregistrer"
                />
                {reglages.discord.webhook.configure ? <BoutonHub theme={theme} titre={tr('ressources.discord_webhook_retirer')} variante="danger" onPress={() => changer({ discord: { webhook: null } }, tr('ressources.reglages_enregistres'))} testID="esport-ressources-discord-webhook-retirer" /> : null}
              </View>
            </Panneau>
          ) : null}
        </View>
      ) : null}
    </Volet>
  );
}
