/**
 * Textes de la suppression des strats (bouton poubelle, confirmation, sélection multiple, toast « Annuler »,
 * corbeille de 30 jours) et du retrait d'une entrée du playbook, en français et en anglais. `trSs` suit la
 * langue de l'app. TypeScript refuse une clé anglaise manquante.
 */

import { interpoler, langueCourante, type Variables } from './index';

const fr = {
  'supprimer': 'Supprimer',
  'supprimer.libelle': 'Supprimer la strat « {titre} »',
  'confirm.titre': 'Supprimer « {titre} » ?',
  'confirm.texte': 'La strat part à la corbeille : vous pouvez la restaurer pendant 30 jours. Ses liens de partage sont révoqués.',
  'confirm.oui': 'Oui, supprimer',
  'confirm.non': 'Annuler',
  'confirm.lot.one': 'Supprimer cette strat ?',
  'confirm.lot.other': 'Supprimer ces {n} strats ?',
  'confirm.lot.texte': 'Elles partent à la corbeille : vous pouvez les restaurer pendant 30 jours.',
  'confirm.lot.oui': 'Oui, tout supprimer',
  'toast.une': 'Strat « {titre} » supprimée',
  'toast.n': '{n} strats supprimées',
  'toast.annuler': 'Annuler',
  'toast.fermer': 'Fermer',
  'toast.restauree.one': 'Strat restaurée.',
  'toast.restauree.other': '{n} strats restaurées.',
  'toast.refus.one': '{n} strat n’a pas pu être supprimée (droits insuffisants ou déjà supprimée).',
  'toast.refus.other': '{n} strats n’ont pas pu être supprimées (droits insuffisants ou déjà supprimées).',
  'selection.activer': 'Sélectionner',
  'selection.terminer': 'Terminer',
  'selection.n.one': '{n} strat sélectionnée',
  'selection.n.other': '{n} strats sélectionnées',
  'selection.tout': 'Tout sélectionner',
  'selection.rien': 'Tout désélectionner',
  'selection.supprimer': 'Supprimer la sélection',
  'selection.case': 'Sélectionner la strat « {titre} »',
  'corbeille.ouvrir': 'Corbeille',
  'corbeille.retour': 'Retour aux strats',
  'corbeille.titre': 'Corbeille des strats',
  'corbeille.aide': 'Les strats supprimées restent ici 30 jours, puis elles sont effacées pour de bon.',
  'corbeille.vide': 'La corbeille est vide.',
  'corbeille.par': 'Supprimée par {qui} le {date}',
  'corbeille.expire': 'effacée définitivement le {date}',
  'corbeille.inconnu': 'un membre',
  'corbeille.restaurer': 'Restaurer',
  'corbeille.restauree': 'Strat « {titre} » restaurée.',
  'pb.retiree': 'Entrée « {titre} » retirée du playbook',
  'pb.restauree': 'Entrée « {titre} » remise dans le playbook.',
  'pb.retirer.libelle': 'Retirer « {titre} » du playbook',
  'jr.strat_restauree': '{qui} a restauré la strat « {v} »',
  'jr.entree_restauree': '{qui} a remis « {v} » dans le playbook',
};

const en: Record<keyof typeof fr, string> = {
  'supprimer': 'Delete',
  'supprimer.libelle': 'Delete the strat “{titre}”',
  'confirm.titre': 'Delete “{titre}”?',
  'confirm.texte': 'The strat goes to the trash: you can restore it for 30 days. Its share links are revoked.',
  'confirm.oui': 'Yes, delete',
  'confirm.non': 'Cancel',
  'confirm.lot.one': 'Delete this strat?',
  'confirm.lot.other': 'Delete these {n} strats?',
  'confirm.lot.texte': 'They go to the trash: you can restore them for 30 days.',
  'confirm.lot.oui': 'Yes, delete all',
  'toast.une': 'Strat “{titre}” deleted',
  'toast.n': '{n} strats deleted',
  'toast.annuler': 'Undo',
  'toast.fermer': 'Dismiss',
  'toast.restauree.one': 'Strat restored.',
  'toast.restauree.other': '{n} strats restored.',
  'toast.refus.one': '{n} strat could not be deleted (not allowed, or already deleted).',
  'toast.refus.other': '{n} strats could not be deleted (not allowed, or already deleted).',
  'selection.activer': 'Select',
  'selection.terminer': 'Done',
  'selection.n.one': '{n} strat selected',
  'selection.n.other': '{n} strats selected',
  'selection.tout': 'Select all',
  'selection.rien': 'Deselect all',
  'selection.supprimer': 'Delete selection',
  'selection.case': 'Select the strat “{titre}”',
  'corbeille.ouvrir': 'Trash',
  'corbeille.retour': 'Back to strats',
  'corbeille.titre': 'Strat trash',
  'corbeille.aide': 'Deleted strats stay here for 30 days, then they are erased for good.',
  'corbeille.vide': 'The trash is empty.',
  'corbeille.par': 'Deleted by {qui} on {date}',
  'corbeille.expire': 'erased for good on {date}',
  'corbeille.inconnu': 'a member',
  'corbeille.restaurer': 'Restore',
  'corbeille.restauree': 'Strat “{titre}” restored.',
  'pb.retiree': 'Entry “{titre}” removed from the playbook',
  'pb.restauree': 'Entry “{titre}” put back in the playbook.',
  'pb.retirer.libelle': 'Remove “{titre}” from the playbook',
  'jr.strat_restauree': '{qui} restored the strat “{v}”',
  'jr.entree_restauree': '{qui} put “{v}” back in the playbook',
};

export type CleSs = keyof typeof fr;
const DICTIONNAIRES = { fr, en } as const;

/** Texte dans la langue de l'app (clé inconnue : rendue telle quelle). */
export function trSs(cle: CleSs, vars?: Variables): string {
  return interpoler((DICTIONNAIRES[langueCourante()] as Record<string, string>)[cle] ?? fr[cle] ?? cle, vars);
}

/** Pluriel simple (« .one » / « .other ») : n = 1 → one. */
export function trnSs(cle: 'confirm.lot' | 'toast.restauree' | 'toast.refus' | 'selection.n', n: number, vars?: Variables): string {
  return trSs(`${cle}.${n === 1 ? 'one' : 'other'}` as CleSs, { n, ...vars });
}
