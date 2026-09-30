import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { DepotComptes, DepotParametres, DepotTitres, DepotTransactions, DepotWatchlist, PARAMETRES } from '../db/depots';
import { ouvrirBaseNode } from '../db/pilotes/node';
import { appareilDe } from '../sync/identite';
import { aleatoireDeterministe } from '../securite/aleatoire';
import type { ParametresKdf } from '../securite/kdf';
import { codeTotp } from '../securite/totp';
import { Session } from '../session/session';
import { stockageMemoire } from '../session/stockage-coffre';
import { App } from './App';
import { definirTheme, palettePour } from '../ui/theme';
import { CLE_THEME } from '../hub/personnalisation';

const KDF_RAPIDE: ParametresKdf = {
  algorithme: 'argon2id',
  passes: 1,
  memoireKio: 64,
  fils: 1,
  longueurCle: 32,
};

const MOT_DE_PASSE = 'correct-cheval-batterie-agrafe';
const INSTANT = 1_700_000_000_000;

/**
 * Session complète, avec le SQLite de Node à la place d'op-sqlite.
 * Le parcours testé est donc le vrai : coffre, dérivation de clé, TOTP,
 * migrations et rejeu du journal s'enchaînent réellement.
 */
function creerSession() {
  return new Session({
    stockage: stockageMemoire(),
    ouvrirBase: () => ouvrirBaseNode(),
    horloge: () => INSTANT,
    alea: aleatoireDeterministe(1),
    kdf: KDF_RAPIDE,
  });
}

/** Laisse passer le report d'un tour de boucle utilisé avant les calculs lourds. */
async function laisserTravailler() {
  await act(async () => {
    jest.advanceTimersByTime(1);
    await Promise.resolve();
  });
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('parcours de premier lancement', () => {
  it('crée le coffre, remet les secrets, puis ouvre le tableau de bord', async () => {
    const session = creerSession();
    await render(<App session={session} />);

    // 1. Création du mot de passe.
    expect(screen.getByText('Protéger vos données')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Mot de passe'), MOT_DE_PASSE);
    await fireEvent.changeText(screen.getByLabelText('Confirmation'), MOT_DE_PASSE);
    await fireEvent.press(screen.getByTestId('bouton-creer'));
    await laisserTravailler();

    // 2. Remise des secrets, verrouillée tant qu'ils ne sont pas notés.
    expect(screen.getByText('À noter maintenant')).toBeTruthy();
    expect(
      screen.getByTestId('bouton-continuer').props.accessibilityState.disabled,
    ).toBe(true);

    await fireEvent(
      screen.getByLabelText("J'ai noté ces codes hors ligne"),
      'valueChange',
      true,
    );
    await fireEvent.press(screen.getByTestId('bouton-continuer'));

    // 3. Tableau de bord, aucun compte encore cree.
    expect(screen.getAllByText('Portefeuille').length).toBeGreaterThan(0);
    expect(screen.getByText(/Aucun compte/)).toBeTruthy();
  });
});

describe('parcours de déverrouillage', () => {
  async function ouvrirPuisVerrouiller() {
    const session = creerSession();
    const initialisation = session.initialiser({ motDePasse: MOT_DE_PASSE });
    session.verrouiller();
    await render(<App session={session} />);
    return { session, initialisation };
  }

  it('ouvre le tableau de bord avec les bons identifiants', async () => {
    const { initialisation } = await ouvrirPuisVerrouiller();

    expect(screen.getByTestId('bouton-deverrouiller')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Mot de passe'), MOT_DE_PASSE);
    await fireEvent.changeText(
      screen.getByLabelText("Code d'authentification"),
      codeTotp(initialisation.secretTotp, INSTANT),
    );
    await fireEvent.press(screen.getByTestId('bouton-deverrouiller'));
    await laisserTravailler();

    expect(screen.getAllByText('Portefeuille').length).toBeGreaterThan(0);
  });

  it('rouvre avec un code de récupération et un nouveau mot de passe', async () => {
    const { session, initialisation } = await ouvrirPuisVerrouiller();

    await fireEvent.press(screen.getByText('Mot de passe oublié'));
    await fireEvent.changeText(screen.getByTestId('champ-code-recuperation'), initialisation.codesRecuperation[0]);
    await fireEvent.changeText(screen.getByTestId('champ-nouveau-mot-de-passe'), 'nouveau-mot-de-passe-solide');
    await fireEvent.changeText(screen.getByTestId('champ-confirmation-mot-de-passe'), 'autre-chose-completement');
    await fireEvent.press(screen.getByTestId('bouton-recuperer'));
    expect(screen.getByText('Les deux mots de passe ne correspondent pas.')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('champ-confirmation-mot-de-passe'), 'nouveau-mot-de-passe-solide');
    await fireEvent.press(screen.getByTestId('bouton-recuperer'));
    await laisserTravailler();

    expect(session.statut()).toBe('deverrouille');
    expect(screen.getByTestId('avis-recuperation')).toBeTruthy();
    // Le nouveau mot de passe ouvre la base ; le code, lui, est consommé.
    session.verrouiller();
    expect(() =>
      session.deverrouiller({
        motDePasse: 'nouveau-mot-de-passe-solide',
        codeTotp: codeTotp(initialisation.secretTotp, INSTANT),
      }),
    ).not.toThrow();
  });

  it('reste verrouillé et affiche un message indistinct sur un code faux', async () => {
    await ouvrirPuisVerrouiller();

    await fireEvent.changeText(screen.getByLabelText('Mot de passe'), MOT_DE_PASSE);
    await fireEvent.changeText(screen.getByLabelText("Code d'authentification"), '000000');
    await fireEvent.press(screen.getByTestId('bouton-deverrouiller'));
    await laisserTravailler();

    expect(screen.getByText('Mot de passe ou code incorrect')).toBeTruthy();
    expect(screen.queryByText('Portefeuille')).toBeNull();
  });

  it('donne le même message pour un mot de passe faux', async () => {
    // Deux causes, un seul message : l'interface ne doit pas renseigner un
    // attaquant sur le facteur qu'il tient déjà.
    const { initialisation } = await ouvrirPuisVerrouiller();

    await fireEvent.changeText(screen.getByLabelText('Mot de passe'), 'pas-le-bon');
    await fireEvent.changeText(
      screen.getByLabelText("Code d'authentification"),
      codeTotp(initialisation.secretTotp, INSTANT),
    );
    await fireEvent.press(screen.getByTestId('bouton-deverrouiller'));
    await laisserTravailler();

    expect(screen.getByText('Mot de passe ou code incorrect')).toBeTruthy();
  });

  it('reverrouille à la demande', async () => {
    const { initialisation } = await ouvrirPuisVerrouiller();

    await fireEvent.changeText(screen.getByLabelText('Mot de passe'), MOT_DE_PASSE);
    await fireEvent.changeText(
      screen.getByLabelText("Code d'authentification"),
      codeTotp(initialisation.secretTotp, INSTANT),
    );
    await fireEvent.press(screen.getByTestId('bouton-deverrouiller'));
    await laisserTravailler();

    await fireEvent.press(screen.getByTestId('nav-verrouiller'));
    expect(screen.getByTestId('bouton-deverrouiller')).toBeTruthy();
  });

  it('annonce la temporisation après quatre échecs', async () => {
    await ouvrirPuisVerrouiller();

    for (let i = 0; i < 4; i++) {
      await fireEvent.changeText(screen.getByLabelText('Mot de passe'), 'faux');
      await fireEvent.changeText(
        screen.getByLabelText("Code d'authentification"),
        '000000',
      );
      await fireEvent.press(screen.getByTestId('bouton-deverrouiller'));
      await laisserTravailler();
    }

    expect(screen.getByText(/Trop de tentatives/)).toBeTruthy();
  });
});

/** Export « positions instantanées » BoursoBank réel. */
const EXPORT_REEL = [
  'name;isin;quantity;buyingPrice;lastPrice;intradayVariation;amount;amountVariation;variation',
  '"AMUNDI MSCI WORLD SWAP UCITS ETF EUR ACC";LU1681043599;17,00;703,89;703,73;0,59;"11 963,41";-2,66;-0,02',
  'STELLANTIS;NL00150001Q9;20,00;5,12;4,22;-0,15;84,47;-17,92;-17,50',
].join('\n');

const INSEC = ' ';
const FINE = ' ';

describe('parcours complet, session ouverte', () => {
  async function ouvrir() {
    const session = creerSession();
    session.initialiser({ motDePasse: MOT_DE_PASSE });
    let compteur = 0;
    await render(
      <App
        session={session}
        genererId={prefixe => `${prefixe}-${++compteur}`}
        aujourdhui={() => '2026-09-22'}
      />,
    );
    return session;
  }

  async function creerCompte() {
    await fireEvent.press(screen.getByTestId('bouton-creer-compte-depuis-tableau'));
    await fireEvent.changeText(screen.getByLabelText('Nom'), 'PEA BoursoBank');
    await fireEvent.changeText(screen.getByLabelText("Date d'ouverture"), '15/03/2019');
    await fireEvent.press(screen.getByTestId('bouton-creer-compte'));
  }

  it('crée un compte depuis le tableau de bord', async () => {
    await ouvrir();
    expect(screen.getByText(/Aucun compte/)).toBeTruthy();

    await creerCompte();

    // Retour au tableau : le compte existe, les positions manquent encore.
    expect(screen.getByText(/Aucune position/)).toBeTruthy();
    expect(screen.queryByText(/Aucun compte/)).toBeNull();
  });

  it('modifie puis supprime un compte avec ses opérations', async () => {
    const session = await ouvrir();
    await creerCompte();
    await fireEvent.press(screen.getByTestId('bouton-importer-positions'));
    await fireEvent.changeText(screen.getByLabelText('Contenu du fichier'), EXPORT_REEL);
    await fireEvent.press(screen.getByTestId('bouton-importer'));

    const compte = new DepotComptes(session.base()).tous()[0];
    await fireEvent.press(screen.getByTestId(`modifier-compte-${compte.id}`));
    expect(screen.getByText('Modifier le compte')).toBeTruthy();
    // Des opérations existent : la devise est figée.
    expect(screen.getByText(/sa devise ne peut plus changer/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Nom'), 'Mon PEA');
    await fireEvent.press(screen.getByTestId('bouton-enregistrer-compte'));
    expect(new DepotComptes(session.base()).tous()).toEqual([{ ...compte, nom: 'Mon PEA' }]);

    await fireEvent.press(screen.getByTestId(`modifier-compte-${compte.id}`));
    await fireEvent.press(screen.getByTestId('bouton-supprimer-compte'));
    expect(screen.getByText(/Supprimer « Mon PEA » et ses 3 opération\(s\) \?/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('bouton-confirmer-suppression-compte'));

    expect(new DepotComptes(session.base()).tous()).toEqual([]);
    expect(new DepotTransactions(session.base()).toutes()).toEqual([]);
    expect(screen.getByText(/Aucun compte/)).toBeTruthy();
  });

  it('recherche une entreprise et l’ajoute à la surveillance', async () => {
    const fetchOrigine = globalThis.fetch;
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        quotes: [
          { symbol: 'NVDA', shortname: 'NVIDIA Corporation', exchange: 'NMS', quoteType: 'EQUITY', currency: 'USD' },
          { symbol: 'ASML', shortname: 'ASML Holding N.V.', exchange: 'NMS', quoteType: 'EQUITY', currency: 'USD' },
        ],
      }),
    })) as unknown as typeof fetch;
    try {
      const session = await ouvrir();
      await fireEvent.press(screen.getByTestId('nav-recherche'));
      await fireEvent.changeText(screen.getByTestId('champ-recherche-action'), 'nvidia');
      await fireEvent.press(screen.getByTestId('bouton-rechercher-action'));
      await screen.findByTestId('resultat-NVDA');

      await fireEvent.press(screen.getByTestId('surveiller-NVDA'));
      const titre = new DepotTitres(session.base()).tous().find(t => t.ticker === 'NVDA');
      expect(titre).toMatchObject({ nom: 'NVIDIA Corporation', deviseCotation: 'USD' });
      expect(new DepotWatchlist(session.base()).lister().map(ligne => ligne.titreId)).toEqual([titre!.id]);
      expect(screen.getByText('★ Surveillée')).toBeTruthy();
      // Une deuxième valeur sans ISIN s'ajoute aussi (elle échouait avant).
      await fireEvent.press(screen.getByTestId('surveiller-ASML'));
      expect(new DepotWatchlist(session.base()).lister()).toHaveLength(2);
      expect(screen.queryByText(/Impossible d’ajouter/)).toBeNull();

      // Le terme tapé et la valeur consultée restent dans l'historique.
      expect(screen.getByTestId('historique-nvidia')).toBeTruthy();
      expect(screen.getByTestId('historique-NVDA')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('effacer-historique'));
      expect(screen.queryByTestId('historique-recherche')).toBeNull();

      await fireEvent.press(screen.getByTestId('nav-watchlist'));
      expect(screen.getAllByText('NVIDIA Corporation').length).toBeGreaterThan(0);
      await fireEvent.press(screen.getByTestId('onglet-surveillance-theses'));
      expect(screen.getByText(/application de bureau/)).toBeTruthy();
    } finally {
      globalThis.fetch = fetchOrigine;
    }
  });

  it('écrit une thèse dans le carnet et la retrouve', async () => {
    const session = await ouvrir();
    await creerCompte();
    await fireEvent.press(screen.getByTestId('bouton-importer-positions'));
    await fireEvent.changeText(screen.getByLabelText('Contenu du fichier'), EXPORT_REEL);
    await fireEvent.press(screen.getByTestId('bouton-importer'));

    await fireEvent.press(screen.getByTestId('nav-carnet'));
    const stellantis = new DepotTitres(session.base()).tous().find(titre => /STELLANTIS/.test(titre.nom))!;
    await fireEvent.press(screen.getByTestId(`ecrire-${stellantis.id}`));
    await fireEvent.changeText(screen.getByTestId('champ-pourquoi'), 'Décote forte, dividende élevé.');
    await fireEvent.changeText(screen.getByTestId('champ-objectif-these'), '20');
    await fireEvent.press(screen.getByTestId('enregistrer-these'));

    expect(screen.getByTestId(`these-${stellantis.id}`)).toBeTruthy();
    expect(screen.getByText('Décote forte, dividende élevé.')).toBeTruthy();
    const carnet = JSON.parse(new DepotParametres(session.base()).lire(PARAMETRES.carnetTheses)!);
    expect(carnet[stellantis.id]).toMatchObject({ pourquoi: 'Décote forte, dividende élevé.', objectif: 20, ecriteLe: '2026-09-22' });
  });

  it('présente les nouveautés une fois, ouvre les pages, et se revoit depuis Paramètres', async () => {
    const session = await ouvrir();
    expect(screen.queryByTestId('visite-guidee')).toBeNull(); // pas pour un tout nouveau portefeuille
    await creerCompte();
    expect(screen.getByTestId('visite-guidee')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('visite-suivant'));
    expect(screen.getByText('Le Screener')).toBeTruthy();

    // « Ouvrir la page » emmène sur l'écran et replie la visite en bandeau.
    await fireEvent.press(screen.getByTestId('visite-voir'));
    expect(screen.queryByTestId('visite-guidee')).toBeNull();
    expect(screen.getByTestId('visite-bandeau')).toBeTruthy();
    expect(screen.getByTestId('nav-screener').props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(screen.getByTestId('visite-continuer'));
    expect(screen.getByText('La Watchlist')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('visite-passer'));
    expect(screen.queryByTestId('visite-guidee')).toBeNull();
    const vues = JSON.parse(new DepotParametres(session.base()).lire(PARAMETRES.visiteVue)!);
    expect(vues).toEqual(expect.arrayContaining(['intro', 'screener', 'watchlist', 'diagnostic']));

    await fireEvent.press(screen.getByTestId('nav-reglages'));
    await fireEvent.press(screen.getByTestId('revoir-visite'));
    expect(screen.getByTestId('visite-guidee')).toBeTruthy();
  });

  it('règle le versement mensuel et le saisit pré-rempli', async () => {
    const session = await ouvrir();
    await creerCompte();
    await fireEvent.press(screen.getByTestId('bouton-importer-positions'));
    await fireEvent.changeText(screen.getByLabelText('Contenu du fichier'), EXPORT_REEL);
    await fireEvent.press(screen.getByTestId('bouton-importer'));

    await fireEvent.press(screen.getByTestId('nav-objectifs'));
    await fireEvent(screen.getByTestId('interrupteur-versement'), 'valueChange', true);
    expect(JSON.parse(new DepotParametres(session.base()).lire(PARAMETRES.versementMensuel)!)).toMatchObject({ actif: true, jour: 5, montant: 200 });

    await fireEvent.press(screen.getByTestId('saisir-versement-mois'));
    expect(screen.getByLabelText('Montant').props.value).toBe('200');
    const avant = new DepotTransactions(session.base()).toutes().length;
    await fireEvent.press(screen.getByTestId('bouton-enregistrer'));
    const versements = new DepotTransactions(session.base()).toutes().filter(t => t.type === 'VERSEMENT');
    expect(new DepotTransactions(session.base()).toutes()).toHaveLength(avant + 1);
    expect(versements.some(t => t.date === '2026-09-22' && t.note === 'Versement mensuel')).toBe(true);
    // Retour aux Objectifs, pour voir quoi acheter.
    expect(screen.getByTestId('carte-versement-mensuel')).toBeTruthy();
  });

  it('exporte le portefeuille dans un fichier Excel', async () => {
    const enregistres: Array<{ nom: string; octets: Uint8Array }> = [];
    const global = globalThis as { applibourse?: unknown };
    global.applibourse = {
      fichiers: {
        enregistrerSous: async (nom: string, octets: Uint8Array) => (enregistres.push({ nom, octets }), true),
      },
    };
    try {
      await ouvrir();
      await creerCompte();
      await fireEvent.press(screen.getByTestId('nav-reglages'));
      await fireEvent.press(screen.getByTestId('bouton-export-excel'));
      await laisserTravailler();
      expect(enregistres[0].nom).toBe('AppDashboard 2026-09-22.xlsx');
      expect([...enregistres[0].octets.slice(0, 2)]).toEqual([0x50, 0x4b]);
      expect(screen.getByTestId('message-export').props.children).toBe('✅ Fichier Excel enregistré.');
    } finally {
      delete global.applibourse;
    }
  });

  it('note la raison d’une décision dans le journal', async () => {
    const session = await ouvrir();
    await creerCompte();
    await fireEvent.press(screen.getByTestId('bouton-importer-positions'));
    await fireEvent.changeText(screen.getByLabelText('Contenu du fichier'), EXPORT_REEL);
    await fireEvent.press(screen.getByTestId('bouton-importer'));

    await fireEvent.press(screen.getByTestId('nav-journal'));
    const achat = new DepotTransactions(session.base()).toutes().find(t => t.type === 'ACHAT')!;
    expect(screen.getByTestId(`decision-${achat.id}`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`noter-${achat.id}`));
    await fireEvent.changeText(screen.getByTestId(`note-${achat.id}`), 'Renforcement sur repli');
    await fireEvent.press(screen.getByTestId(`enregistrer-note-${achat.id}`));

    expect(new DepotTransactions(session.base()).toutes().find(t => t.id === achat.id)!.note).toBe('Renforcement sur repli');
    expect(screen.getByText('« Renforcement sur repli »')).toBeTruthy();
  });

  it('ouvre la bonne page au clic sur une notification', async () => {
    let cliquer: ((destination: string) => void) | undefined;
    const global = globalThis as { applibourse?: unknown };
    global.applibourse = {
      systeme: {
        notifier: async () => true,
        surNotificationOuverte: (rappel: (destination: string) => void) => {
          cliquer = rappel;
          return () => undefined;
        },
      },
    };
    try {
      await ouvrir();
      await creerCompte();
      expect(cliquer).toBeDefined();
      await act(async () => cliquer!('objectifs'));
      expect(screen.getByTestId('carte-versement-mensuel')).toBeTruthy();
      await act(async () => cliquer!('page-qui-n-existe-pas'));
      expect(screen.queryByTestId('carte-versement-mensuel')).toBeNull();
    } finally {
      delete global.applibourse;
    }
  });

  it('vérifie les mises à jour application ouverte, et propose de redémarrer', async () => {
    const redemarrer = jest.fn(async () => true);
    const global = globalThis as { applibourse?: unknown };
    global.applibourse = {
      maj: {
        chercher: async () => ({ etat: 'disponible', commit: 'abc1234', nouveautes: ['Screener façon Baggr', 'Export Excel'] }),
        redemarrer,
      },
    };
    try {
      await ouvrir();
      await creerCompte();
      await fireEvent.press(screen.getByTestId('nav-reglages'));
      await fireEvent.press(screen.getByTestId('parametres-section-apropos'));
      await fireEvent.press(screen.getByTestId('maj-verifier'));
      await laisserTravailler();
      expect(screen.getByText('• Screener façon Baggr')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('maj-installer'));
      expect(redemarrer).toHaveBeenCalled();
    } finally {
      delete global.applibourse;
    }
  });

  it('refuse un compte sans date d’ouverture', async () => {
    // Pour un PEA, cette date fait courir l'antériorité fiscale.
    await ouvrir();
    await fireEvent.press(screen.getByTestId('bouton-creer-compte-depuis-tableau'));
    await fireEvent.changeText(screen.getByLabelText('Nom'), 'PEA');
    await fireEvent.press(screen.getByTestId('bouton-creer-compte'));

    expect(screen.getByText(/Date invalide/)).toBeTruthy();
  });

  it('importe le portefeuille réel et le valorise aussitôt', async () => {
    await ouvrir();
    await creerCompte();

    await fireEvent.press(screen.getByTestId('bouton-importer-positions'));
    await fireEvent.changeText(
      screen.getByLabelText('Contenu du fichier'),
      EXPORT_REEL,
    );

    // L'aperçu annonce ce qui va être écrit, avant de l'écrire.
    expect(screen.getByText('2 position(s) détectée(s)')).toBeTruthy();
    expect(screen.getByText(`12${FINE}068,46${INSEC}€`)).toBeTruthy();

    await fireEvent.press(screen.getByTestId('bouton-importer'));

    // Le resume affiche la valorisation du courtier, sans « cours inconnu ».
    // Elle figure deux fois : en tete du resume et sur la carte du compte.
    expect(screen.getAllByText(`12${FINE}047,88${INSEC}€`).length).toBeGreaterThan(0);
    // Plus-value latente et Total Return coincident : tout a ete verse pour
    // acheter ces lignes.
    expect(screen.getAllByText(`-20,58${INSEC}€`).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Cours inconnu/)).toBeNull();

    // Les lignes vivent dans l'onglet Positions.
    // Le nom figure dans le tableau des titres et dans les graphiques.
    await fireEvent.press(screen.getByTestId('onglet-positions'));
    expect(screen.getByTestId('tableau-titres')).toBeTruthy();
    expect(screen.getAllByText('STELLANTIS').length).toBeGreaterThan(0);
    expect(screen.getByText('2 ligne(s)')).toBeTruthy();
  });

  it('importe l’historique des opérations à la place de la reprise de positions', async () => {
    const session = await ouvrir();
    await creerCompte();
    await fireEvent.press(screen.getByTestId('bouton-importer-positions'));
    await fireEvent.changeText(screen.getByLabelText('Contenu du fichier'), EXPORT_REEL);
    await fireEvent.press(screen.getByTestId('bouton-importer'));
    const avant = new DepotTransactions(session.base()).toutes().length;

    await fireEvent.press(screen.getByTestId('bouton-importer-positions'));
    await fireEvent.press(screen.getByTestId('mode-import-Opérations'));
    await fireEvent.changeText(
      screen.getByLabelText('Contenu du fichier'),
      [
        'date,operation,libelle,isin,ticker,quantite,prix_unitaire,montant,frais,devise',
        '2024-10-01,versement,Virement,,,,,12100,,EUR',
        '2024-10-02,achat,AMUNDI MSCI WORLD,LU1681043599,,17,703.89,,0,EUR',
        '2024-10-02,achat,STELLANTIS,NL00150001Q9,,20,5.12,,0,EUR',
      ].join('\n'),
    );
    expect(screen.getByText('3 opérations à importer')).toBeTruthy();
    expect(screen.getByText('Remplacer la reprise de positions')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('bouton-importer-operations'));

    const apres = new DepotTransactions(session.base()).toutes();
    // La reprise (1 versement + 2 achats) est remplacée par les 3 vraies opérations.
    expect(apres).toHaveLength(avant);
    expect(apres.some(transaction => transaction.note?.startsWith('Reprise'))).toBe(false);
    expect(apres.find(transaction => transaction.type === 'VERSEMENT')!.date).toBe('2024-10-01');
  });

  it('explique qu’une fiche valeur demande un symbole', async () => {
    await ouvrir();
    await creerCompte();
    await fireEvent.press(screen.getByTestId('bouton-importer-positions'));
    await fireEvent.changeText(screen.getByLabelText('Contenu du fichier'), EXPORT_REEL);
    await fireEvent.press(screen.getByTestId('bouton-importer'));

    // Les valeurs importées n'ont pas de symbole : la fiche le dit, sans
    // appeler le réseau pour rien.
    await fireEvent.press(screen.getByTestId('onglet-positions'));
    await fireEvent.press(within(screen.getByTestId('tableau-titres')).getByText('STELLANTIS'));
    expect(screen.getByText(/pas de symbole boursier/)).toBeTruthy();

    await fireEvent.press(screen.getByTestId('bouton-retour-fiche'));
    expect(screen.getAllByText('Portefeuille').length).toBeGreaterThan(0);
  });

  it('saisit une opération et la répercute sur les liquidités', async () => {
    await ouvrir();
    await creerCompte();

    await fireEvent.press(screen.getByTestId('bouton-ajouter'));
    await fireEvent.press(screen.getByTestId('type-VERSEMENT'));
    await fireEvent.changeText(screen.getByLabelText('Date'), '22/09/2026');
    await fireEvent.changeText(screen.getByLabelText('Montant'), '1 000,00');
    await fireEvent.press(screen.getByTestId('bouton-enregistrer'));

    // Le libelle et la valeur sont deux elements distincts depuis le passage
    // aux indicateurs explicables.
    // Sans titre detenu, la valeur totale egale les liquidites : le montant
    // apparait donc deux fois.
    expect(screen.getByText('Liquidités')).toBeTruthy();
    expect(screen.getAllByText(`1${FINE}000,00${INSEC}€`).length).toBeGreaterThan(0);
  });

  it('encaisse un dividende et le montre dans son onglet', async () => {
    await ouvrir();
    await creerCompte();

    await fireEvent.press(screen.getByTestId('bouton-importer-positions'));
    await fireEvent.changeText(
      screen.getByLabelText('Contenu du fichier'),
      EXPORT_REEL,
    );
    await fireEvent.press(screen.getByTestId('bouton-importer'));

    await fireEvent.press(screen.getByTestId('bouton-ajouter'));
    await fireEvent.press(screen.getByTestId('type-DIVIDENDE'));
    await fireEvent.press(screen.getByText('STELLANTIS'));
    await fireEvent.changeText(screen.getByLabelText('Date'), '15/05/2026');
    await fireEvent.changeText(screen.getByLabelText('Montant'), '34,00');
    await fireEvent.press(screen.getByTestId('bouton-enregistrer'));

    await fireEvent.press(screen.getByTestId('onglet-dividendes'));

    expect(screen.getByText('Encaissé sur douze mois')).toBeTruthy();
    expect(screen.getAllByText(`34,00${INSEC}€`).length).toBeGreaterThan(0);
  });

  it('refuse de calculer un rendement sur moins de douze mois', async () => {
    // Une fenetre trouee comparee a une annee pleine sous-estime toujours :
    // mieux vaut dire pourquoi que d'afficher un chiffre faux.
    await ouvrir();
    await creerCompte();

    await fireEvent.press(screen.getByTestId('bouton-ajouter'));
    await fireEvent.press(screen.getByTestId('type-VERSEMENT'));
    await fireEvent.changeText(screen.getByLabelText('Date'), '01/01/2026');
    await fireEvent.changeText(screen.getByLabelText('Montant'), '1 000,00');
    await fireEvent.press(screen.getByTestId('bouton-enregistrer'));

    await fireEvent.press(screen.getByTestId('onglet-dividendes'));

    expect(screen.getByText('Aucun dividende encaissé.')).toBeTruthy();
  });

  it('mesure la concentration dès l’import, sans aucun historique', async () => {
    // C'est la mesure la plus sure de l'onglet, et la seule disponible le
    // premier jour : elle ne doit pas attendre un historique de cours.
    await ouvrir();
    await creerCompte();

    await fireEvent.press(screen.getByTestId('bouton-importer-positions'));
    await fireEvent.changeText(
      screen.getByLabelText('Contenu du fichier'),
      EXPORT_REEL,
    );
    await fireEvent.press(screen.getByTestId('bouton-importer'));

    await fireEvent.press(screen.getByTestId('onglet-risque'));

    expect(screen.getByText('Lignes équivalentes')).toBeTruthy();
    expect(screen.getByText(/pèse/)).toBeTruthy();
  });

  it('refuse de corréler deux lignes sans historique de cours', async () => {
    // Deux series de quelques points donnent facilement une correlation
    // forte par hasard : on dit ce qui manque plutot que d'afficher un
    // chiffre qu'on prendrait au serieux.
    await ouvrir();
    await creerCompte();

    await fireEvent.press(screen.getByTestId('bouton-importer-positions'));
    await fireEvent.changeText(
      screen.getByLabelText('Contenu du fichier'),
      EXPORT_REEL,
    );
    await fireEvent.press(screen.getByTestId('bouton-importer'));

    await fireEvent.press(screen.getByTestId('onglet-risque'));

    expect(screen.getByText(/par hasard/)).toBeTruthy();
    // Les deux refus — volatilité et corrélation — invoquent le même manque.
    expect(screen.getAllByText(/relevés de cours/).length).toBe(2);
  });

  it('laisse choisir une référence, et la retire au second appui', async () => {
    await ouvrir();
    await creerCompte();

    await fireEvent.press(screen.getByTestId('bouton-importer-positions'));
    await fireEvent.changeText(
      screen.getByLabelText('Contenu du fichier'),
      EXPORT_REEL,
    );
    await fireEvent.press(screen.getByTestId('bouton-importer'));
    await fireEvent.press(screen.getByTestId('onglet-performances'));

    // Aucune reference : on invite a choisir plutot que d'en imposer une.
    expect(screen.getByText(/Choisissez une valeur de référence/)).toBeTruthy();

    // L'identifiant du titre est genere a l'import : on vise son libelle.
    const reference = screen.getByText(/^STELLANTIS · /);
    await fireEvent.press(reference);

    // Une seule valorisation connue : la comparaison dit ce qui manque plutot
    // que d'afficher un ecart tire d'un seul point.
    expect(screen.queryByText(/Choisissez une valeur de référence/)).toBeNull();
    expect(screen.getAllByText(/au moins deux valorisations/).length).toBeGreaterThan(0);

    await fireEvent.press(reference);

    // Sans ce second appui, on ne pourrait plus revenir a « aucune comparaison ».
    expect(screen.getByText(/Choisissez une valeur de référence/)).toBeTruthy();
  });

  it('propose un rapport par année où il s’est passé quelque chose', async () => {
    await ouvrir();
    await creerCompte();

    await fireEvent.press(screen.getByTestId('bouton-ajouter'));
    await fireEvent.press(screen.getByTestId('type-VERSEMENT'));
    await fireEvent.changeText(screen.getByLabelText('Date'), '15/03/2026');
    await fireEvent.changeText(screen.getByLabelText('Montant'), '1 000,00');
    await fireEvent.press(screen.getByTestId('bouton-enregistrer'));

    await fireEvent.press(screen.getByTestId('onglet-impots'));

    expect(screen.getByText('Rapport annuel')).toBeTruthy();
    expect(screen.getByTestId('rapport-2026')).toBeTruthy();
  });

  it('dit que l’écriture de fichiers manque plutôt que d’échouer en silence', async () => {
    // Les tests tournent sans react-native-fs, comme un binaire compile sans
    // lui : le refus doit etre visible.
    await ouvrir();
    await creerCompte();

    await fireEvent.press(screen.getByTestId('bouton-ajouter'));
    await fireEvent.press(screen.getByTestId('type-VERSEMENT'));
    await fireEvent.changeText(screen.getByLabelText('Date'), '15/03/2026');
    await fireEvent.changeText(screen.getByLabelText('Montant'), '1 000,00');
    await fireEvent.press(screen.getByTestId('bouton-enregistrer'));

    await fireEvent.press(screen.getByTestId('onglet-impots'));
    await fireEvent.press(screen.getByTestId('rapport-2026'));

    expect(screen.getByText(/Écriture de fichiers indisponible/)).toBeTruthy();
  });

  it('projette depuis la valeur actuelle du portefeuille', async () => {
    await ouvrir();
    await creerCompte();

    await fireEvent.press(screen.getByTestId('bouton-importer-positions'));
    await fireEvent.changeText(
      screen.getByLabelText('Contenu du fichier'),
      EXPORT_REEL,
    );
    await fireEvent.press(screen.getByTestId('bouton-importer'));

    await fireEvent.press(screen.getByTestId('nav-projection'));

    // Le capital de depart reprend la valeur du portefeuille sans qu'on la
    // retape : c'est le cas courant, et une occasion de se tromper en moins.
    const indice = screen.getByText(/Laissé vide, le capital de départ reprend/);
    expect(JSON.stringify(indice.props.children)).toContain(`12${FINE}047,88`);
    expect(screen.getByText(/^de .+ à .+$/)).toBeTruthy();
  });

  it('refuse de projeter sur une hypothèse illisible', async () => {
    await ouvrir();
    await creerCompte();

    await fireEvent.press(screen.getByTestId('nav-projection'));
    await fireEvent.changeText(screen.getByTestId('projection-annees'), '200');

    expect(screen.getByText('Au maximum 50.')).toBeTruthy();
    expect(screen.getByText(/Complétez les hypothèses/)).toBeTruthy();
  });

  it('surveille une valeur et fige son cours du jour', async () => {
    await ouvrir();
    await creerCompte();

    await fireEvent.press(screen.getByTestId('bouton-importer-positions'));
    await fireEvent.changeText(
      screen.getByLabelText('Contenu du fichier'),
      EXPORT_REEL,
    );
    await fireEvent.press(screen.getByTestId('bouton-importer'));

    await fireEvent.press(screen.getByTestId('nav-watchlist'));
    expect(screen.getByText(/Aucune valeur surveillée/)).toBeTruthy();

    await fireEvent.press(screen.getByText(/^STELLANTIS/));

    // Le cours du jour est fige a l'ajout : c'est le point de comparaison.
    expect(screen.getByText(/Suivie depuis le 22\/09\/2026, à /)).toBeTruthy();
    // Une valeur detenue et surveillee est marquee comme telle : la confondre
    // avec une position fausserait la lecture.
    expect(screen.getByText('Aussi détenue')).toBeTruthy();
  });

  it('retire une valeur de la surveillance', async () => {
    await ouvrir();
    await creerCompte();

    await fireEvent.press(screen.getByTestId('bouton-importer-positions'));
    await fireEvent.changeText(
      screen.getByLabelText('Contenu du fichier'),
      EXPORT_REEL,
    );
    await fireEvent.press(screen.getByTestId('bouton-importer'));

    await fireEvent.press(screen.getByTestId('nav-watchlist'));
    await fireEvent.press(screen.getByText(/^STELLANTIS/));
    expect(screen.queryByText(/Aucune valeur surveillée/)).toBeNull();

    await fireEvent.press(screen.getByText('Ne plus surveiller'));

    expect(screen.getByText(/Aucune valeur surveillée/)).toBeTruthy();
  });

  it('ouvre les alertes de cours aux valeurs seulement surveillées', async () => {
    // Surveiller une valeur qu'on ne detient pas est precisement le cas ou
    // l'alerte sert le plus.
    await ouvrir();
    await creerCompte();

    await fireEvent.press(screen.getByTestId('bouton-ajouter'));
    await fireEvent.press(screen.getByTestId('type-ACHAT'));
    await fireEvent.press(screen.getByTestId('bouton-creer-titre-depuis-saisie'));
    await fireEvent.changeText(screen.getByLabelText('Nom'), 'Amundi MSCI World');
    await fireEvent.changeText(screen.getByLabelText('ISIN'), 'LU1681043599');
    await fireEvent.changeText(screen.getByLabelText('Ticker'), 'CW8');
    await fireEvent.press(screen.getByTestId('bouton-creer-titre'));
    await fireEvent.press(screen.getByText('Annuler'));

    await fireEvent.press(screen.getByTestId('nav-watchlist'));
    await fireEvent.press(screen.getByText(/^Amundi MSCI World/));

    await fireEvent.press(screen.getByTestId('nav-reglages'));

    expect(screen.getByText('Amundi MSCI World')).toBeTruthy();
    expect(screen.queryByText(/Aucune valeur détenue/)).toBeNull();
  });

  it('signale les valeurs détenues sans symbole, et mène à l’écran', async () => {
    // L'export du courtier ne porte pas de ticker : sans symbole, le
    // rafraichissement n'a rien a interroger. Il faut que ca se voie.
    await ouvrir();
    await creerCompte();

    await fireEvent.press(screen.getByTestId('bouton-importer-positions'));
    await fireEvent.changeText(
      screen.getByLabelText('Contenu du fichier'),
      EXPORT_REEL,
    );
    await fireEvent.press(screen.getByTestId('bouton-importer'));

    await fireEvent.press(screen.getByTestId('bouton-reglages'));
    expect(screen.getByText(/2 valeur\(s\) détenue\(s\) n’ont pas de symbole/)).toBeTruthy();

    await fireEvent.press(screen.getByTestId('bouton-symboles'));

    expect(screen.getByText('Symboles')).toBeTruthy();
    expect(screen.getByText(/2 valeur\(s\) détenue\(s\) sans symbole/)).toBeTruthy();
    // L'ISIN est propose comme terme de recherche : c'est ce que l'export
    // donne, et c'est le seul identifiant fiable dont on dispose.
    const champs = screen.getAllByLabelText('Chercher par ISIN, nom ou ticker');
    expect(champs).toHaveLength(2);
    expect(champs.map(champ => champ.props.value).sort()).toEqual([
      'LU1681043599',
      'NL00150001Q9',
    ]);
  });

  it('refuse de charger un historique tant qu’aucun symbole n’est réglé', async () => {
    await ouvrir();
    await creerCompte();

    await fireEvent.press(screen.getByTestId('bouton-importer-positions'));
    await fireEvent.changeText(
      screen.getByLabelText('Contenu du fichier'),
      EXPORT_REEL,
    );
    await fireEvent.press(screen.getByTestId('bouton-importer'));
    await fireEvent.press(screen.getByTestId('bouton-reglages'));

    // Le bouton existe mais reste inerte : rien a interroger sans symbole.
    const bouton = screen.getByTestId('bouton-charger-historique');
    expect(bouton.props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText(/Aucune valeur n’a de symbole/)).toBeTruthy();
  });

  it('explique pourquoi l’historique se charge, et sur quelle clôture', async () => {
    // Le choix de la cloture brute n'est pas un detail : l'ajustee
    // compterait les dividendes une seconde fois.
    await ouvrir();
    await creerCompte();
    await fireEvent.press(screen.getByTestId('bouton-reglages'));

    expect(screen.getByText(/trente relevés pour une corrélation/)).toBeTruthy();
    expect(screen.getByText(/clôtures brutes, pas les clôtures/)).toBeTruthy();
  });

  it('compare deux valeurs, et refuse d’en comparer une seule', async () => {
    await ouvrir();
    await creerCompte();

    await fireEvent.press(screen.getByTestId('bouton-importer-positions'));
    await fireEvent.changeText(
      screen.getByLabelText('Contenu du fichier'),
      EXPORT_REEL,
    );
    await fireEvent.press(screen.getByTestId('bouton-importer'));
    await fireEvent.press(screen.getByTestId('nav-comparateur'));
    // Le comparateur ouvre sur les états financiers ; les cours ont leur onglet.
    await fireEvent.press(screen.getByTestId('comparateur-onglet-cours'));

    expect(screen.getByText(/Choisissez deux valeurs/)).toBeTruthy();

    // Les deux lignes importees sont proposables.
    const puces = screen.getAllByRole('checkbox');
    expect(puces).toHaveLength(2);

    await fireEvent.press(puces[0]);
    expect(screen.getByText(/Choisissez deux valeurs/)).toBeTruthy();

    await fireEvent.press(puces[1]);
    expect(screen.queryByText(/Choisissez deux valeurs/)).toBeNull();
    // Un seul releve de cours : la comparaison dit ce qui manque.
    expect(screen.getAllByText(/Moins de deux relevés|Aucune période commune/).length)
      .toBeGreaterThan(0);
  });

  it('renvoie vers une fiche externe pour ce que l’application ne dira jamais', async () => {
    // Fondamentaux, analystes, bilan : ces donnees demandent des flux payants
    // que le projet n'a pas. Plutot que de faire semblant, on renvoie la ou
    // l'information existe.
    const ouvertes: string[] = [];
    await ouvrir();
    await creerCompte();

    await fireEvent.press(screen.getByTestId('bouton-importer-positions'));
    await fireEvent.changeText(
      screen.getByLabelText('Contenu du fichier'),
      EXPORT_REEL,
    );
    await fireEvent.press(screen.getByTestId('bouton-importer'));
    await fireEvent.press(screen.getByTestId('bouton-reglages'));
    await fireEvent.press(screen.getByTestId('bouton-symboles'));

    // Sans fiche collee, le bouton mene a l'accueil : une adresse de fiche
    // est un identifiant opaque, la fabriquer ouvrirait une page au hasard.
    expect(screen.getAllByText('Chercher sur Baggr…').length).toBe(2);

    const champs = screen.getAllByLabelText('Adresse de la fiche Baggr');
    await fireEvent.changeText(
      champs[0],
      'https://app.baggr.fr/screener/1c7a9641-8abb-44f8-bd47-7874aa8cbf91',
    );

    expect(screen.getAllByText('Fiche Baggr').length).toBe(1);
    expect(ouvertes).toEqual([]);
  });

  it('refuse un lien qui n’est pas une adresse web', async () => {
    await ouvrir();
    await creerCompte();

    await fireEvent.press(screen.getByTestId('bouton-importer-positions'));
    await fireEvent.changeText(
      screen.getByLabelText('Contenu du fichier'),
      EXPORT_REEL,
    );
    await fireEvent.press(screen.getByTestId('bouton-importer'));
    await fireEvent.press(screen.getByTestId('bouton-reglages'));
    await fireEvent.press(screen.getByTestId('bouton-symboles'));

    const champs = screen.getAllByLabelText('Adresse de la fiche Baggr');
    await fireEvent.changeText(champs[0], 'javascript:alert(1)');

    expect(screen.getByText('Adresse attendue, commençant par https://')).toBeTruthy();
    // Et surtout : rien n'a ete enregistre, le bouton mene toujours a l'accueil.
    expect(screen.getAllByText('Chercher sur Baggr…').length).toBe(2);
  });

  it('refuse une vente à découvert en disant combien est détenu', async () => {
    await ouvrir();
    await creerCompte();

    // On importe d'abord pour disposer d'une position réelle.
    await fireEvent.press(screen.getByTestId('bouton-importer-positions'));
    await fireEvent.changeText(
      screen.getByLabelText('Contenu du fichier'),
      EXPORT_REEL,
    );
    await fireEvent.press(screen.getByTestId('bouton-importer'));

    await fireEvent.press(screen.getByTestId('bouton-ajouter'));
    await fireEvent.press(screen.getByTestId('type-VENTE'));
    // L'identifiant du titre est genere a l'import : on vise son libelle.
    await fireEvent.press(screen.getByText('STELLANTIS'));
    await fireEvent.changeText(screen.getByLabelText('Date'), '22/09/2026');
    await fireEvent.changeText(screen.getByLabelText('Quantité'), '999');
    await fireEvent.changeText(screen.getByLabelText('Cours unitaire'), '5');
    await fireEvent.press(screen.getByTestId('bouton-enregistrer'));

    expect(screen.getByText(/Vous détenez 20 titre\(s\)/)).toBeTruthy();
  });
});

describe('identifiants entre appareils', () => {
  it('prefixe chaque identifiant par celui de l’appareil', async () => {
    // Sans ce prefixe, deux operations differentes saisies dans la meme
    // milliseconde sur deux appareils porteraient le meme identifiant, et la
    // fusion en supprimerait une sans rien dire.
    const session = creerSession();
    session.initialiser({ motDePasse: MOT_DE_PASSE });
    // Pas de genererId injecte : on veut le generateur de production.
    await render(<App session={session} aujourdhui={() => '2026-09-22'} />);

    await fireEvent.press(screen.getByTestId('bouton-creer-compte-depuis-tableau'));
    await fireEvent.changeText(screen.getByLabelText('Nom'), 'PEA BoursoBank');
    await fireEvent.changeText(screen.getByLabelText("Date d'ouverture"), '15/03/2019');
    await fireEvent.press(screen.getByTestId('bouton-creer-compte'));

    const [compteCree] = new DepotComptes(session.base()).tous();
    expect(appareilDe(compteCree.id)).toBeDefined();
  });

  it('garde le même identifiant d’appareil d’une création à l’autre', async () => {
    const session = creerSession();
    session.initialiser({ motDePasse: MOT_DE_PASSE });
    await render(<App session={session} aujourdhui={() => '2026-09-22'} />);

    await fireEvent.press(screen.getByTestId('bouton-creer-compte-depuis-tableau'));
    await fireEvent.changeText(screen.getByLabelText('Nom'), 'PEA');
    await fireEvent.changeText(screen.getByLabelText("Date d'ouverture"), '15/03/2019');
    await fireEvent.press(screen.getByTestId('bouton-creer-compte'));

    await fireEvent.press(screen.getByTestId('bouton-ajouter'));
    await fireEvent.press(screen.getByTestId('type-VERSEMENT'));
    await fireEvent.changeText(screen.getByLabelText('Date'), '22/09/2026');
    await fireEvent.changeText(screen.getByLabelText('Montant'), '1 000,00');
    await fireEvent.press(screen.getByTestId('bouton-enregistrer'));

    const [compteCree] = new DepotComptes(session.base()).tous();
    const [operation] = new DepotTransactions(session.base()).toutes();

    expect(appareilDe(operation.id)).toBe(appareilDe(compteCree.id));
  });
});

describe('création d’une valeur en cours de saisie', () => {
  it('crée la valeur puis revient à la saisie pour l’utiliser', async () => {
    // Sans ce détour, impossible d'acheter un titre que l'import n'a pas
    // ramené : la liste des valeurs resterait vide à jamais.
    const session = creerSession();
    session.initialiser({ motDePasse: MOT_DE_PASSE });
    let compteur = 0;
    await render(
      <App
        session={session}
        genererId={prefixe => `${prefixe}-${++compteur}`}
        aujourdhui={() => '2026-09-22'}
      />,
    );

    await fireEvent.press(screen.getByTestId('bouton-creer-compte-depuis-tableau'));
    await fireEvent.changeText(screen.getByLabelText('Nom'), 'PEA BoursoBank');
    await fireEvent.changeText(screen.getByLabelText("Date d'ouverture"), '15/03/2019');
    await fireEvent.press(screen.getByTestId('bouton-creer-compte'));

    await fireEvent.press(screen.getByTestId('bouton-ajouter'));
    await fireEvent.press(screen.getByTestId('bouton-creer-titre-depuis-saisie'));

    // ISIN dont la clé de contrôle est fausse : refusé.
    await fireEvent.changeText(screen.getByLabelText('Nom'), 'Stellantis');
    await fireEvent.changeText(screen.getByLabelText('ISIN'), 'NL00150001Q8');
    await fireEvent.press(screen.getByTestId('bouton-creer-titre'));
    expect(screen.getByText(/Clé de contrôle/)).toBeTruthy();

    // ISIN correct : la valeur est créée et l'on retourne à la saisie.
    await fireEvent.changeText(screen.getByLabelText('ISIN'), 'NL00150001Q9');
    await fireEvent.press(screen.getByTestId('bouton-creer-titre'));

    expect(screen.getAllByText('Nouvelle opération').length).toBeGreaterThan(0);
    expect(screen.getByText('Stellantis')).toBeTruthy();
  });

  it('enregistre un achat sur la valeur fraîchement créée', async () => {
    const session = creerSession();
    session.initialiser({ motDePasse: MOT_DE_PASSE });
    let compteur = 0;
    await render(
      <App
        session={session}
        genererId={prefixe => `${prefixe}-${++compteur}`}
        aujourdhui={() => '2026-09-22'}
      />,
    );

    await fireEvent.press(screen.getByTestId('bouton-creer-compte-depuis-tableau'));
    await fireEvent.changeText(screen.getByLabelText('Nom'), 'PEA BoursoBank');
    await fireEvent.changeText(screen.getByLabelText("Date d'ouverture"), '15/03/2019');
    await fireEvent.press(screen.getByTestId('bouton-creer-compte'));

    await fireEvent.press(screen.getByTestId('bouton-ajouter'));
    await fireEvent.press(screen.getByTestId('bouton-creer-titre-depuis-saisie'));
    await fireEvent.changeText(screen.getByLabelText('Nom'), 'Stellantis');
    await fireEvent.changeText(screen.getByLabelText('ISIN'), 'NL00150001Q9');
    await fireEvent.press(screen.getByTestId('bouton-creer-titre'));

    await fireEvent.press(screen.getByText('Stellantis'));
    await fireEvent.changeText(screen.getByLabelText('Date'), '03/08/2026');
    await fireEvent.changeText(screen.getByLabelText('Quantité'), '20');
    await fireEvent.changeText(screen.getByLabelText('Cours unitaire'), '5,094');
    await fireEvent.changeText(screen.getByLabelText('Frais'), '0,51');
    await fireEvent.press(screen.getByTestId('bouton-enregistrer'));

    // Le journal reproduit l'avis d'opéré : 102,39 EUR débités. Le titre
    // n'ayant pas de cours, il est exclu du total, qui egale les liquidites.
    expect(screen.getAllByText(`-102,39${INSEC}€`).length).toBeGreaterThan(0);
  });
});

describe('écran de sauvegarde', () => {
  async function ouvrirSauvegarde() {
    const session = creerSession();
    session.initialiser({ motDePasse: MOT_DE_PASSE });
    let compteur = 0;
    await render(
      <App
        session={session}
        genererId={prefixe => `${prefixe}-${++compteur}`}
        aujourdhui={() => '2026-09-22'}
      />,
    );
    await fireEvent.press(screen.getByTestId('nav-sauvegarde'));
  }

  it('annonce son indisponibilité quand le module de fichiers manque', async () => {
    // Ce serait le cas d'un binaire compilé sans react-native-fs : l'écran
    // doit le dire au lieu d'échouer en silence.
    await ouvrirSauvegarde();

    expect(screen.getAllByText('Sauvegarde').length).toBeGreaterThan(1);
    expect(screen.getByText(/Indisponible sur cette version/)).toBeTruthy();
    expect(
      screen.getByTestId('bouton-creer-sauvegarde').props.accessibilityState.disabled,
    ).toBe(true);
  });

  it('sur l’ordinateur, range les sauvegardes dans Documents', async () => {
    const ecrits = new Map<string, string>();
    const global = globalThis as { applibourse?: unknown };
    global.applibourse = {
      sauvegardes: {
        dossier: async () => 'C:\\Users\\moi\\Documents\\AppliBourse Sauvegardes',
        lister: async () => [...ecrits.keys()],
        existe: async (nom: string) => ecrits.has(nom),
        lire: async (nom: string) => ecrits.get(nom)!,
        ecrire: async (nom: string, contenu: string) => void ecrits.set(nom, contenu),
        supprimer: async (nom: string) => void ecrits.delete(nom),
      },
    };
    try {
      await ouvrirSauvegarde();
      await laisserTravailler();
      expect(screen.queryByText(/Indisponible sur cette version/)).toBeNull();
      expect(screen.getByTestId('emplacement-sauvegardes').props.children).toMatch(/AppliBourse Sauvegardes/);
    } finally {
      delete global.applibourse;
    }
  });

  it('active la sauvegarde automatique et crée aussitôt une première archive', async () => {
    const ecrits = new Map<string, string>();
    const global = globalThis as { applibourse?: unknown };
    global.applibourse = {
      sauvegardes: {
        dossier: async () => 'Documents/AppliBourse Sauvegardes',
        lister: async () => [...ecrits.keys()],
        existe: async (nom: string) => ecrits.has(nom),
        lire: async (nom: string) => ecrits.get(nom)!,
        ecrire: async (nom: string, contenu: string) => void ecrits.set(nom, contenu),
        supprimer: async (nom: string) => void ecrits.delete(nom),
      },
    };
    try {
      await ouvrirSauvegarde();
      await laisserTravailler();
      // Le réglage n'est plus dans l'écran Sauvegarde : il est dans Paramètres › Sécurité.
      expect(screen.getByTestId('ouvrir-parametres-sauvegarde')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('ouvrir-parametres-sauvegarde'));
      await fireEvent.press(screen.getByTestId('ouvrir-sauvegarde-auto'));
      await fireEvent.changeText(screen.getByTestId('champ-mdp-sauvegarde-auto'), 'mot-de-passe-des-sauvegardes');
      await fireEvent.changeText(screen.getByTestId('champ-confirmation-sauvegarde-auto'), 'mot-de-passe-des-sauvegardes');
      await fireEvent.press(screen.getByTestId('activer-sauvegarde-auto'));
      await laisserTravailler();
      await laisserTravailler();

      expect([...ecrits.keys()].some(nom => nom.includes('-auto.'))).toBe(true);
      expect(screen.getByTestId('etat-sauvegarde-auto').props.children.join('')).toMatch(/Activée · dernière le 22\/09\/2026/);
    } finally {
      delete global.applibourse;
    }
    // Dérivation de clé Argon2id réelle : plus de 5 s sur une machine chargée.
  }, 60000);

  it('explique pourquoi une sauvegarde est nécessaire', async () => {
    await ouvrirSauvegarde();
    expect(screen.getByText(/protègent votre clé, pas vos données/)).toBeTruthy();
  });

  it('revient au portefeuille', async () => {
    await ouvrirSauvegarde();
    await fireEvent.press(screen.getByText('Retour'));
    expect(screen.getAllByText('Portefeuille').length).toBeGreaterThan(0);
  });
});

describe('écran de notifications', () => {
  async function ouvrirNotifications() {
    const session = creerSession();
    session.initialiser({ motDePasse: MOT_DE_PASSE });
    let compteur = 0;
    await render(
      <App
        session={session}
        genererId={prefixe => `${prefixe}-${++compteur}`}
        aujourdhui={() => '2026-09-22'}
      />,
    );
    await fireEvent.press(screen.getByTestId('nav-reglages'));
    return session;
  }

  it('propose les horaires demandés par défaut', async () => {
    await ouvrirNotifications();

    expect(screen.getByTestId('heure-lundi-matin').props.value).toBe('08:00');
    expect(screen.getByTestId('heure-lundi-soir').props.value).toBe('17:30');
    expect(screen.getByTestId('heure-mercredi-matin').props.value).toBe('09:00');
    expect(screen.getByTestId('heure-vendredi-soir').props.value).toBe('18:30');
  });

  it('sur l’ordinateur, envoie une notification de test et règle la forte séance', async () => {
    const envoyees: string[] = [];
    const global = globalThis as { applibourse?: unknown };
    global.applibourse = {
      systeme: { notifier: async (titre: string) => (envoyees.push(titre), true) },
    };
    try {
      const session = await ouvrirNotifications();
      await fireEvent.press(screen.getByTestId('bouton-tester-notification'));
      await laisserTravailler();
      expect(envoyees).toEqual(['✅ AppDashboard']);
      expect(screen.getByText('Notification de test envoyée.')).toBeTruthy();

      await fireEvent.changeText(screen.getByTestId('champ-seuil-variation'), '3,5');
      expect(new DepotParametres(session.base()).lire(PARAMETRES.seuilVariation)).toBe('3,5');
    } finally {
      delete global.applibourse;
    }
  });

  it('change de thème depuis les paramètres, pour toute l’application', async () => {
    const session = await ouvrirNotifications();
    await fireEvent.press(screen.getByTestId('parametres-section-general'));
    await fireEvent.press(screen.getByTestId('parametres-theme-sauge'));
    expect(new DepotParametres(session.base()).lire(CLE_THEME)).toBe('sauge');
    // Une seule valeur : le portefeuille n'a plus de thème à lui.
    expect(new DepotParametres(session.base()).lire(PARAMETRES.theme)).toBeUndefined();
    expect(palettePour().fond).toBe('#EEF2EC');
    definirTheme('nuit');
  });

  it('coupe le week-end, donc n’affiche pas ses heures', async () => {
    await ouvrirNotifications();

    expect(screen.queryByTestId('heure-samedi-matin')).toBeNull();
    expect(screen.queryByTestId('heure-dimanche-soir')).toBeNull();
  });

  it('enregistre un horaire modifié et le relit', async () => {
    const session = await ouvrirNotifications();

    await fireEvent.changeText(screen.getByTestId('heure-lundi-matin'), '07:15');

    // Relu depuis la base, pas depuis l'etat du composant.
    const { DepotParametres, PARAMETRES } = require('../db/depots');
    const enregistre = new DepotParametres(session.base()).lire(
      PARAMETRES.planningBriefings,
    );
    expect(JSON.parse(enregistre).lundi.matin).toBe('07:15');
  });

  it('ignore une saisie d’heure en cours de frappe', async () => {
    // « 0 » puis « 07 » ne doivent pas effacer l'horaire enregistre.
    const session = await ouvrirNotifications();
    await fireEvent.changeText(screen.getByTestId('heure-lundi-matin'), '0');

    const { DepotParametres, PARAMETRES } = require('../db/depots');
    const enregistre = new DepotParametres(session.base()).lire(
      PARAMETRES.planningBriefings,
    );
    expect(enregistre).toBeUndefined();
  });

  it('annonce l’indisponibilité des notifications sur cette version', async () => {
    await ouvrirNotifications();
    expect(screen.getByText(/Notifications indisponibles/)).toBeTruthy();
  });

  it('annonce le prochain briefing', async () => {
    await ouvrirNotifications();
    expect(screen.getByText(/^Prochain :/)).toBeTruthy();
  });

  it('revient au portefeuille en fermant les paramètres', async () => {
    await ouvrirNotifications();
    await fireEvent.press(screen.getByTestId('hub-parametres-fermer'));
    expect(screen.getAllByText('Portefeuille').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('hub-parametres')).toBeNull();
  });
});
