/**
 * Écran Prospects : bureau et téléphone, actions principales, garde d'accès.
 */

import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { chargerDonnees, donneesVides, ecrireDonnees } from '../hub/admin/donnees';
import { REGISTRE } from '../hub/registre';
import { themeHub } from '../hub/themes';
import type { ContexteHub, ServicesAdmin } from '../hub/types';
import type { Profil } from '../profils/profils';
import { ModeAffichageForce } from '../ui/mobile';
import { Prospects } from './RacineProspects';
import { enregistrerProspect, saisieVide } from './prospects';

const theme = themeHub('nuit');
const T = Date.parse('2026-10-06T10:00:00.000Z');
const fondateur: Profil = { id: 'principal', nom: 'Enzo', admin: true, creeLe: '2026-01-01' };
const ami: Profil = { id: 'ami00001', nom: 'Léa', admin: false, creeLe: '2026-01-01', apps: ['prospects'] };

function services(): ServicesAdmin & { m: Map<string, string> } {
  const m = new Map<string, string>();
  return { m, stockage: { lire: c => m.get(c), ecrire: (c, v) => void m.set(c, v) }, verifierIdentite: () => undefined, etatCoffre: () => undefined };
}

function avecProspects(s: ReturnType<typeof services>, saisies: Array<Partial<ReturnType<typeof saisieVide>>>) {
  const d = donneesVides();
  let carnet = d.prospects;
  saisies.forEach((x, i) => {
    carnet = enregistrerProspect(carnet, { ...saisieVide(), ...x }, T + i).donnees;
  });
  s.m.set('admin.donnees', ecrireDonnees({ ...d, prospects: carnet }));
  return carnet;
}

async function monter(contexte: ContexteHub, mode: 'large' | 'telephone' = 'large') {
  return render(
    <ModeAffichageForce mode={mode}>
      <Prospects contexte={{ maintenant: T, ...contexte }} theme={theme} registre={REGISTRE} onRetour={() => undefined} />
    </ModeAffichageForce>,
  );
}

const saisir = async (id: string, v: string) => fireEvent.changeText(screen.getByTestId(id), v);
const toucher = async (id: string) => fireEvent.press(screen.getByTestId(id));

describe('Prospects (bureau)', () => {
  it('ajout rapide : la fiche apparaît et est enregistrée dans la base chiffrée de l’administration', async () => {
    const s = services();
    await monter({ profil: fondateur, admin: s });
    expect(screen.getByTestId('prospects-rgpd')).toBeTruthy();
    expect(screen.getByTestId('prospects-vide')).toBeTruthy();
    await toucher('prospects-nouveau');
    await saisir('prospects-form-nom', 'Léa Martin');
    await saisir('prospects-form-email', 'lea@exemple.fr');
    await saisir('prospects-form-entreprise', 'Atelier Lune');
    await saisir('prospects-form-relance', '06/10/2026');
    await toucher('prospects-form-valider');
    expect(screen.getByTestId('prospects-avis').props.children).toMatch(/Léa Martin ajouté/);
    const carnet = chargerDonnees(s.stockage).prospects;
    const [p] = Object.values(carnet.prospects);
    expect(p).toMatchObject({ nom: 'Léa Martin', email: 'lea@exemple.fr', relance: '2026-10-06' });
    expect(screen.getByTestId(`prospects-carte-${p.id}`)).toBeTruthy();
    expect(screen.getByTestId('prospects-compteur-relancer')).toHaveTextContent(/1/);
  });

  it('refuse un doublon (casse) avec un message lisible', async () => {
    const s = services();
    avecProspects(s, [{ email: 'lea@exemple.fr' }]);
    await monter({ profil: fondateur, admin: s });
    await toucher('prospects-nouveau');
    await saisir('prospects-form-email', 'LEA@exemple.fr');
    await toucher('prospects-form-valider');
    expect(screen.getByTestId('prospects-avis').props.children).toMatch(/déjà dans le carnet/);
    expect(Object.keys(chargerDonnees(s.stockage).prospects.prospects)).toHaveLength(1);
  });

  it('ajout en lot : bilan ajoutés / doublons / invalides', async () => {
    const s = services();
    avecProspects(s, [{ email: 'deja@exemple.fr' }]);
    await monter({ profil: fondateur, admin: s });
    await toucher('prospects-ajout-lot');
    await saisir('prospects-lot-texte', 'a@exemple.fr; DEJA@exemple.fr, b@exemple.fr\nmauvaise');
    await toucher('prospects-lot-valider');
    expect(screen.getByTestId('prospects-avis').props.children).toMatch(/2 adresses ajoutées · 1 doublon ignoré · 1 invalide/);
    expect(Object.keys(chargerDonnees(s.stockage).prospects.prospects)).toHaveLength(3);
  });

  it('Écrire ouvre UN mailto avec le modèle ; « Ne plus contacter » le bloque', async () => {
    const ouvrir = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const s = services();
    const carnet = avecProspects(s, [{ nom: 'Léa Martin', entreprise: 'Lune', email: 'lea@exemple.fr' }, { nom: 'Refus', email: 'non@exemple.fr', nePlusContacter: true }]);
    const [lea, refus] = Object.values(carnet.prospects);
    await monter({ profil: fondateur, admin: s });
    await toucher(`prospects-ecrire-${lea.id}`);
    expect(screen.getByTestId('prospects-ecrire-sujet')).toHaveTextContent('Bonjour Léa');
    await toucher('prospects-ecrire-ouvrir');
    expect(ouvrir).toHaveBeenCalledTimes(1);
    expect(ouvrir.mock.calls[0][0]).toMatch(/^mailto:lea@exemple\.fr\?subject=Bonjour%20L%C3%A9a&body=/);
    await toucher('prospects-ecrire-noter');
    expect(chargerDonnees(s.stockage).prospects.prospects[lea.id]).toMatchObject({ statut: 'contacte', relance: '2026-10-13' });
    // Refus : bouton désactivé.
    const bouton = screen.getByTestId(`prospects-ecrire-${refus.id}`);
    expect(bouton.props.accessibilityState?.disabled).toBe(true);
    expect(screen.getByTestId(`prospects-refus-${refus.id}`)).toBeTruthy();
    ouvrir.mockRestore();
  });

  it('filtre « À relancer aujourd’hui » et recherche', async () => {
    const s = services();
    avecProspects(s, [{ nom: 'Léa', email: 'lea@exemple.fr', relance: '2026-10-05' }, { nom: 'Hugo', email: 'hugo@exemple.com', relance: '2026-10-30' }]);
    await monter({ profil: fondateur, admin: s });
    expect(screen.getByTestId('prospects-resultats')).toHaveTextContent(/2 fiches affichées sur 2/);
    await toucher('prospects-vue-relancer');
    expect(screen.getByTestId('prospects-resultats')).toHaveTextContent(/1 fiche affichée sur 2/);
    await toucher('prospects-vue-tous');
    await saisir('prospects-recherche', 'hugo');
    expect(screen.getByTestId('prospects-resultats')).toHaveTextContent(/1 fiche affichée sur 2/);
  });

  it('suppression avec confirmation', async () => {
    const s = services();
    const [p] = Object.values(avecProspects(s, [{ email: 'lea@exemple.fr' }]).prospects);
    await monter({ profil: fondateur, admin: s });
    await toucher(`prospects-supprimer-${p.id}`);
    expect(chargerDonnees(s.stockage).prospects.prospects[p.id]).toBeDefined();
    await toucher('prospects-confirmer-suppression');
    expect(chargerDonnees(s.stockage).prospects.prospects[p.id]).toBeUndefined();
    expect(screen.queryByTestId(`prospects-carte-${p.id}`)).toBeNull();
  });

  it('export CSV complet par l’hôte', async () => {
    const s = services();
    avecProspects(s, [{ nom: 'Léa', email: 'lea@exemple.fr', notes: 'note' }]);
    const enregistrerFichier = jest.fn().mockResolvedValue(true);
    await monter({ profil: fondateur, admin: s, enregistrerFichier });
    await toucher('prospects-export');
    await Promise.resolve();
    const [nom, contenu] = enregistrerFichier.mock.calls[0];
    expect(nom).toBe('prospects-2026-10-06.csv');
    expect(contenu).toMatch(/nom,entreprise,email/);
    expect(contenu).toMatch(/lea@exemple\.fr/);
  });
});

describe('Prospects (téléphone)', () => {
  it('cartes en cellules, bouton principal en bas, ajout en feuille basse', async () => {
    const s = services();
    const [p] = Object.values(avecProspects(s, [{ nom: 'Léa', email: 'lea@exemple.fr' }]).prospects);
    await monter({ profil: fondateur, admin: s }, 'telephone');
    expect(screen.getByTestId('pied-collant')).toBeTruthy();
    await toucher(`prospects-carte-${p.id}`);
    expect(screen.getByTestId(`prospects-fiche-${p.id}`)).toBeTruthy();
    await toucher('prospects-feuille-fermer');
    await toucher('prospects-nouveau');
    expect(screen.getByTestId('prospects-feuille')).toBeTruthy();
    await saisir('prospects-form-email', 'hugo@exemple.com');
    await toucher('prospects-form-valider');
    expect(Object.keys(chargerDonnees(s.stockage).prospects.prospects)).toHaveLength(2);
  });
});

describe('Prospects : garde d’accès', () => {
  it('un ami (même avec le stockage) ne voit aucune donnée', async () => {
    const s = services();
    avecProspects(s, [{ nom: 'Secret', email: 'secret@exemple.fr' }]);
    await monter({ profil: ami, admin: s });
    expect(screen.getByTestId('prospects-refuse')).toBeTruthy();
    expect(screen.queryByText(/secret@exemple/)).toBeNull();
    expect(screen.queryByTestId('prospects-nouveau')).toBeNull();
  });
});
