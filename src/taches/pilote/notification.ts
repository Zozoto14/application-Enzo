/**
 * Pilote de semaine : la proposition du dimanche soir (jour et heure
 * réglables). Quand l'heure est passée et que la semaine suivante n'est ni
 * validée ni déjà annoncée, une alerte part : pastille 🔔 de Tâches et, si
 * l'appareil le permet, notification du système. Une seule fois par semaine
 * (clé `pilote|<lundi>`, retenue sur l'appareil) ; rien n'est déposé sur le
 * relais. Appelé par le tour du hub (`verifierRappels`, toutes les 30 s).
 */

import { REGLAGES_PILOTE_DEFAUT } from '../../hub/pilote/contrats';
import { jourDe, plageSemaine } from '../../hub/pilote/jours';
import { proposerSemaine, resumerSemaine, semaineProposee } from '../../hub/pilote/planification';
import type { RoleTaches } from '../acces';
import type { Auteur, DonneesTaches } from '../modele';
import { CLES_TACHES } from '../partage';
import { lireEtatRappels, type AlerteRappel } from '../rappels';
import { construireEntree, ecrireEtatBase, lireEtatBase, type SourcesPilote } from './hote';

/** Une alerte de proposition reste d'actualité 36 h (appareil éteint : on ne l'annonce pas une semaine après). */
export const FRAICHEUR_PROPOSITION_MS = 36 * 3_600_000;

export interface AnnoncePilote {
  pastille: AlerteRappel[];
  /** Notification du système à montrer (vide si l'appareil n'a pas à sonner). */
  systeme: Array<{ titre: string; corps: string }>;
}

const PLURIEL = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

export function texteProposition(lundi: string, r: ReturnType<typeof resumerSemaine>): string {
  const morceaux = [
    r.taches + r.repetitions > 0 ? PLURIEL(r.taches + r.repetitions, 'tâche', 'tâches') : '',
    r.relances > 0 ? PLURIEL(r.relances, 'relance', 'relances') : '',
    r.paiements > 0 ? PLURIEL(r.paiements, 'paiement', 'paiements') : '',
    r.portefeuille > 0 ? `${r.portefeuille} du portefeuille` : '',
    r.episodes > 0 ? `${PLURIEL(r.episodes, 'épisode', 'épisodes')} en récompense` : '',
  ].filter(Boolean);
  return `La semaine du ${plageSemaine(lundi)} est prête${morceaux.length ? ` : ${morceaux.join(', ')}` : ''}. Ouvre Tâches › Ta semaine pour la valider.`;
}

export function verifierPilote(
  contexte: SourcesPilote,
  h: { role: RoleTaches; moi: Auteur; donnees: DonneesTaches },
  maintenant: number,
  o: { sonner: boolean },
): AnnoncePilote {
  const rien: AnnoncePilote = { pastille: [], systeme: [] };
  const base = contexte.baseProfil;
  if (!base) return rien;
  const etat = lireEtatBase(base);
  const r = etat.reglages ?? REGLAGES_PILOTE_DEFAUT;
  if (!r.actif || !r.notification) return rien;
  const aujourdhui = jourDe(maintenant);
  const { lundi, instant } = semaineProposee(maintenant, r, aujourdhui);
  if (maintenant - instant > FRAICHEUR_PROPOSITION_MS) return rien;
  if (etat.notifiees.includes(lundi) || etat.valide?.debut === lundi) return rien;
  const semaine = proposerSemaine(construireEntree(contexte, h, r, lundi, aujourdhui));
  const texte = texteProposition(lundi, resumerSemaine(semaine));
  const alerte: AlerteRappel = { cle: `pilote|${lundi}`, tacheId: '', titre: 'Ta semaine est prête', texte, date: new Date(maintenant).toISOString(), type: 'pilote' };
  try {
    const rappels = lireEtatRappels(base.lire(CLES_TACHES.rappels));
    if (!rappels.vus[alerte.cle]) {
      base.ecrire(CLES_TACHES.rappels, JSON.stringify({ ...rappels, vus: { ...rappels.vus, [alerte.cle]: alerte.date }, nonLus: [...rappels.nonLus, alerte].slice(-50) }));
    }
    ecrireEtatBase(base, { ...etat, notifiees: [...etat.notifiees, lundi].slice(-12) });
  } catch {
    return rien;
  }
  return { pastille: [alerte], systeme: o.sonner ? [{ titre: 'Tâches : ta semaine est prête', corps: texte }] : [] };
}
