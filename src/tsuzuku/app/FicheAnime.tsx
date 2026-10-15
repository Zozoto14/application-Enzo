/** Fiche d'un animé : synopsis, bibliothèque, épisodes, lecture, lien manuel, « vu ailleurs ». */

import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { teinteTransparente } from '../../hub/themes';
import { trouver } from '../moteur/bibliotheque';
import { useCharger, useTsuzuku } from './contexte';
import { BandeauFiche, BlocBibliotheque, BlocVuAilleurs, LiensLegaux, type FicheMin } from './FicheCommune';
import { CarteSansSource, LienGererSources } from './EtatSources';
import { DisponibiliteSources } from './DiagnosticSources';
import { episodesDisponibles, etatLangues, titresPourSources } from './resoudre';
import { choisirLangue, langueVoulue } from './langues';
import { SelecteurLangue } from './SelecteurLangue';
import { LIBELLE_LANGUE_VERSION } from '../moteur/langues';
import { sourcesActives } from '../moteur/sources';
import { LienAnime, prochainEpisode } from './LienAnime';
import { intentionEpisode, poigneesIntention } from './precharge';
import { Bouton, Etat, LIBELLE_STATUT, TitreSection, styleAttenue, styleTexte } from './ui';

const PAR_PAGE = 30;

/**
 * « VF | VOSTFR » au-dessus de la liste d'épisodes : la recherche de la fiche
 * (même résultat, aucune requête de plus), la langue retenue pour la série ;
 * les épisodes s'ouvrent dans cette langue. Rien sans source ni résultat.
 */
function LangueFiche({ id, titres }: { id: string; titres: readonly string[] }) {
  const { s, theme, version, changee } = useTsuzuku();
  const etat = useCharger(async () => {
    if (!s.lectureSources) return null;
    const voulue = await langueVoulue(s, `anime:${id}`);
    const d = await episodesDisponibles(s, { id, titres, langue: voulue.langue });
    const autres = d.resultat?.source ? sourcesActives(await s.sources()).filter(x => x.id !== d.resultat!.source!.id).length : 0;
    return { d, voulue, langues: etatLangues(d, undefined, autres) };
  }, [s, id, titres.join('|'), version]);
  const e = etat.donnees;
  if (!e?.langues) return null;
  const valeur = e.voulue.langue && e.langues.options[e.voulue.langue].etat !== 'absente' ? e.voulue.langue : e.langues.courante;
  return (
    <View style={{ gap: 6 }} testID="fiche-langue">
      <SelecteurLangue
        testID="fiche-langue-choix"
        etat={e.langues}
        valeur={valeur}
        enCours={etat.enCours}
        onChoisir={l => void choisirLangue(s, `anime:${id}`, l).then(changee)}
        note={e.langues.inconnue ? undefined : `Les épisodes s’ouvrent en ${valeur ? LIBELLE_LANGUE_VERSION[valeur] : 'VF ou VOSTFR'}${e.voulue.auChoix ? ' (au choix à chaque fois)' : e.voulue.origine === 'serie' ? ' (retenu pour cette série)' : ''}. Vu / reprendre : communs aux deux langues.`}
      />
      {etat.erreur ? <Text style={styleAttenue(theme, 15)}>{etat.erreur}</Text> : null}
    </View>
  );
}

export function FicheAnimeEcran({ id }: { id: string }) {
  const { s, theme, aller, retour, version } = useTsuzuku();
  const fiche = useCharger(async () => (await s.catalogue.animes.parId(id)).data, [s, id]);
  const eps = useCharger(async () => (await s.catalogue.animes.episodes(id)).data, [s, id]);
  const lib = useCharger(() => s.depot.lire(), [s, version]);
  const [visibles, setVisibles] = useState(PAR_PAGE);
  const f = fiche.donnees;
  const entree = lib.donnees ? trouver(lib.donnees, 'anime', id) : null;
  const min: FicheMin | undefined = f ? { kind: 'anime', id, title: f.title, image: f.image, year: f.year, totalEpisodes: f.totalEpisodes } : undefined;
  const suivant = prochainEpisode(lib.donnees, id, f?.totalEpisodes);
  const listeEps = eps.donnees?.length ? eps.donnees : f?.totalEpisodes ? Array.from({ length: f.totalEpisodes }, (_, i) => ({ number: i + 1, title: null, aired: null, filler: false, url: null })) : [];

  return (
    <View style={{ gap: 18 }} testID="tsuzuku-fiche-anime">
      <View style={{ alignSelf: 'flex-start' }}>
        <Bouton titre="← Retour" onPress={retour} testID="fiche-retour" />
      </View>
      <Etat enCours={fiche.enCours} erreur={fiche.erreur} onRecharger={fiche.recharger}>
        {f && min ? (
          <View style={{ gap: 18 }}>
            <BandeauFiche
              image={f.image}
              banniere={f.banner}
              etiquette="ANIMÉ"
              statut={entree?.status}
              score={f.score}
              titre={f.title}
              sousTitre={f.titleJapanese && f.titleJapanese !== f.title ? f.titleJapanese : null}
              meta={[f.type, f.year, f.totalEpisodes ? `${f.totalEpisodes} épisodes` : null, f.airingStatus, f.studios.slice(0, 2).join(', ')]}
              genres={f.genres}
              synopsis={f.synopsis}
              progression={entree && f.totalEpisodes ? { vus: Math.min(entree.currentEpisode || 0, f.totalEpisodes), total: f.totalEpisodes } : null}>
              {entree ? (
                <Text style={[styleTexte(theme, 13), { fontWeight: '700', color: theme.accent }]} testID="fiche-statut">
                  {LIBELLE_STATUT[entree.status]}
                  {entree.currentEpisode ? ` · épisode ${entree.currentEpisode}` : ''}
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <Bouton titre={suivant === 1 && (entree?.currentEpisode ?? 0) > 0 ? '▶ Revoir depuis l’épisode 1' : entree?.currentEpisode ? `▶ Reprendre l’épisode ${suivant}` : `▶ Lire l’épisode ${suivant}`} variante="plein" onPress={() => aller({ t: 'lecteur', kind: 'anime', id, numero: suivant })} testID="fiche-lire" />
              </View>
            </BandeauFiche>
            <BlocBibliotheque fiche={min} entree={entree} />
            <BlocVuAilleurs fiche={min} entree={entree} />
            <CarteSansSource lieu="fiche" />
            <DisponibiliteSources id={id} titres={titresPourSources(f)} oeuvre={f.title} aPrecharger={suivant} />
            <LienAnime id={id} numeroCourant={suivant} catalogue={listeEps} />
            <LienGererSources testID="fiche-gerer-sources" />
            <LiensLegaux liens={f.streamingLinks} />
            <View style={{ gap: 8 }} testID="fiche-episodes">
              <TitreSection>Épisodes</TitreSection>
              <LangueFiche id={id} titres={titresPourSources(f)} />
              <Etat enCours={eps.enCours && !eps.donnees} erreur={eps.erreur} onRecharger={eps.recharger} vide={!listeEps.length && !eps.enCours ? 'Aucune liste d’épisodes : utilisez « Lire l’épisode » ou un lien manuel.' : undefined}>
                <View style={{ borderWidth: 1, borderColor: theme.ligne, borderRadius: Math.max(theme.rayonMoyen, 8), overflow: 'hidden', backgroundColor: theme.surface }}>
                  {listeEps.slice(0, visibles).map((ep, i) => {
                    const vu = (entree?.currentEpisode ?? 0) >= ep.number;
                    return (
                      <Pressable
                        key={ep.number}
                        testID={`episode-${ep.number}`}
                        accessibilityRole="button"
                        accessibilityLabel={`Lire l’épisode ${ep.number}${ep.title ? `, ${ep.title}` : ''}${vu ? ', vu' : ''}`}
                        onPress={() => aller({ t: 'lecteur', kind: 'anime', id, numero: ep.number })}
                        {...poigneesIntention(() => intentionEpisode(s, { id, titres: titresPourSources(f), numero: ep.number }))}
                        style={(p: { hovered?: boolean; pressed: boolean }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 54, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: theme.ligne, backgroundColor: p.hovered || p.pressed ? teinteTransparente(theme.texte, 0.05) : 'transparent' })}>
                        <View style={{ width: 30, height: 30, borderRadius: Math.min(theme.rayonMoyen, 8), alignItems: 'center', justifyContent: 'center', backgroundColor: vu ? theme.accent : teinteTransparente(theme.texte, 0.08) }}>
                          <Text style={{ color: vu ? theme.surAccent : theme.texte, fontWeight: '800', fontSize: 13 }}>{ep.number}</Text>
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text numberOfLines={1} style={styleTexte(theme, 14)}>
                            {ep.title ?? `Épisode ${ep.number}`}
                          </Text>
                          {ep.aired ? <Text style={styleAttenue(theme, 12)}>{String(ep.aired).slice(0, 10)}</Text> : null}
                        </View>
                        {ep.filler ? (
                          <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, backgroundColor: teinteTransparente(theme.texte, 0.08) }}>
                            <Text style={styleAttenue(theme, 11)}>filler</Text>
                          </View>
                        ) : null}
                        <Text style={{ color: vu ? theme.accent : theme.attenue, fontWeight: '800' }}>{vu ? '✓' : '▶'}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {listeEps.length > visibles ? <Bouton titre={`Afficher la suite (${listeEps.length - visibles})`} onPress={() => setVisibles(v => v + PAR_PAGE)} testID="episodes-plus" style={{ alignSelf: 'center' }} /> : null}
              </Etat>
            </View>
          </View>
        ) : null}
      </Etat>
    </View>
  );
}
