/**
 * Calendrier éditorial de la section CM : posts prévus (date de publication) par semaine ou par mois, filtrés
 * par réseau. PC : grille de 7 colonnes ; téléphone : liste jour par jour. Heures du club (Europe/Paris).
 *
 * Calendriers des teams (superposés, LECTURE SEULE) : matchs, tournois, scrims et événements de chaque team que
 * le compte a le droit de voir (planning s'il en est membre ; sinon compétition publiable seulement : voir
 * esport/noyau/cm/calendriers.mjs). Un interrupteur par team (sa couleur), choix mémorisé par compte en base
 * (`calendrier.teams`). Toucher un événement : son détail, et « Créer un post pour cet événement ».
 *
 * Cartes datées (migration 0074) : les cartes à échéance des tableaux « au calendrier » (réglage du tableau, oui par
 * défaut) y sont, liées à leur carte (toucher : la fiche s'ouvre). Avec cm.editer : la poignée « ⠿ » se dépose sur un
 * autre jour (même heure murale, heure du club) et change l'échéance de la carte ; « Nouvelle carte » crée une carte
 * datée sur un tableau et une colonne choisis. Changer l'échéance dans la fiche la déplace ici (temps réel).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, Text, View, type GestureResponderEvent, type PanResponderGestureState, type ViewStyle } from 'react-native';
import { BoutonHub, Champ, Segments } from '../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { PORTEE_CLUB, type ApiCm, type CalendrierTeam, type CarteDatee, type CarteTransverse, type EvenementTeam, type ListeCm, type Reseau, type TableauListe } from '../../cm/api';
import { deplacerAuJour, finEcheance, jourSous, saisieVersInstant, type CaseJour } from '../../cm/calendrier';
import { useTempsReel } from '../../tempsReel/hooks';
import { bloquerSelection, libererSelection, STYLE_SAISISSABLE } from './selectionGlisser';
import { CLES_RESEAUX } from '../../cm/reseaux';
import { couleurUrgence, fondCarteUrgence } from '../../cm/urgence';
import { formaterDate } from '../../i18n';
import { trCm, type CleCm } from '../../i18n/cm';
import { Choix, Retours, styles, useAgir } from '../commun';
import { Badge, Carte, ESP, Volet, attenue, texte, type EtatPresse } from '../design';
import { Aide, ChampInstant, FUSEAU_CLUB, PastilleReseau, TON_STATUT, murale, nomListe, nomStatut, nomTableau, quand } from './commun';
import { PastilleUrgence, FiltreUrgenceCm, libelleUrgence, passeFiltreUrgence, type FiltreUrgence } from './Drapeau';

type Mode = 'semaine' | 'mois';
const JOUR = 86_400_000;

/** « Maintenant » pour la grille : midi (UTC) du jour calendaire du club, sinon entre minuit et 1 h/2 h à Paris la grille resterait sur la veille UTC. */
const maintenantClub = (): number => Date.parse(`${murale(new Date().toISOString(), FUSEAU_CLUB).date}T12:00:00Z`);
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
  onOuvrirCarte,
  creerPost = false,
}: {
  theme: ThemeHub;
  api: ApiCm;
  large: boolean;
  onOuvrirTableau(id: string): void;
  /** Ouvre la fiche d'une carte datée (sinon : son tableau). */
  onOuvrirCarte?(tableauId: string, carteId: string): void;
  /** Le compte prépare des posts (cm.editer quelque part) : « Créer un post pour cet événement », « Nouvelle carte ». */
  creerPost?: boolean;
}) {
  const [mode, setMode] = useState<Mode>(large ? 'mois' : 'semaine');
  const [reference, setReference] = useState(maintenantClub);
  const [reseau, setReseau] = useState<Reseau | ''>('');
  const [urgence, setUrgence] = useState<FiltreUrgence>('');
  const [cartes, setCartes] = useState<CarteTransverse[] | undefined>();
  const [echeances, setEcheances] = useState<CarteDatee[]>([]);
  const { erreur, avis, agir } = useAgir();
  const jours = useMemo(() => joursDe(mode, reference), [mode, reference]);
  const charger = useCallback(async () => {
    const r = await api.calendrier(jours[0], jours[jours.length - 1], reseau || undefined);
    setCartes(r.cartes);
    setEcheances(Array.isArray(r.echeances) ? r.echeances : []);
  }, [api, jours, reseau]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);
  // Une carte datée change ailleurs (fiche, autre personne, To do) : le calendrier suit (sauf pendant un glisser).
  const glisseEnCours = useRef(false);
  useTempsReel(api.client, 'cm', () => {
    if (!glisseEnCours.current) void charger().catch(() => undefined);
  });
  const [nouvelle, setNouvelle] = useState<string | undefined>();
  // Glisser une carte datée vers un autre jour (grille du PC) : cases mesurées au début du geste.
  const refsJours = useRef(new Map<string, React.ComponentRef<typeof View>>());
  const cases = useRef<CaseJour[]>([]);
  const [cibleJour, setCibleJour] = useState<string | undefined>();
  const cibleJourRef = useRef<string | undefined>(undefined);
  const mesurerJours = useCallback(async () => {
    const lignes = await Promise.all(
      [...refsJours.current.entries()].map(
        ([jour, v]) =>
          new Promise<CaseJour | null>(ok => {
            const m = (v as unknown as { measureInWindow?: (f: (x: number, y: number, l: number, h: number) => void) => void }).measureInWindow;
            if (typeof m !== 'function') return ok(null);
            try {
              m.call(v, (x, y, l, h) => ok(Number.isFinite(x) && l > 0 ? { jour, x, y, l, h } : null));
            } catch {
              ok(null);
            }
          }),
      ),
    );
    cases.current = lignes.filter((x): x is CaseJour => Boolean(x));
  }, []);
  /** Dépose une carte datée sur un jour : même heure murale (club) ; l'échéance de la carte change (cm.editer). */
  const deplacerEcheance = useCallback(
    (c: CarteDatee, jour: string) => {
      if (murale(c.echeance, FUSEAU_CLUB).date === jour) return;
      const echeance = deplacerAuJour(c.echeance, jour, FUSEAU_CLUB);
      setEcheances(l => l.map(x => (x.id === c.id ? { ...x, echeance } : x)));
      void agir('deplacer', async () => {
        await api.modifierCarte(c.id, { echeance, versionAttendue: c.version });
        await charger();
        return trCm('calendrier.deplacee', { titre: c.titre, date: formaterDate(`${jour}T12:00:00Z`, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }) });
      }).then(ok => {
        if (!ok) void charger().catch(() => undefined);
      });
    },
    [agir, api, charger],
  );
  const glisser = {
    debut: () => {
      glisseEnCours.current = true;
      void mesurerJours();
    },
    bouge: (x: number, y: number) => {
      const j = jourSous(cases.current, x, y);
      if (j !== cibleJourRef.current) {
        cibleJourRef.current = j;
        setCibleJour(j);
      }
    },
    fin: (c: CarteDatee, annuler: boolean) => {
      const j = cibleJourRef.current;
      glisseEnCours.current = false;
      cibleJourRef.current = undefined;
      setCibleJour(undefined);
      if (!annuler && j) deplacerEcheance(c, j);
    },
  };
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
    for (const c of (cartes ?? []).filter(x => passeFiltreUrgence(urgence, x.urgence))) {
      const j = murale(c.datePublication, FUSEAU_CLUB).date;
      if (!m.has(j)) m.set(j, []);
      m.get(j)!.push(c);
    }
    return m;
  }, [cartes, urgence]);
  const echeancesParJour = useMemo(() => {
    const m = new Map<string, CarteDatee[]>();
    for (const c of echeances.filter(x => passeFiltreUrgence(urgence, x.urgence))) {
      const j = murale(c.echeance, FUSEAU_CLUB).date;
      if (!m.has(j)) m.set(j, []);
      m.get(j)!.push(c);
    }
    return m;
  }, [echeances, urgence]);
  const decaler = (sens: number) => {
    const d = new Date(reference);
    setReference(mode === 'semaine' ? reference + sens * 7 * JOUR : Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + sens, 15));
  };
  const mois = new Date(reference).getUTCMonth();
  const titre = mode === 'mois' ? formaterDate(reference, { month: 'long', year: 'numeric', timeZone: 'UTC' }) : trCm('calendrier.semaine_du', { date: formaterDate(`${jours[0]}T12:00:00Z`, { day: 'numeric', month: 'long', timeZone: 'UTC' }) });
  const aujourdhui = murale(new Date().toISOString(), FUSEAU_CLUB).date;

  const element = (c: CarteTransverse) => {
    const couleurStatut = c.statut ? (TON_STATUT[c.statut] === 'ok' ? theme.ok : TON_STATUT[c.statut] === 'alerte' ? theme.alerte : TON_STATUT[c.statut] === 'critique' ? theme.critique : theme.accent) : theme.ligne;
    return (
    <Pressable
      key={c.id}
      accessibilityRole="button"
      accessibilityLabel={`${c.titre}, ${murale(c.datePublication, FUSEAU_CLUB).heure}${c.statut ? `, ${nomStatut(c.statut)}` : ''}${c.urgence ? `, ${trCm('urgence.carte', { niveau: libelleUrgence(c.urgence) })}` : ''}`}
      onPress={() => onOuvrirTableau(c.tableauId)}
      testID={`esport-cm-calendrier-${c.id}`}
      style={(e: EtatPresse) => ({
        // Bande du niveau d'urgence à gauche ; la couleur du statut passe alors sur le bord droit.
        borderLeftWidth: c.urgence ? 6 : 3,
        borderLeftColor: c.urgence ? couleurUrgence(c.urgence, theme.sombre) : couleurStatut,
        ...(c.urgence ? { borderRightWidth: 3, borderRightColor: couleurStatut } : null),
        backgroundColor: e.hovered || e.focused ? teinteTransparente(theme.accent, 0.12) : fondCarteUrgence(c.urgence, theme.surface, theme.sombre),
        borderRadius: 6,
        padding: 4,
        gap: 2,
        minHeight: 36,
      })}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 3 }}>
        <Text style={{ ...texte(theme, 12), fontWeight: '700', flex: 1, minWidth: 0 }} numberOfLines={2}>{`${murale(c.datePublication, FUSEAU_CLUB).heure} · ${c.titre}`}</Text>
      </View>
      {c.urgence ? <PastilleUrgence theme={theme} niveau={c.urgence} sansLibelleAccessible testID={`esport-cm-calendrier-${c.id}-urgence`} /> : null}
      <View style={{ flexDirection: 'row', gap: 2, flexWrap: 'wrap' }}>
        {c.reseaux.map(r => (
          <PastilleReseau key={r} theme={theme} reseau={r} compact />
        ))}
      </View>
    </Pressable>
    );
  };

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
  const elementEcheance = (c: CarteDatee) => {
    const fin = finEcheance(c.echeance, c.echeanceDuree);
    const heure = `${murale(c.echeance, FUSEAU_CLUB).heure}${fin ? `–${murale(fin, FUSEAU_CLUB).heure}` : ''}`;
    const couleur = c.urgence && !c.terminee ? couleurUrgence(c.urgence, theme.sombre) : theme.accent;
    const deplacable = large && c.droits.editer && !c.terminee;
    return (
      <View key={`e-${c.id}`} style={{ flexDirection: 'row', alignItems: 'stretch', borderRadius: 6, borderWidth: 1, borderStyle: 'dashed', borderColor: teinteTransparente(couleur, 0.7), backgroundColor: fondCarteUrgence(c.terminee ? null : c.urgence, theme.surface, theme.sombre), opacity: c.terminee ? 0.6 : 1 }} testID={`esport-cm-calendrier-carte-${c.id}`}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={trCm('calendrier.echeance_libelle', { titre: c.titre, heure, tableau: c.tableau ? nomTableau(c.tableau) : '' })}
          accessibilityHint={trCm('calendrier.echeance_ouvrir')}
          onPress={() => (onOuvrirCarte ? onOuvrirCarte(c.tableauId, c.id) : onOuvrirTableau(c.tableauId))}
          testID={`esport-cm-calendrier-carte-${c.id}-ouvrir`}
          style={(e: EtatPresse) => ({ flex: 1, minWidth: 0, padding: 4, gap: 2, minHeight: 32, borderRadius: 6, backgroundColor: e.hovered || e.focused ? teinteTransparente(theme.accent, 0.12) : 'transparent' })}>
          <Text style={{ ...texte(theme, 12), fontWeight: '700', ...(c.terminee ? { textDecorationLine: 'line-through', color: theme.attenue } : null) }} numberOfLines={2}>{`⚑ ${heure} · ${c.titre}`}</Text>
          {c.urgence && !c.terminee ? <PastilleUrgence theme={theme} niveau={c.urgence} sansLibelleAccessible testID={`esport-cm-calendrier-carte-${c.id}-urgence`} /> : null}
          <Text style={attenue(theme, 11)} numberOfLines={1}>{[c.tableau ? nomTableau(c.tableau) : '', c.liste ? nomListe(c.liste) : ''].filter(Boolean).join(' · ')}</Text>
        </Pressable>
        {deplacable ? <PoigneeEcheance theme={theme} titre={c.titre} glisser={{ debut: glisser.debut, bouge: glisser.bouge, fin: annuler => glisser.fin(c, annuler) }} testID={`esport-cm-calendrier-carte-${c.id}-poignee`} /> : null}
      </View>
    );
  };
  const contenuJour = (j: string) => [...(parJour.get(j) ?? []).map(element), ...(echeancesParJour.get(j) ?? []).map(elementEcheance), ...(evenementsParJour.get(j) ?? []).map(evenement)];
  const videJour = (j: string) => !(parJour.get(j) ?? []).length && !(echeancesParJour.get(j) ?? []).length && !(evenementsParJour.get(j) ?? []).length;

  return (
    <View style={{ gap: ESP.m }} testID="esport-cm-calendrier">
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <View style={[styles.ligne, { gap: ESP.xs, maxWidth: '100%' }]}>
          <BoutonHub theme={theme} titre="‹" libelle={trCm('calendrier.precedent')} onPress={() => decaler(-1)} testID="esport-cm-calendrier-precedent" />
          <BoutonHub theme={theme} titre={trCm('calendrier.aujourdhui')} onPress={() => setReference(maintenantClub())} testID="esport-cm-calendrier-aujourdhui" />
          <BoutonHub theme={theme} titre="›" libelle={trCm('calendrier.suivant')} onPress={() => decaler(1)} testID="esport-cm-calendrier-suivant" />
          <Text accessibilityRole="header" style={{ ...texte(theme, 18), fontWeight: '800', flexShrink: 1 }} testID="esport-cm-calendrier-titre">
            {titre}
          </Text>
        </View>
        <View style={[styles.ligne, { gap: ESP.xs }]}>
          {creerPost ? <BoutonHub theme={theme} titre={trCm('calendrier.nouvelle_carte')} variante="plein" onPress={() => setNouvelle(jours.includes(aujourdhui) ? aujourdhui : jours[0])} testID="esport-cm-calendrier-nouvelle" /> : null}
          <Segments theme={theme} libelle={trCm('calendrier.vue')} valeur={mode} options={[['semaine', trCm('calendrier.semaine')], ['mois', trCm('calendrier.mois')]]} onChoisir={v => setMode(v as Mode)} testID="esport-cm-calendrier-mode" />
        </View>
      </View>
      <View style={[styles.ligne, { gap: ESP.xs }]}>
        <BoutonHub theme={theme} titre={trCm('calendrier.tous_reseaux')} variante={reseau ? 'normal' : 'plein'} onPress={() => setReseau('')} testID="esport-cm-calendrier-reseau-tous" />
        {CLES_RESEAUX.map(r => (
          <PastilleReseau key={r} theme={theme} reseau={r} actif={reseau === r} onPress={() => setReseau(reseau === r ? '' : r)} testID={`esport-cm-calendrier-reseau-${r}`} />
        ))}
      </View>
      <FiltreUrgenceCm theme={theme} valeur={urgence} onChoisir={setUrgence} testID="esport-cm-calendrier-urgence" />
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
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-cm-calendrier" />
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
                <View
                  key={j}
                  ref={r => {
                    if (r) refsJours.current.set(j, r);
                    else refsJours.current.delete(j);
                  }}
                  style={{ flex: 1, minHeight: mode === 'mois' ? 110 : 260, padding: 4, gap: 4, borderLeftWidth: 1, borderLeftColor: theme.ligne, backgroundColor: cibleJour === j ? teinteTransparente(theme.accent, 0.22) : j === aujourdhui ? teinteTransparente(theme.accent, 0.08) : 'transparent', opacity: mode === 'mois' && Number(j.slice(5, 7)) - 1 !== mois ? 0.5 : 1 }}
                  testID={`esport-cm-calendrier-jour-${j}`}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={{ ...attenue(theme, 12), fontWeight: j === aujourdhui ? '800' : '400' }}>{String(Number(j.slice(8)))}</Text>
                    {creerPost ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={trCm('calendrier.nouvelle_carte_jour', { date: formaterDate(`${j}T12:00:00Z`, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }) })}
                        onPress={() => setNouvelle(j)}
                        hitSlop={6}
                        testID={`esport-cm-calendrier-jour-${j}-nouvelle`}
                        style={(e: EtatPresse) => ({ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: e.hovered || e.focused ? teinteTransparente(theme.accent, 0.18) : 'transparent' })}>
                        <Text style={{ color: theme.attenue, fontSize: 15, lineHeight: 17 }}>+</Text>
                      </Pressable>
                    ) : null}
                  </View>
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
      {nouvelle ? (
        <NouvelleCarteDatee
          theme={theme}
          api={api}
          jour={nouvelle}
          onFermer={() => setNouvelle(undefined)}
          onCree={titre => {
            setNouvelle(undefined);
            void agir('nouvelle', async () => {
              await charger();
              return trCm('calendrier.nouvelle.creee', { titre });
            });
          }}
        />
      ) : null}
      {detail ? <DetailEvenement theme={theme} api={api} detail={detail} creerPost={creerPost} onFermer={() => setDetail(undefined)} onOuvrirTableau={onOuvrirTableau} /> : null}
    </View>
  );
}

const TYPES_EVENEMENT = ['match', 'scrim', 'tournament', 'review', 'other', 'training', 'meeting'];

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


/** Poignée « ⠿ » d'une carte datée : se saisit (souris ou doigt) et se dépose sur un autre jour de la grille. */
function PoigneeEcheance({ theme, titre, glisser, testID }: { theme: ThemeHub; titre: string; glisser: { debut(): void; bouge(x: number, y: number): void; fin(annuler: boolean): void }; testID: string }) {
  const rappel = useRef(glisser);
  rappel.current = glisser;
  const geste = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e: GestureResponderEvent) => {
        e.preventDefault?.();
        bloquerSelection();
        rappel.current.debut();
      },
      onPanResponderMove: (_e: GestureResponderEvent, g: PanResponderGestureState) => rappel.current.bouge(g.moveX, g.moveY),
      onPanResponderRelease: () => {
        libererSelection();
        rappel.current.fin(false);
      },
      onPanResponderTerminate: () => {
        libererSelection();
        rappel.current.fin(true);
      },
    }),
  ).current;
  useEffect(() => libererSelection, []);
  return (
    <View
      {...geste.panHandlers}
      testID={testID}
      accessibilityLabel={trCm('calendrier.poignee', { titre })}
      accessibilityHint={trCm('calendrier.poignee_aide')}
      style={{ width: 20, alignItems: 'center', justifyContent: 'center', cursor: 'grab', ...STYLE_SAISISSABLE } as unknown as ViewStyle}>
      <Text style={{ color: theme.attenue, fontSize: 13 }}>⠿</Text>
    </View>
  );
}

/**
 * « Nouvelle carte » depuis le calendrier : tableau (ceux où le compte édite et qui sont au calendrier), colonne, titre,
 * échéance (jour touché, midi par défaut ; heure du club). La carte créée est au calendrier tout de suite.
 */
export function NouvelleCarteDatee({ theme, api, jour, onFermer, onCree }: { theme: ThemeHub; api: ApiCm; jour: string; onFermer(): void; onCree(titre: string, tableauId: string, carteId: string): void }) {
  const [tableaux, setTableaux] = useState<TableauListe[] | undefined>();
  const [tableauId, setTableauId] = useState<string | undefined>();
  const [listes, setListes] = useState<ListeCm[]>([]);
  const [listeId, setListeId] = useState<string | undefined>();
  const [titre, setTitre] = useState('');
  const [echeance, setEcheance] = useState<string | null>(`${jour} 12:00`);
  const { erreur, agir, enCours } = useAgir();
  useEffect(() => {
    void agir('', async () => {
      const permis = (await api.tableaux()).tableaux.filter(t => t.droits?.editer && t.calendrier !== false && !t.archive);
      setTableaux(permis);
      setTableauId(t => t ?? permis[0]?.id);
    });
  }, [agir, api]);
  useEffect(() => {
    if (!tableauId) return undefined;
    let vivant = true;
    void agir('', async () => {
      const d = await api.tableau(tableauId);
      if (!vivant) return;
      const actives = d.listes.filter(l => !l.archive);
      setListes(actives);
      setListeId((actives.find(l => !l.fin) ?? actives[0])?.id);
    });
    return () => {
      vivant = false;
    };
  }, [agir, api, tableauId]);
  const instant = saisieVersInstant(echeance, FUSEAU_CLUB);
  const pret = Boolean(tableauId && listeId && titre.trim() && instant);
  const creer = () =>
    agir('creer', async () => {
      if (!tableauId || !listeId || !instant) return;
      const r = await api.creerCarte(tableauId, { listeId, titre: titre.trim().slice(0, 200), echeance: instant });
      onCree(titre.trim(), tableauId, r.carte.id);
    });
  // Valeur initiale du champ : ISO (le champ affiche l'heure du club) ; ensuite, la saisie « AAAA-MM-JJ HH:MM ».
  const valeurChamp = useMemo(() => saisieVersInstant(`${jour} 12:00`, FUSEAU_CLUB), [jour]);
  return (
    <Volet theme={theme} visible titre={trCm('calendrier.nouvelle_carte')} onFermer={onFermer} testID="esport-cm-calendrier-nouvelle-volet">
      {tableaux && !tableaux.length ? <Aide theme={theme}>{trCm('calendrier.nouvelle.aucun')}</Aide> : null}
      {tableaux?.length ? (
        <>
          <Choix theme={theme} libelle={trCm('calendrier.nouvelle.tableau')} valeur={tableauId} repliable options={tableaux.map(t => ({ id: t.id, nom: `${nomTableau(t)}${t.team?.nom ? ` · ${t.team.nom}` : ''}`, couleur: t.couleur }))} onChoisir={setTableauId} testID="esport-cm-calendrier-nouvelle-tableau" />
          {listes.length ? <Choix theme={theme} libelle={trCm('calendrier.nouvelle.liste')} valeur={listeId} repliable options={listes.map(l => ({ id: l.id, nom: nomListe(l) }))} onChoisir={setListeId} testID="esport-cm-calendrier-nouvelle-liste" /> : null}
          <Champ theme={theme} libelle={trCm('calendrier.nouvelle.titre')} valeur={titre} onChanger={setTitre} maxLength={200} testID="esport-cm-calendrier-nouvelle-titre" />
          <ChampInstant theme={theme} libelle={trCm('fiche.echeance')} valeur={valeurChamp} fuseau={FUSEAU_CLUB} onChanger={setEcheance} testID="esport-cm-calendrier-nouvelle-echeance" />
          <Aide theme={theme}>{trCm('calendrier.nouvelle.aide')}</Aide>
          <BoutonHub theme={theme} titre={trCm('calendrier.nouvelle.creer')} variante="plein" desactive={!pret || enCours === 'creer'} onPress={() => void creer()} testID="esport-cm-calendrier-nouvelle-creer" />
        </>
      ) : null}
      <Retours theme={theme} erreur={erreur} prefixe="esport-cm-calendrier-nouvelle" />
    </Volet>
  );
}
