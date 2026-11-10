/**
 * « Membres et rôles » d'une team : membres (rôle, poste, suspension,
 * retrait), rôles et matrice des permissions (modules en lignes, actions en
 * colonnes), rôles personnalisés. Inviter ou ajouter quelqu'un se fait depuis
 * la page « Membres » de l'Esport (premier niveau) : plus aucun code.
 *
 * L'écran n'affiche que ce que les permissions permettent, mais c'est le
 * serveur qui décide (anti-escalade, dernier Propriétaire…) : ses refus sont
 * affichés tels quels.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Avis, BoutonHub, Case, Champ } from '../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../hub/themes';
import type { ContexteHub } from '../../hub/types';
import { CATALOGUE, LIBELLES_COLONNES, lignesMatrice, type Annuaire, type ClientEsport, type CompteEsport, type DetailTeam, type Membre, type Role, nomRole } from '../client';
import { dateCourte } from '../libelles';
import { comptesHubSansEsport } from '../synchroAdmin';
import { AjoutTeams } from './AjoutTeams';
import { BoutonConfirme, Choix, PastilleRole, Retours, TitreSection, styles, useAgir, Intertitre, Panneau } from './commun';
import { tr, trn } from '../i18n';
import { OctroisRolesTemp } from './rolesTemp/OctroisRolesTemp';

const couleursRole = (): ReadonlyArray<readonly [string, string]> => [
  ['#d64545', tr('review.dessin.rouge')],
  ['#f59e0b', tr('review.dessin.ambre')],
  ['#16a34a', tr('review.dessin.vert')],
  ['#0891b2', tr('membresRoles.cyan')],
  ['#2563eb', tr('review.dessin.bleu')],
  ['#7c3aed', tr('membresRoles.violet')],
  ['#db2777', tr('membresRoles.rose')],
  ['#8b8b9a', tr('membresRoles.gris')],
];
const COLONNES = ['voir', 'creer', 'modifier', 'supprimer', 'special'] as const;

/** Rôles que l'acteur peut attribuer (approximation de la règle du serveur, pour ne pas proposer l'impossible). */
export function rolesAttribuables(roles: readonly Role[], detail: DetailTeam): Role[] {
  const moi = detail.moi;
  if (moi.superAdmin || moi.role?.cle === 'proprietaire') return [...roles];
  const mes = new Set(moi.permissions);
  const monRole = roles.find(r => r.id === moi.role?.id);
  return roles.filter(r => r.permissions.every(p => mes.has(p)) || (r.systeme && monRole?.systeme && r.position > monRole.position));
}

export function MembresRoles({
  theme,
  client,
  detail,
  large,
  onExporter,
  onMembresGlobal,
  contexte,
}: {
  theme: ThemeHub;
  client: ClientEsport;
  detail: DetailTeam;
  large: boolean;
  /** Contexte du hub : comptes du hub jamais connectés à l'Esport (Fondateur, liste complète). */
  contexte?: ContexteHub;
  onExporter?(nom: string, contenu: string, type?: string): Promise<boolean>;
  /** Page « Membres » de premier niveau (inviter, ajouter un compte existant). */
  onMembresGlobal?(): void;
}) {
  const teamId = detail.team.id;
  const peut = useCallback((p: string) => detail.moi.permissions.includes(p), [detail.moi.permissions]);
  const [membres, setMembres] = useState<Membre[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const { enCours, erreur, avis, agir } = useAgir();

  const recharger = useCallback(async () => {
    const [m, r] = await Promise.all([peut('members.view') ? client.membres(teamId) : Promise.resolve([]), client.roles(teamId).catch(() => [])]);
    setMembres(m);
    setRoles(r);
  }, [client, teamId, peut]);

  useEffect(() => {
    void agir('', recharger);
  }, [agir, recharger]);

  const attribuables = useMemo(() => rolesAttribuables(roles, detail), [roles, detail]);
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };

  return (
    <View style={{ gap: 16 }} testID="esport-membres">
      <TitreSection theme={theme} titre={tr('membresRoles.membres_et_roles')} sous={trn('dashboard.membres_actifs', membres.filter(m => m.statut === 'actif').length)} />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-membres" />
      <View style={large ? { flexDirection: 'row', gap: 16, alignItems: 'flex-start' } : { gap: 16 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 16 }}>
          {peut('members.view') ? (
            <Panneau theme={theme} testID="esport-liste-membres">
              <Intertitre theme={theme}>{tr('dashboard.membres')}</Intertitre>
              {membres.map(m => (
                <LigneMembre
                  key={m.id}
                  theme={theme}
                  membre={m}
                  roles={attribuables}
                  peutRole={peut('members.assign_role')}
                  peutRetirer={peut('members.remove')}
                  occupe={Boolean(enCours)}
                  onAction={(libelle, action) => void agir(libelle, async () => {
                    const r = await action();
                    await recharger();
                    return r;
                  })}
                  client={client}
                  teamId={teamId}
                  fondateur={detail.moi.superAdmin}
                  onExporter={onExporter}
                />
              ))}
            </Panneau>
          ) : null}
          {peut('members.invite') || peut('members.create') ? (
            <Panneau theme={theme} testID="esport-inviter">
              <Intertitre theme={theme}>{tr('membresRoles.inviter_quelqu_un')}</Intertitre>
              <Text style={{ color: theme.texte, ...police(theme.policeTexte) }}>
                {detail.moi.superAdmin
                  ? tr('membresRoles.creez_son_compte_depuis')
                  : peut('members.create')
                    ? tr('membresRoles.depuis_la_page_membres')
                    : tr('membresRoles.ajoutez_a_la_team')}
              </Text>
              {onMembresGlobal ? <BoutonHub theme={theme} titre={tr('membresRoles.ouvrir_la_page_membres')} variante="plein" onPress={onMembresGlobal} testID="esport-inviter-membres" /> : null}
              {peut('members.invite') ? <AjouterUnCompte theme={theme} client={client} detail={detail} contexte={contexte} onFait={recharger} /> : null}
            </Panneau>
          ) : null}
          {/* Rôles Discord temporaires (réglage de la team › Discord) : la section s'efface pour qui ne peut pas les donner. */}
          {peut('members.view') && detail.modules.some(m => m.cle === 'discord' && m.active) ? <OctroisRolesTemp theme={theme} client={client} teamId={teamId} /> : null}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Roles theme={theme} client={client} detail={detail} roles={roles} onChange={recharger} />
        </View>
      </View>
      <Text style={attenue}>{tr('membresRoles.les_roles_d_equipe')}</Text>
    </View>
  );
}

/**
 * Ajouter à CETTE team un compte qui existe déjà (invité, actif dans d'autres
 * teams, ou compte du hub jamais connecté à l'Esport), sans quitter la team :
 * recherche, choix du compte, puis le même formulaire que la page Membres
 * (plusieurs teams d'un coup, un rôle par team, erreurs affichées).
 */
function AjouterUnCompte({ theme, client, detail, contexte, onFait }: { theme: ThemeHub; client: ClientEsport; detail: DetailTeam; contexte?: ContexteHub; onFait(): Promise<void> }) {
  const [ouvert, setOuvert] = useState(false);
  const [annuaire, setAnnuaire] = useState<Annuaire | undefined>();
  const [recherche, setRecherche] = useState('');
  const [choisi, setChoisi] = useState<string | undefined>();
  const { erreur, agir } = useAgir();
  const teamId = detail.team.id;
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };

  const charger = useCallback(async () => setAnnuaire(await client.annuaire()), [client]);
  const complete = Boolean(annuaire?.superAdmin && contexte?.profils && !contexte.profils.restreint && !contexte.profils.gestion);
  const comptes: CompteEsport[] = useMemo(
    () => (annuaire ? [...annuaire.comptes, ...comptesHubSansEsport(annuaire.comptes, contexte?.profils?.tous, complete)] : []),
    [annuaire, contexte?.profils, complete],
  );
  const q = recherche.trim().toLocaleLowerCase('fr');
  const candidats = comptes.filter(c => !c.appartenances.some(a => a.teamId === teamId) && (!q || c.pseudo.toLocaleLowerCase('fr').includes(q)));
  const fiche = comptes.find(c => c.compte === choisi);

  return (
    <View style={{ gap: 8 }} testID="esport-ajouter-compte">
      {!ouvert ? (
        <BoutonHub
          theme={theme}
          titre={tr('membresRoles.ajouter_un_compte_existant')}
          onPress={() => {
            setOuvert(true);
            void agir('', charger);
          }}
          testID="esport-ajouter-compte-ouvrir"
        />
      ) : (
        <>
          <Champ theme={theme} libelle={tr('membresRoles.compte_a_ajouter')} valeur={recherche} onChanger={setRecherche} placeholder={tr('membresRoles.rechercher_par_pseudo')} maxLength={40} testID="esport-ajouter-compte-recherche" />
          {erreur ? <Avis theme={theme} genre="critique" texte={erreur} testID="esport-ajouter-compte-erreur" /> : null}
          {!annuaire && !erreur ? <Text style={attenue}>{tr('journal.chargement')}</Text> : null}
          {annuaire && candidats.length === 0 ? <Text style={attenue}>{tr('membresRoles.aucun_compte_a_ajouter')}</Text> : null}
          <Choix
            theme={theme}
            libelle={tr('membresRoles.compte_s_hors_de', { comptes: trn('membresGlobal.comptes', candidats.length) })}
            valeur={choisi}
            options={candidats.slice(0, 40).map(c => ({ id: c.compte, nom: c.horsEsport ? tr('membresRoles.jamais_connecte', { pseudo: c.pseudo }) : c.pseudo }))}
            onChoisir={setChoisi}
            testID="esport-ajouter-compte-choix"
          />
          {annuaire && fiche ? (
            <AjoutTeams
              key={fiche.compte}
              theme={theme}
              compte={fiche}
              annuaire={annuaire}
              client={client}
              teamInitiale={teamId}
              onFait={async () => {
                await charger();
                await onFait();
              }}
            />
          ) : null}
          <BoutonHub theme={theme} titre={tr('discord.fermer')} onPress={() => setOuvert(false)} testID="esport-ajouter-compte-fermer" />
        </>
      )}
    </View>
  );
}

function LigneMembre({
  theme,
  membre,
  roles,
  peutRole,
  peutRetirer,
  occupe,
  onAction,
  client,
  teamId,
  fondateur = false,
  onExporter,
}: {
  theme: ThemeHub;
  membre: Membre;
  roles: Role[];
  peutRole: boolean;
  peutRetirer: boolean;
  occupe: boolean;
  onAction(libelle: string, action: () => Promise<string | void>): void;
  client: ClientEsport;
  teamId: string;
  /** Fondateur : demandes RGPD d'un membre (export, suppression du compte Esport). */
  fondateur?: boolean;
  onExporter?(nom: string, contenu: string, type?: string): Promise<boolean>;
}) {
  const [ouvert, setOuvert] = useState(false);
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  const suspendu = membre.statut === 'suspendu';
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 8, gap: 8 }} testID={`esport-membre-${membre.compte}`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tr('membresGlobal.gerer', { pseudo: membre.pseudo })}
        accessibilityState={{ expanded: ouvert }}
        onPress={() => setOuvert(o => !o)}
        style={[styles.ligne, { minHeight: 44 }]}>
        <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: teinteTransparente(membre.role.couleur, 0.25) }}>
          <Text style={[texte, { fontWeight: '800' }]}>{membre.pseudo.slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 120 }}>
          <Text style={[texte, { fontWeight: '700', opacity: suspendu ? 0.5 : 1 }]} numberOfLines={1}>
            {membre.pseudo}
            {membre.moi ? tr('membresGlobal.vous') : ''}
          </Text>
          <Text style={attenue} numberOfLines={1}>
            {[membre.posteJeu, membre.riotId, suspendu ? tr('membresRoles.suspendu') : undefined].filter(Boolean).join(' · ') || tr('membresRoles.depuis_le', { v: dateCourte(membre.rejointLe).split(' ')[0] })}
          </Text>
        </View>
        <PastilleRole theme={theme} nom={nomRole(membre.role.nom)} couleur={membre.role.couleur} testID={`esport-membre-role-${membre.compte}`} />
      </Pressable>
      {ouvert ? (
        <View style={{ gap: 8, paddingLeft: 8 }}>
          {peutRole && roles.length > 0 ? (
            <Choix
              theme={theme}
              libelle={tr('membresRoles.role_de', { pseudo: membre.pseudo })}
              valeur={membre.role.id}
              options={roles.map(r => ({ id: r.id, nom: nomRole(r.nom), couleur: r.couleur }))}
              onChoisir={roleId => onAction('role', async () => {
                await client.modifierMembre(teamId, membre.id, { roleId });
                return tr('membresRoles.role_de_change', { pseudo: membre.pseudo });
              })}
              testID={`esport-role-de-${membre.compte}`}
            />
          ) : null}
          <View style={styles.ligne}>
            {peutRetirer && !membre.moi ? (
              <BoutonHub
                theme={theme}
                titre={suspendu ? tr('membresGlobal.reactiver') : tr('membresGlobal.suspendre')}
                desactive={occupe}
                onPress={() => onAction('statut', async () => {
                  await client.modifierMembre(teamId, membre.id, { statut: suspendu ? 'actif' : 'suspendu' });
                  return suspendu ? tr('membresRoles.est_reactive', { pseudo: membre.pseudo }) : tr('membresRoles.est_suspendu', { pseudo: membre.pseudo });
                })}
                testID={`esport-suspendre-${membre.compte}`}
              />
            ) : null}
            {(peutRetirer && !membre.moi) || membre.moi ? (
              <BoutonConfirme
                theme={theme}
                titre={membre.moi ? tr('membresRoles.quitter_la_team') : tr('membresGlobal.retirer_de_la_team')}
                confirmation={membre.moi ? tr('membresRoles.oui_quitter') : tr('membresRoles.oui_retirer', { pseudo: membre.pseudo })}
                desactive={occupe}
                onConfirme={() => onAction('retrait', async () => {
                  await client.retirerMembre(teamId, membre.id);
                  return membre.moi ? tr('membresRoles.vous_avez_quitte_la') : tr('membresRoles.a_ete_retire', { pseudo: membre.pseudo });
                })}
                testID={`esport-retirer-${membre.compte}`}
              />
            ) : null}
          </View>
          {fondateur && !membre.moi ? (
            <View style={{ gap: 6 }} testID={`esport-rgpd-${membre.compte}`}>
              <Text style={attenue}>{tr('membresRoles.demande_rgpd_de_fondateur', { pseudo: membre.pseudo })}</Text>
              <View style={styles.ligne}>
                {onExporter ? (
                  <BoutonHub
                    theme={theme}
                    titre={tr('membresRoles.exporter_ses_donnees')}
                    desactive={occupe}
                    onPress={() => onAction('export', async () => {
                      const donnees = await client.exporterCompte(membre.compte);
                      return (await onExporter(`esport-donnees-${membre.compte}.json`, JSON.stringify(donnees, null, 2), 'application/json')) ? tr('membresRoles.donnees_de_exportees', { pseudo: membre.pseudo }) : undefined;
                    })}
                    testID={`esport-rgpd-exporter-${membre.compte}`}
                  />
                ) : null}
                <BoutonConfirme
                  theme={theme}
                  titre={tr('membresRoles.supprimer_son_compte_esport')}
                  confirmation={tr('membresRoles.oui_effacer_partout', { pseudo: membre.pseudo })}
                  desactive={occupe}
                  onConfirme={() => onAction('suppression', async () => {
                    await client.supprimerCompte(membre.compte);
                    return tr('membresRoles.compte_esport_de_supprime', { pseudo: membre.pseudo });
                  })}
                  testID={`esport-rgpd-supprimer-${membre.compte}`}
                />
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** Rôle en cours d'édition : `origine` = permissions enregistrées (pour surligner les changements). */
type EditionRole = { id?: string; systeme?: boolean; nom: string; couleur: string; permissions: string[]; origine: string[]; nomOrigine: string; couleurOrigine: string };

/**
 * Peut-on modifier ce rôle (approximation de la règle du serveur) : `roles.manage`, jamais le
 * Propriétaire, et — hors Propriétaire et Fondateur — seulement un rôle placé sous le sien.
 */
export function roleModifiable(role: Role, roles: readonly Role[], detail: DetailTeam): boolean {
  const moi = detail.moi;
  if (role.cle === 'proprietaire' || !moi.permissions.includes('roles.manage')) return false;
  if (moi.superAdmin || moi.role?.cle === 'proprietaire') return true;
  const monRole = roles.find(r => r.id === moi.role?.id);
  return Boolean(monRole && role.position > monRole.position);
}

function Roles({ theme, client, detail, roles, onChange }: { theme: ThemeHub; client: ClientEsport; detail: DetailTeam; roles: Role[]; onChange(): Promise<void> }) {
  const [choisi, setChoisi] = useState<string | undefined>();
  const [edition, setEdition] = useState<EditionRole | undefined>();
  const [confirmer, setConfirmer] = useState(false);
  const { enCours, erreur, avis, agir } = useAgir();
  const actifs = detail.modules.filter(m => m.active).map(m => m.cle);
  const lignes = lignesMatrice(actifs);
  const role = roles.find(r => r.id === choisi) ?? roles[0];
  const gere = detail.moi.permissions.includes('roles.manage');
  const mes = new Set(detail.moi.superAdmin || detail.moi.role?.cle === 'proprietaire' ? CATALOGUE.groupes.flatMap(g => g.permissions.map(p => p.cle)) : detail.moi.permissions);
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  const cellule = { flex: 1, minWidth: 54, alignItems: 'center' as const, justifyContent: 'center' as const, paddingVertical: 4 };
  const modifiable = role ? roleModifiable(role, roles, detail) : false;

  const perms = edition ? new Set(edition.permissions) : new Set(role?.permissions ?? []);
  const origine = new Set(edition?.origine ?? []);
  const ajoutees = edition ? edition.permissions.filter(p => !origine.has(p)) : [];
  const retirees = edition ? edition.origine.filter(p => !perms.has(p)) : [];
  const changements = ajoutees.length + retirees.length + (edition?.id && !edition.systeme && (edition.nom.trim() !== edition.nomOrigine || edition.couleur !== edition.couleurOrigine) ? 1 : 0);
  const sansChangement = Boolean(edition?.id) && changements === 0;

  const editer = (e: EditionRole | undefined) => {
    setConfirmer(false);
    setEdition(e);
  };
  // Rôle de la Team CM lié à un rôle CM : comme un rôle système ici (permissions de team seulement).
  const editionDe = (r: Role): EditionRole => ({ id: r.id, systeme: r.systeme || Boolean(r.cmRoleId), nom: r.nom, couleur: r.couleur, permissions: [...r.permissions], origine: [...r.permissions], nomOrigine: r.nom, couleurOrigine: r.couleur });

  const enregistrer = () =>
    void agir('role', async () => {
      if (!edition) return '';
      const corps = edition.systeme ? { permissions: edition.permissions } : { nom: edition.nom.trim(), couleur: edition.couleur, permissions: edition.permissions };
      const r = edition.id ? await client.modifierRole(detail.team.id, edition.id, corps) : await client.creerRole(detail.team.id, { nom: edition.nom.trim(), couleur: edition.couleur, permissions: edition.permissions });
      editer(undefined);
      setChoisi(r.id);
      await onChange();
      return edition.id ? tr('membresRoles.permissions_enregistrees', { nom: nomRole(r.nom) }) : tr('membresRoles.role_enregistre', { nom: r.nom });
    });

  const description = !role
    ? ''
    : role.cle === 'proprietaire'
      ? tr('membresRoles.role_proprietaire_verrouille')
      : role.systeme
        ? role.modifie
          ? tr('membresRoles.role_systeme_modifie')
          : tr('membresRoles.role_systeme_defaut')
        : tr('membresRoles.role_personnalise');

  return (
    <Panneau theme={theme} testID="esport-roles">
      <Intertitre theme={theme}>{tr('membresRoles.roles_et_permissions')}</Intertitre>
      <Choix
        theme={theme}
        libelle={tr('membresRoles.role_affiche')}
        valeur={edition ? undefined : role?.id}
        options={roles.map(r => ({ id: r.id, nom: `${nomRole(r.nom)}${r.modifie ? ' *' : ''}${r.membres ? ` (${r.membres})` : ''}`, couleur: r.couleur }))}
        onChoisir={id => {
          editer(undefined);
          setChoisi(id);
        }}
        testID="esport-role-choisi"
      />
      {role && !edition ? (
        <Text style={attenue} testID="esport-role-description">
          {description}
        </Text>
      ) : null}
      {edition?.id && edition.systeme ? (
        <Text style={[attenue, { color: theme.texte }]} testID="esport-role-edition-titre">
          {tr('membresRoles.edition_systeme', { nom: nomRole(edition.nom) })}
        </Text>
      ) : null}
      {edition && !edition.systeme ? (
        <View style={{ gap: 8 }}>
          <Champ theme={theme} libelle={tr('membresRoles.nom_du_role')} valeur={edition.nom} onChanger={nom => setEdition({ ...edition, nom })} maxLength={40} testID="esport-role-nom" />
          <Choix theme={theme} libelle={tr('membresRoles.couleur')} valeur={edition.couleur} options={couleursRole().map(([c, nom]) => ({ id: c, nom, couleur: c }))} onChoisir={couleur => setEdition({ ...edition, couleur })} testID="esport-role-couleur" />
        </View>
      ) : null}
      {/* Matrice : modules en lignes, actions en colonnes. En édition, les cases changées sont surlignées. */}
      {/* Sur téléphone la matrice (6 colonnes) défile en largeur dans son cadre : la page, elle, ne déborde pas. */}
      <ScrollView horizontal accessibilityRole="none" testID="esport-matrice" style={{ borderWidth: 1, borderColor: theme.ligne, borderRadius: 8, flexGrow: 0 }} contentContainerStyle={{ minWidth: '100%' }}>
      <View style={{ minWidth: 440, flexGrow: 1 }}>
        <View style={[styles.ligne, { flexWrap: 'nowrap', gap: 0, backgroundColor: theme.fond, paddingHorizontal: 8 }]}>
          <Text style={[attenue, { flex: 2, minWidth: 90, fontWeight: '700' }]}>{tr('journal.module')}</Text>
          {COLONNES.map(c => (
            <Text key={c} style={[attenue, cellule, { textAlign: 'center', fontWeight: '700' }]}>
              {LIBELLES_COLONNES[c]}
            </Text>
          ))}
        </View>
        {lignes.map(l => (
          <View key={l.cle} style={[styles.ligne, { flexWrap: 'nowrap', gap: 0, borderTopWidth: 1, borderTopColor: theme.ligne, paddingHorizontal: 8 }]}>
            <Text style={{ flex: 2, minWidth: 90, color: theme.texte, fontSize: 13, ...police(theme.policeTexte) }}>{l.nom}</Text>
            {COLONNES.map(c => (
              <View key={c} style={[cellule, { gap: 4 }]}>
                {l.colonnes[c].map(p => {
                  if (!edition) {
                    return (
                      <Text
                        key={p.cle}
                        accessibilityLabel={`${l.nom} : ${p.libelle} : ${perms.has(p.cle) ? tr('membresRoles.oui') : tr('membresRoles.non')}`}
                        testID={`esport-case-${p.cle}`}
                        style={{ color: perms.has(p.cle) ? theme.ok : theme.attenue, fontSize: c === 'special' ? 11 : 15, fontWeight: '700', textAlign: 'center' }}>
                        {c === 'special' ? `${perms.has(p.cle) ? '✓' : '·'} ${p.libelle}` : perms.has(p.cle) ? '✓' : '·'}
                      </Text>
                    );
                  }
                  const change = perms.has(p.cle) !== origine.has(p.cle) && Boolean(edition.id);
                  // Anti-escalade : on ne coche que ce que l'on a soi-même ; décocher reste possible.
                  const bloquee = !perms.has(p.cle) && !mes.has(p.cle);
                  return (
                    <View
                      key={p.cle}
                      testID={change ? `esport-perm-changee-${p.cle}` : undefined}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, padding: 3, borderRadius: 6, opacity: bloquee ? 0.35 : 1, backgroundColor: change ? teinteTransparente(theme.alerte, 0.35) : 'transparent' }}>
                      <Case
                        theme={theme}
                        coche={perms.has(p.cle)}
                        libelle={`${l.nom} : ${p.libelle}${change ? ` (${tr('membresRoles.non_enregistre')})` : ''}`}
                        onChanger={v => {
                          if (v && !mes.has(p.cle)) return;
                          setConfirmer(false);
                          setEdition({ ...edition, permissions: v ? [...edition.permissions, p.cle] : edition.permissions.filter(x => x !== p.cle) });
                        }}
                        testID={`esport-perm-${p.cle}`}
                      />
                      {c === 'special' ? <Text style={{ color: theme.texte, fontSize: 11 }}>{p.libelle}</Text> : null}
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        ))}
      </View>
      </ScrollView>
      <Text style={attenue}>{tr('membresRoles.seuls_les_modules_actives')}</Text>
      {edition?.id ? (
        <Text style={{ color: changements ? theme.alerte : theme.attenue, fontSize: 12, fontWeight: '700' }} testID="esport-role-changements">
          {changements ? trn('membresRoles.changements_non_enregistres', changements, { ajouts: ajoutees.length, retraits: retirees.length }) : tr('membresRoles.aucun_changement')}
        </Text>
      ) : null}
      {gere ? (
        <View style={styles.ligne}>
          {edition ? (
            confirmer ? (
              <>
                <Text style={{ color: theme.texte, fontSize: 13, flexBasis: '100%' }} testID="esport-role-confirmation">
                  {tr('membresRoles.confirmer_systeme', { nom: nomRole(edition.nom), n: String(roles.find(r => r.id === edition.id)?.membres ?? 0) })}
                </Text>
                <BoutonHub theme={theme} titre={tr('membresRoles.confirmer_enregistrer')} variante="plein" desactive={Boolean(enCours)} onPress={enregistrer} testID="esport-role-enregistrer-confirmer" />
                <BoutonHub theme={theme} titre={tr('assistant.annuler')} onPress={() => setConfirmer(false)} testID="esport-role-enregistrer-annuler" />
              </>
            ) : (
              <>
                <BoutonHub
                  theme={theme}
                  titre={enCours ? tr('membresRoles.enregistrement') : edition.id ? tr('membresRoles.enregistrer') : tr('membresRoles.enregistrer_le_role')}
                  variante="plein"
                  desactive={Boolean(enCours) || sansChangement}
                  onPress={() => (edition.systeme ? setConfirmer(true) : enregistrer())}
                  testID="esport-role-enregistrer"
                />
                <BoutonHub theme={theme} titre={tr('assistant.annuler')} onPress={() => editer(undefined)} testID="esport-role-annuler" />
              </>
            )
          ) : (
            <>
              {detail.team.genre === 'cm' ? null : <BoutonHub theme={theme} titre={tr('membresRoles.nouveau_role')} onPress={() => editer({ nom: '', couleur: couleursRole()[4][0], permissions: ['members.view'], origine: [], nomOrigine: '', couleurOrigine: '' })} testID="esport-role-nouveau" />}
              {role && detail.team.genre !== 'cm' ? (
                <BoutonHub
                  theme={theme}
                  titre={tr('membresRoles.dupliquer')}
                  onPress={() => {
                    const nom = tr('membresRoles.copie', { nom: role.nom }).slice(0, 40);
                    editer({ nom, couleur: role.couleur, permissions: role.permissions.filter(p => mes.has(p)), origine: [], nomOrigine: nom, couleurOrigine: role.couleur });
                  }}
                  testID="esport-role-dupliquer"
                />
              ) : null}
              {role && modifiable ? (
                <BoutonHub theme={theme} titre={role.systeme || role.cmRoleId ? tr('membresRoles.modifier_permissions') : tr('membresRoles.modifier')} onPress={() => editer(editionDe(role))} testID="esport-role-modifier" />
              ) : null}
              {role && modifiable && role.systeme && role.modifie ? (
                <BoutonConfirme
                  theme={theme}
                  titre={tr('membresRoles.retablir_defaut')}
                  confirmation={tr('membresRoles.retablir_confirmer', { nom: nomRole(role.nom) })}
                  onConfirme={() =>
                    void agir('role', async () => {
                      const r = await client.retablirRole(detail.team.id, role.id);
                      await onChange();
                      return tr('membresRoles.permissions_retablies', { nom: nomRole(r.nom) });
                    })
                  }
                  testID="esport-role-retablir"
                />
              ) : null}
              {role && !role.systeme && !role.cmRoleId && modifiable ? (
                <BoutonConfirme
                  theme={theme}
                  titre={tr('discord.supprimer')}
                  confirmation={tr('membresRoles.supprimer', { nom: role.nom })}
                  onConfirme={() =>
                    void agir('suppression', async () => {
                      await client.supprimerRole(detail.team.id, role.id);
                      setChoisi(undefined);
                      await onChange();
                      return tr('membresRoles.role_supprime');
                    })
                  }
                  testID="esport-role-supprimer"
                />
              ) : null}
            </>
          )}
        </View>
      ) : null}
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-roles" />
    </Panneau>
  );
}
