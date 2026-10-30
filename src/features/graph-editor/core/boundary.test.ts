import { ESLint } from 'eslint';

import { createGraph } from '@/domain/graph';

// Fronteira de arquitetura do núcleo puro do editor (e do domínio): o que o ESLint barra, o que ele deixa passar e o
// que ele não enxerga (imports relativos que saem da pasta, conferidos aqui). Roda em Node, sem React Native: se o
// ambiente deste projeto Jest carregasse RN, o próprio teste seria enganoso.

declare const __dirname: string; // o Jest (CommonJS) fornece; evita depender dos tipos do Node
type Dirent = { name: string; isDirectory(): boolean };
const fs = jest.requireActual<{
  readdirSync(path: string, options: { withFileTypes: true }): Dirent[];
  readFileSync(path: string, encoding: 'utf8'): string;
}>('node:fs');
const path = jest.requireActual<{
  join(...parts: string[]): string;
  resolve(...parts: string[]): string;
  relative(from: string, to: string): string;
  dirname(path: string): string;
}>('node:path');

const CORE_DIR = __dirname; // <raiz>/src/features/graph-editor/core
const ROOT = path.resolve(CORE_DIR, '../../../..');

// `ESLint` carrega o arquivo de configuração com `import()`, que o Jest (CommonJS) não permite; por isso a
// configuração do projeto é passada pronta, com `require`.
const eslint = new ESLint({
  cwd: ROOT,
  overrideConfigFile: true,
  overrideConfig: jest.requireActual('../../../../eslint.config.js'),
});

/** Ids das regras de fronteira violadas por `code` quando ele está em `relativePath` (a regra depende da pasta). */
async function boundaryViolations(relativePath: string, code: string): Promise<(string | null)[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, relativePath) });
  return result!.messages
    .filter((m) => m.ruleId === 'no-restricted-imports' || m.ruleId === 'no-restricted-syntax' || m.fatal)
    .map((m) => m.ruleId);
}

const CORE_FILE = 'src/features/graph-editor/core/exemplo.ts';
const DOMAIN_FILE = 'src/domain/graph/exemplo.ts';
const UI_FILE = 'src/features/graph-editor/exemplo.tsx';

const FORBIDDEN_IMPORTS = [
  ["import React from 'react';", 'React'],
  ["import { useState } from 'react';", 'hooks do React'],
  ["import { View } from 'react-native';", 'React Native'],
  ["import { Circle } from 'react-native-svg';", 'react-native-svg'],
  ["import { GestureDetector } from 'react-native-gesture-handler';", 'react-native-gesture-handler'],
  ["import Animated from 'react-native-reanimated';", 'react-native-reanimated'],
  ["import { scheduleOnRN } from 'react-native-worklets';", 'react-native-worklets'],
  ["import { create } from 'zustand';", 'Zustand'],
  ["import { create } from 'zustand/vanilla';", 'subcaminho do Zustand'],
  ["import { Stack } from 'expo-router';", 'Expo Router'],
  ["import * as FileSystem from 'expo-file-system';", 'módulo do Expo'],
  ["import Constants from 'expo/config';", 'subcaminho do Expo'],
  ["import { Canvas } from '@shopify/react-native-skia';", 'Skia'],
  ["import { FlashList } from '@shopify/flash-list';", 'pacote da Shopify sem "react" no nome'],
  ["import { Text } from '@/components/text';", 'componentes de interface'],
  ["import { useTheme } from '@/theme';", 'tema'],
  ["import { LabScreen } from '@/features/graph-editor/lab-screen';", 'telas do editor'],
] as const;

describe('núcleo puro do editor (src/features/graph-editor/core)', () => {
  it.each(FORBIDDEN_IMPORTS)('o ESLint barra %s (%s)', async (code) => {
    expect(await boundaryViolations(CORE_FILE, code)).toStrictEqual(['no-restricted-imports']);
  }, 60_000);

  it.each([
    ["import { createGraph } from '@/domain/graph';"],
    ["import type { Graph } from '@/domain/graph';"],
    ["import { x } from './camera';"],
    ["import { z } from '@/features/graph-editor/core';"],
    ["import { w } from '@/features/graph-editor/core/camera';"],
  ])('o ESLint deixa passar %s', async (code) => {
    expect(await boundaryViolations(CORE_FILE, code)).toStrictEqual([]);
  }, 60_000);

  it('o ESLint NÃO enxerga import relativo que sai da pasta (por isso o teste seguinte existe)', async () => {
    expect(await boundaryViolations(CORE_FILE, "import { Tela } from '../lab-screen';")).toStrictEqual([]);
  }, 60_000);

  it('o ESLint barra JSX (elemento e fragmento) e a pasta não tem arquivos .tsx', async () => {
    expect(await boundaryViolations('src/features/graph-editor/core/x.tsx', 'export const a = <div />;')).toStrictEqual([
      'no-restricted-syntax',
    ]);
    expect(await boundaryViolations('src/features/graph-editor/core/x.tsx', 'export const b = <></>;')).toStrictEqual([
      'no-restricted-syntax',
    ]);
    expect(sourceFiles(CORE_DIR).filter((file) => file.endsWith('.tsx'))).toStrictEqual([]);
  }, 60_000);

  it('os imports relativos de cada arquivo da pasta ficam dentro dela (o que o ESLint não enxerga)', () => {
    // Este arquivo é excluído porque cita imports de propósito, dentro de textos de teste.
    const files = sourceFiles(CORE_DIR).filter((file) => !file.endsWith('boundary.test.ts'));

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      for (const specifier of importSpecifiers(fs.readFileSync(file, 'utf8'))) {
        if (!specifier.startsWith('.')) continue;
        const target = path.resolve(path.dirname(file), specifier);
        expect([path.relative(ROOT, file), path.relative(CORE_DIR, target).startsWith('..')]).toStrictEqual([
          path.relative(ROOT, file),
          false,
        ]);
      }
    }
  });

  it('o verificador de imports relativos enxerga o que sai da pasta (controle negativo)', () => {
    const escapes = importSpecifiers("import { Tela } from '../lab-screen';\nimport { a } from './camera';");

    expect(escapes).toStrictEqual(['../lab-screen', './camera']);
    expect(path.relative(CORE_DIR, path.resolve(CORE_DIR, '../lab-screen')).startsWith('..')).toBe(true);
    expect(path.relative(CORE_DIR, path.resolve(CORE_DIR, './camera')).startsWith('..')).toBe(false);
  });

  it('enxerga o domínio pelo alias @/domain/graph, em Node puro', () => {
    expect(createGraph({ id: 'g' }).vertices).toStrictEqual([]);
  });
});

describe('domínio (src/domain): a fronteira continua valendo', () => {
  it.each(FORBIDDEN_IMPORTS)('o ESLint barra %s (%s)', async (code) => {
    expect(await boundaryViolations(DOMAIN_FILE, code)).toStrictEqual(['no-restricted-imports']);
  }, 60_000);

  it('o domínio pode importar a si mesmo, mas não o núcleo do editor nem a interface', async () => {
    expect(await boundaryViolations(DOMAIN_FILE, "import { createGraph } from '@/domain/graph';")).toStrictEqual([]);
    expect(
      await boundaryViolations(DOMAIN_FILE, "import { camera } from '@/features/graph-editor/core';"),
    ).toStrictEqual(['no-restricted-imports']);
  }, 60_000);
});

describe('interface (src/features/graph-editor, fora do núcleo)', () => {
  it('pode usar React Native, SVG, gestos e animação (a restrição vale só nas camadas puras)', async () => {
    const code = [
      "import { View } from 'react-native';",
      "import { Circle } from 'react-native-svg';",
      "import { GestureDetector } from 'react-native-gesture-handler';",
      "import Animated from 'react-native-reanimated';",
      "import { createGraph } from '@/domain/graph';",
      "import { x } from '@/features/graph-editor/core';",
    ].join('\n');

    expect(await boundaryViolations(UI_FILE, code)).toStrictEqual([]);
  }, 60_000);
});

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

/** Textos entre aspas de `import … from '…'`, `export … from '…'` e `import('…')`. */
function importSpecifiers(source: string): string[] {
  const found: string[] = [];
  const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) found.push(match[1]!);
  return found;
}
