import { useEffect, useState, useSyncExternalStore } from 'react';

import type { EditorStore } from './editor-store';
import type { GraphRendererProps } from './graph-renderer';
import { SvgGraphRenderer } from './svg-graph-renderer';
import { createVertexDragController, type DragContext, type VertexDragController } from './vertex-drag-controller';

// Cola React do arrasto de vértice (Fase 3, incremento 3.9). A lógica está em `vertex-drag-controller.ts` (sem React) e no núcleo puro; aqui só há
// o que o React precisa: criar o controlador uma vez por tela, mantê-lo informado do contexto e descartá-lo ao desmontar.

/**
 * O controlador do arrasto da tela. Criado uma vez por `store` (a identidade é estável); o contexto (câmera, área, cena, habilitado) é enviado depois de
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

type LiveProps = GraphRendererProps & { readonly controller: VertexDragController };

/**
 * O renderizador SVG com a prévia do arrasto. É este componente (e não a tela) que assina a prévia do controlador: a cada atualização do dedo só ele
 * re-renderiza (a tela, o detector de gestos e as camadas estáticas do SVG não são percorridos de novo), e a prévia vai como propriedade `preview`.
 */
export function LiveGraphRenderer({ controller, ...props }: LiveProps) {
  const preview = useSyncExternalStore(controller.subscribe, controller.getPreview);
  return <SvgGraphRenderer {...props} preview={preview} />;
}
