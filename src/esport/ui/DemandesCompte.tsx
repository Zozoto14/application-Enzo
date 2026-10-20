/**
 * Demandes de compte (permission « Créer des membres », `members.create`),
 * sur la page Membres de l'Esport.
 *
 *  - Le Fondateur : « Demandes en attente » (badge, liste) ; « Valider »
 *    ouvre la création de compte préremplie (création réelle du compte du hub
 *    sur son appareil, pré-enregistrement dans la team, invitation : comme une
 *    invitation directe) ; « Refuser ».
 *  - Un membre qui a la permission : « Proposer un membre » (nom, e-mail,
 *    team, rôle ≤ au sien) → demande au Fondateur ; « Ajouter un compte
 *    existant » (pseudo d'un compte qui a déjà l'Esport : sans le Fondateur) ;
 *    « Mes demandes » et leur statut.
 *
 * Le serveur revérifie tout (permission, anti-escalade, isolation, débit).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Champ, Pilule } from '../../hub/admin/ui/commun';
import { police, type ThemeHub } from '../../hub/themes';
import type { Annuaire, ClientEsport, DemandeCompte, ListeDemandes } from '../client';
import { MOTIF_PSEUDO } from '../comptesHub';
import { BoutonConfirme, Choix, Retours, styles as communs, useAgir, Intertitre, Panneau } from './commun';
import { roleParDefaut } from './CreationCompte';
import { dateJour } from '../libelles';
import { tr } from '../i18n';
import { nomRole } from '../client';

const STATUTS: Record<DemandeCompte['statut'], string> = { get en_attente() {
      return tr('demandesCompte.en_attente');
    }, get validee() {
      return tr('strats.libelles.validee');
    }, get refusee() {
      return tr('demandesCompte.refusee');
    }, get annulee() {
      return tr('demandesCompte.annulee');
    } };

/** Équipes où l'on peut proposer un membre (permission « Créer des membres »). */
export const teamsDemande = (annuaire: Annuaire) => annuaire.teams.filter(t => t.droits.demander && !t.archivee);

export function DemandesCompte({
  theme,
  client,
  annuaire,
  peutValider,
  occupe,
  onValider,
  onChange,
  version,
}: {
  theme: ThemeHub;
  client: ClientEsport;
  annuaire: Annuaire;
  /** Fondateur sur un appareil où il peut créer des comptes (clés du hub). */
  peutValider: boolean;
  occupe: boolean;
  onValider(d: DemandeCompte): void;
  onChange(): Promise<void>;
  /** Change quand la liste doit être relue (après une validation). */
  version: number;
}) {
  const [liste, setListe] = useState<ListeDemandes | undefined>();
  const { enCours, erreur, avis, agir } = useAgir();
  const fondateur = annuaire.superAdmin;
  const possibles = useMemo(() => teamsDemande(annuaire), [annuaire]);
  const charger = useCallback(async () => setListe(await client.demandes()), [client]);
  useEffect(() => {
    if (fondateur || possibles.length > 0 || (annuaire.demandesEnAttente ?? 0) > 0) void agir('', charger);
  }, [agir, charger, fondateur, possibles.length, annuaire.demandesEnAttente, version]);
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const action = (libelle: string, faire: () => Promise<string | void>) =>
    void agir(libelle, async () => {
      const r = await faire();
      await charger();
      await onChange();
      return r;
    });

  if (!fondateur && possibles.length === 0 && !liste?.demandes.length) return null;
  const enAttente = liste?.demandes.filter(d => d.statut === 'en_attente') ?? [];
  const traitees = liste?.demandes.filter(d => d.statut !== 'en_attente') ?? [];

  return (
    <View style={{ gap: 12 }}>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-demandes" />
      {fondateur ? (
        <Panneau theme={theme} testID="esport-demandes">
          <View style={[communs.ligne, { justifyContent: 'space-between' }]}>
            <Intertitre theme={theme}>{tr('demandesCompte.demandes_en_attente')}</Intertitre>
            <Pilule theme={theme} texte={String(enAttente.length)} couleur={enAttente.length ? theme.alerte : theme.attenue} testID="esport-demandes-nombre" />
          </View>
          {enAttente.length === 0 ? <Text style={attenue}>{tr('demandesCompte.aucune_demande_de_compte')}</Text> : null}
          {!peutValider && enAttente.length ? <Text style={attenue}>{tr('demandesCompte.valider_cree_le_compte')}</Text> : null}
          {enAttente.map(d => (
            <View key={d.id} style={{ gap: 6, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 8 }} testID={`esport-demande-${d.id}`}>
              <Text style={[texte, { fontWeight: '700' }]}>
                {d.pseudo}
                <Text style={attenue}>{`  ${nomRole(d.role.nom)} · ${d.team ?? '?'}${d.posteJeu ? ` · ${d.posteJeu}` : ''}`}</Text>
              </Text>
              <Text style={attenue}>{tr('demandesCompte.propose_par', { nom: d.demandeurPseudo ?? tr('creationCompte.un_membre'), date: dateJour(d.creeLe.slice(0, 10)), email: d.email ? ` · ${d.email}` : '' })}</Text>
              {d.message ? <Text style={attenue}>{`« ${d.message} »`}</Text> : null}
              <View style={communs.ligne}>
                <BoutonHub theme={theme} titre={tr('demandesCompte.valider')} variante="plein" desactive={occupe || Boolean(enCours) || !peutValider} onPress={() => onValider(d)} testID={`esport-demande-valider-${d.id}`} />
                <BoutonConfirme
                  theme={theme}
                  titre={tr('demandesCompte.refuser')}
                  confirmation={tr('demandesCompte.oui_refuser', { pseudo: d.pseudo })}
                  desactive={occupe || Boolean(enCours)}
                  onConfirme={() =>
                    action(tr('demandesCompte.refus'), async () => {
                      await client.refuserDemande(d.id);
                      return tr('demandesCompte.refusee', { pseudo: d.pseudo, nom: d.demandeurPseudo ?? tr('demandesCompte.le_demandeur') });
                    })
                  }
                  testID={`esport-demande-refuser-${d.id}`}
                />
              </View>
            </View>
          ))}
          {traitees.length ? <Text style={attenue}>{tr('demandesCompte.dernieres_traitees', { v: traitees.slice(0, 5).map(d => `${d.pseudo} (${STATUTS[d.statut].toLowerCase()})`).join(', ') })}</Text> : null}
        </Panneau>
      ) : null}
      {!fondateur && possibles.length > 0 ? <Proposer theme={theme} client={client} annuaire={annuaire} occupe={occupe || Boolean(enCours)} onAction={action} /> : null}
      {!fondateur && liste?.demandes.length ? (
        <Panneau theme={theme} testID="esport-mes-demandes">
          <Intertitre theme={theme}>{tr('demandesCompte.mes_demandes')}</Intertitre>
          {liste.demandes.map(d => (
            <View key={d.id} style={[communs.ligne, { justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 6 }]} testID={`esport-ma-demande-${d.id}`}>
              <Text style={[texte, { flex: 1 }]}>
                {d.pseudo}
                <Text style={attenue}>{`  ${nomRole(d.role.nom)} · ${d.team ?? '?'}${d.statut === 'refusee' && d.motif ? ` · ${d.motif}` : ''}`}</Text>
              </Text>
              <Pilule
                theme={theme}
                texte={STATUTS[d.statut]}
                couleur={d.statut === 'validee' ? theme.ok : d.statut === 'refusee' ? theme.critique : d.statut === 'en_attente' ? theme.alerte : theme.attenue}
                testID={`esport-ma-demande-statut-${d.id}`}
              />
              {d.statut === 'en_attente' ? (
                <BoutonHub
                  theme={theme}
                  titre={tr('assistant.annuler')}
                  desactive={Boolean(enCours)}
                  onPress={() =>
                    action(tr('demandesCompte.annulation'), async () => {
                      await client.annulerDemande(d.id);
                      return tr('demandesCompte.demande_annulee');
                    })
                  }
                  testID={`esport-ma-demande-annuler-${d.id}`}
                />
              ) : null}
            </View>
          ))}
        </Panneau>
      ) : null}
    </View>
  );
}

/** Formulaire du membre autorisé : demande de compte, ou ajout d'un compte Esport existant. */
function Proposer({
  theme,
  client,
  annuaire,
  occupe,
  onAction,
}: {
  theme: ThemeHub;
  client: ClientEsport;
  annuaire: Annuaire;
  occupe: boolean;
  onAction(libelle: string, faire: () => Promise<string | void>): void;
}) {
  const possibles = teamsDemande(annuaire);
  const [mode, setMode] = useState<'nouveau' | 'existant'>('nouveau');
  const [teamId, setTeamId] = useState(possibles[0]?.id);
  const team = possibles.find(t => t.id === teamId) ?? possibles[0];
  const [roleId, setRoleId] = useState<string | undefined>(team ? roleParDefaut(team) : undefined);
  const [pseudo, setPseudo] = useState('');
  const [email, setEmail] = useState('');
  const [poste, setPoste] = useState('');
  const [message, setMessage] = useState('');
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  if (!team) return null;
  const pret = MOTIF_PSEUDO.test(pseudo.trim()) && Boolean(roleId) && (mode === 'existant' || /^\S+@\S+\.\S+$/.test(email.trim()));
  return (
    <Panneau theme={theme} testID="esport-proposer">
      <Intertitre theme={theme}>{tr('demandesCompte.proposer_un_membre')}</Intertitre>
      <View style={communs.ligne}>
        <BoutonHub theme={theme} titre={tr('demandesCompte.nouveau_compte')} variante={mode === 'nouveau' ? 'plein' : 'normal'} onPress={() => setMode('nouveau')} testID="esport-proposer-mode-nouveau" />
        <BoutonHub theme={theme} titre={tr('demandesCompte.compte_esport_existant')} variante={mode === 'existant' ? 'plein' : 'normal'} onPress={() => setMode('existant')} testID="esport-proposer-mode-existant" />
      </View>
      <Text style={attenue}>
        {mode === 'nouveau'
          ? tr('demandesCompte.creer_un_compte_demande')
          : tr('demandesCompte.la_personne_a_deja')}
      </Text>
      {possibles.length > 1 ? (
        <Choix
          theme={theme}
          libelle={tr('demandesCompte.team')}
          valeur={team.id}
          options={possibles.map(t => ({ id: t.id, nom: t.nom }))}
          onChoisir={id => {
            setTeamId(id);
            const t = possibles.find(x => x.id === id);
            setRoleId(t ? roleParDefaut(t) : undefined);
          }}
          testID="esport-proposer-team"
        />
      ) : null}
      <Choix
        theme={theme}
        libelle={tr('ajoutTeams.role_dans', { nom: team.nom })}
        valeur={roleId}
        options={team.roles.map(r => ({ id: r.id, nom: nomRole(r.nom), couleur: r.couleur, desactive: !r.attribuable }))}
        onChoisir={setRoleId}
        testID="esport-proposer-role"
      />
      <View style={[communs.ligne, { alignItems: 'flex-start', gap: 12 }]}>
        <Champ theme={theme} libelle={mode === 'nouveau' ? tr('demandesCompte.nom_ou_pseudo') : tr('demandesCompte.pseudo_esport_exact')} valeur={pseudo} onChanger={setPseudo} maxLength={24} testID="esport-proposer-pseudo" style={{ flexGrow: 1, flexBasis: 200 }} />
        {mode === 'nouveau' ? <Champ theme={theme} libelle={tr('creationCompte.adresse_e_mail')} valeur={email} onChanger={setEmail} maxLength={254} testID="esport-proposer-email" style={{ flexGrow: 1, flexBasis: 240 }} /> : null}
      </View>
      <Champ theme={theme} libelle={tr('ajoutTeams.poste_en_jeu_facultatif')} valeur={poste} onChanger={setPoste} maxLength={30} testID="esport-proposer-poste" />
      {mode === 'nouveau' ? <Champ theme={theme} libelle={tr('demandesCompte.mot_pour_le_fondateur')} valeur={message} onChanger={setMessage} maxLength={200} testID="esport-proposer-message" /> : null}
      <View style={[communs.ligne, { justifyContent: 'flex-end' }]}>
        <BoutonHub
          theme={theme}
          titre={mode === 'nouveau' ? tr('demandesCompte.envoyer_la_demande_au') : tr('ajoutTeams.ajouter_a', { nom: team.nom })}
          variante="plein"
          desactive={occupe || !pret}
          onPress={() =>
            onAction(mode === 'nouveau' ? 'demande' : 'ajout', async () => {
              const extra = poste.trim() ? { posteJeu: poste.trim() } : {};
              if (mode === 'nouveau') {
                await client.demanderCompte({ teamId: team.id, roleId: roleId!, pseudo: pseudo.trim(), email: email.trim(), ...extra, ...(message.trim() ? { message: message.trim() } : {}) });
              } else {
                await client.ajouterMembre(team.id, { pseudo: pseudo.trim(), roleId: roleId!, ...extra });
              }
              const nom = pseudo.trim();
              setPseudo('');
              setEmail('');
              setPoste('');
              setMessage('');
              return mode === 'nouveau' ? tr('demandesCompte.demande_envoyee_au_fondateur', { nom }) : tr('demandesCompte.est_ajoute_a', { nom, nom2: team.nom });
            })
          }
          testID="esport-proposer-envoyer"
        />
      </View>
    </Panneau>
  );
}
