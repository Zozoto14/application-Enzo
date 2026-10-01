/** Tableau de bord, version téléphone : tuiles 2 × 2, alertes et activité en cellules. */

import React from 'react';
import { View } from 'react-native';
import { Cellule, GroupeCellules } from '../../../../ui/mobile';
import { alertesComptes, statistiques, type AlerteAdmin } from '../../comptes';
import { LIBELLES_TYPE } from '../../journal';
import { alertesSecurite } from '../Securite';
import { dateDuJour, lignesAbo, resumeRappels } from '../../../abonnements/abonnements';
import { comptesSuivis, peutVoirAbonnements } from '../../../abonnements/actionsAbo';
import { dateLisible, relatif, type OutilsAdmin } from '../commun';
import { Aide, CadreAdmin, TuileChiffre } from './briques';

export function Tableau({ outils, onRetour }: { outils: OutilsAdmin; onRetour(): void }) {
  const { theme, tous, apercu, registre, donnees } = outils;
  const gestionnaire = outils.role === 'gestionnaire';
  const maintenant = outils.maintenant();
  const stats = statistiques(apercu, registre, outils.politique, maintenant);
  const alertes: AlerteAdmin[] = [...(gestionnaire ? [] : alertesSecurite(outils)), ...alertesComptes(tous, maintenant, donnees.reglages.inactifJours)];
  const resumeAbo = peutVoirAbonnements(outils.acteur) ? resumeRappels(lignesAbo(comptesSuivis(outils.acteur, tous), donnees.abonnements, dateDuJour(maintenant))) : undefined;
  const autres = outils.controle.gestion?.autres ?? 0;
  const recents = [...donnees.journal].reverse().slice(0, 8);
  const vers = (id: 'utilisateurs') => () => outils.allerA(id);
  return (
    <CadreAdmin theme={theme} titre="Tableau de bord" libelleRetour="Administration" onRetour={onRetour} testID="admin-section-tableau">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <TuileChiffre theme={theme} libelle="Comptes" valeur={stats.total} testID="admin-stat-total" onPress={vers('utilisateurs')} />
        <TuileChiffre theme={theme} libelle="Actifs" valeur={stats.actifs} testID="admin-stat-actifs" onPress={vers('utilisateurs')} />
        <TuileChiffre theme={theme} libelle="Désactivés" valeur={stats.desactives} testID="admin-stat-desactives" onPress={vers('utilisateurs')} />
        <TuileChiffre theme={theme} libelle="Invités en attente" valeur={stats.invites} testID="admin-stat-invites" onPress={vers('utilisateurs')} />
      </View>

      {resumeAbo && resumeAbo.texte ? (
        <GroupeCellules theme={theme}>
          <Cellule theme={theme} glyphe="🔔" teinte={resumeAbo.retard > 0 ? theme.critique : theme.alerte} titre={resumeAbo.texte} chevron testID="admin-abonnements-rappel" onPress={() => outils.allerA('abonnements')} />
        </GroupeCellules>
      ) : null}

      {gestionnaire ? (
        <GroupeCellules theme={theme} titre="Vos comptes" testID="admin-gestion-resume">
          <Cellule
            theme={theme}
            titre={`Vous gérez ${tous.length} ami${tous.length > 1 ? 's' : ''}`}
            sousTitre={`${autres > 0 ? `${autres} autre${autres > 1 ? 's' : ''} compte${autres > 1 ? 's' : ''} de cet appareil ne ${autres > 1 ? 'vous sont' : 'vous est'} pas montré${autres > 1 ? 's' : ''}` : 'Les autres comptes de cet appareil ne vous sont pas montrés'} : chaque compte reste isolé.`}
          />
        </GroupeCellules>
      ) : null}

      <GroupeCellules theme={theme} titre={`Alertes (${alertes.length})`} testID="admin-alertes">
        {alertes.length === 0 ? (
          <Cellule theme={theme} glyphe="✓" teinte={theme.ok} titre="Aucune alerte" sousTitre="Tout est en ordre." />
        ) : (
          alertes.map((alerte, index) => {
            const couleur = alerte.gravite === 'critique' ? theme.critique : alerte.gravite === 'alerte' ? theme.alerte : theme.accent;
            return (
              <Cellule
                key={`${alerte.genre}-${alerte.cible ?? index}`}
                theme={theme}
                glyphe="!"
                teinte={couleur}
                titre={alerte.message}
                chevron
                testID={`admin-alerte-${alerte.genre}`}
                onPress={() => (alerte.cible ? outils.allerA('utilisateurs', alerte.cible) : outils.allerA('securite'))}
              />
            );
          })
        )}
      </GroupeCellules>

      <GroupeCellules theme={theme} titre="Applications">
        {stats.parApp.map(({ app, utilisateurs, active, maintenance }) => (
          <Cellule
            key={app.id}
            theme={theme}
            glyphe={app.icone}
            teinte={theme.teintes[app.teinte]}
            titre={app.nom}
            sousTitre={`${utilisateurs} utilisateur${utilisateurs > 1 ? 's' : ''}${!active ? ' · désactivée' : maintenance ? ' · maintenance' : ''}`}
          />
        ))}
      </GroupeCellules>
      {gestionnaire ? null : (
        <Aide theme={theme} testID="admin-derniere-activite">
          Dernière activité : {stats.derniereActivite ? `${stats.derniereActivite.nom}, ${relatif(stats.derniereActivite.date, maintenant)}` : 'aucune connexion notée'}
        </Aide>
      )}

      <GroupeCellules theme={theme} titre={gestionnaire ? 'Vos dernières actions' : 'Activité récente'}>
        {recents.length === 0 ? <Cellule theme={theme} titre="Rien pour l’instant" /> : null}
        {recents.map((e, index) => (
          <Cellule
            key={`${e.date}-${index}`}
            theme={theme}
            titre={`${e.acteur ? `[${e.acteur}] ` : ''}${e.action}`}
            sousTitre={`${dateLisible(e.date, true)} · ${LIBELLES_TYPE[e.type]}`}
          />
        ))}
        <Cellule theme={theme} titre="Tout le journal" chevron testID="admin-voir-journal" onPress={() => outils.allerA('journal')} />
      </GroupeCellules>
    </CadreAdmin>
  );
}
