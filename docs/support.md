# Support : demandes, salon Discord et réponses

Le bouton **? Support** (hub, pages d'app, Paramètres › Support) ouvre un formulaire : **catégorie** (🐞 Bug,
💡 Idée, ❓ Question, 👤 Compte), **titre**, **message** avec mise en forme (gras, listes, liens…), **capture
d'écran** facultative et **informations techniques** jointes automatiquement (version, appareil, app ouverte,
langue, rang ; jamais de mot de passe, de clé ni de jeton).

```
app ──(jeton du compte)──▶ relais (range la demande) ──(DISCORD_WEBHOOK_URL)──▶ salon Discord du support
                                   ▲                                                   │
       Administration › Support ───┘  réponse ──▶ app de l'utilisateur, fil Discord, e-mail (facultatif)
```

## Pourquoi il ne marchait pas (diagnostic d'octobre 2026)

1. **Les amis connectés sur le site n'envoyaient rien.** L'app cherchait le relais seulement dans la configuration de
   synchronisation (`relaisActif()`). Or un ami connecté par identifiant + mot de passe sur https://appdashboard.fr
   n'a pas de configuration de relais : sa liaison (jeton de son compte) est gardée par le site. Résultat : « Relais
   non relié », la demande restait « en attente » pour toujours, sans erreur visible. Corrigé : l'app utilise
   la liaison du compte (`relaisDuCompte()`).
2. **Après le déménagement chez o2switch, le webhook manquait sans doute.** L'adresse du webhook était un secret
   Cloudflare (`wrangler secret put`), qu'on ne peut pas relire ; `DISCORD_WEBHOOK_URL` est « facultatif » dans
   `relais.env` : s'il est vide, le relais répondait 503 « support pas configuré » et la demande passait en
   « Erreur ». Maintenant la demande est **toujours enregistrée** et l'Administration le dit (diagnostic en haut de
   Administration › Support), avec un bouton **Renvoyer sur Discord** une fois le webhook posé.
3. Un **salon Forum** refusait les messages (Discord exige un nom de fil, code 220001) : le relais détecte maintenant
   le type de salon tout seul.

Le code du relais, lui, était bon (vérifié de bout en bout : serveur Node + PostgreSQL + faux Discord, CORS compris).

## 1. Créer le webhook du salon support (Discord, 3 minutes)

1. Dans votre serveur Discord, créez un salon réservé à l'équipe, par exemple `#support`. **Conseillé : un salon
   « Forum »** (Créer un salon › **Forum**) : chaque demande y ouvre son propre fil, et vos réponses y arrivent. Un
   salon texte marche aussi (voir plus bas).
2. **Paramètres du salon** (roue dentée) › **Intégrations** › **Webhooks** › **Nouveau webhook**.
3. Nom : `AppDashboard Support` › **Copier l'URL du webhook**. Elle ressemble à
   `https://discord.com/api/webhooks/123456789012345678/AbCd…`.
4. C'est un **mot de passe** : quiconque la connaît peut écrire dans le salon. Ne la collez nulle part ailleurs que
   dans `relais.env`. Si elle fuite : supprimez le webhook dans Discord, recréez-en un, refaites l'étape 2.

## 2. La mettre dans relais.env (o2switch)

cPanel › **Terminal** :

```bash
nano ~/.appdashboard/relais.env
```

Ajoutez (ou complétez) la ligne, sans guillemets ni espace :

```ini
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/123456789012345678/AbCd…
```

**Ctrl+O**, **Entrée**, **Ctrl+X**, puis redémarrez le relais :

```bash
touch ~/application-enzo/relais/tmp/restart.txt
```

(ou cPanel › **Setup Node.js App** › l'app du relais › **Restart**). Vérifiez : **Administration › Support** affiche
« Webhook Discord configuré ». Envoyez une demande d'essai depuis l'app : elle arrive dans le salon.

### Salon texte (au lieu d'un forum)

Les demandes arrivent comme messages. Pour que vos réponses aillent dans un **fil** sous chaque demande, le relais a
besoin du bot de l'Esport : ajoutez aussi `DISCORD_BOT_TOKEN=…` (le même que dans `esport.env`) à `relais.env`, et
donnez au bot, dans ce salon, les permissions **Créer des fils publics** et **Envoyer des messages dans les fils**.
Sans lui, les réponses sont postées dans le salon avec le numéro de la demande.

## Ce que l'on voit dans Discord

Un message « embed » soigné : couleur selon la catégorie (rouge Bug, jaune Idée, bleu Question, violet Compte),
auteur (prénom et début de l'identifiant du compte), titre, message, champs **App**, **Version**, **Appareil**,
**Rang**, **Langue**, numéro de la demande, lien vers Administration › Support, et la **capture en pièce jointe**
(affichée dans le message). Aucune mention ne notifie qui que ce soit (`@everyone`, `<@…>` sont neutralisés et
`allowed_mentions` est vide).

## Répondre (Administration › Support, Fondateur)

1. **Administration › Support** : toutes les demandes, filtre par statut (Ouverte, En cours, Répondu, Résolue),
   pastille « À traiter ».
2. Touchez une demande : message, infos techniques, conversation. Écrivez la réponse (mise en forme possible).
3. **Prévenir aussi par e-mail** (coché par défaut) : si la fiche du compte a une adresse, un e-mail part, **dans la
   langue du compte** (langue par défaut de sa fiche, sinon celle de la demande ; voir [emails.md](emails.md)).
4. **Répondre** : la réponse arrive
   - dans l'app de l'utilisateur : bouton **? Support 🔔 1**, badge « Nouvelle réponse » dans Mes demandes ;
   - dans le **fil Discord** de la demande ;
   - par e-mail si coché.
5. **En cours**, **Marquer résolue** : le statut change aussi chez l'utilisateur. L'utilisateur peut compléter sa
   demande (son message part aussi dans le fil Discord, et la demande se rouvre).

## Où sont rangées les demandes, et qui les lit

Sur le **relais** (sa boîte : PostgreSQL chez o2switch), et pas sur le serveur Esport : tous les comptes du hub ont un
jeton du relais, seuls les membres de l'Esport ont une session Esport. Chaque demande est rangée sous l'identifiant
du compte **vérifié par son jeton** : un compte ne voit, ne complète et ne marque lues que SES demandes (404 sinon) ;
seul le jeton maître (le Fondateur) les liste toutes et y répond. La capture n'est gardée que si Discord était en
panne (pour le renvoi, 7 jours au plus), puis effacée. 100 demandes au plus par compte.

Garde-fous : 5 demandes par heure et par compte (429 au-delà), 20 compléments par heure, textes nettoyés, liste fermée
d'informations techniques, l'adresse du webhook n'apparaît jamais dans une réponse ni dans un journal.

## Pour les développeurs

- Relais : `relais/support.mjs` (routes `POST /support`, `GET /support/tickets[?tous=1]`,
  `POST /support/tickets/:id/{messages,lu,statut,discord}`, `GET /support/etat`), branché dans `relais/worker.mjs`.
- App : `src/support/` (formulaire, historique local, synchronisation des réponses), `src/hub/PageSupport.tsx`,
  `src/hub/admin/ui/Support.tsx`.
- Tests : `relais/support.test.mjs` (`npm run relais:tester`, et contre PostgreSQL `npm run relais:tester:pg`),
  `src/support/support.test.ts`, `src/hub/supportJuridique.test.tsx`, `src/hub/admin/ui/supportMessagerie.test.tsx`,
  bout en bout `scripts/e2e-support-mail-discord.mjs` (faux Discord et faux SMTP locaux) et
  `scripts/e2e-support-verrou.mjs`.
