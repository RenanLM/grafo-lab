import { useRef, type ReactElement } from 'react';
import {
  GestureDetector,
  GestureStateManager,
  useCompetingGestures,
  usePanGesture,
  useTapGesture,
} from 'react-native-gesture-handler';

import type { Point } from './core';

// Detector de gestos ÚNICO do canvas (Fase 3, incrementos 3.6 e 3.9): o toque e o arrasto de vértice. Entrega pontos em dp e RELATIVOS ao canto
// superior esquerdo da view que ele envolve; a decisão do que cada gesto significa é do núcleo puro (`tapToEditorAction`, `startDrag`…) e do
// controlador do arrasto (`vertex-drag-controller.ts`), não daqui. Este arquivo só traduz o Gesture Handler 3.3.0 em chamadas simples.
//
// API (Gesture Handler 3.3.0, hooks): `useTapGesture`, `usePanGesture`, `useCompetingGestures` + `GestureDetector`. NÃO é a API `Gesture.Tap()` do
// Gesture Handler 2.
//
// Onde cada callback roda: TODOS no runtime JavaScript (`runOnJS: true` nos dois gestos). Nenhum worklet roda na thread de interface com código
// do domínio, do núcleo ou da store; nada é despachado de um worklet. Foi a escolha mais simples para as versões instaladas (Reanimated 4.7.1,
// Worklets 0.13.0) e basta: o gesto só entrega números, e o hit-testing e o `applyAction` (puros) rodam onde a store e o React vivem. A única chamada
// que cruza da JS para a thread nativa é `GestureStateManager.activate`, que o Gesture Handler 3 oferece justamente para isso (no runtime JS ele usa
// `_setGestureStateAsync`; dentro de um worklet usaria `_setGestureStateSync`). Se a medição no Android mostrar que o atraso do JS atrapalha, a
// alternativa é mover a prévia para um valor compartilhado do Reanimated (ver docs/ARCHITECTURE.md, "Prévia do arrasto").
//
// TOQUE (3.6)
// - O toque é concluído em `onDeactivate`, uma vez por toque. `onActivate` e `onFinalize` NÃO são usados (o `onFinalize` também dispara depois do
//   `onDeactivate`: tratá-lo duplicaria a ação). Se `event.canceled`, nada acontece: um toque cancelado nunca edita.
// - Coordenadas: `event.x` e `event.y` são locais à view envolvida (em dp). `absoluteX` e `absoluteY` (da tela) NÃO são usados: a câmera, o `viewport` e a
//   cena têm a origem no canto do canvas, e converter a absoluta exigiria saber onde o canvas está na tela.
// - `shouldCancelWhenOutside` fica no padrão (verdadeiro): o dedo que sai do canvas cancela o toque.
// - `maxDistance` (dp): no Android o padrão do Gesture Handler NÃO limita a distância (só a duração, 500 ms). Visto no emulador: um deslize rápido de
//   ~240 dp começado sobre o quadro, ao rolar a página, era aceito como toque e criava um vértice. Com o limite, o deslize falha o gesto e a página rola
//   normalmente. O valor é a folga de toque do Android (`ViewConfiguration.getScaledTouchSlop`, 8 dp) com uma margem para dedos imprecisos.
//
// ARRASTO (3.9): ativação MANUAL
// O arrasto só pode começar se o dedo desceu sobre um VÉRTICE (hit-testing do núcleo), e essa decisão é do JavaScript. Um `usePanGesture` comum ativa
// sozinho depois de poucos dp em QUALQUER ponto do canvas, e ao ativar o Gesture Handler cancela os filhos nativos, ScrollView da página incluído:
// um deslize sobre o fundo deixaria de rolar a página. Por isso o pan usa `manualActivation: true`: ele NUNCA ativa por conta própria.
// - `onBegin` (o dedo desceu; `x`, `y` locais): o controlador faz o hit-testing UMA vez e, se acertou um vértice, arma a sessão (`drag.begin`). Fundo ou
//   aresta: nada é armado.
// - `onTouchesMove` (cada movimento, com a posição local do dedo): se há sessão armada e o dedo já andou `DRAG_START_DISTANCE_DP` (10 dp, o mesmo
//   `maxDistance` do toque), pede a ativação (`GestureStateManager.activate`). Sem sessão, não pede nunca: o pan fica em BEGAN sem fazer nada, o
//   ScrollView da página rola como sempre e o pan termina quando o dedo sobe. Pedir uma vez só por gesto (`requested`).
// - Ativado, `onUpdate` traz a posição LOCAL atual do dedo (`x`, `y`), e o detector entrega ao controlador o DESLOCAMENTO desde que o dedo desceu (a posição
//   atual menos a de `onBegin`, em dp). `translationX/Y` do Gesture Handler NÃO é usado: medido no emulador, com ativação manual a translação começa em 0 no
//   ponto da ATIVAÇÃO e não onde o dedo desceu (o dedo já tinha andado ~28 dp), então o vértice ficaria atrás do dedo por essa distância e o grab offset se
//   perderia. A posição local não depende desse detalhe e acompanha o canvas se a página se mexer. `onDeactivate` entrega o fim (`canceled` distingue soltar
//   de cancelar) e `onFinalize` sempre limpa (inclusive quando o gesto falhou ou foi cancelado antes de ativar).
// Usa `maxPointers: 1`: o arrasto é de um dedo (pinça é do 3.10).
//
// TOQUE × ARRASTO: `useCompetingGestures` (corrida). Os dois recebem o mesmo toque; o primeiro que ATIVA cancela o outro. O toque ativa ao levantar o
// dedo se ele andou no máximo 10 dp (e dura até 500 ms) e falha se andou mais; o pan só ativa (pelo JS) com 10 dp ou mais. Os dois limites são o mesmo
// valor, então um mesmo movimento nunca é toque e arrasto: até 10 dp é toque, de 10 dp em diante é arrasto (se começou num vértice) ou deslize
// (rolagem, no fundo). Quando o pan ativa, o toque é cancelado (`onDeactivate` do toque nunca chama `onTap`); quando o toque ativa, o pan (que nunca
// ativou) é cancelado e `drag.finalize` descarta a sessão sem confirmar nada. Um gesto, uma operação. `requireToFail`, `block` e `simultaneousWith`
// NÃO são usados: a ativação manual já resolve a rolagem e a corrida resolve o toque, e acrescentar relações só cria esperas (o toque esperando o pan
// falhar atrasaria cada toque até o dedo subir).
//
// ROLAGEM DA PÁGINA: a página (`Screen`) é um `ScrollView` nativo do React Native, fora do Gesture Handler. Quando o pan ativa, o Gesture Handler
// cancela os filhos nativos do mesmo toque (o ScrollView para); quando não ativa, nada interfere. Esse comportamento nativo só se vê no aparelho; os
// testes em Jest conferem a configuração e o protocolo, e o emulador, o efeito (ver docs/ARCHITECTURE.md).
//
// A configuração dos hooks é refeita a cada renderização, então os callbacks sempre veem as props mais recentes (por exemplo, a câmera nova depois de
// um redimensionamento).

/** Quanto o dedo pode andar, em dp, entre descer e levantar para ainda contar como toque (mais que isso é um deslize). */
export const TAP_MAX_DISTANCE_DP = 10;

/**
 * O que o detector chama durante um arrasto de vértice. Todos os pontos estão em dp, locais ao canvas. Quem implementa decide tudo (o detector não
 * conhece grafo, câmera nem vértice).
 */
export type CanvasDragHandlers = {
  /** O dedo desceu em `point`: decide, uma vez, se há um vértice a arrastar (arma a sessão) ou não. */
  begin(point: Point): void;
  /** O dedo se moveu para `point` antes de o arrasto ativar: `true` pede ao Gesture Handler que ative o arrasto agora. */
  touchMove(point: Point): boolean;
  /** O Gesture Handler ativou o arrasto (depois do pedido). */
  activated(): void;
  /** Deslocamento do dedo desde que desceu, em dp (a posição local atual menos a do `begin`). */
  update(translation: Point): void;
  /** O dedo subiu com o arrasto ativo: confirma. `translation` é o deslocamento final, calculado como em `update`. */
  release(translation: Point): void;
  /** O arrasto ativo foi cancelado (pelo sistema, por outro gesto ou por perder o toque): restaura. */
  cancel(): void;
  /** O gesto terminou de qualquer jeito (soltou, cancelou ou nem chegou a ativar): descarta o que sobrou. Pode ser chamado várias vezes. */
  finalize(): void;
};

type Props = {
  /** Chamado uma vez por toque concluído, com o ponto em dp relativo à view envolvida. */
  onTap: (point: Point) => void;
  /** O arrasto de vértice. Sem ele, o pan nunca ativa. Mantenha a identidade estável: ele não deve mudar a cada renderização. */
  drag?: CanvasDragHandlers;
  /** Uma única view nativa: a do canvas. */
  children: ReactElement;
};

/**
 * O deslocamento do dedo desde onde ele desceu, em dp: a posição LOCAL atual (`x`, `y`) menos a de `onBegin`. Não usa `translationX/Y` do Gesture Handler (veja
 * o cabeçalho). `undefined` se o gesto não tem origem (não deveria acontecer: todo gesto começa com `onBegin`).
 */
function displacement(origin: Point | undefined, current: Point): Point | undefined {
  return origin === undefined ? undefined : { x: current.x - origin.x, y: current.y - origin.y };
}

export function CanvasGestureDetector({ onTap, drag, children }: Props) {
  // O pedido de ativação já foi feito neste gesto? (um só por gesto; zerado quando o dedo desce e quando o gesto termina)
  const requested = useRef(false);
  // Onde o dedo desceu (local, em dp): a origem do deslocamento que o controlador recebe.
  const origin = useRef<Point | undefined>(undefined);

  const tap = useTapGesture({
    testID: 'canvas-tap',
    runOnJS: true,
    maxDistance: TAP_MAX_DISTANCE_DP,
    onDeactivate: (event) => {
      if (event.canceled) return;
      onTap({ x: event.x, y: event.y });
    },
  });

  const pan = usePanGesture({
    testID: 'canvas-pan',
    runOnJS: true,
    manualActivation: true,
    maxPointers: 1,
    onBegin: (event) => {
      requested.current = false;
      origin.current = { x: event.x, y: event.y };
      drag?.begin({ x: event.x, y: event.y });
    },
    onTouchesMove: (event) => {
      if (requested.current || drag === undefined) return;
      const touch = event.allTouches[0];
      if (touch === undefined) return;
      if (drag.touchMove({ x: touch.x, y: touch.y })) {
        requested.current = true;
        GestureStateManager.activate(event.handlerTag);
      }
    },
    onActivate: () => {
      drag?.activated();
    },
    onUpdate: (event) => {
      const shift = displacement(origin.current, event);
      if (shift !== undefined) drag?.update(shift);
    },
    onDeactivate: (event) => {
      if (event.canceled) drag?.cancel();
      else {
        const shift = displacement(origin.current, event);
        if (shift !== undefined) drag?.release(shift);
      }
    },
    onFinalize: () => {
      requested.current = false;
      origin.current = undefined;
      drag?.finalize();
    },
  });

  const gesture = useCompetingGestures(pan, tap);
  return <GestureDetector gesture={gesture}>{children}</GestureDetector>;
}
