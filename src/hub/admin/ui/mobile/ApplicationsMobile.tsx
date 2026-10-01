/** Applications, version téléphone : une carte par app, interrupteurs larges (cellules), accès par défaut en feuille. */

import React, { useState } from 'react';
import { View } from 'react-native';
import { BoutonPrincipal, Cellule, ChampMobile, GroupeCellules } from '../../../../ui/mobile';
import type { Profil } from '../../../../profils/profils';
import type { AppHub } from '../../../types';
import { changerPolitiquePar } from '../../actions';
import { niveauProfil } from '../../comptes';
import { LIBELLES_NIVEAU, niveauxDe, type NiveauAcces } from '../../niveaux';
import { LONGUEUR_MAX_MESSAGE, etatApp, modifierEtatApp } from '../../politique';
import { exiger } from '../../roles';
import { Pilule, type OutilsAdmin } from '../commun';
import { Aide, CadreAdmin, CelluleChoix } from './briques';

export function Applications({ outils, onRetour }: { outils: OutilsAdmin; onRetour(): void }) {
  const { theme, registre } = outils;
  return (
    <CadreAdmin theme={theme} titre="Applications" libelleRetour="Admin" onRetour={onRetour} testID="admin-section-applications">
      <Aide theme={theme}>
        Les apps viennent du registre du hub. Une app désactivée disparaît du hub de tous les autres utilisateurs ; en maintenance, sa tuile affiche votre message et ne s’ouvre plus pour eux. Vous gardez toujours l’accès.
      </Aide>
      {registre.map(app => (
        <CarteApp key={app.id} outils={outils} app={app} />
      ))}
    </CadreAdmin>
  );
}

function CarteApp({ outils, app }: { outils: OutilsAdmin; app: AppHub }) {
  const { theme, tous } = outils;
  const etat = etatApp(outils.politique, app.id);
  const [message, setMessage] = useState(etat.maintenance ?? '');
  const utilisateurs = tous.filter(p => niveauProfil(p, app) !== 'aucun').length;
  const modifier = (changement: Parameters<typeof modifierEtatApp>[2], action: string) =>
    outils.controle.onPolitique
      ? outils.agir('Enregistrement…', async () => {
          exiger(outils.acteur, 'politique-apps');
          await outils.controle.onPolitique!(modifierEtatApp(outils.politique, app.id, changement));
          outils.journaliser({ type: 'app', app: app.id, action });
        })
      : outils.modifierProfils(
          (liste: readonly Profil[]) => changerPolitiquePar(outils.acteur, liste, modifierEtatApp(liste.find(p => p.admin)?.politique, app.id, changement)),
          [{ type: 'app', app: app.id, action }],
        );
  const statut = !etat.active ? { texte: 'désactivée', couleur: theme.critique } : etat.maintenance !== undefined ? { texte: 'maintenance', couleur: theme.alerte } : { texte: 'active', couleur: theme.ok };
  const niveaux = niveauxDe(app);
  return (
    <GroupeCellules theme={theme} titre={`${app.icone}  ${app.nom}`} testID={`admin-registre-${app.id}`}>
      <Cellule
        theme={theme}
        titre="Statut"
        sousTitre={`${app.adminSeulement ? 'Administrateur seulement' : `${utilisateurs} utilisateur${utilisateurs > 1 ? 's' : ''}`} · ${app.description}`}
        droite={<Pilule theme={theme} texte={statut.texte} couleur={statut.couleur} testID={`admin-app-statut-${app.id}`} />}
      />
      {app.adminSeulement ? (
        <Cellule theme={theme} titre="Réservée à l’administrateur" sousTitre="Les gestionnaires n’y ont qu’une version limitée : ni activation globale ni maintenance." />
      ) : (
        <Cellule
          theme={theme}
          titre="Activée pour les autres"
          sousTitre="Désactivée, l’app disparaît du hub des autres utilisateurs."
          desactive={Boolean(outils.enCours)}
          testID={`admin-app-active-${app.id}`}
          interrupteur={{ valeur: etat.active, onChanger: v => modifier({ active: v }, v ? `${app.nom} réactivée pour tous` : `${app.nom} désactivée pour tous (sauf l’administrateur)`) }}
        />
      )}
      {app.adminSeulement ? null : (
        <Cellule
          theme={theme}
          titre="Mode maintenance"
          sousTitre="La tuile reste visible avec votre message, mais ne s’ouvre plus pour les amis."
          desactive={Boolean(outils.enCours)}
          testID={`admin-app-maintenance-${app.id}`}
          interrupteur={{
            valeur: etat.maintenance !== undefined,
            onChanger: v => modifier({ maintenance: v ? message : undefined }, v ? `${app.nom} en maintenance${message.trim() ? ` : « ${message.trim()} »` : ''}` : `${app.nom} sortie de maintenance`),
          }}
        />
      )}
      {app.adminSeulement ? null : (
        <CelluleChoix
          theme={theme}
          titre="Accès par défaut des nouveaux comptes"
          options={niveaux.map(n => ({ cle: n, titre: LIBELLES_NIVEAU[n] }))}
          valeur={etat.defaut}
          description={app.descriptionNiveaux?.lecture ? `Lecture seule : ${app.descriptionNiveaux.lecture}` : undefined}
          testID={`admin-app-defaut-${app.id}`}
          onChoisir={n => modifier({ defaut: n as NiveauAcces }, `Accès par défaut à ${app.nom} : ${LIBELLES_NIVEAU[n as NiveauAcces].toLowerCase()}`)}
        />
      )}
      {app.adminSeulement ? null : (
        <MessageMaintenance
          outils={outils}
          app={app}
          message={message}
          onChanger={setMessage}
          modifie={etat.maintenance !== undefined && message !== etat.maintenance}
          onEnregistrer={() => modifier({ maintenance: message }, `Message de maintenance de ${app.nom} modifié`)}
        />
      )}
    </GroupeCellules>
  );
}

function MessageMaintenance({ outils, app, message, onChanger, modifie, onEnregistrer }: { outils: OutilsAdmin; app: AppHub; message: string; onChanger(v: string): void; modifie: boolean; onEnregistrer(): void }) {
  const { theme } = outils;
  return (
    <View style={{ padding: 16, gap: 12 }}>
      <ChampMobile
        theme={theme}
        etiquette="Message affiché sur la tuile"
        value={message}
        onChangeText={onChanger}
        maxLength={LONGUEUR_MAX_MESSAGE}
        placeholder="ex. Mise à jour en cours, retour vers 18 h"
        indication="À ne pas confondre avec Désactiver : l’app disparaît alors pour tous sauf vous."
        enterKeyHint="done"
        testID={`admin-app-message-${app.id}`}
      />
      {modifie ? <BoutonPrincipal theme={theme} variante="discret" titre="Mettre à jour le message" onPress={onEnregistrer} testID={`admin-app-message-enregistrer-${app.id}`} /> : null}
    </View>
  );
}
