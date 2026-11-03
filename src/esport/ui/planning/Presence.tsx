/**
 * Page Présence de la team.
 *
 * Staff (marquer, voir tout) — trois onglets :
 *  - « À marquer » : les séances commencées (en cours comprises) des 30 derniers
 *    jours dont la présence n'est pas complète, la plus récente d'abord, avec un
 *    compteur ; « Feuille d'appel » ouvre la feuille rapide (plein écran sur
 *    iPhone, volet sur PC) ;
 *  - « Historique » : une ligne par séance, ses compteurs et son taux ; un appui
 *    ouvre la séance ;
 *  - « Statistiques » : filtres de période (7 jours, 30 jours, 3 mois, saison,
 *    personnalisée) et de type ; par joueur : taux et barre, tendance,
 *    ponctualité, absences de suite ; fiche d'un joueur ; état vide expliqué ;
 *    définitions écrites en clair.
 * Joueur : « Mes réponses » (Oui / Peut-être / Non en un appui, retard ou motif
 * annoncés) et « Ma présence » (sa fiche).
 *
 * Définitions (serveur, esport/noyau/planning/presence.mjs) : seuls les
 * convoqués comptent ; taux = (présents + retards) / séances où il était
 * convoqué ET marqué ; ponctualité = présents / (présents + retards).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BoutonHub, Champ, Segments } from '../../../hub/admin/ui/commun';
import { type ThemeHub } from '../../../hub/themes';
import { apiPlanning, type AMarquer, type ApiPlanning, type HistoriquePresence, type Occurrence, type ParamsPeriode, type PeriodeStats, type StatsPresence, type TypeEvenement } from '../../planning/api';
import { TYPES_EVENEMENT, ajouterJours, aujourdhui, dateCourteJour, dateValide, typeEvenement } from '../../planning/libelles';
import { Retours, useAgir } from '../commun';
import { Badge, Carte, ChiffreCle, ESP, EnTetePage, EtatVide, Onglets, Pliable, Squelette, TitreCarte, TYPO, Volet, attenue as styleAttenue, texte as styleTexte, type EtatPresse } from '../design';
import type { PropsModule } from '../modules';
import { CarteOccurrence, Pastille } from './commun';
import { FeuilleAppel } from './FeuilleAppel';
import { BarreTaux, FichePresenceJoueur, detailCompteurs, pct } from './FichePresence';
import { tr, trn } from '../../i18n';

type Onglet = 'a-marquer' | 'historique' | 'stats' | 'mes-reponses' | 'ma-presence';
type ChoixPeriode = PeriodeStats | 'perso';
type Ouverture = { genre: 'seance'; evenementId: string; cle: string; titre: string; mode: 'vue' | 'appel' } | { genre: 'fiche'; compte: string; nom: string };

const periodes = (): ReadonlyArray<readonly [ChoixPeriode, string]> => [
  ['7', tr('presence.periode_7')],
  ['30', tr('presence.periode_30')],
  ['90', tr('presence.periode_90')],
  ['saison', tr('presence.periode_saison')],
  ['perso', tr('presence.periode_perso')],
];

/** Filtres de période et de type, partagés par l'historique, les statistiques et les fiches. */
function useFiltres(fuseau: string) {
  const auj = aujourdhui(fuseau);
  const [periode, setPeriode] = useState<ChoixPeriode>('90');
  const [du, setDu] = useState(ajouterJours(auj, -29));
  const [au, setAu] = useState(auj);
  const [types, setTypes] = useState<TypeEvenement[]>([]);
  const persoValide = dateValide(du) && dateValide(au) && du <= au;
  const params: ParamsPeriode = useMemo(
    () => (periode === 'perso' ? (persoValide ? { debut: du, fin: ajouterJours(au, 1), types, fuseau } : { periode: '30', types, fuseau }) : { periode, types, fuseau }),
    [periode, persoValide, du, au, types, fuseau],
  );
  return { periode, setPeriode, du, setDu, au, setAu, types, setTypes, params, persoValide };
}

function Filtres({ theme, f, avecTypes = true }: { theme: ThemeHub; f: ReturnType<typeof useFiltres>; avecTypes?: boolean }) {
  return (
    <View style={{ gap: ESP.s }}>
      <Segments theme={theme} libelle={tr('journal.periode')} valeur={f.periode} options={periodes()} onChoisir={v => f.setPeriode(v)} testID="esport-presence-periode" />
      {f.periode === 'perso' ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.s, alignItems: 'flex-end' }}>
          <Champ theme={theme} libelle={tr('presence.du')} valeur={f.du} onChanger={f.setDu} maxLength={10} placeholder="2026-09-01" style={{ width: 150 }} testID="esport-presence-du" />
          <Champ theme={theme} libelle={tr('presence.au')} valeur={f.au} onChanger={f.setAu} maxLength={10} placeholder="2026-10-31" style={{ width: 150 }} testID="esport-presence-au" />
          {!f.persoValide ? <Text style={{ ...styleAttenue(theme), color: theme.critique }}>{tr('presence.dates_invalides')}</Text> : null}
        </View>
      ) : null}
      {avecTypes ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xs }} accessibilityLabel={tr('presence.types_d_evenement')}>
          {TYPES_EVENEMENT.map(t => (
            <Pastille
              key={t.cle}
              theme={theme}
              actif={f.types.includes(t.cle)}
              libelle={t.nom}
              couleur={t.couleur}
              role="checkbox"
              onPress={() => f.setTypes(l => (l.includes(t.cle) ? l.filter(x => x !== t.cle) : [...l, t.cle]))}
              testID={`esport-presence-type-${t.cle}`}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const DEFINITIONS = ['def_convoques', 'def_taux', 'def_ponctualite', 'def_non_marque', 'def_en_plus', 'def_serie', 'def_tendance'] as const;

/** Définitions écrites en clair (repliables). */
function Definitions({ theme }: { theme: ThemeHub }) {
  return (
    <Pliable theme={theme} titre={tr('presence.comment_c_est_calcule')} testID="esport-presence-definitions">
      {DEFINITIONS.map(k => (
        <Text key={k} style={styleTexte(theme, TYPO.legende)}>
          {`• ${tr(`presence.${k}`)}`}
        </Text>
      ))}
    </Pliable>
  );
}

export function Presence({ theme, client, detail, large, onExporter }: PropsModule) {
  const api = useMemo(() => apiPlanning(client, detail.team.id), [client, detail.team.id]);
  const fuseau = detail.team.fuseau;
  const peut = (p: string) => detail.moi.permissions.includes(p);
  const marquer = peut('attendance.mark');
  const voirTout = peut('attendance.view_all');
  const staff = marquer || voirTout;
  const [onglet, setOnglet] = useState<Onglet>(staff ? (marquer ? 'a-marquer' : 'historique') : 'mes-reponses');
  const [ouvert, setOuvert] = useState<Ouverture | undefined>();
  const [aMarquer, setAMarquer] = useState<AMarquer | undefined>();
  const [version, setVersion] = useState(0);
  const filtres = useFiltres(fuseau);

  const chargerAMarquer = useCallback(async () => {
    if (marquer) setAMarquer(await api.aMarquer(fuseau));
  }, [api, fuseau, marquer]);
  useEffect(() => {
    chargerAMarquer().catch(() => undefined);
  }, [chargerAMarquer]);
  const apresMarquage = () => {
    setVersion(v => v + 1);
    chargerAMarquer().catch(() => undefined);
  };

  const entrees = staff
    ? [
        ...(marquer ? [{ id: 'a-marquer', libelle: aMarquer?.total ? tr('presence.onglet_a_marquer_n', { n: aMarquer.total }) : tr('presence.onglet_a_marquer'), description: tr('presence.onglet_a_marquer') }] : []),
        ...(voirTout ? [{ id: 'historique', libelle: tr('presence.onglet_historique') }] : []),
        { id: 'stats', libelle: tr('presence.onglet_statistiques') },
      ]
    : [
        { id: 'mes-reponses', libelle: tr('presence.onglet_mes_reponses') },
        { id: 'ma-presence', libelle: tr('presence.onglet_ma_presence') },
      ];

  // Séance ou fiche ouverte : volet sur PC, plein écran sur iPhone (feuille d'appel au doigt).
  const contenuOuvert = ouvert ? (
    ouvert.genre === 'seance' ? (
      <FeuilleAppel theme={theme} api={api} evenementId={ouvert.evenementId} cle={ouvert.cle} marquer={marquer} mode={ouvert.mode} onMarque={apresMarquage} />
    ) : (
      <View style={{ gap: ESP.m }}>
        <Filtres theme={theme} f={filtres} avecTypes={false} />
        <FichePresenceJoueur theme={theme} api={api} compte={ouvert.compte} periode={filtres.params} />
      </View>
    )
  ) : null;
  const titreOuvert = ouvert ? (ouvert.genre === 'seance' ? (ouvert.mode === 'appel' ? tr('presence.feuille_d_appel') : tr('planning.listePresence.presence')) : ouvert.nom) : '';
  const idOuvert = ouvert?.genre === 'fiche' ? 'esport-presence-fiche' : 'esport-presence-seance';
  if (ouvert && !large) {
    return (
      <View style={{ gap: ESP.m }} testID="esport-presence">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s }}>
          <BoutonHub theme={theme} titre={tr('presence.retour')} onPress={() => setOuvert(undefined)} testID="esport-presence-fermer" />
          <Text accessibilityRole="header" style={{ ...styleTexte(theme, TYPO.titreCarte), fontWeight: '800', flexShrink: 1 }} numberOfLines={1}>
            {titreOuvert}
          </Text>
        </View>
        <View testID={idOuvert}>{contenuOuvert}</View>
      </View>
    );
  }

  return (
    <View style={{ gap: ESP.l }} testID="esport-presence">
      <EnTetePage theme={theme} large={large} titre={tr('planning.listePresence.presence')} sous={staff ? tr('presence.sous_titre_staff') : tr('presence.sous_titre_joueur')} />
      <Onglets theme={theme} prefixe="esport-presence-onglet" testID="esport-presence-onglets" actif={onglet} pleineLargeur={!large} entrees={entrees} onChoisir={id => setOnglet(id as Onglet)} />
      {onglet === 'a-marquer' ? <OngletAMarquer theme={theme} donnees={aMarquer} onOuvrir={(o, mode) => setOuvert({ genre: 'seance', evenementId: o.evenementId, cle: o.cle, titre: o.titre, mode })} /> : null}
      {onglet === 'historique' ? <OngletHistorique theme={theme} api={api} f={filtres} version={version} marquer={marquer} onOuvrir={(s, mode) => setOuvert({ genre: 'seance', evenementId: s.evenementId, cle: s.cle, titre: s.titre, mode })} /> : null}
      {onglet === 'stats' ? (
        <OngletStats
          theme={theme}
          api={api}
          f={filtres}
          version={version}
          large={large}
          aMarquer={aMarquer?.total ?? 0}
          onAMarquer={() => setOnglet('a-marquer')}
          onFiche={(compte, nom) => setOuvert({ genre: 'fiche', compte, nom })}
          onExporter={voirTout ? onExporter : undefined}
        />
      ) : null}
      {onglet === 'mes-reponses' ? <OngletMesReponses theme={theme} api={api} fuseau={fuseau} /> : null}
      {onglet === 'ma-presence' ? (
        <Carte theme={theme} testID="esport-presence-stats">
          <Filtres theme={theme} f={filtres} />
          <Definitions theme={theme} />
          <FichePresenceJoueur theme={theme} api={api} compte="moi" periode={filtres.params} testID="esport-ma-presence" />
        </Carte>
      ) : null}
      {ouvert && large ? (
        <Volet theme={theme} visible titre={titreOuvert} onFermer={() => setOuvert(undefined)} testID={idOuvert} largeur={680}>
          {contenuOuvert}
        </Volet>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ À marquer

function OngletAMarquer({ theme, donnees, onOuvrir }: { theme: ThemeHub; donnees?: AMarquer; onOuvrir(o: Occurrence, mode: 'vue' | 'appel'): void }) {
  if (!donnees) return <Squelette theme={theme} lignes={4} />;
  if (donnees.total === 0) {
    return (
      <Carte theme={theme} testID="esport-presence-a-marquer">
        <EtatVide theme={theme} glyphe="✓" titre={tr('presence.tout_est_marque')} texte={tr('presence.tout_est_marque_texte', { n: donnees.jours })} testID="esport-presence-a-marquer-vide" />
      </Carte>
    );
  }
  return (
    <View style={{ gap: ESP.s }} testID="esport-presence-a-marquer">
      <Text style={styleAttenue(theme, TYPO.texte)}>{trn('presence.seances_a_marquer', donnees.total, { jours: donnees.jours })}</Text>
      {donnees.seances.map(o => {
        const t = typeEvenement(o.type);
        const id = `esport-a-marquer-${o.evenementId.slice(0, 8)}-${o.jour}`;
        return (
          <Carte key={`${o.evenementId}-${o.cle}`} theme={theme} accent={t.couleur} dense testID={id}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s, flexWrap: 'wrap' }}>
              <View style={{ flex: 1, minWidth: 180, gap: 2 }}>
                <Text style={{ ...styleTexte(theme, TYPO.titreCarte), fontWeight: '700' }} numberOfLines={2}>
                  {o.titre}
                </Text>
                <Text style={styleAttenue(theme)}>{`${t.nom} · ${dateCourteJour(o.jour)} · ${o.heureDebut}–${o.heureFin}`}</Text>
              </View>
              {o.enCours ? <Badge theme={theme} texte={tr('presence.en_cours')} ton="alerte" /> : null}
              <Badge theme={theme} texte={tr('presence.restants', { restants: o.restants, total: o.convoquesTotal })} ton="critique" testID={`${id}-restants`} />
            </View>
            <View style={{ flexDirection: 'row', gap: ESP.xs, flexWrap: 'wrap' }}>
              <BoutonHub theme={theme} variante="plein" titre={tr('presence.feuille_d_appel')} onPress={() => onOuvrir(o, 'appel')} testID={`${id}-appel`} />
              <BoutonHub theme={theme} titre={tr('presence.voir_le_detail')} onPress={() => onOuvrir(o, 'vue')} testID={`${id}-vue`} />
            </View>
          </Carte>
        );
      })}
    </View>
  );
}

// ------------------------------------------------------------------ Historique

function OngletHistorique({
  theme,
  api,
  f,
  version,
  onOuvrir,
  marquer,
}: {
  theme: ThemeHub;
  api: ApiPlanning;
  f: ReturnType<typeof useFiltres>;
  version: number;
  onOuvrir(s: { evenementId: string; cle: string; titre: string }, mode: 'vue' | 'appel'): void;
  marquer: boolean;
}) {
  const [h, setH] = useState<HistoriquePresence | undefined>();
  const { erreur, agir } = useAgir();
  useEffect(() => {
    void agir('', async () => setH(await api.historique(f.params)));
  }, [agir, api, f.params, version]);
  return (
    <Carte theme={theme} testID="esport-presence-historique">
      <Filtres theme={theme} f={f} />
      <Retours theme={theme} erreur={erreur} prefixe="esport-presence-historique" />
      {!h ? <Squelette theme={theme} lignes={4} /> : null}
      {h && h.seances.length === 0 ? <EtatVide theme={theme} glyphe="◷" titre={tr('presence.aucune_seance')} texte={tr('presence.aucune_seance_texte')} /> : null}
      {h?.seances.map(s => {
        const t = typeEvenement(s.type);
        return (
          <Pressable
            key={`${s.evenementId}-${s.cle}`}
            accessibilityRole="button"
            accessibilityLabel={tr('resumes.ouvrir', { titre: s.titre })}
            onPress={() => onOuvrir(s, marquer && s.nonMarques ? 'appel' : 'vue')}
            testID={`esport-historique-${s.evenementId.slice(0, 8)}-${s.jour}`}
            style={(etat: EtatPresse) => ({ gap: ESP.xxs, borderTopWidth: 1, borderTopColor: etat.hovered ? theme.accent : theme.ligne, paddingVertical: ESP.s, minHeight: 44 })}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s, flexWrap: 'wrap' }}>
              <Text style={{ ...styleTexte(theme), fontWeight: '700', flex: 1, minWidth: 180 }} numberOfLines={1}>
                <Text style={{ color: t.couleur }}>● </Text>
                {`${dateCourteJour(s.jour)} ${s.heureDebut} · ${s.titre}`}
              </Text>
              {pct(s.taux) ? <Text style={{ ...styleTexte(theme), fontWeight: '800' }}>{tr('presence.taux_court', { v: pct(s.taux) })}</Text> : <Badge theme={theme} texte={tr('presence.pas_encore_marquee')} ton="alerte" />}
            </View>
            <Text style={styleAttenue(theme)}>
              {`${trn('presence.n_convoques', s.evenements)} · ${detailCompteurs(s)}`}
              {s.nonMarques ? ` · ${trn('presence.n_non_marquees', s.nonMarques)}` : ''}
              {s.enPlus ? ` · ${trn('presence.en_plus', s.enPlus)}` : ''}
            </Text>
          </Pressable>
        );
      })}
    </Carte>
  );
}

// ------------------------------------------------------------------ Statistiques

function Tendance({ theme, v }: { theme: ThemeHub; v: number | null | undefined }) {
  if (v === null || v === undefined) return null;
  const points = Math.round(v * 100);
  const stable = Math.abs(points) < 5;
  const couleur = stable ? theme.attenue : points > 0 ? theme.ok : theme.critique;
  const glyphe = stable ? '→' : points > 0 ? '↗︎' : '↘︎';
  const libelle = stable ? tr('presence.tendance_stable') : tr(points > 0 ? 'presence.tendance_hausse' : 'presence.tendance_baisse', { n: Math.abs(points) });
  return (
    <Text style={{ ...styleAttenue(theme), color: couleur, fontWeight: '700' }} accessibilityLabel={libelle}>
      {`${glyphe} ${libelle}`}
    </Text>
  );
}

function OngletStats({
  theme,
  api,
  f,
  version,
  large,
  aMarquer,
  onAMarquer,
  onFiche,
  onExporter,
}: {
  theme: ThemeHub;
  api: ApiPlanning;
  f: ReturnType<typeof useFiltres>;
  version: number;
  large: boolean;
  aMarquer: number;
  onAMarquer(): void;
  onFiche(compte: string, nom: string): void;
  onExporter?(nom: string, contenu: string, type?: string): Promise<boolean>;
}) {
  const [stats, setStats] = useState<StatsPresence | undefined>();
  const { erreur, avis, agir } = useAgir();
  useEffect(() => {
    void agir('', async () => setStats(await api.stats(f.params)));
  }, [agir, api, f.params, version]);
  const g = stats?.global;
  const vide = Boolean(g && g.marques === 0);
  return (
    <Carte theme={theme} testID="esport-presence-stats">
      <TitreCarte
        theme={theme}
        titre={tr('statsTeam.statistiques_de_la_team')}
        sous={stats ? tr('presence.periode_du_au', { du: dateCourteJour(stats.debut), au: dateCourteJour(ajouterJours(stats.fin, -1)) }) : undefined}
        droite={
          onExporter ? (
            <BoutonHub
              theme={theme}
              titre={tr('journal.exporter_csv')}
              onPress={() =>
                void agir('export', async () => {
                  const fichier = await api.exportCsv(f.params);
                  return (await onExporter(fichier.nom, fichier.contenu, 'text/csv')) ? tr('journal.export_csv_enregistre') : undefined;
                })
              }
              testID="esport-presence-csv"
            />
          ) : undefined
        }
      />
      <Filtres theme={theme} f={f} />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-presence-stats" />
      <Definitions theme={theme} />
      {!stats ? <Squelette theme={theme} lignes={5} /> : null}
      {stats && vide ? (
        <EtatVide
          theme={theme}
          glyphe="◔"
          titre={tr('presence.aucune_presence_marquee')}
          texte={g?.nonMarques ? trn('presence.vide_non_marquees', g.nonMarques) : tr('presence.vide_aucune_seance')}
          action={aMarquer ? { titre: tr('presence.voir_les_seances_a_marquer'), onPress: onAMarquer, testID: 'esport-presence-vide-a-marquer' } : undefined}
          testID="esport-presence-stats-vide"
        />
      ) : null}
      {stats && g && !vide ? (
        <View style={{ gap: ESP.l }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.s }}>
            <ChiffreCle theme={theme} large={large} libelle={tr('presence.taux_de_presence')} valeur={pct(g.taux) ?? ''} detail={trn('presence.sur_n_seances_marquees', g.marques)} testIDValeur="esport-presence-taux-global" />
            <ChiffreCle theme={theme} large={large} libelle={tr('presence.ponctualite')} valeur={pct(g.ponctualite) ?? tr('presence.sans_objet')} detail={g.retardMoyen ? tr('presence.retard_moyen', { n: g.retardMoyen }) : trn('presence.n_retards', g.retard)} />
            <ChiffreCle theme={theme} large={large} libelle={tr('presence.non_marquees')} valeur={String(g.nonMarques ?? 0)} detail={tr('presence.hors_du_taux')} ton={g.nonMarques ? 'alerte' : 'neutre'} onPress={g.nonMarques && aMarquer ? onAMarquer : undefined} />
          </View>
          <View style={{ gap: ESP.xs }}>
            <Text accessibilityRole="header" style={{ ...styleTexte(theme, TYPO.titreCarte), fontWeight: '700' }}>
              {tr('planning.presence.par_joueur')}
            </Text>
            {stats.joueurs.map(j => {
              const nom = stats.noms[j.compte] ?? tr('resumes.compte_supprime');
              const id = `esport-stat-joueur-${j.compte}`;
              return (
                <Pressable
                  key={j.compte}
                  accessibilityRole="button"
                  accessibilityLabel={tr('presence.ouvrir_la_fiche', { nom })}
                  onPress={() => onFiche(j.compte, nom)}
                  testID={id}
                  style={(etat: EtatPresse) => ({ gap: ESP.xxs, borderTopWidth: 1, borderTopColor: etat.hovered ? theme.accent : theme.ligne, paddingVertical: ESP.s })}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s, flexWrap: 'wrap' }}>
                    <Text style={{ ...styleTexte(theme), fontWeight: '700', flex: 1, minWidth: 120 }} numberOfLines={1}>
                      {nom}
                    </Text>
                    {(j.serie ?? 0) >= 2 ? <Badge theme={theme} texte={trn('presence.absences_de_suite_n', j.serie ?? 0)} ton="critique" testID={`${id}-serie`} /> : null}
                    <Tendance theme={theme} v={j.tendance} />
                    {pct(j.taux) ? (
                      <Text style={{ ...styleTexte(theme, 17), fontWeight: '800' }} testID={`${id}-taux`}>
                        {pct(j.taux)}
                      </Text>
                    ) : (
                      <Text style={styleAttenue(theme)} testID={`${id}-taux`}>
                        {j.enPlus && !j.evenements ? tr('presence.non_convoque') : tr('presence.pas_encore_marque')}
                      </Text>
                    )}
                  </View>
                  {j.marques > 0 ? <BarreTaux theme={theme} taux={j.taux} /> : null}
                  <Text style={styleAttenue(theme)}>
                    {j.marques > 0 ? `${detailCompteurs(j)} · ${trn('presence.sur_n_seances_marquees', j.marques)}` : ''}
                    {j.marques > 0 && pct(j.ponctualite) ? ` · ${tr('presence.ponctualite_v', { v: pct(j.ponctualite) })}` : ''}
                    {j.nonMarques ? `${j.marques > 0 ? ' · ' : ''}${trn('presence.n_non_marquees', j.nonMarques)}` : ''}
                    {j.enPlus ? ` · ${trn('presence.en_plus', j.enPlus)}` : ''}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={{ gap: ESP.xs }}>
            <Text accessibilityRole="header" style={{ ...styleTexte(theme, TYPO.titreCarte), fontWeight: '700' }}>
              {tr('planning.presence.par_type_d_evenement')}
            </Text>
            {stats.parType.map(t => {
              const te = typeEvenement(t.type);
              return (
                <View key={t.type} style={{ gap: ESP.xxs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingVertical: ESP.s }} testID={`esport-stat-type-${t.type}`}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s }}>
                    <Text style={{ ...styleTexte(theme), fontWeight: '700', flex: 1 }}>
                      <Text style={{ color: te.couleur }}>● </Text>
                      {te.nom}
                    </Text>
                    <Text style={{ ...styleTexte(theme), fontWeight: '800' }}>{pct(t.taux) ?? tr('presence.pas_encore_marque')}</Text>
                  </View>
                  {t.marques > 0 ? <BarreTaux theme={theme} taux={t.taux} /> : null}
                  <Text style={styleAttenue(theme)}>
                    {detailCompteurs(t)}
                    {t.nonMarques ? ` · ${trn('presence.n_non_marquees', t.nonMarques)}` : ''}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}
    </Carte>
  );
}

// ------------------------------------------------------------------ Joueur : mes réponses

function OngletMesReponses({ theme, api, fuseau }: { theme: ThemeHub; api: ApiPlanning; fuseau: string }) {
  const [liste, setListe] = useState<Occurrence[] | undefined>();
  const auj = aujourdhui(fuseau);
  const charger = useCallback(async () => {
    const l = await api.liste({ debut: auj, fin: ajouterJours(auj, 22), fuseau });
    setListe(l.droits.rsvp && l.modules.presence ? l.occurrences.filter(o => !o.termine && o.convoqueMoi !== false && o.concerneMoi !== false) : []);
  }, [api, auj, fuseau]);
  useEffect(() => {
    charger().catch(() => setListe([]));
  }, [charger]);
  if (!liste) return <Squelette theme={theme} lignes={4} />;
  if (liste.length === 0) return <EtatVide theme={theme} glyphe="◷" titre={tr('presence.aucune_convocation')} texte={tr('presence.aucune_convocation_texte')} testID="esport-presence-a-venir-vide" />;
  const maj = (o: Occurrence, x: Partial<Occurrence>) => setListe(l => l?.map(y => (y.evenementId === o.evenementId && y.cle === o.cle ? { ...y, ...x } : y)));
  return (
    <View style={{ gap: ESP.s }} testID="esport-presence-a-venir">
      <Text style={styleAttenue(theme, TYPO.texte)}>{tr('presence.mes_reponses_explication')}</Text>
      {liste.map(o => (
        <CarteOccurrence
          key={`${o.evenementId}-${o.cle}`}
          theme={theme}
          o={o}
          onRepondre={async r => {
            await api.repondre(o.evenementId, o.cle, r);
            maj(o, { monRsvp: r });
          }}
          onAnnoncer={async (r, a) => {
            const rep = await api.repondre(o.evenementId, o.cle, r, a);
            maj(o, { monRsvp: r, maReponse: { retardPrevu: rep.retardPrevu ?? null, motif: rep.motif ?? '' } });
          }}
          testID={`esport-presence-occ-${o.jour}`}
        />
      ))}
    </View>
  );
}
