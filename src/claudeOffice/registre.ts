/**
 * Entrée de Claude Office dans le registre du hub (`src/hub/registre.tsx`).
 *
 * Réservée au Fondateur : elle touche aux réglages de Claude Code du PC. Elle
 * n'est jamais proposée dans les autorisations d'un ami (`adminSeulement`),
 * et `disponible` la limite au rang Fondateur (le compte principal, ou un
 * compte promu Fondateur) : ni administrateur, ni gestionnaire, ni ami ne
 * voient la tuile. Sa tuile est sur la page « Administration » du hub
 * (`page: 'administration'`). L'identifiant `claude-office` ne doit plus changer.
 */

import { rangDe } from '../hub/admin/roles';
import type { AppHub } from '../hub/types';
import { ClaudeOffice } from './Racine';

export const ID_CLAUDE_OFFICE = 'claude-office';

export const APP_CLAUDE_OFFICE: AppHub = {
  id: ID_CLAUDE_OFFICE,
  nom: 'Claude Office',
  categorie: 'Admin',
  page: 'administration',
  description: 'Le bureau des agents Claude Code, sur le PC : état, ouverture, hooks.',
  icone: '▣',
  teinte: 'quatre',
  adminSeulement: true,
  // Avec `adminSeulement`, laisse passer un Fondateur promu ; `disponible` écarte les autres rangs.
  gestionnaire: true,
  disponible: contexte => rangDe(contexte.profil) === 'fondateur',
  Racine: ClaudeOffice,
};
