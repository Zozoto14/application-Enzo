/**
 * Claude Office, onglet « Bureau » : l'open space en ZONES THÉMATIQUES,
 * dessiné en SVG isométrique (web, site, PC). Aucune image ni dépendance :
 * polygones, dégradés et animations CSS légères.
 *
 * - Dix zones (zones.ts) au sol teinté, mobilier propre et enseigne avec le
 *   nombre d'agents présents : Atelier code (bureaux et écrans), Salle des
 *   machines (baies, voyants), Bibliothèque (étagères, tables de lecture),
 *   Café web (comptoir, globe), Salle de réunion vitrée (table, tableau
 *   blanc), Coin réflexion (poufs, plantes), Accueil (porte, banque),
 *   Détente (fauteuils, machine à café), « Attend ta réponse » (guichet,
 *   sonnette) et Salle d'attente (banquettes).
 * - Chaque agent marche jusqu'à la zone de son activité (logiqueScene.ts) ;
 *   seuls les marcheurs bougent image par image (requestAnimationFrame bridé
 *   à ~30 i/s, arrêté hors écran, onglet masqué ou quand personne ne marche).
 *   Le reste : animations CSS, gelées hors écran.
 * - « Réduire les animations » : personne ne marche, un simple fondu quand un
 *   agent change de zone ; poses et gadgets restent expressifs.
 * La scène est décorative pour les lecteurs d'écran : la liste des agents
 * (Bureau.tsx) porte la même information.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  activiteAgent, apparence, avancer, comptesZones, creerScene, enAttente, HAUTEUR_MURS, HAUTEUR_SCENE, ILOTS_ATELIER, ISO, iso, LARGEUR_BUREAU,
  LARGEUR_PIECE, LARGEUR_SCENE, PLACES, PORTE, PROFONDEUR_PIECE, RECTS_ZONES, poses, prochaineEcheance, reconcilier, signatureAgents, hacher,
  type Activite, type Apparence, type ModePose, type Place, ICONES_ACTIVITE, TEINTES_ACTIVITE,
} from './logiqueScene';
import { ORDRE_ZONES, ZONES, type Zone } from './zones';
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

/** Ombre portée douce au sol (lumière venant du fond à gauche). */
function OmbreSol({ x, y, w, d, h, pal }: { x: number; y: number; w: number; d: number; h: number; pal: Palette }) {
  const o = Math.min(0.55, h * 0.3);
  return (
    <g transform={sol()} pointerEvents="none">
      <rect x={x + o * 0.6} y={y + o} width={w} height={d} rx={0.12} fill={pal.ombre} opacity={pal.nuit ? 0.26 : 0.12} />
      <rect x={x + o * 0.3} y={y + o * 0.5} width={w} height={d} rx={0.08} fill={pal.ombre} opacity={pal.nuit ? 0.18 : 0.08} />
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
  const clip = `co-fen-${i}`;
  return (
    <g>
      <clipPath id={clip}><rect x={y0} y={z0} width={largeur} height={z1 - z0} /></clipPath>
      <rect x={y0 - 0.08} y={z0 - 0.08} width={largeur + 0.16} height={z1 - z0 + 0.16} fill={pal.murHaut} />
      <rect x={y0} y={z0} width={largeur} height={z1 - z0} fill={`url(#${id})`} />
      <g clipPath={`url(#${clip})`}>
        {pal.nuit ? (
          <g>
            {[0.2, 0.5, 0.75, 0.33, 0.9, 0.62].map((f, k) => (
              <circle key={k} cx={y0 + largeur * f} cy={z1 - 0.15 - (k % 3) * 0.17} r={0.025} fill="#FFFFFF" className={`co-etoile co-e${k % 3}`} />
            ))}
            {i === 1 ? (
              <g>
                <circle cx={y0 + largeur * 0.72} cy={z1 - 0.32} r={0.3} fill="#F4F1DE" opacity={0.12} />
                <circle cx={y0 + largeur * 0.72} cy={z1 - 0.32} r={0.13} fill="#F4F1DE" />
                <circle cx={y0 + largeur * 0.72 + 0.05} cy={z1 - 0.3} r={0.1} fill={pal.ciel1} opacity={0.55} />
              </g>
            ) : null}
            <g className="co-nuages-defile"><ellipse cx={y0 + largeur * 0.4} cy={z1 - 0.5} rx={0.45} ry={0.06} fill="#3A4170" opacity={0.6} /></g>
          </g>
        ) : (
          <g>
            {i === 0 ? (
              <g className="co-soleil">
                <circle cx={y0 + largeur * 0.78} cy={z1 - 0.3} r={0.32} fill="#FFF3B0" opacity={0.35} />
                <circle cx={y0 + largeur * 0.78} cy={z1 - 0.3} r={0.15} fill="#FFE37A" />
              </g>
            ) : null}
            <g className={`co-nuages-defile co-n${i}`}>
              <ellipse cx={y0 + largeur * 0.3} cy={z1 - 0.35} rx={0.32} ry={0.08} fill="#FFFFFF" opacity={0.9} />
              <ellipse cx={y0 + largeur * 0.36} cy={z1 - 0.29} rx={0.2} ry={0.07} fill="#FFFFFF" opacity={0.9} />
              <ellipse cx={y0 + largeur * 0.72} cy={z1 - 0.55} rx={0.25} ry={0.06} fill="#FFFFFF" opacity={0.75} />
            </g>
          </g>
        )}
      </g>
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

// ------------------------------------------------------------------ fond fixe

/** Les zones au sol : teinte légère et liseré de leur couleur, sol propre à chacune. */
function SolsZones({ pal }: { pal: Palette }) {
  const n = pal.nuit;
  return (
    <g>
      {ORDRE_ZONES.map(z => {
        const r = RECTS_ZONES[z];
        const w = r.x1 - r.x0;
        const d = r.y1 - r.y0;
        const remplissage =
          z === 'atelier' ? 'url(#co-moquette)'
          : z === 'machines' ? 'url(#co-technique)'
          : z === 'cafe' ? 'url(#co-carreaux)'
          : z === 'reunion' ? pal.salle
          : `url(#co-zg-${z})`;
        return (
          <g key={z}>
            <rect x={r.x0 + 0.08} y={r.y0 + 0.08} width={w - 0.16} height={d - 0.16} rx={0.25} fill={remplissage} />
            <rect x={r.x0 + 0.08} y={r.y0 + 0.08} width={w - 0.16} height={d - 0.16} rx={0.25} fill={`url(#co-zl-${n ? 'n' : 'j'})`} />
            <rect x={r.x0 + 0.1} y={r.y0 + 0.1} width={w - 0.2} height={d - 0.2} rx={0.25} fill="none" stroke={ZONES[z].teinte} strokeWidth={0.045} opacity={n ? 0.75 : 0.6} strokeDasharray={z === 'guichet' ? '0.25 0.15' : undefined} />
          </g>
        );
      })}
      {/* Tapis : bibliothèque, réflexion (rond), salle d'attente, détente ; paillasson de l'accueil. */}
      <rect x={7.6} y={1.6} width={2.4} height={1.6} rx={0.2} fill={n ? '#5C3B4A' : '#C98A7A'} opacity={0.75} />
      <ellipse cx={2.0} cy={7.8} rx={1.75} ry={1.75} fill={n ? '#3E6B52' : '#9CCBA8'} opacity={0.8} />
      <rect x={1.6} y={11.5} width={1.6} height={2.1} rx={0.3} fill={n ? '#2F5E57' : '#8FC9BE'} opacity={0.75} />
      <rect x={14.4} y={11.6} width={4.0} height={1.4} rx={0.3} fill={pal.tapis} opacity={0.75} />
      <rect x={13.75} y={0.1} width={1.3} height={0.9} rx={0.08} fill={n ? '#4A3A2E' : '#A4805A'} />
      {/* File du guichet : marquage au sol. */}
      {[7.6, 9.0, 10.4, 11.8].map(x => <rect key={x} x={x - 0.45} y={12.65} width={0.9} height={0.06} fill="#F2C14E" opacity={0.85} />)}
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
  const COULEURS_LIVRES = ['#C0504D', '#4F81BD', '#9BBB59', '#F79646', '#8064A2', '#4BACC6', '#D9A441', '#6B4226'];
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
        <radialGradient id="co-alerte">
          <stop offset="0" stopColor="#FF6B6B" stopOpacity={0.55} />
          <stop offset="1" stopColor="#FF6B6B" stopOpacity={0} />
        </radialGradient>
        <radialGradient id="co-ombre-socle">
          <stop offset="0" stopColor={pal.ombre} stopOpacity={n ? 0.5 : 0.22} />
          <stop offset="1" stopColor={pal.ombre} stopOpacity={0} />
        </radialGradient>
        {ORDRE_ZONES.map(z => (
          <radialGradient key={z} id={`co-zg-${z}`} cx="0.35" cy="0.3" r="0.9">
            <stop offset="0" stopColor={ZONES[z].teinte} stopOpacity={n ? 0.34 : 0.26} />
            <stop offset="1" stopColor={ZONES[z].teinte} stopOpacity={n ? 0.1 : 0.07} />
          </radialGradient>
        ))}
        <linearGradient id={`co-zl-${n ? 'n' : 'j'}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity={n ? 0.05 : 0.18} />
          <stop offset="1" stopColor="#000000" stopOpacity={n ? 0.18 : 0.06} />
        </linearGradient>
        <linearGradient id="co-ambiance" x1="0" y1="0" x2="1" y2="0.4">
          <stop offset="0" stopColor={n ? '#6F86FF' : '#FFE6A6'} stopOpacity={n ? 0.1 : 0.3} />
          <stop offset="0.55" stopColor={n ? '#6F86FF' : '#FFE6A6'} stopOpacity={0} />
          <stop offset="1" stopColor={n ? '#03050F' : '#7A5A2A'} stopOpacity={n ? 0.32 : 0.08} />
        </linearGradient>
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
        <pattern id="co-technique" patternUnits="userSpaceOnUse" width={0.6} height={0.6}>
          <rect width={0.6} height={0.6} fill={n ? '#3A4150' : '#C9CED6'} />
          <rect width={0.6} height={0.6} fill="none" stroke={n ? '#2A303C' : '#AEB4BE'} strokeWidth={0.03} />
          <circle cx={0.3} cy={0.3} r={0.04} fill={n ? '#556074' : '#9AA2AE'} />
        </pattern>
      </defs>

      {/* Ombre portée et socle de la maquette. */}
      <ellipse cx={iso(W / 2, D / 2).x} cy={iso(W, D).y - 30} rx={560} ry={70} fill="url(#co-ombre-socle)" />
      <polygon points={pts([[0, D, 0], [W, D, 0], [W, D, -0.45], [0, D, -0.45]])} fill={pal.socleG} />
      <polygon points={pts([[W, 0, 0], [W, D, 0], [W, D, -0.45], [W, 0, -0.45]])} fill={pal.socleD} />

      {/* Sol : parquet, puis le sol de chaque zone ; lumière du jour ou flaques des plafonniers. */}
      <g transform={sol()}>
        <rect width={W} height={D} fill="url(#co-lames)" />
        <SolsZones pal={pal} />
        {n ? (
          <g>
            {[[7.4, 7.75], [11.4, 7.75], [8.8, 2.2], [2.1, 2.2], [17.8, 2.2], [17.6, 9.0], [9.7, 12.4], [2.6, 12.4], [16.6, 12.4], [2.0, 7.8]].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r={2.4} fill="url(#co-flaque)" />)}
          </g>
        ) : (
          <g fill="#FFF6D8" className="co-rayons">
            {[[5.9, 8.1], [8.6, 10.3], [11.3, 13.5]].map(([a, b]) => (
              <polygon key={a} points={`0,${a} 0,${b} 3.4,${b + 1.4} 3.4,${a + 1.4}`} />
            ))}
          </g>
        )}
        <rect width={W} height={D} fill="url(#co-ambiance)" />
      </g>
      {n ? null : (
        <g fill="#FFFFFF" opacity={0.75}>
          {[[1.2, 7.2, 0.9], [2.2, 8.4, 1.3], [1.6, 12.4, 0.7], [2.8, 12.9, 1.1]].map(([x, y, z], k) => {
            const p = iso(x, y, z);
            return <circle key={k} cx={r1(p.x)} cy={r1(p.y)} r={1.3} className={`co-poussiere co-e${k % 3}`} />;
          })}
        </g>
      )}

      {/* Murs. */}
      <polygon points={pts([[0, 0, 0], [0, D, 0], [0, D, H], [0, 0, H]])} fill={pal.murG} />
      <polygon points={pts([[0, 0, 0], [W, 0, 0], [W, 0, H], [0, 0, H]])} fill={pal.murD} />
      <polygon points={pts([[0, D, H], [0, 0, H], [-0.25, -0.25, H], [-0.25, D, H]])} fill={pal.murHaut} />
      <polygon points={pts([[0, 0, H], [W, 0, H], [W, -0.25, H], [-0.25, -0.25, H]])} fill={pal.murHaut} />
      <g transform={planX(0)}>
        <rect x={0} y={0} width={D} height={0.14} fill={pal.plinthe} />
        <Fenetre y0={5.9} y1={8.1} pal={pal} i={0} />
        <Fenetre y0={8.6} y1={10.3} pal={pal} i={1} />
        <Fenetre y0={11.3} y1={13.5} pal={pal} i={2} />
        {/* Écran de la salle de réunion (mur de gauche) : avancement des sous-agents. */}
        <rect x={0.9} y={1.15} width={2.6} height={1.15} rx={0.04} fill={pal.cadre} />
        <rect x={0.98} y={1.22} width={2.44} height={1.01} fill={n ? '#1C3A5E' : '#2F6DB3'} />
        {[0.3, 0.55, 0.42, 0.75, 0.62].map((h, k) => <rect key={k} x={1.2 + k * 0.42} y={1.35} width={0.22} height={h} fill={TEINTES_ACTIVITE[(['code', 'terminal', 'recherche', 'web', 'agent'] as const)[k]]} opacity={0.9} />)}
      </g>
      <g transform={planY(0)}>
        <rect x={0} y={0} width={W} height={0.14} fill={pal.plinthe} />
        {/* Réunion : tableau blanc avec gribouillis et post-it. */}
        <rect x={0.5} y={0.95} width={3.2} height={1.45} rx={0.04} fill={pal.metal} />
        <rect x={0.57} y={1.02} width={3.06} height={1.31} fill={n ? '#D9DCE3' : '#FFFFFF'} />
        <polyline points="0.8,2.0 1.3,2.15 1.7,1.85 2.2,2.1 2.6,1.9" fill="none" stroke="#2E8FE0" strokeWidth={0.035} />
        <polyline points="0.8,1.5 1.4,1.5 1.4,1.25 2.0,1.25" fill="none" stroke="#D9566B" strokeWidth={0.035} />
        <rect x={2.8} y={1.95} width={0.3} height={0.28} fill="#F7D35C" />
        <rect x={3.2} y={1.9} width={0.3} height={0.28} fill="#F59BB5" />
        <rect x={3.0} y={1.5} width={0.3} height={0.28} fill="#9FD8F5" />
        {/* Porte ouverte, panneau de sortie, pendule au-dessus (heure réelle). */}
        <rect x={PORTE.x0 - 0.06} y={0} width={PORTE.x1 - PORTE.x0 + 0.12} height={2.32} fill={pal.plinthe} />
        <rect x={PORTE.x0} y={0} width={PORTE.x1 - PORTE.x0} height={2.25} fill={n ? '#0B0D16' : '#4A4F5C'} />
        <rect x={PORTE.x0 + 0.1} y={0} width={PORTE.x1 - PORTE.x0 - 0.2} height={2.15} fill={n ? '#141A2E' : '#6C7486'} opacity={0.7} />
        <rect x={(PORTE.x0 + PORTE.x1) / 2 - 0.25} y={2.38} width={0.5} height={0.16} rx={0.03} fill="#2FBF71" className="co-sortie" />
        <circle cx={12.4} cy={2.15} r={0.32} fill={pal.cadre} />
        <circle cx={12.4} cy={2.15} r={0.27} fill={n ? '#E9E4D6' : '#FFFFFF'} />
        <line x1={12.4} y1={2.15} x2={12.4 + 0.15 * Math.sin((angleH * Math.PI) / 180)} y2={2.15 + 0.15 * Math.cos((angleH * Math.PI) / 180)} stroke={pal.cadre} strokeWidth={0.045} strokeLinecap="round" />
        <line x1={12.4} y1={2.15} x2={12.4 + 0.22 * Math.sin((angleM * Math.PI) / 180)} y2={2.15 + 0.22 * Math.cos((angleM * Math.PI) / 180)} stroke={pal.cadre} strokeWidth={0.03} strokeLinecap="round" />
        {/* Café web : ardoise au-dessus du comptoir (globe), placards. */}
        <rect x={16.8} y={1.55} width={2.2} height={0.95} rx={0.05} fill={n ? '#1F2A22' : '#2E3B32'} />
        <circle cx={17.35} cy={2.02} r={0.28} fill="none" stroke="#9CC7FF" strokeWidth={0.04} />
        <ellipse cx={17.35} cy={2.02} rx={0.12} ry={0.28} fill="none" stroke="#9CC7FF" strokeWidth={0.03} />
        <line x1={17.07} y1={2.02} x2={17.63} y2={2.02} stroke="#9CC7FF" strokeWidth={0.03} />
        {[0, 1, 2].map(k => <rect key={k} x={17.85} y={1.75 + k * 0.22} width={0.9 - k * 0.2} height={0.07} fill="#E8E2C8" opacity={0.8} />)}
        {n ? <rect x={16.6} y={1.42} width={2.6} height={0.06} fill={pal.lumiere} opacity={0.9} /> : null}
      </g>

      {/* Bibliothèque : étagères pleines contre le mur du fond. */}
      {[5.0, 6.95, 8.9, 10.85].map((x0, k) => (
        <g key={x0}>
          <OmbreSol x={x0} y={0.05} w={1.85} d={0.45} h={2.3} pal={pal} />
          <Boite x={x0} y={0.05} w={1.85} d={0.45} h={2.3} dessus={pal.bois} gauche={pal.boisG} droite={pal.boisD} />
          <g transform={planY(0.5)}>
            {[0.12, 0.68, 1.24, 1.8].map((z, r) => (
              <g key={z}>
                <rect x={x0 + 0.05} y={z - 0.04} width={1.75} height={0.04} fill={pal.boisD} />
                {Array.from({ length: 9 }, (_, b) => {
                  const h = hacher(`livre${k}-${r}-${b}`);
                  const larg = 0.12 + (h % 5) * 0.015;
                  return <rect key={b} x={x0 + 0.1 + b * 0.185} y={z} width={larg} height={0.34 + ((h >>> 3) % 4) * 0.035} fill={COULEURS_LIVRES[h % COULEURS_LIVRES.length]} opacity={n ? 0.75 : 0.95} />;
                })}
              </g>
            ))}
          </g>
        </g>
      ))}

      {/* Café web : comptoir, machine à café fumante, ordinateurs portables, frigo. */}
      <Boite x={16.6} y={0.05} w={2.6} d={0.85} h={0.95} dessus={pal.bois} gauche={pal.blancG} droite={pal.blancD} />
      <Boite x={16.75} y={0.15} z={0.95} w={0.5} d={0.45} h={0.55} dessus="#3A3F4A" gauche="#2A2E37" droite="#22262E" />
      <g className="co-vapeur-cafe">
        {[0, 1, 2].map(k => {
          const p = iso(17.0, 0.6, 1.1);
          return <ellipse key={k} cx={p.x - 2 + k * 2} cy={p.y - 8} rx={2} ry={3.5} fill="#FFFFFF" opacity={0.5} className={`co-vapeur co-v${k}`} />;
        })}
      </g>
      {[17.55, 18.45].map(x => (
        <g key={x}>
          <Boite x={x} y={0.45} z={0.95} w={0.5} d={0.32} h={0.02} dessus="#C9CED6" gauche="#AEB4BE" droite="#9AA2AE" />
          <g transform={planY(0.45)}><rect x={x + 0.04} y={0.97} width={0.42} height={0.3} fill="#9CC7FF" /><rect x={x + 0.04} y={1.2} width={0.42} height={0.07} fill="#DCE4EE" /></g>
        </g>
      ))}
      <Boite x={19.25} y={0.05} w={0.7} d={0.85} h={1.95} dessus={pal.blancG} gauche={pal.blanc} droite={pal.blancD} />

      {/* Salle d'attente : banquette le long du mur, fontaine à eau. */}
      <Boite x={0.15} y={11.3} w={0.35} d={2.45} h={0.95} dessus={pal.canapeG} gauche={pal.canapeG} droite={pal.canapeD} />
      <Boite x={0.15} y={11.05} w={1.0} d={0.25} h={0.62} dessus={pal.canape} gauche={pal.canapeG} droite={pal.canapeD} />
      <Boite x={0.5} y={11.3} w={0.65} d={2.45} h={0.42} dessus={pal.canape} gauche={pal.canapeG} droite={pal.canapeD} />
      <Boite x={0.15} y={13.75} w={1.0} d={0.25} h={0.62} dessus={pal.canape} gauche={pal.canapeG} droite={pal.canapeD} />
      <Plante x={0.5} y={10.6} pal={pal} taille={0.9} />

      {/* Plantes le long des murs. */}
      <Plante x={4.55} y={0.45} pal={pal} taille={1.0} />
      <Plante x={0.45} y={5.25} pal={pal} taille={1.1} />
      <Plante x={12.75} y={0.55} pal={pal} taille={0.9} />
    </g>
  );
}

/** Premier plan : suspensions au-dessus des zones et plante d'angle. */
const PremierPlan = React.memo(function PremierPlan({ pal }: { pal: Palette }) {
  const lampes: Array<[number, number]> = [...ILOTS_ATELIER.map(x0 => [x0 + LARGEUR_BUREAU, 7.75] as [number, number]), [2.3, 2.2], [8.75, 2.6], [17.9, 2.2], [17.5, 7.9], [9.7, 12.0]];
  return (
    <g>
      <Plante x={19.55} y={13.6} pal={pal} taille={1.2} />
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

// ------------------------------------------------------------------ écrans

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
    case 'attend':
      return (
        <g>
          <rect x={x0} y={z0} width={w} height={h} fill="#3A1216" />
          <rect x={x0 + w / 2 - 0.03} y={z0 + h * 0.4} width={0.06} height={h * 0.38} fill="#FF6B6B" className="co-curseur" />
          <rect x={x0 + w / 2 - 0.03} y={z0 + h * 0.2} width={0.06} height={0.06} fill="#FF6B6B" className="co-curseur" />
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

// ------------------------------------------------------------------ postes (bureaux à écran)

const OBJETS_BUREAU = ['tasse', 'plante', 'papiers', 'cadre', 'lampe', 'rien'] as const;

/** Bureau d'une place « bureau » : devant elle, dans la direction de son regard. */
export function bureauDe(p: Place): { x: number; y: number; w: number; d: number } {
  return p.regard.y > 0 ? { x: p.pos.x - LARGEUR_BUREAU / 2, y: p.pos.y + 0.6, w: LARGEUR_BUREAU, d: 1 } : { x: p.pos.x - LARGEUR_BUREAU / 2, y: p.pos.y - 1.6, w: LARGEUR_BUREAU, d: 1 };
}

const PosteDessin = React.memo(function PosteDessin({ place, pal, activite, fige, occupe }: { place: Place; pal: Palette; activite: Activite | 'vide'; fige: boolean; occupe: boolean }) {
  const { x, y, w, d } = bureauDe(place);
  const xc = place.pos.x;
  const fond = place.regard.y > 0;
  const allume = activite !== 'vide' && activite !== 'fini' && !fige;
  const teinte = activite === 'vide' ? '#8E95A8' : TEINTES_ACTIVITE[activite];
  const objet = place.zone === 'machines' ? 'rien' : OBJETS_BUREAU[hacher(`poste${place.index}`) % OBJETS_BUREAU.length];
  const coin = iso(fond ? x + 0.35 : x + w - 0.35, fond ? y + 0.35 : y + 0.65, 0.75);
  const clavierY = fond ? y + 0.15 : y + d - 0.38;
  const yEcran = fond ? y + d - 0.22 : y + 0.22;
  const led = iso(x + w - 0.08, y + d - 0.02, 0.6);
  return (
    <g>
      <OmbreSol x={x} y={y} w={w} d={d} h={0.75} pal={pal} />
      <Boite x={x + 0.08} y={y + 0.1} w={0.07} d={d - 0.2} h={0.69} dessus={pal.pied} gauche={pal.pied} droite={pal.metalD} />
      <Boite x={x + w - 0.15} y={y + 0.1} w={0.07} d={d - 0.2} h={0.69} dessus={pal.pied} gauche={pal.pied} droite={pal.metalD} />
      <Boite x={x + 0.02} y={y} z={0.69} w={w - 0.04} d={d} h={0.06} dessus={pal.bureau} gauche={pal.bureauG} droite={pal.bureauD} />
      {allume ? (
        <g transform={sol(0.76)}>
          <ellipse cx={xc} cy={y + 0.5} rx={0.9} ry={0.5} fill="url(#co-halo)" opacity={pal.nuit ? 0.9 : 0.35} />
        </g>
      ) : null}
      <g transform={sol(0.76)}>
        <rect x={xc - 0.36} y={clavierY} width={0.62} height={0.2} rx={0.03} fill={pal.nuit ? '#4A5064' : '#D5D9E0'} />
        <rect x={xc + 0.36} y={clavierY + 0.03} width={0.1} height={0.14} rx={0.05} fill={pal.nuit ? '#4A5064' : '#D5D9E0'} />
      </g>
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
            <Ecran x0={xc - 0.58} x1={xc + 0.58} z0={0.95} z1={1.55} activite={activite} fige={fige} cle={`e${place.index}`} />
          </g>
        )}
      </g>
      {fond ? (
        <g>
          <polygon points={pts([[x, y + d, 0.75], [x + w, y + d, 0.75], [x + w, y + d, 1.12], [x, y + d, 1.12]])} fill={pal.cloison} />
          <polygon points={pts([[x, y + d, 1.12], [x + w, y + d, 1.12], [x + w, y + d + 0.04, 1.12], [x, y + d + 0.04, 1.12]])} fill={pal.cloisonD} />
        </g>
      ) : null}
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
      <circle cx={led.x} cy={led.y} r={2.3} fill={occupe ? teinte : pal.nuit ? '#3A3F4C' : '#C9CDD5'} className={allume ? 'co-led-actif' : undefined} />
    </g>
  );
});

/** Le siège d'une place (rien pour une place debout ou la banquette du mur). */
const Siege = React.memo(function Siege({ place, pal }: { place: Place; pal: Palette }) {
  const { pos, regard, genre } = place;
  const dos = { x: pos.x - regard.x * 0.28, y: pos.y - regard.y * 0.28 };
  if (genre === 'bureau' || genre === 'chaise') {
    const p = iso(dos.x, dos.y);
    const haut = regard.y > 0 || regard.x > 0;
    return (
      <g transform={`translate(${r1(p.x)} ${r1(p.y)})`}>
        <ellipse cx={0} cy={0} rx={11} ry={4.5} fill={pal.ombre} opacity={0.16} />
        <path d="M-9,0 L9,0 M0,-4 L0,4 M-6,-3 L6,3 M-6,3 L6,-3" stroke={pal.chaise} strokeWidth={1.6} strokeLinecap="round" />
        <rect x={-1.6} y={-13} width={3.2} height={13} fill={pal.metalD} />
        <ellipse cx={0} cy={-14} rx={12} ry={5} fill={pal.assise} />
        <rect x={-11} y={haut ? -38 : -34} width={22} height={haut ? 22 : 19} rx={5} fill={pal.chaise} />
        <rect x={-9} y={haut ? -36 : -32} width={18} height={4} rx={2} fill={pal.assise} opacity={0.6} />
      </g>
    );
  }
  if (genre === 'tabouret') {
    const p = iso(pos.x, pos.y);
    return (
      <g transform={`translate(${r1(p.x)} ${r1(p.y)})`}>
        <ellipse cx={0} cy={0} rx={9} ry={3.5} fill={pal.ombre} opacity={0.16} />
        <rect x={-1.5} y={-22} width={3} height={22} fill={pal.metalD} />
        <ellipse cx={0} cy={-23} rx={10} ry={4} fill={pal.bois} />
      </g>
    );
  }
  if (genre === 'pouf') {
    const p = iso(pos.x, pos.y);
    const c = ['#E9A97D', '#9CCBA8', '#B9A3E3', '#F2C14E'][place.index % 4];
    return (
      <g transform={`translate(${r1(p.x)} ${r1(p.y)})`}>
        <ellipse cx={0} cy={0} rx={15} ry={6.5} fill={pal.ombre} opacity={0.16} />
        <path d="M-14,-2 L-14,-11 Q0,-17 14,-11 L14,-2 Q0,4 -14,-2 Z" fill={fonce(c, pal.nuit ? 0.6 : 0.85)} />
        <ellipse cx={0} cy={-11} rx={14} ry={5.5} fill={pal.nuit ? fonce(c, 0.75) : c} />
      </g>
    );
  }
  if (genre === 'fauteuil') {
    const bx = regard.x > 0 ? pos.x - 0.46 : regard.x < 0 ? pos.x + 0.3 : pos.x - 0.38;
    const by = regard.y > 0 ? pos.y - 0.46 : regard.y < 0 ? pos.y + 0.3 : pos.y - 0.38;
    const lateral = regard.x !== 0;
    return (
      <g>
        <Boite x={pos.x - 0.38} y={pos.y - 0.38} w={0.76} d={0.76} h={0.4} dessus={pal.canape} gauche={pal.canapeG} droite={pal.canapeD} />
        <Boite x={bx} y={by} w={lateral ? 0.16 : 0.76} d={lateral ? 0.76 : 0.16} h={0.85} dessus={pal.canapeG} gauche={pal.canapeG} droite={pal.canapeD} />
      </g>
    );
  }
  return null;
});

interface Meuble {
  cle: string;
  profondeur: number;
  rendu: React.ReactNode;
}

/** Mobilier qui se trie avec les personnages (on passe devant ou derrière). */
function meublesTries(pal: Palette, guichetActif: boolean, machinesActives: boolean): Meuble[] {
  const m: Meuble[] = [];
  const boite = (cle: string, b: { x: number; y: number; z?: number; w: number; d: number; h: number }, couleurs: [string, string, string], extra?: React.ReactNode) => m.push({
    cle,
    profondeur: b.x + b.w / 2 + b.y + b.d / 2,
    rendu: (
      <g key={cle}>
        {b.z ? null : <OmbreSol x={b.x} y={b.y} w={b.w} d={b.d} h={b.h} pal={pal} />}
        <Boite {...b} dessus={couleurs[0]} gauche={couleurs[1]} droite={couleurs[2]} />
        {extra}
      </g>
    ),
  });
  const bois: [string, string, string] = [pal.bois, pal.boisG, pal.boisD];
  // Réunion : table et parois vitrées (devant ceux qui sont dedans).
  boite('table-reunion', { x: 1.0, y: 1.45, w: 2.6, d: 1.5, h: 0.72 }, bois, <Boite x={1.6} y={1.8} z={0.72} w={0.5} d={0.35} h={0.03} dessus="#FFFFFF" gauche="#DDD" droite="#CCC" />);
  m.push({
    cle: 'vitres-reunion', profondeur: 6.55, rendu: (
      <g key="vitres-reunion" opacity={pal.nuit ? 0.5 : 0.62} pointerEvents="none">
        <polygon points={pts([[4.2, 0, 0], [4.2, 4.4, 0], [4.2, 4.4, 2.6], [4.2, 0, 2.6]])} fill={pal.vitre} opacity={0.32} />
        <polygon points={pts([[0, 4.4, 0], [3.45, 4.4, 0], [3.45, 4.4, 2.6], [0, 4.4, 2.6]])} fill={pal.vitre} opacity={0.32} />
        <polygon points={pts([[0, 4.4, 1.05], [3.45, 4.4, 1.05], [3.45, 4.4, 1.3], [0, 4.4, 1.3]])} fill={pal.vitreBord} opacity={0.55} />
        <polygon points={pts([[4.2, 0, 1.05], [4.2, 4.4, 1.05], [4.2, 4.4, 1.3], [4.2, 0, 1.3]])} fill={pal.vitreBord} opacity={0.55} />
        <polyline points={pts([[0, 4.4, 2.6], [4.2, 4.4, 2.6], [4.2, 0, 2.6]])} fill="none" stroke={pal.vitreBord} strokeWidth={2} />
        <polyline points={pts([[3.45, 4.4, 0], [3.45, 4.4, 2.6]])} fill="none" stroke={pal.vitreBord} strokeWidth={2} />
        <polyline points={pts([[4.2, 4.4, 0], [4.2, 4.4, 2.6]])} fill="none" stroke={pal.vitreBord} strokeWidth={2} />
        <polyline points={pts([[4.2, 2.2, 0], [4.2, 2.2, 2.6]])} fill="none" stroke={pal.vitreBord} strokeWidth={1.2} />
      </g>
    ),
  });
  // Salle des machines : cloison vitrée basse côté couloir (devant ceux du couloir, derrière ceux de la salle).
  m.push({
    cle: 'vitres-machines', profondeur: 15.2 + 9.6, rendu: (
      <g key="vitres-machines" pointerEvents="none">
        <polygon points={pts([[15.2, 6.4, 0], [15.2, 9.6, 0], [15.2, 9.6, 1.35], [15.2, 6.4, 1.35]])} fill={pal.vitre} opacity={pal.nuit ? 0.14 : 0.22} />
        <polygon points={pts([[15.2, 6.4, 1.2], [15.2, 9.6, 1.2], [15.2, 9.6, 1.35], [15.2, 6.4, 1.35]])} fill={pal.vitreBord} opacity={0.6} />
        <polyline points={pts([[15.2, 6.4, 0], [15.2, 6.4, 1.35]])} fill="none" stroke={pal.vitreBord} strokeWidth={1.6} opacity={0.8} />
        <polyline points={pts([[15.2, 9.6, 0], [15.2, 9.6, 1.35]])} fill="none" stroke={pal.vitreBord} strokeWidth={1.6} opacity={0.8} />
        <polyline points={pts([[15.2, 7.0, 0.25], [15.2, 7.6, 1.0]])} fill="none" stroke="#FFFFFF" strokeWidth={1.2} opacity={0.35} />
      </g>
    ),
  });
  // Bibliothèque : deux tables de lecture avec livres ouverts.
  for (const x of [5.8, 9.8]) {
    boite(`table-lecture-${x}`, { x, y: 2.0, w: 1.8, d: 0.8, h: 0.72 }, bois, (
      <g transform={sol(0.73)}>
        <rect x={x + 0.25} y={2.25} width={0.42} height={0.3} fill="#FFFFFF" /><rect x={x + 0.46} y={2.25} width={0.01} height={0.3} fill="#9AA6B5" />
        <rect x={x + 1.1} y={2.3} width={0.38} height={0.26} fill="#C0504D" />
      </g>
    ));
  }
  // Accueil : banque d'accueil, plante.
  boite('banque-accueil', { x: 15.75, y: 0.9, w: 0.45, d: 2.2, h: 1.0 }, [pal.blanc, pal.blancG, ZONES.accueil.teinte]);
  // Café web : mange-debout, globe sur pied.
  boite('mange-debout', { x: 19.0, y: 2.6, w: 0.8, d: 0.7, h: 1.05 }, bois, <Boite x={19.15} y={2.75} z={1.05} w={0.45} d={0.3} h={0.02} dessus="#C9CED6" gauche="#AEB4BE" droite="#9AA2AE" />);
  {
    const p = iso(16.75, 3.25);
    m.push({
      cle: 'globe', profondeur: 16.75 + 3.25, rendu: (
        <g key="globe" transform={`translate(${r1(p.x)} ${r1(p.y)})`}>
          <ellipse cx={0} cy={0} rx={8} ry={3} fill={pal.metalD} />
          <rect x={-1} y={-30} width={2} height={30} fill={pal.metalD} />
          <g className="co-globe-salle"><circle cx={0} cy={-40} r={11} fill="#2E8FE0" /><ellipse cx={0} cy={-40} rx={5} ry={11} fill="none" stroke="#BFE0FF" strokeWidth={1.2} className="co-meridien" /><path d="M-8,-44 q4,-3 8,0 q3,3 7,1" fill="none" stroke="#7CD6A0" strokeWidth={2.2} /></g>
        </g>
      ),
    });
  }
  // Salle des machines : baies serveurs (par tranches, pour passer derrière proprement).
  for (let k = 0; k < 5; k++) {
    const x = 15.6 + k * 0.82;
    boite(`baie-${k}`, { x, y: 5.75, w: 0.78, d: 0.6, h: 2.0 }, ['#3A4150', '#2A303C', '#232833'], (
      <g transform={planY(6.35)}>
        {[0.3, 0.65, 1.0, 1.35, 1.7].map((z, r) => (
          <g key={z}>
            <rect x={x + 0.06} y={z} width={0.66} height={0.26} fill="#1B1F28" />
            {[0, 1, 2].map(j => <circle key={j} cx={x + 0.14 + j * 0.09} cy={z + 0.13} r={0.025} fill={(k + r + j) % 3 === 0 ? '#F2C14E' : '#3BE38B'} className={machinesActives && (k + r + j) % 2 === 0 ? `co-led-actif co-l${(k + r + j) % 3}` : undefined} />)}
          </g>
        ))}
      </g>
    ));
  }
  // Salle d'attente : banquette face au mur (dossier devant ceux qui y sont assis), table basse, fontaine.
  boite('banquette-assise', { x: 3.25, y: 11.65, w: 0.5, d: 1.85, h: 0.42 }, [pal.canape, pal.canapeG, pal.canapeD]);
  boite('banquette-dossier', { x: 3.75, y: 11.65, w: 0.16, d: 1.85, h: 0.85 }, [pal.canapeG, pal.canapeG, pal.canapeD]);
  boite('table-attente', { x: 2.05, y: 11.95, w: 0.4, d: 0.9, h: 0.35 }, bois, <Boite x={2.12} y={12.1} z={0.35} w={0.26} d={0.3} h={0.04} dessus="#F2C14E" gauche="#D9A441" droite="#C08E33" />);
  boite('fontaine', { x: 5.15, y: 11.25, w: 0.42, d: 0.42, h: 0.95 }, [pal.blanc, pal.blancG, pal.blancD], <Boite x={5.2} y={11.3} z={0.95} w={0.32} d={0.32} h={0.4} dessus="#BFE3FF" gauche="#9CC7FF" droite="#86B5EF" />);
  // Guichet « Attend ta réponse » : comptoir par tranches, sonnette, gyrophare.
  for (let k = 0; k < 6; k++) {
    const x = 6.8 + k * 0.97;
    boite(`guichet-${k}`, { x, y: 12.9, w: 0.95, d: 0.6, h: 0.72 }, [pal.blanc, pal.blancG, fonce(ZONES.guichet.teinte, pal.nuit ? 0.7 : 0.95)], k === 3 ? (
      (() => {
        const s = iso(x + 0.45, 13.15, 0.72);
        return <g transform={`translate(${r1(s.x)} ${r1(s.y)})`}><ellipse cx={0} cy={0} rx={6} ry={2.4} fill="#7A5A1E" /><path d="M-5,-1 Q0,-10 5,-1 Z" fill="#F2C14E" /><circle cx={0} cy={-8} r={1.4} fill="#7A5A1E" /></g>;
      })()
    ) : null);
  }
  {
    const g = iso(12.45, 13.2, 0.72);
    m.push({
      cle: 'gyrophare', profondeur: 12.45 + 13.25, rendu: (
        <g key="gyrophare" transform={`translate(${r1(g.x)} ${r1(g.y)})`}>
          <rect x={-1.2} y={-26} width={2.4} height={26} fill={pal.metalD} />
          {guichetActif ? <circle cx={0} cy={-31} r={22} fill="url(#co-alerte)" className="co-gyro" /> : null}
          <path d="M-6,-26 L-5,-35 Q0,-39 5,-35 L6,-26 Z" fill={guichetActif ? '#FF4D4F' : '#8E5A5A'} className={guichetActif ? 'co-gyro' : undefined} />
        </g>
      ),
    });
  }
  // Détente : table basse, machine à café fumante.
  boite('table-detente', { x: 15.55, y: 11.95, w: 0.65, d: 0.55, h: 0.35 }, bois);
  boite('comptoir-cafe', { x: 19.1, y: 11.4, w: 0.8, d: 1.9, h: 1.0 }, bois, (
    <g>
      <Boite x={19.25} y={11.9} z={1.0} w={0.5} d={0.45} h={0.55} dessus="#3A3F4A" gauche="#2A2E37" droite="#22262E" />
      <g className="co-vapeur-cafe">{[0, 1].map(k => { const p = iso(19.2, 12.15, 1.2); return <ellipse key={k} cx={p.x - 1 + k * 3} cy={p.y - 6} rx={2} ry={3.5} fill="#FFFFFF" opacity={0.5} className={`co-vapeur co-v${k}`} />; })}</g>
    </g>
  ));
  // Plantes libres.
  for (const [x, y, k] of [[0.7, 9.4, 1.0], [3.7, 5.95, 0.9], [13.25, 9.4, 0.9], [5.6, 13.6, 0.95], [13.6, 13.55, 1.0], [12.7, 11.4, 0.85]] as const) {
    m.push({ cle: `plante-${x}-${y}`, profondeur: x + y, rendu: <Plante key={`plante-${x}-${y}`} x={x} y={y} pal={pal} taille={k} /> });
  }
  // Sièges des places.
  for (const p of PLACES) {
    if (p.genre === 'debout' || (p.genre === 'canape' && p.zone === 'salle')) continue;
    const dos = { x: p.pos.x - p.regard.x * 0.28, y: p.pos.y - p.regard.y * 0.28 };
    m.push({ cle: `siege-${p.index}`, profondeur: p.genre === 'pouf' || p.genre === 'tabouret' ? p.pos.x + p.pos.y - 0.01 : dos.x + dos.y, rendu: <Siege key={`siege-${p.index}`} place={p} pal={pal} /> });
  }
  return m;
}

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

type Jambes = 'cachees' | 'assises' | 'debout';

/** Un personnage (pieds en 0,0 ; regarde vers la droite-bas en vue de face, la droite-haut de dos). */
const Personnage = React.memo(function Personnage({ ap, vue, mode, activite, carton, jambes }: { ap: Apparence; vue: 'face' | 'dos'; mode: ModePose; activite: Activite; carton: boolean; jambes: Jambes }) {
  const manche = fonce(ap.haut, 0.85);
  const pose = mode === 'fete' ? 'fete' : carton || mode === 'range' ? 'carton' : mode === 'marche' ? 'marche' : activite === 'attend' ? 'main' : activite === 'pense' ? 'pense' : activite === 'pause' ? 'pause' : activite === 'fini' ? 'repos' : jambes === 'cachees' ? 'clavier' : 'repos';
  const brasG = pose === 'fete' ? 'M-9,-31 L-13,-40 L-14,-48' : pose === 'carton' ? 'M-9,-31 L-11,-24 L-8,-21' : pose === 'clavier' ? 'M-9,-31 L-11,-23 L-6,-19' : 'M-9,-31 L-11,-24 L-11,-17';
  const brasD = pose === 'fete' ? 'M9,-31 L13,-40 L14,-48'
    : pose === 'main' ? 'M9,-31 L13,-42 L14,-55'
      : pose === 'carton' ? 'M9,-31 L11,-24 L8,-21'
        : pose === 'pense' ? 'M9,-31 L12,-24 L7,-35'
          : pose === 'pause' ? 'M9,-31 L11,-24 L6,-27'
            : pose === 'clavier' ? 'M9,-31 L11,-23 L6,-19' : 'M9,-31 L11,-24 L11,-17';
  const fin = (d: string) => d.split(' ').pop()!.replace('L', '').split(',').map(Number) as [number, number];
  const [hgx, hgy] = fin(brasG);
  const [hdx, hdy] = fin(brasD);
  return (
    <g className={`co-m-${mode} co-a-${activite} co-p-${pose}`}>
      <ellipse cx={0} cy={0} rx={11} ry={4.2} fill="#000" opacity={0.16} />
      {jambes === 'debout' || mode === 'marche' ? (
        <g>
          <g className="co-jg"><rect x={-7} y={-16} width={6} height={16} rx={2.5} fill={ap.pantalon} /><ellipse cx={-4} cy={-0.5} rx={4} ry={2} fill="#2A2A30" /></g>
          <g className="co-jd"><rect x={1} y={-16} width={6} height={16} rx={2.5} fill={ap.pantalon} /><ellipse cx={4} cy={-0.5} rx={4} ry={2} fill="#2A2A30" /></g>
        </g>
      ) : jambes === 'assises' ? (
        <g>
          <rect x={-8} y={-16} width={7} height={13} rx={3} fill={ap.pantalon} transform={vue === 'face' ? 'skewY(18)' : 'skewY(-18)'} />
          <rect x={1} y={-16} width={7} height={13} rx={3} fill={ap.pantalon} transform={vue === 'face' ? 'skewY(18)' : 'skewY(-18)'} />
          <ellipse cx={-4} cy={vue === 'face' ? -2 : -6} rx={4} ry={2} fill="#2A2A30" />
          <ellipse cx={5} cy={vue === 'face' ? 1 : -9} rx={4} ry={2} fill="#2A2A30" />
        </g>
      ) : null}
      <g className="co-corps">
        <g className="co-souffle">
          <path d="M-10,-14 L-10,-28 Q-10,-34 -4,-34 L4,-34 Q10,-34 10,-28 L10,-14 Q0,-11 -10,-14 Z" fill={ap.haut} />
          <path d="M3,-33.6 Q10,-33.5 10,-28 L10,-14 Q6.5,-12.6 3.5,-12.4 Z" fill="#000" opacity={0.13} />
          <path d="M-9,-27 Q-9,-32 -5,-33" fill="none" stroke="#FFF" strokeWidth={1.4} strokeLinecap="round" opacity={0.22} />
          <rect x={-10} y={-16.5} width={20} height={2.2} rx={1} fill={fonce(ap.pantalon, 0.8)} opacity={0.9} />
        </g>
        {vue === 'face' ? <path d="M-3,-34 L0,-30 L3,-34 Z" fill="#FFFFFF" opacity={0.85} /> : <rect x={-4} y={-34.5} width={8} height={3} rx={1.5} fill={manche} />}
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
          <circle cx={hdx} cy={hdy} r={pose === 'main' ? 3.4 : 2.6} fill={ap.peau} />
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
        <g className="co-tete">
          {ap.coupe === 'longue' && vue === 'dos' ? <path d="M-12,-45 L-12,-29 Q0,-26 12,-29 L12,-45 Z" fill={ap.cheveux} /> : null}
          <rect x={-3} y={-36} width={6} height={4} fill={fonce(ap.peau, 0.9)} />
          <circle cx={vue === 'face' ? 1 : 0} cy={-44} r={11} fill={ap.peau} />
          {vue === 'face' ? (
            <g>
              <circle cx={-6.5} cy={-43} r={2.2} fill={fonce(ap.peau, 0.9)} />
              <CheveuxFace ap={ap} />
              {ap.accessoire === 'bonnet' ? null : <ellipse cx={-1} cy={-52.5} rx={5} ry={1.5} fill="#FFFFFF" opacity={0.2} transform="rotate(-12 -1 -52.5)" />}
              <g className="co-yeux">
                <ellipse cx={2.4} cy={-42.5} rx={1.3} ry={1.8} fill="#1F2330" />
                <ellipse cx={8.2} cy={-42.5} rx={1.3} ry={1.8} fill="#1F2330" />
              </g>
              <ellipse cx={0.5} cy={-38.8} rx={2} ry={1.1} fill="#F08C8C" opacity={0.45} />
              <ellipse cx={10} cy={-38.8} rx={1.6} ry={1.1} fill="#F08C8C" opacity={0.45} />
              {mode === 'fete' || activite === 'fini' ? <path d="M3.5,-38.5 q2.2,3 4.4,0 Z" fill="#7A2E2E" /> : activite === 'attend' ? <ellipse cx={5.6} cy={-37.6} rx={1.4} ry={1.6} fill="#7A2E2E" /> : <path d="M3.8,-38 q1.8,1.6 3.6,0" fill="none" stroke="#7A3B3B" strokeWidth={1} strokeLinecap="round" />}
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
}, (a, b) => a.vue === b.vue && a.mode === b.mode && a.activite === b.activite && a.carton === b.carton && a.jambes === b.jambes && JSON.stringify(a.ap) === JSON.stringify(b.ap));

// ------------------------------------------------------------------ pastilles d'état, noms de zone

function Badge({ x, y, activite, pal, fige }: { x: number; y: number; activite: Activite; pal: Palette; fige: boolean }) {
  const k = 0.9;
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
  if (activite === 'attend' && !fige) {
    return (
      <g transform={`translate(${r1(x)} ${r1(y)}) scale(${k * 1.25})`} pointerEvents="none" data-testid="scene-attend">
        <circle r={15} fill="#E5484D" opacity={0.25} className="co-pulse" />
        <circle r={11} fill="#E5484D" stroke="#FFFFFF" strokeWidth={2} />
        <text y={5} textAnchor="middle" fontSize={15} fontWeight={900} fill="#FFFFFF">!</text>
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

/** Où poser le nom de chaque zone (écran) : au mur pour celles du fond, au sol devant les autres. */
function ancreEnseigne(z: Zone): { x: number; y: number } {
  const r = RECTS_ZONES[z];
  const cx = (r.x0 + r.x1) / 2;
  if (r.y0 === 0) return iso(z === 'accueil' ? 13.2 : cx, 0, 2.78);
  if (z === 'reflexion') return iso(0, (r.y0 + r.y1) / 2, 2.78);
  if (r.y1 >= PROFONDEUR_PIECE) { const p = iso(cx, PROFONDEUR_PIECE, -0.45); return { x: p.x, y: p.y + 20 }; }
  return iso(cx, r.y1 + 0.2);
}

/**
 * Nom discret d'une zone (le détail vient au survol). Seuls le guichet et la
 * salle d'attente portent un compteur, quand quelqu'un y est.
 */
function Enseigne({ zone, nombre, sansPlace, pal, grand }: { zone: Zone; nombre: number; sansPlace: number; pal: Palette; grand: boolean }) {
  const info = ZONES[zone];
  const taille = grand ? 17 : 15;
  const compteur = (zone === 'guichet' || zone === 'salle') && nombre > 0;
  const largeur = largeurTexte(info.nom, taille, true);
  const a = ancreEnseigne(zone);
  return (
    <g transform={`translate(${r1(a.x)} ${r1(a.y)})`} pointerEvents="none" data-testid={`scene-zone-${zone}`} data-nombre={nombre} className={compteur && zone === 'guichet' ? 'co-enseigne-urgente' : undefined}>
      <circle cx={r1(-largeur / 2 - 9)} cy={-taille * 0.32} r={4} fill={info.teinte} />
      <text textAnchor="middle" fontSize={taille} fontWeight={700} fill={pal.badgeTexte} opacity={0.82} stroke={pal.nuit ? '#10131F' : '#FFFFFF'} strokeOpacity={0.7} strokeWidth={4} paintOrder="stroke" strokeLinejoin="round">{info.nom}</text>
      {compteur ? (
        <g transform={`translate(${r1(largeur / 2 + 16)} ${r1(-taille * 0.32)})`}>
          <circle r={12} fill={info.teinte} stroke="#FFFFFF" strokeWidth={2} />
          <text y={5} textAnchor="middle" fontSize={14} fontWeight={800} fill="#FFFFFF">{nombre}</text>
        </g>
      ) : null}
      {sansPlace ? <text y={taille + 2} textAnchor="middle" fontSize={13} fontWeight={600} fill={pal.badgeTexte} opacity={0.75}>{`+${sansPlace} sans place`}</text> : null}
    </g>
  );
}

const largeurTexte = (texte: string, taille: number, gras = false) => texte.length * taille * (gras ? 0.6 : 0.54);

// ------------------------------------------------------------------ feuille de style

const CSS = `
.co-scene{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.co-yeux,.co-tete,.co-bg,.co-bd,.co-jg,.co-jd,.co-souffle,.co-ligne,.co-meridien,.co-progres,.co-engrenage,.co-feuillage,.co-confetti,.co-vapeur,.co-pulse,.co-repere,.co-poussiere{transform-box:fill-box}
.co-clic{cursor:pointer}
@keyframes co-tape{from{transform:translateY(0)}to{transform:translateY(-2px)}}
.co-p-clavier.co-a-code .co-bg{animation:co-tape .2s ease-in-out infinite alternate}
.co-p-clavier.co-a-code .co-bd{animation:co-tape .2s ease-in-out .1s infinite alternate}
@keyframes co-souris{0%,100%{transform:translate(0,0)}35%{transform:translate(1.5px,-1px)}70%{transform:translate(-1px,1px)}}
.co-p-clavier .co-bd,.co-p-repos.co-a-lecture .co-bd,.co-p-repos.co-a-web .co-bd,.co-p-repos.co-a-recherche .co-bd{animation:co-souris 1.4s ease-in-out infinite}
.co-p-clavier.co-a-terminal .co-bg{animation:co-tape .3s ease-in-out infinite alternate}
@keyframes co-salut{0%,100%{transform:rotate(-8deg)}50%{transform:rotate(10deg)}}
.co-p-main .co-bd{transform-origin:20% 95%;animation:co-salut .9s ease-in-out infinite}
@keyframes co-cligne{0%,93%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
.co-yeux{transform-origin:center;animation:co-cligne 4.6s infinite;animation-delay:var(--co-d,0s)}
@keyframes co-souffle{0%,100%{transform:scaleY(1)}50%{transform:scaleY(1.03)}}
.co-m-assis .co-souffle,.co-m-debout .co-souffle{transform-origin:50% 100%;animation:co-souffle 3.8s ease-in-out infinite;animation-delay:var(--co-d,0s)}
@keyframes co-regard{0%,84%,100%{transform:rotate(0)}88%,95%{transform:rotate(5deg)}}
.co-m-debout .co-tete,.co-p-repos .co-tete,.co-p-clavier .co-tete{transform-origin:50% 100%;animation:co-regard 9s ease-in-out infinite;animation-delay:var(--co-d,0s)}
@keyframes co-penche{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(3deg)}}
.co-a-pense .co-tete{transform-origin:50% 100%;animation:co-penche 3.4s ease-in-out infinite}
@keyframes co-boit{0%,62%,100%{transform:translate(0,0)}70%,86%{transform:translate(-2px,-7px)}}
.co-p-pause .co-tasse-main{animation:co-boit 6.5s ease-in-out infinite;animation-delay:var(--co-d,0s)}
@keyframes co-etire{0%,80%,100%{transform:rotate(0)}85%,94%{transform:rotate(150deg)}}
.co-p-pause .co-bg{transform-origin:85% 5%;animation:co-etire 12s ease-in-out infinite;animation-delay:var(--co-d,0s)}
@keyframes co-saut{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
.co-m-fete .co-corps{animation:co-saut .45s ease-in-out infinite}
@keyframes co-jambe{from{transform:rotate(-17deg)}to{transform:rotate(17deg)}}
.co-m-marche .co-jg{transform-origin:50% 0;animation:co-jambe .3s ease-in-out infinite alternate}
.co-m-marche .co-jd{transform-origin:50% 0;animation:co-jambe .3s ease-in-out infinite alternate-reverse}
@keyframes co-rebond{from{transform:translateY(0)}to{transform:translateY(-2px)}}
.co-m-marche .co-corps{animation:co-rebond .3s ease-in-out infinite alternate}
@keyframes co-balance{from{transform:rotate(-16deg)}to{transform:rotate(16deg)}}
.co-m-marche .co-bg{transform-origin:50% 0;animation:co-balance .6s ease-in-out infinite alternate-reverse}
.co-m-marche .co-bd{transform-origin:50% 0;animation:co-balance .6s ease-in-out infinite alternate}
@keyframes co-monte{0%{transform:translateY(0);opacity:0}20%{opacity:1}100%{transform:translateY(-18px);opacity:0}}
.co-particule{animation:co-monte 1.3s linear infinite}
.co-particule.co-d1{animation-delay:.45s}.co-particule.co-d2{animation-delay:.9s}
@keyframes co-vap{0%{transform:translateY(0) scale(.6);opacity:0}30%{opacity:.75}100%{transform:translateY(-10px) scale(1.25);opacity:0}}
.co-vapeur{animation:co-vap 2.2s ease-out infinite}
.co-v1{animation-delay:.7s}.co-v2{animation-delay:1.4s}
@keyframes co-clignote{0%,100%{opacity:1}50%{opacity:.3}}
.co-led-actif{animation:co-clignote 1.3s ease-in-out infinite}.co-l1{animation-delay:.4s}.co-l2{animation-delay:.8s}
.co-curseur{animation:co-clignote .9s steps(2,start) infinite}
.co-gyro{animation:co-clignote .8s ease-in-out infinite}
@keyframes co-pulse{0%{transform:scale(.8);opacity:.6}100%{transform:scale(1.6);opacity:0}}
.co-pulse{transform-origin:center;animation:co-pulse 1.4s ease-out infinite}
@keyframes co-point{0%,100%{opacity:.25}40%{opacity:1}}
.co-point{animation:co-point 1.2s infinite}.co-p1{animation-delay:.2s}.co-p2{animation-delay:.4s}
@keyframes co-ecrire{0%{transform:scaleX(.05)}55%,100%{transform:scaleX(1)}}
.co-ligne{transform-origin:0 50%;animation:co-ecrire 2.6s steps(8) infinite}
.co-ligne.co-d1{animation-delay:.35s}.co-ligne.co-d2{animation-delay:.7s}.co-ligne.co-d3{animation-delay:1.05s}
@keyframes co-meridien{0%{transform:scaleX(1)}50%{transform:scaleX(.1)}100%{transform:scaleX(1)}}
.co-meridien{transform-origin:center;animation:co-meridien 2s linear infinite}
@keyframes co-progres{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.co-progres{transform-origin:0 50%;animation:co-progres 3s ease-in-out infinite}
@keyframes co-tourne{to{transform:rotate(360deg)}}
.co-engrenage{transform-origin:center;animation:co-tourne 3s linear infinite}
@keyframes co-confetti{0%{transform:translate(0,0) rotate(0);opacity:1}100%{transform:translate(4px,30px) rotate(300deg);opacity:0}}
.co-confetti{animation:co-confetti 1.1s ease-in infinite}
.co-c1{animation-delay:.25s}.co-c2{animation-delay:.5s}.co-c3{animation-delay:.75s}
@keyframes co-nuages{from{transform:translateX(-1.3px)}to{transform:translateX(1.3px)}}
.co-nuages-defile{animation:co-nuages 38s ease-in-out infinite alternate}.co-n1{animation-delay:-13s}.co-n2{animation-delay:-26s}
@keyframes co-soleil{from{opacity:.85}to{opacity:1}}
.co-soleil{animation:co-soleil 6s ease-in-out infinite alternate}
@keyframes co-rayons{from{opacity:.2}to{opacity:.36}}
.co-rayons{opacity:.3;animation:co-rayons 11s ease-in-out infinite alternate}
@keyframes co-poussiere{0%,100%{transform:translate(0,0);opacity:.15}50%{transform:translate(3px,-8px);opacity:.8}}
.co-poussiere{animation:co-poussiere 7s ease-in-out infinite}
@keyframes co-etoile{0%,100%{opacity:.9}50%{opacity:.25}}
.co-etoile{animation:co-etoile 3s ease-in-out infinite}.co-e1{animation-delay:1s}.co-e2{animation-delay:2s}
@keyframes co-anneau{0%,100%{opacity:.95}50%{opacity:.45}}
.co-anneau{animation:co-anneau 1.6s ease-in-out infinite}
@keyframes co-repere{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
.co-repere{animation:co-repere 1.2s ease-in-out infinite}
@keyframes co-feuillage{from{transform:rotate(-1.5deg)}to{transform:rotate(1.5deg)}}
.co-feuillage{transform-origin:50% 100%;animation:co-feuillage 5s ease-in-out infinite alternate}
@keyframes co-fondu{from{opacity:0}to{opacity:1}}
.co-perso{transition:opacity .35s ease}
.co-fixe *{animation:none!important}
.co-gele *{animation-play-state:paused!important}
@media (prefers-reduced-motion:reduce){.co-scene *{animation:none!important}}
.co-scene .co-fondu.co-fondu{animation:co-fondu .45s ease-out both!important}
.co-cible{position:absolute;margin:0;padding:0;border:0;background:transparent;cursor:pointer;border-radius:18px;pointer-events:auto;transform:translate(-50%,-92%);width:max(60px,calc(44px * var(--co-inv,1)));height:max(110px,calc(44px * var(--co-inv,1)));-webkit-tap-highlight-color:transparent;touch-action:none}
.co-cible:focus{outline:none}
.co-cible:focus-visible{outline:calc(3px * var(--co-inv,1)) solid var(--co-accent,#5B8CFF);outline-offset:calc(2px * var(--co-inv,1))}
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
/** Haut de la tête au-dessus des pieds (repère de la scène), selon la pose. */
const hautTete = (mode: ModePose) => (mode === 'fete' ? 74 : mode === 'assis' ? 62 : 70) * K_PERSO;

const maintenantSecondes = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

/** Polygone (écran) du sol d'une zone : cible du survol et du double-tap. */
const polygoneZone = (z: Zone) => {
  const r = RECTS_ZONES[z];
  return pts([[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]]);
};

export function SceneOpenSpace({
  agents, theme, reduit, largeur, choisi, onChoisir, demo, texteAgrandi, maintenant, horloge, charge = true, estompes,
  remplir, refSvg, refCalque, positions, survole, zoneSurvolee, cibles,
}: PropsScene) {
  const pal = useMemo(() => palette(theme.sombre), [theme.sombre]);
  const temps = horloge ?? maintenantSecondes;
  const etat = useRef(creerScene());
  const [, rafraichir] = useReducer((n: number) => n + 1, 0);
  const refsPersos = useRef(new Map<string, SVGGElement>());
  const refsCibles = useRef(new Map<string, HTMLButtonElement>());
  const racine = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const signature = signatureAgents(agents);
  const parCle = useMemo(() => new Map(agents.map(a => [a.cle, a])), [agents]);

  // Réconciliation à chaque changement de la liste (ou du réglage d'animation), pendant le rendu :
  // idempotente, gardée par la signature.
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
  const bouge = [...etat.current.occupants.values()].some(o => o.phase === 'attente' || o.phase === 'marche' || o.phase === 'depart' || o.phase === 'fete');
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
        if (p.mode !== 'marche') continue;
        const q = iso(p.x, p.y);
        const el = refsPersos.current.get(p.cle);
        if (el) {
          el.setAttribute('transform', transformPerso(q.x, q.y, p.miroir));
          el.setAttribute('opacity', String(r1(p.opacite)));
        }
        const bouton = refsCibles.current.get(p.cle);
        if (bouton) {
          bouton.style.left = `${r1(q.x)}px`;
          bouton.style.top = `${r1(q.y)}px`;
        }
        positions?.current.set(p.cle, { x: q.x, y: q.y, haut: q.y - hautTete('marche') });
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

  // Changements de zone en attente (séjour minimal, place libérée) : réexamen régulier, même sans nouvel
  // événement ; la boucle d'animation s'en charge quand quelqu'un marche. Rien hors de l'écran.
  useEffect(() => {
    if (!visible) return undefined;
    const minuterie = setInterval(() => {
      const enMouvement = [...etat.current.occupants.values()].some(o => o.phase !== 'assis' && o.phase !== 'parti');
      if (enMouvement && !reduit) return;
      if (prochaineEcheance(etat.current) !== undefined && avancer(etat.current, temps(), !reduit)) rafraichir();
    }, 1_000);
    return () => clearInterval(minuterie);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reduit]);

  const t = temps();
  const liste = poses(etat.current, t);
  const occupants = etat.current.occupants;
  const comptes = comptesZones(etat.current);
  const grand = Boolean(texteAgrandi);
  const fond = useMemo(() => <Fond pal={pal} maintenant={maintenant} />, [pal, Math.floor(maintenant / 60_000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const guichetActif = comptes.presents.guichet > 0;
  const machinesActives = comptes.presents.machines > 0;
  const meubles = useMemo(() => meublesTries(pal, guichetActif, machinesActives), [pal, guichetActif, machinesActives]);
  const choisir = useCallback((cle: string) => (e: React.MouseEvent) => { e.stopPropagation(); onChoisir(cle); }, [onChoisir]);

  // Positions des personnages (repère de la scène) : suivi caméra, cartes de survol, mini-carte.
  const positionsRendu = new Map<string, { x: number; y: number; haut: number }>();
  for (const p of liste) {
    const q = iso(p.x, p.y);
    positionsRendu.set(p.cle, { x: q.x, y: q.y, haut: q.y - hautTete(p.mode) });
  }
  useLayoutEffect(() => {
    if (!positions) return;
    positions.current = positionsRendu;
  });

  const elements: Element[] = [...meubles];
  // Bureaux à écran (atelier, consoles des machines) : l'écran montre l'activité de qui y est installé.
  const installeA = new Map<number, string>();
  for (const p of liste) if (p.mode !== 'marche') installeA.set(p.place, p.cle);
  for (const place of PLACES) {
    if (place.genre !== 'bureau') continue;
    const cle = installeA.get(place.index);
    const agent = cle ? parCle.get(cle) : undefined;
    const b = bureauDe(place);
    elements.push({
      cle: `poste-${place.index}`,
      profondeur: b.x + b.w / 2 + b.y + b.d / 2,
      rendu: (
        <g key={`poste-${place.index}`} onClick={cle && !cibles ? choisir(cle) : undefined} className={cle && !cibles ? 'co-clic' : undefined}>
          <PosteDessin place={place} pal={pal} activite={agent ? activiteAgent(agent) : 'vide'} fige={Boolean(agent?.fige)} occupe={Boolean(agent)} />
        </g>
      ),
    });
  }
  const DEBOUT: ReadonlySet<ModePose> = new Set(['debout', 'marche', 'fete']);
  for (const p of liste) {
    const agent = parCle.get(p.cle);
    const occ = occupants.get(p.cle);
    if (!agent || !occ) continue;
    const place = PLACES[p.place];
    const ap0 = apparence(agent);
    const ap = agent.fige ? griser(ap0) : ap0;
    const activite = activiteAgent(agent);
    const q = iso(p.x, p.y);
    const carton = occ.partir && (p.mode === 'marche' || p.mode === 'range') && occ.phase === 'depart';
    const jambes: Jambes = DEBOUT.has(p.mode) || (p.mode === 'range' && place.genre === 'debout') ? 'debout' : place.genre === 'bureau' || place.genre === 'chaise' || place.genre === 'tabouret' ? 'cachees' : 'assises';
    const estompe = estompes?.has(p.cle);
    const fondu = occ.teleporte !== undefined && t - occ.teleporte < 0.6;
    const enAvant = p.cle === choisi || p.cle === survole;
    elements.push({
      cle: `perso-${p.cle}`,
      profondeur: p.x + p.y + 0.001,
      rendu: (
        <g
          key={`perso-${p.cle}-${p.mode === 'marche' ? 'm' : p.place}`}
          ref={el => { if (el) refsPersos.current.set(p.cle, el); else refsPersos.current.delete(p.cle); }}
          transform={transformPerso(q.x, q.y, p.miroir)}
          opacity={estompe ? 0.22 : agent.fige ? 0.7 : r1(p.opacite)}
          onClick={cibles ? undefined : choisir(p.cle)}
          className={`co-clic co-perso${fondu ? ' co-fondu' : ''}`}
          style={{ ['--co-d' as string]: `-${(hacher(p.cle) % 90) / 10}s` }}
          data-cle={p.cle}
          data-zone={p.zone}
          data-mode={p.mode}
        >
          {enAvant ? <ellipse cx={0} cy={0} rx={18} ry={7.5} fill={theme.accent} opacity={p.cle === choisi ? 0.25 : 0.16} /> : null}
          {enAvant ? <ellipse cx={0} cy={0} rx={18} ry={7.5} fill="none" stroke={theme.accent} strokeWidth={p.cle === choisi ? 2.8 : 1.8} className={p.cle === choisi ? 'co-anneau' : undefined} /> : null}
          <Personnage ap={ap} vue={p.vue} mode={agent.fige && p.mode !== 'marche' ? (jambes === 'debout' ? 'debout' : 'assis') : p.mode} activite={agent.fige ? 'pause' : activite} carton={carton} jambes={jambes} />
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

  // Pastilles d'état (petites) et repère de l'agent choisi, toujours au-dessus ; les textes viennent au survol.
  const badges: React.ReactNode[] = [];
  let repere: React.ReactNode = null;
  for (const p of liste) {
    const agent = parCle.get(p.cle);
    if (!agent) continue;
    const q = iso(p.x, p.y);
    const haut = q.y - hautTete(p.mode);
    if (p.cle === choisi) {
      repere = (
        <g transform={`translate(${r1(q.x)} ${r1(haut - 22)})`} pointerEvents="none" data-testid="scene-repere">
          <g className="co-repere"><path d="M-9,-8 L9,-8 L0,4 Z" fill={theme.accent} stroke="#FFFFFF" strokeWidth={1.5} /></g>
        </g>
      );
    }
    if (p.mode === 'marche' || estompes?.has(p.cle)) continue;
    badges.push(<Badge key={p.cle} x={q.x + (p.miroir ? -1 : 1) * 17 * K_PERSO} y={haut + 10} activite={p.mode === 'fete' ? 'fini' : activiteAgent(agent)} pal={pal} fige={agent.fige} />);
  }
  const attente = enAttente(etat.current);
  const porte = iso((PORTE.x0 + PORTE.x1) / 2, 0, 2.6);
  const hauteur = Math.round((largeur * HAUTEUR_SCENE) / LARGEUR_SCENE);
  const rz = zoneSurvolee ? RECTS_ZONES[zoneSurvolee] : undefined;

  return (
    <div
      ref={racine}
      style={remplir ? { position: 'absolute', inset: 0 } : { width: largeur, height: hauteur, position: 'relative' }}
      data-testid={reduit ? 'scene-fixe' : 'scene-animee'}
    >
      <svg
        ref={refSvg}
        className={`co-scene${reduit ? ' co-fixe' : ''}${visible ? '' : ' co-gele'}`}
        width={remplir ? '100%' : largeur}
        height={remplir ? '100%' : hauteur}
        viewBox={`0 0 ${LARGEUR_SCENE} ${HAUTEUR_SCENE}`}
        style={{ display: 'block' }}
        focusable="false"
        aria-hidden="true"
      >
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        {fond}
        {rz && zoneSurvolee ? (
          <g transform={sol()} pointerEvents="none" data-testid="scene-zone-survolee">
            <rect x={rz.x0 + 0.1} y={rz.y0 + 0.1} width={rz.x1 - rz.x0 - 0.2} height={rz.y1 - rz.y0 - 0.2} rx={0.25} fill={ZONES[zoneSurvolee].teinte} opacity={0.16} stroke={ZONES[zoneSurvolee].teinte} strokeWidth={0.09} />
          </g>
        ) : null}
        <g>{elements.map(e => e.rendu)}</g>
        <PremierPlan pal={pal} />
        <g>{ORDRE_ZONES.map(z => <Enseigne key={z} zone={z} nombre={comptes.presents[z]} sansPlace={comptes.sansPlace[z]} pal={pal} grand={grand} />)}</g>
        {cibles ? (
          <g data-testid="scene-zones-cibles">
            {ORDRE_ZONES.map(z => <polygon key={z} points={polygoneZone(z)} fill="transparent" pointerEvents="all" data-co-zone={z} />)}
          </g>
        ) : null}
        {attente ? (
          <g transform={`translate(${r1(porte.x)} ${r1(porte.y - 30)})`} data-testid="scene-file-attente" pointerEvents="none">
            <rect x={-44} y={-14} width={88} height={22} rx={11} fill={pal.badge} stroke={TEINTES_ACTIVITE.pense} strokeWidth={1.5} />
            <text y={2} textAnchor="middle" fontSize={13} fontWeight={700} fill={pal.badgeTexte}>{`${attente} à l’entrée`}</text>
          </g>
        ) : null}
        <g>{badges}</g>
        {repere}
        {demo ? (
          <g transform="translate(26 14)" data-testid="scene-demo" pointerEvents="none">
            <rect width={124} height={28} rx={14} fill="#E0803A" opacity={0.92} />
            <text x={62} y={19} textAnchor="middle" fontSize={14} fontWeight={800} fill="#FFFFFF" letterSpacing={1}>DÉMO</text>
          </g>
        ) : null}
      </svg>
      {cibles ? (
        <div
          ref={refCalque}
          className="co-calque"
          style={{ position: 'absolute', left: 0, top: 0, width: LARGEUR_SCENE, height: HAUTEUR_SCENE, transformOrigin: '0 0', pointerEvents: 'none', ['--co-accent' as string]: theme.accent }}
          data-testid="scene-cibles"
        >
          {liste.map(p => {
            const agent = parCle.get(p.cle);
            if (!agent) return null;
            const q = iso(p.x, p.y);
            const decrit = cibles.decrit?.cle === p.cle ? cibles.decrit.id : undefined;
            return (
              <button
                key={p.cle}
                type="button"
                ref={el => { if (el) refsCibles.current.set(p.cle, el); else refsCibles.current.delete(p.cle); }}
                className="co-cible"
                style={{ left: r1(q.x), top: r1(q.y) }}
                data-co-agent={p.cle}
                data-testid={`scene-cible-${agent.session.slice(0, 12)}`}
                aria-label={cibles.libelle(agent)}
                aria-describedby={decrit}
                onFocus={() => cibles.onFocus(p.cle)}
                onBlur={() => cibles.onFocus(undefined)}
                onClick={e => { if (e.detail === 0) cibles.onActiver(p.cle); }}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
