# Persistance

```
pilote.ts      contrat d'accès à SQLite
schema.ts      DDL et migrations
depots.ts      traduction lignes SQL <-> objets du domaine
pilotes/node.ts      pilote de test, adossé au SQLite intégré à Node
pilotes/op-sqlite.ts pilote de l'application, adossé à SQLCipher
```

```bash
npx jest src/db
```

## Le SQL est testé pour de vrai

Rien ici ne dépend d'une bibliothèque SQLite particulière : tout passe par
l'interface `PiloteSqlite`. Les tests l'implémentent avec `node:sqlite`,
intégré à Node 22+, donc **le schéma, les contraintes et les requêtes sont
exécutés sur un vrai moteur SQLite, sur le PC, sans module natif ni
émulateur**. Ce sont les mêmes requêtes qui tourneront sur l'iPhone.

Le pilote Node n'est pas réexporté par `index.ts` : l'application ne doit pas
l'embarquer, `node:sqlite` n'existant pas dans le moteur JavaScript de
l'appareil.

## Montants en TEXT

Les montants, quantités et cours sont stockés en `TEXT`, relus par `Decimal`.

`REAL` serait un flottant et réintroduirait dans la base l'erreur que `Decimal`
élimine dans le code. `INTEGER` en centimes conviendrait aux montants mais pas
aux quantités fractionnaires ni aux cours à plusieurs décimales. Une chaîne
décimale est exacte, lisible dans un dump, et insensible à la plateforme.

## La base refuse les données irrejouables

Les contraintes `CHECK` interdisent d'enregistrer un achat sans titre, sans
quantité ou sans prix : ces lignes feraient échouer le moteur de rejeu plus
tard, loin de leur cause. Mieux vaut le refus à l'écriture.

Les clés étrangères sont actives (`PRAGMA foreign_keys`, à réarmer à chaque
ouverture de connexion, SQLite ne le mémorise pas). Supprimer un compte
supprime ses transactions ; supprimer un titre encore mouvementé est refusé.

À la lecture, une ligne malgré tout incohérente lève une `ErreurPersistance`
nommant la colonne fautive, plutôt que de produire un objet à moitié valide.

## Migrations

Repérées par `user_version`, le compteur que SQLite maintient dans l'en-tête du
fichier. Chaque migration s'applique dans sa propre transaction. `migrer()` est
idempotent : il n'applique que ce qui manque.

Pour faire évoluer le schéma, ajouter une entrée à `MIGRATIONS` avec la version
suivante. Ne jamais modifier une migration déjà livrée : les bases existantes
l'ont déjà appliquée.

## Le pilote de l'application

`pilotes/op-sqlite.ts` est écrit contre les **types réels** d'op-sqlite, pas
contre une API supposée : le compilateur vérifie à chaque build que
`executeSync` est bien synchrone, qu'`open` accepte bien une `encryptionKey`,
et que `rows` est bien un tableau d'objets.

Ce qui reste non vérifié tant qu'un build appareil n'a pas eu lieu : le
comportement à l'exécution. D'où `verifierChiffrement()`, appelé à chaque
ouverture : op-sqlite se compile avec ou sans SQLCipher, et sans cette
vérification une base prétendument chiffrée s'ouvrirait **en clair** sans que
rien ne le signale.

Le chiffrement n'apparaît pas dans le contrat `PiloteSqlite` à dessein : la
clé est consommée par le pilote à l'ouverture, et rien au-dessus n'a besoin
d'en connaître l'existence.
