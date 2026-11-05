import { render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import { useColorScheme } from 'react-native';

import { addEdge, addVertex, createGraph, type Graph, type Result } from '@/domain/graph';
import { colors, type ColorToken } from '@/theme';

import {
  DEFAULT_EDGE_TOLERANCE,
  buildGraphScene,
  circularLayout,
  emptyLayout,
  fitCameraToGraph,
  placeVertex,
  planDragPreview,
  buildDragPreview,
  screenToWorld,
  type DragPreview,
  type EditorSelection,
  type GraphLayout,
  type GraphScene,
} from './core';
import { buildExampleGraph } from './example-graph';
import { SvgGraphRenderer } from './svg-graph-renderer';

// Renderizador SVG (ver svg-graph-renderer.tsx): conta e confere os elementos que a CENA manda desenhar. O que o aluno vê em
// um aparelho não é verificado aqui: ver a validação no emulador em docs/ARCHITECTURE.md.
//
// Os elementos do SVG ficam escondidos dos leitores de tela de propósito (a imagem inteira tem o resumo como descrição), então as
// consultas abaixo pedem `includeHiddenElements`; um teste confere que, por padrão, eles realmente não aparecem.

const VIEWPORT = { width: 360, height: 320 };
const HIDDEN = { includeHiddenElements: true } as const;

type HostElement = ReturnType<typeof screen.getByTestId>;

/** O preset do React Native substitui `useColorScheme` por um `jest.fn` que devolve 'light'; aqui escolhemos o tema. */
const setScheme = (scheme: 'light' | 'dark'): void => {
  jest.mocked(useColorScheme).mockReturnValue(scheme);
};

function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`esperava sucesso, mas veio ${result.error.code}`);
  return result.value;
}

function sceneOf(graph: Graph, layout: GraphLayout): GraphScene {
  const camera = fitCameraToGraph(graph, layout, VIEWPORT);
  const scene = camera === undefined ? undefined : buildGraphScene(graph, layout, camera, { viewport: VIEWPORT });
  if (scene === undefined) throw new Error('sem cena');
  return scene;
}

function exampleScene(): GraphScene {
  const graph = must(buildExampleGraph());
  return sceneOf(graph, circularLayout(graph));
}

function draw(scene: GraphScene) {
  return render(<SvgGraphRenderer scene={scene} width={VIEWPORT.width} height={VIEWPORT.height} />);
}

const byId = (testID: string): HostElement => screen.getByTestId(testID, HIDDEN);
const count = (pattern: RegExp): number => screen.queryAllByTestId(pattern, HIDDEN).length;

/** Texto de um elemento `Text` do SVG: o conteúdo do primeiro `TSpan` filho. */
function textOf(element: HostElement): string {
  const [first] = element.children;
  if (first === undefined || typeof first === 'string') throw new Error('sem TSpan');
  return String(first.props.content);
}

/** Cor do token como o React Native a entrega ao SVG: `{ type: 0, payload: 0xAARRGGBB }`. */
const paint = (hex: string) => ({ type: 0, payload: (0xff000000 | parseInt(hex.slice(1), 16)) >>> 0 });

afterEach(() => {
  setScheme('light');
});

describe('SvgGraphRenderer: o exemplo', () => {
  it('desenha um círculo e um rótulo por vértice, inclusive o isolado, nas posições e raios da cena', async () => {
    const scene = exampleScene();
    await draw(scene);

    expect(count(/^vertex-circle-/)).toBe(4);
    expect(count(/^vertex-label-/)).toBe(4);
    for (const vertex of scene.vertices) {
      expect(byId(`vertex-circle-${vertex.id}`).props).toMatchObject({ cx: vertex.center.x, cy: vertex.center.y, r: vertex.radius });
    }
    expect(scene.vertices.find((v) => v.isolated)?.label).toBe('D');
    expect(byId('vertex-circle-v4')).toBeTruthy(); // o isolado está lá
  });

  it('desenha um traço por aresta: caminho curvo (Q) nos arcos opostos, reta nas outras', async () => {
    const scene = exampleScene();
    await draw(scene);

    expect(count(/^edge-stroke-/)).toBe(4);
    const props = scene.edges.map((edge) => byId(`edge-stroke-${edge.id}`).props);
    // A → B e B → A são curvas (têm `d`); B → C e C → A são retas (têm x1…y2)
    expect(props.map((p) => typeof p.d === 'string')).toStrictEqual([true, true, false, false]);
    expect(props[0]!.d).not.toBe(props[1]!.d);
    expect(props[0]!.d).toMatch(/^M [-\d.e]+ [-\d.e]+ Q [-\d.e]+ [-\d.e]+ [-\d.e]+ [-\d.e]+$/);
    scene.edges.forEach((edge, i) => {
      if (edge.path.kind === 'quadratic') {
        expect(props[i]!.d).toBe(`M ${edge.path.from.x} ${edge.path.from.y} Q ${edge.path.control.x} ${edge.path.control.y} ${edge.path.to.x} ${edge.path.to.y}`);
      } else {
        expect(props[i]).toMatchObject({ x1: edge.path.from.x, y1: edge.path.from.y, x2: edge.path.to.x, y2: edge.path.to.y });
      }
    });
  });

  it('desenha uma seta por aresta orientada, com a ponta e as asas da cena', async () => {
    const scene = exampleScene();
    await draw(scene);

    expect(count(/^edge-arrow-/)).toBe(4);
    for (const edge of scene.edges) {
      const { tip, left, right } = edge.arrow!;

      expect(byId(`edge-arrow-${edge.id}`).props.d).toBe(`M${tip.x} ${tip.y} ${left.x} ${left.y} ${right.x} ${right.y}z`);
    }
  });

  it('pesos: a aresta sem peso não ganha caixa nem texto; 0, −2 e 5 aparecem', async () => {
    const scene = exampleScene();
    await draw(scene);
    const [semPeso, zero, negativo, cinco] = scene.edges;

    expect(count(/^weight-box-/)).toBe(3);
    expect(count(/^weight-text-/)).toBe(3);
    expect(screen.queryByTestId(`weight-box-${semPeso!.id}`, HIDDEN)).toBeNull();
    expect(screen.queryByTestId(`weight-text-${semPeso!.id}`, HIDDEN)).toBeNull();
    expect(textOf(byId(`weight-text-${zero!.id}`))).toBe('0');
    expect(textOf(byId(`weight-text-${negativo!.id}`))).toBe('-2');
    expect(textOf(byId(`weight-text-${cinco!.id}`))).toBe('5');
  });

  it('a caixa do peso fica centrada na âncora da aresta, com a largura e a altura da cena', async () => {
    const scene = exampleScene();
    await draw(scene);
    const zero = scene.edges[1]!;
    const { anchor, width, height } = zero.weight!;

    expect(byId(`weight-box-${zero.id}`).props).toMatchObject({ x: anchor.x - width / 2, y: anchor.y - height / 2, width, height });
  });

  it('os rótulos dos vértices são os da cena: A, B, C, D', async () => {
    const scene = exampleScene();
    await draw(scene);

    expect(scene.vertices.map((v) => textOf(byId(`vertex-label-${v.id}`)))).toStrictEqual(['A', 'B', 'C', 'D']);
  });

  it('a imagem leva o resumo da cena como descrição acessível; os elementos internos ficam escondidos dos leitores de tela', async () => {
    const scene = exampleScene();
    await draw(scene);
    const canvas = screen.getByTestId('graph-canvas');

    expect(canvas.props).toMatchObject({ accessible: true, accessibilityRole: 'image', accessibilityLabel: scene.summary });
    expect(scene.summary).toBe('Grafo orientado com 4 vértices e 4 arestas. O vértice D está isolado. 3 arestas têm peso.');
    expect(screen.queryAllByTestId('vertex-circle-v1')).toHaveLength(0); // escondido por padrão
    expect(count(/^vertex-circle-/)).toBe(4); // mas presente
  });

  it('o SVG cobre exatamente a área de desenho e o viewBox é a mesma área, sem escala nem deslocamento (a câmera já foi aplicada)', async () => {
    await draw(exampleScene());

    expect(byId('graph-svg').props).toMatchObject({
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      minX: 0,
      minY: 0,
      vbWidth: VIEWPORT.width,
      vbHeight: VIEWPORT.height,
    });
  });

  it('o corpo da fonte dos rótulos e dos pesos é o da cena', async () => {
    const scene = exampleScene();
    await draw(scene);

    expect(byId('vertex-label-v1').props.font).toMatchObject({ fontSize: scene.labelFontSize });
    expect(byId(`weight-text-${scene.edges[1]!.id}`).props.font).toMatchObject({ fontSize: scene.labelFontSize });
    expect(scene.labelFontSize).toBe(14);
  });

  it('não tem nenhum tratador de toque: só desenha', async () => {
    const scene = exampleScene();
    await draw(scene);
    const nomes = ['onPress', 'onPressIn', 'onTouchStart', 'onResponderGrant', 'onStartShouldSetResponder'];
    const elementos = [screen.getByTestId('graph-canvas'), ...scene.vertices.map((v) => byId(`vertex-circle-${v.id}`))];

    for (const elemento of elementos) for (const nome of nomes) expect(elemento.props[nome]).toBeUndefined();
  });
});

describe('SvgGraphRenderer: orientação e casos pequenos', () => {
  it('grafo não orientado: traços e círculos, nenhuma seta', async () => {
    let graph = createGraph({ id: 'g' });
    graph = must(addVertex(graph)).graph;
    graph = must(addVertex(graph)).graph;
    graph = must(addEdge(graph, { source: 'v1', target: 'v2' })).graph;
    const layout = placeVertex(placeVertex(emptyLayout('g'), 'v1', { x: 0, y: 0 }), 'v2', { x: 100, y: 0 });
    await draw(sceneOf(graph, layout));

    expect(count(/^vertex-circle-/)).toBe(2);
    expect(count(/^edge-stroke-/)).toBe(1);
    expect(count(/^edge-arrow-/)).toBe(0);
    expect(count(/^weight-/)).toBe(0);
  });

  it('um vértice isolado e nada mais: um círculo e um rótulo', async () => {
    const graph = must(addVertex(createGraph({ id: 'g' }))).graph;
    await draw(sceneOf(graph, placeVertex(emptyLayout('g'), 'v1', { x: 0, y: 0 })));

    expect(count(/^vertex-circle-/)).toBe(1);
    expect(count(/^vertex-label-/)).toBe(1);
    expect(count(/^edge-stroke-/)).toBe(0);
  });

  it('cena vazia: o canvas existe, sem nenhum elemento de grafo', async () => {
    await draw(sceneOf(createGraph({ id: 'g' }), emptyLayout('g')));

    expect(screen.getByTestId('graph-canvas')).toBeOnTheScreen();
    expect(count(/^(vertex|edge|weight)-/)).toBe(0);
  });

  it('peso 0 num grafo não orientado: aparece o texto "0"; sem peso, não', async () => {
    let graph = createGraph({ id: 'g' });
    for (let i = 0; i < 3; i++) graph = must(addVertex(graph)).graph;
    graph = must(addEdge(graph, { source: 'v1', target: 'v2', weight: 0 })).graph;
    graph = must(addEdge(graph, { source: 'v2', target: 'v3' })).graph;
    const layout = placeVertex(placeVertex(placeVertex(emptyLayout('g'), 'v1', { x: 0, y: 0 }), 'v2', { x: 150, y: 0 }), 'v3', { x: 300, y: 0 });
    await draw(sceneOf(graph, layout));

    expect(count(/^weight-text-/)).toBe(1);
    expect(textOf(byId('weight-text-e1'))).toBe('0');
    expect(screen.queryByTestId('weight-text-e2', HIDDEN)).toBeNull();
  });

  it('rótulo longo: mostra o texto truncado da cena, nunca o rótulo cru', async () => {
    const longo = 'Estação Central de Teresina';
    const graph = must(addVertex(createGraph({ id: 'g' }), longo)).graph;
    const scene = sceneOf(graph, placeVertex(emptyLayout('g'), 'v1', { x: 0, y: 0 }));
    await draw(scene);
    const exibido = textOf(byId('vertex-label-v1'));

    expect(exibido).toBe(scene.vertices[0]!.displayLabel);
    expect(exibido).not.toBe(longo);
    expect(Array.from(exibido).length).toBeLessThan(Array.from(longo).length);
  });
});

describe('SvgGraphRenderer: atualização e tema', () => {
  it('atualiza quando a cena muda: de 4 vértices para 1 e de volta', async () => {
    const quatro = exampleScene();
    const um = sceneOf(must(addVertex(createGraph({ id: 'g' }))).graph, placeVertex(emptyLayout('g'), 'v1', { x: 0, y: 0 }));
    const { rerender } = await draw(quatro);
    expect(count(/^vertex-circle-/)).toBe(4);

    await rerender(<SvgGraphRenderer scene={um} width={VIEWPORT.width} height={VIEWPORT.height} />);
    expect(count(/^vertex-circle-/)).toBe(1);
    expect(count(/^edge-stroke-/)).toBe(0);
    expect(screen.getByTestId('graph-canvas').props.accessibilityLabel).toBe(um.summary);

    await rerender(<SvgGraphRenderer scene={quatro} width={VIEWPORT.width} height={VIEWPORT.height} />);
    expect(count(/^vertex-circle-/)).toBe(4);
    expect(count(/^edge-arrow-/)).toBe(4);
  });

  it.each(['light', 'dark'] as const)('tema %s: cada parte usa o token do tema, sem cor própria', async (scheme) => {
    setScheme(scheme);
    const scene = exampleScene();
    await draw(scene);
    const token = (name: ColorToken) => paint(colors[scheme][name]);
    const [primeira, comPeso] = [scene.edges[0]!, scene.edges[1]!];

    expect(byId('vertex-circle-v1').props.fill).toStrictEqual(token('primaryMuted'));
    expect(byId('vertex-circle-v1').props.stroke).toStrictEqual(token('primary'));
    expect(byId('vertex-label-v1').props.fill).toStrictEqual(token('text'));
    expect(byId(`edge-stroke-${primeira.id}`).props.stroke).toStrictEqual(token('textSecondary'));
    expect(byId(`edge-arrow-${primeira.id}`).props.fill).toStrictEqual(token('textSecondary'));
    expect(byId(`weight-text-${comPeso.id}`).props.fill).toStrictEqual(token('text'));
    expect(byId(`weight-box-${comPeso.id}`).props.fill).toStrictEqual(token('surface'));
    expect(byId(`weight-box-${comPeso.id}`).props.stroke).toStrictEqual(token('border'));
    expect(screen.getByTestId('graph-canvas').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ backgroundColor: colors[scheme].surface })]),
    );
  });

  it('claro e escuro pintam diferente (o tema realmente muda as cores)', async () => {
    setScheme('light');
    const { unmount } = await draw(exampleScene());
    const claro = byId('vertex-circle-v1').props.fill;
    await unmount();
    setScheme('dark');
    await draw(exampleScene());

    expect(byId('vertex-circle-v1').props.fill).not.toStrictEqual(claro);
  });
});

// Destaque da origem pendente do modo Conectar (3.7): só desenho. O que se confere é que o anel e o contorno mais grosso aparecem no
// vértice certo, que a geometria dele não muda, que a cena não é tocada e que o destaque não depende só de cor (forma diferente).
describe('SvgGraphRenderer: destaque do vértice de origem', () => {
  const drawWith = (scene: GraphScene, highlightedVertexId?: string) =>
    render(<SvgGraphRenderer scene={scene} width={VIEWPORT.width} height={VIEWPORT.height} highlightedVertexId={highlightedVertexId} />);

  it('sem destaque não há anel e todos os vértices têm o contorno normal (2)', async () => {
    await drawWith(exampleScene());

    expect(count(/^vertex-source-ring-/)).toBe(0);
    for (const id of ['v1', 'v2', 'v3', 'v4']) expect(byId(`vertex-circle-${id}`).props.strokeWidth).toBe(2);
  });

  it('com destaque, só o vértice indicado ganha o anel tracejado e o contorno mais grosso (4)', async () => {
    const scene = exampleScene();
    await drawWith(scene, 'v2');

    expect(count(/^vertex-source-ring-/)).toBe(1);
    expect(byId('vertex-source-ring-v2')).toBeTruthy();
    expect(byId('vertex-circle-v2').props.strokeWidth).toBe(4);
    for (const id of ['v1', 'v3', 'v4']) expect(byId(`vertex-circle-${id}`).props.strokeWidth).toBe(2);
  });

  it('o anel é concêntrico e maior que o vértice, e o vértice não muda de lugar nem de raio', async () => {
    const scene = exampleScene();
    const vertex = scene.vertices.find((candidate) => candidate.id === 'v3')!;
    await drawWith(scene, 'v3');
    const ring = byId('vertex-source-ring-v3').props;
    const circle = byId('vertex-circle-v3').props;

    expect([ring.cx, ring.cy]).toStrictEqual([vertex.center.x, vertex.center.y]);
    expect(ring.r).toBeGreaterThan(vertex.radius);
    expect(ring.fill).toBeNull(); // `fill="none"` chega ao host do SVG como `null`: o anel é só contorno
    expect([circle.cx, circle.cy, circle.r]).toStrictEqual([vertex.center.x, vertex.center.y, vertex.radius]);
  });

  it('não depende só de cor: o anel é TRACEJADO (forma) e o contorno é mais grosso', async () => {
    await drawWith(exampleScene(), 'v1');
    const ring = byId('vertex-source-ring-v1').props;

    expect(ring.strokeDasharray).toBeTruthy();
    expect(ring.strokeWidth).toBeGreaterThan(2);
  });

  it.each(['light', 'dark'] as const)('tema %s: o anel usa o token primary', async (scheme) => {
    setScheme(scheme);
    await drawWith(exampleScene(), 'v1');

    expect(byId('vertex-source-ring-v1').props.stroke).toStrictEqual(paint(colors[scheme].primary));
  });

  it('um id que não está na cena não destaca nada (sem erro)', async () => {
    await drawWith(exampleScene(), 'v99');

    expect(count(/^vertex-source-ring-/)).toBe(0);
  });

  it('o anel fica ATRÁS do círculo do vértice (o círculo cobre o centro) e o rótulo continua por cima', async () => {
    await drawWith(exampleScene(), 'v1');
    const ordem = screen
      .queryAllByTestId(/^(vertex-source-ring|vertex-circle|vertex-label)-v1$/, HIDDEN)
      .map((node) => String(node.props.testID));

    expect(ordem).toStrictEqual(['vertex-source-ring-v1', 'vertex-circle-v1', 'vertex-label-v1']);
  });

  it('o destaque não muda a cena: o mesmo objeto de cena, desenhado com e sem destaque, tem o mesmo número de vértices e arestas', async () => {
    const scene = exampleScene();
    const antes = JSON.stringify(scene);
    await drawWith(scene, 'v1');

    expect(JSON.stringify(scene)).toBe(antes);
  });
});

// Destaque da seleção (3.8): só desenho. O que se confere é que o anel (vértice) e o halo e o traço grosso (aresta) aparecem no elemento certo,
// que a forma difere do destaque da origem do Conectar (anel sólido x tracejado), que o halo é mais estreito que a tolerância de toque, que a
// geometria e a cena não mudam e que o destaque não depende só de cor.
describe('SvgGraphRenderer: destaque da seleção', () => {
  const drawSelected = (scene: GraphScene, selection: EditorSelection, highlightedVertexId?: string) =>
    render(
      <SvgGraphRenderer
        scene={scene}
        width={VIEWPORT.width}
        height={VIEWPORT.height}
        selection={selection}
        highlightedVertexId={highlightedVertexId}
      />,
    );
  const vertexSel = (vertexId: string): EditorSelection => ({ type: 'vertex', vertexId });
  const edgeSel = (edgeId: string): EditorSelection => ({ type: 'edge', edgeId });

  it('sem seleção (ou com `none`) não há anel nem halo, e o contorno e os traços são os normais', async () => {
    await drawSelected(exampleScene(), { type: 'none' });

    expect(count(/^vertex-selection-ring-/)).toBe(0);
    expect(count(/^edge-selection-/)).toBe(0);
    for (const id of ['v1', 'v2', 'v3', 'v4']) expect(byId(`vertex-circle-${id}`).props.strokeWidth).toBe(2);
    for (const edge of exampleScene().edges) expect(byId(`edge-stroke-${edge.id}`).props.strokeWidth).toBe(2);
  });

  it('vértice selecionado: anel SÓLIDO concêntrico e maior, contorno de 4 dp só nele', async () => {
    const scene = exampleScene();
    const vertex = scene.vertices.find((candidate) => candidate.id === 'v2')!;
    await drawSelected(scene, vertexSel('v2'));
    const ring = byId('vertex-selection-ring-v2').props;

    expect(count(/^vertex-selection-ring-/)).toBe(1);
    expect([ring.cx, ring.cy]).toStrictEqual([vertex.center.x, vertex.center.y]);
    expect(ring.r).toBeGreaterThan(vertex.radius);
    expect(ring.fill).toBeNull(); // só contorno
    expect(ring.strokeDasharray).toBeFalsy(); // sólido: a origem do Conectar é tracejada
    expect(byId('vertex-circle-v2').props.strokeWidth).toBe(4);
    for (const id of ['v1', 'v3', 'v4']) expect(byId(`vertex-circle-${id}`).props.strokeWidth).toBe(2);
    expect(byId('vertex-circle-v2').props).toMatchObject({ cx: vertex.center.x, cy: vertex.center.y, r: vertex.radius }); // a geometria não muda
  });

  it('a seleção (anel sólido) e a origem do Conectar (anel tracejado) se distinguem pela FORMA, não só pela cor', async () => {
    await drawSelected(exampleScene(), vertexSel('v1'), 'v2');

    expect(byId('vertex-selection-ring-v1').props.strokeDasharray).toBeFalsy();
    expect(byId('vertex-source-ring-v2').props.strokeDasharray).toBeTruthy();
    expect(byId('vertex-selection-ring-v1').props.stroke).not.toStrictEqual(byId('vertex-source-ring-v2').props.stroke);
  });

  it('aresta RETA selecionada: traço de 4 dp no token primary, halo translúcido por baixo e a seta com contorno; as outras ficam como estavam', async () => {
    const scene = exampleScene();
    const straight = scene.edges.find((edge) => edge.path.kind === 'line' && edge.arrow !== undefined)!;
    await drawSelected(scene, edgeSel(straight.id));
    const stroke = byId(`edge-stroke-${straight.id}`).props;
    const halo = byId(`edge-selection-${straight.id}`).props;
    const arrow = byId(`edge-arrow-${straight.id}`).props;

    expect(stroke.strokeWidth).toBe(4);
    expect(stroke.stroke).toStrictEqual(paint(colors.light.primary));
    expect(halo.strokeWidth).toBe(10);
    expect(halo.strokeOpacity).toBeLessThan(1);
    expect(halo.stroke).toStrictEqual(paint(colors.light.primary));
    expect(arrow.fill).toStrictEqual(paint(colors.light.primary));
    expect(arrow.strokeWidth).toBe(3); // a ponta da seta também destaca
    for (const edge of scene.edges.filter((candidate) => candidate.id !== straight.id)) {
      expect(byId(`edge-stroke-${edge.id}`).props.strokeWidth).toBe(2);
      expect(byId(`edge-stroke-${edge.id}`).props.stroke).toStrictEqual(paint(colors.light.textSecondary));
      if (edge.arrow !== undefined) expect(byId(`edge-arrow-${edge.id}`).props.strokeWidth).toBeUndefined();
    }
  });

  it('aresta CURVA selecionada (arco oposto): o halo acompanha a curva (mesmo caminho do traço)', async () => {
    const scene = exampleScene();
    const curved = scene.edges.find((edge) => edge.path.kind === 'quadratic')!;
    await drawSelected(scene, edgeSel(curved.id));

    expect(byId(`edge-selection-${curved.id}`).props.d).toBe(byId(`edge-stroke-${curved.id}`).props.d);
    expect(byId(`edge-stroke-${curved.id}`).props.strokeWidth).toBe(4);
  });

  it('o halo (10 dp) é mais estreito que a área de toque da aresta: o que se vê não promete mais do que o hit-testing aceita', async () => {
    await drawSelected(exampleScene(), edgeSel('e3'));

    expect(byId('edge-selection-e3').props.strokeWidth / 2).toBeLessThan(DEFAULT_EDGE_TOLERANCE);
  });

  it('o halo é desenhado ANTES dos traços (fica por baixo) e os círculos continuam por cima das arestas', async () => {
    await drawSelected(exampleScene(), edgeSel('e3'));
    const ordem = screen.queryAllByTestId(/^(edge-selection-e3|edge-stroke-e3|vertex-circle-v1)$/, HIDDEN).map((node) => String(node.props.testID));

    expect(ordem).toStrictEqual(['edge-selection-e3', 'edge-stroke-e3', 'vertex-circle-v1']);
  });

  it('um id que não está na cena não destaca nada (sem erro)', async () => {
    await drawSelected(exampleScene(), vertexSel('v99'));
    expect(count(/^vertex-selection-ring-/)).toBe(0);
    await drawSelected(exampleScene(), edgeSel('e99'));

    expect(count(/^edge-selection-/)).toBe(0);
  });

  it.each(['light', 'dark'] as const)('tema %s: anel do vértice no token text e halo da aresta no token primary', async (scheme) => {
    setScheme(scheme);
    await drawSelected(exampleScene(), vertexSel('v1'));
    expect(byId('vertex-selection-ring-v1').props.stroke).toStrictEqual(paint(colors[scheme].text));
  });

  it('o destaque não muda a cena', async () => {
    const scene = exampleScene();
    const antes = JSON.stringify(scene);
    await drawSelected(scene, edgeSel('e3'));

    expect(JSON.stringify(scene)).toBe(antes);
  });
});

// Prévia do arrasto (3.9). O renderizador não calcula nada: troca o vértice arrastado e as arestas dele (da camada estática) pelos da prévia, que o núcleo montou
// com as mesmas fórmulas da cena. Aqui se confere o que fica na tela: cada elemento UMA vez, nas posições certas, na ordem de empilhamento certa, com o destaque seguindo.
describe('SvgGraphRenderer: prévia do arrasto', () => {
  function parts() {
    const graph = must(buildExampleGraph());
    const layout = circularLayout(graph);
    const camera = fitCameraToGraph(graph, layout, VIEWPORT)!;
    const scene = buildGraphScene(graph, layout, camera, { viewport: VIEWPORT })!;
    return { graph, layout, camera, scene };
  }

  /** O plano e a cena para arrastar `vertexId`, com um construtor de prévia para um ponto da TELA (dp, com a câmera da cena). */
  function dragOf(vertexId: string) {
    const { graph, layout, camera, scene } = parts();
    const plan = planDragPreview(graph, layout, scene, camera, vertexId, { viewport: VIEWPORT })!;
    const at = (x: number, y: number): DragPreview => buildDragPreview(plan, screenToWorld(camera, { x, y }))!;
    return { at, scene };
  }

  const previewAt = (vertexId: string, x: number, y: number) => {
    const { at, scene } = dragOf(vertexId);
    return { preview: at(x, y), scene };
  };

  type Extra = Partial<ComponentProps<typeof SvgGraphRenderer>>;
  const element = (scene: GraphScene, preview: DragPreview | undefined, extra: Extra = {}) => (
    <SvgGraphRenderer scene={scene} width={VIEWPORT.width} height={VIEWPORT.height} preview={preview} {...extra} />
  );

  const circle = (id: string) => byId(`vertex-circle-${id}`).props as { cx: number; cy: number };
  const labelX = (id: string): number => {
    const x = byId(`vertex-label-${id}`).props.x as number | number[];
    return Number(Array.isArray(x) ? x[0] : x);
  };

  it('o vértice arrastado e as arestas dele aparecem UMA vez, nas posições da prévia; o resto fica onde a cena os pôs', async () => {
    const { preview, scene } = previewAt('v2', 300, 250);
    await render(element(scene, preview));

    expect(count(/^vertex-circle-/)).toBe(4);
    expect(count(/^vertex-label-/)).toBe(4);
    expect(count(/^edge-stroke-/)).toBe(scene.edges.length);
    expect(circle('v2')).toMatchObject({ cx: preview.vertex.center.x, cy: preview.vertex.center.y });
    for (const vertex of scene.vertices.filter((candidate) => candidate.id !== 'v2')) {
      expect(circle(vertex.id)).toMatchObject({ cx: vertex.center.x, cy: vertex.center.y });
    }
    for (const edge of scene.edges) {
      const wanted = preview.edges.find((candidate) => candidate.id === edge.id) ?? edge;
      const props = byId(`edge-stroke-${edge.id}`).props as { x1?: number; y1?: number; d?: string };
      if (wanted.path.kind === 'line') expect(props).toMatchObject({ x1: wanted.path.from.x, y1: wanted.path.from.y });
      else expect(props.d).toContain(`M ${wanted.path.from.x} ${wanted.path.from.y}`);
    }
  });

  it('as arestas da prévia são as incidentes ao vértice (como origem ou destino); as outras não mudam', async () => {
    const { preview, scene } = previewAt('v2', 300, 250);
    await render(element(scene, preview));
    const incident = scene.edges.filter((edge) => edge.sourceId === 'v2' || edge.targetId === 'v2').map((edge) => edge.id);

    expect(preview.edges.map((edge) => edge.id)).toStrictEqual(incident);
    expect(incident.length).toBeGreaterThan(1);
    for (const edge of scene.edges.filter((candidate) => !incident.includes(candidate.id))) {
      if (edge.path.kind === 'line') expect(byId(`edge-stroke-${edge.id}`).props).toMatchObject({ x1: edge.path.from.x, y2: edge.path.to.y });
    }
  });

  it('as setas e os pesos das arestas incidentes acompanham (a ponta da seta é a da prévia; o texto do peso não muda)', async () => {
    const { preview, scene } = previewAt('v2', 300, 250);
    await render(element(scene, preview));

    for (const edge of preview.edges) {
      const arrow = edge.arrow!;
      expect(byId(`edge-arrow-${edge.id}`).props.d).toBe(`M${arrow.tip.x} ${arrow.tip.y} ${arrow.left.x} ${arrow.left.y} ${arrow.right.x} ${arrow.right.y}z`);
      if (edge.weight !== undefined) {
        expect(textOf(byId(`weight-text-${edge.id}`))).toBe(edge.weight.text);
        expect(byId(`weight-box-${edge.id}`).props.x).toBeCloseTo(edge.weight.anchor.x - edge.weight.width / 2, 9);
      }
    }
    expect(count(/^edge-arrow-/)).toBe(scene.edges.length); // nenhuma seta duplicada nem perdida
  });

  it('o rótulo acompanha o vértice arrastado', async () => {
    const { preview, scene } = previewAt('v2', 300, 250);
    await render(element(scene, preview));

    expect(labelX('v2')).toBe(preview.vertex.center.x);
    expect(textOf(byId('vertex-label-v2'))).toBe(preview.vertex.displayLabel);
  });

  it('ordem de empilhamento: as arestas da prévia ficam abaixo de TODOS os vértices e o vértice arrastado fica acima dos outros', async () => {
    const { preview, scene } = previewAt('v2', 300, 250);
    await render(element(scene, preview));
    const order = screen
      .queryAllByTestId(/^(edge-stroke-.*|edge-arrow-.*|vertex-circle-.*|vertex-label-.*)$/, HIDDEN)
      .map((node) => String(node.props.testID));
    const index = (id: string) => order.indexOf(id);

    for (const edge of preview.edges) {
      for (const vertex of scene.vertices) expect(index(`edge-stroke-${edge.id}`)).toBeLessThan(index(`vertex-circle-${vertex.id}`));
      expect(index(`edge-stroke-${edge.id}`)).toBeLessThan(index(`edge-arrow-${edge.id}`));
    }
    for (const vertex of scene.vertices.filter((candidate) => candidate.id !== 'v2')) {
      expect(index('vertex-circle-v2')).toBeGreaterThan(index(`vertex-circle-${vertex.id}`));
    }
    expect(index('vertex-label-v2')).toBeGreaterThan(index('vertex-circle-v2')); // o rótulo fica por cima do círculo
  });

  it('o anel de seleção acompanha o vértice selecionado que está sendo arrastado', async () => {
    const { preview, scene } = previewAt('v2', 300, 250);
    await render(element(scene, preview, { selection: { type: 'vertex', vertexId: 'v2' } }));

    expect(byId('vertex-selection-ring-v2').props).toMatchObject({ cx: preview.vertex.center.x, cy: preview.vertex.center.y });
    expect(byId('vertex-circle-v2').props.strokeWidth).toBe(4);
  });

  it('o halo da aresta selecionada acompanha a aresta incidente; o de uma aresta que não é do vértice fica na cena', async () => {
    const { preview, scene } = previewAt('v2', 300, 250);
    const moved = preview.edges.find((edge) => edge.path.kind === 'line')!;
    const { rerender } = await render(element(scene, preview, { selection: { type: 'edge', edgeId: moved.id } }));
    expect(byId(`edge-selection-${moved.id}`).props).toMatchObject({ x1: moved.path.from.x, y1: moved.path.from.y });
    expect(byId(`edge-stroke-${moved.id}`).props.strokeWidth).toBe(4);

    const other = scene.edges.find((edge) => !preview.edges.some((candidate) => candidate.id === edge.id) && edge.path.kind === 'line')!;
    await rerender(element(scene, preview, { selection: { type: 'edge', edgeId: other.id } }));
    expect(byId(`edge-selection-${other.id}`).props).toMatchObject({ x1: other.path.from.x, y1: other.path.from.y });
  });

  it('o anel da origem do Conectar também acompanha o vértice arrastado', async () => {
    const { preview, scene } = previewAt('v2', 300, 250);
    await render(element(scene, preview, { highlightedVertexId: 'v2' }));

    expect(byId('vertex-source-ring-v2').props).toMatchObject({ cx: preview.vertex.center.x, cy: preview.vertex.center.y });
  });

  it('uma prévia de OUTRO grafo (mesmos ids técnicos, `graphId` diferente) é ignorada: a cena aparece como estava', async () => {
    const { preview, scene } = previewAt('v2', 300, 250);
    await render(element(scene, { ...preview, graphId: 'outro-grafo' }));

    expect(circle('v2')).toMatchObject({ cx: scene.vertices[1]!.center.x, cy: scene.vertices[1]!.center.y });
    expect(count(/^vertex-circle-/)).toBe(4);
    expect(count(/^edge-stroke-/)).toBe(scene.edges.length);
  });

  it('aresta incidente sem geometria na prévia (círculos que se tocam) some, sem deixar a da cena; as outras ficam', async () => {
    const { scene } = parts();
    const v1 = scene.vertices[0]!;
    const { preview } = previewAt('v2', v1.center.x + 3, v1.center.y + 3); // v2 em cima de v1
    await render(element(scene, preview));
    const between = scene.edges.filter((edge) => [edge.sourceId, edge.targetId].includes('v2') && [edge.sourceId, edge.targetId].includes('v1'));

    expect(between).toHaveLength(2); // v1 → v2 e v2 → v1 (arcos opostos)
    for (const edge of between) expect(screen.queryByTestId(`edge-stroke-${edge.id}`, HIDDEN)).toBeNull();
    expect(count(/^edge-stroke-/)).toBe(scene.edges.length - 2);
  });

  it('com prévia vazia de arestas (vértice isolado) só o vértice muda', async () => {
    const { scene } = parts();
    const before = scene.edges.length;
    const { preview } = previewAt('v4', 100, 100); // v4 é o vértice isolado
    await render(element(scene, preview));

    expect(preview.edges).toHaveLength(0);
    expect(count(/^edge-stroke-/)).toBe(before);
    expect(circle('v4')).toMatchObject({ cx: preview.vertex.center.x, cy: preview.vertex.center.y });
  });

  it('a camada estática NÃO é redesenhada entre as atualizações do dedo (as propriedades dos elementos estáticos são os mesmos objetos)', async () => {
    const { at, scene } = dragOf('v2');
    const { rerender } = await render(element(scene, at(200, 200)));
    const staticVertex = byId('vertex-circle-v1').props;
    const staticEdge = byId('edge-stroke-e4').props;
    await rerender(element(scene, at(210, 215)));
    await rerender(element(scene, at(220, 230)));

    expect(byId('vertex-circle-v1').props).toBe(staticVertex);
    expect(byId('edge-stroke-e4').props).toBe(staticEdge);
    expect(circle('v2').cx).toBe(at(220, 230).vertex.center.x); // e a camada da prévia, sim
  });

  it('a prévia não altera a cena recebida', async () => {
    const { preview, scene } = previewAt('v2', 300, 250);
    const before = JSON.stringify(scene);
    await render(element(scene, preview));

    expect(JSON.stringify(scene)).toBe(before);
  });
});
