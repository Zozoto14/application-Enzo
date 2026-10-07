# Cœur métier

Code pur : aucune dépendance à React Native, au stockage ou au réseau. Tout est
testable en ligne de commande, sans émulateur ni Mac.

```
money/      arithmétique décimale exacte
domain/     modèle de données
portfolio/  rejeu du journal, valorisation, répartition
tax/        PEA, CTO, simulateur de vente
import/     lecture CSV et conversion en transactions
```

```bash
npx jest src/core
```

## Décisions structurantes

**Aucun flottant.** Tous les montants passent par `Decimal`, adossé à des
BigInt avec 8 décimales fixes. En IEEE 754, `0.1 + 0.2 !== 0.3` : sur un PRU,
l'erreur se propage jusqu'à l'impôt estimé. La conversion en `number` n'a lieu
qu'à l'affichage.

**Le journal des transactions est la seule source de vérité.** Positions, PRU,
cash et plus-values ne sont jamais stockés : ils sont recalculés en rejouant le
journal (`portfolio/engine.ts`). Corriger une saisie ancienne ne peut donc pas
laisser un solde incohérent derrière elle. Une seule traversée produit les trois
vues, ce qui interdit qu'un PRU affiché diverge du PRU utilisé pour l'impôt.

**PRU en moyenne pondérée, pas en FIFO.** C'est la règle française
(art. 150-0 D du CGI). Les frais d'acquisition majorent le prix de revient, les
frais de cession minorent le produit de la vente.

**Taux de change figés sur la transaction.** Rejouer le journal deux ans plus
tard doit redonner exactement les mêmes chiffres, ce qui exclut d'appliquer un
taux courant. C'est aussi la règle fiscale pour le prix de revient d'un titre
étranger.

**Une vente dans un PEA n'est jamais imposée.** L'impôt naît au *retrait*, et
son assiette n'est pas la plus-value du titre vendu mais une quote-part du gain
du plan entier :

```
assiette = retrait × (valeur liquidative − versements nets) / valeur liquidative
```

Arbitrer à l'intérieur du plan ne coûte donc rien. Le simulateur le dit
explicitement (`impositionDifferee`) plutôt que d'afficher un impôt fictif.

**Un import n'échoue jamais en bloc.** Une ligne illisible est écartée et
rapportée avec son numéro, son contenu brut et la cause. Sur un relevé de
plusieurs centaines de lignes, tout rejeter pour une cellule vide rendrait la
fonction inutilisable.

## Limites assumées

Les calculs fiscaux sont des **estimations indicatives** destinées à préparer
une décision, jamais une déclaration officielle.

Non traités : abattements pour durée de détention (titres acquis avant 2018),
CSG déductible de 6,8 % en cas d'option pour le barème, report des moins-values
sur 10 ans, quotient familial, retraits anticipés de PEA pour motif particulier
(licenciement, invalidité, retraite, création d'entreprise).

## Point ouvert

`MODELE_BOURSOBANK` (`import/modeles.ts`) est marqué `provisoire: true`. Ses
noms de colonnes et ses libellés d'opération sont une **hypothèse**, pas une
spécification vérifiée : ils n'ont jamais été confrontés à un export réel. La
mécanique d'import est testée, le modèle ne l'est pas.

Pour le fiabiliser, il faut un vrai export CSV BoursoBank (même anonymisé, même
partiel) afin de relever les intitulés exacts, le séparateur, le format de date
et de nombre, et la présence ou non d'une colonne de frais distincte. Tant que
ce n'est pas fait, l'interface doit afficher l'avertissement porté par le
drapeau `provisoire`.
