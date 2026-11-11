# IA de l'Esport : moteurs d'API (NVIDIA, Claude…), ordre de repli, tâches

L'Esport peut utiliser **quatre moteurs d'IA**, essayés dans un **ordre de repli** propre à chaque tâche :

| Moteur | Réglage | Exemple conseillé |
| --- | --- | --- |
| `api` — **API principale** | `IA_API_URL`, `IA_API_CLE`, `IA_MODELE` | NVIDIA `mistralai/mistral-large-4-1t-a52b` (gros modèle, raisonnement, lit les images) |
| `api2` — **API secondaire** | `IA_API2_URL`, `IA_API2_CLE`, `IA_MODELE2` | NVIDIA `openai/gpt-oss-20b` (rapide, pour les tâches légères) |
| `claude` — **Claude (Anthropic)** | `ANTHROPIC_API_KEY`, `IA_CLAUDE_MODELE`, `IA_CLAUDE_MODELE_LEGER` (voir [partie 2 ter](#2-ter-claude-api-anthropic)) | Claude Sonnet 5.5 (`claude-sonnet-5-5`), payant à l'usage, lit les images ; **jamais les tâches confidentielles** |
| `local` — **IA locale** | `IA_LOCALE_*` (voir [ia-locale.md](ia-locale.md)) | Qwen2.5-7B sur le serveur (gratuite, lente, rien ne sort du serveur) |

Tout service « chat completions » compatible OpenAI convient (NVIDIA build.nvidia.com, OpenAI, Mistral, Gemini,
DeepSeek, Groq…). Code : `esport/noyau/ia/connecteur.mjs` ; Administration : **Esport › Administration › Jeux › Administration IA**.

> **Confidentialité** : les données envoyées à un service externe (API principale, secondaire ou Claude) **quittent le
> serveur** (noms de jeux, profils, pages lues, textes à traduire ou à corriger). Seule l'IA locale garde tout sur le
> serveur. L'Administration IA l'affiche.

## 1. Les lignes de `~/.appdashboard/esport.env`

**Jamais de clé dans le dépôt, les tests, la doc ou les journaux.** Les valeurs ci-dessous sont **factices** :
remplacez `nvapi-REMPLACER-…` par vos clés (build.nvidia.com › votre modèle › « Get API Key » ; une clé par modèle).

```ini
# IA de l'Esport (docs/esport/ia-api.md) : jamais dans le dépôt.
# Moteur principal : NVIDIA, Mistral Large (profils de jeu : brouillons, vérifications)
IA_API_URL=https://integrate.api.nvidia.com/v1
IA_API_CLE=nvapi-REMPLACER-cle-du-modele-principal
IA_MODELE=mistralai/mistral-large-4-1t-a52b
# Moteur secondaire : NVIDIA, gpt-oss-20b (traductions, posts CM ; JAMAIS les réunions, voir partie 2 bis)
IA_API2_URL=https://integrate.api.nvidia.com/v1
IA_API2_CLE=nvapi-REMPLACER-cle-du-modele-secondaire
IA_MODELE2=openai/gpt-oss-20b
# Ordres de repli (facultatifs : ce sont les valeurs par défaut ; l'Administration IA peut les changer)
IA_ORDRE=api,api2,local
IA_ORDRE_LEGER=api2,api,local
```

Puis redémarrez l'app Esport (cPanel › **Setup Node.js App** › **Restart**, ou
`touch ~/application-enzo/esport/tmp/restart.txt`). Le cron et le processus de fond relisent le fichier seuls.

Lignes facultatives (le suffixe `API2` règle le secondaire de la même façon) :

| Ligne | Effet |
| --- | --- |
| `IA_API2_URL` | Vide : même adresse que `IA_API_URL`. |
| `IA_FOURNISSEUR` / `IA_FOURNISSEUR2` | `nvidia`, `openai`, `mistral`, `gemini`, `deepseek`, `groq`, `autre` ; déduit de l'adresse sinon (`integrate.api.nvidia.com` → `nvidia`). `IA_FOURNISSEUR=local` met l'IA locale en tête de l'ordre des profils par défaut. |
| `IA_API_DELAI_S` | Durée maximale d'une réponse (défaut 90 s ; **300 s** pour un modèle à raisonnement ; 10 à 1800). |
| `IA_API_EFFORT` | `low`, `medium`, `high` : `reasoning_effort` envoyé ; `aucun` : rien. Défaut : celui du profil du modèle (Mistral Large 4 : `high` ; gpt-oss : `low`). |
| `IA_API_FLUX` | `oui` : réponse en flux (SSE), pour les très longues réponses (le raisonnement ne coupe pas la connexion). |
| `IA_IPV4` | `oui` : connexions aux API en **IPv4 seulement** (hébergeur dont l'IPv6 sortante est cassée ; commun aux deux moteurs). |
| `IA_API_IMAGES` | `oui` / `non` : le modèle lit-il les images (défaut : profil du modèle ; Mistral Large 4 : oui). |
| `IA_ORDRE` | Ordre de repli des **profils de jeu** (défaut `api,api2,local`). |
| `IA_ORDRE_LEGER` | Ordre de repli des **tâches légères** (défaut `api2,api,local`). Sans effet sur les tâches confidentielles (réunions : IA locale seulement, partie 2 bis). |
| `IA_RECHERCHE` | `serveur` (défaut), `modele`, `aucune` : voir [profils-jeu.md](profils-jeu.md). |

Un moteur sans clé (ou sans modèle) est simplement **ignoré** dans l'ordre de repli.

## 2. Ordre de repli et tâches

Deux catégories de tâches, chacune avec son ordre (réglé dans **Administration IA › Ordre de repli** ; à défaut,
`IA_ORDRE` / `IA_ORDRE_LEGER`) :

| Tâche (`discuterPour`) | Catégorie | Défaut |
| --- | --- | --- |
| `brouillon`, `verification`, `sources`, `test`, `profils` | **profils** | API principale (Mistral Large) → secondaire → IA locale |
| `traduction`, `ecriture` (assistant d'écriture, partie 5 bis), `cm`, `leger` (et toute tâche inconnue non confidentielle) | **leger** | API secondaire (gpt-oss-20b) → principale → IA locale |
| `transcription`, `correction`, `resumes`, `suivi`, `strats` (et alias : voir 2 bis) | **confidentielle** | **IA locale seulement**, quel que soit l'ordre |

**Quand passe-t-on au moteur suivant ?** Quand le moteur est absent (pas de clé), en panne (5xx, injoignable, délai
dépassé, réponse illisible), **limité par le fournisseur (HTTP 429)**, à son **plafond mensuel** (Administration IA),
ou qu'il ne lit pas les images d'une demande qui en contient. Une erreur de la **demande elle-même** (400 du serveur
Esport : nom manquant…) n'est pas répétée ailleurs.

**HTTP 429 (limite de débit NVIDIA)** : on attend le temps indiqué par `Retry-After` (sinon 2 s) et on réessaie
**une fois** sur le même moteur si l'attente ne dépasse pas 15 s ; sinon (ou si c'est encore 429) on passe tout de
suite au moteur suivant.

**Profils de jeu** : un brouillon (ou une vérification) se fait avec un « groupe » de moteurs : les API qui se suivent
dans l'ordre forment un groupe (consignes complètes, repli de l'une à l'autre à chaque appel) ; l'IA locale est un
groupe à elle seule (consignes compactes, brouillon en 4 étapes). Si tout le groupe échoue, le **travail entier est
repris** avec le groupe suivant. Un repli vers l'IA locale est confié au **processus de fond** (le travail repasse
« en attente », avec les moteurs déjà essayés dans `demande.exclus`) : l'app Passenger ne calcule jamais en local.

L'ancien réglage « Moteur de l'IA » (IA locale / Clé API / Locale d'abord) reste accepté par l'API (`mode`) : il fixe
l'ordre des profils (`local` → `local` ; `api` → `api,api2` ; `local-api` → `local,api,api2`).

## 2 bis. Confidentialité : ce qui ne quitte JAMAIS le serveur

Décision du Fondateur (30 octobre 2026) : « Non, ce n'est pas OK que ça envoie mes réunions à NVIDIA. »

Le **contenu des réunions** (audio, transcription brute, texte relu, résumés, PDF), les **notes du staff / suivi des
joueurs** et les **strats** ne sont **jamais envoyés à un service externe** par défaut. La règle est dans le
connecteur lui-même (`esport/noyau/ia/confidentialite.mjs`, appliquée par `creerRepartiteurIa`) :

| Tâche confidentielle | Noms acceptés par `discuterPour` | Moteurs |
| --- | --- | --- |
| `transcription` | `transcription`, `audio` (et l'API audio externe, voir [transcription.md](transcription.md)) | IA locale seulement |
| `correction` | `correction`, `relecture`, `correction-transcription` | IA locale seulement |
| `resumes` | `resume`, `resumes`, `reunion`, `reunions`, `pre-resume` | IA locale seulement |
| `suivi` | `suivi`, `suivi-joueurs`, `notes-staff`, `notes` | IA locale seulement |
| `strats` | `strats`, `strat`, `playbook` | IA locale seulement |

Par prudence, **tout nom de tâche qui contient** « transcri », « reunion », « résum », « meeting », « suivi », « staff »,
« strat », « playbook », « correction » ou « relecture » est aussi traité comme confidentiel.

- Pour ces tâches, `discuterPour` n'essaie **que l'IA locale**, **indépendamment** de `IA_ORDRE`, `IA_ORDRE_LEGER`, de
  l'ordre choisi dans l'Administration IA, et même si l'appelant impose `cible: 'api2'` ou `moteurs: ['api']`.
- Sans IA locale prête (pas installée, ou « indisponible sur cet hébergement » parce que l'hébergeur la tue) : refus
  `503 ia-confidentielle-sans-local` (« … Rien n'a été envoyé à un service externe. »), **aucun appel réseau**. La
  relecture des transcriptions est alors simplement **absente** (voir [transcription.md](transcription.md)).
- **Peuvent partir chez le fournisseur** (aucune donnée de réunion) : **profils de jeu** (brouillons, vérifications,
  sources), **traductions**, **assistant d'écriture** (texte tapé dans un champ non confidentiel, partie 5 bis),
  **textes des posts CM**, **devblog** (rédigé à partir des messages de commit nettoyés,
  voir [devblog.md](devblog.md)).

**Lever la règle (Fondateur seulement, tâche par tâche)** : Administration IA › carte **« Confidentialité : ce qui
quitte le serveur »** › interrupteur **« Autoriser l'envoi à un service externe »** (désactivé par défaut, avertissement
et confirmation). Stocké en base (`ia_reglages`, ligne `externe_<tâche>` = `1`), **journalisé** (événement
`ia.confidentialite_changed` dans le journal d'activité, plus une ligne au journal du serveur). Toute autre valeur, ou
une base illisible, vaut **refus**. API : `PUT /jeux/ia/reglages` `{ "externes": { "correction": true } }` (403 pour
tout autre compte que le Fondateur).

**Claude n'est jamais concerné par la levée** : même autorisée par le Fondateur, une tâche confidentielle ne part que
vers `api` / `api2`, jamais vers `claude` (règle `MOTEURS_JAMAIS_CONFIDENTIELS` du répartiteur, et garde-fou dans le
connecteur Claude lui-même : refus `503 ia-confidentielle-externe`, rien n'est envoyé).

Tests : `esport/test/ia-confidentialite.test.mjs` (échoue si une tâche confidentielle peut atteindre `api` / `api2`) et
`esport/test/ia-claude.test.mjs` (échoue si une tâche confidentielle peut atteindre Claude, même levée).

## 2 ter. Claude (API Anthropic)

Moteur `claude` : l'API d'Anthropic par le **SDK officiel** `@anthropic-ai/sdk` (dépendance de `esport/package.json`,
installée par le déploiement : `npm install --omit=dev` dans `esport/` quand `package.json` change). Le SDK passe par
le même transport Node que NVIDIA (`fetchIaNode`, option `fetch` du client). Code : `configClaude` et
`creerConnecteurClaude` dans `esport/noyau/ia/connecteur.mjs`.

### Mise en route (Fondateur)

1. **Clé d'API** : [console.anthropic.com](https://console.anthropic.com) › **API Keys** › **Create Key** (un nom, par
   ex. « esport-hq ») ; copiez la clé (`sk-ant-…`), elle ne s'affiche qu'une fois. **Ne la collez jamais dans un chat,
   un ticket ou le dépôt.**
2. **Facturation** : Console › **Billing** : Claude est **payé à l'usage** (crédits prépayés ou carte). Sans crédit,
   les appels échouent (`ia-credit`) et l'ordre de repli passe au moteur suivant. Le **plafond mensuel** de
   l'Administration IA (défaut 100 appels) limite la dépense côté app ; une limite de dépense peut aussi se régler
   dans la Console.
3. **Fichier `~/.appdashboard/esport.env`** : cPanel › **Gestionnaire de fichiers** › dossier `.appdashboard` (cochez
   « Afficher les fichiers cachés » dans Paramètres) › `esport.env` › **Modifier**, ajoutez :

   ```ini
   # Claude (Anthropic) : docs/esport/ia-api.md, partie 2 ter. Jamais dans le dépôt.
   ANTHROPIC_API_KEY=sk-ant-REMPLACER-par-votre-cle
   # Claude d'abord, NVIDIA (gpt-oss) en secours, pour les profils de jeu et les tâches légères
   IA_ORDRE=claude,api2
   IA_ORDRE_LEGER=claude,api2
   ```

   (Pour garder NVIDIA en premier : `IA_ORDRE=api,api2,claude` / `IA_ORDRE_LEGER=api2,claude`.)
4. **Redémarrer** l'app Esport : cPanel › **Setup Node.js App** › **Restart**.
5. **Vérifier** : Administration IA › moteur **Claude (Anthropic)** › **Tester Claude (Anthropic)**. Si un ordre de
   repli a déjà été réglé dans l'Administration IA, il l'emporte sur `IA_ORDRE` : ajoutez-y Claude (bouton
   « Ajouter Claude (Anthropic) », puis la flèche pour le monter) ou cliquez « Ordre par défaut ».

### Lignes facultatives

| Ligne | Effet |
| --- | --- |
| `IA_CLAUDE_MODELE` | Modèle des tâches normales (profils de jeu). Défaut **`claude-sonnet-5-5`**. |
| `IA_CLAUDE_MODELE_LEGER` | Modèle des tâches légères (traductions, posts CM, devblog). Défaut **`claude-sonnet-5-5`**. |
| `IA_CLAUDE_EFFORT` | Effort (`output_config.effort`) des tâches normales : `low`, `medium` (défaut), `high`, `xhigh`, `max`. |
| `IA_CLAUDE_EFFORT_LEGER` | Effort des tâches légères : défaut `low` (ou `IA_CLAUDE_EFFORT` s'il est réglé). |
| `IA_CLAUDE_DELAI_S` | Durée maximale d'une réponse (défaut 120 s, de 30 à 600). |
| `IA_CLAUDE_ESSAIS` | Nouveaux essais du SDK après 429, 529, 5xx ou coupure (défaut 2, de 0 à 5), avant de passer au moteur suivant. |
| `IA_CLAUDE_REPLI_SERVEUR` | `non` : pas de repli côté Anthropic après un refus du modèle (défaut : actif sur Sonnet 5.5 et Opus 5.5). |

**Choix du modèle et prix** (par million de jetons, entrée / sortie ; la réflexion du modèle compte en sortie) :

| Modèle | `IA_CLAUDE_MODELE…` | Prix | Pour |
| --- | --- | --- | --- |
| Claude Sonnet 5.5 (défaut) | `claude-sonnet-5-5` | 2 $ / 10 $ | bon équilibre qualité / prix, tout usage |
| Claude Opus 5.5 | `claude-opus-5-5` | 4 $ / 20 $ | profils de jeu les plus difficiles (`IA_CLAUDE_MODELE=claude-opus-5-5`) |
| Claude Haiku 5.5 | `claude-haiku-5-5` | 0,10 $ / 0,50 $ (requêtes de 100 000 jetons au plus) | tâches légères au moindre coût (`IA_CLAUDE_MODELE_LEGER=claude-haiku-5-5`) |

Pour baisser le coût sans changer de modèle, baissez l'effort (`IA_CLAUDE_EFFORT=low`) : c'est le réglage qui fait le
plus varier la réflexion, donc le temps et le prix.

### Requêtes envoyées (règles des modèles Claude 5.5)

- `model` (normal ou léger selon la tâche), `max_tokens` **16 000** au moins (la réflexion compte dedans ; au-delà de
  16 000 demandés, réponse **en flux** puis `finalMessage()`), `output_config.effort`, `system` à part.
- **Jamais** `thinking` (`{type: "disabled"}` ou un budget = HTTP 400 sur ces modèles : la réflexion adaptative est
  active par défaut, l'effort la règle), **jamais** `temperature`, `top_p`, `top_k` (refusés par la version actuelle de
  l'API ; retirés même si l'appelant en donne), **jamais** de `tool_choice` forcé, **aucun pré-remplissage** (un dernier
  message « assistant » est retiré).
- Sortie JSON : avec un schéma (`options.schema`), `output_config.format` (sortie structurée) ; sinon une ligne de
  consigne « Réponds uniquement par un objet JSON valide ». Un 400 avec le format le retire (et s'en souvient).
- **Repli côté Anthropic** après un refus du modèle (Sonnet 5.5 et Opus 5.5) : `fallbacks: "default"` avec l'en-tête
  bêta `server-side-fallback-2026-07-01`. Un 400 (bêta non ouverte au compte) le retire et s'en souvient.
- Réponse : **seuls les blocs `text`** sont lus (les blocs de réflexion sont ignorés, jamais journalisés).
  `stop_reason: "max_tokens"` sans texte ou avec un JSON coupé → `ia-reponse-tronquee` ; `stop_reason: "refusal"` →
  `ia-refus` et **moteur suivant**.
- Erreurs (classes typées du SDK) : 401 → `ia-cle-refusee` « Clé Anthropic invalide… » ; 403 → `ia-cle-refusee` ;
  402 → `ia-credit` ; 404 → `ia-modele` ; 429 → essais du SDK puis `ia-limite-fournisseur` ; 529 / 5xx / réseau →
  `ia-injoignable` ; délai → `ia-delai`. Toutes passent au moteur suivant de l'ordre. Le SDK envoie la clé dans
  l'en-tête `Authorization` ; elle n'est jamais renvoyée par l'API de l'app ni journalisée.

## 3. Spécificités NVIDIA et modèles à raisonnement

- **Détection** : adresse `https://integrate.api.nvidia.com/v1` → fournisseur `nvidia` (en-tête
  `Authorization: Bearer <clé>`, endpoint `/chat/completions` ajouté tout seul).
- **Profils de modèles** (`PROFILS_MODELES` du connecteur) :
  - `mistralai/mistral-large-4…` : raisonnement, `reasoning_effort: "high"` (test de connexion : `low`),
    `temperature 0.5`, `top_p 1`, lit les images ;
  - `openai/gpt-oss-…` : raisonnement, `temperature 1`, `top_p 1`, `reasoning_effort: "low"` (NVIDIA l'accepte ;
    **sans lui**, avec la sortie JSON forcée, une réponse pouvait dépasser 90 s alors que `low` répond en < 1 s :
    c'était la cause du test « API secondaire » en échec `ia-delai · 90 s`).
  - Modèle à raisonnement : `max_tokens` d'au moins **4096** (le raisonnement en consomme) et délai de **5 min**
    (2 min au moins ; le test de connexion est plafonné à **90 s**, et à **30 s pour le premier octet**).
- **`reasoning_content`** (raisonnement renvoyé à côté de `message.content`, ex. gpt-oss) : **ignoré**. Seul
  `content` est la réponse ; le raisonnement n'est jamais lu comme la réponse ni copié dans un journal (seule sa
  taille peut y figurer). Les blocs `<think>…</think>` laissés dans `content` sont retirés.
- **Sortie JSON** : `response_format: {"type": "json_object"}` est envoyé ; si le modèle le refuse (HTTP 400), la
  requête est refaite sans et le connecteur s'en souvient (la consigne demande du JSON, et l'extraction tolère du
  texte autour ou un bloc de code). Même chose pour `reasoning_effort` refusé.
- **Réponse coupée** (`finish_reason: "length"` sans contenu, ou avec un JSON incomplet quand du JSON est demandé) :
  code `ia-reponse-tronquee` (jamais un texte coupé rendu comme une réponse). Option `formatJson: false` : pas de
  `response_format`, le JSON est demandé par la consigne seulement (devblog automatique).
- **Flux** (`IA_API_FLUX=oui`) : lecture SSE (`delta.content` seulement ; `delta.reasoning_content` ignoré), en-tête
  `Accept: text/event-stream`. La lecture s'arrête dès `data: [DONE]` (même si le serveur garde la connexion ouverte) ;
  un flux fermé sans `finish_reason` ni `[DONE]` est une réponse interrompue (`ia-reponse`). Un flux servi sans le type
  `text/event-stream` est reconnu à son contenu (`data: …`).
- **Transport** (serveur Node) : `esport/adaptateurs/fetchIaNode.mjs` (node:https, une connexion neuve par requête)
  mesure chaque **étape** : DNS, connexion TCP, TLS, premier octet (début de la réponse : sans flux, c'est tout le
  calcul du modèle), fin. Connexion (DNS + TCP + TLS) : 15 s au plus. Les étapes vont au journal de l'app pour un test
  de connexion, une réponse de plus de 20 s et toute erreur (jamais la clé, ni un corps de requête ou de réponse).

## 4. Images (modèles multimodaux)

Pour lire plus tard une capture de bracket ou de résultat :

```js
import { creerIaDepuisEnv, messageAvecImages } from '../noyau/ia/connecteur.mjs';
const ia = creerIaDepuisEnv(process.env);
const r = await ia.discuterPour('leger', [
  { role: 'system', content: 'Answer with ONE JSON object only.' },
  messageAvecImages('Lis le score de ce match : {"equipes": [], "score": ""}', ['data:image/png;base64,…']),
]);
```

`messageAvecImages(texte, images)` construit `content: [{type: "text"}, {type: "image_url", image_url: {url}}]`
(4 images au plus : `data:image/png|jpeg|webp|gif;base64,…` de 4 Mo au plus, ou adresse https). Seuls les moteurs qui
lisent les images (`images: true` : Mistral Large 4, ou `IA_API_IMAGES=oui`) les reçoivent ; les autres sont sautés
(`ia-image-non-geree` si aucun). L'IA locale ne lit pas les images.

## 5. Utiliser l'IA depuis un autre module (traductions, CM ; réunions : IA locale seulement)

```js
// Avec la base (app, cron) : ordre de l'Administration IA, appels comptés et plafonnés par moteur.
const r = await servicesJeux({ base, ia, ... }).discuterPour('traduction', messages, { json: false, maxJetons: 800 });

// Sans le service (processus de fond de la transcription…) : ordre de l'environnement ; `externeAutorise` lit
// les levées du Fondateur (sans lui : rien n'est autorisé, tâche confidentielle = IA locale seulement).
import { creerIaDepuisEnv, creerConnecteurLocal } from '../noyau/ia/connecteur.mjs';
import { autorisationsDepuisBase } from '../noyau/ia/confidentialite.mjs';
const ia = creerIaDepuisEnv(process.env, { local: connecteurLocal, externeAutorise: autorisationsDepuisBase(base) });
const { texte, moteur } = await ia.discuterPour('correction', messages, { json: false }); // moteur === 'local'
```

- `discuterPour(tache, messages, options)` → `{ texte, jetons, dureeMs, moteur }`. Options : celles du connecteur
  (`json` défaut `true`, `maxJetons`, `temperature`, `effort`, `delai`, `flux`, `essais429`, `schema` pour l'IA locale)
  et `cible` (un seul moteur) ou `moteurs` (ordre imposé pour cet appel, ex. `['api2', 'local']`).
- `json: false` pour un texte libre (traduction, post) ; sinon la réponse est un objet JSON à lire avec
  `extraireJson(texte)` (jamais exécuté, toujours validé).
- **Un module qui traite du contenu de réunion, de suivi ou de strats doit passer un nom de tâche confidentiel**
  (partie 2 bis) : c'est ce nom qui garde le texte sur le serveur.
- Erreurs : `ErreurEsport` au code stable (`ia-confidentielle-sans-local`, `ia-non-configuree`, `ia-locale-absente`, `ia-limite-fournisseur`,
  `ia-cle-refusee`, `ia-requete-refusee`, `ia-modele`, `ia-delai`, `ia-injoignable`, `ia-reponse`,
  `ia-reponse-tronquee`, `ia-image-non-geree`, `quota-ia`…), dont le message ne contient jamais la clé.
- Les API existantes restent : `configIa(env)`, `creerConnecteur(config).discuter(messages, options)`,
  `creerConnecteurLocal(...)`, `extraireJson`.

## 5 bis. Assistant d'écriture (corriger, traduire, reformuler un message)

Demande du Fondateur (11 novembre 2026) : « Mets une IA qui permet de corriger mes fautes quand j'écris des messages,
exemple dans les tickets etc., et aussi je peux lui demander de traduire mon texte en anglais quand j'en ai besoin. »

**Dans l'app** : sous les champs de message, une petite barre **Corriger** · **Traduire en anglais** · **⋯**
(**Traduire en français**, **Reformuler poliment**), icônes monochromes. Raccourci sur le web : **Ctrl+Maj+K**
(Cmd+Maj+K sur Mac) = Corriger, quand le curseur est dans le champ. **Rien ne part sans un clic** (ou le raccourci) :
jamais de correction automatique. Le résultat s'affiche en **aperçu** (changements surlignés mot à mot : barré = retiré,
surligné = ajouté ou corrigé ; une traduction est montrée telle quelle) avec **Remplacer**, **Insérer en dessous**
(pratique pour un message bilingue FR + EN) et **Annuler** ; après un remplacement, **Annuler le remplacement** remet
le texte d'avant. Sous l'aperçu : « Texte envoyé à l'IA (Claude) pour correction » (moteur réellement utilisé).

**Où il apparaît** : réponse à un ticket, message d'une mention de ticket (« Mentionner »), messages automatiques,
accueil et panneaux des tickets (Configuration), texte des posts CM (FR et EN), description et commentaires des cartes
CM, modèle des messages Discord d'une team (annonces planning, résultats…), introduction et conclusion du devblog,
description d'un événement du club, description d'un événement du planning, description d'une team, et
**Administration › Messagerie** du hub (message FR et EN : le hub ouvre la même session Esport que pour l'annuaire, avec
le jeton maître du Fondateur ; le relais, lui, n'a pas d'IA).

**Confidentialité** :

- **Seul le texte du champ** part, jamais la conversation du ticket, le titre de la carte ni aucun autre contexte.
- **Jamais sur un champ confidentiel** : notes, transcriptions et résumés de réunion (y compris les réunions CM), notes
  du staff et suivi des joueurs, strats et playbook, **notes internes des tickets**, journal. Le bouton n'y est pas, et
  le serveur refuse de toute façon (`403 ecriture-confidentielle`) : il n'accepte que la liste fermée `CHAMPS_ECRITURE`
  de `esport/noyau/ia/ecriture.mjs` (un champ inconnu : `400 ecriture-champ`).
- **Réponses aux tickets : permises, par décision explicite du Fondateur** (elles sont publiques pour l'auteur du ticket ;
  la tâche confidentielle « tickets » couvre les conversations, notes internes et transcripts, que l'assistant n'envoie
  jamais). Voir aussi [tickets.md](tickets.md).
- Tâches du répartiteur : `ecriture` (corriger, reformuler) et `traduction`, toutes deux **légères** et **non
  confidentielles** (le nom `correction` est réservé à la relecture des transcriptions, confidentielle : l'assistant ne
  l'emploie pas). Ordre : celui des tâches légères (Administration IA). Avec Claude : modèle et effort des tâches
  légères (`IA_CLAUDE_MODELE_LEGER`, effort `low`), jamais de température ni de réflexion désactivée.

**Éléments protégés** : mentions `<@id>`, `<@!id>`, rôles `<@&id>`, salons `<#id>`, emojis personnalisés `<:nom:id>`,
horodatages `<t:…>`, liens, blocs et morceaux de code, `@everyone` / `@here`, variables `{pseudo}` / `{{team}}`,
@mentions de l'app, codes d'emoji `:smile:` et emojis Unicode sont remplacés par des marqueurs `⟦n⟧` **avant** l'envoi
(l'IA ne les voit pas) puis remis. Un marqueur perdu, dupliqué ou inventé → `422 ecriture-proteges` ; un nombre de
lignes ou de délimiteurs Markdown (`**`, `__`, `~~`, `||`) changé → `422 ecriture-format` : **rien n'est remplacé**,
l'utilisateur réessaie. La consigne demande de corriger seulement l'orthographe, la grammaire, la ponctuation et les
accents (ton, registre et sens gardés), une traduction naturelle, et de garder le vocabulaire esport (scrim, tryhard,
noms de maps, d'agents, de jeux, pseudos) ; le texte est traité comme une donnée, jamais comme une consigne.

**Limites** : 6000 caractères par demande (`413 ecriture-trop-long`), **30 demandes par minute et par compte**
(`429 trop-de-requetes`), et chaque appel à une API **compte dans le plafond mensuel du moteur** (au plafond du dernier
moteur : `429 ecriture-quota`) ; IA absente ou en panne : `503 ecriture-indisponible`.

**Qui peut s'en servir : par défaut, LE FONDATEUR SEUL** (décision du Fondateur, 11 novembre 2026). Pour tous les
autres, les boutons sont **cachés** (pas seulement grisés) et le serveur refuse aussi (`403 ecriture-permission`).
Administration IA › carte **« Assistant d'écriture »** : l'activer ou non (activé par défaut), puis **ajouter des
rôles** — **Rôles du club** (Second CEO, staff des tickets, devblog, événements…), **Équipe CM**, **Staff des teams**
(Propriétaire, Manager, Coach, Analyste), **Joueurs et autres membres des teams** ; aucun coché par défaut — et/ou
**ajouter des personnes** une à une (liste des membres ; « Retirer » pour enlever). Stocké dans `ia_reglages`
(`ecriture_actif`, `ecriture_groupes`, `ecriture_comptes`).

API (préfixe facultatif `/api/esport`) :

| Méthode | Chemin | Rôle |
| --- | --- | --- |
| `GET` | `/ia/ecriture` | `{ actif, autorise, disponible, champs, tailleMax, modes }` : l'app montre la barre si tout est vrai et le champ listé |
| `POST` | `/ia/ecriture` | `{ mode: corriger \| traduire-en \| traduire-fr \| reformuler, champ, texte }` → `{ texte, mode, moteur, fournisseur, inchange }` (rien n'est enregistré) |
| `GET` `PUT` | `/ia/ecriture/reglages` | Fondateur : `{ actif?, groupes?, comptes? }` (défaut : groupes et comptes vides = le Fondateur seul) |

Tests : `esport/test/ia-ecriture.test.mjs` (chaîne réelle avec un faux NVIDIA : seul le texte masqué part, éléments
protégés gardés ou refus, champs confidentiels, longueur, limite de débit, plafond, Fondateur seul par défaut, rôles et personnes ajoutés) et
`src/esport/Ecriture.test.tsx` (barre, aperçu, remplacer / insérer / annuler, masquée sur une note interne).

## 6. Administration IA

**Esport › Administration › Jeux › Administration IA** (Fondateur) :

- **Moteurs de l'IA** : pour chacun, fournisseur, modèle, clé **présente ou absente** (jamais sa valeur), modèle à
  raisonnement (effort), lecture d'images, appels et erreurs du mois, plafond, temps de réponse moyen, dernier appel,
  bouton **Tester** (un tout petit échange avec ce moteur seul), et l'avertissement de confidentialité. Claude
  affiche en plus le modèle et l'effort des tâches légères, sa **dernière latence** et sa **dernière erreur**
  (ex. `ia-cle-refusee`). Le test se fait
  **en tâche de fond** : la requête répond au plus après 10 s (`{ enCours, test: { id } }` s'il continue) et la page
  interroge `GET /jeux/ia/test/:id` toutes les 3 s ; avant, un modèle à raisonnement ou l'IA locale dépassait le délai
  de 15 s de l'app (« Le serveur Esport ne répond pas ») ;
- **Ordre de repli** : pour les profils de jeu et pour les tâches légères (monter, retirer, ajouter un moteur,
  revenir à l'ordre par défaut) ; il ne s'applique pas aux tâches confidentielles ;
- **Confidentialité : ce qui quitte le serveur** : la liste des tâches qui **restent sur le serveur** (réunions,
  transcription, relecture, résumés, suivi, strats : IA locale seulement) et de celles qui **peuvent partir chez le
  fournisseur** (profils de jeu, traductions, assistant d'écriture, posts CM) ; l'interrupteur du Fondateur (partie 2 bis) ;
- **Assistant d'écriture** : l'activer ; par défaut le Fondateur seul, ajouter des rôles ou des personnes (partie 5 bis) ;
- **Plafonds mensuels** : appels de l'API principale (défaut 30), de l'API secondaire (défaut 200), de Claude
  (défaut 100), vérifications (défaut 8). Au plafond, le moteur est sauté (le suivant prend le relais). L'IA locale n'a pas de plafond.

Base : `ia_appels.moteur` (migration 0034) ; réglages `ordre_profils`, `ordre_leger`, `quota_appels_api2`, `quota_appels_claude`,
`externe_<tâche>` (levée de la confidentialité) dans `ia_reglages`.

## 7. Tester sans appel réel

`node --test esport/test/ia-moteurs.test.mjs esport/test/ia-transport.test.mjs esport/test/ia-claude.test.mjs` (faux serveurs : détection NVIDIA, `reasoning_effort`,
`reasoning_content` ignoré, 429 → attente puis moteur suivant, ordre par tâche, plafond par moteur, images, clés
absentes de tout message et de tout journal). Sur le serveur, après avoir mis les clés : **Administration IA ›
Tester** sur chaque moteur.

## 8. Dépannage

### Outil de diagnostic (sur le serveur)

```bash
source /home/jayo8828/nodevenv/application-enzo/esport/22/bin/activate
cd ~/application-enzo
node esport/outils/tester-ia.mjs api2            # API secondaire (api : principale)
node esport/outils/tester-ia.mjs api2 --flux     # en flux SSE (comme IA_API2_FLUX=oui)
node esport/outils/tester-ia.mjs api2 --ipv4     # IPv4 seulement (comme IA_IPV4=oui)
node esport/outils/tester-ia.mjs api2 --effort aucun   # sans reasoning_effort (ancien comportement)
node esport/outils/tester-ia.mjs api2 --comme-curl     # corps minimal, pour comparer avec un curl
```

L'outil lit `~/.appdashboard/esport.env` **par le chargeur de l'app** (ne faites pas `source esport.env` : la ligne
`MAIL_FROM=Nom <adresse>` casse le shell), affiche la configuration (clé : **longueur et 6 premiers caractères
seulement**), les variables de mandataire présentes (curl suit `HTTPS_PROXY`, Node non), la résolution DNS, la requête
exacte (clé masquée), puis l'envoie trois fois : `fetch` (undici), `node:https` (DNS, connexion, TLS, premier octet,
fin, adresse IP) et le **connecteur de l'app** (test de connexion : message d'erreur exact). `--delai N` : délai de
chaque essai (défaut 90 s). Code de sortie 0 si tout va bien.

### Messages

| Message | Que faire |
| --- | --- |
| « Le service d'IA refuse la clé d'API (vérifiez IA_API_CLE / IA_API2_CLE) » | Clé fausse, révoquée, ou d'un autre modèle (NVIDIA : une clé par modèle). Recopiez-la, **Restart**. |
| « Modèle ou adresse inconnus… » | `IA_MODELE` / `IA_MODELE2` exactement comme sur build.nvidia.com (ex. `openai/gpt-oss-20b`). |
| « Le service d'IA limite les appels (quota ou débit…) » | Limite de débit NVIDIA (429) sur tous les moteurs de l'ordre : réessayez plus tard, ou ajoutez l'IA locale à l'ordre. |
| « Le service d'IA refuse la requête (HTTP 400)… » | Paramètre non accepté par ce modèle : essayez `IA_API_EFFORT=aucun`. |
| « Réponse du service d'IA incomplète (limite de jetons atteinte, raisonnement compris) » | `IA_API_EFFORT=medium` (moins de raisonnement), ou un autre modèle pour cette tâche. |
| `ia-dns` / `ia-delai-dns` | Nom introuvable ou DNS lent : vérifiez l'adresse ; lancez l'outil. |
| `ia-delai-connexion` / `ia-delai-tls` / `ia-tls` | Réseau de l'hébergeur : `IA_IPV4=oui`, puis l'outil (`--ipv4`) pour comparer. |
| `ia-delai-premier-octet` « n'a pas commencé à répondre » | Connexion faite, le modèle calcule encore : `IA_API2_EFFORT=low`, `IA_API2_FLUX=oui`, ou `IA_API2_DELAI_S` plus grand. |
| `ia-delai-lecture` | Réponse commencée puis bloquée : `IA_API2_FLUX=oui`, ou relancer. |
| « Clé Anthropic invalide… » (`ia-cle-refusee`, Claude) | Recopiez `ANTHROPIC_API_KEY` depuis la Console (clé non révoquée), **Restart**. |
| `ia-credit` (Claude) | Crédit épuisé : Console Anthropic › **Billing**. |
| `ia-modele` (Claude) | `IA_CLAUDE_MODELE` / `IA_CLAUDE_MODELE_LEGER` mal écrit (ex. `claude-sonnet-5-5`). |
| `ia-refus` (Claude) | Le modèle a refusé la demande : l'ordre de repli passe au moteur suivant (rien à faire). |
| `ia-sdk-absent` (Claude) | Le paquet `@anthropic-ai/sdk` manque : le prochain déploiement l'installe (ou `npm install --omit=dev` dans `esport/`). |
| `ia-test-sans-resultat` | Le processus de l'app a été redémarré pendant le test : relancez-le. |
| « Le service d'IA met trop de temps à répondre » (`ia-delai`) | `IA_API_DELAI_S=600`, ou `IA_API_FLUX=oui`. |
