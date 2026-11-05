import type { CameraStore } from './camera-store';
import { fingerMoved, panFromAnchor, pinchFromAnchor, type Camera, type Point } from './core';

// Gestos da câmera (Fase 3, incremento 3.10): o pan de um dedo no fundo e a pinça de dois dedos. TypeScript sem React: recebe o armazém da câmera por parâmetro e só traduz o que
// o detector de gestos entrega (pontos e deslocamentos em dp, locais ao canvas) em chamadas ao armazém. Toda conta é do núcleo puro (`panFromAnchor`, `pinchFromAnchor`); aqui só
// se guardam as sessões. Nada disto toca no grafo, no layout, na store do editor nem no histórico: o único estado alterado é a câmera do `CameraStore`.
//
// Sessão = âncora + época. Cada gesto guarda a câmera e o ponto do dedo (ou o foco) de quando ATIVOU, e a época do armazém quando começou. Cada atualização é calculada A PARTIR da âncora
// (não da atualização anterior) e entregue ao armazém com a época da sessão: se um reset (outro grafo ou exemplo), um comando (Centralizar, Ajustar) ou uma mudança de tamanho do canvas
// avançou a época, o armazém recusa o evento e a sessão morre. Assim um evento atrasado nunca move a câmera de outra sessão, e nunca desfaz um comando do aluno.
//
// PAN (um dedo no fundo). `armPan(ponto)` guarda onde o dedo desceu; `panMoved(ponto)` diz se ele já andou o limiar (10 dp, o do toque); o detector então pede a ativação ao Gesture Handler e
// `panActivated(deslocamento)` recebe o deslocamento do dedo desde que desceu NAQUELE instante: é a origem do pan. Daí em diante a câmera é `panFromAnchor(câmeraDaAtivação, deslocamento −
// origem)`. Resultado: o grafo NÃO salta quando o gesto é reconhecido (a folga do limiar não vira deslocamento, como na rolagem nativa) e depois acompanha o dedo 1 para 1.
//
// PINÇA (dois dedos). `pinchActivated(foco, escala)` guarda a câmera e o foco da ativação e a escala acumulada que o gesto já tinha; `pinchUpdate(foco, escala)` aplica
// `pinchFromAnchor(âncora, focoDaAtivação, escala / escalaDaAtivação, foco)`. A ESCALA ACUMULADA é usada; a incremental (`scaleChange`) não, para nunca multiplicar duas vezes. O foco é o que o Gesture
// Handler entrega (local à view do canvas), e o deslocamento do foco já está na fórmula: a pinça sozinha cobre o movimento dos dois dedos, sem um pan separado.
//
// CANCELAMENTO: a câmera NÃO é uma transação (não tem histórico), então um gesto cancelado (pelo sistema, por um segundo dedo que vira pinça, por uma troca de modo) PRESERVA a última câmera válida
// e a assenta; nada é restaurado. É o que permite a pinça continuar de onde o pan parou, sem saltar. (O arrasto de VÉRTICE é o contrário: ele restaura, porque tem uma posição a confirmar.)
//
// Complexidade: O(1) por evento, mais o aviso aos assinantes do armazém.

export type CameraGestureController = {
  /** O dedo desceu no fundo do canvas, em `start` (dp locais): guarda a sessão de pan (ainda não é pan; pode virar toque). */
  armPan(start: Point): void;
  /** O dedo se moveu para `point` antes de o pan ativar: `true` pede ao Gesture Handler que o ative agora. */
  panMoved(point: Point): boolean;
  /** O Gesture Handler ativou o pan; `displacement` é o deslocamento do dedo desde que desceu, neste instante (a origem do pan). */
  panActivated(displacement: Point): void;
  /** O dedo andou `displacement` desde que desceu: a câmera é a da ativação deslocada pelo que andou depois dela. */
  panUpdate(displacement: Point): void;
  /** O dedo subiu com o pan ativo, com o deslocamento final: aplica e assenta a câmera. */
  panRelease(displacement: Point): void;
  /** O pan ativo foi cancelado: preserva a última câmera válida e a assenta. */
  panCancel(): void;
  /** A pinça ativou, com o foco (dp locais) e a escala acumulada do gesto naquele instante. Encerra um pan que estivesse ativo (assentando a câmera dele). */
  pinchActivated(focal: Point, scale: number): void;
  /** A pinça segue, com o foco atual e a escala acumulada. */
  pinchUpdate(focal: Point, scale: number): void;
  /** Os dedos subiram: assenta a câmera. */
  pinchEnd(): void;
  /** A pinça foi cancelada: preserva a última câmera válida e a assenta. */
  pinchCancel(): void;
  /** O gesto de um dedo terminou de qualquer jeito: assenta o que estiver ativo e descarta a sessão. Pode ser chamado várias vezes. */
  finalizePan(): void;
  /** A pinça terminou de qualquer jeito (inclusive sem ativar): assenta o que estiver ativo e descarta a sessão. */
  finalizePinch(): void;
  /** Encerra tudo (troca de modo, folha aberta, desmontagem): assenta a câmera como está e descarta as sessões. */
  abort(): void;
  isPanning(): boolean;
  isPinching(): boolean;
};

type PanSession = {
  readonly epoch: number;
  readonly start: Point;
  /** Preenchidos na ativação. */
  active: boolean;
  anchor: Camera | undefined;
  origin: Point | undefined;
};

type PinchSession = {
  readonly epoch: number;
  readonly anchor: Camera;
  readonly focal: Point;
  /** A escala acumulada que o gesto já tinha na ativação (a nativa zera na ativação, mas a conta não depende disso). */
  readonly scale: number;
};

export function createCameraGestureController(store: CameraStore): CameraGestureController {
  let pan: PanSession | undefined;
  let pinch: PinchSession | undefined;

  /** Assenta a câmera da sessão (se ainda é a época dela) e a descarta. */
  const endPan = (): void => {
    if (pan?.active) store.settle(pan.epoch);
    pan = undefined;
  };
  const endPinch = (): void => {
    if (pinch !== undefined) store.settle(pinch.epoch);
    pinch = undefined;
  };

  /** Envia a câmera à época da sessão; se o armazém recusar (época nova), a sessão morreu. */
  const applyPan = (displacement: Point): void => {
    const session = pan;
    if (session?.anchor === undefined || session.origin === undefined) return;
    const camera = panFromAnchor(session.anchor, { x: displacement.x - session.origin.x, y: displacement.y - session.origin.y });
    if (!store.update(camera, session.epoch)) pan = undefined;
  };

  return {
    armPan: (start) => {
      pan = { epoch: store.getEpoch(), start, active: false, anchor: undefined, origin: undefined };
    },
    panMoved: (point) => pan !== undefined && !pan.active && fingerMoved(pan.start, point),
    panActivated: (displacement) => {
      const session = pan;
      if (session === undefined) return;
      if (session.epoch !== store.getEpoch()) {
        pan = undefined; // a época mudou entre descer e ativar: o gesto é de outra sessão
        return;
      }
      session.active = true;
      session.anchor = store.get();
      session.origin = displacement;
    },
    panUpdate: (displacement) => {
      if (pan?.active) applyPan(displacement);
    },
    panRelease: (displacement) => {
      if (pan?.active) applyPan(displacement);
      endPan();
    },
    panCancel: endPan,
    pinchActivated: (focal, scale) => {
      endPan();
      endPinch();
      if (!Number.isFinite(scale) || scale <= 0) return;
      pinch = { epoch: store.getEpoch(), anchor: store.get(), focal, scale };
    },
    pinchUpdate: (focal, scale) => {
      const session = pinch;
      if (session === undefined) return;
      const camera = pinchFromAnchor(session.anchor, session.focal, scale / session.scale, focal);
      if (!store.update(camera, session.epoch)) pinch = undefined;
    },
    pinchEnd: endPinch,
    pinchCancel: endPinch,
    finalizePan: endPan,
    finalizePinch: endPinch,
    abort: () => {
      endPan();
      endPinch();
    },
    isPanning: () => pan?.active === true,
    isPinching: () => pinch !== undefined,
  };
}
