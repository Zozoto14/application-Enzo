/**
 * Pages du hub (« Applications » / « Administration ») d'après la catégorie du
 * registre, visibilité par rang, et app Abonnements extraite de
 * l'Administration (mêmes données, absente de l'Administration).
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ID_PRINCIPAL, type Profil } from '../profils/profils';
import { Administration } from './Administration';
import { AppAbonnements } from './abonnements/AppAbonnements';
import { ID_ABONNEMENTS, APP_ABONNEMENTS } from './abonnements/registre';
import { chargerDonnees, CLE_DONNEES } from './admin/donnees';
import { Hub } from './Hub';
import { appsDeCategorie, appsDePage, categorieDe, pageEffective, pagesVisibles } from './pages';
import { peutOuvrir } from './permissions';
import { REGISTRE, ID_ADMINISTRATION, ID_PORTEFEUILLE } from './registre';
import { ID_PROSPECTS } from '../prospects/registre';
import { ID_CLAUDE_OFFICE } from '../claudeOffice/registre';
import { themeHub } from './themes';
import type { AppHub, ContexteHub, ServicesAdmin } from './types';
import type { ControleProfils } from '../ui/ecrans/CarteProfils';

const theme = themeHub('nuit');
const historique: Profil = { id: ID_PRINCIPAL, nom: 'Enzo', admin: true, creeLe: '' };
const avecRang = (role: Profil['role'], id = 'rang000001'): Profil => ({ id, nom: `Compte ${role}`, admin: false, creeLe: '', role, apps: [ID_PORTEFEUILLE], actif: true });
const lea: Profil = { id: 'leaaaa0001', nom: 'Léa', admin: false, creeLe: '', apps: [ID_PORTEFEUILLE], actif: true };

function stockageMemoire(): ServicesAdmin['stockage'] & { valeurs: Map<string, string> } {
  const valeurs = new Map<string, string>();
  return { valeurs, lire: cle => valeurs.get(cle), ecrire: (cle, valeur) => void valeurs.set(cle, valeur) };
}

function contexteDe(actuel: Profil, tous: readonly Profil[] = [actuel, lea], services = true): ContexteHub & { stockage: ReturnType<typeof stockageMemoire> } {
  const stockage = stockageMemoire();
  const profils = {
    actuel,
    tous,
    onChanger: () => undefined,
    onAjouter: async () => undefined,
    onSupprimer: async () => undefined,
    onRenommer: async () => undefined,
    onCreerCompte: async () => ({}),
    onModifierProfils: async () => undefined,
  } as unknown as ControleProfils;
  return {
    stockage,
    profil: actuel,
    profils,
    admin: services ? { stockage, verifierIdentite: () => undefined, etatCoffre: () => undefined, enregistrerFichier: async () => true } : undefined,
    maintenant: Date.parse('2026-10-06T10:00:00Z'),
  };
}

const ids = (apps: readonly AppHub[]) => apps.map(a => a.id);

describe('registre : catégorie de page', () => {
  it('chaque app déclare sa page ; les apps réservées vont en « administration »', () => {
    for (const app of REGISTRE) {
      expect(app.page === 'publique' || app.page === 'administration').toBe(true);
      expect(categorieDe(app) === 'administration').toBe(Boolean(app.adminSeulement));
    }
    expect(ids(appsDeCategorie(REGISTRE, 'publique'))).toEqual([ID_PORTEFEUILLE, 'tsuzuku', 'taches']);
    expect(ids(appsDeCategorie(REGISTRE, 'administration'))).toEqual([ID_ADMINISTRATION, ID_ABONNEMENTS, ID_PROSPECTS, ID_CLAUDE_OFFICE]);
  });

  it('une app sans catégorie est publique ; une nouvelle entrée suffit à remplir une page', () => {
    const nouvelle: AppHub = { id: 'nouvelle-app', nom: 'Nouvelle app', categorie: 'Admin', page: 'administration', description: '', icone: 'P', teinte: 'quatre', adminSeulement: true, rangs: ['fondateur'] };
    expect(categorieDe({})).toBe('publique');
    expect(ids(appsDePage([...REGISTRE, nouvelle], contexteDe(historique), 'administration'))).toEqual([ID_ADMINISTRATION, ID_ABONNEMENTS, ID_PROSPECTS, ID_CLAUDE_OFFICE, 'nouvelle-app']);
  });

  it('Abonnements : page Administration, Fondateurs seulement', () => {
    expect(APP_ABONNEMENTS.page).toBe('administration');
    expect(APP_ABONNEMENTS.rangs).toEqual(['fondateur']);
    expect(peutOuvrir(APP_ABONNEMENTS, historique)).toBe(true);
    expect(peutOuvrir(APP_ABONNEMENTS, avecRang('fondateur'))).toBe(true);
    for (const role of ['administrateur', 'gestionnaire', 'ami'] as const) {
      expect(peutOuvrir(APP_ABONNEMENTS, avecRang(role))).toBe(false);
    }
    // Retoucher la liste d'apps d'un ami ne lui ouvre rien.
    expect(peutOuvrir(APP_ABONNEMENTS, { ...lea, apps: [ID_ABONNEMENTS, ID_ADMINISTRATION] })).toBe(false);
  });
});

describe('pages visibles selon le rang', () => {
  it('Fondateur (historique ou promu) : deux pages, Administration, Abonnements, Claude Office (et Prospects pour le compte historique)', () => {
    for (const fondateur of [historique, avecRang('fondateur')]) {
      const contexte = contexteDe(fondateur);
      expect(pagesVisibles(REGISTRE, contexte)).toEqual(['publique', 'administration']);
      // Prospects : le Fondateur du compte historique seul (droits de l'app inchangés), pas un Fondateur promu ;
      // Claude Office : tout Fondateur.
      const prospects = fondateur.admin ? [ID_PROSPECTS] : [];
      expect(ids(appsDePage(REGISTRE, contexte, 'administration'))).toEqual([ID_ADMINISTRATION, ID_ABONNEMENTS, ...prospects, ID_CLAUDE_OFFICE]);
      expect(ids(appsDePage(REGISTRE, contexte, 'publique'))).not.toContain(ID_CLAUDE_OFFICE);
      expect(ids(appsDePage(REGISTRE, contexte, 'publique'))).not.toContain(ID_ABONNEMENTS);
      expect(ids(appsDePage(REGISTRE, contexte, 'publique'))).not.toContain(ID_PROSPECTS);
    }
  });

  it('Administrateur et Gestionnaire : page Administration sans Abonnements', () => {
    for (const role of ['administrateur', 'gestionnaire'] as const) {
      const contexte = contexteDe(avecRang(role));
      expect(pagesVisibles(REGISTRE, contexte)).toEqual(['publique', 'administration']);
      expect(ids(appsDePage(REGISTRE, contexte, 'administration'))).toEqual([ID_ADMINISTRATION]);
    }
  });

  it('Ami : aucune page Administration, même avec une liste retouchée ; la page demandée retombe sur Applications', () => {
    const contexte = contexteDe({ ...lea, apps: [ID_PORTEFEUILLE, ID_ADMINISTRATION, ID_ABONNEMENTS] }, [lea], false);
    const pages = pagesVisibles(REGISTRE, contexte);
    expect(pages).toEqual(['publique']);
    expect(appsDePage(REGISTRE, contexte, 'administration')).toEqual([]);
    expect(pageEffective('administration', pages)).toBe('publique');
  });
});

describe('hub (bureau) : onglets Applications · Administration', () => {
  const props = (contexte: ContexteHub) => ({ registre: REGISTRE, contexte, theme, onTheme: () => undefined, heure: 10 });

  it('un Fondateur passe d’une page à l’autre ; chaque page a ses tuiles', async () => {
    const ouvertes: string[] = [];
    await render(<Hub {...props(contexteDe(historique))} onOuvrir={id => ouvertes.push(id)} />);
    expect(screen.getByTestId('hub-page-publique').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('tuile-portefeuille')).toBeTruthy();
    expect(screen.queryByTestId('tuile-abonnements')).toBeNull();
    await fireEvent.press(screen.getByTestId('hub-page-administration'));
    expect(screen.getByTestId('hub-page-administration').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('tuile-administration')).toBeTruthy();
    expect(screen.queryByTestId('tuile-portefeuille')).toBeNull();
    await fireEvent.press(screen.getByTestId('tuile-abonnements'));
    expect(ouvertes).toEqual([ID_ABONNEMENTS]);
  });

  it('un ami n’a pas d’onglets ; l’hôte peut tenir la page', async () => {
    await render(<Hub {...props(contexteDe(lea, [lea], false))} onOuvrir={() => undefined} page="administration" />);
    expect(screen.queryByTestId('hub-pages')).toBeNull();
    expect(screen.getByTestId('hub-grille-publique')).toBeTruthy();
  });
});

describe('app Abonnements', () => {
  const racine = (contexte: ContexteHub) => <AppAbonnements contexte={contexte} theme={theme} registre={REGISTRE} onRetour={() => undefined} />;

  it('enregistre un paiement dans les mêmes données (DonneesAdmin.abonnements), journalisé', async () => {
    const contexte = contexteDe(historique);
    await render(racine(contexte));
    expect(screen.getByTestId('app-abonnements')).toBeTruthy();
    expect(screen.getByTestId('admin-section-abonnements')).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`admin-abo-paye-${lea.id}`));
    await fireEvent.changeText(screen.getByTestId('admin-abo-form-date'), '2026-10-01');
    await fireEvent.press(screen.getByTestId('admin-abo-form-valider'));
    expect(contexte.stockage.valeurs.has(CLE_DONNEES)).toBe(true);
    const donnees = chargerDonnees(contexte.stockage);
    expect(donnees.abonnements.comptes[lea.id].paiements).toHaveLength(1);
    expect(donnees.journal.some(e => e.type === 'abonnement' && /Paiement de Léa/.test(e.action))).toBe(true);
    expect(screen.getByTestId(`admin-abo-dernier-${lea.id}`)).toBeTruthy();
  });

  it('a ses propres réglages (onglet Réglages), qui écrivent au même endroit', async () => {
    const contexte = contexteDe(historique);
    await render(racine(contexte));
    await fireEvent.press(screen.getByTestId('admin-abo-reglages'));
    expect(screen.getByTestId('parametres-abonnements')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('abo-reglage-devise'), 'CHF');
    await fireEvent.press(screen.getByTestId('abo-reglage-enregistrer'));
    expect(chargerDonnees(contexte.stockage).abonnements.reglages.devise).toBe('CHF');
    await fireEvent.press(screen.getByTestId('abo-onglet-suivi'));
    expect(screen.getByTestId('admin-section-abonnements')).toBeTruthy();
  });

  it('refuse un Administrateur, un Gestionnaire ou un ami (défense en profondeur)', async () => {
    for (const role of ['administrateur', 'gestionnaire', 'ami'] as const) {
      const { unmount } = await render(racine(contexteDe(avecRang(role))));
      expect(screen.getByTestId('app-abonnements-refus')).toBeTruthy();
      expect(screen.queryByTestId('admin-section-abonnements')).toBeNull();
      await unmount();
    }
  });
});

describe('Administration : plus de section Abonnements', () => {
  it('un Fondateur n’y trouve ni onglet ni section Abonnements', async () => {
    const contexte = contexteDe(historique);
    await render(<Administration contexte={contexte} theme={theme} registre={REGISTRE} onRetour={() => undefined} />);
    expect(screen.getByTestId('app-administration')).toBeTruthy();
    expect(screen.getByTestId('admin-onglet-utilisateurs')).toBeTruthy();
    expect(screen.queryByTestId('admin-onglet-abonnements')).toBeNull();
    expect(screen.queryByTestId('admin-section-abonnements')).toBeNull();
  });
});
