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

import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { QrCode } from '../../../ui/ecrans/CarteSynchro';
import type { IdentifiantsAmi } from '../../../profils/identifiants';
import type { Profil } from '../../../profils/profils';
import { police, teinteTransparente, type ThemeHub } from '../../themes';
import type { AppHub } from '../../types';
import {
  annulerInvitationPar,
  appliquerGroupePar,
  avecNotePar,
  definirExpirationPar,
  definirNiveauxPar,
  desactiverPar,
  prolongerInvitationPar,
  reactiverPar,
  renommerProfilPar,
  suspendrePar,
  verifierSur,
} from '../actions';
import { LIBELLES_STATUT, filtrerComptes, niveauProfil, niveauxProfil, recapitulatif, statutCompte, versAutorisations, type StatutCompte, type TriComptes } from '../comptes';
import { LONGUEUR_MAX_NOTE } from '../donnees';
import { CE_QUE_NE_PERMET_PAS, CE_QUE_PERMET, LIBELLES_RANG, NIVEAU_RANG, RANGS, autorise, rangDe, rangsAttribuables, type Rang } from '../roles';
import { LIBELLES_NIVEAU, MODELES, modeleCorrespondant, niveauxDe, niveauxDuModele, type IdModele, type Niveaux } from '../niveaux';
import { etatApp } from '../politique';
import { Avis, BoutonHub, Case, Champ, Intertitre, Panneau, Pilule, Segments, commun, dansJours, dateLisible, relatif, styleTitre, type OutilsAdmin } from './commun';

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
  const [identifiants, setIdentifiants] = useState<{ nom: string; valeurs: IdentifiantsAmi } | undefined>();
  const gestionnaire = outils.role === 'gestionnaire';
  const attribuables = registre.filter(a => !a.adminSeulement);
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
    <ActionsGroupees outils={outils} ids={selectionnes} apps={attribuables} onFini={() => setSelection([])} />
  ) : null;

  const detail = identifiants ? (
    <PanneauIdentifiants theme={theme} nom={identifiants.nom} valeurs={identifiants.valeurs} onTermine={() => setIdentifiants(undefined)} />
  ) : creation ? (
    <FormulaireCreation
      outils={outils}
      apps={attribuables}
      onAnnuler={() => setCreation(false)}
      onCree={(nom, valeurs) => {
        setCreation(false);
        setIdentifiants({ nom, valeurs });
      }}
    />
  ) : profil ? (
    <Fiche key={profil.id} outils={outils} profil={profil} apps={attribuables} onIdentifiants={(nom, valeurs) => setIdentifiants({ nom, valeurs })} onSupprime={() => setChoisi(undefined)} />
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
                    </Text>
                  </View>
                  <BadgeRang theme={theme} profil={p} testID={`admin-rang-${p.id}`} />
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

function ActionsGroupees({ outils, ids, apps, onFini }: { outils: OutilsAdmin; ids: string[]; apps: AppHub[]; onFini(): void }) {
  const { theme, tous } = outils;
  const [modele, setModele] = useState<IdModele>('ami');
  const noms = ids.map(id => tous.find(p => p.id === id)?.nom ?? id);
  const appliquer = (action: Parameters<typeof appliquerGroupePar>[3], libelle: string) => {
    outils.modifierProfils(
      liste => appliquerGroupePar(outils.acteur, liste, ids, action, apps, outils.maintenant()).profils,
      ids.map(id => ({ type: action.genre === 'niveaux' ? 'permissions' : action.genre === 'prolonger' ? 'invitation' : 'compte', cible: id, nomCible: tous.find(p => p.id === id)?.nom, action: libelle })),
      `${libelle} : ${noms.join(', ')}.`,
    );
    onFini();
  };
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
      </View>
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
        <BoutonHub theme={theme} titre="Annuler la sélection" onPress={onFini} />
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
  const supprimer = () =>
    outils.exigerIdentite(`Supprimer le compte de ${profil.nom}`, () =>
      outils.agir('Suppression…', async () => {
        verifierSur(outils.acteur, 'supprimer-ami', outils.tous, profil.id);
        await controle.onSupprimer(profil.id);
        outils.majDonnees(d => avecNotePar(outils.acteur, d, outils.tous, profil.id, ''));
        outils.journaliser({ type: 'compte', ...cibleJournal, action: `Compte de ${profil.nom} supprimé (coffre et portefeuille effacés)` });
        onSupprime();
        return `Compte « ${profil.nom} » supprimé.`;
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

      {gestionnaire ? null : (
        <>
          <Intertitre theme={theme}>Rang</Intertitre>
          <View style={[commun.ligne, { paddingVertical: 0, flexWrap: 'wrap' }]}>
            <Pilule theme={theme} texte={LIBELLES_RANG[rangDe(profil)]} couleur={couleurRang(theme, rangDe(profil))} testID="admin-fiche-rang" />
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
            changerNiveaux(niveauxDuModele(apps, id), `Modèle « ${MODELES.find(m => m.id === id)?.nom} » appliqué`);
          }
        }}
        testID="admin-fiche-modele"
      />
      {apps.map(a => {
        const politique = etatApp(outils.politique, a.id);
        return (
          <View key={a.id} style={[commun.ligne, { flexWrap: 'wrap' }]}>
            <View style={[commun.carre, { backgroundColor: theme.teintes[a.teinte], borderRadius: Math.min(theme.rayonMoyen, 8) }]}>
              <Text style={{ color: theme.surAccent, fontWeight: '700' }}>{a.icone}</Text>
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

      {gestionnaire || !controle.onCodeSite ? null : (
        <>
          <Intertitre theme={theme}>Connexion sur le site ou un téléphone</Intertitre>
          <Text style={[attenue, { fontSize: 12 }]}>
            Un code PROPRE à {profil.nom} : il n’ouvre que son compte (ni l’annuaire, ni les autres comptes). {profil.nom} le saisit une fois sur son navigateur, puis se connecte avec son prénom, son mot de passe et son code, comme ici.
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
            <BoutonHub theme={theme} titre="Envoyer un code de connexion au site" onPress={envoyerCodeSite} testID="admin-code-site-generer" />
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
            <BoutonHub theme={theme} titre={`🗝 Ouvrir le compte de ${profil.nom}…`} onPress={() => setOuverture(true)} testID="admin-ouvrir-compte" />
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

      <Intertitre theme={theme}>{gestionnaire ? 'Identifiants' : 'Identifiants et suppression'}</Intertitre>
      {confirmation ? (
        <View style={[commun.avis, { borderLeftColor: theme.critique, backgroundColor: teinteTransparente(theme.critique, 0.12), gap: 8 }]} testID="admin-confirmation">
          <Text style={texte}>
            {confirmation === 'regenerer'
              ? `De nouveaux identifiants remplacent les anciens. Le portefeuille actuel de ${profil.nom} est scellé par l’ancienne clé : il sera effacé. (S’il a seulement oublié son mot de passe, il peut utiliser « Mot de passe oublié ? » avec un code de récupération.)`
              : `Le compte de ${profil.nom}, son coffre, son portefeuille et son séquestre seront effacés de cet appareil. C’est définitif.`}
          </Text>
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
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const expirationValide = expiration === '' || (/^\d{4}-\d{2}-\d{2}$/.test(expiration) && !Number.isNaN(Date.parse(expiration)));
  const creer = () =>
    outils.agir('Création du compte…', async () => {
      const { apps: ouvertes, niveaux: restreints } = versAutorisations(registre, niveaux);
      const jours = Number(invitation);
      const valeurs = await controle.onCreerCompte!(nom, ouvertes, {
        niveaux: restreints,
        invitationExpireLe: jours > 0 ? dansJours(outils.maintenant(), jours) : undefined,
        expireLe: expiration ? `${expiration}T23:59:59.000Z` : undefined,
      });
      outils.journaliser({ type: 'compte', nomCible: nom.trim(), action: `Compte de ${nom.trim()} créé (apps : ${ouvertes.join(', ') || 'aucune'} ; séquestre créé pour les rangs supérieurs ; ami averti)` });
      onCree(nom.trim(), valeurs);
      return `Compte de ${nom.trim()} créé.`;
    });
  return (
    <Panneau theme={theme} testID="admin-creation">
      <Text style={[styleTitre(theme), { fontSize: 20 }]}>Nouvel utilisateur</Text>
      <Champ theme={theme} libelle="Prénom de l’ami (il s’en servira pour se connecter)" valeur={nom} onChanger={setNom} placeholder="ex. Lucas" maxLength={30} testID="admin-nom" />
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
            {a.icone} {a.nom}
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
        <Text style={[texte, { fontWeight: '700' }]}>⚠️ Les administrateurs et fondateurs peuvent accéder à ce compte.</Text>
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
        <BoutonHub theme={theme} titre="Annuler" onPress={onAnnuler} />
        <BoutonHub
          theme={theme}
          variante="plein"
          couleur={theme.teintes.admin}
          titre="Créer et afficher les identifiants"
          testID="admin-creer"
          desactive={Boolean(outils.enCours) || !nom.trim() || !informe || !expirationValide || !controle.onCreerCompte}
          onPress={creer}
        />
      </View>
    </Panneau>
  );
}

/** Identifiants affichés une seule fois, avec l'avertissement de transparence à transmettre. */
function PanneauIdentifiants({ theme, nom, valeurs, onTermine }: { theme: ThemeHub; nom: string; valeurs: IdentifiantsAmi; onTermine(): void }) {
  const [transmis, setTransmis] = useState(false);
  const mono = police(theme.policeChiffres);
  const code = { color: theme.fond, ...mono, fontSize: 13.5, lineHeight: 23 };
  const cle = { color: theme.sombre ? '#555' : '#AAA', ...mono, fontSize: 13.5, lineHeight: 23 };
  return (
    <Panneau theme={theme} testID="admin-identifiants">
      <Text style={[styleTitre(theme), { fontSize: 20 }]}>Identifiants de {nom}</Text>
      <Avis theme={theme} genre="alerte" texte={`Affichés une seule fois : ils ne sont conservés nulle part en clair. Transmettez-les à ${nom} de vive voix ou sur papier, puis ne les gardez pas.`} />
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
      <Avis theme={theme} genre="info" texte={`À dire à ${nom} : « Les administrateurs et fondateurs peuvent accéder à ton compte. Chaque accès est journalisé et tu le verras dans tes Paramètres. Pour te connecter, saisis ton prénom. »`} />
      <View style={commun.ligne}>
        <Case theme={theme} coche={transmis} libelle="J’ai transmis ces identifiants" onChanger={setTransmis} testID="admin-transmis" />
        <Text style={{ color: theme.texte, flex: 1 }}>J’ai transmis ces identifiants (et l’avertissement).</Text>
      </View>
      <View style={[commun.actions, { justifyContent: 'flex-end' }]}>
        <BoutonHub theme={theme} variante="plein" couleur={theme.teintes.admin} titre="Terminé" testID="admin-termine" desactive={!transmis} onPress={onTermine} />
      </View>
    </Panneau>
  );
}
