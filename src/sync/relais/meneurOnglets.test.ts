/**
 * Un seul onglet meneur par navigateur : verrou Web Locks partagé, relais des avis par
 * BroadcastChannel. Faux `navigator.locks` et faux canal fidèles à la sémantique du navigateur
 * (verrou exclusif en file, abandon par signal, message reçu par tous les AUTRES onglets).
 */
import { MeneurOnglets, type CanalOnglets, type MessageOnglets, type VerrousWeb } from './meneurOnglets';

const pause = (ms = 0) => new Promise<void>(ok => setTimeout(ok, ms));

/** `navigator.locks` d'un navigateur : un verrou exclusif par nom, file d'attente, `signal`. */
function verrousNavigateur(): VerrousWeb & { tenus: Set<string> } {
  const files = new Map<string, Array<() => void>>();
  const tenus = new Set<string>();
  const suivant = (nom: string) => {
    const f = files.get(nom);
    const prochain = f?.shift();
    if (prochain) prochain();
    else tenus.delete(nom);
  };
  return {
    tenus,
    request(nom, options, rappel) {
      return new Promise((ok, ko) => {
        const lancer = () => {
          tenus.add(nom);
          Promise.resolve(rappel({ name: nom }))
            .then(ok, ko)
            .finally(() => suivant(nom));
        };
        if (!tenus.has(nom)) {
          lancer();
          return;
        }
        const f = files.get(nom) ?? [];
        files.set(nom, f);
        f.push(lancer);
        options.signal?.addEventListener('abort', () => {
          const i = f.indexOf(lancer);
          if (i >= 0) {
            f.splice(i, 1);
            ko(new Error('AbortError'));
          }
        });
      });
    },
  };
}

/** BroadcastChannel d'un navigateur : chaque message va à tous les autres canaux du même nom. */
function canauxNavigateur() {
  const ouverts = new Map<string, Set<CanalOnglets>>();
  return (nom: string): CanalOnglets => {
    const groupe = ouverts.get(nom) ?? new Set();
    ouverts.set(nom, groupe);
    const canal: CanalOnglets = {
      onmessage: null,
      postMessage(m) {
        for (const autre of groupe) if (autre !== canal) setTimeout(() => autre.onmessage?.({ data: m }), 0);
      },
      close() {
        groupe.delete(canal);
      },
    };
    groupe.add(canal);
    return canal;
  };
}

describe('MeneurOnglets (une seule connexion d’écoute par navigateur)', () => {
  it('5 onglets visibles : UN SEUL meneur ; quand il se masque, un autre prend la suite', async () => {
    const verrous = verrousNavigateur();
    const creerCanal = canauxNavigateur();
    const connexions = new Set<number>();
    let maxSimultanees = 0;
    const onglets = Array.from({ length: 5 }, () => new MeneurOnglets({ nom: 'relais|principal', verrous, creerCanal, surMessage: () => undefined }));
    onglets.forEach((o, i) =>
      o.briguer(() => {
        connexions.add(i);
        maxSimultanees = Math.max(maxSimultanees, connexions.size);
        return () => connexions.delete(i);
      }),
    );
    await pause();
    expect(onglets.filter(o => o.estMeneur)).toHaveLength(1);
    expect(connexions.size).toBe(1);
    const premier = onglets.findIndex(o => o.estMeneur);
    // Le meneur est masqué : il arrête d'écouter et rend le verrou ; un seul autre le prend.
    onglets[premier].renoncer();
    await pause();
    expect(onglets[premier].estMeneur).toBe(false);
    expect(onglets.filter(o => o.estMeneur)).toHaveLength(1);
    expect(connexions.size).toBe(1);
    // Un onglet en file qui se masque la quitte sans jamais mener.
    const enFile = onglets.findIndex((o, i) => i !== premier && !o.estMeneur);
    onglets[enFile].renoncer();
    // Tous fermés : plus aucune connexion, plus aucun verrou.
    onglets.forEach(o => o.fermer());
    await pause();
    expect(connexions.size).toBe(0);
    expect(verrous.tenus.size).toBe(0);
    expect(maxSimultanees).toBe(1);
  });

  it('relais : le meneur diffuse la révision, les autres onglets la reçoivent (pas lui-même)', async () => {
    const verrous = verrousNavigateur();
    const creerCanal = canauxNavigateur();
    const recus: Array<{ onglet: number; m: MessageOnglets }> = [];
    const onglets = Array.from({ length: 3 }, (_, i) => new MeneurOnglets({ nom: 'r|lea', verrous, creerCanal, surMessage: m => recus.push({ onglet: i, m }) }));
    onglets.forEach(o => o.briguer(() => () => undefined));
    await pause();
    const meneur = onglets.findIndex(o => o.estMeneur);
    onglets[meneur].diffuser({ type: 'version', rev: 42 });
    onglets[(meneur + 1) % 3].diffuser({ type: 'ecrit' });
    await pause(5);
    expect(recus.filter(r => r.m.type === 'version').map(r => r.onglet).sort()).toEqual([0, 1, 2].filter(i => i !== meneur));
    expect(recus.filter(r => r.m.type === 'ecrit')).toHaveLength(2);
    // Messages étrangers ou malformés ignorés.
    onglets.forEach(o => o.fermer());
  });

  it('comptes ou relais différents : verrous distincts ; sans Web Locks, l’onglet mène seul', async () => {
    const verrous = verrousNavigateur();
    const a = new MeneurOnglets({ nom: 'r|principal', verrous, creerCanal: null, surMessage: () => undefined });
    const b = new MeneurOnglets({ nom: 'r|lea', verrous, creerCanal: null, surMessage: () => undefined });
    a.briguer(() => () => undefined);
    b.briguer(() => () => undefined);
    await pause();
    expect([a.estMeneur, b.estMeneur]).toEqual([true, true]);
    const seul = new MeneurOnglets({ nom: 'x', verrous: null, creerCanal: null, surMessage: () => undefined });
    let arrete = false;
    seul.briguer(() => () => {
      arrete = true;
    });
    expect(seul.estMeneur).toBe(true);
    seul.renoncer();
    expect(arrete).toBe(true);
    [a, b].forEach(o => o.fermer());
  });
});
