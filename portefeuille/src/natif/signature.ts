/**
 * Date d'expiration de l'application iPhone installée par AltStore.
 *
 * Avec un identifiant Apple gratuit, AltStore signe l'application pour sept
 * jours. Passé ce délai elle ne s'ouvre plus — **sans rien perdre** : dès
 * qu'AltStore la renouvelle, tout revient. Mais on veut le savoir avant.
 *
 * La date est écrite par Apple dans le profil embarqué au moment de la
 * signature (`embedded.mobileprovision`, à la racine de l'application). Ce
 * fichier est une signature CMS qui contient une liste de propriétés XML en
 * clair : il suffit de le lire et d'y chercher `ExpirationDate`. Aucun
 * module natif à ajouter, react-native-fs est déjà dans le binaire.
 */

import { Platform } from 'react-native';
import { chargerModule } from './modules';
import { depuisBase64 } from '../sync/relais/chiffrement';

/** Extrait `ExpirationDate` du contenu d'un profil de provisionnement. */
export function extraireExpiration(texte: string): string | undefined {
  const trouve = /<key>ExpirationDate<\/key>\s*<date>([^<]+)<\/date>/.exec(texte);
  if (!trouve) {
    return undefined;
  }
  const date = new Date(trouve[1].trim());
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

interface ModuleFs {
  MainBundlePath?: string;
  readFile(chemin: string, encodage: string): Promise<string>;
}

/** Expiration de la signature, ou `undefined` (pas un iPhone, pas AltStore). */
export async function expirationSignature(): Promise<string | undefined> {
  if (Platform.OS !== 'ios') {
    return undefined;
  }
  const fs = chargerModule<ModuleFs>('react-native-fs').module;
  if (!fs?.MainBundlePath) {
    return undefined;
  }
  try {
    const base64 = await fs.readFile(`${fs.MainBundlePath}/embedded.mobileprovision`, 'base64');
    // Le XML est en ASCII : un décodage octet par octet suffit.
    const octets = depuisBase64(base64);
    let texte = '';
    for (let i = 0; i < octets.length; i += 4096) {
      texte += String.fromCharCode(...octets.subarray(i, i + 4096));
    }
    return extraireExpiration(texte);
  } catch {
    return undefined;
  }
}

export interface RappelExpiration {
  identifiant: string;
  quand: Date;
  titre: string;
  corps: string;
}

/**
 * Rappels à programmer avant l'expiration : deux jours avant, la veille, et
 * trois heures avant. Programmés d'avance, ils partent même si l'application
 * n'est pas ouverte d'ici là.
 */
export function rappelsExpiration(expireLe: string, maintenant: Date = new Date()): RappelExpiration[] {
  const fin = Date.parse(expireLe);
  if (Number.isNaN(fin)) {
    return [];
  }
  const conseil = 'Branchez-vous sur le Wi-Fi de la maison avec le PC allumé : AltStore la renouvelle tout seul. Vos données ne risquent rien.';
  return [
    { identifiant: 'expiration-j2', ecart: 2 * 86_400_000, titre: '📱 AppliBourse expire dans 2 jours' },
    { identifiant: 'expiration-j1', ecart: 86_400_000, titre: '📱 AppliBourse expire demain' },
    { identifiant: 'expiration-h3', ecart: 3 * 3_600_000, titre: '⚠️ AppliBourse expire dans 3 heures' },
  ]
    .map(rappel => ({ identifiant: rappel.identifiant, quand: new Date(fin - rappel.ecart), titre: rappel.titre, corps: conseil }))
    .filter(rappel => rappel.quand.getTime() > maintenant.getTime());
}

/** Jours restants, arrondis vers le bas ; négatif une fois expirée. */
export function joursRestants(expireLe: string, maintenant: Date = new Date()): number {
  return Math.floor((Date.parse(expireLe) - maintenant.getTime()) / 86_400_000);
}

/** Programme les rappels avec Notifee (remplace ceux d'une signature précédente). */
export async function programmerRappelsExpiration(expireLe: string): Promise<void> {
  const brut = chargerModule<Record<string, unknown>>('@notifee/react-native').module;
  const notifee = ((brut as { default?: unknown })?.default ?? brut) as
    | {
        createTriggerNotification?(notification: unknown, declencheur: unknown): Promise<string>;
        requestPermission?(): Promise<unknown>;
      }
    | undefined;
  if (!notifee?.createTriggerNotification) {
    return;
  }
  await notifee.requestPermission?.();
  for (const rappel of rappelsExpiration(expireLe)) {
    // TriggerType.TIMESTAMP vaut 0 ; l'identifiant fixe remplace l'ancien rappel.
    await notifee.createTriggerNotification(
      { id: rappel.identifiant, title: rappel.titre, body: rappel.corps, data: { destination: 'reglages' } },
      { type: 0, timestamp: rappel.quand.getTime() },
    );
  }
}
