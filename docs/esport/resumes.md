# Esport : résumés de réunions

Module `meeting_summaries` (phase 3). Un membre dépose l'enregistrement d'une réunion ; un rédacteur en fait un
résumé PDF ; le déposant est prévenu et lit le PDF.

## Qui fait quoi

| Rôle (système) | Déposer | Lire les résumés « team » | Lire les résumés « staff » | Boîte de réception, statuts, PDF |
| --- | --- | --- | --- | --- |
| Propriétaire, Fondateur (partout) | oui | oui | oui | oui |
| Manager | oui | oui | oui | oui (`write_summary`) |
| Coach, Analyste | oui | oui | oui (`view_staff`) | non |
| Joueur | oui | oui | non | non |
| Remplaçant / Invité | non | non | non | non |

Permissions : `meeting_summaries.submit`, `view_summary`, `view_staff` (nouvelle), `view_all` (boîte de réception
en lecture seule), `write_summary` (rédacteur). Le déposant voit toujours ses propres dépôts et leur PDF. Un dépôt
qu'on n'a pas le droit de voir répond 404, comme une team étrangère. Les rôles système des teams existantes
reçoivent les nouvelles permissions par la migration `0003` (Manager : `write_summary` et `view_staff` ; Coach et
Analyste : `view_staff`).

## Côté membre

Esport › team › **Résumés** :

- **Déposer** : lien de l'enregistrement (http/https), type de réunion, date (JJ/MM/AAAA), titre, note facultative.
  Chaque dépôt prévient les rédacteurs de la team et le Fondateur (notification in-app).
- **Mes dépôts** : statut (À résumer, En cours, Terminé) ; « Ouvrir le PDF » / « Télécharger » quand c'est prêt.
  Un dépôt pas encore pris en charge peut être retiré.
- **Résumés** : les résumés terminés que l'on peut lire.

L'accueil de la team montre les derniers résumés.

## Côté rédacteur

- Accueil Esport : bloc **Résumés à rédiger** (nombre en attente, badge « Nouveau ») › **Boîte de réception** : toutes
  les teams où l'on rédige. Dans une team : onglet **Boîte de réception** (cette team seulement).
- Filtres : statut, team, type, dates (du / au), déposant, « Nouveaux seulement » ; tris : plus récents, plus
  anciens, par statut, date de réunion.
- Ouvrir un dépôt le marque **Vu** (le badge « Nouveau » disparaît).
- Statuts **À résumer → En cours → Terminé** à la main ; « Terminé » demande un PDF. **Déposer le PDF** (site et PC)
  passe le dépôt en Terminé tout seul et prévient le déposant. **Remplacer le PDF** garde l'ancien dans
  l'historique (versions consultables par les rédacteurs). Sur iPhone et iPad (app native), le dépôt de PDF se fait
  depuis le PC ou le site.
- **Types de réunion** : les types globaux (Hebdo, Mensuel, Débrief de match, Staff, Autre, gérés par le Fondateur)
  et ceux de la team. Visibilité par type : « Team » ou « Staff ». Changer la visibilité d'un type s'applique aussi
  aux résumés déjà publiés.

## Fichiers

- Stockage par l'interface `stockage` (`esport/adaptateurs/stockage.mjs`) : R2 privé `esport-fichiers` sur Cloudflare,
  dossier sur le disque en local (`<base>.fichiers/`), mémoire dans les tests.
- Contrôles, dans l'ordre : session → appartenance → module → `write_summary` → stockage présent → type annoncé
  `application/pdf` → taille (20 Mo, annoncée puis réelle) → octets magiques `%PDF-` au tout début. Un faux PDF
  n'écrit rien.
- Nom de stockage aléatoire (`teams/<team>/resumes/<uuid>.pdf`) ; le nom d'origine n'est gardé qu'en base.
- Lecture : `POST /teams/:t/resumes/:id/lien` vérifie les droits et rend un **lien signé** (HMAC avec `CLE_ESPORT`)
  valable **5 minutes**, lié au compte et au fichier : `GET /fichiers/:id?c=&exp=&sig=` (en-têtes `no-store`,
  `nosniff`). Lien falsifié : 403 ; expiré : 410.
- Sans stockage branché (R2 pas activé), le dépôt de PDF répond 503 « stockage-absent » ; le reste marche.

## API

| Route | Rôle |
| --- | --- |
| `GET /resumes/boite?statut=&team=&type=&du=&au=&deposePar=&nouveaux=1&tri=` | Boîte de réception (toutes teams accessibles) |
| `GET/POST /teams/:t/resumes` | Résumés terminés lisibles / déposer |
| `GET /teams/:t/resumes/miens` | Historique de mes dépôts |
| `GET/POST /teams/:t/resumes/types`, `PATCH/DELETE …/types/:id` | Types de réunion |
| `GET/PATCH/DELETE /teams/:t/resumes/:id` | Détail (historique des PDF) / statut / retrait |
| `POST /teams/:t/resumes/:id/vu` | Marquer « Vu » |
| `PUT /teams/:t/resumes/:id/pdf` | Déposer ou remplacer le PDF (corps binaire, en-tête `X-Nom-Fichier`) |
| `POST /teams/:t/resumes/:id/lien` | Lien signé temporaire (`fichierId` : ancienne version, rédacteurs) |

Événements (bus outbox → journal + notifications ; Discord en phase 4) : `meeting.submitted`,
`meeting.status_changed`, `meeting.summary_published`, `meeting.deleted`, `meeting_type.created|updated|deleted`.

Tables (migration `esport/migrations/0003_resumes_objectifs.sql`) : `types_reunion`, `reunions`, `fichiers`.
