/**
 * Explications des indicateurs.
 *
 * Chaque chiffre affiché peut être accompagné de son explication. L'intention
 * n'est pas décorative : un portefeuille se pilote avec des mesures dont
 * beaucoup se ressemblent et disent des choses différentes. Confondre TWR et
 * TRI, ou plus-value latente et réalisée, conduit à de mauvaises décisions.
 *
 * Trois règles de rédaction :
 *  - dire à quoi sert la mesure avant de dire comment elle se calcule ;
 *  - donner un repère chiffré quand il existe, plutôt qu'une définition
 *    abstraite ;
 *  - signaler les pièges, parce que c'est là que l'explication sert vraiment.
 */

export interface Explication {
  titre: string;
  /** Une phrase, affichée en premier. */
  court: string;
  /** Le détail, affiché quand on déplie. */
  detail: string;
  /** Piège fréquent, mis en avant visuellement. */
  piege?: string;
}

export const EXPLICATIONS = {
  valeurTotale: {
    titre: 'Valeur totale',
    court: 'Ce que vaut votre portefeuille aujourd’hui, liquidités comprises.',
    detail:
      'Somme de la valeur de marché de chaque ligne, plus les espèces disponibles sur vos comptes. C’est le montant que vous obtiendriez, avant impôts et frais, en vendant tout aujourd’hui.',
  },

  plusValueLatente: {
    titre: 'Plus-value latente',
    court: 'Le gain que vous avez sur le papier, tant que vous n’avez pas vendu.',
    detail:
      'Différence entre la valeur de marché actuelle et le prix de revient. Elle bouge chaque jour avec les cours, et ne devient un gain réel qu’au moment de la vente.',
    piege:
      'Une plus-value latente n’est jamais imposée. Seule une vente déclenche l’impôt sur un compte-titres — et sur un PEA, même une vente ne le déclenche pas.',
  },

  plusValueRealisee: {
    titre: 'Plus-value réalisée',
    court: 'Le gain effectivement encaissé sur les titres déjà vendus.',
    detail:
      'Produit de la vente, frais déduits, moins le prix de revient des titres cédés. C’est cette somme qui entre dans le calcul de l’impôt sur un compte-titres.',
  },

  pru: {
    titre: 'PRU — prix de revient unitaire',
    court: 'Ce que vous a coûté, en moyenne, chaque titre que vous détenez.',
    detail:
      'Total dépensé, frais de courtage compris, divisé par le nombre de titres. Il sert de référence pour calculer la plus-value. En France, la règle fiscale impose la moyenne pondérée : chaque nouvel achat le recalcule sur l’ensemble de la ligne.',
    piege:
      'Certains outils proposent un PRU en FIFO, où l’on vend les titres les plus anciens d’abord. C’est une autre convention, et elle ne correspond pas à la règle fiscale française.',
  },

  totalReturn: {
    titre: 'Performance totale',
    court: 'Ce que votre portefeuille a gagné ou perdu depuis le début.',
    detail:
      'Compare la valeur actuelle à la somme réellement investie. Simple à lire, mais ne dit pas si le résultat vient de vos choix ou du moment où vous avez investi.',
  },

  twr: {
    titre: 'TWR — rendement pondéré par le temps',
    court: 'La performance de vos choix, indépendamment de vos versements.',
    detail:
      'Neutralise l’effet des versements et des retraits en chaînant les rendements de chaque sous-période. C’est la mesure qui permet de se comparer honnêtement à un indice : verser 10 000 € ne fait pas « monter » votre performance.',
    piege:
      'Un TWR calculé depuis une valorisation quasi nulle explose en milliers de pour cent. Quand c’est le cas, cette application refuse d’afficher le chiffre plutôt que d’en montrer un qui n’informe sur rien.',
  },

  tri: {
    titre: 'TRI — taux de rentabilité interne',
    court: 'Le rendement réel de l’argent que vous avez effectivement investi.',
    detail:
      'Tient compte du montant et de la date de chaque versement. Deux portefeuilles aux mêmes titres peuvent avoir des TRI très différents si l’un a investi avant une hausse et l’autre après. C’est la mesure la plus proche de votre expérience réelle.',
    piege:
      'Le TRI est annualisé par construction. Sur quelques semaines, il produit des chiffres absurdes — d’où son indisponibilité avant trois mois d’historique.',
  },

  cagr: {
    titre: 'Rendement annualisé',
    court: 'La performance ramenée à un rythme annuel, pour comparer des durées.',
    detail:
      'Répond à : « si ce portefeuille avait progressé au même rythme régulier, quel serait son rendement par an ? » Utile pour comparer deux placements de durées différentes.',
    piege:
      'Annualiser une période courte amplifie tout. Trois semaines de hausse donnent des rendements annuels à plusieurs chiffres, sans aucune valeur prédictive.',
  },

  drawdown: {
    titre: 'Drawdown — perte maximale',
    court: 'La pire chute subie depuis un sommet, avant de remonter.',
    detail:
      'Mesure ce que vous auriez perdu au plus mauvais moment. Plus parlant que la volatilité pour se demander : « aurais-je tenu sans vendre ? »',
  },

  volatilite: {
    titre: 'Volatilité',
    court: 'L’ampleur des variations de votre portefeuille.',
    detail:
      'Écart-type des rendements, ramené à une base annuelle. Une volatilité de 15 % signifie que, la plupart du temps, le portefeuille varie de plus ou moins 15 % sur un an.',
    piege:
      'La volatilité traite les hausses et les baisses de la même façon. Un portefeuille qui ne fait que monter fortement paraîtra « risqué ».',
  },

  sharpe: {
    titre: 'Ratio de Sharpe',
    court: 'Le rendement obtenu par unité de risque pris.',
    detail:
      'Divise le rendement excédentaire par la volatilité. Au-dessus de 1, le rendement rémunère correctement le risque. En dessous de 0,5, le portefeuille secoue beaucoup pour ce qu’il rapporte.',
  },

  correlation: {
    titre: 'Corrélation',
    court: 'À quel point vos lignes montent et descendent ensemble.',
    detail:
      'Va de -1 à 1. Proche de 1, vos titres bougent de concert et la diversification est illusoire. Proche de 0, ils sont indépendants et se compensent.',
    piege:
      'Détenir dix lignes ne diversifie rien si elles sont toutes corrélées à 0,9. Le nombre de lignes compte moins que leur indépendance.',
  },

  beta: {
    titre: 'Bêta',
    court: 'Votre sensibilité aux mouvements de la référence.',
    detail:
      'Un bêta de 1 signifie que vous suivez l’indice point pour point ; 1,3 que vous amplifiez ses mouvements de 30 % ; 0,6 que vous les amortissez. Il ne dit rien de la qualité de vos choix, seulement de leur amplitude.',
    piege:
      'Un bêta faible n’est pas une protection. Il mesure la part de vos variations que l’indice explique, pas le risque qu’il n’explique pas — une ligne qui s’effondre pour une raison qui lui est propre a un bêta de zéro.',
  },

  alpha: {
    titre: 'Alpha',
    court: 'Ce que vous gagnez au-delà de ce que la référence explique.',
    detail:
      'Votre performance moins celle que votre bêta laissait attendre, sur la période comparée. Positif, vos choix ont apporté quelque chose ; négatif, vous auriez mieux fait de détenir l’indice.',
    piege:
      'Sur quelques mois, l’alpha mesure surtout la chance. Il ne devient un signal qu’au bout de plusieurs années, et la plupart des portefeuilles finissent par converger vers zéro, frais déduits.',
  },

  concentration: {
    titre: 'Lignes équivalentes',
    court: 'Le nombre de lignes égales qui donnerait la même concentration.',
    detail:
      'Calculé à partir de l’indice de Herfindahl. Dix lignes dont une pèse 80 % « valent » 1,5 ligne : le chiffre traduit en une grandeur lisible ce que le simple décompte des lignes cache.',
    piege:
      'Le nombre de lignes ne mesure rien à lui seul. Trois lignes égales sont mieux réparties que dix lignes dont une écrase les autres.',
  },

  contributionRisque: {
    titre: 'Contribution au risque',
    court: 'La part de l’agitation du portefeuille imputable à chaque ligne.',
    detail:
      'Répartie au prorata du poids multiplié par la volatilité. Une ligne qui pèse 10 % mais bouge trois fois plus que les autres compte bien davantage dans les variations quotidiennes que son poids ne le laisse croire.',
    piege:
      'Approximation assumée : elle ignore les corrélations. Elle répond à « d’où vient l’agitation », pas à « quel est le risque exact du portefeuille », qui demanderait bien plus d’historique.',
  },

  rendementDividende: {
    titre: 'Rendement sur prix de revient',
    court: 'Ce que les dividendes rapportent, rapporté à ce que vous avez investi.',
    detail:
      'Dividendes des douze derniers mois divisés par le prix de revient. Calculé sur votre PRU plutôt que sur le cours du jour, il dit ce que la ligne vous rapporte réellement. Il ne bouge pas quand le cours bouge, et il monte avec les années si le dividende progresse.',
    piege:
      'Il ne se compare pas au rendement affiché par les sites boursiers, qui est le rendement courant. Un même titre peut afficher 3 % pour un acheteur d’aujourd’hui et 8 % pour vous, qui l’avez acheté il y a dix ans.',
  },

  rendementCourant: {
    titre: 'Rendement courant',
    court: 'Ce que les dividendes rapportent, rapporté à la valeur d’aujourd’hui.',
    detail:
      'Dividendes des douze derniers mois divisés par la valeur de marché actuelle. C’est ce qu’obtiendrait quelqu’un qui achèterait la ligne maintenant — donc la mesure utile pour décider d’un renforcement, pas pour juger ce que vous détenez déjà.',
    piege:
      'Un rendement courant qui grimpe est rarement une bonne nouvelle : le plus souvent, c’est le cours qui a chuté, pas le dividende qui a monté.',
  },

  retenueSource: {
    titre: 'Retenue à la source',
    court: 'L’impôt prélevé par le pays d’origine avant que le dividende vous parvienne.',
    detail:
      'Un dividende étranger est amputé avant versement — souvent 15 % après convention fiscale, parfois 30 % sans. L’écart entre le brut annoncé et le net encaissé le mesure. Sur un PEA, cette retenue n’est pas récupérable.',
    piege:
      'Un rendement annoncé par un site boursier est un rendement brut. Sur un titre étranger, ce que vous touchez réellement est plus bas.',
  },

  plafondPEA: {
    titre: 'Plafond de versement du PEA',
    court: '150 000 € de versements au maximum sur la durée de vie du plan.',
    detail:
      'Seuls les versements comptent, pas la valeur du portefeuille : un PEA peut valoir 200 000 € sans dépasser le plafond. Un retrait ne libère pas de capacité de versement.',
  },

  anterioritePEA: {
    titre: 'Antériorité du PEA',
    court: 'Après cinq ans, les gains échappent à l’impôt sur le revenu.',
    detail:
      'Le compteur part de la date du premier versement. Passé cinq ans, un retrait n’est plus soumis à l’impôt sur le revenu, et ne ferme plus le plan.',
    piege:
      'L’exonération ne porte que sur l’impôt sur le revenu. Les prélèvements sociaux de 17,2 % restent dus, même après vingt ans.',
  },

  impotPEA: {
    titre: 'Imposition du PEA',
    court: 'Vendre dans un PEA ne déclenche aucun impôt. Seul un retrait le fait.',
    detail:
      'Vous pouvez arbitrer librement à l’intérieur du plan sans conséquence fiscale. À la sortie, l’impôt ne porte pas sur la plus-value du titre vendu mais sur une quote-part du gain du plan entier, proportionnelle au montant retiré.',
    piege:
      'C’est la différence la plus coûteuse à ignorer : sur un compte-titres, chaque vente est imposable ; sur un PEA, aucune ne l’est.',
  },

  pfu: {
    titre: 'PFU — prélèvement forfaitaire unique',
    court: '30 % sur les gains d’un compte-titres : 12,8 % d’impôt et 17,2 % de prélèvements sociaux.',
    detail:
      'Appliqué par défaut. L’option pour le barème progressif peut être plus avantageuse si votre taux marginal d’imposition est faible, mais elle vaut alors pour tous vos revenus de capitaux de l’année.',
  },

  moinsValueReportable: {
    titre: 'Moins-value reportable',
    court: 'Une perte réalisée vient réduire vos gains imposables.',
    detail:
      'Elle s’impute sur les plus-values de même nature de la même année, puis se reporte sur les dix années suivantes. Vendre une ligne en perte avant le 31 décembre peut donc réduire l’impôt dû sur vos gains de l’année.',
  },

  fluxExterne: {
    titre: 'Flux',
    court: 'L’argent qui entre et sort de vos comptes.',
    detail:
      'Versements et retraits, distingués de la performance. Un portefeuille qui grossit parce que vous versez chaque mois n’est pas un portefeuille qui performe.',
  },

  dca: {
    titre: 'Versement moyen',
    court: 'Ce que vous versez, en moyenne, chaque mois.',
    detail:
      'Investir une somme régulière lisse le prix d’achat : on achète mécaniquement plus de parts quand les cours baissent. C’est ce qu’on appelle le DCA.',
  },

  fraisCumules: {
    titre: 'Frais cumulés',
    court: 'Tout ce que les frais vous ont coûté depuis le début.',
    detail:
      'Commissions de courtage et taxes sur les transactions. Rapportés au capital investi, ils donnent la performance que vous devez réaliser rien que pour les compenser.',
  },

  coursInconnu: {
    titre: 'Cours inconnu',
    court: 'Ces lignes sont exclues des totaux, faute de cours connu.',
    detail:
      'Plutôt que de les valoriser à zéro, ce qui fausserait discrètement votre patrimoine, elles sont écartées et signalées. Rafraîchissez les cours ou saisissez-en un à la main.',
  },
} as const satisfies Record<string, Explication>;

export type CleExplication = keyof typeof EXPLICATIONS;

export function explication(cle: CleExplication): Explication {
  return EXPLICATIONS[cle];
}
