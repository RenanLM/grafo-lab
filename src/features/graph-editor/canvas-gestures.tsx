import { useEffect, useState } from 'react';

import { createCameraGestureController } from './camera-gesture-controller';
import type { CameraStore } from './camera-store';
import { createCanvasGestureController, type CanvasGestureContext, type CanvasGestureController } from './canvas-gesture-controller';
import type { EditorStore } from './editor-store';
import { useVertexDragController } from './vertex-drag';
import type { VertexDragController } from './vertex-drag-controller';

// Cola React dos gestos do canvas (Fase 3, incremento 3.10): cria, UMA vez por tela, o controlador do arrasto de vértice, o dos gestos da câmera e o orquestrador que os junta, mantém o contexto
// atualizado e descarta tudo ao desmontar. Nenhuma regra: elas estão no núcleo puro e nos controladores (sem React).

/**
 * Os gestos do canvas da tela. `drag` é o controlador do arrasto de vértice (o renderizador ao vivo assina a prévia dele) e `gestures` entrega ao detector os callbacks do pan de um dedo e da pinça.
 * O contexto (área medida e habilitado) é enviado depois de cada renderização; ao desmontar, o arrasto de vértice é descartado (a posição não é gravada) e a câmera fica como está.
 */
export function useCanvasGestures(
  store: EditorStore,
  cameraStore: CameraStore,
  context: CanvasGestureContext,
): { readonly drag: VertexDragController; readonly gestures: CanvasGestureController } {
  const drag = useVertexDragController(store, { viewport: context.viewport, enabled: context.enabled });
  const [gestures] = useState(() =>
    createCanvasGestureController({ store, cameraStore, drag, camera: createCameraGestureController(cameraStore) }),
  );
  useEffect(() => {
    gestures.setContext(context);
  });
  useEffect(
    () => () => {
      gestures.cancel();
      gestures.dispose();
    },
    [gestures],
  );
  return { drag, gestures };
}
