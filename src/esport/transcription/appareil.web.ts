/**
 * Capacités de l'appareil pour la transcription dans le navigateur : un iPhone ou un appareil peu
 * puissant (moins de 4 Go de mémoire ou de 4 cœurs, quand le navigateur le dit) transcrit lentement ;
 * l'interface propose alors de transcrire plus tard depuis un PC (case décochée par défaut).
 */

import type { CapaciteAppareil } from './appareil';

export type { CapaciteAppareil } from './appareil';

export function capaciteAppareil(): CapaciteAppareil {
  const n = (globalThis as { navigator?: { userAgent?: string; platform?: string; maxTouchPoints?: number; deviceMemory?: number; hardwareConcurrency?: number } }).navigator ?? {};
  const ua = n.userAgent ?? '';
  const iphone = /iPhone|iPod|iPad/.test(ua) || (n.platform === 'MacIntel' && (n.maxTouchPoints ?? 0) > 1) || /Android.*Mobile/.test(ua);
  const faible = (typeof n.deviceMemory === 'number' && n.deviceMemory < 4) || (typeof n.hardwareConcurrency === 'number' && n.hardwareConcurrency < 4);
  const audio = typeof (globalThis as { AudioContext?: unknown }).AudioContext === 'function' || typeof (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext === 'function';
  return { transcription: audio, iphone, faible };
}
