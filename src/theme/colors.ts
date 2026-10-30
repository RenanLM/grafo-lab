const light = {
  background: '#F7F8FC',
  surface: '#FFFFFF',
  surfaceMuted: '#EEF0F8',
  border: '#D3D7EA',
  text: '#14162B',
  textSecondary: '#50557A',
  primary: '#3B4FD8',
  onPrimary: '#FFFFFF',
  primaryMuted: '#DDE2FF',
} as const;

export type ColorToken = keyof typeof light;
export type ColorScheme = 'light' | 'dark';

const dark: Record<ColorToken, string> = {
  background: '#0E1020',
  surface: '#181B33',
  surfaceMuted: '#22264A',
  border: '#2E3260',
  text: '#F1F2FA',
  textSecondary: '#A9AED3',
  primary: '#8FA0FF',
  onPrimary: '#0E1020',
  primaryMuted: '#262B66',
};

export const colors: Record<ColorScheme, Record<ColorToken, string>> = { light, dark };
