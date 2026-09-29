# Synchronisation entre appareils

## Le principe

Vos deux appareils ne se parlent pas. Chacun tient sa propre base chiffrée, et
la synchronisation consiste à **échanger des archives** par un dossier partagé
— Syncthing, iCloud Drive, une clé USB, peu importe. Aucun serveur, aucun
compte, rien qui sorte de votre contrôle.

## Pourquoi c'est simple ici

Parce que le journal des opérations est la seule source de vérité.

Fusionner deux bases ne demande pas de réconcilier des soldes, des PRU ou des
plus-values : ce sont des valeurs **calculées**. Une fois les opérations
réunies, `rejouer()` les recalcule toutes. Il suffit donc de réunir les
opérations, et une opération ne se modifie jamais — on l'annule par une autre.

La fusion des transactions est donc une **union**, sans arbitrage.

## Ce qui a dû être corrigé avant

Un identifiant d'opération valait `op-<horodatage en millisecondes>`. Sur un
appareil, cela suffit. Sur deux, non : un iPhone et un iPad qui enregistrent
deux opérations **différentes** dans la même milliseconde produisaient le même
identifiant. La fusion, qui reconnaît les doublons par l'identifiant, en aurait
supprimé une — silencieusement, et le solde aurait été faux sans que rien ne le
signale.

La correction : chaque installation tire une fois un identifiant aléatoire de
huit caractères, le garde dans sa base chiffrée, et le place dans tout ce
qu'elle crée.

```
op-a1b2c3d4-lkj3h-0
   └ appareil └ instant └ compteur
```

Le compteur lève l'ambiguïté des créations dans la même milliseconde sur un
même appareil : saisir trois opérations d'affilée est plus rapide que l'horloge.

Cet identifiant n'est **ni un identifiant matériel ni un numéro de série** :
c'est un tirage aléatoire, sans lien avec le téléphone.

## Les conflits, et pourquoi on ne les tranche pas

Trois cas, traités différemment.

**Une opération présente d'un seul côté** — le cas normal. Elle est reprise.

**Une opération présente des deux côtés** — même identifiant, donc même
opération. Rien à faire.

**Un compte ou une valeur modifié des deux côtés** — le seul vrai conflit.
Vous avez renommé le même compte différemment sur les deux appareils. Il n'y a
pas de bonne réponse automatique : la version locale est conservée, et
**l'écart est signalé**, champ par champ.

Choisir en silence ferait découvrir la perte six mois plus tard, sur un chiffre
faux. Un conflit tu est un conflit qui coûte cher.

## L'ordre de rejeu

Le journal fusionné est trié par date, puis par identifiant à date égale.

Ce second critère n'est pas cosmétique : deux achats de la même valeur le même
jour donnent un PRU différent selon l'ordre où on les rejoue. Sans un ordre
**stable et identique sur les deux appareils**, l'iPhone et l'iPad afficheraient
deux prix de revient différents pour le même portefeuille.

## Ce qui n'est pas synchronisé

- **Les réglages** — planning de notifications, seuils, fournisseur de cours,
  clé d'API. Ils sont propres à chaque appareil, et c'est voulu : vous ne
  voulez pas forcément les mêmes briefings sur l'iPad que sur l'iPhone.
- **L'historique des cours.** Il se reconstruit tout seul au premier
  rafraîchissement, et le transporter alourdirait chaque archive pour rien.
- **L'identifiant d'appareil**, évidemment.

## En pratique

1. Sur l'appareil A : **Sauvegarde → Créer une sauvegarde**, avec son mot de
   passe.
2. Déposer l'archive dans le dossier partagé.
3. Sur l'appareil B : **Sauvegarde → Fusionner**, avec ce même mot de passe.

L'écran distingue deux gestes qui se ressemblent et dont les conséquences
n'ont rien à voir :

| | |
|---|---|
| **Fusionner** | Ajoute ce que vous n'avez pas. Rien n'est effacé. |
| **Restaurer** | Remplace tout par le contenu de l'archive. |

Pour la synchronisation, c'est **Fusionner**. Restaurer sert à retrouver un
appareil perdu, pas à tenir deux appareils à jour.

La fusion est **idempotente** : reprendre deux fois la même archive ne duplique
rien. Et si l'archive est incomplète — une opération qui renvoie à un compte
absent — elle est refusée *avant* d'écrire quoi que ce soit, avec un message
qui dit ce qui manque plutôt qu'une erreur de contrainte SQL.

## La limite honnête

Rien n'est automatique. Vous décidez quand exporter et quand reprendre. C'est
le prix d'une application sans serveur : personne d'autre que vous ne peut
déclencher l'échange.

Syncthing peut rendre le dépôt automatique — l'archive apparaît toute seule sur
l'autre appareil — mais la reprise restera un geste volontaire. Sur iOS,
Syncthing n'existe pas en application native ; le dossier partagé passera par
**Fichiers**, ou par un poste fixe qui fait le relais.
