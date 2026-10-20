/**
 * Page « Membres » de l'Esport (premier niveau) : tous les membres de toutes
 * les teams où l'on voit les membres (le Fondateur : toutes), avec filtres
 * (team, rôle, statut invité / actif / suspendu) et recherche.
 *
 * Actions, selon les droits de CHAQUE team (le serveur revérifie tout,
 * anti-escalade comprise) : créer un compte (Fondateur, sur son appareil),
 * ajouter un compte existant à une team, changer son rôle, le retirer d'une
 * team, le suspendre, renvoyer ou révoquer l'invitation (Fondateur).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { InvitationAffichee } from '../../profils/identifiants';
import { PanneauInvitation } from '../../hub/admin/ui/EnvoiInvitation';
import { Avis, BoutonHub, Champ, Intertitre, Panneau, Pilule, Segments } from '../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../hub/themes';
import type { AppHub, ContexteHub } from '../../hub/types';
import type { Annuaire, AppartenanceCompte, ClientEsport, CompteEsport, TeamAnnuaire } from '../client';
import { capaciteComptes, emailDe, modeleInvitationEsport, noterEnvoiEsport, renvoyerInvitation, revoquerCompte } from '../comptesHub';
import { comptesOrphelins } from '../synchroAdmin';
import { BoutonConfirme, Choix, PastilleRole, Retours, TitreSection, styles as communs, useAgir } from './commun';
import { CreationCompte, roleParDefaut } from './CreationCompte';
import { useIdentite } from './Identite';

type FiltreStatut = 'tous' | 'invite' | 'actif' | 'suspendu';

/** Statut affiché d'un compte : invité, suspendu (dans toutes ses teams visibles) ou actif. */
export function statutAffiche(c: CompteEsport): Exclude<FiltreStatut, 'tous'> {
  if (c.statut === 'invite') return 'invite';
  if (c.appartenances.length > 0 && c.appartenances.every(a => a.statut === 'suspendu')) return 'suspendu';
  return 'actif';
}

/** Filtres de la page (purs, testés). */
export function filtrerComptes(comptes: readonly CompteEsport[], f: { recherche: string; team: string; role: string; statut: FiltreStatut }): CompteEsport[] {
  const q = f.recherche.trim().toLocaleLowerCase('fr');
  return comptes.filter(c => {
    if (q && !`${c.pseudo} ${c.riotId ?? ''} ${c.discord ?? ''}`.toLocaleLowerCase('fr').includes(q)) return false;
    if (f.team !== 'toutes' && !c.appartenances.some(a => a.teamId === f.team)) return false;
    if (f.role !== 'tous' && !c.appartenances.some(a => (f.team === 'toutes' || a.teamId === f.team) && a.role.nom === f.role)) return false;
    if (f.statut === 'suspendu') return c.appartenances.some(a => a.statut === 'suspendu');
    if (f.statut !== 'tous' && statutAffiche(c) !== f.statut) return false;
    return true;
  });
}

const LIBELLES_STATUT: Record<Exclude<FiltreStatut, 'tous'>, string> = { invite: 'Invité', actif: 'Actif', suspendu: 'Suspendu' };

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
  const [ouvert, setOuvert] = useState<string | undefined>();
  const { enCours, erreur, avis, agir } = useAgir();
  const identite = useIdentite(contexte);

  const recharger = useCallback(async () => setAnnuaire(await client.annuaire()), [client]);
  useEffect(() => {
    void agir('', recharger);
  }, [agir, recharger]);

  const capacite = capaciteComptes(contexte, Boolean(annuaire?.superAdmin));
  const peutAjouter = Boolean(annuaire?.teams.some(t => t.droits.ajouter));
  const visibles = useMemo(() => (annuaire ? filtrerComptes(annuaire.comptes, { recherche, team, role, statut }) : []), [annuaire, recherche, team, role, statut]);
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
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 1200, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled" testID="esport-membres-global">
      <View style={[communs.ligne, { justifyContent: 'space-between' }]}>
        <TitreSection theme={theme} titre="Membres" sous={annuaire ? `${annuaire.comptes.length} compte(s) dans ${annuaire.teams.length} team(s)` : 'Chargement…'} />
        {capacite.creer ? (
          <BoutonHub theme={theme} titre="Créer un compte" variante="plein" onPress={() => setCreation(c => !c)} testID="esport-membres-creer" />
        ) : null}
      </View>
      {!capacite.creer && peutAjouter ? <Text style={attenue} testID="esport-membres-creation-indisponible">{capacite.raison}</Text> : null}
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-membres-global" />
      {identite.rendu(theme)}
      {creation && annuaire && capacite.creer ? (
        <CreationCompte
          theme={theme}
          client={client}
          contexte={contexte}
          registre={registre}
          annuaire={annuaire}
          exigerIdentite={identite.exiger}
          equipeInitiale={team !== 'toutes' ? team : undefined}
          onFini={() => {
            setCreation(false);
            void agir('', recharger);
          }}
          onAnnuler={() => setCreation(false)}
        />
      ) : null}
      {orphelins.length > 0 ? (
        <Panneau theme={theme} testID="esport-membres-orphelins">
          <Intertitre theme={theme}>Comptes supprimés de l’Administration</Intertitre>
          <Text style={attenue}>Ces comptes n’existent plus dans le hub mais sont encore dans l’Esport (serveur injoignable au moment de la suppression).</Text>
          {orphelins.map(c => (
            <View key={c.compte} style={communs.ligne}>
              <Text style={[texte, { flex: 1 }]}>{c.pseudo}</Text>
              <BoutonHub
                theme={theme}
                titre="Retirer de l’Esport"
                variante="danger"
                desactive={Boolean(enCours)}
                onPress={() =>
                  action('Retrait', async () => {
                    const r = await client.retirerCompte(c.compte);
                    return `${c.pseudo} retiré de l’Esport (${r.teams} team(s)).`;
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
          <Champ theme={theme} libelle="Rechercher" valeur={recherche} onChanger={setRecherche} placeholder="Pseudo, Riot ID, Discord" maxLength={40} testID="esport-membres-recherche" />
          <Segments<FiltreStatut>
            theme={theme}
            libelle="Statut"
            valeur={statut}
            options={[['tous', 'Tous'], ['invite', 'Invités'], ['actif', 'Actifs'], ['suspendu', 'Suspendus']]}
            onChoisir={setStatut}
            testID="esport-membres-statut"
          />
          {annuaire.teams.length > 1 ? (
            <Choix
              theme={theme}
              libelle="Team"
              valeur={team}
              options={[{ id: 'toutes', nom: 'Toutes' }, ...annuaire.teams.map(t => ({ id: t.id, nom: t.nom }))]}
              onChoisir={v => {
                setTeam(v);
                setRole('tous');
              }}
              testID="esport-membres-team"
            />
          ) : null}
          <Choix theme={theme} libelle="Rôle" valeur={role} options={[{ id: 'tous', nom: 'Tous' }, ...nomsRoles.map(n => ({ id: n, nom: n }))]} onChoisir={setRole} testID="esport-membres-role" />
        </Panneau>
      ) : null}
      {annuaire && annuaire.teams.length === 0 ? (
        <Panneau theme={theme}>
          <Text style={texte}>Vous ne voyez les membres d’aucune team.</Text>
        </Panneau>
      ) : null}
      <View style={{ gap: 8 }} testID="esport-membres-liste">
        {annuaire && visibles.length === 0 && annuaire.comptes.length > 0 ? <Text style={attenue}>Aucun membre ne correspond aux filtres.</Text> : null}
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
    exigerIdentite(`Renvoyer l’invitation de ${compte.pseudo}`, () =>
      onAction('Invitation', async () => {
        setErreurLocale(undefined);
        const inv = await renvoyerInvitation(contexte, compte.compte, compte.pseudo, contexte.maintenant ?? Date.now());
        setInvitation(inv);
        if (inv.erreur) setErreurLocale(inv.erreur);
        return inv.erreur ? undefined : `Nouvelle invitation de ${compte.pseudo} prête : l’ancienne ne fonctionne plus.`;
      }),
    );
  const revoquer = () =>
    exigerIdentite(`Révoquer l’accès de ${compte.pseudo}`, () =>
      onAction('Révocation', async () => {
        await revoquerCompte(contexte, compte.compte, compte.pseudo, contexte.maintenant ?? Date.now());
        // Côté Esport : suspendu dans ses teams (rétablir l'accès se fait dans l'Administration).
        for (const a of compte.appartenances) {
          if (a.statut === 'actif' && a.gerable) await client.modifierMembre(a.teamId, a.membreId, { statut: 'suspendu' }).catch(() => undefined);
        }
        setInvitation(undefined);
        return `${compte.pseudo} ne peut plus se connecter (invitation annulée, compte désactivé dans l’Administration).`;
      }),
    );

  return (
    <View style={{ borderWidth: 1, borderColor: ouvert ? theme.accent : theme.ligne, borderRadius: theme.rayonMoyen, backgroundColor: theme.surface }} testID={`esport-compte-${compte.compte}`}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Gérer ${compte.pseudo}`} accessibilityState={{ expanded: ouvert }} onPress={onBasculer} style={{ padding: 12, gap: 6 }}>
        <View style={[communs.ligne, { gap: 10 }]}>
          <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: teinteTransparente(couleur, 0.22) }}>
            <Text style={[texte, { fontWeight: '800' }]}>{compte.pseudo.slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 140 }}>
            <Text style={[texte, { fontWeight: '700' }]} numberOfLines={1}>
              {compte.pseudo}
              {compte.moi ? ' (vous)' : ''}
            </Text>
            <Text style={attenue} numberOfLines={1}>
              {[compte.riotId, nomsTeams.join(', ') || 'Aucune team'].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <Pilule theme={theme} texte={LIBELLES_STATUT[statut]} couleur={couleur} testID={`esport-compte-statut-${compte.compte}`} />
        </View>
        {large || ouvert ? (
          <View style={[communs.ligne, { paddingLeft: 44 }]}>
            {compte.appartenances.map(a => (
              <PastilleRole key={a.membreId} theme={theme} nom={`${teamDe(a.teamId)?.nom ?? '?'} · ${a.role.nom}${a.statut === 'suspendu' ? ' (suspendu)' : ''}`} couleur={a.role.couleur} />
            ))}
          </View>
        ) : null}
      </Pressable>
      {ouvert ? (
        <View style={{ padding: 12, paddingTop: 0, gap: 12 }}>
          {compte.appartenances.map(a => {
            const t = teamDe(a.teamId);
            return t ? <Appartenance key={a.membreId} theme={theme} compte={compte} a={a} team={t} occupe={occupe} client={client} onAction={onAction} onOuvrirTeam={onOuvrirTeam} /> : null;
          })}
          <AjoutTeam theme={theme} compte={compte} annuaire={annuaire} occupe={occupe} client={client} onAction={onAction} />
          {capacite && statut === 'invite' ? (
            <View style={{ gap: 8 }} testID={`esport-compte-invitation-${compte.compte}`}>
              <Intertitre theme={theme}>Invitation</Intertitre>
              <Text style={attenue}>{`Pas encore connecté${compte.inviteLe ? ` (invité le ${compte.inviteLe.slice(0, 10).split('-').reverse().join('/')})` : ''}.`}</Text>
              <View style={communs.ligne}>
                <BoutonHub theme={theme} titre="Renvoyer l’invitation" desactive={occupe || !hubConnu} onPress={renvoyer} testID={`esport-renvoyer-${compte.compte}`} />
                <BoutonConfirme theme={theme} titre="Révoquer l’invitation" confirmation={`Oui, révoquer ${compte.pseudo}`} desactive={occupe || !hubConnu} onConfirme={revoquer} testID={`esport-revoquer-${compte.compte}`} />
              </View>
              {!hubConnu ? <Text style={attenue}>Compte pas encore visible sur cet appareil (synchronisation en cours).</Text> : null}
              {erreurLocale ? <Avis theme={theme} genre="critique" texte={erreurLocale} /> : null}
              {invitation && !invitation.erreur ? (
                <PanneauInvitation
                  theme={theme}
                  nom={compte.pseudo}
                  invitation={invitation}
                  email={emailDe(contexte, compte.compte)}
                  modele={modeleInvitationEsport(nomsTeams)}
                  fondateur={contexte.profils?.actuel.nom}
                  onEnvoye={canal => noterEnvoiEsport(contexte, compte.compte, compte.pseudo, canal)}
                />
              ) : null}
            </View>
          ) : null}
          {capacite && onOuvrirApp && !compte.moi ? (
            <Text style={attenue}>
              Supprimer le compte (il quitte alors toutes ses teams) ou rétablir un accès révoqué :{' '}
              <Text style={{ color: theme.accent, fontWeight: '700' }} accessibilityRole="link" onPress={() => onOuvrirApp('administration')} testID={`esport-compte-administration-${compte.compte}`}>
                Administration
              </Text>
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
          <Text style={attenue}>{`  ${a.role.nom}${a.posteJeu ? ` · ${a.posteJeu}` : ''}${suspendu ? ' · suspendu' : ''}`}</Text>
        </Text>
        <BoutonHub theme={theme} titre="Ouvrir la team" onPress={() => onOuvrirTeam(team.id)} testID={`esport-appartenance-ouvrir-${slug}`} />
      </View>
      {peutRole ? (
        <Choix
          theme={theme}
          libelle={`Rôle dans ${team.nom}`}
          valeur={a.role.id}
          options={team.roles.map(r => ({ id: r.id, nom: r.nom, couleur: r.couleur, desactive: !r.attribuable }))}
          onChoisir={roleId =>
            onAction('Rôle', async () => {
              await client.modifierMembre(team.id, a.membreId, { roleId });
              return `Rôle de ${compte.pseudo} changé dans ${team.nom}.`;
            })
          }
          testID={`esport-appartenance-role-${slug}`}
        />
      ) : !a.gerable && (team.droits.roles || team.droits.retirer) && !compte.moi ? (
        <Text style={attenue}>Rôle au-dessus du vôtre : vous ne pouvez pas modifier ce membre.</Text>
      ) : null}
      {peutRetirer ? (
        <View style={communs.ligne}>
          <BoutonHub
            theme={theme}
            titre={suspendu ? 'Réactiver' : 'Suspendre'}
            desactive={occupe}
            onPress={() =>
              onAction('Statut', async () => {
                await client.modifierMembre(team.id, a.membreId, { statut: suspendu ? 'actif' : 'suspendu' });
                return suspendu ? `${compte.pseudo} est réactivé dans ${team.nom}.` : `${compte.pseudo} est suspendu dans ${team.nom}.`;
              })
            }
            testID={`esport-appartenance-suspendre-${slug}`}
          />
          <BoutonConfirme
            theme={theme}
            titre="Retirer de la team"
            confirmation={`Oui, retirer de ${team.nom}`}
            desactive={occupe}
            onConfirme={() =>
              onAction('Retrait', async () => {
                await client.retirerMembre(team.id, a.membreId);
                return `${compte.pseudo} a été retiré de ${team.nom}.`;
              })
            }
            testID={`esport-appartenance-retirer-${slug}`}
          />
        </View>
      ) : null}
    </View>
  );
}

/** Ajouter ce compte (déjà visible) à une autre team où l'on peut ajouter. */
function AjoutTeam({
  theme,
  compte,
  annuaire,
  occupe,
  client,
  onAction,
}: {
  theme: ThemeHub;
  compte: CompteEsport;
  annuaire: Annuaire;
  occupe: boolean;
  client: ClientEsport;
  onAction(libelle: string, faire: () => Promise<string | void>): void;
}) {
  const possibles = annuaire.teams.filter(t => t.droits.ajouter && !t.archivee && !compte.appartenances.some(a => a.teamId === t.id));
  const [teamId, setTeamId] = useState<string | undefined>();
  const [roleId, setRoleId] = useState<string | undefined>();
  const [poste, setPoste] = useState('');
  if (possibles.length === 0) return null;
  const team = possibles.find(t => t.id === teamId);
  return (
    <View style={{ gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: theme.ligne }} testID={`esport-ajout-${compte.compte}`}>
      <Intertitre theme={theme}>Ajouter à une team</Intertitre>
      <Choix
        theme={theme}
        libelle="Team"
        valeur={teamId}
        options={possibles.map(t => ({ id: t.id, nom: t.nom }))}
        onChoisir={id => {
          setTeamId(id);
          const t = possibles.find(x => x.id === id);
          setRoleId(t ? roleParDefaut(t) : undefined);
        }}
        testID={`esport-ajout-team-${compte.compte}`}
      />
      {team ? (
        <>
          <Choix
            theme={theme}
            libelle={`Rôle dans ${team.nom}`}
            valeur={roleId}
            options={team.roles.map(r => ({ id: r.id, nom: r.nom, couleur: r.couleur, desactive: !r.attribuable }))}
            onChoisir={setRoleId}
            testID={`esport-ajout-role-${compte.compte}`}
          />
          <Champ theme={theme} libelle="Poste en jeu (facultatif)" valeur={poste} onChanger={setPoste} maxLength={30} testID={`esport-ajout-poste-${compte.compte}`} />
          <BoutonHub
            theme={theme}
            titre={`Ajouter à ${team.nom}`}
            variante="plein"
            desactive={occupe || !roleId}
            onPress={() =>
              onAction('Ajout', async () => {
                await client.ajouterMembre(team.id, { compte: compte.compte, roleId: roleId!, ...(poste.trim() ? { posteJeu: poste.trim() } : {}) });
                setTeamId(undefined);
                setPoste('');
                return `${compte.pseudo} est ajouté à ${team.nom}.`;
              })
            }
            testID={`esport-ajout-valider-${compte.compte}`}
          />
        </>
      ) : null}
    </View>
  );
}
