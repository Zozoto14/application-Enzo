/**
 * Module « Review vidéo » de l'Esport (phase 5) : reviews à partir d'une
 * adresse YouTube, lecteur (API IFrame sur le site et l'app PC ; sur l'app iOS
 * native, liste des repères en lecture seule qui ouvre YouTube au bon instant),
 * timeline colorée par catégorie, repères ajoutés au temps courant (touche M),
 * fil de commentaires par repère, filtres, liste synchronisée avec la lecture,
 * export Markdown et PDF (impression).
 *
 * Droits (vérifiés par le serveur) : video_review.view|create|annotate|delete.
 * Limite connue : pas de dessin sur la vidéo, les notes sont liées à un instant.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { Avis, BoutonHub, Champ, Intertitre, Panneau, Segments } from '../../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { dateCourte } from '../../libelles';
import { apiReview, type ApiReview, type CategorieRepere, type DetailReview, type Repere, type SaisieRepere } from '../../review/api';
import { CATEGORIES, categorie, formatTemps, repereActif } from '../../review/libelles';
import { extraireYoutube, lienYoutubeA, miniatureYoutube } from '../../review/youtube';
import { BoutonConfirme, Choix, Retours, TitreSection, styles, useAgir } from '../commun';
import type { PropsModule } from '../modules';
import { FormulaireRepere, type InitialRepere } from './FormulaireRepere';
import { Lecteur, VITESSES, lecteurIntegre } from './Lecteur';
import { NoteMarkdown as Note } from './Note';
import { Timeline } from './Timeline';
import type { CommandeLecteur } from './typesLecteur';
import { imprimerNotes, impressionDisponible } from './impression';
import { TOUCHE_RACCOURCI, useRaccourciRepere } from './raccourci';

export const MENTION_LIMITE = 'Limite connue : pas de dessin sur la vidéo. Les notes sont liées à un instant de la vidéo (timestamp), pas à un endroit de l’image.';

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
    void agir('Création', async () => {
      const r = await api.creer({ titre, url, reference });
      onOuvrir(r.id, r.depart ?? undefined);
    });

  return (
    <View style={{ gap: 16 }} testID="esport-review">
      <TitreSection theme={theme} titre="Review vidéo" sous="Analysez vos matchs et scrims sur YouTube : repères horodatés, notes et commentaires." />
      <Retours theme={theme} erreur={erreur} avis={avis ?? message} prefixe="esport-review" />
      <Avis theme={theme} genre="info" texte={MENTION_LIMITE} testID="esport-review-limite" />
      {liste?.droits.creer ? (
        <Panneau theme={theme} testID="esport-review-nouvelle">
          <Intertitre theme={theme}>Nouvelle review</Intertitre>
          <Champ theme={theme} libelle="Adresse YouTube (watch, youtu.be, shorts, embed ou live)" valeur={url} onChanger={setUrl} testID="esport-review-url" placeholder="https://www.youtube.com/watch?v=…" />
          {url.trim() ? (
            <Text testID="esport-review-url-etat" style={{ color: id ? theme.ok : theme.critique, fontSize: 13, ...police(theme.policeTexte) }}>
              {id ? `Vidéo reconnue (${id.id})` : 'Adresse YouTube non reconnue.'}
            </Text>
          ) : null}
          <Champ theme={theme} libelle="Titre" valeur={titre} onChanger={setTitre} testID="esport-review-titre" maxLength={120} placeholder="Faucons vs Nova · Ascent" />
          <Champ theme={theme} libelle="Match ou scrim concerné (facultatif)" valeur={reference} onChanger={setReference} testID="esport-review-reference" maxLength={120} />
          <BoutonHub theme={theme} titre="Créer la review" variante="plein" onPress={creer} desactive={!id || titre.trim().length < 2} testID="esport-review-creer" />
        </Panneau>
      ) : null}
      <View style={{ gap: 8 }} testID="esport-review-liste">
        {liste && liste.reviews.length === 0 ? <Text style={{ color: theme.attenue, ...police(theme.policeTexte) }}>Aucune review pour l’instant.</Text> : null}
        {liste?.reviews.map(r => (
          <Pressable
            key={r.id}
            testID={`esport-review-${r.id}`}
            accessibilityRole="button"
            accessibilityLabel={`Ouvrir la review ${r.titre}`}
            onPress={() => onOuvrir(r.id)}
            style={{ flexDirection: 'row', gap: 12, padding: 10, borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.surface, borderRadius: theme.rayonMoyen, alignItems: 'center' }}>
            <Image source={{ uri: miniatureYoutube(r.videoId) }} accessibilityLabel="" style={{ width: 120, height: 68, borderRadius: 6, backgroundColor: theme.fond }} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: theme.texte, fontWeight: '700', fontSize: 15, ...police(theme.policeTexte) }} numberOfLines={2}>
                {r.titre}
              </Text>
              {r.reference ? <Text style={{ color: theme.attenue, fontSize: 13 }}>{r.reference}</Text> : null}
              <Text style={{ color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) }}>
                {r.reperes} repère(s) · par {r.creePar?.pseudo ?? 'un compte supprimé'} · {dateCourte(r.creeLe)}
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
  const total = duree > 0 ? duree : Math.max(60, ...reperes.map(r => (r.fin ?? r.debut) + 30));
  const actif = lecteurIntegre && pret ? repereActif(visibles, temps) : undefined;

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
  useRaccourciRepere(Boolean(data?.droits.annoter) && lecteurIntegre && !formulaire, ouvrirAjout);

  if (!data) {
    return (
      <View testID="esport-review-detail" style={{ gap: 12 }}>
        <Retours theme={theme} erreur={erreur} prefixe="esport-review" />
        {!erreur ? <Text style={{ color: theme.attenue }}>Chargement de la review…</Text> : null}
        <BoutonHub theme={theme} titre="← Reviews" onPress={() => onRetour()} testID="esport-review-retour" />
      </View>
    );
  }

  const joueurs = [...new Map(reperes.filter(r => r.cible).map(r => [r.cible!.compte, r.cible!.pseudo ?? '?'])).entries()];
  const auteurs = [...new Map(reperes.filter(r => r.auteur).map(r => [r.auteur!.compte, r.auteur!.pseudo ?? '?'])).entries()];
  const filtre = filtres.categories.length > 0 || filtres.joueur !== '' || filtres.auteur !== '';

  const enregistrer = (s: SaisieRepere) =>
    void agir('Repère', async () => {
      if (formulaire?.edition) await api.modifierRepere(id, formulaire.edition.id, s);
      else await api.ajouterRepere(id, s);
      const edition = Boolean(formulaire?.edition);
      setFormulaire(undefined);
      await recharger();
      return edition ? 'Repère modifié.' : 'Repère ajouté.';
    });
  const supprimer = (r: Repere) =>
    void agir('Repère', async () => {
      await api.supprimerRepere(id, r.id);
      await recharger();
      return 'Repère supprimé.';
    });
  const commenter = async (r: Repere, texte: string) =>
    agir('Commentaire', async () => {
      await api.commenter(id, r.id, texte);
      await recharger();
    });
  const supprimerCommentaire = (r: Repere, commentaireId: string) =>
    void agir('Commentaire', async () => {
      await api.supprimerCommentaire(id, r.id, commentaireId);
      await recharger();
      return 'Commentaire supprimé.';
    });

  const exporterMarkdown = () =>
    void agir('Export', async () => {
      const f = await api.exporter(id);
      if (!onExporter) return 'L’export de fichier n’est pas disponible sur cet appareil.';
      const ok = await onExporter(f.nom, f.contenu, 'text/markdown');
      return ok ? 'Notes exportées en Markdown.' : undefined;
    });
  const exporterPdf = () =>
    void agir('Export', async () => {
      const f = await api.exporter(id);
      const ok = await imprimerNotes(data.review.titre, f.contenu);
      return ok ? 'Boîte d’impression ouverte : choisissez « Enregistrer au format PDF ».' : 'L’impression n’est pas disponible ici.';
    });

  const colLecteur = (
    <View style={{ gap: 12, flex: large ? 3 : undefined, minWidth: 0 }}>
      <Lecteur theme={theme} videoId={data.review.videoId} depart={depart} large={large} onPret={surPret} />
      {lecteurIntegre ? (
        <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
          {data.droits.annoter ? (
            <BoutonHub theme={theme} titre={`+ Repère à ${formatTemps(temps)}  (${TOUCHE_RACCOURCI})`} variante="plein" onPress={ouvrirAjout} desactive={!pret} testID="esport-review-ajouter" libelle={`Ajouter un repère au temps courant, ${formatTemps(temps)}`} />
          ) : null}
          <Segments
            theme={theme}
            libelle="Vitesse"
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
        <Intertitre theme={theme}>Filtres</Intertitre>
        <View style={styles.ligne} accessibilityLabel="Catégories">
          {CATEGORIES.map(c => {
            const coche = filtres.categories.includes(c.cle);
            return (
              <Pressable
                key={c.cle}
                testID={`esport-filtre-cat-${c.cle}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: coche }}
                accessibilityLabel={`Catégorie ${c.nom}`}
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
          <Choix theme={theme} libelle="Joueur" valeur={filtres.joueur} options={[{ id: '', nom: 'Tous' }, ...joueurs.map(([c, p]) => ({ id: c, nom: p }))]} onChoisir={v => setFiltres(f => ({ ...f, joueur: v }))} testID="esport-filtre-joueur" />
        ) : null}
        {auteurs.length > 1 ? (
          <Choix theme={theme} libelle="Auteur" valeur={filtres.auteur} options={[{ id: '', nom: 'Tous' }, ...auteurs.map(([c, p]) => ({ id: c, nom: p }))]} onChoisir={v => setFiltres(f => ({ ...f, auteur: v }))} testID="esport-filtre-auteur" />
        ) : null}
        <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
          <Text testID="esport-review-compte" style={{ color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) }}>
            {visibles.length} / {reperes.length} repère(s)
          </Text>
          {filtre ? <BoutonHub theme={theme} titre="Effacer les filtres" onPress={() => setFiltres({ categories: [], joueur: '', auteur: '' })} testID="esport-filtre-effacer" /> : null}
        </View>
      </Panneau>
      <ScrollView ref={liste} testID="esport-review-reperes" style={large ? { maxHeight: 640 } : { maxHeight: 520 }} contentContainerStyle={{ gap: 8 }} nestedScrollEnabled>
        {reperes.length === 0 ? (
          <Text style={{ color: theme.attenue, ...police(theme.policeTexte) }}>
            {lecteurIntegre && data.droits.annoter ? `Aucun repère : pendant la lecture, appuyez sur ${TOUCHE_RACCOURCI} (ou le bouton « Repère ») pour en poser un.` : 'Aucun repère pour l’instant.'}
          </Text>
        ) : null}
        {visibles.map(r => (
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
            {data.review.reference ? ` · ${data.review.reference}` : ''} · par {data.review.creePar?.pseudo ?? 'un compte supprimé'}
          </Text>
        </View>
        <View style={[styles.ligne, { flexShrink: 1 }]}>
          <BoutonHub theme={theme} titre="Exporter en Markdown" onPress={exporterMarkdown} testID="esport-review-export-md" />
          {impressionDisponible ? <BoutonHub theme={theme} titre="Exporter en PDF" onPress={exporterPdf} testID="esport-review-export-pdf" /> : null}
          {data.droits.supprimer ? (
            <BoutonConfirme
              theme={theme}
              titre="Supprimer la review"
              confirmation="Oui, supprimer"
              onConfirme={() =>
                void agir('Review', async () => {
                  await api.supprimer(id);
                  onRetour('Review supprimée.');
                })
              }
              testID="esport-review-supprimer"
            />
          ) : null}
          <BoutonHub theme={theme} titre="← Reviews" onPress={() => onRetour()} testID="esport-review-retour" />
        </View>
      </View>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-review" />
      <Avis theme={theme} genre="info" texte={MENTION_LIMITE} testID="esport-review-limite" />
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
}) {
  const c = categorie(r.categorie);
  const [texte, setTexte] = useState('');
  const meta = [c.nom, r.cible ? `Joueur : ${r.cible.pseudo ?? '?'}` : '', `par ${r.auteur?.pseudo ?? 'un compte supprimé'}`, r.fin != null ? `durée ${Math.round(r.fin - r.debut)} s` : ''].filter(Boolean).join(' · ');
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
        accessibilityLabel={lecteurIntegre ? `Aller à ${formatTemps(r.debut)} : ${r.titre}` : `Ouvrir dans YouTube à ${formatTemps(r.debut)} : ${r.titre}`}
        onPress={lecteurIntegre ? onAller : onBascule}
        style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', minHeight: 36 }}>
        <Text style={{ color: theme.texte, fontWeight: '800', minWidth: 56, ...police(theme.policeChiffres) }}>{formatTemps(r.debut)}</Text>
        <Text style={{ color: c.couleur, fontWeight: '800' }} accessibilityElementsHidden importantForAccessibility="no">
          {c.glyphe}
        </Text>
        <Text style={{ color: theme.texte, fontWeight: '700', flex: 1, ...police(theme.policeTexte) }}>{r.titre}</Text>
      </Pressable>
      <Text style={{ color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) }}>{meta}</Text>
      {actif ? (
        // Texte en couleur d'accent (contraste AA garanti dans les 8 thèmes) ; la couleur de catégorie reste sur le pictogramme.
        <Text testID={`esport-repere-actif-${r.id}`} style={{ color: theme.accent, fontSize: 12, fontWeight: '800', ...police(theme.policeTexte) }}>
          ▶ En cours de lecture
        </Text>
      ) : null}
      {r.note ? <Note theme={theme} source={r.note} testID={`esport-repere-note-${r.id}`} /> : null}
      <View style={styles.ligne}>
        {!lecteurIntegre ? <BoutonHub theme={theme} titre={`Ouvrir dans YouTube à ${formatTemps(r.debut)}`} onPress={() => void Linking.openURL(lienYoutubeA(videoId, r.debut))} testID={`esport-repere-youtube-${r.id}`} /> : null}
        <BoutonHub theme={theme} titre={`Commentaires (${r.commentaires.length})`} onPress={onBascule} testID={`esport-repere-commentaires-${r.id}`} />
        {lecteurIntegre && r.peutModifier ? <BoutonHub theme={theme} titre="Modifier" onPress={onModifier} testID={`esport-repere-modifier-${r.id}`} /> : null}
        {lecteurIntegre && r.peutSupprimer ? <BoutonConfirme theme={theme} titre="Supprimer" confirmation="Oui, supprimer" onConfirme={onSupprimer} testID={`esport-repere-supprimer-${r.id}`} /> : null}
      </View>
      {ouvert ? (
        <View style={{ gap: 6, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 8 }} testID={`esport-fil-${r.id}`}>
          {r.commentaires.length === 0 ? <Text style={{ color: theme.attenue, fontSize: 13 }}>Pas encore de commentaire.</Text> : null}
          {r.commentaires.map(k => (
            <View key={k.id} testID={`esport-commentaire-${k.id}`} style={{ gap: 2 }}>
              <Text style={{ color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) }}>
                {k.auteur?.pseudo ?? 'Un compte supprimé'} · {dateCourte(k.creeLe)}
              </Text>
              <Text style={{ color: theme.texte, ...police(theme.policeTexte) }}>{k.texte}</Text>
              {k.peutSupprimer ? <BoutonConfirme theme={theme} titre="Supprimer" confirmation="Oui, supprimer" onConfirme={() => onSupprimerCommentaire(k.id)} testID={`esport-commentaire-supprimer-${k.id}`} /> : null}
            </View>
          ))}
          {droits.annoter ? (
            <View style={{ gap: 6 }}>
              <Champ theme={theme} libelle="Votre commentaire" valeur={texte} onChanger={setTexte} testID={`esport-commentaire-texte-${r.id}`} multiligne maxLength={1000} />
              <BoutonHub
                theme={theme}
                titre="Commenter"
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

