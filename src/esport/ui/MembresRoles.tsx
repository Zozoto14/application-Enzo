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
import { Pressable, Text, View } from 'react-native';
import { BoutonHub, Case, Champ } from '../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../hub/themes';
import { CATALOGUE, LIBELLES_COLONNES, lignesMatrice, type ClientEsport, type DetailTeam, type Membre, type Role } from '../client';
import { dateCourte } from '../libelles';
import { BoutonConfirme, Choix, PastilleRole, Retours, TitreSection, styles, useAgir, Intertitre, Panneau } from './commun';

const COULEURS: ReadonlyArray<readonly [string, string]> = [
  ['#d64545', 'Rouge'],
  ['#f59e0b', 'Ambre'],
  ['#16a34a', 'Vert'],
  ['#0891b2', 'Cyan'],
  ['#2563eb', 'Bleu'],
  ['#7c3aed', 'Violet'],
  ['#db2777', 'Rose'],
  ['#8b8b9a', 'Gris'],
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
}: {
  theme: ThemeHub;
  client: ClientEsport;
  detail: DetailTeam;
  large: boolean;
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
      <TitreSection theme={theme} titre="Membres et rôles" sous={`${membres.filter(m => m.statut === 'actif').length} membre(s) actif(s)`} />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-membres" />
      <View style={large ? { flexDirection: 'row', gap: 16, alignItems: 'flex-start' } : { gap: 16 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 16 }}>
          {peut('members.view') ? (
            <Panneau theme={theme} testID="esport-liste-membres">
              <Intertitre theme={theme}>Membres</Intertitre>
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
              <Intertitre theme={theme}>Inviter quelqu’un</Intertitre>
              <Text style={{ color: theme.texte, ...police(theme.policeTexte) }}>
                {detail.moi.superAdmin
                  ? 'Créez son compte depuis la page Membres de l’Esport (nom, e-mail, team et rôle) : il reçoit un e-mail, choisit son mot de passe et voit directement la team. Plus aucun code à transmettre.'
                  : peut('members.create')
                    ? 'Depuis la page Membres de l’Esport : proposez un nouveau membre (le Fondateur valide la création de son compte) ou ajoutez un compte qui a déjà l’Esport.'
                    : 'Ajoutez à la team un compte qui existe déjà depuis la page Membres de l’Esport. Seul le Fondateur crée de nouveaux comptes.'}
              </Text>
              {onMembresGlobal ? <BoutonHub theme={theme} titre="Ouvrir la page Membres" variante="plein" onPress={onMembresGlobal} testID="esport-inviter-membres" /> : null}
            </Panneau>
          ) : null}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Roles theme={theme} client={client} detail={detail} roles={roles} onChange={recharger} />
        </View>
      </View>
      <Text style={attenue}>Les rôles d’équipe sont propres à l’Esport : ils ne changent jamais le rang d’un compte dans le hub.</Text>
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
        accessibilityLabel={`Gérer ${membre.pseudo}`}
        accessibilityState={{ expanded: ouvert }}
        onPress={() => setOuvert(o => !o)}
        style={[styles.ligne, { minHeight: 44 }]}>
        <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: teinteTransparente(membre.role.couleur, 0.25) }}>
          <Text style={[texte, { fontWeight: '800' }]}>{membre.pseudo.slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 120 }}>
          <Text style={[texte, { fontWeight: '700', opacity: suspendu ? 0.5 : 1 }]} numberOfLines={1}>
            {membre.pseudo}
            {membre.moi ? ' (vous)' : ''}
          </Text>
          <Text style={attenue} numberOfLines={1}>
            {[membre.posteJeu, membre.riotId, suspendu ? 'suspendu' : undefined].filter(Boolean).join(' · ') || `depuis le ${dateCourte(membre.rejointLe).split(' ')[0]}`}
          </Text>
        </View>
        <PastilleRole theme={theme} nom={membre.role.nom} couleur={membre.role.couleur} testID={`esport-membre-role-${membre.compte}`} />
      </Pressable>
      {ouvert ? (
        <View style={{ gap: 8, paddingLeft: 8 }}>
          {peutRole && roles.length > 0 ? (
            <Choix
              theme={theme}
              libelle={`Rôle de ${membre.pseudo}`}
              valeur={membre.role.id}
              options={roles.map(r => ({ id: r.id, nom: r.nom, couleur: r.couleur }))}
              onChoisir={roleId => onAction('Rôle', async () => {
                await client.modifierMembre(teamId, membre.id, { roleId });
                return `Rôle de ${membre.pseudo} changé.`;
              })}
              testID={`esport-role-de-${membre.compte}`}
            />
          ) : null}
          <View style={styles.ligne}>
            {peutRetirer && !membre.moi ? (
              <BoutonHub
                theme={theme}
                titre={suspendu ? 'Réactiver' : 'Suspendre'}
                desactive={occupe}
                onPress={() => onAction('Statut', async () => {
                  await client.modifierMembre(teamId, membre.id, { statut: suspendu ? 'actif' : 'suspendu' });
                  return suspendu ? `${membre.pseudo} est réactivé.` : `${membre.pseudo} est suspendu.`;
                })}
                testID={`esport-suspendre-${membre.compte}`}
              />
            ) : null}
            {(peutRetirer && !membre.moi) || membre.moi ? (
              <BoutonConfirme
                theme={theme}
                titre={membre.moi ? 'Quitter la team' : 'Retirer de la team'}
                confirmation={membre.moi ? 'Oui, quitter' : `Oui, retirer ${membre.pseudo}`}
                desactive={occupe}
                onConfirme={() => onAction('Retrait', async () => {
                  await client.retirerMembre(teamId, membre.id);
                  return membre.moi ? 'Vous avez quitté la team.' : `${membre.pseudo} a été retiré.`;
                })}
                testID={`esport-retirer-${membre.compte}`}
              />
            ) : null}
          </View>
          {fondateur && !membre.moi ? (
            <View style={{ gap: 6 }} testID={`esport-rgpd-${membre.compte}`}>
              <Text style={attenue}>Demande RGPD de {membre.pseudo} (Fondateur) : ses données Esport, dans toutes les teams.</Text>
              <View style={styles.ligne}>
                {onExporter ? (
                  <BoutonHub
                    theme={theme}
                    titre="Exporter ses données"
                    desactive={occupe}
                    onPress={() => onAction('Export', async () => {
                      const donnees = await client.exporterCompte(membre.compte);
                      return (await onExporter(`esport-donnees-${membre.compte}.json`, JSON.stringify(donnees, null, 2), 'application/json')) ? `Données de ${membre.pseudo} exportées.` : undefined;
                    })}
                    testID={`esport-rgpd-exporter-${membre.compte}`}
                  />
                ) : null}
                <BoutonConfirme
                  theme={theme}
                  titre="Supprimer son compte Esport"
                  confirmation={`Oui, effacer ${membre.pseudo} partout`}
                  desactive={occupe}
                  onConfirme={() => onAction('Suppression', async () => {
                    await client.supprimerCompte(membre.compte);
                    return `Compte Esport de ${membre.pseudo} supprimé (ses contenus de team sont anonymisés).`;
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

function Roles({ theme, client, detail, roles, onChange }: { theme: ThemeHub; client: ClientEsport; detail: DetailTeam; roles: Role[]; onChange(): Promise<void> }) {
  const [choisi, setChoisi] = useState<string | undefined>();
  const [edition, setEdition] = useState<{ id?: string; nom: string; couleur: string; permissions: string[] } | undefined>();
  const { enCours, erreur, avis, agir } = useAgir();
  const actifs = detail.modules.filter(m => m.active).map(m => m.cle);
  const lignes = lignesMatrice(actifs);
  const role = roles.find(r => r.id === choisi) ?? roles[0];
  const gere = detail.moi.permissions.includes('roles.manage');
  const mes = new Set(detail.moi.superAdmin || detail.moi.role?.cle === 'proprietaire' ? CATALOGUE.groupes.flatMap(g => g.permissions.map(p => p.cle)) : detail.moi.permissions);
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  const cellule = { flex: 1, minWidth: 54, alignItems: 'center' as const, justifyContent: 'center' as const, paddingVertical: 4 };

  const perms = edition ? new Set(edition.permissions) : new Set(role?.permissions ?? []);

  return (
    <Panneau theme={theme} testID="esport-roles">
      <Intertitre theme={theme}>Rôles et permissions</Intertitre>
      <Choix
        theme={theme}
        libelle="Rôle affiché"
        valeur={edition ? undefined : role?.id}
        options={roles.map(r => ({ id: r.id, nom: `${r.nom}${r.membres ? ` (${r.membres})` : ''}`, couleur: r.couleur }))}
        onChoisir={id => {
          setEdition(undefined);
          setChoisi(id);
        }}
        testID="esport-role-choisi"
      />
      {role && !edition ? <Text style={attenue}>{role.systeme ? 'Rôle système : non modifiable (sauf « Créer des membres »), mais duplicable en rôle personnalisé.' : 'Rôle personnalisé.'}</Text> : null}
      {role && !edition && role.systeme && role.cle !== 'proprietaire' && gere && mes.has('members.create') ? (
        <View style={[styles.ligne, { flexWrap: 'nowrap' }]} testID="esport-role-creer-membres">
          <Case
            theme={theme}
            coche={role.permissions.includes('members.create')}
            libelle={`${role.nom} : créer des membres`}
            onChanger={v =>
              void agir('Rôle', async () => {
                const permissions = v ? [...role.permissions, 'members.create'] : role.permissions.filter(p => p !== 'members.create');
                await client.modifierRole(detail.team.id, role.id, { permissions });
                await onChange();
                return v ? `${role.nom} : peut proposer de nouveaux membres (le Fondateur valide la création du compte).` : `${role.nom} : ne propose plus de membres.`;
              })
            }
            testID="esport-role-creer-membres-case"
          />
          <Text style={{ flex: 1, color: theme.texte, fontSize: 13, ...police(theme.policeTexte) }}>
            Créer des membres : proposer un nouveau compte au Fondateur, ou ajouter un compte qui a déjà l’Esport (rôle au plus égal au sien).
          </Text>
        </View>
      ) : null}
      {edition ? (
        <View style={{ gap: 8 }}>
          <Champ theme={theme} libelle="Nom du rôle" valeur={edition.nom} onChanger={nom => setEdition({ ...edition, nom })} maxLength={40} testID="esport-role-nom" />
          <Choix theme={theme} libelle="Couleur" valeur={edition.couleur} options={COULEURS.map(([c, nom]) => ({ id: c, nom, couleur: c }))} onChoisir={couleur => setEdition({ ...edition, couleur })} testID="esport-role-couleur" />
        </View>
      ) : null}
      {/* Matrice : modules en lignes, actions en colonnes. */}
      <View accessibilityRole="none" testID="esport-matrice" style={{ borderWidth: 1, borderColor: theme.ligne, borderRadius: 8, overflow: 'hidden' }}>
        <View style={[styles.ligne, { flexWrap: 'nowrap', gap: 0, backgroundColor: theme.fond, paddingHorizontal: 8 }]}>
          <Text style={[attenue, { flex: 2, minWidth: 90, fontWeight: '700' }]}>Module</Text>
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
                {l.colonnes[c].map(p =>
                  edition ? (
                    <Case
                      key={p.cle}
                      theme={theme}
                      coche={perms.has(p.cle)}
                      libelle={`${l.nom} : ${p.libelle}`}
                      onChanger={v => {
                        if (!mes.has(p.cle)) return;
                        setEdition({ ...edition, permissions: v ? [...edition.permissions, p.cle] : edition.permissions.filter(x => x !== p.cle) });
                      }}
                      testID={`esport-perm-${p.cle}`}
                    />
                  ) : (
                    <Text
                      key={p.cle}
                      accessibilityLabel={`${l.nom} : ${p.libelle} : ${perms.has(p.cle) ? 'oui' : 'non'}`}
                      testID={`esport-case-${p.cle}`}
                      style={{ color: perms.has(p.cle) ? theme.ok : theme.attenue, fontSize: c === 'special' ? 11 : 15, fontWeight: '700', textAlign: 'center' }}>
                      {c === 'special' ? `${perms.has(p.cle) ? '✓' : '·'} ${p.libelle}` : perms.has(p.cle) ? '✓' : '·'}
                    </Text>
                  ),
                )}
              </View>
            ))}
          </View>
        ))}
      </View>
      <Text style={attenue}>Seuls les modules activés sont listés. On ne donne jamais une permission que l’on n’a pas soi-même.</Text>
      {gere ? (
        <View style={styles.ligne}>
          {edition ? (
            <>
              <BoutonHub
                theme={theme}
                titre={enCours ? 'Enregistrement…' : 'Enregistrer le rôle'}
                variante="plein"
                desactive={Boolean(enCours)}
                onPress={() =>
                  void agir('Rôle', async () => {
                    const corps = { nom: edition.nom.trim(), couleur: edition.couleur, permissions: edition.permissions };
                    const r = edition.id ? await client.modifierRole(detail.team.id, edition.id, corps) : await client.creerRole(detail.team.id, corps);
                    setEdition(undefined);
                    setChoisi(r.id);
                    await onChange();
                    return `Rôle « ${r.nom} » enregistré.`;
                  })
                }
                testID="esport-role-enregistrer"
              />
              <BoutonHub theme={theme} titre="Annuler" onPress={() => setEdition(undefined)} testID="esport-role-annuler" />
            </>
          ) : (
            <>
              <BoutonHub theme={theme} titre="Nouveau rôle" onPress={() => setEdition({ nom: '', couleur: COULEURS[4][0], permissions: ['members.view'] })} testID="esport-role-nouveau" />
              {role ? (
                <BoutonHub
                  theme={theme}
                  titre="Dupliquer"
                  onPress={() => setEdition({ nom: `${role.nom} (copie)`.slice(0, 40), couleur: role.couleur, permissions: role.permissions.filter(p => mes.has(p)) })}
                  testID="esport-role-dupliquer"
                />
              ) : null}
              {role && !role.systeme ? (
                <>
                  <BoutonHub theme={theme} titre="Modifier" onPress={() => setEdition({ id: role.id, nom: role.nom, couleur: role.couleur, permissions: role.permissions })} testID="esport-role-modifier" />
                  <BoutonConfirme
                    theme={theme}
                    titre="Supprimer"
                    confirmation={`Supprimer « ${role.nom} »`}
                    onConfirme={() =>
                      void agir('Suppression', async () => {
                        await client.supprimerRole(detail.team.id, role.id);
                        setChoisi(undefined);
                        await onChange();
                        return 'Rôle supprimé.';
                      })
                    }
                    testID="esport-role-supprimer"
                  />
                </>
              ) : null}
            </>
          )}
        </View>
      ) : null}
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-roles" />
    </Panneau>
  );
}
