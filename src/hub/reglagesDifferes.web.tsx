/**
 * Site et app PC : cartes des Paramètres propres à une app, Devblog et page Support chargés à la demande (le fichier principal ne
 * porte plus le code de Tâches ni de Tsuzuku). Version directe : reglagesDifferes.tsx.
 */

import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { differe } from '../ui/differe';

const attente = (
  <View style={{ padding: 16, alignItems: 'center' }} accessibilityLabel="Chargement" accessibilityRole="progressbar">
    <ActivityIndicator />
  </View>
);

export const ReglagesTachesFondateur = differe<React.ComponentProps<typeof import('../taches/ui/ParametresTaches').ReglagesTachesFondateur>>(async () => (await import('../taches/ui/ParametresTaches')).ReglagesTachesFondateur, { attente });
export const ReglagesTachesPerso = differe<React.ComponentProps<typeof import('../taches/ui/ParametresTaches').ReglagesTachesPerso>>(async () => (await import('../taches/ui/ParametresTaches')).ReglagesTachesPerso, { attente });
export const ReglageLectureTsuzuku = differe<React.ComponentProps<typeof import('../tsuzuku/app/ParametresTsuzuku').ReglageLectureTsuzuku>>(async () => (await import('../tsuzuku/app/ParametresTsuzuku')).ReglageLectureTsuzuku, { attente });
export const ReglageAvancesTsuzuku = differe<React.ComponentProps<typeof import('../tsuzuku/app/AdminTsuzuku').ReglageAvancesTsuzuku>>(async () => (await import('../tsuzuku/app/AdminTsuzuku')).ReglageAvancesTsuzuku, { attente });
export const ReglageSourcesPartagees = differe<React.ComponentProps<typeof import('../tsuzuku/app/AdminTsuzuku').ReglageSourcesPartagees>>(async () => (await import('../tsuzuku/app/AdminTsuzuku')).ReglageSourcesPartagees, { attente });
export const ReglageSourcesTsuzuku = differe<React.ComponentProps<typeof import('../tsuzuku/app/AdminTsuzuku').ReglageSourcesTsuzuku>>(async () => (await import('../tsuzuku/app/AdminTsuzuku')).ReglageSourcesTsuzuku, { attente });
export const Devblog = differe<React.ComponentProps<typeof import('./devblog/Devblog').Devblog>>(async () => (await import('./devblog/Devblog')).Devblog, { attente });
export const PageSupport = differe<React.ComponentProps<typeof import('./PageSupport').PageSupport>>(async () => (await import('./PageSupport')).PageSupport);
