/**
 * Graines de développement des plans de match (migration 0083) : pour la team Valorant, un plan « prêt » lié au
 * prochain match ou scrim du planning (veto BO3, deux maps, compositions, strats, lineups clés, checklist) et un
 * modèle ; pour The Finals, un plan en brouillon. Passe par le service (mêmes contrôles que l'app).
 */

import { servicesPlanning } from '../noyau/planning/service.mjs';
import { servicesPlans } from '../noyau/plans/service.mjs';
import { servicesStrats } from '../noyau/strats/service.mjs';

const ASCENT = { cle: 'ascent', nom: 'Ascent' };
const BIND = { cle: 'bind', nom: 'Bind' };

export async function semerPlans(base, teamId, { maintenant = () => Date.now(), noyau, stockage } = {}) {
  const strats = servicesStrats({ base, stockage, cleSession: undefined, maintenant, socle: noyau });
  const planning = servicesPlanning({ base, maintenant, noyau });
  const plans = servicesPlans({ base, maintenant, socle: noyau, strats, planning });
  const zed = { compte: 'zed12345', superAdmin: false };
  const liens = await plans.liens(zed, teamId);
  const ev = liens.evenements.find(e => Date.parse(e.debut) > maintenant());
  const membres = liens.membres.map(m => m.compte);
  const joueur = i => (membres[i] ? { membre: membres[i] } : { nom: `Joueur ${i + 1}` });
  const strat = nom => liens.strats.find(s => s.carte === nom);
  const lineupsDe = nom => liens.lineups.filter(l => l.carte === nom).slice(0, 3).map(l => l.id);
  const compo = agents => agents.map(([nom, role], i) => ({ ...joueur(i), personnage: { cle: nom.toLowerCase(), nom }, role }));
  const contenu = {
    veto: [
      { action: 'ban', camp: 'nous', carte: { cle: 'breeze', nom: 'Breeze' }, note: 'Leur map la plus jouée' },
      { action: 'ban', camp: 'eux', carte: null },
      { action: 'pick', camp: 'nous', carte: ASCENT, replis: [{ cle: 'haven', nom: 'Haven' }] },
      { action: 'pick', camp: 'eux', carte: BIND, note: 'Leur pick habituel' },
      { action: 'ban', camp: 'nous', carte: { cle: 'icebox', nom: 'Icebox' } },
      { action: 'ban', camp: 'eux', carte: null },
      { action: 'decider', camp: 'nous', carte: { cle: 'lotus', nom: 'Lotus' } },
    ],
    cartes: [
      {
        carte: ASCENT,
        compo: compo([['Jett', 'Entry'], ['Omen', 'IGL'], ['Sova', 'Support'], ['Killjoy', 'Anchor'], ['Kayo', 'Second entry']]),
        strats: [
          { side: 'attaque', type: 'pistol', titre: 'Pistol : split A par main et mid', note: 'Deux smokes, pas de flash gaspillée' },
          strat('Ascent') ? { side: 'attaque', type: 'execution', strat: strat('Ascent').id, note: 'À partir du round 4, si le mid est tenu' } : { side: 'attaque', type: 'execution', titre: 'Exec A' },
          { side: 'attaque', type: 'defaut', titre: 'Défaut 1-3-1', note: 'Prendre l’info avant 1:10' },
          { side: 'defense', type: 'pistol', titre: 'Pistol : stack B, Killjoy seule sur A' },
          { side: 'defense', type: 'retake', titre: 'Retake A par Heaven et CT', note: 'Attendre l’ult de Sova' },
        ],
        lineups: lineupsDe('Ascent'),
        conditions: 'Gagner le contrôle du mid avant 1:15.\nNe pas donner de duel gratuit à leur Jett.',
        tendances: 'Ils forcent presque toujours le round 2.\nLeur Sova recon B main à chaque début de round.',
        calls: 'Omen call les rotations.\n« Reset » : tout le monde recule et on rejoue le défaut.',
        notes: '',
      },
      {
        carte: BIND,
        compo: compo([['Raze', 'Entry'], ['Brimstone', 'IGL'], ['Skye', 'Support'], ['Cypher', 'Anchor'], ['Viper', 'Lurk']]),
        strats: [
          { side: 'attaque', type: 'pistol', titre: 'Pistol : rush B long' },
          { side: 'attaque', type: 'eco', titre: 'Éco : 5 hookah, on joue le plant' },
          { side: 'defense', type: 'defaut', titre: 'Défaut 2-1-2 avec Cypher B' },
        ],
        lineups: lineupsDe('Bind'),
        conditions: 'Tenir les téléporteurs : pas de rotation par TP sans call.',
        tendances: 'Beaucoup d’exec A showers après un round perdu.',
        calls: '',
        notes: '',
      },
    ],
    checklist: [{ texte: 'Tout le monde est là 30 minutes avant' }, { texte: 'Échauffement fait' }, { texte: 'Vocal et micros testés' }, { texte: 'Compositions relues' }, { texte: 'Veto relu avec l’IGL' }],
    notes: 'Rester calmes après le pistol : on joue notre plan, pas le leur.',
  };
  const { plan } = await plans.creer(zed, teamId, { titre: 'Plan de match', format: 'bo3', contenu, ...(ev ? { evenementId: ev.id, occurrence: ev.occurrence } : { date: new Date(maintenant() + 3 * 86_400_000).toISOString().slice(0, 10) }), ...(ev?.adversaireId ? {} : { adversaireNom: 'Team Nova' }) });
  await plans.cocher(zed, teamId, plan.id, { coches: plan.contenu.checklist.slice(0, 2).map(e => e.id) });
  await plans.modifier(zed, teamId, plan.id, { statut: 'pret' });
  await plans.dupliquer(zed, teamId, plan.id, { modele: true, titre: 'Modèle BO3' });
  return plan.id;
}

export async function semerPlansFinals(base, teamId, { maintenant = () => Date.now(), noyau, stockage } = {}) {
  const strats = servicesStrats({ base, stockage, cleSession: undefined, maintenant, socle: noyau });
  const plans = servicesPlans({ base, maintenant, socle: noyau, strats, planning: servicesPlanning({ base, maintenant, noyau }) });
  const membre = await base.premier("SELECT compte_id FROM membres WHERE team_id = ? AND statut = 'actif' LIMIT 1", [teamId]);
  if (!membre) return null;
  const acteur = { compte: membre.compte_id, superAdmin: true };
  const ligne = (classe, role, arme, specialisation, gadgets) => ({ nom: `Joueur ${classe}`, personnage: { cle: classe.toLowerCase(), nom: classe }, role, arme, specialisation, gadgets, reserve: ['Frag Grenade'] });
  const { plan } = await plans.creer(acteur, teamId, {
    titre: 'Tournoi du week-end',
    adversaireNom: 'Les Vautours',
    date: new Date(maintenant() + 5 * 86_400_000).toISOString().slice(0, 10),
    contenu: {
      cartes: [
        {
          carte: { cle: 'monaco', nom: 'Monaco' },
          mode: 'cashout',
          compo: [ligne('Light', 'Flank', 'XP-54', 'Evasive Dash', ['Smoke Grenade', 'Glitch Grenade', 'Stun Gun']), ligne('Medium', 'IGL', 'AKM', 'Healing Beam', ['Jump Pad', 'Defibrillator', 'Zipline']), ligne('Heavy', 'Anchor', 'Lewis Gun', 'Mesh Shield', ['Dome Shield', 'Barricade', 'RPG-7'])],
          strats: [{ side: 'cashout', type: 'defaut', titre: 'Défense du cashout par le toit', note: 'Dome Shield sur la station' }],
          lineups: [],
          conditions: 'Garder le Heavy vivant sur la station.',
          tendances: '',
          calls: '',
          notes: '',
        },
      ],
      checklist: [{ texte: 'Loadouts vérifiés' }],
    },
  });
  return plan.id;
}
