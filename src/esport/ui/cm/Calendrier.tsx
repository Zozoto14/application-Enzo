/**
 * Calendrier éditorial de la section CM : posts prévus (date de publication) par semaine ou par mois, filtrés
 * par réseau. PC : grille de 7 colonnes ; téléphone : liste jour par jour. Heures du club (Europe/Paris).
 *
 * Calendriers des teams (superposés, LECTURE SEULE) : matchs, tournois, scrims et événements de chaque team que
 * le compte a le droit de voir (planning s'il en est membre ; sinon compétition publiable seulement : voir
 * esport/noyau/cm/calendriers.mjs). Un interrupteur par team (sa couleur), choix mémorisé par compte en base
 * (`calendrier.teams`). Toucher un événement : son détail, et « Créer un post pour cet événement ».
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BoutonHub, Segments } from '../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { PORTEE_CLUB, type ApiCm, type CalendrierTeam, type CarteTransverse, type EvenementTeam, type Reseau } from '../../cm/api';
import { CLES_RESEAUX } from '../../cm/reseaux';
import { formaterDate } from '../../i18n';
import { trCm, type CleCm } from '../../i18n/cm';
import { Retours, styles, useAgir } from '../commun';
import { Badge, Carte, ESP, Volet, attenue, texte, type EtatPresse } from '../design';
import { Aide, FUSEAU_CLUB, PastilleReseau, TON_STATUT, murale, nomStatut, quand } from './commun';

type Mode = 'semaine' | 'mois';
const JOUR = 86_400_000;

/** « AAAA-MM-JJ » d'une date UTC. */
const jourTexte = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
/** Lundi (UTC) de la semaine d'un jour. */
function lundi(ms: number): number {
  const d = new Date(ms);
  const j = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - j * JOUR;
}

/** Jours affichés : la semaine (7 jours) ou le mois complet en semaines entières (lundi → dimanche). */
export function joursDe(mode: Mode, reference: number): string[] {
  if (mode === 'semaine') {
    const l = lundi(reference);
    return Array.from({ length: 7 }, (_, i) => jourTexte(l + i * JOUR));
  }
  const d = new Date(reference);
  const premier = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const dernier = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0);
  const debut = lundi(premier);
  const fin = lundi(dernier) + 6 * JOUR;
  return Array.from({ length: Math.round((fin - debut) / JOUR) + 1 }, (_, i) => jourTexte(debut + i * JOUR));
}

/** Jours (heure du club) couverts par un événement de team : le jour du début, ou chaque jour d'un tournoi. */
export function joursEvenement(e: Pick<EvenementTeam, 'debut' | 'fin' | 'jour'>): string[] {
  const premier = e.jour ? e.debut.slice(0, 10) : murale(e.debut, FUSEAU_CLUB).date;
  if (!e.jour || !e.fin) return [premier];
  const dernier = e.fin.slice(0, 10);
  const jours: string[] = [];
  for (let t = Date.parse(`${premier}T12:00:00Z`); jourTexte(t) <= dernier && jours.length < 31; t += JOUR) jours.push(jourTexte(t));
  return jours;
}

export function Calendrier({
  theme,
  api,
  large,
  onOuvrirTableau,
  creerPost = false,
}: {
  theme: ThemeHub;
  api: ApiCm;
  large: boolean;
  onOuvrirTableau(id: string): void;
  /** Le compte prépare des posts (cm.editer quelque part) : bouton « Créer un post pour cet événement ». */
  creerPost?: boolean;
}) {
  const [mode, setMode] = useState<Mode>(large ? 'mois' : 'semaine');
  const [reference, setReference] = useState(() => Date.now());
  const [reseau, setReseau] = useState<Reseau | ''>('');
  const [cartes, setCartes] = useState<CarteTransverse[] | undefined>();
  const { erreur, agir } = useAgir();
  const jours = useMemo(() => joursDe(mode, reference), [mode, reference]);
  const charger = useCallback(async () => setCartes((await api.calendrier(jours[0], jours[jours.length - 1], reseau || undefined)).cartes), [api, jours, reseau]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);
  // Calendriers des teams : lecture seule ; teams affichées mémorisées par compte (toutes par défaut).
  const [teamsCal, setTeamsCal] = useState<CalendrierTeam[]>([]);
  const [affichees, setAffichees] = useState<Record<string, boolean>>({});
  const [detail, setDetail] = useState<{ e: EvenementTeam; team: CalendrierTeam } | undefined>();
  useEffect(() => {
    let vivant = true;
    api
      .preferences()
      .then(p => {
        const v = p?.preferences?.['calendrier.teams'];
        if (vivant && v && typeof v === 'object' && !Array.isArray(v)) setAffichees(v as Record<string, boolean>);
      })
      .catch(() => undefined);
    return () => {
      vivant = false;
    };
  }, [api]);
  useEffect(() => {
    let vivant = true;
    api
      .calendrierTeams(jours[0], jours[jours.length - 1])
      .then(r => vivant && setTeamsCal(Array.isArray(r?.teams) ? r.teams : []))
      .catch(() => vivant && setTeamsCal([]));
    return () => {
      vivant = false;
    };
  }, [api, jours]);
  const visible = (teamId: string) => affichees[teamId] !== false;
  const basculerTeam = (teamId: string) => {
    const suivantes = { ...affichees, [teamId]: !visible(teamId) };
    setAffichees(suivantes);
    void api.changerPreference('calendrier.teams', suivantes).catch(() => undefined);
  };
  const evenementsParJour = useMemo(() => {
    const m = new Map<string, Array<{ e: EvenementTeam; team: CalendrierTeam }>>();
    for (const team of teamsCal) {
      if (affichees[team.id] === false) continue;
      for (const e of team.evenements) {
        for (const j of joursEvenement(e)) {
          if (!m.has(j)) m.set(j, []);
          m.get(j)!.push({ e, team });
        }
      }
    }
    for (const l of m.values()) l.sort((a, b) => a.e.debut.localeCompare(b.e.debut));
    return m;
  }, [teamsCal, affichees]);
  const parJour = useMemo(() => {
    const m = new Map<string, CarteTransverse[]>();
    for (const c of cartes ?? []) {
      const j = murale(c.datePublication, FUSEAU_CLUB).date;
      if (!m.has(j)) m.set(j, []);
      m.get(j)!.push(c);
    }
    return m;
  }, [cartes]);
  const decaler = (sens: number) => {
    const d = new Date(reference);
    setReference(mode === 'semaine' ? reference + sens * 7 * JOUR : Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + sens, 15));
  };
  const mois = new Date(reference).getUTCMonth();
  const titre = mode === 'mois' ? formaterDate(reference, { month: 'long', year: 'numeric', timeZone: 'UTC' }) : trCm('calendrier.semaine_du', { date: formaterDate(`${jours[0]}T12:00:00Z`, { day: 'numeric', month: 'long', timeZone: 'UTC' }) });
  const aujourdhui = murale(new Date().toISOString(), FUSEAU_CLUB).date;

  const element = (c: CarteTransverse) => (
    <Pressable
      key={c.id}
      accessibilityRole="button"
      accessibilityLabel={`${c.titre}, ${murale(c.datePublication, FUSEAU_CLUB).heure}${c.statut ? `, ${nomStatut(c.statut)}` : ''}`}
      onPress={() => onOuvrirTableau(c.tableauId)}
      testID={`esport-cm-calendrier-${c.id}`}
      style={(e: EtatPresse) => ({
        borderLeftWidth: 3,
        borderLeftColor: c.statut ? (TON_STATUT[c.statut] === 'ok' ? theme.ok : TON_STATUT[c.statut] === 'alerte' ? theme.alerte : TON_STATUT[c.statut] === 'critique' ? theme.critique : theme.accent) : theme.ligne,
        backgroundColor: e.hovered || e.focused ? teinteTransparente(theme.accent, 0.12) : theme.surface,
        borderRadius: 6,
        padding: 4,
        gap: 2,
        minHeight: 36,
      })}>
      <Text style={{ ...texte(theme, 12), fontWeight: '700' }} numberOfLines={2}>{`${murale(c.datePublication, FUSEAU_CLUB).heure} · ${c.titre}`}</Text>
      <View style={{ flexDirection: 'row', gap: 2, flexWrap: 'wrap' }}>
        {c.reseaux.map(r => (
          <PastilleReseau key={r} theme={theme} reseau={r} compact />
        ))}
      </View>
    </Pressable>
  );

  const evenement = ({ e, team }: { e: EvenementTeam; team: CalendrierTeam }) => (
    <Pressable
      key={`${team.id}-${e.id}`}
      accessibilityRole="button"
      accessibilityLabel={trCm('calendrier.evenement_libelle', { team: team.nom, titre: e.titre, heure: e.jour ? trCm('calendrier.journee') : murale(e.debut, FUSEAU_CLUB).heure })}
      onPress={() => setDetail({ e, team })}
      testID={`esport-cm-calendrier-ev-${team.id}-${e.id}`}
      style={(etat: EtatPresse) => ({
        borderLeftWidth: 3,
        borderLeftColor: team.couleur,
        backgroundColor: etat.hovered || etat.focused ? teinteTransparente(team.couleur, 0.28) : teinteTransparente(team.couleur, 0.14),
        borderRadius: 6,
        paddingHorizontal: 4,
        paddingVertical: 2,
        minHeight: 28,
        justifyContent: 'center',
      })}>
      <Text style={{ ...texte(theme, 12) }} numberOfLines={2}>{`${e.jour ? '' : `${murale(e.debut, FUSEAU_CLUB).heure} · `}${e.titre}`}</Text>
    </Pressable>
  );
  const contenuJour = (j: string) => [...(parJour.get(j) ?? []).map(element), ...(evenementsParJour.get(j) ?? []).map(evenement)];
  const videJour = (j: string) => !(parJour.get(j) ?? []).length && !(evenementsParJour.get(j) ?? []).length;

  return (
    <View style={{ gap: ESP.m }} testID="esport-cm-calendrier">
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <View style={[styles.ligne, { gap: ESP.xs }]}>
          <BoutonHub theme={theme} titre="‹" libelle={trCm('calendrier.precedent')} onPress={() => decaler(-1)} testID="esport-cm-calendrier-precedent" />
          <BoutonHub theme={theme} titre={trCm('calendrier.aujourdhui')} onPress={() => setReference(Date.now())} testID="esport-cm-calendrier-aujourdhui" />
          <BoutonHub theme={theme} titre="›" libelle={trCm('calendrier.suivant')} onPress={() => decaler(1)} testID="esport-cm-calendrier-suivant" />
          <Text accessibilityRole="header" style={{ ...texte(theme, 18), fontWeight: '800' }} testID="esport-cm-calendrier-titre">
            {titre}
          </Text>
        </View>
        <Segments theme={theme} libelle={trCm('calendrier.vue')} valeur={mode} options={[['semaine', trCm('calendrier.semaine')], ['mois', trCm('calendrier.mois')]]} onChoisir={v => setMode(v as Mode)} testID="esport-cm-calendrier-mode" />
      </View>
      <View style={[styles.ligne, { gap: ESP.xs }]}>
        <BoutonHub theme={theme} titre={trCm('calendrier.tous_reseaux')} variante={reseau ? 'normal' : 'plein'} onPress={() => setReseau('')} testID="esport-cm-calendrier-reseau-tous" />
        {CLES_RESEAUX.map(r => (
          <PastilleReseau key={r} theme={theme} reseau={r} actif={reseau === r} onPress={() => setReseau(reseau === r ? '' : r)} testID={`esport-cm-calendrier-reseau-${r}`} />
        ))}
      </View>
      {teamsCal.length ? (
        <View style={{ gap: ESP.xxs }} testID="esport-cm-calendrier-teams">
          <Text style={{ ...texte(theme, 13), fontWeight: '700' }}>{trCm('calendrier.teams')}</Text>
          <View style={[styles.ligne, { gap: ESP.xs }]}>
            {teamsCal.map(team => {
              const actif = visible(team.id);
              return (
                <Pressable
                  key={team.id}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: actif }}
                  accessibilityLabel={trCm('calendrier.team_libelle', { team: team.nom, n: team.evenements.length })}
                  onPress={() => basculerTeam(team.id)}
                  testID={`esport-cm-calendrier-team-${team.id}`}
                  style={(etat: EtatPresse) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 10, borderRadius: 18, borderWidth: 1, borderColor: actif ? team.couleur : theme.ligne, backgroundColor: actif ? teinteTransparente(team.couleur, 0.16) : etat.hovered ? teinteTransparente(theme.attenue, 0.1) : 'transparent' })}>
                  <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: actif ? team.couleur : 'transparent', borderWidth: 2, borderColor: team.couleur }} />
                  <Text style={{ ...texte(theme, 13), fontWeight: '600', opacity: actif ? 1 : 0.7 }}>{team.nom}</Text>
                  {team.acces === 'competition' ? <Text style={attenue(theme, 11)}>{trCm('calendrier.publiable')}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
      <Retours theme={theme} erreur={erreur} prefixe="esport-cm-calendrier" />
      {large ? (
        <View style={{ borderWidth: 1, borderColor: theme.ligne, borderRadius: 10, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row' }}>
            {jours.slice(0, 7).map(j => (
              <Text key={j} style={{ ...attenue(theme, 12), flex: 1, padding: 6, fontWeight: '700' }}>
                {formaterDate(`${j}T12:00:00Z`, { weekday: 'short', timeZone: 'UTC' })}
              </Text>
            ))}
          </View>
          {Array.from({ length: jours.length / 7 }, (_, s) => (
            <View key={s} style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: theme.ligne }}>
              {jours.slice(s * 7, s * 7 + 7).map(j => (
                <View key={j} style={{ flex: 1, minHeight: mode === 'mois' ? 110 : 260, padding: 4, gap: 4, borderLeftWidth: 1, borderLeftColor: theme.ligne, backgroundColor: j === aujourdhui ? teinteTransparente(theme.accent, 0.08) : 'transparent', opacity: mode === 'mois' && Number(j.slice(5, 7)) - 1 !== mois ? 0.5 : 1 }} testID={`esport-cm-calendrier-jour-${j}`}>
                  <Text style={{ ...attenue(theme, 12), fontWeight: j === aujourdhui ? '800' : '400' }}>{String(Number(j.slice(8)))}</Text>
                  {contenuJour(j)}
                </View>
              ))}
            </View>
          ))}
        </View>
      ) : (
        <View style={{ gap: ESP.s }}>
          {jours
            .filter(j => mode === 'semaine' || !videJour(j))
            .map(j => (
              <Carte key={j} theme={theme} dense testID={`esport-cm-calendrier-jour-${j}`}>
                <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{formaterDate(`${j}T12:00:00Z`, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}</Text>
                {!videJour(j) ? contenuJour(j) : <Text style={attenue(theme)}>—</Text>}
              </Carte>
            ))}
          {mode === 'mois' && jours.every(videJour) ? <Text style={attenue(theme)}>{trCm('calendrier.vide')}</Text> : null}
        </View>
      )}
      {detail ? <DetailEvenement theme={theme} api={api} detail={detail} creerPost={creerPost} onFermer={() => setDetail(undefined)} onOuvrirTableau={onOuvrirTableau} /> : null}
    </View>
  );
}

const TYPES_EVENEMENT = ['match', 'scrim', 'tournament', 'other', 'training', 'meeting'];

/** Détail d'un événement de team (lecture seule) et « Créer un post pour cet événement ». */
function DetailEvenement({ theme, api, detail, creerPost, onFermer, onOuvrirTableau }: { theme: ThemeHub; api: ApiCm; detail: { e: EvenementTeam; team: CalendrierTeam }; creerPost: boolean; onFermer(): void; onOuvrirTableau(id: string): void }) {
  const { e, team } = detail;
  const { erreur, agir, enCours } = useAgir();
  const type = TYPES_EVENEMENT.includes(e.type) ? trCm(`calendrier.type.${e.type}` as CleCm) : e.type;
  /**
   * Post brouillon dans « Idées » : tableau « Contenus » du club si le compte y prépare des posts, sinon celui de la
   * team. Date de publication = début de l'événement ; textes FR / EN pré-remplis si le match ou le tournoi est
   * publiable (résumé publiable, comme « Pré-remplir depuis un match… »).
   */
  const creer = () =>
    agir('creer', async () => {
      const { tableaux } = await api.tableaux();
      const permis = tableaux.filter(t => t.cleDefaut && t.droits?.editer);
      const tableau = permis.find(t => t.portee === PORTEE_CLUB) ?? permis.find(t => t.portee === team.id);
      if (!tableau) throw new Error(trCm('calendrier.aucun_tableau'));
      const d = await api.tableau(tableau.id);
      const idees = d.listes.find(l => l.cle === 'idees') ?? d.listes[0];
      if (!idees) throw new Error(trCm('calendrier.aucun_tableau'));
      let textes: Awaited<ReturnType<ApiCm['prerempli']>>['textes'] | undefined;
      let liens: Record<string, string> = { teamId: team.id };
      if (e.publiable && (e.matchId || e.tournoiId)) {
        const p = await api.prerempli(team.id, e.matchId ? 'annonce' : 'tournoi', (e.matchId ?? e.tournoiId)!, e.matchId ? 'jourj' : undefined).catch(() => undefined);
        if (p) {
          textes = p.textes;
          liens = { ...liens, ...(p.liens as Record<string, string>) };
        }
      }
      await api.creerCarte(tableau.id, { listeId: idees.id, titre: e.titre.slice(0, 200), post: true, datePublication: e.debut, ...(textes ? { textes } : {}), liens, ...(tableau.portee === PORTEE_CLUB ? { teamId: team.id } : {}) });
      onFermer();
      onOuvrirTableau(tableau.id);
    });
  return (
    <Volet theme={theme} visible titre={e.titre} onFermer={onFermer} testID="esport-cm-calendrier-detail">
      <View style={[styles.ligne, { gap: ESP.xs }]}>
        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: team.couleur }} />
        <Text style={{ ...texte(theme, 15), fontWeight: '700' }}>{team.nom}</Text>
        <Badge theme={theme} texte={type} />
      </View>
      <Text style={texte(theme)} testID="esport-cm-calendrier-detail-date">
        {e.jour ? trCm('calendrier.du_au', { du: formaterDate(`${e.debut.slice(0, 10)}T12:00:00Z`, { day: 'numeric', month: 'long', timeZone: 'UTC' }), au: formaterDate(`${(e.fin ?? e.debut).slice(0, 10)}T12:00:00Z`, { day: 'numeric', month: 'long', timeZone: 'UTC' }) }) : `${quand(e.debut)}${e.fin ? ` → ${murale(e.fin, FUSEAU_CLUB).heure}` : ''}`}
      </Text>
      {e.lieu ? <Text style={texte(theme)}>{trCm('calendrier.lieu', { lieu: e.lieu })}</Text> : null}
      {e.description ? <Text style={texte(theme)}>{e.description}</Text> : null}
      <Aide theme={theme}>{team.acces === 'competition' ? trCm('calendrier.lecture_competition') : trCm('calendrier.lecture_seule')}</Aide>
      <Retours theme={theme} erreur={erreur} prefixe="esport-cm-calendrier-detail" />
      {creerPost ? <BoutonHub theme={theme} titre={trCm('calendrier.creer_post')} variante="plein" desactive={enCours === 'creer'} onPress={() => void creer()} testID="esport-cm-calendrier-creer-post" /> : null}
    </Volet>
  );
}

