/**
 * Choix d'un rôle Discord parmi ceux du serveur : sélecteur repliable commun (src/ui/selecteurs), classé comme dans
 * Discord (hiérarchie). Les noms viennent de Discord et sont affichés tels quels (Unicode fantaisie compris) ; un rôle
 * au niveau ou au-dessus du rôle du bot est signalé (Discord refuserait de le donner).
 */

import React from 'react';
import type { ThemeHub } from '../../../hub/themes';
import { SelecteurRepliable, optionsRoles } from '../../../ui/selecteurs/SelecteurRepliable';
import { trRt } from '../../i18n/rolesTemp';

export function SelecteurRole({ theme, libelle, valeur, roles, positionBot, onChoisir, testID }: { theme: ThemeHub; libelle: string; valeur: string | null; roles: ReadonlyArray<{ id: string; nom: string; couleur?: string | null; position: number }>; positionBot?: number; onChoisir(id: string): void; testID: string }) {
  const options = optionsRoles(roles).map(o => ({ ...o, detail: positionBot !== undefined && (roles.find(r => r.id === o.id)?.position ?? 0) >= positionBot ? trRt('role_au_dessus') : undefined }));
  return <SelecteurRepliable theme={theme} nature="role" libelle={libelle} valeur={valeur ?? undefined} options={options} onChoisir={onChoisir} vide={trRt('role_aucun')} testID={testID} />;
}
