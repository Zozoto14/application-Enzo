/**
 * Calendrier éditorial de la section CM : posts prévus (date de publication) par semaine ou par mois, filtrés
 * par réseau. PC : grille de 7 colonnes ; téléphone : liste jour par jour. Heures du club (Europe/Paris).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BoutonHub, Segments } from '../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../hub/themes';
import type { ApiCm, CarteTransverse, Reseau } from '../../cm/api';
import { CLES_RESEAUX } from '../../cm/reseaux';
import { formaterDate } from '../../i18n';
import { trCm } from '../../i18n/cm';
import { Retours, styles, useAgir } from '../commun';
import { Carte, ESP, attenue, texte, type EtatPresse } from '../design';
import { FUSEAU_CLUB, PastilleReseau, TON_STATUT, murale, nomStatut } from './commun';

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

export function Calendrier({ theme, api, large, onOuvrirTableau }: { theme: ThemeHub; api: ApiCm; large: boolean; onOuvrirTableau(id: string): void }) {
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
                  {(parJour.get(j) ?? []).map(element)}
                </View>
              ))}
            </View>
          ))}
        </View>
      ) : (
        <View style={{ gap: ESP.s }}>
          {jours
            .filter(j => mode === 'semaine' || (parJour.get(j) ?? []).length)
            .map(j => (
              <Carte key={j} theme={theme} dense testID={`esport-cm-calendrier-jour-${j}`}>
                <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{formaterDate(`${j}T12:00:00Z`, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}</Text>
                {(parJour.get(j) ?? []).length ? (parJour.get(j) ?? []).map(element) : <Text style={attenue(theme)}>—</Text>}
              </Carte>
            ))}
          {mode === 'mois' && !(cartes ?? []).length ? <Text style={attenue(theme)}>{trCm('calendrier.vide')}</Text> : null}
        </View>
      )}
    </View>
  );
}

