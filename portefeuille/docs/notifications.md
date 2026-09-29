# Notifications et réveil périodique

## Le problème que ça résout

Une notification locale programmée à l'avance porte un **texte figé au moment
où on la programme**. Si l'application programmait lundi soir un briefing pour
mardi 8 heures, ce briefing annoncerait la valeur de lundi soir.

Pour dire la vérité, l'application doit se réveiller mardi matin, rafraîchir
les cours, puis composer le message. C'est tout l'objet du réveil périodique.

## Ce que fait iOS, et ce qu'il ne fait pas

iOS ne permet pas à une application de s'exécuter quand elle veut. Il propose
un marché : l'application se déclare intéressée par des réveils, et le système
la réveille **quand il le juge bon**.

Ce que le système prend en compte : la charge de la batterie, la connexion
réseau, et surtout **votre habitude d'usage**. Une application que vous ouvrez
tous les matins est réveillée volontiers ; une application oubliée depuis
trois semaines l'est de moins en moins.

Conséquences concrètes, qu'il faut accepter :

- **Le réveil n'arrive pas à l'heure demandée.** Un briefing prévu à 8 heures
  peut partir à 8 h 10, à 9 h 30, ou pas du tout ce jour-là.
- **La fréquence minimale est d'environ un quart d'heure**, et c'est un
  plancher, pas une garantie.
- **Rien ne se déclenche si le téléphone est éteint.**

## Comment l'application s'en accommode

La planification ne dit pas « envoie à 8 heures ». Elle répond à une autre
question, posée **à chaque réveil, quel qu'en soit le moment** :

> Un briefing est-il dû aujourd'hui, et n'a-t-il pas déjà été envoyé ?

Trois règles en découlent.

**Une heure prévue, pas une heure d'envoi.** À chaque réveil, l'application
compare l'heure courante aux heures configurées du jour. Si l'heure est
passée, le briefing part.

**Un briefing par jour et par moment.** Chaque briefing porte un identifiant
qui contient la date et le moment — `briefing-2026-09-21-matin`. Une fois
envoyé, il ne repart pas, même si le système réveille l'application dix fois
dans la matinée.

**Une tolérance de quatre heures.** Passé ce retard, le briefing est
abandonné plutôt qu'envoyé. Un « avant ouverture » qui arrive à 23 heures ne
rend service à personne, et entame la confiance dans tous les suivants. Cette
durée est modifiable.

## Ce qu'il faut pour que ça marche

Trois choses, toutes réunies :

| | |
|---|---|
| `@notifee/react-native` | Afficher la notification |
| `react-native-background-fetch` | Être réveillé |
| Réglages `Info.plist` | Autoriser le réveil |

Les deux modules sont embarqués. Les réglages `Info.plist` sont à poser
pendant la session Mac — voir [build-ios.md](build-ios.md), étape 4.

**Si le réveil manque**, l'application fonctionne toujours : les briefings
partiront avec les valeurs connues à la dernière ouverture. L'écran des
réglages le signale explicitement plutôt que de laisser croire à des chiffres
du jour.

## Si un jour ça ne suffit pas

Votre cadrage prévoyait une solution de repli : un **Raspberry Pi ou un
mini-PC allumé en permanence**, qui vérifierait les cours à intervalle
régulier et déclencherait l'envoi au bon moment.

C'est la seule façon d'obtenir un horaire réellement respecté et une alerte
proche du temps réel sur un mouvement de cours. iOS ne le permettra jamais à
une application seule. À garder pour plus tard : rien dans l'architecture
actuelle ne s'y oppose.

## Les horaires par défaut

| Jour | Matin | Soir |
|---|---|---|
| Lundi, mardi | 08:00 | 17:30 |
| Mercredi, jeudi, vendredi | 09:00 | 18:30 |
| Samedi, dimanche | coupé | coupé |

Le week-end est coupé parce que les marchés sont fermés : un briefing du
samedi répéterait celui du vendredi soir. Tout est modifiable jour par jour
dans **Notifications**, y compris la réactivation du week-end.

## Les alertes de cours

Indépendantes des briefings, elles se déclenchent au **franchissement** d'un
seuil, pas au simple dépassement.

La nuance compte : sans elle, une valeur durablement sous son seuil bas
alerterait à chaque vérification. Au bout de trois jours, vous couperiez les
notifications — et perdriez aussi celles qui comptent.

Elles portent sur les valeurs **détenues** et sur celles de la **liste de
surveillance** — surveiller une valeur qu'on ne possède pas encore est
précisément le cas où une alerte sert le plus.
