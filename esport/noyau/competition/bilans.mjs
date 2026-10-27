/**
 * Bilans des résultats (fonctions PURES) : taux de victoire global, par map et par adversaire, séries
 * en cours et records, forme récente, classements (place moyenne, top 1, top 3).
 *
 * Définitions (les mêmes partout : page Résultats, vue par adversaire, accueil, résumé publiable) :
 *  - une SÉRIE compte une victoire, une défaite ou un nul ; taux de victoire = victoires ÷ séries
 *    (un nul n'est pas une victoire) ;
 *  - par map : chaque MANCHE jouée sur la map (une série BO3 compte deux ou trois manches) ;
 *  - un CLASSEMENT (manches à plusieurs équipes) ne compte pas dans le taux de victoire : il a ses
 *    propres chiffres (nombre, place moyenne, top 1, top 3) ;
 *  - séries en cours et records : sur les séries seulement, de la plus récente à la plus ancienne.
 *
 * Entrée : résultats « publics » du service (`{ id, date, systeme, issue, place, adversaires, manches }`).
 */

const lettre = issue => (issue === 'victoire' ? 'V' : issue === 'defaite' ? 'D' : 'N');

function compteur() {
  return { joues: 0, victoires: 0, defaites: 0, nuls: 0, taux: null };
}

function ajouter(c, issue) {
  c.joues++;
  if (issue === 'victoire') c.victoires++;
  else if (issue === 'defaite') c.defaites++;
  else c.nuls++;
}

const finir = c => ({ ...c, taux: c.joues > 0 ? Math.round((c.victoires * 100) / c.joues) : null });

/** Série en cours (la plus récente d'abord) et records. `issues` : de la plus récente à la plus ancienne. */
export function seriesDe(issues) {
  const enCours = issues.length ? { issue: issues[0], n: 0 } : null;
  if (enCours) for (const i of issues) if (i === enCours.issue) enCours.n++; else break;
  let maxV = 0;
  let maxD = 0;
  let v = 0;
  let d = 0;
  for (const i of issues) {
    v = i === 'victoire' ? v + 1 : 0;
    d = i === 'defaite' ? d + 1 : 0;
    maxV = Math.max(maxV, v);
    maxD = Math.max(maxD, d);
  }
  return { enCours, recordVictoires: maxV, recordDefaites: maxD };
}

/**
 * Bilan d'une liste de résultats. Rend :
 *   { series: { joues, victoires, defaites, nuls, taux }, classements: { joues, placeMoyenne, top1, top3 },
 *     parCarte: [{ cle, nom, ...compteur, classements }], parAdversaire: [{ id, nom, ...compteur }],
 *     forme: ['V', 'D', …] (5 dernières séries), enCours, recordVictoires, recordDefaites,
 *     rounds: { pour, contre } (manches au score) }
 */
export function bilan(resultats) {
  const tries = [...resultats].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const series = compteur();
  const classements = { joues: 0, sommePlaces: 0, top1: 0, top3: 0 };
  const cartes = new Map();
  const adversaires = new Map();
  const rounds = { pour: 0, contre: 0 };
  const issuesSeries = [];
  for (const r of tries) {
    if (r.systeme === 'classement') {
      if (r.place) {
        classements.joues++;
        classements.sommePlaces += r.place;
        if (r.place === 1) classements.top1++;
        if (r.place <= 3) classements.top3++;
      }
      for (const m of r.manches ?? []) {
        if (!m.carte) continue;
        const c = cartes.get(m.carte.cle ?? m.carte.nom) ?? { cle: m.carte.cle ?? null, nom: m.carte.nom, ...compteur(), classements: { joues: 0, sommePlaces: 0 } };
        c.classements.joues++;
        c.classements.sommePlaces += m.place ?? 0;
        cartes.set(m.carte.cle ?? m.carte.nom, c);
      }
      continue;
    }
    if (!r.issue) continue;
    ajouter(series, r.issue);
    issuesSeries.push(r.issue);
    for (const a of r.adversaires ?? []) {
      const cle = a.id ?? `nom:${String(a.nom).toLowerCase()}`;
      const c = adversaires.get(cle) ?? { id: a.id ?? null, nom: a.nom, ...compteur() };
      ajouter(c, r.issue);
      adversaires.set(cle, c);
    }
    for (const m of r.manches ?? []) {
      if (typeof m.nous === 'number' && typeof m.eux === 'number') {
        rounds.pour += m.nous;
        rounds.contre += m.eux;
      }
      if (!m.carte || !m.issue) continue;
      const cle = m.carte.cle ?? m.carte.nom;
      const c = cartes.get(cle) ?? { cle: m.carte.cle ?? null, nom: m.carte.nom, ...compteur(), classements: { joues: 0, sommePlaces: 0 } };
      ajouter(c, m.issue);
      cartes.set(cle, c);
    }
  }
  const s = seriesDe(issuesSeries);
  return {
    series: finir(series),
    classements: {
      joues: classements.joues,
      placeMoyenne: classements.joues ? Math.round((classements.sommePlaces * 10) / classements.joues) / 10 : null,
      top1: classements.joues ? classements.top1 : 0,
      top3: classements.joues ? classements.top3 : 0,
    },
    parCarte: [...cartes.values()]
      .map(c => ({
        ...finir(c),
        classements: { joues: c.classements.joues, placeMoyenne: c.classements.joues ? Math.round((c.classements.sommePlaces * 10) / c.classements.joues) / 10 : null },
      }))
      .sort((a, b) => b.joues + b.classements.joues - (a.joues + a.classements.joues) || a.nom.localeCompare(b.nom)),
    parAdversaire: [...adversaires.values()].map(finir).sort((a, b) => b.joues - a.joues || a.nom.localeCompare(b.nom)),
    forme: issuesSeries.slice(0, 5).map(lettre),
    enCours: s.enCours,
    recordVictoires: s.recordVictoires,
    recordDefaites: s.recordDefaites,
    rounds,
  };
}
