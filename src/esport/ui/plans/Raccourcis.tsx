/**
 * Raccourcis vers le plan de match depuis d'autres écrans :
 *  - ProchainPlan : carte « Prochain plan de match » de l'accueil d'une team (plan lié à un événement à venir) ;
 *  - BoutonPlanMatch : bouton d'un événement du planning (match, scrim, tournoi) qui ouvre son plan, ou le crée (staff).
 * Rien ne s'affiche sans le module, sans le droit de lire les plans, ou sans plan à montrer.
 */

import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import type { ClientEsport, DetailTeam } from '../../client';
import { trPm } from '../../i18n/plans';
import { apiPlans, type ResumePlan } from '../../plans/api';
import { demanderPlan } from '../../plans/intention';
import { Carte, ESP, attenue, texte } from '../design';
import { BadgeStatut, quandPlan } from './blocs';

/** Le lecteur voit-il les plans de match de cette team ? */
export const voitPlans = (detail: DetailTeam): boolean => detail.modules.some(m => m.cle === 'plans_match' && m.active) && detail.moi.permissions.includes('plans.voir');

export const TYPES_AVEC_PLAN: readonly string[] = ['match', 'scrim', 'tournament'];

export function ProchainPlan({ theme, client, detail, onOuvrir }: { theme: ThemeHub; client: ClientEsport; detail: DetailTeam; onOuvrir(): void }) {
  const [plan, setPlan] = useState<ResumePlan | null | undefined>();
  const visible = voitPlans(detail);
  const teamId = detail.team.id;
  useEffect(() => {
    if (!visible) return undefined;
    let vivant = true;
    apiPlans(client)
      .prochain(teamId)
      .then(r => vivant && setPlan(r.plan), () => vivant && setPlan(null));
    return () => {
      vivant = false;
    };
  }, [client, teamId, visible]);
  if (!visible || !plan) return null;
  return (
    <Carte theme={theme} accent={theme.accent} testID="esport-accueil-plan">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s, flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <View style={{ flexShrink: 1, minWidth: 0, gap: 3 }}>
          <Text style={{ ...attenue(theme, 11), fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 }}>{trPm('accueil.titre')}</Text>
          <Text accessibilityRole="header" numberOfLines={2} style={{ ...texte(theme, 18), fontWeight: '800' }}>
            {plan.adversaire?.nom ? trPm('contre', { nom: plan.adversaire.nom }).replace(/^./, c => c.toUpperCase()) : plan.titre}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xs, flexWrap: 'wrap' }}>
            <BadgeStatut theme={theme} statut={plan.statut} />
            <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{quandPlan(plan) ?? ''}</Text>
            {plan.cartes.length ? <Text style={attenue(theme, 12)}>{plan.cartes.slice(0, 5).join(' · ')}</Text> : null}
          </View>
        </View>
        <BoutonHub
          theme={theme}
          titre={trPm('accueil.ouvrir')}
          variante="plein"
          onPress={() => {
            demanderPlan({ id: plan.id });
            onOuvrir();
          }}
          testID="esport-accueil-plan-ouvrir"
        />
      </View>
    </Carte>
  );
}

export function BoutonPlanMatch({ theme, client, detail, evenementId, occurrence, type, onOuvrir }: { theme: ThemeHub; client: ClientEsport; detail: DetailTeam; evenementId: string; occurrence: string; type: string; onOuvrir(): void }) {
  const [etat, setEtat] = useState<{ plan: ResumePlan | null; editer: boolean } | undefined>();
  const visible = voitPlans(detail) && TYPES_AVEC_PLAN.includes(type);
  const teamId = detail.team.id;
  useEffect(() => {
    if (!visible) return undefined;
    let vivant = true;
    setEtat(undefined);
    apiPlans(client)
      .pourEvenement(teamId, evenementId, occurrence)
      .then(r => vivant && setEtat({ plan: r.plan, editer: r.droits.editer }), () => undefined);
    return () => {
      vivant = false;
    };
  }, [client, teamId, evenementId, occurrence, visible]);
  if (!visible || !etat || (!etat.plan && !etat.editer)) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xs, flexWrap: 'wrap' }} testID="esport-evenement-plan">
      <BoutonHub
        theme={theme}
        titre={etat.plan ? trPm('planning.bouton') : trPm('planning.creer')}
        icone="drapeau"
        variante={etat.plan ? 'plein' : 'normal'}
        onPress={() => {
          demanderPlan(etat.plan ? { id: etat.plan.id } : { evenement: evenementId, occurrence });
          onOuvrir();
        }}
        testID="esport-evenement-plan-ouvrir"
      />
      {etat.plan ? <BadgeStatut theme={theme} statut={etat.plan.statut} /> : null}
    </View>
  );
}
