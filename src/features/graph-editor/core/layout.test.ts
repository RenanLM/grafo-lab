import {
  addEdge,
  addVertex,
  createGraph,
  removeVertex,
  setVertexLabel,
  type Graph,
  type Result,
} from '@/domain/graph';

import * as core from './index';
import {
  boundsOf,
  circularLayout,
  DEFAULT_LAYOUT_SPACING,
  emptyLayout,
  fitToBounds,
  moveVertex,
  NEUTRAL_CAMERA,
  placeVertex,
  positionOf,
  reconcileLayout,
  removePosition,
  screenToWorld,
  worldToScreen,
  type GraphLayout,
  type Point,
} from './index';
import { deepFreeze, seededRandom } from './test-helpers';

// GraphLayout (ver layout.ts): posições dos vértices no mundo, associadas ao `graph.id`, chaveadas pelo id técnico.

// ---------------------------------------------------------------------------------------------
// Apoio: grafos do domínio e verificações geométricas
// ---------------------------------------------------------------------------------------------

function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`esperava sucesso, mas veio ${result.error.code}`);
  return result.value;
}

/** Grafo `id` com `count` vértices v1..vN (rótulos A, B, C…), sem arestas. */
function buildGraph(id: string, count: number, directed = false): Graph {
  let graph = createGraph({ id, directed });
  for (let i = 0; i < count; i++) graph = must(addVertex(graph)).graph;
  return graph;
}
const withoutVertex = (graph: Graph, vertexId: string): Graph => must(removeVertex(graph, vertexId));
const withNewVertex = (graph: Graph, label?: string): Graph => must(addVertex(graph, label)).graph;
const idsOf = (graph: Graph): string[] => graph.vertices.map((vertex) => vertex.id);

const point = (x: number, y: number): Point => ({ x, y });
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const keysOf = (layout: GraphLayout): string[] => Object.keys(layout.positions);

/** Layout do grafo `graphId` com as posições dadas, montado só com a API pública. */
function layoutOf(graphId: string, entries: readonly (readonly [string, number, number])[]): GraphLayout {
  return entries.reduce((layout, [id, x, y]) => placeVertex(layout, id, point(x, y)), emptyLayout(graphId));
}

/** Posição de `id` ou falha do teste (evita `!` espalhado). */
function at(layout: GraphLayout, id: string): Readonly<Point> {
  const position = positionOf(layout, id);
  if (position === undefined) throw new Error(`sem posição para ${id}`);
  return position;
}

/** Todas as posições, na ordem de `ids`. */
const pointsOf = (layout: GraphLayout, ids: readonly string[]): Readonly<Point>[] => ids.map((id) => at(layout, id));

/** Distância mínima entre dois pontos quaisquer (Infinity com menos de dois). */
function minPairDistance(points: readonly Point[]): number {
  let minimum = Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) minimum = Math.min(minimum, distance(points[i]!, points[j]!));
  }
  return minimum;
}

/** O arredondamento a 3 casas move cada coordenada em até 0,0005; a corda entre vizinhos perde, no máximo, ≈ 0,0015. */
const ROUNDING_TOLERANCE = 0.003;

// ---------------------------------------------------------------------------------------------
// Modelo e operações básicas
// ---------------------------------------------------------------------------------------------

describe('GraphLayout: modelo', () => {
  it('um layout vazio pertence ao grafo e não tem posições; é congelado e sem protótipo nas posições', () => {
    const layout = emptyLayout('g1');

    expect(layout.graphId).toBe('g1');
    expect(keysOf(layout)).toStrictEqual([]);
    expect(Object.isFrozen(layout)).toBe(true);
    expect(Object.isFrozen(layout.positions)).toBe(true);
    expect(Object.getPrototypeOf(layout.positions)).toBeNull();
    expect(boundsOf(layout)).toBeUndefined();
  });

  it('o layout não carrega seleção, animação nem câmera: só `graphId` e `positions`', () => {
    const layout = placeVertex(emptyLayout('g'), 'v1', point(1, 2));

    expect(Object.keys(layout)).toStrictEqual(['graphId', 'positions']);
    expect(Object.keys(at(layout, 'v1'))).toStrictEqual(['x', 'y']);
  });

  it('o módulo exporta o layout pela API do núcleo', () => {
    expect(Object.keys(core)).toEqual(
      expect.arrayContaining([
        'DEFAULT_LAYOUT_SPACING',
        'boundsOf',
        'circularLayout',
        'emptyLayout',
        'moveVertex',
        'placeVertex',
        'positionOf',
        'reconcileLayout',
        'removePosition',
      ]),
    );
    expect(DEFAULT_LAYOUT_SPACING).toBe(96);
  });
});

describe('placeVertex', () => {
  it('acrescenta a posição de um vértice novo, sem tocar no layout original', () => {
    const antes = layoutOf('g', [['v1', 1, 2]]);
    const depois = placeVertex(antes, 'v2', point(-3.5, 40));

    expect(keysOf(antes)).toStrictEqual(['v1']);
    expect(keysOf(depois)).toStrictEqual(['v1', 'v2']);
    expect(depois.graphId).toBe('g');
    expect(at(depois, 'v2')).toEqual(point(-3.5, 40));
    expect(at(depois, 'v1')).toBe(at(antes, 'v1')); // pontos congelados são reaproveitados
  });

  it('copia o ponto recebido: alterar o objeto original depois não muda o layout', () => {
    const recebido = { x: 5, y: 6 };
    const layout = placeVertex(emptyLayout('g'), 'v1', recebido);
    recebido.x = 999;

    expect(at(layout, 'v1')).toEqual(point(5, 6));
    expect(at(layout, 'v1')).not.toBe(recebido);
    expect(Object.isFrozen(at(layout, 'v1'))).toBe(true);
  });

  it('um vértice que já tem posição NÃO é alterado em silêncio: devolve o mesmo layout', () => {
    const layout = layoutOf('g', [['v1', 1, 2]]);
    const resultado = placeVertex(layout, 'v1', point(100, 100));

    expect(resultado).toBe(layout);
    expect(at(resultado, 'v1')).toEqual(point(1, 2));
  });

  it.each([
    point(Number.NaN, 0),
    point(0, Number.NaN),
    point(Number.POSITIVE_INFINITY, 0),
    point(0, Number.NEGATIVE_INFINITY),
  ])('coordenada inválida %p: devolve o mesmo layout e nada é criado', (invalida) => {
    const layout = emptyLayout('g');

    expect(placeVertex(layout, 'v1', invalida)).toBe(layout);
  });

  it('coordenadas negativas e fracionárias valem; -0 vira 0', () => {
    const layout = placeVertex(placeVertex(emptyLayout('g'), 'v1', point(-120.75, -0.5)), 'v2', point(-0, -0));

    expect(at(layout, 'v1')).toEqual(point(-120.75, -0.5));
    expect(Object.is(at(layout, 'v2').x, 0)).toBe(true);
    expect(Object.is(at(layout, 'v2').y, 0)).toBe(true);
  });

  it('posições sobrepostas são aceitas (a regra de distância é só do posicionamento automático)', () => {
    const layout = layoutOf('g', [['v1', 0, 0], ['v2', 0, 0]]);

    expect(keysOf(layout)).toStrictEqual(['v1', 'v2']);
  });
});

describe('moveVertex', () => {
  it('muda só a posição do vértice; as outras continuam sendo os mesmos objetos', () => {
    const antes = layoutOf('g', [['v1', 1, 2], ['v2', 3, 4], ['v3', 5, 6]]);
    const depois = moveVertex(antes, 'v2', point(30, -40));

    expect(at(depois, 'v2')).toEqual(point(30, -40));
    expect(at(depois, 'v1')).toBe(at(antes, 'v1'));
    expect(at(depois, 'v3')).toBe(at(antes, 'v3'));
    expect(at(antes, 'v2')).toEqual(point(3, 4)); // o layout anterior não mudou
    expect(keysOf(depois)).toStrictEqual(['v1', 'v2', 'v3']); // a ordem se mantém
  });

  it('um vértice SEM posição não é criado: devolve o mesmo layout', () => {
    const layout = layoutOf('g', [['v1', 1, 2]]);
    const resultado = moveVertex(layout, 'v9', point(5, 5));

    expect(resultado).toBe(layout);
    expect(positionOf(resultado, 'v9')).toBeUndefined();
  });

  it('a mesma posição devolve o mesmo layout; -0 conta como 0', () => {
    const layout = layoutOf('g', [['v1', 0, 7]]);

    expect(moveVertex(layout, 'v1', point(0, 7))).toBe(layout);
    expect(moveVertex(layout, 'v1', point(-0, 7))).toBe(layout);
  });

  it.each([point(Number.NaN, 1), point(1, Number.POSITIVE_INFINITY)])('coordenada inválida %p: o mesmo layout', (invalida) => {
    const layout = layoutOf('g', [['v1', 1, 2]]);

    expect(moveVertex(layout, 'v1', invalida)).toBe(layout);
  });

  it('copia o ponto recebido', () => {
    const recebido = { x: 8, y: 9 };
    const layout = moveVertex(layoutOf('g', [['v1', 1, 2]]), 'v1', recebido);
    recebido.y = -1;

    expect(at(layout, 'v1')).toEqual(point(8, 9));
  });
});

describe('removePosition', () => {
  it('remove uma posição e preserva as demais (mesmos objetos)', () => {
    const antes = layoutOf('g', [['v1', 1, 2], ['v2', 3, 4], ['v3', 5, 6]]);
    const depois = removePosition(antes, 'v2');

    expect(keysOf(depois)).toStrictEqual(['v1', 'v3']);
    expect(positionOf(depois, 'v2')).toBeUndefined();
    expect(at(depois, 'v1')).toBe(at(antes, 'v1'));
    expect(at(depois, 'v3')).toBe(at(antes, 'v3'));
    expect(keysOf(antes)).toStrictEqual(['v1', 'v2', 'v3']);
  });

  it('um vértice sem posição devolve o mesmo layout', () => {
    const layout = layoutOf('g', [['v1', 1, 2]]);

    expect(removePosition(layout, 'v9')).toBe(layout);
  });
});

describe('positionOf: chaves seguras', () => {
  const PERIGOSAS = ['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', '__defineGetter__'];

  it.each(PERIGOSAS)('o id "%s" não existe num layout vazio, e o objeto de posições não herda nada', (id) => {
    const layout = emptyLayout('g');

    expect(positionOf(layout, id)).toBeUndefined();
    expect((layout.positions as Record<string, unknown>)[id]).toBeUndefined();
    expect(id in layout.positions).toBe(false);
  });

  it.each(PERIGOSAS)('o id "%s" pode ser posicionado, movido e removido como qualquer outro, sem poluir nada', (id) => {
    const base = layoutOf('g', [['v1', 1, 1]]);
    const colocado = placeVertex(base, id, point(7, 8));

    expect(positionOf(colocado, id)).toEqual(point(7, 8));
    expect(positionOf(colocado, 'v1')).toBe(at(base, 'v1'));
    expect(keysOf(colocado)).toStrictEqual(['v1', id]);
    expect(positionOf(moveVertex(colocado, id, point(0, 0)), id)).toEqual(point(0, 0));
    expect(keysOf(removePosition(colocado, id))).toStrictEqual(['v1']);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    expect(Object.getPrototypeOf(colocado.positions)).toBeNull();
  });

  it('só propriedades próprias contam; um id ausente é undefined, não uma função herdada', () => {
    const layout = layoutOf('g', [['v1', 1, 2]]);

    expect(positionOf(layout, 'v1')).toEqual(point(1, 2));
    expect(positionOf(layout, 'v2')).toBeUndefined();
    expect(positionOf(layout, '')).toBeUndefined();
  });
});

describe('boundsOf', () => {
  it('sem posições: undefined (é o "sem conteúdo" do fitToBounds)', () => {
    expect(boundsOf(emptyLayout('g'))).toBeUndefined();
  });

  it('um vértice: limites degenerados no próprio ponto', () => {
    expect(boundsOf(layoutOf('g', [['v1', 3, -4]]))).toStrictEqual({ minX: 3, minY: -4, maxX: 3, maxY: -4 });
  });

  it('mínimos e máximos são independentes por eixo (valores negativos e positivos)', () => {
    const layout = layoutOf('g', [['v1', -5, 10], ['v2', 3, -2], ['v3', 0, 7]]);

    expect(boundsOf(layout)).toStrictEqual({ minX: -5, minY: -2, maxX: 3, maxY: 10 });
  });

  it('a ordem em que as posições foram inseridas não muda o resultado', () => {
    const entradas = [['v1', -5, 10], ['v2', 3, -2], ['v3', 0, 7], ['v4', 12.5, 1]] as const;
    const direto = boundsOf(layoutOf('g', entradas));
    const invertido = boundsOf(layoutOf('g', [...entradas].reverse()));

    expect(invertido).toStrictEqual(direto);
  });

  it('cobre os centros dos vértices (não o raio visual) e não altera o layout', () => {
    const layout = deepFreeze(layoutOf('g', [['v1', 0, 0], ['v2', 100, 50]]));
    const antes = JSON.stringify(layout);

    expect(boundsOf(layout)).toStrictEqual({ minX: 0, minY: 0, maxX: 100, maxY: 50 });
    expect(JSON.stringify(layout)).toBe(antes);
  });
});

describe('imutabilidade e referências compartilhadas', () => {
  it('layouts, posições e pontos são congelados; escrever neles não muda nada', () => {
    const layout = layoutOf('g', [['v1', 1, 2]]);
    for (const alvo of [layout as { graphId: string }, layout.positions as Record<string, unknown>, at(layout, 'v1') as { x: number }]) {
      try {
        (alvo as Record<string, unknown>).graphId = 'outro';
        (alvo as Record<string, unknown>).x = 99;
        (alvo as Record<string, unknown>).v9 = 1;
      } catch {
        // em modo estrito lança; fora dele é ignorado
      }
    }

    expect(Object.isFrozen(layout)).toBe(true);
    expect(JSON.stringify(layout)).toBe('{"graphId":"g","positions":{"v1":{"x":1,"y":2}}}');
  });

  it('50 operações aleatórias contra um modelo de referência (Map): cada versão do layout continua intacta', () => {
    const random = seededRandom(2026);
    const ids = ['v1', 'v2', 'v3', 'v4', 'v5', '__proto__', 'constructor'];
    const modelo = new Map<string, Point>();
    let layout = emptyLayout('g');
    const historico: { layout: GraphLayout; foto: string }[] = [];

    for (let passo = 0; passo < 50; passo++) {
      const id = ids[Math.floor(random() * ids.length)]!;
      const ponto = point(Math.round((random() * 2 - 1) * 1000) / 10, Math.round((random() * 2 - 1) * 1000) / 10);
      const sorte = random();
      if (sorte < 0.4) {
        layout = placeVertex(layout, id, ponto);
        if (!modelo.has(id)) modelo.set(id, ponto);
      } else if (sorte < 0.75) {
        layout = moveVertex(layout, id, ponto);
        if (modelo.has(id)) modelo.set(id, ponto);
      } else {
        layout = removePosition(layout, id);
        modelo.delete(id);
      }

      expect(keysOf(layout).sort()).toStrictEqual([...modelo.keys()].sort());
      for (const [chave, esperado] of modelo) expect(positionOf(layout, chave)).toEqual(esperado);
      historico.push({ layout, foto: JSON.stringify(layout) });
    }

    // nenhuma versão antiga foi alterada por uma atualização posterior
    for (const { layout: versao, foto } of historico) expect(JSON.stringify(versao)).toBe(foto);
  });
});

// ---------------------------------------------------------------------------------------------
// circularLayout
// ---------------------------------------------------------------------------------------------

describe('circularLayout: casos pequenos calculados à mão (espaçamento 96)', () => {
  it('zero vértices: layout vazio do grafo', () => {
    const layout = circularLayout(buildGraph('g0', 0));

    expect(layout.graphId).toBe('g0');
    expect(keysOf(layout)).toStrictEqual([]);
  });

  it('um vértice: (0, 0)', () => {
    expect(circularLayout(buildGraph('g1', 1)).positions).toEqual({ v1: { x: 0, y: 0 } });
  });

  it('um vértice continua em (0, 0) mesmo com raio mínimo', () => {
    expect(circularLayout(buildGraph('g1', 1), { minRadius: 500 }).positions).toEqual({ v1: { x: 0, y: 0 } });
  });

  it('dois vértices: simétricos em relação à origem, a 96 um do outro (R = 96 / 2 = 48)', () => {
    expect(circularLayout(buildGraph('g2', 2)).positions).toEqual({ v1: { x: 0, y: -48 }, v2: { x: 0, y: 48 } });
  });

  it('três vértices: triângulo equilátero (R = 96/√3 ≈ 55,426), o primeiro no topo, depois o da direita e o da esquerda', () => {
    expect(circularLayout(buildGraph('g3', 3)).positions).toEqual({
      v1: { x: 0, y: -55.426 },
      v2: { x: 48, y: 27.713 },
      v3: { x: -48, y: 27.713 },
    });
  });

  it('quatro vértices: quadrado (R = 96/√2 ≈ 67,882): topo, direita, base, esquerda (sentido horário na tela)', () => {
    expect(circularLayout(buildGraph('g4', 4)).positions).toEqual({
      v1: { x: 0, y: -67.882 },
      v2: { x: 67.882, y: 0 },
      v3: { x: 0, y: 67.882 },
      v4: { x: -67.882, y: 0 },
    });
  });

  it('o espaçamento é configurável: com 50, o quadrado tem R = 50/√2 ≈ 35,355', () => {
    expect(circularLayout(buildGraph('g4', 4), { spacing: 50 }).positions).toEqual({
      v1: { x: 0, y: -35.355 },
      v2: { x: 35.355, y: 0 },
      v3: { x: 0, y: 35.355 },
      v4: { x: -35.355, y: 0 },
    });
  });

  it('o raio mínimo vale quando maior que o necessário (R = 500)', () => {
    const layout = circularLayout(buildGraph('g4', 4), { minRadius: 500 });

    expect(layout.positions).toEqual({ v1: { x: 0, y: -500 }, v2: { x: 500, y: 0 }, v3: { x: 0, y: 500 }, v4: { x: -500, y: 0 } });
  });

  it('o raio mínimo menor que o necessário não encolhe o círculo', () => {
    expect(circularLayout(buildGraph('g4', 4), { minRadius: 10 })).toEqual(circularLayout(buildGraph('g4', 4)));
  });
});

describe('circularLayout: regras', () => {
  it('o primeiro vértice está no topo (x = 0, o menor y) e o sentido é horário na tela, qualquer que seja n', () => {
    for (let n = 2; n <= 40; n++) {
      const graph = buildGraph('g', n);
      const layout = circularLayout(graph);
      const pontos = pointsOf(layout, idsOf(graph));

      expect(pontos[0]!.x).toBe(0);
      expect(pontos[0]!.y).toBe(Math.min(...pontos.map((p) => p.y))); // o topo (Y para baixo = o menor y)
      // horário na tela: a "área com sinal" no sistema com Y para baixo é positiva (com 2 vértices o polígono é degenerado)
      let area = 0;
      pontos.forEach((p, i) => {
        const q = pontos[(i + 1) % n]!;
        area += p.x * q.y - q.x * p.y;
      });
      if (n === 2) expect(area).toBe(0);
      else expect(area).toBeGreaterThan(0);
      // o segundo vértice está do lado direito da tela (x > 0) a partir de n = 3, e no lado de baixo com n = 2
      if (n >= 3) expect(pontos[1]!.x).toBeGreaterThan(0);
    }
  });

  it('o círculo é centrado na origem e todos os vértices ficam a uma mesma distância dela (R)', () => {
    for (const n of [3, 5, 8, 13, 50]) {
      const pontos = pointsOf(circularLayout(buildGraph('g', n)), idsOf(buildGraph('g', n)));
      const raio = 96 / (2 * Math.sin(Math.PI / n));
      const centroX = pontos.reduce((soma, p) => soma + p.x, 0) / n;
      const centroY = pontos.reduce((soma, p) => soma + p.y, 0) / n;

      expect(Math.abs(centroX)).toBeLessThan(0.002);
      expect(Math.abs(centroY)).toBeLessThan(0.002);
      for (const p of pontos) expect(Math.abs(Math.hypot(p.x, p.y) - raio)).toBeLessThan(0.001);
    }
  });

  it('a distância entre vizinhos (inclusive do último ao primeiro) é a do espaçamento, a menos do arredondamento', () => {
    for (const spacing of [96, 50, 200, 1, 1000]) {
      for (let n = 2; n <= 60; n++) {
        const graph = buildGraph('g', n);
        const pontos = pointsOf(circularLayout(graph, { spacing }), idsOf(graph));
        // com o arredondamento a 3 casas a corda pode perder até ≈ 0,0015; o espaçamento 1 usa a mesma tolerância absoluta
        pontos.forEach((p, i) => {
          const vizinho = pontos[(i + 1) % n]!;
          expect(distance(p, vizinho)).toBeGreaterThanOrEqual(spacing - ROUNDING_TOLERANCE);
          expect(distance(p, vizinho)).toBeLessThanOrEqual(spacing + ROUNDING_TOLERANCE);
        });
        // e dois vértices quaisquer ficam pelo menos a essa distância
        expect(minPairDistance(pontos)).toBeGreaterThanOrEqual(spacing - ROUNDING_TOLERANCE);
      }
    }
  });

  it('o raio usa a CORDA (spacing / (2 sin(π/n))) e não o comprimento do arco: a fórmula antiga ficaria mais curta', () => {
    const n = 6;
    const corda = 96 / (2 * Math.sin(Math.PI / n)); // 96
    const arco = (96 * n) / (2 * Math.PI); // ≈ 91,67: com esse raio a corda seria < 96
    const pontos = pointsOf(circularLayout(buildGraph('g', n)), idsOf(buildGraph('g', n)));

    expect(corda).toBeCloseTo(96, 10);
    expect(arco).toBeLessThan(corda);
    expect(minPairDistance(pontos)).toBeGreaterThanOrEqual(96 - ROUNDING_TOLERANCE);
    expect(2 * arco * Math.sin(Math.PI / n)).toBeLessThan(96 - 1); // a fórmula antiga viola o espaçamento
  });

  it('as coordenadas têm no máximo 3 casas decimais e nenhuma é -0', () => {
    for (let n = 1; n <= 30; n++) {
      const graph = buildGraph('g', n);
      for (const p of pointsOf(circularLayout(graph), idsOf(graph))) {
        for (const valor of [p.x, p.y]) {
          expect(Math.abs(valor * 1000 - Math.round(valor * 1000))).toBeLessThan(1e-6);
          expect(Object.is(valor, -0)).toBe(false);
        }
      }
    }
  });

  it('segue a ordem de inserção dos vértices, mesmo com ids em lacunas (depois de remoções)', () => {
    // v1, v3, v4 permanecem; v5 entra no fim
    const graph = withNewVertex(withoutVertex(buildGraph('g', 4), 'v2'));
    const layout = circularLayout(graph);

    expect(idsOf(graph)).toStrictEqual(['v1', 'v3', 'v4', 'v5']);
    expect(keysOf(layout)).toStrictEqual(['v1', 'v3', 'v4', 'v5']);
    expect(layout.positions).toEqual({
      v1: { x: 0, y: -67.882 },
      v3: { x: 67.882, y: 0 },
      v4: { x: 0, y: 67.882 },
      v5: { x: -67.882, y: 0 },
    });
  });

  it('não depende de rótulos: rótulos iguais em ids diferentes e rótulos trocados dão o mesmo layout', () => {
    let iguais = createGraph({ id: 'g' });
    for (let i = 0; i < 4; i++) iguais = withNewVertex(iguais, 'A');
    let trocados = buildGraph('g', 4);
    trocados = must(setVertexLabel(trocados, 'v1', 'Zeta'));
    trocados = must(setVertexLabel(trocados, 'v3', 'alfa'));

    expect(circularLayout(iguais)).toEqual(circularLayout(buildGraph('g', 4)));
    expect(circularLayout(trocados)).toEqual(circularLayout(buildGraph('g', 4)));
    expect(keysOf(circularLayout(iguais))).toStrictEqual(['v1', 'v2', 'v3', 'v4']);
  });

  it('não depende das arestas nem da orientação: grafo com e sem arestas, orientado ou não, desconexo e com isolados', () => {
    const vazio = buildGraph('g', 6);
    let conexo = buildGraph('g', 6, true);
    conexo = must(addEdge(conexo, { source: 'v1', target: 'v2' })).graph;
    conexo = must(addEdge(conexo, { source: 'v2', target: 'v1' })).graph; // arco oposto
    conexo = must(addEdge(conexo, { source: 'v4', target: 'v5', weight: 0 })).graph; // v3 e v6 isolados; dois componentes

    expect(circularLayout(conexo)).toEqual(circularLayout(vazio));
    expect(circularLayout(buildGraph('g', 6, true))).toEqual(circularLayout(buildGraph('g', 6, false)));
  });

  it('o layout leva o id do grafo, e grafos diferentes com os mesmos ids de vértice têm layouts de donos diferentes', () => {
    const a = circularLayout(buildGraph('grafo-a', 3));
    const b = circularLayout(buildGraph('grafo-b', 3));

    expect(a.graphId).toBe('grafo-a');
    expect(b.graphId).toBe('grafo-b');
    expect(a.positions).toEqual(b.positions);
  });

  it('opções inválidas valem como o padrão (sem exceção)', () => {
    const graph = buildGraph('g', 5);
    const padrao = circularLayout(graph);

    for (const spacing of [Number.NaN, 0, -3, Number.POSITIVE_INFINITY, undefined]) {
      expect(circularLayout(graph, { spacing })).toEqual(padrao);
    }
    for (const minRadius of [Number.NaN, -1, Number.POSITIVE_INFINITY, undefined]) {
      expect(circularLayout(graph, { minRadius })).toEqual(padrao);
    }
  });

  it('é determinístico e não altera o grafo (grafo congelado)', () => {
    const graph = deepFreeze(buildGraph('g', 9));
    const antes = JSON.stringify(graph);

    expect(circularLayout(graph)).toStrictEqual(circularLayout(graph));
    expect(JSON.stringify(graph)).toBe(antes);
  });

  it('um grafo grande continua finito e com todos os vértices distintos', () => {
    const graph = buildGraph('g', 3000);
    const layout = circularLayout(graph);
    const pontos = pointsOf(layout, idsOf(graph));

    expect(keysOf(layout)).toHaveLength(3000);
    expect(pontos.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    expect(distance(pontos[0]!, pontos[1]!)).toBeGreaterThanOrEqual(96 - ROUNDING_TOLERANCE);
  });
});

// ---------------------------------------------------------------------------------------------
// reconcileLayout
// ---------------------------------------------------------------------------------------------

describe('reconcileLayout: casos calculados à mão', () => {
  it('já reconciliado (uma posição por vértice e nenhuma a mais): devolve o próprio layout', () => {
    const graph = buildGraph('g', 5);
    const layout = circularLayout(graph);

    expect(reconcileLayout(graph, layout)).toBe(layout);
  });

  it('layout vazio e vários vértices: o mesmo que circularLayout', () => {
    const graph = buildGraph('g', 5);

    expect(reconcileLayout(graph, emptyLayout('g'))).toEqual(circularLayout(graph));
  });

  it('layout vazio e um vértice: (0, 0); grafo vazio: layout vazio', () => {
    expect(reconcileLayout(buildGraph('g', 1), emptyLayout('g')).positions).toEqual({ v1: { x: 0, y: 0 } });
    const vazio = emptyLayout('g');

    expect(reconcileLayout(buildGraph('g', 0), vazio)).toBe(vazio);
  });

  it('grafo sem vértices e layout só com órfãs: layout vazio', () => {
    const resultado = reconcileLayout(buildGraph('g', 0), layoutOf('g', [['v1', 1, 1], ['v2', 2, 2]]));

    expect(resultado.graphId).toBe('g');
    expect(keysOf(resultado)).toStrictEqual([]);
  });

  it('remove as posições órfãs e preserva as dos vértices que ficaram (mesmos objetos)', () => {
    const completo = layoutOf('g', [['v1', 0, 0], ['v2', 100, 0], ['v3', 200, 0], ['v4', 300, 0]]);
    const graph = withoutVertex(buildGraph('g', 4), 'v2');
    const resultado = reconcileLayout(graph, completo);

    expect(keysOf(resultado)).toStrictEqual(['v1', 'v3', 'v4']);
    for (const id of ['v1', 'v3', 'v4']) expect(at(resultado, id)).toBe(at(completo, id));
    expect(positionOf(resultado, 'v2')).toBeUndefined();
  });

  it('um vértice novo depois de remoções ganha posição e o id removido nunca volta', () => {
    const antigo = circularLayout(buildGraph('g', 3));
    const graph = withNewVertex(withoutVertex(buildGraph('g', 3), 'v2')); // v1, v3, v4
    const resultado = reconcileLayout(graph, antigo);

    expect(keysOf(resultado)).toStrictEqual(['v1', 'v3', 'v4']);
    expect(at(resultado, 'v1')).toBe(at(antigo, 'v1'));
    expect(at(resultado, 'v3')).toBe(at(antigo, 'v3'));
    expect(positionOf(resultado, 'v4')).toBeDefined();
  });

  it('layout parcial: o primeiro vértice novo vai ao centroide dos preservados; o seguinte, ao primeiro ponto livre do anel de 96', () => {
    // preservados v1 (0, 0) e v2 (200, 0): centroide (100, 0), a 100 de cada um (≥ 96)
    const parcial = layoutOf('g', [['v1', 0, 0], ['v2', 200, 0]]);
    const resultado = reconcileLayout(buildGraph('g', 4), parcial);

    expect(resultado.positions).toEqual({
      v1: { x: 0, y: 0 },
      v2: { x: 200, y: 0 },
      v3: { x: 100, y: 0 },
      v4: { x: 100, y: -96 }, // anel 1, primeiro candidato (topo): a 96 de v3 e a ≈ 138 dos outros
    });
    expect(at(resultado, 'v1')).toBe(at(parcial, 'v1'));
    expect(at(resultado, 'v2')).toBe(at(parcial, 'v2'));
  });

  it('o centroide usa os DOIS eixos: preservados em (0, 0) e (200, 400) dão centroide (100, 200)', () => {
    const parcial = layoutOf('g', [['v1', 0, 0], ['v2', 200, 400]]);
    const resultado = reconcileLayout(buildGraph('g', 4), parcial);

    expect(at(resultado, 'v3')).toEqual({ x: 100, y: 200 });
    expect(at(resultado, 'v4')).toEqual({ x: 100, y: 104 }); // anel 1, topo: a exatos 96 de v3
  });

  it('busca em anéis: um preservado em (0, 0) e quatro novos; candidatos do anel 1 (7 deles, 51,43° cada, no sentido horário a partir do topo)', () => {
    // (valores conferidos por uma reimplementação independente da regra, fora do código testado)
    // v2: o centroide (0, 0) está ocupado; o 1º candidato do anel 1 é o topo (0, −96), a EXATOS 96 de v1 (a comparação é "< 96"), livre.
    // v3: o topo agora está ocupado (por v2); o 2º candidato (−38,6°: 75,056; −59,855) está a 83,3 de v2; o 3º (12,9°: 93,593; 21,362)
    //     está a 95,9999 de v1 — exatamente 96 antes de arredondar a 3 casas, e o arredondamento o empurra para dentro; o 4º (64,3°) é o
    //     primeiro livre: (41,653; 86,493).
    // v4: nenhum dos 7 candidatos do anel 1 serve (cada um está a < 96 de v1, de v2 ou de v3); o 1º do anel 2 (topo, raio 192) está a
    //     exatos 96 de v2 e livre: (0, −192).
    // v5: no anel 2, o topo está ocupado (v4), o 2º candidato (89,227; −170,008) está a 91,9 de v4 e o 3º (−34,6°) é o primeiro livre.
    const resultado = reconcileLayout(buildGraph('g', 5), layoutOf('g', [['v1', 0, 0]]));

    expect(resultado.positions).toEqual({
      v1: { x: 0, y: 0 },
      v2: { x: 0, y: -96 },
      v3: { x: 41.653, y: 86.493 },
      v4: { x: 0, y: -192 },
      v5: { x: 158.013, y: -109.068 },
    });
    // e, seja qual for o valor exato, cada novo respeita a distância dos que já estavam ocupados quando ele entrou
    const todos = pointsOf(resultado, idsOf(buildGraph('g', 5)));
    for (let i = 1; i < todos.length; i++) {
      for (let j = 0; j < i; j++) expect(distance(todos[i]!, todos[j]!)).toBeGreaterThanOrEqual(96 - 1e-9);
    }
  });

  it('o espaçamento é configurável: com 300 o centroide (a 100 dos preservados) está ocupado e a busca passa ao anel de 300', () => {
    const parcial = layoutOf('g', [['v1', 0, 0], ['v2', 200, 0]]);
    const resultado = reconcileLayout(buildGraph('g', 3), parcial, { spacing: 300 });

    expect(at(resultado, 'v3')).toEqual({ x: 100, y: -300 }); // anel 1: raio 300, topo
    expect(distance(at(resultado, 'v3'), at(resultado, 'v1'))).toBeGreaterThanOrEqual(300);
    expect(distance(at(resultado, 'v3'), at(resultado, 'v2'))).toBeGreaterThanOrEqual(300);
  });

  it('posições sobrepostas na entrada são preservadas como estão; o novo respeita a distância de ambas', () => {
    const sobrepostas = layoutOf('g', [['v1', 0, 0], ['v2', 0, 0]]);
    const resultado = reconcileLayout(buildGraph('g', 3), sobrepostas);

    expect(at(resultado, 'v1')).toBe(at(sobrepostas, 'v1'));
    expect(at(resultado, 'v2')).toBe(at(sobrepostas, 'v2'));
    expect(at(resultado, 'v3')).toEqual({ x: 0, y: -96 }); // centroide (0, 0) ocupado → anel 1, topo
  });

  it('coordenadas negativas e fracionárias são preservadas exatamente', () => {
    const parcial = layoutOf('g', [['v1', -123.456789, 0.000001], ['v2', 7.25, -999.5]]);
    const resultado = reconcileLayout(buildGraph('g', 3), parcial);

    expect(at(resultado, 'v1')).toEqual({ x: -123.456789, y: 0.000001 });
    expect(at(resultado, 'v2')).toEqual({ x: 7.25, y: -999.5 });
  });

  it('posição inválida guardada (não finita, de um layout corrompido) conta como ausente', () => {
    const corrompido = {
      graphId: 'g',
      positions: { v1: { x: Number.NaN, y: 0 }, v2: { x: 10, y: 10 } },
    } as unknown as GraphLayout;
    const resultado = reconcileLayout(buildGraph('g', 2), corrompido);

    expect(at(resultado, 'v2')).toBe(at(corrompido, 'v2') as Point);
    expect(Number.isFinite(at(resultado, 'v1').x)).toBe(true);
    expect(distance(at(resultado, 'v1'), at(resultado, 'v2'))).toBeGreaterThanOrEqual(96);
  });

  it('todas as posições inválidas e nenhuma aproveitável: layout circular', () => {
    const corrompido = { graphId: 'g', positions: { v1: { x: Number.NaN, y: 0 } } } as unknown as GraphLayout;

    expect(reconcileLayout(buildGraph('g', 3), corrompido)).toEqual(circularLayout(buildGraph('g', 3)));
  });
});

describe('reconcileLayout: layout de outro grafo', () => {
  it('não reaproveita nenhuma posição de ids coincidentes: devolve o layout inicial do grafo recebido', () => {
    const outro = layoutOf('grafo-b', [['v1', 1000, 1000], ['v2', -1000, -1000], ['v3', 5, 5]]);
    const graph = buildGraph('grafo-a', 3);
    const resultado = reconcileLayout(graph, outro);

    expect(resultado.graphId).toBe('grafo-a');
    expect(resultado).toEqual(circularLayout(graph));
    for (const id of ['v1', 'v2', 'v3']) expect(at(resultado, id)).not.toBe(at(outro, id));
  });

  it('o espaçamento recebido vale também ao refazer em círculo (outro grafo, ou nenhuma posição aproveitável)', () => {
    const graph = buildGraph('grafo-a', 5);

    expect(reconcileLayout(graph, layoutOf('grafo-b', [['v1', 9, 9]]), { spacing: 50 })).toEqual(circularLayout(graph, { spacing: 50 }));
    expect(reconcileLayout(graph, layoutOf('grafo-a', [['v77', 9, 9]]), { spacing: 50 })).toEqual(circularLayout(graph, { spacing: 50 }));
    expect(reconcileLayout(graph, emptyLayout('grafo-a'), { spacing: 50 })).toEqual(circularLayout(graph, { spacing: 50 }));
    expect(circularLayout(graph, { spacing: 50 })).not.toEqual(circularLayout(graph));
  });

  it('o mesmo vale para um layout vazio de outro grafo', () => {
    const resultado = reconcileLayout(buildGraph('grafo-a', 2), emptyLayout('grafo-b'));

    expect(resultado.graphId).toBe('grafo-a');
    expect(keysOf(resultado)).toStrictEqual(['v1', 'v2']);
  });

  it('um grafo diferente com o mesmo número de vértices e ids não "herda" o layout (graphId comparado por igualdade exata)', () => {
    const layout = circularLayout(buildGraph('G', 3));

    expect(reconcileLayout(buildGraph('g', 3), layout).graphId).toBe('g');
    expect(reconcileLayout(buildGraph('g', 3), layout)).not.toBe(layout);
  });
});

describe('reconcileLayout: ids e rótulos', () => {
  it('mudar rótulos não muda nada: a associação é pelo id técnico', () => {
    const graph = buildGraph('g', 5);
    const parcial = layoutOf('g', [['v1', 0, 0], ['v3', 300, 0], ['v5', 0, 300]]);
    let renomeado = must(setVertexLabel(graph, 'v1', 'Outro nome'));
    renomeado = must(setVertexLabel(renomeado, 'v3', 'v5')); // rótulo que parece o id de outro vértice

    expect(reconcileLayout(renomeado, parcial)).toEqual(reconcileLayout(graph, parcial));
  });

  it('ids diferentes com rótulos iguais recebem posições diferentes', () => {
    let graph = createGraph({ id: 'g' });
    for (let i = 0; i < 4; i++) graph = withNewVertex(graph, 'A');
    const resultado = reconcileLayout(graph, emptyLayout('g'));

    expect(new Set(pointsOf(resultado, idsOf(graph)).map((p) => `${p.x},${p.y}`)).size).toBe(4);
  });

  it('a ordem das propriedades do layout recebido não importa', () => {
    const graph = buildGraph('g', 5);
    const entradas = [['v1', 0, 0], ['v3', 300, 0], ['v5', 0, 300]] as const;
    const direto = reconcileLayout(graph, layoutOf('g', entradas));
    const invertido = reconcileLayout(graph, layoutOf('g', [...entradas].reverse()));

    expect(invertido).toEqual(direto);
    expect(keysOf(invertido)).toStrictEqual(idsOf(graph)); // o resultado sai na ordem dos vértices
  });
});

describe('reconcileLayout: busca de posição livre', () => {
  it('um aglomerado de 30 posições quase iguais e 6 vértices novos: todos os novos a pelo menos 96 de todos os ocupados', () => {
    const random = seededRandom(4);
    const entradas: [string, number, number][] = Array.from({ length: 30 }, (_, i) => [`v${i + 1}`, random() * 10, random() * 10]);
    const graph = buildGraph('g', 36);
    const resultado = reconcileLayout(graph, layoutOf('g', entradas));
    const todos = pointsOf(resultado, idsOf(graph));

    for (let i = 30; i < 36; i++) {
      for (let j = 0; j < 36; j++) {
        if (j !== i && (j < 30 || j < i)) expect(distance(todos[i]!, todos[j]!)).toBeGreaterThanOrEqual(96 - 1e-9);
      }
    }
    expect(minPairDistance(todos.slice(30))).toBeGreaterThanOrEqual(96 - 1e-9);
  });

  it('termina com espaçamentos extremos (sem laço infinito, sem NaN) e os novos continuam a ≥ espaçamento de todos os outros', () => {
    // com espaçamento minúsculo o arredondamento a 3 casas colapsa todos os candidatos no centroide: entra o recurso de fallback
    const graph = buildGraph('g', 6);
    for (const spacing of [1e-9, 1e-3, 1, 1e6, 1e150]) {
      const resultado = reconcileLayout(graph, layoutOf('g', [['v1', 0, 0]]), { spacing });
      const todos = pointsOf(resultado, idsOf(graph));

      expect(keysOf(resultado)).toHaveLength(6);
      expect(todos.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
      expect(minPairDistance(todos)).toBeGreaterThanOrEqual(spacing * (1 - 1e-9));
    }
  });

  it('fallback: espaçamento menor que a resolução de 0,001 vai para a direita de todos, na altura do centroide', () => {
    // todos os candidatos dos anéis arredondam para o próprio centroide (0, 5), ocupado; sobra o ponto à direita de v1:
    // ⌈(0 + 1e-9)·1000 + 1⌉ / 1000 = 0,002
    const resultado = reconcileLayout(buildGraph('g', 3), layoutOf('g', [['v1', 0, 5]]), { spacing: 1e-9 });

    expect(resultado.positions).toEqual({ v1: { x: 0, y: 5 }, v2: { x: 0.002, y: 5 }, v3: { x: 0.004, y: 5 } });
  });

  it('coordenadas gigantes (≈ 1e308) não estouram o centroide nem geram NaN/Infinity', () => {
    const graph = buildGraph('g', 4);
    const longe = reconcileLayout(graph, layoutOf('g', [['v1', 1e300, -1e300]]));
    const imenso = reconcileLayout(graph, layoutOf('g', [['v1', 1.7e308, 1.7e308], ['v2', 1.7e308, -1.7e308]]));

    for (const resultado of [longe, imenso]) {
      expect(keysOf(resultado)).toStrictEqual(idsOf(graph));
      expect(pointsOf(resultado, idsOf(graph)).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    }
    // o centroide de (1,7e308, ±1,7e308) é (1,7e308, 0), e é nele que entra o primeiro novo
    expect(at(imenso, 'v3')).toEqual({ x: 1.7e308, y: 0 });
  });

  it('opção de espaçamento inválida vale como o padrão', () => {
    const graph = buildGraph('g', 4);
    const parcial = layoutOf('g', [['v1', 0, 0], ['v2', 200, 0]]);
    const padrao = reconcileLayout(graph, parcial);

    for (const spacing of [Number.NaN, 0, -5, Number.POSITIVE_INFINITY]) {
      expect(reconcileLayout(graph, parcial, { spacing })).toEqual(padrao);
    }
  });
});

describe('reconcileLayout: propriedades (sementes fixas)', () => {
  /** Grafo aleatório com remoções e rótulos repetidos; e um layout parcial, com órfãs e posições sobrepostas. */
  function randomCase(seed: number) {
    const random = seededRandom(seed);
    let graph = buildGraph('g', 1 + Math.floor(random() * 12));
    for (let passo = 0; passo < 8; passo++) {
      if (random() < 0.4 && graph.vertices.length > 0) {
        graph = withoutVertex(graph, graph.vertices[Math.floor(random() * graph.vertices.length)]!.id);
      } else {
        graph = withNewVertex(graph, random() < 0.5 ? 'A' : undefined);
      }
    }
    let layout = emptyLayout('g');
    const sobreposta = point(Math.round(random() * 100), Math.round(random() * 100));
    for (const vertex of graph.vertices) {
      const sorte = random();
      if (sorte < 0.5) layout = placeVertex(layout, vertex.id, sorte < 0.1 ? sobreposta : point((random() * 2 - 1) * 500, (random() * 2 - 1) * 500));
    }
    for (let k = 0; k < 3; k++) layout = placeVertex(layout, `v${100 + k}`, point(random() * 50, random() * 50)); // órfãs
    return { graph, layout };
  }

  it('600 casos: uma posição por vértice e nenhuma órfã; preservadas exatamente; idempotente; novos a ≥ 96 dos ocupados', () => {
    const contagem = { semNovos: 0, comNovos: 0, circular: 0 };
    for (let seed = 1; seed <= 600; seed++) {
      const { graph, layout } = randomCase(seed);
      const ids = idsOf(graph);
      const resultado = reconcileLayout(graph, layout);

      // 1 a 3: toda posição é de um vértice existente, todo vértice tem uma, e não há duas
      expect(resultado.graphId).toBe(graph.id);
      expect(keysOf(resultado)).toStrictEqual(ids);
      expect(new Set(keysOf(resultado)).size).toBe(ids.length);
      expect(ids.every((id) => positionOf(resultado, id) !== undefined)).toBe(true);

      // 4: reconciliar de novo não muda nada (e devolve o mesmo objeto)
      expect(reconcileLayout(graph, resultado)).toBe(resultado);

      // 5: as posições preservadas são exatamente as mesmas; as novas respeitam a distância de todas as ocupadas antes delas
      const novos = ids.filter((id) => positionOf(layout, id) === undefined);
      const ocupadas: Point[] = ids.filter((id) => positionOf(layout, id) !== undefined).map((id) => at(layout, id));
      for (const id of ids) if (positionOf(layout, id) !== undefined) expect(at(resultado, id)).toBe(at(layout, id));
      if (ocupadas.length > 0) {
        for (const id of novos) {
          const novo = at(resultado, id);
          for (const outra of ocupadas) expect(distance(novo, outra)).toBeGreaterThanOrEqual(96 - 1e-9);
          ocupadas.push(novo);
        }
        if (novos.length === 0) contagem.semNovos++;
        else contagem.comNovos++;
      } else {
        contagem.circular++;
        expect(resultado).toEqual(circularLayout(graph));
      }

      // 6: determinismo (mesmos argumentos, mesmo resultado)
      expect(reconcileLayout(graph, layout)).toEqual(resultado);
    }

    expect(contagem.semNovos).toBeGreaterThan(5);
    expect(contagem.comNovos).toBeGreaterThan(300);
    expect(contagem.circular).toBeGreaterThan(5);
  });

  it('o resultado não muda se os vértices forem renomeados (mudança de rótulo não altera a associação por id)', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const { graph, layout } = randomCase(seed);
      let renomeado = graph;
      for (const vertex of graph.vertices) renomeado = must(setVertexLabel(renomeado, vertex.id, `rótulo ${seed}-${vertex.id}`));

      expect(reconcileLayout(renomeado, layout)).toEqual(reconcileLayout(graph, layout));
    }
  });

  it('as exclusões não deixam órfãs: remover vértices e reconciliar descarta exatamente as posições deles', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const random = seededRandom(seed);
      const graph = buildGraph('g', 3 + Math.floor(random() * 10));
      let layout = circularLayout(graph);
      let restante = graph;
      const removidos: string[] = [];
      for (const vertex of graph.vertices) {
        if (random() < 0.4 && restante.vertices.length > 1) {
          restante = withoutVertex(restante, vertex.id);
          removidos.push(vertex.id);
        }
      }
      layout = reconcileLayout(restante, layout);

      expect(keysOf(layout)).toStrictEqual(idsOf(restante));
      for (const id of removidos) expect(positionOf(layout, id)).toBeUndefined();
    }
  });

  it('não usa aleatoriedade nem relógio: o resultado é o mesmo com Math.random e Date.now proibidos', () => {
    const casos = [randomCase(1), randomCase(2), randomCase(3)];
    const esperado = casos.map(({ graph, layout }) => [reconcileLayout(graph, layout), circularLayout(graph)]);
    const proibido = (nome: string) => () => {
      throw new Error(`${nome} não deve ser usado`);
    };
    const espioes = [jest.spyOn(Math, 'random').mockImplementation(proibido('Math.random')), jest.spyOn(Date, 'now').mockImplementation(proibido('Date.now'))];
    let obtido: unknown[];
    try {
      obtido = casos.map(({ graph, layout }) => [reconcileLayout(graph, layout), circularLayout(graph)]);
    } finally {
      for (const espiao of espioes) espiao.mockRestore();
    }

    expect(obtido).toStrictEqual(esperado);
  });

  it('não altera os argumentos (grafo e layout congelados e comparados com uma cópia)', () => {
    const { graph, layout } = randomCase(7);
    const congelados = deepFreeze({ graph: JSON.parse(JSON.stringify(graph)) as Graph });
    const antes = JSON.stringify([graph, layout]);

    reconcileLayout(graph, layout);
    reconcileLayout(congelados.graph, layout);

    expect(JSON.stringify([graph, layout])).toBe(antes);
  });
});

// ---------------------------------------------------------------------------------------------
// Integração com a câmera
// ---------------------------------------------------------------------------------------------

describe('integração com a câmera', () => {
  const viewport = { width: 360, height: 640 };

  it('o círculo é enquadrado no viewport com margem, quando os limites de escala permitem', () => {
    for (let n = 2; n <= 12; n++) {
      const graph = buildGraph('g', n);
      const layout = circularLayout(graph);
      const camera = fitToBounds(NEUTRAL_CAMERA, boundsOf(layout), viewport, { margin: 24 });

      expect(camera.scale).toBeGreaterThanOrEqual(0.25);
      for (const posicao of pointsOf(layout, idsOf(graph))) {
        const naTela = worldToScreen(camera, posicao);
        expect(naTela.x).toBeGreaterThanOrEqual(24 - 1e-6);
        expect(naTela.x).toBeLessThanOrEqual(viewport.width - 24 + 1e-6);
        expect(naTela.y).toBeGreaterThanOrEqual(24 - 1e-6);
        expect(naTela.y).toBeLessThanOrEqual(viewport.height - 24 + 1e-6);
      }
    }
  });

  it('o centro do círculo vai ao centro do viewport e a ida e volta mundo ↔ tela devolve cada posição', () => {
    const graph = buildGraph('g', 7);
    const layout = circularLayout(graph);
    const camera = fitToBounds(NEUTRAL_CAMERA, boundsOf(layout), viewport, { margin: 24 });
    const bounds = boundsOf(layout)!;
    const centro = worldToScreen(camera, point((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2));

    expect(centro.x).toBeCloseTo(180, 6);
    expect(centro.y).toBeCloseTo(320, 6);
    for (const posicao of pointsOf(layout, idsOf(graph))) {
      const volta = screenToWorld(camera, worldToScreen(camera, posicao));
      expect(volta.x).toBeCloseTo(posicao.x, 6);
      expect(volta.y).toBeCloseTo(posicao.y, 6);
    }
  });

  it('boundsOf cobre CENTROS: a margem em dp não cobre o raio visual (que cresce com a escala); o chamador deve expandir os limites em unidades de mundo', () => {
    const graph = buildGraph('g', 4);
    const layout = circularLayout(graph);
    const RAIO = 20; // raio do vértice em unidades de mundo (o desenho cresce com o zoom)
    const bounds = boundsOf(layout)!;

    // só com os centros e margem de 24 dp, a escala sobe (≈ 2,3) e o círculo de 20 unidades ocupa ≈ 46 dp: ultrapassa a borda
    const soCentros = fitToBounds(NEUTRAL_CAMERA, bounds, viewport, { margin: 24 });
    const direitaSoCentros = worldToScreen(soCentros, at(layout, 'v2')).x;

    expect(direitaSoCentros).toBeCloseTo(viewport.width - 24, 6); // o CENTRO respeita a margem
    expect(direitaSoCentros + RAIO * soCentros.scale).toBeGreaterThan(viewport.width); // o círculo, não

    // expandindo os limites pelo raio, em unidades de mundo, o círculo inteiro cabe (com a mesma margem de 24 dp)
    const expandido = { minX: bounds.minX - RAIO, minY: bounds.minY - RAIO, maxX: bounds.maxX + RAIO, maxY: bounds.maxY + RAIO };
    const camera = fitToBounds(NEUTRAL_CAMERA, expandido, viewport, { margin: 24 });
    for (const posicao of pointsOf(layout, idsOf(graph))) {
      const centro = worldToScreen(camera, posicao);
      const raioEmDp = RAIO * camera.scale;

      expect(centro.x - raioEmDp).toBeGreaterThanOrEqual(24 - 1e-6);
      expect(centro.x + raioEmDp).toBeLessThanOrEqual(viewport.width - 24 + 1e-6);
      expect(centro.y - raioEmDp).toBeGreaterThanOrEqual(24 - 1e-6);
      expect(centro.y + raioEmDp).toBeLessThanOrEqual(viewport.height - 24 + 1e-6);
    }
  });

  it('um grafo imenso não cabe: a escala para no mínimo e o conteúdo excede o viewport (limite da câmera)', () => {
    const layout = circularLayout(buildGraph('g', 2000));
    const camera = fitToBounds(NEUTRAL_CAMERA, boundsOf(layout), viewport, { margin: 24 });

    expect(camera.scale).toBe(0.25);
    const bounds = boundsOf(layout)!;
    expect((bounds.maxX - bounds.minX) * camera.scale).toBeGreaterThan(viewport.width);
  });

  it('sem posições, o enquadramento volta à câmera neutra; com um vértice, centraliza com escala 1', () => {
    expect(fitToBounds(NEUTRAL_CAMERA, boundsOf(emptyLayout('g')), viewport, { margin: 24 })).toStrictEqual(NEUTRAL_CAMERA);
    const um = circularLayout(buildGraph('g', 1));
    const camera = fitToBounds(NEUTRAL_CAMERA, boundsOf(um), viewport, { margin: 24 });

    expect(camera.scale).toBe(1);
    expect(worldToScreen(camera, at(um, 'v1'))).toStrictEqual({ x: 180, y: 320 });
  });

  it('o toque cria o vértice sob o dedo com qualquer câmera, e o layout guarda só o mundo', () => {
    const toque = point(137, 402);
    const cameras = [NEUTRAL_CAMERA, { x: -50, y: 30, scale: 2 }, { x: 400, y: -900, scale: 0.25 }, { x: 12.5, y: 7.25, scale: 3.5 }];
    const mundos = cameras.map((camera) => screenToWorld(camera, toque));

    cameras.forEach((camera, i) => {
      const layout = placeVertex(emptyLayout('g'), 'v1', mundos[i]!);
      const noMundo = at(layout, 'v1');

      expect(worldToScreen(camera, noMundo).x).toBeCloseTo(toque.x, 9);
      expect(worldToScreen(camera, noMundo).y).toBeCloseTo(toque.y, 9);
    });
    expect(new Set(mundos.map((m) => `${m.x},${m.y}`)).size).toBe(4); // coordenadas de mundo diferentes para a mesma posição na tela
  });
});
