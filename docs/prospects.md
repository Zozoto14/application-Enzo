# Prospects

Carnet de prospection **personnel** du Fondateur (compte historique). Ce n'est ni un outil d'envoi en masse ni un
collecteur d'adresses : l'app range des contacts obtenus par l'utilisateur, prépare **un** e-mail à la fois (lien
`mailto:` ouvert dans sa messagerie) et rappelle qui relancer.

## Fonctions

- Fiche : nom, entreprise, e-mail, téléphone, source, étiquettes, statut (nouveau, contacté, relancé, répond,
  rendez-vous, gagné, perdu), prochaine relance, notes, historique des contacts (date + note), « Ne plus contacter ».
- Liste : recherche (sans accents ni casse), filtres par statut et étiquette, tri (relance, nom, entreprise, statut,
  récents), vue « À relancer aujourd'hui » (relance échue, ni gagné/perdu, ni refus), compteurs.
- Ajout rapide, édition, suppression avec confirmation ; ajout en lot (une adresse par ligne, ou séparées par
  virgules/points-virgules, `Nom <adresse>` accepté ; dédoublonnage insensible à la casse, contre le carnet et dans la
  liste ; validation de format). Une adresse déjà connue n'est jamais recréée : un refus est conservé.
- CSV : import (en-têtes français ou anglais, virgule ou point-virgule) et export complet (formules neutralisées).
- « Écrire » : modèle choisi, variables `{prenom}`, `{nom}`, `{entreprise}`, `{email}` ; « Noter l'envoi » (statut qui
  avance, relance dans 7 jours) ; copier l'adresse ou le message. Bloqué par « Ne plus contacter ».
- Rappel affiché dans l'app : RGPD / consentement, moyen de se désinscrire (présent dans les modèles par défaut),
  ne pas recontacter une personne qui refuse.
- Téléphone : cartes en cellules, fiche, formulaires et filtres en feuilles basses, « Nouveau prospect » en bouton
  principal collé en bas.

## Accès et données

- Entrée `src/prospects/registre.ts` (`adminSeulement`, sans ouverture aux gestionnaires) + garde `accesProspects` :
  seul le compte historique (Fondateur, `contexte.admin` présent) voit la tuile et lit le carnet. Ni un ami, ni un
  gestionnaire, ni un administrateur, ni un autre Fondateur ; l'app n'est jamais proposée dans les accès d'un ami.
- Données dans `admin.donnees` (base chiffrée du compte historique), champ `prospects`. Synchronisées comme les autres
  données d'administration (`src/hub/admin/fusionDonnees.ts`) : une entité `prospect:<id>` par fiche (dernier gagnant,
  suppression datée) et `prospects-modeles`, dans `/p/principal/boite/admin` scellé par `cleDerivee('synchro')` —
  rien en clair sur le relais (vérifié par `e2e-prospects.mjs`).
- Limite : deux modifications simultanées de la même fiche sur deux appareils → la plus récente gagne (historique
  compris). Mettre à jour tous les appareils du Fondateur avant d'utiliser Prospects : un appareil plus ancien ne
  connaît pas `prospect:*` et pourrait propager leur retrait.
- Electron : `mailto:` est confié à la messagerie du système (`setWindowOpenHandler`), comme les liens web.

## Tests

`src/prospects/prospects.test.ts` (validation, lot, CSV, filtres, relances, modèles, synchro, chiffrement, droits),
`src/prospects/RacineProspects.test.tsx` (écran bureau et téléphone, garde). Bout en bout :
`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/e2e-prospects.mjs` (après `npx vite build`), captures dans
`docs/captures-prospects/`.
