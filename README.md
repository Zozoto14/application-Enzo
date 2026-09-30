# AppDashboard (ex-AppliBourse)

Suivi de portefeuille boursier, local et chiffré, pour iPhone et iPad.
Aucun serveur, aucune connexion bancaire automatique : saisie manuelle ou
import d'un export de courtier.

```bash
npm install
npx jest          # 402 tests
npx tsc --noEmit
npx eslint src App.tsx --ext .ts,.tsx
```

## Ce qui marche aujourd'hui

**Tout sauf l'exécution sur appareil.** Les quatre couches sont écrites et
testées de bout en bout sur PC : créer un compte, importer un portefeuille
réel, saisir une opération, voir les liquidités et les plus-values bouger.

Le seul obstacle restant est un **build iOS**, qui demande Xcode — donc un Mac
ou la VM Hackintosh prévue au cadrage. Le code natif est écrit et typé, il n'a
simplement jamais tourné.

## Organisation

| Dossier | Rôle | Détail |
|---|---|---|
| [`src/core`](src/core) | Calculs, fiscalité, imports | [README](src/core/README.md) |
| [`src/db`](src/db) | Schéma SQLite, dépôts, pilotes | [README](src/db/README.md) |
| [`src/securite`](src/securite) | Coffre de clés, TOTP, récupération | [README](src/securite/README.md) |
| [`src/session`](src/session) | Enchaînement de l'ouverture | [README](src/session/README.md) |
| [`src/ui`](src/ui) | Écrans et modèles de vue | [README](src/ui/README.md) |
| `src/app` | Assemblage et navigation | |

## Les décisions qui engagent le reste

**Aucun flottant nulle part.** Tous les montants passent par `Decimal`,
adossé à des BigInt. En IEEE 754, `0.1 + 0.2 !== 0.3` : sur un PRU, l'erreur
remonte jusqu'à l'impôt estimé. La base elle-même stocke des chaînes, pas des
`REAL`.

**Le journal des transactions est la seule source de vérité.** Positions, PRU,
cash et plus-values ne sont jamais stockés, ils sont recalculés en rejouant le
journal. Corriger une saisie ancienne ne peut donc pas laisser un solde faux
derrière elle.

**Le mot de passe ne chiffre pas la base.** Il chiffre une clé maîtresse
tirée au hasard, qui chiffre la base. Changer de mot de passe ne rechiffre
que 32 octets, et les codes de récupération peuvent ouvrir la même base —
perdre son mot de passe cesse d'être une perte de données.

**Une vente dans un PEA n'est jamais imposée.** Le fait générateur est le
retrait, dont l'assiette est une quote-part du gain du plan entier, pas la
plus-value du titre vendu.

**Le code TOTP ne protège pas le fichier de base.** La clé dérive du mot de
passe seul : qui détient le fichier et le mot de passe l'ouvre sans passer par
l'application. C'est un contrôle d'interface. Détail dans le
[README sécurité](src/securite/README.md).

## Vérifié contre des données réelles

Le calcul n'est pas seulement testé contre mes propres hypothèses :

- un **avis d'opéré BoursoBank** (achat STELLANTIS du 03/08/2026) : le moteur
  retrouve 102,39 € de prix de revient, au centime près le montant débité ;
- un **export « positions instantanées »** : le coût exact se retrouve par
  `amount - amountVariation`, ce qui évite les 6 centimes d'erreur du PRU
  affiché, arrondi au centime ;
- les **ISIN** sont validés clé de contrôle comprise, contre quatre valeurs
  réelles ;
- les **six vecteurs de test de la RFC 6238** pour le TOTP, ce qui prouve
  l'interopérabilité avec Google Authenticator.

## Ce qui reste

**Un build iOS.** `npx react-native run-ios` demande Xcode. Le chemin du
projet contient des espaces, ce qui casse CMake : le build Android échouera
probablement tant que le dépôt n'aura pas été déplacé vers un chemin sans
espace.

**Vérifier SQLCipher.** `verifierChiffrement()` refuse de continuer si
op-sqlite est compilé sans SQLCipher — sans quoi la base s'ouvrirait en clair
sans que rien ne le signale.

**Face ID.** `securite/politique.ts` décide quand le raccourci biométrique est
acceptable ; l'appel à l'API iOS reste à brancher.

**Le reste de la feuille de route** (V2 et V3 du cadrage) : fiscalité avancée,
performance TWR/MWR, dividendes, synchronisation Syncthing, alertes.

Site de secours : https://applibourse-ef0ddb.pages.dev (adresse dans `src/config/site.json`) ; publication et mises à jour automatiques : `docs/site-deploiement.md`.
Support (tickets vers Discord par le relais) : `docs/support-discord.md`.
