/**
 * Modèles PAR DÉFAUT des visuels (dans le code, jamais en base) : 11 genres × 4 formats, textes FR et EN,
 * couleurs et polices en jetons de la charte (« charte:primaire », « charte:titre ») : ils suivent la charte
 * du club. Un modèle personnalisé part d'une copie de ceux-ci (Dupliquer), retouchée dans l'éditeur.
 *
 * Mise en page : un en-tête (étiquette, logo du club), un bloc « héros » (A : logos, score, titre…) et un
 * bloc « infos » (B : date, maps, classement…), empilés en carré, portrait et story (dans les zones sûres
 * d'Instagram et de TikTok), côte à côte en paysage ; un pied (club, jeu) ; un décor néon (cadre HUD,
 * bandes diagonales). Les éléments d'un bloc sont placés en coordonnées relatives au bloc.
 */

import { trViLangue, type CleVi } from '../../i18n/visuels';
import { FORMATS, type Bilingue, type Calque, type CleFormat, type Couleur, type DocumentVisuel, type Graisse, type RefPolice, type Remplissage, type SourceImage, type SourceListe, type TypeVisuel, type Forme } from './types';

type Rel = readonly [number, number, number, number];
interface Commun {
  id: string;
  r: Rel;
  si?: string;
  opacite?: number;
  rotation?: number;
}
type Element =
  | (Commun & { k: 't'; txt: Bilingue; taille: number; police?: RefPolice; graisse?: Graisse; couleur?: Couleur | Remplissage; align?: 'gauche' | 'centre' | 'droite'; valign?: 'haut' | 'milieu' | 'bas'; maj?: boolean; esp?: number; glitch?: boolean; lueur?: Couleur; contour?: Couleur })
  | (Commun & { k: 'f'; forme: Forme; remplissage?: Couleur | Remplissage; contour?: Couleur; epaisseur?: number; coupe?: number; rayon?: number; lueur?: Couleur })
  | (Commun & { k: 'logo'; cible: 'club' | 'team' | 'adversaire' })
  | (Commun & { k: 'img'; source: SourceImage; ajustement?: 'couvrir' | 'contenir'; filtre?: 'normal' | 'gris' | 'duotone'; carre?: boolean })
  | (Commun & { k: 'liste'; source: SourceListe; ligne: Bilingue; taille: number; pas: number; max: number; police?: RefPolice; graisse?: Graisse; couleur?: Couleur; align?: 'gauche' | 'centre' | 'droite'; surligne?: Couleur; maj?: boolean });

interface Definition {
  tag: CleVi;
  /** Part du bloc A dans la hauteur utile (formats verticaux). */
  partage?: number;
  /** Image plein cadre (map du match), atténuée, derrière le décor. */
  fondImage?: { source: SourceImage; si: string };
  A: Element[];
  B: Element[];
}

/** Texte identique dans les deux langues (champs dynamiques). */
const lit = (t: string): Bilingue => ({ fr: t, en: t });
/** Texte traduit (dictionnaire des visuels). */
const k = (cle: CleVi): Bilingue => ({ fr: trViLangue('fr', cle), en: trViLangue('en', cle) });

// ------------------------------------------------------------------ Définitions des genres

const DEFINITIONS: Readonly<Record<TypeVisuel, Definition>> = {
  annonce: {
    tag: 'modele.annonce.tag',
    A: [
      { k: 'logo', id: 'logo-team', cible: 'team', r: [0.02, 0.04, 0.34, 0.6] },
      { k: 'logo', id: 'logo-adv', cible: 'adversaire', r: [0.64, 0.04, 0.34, 0.6] },
      { k: 't', id: 'vs', txt: k('modele.vs'), r: [0.36, 0.14, 0.28, 0.4], taille: 130, police: 'charte:titre', graisse: 900, couleur: 'charte:secondaire', align: 'centre', valign: 'milieu', glitch: true, lueur: 'charte:secondaire' },
      { k: 't', id: 'team', txt: lit('{team}'), r: [0, 0.7, 0.42, 0.24], taille: 44, police: 'charte:sousTitre', graisse: 700, align: 'centre', valign: 'milieu', maj: true },
      { k: 't', id: 'adv', txt: lit('{adversaire}'), r: [0.58, 0.7, 0.42, 0.24], taille: 44, police: 'charte:sousTitre', graisse: 700, align: 'centre', valign: 'milieu', maj: true },
    ],
    B: [
      { k: 't', id: 'date', txt: lit('{date}'), r: [0, 0, 1, 0.18], taille: 46, police: 'charte:sousTitre', graisse: 600, couleur: 'charte:primaire', align: 'centre', valign: 'milieu', maj: true, esp: 3 },
      { k: 't', id: 'heure', txt: lit('{heure}'), r: [0, 0.18, 1, 0.36], taille: 150, police: 'charte:chiffres', graisse: 900, align: 'centre', valign: 'milieu', lueur: 'charte:primaire' },
      { k: 't', id: 'fuseau', txt: lit('{fuseau}'), r: [0, 0.54, 1, 0.1], taille: 30, police: 'Share Tech Mono', couleur: 'charte:attenue', align: 'centre', valign: 'milieu', esp: 4 },
      { k: 't', id: 'tournoi', txt: lit('{tournoi} · {tour}'), r: [0, 0.66, 1, 0.16], taille: 38, police: 'charte:sousTitre', graisse: 600, couleur: 'charte:attenue', align: 'centre', valign: 'milieu', maj: true },
      { k: 'f', id: 'badge', forme: 'chanfrein', r: [0.4, 0.85, 0.2, 0.14], contour: 'charte:accent', epaisseur: 3, coupe: 14, si: 'champ:bo' },
      { k: 't', id: 'bo', txt: lit('{bo}'), r: [0.4, 0.85, 0.2, 0.14], taille: 34, police: 'Share Tech Mono', couleur: 'charte:accent', align: 'centre', valign: 'milieu', si: 'champ:bo' },
    ],
  },
  jour_match: {
    tag: 'modele.jour_match.tag',
    A: [
      { k: 't', id: 'titre', txt: k('modele.jour_match.titre'), r: [0, 0.04, 1, 0.58], taille: 170, police: 'charte:titre', graisse: 900, align: 'centre', valign: 'milieu', maj: true, glitch: true, lueur: 'charte:primaire' },
      { k: 't', id: 'affiche', txt: lit('{team}  vs  {adversaire}'), r: [0, 0.66, 1, 0.24], taille: 56, police: 'charte:sousTitre', graisse: 700, align: 'centre', valign: 'milieu', maj: true },
    ],
    B: [
      { k: 't', id: 'heure', txt: lit('{heure}'), r: [0, 0, 1, 0.38], taille: 160, police: 'charte:chiffres', graisse: 900, couleur: 'charte:accent', align: 'centre', valign: 'milieu', lueur: 'charte:accent' },
      { k: 't', id: 'fuseau', txt: lit('{fuseau}'), r: [0, 0.38, 1, 0.1], taille: 30, police: 'Share Tech Mono', couleur: 'charte:attenue', align: 'centre', valign: 'milieu', esp: 4 },
      { k: 't', id: 'tournoi', txt: lit('{tournoi}'), r: [0, 0.52, 1, 0.16], taille: 44, police: 'charte:sousTitre', graisse: 700, couleur: 'charte:primaire', align: 'centre', valign: 'milieu', maj: true },
      { k: 't', id: 'tour', txt: lit('{tour}'), r: [0, 0.68, 1, 0.12], taille: 34, police: 'charte:texte', graisse: 600, couleur: 'charte:attenue', align: 'centre', valign: 'milieu' },
    ],
  },
  lineup: {
    tag: 'modele.lineup.tag',
    partage: 0.46,
    A: [
      { k: 't', id: 'titre', txt: k('modele.lineup.titre'), r: [0, 0, 1, 0.34], taille: 130, police: 'charte:titre', graisse: 900, align: 'centre', valign: 'milieu', maj: true, glitch: true, lueur: 'charte:primaire' },
      { k: 't', id: 'tournoi', txt: lit('{tournoi}'), r: [0, 0.34, 1, 0.14], taille: 40, police: 'charte:sousTitre', graisse: 700, couleur: 'charte:primaire', align: 'centre', valign: 'milieu', maj: true, si: 'champ:tournoi' },
      { k: 't', id: 'team', txt: lit('{team}'), r: [0, 0.34, 1, 0.14], taille: 40, police: 'charte:sousTitre', graisse: 700, couleur: 'charte:primaire', align: 'centre', valign: 'milieu', maj: true, si: '!champ:tournoi' },
      { k: 'logo', id: 'logo-team', cible: 'team', r: [0.3, 0.5, 0.4, 0.5] },
    ],
    B: [{ k: 'liste', id: 'roster', source: 'roster', ligne: lit('{pseudo}  //  {role}'), r: [0, 0, 1, 1], taille: 44, pas: 72, max: 7, police: 'charte:titre', graisse: 700, align: 'centre', maj: true }],
  },
  resultat: {
    tag: 'modele.resultat.tag',
    fondImage: { source: { champ: 'map_1' }, si: 'champ:map_1' },
    A: [
      { k: 't', id: 'issue-v', txt: lit('{issue}'), r: [0, 0, 1, 0.26], taille: 120, police: 'charte:titre', graisse: 900, couleur: 'charte:victoire', align: 'centre', valign: 'milieu', maj: true, glitch: true, lueur: 'charte:victoire', si: 'champ:victoire' },
      { k: 't', id: 'issue-d', txt: lit('{issue}'), r: [0, 0, 1, 0.26], taille: 120, police: 'charte:titre', graisse: 900, couleur: 'charte:defaite', align: 'centre', valign: 'milieu', maj: true, glitch: true, lueur: 'charte:defaite', si: '!champ:victoire' },
      { k: 't', id: 'score-nous', txt: lit('{score_nous}'), r: [0.02, 0.28, 0.4, 0.52], taille: 250, police: 'charte:chiffres', graisse: 900, align: 'droite', valign: 'milieu', lueur: 'charte:primaire', si: 'serie' },
      { k: 't', id: 'tiret', txt: lit('-'), r: [0.42, 0.28, 0.16, 0.52], taille: 160, police: 'charte:chiffres', graisse: 700, couleur: 'charte:secondaire', align: 'centre', valign: 'milieu', si: 'serie' },
      { k: 't', id: 'score-eux', txt: lit('{score_eux}'), r: [0.58, 0.28, 0.4, 0.52], taille: 250, police: 'charte:chiffres', graisse: 900, couleur: 'charte:attenue', align: 'gauche', valign: 'milieu', si: 'serie' },
      { k: 't', id: 'place', txt: lit('{place}'), r: [0, 0.02, 1, 0.56], taille: 280, police: 'charte:chiffres', graisse: 900, couleur: 'charte:accent', align: 'centre', valign: 'milieu', lueur: 'charte:accent', glitch: true, si: 'classement' },
      { k: 't', id: 'classement', txt: lit('{classement}'), r: [0, 0.58, 1, 0.12], taille: 44, police: 'charte:sousTitre', graisse: 700, align: 'centre', valign: 'milieu', maj: true, si: 'classement' },
      { k: 't', id: 'points', txt: k('modele.resultat.points'), r: [0, 0.7, 1, 0.1], taille: 34, police: 'Share Tech Mono', couleur: 'charte:primaire', align: 'centre', valign: 'milieu', si: 'champ:points' },
      { k: 't', id: 'affiche', txt: lit('{team}  vs  {adversaire}'), r: [0, 0.82, 1, 0.16], taille: 40, police: 'charte:sousTitre', graisse: 700, align: 'centre', valign: 'milieu', maj: true, si: 'serie' },
    ],
    B: [
      { k: 'liste', id: 'maps', source: 'manches', ligne: lit('{carte}      {score}'), r: [0.08, 0.02, 0.84, 0.8], taille: 42, pas: 74, max: 5, police: 'charte:sousTitre', graisse: 700, align: 'centre', surligne: 'charte:victoire', maj: true, si: 'serie' },
      { k: 'liste', id: 'equipes', source: 'classement', ligne: lit('{place_texte}    {equipe}    {points}'), r: [0.04, 0.02, 0.92, 0.8], taille: 38, pas: 64, max: 6, police: 'charte:sousTitre', graisse: 700, align: 'centre', surligne: 'charte:primaire', maj: true, si: 'classement' },
      { k: 't', id: 'tournoi', txt: lit('{tournoi} · {tour}'), r: [0, 0.84, 1, 0.14], taille: 30, police: 'charte:texte', graisse: 600, couleur: 'charte:attenue', align: 'centre', valign: 'milieu', si: 'champ:tournoi' },
      { k: 't', id: 'genre', txt: lit('{genre_match}'), r: [0, 0.84, 1, 0.14], taille: 30, police: 'charte:texte', graisse: 600, couleur: 'charte:attenue', align: 'centre', valign: 'milieu', si: '!champ:tournoi' },
    ],
  },
  classement: {
    tag: 'modele.classement.tag',
    A: [
      { k: 't', id: 'titre', txt: k('modele.classement.titre'), r: [0, 0, 1, 0.18], taille: 60, police: 'charte:titre', graisse: 800, align: 'centre', valign: 'milieu', maj: true, esp: 2 },
      { k: 't', id: 'place', txt: lit('{place}'), r: [0, 0.18, 1, 0.56], taille: 280, police: 'charte:chiffres', graisse: 900, couleur: 'charte:accent', align: 'centre', valign: 'milieu', glitch: true, lueur: 'charte:accent' },
      { k: 't', id: 'classement', txt: lit('{classement}'), r: [0, 0.74, 1, 0.12], taille: 44, police: 'charte:sousTitre', graisse: 700, align: 'centre', valign: 'milieu', maj: true },
      { k: 't', id: 'tournoi', txt: lit('{tournoi}'), r: [0, 0.86, 1, 0.14], taille: 38, police: 'charte:sousTitre', graisse: 700, couleur: 'charte:primaire', align: 'centre', valign: 'milieu', maj: true },
    ],
    B: [
      { k: 'liste', id: 'parcours', source: 'parcours', ligne: lit('{tour}  ·  {adversaire}  ·  {score}'), r: [0, 0, 1, 0.7], taille: 32, pas: 56, max: 6, police: 'charte:sousTitre', graisse: 600, align: 'centre', surligne: 'charte:victoire', maj: true },
      { k: 't', id: 'bilan', txt: lit('{bilan}'), r: [0, 0.72, 1, 0.12], taille: 34, police: 'Share Tech Mono', couleur: 'charte:primaire', align: 'centre', valign: 'milieu', esp: 3 },
      { k: 't', id: 'gains', txt: lit('{gains}'), r: [0, 0.84, 1, 0.16], taille: 48, police: 'charte:chiffres', graisse: 800, couleur: 'charte:accent', align: 'centre', valign: 'milieu', lueur: 'charte:accent', si: 'champ:gains' },
    ],
  },
  mvp: {
    tag: 'modele.mvp.tag',
    fondImage: { source: { champ: 'map_1' }, si: 'champ:map_1' },
    A: [
      { k: 'img', id: 'agent', source: { champ: 'agent_mvp' }, r: [0.44, 0, 0.56, 1], ajustement: 'contenir', si: 'champ:agent_mvp' },
      { k: 't', id: 'titre', txt: k('modele.mvp.titre'), r: [0, 0.02, 0.62, 0.44], taille: 200, police: 'charte:titre', graisse: 900, couleur: 'charte:accent', align: 'gauche', valign: 'milieu', glitch: true, lueur: 'charte:accent' },
      { k: 't', id: 'pseudo', txt: lit('{mvp}'), r: [0, 0.48, 0.62, 0.26], taille: 96, police: 'charte:titre', graisse: 900, align: 'gauche', valign: 'milieu', maj: true, lueur: 'charte:secondaire', si: 'champ:mvp' },
      { k: 't', id: 'joueur', txt: lit('{joueur}'), r: [0, 0.48, 0.62, 0.26], taille: 96, police: 'charte:titre', graisse: 900, align: 'gauche', valign: 'milieu', maj: true, lueur: 'charte:secondaire', si: '!champ:mvp' },
      { k: 't', id: 'agent-nom', txt: lit('{mvp_agent}'), r: [0, 0.76, 0.62, 0.12], taille: 34, police: 'Share Tech Mono', couleur: 'charte:primaire', align: 'gauche', valign: 'milieu', maj: true, esp: 4 },
    ],
    B: [
      { k: 't', id: 'sous', txt: k('modele.mvp.sous'), r: [0, 0, 1, 0.16], taille: 32, police: 'Share Tech Mono', couleur: 'charte:attenue', align: 'centre', valign: 'milieu', maj: true, esp: 5 },
      { k: 't', id: 'affiche', txt: lit('{team}  {score}  {adversaire}'), r: [0, 0.2, 1, 0.24], taille: 50, police: 'charte:sousTitre', graisse: 700, align: 'centre', valign: 'milieu', maj: true },
      { k: 't', id: 'tournoi', txt: lit('{tournoi}'), r: [0, 0.46, 1, 0.16], taille: 34, police: 'charte:texte', graisse: 600, couleur: 'charte:attenue', align: 'centre', valign: 'milieu' },
    ],
  },
  recrue: {
    tag: 'modele.recrue.tag',
    A: [
      { k: 't', id: 'titre', txt: k('modele.recrue.titre'), r: [0, 0.02, 1, 0.3], taille: 120, police: 'charte:titre', graisse: 900, align: 'centre', valign: 'milieu', maj: true, glitch: true, lueur: 'charte:primaire' },
      { k: 't', id: 'joueur', txt: lit('{joueur}'), r: [0, 0.36, 1, 0.42], taille: 160, police: 'charte:titre', graisse: 900, couleur: 'charte:accent', align: 'centre', valign: 'milieu', maj: true, lueur: 'charte:accent' },
      { k: 't', id: 'poste', txt: lit('{poste}'), r: [0, 0.8, 1, 0.16], taille: 46, police: 'charte:sousTitre', graisse: 700, couleur: 'charte:primaire', align: 'centre', valign: 'milieu', maj: true, esp: 3 },
    ],
    B: [
      { k: 'logo', id: 'logo-team', cible: 'team', r: [0.34, 0, 0.32, 0.66] },
      { k: 't', id: 'team', txt: lit('{team}'), r: [0, 0.7, 1, 0.16], taille: 42, police: 'charte:sousTitre', graisse: 700, align: 'centre', valign: 'milieu', maj: true },
    ],
  },
  depart: {
    tag: 'modele.depart.tag',
    A: [
      { k: 't', id: 'titre', txt: k('modele.depart.titre'), r: [0, 0.02, 1, 0.3], taille: 130, police: 'charte:titre', graisse: 900, align: 'centre', valign: 'milieu', maj: true, glitch: true, lueur: 'charte:secondaire' },
      { k: 't', id: 'joueur', txt: lit('{joueur}'), r: [0, 0.36, 1, 0.42], taille: 150, police: 'charte:titre', graisse: 900, align: 'centre', valign: 'milieu', maj: true, lueur: 'charte:primaire' },
      { k: 't', id: 'poste', txt: lit('{poste}'), r: [0, 0.8, 1, 0.16], taille: 44, police: 'charte:sousTitre', graisse: 700, couleur: 'charte:attenue', align: 'centre', valign: 'milieu', maj: true, esp: 3 },
    ],
    B: [
      { k: 't', id: 'phrase', txt: k('modele.depart.phrase'), r: [0, 0, 1, 0.4], taille: 48, police: 'charte:sousTitre', graisse: 600, align: 'centre', valign: 'milieu' },
      { k: 'logo', id: 'logo-team', cible: 'team', r: [0.4, 0.44, 0.2, 0.4] },
      { k: 't', id: 'team', txt: lit('{team}'), r: [0, 0.86, 1, 0.14], taille: 36, police: 'charte:sousTitre', graisse: 700, couleur: 'charte:primaire', align: 'centre', valign: 'milieu', maj: true },
    ],
  },
  programme: {
    tag: 'modele.programme.tag',
    partage: 0.3,
    A: [
      { k: 't', id: 'titre', txt: k('modele.programme.titre'), r: [0, 0, 1, 0.62], taille: 120, police: 'charte:titre', graisse: 900, align: 'centre', valign: 'milieu', maj: true, glitch: true, lueur: 'charte:primaire' },
      { k: 't', id: 'semaine', txt: lit('{semaine}'), r: [0, 0.64, 1, 0.3], taille: 42, police: 'charte:sousTitre', graisse: 700, couleur: 'charte:primaire', align: 'centre', valign: 'milieu', maj: true },
    ],
    B: [
      { k: 'liste', id: 'programme', source: 'programme', ligne: k('modele.programme.ligne'), r: [0, 0, 1, 1], taille: 32, pas: 66, max: 8, police: 'charte:sousTitre', graisse: 600, align: 'gauche', maj: true },
      { k: 't', id: 'vide', txt: lit('{phrase}'), r: [0, 0.3, 1, 0.2], taille: 40, police: 'charte:sousTitre', graisse: 600, couleur: 'charte:attenue', align: 'centre', valign: 'milieu', si: 'champ:phrase' },
    ],
  },
  banniere: {
    tag: 'modele.banniere.tag',
    A: [
      { k: 't', id: 'statut', txt: k('modele.banniere.statut'), r: [0, 0, 1, 0.16], taille: 40, police: 'Share Tech Mono', couleur: 'charte:accent', align: 'centre', valign: 'milieu', maj: true, esp: 6 },
      { k: 't', id: 'tournoi', txt: lit('{tournoi}'), r: [0, 0.18, 1, 0.52], taille: 110, police: 'charte:titre', graisse: 900, align: 'centre', valign: 'milieu', maj: true, glitch: true, lueur: 'charte:primaire' },
      { k: 't', id: 'orga', txt: lit('{organisateur}'), r: [0, 0.74, 1, 0.14], taille: 36, police: 'charte:sousTitre', graisse: 600, couleur: 'charte:attenue', align: 'centre', valign: 'milieu', maj: true },
    ],
    B: [
      { k: 't', id: 'date', txt: lit('{date}'), r: [0, 0, 1, 0.2], taille: 46, police: 'charte:sousTitre', graisse: 700, couleur: 'charte:primaire', align: 'centre', valign: 'milieu', maj: true },
      { k: 't', id: 'lieu', txt: lit('{lieu}  ·  {format}'), r: [0, 0.22, 1, 0.16], taille: 36, police: 'charte:texte', graisse: 600, align: 'centre', valign: 'milieu' },
      { k: 't', id: 'cash-titre', txt: k('modele.banniere.cashprize'), r: [0, 0.44, 1, 0.12], taille: 30, police: 'Share Tech Mono', couleur: 'charte:attenue', align: 'centre', valign: 'milieu', maj: true, esp: 5, si: 'champ:cashprize' },
      { k: 't', id: 'cash', txt: lit('{cashprize}'), r: [0, 0.56, 1, 0.28], taille: 90, police: 'charte:chiffres', graisse: 900, couleur: 'charte:accent', align: 'centre', valign: 'milieu', lueur: 'charte:accent', si: 'champ:cashprize' },
    ],
  },
  libre: {
    tag: 'modele.libre.tag',
    partage: 0.62,
    A: [
      { k: 'f', id: 'guillemet', forme: 'chanfrein', r: [0, 0, 1, 1], contour: 'charte:secondaire', epaisseur: 3, coupe: 40, lueur: 'charte:secondaire', opacite: 0.8 },
      { k: 't', id: 'texte', txt: k('modele.libre.texte'), r: [0.06, 0.08, 0.88, 0.84], taille: 72, police: 'charte:sousTitre', graisse: 700, align: 'centre', valign: 'milieu' },
    ],
    B: [{ k: 't', id: 'signature', txt: k('modele.libre.signature'), r: [0, 0.1, 1, 0.3], taille: 44, police: 'Share Tech Mono', couleur: 'charte:primaire', align: 'centre', valign: 'milieu', maj: true, esp: 3 }],
  },
};

// ------------------------------------------------------------------ Mise en page par format

interface Cadre {
  W: number;
  H: number;
  marge: number;
  enTete: number;
  pied: number;
  /** Zone utile (blocs A et B). */
  zone: { x: number; y: number; l: number; h: number };
  paysage: boolean;
  /** Facteur des tailles de texte (story : un peu plus grand). */
  echelle: number;
}

const CADRES: Readonly<Record<CleFormat, Cadre>> = {
  carre: { W: 1080, H: 1080, marge: 54, enTete: 64, pied: 990, zone: { x: 80, y: 176, l: 920, h: 790 }, paysage: false, echelle: 1 },
  portrait: { W: 1080, H: 1350, marge: 54, enTete: 72, pied: 1262, zone: { x: 80, y: 190, l: 920, h: 1040 }, paysage: false, echelle: 1 },
  story: { W: 1080, H: 1920, marge: 54, enTete: 264, pied: 1442, zone: { x: 80, y: 380, l: 920, h: 1036 }, paysage: false, echelle: 1.1 },
  paysage: { W: 1920, H: 1080, marge: 54, enTete: 64, pied: 990, zone: { x: 96, y: 176, l: 1728, h: 790 }, paysage: true, echelle: 1 },
};

/** Blocs A et B du format. */
function blocs(c: Cadre, partage: number): { A: Cadre['zone']; B: Cadre['zone'] } {
  const z = c.zone;
  if (c.paysage) {
    const lA = Math.round(z.l * 0.52);
    return { A: { x: z.x, y: z.y, l: lA, h: z.h }, B: { x: z.x + lA + 48, y: z.y, l: z.l - lA - 48, h: z.h } };
  }
  const hA = Math.round(z.h * partage);
  return { A: { x: z.x, y: z.y, l: z.l, h: hA }, B: { x: z.x, y: z.y + hA + 24, l: z.l, h: z.h - hA - 24 } };
}

const remp = (v: Couleur | Remplissage | undefined, defaut: Couleur): Remplissage => (typeof v === 'object' ? v : { type: 'uni', couleur: v ?? defaut });

const base = (id: string, x: number, y: number, l: number, h: number, extra: Partial<Calque> = {}) => ({
  id,
  nom: '',
  x: Math.round(x),
  y: Math.round(y),
  l: Math.max(1, Math.round(l)),
  h: Math.max(1, Math.round(h)),
  rotation: 0,
  opacite: 1,
  verrouille: false,
  masque: false,
  si: null,
  ombre: null,
  contour: null,
  lueur: null,
  ...extra,
});

function versCalque(e: Element, bloc: Cadre['zone'], c: Cadre, prefixe: string): Calque {
  let [rx, ry, rl, rh] = e.r;
  let x = bloc.x + rx * bloc.l;
  let y = bloc.y + ry * bloc.h;
  let l = rl * bloc.l;
  let h = rh * bloc.h;
  const id = `${prefixe}-${e.id}`;
  const commun = { si: e.si ?? null, opacite: e.opacite ?? 1, rotation: e.rotation ?? 0 };
  switch (e.k) {
    case 't':
      return {
        ...base(id, x, y, l, h, commun),
        type: 'texte',
        texte: e.txt,
        police: e.police ?? 'charte:texte',
        taille: Math.round(e.taille * c.echelle),
        graisse: e.graisse ?? 400,
        italique: false,
        couleur: remp(e.couleur, 'charte:texte'),
        align: e.align ?? 'gauche',
        valign: e.valign ?? 'haut',
        interligne: 1.05,
        espacement: e.esp ?? 0,
        majuscules: e.maj ?? false,
        ajuster: true,
        glitch: e.glitch ?? false,
        lueur: e.lueur ? { couleur: e.lueur, force: 28 } : null,
        contour: e.contour ? { couleur: e.contour, epaisseur: 2 } : null,
      };
    case 'f':
      return { ...base(id, x, y, l, h, commun), type: 'forme', forme: e.forme, remplissage: e.remplissage ? remp(e.remplissage, 'charte:primaire') : null, rayon: e.rayon ?? 0, coupe: e.coupe ?? 0, contour: e.contour ? { couleur: e.contour, epaisseur: e.epaisseur ?? 2 } : null, lueur: e.lueur ? { couleur: e.lueur, force: 20 } : null };
    case 'logo':
    case 'img': {
      // Logos (et images « carrées ») : carré centré dans leur boîte.
      if (e.k === 'logo' || e.carre) {
        const cote = Math.min(l, h);
        x += (l - cote) / 2;
        y += (h - cote) / 2;
        l = cote;
        h = cote;
      }
      if (e.k === 'logo') return { ...base(id, x, y, l, h, commun), type: 'logo', cible: e.cible };
      return { ...base(id, x, y, l, h, commun), type: 'image', source: e.source, ajustement: e.ajustement ?? 'couvrir', rayon: 0, filtre: e.filtre ?? 'normal' };
    }
    case 'liste':
    default: {
      const li = e as Extract<Element, { k: 'liste' }>;
      // Lignes plus serrées si le bloc est bas (carré) : la liste tient toujours dans son bloc.
      const pas = Math.min(Math.round(li.pas * c.echelle), Math.floor(h / Math.max(1, li.max)) || li.pas);
      const taille = Math.min(Math.round(li.taille * c.echelle), Math.round(pas * 0.72));
      return {
        ...base(id, x, y, l, h, commun),
        type: 'liste',
        source: li.source,
        ligne: li.ligne,
        police: li.police ?? 'charte:texte',
        taille,
        graisse: li.graisse ?? 600,
        couleur: remp(li.couleur, 'charte:texte'),
        align: li.align ?? 'gauche',
        pas,
        max: li.max,
        majuscules: li.maj ?? false,
        surligne: li.surligne ?? null,
      };
    }
  }
}

/** Décor commun : cadre HUD néon, bandes diagonales, barre d'accent, logo du club, pied (club, jeu). */
function decor(c: Cadre, tag: Bilingue): { dessous: Calque[]; dessus: Calque[] } {
  const { W, H, marge: m } = c;
  const forme = (id: string, f: Forme, x: number, y: number, l: number, h: number, extra: Record<string, unknown>): Calque => ({ ...base(id, x, y, l, h), type: 'forme', forme: f, remplissage: null, rayon: 0, coupe: 0, ...extra }) as Calque;
  const texte = (id: string, t: Bilingue, x: number, y: number, l: number, h: number, extra: Record<string, unknown>): Calque =>
    ({
      ...base(id, x, y, l, h),
      type: 'texte',
      texte: t,
      police: 'Share Tech Mono',
      taille: 28,
      graisse: 400,
      italique: false,
      couleur: { type: 'uni', couleur: 'charte:attenue' },
      align: 'gauche',
      valign: 'milieu',
      interligne: 1,
      espacement: 4,
      majuscules: true,
      ajuster: true,
      glitch: false,
      ...extra,
    }) as Calque;
  const diag = Math.hypot(W, H);
  const dessous: Calque[] = [
    // Story : les bandes passent sous le contenu, dans le bas réservé à l'interface du réseau.
    forme('deco-bande-1', 'rect', -diag * 0.1, H * (c.H > c.W * 1.5 ? 0.8 : 0.66), diag * 1.3, H * 0.08, { rotation: -14, opacite: 0.16, remplissage: { type: 'degrade', couleurs: ['charte:secondaire', 'charte:fond2'], angle: 0, radial: false } }),
    forme('deco-bande-2', 'rect', -diag * 0.1, H * (c.H > c.W * 1.5 ? 0.9 : 0.78), diag * 1.3, H * 0.012, { rotation: -14, opacite: 0.3, remplissage: { type: 'uni', couleur: 'charte:primaire' }, lueur: { couleur: 'charte:primaire', force: 20 } }),
    forme('deco-cadre', 'chanfrein', m / 2, m / 2, W - m, H - m, { coupe: 56, opacite: 0.75, contour: { couleur: 'charte:primaire', epaisseur: 3 }, lueur: { couleur: 'charte:primaire', force: 16 } }),
  ];
  const yTag = c.enTete;
  const dessus: Calque[] = [
    texte('deco-tag', tag, m + 34, yTag, W * 0.6, 48, { couleur: { type: 'uni', couleur: 'charte:accent' }, taille: 30, espacement: 6 }),
    forme('deco-barre', 'rect', m + 34, yTag + 56, 150, 6, { remplissage: { type: 'uni', couleur: 'charte:secondaire' }, lueur: { couleur: 'charte:secondaire', force: 18 } }),
    forme('deco-barre-2', 'rect', m + 194, yTag + 56, 36, 6, { remplissage: { type: 'uni', couleur: 'charte:primaire' } }),
    { ...base('deco-logo-club', W - m - 34 - 104, yTag - 16, 104, 104), type: 'logo', cible: 'club' },
    texte('deco-club', lit('{club}'), m + 34, c.pied, W * 0.45, 40, { taille: 26 }),
    texte('deco-jeu', lit('{jeu}'), W * 0.5, c.pied, W * 0.5 - m - 34, 40, { taille: 26, align: 'droite', couleur: { type: 'uni', couleur: 'charte:primaire' } }),
  ];
  return { dessous, dessus };
}

/** Modèle par défaut d'un genre, dans un format. */
export function modeleDefaut(type: TypeVisuel, format: CleFormat): DocumentVisuel {
  const def = DEFINITIONS[type];
  const c = CADRES[format];
  const partage = def.partage ?? (format === 'story' ? 0.6 : 0.56);
  const { A, B } = blocs(c, partage);
  const { dessous, dessus } = decor(c, k(def.tag));
  const calques: Calque[] = [];
  if (def.fondImage) calques.push({ ...base('fond-image', 0, 0, c.W, c.H, { si: def.fondImage.si, opacite: 0.22 }), type: 'image', source: def.fondImage.source, ajustement: 'couvrir', rayon: 0, filtre: 'duotone' });
  calques.push(...dessous);
  calques.push(...def.A.map(e => versCalque(e, A, c, 'a')), ...def.B.map(e => versCalque(e, B, c, 'b')));
  calques.push(...dessus);
  return { v: 1, format, fond: { type: 'degrade', couleurs: ['charte:fond', 'charte:fond2'], angle: 155, radial: false }, effets: null, calques };
}

/** Les quatre formats d'un modèle par défaut (pour une duplication en modèle personnalisé). */
export const documentsDefaut = (type: TypeVisuel): Record<CleFormat, DocumentVisuel> => ({
  carre: modeleDefaut(type, 'carre'),
  portrait: modeleDefaut(type, 'portrait'),
  story: modeleDefaut(type, 'story'),
  paysage: modeleDefaut(type, 'paysage'),
});

/** Source de données attendue par genre (choix proposé à la génération). */
export const SOURCE_DU_TYPE: Readonly<Record<TypeVisuel, 'resultat' | 'annonce' | 'tournoi' | 'membre' | 'equipe' | 'semaine' | 'libre'>> = {
  annonce: 'annonce',
  jour_match: 'annonce',
  lineup: 'tournoi',
  resultat: 'resultat',
  classement: 'tournoi',
  mvp: 'resultat',
  recrue: 'membre',
  depart: 'membre',
  programme: 'semaine',
  banniere: 'tournoi',
  libre: 'libre',
};

/** Dimensions d'un format. */
export const dimensions = (f: CleFormat) => FORMATS[f];
