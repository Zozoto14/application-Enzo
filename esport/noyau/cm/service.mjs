/**
 * Section CM (community manager) : assemblage des services (voir docs/esport/cm.md).
 *
 *  - commun.mjs : portées (club / team) et droits ; reseaux.mjs, posts.mjs : règles pures ;
 *  - tableaux.mjs : tableaux façon Trello, cartes de contenu, circuit de validation, calendrier ;
 *  - equipe.mjs : partie CM d'une team (dépôts, matchs publiables, pré-remplissage) ;
 *  - clips.mjs : clips proposés par les joueurs ; droits.mjs : rôles CM, affectations, réglages ;
 *  - trello.mjs, importTrello.mjs : import d'un export JSON de Trello ; suggestions.mjs, bus.mjs : abonnés ;
 *  - rgpd.mjs : export et effacement.
 *
 * Fichiers (pièces jointes, clips) : envoi par morceaux du module médias (usage « cm », portée club ou team),
 * gardés dans `cm_fichiers`, lus par lien signé (`/cm/fichiers/:id`, 2 h) ; le lien ne vaut que tant que le
 * compte a encore accès à la portée (ou qu'il est l'auteur du clip).
 */

import { echec } from '../outils.mjs';
import { verifierLien } from '../fichiers.mjs';
import { reponseFichierStocke } from '../medias/lecture.mjs';
import { contexteCm, exiger, exigerUuid, teamDePortee } from './commun.mjs';
import { servicesTableauxCm } from './tableaux.mjs';
import { servicesDroitsCm } from './droits.mjs';
import { servicesEquipeCm } from './equipe.mjs';
import { servicesClipsCm } from './clips.mjs';
import { servicesImportTrello } from './importTrello.mjs';

export function servicesCm({ base, maintenant = () => Date.now(), medias, cleSession, stockage }) {
  // Envois par morceaux de la section : il faut pouvoir écrire quelque chose dans la portée.
  medias?.brancherContexte('cm', async (acteur, portee) => {
    const ctx = await contexteCm(base, acteur, portee);
    exiger(ctx, 'cm.editer', 'cm.deposer', 'cm.clips.proposer');
    return { acteur, team: { id: teamDePortee(ctx.portee) }, portee: ctx.portee };
  });
  const tableaux = servicesTableauxCm({ base, maintenant, medias, cleSession, stockage });
  const droits = servicesDroitsCm({ base, maintenant });
  const equipe = servicesEquipeCm({ base, maintenant, medias });
  const clips = servicesClipsCm({ base, maintenant, medias, cleSession, tableaux });
  const trello = servicesImportTrello({ base, maintenant, tableaux });

  /** Le compte peut-il encore lire ce fichier (cm.voir sur sa portée, ou auteur d'un clip qui l'utilise) ? */
  async function peutLire(compte, f) {
    if (compte === 'principal') return true;
    try {
      const ctx = await contexteCm(base, { compte, superAdmin: false }, f.portee);
      if (ctx.permissions.has('cm.voir')) return true;
    } catch {
      // Pas d'accès à la portée : peut-être l'auteur du clip.
    }
    return Boolean(await base.premier('SELECT id FROM cm_clips WHERE fichier_id = ? AND propose_par = ? AND supprime_le IS NULL', [f.id, compte]));
  }

  const fichiers = {
    async servir(id, params, requete) {
      exigerUuid(id, 'fichier');
      const { compte, telecharger } = await verifierLien(cleSession, id, params, maintenant(), { genre: 'cm' });
      const f = await base.premier('SELECT * FROM cm_fichiers WHERE id = ?', [id]);
      if (!f || f.supprime_le) throw echec(404, 'fichier-introuvable', 'Fichier introuvable.');
      if (!(await peutLire(compte, f))) throw echec(403, 'lien-invalide', 'Lien de fichier invalide.');
      if (!stockage) throw echec(503, 'stockage-absent', 'Le stockage des fichiers n’est pas branché.');
      const reponse = await reponseFichierStocke({ stockage, f, requete, telecharger });
      if (!reponse) throw echec(404, 'fichier-introuvable', 'Fichier introuvable.');
      return reponse;
    },
  };

  return { tableaux, droits, equipe, clips, trello, fichiers };
}
