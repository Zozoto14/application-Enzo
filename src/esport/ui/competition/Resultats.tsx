/**
 * Module « Résultats » (section Compétition) : historique filtrable (jeu, tournoi, adversaire, période,
 * map, type de match), bilans (taux de victoire global, par map, par adversaire, séries, forme,
 * classements), détail d'un résultat (maps et manches, mi-temps et prolongations, joueurs, MVP, review)
 * et vue par adversaire reliée au scouting. Saisie : FormulaireResultat.tsx, selon le profil du jeu.
 */

import { useCible } from '../notifications/Cible';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub } from '../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { apiCompetition, GENRES_RESULTAT, type ApiCompetition, type Bilan, type FiltresResultats, type GenreResultat, type Issue, type ListeResultats, type Resultat, type VueAdversaire } from '../../competition/api';
import { prendre } from '../../competition/intention';
import { lettreForme, nomIssue, ordinal } from '../../competition/libelles';
import { formaterDate } from '../../i18n';
import { trC, trnC } from '../../i18n/competition';
import { BoutonConfirme, Choix, Panneau, Retours, styles, useAgir } from '../commun';
import { Badge, Carte, ChiffreCle, ESP, EnTetePage, EtatVide, Onglets, Pliable, SqueletteCartes, TitreCarte, Volet, attenue, texte } from '../design';
import type { PropsModule } from '../modules';
import { BadgeResultat, LogoAdversaire, nomsAdversaires } from './commun';
import { FormulaireResultat } from './FormulaireResultat';
import { useTempsReel } from '../../tempsReel/hooks';
import { ChampPeriode } from '../../../ui/dates';

type Onglet = 'historique' | 'bilans';
const quand = (iso: string, fuseau: string): string => formaterDate(iso, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: fuseau });

export function Resultats({ theme, client, detail, large, onAller }: PropsModule) {
  const teamId = detail.team.id;
  const fuseau = detail.team.fuseau;
  const api = useMemo(() => apiCompetition(client), [client]);
  const [liste, setListe] = useState<ListeResultats | undefined>();
  const [filtres, setFiltres] = useState<FiltresResultats>({});
  const [du, setDu] = useState('');
  const [au, setAu] = useState('');
  const [onglet, setOnglet] = useState<Onglet>('historique');
  const [ouvert, setOuvert] = useState<string | undefined>(() => prendre(teamId, 'resultat')?.id);
  // Lien direct d'une notification : l'élément visé s'ouvre.
  useCible('resultats', c => {
    if (c.g === 'resultat' && typeof c.resultat === 'string') setOuvert(c.resultat);
  });
  const [adversaire, setAdversaire] = useState<string | undefined>();
  const [edition, setEdition] = useState<{ resultat?: Resultat; matchId?: string } | null>(() => {
    const i = prendre(teamId, 'resultat-match');
    return i ? { matchId: i.matchId } : null;
  });
  const { erreur, avis, agir } = useAgir();
  const recharger = useCallback(async () => setListe(await api.resultats(teamId, filtres)), [api, teamId, filtres]);
  useEffect(() => {
    void agir('', recharger);
  }, [agir, recharger]);
  useTempsReel(client, `team:${teamId}:resultats`, () => void recharger().catch(() => undefined));
  const b = liste?.bilan;
  const saisir = Boolean(liste?.droits.saisir);
  const resume = [
    filtres.genre ? trC(`r.genre.${filtres.genre}` as 'r.genre.tournoi') : '',
    filtres.tournoi ? (liste?.filtres.tournois.find(x => x.id === filtres.tournoi)?.nom ?? '') : '',
    filtres.adversaire ? (liste?.filtres.adversaires.find(x => x.id === filtres.adversaire)?.nom ?? '') : '',
    filtres.carte ? (liste?.filtres.cartes.find(x => x.cle === filtres.carte)?.nom ?? filtres.carte) : '',
    filtres.issue ? nomIssue(filtres.issue) : '',
    filtres.du || filtres.au ? `${filtres.du ?? '…'} → ${filtres.au ?? '…'}` : '',
  ].filter(Boolean);
  return (
    <View style={{ gap: ESP.l }} testID="esport-resultats">
      <EnTetePage
        theme={theme}
        large={large}
        titre={trC('r.titre')}
        sous={trC('r.sous')}
        action={saisir ? <BoutonHub theme={theme} titre={trC('r.saisir')} variante="plein" onPress={() => setEdition({})} testID="esport-resultats-saisir" /> : undefined}
      />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-resultats" />
      {b ? (
        <View style={[styles.ligne, { gap: ESP.s }]} testID="esport-resultats-chiffres">
          <ChiffreCle theme={theme} large={large} glyphe="%" libelle={trC('r.taux')} valeur={b.series.taux === null ? trC('r.pas_de_match') : `${b.series.taux} %`} detail={trC('r.vdn', { v: b.series.victoires, d: b.series.defaites, n: b.series.nuls })} ton={b.series.taux === null ? 'neutre' : b.series.taux >= 50 ? 'ok' : 'alerte'} testIDValeur="esport-resultats-taux" />
          <ChiffreCle theme={theme} large={large} glyphe="↗︎" libelle={trC('r.serie_en_cours')} valeur={b.enCours ? trnC(`r.serie.${b.enCours.issue}` as 'r.serie.victoire', b.enCours.n) : trC('r.aucune')} detail={trC('r.records', { v: b.recordVictoires, d: b.recordDefaites })} testIDValeur="esport-resultats-serie" />
          <ChiffreCle theme={theme} large={large} glyphe="★" libelle={trC('r.forme')} valeur={b.forme.length ? b.forme.map(lettreForme).join(' ') : trC('r.aucune')} detail={trC('r.forme_aide')} testIDValeur="esport-resultats-forme" />
          {b.classements.joues ? (
            <ChiffreCle theme={theme} large={large} glyphe="#" libelle={trC('r.classements')} valeur={trC('r.place_moyenne', { place: String(b.classements.placeMoyenne ?? '') })} detail={trC('r.tops', { top1: b.classements.top1, top3: b.classements.top3, n: b.classements.joues })} testIDValeur="esport-resultats-classements" />
          ) : null}
        </View>
      ) : null}
      <Pliable theme={theme} titre={trC('r.filtres')} resume={resume.join(' · ') || trC('r.filtre_aucun')} testID="esport-resultats-filtres-ouvrir">
        <Panneau theme={theme} testID="esport-resultats-filtres">
          <Choix<GenreResultat | ''> theme={theme} libelle={trC('r.champ.genre')} valeur={filtres.genre ?? ''} options={[{ id: '', nom: trC('r.tous') }, ...GENRES_RESULTAT.map(g => ({ id: g, nom: trC(`r.genre.${g}` as 'r.genre.tournoi') }))]} onChoisir={v => setFiltres(f => ({ ...f, genre: v || undefined }))} testID="esport-resultats-filtre-genre" />
          {liste?.filtres.tournois.length ? <Choix<string> theme={theme} libelle={trC('r.champ.tournoi')} valeur={filtres.tournoi ?? ''} options={[{ id: '', nom: trC('r.tous') }, ...liste.filtres.tournois.map(x => ({ id: x.id, nom: x.nom }))]} onChoisir={v => setFiltres(f => ({ ...f, tournoi: v || undefined }))} testID="esport-resultats-filtre-tournoi" /> : null}
          {liste?.filtres.adversaires.length ? <Choix<string> theme={theme} libelle={trC('r.champ.adversaire')} valeur={filtres.adversaire ?? ''} options={[{ id: '', nom: trC('r.tous') }, ...liste.filtres.adversaires.map(x => ({ id: x.id, nom: x.nom }))]} onChoisir={v => setFiltres(f => ({ ...f, adversaire: v || undefined }))} testID="esport-resultats-filtre-adversaire" /> : null}
          {liste?.filtres.cartes.length ? <Choix<string> theme={theme} libelle={trC('r.champ.carte')} valeur={filtres.carte ?? ''} options={[{ id: '', nom: trC('r.toutes') }, ...liste.filtres.cartes.map(x => ({ id: x.cle, nom: x.nom }))]} onChoisir={v => setFiltres(f => ({ ...f, carte: v || undefined }))} testID="esport-resultats-filtre-carte" /> : null}
          {liste && liste.filtres.jeux.length > 1 ? <Choix<string> theme={theme} libelle={trC('r.champ.jeu')} valeur={filtres.jeu ?? ''} options={[{ id: '', nom: trC('r.tous') }, ...liste.filtres.jeux.map(x => ({ id: x.cle, nom: x.nom }))]} onChoisir={v => setFiltres(f => ({ ...f, jeu: v || undefined }))} testID="esport-resultats-filtre-jeu" /> : null}
          <Choix<Issue | ''> theme={theme} libelle={trC('r.champ.issue')} valeur={filtres.issue ?? ''} options={[{ id: '', nom: trC('r.tous') }, { id: 'victoire', nom: nomIssue('victoire') }, { id: 'defaite', nom: nomIssue('defaite') }, { id: 'nul', nom: nomIssue('nul') }]} onChoisir={v => setFiltres(f => ({ ...f, issue: v || undefined }))} testID="esport-resultats-filtre-issue" />
          <View style={[styles.ligne, { gap: ESP.s, alignItems: 'flex-end' }]}>
            <ChampPeriode theme={theme} libelleDu={trC('r.champ.du')} libelleAu={trC('r.champ.au')} du={du} au={au} onDu={setDu} onAu={setAu} testIDDu="esport-resultats-du" testIDAu="esport-resultats-au" style={{ flexGrow: 1, flexBasis: 360 }} styleChamp={{ maxWidth: 220 }} />
            <BoutonHub theme={theme} titre={trC('r.appliquer')} onPress={() => setFiltres(f => ({ ...f, du: du.trim() || undefined, au: au.trim() || undefined }))} testID="esport-resultats-periode" />
            <BoutonHub
              theme={theme}
              titre={trC('r.effacer')}
              onPress={() => {
                setDu('');
                setAu('');
                setFiltres({});
              }}
              testID="esport-resultats-effacer"
            />
          </View>
        </Panneau>
      </Pliable>
      <Onglets
        theme={theme}
        prefixe="esport-resultats-onglet"
        testID="esport-resultats-onglets"
        actif={onglet}
        onChoisir={id => setOnglet(id as Onglet)}
        pleineLargeur={!large}
        entrees={[
          { id: 'historique', libelle: liste ? trC('r.onglet.historique_n', { n: liste.total }) : trC('r.onglet.historique') },
          { id: 'bilans', libelle: trC('r.onglet.bilans') },
        ]}
      />
      {!liste && !erreur ? <SqueletteCartes theme={theme} n={2} large={large} /> : null}
      {liste && onglet === 'historique' ? (
        liste.resultats.length === 0 ? (
          <Carte theme={theme} testID="esport-resultats-vide">
            <EtatVide theme={theme} glyphe="drapeau" titre={resume.length ? trC('r.vide.filtres') : trC('r.vide.titre')} texte={saisir && !resume.length ? trC('r.vide.texte_saisir') : undefined} action={saisir && !resume.length ? { titre: trC('r.saisir'), onPress: () => setEdition({}), testID: 'esport-resultats-vide-saisir' } : undefined} />
          </Carte>
        ) : (
          <View style={{ gap: ESP.s }} testID="esport-resultats-liste">
            {liste.resultats.map(r => (
              <CarteResultat key={r.id} theme={theme} r={r} fuseau={fuseau} onOuvrir={() => setOuvert(r.id)} />
            ))}
            {liste.total > liste.resultats.length ? <Text style={attenue(theme)}>{trC('r.plus', { n: liste.total - liste.resultats.length })}</Text> : null}
          </View>
        )
      ) : null}
      {liste && onglet === 'bilans' && b ? <Bilans theme={theme} b={b} large={large} onAdversaire={id => setAdversaire(id)} /> : null}
      {ouvert ? (
        <DetailResultat
          theme={theme}
          api={api}
          teamId={teamId}
          id={ouvert}
          fuseau={fuseau}
          large={large}
          onFermer={() => setOuvert(undefined)}
          onModifier={r => {
            setOuvert(undefined);
            setEdition({ resultat: r });
          }}
          onSupprime={() => {
            setOuvert(undefined);
            void recharger();
          }}
          onAdversaire={id => {
            setOuvert(undefined);
            setAdversaire(id);
          }}
          onReview={id => onAller('module:video_review', undefined, id)}
        />
      ) : null}
      {adversaire ? (
        <FicheAdversaire
          theme={theme}
          api={api}
          teamId={teamId}
          id={adversaire}
          fuseau={fuseau}
          large={large}
          onFermer={() => setAdversaire(undefined)}
          onResultat={id => {
            setAdversaire(undefined);
            setOuvert(id);
          }}
          onScouting={() => onAller('module:scouting')}
        />
      ) : null}
      {edition ? (
        <FormulaireResultat
          theme={theme}
          api={api}
          teamId={teamId}
          fuseau={fuseau}
          large={large}
          existant={edition.resultat}
          matchId={edition.matchId}
          onFermer={() => setEdition(null)}
          onEnregistre={id => {
            setEdition(null);
            void recharger();
            setOuvert(id);
          }}
        />
      ) : null}
    </View>
  );
}

export function CarteResultat({ theme, r, fuseau, onOuvrir }: { theme: ThemeHub; r: Resultat; fuseau: string; onOuvrir(): void }) {
  const adv = r.adversaires;
  const cartes = r.manches.map(m => [m.carte?.nom, m.nous !== null && m.eux !== null ? `${m.nous}-${m.eux}` : m.place ? `#${m.place}` : ''].filter(Boolean).join(' ')).filter(Boolean);
  return (
    <Carte theme={theme} dense onPress={onOuvrir} libelle={trC('r.ouvrir', { adversaire: nomsAdversaires(adv) || trC('r.sans_adversaire') })} testID={`esport-resultat-${r.id}`} accent={r.issue === 'victoire' ? theme.ok : r.issue === 'defaite' ? theme.critique : undefined}>
      <View style={{ flexDirection: 'row', gap: ESP.s, alignItems: 'center', flexWrap: 'wrap' }}>
        {adv[0] ? <LogoAdversaire theme={theme} nom={adv[0].nom} url={adv[0].logoUrl} taille={36} /> : null}
        <View style={{ flex: 1, minWidth: 180, gap: 2 }}>
          <Text style={{ ...texte(theme, 15), fontWeight: '800' }} numberOfLines={2}>
            {nomsAdversaires(adv) || trC('r.sans_adversaire')}
          </Text>
          <Text style={attenue(theme, 12)} numberOfLines={2}>
            {[quand(r.date, fuseau), r.tournoi ? [r.tournoi.nom, r.tour].filter(Boolean).join(' · ') : trC(`r.genre.${r.genre}` as 'r.genre.tournoi'), r.format ? `${r.format.libelle}${r.systeme === 'serie' && r.bo ? ` · BO${r.bo}` : ''}` : null].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <BadgeResultat theme={theme} issue={r.issue} place={r.place} score={r.score && r.systeme === 'serie' ? r.score : undefined} testID={`esport-resultat-${r.id}-issue`} />
      </View>
      {cartes.length ? <Text style={texte(theme, 13)}>{cartes.join(' · ')}</Text> : null}
      <View style={[styles.ligne, { gap: ESP.xxs }]}>
        {r.visibilite === 'staff' ? <Badge theme={theme} ton="alerte" texte={trC('r.staff')} /> : null}
        {r.mvp ? <Badge theme={theme} texte={trC('r.mvp', { pseudo: r.mvp.pseudo ?? '?' })} /> : null}
        {r.systeme === 'classement' && r.points !== null ? <Badge theme={theme} texte={trC('r.points', { n: r.points })} /> : null}
      </View>
    </Carte>
  );
}

function Barre({ theme, taux }: { theme: ThemeHub; taux: number | null }) {
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: teinteTransparente(theme.critique, 0.25), overflow: 'hidden', flexGrow: 1, minWidth: 60 }} accessibilityLabel={taux === null ? '' : `${taux} %`}>
      <View style={{ width: `${taux ?? 0}%`, height: 8, backgroundColor: theme.ok }} />
    </View>
  );
}

function Bilans({ theme, b, large, onAdversaire }: { theme: ThemeHub; b: Bilan; large: boolean; onAdversaire(id: string): void }) {
  return (
    <View style={large ? { flexDirection: 'row', gap: ESP.l, alignItems: 'flex-start' } : { gap: ESP.m }} testID="esport-resultats-bilans">
      <Carte theme={theme} style={{ flex: large ? 1 : undefined }} testID="esport-bilan-cartes">
        <TitreCarte theme={theme} titre={trC('r.par_carte')} sous={trC('r.par_carte_aide')} />
        {b.parCarte.length === 0 ? <Text style={attenue(theme)}>{trC('r.aucune_carte')}</Text> : null}
        {b.parCarte.map(c => (
          <View key={c.cle ?? c.nom} style={{ gap: 4 }} testID={`esport-bilan-carte-${c.cle ?? c.nom}`}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: ESP.s }}>
              <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{c.nom}</Text>
              <Text style={attenue(theme, 13)}>
                {[c.joues ? trC('r.carte_detail', { taux: c.taux ?? 0, v: c.victoires, n: c.joues }) : null, c.classements.joues ? trC('r.carte_classement', { place: String(c.classements.placeMoyenne ?? ''), n: c.classements.joues }) : null].filter(Boolean).join(' · ')}
              </Text>
            </View>
            {c.joues ? <Barre theme={theme} taux={c.taux} /> : null}
          </View>
        ))}
      </Carte>
      <Carte theme={theme} style={{ flex: large ? 1 : undefined }} testID="esport-bilan-adversaires">
        <TitreCarte theme={theme} titre={trC('r.par_adversaire')} sous={trC('r.par_adversaire_aide')} />
        {b.parAdversaire.length === 0 ? <Text style={attenue(theme)}>{trC('r.aucun_adversaire')}</Text> : null}
        {b.parAdversaire.map(a => (
          <Carte key={a.id ?? a.nom} theme={theme} dense onPress={a.id ? () => onAdversaire(a.id!) : undefined} libelle={trC('r.voir_adversaire', { nom: a.nom })} testID={`esport-bilan-adversaire-${a.id ?? a.nom}`}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: ESP.s, alignItems: 'center' }}>
              <Text style={{ ...texte(theme, 14), fontWeight: '700', flexShrink: 1 }}>{a.nom}</Text>
              <Text style={attenue(theme, 13)}>{trC('r.vdn_taux', { v: a.victoires, d: a.defaites, n: a.nuls, taux: a.taux ?? 0 })}</Text>
            </View>
            <Barre theme={theme} taux={a.taux} />
          </Carte>
        ))}
      </Carte>
    </View>
  );
}

function DetailResultat({
  theme,
  api,
  teamId,
  id,
  fuseau,
  large,
  onFermer,
  onModifier,
  onSupprime,
  onAdversaire,
  onReview,
}: {
  theme: ThemeHub;
  api: ApiCompetition;
  teamId: string;
  id: string;
  fuseau: string;
  large: boolean;
  onFermer(): void;
  onModifier(r: Resultat): void;
  onSupprime(): void;
  onAdversaire(id: string): void;
  onReview(id: string): void;
}) {
  const [d, setD] = useState<{ resultat: Resultat; droits: ListeResultats['droits'] } | undefined>();
  const { erreur, agir } = useAgir();
  useEffect(() => {
    void agir('', async () => setD(await api.resultat(teamId, id)));
  }, [agir, api, teamId, id]);
  const r = d?.resultat;
  return (
    <Volet theme={theme} visible titre={r ? nomsAdversaires(r.adversaires) || trC('r.resultat') : trC('r.resultat')} onFermer={onFermer} testID="esport-resultat-detail" largeur={large ? 680 : 560}>
      <Retours theme={theme} erreur={erreur} prefixe="esport-resultat-detail" />
      {r ? (
        <>
          <View style={[styles.ligne, { gap: ESP.xs, alignItems: 'center' }]}>
            <BadgeResultat theme={theme} issue={r.issue} place={r.place} score={r.systeme === 'serie' ? r.score : undefined} testID="esport-resultat-detail-issue" />
            {r.forfait ? <Badge theme={theme} texte={trC('r.forfait')} /> : null}
            <Badge theme={theme} texte={trC(`r.genre.${r.genre}` as 'r.genre.tournoi')} />
            {r.visibilite === 'staff' ? <Badge theme={theme} ton="alerte" texte={trC('r.staff')} /> : null}
            {!r.publiable ? <Badge theme={theme} texte={trC('r.non_publiable')} /> : null}
          </View>
          <Text style={attenue(theme, 13)}>{[quand(r.date, fuseau), r.tournoi ? [r.tournoi.nom, r.tour].filter(Boolean).join(' · ') : null, r.jeu.nom, r.format?.libelle, r.systeme === 'serie' && r.bo ? `BO${r.bo}` : null].filter(Boolean).join(' · ')}</Text>
          {r.systeme === 'classement' ? <Text style={{ ...texte(theme, 16), fontWeight: '800' }}>{[r.place ? (r.participants ? trC('r.place_sur', { place: ordinal(r.place), n: r.participants }) : ordinal(r.place)) : null, r.points !== null ? trC('r.points', { n: r.points }) : null].filter(Boolean).join(' · ')}</Text> : null}
          <Panneau theme={theme} testID="esport-resultat-manches">
            {r.manches.map(m => (
              <View key={m.numero} style={{ gap: 2 }} testID={`esport-resultat-manche-${m.numero}`}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: ESP.s, flexWrap: 'wrap' }}>
                  <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{[m.carte?.nom ?? trC('r.manche_n', { n: m.numero }), m.mode?.nom].filter(Boolean).join(' · ')}</Text>
                  <Text style={{ ...texte(theme, 14), fontWeight: '800', color: m.issue === 'victoire' ? theme.ok : m.issue === 'defaite' ? theme.critique : theme.texte }}>
                    {r.systeme === 'classement' ? [m.place ? `#${m.place}` : '', m.points !== null ? trC('r.points', { n: m.points }) : ''].filter(Boolean).join(' · ') : m.nous !== null ? `${m.nous}-${m.eux}${m.enProlongations ? ` (${trC('r.prol')})` : ''}` : m.issue ? nomIssue(m.issue) : ''}
                  </Text>
                </View>
                {m.miTemps ? <Text style={attenue(theme, 12)}>{trC('r.detail_mi_temps', { detail: m.miTemps.map(h => `${h[0]}-${h[1]}`).join(' / '), prol: m.prolongations ? ` · ${trC('r.prol')} ${m.prolongations[0]}-${m.prolongations[1]}` : '' })}</Text> : null}
                {m.classement.length ? <Text style={attenue(theme, 12)}>{m.classement.map(x => `#${x.place} ${x.nom}`).join(' · ')}</Text> : null}
              </View>
            ))}
            {r.manches.length === 0 && r.forfait ? <Text style={attenue(theme)}>{trC('r.forfait_aide')}</Text> : null}
          </Panneau>
          {r.joueurs.length ? (
            <Carte theme={theme} dense testID="esport-resultat-joueurs">
              <TitreCarte theme={theme} titre={trC('r.joueurs')} />
              {r.joueurs.map((j, i) => (
                <View key={j.compte ?? i} style={{ gap: 2 }}>
                  <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>
                    {(j.pseudo ?? trC('r.compte_supprime')) + (j.mvp ? ` · ${trC('r.mvp_court')}` : '')}
                  </Text>
                  <Text style={attenue(theme, 12)}>{[j.personnages.map(p => p.nom).join(', '), Object.entries(j.stats).map(([k, v]) => `${k} ${v}`).join(' · ')].filter(Boolean).join(' — ')}</Text>
                </View>
              ))}
            </Carte>
          ) : null}
          {r.notes ? <Text style={texte(theme, 14)}>{r.notes}</Text> : null}
          <View style={[styles.ligne, { gap: ESP.xs }]}>
            {r.adversaires.filter(a => a.id).slice(0, 1).map(a => <BoutonHub key={a.id!} theme={theme} titre={trC('r.voir_adversaire', { nom: a.nom })} onPress={() => onAdversaire(a.id!)} testID="esport-resultat-adversaire" />)}
            {r.reviewId && d?.droits.review ? <BoutonHub theme={theme} titre={trC('r.ouvrir_review')} onPress={() => onReview(r.reviewId!)} testID="esport-resultat-review" /> : null}
            {d?.droits.saisir ? <BoutonHub theme={theme} titre={trC('r.modifier')} onPress={() => onModifier(r)} testID="esport-resultat-modifier" /> : null}
            {d?.droits.saisir ? (
              <BoutonConfirme
                theme={theme}
                titre={trC('r.supprimer')}
                confirmation={trC('r.supprimer_confirmer')}
                onConfirme={() =>
                  void agir('suppression', async () => {
                    await api.supprimerResultat(teamId, id);
                    onSupprime();
                  })
                }
                testID="esport-resultat-supprimer"
              />
            ) : null}
          </View>
        </>
      ) : null}
    </Volet>
  );
}

function FicheAdversaire({ theme, api, teamId, id, fuseau, large, onFermer, onResultat, onScouting }: { theme: ThemeHub; api: ApiCompetition; teamId: string; id: string; fuseau: string; large: boolean; onFermer(): void; onResultat(id: string): void; onScouting(): void }) {
  const [v, setV] = useState<VueAdversaire | undefined>();
  const { erreur, agir } = useAgir();
  useEffect(() => {
    void agir('', async () => setV(await api.vueAdversaire(teamId, id)));
  }, [agir, api, teamId, id]);
  return (
    <Volet theme={theme} visible titre={v?.adversaire.nom ?? trC('r.adversaire')} onFermer={onFermer} testID="esport-adversaire-vue" largeur={large ? 680 : 560}>
      <Retours theme={theme} erreur={erreur} prefixe="esport-adversaire-vue" />
      {v ? (
        <>
          <View style={{ flexDirection: 'row', gap: ESP.s, alignItems: 'center' }}>
            <LogoAdversaire theme={theme} nom={v.adversaire.nom} url={v.adversaire.logoUrl} taille={48} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ ...texte(theme, 18), fontWeight: '800' }}>{v.adversaire.nom}</Text>
              <Text style={attenue(theme, 13)} testID="esport-adversaire-vue-bilan">
                {v.bilan.series.joues ? trC('r.vdn_taux', { v: v.bilan.series.victoires, d: v.bilan.series.defaites, n: v.bilan.series.nuls, taux: v.bilan.series.taux ?? 0 }) : trC('r.pas_de_match')}
              </Text>
            </View>
          </View>
          {v.scouting ? (
            <View style={{ alignSelf: 'flex-start' }}>
              <BoutonHub theme={theme} titre={trC('r.ouvrir_scouting')} onPress={onScouting} testID="esport-adversaire-vue-scouting" />
            </View>
          ) : null}
          {v.prochains.length ? (
            <Carte theme={theme} dense testID="esport-adversaire-vue-prochains">
              <TitreCarte theme={theme} titre={trC('r.prochains')} />
              {v.prochains.map(p => (
                <Text key={p.id} style={texte(theme, 14)}>
                  {[quand(p.debut, fuseau), p.tournoi ? [p.tournoi.nom, p.tour].filter(Boolean).join(' · ') : p.titre].filter(Boolean).join(' · ')}
                </Text>
              ))}
            </Carte>
          ) : null}
          {v.bilan.parCarte.length ? (
            <Carte theme={theme} dense>
              <TitreCarte theme={theme} titre={trC('r.par_carte')} />
              {v.bilan.parCarte.map(c => (
                <View key={c.cle ?? c.nom} style={{ flexDirection: 'row', gap: ESP.s, alignItems: 'center' }}>
                  <Text style={{ ...texte(theme, 13), width: 110 }}>{c.nom}</Text>
                  <Barre theme={theme} taux={c.taux} />
                  <Text style={attenue(theme, 12)}>{c.joues ? `${c.victoires}/${c.joues}` : ''}</Text>
                </View>
              ))}
            </Carte>
          ) : null}
          {v.resultats.map(r => (
            <CarteResultat key={r.id} theme={theme} r={r} fuseau={fuseau} onOuvrir={() => onResultat(r.id)} />
          ))}
        </>
      ) : null}
    </Volet>
  );
}
