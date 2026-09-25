/**
 * Rapport annuel, en HTML autonome.
 *
 * Ce que produit ce module est un document, pas un écran : on le relit en
 * mars, on le classe, on le passe à un comptable. D'où trois partis pris.
 *
 * **Tout est dans un seul fichier.** Pas de feuille de style externe, pas
 * d'image, pas de police à charger : le document s'ouvre dans dix ans sans
 * rien à côté, et il s'imprime en PDF depuis n'importe quel navigateur.
 *
 * **Les chiffres portent leur origine.** Chaque total dit d'où il vient et sur
 * quoi il ne porte pas. Un rapport fiscal qui arrondit sans le dire est pire
 * qu'un rapport absent.
 *
 * **Rien n'est déclaré à votre place.** Les montants sont rapprochés des cases
 * de la déclaration quand la règle est certaine, et l'incertitude est écrite
 * quand elle ne l'est pas. Ce document prépare une déclaration ; il ne la
 * remplace pas.
 */

import { Decimal } from '../core/money/decimal';
import type { Cession, Compte, Titre, Transaction } from '../core/domain/types';
import type { EtatPortefeuille } from '../core/portfolio/engine';
import { totaux, valoriserPositions } from '../core/portfolio/valorisation';
import { impotSurGainCTO } from '../core/tax/impots';
import { ancienneteEnAnnees, estExonereImpotRevenu, estPEA, etatPlafond } from '../core/tax/pea';
import { formaterDate, formaterMontant, formaterPourcentage, formaterQuantite } from '../ui/format';

export interface EntreesRapport {
  annee: number;
  etat: EtatPortefeuille;
  comptes: readonly Compte[];
  titres: readonly Titre[];
  transactions: readonly Transaction[];
  cours: ReadonlyMap<string, Decimal>;
  /** Date de génération, pour l'en-tête. */
  aujourdhui: string;
}

export interface Rapport {
  /** Nom de fichier suggéré. */
  nom: string;
  html: string;
  /** Vrai si l'année ne contient aucune opération. */
  anneeVide: boolean;
}

const LIBELLES: Record<string, string> = {
  ACHAT: 'Achat',
  VENTE: 'Vente',
  DIVIDENDE: 'Dividende',
  VERSEMENT: 'Versement',
  RETRAIT: 'Retrait',
  FRAIS: 'Frais',
};

/** Échappe le texte injecté dans le document. */
export function echapper(texte: string): string {
  return texte
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function montantTransaction(transaction: Transaction): Decimal {
  switch (transaction.type) {
    case 'ACHAT':
      return transaction.quantite.mul(transaction.prixUnitaire).add(transaction.frais);
    case 'VENTE':
      return transaction.quantite.mul(transaction.prixUnitaire).sub(transaction.frais);
    case 'DIVIDENDE':
      return transaction.montantNet;
    case 'VERSEMENT':
    case 'RETRAIT':
    case 'FRAIS':
      return transaction.montant;
  }
}

/** Nom de la valeur concernee, ou un tiret. Les frais n'en portent pas toujours. */
function nomValeurDe(
  transaction: Transaction,
  noms: ReadonlyMap<string, string>,
): string {
  const titreId = 'titreId' in transaction ? transaction.titreId : undefined;
  if (!titreId) {
    return '—';
  }
  return echapper(noms.get(titreId) ?? titreId);
}

function tableau(entetes: readonly string[], lignes: readonly (readonly string[])[]): string {
  if (lignes.length === 0) {
    return '<p class="vide">Aucune ligne.</p>';
  }
  const th = entetes
    .map((entete, index) => `<th${index > 0 ? ' class="n"' : ''}>${echapper(entete)}</th>`)
    .join('');
  const tr = lignes
    .map(
      ligne =>
        `<tr>${ligne
          .map((cellule, index) => `<td${index > 0 ? ' class="n"' : ''}>${cellule}</td>`)
          .join('')}</tr>`,
    )
    .join('');
  return `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

const STYLE = `
:root{--t:#14181f;--s:#616b7a;--b:#d8dce3;--a:#2f5bd8}
*{box-sizing:border-box}
body{margin:0;padding:32px;font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--t);max-width:900px}
h1{font-size:26px;margin:0 0 4px}
h2{font-size:18px;margin:32px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--b)}
h3{font-size:15px;margin:20px 0 6px}
p{margin:6px 0}
.chapeau{color:var(--s);margin:0 0 24px}
.note{color:var(--s);font-size:13px}
.vide{color:var(--s);font-style:italic}
table{width:100%;border-collapse:collapse;margin:8px 0 4px}
th,td{padding:6px 8px;border-bottom:1px solid var(--b);text-align:left;vertical-align:top}
th{font-weight:600;font-size:12px;color:var(--s);text-transform:uppercase;letter-spacing:.03em}
.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.total td{font-weight:700;border-top:2px solid var(--t);border-bottom:none}
.cases{background:#f5f6f8;border-left:3px solid var(--a);padding:12px 16px;margin:12px 0}
.cases dt{font-weight:600;margin-top:8px}
.cases dd{margin:0 0 0 0;font-variant-numeric:tabular-nums}
.avert{border:1px solid var(--b);padding:12px 16px;margin:24px 0 0;color:var(--s);font-size:13px}
@media print{body{padding:0;max-width:none}h2{page-break-after:avoid}table{page-break-inside:avoid}}
`;

export function construireRapportAnnuel(entrees: EntreesRapport): Rapport {
  const { annee } = entrees;
  const debut = `${annee}-01-01`;
  const fin = `${annee}-12-31`;

  const nomDuTitre = new Map(entrees.titres.map(titre => [titre.id, titre.nom]));
  const nomDuCompte = new Map(entrees.comptes.map(compte => [compte.id, compte.nom]));
  const parCompte = new Map(entrees.comptes.map(compte => [compte.id, compte]));

  const operations = entrees.transactions
    .filter(transaction => transaction.date >= debut && transaction.date <= fin)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const cessions = entrees.etat.cessions.filter(cession => cession.annee === annee);

  // ---------------------------------------------------------- Agrégats

  let dividendes = Decimal.ZERO;
  let fraisAnnee = Decimal.ZERO;
  let versements = Decimal.ZERO;
  let retraits = Decimal.ZERO;

  for (const operation of operations) {
    switch (operation.type) {
      case 'DIVIDENDE':
        dividendes = dividendes.add(operation.montantNet);
        break;
      case 'FRAIS':
        fraisAnnee = fraisAnnee.add(operation.montant);
        break;
      case 'VERSEMENT':
        versements = versements.add(operation.montant);
        break;
      case 'RETRAIT':
        retraits = retraits.add(operation.montant);
        break;
      case 'ACHAT':
      case 'VENTE':
        fraisAnnee = fraisAnnee.add(operation.frais);
        break;
    }
  }

  // Les cessions de PEA ne sont pas imposables : seul un retrait l'est, et il
  // se declare autrement. On separe donc les deux des le calcul.
  const cessionsCTO = cessions.filter(
    cession => !estPEA(parCompte.get(cession.compteId)?.type ?? 'CTO'),
  );
  const gainsCTO = Decimal.somme(
    cessionsCTO.filter(c => c.plusValue.estPositif()).map(c => c.plusValue),
  );
  const pertesCTO = Decimal.somme(
    cessionsCTO.filter(c => c.plusValue.estNegatif()).map(c => c.plusValue.neg()),
  );
  const netCTO = gainsCTO.sub(pertesCTO);
  const impot = netCTO.estPositif() ? impotSurGainCTO(netCTO) : undefined;

  const { valorisees, sansCours } = valoriserPositions(entrees.etat.positions, entrees.cours);
  const agregats = totaux(valorisees, [...entrees.etat.comptes.values()]);

  // ----------------------------------------------------------- Sections

  const sections: string[] = [];

  sections.push(`<h2>Synthèse de l’année ${annee}</h2>`);
  sections.push(
    tableau(
      ['Poste', 'Montant'],
      [
        ['Versements', formaterMontant(versements)],
        ['Retraits', formaterMontant(retraits)],
        ['Dividendes encaissés (net)', formaterMontant(dividendes)],
        ['Frais supportés', formaterMontant(fraisAnnee)],
        ['Plus-values réalisées', formaterMontant(netCTO.add(
          Decimal.somme(
            cessions
              .filter(c => estPEA(parCompte.get(c.compteId)?.type ?? 'CTO'))
              .map(c => c.plusValue),
          ),
        ), { signeExplicite: true })],
      ],
    ),
  );
  sections.push(
    `<p class="note">${operations.length} opération(s) enregistrée(s) dans l’année, ${cessions.length} cession(s).</p>`,
  );

  // ------------------------------------------------------ Situation fiscale

  sections.push('<h2>Situation fiscale par compte</h2>');
  for (const compte of entrees.comptes) {
    const etatCompte = entrees.etat.comptes.get(compte.id);
    const verses = etatCompte?.versementsCumules ?? Decimal.ZERO;
    sections.push(`<h3>${echapper(compte.nom)}</h3>`);

    if (!estPEA(compte.type)) {
      sections.push(
        '<p>Compte-titres ordinaire. Chaque cession en gain est imposable au titre de l’année de réalisation, au prélèvement forfaitaire unique de 30 % par défaut.</p>',
      );
      continue;
    }

    const plafond = etatPlafond(compte, verses);
    const anciennete = ancienneteEnAnnees(compte.dateOuverture, fin);
    const exonere = estExonereImpotRevenu(compte, fin);

    sections.push(
      tableau(
        ['Élément', 'Valeur'],
        [
          ['Date d’ouverture', formaterDate(compte.dateOuverture)],
          [`Antériorité au 31/12/${annee}`, `${anciennete} an(s)`],
          ['Versements cumulés', formaterMontant(plafond.verse)],
          ['Plafond', formaterMontant(plafond.plafond)],
          ['Reste versable', formaterMontant(plafond.restant)],
          ['Plafond utilisé', formaterPourcentage(plafond.pourcentageUtilise, 1, { signeExplicite: false })],
        ],
      ),
    );
    sections.push(
      exonere
        ? '<p>Plan de plus de cinq ans : les gains sont exonérés d’impôt sur le revenu. Les prélèvements sociaux de 17,2 % restent dus, et ne sont prélevés qu’au retrait, sur la part de gain retirée.</p>'
        : `<p>Plan de ${anciennete} an(s) : un retrait avant cinq ans serait taxé à 30 % sur la part de gain retirée, et entraînerait la clôture du plan.</p>`,
    );
    sections.push(
      '<p class="note">Une vente à l’intérieur d’un PEA ne déclenche aucune imposition et n’a pas à être déclarée. Seul un retrait est un fait générateur.</p>',
    );
  }

  // --------------------------------------------------------- Plus-values

  sections.push('<h2>Cessions de l’année</h2>');
  if (cessions.length === 0) {
    sections.push('<p class="vide">Aucune cession réalisée.</p>');
  } else {
    sections.push(
      tableau(
        ['Date', 'Valeur', 'Compte', 'Quantité', 'Prix unitaire', 'Frais', 'Plus-value'],
        cessions
          .slice()
          .sort((a, b) => (a.date < b.date ? -1 : 1))
          .map((cession: Cession) => [
            formaterDate(cession.date),
            echapper(nomDuTitre.get(cession.titreId) ?? cession.titreId),
            echapper(nomDuCompte.get(cession.compteId) ?? cession.compteId),
            formaterQuantite(cession.quantite),
            formaterMontant(cession.prixUnitaire),
            formaterMontant(cession.frais),
            formaterMontant(cession.plusValue, { signeExplicite: true }),
          ]),
      ),
    );
  }

  // ------------------------------------------------- Cases de déclaration

  sections.push('<h2>Report sur la déclaration</h2>');
  if (cessionsCTO.length === 0) {
    sections.push(
      '<p class="vide">Aucune cession sur compte-titres : rien à reporter au titre des plus-values de valeurs mobilières.</p>',
    );
  } else {
    sections.push(
      `<div class="cases"><dl>
<dt>Plus-values brutes (formulaire 2074, ou case 3VG de la 2042 si vous êtes dispensé du 2074)</dt><dd>${formaterMontant(gainsCTO)}</dd>
<dt>Moins-values de l’année (case 3VH)</dt><dd>${formaterMontant(pertesCTO)}</dd>
<dt>Résultat net de l’année</dt><dd>${formaterMontant(netCTO, { signeExplicite: true })}</dd>
</dl></div>`,
    );
    if (impot) {
      sections.push(
        tableau(
          ['Imposition estimée', 'Montant'],
          [
            ['Impôt sur le revenu (12,8 %)', formaterMontant(impot.impotRevenu)],
            ['Prélèvements sociaux (17,2 %)', formaterMontant(impot.prelevementsSociaux)],
            ['Total', formaterMontant(impot.total)],
          ],
        ),
      );
      sections.push(
        '<p class="note">Estimation au prélèvement forfaitaire unique. L’option pour le barème progressif peut être plus avantageuse selon votre tranche ; elle est globale et s’applique à tous vos revenus de capitaux mobiliers de l’année.</p>',
      );
    } else if (netCTO.estNegatif()) {
      sections.push(
        `<p>Le résultat net de l’année est une perte de ${formaterMontant(netCTO.neg())}. Elle est reportable sur les plus-values des dix années suivantes, à condition d’être déclarée l’année où elle est subie.</p>`,
      );
    }
  }

  sections.push(
    `<p class="note">Les dividendes encaissés (${formaterMontant(dividendes)}) sont déclarés séparément. Ceux perçus dans un PEA ne se déclarent pas.</p>`,
  );

  // ---------------------------------------------------- Positions au 31/12

  sections.push(`<h2>Positions détenues au 31/12/${annee}</h2>`);
  sections.push(
    tableau(
      ['Valeur', 'Compte', 'Quantité', 'Prix de revient', 'Valorisation', 'Plus-value latente'],
      valorisees.map(position => [
        echapper(nomDuTitre.get(position.titreId) ?? position.titreId),
        echapper(nomDuCompte.get(position.compteId) ?? position.compteId),
        formaterQuantite(position.quantite),
        formaterMontant(position.coutTotal),
        formaterMontant(position.valeurMarche),
        formaterMontant(position.plusValueLatente, { signeExplicite: true }),
      ]),
    ),
  );
  sections.push(
    tableau(
      ['Total', 'Montant'],
      [
        ['Valeur des titres', formaterMontant(agregats.valeurTitres)],
        ['Liquidités', formaterMontant(agregats.cash)],
        ['Valeur totale', formaterMontant(agregats.valeurTotale)],
      ],
    ),
  );
  if (sansCours.length > 0) {
    sections.push(
      `<p class="note">${sansCours.length} ligne(s) exclue(s) des totaux faute de cours connu : ${sansCours
        .map(position => echapper(nomDuTitre.get(position.titreId) ?? position.titreId))
        .join(', ')}. Elles sont écartées plutôt que valorisées à zéro, ce qui fausserait le total sans le dire.</p>`,
    );
  }
  sections.push(
    '<p class="note">Les plus-values latentes ne sont pas imposables : elles ne le deviennent qu’à la vente. Elles figurent ici pour la lecture du patrimoine, pas pour la déclaration.</p>',
  );

  // -------------------------------------------------- Journal des opérations

  sections.push('<h2>Journal des opérations</h2>');
  sections.push(
    tableau(
      ['Date', 'Type', 'Valeur', 'Compte', 'Détail', 'Montant'],
      operations.map(operation => [
        formaterDate(operation.date),
        LIBELLES[operation.type] ?? operation.type,
        nomValeurDe(operation, nomDuTitre),
        echapper(nomDuCompte.get(operation.compteId) ?? operation.compteId),
        'quantite' in operation
          ? `${formaterQuantite(operation.quantite)} × ${formaterMontant(operation.prixUnitaire)}`
          : '—',
        formaterMontant(montantTransaction(operation)),
      ]),
    ),
  );

  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rapport ${annee}</title>
<style>${STYLE}</style>
</head>
<body>
<h1>Rapport annuel ${annee}</h1>
<p class="chapeau">Généré le ${formaterDate(entrees.aujourdhui)} à partir de vos données locales. Aucune donnée n’a quitté l’appareil.</p>
${sections.join('\n')}
<div class="avert">
<p><strong>Ce document prépare une déclaration ; il ne la remplace pas.</strong> Les montants sont calculés sur les opérations que vous avez saisies ou importées : une opération manquante fausse tout ce qui en découle. Les plus-values suivent la règle du prix de revient moyen pondéré (CGI art. 150-0 D), qui est la règle française — et non la méthode FIFO utilisée dans d’autres pays.</p>
<p>Les cas particuliers ne sont pas traités : abattement pour durée de détention sur titres acquis avant 2018, apports-cessions, titres démembrés, plans d’actionnariat salarié, cessions de parts sociales. Si l’un vous concerne, faites vérifier ce rapport.</p>
</div>
</body>
</html>`;

  return {
    nom: `rapport-${annee}.html`,
    html,
    anneeVide: operations.length === 0 && cessions.length === 0,
  };
}

/** Années pour lesquelles un rapport a du sens. */
export function anneesDisponibles(transactions: readonly Transaction[]): number[] {
  const annees = new Set<number>();
  for (const transaction of transactions) {
    annees.add(Number(transaction.date.slice(0, 4)));
  }
  return [...annees].sort((a, b) => b - a);
}
