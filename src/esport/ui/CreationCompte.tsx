/**
 * « Créer un compte » depuis l'Esport (Fondateur, sur son appareil) : nom ou
 * pseudo, adresse e-mail, Discord ID (OBLIGATOIRE : le bot pingue les
 * convoqués avec), teams avec un rôle par team et, en option, le poste en jeu.
 * Une action crée le compte du hub (modèle « Esport seulement ») et le
 * pré-enregistre dans ses teams ; puis l'invitation part par e-mail —
 * directement par le serveur s'il est configuré, sinon par la messagerie de
 * l'appareil (`mailto:`).
 */

import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { PanneauInvitation } from '../../hub/admin/ui/EnvoiInvitation';
import { Avis, BoutonHub, Case, Champ } from '../../hub/admin/ui/commun';
import { police, type ThemeHub } from '../../hub/themes';
import type { AppHub, ContexteHub } from '../../hub/types';
import type { Affectation, Annuaire, ClientEsport, DemandeCompte, TeamAnnuaire } from '../client';
import { creerCompteEsport, erreurSaisie, modeleInvitationEsport, noterEnvoiEsport, rattacherCompte, type CompteCree } from '../comptesHub';
import { Choix, Retours, styles as communs, useAgir, Intertitre, Panneau } from './commun';
import { tr, type Langue } from '../i18n';
import { ChoixLangue } from './ChoixLangue';
import { nomRole } from '../client';
import { ChampDiscordId } from './DiscordId';

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
  demande,
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
  /** Validation d'une demande de compte : saisie préremplie, demande close avec la création. */
  demande?: DemandeCompte;
  onFini(): void;
  onAnnuler(): void;
}) {
  const teams = useMemo(() => annuaire.teams.filter(t => t.droits.ajouter && !t.archivee), [annuaire.teams]);
  const [nom, setNom] = useState(demande?.pseudo ?? '');
  const [email, setEmail] = useState(demande?.email ?? '');
  const [discordId, setDiscordId] = useState(demande?.discordId ?? '');
  // Langue par défaut du compte : français sauf choix du Fondateur (interface, e-mails, bot Discord).
  const [langue, setLangue] = useState<Langue>('fr');
  const [choisies, setChoisies] = useState<Record<string, Choisie>>(() => {
    if (demande && teams.some(x => x.id === demande.teamId)) return { [demande.teamId]: { roleId: demande.role.id, poste: demande.posteJeu ?? '' } };
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
  const probleme = erreurSaisie({ nom, email, discordId, affectations });

  const creer = () =>
    exigerIdentite(tr('creationCompte.creer_le_compte_de', { v: nom.trim() }), () =>
      void agir('creation', async () => {
        const r = await creerCompteEsport({ contexte, registre, client, saisie: { nom, email, discordId, langue, affectations, ...(demande ? { demandeId: demande.id } : {}) }, nomsTeams, maintenant: contexte.maintenant ?? Date.now() });
        setCree(r);
        return r.erreurEsport ? undefined : tr('creationCompte.compte_de_cree_envoyez', { nom: r.nom, v: nomsTeams.join(', ') });
      }),
    );

  if (cree) {
    return (
      <Panneau theme={theme} testID="esport-compte-cree">
        <Intertitre theme={theme}>{tr('creationCompte.invitation_de', { nom: cree.nom })}</Intertitre>
        <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-compte" />
        {cree.erreurEsport ? (
          <View style={{ gap: 8 }}>
            <Avis
              theme={theme}
              genre="alerte"
              texte={tr('creationCompte.le_compte_du_hub', { nom: cree.nom, erreurEsport: cree.erreurEsport })}
              testID="esport-compte-rattachement-echec"
            />
            <BoutonHub
              theme={theme}
              titre={enCours ? tr('creationCompte.nouvel_essai') : tr('creationCompte.reessayer_l_ajout_aux')}
              variante="plein"
              desactive={Boolean(enCours)}
              onPress={() =>
                void agir('rattacher', async () => {
                  const fiche = await rattacherCompte(client, cree.id, cree.nom, affectations, demande?.id, cree.discordId, cree.langue);
                  setCree({ ...cree, fiche, erreurEsport: undefined });
                  return tr('creationCompte.est_ajoute_a_ses', { nom: cree.nom });
                })
              }
              testID="esport-compte-rattacher"
            />
          </View>
        ) : null}
        <Text style={texte}>
          {tr(nomsTeams.length > 1 ? 'creationCompte.recap_teams' : 'creationCompte.recap_team', { nom: cree.nom })}
        </Text>
        <PanneauInvitation
          theme={theme}
          nom={cree.nom}
          invitation={cree.invitation}
          email={cree.email}
          modele={modeleInvitationEsport(nomsTeams, 'fr')}
          modeleEn={modeleInvitationEsport(nomsTeams, 'en')}
          langueInitiale={cree.langue}
          fondateur={contexte.profils?.actuel.nom}
          onEnvoye={canal => noterEnvoiEsport(contexte, cree.id, cree.nom, canal)}
        />
        <View style={[communs.ligne, { justifyContent: 'flex-end' }]}>
          <BoutonHub theme={theme} titre={tr('creationCompte.termine')} variante="plein" onPress={onFini} testID="esport-compte-termine" />
        </View>
      </Panneau>
    );
  }

  return (
    <Panneau theme={theme} testID="esport-creation-compte">
      <Intertitre theme={theme}>{demande ? tr('creationCompte.valider_la_demande_de', { nom: demande.demandeurPseudo ?? tr('creationCompte.un_membre') }) : tr('creationCompte.creer_un_compte')}</Intertitre>
      {demande?.message ? <Text style={attenue}>{`« ${demande.message} »`}</Text> : null}
      <Text style={attenue}>
        {tr('creationCompte.le_compte_est_cree')}</Text>
      <View style={[communs.ligne, { alignItems: 'flex-start', gap: 12 }]}>
        <Champ theme={theme} libelle={tr('creationCompte.nom_ou_pseudo_son')} valeur={nom} onChanger={setNom} maxLength={24} placeholder={tr('creationCompte.ex_lea')} testID="esport-compte-nom" style={{ flexGrow: 1, flexBasis: 220 }} />
        <Champ theme={theme} libelle={tr('creationCompte.adresse_e_mail')} valeur={email} onChanger={setEmail} maxLength={254} placeholder={tr('creationCompte.ex_email')} testID="esport-compte-email" style={{ flexGrow: 1, flexBasis: 260 }} />
      </View>
      <Text style={attenue}>{tr('creationCompte.l_adresse_reste_chiffree')}</Text>
      <ChampDiscordId theme={theme} valeur={discordId} onChanger={setDiscordId} obligatoire testID="esport-compte-discord-id" />
      <ChoixLangue theme={theme} libelle={tr('langueCompte.libelle')} valeur={langue} onChoisir={setLangue} testID="esport-compte-langue" />
      <Text style={attenue}>{tr('langueCompte.aide')}</Text>
      <Intertitre theme={theme}>{tr('creationCompte.teams_et_roles')}</Intertitre>
      {teams.length === 0 ? <Text style={attenue}>{tr('creationCompte.aucune_team_creez_d')}</Text> : null}
      {teams.map(t => {
        const c = choisies[t.id];
        return (
          <View key={t.id} style={{ gap: 8, paddingVertical: 6, borderTopWidth: 1, borderTopColor: theme.ligne }}>
            <View style={communs.ligne}>
              <Case
                theme={theme}
                coche={Boolean(c)}
                libelle={tr('ajoutTeams.ajouter_a', { nom: t.nom })}
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
                  libelle={tr('ajoutTeams.role_dans', { nom: t.nom })}
                  valeur={c.roleId}
                  options={t.roles.map(r => ({ id: r.id, nom: nomRole(r.nom), couleur: r.couleur, desactive: !r.attribuable }))}
                  onChoisir={roleId => setChoisies(avant => ({ ...avant, [t.id]: { ...avant[t.id], roleId } }))}
                  testID={`esport-compte-role-${t.slug}`}
                />
                <Champ
                  theme={theme}
                  libelle={tr('ajoutTeams.poste_en_jeu_facultatif')}
                  valeur={c.poste}
                  onChanger={poste => setChoisies(avant => ({ ...avant, [t.id]: { ...avant[t.id], poste } }))}
                  maxLength={30}
                  placeholder={tr('creationCompte.ex_duelliste_igl')}
                  testID={`esport-compte-poste-${t.slug}`}
                />
              </View>
            ) : null}
          </View>
        );
      })}
      {nom || email || discordId ? <Text style={[attenue, { color: probleme ? theme.alerte : theme.ok }]} testID="esport-compte-etat">{probleme ?? tr('creationCompte.pret_le_compte_sera')}</Text> : null}
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-compte" />
      <View style={[communs.ligne, { justifyContent: 'flex-end' }]}>
        <BoutonHub theme={theme} titre={tr('assistant.annuler')} onPress={onAnnuler} testID="esport-compte-annuler" />
        <BoutonHub
          theme={theme}
          titre={enCours ? tr('creationCompte.creation_du_compte') : tr('creationCompte.creer_le_compte_et')}
          variante="plein"
          desactive={Boolean(enCours) || Boolean(probleme)}
          onPress={creer}
          testID="esport-compte-creer"
        />
      </View>
    </Panneau>
  );
}
