# Administration du hub

L'app **Administration** (page « Administration » du hub) gère les comptes, leurs accès aux apps, les invitations, la
sécurité du panneau et le journal. Code : `src/hub/Administration.tsx` et `src/hub/admin/` (logique pure, testée) ;
interface dans `src/hub/admin/ui/`.

## Sections

| Section | Fondateur | Administrateur | Gestionnaire |
| --- | --- | --- | --- |
| Tableau de bord | ✓ | ✓ | chiffres sans prénom + ses amis |
| Utilisateurs (liste, fiche, création, actions groupées) | ✓ | Gestionnaires et Amis | amis qu'il a créés |
| Accès par app (matrice comptes × apps) | ✓ | Gestionnaires et Amis | ses amis |
| Applications (apps globales, apps par défaut) | ✓ | — | — |
| Sécurité | ✓ | ✓ | — |
| Journal (export JSON/CSV) | ✓ | ✓ | ses actions, sans export |
| Réglages des comptes, modèle d'invitation, sauvegarde | ✓ | lecture seule (sans sauvegarde) | — |

La règle des rangs reste la seule source de vérité (`src/hub/admin/roles.ts`) : chacun n'agit que sur les rangs
strictement inférieurs, chaque action est revérifiée dans la logique (`actions.ts`) et chez l'hôte (`bureau/index.tsx`),
pas seulement en masquant des boutons. Nouvelles actions : `contact-ami` (adresse et historique d'invitations d'un
compte inférieur ; Gestionnaire compris, sur ses amis), `reglages-comptes` et `sauvegarde-admin` (Fondateurs seulement).

## Adresse e-mail et invitation par e-mail

- **Création d'un compte** : champ « Adresse e-mail » (facultatif, conseillé), validé (`contacts.ts`, `emailValide`).
  Fiche d'un compte : « Contact et invitations » pour la saisir ou la changer.
- **Où elle est gardée** : uniquement dans les données de l'Administration de celui qui la saisit (clé `admin.donnees`
  de sa base chiffrée ; synchronisées entre SES appareils comme entité `contact:<id>`, scellées par sa clé de
  synchronisation). Jamais dans la liste des profils (lisible par le hub des amis), jamais en clair sur le relais,
  jamais au journal (qui dit « invitation transmise (e-mail) », sans l'adresse), jamais dans l'export du journal.
- **« Envoyer l'invitation par e-mail »** : un lien `mailto:` pré-rempli (`modeleInvitation.ts`, `lienMailto`) —
  destinataire, objet et corps encodés en UTF-8 (`encodeURIComponent`), retours à la ligne en CRLF (RFC 6068), le `#`
  du lien d'invitation protégé. Au-delà de 2 000 caractères (limite sûre d'Outlook sous Windows), l'e-mail contient une
  version courte (le lien et sa validité) ; « Copier le message » donne toujours le texte complet.
  - site et iPhone/iPad : vrai lien `<a href="mailto:…" target="_blank">` (pas de bloqueur de fenêtres) ;
  - PC (Electron) : la fenêtre demandée part vers la messagerie du système (`decisionOuverture`,
    `bureau/electron/fenetresAnnexes.mjs`, déjà autorisé pour `mailto:` ; test ajouté) ;
  - app iOS native : `Linking.openURL`.
- **Aussi** : « Copier le message », « Partager… » (feuille de partage : Web Share API sur iPhone/iPad, `Share` en
  natif ; caché là où elle n'existe pas, comme sur la plupart des PC), « Copier le lien seul », QR code, code court.
- **Historique** : chaque transmission est notée (date, canal : e-mail, message copié, partage, QR code, lien copié ;
  « relance » à partir de la deuxième). Fiche › « Relancer (nouveau lien) » prépare un nouveau lien en un clic (l'ancien
  cesse de marcher) ; le tableau de bord liste les invitations en attente avec leur dernier envoi.

**Aucun e-mail ne part d'un serveur** : ni le relais ni un service tiers n'envoient quoi que ce soit. C'est la
messagerie de l'appareil (Mail, Outlook, Gmail…) qui envoie, depuis la boîte du Fondateur ; le lien d'invitation ne
quitte l'appareil que dans le message qu'il envoie lui-même. Conséquences : il faut une messagerie configurée sur
l'appareil (sinon : « Copier le message ») ; l'Administration ne sait pas si l'e-mail est vraiment parti ni s'il a été
lu (l'historique note l'ouverture de la messagerie).

### Modèle du message (Réglages, Fondateurs)

Objet et corps libres, variables `{prenom}`, `{lien}`, `{expiration}`, `{fondateur}`, et facultatives `{code}`,
`{site}`, `{connexion}`, `{longueur}` (une ligne dont la variable facultative est vide disparaît). `{lien}` est
obligatoire dans le corps et interdit dans l'objet (visible dans les listes de messages) ; variable inconnue refusée.
Aperçu en direct, avec la longueur du lien e-mail. « Rétablir le modèle par défaut ».

## Réglages des comptes (Fondateurs)

| Réglage | Défaut | Bornes | Effet |
| --- | --- | --- | --- |
| Validité d'une invitation | 7 j | 1–90 | création, relances, prolongation |
| Mot de passe des amis : longueur minimale | 10 | 10–64 | portée, scellée, par chaque nouvelle invitation |
| Mot de passe des amis : force minimale | Correct | Correct → Excellent | idem |
| Appareils par compte avant alerte | 5 | 1–20 | alerte du tableau de bord |

La politique du mot de passe voyage dans le contenu **scellé** de l'invitation (champ `politique: { l, f }` de
`ContenuInvitation`, `src/profils/invitation.ts`) : le relais ne la voit pas. L'écran de l'ami l'affiche et l'applique
(`evaluerMotDePasse`), et `accepterInvitation` la revérifie. Elle ne fait que durcir les règles de base (10 caractères,
pas seulement des chiffres, ni le prénom, ni un mot de passe courant). Les invitations déjà envoyées gardent leurs
règles ; un ancien lien sans politique garde les règles de base. Les autres réglages (journal, verrouillage du panneau,
validité de l'identité, comptes inactifs) restent dans Paramètres › Administration ; les apps ouvertes par défaut à un
nouveau compte, dans « Applications » (niveau par défaut de chaque app).

## Tableau de bord

Comptes, actifs, désactivés, invités en attente, invitations expirées, appareils ; alertes (invitation expirée ou
proche, jamais connecté, inactif, accès expiré, séquestre absent, **trop d'appareils**, **échecs de vérification
d'identité** des 7 derniers jours, sécurité du coffre) ; dernières connexions ; invitations en attente (expiration,
dernier envoi). Le relais ne communique pas les tentatives de connexion refusées : sa protection anti-force brute
(`docs/connexion-amis.md`) les bloque sans les remonter.

## Liste, actions groupées, matrice

- Liste : recherche, filtres (statut, rang, app), tri ; « ✉︎ » quand une adresse est enregistrée.
- Actions groupées (cases à cocher) : désactiver, réactiver, prolonger l'invitation, appliquer un modèle de permissions,
  **ouvrir / fermer une app**, **renvoyer l'invitation** (nouveaux liens, prêts à envoyer par e-mail, compte par
  compte), **révoquer l'accès** (relais + compte désactivé), **changer de rang** (Gestionnaire ou Ami ; Administrateur
  pour un Fondateur). Toute la sélection est vérifiée avant la première action (tout ou rien), et les actions faites
  par l'hôte redemandent l'identité.
- Matrice « Accès par app » : comptes × apps, une case = niveau (— aucun, 👁 lecture, ✓ complet), toucher pour passer
  au suivant. Même chemin que la fiche (`definirNiveauxPar`, liste revalidée par l'hôte, journal). Changer UNE app ne
  touche jamais les autres (correctif : un modèle appliqué en groupe ne retire plus l'accès aux apps hors de la liste).

## Fiche d'un compte

Prénom, rang, contact et invitations (adresse, historique, relance), accès aux apps, invitation et fin d'accès,
activation, accès et connexion (appareils liés et « vu il y a… »), séquestre, notes privées, **activité** (ses entrées
du journal), **zone Danger** (régénérer les identifiants, supprimer).

Appareils : la liste vient du suivi des connexions de l'ami. Il n'existe pas de jeton par appareil : pour déconnecter
ses appareils, « Réinitialiser l'accès » (son ancien mot de passe ne marche plus nulle part) ou « Révoquer l'accès »
(le relais refuse tous ses appareils).

**Supprimer un compte** : confirmation forte (saisir son prénom) + mot de passe et code ; efface son coffre, son
portefeuille, son séquestre, son adresse et vos notes ; case « Effacer aussi ses copies sur le relais » (cochée par
défaut, appareil du Fondateur principal) : tous les objets de son espace `p/<id>/`, son accès par identifiant, et
révocation de son jeton (`nettoyerCompteRelais`, `bureau/connexionAmis.ts` ; routes existantes, relais version 6 ;
avec un relais plus ancien, la révocation est signalée comme « relais à mettre à jour », le reste est fait). Un compte
qui a l'app Esport en est aussi retiré (toutes ses teams, `DELETE /admin/comptes/:id/hub` du serveur Esport) : voir
[docs/esport/invitations.md](../esport/invitations.md). Les comptes Esport se créent aussi depuis **Esport › Membres**.

## Sauvegarde chiffrée (Fondateurs)

Export des données de l'Administration (réglages, modèle, adresses, notes, journal, abonnements, prospects) dans un
fichier scellé par une phrase choisie (12 caractères au moins ; Argon2id puis XChaCha20-Poly1305, `sauvegarde.ts`).
Aucun mot de passe, clé ou code de séquestre n'y figure. Restauration (site et PC) : remplace les données de
l'Administration de l'appareil, puis des autres appareils du Fondateur par la synchronisation ; les comptes eux-mêmes
ne changent pas. Les deux opérations redemandent l'identité.

## Tests

`src/hub/admin/invitationsEmail.test.ts` (validation, mailto, modèle, stockage, réglages, actions groupées, droits,
sauvegarde, tableau de bord), `src/hub/admin/ui/adminInvitations.test.tsx` (écran), `bureau/connexionAmis.test.ts`
(politique scellée et revérifiée, nettoyage du relais), `bureau/electron/fenetresAnnexes.test.mjs` (mailto dans l'app
PC) ; bout en bout : `scripts/e2e-admin-invitations.mjs` (captures `docs/captures-admin-invitations/`).
