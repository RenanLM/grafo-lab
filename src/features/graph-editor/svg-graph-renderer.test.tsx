import { render, screen } from '@testing-library/react-native';
import { useColorScheme } from 'react-native';

import { addEdge, addVertex, createGraph, type Graph, type Result } from '@/domain/graph';
import { colors, type ColorToken } from '@/theme';

import {
  buildGraphScene,
  circularLayout,
  emptyLayout,
  fitCameraToGraph,
  placeVertex,
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
