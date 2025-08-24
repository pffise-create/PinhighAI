export const colors = {
// Primary golf course colors (from transformation guide)
primary: '#1B4332',        // Deep forest green (maintains existing brand)
primaryLight: '#43A047',   // Lighter golf green (from successful apps)
// Coaching presence (Option 3 - subtle purple accent)
coachAccent: '#805AD5',    // Purple for coaching presence
coachAccentLight: '#9F7AEA',
coachBackground: '#FEFCFF', // Extremely subtle purple tint for coach cards
// High-contrast backgrounds for outdoor readability
background: '#FAFAFA',     // Soft neutral background
surface: '#FFFFFF',        // Pure white for cards and messages
// Optimized text contrast for sunlight visibility
text: '#2D3748',          // Dark charcoal (not harsh black)
textSecondary: '#4A5568',  // Medium gray for secondary text
textLight: '#718096',      // Light gray for timestamps/metadata
// Functional colors
success: '#047857',        // Dark green for achievements
warning: '#D97706',        // Orange for attention items
error: '#DC2626',          // Red for errors
accent: '#1E88E5',         // Professional blue (from successful apps)
// Refined borders and dividers
border: '#E2E8F0',         // Light gray borders
borderLight: '#F1F5F9',    // Very light dividers
};
export const typography = {
// Inter font family (excellent mobile readability)
fontFamily: 'Inter',
fontFamilyMono: 'SF Mono',
// Optimal font sizes for golf demographic (43.5 avg age)
fontSizes: {
xs: 12,    // Small metadata, timestamps
sm: 14,    // Secondary text, labels
base: 16,  // CORRECTED: Perfect mobile reading size
lg: 18,    // Emphasis text, titles
xl: 20,    // Section headers
'2xl': 24, // Screen titles
'3xl': 28, // Hero text, scores
'4xl': 32, // Display text
},
// Balanced font weights for readability
fontWeights: {
light: '300',
normal: '400',    // Standard weight for body text
medium: '500',    // Subtle emphasis
semibold: '600',  // Section headers
bold: '700',      // Titles and important info
},
// Line heights optimized for mobile reading
lineHeights: {
tight: 1.25,
normal: 1.4,      // Good for body text
relaxed: 1.6,     // Comfortable for longer text
loose: 1.8,
},
};
// Professional spacing system (4dp/8dp grid)
export const spacing = {
xs: 4,
sm: 8,
base: 16,
lg: 20,
xl: 24,
'2xl': 32,
'3xl': 40,     // Generous spacing for touch targets
};
// Rounded corners for modern feel
export const borderRadius = {
sm: 6,
base: 8,
lg: 12,
xl: 16,
'2xl': 20,      // Card containers
full: 999,
};
// Subtle shadows for depth without distraction
export const shadows = {
sm: {
shadowColor: '#000',
shadowOffset: { width: 0, height: 1 },
shadowOpacity: 0.05,      // Very subtle
shadowRadius: 2,
elevation: 1,
},
base: {
shadowColor: '#000',
shadowOffset: { width: 0, height: 2 },
shadowOpacity: 0.08,      // Gentle elevation
shadowRadius: 4,
elevation: 2,
},
lg: {
shadowColor: '#000',
shadowOffset: { width: 0, height: 4 },
shadowOpacity: 0.12,
shadowRadius: 8,
elevation: 4,
},
};
// Coaching-specific component styles
export const coaching = {
// Clean coaching message with subtle left border
coachingMessage: {
backgroundColor: colors.surface,
borderLeftWidth: 3,        // Subtle coaching presence indicator
borderLeftColor: colors.coachAccent,
borderRadius: borderRadius.lg,
padding: spacing.base,
marginBottom: spacing.base,
...shadows.sm,
},
// User message with brand color
userMessage: {
backgroundColor: colors.primary,
borderRadius: borderRadius.lg,
padding: spacing.base,
marginBottom: spacing.base,
alignSelf: 'flex-end',
maxWidth: '88%',
...shadows.sm,
},
// Content cards
contentCard: {
backgroundColor: colors.surface,
borderRadius: borderRadius.lg,
padding: spacing.lg,
marginBottom: spacing.base,
...shadows.base,
},
};
// Global component styles following Option 3 design
export const globalStyles = {
// Clean screen headers
screenHeader: {
paddingHorizontal: spacing.lg,
paddingVertical: spacing.base,
backgroundColor: colors.surface,
borderBottomWidth: 1,
borderBottomColor: colors.border,
},
screenTitle: {
fontSize: typography.fontSizes['2xl'], // 24px
fontWeight: typography.fontWeights.bold,
color: colors.primary,
fontFamily: typography.fontFamily,
},
screenSubtitle: {
fontSize: typography.fontSizes.base, // 16px
color: colors.textSecondary,
fontFamily: typography.fontFamily,
marginTop: spacing.xs,
},
// Primary action buttons
primaryButton: {
backgroundColor: colors.coachAccent,
borderRadius: borderRadius.lg,
paddingVertical: spacing.base,
paddingHorizontal: spacing.xl,
alignItems: 'center',
justifyContent: 'center',
...shadows.sm,
},
primaryButtonText: {
fontSize: typography.fontSizes.base,
fontWeight: typography.fontWeights.semibold,
color: colors.surface,
fontFamily: typography.fontFamily,
},
// Secondary buttons
secondaryButton: {
backgroundColor: colors.background,
borderWidth: 1,
borderColor: colors.border,
borderRadius: borderRadius.lg,
paddingVertical: spacing.base,
paddingHorizontal: spacing.xl,
alignItems: 'center',
justifyContent: 'center',
},
secondaryButtonText: {
fontSize: typography.fontSizes.base,
fontWeight: typography.fontWeights.medium,
color: colors.text,
fontFamily: typography.fontFamily,
},
// Clean text inputs
textInput: {
borderWidth: 1,
borderColor: colors.border,
borderRadius: borderRadius.full,      // Rounded pill shape
paddingHorizontal: spacing.base,
paddingVertical: spacing.sm,
fontSize: typography.fontSizes.base,
fontFamily: typography.fontFamily,
color: colors.text,
backgroundColor: colors.surface,
},
// Coaching presence indicator (subtle purple dot)
coachingIndicator: {
width: 8,
height: 8,
borderRadius: 4,
backgroundColor: colors.coachAccent,
marginRight: spacing.sm,
},
};
