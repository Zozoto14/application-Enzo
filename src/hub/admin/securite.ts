/**
 * Vue d'ensemble de la sécurité, en données pures. Rien n'y est secret :
 * on sait si un TOTP est enrôlé et combien de codes de récupération restent
 * (sans rien déchiffrer), et la robustesse du mot de passe telle qu'évaluée
 * lors de la dernière vérification d'identité.
 */

import type { EtatCoffre } from '../types';
import type { AlerteAdmin } from './comptes';
import type { ReglagesAdmin, Robustesse } from './donnees';

export type EtatPoint = 'ok' | 'alerte' | 'critique' | 'inconnu';

export interface PointSecurite {
  id: 'totp' | 'recuperation' | 'motdepasse' | 'verrou' | 'confiance';
  titre: string;
  etat: EtatPoint;
  detail: string;
}

export function bilanSecurite(
  coffre: EtatCoffre | undefined,
  robustesse: { niveau: Robustesse; le: string } | undefined,
  reglages: ReglagesAdmin,
): PointSecurite[] {
  const points: PointSecurite[] = [];
  points.push(
    coffre
      ? coffre.totpActif
        ? { id: 'totp', titre: 'Code d’authentification (TOTP)', etat: 'ok', detail: 'Actif : il est demandé à chaque déverrouillage.' }
        : { id: 'totp', titre: 'Code d’authentification (TOTP)', etat: 'critique', detail: 'Absent : seul le mot de passe protège le coffre.' }
      : { id: 'totp', titre: 'Code d’authentification (TOTP)', etat: 'inconnu', detail: 'État du coffre indisponible sur cette plateforme.' },
  );
  if (coffre) {
    const n = coffre.codesRecuperation;
    points.push({
      id: 'recuperation',
      titre: 'Codes de récupération',
      etat: n === 0 ? 'critique' : n <= 3 ? 'alerte' : 'ok',
      detail:
        n === 0
          ? 'Aucun code restant : un mot de passe oublié serait sans recours. Régénérez-les dans les Paramètres du portefeuille.'
          : `${n} code${n > 1 ? 's' : ''} restant${n > 1 ? 's' : ''}${n <= 3 ? ' : pensez à les renouveler (Paramètres du portefeuille).' : '.'}`,
    });
  }
  points.push(
    robustesse
      ? {
          id: 'motdepasse',
          titre: 'Mot de passe administrateur',
          etat: robustesse.niveau === 'forte' ? 'ok' : robustesse.niveau === 'moyenne' ? 'alerte' : 'critique',
          detail: `Robustesse ${robustesse.niveau}, évaluée lors de la dernière vérification d’identité (le mot de passe n’est jamais conservé).`,
        }
      : {
          id: 'motdepasse',
          titre: 'Mot de passe administrateur',
          etat: 'inconnu',
          detail: 'Pas encore évalué : il le sera à la prochaine vérification d’identité.',
        },
  );
  points.push(
    reglages.verrouMinutes > 0
      ? { id: 'verrou', titre: 'Verrouillage du panneau', etat: 'ok', detail: `Après ${reglages.verrouMinutes} min d’inactivité.` }
      : { id: 'verrou', titre: 'Verrouillage du panneau', etat: 'alerte', detail: 'Désactivé : le panneau reste ouvert tant que l’app l’est.' },
  );
  points.push({
    id: 'confiance',
    titre: 'Actions sensibles',
    etat: 'ok',
    detail: `Régénération, suppression et désactivation du verrouillage redemandent mot de passe + code (vérification valable ${reglages.confianceMinutes} min).`,
  });
  return points;
}

export function alertesDuBilan(points: readonly PointSecurite[]): AlerteAdmin[] {
  return points
    .filter(p => p.etat === 'critique' || p.etat === 'alerte')
    .map(p => ({ genre: 'securite' as const, gravite: p.etat === 'critique' ? ('critique' as const) : ('alerte' as const), message: `${p.titre} : ${p.detail}` }));
}
