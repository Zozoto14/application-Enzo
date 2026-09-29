# D'où viennent les cours

## Le constat qui décide de tout

**Aucun fournisseur commercial ne couvre Euronext Paris sur son palier
gratuit.** Ce n'est pas une malchance sur l'un d'eux, c'est la règle.

| Fournisseur | Palier gratuit | Vos valeurs |
|---|---|---|
| Financial Modeling Prep | États-Unis | *This value set for `symbol` is not available* |
| Twelve Data | Temps réel US, 3 marchés | Euronext à partir de 29 $/mois |
| Stooq | — | Refuse les appels programmatiques |
| **Yahoo Finance** | Sans clé, sans inscription | **Fonctionne** |

Vérifié le 24 septembre 2026 sur les deux valeurs réellement détenues.

## Le fournisseur retenu : Yahoo Finance

```
https://query1.finance.yahoo.com/v8/finance/chart/STLAP.PA?range=1d&interval=1d
```

Un symbole par appel, aucune clé, aucun quota annoncé. La réponse porte le
cours dans `chart.result[0].meta.regularMarketPrice`, l'horodatage dans
`regularMarketTime`, et la devise — utile pour vérifier qu'on interroge bien
la bonne place.

C'est le seul fournisseur dont le mapping vienne d'**une vraie réponse** plutôt
que d'une documentation. Il est donc le seul à ne pas porter le drapeau
`provisoire`.

### Ce qu'il faut accepter

Cette interface n'est **ni documentée ni officielle**. Yahoo peut la modifier
ou la fermer du jour au lendemain, sans préavis et sans recours.

Trois choses limitent la casse :

1. Le système de fournisseurs est piloté par configuration. En changer tient
   dans une quinzaine de lignes, pas dans une réécriture.
2. L'application sait déjà dire « cours inconnu » et **exclure la ligne du
   total** plutôt que de la valoriser à zéro.
3. La procédure de secours ci-dessous ne dépend de personne.

## Le repli : ré-importer l'export du courtier

Votre export de positions BoursoBank contient une colonne `lastPrice`, et
**l'import l'enregistre déjà comme cours**. C'est ce qui fait que le tableau de
bord affiche une valorisation juste dès le premier import, sans « cours
inconnu ».

Donc : **ré-importer l'export met les cours à jour.**

1. BoursoBank → Portefeuille → Exporter les positions
2. Dans l'application : **Importer des positions**, coller le fichier
3. L'aperçu annonce ce qui va être écrit avant de l'écrire

C'est manuel, mais ce sont les prix de votre courtier — donc exactement ceux
sur lesquels vous serez imposé — et rien là-dedans ne peut cesser de
fonctionner.

## Charger l'historique d'un coup

**Réglages → Charger deux ans d'historique.**

Sans cela, l'application n'accumule qu'un point par rafraîchissement : les
onglets Performances et Risque restent muets plusieurs mois, le temps
d'atteindre les trente relevés d'une corrélation ou les quatre-vingt-dix jours
d'une annualisation. Le chargement les rend utiles le premier jour.

### Clôture brute, jamais ajustée

Yahoo rend deux séries. `adjclose` retraite le passé pour neutraliser
dividendes et divisions — c'est la bonne série pour mesurer un rendement, et la
mauvaise ici.

L'application enregistre vos dividendes comme des **opérations à part
entière** : ils entrent dans les liquidités et dans la performance par ce
chemin. Reprendre une série ajustée les compterait une seconde fois et
gonflerait le résultat d'autant. C'est donc `close` qui est retenue : ce que la
ligne valait vraiment ce jour-là.

### Ce que ça ne gère pas

Les **divisions d'actions**. Une série brute traversant une division montre une
chute qui n'a pas eu lieu, et l'application ne modélise pas les divisions. Si
l'une de vos valeurs en connaît une, l'historique d'avant sera faux, et la
performance avec.

C'est une limite assumée, pas un oubli : la traiter demanderait un type
d'opération supplémentaire et une reprise du rejeu. À faire le jour où le cas
se présente réellement.

## Le piège des symboles

Un ISIN ne désigne **pas** une place de cotation. La même société s'échange sur
plusieurs marchés, à des cours différents, dans des devises différentes.

La recherche par ISIN de Yahoo le montre crûment :

| ISIN | Ce que Yahoo renvoie |
|---|---|
| `LU1681043599` | `CW8.PA` — Paris. Correct. |
| `NL00150001Q9` | `STLAM.MI` (Milan), `NL00150001Q9.SG` (Stuttgart). **Paris absent.** |

Une résolution automatique aurait donc valorisé Stellantis sur Milan : même
société, autre marché, autre cours, et un écart invisible dans les totaux.

**Le symbole ne se devine pas, il se confirme.** L'application propose les
candidats et vous demande lequel est le bon ; elle ne choisit jamais seule.

Pour Euronext Paris, le suffixe est `.PA` :

| Valeur | Symbole |
|---|---|
| Stellantis | `STLAP.PA` |
| Amundi MSCI World | `CW8.PA` |

## Le quota, et pourquoi il ne pose plus problème

Seuls les **titres détenus** sont interrogés — une liste de surveillance de
cent lignes épuiserait un quota sans rien apporter au portefeuille. Sur quatre
lignes, un rafraîchissement coûte quatre appels.

Yahoo n'annonce pas de quota. Si un fournisseur à clé revient un jour dans la
boucle, le calcul reste le même : deux briefings par jour plus quelques
ouvertures manuelles, soit largement sous les 250 requêtes quotidiennes de
n'importe quel palier gratuit.
