/** Sécurité, version téléphone : un point = une cellule (état à droite), verrouillage en bouton principal. */

import React from 'react';
import { BoutonPrincipal, Cellule, GroupeCellules } from '../../../../ui/mobile';
import { bilanSecurite, type EtatPoint } from '../../securite';
import { Pilule, dateLisible, type OutilsAdmin } from '../commun';
import { Aide, CadreAdmin } from './briques';

const LIBELLES: Record<EtatPoint, string> = { ok: 'OK', alerte: 'À surveiller', critique: 'À corriger', inconnu: 'Inconnu' };

export function Securite({ outils, onRetour, onVerrouiller }: { outils: OutilsAdmin; onRetour(): void; onVerrouiller(): void }) {
  const { theme, donnees } = outils;
  let coffre;
  try {
    coffre = outils.services?.etatCoffre();
  } catch {
    coffre = undefined;
  }
  const points = bilanSecurite(coffre, donnees.robustesse, donnees.reglages);
  const couleur = (etat: EtatPoint) => (etat === 'ok' ? theme.ok : etat === 'alerte' ? theme.alerte : etat === 'critique' ? theme.critique : theme.attenue);
  return (
    <CadreAdmin
      theme={theme}
      titre="Sécurité"
      libelleRetour="Administration"
      onRetour={onRetour}
      testID="admin-section-securite"
      pied={<BoutonPrincipal theme={theme} titre="🔒 Verrouiller le panneau" onPress={onVerrouiller} desactive={!outils.services} testID="admin-verrouiller-panneau" />}>
      <GroupeCellules theme={theme} titre="Vue d’ensemble" note={donnees.robustesse ? `Dernière évaluation : ${dateLisible(donnees.robustesse.le, true)}` : undefined}>
        {points.map(point => (
          <Cellule key={point.id} theme={theme} titre={point.titre} sousTitre={point.detail} testID={`admin-securite-${point.id}`} droite={<Pilule theme={theme} texte={LIBELLES[point.etat]} couleur={couleur(point.etat)} />} />
        ))}
      </GroupeCellules>
      <GroupeCellules theme={theme} titre="Verrouillage du panneau">
        <Cellule
          theme={theme}
          titre="Vérifier mon identité"
          sousTitre="Mot de passe et code d’authentification"
          chevron
          desactive={!outils.services}
          testID="admin-verifier-identite"
          onPress={() => outils.exigerIdentite('Évaluer la robustesse du mot de passe', () => undefined, true)}
        />
        <Cellule theme={theme} titre="Régler les délais" chevron testID="admin-vers-reglages" onPress={() => outils.allerA('reglages')} />
      </GroupeCellules>
      <Aide theme={theme}>
        {donnees.reglages.verrouMinutes > 0
          ? `Le panneau se verrouille après ${donnees.reglages.verrouMinutes} min sans activité et redemande votre mot de passe et votre code d’authentification.`
          : 'Le verrouillage automatique est désactivé (Réglages).'}{' '}
        Aucun secret existant n’est jamais réaffiché : un identifiant perdu se régénère.
        {!outils.services ? ' Vérification d’identité indisponible sur cette plateforme.' : ''}
      </Aide>
    </CadreAdmin>
  );
}
