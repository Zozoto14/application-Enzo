/**
 * Administration, version téléphone. La logique (comptes, verrou, vérification d'identité, journal)
 * reste celle de `Administration.tsx` ; seule la mise en page change :
 *
 *  - accueil = liste de cellules (une par section) au lieu d'une barre d'onglets ;
 *  - chaque section est une sous-page avec « ‹ Administration » et le balayage depuis le bord gauche ;
 *  - messages (erreur, avis, opération en cours) en bandeau fixe sous l'en-tête, toujours visibles ;
 *  - vérification d'identité (mot de passe + code) dans une feuille basse.
 */

import React from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  BoutonPrincipal,
  Cellule,
  ChampMobile,
  EcranMobile,
  EnTeteMobile,
  ESPACE,
  FeuilleBasse,
  GroupeCellules,
  TEXTE,
  margesSecurite,
  useNavigationMobile,
} from '../ui/mobile';
import { IndicateurSynchro } from './IndicateurSynchro';
import { alertesComptes } from './admin/comptes';
import { LIBELLES_ROLE } from './admin/roles';
import { dateDuJour, lignesAbo, resumeRappels } from './abonnements/abonnements';
import { comptesSuivis, peutVoirAbonnements } from './abonnements/actionsAbo';
import { Abonnements } from './admin/ui/mobile/AbonnementsMobile';
import { Applications } from './admin/ui/mobile/ApplicationsMobile';
import { Avis, type IdSection, type OutilsAdmin } from './admin/ui/commun';
import { Journal } from './admin/ui/mobile/JournalMobile';
import { Reglages } from './admin/ui/mobile/ReglagesMobile';
import { Securite } from './admin/ui/mobile/SecuriteMobile';
import { Tableau } from './admin/ui/mobile/TableauMobile';
import { Utilisateurs } from './admin/ui/mobile/UtilisateursMobile';
import { alertesSecurite } from './admin/ui/Securite';
import { police, type ThemeHub } from './themes';

const SECTIONS: ReadonlyArray<readonly [IdSection, string, string]> = [
  ['tableau', '◧', 'Tableau de bord'],
  ['utilisateurs', '👥', 'Utilisateurs'],
  ['applications', '▦', 'Applications'],
  ['abonnements', '💳', 'Abonnements'],
  ['securite', '🛡', 'Sécurité'],
  ['journal', '☰', 'Journal d’audit'],
  ['reglages', '⚙', 'Réglages'],
];

/** Groupes de la liste d'accueil. */
const GROUPES: ReadonlyArray<{ titre?: string; ids: readonly IdSection[] }> = [
  { ids: ['tableau'] },
  { titre: 'Gestion', ids: ['utilisateurs', 'applications', 'abonnements'] },
  { titre: 'Surveillance', ids: ['securite', 'journal'] },
  { ids: ['reglages'] },
];

export interface PropsAdminMobile {
  theme: ThemeHub;
  outils: OutilsAdmin;
  sectionsPermises: readonly IdSection[];
  section?: IdSection;
  cible?: string;
  estGestionnaire: boolean;
  enCours?: string;
  erreur?: string;
  avis?: string;
  demande?: { raison: string; action: () => void };
  onRetourHub(): void;
  onOuvrirSection(id: IdSection): void;
  onRetourSection(): void;
  onFermerMessages(): void;
  onAnnulerDemande(): void;
  onValiderIdentite(motDePasse: string, code: string, raison: string, suite: () => void): void;
  onVerrouiller(): void;
}

export function AdministrationMobile(props: PropsAdminMobile) {
  const { theme, section, sectionsPermises } = props;
  return (
    <View style={{ flex: 1, backgroundColor: theme.fond }} testID="app-administration">
      {section && sectionsPermises.includes(section) ? <SectionMobile {...props} section={section} /> : <Accueil {...props} />}
      <Messages {...props} />
      {props.demande ? (
        <FeuilleIdentite
          theme={theme}
          raison={props.demande.raison}
          enCours={Boolean(props.enCours)}
          onAnnuler={props.onAnnulerDemande}
          onValider={(m, c) => props.onValiderIdentite(m, c, props.demande!.raison, props.demande!.action)}
        />
      ) : null}
    </View>
  );
}

function SectionMobile({ outils, section, cible, onRetourSection, onVerrouiller }: PropsAdminMobile & { section: IdSection }) {
  switch (section) {
    case 'tableau':
      return <Tableau outils={outils} onRetour={onRetourSection} />;
    case 'utilisateurs':
      return <Utilisateurs key={cible ?? 'liste'} outils={outils} cible={cible} onRetour={onRetourSection} />;
    case 'applications':
      return <Applications outils={outils} onRetour={onRetourSection} />;
    case 'abonnements':
      return <Abonnements outils={outils} onRetour={onRetourSection} />;
    case 'securite':
      return <Securite outils={outils} onRetour={onRetourSection} onVerrouiller={onVerrouiller} />;
    case 'journal':
      return <Journal outils={outils} onRetour={onRetourSection} />;
    default:
      return <Reglages outils={outils} onRetour={onRetourSection} />;
  }
}

/** Liste d'accueil : rang, bandeaux d'information, une cellule par section. */
function Accueil({ theme, outils, sectionsPermises, estGestionnaire, onRetourHub, onOuvrirSection }: PropsAdminMobile) {
  const nav = useNavigationMobile();
  const { role, controle, tous, donnees } = outils;
  const maintenant = outils.maintenant();
  const alertes = [...(estGestionnaire ? [] : alertesSecurite(outils)), ...alertesComptes(tous, maintenant, donnees.reglages.inactifJours)];
  const resumeAbo = peutVoirAbonnements(outils.acteur) ? resumeRappels(lignesAbo(comptesSuivis(outils.acteur, tous), donnees.abonnements, dateDuJour(maintenant))) : undefined;
  const valeurs: Partial<Record<IdSection, string>> = {
    tableau: alertes.length > 0 ? `${alertes.length} alerte${alertes.length > 1 ? 's' : ''}` : 'Tout va bien',
    utilisateurs: String(tous.length),
    applications: `${outils.registre.length} apps`,
    abonnements: resumeAbo && resumeAbo.retard > 0 ? `${resumeAbo.retard} en retard` : undefined,
    journal: String(donnees.journal.length),
  };
  const sousTitres: Partial<Record<IdSection, string>> = {
    tableau: 'Chiffres clés, alertes, activité',
    utilisateurs: estGestionnaire ? 'Les amis que vous gérez' : 'Comptes, rangs, accès aux apps',
    applications: 'Activer ou mettre en maintenance',
    abonnements: 'Qui a payé, échéances, rappels',
    securite: 'Coffre, mot de passe, verrouillage',
    journal: 'Qui a fait quoi, filtres, export',
    reglages: 'Délais et paramètres du panneau',
  };
  const lead = estGestionnaire
    ? 'Administration limitée : les amis que vous avez créés, leurs accès aux apps et le journal de vos actions.'
    : role === 'administrateur'
      ? 'Comptes des Gestionnaires et des Amis, séquestre avec vos propres codes d’accès, sécurité et journal.'
      : 'Comptes, rangs, accès aux apps, sécurité et journal de ce hub.';
  return (
    <EcranMobile
      theme={theme}
      testID="admin-accueil"
      onRetour={onRetourHub}
      entete={
        <EnTeteMobile
          theme={theme}
          titre="Administration"
          onRetour={onRetourHub}
          libelleRetour="Accueil"
          testIDRetour="retour-hub"
          droite={nav?.synchro ? <IndicateurSynchro theme={theme} synchro={nav.synchro} condense onPress={() => nav.onParametres()} /> : undefined}
          actions={nav ? [{ titre: '⚙︎', libelle: 'Paramètres', onPress: nav.onParametres, testID: 'app-parametres-ouvrir' }] : undefined}
        />
      }>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESPACE.xs, flexWrap: 'wrap' }}>
        <Text style={{ color: theme.attenue, fontSize: TEXTE.legende, ...police(theme.policeTexte) }}>Votre rang :</Text>
        <View testID="admin-mon-rang" style={{ paddingVertical: 4, paddingHorizontal: 12, borderRadius: 999, backgroundColor: theme.teintes.admin }}>
          <Text style={{ color: theme.surAccent, fontWeight: '700', fontSize: TEXTE.legende, ...police(theme.policeTexte) }}>{LIBELLES_ROLE[role]}</Text>
        </View>
      </View>
      <Text style={{ color: theme.attenue, fontSize: TEXTE.corps, lineHeight: 24, ...police(theme.policeTexte) }}>{lead}</Text>
      {estGestionnaire ? (
        <Avis theme={theme} genre="info" texte={`Vous êtes connecté·e en tant que ${LIBELLES_ROLE.gestionnaire.toLowerCase()}. Vous ne pouvez ouvrir le compte de personne, et les autres comptes ne vous sont pas montrés.`} testID="admin-bandeau-gestionnaire" />
      ) : role === 'administrateur' ? (
        <Avis
          theme={theme}
          genre="info"
          texte={`Vous êtes Administrateur : vous gérez les Gestionnaires et les Amis, et pouvez ouvrir leur compte avec VOS codes d’accès (chaque accès est journalisé). Les Fondateurs et les autres Administrateurs ne vous sont pas montrés.${controle.restreint ? ' Sur ce navigateur : création, suppression et changement de rang se font depuis le PC.' : ''}`}
          testID="admin-bandeau-administrateur"
        />
      ) : controle.restreint ? (
        <Avis theme={theme} genre="info" texte="Sur ce navigateur : création, suppression et changement de rang se font depuis le PC (annuaire complet)." testID="admin-bandeau-restreint" />
      ) : null}
      {GROUPES.map((groupe, rang) => {
        const ids = groupe.ids.filter(id => sectionsPermises.includes(id));
        if (ids.length === 0) {
          return null;
        }
        return (
          <GroupeCellules key={rang} theme={theme} titre={groupe.titre}>
            {ids.map(id => {
              const [, icone, libelle] = SECTIONS.find(s => s[0] === id)!;
              const grave = id === 'tableau' && alertes.some(a => a.gravite === 'critique');
              return (
                <Cellule
                  key={id}
                  theme={theme}
                  glyphe={icone}
                  teinte={grave ? theme.critique : theme.teintes.admin}
                  titre={libelle}
                  sousTitre={sousTitres[id]}
                  valeur={valeurs[id]}
                  chevron
                  testID={`admin-onglet-${id}`}
                  onPress={() => onOuvrirSection(id)}
                />
              );
            })}
          </GroupeCellules>
        );
      })}
      <Text style={{ color: theme.attenue, fontSize: TEXTE.legende, lineHeight: 22, ...police(theme.policeTexte) }}>
        Aucun secret n’est conservé ni journalisé : mots de passe, clés et codes de récupération ne s’affichent qu’une fois.
      </Text>
    </EcranMobile>
  );
}

/** Erreur, avis et opération en cours : bandeau fixe sous l'en-tête, qu'on referme d'un toucher. */
function Messages({ theme, enCours, erreur, avis, onFermerMessages }: PropsAdminMobile) {
  if (!enCours && !erreur && !avis) {
    return null;
  }
  return (
    <View pointerEvents="box-none" style={[{ position: 'absolute', left: 0, right: 0, top: 0, zIndex: 20 }, margesSecurite(['haut'], { haut: 0 })]}>
      <View pointerEvents="box-none" style={{ marginTop: 56, paddingHorizontal: 16, gap: 8 }}>
        {enCours ? (
          <Text accessibilityLiveRegion="polite" style={{ color: theme.texte, backgroundColor: theme.surface, borderColor: theme.ligne, borderWidth: 1, borderRadius: 12, padding: 12, fontSize: TEXTE.legende, overflow: 'hidden', ...police(theme.policeTexte) }}>
            {enCours}
          </Text>
        ) : null}
        {erreur ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Fermer le message d’erreur" onPress={onFermerMessages} style={{ backgroundColor: theme.fond, borderRadius: 8 }}>
            <Avis theme={theme} genre="critique" texte={erreur} testID="admin-erreur" />
          </Pressable>
        ) : null}
        {avis ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Fermer le message" onPress={onFermerMessages} style={{ backgroundColor: theme.fond, borderRadius: 8 }}>
            <Avis theme={theme} genre="ok" texte={avis} testID="admin-avis" />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** Vérification d'identité (mot de passe + code à 6 chiffres) dans une feuille basse. */
export function FeuilleIdentite({ theme, raison, enCours, onValider, onAnnuler }: { theme: ThemeHub; raison: string; enCours: boolean; onValider(motDePasse: string, code: string): void; onAnnuler?(): void }) {
  const [motDePasse, setMotDePasse] = React.useState('');
  const [code, setCode] = React.useState('');
  const valider = () => {
    if (!motDePasse || code.length !== 6 || enCours) {
      return;
    }
    onValider(motDePasse, code);
    setMotDePasse('');
    setCode('');
  };
  return (
    <FeuilleBasse
      theme={theme}
      visible
      titre="Vérification d’identité"
      description={`${raison} : saisissez votre mot de passe et le code de votre application d’authentification.`}
      onFermer={onAnnuler ?? (() => undefined)}
      testID="admin-identite"
      pied={
        <>
          <BoutonPrincipal theme={theme} titre={enCours ? 'Vérification…' : 'Confirmer'} enCours={enCours} desactive={!motDePasse || code.length !== 6} onPress={valider} testID="admin-identite-valider" />
          {onAnnuler ? <BoutonPrincipal theme={theme} variante="discret" titre="Annuler" onPress={onAnnuler} testID="admin-identite-annuler" /> : null}
        </>
      }>
      <ChampMobile theme={theme} etiquette="Mot de passe" nature="motDePasse" value={motDePasse} onChangeText={setMotDePasse} testID="admin-identite-mdp" />
      <ChampMobile theme={theme} etiquette="Code à 6 chiffres" nature="codeTotp" value={code} onChangeText={v => setCode(v.replace(/[^\d]/g, ''))} onSubmitEditing={valider} testID="admin-identite-code" />
    </FeuilleBasse>
  );
}
