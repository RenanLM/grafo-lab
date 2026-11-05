import { useRef, type ReactElement } from 'react';
import {
  GestureDetector,
  GestureStateManager,
  useCompetingGestures,
  usePanGesture,
  usePinchGesture,
  useTapGesture,
} from 'react-native-gesture-handler';

import type { Point } from './core';

// Detector de gestos ÚNICO do canvas (Fase 3, incrementos 3.6, 3.9 e 3.10): o toque, o deslize de um dedo (arrasto de vértice ou pan da câmera) e a pinça de dois dedos. Entrega
// pontos em dp e RELATIVOS ao canto superior esquerdo da view que ele envolve; a decisão do que cada gesto significa não é daqui: é do núcleo puro (`tapToEditorAction`,
// `gestureOwnerAt`, `pinchFromAnchor`…) e do orquestrador (`canvas-gesture-controller.ts`). Este arquivo só traduz o Gesture Handler 3.3.0 em chamadas simples.
//
// API (Gesture Handler 3.3.0, hooks): `useTapGesture`, `usePanGesture`, `usePinchGesture`, `useCompetingGestures` + `GestureDetector`. NÃO é a API `Gesture.Tap()` do Gesture Handler 2.
//
// Onde cada callback roda: TODOS no runtime JavaScript (`runOnJS: true` nos três gestos). Nenhum worklet roda na thread de interface com código do domínio, do núcleo ou da store; nada é
// despachado de um worklet. A única chamada que cruza da JS para a thread nativa é `GestureStateManager`, que o Gesture Handler 3 oferece para isso (no runtime JS ele usa
// `_setGestureStateAsync`; dentro de um worklet usaria `_setGestureStateSync`): `activate` (o pedido de ativação do pan) e `fail` (o toque de dois dedos).
//
// TOQUE (3.6)
// - O toque é concluído em `onDeactivate`, uma vez por toque. `onActivate` e `onFinalize` NÃO são usados (o `onFinalize` também dispara depois do `onDeactivate`: tratá-lo duplicaria a
//   ação). Se `event.canceled`, nada acontece: um toque cancelado nunca edita.
// - Coordenadas: `event.x` e `event.y` são locais à view envolvida (em dp). `absoluteX` e `absoluteY` (da tela) NÃO são usados: a câmera, o `viewport` e a cena têm a origem no canto do canvas.
// - `shouldCancelWhenOutside` fica no padrão (verdadeiro): o dedo que sai do canvas cancela o toque.
// - `maxDistance` (dp): no Android o padrão do Gesture Handler NÃO limita a distância (só a duração, 500 ms); sem o limite, um deslize rápido era aceito como toque e criava um vértice. O valor é a folga de
//   toque do Android (`ViewConfiguration.getScaledTouchSlop`, 8 dp) com uma margem para dedos imprecisos.
// - Toque de DOIS dedos (3.10): o Gesture Handler do Android conta como toque qualquer toque curto que passou por `minPointers` dedos ou mais (`currentMaxNumberOfPointers >= minPointers`), então dois
//   dedos que descem e sobem rápido, sem esticar a pinça, viravam um toque (criavam um vértice). Em `onTouchesDown` com mais de um dedo o toque FALHA: um toque tem um dedo só.
//
// DESLIZE DE UM DEDO (3.9 e 3.10): ativação MANUAL
// Quem é o dono do deslize (o vértice sob o dedo, a câmera ou ninguém) é decidido pelo JavaScript (`gestureOwnerAt`, o hit-testing do núcleo, UMA vez). Um `usePanGesture` comum ativaria sozinho depois de
// poucos dp em QUALQUER ponto do canvas, e ao ativar o Gesture Handler cancela os filhos nativos do toque, o `ScrollView` da página incluído: um deslize sobre uma aresta, ou sobre um vértice fora do modo
// Selecionar, deixaria de rolar a página sem mover nada. Por isso o pan usa `manualActivation: true`: ele NUNCA ativa por conta própria.
// - `onBegin` (o dedo desceu; `x`, `y` locais): o orquestrador decide o dono e arma a sessão (`pan.begin`). Aresta, ou vértice fora do modo Selecionar: nada é armado.
// - `onTouchesMove` (cada movimento, com a posição local do dedo): se há sessão armada e o dedo já andou 10 dp (o mesmo `maxDistance` do toque), pede a ativação (`GestureStateManager.activate`). Sem
//   sessão, não pede nunca: o pan fica em BEGAN sem fazer nada, o `ScrollView` rola como sempre e o pan termina quando o dedo sobe. Pedir uma vez só por gesto (`requested`).
// - Ativado, `onUpdate` traz a posição LOCAL atual do dedo (`x`, `y`), e o detector entrega ao orquestrador o DESLOCAMENTO desde que o dedo desceu (a posição atual menos a de `onBegin`, em dp), também
//   em `onActivate` (o deslocamento no instante da ativação, que a câmera usa como origem para o quadro não saltar). `translationX/Y` do Gesture Handler NÃO é usado: com ativação manual a translação começa
//   em 0 no ponto da ATIVAÇÃO (o Android a zera em `activate`), então ela perde o que o dedo andou antes (medido no emulador: ~28 dp) e o vértice ficaria atrás do dedo por essa distância. A posição local
//   não depende desse detalhe. `onDeactivate` entrega o fim (`canceled` distingue soltar de cancelar) e `onFinalize` sempre limpa (inclusive quando o gesto falhou ou foi cancelado antes de ativar).
// - `maxPointers: 1`: o Gesture Handler do Android CANCELA o pan ativo quando um segundo dedo desce (`cancel`) e o faz FALHAR se ainda não tinha ativado. É por isso que um segundo dedo nunca
//   confirma um movimento: o arrasto de vértice restaura a posição e o pan da câmera preserva a última câmera. Medido no Android: depois de um pan ATIVO (ou de um arrasto ativo) o segundo dedo só
//   cancela; a pinça NÃO assume na mesma sequência de toques (o Gesture Handler já deu a vitória ao pan), e o aluno levanta os dedos e recomeça. Com o pan ainda não ativado (dedo parado ou andou
//   menos de 10 dp), o segundo dedo faz o pan falhar e a pinça assume.
//
// PINÇA (3.10): `usePinchGesture`. A ativação é pedida AQUI, no `onTouchesDown` com dois dedos (`GestureStateManager.activate`): dois dedos sobre o canvas são do canvas desde que o segundo desce. Sem isso
// a pinça só ativaria depois de o vão entre os dedos mudar a folga de toque, e nesse intervalo dois dedos que andam juntos rolam o `ScrollView` da página (medido: 118 px) e o foco local se desloca
// com o canvas. O Android zera a `scale` na ativação, e depois o `ScaleGestureDetector` só começa a contar a escala quando o vão passa a folga dele (≈19 dp): a `scale` é a escala ACUMULADA DESDE ESSE
// PONTO (1 na ativação), sem salto, e `focalX`/`focalY` são o ponto médio dos dedos, já convertido para a view do canvas (local, em dp). `scaleChange` NÃO é usado: o orquestrador calcula a câmera
// sempre a partir da âncora (câmera e foco da ativação) e da escala acumulada. `onDeactivate` com `canceled` distingue soltar de cancelar. Ao levantar o primeiro dedo o Gesture Handler manda ainda uma
// atualização com `numberOfPointers === 1` e o foco no dedo que restou: é ignorada (senão a câmera saltaria dezenas de dp).
//
// COMPOSIÇÃO: `useCompetingGestures(pan, pinch, tap)` (corrida). Os três recebem o mesmo toque; o primeiro que ATIVA cancela os outros. O toque ativa ao levantar o dedo se ele andou no máximo 10 dp e falha se andou
// mais; o pan só ativa (pelo JS) com 10 dp ou mais, e os dois limites são o mesmo valor: até 10 dp é toque, de 10 dp em diante é deslize. A pinça ativa com dois dedos, que também fazem o pan falhar ou cancelar.
// Quando um ativa, o toque nunca chama `onTap`. `requireToFail`, `block` e `simultaneousWith` NÃO são usados: a ativação manual resolve a rolagem e a corrida resolve o resto; e como a pinça já carrega o
// deslocamento do foco, não há um pan de dois dedos simultâneo.
//
// ROLAGEM DA PÁGINA (mudança do 3.10): a página (`Screen`) é um `ScrollView` nativo do React Native, fora do Gesture Handler. Quando o pan (de vértice OU de câmera) ou a pinça ativam, o Gesture Handler cancela
// os filhos nativos do toque (o `ScrollView` para); quando nada ativa, nada interfere. Antes do 3.10 um deslize no fundo rolava a página; agora ele move a câmera, e a página rola por deslizes FORA do canvas (e pelos
// que começam sobre uma aresta ou sobre um vértice fora do modo Selecionar). O `scrollEnabled` nunca é alterado.
//
// A configuração dos hooks é refeita a cada renderização, então os callbacks sempre veem as props mais recentes (por exemplo, o viewport novo depois de um redimensionamento).

/** Quanto o dedo pode andar, em dp, entre descer e levantar para ainda contar como toque (mais que isso é um deslize). */
export const TAP_MAX_DISTANCE_DP = 10;

/**
 * O que o detector chama durante um deslize de UM dedo. Todos os pontos estão em dp, locais ao canvas. Quem implementa decide tudo (o detector não conhece grafo, câmera nem vértice): o orquestrador
 * escolhe o dono do deslize em `begin` e encaminha o resto.
 */
export type CanvasPanHandlers = {
  /** O dedo desceu em `point`: decide, uma vez, o dono do deslize (vértice, câmera ou ninguém) e arma a sessão. */
  begin(point: Point): void;
  /** O dedo se moveu para `point` antes de o pan ativar: `true` pede ao Gesture Handler que ative o pan agora. */
  touchMove(point: Point): boolean;
  /** O Gesture Handler ativou o pan (depois do pedido); `displacement` é o deslocamento do dedo desde que desceu, neste instante. */
  activated(displacement: Point): void;
  /** Deslocamento do dedo desde que desceu, em dp (a posição local atual menos a do `begin`). */
  update(displacement: Point): void;
  /** O dedo subiu com o pan ativo: confirma. `displacement` é o deslocamento final, calculado como em `update`. */
  release(displacement: Point): void;
  /** O pan ativo foi cancelado (pelo sistema, por um segundo dedo ou por perder o toque). */
  cancel(): void;
  /** O gesto terminou de qualquer jeito (soltou, cancelou ou nem chegou a ativar): descarta o que sobrou. Pode ser chamado várias vezes. */
  finalize(): void;
};

/** O que o detector chama durante uma pinça de DOIS dedos. `focal` está em dp, local ao canvas; `scale` é a escala ACUMULADA desde a ativação (1 = sem mudança). */
export type CanvasPinchHandlers = {
  /** A pinça ativou, com o foco e a escala acumulada daquele instante. */
  activated(focal: Point, scale: number): void;
  /** A pinça segue, com o foco atual e a escala acumulada. */
  update(focal: Point, scale: number): void;
  /** Os dedos subiram. */
  end(): void;
  /** A pinça ativa foi cancelada. */
  cancel(): void;
  /** A pinça terminou de qualquer jeito (inclusive sem ativar). Pode ser chamado várias vezes. */
  finalize(): void;
};

type Props = {
  /** Chamado uma vez por toque concluído, com o ponto em dp relativo à view envolvida. */
  onTap: (point: Point) => void;
  /** O deslize de um dedo (arrasto de vértice ou pan da câmera). Sem ele, o pan nunca ativa. Mantenha a identidade estável: ele não deve mudar a cada renderização. */
  pan?: CanvasPanHandlers;
  /** A pinça de dois dedos. Sem ela, nada acontece com dois dedos além de o toque falhar. Identidade estável. */
  pinch?: CanvasPinchHandlers;
  /** Uma única view nativa: a do canvas. */
  children: ReactElement;
};

/**
 * O deslocamento do dedo desde onde ele desceu, em dp: a posição LOCAL atual (`x`, `y`) menos a de `onBegin`. Não usa `translationX/Y` do Gesture Handler (veja o cabeçalho). `undefined` se o gesto não tem
 * origem (não deveria acontecer: todo gesto começa com `onBegin`).
 */
function displacement(origin: Point | undefined, current: Point): Point | undefined {
  return origin === undefined ? undefined : { x: current.x - origin.x, y: current.y - origin.y };
}

export function CanvasGestureDetector({ onTap, pan: panHandlers, pinch: pinchHandlers, children }: Props) {
  // O pedido de ativação já foi feito neste gesto? (um só por gesto; zerado quando o dedo desce e quando o gesto termina)
  const requested = useRef(false);
  // Onde o dedo desceu (local, em dp): a origem do deslocamento que o orquestrador recebe.
  const origin = useRef<Point | undefined>(undefined);

  const tap = useTapGesture({
    testID: 'canvas-tap',
    runOnJS: true,
    maxDistance: TAP_MAX_DISTANCE_DP,
    onTouchesDown: (event) => {
      // um toque tem UM dedo: com dois ou mais, o toque falha (a pinça, ou nada, fica com o gesto)
      if (event.numberOfTouches > 1) GestureStateManager.fail(event.handlerTag);
    },
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
      panHandlers?.begin({ x: event.x, y: event.y });
    },
    onTouchesMove: (event) => {
      if (requested.current || panHandlers === undefined) return;
      const touch = event.allTouches[0];
      if (touch === undefined) return;
      if (panHandlers.touchMove({ x: touch.x, y: touch.y })) {
        requested.current = true;
        GestureStateManager.activate(event.handlerTag);
      }
    },
    onActivate: (event) => {
      const shift = displacement(origin.current, event);
      if (shift !== undefined) panHandlers?.activated(shift);
    },
    onUpdate: (event) => {
      const shift = displacement(origin.current, event);
      if (shift !== undefined) panHandlers?.update(shift);
    },
    onDeactivate: (event) => {
      if (event.canceled) panHandlers?.cancel();
      else {
        const shift = displacement(origin.current, event);
        if (shift !== undefined) panHandlers?.release(shift);
      }
    },
    onFinalize: () => {
      requested.current = false;
      origin.current = undefined;
      panHandlers?.finalize();
    },
  });

  const pinch = usePinchGesture({
    testID: 'canvas-pinch',
    runOnJS: true,
    onTouchesDown: (event) => {
      // Dois dedos sobre o canvas são do canvas desde o instante em que o segundo desce. Sem isto a pinça só ativa depois de o vão entre os dedos mudar a folga de toque (~8 dp) e, enquanto os
      // dedos andam juntos, o `ScrollView` da página rola (medido no Android: 118 px) e o foco local do gesto se desloca junto com o canvas. Ativando na hora, o Gesture Handler cancela o ScrollView.
      if (event.numberOfTouches > 1) GestureStateManager.activate(event.handlerTag);
    },
    onActivate: (event) => {
      pinchHandlers?.activated({ x: event.focalX, y: event.focalY }, event.scale);
    },
    onUpdate: (event) => {
      // Quando um dos dois dedos sobe, o Gesture Handler ainda manda UMA atualização com `numberOfPointers === 1`: o foco passa a ser o do dedo que restou (um salto de dezenas de dp) e a
      // escala não mudou. Isso não é pinça (medido no Android; ver ARCHITECTURE.md): ignorada, a câmera fica onde os dois dedos a deixaram.
      if (event.numberOfPointers < 2) return;
      pinchHandlers?.update({ x: event.focalX, y: event.focalY }, event.scale);
    },
    onDeactivate: (event) => {
      if (event.canceled) pinchHandlers?.cancel();
      else pinchHandlers?.end();
    },
    onFinalize: () => {
      pinchHandlers?.finalize();
    },
  });

  const gesture = useCompetingGestures(pan, pinch, tap);
  return <GestureDetector gesture={gesture}>{children}</GestureDetector>;
}
