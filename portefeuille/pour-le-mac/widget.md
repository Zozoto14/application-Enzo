# Widget d'écran d'accueil

Fourni prêt à coller, **à tenter en toute fin de session**, une fois
l'application installée et vérifiée. Avant de s'y engager, lire ce qui suit :
il y a de fortes chances que ce soit impossible dans votre configuration.

## Deux obstacles, dont un probablement bloquant

**1. L'entitlement App Groups n'est pas délivré aux équipes personnelles.**

Un widget s'exécute dans un processus séparé de l'application. Il n'a pas
accès à sa base, et surtout pas à sa clé de chiffrement — ce qui est
souhaitable. Le seul canal prévu par Apple est un **conteneur partagé**,
déclaré par la capacité *App Groups*.

Or cette capacité est validée au niveau du certificat mais **pas au niveau du
profil de provisionnement** pour un identifiant Apple gratuit. Pire : sa
présence peut faire échouer la signature de toute l'application.

Sans conteneur partagé, le widget n'a rien à afficher.

**2. Chaque extension consomme un identifiant d'application.**

Un widget est un second bundle, donc un second identifiant. Les comptes
gratuits sont limités à **dix identifiants par semaine**. Plusieurs tentatives
de build peuvent épuiser ce quota, et bloquer la reconstruction de
l'application elle-même pendant sept jours.

C'est la raison pour laquelle les outils de sideloading retirent
systématiquement les extensions widget de leurs paquets.

## Si vous tentez malgré tout

**Faites-le en dernier**, après que l'application fonctionne, que les secrets
soient notés et que les données soient importées. Un échec ne coûtera alors
qu'un peu de temps.

1. Dans Xcode : **File → New → Target → Widget Extension**, nommer
   `WidgetPortefeuille`, décocher *Include Live Activity* et *Include
   Configuration Intent*.
2. Remplacer le fichier Swift généré par
   `ios/WidgetPortefeuille/WidgetPortefeuille.swift` de ce dépôt.
3. Sur **les deux cibles** — application et extension — onglet *Signing &
   Capabilities*, ajouter la capacité **App Groups** et créer le groupe
   `group.com.applibourse.partage`.
4. Compiler.

**Si l'étape 3 ou 4 échoue** : supprimer la cible `WidgetPortefeuille`,
retirer la capacité App Groups de l'application, reconstruire. L'application
retrouve son état précédent, intact.

## Ce que le widget afficherait, et ce que ça coûte

Deux nombres et une date : valeur totale et variation du jour. Ni positions,
ni ISIN, ni historique — le strict nécessaire à l'affichage.

**Le conteneur partagé n'est pas chiffré par votre clé.** Il ne peut pas
l'être : le widget n'a pas cette clé, et c'est précisément ce qui protège vos
données. Conséquence à assumer : la valeur de votre portefeuille devient
lisible par quiconque accède au système de fichiers de l'appareil, et visible
par-dessus l'épaule sur votre écran d'accueil.

C'est le prix d'un widget, quel qu'il soit. Il n'existe pas de version
« widget chiffré ».

## L'alternative qui fonctionne à coup sûr

Une **notification quotidienne** affichant la valeur du portefeuille et la
variation du jour.

- Aucune extension, aucun identifiant supplémentaire, aucun entitlement :
  le module de notifications est déjà embarqué.
- La donnée ne quitte jamais l'application : la notification est composée au
  moment où elle est programmée, depuis la base déchiffrée.
- C'est d'ailleurs ce que prévoyait le cadrage sous le nom de « briefing
  matin/soir ».

Elle ne remplace pas un coup d'œil permanent, mais elle répond à la même
question — *combien vaut mon portefeuille aujourd'hui ?* — sans aucun des
obstacles ci-dessus.
