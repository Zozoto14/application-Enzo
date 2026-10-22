/**
 * Page « Membres » de l'Esport (premier niveau) : tous les membres de toutes
 * les teams où l'on voit les membres (le Fondateur : toutes), avec filtres
 * (team, rôle, statut invité / actif / suspendu) et recherche.
 *
 * Actions, selon les droits de CHAQUE team (le serveur revérifie tout,
 * anti-escalade comprise) : créer un compte (Fondateur, sur son appareil),
 * ajouter un compte existant à une team, changer son rôle, le retirer d'une
 * team, le suspendre, renvoyer ou révoquer l'invitation (Fondateur).
 *
 * Discord ID (migration 0015) : badge « Discord ID manquant » et filtre ; le
 * Fondateur SEUL le modifie (le serveur refuse tout autre rôle, Propriétaire
 * compris).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { InvitationAffichee } from '../../profils/identifiants';
import { PanneauInvitation } from '../../hub/admin/ui/EnvoiInvitation';
import { Avis, BoutonHub, Champ, Pilule, Segments } from '../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../hub/themes';
import type { AppHub, ContexteHub } from '../../hub/types';
import type { Annuaire, AppartenanceCompte, ClientEsport, CompteEsport, DemandeCompte, TeamAnnuaire } from '../client';
import { capaciteComptes, emailDe, langueDe, modeleInvitationEsport, noterEnvoiEsport, renvoyerInvitation, revoquerCompte } from '../comptesHub';
import { comptesHubSansEsport, comptesOrphelins } from '../synchroAdmin';
import { BoutonConfirme, Choix, PastilleRole, Retours, styles as communs, useAgir, Intertitre, Panneau } from './commun';
import { ESP, EnTetePage, EtatVide, SqueletteCartes } from './design';
import { AjoutTeams } from './AjoutTeams';
import { CreationCompte } from './CreationCompte';
import { DemandesCompte } from './DemandesCompte';
import { useIdentite } from './Identite';
import { dateJour } from '../libelles';
import { tr, trn } from '../i18n';
import { BadgeDiscordManquant, DiscordIdMembre } from './DiscordId';
import { LangueCompte } from './LangueCompte';
import { nomRole, nomPoste } from '../client';

type FiltreStatut = 'tous' | 'invite' | 'actif' | 'suspendu' | 'sansteam' | 'sansdiscord';

/** Fiche Esport sans Discord ID (le bot ne peut pas la pinger) ; un compte du hub sans fiche n'en a pas encore. */
export const discordIdManquant = (c: CompteEsport): boolean => !c.horsEsport && !c.discordId;

/** Statut affiché d'un compte : invité, suspendu (dans toutes ses teams visibles) ou actif. */
export function statutAffiche(c: CompteEsport): Exclude<FiltreStatut, 'tous' | 'sansteam' | 'sansdiscord'> {
  if (c.statut === 'invite') return 'invite';
  if (c.appartenances.length > 0 && c.appartenances.every(a => a.statut === 'suspendu')) return 'suspendu';
  return 'actif';
}

/** Filtres de la page (purs, testés). */
export function filtrerComptes(comptes: readonly CompteEsport[], f: { recherche: string; team: string; role: string; statut: FiltreStatut }): CompteEsport[] {
  const q = f.recherche.trim().toLocaleLowerCase('fr');
  return comptes.filter(c => {
    if (q && !`${c.pseudo} ${c.riotId ?? ''} ${c.discord ?? ''} ${c.discordId ?? ''}`.toLocaleLowerCase('fr').includes(q)) return false;
    if (f.team !== 'toutes' && !c.appartenances.some(a => a.teamId === f.team)) return false;
    if (f.role !== 'tous' && !c.appartenances.some(a => (f.team === 'toutes' || a.teamId === f.team) && a.role.nom === f.role)) return false;
    if (f.statut === 'sansteam') return c.appartenances.length === 0;
    if (f.statut === 'sansdiscord') return discordIdManquant(c);
    if (f.statut === 'suspendu') return c.appartenances.some(a => a.statut === 'suspendu');
    if (f.statut !== 'tous' && statutAffiche(c) !== f.statut) return false;
    return true;
  });
}

const LIBELLES_STATUT: Record<Exclude<FiltreStatut, 'tous' | 'sansteam' | 'sansdiscord'>, string> = { get invite() {
      return tr('membresGlobal.invite');
    }, get actif() {
      return tr('membresGlobal.actif');
    }, get suspendu() {
      return tr('membresGlobal.suspendu');
    } };

export function MembresGlobal({
  theme,
  client,
  contexte,
  registre,
  large,
  onOuvrirTeam,
  onOuvrirApp,
}: {
  theme: ThemeHub;
  client: ClientEsport;
  contexte: ContexteHub;
  registre: readonly AppHub[];
  large: boolean;
  onOuvrirTeam(teamId: string): void;
  onOuvrirApp?(id: string): void;
}) {
  const [annuaire, setAnnuaire] = useState<Annuaire | undefined>();
  const [recherche, setRecherche] = useState('');
  const [team, setTeam] = useState('toutes');
  const [role, setRole] = useState('tous');
  const [statut, setStatut] = useState<FiltreStatut>('tous');
  const [creation, setCreation] = useState(false);
  // Validation d'une demande de compte (Fondateur) : la création s'ouvre préremplie.
  const [demande, setDemande] = useState<DemandeCompte | undefined>();
  const [versionDemandes, setVersionDemandes] = useState(0);
  const [ouvert, setOuvert] = useState<string | undefined>();
  const { enCours, erreur, avis, agir } = useAgir();
  const identite = useIdentite(contexte);

  const recharger = useCallback(async () => setAnnuaire(await client.annuaire()), [client]);
  useEffect(() => {
    void agir('', recharger);
  }, [agir, recharger]);

  const capacite = capaciteComptes(contexte, Boolean(annuaire?.superAdmin));
  const peutAjouter = Boolean(annuaire?.teams.some(t => t.droits.ajouter));
  // Fondateur, liste complète des comptes du hub : aussi les comptes du hub qui ont l'Esport mais aucune fiche Esport (jamais ouverts).
  const listeComplete = Boolean(annuaire?.superAdmin && contexte.profils && !contexte.profils.restreint && !contexte.profils.gestion);
  const tous = useMemo(() => (annuaire ? [...annuaire.comptes, ...comptesHubSansEsport(annuaire.comptes, contexte.profils?.tous, listeComplete)] : []), [annuaire, contexte.profils, listeComplete]);
  const sansTeam = tous.filter(c => c.appartenances.length === 0).length;
  const sansDiscord = tous.filter(discordIdManquant).length;
  const visibles = useMemo(() => filtrerComptes(tous, { recherche, team, role, statut }), [tous, recherche, team, role, statut]);
  const nomsRoles = useMemo(() => [...new Set((annuaire?.teams ?? []).filter(t => team === 'toutes' || t.id === team).flatMap(t => t.roles.map(r => r.nom)))], [annuaire, team]);
  const orphelins = useMemo(
    () => (annuaire && capacite.creer ? comptesOrphelins(annuaire.comptes, contexte.profils?.tous, !contexte.profils?.restreint && !contexte.profils?.gestion) : []),
    [annuaire, capacite.creer, contexte.profils],
  );
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const attenue = { color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) };

  /** Action puis rechargement de l'annuaire. */
  const action = (libelle: string, faire: () => Promise<string | void>) =>
    void agir(libelle, async () => {
      const r = await faire();
      await recharger();
      return r;
    });

  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: large ? ESP.xxl : ESP.m, paddingTop: large ? ESP.xl : ESP.m, paddingBottom: ESP.xxxl, gap: large ? ESP.xl : ESP.l, maxWidth: 1240 + 2 * ESP.xxl, width: '100%', alignSelf: 'center' }}
      keyboardShouldPersistTaps="handled"
      testID="esport-membres-global">
      <EnTetePage
        theme={theme}
        large={large}
        titre={tr('dashboard.membres')}
        sous={annuaire ? tr('membresGlobal.resume_annuaire', { comptes: trn('membresGlobal.comptes', tous.length), sansTeam, teams: trn('membresGlobal.teams', annuaire.teams.length) }) : tr('journal.chargement')}
        action={
          capacite.creer ? (
            <BoutonHub
              theme={theme}
              titre={creation ? tr('discord.fermer') : tr('membresGlobal.creer_un_compte')}
              variante={creation ? 'normal' : 'plein'}
              onPress={() => {
                setDemande(undefined);
                setCreation(c => !c);
              }}
              testID="esport-membres-creer"
            />
          ) : undefined
        }
        testID="esport-membres-entete"
      />
      {annuaire?.superAdmin && (annuaire.demandesEnAttente ?? 0) > 0 ? (
        <View style={communs.ligne}>
          <Pilule theme={theme} texte={tr('membresGlobal.demandes_en_attente', { demandesEnAttente: annuaire.demandesEnAttente })} couleur={theme.alerte} testID="esport-membres-badge-demandes" />
        </View>
      ) : null}
      {annuaire && sansDiscord > 0 ? (
        <Pressable onPress={() => setStatut('sansdiscord')} accessibilityRole="button" testID="esport-membres-bandeau-discord">
          <Avis theme={theme} genre="alerte" texte={tr('discordId.bandeau_manquants', { n: sansDiscord })} />
        </Pressable>
      ) : null}
      {!annuaire && !erreur ? <SqueletteCartes theme={theme} n={2} large={large} /> : null}
      {!capacite.creer && peutAjouter ? <Text style={attenue} testID="esport-membres-creation-indisponible">{capacite.raison}</Text> : null}
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-membres-global" />
      {identite.rendu(theme)}
      {annuaire && !creation ? (
        <DemandesCompte
          theme={theme}
          client={client}
          annuaire={annuaire}
          peutValider={capacite.creer}
          occupe={Boolean(enCours)}
          version={versionDemandes}
          onValider={d => {
            setDemande(d);
            setCreation(true);
          }}
          onChange={recharger}
        />
      ) : null}
      {creation && annuaire && capacite.creer ? (
        <CreationCompte
          key={demande?.id ?? 'nouveau'}
          demande={demande}
          theme={theme}
          client={client}
          contexte={contexte}
          registre={registre}
          annuaire={annuaire}
          exigerIdentite={identite.exiger}
          equipeInitiale={team !== 'toutes' ? team : undefined}
          onFini={() => {
            setCreation(false);
            setDemande(undefined);
            setVersionDemandes(v => v + 1);
            void agir('', recharger);
          }}
          onAnnuler={() => {
            setCreation(false);
            setDemande(undefined);
          }}
        />
      ) : null}
      {orphelins.length > 0 ? (
        <Panneau theme={theme} testID="esport-membres-orphelins">
          <Intertitre theme={theme}>{tr('membresGlobal.comptes_supprimes_de_l')}</Intertitre>
          <Text style={attenue}>{tr('membresGlobal.ces_comptes_n_existent')}</Text>
          {orphelins.map(c => (
            <View key={c.compte} style={communs.ligne}>
              <Text style={[texte, { flex: 1 }]}>{c.pseudo}</Text>
              <BoutonHub
                theme={theme}
                titre={tr('membresGlobal.retirer_de_l_esport')}
                variante="danger"
                desactive={Boolean(enCours)}
                onPress={() =>
                  action(tr('membresGlobal.retrait'), async () => {
                    const r = await client.retirerCompte(c.compte);
                    return tr('membresGlobal.retire_de_l_esport', { pseudo: c.pseudo, teams: trn('membresGlobal.teams', Number(r.teams)) });
                  })
                }
                testID={`esport-orphelin-retirer-${c.compte}`}
              />
            </View>
          ))}
        </Panneau>
      ) : null}
      {annuaire ? (
        <Panneau theme={theme} testID="esport-membres-filtres">
          <Champ theme={theme} libelle={tr('membresGlobal.rechercher')} valeur={recherche} onChanger={setRecherche} placeholder={tr('membresGlobal.pseudo_riot_id_discord')} maxLength={40} testID="esport-membres-recherche" />
          <Segments<FiltreStatut>
            theme={theme}
            libelle={tr('membresGlobal.statut')}
            valeur={statut}
            options={[
              ['tous', tr('journal.tous')],
              ['invite', tr('membresGlobal.invites')],
              ['actif', tr('membresGlobal.actifs')],
              ['suspendu', tr('membresGlobal.suspendus')],
              ['sansteam', tr('membresGlobal.sans_team')],
              ['sansdiscord', tr('discordId.filtre_manquant', { n: sansDiscord })],
            ]}
            onChoisir={setStatut}
            testID="esport-membres-statut"
          />
          {annuaire.teams.length > 1 ? (
            <Choix
              theme={theme}
              libelle={tr('demandesCompte.team')}
              valeur={team}
              options={[{ id: 'toutes', nom: tr('journal.toutes') }, ...annuaire.teams.map(t => ({ id: t.id, nom: t.nom }))]}
              onChoisir={v => {
                setTeam(v);
                setRole('tous');
              }}
              testID="esport-membres-team"
            />
          ) : null}
          <Choix theme={theme} libelle={tr('membresGlobal.role')} valeur={role} options={[{ id: 'tous', nom: tr('journal.tous') }, ...nomsRoles.map(n => ({ id: n, nom: nomRole(n) }))]} onChoisir={setRole} testID="esport-membres-role" />
        </Panneau>
      ) : null}
      {annuaire && annuaire.teams.length === 0 ? (
        <Panneau theme={theme}>
          <Text style={texte}>{tr('membresGlobal.vous_ne_voyez_les')}</Text>
        </Panneau>
      ) : null}
      <View style={{ gap: 8 }} testID="esport-membres-liste">
        {annuaire && visibles.length === 0 && tous.length > 0 ? <EtatVide theme={theme} glyphe="☺" titre={tr('membresGlobal.aucun_membre_ne_correspond')} texte={tr('membresGlobal.changez_la_recherche_ou')} /> : null}
        {annuaire
          ? visibles.map(c => (
              <LigneCompte
                key={c.compte}
                theme={theme}
                compte={c}
                annuaire={annuaire}
                ouvert={ouvert === c.compte}
                large={large}
                occupe={Boolean(enCours)}
                capacite={capacite.creer}
                contexte={contexte}
                client={client}
                exigerIdentite={identite.exiger}
                onBasculer={() => setOuvert(o => (o === c.compte ? undefined : c.compte))}
                onAction={action}
                onRecharger={recharger}
                onAvis={m => void agir('', async () => m)}
                onOuvrirTeam={onOuvrirTeam}
                onOuvrirApp={onOuvrirApp}
              />
            ))
          : null}
      </View>
    </ScrollView>
  );
}

function LigneCompte({
  theme,
  compte,
  annuaire,
  ouvert,
  large,
  occupe,
  capacite,
  contexte,
  client,
  exigerIdentite,
  onBasculer,
  onAction,
  onRecharger,
  onAvis,
  onOuvrirTeam,
  onOuvrirApp,
}: {
  theme: ThemeHub;
  compte: CompteEsport;
  annuaire: Annuaire;
  ouvert: boolean;
  large: boolean;
  occupe: boolean;
  capacite: boolean;
  contexte: ContexteHub;
  client: ClientEsport;
  exigerIdentite(raison: string, action: () => void): void;
  onBasculer(): void;
  onAction(libelle: string, faire: () => Promise<string | void>): void;
  onRecharger(): Promise<void>;
  onAvis(message: string): void;
  onOuvrirTeam(teamId: string): void;
  onOuvrirApp?(id: string): void;
}) {
  const [invitation, setInvitation] = useState<InvitationAffichee | undefined>();
  const [erreurLocale, setErreurLocale] = useState<string | undefined>();
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  const statut = statutAffiche(compte);
  const teamDe = (id: string) => annuaire.teams.find(t => t.id === id);
  const nomsTeams = compte.appartenances.map(a => teamDe(a.teamId)?.nom ?? '?');
  const couleur = statut === 'invite' ? theme.accent : statut === 'suspendu' ? theme.alerte : theme.ok;
  const hubConnu = contexte.profils?.tous.some(p => p.id === compte.compte);

  const renvoyer = () =>
    exigerIdentite(tr('membresGlobal.renvoyer_l_invitation_de', { pseudo: compte.pseudo }), () =>
      onAction('invitation', async () => {
        setErreurLocale(undefined);
        const inv = await renvoyerInvitation(contexte, compte.compte, compte.pseudo, contexte.maintenant ?? Date.now());
        setInvitation(inv);
        if (inv.erreur) setErreurLocale(inv.erreur);
        return inv.erreur ? undefined : tr('membresGlobal.nouvelle_invitation_de_prete', { pseudo: compte.pseudo });
      }),
    );
  const revoquer = () =>
    exigerIdentite(tr('membresGlobal.revoquer_l_acces_de', { pseudo: compte.pseudo }), () =>
      onAction('revocation', async () => {
        await revoquerCompte(contexte, compte.compte, compte.pseudo, contexte.maintenant ?? Date.now());
        // Côté Esport : suspendu dans ses teams (rétablir l'accès se fait dans l'Administration).
        for (const a of compte.appartenances) {
          if (a.statut === 'actif' && a.gerable) await client.modifierMembre(a.teamId, a.membreId, { statut: 'suspendu' }).catch(() => undefined);
        }
        setInvitation(undefined);
        return tr('membresGlobal.ne_peut_plus_se', { pseudo: compte.pseudo });
      }),
    );

  return (
    <View style={{ borderWidth: 1, borderColor: ouvert ? theme.accent : theme.ligne, borderRadius: theme.rayonMoyen, backgroundColor: theme.surface }} testID={`esport-compte-${compte.compte}`}>
      <Pressable accessibilityRole="button" accessibilityLabel={tr('membresGlobal.gerer', { pseudo: compte.pseudo })} accessibilityState={{ expanded: ouvert }} onPress={onBasculer} style={{ padding: 12, gap: 6 }}>
        <View style={[communs.ligne, { gap: 10 }]}>
          <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: teinteTransparente(couleur, 0.22) }}>
            <Text style={[texte, { fontWeight: '800' }]}>{compte.pseudo.slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 140 }}>
            <Text style={[texte, { fontWeight: '700' }]} numberOfLines={1}>
              {compte.pseudo}
              {compte.moi ? tr('membresGlobal.vous') : ''}
            </Text>
            <Text style={attenue} numberOfLines={1}>
              {[compte.riotId, nomsTeams.join(', ') || tr('membresGlobal.aucune_team')].filter(Boolean).join(' · ')}
            </Text>
          </View>
          {compte.horsEsport ? (
            <Pilule theme={theme} texte={tr('membresGlobal.jamais_connecte')} couleur={theme.attenue} testID={`esport-compte-statut-${compte.compte}`} />
          ) : (
            <Pilule theme={theme} texte={LIBELLES_STATUT[statut]} couleur={couleur} testID={`esport-compte-statut-${compte.compte}`} />
          )}
          {compte.appartenances.length === 0 ? <Pilule theme={theme} texte={tr('membresGlobal.sans_team')} couleur={theme.alerte} testID={`esport-compte-sans-team-${compte.compte}`} /> : null}
          {discordIdManquant(compte) ? <BadgeDiscordManquant theme={theme} compte={compte.compte} /> : null}
        </View>
        {large || ouvert ? (
          <View style={[communs.ligne, { paddingLeft: 44 }]}>
            {compte.appartenances.map(a => (
              <PastilleRole key={a.membreId} theme={theme} nom={`${teamDe(a.teamId)?.nom ?? '?'} · ${nomRole(a.role.nom)}${a.statut === 'suspendu' ? tr('membresGlobal.suspendu_entre_parentheses') : ''}`} couleur={a.role.couleur} />
            ))}
          </View>
        ) : null}
      </Pressable>
      {!ouvert && annuaire.teams.some(t => t.droits.ajouter && !t.archivee) ? (
        <View style={{ paddingHorizontal: 12, paddingBottom: 12, paddingLeft: 56, flexDirection: 'row' }}>
          <BoutonHub theme={theme} titre={tr('ajoutTeams.ajouter_a_une_team')} onPress={onBasculer} testID={`esport-compte-ajouter-${compte.compte}`} />
        </View>
      ) : null}
      {ouvert ? (
        <View style={{ padding: 12, paddingTop: 0, gap: 12 }}>
          {!compte.horsEsport ? <DiscordIdMembre theme={theme} client={client} compte={compte} modifiable={Boolean(annuaire.peutModifierDiscordId)} onFait={onRecharger} /> : null}
          <LangueCompte theme={theme} client={client} contexte={contexte} compte={compte} modifiable={Boolean(annuaire.peutModifierLangue) || (compte.horsEsport === true && capacite)} onFait={onRecharger} />
          {compte.appartenances.map(a => {
            const t = teamDe(a.teamId);
            return t ? <Appartenance key={a.membreId} theme={theme} compte={compte} a={a} team={t} occupe={occupe} client={client} onAction={onAction} onOuvrirTeam={onOuvrirTeam} /> : null;
          })}
          <AjoutTeams theme={theme} compte={compte} annuaire={annuaire} client={client} onFait={onRecharger} onAvis={onAvis} />
          {compte.horsEsport ? (
            <Text style={attenue} testID={`esport-compte-hors-esport-${compte.compte}`}>
              {tr('membresGlobal.compte_du_hub_avec')}</Text>
          ) : null}
          {capacite && statut === 'invite' && !compte.horsEsport ? (
            <View style={{ gap: 8 }} testID={`esport-compte-invitation-${compte.compte}`}>
              <Intertitre theme={theme}>{tr('membresGlobal.invitation')}</Intertitre>
              <Text style={attenue}>{tr('membresGlobal.pas_encore_connecte', { invite: compte.inviteLe ? tr('membresGlobal.invite_le', { v: dateJour(compte.inviteLe.slice(0, 10)) }) : '' })}</Text>
              <View style={communs.ligne}>
                <BoutonHub theme={theme} titre={tr('membresGlobal.renvoyer_l_invitation')} desactive={occupe || !hubConnu} onPress={renvoyer} testID={`esport-renvoyer-${compte.compte}`} />
                <BoutonConfirme theme={theme} titre={tr('membresGlobal.revoquer_l_invitation')} confirmation={tr('membresGlobal.oui_revoquer', { pseudo: compte.pseudo })} desactive={occupe || !hubConnu} onConfirme={revoquer} testID={`esport-revoquer-${compte.compte}`} />
              </View>
              {!hubConnu ? <Text style={attenue}>{tr('membresGlobal.compte_pas_encore_visible')}</Text> : null}
              {erreurLocale ? <Avis theme={theme} genre="critique" texte={erreurLocale} /> : null}
              {invitation && !invitation.erreur ? (
                <PanneauInvitation
                  theme={theme}
                  nom={compte.pseudo}
                  invitation={invitation}
                  email={emailDe(contexte, compte.compte)}
                  modele={modeleInvitationEsport(nomsTeams, 'fr')}
                  modeleEn={modeleInvitationEsport(nomsTeams, 'en')}
                  langueInitiale={compte.langueDefaut ?? langueDe(contexte, compte.compte)}
                  fondateur={contexte.profils?.actuel.nom}
                  onEnvoye={canal => noterEnvoiEsport(contexte, compte.compte, compte.pseudo, canal)}
                />
              ) : null}
            </View>
          ) : null}
          {capacite && onOuvrirApp && !compte.moi ? (
            <Text style={attenue}>
              {tr('membresGlobal.supprimer_le_compte_il', { v: ' ' })}<Text style={{ color: theme.accent, fontWeight: '700' }} accessibilityRole="link" onPress={() => onOuvrirApp('administration')} testID={`esport-compte-administration-${compte.compte}`}>
                {tr('membresGlobal.administration')}</Text>
              .
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Appartenance({
  theme,
  compte,
  a,
  team,
  occupe,
  client,
  onAction,
  onOuvrirTeam,
}: {
  theme: ThemeHub;
  compte: CompteEsport;
  a: AppartenanceCompte;
  team: TeamAnnuaire;
  occupe: boolean;
  client: ClientEsport;
  onAction(libelle: string, faire: () => Promise<string | void>): void;
  onOuvrirTeam(teamId: string): void;
}) {
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  const suspendu = a.statut === 'suspendu';
  // Anti-escalade : on n'agit que sur un membre dont le rôle est sous le sien (le serveur revérifie).
  const peutRole = team.droits.roles && a.gerable && !compte.moi;
  const peutRetirer = team.droits.retirer && a.gerable && !compte.moi;
  const slug = `${team.slug}-${compte.compte}`;
  return (
    <View style={{ gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: theme.ligne }} testID={`esport-appartenance-${slug}`}>
      <View style={[communs.ligne, { justifyContent: 'space-between' }]}>
        <Text style={[texte, { fontWeight: '700' }]}>
          {team.nom}
          <Text style={attenue}>{`  ${nomRole(a.role.nom)}${a.posteJeu ? ` · ${nomPoste(a.posteJeu)}` : ''}${suspendu ? tr('membresGlobal.suspendu_suite') : ''}`}</Text>
        </Text>
        <BoutonHub theme={theme} titre={tr('membresGlobal.ouvrir_la_team')} onPress={() => onOuvrirTeam(team.id)} testID={`esport-appartenance-ouvrir-${slug}`} />
      </View>
      {peutRole ? (
        <Choix
          theme={theme}
          libelle={tr('ajoutTeams.role_dans', { nom: team.nom })}
          valeur={a.role.id}
          options={team.roles.map(r => ({ id: r.id, nom: nomRole(r.nom), couleur: r.couleur, desactive: !r.attribuable }))}
          onChoisir={roleId =>
            onAction('role', async () => {
              await client.modifierMembre(team.id, a.membreId, { roleId });
              return tr('membresGlobal.role_de_change_dans', { pseudo: compte.pseudo, nom: team.nom });
            })
          }
          testID={`esport-appartenance-role-${slug}`}
        />
      ) : !a.gerable && (team.droits.roles || team.droits.retirer) && !compte.moi ? (
        <Text style={attenue}>{tr('membresGlobal.role_au_dessus_du')}</Text>
      ) : null}
      {peutRetirer ? (
        <View style={communs.ligne}>
          <BoutonHub
            theme={theme}
            titre={suspendu ? tr('membresGlobal.reactiver') : tr('membresGlobal.suspendre')}
            desactive={occupe}
            onPress={() =>
              onAction('statut', async () => {
                await client.modifierMembre(team.id, a.membreId, { statut: suspendu ? 'actif' : 'suspendu' });
                return suspendu ? tr('membresGlobal.est_reactive_dans', { pseudo: compte.pseudo, nom: team.nom }) : tr('membresGlobal.est_suspendu_dans', { pseudo: compte.pseudo, nom: team.nom });
              })
            }
            testID={`esport-appartenance-suspendre-${slug}`}
          />
          <BoutonConfirme
            theme={theme}
            titre={tr('membresGlobal.retirer_de_la_team')}
            confirmation={tr('membresGlobal.oui_retirer_de', { nom: team.nom })}
            desactive={occupe}
            onConfirme={() =>
              onAction('retrait', async () => {
                await client.retirerMembre(team.id, a.membreId);
                return tr('membresGlobal.a_ete_retire_de', { pseudo: compte.pseudo, nom: team.nom });
              })
            }
            testID={`esport-appartenance-retirer-${slug}`}
          />
        </View>
      ) : null}
    </View>
  );
}
