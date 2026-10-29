# IA de l'Esport : moteurs d'API (NVIDIA…), ordre de repli, tâches

L'Esport peut utiliser **trois moteurs d'IA**, essayés dans un **ordre de repli** propre à chaque tâche :

| Moteur | Réglage | Exemple conseillé |
| --- | --- | --- |
| `api` — **API principale** | `IA_API_URL`, `IA_API_CLE`, `IA_MODELE` | NVIDIA `mistralai/mistral-large-4-1t-a52b` (gros modèle, raisonnement, lit les images) |
| `api2` — **API secondaire** | `IA_API2_URL`, `IA_API2_CLE`, `IA_MODELE2` | NVIDIA `openai/gpt-oss-20b` (rapide, pour les tâches légères) |
| `local` — **IA locale** | `IA_LOCALE_*` (voir [ia-locale.md](ia-locale.md)) | Qwen2.5-7B sur le serveur (gratuite, lente, rien ne sort du serveur) |

Tout service « chat completions » compatible OpenAI convient (NVIDIA build.nvidia.com, OpenAI, Mistral, Gemini,
DeepSeek, Groq…). Code : `esport/noyau/ia/connecteur.mjs` ; Administration : **Esport › Jeux › Administration IA**.

> **Confidentialité** : les données envoyées à un service externe (API principale ou secondaire) **quittent le
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
# Moteur secondaire : NVIDIA, gpt-oss-20b (traductions, posts CM, post-correction des transcriptions)
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
| `IA_API_EFFORT` | `low`, `medium`, `high` : `reasoning_effort` envoyé ; `aucun` : rien. Défaut : celui du profil du modèle (Mistral Large 4 : `high` ; gpt-oss : rien). |
| `IA_API_FLUX` | `oui` : réponse en flux (SSE), pour les très longues réponses (le raisonnement ne coupe pas la connexion). |
| `IA_API_IMAGES` | `oui` / `non` : le modèle lit-il les images (défaut : profil du modèle ; Mistral Large 4 : oui). |
| `IA_ORDRE` | Ordre de repli des **profils de jeu** (défaut `api,api2,local`). |
| `IA_ORDRE_LEGER` | Ordre de repli des **tâches légères** (défaut `api2,api,local`). |
| `IA_RECHERCHE` | `serveur` (défaut), `modele`, `aucune` : voir [profils-jeu.md](profils-jeu.md). |

Un moteur sans clé (ou sans modèle) est simplement **ignoré** dans l'ordre de repli.

## 2. Ordre de repli et tâches

Deux catégories de tâches, chacune avec son ordre (réglé dans **Administration IA › Ordre de repli** ; à défaut,
`IA_ORDRE` / `IA_ORDRE_LEGER`) :

| Tâche (`discuterPour`) | Catégorie | Défaut |
| --- | --- | --- |
| `brouillon`, `verification`, `sources`, `test`, `profils` | **profils** | API principale (Mistral Large) → secondaire → IA locale |
| `traduction`, `cm`, `transcription`, `correction`, `leger` (et toute tâche inconnue) | **leger** | API secondaire (gpt-oss-20b) → principale → IA locale |

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

## 3. Spécificités NVIDIA et modèles à raisonnement

- **Détection** : adresse `https://integrate.api.nvidia.com/v1` → fournisseur `nvidia` (en-tête
  `Authorization: Bearer <clé>`, endpoint `/chat/completions` ajouté tout seul).
- **Profils de modèles** (`PROFILS_MODELES` du connecteur) :
  - `mistralai/mistral-large-4…` : raisonnement, `reasoning_effort: "high"` (test de connexion : `low`),
    `temperature 0.5`, `top_p 1`, lit les images ;
  - `openai/gpt-oss-…` : raisonnement, `temperature 1`, `top_p 1`, **pas** de `reasoning_effort` envoyé.
  - Modèle à raisonnement : `max_tokens` d'au moins **4096** (le raisonnement en consomme) et délai de **5 min**
    (2 min au moins, même pour un test).
- **`reasoning_content`** (raisonnement renvoyé à côté de `message.content`, ex. gpt-oss) : **ignoré**. Seul
  `content` est la réponse ; le raisonnement n'est jamais lu comme la réponse ni copié dans un journal (seule sa
  taille peut y figurer). Les blocs `<think>…</think>` laissés dans `content` sont retirés.
- **Sortie JSON** : `response_format: {"type": "json_object"}` est envoyé ; si le modèle le refuse (HTTP 400), la
  requête est refaite sans et le connecteur s'en souvient (la consigne demande du JSON, et l'extraction tolère du
  texte autour ou un bloc de code). Même chose pour `reasoning_effort` refusé.
- **Réponse coupée** (`finish_reason: "length"` sans contenu) : code `ia-reponse-tronquee`.
- **Flux** (`IA_API_FLUX=oui`) : lecture SSE (`delta.content` seulement ; `delta.reasoning_content` ignoré).

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

## 5. Utiliser l'IA depuis un autre module (traductions, CM, transcription)

```js
// Avec la base (app, cron) : ordre de l'Administration IA, appels comptés et plafonnés par moteur.
const r = await servicesJeux({ base, ia, ... }).discuterPour('traduction', messages, { json: false, maxJetons: 800 });

// Sans le service (processus de fond de la transcription…) : ordre de l'environnement.
import { creerIaDepuisEnv, creerConnecteurLocal } from '../noyau/ia/connecteur.mjs';
const ia = creerIaDepuisEnv(process.env, { local: connecteurLocal /* facultatif */, journal: (t, code) => log(t) });
const { texte, moteur } = await ia.discuterPour('transcription', messages, { json: false });
```

- `discuterPour(tache, messages, options)` → `{ texte, jetons, dureeMs, moteur }`. Options : celles du connecteur
  (`json` défaut `true`, `maxJetons`, `temperature`, `effort`, `delai`, `flux`, `essais429`, `schema` pour l'IA locale)
  et `cible` (un seul moteur) ou `moteurs` (ordre imposé pour cet appel, ex. `['api2', 'local']`).
- `json: false` pour un texte libre (traduction, post) ; sinon la réponse est un objet JSON à lire avec
  `extraireJson(texte)` (jamais exécuté, toujours validé).
- Erreurs : `ErreurEsport` au code stable (`ia-non-configuree`, `ia-locale-absente`, `ia-limite-fournisseur`,
  `ia-cle-refusee`, `ia-requete-refusee`, `ia-modele`, `ia-delai`, `ia-injoignable`, `ia-reponse`,
  `ia-reponse-tronquee`, `ia-image-non-geree`, `quota-ia`…), dont le message ne contient jamais la clé.
- Les API existantes restent : `configIa(env)`, `creerConnecteur(config).discuter(messages, options)`,
  `creerConnecteurLocal(...)`, `extraireJson`.

## 6. Administration IA

**Esport › Jeux › Administration IA** (Fondateur) :

- **Moteurs de l'IA** : pour chacun, fournisseur, modèle, clé **présente ou absente** (jamais sa valeur), modèle à
  raisonnement (effort), lecture d'images, appels et erreurs du mois, plafond, temps de réponse moyen, dernier appel,
  bouton **Tester** (un tout petit échange avec ce moteur seul), et l'avertissement de confidentialité ;
- **Ordre de repli** : pour les profils de jeu et pour les tâches légères (monter, retirer, ajouter un moteur,
  revenir à l'ordre par défaut) ;
- **Plafonds mensuels** : appels de l'API principale (défaut 30), de l'API secondaire (défaut 200), vérifications
  (défaut 8). Au plafond, le moteur est sauté (le suivant prend le relais). L'IA locale n'a pas de plafond.

Base : `ia_appels.moteur` (migration 0034) ; réglages `ordre_profils`, `ordre_leger`, `quota_appels_api2` dans
`ia_reglages`.

## 7. Tester sans appel réel

`node --test esport/test/ia-moteurs.test.mjs` (faux serveurs : détection NVIDIA, `reasoning_effort`,
`reasoning_content` ignoré, 429 → attente puis moteur suivant, ordre par tâche, plafond par moteur, images, clés
absentes de tout message et de tout journal). Sur le serveur, après avoir mis les clés : **Administration IA ›
Tester** sur chaque moteur.

## 8. Dépannage

| Message | Que faire |
| --- | --- |
| « Le service d'IA refuse la clé d'API (vérifiez IA_API_CLE / IA_API2_CLE) » | Clé fausse, révoquée, ou d'un autre modèle (NVIDIA : une clé par modèle). Recopiez-la, **Restart**. |
| « Modèle ou adresse inconnus… » | `IA_MODELE` / `IA_MODELE2` exactement comme sur build.nvidia.com (ex. `openai/gpt-oss-20b`). |
| « Le service d'IA limite les appels (quota ou débit…) » | Limite de débit NVIDIA (429) sur tous les moteurs de l'ordre : réessayez plus tard, ou ajoutez l'IA locale à l'ordre. |
| « Le service d'IA refuse la requête (HTTP 400)… » | Paramètre non accepté par ce modèle : essayez `IA_API_EFFORT=aucun`. |
| « Réponse du service d'IA incomplète (limite de jetons atteinte, raisonnement compris) » | `IA_API_EFFORT=medium` (moins de raisonnement), ou un autre modèle pour cette tâche. |
| « Le service d'IA met trop de temps à répondre » | `IA_API_DELAI_S=600`, ou `IA_API_FLUX=oui`. |
