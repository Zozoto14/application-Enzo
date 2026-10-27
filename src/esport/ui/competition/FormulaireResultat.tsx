/**
 * Saisie (ou modification) d'un résultat, structurée par le PROFIL DE JEU de la team :
 *  - série (deux équipes) : BO du format, une manche par map / game ; score en rounds (avec, au choix, le
 *    détail par mi-temps et les prolongations si le jeu en a), en points, ou gagnée / perdue (manches) ;
 *  - classement (plusieurs équipes) : place et points de chaque manche (barème du profil proposé),
 *    place finale et nombre d'équipes ;
 *  - maps et modes du profil, joueurs alignés (membres), personnages joués, statistiques libres, MVP ;
 *  - lien facultatif : match d'un tournoi, événement du planning, review vidéo ; visibilité et publication.
 * L'issue (victoire, défaite, nul) ou la place est calculée : un aperçu ici, le serveur décide.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Champ, Interrupteur } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import { ErreurEsport } from '../../client';
import type { ApiCompetition, FormulaireResultat as Formulaire, GenreResultat, Issue, Resultat, SaisieManche, SaisieResultat } from '../../competition/api';
import { nomIssue } from '../../competition/libelles';
import { apercuSerie, issueManche, lireStatsTexte, pointsBareme, statsEnTexte, systemeDe } from '../../competition/score';
import { trC } from '../../i18n/competition';
import { Choix, Panneau, Retours, styles, useAgir } from '../commun';
import { Badge, ESP, Volet, attenue, texte } from '../design';
import { ChoixAdversaires, Pastille, instantSaisi, murale } from './commun';

type Lien = 'sans' | 'match' | 'evenement';
type MancheUi = SaisieManche & { detail?: boolean };
type Joueur = { personnages: string[]; stats: string; ouvert?: boolean };

const nombreOuVide = (v: string): number | string => (v.trim() === '' ? '' : /^\d+$/.test(v.trim()) ? Number(v.trim()) : v);
const enTexte = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** Message d'un refus du serveur : la raison du score traduite, avec la manche concernée. */
function messageErreur(e: unknown): string {
  if (e instanceof ErreurEsport && e.code === 'score-invalide' && e.details) {
    const raison = String(e.details.raison ?? '');
    const chemin = String(e.details.chemin ?? '');
    const m = /^manches\.(\d+)/.exec(chemin);
    const texteRaison = trC(`f.raison.${raison}` as 'f.raison.nombre') === `f.raison.${raison}` ? e.message : trC(`f.raison.${raison}` as 'f.raison.nombre');
    return m ? trC('f.erreur_manche', { n: Number(m[1]) + 1, raison: texteRaison }) : texteRaison;
  }
  return e instanceof Error ? e.message : String(e);
}

export function FormulaireResultat({
  theme,
  api,
  teamId,
  fuseau,
  large,
  existant,
  matchId,
  onFermer,
  onEnregistre,
}: {
  theme: ThemeHub;
  api: ApiCompetition;
  teamId: string;
  fuseau: string;
  large: boolean;
  existant?: Resultat;
  matchId?: string;
  onFermer(): void;
  onEnregistre(id: string): void;
}) {
  const [f, setF] = useState<Formulaire | undefined>();
  const { erreur, agir, enCours } = useAgir();
  useEffect(() => {
    void agir('', async () => setF(await api.formulaire(teamId)));
  }, [agir, api, teamId]);
  const debut = murale(existant?.date, fuseau);
  const [lien, setLien] = useState<Lien>(existant?.tournoiMatchId || matchId ? 'match' : existant?.evenementId ? 'evenement' : 'sans');
  const [match, setMatch] = useState<string>(existant?.tournoiMatchId ?? matchId ?? '');
  const [evenement, setEvenement] = useState<string>(existant?.evenementId ?? '');
  const [genre, setGenre] = useState<GenreResultat>(existant?.genre && existant.genre !== 'tournoi' ? existant.genre : 'officiel');
  const [date, setDate] = useState(debut.date);
  const [heure, setHeure] = useState(debut.heure || '20:00');
  const [formatCle, setFormatCle] = useState<string>(existant?.format?.cle ?? '');
  const [bo, setBo] = useState<number | null>(existant?.bo ?? null);
  const [adversaires, setAdversaires] = useState<Array<{ id?: string; nom?: string }>>(existant ? existant.adversaires.map(a => (a.id ? { id: a.id } : { nom: a.nom })) : []);
  const [manches, setManches] = useState<MancheUi[]>(
    existant
      ? existant.manches.map(m => ({
          carteCle: m.carte?.cle ?? null,
          carteNom: m.carte && !m.carte.cle ? m.carte.nom : undefined,
          modeCle: m.mode?.cle ?? null,
          ...(m.nous !== null ? { nous: m.nous, eux: m.eux } : {}),
          ...(m.nous === null && m.issue ? { issue: m.issue } : {}),
          ...(m.miTemps ? { miTemps: m.miTemps, detail: true } : {}),
          ...(m.prolongations ? { prolongations: m.prolongations } : {}),
          ...(m.place !== null ? { place: m.place, points: m.points } : {}),
          ...(m.classement.length ? { classement: m.classement } : {}),
        }))
      : [{}],
  );
  const [forfait, setForfait] = useState<'' | 'pour' | 'contre'>(existant?.forfait ?? '');
  const [placeFinale, setPlaceFinale] = useState(existant?.systeme === 'classement' && existant.place ? String(existant.place) : '');
  const [participants, setParticipants] = useState(existant?.participants ? String(existant.participants) : '');
  const [joueurs, setJoueurs] = useState<Record<string, Joueur>>(() =>
    Object.fromEntries((existant?.joueurs ?? []).filter(j => j.compte).map(j => [j.compte!, { personnages: j.personnages.map(p => p.cle ?? p.nom), stats: statsEnTexte(j.stats) }])),
  );
  const [mvp, setMvp] = useState<string>(existant?.mvp?.compte ?? '');
  const [reviewId, setReviewId] = useState<string>(existant?.reviewId ?? '');
  const [visibilite, setVisibilite] = useState<'team' | 'staff'>(existant?.visibilite ?? 'team');
  const [publiable, setPubliable] = useState<boolean | null>(existant ? existant.publiable : null);
  const [notes, setNotes] = useState(existant?.notes ?? '');

  const jeu = f?.jeu;
  const matchChoisi = f?.matchsTournoi.find(m => m.id === match) ?? null;
  const formatEffectif = jeu?.formats.find(x => x.cle === (formatCle || matchChoisi?.formatCle || '')) ?? jeu?.formats[0] ?? null;
  const systeme = jeu ? systemeDe(formatEffectif, jeu.score, jeu.systeme) : 'serie';
  const boPermis = formatEffectif?.bo ?? [1, 3, 5];
  const boEffectif = bo ?? matchChoisi?.bo ?? boPermis[0] ?? 1;
  const score = jeu?.score ?? null;
  const ot = Boolean(score?.prolongations?.active);
  const maxAdv = systeme === 'classement' ? Math.max(1, (formatEffectif?.equipes ?? 64) - 1) : 1;
  const joueursMax = formatEffectif ? formatEffectif.joueursParEquipe + (jeu?.roster?.remplacants ?? 0) : 12;
  const apercu = systeme === 'serie' && !forfait ? apercuSerie(manches, boEffectif, score) : null;
  const cartes = useMemo(() => (jeu?.cartes ?? []).filter(c => c.actif || manches.some(m => m.carteCle === c.cle)), [jeu, manches]);
  const personnages = useMemo(() => (jeu?.personnages ?? []).filter(p => p.actif), [jeu]);
  const publiableEffectif = visibilite === 'staff' ? false : (publiable ?? (lien === 'match' ? true : genre !== 'scrim'));

  // Lien choisi : la date, le BO, le format et les adversaires viennent du match ou de l'événement.
  const choisirMatch = (id: string) => {
    setMatch(id);
    const m = f?.matchsTournoi.find(x => x.id === id);
    if (!m) return;
    if (m.debut) {
      const w = murale(m.debut, fuseau);
      setDate(w.date);
      setHeure(w.heure);
    }
    if (m.bo) setBo(m.bo);
    if (m.formatCle) setFormatCle(m.formatCle);
    setAdversaires(m.adversaires.map(a => (a.id ? { id: a.id } : { nom: a.nom })));
  };
  const choisirEvenement = (id: string) => {
    setEvenement(id);
    const e = f?.evenements.find(x => x.id === id);
    if (!e) return;
    const w = murale(e.debut, fuseau);
    setDate(w.date);
    setHeure(w.heure);
    setGenre(e.type === 'scrim' ? 'scrim' : 'officiel');
    if (e.adversaireId) setAdversaires([{ id: e.adversaireId }]);
  };
  useEffect(() => {
    if (matchId && f && !existant) choisirMatch(matchId);
    // Une seule fois, quand le formulaire arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f]);

  const majManche = (i: number, m: Partial<MancheUi>) => setManches(ms => ms.map((x, j) => (j === i ? { ...x, ...m } : x)));
  const corps = (): SaisieResultat => ({
    ...(lien === 'match' && match ? { tournoiMatchId: match } : { tournoiMatchId: null, tournoiId: null, genre }),
    ...(lien === 'evenement' && evenement ? { evenementId: evenement } : { evenementId: null }),
    ...(date.trim() ? { date: instantSaisi(date, heure) ?? undefined } : {}),
    ...(formatCle ? { formatCle } : {}),
    ...(systeme === 'serie' ? { bo: boEffectif } : {}),
    adversaires,
    manches: forfait
      ? []
      : manches.map(({ detail, ...m }) => {
          const base = { ...(m.carteCle ? { carteCle: m.carteCle } : {}), ...(m.carteNom ? { carteNom: m.carteNom } : {}), ...(m.modeCle ? { modeCle: m.modeCle } : {}) };
          if (systeme === 'classement') return { ...base, place: m.place ?? '', ...(m.points !== undefined && m.points !== null && m.points !== '' ? { points: m.points } : {}), ...(m.classement ? { classement: m.classement } : {}) };
          if (detail && score?.type === 'rounds') return { ...base, miTemps: (m.miTemps ?? [[0, 0], [0, 0]]) as Array<[number, number]>, ...(m.prolongations && (m.prolongations[0] || m.prolongations[1]) ? { prolongations: m.prolongations } : {}) };
          const avecScore = enTexte(m.nous) !== '' && enTexte(m.eux) !== '';
          return { ...base, ...(avecScore ? { nous: m.nous, eux: m.eux } : {}), ...(!avecScore && m.issue ? { issue: m.issue } : {}) };
        }),
    forfait: forfait || null,
    ...(systeme === 'classement' ? { placeFinale: placeFinale.trim() ? Number(placeFinale) : null, participants: participants.trim() ? Number(participants) : null } : {}),
    joueurs: Object.entries(joueurs).map(([compte, j]) => ({ compte, personnages: j.personnages, stats: lireStatsTexte(j.stats) })),
    mvp: mvp && joueurs[mvp] ? mvp : null,
    reviewId: reviewId || null,
    visibilite,
    publiable: publiableEffectif,
    notes,
  });

  const champScore = (i: number, m: MancheUi, cote: 'nous' | 'eux') => (
    <Champ theme={theme} libelle={cote === 'nous' ? trC('f.nous') : trC('f.eux')} valeur={enTexte(m[cote])} onChanger={v => majManche(i, { [cote]: nombreOuVide(v) })} clavier="number-pad" maxLength={7} testID={`esport-resultat-manche-${i}-${cote}`} style={{ width: 100 }} />
  );
  const champMiTemps = (i: number, m: MancheUi, h: 0 | 1, cote: 0 | 1) => {
    const mt = (m.miTemps ?? [[0, 0], [0, 0]]) as Array<[number, number]>;
    return (
      <Champ
        theme={theme}
        libelle={trC(cote === 0 ? 'f.mi_temps_nous' : 'f.mi_temps_eux', { n: h + 1 })}
        valeur={enTexte(mt[h]?.[cote])}
        onChanger={v => {
          const copie = mt.map(x => [...x]) as Array<[number, number]>;
          copie[h][cote] = Number(v) || 0;
          majManche(i, { miTemps: copie });
        }}
        clavier="number-pad"
        maxLength={3}
        testID={`esport-resultat-manche-${i}-mt${h}-${cote}`}
        style={{ width: 120 }}
      />
    );
  };
  const champOt = (i: number, m: MancheUi, cote: 0 | 1) => {
    const p = m.prolongations ?? [0, 0];
    return (
      <Champ
        theme={theme}
        libelle={trC(cote === 0 ? 'f.prol_nous' : 'f.prol_eux')}
        valeur={enTexte(p[cote])}
        onChanger={v => {
          const copie: [number, number] = [p[0], p[1]];
          copie[cote] = Number(v) || 0;
          majManche(i, { prolongations: copie });
        }}
        clavier="number-pad"
        maxLength={3}
        testID={`esport-resultat-manche-${i}-ot-${cote}`}
        style={{ width: 120 }}
      />
    );
  };

  return (
    <Volet theme={theme} visible titre={existant ? trC('f.modifier_titre') : trC('f.titre')} onFermer={onFermer} testID="esport-resultat-formulaire" largeur={large ? 720 : 560}>
      <Retours theme={theme} erreur={erreur} prefixe="esport-resultat-formulaire" />
      {!f || !jeu ? null : (
        <>
          <Text style={attenue(theme, 13)} testID="esport-resultat-regle">
            {[jeu.nom, formatEffectif?.libelle, trC(`f.systeme.${systeme}` as 'f.systeme.serie'), score ? trC(`f.score.${score.type}` as 'f.score.rounds', { rg: score.roundsGagnants ?? '', rpm: score.roundsParMiTemps ?? '', mg: score.manchesGagnantes ?? '', pc: score.pointsCible ?? '' }) : null, ot ? trC('f.avec_prolongations', { ecart: score?.prolongations?.ecart ?? 2 }) : null].filter(Boolean).join(' · ')}
          </Text>
          <Choix<Lien>
            theme={theme}
            libelle={trC('f.lien')}
            valeur={lien}
            options={[{ id: 'sans', nom: trC('f.lien.aucun') }, ...(f.matchsTournoi.length || lien === 'match' ? [{ id: 'match' as const, nom: trC('f.lien.match') }] : []), ...(f.evenements.length || lien === 'evenement' ? [{ id: 'evenement' as const, nom: trC('f.lien.evenement') }] : [])]}
            onChoisir={setLien}
            testID="esport-resultat-lien"
          />
          {lien === 'match' ? (
            <Choix<string> theme={theme} libelle={trC('f.match_tournoi')} valeur={match} options={[...(existant?.tournoiMatchId && !f.matchsTournoi.some(m => m.id === existant.tournoiMatchId) ? [{ id: existant.tournoiMatchId, nom: [existant.tournoi?.nom, existant.tour].filter(Boolean).join(' · ') || trC('f.match_actuel') }] : []), ...f.matchsTournoi.map(m => ({ id: m.id, nom: [m.tournoi.nom, m.tour, m.adversaires.map(a => a.nom).join(', ')].filter(Boolean).join(' · ') }))]} onChoisir={choisirMatch} testID="esport-resultat-match" />
          ) : null}
          {lien === 'evenement' ? <Choix<string> theme={theme} libelle={trC('f.evenement')} valeur={evenement} options={f.evenements.map(e => ({ id: e.id, nom: `${e.titre} · ${murale(e.debut, fuseau).date}` }))} onChoisir={choisirEvenement} testID="esport-resultat-evenement" /> : null}
          {lien !== 'match' ? <Choix<GenreResultat> theme={theme} libelle={trC('f.genre')} valeur={genre} options={(['officiel', 'scrim'] as const).map(g => ({ id: g, nom: trC(`r.genre.${g}` as 'r.genre.officiel') }))} onChoisir={setGenre} testID="esport-resultat-genre" /> : null}
          <View style={[styles.ligne, { gap: ESP.s }]}>
            <Champ theme={theme} libelle={trC('f.date')} valeur={date} onChanger={setDate} maxLength={10} placeholder="2026-10-24" testID="esport-resultat-date" style={{ width: 150 }} />
            <Champ theme={theme} libelle={trC('f.heure')} valeur={heure} onChanger={setHeure} maxLength={5} placeholder="20:00" testID="esport-resultat-heure" style={{ width: 110 }} />
          </View>
          {jeu.formats.length > 1 ? <Choix<string> theme={theme} libelle={trC('f.format')} valeur={formatEffectif?.cle ?? ''} options={jeu.formats.map(x => ({ id: x.cle, nom: x.nom === x.libelle ? x.nom : `${x.nom} (${x.libelle})` }))} onChoisir={setFormatCle} testID="esport-resultat-format" /> : null}
          {systeme === 'serie' && boPermis.length > 1 ? <Choix<string> theme={theme} libelle={trC('f.bo')} valeur={String(boEffectif)} options={boPermis.map(b => ({ id: String(b), nom: `BO${b}` }))} onChoisir={v => setBo(Number(v))} testID="esport-resultat-bo" /> : null}
          <ChoixAdversaires
            theme={theme}
            fiches={f.adversaires}
            valeur={adversaires}
            max={maxAdv}
            onChanger={setAdversaires}
            onCreer={
              f.droits.adversaireRapide
                ? async nom => {
                    const r = await api.creerAdversaire(teamId, nom);
                    setF(x => (x && !x.adversaires.some(a => a.id === r.adversaire.id) ? { ...x, adversaires: [...x.adversaires, r.adversaire] } : x));
                    return r.adversaire;
                  }
                : undefined
            }
            testID="esport-resultat-adversaires"
          />
          {systeme === 'serie' ? <Choix<'' | 'pour' | 'contre'> theme={theme} libelle={trC('f.forfait')} valeur={forfait} options={[{ id: '', nom: trC('f.forfait.non') }, { id: 'pour', nom: trC('f.forfait.pour') }, { id: 'contre', nom: trC('f.forfait.contre') }]} onChoisir={setForfait} testID="esport-resultat-forfait" /> : null}

          {!forfait ? (
            <View style={{ gap: ESP.s }} testID="esport-resultat-manches-saisie">
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: ESP.s, flexWrap: 'wrap' }}>
                <Text style={{ ...texte(theme, 15), fontWeight: '800' }}>{systeme === 'classement' ? trC('f.manches_classement') : trC('f.manches')}</Text>
                {apercu ? <Badge theme={theme} ton={apercu.issue === 'victoire' ? 'ok' : apercu.issue === 'defaite' ? 'critique' : 'neutre'} texte={apercu.issue ? `${nomIssue(apercu.issue)} ${apercu.nous}-${apercu.eux}` : trC('f.apercu_en_cours', { nous: apercu.nous, eux: apercu.eux })} testID="esport-resultat-apercu" /> : null}
              </View>
              {manches.map((m, i) => (
                <Panneau key={i} theme={theme} testID={`esport-resultat-manche-${i}`}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{trC('f.manche_n', { n: i + 1 })}</Text>
                    {systeme === 'serie' && issueManche(m) ? <Badge theme={theme} ton={issueManche(m) === 'victoire' ? 'ok' : issueManche(m) === 'defaite' ? 'critique' : 'neutre'} texte={nomIssue(issueManche(m) as Issue)} /> : null}
                  </View>
                  {cartes.length ? (
                    <Choix<string> theme={theme} libelle={jeu.libelles.cartes ?? trC('f.carte')} valeur={m.carteCle ?? ''} options={[{ id: '', nom: trC('f.carte_aucune') }, ...cartes.map(c => ({ id: c.cle, nom: c.nom }))]} onChoisir={v => majManche(i, { carteCle: v || null })} testID={`esport-resultat-manche-${i}-carte`} />
                  ) : (
                    <Champ theme={theme} libelle={trC('f.carte')} valeur={m.carteNom ?? ''} onChanger={v => majManche(i, { carteNom: v })} maxLength={40} testID={`esport-resultat-manche-${i}-carte-nom`} />
                  )}
                  {jeu.modes.length > 1 ? <Choix<string> theme={theme} libelle={trC('f.mode')} valeur={m.modeCle ?? ''} options={[{ id: '', nom: trC('f.mode_aucun') }, ...jeu.modes.filter(x => x.actif || x.cle === m.modeCle).map(x => ({ id: x.cle, nom: x.nom }))]} onChoisir={v => majManche(i, { modeCle: v || null })} testID={`esport-resultat-manche-${i}-mode`} /> : null}
                  {systeme === 'classement' ? (
                    <View style={[styles.ligne, { gap: ESP.s }]}>
                      <Champ theme={theme} libelle={trC('f.place')} valeur={enTexte(m.place)} onChanger={v => majManche(i, { place: nombreOuVide(v) })} clavier="number-pad" maxLength={3} testID={`esport-resultat-manche-${i}-place`} style={{ width: 100 }} />
                      <Champ theme={theme} libelle={trC('f.points')} valeur={enTexte(m.points)} onChanger={v => majManche(i, { points: nombreOuVide(v) })} maxLength={7} placeholder={enTexte(pointsBareme(score, typeof m.place === 'number' ? m.place : null))} testID={`esport-resultat-manche-${i}-points`} style={{ width: 120 }} />
                    </View>
                  ) : score?.type === 'manches' ? (
                    <View style={{ gap: ESP.xs }}>
                      <Choix<Issue> theme={theme} libelle={trC('f.issue')} valeur={(m.issue ?? issueManche(m) ?? undefined) as Issue} options={(['victoire', 'defaite', 'nul'] as const).map(x => ({ id: x, nom: nomIssue(x) }))} onChoisir={v => majManche(i, { issue: v, nous: '', eux: '' })} testID={`esport-resultat-manche-${i}-issue`} />
                      <View style={[styles.ligne, { gap: ESP.s }]}>
                        {champScore(i, m, 'nous')}
                        {champScore(i, m, 'eux')}
                      </View>
                    </View>
                  ) : m.detail && score?.type === 'rounds' ? (
                    <View style={{ gap: ESP.xs }}>
                      <View style={[styles.ligne, { gap: ESP.s }]}>
                        {champMiTemps(i, m, 0, 0)}
                        {champMiTemps(i, m, 0, 1)}
                        {champMiTemps(i, m, 1, 0)}
                        {champMiTemps(i, m, 1, 1)}
                      </View>
                      {ot ? (
                        <View style={[styles.ligne, { gap: ESP.s }]}>
                          {champOt(i, m, 0)}
                          {champOt(i, m, 1)}
                        </View>
                      ) : null}
                    </View>
                  ) : (
                    <View style={[styles.ligne, { gap: ESP.s }]}>
                      {champScore(i, m, 'nous')}
                      {champScore(i, m, 'eux')}
                    </View>
                  )}
                  <View style={[styles.ligne, { gap: ESP.xs }]}>
                    {systeme === 'serie' && score?.type === 'rounds' ? <BoutonHub theme={theme} titre={m.detail ? trC('f.score_total') : trC('f.detail_mi_temps')} onPress={() => majManche(i, { detail: !m.detail })} testID={`esport-resultat-manche-${i}-detail`} /> : null}
                    {manches.length > 1 ? <BoutonHub theme={theme} titre={trC('f.retirer_manche')} onPress={() => setManches(ms => ms.filter((_, j) => j !== i))} testID={`esport-resultat-manche-${i}-retirer`} /> : null}
                  </View>
                </Panneau>
              ))}
              {(systeme === 'serie' ? manches.length < boEffectif : manches.length < 20) ? (
                <View style={{ alignSelf: 'flex-start' }}>
                  <BoutonHub theme={theme} titre={trC('f.ajouter_manche')} onPress={() => setManches(ms => [...ms, {}])} testID="esport-resultat-ajouter-manche" />
                </View>
              ) : null}
              {systeme === 'classement' ? (
                <View style={[styles.ligne, { gap: ESP.s }]}>
                  <Champ theme={theme} libelle={trC('f.place_finale')} valeur={placeFinale} onChanger={setPlaceFinale} clavier="number-pad" maxLength={5} testID="esport-resultat-place-finale" style={{ width: 150 }} />
                  <Champ theme={theme} libelle={trC('f.participants')} valeur={participants} onChanger={setParticipants} clavier="number-pad" maxLength={6} testID="esport-resultat-participants" style={{ width: 150 }} />
                </View>
              ) : null}
              {systeme === 'classement' ? <Text style={attenue(theme, 12)}>{trC('f.place_finale_aide')}</Text> : null}
            </View>
          ) : null}

          <View style={{ gap: ESP.xs }} testID="esport-resultat-joueurs-saisie">
            <Text style={{ ...texte(theme, 15), fontWeight: '800' }}>{trC('f.joueurs', { n: Object.keys(joueurs).length, max: joueursMax })}</Text>
            <View style={[styles.ligne, { gap: ESP.xxs }]}>
              {f.membres.map(m => (
                <Pastille
                  key={m.compte}
                  theme={theme}
                  libelle={m.pseudo}
                  actif={Boolean(joueurs[m.compte])}
                  onPress={() =>
                    setJoueurs(j => {
                      if (j[m.compte]) return Object.fromEntries(Object.entries(j).filter(([c]) => c !== m.compte));
                      return Object.keys(j).length >= joueursMax ? j : { ...j, [m.compte]: { personnages: [], stats: '' } };
                    })
                  }
                  testID={`esport-resultat-joueur-${m.compte}`}
                />
              ))}
            </View>
            {Object.entries(joueurs).map(([compte, j]) => {
              const pseudo = f.membres.find(m => m.compte === compte)?.pseudo ?? compte;
              const maj = (x: Partial<Joueur>) => setJoueurs(js => ({ ...js, [compte]: { ...js[compte], ...x } }));
              return (
                <Panneau key={compte} theme={theme} testID={`esport-resultat-ligne-${compte}`}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: ESP.s, flexWrap: 'wrap' }}>
                    <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{pseudo}</Text>
                    <View style={[styles.ligne, { gap: ESP.xs }]}>
                      <Pastille theme={theme} libelle={trC('f.mvp')} actif={mvp === compte} onPress={() => setMvp(v => (v === compte ? '' : compte))} testID={`esport-resultat-mvp-${compte}`} />
                      {personnages.length ? <BoutonHub theme={theme} titre={j.ouvert ? trC('f.fermer') : j.personnages.length ? trC('f.persos_n', { n: j.personnages.length }) : (jeu.libelles.personnages ?? trC('f.personnages'))} onPress={() => maj({ ouvert: !j.ouvert })} testID={`esport-resultat-persos-${compte}`} /> : null}
                    </View>
                  </View>
                  {j.personnages.length && !j.ouvert ? <Text style={attenue(theme, 12)}>{j.personnages.map(p => personnages.find(x => x.cle === p)?.nom ?? p).join(', ')}</Text> : null}
                  {j.ouvert ? (
                    <View style={[styles.ligne, { gap: ESP.xxs }]}>
                      {personnages.map(p => (
                        <Pastille key={p.cle} theme={theme} libelle={p.nom} actif={j.personnages.includes(p.cle)} onPress={() => maj({ personnages: j.personnages.includes(p.cle) ? j.personnages.filter(x => x !== p.cle) : [...j.personnages, p.cle].slice(0, 5) })} testID={`esport-resultat-perso-${compte}-${p.cle}`} />
                      ))}
                    </View>
                  ) : null}
                  {!personnages.length ? <Champ theme={theme} libelle={trC('f.personnages_libres')} valeur={j.personnages.join(', ')} onChanger={v => maj({ personnages: v.split(',').map(x => x.trim()).filter(Boolean).slice(0, 5) })} maxLength={120} testID={`esport-resultat-persos-libres-${compte}`} /> : null}
                  <Champ theme={theme} libelle={trC('f.stats')} valeur={j.stats} onChanger={v => maj({ stats: v })} maxLength={300} placeholder={trC('f.stats_exemple')} testID={`esport-resultat-stats-${compte}`} />
                </Panneau>
              );
            })}
          </View>

          {f.reviews.length ? <Choix<string> theme={theme} libelle={trC('f.review')} valeur={reviewId} options={[{ id: '', nom: trC('f.review_aucune') }, ...f.reviews.slice(0, 20).map(r => ({ id: r.id, nom: r.titre }))]} onChoisir={setReviewId} testID="esport-resultat-review" /> : null}
          <Choix<'team' | 'staff'> theme={theme} libelle={trC('f.visibilite')} valeur={visibilite} options={[{ id: 'team', nom: trC('f.visibilite.team') }, { id: 'staff', nom: trC('f.visibilite.staff') }]} onChoisir={setVisibilite} testID="esport-resultat-visibilite" />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s }}>
            <Interrupteur theme={theme} libelle={trC('f.publiable')} valeur={publiableEffectif} desactive={visibilite === 'staff'} onChanger={setPubliable} testID="esport-resultat-publiable" />
            <View style={{ flex: 1 }}>
              <Text style={texte(theme, 14)}>{trC('f.publiable')}</Text>
              <Text style={attenue(theme, 12)}>{visibilite === 'staff' ? trC('f.publiable_staff') : trC('f.publiable_aide')}</Text>
            </View>
          </View>
          <Champ theme={theme} libelle={trC('f.notes')} valeur={notes} onChanger={setNotes} multiligne maxLength={4000} testID="esport-resultat-notes" />
          <View style={{ alignSelf: 'flex-start' }}>
            <BoutonHub
              theme={theme}
              titre={trC('f.enregistrer')}
              variante="plein"
              desactive={Boolean(enCours)}
              onPress={() =>
                void agir('enregistrer', async () => {
                  try {
                    const r = existant ? await api.modifierResultat(teamId, existant.id, corps()) : await api.creerResultat(teamId, corps());
                    onEnregistre(r.resultat.id);
                  } catch (e) {
                    throw new Error(messageErreur(e));
                  }
                })
              }
              testID="esport-resultat-enregistrer"
            />
          </View>
        </>
      )}
    </Volet>
  );
}
