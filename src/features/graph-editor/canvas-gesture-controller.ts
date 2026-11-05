import type { CameraGestureController } from './camera-gesture-controller';
import type { CameraStore } from './camera-store';
import type { CanvasPanHandlers, CanvasPinchHandlers } from './canvas-gesture-detector';
import { gestureOwnerAt, type Viewport } from './core';
import type { EditorStore } from './editor-store';
import type { VertexDragController } from './vertex-drag-controller';

// Orquestrador dos gestos do canvas (Fase 3, incremento 3.10): quem decide, UMA vez por gesto, de quem é um deslize de um dedo (arrasto de vértice, pan da câmera ou ninguém) e que garante
// que dois gestos nunca alterem o mesmo estado ao mesmo tempo. TypeScript sem React. Implementa o que o detector chama (`CanvasPanHandlers` para o pan de um dedo, `CanvasPinchHandlers`
// para a pinça de dois) e delega a quem tem a lógica: `VertexDragController` (3.9) e `CameraGestureController` (3.10). Não faz conta nenhuma.
//
// Política (a tabela está em `core/gesture-start.ts`; o hit-testing do 3.3 roda UMA vez, ao descer o dedo, com a câmera VIVA daquele momento, e o dono não muda depois):
// | Condição                                         | Proprietário                                          |
// | Toque curto                                      | o modo do editor (o detector, não passa por aqui)     |
// | Um dedo se move sobre um vértice, em Selecionar  | arrasto do vértice                                    |
// | Um dedo se move sobre o fundo                    | pan da câmera                                         |
// | Um dedo se move sobre aresta, ou vértice nos outros modos | ninguém (a rolagem da página fica livre)     |
// | Dois dedos fazem pinça                           | zoom da câmera                                        |
// | Deslize fora do canvas                           | o `ScrollView` da página                              |
//
// Um segundo dedo. O pan do Gesture Handler (`maxPointers: 1`) é CANCELADO pelo módulo nativo quando um segundo dedo desce com ele ativo (ou falha, se ainda não tinha ativado): o arrasto do vértice
// restaura a posição sem gravar nada (`cancel`) e o pan da câmera preserva a última câmera. Quando a pinça ativa, `pinch.activated` ainda garante, por conta própria, que nenhum gesto de um dedo
// continue valendo (restaura o arrasto de vértice, assenta o pan), então nunca há dois gestos mexendo no mesmo estado e um segundo dedo nunca confirma um movimento de vértice.
//
// Contexto: a tela diz se o canvas está habilitado (a folha de propriedades aberta tira o toque do canvas) e o tamanho medido; sem tamanho nada começa. A troca de MODO encerra o gesto de câmera
// em andamento (preservando a câmera); o arrasto de vértice já se descarta sozinho por observar a store. Reset (outro grafo ou exemplo) e comandos avançam a época do armazém da câmera e matam
// as sessões atrasadas.

export type CanvasGestureContext = {
  /** A área do canvas em dp; `undefined` enquanto não foi medida. */
  readonly viewport: Viewport | undefined;
  /** Falso quando outra coisa tem o toque (a folha de propriedades aberta): nenhum gesto começa. */
  readonly enabled: boolean;
};

export type CanvasGestureController = {
  /** Os callbacks do pan de um dedo para o detector. Identidade estável. */
  readonly pan: CanvasPanHandlers;
  /** Os callbacks da pinça de dois dedos para o detector. Identidade estável. */
  readonly pinch: CanvasPinchHandlers;
  setContext(context: CanvasGestureContext): void;
  /** Descarta o gesto em andamento: restaura o arrasto de vértice e assenta a câmera como está (outro grafo, desmontagem). */
  cancel(): void;
  /** Para de observar a store. */
  dispose(): void;
};

type Owner = 'none' | 'drag' | 'camera';

export function createCanvasGestureController(deps: {
  readonly store: EditorStore;
  readonly cameraStore: CameraStore;
  readonly drag: VertexDragController;
  readonly camera: CameraGestureController;
}): CanvasGestureController {
  const { store, cameraStore, drag, camera } = deps;
  let context: CanvasGestureContext = { viewport: undefined, enabled: false };
  let owner: Owner = 'none';

  // Trocar de modo encerra o gesto de câmera em andamento (a câmera fica como está).
  let lastMode = store.getState().editor.mode;
  const unsubscribe = store.subscribe((state) => {
    const { mode } = state.editor;
    if (mode === lastMode) return;
    lastMode = mode;
    camera.abort();
  });

  const finalizeOnePointer = (): void => {
    drag.handlers.finalize();
    camera.finalizePan();
    owner = 'none';
  };

  const pan: CanvasPanHandlers = {
    begin(point) {
      finalizeOnePointer();
      const { viewport, enabled } = context;
      if (!enabled || viewport === undefined) return;
      const found = gestureOwnerAt(store.getState().editor, cameraStore.get(), point, viewport);
      if (found.kind === 'vertex') {
        owner = 'drag';
        drag.arm(found.session);
      } else if (found.kind === 'camera') {
        owner = 'camera';
        camera.armPan(point);
      }
    },
    touchMove(point) {
      if (owner === 'drag') return drag.handlers.touchMove(point);
      if (owner === 'camera') return camera.panMoved(point);
      return false;
    },
    activated(displacement) {
      if (owner === 'drag') drag.handlers.activated();
      else if (owner === 'camera') camera.panActivated(displacement);
    },
    update(displacement) {
      if (owner === 'drag') drag.handlers.update(displacement);
      else if (owner === 'camera') camera.panUpdate(displacement);
    },
    release(displacement) {
      if (owner === 'drag') drag.handlers.release(displacement);
      else if (owner === 'camera') camera.panRelease(displacement);
    },
    cancel() {
      if (owner === 'drag') drag.handlers.cancel();
      else if (owner === 'camera') camera.panCancel();
    },
    finalize: finalizeOnePointer,
  };

  const pinch: CanvasPinchHandlers = {
    activated(focal, scale) {
      if (!context.enabled) return;
      // A pinça é de dois dedos e tem a vez: nenhum gesto de um dedo continua valendo (o arrasto de vértice restaura sem gravar; o pan assenta a câmera).
      drag.handlers.cancel();
      owner = 'none';
      camera.pinchActivated(focal, scale);
    },
    update: (focal, scale) => {
      camera.pinchUpdate(focal, scale);
    },
    end: () => {
      camera.pinchEnd();
    },
    cancel: () => {
      camera.pinchCancel();
    },
    finalize: () => {
      camera.finalizePinch();
    },
  };

  return {
    pan,
    pinch,
    setContext: (next) => {
      context = next;
      if (!next.enabled) {
        drag.handlers.cancel();
        camera.abort();
        owner = 'none';
      }
    },
    cancel: () => {
      drag.handlers.cancel();
      camera.abort();
      owner = 'none';
    },
    dispose: unsubscribe,
  };
}
