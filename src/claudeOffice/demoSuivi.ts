/**
 * Claude Office v4 : compléments FICTIFS de la démo pour l'onglet « Suivi »
 * (alertes, récap, équipe, notes). Rien de réel n'est lu ni écrit.
 *
 * Trois sessions de démo en plus de celles du bureau (logiqueScene.ts) :
 *  - « facturation » : ouverte depuis 2 h 30 et attend une autorisation depuis
 *    7 min → alertes « attend ta réponse » et « session longue » ;
 *  - « api-meteo » (2e session) : trois commandes de suite en échec → « erreurs » ;
 *  - « carnet » (2e session) : une tâche de 12 min qui vient de finir → « a fini ».
 */

import type { Equipe, Notes } from './equipe';
import type { EntreeHistorique } from './logiqueHistorique';

export const SESSION_DEMO_ATTENTE = 'demo-facturation';
export const SESSION_DEMO_ERREURS = 'demo-api-meteo-2';
export const SESSION_DEMO_FINI = 'demo-carnet-2';

export function entreesDemoSuivi(debut: number): EntreeHistorique[] {
  const res: EntreeHistorique[] = [];
  const ev = (session: string, projet: string, minutes: number, type: string, extra: Partial<EntreeHistorique> = {}) =>
    res.push({
      v: 1, id: `demo-suivi-${session}-${res.length}`, ts: new Date(debut + minutes * 60_000).toISOString(), type,
      appareil: 'PC de démo', appareilId: 'demo00000000', session, projet, dossier: `/demo/${projet}`, ...extra,
    });
  // Session longue qui attend ta réponse depuis 7 min.
  ev(SESSION_DEMO_ATTENTE, 'facturation', -150, 'debut-session');
  for (let m = -148; m < -10; m += 9) {
    if ((m + 148) % 27 === 0) ev(SESSION_DEMO_ATTENTE, 'facturation', m, 'demande', { texte: `Ajoute l’export des factures, étape ${(m + 148) / 27 + 1}` });
    else ev(SESSION_DEMO_ATTENTE, 'facturation', m, 'outil', { outil: m % 2 ? 'Edit' : 'Read', resume: 'src/factures.ts', duree: 800 });
  }
  ev(SESSION_DEMO_ATTENTE, 'facturation', -7, 'attente', { outil: 'Bash', resume: 'Autoriser Bash (npm publish) ?', motif: 'permission' });
  // Trois erreurs d'outil d'affilée.
  ev(SESSION_DEMO_ERREURS, 'api-meteo', -9, 'debut-session');
  ev(SESSION_DEMO_ERREURS, 'api-meteo', -8, 'demande', { texte: 'Fais passer les tests de l’API (jeton sk-ant-demo1234567890abcdef)' });
  ev(SESSION_DEMO_ERREURS, 'api-meteo', -6, 'outil', { outil: 'Bash', resume: 'npm test', echec: true, duree: 7_000 });
  ev(SESSION_DEMO_ERREURS, 'api-meteo', -4, 'outil', { outil: 'Bash', resume: 'npm test -- --runInBand', echec: true, duree: 8_000 });
  ev(SESSION_DEMO_ERREURS, 'api-meteo', -2, 'outil', { outil: 'Bash', resume: 'npm test -- meteo', echec: true, duree: 6_500 });
  // Une tâche de 12 min qui vient de finir.
  ev(SESSION_DEMO_FINI, 'carnet', -15, 'debut-session');
  ev(SESSION_DEMO_FINI, 'carnet', -14, 'demande', { texte: 'Range les notes par thème et ajoute un sommaire' });
  ev(SESSION_DEMO_FINI, 'carnet', -10, 'outil', { outil: 'Glob', resume: 'notes/**/*.md', duree: 200 });
  ev(SESSION_DEMO_FINI, 'carnet', -6, 'outil', { outil: 'Write', resume: 'notes/sommaire.md', duree: 600 });
  ev(SESSION_DEMO_FINI, 'carnet', -2, 'fin-reponse');
  return res;
}

export function equipeDemo(): Equipe {
  return {
    projets: {
      boutique: { surnom: 'Bob', couleur: '#E94F9B', accessoire: 'couronne', favori: true },
      facturation: { surnom: 'Félix', accessoire: 'casquette', favori: true },
      jardin: { couleur: '#1F9D55', accessoire: 'fleur' },
    },
    sessions: {},
  };
}

export function notesDemo(maintenant: number): Notes {
  return {
    [SESSION_DEMO_ERREURS]: { texte: 'À vérifier : les tests échouent sur la CI aussi ?', maj: maintenant - 60_000, projet: 'api-meteo' },
    'demo-boutique': { texte: 'Bug du panier corrigé, reste la page de paiement.', maj: maintenant - 3_600_000, projet: 'boutique' },
  };
}
