/**
 * Claude Office, onglet « Bureau » : l'open space dessiné en SVG isométrique
 * (web, site, PC). Aucune image ni dépendance : polygones, dégradés et
 * animations CSS légères.
 *
 * - Fond fixe (sol en parquet, moquette, murs, fenêtres, salle de réunion
 *   vitrée, cuisine et machine à café, imprimante, tableau blanc, coin salon,
 *   plantes) dessiné une fois ; jour en thème clair, nuit en thème sombre
 *   (plafonniers chauds, écrans qui éclairent, ville allumée).
 * - Postes, chaises et personnages triés par profondeur ; seuls les marcheurs
 *   bougent image par image (requestAnimationFrame bridé à ~30 i/s, arrêté
 *   hors écran, onglet masqué ou quand personne ne marche). Le reste (frappe,
 *   café, pensées, écrans) : animations CSS, gelées hors écran.
 * - « Réduire les animations » : scène fixe mais expressive (poses, gadgets).
 * La scène est décorative pour les lecteurs d'écran : la liste des agents,
 * sous la scène, porte la même information (Bureau.tsx).
 */

import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { activiteAgent, apparence, avancer, creerScene, enAttente, HAUTEUR_MURS, HAUTEUR_SCENE, ILOTS_X, ISO, iso, LARGEUR_PIECE, LARGEUR_SCENE, PORTE, POSTES, PROFONDEUR_PIECE, poses, reconcilier, signatureAgents, hacher, type Activite, type Apparence, type Poste, ICONES_ACTIVITE, TEINTES_ACTIVITE } from './logiqueScene';
import { resumerTexte } from './logiqueBureau';
import type { PropsScene } from './sceneTypes';

// ------------------------------------------------------------------ palette

interface Palette {
  nuit: boolean;
  murG: string; murD: string; murHaut: string; plinthe: string;
  sol: string; lame: string; joint: string; moquette: string; moquetteMotif: string; salle: string; carreau1: string; carreau2: string; tapis: string; tapisBord: string;
  socleG: string; socleD: string; ombre: string;
  bureau: string; bureauG: string; bureauD: string; pied: string; cloison: string; cloisonD: string;
  ecranDos: string; cadre: string; eteint: string; chaise: string; assise: string;
  vitre: string; vitreBord: string; ciel1: string; ciel2: string; ville: string; villeFenetre: string;
  bulle: string; bulleTexte: string; bulleBord: string; lumiere: string; halo: string; badge: string; badgeTexte: string;
  bois: string; boisG: string; boisD: string; blanc: string; blancG: string; blancD: string; metal: string; metalG: string; metalD: string;
  canape: string; canapeG: string; canapeD: string; feuille: string; feuille2: string; pot: string;
}

function palette(nuit: boolean): Palette {
  return nuit
    ? {
      nuit,
      murG: '#2B3150', murD: '#343B5E', murHaut: '#454E78', plinthe: '#1E2238',
      sol: '#5B4532', lame: '#674F39', joint: '#46352A', moquette: '#38415C', moquetteMotif: '#3F4966', salle: '#3B3753', carreau1: '#4B4C5C', carreau2: '#41424F', tapis: '#7C4536', tapisBord: '#5F3428',
      socleG: '#3A2C21', socleD: '#2C2119', ombre: '#000000',
      bureau: '#B9AF9F', bureauG: '#8F8676', bureauD: '#7A7264', pied: '#596070', cloison: '#4C6B63', cloisonD: '#3E5952',
      ecranDos: '#2E3340', cadre: '#191C24', eteint: '#11141B', chaise: '#262B38', assise: '#343B4D',
      vitre: '#9FC4FF', vitreBord: '#AFC0E6', ciel1: '#0E1630', ciel2: '#2A2A55', ville: '#161B33', villeFenetre: '#FFD27A',
      bulle: '#FBFAF6', bulleTexte: '#1A1C22', bulleBord: '#D9D3C4', lumiere: '#FFC56E', halo: '#8DB8FF', badge: '#20253A', badgeTexte: '#F2F4FA',
      bois: '#8A6644', boisG: '#6E5035', boisD: '#5E432C', blanc: '#C9C6BE', blancG: '#A7A49C', blancD: '#93908A', metal: '#6B7385', metalG: '#555C6C', metalD: '#4A505E',
      canape: '#3F7C7A', canapeG: '#326462', canapeD: '#2A5452', feuille: '#3E8E5E', feuille2: '#2F7349', pot: '#B26B4B',
    }
    : {
      nuit,
      murG: '#EAE3D6', murD: '#F5F0E6', murHaut: '#FFFFFF', plinthe: '#CBBEA7',
      sol: '#D8B88C', lame: '#E1C49B', joint: '#C4A276', moquette: '#C5D0D9', moquetteMotif: '#BAC6D0', salle: '#D9D2E6', carreau1: '#F3EFE7', carreau2: '#E4DED2', tapis: '#E9A97D', tapisBord: '#D68C5E',
      socleG: '#B38A5C', socleD: '#9A7449', ombre: '#3A2A14',
      bureau: '#FBF7F0', bureauG: '#E1D8CA', bureauD: '#CFC5B5', pied: '#9AA3AE', cloison: '#8DB5A6', cloisonD: '#79A293',
      ecranDos: '#3B404C', cadre: '#23262E', eteint: '#2A2F3A', chaise: '#3F4658', assise: '#535C72',
      vitre: '#BFE3FF', vitreBord: '#FFFFFF', ciel1: '#7FC0F2', ciel2: '#D6EEFF', ville: '#9DB3C9', villeFenetre: '#E7F1FA',
      bulle: '#FFFFFF', bulleTexte: '#1A1C22', bulleBord: '#D8D2C4', lumiere: '#FFE7A8', halo: '#9CC7FF', badge: '#FFFFFF', badgeTexte: '#1F2330',
      bois: '#C49A6C', boisG: '#A77E53', boisD: '#936C45', blanc: '#FFFFFF', blancG: '#E3DFD7', blancD: '#D1CCC2', metal: '#AEB6C2', metalG: '#939CA9', metalD: '#828B98',
      canape: '#4E9C99', canapeG: '#3F8380', canapeD: '#36716E', feuille: '#4FA36E', feuille2: '#3B8757', pot: '#C97B57',
    };
}

// ------------------------------------------------------------------ géométrie

const r1 = (n: number) => Math.round(n * 10) / 10;
type P3 = readonly [number, number, number?];
const pts = (liste: readonly P3[]) => liste.map(([x, y, z = 0]) => { const p = iso(x, y, z); return `${r1(p.x)},${r1(p.y)}`; }).join(' ');
/** Repères de dessin : sol (x, y) à la hauteur z, plan vertical y = c (x, z), plan vertical x = c (y, z). */
const sol = (z = 0) => `matrix(${ISO.dx} ${ISO.dy} ${-ISO.dx} ${ISO.dy} ${ISO.ox} ${ISO.oy - ISO.dz * z})`;
const planY = (c: number) => `matrix(${ISO.dx} ${ISO.dy} 0 ${-ISO.dz} ${ISO.ox - ISO.dx * c} ${ISO.oy + ISO.dy * c})`;
const planX = (c: number) => `matrix(${-ISO.dx} ${ISO.dy} 0 ${-ISO.dz} ${ISO.ox + ISO.dx * c} ${ISO.oy + ISO.dy * c})`;

function Boite({ x, y, z = 0, w, d, h, dessus, gauche, droite, classe }: {
  x: number; y: number; z?: number; w: number; d: number; h: number; dessus: string; gauche: string; droite: string; classe?: string;
}) {
  return (
    <g className={classe}>
      <polygon points={pts([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]])} fill={gauche} />
      <polygon points={pts([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]])} fill={droite} />
      <polygon points={pts([[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]])} fill={dessus} />
    </g>
  );
}

function Plante({ x, y, pal, taille = 1, classe }: { x: number; y: number; pal: Palette; taille?: number; classe?: string }) {
  const p = iso(x, y);
  const k = taille;
  return (
    <g transform={`translate(${r1(p.x)} ${r1(p.y)})`} className={classe}>
      <ellipse cx={0} cy={1} rx={13 * k} ry={6 * k} fill={pal.ombre} opacity={0.14} />
      <path d={`M${-9 * k},${-16 * k} L${9 * k},${-16 * k} L${7 * k},0 L${-7 * k},0 Z`} fill={pal.pot} />
      <rect x={-10 * k} y={-19 * k} width={20 * k} height={4 * k} rx={1.5} fill={pal.pot} opacity={0.85} />
      <g className="co-feuillage">
        <ellipse cx={-8 * k} cy={-30 * k} rx={7 * k} ry={13 * k} fill={pal.feuille2} transform={`rotate(-28 ${-8 * k} ${-30 * k})`} />
        <ellipse cx={8 * k} cy={-31 * k} rx={7 * k} ry={13 * k} fill={pal.feuille2} transform={`rotate(30 ${8 * k} ${-31 * k})`} />
        <ellipse cx={0} cy={-38 * k} rx={7 * k} ry={16 * k} fill={pal.feuille} />
        <ellipse cx={-4 * k} cy={-25 * k} rx={6 * k} ry={10 * k} fill={pal.feuille} transform={`rotate(-50 ${-4 * k} ${-25 * k})`} />
        <ellipse cx={5 * k} cy={-24 * k} rx={6 * k} ry={10 * k} fill={pal.feuille} transform={`rotate(48 ${5 * k} ${-24 * k})`} />
      </g>
    </g>
  );
}

// ------------------------------------------------------------------ fond fixe

function Fenetre({ y0, y1, pal, i }: { y0: number; y1: number; pal: Palette; i: number }) {
  const z0 = 0.95;
  const z1 = 2.55;
  const id = `co-ciel-${pal.nuit ? 'n' : 'j'}`;
  const largeur = y1 - y0;
  // Silhouette de la ville (déterministe).
  const immeubles = Array.from({ length: 6 }, (_, k) => {
    const h = 0.25 + ((hacher(`${i}-${k}`) % 100) / 100) * 0.55;
    const w = largeur / 6;
    return { x: y0 + k * w, w: w * 0.92, h };
  });
  return (
    <g>
      <rect x={y0 - 0.08} y={z0 - 0.08} width={largeur + 0.16} height={z1 - z0 + 0.16} fill={pal.murHaut} />
      <rect x={y0} y={z0} width={largeur} height={z1 - z0} fill={`url(#${id})`} />
      {pal.nuit ? (
        <g>
          {[0.2, 0.5, 0.75, 0.33, 0.9].map((f, k) => (
            <circle key={k} cx={y0 + largeur * f} cy={z1 - 0.15 - (k % 3) * 0.17} r={0.025} fill="#FFFFFF" className={`co-etoile co-e${k % 3}`} />
          ))}
          {i === 1 ? <circle cx={y0 + largeur * 0.72} cy={z1 - 0.32} r={0.13} fill="#F4F1DE" /> : null}
        </g>
      ) : (
        <g className="co-nuages">
          <ellipse cx={y0 + largeur * 0.3} cy={z1 - 0.35} rx={0.32} ry={0.08} fill="#FFFFFF" opacity={0.85} />
          <ellipse cx={y0 + largeur * 0.72} cy={z1 - 0.55} rx={0.25} ry={0.06} fill="#FFFFFF" opacity={0.7} />
        </g>
      )}
      {immeubles.map((b, k) => (
        <g key={k}>
          <rect x={b.x} y={z0} width={b.w} height={b.h} fill={pal.ville} />
          {pal.nuit
            ? [0, 1, 2].map(j => ((hacher(`${i}${k}${j}`) % 3) ? <rect key={j} x={b.x + 0.06 + j * 0.11} y={z0 + b.h - 0.12} width={0.05} height={0.05} fill={pal.villeFenetre} opacity={0.85} /> : null))
            : null}
        </g>
      ))}
      {/* Montants et traverse. */}
      <rect x={y0 + largeur / 2 - 0.03} y={z0} width={0.06} height={z1 - z0} fill={pal.murHaut} />
      <rect x={y0} y={z0 + 0.62} width={largeur} height={0.04} fill={pal.murHaut} opacity={0.9} />
      <rect x={y0 - 0.1} y={z0 - 0.12} width={largeur + 0.2} height={0.06} fill={pal.plinthe} />
    </g>
  );
}

function Fond({ pal, maintenant }: { pal: Palette; maintenant: number }) {
  const W = LARGEUR_PIECE;
  const D = PROFONDEUR_PIECE;
  const H = HAUTEUR_MURS;
  const n = pal.nuit;
  const heure = new Date(maintenant);
  const angleH = ((heure.getHours() % 12) + heure.getMinutes() / 60) * 30;
  const angleM = heure.getMinutes() * 6;
  return (
    <g>
      <defs>
        <linearGradient id={`co-ciel-${n ? 'n' : 'j'}`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor={pal.ciel2} />
          <stop offset="1" stopColor={pal.ciel1} />
        </linearGradient>
        <radialGradient id="co-flaque">
          <stop offset="0" stopColor={pal.lumiere} stopOpacity={n ? 0.42 : 0.22} />
          <stop offset="1" stopColor={pal.lumiere} stopOpacity={0} />
        </radialGradient>
        <radialGradient id="co-halo">
          <stop offset="0" stopColor={pal.halo} stopOpacity={0.55} />
          <stop offset="1" stopColor={pal.halo} stopOpacity={0} />
        </radialGradient>
        <radialGradient id="co-ombre-socle">
          <stop offset="0" stopColor={pal.ombre} stopOpacity={n ? 0.5 : 0.22} />
          <stop offset="1" stopColor={pal.ombre} stopOpacity={0} />
        </radialGradient>
        <pattern id="co-lames" patternUnits="userSpaceOnUse" width={2.4} height={0.5}>
          <rect width={2.4} height={0.5} fill={pal.sol} />
          <rect width={1.2} height={0.24} fill={pal.lame} />
          <rect x={1.2} y={0.25} width={1.2} height={0.24} fill={pal.lame} opacity={0.6} />
          <rect y={0.24} width={2.4} height={0.012} fill={pal.joint} />
          <rect y={0.49} width={2.4} height={0.012} fill={pal.joint} />
        </pattern>
        <pattern id="co-carreaux" patternUnits="userSpaceOnUse" width={0.8} height={0.8}>
          <rect width={0.8} height={0.8} fill={pal.carreau1} />
          <rect width={0.4} height={0.4} fill={pal.carreau2} />
          <rect x={0.4} y={0.4} width={0.4} height={0.4} fill={pal.carreau2} />
        </pattern>
        <pattern id="co-moquette" patternUnits="userSpaceOnUse" width={1} height={1}>
          <rect width={1} height={1} fill={pal.moquette} />
          <rect width={0.5} height={1} fill={pal.moquetteMotif} />
        </pattern>
      </defs>

      {/* Ombre portée et socle de la maquette. */}
      <ellipse cx={iso(W / 2, D / 2).x} cy={iso(W, D).y - 30} rx={560} ry={70} fill="url(#co-ombre-socle)" />
      <polygon points={pts([[0, D, 0], [W, D, 0], [W, D, -0.45], [0, D, -0.45]])} fill={pal.socleG} />
      <polygon points={pts([[W, 0, 0], [W, D, 0], [W, D, -0.45], [W, 0, -0.45]])} fill={pal.socleD} />

      {/* Sol : parquet, zones de moquette, carrelage de la cuisine, tapis du salon. */}
      <g transform={sol()}>
        <rect width={W} height={D} fill="url(#co-lames)" />
        <rect x={4.1} y={5.75} width={15.6} height={4.3} rx={0.3} fill="url(#co-moquette)" />
        <rect x={0} y={0} width={4.2} height={4.4} fill={pal.salle} />
        <rect x={15.35} y={0} width={4.65} height={3.6} fill="url(#co-carreaux)" />
        <rect x={0.55} y={9.9} width={3.6} height={3.6} rx={0.5} fill={pal.tapisBord} />
        <rect x={0.75} y={10.1} width={3.2} height={3.2} rx={0.4} fill={pal.tapis} />
        {/* Lumière : soleil par les fenêtres (jour) ou flaques des plafonniers (nuit). */}
        {n ? (
          <g>
            {ILOTS_X.map(x0 => <circle key={x0} cx={x0 + 2} cy={7.75} r={3.1} fill="url(#co-flaque)" />)}
            <circle cx={2.1} cy={2.2} r={2.4} fill="url(#co-flaque)" />
            <circle cx={17.6} cy={2.2} r={2.2} fill="url(#co-flaque)" />
            <circle cx={1.1} cy={10.4} r={2.2} fill="url(#co-flaque)" />
          </g>
        ) : (
          <g fill="#FFF6D8" opacity={0.32}>
            {[[5.0, 7.4], [7.9, 10.3], [10.8, 13.2]].map(([a, b]) => (
              <polygon key={a} points={`0,${a} 0,${b} 3.4,${b + 1.4} 3.4,${a + 1.4}`} />
            ))}
          </g>
        )}
      </g>

      {/* Murs. */}
      <polygon points={pts([[0, 0, 0], [0, D, 0], [0, D, H], [0, 0, H]])} fill={pal.murG} />
      <polygon points={pts([[0, 0, 0], [W, 0, 0], [W, 0, H], [0, 0, H]])} fill={pal.murD} />
      <polygon points={pts([[0, D, H], [0, 0, H], [-0.25, -0.25, H], [-0.25, D, H]])} fill={pal.murHaut} />
      <polygon points={pts([[0, 0, H], [W, 0, H], [W, -0.25, H], [-0.25, -0.25, H]])} fill={pal.murHaut} />
      <g transform={planX(0)}>
        <rect x={0} y={0} width={D} height={0.14} fill={pal.plinthe} />
        <Fenetre y0={5.0} y1={7.4} pal={pal} i={0} />
        <Fenetre y0={7.9} y1={10.3} pal={pal} i={1} />
        <Fenetre y0={10.8} y1={13.2} pal={pal} i={2} />
        {/* Écran de la salle de réunion (mur de gauche). */}
        <rect x={0.9} y={1.15} width={2.6} height={1.15} rx={0.04} fill={pal.cadre} />
        <rect x={0.98} y={1.22} width={2.44} height={1.01} fill={n ? '#1C3A5E' : '#2F6DB3'} />
        {[0.3, 0.55, 0.42, 0.75, 0.62].map((h, k) => <rect key={k} x={1.2 + k * 0.42} y={1.35} width={0.22} height={h} fill={TEINTES_ACTIVITE[(['code', 'terminal', 'recherche', 'web', 'agent'] as const)[k]]} opacity={0.9} />)}
      </g>
      <g transform={planY(0)}>
        <rect x={0} y={0} width={W} height={0.14} fill={pal.plinthe} />
        {/* Tableau blanc avec gribouillis et post-it. */}
        <rect x={5.3} y={0.95} width={4.2} height={1.45} rx={0.04} fill={pal.metal} />
        <rect x={5.37} y={1.02} width={4.06} height={1.31} fill={n ? '#D9DCE3' : '#FFFFFF'} />
        <polyline points="5.6,2.0 6.1,2.15 6.5,1.85 7.0,2.1 7.4,1.9" fill="none" stroke="#2E8FE0" strokeWidth={0.035} />
        <polyline points="5.6,1.6 6.2,1.6 6.2,1.3 6.9,1.3" fill="none" stroke="#D9566B" strokeWidth={0.035} />
        <rect x={7.6} y={1.25} width={0.55} height={0.4} fill="none" stroke="#3FB37F" strokeWidth={0.03} />
        <rect x={8.4} y={1.95} width={0.3} height={0.28} fill="#F7D35C" />
        <rect x={8.8} y={1.9} width={0.3} height={0.28} fill="#F59BB5" />
        <rect x={8.6} y={1.5} width={0.3} height={0.28} fill="#9FD8F5" />
        <rect x={5.4} y={0.9} width={4.0} height={0.06} fill={pal.metalD} />
        {/* Pendule (heure réelle). */}
        <circle cx={10.9} cy={2.15} r={0.32} fill={pal.cadre} />
        <circle cx={10.9} cy={2.15} r={0.27} fill={n ? '#E9E4D6' : '#FFFFFF'} />
        <line x1={10.9} y1={2.15} x2={10.9 + 0.15 * Math.sin((angleH * Math.PI) / 180)} y2={2.15 + 0.15 * Math.cos((angleH * Math.PI) / 180)} stroke={pal.cadre} strokeWidth={0.045} strokeLinecap="round" />
        <line x1={10.9} y1={2.15} x2={10.9 + 0.22 * Math.sin((angleM * Math.PI) / 180)} y2={2.15 + 0.22 * Math.cos((angleM * Math.PI) / 180)} stroke={pal.cadre} strokeWidth={0.03} strokeLinecap="round" />
        {/* Affiche abstraite. */}
        <rect x={11.7} y={1.2} width={1.3} height={1.2} fill={pal.cadre} />
        <rect x={11.76} y={1.26} width={1.18} height={1.08} fill={n ? '#2C3354' : '#F4E9DA'} />
        <circle cx={12.15} cy={1.95} r={0.25} fill="#E0803A" />
        <rect x={12.3} y={1.4} width={0.5} height={0.45} fill="#5B8CFF" opacity={0.9} />
        {/* Porte ouverte et panneau de sortie. */}
        <rect x={PORTE.x0 - 0.06} y={0} width={PORTE.x1 - PORTE.x0 + 0.12} height={2.32} fill={pal.plinthe} />
        <rect x={PORTE.x0} y={0} width={PORTE.x1 - PORTE.x0} height={2.25} fill={n ? '#0B0D16' : '#4A4F5C'} />
        <rect x={PORTE.x0 + 0.1} y={0} width={PORTE.x1 - PORTE.x0 - 0.2} height={2.15} fill={n ? '#141A2E' : '#6C7486'} opacity={0.7} />
        <rect x={(PORTE.x0 + PORTE.x1) / 2 - 0.25} y={2.42} width={0.5} height={0.18} rx={0.03} fill="#2FBF71" className="co-sortie" />
        {/* Placards hauts de la cuisine et crédence. */}
        <rect x={15.6} y={0.9} width={3.6} height={0.5} fill={n ? '#3B4258' : '#DCE6EE'} />
        <rect x={15.6} y={1.75} width={3.6} height={0.8} fill={pal.blancD} />
        {[0, 1, 2, 3].map(k => <rect key={k} x={15.65 + k * 0.9} y={1.8} width={0.82} height={0.7} fill={pal.blanc} />)}
        {n ? <rect x={15.6} y={1.68} width={3.6} height={0.07} fill={pal.lumiere} opacity={0.9} /> : null}
      </g>

      {/* Salle de réunion : table, chaises, plante, puis parois vitrées. */}
      <Plante x={0.5} y={0.5} pal={pal} taille={0.9} />
      {[[1.2, 1.05], [2.2, 1.05], [3.0, 1.05]].map(([x, y]) => <Boite key={`c${x}`} x={x} y={y} w={0.42} d={0.36} h={0.45} dessus={pal.assise} gauche={pal.chaise} droite={pal.chaise} />)}
      <Boite x={1.0} y={1.45} w={2.6} d={1.5} h={0.72} dessus={pal.bois} gauche={pal.boisG} droite={pal.boisD} />
      {[[1.2, 3.05], [2.2, 3.05], [3.0, 3.05]].map(([x, y]) => <Boite key={`d${x}`} x={x} y={y} w={0.42} d={0.36} h={0.45} dessus={pal.assise} gauche={pal.chaise} droite={pal.chaise} />)}
      <Boite x={1.6} y={1.8} z={0.72} w={0.5} d={0.35} h={0.03} dessus="#FFFFFF" gauche="#DDD" droite="#CCC" />
      <g opacity={n ? 0.5 : 0.62}>
        <polygon points={pts([[4.2, 0, 0], [4.2, 4.4, 0], [4.2, 4.4, 2.6], [4.2, 0, 2.6]])} fill={pal.vitre} opacity={0.32} />
        <polygon points={pts([[0, 4.4, 0], [4.2, 4.4, 0], [4.2, 4.4, 2.6], [0, 4.4, 2.6]])} fill={pal.vitre} opacity={0.32} />
        <polygon points={pts([[0, 4.4, 1.05], [4.2, 4.4, 1.05], [4.2, 4.4, 1.3], [0, 4.4, 1.3]])} fill={pal.vitreBord} opacity={0.55} />
        <polygon points={pts([[4.2, 0, 1.05], [4.2, 4.4, 1.05], [4.2, 4.4, 1.3], [4.2, 0, 1.3]])} fill={pal.vitreBord} opacity={0.55} />
        <polyline points={pts([[0, 4.4, 2.6], [4.2, 4.4, 2.6], [4.2, 0, 2.6]])} fill="none" stroke={pal.vitreBord} strokeWidth={2} />
        <polyline points={pts([[4.2, 4.4, 0], [4.2, 4.4, 2.6]])} fill="none" stroke={pal.vitreBord} strokeWidth={2} />
        <polyline points={pts([[2.1, 4.4, 0], [2.1, 4.4, 2.6]])} fill="none" stroke={pal.vitreBord} strokeWidth={1.2} />
        <polyline points={pts([[4.2, 2.2, 0], [4.2, 2.2, 2.6]])} fill="none" stroke={pal.vitreBord} strokeWidth={1.2} />
      </g>
      <g transform={planY(4.4)}>
        <rect x={0.7} y={1.12} width={1.0} height={0.12} rx={0.02} fill={n ? '#C8D2EA' : '#5B6478'} opacity={0.8} />
      </g>

      {/* Imprimante et plante près du mur du fond. */}
      <Boite x={10.95} y={0.2} w={1.05} d={0.8} h={0.85} dessus={pal.metal} gauche={pal.metalG} droite={pal.metalD} />
      <Boite x={11.1} y={0.3} z={0.85} w={0.75} d={0.55} h={0.12} dessus={pal.blancG} gauche={pal.blancD} droite={pal.blancD} />
      <Boite x={11.2} y={0.4} z={0.97} w={0.5} d={0.38} h={0.03} dessus="#FFFFFF" gauche="#EEE" droite="#DDD" />
      <circle cx={iso(12, 0.85, 0.7).x} cy={iso(12, 0.85, 0.7).y} r={2.2} fill="#2FBF71" className="co-led-actif" />
      <Plante x={12.75} y={0.55} pal={pal} taille={1.05} />

      {/* Cuisine : comptoir, machine à café fumante, frigo, mange-debout. */}
      <Boite x={15.6} y={0.05} w={3.6} d={0.9} h={0.9} dessus={pal.bois} gauche={pal.blancG} droite={pal.blancD} />
      <Boite x={16.0} y={0.2} z={0.9} w={0.55} d={0.5} h={0.6} dessus="#3A3F4A" gauche="#2A2E37" droite="#22262E" />
      <circle cx={iso(16.55, 0.62, 1.32).x} cy={iso(16.55, 0.62, 1.32).y} r={1.8} fill="#E5484D" />
      <g className="co-vapeur-cafe">
        {[0, 1, 2].map(k => {
          const p = iso(16.3, 0.85, 1.05);
          return <ellipse key={k} cx={p.x - 2 + k * 2} cy={p.y - 8} rx={2} ry={3.5} fill="#FFFFFF" opacity={0.5} className={`co-vapeur co-v${k}`} />;
        })}
      </g>
      <Boite x={17.1} y={0.35} z={0.9} w={0.18} d={0.18} h={0.16} dessus="#FFFFFF" gauche="#E36F51" droite="#C95A3F" />
      <Boite x={17.5} y={0.35} z={0.9} w={0.18} d={0.18} h={0.16} dessus="#FFFFFF" gauche="#4C9BE8" droite="#3B82C9" />
      <Boite x={18.1} y={0.25} z={0.9} w={0.7} d={0.45} h={0.05} dessus={pal.metal} gauche={pal.metalG} droite={pal.metalD} />
      <Boite x={19.25} y={0.05} w={0.7} d={0.85} h={1.95} dessus={pal.blancG} gauche={pal.blanc} droite={pal.blancD} />
      <Boite x={17.15} y={2.1} w={1.0} d={1.0} h={1.0} dessus={pal.bois} gauche={pal.boisG} droite={pal.boisD} />
      <Boite x={16.6} y={2.4} w={0.36} d={0.36} h={0.7} dessus={pal.assise} gauche={pal.chaise} droite={pal.chaise} />
      <Boite x={17.45} y={3.25} w={0.36} d={0.36} h={0.7} dessus={pal.assise} gauche={pal.chaise} droite={pal.chaise} />
      <Boite x={17.45} y={2.45} z={1.0} w={0.3} d={0.3} h={0.12} dessus="#F2C14E" gauche="#D9A441" droite="#C08E33" />

      {/* Coin salon : lampadaire, canapé, table basse, fauteuil. */}
      <Boite x={0.15} y={10.3} w={0.35} d={3.0} h={0.95} dessus={pal.canapeG} gauche={pal.canapeG} droite={pal.canapeD} />
      <Boite x={0.15} y={10.3} w={1.0} d={0.28} h={0.62} dessus={pal.canape} gauche={pal.canapeG} droite={pal.canapeD} />
      <Boite x={0.5} y={10.58} w={0.65} d={2.44} h={0.42} dessus={pal.canape} gauche={pal.canapeG} droite={pal.canapeD} />
      <Boite x={0.55} y={11.0} z={0.42} w={0.22} d={0.5} h={0.3} dessus="#F2C14E" gauche="#D9A441" droite="#C08E33" />
      <Boite x={0.55} y={12.2} z={0.42} w={0.22} d={0.5} h={0.3} dessus="#E36F51" gauche="#C95A3F" droite="#B14D35" />
      <Boite x={0.15} y={13.02} w={1.0} d={0.28} h={0.62} dessus={pal.canape} gauche={pal.canapeG} droite={pal.canapeD} />
      <Boite x={1.9} y={11.2} w={1.0} d={1.0} h={0.36} dessus={pal.bois} gauche={pal.boisG} droite={pal.boisD} />
      <Boite x={2.15} y={11.45} z={0.36} w={0.35} d={0.25} h={0.08} dessus="#5B8CFF" gauche="#4A73D6" droite="#3F63BA" />
      <Boite x={3.2} y={11.0} w={0.8} d={0.85} h={0.4} dessus="#D9A441" gauche="#C08E33" droite="#A87A2B" />
      <Boite x={3.75} y={11.0} w={0.25} d={0.85} h={0.85} dessus="#C08E33" gauche="#C08E33" droite="#A87A2B" />
      <g>
        <line x1={iso(0.5, 9.75).x} y1={iso(0.5, 9.75).y} x2={iso(0.5, 9.75, 1.7).x} y2={iso(0.5, 9.75, 1.7).y} stroke={pal.metalD} strokeWidth={2} />
        <ellipse cx={iso(0.5, 9.75).x} cy={iso(0.5, 9.75).y} rx={7} ry={3} fill={pal.metalD} />
        <path d={`M${iso(0.5, 9.75, 1.7).x - 9},${iso(0.5, 9.75, 1.7).y + 2} L${iso(0.5, 9.75, 1.7).x + 9},${iso(0.5, 9.75, 1.7).y + 2} L${iso(0.5, 9.75, 1.7).x + 6},${iso(0.5, 9.75, 1.7).y - 12} L${iso(0.5, 9.75, 1.7).x - 6},${iso(0.5, 9.75, 1.7).y - 12} Z`} fill={n ? '#FFD58A' : '#F1E7D3'} />
        {n ? <circle cx={iso(0.5, 9.75, 1.6).x} cy={iso(0.5, 9.75, 1.6).y + 8} r={26} fill="url(#co-flaque)" /> : null}
      </g>

      {/* Plantes le long des murs. */}
      <Plante x={4.55} y={4.95} pal={pal} taille={1.2} />
      <Plante x={0.45} y={4.75} pal={pal} taille={1.1} />
      <Plante x={0.6} y={13.55} pal={pal} taille={1.15} />
      <Plante x={19.45} y={4.2} pal={pal} taille={1.0} />
    </g>
  );
}

/** Premier plan : plante d'angle et suspensions au-dessus des îlots. */
const PremierPlan = React.memo(function PremierPlan({ pal }: { pal: Palette }) {
  const lampes: Array<[number, number]> = [...ILOTS_X.map(x0 => [x0 + 2, 7.75] as [number, number]), [2.1, 2.2], [17.6, 2.4]];
  return (
    <g>
      <Plante x={19.35} y={13.3} pal={pal} taille={1.35} />
      {lampes.map(([x, y]) => {
        const p = iso(x, y, 5.1);
        return (
          <g key={`${x}-${y}`}>
            <line x1={p.x} y1={0} x2={p.x} y2={p.y - 6} stroke={pal.nuit ? '#8A8FA3' : '#7D7466'} strokeWidth={1.2} />
            {pal.nuit ? <ellipse cx={p.x} cy={p.y + 6} rx={30} ry={14} fill="url(#co-flaque)" /> : null}
            <path d={`M${p.x - 16},${p.y + 4} Q${p.x},${p.y - 14} ${p.x + 16},${p.y + 4} Z`} fill={pal.nuit ? '#2C3046' : '#2F3442'} />
            <ellipse cx={p.x} cy={p.y + 4} rx={16} ry={3.5} fill={pal.nuit ? '#FFD58A' : '#FFF4D6'} />
          </g>
        );
      })}
    </g>
  );
});

// ------------------------------------------------------------------ postes

function Ecran({ x0, x1, z0, z1, activite, fige, cle }: { x0: number; x1: number; z0: number; z1: number; activite: Activite | 'vide'; fige: boolean; cle: string }) {
  const w = x1 - x0;
  const h = z1 - z0;
  const lignes = (couleurs: readonly string[], classe: string) => couleurs.map((c, k) => (
    <rect key={k} x={x0 + 0.06 + (k % 3) * 0.06} y={z1 - 0.12 - k * 0.09} width={w * (0.35 + ((hacher(cle + k) % 40) / 100))} height={0.045} rx={0.01} fill={c} className={`${classe} co-d${k % 4}`} />
  ));
  if (activite === 'vide' || fige) {
    return (
      <g>
        <rect x={x0} y={z0} width={w} height={h} fill={fige ? '#3A3F4C' : '#1A1F2A'} />
        {fige ? <rect x={x0 + w / 2 - 0.08} y={z0 + h / 2 - 0.08} width={0.16} height={0.16} fill="#8E95A8" /> : null}
      </g>
    );
  }
  switch (activite) {
    case 'code':
      return (
        <g>
          <rect x={x0} y={z0} width={w} height={h} fill="#1E1B3A" />
          <rect x={x0} y={z0} width={0.1} height={h} fill="#2A2650" />
          {lignes(['#C3A6FF', '#7CF0B4', '#FFD27A', '#8BD3FF', '#C3A6FF', '#7CF0B4'], 'co-ligne')}
        </g>
      );
    case 'terminal':
      return (
        <g>
          <rect x={x0} y={z0} width={w} height={h} fill="#0B1410" />
          <g className="co-defile">{lignes(['#3BE38B', '#3BE38B', '#9AF5C4', '#3BE38B', '#9AF5C4', '#3BE38B'], '')}</g>
          <rect x={x0 + 0.08} y={z0 + 0.05} width={0.07} height={0.06} fill="#3BE38B" className="co-curseur" />
        </g>
      );
    case 'recherche':
      return (
        <g>
          <rect x={x0} y={z0} width={w} height={h} fill="#F5F1E6" />
          {lignes(['#C9C2B0', '#E8A23A', '#C9C2B0', '#C9C2B0', '#E8A23A', '#C9C2B0'], '')}
          <g className="co-loupe">
            <circle cx={x0 + w * 0.62} cy={z0 + h * 0.55} r={0.13} fill="none" stroke="#B06A12" strokeWidth={0.04} />
            <line x1={x0 + w * 0.62 + 0.09} y1={z0 + h * 0.55 - 0.09} x2={x0 + w * 0.62 + 0.2} y2={z0 + h * 0.55 - 0.2} stroke="#B06A12" strokeWidth={0.05} />
          </g>
        </g>
      );
    case 'lecture':
      return (
        <g>
          <rect x={x0} y={z0} width={w} height={h} fill="#E8EEF5" />
          <rect x={x0 + w * 0.2} y={z0} width={w * 0.6} height={h} fill="#FFFFFF" />
          <g className="co-defile">{[0, 1, 2, 3, 4, 5].map(k => <rect key={k} x={x0 + w * 0.26} y={z1 - 0.12 - k * 0.085} width={w * (0.3 + (k % 3) * 0.08)} height={0.035} fill="#9AA6B5" />)}</g>
        </g>
      );
    case 'web':
      return (
        <g>
          <rect x={x0} y={z0} width={w} height={h} fill="#FFFFFF" />
          <rect x={x0} y={z1 - 0.12} width={w} height={0.12} fill="#DCE4EE" />
          {[0, 1, 2].map(k => <circle key={k} cx={x0 + 0.07 + k * 0.07} cy={z1 - 0.06} r={0.025} fill={['#E5484D', '#F2C14E', '#2FBF71'][k]} />)}
          <rect x={x0 + 0.08} y={z0 + 0.08} width={w * 0.4} height={h * 0.5} fill="#9CC7FF" />
          <g className="co-globe">
            <circle cx={x0 + w * 0.72} cy={z0 + h * 0.4} r={0.14} fill="#2E8FE0" />
            <ellipse cx={x0 + w * 0.72} cy={z0 + h * 0.4} rx={0.06} ry={0.14} fill="none" stroke="#BFE0FF" strokeWidth={0.02} className="co-meridien" />
          </g>
        </g>
      );
    case 'agent':
      return (
        <g>
          <rect x={x0} y={z0} width={w} height={h} fill="#26183A" />
          <rect x={x0 + w / 2 - 0.12} y={z0 + h * 0.45} width={0.24} height={0.18} rx={0.04} fill="#E9C6FF" />
          <circle cx={x0 + w / 2 - 0.05} cy={z0 + h * 0.55} r={0.025} fill="#26183A" />
          <circle cx={x0 + w / 2 + 0.05} cy={z0 + h * 0.55} r={0.025} fill="#26183A" />
          <rect x={x0 + 0.1} y={z0 + 0.08} width={w - 0.2} height={0.05} fill="#4A3566" />
          <rect x={x0 + 0.1} y={z0 + 0.08} width={w - 0.2} height={0.05} fill="#C05BD8" className="co-progres" />
        </g>
      );
    case 'pense':
      return (
        <g>
          <rect x={x0} y={z0} width={w} height={h} fill="#1E2230" />
          {[0, 1, 2].map(k => <rect key={k} x={x0 + 0.08} y={z1 - 0.14 - k * 0.1} width={w * (0.5 - k * 0.1)} height={0.04} fill="#5C6684" />)}
          <rect x={x0 + 0.08 + w * 0.3} y={z1 - 0.34} width={0.05} height={0.07} fill="#C9D2EA" className="co-curseur" />
        </g>
      );
    case 'pause':
      return (
        <g>
          <rect x={x0} y={z0} width={w} height={h} fill="#14243A" />
          <circle cx={x0 + w / 2} cy={z0 + h / 2} r={0.12} fill="#2F6DB3" className="co-veille" />
        </g>
      );
    case 'fini':
      return (
        <g>
          <rect x={x0} y={z0} width={w} height={h} fill="#123224" />
          <polyline points={`${x0 + w / 2 - 0.13},${z0 + h / 2} ${x0 + w / 2 - 0.03},${z0 + h / 2 - 0.1} ${x0 + w / 2 + 0.16},${z0 + h / 2 + 0.14}`} fill="none" stroke="#3BE38B" strokeWidth={0.05} strokeLinecap="round" />
        </g>
      );
    default:
      return (
        <g>
          <rect x={x0} y={z0} width={w} height={h} fill="#2A1A10" />
          <g className="co-engrenage">
            <circle cx={x0 + w / 2} cy={z0 + h / 2} r={0.13} fill="none" stroke="#E07A3A" strokeWidth={0.06} strokeDasharray="0.05 0.04" />
          </g>
          {lignes(['#E07A3A', '#8F6A50'], '')}
        </g>
      );
  }
}

const OBJETS_BUREAU = ['tasse', 'plante', 'papiers', 'cadre', 'lampe', 'rien'] as const;

const PosteDessin = React.memo(function PosteDessin({ poste, pal, activite, fige, occupe }: { poste: Poste; pal: Palette; activite: Activite | 'vide'; fige: boolean; occupe: boolean }) {
  const { x, y, w, d } = poste.bureau;
  const xc = poste.siege.x;
  const fond = poste.rangee === 0;
  const allume = activite !== 'vide' && activite !== 'fini' && !fige;
  const teinte = activite === 'vide' ? '#8E95A8' : TEINTES_ACTIVITE[activite];
  const objet = OBJETS_BUREAU[hacher(`poste${poste.index}`) % OBJETS_BUREAU.length];
  const coin = iso(fond ? x + 0.35 : x + w - 0.35, fond ? y + 0.35 : y + 0.65, 0.75);
  const clavierY = fond ? y + 0.15 : y + d - 0.38;
  const yEcran = fond ? y + d - 0.22 : y + 0.22;
  const led = iso(x + w - 0.08, y + d - 0.02, 0.6);
  return (
    <g>
      {/* Pieds et plateau. */}
      <Boite x={x + 0.08} y={y + 0.1} w={0.07} d={d - 0.2} h={0.69} dessus={pal.pied} gauche={pal.pied} droite={pal.metalD} />
      <Boite x={x + w - 0.15} y={y + 0.1} w={0.07} d={d - 0.2} h={0.69} dessus={pal.pied} gauche={pal.pied} droite={pal.metalD} />
      <Boite x={x + 0.02} y={y} z={0.69} w={w - 0.04} d={d} h={0.06} dessus={pal.bureau} gauche={pal.bureauG} droite={pal.bureauD} />
      {/* Halo de l'écran sur le plateau (plus visible la nuit). */}
      {allume ? (
        <g transform={sol(0.76)}>
          <ellipse cx={xc} cy={fond ? y + 0.5 : y + 0.5} rx={0.9} ry={0.5} fill="url(#co-halo)" opacity={pal.nuit ? 0.9 : 0.35} />
        </g>
      ) : null}
      {/* Clavier et souris. */}
      <g transform={sol(0.76)}>
        <rect x={xc - 0.36} y={clavierY} width={0.62} height={0.2} rx={0.03} fill={pal.nuit ? '#4A5064' : '#D5D9E0'} />
        <rect x={xc + 0.36} y={clavierY + 0.03} width={0.1} height={0.14} rx={0.05} fill={pal.nuit ? '#4A5064' : '#D5D9E0'} />
      </g>
      {/* Écran : de dos pour la rangée du fond (liseré coloré), de face pour celle de devant. */}
      <Boite x={xc - 0.14} y={yEcran - 0.1} z={0.75} w={0.28} d={0.2} h={0.02} dessus={pal.cadre} gauche={pal.cadre} droite={pal.cadre} />
      <g transform={planY(yEcran)}>
        <rect x={xc - 0.04} y={0.75} width={0.08} height={0.22} fill={pal.cadre} />
        {fond ? (
          <g>
            <rect x={xc - 0.62} y={0.9} width={1.24} height={0.68} rx={0.03} fill={allume ? teinte : pal.cadre} opacity={allume ? 0.85 : 1} />
            <rect x={xc - 0.58} y={0.93} width={1.16} height={0.62} rx={0.02} fill={pal.ecranDos} />
            <circle cx={xc} cy={1.24} r={0.05} fill={allume ? teinte : '#5A6070'} opacity={0.8} />
          </g>
        ) : (
          <g>
            <rect x={xc - 0.64} y={0.9} width={1.28} height={0.7} rx={0.03} fill={pal.cadre} />
            <Ecran x0={xc - 0.58} x1={xc + 0.58} z0={0.95} z1={1.55} activite={activite} fige={fige} cle={`e${poste.index}`} />
          </g>
        )}
      </g>
      {/* Cloison acoustique entre les deux rangées. */}
      {fond ? (
        <g>
          <polygon points={pts([[x, y + d, 0.75], [x + w, y + d, 0.75], [x + w, y + d, 1.12], [x, y + d, 1.12]])} fill={pal.cloison} />
          <polygon points={pts([[x, y + d, 1.12], [x + w, y + d, 1.12], [x + w, y + d + 0.04, 1.12], [x, y + d + 0.04, 1.12]])} fill={pal.cloisonD} />
        </g>
      ) : null}
      {/* Petit objet personnel. */}
      {objet === 'tasse' ? (
        <g transform={`translate(${r1(coin.x)} ${r1(coin.y)})`}>
          <rect x={-3.5} y={-8} width={7} height={8} rx={1.5} fill="#FFFFFF" />
          <path d="M3.5,-6 q3,0 3,3 q0,2 -3,2" fill="none" stroke="#FFFFFF" strokeWidth={1.4} />
          <ellipse cx={0} cy={-8} rx={3.5} ry={1.2} fill="#6B4226" />
        </g>
      ) : objet === 'plante' ? (
        <g transform={`translate(${r1(coin.x)} ${r1(coin.y)})`}>
          <rect x={-3.5} y={-6} width={7} height={6} rx={1} fill={pal.pot} />
          <ellipse cx={-2} cy={-10} rx={2.6} ry={4.6} fill={pal.feuille} transform="rotate(-20 -2 -10)" />
          <ellipse cx={2.2} cy={-10.5} rx={2.6} ry={4.8} fill={pal.feuille2} transform="rotate(22 2.2 -10.5)" />
        </g>
      ) : objet === 'papiers' ? (
        <g transform={sol(0.77)}>
          <rect x={fond ? x + 0.2 : x + w - 0.6} y={fond ? y + 0.2 : y + 0.45} width={0.4} height={0.3} fill="#FFFFFF" transform={`rotate(8 ${x} ${y})`} />
          <rect x={fond ? x + 0.22 : x + w - 0.58} y={fond ? y + 0.24 : y + 0.48} width={0.4} height={0.3} fill="#F2EFE7" />
        </g>
      ) : objet === 'cadre' ? (
        <g transform={`translate(${r1(coin.x)} ${r1(coin.y)})`}>
          <rect x={-4.5} y={-11} width={9} height={11} rx={1} fill={pal.bois} />
          <rect x={-3} y={-9.5} width={6} height={7} fill="#9CC7FF" />
          <circle cx={0} cy={-6} r={1.6} fill="#F2C14E" />
        </g>
      ) : objet === 'lampe' ? (
        <g transform={`translate(${r1(coin.x)} ${r1(coin.y)})`}>
          <ellipse cx={0} cy={0} rx={4} ry={1.6} fill={pal.metalD} />
          <line x1={0} y1={0} x2={3} y2={-14} stroke={pal.metalD} strokeWidth={1.4} />
          <path d="M-1,-13 L7,-16 L6,-11 Z" fill={pal.nuit ? '#FFD58A' : '#3F4658'} />
          {pal.nuit && occupe ? <circle cx={5} cy={-6} r={10} fill="url(#co-flaque)" /> : null}
        </g>
      ) : null}
      {/* Voyant d'état sur le chant du bureau. */}
      <circle cx={led.x} cy={led.y} r={2.3} fill={occupe ? teinte : pal.nuit ? '#3A3F4C' : '#C9CDD5'} className={allume ? 'co-led-actif' : undefined} />
    </g>
  );
});

const Chaise = React.memo(function Chaise({ poste, pal }: { poste: Poste; pal: Palette }) {
  const fond = poste.rangee === 0;
  const p = iso(poste.siege.x, poste.siege.y + (fond ? -0.28 : 0.28));
  return (
    <g transform={`translate(${r1(p.x)} ${r1(p.y)})`}>
      <ellipse cx={0} cy={0} rx={11} ry={4.5} fill={pal.ombre} opacity={0.16} />
      <path d="M-9,0 L9,0 M0,-4 L0,4 M-6,-3 L6,3 M-6,3 L6,-3" stroke={pal.chaise} strokeWidth={1.6} strokeLinecap="round" />
      <rect x={-1.6} y={-13} width={3.2} height={13} fill={pal.metalD} />
      <ellipse cx={0} cy={-14} rx={12} ry={5} fill={pal.assise} />
      <rect x={-11} y={fond ? -38 : -34} width={22} height={fond ? 22 : 19} rx={5} fill={pal.chaise} />
      <rect x={-9} y={fond ? -36 : -32} width={18} height={4} rx={2} fill={pal.assise} opacity={0.6} />
    </g>
  );
});

// ------------------------------------------------------------------ personnages

const fonce = (hex: string, k: number): string => {
  const n = Number.parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => c(v).toString(16).padStart(2, '0')).join('')}`;
};
const gris = (hex: string): string => {
  const n = Number.parseInt(hex.slice(1), 16);
  const g = Math.round((((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11) * 0.9 + 20);
  const h = Math.min(255, g).toString(16).padStart(2, '0');
  return `#${h}${h}${h}`;
};
const griser = (a: Apparence): Apparence => ({ ...a, peau: gris(a.peau), cheveux: gris(a.cheveux), haut: gris(a.haut), pantalon: gris(a.pantalon), touche: gris(a.touche) });

function CheveuxFace({ ap }: { ap: Apparence }) {
  const c = ap.cheveux;
  switch (ap.coupe) {
    case 'chignon':
      return (
        <g fill={c}>
          <circle cx={-2} cy={-57} r={5.5} />
          <path d="M-11,-41 Q-13,-56 1,-55.5 Q13,-55 12.5,-45 Q8,-51 -1,-49.5 Q-7,-48 -8.5,-40 Z" />
        </g>
      );
    case 'longue':
      return <path d="M-11.5,-40 Q-13,-57 1,-56 Q14,-55 12.5,-44 Q8,-51 0,-49.5 Q-6,-48 -7,-42 L-7,-30 L-12,-31 Z" fill={c} />;
    case 'boucles':
      return (
        <g fill={c}>
          {[[-9, -46], [-6, -52], [0, -55], [6, -53], [10, -48], [-10, -40]].map(([x, y], k) => <circle key={k} cx={x} cy={y} r={4.6} />)}
        </g>
      );
    case 'meche':
      return <path d="M-11,-41 Q-12,-57 2,-56 Q14,-55 13,-43 Q10,-49 4,-50 Q8,-45 5,-43 Q2,-50 -4,-48 Q-8,-46 -8.5,-40 Z" fill={c} />;
    default:
      return <path d="M-11,-42 Q-12,-56 1,-55.5 Q13,-55 12,-45 Q7,-50 -1,-49 Q-6,-48 -8,-41 Z" fill={c} />;
  }
}

function Accessoire({ ap, vue }: { ap: Apparence; vue: 'face' | 'dos' }) {
  const t = ap.touche;
  switch (ap.accessoire) {
    case 'lunettes':
      return vue === 'face' ? (
        <g fill="none" stroke="#1F2330" strokeWidth={1.1}>
          <circle cx={2.2} cy={-42.5} r={2.7} />
          <circle cx={8.4} cy={-42.5} r={2.7} />
          <line x1={4.9} y1={-42.8} x2={5.7} y2={-42.8} />
        </g>
      ) : null;
    case 'casque':
      return (
        <g>
          <path d="M-10,-44 Q0,-60 11,-45" fill="none" stroke="#2A2E3A" strokeWidth={2.4} />
          <rect x={vue === 'face' ? -12.5 : 8.5} y={-47} width={5} height={8} rx={2.2} fill={t} />
        </g>
      );
    case 'bonnet':
      return (
        <g fill={t}>
          <path d="M-11.5,-45 Q-11,-59 1,-59 Q13,-59 12.5,-45 Z" />
          <rect x={-12} y={-47} width={25} height={4} rx={2} fill={fonce(t, 0.8)} />
          <circle cx={1} cy={-60} r={3} fill="#FFFFFF" />
        </g>
      );
    case 'noeud':
      return (
        <g fill={t} transform={vue === 'face' ? 'translate(7 -54)' : 'translate(-2 -53)'}>
          <path d="M0,0 L-5,-3.5 L-5,3.5 Z M0,0 L5,-3.5 L5,3.5 Z" />
          <circle r={1.6} fill={fonce(t, 0.8)} />
        </g>
      );
    case 'echarpe':
      return (
        <g fill={t}>
          <rect x={-8} y={-34.5} width={16} height={4.5} rx={2.2} />
          <rect x={vue === 'face' ? 3 : -6} y={-31} width={4} height={9} rx={1.5} fill={fonce(t, 0.85)} />
        </g>
      );
    default:
      return null;
  }
}

type ModePerso = 'assis' | 'marche' | 'range' | 'fete';

/** Un personnage (pieds en 0,0 ; regarde vers la droite-bas en vue de face, la droite-haut de dos). */
const Personnage = React.memo(function Personnage({ ap, vue, mode, activite, carton }: { ap: Apparence; vue: 'face' | 'dos'; mode: ModePerso; activite: Activite; carton: boolean }) {
  const manche = fonce(ap.haut, 0.85);
  const assis = mode !== 'marche';
  // Bras : épaule → main, selon la pose.
  const pose = mode === 'fete' ? 'fete' : carton || mode === 'range' ? 'carton' : mode === 'marche' ? 'marche' : activite === 'pense' ? 'pense' : activite === 'pause' ? 'pause' : 'clavier';
  const brasG = pose === 'fete' ? 'M-9,-31 L-13,-40 L-14,-48' : pose === 'carton' ? 'M-9,-31 L-11,-24 L-8,-21' : pose === 'clavier' ? 'M-9,-31 L-11,-23 L-6,-19' : 'M-9,-31 L-11,-24 L-11,-17';
  const brasD = pose === 'fete' ? 'M9,-31 L13,-40 L14,-48' : pose === 'carton' ? 'M9,-31 L11,-24 L8,-21' : pose === 'pense' ? 'M9,-31 L12,-24 L7,-35' : pose === 'pause' ? 'M9,-31 L11,-24 L6,-27' : pose === 'clavier' ? 'M9,-31 L11,-23 L6,-19' : 'M9,-31 L11,-24 L11,-17';
  const fin = (d: string) => d.split(' ').pop()!.replace('L', '').split(',').map(Number) as [number, number];
  const [hgx, hgy] = fin(brasG);
  const [hdx, hdy] = fin(brasD);
  const classeMode = `co-m-${mode} co-a-${activite}`;
  return (
    <g className={classeMode}>
      <ellipse cx={0} cy={0} rx={11} ry={4.2} fill="#000" opacity={0.16} />
      {!assis ? (
        <g>
          <g className="co-jg"><rect x={-7} y={-16} width={6} height={16} rx={2.5} fill={ap.pantalon} /><ellipse cx={-4} cy={-0.5} rx={4} ry={2} fill="#2A2A30" /></g>
          <g className="co-jd"><rect x={1} y={-16} width={6} height={16} rx={2.5} fill={ap.pantalon} /><ellipse cx={4} cy={-0.5} rx={4} ry={2} fill="#2A2A30" /></g>
        </g>
      ) : null}
      <g className="co-corps">
        {vue === 'dos' && ap.coupe === 'longue' ? null : null}
        {/* Buste. */}
        <path d="M-10,-14 L-10,-28 Q-10,-34 -4,-34 L4,-34 Q10,-34 10,-28 L10,-14 Q0,-11 -10,-14 Z" fill={ap.haut} />
        {vue === 'face' ? <path d="M-3,-34 L0,-30 L3,-34 Z" fill="#FFFFFF" opacity={0.85} /> : <rect x={-4} y={-34.5} width={8} height={3} rx={1.5} fill={manche} />}
        {/* Bras. */}
        <g className="co-bg">
          <path d={brasG} fill="none" stroke={manche} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={hgx} cy={hgy} r={2.6} fill={ap.peau} />
        </g>
        {pose === 'carton' ? (
          <g>
            <rect x={-10} y={-29} width={20} height={13} rx={1} fill="#C99A5B" />
            <rect x={-10} y={-29} width={20} height={3} fill="#B3854A" />
            <rect x={-3} y={-34} width={2} height={6} fill="#5B8CFF" />
            <circle cx={4} cy={-32} r={2.5} fill={ap.touche} />
          </g>
        ) : null}
        <g className={pose === 'pause' ? 'co-bd co-tasse-main' : 'co-bd'}>
          <path d={brasD} fill="none" stroke={manche} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={hdx} cy={hdy} r={2.6} fill={ap.peau} />
          {pose === 'pause' ? (
            <g>
              <rect x={hdx - 1} y={hdy - 7} width={7} height={8} rx={1.5} fill="#FFFFFF" />
              <ellipse cx={hdx + 2.5} cy={hdy - 7} rx={3.5} ry={1.1} fill="#6B4226" />
              <g className="co-vapeur-tasse">
                <path d={`M${hdx + 1},${hdy - 10} q-2,-3 0,-6`} fill="none" stroke="#FFFFFF" strokeWidth={1.2} opacity={0.7} className="co-vapeur co-v0" />
                <path d={`M${hdx + 4},${hdy - 10} q2,-3 0,-6`} fill="none" stroke="#FFFFFF" strokeWidth={1.2} opacity={0.7} className="co-vapeur co-v1" />
              </g>
            </g>
          ) : null}
        </g>
        {/* Tête. */}
        <g className="co-tete">
          {ap.coupe === 'longue' && vue === 'dos' ? <path d="M-12,-45 L-12,-29 Q0,-26 12,-29 L12,-45 Z" fill={ap.cheveux} /> : null}
          <rect x={-3} y={-36} width={6} height={4} fill={fonce(ap.peau, 0.9)} />
          <circle cx={vue === 'face' ? 1 : 0} cy={-44} r={11} fill={ap.peau} />
          {vue === 'face' ? (
            <g>
              <circle cx={-6.5} cy={-43} r={2.2} fill={fonce(ap.peau, 0.9)} />
              <CheveuxFace ap={ap} />
              <g className="co-yeux">
                <ellipse cx={2.4} cy={-42.5} rx={1.3} ry={1.8} fill="#1F2330" />
                <ellipse cx={8.2} cy={-42.5} rx={1.3} ry={1.8} fill="#1F2330" />
              </g>
              <ellipse cx={0.5} cy={-38.8} rx={2} ry={1.1} fill="#F08C8C" opacity={0.45} />
              <ellipse cx={10} cy={-38.8} rx={1.6} ry={1.1} fill="#F08C8C" opacity={0.45} />
              {mode === 'fete' ? <path d="M3.5,-38.5 q2.2,3 4.4,0 Z" fill="#7A2E2E" /> : <path d="M3.8,-38 q1.8,1.6 3.6,0" fill="none" stroke="#7A3B3B" strokeWidth={1} strokeLinecap="round" />}
            </g>
          ) : (
            <g>
              <circle cx={9.5} cy={-43} r={2.2} fill={fonce(ap.peau, 0.9)} />
              {ap.coupe === 'boucles' ? (
                <g fill={ap.cheveux}>{[[-8, -46], [-4, -53], [3, -54], [8, -49], [-9, -39], [0, -45], [6, -41], [-4, -38]].map(([x, y], k) => <circle key={k} cx={x} cy={y} r={5} />)}</g>
              ) : (
                <path d="M-11,-38 Q-12.5,-56 0,-55.5 Q12,-55 11,-46 Q9,-40 8,-37 Q0,-34 -11,-38 Z" fill={ap.cheveux} />
              )}
              {ap.coupe === 'chignon' ? <circle cx={-1} cy={-56} r={5.5} fill={ap.cheveux} /> : null}
            </g>
          )}
          <Accessoire ap={ap} vue={vue} />
        </g>
      </g>
      {mode === 'fete' ? (
        <g>
          {[-14, -7, 0, 7, 14, -10, 10].map((dx, k) => (
            <rect key={k} x={dx} y={-62 - (k % 3) * 5} width={3} height={4.5} rx={0.8} fill={['#F2C14E', '#E5484D', '#2E8FE0', '#2FBF71', '#C05BD8'][k % 5]} className={`co-confetti co-c${k % 4}`} />
          ))}
        </g>
      ) : null}
    </g>
  );
}, (a, b) => a.vue === b.vue && a.mode === b.mode && a.activite === b.activite && a.carton === b.carton && JSON.stringify(a.ap) === JSON.stringify(b.ap));

// ------------------------------------------------------------------ bulles et badges

function couperLignes(texte: string, max: number, nb: number): string[] {
  const mots = texte.split(' ');
  const lignes: string[] = [];
  let ligne = '';
  for (const mot of mots) {
    const essai = ligne ? `${ligne} ${mot}` : mot;
    if (essai.length <= max) ligne = essai;
    else {
      if (ligne) lignes.push(ligne);
      ligne = mot.length > max ? `${mot.slice(0, max - 1)}…` : mot;
    }
    if (lignes.length === nb) break;
  }
  if (lignes.length < nb && ligne) lignes.push(ligne);
  if (lignes.length === nb && lignes.join(' ').length < texte.length) {
    const derniere = lignes[nb - 1];
    lignes[nb - 1] = `${derniere.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
  }
  return lignes.slice(0, nb);
}

function Bulle({ x, y, titre, texte, couleur, pal, grand }: { x: number; y: number; titre: string; texte: string; couleur: string; pal: Palette; grand: boolean }) {
  const taille = grand ? 20 : 14;
  const max = grand ? 22 : 30;
  const lignes = couperLignes(texte, max, 3);
  const largeur = Math.max(titre.length * taille * 0.6, ...lignes.map(l => l.length * taille * 0.53)) + 22;
  const hauteur = (lignes.length + 1) * (taille + 4) + 14;
  const gauche = Math.max(8, Math.min(LARGEUR_SCENE - largeur - 8, x - largeur / 2));
  const haut = Math.max(6, y - hauteur - 12);
  const queueX = Math.max(gauche + 12, Math.min(gauche + largeur - 12, x));
  return (
    <g className="co-bulle" pointerEvents="none">
      <rect x={gauche + 2} y={haut + 3} width={largeur} height={hauteur} rx={12} fill="#000" opacity={0.12} />
      <path d={`M${queueX - 8},${haut + hauteur - 1} L${queueX},${haut + hauteur + 10} L${queueX + 8},${haut + hauteur - 1} Z`} fill={pal.bulle} />
      <rect x={gauche} y={haut} width={largeur} height={hauteur} rx={12} fill={pal.bulle} stroke={couleur} strokeWidth={2} />
      <text x={gauche + 11} y={haut + 8 + taille} fontSize={taille} fontWeight={700} fill={couleur}>{titre}</text>
      {lignes.map((l, k) => (
        <text key={k} x={gauche + 11} y={haut + 8 + taille + (k + 1) * (taille + 4)} fontSize={taille} fill={pal.bulleTexte}>{l}</text>
      ))}
    </g>
  );
}

function Badge({ x, y, activite, pal, fige, grand }: { x: number; y: number; activite: Activite; pal: Palette; fige: boolean; grand: boolean }) {
  const k = grand ? 1.3 : 1;
  const c = fige ? '#8E95A8' : TEINTES_ACTIVITE[activite];
  if (activite === 'pense' && !fige) {
    return (
      <g transform={`translate(${r1(x)} ${r1(y)}) scale(${k})`} pointerEvents="none">
        <circle cx={-6} cy={8} r={2} fill={pal.bulle} stroke={pal.bulleBord} strokeWidth={0.8} />
        <circle cx={-2} cy={3} r={3} fill={pal.bulle} stroke={pal.bulleBord} strokeWidth={0.8} />
        <ellipse cx={8} cy={-8} rx={16} ry={10} fill={pal.bulle} stroke={pal.bulleBord} strokeWidth={0.8} />
        {[0, 1, 2].map(i => <circle key={i} cx={2 + i * 6} cy={-8} r={2} fill={c} className={`co-point co-p${i}`} />)}
      </g>
    );
  }
  return (
    <g transform={`translate(${r1(x)} ${r1(y)}) scale(${k})`} pointerEvents="none">
      <circle r={10.5} fill={pal.badge} stroke={c} strokeWidth={2.2} />
      <text y={4} textAnchor="middle" fontSize={activite === 'code' || activite === 'terminal' ? 8.5 : 11} fontWeight={700} fill={c} fontFamily="ui-monospace, Menlo, monospace">{ICONES_ACTIVITE[activite]}</text>
    </g>
  );
}

// ------------------------------------------------------------------ feuille de style

const CSS = `
.co-scene{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.co-yeux,.co-tete,.co-bg,.co-bd,.co-ligne,.co-meridien,.co-progres,.co-engrenage,.co-feuillage,.co-confetti,.co-vapeur{transform-box:fill-box}
.co-clic{cursor:pointer}
@keyframes co-tape{from{transform:translateY(0)}to{transform:translateY(-2px)}}
.co-m-assis.co-a-code .co-bg{animation:co-tape .2s ease-in-out infinite alternate}
.co-m-assis.co-a-code .co-bd{animation:co-tape .2s ease-in-out .1s infinite alternate}
@keyframes co-souris{0%,100%{transform:translate(0,0)}35%{transform:translate(1.5px,-1px)}70%{transform:translate(-1px,1px)}}
.co-m-assis.co-a-terminal .co-bd,.co-m-assis.co-a-recherche .co-bd,.co-m-assis.co-a-lecture .co-bd,.co-m-assis.co-a-web .co-bd,.co-m-assis.co-a-agent .co-bd,.co-m-assis.co-a-outil .co-bd{animation:co-souris 1.4s ease-in-out infinite}
.co-m-assis.co-a-terminal .co-bg{animation:co-tape .3s ease-in-out infinite alternate}
@keyframes co-cligne{0%,93%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
.co-yeux{transform-origin:center;animation:co-cligne 4.6s infinite}
@keyframes co-penche{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(3deg)}}
.co-a-pense .co-tete{transform-origin:50% 100%;animation:co-penche 3.4s ease-in-out infinite}
@keyframes co-boit{0%,62%,100%{transform:translate(0,0)}70%,86%{transform:translate(-2px,-7px)}}
.co-m-assis.co-a-pause .co-tasse-main{animation:co-boit 6.5s ease-in-out infinite}
@keyframes co-etire{0%,80%,100%{transform:rotate(0)}85%,94%{transform:rotate(150deg)}}
.co-m-assis.co-a-pause .co-bg{transform-origin:85% 5%;animation:co-etire 12s ease-in-out infinite}
@keyframes co-saut{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
.co-m-fete .co-corps{animation:co-saut .45s ease-in-out infinite}
@keyframes co-pas{from{transform:translateY(0)}to{transform:translateY(-3px)}}
.co-m-marche .co-jg{animation:co-pas .26s ease-in-out infinite alternate}
.co-m-marche .co-jd{animation:co-pas .26s ease-in-out .26s infinite alternate}
@keyframes co-rebond{from{transform:translateY(0)}to{transform:translateY(-1.5px)}}
.co-m-marche .co-corps{animation:co-rebond .26s ease-in-out infinite alternate}
@keyframes co-balance{from{transform:rotate(-14deg)}to{transform:rotate(14deg)}}
.co-m-marche .co-bg{transform-origin:50% 0;animation:co-balance .52s ease-in-out infinite alternate}
.co-m-marche .co-bd{transform-origin:50% 0;animation:co-balance .52s ease-in-out .26s infinite alternate-reverse}
@keyframes co-monte{0%{transform:translateY(0);opacity:0}20%{opacity:1}100%{transform:translateY(-18px);opacity:0}}
.co-particule{animation:co-monte 1.3s linear infinite}
.co-particule.co-d1{animation-delay:.45s}.co-particule.co-d2{animation-delay:.9s}
@keyframes co-vap{0%{transform:translateY(0) scale(.6);opacity:0}30%{opacity:.75}100%{transform:translateY(-10px) scale(1.25);opacity:0}}
.co-vapeur{animation:co-vap 2.2s ease-out infinite}
.co-v1{animation-delay:.7s}.co-v2{animation-delay:1.4s}
@keyframes co-clignote{0%,100%{opacity:1}50%{opacity:.3}}
.co-led-actif{animation:co-clignote 1.3s ease-in-out infinite}
.co-curseur{animation:co-clignote .9s steps(2,start) infinite}
@keyframes co-point{0%,100%{opacity:.25}40%{opacity:1}}
.co-point{animation:co-point 1.2s infinite}.co-p1{animation-delay:.2s}.co-p2{animation-delay:.4s}
@keyframes co-ecrire{0%{transform:scaleX(.05)}55%,100%{transform:scaleX(1)}}
.co-ligne{transform-origin:0 50%;animation:co-ecrire 2.6s steps(8) infinite}
.co-ligne.co-d1{animation-delay:.35s}.co-ligne.co-d2{animation-delay:.7s}.co-ligne.co-d3{animation-delay:1.05s}
@keyframes co-defile{from{transform:translateY(0)}to{transform:translateY(.09px)}}
.co-defile{animation:co-defile .5s steps(2) infinite}
@keyframes co-loupe{0%,100%{transform:translate(0,0)}50%{transform:translate(-.35px,.12px)}}
.co-loupe{animation:co-loupe 2.4s ease-in-out infinite}
@keyframes co-meridien{0%{transform:scaleX(1)}50%{transform:scaleX(.1)}100%{transform:scaleX(1)}}
.co-meridien{transform-origin:center;animation:co-meridien 2s linear infinite}
@keyframes co-progres{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.co-progres{transform-origin:0 50%;animation:co-progres 3s ease-in-out infinite}
@keyframes co-tourne{to{transform:rotate(360deg)}}
.co-engrenage{transform-origin:center;animation:co-tourne 3s linear infinite}
@keyframes co-veille{0%,100%{transform:translate(-.25px,.05px)}50%{transform:translate(.25px,-.08px)}}
.co-veille{animation:co-veille 5s ease-in-out infinite}
@keyframes co-confetti{0%{transform:translate(0,0) rotate(0);opacity:1}100%{transform:translate(4px,30px) rotate(300deg);opacity:0}}
.co-confetti{animation:co-confetti 1.1s ease-in infinite}
.co-c1{animation-delay:.25s}.co-c2{animation-delay:.5s}.co-c3{animation-delay:.75s}
@keyframes co-nuages{from{transform:translateX(-.4px)}to{transform:translateX(.4px)}}
.co-nuages{animation:co-nuages 14s ease-in-out infinite alternate}
@keyframes co-etoile{0%,100%{opacity:.9}50%{opacity:.25}}
.co-etoile{animation:co-etoile 3s ease-in-out infinite}.co-e1{animation-delay:1s}.co-e2{animation-delay:2s}
@keyframes co-anneau{0%,100%{opacity:.9}50%{opacity:.4}}
.co-anneau{animation:co-anneau 1.6s ease-in-out infinite}
@keyframes co-feuillage{from{transform:rotate(-1.5deg)}to{transform:rotate(1.5deg)}}
.co-feuillage{transform-origin:50% 100%;animation:co-feuillage 5s ease-in-out infinite alternate}
.co-fixe *{animation:none!important}
.co-gele *{animation-play-state:paused!important}
@media (prefers-reduced-motion:reduce){.co-scene *{animation:none!important}}
`;

// ------------------------------------------------------------------ scène

interface Element {
  cle: string;
  profondeur: number;
  rendu: React.ReactNode;
}

/** Taille des personnages par rapport au décor. */
const K_PERSO = 1.5;
const transformPerso = (x: number, y: number, miroir: boolean) => `translate(${r1(x)} ${r1(y)}) scale(${miroir ? -K_PERSO : K_PERSO} ${K_PERSO})`;

const maintenantSecondes = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

export function SceneOpenSpace({ agents, theme, reduit, largeur, choisi, onChoisir, demo, texteAgrandi, maintenant, horloge, charge = true }: PropsScene) {
  const pal = useMemo(() => palette(theme.sombre), [theme.sombre]);
  const temps = horloge ?? maintenantSecondes;
  const etat = useRef(creerScene());
  const [, rafraichir] = useReducer((n: number) => n + 1, 0);
  const refsPersos = useRef(new Map<string, SVGGElement>());
  const racine = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const [vedette, setVedette] = useState(0);
  const signature = signatureAgents(agents);
  const parCle = useMemo(() => new Map(agents.map(a => [a.cle, a])), [agents]);

  // Réconciliation à chaque changement de la liste (ou du réglage d'animation),
  // pendant le rendu : idempotente, gardée par la signature.
  const derniere = useRef<string>(undefined);
  const cleReconciliation = `${signature}#${reduit}`;
  if (charge && derniere.current !== cleReconciliation) {
    reconcilier(etat.current, agents, temps(), { anime: !reduit });
    derniere.current = cleReconciliation;
  }

  // Hors écran ou onglet masqué : plus rien ne bouge.
  useEffect(() => {
    const el = racine.current;
    let dansLEcran = true;
    const maj = () => setVisible(dansLEcran && !(typeof document !== 'undefined' && document.hidden));
    const io = typeof IntersectionObserver !== 'undefined' && el
      ? new IntersectionObserver(e => { dansLEcran = e.some(x => x.isIntersecting); maj(); })
      : undefined;
    if (io && el) io.observe(el);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', maj);
    return () => {
      io?.disconnect();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', maj);
    };
  }, []);

  // Boucle d'animation : seulement s'il y a des marcheurs ou des phases en cours.
  const ordre = useRef('');
  const bouge = [...etat.current.occupants.values()].some(o => o.phase === 'attente' || o.phase === 'arrivee' || o.phase === 'depart' || o.phase === 'fete');
  useEffect(() => {
    if (reduit || !visible || !bouge || typeof requestAnimationFrame === 'undefined') return undefined;
    let id = 0;
    let dernier = 0;
    const image = (ms: number) => {
      id = requestAnimationFrame(image);
      if (ms - dernier < 32) return; // ~30 images par seconde
      dernier = ms;
      const t = temps();
      let change = avancer(etat.current, t);
      const liste = poses(etat.current, t);
      for (const p of liste) {
        const el = refsPersos.current.get(p.cle);
        if (!el || p.mode !== 'marche') continue;
        const q = iso(p.x, p.y);
        el.setAttribute('transform', transformPerso(q.x, q.y, p.miroir));
        el.setAttribute('opacity', String(r1(p.opacite)));
      }
      const sig = liste.map(p => `${p.cle}:${p.mode}:${p.vue}:${p.miroir}:${Math.round((p.x + p.y) * 2)}`).join('|');
      if (sig !== ordre.current) {
        ordre.current = sig;
        change = true;
      }
      if (change) rafraichir();
    };
    id = requestAnimationFrame(image);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduit, visible, bouge]);

  // Bulle « vedette » qui passe d'un agent à l'autre quand aucun n'est choisi.
  useEffect(() => {
    if (reduit || !visible || choisi) return undefined;
    const t = setInterval(() => setVedette(v => v + 1), 5200);
    return () => clearInterval(t);
  }, [reduit, visible, choisi]);

  const t = temps();
  const liste = poses(etat.current, t);
  const occupants = etat.current.occupants;
  const parPoste = new Map([...occupants.values()].map(o => [o.poste, o]));
  const assisAvecDemande = liste.filter(p => p.mode !== 'marche' && parCle.get(p.cle)?.demande);
  const cleBulle = choisi ?? (assisAvecDemande.length ? assisAvecDemande[vedette % assisAvecDemande.length].cle : undefined);
  const fond = useMemo(() => <Fond pal={pal} maintenant={maintenant} />, [pal, Math.floor(maintenant / 60_000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const choisir = useCallback((cle: string) => (e: React.MouseEvent) => { e.stopPropagation(); onChoisir(cle); }, [onChoisir]);

  const elements: Element[] = [];
  for (const poste of POSTES) {
    const occ = parPoste.get(poste.index);
    const agent = occ ? parCle.get(occ.cle) : undefined;
    const assis = occ && (occ.phase === 'assis' || occ.phase === 'fete' || (occ.phase === 'depart' && occ.trajet && t < occ.trajet.debut));
    const activite: Activite | 'vide' = !occ || !agent ? 'vide' : occ.phase === 'parti' ? 'fini' : assis ? activiteAgent(agent) : 'vide';
    elements.push({
      cle: `poste-${poste.index}`,
      profondeur: poste.bureau.x + poste.bureau.w / 2 + poste.bureau.y + poste.bureau.d / 2,
      rendu: (
        <g key={`poste-${poste.index}`} onClick={occ ? choisir(occ.cle) : undefined} className={occ ? 'co-clic' : undefined}>
          <PosteDessin poste={poste} pal={pal} activite={activite} fige={Boolean(agent?.fige)} occupe={Boolean(assis)} />
        </g>
      ),
    });
    elements.push({
      cle: `chaise-${poste.index}`,
      profondeur: poste.siege.x + poste.siege.y + (poste.rangee === 0 ? -0.28 : 0.28),
      rendu: <Chaise key={`chaise-${poste.index}`} poste={poste} pal={pal} />,
    });
  }
  for (const p of liste) {
    const agent = parCle.get(p.cle);
    const occ = occupants.get(p.cle);
    if (!agent || !occ) continue;
    const ap0 = apparence(agent);
    const ap = agent.fige ? griser(ap0) : ap0;
    const activite = activiteAgent(agent);
    const q = iso(p.x, p.y);
    const carton = occ.fini && (p.mode === 'marche' || p.mode === 'range') && occ.phase === 'depart';
    elements.push({
      cle: `perso-${p.cle}`,
      profondeur: p.x + p.y,
      rendu: (
        <g
          key={`perso-${p.cle}`}
          ref={el => { if (el) refsPersos.current.set(p.cle, el); else refsPersos.current.delete(p.cle); }}
          transform={transformPerso(q.x, q.y, p.miroir)}
          opacity={agent.fige ? 0.7 : r1(p.opacite)}
          onClick={choisir(p.cle)}
          className="co-clic"
        >
          {p.cle === choisi ? <ellipse cx={0} cy={0} rx={17} ry={7} fill="none" stroke={theme.accent} strokeWidth={2.5} className="co-anneau" /> : null}
          <Personnage ap={ap} vue={p.vue} mode={agent.fige ? 'assis' : p.mode} activite={agent.fige ? 'pause' : activite} carton={carton} />
          {p.mode === 'assis' && activite === 'code' && !agent.fige ? (
            <g>
              {['{', ';', '}'].map((c, k) => (
                <text key={k} x={(k - 1) * 7 - 4} y={-18} fontSize={8} fontWeight={700} fill={TEINTES_ACTIVITE.code} className={`co-particule co-d${k}`} fontFamily="ui-monospace, Menlo, monospace">{c}</text>
              ))}
            </g>
          ) : null}
        </g>
      ),
    });
  }
  elements.sort((a, b) => a.profondeur - b.profondeur || (a.cle < b.cle ? -1 : 1));

  // Badges (état de chacun) et bulle de la dernière demande, toujours au-dessus.
  const badges: React.ReactNode[] = [];
  let bulle: React.ReactNode = null;
  const grand = Boolean(texteAgrandi);
  for (const p of liste) {
    const agent = parCle.get(p.cle);
    if (!agent || p.mode === 'marche') continue;
    const q = iso(p.x, p.y);
    const haut = q.y - (p.mode === 'fete' ? 74 : 64) * K_PERSO;
    badges.push(<Badge key={p.cle} x={q.x + (p.miroir ? -1 : 1) * 19 * K_PERSO} y={haut + 8} activite={p.mode === 'fete' ? 'fini' : activiteAgent(agent)} pal={pal} fige={agent.fige} grand={grand} />);
    if (p.cle === cleBulle) {
      bulle = (
        <Bulle
          x={q.x}
          y={haut - (grand ? 12 : 6)}
          titre={`${agent.projet ?? 'Projet inconnu'}${agent.fige ? ' · figé' : ''}`}
          texte={agent.demande ?? 'Pas encore de demande'}
          couleur={apparence(agent).haut}
          pal={pal}
          grand={grand}
        />
      );
    }
  }
  // Postes d'agents terminés et partis : coche sur le bureau, bulle si on les choisit.
  for (const occ of occupants.values()) {
    if (occ.phase !== 'parti') continue;
    const q = iso(POSTES[occ.poste].siege.x, POSTES[occ.poste].siege.y);
    badges.push(<Badge key={`fini-${occ.cle}`} x={q.x} y={q.y - 46} activite="fini" pal={pal} fige={Boolean(parCle.get(occ.cle)?.fige)} grand={grand} />);
  }
  if (!bulle && choisi) {
    const occ = occupants.get(choisi);
    const agent = parCle.get(choisi);
    if (occ && agent && occ.phase === 'parti') {
      const q = iso(POSTES[occ.poste].siege.x, POSTES[occ.poste].siege.y);
      bulle = <Bulle x={q.x} y={q.y - 40} titre={`${agent.projet ?? 'Projet inconnu'} · terminé`} texte={resumerTexte(agent.demande, 120) ?? 'Session terminée'} couleur={apparence(agent).haut} pal={pal} grand={grand} />;
    }
  }
  const attente = enAttente(etat.current);
  const porte = iso((PORTE.x0 + PORTE.x1) / 2, 0, 2.6);
  const hauteur = Math.round((largeur * HAUTEUR_SCENE) / LARGEUR_SCENE);

  return (
    <div
      ref={racine}
      style={{ width: largeur, height: hauteur, position: 'relative' }}
      data-testid={reduit ? 'scene-fixe' : 'scene-animee'}
      aria-hidden="true"
    >
      <svg
        className={`co-scene${reduit ? ' co-fixe' : ''}${visible ? '' : ' co-gele'}`}
        width={largeur}
        height={hauteur}
        viewBox={`0 0 ${LARGEUR_SCENE} ${HAUTEUR_SCENE}`}
        style={{ display: 'block' }}
        focusable="false"
      >
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        {fond}
        <g>{elements.map(e => e.rendu)}</g>
        <PremierPlan pal={pal} />
        {attente ? (
          <g transform={`translate(${r1(porte.x)} ${r1(porte.y - 8)})`} data-testid="scene-file-attente">
            <rect x={-38} y={-14} width={76} height={20} rx={10} fill={pal.badge} stroke={TEINTES_ACTIVITE.pense} strokeWidth={1.5} />
            <text y={1} textAnchor="middle" fontSize={11} fontWeight={700} fill={pal.badgeTexte}>{`${attente} à l’entrée`}</text>
          </g>
        ) : null}
        <g>{badges}</g>
        {bulle}
        {demo ? (
          <g transform="translate(700 14)" data-testid="scene-demo">
            <rect width={156} height={34} rx={17} fill="#E0803A" />
            <text x={78} y={23} textAnchor="middle" fontSize={16} fontWeight={800} fill="#FFFFFF" letterSpacing={1}>DÉMO</text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}
