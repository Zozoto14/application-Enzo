import { d } from '../core/money/decimal';
import { rejouer } from '../core/portfolio/engine';
import { achat, compte, dividende, titre, versement } from '../core/testing/fixtures';
import { exporterExcel, feuillesPortefeuille } from './exportExcel';
import { crc32, utf8 } from './xlsx';

const transactions = [versement('2026-01-02', 5000), achat('2026-01-02', 10, 150, 2), dividende('2026-05-20', 30)];
const entrees = {
  etat: rejouer([compte()], transactions),
  comptes: [compte()],
  titres: [titre()],
  transactions,
  cours: new Map([['air-liquide', d('177')]]),
};

describe('export Excel', () => {
  it('range positions, opérations, dividendes et comptes dans quatre feuilles', () => {
    const [positions, operations, dividendes, comptes] = feuillesPortefeuille(entrees);
    expect(positions.lignes[0]).toEqual(expect.arrayContaining(['Air Liquide', 10, 177]));
    expect(positions.lignes[0][8]).toBeCloseTo(1770);
    expect(operations.lignes.map(ligne => ligne[2])).toEqual(['Versement', 'Achat', 'Dividende']);
    expect(operations.lignes[1][7]).toBe(-1502);
    expect(dividendes.lignes).toEqual([['2026-05-20', expect.any(String), 'Air Liquide', 30, null]]);
    expect(comptes.lignes[0][3]).toBe(5000);
  });

  it('produit une archive ZIP valide', () => {
    const octets = exporterExcel(entrees);
    expect([...octets.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(crc32(utf8('abc'))).toBe(0x352441c2);
  });
});
