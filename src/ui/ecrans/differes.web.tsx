/**
 * Site et app PC : écrans du Portefeuille chargés à la demande (un fichier par écran, découpé par Vite). Version
 * directe (iPhone, tests) : differes.tsx.
 */

import type React from 'react';
import { differe } from '../differe';

export const FicheValeur = differe<React.ComponentProps<typeof import('./FicheValeur').FicheValeur>>(async () => (await import('./FicheValeur')).FicheValeur);
export const ComparateurFinancier = differe<React.ComponentProps<typeof import('./ComparateurFinancier').ComparateurFinancier>>(async () => (await import('./ComparateurFinancier')).ComparateurFinancier);
export const Comparateur = differe<React.ComponentProps<typeof import('./Comparateur').Comparateur>>(async () => (await import('./Comparateur')).Comparateur);
export const Podcast = differe<React.ComponentProps<typeof import('./Podcast').Podcast>>(async () => (await import('./Podcast')).Podcast);
export const Objectifs = differe<React.ComponentProps<typeof import('./Objectifs').Objectifs>>(async () => (await import('./Objectifs')).Objectifs);
export const Projection = differe<React.ComponentProps<typeof import('./Projection').Projection>>(async () => (await import('./Projection')).Projection);
export const Symboles = differe<React.ComponentProps<typeof import('./Symboles').Symboles>>(async () => (await import('./Symboles')).Symboles);
export const Watchlist = differe<React.ComponentProps<typeof import('./Watchlist').Watchlist>>(async () => (await import('./Watchlist')).Watchlist);
export const Recherche = differe<React.ComponentProps<typeof import('./Recherche').Recherche>>(async () => (await import('./Recherche')).Recherche);
export const Screener = differe<React.ComponentProps<typeof import('./Screener').Screener>>(async () => (await import('./Screener')).Screener);
export const Carnet = differe<React.ComponentProps<typeof import('./Carnet').Carnet>>(async () => (await import('./Carnet')).Carnet);
export const Diagnostic = differe<React.ComponentProps<typeof import('./Diagnostic').Diagnostic>>(async () => (await import('./Diagnostic')).Diagnostic);
export const Journal = differe<React.ComponentProps<typeof import('./Journal').Journal>>(async () => (await import('./Journal')).Journal);
export const Portefeuille = differe<React.ComponentProps<typeof import('./Portefeuille').Portefeuille>>(async () => (await import('./Portefeuille')).Portefeuille);
export const CreationCompte = differe<React.ComponentProps<typeof import('./CreationCompte').CreationCompte>>(async () => (await import('./CreationCompte')).CreationCompte);
export const CreationTitre = differe<React.ComponentProps<typeof import('./CreationTitre').CreationTitre>>(async () => (await import('./CreationTitre')).CreationTitre);
export const ImportPositions = differe<React.ComponentProps<typeof import('./ImportPositions').ImportPositions>>(async () => (await import('./ImportPositions')).ImportPositions);
export const Sauvegarde = differe<React.ComponentProps<typeof import('./Sauvegarde').Sauvegarde>>(async () => (await import('./Sauvegarde')).Sauvegarde);
export const ReglageSauvegardeAuto = differe<React.ComponentProps<typeof import('./Sauvegarde').ReglageSauvegardeAuto>>(async () => (await import('./Sauvegarde')).ReglageSauvegardeAuto);
export const Notifications = differe<React.ComponentProps<typeof import('./Notifications').Notifications>>(async () => (await import('./Notifications')).Notifications);
export const SaisieOperation = differe<React.ComponentProps<typeof import('./SaisieOperation').SaisieOperation>>(async () => (await import('./SaisieOperation')).SaisieOperation);
