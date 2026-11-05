import {
  buildDragPreview,
  dragActivated,
  dragPreviewPosition,
  finishDrag,
  isDragSessionValid,
  planDragPreview,
  startDrag,
  type Camera,
  type DragEnd,
  type DragPreview,
  type DragPreviewPlan,
  type DragSession,
  type GraphScene,
  type Point,
  type Viewport,
} from './core';
import type { CanvasDragHandlers } from './canvas-gesture-detector';
import type { EditorStore } from './editor-store';

// Controlador do arrasto de vértice (Fase 3, incremento 3.9): a ponte entre o detector de gestos (`CanvasDragHandlers`), o núcleo puro (`core/drag.ts`
// e `core/drag-preview.ts`) e a store. TypeScript sem React: recebe a store por parâmetro e expõe `subscribe` e `getPreview` no formato de
// `useSyncExternalStore`. Quem decide o que é um arrasto é o núcleo; aqui só se guarda o que é do GESTO em andamento e se encaminha.
//
// O que existe durante um gesto (nada disto entra na store, no grafo, no layout, no histórico nem no JSON)
// - `armed`: a sessão que `startDrag` devolveu quando o dedo desceu sobre um vértice (hit-testing UMA vez). Ainda não é arrasto: pode virar toque.
// - `active`: depois que o Gesture Handler ativou o arrasto. Guarda a sessão, o plano da prévia (as arestas incidentes, calculadas uma vez) e o último
//   deslocamento visto.
// - `preview`: o desenho provisório (vértice + arestas incidentes) que o renderizador mostra. Muda a cada atualização do dedo e é a ÚNICA coisa que
//   muda: o grafo e o layout continuam como estavam até soltar.
//
// Fluxo
// 1. `begin`: o dedo desceu. Hit-testing do núcleo (`startDrag`); se acertou um vértice (e o modo é Selecionar, e nada mais tem o toque), arma.
// 2. `touchMove`: antes de ativar, diz se o dedo já andou o limiar (`dragActivated`); o detector então pede a ativação ao Gesture Handler.
// 3. `activated`: confere que a sessão ainda vale e monta o plano da prévia (Θ(V + E), uma vez). A partir daqui a store é OBSERVADA: se o editor deixar
//    de ser o da sessão (modo trocado, outro grafo, exemplo, desfazer, vértice removido), o arrasto é descartado na hora, sem esperar o dedo.
// 4. `update`: posição nova (`dragPreviewPosition`) → prévia nova (`buildDragPreview`, Θ(grau)) → avisa os assinantes. Nada é despachado.
// 5. `release` / `cancel`: `finishDrag` do núcleo decide. Soltar com o vértice em outro lugar despacha UMA ação `move-vertex` (um passo de histórico);
//    cancelar, sessão inválida, posição igual ou não finita não despacham nada. Depois a prévia é removida: a ordem é despachar PRIMEIRO e limpar depois, para
//    o desenho passar da prévia à cena definitiva (com a mesma posição) sem um quadro intermediário na posição antiga.
// 6. `finalize`: o gesto acabou (de qualquer jeito); descarta o que sobrou. Idempotente.
// A posição confirmada é a do evento de FIM (onde o dedo subiu). Ela pode estar um quadro à frente da última prévia, porque no aparelho o último movimento chega
//    junto com o fim (medido no emulador: 4 dp num deslize de 100 ms); a diferença é só o último quadro e o vértice fica onde o dedo parou. A última prévia só vale se o
//    deslocamento do evento de fim não for finito.
//
// `onDraggingChange(true)` é chamado quando o arrasto ativa e `(false)` quando termina (soltar, cancelar, descartar, desmontar), para quem precisa
// reagir (por exemplo, reservar a rolagem da página). Complexidade: `begin` é o `startDrag` (Θ(V) a Θ(V + E·N)); `activated` Θ(V + E); `update` Θ(grau).

export type DragContext = {
  readonly camera: Camera | undefined;
  /** A área do canvas em dp; `undefined` enquanto não foi medida. */
  readonly viewport: Viewport | undefined;
  /** A cena que está na tela (de onde a prévia tira rótulo e raio do vértice). */
  readonly scene: GraphScene | undefined;
  /** Falso quando outra coisa tem o toque (a folha de propriedades aberta, nenhum grafo): nenhum arrasto começa e o ativo é descartado. */
  readonly enabled: boolean;
  readonly onDraggingChange?: (dragging: boolean) => void;
};

export type VertexDragController = {
  /** Os callbacks do detector de gestos. Identidade estável durante toda a vida do controlador. */
  readonly handlers: CanvasDragHandlers;
  /** A prévia atual, ou `undefined`. A MESMA referência enquanto nada muda (formato de `useSyncExternalStore`). */
  getPreview(): DragPreview | undefined;
  /** Avisa quando a prévia muda. Devolve a função que cancela a assinatura. */
  subscribe(listener: () => void): () => void;
  /** Atualiza o contexto da tela (câmera, área, cena, habilitado). Barato; pode ser chamado a cada renderização. */
  setContext(context: DragContext): void;
  /** O arrasto está ativo (o dedo já virou arrasto e ainda não soltou)? */
  isDragging(): boolean;
  /** Descarta o arrasto em andamento, se houver, sem confirmar nada (troca de grafo, desmontagem). */
  cancel(): void;
};

type ActiveDrag = {
  readonly session: DragSession;
  readonly plan: DragPreviewPlan;
  readonly unsubscribe: () => void;
  /** O último deslocamento que virou prévia. */
  translation: Point | undefined;
};

export function createVertexDragController(store: EditorStore): VertexDragController {
  let context: DragContext = { camera: undefined, viewport: undefined, scene: undefined, enabled: false };
  let armed: DragSession | undefined;
  let active: ActiveDrag | undefined;
  let preview: DragPreview | undefined;
  let committing = false;
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  /** Descarta tudo do gesto (sessão armada, arrasto ativo e prévia). Idempotente. */
  function clear(): void {
    const wasActive = active !== undefined;
    active?.unsubscribe();
    armed = undefined;
    active = undefined;
    if (preview !== undefined) {
      preview = undefined;
      notify();
    }
    if (wasActive) context.onDraggingChange?.(false);
  }

  /** Fecha o arrasto ativo: o núcleo decide, e só uma ação `move-vertex` chega à store. Depois, limpa. */
  function settle(end: DragEnd): void {
    const current = active;
    if (current !== undefined) {
      const outcome = finishDrag(current.session, store.getState().editor, end);
      if (outcome.kind === 'move') {
        committing = true;
        try {
          store.getState().dispatch(outcome.action);
        } finally {
          committing = false;
        }
      }
    }
    clear();
  }

  const handlers: CanvasDragHandlers = {
    begin(point) {
      clear();
      const { camera, viewport, enabled } = context;
      if (!enabled || camera === undefined || viewport === undefined) return;
      armed = startDrag(store.getState().editor, camera, point, viewport);
    },

    touchMove(point) {
      return armed !== undefined && active === undefined && dragActivated(armed, point);
    },

    activated() {
      const session = armed;
      const { scene, viewport } = context;
      if (session === undefined || scene === undefined) {
        clear();
        return;
      }
      const { editor } = store.getState();
      const plan = isDragSessionValid(session, editor)
        ? planDragPreview(editor.graph, editor.layout, scene, session.camera, session.vertexId, viewport === undefined ? {} : { viewport })
        : undefined;
      if (plan === undefined) {
        clear();
        return;
      }
      armed = undefined;
      const unsubscribe = store.subscribe((state) => {
        if (!committing && active?.session === session && !isDragSessionValid(session, state.editor)) clear();
      });
      active = { session, plan, unsubscribe, translation: undefined };
      context.onDraggingChange?.(true);
    },

    update(translation) {
      if (active === undefined) return;
      const position = dragPreviewPosition(active.session, translation);
      if (position === undefined) return;
      const next = buildDragPreview(active.plan, position);
      if (next === undefined) return;
      active.translation = translation;
      preview = next;
      notify();
    },

    release(translation) {
      // O evento de fim traz onde o dedo SUBIU, que pode estar um quadro à frente da última prévia (no aparelho o último movimento chega junto com ele): vale ele.
      // Só se não for um deslocamento finito vale a última prévia.
      const finite = Number.isFinite(translation.x) && Number.isFinite(translation.y);
      settle({ kind: 'release', translation: finite ? translation : (active?.translation ?? translation) });
    },

    cancel() {
      settle({ kind: 'cancel' });
    },

    finalize() {
      clear();
    },
  };

  return {
    handlers,
    getPreview: () => preview,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setContext: (next) => {
      context = next;
      if (active !== undefined && !next.enabled) clear();
    },
    isDragging: () => active !== undefined,
    cancel: () => {
      settle({ kind: 'cancel' });
    },
  };
}
