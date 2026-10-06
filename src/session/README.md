# Session

```
stockage-coffre.ts  rangement du coffre (interface + implémentation mémoire)
stockage-sqlite.ts  rangement réel, dans une base SQLite non chiffrée
session.ts          enchaînement complet de l'ouverture de l'application
```

```bash
npx jest src/session
```

C'est la pièce qui relie les trois couches : le coffre produit la clé, la clé
ouvre la base, la politique décide si la tentative est seulement permise.
Aucune des trois ne connaît les autres — l'enchaînement est décidé ici, et
nulle part ailleurs.

## Le code TOTP ne peut pas être vérifié en premier

Contrainte découverte en écrivant l'enchaînement, et qui a tranché la question.

Le secret TOTP est scellé par la clé maîtresse, elle-même obtenue à partir du
mot de passe. Vérifier le code **suppose donc d'avoir déjà dérivé la clé**. Une
tentative au code faux coûte une dérivation Argon2id complète, environ une
seconde sur l'appareil.

L'alternative aurait été de ranger le secret TOTP en clair à côté du coffre
pour le vérifier d'abord, plus rapidement. Le coût — un secret d'authentifi­
cation lisible par quiconque récupère le fichier — est hors de proportion avec
le gain.

Conséquence assumée : l'écran de saisie doit prévenir que la vérification prend
un instant, sinon l'attente passera pour un plantage.

## Un seul message d'erreur pour deux causes

Mot de passe faux et code faux renvoient exactement le même message, ce qu'un
test vérifie. Dire lequel des deux facteurs a échoué indiquerait à un attaquant
qu'il tient le mot de passe et qu'il ne lui manque que le code — ou l'inverse.

Les deux comptent pour un échec dans la même temporisation.

## Cycle de vie

| Étape | Effet |
|---|---|
| `initialiser` | Crée coffre, secret TOTP et codes ; ouvre et migre la base |
| `deverrouiller` | Mot de passe puis code TOTP ; ouvre la base |
| `recuperer` | Consomme un code et impose un nouveau mot de passe |
| `verrouiller` | Ferme la base, efface la clé de la mémoire |
| `changerMotDePasse` | Exige l'ancien mot de passe, ne touche pas à la base |

`recuperer` impose de redéfinir un mot de passe dans la foulée : un code de
récupération sert à reprendre la main, pas à se passer durablement de mot de
passe.

`changerMotDePasse` repart du mot de passe fourni plutôt que de la clé déjà en
mémoire — sinon, un appareil déverrouillé et laissé sans surveillance
permettrait d'en changer sans connaître l'ancien.

## Deux bases, et pourquoi

Le coffre est rangé dans une base **non chiffrée**, distincte de celle du
portefeuille. Il ne peut pas vivre dans la base chiffrée : il faut le lire
pour obtenir la clé qui ouvre celle-ci. Il n'est pas secret pour autant — ses
enveloppes sont inexploitables sans mot de passe ni code de récupération.

SQLite plutôt qu'un fichier, parce qu'op-sqlite est déjà embarqué là où lire
un fichier demanderait un module natif de plus. Un coffre illisible lève une
erreur au lieu de passer pour une absence de coffre : confondre les deux
ferait proposer la création d'un nouveau coffre, écrasant le seul moyen de
déchiffrer les données.

## Déverrouillage : ce qui n'est PAS un mauvais mot de passe

- **Erreur technique.** Si la dérivation Argon2id ne peut pas tourner (mémoire
  refusée par le navigateur, paramètres illisibles), le coffre lève
  `ErreurCalculCle` : message propre (« Impossible de calculer la clé sur cet
  appareil… »), aucune tentative comptée. Les paramètres d'un coffre existant
  ne sont jamais allégés : ils sont scellés avec l'enveloppe, les changer
  exigerait la clé ; la parade est de déverrouiller depuis un autre appareil.
- **Saisie collée.** La forme BRUTE du mot de passe est essayée d'abord (rien
  n'a jamais été normalisé à la création : un mot de passe existant avec des
  espaces de bord, ou en NFD, s'ouvre exactement comme avant), puis sa forme
  NFC, puis NFC sans caractères invisibles ni espaces/retours à la ligne de
  bord. Au plus trois dérivations, UNE tentative comptée. Le code TOTP est
  réduit à ses chiffres (« 123 456 », chiffres pleine chasse).
- **Mot de passe changé sur le PC.** `coffresAlternatifs` (sur le site : le
  coffre publié sur le relais) est essayé si le coffre local refuse ; il est
  adopté seulement s'il ouvre la base d'ici (même clé maîtresse), sinon
  `ErreurCoffreDifferent` invite à relier le navigateur.
- **TOTP** : fenêtre ±1 pas (±30 s), pas d'anti-rejeu. Au-delà, l'écran compare
  l'horloge à celle du relais (`/heure`) et affiche l'écart s'il dépasse 20 s.

Un échec d'authentification garde son message unique, « Mot de passe ou code
incorrect », qui ne dit jamais quel facteur est faux (leurre compris).

## Ce que les tests couvrent, et ce qu'ils ne couvrent pas

Les tests injectent le pilote `node:sqlite`, qui **ignore la clé** : SQLCipher
n'existe pas dans Node. Ce sont donc l'enchaînement, la gestion de la clé et
les règles d'accès qui sont vérifiés — pas le chiffrement lui-même, couvert
séparément par les tests du coffre.

La vérification de bout en bout (base réellement illisible sans la clé)
n'arrivera qu'avec le pilote op-sqlite, sur appareil.
