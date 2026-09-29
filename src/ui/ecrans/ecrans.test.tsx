import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { rejouer } from '../../core/portfolio/engine';
import { importerPositions, transactionsDeReprise } from '../../core/import/positions';
import { MODELE_BOURSOBANK_POSITIONS } from '../../core/import/modeles';
import { compte, titre } from '../../core/testing/fixtures';
import { construireDashboard } from '../vues/dashboard';
import { Dashboard } from './Dashboard';
import { Deverrouillage } from './Deverrouillage';
import { ImportPositions } from './ImportPositions';
import { PremierLancement } from './PremierLancement';
import { Sauvegarde as SauvegardeEcran } from './Sauvegarde';

const EXPORT_REEL = [
  'name;isin;quantity;buyingPrice;lastPrice;intradayVariation;amount;amountVariation;variation',
  '"AMUNDI MSCI WORLD SWAP UCITS ETF EUR ACC";LU1681043599;17,00;703,89;703,73;0,59;"11 963,41";-2,66;-0,02',
  'STELLANTIS;NL00150001Q9;20,00;5,12;4,22;-0,15;84,47;-17,92;-17,50',
].join('\n');

function vueReelle() {
  const { positions } = importerPositions(EXPORT_REEL, MODELE_BOURSOBANK_POSITIONS);
  const transactions = transactionsDeReprise(positions, {
    compteId: 'pea',
    date: '2026-09-22',
    resoudreTitre: p => p.isin,
  });
  return construireDashboard({
    etat: rejouer([compte()], transactions),
    comptes: [compte()],
    titres: positions.map(p => titre({ id: p.isin, isin: p.isin, nom: p.nom })),
    cours: new Map(positions.map(p => [p.isin, p.valeurMarche!.div(p.quantite)])),
  });
}

describe('Deverrouillage', () => {
  const props = { onDeverrouiller: jest.fn() };

  beforeEach(() => jest.clearAllMocks());

  it('laisse le bouton inactif tant que les deux facteurs ne sont pas saisis', async () => {
    await render(<Deverrouillage {...props} />);
    const bouton = screen.getByTestId('bouton-deverrouiller');

    expect(bouton.props.accessibilityState.disabled).toBe(true);

    await fireEvent.changeText(screen.getByLabelText('Mot de passe'), 'motdepasse');
    expect(
      screen.getByTestId('bouton-deverrouiller').props.accessibilityState.disabled,
    ).toBe(true);

    await fireEvent.changeText(screen.getByLabelText("Code d'authentification"), '123456');
    expect(
      screen.getByTestId('bouton-deverrouiller').props.accessibilityState.disabled,
    ).toBe(false);
  });

  it('transmet les deux facteurs', async () => {
    await render(<Deverrouillage {...props} />);
    await fireEvent.changeText(screen.getByLabelText('Mot de passe'), 'motdepasse');
    await fireEvent.changeText(screen.getByLabelText("Code d'authentification"), '123456');
    await fireEvent.press(screen.getByTestId('bouton-deverrouiller'));

    expect(props.onDeverrouiller).toHaveBeenCalledWith('motdepasse', '123456');
  });

  it('annonce que la vérification prend un instant', async () => {
    // La dérivation Argon2id dure près d'une seconde : sans ce message, la
    // pause passe pour un plantage.
    await render(<Deverrouillage {...props} enCours />);

    expect(screen.getByText(/prend un instant/)).toBeTruthy();
    expect(screen.queryByTestId('bouton-deverrouiller')).toBeNull();
  });

  it('affiche l’erreur sans révéler quel facteur est faux', async () => {
    await render(<Deverrouillage {...props} erreur="Mot de passe ou code incorrect" />);
    expect(screen.getByText('Mot de passe ou code incorrect')).toBeTruthy();
  });

  it('bloque la saisie pendant la temporisation', async () => {
    await render(<Deverrouillage {...props} secondesAvantNouvelEssai={4} />);

    expect(screen.getByText(/dans 4 secondes/)).toBeTruthy();
    expect(
      screen.getByTestId('bouton-deverrouiller').props.accessibilityState.disabled,
    ).toBe(true);
  });

  it('accorde le singulier à une seconde restante', async () => {
    await render(<Deverrouillage {...props} secondesAvantNouvelEssai={1} />);
    expect(screen.getByText(/dans 1 seconde\./)).toBeTruthy();
  });
});

describe('PremierLancement', () => {
  const props = { onCreer: jest.fn() };

  beforeEach(() => jest.clearAllMocks());

  it('exige un mot de passe long et confirmé', async () => {
    await render(<PremierLancement {...props} />);
    const bouton = () => screen.getByTestId('bouton-creer');

    expect(bouton().props.accessibilityState.disabled).toBe(true);

    await fireEvent.changeText(screen.getByLabelText('Mot de passe'), 'court');
    await fireEvent.changeText(screen.getByLabelText('Confirmation'), 'court');
    expect(bouton().props.accessibilityState.disabled).toBe(true);

    await fireEvent.changeText(screen.getByLabelText('Mot de passe'), 'motdepassesuffisant');
    await fireEvent.changeText(screen.getByLabelText('Confirmation'), 'motdepassesuffisant');
    expect(bouton().props.accessibilityState.disabled).toBe(false);
  });

  it('signale deux saisies différentes', async () => {
    await render(<PremierLancement {...props} />);
    await fireEvent.changeText(screen.getByLabelText('Mot de passe'), 'motdepassesuffisant');
    await fireEvent.changeText(screen.getByLabelText('Confirmation'), 'autrechosedutout');

    expect(screen.getByText('Les deux saisies diffèrent.')).toBeTruthy();
    expect(screen.getByTestId('bouton-creer').props.accessibilityState.disabled).toBe(
      true,
    );
  });

  describe('remise des secrets', () => {
    const secrets = {
      codesRecuperation: ['ABCD-EFGH-JKMN-PQRS', '1234-5678-9ABC-DEFG'],
      secretTotp: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
      uriTotp: 'otpauth://totp/AppDashboard:moi',
    };

    it('affiche les codes et le secret', async () => {
      await render(<PremierLancement {...props} secrets={secrets} />);

      expect(screen.getByText('ABCD-EFGH-JKMN-PQRS')).toBeTruthy();
      expect(screen.getByText('1234-5678-9ABC-DEFG')).toBeTruthy();
      expect(screen.getByText(secrets.secretTotp)).toBeTruthy();
    });

    it('avertit qu’ils ne seront plus jamais affichés', async () => {
      await render(<PremierLancement {...props} secrets={secrets} />);
      expect(screen.getByText(/ne seront plus jamais affichées/)).toBeTruthy();
    });

    it('retient l’utilisateur tant qu’il n’a pas confirmé', async () => {
      // Passer trop vite ici coûte l'accès aux données le jour d'un oubli.
      const onTermine = jest.fn();
      await render(
        <PremierLancement {...props} secrets={secrets} onTermine={onTermine} />,
      );

      const continuer = screen.getByTestId('bouton-continuer');
      expect(continuer.props.accessibilityState.disabled).toBe(true);
      await fireEvent.press(continuer);
      expect(onTermine).not.toHaveBeenCalled();

      await fireEvent(
        screen.getByLabelText("J'ai noté ces codes hors ligne"),
        'valueChange',
        true,
      );
      await fireEvent.press(screen.getByTestId('bouton-continuer'));
      expect(onTermine).toHaveBeenCalled();
    });
  });
});

describe('Dashboard', () => {
  it('affiche la valorisation réelle du portefeuille', async () => {
    await render(<Dashboard vue={vueReelle()} />);

    expect(screen.getByText('12 047,88 €')).toBeTruthy();
    expect(screen.getByText('-20,58 €')).toBeTruthy();
  });

  it('liste les positions, la plus lourde en premier', async () => {
    await render(<Dashboard vue={vueReelle()} />);

    expect(screen.getByText('AMUNDI MSCI WORLD SWAP UCITS ETF EUR ACC')).toBeTruthy();
    expect(screen.getByText('STELLANTIS')).toBeTruthy();
    expect(screen.getByText('20 x 4,22 € - PRU 5,12 €')).toBeTruthy();
  });

  it('annonce un portefeuille vide au lieu d’afficher des zéros muets', async () => {
    const vue = construireDashboard({
      etat: rejouer([compte()], []),
      comptes: [compte()],
      titres: [],
      cours: new Map(),
    });
    await render(<Dashboard vue={vue} />);

    expect(screen.getByText(/Aucune position/)).toBeTruthy();
  });

  it('nomme les titres exclus du total faute de cours', async () => {
    const vue = { ...vueReelle(), titresSansCours: ['STELLANTIS'] };
    await render(<Dashboard vue={vue} />);

    expect(screen.getByText(/Cours inconnu/)).toBeTruthy();
    // STELLANTIS figure a la fois dans l'avertissement et dans la liste des
    // positions : la recherche doit donc en accepter plusieurs.
    expect(screen.getAllByText('STELLANTIS').length).toBeGreaterThan(0);
  });

  it('déclenche la saisie et le verrouillage', async () => {
    const onAjouterTransaction = jest.fn();
    const onVerrouiller = jest.fn();
    await render(
      <Dashboard
        vue={vueReelle()}
        onAjouterTransaction={onAjouterTransaction}
        onVerrouiller={onVerrouiller}
      />,
    );

    await fireEvent.press(screen.getByTestId('bouton-ajouter'));
    await fireEvent.press(screen.getByText('Verrouiller'));

    expect(onAjouterTransaction).toHaveBeenCalled();
    expect(onVerrouiller).toHaveBeenCalled();
  });
});

describe('Sauvegarde', () => {
  const surDisque = {
    nom: 'applibourse-2026-09-24.abk',
    chemin: '/Documents/sauvegardes/applibourse-2026-09-24.abk',
    description: '2 compte(s), 18 opération(s) · 24/09/2026',
    date: '2026-09-24',
  };

  function afficher(onFusionner?: (chemin: string, motDePasse: string) => void) {
    return render(
      <SauvegardeEcran
        disponible
        sauvegardes={[surDisque]}
        onCreer={() => undefined}
        onRestaurer={() => undefined}
        onFusionner={onFusionner}
        onRetour={() => undefined}
      />,
    );
  }

  it('propose la fusion à côté de la restauration', async () => {
    await afficher(() => undefined);

    expect(screen.getByTestId(`fusionner-${surDisque.nom}`)).toBeTruthy();
    expect(screen.getByTestId(`restaurer-${surDisque.nom}`)).toBeTruthy();
  });

  it('cache la fusion quand elle n’est pas proposée', async () => {
    await afficher(undefined);

    expect(screen.queryByTestId(`fusionner-${surDisque.nom}`)).toBeNull();
  });

  it('distingue clairement fusionner de restaurer', async () => {
    // Les deux mots se ressemblent et les consequences non : l'une ajoute,
    // l'autre efface. L'ecran doit le dire avant le geste.
    await afficher(() => undefined);
    await fireEvent.press(screen.getByTestId(`fusionner-${surDisque.nom}`));

    expect(screen.getByText('Fusionner ajoute, sans rien effacer')).toBeTruthy();
    expect(screen.getByText(/Rien de local n’est supprimé ni remplacé/)).toBeTruthy();
    expect(screen.getByText(/votre version est gardée/)).toBeTruthy();
  });

  it('dit ce qui n’est pas repris', async () => {
    await afficher(() => undefined);
    await fireEvent.press(screen.getByTestId(`fusionner-${surDisque.nom}`));

    expect(
      screen.getByText(/réglages et l’historique des cours ne sont pas repris/),
    ).toBeTruthy();
  });

  it('exige le mot de passe de l’archive avant de fusionner', async () => {
    const appels: Array<[string, string]> = [];
    await afficher((chemin, motDePasse) => appels.push([chemin, motDePasse]));
    await fireEvent.press(screen.getByTestId(`fusionner-${surDisque.nom}`));

    const bouton = screen.getByTestId('bouton-confirmer-fusion');
    expect(bouton.props.accessibilityState.disabled).toBe(true);

    await fireEvent.changeText(
      screen.getByLabelText('Mot de passe de cette sauvegarde'),
      'mot-de-passe-archive',
    );
    await fireEvent.press(screen.getByTestId('bouton-confirmer-fusion'));

    expect(appels).toEqual([[surDisque.chemin, 'mot-de-passe-archive']]);
  });
});

describe('ImportPositions', () => {
  it('explique où trouver l’export, et se replie', async () => {
    await render(<ImportPositions onImporter={() => {}} onAnnuler={() => {}} />);
    expect(screen.getByText(/boursobank\.com/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('guide-export'));
    expect(screen.queryByText(/boursobank\.com/)).toBeNull();
  });
});
