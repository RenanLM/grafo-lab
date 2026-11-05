import { formatWeightForInput, parseWeightInput, weightInputMessage } from './weight-input';
import { seededRandom } from './test-helpers';

// Conversão do texto do campo de peso (ver weight-input.ts). O campo vazio REMOVE o peso (`undefined`); `0` é um peso; a gramática é
// explícita e não aceita prefixos de textos inválidos (nada de `parseFloat`).

const ok = (weight: number | undefined) => ({ ok: true, weight });
const bad = (reason: 'INVALID_FORMAT' | 'OUT_OF_RANGE') => ({ ok: false, reason });

describe('parseWeightInput: os valores do contrato', () => {
  it.each([
    ['2', 2],
    ['2,5', 2.5],
    ['2.5', 2.5],
    ['-3,75', -3.75],
    ['-3.75', -3.75],
    ['0', 0],
    ['0,0', 0],
    ['007', 7],
    ['12345', 12345],
    ['+4', 4],
    ['+0,5', 0.5],
    [',5', 0.5],
    ['.5', 0.5],
    ['-,5', -0.5],
    ['-.25', -0.25],
    ['1.234', 1.234], // o ponto é SEMPRE decimal: nunca separador de milhar (não vale mil duzentos e trinta e quatro)
    ['1,234', 1.234],
  ])('%j vale %d', (text, weight) => {
    expect(parseWeightInput(text)).toStrictEqual(ok(weight));
  });

  it('-0 vale 0 (e nunca -0): o domínio também normaliza', () => {
    for (const text of ['-0', '-0,0', '-0.000', '+0', '-0e5']) {
      const result = parseWeightInput(text);
      expect(result).toStrictEqual(ok(0));
      expect(Object.is(result.ok && result.weight, 0)).toBe(true);
    }
  });

  it('campo vazio ou só espaços REMOVE o peso (undefined), e isso é diferente de 0', () => {
    for (const text of ['', ' ', '   ', '\t', '\n', ' ', '  \t ']) {
      expect(parseWeightInput(text)).toStrictEqual(ok(undefined));
    }
    expect(parseWeightInput('0')).toStrictEqual(ok(0));
    expect(parseWeightInput('0')).not.toStrictEqual(parseWeightInput(''));
  });

  it('espaços nas pontas não importam, no meio do número sim', () => {
    expect(parseWeightInput('  2,5  ')).toStrictEqual(ok(2.5));
    expect(parseWeightInput(' -3 ')).toStrictEqual(ok(-3));
    expect(parseWeightInput('1 2')).toStrictEqual(bad('INVALID_FORMAT'));
    expect(parseWeightInput('- 3')).toStrictEqual(bad('INVALID_FORMAT'));
    expect(parseWeightInput('2 ,5')).toStrictEqual(bad('INVALID_FORMAT'));
  });

  it('notação científica é aceita (a forma em que o JavaScript escreve os extremos): 1e3, 2,5E-2, -1e+2', () => {
    expect(parseWeightInput('1e3')).toStrictEqual(ok(1000));
    expect(parseWeightInput('2,5E-2')).toStrictEqual(ok(0.025));
    expect(parseWeightInput('-1e+2')).toStrictEqual(ok(-100));
    expect(parseWeightInput('.5e1')).toStrictEqual(ok(5));
    expect(parseWeightInput('0e5')).toStrictEqual(ok(0));
  });
});

describe('parseWeightInput: o que é recusado', () => {
  it.each([
    'abc',
    'NaN',
    'nan',
    'Infinity',
    '-Infinity',
    'infinity',
    '1,2,3',
    '1.2.3',
    '1,2.3',
    '1.234,56', // sem separador de milhar: não se adivinha
    '1,234.56',
    '12abc', // `parseFloat` leria 12; aqui o texto inteiro precisa casar
    'abc12',
    '2,',
    '2.',
    ',',
    '.',
    '-',
    '+',
    '--1',
    '-+1',
    '+-1',
    '1e',
    'e5',
    '1e+',
    '1e5.5',
    '1,5,e3',
    '0x10',
    '0b1',
    '1_000',
    '１２', // algarismos de largura total: nem todo "dígito" Unicode vale
    '٣', // algarismo arábico-índico
    '½',
    '$2',
    '2%',
    '(2)',
    '2;5',
    '2:5',
  ])('%j é erro de formato', (text) => {
    expect(parseWeightInput(text)).toStrictEqual(bad('INVALID_FORMAT'));
  });

  it('um texto bem formado que não cabe no número é recusado como fora da faixa (nunca Infinity nem um zero enganoso)', () => {
    expect(parseWeightInput('1e400')).toStrictEqual(bad('OUT_OF_RANGE'));
    expect(parseWeightInput('-1e400')).toStrictEqual(bad('OUT_OF_RANGE'));
    expect(parseWeightInput('9'.repeat(400))).toStrictEqual(bad('OUT_OF_RANGE'));
    expect(parseWeightInput('1e-400')).toStrictEqual(bad('OUT_OF_RANGE'));
    expect(parseWeightInput(`0,${'0'.repeat(400)}1`)).toStrictEqual(bad('OUT_OF_RANGE'));
    expect(parseWeightInput('-1e-400')).toStrictEqual(bad('OUT_OF_RANGE'));
  });

  it('os extremos finitos ainda valem', () => {
    expect(parseWeightInput('1.7976931348623157e308')).toStrictEqual(ok(Number.MAX_VALUE));
    expect(parseWeightInput('5e-324')).toStrictEqual(ok(Number.MIN_VALUE));
    expect(parseWeightInput('-1.7976931348623157e308')).toStrictEqual(ok(-Number.MAX_VALUE));
  });
});

describe('parseWeightInput: propriedades', () => {
  it('é determinística e devolve sempre um objeto novo (sem alias)', () => {
    const a = parseWeightInput('2,5');
    const b = parseWeightInput('2,5');

    expect(a).toStrictEqual(b);
    expect(a).not.toBe(b);
  });

  it('nunca lança, qualquer que seja o texto (5000 textos aleatórios) e o resultado finito é sempre finito', () => {
    const random = seededRandom(808);
    const alphabet = '0123456789,.-+eE \tabc';
    for (let i = 0; i < 5000; i++) {
      const length = Math.floor(random() * 12);
      let text = '';
      for (let k = 0; k < length; k++) text += alphabet[Math.floor(random() * alphabet.length)];
      const result = parseWeightInput(text);
      if (result.ok && result.weight !== undefined) expect(Number.isFinite(result.weight)).toBe(true);
    }
  });

  it('o texto que o formulário mostra volta a ser lido como o MESMO número (ida e volta, 2000 pesos)', () => {
    const random = seededRandom(909);
    const weights = [0, 1, -1, 2.5, -3.75, 0.1, 1e21, -1e21, 1.5e-7, Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE, 123456789.123];
    for (let i = 0; i < 2000; i++) {
      const scale = 10 ** Math.floor(random() * 40 - 20);
      weights.push((random() - 0.5) * 2 * scale, Math.round((random() - 0.5) * 2000) / 8);
    }
    for (const weight of weights) {
      const result = parseWeightInput(formatWeightForInput(weight));
      expect(result).toStrictEqual(ok(weight === 0 ? 0 : weight));
    }
  });
});

describe('formatWeightForInput e as mensagens', () => {
  it('sem peso, texto vazio; com peso, vírgula decimal (pt-BR); zero aparece como 0', () => {
    expect(formatWeightForInput(undefined)).toBe('');
    expect(formatWeightForInput(0)).toBe('0');
    expect(formatWeightForInput(2.5)).toBe('2,5');
    expect(formatWeightForInput(-3.75)).toBe('-3,75');
    expect(formatWeightForInput(2)).toBe('2');
    expect(formatWeightForInput(1e21)).toBe('1e+21');
  });

  it('mensagens em português, sem código técnico', () => {
    expect(weightInputMessage('INVALID_FORMAT')).toBe('Digite um número, como 2, -3,5 ou 0. Deixe o campo vazio para uma aresta sem peso.');
    expect(weightInputMessage('OUT_OF_RANGE')).toBe('Esse número é grande ou pequeno demais para ser guardado.');
    expect(weightInputMessage('INVALID_FORMAT')).not.toMatch(/INVALID|FORMAT|NaN/);
  });
});
