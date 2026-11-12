/**
 * Capacités des agents de Valorant : jeu de données PRÉ-REMPLI de connaissances générales (aucune
 * requête réseau), TOUTES marquées « à vérifier » (`aVerifier`). Le Fondateur les corrige dans
 * Administration › Jeux › Valorant › Agents ; tant qu'un agent n'a pas ses capacités dans le profil,
 * l'éditeur de strats utilise celles-ci (formes à l'échelle de la map calibrée).
 *
 * Dimensions en mètres (rayon, longueur, largeur, portée), ouverture en degrés, durée en secondes, coût
 * en crédits (ultime : points d'ultime). Touches : C, Q, E (signature), X (ultime).
 */

import type { CapaciteJeu, CategorieCapacite, FormeCapacite } from '../api';
import { cleDe } from '../profil';

type Dim = Partial<Pick<CapaciteJeu, 'rayon' | 'longueur' | 'largeur' | 'ouverture' | 'portee' | 'duree' | 'charges' | 'cout' | 'courbable'>>;
type Ligne = [touche: 'C' | 'Q' | 'E' | 'X', nom: string, forme: FormeCapacite, dim: Dim];

const C = (nom: string, forme: FormeCapacite, dim: Dim): Ligne => ['C', nom, forme, dim];
const Q = (nom: string, forme: FormeCapacite, dim: Dim): Ligne => ['Q', nom, forme, dim];
const E = (nom: string, forme: FormeCapacite, dim: Dim): Ligne => ['E', nom, forme, dim];
const X = (nom: string, forme: FormeCapacite, dim: Dim): Ligne => ['X', nom, forme, dim];

/** Agent (clé du profil) → ses quatre capacités. */
const AGENTS: Record<string, Ligne[]> = {
  astra: [C('Gravity Well', 'cercle', { rayon: 4.75, duree: 2.75, cout: 150 }), Q('Nova Pulse', 'cercle', { rayon: 4.75, duree: 3.5, cout: 150 }), E('Nebula', 'cercle', { rayon: 4.75, duree: 14, charges: 2 }), X('Cosmic Divide', 'mur', { longueur: 120, largeur: 1, duree: 21, cout: 7 })],
  breach: [C('Aftershock', 'rect', { longueur: 6, largeur: 3, cout: 200 }), Q('Flashpoint', 'cone', { ouverture: 120, portee: 12, duree: 2, charges: 2, cout: 250 }), E('Fault Line', 'rect', { longueur: 45, largeur: 7, duree: 3 }), X('Rolling Thunder', 'cone', { ouverture: 60, portee: 32, duree: 6, cout: 9 })],
  brimstone: [C('Stim Beacon', 'cercle', { rayon: 6, duree: 12, cout: 200 }), Q('Incendiary', 'cercle', { rayon: 4.5, duree: 8, cout: 250 }), E('Sky Smoke', 'cercle', { rayon: 4.1, duree: 19.25, charges: 3, portee: 50, cout: 100 }), X('Orbital Strike', 'cercle', { rayon: 9, duree: 3, cout: 8 })],
  chamber: [C('Trademark', 'cercle', { rayon: 9.5, duree: 6, cout: 200 }), Q('Headhunter', 'point', { cout: 150 }), E('Rendezvous', 'cercle', { rayon: 13 }), X('Tour De Force', 'point', { cout: 8 })],
  clove: [C('Pick-Me-Up', 'point', { duree: 10, cout: 200 }), Q('Meddle', 'cercle', { rayon: 6, duree: 6, cout: 200 }), E('Ruse', 'cercle', { rayon: 4.5, duree: 14, charges: 2, cout: 150 }), X('Not Dead Yet', 'point', { duree: 12, cout: 8 })],
  cypher: [C('Trapwire', 'ligne', { longueur: 15, charges: 2, cout: 200 }), Q('Cyber Cage', 'cercle', { rayon: 3.6, duree: 7.25, charges: 2, cout: 100 }), E('Spycam', 'cone', { ouverture: 100, portee: 30 }), X('Neural Theft', 'point', { cout: 6 })],
  deadlock: [C('GravNet', 'cercle', { rayon: 6.5, cout: 200 }), Q('Sonic Sensor', 'cone', { ouverture: 90, portee: 7, cout: 200 }), E('Barrier Mesh', 'mur', { longueur: 10, largeur: 0.5, duree: 40 }), X('Annihilation', 'trajet', { longueur: 40, cout: 7 })],
  fade: [C('Prowler', 'trajet', { rayon: 4, duree: 4.5, charges: 2, cout: 250 }), Q('Seize', 'cercle', { rayon: 6, duree: 4.5, cout: 200 }), E('Haunt', 'trajet', { rayon: 30, duree: 2 }), X('Nightfall', 'rect', { longueur: 40, largeur: 24, duree: 12, cout: 8 })],
  gekko: [C('Mosh Pit', 'cercle', { rayon: 5, duree: 4, cout: 250 }), Q('Wingman', 'trajet', { rayon: 6, cout: 300 }), E('Dizzy', 'cone', { ouverture: 90, portee: 20, duree: 3.25 }), X('Thrash', 'trajet', { rayon: 6, cout: 8 })],
  harbor: [C('Cascade', 'mur', { longueur: 15, largeur: 2, duree: 5.5, cout: 150 }), Q('Cove', 'cercle', { rayon: 4.5, duree: 12, cout: 350 }), E('High Tide', 'mur', { longueur: 60, largeur: 1.5, duree: 15, courbable: true }), X('Reckoning', 'rect', { longueur: 30, largeur: 15, duree: 6, cout: 7 })],
  iso: [C('Contingency', 'mur', { longueur: 7, largeur: 1, duree: 3.5, cout: 200 }), Q('Undercut', 'rect', { longueur: 25, largeur: 1.5, duree: 4, cout: 200 }), E('Double Tap', 'point', { duree: 12 }), X('Kill Contract', 'rect', { longueur: 36, largeur: 6, cout: 7 })],
  jett: [C('Cloudburst', 'cercle', { rayon: 3.35, duree: 2.5, charges: 3, cout: 200 }), Q('Updraft', 'point', { charges: 2, cout: 150 }), E('Tailwind', 'point', { portee: 7.5 }), X('Blade Storm', 'point', { cout: 8 })],
  'kay-o': [C('FRAG/ment', 'cercle', { rayon: 4.5, duree: 2.4, cout: 200 }), Q('FLASH/drive', 'cone', { ouverture: 120, portee: 15, duree: 2.25, charges: 2, cout: 250 }), E('ZERO/point', 'cercle', { rayon: 15, duree: 8 }), X('NULL/cmd', 'cercle', { rayon: 42.5, duree: 12, cout: 8 })],
  killjoy: [C('Nanoswarm', 'cercle', { rayon: 4.5, duree: 4, charges: 2, cout: 200 }), Q('ALARMBOT', 'cercle', { rayon: 5.5, cout: 200 }), E('Turret', 'cone', { ouverture: 180, portee: 40 }), X('Lockdown', 'cercle', { rayon: 32.5, duree: 13, cout: 9 })],
  neon: [C('Fast Lane', 'mur', { longueur: 30, largeur: 4.5, duree: 6, cout: 300 }), Q('Relay Bolt', 'cercle', { rayon: 5.5, duree: 3.5, charges: 2, cout: 200 }), E('High Gear', 'point', {}), X('Overdrive', 'point', { duree: 20, cout: 7 })],
  omen: [C('Shrouded Step', 'point', { portee: 12, charges: 2, cout: 100 }), Q('Paranoia', 'rect', { longueur: 30, largeur: 4.5, duree: 2.5, cout: 300 }), E('Dark Cover', 'cercle', { rayon: 4.1, duree: 15, charges: 2, cout: 150 }), X('From the Shadows', 'point', { cout: 7 })],
  phoenix: [C('Blaze', 'mur', { longueur: 18, largeur: 1, duree: 8, courbable: true, cout: 200 }), Q('Curveball', 'cone', { ouverture: 120, portee: 15, duree: 1.1, charges: 2, cout: 250 }), E('Hot Hands', 'cercle', { rayon: 4.5, duree: 4 }), X('Run It Back', 'point', { duree: 10, cout: 6 })],
  raze: [C('Boom Bot', 'trajet', { rayon: 2, duree: 10, cout: 300 }), Q('Blast Pack', 'cercle', { rayon: 4, charges: 2, cout: 200 }), E('Paint Shells', 'cercle', { rayon: 7 }), X('Showstopper', 'cercle', { rayon: 7, cout: 8 })],
  reyna: [C('Leer', 'cercle', { rayon: 10, duree: 2, charges: 2, cout: 250 }), Q('Devour', 'point', { cout: 100 }), E('Dismiss', 'point', {}), X('Empress', 'point', { duree: 30, cout: 6 })],
  sage: [C('Barrier Orb', 'mur', { longueur: 10.5, largeur: 1, duree: 30, cout: 400 }), Q('Slow Orb', 'cercle', { rayon: 7, duree: 6.5, charges: 2, cout: 200 }), E('Healing Orb', 'point', {}), X('Resurrection', 'point', { cout: 8 })],
  skye: [C('Regrowth', 'cercle', { rayon: 18, cout: 200 }), Q('Trailblazer', 'trajet', { rayon: 5.5, cout: 250 }), E('Guiding Light', 'cone', { ouverture: 120, portee: 30, charges: 2 }), X('Seekers', 'point', { cout: 8 })],
  sova: [C('Owl Drone', 'trajet', { duree: 10, cout: 400 }), Q('Shock Bolt', 'cercle', { rayon: 4, charges: 2, cout: 150 }), E('Recon Bolt', 'trajet', { rayon: 30, duree: 3 }), X('Hunter’s Fury', 'rect', { longueur: 66, largeur: 2.5, cout: 8 })],
  tejo: [C('Stealth Drone', 'trajet', { duree: 7, cout: 300 }), Q('Special Delivery', 'cercle', { rayon: 6, duree: 3, cout: 300 }), E('Guided Salvo', 'cercle', { rayon: 4.5, charges: 2 }), X('Armageddon', 'rect', { longueur: 40, largeur: 7, cout: 8 })],
  viper: [C('Snake Bite', 'cercle', { rayon: 4.5, duree: 6.5, charges: 2, cout: 200 }), Q('Poison Cloud', 'cercle', { rayon: 4.5, cout: 200 }), E('Toxic Screen', 'mur', { longueur: 60, largeur: 1 }), X('Viper’s Pit', 'cercle', { rayon: 18, cout: 9 })],
  vyse: [C('Razorvine', 'cercle', { rayon: 6, cout: 150 }), Q('Shear', 'mur', { longueur: 7.5, largeur: 1, duree: 6, cout: 200 }), E('Arc Rose', 'cone', { ouverture: 120, portee: 30 }), X('Steel Garden', 'cercle', { rayon: 32.5, duree: 8, cout: 8 })],
  waylay: [C('Saturate', 'cercle', { rayon: 5, duree: 3, cout: 200 }), Q('Lightspeed', 'point', { portee: 10, cout: 250 }), E('Refract', 'point', {}), X('Convergent Paths', 'rect', { longueur: 40, largeur: 10, cout: 8 })],
  yoru: [C('Fakeout', 'point', { cout: 100 }), Q('Blindside', 'cone', { ouverture: 120, portee: 15, duree: 1.75, charges: 2, cout: 250 }), E('Gatecrash', 'trajet', { duree: 30 }), X('Dimensional Drift', 'point', { duree: 12, cout: 7 })],
};

const CATEGORIES: Record<Ligne[0], CategorieCapacite> = { C: 'basique', Q: 'basique', E: 'signature', X: 'ultime' };

/** Capacités pré-remplies d'un agent (clé du profil), toutes « à vérifier » ; [] si l'agent est inconnu. */
export function capacitesValorant(agent: string): CapaciteJeu[] {
  return (AGENTS[agent] ?? []).map(([touche, nom, forme, dim]) => ({ cle: cleDe(nom), nom, touche, categorie: CATEGORIES[touche], forme, ...dim, aVerifier: true }));
}

/** Agents couverts par le jeu de données. */
export const AGENTS_PREREMPLIS = Object.keys(AGENTS);
