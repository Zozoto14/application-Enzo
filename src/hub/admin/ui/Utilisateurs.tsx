/**
 * Section « Utilisateurs » : recherche, filtres, tri, sélection et actions
 * groupées ; fiche d'un compte (accès par app, modèles de permissions,
 * invitation, expiration, suspension, notes, accès administrateur par
 * séquestre, identifiants, suppression) ; création d'un compte.
 *
 * Toute modification passe par `outils.modifierProfils`, qui revalide la
 * liste et journalise. Les actions sensibles passent par
 * `outils.exigerIdentite` (mot de passe + code de l'administrateur).
 */

import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { OptionsInvitationHote } from '../../../ui/ecrans/CarteProfils';
import { QrCode } from '../../../ui/ecrans/CarteSynchro';
import type { IdentifiantsAmi, InvitationAffichee } from '../../../profils/identifiants';
import type { Profil } from '../../../profils/profils';
import { police, teinteTransparente, type ThemeHub } from '../../themes';
import type { AppHub } from '../../types';
import {
  annulerInvitationPar,
  appliquerGroupePar,
  avecEmailCreationPar,
  avecLangueComptePar,
  avecLangueCreationPar,
  avecEmailPar,
  avecEnvoiPar,
  avecNotePar,
  definirExpirationPar,
  definirNiveauxPar,
  desactiverPar,
  prolongerInvitationPar,
  reactiverPar,
  renommerProfilPar,
  sansContactPar,
  suspendrePar,
  verifierGroupe,
  verifierGroupeRang,
  verifierSur,
} from '../actions';
import { LANGUES_COMPTE, LIBELLES_CANAL, NOMS_LANGUES, erreurEmail, langueDuCompte, normaliserEmail, type CanalInvitation, type LangueCompte } from '../contacts';
import { LIBELLES_TYPE } from '../journal';
import { PanneauInvitation } from './EnvoiInvitation';
import { LIBELLES_STATUT, filtrerComptes, niveauProfil, niveauxProfil, recapitulatif, statutCompte, versAutorisations, type StatutCompte, type TriComptes } from '../comptes';
import { LONGUEUR_MAX_NOTE } from '../donnees';
import { CE_QUE_NE_PERMET_PAS, CE_QUE_PERMET, LIBELLES_RANG, NIVEAU_RANG, RANGS, autorise, rangDe, rangsAttribuables, type Rang } from '../roles';
import { LIBELLES_NIVEAU, MODELES, modeleCorrespondant, niveauxDe, niveauxDuModele, type IdModele, type NiveauAcces, type Niveaux } from '../niveaux';
import { etatApp } from '../politique';
import { ID_ESPORT, aAccesEsport, perimetreEsportSeul } from '../../../esport/acces';
import { pousserLangueEsport, retirerCompteEsport } from '../../../esport/synchroAdmin';
import { Avis, BoutonHub, Case, Champ, Intertitre, Panneau, Pilule, Segments, commun, dansJours, dateLisible, relatif, styleTitre, type OutilsAdmin } from './commun';
import { Glyphe } from '../../../ui/icones';
import { Icone } from '../../../ui/icones';

type Filtre = StatutCompte | 'tous';

function couleurStatut(theme: ThemeHub, statut: StatutCompte): string {
  switch (statut) {
    case 'admin':
      return theme.teintes.admin;
    case 'actif':
      return theme.ok;
    case 'invite':
      return theme.accent;
    case 'invitation-expiree':
    case 'suspendu':
      return theme.alerte;
    default:
      return theme.critique;
  }
}

const LIBELLES_SEQUESTRE: Record<NonNullable<Profil['sequestre']>, string> = {
  actif: 'Accès possible avec VOTRE code d’accès (chaque titulaire a le sien)',
  depose: 'Dépôt reçu : il sera converti à votre prochaine ouverture de l’Administration',
  attendu: 'Pas encore de séquestre pour vous : créé à la prochaine connexion du compte, ou re-scellé par un Fondateur',
  revoque: 'Votre accès à ce compte est révoqué',
  absent: 'Séquestre absent',
};

/** Couleur d'un rang (badge). */
function couleurRang(theme: ThemeHub, rang: Rang): string {
  return rang === 'fondateur' ? theme.critique : rang === 'administrateur' ? theme.teintes.admin : rang === 'gestionnaire' ? theme.accent : theme.attenue;
}

/** Badge de rang (rien pour un simple ami). */
function BadgeRang({ theme, profil, testID }: { theme: ThemeHub; profil: Profil; testID?: string }) {
  const rang = rangDe(profil);
  if (rang === 'ami') return null;
  return <Pilule theme={theme} texte={LIBELLES_RANG[rang]} couleur={couleurRang(theme, rang)} testID={testID} />;
}

/** Options d'invitation réglées par le Fondateur (politique du mot de passe de l'ami). */
export function optionsInvitation(outils: OutilsAdmin): OptionsInvitationHote {
  const r = outils.donnees.reglages;
  return { politique: { longueurMin: r.mdpLongueurMin, forceMin: Math.min(4, Math.max(1, r.mdpForceMin)) as 1 | 2 | 3 | 4 } };
}

/** Note une transmission d'invitation : historique du compte (données chiffrées) et journal (sans l'adresse). */
export function noterEnvoi(outils: OutilsAdmin, id: string | undefined, nom: string, canal: CanalInvitation): void {
  if (!id) return;
  try {
    outils.majDonnees(d => avecEnvoiPar(outils.acteur, d, outils.tous, id, canal, outils.maintenant()));
  } catch {
    return;
  }
  outils.journaliser({ type: 'invitation', cible: id, nomCible: nom, action: `Invitation de ${nom} transmise (${LIBELLES_CANAL[canal].toLowerCase()})` });
}

type Identifiants = { nom: string; valeurs: IdentifiantsAmi; id?: string };

/**
 * Retire de l'Esport un compte qui vient d'être supprimé (teams, données
 * Esport). Jamais bloquant : un échec est dit, journalisé, et la page Membres
 * de l'Esport le proposera de nouveau. Rend la phrase à ajouter à l'avis.
 */
export async function retirerDeLEsport(outils: OutilsAdmin, profil: Profil, cibleJournal: { cible: string; nomCible: string }): Promise<string> {
  try {
    const bilan = await retirerCompteEsport(profil.id);
    if (bilan.inactif) return '';
    if (bilan.retire) {
      outils.journaliser({ type: 'compte', ...cibleJournal, app: ID_ESPORT, action: `${profil.nom} retiré de l’Esport (${bilan.teams} team${bilan.teams > 1 ? 's' : ''})` });
      return ` Retiré aussi de l’Esport (${bilan.teams} team${bilan.teams > 1 ? 's' : ''}).`;
    }
    return '';
  } catch (e) {
    outils.journaliser({ type: 'compte', ...cibleJournal, app: ID_ESPORT, action: `Retrait de ${profil.nom} de l’Esport à refaire (serveur Esport injoignable)` });
    return ` L’Esport n’a pas pu être prévenu (${e instanceof Error ? e.message : 'erreur'}) : retirez-le depuis Esport › Membres.`;
  }
}

export function Utilisateurs({ outils, cible }: { outils: OutilsAdmin; cible?: string }) {
  const { theme, tous, registre, controle } = outils;
  const maintenant = outils.maintenant();
  const [recherche, setRecherche] = useState('');
  const [statut, setStatut] = useState<Filtre>('tous');
  const [app, setApp] = useState<string>('toutes');
  const [tri, setTri] = useState<TriComptes>('nom');
  const [roleFiltre, setRoleFiltre] = useState<'tous' | Rang>('tous');
  const [selection, setSelection] = useState<string[]>([]);
  const [choisi, setChoisi] = useState<string | undefined>(cible);
  const [creation, setCreation] = useState(false);
  const [identifiants, setIdentifiants] = useState<Identifiants | undefined>();
  const [invitationsGroupe, setInvitationsGroupe] = useState<Array<{ id: string; nom: string; invitation: InvitationAffichee }> | undefined>();
  const gestionnaire = outils.role === 'gestionnaire';
  // Une app qui choisit elle-même à qui elle s'ouvre (Tâches) n'a pas de case ici.
  const attribuables = registre.filter(a => !a.adminSeulement && !a.attribueeParApp);
  const liste = filtrerComptes(tous, { recherche, statut, app: app === 'toutes' ? undefined : app, tri, role: roleFiltre }, registre, maintenant);
  // Seuls les comptes de rang strictement inférieur se sélectionnent (actions groupées).
  const actionnable = (p: Profil) => autorise(outils.acteur, 'etat-ami', p).ok;
  const amisVisibles = liste.filter(actionnable).map(p => p.id);
  const selectionnes = selection.filter(id => tous.some(p => p.id === id && actionnable(p)));
  // Filtre par rang : les rangs que l'acteur peut voir (le sien pour un Fondateur, qui voit ses pairs).
  const rangsVisibles = RANGS.filter(r => NIVEAU_RANG[r] < NIVEAU_RANG[outils.role] || (r === 'fondateur' && outils.role === 'fondateur'));
  const profil = tous.find(p => p.id === choisi);
  const attenue = { color: theme.attenue, ...police(theme.policeTexte) };
  const texte = { color: theme.texte, ...police(theme.policeTexte) };

  const basculer = (id: string, coche: boolean) => setSelection(s => (coche ? [...new Set([...s, id])] : s.filter(x => x !== id)));

  const barreGroupee = selectionnes.length > 0 ? (
    <ActionsGroupees outils={outils} ids={selectionnes} apps={attribuables} onFini={() => setSelection([])} onInvitations={setInvitationsGroupe} />
  ) : null;

  const detail = identifiants ? (
    <PanneauIdentifiants outils={outils} nom={identifiants.nom} valeurs={identifiants.valeurs} id={identifiants.id ?? identifiants.valeurs.id} onTermine={() => setIdentifiants(undefined)} />
  ) : creation ? (
    <FormulaireCreation
      outils={outils}
      apps={attribuables}
      onAnnuler={() => setCreation(false)}
      onCree={(nom, valeurs) => {
        setCreation(false);
        setIdentifiants({ nom, valeurs, id: valeurs.id });
      }}
    />
  ) : profil ? (
    <Fiche key={profil.id} outils={outils} profil={profil} apps={attribuables} onIdentifiants={(nom, valeurs) => setIdentifiants({ nom, valeurs, id: profil.id })} onSupprime={() => setChoisi(undefined)} />
  ) : (
    <Panneau theme={theme}>
      <Text style={attenue}>
        {gestionnaire
          ? 'Sélectionnez un ami pour ouvrir sa fiche, ou créez un compte. Seuls les amis que vous avez créés apparaissent ici : les autres comptes de cet appareil restent isolés.'
          : 'Sélectionnez un utilisateur pour ouvrir sa fiche, ou créez un compte.'}
      </Text>
      {gestionnaire ? null : (
        <Text style={[attenue, { fontSize: 12 }]} testID="admin-rangs-explication">
          Rangs : Fondateur › Administrateur › Gestionnaire › Ami. Chacun n’agit que sur les rangs strictement inférieurs ; la clé d’un compte n’est
          scellée que pour les Administrateurs et Fondateurs de rang supérieur.
        </Text>
      )}
    </Panneau>
  );

  return (
    <View style={{ gap: 16 }} testID="admin-section-utilisateurs">
      <Panneau theme={theme}>
        <View style={[commun.ligne, { justifyContent: 'space-between', flexWrap: 'wrap', paddingVertical: 0 }]}>
          <Text style={[styleTitre(theme), { fontSize: 20 }]}>{gestionnaire ? `${tous.length} ami${tous.length > 1 ? 's' : ''} que vous gérez` : `${tous.length} compte${tous.length > 1 ? 's' : ''}`}</Text>
          <BoutonHub
            theme={theme}
            variante="plein"
            couleur={theme.teintes.admin}
            titre="＋ Nouvel utilisateur"
            testID="admin-nouveau"
            desactive={Boolean(outils.enCours) || Boolean(identifiants) || !controle.onCreerCompte || controle.restreint === true || !autorise(outils.acteur, 'creer-ami').ok}
            onPress={() => {
              setChoisi(undefined);
              setCreation(true);
            }}
          />
        </View>
        <Champ theme={theme} libelle="Rechercher un prénom" valeur={recherche} onChanger={setRecherche} placeholder="ex. Lucas" testID="admin-recherche" />
        <Segments<Filtre>
          theme={theme}
          libelle="Statut"
          valeur={statut}
          options={[['tous', 'Tous'], ['actif', 'Actifs'], ['invite', 'Invités'], ['invitation-expiree', 'Invitation expirée'], ['suspendu', 'Suspendus'], ['desactive', 'Désactivés'], ['expire', 'Expirés']]}
          onChoisir={setStatut}
          testID="admin-filtre-statut"
        />
        {gestionnaire ? null : (
          <Segments<'tous' | Rang>
            theme={theme}
            libelle="Rang"
            valeur={roleFiltre}
            options={[['tous', 'Tous les rangs'], ...rangsVisibles.map(r => [r, `${LIBELLES_RANG[r]}s`] as const)]}
            onChoisir={setRoleFiltre}
            testID="admin-filtre-rang"
          />
        )}
        <View style={[commun.grille, { alignItems: 'center' }]}>
          <Segments
            theme={theme}
            libelle="Application"
            valeur={app}
            options={[['toutes', 'Toutes les apps'], ...attribuables.map(a => [a.id, a.nom] as const)]}
            onChoisir={setApp}
            testID="admin-filtre-app"
          />
          <Segments<TriComptes>
            theme={theme}
            libelle="Trier par"
            valeur={tri}
            options={[['nom', 'Nom'], ['statut', 'Statut'], ['connexion', 'Connexion'], ['creation', 'Création']]}
            onChoisir={setTri}
            testID="admin-tri"
          />
        </View>
      </Panneau>

      {barreGroupee}

      {invitationsGroupe ? (
        <Panneau theme={theme} testID="admin-groupe-invitations">
          <View style={[commun.ligne, { justifyContent: 'space-between', paddingVertical: 0, flexWrap: 'wrap' }]}>
            <Intertitre theme={theme}>{`Invitations prêtes (${invitationsGroupe.length})`}</Intertitre>
            <BoutonHub theme={theme} titre="Fermer" onPress={() => setInvitationsGroupe(undefined)} testID="admin-groupe-invitations-fermer" />
          </View>
          {invitationsGroupe.map(({ id, nom, invitation }) => (
            <View key={id} style={{ gap: 6 }} testID={`admin-groupe-invitation-${id}`}>
              <Text style={[texte, { fontWeight: '700' }]}>{nom}</Text>
              <PanneauInvitation
                theme={theme}
                nom={nom}
                invitation={invitation}
                email={outils.donnees.contacts[id]?.email}
                modele={outils.donnees.modeleInvitation}
                langueInitiale={langueDuCompte(outils.donnees.contacts[id])}
                fondateur={outils.acteur.nom}
                onEnvoye={canal => noterEnvoi(outils, id, nom, canal)}
              />
            </View>
          ))}
        </Panneau>
      ) : null}

      <View style={[{ gap: 16 }, outils.large && { flexDirection: 'row', alignItems: 'flex-start' }]}>
        <Panneau theme={theme} style={[{ padding: 0, gap: 0 }, outils.large && { flex: 1.2 }]} testID="admin-liste">
          <View style={[commun.ligne, { paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: theme.ligne }]}>
            <Case
              theme={theme}
              coche={amisVisibles.length > 0 && amisVisibles.every(id => selection.includes(id))}
              libelle="Tout sélectionner"
              onChanger={v => setSelection(v ? amisVisibles : [])}
              testID="admin-tout-selectionner"
            />
            <Text style={[attenue, { fontSize: 12 }]}>
              {liste.length} affiché{liste.length > 1 ? 's' : ''}
              {selectionnes.length > 0 ? ` · ${selectionnes.length} sélectionné${selectionnes.length > 1 ? 's' : ''}` : ''}
            </Text>
          </View>
          {liste.length === 0 ? <Text style={[attenue, { padding: 12 }]}>Aucun compte ne correspond.</Text> : null}
          {liste.map((p, index) => {
            const s = statutCompte(p, maintenant);
            const actif = p.id === choisi && !creation;
            return (
              <View
                key={p.id}
                style={[
                  commun.ligne,
                  { paddingHorizontal: 12 },
                  index > 0 && { borderTopWidth: 1, borderTopColor: theme.ligne },
                  actif && { backgroundColor: teinteTransparente(theme.teintes.admin, 0.12) },
                ]}>
                {!actionnable(p) ? <View style={{ width: 22 }} /> : <Case theme={theme} coche={selection.includes(p.id)} libelle={`Sélectionner ${p.nom}`} onChanger={v => basculer(p.id, v)} testID={`admin-case-${p.id}`} />}
                <Pressable
                  testID={`admin-ligne-${p.id}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: actif }}
                  accessibilityLabel={`Ouvrir la fiche de ${p.nom}`}
                  onPress={() => {
                    setCreation(false);
                    setChoisi(p.id);
                  }}
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36 }}>
                  <View style={[commun.carre, { width: 32, height: 32, backgroundColor: p.admin ? theme.teintes.admin : teinteTransparente(theme.teintes.admin, 0.18), borderRadius: theme.rayonGrand ? 16 : 0 }]}>
                    <Text style={{ color: p.admin ? theme.surAccent : theme.teintes.admin, fontWeight: '700' }}>{p.nom.slice(0, 1).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[texte, { fontWeight: '600' }]} numberOfLines={1}>
                      {p.nom}
                    </Text>
                    <Text style={[attenue, { fontSize: 12 }]} numberOfLines={1}>
                      {p.admin
                        ? 'Toutes les apps'
                        : registre
                            .filter(a => niveauProfil(p, a) !== 'aucun')
                            .map(a => (niveauProfil(p, a) === 'lecture' ? `${a.nom} (lecture)` : a.nom))
                            .join(', ') || 'Aucune app'}
                      {gestionnaire ? '' : ' · '}
                      {gestionnaire ? '' : p.derniereConnexion ? `vu ${relatif(p.derniereConnexion, maintenant)}` : 'jamais connecté'}
                      {!gestionnaire && p.appareils && p.appareils.length > 0 ? ` · ${p.appareils.length} appareil${p.appareils.length > 1 ? 's' : ''}` : ''}
                      {outils.donnees.contacts[p.id]?.email ? ' · ✉︎' : ''}
                    </Text>
                  </View>
                  <BadgeRang theme={theme} profil={p} testID={`admin-rang-${p.id}`} />
                  {perimetreEsportSeul(p) ? <Pilule theme={theme} texte="Esport" couleur={theme.teintes.anime} testID={`admin-esport-${p.id}`} /> : null}
                  {p.titulaire === 'en-attente' ? <Pilule theme={theme} texte="Clé en attente" couleur={theme.alerte} testID={`admin-titulaire-${p.id}`} /> : null}
                  <Pilule theme={theme} texte={LIBELLES_STATUT[s]} couleur={couleurStatut(theme, s)} testID={`admin-statut-${p.id}`} />
                </Pressable>
              </View>
            );
          })}
        </Panneau>
        <View style={outils.large ? { flex: 1, minWidth: 0 } : undefined}>{detail}</View>
      </View>
    </View>
  );
}

// --- Actions groupées --------------------------------------------------------------

function ActionsGroupees({
  outils,
  ids,
  apps,
  onFini,
  onInvitations,
}: {
  outils: OutilsAdmin;
  ids: string[];
  apps: AppHub[];
  onFini(): void;
  onInvitations(liste: Array<{ id: string; nom: string; invitation: InvitationAffichee }>): void;
}) {
  const { theme, tous, controle } = outils;
  const [modele, setModele] = useState<IdModele>('ami');
  const [appChoisie, setAppChoisie] = useState<string>(apps[0]?.id ?? '');
  const [rang, setRang] = useState<Rang>('ami');
  const noms = ids.map(id => tous.find(p => p.id === id)?.nom ?? id);
  const nomDe = (id: string) => tous.find(p => p.id === id)?.nom ?? id;
  const appliquer = (action: Parameters<typeof appliquerGroupePar>[3], libelle: string) => {
    outils.modifierProfils(
      liste => appliquerGroupePar(outils.acteur, liste, ids, action, apps, outils.maintenant()).profils,
      ids.map(id => ({
        type: action.genre === 'niveaux' || action.genre === 'app' ? 'permissions' : action.genre === 'prolonger' ? 'invitation' : 'compte',
        cible: id,
        nomCible: nomDe(id),
        ...(action.genre === 'app' ? { app: action.app } : {}),
        action: libelle,
      })),
      `${libelle} : ${noms.join(', ')}.`,
    );
    onFini();
  };
  const app = apps.find(a => a.id === appChoisie);
  const niveauOuvert: NiveauAcces = app && niveauxDe(app).includes('complet') ? 'complet' : 'lecture';
  // Rangs qu'on peut donner à TOUTE la sélection (règle des rangs), sauf Fondateur (confirmation forte, compte par compte).
  const rangsGroupe = RANGS.filter(r => r !== 'fondateur' && ids.every(id => rangsAttribuables(outils.acteur, tous.find(p => p.id === id)).includes(r) || rangDe(tous.find(p => p.id === id)) === r));
  const peutRenvoyer = Boolean(controle.onInvitation) && ids.every(id => autorise(outils.acteur, 'regenerer-identifiants', tous.find(p => p.id === id)).ok);

  /** Action faite par l'hôte, compte par compte, après vérification de TOUTE la sélection et de l'identité. */
  const enSerie = (raison: string, verifier: () => void, action: (id: string) => Promise<void>, fin: () => string) => {
    try {
      verifier();
    } catch (e) {
      outils.agir('Vérification…', async () => {
        throw e;
      });
      return;
    }
    outils.exigerIdentite(raison, () =>
      outils.agir(`${raison}…`, async () => {
        const echecs: string[] = [];
        for (const id of ids) {
          try {
            await action(id);
          } catch (e) {
            echecs.push(`${nomDe(id)} : ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        onFini();
        if (echecs.length > 0) throw new Error(`${fin()} Échecs — ${echecs.join(' ; ')}`);
        return fin();
      }),
    );
  };

  const renvoyer = () => {
    const prets: Array<{ id: string; nom: string; invitation: InvitationAffichee }> = [];
    enSerie(
      `Renvoyer une invitation à ${ids.length} compte${ids.length > 1 ? 's' : ''}`,
      () => verifierGroupe(outils.acteur, 'regenerer-identifiants', tous, ids),
      async id => {
        const invitation = await controle.onInvitation!(id, outils.donnees.reglages.invitationJours, optionsInvitation(outils));
        if (invitation.erreur) throw new Error(invitation.erreur);
        prets.push({ id, nom: nomDe(id), invitation });
        outils.journaliser({ type: 'invitation', cible: id, nomCible: nomDe(id), action: `Nouvelle invitation préparée pour ${nomDe(id)} (${outils.donnees.reglages.invitationJours} j, action groupée) : l’ancienne ne fonctionne plus` });
        onInvitations([...prets]);
      },
      () => `Invitations prêtes : ${prets.map(p => p.nom).join(', ') || 'aucune'}. Envoyez-les ci-dessous.`,
    );
  };
  const revoquer = () =>
    enSerie(
      `Révoquer l’accès de ${ids.length} compte${ids.length > 1 ? 's' : ''}`,
      () => verifierGroupe(outils.acteur, 'etat-ami', tous, ids),
      async id => {
        await controle.onRevoquerConnexion!(id, true);
        outils.journaliser({ type: 'compte', cible: id, nomCible: nomDe(id), action: `Accès de ${nomDe(id)} révoqué sur le relais (action groupée)` });
      },
      () => {
        outils.modifierProfils(liste => appliquerGroupePar(outils.acteur, liste, ids, { genre: 'desactiver' }, apps, outils.maintenant()).profils, [], undefined);
        return `Accès révoqués : ${noms.join(', ')} (relais et comptes désactivés).`;
      },
    );
  const changerRang = () =>
    enSerie(
      `Changer le rang de ${ids.length} compte${ids.length > 1 ? 's' : ''} : ${LIBELLES_RANG[rang]}`,
      () => verifierGroupeRang(outils.acteur, tous, ids, rang),
      async id => {
        const avant = rangDe(tous.find(p => p.id === id));
        if (avant === rang) return;
        const { enAttente } = await controle.onChangerRang!(id, rang);
        outils.journaliser({ type: 'role', cible: id, nomCible: nomDe(id), action: `${nomDe(id)} : ${LIBELLES_RANG[avant]} → ${LIBELLES_RANG[rang]} (action groupée)${enAttente ? ' (clé en attente de sa prochaine connexion)' : ''}` });
      },
      () => `Rang ${LIBELLES_RANG[rang]} appliqué : ${noms.join(', ')}.`,
    );

  return (
    <Panneau theme={theme} testID="admin-groupe" style={{ borderColor: theme.teintes.admin }}>
      <Intertitre theme={theme}>{`Actions groupées · ${ids.length} compte${ids.length > 1 ? 's' : ''}`}</Intertitre>
      <Text style={{ color: theme.attenue, fontSize: 13 }}>{noms.join(', ')}</Text>
      <View style={commun.actions}>
        <BoutonHub theme={theme} titre="Désactiver" onPress={() => appliquer({ genre: 'desactiver' }, 'Compte désactivé (action groupée)')} testID="admin-groupe-desactiver" />
        <BoutonHub theme={theme} titre="Réactiver" onPress={() => appliquer({ genre: 'reactiver' }, 'Compte réactivé (action groupée)')} testID="admin-groupe-reactiver" />
        <BoutonHub
          theme={theme}
          titre={`Prolonger l’invitation de ${outils.donnees.reglages.invitationJours} j`}
          onPress={() => appliquer({ genre: 'prolonger', jours: outils.donnees.reglages.invitationJours }, `Invitation prolongée de ${outils.donnees.reglages.invitationJours} jours (action groupée)`)}
          testID="admin-groupe-prolonger"
        />
        {peutRenvoyer ? <BoutonHub theme={theme} titre="Renvoyer l’invitation (nouveau lien)" onPress={renvoyer} testID="admin-groupe-renvoyer" /> : null}
        {controle.onRevoquerConnexion && outils.role !== 'gestionnaire' ? <BoutonHub theme={theme} variante="danger" titre="Révoquer l’accès" onPress={revoquer} testID="admin-groupe-revoquer" /> : null}
      </View>
      {apps.length > 0 ? (
        <View style={[commun.actions, { alignItems: 'center' }]}>
          <Segments theme={theme} libelle="Application" valeur={appChoisie} options={apps.map(a => [a.id, a.nom] as const)} onChoisir={setAppChoisie} testID="admin-groupe-app" />
          <BoutonHub
            theme={theme}
            titre={`Ouvrir ${app?.nom ?? 'l’app'}`}
            desactive={!app}
            onPress={() => app && appliquer({ genre: 'app', app: app.id, niveau: niveauOuvert }, `${app.nom} ouverte${niveauOuvert === 'lecture' ? ' (lecture)' : ''} (action groupée)`)}
            testID="admin-groupe-app-ouvrir"
          />
          <BoutonHub
            theme={theme}
            titre={`Fermer ${app?.nom ?? 'l’app'}`}
            desactive={!app}
            onPress={() => app && appliquer({ genre: 'app', app: app.id, niveau: 'aucun' }, `${app.nom} fermée (action groupée)`)}
            testID="admin-groupe-app-fermer"
          />
        </View>
      ) : null}
      <View style={[commun.actions, { alignItems: 'center' }]}>
        <Segments<IdModele>
          theme={theme}
          libelle="Modèle de permissions"
          valeur={modele}
          options={MODELES.filter(m => m.niveau).map(m => [m.id, m.nom] as const)}
          onChoisir={setModele}
          testID="admin-groupe-modele"
        />
        <BoutonHub
          theme={theme}
          titre="Appliquer le modèle"
          onPress={() => appliquer({ genre: 'niveaux', niveaux: niveauxDuModele(apps, modele) }, `Modèle « ${MODELES.find(m => m.id === modele)?.nom} » appliqué (action groupée)`)}
          testID="admin-groupe-appliquer-modele"
        />
      </View>
      {controle.onChangerRang && outils.role !== 'gestionnaire' && rangsGroupe.length > 0 ? (
        <View style={[commun.actions, { alignItems: 'center' }]}>
          <Segments<Rang> theme={theme} libelle="Nouveau rang" valeur={rangsGroupe.includes(rang) ? rang : rangsGroupe[0]} options={rangsGroupe.map(r => [r, LIBELLES_RANG[r]] as const)} onChoisir={setRang} testID="admin-groupe-rang" />
          <BoutonHub theme={theme} titre="Changer le rang (mot de passe + code)" onPress={changerRang} desactive={!rangsGroupe.includes(rang)} testID="admin-groupe-rang-appliquer" />
        </View>
      ) : null}
      <View style={commun.actions}>
        <BoutonHub theme={theme} titre="Annuler la sélection" onPress={onFini} testID="admin-groupe-annuler" />
      </View>
    </Panneau>
  );
}

// --- Fiche d'un compte -------------------------------------------------------------

function Fiche({
  outils,
  profil,
  apps,
  onIdentifiants,
  onSupprime,
}: {
  outils: OutilsAdmin;
  profil: Profil;
  apps: AppHub[];
  onIdentifiants(nom: string, valeurs: IdentifiantsAmi): void;
  onSupprime(): void;
}) {
  const { theme, controle, registre, donnees } = outils;
  const maintenant = outils.maintenant();
  const [nom, setNom] = useState(profil.nom);
  const [note, setNote] = useState(donnees.notes[profil.id] ?? '');
  const [suspension, setSuspension] = useState('7');
  const [expiration, setExpiration] = useState(profil.expireLe ? profil.expireLe.slice(0, 10) : '');
  const [confirmation, setConfirmation] = useState<'supprimer' | 'regenerer' | undefined>();
  const [saisieConfirmation, setSaisieConfirmation] = useState('');
  const [code, setCode] = useState<{ code: string; creeLe: string } | undefined>();
  const [codeSaisi, setCodeSaisi] = useState('');
  const [ouverture, setOuverture] = useState(false);
  const [codeSite, setCodeSite] = useState<{ code: string; lien?: string } | undefined>();
  const [invitation, setInvitation] = useState<InvitationAffichee | undefined>();
  const [revoqueRelais, setRevoqueRelais] = useState<boolean | undefined>();
  const [joursInvitation, setJoursInvitation] = useState(String(outils.donnees.reglages.invitationJours || 7));
  const contact = donnees.contacts[profil.id];
  const [email, setEmail] = useState(contact?.email ?? '');
  const [langue, setLangue] = useState<LangueCompte>(langueDuCompte(contact));
  const [retourLangue, setRetourLangue] = useState<string | undefined>();
  const [nettoyerRelais, setNettoyerRelais] = useState(true);
  useEffect(() => {
    let actif = true;
    controle.etatConnexion?.(profil.id).then(
      e => actif && setRevoqueRelais(e.revoque),
      () => undefined,
    );
    return () => {
      actif = false;
    };
  }, [controle, profil.id]);
  const statut = statutCompte(profil, maintenant);
  const attenue = { color: theme.attenue, ...police(theme.policeTexte) };
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const niveaux = niveauxProfil(profil, registre);
  const cibleJournal = { cible: profil.id, nomCible: profil.nom };
  const gestionnaire = outils.role === 'gestionnaire';
  const [rangChoisi, setRangChoisi] = useState<Rang | undefined>();
  const [saisieRang, setSaisieRang] = useState('');
  const attribuables = rangsAttribuables(outils.acteur, profil);

  // Règle des rangs : on ne voit la fiche que d'un compte de rang STRICTEMENT inférieur.
  if (!autorise(outils.acteur, 'voir-compte', profil).ok) {
    const soi = profil.id === outils.acteur.id;
    return (
      <Panneau theme={theme} testID="admin-detail">
        <Text style={[styleTitre(theme), { fontSize: 22 }]}>{profil.nom}</Text>
        <View style={[commun.ligne, { paddingVertical: 0 }]}>
          <BadgeRang theme={theme} profil={profil} testID="admin-fiche-rang" />
        </View>
        <Text style={attenue} testID="admin-fiche-lecture-seule">
          {soi
            ? 'C’est votre compte : on n’agit pas sur son propre compte depuis l’Administration.'
            : `Même rang que vous (${LIBELLES_RANG[rangDe(profil)]}) : aucune action possible sur ce compte, ni ouverture, ni modification.`}
        </Text>
        {profil.admin ? <Text style={attenue}>Compte historique : toujours Fondateur. Dernière connexion : {dateLisible(profil.derniereConnexion, true)}</Text> : null}
      </Panneau>
    );
  }

  const changerNiveaux = (suivants: Niveaux, libelle: string) =>
    outils.modifierProfils(liste => definirNiveauxPar(outils.acteur, liste, profil.id, registre, suivants), [{ type: 'permissions', ...cibleJournal, action: libelle }]);
  const modele = modeleCorrespondant(apps, niveaux);

  const regenerer = () =>
    outils.exigerIdentite(`Régénérer les identifiants de ${profil.nom}`, () =>
      outils.agir('Génération des identifiants…', async () => {
        verifierSur(outils.acteur, 'regenerer-identifiants', outils.tous, profil.id);
        const valeurs = await controle.onRegenerer!(profil.id);
        outils.journaliser({ type: 'identifiants', ...cibleJournal, action: `Identifiants régénérés pour ${profil.nom} (nouveau séquestre, nouveau code d’accès)` });
        onIdentifiants(profil.nom, valeurs);
        return `Nouveaux identifiants de ${profil.nom} générés : l’ancien portefeuille a été effacé.`;
      }),
    );
  const avecRelais = nettoyerRelais && Boolean(controle.onSupprimerAvecRelais);
  const supprimer = () =>
    outils.exigerIdentite(`Supprimer le compte de ${profil.nom}`, () =>
      outils.agir('Suppression…', async () => {
        verifierSur(outils.acteur, 'supprimer-ami', outils.tous, profil.id);
        const bilan = avecRelais ? await controle.onSupprimerAvecRelais!(profil.id) : (await controle.onSupprimer(profil.id), undefined);
        outils.majDonnees(d => sansContactPar(outils.acteur, avecNotePar(outils.acteur, d, outils.tous, profil.id, ''), profil.id));
        outils.journaliser({ type: 'compte', ...cibleJournal, action: `Compte de ${profil.nom} supprimé (coffre et portefeuille effacés de cet appareil)` });
        // Une seule source de vérité : le compte quitte aussi l'Esport (ses teams, ses données Esport).
        const esport = (profil.apps ?? []).includes(ID_ESPORT) ? await retirerDeLEsport(outils, profil, cibleJournal) : '';
        onSupprime();
        if (!bilan) return `Compte « ${profil.nom} » supprimé.${esport}`;
        outils.journaliser({
          type: 'compte',
          ...cibleJournal,
          action: `Copies de ${profil.nom} effacées du relais : ${bilan.objets} objet${bilan.objets > 1 ? 's' : ''}${bilan.acces ? ', accès par identifiant retiré' : ''}${bilan.revoque ? ', jeton révoqué' : ''}${bilan.restes.length ? ` (restes : ${bilan.restes.length})` : ''}`,
        });
        return bilan.restes.length > 0
          ? `Compte « ${profil.nom} » supprimé. Relais : ${bilan.objets} copie(s) effacée(s) ; à reprendre : ${bilan.restes.join(' ; ')}.${esport}`
          : `Compte « ${profil.nom} » supprimé, et ses ${bilan.objets} copie(s) effacée(s) du relais (accès retiré, jeton révoqué).${esport}`;
      }),
    );

  const afficherCode = () =>
    outils.exigerIdentite(`Afficher le code d’accès administrateur de ${profil.nom}`, () =>
      outils.agir('Lecture du code…', async () => {
        verifierSur(outils.acteur, 'acces-sequestre', outils.tous, profil.id);
        const lu = await controle.onCodeAcces?.(profil.id);
        setCode(lu);
        outils.journaliser({ type: 'acces-admin', ...cibleJournal, action: `Code d’accès administrateur de ${profil.nom} affiché` });
        return lu ? undefined : 'Aucun code : le séquestre de ce compte n’existe pas encore.';
      }),
    );
  const envoyerCodeSite = () =>
    outils.exigerIdentite(`Code de connexion au site pour ${profil.nom}`, () =>
      outils.agir('Préparation du code…', async () => {
        verifierSur(outils.acteur, 'regenerer-identifiants', outils.tous, profil.id);
        const valeurs = await controle.onCodeSite!(profil.id);
        setCodeSite(valeurs);
        outils.journaliser({ type: 'identifiants', ...cibleJournal, action: `Code de connexion au site préparé pour ${profil.nom}` });
        return `Code de ${profil.nom} prêt : son compte est publié sur le relais d’ici une minute.`;
      }),
    );
  const envoyerInvitation = () =>
    outils.exigerIdentite(profil.derniereConnexion ? `Réinitialiser l’accès de ${profil.nom}` : `Renvoyer une invitation à ${profil.nom}`, () =>
      outils.agir('Préparation de l’invitation…', async () => {
        verifierSur(outils.acteur, 'regenerer-identifiants', outils.tous, profil.id);
        const jours = Math.min(90, Math.max(1, Number(joursInvitation) || 7));
        const valeurs = await controle.onInvitation!(profil.id, jours, optionsInvitation(outils));
        setInvitation(valeurs);
        if (valeurs.erreur) return valeurs.erreur;
        outils.journaliser({
          type: 'invitation',
          ...cibleJournal,
          action: profil.derniereConnexion
            ? `Accès de ${profil.nom} réinitialisé : nouveau lien d’invitation (${jours} j), l’ancien mot de passe ne fonctionne plus`
            : `Nouvelle invitation envoyée à ${profil.nom} (${jours} j) : l’ancienne ne fonctionne plus`,
        });
        return `Invitation prête : copiez le message et envoyez-le à ${profil.nom}.`;
      }),
    );
  const revoquerConnexion = (revoque: boolean) =>
    outils.exigerIdentite(revoque ? `Révoquer l’accès de ${profil.nom}` : `Rétablir l’accès de ${profil.nom}`, () =>
      outils.agir(revoque ? 'Révocation…' : 'Rétablissement…', async () => {
        verifierSur(outils.acteur, 'etat-ami', outils.tous, profil.id);
        await controle.onRevoquerConnexion!(profil.id, revoque);
        setRevoqueRelais(revoque);
        setInvitation(undefined);
        if (revoque) {
          await outils.modifierProfils(liste => desactiverPar(outils.acteur, liste, profil.id), [{ type: 'compte', ...cibleJournal, action: `Accès de ${profil.nom} révoqué (relais et compte désactivé)` }]);
          return `${profil.nom} ne peut plus se connecter : son jeton est refusé par le relais, son compte est désactivé et ses invitations annulées.`;
        }
        await outils.modifierProfils(liste => reactiverPar(outils.acteur, liste, profil.id), [{ type: 'compte', ...cibleJournal, action: `Accès de ${profil.nom} rétabli` }]);
        return `${profil.nom} peut de nouveau se connecter (envoyez-lui une invitation s’il a oublié son mot de passe).`;
      }),
    );
  const regenererCode = () =>
    outils.exigerIdentite(`Régénérer le code d’accès de ${profil.nom}`, () =>
      outils.agir('Nouveau code…', async () => {
        verifierSur(outils.acteur, 'acces-sequestre', outils.tous, profil.id);
        const nouveau = await controle.onRegenererCode!(profil.id);
        setCode({ code: nouveau, creeLe: new Date(outils.maintenant()).toISOString() });
        outils.journaliser({ type: 'acces-admin', ...cibleJournal, action: `Code d’accès administrateur de ${profil.nom} régénéré (l’ancien ne fonctionne plus)` });
        return 'Nouveau code généré : l’ancien ne fonctionne plus.';
      }),
    );
  const revoquer = () =>
    outils.exigerIdentite(`Révoquer l’accès administrateur au compte de ${profil.nom}`, () =>
      outils.agir('Révocation…', async () => {
        verifierSur(outils.acteur, 'acces-sequestre', outils.tous, profil.id);
        await controle.onRevoquerAcces!(profil.id);
        setCode(undefined);
        outils.journaliser({ type: 'acces-admin', ...cibleJournal, action: `Accès administrateur au compte de ${profil.nom} révoqué` });
        return 'Accès administrateur révoqué : le code et l’enveloppe de séquestre sont effacés.';
      }),
    );
  const retablir = () =>
    outils.agir('Enregistrement…', async () => {
      verifierSur(outils.acteur, 'acces-sequestre', outils.tous, profil.id);
      await controle.onRetablirAcces!(profil.id);
      outils.journaliser({ type: 'acces-admin', ...cibleJournal, action: `Accès administrateur au compte de ${profil.nom} rétabli (séquestre attendu à sa prochaine connexion)` });
      return 'Le séquestre sera recréé à la prochaine connexion de l’ami.';
    });
  const ouvrirCompte = () =>
    outils.exigerIdentite(`Ouvrir le compte de ${profil.nom}`, () =>
      outils.agir(`Ouverture du compte de ${profil.nom}…`, async () => {
        // Inscrit AVANT de quitter la session : le journal vit dans la base de l'administrateur.
        outils.journaliser({ type: 'acces-admin', ...cibleJournal, action: `Ouverture du compte de ${profil.nom} par ${outils.acteur.nom} (${LIBELLES_RANG[outils.role]}, code d’accès)` });
        try {
          verifierSur(outils.acteur, 'ouvrir-compte', outils.tous, profil.id);
          await controle.onOuvrirCompte!(profil.id, codeSaisi);
        } catch (erreur) {
          outils.journaliser({ type: 'acces-admin', ...cibleJournal, action: `Échec de l’ouverture du compte de ${profil.nom} : ${erreur instanceof Error ? erreur.message : 'erreur'}` });
          throw erreur;
        }
      }),
    );

  return (
    <Panneau theme={theme} testID="admin-detail">
      <View style={[commun.ligne, { paddingVertical: 0, flexWrap: 'wrap' }]}>
        <Text style={[styleTitre(theme), { fontSize: 22, flex: 1 }]}>{profil.nom}</Text>
        <Pilule theme={theme} texte={LIBELLES_STATUT[statut]} couleur={couleurStatut(theme, statut)} testID="admin-fiche-statut" />
      </View>
      {!gestionnaire && profil.creePar ? (
        <Text style={[attenue, { fontSize: 13 }]} testID="admin-fiche-cree-par">
          Créé par {outils.tous.find(p => p.id === profil.creePar)?.nom ?? 'un compte inconnu (rang retiré ou compte supprimé)'}.
        </Text>
      ) : null}
      {gestionnaire ? (
        <Text style={[attenue, { fontSize: 13 }]}>Ami que vous avez créé : ses connexions et son contenu ne vous sont pas communiqués.</Text>
      ) : (
        <Text style={[attenue, { fontSize: 13 }]}>
          Créé le {profil.creeLe || 'date inconnue'} · dernière connexion : {dateLisible(profil.derniereConnexion, true)} · {profil.connexions ?? 0} ouverture
          {(profil.connexions ?? 0) > 1 ? 's' : ''}
        </Text>
      )}
      {!autorise(outils.acteur, 'renommer-ami', profil).ok ? null : (
      <View style={[commun.grille, { alignItems: 'flex-end' }]}>
        <Champ theme={theme} libelle="Prénom" valeur={nom} onChanger={setNom} maxLength={30} testID="admin-fiche-nom" style={{ flexBasis: 200, flexGrow: 1 }} />
        <BoutonHub
          theme={theme}
          titre="Renommer"
          desactive={!nom.trim() || nom.trim() === profil.nom}
          onPress={() =>
            outils.modifierProfils(
              liste => renommerProfilPar(outils.acteur, liste, profil.id, nom.trim()),
              [{ type: 'compte', cible: profil.id, nomCible: nom.trim(), action: `« ${profil.nom} » renommé « ${nom.trim()} »` }],
              'Compte renommé : l’ami se connecte désormais avec ce prénom.',
            )
          }
          testID="admin-fiche-renommer"
        />
      </View>
      )}

      {autorise(outils.acteur, 'contact-ami', profil).ok ? (
        <>
          <Intertitre theme={theme}>Contact et invitations</Intertitre>
          <View style={[commun.grille, { alignItems: 'flex-end' }]}>
            <Champ
              theme={theme}
              libelle="Adresse e-mail (facultative, visible de vous seul)"
              valeur={email}
              onChanger={setEmail}
              placeholder="lea@exemple.fr"
              maxLength={254}
              testID="admin-fiche-email"
              style={{ flexBasis: 240, flexGrow: 1 }}
            />
            <BoutonHub
              theme={theme}
              titre="Enregistrer l’adresse"
              desactive={Boolean(erreurEmail(email)) || normaliserEmail(email) === (contact?.email ?? '')}
              onPress={() => {
                outils.majDonnees(d => avecEmailPar(outils.acteur, d, outils.tous, profil.id, email, outils.maintenant()));
                outils.journaliser({ type: 'compte', ...cibleJournal, action: normaliserEmail(email) ? `Adresse e-mail de ${profil.nom} enregistrée` : `Adresse e-mail de ${profil.nom} effacée` });
              }}
              testID="admin-fiche-email-enregistrer"
            />
          </View>
          {erreurEmail(email) ? <Text style={{ color: theme.critique, fontSize: 12 }} testID="admin-fiche-email-erreur">{erreurEmail(email)}</Text> : null}
          <View style={[commun.grille, { alignItems: 'flex-end' }]}>
            <Segments<LangueCompte>
              theme={theme}
              libelle="Langue par défaut du compte"
              valeur={langue}
              options={LANGUES_COMPTE.map(l => [l, NOMS_LANGUES[l]] as const)}
              onChoisir={setLangue}
              testID="admin-fiche-langue"
            />
            <BoutonHub
              theme={theme}
              titre="Enregistrer la langue"
              desactive={langue === langueDuCompte(contact)}
              onPress={() => {
                outils.majDonnees(d => avecLangueComptePar(outils.acteur, d, outils.tous, profil.id, langue));
                outils.journaliser({ type: 'compte', ...cibleJournal, action: `Langue par défaut de ${profil.nom} réglée sur ${NOMS_LANGUES[langue]}` });
                setRetourLangue(undefined);
                // Le serveur Esport l'applique à l'interface (tant que l'utilisateur n'a pas choisi la sienne), au récapitulatif et au bot.
                if (!aAccesEsport(profil)) {
                  setRetourLangue(`Langue enregistrée : ${NOMS_LANGUES[langue]} (e-mails).`);
                  return;
                }
                void pousserLangueEsport(profil.id, langue).then(
                  b => setRetourLangue(b === 'refuse' ? 'Langue enregistrée pour les e-mails ; le serveur Esport n’a pas accepté la modification (réservée au Fondateur).' : `Langue enregistrée : ${NOMS_LANGUES[langue]} (e-mails, interface Esport, bot Discord).`),
                  () => setRetourLangue('Langue enregistrée pour les e-mails ; le serveur Esport est injoignable : réglez-la aussi dans Esport › Membres.'),
                );
              }}
              testID="admin-fiche-langue-enregistrer"
            />
          </View>
          <Text style={[attenue, { fontSize: 12 }]} testID="admin-fiche-langue-aide">
            Langue des e-mails (invitation, support, Messagerie), de l’interface Esport tant que {profil.nom} n’a pas choisi la sienne, et du bot Discord. Son propre choix dans Esport › Mon profil reste prioritaire.
          </Text>
          {retourLangue ? (
            <Text style={{ color: theme.ok, fontSize: 12 }} testID="admin-fiche-langue-retour">
              {retourLangue}
            </Text>
          ) : null}
          <View style={{ gap: 2 }} testID="admin-historique-invitations">
            {contact && contact.envois.length > 0 ? (
              [...contact.envois]
                .reverse()
                .slice(0, 8)
                .map((e, index) => (
                  <Text key={`${e.date}-${index}`} style={[attenue, { fontSize: 12 }]}>
                    {dateLisible(e.date, true)} · {LIBELLES_CANAL[e.canal]}
                    {e.relance ? ' (relance)' : ''}
                  </Text>
                ))
            ) : (
              <Text style={[attenue, { fontSize: 12 }]}>Aucune invitation transmise depuis l’Administration.</Text>
            )}
          </View>
          {!gestionnaire && controle.onInvitation && !profil.derniereConnexion && autorise(outils.acteur, 'regenerer-identifiants', profil).ok ? (
            <View style={commun.actions}>
              <BoutonHub
                theme={theme}
                variante="plein"
                couleur={theme.teintes.admin}
                titre={invitation?.lien ? 'Invitation prête ci-dessous' : contact?.envois.length ? 'Relancer (nouveau lien)' : 'Préparer l’invitation'}
                desactive={Boolean(outils.enCours) || Boolean(revoqueRelais) || Boolean(invitation?.lien)}
                onPress={envoyerInvitation}
                testID="admin-relancer"
              />
            </View>
          ) : null}
        </>
      ) : null}

      {gestionnaire ? null : (
        <>
          <Intertitre theme={theme}>Rang</Intertitre>
          <View style={[commun.ligne, { paddingVertical: 0, flexWrap: 'wrap' }]}>
            <Pilule theme={theme} texte={LIBELLES_RANG[rangDe(profil)]} couleur={couleurRang(theme, rangDe(profil))} testID="admin-fiche-rang" />
            {perimetreEsportSeul(profil) ? <Pilule theme={theme} texte="Esport" couleur={theme.teintes.anime} testID="admin-fiche-esport" /> : null}
            {profil.titulaire ? (
              <Text style={[attenue, { fontSize: 12 }]} testID="admin-fiche-titulaire">
                {profil.titulaire === 'actif' ? 'Clé de séquestre confirmée : les comptes inférieurs lui sont scellés.' : 'Clé de séquestre en attente : créée ou confirmée à sa prochaine connexion (ou à celle d’un Fondateur qui peut l’ouvrir).'}
              </Text>
            ) : null}
            {rangChoisi === undefined && attribuables.length > 0 && controle.onChangerRang ? (
              <BoutonHub theme={theme} titre="Changer le rang" onPress={() => setRangChoisi(attribuables[0])} testID="admin-rang-changer" />
            ) : null}
          </View>
          {attribuables.length > 0 && !controle.onChangerRang ? (
            <Text style={[attenue, { fontSize: 12 }]}>Changer le rang se fait depuis l’appareil qui a l’annuaire complet (le PC).</Text>
          ) : null}
          {rangChoisi !== undefined ? (
            <View style={[commun.avis, { borderLeftColor: theme.alerte, backgroundColor: teinteTransparente(theme.alerte, 0.14), gap: 8 }]} testID="admin-rang-confirmation">
              <Segments<Rang>
                theme={theme}
                libelle={`Nouveau rang de ${profil.nom}`}
                valeur={rangChoisi}
                options={attribuables.map(r => [r, LIBELLES_RANG[r]] as const)}
                onChoisir={r => {
                  setRangChoisi(r);
                  setSaisieRang('');
                }}
                testID="admin-rang-choix"
              />
              <Text style={[texte, { fontWeight: '700' }]}>
                {NIVEAU_RANG[rangChoisi] > NIVEAU_RANG[rangDe(profil)] ? 'Promouvoir' : 'Rétrograder'} {profil.nom} : {LIBELLES_RANG[rangDe(profil)]} → {LIBELLES_RANG[rangChoisi]} ?
              </Text>
              <Text style={texte}>Il·elle pourra :</Text>
              {CE_QUE_PERMET[rangChoisi].map(ligne => (
                <Text key={ligne} style={[texte, { fontSize: 13 }]}>• {ligne}</Text>
              ))}
              {CE_QUE_NE_PERMET_PAS[rangChoisi].length > 0 ? <Text style={texte}>Il·elle ne pourra jamais :</Text> : null}
              {CE_QUE_NE_PERMET_PAS[rangChoisi].map(ligne => (
                <Text key={ligne} style={[texte, { fontSize: 13 }]}>• {ligne}</Text>
              ))}
              <Text style={[attenue, { fontSize: 12 }]} testID="admin-rang-sequestre">
                {rangChoisi === 'administrateur'
                  ? `Séquestre : une paire de clés est créée pour ${profil.nom} (scellée par SA clé), puis la clé de chaque Gestionnaire et Ami est re-scellée pour lui·elle, avec ses propres codes d’accès. Son compte reste scellé pour les Fondateurs seulement.`
                  : rangChoisi === 'fondateur'
                    ? `Séquestre : ${profil.nom} reçoit les clés des Administrateurs, Gestionnaires et Amis, et le registre des Fondateurs. Son propre compte ne sera plus scellé pour personne — vous ne pourrez plus l’ouvrir, ni le rétrograder.`
                    : rangDe(profil) === 'administrateur'
                      ? `Séquestre : tous les dépôts de ${profil.nom} et sa paire de clés sont supprimés, ainsi que sa délégation sur le relais. Ce qu’il·elle a déjà pu lire ne peut pas être « désappris » : si besoin, régénérez les identifiants des comptes concernés.`
                      : 'Aucune clé n’est touchée : ce rang n’ouvre aucun compte.'}
              </Text>
              {rangChoisi === 'fondateur' ? (
                <Champ theme={theme} libelle={`Confirmation forte : saisissez « ${profil.nom} »`} valeur={saisieRang} onChanger={setSaisieRang} testID="admin-rang-saisie" />
              ) : null}
              <View style={commun.actions}>
                <BoutonHub
                  theme={theme}
                  variante="plein"
                  couleur={theme.teintes.admin}
                  titre="Confirmer (mot de passe + code)"
                  testID="admin-rang-confirmer"
                  desactive={Boolean(outils.enCours) || (rangChoisi === 'fondateur' && saisieRang.trim() !== profil.nom)}
                  onPress={() => {
                    const rang = rangChoisi;
                    const promotion = NIVEAU_RANG[rang] > NIVEAU_RANG[rangDe(profil)];
                    setRangChoisi(undefined);
                    setSaisieRang('');
                    outils.exigerIdentite(
                      `${promotion ? 'Promouvoir' : 'Rétrograder'} ${profil.nom} ${LIBELLES_RANG[rang]}`,
                      () =>
                        outils.agir('Changement de rang…', async () => {
                          const { enAttente } = await controle.onChangerRang!(profil.id, rang);
                          outils.journaliser({
                            type: 'role',
                            ...cibleJournal,
                            action: `${profil.nom} : ${LIBELLES_RANG[rangDe(profil)]} → ${LIBELLES_RANG[rang]}${enAttente ? ' (clé en attente de sa prochaine connexion)' : ''}`,
                          });
                          return enAttente
                            ? `${profil.nom} est ${LIBELLES_RANG[rang]}. Sa clé de séquestre sera créée à sa prochaine connexion ; les comptes inférieurs lui seront alors re-scellés.`
                            : `${profil.nom} est maintenant ${LIBELLES_RANG[rang]}.`;
                        }),
                      true,
                    );
                  }}
                />
                <BoutonHub theme={theme} titre="Annuler" onPress={() => setRangChoisi(undefined)} testID="admin-rang-annuler" />
              </View>
            </View>
          ) : null}
        </>
      )}

      <Intertitre theme={theme}>Accès aux apps</Intertitre>
      <Segments
        theme={theme}
        libelle="Modèle de permissions"
        valeur={modele}
        options={MODELES.map(m => [m.id, m.nom] as const)}
        onChoisir={id => {
          if (id !== 'personnalise') {
            // L'accès donné par une app elle-même (Tâches) n'est pas touché par un modèle.
            const gardes = Object.fromEntries(registre.filter(a => a.attribueeParApp).map(a => [a.id, niveaux[a.id] ?? 'aucun']));
            changerNiveaux({ ...gardes, ...niveauxDuModele(apps, id) }, `Modèle « ${MODELES.find(m => m.id === id)?.nom} » appliqué`);
          }
        }}
        testID="admin-fiche-modele"
      />
      {apps.map(a => {
        const politique = etatApp(outils.politique, a.id);
        return (
          <View key={a.id} style={[commun.ligne, { flexWrap: 'wrap' }]}>
            <View style={[commun.carre, { backgroundColor: theme.teintes[a.teinte], borderRadius: Math.min(theme.rayonMoyen, 8) }]}>
              <Glyphe valeur={a.icone} style={{ color: theme.surAccent, fontWeight: '700' }} />
            </View>
            <View style={{ flex: 1, minWidth: 140 }}>
              <Text style={[texte, { fontWeight: '600' }]}>{a.nom}</Text>
              {!politique.active ? <Text style={[attenue, { fontSize: 12 }]}>Désactivée pour tous (Applications)</Text> : politique.maintenance !== undefined ? <Text style={[attenue, { fontSize: 12 }]}>En maintenance</Text> : null}
            </View>
            <Segments
              theme={theme}
              libelle={`Accès de ${profil.nom} à ${a.nom}`}
              valeur={niveaux[a.id] ?? 'aucun'}
              options={niveauxDe(a).map(n => [n, LIBELLES_NIVEAU[n]] as const)}
              onChoisir={n => changerNiveaux({ ...niveaux, [a.id]: n }, `${a.nom} : ${LIBELLES_NIVEAU[n].toLowerCase()}`)}
              testID={`admin-niveau-${profil.id}-${a.id}`}
            />
          </View>
        );
      })}

      <Intertitre theme={theme}>Invitation et durée d’accès</Intertitre>
      {profil.invitationExpireLe && !profil.derniereConnexion ? (
        <Text style={[texte, { fontSize: 13 }]}>Invitation valable jusqu’au {dateLisible(profil.invitationExpireLe, true)} ({relatif(profil.invitationExpireLe, maintenant)}).</Text>
      ) : (
        <Text style={[attenue, { fontSize: 13 }]}>{profil.derniereConnexion ? 'Invitation acceptée.' : 'Aucune invitation en cours.'}</Text>
      )}
      <View style={commun.actions}>
        {!profil.derniereConnexion ? (
          <BoutonHub
            theme={theme}
            titre={`Prolonger de ${outils.donnees.reglages.invitationJours} j`}
            onPress={() =>
              outils.modifierProfils(liste => prolongerInvitationPar(outils.acteur, liste, profil.id, outils.donnees.reglages.invitationJours, outils.maintenant()), [
                { type: 'invitation', ...cibleJournal, action: `Invitation de ${profil.nom} prolongée de ${outils.donnees.reglages.invitationJours} jours` },
              ])
            }
            testID="admin-invitation-prolonger"
          />
        ) : null}
        {profil.invitationExpireLe && !profil.derniereConnexion ? (
          <BoutonHub
            theme={theme}
            titre="Annuler l’invitation"
            onPress={() => outils.modifierProfils(liste => annulerInvitationPar(outils.acteur, liste, profil.id, outils.maintenant()), [{ type: 'invitation', ...cibleJournal, action: `Invitation de ${profil.nom} annulée` }])}
            testID="admin-invitation-annuler"
          />
        ) : null}
      </View>
      <View style={[commun.grille, { alignItems: 'flex-end' }]}>
        <Champ theme={theme} libelle="Fin d’accès (AAAA-MM-JJ, vide : aucune)" valeur={expiration} onChanger={setExpiration} maxLength={10} placeholder="2026-12-31" testID="admin-expiration" style={{ flexBasis: 220, flexGrow: 1 }} />
        <BoutonHub
          theme={theme}
          titre="Enregistrer la fin d’accès"
          desactive={expiration !== '' && (!/^\d{4}-\d{2}-\d{2}$/.test(expiration) || Number.isNaN(Date.parse(expiration)))}
          onPress={() =>
            outils.modifierProfils(liste => definirExpirationPar(outils.acteur, liste, profil.id, expiration ? `${expiration}T23:59:59.000Z` : undefined), [
              { type: 'compte', ...cibleJournal, action: expiration ? `Fin d’accès de ${profil.nom} fixée au ${expiration}` : `Fin d’accès de ${profil.nom} retirée` },
            ])
          }
          testID="admin-expiration-enregistrer"
        />
      </View>

      <Intertitre theme={theme}>Activation</Intertitre>
      <View style={[commun.grille, { alignItems: 'flex-end' }]}>
        {statut === 'desactive' || statut === 'suspendu' ? (
          <BoutonHub
            theme={theme}
            variante="plein"
            couleur={theme.ok}
            titre="Réactiver"
            onPress={() => outils.modifierProfils(liste => reactiverPar(outils.acteur, liste, profil.id), [{ type: 'compte', ...cibleJournal, action: `Compte de ${profil.nom} réactivé` }], `${profil.nom} peut de nouveau ouvrir son compte.`)}
            testID="admin-activer"
          />
        ) : (
          <>
            <Champ theme={theme} libelle="Suspendre pendant (jours)" valeur={suspension} onChanger={v => setSuspension(v.replace(/[^\d]/g, ''))} clavier="number-pad" maxLength={3} testID="admin-suspension-jours" style={{ flexBasis: 160 }} />
            <BoutonHub
              theme={theme}
              titre="Suspendre"
              desactive={!Number(suspension)}
              onPress={() =>
                outils.modifierProfils(liste => suspendrePar(outils.acteur, liste, profil.id, dansJours(outils.maintenant(), Number(suspension)), outils.maintenant()), [
                  { type: 'compte', ...cibleJournal, action: `Compte de ${profil.nom} suspendu ${suspension} jours` },
                ])
              }
              testID="admin-suspendre"
            />
            <BoutonHub
              theme={theme}
              titre="Désactiver"
              onPress={() => outils.modifierProfils(liste => desactiverPar(outils.acteur, liste, profil.id), [{ type: 'compte', ...cibleJournal, action: `Compte de ${profil.nom} désactivé` }], `${profil.nom} ne peut plus ouvrir son compte.`)}
              testID="admin-desactiver"
            />
          </>
        )}
      </View>

      {gestionnaire ? null : (
        <>
          <Intertitre theme={theme}>Accès et connexion</Intertitre>
          <Text style={[texte, { fontSize: 13 }]} testID="admin-acces-etat">
            {etatAcces(profil, maintenant)}
          </Text>
          {revoqueRelais ? <Avis theme={theme} genre="critique" texte={`Accès révoqué sur le relais : ${profil.nom} ne peut plus se connecter.`} testID="admin-acces-revoque" /> : null}
          {profil.appareils && profil.appareils.length > 0 ? (
            <View style={{ gap: 4 }} testID="admin-fiche-appareils">
              {profil.appareils.map((a, index) => (
                <Text key={`${a.nom}-${index}`} style={[texte, { fontSize: 13 }]}>
                  <Icone nom="ordinateur" /> {a.nom} · vu {relatif(a.vu, maintenant)}
                </Text>
              ))}
              <Text style={[attenue, { fontSize: 12 }]}>
                Pour déconnecter ses appareils : « Réinitialiser l’accès » ci-dessous (son ancien mot de passe ne marche plus sur aucun appareil), ou
                « Révoquer l’accès » (le relais refuse tous ses appareils).
              </Text>
            </View>
          ) : null}
          {invitation ? (
            <PanneauInvitation
              theme={theme}
              nom={profil.nom}
              invitation={invitation}
              email={contact?.email}
              modele={donnees.modeleInvitation}
              langueInitiale={langueDuCompte(contact)}
              fondateur={outils.acteur.nom}
              onEnvoye={canal => noterEnvoi(outils, profil.id, profil.nom, canal)}
            />
          ) : null}
          {controle.onInvitation ? (
            <>
              <Text style={[attenue, { fontSize: 12 }]}>
                {profil.derniereConnexion
                  ? `Mot de passe oublié, appareil perdu : un nouveau lien remplace l’ancien mot de passe de ${profil.nom} (ses données sont gardées). Il choisira un nouveau mot de passe.`
                  : `Pas encore connecté : un nouveau lien remplace l’ancien (qui cesse de marcher).`}
              </Text>
              <View style={[commun.grille, { alignItems: 'flex-end' }]}>
                <Champ theme={theme} libelle="Lien valable (jours)" valeur={joursInvitation} onChanger={v => setJoursInvitation(v.replace(/[^\d]/g, ''))} clavier="number-pad" maxLength={2} testID="admin-invitation-jours" style={{ flexBasis: 140 }} />
                <BoutonHub
                  theme={theme}
                  variante="plein"
                  couleur={theme.teintes.admin}
                  titre={profil.derniereConnexion ? 'Réinitialiser l’accès (nouveau lien)' : 'Renvoyer une invitation'}
                  desactive={Boolean(outils.enCours) || Boolean(revoqueRelais)}
                  onPress={envoyerInvitation}
                  testID="admin-invitation-envoyer"
                />
              </View>
            </>
          ) : (
            <Text style={[attenue, { fontSize: 12 }]} testID="admin-invitation-indisponible">
              Les invitations partent de l’appareil du Fondateur principal (relié au relais avec le code maître).
            </Text>
          )}
          {controle.onRevoquerConnexion ? (
            <View style={commun.actions}>
              {revoqueRelais ? (
                <BoutonHub theme={theme} titre="Rétablir l’accès" onPress={() => revoquerConnexion(false)} testID="admin-acces-retablir" />
              ) : (
                <BoutonHub theme={theme} variante="danger" titre="Révoquer l’accès" onPress={() => revoquerConnexion(true)} testID="admin-acces-revoquer" />
              )}
            </View>
          ) : null}
        </>
      )}

      {gestionnaire || !controle.onCodeSite ? null : (
        <>
          <Intertitre theme={theme}>Code de liaison (avancé)</Intertitre>
          <Text style={[attenue, { fontSize: 12 }]}>
            Ancienne méthode : un code PROPRE à {profil.nom} (il n’ouvre que son compte). {profil.nom} le saisit une fois sur son navigateur, puis se connecte avec son prénom, son mot de passe et son code. Préférez l’invitation ci-dessus.
          </Text>
          {codeSite ? (
            <View style={[commun.avis, { borderLeftColor: theme.teintes.admin, backgroundColor: teinteTransparente(theme.teintes.admin, 0.12), gap: 4 }]}>
              <Text style={[texte, { fontSize: 12 }]} selectable testID="admin-code-site">
                {codeSite.code}
              </Text>
              {codeSite.lien ? (
                <Text style={[attenue, { fontSize: 12 }]} selectable testID="admin-lien-site">
                  Lien direct : {codeSite.lien}
                </Text>
              ) : null}
              <Text style={[attenue, { fontSize: 12 }]}>À transmettre à {profil.nom} seul·e, par un canal privé.</Text>
            </View>
          ) : null}
          <View style={commun.actions}>
            <BoutonHub theme={theme} titre="Code de liaison du site" onPress={envoyerCodeSite} testID="admin-code-site-generer" />
          </View>
        </>
      )}

      {gestionnaire ? null : (
        <>
      <Intertitre theme={theme}>Accès par séquestre (vos codes)</Intertitre>
      <Text style={[texte, { fontSize: 13 }]} testID="admin-sequestre-etat">
        {LIBELLES_SEQUESTRE[profil.sequestre ?? 'absent']}
      </Text>
      <Text style={[attenue, { fontSize: 12 }]}>
        {profil.nom} est averti·e dans ses Paramètres : « {rangDe(profil) === 'administrateur' ? 'Les fondateurs peuvent accéder à ton compte' : 'Les administrateurs et fondateurs peuvent accéder à ton compte'} ». Chaque accès est inscrit au journal, avec votre nom.
      </Text>
      {code ? (
        <View style={[commun.avis, { borderLeftColor: theme.teintes.admin, backgroundColor: teinteTransparente(theme.teintes.admin, 0.12), gap: 4 }]}>
          <Text style={[texte, police(theme.policeChiffres), { fontSize: 18, letterSpacing: 1.5 }]} selectable testID="admin-code-acces">
            {code.code}
          </Text>
          <Text style={[attenue, { fontSize: 12 }]}>Code créé le {dateLisible(code.creeLe, true)}. Il reste affichable ici (après vérification de votre identité).</Text>
        </View>
      ) : null}
      <View style={commun.actions}>
        {profil.sequestre === 'actif' ? (
          <>
            <BoutonHub theme={theme} titre="Afficher le code d’accès" onPress={afficherCode} testID="admin-code-afficher" />
            <BoutonHub theme={theme} titre="Régénérer le code" onPress={regenererCode} testID="admin-code-regenerer" />
            <BoutonHub theme={theme} variante="danger" titre="Révoquer" onPress={revoquer} testID="admin-code-revoquer" />
          </>
        ) : profil.sequestre === 'revoque' ? (
          <BoutonHub theme={theme} titre="Rétablir l’accès" onPress={retablir} testID="admin-code-retablir" />
        ) : null}
      </View>
      {profil.sequestre === 'actif' && controle.onOuvrirCompte ? (
        ouverture ? (
          <View style={{ gap: 8 }}>
            <Champ theme={theme} libelle="Code d’accès du compte" valeur={codeSaisi} onChanger={setCodeSaisi} placeholder="XXXX-XXXX-XXXX-XXXX" maxLength={24} testID="admin-ouvrir-code" />
            <View style={commun.actions}>
              {code ? <BoutonHub theme={theme} titre="Utiliser le code affiché" onPress={() => setCodeSaisi(code.code)} testID="admin-ouvrir-code-affiche" /> : null}
              <BoutonHub theme={theme} variante="plein" couleur={theme.teintes.admin} titre={`Ouvrir le compte de ${profil.nom}`} desactive={codeSaisi.replace(/[^A-Za-z0-9]/g, '').length < 16} onPress={ouvrirCompte} testID="admin-ouvrir-confirmer" />
              <BoutonHub theme={theme} titre="Annuler" onPress={() => setOuverture(false)} />
            </View>
            <Text style={[attenue, { fontSize: 12 }]}>Votre session se ferme ; un bandeau « Session de {outils.acteur.nom} ({LIBELLES_RANG[outils.role]}) » reste affiché sur le compte de {profil.nom}.</Text>
          </View>
        ) : (
          <View style={commun.actions}>
            <BoutonHub theme={theme} titre={`🗝︎ Ouvrir le compte de ${profil.nom}…`} onPress={() => setOuverture(true)} testID="admin-ouvrir-compte" />
          </View>
        )
      ) : null}

        </>
      )}

      {gestionnaire ? null : (
        <>
      <Intertitre theme={theme}>Notes privées</Intertitre>
      <Champ theme={theme} libelle="Visibles de vous seul (chiffrées avec vos données)" valeur={note} onChanger={setNote} multiligne maxLength={LONGUEUR_MAX_NOTE} testID="admin-note" />
      <View style={commun.actions}>
        <BoutonHub
          theme={theme}
          titre="Enregistrer la note"
          desactive={note === (donnees.notes[profil.id] ?? '')}
          onPress={() => {
            outils.majDonnees(d => avecNotePar(outils.acteur, d, outils.tous, profil.id, note));
            outils.journaliser({ type: 'compte', ...cibleJournal, action: `Note privée sur ${profil.nom} modifiée` });
          }}
          testID="admin-note-enregistrer"
        />
      </View>

        </>
      )}

      <Intertitre theme={theme}>Activité</Intertitre>
      <View style={{ gap: 2 }} testID="admin-fiche-activite">
        {donnees.journal.filter(e => e.cible === profil.id).length === 0 ? <Text style={[attenue, { fontSize: 12 }]}>Rien au journal pour ce compte.</Text> : null}
        {donnees.journal
          .filter(e => e.cible === profil.id)
          .slice(-8)
          .reverse()
          .map((e, index) => (
            <Text key={`${e.date}-${index}`} style={[attenue, { fontSize: 12 }]}>
              {dateLisible(e.date, true)} · {LIBELLES_TYPE[e.type]} · {e.acteur ? `[${e.acteur}] ` : ''}
              {e.action}
            </Text>
          ))}
        <Pressable accessibilityRole="link" onPress={() => outils.allerA('journal')} testID="admin-fiche-journal">
          <Text style={{ color: theme.teintes.admin, fontWeight: '600', fontSize: 13 }}>Tout le journal →</Text>
        </Pressable>
      </View>

      <Intertitre theme={theme}>{gestionnaire ? 'Identifiants' : 'Zone Danger'}</Intertitre>
      {confirmation ? (
        <View style={[commun.avis, { borderLeftColor: theme.critique, backgroundColor: teinteTransparente(theme.critique, 0.12), gap: 8 }]} testID="admin-confirmation">
          <Text style={texte}>
            {confirmation === 'regenerer'
              ? `De nouveaux identifiants remplacent les anciens. Le portefeuille actuel de ${profil.nom} est scellé par l’ancienne clé : il sera effacé. (S’il a seulement oublié son mot de passe, il peut utiliser « Mot de passe oublié ? » avec un code de récupération.)`
              : `Le compte de ${profil.nom}, son coffre, son portefeuille, son séquestre, son adresse e-mail et vos notes seront effacés de cet appareil${avecRelais ? ', et ses copies effacées du relais (son accès par identifiant retiré, son jeton révoqué)' : ''}. C’est définitif.`}
          </Text>
          {confirmation === 'supprimer' && controle.onSupprimerAvecRelais ? (
            <View style={commun.ligne}>
              <Case theme={theme} coche={nettoyerRelais} libelle="Effacer aussi ses copies sur le relais" onChanger={setNettoyerRelais} testID="admin-supprimer-relais" />
              <Text style={[texte, { flex: 1, fontSize: 13 }]}>Effacer aussi ses copies sur le relais (recommandé).</Text>
            </View>
          ) : null}
          <Champ theme={theme} libelle={`Pour confirmer, saisissez « ${profil.nom} »`} valeur={saisieConfirmation} onChanger={setSaisieConfirmation} testID="admin-confirmation-nom" />
          <View style={commun.actions}>
            <BoutonHub
              theme={theme}
              variante="danger"
              titre={confirmation === 'regenerer' ? 'Régénérer' : 'Supprimer définitivement'}
              testID="admin-confirmer"
              desactive={saisieConfirmation.trim() !== profil.nom || Boolean(outils.enCours)}
              onPress={() => {
                const genre = confirmation;
                setConfirmation(undefined);
                setSaisieConfirmation('');
                if (genre === 'regenerer') {
                  regenerer();
                } else {
                  supprimer();
                }
              }}
            />
            {confirmation === 'supprimer' && outils.services?.enregistrerFichier ? (
              <BoutonHub
                theme={theme}
                titre="Télécharger un récapitulatif"
                onPress={() =>
                  outils.agir('Export…', async () => {
                    const fait = await outils.services!.enregistrerFichier!(`recapitulatif-${profil.id}.txt`, recapitulatif(profil, registre, outils.maintenant()), 'text/plain;charset=utf-8');
                    if (fait) outils.journaliser({ type: 'export', ...cibleJournal, action: `Récapitulatif du compte de ${profil.nom} exporté` });
                  })
                }
                testID="admin-recapitulatif"
              />
            ) : null}
            <BoutonHub
              theme={theme}
              titre="Annuler"
              onPress={() => {
                setConfirmation(undefined);
                setSaisieConfirmation('');
              }}
            />
          </View>
        </View>
      ) : (
        <View style={commun.actions}>
          {controle.onRegenerer ? <BoutonHub theme={theme} titre="Régénérer les identifiants" onPress={() => setConfirmation('regenerer')} testID="admin-regenerer" /> : null}
          {gestionnaire || controle.restreint || !autorise(outils.acteur, 'supprimer-ami', profil).ok ? null : (
            <BoutonHub theme={theme} variante="danger" titre="Supprimer le compte" onPress={() => setConfirmation('supprimer')} testID="admin-supprimer" />
          )}
        </View>
      )}
    </Panneau>
  );
}

// --- Création ----------------------------------------------------------------------

function FormulaireCreation({
  outils,
  apps,
  onAnnuler,
  onCree,
}: {
  outils: OutilsAdmin;
  apps: AppHub[];
  onAnnuler(): void;
  onCree(nom: string, valeurs: IdentifiantsAmi): void;
}) {
  const { theme, controle, registre } = outils;
  const [nom, setNom] = useState('');
  const [niveaux, setNiveaux] = useState<Niveaux>(() => Object.fromEntries(apps.map(a => [a.id, etatApp(outils.politique, a.id).defaut])));
  const [invitation, setInvitation] = useState(String(outils.donnees.reglages.invitationJours));
  const [expiration, setExpiration] = useState('');
  const [informe, setInforme] = useState(false);
  const [email, setEmail] = useState('');
  const [langue, setLangue] = useState<LangueCompte>('fr');
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const problemeEmail = erreurEmail(email);
  const expirationValide = expiration === '' || (/^\d{4}-\d{2}-\d{2}$/.test(expiration) && !Number.isNaN(Date.parse(expiration)));
  const creer = () =>
    outils.agir('Création du compte…', async () => {
      const { apps: ouvertes, niveaux: restreints } = versAutorisations(registre, niveaux);
      const jours = Number(invitation);
      const valeurs = await controle.onCreerCompte!(
        nom,
        ouvertes,
        {
          niveaux: restreints,
          invitationExpireLe: jours > 0 ? dansJours(outils.maintenant(), jours) : undefined,
          expireLe: expiration ? `${expiration}T23:59:59.000Z` : undefined,
        },
        optionsInvitation(outils),
      );
      const adresse = normaliserEmail(email);
      // Interface Esport, récapitulatif et bot : le serveur Esport garde la langue jusqu'à la première ouverture de l'Esport du compte.
      if (valeurs.id && ouvertes.includes(ID_ESPORT)) void pousserLangueEsport(valeurs.id, langue).catch(() => undefined);
      if (valeurs.id) {
        // Adresse (chiffrée avec les données de l'Administration ; jamais dans la liste des profils ni sur le relais) et langue
        // par défaut du compte (e-mails, interface Esport, bot) : une seule écriture.
        const id = valeurs.id;
        outils.majDonnees(d => avecLangueCreationPar(outils.acteur, adresse ? avecEmailCreationPar(outils.acteur, d, id, adresse, outils.maintenant()) : d, id, langue));
      }
      outils.journaliser({
        type: 'compte',
        ...(valeurs.id ? { cible: valeurs.id } : {}),
        nomCible: nom.trim(),
        action: `Compte de ${nom.trim()} créé (apps : ${ouvertes.join(', ') || 'aucune'} ; séquestre créé pour les rangs supérieurs ; ami averti${adresse ? ' ; adresse e-mail enregistrée' : ''} ; langue : ${NOMS_LANGUES[langue]})`,
      });
      onCree(nom.trim(), valeurs);
      return `Compte de ${nom.trim()} créé.`;
    });
  return (
    <Panneau theme={theme} testID="admin-creation">
      <Text style={[styleTitre(theme), { fontSize: 20 }]}>Nouvel utilisateur</Text>
      <Champ theme={theme} libelle="Prénom de l’ami (il s’en servira pour se connecter)" valeur={nom} onChanger={setNom} placeholder="ex. Lucas" maxLength={30} testID="admin-nom" />
      <Champ
        theme={theme}
        libelle="Adresse e-mail (facultative, conseillée : pour lui envoyer l’invitation)"
        valeur={email}
        onChanger={setEmail}
        placeholder="lucas@exemple.fr"
        maxLength={254}
        testID="admin-nouveau-email"
      />
      {problemeEmail ? (
        <Text style={{ color: theme.critique, fontSize: 12 }} testID="admin-nouveau-email-erreur">
          {problemeEmail}
        </Text>
      ) : (
        <Text style={{ color: theme.attenue, fontSize: 12 }}>Chiffrée avec vos données d’administration : jamais visible des autres comptes, jamais en clair sur le relais.</Text>
      )}
      <Segments<LangueCompte>
        theme={theme}
        libelle="Langue du compte"
        valeur={langue}
        options={LANGUES_COMPTE.map(l => [l, NOMS_LANGUES[l]] as const)}
        onChoisir={setLangue}
        testID="admin-nouveau-langue"
      />
      <Text style={{ color: theme.attenue, fontSize: 12 }}>Langue de ses e-mails (invitation comprise), de l’interface Esport tant qu’il n’a pas choisi la sienne, et du bot Discord. Modifiable ensuite dans sa fiche.</Text>
      <Intertitre theme={theme}>Permissions</Intertitre>
      <Segments
        theme={theme}
        libelle="Modèle"
        valeur={modeleCorrespondant(apps, niveaux)}
        options={MODELES.map(m => [m.id, m.nom] as const)}
        onChoisir={id => id !== 'personnalise' && setNiveaux(niveauxDuModele(apps, id))}
        testID="admin-nouveau-modele"
      />
      {apps.map(a => (
        <View key={a.id} style={[commun.ligne, { flexWrap: 'wrap' }]}>
          <Text style={[texte, { flex: 1, minWidth: 120 }]}>
            <Glyphe valeur={a.icone} /> {a.nom}
          </Text>
          <Segments
            theme={theme}
            libelle={`Accès à ${a.nom}`}
            valeur={niveaux[a.id] ?? 'aucun'}
            options={niveauxDe(a).map(n => [n, LIBELLES_NIVEAU[n]] as const)}
            onChoisir={n => setNiveaux(v => ({ ...v, [a.id]: n }))}
            testID={`admin-nouveau-app-${a.id}`}
          />
        </View>
      ))}
      <View style={[commun.grille, { alignItems: 'flex-end' }]}>
        <Champ theme={theme} libelle="Invitation valable (jours, 0 : sans limite)" valeur={invitation} onChanger={v => setInvitation(v.replace(/[^\d]/g, ''))} clavier="number-pad" maxLength={3} testID="admin-nouveau-invitation" style={{ flexBasis: 200, flexGrow: 1 }} />
        <Champ theme={theme} libelle="Fin d’accès (AAAA-MM-JJ, facultatif)" valeur={expiration} onChanger={setExpiration} maxLength={10} testID="admin-nouveau-expiration" style={{ flexBasis: 200, flexGrow: 1 }} />
      </View>
      <View style={[commun.avis, { borderLeftColor: theme.alerte, backgroundColor: teinteTransparente(theme.alerte, 0.14), gap: 6 }]} testID="admin-avertissement-transparence">
        <Text style={[texte, { fontWeight: '700' }]}>⚠︎ Les administrateurs et fondateurs peuvent accéder à ce compte.</Text>
        <Text style={[texte, { fontSize: 13 }]}>
          Une copie de la clé du compte est mise sous séquestre pour chaque Administrateur et Fondateur : avec SON code d’accès, chacun pourra
          l’ouvrir sans son mot de passe. L’ami en est averti dans ses Paramètres, et chaque accès est inscrit au journal. Dites-le lui en lui
          remettant ses identifiants.
        </Text>
        <View style={commun.ligne}>
          <Case theme={theme} coche={informe} libelle="J’informerai l’ami que les administrateurs et fondateurs peuvent accéder à son compte" onChanger={setInforme} testID="admin-nouveau-informe" />
          <Text style={[texte, { flex: 1, fontSize: 13 }]}>J’informerai l’ami que les administrateurs et fondateurs peuvent accéder à son compte.</Text>
        </View>
      </View>
      <Text style={{ color: theme.attenue, fontSize: 12 }}>
        Un mot de passe, une clé d’authentification (TOTP) et des codes de récupération seront générés et affichés une seule fois.
      </Text>
      <View style={[commun.actions, { justifyContent: 'flex-end' }]}>
        <BoutonHub theme={theme} titre="Annuler" onPress={onAnnuler} testID="admin-creation-annuler" />
        <BoutonHub
          theme={theme}
          variante="plein"
          couleur={theme.teintes.admin}
          titre="Créer et afficher les identifiants"
          testID="admin-creer"
          desactive={Boolean(outils.enCours) || !nom.trim() || !informe || !expirationValide || Boolean(problemeEmail) || !controle.onCreerCompte}
          onPress={creer}
        />
      </View>
    </Panneau>
  );
}

/** Identifiants affichés une seule fois, avec l'avertissement de transparence à transmettre. */
function PanneauIdentifiants({ outils, nom, valeurs, id, onTermine }: { outils: OutilsAdmin; nom: string; valeurs: IdentifiantsAmi; id?: string; onTermine(): void }) {
  const { theme } = outils;
  const [transmis, setTransmis] = useState(false);
  const mono = police(theme.policeChiffres);
  const code = { color: theme.fond, ...mono, fontSize: 13.5, lineHeight: 23 };
  const cle = { color: theme.sombre ? '#555' : '#AAA', ...mono, fontSize: 13.5, lineHeight: 23 };
  return (
    <Panneau theme={theme} testID="admin-identifiants">
      <Text style={[styleTitre(theme), { fontSize: 20 }]}>Accès de {nom}</Text>
      {valeurs.invitation ? (
        <PanneauInvitation
          theme={theme}
          nom={nom}
          invitation={valeurs.invitation}
          email={id ? outils.donnees.contacts[id]?.email : undefined}
          modele={outils.donnees.modeleInvitation}
          langueInitiale={langueDuCompte(id ? outils.donnees.contacts[id] : undefined)}
          fondateur={outils.acteur.nom}
          onEnvoye={canal => noterEnvoi(outils, id, nom, canal)}
        />
      ) : (
        <Text style={{ color: theme.attenue, fontSize: 13 }} testID="admin-invitation-indisponible">
          Invitation par lien : elle part de l’appareil du Fondateur principal (Administration › {nom} › Renvoyer une invitation). En attendant, transmettez les identifiants ci-dessous.
        </Text>
      )}
      <Intertitre theme={theme}>{valeurs.invitation?.lien ? 'Autre méthode (si le lien ne marche pas) : identifiants à dicter' : 'Identifiants'}</Intertitre>
      <Avis theme={theme} genre="alerte" texte={`Affichés une seule fois : ils ne sont conservés nulle part en clair. Méthode manuelle : ${nom} relie son navigateur avec le code de liaison, puis saisit prénom, mot de passe ET code à 6 chiffres. Ils ne servent plus dès que ${nom} a choisi son mot de passe par le lien.`} />
      <View style={{ padding: 14, backgroundColor: theme.texte, borderRadius: Math.min(theme.rayonMoyen, 10) }}>
        <Text selectable style={code}>
          <Text style={cle}>Prénom        </Text>
          {nom}
        </Text>
        <Text selectable style={code} testID="admin-mot-de-passe">
          <Text style={cle}>Mot de passe  </Text>
          {valeurs.motDePasse}
        </Text>
        <Text selectable style={code} testID="admin-secret-totp">
          <Text style={cle}>Clé TOTP      </Text>
          {valeurs.secretTotp}
        </Text>
      </View>
      <Text style={{ color: theme.attenue, fontSize: 13 }}>À scanner dans son application d’authentification (le code à 6 chiffres est demandé à chaque ouverture, avec le mot de passe) :</Text>
      <View style={{ alignItems: 'flex-start' }}>
        <QrCode texte={valeurs.uriTotp} legende={`AppDashboard · ${nom}`} testID="admin-qr-totp" />
      </View>
      <Text style={{ color: theme.texte, fontWeight: '600' }}>Codes de récupération</Text>
      <View style={commun.grille}>
        {valeurs.codesRecuperation.map(valeur => (
          <Text key={valeur} selectable style={[mono, { color: theme.texte, borderColor: theme.ligne, borderWidth: 1, borderRadius: 6, paddingVertical: 4, paddingHorizontal: 8, fontSize: 14, letterSpacing: 1 }]}>
            {valeur}
          </Text>
        ))}
      </View>
      <Avis theme={theme} genre="info" texte={`À dire à ${nom} : « Les administrateurs et fondateurs peuvent accéder à ton compte. Chaque accès est journalisé et tu le verras dans tes Paramètres. Ton identifiant est ton prénom. »`} />
      <View style={commun.ligne}>
        <Case theme={theme} coche={transmis} libelle="J’ai transmis ces identifiants" onChanger={setTransmis} testID="admin-transmis" />
        <Text style={{ color: theme.texte, flex: 1 }}>{valeurs.invitation?.lien ? 'J’ai envoyé l’invitation (et l’avertissement).' : 'J’ai transmis ces identifiants (et l’avertissement).'}</Text>
      </View>
      <View style={[commun.actions, { justifyContent: 'flex-end' }]}>
        <BoutonHub theme={theme} variante="plein" couleur={theme.teintes.admin} titre="Terminé" testID="admin-termine" desactive={!transmis} onPress={onTermine} />
      </View>
    </Panneau>
  );
}

// --- Invitation -----------------------------------------------------------------------

/** État de l'accès d'un compte, en clair : invité, expiré, actif (dernière connexion, appareils). */
export function etatAcces(profil: Profil, maintenant: number): string {
  if (profil.actif === false) return 'Désactivé : ne peut pas se connecter.';
  if (profil.derniereConnexion) {
    const appareils = profil.appareils ?? [];
    const liste = appareils.length > 0 ? ` · ${appareils.length} appareil${appareils.length > 1 ? 's' : ''} (${appareils.map(a => a.nom).join(', ')})` : '';
    return `Actif · dernière connexion ${relatif(profil.derniereConnexion, maintenant)}${profil.connexions ? ` · ${profil.connexions} connexion${profil.connexions > 1 ? 's' : ''}` : ''}${liste}.`;
  }
  if (profil.invitationExpireLe) {
    return maintenant >= Date.parse(profil.invitationExpireLe)
      ? `Invitation expirée le ${dateLisible(profil.invitationExpireLe, true)} : renvoyez-en une.`
      : `Invité : invitation valable jusqu’au ${dateLisible(profil.invitationExpireLe, true)}, pas encore utilisée.`;
  }
  return profil.anterieur ? 'Compte d’avant le suivi des connexions.' : 'En attente : jamais connecté.';
}
