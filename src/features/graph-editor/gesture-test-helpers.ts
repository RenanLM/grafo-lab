import { act } from '@testing-library/react-native';
import { State } from 'react-native-gesture-handler';
import { getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

// Apoio aos testes de gestos (nada aqui é importado pelo código de produção). O simulador de gestos do Gesture Handler 3
// (`createGestureController`) cobre os estados do gesto (begin, activate, update, end, cancel, fail); estes dois acrescentam o que ele não cobre:
// os EVENTOS DE TOQUE (`onTouchesMove`, usados para a ativação manual do arrasto) e o pedido de ativação que o JavaScript faz ao módulo nativo.

type Pt = { readonly x: number; readonly y: number };

const TOUCH_EVENT = { down: 1, move: 2, up: 3, cancel: 4 } as const;

type HookGesture = {
  readonly handlerTag: number;
  readonly detectorCallbacks: { readonly jsEventHandler: (event: unknown) => void };
};

/**
 * Entrega ao gesto `testID` um evento de toque (`down`, `move`, `up` ou `cancel`) com a posição local, em dp, de cada dedo. É o que o módulo nativo
 * manda ao `onTouchesDown/Move/Up/Cancel` quando o gesto os pede (a ativação manual do pan depende de `onTouchesMove`).
 */
export function sendTouches(testID: string, kind: keyof typeof TOUCH_EVENT, ...points: readonly Pt[]): Promise<void> {
  const gesture = getByGestureTestId(testID) as unknown as HookGesture;
  const touches = points.map((point, id) => ({ id, x: point.x, y: point.y, absoluteX: point.x, absoluteY: point.y }));
  return act(async () => {
    gesture.detectorCallbacks.jsEventHandler({
      nativeEvent: {
        handlerTag: gesture.handlerTag,
        numberOfTouches: touches.length,
        state: State.BEGAN,
        eventType: TOUCH_EVENT[kind],
        allTouches: touches,
        changedTouches: touches,
        pointerType: 0,
      },
    });
  });
}

type StateGlobals = { _setGestureStateAsync?: unknown; _setGestureStateSync?: unknown };

/**
 * O `GestureStateManager.activate` fala com a thread nativa por um global (`_setGestureStateAsync` no JavaScript) que não existe no Jest. Este
 * apoio o instala e devolve o registro dos pedidos `(handlerTag, estado)`; `restore` tira o global. Use em `beforeEach` e `afterEach`.
 */
export function recordGestureStateRequests(): { readonly requests: jest.Mock; restore(): void } {
  const requests = jest.fn();
  const globals = globalThis as unknown as StateGlobals;
  const previous = globals._setGestureStateAsync;
  globals._setGestureStateAsync = requests;
  return {
    requests,
    restore: () => {
      globals._setGestureStateAsync = previous;
    },
  };
}

/** O número do estado ATIVO do Gesture Handler, que é o que o pedido de ativação carrega. */
export const ACTIVE_STATE = State.ACTIVE;
