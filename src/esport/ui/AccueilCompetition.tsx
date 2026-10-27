/**
 * Bloc « Compétition » de l'accueil d'une team : prochains matchs de tournoi, tournois à venir (module
 * Tournois, tournois.voir) et derniers résultats avec la forme (module Résultats, resultats.voir). Il
 * n'apparaît que si l'un des deux modules est activé et ouvert au rôle.
 */

import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub } from '../../hub/admin/ui/commun';
import type { ThemeHub } from '../../hub/themes';
import type { ClientEsport, DetailTeam } from '../client';
import { apiCompetition, type AccueilCompetition as Donnees } from '../competition/api';
import { demander } from '../competition/intention';
import { lettreForme, nomIssue, nomStatutTournoi, ordinal } from '../competition/libelles';
import { formaterDate, tr } from '../i18n';
import { Intertitre, Panneau, styles } from './commun';
import { Badge, ESP, attenue, texte } from './design';

export function AccueilCompetition({ theme, client, detail, onAller }: { theme: ThemeHub; client: ClientEsport; detail: DetailTeam; onAller(section: `module:${string}`): void }) {
  const actifs = new Set(detail.modules.filter(m => m.active).map(m => m.cle));
  const peut = (p: string) => detail.moi.permissions.includes(p);
  const voitT = actifs.has('tournois') && peut('tournois.voir');
  const voitR = actifs.has('resultats') && peut('resultats.voir');
  const [d, setD] = useState<Donnees | undefined>();
  const teamId = detail.team.id;
  useEffect(() => {
    if (!voitT && !voitR) return;
    let vivant = true;
    Promise.resolve()
      .then(() => apiCompetition(client).accueil(teamId))
      .then(r => vivant && setD(r))
      .catch(() => undefined);
    return () => {
      vivant = false;
    };
  }, [client, teamId, voitT, voitR]);
  if ((!voitT && !voitR) || !d) return null;
  const fuseau = detail.team.fuseau;
  const quand = (iso: string) => formaterDate(iso, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: fuseau });
  const jour = (j: string | null) => (j ? formaterDate(`${j}T12:00:00Z`, { day: 'numeric', month: 'short' }) : '');
  const ouvrirTournoi = (id: string) => {
    demander({ genre: 'tournoi', teamId, id });
    onAller('module:tournois');
  };
  const ouvrirResultat = (id: string) => {
    demander({ genre: 'resultat', teamId, id });
    onAller('module:resultats');
  };
  const rien = !d.prochains?.length && !d.tournois?.length && !d.derniers?.length;
  return (
    <Panneau theme={theme} testID="esport-accueil-competition">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: ESP.s, flexWrap: 'wrap' }}>
        <Intertitre theme={theme}>{tr('competition.accueil.titre')}</Intertitre>
        {d.forme?.length ? <Text style={attenue(theme, 13)} testID="esport-accueil-forme">{tr('competition.accueil.forme', { forme: d.forme.map(lettreForme).join(' ') })}</Text> : null}
      </View>
      {rien ? <Text style={attenue(theme)}>{tr('competition.accueil.vide')}</Text> : null}
      {d.prochains?.length ? (
        <View style={{ gap: 4 }} testID="esport-accueil-prochains-matchs">
          <Text style={{ ...texte(theme, 13), fontWeight: '700' }}>{tr('competition.accueil.prochains')}</Text>
          {d.prochains.map(m => (
            <Text key={m.id} style={texte(theme, 14)} numberOfLines={2} onPress={() => ouvrirTournoi(m.tournoi.id)} accessibilityRole="link">
              {[quand(m.debut), [m.tournoi.nom, m.tour].filter(Boolean).join(' · '), m.adversaires.length ? tr('competition.contre_court', { adversaire: m.adversaires.map(a => a.nom).join(', ') }) : null].filter(Boolean).join(' · ')}
            </Text>
          ))}
        </View>
      ) : null}
      {d.tournois?.length ? (
        <View style={{ gap: 4 }} testID="esport-accueil-tournois">
          <Text style={{ ...texte(theme, 13), fontWeight: '700' }}>{tr('competition.accueil.tournois')}</Text>
          {d.tournois.map(t => (
            <View key={t.id} style={[styles.ligne, { gap: ESP.xs, alignItems: 'center' }]}>
              <Text style={{ ...texte(theme, 14), flexShrink: 1 }} numberOfLines={1} onPress={() => ouvrirTournoi(t.id)} accessibilityRole="link">
                {[t.nom, jour(t.debut)].filter(Boolean).join(' · ')}
              </Text>
              <Badge theme={theme} texte={nomStatutTournoi(t.statut)} />
            </View>
          ))}
        </View>
      ) : null}
      {d.derniers?.length ? (
        <View style={{ gap: 4 }} testID="esport-accueil-derniers-resultats">
          <Text style={{ ...texte(theme, 13), fontWeight: '700' }}>{tr('competition.accueil.derniers')}</Text>
          {d.derniers.map(r => (
            <View key={r.id} style={[styles.ligne, { gap: ESP.xs, alignItems: 'center' }]}>
              <Badge theme={theme} ton={r.issue === 'victoire' ? 'ok' : r.issue === 'defaite' ? 'critique' : 'neutre'} texte={r.issue ? `${nomIssue(r.issue)}${r.score ? ` ${r.score}` : ''}` : ordinal(r.place, true)} />
              <Text style={{ ...texte(theme, 14), flexShrink: 1 }} numberOfLines={1} onPress={() => ouvrirResultat(r.id)} accessibilityRole="link">
                {[r.adversaires.map(a => a.nom).join(', '), r.tournoi?.nom, formaterDate(r.date, { day: 'numeric', month: 'short', timeZone: fuseau })].filter(Boolean).join(' · ')}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      <View style={[styles.ligne, { gap: ESP.xs }]}>
        {voitT ? <BoutonHub theme={theme} titre={tr('competition.accueil.voir_tournois')} onPress={() => onAller('module:tournois')} testID="esport-accueil-aller-tournois" /> : null}
        {voitR ? <BoutonHub theme={theme} titre={tr('competition.accueil.voir_resultats')} onPress={() => onAller('module:resultats')} testID="esport-accueil-aller-resultats" /> : null}
      </View>
    </Panneau>
  );
}
