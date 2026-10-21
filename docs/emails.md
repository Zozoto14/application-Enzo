# E-mails envoyés par le serveur

Le relais (chez o2switch) envoie les e-mails **directement**, depuis la boîte `noreply@appdashboard.fr`, par le
serveur SMTP d'o2switch :

- **invitations** (Administration › Utilisateurs, Esport › Créer un compte, **Renvoyer l'invitation**) : bouton
  **✉️ Envoyer l'e-mail maintenant**, en **français ou en anglais**, avec un beau modèle HTML (gros bouton vers le
  lien) et une version texte ;
- **réponse au support** (Administration › Support, case « Prévenir aussi par e-mail ») ;
- **Messagerie** (Administration › Messagerie) : un e-mail à un ou plusieurs utilisateurs, ou à tous les membres d'une
  team Esport, avec l'éditeur riche ; historique des envois et statut (Envoyé, Échec) ;
- **récapitulatif Esport** (facultatif, désactivé par défaut) : chaque utilisateur peut l'activer dans
  **Esport › Mon profil › Récapitulatif par e-mail** (quotidien ou hebdomadaire).

Tant que le SMTP n'est pas configuré, rien ne change : l'app ouvre votre messagerie (`mailto:`), comme avant. Le
`mailto` reste toujours proposé en secours (« Ouvrir ma messagerie »).

## 1. Créer la boîte noreply@appdashboard.fr (cPanel, 3 minutes)

1. cPanel › section **E-mail** › **Comptes de messagerie** › **+ Créer**.
2. **Nom d'utilisateur** : `noreply` (domaine `appdashboard.fr`).
3. **Mot de passe** : **Générer**, puis copiez-le (il ira dans `relais.env`). Espace de stockage : 250 Mo suffisent.
4. **+ Créer**.
5. Sur la ligne `noreply@appdashboard.fr` › **Connect Devices** (« Connecter les appareils ») : notez le
   **serveur sortant (SMTP)** et le **port SSL**. Chez o2switch c'est en général `mail.appdashboard.fr` (ou le nom
   du serveur, par exemple `xxx.o2switch.net`) et le port **465** (SSL/TLS). Utilisez exactement ce que cPanel affiche.

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
SMTP_HOST=mail.appdashboard.fr
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
Messagerie donne le motif d'un échec (« identifiants SMTP refusés », « serveur SMTP injoignable »…).

## Confidentialité : où vont les adresses ?

Les adresses e-mail sont dans la **base chiffrée de l'Administration**, sur les appareils du Fondateur (comme avant).
Pour envoyer un e-mail, le serveur doit connaître l'adresse **au moment de l'envoi** :

- l'app du Fondateur la joint à la **demande d'envoi**, réservée au **jeton maître** (le Fondateur) : un ami, même
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

- Relais : `relais/courriel.mjs` (routes `GET /courriel/etat`, `POST /courriel/envoyer`, `GET /courriel/journal`,
  jeton maître), `relais/courriel-modeles.mjs` (modèles HTML et texte FR/EN, Markdown sûr), transport
  `esport/serveur/courriel-smtp.mjs` (nodemailer) injecté par `relais/serveur/app.mjs` (`env.ENVOYER_COURRIEL`) :
  le Worker Cloudflare n'en a pas (503 `non-configure`, l'app garde le `mailto`).
- Récapitulatif : `esport/noyau/recap.mjs`, routes `GET|PUT /moi/recap-courriel`, table `courriel_recap`
  (migration 0015), tâche du cron Node `esport/serveur/cron.mjs`.
- App : `src/messagerie/courriel.ts`, `src/hub/admin/ui/Messagerie.tsx`, envoi direct dans
  `src/hub/admin/ui/EnvoiInvitation.tsx`.
- Tests avec un FAUX serveur SMTP local (`relais/test-smtp/faux-smtp.mjs`) : `relais/courriel.test.mjs`,
  `esport/test/discord-id.test.mjs` (récapitulatif), `scripts/e2e-support-mail-discord.mjs`. Aucun test n'envoie de
  vrai e-mail.
