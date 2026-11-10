/**
 * Suivi joueurs (module `player_notes`, section Équipe) : les notes du staff
 * sur chaque joueur.
 *
 *  - Liste des fiches (joueurs d'abord, puis le staff) ; jamais la sienne.
 *  - Fiche d'un joueur : résumé (présence sur 3 mois, tâches, objectifs
 *    individuels, dernières notes), puis l'historique chronologique des notes
 *    (épinglées d'abord), filtres (catégorie, ton, étiquette) et recherche.
 *  - Une note : texte riche (ChampNote), catégorie, ton, étiquettes, date, lien
 *    facultatif (événement, review vidéo, repère), épinglage, « Partager avec
 *    le joueur » (désactivé par défaut) et « sans mon nom ».
 *
 * Confidentialité : le serveur refuse la fiche au joueur concerné et aux
 * joueurs (403) ; le joueur ne voit que les notes partagées, dans son profil
 * de team (MonSuivi). Le journal ne garde que « note ajoutée sur X ».
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Icone } from '../../../ui/icones';
import { Text, View } from 'react-native';
import { BoutonHub, Case, Champ } from '../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { apiPlanning, type Occurrence } from '../../planning/api';
import { ajouterJours, aujourdhui, dateCourteJour, dateValide } from '../../planning/libelles';
import { apiReview, type ReviewListee } from '../../review/api';
import { CATEGORIES_NOTE, TONS_NOTE, apiSuivi, type ApiSuivi, type CategorieNote, type FicheJoueur, type JoueurSuivi, type NoteJoueur, type SaisieNote, type TonNote, type TypeLien } from '../../suivi/api';
import { ChampNote } from '../ChampNote';
import { Choix, Retours, useAgir } from '../commun';
import { AvatarTeam, Badge, Carte, ChiffreCle, ESP, EnTetePage, EtatVide, Grille, MenuActions, Pliable, Squelette, TitreCarte, attenue as styleAttenue, texte as styleTexte, type Ton } from '../design';
import type { PropsModule } from '../modules';
import { NoteMarkdown } from '../review/Note';
import { Pastille } from '../planning/commun';
import { pct } from '../planning/FichePresence';
import { tr, trn } from '../../i18n';
import { ChampDate } from '../../../ui/dates';

export const nomCategorie = (c: CategorieNote): string => tr(`suivi.categorie.${c}`);
export const nomTon = (t: TonNote): string => tr(`suivi.ton.${t}`);
export const tonDeNote = (t: TonNote): Ton => (t === 'positif' ? 'ok' : t === 'a_travailler' ? 'alerte' : 'neutre');

export function SuiviJoueurs({ theme, client, detail, large }: PropsModule) {
  const api = useMemo(() => apiSuivi(client, detail.team.id), [client, detail.team.id]);
  const [ouvert, setOuvert] = useState<string | undefined>();
  return ouvert ? (
    <FicheSuivi theme={theme} api={api} client={client} detail={detail} large={large} compte={ouvert} onRetour={() => setOuvert(undefined)} />
  ) : (
    <ListeFiches theme={theme} api={api} large={large} onOuvrir={setOuvert} />
  );
}

// ------------------------------------------------------------------ Liste des fiches

function ListeFiches({ theme, api, large, onOuvrir }: { theme: ThemeHub; api: ApiSuivi; large: boolean; onOuvrir(compte: string): void }) {
  const [joueurs, setJoueurs] = useState<JoueurSuivi[] | undefined>();
  const { erreur, agir } = useAgir();
  useEffect(() => {
    void agir('', async () => setJoueurs((await api.liste()).joueurs));
  }, [agir, api]);
  const groupes: Array<['joueurs' | 'staff', string]> = [
    ['joueurs', tr('suivi.joueurs')],
    ['staff', tr('suivi.staff')],
  ];
  return (
    <View style={{ gap: ESP.l }} testID="esport-suivi">
      <EnTetePage theme={theme} large={large} titre={tr('cat.module.player_notes.nom')} sous={tr('suivi.sous_titre')} />
      <Retours theme={theme} erreur={erreur} prefixe="esport-suivi" />
      {!joueurs && !erreur ? <Squelette theme={theme} lignes={4} /> : null}
      {joueurs && joueurs.length === 0 ? <EtatVide theme={theme} glyphe="⚑" titre={tr('suivi.aucun_joueur')} texte={tr('suivi.aucun_joueur_texte')} /> : null}
      {joueurs
        ? groupes.map(([g, titre]) => {
            const liste = joueurs.filter(j => j.groupe === g);
            if (!liste.length) return null;
            return (
              <View key={g} style={{ gap: ESP.s }}>
                <Text accessibilityRole="header" style={{ ...styleAttenue(theme, 12), fontWeight: '700', letterSpacing: 1 }}>
                  {titre.toUpperCase()}
                </Text>
                <Grille min={large ? 260 : 300}>
                  {liste.map(j => (
                    <Carte key={j.compte} theme={theme} dense onPress={() => onOuvrir(j.compte)} libelle={tr('presence.ouvrir_la_fiche', { nom: j.pseudo ?? '' })} testID={`esport-suivi-joueur-${j.compte}`}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s }}>
                        <AvatarTeam theme={theme} team={{ nom: j.pseudo ?? '?', slug: j.compte }} taille={40} />
                        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                          <Text style={{ ...styleTexte(theme, 16), fontWeight: '700' }} numberOfLines={1}>
                            {j.pseudo ?? tr('resumes.compte_supprime')}
                          </Text>
                          <Text style={styleAttenue(theme)} numberOfLines={1}>
                            {[j.role?.nom, j.poste].filter(Boolean).join(' · ')}
                          </Text>
                        </View>
                      </View>
                      <Text style={styleAttenue(theme)}>
                        {j.notes ? `${trn('suivi.n_notes', j.notes)}${j.derniere ? ` · ${tr('suivi.derniere_le', { date: dateCourteJour(j.derniere) })}` : ''}` : tr('suivi.aucune_note')}
                        {j.partagees ? ` · ${trn('suivi.n_partagees', j.partagees)}` : ''}
                      </Text>
                    </Carte>
                  ))}
                </Grille>
              </View>
            );
          })
        : null}
    </View>
  );
}

// ------------------------------------------------------------------ Fiche d'un joueur

type Filtres = { q: string; categorie: string; ton: string; tag: string };
const FILTRES_VIDES: Filtres = { q: '', categorie: '', ton: '', tag: '' };

function FicheSuivi({ theme, api, client, detail, large, compte, onRetour }: { theme: ThemeHub; api: ApiSuivi; client: PropsModule['client']; detail: PropsModule['detail']; large: boolean; compte: string; onRetour(): void }) {
  const [fiche, setFiche] = useState<FicheJoueur | undefined>();
  const [filtres, setFiltres] = useState<Filtres>(FILTRES_VIDES);
  const [recherche, setRecherche] = useState('');
  const [edition, setEdition] = useState<NoteJoueur | 'nouvelle' | undefined>();
  const { erreur, avis, agir } = useAgir();
  const charger = useCallback(async () => setFiche(await api.fiche(compte, filtres)), [api, compte, filtres]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);
  useEffect(() => {
    const t = setTimeout(() => setFiltres(f => (f.q === recherche ? f : { ...f, q: recherche })), 250);
    return () => clearTimeout(t);
  }, [recherche]);
  const nom = fiche?.joueur.pseudo ?? '…';
  const actifs = [filtres.q, filtres.categorie, filtres.ton, filtres.tag].filter(Boolean).length;
  const r = fiche?.resume;

  const enregistrer = (s: SaisieNote, note?: NoteJoueur) =>
    agir('note', async () => {
      if (note) await api.modifier(compte, note.id, s);
      else await api.creer(compte, s);
      setEdition(undefined);
      await charger();
      return note ? tr('suivi.note_modifiee') : tr('suivi.note_ajoutee');
    });

  return (
    <View style={{ gap: ESP.l }} testID="esport-suivi-fiche">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s, flexWrap: 'wrap' }}>
        <BoutonHub theme={theme} titre={tr('suivi.toutes_les_fiches')} onPress={onRetour} testID="esport-suivi-retour" />
      </View>
      <EnTetePage
        theme={theme}
        large={large}
        titre={nom}
        sous={fiche ? [fiche.joueur.role?.nom, fiche.joueur.poste, fiche.joueur.ancien ? tr('suivi.ancien_membre') : null].filter(Boolean).join(' · ') : undefined}
        action={fiche?.droits.ecrire && !edition ? <BoutonHub theme={theme} variante="plein" titre={tr('suivi.nouvelle_note')} onPress={() => setEdition('nouvelle')} testID="esport-suivi-nouvelle" /> : undefined}
      />
      <Text style={styleAttenue(theme)}>{tr('suivi.confidentialite')}</Text>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-suivi-fiche" />
      {!fiche ? <Squelette theme={theme} lignes={5} /> : null}
      {edition ? <FormulaireNote theme={theme} client={client} detail={detail} initial={edition === 'nouvelle' ? undefined : edition} pseudo={nom} onEnregistrer={s => void enregistrer(s, edition === 'nouvelle' ? undefined : edition)} onAnnuler={() => setEdition(undefined)} /> : null}
      {r ? (
        <View style={{ gap: ESP.s }} testID="esport-suivi-resume">
          <Grille min={large ? 220 : 150}>
            {r.presence ? (
              <ChiffreCle
                theme={theme}
                large={large}
                glyphe="◷"
                libelle={tr('suivi.presence_3_mois')}
                valeur={pct(r.presence.taux) ?? tr('presence.pas_encore_marque')}
                detail={r.presence.marques ? `${trn('presence.sur_n_seances_marquees', r.presence.marques)}${r.presence.serie >= 2 ? ` · ${trn('presence.absences_de_suite_n', r.presence.serie)}` : ''}` : undefined}
                ton={r.presence.taux === null ? 'neutre' : r.presence.taux >= 0.8 ? 'ok' : r.presence.taux >= 0.5 ? 'alerte' : 'critique'}
                testIDValeur="esport-suivi-resume-presence"
              />
            ) : null}
            {r.taches ? <ChiffreCle theme={theme} large={large} glyphe="☑︎" libelle={tr('suivi.taches_ouvertes')} valeur={String(r.taches.ouvertes)} detail={`${trn('suivi.n_en_retard', r.taches.enRetard)} · ${trn('suivi.n_faites', r.taches.faites)}`} ton={r.taches.enRetard ? 'alerte' : 'neutre'} testIDValeur="esport-suivi-resume-taches" /> : null}
            <ChiffreCle theme={theme} large={large} glyphe="✎" libelle={tr('suivi.notes')} valeur={String(r.total)} detail={trn('suivi.n_partagees', r.partagees)} />
          </Grille>
          {r.objectifs && r.objectifs.length ? (
            <Carte theme={theme} dense testID="esport-suivi-objectifs">
              <TitreCarte theme={theme} titre={tr('suivi.objectifs_individuels')} />
              {r.objectifs.map(o => (
                <View key={o.id} style={{ flexDirection: 'row', gap: ESP.xs, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Text style={{ ...styleTexte(theme), flex: 1 }}>{o.titre}</Text>
                  <Badge theme={theme} texte={tr(`suivi.objectif.${o.statut === 'atteint' ? 'atteint' : o.statut === 'abandonne' ? 'abandonne' : 'actif'}`)} ton={o.statut === 'atteint' ? 'ok' : o.statut === 'abandonne' ? 'neutre' : 'accent'} />
                  {o.dateCible ? <Text style={styleAttenue(theme)}>{dateCourteJour(o.dateCible)}</Text> : null}
                </View>
              ))}
            </Carte>
          ) : null}
          {r.dernieres.length ? (
            <Text style={styleAttenue(theme)} testID="esport-suivi-dernieres">
              {`${tr('suivi.dernieres_notes')} : ${r.dernieres.map(n => `${dateCourteJour(n.date)} · ${nomCategorie(n.categorie)}`).join(' — ')}`}
            </Text>
          ) : null}
        </View>
      ) : null}
      {fiche ? (
        <View style={{ gap: ESP.s }}>
          <Pliable theme={theme} titre={tr('suivi.filtres')} resume={actifs ? trn('suivi.n_actifs', actifs) : undefined} testID="esport-suivi-filtres">
            <Champ theme={theme} libelle={tr('suivi.rechercher')} valeur={recherche} onChanger={setRecherche} maxLength={80} placeholder={tr('suivi.rechercher_exemple')} testID="esport-suivi-recherche" />
            <Choix theme={theme} libelle={tr('suivi.categorie')} valeur={filtres.categorie || 'toutes'} options={[{ id: 'toutes', nom: tr('suivi.toutes') }, ...CATEGORIES_NOTE.map(c => ({ id: c, nom: nomCategorie(c) }))]} onChoisir={v => setFiltres(f => ({ ...f, categorie: v === 'toutes' ? '' : v }))} testID="esport-suivi-filtre-categorie" />
            <Choix theme={theme} libelle={tr('suivi.ton')} valeur={filtres.ton || 'tous'} options={[{ id: 'tous', nom: tr('suivi.tous') }, ...TONS_NOTE.map(t => ({ id: t, nom: nomTon(t) }))]} onChoisir={v => setFiltres(f => ({ ...f, ton: v === 'tous' ? '' : v }))} testID="esport-suivi-filtre-ton" />
            {fiche.etiquettes.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xs }}>
                {fiche.etiquettes.map(t => (
                  <Pastille key={t} theme={theme} actif={filtres.tag === t} libelle={`#${t}`} role="checkbox" onPress={() => setFiltres(f => ({ ...f, tag: f.tag === t ? '' : t }))} testID={`esport-suivi-filtre-tag-${t}`} />
                ))}
              </View>
            ) : null}
            {actifs ? (
              <View style={{ alignSelf: 'flex-start' }}>
                <BoutonHub
                  theme={theme}
                  titre={tr('suivi.effacer_les_filtres')}
                  onPress={() => {
                    setRecherche('');
                    setFiltres(FILTRES_VIDES);
                  }}
                  testID="esport-suivi-filtres-effacer"
                />
              </View>
            ) : null}
          </Pliable>
          {fiche.notes.length === 0 ? (
            <Carte theme={theme}>
              <EtatVide
                theme={theme}
                glyphe="✎"
                titre={actifs ? tr('suivi.aucune_note_filtre') : tr('suivi.aucune_note')}
                texte={actifs ? undefined : tr('suivi.aucune_note_texte', { nom })}
                action={fiche.droits.ecrire && !actifs && !edition ? { titre: tr('suivi.nouvelle_note'), onPress: () => setEdition('nouvelle'), testID: 'esport-suivi-vide-nouvelle' } : undefined}
                testID="esport-suivi-notes-vide"
              />
            </Carte>
          ) : null}
          <View style={{ gap: ESP.s }} testID="esport-suivi-notes">
            {fiche.notes.map(n => (
              <CarteNote key={n.id} theme={theme} n={n} api={api} compte={compte} onModifier={() => setEdition(n)} onChange={msg =>
                  void agir('note', async () => {
                    await charger();
                    return msg;
                  })
                } agir={agir} />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function CarteNote({ theme, n, api, compte, onModifier, onChange, agir }: { theme: ThemeHub; n: NoteJoueur; api: ApiSuivi; compte: string; onModifier(): void; onChange(message: string): void; agir: ReturnType<typeof useAgir>['agir'] }) {
  const [confirmer, setConfirmer] = useState(false);
  const id = `esport-suivi-note-${n.id.slice(0, 8)}`;
  const action = (s: SaisieNote, message: string) =>
    void agir('note', async () => {
      await api.modifier(compte, n.id, s);
      onChange(message);
    });
  return (
    <Carte theme={theme} dense testID={id} accent={n.epinglee ? theme.accent : undefined} style={n.partagee ? { borderColor: teinteTransparente(theme.ok, 0.6) } : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xs, flexWrap: 'wrap' }}>
        {n.epinglee ? <Text style={{ ...styleTexte(theme), fontWeight: '800' }}>
            <Icone nom="epingle" /> {tr('suivi.epinglee')}
          </Text> : null}
        <Text style={{ ...styleTexte(theme), fontWeight: '700' }}>{dateCourteJour(n.date)}</Text>
        <Badge theme={theme} texte={nomCategorie(n.categorie)} ton="accent" />
        <Badge theme={theme} texte={nomTon(n.ton)} ton={tonDeNote(n.ton)} />
        {n.partagee ? <Badge theme={theme} texte={n.auteurMasque ? tr('suivi.partagee_sans_nom') : tr('suivi.partagee')} ton="ok" testID={`${id}-partagee`} /> : null}
        <View style={{ flex: 1 }} />
        {n.peutModifier || n.peutSupprimer ? (
          <MenuActions
            theme={theme}
            testID={`${id}-menu`}
            actions={[
              n.peutModifier && { titre: n.epinglee ? tr('suivi.desepingler') : tr('suivi.epingler'), onPress: () => action({ epinglee: !n.epinglee }, n.epinglee ? tr('suivi.note_desepinglee') : tr('suivi.note_epinglee')), testID: `${id}-epingler` },
              n.peutModifier && { titre: n.partagee ? tr('suivi.retirer_le_partage') : tr('suivi.partager_avec_le_joueur'), onPress: () => action({ partagee: !n.partagee }, n.partagee ? tr('suivi.partage_retire') : tr('suivi.note_partagee')), testID: `${id}-partager` },
              n.peutModifier && { titre: tr('membresRoles.modifier'), onPress: onModifier, testID: `${id}-modifier` },
              n.peutSupprimer && { titre: tr('suivi.supprimer'), onPress: () => setConfirmer(true), testID: `${id}-supprimer`, danger: true },
            ]}
          />
        ) : null}
      </View>
      <NoteMarkdown theme={theme} source={n.contenu} testID={`${id}-contenu`} />
      {n.tags.length ? <Text style={{ ...styleAttenue(theme), color: theme.accent }}>{n.tags.map(t => `#${t}`).join('  ')}</Text> : null}
      {n.lien ? (
        <Text style={styleAttenue(theme)} testID={`${id}-lien`}>
          <Icone nom="lien" /> {`${tr(`suivi.lien.${n.lien.type}`)} : ${n.lien.titre ?? tr('suivi.lien_inaccessible')}${n.lien.occurrence ? ` · ${dateCourteJour(n.lien.occurrence.slice(0, 10))}` : ''}`}
        </Text>
      ) : null}
      <Text style={styleAttenue(theme)}>{n.auteur ? tr('suivi.par', { nom: n.auteur.pseudo ?? tr('resumes.compte_supprime') }) : tr('suivi.auteur_supprime')}</Text>
      {confirmer ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xs, alignItems: 'center' }}>
          <Text style={{ ...styleTexte(theme), color: theme.critique }}>{tr('suivi.supprimer_definitivement')}</Text>
          <BoutonHub
            theme={theme}
            variante="danger"
            titre={tr('suivi.oui_supprimer')}
            onPress={() =>
              void agir('note', async () => {
                await api.supprimer(compte, n.id);
                onChange(tr('suivi.note_supprimee'));
              })
            }
            testID={`${id}-supprimer-confirmer`}
          />
          <BoutonHub theme={theme} titre={tr('assistant.annuler')} onPress={() => setConfirmer(false)} testID={`${id}-supprimer-annuler`} />
        </View>
      ) : null}
    </Carte>
  );
}

// ------------------------------------------------------------------ Formulaire

function FormulaireNote({
  theme,
  client,
  detail,
  initial,
  pseudo,
  onEnregistrer,
  onAnnuler,
}: {
  theme: ThemeHub;
  client: PropsModule['client'];
  detail: PropsModule['detail'];
  initial?: NoteJoueur;
  pseudo: string;
  onEnregistrer(s: SaisieNote): void;
  onAnnuler(): void;
}) {
  const auj = aujourdhui(detail.team.fuseau);
  const [contenu, setContenu] = useState(initial?.contenu ?? '');
  const [categorie, setCategorie] = useState<CategorieNote>(initial?.categorie ?? 'performance');
  const [ton, setTon] = useState<TonNote>(initial?.ton ?? 'neutre');
  const [tags, setTags] = useState((initial?.tags ?? []).join(', '));
  const [date, setDate] = useState(initial?.date ?? auj);
  const [epinglee, setEpinglee] = useState(initial?.epinglee ?? false);
  const [partagee, setPartagee] = useState(initial?.partagee ?? false);
  const [masque, setMasque] = useState(initial?.auteurMasque ?? false);
  const [typeLien, setTypeLien] = useState<TypeLien | 'sans'>(initial?.lien?.type ?? 'sans');
  const [lien, setLien] = useState<{ id: string; occurrence?: string | null } | undefined>(initial?.lien ? { id: initial.lien.id, occurrence: initial.lien.occurrence } : undefined);
  const peut = (p: string) => detail.moi.permissions.includes(p) && detail.modules.some(m => m.active && m.cle === (p.startsWith('planning') ? 'planning' : 'video_review'));
  const typesLien: Array<{ id: TypeLien | 'sans'; nom: string }> = [
    { id: 'sans', nom: tr('suivi.lien.aucun') },
    ...(peut('planning.view') ? [{ id: 'evenement' as const, nom: tr('suivi.lien.evenement') }] : []),
    ...(peut('video_review.view') ? [{ id: 'review' as const, nom: tr('suivi.lien.review') }, { id: 'repere' as const, nom: tr('suivi.lien.repere') }] : []),
  ];
  const valide = contenu.trim().length > 0 && dateValide(date);
  return (
    <Carte theme={theme} testID="esport-suivi-formulaire">
      <TitreCarte theme={theme} titre={initial ? tr('suivi.modifier_la_note') : tr('suivi.nouvelle_note_sur', { nom: pseudo })} />
      <ChampNote theme={theme} libelle={tr('suivi.la_note')} valeur={contenu} onChanger={setContenu} maxLength={8000} testID="esport-suivi-contenu" />
      <Choix<CategorieNote> theme={theme} libelle={tr('suivi.categorie')} valeur={categorie} options={CATEGORIES_NOTE.map(c => ({ id: c, nom: nomCategorie(c) }))} onChoisir={setCategorie} testID="esport-suivi-categorie" />
      <Choix<TonNote> theme={theme} libelle={tr('suivi.ton')} valeur={ton} options={TONS_NOTE.map(t => ({ id: t, nom: nomTon(t) }))} onChoisir={setTon} testID="esport-suivi-ton" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.s }}>
        <Champ theme={theme} libelle={tr('suivi.etiquettes')} valeur={tags} onChanger={setTags} maxLength={260} placeholder={tr('suivi.etiquettes_exemple')} style={{ flexGrow: 1, flexBasis: 240 }} testID="esport-suivi-tags" />
        <ChampDate theme={theme} libelle={tr('suivi.date')} valeur={date} onChanger={setDate} style={{ width: 190, maxWidth: '100%' }} testID="esport-suivi-date" />
      </View>
      {typesLien.length > 1 ? (
        <View style={{ gap: ESP.xs }}>
          <Choix
            theme={theme}
            libelle={tr('suivi.lien_facultatif')}
            valeur={typeLien}
            options={typesLien}
            onChoisir={v => {
              setTypeLien(v);
              setLien(undefined);
            }}
            testID="esport-suivi-lien-type"
          />
          {typeLien !== 'sans' ? <ChoixLien theme={theme} client={client} detail={detail} type={typeLien} valeur={lien} onChoisir={setLien} /> : null}
        </View>
      ) : null}
      <View style={{ gap: ESP.xs }}>
        <LigneCase theme={theme} coche={epinglee} libelle={tr('suivi.epingler_en_haut')} onChanger={setEpinglee} testID="esport-suivi-epinglee" />
        <LigneCase theme={theme} coche={partagee} libelle={tr('suivi.partager_avec', { nom: pseudo })} onChanger={setPartagee} testID="esport-suivi-partagee" />
        {partagee ? <LigneCase theme={theme} coche={masque} libelle={tr('suivi.sans_mon_nom')} onChanger={setMasque} testID="esport-suivi-masque" /> : null}
        <Text style={styleAttenue(theme)}>{partagee ? tr('suivi.partage_explication', { nom: pseudo }) : tr('suivi.privee_explication', { nom: pseudo })}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: ESP.xs, flexWrap: 'wrap' }}>
        <BoutonHub
          theme={theme}
          variante="plein"
          titre={tr('discord.enregistrer')}
          desactive={!valide}
          onPress={() =>
            onEnregistrer({
              contenu,
              categorie,
              ton,
              tags: tags
                .split(/[,\n]/)
                .map(t => t.trim())
                .filter(Boolean),
              date,
              epinglee,
              partagee,
              auteurMasque: partagee && masque,
              lien: typeLien === 'sans' || !lien ? null : { type: typeLien, id: lien.id, occurrence: lien.occurrence ?? null },
            })
          }
          testID="esport-suivi-enregistrer"
        />
        <BoutonHub theme={theme} titre={tr('assistant.annuler')} onPress={onAnnuler} testID="esport-suivi-annuler" />
      </View>
    </Carte>
  );
}

function LigneCase({ theme, coche, libelle, onChanger, testID }: { theme: ThemeHub; coche: boolean; libelle: string; onChanger(v: boolean): void; testID: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s, minHeight: 44 }}>
      <Case theme={theme} coche={coche} libelle={libelle} onChanger={onChanger} testID={testID} />
      <Text style={{ ...styleTexte(theme), flex: 1 }} onPress={() => onChanger(!coche)}>
        {libelle}
      </Text>
    </View>
  );
}

/** Choix de l'élément lié : séances récentes, reviews, ou repères d'une review. */
function ChoixLien({ theme, client, detail, type, valeur, onChoisir }: { theme: ThemeHub; client: PropsModule['client']; detail: PropsModule['detail']; type: TypeLien; valeur?: { id: string; occurrence?: string | null }; onChoisir(v: { id: string; occurrence?: string | null }): void }) {
  const [occurrences, setOccurrences] = useState<Occurrence[] | undefined>();
  const [reviews, setReviews] = useState<ReviewListee[] | undefined>();
  const [review, setReview] = useState<string | undefined>();
  const [reperes, setReperes] = useState<Array<{ id: string; titre: string }> | undefined>();
  useEffect(() => {
    const auj = aujourdhui(detail.team.fuseau);
    if (type === 'evenement') {
      apiPlanning(client, detail.team.id)
        .liste({ debut: ajouterJours(auj, -30), fin: ajouterJours(auj, 8), fuseau: detail.team.fuseau })
        .then(l => setOccurrences(l.occurrences.slice().reverse().slice(0, 20)), () => setOccurrences([]));
    } else {
      apiReview(client, detail.team.id)
        .liste()
        .then(l => setReviews(l.reviews.slice(0, 20)), () => setReviews([]));
    }
  }, [client, detail.team.id, detail.team.fuseau, type]);
  useEffect(() => {
    if (type !== 'repere' || !review) return;
    apiReview(client, detail.team.id)
      .detail(review)
      .then(d => setReperes(d.reperes.map(r => ({ id: r.id, titre: r.titre }))), () => setReperes([]));
  }, [client, detail.team.id, review, type]);
  const liste = (elements: Array<{ id: string; nom: string; occurrence?: string }> | undefined, choisi: (e: { id: string; occurrence?: string }) => boolean, choisir: (e: { id: string; occurrence?: string }) => void, prefixe: string) =>
    !elements ? (
      <Squelette theme={theme} lignes={2} />
    ) : elements.length === 0 ? (
      <Text style={styleAttenue(theme)}>{tr('suivi.rien_a_lier')}</Text>
    ) : (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xs }}>
        {elements.map(e => (
          <Pastille key={`${e.id}-${e.occurrence ?? ''}`} theme={theme} actif={choisi(e)} libelle={e.nom} role="radio" onPress={() => choisir(e)} testID={`${prefixe}-${e.id.slice(0, 8)}${e.occurrence ? `-${e.occurrence.slice(0, 10)}` : ''}`} />
        ))}
      </View>
    );
  if (type === 'evenement') {
    return liste(
      occurrences?.map(o => ({ id: o.evenementId, occurrence: o.cle, nom: `${dateCourteJour(o.jour)} · ${o.titre}` })),
      e => valeur?.id === e.id && (valeur.occurrence ?? null) === (e.occurrence ?? null),
      e => onChoisir({ id: e.id, occurrence: e.occurrence ?? null }),
      'esport-suivi-lien-evenement',
    );
  }
  if (type === 'review') return liste(reviews?.map(r => ({ id: r.id, nom: r.titre })), e => valeur?.id === e.id, e => onChoisir({ id: e.id }), 'esport-suivi-lien-review');
  return (
    <View style={{ gap: ESP.xs }}>
      {liste(reviews?.map(r => ({ id: r.id, nom: r.titre })), e => review === e.id, e => setReview(e.id), 'esport-suivi-lien-review')}
      {review ? liste(reperes?.map(r => ({ id: r.id, nom: r.titre })), e => valeur?.id === e.id, e => onChoisir({ id: e.id }), 'esport-suivi-lien-repere') : null}
    </View>
  );
}

