# E-mails envoyés par le serveur

Le relais (chez o2switch) envoie les e-mails **directement**, depuis la boîte `noreply@appdashboard.fr`, par le
serveur SMTP d'o2switch :

- **invitations** (Administration › Utilisateurs, Esport › Créer un compte, **Renvoyer l'invitation**) : bouton
  **✉️ Envoyer l'e-mail maintenant**, en **français ou en anglais**, avec un beau modèle HTML (gros bouton vers le
  lien) et une version texte ;
- **réponse au support** (Administration › Support, case « Prévenir aussi par e-mail ») ;
- **Messagerie** (Administration › Messagerie) : un e-mail à un ou plusieurs utilisateurs, ou à tous les membres d'une
  team Esport, avec l'éditeur riche ; historique des envois et statut (Envoyé, Échec), plus une copie dans « Envoyés » de la boîte noreply (webmail) ;
- **récapitulatif Esport** (facultatif, désactivé par défaut) : chaque utilisateur peut l'activer dans
  **Esport › Mon profil › Récapitulatif par e-mail** (quotidien ou hebdomadaire).

Tous les modèles existent en **français et en anglais** et partent **dans la langue du destinataire** (voir
« Langue des comptes et des e-mails » plus bas).

Tant que le SMTP n'est pas configuré, rien ne change : l'app ouvre votre messagerie (`mailto:`), comme avant. Le
`mailto` reste toujours proposé en secours (« Ouvrir ma messagerie »).

## 1. Créer la boîte noreply@appdashboard.fr (cPanel, 3 minutes)

1. cPanel › section **E-mail** › **Comptes de messagerie** › **+ Créer**.
2. **Nom d'utilisateur** : `noreply` (domaine `appdashboard.fr`).
3. **Mot de passe** : **Générer**, puis copiez-le (il ira dans `relais.env`). Espace de stockage : 250 Mo suffisent.
4. **+ Créer**.
5. Sur la ligne `noreply@appdashboard.fr` › **Connect Devices** (« Connecter les appareils ») : notez le
   **serveur sortant (SMTP)** et le **port SSL** (**465**, SSL/TLS). Utilisez le **nom du serveur** affiché par cPanel
   (chez o2switch : `poisson.o2switch.net`), pas `mail.appdashboard.fr` : voir la note sur le certificat plus bas.

## 2. Ne pas finir en spam : SPF et DKIM (cPanel, 2 minutes)

1. cPanel › section **E-mail** › **Email Deliverability** (« Délivrabilité des e-mails »).
2. Ligne `appdashboard.fr` : si **DKIM** ou **SPF** ne sont pas « Valide », cliquez **Manage** (« Gérer ») puis
   **Install the suggested record** (« Installer l'enregistrement suggéré ») pour **DKIM** et pour **SPF**.
3. Si les DNS du domaine ne sont **pas** chez o2switch : copiez les enregistrements TXT proposés (SPF :
   `v=spf1 … include:… ~all`, DKIM : `default._domainkey`) chez votre registraire.
4. Facultatif mais conseillé : un enregistrement **DMARC** (TXT `_dmarc.appdashboard.fr` :
   `v=DMARC1; p=none; rua=mailto:VOTRE_ADRESSE`).
5. Attendez que les deux lignes soient vertes (quelques minutes à quelques heures selon les DNS).

## 3. Les variables dans relais.env (et esport.env pour le récapitulatif)

cPanel › **Terminal** :

```bash
nano ~/.appdashboard/relais.env
```

Ajoutez à la fin (remplacez les MAJUSCULES) :

```ini
# E-mails envoyés par le serveur (docs/emails.md)
SMTP_HOST=poisson.o2switch.net
SMTP_PORT=465
SMTP_USER=noreply@appdashboard.fr
SMTP_PASS=MOT_DE_PASSE_DE_LA_BOITE
MAIL_FROM=AppDashboard <noreply@appdashboard.fr>
```

- `SMTP_PORT=465` : SSL/TLS direct (recommandé). Avec `587`, le chiffrement STARTTLS est exigé.
- Facultatif : `MAIL_REPLY_TO=votre.adresse@exemple.fr` pour que les réponses des destinataires vous arrivent.

**Ctrl+O**, **Entrée**, **Ctrl+X**. Pour le **récapitulatif Esport**, mettez les **mêmes cinq lignes** dans
`~/.appdashboard/esport.env` (c'est la tâche cron de l'Esport qui l'envoie). Puis :

```bash
chmod 600 ~/.appdashboard/*.env
touch ~/application-enzo/relais/tmp/restart.txt
```

(ou **Setup Node.js App** › l'app du relais › **Restart**). Le paquet `nodemailer` est installé tout seul par la mise
à jour automatique (`esport/package.json`).

**Vérifier** : Administration › Messagerie affiche « Envoi direct par le serveur ». Envoyez-vous un e-mail d'essai
(mettez votre adresse dans votre propre fiche… ou invitez un compte de test). Si rien n'arrive : le journal
`~/logs/relais-passenger.log` dit « e-mails désactivés : … manquant(s) » si une ligne manque ; l'historique de la
Messagerie donne le motif d'un échec (« identifiants SMTP refusés », « certificat SMTP ne correspond pas au nom du
serveur », « serveur SMTP injoignable »…).

### Note : SMTP_HOST=poisson.o2switch.net, à cause du certificat

Le certificat TLS présenté par `mail.appdashboard.fr` est celui du **serveur** o2switch : il ne contient pas ce nom, et
l'envoi échoue avec « certificat SMTP ne correspond pas au nom du serveur ». Mettez dans `SMTP_HOST` le **nom du
serveur** affiché par cPanel (ici `poisson.o2switch.net`, port 465), dont le certificat est valide. La vérification du
certificat n'est jamais désactivée.

### Voir les e-mails envoyés

- **Contenu** : webmail (Roundcube) de `noreply@appdashboard.fr › Envoyés`. Après chaque envoi réussi, le serveur y
  dépose une copie exacte du message (IMAP, marquée « lu », à la date d'envoi), avec la même identité et le même mot
  de passe que le SMTP.
- **État de remise** (arrivé, différé, refusé) : cPanel › **E-mail** › **Suivre la remise** (« Track Delivery »).
- Réglages (tous facultatifs, dans `relais.env` et `esport.env`) : `MAIL_COPIE_ENVOYES=0` désactive la copie (activée
  par défaut dès que SMTP est configuré) ; `IMAP_HOST` (défaut : `SMTP_HOST`) ; `IMAP_PORT` (défaut `993`, SSL/TLS) ;
  `IMAP_DOSSIER` si le dossier n'est pas trouvé tout seul (détection : attribut `\Sent`, puis `Sent`, puis
  `INBOX.Sent`), par exemple `IMAP_DOSSIER=INBOX.Sent`.
- Un échec de la copie (IMAP indisponible, dossier introuvable) **n'empêche jamais l'envoi** : une ligne
  `[courriel] copie dans « Envoyés » impossible (code)` est écrite dans le journal, sans adresse ; après un échec la
  copie est suspendue 60 secondes.

## Langue des comptes et des e-mails

**Langue par défaut d'un compte** : le Fondateur la règle (Français ou English) :

- **à la création** du compte : Administration › Utilisateurs › **Nouvel utilisateur** (« Langue du compte ») et
  **Esport › Membres › Créer un compte** ;
- **ensuite** : sur la **fiche** de l'utilisateur (Administration › Utilisateurs › fiche › « Langue par défaut du
  compte ») et dans **Esport › Membres** (ouvrir le membre › « Langue du compte »). Esport › Membres est réservé au
  Fondateur : le serveur répond **403** à tout autre rôle (Propriétaire compris), et l'annuaire ne montre la langue
  qu'à lui.

Cette langue sert à : l'**interface Esport** tant que l'utilisateur n'a pas choisi la sienne ; les **e-mails**
(invitation, renvoi d'invitation, réponse au support, récapitulatif, Messagerie) ; les **réponses du bot Discord**.
Les comptes existants sont en **français**, sauf ceux qui avaient déjà choisi English dans leur profil Esport
(migration 0019).

**Le choix de l'utilisateur prime** : dans Esport › Mon profil, la langue qu'il choisit lui-même remplace la langue par
défaut (interface, récapitulatif, bot). Le bouton « Revenir à la langue définie par l'administrateur » efface son
choix. Le Fondateur voit les deux dans Esport › Membres (« choix de l'utilisateur : English (il prime) »).

**Où elle est rangée** (l'adresse e-mail n'est toujours stockée côté serveur nulle part) :

| Donnée | Où | Lue par |
| --- | --- | --- |
| langue par défaut, compte avec fiche Esport | serveur Esport, `comptes.langue_defaut` (migration 0019) | interface Esport, récapitulatif, bot Discord, annuaire du Fondateur |
| choix de l'utilisateur | serveur Esport, `comptes.langue` (migration 0012) | idem, **prioritaire** |
| langue par défaut, tout compte du hub | données **chiffrées** de l'Administration (fiche du compte, appareils du Fondateur), à côté de l'adresse | l'app du Fondateur, qui la **joint à chaque demande d'envoi** |
| langue d'un compte du hub jamais connecté à l'Esport | serveur Esport, `langues_attente` (juste la langue, aucun nom ni adresse), appliquée à la création de sa fiche puis effacée | interface Esport à sa première ouverture |

Le relais ne range **jamais** la langue d'un destinataire : elle arrive avec la demande d'envoi (`destinataires[].langue`),
comme l'adresse, et n'est gardée qu'à titre de statistique dans le journal minimal (`fr` / `en`, sans l'adresse).
Pour un compte qui a une fiche Esport, l'app du Fondateur utilise la langue effective (choix de l'utilisateur, sinon
langue par défaut du serveur Esport) ; sinon la langue de la fiche de l'Administration ; sinon le français.

### Messagerie : langue de l'e-mail, versions et aperçu

Administration › Messagerie :

- **Langue de l'e-mail** : « Langue du destinataire » (par défaut : chacun reçoit l'e-mail dans la langue de son
  compte), ou **Français** / **English** pour forcer tous les destinataires. Une pastille FR / EN indique la langue
  de chacun.
- L'**habillage** (en-tête, pied de page, mentions, bouton, lien) est **traduit pour chaque destinataire** : dans un
  envoi groupé mixte, chacun reçoit l'habillage dans sa langue ; le **corps reste tel que vous l'avez écrit**.
- **Écrire aussi une version anglaise** : un second objet et un second message ; les destinataires en anglais reçoivent
  la version anglaise, les autres la version principale.
- **Aperçu de l'e-mail** : le rendu exact (objet, HTML, texte) dans la langue choisie (onglets Français / English
  quand les destinataires en ont deux), calculé par le serveur avec les mêmes modèles que l'envoi (`POST
  /courriel/apercu`, sans adresse, sans envoi, même sans SMTP).
- Sujet, **texte brut et HTML** sont traduits ; l'en-tête `Content-Language` est posé.

Invitation, renvoi d'invitation et réponse au support proposent d'emblée la langue du compte (modifiable avant l'envoi
pour l'invitation).

## Confidentialité : où vont les adresses ?

Les adresses e-mail sont dans la **base chiffrée de l'Administration**, sur les appareils du Fondateur (comme avant).
Pour envoyer un e-mail, le serveur doit connaître l'adresse **au moment de l'envoi** :

- l'app du Fondateur la joint à la **demande d'envoi** (avec la langue de chaque destinataire), réservée au **jeton maître** (le Fondateur) : un ami, même
  Propriétaire d'une team, ne peut pas faire envoyer d'e-mail (403) ;
- le relais l'utilise pour cet envoi puis l'oublie : elle n'est **jamais rangée**, sauf dans le **journal d'envoi
  minimal**, et là **masquée** (`l***@e***.fr`), avec l'objet, la date et le statut ; journal gardé 180 jours ;
- aucune adresse dans les journaux du serveur (nodemailer sans journal, erreurs SMTP réduites à un code court) ;
- **un e-mail par destinataire** : personne ne voit l'adresse des autres.

Exception volontaire : le **récapitulatif Esport**. L'utilisateur donne lui-même son adresse pour ce seul usage ; elle
est **chiffrée** sur le serveur Esport (AES-GCM, clé du serveur), jamais rendue en clair par l'API, et **effacée** dès
qu'il désactive le récapitulatif, supprime ses données Esport, ou que son compte est supprimé.

Garde-fous : 100 destinataires par envoi, **100 e-mails par heure et 300 par jour** (protège la réputation de la
boîte), adresses validées (pas de retour à la ligne : pas d'injection d'en-têtes).

## Pour les développeurs

- Relais : `relais/courriel.mjs` (routes `GET /courriel/etat`, `POST /courriel/envoyer`, `POST /courriel/apercu`,
  `GET /courriel/journal`, jeton maître ; `variables.en` = version anglaise), `relais/courriel-modeles.mjs` (modèles HTML et texte FR/EN, Markdown sûr), transport
  `esport/serveur/courriel-smtp.mjs` (nodemailer) injecté par `relais/serveur/app.mjs` (`env.ENVOYER_COURRIEL`) :
  le Worker Cloudflare n'en a pas (503 `non-configure`, l'app garde le `mailto`).
- Langue des comptes : migration `esport/migrations/0019_langue_defaut.sql`, `PUT /comptes/:compte/langue-defaut`
  (Fondateur seul, `esport/noyau/comptes.mjs`), `PUT /moi/langue` (`{ langue: null }` revient à la langue par défaut),
  fiche du compte `src/hub/admin/contacts.ts` (`langue`, `langueEffective`), `src/esport/ui/LangueCompte.tsx`,
  `src/esport/comptesHub.ts` (`changerLangueCompte`), `src/esport/synchroAdmin.ts` (`pousserLangueEsport`).
- Récapitulatif : `esport/noyau/recap.mjs`, routes `GET|PUT /moi/recap-courriel`, table `courriel_recap`
  (migration 0015), tâche du cron Node `esport/serveur/cron.mjs`.
- App : `src/messagerie/courriel.ts`, `src/hub/admin/ui/Messagerie.tsx`, envoi direct dans
  `src/hub/admin/ui/EnvoiInvitation.tsx`.
- Tests avec un FAUX serveur SMTP local (`relais/test-smtp/faux-smtp.mjs`) : `relais/courriel.test.mjs`,
  `esport/test/discord-id.test.mjs` (récapitulatif), `esport/test/langue-comptes.test.mjs` (langue par défaut, priorité,
  403, migration), `scripts/e2e-support-mail-discord.mjs`, `scripts/e2e-langue-comptes.mjs` (compte créé en English,
  invitation reçue en anglais, interface Esport de l'invité en anglais, Messagerie vers deux comptes FR et EN). Aucun test n'envoie de
  vrai e-mail.
