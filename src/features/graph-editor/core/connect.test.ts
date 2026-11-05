import { addEdge, addVertex, createGraph, type Result } from '@/domain/graph';

import {
  CONNECT_IDLE_MESSAGE,
  NEUTRAL_CAMERA,
  NO_CONNECTION,
  applyAction,
  connectStatusMessage,
  connectStep,
  createEditorState,
  emptyLayout,
  hitTest,
  placeVertex,
  positionOf,
  reconcileConnection,
  tapToConnectTransition,
  worldToScreen,
  type Camera,
  type ConnectNotice,
  type ConnectState,
  type EditorMode,
  type EditorState,
  type HitTarget,
  type Point,
} from './index';
import { deepFreeze, seededRandom } from './test-helpers';

// Máquina de estados do modo Conectar (ver connect.ts). A máquina só DECIDE (origem, cancelar, pedir `connect`); quem cria a aresta é
// o `applyAction` com o domínio, e é com ele que os testes de integração conferem as duas orientações. O hit-testing não é refeito
// aqui: os testes usam o `hitTest` do 3.3 como oráculo de "o que está sob o dedo".

const VIEWPORT = { width: 360, height: 320 };
const point = (x: number, y: number): Point => ({ x, y });

const vertexTarget = (vertexId: string, distance = 0): HitTarget => ({ type: 'vertex', vertexId, distance });
const edgeTarget = (edgeId: string, distance = 3): HitTarget => ({ type: 'edge', edgeId, distance });
const BACKGROUND: HitTarget = { type: 'background' };
const from = (sourceVertexId: string): ConnectState => ({ sourceVertexId });

function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`esperava sucesso, mas veio ${result.error.code}`);
  return result.value;
}

type Spec = {
  mode?: EditorMode;
  directed?: boolean;
  /** Vértices v1, v2… nas posições do MUNDO dadas. */
  vertices?: readonly (readonly [number, number])[];
  /** Arestas por índice de vértice (1-based). */
  edges?: readonly (readonly [number, number])[];
};

/** Estado do editor montado só com a API pública (domínio, layout e núcleo). */
function stateOf({ mode = 'connect', directed = false, vertices = [[60, 60], [200, 60], [130, 200]], edges = [] }: Spec = {}): EditorState {
  let graph = createGraph({ id: 'g', directed });
  let layout = emptyLayout('g');
  vertices.forEach(([x, y]) => {
    const added = must(addVertex(graph));
    graph = added.graph;
    layout = placeVertex(layout, added.vertex.id, point(x, y));
  });
  for (const [source, target] of edges) graph = must(addEdge(graph, { source: `v${source}`, target: `v${target}` })).graph;
  return createEditorState({ graph, layout, mode });
}

/** Onde o vértice aparece na tela (dp) para a câmera dada. */
function screenOf(state: EditorState, camera: Camera, vertexId: string): Point {
  const position = positionOf(state.layout, vertexId);
  if (position === undefined) throw new Error(`sem posição para ${vertexId}`);
  return worldToScreen(camera, position);
}

const tap = (state: EditorState, connection: ConnectState, screenPoint: Point, camera: Camera = NEUTRAL_CAMERA) =>
  tapToConnectTransition(state, connection, camera, screenPoint, VIEWPORT);

describe('connectStep: o primeiro toque escolhe a origem', () => {
  it('sem origem pendente, tocar em um vértice o escolhe: nenhuma ação (nenhuma aresta, nenhum id, nenhum histórico)', () => {
    const step = connectStep(NO_CONNECTION, vertexTarget('v1'), stateOf().graph);

    expect(step).toStrictEqual({ connection: { sourceVertexId: 'v1' }, outcome: 'source-set' });
    expect('action' in step).toBe(false);
  });

  it('sem origem pendente, tocar em uma aresta, no fundo ou em um toque inválido não faz nada (o mesmo objeto)', () => {
    const graph = stateOf().graph;
    for (const target of [edgeTarget('e1'), BACKGROUND, undefined]) {
      const step = connectStep(NO_CONNECTION, target, graph);
      expect(step.outcome).toBe('ignored');
      expect(step.connection).toBe(NO_CONNECTION);
      expect(step.action).toBeUndefined();
    }
  });

  it('um vértice que não existe no grafo não vira origem', () => {
    const step = connectStep(NO_CONNECTION, vertexTarget('v9'), stateOf().graph);

    expect(step.outcome).toBe('ignored');
    expect(step.connection).toBe(NO_CONNECTION);
  });

  it('uma origem que não existe mais é descartada: o toque seguinte, se for em um vértice, escolhe a nova origem', () => {
    const graph = stateOf().graph;
    const step = connectStep(from('v9'), vertexTarget('v2'), graph);

    expect(step).toStrictEqual({ connection: { sourceVertexId: 'v2' }, outcome: 'source-set' });
  });

  it('uma origem que não existe mais, com toque no fundo: cancela (descarta a origem velha)', () => {
    const step = connectStep(from('v9'), BACKGROUND, stateOf().graph);

    expect(step).toStrictEqual({ connection: NO_CONNECTION, outcome: 'cancelled' });
  });
});

describe('connectStep: o segundo toque escolhe o destino', () => {
  const graph = stateOf().graph;

  it('com a origem v1, tocar em v2 pede connect(v1, v2) UMA vez e limpa a origem', () => {
    const step = connectStep(from('v1'), vertexTarget('v2'), graph);

    expect(step).toStrictEqual({ connection: NO_CONNECTION, action: { type: 'connect', source: 'v1', target: 'v2' }, outcome: 'connect' });
    expect(step.connection).toBe(NO_CONNECTION);
    expect(step.action && 'weight' in step.action).toBe(false); // a aresta do toque não tem peso
  });

  it('a ordem dos toques é a ordem da aresta: v2 depois v1 pede connect(v2, v1)', () => {
    const step = connectStep(from('v2'), vertexTarget('v1'), graph);

    expect(step.action).toStrictEqual({ type: 'connect', source: 'v2', target: 'v1' });
  });

  it('um destino que não existe ainda pede connect: quem recusa é o domínio (a máquina não revalida a aresta)', () => {
    const step = connectStep(from('v1'), vertexTarget('v9'), graph);

    expect(step.outcome).toBe('connect');
    expect(step.action).toStrictEqual({ type: 'connect', source: 'v1', target: 'v9' });
    const result = applyAction(stateOf(), step.action!);
    expect(result.error).toStrictEqual({ code: 'GRAPH_ERROR', error: { code: 'VERTEX_NOT_FOUND', vertexId: 'v9' } });
  });

  it('tocar na própria origem CANCELA, sem ação e sem erro de laço', () => {
    const step = connectStep(from('v1'), vertexTarget('v1'), graph);

    expect(step).toStrictEqual({ connection: NO_CONNECTION, outcome: 'cancelled' });
    expect(step.action).toBeUndefined();
  });

  it('tocar em uma aresta ou no fundo CANCELA, sem ação', () => {
    for (const target of [edgeTarget('e1'), BACKGROUND]) {
      const step = connectStep(from('v1'), target, graph);
      expect(step).toStrictEqual({ connection: NO_CONNECTION, outcome: 'cancelled' });
    }
  });

  it('um toque inválido (undefined) não muda nada: a origem continua pendente (o mesmo objeto)', () => {
    const pendente = from('v1');
    const step = connectStep(pendente, undefined, graph);

    expect(step.outcome).toBe('ignored');
    expect(step.connection).toBe(pendente);
    expect(step.action).toBeUndefined();
  });

  it('depois do segundo toque a máquina está limpa: um terceiro toque em vértice começa OUTRA conexão', () => {
    const second = connectStep(from('v1'), vertexTarget('v2'), graph);
    const third = connectStep(second.connection, vertexTarget('v3'), graph);

    expect(third).toStrictEqual({ connection: { sourceVertexId: 'v3' }, outcome: 'source-set' });
  });
});

describe('reconcileConnection: a origem só vale no modo Conectar e enquanto o vértice existe', () => {
  it('sem origem devolve o mesmo objeto, em qualquer modo', () => {
    for (const mode of ['select', 'add-vertex', 'connect'] as const) {
      expect(reconcileConnection(NO_CONNECTION, stateOf({ mode }))).toBe(NO_CONNECTION);
    }
  });

  it('fora do modo Conectar a origem é descartada (trocar de modo cancela)', () => {
    expect(reconcileConnection(from('v1'), stateOf({ mode: 'select' }))).toBe(NO_CONNECTION);
    expect(reconcileConnection(from('v1'), stateOf({ mode: 'add-vertex' }))).toBe(NO_CONNECTION);
  });

  it('a origem que existe, no modo Conectar, continua (o mesmo objeto)', () => {
    const pendente = from('v2');

    expect(reconcileConnection(pendente, stateOf())).toBe(pendente);
  });

  it('a origem removida (desfazer, refazer ou outra alteração) é descartada', () => {
    const base = stateOf();
    const com = applyAction(base, { type: 'add-vertex', position: point(300, 250) }).state; // v4
    expect(reconcileConnection(from('v4'), com)).toEqual(from('v4'));

    const desfeito = applyAction(com, { type: 'undo' }).state; // v4 deixou de existir
    expect(reconcileConnection(from('v4'), desfeito)).toBe(NO_CONNECTION);

    const refeito = applyAction(desfeito, { type: 'redo' }).state; // v4 voltou, mas a pendência já foi descartada antes
    expect(reconcileConnection(from('v4'), refeito)).toEqual(from('v4'));
  });
});

describe('tapToConnectTransition: o toque no canvas, com o hit-testing do 3.3', () => {
  it('toque no centro de um vértice escolhe a origem; depois, no centro de outro, pede a conexão', () => {
    const state = stateOf();
    const first = tap(state, NO_CONNECTION, point(60, 60));
    expect(first).toStrictEqual({ connection: { sourceVertexId: 'v1' }, outcome: 'source-set' });

    const second = tap(state, first.connection, point(200, 60));
    expect(second.action).toStrictEqual({ type: 'connect', source: 'v1', target: 'v2' });
    expect(second.connection).toBe(NO_CONNECTION);
  });

  it('o alvo de toque do vértice é de pelo menos 48 dp: a 23 dp do centro ainda acerta; a 25 dp, não', () => {
    const state = stateOf();

    expect(tap(state, NO_CONNECTION, point(60 + 23, 60)).outcome).toBe('source-set');
    expect(tap(state, NO_CONNECTION, point(60 + 25, 60)).outcome).toBe('ignored');
  });

  it('as opções do hit-testing chegam ao hitTest: com alvo mínimo de 10 dp, a 23 dp do centro (raio visual 20) já não acerta', () => {
    const state = stateOf();
    const perto = point(60 + 23, 60);

    expect(tapToConnectTransition(state, NO_CONNECTION, NEUTRAL_CAMERA, perto, VIEWPORT).outcome).toBe('source-set'); // padrão: 48 dp
    expect(tapToConnectTransition(state, NO_CONNECTION, NEUTRAL_CAMERA, perto, VIEWPORT, { minTouchDiameter: 10 }).outcome).toBe('ignored');
  });

  it('no fundo, sem origem: nada; com origem: cancela', () => {
    const state = stateOf();

    expect(tap(state, NO_CONNECTION, point(300, 280)).outcome).toBe('ignored');
    expect(tap(state, from('v1'), point(300, 280))).toStrictEqual({ connection: NO_CONNECTION, outcome: 'cancelled' });
  });

  it('em uma aresta, com origem: cancela (o ponto médio de v1—v2 fica longe dos dois vértices)', () => {
    const state = stateOf({ edges: [[1, 2]] });
    const midpoint = point(130, 60);

    expect(hitTest(state.graph, state.layout, NEUTRAL_CAMERA, midpoint)?.type).toBe('edge'); // oráculo
    expect(tap(state, from('v3'), midpoint)).toStrictEqual({ connection: NO_CONNECTION, outcome: 'cancelled' });
    expect(tap(state, NO_CONNECTION, midpoint).outcome).toBe('ignored');
  });

  it('a prioridade do hit-testing vale: um vértice sobre uma aresta vence a aresta', () => {
    const state = stateOf({ vertices: [[60, 60], [200, 60], [130, 60]], edges: [[1, 2]] }); // v3 em cima da aresta v1—v2
    const onVertex = point(130, 60);

    expect(hitTest(state.graph, state.layout, NEUTRAL_CAMERA, onVertex)?.type).toBe('vertex'); // oráculo
    expect(tap(state, NO_CONNECTION, onVertex)).toStrictEqual({ connection: { sourceVertexId: 'v3' }, outcome: 'source-set' });
  });

  it('com zoom e deslocamento (câmera {40, −30, 2}) o toque vale onde o vértice APARECE na tela', () => {
    const camera: Camera = { x: 40, y: -30, scale: 2 };
    const state = stateOf({ vertices: [[40, 60], [100, 90]] });
    const v1 = screenOf(state, camera, 'v1'); // (120, 90)
    const v2 = screenOf(state, camera, 'v2'); // (240, 150)
    expect(v1).toStrictEqual(point(120, 90));
    expect(v2).toStrictEqual(point(240, 150));

    const first = tap(state, NO_CONNECTION, v1, camera);
    expect(first.connection).toStrictEqual({ sourceVertexId: 'v1' });
    expect(tap(state, first.connection, v2, camera).action).toStrictEqual({ type: 'connect', source: 'v1', target: 'v2' });
    // o ponto do MUNDO (40, 60) tocado como se fosse de tela não acerta nada: é o fundo
    expect(tap(state, NO_CONNECTION, point(40, 60), camera).outcome).toBe('ignored');
  });

  it('toque inválido ou fora do canvas não muda nada: a origem pendente continua (o mesmo objeto)', () => {
    const state = stateOf();
    const pendente = from('v1');
    const invalidos: readonly (readonly [string, Point, Camera, { width: number; height: number }])[] = [
      ['fora, à direita', point(361, 100), NEUTRAL_CAMERA, VIEWPORT],
      ['fora, abaixo', point(100, 321), NEUTRAL_CAMERA, VIEWPORT],
      ['coordenada negativa', point(-1, 100), NEUTRAL_CAMERA, VIEWPORT],
      ['coordenada não finita', point(Number.NaN, 100), NEUTRAL_CAMERA, VIEWPORT],
      ['câmera inválida', point(60, 60), { x: 0, y: 0, scale: 0 }, VIEWPORT],
      ['área inválida', point(60, 60), NEUTRAL_CAMERA, { width: 0, height: 320 }],
    ];
    for (const [nome, toque, camera, viewport] of invalidos) {
      const step = tapToConnectTransition(state, pendente, camera, toque, viewport);
      expect([nome, step.outcome]).toStrictEqual([nome, 'ignored']);
      expect(step.connection).toBe(pendente);
      expect(step.action).toBeUndefined();
    }
  });

  it('um vértice junto da borda do canvas: tocar FORA do canvas, mesmo dentro do alcance dele, não vale', () => {
    const state = stateOf({ vertices: [[2, 100], [200, 60]] });

    expect(tap(state, NO_CONNECTION, point(0, 100)).outcome).toBe('source-set'); // a borda conta como dentro
    expect(tap(state, NO_CONNECTION, point(-1, 100)).outcome).toBe('ignored');
  });

  it.each(['select', 'add-vertex'] as const)('no modo %s não faz nada e descarta uma origem que tenha sobrado', (mode) => {
    const state = stateOf({ mode });

    expect(tap(state, NO_CONNECTION, point(60, 60))).toStrictEqual({ connection: NO_CONNECTION, outcome: 'ignored' });
    expect(tap(state, from('v1'), point(200, 60))).toStrictEqual({ connection: NO_CONNECTION, outcome: 'ignored' });
  });

  it('um grafo com layout de outro grafo (estado incoerente): nada acontece', () => {
    const estado = stateOf();
    const incoerente = { ...estado, layout: emptyLayout('outro') } as EditorState;

    expect(tap(incoerente, NO_CONNECTION, point(60, 60)).outcome).toBe('ignored');
  });
});

describe('integração com applyAction: a máquina pede, o núcleo cria', () => {
  /** Dois toques em vértices; devolve o estado depois de aplicar a ação, se houve. */
  function connectBy(state: EditorState, first: string, second: string): { state: EditorState; error?: unknown; connection: ConnectState } {
    const origin = tap(state, NO_CONNECTION, screenOf(state, NEUTRAL_CAMERA, first));
    const target = tap(state, origin.connection, screenOf(state, NEUTRAL_CAMERA, second));
    if (target.action === undefined) throw new Error('o segundo toque deveria pedir connect');
    const transition = applyAction(state, target.action);
    return { state: transition.state, error: transition.error, connection: target.connection };
  }

  it('não orientado: A—B cria UMA aresta e UM passo de histórico; a conexão fica limpa', () => {
    const base = stateOf();
    const { state, error, connection } = connectBy(base, 'v1', 'v2');

    expect(error).toBeUndefined();
    expect(state.graph.edges).toStrictEqual([{ id: 'e1', source: 'v1', target: 'v2' }]);
    expect(state.history.past).toHaveLength(base.history.past.length + 1);
    expect(connection).toBe(NO_CONNECTION);
    expect(state.graph.nextEdgeSeq).toBe(base.graph.nextEdgeSeq + 1);
  });

  it('não orientado: depois de A—B, tocar B e depois A é recusado como duplicata (o domínio), sem histórico nem id gasto', () => {
    const { state: connected } = connectBy(stateOf(), 'v1', 'v2');
    const { state, error } = connectBy(connected, 'v2', 'v1');

    expect(error).toMatchObject({ code: 'GRAPH_ERROR', error: { code: 'DUPLICATE_EDGE', existingEdgeId: 'e1' } });
    expect(state.graph).toBe(connected.graph); // nenhuma aresta nova
    expect(state.graph.nextEdgeSeq).toBe(connected.graph.nextEdgeSeq); // o id não foi consumido
    expect(state.history).toBe(connected.history); // nenhum passo
  });

  it('orientado: A → B e depois B → A são arestas DISTINTAS; repetir A → B é duplicata', () => {
    const base = stateOf({ directed: true });
    const { state: ab } = connectBy(base, 'v1', 'v2');
    const { state: ba, error: errorBa } = connectBy(ab, 'v2', 'v1');
    const { state: again, error: errorAgain } = connectBy(ba, 'v1', 'v2');

    expect(errorBa).toBeUndefined();
    expect(ba.graph.edges).toStrictEqual([
      { id: 'e1', source: 'v1', target: 'v2' },
      { id: 'e2', source: 'v2', target: 'v1' },
    ]);
    expect(errorAgain).toMatchObject({ code: 'GRAPH_ERROR', error: { code: 'DUPLICATE_EDGE', existingEdgeId: 'e1' } });
    expect(again.graph).toBe(ba.graph);
  });

  it('desfazer remove a aresta; refazer devolve a MESMA aresta com o mesmo id; uma conexão nova depois de desfazer usa id novo', () => {
    const { state: connected } = connectBy(stateOf(), 'v1', 'v2');
    const undone = applyAction(connected, { type: 'undo' }).state;
    expect(undone.graph.edges).toStrictEqual([]);

    const redone = applyAction(undone, { type: 'redo' }).state;
    expect(redone.graph.edges).toStrictEqual([{ id: 'e1', source: 'v1', target: 'v2' }]);

    const undoneAgain = applyAction(redone, { type: 'undo' }).state;
    const { state: other } = connectBy(undoneAgain, 'v2', 'v3');
    expect(other.graph.edges).toStrictEqual([{ id: 'e2', source: 'v2', target: 'v3' }]); // e1 não volta a ser emitido
    expect(other.history.future).toStrictEqual([]); // o ramo de refazer foi descartado
  });

  it('o primeiro toque (escolher a origem) não toca no estado do editor: nenhum id, nenhum histórico', () => {
    const base = stateOf();
    const step = tap(base, NO_CONNECTION, point(60, 60));

    expect(step.action).toBeUndefined();
    expect(base.history.past).toHaveLength(0);
    expect(base.graph.nextEdgeSeq).toBe(1);
  });

  it('tocar duas vezes no mesmo vértice cancela e nunca gera SELF_LOOP', () => {
    const base = stateOf();
    const first = tap(base, NO_CONNECTION, point(60, 60));
    const second = tap(base, first.connection, point(60, 60));

    expect(second.outcome).toBe('cancelled');
    expect(second.action).toBeUndefined();
    // o domínio, porém, continua recusando o laço para quem usa `connect` direto
    expect(applyAction(base, { type: 'connect', source: 'v1', target: 'v1' }).error).toMatchObject({ error: { code: 'SELF_LOOP' } });
  });
});

describe('propriedades (sementes fixas)', () => {
  const graphWith = (random: () => number) => {
    const count = 2 + Math.floor(random() * 4); // 2 a 5 vértices
    const vertices = Array.from({ length: count }, (_, i) => [60 + i * 50, 60 + (i % 2) * 90] as const);
    return stateOf({ directed: random() < 0.5, vertices });
  };

  it('500 sequências de 12 toques: a origem é sempre um vértice que existe, e cada toque produz no máximo uma ação', () => {
    const random = seededRandom(3707);
    for (let run = 0; run < 500; run++) {
      let editor = graphWith(random);
      let connection: ConnectState = NO_CONNECTION;
      for (let i = 0; i < 12; i++) {
        const roll = random();
        const ids = editor.graph.vertices.map((vertex) => vertex.id);
        const target: HitTarget | undefined =
          roll < 0.6
            ? vertexTarget(ids[Math.floor(random() * ids.length)]!)
            : roll < 0.75
              ? edgeTarget('e1')
              : roll < 0.9
                ? BACKGROUND
                : undefined;
        const before = connection;
        const step = connectStep(before, target, editor.graph);

        // um toque, no máximo uma ação, e só quando o resultado é `connect`
        expect(step.action !== undefined).toBe(step.outcome === 'connect');
        if (step.outcome === 'connect') {
          expect(step.action!.source).toBe(before.sourceVertexId);
          expect(step.action!.target).toBe(target?.type === 'vertex' ? target.vertexId : undefined);
          expect(step.action!.source).not.toBe(step.action!.target);
          expect(step.connection).toBe(NO_CONNECTION);
        }
        if (step.outcome === 'cancelled') expect(step.connection).toBe(NO_CONNECTION);
        if (step.outcome === 'ignored') expect(step.connection).toBe(before);
        if (step.outcome === 'source-set') expect(step.connection.sourceVertexId).toBe(target?.type === 'vertex' ? target.vertexId : '');

        // a origem pendente, quando há, é um vértice do grafo
        if (step.connection.sourceVertexId !== undefined) expect(ids).toContain(step.connection.sourceVertexId);

        if (step.action !== undefined) {
          const edgesBefore = editor.graph.edges.length;
          const transition = applyAction(editor, step.action);
          expect(transition.state.graph.edges.length).toBe(transition.error === undefined ? edgesBefore + 1 : edgesBefore);
          editor = transition.state;
        }
        connection = step.connection;
      }
    }
  });

  it('é determinística e não altera as entradas (grafo, origem e alvo congelados)', () => {
    const random = seededRandom(77);
    for (let run = 0; run < 100; run++) {
      const editor = deepFreeze(graphWith(random));
      const ids = editor.graph.vertices.map((vertex) => vertex.id);
      const pendente = deepFreeze({ sourceVertexId: ids[Math.floor(random() * ids.length)]! });
      const target = deepFreeze(vertexTarget(ids[Math.floor(random() * ids.length)]!));

      const a = connectStep(pendente, target, editor.graph);
      const b = connectStep(pendente, target, editor.graph);
      expect(a).toStrictEqual(b);
    }
  });

  it('com o hit-testing real, a origem escolhida é a que o hitTest acerta (200 toques aleatórios)', () => {
    const random = seededRandom(555);
    for (let run = 0; run < 200; run++) {
      const state = graphWith(random);
      const toque = point(random() * VIEWPORT.width, random() * VIEWPORT.height);
      const alvo = hitTest(state.graph, state.layout, NEUTRAL_CAMERA, toque);
      const step = tap(state, NO_CONNECTION, toque);

      if (alvo?.type === 'vertex') expect(step.connection.sourceVertexId).toBe(alvo.vertexId);
      else expect(step.outcome).toBe('ignored');
    }
  });
});

describe('connectStatusMessage: o texto de estado em português', () => {
  const directed = stateOf({ directed: true });
  const undirected = stateOf();
  const notice = (n: ConnectNotice): ConnectNotice => n;

  it('com origem pendente: "Origem: A. Toque no vértice de destino." (o rótulo, não o id)', () => {
    expect(connectStatusMessage(undirected, from('v1'), undefined)).toBe('Origem: A. Toque no vértice de destino.');
    expect(connectStatusMessage(undirected, from('v3'), undefined)).toBe('Origem: C. Toque no vértice de destino.');
  });

  it('sem nada em andamento: a instrução para escolher a origem', () => {
    expect(connectStatusMessage(undirected, NO_CONNECTION, undefined)).toBe(CONNECT_IDLE_MESSAGE);
  });

  it('conexão criada: "de A para B" no orientado e "entre A e B" no não orientado', () => {
    const created = notice({ kind: 'created', source: 'v1', target: 'v2' });

    expect(connectStatusMessage(directed, NO_CONNECTION, created)).toBe('Aresta criada de A para B.');
    expect(connectStatusMessage(undirected, NO_CONNECTION, created)).toBe('Aresta criada entre A e B.');
  });

  it('recusada: "Conexão não criada." e o motivo do domínio em português (duplicata)', () => {
    const refused = applyAction(
      applyAction(undirected, { type: 'connect', source: 'v1', target: 'v2' }).state,
      { type: 'connect', source: 'v2', target: 'v1' },
    );
    const message = connectStatusMessage(refused.state, NO_CONNECTION, notice({ kind: 'refused' }));

    expect(message).toBe('Conexão não criada. Esses dois vértices já estão ligados por uma aresta (no mesmo sentido, se o grafo é orientado).');
  });

  it('recusada sem erro no estado: só "Conexão não criada."', () => {
    expect(connectStatusMessage(undirected, NO_CONNECTION, notice({ kind: 'refused' }))).toBe('Conexão não criada.');
  });

  it('cancelada: "Conexão cancelada."', () => {
    expect(connectStatusMessage(undirected, NO_CONNECTION, notice({ kind: 'cancelled' }))).toBe('Conexão cancelada.');
  });

  it('a origem pendente vale mais que o aviso antigo', () => {
    expect(connectStatusMessage(undirected, from('v2'), notice({ kind: 'cancelled' }))).toBe('Origem: B. Toque no vértice de destino.');
  });

  it('fora do modo Conectar não há texto', () => {
    expect(connectStatusMessage(stateOf({ mode: 'add-vertex' }), from('v1'), notice({ kind: 'cancelled' }))).toBe('');
    expect(connectStatusMessage(stateOf({ mode: 'select' }), NO_CONNECTION, undefined)).toBe('');
  });

  it('não cita ids técnicos', () => {
    const message = connectStatusMessage(directed, NO_CONNECTION, notice({ kind: 'created', source: 'v1', target: 'v2' }));

    expect(message).not.toMatch(/\bv\d+\b/);
  });
});
