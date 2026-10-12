import type { AccessoireAgent } from './equipe';
import type { Apparence } from './logiqueScene';

/** Propriétés communes aux deux versions du portrait (`AvatarAgent.web.tsx` en SVG, `AvatarAgent.tsx` en vues). */
export interface PropsAvatar {
  apparence: Pick<Apparence, 'peau' | 'cheveux' | 'haut'>;
  accessoire?: AccessoireAgent;
  taille?: number;
  favori?: boolean;
  testID?: string;
}
