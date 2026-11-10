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
import { nomModule, nomRole } from '../client';
import { typeEvenement } from '../planning/libelles';
import { apiBot, apiDiscord, type CodeLiaison, type EnvoiDiscord, type EtatBot, type EtatDiscord, type MpDiscord, type ParametreDiscord } from '../discord/api';
import { dateCourte } from '../libelles';
import { BoutonConfirme, Retours, TitreSection, styles, useAgir, Intertitre, Panneau } from './commun';
import { CodeAffiche } from './CodeLiaison';
import type { PropsModule } from './modules';
import { tr, trn } from '../i18n';
import { traduireServeur } from '../i18n/erreurs';
import { ChoixLangue } from './ChoixLangue';
import { TestMpDiscord } from './TestMpDiscord';
import { ReglagesRolesTemp } from './rolesTemp/ReglagesRolesTemp';

const STATUTS: Record<EnvoiDiscord['statut'], string> = { get attente() {
      return tr('demandesCompte.en_attente');
    }, get envoye() {
      return tr('discord.envoye');
    }, get abandonne() {
      return tr('discord.abandonne');
    } };

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
          {!parametre.disponible ? <Text style={{ color: theme.alerte, fontSize: 12 }}>{tr('discord.indisponible_le_module_n', { v: absent.join(', ') })}</Text> : null}
        </View>
        {/* Zone tactile de 44 px autour de l'interrupteur natif (qui en dessine 40 × 20). */}
        <Pressable
          accessible={false}
          disabled={!parametre.disponible || occupe}
          onPress={() => onEnregistrer({ actif: !parametre.actif })}
          style={{ minWidth: 56, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
          {...({ dataSet: { cibleExemptee: 'oui' } } as object)}>
          <Interrupteur theme={theme} libelle={tr('discord.envoyer_sur_discord', { libelle: parametre.libelle })} valeur={parametre.actif} desactive={!parametre.disponible || occupe} onChanger={v => onEnregistrer({ actif: v })} testID={`esport-discord-actif-${id}`} />
        </Pressable>
      </View>
      {parametre.disponible ? (
        <BoutonHub theme={theme} titre={ouvert ? tr('discord.fermer') : tr('discord.message_et_mention')} onPress={() => setOuvert(o => !o)} testID={`esport-discord-ouvrir-${id}`} />
      ) : null}
      {ouvert && parametre.disponible ? (
        <View style={{ gap: 10 }}>
          <Champ theme={theme} libelle={tr('discord.modele_du_message_vide')} valeur={modele} onChanger={setModele} multiligne maxLength={500} placeholder={parametre.modeleDefaut} testID={`esport-discord-modele-${id}`} />
          <Text style={attenue}>
            {tr('discord.variables', { v: parametre.variables.map(v => `{${v.nom}}`).join(' '), v2: parametre.variables.map(v => `{${v.nom}} = ${v.description}`).join(' ; ') })}</Text>
          <Champ
            theme={theme}
            libelle={tr('discord.role_discord_a_mentionner')}
            valeur={role}
            onChanger={setRole}
            clavier="number-pad"
            maxLength={25}
            placeholder="123456789012345678"
            testID={`esport-discord-role-${id}`}
          />
          <Text style={attenue}>{tr('discord.seulement_l_identifiant_numeri')}</Text>
          <Text style={{ color: theme.texte, ...police(theme.policeTexte) }} testID={`esport-discord-apercu-${id}`}>
            {tr('discord.apercu', { apercu: parametre.apercu })}</Text>
          <View style={styles.ligne}>
            <BoutonHub
              theme={theme}
              titre={tr('discord.enregistrer')}
              variante="plein"
              desactive={occupe}
              onPress={() => onEnregistrer({ modele: modele.trim() === '' ? null : modele, roleMention: role.trim() === '' ? null : role.trim() })}
              testID={`esport-discord-enregistrer-${id}`}
            />
            <BoutonHub theme={theme} titre={tr('discord.modele_par_defaut')} desactive={occupe || !parametre.personnalise} onPress={() => onEnregistrer({ modele: null })} testID={`esport-discord-defaut-${id}`} />
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
      <Intertitre theme={theme}>{tr('discord.bot_discord')}</Intertitre>
      <Text style={attenue}>{tr('discord.le_bot_annonce_les')}</Text>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-bot" />
      {etat && !etat.disponible ? (
        <Text style={{ color: theme.alerte, fontSize: 13 }} testID="esport-bot-absent">
          {tr('discord.le_bot_n_est')}</Text>
      ) : null}
      {s ? (
        <View style={{ gap: 4 }} testID="esport-bot-serveur">
          <Text style={{ color: theme.texte, ...police(theme.policeTexte) }}>
            {tr('discord.serveur_lie_annonces', { salon: s.salonNom ?? s.salon })}
          </Text>
          <Text style={attenue}>
            {tr('discord.lie_le', { date: dateCourte(s.lieLe) })}
            {s.dernierSucces ? tr('discord.dernier_envoi_reussi_2', { v: dateCourte(s.dernierSucces) }) : ''}
          </Text>
          {s.invalide ? <Text style={{ color: theme.critique, fontSize: 13 }}>{tr('discord.discord_refuse_le_salon')}</Text> : null}
        </View>
      ) : etat?.disponible ? (
        <Text style={attenue}>{tr('discord.aucun_serveur_lie_invitez')}</Text>
      ) : null}
      {code ? <CodeAffiche theme={theme} code={code} testID="esport-bot-code" /> : null}
      <View style={styles.ligne}>
        {etat?.invitation ? <BoutonHub theme={theme} titre={tr('discord.inviter_le_bot_sur')} onPress={() => void Linking.openURL(etat.invitation!)} testID="esport-bot-inviter" /> : null}
        <BoutonHub
          theme={theme}
          titre={s ? tr('discord.lier_un_autre_salon') : tr('discord.lier_un_serveur_discord')}
          variante="plein"
          desactive={occupe || !etat?.disponible}
          onPress={() =>
            void agir('code', async () => {
              setCode(await api.code());
              return tr('discord.code_cree_un_administrateur');
            })
          }
          testID="esport-bot-lier"
        />
        {s ? (
          <BoutonConfirme
            theme={theme}
            titre={tr('discord.delier_le_serveur')}
            confirmation={tr('discord.confirmer_delier')}
            desactive={occupe}
            onConfirme={() =>
              void agir('delier', async () => {
                await api.delier();
                await recharger();
                return tr('discord.serveur_discord_delie_plus');
              })
            }
            testID="esport-bot-delier"
          />
        ) : null}
      </View>
      {etat ? (
        <View style={{ gap: 6 }} testID="esport-bot-pings">
          <Text style={{ color: theme.texte, fontWeight: '700', ...police(theme.policeTexte) }}>{tr('discord.mentionner_les_convoques')}</Text>
          <Text style={attenue}>{tr('discord.par_type_d_evenement')}</Text>
          {etat.pings.map(p => (
            <View key={p.type} style={[styles.ligne, { justifyContent: 'space-between', flexWrap: 'nowrap' }]}>
              <Text style={{ color: theme.texte, flex: 1, ...police(theme.policeTexte) }}>{typeEvenement(p.type).nom}</Text>
              <Interrupteur
                theme={theme}
                libelle={tr('discord.mentionner_les_convoques_2', { libelle: typeEvenement(p.type).nom })}
                valeur={p.ping}
                desactive={occupe}
                onChanger={v =>
                  void agir('ping', async () => {
                    const r = await api.ping(p.type, v);
                    setEtat(e => (e ? { ...e, pings: r.pings } : e));
                    return tr(v ? 'discord.ping_active' : 'discord.ping_coupe', { libelle: typeEvenement(p.type).nom });
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
            {tr('discord.comptes_discord_lies', { lies, length: etat.comptes.length })}</Text>
          {etat.comptes.map(c => (
            <Text key={c.compte} style={{ color: c.lie ? theme.texte : theme.attenue, ...police(theme.policeTexte) }} testID={`esport-bot-compte-${c.compte}`}>
              {c.lie ? '✓' : '·'} {c.pseudo} ({nomRole(c.role)}){c.lie ? ` — ${c.discordNom ?? tr('discord.lie')}` : tr('discord.pas_lie')}
            </Text>
          ))}
          <Text style={attenue}>{tr('discord.chacun_lie_son_compte')}</Text>
        </View>
      ) : null}
    </Panneau>
  );
}

/** Motif → action à faire pour qu'un membre soit joignable en MP. */
const ACTIONS_MP: Record<MpDiscord['injoignables'][number]['motif'], () => string> = {
  non_lie: () => tr('discord.mp.action.non_lie'),
  mp_fermes: () => tr('discord.mp.action.mp_fermes'),
  introuvable: () => tr('discord.mp.action.introuvable'),
  refuse: () => tr('discord.mp.action.refuse'),
};

/**
 * « Relances par MP » (activé par défaut) : relances et messages d'un joueur seul en message privé, repli dans le
 * salon (une mention au plus par événement), et la liste des membres que le bot ne peut pas joindre en MP.
 */
function PanneauMp({ theme, mp, occupe, onChanger }: { theme: ThemeHub; mp: MpDiscord; occupe: boolean; onChanger(v: boolean): void }) {
  const attenue = { color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) };
  return (
    <Panneau theme={theme} testID="esport-discord-mp-panneau">
      <Intertitre theme={theme}>{tr('discord.mp.titre')}</Intertitre>
      <View style={[styles.ligne, { justifyContent: 'space-between', flexWrap: 'nowrap' }]}>
        <Text style={{ color: theme.texte, flex: 1, fontWeight: '700', ...police(theme.policeTexte) }}>{tr('discord.mp.libelle')}</Text>
        <Interrupteur theme={theme} libelle={tr('discord.mp.libelle')} valeur={mp.relancesMp} desactive={occupe} onChanger={onChanger} testID="esport-discord-mp" />
      </View>
      <Text style={attenue}>{tr('discord.mp.aide')}</Text>
      <Text style={attenue}>{tr('discord.mp.repli')}</Text>
      {mp.relancesMp && (!mp.botConfigure || !mp.botLie) ? (
        <Text style={{ color: theme.alerte, fontSize: 13 }} testID="esport-discord-mp-bot">
          {tr('discord.mp.bot_requis')}
        </Text>
      ) : null}
      {mp.injoignables.length > 0 ? (
        <View style={{ gap: 4 }} testID="esport-discord-mp-injoignables">
          <Text style={{ color: theme.alerte, fontWeight: '700', fontSize: 13, ...police(theme.policeTexte) }}>{trn('discord.mp.injoignables', mp.injoignables.length)}</Text>
          {mp.injoignables.map(i => (
            <Text key={i.compte} style={{ color: theme.texte, fontSize: 13, ...police(theme.policeTexte) }} testID={`esport-discord-mp-injoignable-${i.compte}`}>
              {tr('discord.mp.ligne', { pseudo: i.pseudo, action: (ACTIONS_MP[i.motif] ?? ACTIONS_MP.refuse)() })}
            </Text>
          ))}
        </View>
      ) : (
        <Text style={attenue} testID="esport-discord-mp-tous">
          {tr('discord.mp.tous_joignables')}
        </Text>
      )}
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
    void agir('webhook', async () => {
      await api.definirWebhook(url);
      setUrl('');
      await recharger();
      return tr('discord.webhook_enregistre_envoyez_un');
    });
  const tester = () =>
    void agir('test', async () => {
      const r = await api.tester();
      await recharger();
      if (r?.fil && !r.fil.cree) return tr('discord.test_fil_impossible', { motif: traduireServeur(r.fil.motif) });
      return r?.fil?.cree ? tr('discord.test_fil_cree') : tr('discord.message_de_test_envoye');
    });
  const supprimer = () =>
    void agir('webhook', async () => {
      await api.supprimerWebhook();
      await recharger();
      return tr('discord.webhook_supprime');
    });
  const maj = (p: ParametreDiscord, champs: { actif?: boolean; modele?: string | null; roleMention?: string | null }) =>
    void agir('reglage', async () => {
      await api.majParametre(p.cle, champs);
      await recharger();
      return tr('discord.enregistre', { libelle: p.libelle });
    });

  const attenue = { color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) };
  const w = etat?.webhook;
  const bilingue = etat?.bilingue;
  // Fil français : activé par défaut (serveur ancien sans le champ : même défaut).
  const filFr = bilingue?.filFr ?? true;
  return (
    <View style={{ gap: 16 }} testID="esport-discord">
      <TitreSection theme={theme} titre="Discord" sous={tr('discord.les_evenements_de_la')} />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-discord" />

      <BotDiscord theme={theme} client={client} teamId={teamId} />

      <Panneau theme={theme} testID="esport-discord-langue-panneau">
        <Intertitre theme={theme}>{tr('discord.langue_des_messages')}</Intertitre>
        <View style={[styles.ligne, { justifyContent: 'space-between', flexWrap: 'nowrap' }]}>
          <Text style={{ color: theme.texte, flex: 1, fontWeight: '700', ...police(theme.policeTexte) }}>{tr('discord.bilingue_libelle')}</Text>
          <Interrupteur
            theme={theme}
            libelle={tr('discord.bilingue_libelle')}
            valeur={filFr}
            desactive={occupe || !etat}
            onChanger={v =>
              void agir('bilingue', async () => {
                await api.majBilingue(v);
                await recharger();
                return tr(v ? 'discord.bilingue_active' : 'discord.bilingue_coupe');
              })
            }
            testID="esport-discord-fil-fr"
          />
        </View>
        {filFr ? (
          <View style={{ gap: 6 }} testID="esport-discord-bilingue">
            <Text style={attenue}>{tr('discord.bilingue_aide')}</Text>
            <Text style={{ color: theme.texte, fontSize: 13, ...police(theme.policeTexte) }} testID="esport-discord-permissions">
              {tr('discord.bilingue_permissions', { v: (bilingue?.permissions ?? []).join(', ') })}
            </Text>
            <Text style={attenue}>{tr('discord.bilingue_repli')}</Text>
            {bilingue && !bilingue.botConfigure ? (
              <Text style={{ color: theme.alerte, fontSize: 13 }} testID="esport-discord-fil-bot-absent">
                {tr('discord.bilingue_bot_absent')}
              </Text>
            ) : null}
            {bilingue?.probleme ? (
              <Text style={{ color: theme.critique, fontSize: 13 }} testID="esport-discord-fil-probleme">
                {tr('discord.bilingue_probleme', { date: dateCourte(bilingue.dernierEchec ?? ''), motif: traduireServeur(bilingue.motifEchec) })}
              </Text>
            ) : bilingue?.dernierFil ? (
              <Text style={attenue} testID="esport-discord-fil-ok">
                {tr('discord.bilingue_dernier_fil', { date: dateCourte(bilingue.dernierFil) })}
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={{ gap: 6 }}>
            <Text style={attenue}>{tr('discord.langue_des_messages_aide')}</Text>
            <ChoixLangue
              theme={theme}
              libelle={tr('discord.langue_des_messages')}
              valeur={etat?.langue ?? 'fr'}
              onChoisir={l =>
                void agir('langue', async () => {
                  await api.majLangue(l);
                  await recharger();
                  return tr('discord.langue_enregistree');
                })
              }
              testID="esport-discord-langue"
            />
          </View>
        )}
      </Panneau>

      {etat?.mp ? <PanneauMp theme={theme} mp={etat.mp} occupe={occupe || !etat} onChanger={v =>
        void agir('mp', async () => {
          await api.majMp(v);
          await recharger();
          return tr(v ? 'discord.mp.active' : 'discord.mp.coupe');
        })
      } /> : null}

      <TestMpDiscord theme={theme} client={client} teamId={teamId} />

      <ReglagesRolesTemp theme={theme} client={client} teamId={teamId} />

      <Panneau theme={theme} testID="esport-discord-webhook">
        <Intertitre theme={theme}>{tr('discord.webhook_du_salon_repli')}</Intertitre>
        {w?.configure ? (
          <Text style={{ color: theme.texte, ...police(theme.policeTexte) }} testID="esport-discord-masque">
            {tr('discord.webhook_enregistre_discord_com', { masque: w.masque })}</Text>
        ) : (
          <Text style={attenue}>{tr('discord.aucun_webhook_creez_en')}</Text>
        )}
        {w?.invalide ? <Text style={{ color: theme.critique, fontSize: 13 }}>{tr('discord.discord_ne_reconnait_plus')}</Text> : null}
        {w?.dernierSucces ? <Text style={attenue}>{tr('discord.dernier_envoi_reussi', { v: dateCourte(w.dernierSucces) })}</Text> : null}
        {w?.dernierEchec ? <Text style={attenue}>{tr('discord.dernier_echec', { v: dateCourte(w.dernierEchec) })}</Text> : null}
        <Champ
          theme={theme}
          libelle={w?.configure ? tr('discord.remplacer_l_adresse_du') : tr('discord.adresse_du_webhook')}
          valeur={url}
          onChanger={setUrl}
          secret
          placeholder="https://discord.com/api/webhooks/…"
          testID="esport-discord-url"
        />
        <Text style={attenue}>{tr('discord.cette_adresse_est_un')}</Text>
        <View style={styles.ligne}>
          <BoutonHub theme={theme} titre={w?.configure ? tr('discord.remplacer') : tr('discord.enregistrer')} variante="plein" desactive={occupe || url.trim() === ''} onPress={enregistrer} testID="esport-discord-enregistrer" />
          <BoutonHub theme={theme} titre={tr('discord.envoyer_un_message_de')} desactive={occupe || !w?.configure} onPress={tester} testID="esport-discord-test" />
          {w?.configure ? <BoutonConfirme theme={theme} titre={tr('discord.supprimer')} confirmation={tr('discord.confirmer_la_suppression')} desactive={occupe} onConfirme={supprimer} testID="esport-discord-supprimer" /> : null}
        </View>
      </Panneau>

      <Panneau theme={theme} testID="esport-discord-parametres">
        <Intertitre theme={theme}>{tr('discord.notifications')}</Intertitre>
        <Text style={attenue}>{tr('discord.choisissez_ce_qui_part')}</Text>
        {etat?.parametres.map(p => <CarteNotification key={p.cle} theme={theme} parametre={p} occupe={occupe} onEnregistrer={champs => maj(p, champs)} />)}
      </Panneau>

      <Panneau theme={theme} testID="esport-discord-envois">
        <Intertitre theme={theme}>{tr('discord.derniers_envois')}</Intertitre>
        {etat && (etat.file.enAttente > 0 || etat.file.abandonnes > 0) ? (
          <Text style={attenue}>
            {tr('discord.en_attente_abandonne_s', { enAttente: etat.file.enAttente, abandonnes: trn('discord.abandonnes', etat.file.abandonnes) })}</Text>
        ) : null}
        {etat?.envois.length === 0 ? <Text style={attenue}>{tr('discord.aucun_envoi_pour_l')}</Text> : null}
        {etat?.envois.map(e => (
          <View key={e.id} style={{ borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 6 }} testID="esport-discord-envoi">
            <Text style={{ color: e.statut === 'abandonne' ? theme.critique : theme.texte, ...police(theme.policeTexte) }}>
              {e.libelle} · {STATUTS[e.statut]}
              {e.statut === 'attente' && e.essais > 0 ? tr('discord.essai', { essais: e.essais }) : ''}
            </Text>
            <Text style={attenue}>
              {dateCourte(e.creeLe)}
              {e.erreur ? ` · ${traduireServeur(e.erreur)}` : ''}
            </Text>
          </View>
        ))}
      </Panneau>
    </View>
  );
}
