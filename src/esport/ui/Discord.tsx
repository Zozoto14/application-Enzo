/**
 * Module « Discord » de l'Esport (phase 4), réservé à qui a `discord.manage`
 * (le serveur le vérifie aussi) : webhook de la team (saisi une seule fois,
 * ensuite affiché masqué « …/abcd »), message de test, et pour chaque type
 * de notification : activé ou non, modèle de message, rôle Discord à
 * mentionner. Derniers envois et échecs en bas de page.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Champ, Interrupteur, Intertitre, Panneau } from '../../hub/admin/ui/commun';
import { police, type ThemeHub } from '../../hub/themes';
import { nomModule } from '../client';
import { apiDiscord, type EnvoiDiscord, type EtatDiscord, type ParametreDiscord } from '../discord/api';
import { dateCourte } from '../libelles';
import { BoutonConfirme, Retours, TitreSection, styles, useAgir } from './commun';
import type { PropsModule } from './modules';

const STATUTS: Record<EnvoiDiscord['statut'], string> = { attente: 'En attente', envoye: 'Envoyé', abandonne: 'Abandonné' };

/** Une notification : interrupteur, puis (déplié) modèle, rôle et aperçu. */
function CarteNotification({ theme, parametre, onEnregistrer, occupe }: { theme: ThemeHub; parametre: ParametreDiscord; onEnregistrer(champs: { actif?: boolean; modele?: string | null; roleMention?: string | null }): void; occupe: boolean }) {
  const [ouvert, setOuvert] = useState(false);
  const [modele, setModele] = useState(parametre.personnalise ? parametre.modele : '');
  const [role, setRole] = useState(parametre.roleMention ?? '');
  useEffect(() => {
    setModele(parametre.personnalise ? parametre.modele : '');
    setRole(parametre.roleMention ?? '');
  }, [parametre.modele, parametre.personnalise, parametre.roleMention]);
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  const absent = parametre.modules.filter(m => !parametre.disponible && m).map(nomModule);
  const id = parametre.cle;
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 10, gap: 8 }} testID={`esport-discord-carte-${id}`}>
      <View style={[styles.ligne, { justifyContent: 'space-between', flexWrap: 'nowrap' }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: theme.texte, fontWeight: '700', fontSize: 15, ...police(theme.policeTexte) }}>{parametre.libelle}</Text>
          <Text style={attenue}>{parametre.description}</Text>
          {!parametre.disponible ? <Text style={{ color: theme.alerte, fontSize: 12 }}>Indisponible : le module {absent.join(', ')} n’est pas activé pour cette team.</Text> : null}
        </View>
        <Interrupteur theme={theme} libelle={`${parametre.libelle} : envoyer sur Discord`} valeur={parametre.actif} desactive={!parametre.disponible || occupe} onChanger={v => onEnregistrer({ actif: v })} testID={`esport-discord-actif-${id}`} />
      </View>
      {parametre.disponible ? (
        <BoutonHub theme={theme} titre={ouvert ? 'Fermer' : 'Message et mention'} onPress={() => setOuvert(o => !o)} testID={`esport-discord-ouvrir-${id}`} />
      ) : null}
      {ouvert && parametre.disponible ? (
        <View style={{ gap: 10 }}>
          <Champ theme={theme} libelle="Modèle du message (vide : modèle par défaut)" valeur={modele} onChanger={setModele} multiligne maxLength={500} placeholder={parametre.modeleDefaut} testID={`esport-discord-modele-${id}`} />
          <Text style={attenue}>
            Variables : {parametre.variables.map(v => `{${v.nom}}`).join(' ')}. {parametre.variables.map(v => `{${v.nom}} = ${v.description}`).join(' ; ')}.
          </Text>
          <Champ
            theme={theme}
            libelle="Rôle Discord à mentionner (identifiant, facultatif)"
            valeur={role}
            onChanger={setRole}
            clavier="number-pad"
            maxLength={25}
            placeholder="123456789012345678"
            testID={`esport-discord-role-${id}`}
          />
          <Text style={attenue}>Seulement l’identifiant numérique d’un rôle. @everyone et @here sont refusés. Dans Discord : Paramètres avancés › Mode développeur, puis clic droit sur le rôle › Copier l’identifiant du rôle.</Text>
          <Text style={{ color: theme.texte, ...police(theme.policeTexte) }} testID={`esport-discord-apercu-${id}`}>
            Aperçu : {parametre.apercu}
          </Text>
          <View style={styles.ligne}>
            <BoutonHub
              theme={theme}
              titre="Enregistrer"
              variante="plein"
              desactive={occupe}
              onPress={() => onEnregistrer({ modele: modele.trim() === '' ? null : modele, roleMention: role.trim() === '' ? null : role.trim() })}
              testID={`esport-discord-enregistrer-${id}`}
            />
            <BoutonHub theme={theme} titre="Modèle par défaut" desactive={occupe || !parametre.personnalise} onPress={() => onEnregistrer({ modele: null })} testID={`esport-discord-defaut-${id}`} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function Discord({ theme, client, detail }: PropsModule) {
  const teamId = detail.team.id;
  const api = React.useMemo(() => apiDiscord(client, teamId), [client, teamId]);
  const [etat, setEtat] = useState<EtatDiscord | undefined>();
  const [url, setUrl] = useState('');
  const { enCours, erreur, avis, agir } = useAgir();
  const occupe = Boolean(enCours);

  const recharger = useCallback(async () => {
    setEtat(await api.etat());
  }, [api]);
  useEffect(() => {
    void agir('', recharger);
  }, [agir, recharger]);

  const enregistrer = () =>
    void agir('Webhook', async () => {
      await api.definirWebhook(url);
      setUrl('');
      await recharger();
      return 'Webhook enregistré. Envoyez un message de test pour vérifier.';
    });
  const tester = () =>
    void agir('Test', async () => {
      await api.tester();
      await recharger();
      return 'Message de test envoyé : regardez le salon Discord.';
    });
  const supprimer = () =>
    void agir('Webhook', async () => {
      await api.supprimerWebhook();
      await recharger();
      return 'Webhook supprimé.';
    });
  const maj = (p: ParametreDiscord, champs: { actif?: boolean; modele?: string | null; roleMention?: string | null }) =>
    void agir('Réglage', async () => {
      await api.majParametre(p.cle, champs);
      await recharger();
      return `« ${p.libelle} » enregistré.`;
    });

  const attenue = { color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) };
  const w = etat?.webhook;
  return (
    <View style={{ gap: 16 }} testID="esport-discord">
      <TitreSection theme={theme} titre="Discord" sous="Les événements de la team arrivent dans un salon Discord, par un webhook." />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-discord" />

      <Panneau theme={theme} testID="esport-discord-webhook">
        <Intertitre theme={theme}>Webhook du salon</Intertitre>
        {w?.configure ? (
          <Text style={{ color: theme.texte, ...police(theme.policeTexte) }} testID="esport-discord-masque">
            Webhook enregistré : discord.com/api/webhooks/{w.masque}
          </Text>
        ) : (
          <Text style={attenue}>Aucun webhook. Créez-en un dans Discord, puis collez son adresse ci-dessous.</Text>
        )}
        {w?.invalide ? <Text style={{ color: theme.critique, fontSize: 13 }}>Discord ne reconnaît plus ce webhook : recréez-le et saisissez la nouvelle adresse.</Text> : null}
        {w?.dernierSucces ? <Text style={attenue}>Dernier envoi réussi : {dateCourte(w.dernierSucces)}</Text> : null}
        {w?.dernierEchec ? <Text style={attenue}>Dernier échec : {dateCourte(w.dernierEchec)}</Text> : null}
        <Champ
          theme={theme}
          libelle={w?.configure ? 'Remplacer l’adresse du webhook' : 'Adresse du webhook'}
          valeur={url}
          onChanger={setUrl}
          secret
          placeholder="https://discord.com/api/webhooks/…"
          testID="esport-discord-url"
        />
        <Text style={attenue}>Cette adresse est un secret : elle est chiffrée sur le serveur et plus jamais affichée en entier.</Text>
        <View style={styles.ligne}>
          <BoutonHub theme={theme} titre={w?.configure ? 'Remplacer' : 'Enregistrer'} variante="plein" desactive={occupe || url.trim() === ''} onPress={enregistrer} testID="esport-discord-enregistrer" />
          <BoutonHub theme={theme} titre="Envoyer un message de test" desactive={occupe || !w?.configure} onPress={tester} testID="esport-discord-test" />
          {w?.configure ? <BoutonConfirme theme={theme} titre="Supprimer" confirmation="Confirmer la suppression" desactive={occupe} onConfirme={supprimer} testID="esport-discord-supprimer" /> : null}
        </View>
      </Panneau>

      <Panneau theme={theme} testID="esport-discord-parametres">
        <Intertitre theme={theme}>Notifications</Intertitre>
        <Text style={attenue}>Choisissez ce qui part sur Discord, le texte du message et le rôle à prévenir. Un salon réservé au staff convient aux dépôts de réunion.</Text>
        {etat?.parametres.map(p => <CarteNotification key={p.cle} theme={theme} parametre={p} occupe={occupe} onEnregistrer={champs => maj(p, champs)} />)}
      </Panneau>

      <Panneau theme={theme} testID="esport-discord-envois">
        <Intertitre theme={theme}>Derniers envois</Intertitre>
        {etat && (etat.file.enAttente > 0 || etat.file.abandonnes > 0) ? (
          <Text style={attenue}>
            {etat.file.enAttente} en attente · {etat.file.abandonnes} abandonné(s). Les échecs sont aussi dans le Journal.
          </Text>
        ) : null}
        {etat?.envois.length === 0 ? <Text style={attenue}>Aucun envoi pour l’instant.</Text> : null}
        {etat?.envois.map(e => (
          <View key={e.id} style={{ borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 6 }} testID="esport-discord-envoi">
            <Text style={{ color: e.statut === 'abandonne' ? theme.critique : theme.texte, ...police(theme.policeTexte) }}>
              {e.libelle} · {STATUTS[e.statut]}
              {e.statut === 'attente' && e.essais > 0 ? ` (essai ${e.essais})` : ''}
            </Text>
            <Text style={attenue}>
              {dateCourte(e.creeLe)}
              {e.erreur ? ` · ${e.erreur}` : ''}
            </Text>
          </View>
        ))}
      </Panneau>
    </View>
  );
}
