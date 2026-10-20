/**
 * « Créer un compte » depuis l'Esport (Fondateur, sur son appareil) : nom ou
 * pseudo, adresse e-mail, teams avec un rôle par team et, en option, le poste
 * en jeu. Une action crée le compte du hub (modèle « Esport seulement ») et
 * le pré-enregistre dans ses teams ; puis le message d'invitation s'ouvre
 * dans la messagerie de l'appareil (`mailto:`), prêt à partir.
 */

import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { PanneauInvitation } from '../../hub/admin/ui/EnvoiInvitation';
import { Avis, BoutonHub, Case, Champ } from '../../hub/admin/ui/commun';
import { police, type ThemeHub } from '../../hub/themes';
import type { AppHub, ContexteHub } from '../../hub/types';
import type { Affectation, Annuaire, ClientEsport, TeamAnnuaire } from '../client';
import { creerCompteEsport, erreurSaisie, modeleInvitationEsport, noterEnvoiEsport, rattacherCompte, type CompteCree } from '../comptesHub';
import { Choix, Retours, styles as communs, useAgir, Intertitre, Panneau } from './commun';

type Choisie = { roleId: string; poste: string };

/** Rôle proposé par défaut : Joueur s'il est attribuable, sinon le dernier rôle attribuable. */
export function roleParDefaut(team: TeamAnnuaire): string | undefined {
  const possibles = team.roles.filter(r => r.attribuable);
  return (possibles.find(r => r.cle === 'joueur') ?? possibles[possibles.length - 1])?.id;
}

export function CreationCompte({
  theme,
  client,
  contexte,
  registre,
  annuaire,
  exigerIdentite,
  equipeInitiale,
  onFini,
  onAnnuler,
}: {
  theme: ThemeHub;
  client: ClientEsport;
  contexte: ContexteHub;
  registre: readonly AppHub[];
  annuaire: Annuaire;
  exigerIdentite(raison: string, action: () => void): void;
  equipeInitiale?: string;
  onFini(): void;
  onAnnuler(): void;
}) {
  const teams = useMemo(() => annuaire.teams.filter(t => t.droits.ajouter && !t.archivee), [annuaire.teams]);
  const [nom, setNom] = useState('');
  const [email, setEmail] = useState('');
  const [choisies, setChoisies] = useState<Record<string, Choisie>>(() => {
    const t = teams.find(x => x.id === equipeInitiale) ?? (teams.length === 1 ? teams[0] : undefined);
    const role = t ? roleParDefaut(t) : undefined;
    return t && role ? { [t.id]: { roleId: role, poste: '' } } : {};
  });
  const [cree, setCree] = useState<CompteCree | undefined>();
  const { enCours, erreur, avis, agir } = useAgir();
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };

  const affectations: Affectation[] = Object.entries(choisies).map(([teamId, c]) => ({ teamId, roleId: c.roleId, ...(c.poste.trim() ? { posteJeu: c.poste.trim() } : {}) }));
  const nomsTeams = affectations.map(a => teams.find(t => t.id === a.teamId)?.nom ?? '?');
  const probleme = erreurSaisie({ nom, email, affectations });

  const creer = () =>
    exigerIdentite(`Créer le compte de ${nom.trim()}`, () =>
      void agir('Création', async () => {
        const r = await creerCompteEsport({ contexte, registre, client, saisie: { nom, email, affectations }, nomsTeams, maintenant: contexte.maintenant ?? Date.now() });
        setCree(r);
        return r.erreurEsport ? undefined : `Compte de ${r.nom} créé : ${nomsTeams.join(', ')}. Envoyez-lui l’invitation ci-dessous.`;
      }),
    );

  if (cree) {
    return (
      <Panneau theme={theme} testID="esport-compte-cree">
        <Intertitre theme={theme}>{`Invitation de ${cree.nom}`}</Intertitre>
        <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-compte" />
        {cree.erreurEsport ? (
          <View style={{ gap: 8 }}>
            <Avis
              theme={theme}
              genre="alerte"
              texte={`Le compte du hub de ${cree.nom} est créé, mais l’Esport n’a pas pu l’ajouter à ses teams (${cree.erreurEsport}). Réessayez avant d’envoyer l’invitation.`}
              testID="esport-compte-rattachement-echec"
            />
            <BoutonHub
              theme={theme}
              titre={enCours ? 'Nouvel essai…' : 'Réessayer l’ajout aux teams'}
              variante="plein"
              desactive={Boolean(enCours)}
              onPress={() =>
                void agir('Rattacher', async () => {
                  const fiche = await rattacherCompte(client, cree.id, cree.nom, affectations);
                  setCree({ ...cree, fiche, erreurEsport: undefined });
                  return `${cree.nom} est ajouté à ses teams.`;
                })
              }
              testID="esport-compte-rattacher"
            />
          </View>
        ) : null}
        <Text style={texte}>
          {`${cree.nom} ouvre le lien, choisit son mot de passe, et retrouve directement ${nomsTeams.length > 1 ? 'ses teams' : 'sa team'} dans l’Esport : aucun code à saisir.`}
        </Text>
        <PanneauInvitation
          theme={theme}
          nom={cree.nom}
          invitation={cree.invitation}
          email={cree.email}
          modele={modeleInvitationEsport(nomsTeams)}
          fondateur={contexte.profils?.actuel.nom}
          onEnvoye={canal => noterEnvoiEsport(contexte, cree.id, cree.nom, canal)}
        />
        <View style={[communs.ligne, { justifyContent: 'flex-end' }]}>
          <BoutonHub theme={theme} titre="Terminé" variante="plein" onPress={onFini} testID="esport-compte-termine" />
        </View>
      </Panneau>
    );
  }

  return (
    <Panneau theme={theme} testID="esport-creation-compte">
      <Intertitre theme={theme}>Créer un compte</Intertitre>
      <Text style={attenue}>
        Le compte est créé dans l’Administration (rang Ami, « Esport seulement » : il ne verra que l’Esport) et ajouté tout de suite à ses teams. Il reçoit un
        e-mail avec un lien à usage unique : il choisit son mot de passe à sa première connexion.
      </Text>
      <View style={[communs.ligne, { alignItems: 'flex-start', gap: 12 }]}>
        <Champ theme={theme} libelle="Nom ou pseudo (son identifiant)" valeur={nom} onChanger={setNom} maxLength={24} placeholder="ex. Léa" testID="esport-compte-nom" style={{ flexGrow: 1, flexBasis: 220 }} />
        <Champ theme={theme} libelle="Adresse e-mail" valeur={email} onChanger={setEmail} maxLength={254} placeholder="lea@exemple.fr" testID="esport-compte-email" style={{ flexGrow: 1, flexBasis: 260 }} />
      </View>
      <Text style={attenue}>L’adresse reste chiffrée dans l’Administration du Fondateur : le serveur Esport ne la voit jamais.</Text>
      <Intertitre theme={theme}>Teams et rôles</Intertitre>
      {teams.length === 0 ? <Text style={attenue}>Aucune team : créez d’abord une team (onglet Teams).</Text> : null}
      {teams.map(t => {
        const c = choisies[t.id];
        return (
          <View key={t.id} style={{ gap: 8, paddingVertical: 6, borderTopWidth: 1, borderTopColor: theme.ligne }}>
            <View style={communs.ligne}>
              <Case
                theme={theme}
                coche={Boolean(c)}
                libelle={`Ajouter à ${t.nom}`}
                onChanger={v =>
                  setChoisies(avant => {
                    const suite = { ...avant };
                    const role = roleParDefaut(t);
                    if (v && role) suite[t.id] = { roleId: role, poste: '' };
                    else delete suite[t.id];
                    return suite;
                  })
                }
                testID={`esport-compte-team-${t.slug}`}
              />
              <Text style={[texte, { fontWeight: '700' }]}>{t.nom}</Text>
            </View>
            {c ? (
              <View style={{ gap: 8, paddingLeft: 30 }}>
                <Choix
                  theme={theme}
                  libelle={`Rôle dans ${t.nom}`}
                  valeur={c.roleId}
                  options={t.roles.map(r => ({ id: r.id, nom: r.nom, couleur: r.couleur, desactive: !r.attribuable }))}
                  onChoisir={roleId => setChoisies(avant => ({ ...avant, [t.id]: { ...avant[t.id], roleId } }))}
                  testID={`esport-compte-role-${t.slug}`}
                />
                <Champ
                  theme={theme}
                  libelle="Poste en jeu (facultatif)"
                  valeur={c.poste}
                  onChanger={poste => setChoisies(avant => ({ ...avant, [t.id]: { ...avant[t.id], poste } }))}
                  maxLength={30}
                  placeholder="ex. Duelliste, IGL"
                  testID={`esport-compte-poste-${t.slug}`}
                />
              </View>
            ) : null}
          </View>
        );
      })}
      {nom || email ? <Text style={[attenue, { color: probleme ? theme.alerte : theme.ok }]} testID="esport-compte-etat">{probleme ?? 'Prêt : le compte sera créé, puis l’e-mail d’invitation préparé.'}</Text> : null}
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-compte" />
      <View style={[communs.ligne, { justifyContent: 'flex-end' }]}>
        <BoutonHub theme={theme} titre="Annuler" onPress={onAnnuler} testID="esport-compte-annuler" />
        <BoutonHub
          theme={theme}
          titre={enCours ? 'Création du compte…' : 'Créer le compte et l’invitation'}
          variante="plein"
          desactive={Boolean(enCours) || Boolean(probleme)}
          onPress={creer}
          testID="esport-compte-creer"
        />
      </View>
    </Panneau>
  );
}
