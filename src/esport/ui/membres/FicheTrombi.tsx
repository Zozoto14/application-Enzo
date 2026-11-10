/**
 * Fiche détaillée du trombinoscope : photo grand format, pseudo (nom réel masqué par défaut, selon le droit),
 * teams et jeu pratiqué, postes et personnages (profil de jeu de la team), elo / rang par jeu, palmarès saisi et
 * palmarès CALCULÉ depuis les Tournois / Résultats du club (distingué), anciennes structures, réseaux pro.
 * Badges (migration 0032) : puces sous le pseudo ; « Badges » (qui attribue) ouvre la liste à cocher (EditeurBadges).
 * Actions : copier le texte d'annonce (FR / EN, prêt pour un post), télécharger la photo, modifier.
 *
 * Mode édition (le joueur pour SA fiche — aussi depuis « Mon profil » —, l'éditeur du staff ou du CM) : photo
 * (recadrage carré dans le navigateur), champs, listes, et, pour le joueur seul, la visibilité de chaque champ.
 * Le serveur revérifie tout (droits, adresses des réseaux, clés du profil de jeu, photo).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { BoutonHub, Champ, Segments } from '../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { ErreurEsport } from '../../client';
import {
  CHAMPS_VISIBILITE,
  NIVEAUX_VISIBILITE,
  RESEAUX_TROMBI,
  postesAffiches,
  reseauDeviner,
  urlPlausible,
  type AncienneStructure,
  type ApiTrombi,
  type ChampVisibilite,
  type Elo,
  type EntreePalmares,
  type FicheTrombi as Fiche,
  type NiveauVisibilite,
  type ReseauTrombi,
  type SaisieFiche,
} from '../../trombi/api';
import { choisirPhoto, photoDisponible, telechargerPhoto, type Cadrage } from '../../trombi/photo';
import { trTb, trnTb, type CleTb } from '../../i18n/trombi';
import { langueCourante } from '../../i18n';
import { BoutonConfirme, Choix, PastilleRole, Retours, styles as communs, useAgir } from '../commun';
import { Badge, ESP, Squelette, TitreCarte, attenue, couleurTeam, texte, type EtatPresse } from '../design';
import { PastilleReseau, PhotoJoueur, PucesBadges, RESEAUX_AFFICHES } from './commun';
import { EditeurBadges } from './EditeurBadges';

async function copier(t: string): Promise<boolean> {
  const presse = (globalThis as { navigator?: { clipboard?: { writeText(x: string): Promise<void> } } }).navigator?.clipboard;
  if (!presse) return false;
  try {
    await presse.writeText(t);
    return true;
  } catch {
    return false;
  }
}

/** Placement lisible d'un palmarès (« 1er / 64 », « Top 8 »). */
export function placementTexte(p: { placement: number | null; placementTexte?: string; participants: number | null }): string {
  if (!p.placement) return p.placementTexte ?? '';
  const en = langueCourante() === 'en';
  const n = p.placement;
  const ordinal = en ? `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}` : n === 1 ? '1er' : `${n}e`;
  return p.participants ? trTb('place_sur', { place: ordinal, n: p.participants }) : ordinal;
}

const nomReseau = (r: { reseau: ReseauTrombi; libelle?: string }) => (r.reseau === 'autre' ? r.libelle || trTb('reseau.autre') : RESEAUX_AFFICHES[r.reseau].nom);
const periode = (s: { debut: string; fin: string }) => (s.debut || s.fin ? `${s.debut || '…'} → ${s.fin || trTb('structure.fin_vide')}` : '');

export function FicheTrombi({
  theme,
  api,
  compte,
  large,
  editionInitiale = false,
  onExporter,
  onModifiee,
}: {
  theme: ThemeHub;
  api: ApiTrombi;
  compte: string;
  large: boolean;
  editionInitiale?: boolean;
  onExporter?(nom: string, contenu: string, type?: string): Promise<boolean>;
  onModifiee?(): void;
}) {
  const [fiche, setFiche] = useState<Fiche | undefined>();
  const [edition, setEdition] = useState(editionInitiale);
  const [badges, setBadges] = useState(false);
  const { erreur, avis, agir } = useAgir();
  const charger = useCallback(async () => setFiche(await api.fiche(compte)), [api, compte]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);

  if (!fiche) return erreur ? <Retours theme={theme} erreur={erreur} prefixe="esport-trombi-fiche" /> : <Squelette theme={theme} lignes={6} />;
  if (edition && fiche.peutEditer) {
    return (
      <EditeurFiche
        theme={theme}
        api={api}
        fiche={fiche}
        onFini={f => {
          if (f) {
            setFiche(f);
            onModifiee?.();
          }
          setEdition(false);
        }}
      />
    );
  }
  return (
    <VueFiche
      theme={theme}
      fiche={fiche}
      large={large}
      erreur={erreur}
      avis={avis}
      onModifier={fiche.peutEditer ? () => setEdition(true) : undefined}
      onBadges={fiche.attribution ? () => setBadges(b => !b) : undefined}
      editeurBadges={
        badges && fiche.attribution ? (
          <EditeurBadges
            theme={theme}
            api={api}
            fiche={fiche}
            onCatalogue={onModifiee}
            onFini={f => {
              setBadges(false);
              if (f) {
                setFiche(f);
                onModifiee?.();
              }
            }}
          />
        ) : null
      }
      onCopier={langue =>
        void agir('copie', async () => {
          const t = await api.texte(fiche.compte);
          const texteCopie = langue === 'fr' ? t.fr : t.en;
          if (await copier(texteCopie)) return trTb('texte_copie');
          if (onExporter && (await onExporter(`${fiche.pseudo}-${langue}.txt`, texteCopie, 'text/plain'))) return trTb('texte_enregistre');
          return trTb('texte_non_copie', { texte: texteCopie });
        })
      }
    />
  );
}

function Section({ theme, titre, children, testID, droite }: { theme: ThemeHub; titre: string; children: React.ReactNode; testID?: string; droite?: React.ReactNode }) {
  return (
    <View style={{ gap: ESP.xs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.s }} testID={testID}>
      <TitreCarte theme={theme} titre={titre} droite={droite} />
      {children}
    </View>
  );
}

function VueFiche({
  theme,
  fiche: f,
  large,
  erreur,
  avis,
  onModifier,
  onBadges,
  editeurBadges,
  onCopier,
}: {
  theme: ThemeHub;
  fiche: Fiche;
  large: boolean;
  erreur?: string;
  avis?: string;
  onModifier?(): void;
  onBadges?(): void;
  editeurBadges?: React.ReactNode;
  onCopier(langue: 'fr' | 'en'): void;
}) {
  const [nomVisible, setNomVisible] = useState(false);
  const couleur = f.teams[0] ? couleurTeam(f.teams[0].slug) : theme.accent;
  const calcule = f.calcule;
  return (
    <View style={{ gap: ESP.m }} testID={`esport-trombi-fiche-${f.compte}`}>
      <View style={{ flexDirection: large ? 'row' : 'column', gap: ESP.m, alignItems: large ? 'flex-start' : 'stretch' }}>
        <View style={{ width: large ? 260 : '100%', maxWidth: 360, alignSelf: large ? 'flex-start' : 'center' }}>
          <PhotoJoueur theme={theme} url={f.photo?.url ?? null} pseudo={f.pseudo} couleur={couleur} testID="esport-trombi-fiche-photo" />
        </View>
        <View style={{ flex: large ? 1 : undefined, gap: ESP.xs, minWidth: 0 }}>
          <Text style={{ ...texte(theme, 26), fontWeight: '800' }} accessibilityRole="header" testID="esport-trombi-fiche-pseudo">
            {f.pseudo}
          </Text>
          <PucesBadges theme={theme} badges={f.badges ?? []} testID="esport-trombi-fiche-badges" />
          {f.nomReel ? (
            nomVisible ? (
              <Text style={attenue(theme, 14)} testID="esport-trombi-fiche-nom-reel">
                {f.nomReel}
              </Text>
            ) : (
              <Pressable accessibilityRole="button" onPress={() => setNomVisible(true)} testID="esport-trombi-fiche-nom-afficher" style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}>
                <Text style={{ ...attenue(theme, 14), color: theme.accent }}>{trTb('nom_reel_afficher')}</Text>
              </Pressable>
            )
          ) : null}
          {f.presentation ? <Text style={texte(theme, 14)}>{f.presentation}</Text> : null}
          {f.teams.map(t => (
            <View key={t.id} style={{ gap: ESP.xxs, padding: ESP.xs, borderRadius: 10, backgroundColor: teinteTransparente(couleurTeam(t.slug), 0.1) }} testID={`esport-trombi-fiche-team-${t.slug}`}>
              <Text style={{ ...texte(theme, 15), fontWeight: '700' }}>{`${t.nom} · ${t.jeuNom}`}</Text>
              <View style={communs.ligne}>
                <PastilleRole theme={theme} nom={t.role.nom} couleur={t.role.couleur} />
                {postesAffiches(t).map(p => (
                  <Badge key={p} theme={theme} texte={p} ton="accent" />
                ))}
              </View>
              {t.personnages.length ? <Text style={attenue(theme, 12)}>{trTb('personnages', { liste: t.personnages.map(p => p.nom).join(', ') })}</Text> : null}
            </View>
          ))}
          {f.teams.length === 0 ? <Text style={attenue(theme)}>{trTb('sans_team')}</Text> : null}
        </View>
      </View>
      <View style={communs.ligne}>
        {onModifier ? <BoutonHub theme={theme} titre={trTb('modifier')} variante="plein" onPress={onModifier} testID="esport-trombi-fiche-modifier" /> : null}
        {onBadges ? <BoutonHub theme={theme} titre={trTb('badges.attribuer')} onPress={onBadges} testID="esport-trombi-fiche-badges-attribuer" /> : null}
        <BoutonHub theme={theme} titre={trTb('copier_fr')} onPress={() => onCopier('fr')} testID="esport-trombi-fiche-copier-fr" />
        <BoutonHub theme={theme} titre={trTb('copier_en')} onPress={() => onCopier('en')} testID="esport-trombi-fiche-copier-en" />
        {f.photo && photoDisponible ? <BoutonHub theme={theme} titre={trTb('telecharger_photo')} onPress={() => telechargerPhoto(f.photo!.url, `${f.pseudo}.${f.photo!.type.split('/')[1] === 'jpeg' ? 'jpg' : f.photo!.type.split('/')[1]}`)} testID="esport-trombi-fiche-photo-telecharger" /> : null}
      </View>
      {editeurBadges}
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-trombi-fiche" />
      {f.elos?.length ? (
        <Section theme={theme} titre={trTb('section.elo')} testID="esport-trombi-fiche-elos">
          {f.elos.map(e => (
            <View key={e.jeu} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xs, alignItems: 'center' }}>
              <Text style={{ ...texte(theme), fontWeight: '700' }}>{e.jeuNom ?? e.jeu}</Text>
              <Text style={texte(theme)}>{[e.rang, e.valeur].filter(Boolean).join(' · ')}</Text>
              {e.pic ? <Text style={attenue(theme)}>{trTb('elo.pic_valeur', { pic: e.pic })}</Text> : null}
              {e.majLe ? <Text style={attenue(theme, 12)}>{trTb('elo.maj', { date: e.majLe })}</Text> : null}
            </View>
          ))}
        </Section>
      ) : null}
      {f.palmares !== null && (f.palmares.length || calcule?.tournois.length || calcule?.hors.matchs) ? (
        <Section theme={theme} titre={trTb('section.palmares')} testID="esport-trombi-fiche-palmares">
          {f.palmares.map(p => (
            <View key={p.id} style={{ gap: 2 }} testID={`esport-trombi-palmares-${p.id}`}>
              <Text style={{ ...texte(theme), fontWeight: '700' }}>{[placementTexte(p), p.competition].filter(Boolean).join(' · ')}</Text>
              <Text style={attenue(theme)}>{[p.structure, p.jeuNom, p.date].filter(Boolean).join(' · ')}</Text>
              {p.details ? <Text style={texte(theme, 13)}>{p.details}</Text> : null}
              {p.preuve ? (
                <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(p.preuve)} style={{ alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' }}>
                  <Text style={{ ...attenue(theme), color: theme.accent }}>{trTb('palmares.preuve_voir')}</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
          {calcule && (calcule.tournois.length || calcule.hors.matchs) ? (
            <View style={{ gap: ESP.xs, padding: ESP.s, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.ligne }} testID="esport-trombi-fiche-calcule">
              <View style={communs.ligne}>
                <Badge theme={theme} texte={trTb('palmares.calcule')} ton="ok" />
                <Text style={attenue(theme, 12)}>{trTb('palmares.calcule_aide')}</Text>
              </View>
              {calcule.tournois.map(t => (
                <View key={t.id} style={{ gap: 2 }}>
                  <Text style={{ ...texte(theme), fontWeight: '700' }}>{[placementTexte(t), t.nom].filter(Boolean).join(' · ')}</Text>
                  <Text style={attenue(theme)}>
                    {[t.teamNom, t.jeuNom, t.fin ?? t.debut ?? '', trTb('palmares.bilan', { matchs: t.matchs, v: t.victoires, d: t.defaites }), t.mvp ? trTb('palmares.mvp', { n: t.mvp }) : ''].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              ))}
              {calcule.hors.matchs || calcule.hors.mvp ? <Text style={attenue(theme)}>{trTb('palmares.hors', { matchs: calcule.hors.matchs, v: calcule.hors.victoires, mvp: calcule.hors.mvp })}</Text> : null}
            </View>
          ) : null}
        </Section>
      ) : null}
      {f.structures?.length ? (
        <Section theme={theme} titre={trTb('section.structures')} testID="esport-trombi-fiche-structures">
          {f.structures.map(s => (
            <Text key={s.id} style={texte(theme)}>
              {[s.structure, s.jeuNom, s.role, periode(s)].filter(Boolean).join(' · ')}
            </Text>
          ))}
        </Section>
      ) : null}
      {f.reseaux?.length ? (
        <Section theme={theme} titre={trTb('section.reseaux')} testID="esport-trombi-fiche-reseaux">
          {f.reseaux.map(r => (
            <Pressable
              key={`${r.reseau}-${r.url}`}
              accessibilityRole="link"
              accessibilityLabel={`${nomReseau(r)} : ${r.url}`}
              onPress={() => void Linking.openURL(r.url)}
              style={(etat: EtatPresse) => ({ flexDirection: 'row', alignItems: 'center', gap: ESP.xs, minHeight: 40, opacity: etat.pressed ? 0.7 : 1 })}>
              <PastilleReseau theme={theme} reseau={r.reseau} libelle={r.libelle} taille={28} />
              <Text style={{ ...texte(theme), color: theme.accent, flexShrink: 1 }} numberOfLines={1}>
                {r.identifiant ? `${nomReseau(r)} · @${r.identifiant}` : `${nomReseau(r)} · ${r.url.replace(/^https:\/\//, '')}`}
              </Text>
            </Pressable>
          ))}
        </Section>
      ) : null}
      {f.niveau === 'membre' ? <Text style={attenue(theme, 12)}>{trTb('champs_reserves')}</Text> : null}
    </View>
  );
}

// ------------------------------------------------------------------ Édition

type Ligne<T> = T & { cle: string };
let compteurLignes = 0;
const avecCle = <T extends object>(x: T): Ligne<T> => ({ ...x, cle: `l${++compteurLignes}` });

function Pastilles({ theme, libelle, options, choisies, onChanger, max, testID }: { theme: ThemeHub; libelle: string; options: ReadonlyArray<{ cle: string; nom: string }>; choisies: string[]; onChanger(v: string[]): void; max: number; testID: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{libelle}</Text>
      <View style={communs.ligne} accessibilityLabel={libelle}>
        {options.map(o => {
          const coche = choisies.includes(o.cle);
          const plein = !coche && choisies.length >= max;
          return (
            <Pressable
              key={o.cle}
              testID={`${testID}-${o.cle}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: coche, disabled: plein }}
              accessibilityLabel={`${libelle} : ${o.nom}`}
              disabled={plein}
              onPress={() => onChanger(coche ? choisies.filter(c => c !== o.cle) : [...choisies, o.cle])}
              style={[communs.choix, { borderColor: coche ? theme.accent : theme.ligne, backgroundColor: coche ? teinteTransparente(theme.accent, 0.2) : theme.surface, borderRadius: 10, opacity: plein ? 0.4 : 1 }]}>
              <Text style={{ ...texte(theme, 13), fontWeight: coche ? '700' : '500' }}>{o.nom}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function BlocLigne({ theme, children, onRetirer, testID }: { theme: ThemeHub; children: React.ReactNode; onRetirer(): void; testID: string }) {
  return (
    <View style={{ gap: ESP.xs, padding: ESP.s, borderWidth: 1, borderColor: theme.ligne, borderRadius: 10 }} testID={testID}>
      {children}
      <View style={{ alignSelf: 'flex-start' }}>
        <BoutonHub theme={theme} titre={trTb('retirer')} variante="danger" onPress={onRetirer} testID={`${testID}-retirer`} />
      </View>
    </View>
  );
}

/** Message d'une erreur de validation du serveur, avec la ligne concernée (« Palmarès, ligne 2 : … »). */
function messageErreur(e: unknown): string {
  if (e instanceof ErreurEsport) {
    const index = (e as ErreurEsport & { details?: { index?: number } }).details?.index;
    return typeof index === 'number' ? trTb('erreur_ligne', { ligne: index + 1, message: e.message }) : e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

export function EditeurFiche({ theme, api, fiche: f, onFini, sansAnnuler }: { theme: ThemeHub; api: ApiTrombi; fiche: Fiche; onFini(f?: Fiche): void; sansAnnuler?: boolean }) {
  const [nomReel, setNomReel] = useState(f.nomReel ?? '');
  const [presentation, setPresentation] = useState(f.presentation ?? '');
  const [elos, setElos] = useState<Array<Ligne<Partial<Elo>>>>((f.elos ?? []).map(avecCle));
  const [palmares, setPalmares] = useState<Array<Ligne<Partial<EntreePalmares> & { placementSaisi: string; participantsSaisi: string }>>>(
    (f.palmares ?? []).map(p => avecCle({ ...p, placementSaisi: p.placement ? String(p.placement) : '', participantsSaisi: p.participants ? String(p.participants) : '' })),
  );
  const [structures, setStructures] = useState<Array<Ligne<Partial<AncienneStructure>>>>((f.structures ?? []).map(avecCle));
  const [reseaux, setReseaux] = useState<Array<Ligne<{ reseau: ReseauTrombi; url: string; libelle: string }>>>((f.reseaux ?? []).map(r => avecCle({ reseau: r.reseau, url: r.url, libelle: r.libelle ?? '' })));
  const [postes, setPostes] = useState<Record<string, { postes: string[]; personnages: string[] }>>(Object.fromEntries(f.teams.map(t => [t.id, { postes: t.postes.map(p => p.cle), personnages: t.personnages.map(p => p.cle) }])));
  const [visibilite, setVisibilite] = useState(f.visibilite);
  const [photo, setPhoto] = useState(f.photo?.url ?? null);
  const [cadrage, setCadrage] = useState<Cadrage>('centre');
  const { enCours, erreur, avis, agir } = useAgir();
  const [erreurSaisie, setErreurSaisie] = useState<string | undefined>();
  const champ = (c: ChampVisibilite) => f.champs[c];
  const jeux = f.saisie?.jeux ?? [];
  const optionsJeux = [{ id: '', nom: trTb('jeu.aucun') }, ...jeux.map(j => ({ id: j.cle, nom: j.nom }))];
  const reseauxInvalides = reseaux.filter(r => r.url.trim() && !urlPlausible(r.reseau, r.url));

  const enregistrer = () =>
    void (async () => {
      setErreurSaisie(undefined);
      const s: SaisieFiche = { versionAttendue: f.version };
      if (champ('nomReel')) s.nomReel = nomReel;
      if (champ('presentation')) s.presentation = presentation;
      if (champ('elos')) s.elos = elos.map(({ cle: _c, jeuNom: _j, ...e }) => e);
      if (champ('palmares'))
        s.palmares = palmares.map(({ cle: _c, jeuNom: _j, placementSaisi, participantsSaisi, ...p }) => ({ ...p, placement: placementSaisi.trim() ? Number(placementSaisi) : null, participants: participantsSaisi.trim() ? Number(participantsSaisi) : null }));
      if (champ('structures')) s.structures = structures.map(({ cle: _c, jeuNom: _j, ...x }) => x);
      if (champ('reseaux')) s.reseaux = reseaux.filter(r => r.url.trim()).map(r => ({ reseau: r.reseau, url: r.url.trim(), ...(r.reseau === 'autre' ? { libelle: r.libelle } : {}) }));
      if (f.teams.length) s.postes = postes;
      if (f.peutRegler && visibilite) s.visibilite = visibilite;
      try {
        const nouvelle = await api.modifier(f.compte, s);
        onFini(nouvelle);
      } catch (e) {
        setErreurSaisie(messageErreur(e));
      }
    })();

  return (
    <View style={{ gap: ESP.m }} testID="esport-trombi-editeur">
      <Text style={attenue(theme, 13)}>{f.niveau === 'moi' ? trTb('edition.aide_moi') : trTb('edition.aide_editeur', { pseudo: f.pseudo })}</Text>
      {champ('photo') ? (
        <Section theme={theme} titre={trTb('section.photo')} testID="esport-trombi-editeur-photo">
          <View style={{ flexDirection: 'row', gap: ESP.m, alignItems: 'center', flexWrap: 'wrap' }}>
            <PhotoJoueur theme={theme} url={photo} pseudo={f.pseudo} couleur={f.teams[0] ? couleurTeam(f.teams[0].slug) : theme.accent} taille={112} />
            <View style={{ gap: ESP.xs, flexShrink: 1 }}>
              {photoDisponible ? (
                <>
                  <Segments theme={theme} libelle={trTb('photo.cadrage')} valeur={cadrage} options={[['centre', trTb('photo.cadrage_centre')] as const, ['haut', trTb('photo.cadrage_haut')] as const]} onChoisir={(c: Cadrage) => setCadrage(c)} testID="esport-trombi-photo-cadrage" />
                  <View style={communs.ligne}>
                    <BoutonHub
                      theme={theme}
                      titre={photo ? trTb('photo.changer') : trTb('photo.ajouter')}
                      desactive={Boolean(enCours)}
                      onPress={() =>
                        void agir('photo', async () => {
                          let choisie;
                          try {
                            choisie = await choisirPhoto(cadrage);
                          } catch (e) {
                            const code = (e as { code?: string }).code;
                            throw new Error(trTb(`photo.erreur_${code === 'poids' ? 'poids' : code === 'format' ? 'format' : 'lecture'}` as CleTb));
                          }
                          if (!choisie) return undefined;
                          const nf = await api.photo(f.compte, choisie.envoi);
                          setPhoto(nf.photo?.url ?? choisie.apercu);
                          return trTb('photo.enregistree');
                        })
                      }
                      testID="esport-trombi-photo-choisir"
                    />
                    {photo ? (
                      <BoutonConfirme
                        theme={theme}
                        titre={trTb('photo.supprimer')}
                        confirmation={trTb('photo.supprimer_confirmer')}
                        onConfirme={() =>
                          void agir('photo', async () => {
                            await api.supprimerPhoto(f.compte);
                            setPhoto(null);
                            return trTb('photo.supprimee');
                          })
                        }
                        testID="esport-trombi-photo-supprimer"
                      />
                    ) : null}
                  </View>
                  <Text style={attenue(theme, 12)}>{trTb('photo.aide')}</Text>
                </>
              ) : (
                <Text style={attenue(theme, 13)}>{trTb('photo.native')}</Text>
              )}
            </View>
          </View>
        </Section>
      ) : null}
      <Section theme={theme} titre={trTb('section.identite')}>
        {champ('nomReel') ? <Champ theme={theme} libelle={trTb('nom_reel')} valeur={nomReel} onChanger={setNomReel} maxLength={80} testID="esport-trombi-nom-reel" /> : null}
        {champ('presentation') ? <Champ theme={theme} libelle={trTb('presentation')} valeur={presentation} onChanger={setPresentation} maxLength={500} multiligne testID="esport-trombi-presentation" /> : null}
      </Section>
      {f.teams.some(t => t.genre !== 'cm') ? (
        <Section theme={theme} titre={trTb('section.postes')} testID="esport-trombi-editeur-postes">
          {f.teams.filter(t => t.genre !== 'cm').map(t => {
            const profil = f.saisie?.profils?.find(p => p.teamId === t.id);
            const v = postes[t.id] ?? { postes: [], personnages: [] };
            return (
              <View key={t.id} style={{ gap: ESP.xs }}>
                <Text style={{ ...texte(theme), fontWeight: '700' }}>{`${t.nom} · ${t.jeuNom}`}</Text>
                {profil?.rolesJoueurs.length ? (
                  <Pastilles theme={theme} libelle={trTb('postes')} options={profil.rolesJoueurs} choisies={v.postes} max={5} onChanger={l => setPostes({ ...postes, [t.id]: { ...v, postes: l } })} testID={`esport-trombi-postes-${t.slug}`} />
                ) : (
                  <Text style={attenue(theme, 12)}>{trTb('postes.aucun_profil')}</Text>
                )}
                {profil?.personnages.length ? (
                  <Pastilles theme={theme} libelle={trTb('personnages_titre')} options={profil.personnages} choisies={v.personnages} max={10} onChanger={l => setPostes({ ...postes, [t.id]: { ...v, personnages: l } })} testID={`esport-trombi-persos-${t.slug}`} />
                ) : null}
              </View>
            );
          })}
        </Section>
      ) : null}
      {champ('elos') && (!f.staff || elos.length > 0) ? (
        <Section theme={theme} titre={trTb('section.elo')} testID="esport-trombi-editeur-elos" droite={<BoutonHub theme={theme} titre={trTb('ajouter')} desactive={elos.length >= 10} onPress={() => setElos([...elos, avecCle({ jeu: f.teams.find(t => !elos.some(e => e.jeu === t.jeu))?.jeu ?? jeux[0]?.cle ?? '', valeur: '', rang: '', pic: '' })])} testID="esport-trombi-elo-ajouter" />}>
          {elos.map((e, i) => (
            <BlocLigne key={e.cle} theme={theme} onRetirer={() => setElos(elos.filter(x => x.cle !== e.cle))} testID={`esport-trombi-elo-${i}`}>
              <Choix theme={theme} libelle={trTb('jeu')} valeur={e.jeu} options={jeux.map(j => ({ id: j.cle, nom: j.nom }))} onChoisir={jeu => setElos(elos.map(x => (x.cle === e.cle ? { ...x, jeu } : x)))} testID={`esport-trombi-elo-${i}-jeu`} />
              <View style={communs.ligne}>
                <Champ theme={theme} libelle={trTb('elo.valeur')} valeur={e.valeur ?? ''} onChanger={valeur => setElos(elos.map(x => (x.cle === e.cle ? { ...x, valeur } : x)))} maxLength={40} testID={`esport-trombi-elo-${i}-valeur`} style={{ flexGrow: 1, minWidth: 140 }} />
                <Champ theme={theme} libelle={trTb('elo.rang')} valeur={e.rang ?? ''} onChanger={rang => setElos(elos.map(x => (x.cle === e.cle ? { ...x, rang } : x)))} maxLength={40} testID={`esport-trombi-elo-${i}-rang`} style={{ flexGrow: 1, minWidth: 140 }} />
                <Champ theme={theme} libelle={trTb('elo.pic')} valeur={e.pic ?? ''} onChanger={pic => setElos(elos.map(x => (x.cle === e.cle ? { ...x, pic } : x)))} maxLength={40} testID={`esport-trombi-elo-${i}-pic`} style={{ flexGrow: 1, minWidth: 140 }} />
              </View>
            </BlocLigne>
          ))}
        </Section>
      ) : null}
      {champ('palmares') ? (
        <Section
          theme={theme}
          titre={trTb('section.palmares')}
          testID="esport-trombi-editeur-palmares"
          droite={<BoutonHub theme={theme} titre={trTb('ajouter')} desactive={palmares.length >= 60} onPress={() => setPalmares([avecCle({ competition: '', structure: '', date: '', placementSaisi: '', participantsSaisi: '', placementTexte: '', jeu: f.teams[0]?.jeu ?? '', details: '', preuve: '' }), ...palmares])} testID="esport-trombi-palmares-ajouter" />}>
          <Text style={attenue(theme, 12)}>{trTb('palmares.saisi_aide')}</Text>
          {palmares.map((p, i) => {
            const maj = (m: Partial<typeof p>) => setPalmares(palmares.map(x => (x.cle === p.cle ? { ...x, ...m } : x)));
            return (
              <BlocLigne key={p.cle} theme={theme} onRetirer={() => setPalmares(palmares.filter(x => x.cle !== p.cle))} testID={`esport-trombi-palmares-${i}`}>
                <Champ theme={theme} libelle={trTb('palmares.competition')} valeur={p.competition ?? ''} onChanger={competition => maj({ competition })} maxLength={120} testID={`esport-trombi-palmares-${i}-competition`} />
                <View style={communs.ligne}>
                  <Champ theme={theme} libelle={trTb('palmares.structure')} valeur={p.structure ?? ''} onChanger={structure => maj({ structure })} maxLength={80} testID={`esport-trombi-palmares-${i}-structure`} style={{ flexGrow: 1, minWidth: 160 }} />
                  <Champ theme={theme} libelle={trTb('palmares.date')} placeholder="2025-03" valeur={p.date ?? ''} onChanger={date => maj({ date })} maxLength={10} testID={`esport-trombi-palmares-${i}-date`} style={{ flexGrow: 1, minWidth: 120 }} />
                </View>
                <View style={communs.ligne}>
                  <Champ theme={theme} libelle={trTb('palmares.placement')} valeur={p.placementSaisi} onChanger={placementSaisi => maj({ placementSaisi: placementSaisi.replace(/\D/g, '') })} clavier="number-pad" maxLength={4} testID={`esport-trombi-palmares-${i}-placement`} style={{ flexGrow: 1, minWidth: 100 }} />
                  <Champ theme={theme} libelle={trTb('palmares.participants')} valeur={p.participantsSaisi} onChanger={participantsSaisi => maj({ participantsSaisi: participantsSaisi.replace(/\D/g, '') })} clavier="number-pad" maxLength={6} testID={`esport-trombi-palmares-${i}-participants`} style={{ flexGrow: 1, minWidth: 100 }} />
                  <Champ theme={theme} libelle={trTb('palmares.placement_texte')} placeholder={trTb('palmares.placement_exemple')} valeur={p.placementTexte ?? ''} onChanger={placementTexte => maj({ placementTexte })} maxLength={40} testID={`esport-trombi-palmares-${i}-placement-texte`} style={{ flexGrow: 1, minWidth: 120 }} />
                </View>
                <Choix theme={theme} libelle={trTb('jeu')} valeur={p.jeu ?? ''} options={optionsJeux} onChoisir={jeu => maj({ jeu })} testID={`esport-trombi-palmares-${i}-jeu`} />
                <Champ theme={theme} libelle={trTb('palmares.details')} valeur={p.details ?? ''} onChanger={details => maj({ details })} maxLength={600} multiligne testID={`esport-trombi-palmares-${i}-details`} />
                <Champ theme={theme} libelle={trTb('palmares.preuve')} placeholder="https://" valeur={p.preuve ?? ''} onChanger={preuve => maj({ preuve })} maxLength={500} testID={`esport-trombi-palmares-${i}-preuve`} />
              </BlocLigne>
            );
          })}
          {f.calcule?.tournois.length ? <Text style={attenue(theme, 12)}>{trnTb('palmares.calcule_rappel', f.calcule.tournois.length)}</Text> : null}
        </Section>
      ) : null}
      {champ('structures') ? (
        <Section theme={theme} titre={trTb('section.structures')} testID="esport-trombi-editeur-structures" droite={<BoutonHub theme={theme} titre={trTb('ajouter')} desactive={structures.length >= 30} onPress={() => setStructures([avecCle({ structure: '', jeu: '', debut: '', fin: '', role: '' }), ...structures])} testID="esport-trombi-structure-ajouter" />}>
          {structures.map((s, i) => {
            const maj = (m: Partial<AncienneStructure>) => setStructures(structures.map(x => (x.cle === s.cle ? { ...x, ...m } : x)));
            return (
              <BlocLigne key={s.cle} theme={theme} onRetirer={() => setStructures(structures.filter(x => x.cle !== s.cle))} testID={`esport-trombi-structure-${i}`}>
                <View style={communs.ligne}>
                  <Champ theme={theme} libelle={trTb('structure.nom')} valeur={s.structure ?? ''} onChanger={structure => maj({ structure })} maxLength={80} testID={`esport-trombi-structure-${i}-nom`} style={{ flexGrow: 1, minWidth: 160 }} />
                  <Champ theme={theme} libelle={trTb('structure.role')} valeur={s.role ?? ''} onChanger={role => maj({ role })} maxLength={60} testID={`esport-trombi-structure-${i}-role`} style={{ flexGrow: 1, minWidth: 140 }} />
                </View>
                <View style={communs.ligne}>
                  <Champ theme={theme} libelle={trTb('structure.debut')} placeholder="2023-01" valeur={s.debut ?? ''} onChanger={debut => maj({ debut })} maxLength={10} testID={`esport-trombi-structure-${i}-debut`} style={{ flexGrow: 1, minWidth: 120 }} />
                  <Champ theme={theme} libelle={trTb('structure.fin')} placeholder="2024-06" valeur={s.fin ?? ''} onChanger={fin => maj({ fin })} maxLength={10} testID={`esport-trombi-structure-${i}-fin`} style={{ flexGrow: 1, minWidth: 120 }} />
                </View>
                <Choix theme={theme} libelle={trTb('jeu')} valeur={s.jeu ?? ''} options={optionsJeux} onChoisir={jeu => maj({ jeu })} testID={`esport-trombi-structure-${i}-jeu`} />
              </BlocLigne>
            );
          })}
        </Section>
      ) : null}
      {champ('reseaux') ? (
        <Section theme={theme} titre={trTb('section.reseaux')} testID="esport-trombi-editeur-reseaux" droite={<BoutonHub theme={theme} titre={trTb('ajouter')} desactive={reseaux.length >= 12} onPress={() => setReseaux([...reseaux, avecCle({ reseau: 'x' as ReseauTrombi, url: '', libelle: '' })])} testID="esport-trombi-reseau-ajouter" />}>
          <Text style={attenue(theme, 12)}>{trTb('reseaux.aide')}</Text>
          {reseaux.map((r, i) => {
            const maj = (m: Partial<typeof r>) => setReseaux(reseaux.map(x => (x.cle === r.cle ? { ...x, ...m } : x)));
            const invalide = r.url.trim() !== '' && !urlPlausible(r.reseau, r.url);
            return (
              <BlocLigne key={r.cle} theme={theme} onRetirer={() => setReseaux(reseaux.filter(x => x.cle !== r.cle))} testID={`esport-trombi-reseau-${i}`}>
                <Choix theme={theme} libelle={trTb('reseau')} valeur={r.reseau} options={RESEAUX_TROMBI.map(x => ({ id: x, nom: x === 'autre' ? trTb('reseau.autre') : RESEAUX_AFFICHES[x].nom }))} onChoisir={reseau => maj({ reseau })} testID={`esport-trombi-reseau-${i}-choix`} />
                <Champ
                  theme={theme}
                  libelle={trTb('reseau.url')}
                  placeholder="https://"
                  valeur={r.url}
                  onChanger={url => maj({ url, ...(r.url === '' && url.startsWith('https://') ? { reseau: reseauDeviner(url) } : {}) })}
                  maxLength={300}
                  testID={`esport-trombi-reseau-${i}-url`}
                />
                {r.reseau === 'autre' ? <Champ theme={theme} libelle={trTb('reseau.libelle')} valeur={r.libelle} onChanger={libelle => maj({ libelle })} maxLength={30} testID={`esport-trombi-reseau-${i}-libelle`} /> : null}
                {invalide ? (
                  <Text style={{ ...attenue(theme, 12), color: theme.alerte }} testID={`esport-trombi-reseau-${i}-invalide`}>
                    {r.reseau === 'autre' ? trTb('reseau.invalide_autre') : trTb('reseau.invalide', { reseau: RESEAUX_AFFICHES[r.reseau].nom })}
                  </Text>
                ) : null}
              </BlocLigne>
            );
          })}
        </Section>
      ) : null}
      {f.peutRegler && visibilite ? (
        <Section theme={theme} titre={trTb('section.visibilite')} testID="esport-trombi-editeur-visibilite">
          <Text style={attenue(theme, 12)}>{trTb('visibilite.aide')}</Text>
          {CHAMPS_VISIBILITE.map(c => (
            <View key={c} style={{ gap: 4 }}>
              <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{trTb(`champ.${c}` as CleTb)}</Text>
              <Segments
                theme={theme}
                libelle={trTb(`champ.${c}` as CleTb)}
                valeur={visibilite[c]}
                options={NIVEAUX_VISIBILITE.map(n => [n, trTb(`visibilite.${n}` as CleTb)] as const)}
                onChoisir={(n: NiveauVisibilite) => setVisibilite({ ...visibilite, [c]: n })}
                testID={`esport-trombi-visibilite-${c}`}
              />
            </View>
          ))}
        </Section>
      ) : null}
      {f.niveau === 'editeur' ? <Text style={attenue(theme, 12)}>{trTb('edition.prives')}</Text> : null}
      <Retours theme={theme} erreur={erreurSaisie ?? erreur} avis={avis} prefixe="esport-trombi-editeur" />
      <View style={communs.ligne}>
        <BoutonHub theme={theme} titre={trTb('enregistrer')} variante="plein" desactive={Boolean(enCours) || reseauxInvalides.length > 0} onPress={enregistrer} testID="esport-trombi-enregistrer" />
        {sansAnnuler ? null : <BoutonHub theme={theme} titre={trTb('annuler')} onPress={() => onFini()} testID="esport-trombi-annuler" />}
      </View>
    </View>
  );
}

/** « Mon profil » : la fiche du trombinoscope du compte, en édition (photo, réseaux, elo, palmarès, structures). */
export function MaFicheTrombi({ theme, api }: { theme: ThemeHub; api: ApiTrombi }) {
  const [fiche, setFiche] = useState<Fiche | undefined>();
  const [version, setVersion] = useState(0);
  const { erreur, avis, agir } = useAgir();
  useEffect(() => {
    void agir('', async () => setFiche(await api.fiche('moi')));
  }, [agir, api, version]);
  if (!fiche) return erreur ? <Retours theme={theme} erreur={erreur} prefixe="esport-ma-fiche" /> : <Squelette theme={theme} lignes={4} />;
  return (
    <View style={{ gap: ESP.s }} testID="esport-ma-fiche">
      <Retours theme={theme} avis={avis} prefixe="esport-ma-fiche" />
      <EditeurFiche
        key={`${fiche.version}-${version}`}
        theme={theme}
        api={api}
        fiche={fiche}
        sansAnnuler
        onFini={f => {
          if (f) {
            setFiche(f);
            void agir('', async () => trTb('enregistree'));
          } else setVersion(v => v + 1);
        }}
      />
    </View>
  );
}
