/**
 * Module « Discord » de l'Esport (phase 4), réservé à qui a `discord.manage`
 * (le serveur le vérifie aussi) : webhook de la team (saisi une seule fois,
 * ensuite affiché masqué « …/abcd »), message de test, et pour chaque type
 * de notification : activé ou non, modèle de message, rôle Discord à
 * mentionner. Derniers envois et échecs en bas de page.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { BoutonHub, Champ, Interrupteur } from '../../hub/admin/ui/commun';
import { police, type ThemeHub } from '../../hub/themes';
import { nomModule } from '../client';
import { apiBot, apiDiscord, type CodeLiaison, type EnvoiDiscord, type EtatBot, type EtatDiscord, type ParametreDiscord } from '../discord/api';
import { dateCourte } from '../libelles';
import { BoutonConfirme, Retours, TitreSection, styles, useAgir, Intertitre, Panneau } from './commun';
import { CodeAffiche } from './CodeLiaison';
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
        {/* Zone tactile de 44 px autour de l'interrupteur natif (qui en dessine 40 × 20). */}
        <Pressable
          accessible={false}
          disabled={!parametre.disponible || occupe}
          onPress={() => onEnregistrer({ actif: !parametre.actif })}
          style={{ minWidth: 56, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
          {...({ dataSet: { cibleExemptee: 'oui' } } as object)}>
          <Interrupteur theme={theme} libelle={`${parametre.libelle} : envoyer sur Discord`} valeur={parametre.actif} desactive={!parametre.disponible || occupe} onChanger={v => onEnregistrer({ actif: v })} testID={`esport-discord-actif-${id}`} />
        </Pressable>
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

/**
 * Bot Discord (interactions) : lier un serveur Discord à la team (code pour
 * /esport-lier-serveur), salon des annonces, ping des convoqués par type
 * d'événement, et qui a lié son compte Discord.
 */
function BotDiscord({ theme, client, teamId }: { theme: ThemeHub; client: PropsModule['client']; teamId: string }) {
  const api = React.useMemo(() => apiBot(client, teamId), [client, teamId]);
  const [etat, setEtat] = useState<EtatBot | undefined>();
  const [code, setCode] = useState<CodeLiaison | undefined>();
  const { enCours, erreur, avis, agir } = useAgir();
  const occupe = Boolean(enCours);
  const recharger = useCallback(async () => setEtat(await api.etat()), [api]);
  useEffect(() => {
    void agir('', recharger);
  }, [agir, recharger]);
  const attenue = { color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) };
  const s = etat?.serveur;
  const lies = etat?.comptes.filter(c => c.lie).length ?? 0;
  return (
    <Panneau theme={theme} testID="esport-bot">
      <Intertitre theme={theme}>Bot Discord</Intertitre>
      <Text style={attenue}>Le bot annonce les scrims, matchs et tournois dans le salon de la team, mentionne les convoqués qui ont lié leur compte, et leur permet de répondre Oui / Peut-être / Non d’un clic.</Text>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-bot" />
      {etat && !etat.disponible ? (
        <Text style={{ color: theme.alerte, fontSize: 13 }} testID="esport-bot-absent">
          Le bot n’est pas encore installé sur le serveur Esport : le Fondateur suit docs/esport/bot-discord.md.
        </Text>
      ) : null}
      {s ? (
        <View style={{ gap: 4 }} testID="esport-bot-serveur">
          <Text style={{ color: theme.texte, ...police(theme.policeTexte) }}>
            Serveur lié · annonces dans #{s.salonNom ?? s.salon}
          </Text>
          <Text style={attenue}>
            Lié le {dateCourte(s.lieLe)}
            {s.dernierSucces ? ` · dernier envoi réussi ${dateCourte(s.dernierSucces)}` : ''}
          </Text>
          {s.invalide ? <Text style={{ color: theme.critique, fontSize: 13 }}>Discord refuse le salon : vérifiez que le bot y a accès, ou liez un autre salon.</Text> : null}
        </View>
      ) : etat?.disponible ? (
        <Text style={attenue}>Aucun serveur lié. Invitez le bot sur votre serveur, puis liez-le avec un code.</Text>
      ) : null}
      {code ? <CodeAffiche theme={theme} code={code} testID="esport-bot-code" /> : null}
      <View style={styles.ligne}>
        {etat?.invitation ? <BoutonHub theme={theme} titre="Inviter le bot sur un serveur" onPress={() => void Linking.openURL(etat.invitation!)} testID="esport-bot-inviter" /> : null}
        <BoutonHub
          theme={theme}
          titre={s ? 'Lier un autre salon ou serveur' : 'Lier un serveur Discord'}
          variante="plein"
          desactive={occupe || !etat?.disponible}
          onPress={() =>
            void agir('Code', async () => {
              setCode(await api.code());
              return 'Code créé : un administrateur du serveur Discord tape la commande affichée, dans le salon des annonces.';
            })
          }
          testID="esport-bot-lier"
        />
        {s ? (
          <BoutonConfirme
            theme={theme}
            titre="Délier le serveur"
            confirmation="Confirmer : délier"
            desactive={occupe}
            onConfirme={() =>
              void agir('Délier', async () => {
                await api.delier();
                await recharger();
                return 'Serveur Discord délié : plus aucune annonce du bot.';
              })
            }
            testID="esport-bot-delier"
          />
        ) : null}
      </View>
      {etat ? (
        <View style={{ gap: 6 }} testID="esport-bot-pings">
          <Text style={{ color: theme.texte, fontWeight: '700', ...police(theme.policeTexte) }}>Mentionner les convoqués</Text>
          <Text style={attenue}>Par type d’événement. Seuls les convoqués qui ont lié leur compte sont mentionnés ; jamais @everyone ni @here. Les réunions réservées au staff ne sont jamais annoncées.</Text>
          {etat.pings.map(p => (
            <View key={p.type} style={[styles.ligne, { justifyContent: 'space-between', flexWrap: 'nowrap' }]}>
              <Text style={{ color: theme.texte, flex: 1, ...police(theme.policeTexte) }}>{p.libelle}</Text>
              <Interrupteur
                theme={theme}
                libelle={`Mentionner les convoqués : ${p.libelle}`}
                valeur={p.ping}
                desactive={occupe}
                onChanger={v =>
                  void agir('Ping', async () => {
                    const r = await api.ping(p.type, v);
                    setEtat(e => (e ? { ...e, pings: r.pings } : e));
                    return `${p.libelle} : ${v ? 'mention activée' : 'sans mention'}.`;
                  })
                }
                testID={`esport-bot-ping-${p.type}`}
              />
            </View>
          ))}
        </View>
      ) : null}
      {etat ? (
        <View style={{ gap: 4 }} testID="esport-bot-comptes">
          <Text style={{ color: theme.texte, fontWeight: '700', ...police(theme.policeTexte) }}>
            Comptes Discord liés : {lies} / {etat.comptes.length}
          </Text>
          {etat.comptes.map(c => (
            <Text key={c.compte} style={{ color: c.lie ? theme.texte : theme.attenue, ...police(theme.policeTexte) }} testID={`esport-bot-compte-${c.compte}`}>
              {c.lie ? '✓' : '·'} {c.pseudo} ({c.role}){c.lie ? ` — ${c.discordNom ?? 'lié'}` : ' — pas lié'}
            </Text>
          ))}
          <Text style={attenue}>Chacun lie son compte dans Mon profil › Lier mon Discord, puis tape /lier dans Discord.</Text>
        </View>
      ) : null}
    </Panneau>
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
      <TitreSection theme={theme} titre="Discord" sous="Les événements de la team arrivent dans un salon Discord : par le bot (recommandé), sinon par un webhook." />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-discord" />

      <BotDiscord theme={theme} client={client} teamId={teamId} />

      <Panneau theme={theme} testID="esport-discord-webhook">
        <Intertitre theme={theme}>Webhook du salon (repli sans bot)</Intertitre>
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
