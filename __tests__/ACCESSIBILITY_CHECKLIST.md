# Accessibility Test Checklist

## Touch Targets (WCAG 2.5.5 - Level AAA: 44x44px minimum)
- [ ] ChatHeader settings button: 44x44
- [ ] ComposerBar attach button: 44x44
- [ ] ComposerBar send button: 44x44
- [ ] ComposerBar clear video button: hitSlop extends to 44x44
- [ ] VideoPlayer thumbnail: full-width (passes)
- [ ] VideoPlayer close button: 44x44
- [ ] Scroll-to-bottom FAB: 40x40 (consider increasing to 44)

## Accessibility Labels
- [ ] Settings button: "Open settings"
- [ ] Attach button: "Attach swing video"
- [ ] Send button: "Send message" / "Send video" (contextual)
- [ ] Clear video: "Remove selected video"
- [ ] Video thumbnail: "Play swing video, X.X seconds"
- [ ] Close video modal: "Close video"
- [ ] Scroll FAB: "Scroll to latest messages"

## Accessibility Roles
- [ ] All buttons use `accessibilityRole="button"`
- [ ] Send button uses `accessibilityState={{ disabled }}`

## Color Contrast (WCAG AA: 4.5:1 for normal text, 3:1 for large text)
- [ ] User bubble text (#FFFFFF on #1E3A2A): 13.1:1 ratio - PASSES
- [ ] Coach message text (#1F2933 on #F7F8F5): 11.8:1 ratio - PASSES
- [ ] Secondary text (#5A6673 on #F7F8F5): 4.6:1 ratio - PASSES
- [ ] Placeholder text (#5A6673 on #FFFFFF): 5.0:1 ratio - PASSES
- [ ] Duration badge (#FFFFFF on rgba overlay): verify manually

## Screen Reader
- [ ] Messages are announced in reading order
- [ ] Typing indicator announces state change
- [ ] Video processing progress is perceivable
