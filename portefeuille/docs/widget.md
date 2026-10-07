# Pourquoi il n'y a pas de widget

Décision prise, et documentée ici pour qu'elle ne soit pas reprise à zéro dans
six mois.

Le cadrage prévoyait un widget d'écran d'accueil affichant la valeur du
portefeuille et la performance du jour. Il a été écarté.

## Deux obstacles techniques

**L'entitlement App Groups n'est pas délivré aux équipes personnelles.**

Un widget s'exécute dans un processus séparé de l'application. Il n'a accès ni
à sa base, ni à sa clé de chiffrement — ce qui est souhaitable. Le seul canal
prévu par Apple est un conteneur partagé, déclaré par la capacité *App
Groups*.

Or cette capacité est validée au niveau du certificat mais pas au niveau du
profil de provisionnement pour un identifiant Apple gratuit. Sans conteneur
partagé, le widget n'a rien à afficher. Et sa seule présence peut faire
échouer la signature de toute l'application.

**Chaque extension consomme un identifiant d'application.**

Un widget est un second bundle, donc un second identifiant, sur un quota de
dix par semaine pour un compte gratuit. Plusieurs tentatives de build
pourraient bloquer la reconstruction de l'application elle-même pendant sept
jours — un risque disproportionné sur une session de Mac unique.

## Une raison de fond, qui vaudrait même si ça marchait

Le conteneur partagé **ne peut pas être chiffré** par la clé du portefeuille :
le widget ne l'a pas, et c'est précisément ce qui protège les données.

La valeur du portefeuille deviendrait donc lisible par quiconque accède au
système de fichiers de l'appareil, et visible par-dessus l'épaule sur l'écran
d'accueil. Il n'existe pas de version « widget chiffré » : c'est le prix de
tout widget, quel qu'il soit.

Pour un projet dont la priorité affichée est la confidentialité, le confort ne
le justifiait pas.

## Ce qui le remplace

Une **notification** affichant la valeur du portefeuille et la variation du
jour.

- Aucune extension, aucun identifiant supplémentaire, aucun entitlement.
- La donnée ne quitte jamais l'application : la notification est composée
  depuis la base déchiffrée, au moment où elle est produite.
- C'est ce que le cadrage appelait par ailleurs le « briefing matin/soir ».

Elle ne remplace pas un coup d'œil permanent, mais elle répond à la même
question — *combien vaut mon portefeuille aujourd'hui ?* — sans aucun des
obstacles ci-dessus.

## Si l'on revenait sur cette décision

Il faudrait un compte Apple Developer payant, et un nouveau build, donc un
accès à macOS. Le squelette Swift a été écrit puis retiré du dépôt ; il est
récupérable dans l'historique git, au commit `0cd0913`.
