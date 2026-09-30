/** Section « Applications » : registre, activation globale, maintenance, accès par défaut. */

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import type { Profil } from '../../../profils/profils';
import { police } from '../../themes';
import type { AppHub } from '../../types';
import { changerPolitiquePar } from '../actions';
import { niveauProfil } from '../comptes';
import { LIBELLES_NIVEAU, niveauxDe } from '../niveaux';
import { LONGUEUR_MAX_MESSAGE, etatApp, modifierEtatApp } from '../politique';
import { exiger } from '../roles';
import { BoutonHub, Champ, Interrupteur, Panneau, Pilule, Segments, commun, type OutilsAdmin } from './commun';

export function Applications({ outils }: { outils: OutilsAdmin }) {
  const { theme, registre } = outils;
  return (
    <View style={{ gap: 16 }} testID="admin-section-applications">
      <Text style={{ color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) }}>
        Les apps viennent du registre du hub. Une app désactivée disparaît du hub de tous les autres utilisateurs ; en maintenance, sa tuile
        affiche votre message et ne s’ouvre plus pour eux. Vous gardez toujours l’accès.
      </Text>
      {registre.map(app => (
        <CarteApp key={app.id} outils={outils} app={app} />
      ))}
    </View>
  );
}

function CarteApp({ outils, app }: { outils: OutilsAdmin; app: AppHub }) {
  const { theme, tous } = outils;
  const etat = etatApp(outils.politique, app.id);
  const [message, setMessage] = useState(etat.maintenance ?? '');
  const utilisateurs = tous.filter(p => niveauProfil(p, app) !== 'aucun').length;
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const attenue = { color: theme.attenue, ...police(theme.policeTexte) };
  const modifier = (changement: Parameters<typeof modifierEtatApp>[2], action: string) =>
    outils.controle.onPolitique
      ? // Fondateur autre que le compte historique : la politique s'enregistre à part.
        outils.agir('Enregistrement…', async () => {
          exiger(outils.acteur, 'politique-apps');
          await outils.controle.onPolitique!(modifierEtatApp(outils.politique, app.id, changement));
          outils.journaliser({ type: 'app', app: app.id, action });
        })
      : outils.modifierProfils(
      (liste: readonly Profil[]) => changerPolitiquePar(outils.acteur, liste, modifierEtatApp(liste.find(p => p.admin)?.politique, app.id, changement)),
      [{ type: 'app', app: app.id, action }],
    );
  const statut = !etat.active ? { texte: 'désactivée', couleur: theme.critique } : etat.maintenance !== undefined ? { texte: 'maintenance', couleur: theme.alerte } : { texte: 'active', couleur: theme.ok };
  return (
    <Panneau theme={theme} testID={`admin-registre-${app.id}`}>
      <View style={commun.ligne}>
        <View style={[commun.carre, { backgroundColor: theme.teintes[app.teinte], borderRadius: Math.min(theme.rayonMoyen, 8) }]}>
          <Text style={{ color: theme.surAccent, fontWeight: '700' }}>{app.icone}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[texte, { fontWeight: '700', fontSize: 16 }]}>{app.nom}</Text>
          <Text style={[attenue, { fontSize: 12 }, police(theme.policeChiffres)]}>
            {app.id} · {app.adminSeulement ? 'administrateur seulement' : `${utilisateurs} utilisateur${utilisateurs > 1 ? 's' : ''}`} · niveaux :{' '}
            {niveauxDe(app)
              .filter(n => n !== 'aucun')
              .map(n => LIBELLES_NIVEAU[n].toLowerCase())
              .join(', ')}
          </Text>
        </View>
        <Pilule theme={theme} texte={statut.texte} couleur={statut.couleur} testID={`admin-app-statut-${app.id}`} />
      </View>
      <Text style={[attenue, { fontSize: 13 }]}>{app.description}</Text>
      {app.adminSeulement ? (
        <Text style={[attenue, { fontSize: 12 }]}>
          Réservée à l’administrateur (les gestionnaires n’y ont qu’une version limitée) : ni activation globale ni maintenance.
        </Text>
      ) : (
        <>
          <View style={commun.ligne}>
            <Text style={[texte, { flex: 1 }]}>Activée pour les autres utilisateurs</Text>
            <Interrupteur
              theme={theme}
              libelle={`Activer ${app.nom} pour tous`}
              valeur={etat.active}
              testID={`admin-app-active-${app.id}`}
              desactive={Boolean(outils.enCours)}
              onChanger={v => modifier({ active: v }, v ? `${app.nom} réactivée pour tous` : `${app.nom} désactivée pour tous (sauf l’administrateur)`)}
            />
          </View>
          <View style={{ gap: 8 }}>
            <View style={commun.ligne}>
              <Text style={[texte, { flex: 1 }]}>Mode maintenance</Text>
              <Interrupteur
                theme={theme}
                libelle={`Maintenance de ${app.nom}`}
                valeur={etat.maintenance !== undefined}
                testID={`admin-app-maintenance-${app.id}`}
                desactive={Boolean(outils.enCours)}
                onChanger={v =>
                  modifier(
                    { maintenance: v ? message : undefined },
                    v ? `${app.nom} en maintenance${message.trim() ? ` : « ${message.trim()} »` : ''}` : `${app.nom} sortie de maintenance`,
                  )
                }
              />
            </View>
            <Champ
              theme={theme}
              libelle="Message affiché sur la tuile"
              valeur={message}
              onChanger={setMessage}
              maxLength={LONGUEUR_MAX_MESSAGE}
              placeholder="ex. Mise à jour en cours, retour vers 18 h"
              testID={`admin-app-message-${app.id}`}
            />
            <Text style={[attenue, { fontSize: 12 }]} testID={`admin-app-maintenance-aide-${app.id}`}>
              En maintenance, l’app reste visible sur le hub avec ton message, mais les amis ne peuvent pas l’ouvrir ; toi seul·e peux encore l’ouvrir. Utile
              pour une mise à jour ou un souci. À ne pas confondre avec Désactiver : l’app disparaît alors pour tous sauf toi.
            </Text>
            {etat.maintenance !== undefined && message !== etat.maintenance ? (
              <View style={commun.actions}>
                <BoutonHub
                  theme={theme}
                  titre="Mettre à jour le message"
                  testID={`admin-app-message-enregistrer-${app.id}`}
                  onPress={() => modifier({ maintenance: message }, `Message de maintenance de ${app.nom} modifié`)}
                />
              </View>
            ) : null}
          </View>
          <View style={{ gap: 6 }}>
            <Text style={[texte, { fontWeight: '600', fontSize: 13 }]}>Accès par défaut des nouveaux comptes</Text>
            <Segments
              theme={theme}
              libelle={`Accès par défaut à ${app.nom}`}
              valeur={etat.defaut}
              options={niveauxDe(app).map(n => [n, LIBELLES_NIVEAU[n]] as const)}
              onChoisir={v => modifier({ defaut: v }, `Accès par défaut à ${app.nom} : ${LIBELLES_NIVEAU[v].toLowerCase()}`)}
              testID={`admin-app-defaut-${app.id}`}
            />
            {app.descriptionNiveaux?.lecture ? <Text style={[attenue, { fontSize: 12 }]}>Lecture seule : {app.descriptionNiveaux.lecture}</Text> : null}
          </View>
        </>
      )}
    </Panneau>
  );
}
