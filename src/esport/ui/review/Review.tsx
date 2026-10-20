/**
 * Module « Review vidéo » de l'Esport (phase 5) : reviews à partir d'une
 * adresse YouTube, lecteur (API IFrame sur le site et l'app PC ; sur l'app iOS
 * native, liste des repères en lecture seule qui ouvre YouTube au bon instant),
 * timeline colorée par catégorie, repères ajoutés au temps courant (touche M),
 * fil de commentaires par repère, filtres, liste synchronisée avec la lecture,
 * export Markdown et PDF (impression).
 *
 * v2 : réactions 👍 / 👎 sur les repères et leurs commentaires (tri « plus
 * likés / dislikés »), barre de mise en forme des notes (gras, italique,
 * liste, lien ; Ctrl/Cmd+B et Ctrl/Cmd+I), et DESSIN SUR LA VIDÉO : un calque
 * transparent posé par-dessus le lecteur (site, app PC, iPad dans le
 * navigateur), rattaché au repère du timestamp courant, réaffiché pendant la
 * lecture. Sur l'app iOS native (sans lecteur intégré), le dessin est signalé.
 *
 * Droits (vérifiés par le serveur) : video_review.view|create|annotate|delete|react.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { BoutonHub, Champ, Segments } from '../../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { dateCourte } from '../../libelles';
import { apiReview, type ApiReview, type CategorieRepere, type DetailReview, type Repere, type SaisieRepere, type ValeurReaction } from '../../review/api';
import {
  COULEURS_DESSIN,
  ajouterForme,
  annulerDessin,
  dessinDe,
  dessinsAAfficher,
  gommerForme,
  historiqueDessin,
  repereDuDessin,
  retablirDessin,
  type HistoriqueDessin,
  type OutilDessin,
} from '../../review/dessin';
import { CATEGORIES, trisReperes, categorie, formatTemps, repereActif, trierReperes, type TriReperes } from '../../review/libelles';
import { extraireYoutube, lienYoutubeA, miniatureYoutube } from '../../review/youtube';
import { BoutonConfirme, Choix, Retours, TitreSection, styles, useAgir, Intertitre, Panneau } from '../commun';
import type { PropsModule } from '../modules';
import { ChampNote } from '../ChampNote';
import { BarreDessin } from './BarreDessin';
import { ApercuDessin, EditeurDessin, dessinDisponible } from './dessinVideo';
import { FormulaireRepere, type InitialRepere } from './FormulaireRepere';
import { Lecteur, VITESSES, lecteurIntegre } from './Lecteur';
import { NoteMarkdown as Note } from './Note';
import { BoutonsReaction } from './Reactions';
import { Timeline } from './Timeline';
import type { CommandeLecteur, EtatLecteur } from './typesLecteur';
import { imprimerNotes, impressionDisponible } from './impression';
import { TOUCHE_RACCOURCI, useRaccourciRepere } from './raccourci';
import { tr, trn } from '../../i18n';

export function Review({ theme, client, detail, large, reviewId, onExporter }: PropsModule) {
  const teamId = detail.team.id;
  const api = useMemo(() => apiReview(client, teamId), [client, teamId]);
  const [ouverte, setOuverte] = useState<{ id: string; depart?: number } | undefined>(reviewId ? { id: reviewId } : undefined);
  const [message, setMessage] = useState<string | undefined>();
  if (ouverte) {
    return (
      <DetailReviewEcran
        key={ouverte.id}
        theme={theme}
        api={api}
        id={ouverte.id}
        depart={ouverte.depart}
        large={large}
        onRetour={m => {
          setMessage(m);
          setOuverte(undefined);
        }}
        onExporter={onExporter}
      />
    );
  }
  return <ListeReviews theme={theme} api={api} message={message} onOuvrir={(id, depart) => setOuverte({ id, depart })} />;
}

// ---------------------------------------------------------------- Liste

function ListeReviews({ theme, api, message, onOuvrir }: { theme: ThemeHub; api: ApiReview; message?: string; onOuvrir(id: string, depart?: number): void }) {
  const [liste, setListe] = useState<Awaited<ReturnType<ApiReview['liste']>> | undefined>();
  const [url, setUrl] = useState('');
  const [titre, setTitre] = useState('');
  const [reference, setReference] = useState('');
  const { erreur, avis, agir } = useAgir();
  const recharger = useCallback(async () => setListe(await api.liste()), [api]);
  useEffect(() => {
    void agir('', recharger);
  }, [agir, recharger]);

  const id = extraireYoutube(url);
  const creer = () =>
    void agir('creation', async () => {
      const r = await api.creer({ titre, url, reference });
      onOuvrir(r.id, r.depart ?? undefined);
    });

  return (
    <View style={{ gap: 16 }} testID="esport-review">
      <TitreSection theme={theme} titre={tr('review.review.review_video')} sous={tr('review.review.analysez_vos_matchs_et')} />
      <Retours theme={theme} erreur={erreur} avis={avis ?? message} prefixe="esport-review" />
      {liste?.droits.creer ? (
        <Panneau theme={theme} testID="esport-review-nouvelle">
          <Intertitre theme={theme}>{tr('review.review.nouvelle_review')}</Intertitre>
          <Champ theme={theme} libelle={tr('review.review.adresse_youtube_watch_youtu')} valeur={url} onChanger={setUrl} testID="esport-review-url" placeholder="https://www.youtube.com/watch?v=…" />
          {url.trim() ? (
            <Text testID="esport-review-url-etat" style={{ color: id ? theme.ok : theme.critique, fontSize: 13, ...police(theme.policeTexte) }}>
              {id ? tr('review.review.video_reconnue', { id: id.id }) : tr('review.review.adresse_youtube_non_reconnue')}
            </Text>
          ) : null}
          <Champ theme={theme} libelle={tr('objectifs.titre')} valeur={titre} onChanger={setTitre} testID="esport-review-titre" maxLength={120} placeholder={tr('review.review.faucons_vs_nova_ascent')} />
          <Champ theme={theme} libelle={tr('review.review.match_ou_scrim_concerne')} valeur={reference} onChanger={setReference} testID="esport-review-reference" maxLength={120} />
          <BoutonHub theme={theme} titre={tr('review.review.creer_la_review')} variante="plein" onPress={creer} desactive={!id || titre.trim().length < 2} testID="esport-review-creer" />
        </Panneau>
      ) : null}
      <View style={{ gap: 8 }} testID="esport-review-liste">
        {liste && liste.reviews.length === 0 ? <Text style={{ color: theme.attenue, ...police(theme.policeTexte) }}>{tr('review.review.aucune_review_pour_l')}</Text> : null}
        {liste?.reviews.map(r => (
          <Pressable
            key={r.id}
            testID={`esport-review-${r.id}`}
            accessibilityRole="button"
            accessibilityLabel={tr('review.review.ouvrir_la_review', { titre: r.titre })}
            onPress={() => onOuvrir(r.id)}
            style={{ flexDirection: 'row', gap: 12, padding: 10, borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.surface, borderRadius: theme.rayonMoyen, alignItems: 'center' }}>
            <Image source={{ uri: miniatureYoutube(r.videoId) }} accessibilityLabel="" style={{ width: 120, height: 68, borderRadius: 6, backgroundColor: theme.fond }} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: theme.texte, fontWeight: '700', fontSize: 15, ...police(theme.policeTexte) }} numberOfLines={2}>
                {r.titre}
              </Text>
              {r.reference ? <Text style={{ color: theme.attenue, fontSize: 13 }}>{r.reference}</Text> : null}
              <Text style={{ color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) }}>
                {tr('review.review.liste_reperes', { reperes: trn('review.review.reperes', r.reperes), nom: r.creePar?.pseudo ?? tr('resumes.un_compte_supprime'), date: dateCourte(r.creeLe) })}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- Détail

interface Filtres {
  categories: CategorieRepere[];
  joueur: string;
  auteur: string;
}

function DetailReviewEcran({
  theme,
  api,
  id,
  depart,
  large,
  onRetour,
  onExporter,
}: {
  theme: ThemeHub;
  api: ApiReview;
  id: string;
  depart?: number;
  large: boolean;
  onRetour(message?: string): void;
  onExporter?: PropsModule['onExporter'];
}) {
  const [data, setData] = useState<DetailReview | undefined>();
  const commande = useRef<CommandeLecteur | undefined>(undefined);
  const [pret, setPret] = useState(false);
  const [temps, setTemps] = useState(depart ?? 0);
  const [duree, setDuree] = useState(0);
  const [vitesse, setVitesse] = useState(1);
  const [filtres, setFiltres] = useState<Filtres>({ categories: [], joueur: '', auteur: '' });
  const [selection, setSelection] = useState<string | undefined>();
  const [formulaire, setFormulaire] = useState<{ edition?: Repere; initial: InitialRepere } | undefined>();
  const [tri, setTri] = useState<TriReperes>('instant');
  const [etatLecteur, setEtatLecteur] = useState<EtatLecteur>('chargement');
  // Dessin sur la vidéo : mode édition (instant, repère rattaché, historique), outils, affichage.
  const [dessin, setDessin] = useState<{ instant: number; repere?: Repere; histo: HistoriqueDessin } | undefined>();
  const [outil, setOutil] = useState<OutilDessin>('fleche');
  const [couleur, setCouleur] = useState(COULEURS_DESSIN[0].cle);
  const [epaisseur, setEpaisseur] = useState(4);
  const [texteDessin, setTexteDessin] = useState('');
  const [voirDessins, setVoirDessins] = useState(true);
  const { enCours, erreur, avis, agir } = useAgir();

  const recharger = useCallback(async () => setData(await api.detail(id)), [api, id]);
  useEffect(() => {
    void agir('', recharger);
  }, [agir, recharger]);

  const surPret = useCallback((c: CommandeLecteur | undefined) => {
    commande.current = c;
    setPret(Boolean(c));
  }, []);

  // Le lecteur YouTube n'émet pas d'événement de temps : on l'interroge 4 fois par seconde.
  useEffect(() => {
    if (!pret || !lecteurIntegre) return undefined;
    const minuterie = setInterval(() => {
      const c = commande.current;
      if (!c) return;
      const t = c.temps();
      setTemps(avant => (Math.abs(avant - t) >= 0.1 ? t : avant));
      const d = c.duree();
      if (d > 0) setDuree(avant => (avant === d ? avant : d));
    }, 250);
    return () => clearInterval(minuterie);
  }, [pret]);

  const reperes = useMemo(() => data?.reperes ?? [], [data]);
  const visibles = useMemo(
    () =>
      reperes.filter(
        r => (filtres.categories.length === 0 || filtres.categories.includes(r.categorie)) && (!filtres.joueur || r.cible?.compte === filtres.joueur) && (!filtres.auteur || r.auteur?.compte === filtres.auteur),
      ),
    [reperes, filtres],
  );
  const ordonnes = useMemo(() => trierReperes(visibles, tri), [visibles, tri]);
  const total = duree > 0 ? duree : Math.max(60, ...reperes.map(r => (r.fin ?? r.debut) + 30));
  const actif = lecteurIntegre && pret ? repereActif(visibles, temps) : undefined;
  const enPause = etatLecteur !== 'lecture';
  const affiches = lecteurIntegre && pret && voirDessins && !dessin ? dessinsAAfficher(reperes, temps, enPause) : [];
  const avecDessin = reperes.some(r => r.dessin?.objets.length);

  // Liste latérale synchronisée avec la lecture : le repère en cours est visible.
  const liste = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const positions = useRef<Record<string, number>>({});
  const actifId = actif?.id;
  useEffect(() => {
    if (actifId && positions.current[actifId] !== undefined) liste.current?.scrollTo({ y: Math.max(0, positions.current[actifId] - 8), animated: true });
  }, [actifId]);

  const aller = useCallback((s: number) => {
    commande.current?.aller(s);
    setTemps(s);
  }, []);

  const ouvrirAjout = useCallback(() => {
    if (!lecteurIntegre) return;
    const t = commande.current?.temps() ?? 0;
    commande.current?.pause();
    setFormulaire({ initial: { debut: t } });
  }, []);
  useRaccourciRepere(Boolean(data?.droits.annoter) && lecteurIntegre && !formulaire && !dessin, ouvrirAjout);

  /** « Dessiner » : la vidéo se met en pause, le calque s'active au temps courant. */
  const ouvrirDessin = useCallback(() => {
    const c = commande.current;
    if (!c) return;
    c.pause();
    const t = Math.round(c.temps() * 10) / 10;
    setTemps(t);
    setFormulaire(undefined);
    const repere = repereDuDessin(data?.reperes ?? [], t);
    setDessin({ instant: t, repere, histo: historiqueDessin(repere?.dessin?.objets ?? []) });
  }, [data]);

  if (!data) {
    return (
      <View testID="esport-review-detail" style={{ gap: 12 }}>
        <Retours theme={theme} erreur={erreur} prefixe="esport-review" />
        {!erreur ? <Text style={{ color: theme.attenue }}>{tr('review.review.chargement_de_la_review')}</Text> : null}
        <BoutonHub theme={theme} titre={tr('review.review.reviews')} onPress={() => onRetour()} testID="esport-review-retour" />
      </View>
    );
  }

  const joueurs = [...new Map(reperes.filter(r => r.cible).map(r => [r.cible!.compte, r.cible!.pseudo ?? '?'])).entries()];
  const auteurs = [...new Map(reperes.filter(r => r.auteur).map(r => [r.auteur!.compte, r.auteur!.pseudo ?? '?'])).entries()];
  const filtre = filtres.categories.length > 0 || filtres.joueur !== '' || filtres.auteur !== '';

  const enregistrer = (s: SaisieRepere) =>
    void agir('repere', async () => {
      if (formulaire?.edition) await api.modifierRepere(id, formulaire.edition.id, s);
      else await api.ajouterRepere(id, s);
      const edition = Boolean(formulaire?.edition);
      setFormulaire(undefined);
      await recharger();
      return edition ? tr('review.review.repere_modifie') : tr('review.review.repere_ajoute');
    });
  const supprimer = (r: Repere) =>
    void agir('repere', async () => {
      await api.supprimerRepere(id, r.id);
      await recharger();
      return tr('review.review.repere_supprime');
    });
  const commenter = async (r: Repere, texte: string) =>
    agir('commentaire', async () => {
      await api.commenter(id, r.id, texte);
      await recharger();
    });
  const supprimerCommentaire = (r: Repere, commentaireId: string) =>
    void agir('commentaire', async () => {
      await api.supprimerCommentaire(id, r.id, commentaireId);
      await recharger();
      return tr('review.review.commentaire_supprime');
    });

  const reagir = (r: Repere, valeur: ValeurReaction | null, commentaireId?: string) =>
    void agir('', async () => {
      const maj = commentaireId ? await api.reagirCommentaire(id, r.id, commentaireId, valeur) : await api.reagir(id, r.id, valeur);
      setData(d => (d ? { ...d, reperes: d.reperes.map(x => (x.id === maj.id ? maj : x)) } : d));
    });

  const enregistrerDessin = () =>
    void agir('dessin', async () => {
      if (!dessin) return;
      const contenu = dessinDe(dessin.histo.present);
      if (dessin.repere) await api.modifierRepere(id, dessin.repere.id, { dessin: contenu });
      else if (contenu) await api.ajouterRepere(id, { debut: dessin.instant, categorie: 'placement', titre: tr('review.review.dessin_2', { v: formatTemps(dessin.instant) }), dessin: contenu });
      setDessin(undefined);
      await recharger();
      return contenu ? tr('review.review.dessin_enregistre_il_s') : dessin.repere ? tr('review.review.dessin_retire') : undefined;
    });

  const exporterMarkdown = () =>
    void agir('export', async () => {
      const f = await api.exporter(id);
      if (!onExporter) return tr('review.review.l_export_de_fichier');
      const ok = await onExporter(f.nom, f.contenu, 'text/markdown');
      return ok ? tr('review.review.notes_exportees_en_markdown') : undefined;
    });
  const exporterPdf = () =>
    void agir('export', async () => {
      const f = await api.exporter(id);
      const ok = await imprimerNotes(data.review.titre, f.contenu);
      return ok ? tr('review.review.boite_d_impression_ouverte') : tr('review.review.l_impression_n_est');
    });

  const colLecteur = (
    <View style={{ gap: 12, flex: large ? 3 : undefined, minWidth: 0 }}>
      <Lecteur
        theme={theme}
        videoId={data.review.videoId}
        depart={depart}
        large={large}
        onPret={surPret}
        onEtat={setEtatLecteur}
        calque={
          dessin ? (
            <EditeurDessin
              objets={dessin.histo.present}
              outil={outil}
              couleur={couleur}
              epaisseur={epaisseur}
              texte={texteDessin}
              onAjouter={f => setDessin(d => (d ? { ...d, histo: ajouterForme(d.histo, f) } : d))}
              onGommer={i => setDessin(d => (d ? { ...d, histo: gommerForme(d.histo, i) } : d))}
            />
          ) : (
            affiches.map(r => <ApercuDessin key={r.id} theme={theme} dessin={r.dessin} cadre="calque" testID={`esport-dessin-affiche-${r.id}`} />)
          )
        }
      />
      {dessin ? (
        <BarreDessin
          theme={theme}
          instant={dessin.instant}
          rattache={dessin.repere?.titre}
          outil={outil}
          couleur={couleur}
          epaisseur={epaisseur}
          texte={texteDessin}
          formes={dessin.histo.present.length}
          peutAnnuler={dessin.histo.passe.length > 0}
          peutRetablir={dessin.histo.futur.length > 0}
          enCours={Boolean(enCours)}
          onOutil={setOutil}
          onCouleur={setCouleur}
          onEpaisseur={setEpaisseur}
          onTexte={setTexteDessin}
          onAnnuler={() => setDessin(d => (d ? { ...d, histo: annulerDessin(d.histo) } : d))}
          onRetablir={() => setDessin(d => (d ? { ...d, histo: retablirDessin(d.histo) } : d))}
          onEnregistrer={enregistrerDessin}
          onQuitter={() => setDessin(undefined)}
        />
      ) : null}
      {lecteurIntegre ? (
        <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
          {data.droits.annoter ? (
            <View style={styles.ligne}>
              <BoutonHub theme={theme} titre={tr('review.review.repere_a', { v: formatTemps(temps), TOUCHE_RACCOURCI })} variante="plein" onPress={ouvrirAjout} desactive={!pret || Boolean(dessin)} testID="esport-review-ajouter" libelle={tr('review.review.ajouter_un_repere_au', { v: formatTemps(temps) })} />
              {dessinDisponible ? (
                <BoutonHub theme={theme} titre={tr('review.review.dessiner')} onPress={ouvrirDessin} desactive={!pret || Boolean(dessin)} testID="esport-review-dessiner" libelle={tr('review.review.dessiner_sur_la_video', { v: formatTemps(temps) })} />
              ) : null}
            </View>
          ) : null}
          {avecDessin && dessinDisponible ? (
            <BoutonHub
              theme={theme}
              titre={voirDessins ? tr('review.review.masquer_les_dessins') : tr('review.review.afficher_les_dessins')}
              onPress={() => setVoirDessins(v => !v)}
              testID="esport-dessins-bascule"
              libelle={voirDessins ? tr('review.review.masquer_les_dessins_sur') : tr('review.review.afficher_les_dessins_sur')}
            />
          ) : null}
          <Segments
            theme={theme}
            libelle={tr('review.review.vitesse')}
            valeur={String(vitesse)}
            options={VITESSES.map(v => [String(v), `${v}×`] as const)}
            onChoisir={v => {
              setVitesse(Number(v));
              commande.current?.vitesse(Number(v));
            }}
            testID="esport-review-vitesse"
          />
        </View>
      ) : null}
      {lecteurIntegre ? <Timeline theme={theme} reperes={visibles} total={total} temps={temps} actifId={actifId ?? selection} onAller={aller} onChoisir={r => setSelection(r.id)} /> : null}
      {formulaire ? (
        <FormulaireRepere
          key={formulaire.edition?.id ?? 'nouveau'}
          theme={theme}
          membres={data.membres}
          initial={formulaire.initial}
          edition={Boolean(formulaire.edition)}
          enCours={Boolean(enCours)}
          onEnregistrer={enregistrer}
          onAnnuler={() => setFormulaire(undefined)}
        />
      ) : null}
    </View>
  );

  const colListe = (
    <View style={{ gap: 12, flex: large ? 2 : undefined, minWidth: large ? 320 : 0 }}>
      <Panneau theme={theme} testID="esport-review-filtres">
        <Intertitre theme={theme}>{tr('planning.planning.filtres')}</Intertitre>
        <View style={styles.ligne} accessibilityLabel={tr('review.review.categories')}>
          {CATEGORIES.map(c => {
            const coche = filtres.categories.includes(c.cle);
            return (
              <Pressable
                key={c.cle}
                testID={`esport-filtre-cat-${c.cle}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: coche }}
                accessibilityLabel={tr('review.review.categorie', { nom: c.nom })}
                onPress={() => setFiltres(f => ({ ...f, categories: coche ? f.categories.filter(x => x !== c.cle) : [...f.categories, c.cle] }))}
                style={{
                  flexDirection: 'row',
                  gap: 6,
                  alignItems: 'center',
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  minHeight: 36,
                  borderWidth: 1,
                  borderColor: coche ? c.couleur : theme.ligne,
                  backgroundColor: coche ? teinteTransparente(c.couleur, 0.22) : theme.surface,
                  borderRadius: Math.min(theme.rayonMoyen, 10),
                }}>
                <Text style={{ color: c.couleur, fontWeight: '800' }}>{c.glyphe}</Text>
                <Text style={{ color: theme.texte, fontSize: 13, fontWeight: coche ? '700' : '500', ...police(theme.policeTexte) }}>{c.nom}</Text>
              </Pressable>
            );
          })}
        </View>
        {joueurs.length > 0 ? (
          <Choix theme={theme} libelle={tr('review.review.joueur')} valeur={filtres.joueur} options={[{ id: '', nom: tr('journal.tous') }, ...joueurs.map(([c, p]) => ({ id: c, nom: p }))]} onChoisir={v => setFiltres(f => ({ ...f, joueur: v }))} testID="esport-filtre-joueur" />
        ) : null}
        {auteurs.length > 1 ? (
          <Choix theme={theme} libelle={tr('review.review.auteur')} valeur={filtres.auteur} options={[{ id: '', nom: tr('journal.tous') }, ...auteurs.map(([c, p]) => ({ id: c, nom: p }))]} onChoisir={v => setFiltres(f => ({ ...f, auteur: v }))} testID="esport-filtre-auteur" />
        ) : null}
        <Segments<TriReperes> theme={theme} libelle={tr('review.review.trier')} valeur={tri} options={trisReperes()} onChoisir={setTri} testID="esport-review-tri" />
        <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
          <Text testID="esport-review-compte" style={{ color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) }}>
            {tr('review.review.visibles_sur', { visibles: visibles.length, reperes: trn('review.review.reperes', reperes.length) })}
          </Text>
          {filtre ? <BoutonHub theme={theme} titre={tr('review.review.effacer_les_filtres')} onPress={() => setFiltres({ categories: [], joueur: '', auteur: '' })} testID="esport-filtre-effacer" /> : null}
        </View>
      </Panneau>
      <ScrollView ref={liste} testID="esport-review-reperes" style={large ? { maxHeight: 640 } : { maxHeight: 520 }} contentContainerStyle={{ gap: 8 }} nestedScrollEnabled>
        {reperes.length === 0 ? (
          <Text style={{ color: theme.attenue, ...police(theme.policeTexte) }}>
            {lecteurIntegre && data.droits.annoter ? tr('review.review.aucun_repere_pendant_la', { TOUCHE_RACCOURCI }) : tr('review.review.aucun_repere_pour_l')}
          </Text>
        ) : null}
        {ordonnes.map(r => (
          <View
            key={r.id}
            onLayout={e => {
              positions.current[r.id] = e.nativeEvent.layout.y;
            }}>
            <CarteRepere
              theme={theme}
              repere={r}
              videoId={data.review.videoId}
              actif={r.id === actifId}
              ouvert={selection === r.id}
              droits={data.droits}
              onAller={() => {
                setSelection(r.id);
                aller(r.debut);
              }}
              onBascule={() => setSelection(s => (s === r.id ? undefined : r.id))}
              onModifier={() => setFormulaire({ edition: r, initial: { debut: r.debut, fin: r.fin, titre: r.titre, categorie: r.categorie, note: r.note, cible: r.cible?.compte ?? null } })}
              onSupprimer={() => supprimer(r)}
              onCommenter={t => commenter(r, t)}
              onSupprimerCommentaire={cid => supprimerCommentaire(r, cid)}
              onReagir={(v, cid) => reagir(r, v, cid)}
            />
          </View>
        ))}
      </ScrollView>
    </View>
  );

  return (
    <View style={{ gap: 16 }} testID="esport-review-detail">
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <View style={{ flex: 1, minWidth: 200, gap: 2 }}>
          <Text accessibilityRole="header" testID="esport-review-nom" style={{ color: theme.texte, fontSize: 22, fontWeight: '800', ...police(theme.policeTitre) }}>
            {data.review.titre}
          </Text>
          <Text style={{ color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) }}>
            {data.equipe}
            {data.review.reference ? ` · ${data.review.reference}` : ''}{tr('review.review.par_suffixe', { nom: data.review.creePar?.pseudo ?? tr('resumes.un_compte_supprime') })}
          </Text>
        </View>
        <View style={[styles.ligne, { flexShrink: 1 }]}>
          <BoutonHub theme={theme} titre={tr('review.review.exporter_en_markdown')} onPress={exporterMarkdown} testID="esport-review-export-md" />
          {impressionDisponible ? <BoutonHub theme={theme} titre={tr('review.review.exporter_en_pdf')} onPress={exporterPdf} testID="esport-review-export-pdf" /> : null}
          {data.droits.supprimer ? (
            <BoutonConfirme
              theme={theme}
              titre={tr('review.review.supprimer_la_review')}
              confirmation={tr('planning.planning.oui_supprimer')}
              onConfirme={() =>
                void agir('review', async () => {
                  await api.supprimer(id);
                  onRetour(tr('review.review.review_supprimee'));
                })
              }
              testID="esport-review-supprimer"
            />
          ) : null}
          <BoutonHub theme={theme} titre={tr('review.review.reviews')} onPress={() => onRetour()} testID="esport-review-retour" />
        </View>
      </View>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-review" />
      <View style={large ? { flexDirection: 'row', gap: 16, alignItems: 'flex-start' } : { gap: 16 }}>
        {colLecteur}
        {colListe}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- Repère

function CarteRepere({
  theme,
  repere: r,
  videoId,
  actif,
  ouvert,
  droits,
  onAller,
  onBascule,
  onModifier,
  onSupprimer,
  onCommenter,
  onSupprimerCommentaire,
  onReagir,
}: {
  theme: ThemeHub;
  repere: Repere;
  videoId: string;
  actif: boolean;
  ouvert: boolean;
  droits: DetailReview['droits'];
  onAller(): void;
  onBascule(): void;
  onModifier(): void;
  onSupprimer(): void;
  onCommenter(texte: string): Promise<boolean>;
  onSupprimerCommentaire(id: string): void;
  onReagir(valeur: ValeurReaction | null, commentaireId?: string): void;
}) {
  const c = categorie(r.categorie);
  const [texte, setTexte] = useState('');
  const meta = [c.nom, r.cible ? tr('review.review.joueur_cible', { nom: r.cible.pseudo ?? '?' }) : '', tr('review.review.par', { nom: r.auteur?.pseudo ?? tr('resumes.un_compte_supprime') }), r.fin != null ? tr('review.review.duree_s', { v: Math.round(r.fin - r.debut) }) : ''].filter(Boolean).join(' · ');
  return (
    <View
      testID={`esport-repere-${r.id}`}
      accessibilityState={{ selected: actif }}
      style={{
        borderWidth: actif ? 2 : 1,
        borderColor: actif ? c.couleur : theme.ligne,
        borderLeftWidth: 5,
        borderLeftColor: c.couleur,
        backgroundColor: actif ? teinteTransparente(c.couleur, 0.12) : theme.surface,
        borderRadius: Math.min(theme.rayonMoyen, 10),
        padding: 10,
        gap: 6,
      }}>
      <Pressable
        testID={`esport-repere-aller-${r.id}`}
        accessibilityRole="button"
        accessibilityLabel={lecteurIntegre ? tr('review.review.aller_a', { v: formatTemps(r.debut), titre: r.titre }) : tr('review.review.ouvrir_dans_youtube_a', { v: formatTemps(r.debut), titre: r.titre })}
        onPress={lecteurIntegre ? onAller : onBascule}
        style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', minHeight: 36 }}>
        <Text style={{ color: theme.texte, fontWeight: '800', minWidth: 56, ...police(theme.policeChiffres) }}>{formatTemps(r.debut)}</Text>
        <Text style={{ color: c.couleur, fontWeight: '800' }} accessibilityElementsHidden importantForAccessibility="no">
          {c.glyphe}
        </Text>
        <Text style={{ color: theme.texte, fontWeight: '700', flex: 1, ...police(theme.policeTexte) }}>{r.titre}</Text>
        {r.dessin?.objets.length ? (
          <Text testID={`esport-repere-icone-dessin-${r.id}`} accessibilityLabel={tr('review.review.ce_repere_porte_un')} style={{ fontSize: 15 }}>
            ✏️
          </Text>
        ) : null}
      </Pressable>
      <Text style={{ color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) }}>{meta}</Text>
      {actif ? (
        // Texte en couleur d'accent (contraste AA garanti dans les 8 thèmes) ; la couleur de catégorie reste sur le pictogramme.
        <Text testID={`esport-repere-actif-${r.id}`} style={{ color: theme.accent, fontSize: 12, fontWeight: '800', ...police(theme.policeTexte) }}>
          {tr('review.review.en_cours_de_lecture')}</Text>
      ) : null}
      {r.note ? <Note theme={theme} source={r.note} testID={`esport-repere-note-${r.id}`} /> : null}
      {r.dessin?.objets.length ? (
        <Pressable accessibilityRole="button" accessibilityLabel={tr('review.review.voir_le_dessin_a', { v: formatTemps(r.debut) })} onPress={lecteurIntegre ? onAller : undefined} disabled={!lecteurIntegre} style={{ alignSelf: 'flex-start' }}>
          <ApercuDessin theme={theme} dessin={r.dessin} cadre="miniature" testID={`esport-repere-miniature-${r.id}`} />
        </Pressable>
      ) : null}
      <BoutonsReaction theme={theme} reactions={r.reactions} peutReagir={Boolean(droits.reagir)} onReagir={v => onReagir(v)} testID={`esport-repere-reaction-${r.id}`} />
      <View style={styles.ligne}>
        {!lecteurIntegre ? <BoutonHub theme={theme} titre={tr('review.review.ouvrir_dans_youtube_a_2', { v: formatTemps(r.debut) })} onPress={() => void Linking.openURL(lienYoutubeA(videoId, r.debut))} testID={`esport-repere-youtube-${r.id}`} /> : null}
        <BoutonHub theme={theme} titre={tr('review.review.commentaires', { length: r.commentaires.length })} onPress={onBascule} testID={`esport-repere-commentaires-${r.id}`} />
        {lecteurIntegre && r.peutModifier ? <BoutonHub theme={theme} titre={tr('membresRoles.modifier')} onPress={onModifier} testID={`esport-repere-modifier-${r.id}`} /> : null}
        {lecteurIntegre && r.peutSupprimer ? <BoutonConfirme theme={theme} titre={tr('discord.supprimer')} confirmation={tr('planning.planning.oui_supprimer')} onConfirme={onSupprimer} testID={`esport-repere-supprimer-${r.id}`} /> : null}
      </View>
      {ouvert ? (
        <View style={{ gap: 6, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 8 }} testID={`esport-fil-${r.id}`}>
          {r.commentaires.length === 0 ? <Text style={{ color: theme.attenue, fontSize: 13 }}>{tr('review.review.pas_encore_de_commentaire')}</Text> : null}
          {r.commentaires.map(k => (
            <View key={k.id} testID={`esport-commentaire-${k.id}`} style={{ gap: 2 }}>
              <Text style={{ color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) }}>
                {k.auteur?.pseudo ?? tr('libelles.un_compte_supprime')} · {dateCourte(k.creeLe)}
              </Text>
              <Note theme={theme} source={k.texte} testID={`esport-commentaire-texte-rendu-${k.id}`} />
              <BoutonsReaction theme={theme} reactions={k.reactions} peutReagir={Boolean(droits.reagir)} onReagir={v => onReagir(v, k.id)} testID={`esport-commentaire-reaction-${k.id}`} compact />
              {k.peutSupprimer ? <BoutonConfirme theme={theme} titre={tr('discord.supprimer')} confirmation={tr('planning.planning.oui_supprimer')} onConfirme={() => onSupprimerCommentaire(k.id)} testID={`esport-commentaire-supprimer-${k.id}`} /> : null}
            </View>
          ))}
          {droits.annoter ? (
            <View style={{ gap: 6 }}>
              <ChampNote theme={theme} libelle={tr('review.review.votre_commentaire')} valeur={texte} onChanger={setTexte} testID={`esport-commentaire-texte-${r.id}`} maxLength={1000} />
              <BoutonHub
                theme={theme}
                titre={tr('review.review.commenter')}
                variante="plein"
                desactive={texte.trim() === ''}
                onPress={() =>
                  void onCommenter(texte).then(ok => {
                    if (ok) setTexte('');
                  })
                }
                testID={`esport-commentaire-envoyer-${r.id}`}
              />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

