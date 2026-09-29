/** Section « Sécurité » : vue d'ensemble, verrouillage du panneau. */

import React from 'react';
import { Text, View } from 'react-native';
import { police } from '../../themes';
import type { AlerteAdmin } from '../comptes';
import { alertesDuBilan, bilanSecurite, type EtatPoint } from '../securite';
import { BoutonHub, Intertitre, Panneau, Pilule, commun, dateLisible, type OutilsAdmin } from './commun';

function bilan(outils: OutilsAdmin) {
  let coffre;
  try {
    coffre = outils.services?.etatCoffre();
  } catch {
    coffre = undefined;
  }
  return bilanSecurite(coffre, outils.donnees.robustesse, outils.donnees.reglages);
}

export function alertesSecurite(outils: OutilsAdmin): AlerteAdmin[] {
  return alertesDuBilan(bilan(outils));
}

const LIBELLES: Record<EtatPoint, string> = { ok: 'OK', alerte: 'À surveiller', critique: 'À corriger', inconnu: 'Inconnu' };

export function Securite({ outils, onVerrouiller }: { outils: OutilsAdmin; onVerrouiller(): void }) {
  const { theme, donnees } = outils;
  const points = bilan(outils);
  const couleur = (etat: EtatPoint) => (etat === 'ok' ? theme.ok : etat === 'alerte' ? theme.alerte : etat === 'critique' ? theme.critique : theme.attenue);
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const attenue = { color: theme.attenue, ...police(theme.policeTexte) };
  return (
    <View style={{ gap: 16 }} testID="admin-section-securite">
      <Panneau theme={theme}>
        <Intertitre theme={theme}>Vue d’ensemble</Intertitre>
        {points.map((point, index) => (
          <View key={point.id} style={[commun.ligne, { alignItems: 'flex-start' }, index > 0 && { borderTopWidth: 1, borderTopColor: theme.ligne }]} testID={`admin-securite-${point.id}`}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[texte, { fontWeight: '600' }]}>{point.titre}</Text>
              <Text style={[attenue, { fontSize: 13 }]}>{point.detail}</Text>
            </View>
            <Pilule theme={theme} texte={LIBELLES[point.etat]} couleur={couleur(point.etat)} />
          </View>
        ))}
        {donnees.robustesse ? <Text style={[attenue, { fontSize: 12 }]}>Dernière évaluation : {dateLisible(donnees.robustesse.le, true)}</Text> : null}
      </Panneau>

      <Panneau theme={theme}>
        <Intertitre theme={theme}>Verrouillage du panneau</Intertitre>
        <Text style={[attenue, { fontSize: 13 }]}>
          {donnees.reglages.verrouMinutes > 0
            ? `Le panneau se verrouille après ${donnees.reglages.verrouMinutes} min sans activité et redemande votre mot de passe et votre code d’authentification.`
            : 'Le verrouillage automatique est désactivé (Réglages).'}{' '}
          Aucun secret existant n’est jamais réaffiché : un identifiant perdu se régénère.
        </Text>
        <View style={commun.actions}>
          <BoutonHub theme={theme} titre="🔒 Verrouiller le panneau" onPress={onVerrouiller} testID="admin-verrouiller-panneau" desactive={!outils.services} />
          <BoutonHub
            theme={theme}
            titre="Vérifier mon identité"
            testID="admin-verifier-identite"
            desactive={!outils.services}
            onPress={() => outils.exigerIdentite('Évaluer la robustesse du mot de passe', () => undefined, true)}
          />
          <BoutonHub theme={theme} titre="Régler les délais →" onPress={() => outils.allerA('reglages')} testID="admin-vers-reglages" />
        </View>
        {!outils.services ? <Text style={[attenue, { fontSize: 12 }]}>Vérification d’identité indisponible sur cette plateforme.</Text> : null}
      </Panneau>
    </View>
  );
}
