/**
 * Administration › Bot Esport HQ (Fondateur, ou tickets.configurer ; docs/esport/bot-discord.md) : tous les réglages du
 * bot Discord du club réunis, en sections. Les réglages restent enregistrés à leur place (Tickets › Configuration,
 * page Discord de chaque team) : cette page les montre et y mène, sans copie.
 *  - Connexion et état : variables du serveur (présentes ou non, jamais le jeton), connexion en direct et diagnostic
 *    (ceux des tickets), lien d'invitation (toutes les permissions du bot), vérification du serveur Discord, commandes
 *    enregistrées comparées à celles attendues, et leur réenregistrement ;
 *  - Serveur Discord : celui du club (réglage unique, Tickets › Configuration › Général) ;
 *  - Messages et langue : réglages par défaut, langue de chaque team, langue des tickets, test des MP ;
 *  - Annonces par team : réglages Discord de chaque team, avec un lien vers sa page ;
 *  - Commandes : chaque commande slash, et l'état des commandes des tickets ;
 *  - Fonctionnalités : registre ./sections.ts (tickets, salons vocaux temporaires…).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { Avis, BoutonHub } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import { Glyphe } from '../../../ui/icones';
import type { ClientEsport } from '../../client';
import { apiBotAdmin, type EtatBotAdmin, type EtatCommandesBot, type TeamBot, type VerifServeurBot } from '../../bot/api';
import { trBot, trBotOu, type CleBot } from '../../i18n/bot';
import { trTk, type CleTk } from '../../i18n/tickets';
import { PageEsport } from '../CadreEsport';
import { Choix, Intertitre, Panneau, Retours, styles, useAgir } from '../commun';
import { Badge, ESP, EnTetePage, Onglets, Squelette, attenue, texte } from '../design';
import { TestMpDiscord } from '../TestMpDiscord';
import { Diagnostic, PastilleConnexion } from '../tickets/ConfigTickets';
import { CibleSurlignee } from '../notifications/Cible';
import { fonctionnalitesBot, type ContexteBot } from './sections';

export type SectionBot = 'connexion' | 'serveur' | 'messages' | 'annonces' | 'commandes' | 'fonctionnalites';
export const SECTIONS_BOT: readonly SectionBot[] = ['connexion', 'serveur', 'messages', 'annonces', 'commandes', 'fonctionnalites'];

export interface NavigationBot {
  ouvrirTickets?(section?: string): void;
  ouvrirTeam?(teamId: string, section?: string): void;
  /** Administration › Événements (hub vocal d'un événement : créer l'événement d'abord). */
  ouvrirEvenements?(evenementId?: string): void;
}

const nomFonctionnalite = (id: string) => trBotOu(`fct.${id}`, id);
const nomPermission = (cle: string) => trBotOu(`perm.${cle}`, cle);

/** Une ligne d'état : pictogramme monochrome (fait / à faire), titre et détail. */
function Ligne({ theme, ok, titre, detail, testID }: { theme: ThemeHub; ok: boolean; titre: string; detail?: string | null; testID: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: ESP.xs, alignItems: 'flex-start' }} testID={testID}>
      <Glyphe valeur={ok ? 'valide' : 'alerte'} taille={14} couleur={ok ? theme.ok : theme.alerte} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ ...texte(theme, 14), fontWeight: '600' }}>{titre}</Text>
        {detail ? <Text style={attenue(theme)}>{detail}</Text> : null}
      </View>
    </View>
  );
}

function Commande({ theme, children, testID }: { theme: ThemeHub; children: string; testID: string }) {
  return (
    <Text selectable style={{ ...texte(theme, 12), fontFamily: 'monospace' }} testID={testID}>
      {children}
    </Text>
  );
}

export function PageBot({ theme, client, large, navigation = {}, sectionInitiale }: { theme: ThemeHub; client: ClientEsport; large: boolean; navigation?: NavigationBot; sectionInitiale?: SectionBot }) {
  const api = useMemo(() => apiBotAdmin(client), [client]);
  const [etat, setEtat] = useState<EtatBotAdmin | undefined>();
  const [section, setSection] = useState<SectionBot>(sectionInitiale ?? 'connexion');
  const { erreur, avis, agir, enCours } = useAgir();
  const relire = useCallback(() => agir('charger', async () => setEtat(await api.etat())), [agir, api]);
  useEffect(() => {
    void relire();
  }, [relire]);
  const ctx: ContexteBot | undefined = etat ? { theme, client, large, etat, ouvrirTickets: navigation.ouvrirTickets, ouvrirTeam: navigation.ouvrirTeam, ouvrirEvenements: navigation.ouvrirEvenements, ouvrirSection: s => setSection(s as SectionBot) } : undefined;
  return (
    <PageEsport large={large} testID="esport-bot">
      <EnTetePage theme={theme} large={large} titre={trBot('titre')} sous={trBot('sous')} />
      <Onglets
        theme={theme}
        prefixe="esport-bot-onglet"
        testID="esport-bot-onglets"
        actif={section}
        onChoisir={id => setSection(id as SectionBot)}
        entrees={SECTIONS_BOT.map(id => ({ id, libelle: trBot(`section.${id}` as CleBot) }))}
        defilant={!large}
      />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-bot" />
      {!etat || !ctx ? (
        enCours === 'charger' ? <Squelette theme={theme} lignes={5} testID="esport-bot-chargement" /> : null
      ) : section === 'connexion' ? (
        <SectionConnexion theme={theme} etat={etat} api={api} />
      ) : section === 'serveur' ? (
        <SectionServeur ctx={ctx} />
      ) : section === 'messages' ? (
        <SectionMessages ctx={ctx} />
      ) : section === 'annonces' ? (
        <SectionAnnonces ctx={ctx} />
      ) : section === 'commandes' ? (
        <SectionCommandes ctx={ctx} />
      ) : (
        <SectionFonctionnalites ctx={ctx} />
      )}
    </PageEsport>
  );
}

// ------------------------------------------------------------------ Connexion et état

function SectionConnexion({ theme, etat, api }: { theme: ThemeHub; etat: EtatBotAdmin; api: ReturnType<typeof apiBotAdmin> }) {
  const b = etat.bot;
  const [verif, setVerif] = useState<VerifServeurBot | undefined>();
  const v = useAgir();
  return (
    <View style={{ gap: ESP.m }} testID="esport-bot-connexion">
      <Panneau theme={theme} testID="esport-bot-config">
        <Intertitre theme={theme}>{trBot('cx.titre')}</Intertitre>
        <Ligne theme={theme} ok={b.configure} titre={b.configure ? trBot('cx.configure') : trBot('cx.non_configure')} detail={b.configure ? null : trBot('cx.configure_non')} testID="esport-bot-configure" />
        <Ligne theme={theme} ok={Boolean(b.applicationId)} titre={trBot('cx.application')} detail={b.applicationId ?? trBot('cx.absent')} testID="esport-bot-application" />
        <Ligne theme={theme} ok={b.clePublique} titre={trBot('cx.cle_publique')} detail={b.clePublique ? trBot('cx.present') : trBot('cx.absent')} testID="esport-bot-cle" />
        <Ligne theme={theme} ok={b.jeton} titre={trBot('cx.jeton')} detail={b.jeton ? trBot('cx.present') : trBot('cx.absent')} testID="esport-bot-jeton" />
      </Panneau>

      <Panneau theme={theme} testID="esport-bot-direct">
        <Intertitre theme={theme}>{trBot('cx.connexion')}</Intertitre>
        <View style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
          <PastilleConnexion theme={theme} connexion={etat.tickets.connexion} actif={etat.tickets.actif} />
        </View>
        <Text style={attenue(theme)}>{trBot('cx.connexion_aide')}</Text>
        <Diagnostic theme={theme} d={etat.tickets.diagnostic} />
      </Panneau>

      <Panneau theme={theme} testID="esport-bot-invitation">
        <Intertitre theme={theme}>{trBot('inv.titre')}</Intertitre>
        <Text style={texte(theme)}>{trBot('inv.aide', { entier: etat.permissions.entier })}</Text>
        {etat.permissions.fonctionnalites.map(f => (
          <Text key={f.id} style={attenue(theme)} testID={`esport-bot-perm-${f.id}`}>
            {trBot('inv.fonctionnalite', { fonctionnalite: nomFonctionnalite(f.id), liste: f.permissions.map(nomPermission).join(', ') })}
          </Text>
        ))}
        {etat.invitation ? (
          <View style={styles.ligne}>
            <BoutonHub theme={theme} titre={trBot('inv.bouton')} onPress={() => void Linking.openURL(etat.invitation!)} testID="esport-bot-inviter" />
          </View>
        ) : (
          <Text style={texte(theme)}>{trBot('inv.indisponible')}</Text>
        )}
        <Intertitre theme={theme}>{trBot('srv.titre')}</Intertitre>
        <View style={styles.ligne}>
          <BoutonHub theme={theme} titre={trBot('srv.verifier')} desactive={v.enCours === 'verifier'} onPress={() => void v.agir('verifier', async () => setVerif(await api.verifierServeur()))} testID="esport-bot-verifier" />
        </View>
        <Retours theme={theme} erreur={v.erreur} prefixe="esport-bot-verif" />
        {verif ? <ResultatVerification theme={theme} verif={verif} /> : null}
      </Panneau>

      <EtatCommandes theme={theme} api={api} />
    </View>
  );
}

function ResultatVerification({ theme, verif }: { theme: ThemeHub; verif: VerifServeurBot }) {
  if (!verif.bot) return <Text style={texte(theme)} testID="esport-bot-verif-sans-bot">{trBot('srv.sans_bot')}</Text>;
  if (!verif.serveur) return <Text style={texte(theme)} testID="esport-bot-verif-sans-serveur">{trBot('srv.sans_serveur')}</Text>;
  if (verif.erreur === 'bot-absent') return <Avis theme={theme} genre="alerte" texte={trBot('srv.absent', { serveur: verif.serveur.nom || verif.serveur.id })} testID="esport-bot-verif-absent" />;
  if (verif.erreur) return <Avis theme={theme} genre="critique" texte={trBot('srv.erreur', { erreur: verif.erreur })} testID="esport-bot-verif-erreur" />;
  return (
    <View style={{ gap: ESP.xs }} testID="esport-bot-verif">
      {verif.complet ? <Avis theme={theme} genre="ok" texte={trBot('srv.ok', { serveur: verif.serveur.nom || verif.serveur.id })} testID="esport-bot-verif-ok" /> : null}
      {verif.membreTrouve === false ? <Text style={texte(theme)}>{trBot('srv.membre_introuvable')}</Text> : null}
      {(verif.fonctionnalites ?? []).map(f => (
        <Ligne
          key={f.id}
          theme={theme}
          ok={!f.manquantes.length}
          titre={nomFonctionnalite(f.id)}
          detail={f.manquantes.length ? trBot('srv.manque', { liste: f.manquantes.map(nomPermission).join(', ') }) : trBot('srv.rien_ne_manque')}
          testID={`esport-bot-verif-${f.id}`}
        />
      ))}
      {!verif.complet ? <Text style={attenue(theme)}>{trBot('srv.aide_permissions')}</Text> : null}
    </View>
  );
}

/** Commandes enregistrées chez Discord comparées à celles attendues ; réenregistrement par le serveur. */
function EtatCommandes({ theme, api }: { theme: ThemeHub; api: ReturnType<typeof apiBotAdmin> }) {
  const [c, setC] = useState<EtatCommandesBot | undefined>();
  const { erreur, avis, agir, enCours } = useAgir();
  const lire = useCallback(() => agir('lire', async () => setC(await api.commandes())), [agir, api]);
  useEffect(() => {
    void lire();
  }, [lire]);
  const liste = (l?: string[]) => (l ?? []).map(n => `/${n}`).join(', ');
  const aReenregistrer = Boolean(c?.bot && !c.erreur && c.aJour === false);
  return (
    <Panneau theme={theme} testID="esport-bot-commandes-etat">
      <Intertitre theme={theme}>{trBot('cmd.etat_titre')}</Intertitre>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-bot-cmd" />
      {!c ? (
        enCours === 'lire' ? <Text style={attenue(theme)}>{trBot('cmd.lecture')}</Text> : null
      ) : !c.bot ? (
        <Text style={texte(theme)} testID="esport-bot-cmd-sans-bot">{trBot('cmd.sans_bot')}</Text>
      ) : c.erreur ? (
        <Avis theme={theme} genre="critique" texte={trBot('cmd.erreur', { erreur: c.erreur })} testID="esport-bot-cmd-erreur" />
      ) : c.aJour ? (
        <Ligne theme={theme} ok titre={trBot('cmd.a_jour', { n: String(c.attendues.length) })} testID="esport-bot-cmd-a-jour" />
      ) : (
        <View style={{ gap: ESP.xs }} testID="esport-bot-cmd-a-reenregistrer">
          <Avis theme={theme} genre="alerte" texte={trBot('cmd.a_reenregistrer')} />
          {c.manquantes?.length ? <Text style={texte(theme)}>{trBot('cmd.manquantes', { liste: liste(c.manquantes) })}</Text> : null}
          {c.differentes?.length ? <Text style={texte(theme)}>{trBot('cmd.differentes', { liste: liste(c.differentes) })}</Text> : null}
          {c.enTrop?.length ? <Text style={texte(theme)}>{trBot('cmd.en_trop', { liste: liste(c.enTrop) })}</Text> : null}
        </View>
      )}
      <View style={styles.ligne}>
        {c?.bot ? (
          <BoutonHub
            theme={theme}
            variante={aReenregistrer ? 'plein' : undefined}
            titre={trBot('cmd.reenregistrer')}
            desactive={Boolean(enCours)}
            onPress={() =>
              void agir('reenregistrer', async () => {
                const r = await api.reenregistrer();
                setC(r);
                return trBot('cmd.reenregistrees', { n: String(r.n) });
              })
            }
            testID="esport-bot-cmd-reenregistrer"
          />
        ) : null}
        <BoutonHub theme={theme} titre={trBot('cmd.relire')} desactive={Boolean(enCours)} onPress={() => void lire()} testID="esport-bot-cmd-relire" />
      </View>
      {aReenregistrer || (c && !c.bot) ? (
        <View style={{ gap: ESP.xxs }}>
          <Text style={attenue(theme)}>{trBot('cmd.cpanel')}</Text>
          <Commande theme={theme} testID="esport-bot-cmd-cpanel">
            {trBot('cmd.commande_cpanel')}
          </Commande>
        </View>
      ) : null}
    </Panneau>
  );
}

// ------------------------------------------------------------------ Serveur Discord

function SectionServeur({ ctx }: { ctx: ContexteBot }) {
  const { theme, etat } = ctx;
  const liees = etat.teams.filter(t => t.serveurBot).length;
  return (
    <Panneau theme={theme} testID="esport-bot-serveur">
      <Intertitre theme={theme}>{trBot('serveur.titre')}</Intertitre>
      <Text style={attenue(theme)}>{trBot('serveur.aide')}</Text>
      {etat.serveur ? (
        <Ligne theme={theme} ok titre={etat.serveur.nom || etat.serveur.id} detail={trBot('serveur.id', { id: etat.serveur.id })} testID="esport-bot-serveur-choisi" />
      ) : (
        <Ligne theme={theme} ok={false} titre={trBot('serveur.aucun')} testID="esport-bot-serveur-aucun" />
      )}
      {ctx.ouvrirTickets ? (
        <View style={styles.ligne}>
          <BoutonHub theme={theme} titre={trBot('serveur.modifier')} onPress={() => ctx.ouvrirTickets?.('general')} testID="esport-bot-serveur-modifier" />
        </View>
      ) : null}
      <Text style={texte(theme)} testID="esport-bot-serveur-teams">{trBot('serveur.teams_liees', { n: String(liees), total: String(etat.teams.length) })}</Text>
      <View style={styles.ligne}>
        <BoutonHub theme={theme} titre={trBot('serveur.voir_teams')} onPress={() => ctx.ouvrirSection('annonces')} testID="esport-bot-serveur-teams-voir" />
      </View>
    </Panneau>
  );
}

// ------------------------------------------------------------------ Messages et langue

const langueTeam = (t: TeamBot) => (t.filFr ? trBot('msg.bilingue') : trBot('msg.unique', { langue: t.langue === 'en' ? trBot('anglais') : trBot('francais') }));

function SectionMessages({ ctx }: { ctx: ContexteBot }) {
  const { theme, etat, client } = ctx;
  const avecModule = etat.teams.filter(t => t.moduleActif);
  const [teamTest, setTeamTest] = useState<string | undefined>(avecModule[0]?.id);
  return (
    <View style={{ gap: ESP.m }} testID="esport-bot-messages">
      <Panneau theme={theme} testID="esport-bot-msg-annonces">
        <Intertitre theme={theme}>{trBot('msg.titre_annonces')}</Intertitre>
        <Text style={texte(theme)}>{trBot('msg.defauts')}</Text>
        {etat.teams.map(t => (
          <View key={t.id} style={[styles.ligne, { justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xs }]} testID={`esport-bot-msg-team-${t.id}`}>
            <View style={{ flex: 1, minWidth: 160, gap: 2 }}>
              <Text style={{ ...texte(theme), fontWeight: '600' }}>{t.nom}</Text>
              <Text style={attenue(theme)}>
                {langueTeam(t)} · {t.relancesMp ? trBot('msg.mp_oui') : trBot('msg.mp_non')}
              </Text>
            </View>
            {ctx.ouvrirTeam && t.moduleActif ? <BoutonHub theme={theme} titre={trBot('msg.modifier')} onPress={() => ctx.ouvrirTeam?.(t.id, 'module:discord')} testID={`esport-bot-msg-team-${t.id}-ouvrir`} /> : null}
          </View>
        ))}
        {!etat.teams.length ? <Text style={attenue(theme)}>{trBot('ann.aucune')}</Text> : null}
      </Panneau>

      <Panneau theme={theme} testID="esport-bot-msg-tickets">
        <Intertitre theme={theme}>{trBot('msg.titre_tickets')}</Intertitre>
        <Text style={texte(theme)} testID="esport-bot-msg-tickets-langue">{trBot('msg.tickets_langue', { mode: trTk(`langue.${etat.tickets.langue}` as CleTk) })}</Text>
        {ctx.ouvrirTickets ? (
          <View style={styles.ligne}>
            <BoutonHub theme={theme} titre={trBot('msg.tickets_modifier')} onPress={() => ctx.ouvrirTickets?.('general')} testID="esport-bot-msg-tickets-general" />
            <BoutonHub theme={theme} titre={trBot('msg.tickets_textes')} onPress={() => ctx.ouvrirTickets?.('messages')} testID="esport-bot-msg-tickets-messages" />
          </View>
        ) : null}
      </Panneau>

      <Panneau theme={theme} testID="esport-bot-msg-test">
        <Intertitre theme={theme}>{trBot('msg.test_titre')}</Intertitre>
        <Text style={attenue(theme)}>{trBot('msg.test_aide')}</Text>
        {avecModule.length ? (
          <>
            <Choix theme={theme} libelle={trBot('msg.test_team')} valeur={teamTest} options={avecModule.map(t => ({ id: t.id, nom: t.nom }))} onChoisir={setTeamTest} testID="esport-bot-msg-test-team" />
            {teamTest ? <TestMpDiscord key={teamTest} theme={theme} client={client} teamId={teamTest} /> : null}
          </>
        ) : (
          <Text style={texte(theme)}>{trBot('msg.test_aucune')}</Text>
        )}
      </Panneau>
    </View>
  );
}

// ------------------------------------------------------------------ Annonces par team

function SectionAnnonces({ ctx }: { ctx: ContexteBot }) {
  const { theme, etat } = ctx;
  return (
    <Panneau theme={theme} testID="esport-bot-annonces">
      <Text style={attenue(theme)}>{trBot('ann.aide')}</Text>
      {!etat.teams.length ? <Text style={texte(theme)}>{trBot('ann.aucune')}</Text> : null}
      {etat.teams.map(t => (
        <View key={t.id} style={{ gap: ESP.xs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xs }} testID={`esport-bot-ann-${t.id}`}>
          <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
            <Text style={{ ...texte(theme), fontWeight: '700', flexShrink: 1 }}>{t.nom}</Text>
            {t.archivee ? <Badge theme={theme} texte={trBot('ann.archivee')} /> : null}
          </View>
          {t.moduleActif ? (
            <View style={styles.ligne}>
              <Badge theme={theme} ton={t.webhook ? (t.webhook.invalide ? 'critique' : 'ok') : 'neutre'} texte={t.webhook ? (t.webhook.invalide ? trBot('ann.webhook_invalide') : trBot('ann.webhook_ok')) : trBot('ann.webhook_non')} testID={`esport-bot-ann-${t.id}-webhook`} />
              <Badge
                theme={theme}
                ton={t.serveurBot ? (t.serveurBot.invalide ? 'critique' : 'ok') : 'neutre'}
                texte={t.serveurBot ? (t.serveurBot.invalide ? trBot('ann.serveur_invalide') : t.serveurBot.salonNom ? trBot('ann.serveur_salon', { salon: t.serveurBot.salonNom }) : trBot('ann.serveur_lie')) : trBot('ann.serveur_non')}
                testID={`esport-bot-ann-${t.id}-serveur`}
              />
              <Badge theme={theme} texte={langueTeam(t)} />
              <Badge theme={theme} texte={t.relancesMp ? trBot('msg.mp_oui') : trBot('msg.mp_non')} />
              {t.abandonnes ? <Badge theme={theme} ton="alerte" texte={trBot('ann.abandonnes', { n: String(t.abandonnes) })} /> : null}
            </View>
          ) : (
            <Badge theme={theme} texte={trBot('ann.module_off')} testID={`esport-bot-ann-${t.id}-module`} />
          )}
          {ctx.ouvrirTeam ? (
            <View style={styles.ligne}>
              <BoutonHub
                theme={theme}
                titre={t.moduleActif ? trBot('ann.ouvrir', { team: t.nom }) : trBot('ann.parametres', { team: t.nom })}
                onPress={() => ctx.ouvrirTeam?.(t.id, t.moduleActif ? 'module:discord' : 'parametres')}
                testID={`esport-bot-ann-${t.id}-ouvrir`}
              />
            </View>
          ) : null}
        </View>
      ))}
    </Panneau>
  );
}

// ------------------------------------------------------------------ Commandes

/** Clé du réglage des tickets (Tickets › Configuration › Commandes) d'une commande ou sous-commande. */
const cleTickets = (commande: string, sous?: string) => (commande === 'ticket' && sous ? sous : commande === 'tickets' && !sous ? 'tickets' : null);

function SectionCommandes({ ctx }: { ctx: ContexteBot }) {
  const { theme, etat } = ctx;
  const reglage = (cle: string | null) => {
    const r = cle ? etat.tickets.commandes[cle] : undefined;
    if (!r) return null;
    return <Badge theme={theme} ton={r.actif ? 'ok' : 'neutre'} texte={r.actif ? (r.roles.length ? trBot('cmds.active_roles', { n: String(r.roles.length) }) : trBot('cmds.active')) : trBot('cmds.coupee')} testID={`esport-bot-cmds-reglage-${cle}`} />;
  };
  return (
    <Panneau theme={theme} testID="esport-bot-commandes">
      <Text style={attenue(theme)}>{trBot('cmds.aide')}</Text>
      {ctx.ouvrirTickets ? (
        <View style={styles.ligne}>
          <BoutonHub theme={theme} titre={trBot('cmds.regler')} onPress={() => ctx.ouvrirTickets?.('commandes')} testID="esport-bot-cmds-regler" />
        </View>
      ) : null}
      {etat.commandes.map(c => (
        <View key={c.nom} style={{ gap: ESP.xxs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xs }} testID={`esport-bot-cmds-${c.nom}`}>
          <View style={styles.ligne}>
            <Text style={{ ...texte(theme), fontWeight: '700', fontFamily: 'monospace' }}>/{c.nom}</Text>
            {c.admin ? <Badge theme={theme} texte={trBot('cmds.admin')} /> : null}
            {c.partout ? <Badge theme={theme} texte={trBot('cmds.partout')} /> : null}
            {reglage(cleTickets(c.nom))}
          </View>
          <Text style={attenue(theme)}>{c.description}</Text>
          {c.sousCommandes.map(s => (
            <View key={s.nom} style={[styles.ligne, { paddingLeft: ESP.m }]} testID={`esport-bot-cmds-${c.nom}-${s.nom}`}>
              <Text style={{ ...texte(theme, 13), fontFamily: 'monospace' }}>
                /{c.nom} {s.nom}
              </Text>
              <Text style={{ ...attenue(theme), flexShrink: 1 }}>{s.description}</Text>
              {reglage(cleTickets(c.nom, s.nom))}
            </View>
          ))}
        </View>
      ))}
    </Panneau>
  );
}

// ------------------------------------------------------------------ Fonctionnalités

function SectionFonctionnalites({ ctx }: { ctx: ContexteBot }) {
  const { theme } = ctx;
  return (
    <View style={{ gap: ESP.m }} testID="esport-bot-fonctionnalites">
      <Text style={attenue(theme)}>{trBot('fn.aide')}</Text>
      {fonctionnalitesBot().map(f => {
        const e = f.etat?.(ctx);
        const Reglages = f.Reglages;
        return (
          <CibleSurlignee key={f.id} theme={theme} cle={`bot-fn:${f.id}`}>
          <Panneau theme={theme} testID={`esport-bot-fn-${f.id}`} style={f.bientot ? { opacity: 0.7 } : undefined}>
            <View style={styles.ligne}>
              <Glyphe valeur={f.icone} taille={16} couleur={theme.texte} />
              <Text style={{ ...texte(theme, 15), fontWeight: '700', flexShrink: 1 }}>{f.titre()}</Text>
              {f.bientot ? <Badge theme={theme} texte={trBot('fn.bientot')} testID={`esport-bot-fn-${f.id}-bientot`} /> : null}
              {e ? <Badge theme={theme} ton={e.ton} texte={e.texte} /> : null}
            </View>
            <Text style={attenue(theme)}>{f.description()}</Text>
            {!f.bientot && Reglages ? <Reglages {...ctx} /> : null}
            {!f.bientot && f.ouvrir && (f.ouvrir.disponible?.(ctx) ?? true) ? (
              <View style={styles.ligne}>
                <BoutonHub theme={theme} titre={f.ouvrir.libelle()} onPress={() => f.ouvrir!.action(ctx)} testID={`esport-bot-fn-${f.id}-ouvrir`} />
              </View>
            ) : null}
          </Panneau>
          </CibleSurlignee>
        );
      })}
    </View>
  );
}
