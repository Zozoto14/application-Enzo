/**
 * Section CM (community manager) : assemblage des services (voir docs/esport/cm.md).
 *
 *  - commun.mjs : portées (club / team) et droits ; reseaux.mjs, posts.mjs : règles pures ;
 *  - tableaux.mjs : tableaux façon Trello, cartes de contenu, circuit de validation, calendrier ;
 *  - equipe.mjs : partie CM d'une team (dépôts, matchs publiables, pré-remplissage) ;
 *  - clips.mjs : clips proposés par les joueurs ; droits.mjs : rôles CM, affectations, réglages ;
 *  - trello.mjs, importTrello.mjs : import d'un export JSON de Trello ; suggestions.mjs, bus.mjs : abonnés ;
 *  - visuels/ : charte graphique, modèles personnalisés, visuels générés (docs/esport/visuels.md) ;
 *  - rgpd.mjs : export et effacement.
 *
 *  - drive/ : Drive de la section (dossiers, fichiers, versions, corbeille ; docs/esport/drive.md).
 *  - liens.mjs : liens utiles de DATA › Ressources, liés à des cartes et des dossiers du Drive (migration 0044).
 *  - reunions/ : réunions de l'équipe CM, disponibilités, rendez-vous (docs/esport/cm-reunions.md).
 *
 * Fichiers (pièces jointes, clips) : envoi par morceaux du module médias (usage « cm », portée club ou team),
 * gardés dans `cm_fichiers`, lus par lien signé (`/cm/fichiers/:id`, 2 h) ; le lien ne vaut que tant que le
 * compte a encore accès à la portée (ou qu'il est l'auteur du clip).
 */

import { echec } from '../outils.mjs';
import { verifierLien } from '../fichiers.mjs';
import { reponseFichierStocke } from '../medias/lecture.mjs';
import { PORTEE_CLUB, contexteCm, exiger, exigerUuid, porteesDe, teamDePortee } from './commun.mjs';
import { servicesTableauxCm } from './tableaux.mjs';
import { lecteurTableaux } from './acces.mjs';
import { servicesDroitsCm } from './droits.mjs';
import { servicesEquipeCm } from './equipe.mjs';
import { servicesClipsCm } from './clips.mjs';
import { servicesImportTrello } from './importTrello.mjs';
import { PORTEE_SPONSORS, contexteSponsors, droitsSponsors } from '../sponsors/commun.mjs';
import { servicesVisuelsCm } from './visuels/service.mjs';
import { servicesDriveCm } from './drive/service.mjs';
import { servicesCalendriersCm } from './calendriers.mjs';
import { configDrive } from './drive/regles.mjs';
import { utiliseHorsDriveEnLecture, utiliseParDrive } from './utilisations.mjs';
import { servicesReunionsCm } from './reunions/service.mjs';
import { servicesLiensCm } from './liens.mjs';

export function servicesCm({ base, maintenant = () => Date.now(), medias, cleSession, stockage, drive: configDuDrive = configDrive(), planning }) {
  // Envois par morceaux de la section : il faut pouvoir écrire quelque chose dans la portée.
  medias?.brancherContexte('cm', async (acteur, portee) => {
    // Sponsors (migration 0024) : pièces des prospects et partenaires, portée « sponsors » (sponsors.gerer).
    if (portee === PORTEE_SPONSORS) {
      await contexteSponsors(base, acteur, { gerer: true });
      return { acteur, team: { id: null }, portee: PORTEE_SPONSORS };
    }
    const ctx = await contexteCm(base, acteur, portee);
    exiger(ctx, 'cm.editer', 'cm.deposer', 'cm.clips.proposer');
    return { acteur, team: { id: teamDePortee(ctx.portee) }, portee: ctx.portee };
  });
  // Drive (migration 0027) : dossiers et fichiers ; pièces jointes, images et sponsors peuvent y puiser.
  const drive = servicesDriveCm({ base, maintenant, medias, cleSession, stockage, config: configDuDrive });
  const tableaux = servicesTableauxCm({ base, maintenant, medias, cleSession, stockage, drive });
  const droits = servicesDroitsCm({ base, maintenant });
  const equipe = servicesEquipeCm({ base, maintenant, medias });
  const clips = servicesClipsCm({ base, maintenant, medias, cleSession, tableaux, drive });
  const trello = servicesImportTrello({ base, maintenant, tableaux });
  const visuels = servicesVisuelsCm({ base, maintenant, medias, cleSession, stockage, tableaux, drive });
  // Réunions de l'équipe CM (migration 0039) : une tâche de suivi peut devenir une carte d'un tableau.
  const reunions = servicesReunionsCm({ base, maintenant, tableaux });
  // Calendriers des teams superposés au calendrier éditorial (lecture seule : planning si le compte le voit, sinon compétition publiable).
  const calendriers = servicesCalendriersCm({ base, planning });
  // Liens utiles de DATA › Ressources (migration 0044), liables à des cartes et à des dossiers du Drive.
  const liens = servicesLiensCm({ base, maintenant, drive });

  /**
   * Le compte peut-il encore lire ce fichier (cm.voir sur sa portée, image du club — logo, fond — et cm.voir
   * quelque part, auteur d'un clip qui l'utilise, carte ou sponsor qui l'a en pièce jointe, élément du Drive
   * visible) ? Un fichier qui n'est QUE dans le Drive ne se lit qu'avec l'accès au Drive (jamais avec le seul
   * cm.voir : un dossier restreint le reste).
   */
  async function peutLire(compte, f) {
    if (compte === 'principal') return true;
    const acteur = { compte, superAdmin: false };
    if (await drive.peutLireFichierCm(compte, f.id)) return true;
    // Tableaux qui utilisent le fichier (pièce jointe d'une carte, fond) : s'ils sont TOUS restreints et fermés au
    // compte (migration 0046), le fichier ne se lit plus, sauf pour l'auteur du clip ou par la rubrique Sponsors.
    const lecteur = lecteurTableaux(base, acteur);
    const fonds = await base.tous('SELECT id, portee, team_id, acces FROM cm_tableaux WHERE fond_fichier_id = ? AND supprime_le IS NULL LIMIT 20', [f.id]);
    const parPieces = await base.tous('SELECT DISTINCT t.id, t.portee, t.team_id, t.acces FROM cm_pieces p JOIN cm_cartes c ON c.id = p.carte_id JOIN cm_tableaux t ON t.id = c.tableau_id WHERE p.fichier_id = ? AND p.drive_croise = 0 AND p.supprime_le IS NULL AND c.supprime_le IS NULL AND t.supprime_le IS NULL LIMIT 20', [f.id]);
    if (fonds.length + parPieces.length > 0 && (await lecteur.filtrer([...fonds, ...parPieces])).length === 0) {
      const ailleurs = (await base.premier('SELECT id FROM cm_clips WHERE fichier_id = ? AND supprime_le IS NULL', [f.id])) || (await base.premier('SELECT id FROM sp_pieces WHERE fichier_id = ? AND drive_croise = 0 AND supprime_le IS NULL', [f.id])) || f.portee === PORTEE_SPONSORS;
      if (!ailleurs) return false;
    }
    // Image de fond d'un tableau (migration 0042) : qui voit le tableau voit son fond, même pris dans le Drive.
    for (const tb of await lecteur.filtrer(fonds)) {
      try {
        if ((await contexteCm(base, acteur, tb.portee)).permissions.has('cm.voir')) return true;
      } catch {
        // Tableau d'une portée fermée au compte.
      }
    }
    if ((await utiliseParDrive(base, f.id)) && !(await utiliseHorsDriveEnLecture(base, f.id))) return false;
    // Fichier de la rubrique Sponsors, ou pièce d'un sponsor prise dans le Drive : sponsors.voir.
    if (f.portee === PORTEE_SPONSORS) return (await droitsSponsors(base, acteur)).has('sponsors.voir');
    if ((await base.premier('SELECT id FROM sp_pieces WHERE fichier_id = ? AND drive_croise = 0 AND supprime_le IS NULL', [f.id])) && (await droitsSponsors(base, acteur)).has('sponsors.voir')) return true;
    try {
      const ctx = await contexteCm(base, acteur, f.portee);
      if (ctx.permissions.has('cm.voir')) return true;
    } catch {
      // Pas d'accès à la portée : peut-être l'auteur du clip, ou une carte d'une autre portée.
    }
    const image = await base.premier('SELECT portee FROM cm_visuel_images WHERE fichier_id = ? AND supprime_le IS NULL', [f.id]);
    if (image?.portee === PORTEE_CLUB) {
      const p = await porteesDe(base, acteur);
      if (p.club.has('cm.voir') || [...p.teams.values()].some(x => x.has('cm.voir'))) return true;
    } else if (image && image.portee !== f.portee) {
      try {
        if ((await contexteCm(base, acteur, image.portee)).permissions.has('cm.voir')) return true;
      } catch {
        // Pas d'accès à la portée de l'image.
      }
    }
    // Pièce jointe d'une carte d'une autre portée (fichier du Drive du club joint à une carte de team).
    for (const { portee } of await lecteur.filtrer(parPieces)) {
      if (portee === f.portee) continue;
      try {
        if ((await contexteCm(base, acteur, portee)).permissions.has('cm.voir')) return true;
      } catch {
        // Portée suivante.
      }
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

  return { tableaux, droits, equipe, clips, trello, fichiers, visuels, drive, reunions, calendriers, liens };
}
