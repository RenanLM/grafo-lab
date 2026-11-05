import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import type { Graph } from '@/domain/graph';

import type { CameraStore } from './camera-store';
import { useLiveCamera } from './camera-hooks';
import { buildGraphScene, sameCamera, type Camera, type EditorSelection, type GraphLayout, type GraphScene } from './core';
import type { EditorStore } from './editor-store';
import { SvgGraphRenderer } from './svg-graph-renderer';
import { createVertexDragController, type DragContext, type VertexDragController } from './vertex-drag-controller';

// Cola React do arrasto de vértice (Fase 3, incremento 3.9) e do renderizador ao vivo (3.10). A lógica está em `vertex-drag-controller.ts` (sem React), em `camera-store.ts` e no
// núcleo puro; aqui só há o que o React precisa: criar o controlador uma vez por tela, mantê-lo informado do contexto, descartá-lo ao desmontar e assinar o que muda a cada quadro.

/**
 * O controlador do arrasto da tela. Criado uma vez por `store` (a identidade é estável); o contexto (câmera viva, área, habilitado) é enviado depois de
 * cada renderização, e um arrasto em andamento é descartado quando o componente é desmontado ou o contexto fica desabilitado.
 */
export function useVertexDragController(store: EditorStore, context: DragContext): VertexDragController {
  const [controller] = useState(() => createVertexDragController(store));
  useEffect(() => {
    controller.setContext(context);
  });
  useEffect(
    () => () => {
      controller.cancel();
    },
    [controller],
  );
  return controller;
}

type LiveProps = {
  readonly controller: VertexDragController;
  /** A única fonte da câmera: o renderizador assina a câmera VIVA dele. */
  readonly cameraStore: CameraStore;
  readonly graph: Graph;
  readonly layout: GraphLayout;
  readonly width: number;
  readonly height: number;
  /** A cena já montada para `baseCamera` (a câmera assentada), que a tela precisa de qualquer jeito (resumo acessível). Reaproveitada enquanto a câmera viva é a mesma. */
  readonly baseScene: GraphScene;
  readonly baseCamera: Camera;
  readonly highlightedVertexId?: string;
  readonly selection?: EditorSelection;
};

/**
 * O renderizador SVG ao vivo. É este componente (e não a tela) que assina a câmera VIVA e a prévia do arrasto: a cada atualização de um gesto só ele re-renderiza (a tela, o detector de
 * gestos e as camadas estáticas do SVG que não mudaram não são percorridos de novo).
 * - Câmera: enquanto a viva é a assentada (`baseCamera`), a cena da tela é reaproveitada. Quando um gesto a move há dois casos:
 *   · PAN (a escala é a mesma): `cena(câmera + d)` é exatamente `cena(câmera)` deslocada por `d` (a câmera só soma uma translação; espessuras, setas e textos são constantes em dp), então a cena
 *     assentada é REAPROVEITADA e só um grupo do SVG é deslocado (`offset`): nenhuma geometria é refeita e nenhuma camada estática re-renderiza. Medido no Android com 30 vértices e um hub de grau 29,
 *     refazer a cena a cada quadro rendia 28 quadros em 4 s (mediana 350 ms por quadro) contra 71 deslocando o grupo (mediana 117 ms), com a mesma imagem (0 pixels diferentes acima de 24/255).
 *   · PINÇA (a escala muda): o raio do vértice, o comprimento e a posição de tudo mudam, então a cena é refeita aqui com a câmera viva (Θ(V + E) por atualização; ≈0,25 ms no Node e ≈0,8 ms no
 *     Hermes para 30 vértices).
 *   Em ambos os casos o hit-testing continua usando a câmera viva do armazém (a mesma que desenha), nunca uma câmera à parte.
 * - Prévia do arrasto: só é desenhada enquanto a câmera viva é a MESMA com que ela foi calculada (`preview.camera`); com outra câmera ela seria desenhada no lugar errado e é descartada.
 */
export function LiveGraphRenderer({ controller, cameraStore, graph, layout, width, height, baseScene, baseCamera, highlightedVertexId, selection }: LiveProps) {
  const preview = useSyncExternalStore(controller.subscribe, controller.getPreview);
  const camera = useLiveCamera(cameraStore);
  const shifted = camera !== baseCamera && camera.scale === baseCamera.scale;
  const own = useMemo(
    () => (camera === baseCamera || shifted ? undefined : buildGraphScene(graph, layout, camera, { viewport: { width, height } })),
    [camera, baseCamera, shifted, graph, layout, width, height],
  );
  const offset = shifted ? { x: camera.x - baseCamera.x, y: camera.y - baseCamera.y } : undefined;
  const livePreview = preview !== undefined && sameCamera(preview.camera, camera) ? preview : undefined;
  return (
    <SvgGraphRenderer
      offset={offset}
      scene={own ?? baseScene}
      width={width}
      height={height}
      highlightedVertexId={highlightedVertexId}
      selection={selection}
      preview={livePreview}
    />
  );
}
