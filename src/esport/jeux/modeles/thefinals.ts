/**
 * Modèle « The Finals » : jeu de données PRÉ-REMPLI de connaissances générales (aucune requête réseau),
 * TOUT « à vérifier » : classes Light / Medium / Heavy, leurs spécialisations, gadgets et armes (formes et
 * dimensions approximatives en mètres), maps (noms seulement : AUCUNE image, le Fondateur dépose les
 * siennes), modes et formats (Cashout en 3v3v3v3, Final Round en 3v3). Fusionné dans un profil existant par « Compléter avec
 * le modèle The Finals » (Administration › Jeux) : rien de ce qui existe n'est écrasé.
 */

import type { CapaciteJeu, CategorieCapacite, DonneesJeu, FormeCapacite } from '../api';
import { cleDe } from '../profil';

type Dim = Partial<Pick<CapaciteJeu, 'rayon' | 'longueur' | 'largeur' | 'ouverture' | 'portee' | 'duree' | 'charges'>>;
type Ligne = [categorie: CategorieCapacite, nom: string, forme: FormeCapacite, dim?: Dim];

const S = (nom: string, forme: FormeCapacite, dim?: Dim): Ligne => ['specialisation', nom, forme, dim];
const G = (nom: string, forme: FormeCapacite, dim?: Dim): Ligne => ['gadget', nom, forme, dim];
const A = (nom: string): Ligne => ['arme', nom, 'point'];

const CLASSES: Record<'light' | 'medium' | 'heavy', { nom: string; lignes: Ligne[] }> = {
  light: {
    nom: 'Light',
    lignes: [
      S('Cloaking Device', 'point', { duree: 10 }),
      S('Evasive Dash', 'point', { portee: 6, charges: 3 }),
      S('Grappling Hook', 'ligne', { longueur: 20 }),
      G('Breach Charge', 'cercle', { rayon: 3 }),
      G('Gateway', 'point', { duree: 30 }),
      G('Glitch Grenade', 'cercle', { rayon: 5, duree: 6 }),
      G('Goo Grenade', 'cercle', { rayon: 3 }),
      G('Gravity Vortex', 'cercle', { rayon: 5, duree: 5 }),
      G('H+ Infuser', 'point'),
      G('Pyro Grenade', 'cercle', { rayon: 4, duree: 9 }),
      G('Smoke Grenade', 'cercle', { rayon: 6, duree: 15 }),
      G('Sonar Grenade', 'cercle', { rayon: 12, duree: 6 }),
      G('Thermal Bore', 'rect', { longueur: 6, largeur: 1 }),
      G('Thermal Vision', 'cone', { ouverture: 90, portee: 50, duree: 10 }),
      G('Tracking Dart', 'point', { duree: 10 }),
      G('Vanishing Bomb', 'cercle', { rayon: 6, duree: 5 }),
      A('93R'),
      A('ARN-220'),
      A('Dagger'),
      A('LH1'),
      A('M11'),
      A('M26 Matter'),
      A('Recurve Bow'),
      A('SH1900'),
      A('Sword'),
      A('Throwing Knives'),
      A('V9S'),
      A('XP-54'),
    ],
  },
  medium: {
    nom: 'Medium',
    lignes: [
      S('Dematerializer', 'rect', { longueur: 2, largeur: 2, duree: 5, charges: 2 }),
      S('Guardian Turret', 'cone', { ouverture: 90, portee: 30 }),
      S('Healing Beam', 'ligne', { longueur: 15 }),
      G('APS Turret', 'cercle', { rayon: 8 }),
      G('Data Reshaper', 'point'),
      G('Defibrillator', 'point'),
      G('Explosive Mine', 'cercle', { rayon: 3 }),
      G('Flashbang', 'cercle', { rayon: 8, duree: 3 }),
      G('Frag Grenade', 'cercle', { rayon: 5 }),
      G('Gas Grenade', 'cercle', { rayon: 5, duree: 10 }),
      G('Gas Mine', 'cercle', { rayon: 5, duree: 10 }),
      G('Glitch Trap', 'cercle', { rayon: 6 }),
      G('Goo Grenade', 'cercle', { rayon: 3 }),
      G('Jump Pad', 'cercle', { rayon: 2, duree: 30 }),
      G('Proximity Sensor', 'cercle', { rayon: 10 }),
      G('Pyro Grenade', 'cercle', { rayon: 4, duree: 9 }),
      G('Smoke Grenade', 'cercle', { rayon: 6, duree: 15 }),
      G('Zipline', 'ligne', { longueur: 40 }),
      A('AKM'),
      A('CB-01 Repeater'),
      A('CL-40'),
      A('Cerberus 12GA'),
      A('Dual Blades'),
      A('FAMAS'),
      A('FCAR'),
      A('Model 1887'),
      A('Pike-556'),
      A('R.357'),
      A('Riot Shield'),
    ],
  },
  heavy: {
    nom: 'Heavy',
    lignes: [
      S('Charge ’N’ Slam', 'cercle', { rayon: 6 }),
      S('Goo Gun', 'cone', { ouverture: 20, portee: 20 }),
      S('Mesh Shield', 'mur', { longueur: 3, largeur: 0.3 }),
      S('Winch Claw', 'ligne', { longueur: 20 }),
      G('Anti-Gravity Cube', 'cercle', { rayon: 4, duree: 15 }),
      G('Barricade', 'mur', { longueur: 2.5, largeur: 0.4 }),
      G('C4', 'cercle', { rayon: 5 }),
      G('Dome Shield', 'cercle', { rayon: 4.5, duree: 12 }),
      G('Explosive Mine', 'cercle', { rayon: 3 }),
      G('Flashbang', 'cercle', { rayon: 8, duree: 3 }),
      G('Frag Grenade', 'cercle', { rayon: 5 }),
      G('Goo Grenade', 'cercle', { rayon: 3 }),
      G('Proximity Sensor', 'cercle', { rayon: 10 }),
      G('Pyro Grenade', 'cercle', { rayon: 4, duree: 9 }),
      G('Pyro Mine', 'cercle', { rayon: 5, duree: 9 }),
      G('RPG-7', 'cercle', { rayon: 5 }),
      G('Smoke Grenade', 'cercle', { rayon: 6, duree: 15 }),
      A('.50 Akimbo'),
      A('Flamethrower'),
      A('KS-23'),
      A('Lewis Gun'),
      A('M32GL'),
      A('M60'),
      A('SA1216'),
      A('ShAK-50'),
      A('Sledgehammer'),
      A('Spear'),
    ],
  },
};

const CARTES = ['Monaco', 'Seoul', 'Skyway Stadium', 'Las Vegas', 'SYS$HORIZON', 'Kyoto', 'Fortune Stadium', 'Bernal', 'Nozomi Citadel'];

/** Capacités pré-remplies d'une classe (light, medium, heavy), toutes « à vérifier ». */
export function capacitesTheFinals(classe: string): CapaciteJeu[] {
  const c = CLASSES[classe as keyof typeof CLASSES];
  if (!c) return [];
  return c.lignes.map(([categorie, nom, forme, dim]) => ({ cle: cleDe(nom), nom, touche: '', categorie, forme, ...(dim ?? {}), aVerifier: true }));
}

/**
 * Données du modèle The Finals (à fusionner dans un profil). `etages` : noms des étages proposés pour
 * chaque map (dans la langue de l'app), du plus bas au plus haut.
 */
export function modeleTheFinals(etages: string[]): Pick<DonneesJeu, 'formats' | 'modes' | 'cartes' | 'classes' | 'personnages' | 'roster'> {
  return {
    formats: [
      { cle: '3v3v3v3', nom: '3v3v3v3', equipes: 4, joueursParEquipe: 3, bo: [1, 3], notes: '' },
      { cle: '3v3', nom: '3v3', equipes: 2, joueursParEquipe: 3, bo: [1, 3, 5], notes: '' },
    ],
    modes: [
      { cle: 'cashout', nom: 'Cashout', description: '', formats: ['3v3v3v3'], actif: true },
      { cle: 'final-round', nom: 'Final Round', description: '', formats: ['3v3'], actif: true },
    ],
    cartes: CARTES.map(nom => ({ cle: cleDe(nom), nom, image: null, actif: true, modes: ['cashout', 'final-round'], niveaux: etages.map(n => ({ cle: cleDe(n), nom: n })) })),
    classes: Object.entries(CLASSES).map(([cle, c]) => ({ cle, nom: c.nom })),
    personnages: Object.entries(CLASSES).map(([cle, c]) => ({ cle, nom: c.nom, classe: cle, image: null, actif: true, capacites: capacitesTheFinals(cle) })),
    roster: { titulaires: 3, remplacants: 1 },
  };
}
