// Núcleo puro do editor de grafos (Fase 3): TypeScript sem React, React Native, Expo, JSX, gestos, SVG, animação nem
// Zustand. Calcula; não desenha, não escuta toques e não guarda estado de tela. Os módulos entram um por incremento
// (docs/ROADMAP.md, Fase 3):
//   3.1 câmera (coordenadas de mundo ↔ tela) · 3.2 GraphLayout e posicionamento · 3.3 geometria e hit-testing ·
//   3.4 comandos do editor e histórico.
// Importa apenas o domínio (`@/domain/graph`) e a si mesmo. O ESLint barra o resto e `boundary.test.ts` confere também
// os imports relativos que saiam desta pasta. A interface (`src/features/graph-editor/*.tsx`) e a futura store
// Zustand dependem deste núcleo, nunca o contrário.
export {};
