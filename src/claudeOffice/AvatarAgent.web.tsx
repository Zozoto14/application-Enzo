/**
 * Claude Office v4 : petit portrait d'agent en SVG (web, site, PC) pour
 * l'écran « Équipe » — visage et coiffure tirés de la session, haut à la
 * couleur choisie, accessoire du catalogue (`CATALOGUE_ACCESSOIRES`). Quelques
 * formes, aucune image. Décoratif : le nom porte l'information.
 */

import React from 'react';
import type { PropsAvatar } from './avatarTypes';

const TOUCHE = '#F2C14E';

function Accessoire({ id }: { id: PropsAvatar['accessoire'] }) {
  switch (id) {
    case 'lunettes':
      return (
        <g fill="none" stroke="#1F2430" strokeWidth={1.6}>
          <circle cx={20} cy={21} r={3.4} />
          <circle cx={28} cy={21} r={3.4} />
          <path d="M23.4 21h1.2" />
        </g>
      );
    case 'casque':
      return (
        <g>
          <path d="M14 21a10 10 0 0 1 20 0" fill="none" stroke="#2F3A52" strokeWidth={2.4} />
          <rect x={11.5} y={19} width={4.5} height={7} rx={2} fill="#2F3A52" />
          <rect x={32} y={19} width={4.5} height={7} rx={2} fill="#2F3A52" />
        </g>
      );
    case 'bonnet':
      return (
        <g>
          <path d="M14.5 17a9.5 8 0 0 1 19 0z" fill="#D9566B" />
          <rect x={14} y={15.5} width={20} height={3.4} rx={1.6} fill="#F6F1E7" />
          <circle cx={24} cy={8.4} r={2.4} fill="#F6F1E7" />
        </g>
      );
    case 'noeud':
      return <path d="M29 11l5-3v7zM29 11l-4-3v7z" fill="#E94F9B" />;
    case 'echarpe':
      return (
        <g fill="#2FA7B8">
          <rect x={16} y={30} width={16} height={4} rx={2} />
          <rect x={27} y={31} width={3.6} height={9} rx={1.5} />
        </g>
      );
    case 'couronne':
      return <path d="M16 15l2-7 4 4 2-6 2 6 4-4 2 7z" fill={TOUCHE} stroke="#B8860B" strokeWidth={0.8} />;
    case 'casquette':
      return (
        <g fill="#3F6FD8">
          <path d="M15 17a9 8 0 0 1 18 0z" />
          <path d="M30 16.2h8a1.5 1.5 0 0 1 0 2.4h-8z" />
        </g>
      );
    case 'fleur':
      return (
        <g>
          {[0, 72, 144, 216, 288].map(a => (
            <circle key={a} cx={32 + 2.4 * Math.cos((a * Math.PI) / 180)} cy={12 + 2.4 * Math.sin((a * Math.PI) / 180)} r={1.9} fill="#F6F1E7" />
          ))}
          <circle cx={32} cy={12} r={1.5} fill={TOUCHE} />
        </g>
      );
    default:
      return null;
  }
}

export function AvatarAgent({ apparence, accessoire, taille = 48, favori, testID }: PropsAvatar) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 48 48" aria-hidden="true" data-testid={testID} style={{ flexShrink: 0, display: 'block' }}>
      <circle cx={24} cy={24} r={23} fill={apparence.haut} opacity={0.14} />
      <path d="M10 46c0-9 6-14 14-14s14 5 14 14z" fill={apparence.haut} />
      <circle cx={24} cy={21} r={8.5} fill={apparence.peau} />
      <path d="M15.5 20a8.5 8.5 0 0 1 17 0c-3-3-11-4-17 0z" fill={apparence.cheveux} />
      <circle cx={21} cy={22} r={0.9} fill="#1F2430" />
      <circle cx={27} cy={22} r={0.9} fill="#1F2430" />
      <path d="M21.5 25.4q2.5 1.8 5 0" fill="none" stroke="#1F2430" strokeWidth={0.9} strokeLinecap="round" />
      <Accessoire id={accessoire} />
      {favori ? <path d="M40 3l1.8 3.7 4 .6-2.9 2.8.7 4L40 12.2 36.4 14l.7-4-2.9-2.8 4-.6z" fill={TOUCHE} stroke="#B8860B" strokeWidth={0.6} /> : null}
    </svg>
  );
}
