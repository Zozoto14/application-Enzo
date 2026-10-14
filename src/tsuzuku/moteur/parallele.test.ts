import { clientAnnulable, courseAvecPriorite, courseOrdonnee, creerAnnulation, sauf, type SignalAnnulation } from './parallele';
import { creerClient } from './reseau';
import { ErreurMoteur } from './erreurs';
import { fauxReseau, html } from './outilsTest';

const attendre = (ms: number) => new Promise<void>(ok => setTimeout(ok, ms));

/** Tâche qui répond `v` après `ms`, et note son départ, sa fin et son annulation. */
function journalise() {
  const journal: string[] = [];
  let enVol = 0;
  let maxEnVol = 0;
  const tache =
    <T,>(nom: string, ms: number, v: T) =>
    async (signal: SignalAnnulation) => {
      journal.push(`+${nom}`);
      enVol += 1;
      maxEnVol = Math.max(maxEnVol, enVol);
      const desabonner = signal.surAnnulation(() => journal.push(`x${nom}`));
      try {
        await sauf(attendre(ms), signal);
        journal.push(`=${nom}`);
        return v;
      } finally {
        enVol -= 1;
        desabonner();
      }
    };
  return { journal, tache, max: () => maxEnVol };
}

describe('annulation', () => {
  it('annule les enfants avec le parent, et prévient les écouteurs une seule fois', () => {
    const parent = creerAnnulation();
    const enfant = creerAnnulation(parent.signal);
    const vus: string[] = [];
    enfant.signal.surAnnulation(() => vus.push('enfant'));
    parent.annuler();
    parent.annuler();
    expect(enfant.signal.annule).toBe(true);
    expect(vus).toEqual(['enfant']);
    // Abonnement après coup : appelé tout de suite.
    enfant.signal.surAnnulation(() => vus.push('tard'));
    expect(vus).toEqual(['enfant', 'tard']);
  });

  it('`sauf` rejette dès l’annulation (code « annule »)', async () => {
    const a = creerAnnulation();
    const p = sauf(attendre(1000).then(() => 'fini'), a.signal);
    a.annuler();
    await expect(p).rejects.toMatchObject({ code: 'annule' });
    await expect(sauf(Promise.resolve(1), a.signal)).rejects.toBeInstanceOf(ErreurMoteur);
  });

  it('client annulable : plus aucune requête ne part après l’annulation', async () => {
    const reseau = fauxReseau({ 'https://site-exemple.fr/': html('ok') });
    const a = creerAnnulation();
    const client = clientAnnulable(creerClient(reseau), a.signal);
    await client.texte('https://site-exemple.fr/');
    a.annuler();
    await expect(client.texte('https://site-exemple.fr/')).rejects.toMatchObject({ code: 'annule' });
    expect(reseau.appels).toHaveLength(1);
  });
});

describe('courseOrdonnee : variantes en parallèle, validées dans l’ordre', () => {
  it('valide dans l’ordre même si les réponses arrivent dans le désordre, et s’arrête comme une boucle séquentielle', async () => {
    const { journal, tache } = journalise();
    const valides: number[] = [];
    const r = await courseOrdonnee(
      [tache('a', 60, 'a'), tache('b', 10, 'b'), tache('c', 150, 'c'), tache('d', 5, 'd')],
      (v, i) => {
        valides.push(i);
        return v === 'b';
      },
      { simultanees: 3 },
    );
    expect(r).toEqual({ valides: 2, arrete: true });
    expect(valides).toEqual([0, 1]);
    // c (en vol) est annulée ; d n'est jamais partie (3 au plus en vol).
    expect(journal).toContain('xc');
    expect(journal).not.toContain('+d');
  });

  it('borne le nombre de tâches en vol', async () => {
    const { tache, max } = journalise();
    await courseOrdonnee(Array.from({ length: 8 }, (_, i) => tache(String(i), 5 + (i % 3) * 5, i)), () => false, { simultanees: 3 });
    expect(max()).toBe(3);
  });

  it('la première part seule : si elle répond avant `relaisMs` et suffit, aucune autre ne part', async () => {
    const { journal, tache } = journalise();
    await courseOrdonnee([tache('a', 10, true), tache('b', 10, false)], v => v, { simultanees: 3, relaisMs: 200 });
    expect(journal).toEqual(['+a', '=a']);
  });

  it('la première tarde au-delà de `relaisMs` : les suivantes partent sans l’attendre', async () => {
    const { journal, tache } = journalise();
    const debut = Date.now();
    await courseOrdonnee([tache('a', 150, 'a'), tache('b', 150, 'b'), tache('c', 150, 'c')], () => false, { simultanees: 3, relaisMs: 30 });
    expect(journal.slice(0, 3)).toEqual(['+a', '+b', '+c']);
    // En séquentiel : 450 ms ; ici, ~180 ms.
    expect(Date.now() - debut).toBeLessThan(400);
  });

  it('une erreur d’une tâche validée remonte ; les suivantes sont annulées', async () => {
    const { journal, tache } = journalise();
    const echoue = async () => {
      throw new Error('panne');
    };
    await expect(courseOrdonnee([echoue, tache('b', 50, 'b')], () => false, { simultanees: 2 })).rejects.toThrow('panne');
    expect(journal).toContain('xb');
  });
});

describe('courseAvecPriorite : sources en parallèle, ordre de priorité respecté', () => {
  const trouve = (v: string) => v.startsWith('ok');

  it('la source prioritaire l’emporte même si une autre répond avant elle (dans le délai de grâce)', async () => {
    const { tache } = journalise();
    const r = await courseAvecPriorite([tache('1', 80, 'ok-1'), tache('2', 10, 'ok-2')], trouve, { simultanees: 3, graceMs: 500 });
    expect(r.gagnante).toBe(0);
    expect(r.issues.map(x => x.resultat)).toEqual(['ok-1', 'ok-2']);
  });

  it('une source prioritaire qui échoue laisse la suivante l’emporter sans attendre', async () => {
    const { tache } = journalise();
    const debut = Date.now();
    const r = await courseAvecPriorite([tache('1', 20, 'rien'), tache('2', 30, 'ok-2'), tache('3', 300, 'ok-3')], trouve, { simultanees: 3, graceMs: 1000 });
    expect(r.gagnante).toBe(1);
    expect(Date.now() - debut).toBeLessThan(250);
    // La 3e (moins prioritaire, encore en vol) est interrompue.
    expect(r.issues[2]).toEqual({ i: 2, interrompue: true });
  });

  it('délai de grâce dépassé : la source moins prioritaire qui a trouvé l’emporte, la lente est interrompue', async () => {
    const { journal, tache } = journalise();
    const debut = Date.now();
    const r = await courseAvecPriorite([tache('lente', 2000, 'ok-lente'), tache('rapide', 20, 'ok-rapide')], trouve, { simultanees: 3, graceMs: 100 });
    expect(r.gagnante).toBe(1);
    expect(r.issues[0]).toEqual({ i: 0, interrompue: true });
    expect(journal).toContain('xlente');
    expect(Date.now() - debut).toBeLessThan(600);
  });

  it('relais : la source prioritaire qui trouve vite n’entraîne aucune requête vers les autres', async () => {
    const { journal, tache } = journalise();
    const r = await courseAvecPriorite([tache('1', 20, 'ok-1'), tache('2', 20, 'ok-2')], trouve, { simultanees: 3, graceMs: 100, relaisMs: 300 });
    expect(r.gagnante).toBe(0);
    expect(journal).not.toContain('+2');
  });

  it('relais dépassé : les autres sources partent pendant que la prioritaire tarde', async () => {
    const { journal, tache } = journalise();
    const r = await courseAvecPriorite([tache('1', 400, 'rien'), tache('2', 20, 'ok-2')], trouve, { simultanees: 3, graceMs: 50, relaisMs: 50 });
    expect(r.gagnante).toBe(1);
    expect(journal.indexOf('+2')).toBeLessThan(journal.indexOf('=2'));
    expect(journal).not.toContain('=1');
  });

  it('aucune ne trouve : toutes finissent, pas de gagnante', async () => {
    const { tache } = journalise();
    const r = await courseAvecPriorite([tache('1', 10, 'rien'), tache('2', 5, 'rien')], trouve, { simultanees: 1, graceMs: 10 });
    expect(r.gagnante).toBeNull();
    expect(r.issues.map(x => x.resultat)).toEqual(['rien', 'rien']);
  });

  it('une source en erreur ne bloque rien', async () => {
    const { tache } = journalise();
    const r = await courseAvecPriorite(
      [
        async () => {
          throw new Error('panne');
        },
        tache('2', 5, 'ok-2'),
      ],
      trouve,
      { simultanees: 2, graceMs: 10 },
    );
    expect(r.gagnante).toBe(1);
    expect(r.issues[0].erreur).toBeInstanceOf(Error);
  });
});

describe('courseAvecPriorite : résultat provisoire', () => {
  it('une source moins prioritaire a trouvé, la prioritaire cherche encore : provisoire annoncé, puis décision dans l’ordre', async () => {
    const { tache } = journalise();
    const vus: Array<[string, number]> = [];
    const r = await courseAvecPriorite([tache('1', 80, 'ok-1'), tache('2', 10, 'ok-2')], v => v.startsWith('ok'), { simultanees: 2, graceMs: 500, surProvisoire: (v, i) => vus.push([v, i]) });
    expect(vus).toEqual([['ok-2', 1]]);
    expect(r.gagnante).toBe(0);
  });

  it('la prioritaire trouve d’abord : rien de provisoire', async () => {
    const { tache } = journalise();
    const vus: unknown[] = [];
    await courseAvecPriorite([tache('1', 5, 'ok-1'), tache('2', 50, 'ok-2')], v => v.startsWith('ok'), { simultanees: 2, graceMs: 500, surProvisoire: v => vus.push(v) });
    expect(vus).toEqual([]);
  });
});
