// Conversão do texto do campo de peso (Fase 3, incremento 3.8). TypeScript puro: não importa React nem React Native. O resultado é o que o
// formulário entrega ao `set-weight` do núcleo, que continua sendo a validação definitiva (`setEdgeWeight` do domínio).
//
// O que o campo vazio significa: REMOVER o peso (`weight: undefined`). Não é zero (`Number('') === 0` seria um erro de produto): peso `0`
// é um peso, e a aresta sem peso não tem peso nenhum. Por isso o campo vazio e o `0` dão resultados diferentes.
//
// Gramática (depois de tirar os espaços das pontas, qualquer espaço, inclusive o sem quebra):
//   número  = sinal? ( dígitos ( separador dígitos )? | separador dígitos ) expoente?
//   sinal   = "+" | "-"            separador = "," | "."          expoente = ("e" | "E") sinal? dígitos
//   dígitos = só 0 a 9 (nenhum algarismo de outro alfabeto)
// - UM separador decimal, vírgula ou ponto ("2,5" e "2.5" valem 2,5), e dígitos dos dois lados dele ou só do lado direito (",5" vale 0,5).
//   "2," e "2." (separador sem dígitos depois) são recusados, como "1,2,3" e "1.234,56": NÃO existe separador de milhar, então não há
//   como adivinhar o que o aluno quis dizer. O ponto é SEMPRE decimal: "1.234" vale 1,234, não mil duzentos e trinta e quatro;
// - notação científica É aceita ("1e3", "2,5E-2"): é a forma em que o JavaScript escreve os números muito grandes ou pequenos, e aceitá-la
//   faz o texto que o formulário mostra para um peso existente (`formatWeightForInput`) voltar a ser lido como o mesmo número;
// - nada de `parseFloat`: ele aceitaria prefixos de textos inválidos ("12abc"); aqui o texto inteiro precisa casar com a gramática.
// - "NaN", "Infinity", "0x10", "1 2", "--1" e "abc" não casam: erro de formato.
//
// Faixa: o valor final precisa ser FINITO. Um texto bem formado que estoura o `Number` ("1e400") ou que é tão pequeno que viraria zero sem
// ser zero ("1e-400") é recusado como fora da faixa, em vez de virar `Infinity` ou um `0` enganoso. `-0` vale `0` (o domínio também normaliza).
//
// Complexidade: Θ(n) no tamanho do texto, sem alocação além de uma cópia.

export type WeightInputError = 'INVALID_FORMAT' | 'OUT_OF_RANGE';

export type WeightInputResult =
  /** `weight` é o número a gravar, ou `undefined` para REMOVER o peso (campo vazio). */
  | { readonly ok: true; readonly weight: number | undefined }
  | { readonly ok: false; readonly reason: WeightInputError };

const WEIGHT_PATTERN = /^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:[eE][+-]?\d+)?$/;

/** Interpreta o texto do campo de peso. Pura e determinística; não altera nada. */
export function parseWeightInput(text: string): WeightInputResult {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, weight: undefined };
  if (!WEIGHT_PATTERN.test(trimmed)) return { ok: false, reason: 'INVALID_FORMAT' };

  const value = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(value)) return { ok: false, reason: 'OUT_OF_RANGE' };
  const mantissa = trimmed.split(/[eE]/)[0] ?? '';
  if (value === 0 && /[1-9]/.test(mantissa)) return { ok: false, reason: 'OUT_OF_RANGE' };
  return { ok: true, weight: value === 0 ? 0 : value };
}

/** O texto que o formulário mostra para um peso: vazio sem peso, e o número com vírgula decimal (pt-BR), que o `parseWeightInput` lê de volta. */
export function formatWeightForInput(weight: number | undefined): string {
  return weight === undefined ? '' : String(weight).replace('.', ',');
}

/** Mensagem em português para um erro de conversão. */
export function weightInputMessage(reason: WeightInputError): string {
  return reason === 'OUT_OF_RANGE'
    ? 'Esse número é grande ou pequeno demais para ser guardado.'
    : 'Digite um número, como 2, -3,5 ou 0. Deixe o campo vazio para uma aresta sem peso.';
}
