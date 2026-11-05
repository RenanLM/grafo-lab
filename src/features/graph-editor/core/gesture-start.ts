import type { Camera, Point, Viewport } from './camera';
import { dragSessionAt, type DragEditorState, type DragSession } from './drag';
import type { HitTestOptions } from './geometry';
import { hitTapTarget } from './tap';

// Quem é o dono de um gesto de UM dedo no canvas (Fase 3, incremento 3.10). TypeScript puro. Depois que o dedo desce, a tela precisa decidir, UMA vez, o que um deslize
// significa; e como todo deslize começa com a mesma consulta (o `hitTest` do 3.3, a MESMA função do toque), aqui está a política numa função só, sem hit-testing repetido.
//
// | O que há sob o dedo, ao descer                          | Dono do deslize                                                     |
// | ------------------------------------------------------- | ------------------------------------------------------------------- |
// | vértice, com o modo Selecionar                          | `vertex`: arrasta o VÉRTICE (a sessão de `dragSessionAt`)           |
// | fundo (qualquer modo)                                   | `camera`: desloca a CÂMERA                                          |
// | vértice nos outros modos (Adicionar vértice, Conectar)  | `none`: não inicia pan nenhum                                       |
// | aresta (qualquer modo)                                  | `none`: não inicia pan neste incremento                             |
// | toque inválido (fora do canvas, câmera ou área inválidas) | `none`                                                            |
//
// O dono NÃO muda depois da ativação: quem chama guarda o resultado e o devolve a cada atualização do mesmo gesto. `none` significa que o pan nunca ativa, e então a rolagem da página
// (um `ScrollView` nativo, fora do Gesture Handler) fica livre. O toque curto não passa por aqui: ele continua sendo interpretado pelo modo (`tapToEditorAction` e companhia).
// A prioridade vértice > aresta > fundo e o alvo mínimo de 48 dp são os do `hitTest`; o ponto e a câmera são os do começo do gesto.
//
// Complexidade: a do `hitTest` (Θ(V) se o dedo cai num vértice; senão Θ(V + E·N)), uma vez por gesto; o resto é O(1).

/** O dono de um deslize de um dedo: o vértice sob o dedo (com a sessão pronta), a câmera (fundo) ou ninguém. */
export type GestureOwner =
  | { readonly kind: 'vertex'; readonly session: DragSession }
  | { readonly kind: 'camera' }
  | { readonly kind: 'none' };

const CAMERA_OWNER: GestureOwner = Object.freeze({ kind: 'camera' });
const NO_OWNER: GestureOwner = Object.freeze({ kind: 'none' });

/**
 * O dono do deslize que começa em `screenPoint` (dp, relativo ao canto do canvas), com a `camera` do começo do gesto e o `viewport` do canvas (veja a tabela do cabeçalho). `options`: as
 * mesmas opções de geometria e de hit-testing do desenho. Não altera nada.
 */
export function gestureOwnerAt(
  state: DragEditorState,
  camera: Camera,
  screenPoint: Point,
  viewport: Viewport,
  options: HitTestOptions = {},
): GestureOwner {
  const target = hitTapTarget(state.graph, state.layout, camera, screenPoint, viewport, options);
  if (target === undefined) return NO_OWNER;
  if (target.type === 'background') return CAMERA_OWNER;
  if (target.type === 'vertex' && state.mode === 'select') {
    const session = dragSessionAt(state, camera, screenPoint, target.vertexId);
    return session === undefined ? NO_OWNER : { kind: 'vertex', session };
  }
  return NO_OWNER;
}
