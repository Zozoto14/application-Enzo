# Sécurité

```
aleatoire.ts           source d'aléa injectable
encodage.ts            base32 RFC 4648 et Crockford, comparaison à temps constant
kdf.ts                 dérivation de clé Argon2id
coffre.ts              chiffrement à enveloppe, codes de récupération, secret TOTP
codes-recuperation.ts  génération et normalisation des codes
totp.ts                codes TOTP (RFC 6238)
politique.ts           raccourci Face ID, temporisation après échecs
```

```bash
npx jest src/securite
```

Tout est en JavaScript pur (`@noble/hashes`, `@noble/ciphers`) : aucun module
natif, donc exécutable et testable sur le PC comme sur l'appareil.

## Le mot de passe ne chiffre pas la base

Il chiffre une **clé maîtresse** tirée au hasard, et c'est elle qui chiffre la
base. Cette indirection n'est pas un raffinement, elle résout deux problèmes
autrement insolubles :

**Changer de mot de passe** ne demande que de rechiffrer 32 octets. Sans
enveloppe, il faudrait déchiffrer puis rechiffrer toute la base, avec le risque
de tout perdre si l'opération est interrompue.

**Les codes de récupération** peuvent ouvrir la même base. Chaque code chiffre
sa propre copie de la clé maîtresse. Perdre son mot de passe cesse d'être une
perte de données — exactement ce que demande le cadrage.

Le coffre lui-même n'est pas secret : sans mot de passe ni code, ses enveloppes
sont inexploitables. Il peut être stocké en clair, sauvegardé et synchronisé
comme n'importe quel fichier.

Chaque enveloppe est scellée par XChaCha20-Poly1305. Une clé fausse ne produit
pas des octets aléatoires : elle fait échouer la vérification d'intégrité.
Vérifier un mot de passe ne demande donc aucun témoin stocké à côté, et une
enveloppe altérée est détectée plutôt que de livrer une clé silencieusement
fausse.

## Ce que le TOTP protège, et ce qu'il ne protège pas

**Le code TOTP ne protège pas le fichier de base.** Il faut le dire clairement,
parce que l'intuition suggère le contraire.

La clé de chiffrement dérive du mot de passe seul. Elle ne peut pas dépendre du
code TOTP, qui change toutes les trente secondes : une clé qui changerait avec
lui rendrait la base illisible. Qui détient le fichier **et** le mot de passe
peut donc l'ouvrir avec n'importe quel outil SQLCipher, sans jamais croiser
l'écran de saisie du code.

Ce que le TOTP protège réellement : l'accès **par l'application**, sur un
appareil déverrouillé. C'est un contrôle utile — il couvre le cas de quelqu'un
qui connaît le mot de passe et a l'appareil en main — mais c'est un contrôle
d'interface, pas de chiffrement.

Le secret TOTP est scellé par la clé maîtresse, donc absent en clair du coffre.

Le même raisonnement vaut pour le **code envoyé par courriel** prévu au
cadrage pour autoriser un nouvel appareil : la vérification a lieu dans le code
de l'application, que l'attaquant peut contourner, et la clé d'API d'envoi
embarquée dans une application installée localement est extractible. Contrôle
d'interface, là encore.

La protection réelle des données au repos repose entièrement sur : la force du
mot de passe, Argon2id, et le chiffrement SQLCipher.

## Paramètres Argon2id

Minimum recommandé par l'OWASP : 19 MiB de mémoire, 2 passes, 1 fil. Mesuré à
**~160 ms sur PC** ; compter environ une seconde sur iPhone en JavaScript pur.
Acceptable pour un déverrouillage, qui n'arrive qu'à l'ouverture.

Les paramètres sont stockés **dans chaque enveloppe**, pas figés dans le code.
Un coffre créé aujourd'hui reste ouvrable après qu'on les aura durcis — sinon
le durcissement enfermerait les données dehors.

## Codes de récupération

80 bits d'entropie, alphabet Crockford (sans I, L, O ni U), présentés en quatre
groupes de quatre. La normalisation absorbe casse, tirets, espaces et les
confusions de lecture usuelles. Ces codes sont recopiés à la main depuis une
feuille de papier, souvent des mois plus tard : un « 0 » lu « O » ne doit pas
condamner l'accès.

Chaque code est consommé à l'usage. `regenererCodesRecuperation` les remplace
tous d'un coup.

## TOTP

Implémenté plutôt qu'importé : quarante lignes, spécifiées par une RFC qui
publie ses propres vecteurs de test. **Les six vecteurs de l'annexe B de la
RFC 6238 sont vérifiés par les tests**, ce qui prouve l'interopérabilité avec
Google Authenticator autrement que par déclaration.

## À faire avant la mise en service

**Le polyfill d'aléa.** `crypto.getRandomValues` n'existe pas dans le moteur
JavaScript de React Native. Installer `react-native-get-random-values` et
l'importer **au tout premier point d'entrée du bundle**, avant tout autre
import. Sans lui, la génération de clés échoue bruyamment — ce qui vaut mieux
qu'un aléa silencieusement prévisible.

**Le branchement SQLCipher.** `cleHexadecimale()` produit la clé au format
attendu (`PRAGMA key = "x'...'"`). Reste à la passer au pilote op-sqlite, qui
n'est pas encore écrit.

**Face ID.** `politique.ts` décide *quand* le raccourci biométrique est
acceptable ; l'appel à l'API biométrique d'iOS reste à brancher. À garder en
tête : Face ID ne produit aucune clé. Il ne peut que débloquer une clé
maîtresse déjà en mémoire, d'où la fenêtre de validité courte.

**Un audit.** Ce code est testé, pas audité. Pour un usage personnel c'est un
niveau raisonnable ; ça ne vaut pas revue par un tiers compétent.
