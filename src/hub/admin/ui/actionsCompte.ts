/**
 * Actions sensibles sur la fiche d'un compte (identifiants, séquestre, ouverture du compte,
 * suppression) : mêmes vérifications d'identité et mêmes lignes de journal sur le bureau et sur
 * téléphone. Chaque action revérifie le rang de l'acteur (`verifierSur`).
 */

import type { IdentifiantsAmi } from '../../../profils/identifiants';
import type { Profil } from '../../../profils/profils';
import { verifierSur, avecNotePar } from '../actions';
import { LIBELLES_RANG } from '../roles';
import type { OutilsAdmin } from './commun';

export interface ContexteActionsCompte {
  outils: OutilsAdmin;
  profil: Profil;
  onIdentifiants(nom: string, valeurs: IdentifiantsAmi): void;
  onSupprime(): void;
  setCode(code: { code: string; creeLe: string } | undefined): void;
  setCodeSite(code: { code: string; lien?: string } | undefined): void;
  codeSaisi: string;
}

export function creerActionsCompte({ outils, profil, onIdentifiants, onSupprime, setCode, setCodeSite, codeSaisi }: ContexteActionsCompte) {
  const { controle } = outils;
  const cibleJournal = { cible: profil.id, nomCible: profil.nom };

  const regenerer = () =>
    outils.exigerIdentite(`Régénérer les identifiants de ${profil.nom}`, () =>
      outils.agir('Génération des identifiants…', async () => {
        verifierSur(outils.acteur, 'regenerer-identifiants', outils.tous, profil.id);
        const valeurs = await controle.onRegenerer!(profil.id);
        outils.journaliser({ type: 'identifiants', ...cibleJournal, action: `Identifiants régénérés pour ${profil.nom} (nouveau séquestre, nouveau code d’accès)` });
        onIdentifiants(profil.nom, valeurs);
        return `Nouveaux identifiants de ${profil.nom} générés : l’ancien portefeuille a été effacé.`;
      }),
    );
  const supprimer = () =>
    outils.exigerIdentite(`Supprimer le compte de ${profil.nom}`, () =>
      outils.agir('Suppression…', async () => {
        verifierSur(outils.acteur, 'supprimer-ami', outils.tous, profil.id);
        await controle.onSupprimer(profil.id);
        outils.majDonnees(d => avecNotePar(outils.acteur, d, outils.tous, profil.id, ''));
        outils.journaliser({ type: 'compte', ...cibleJournal, action: `Compte de ${profil.nom} supprimé (coffre et portefeuille effacés)` });
        onSupprime();
        return `Compte « ${profil.nom} » supprimé.`;
      }),
    );

  const afficherCode = () =>
    outils.exigerIdentite(`Afficher le code d’accès administrateur de ${profil.nom}`, () =>
      outils.agir('Lecture du code…', async () => {
        verifierSur(outils.acteur, 'acces-sequestre', outils.tous, profil.id);
        const lu = await controle.onCodeAcces?.(profil.id);
        setCode(lu);
        outils.journaliser({ type: 'acces-admin', ...cibleJournal, action: `Code d’accès administrateur de ${profil.nom} affiché` });
        return lu ? undefined : 'Aucun code : le séquestre de ce compte n’existe pas encore.';
      }),
    );
  const envoyerCodeSite = () =>
    outils.exigerIdentite(`Code de connexion au site pour ${profil.nom}`, () =>
      outils.agir('Préparation du code…', async () => {
        verifierSur(outils.acteur, 'regenerer-identifiants', outils.tous, profil.id);
        const valeurs = await controle.onCodeSite!(profil.id);
        setCodeSite(valeurs);
        outils.journaliser({ type: 'identifiants', ...cibleJournal, action: `Code de connexion au site préparé pour ${profil.nom}` });
        return `Code de ${profil.nom} prêt : son compte est publié sur le relais d’ici une minute.`;
      }),
    );
  const regenererCode = () =>
    outils.exigerIdentite(`Régénérer le code d’accès de ${profil.nom}`, () =>
      outils.agir('Nouveau code…', async () => {
        verifierSur(outils.acteur, 'acces-sequestre', outils.tous, profil.id);
        const nouveau = await controle.onRegenererCode!(profil.id);
        setCode({ code: nouveau, creeLe: new Date(outils.maintenant()).toISOString() });
        outils.journaliser({ type: 'acces-admin', ...cibleJournal, action: `Code d’accès administrateur de ${profil.nom} régénéré (l’ancien ne fonctionne plus)` });
        return 'Nouveau code généré : l’ancien ne fonctionne plus.';
      }),
    );
  const revoquer = () =>
    outils.exigerIdentite(`Révoquer l’accès administrateur au compte de ${profil.nom}`, () =>
      outils.agir('Révocation…', async () => {
        verifierSur(outils.acteur, 'acces-sequestre', outils.tous, profil.id);
        await controle.onRevoquerAcces!(profil.id);
        setCode(undefined);
        outils.journaliser({ type: 'acces-admin', ...cibleJournal, action: `Accès administrateur au compte de ${profil.nom} révoqué` });
        return 'Accès administrateur révoqué : le code et l’enveloppe de séquestre sont effacés.';
      }),
    );
  const retablir = () =>
    outils.agir('Enregistrement…', async () => {
      verifierSur(outils.acteur, 'acces-sequestre', outils.tous, profil.id);
      await controle.onRetablirAcces!(profil.id);
      outils.journaliser({ type: 'acces-admin', ...cibleJournal, action: `Accès administrateur au compte de ${profil.nom} rétabli (séquestre attendu à sa prochaine connexion)` });
      return 'Le séquestre sera recréé à la prochaine connexion de l’ami.';
    });
  const ouvrirCompte = () =>
    outils.exigerIdentite(`Ouvrir le compte de ${profil.nom}`, () =>
      outils.agir(`Ouverture du compte de ${profil.nom}…`, async () => {
        // Inscrit AVANT de quitter la session : le journal vit dans la base de l'administrateur.
        outils.journaliser({ type: 'acces-admin', ...cibleJournal, action: `Ouverture du compte de ${profil.nom} par ${outils.acteur.nom} (${LIBELLES_RANG[outils.role]}, code d’accès)` });
        try {
          verifierSur(outils.acteur, 'ouvrir-compte', outils.tous, profil.id);
          await controle.onOuvrirCompte!(profil.id, codeSaisi);
        } catch (erreur) {
          outils.journaliser({ type: 'acces-admin', ...cibleJournal, action: `Échec de l’ouverture du compte de ${profil.nom} : ${erreur instanceof Error ? erreur.message : 'erreur'}` });
          throw erreur;
        }
      }),
    );

  return { regenerer, supprimer, afficherCode, envoyerCodeSite, regenererCode, revoquer, retablir, ouvrirCompte };
}
