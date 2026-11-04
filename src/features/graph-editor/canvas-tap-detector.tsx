import type { ReactElement } from 'react';
import { GestureDetector, useTapGesture } from 'react-native-gesture-handler';

import type { Point } from './core';

// Detector de toque ÚNICO do canvas (Fase 3, incremento 3.6). Entrega o ponto tocado, já em dp e RELATIVO ao canto superior esquerdo
// da view que ele envolve; a decisão do que o toque significa é do núcleo puro (`tapToEditorAction`), não daqui.
//
// API (Gesture Handler 3.3.0, hooks): `useTapGesture` + `GestureDetector`. NÃO é a API `Gesture.Tap()` do Gesture Handler 2.
// - `runOnJS: true`: o callback roda no runtime JavaScript, onde a store e o React vivem; nada é despachado de um worklet na
//   thread de interface. É a estratégia mais simples para as versões instaladas (Reanimated 4.7.1, Worklets 0.13.0) e basta,
//   pois o toque simples não precisa de resposta a cada quadro.
// - O toque é concluído em `onDeactivate`, uma vez por toque. `onActivate` e `onFinalize` NÃO são usados (o `onFinalize` também
//   dispara depois do `onDeactivate`: tratá-lo duplicaria a ação). Se `event.canceled`, nada acontece: um toque cancelado nunca edita.
// - Coordenadas: `event.x` e `event.y` são locais à view envolvida (em dp). `absoluteX` e `absoluteY` (da tela) NÃO são usados: a
//   câmera, o `viewport` e a cena têm a origem no canto do canvas, e converter a absoluta exigiria saber onde o canvas está na tela.
// - `shouldCancelWhenOutside` fica no padrão (verdadeiro): o dedo que sai do canvas cancela o toque.
// - `maxDistance` (dp): no Android o padrão do Gesture Handler NÃO limita a distância (só a duração, 500 ms). Visto no emulador: um
//   deslize rápido de ~240 dp começado sobre o quadro, ao rolar a página, era aceito como toque e criava um vértice (no ponto onde o
//   dedo parou). Com o limite, o deslize falha o gesto (nada é criado) e a página rola normalmente. O valor é o da folga de toque
//   do Android (`ViewConfiguration.getScaledTouchSlop`, 8 dp) com uma margem para dedos imprecisos.
// - Hierarquia: o detector envolve UMA view nativa (a do canvas), que contém o SVG; não há detectores nos elementos do SVG. Um
//   `InterceptingGestureDetector` só seria necessário se o toque precisasse ser decidido por elemento do SVG, o que o
//   hit-testing do núcleo faz sem ele.
//
// A configuração do hook é refeita a cada renderização, então o callback sempre vê as props mais recentes (por exemplo, a câmera
// nova depois de um redimensionamento).

/** Quanto o dedo pode andar, em dp, entre descer e levantar para ainda contar como toque (mais que isso é um deslize). */
export const TAP_MAX_DISTANCE_DP = 10;

type Props = {
  /** Chamado uma vez por toque concluído, com o ponto em dp relativo à view envolvida. */
  onTap: (point: Point) => void;
  /** Uma única view nativa: a do canvas. */
  children: ReactElement;
};

export function CanvasTapDetector({ onTap, children }: Props) {
  const tap = useTapGesture({
    testID: 'canvas-tap',
    runOnJS: true,
    maxDistance: TAP_MAX_DISTANCE_DP,
    onDeactivate: (event) => {
      if (event.canceled) return;
      onTap({ x: event.x, y: event.y });
    },
  });
  return <GestureDetector gesture={tap}>{children}</GestureDetector>;
}
