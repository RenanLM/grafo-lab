import type { Edge } from './types';
import { deepFreeze } from './test-helpers';
import { weightField } from './weight';

/** Aresta v1–v2 com o peso dado; sem argumento, aresta SEM peso (sem a chave `weight`). */
const edge = (weight?: number): Edge =>
  weight === undefined ? { id: 'e1', source: 'v1', target: 'v2' } : { id: 'e1', source: 'v1', target: 'v2', weight };

/** O uso real do helper: espalhar o resultado dentro de um objeto. */
const montar = (aresta: Edge) => ({ edgeId: aresta.id, ...weightField(aresta) });

describe('weightField', () => {
  it('aresta sem peso → undefined; espalhado, não acrescenta a chave `weight` (e nunca peso 1)', () => {
    expect(weightField(edge())).toBeUndefined();

    const montado = montar(edge());
    expect(montado).toStrictEqual({ edgeId: 'e1' });
    expect(montado).not.toHaveProperty('weight');
    expect('weight' in montado).toBe(false);
  });

  it.each([0, -3, 2.5, 7, Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE])(
    'copia o peso %s exatamente como está',
    (weight) => {
      const copia = weightField(edge(weight))!;

      expect(copia).toStrictEqual({ weight });
      expect('weight' in copia).toBe(true);
      expect(Object.is(copia.weight, weight)).toBe(true);
      expect(montar(edge(weight))).toStrictEqual({ edgeId: 'e1', weight });
    },
  );

  it('peso zero é um peso: a chave existe e o valor é 0, diferente de aresta sem peso', () => {
    expect(weightField(edge(0))).toStrictEqual({ weight: 0 });
    expect(weightField(edge(0))).not.toBeUndefined();
    expect(montar(edge(0))).not.toStrictEqual(montar(edge()));
  });

  it('não converte nada: -0 continua -0 (a normalização para 0 é do addEdge/setEdgeWeight)', () => {
    expect(Object.is(weightField(edge(-0))!.weight, -0)).toBe(true);
  });

  it('os três estados continuam distintos depois de espalhados', () => {
    expect(montar(edge())).toStrictEqual({ edgeId: 'e1' });
    expect(montar(edge(0))).toStrictEqual({ edgeId: 'e1', weight: 0 });
    expect(montar(edge(-1))).toStrictEqual({ edgeId: 'e1', weight: -1 });
  });

  it('devolve um objeto novo a cada chamada; alterá-lo não afeta a aresta nem outras chamadas', () => {
    const aresta = deepFreeze(edge(4));
    const a = weightField(aresta)!;
    const b = weightField(aresta)!;

    expect(a).not.toBe(b);
    a.weight = 99;

    expect(weightField(aresta)).toStrictEqual({ weight: 4 });
    expect(aresta.weight).toBe(4);
  });

  it('o objeto montado não compartilha nada com a aresta nem com outras montagens', () => {
    const aresta = deepFreeze(edge(5));
    const a = montar(aresta);
    const b = montar(aresta);

    expect(a).not.toBe(b);
    a.weight = 123;

    expect(b.weight).toBe(5);
    expect(aresta.weight).toBe(5);
  });

  it('não altera a aresta recebida (congelada)', () => {
    const semPeso = deepFreeze(edge());
    const comZero = deepFreeze(edge(0));

    expect(() => weightField(semPeso)).not.toThrow();
    expect(() => weightField(comZero)).not.toThrow();
    expect(semPeso).toStrictEqual({ id: 'e1', source: 'v1', target: 'v2' });
  });
});
