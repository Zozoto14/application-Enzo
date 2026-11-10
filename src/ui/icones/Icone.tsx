/**
 * Icône monochrome du téléphone et des tests.
 *
 * Même contrat que `Icone.web.tsx` (SVG du site et du PC). L'application native n'embarque pas de module de dessin
 * (comme les graphiques, voir src/ui/graphiques/Graphiques.tsx) : chaque icône y a un repli en symbole TEXTE,
 * jamais un emoji en couleur (symboles sans présentation emoji, ou suivis du sélecteur texte U+FE0E).
 */

import React from 'react';
import { Text } from 'react-native';
import type { NomIcone } from './traces';
import type { ProprietesIcone } from './types';

export const REPLIS: Record<NomIcone, string> = {
  cloche: '⍾',
  'cloche-barree': '⍾',
  etincelles: '✦',
  fusee: '➚',
  megaphone: '◁',
  corbeille: '⌫',
  reglages: '⚙︎',
  membres: '⚇',
  personne: '◯',
  cadenas: '⊡',
  'cadenas-ouvert': '⊔',
  cle: '⚷',
  lien: '∞',
  oeil: '◉',
  'oeil-barre': '◌',
  etoile: '☆',
  epingle: '⚲',
  bulle: '❝',
  dossier: '▭',
  image: '▨',
  video: '▶︎',
  micro: '◖',
  musique: '♪',
  document: '▤',
  archive: '▦',
  police: 'Aa',
  palette: '◐',
  note: '✎',
  crayon: '✎',
  calendrier: '◫',
  'calendrier-jour': '◫',
  chrono: '◷',
  sablier: '⧗',
  journal: '▥',
  bouclier: '⛉',
  bouee: '◎',
  enveloppe: '✉︎',
  'carte-bancaire': '▭',
  outils: '⚒︎',
  valide: '✓',
  erreur: '✕',
  neutre: '–',
  alerte: '⚠︎',
  main: '☚',
  'pouce-haut': '+',
  'pouce-bas': '−',
  telephone: '▯',
  ordinateur: '▭',
  ampoule: '☼',
  cible: '◎',
  trophee: '♛',
  drapeau: '⚑',
  bibliotheque: '▥',
  trombone: '⌇',
  lieu: '⌖',
  interdit: '⊘',
  coeur: '♥︎',
  lecture: '▶︎',
  pause: '❚❚',
  suivant: '⏭︎',
  precedent: '⏮︎',
  externe: '↗︎',
  loupe: '⌕',
  graphique: '▥',
  robot: '⌬',
  reveil: '◷',
  recu: '▤',
  globe: '◍',
  synchro: '↻',
  cafe: '◡',
  'case-cochee': '☑︎',
  soleil: '☼',
  lune: '☾',
  appel: '☏',
  coche: '✓',
  triste: '☹\uFE0E',
  bof: '◠',
  moyen: '◡',
  content: '☻',
  ravi: '☻',
  'tendance-haut': '↗\uFE0E',
  'tendance-bas': '↘\uFE0E',
  billets: '€',
  banque: '⌂',
  portefeuille: '▭',
  bug: '⌬',
  question: '?',
  diagnostic: '✚',
  manette: '◆',
  taches: '☑\uFE0E',
  immeuble: '▣',
  carnet: '✎',
  contact: '✉\uFE0E',
  tele: '▶\uFE0E',
  tableau: '▦',
  accueil: '⌂',
  grille: '▦',
  partenaires: '★',
  medaille: '◉',
  reunion: '❐',
  viseur: '◎',
  croix: '✕',
  horizontal: '↔︎',
  vertical: '↕︎',
  'chevron-gauche': '‹',
  'chevron-droite': '›',
  'chevron-bas': '⌄',
  'chevron-haut': '⌃',
  selection: '↖︎',
};

export function Icone({ nom, taille, couleur, libelle, testID }: ProprietesIcone) {
  return (
    <Text
      testID={testID}
      accessible={Boolean(libelle)}
      accessibilityRole={libelle ? 'image' : undefined}
      accessibilityLabel={libelle}
      accessibilityElementsHidden={!libelle}
      importantForAccessibility={libelle ? 'yes' : 'no-hide-descendants'}
      style={[taille !== undefined && { fontSize: Math.round(taille * 0.85), lineHeight: taille }, couleur !== undefined && { color: couleur }]}>
      {REPLIS[nom]}
    </Text>
  );
}
