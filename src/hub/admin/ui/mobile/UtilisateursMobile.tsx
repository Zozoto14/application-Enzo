/**
 * Utilisateurs, version téléphone.
 *
 *  - liste de cartes (nom, rang, statut, dernière connexion) : jamais de tableau ;
 *  - recherche en haut, filtres et tri dans une feuille basse ;
 *  - « Sélectionner » : mode de sélection, actions groupées en feuille ;
 *  - fiche d'un compte = sous-page (« ‹ Utilisateurs ») : groupes de cellules, chaque réglage
 *    s'ouvre dans une feuille basse (clavier adapté), actions destructrices avec saisie du prénom ;
 *  - création en une colonne, bouton principal collé en bas ;
 *  - identifiants affichés une seule fois, lisibles et sélectionnables.
 *
 * Les règles de rang et les vérifications d'identité sont celles du bureau : mêmes fonctions
 * (`actions.ts`, `roles.ts`), mêmes lignes de journal.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { QrCode } from '../../../../ui/ecrans/CarteSynchro';
import { BoutonPrincipal, Cellule, ChampMobile, ESPACE, FeuilleBasse, GroupeCellules, TEXTE, rayonCarte } from '../../../../ui/mobile';
import type { IdentifiantsAmi } from '../../../../profils/identifiants';
import type { Profil } from '../../../../profils/profils';
import { police, teinteTransparente, type ThemeHub } from '../../../themes';
import type { AppHub } from '../../../types';
import { annulerInvitationPar, appliquerGroupePar, avecNotePar, definirExpirationPar, definirNiveauxPar, desactiverPar, prolongerInvitationPar, reactiverPar, renommerProfilPar, suspendrePar } from '../../actions';
import { LIBELLES_STATUT, filtrerComptes, niveauProfil, niveauxProfil, recapitulatif, statutCompte, versAutorisations, type StatutCompte, type TriComptes } from '../../comptes';
import { LONGUEUR_MAX_NOTE } from '../../donnees';
import { CE_QUE_NE_PERMET_PAS, CE_QUE_PERMET, LIBELLES_RANG, NIVEAU_RANG, RANGS, autorise, rangDe, rangsAttribuables, type Rang } from '../../roles';
import { LIBELLES_NIVEAU, MODELES, modeleCorrespondant, niveauxDe, niveauxDuModele, type IdModele, type Niveaux } from '../../niveaux';
import { etatApp } from '../../politique';
import { creerActionsCompte } from '../actionsCompte';
import { Avis, Pilule, dansJours, dateLisible, relatif, styleTitre, type OutilsAdmin } from '../commun';
import { LIBELLES_SEQUESTRE, couleurRang, couleurStatut } from '../Utilisateurs';
import { Aide, CadreAdmin, CelluleChoix, FeuilleConfirmation, FeuilleFiltres } from './briques';

type Filtre = StatutCompte | 'tous';
type Feuille = 'nom' | 'rang' | 'note' | 'expiration' | 'suspension' | 'code' | 'ouvrir' | 'codeSite' | 'groupe' | 'annulerInvitation' | 'desactiver' | 'regenererCode' | 'revoquer' | 'regenerer' | 'supprimer';

const dateOk = (d: string) => d === '' || (/^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)));

export function Utilisateurs({ outils, cible, onRetour }: { outils: OutilsAdmin; cible?: string; onRetour(): void }) {
  const { theme, tous, registre, controle } = outils;
  const [choisi, setChoisi] = useState<string | undefined>(cible);
  const [creation, setCreation] = useState(false);
  const [identifiants, setIdentifiants] = useState<{ nom: string; valeurs: IdentifiantsAmi } | undefined>();
  const attribuables = registre.filter(a => !a.adminSeulement);
  const profil = tous.find(p => p.id === choisi);

  if (identifiants) {
    return <Identifiants outils={outils} nom={identifiants.nom} valeurs={identifiants.valeurs} onTermine={() => setIdentifiants(undefined)} />;
  }
  if (creation) {
    return (
      <Creation
        outils={outils}
        apps={attribuables}
        onRetour={() => setCreation(false)}
        onCree={(nom, valeurs) => {
          setCreation(false);
          setIdentifiants({ nom, valeurs });
        }}
      />
    );
  }
  if (profil) {
    return <Fiche key={profil.id} outils={outils} profil={profil} apps={attribuables} onRetour={() => setChoisi(undefined)} onIdentifiants={(nom, valeurs) => setIdentifiants({ nom, valeurs })} />;
  }
  return <Liste outils={outils} apps={attribuables} onRetour={onRetour} onOuvrir={setChoisi} onCreer={() => setCreation(true)} creationPossible={Boolean(controle.onCreerCompte) && controle.restreint !== true && autorise(outils.acteur, 'creer-ami').ok} />;
}

// --- Liste -----------------------------------------------------------------------------

function Liste({ outils, apps, onRetour, onOuvrir, onCreer, creationPossible }: { outils: OutilsAdmin; apps: AppHub[]; onRetour(): void; onOuvrir(id: string): void; onCreer(): void; creationPossible: boolean }) {
  const { theme, tous, registre } = outils;
  const maintenant = outils.maintenant();
  const gestionnaire = outils.role === 'gestionnaire';
  const [recherche, setRecherche] = useState('');
  const [statut, setStatut] = useState<Filtre>('tous');
  const [app, setApp] = useState('toutes');
  const [tri, setTri] = useState<TriComptes>('nom');
  const [roleFiltre, setRoleFiltre] = useState<'tous' | Rang>('tous');
  const [filtres, setFiltres] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [mode, setMode] = useState(false);
  const [groupe, setGroupe] = useState(false);
  const liste = filtrerComptes(tous, { recherche, statut, app: app === 'toutes' ? undefined : app, tri, role: roleFiltre }, registre, maintenant);
  const actionnable = (p: Profil) => autorise(outils.acteur, 'etat-ami', p).ok;
  const amisVisibles = liste.filter(actionnable).map(p => p.id);
  const selectionnes = selection.filter(id => tous.some(p => p.id === id && actionnable(p)));
  const rangsVisibles = RANGS.filter(r => NIVEAU_RANG[r] < NIVEAU_RANG[outils.role] || (r === 'fondateur' && outils.role === 'fondateur'));
  const actifs = (statut !== 'tous' ? 1 : 0) + (app !== 'toutes' ? 1 : 0) + (roleFiltre !== 'tous' ? 1 : 0);
  const basculer = (id: string, coche: boolean) => setSelection(s => (coche ? [...new Set([...s, id])] : s.filter(x => x !== id)));
  const quitterMode = () => {
    setMode(false);
    setSelection([]);
  };

  return (
    <CadreAdmin
      theme={theme}
      titre="Utilisateurs"
      libelleRetour="Administration"
      onRetour={onRetour}
      testID="admin-section-utilisateurs"
      actions={tous.some(actionnable) ? [{ titre: mode ? '✕' : '☑︎', libelle: mode ? 'Quitter la sélection' : 'Sélectionner des comptes', onPress: mode ? quitterMode : () => setMode(true), testID: 'admin-selectionner' }] : undefined}
      pied={
        mode ? (
          <BoutonPrincipal theme={theme} titre={selectionnes.length > 0 ? `Actions groupées (${selectionnes.length})` : 'Choisissez des comptes'} desactive={selectionnes.length === 0} onPress={() => setGroupe(true)} testID="admin-groupe-ouvrir" />
        ) : (
          <BoutonPrincipal theme={theme} titre="＋ Nouvel utilisateur" desactive={Boolean(outils.enCours) || !creationPossible} onPress={onCreer} testID="admin-nouveau" />
        )
      }>
      <ChampMobile theme={theme} etiquette="Rechercher un prénom" nature="recherche" value={recherche} onChangeText={setRecherche} placeholder="ex. Lucas" testID="admin-recherche" />
      <GroupeCellules theme={theme}>
        <Cellule theme={theme} titre="Filtres et tri" valeur={actifs > 0 ? `${actifs} actif${actifs > 1 ? 's' : ''}` : 'Aucun'} chevron testID="admin-filtres-ouvrir" onPress={() => setFiltres(true)} />
      </GroupeCellules>
      <Text accessibilityRole="header" style={{ color: theme.attenue, fontSize: TEXTE.legende, fontWeight: '600', ...police(theme.policeTexte) }}>
        {gestionnaire ? `${tous.length} ami${tous.length > 1 ? 's' : ''} que vous gérez` : `${tous.length} compte${tous.length > 1 ? 's' : ''}`}
        {liste.length !== tous.length ? ` · ${liste.length} affiché${liste.length > 1 ? 's' : ''}` : ''}
        {selectionnes.length > 0 ? ` · ${selectionnes.length} sélectionné${selectionnes.length > 1 ? 's' : ''}` : ''}
      </Text>
      {mode && amisVisibles.length > 0 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <CaseLigne theme={theme} coche={amisVisibles.every(id => selection.includes(id))} libelle="Tout sélectionner" onChanger={v => setSelection(v ? amisVisibles : [])} testID="admin-tout-selectionner" />
          <Text style={{ color: theme.texte, fontSize: TEXTE.corps, ...police(theme.policeTexte) }}>Tout sélectionner</Text>
        </View>
      ) : null}
      <View testID="admin-liste" style={{ gap: ESPACE.s }}>
        {liste.length === 0 ? (
          <Aide theme={theme}>{tous.length === 0 ? 'Aucun compte pour l’instant. Créez le premier avec le bouton ci-dessous.' : 'Aucun compte ne correspond à la recherche ou aux filtres.'}</Aide>
        ) : null}
        {liste.map(p => (
          <LigneUtilisateur
            key={p.id}
            outils={outils}
            profil={p}
            mode={mode && actionnable(p)}
            coche={selection.includes(p.id)}
            onCocher={v => basculer(p.id, v)}
            onOuvrir={() => onOuvrir(p.id)}
          />
        ))}
      </View>
      {gestionnaire ? (
        <Aide theme={theme}>Seuls les amis que vous avez créés apparaissent ici : les autres comptes de cet appareil restent isolés.</Aide>
      ) : (
        <Aide theme={theme} testID="admin-rangs-explication">
          Rangs : Fondateur › Administrateur › Gestionnaire › Ami. Chacun n’agit que sur les rangs strictement inférieurs.
        </Aide>
      )}

      <FeuilleFiltres
        theme={theme}
        visible={filtres}
        titre="Filtres et tri"
        onFermer={() => setFiltres(false)}
        champs={[
          {
            id: 'statut',
            libelle: 'Statut',
            valeur: statut,
            options: [{ cle: 'tous', titre: 'Tous' }, { cle: 'actif', titre: 'Actifs' }, { cle: 'invite', titre: 'Invités' }, { cle: 'invitation-expiree', titre: 'Invitation expirée' }, { cle: 'suspendu', titre: 'Suspendus' }, { cle: 'desactive', titre: 'Désactivés' }, { cle: 'expire', titre: 'Expirés' }],
          },
          ...(gestionnaire ? [] : [{ id: 'rang', libelle: 'Rang', valeur: roleFiltre, options: [{ cle: 'tous', titre: 'Tous les rangs' }, ...rangsVisibles.map(r => ({ cle: r, titre: `${LIBELLES_RANG[r]}s` }))] }]),
          { id: 'app', libelle: 'Application', valeur: app, options: [{ cle: 'toutes', titre: 'Toutes les apps' }, ...apps.map(a => ({ cle: a.id, titre: a.nom }))] },
          { id: 'tri', libelle: 'Trier par', valeur: tri, options: [{ cle: 'nom', titre: 'Nom' }, { cle: 'statut', titre: 'Statut' }, { cle: 'connexion', titre: 'Dernière connexion' }, { cle: 'creation', titre: 'Date de création' }] },
        ]}
        onChoisir={(id, cle) => {
          if (id === 'statut') setStatut(cle as Filtre);
          else if (id === 'rang') setRoleFiltre(cle as 'tous' | Rang);
          else if (id === 'app') setApp(cle);
          else setTri(cle as TriComptes);
        }}
        onReinitialiser={() => {
          setStatut('tous');
          setRoleFiltre('tous');
          setApp('toutes');
          setTri('nom');
        }}
      />
      <ActionsGroupees outils={outils} visible={groupe} ids={selectionnes} apps={apps} onFermer={() => setGroupe(false)} onFini={() => { setGroupe(false); quitterMode(); }} />
    </CadreAdmin>
  );
}

function CaseLigne({ theme, coche, libelle, onChanger, testID }: { theme: ThemeHub; coche: boolean; libelle: string; onChanger(v: boolean): void; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="checkbox" accessibilityState={{ checked: coche }} accessibilityLabel={libelle} onPress={() => onChanger(!coche)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: 28, height: 28, borderWidth: 2, borderRadius: 6, alignItems: 'center', justifyContent: 'center', borderColor: coche ? theme.teintes.admin : theme.attenue, backgroundColor: coche ? theme.teintes.admin : 'transparent' }}>
        <Text style={{ color: theme.surAccent, fontSize: 16, fontWeight: '800' }}>{coche ? '✓' : ''}</Text>
      </View>
    </Pressable>
  );
}

function LigneUtilisateur({ outils, profil: p, mode, coche, onCocher, onOuvrir }: { outils: OutilsAdmin; profil: Profil; mode: boolean; coche: boolean; onCocher(v: boolean): void; onOuvrir(): void }) {
  const { theme, registre } = outils;
  const maintenant = outils.maintenant();
  const gestionnaire = outils.role === 'gestionnaire';
  const s = statutCompte(p, maintenant);
  const rang = rangDe(p);
  const apps = p.admin
    ? 'Toutes les apps'
    : registre
        .filter(a => niveauProfil(p, a) !== 'aucun')
        .map(a => (niveauProfil(p, a) === 'lecture' ? `${a.nom} (lecture)` : a.nom))
        .join(', ') || 'Aucune app';
  const vu = gestionnaire ? undefined : p.derniereConnexion ? `vu ${relatif(p.derniereConnexion, maintenant)}` : 'jamais connecté';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: coche ? theme.teintes.admin : theme.ligne, backgroundColor: theme.surface, borderRadius: rayonCarte(theme), paddingLeft: mode ? 0 : ESPACE.m }}>
      {mode ? <CaseLigne theme={theme} coche={coche} libelle={`Sélectionner ${p.nom}`} onChanger={onCocher} testID={`admin-case-${p.id}`} /> : null}
      <Pressable
        testID={`admin-ligne-${p.id}`}
        accessibilityRole="button"
        accessibilityLabel={`Ouvrir la fiche de ${p.nom}`}
        onPress={mode ? () => onCocher(!coche) : onOuvrir}
        style={{ flex: 1, minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: ESPACE.s, paddingVertical: ESPACE.s, paddingRight: ESPACE.m, paddingLeft: mode ? ESPACE.xs : 0 }}>
        <View style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: p.admin ? theme.teintes.admin : teinteTransparente(theme.teintes.admin, 0.18), borderRadius: theme.rayonGrand ? 22 : 0 }}>
          <Text style={{ color: p.admin ? theme.surAccent : theme.teintes.admin, fontWeight: '700', fontSize: 18 }}>{p.nom.slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text numberOfLines={1} style={{ color: theme.texte, fontSize: TEXTE.corps, fontWeight: '600', ...police(theme.policeTexte) }}>
            {p.nom}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {rang !== 'ami' ? <Pilule theme={theme} texte={LIBELLES_RANG[rang]} couleur={couleurRang(theme, rang)} testID={`admin-rang-${p.id}`} /> : null}
            {p.titulaire === 'en-attente' ? <Pilule theme={theme} texte="Clé en attente" couleur={theme.alerte} testID={`admin-titulaire-${p.id}`} /> : null}
            <Pilule theme={theme} texte={LIBELLES_STATUT[s]} couleur={couleurStatut(theme, s)} testID={`admin-statut-${p.id}`} />
          </View>
          <Text numberOfLines={2} style={{ color: theme.attenue, fontSize: TEXTE.legende, ...police(theme.policeTexte) }}>
            {vu ? `${vu} · ` : ''}
            {apps}
          </Text>
        </View>
        {mode ? null : <Text style={{ color: theme.attenue, fontSize: 24 }}>›</Text>}
      </Pressable>
    </View>
  );
}

// --- Actions groupées ---------------------------------------------------------------------

function ActionsGroupees({ outils, visible, ids, apps, onFermer, onFini }: { outils: OutilsAdmin; visible: boolean; ids: string[]; apps: AppHub[]; onFermer(): void; onFini(): void }) {
  const { theme, tous } = outils;
  const [modele, setModele] = useState<IdModele>('ami');
  const [confirmer, setConfirmer] = useState(false);
  const noms = ids.map(id => tous.find(p => p.id === id)?.nom ?? id);
  const appliquer = (action: Parameters<typeof appliquerGroupePar>[3], libelle: string) => {
    outils.modifierProfils(
      liste => appliquerGroupePar(outils.acteur, liste, ids, action, apps, outils.maintenant()).profils,
      ids.map(id => ({ type: action.genre === 'niveaux' ? 'permissions' : action.genre === 'prolonger' ? 'invitation' : 'compte', cible: id, nomCible: tous.find(p => p.id === id)?.nom, action: libelle })),
      `${libelle} : ${noms.join(', ')}.`,
    );
    setConfirmer(false);
    onFini();
  };
  const jours = outils.donnees.reglages.invitationJours;
  if (confirmer) {
    return (
      <FeuilleConfirmation
        theme={theme}
        visible={visible}
        titre={`Désactiver ${ids.length} compte${ids.length > 1 ? 's' : ''} ?`}
        description={`${noms.join(', ')} ne pourr${ids.length > 1 ? 'ont' : 'a'} plus ouvrir ${ids.length > 1 ? 'leur compte' : 'son compte'} tant que vous ne l’aurez pas réactivé.`}
        libelleAction="Désactiver"
        testID="admin-groupe-confirmation"
        testIDAction="admin-groupe-desactiver-confirmer"
        onFermer={() => setConfirmer(false)}
        onConfirmer={() => appliquer({ genre: 'desactiver' }, 'Compte désactivé (action groupée)')}
      />
    );
  }
  return (
    <FeuilleBasse theme={theme} visible={visible} titre={`Actions groupées · ${ids.length} compte${ids.length > 1 ? 's' : ''}`} description={noms.join(', ')} onFermer={onFermer} testID="admin-groupe">
      <GroupeCellules theme={theme} titre="État">
        <Cellule theme={theme} titre="Désactiver" danger chevron testID="admin-groupe-desactiver" onPress={() => setConfirmer(true)} />
        <Cellule theme={theme} titre="Réactiver" chevron testID="admin-groupe-reactiver" onPress={() => appliquer({ genre: 'reactiver' }, 'Compte réactivé (action groupée)')} />
        <Cellule theme={theme} titre={`Prolonger l’invitation de ${jours} j`} chevron testID="admin-groupe-prolonger" onPress={() => appliquer({ genre: 'prolonger', jours }, `Invitation prolongée de ${jours} jours (action groupée)`)} />
      </GroupeCellules>
      <GroupeCellules theme={theme} titre="Modèle de permissions">
        {MODELES.filter(m => m.niveau).map(m => (
          <Cellule key={m.id} theme={theme} titre={m.nom} coche={m.id === modele} testID={`admin-groupe-modele-${m.id}`} onPress={() => setModele(m.id)} />
        ))}
      </GroupeCellules>
      <BoutonPrincipal theme={theme} titre="Appliquer le modèle" onPress={() => appliquer({ genre: 'niveaux', niveaux: niveauxDuModele(apps, modele) }, `Modèle « ${MODELES.find(m => m.id === modele)?.nom} » appliqué (action groupée)`)} testID="admin-groupe-appliquer-modele" />
    </FeuilleBasse>
  );
}

// --- Fiche ------------------------------------------------------------------------------

function Fiche({ outils, profil, apps, onRetour, onIdentifiants }: { outils: OutilsAdmin; profil: Profil; apps: AppHub[]; onRetour(): void; onIdentifiants(nom: string, valeurs: IdentifiantsAmi): void }) {
  const { theme, controle, registre, donnees } = outils;
  const maintenant = outils.maintenant();
  const [feuille, setFeuille] = useState<Feuille | undefined>();
  const [nom, setNom] = useState(profil.nom);
  const [note, setNote] = useState(donnees.notes[profil.id] ?? '');
  const [suspension, setSuspension] = useState('7');
  const [expiration, setExpiration] = useState(profil.expireLe ? profil.expireLe.slice(0, 10) : '');
  const [code, setCode] = useState<{ code: string; creeLe: string } | undefined>();
  const [codeSaisi, setCodeSaisi] = useState('');
  const [codeSite, setCodeSite] = useState<{ code: string; lien?: string } | undefined>();
  const [rangChoisi, setRangChoisi] = useState<Rang | undefined>();
  const [saisieRang, setSaisieRang] = useState('');
  const gestionnaire = outils.role === 'gestionnaire';
  const statut = statutCompte(profil, maintenant);
  const niveaux = niveauxProfil(profil, registre);
  const cibleJournal = { cible: profil.id, nomCible: profil.nom };
  const attribuables = rangsAttribuables(outils.acteur, profil);
  const { regenerer, supprimer, afficherCode, envoyerCodeSite, regenererCode, revoquer, retablir, ouvrirCompte } = creerActionsCompte({ outils, profil, onIdentifiants, onSupprime: onRetour, setCode, setCodeSite, codeSaisi });

  // Un code reçu (affiché, régénéré, code du site) s'affiche aussitôt dans sa feuille.
  useEffect(() => {
    if (code) setFeuille('code');
  }, [code]);
  useEffect(() => {
    if (codeSite) setFeuille('codeSite');
  }, [codeSite]);

  if (!autorise(outils.acteur, 'voir-compte', profil).ok) {
    const soi = profil.id === outils.acteur.id;
    return (
      <CadreAdmin theme={theme} titre={profil.nom} libelleRetour="Utilisateurs" onRetour={onRetour} testID="admin-detail">
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {rangDe(profil) !== 'ami' ? <Pilule theme={theme} texte={LIBELLES_RANG[rangDe(profil)]} couleur={couleurRang(theme, rangDe(profil))} testID="admin-fiche-rang" /> : null}
        </View>
        <Aide theme={theme} testID="admin-fiche-lecture-seule">
          {soi
            ? 'C’est votre compte : on n’agit pas sur son propre compte depuis l’Administration.'
            : `Même rang que vous (${LIBELLES_RANG[rangDe(profil)]}) : aucune action possible sur ce compte, ni ouverture, ni modification.`}
        </Aide>
        {profil.admin ? <Aide theme={theme}>Compte historique : toujours Fondateur. Dernière connexion : {dateLisible(profil.derniereConnexion, true)}</Aide> : null}
      </CadreAdmin>
    );
  }

  const changerNiveaux = (suivants: Niveaux, libelle: string) =>
    outils.modifierProfils(liste => definirNiveauxPar(outils.acteur, liste, profil.id, registre, suivants), [{ type: 'permissions', ...cibleJournal, action: libelle }]);
  const modele = modeleCorrespondant(apps, niveaux);
  const fermer = () => setFeuille(undefined);
  const invitationEnCours = Boolean(profil.invitationExpireLe && !profil.derniereConnexion);
  const desactive = statut === 'desactive' || statut === 'suspendu';
  const sequestreActif = profil.sequestre === 'actif';
  const piedReactiver = desactive;
  const piedCode = !piedReactiver && !gestionnaire && sequestreActif;
  const rang = rangDe(profil);

  const pied = piedReactiver ? (
    <BoutonPrincipal
      theme={theme}
      titre="Réactiver le compte"
      testID="admin-activer"
      onPress={() => outils.modifierProfils(liste => reactiverPar(outils.acteur, liste, profil.id), [{ type: 'compte', ...cibleJournal, action: `Compte de ${profil.nom} réactivé` }], `${profil.nom} peut de nouveau ouvrir son compte.`)}
    />
  ) : piedCode ? (
    <BoutonPrincipal theme={theme} titre="Afficher le code d’accès" testID="admin-code-afficher" onPress={afficherCode} />
  ) : undefined;

  const confirmerRang = () => {
    if (!rangChoisi) return;
    const choisi = rangChoisi;
    const promotion = NIVEAU_RANG[choisi] > NIVEAU_RANG[rang];
    setFeuille(undefined);
    setRangChoisi(undefined);
    setSaisieRang('');
    outils.exigerIdentite(
      `${promotion ? 'Promouvoir' : 'Rétrograder'} ${profil.nom} ${LIBELLES_RANG[choisi]}`,
      () =>
        outils.agir('Changement de rang…', async () => {
          const { enAttente } = await controle.onChangerRang!(profil.id, choisi);
          outils.journaliser({ type: 'role', ...cibleJournal, action: `${profil.nom} : ${LIBELLES_RANG[rang]} → ${LIBELLES_RANG[choisi]}${enAttente ? ' (clé en attente de sa prochaine connexion)' : ''}` });
          return enAttente
            ? `${profil.nom} est ${LIBELLES_RANG[choisi]}. Sa clé de séquestre sera créée à sa prochaine connexion ; les comptes inférieurs lui seront alors re-scellés.`
            : `${profil.nom} est maintenant ${LIBELLES_RANG[choisi]}.`;
        }),
      true,
    );
  };

  return (
    <CadreAdmin theme={theme} titre={profil.nom} libelleRetour="Utilisateurs" onRetour={onRetour} testID="admin-detail" pied={pied}>
      <View style={{ gap: ESPACE.xs, padding: ESPACE.m, borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.surface, borderRadius: rayonCarte(theme) }}>
        <Text style={[styleTitre(theme), { fontSize: 24 }]} accessibilityRole="header">
          {profil.nom}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          <Pilule theme={theme} texte={LIBELLES_STATUT[statut]} couleur={couleurStatut(theme, statut)} testID="admin-fiche-statut" />
          {gestionnaire ? null : <Pilule theme={theme} texte={LIBELLES_RANG[rang]} couleur={couleurRang(theme, rang)} testID="admin-fiche-rang" />}
        </View>
        {!gestionnaire && profil.creePar ? (
          <Text style={{ color: theme.attenue, fontSize: TEXTE.legende, ...police(theme.policeTexte) }} testID="admin-fiche-cree-par">
            Créé par {outils.tous.find(p => p.id === profil.creePar)?.nom ?? 'un compte inconnu (rang retiré ou compte supprimé)'}.
          </Text>
        ) : null}
        <Text style={{ color: theme.attenue, fontSize: TEXTE.legende, lineHeight: 22, ...police(theme.policeTexte) }}>
          {gestionnaire
            ? 'Ami que vous avez créé : ses connexions et son contenu ne vous sont pas communiqués.'
            : `Créé le ${profil.creeLe || 'date inconnue'} · dernière connexion : ${dateLisible(profil.derniereConnexion, true)} · ${profil.connexions ?? 0} ouverture${(profil.connexions ?? 0) > 1 ? 's' : ''}`}
        </Text>
      </View>

      <GroupeCellules theme={theme} titre="Compte">
        {autorise(outils.acteur, 'renommer-ami', profil).ok ? <Cellule theme={theme} titre="Prénom" valeur={profil.nom} chevron testID="admin-fiche-nom-ouvrir" onPress={() => { setNom(profil.nom); setFeuille('nom'); }} /> : null}
        {gestionnaire ? null : attribuables.length > 0 && controle.onChangerRang ? (
          <Cellule theme={theme} titre="Rang" valeur={LIBELLES_RANG[rang]} chevron testID="admin-rang-changer" onPress={() => { setRangChoisi(attribuables[0]); setSaisieRang(''); setFeuille('rang'); }} />
        ) : (
          <Cellule theme={theme} titre="Rang" valeur={LIBELLES_RANG[rang]} sousTitre={attribuables.length > 0 ? 'Changer le rang se fait depuis l’appareil qui a l’annuaire complet (le PC).' : undefined} />
        )}
        {gestionnaire ? null : <Cellule theme={theme} titre="Note privée" valeur={donnees.notes[profil.id] ? 'Modifier' : 'Ajouter'} chevron testID="admin-note-ouvrir" onPress={() => setFeuille('note')} />}
      </GroupeCellules>
      {gestionnaire || !profil.titulaire ? null : (
        <Aide theme={theme} testID="admin-fiche-titulaire">
          {profil.titulaire === 'actif' ? 'Clé de séquestre confirmée : les comptes inférieurs lui sont scellés.' : 'Clé de séquestre en attente : créée ou confirmée à sa prochaine connexion (ou à celle d’un Fondateur qui peut l’ouvrir).'}
        </Aide>
      )}

      <GroupeCellules theme={theme} titre="Accès aux apps">
        <CelluleChoix
          theme={theme}
          titre="Modèle de permissions"
          options={MODELES.map(m => ({ cle: m.id, titre: m.nom }))}
          valeur={modele}
          testID="admin-fiche-modele"
          onChoisir={id => {
            if (id !== 'personnalise') changerNiveaux(niveauxDuModele(apps, id as IdModele), `Modèle « ${MODELES.find(m => m.id === id)?.nom} » appliqué`);
          }}
        />
        {apps.map(a => {
          const politique = etatApp(outils.politique, a.id);
          return (
            <CelluleChoix
              key={a.id}
              theme={theme}
              titre={`${a.icone}  ${a.nom}`}
              sousTitre={!politique.active ? 'Désactivée pour tous (Applications)' : politique.maintenance !== undefined ? 'En maintenance' : undefined}
              options={niveauxDe(a).map(n => ({ cle: n, titre: LIBELLES_NIVEAU[n] }))}
              valeur={niveaux[a.id] ?? 'aucun'}
              testID={`admin-niveau-${profil.id}-${a.id}`}
              onChoisir={n => changerNiveaux({ ...niveaux, [a.id]: n as Niveaux[string] }, `${a.nom} : ${LIBELLES_NIVEAU[n as keyof typeof LIBELLES_NIVEAU].toLowerCase()}`)}
            />
          );
        })}
      </GroupeCellules>

      <GroupeCellules theme={theme} titre="Invitation et durée d’accès">
        <Cellule
          theme={theme}
          titre={invitationEnCours ? 'Invitation en attente' : profil.derniereConnexion ? 'Invitation acceptée' : 'Aucune invitation en cours'}
          sousTitre={invitationEnCours ? `Valable jusqu’au ${dateLisible(profil.invitationExpireLe, true)} (${relatif(profil.invitationExpireLe, maintenant)}).` : undefined}
        />
        {!profil.derniereConnexion ? (
          <Cellule
            theme={theme}
            titre={`Prolonger de ${outils.donnees.reglages.invitationJours} j`}
            chevron
            testID="admin-invitation-prolonger"
            onPress={() =>
              outils.modifierProfils(liste => prolongerInvitationPar(outils.acteur, liste, profil.id, outils.donnees.reglages.invitationJours, outils.maintenant()), [
                { type: 'invitation', ...cibleJournal, action: `Invitation de ${profil.nom} prolongée de ${outils.donnees.reglages.invitationJours} jours` },
              ])
            }
          />
        ) : null}
        {invitationEnCours ? <Cellule theme={theme} titre="Annuler l’invitation" danger chevron testID="admin-invitation-annuler" onPress={() => setFeuille('annulerInvitation')} /> : null}
        <Cellule theme={theme} titre="Fin d’accès" valeur={profil.expireLe ? dateLisible(profil.expireLe) : 'Aucune'} chevron testID="admin-expiration-ouvrir" onPress={() => setFeuille('expiration')} />
      </GroupeCellules>

      {desactive ? null : (
        <GroupeCellules theme={theme} titre="Activation">
          <Cellule theme={theme} titre="Suspendre pendant quelques jours" chevron testID="admin-suspendre-ouvrir" onPress={() => setFeuille('suspension')} />
          <Cellule theme={theme} titre="Désactiver le compte" danger chevron testID="admin-desactiver" onPress={() => setFeuille('desactiver')} />
        </GroupeCellules>
      )}

      {gestionnaire || !controle.onCodeSite ? null : (
        <GroupeCellules theme={theme} titre="Connexion sur le site ou un téléphone" note={`Un code PROPRE à ${profil.nom} : il n’ouvre que son compte (ni l’annuaire, ni les autres comptes).`}>
          <Cellule theme={theme} titre="Envoyer un code de connexion au site" chevron testID="admin-code-site-generer" onPress={envoyerCodeSite} />
        </GroupeCellules>
      )}

      {gestionnaire ? null : (
        <GroupeCellules theme={theme} titre="Accès par séquestre (vos codes)" note={`${profil.nom} est averti·e dans ses Paramètres : « ${rang === 'administrateur' ? 'Les fondateurs peuvent accéder à ton compte' : 'Les administrateurs et fondateurs peuvent accéder à ton compte'} ». Chaque accès est inscrit au journal, avec votre nom.`}>
          <Cellule theme={theme} titre="État du séquestre" sousTitre={LIBELLES_SEQUESTRE[profil.sequestre ?? 'absent']} testID="admin-sequestre-etat" />
          {sequestreActif && !piedCode ? <Cellule theme={theme} titre="Afficher le code d’accès" chevron testID="admin-code-afficher" onPress={afficherCode} /> : null}
          {sequestreActif ? <Cellule theme={theme} titre="Régénérer le code" chevron testID="admin-code-regenerer" onPress={() => setFeuille('regenererCode')} /> : null}
          {sequestreActif ? <Cellule theme={theme} titre="Révoquer l’accès" danger chevron testID="admin-code-revoquer" onPress={() => setFeuille('revoquer')} /> : null}
          {profil.sequestre === 'revoque' ? <Cellule theme={theme} titre="Rétablir l’accès" chevron testID="admin-code-retablir" onPress={retablir} /> : null}
          {sequestreActif && controle.onOuvrirCompte ? <Cellule theme={theme} titre={`Ouvrir le compte de ${profil.nom}`} sousTitre="Avec le code d’accès, jusqu’à la fin de votre session" chevron testID="admin-ouvrir-compte" onPress={() => setFeuille('ouvrir')} /> : null}
        </GroupeCellules>
      )}

      <GroupeCellules theme={theme} titre={gestionnaire ? 'Identifiants' : 'Identifiants et suppression'}>
        {controle.onRegenerer ? <Cellule theme={theme} titre="Régénérer les identifiants" chevron testID="admin-regenerer" onPress={() => setFeuille('regenerer')} /> : null}
        {gestionnaire || controle.restreint || !autorise(outils.acteur, 'supprimer-ami', profil).ok ? null : <Cellule theme={theme} titre="Supprimer le compte" danger chevron testID="admin-supprimer" onPress={() => setFeuille('supprimer')} />}
      </GroupeCellules>

      {/* Feuilles */}
      <FeuilleBasse theme={theme} visible={feuille === 'nom'} titre="Prénom" onFermer={fermer} testID="admin-feuille-nom"
        pied={
          <BoutonPrincipal
            theme={theme}
            titre="Renommer"
            desactive={!nom.trim() || nom.trim() === profil.nom}
            testID="admin-fiche-renommer"
            onPress={() => {
              fermer();
              outils.modifierProfils(
                liste => renommerProfilPar(outils.acteur, liste, profil.id, nom.trim()),
                [{ type: 'compte', cible: profil.id, nomCible: nom.trim(), action: `« ${profil.nom} » renommé « ${nom.trim()} »` }],
                'Compte renommé : l’ami se connecte désormais avec ce prénom.',
              );
            }}
          />
        }>
        <ChampMobile theme={theme} etiquette="Prénom de l’ami (il s’en sert pour se connecter)" nature="prenom" value={nom} onChangeText={setNom} maxLength={30} enterKeyHint="done" testID="admin-fiche-nom" />
      </FeuilleBasse>

      <FeuilleBasse theme={theme} visible={feuille === 'note'} titre="Note privée" description="Visible de vous seul, chiffrée avec vos données." onFermer={fermer} testID="admin-feuille-note"
        pied={
          <BoutonPrincipal
            theme={theme}
            titre="Enregistrer la note"
            desactive={note === (donnees.notes[profil.id] ?? '')}
            testID="admin-note-enregistrer"
            onPress={() => {
              outils.majDonnees(d => avecNotePar(outils.acteur, d, outils.tous, profil.id, note));
              outils.journaliser({ type: 'compte', ...cibleJournal, action: `Note privée sur ${profil.nom} modifiée` });
              fermer();
            }}
          />
        }>
        <ChampMobile theme={theme} etiquette="Note" nature="multiligne" value={note} onChangeText={setNote} maxLength={LONGUEUR_MAX_NOTE} testID="admin-note" />
      </FeuilleBasse>

      <FeuilleBasse theme={theme} visible={feuille === 'expiration'} titre="Fin d’accès" description="Après cette date, le compte ne s’ouvre plus. Laissez vide pour aucune limite." onFermer={fermer} testID="admin-feuille-expiration"
        pied={
          <BoutonPrincipal
            theme={theme}
            titre="Enregistrer la fin d’accès"
            desactive={!dateOk(expiration)}
            testID="admin-expiration-enregistrer"
            onPress={() => {
              fermer();
              outils.modifierProfils(liste => definirExpirationPar(outils.acteur, liste, profil.id, expiration ? `${expiration}T23:59:59.000Z` : undefined), [
                { type: 'compte', ...cibleJournal, action: expiration ? `Fin d’accès de ${profil.nom} fixée au ${expiration}` : `Fin d’accès de ${profil.nom} retirée` },
              ]);
            }}
          />
        }>
        <ChampMobile theme={theme} etiquette="Date (AAAA-MM-JJ)" value={expiration} onChangeText={setExpiration} maxLength={10} placeholder="2026-12-31" inputMode="numeric" erreur={dateOk(expiration) ? undefined : 'Format attendu : AAAA-MM-JJ.'} testID="admin-expiration" />
      </FeuilleBasse>

      <FeuilleBasse theme={theme} visible={feuille === 'suspension'} titre="Suspendre le compte" description={`${profil.nom} ne pourra plus ouvrir son compte pendant la durée choisie. Réversible à tout moment.`} onFermer={fermer} testID="admin-feuille-suspension"
        pied={
          <BoutonPrincipal
            theme={theme}
            titre={`Suspendre ${suspension || '0'} jour${Number(suspension) > 1 ? 's' : ''}`}
            desactive={!Number(suspension)}
            testID="admin-suspendre"
            onPress={() => {
              fermer();
              outils.modifierProfils(liste => suspendrePar(outils.acteur, liste, profil.id, dansJours(outils.maintenant(), Number(suspension)), outils.maintenant()), [{ type: 'compte', ...cibleJournal, action: `Compte de ${profil.nom} suspendu ${suspension} jours` }]);
            }}
          />
        }>
        <ChampMobile theme={theme} etiquette="Durée (jours)" nature="nombre" value={suspension} onChangeText={v => setSuspension(v.replace(/[^\d]/g, ''))} maxLength={3} testID="admin-suspension-jours" />
      </FeuilleBasse>

      <FeuilleConfirmation theme={theme} visible={feuille === 'desactiver'} titre={`Désactiver ${profil.nom} ?`} description={`${profil.nom} ne pourra plus ouvrir son compte tant que vous ne l’aurez pas réactivé.`} libelleAction="Désactiver" testID="admin-confirmation-desactiver" testIDAction="admin-desactiver-confirmer" onFermer={fermer}
        onConfirmer={() => {
          fermer();
          outils.modifierProfils(liste => desactiverPar(outils.acteur, liste, profil.id), [{ type: 'compte', ...cibleJournal, action: `Compte de ${profil.nom} désactivé` }], `${profil.nom} ne peut plus ouvrir son compte.`);
        }}
      />
      <FeuilleConfirmation theme={theme} visible={feuille === 'annulerInvitation'} titre="Annuler l’invitation ?" description={`${profil.nom} ne pourra plus utiliser son invitation.`} libelleAction="Annuler l’invitation" testID="admin-confirmation-invitation" testIDAction="admin-invitation-annuler-confirmer" onFermer={fermer}
        onConfirmer={() => {
          fermer();
          outils.modifierProfils(liste => annulerInvitationPar(outils.acteur, liste, profil.id, outils.maintenant()), [{ type: 'invitation', ...cibleJournal, action: `Invitation de ${profil.nom} annulée` }]);
        }}
      />
      <FeuilleConfirmation theme={theme} visible={feuille === 'regenererCode'} titre="Régénérer le code ?" description="Le code d’accès actuel ne fonctionnera plus. Un nouveau code sera affiché après vérification de votre identité." libelleAction="Régénérer le code" danger={false} testID="admin-confirmation-code" testIDAction="admin-code-regenerer-confirmer" onFermer={fermer}
        onConfirmer={() => { fermer(); regenererCode(); }}
      />
      <FeuilleConfirmation theme={theme} visible={feuille === 'revoquer'} titre={`Révoquer l’accès à ${profil.nom} ?`} description="Le code d’accès et l’enveloppe de séquestre sont effacés : vous ne pourrez plus ouvrir ce compte tant que l’accès n’est pas rétabli." libelleAction="Révoquer l’accès" testID="admin-confirmation-revoquer" testIDAction="admin-code-revoquer-confirmer" onFermer={fermer}
        onConfirmer={() => { fermer(); revoquer(); }}
      />
      <FeuilleConfirmation theme={theme} visible={feuille === 'regenerer'} titre="Régénérer les identifiants" description={`De nouveaux identifiants remplacent les anciens. Le portefeuille actuel de ${profil.nom} est scellé par l’ancienne clé : il sera effacé. (S’il a seulement oublié son mot de passe, il peut utiliser « Mot de passe oublié ? » avec un code de récupération.)`} mot={profil.nom} libelleAction="Régénérer" onFermer={fermer}
        onConfirmer={() => { fermer(); regenerer(); }}
      />
      <FeuilleConfirmation theme={theme} visible={feuille === 'supprimer'} titre={`Supprimer ${profil.nom} ?`} description={`Le compte de ${profil.nom}, son coffre, son portefeuille et son séquestre seront effacés de cet appareil. C’est définitif.`} mot={profil.nom} libelleAction="Supprimer définitivement" onFermer={fermer}
        onConfirmer={() => { fermer(); supprimer(); }}
        enfants={
          outils.services?.enregistrerFichier ? (
            <BoutonPrincipal
              theme={theme}
              variante="discret"
              titre="Télécharger un récapitulatif"
              testID="admin-recapitulatif"
              onPress={() =>
                outils.agir('Export…', async () => {
                  const fait = await outils.services!.enregistrerFichier!(`recapitulatif-${profil.id}.txt`, recapitulatif(profil, registre, outils.maintenant()), 'text/plain;charset=utf-8');
                  if (fait) outils.journaliser({ type: 'export', ...cibleJournal, action: `Récapitulatif du compte de ${profil.nom} exporté` });
                })
              }
            />
          ) : undefined
        }
      />

      <FeuilleBasse theme={theme} visible={feuille === 'rang'} titre="Changer le rang" description={`Rang actuel de ${profil.nom} : ${LIBELLES_RANG[rang]}`} onFermer={() => { fermer(); setRangChoisi(undefined); }} testID="admin-rang-confirmation"
        pied={
          <>
            <BoutonPrincipal theme={theme} titre="Confirmer (mot de passe + code)" desactive={Boolean(outils.enCours) || !rangChoisi || (rangChoisi === 'fondateur' && saisieRang.trim() !== profil.nom)} testID="admin-rang-confirmer" onPress={confirmerRang} />
            <BoutonPrincipal theme={theme} variante="discret" titre="Annuler" testID="admin-rang-annuler" onPress={() => { fermer(); setRangChoisi(undefined); }} />
          </>
        }>
        <GroupeCellules theme={theme} titre="Nouveau rang">
          {attribuables.map(r => (
            <Cellule key={r} theme={theme} titre={LIBELLES_RANG[r]} coche={r === rangChoisi} testID={`admin-rang-choix-${r}`} onPress={() => { setRangChoisi(r); setSaisieRang(''); }} />
          ))}
        </GroupeCellules>
        {rangChoisi ? (
          <View style={{ gap: ESPACE.xs }}>
            <Text style={{ color: theme.texte, fontSize: TEXTE.corps, fontWeight: '700', lineHeight: 24, ...police(theme.policeTexte) }}>
              {NIVEAU_RANG[rangChoisi] > NIVEAU_RANG[rang] ? 'Promouvoir' : 'Rétrograder'} {profil.nom} : {LIBELLES_RANG[rang]} → {LIBELLES_RANG[rangChoisi]} ?
            </Text>
            <Text style={{ color: theme.texte, fontSize: TEXTE.legende, fontWeight: '600', ...police(theme.policeTexte) }}>Il·elle pourra :</Text>
            {CE_QUE_PERMET[rangChoisi].map(ligne => (
              <Text key={ligne} style={{ color: theme.texte, fontSize: TEXTE.legende, lineHeight: 22, ...police(theme.policeTexte) }}>• {ligne}</Text>
            ))}
            {CE_QUE_NE_PERMET_PAS[rangChoisi].length > 0 ? <Text style={{ color: theme.texte, fontSize: TEXTE.legende, fontWeight: '600', ...police(theme.policeTexte) }}>Il·elle ne pourra jamais :</Text> : null}
            {CE_QUE_NE_PERMET_PAS[rangChoisi].map(ligne => (
              <Text key={ligne} style={{ color: theme.texte, fontSize: TEXTE.legende, lineHeight: 22, ...police(theme.policeTexte) }}>• {ligne}</Text>
            ))}
            <Text style={{ color: theme.attenue, fontSize: TEXTE.legende, lineHeight: 22, ...police(theme.policeTexte) }} testID="admin-rang-sequestre">
              {rangChoisi === 'administrateur'
                ? `Séquestre : une paire de clés est créée pour ${profil.nom} (scellée par SA clé), puis la clé de chaque Gestionnaire et Ami est re-scellée pour lui·elle, avec ses propres codes d’accès. Son compte reste scellé pour les Fondateurs seulement.`
                : rangChoisi === 'fondateur'
                  ? `Séquestre : ${profil.nom} reçoit les clés des Administrateurs, Gestionnaires et Amis, et le registre des Fondateurs. Son propre compte ne sera plus scellé pour personne — vous ne pourrez plus l’ouvrir, ni le rétrograder.`
                  : rang === 'administrateur'
                    ? `Séquestre : tous les dépôts de ${profil.nom} et sa paire de clés sont supprimés, ainsi que sa délégation sur le relais. Ce qu’il·elle a déjà pu lire ne peut pas être « désappris » : si besoin, régénérez les identifiants des comptes concernés.`
                    : 'Aucune clé n’est touchée : ce rang n’ouvre aucun compte.'}
            </Text>
            {rangChoisi === 'fondateur' ? <ChampMobile theme={theme} etiquette={`Confirmation forte : saisissez « ${profil.nom} »`} value={saisieRang} onChangeText={setSaisieRang} autoCapitalize="none" testID="admin-rang-saisie" /> : null}
          </View>
        ) : null}
      </FeuilleBasse>

      <FeuilleBasse theme={theme} visible={feuille === 'code' && Boolean(code)} titre={`Code d’accès de ${profil.nom}`} onFermer={fermer} testID="admin-feuille-code"
        pied={<BoutonPrincipal theme={theme} titre="Terminé" onPress={fermer} testID="admin-feuille-code-termine" />}>
        <View style={{ padding: ESPACE.m, borderRadius: rayonCarte(theme), backgroundColor: teinteTransparente(theme.teintes.admin, 0.12), borderWidth: 1, borderColor: theme.teintes.admin }}>
          <Text selectable testID="admin-code-acces" style={{ color: theme.texte, fontSize: 20, letterSpacing: 1.5, lineHeight: 30, ...police(theme.policeChiffres) }}>
            {code?.code}
          </Text>
        </View>
        <Aide theme={theme}>Code créé le {dateLisible(code?.creeLe, true)}. Il reste affichable ici (après vérification de votre identité). Chaque accès est journalisé.</Aide>
      </FeuilleBasse>

      <FeuilleBasse theme={theme} visible={feuille === 'codeSite' && Boolean(codeSite)} titre="Code de connexion au site" onFermer={fermer} testID="admin-feuille-code-site"
        pied={<BoutonPrincipal theme={theme} titre="Terminé" onPress={fermer} testID="admin-feuille-code-site-termine" />}>
        <View style={{ padding: ESPACE.m, borderRadius: rayonCarte(theme), backgroundColor: teinteTransparente(theme.teintes.admin, 0.12), borderWidth: 1, borderColor: theme.teintes.admin, gap: ESPACE.xs }}>
          <Text selectable testID="admin-code-site" style={{ color: theme.texte, fontSize: TEXTE.legende, lineHeight: 22, ...police(theme.policeChiffres) }}>
            {codeSite?.code}
          </Text>
          {codeSite?.lien ? (
            <Text selectable testID="admin-lien-site" style={{ color: theme.attenue, fontSize: TEXTE.legende, lineHeight: 22, ...police(theme.policeTexte) }}>
              Lien direct : {codeSite.lien}
            </Text>
          ) : null}
        </View>
        <Aide theme={theme}>À transmettre à {profil.nom} seul·e, par un canal privé. Il saisit ce code une fois sur son navigateur, puis se connecte avec son prénom, son mot de passe et son code.</Aide>
      </FeuilleBasse>

      <FeuilleBasse theme={theme} visible={feuille === 'ouvrir'} titre={`Ouvrir le compte de ${profil.nom}`} onFermer={fermer} testID="admin-feuille-ouvrir"
        pied={
          <BoutonPrincipal
            theme={theme}
            titre={`Ouvrir le compte de ${profil.nom}`}
            desactive={codeSaisi.replace(/[^A-Za-z0-9]/g, '').length < 16}
            testID="admin-ouvrir-confirmer"
            onPress={() => {
              fermer();
              ouvrirCompte();
            }}
          />
        }>
        <ChampMobile theme={theme} etiquette="Code d’accès du compte" nature="codeRecuperation" value={codeSaisi} onChangeText={setCodeSaisi} placeholder="XXXX-XXXX-XXXX-XXXX" maxLength={24} testID="admin-ouvrir-code" />
        {code ? <Cellule theme={theme} titre="Utiliser le code affiché" chevron testID="admin-ouvrir-code-affiche" onPress={() => setCodeSaisi(code.code)} /> : null}
        <Aide theme={theme}>Votre session se ferme ; un bandeau « Session de {outils.acteur.nom} ({LIBELLES_RANG[outils.role]}) » reste affiché sur le compte de {profil.nom}.</Aide>
      </FeuilleBasse>
    </CadreAdmin>
  );
}

// --- Création ---------------------------------------------------------------------------

function Creation({ outils, apps, onRetour, onCree }: { outils: OutilsAdmin; apps: AppHub[]; onRetour(): void; onCree(nom: string, valeurs: IdentifiantsAmi): void }) {
  const { theme, controle, registre } = outils;
  const [nom, setNom] = useState('');
  const [niveaux, setNiveaux] = useState<Niveaux>(() => Object.fromEntries(apps.map(a => [a.id, etatApp(outils.politique, a.id).defaut])));
  const [invitation, setInvitation] = useState(String(outils.donnees.reglages.invitationJours));
  const [expiration, setExpiration] = useState('');
  const [informe, setInforme] = useState(false);
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
    <CadreAdmin
      theme={theme}
      titre="Nouvel utilisateur"
      libelleRetour="Utilisateurs"
      onRetour={onRetour}
      testID="admin-creation"
      pied={<BoutonPrincipal theme={theme} titre="Créer et afficher les identifiants" desactive={Boolean(outils.enCours) || !nom.trim() || !informe || !dateOk(expiration) || !controle.onCreerCompte} enCours={Boolean(outils.enCours)} onPress={creer} testID="admin-creer" />}>
      <ChampMobile theme={theme} etiquette="Prénom de l’ami (il s’en servira pour se connecter)" nature="prenom" value={nom} onChangeText={setNom} placeholder="ex. Lucas" maxLength={30} testID="admin-nom" />
      <GroupeCellules theme={theme} titre="Permissions">
        <CelluleChoix
          theme={theme}
          titre="Modèle"
          options={MODELES.map(m => ({ cle: m.id, titre: m.nom }))}
          valeur={modeleCorrespondant(apps, niveaux)}
          testID="admin-nouveau-modele"
          onChoisir={id => id !== 'personnalise' && setNiveaux(niveauxDuModele(apps, id as IdModele))}
        />
        {apps.map(a => (
          <CelluleChoix
            key={a.id}
            theme={theme}
            titre={`${a.icone}  ${a.nom}`}
            options={niveauxDe(a).map(n => ({ cle: n, titre: LIBELLES_NIVEAU[n] }))}
            valeur={niveaux[a.id] ?? 'aucun'}
            testID={`admin-nouveau-app-${a.id}`}
            onChoisir={n => setNiveaux(v => ({ ...v, [a.id]: n as Niveaux[string] }))}
          />
        ))}
      </GroupeCellules>
      <ChampMobile theme={theme} etiquette="Invitation valable (jours, 0 : sans limite)" nature="nombre" value={invitation} onChangeText={v => setInvitation(v.replace(/[^\d]/g, ''))} maxLength={3} testID="admin-nouveau-invitation" />
      <ChampMobile theme={theme} etiquette="Fin d’accès (AAAA-MM-JJ, facultatif)" value={expiration} onChangeText={setExpiration} maxLength={10} inputMode="numeric" erreur={dateOk(expiration) ? undefined : 'Format attendu : AAAA-MM-JJ.'} testID="admin-nouveau-expiration" />
      <View testID="admin-avertissement-transparence" style={{ gap: ESPACE.xs }}>
        <Avis theme={theme} genre="alerte" texte="⚠️ Les administrateurs et fondateurs peuvent accéder à ce compte. Une copie de la clé du compte est mise sous séquestre pour chaque Administrateur et Fondateur : avec SON code d’accès, chacun pourra l’ouvrir sans son mot de passe. L’ami en est averti dans ses Paramètres, et chaque accès est inscrit au journal. Dites-le lui en lui remettant ses identifiants." />
        <GroupeCellules theme={theme}>
          <Cellule theme={theme} titre="J’informerai l’ami que les administrateurs et fondateurs peuvent accéder à son compte" testID="admin-nouveau-informe" interrupteur={{ valeur: informe, onChanger: setInforme }} />
        </GroupeCellules>
      </View>
      <Aide theme={theme}>Un mot de passe, une clé d’authentification (TOTP) et des codes de récupération seront générés et affichés une seule fois.</Aide>
    </CadreAdmin>
  );
}

// --- Identifiants (affichage unique) ---------------------------------------------------------

function Identifiants({ outils, nom, valeurs, onTermine }: { outils: OutilsAdmin; nom: string; valeurs: IdentifiantsAmi; onTermine(): void }) {
  const { theme } = outils;
  const [transmis, setTransmis] = useState(false);
  const mono = police(theme.policeChiffres);
  const ligne = (etiquette: string, valeur: string, testID?: string) => (
    <View style={{ gap: 2 }}>
      <Text style={{ color: theme.sombre ? '#555' : '#AAA', fontSize: TEXTE.legende, fontWeight: '600', ...police(theme.policeTexte) }}>{etiquette}</Text>
      <Text selectable testID={testID} style={{ color: theme.fond, fontSize: 18, lineHeight: 26, ...mono }}>
        {valeur}
      </Text>
    </View>
  );
  return (
    <CadreAdmin
      theme={theme}
      titre={`Identifiants de ${nom}`}
      libelleRetour=""
      testID="admin-identifiants"
      pied={<BoutonPrincipal theme={theme} titre="Terminé" desactive={!transmis} onPress={onTermine} testID="admin-termine" />}>
      <Avis theme={theme} genre="alerte" texte={`Affichés une seule fois : ils ne sont conservés nulle part en clair. Transmettez-les à ${nom} de vive voix ou sur papier, puis ne les gardez pas.`} />
      <View style={{ padding: ESPACE.m, gap: ESPACE.s, backgroundColor: theme.texte, borderRadius: rayonCarte(theme) }}>
        {ligne('Prénom', nom)}
        {ligne('Mot de passe', valeurs.motDePasse, 'admin-mot-de-passe')}
        {ligne('Clé TOTP', valeurs.secretTotp, 'admin-secret-totp')}
      </View>
      <Aide theme={theme}>Clé à saisir (ou QR code à scanner) dans son application d’authentification : le code à 6 chiffres est demandé à chaque ouverture, avec le mot de passe.</Aide>
      <View style={{ alignItems: 'center' }}>
        <QrCode texte={valeurs.uriTotp} legende={`AppDashboard · ${nom}`} testID="admin-qr-totp" />
      </View>
      <GroupeCellules theme={theme} titre="Codes de récupération">
        {valeurs.codesRecuperation.map(valeur => (
          <View key={valeur} style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: ESPACE.m }}>
            <Text selectable style={{ color: theme.texte, fontSize: 18, letterSpacing: 1, ...mono }}>
              {valeur}
            </Text>
          </View>
        ))}
      </GroupeCellules>
      <Avis theme={theme} genre="info" texte={`À dire à ${nom} : « Les administrateurs et fondateurs peuvent accéder à ton compte. Chaque accès est journalisé et tu le verras dans tes Paramètres. Pour te connecter, saisis ton prénom. »`} />
      <GroupeCellules theme={theme}>
        <Cellule theme={theme} titre="J’ai transmis ces identifiants (et l’avertissement)" testID="admin-transmis" interrupteur={{ valeur: transmis, onChanger: setTransmis }} />
      </GroupeCellules>
    </CadreAdmin>
  );
}
