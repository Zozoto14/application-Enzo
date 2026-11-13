/**
 * Petits blocs communs aux écrans des plans de match : badge de statut, date lisible, section titrée, étiquettes du
 * veto, texte sur plusieurs lignes.
 */

import React from 'react';
import { Text, View } from 'react-native';
import { teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { formaterDate } from '../../i18n';
import { trPm, type ClePm } from '../../i18n/plans';
import type { ActionVeto, CampVeto, ResumePlan, StatutPlan } from '../../plans/api';
import { Badge, ESP, attenue, rayonCarte, texte, type Ton } from '../design';

export const tonStatut = (s: StatutPlan): Ton => (s === 'pret' ? 'ok' : s === 'joue' ? 'accent' : 'neutre');

export function BadgeStatut({ theme, statut, testID }: { theme: ThemeHub; statut: StatutPlan; testID?: string }) {
  return <Badge theme={theme} ton={tonStatut(statut)} texte={trPm(`statut.${statut}` as ClePm)} testID={testID} />;
}

/** Jour d'un plan en clair (« sam. 14 novembre »), dans le fuseau de la team (le jour est déjà calculé par le serveur). */
export function jourPlan(dateMatch: string | null, options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'long' }): string | null {
  if (!dateMatch) return null;
  return formaterDate(`${dateMatch}T12:00:00.000Z`, { ...options, timeZone: 'UTC' });
}

/** « sam. 14 novembre à 21:00 » (événement lié), « sam. 14 novembre » (date libre), ou null. */
export function quandPlan(p: Pick<ResumePlan, 'dateMatch' | 'evenement'>): string | null {
  const jour = jourPlan(p.dateMatch);
  if (!jour) return null;
  return p.evenement?.heure ? trPm('date.a', { jour, heure: p.evenement.heure }) : jour;
}

/** Section d'une page ou de l'éditeur : titre, aide discrète, action à droite, contenu. */
export function Section({ theme, titre: t, aide, action, children, testID, accent }: { theme: ThemeHub; titre: string; aide?: string; action?: React.ReactNode; children: React.ReactNode; testID?: string; /** Liseré à gauche (« Mon rôle »). */ accent?: string }) {
  return (
    <View testID={testID} style={{ gap: ESP.s, padding: ESP.m, borderRadius: Math.min(rayonCarte(theme), 14), borderWidth: 1, borderColor: accent ?? theme.ligne, backgroundColor: accent ? teinteTransparente(accent, 0.08) : theme.surface, minWidth: 0 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s, flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <View style={{ flexShrink: 1, minWidth: 0, gap: 2 }}>
          <Text accessibilityRole="header" style={{ ...texte(theme, 15), fontWeight: '800' }}>
            {t}
          </Text>
          {aide ? <Text style={attenue(theme, 12)}>{aide}</Text> : null}
        </View>
        {action}
      </View>
      {children}
    </View>
  );
}

/** Intertitre discret à l'intérieur d'une section (« Composition », « Strats prévues »). */
export function SousTitre({ theme, children }: { theme: ThemeHub; children: string }) {
  return <Text style={{ ...attenue(theme, 11), fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 }}>{children}</Text>;
}

/** Étiquette « Nous » / « Eux » d'une étape de veto (jamais la couleur seule : le mot est écrit). */
export function EtiquetteCamp({ theme, camp }: { theme: ThemeHub; camp: CampVeto }) {
  const c = camp === 'nous' ? theme.accent : theme.attenue;
  return (
    <View style={{ borderWidth: 1, borderColor: teinteTransparente(c, 0.6), backgroundColor: teinteTransparente(c, 0.14), borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, minWidth: 44, alignItems: 'center' }}>
      <Text style={{ ...texte(theme, 11), fontWeight: '700' }}>{trPm(`veto.camp.${camp}` as ClePm)}</Text>
    </View>
  );
}

/** Étiquette d'une action de veto : ban (rouge), pick (vert), decider (neutre). */
export function EtiquetteAction({ theme, action }: { theme: ThemeHub; action: ActionVeto }) {
  const c = action === 'ban' ? theme.critique : action === 'pick' ? theme.ok : theme.alerte;
  return (
    <View style={{ borderWidth: 1, borderColor: teinteTransparente(c, 0.6), backgroundColor: teinteTransparente(c, 0.14), borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, minWidth: 52, alignItems: 'center' }}>
      <Text style={{ ...texte(theme, 11), fontWeight: '700' }}>{trPm(`veto.action.${action}` as ClePm)}</Text>
    </View>
  );
}

/** Texte libre sur plusieurs lignes (les retours à la ligne du staff sont gardés). */
export function TexteLibre({ theme, children }: { theme: ThemeHub; children: string }) {
  return <Text style={{ ...texte(theme, 14), lineHeight: 21 }}>{children}</Text>;
}
