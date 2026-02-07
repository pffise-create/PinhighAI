// Design tokens from UI redesign - exact match

export const colors = {
  // Brand Colors
  brandForest: '#1E3A2A', // primary
  brandFern: '#3C8D5A',
  brandGold: '#C9A654', // accent, use sparingly

  // Surface Colors (cool, clean neutrals)
  surfaceBase: '#F7F8F5', // primary background
  surfaceElevated: '#FFFFFF',
  surfaceMuted: '#EEF0EC', // inputs / alt rows

  // Text Colors
  textPrimary: '#1F2933',
  textSecondary: '#5A6673',
  textInverse: '#FFFFFF',

  // Border Colors
  borderSubtle: '#DADFD8',
  borderStrong: '#C5CCC4',

  // Status Colors
  statusSuccess: '#2E7D32',
  statusWarning: '#D97706',
  statusError: '#C53030',

  // Skeleton / Loading shimmer
  skeletonBase: '#E8EBE6',
  skeletonHighlight: '#F2F4F0',

  // Video overlay
  overlayLight: 'rgba(0, 0, 0, 0.25)',
  overlayMedium: 'rgba(0, 0, 0, 0.5)',

  // Utility
  white: '#FFFFFF',
  black: '#000000',

  // Legacy aliases for compatibility
  primary: '#1E3A2A',
  primaryLight: '#3C8D5A',
  primaryDark: '#15281E',
  coachAccent: '#C9A654',
  coachAccentLight: '#E3C98A',
  coachBackground: '#F7F8F5',
  accent: '#C9A654',
  background: '#F7F8F5',
  backgroundMuted: '#EEF0EC',
  surface: '#FFFFFF',
  text: '#1F2933',
  textLight: '#5A6673',
  success: '#2E7D32',
  warning: '#D97706',
  error: '#C53030',
  border: '#DADFD8',
  borderLight: '#E6EAE4',
  overlayDark: 'rgba(0, 0, 0, 0.35)',
};

export const typography = {
  fontHeading: 'Manrope',
  fontBody: 'Inter',

  // Font Sizes
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,

  // Line Heights
  xsLh: 18,
  smLh: 20,
  baseLh: 24,
  lgLh: 26,
  xlLh: 28,
  '2xlLh': 32,

  // Font Weights
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',

  // Legacy aliases for compatibility
  fontFamily: 'Inter',
  fontFamilyHeading: 'Manrope',
  fontFamilyMono: 'SF Mono',
  fontSizes: {
    xs: 12,
    sm: 14,
    base: 16,
    lg: 18,
    xl: 20,
    '2xl': 24,
    '3xl': 28,
    '4xl': 32,
  },
  fontWeights: {
    light: '300',
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
  lineHeights: {
    tight: 1.25,
    normal: 1.4,
    relaxed: 1.6,
    loose: 1.8,
  },
};

export const spacing = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,

  // Legacy aliases
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  '2xl': 32,
  '3xl': 40,
  '4xl': 48,
  '5xl': 56,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,

  // Legacy aliases
  base: 10,
  '2xl': 24,
  full: 999,
};

export const borderRadius = radius;

export const shadows = {
  xs: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  sm: {
    shadowColor: '#10271E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 3,
  },
  md: {
    shadowColor: '#10271E',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    elevation: 5,
  },
  lg: {
    shadowColor: '#10271E',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 32,
    elevation: 12,
  },
};

export const gradients = {
  primary: ['#3C8D5A', '#1E3A2A'],
  accent: ['#C9A654', '#8E6C1F'],
};

export const overlays = {
  topFade: ['rgba(0,0,0,0.55)', 'rgba(0,0,0,0.25)', 'transparent'],
  bottomFade: ['rgba(0,0,0,0.65)', 'rgba(0,0,0,0.3)', 'transparent'],
};

export const tokens = {
  colors,
  typography,
  spacing,
  borderRadius,
  shadows,
};

export const designTokens = {
  colors,
  spacing,
  radius,
  shadows,
  typography: {
    heading: typography.fontHeading,
    body: typography.fontBody,
    sizes: typography.fontSizes,
    lineHeights: {
      xs: typography.xsLh,
      sm: typography.smLh,
      base: typography.baseLh,
      lg: typography.lgLh,
      xl: typography.xlLh,
      '2xl': typography['2xlLh'],
    },
  },
};
