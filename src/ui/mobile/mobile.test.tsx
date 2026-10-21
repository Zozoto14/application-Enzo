/**
 * Mode téléphone : détection, jetons, préréglages clavier, gestes, composants (rendu, rôles, libellés),
 * navigation basse, et absence de régression du bureau (le mode « large » rend l'affichage d'avant).
 */

import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Hub } from '../../hub/Hub';
import { colonnesMobile } from '../../hub/HubMobile';
import { libelleCondense } from '../../hub/IndicateurSynchro';
import { PageParametres } from '../../hub/PageParametres';
import { groupesSections } from '../../hub/PageParametresMobile';
import { PageSupport } from '../../hub/PageSupport';
import { REGLAGES, SECTIONS, type IdReglage } from '../../hub/recensement';
import { themeHub } from '../../hub/themes';
import type { AppHub } from '../../hub/types';
import { reinitialiser } from '../../hub/personnalisation';
import { entreesBarreApp } from '../Navigation';
import { BarreOnglets } from './BarreOnglets';
import { BoutonPrincipal } from './BoutonPrincipal';
import { ChampMobile, prereglagesClavier } from './ChampMobile';
import { POINTS_RUPTURE, estTelephone, forcerModeAffichage, modeForce } from './detection';
import { EnTeteMobile } from './EnTeteMobile';
import { FeuilleBasse } from './FeuilleBasse';
import { estBalayageRetour } from './gestes';
import { CONTROLE, TEXTE, tailleTexte } from './jetons';
import { Cellule, GroupeCellules } from './ListeCellules';
import { BarreBasseHub, NavigationMobileContexte, entreesBarreHub, type NavigationMobile } from './NavigationMobile';
import { SectionRepliable } from './SectionRepliable';
import { margesSecurite } from './ZoneSecurite';

const theme = themeHub('nuit');
const synchroAttente = { vue: { enCours: false, enLigne: true, enAttente: { cles: ['a', 'b'], essais: 0 } }, onSynchroniser: () => undefined } as never;

describe('détection du mode téléphone', () => {
  it('une fenêtre de moins de 768 px est un téléphone, partout', () => {
    expect(POINTS_RUPTURE.telephone).toBe(768);
    expect(estTelephone({ largeur: 390, hauteur: 844, os: 'web' })).toBe(true);
    expect(estTelephone({ largeur: 375, hauteur: 667, os: 'ios' })).toBe(true);
    expect(estTelephone({ largeur: 767, hauteur: 900, os: 'web' })).toBe(true);
  });

  it('l’app native en portrait est un téléphone (iPad compris), la tablette en paysage et le PC non', () => {
    expect(estTelephone({ largeur: 820, hauteur: 1180, os: 'ios' })).toBe(true);
    expect(estTelephone({ largeur: 1180, hauteur: 820, os: 'ios' })).toBe(false);
    expect(estTelephone({ largeur: 820, hauteur: 1180, os: 'web' })).toBe(false);
    expect(estTelephone({ largeur: 1280, hauteur: 800, os: 'web' })).toBe(false);
  });

  it('le mode peut être forcé (tests) ; jest.setup.js force « large » par défaut', () => {
    expect(modeForce()).toBe('large');
    forcerModeAffichage('telephone');
    expect(modeForce()).toBe('telephone');
    forcerModeAffichage('large');
  });
});

describe('jetons et règles pures', () => {
  it('textes ≥ 15 px, champs ≥ 16 px, contrôles ≥ 44–48 px', () => {
    expect(TEXTE.legende).toBeGreaterThanOrEqual(15);
    expect(TEXTE.champ).toBeGreaterThanOrEqual(16);
    expect(CONTROLE.cible).toBeGreaterThanOrEqual(44);
    expect(CONTROLE.hauteur).toBeGreaterThanOrEqual(48);
    expect(tailleTexte(12, true)).toBe(15);
    expect(tailleTexte(12, false)).toBe(12);
    expect(tailleTexte(20, true)).toBe(20);
  });

  it('chaque nature de champ choisit le bon clavier et le bon remplissage automatique', () => {
    expect(prereglagesClavier('motDePasse')).toMatchObject({ secureTextEntry: true, autoComplete: 'current-password', textContentType: 'password' });
    expect(prereglagesClavier('nouveauMotDePasse')).toMatchObject({ autoComplete: 'new-password', textContentType: 'newPassword' });
    expect(prereglagesClavier('codeTotp')).toMatchObject({ inputMode: 'numeric', autoComplete: 'one-time-code', maxLength: 6, enterKeyHint: 'go' });
    expect(prereglagesClavier('recherche')).toMatchObject({ inputMode: 'search', enterKeyHint: 'search' });
    expect(prereglagesClavier('prenom')).toMatchObject({ autoComplete: 'given-name', autoCapitalize: 'words' });
    expect(prereglagesClavier('decimal')).toMatchObject({ inputMode: 'decimal' });
    for (const nature of ['texte', 'prenom', 'identifiant', 'motDePasse', 'codeTotp', 'codeLiaison', 'recherche', 'email', 'url', 'nombre', 'decimal'] as const) {
      expect(prereglagesClavier(nature).enterKeyHint).toBeTruthy();
    }
  });

  it('balayage retour : seulement depuis le bord gauche, vers la droite, assez loin', () => {
    expect(estBalayageRetour(10, 120, 10)).toBe(true);
    expect(estBalayageRetour(100, 120, 10)).toBe(false);
    expect(estBalayageRetour(10, 40, 0)).toBe(false);
    expect(estBalayageRetour(10, 120, 90)).toBe(false);
  });

  it('zones de sécurité : rien en natif (la racine les applique déjà)', () => {
    expect(margesSecurite(['haut', 'bas'], { bas: 12 })).toEqual({ paddingTop: 0, paddingBottom: 12 });
  });

  it('barre basse du hub : Accueil · Support · Réglages · Compte, pastille quand la synchro attend', () => {
    expect(entreesBarreHub({ onSupport: () => undefined }).map(e => e.cle)).toEqual(['accueil', 'support', 'parametres', 'compte']);
    expect(entreesBarreHub({}).map(e => e.cle)).toEqual(['accueil', 'parametres', 'compte']);
    // Rangs habilités : la page « Administration » du hub a sa propre entrée (5 au plus).
    expect(entreesBarreHub({ onSupport: () => undefined, onAdministration: () => undefined }).map(e => e.cle)).toEqual(['accueil', 'administration', 'support', 'parametres', 'compte']);
    expect(entreesBarreHub({ synchro: synchroAttente }).find(e => e.cle === 'compte')?.pastille).toBe('•');
  });

  it('barre basse d’une app : 4 sections principales au plus, le reste dans « Plus »', () => {
    const d = (cle: string, principale = false) => ({ cle, libelle: cle, glyphe: '·', principale });
    const { principales, autres } = entreesBarreApp([d('hub'), d('a', true), d('b'), d('c', true), d('d', true), d('e', true), d('f', true)]);
    expect(principales.map(x => x.cle)).toEqual(['a', 'c', 'd', 'e']);
    expect(autres.map(x => x.cle)).toEqual(['b', 'f']);
  });

  it('hub : 2 colonnes dès 340 px en grille, 1 en liste ; Paramètres regroupés', () => {
    expect(colonnesMobile(390, 'grille')).toBe(2);
    expect(colonnesMobile(320, 'grille')).toBe(1);
    expect(colonnesMobile(390, 'liste')).toBe(1);
    expect(groupesSections(SECTIONS).map(g => g.titre)).toEqual(['Compte et appareil', 'Apps', 'Aide']);
  });

  it('synchro condensée : un mot ou deux', () => {
    expect(libelleCondense({ niveau: 'ok', libelle: 'À jour · il y a 2 min' })).toBe('À jour');
    expect(libelleCondense({ niveau: 'attente', libelle: '2 éléments à envoyer' })).toBe('2 à envoyer');
    expect(libelleCondense({ niveau: 'attente', libelle: 'Hors ligne' })).toBe('Hors ligne');
    expect(libelleCondense({ niveau: 'erreur', libelle: 'Synchronisation impossible' })).toBe('Échec synchro');
  });
});

describe('composants du mode téléphone', () => {
  beforeEach(() => forcerModeAffichage('telephone'));
  afterEach(() => forcerModeAffichage('large'));

  it('BarreOnglets : rôle tablist, onglets annoncés, sélection et choix', async () => {
    const choix: string[] = [];
    await render(<BarreOnglets theme={theme} entrees={[{ cle: 'a', libelle: 'Accueil', glyphe: '⌂' }, { cle: 'b', libelle: 'Réglages', glyphe: '⚙' }]} actif="a" onChoisir={c => choix.push(c)} />);
    expect(screen.getByTestId('barre-basse').props.accessibilityRole).toBe('tablist');
    expect(screen.getByTestId('barre-basse-a').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('barre-basse-b').props.accessibilityState.selected).toBe(false);
    await fireEvent.press(screen.getByTestId('barre-basse-b'));
    expect(choix).toEqual(['b']);
  });

  it('FeuilleBasse : dialogue titré, se ferme par ✕ et par le voile ; rien quand elle est cachée', async () => {
    let fermee = 0;
    const { rerender } = await render(
      <FeuilleBasse theme={theme} visible titre="Compte" onFermer={() => fermee++}>
        <Text>contenu</Text>
      </FeuilleBasse>,
    );
    expect(screen.getByText('Compte')).toBeTruthy();
    expect(screen.getByText('contenu')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('feuille-basse-fermer'));
    // Le voile est masqué aux lecteurs d'écran (la feuille est modale) mais reste touchable.
    await fireEvent.press(screen.getByTestId('feuille-basse-voile', { includeHiddenElements: true }));
    expect(fermee).toBe(2);
    await rerender(
      <FeuilleBasse theme={theme} visible={false} titre="Compte" onFermer={() => fermee++}>
        <Text>contenu</Text>
      </FeuilleBasse>,
    );
    expect(screen.queryByText('contenu')).toBeNull();
  });

  it('Cellule : interrupteur (rôle switch, toute la ligne bascule), chevron (lien), coche (radio)', async () => {
    const valeurs: boolean[] = [];
    await render(
      <GroupeCellules theme={theme} titre="Groupe" note="Note">
        <Cellule theme={theme} titre="Option" interrupteur={{ valeur: false, onChanger: v => valeurs.push(v) }} testID="c-switch" />
        <Cellule theme={theme} titre="Ouvrir" chevron onPress={() => undefined} testID="c-lien" />
        <Cellule theme={theme} titre="Choix" coche onPress={() => undefined} testID="c-radio" />
      </GroupeCellules>,
    );
    expect(screen.getByTestId('c-switch').props.accessibilityRole).toBe('switch');
    await fireEvent.press(screen.getByTestId('c-switch'));
    expect(valeurs).toEqual([true]);
    expect(screen.getByTestId('c-lien').props.accessibilityRole).toBe('link');
    expect(screen.getByTestId('c-radio').props.accessibilityRole).toBe('radio');
    expect(screen.getByText('Groupe')).toBeTruthy();
  });

  it('ChampMobile : libellé, aide puis erreur annoncée, préréglages et bouton « Afficher » du mot de passe', async () => {
    const { rerender } = await render(<ChampMobile theme={theme} etiquette="Mot de passe" nature="motDePasse" indication="Aide" testID="mdp" />);
    const champ = screen.getByTestId('mdp');
    expect(champ.props.accessibilityLabel).toBe('Mot de passe');
    expect(champ.props.secureTextEntry).toBe(true);
    expect(champ.props.autoComplete).toBe('current-password');
    expect(screen.getByText('Aide')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('mdp-voir'));
    expect(screen.getByTestId('mdp').props.secureTextEntry).toBe(false);
    await rerender(<ChampMobile theme={theme} etiquette="Mot de passe" nature="motDePasse" erreur="Trop court" testID="mdp" />);
    expect(screen.getByText('Trop court').props.accessibilityRole).toBe('alert');
  });

  it('BoutonPrincipal, EnTeteMobile, SectionRepliable : rôles et états', async () => {
    let retour = 0;
    await render(
      <>
        <EnTeteMobile theme={theme} titre="Réglages" onRetour={() => retour++} testIDRetour="retour" />
        <BoutonPrincipal theme={theme} titre="Envoyer" desactive onPress={() => undefined} testID="principal" />
        <SectionRepliable theme={theme} titre="Avancé" testID="repli">
          <Text>dedans</Text>
        </SectionRepliable>
      </>,
    );
    expect(screen.getByText('Réglages').props.accessibilityRole).toBe('header');
    await fireEvent.press(screen.getByTestId('retour'));
    expect(retour).toBe(1);
    expect(screen.getByTestId('principal').props.accessibilityState.disabled).toBe(true);
    expect(screen.queryByText('dedans')).toBeNull();
    await fireEvent.press(screen.getByTestId('repli-entete'));
    expect(screen.getByText('dedans')).toBeTruthy();
  });

  it('BarreBasseHub : rien sans hôte ; avec l’hôte, Compte ouvre la feuille (synchro, changer de compte, verrouiller)', async () => {
    const appels: string[] = [];
    const nav: NavigationMobile = {
      theme,
      onAccueil: () => appels.push('accueil'),
      onSupport: () => appels.push('support'),
      onParametres: () => appels.push('parametres'),
      onVerrouiller: () => appels.push('verrouiller'),
      onChangerProfil: () => appels.push('changer'),
      synchro: synchroAttente,
      compte: 'Léa',
    };
    const { rerender } = await render(<BarreBasseHub actif="accueil" />);
    expect(screen.queryByTestId('barre-basse')).toBeNull();
    await rerender(
      <NavigationMobileContexte.Provider value={nav}>
        <BarreBasseHub actif="accueil" />
      </NavigationMobileContexte.Provider>,
    );
    await fireEvent.press(screen.getByTestId('barre-basse-support'));
    await fireEvent.press(screen.getByTestId('barre-basse-parametres'));
    await fireEvent.press(screen.getByTestId('barre-basse-compte'));
    expect(screen.getByTestId('feuille-compte-nom').props.children).toBe('Léa');
    expect(screen.getByTestId('synchro-maintenant')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('feuille-compte-verrouiller'));
    expect(appels).toEqual(['support', 'parametres', 'verrouiller']);
  });
});

const REGISTRE_TEST: AppHub[] = [
  { id: 'alpha', nom: 'Alpha', categorie: 'Test', description: 'Première app', icone: 'A', teinte: 'portefeuille', info: () => ({ sousTitre: 'En direct', indicateurs: [{ libelle: 'Valeur', valeur: '42' }] }) },
  { id: 'beta', nom: 'Bêta', categorie: 'Test', description: 'Deuxième app', icone: 'B', teinte: 'anime' },
];

function hub(onPrefs: (p: ReturnType<typeof reinitialiser>) => void = () => undefined) {
  return (
    <Hub registre={REGISTRE_TEST} contexte={{}} theme={theme} onTheme={() => undefined} onOuvrir={() => undefined} prefs={reinitialiser()} onPrefs={onPrefs} onVerrouiller={() => undefined} onParametres={() => undefined} onSupport={() => undefined} heure={10} />
  );
}

describe('écrans du hub selon le mode', () => {
  afterEach(() => forcerModeAffichage('large'));

  it('bureau (mode large) : le hub d’avant, sans barre basse ni en-tête compact', async () => {
    await render(hub());
    expect(screen.getByTestId('hub-verrouiller')).toBeTruthy();
    expect(screen.getByTestId('hub-theme')).toBeTruthy();
    expect(screen.queryByTestId('hub-entete-mobile')).toBeNull();
    expect(screen.queryByTestId('barre-basse')).toBeNull();
  });

  it('téléphone : en-tête compact, tuiles avec info en direct, personnalisation par boutons', async () => {
    forcerModeAffichage('telephone');
    const prefs: Array<ReturnType<typeof reinitialiser>> = [];
    await render(hub(p => prefs.push(p)));
    expect(screen.getByTestId('hub-entete-mobile')).toBeTruthy();
    expect(screen.queryByTestId('hub-verrouiller')).toBeNull();
    expect(screen.getByTestId('tuile-alpha-Valeur').props.children).toBe('42');
    await fireEvent.press(screen.getByTestId('hub-personnaliser'));
    expect(screen.getByTestId('hub-barre-edition')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('edit-beta-avant'));
    expect(prefs.at(-1)?.ordre).toEqual(['beta', 'alpha']);
    await fireEvent.press(screen.getByTestId('edit-alpha-taille'));
    expect(prefs.at(-1)?.tailles.alpha).toBe('grande');
    expect(screen.getByTestId('edit-alpha-avant').props.accessibilityState.disabled).toBe(true);
  });

  it('téléphone : la page « Administration » du hub, par l’entrée « Admin » de la barre basse', async () => {
    forcerModeAffichage('telephone');
    const registre: AppHub[] = [...REGISTRE_TEST, { id: 'gamma', nom: 'Gamma', categorie: 'Admin', page: 'administration', description: '', icone: 'G', teinte: 'admin', adminSeulement: true }];
    const pages: string[] = [];
    const nav: NavigationMobile = { theme, onAccueil: () => pages.push('publique'), onAdministration: () => pages.push('administration'), onParametres: () => undefined };
    const rendu = (page: 'publique' | 'administration') => (
      <NavigationMobileContexte.Provider value={nav}>
        <Hub registre={registre} contexte={{}} theme={theme} onTheme={() => undefined} onOuvrir={() => undefined} heure={10} page={page} />
      </NavigationMobileContexte.Provider>
    );
    const { rerender } = await render(rendu('publique'));
    expect(screen.queryByTestId('hub-pages')).toBeNull();
    expect(screen.getByTestId('tuile-alpha')).toBeTruthy();
    expect(screen.queryByTestId('tuile-gamma')).toBeNull();
    expect(screen.getByTestId('barre-basse-accueil').props.accessibilityState.selected).toBe(true);
    await fireEvent.press(screen.getByTestId('barre-basse-administration'));
    expect(pages).toEqual(['administration']);
    await rerender(rendu('administration'));
    expect(screen.getByTestId('hub-titre-administration')).toBeTruthy();
    expect(screen.getByTestId('tuile-gamma')).toBeTruthy();
    expect(screen.queryByTestId('tuile-alpha')).toBeNull();
    expect(screen.getByTestId('barre-basse-administration').props.accessibilityState.selected).toBe(true);
  });

  it('Paramètres sur téléphone : liste de sections → sous-page → retour ; recherche', async () => {
    forcerModeAffichage('telephone');
    const tous: IdReglage[] = REGLAGES.map(r => r.id);
    await render(<PageParametres theme={theme} disponibles={tous} rendu={id => <Text testID={`contenu-${id}`}>{id}</Text>} onFermer={() => undefined} />);
    expect(screen.queryByTestId('reglage-theme')).toBeNull();
    await fireEvent.press(screen.getByTestId('parametres-section-general'));
    expect(screen.getByTestId('reglage-theme')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('parametres-retour'));
    expect(screen.getByTestId('parametres-section-securite')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('parametres-recherche'), 'recuperation');
    expect(screen.getByTestId('reglage-codes-recuperation')).toBeTruthy();
  });

  it('Paramètres ouverts sur une section (pastille de synchro) : directement la sous-page', async () => {
    forcerModeAffichage('telephone');
    await render(<PageParametres theme={theme} section="securite" disponibles={REGLAGES.map(r => r.id)} rendu={id => <Text>{id}</Text>} onFermer={() => undefined} />);
    expect(screen.getByTestId('reglage-codes-recuperation')).toBeTruthy();
  });

  it('Support sur téléphone : formulaire pleine page, champs mobiles, retour vers l’accueil', async () => {
    forcerModeAffichage('telephone');
    let ferme = 0;
    await render(<PageSupport theme={theme} infos={{ version: '1', plateforme: 'site', rang: 'fondateur' } as never} tickets={[]} onFermer={() => ferme++} />);
    expect(screen.getByTestId('support-titre').props.enterKeyHint).toBe('next');
    expect(screen.getByTestId('support-message').props.multiline).toBe(true);
    await fireEvent.press(screen.getByTestId('hub-support-fermer'));
    expect(ferme).toBe(1);
  });
});
