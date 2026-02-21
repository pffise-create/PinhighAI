# ChatScreen UI Fixes Implementation Plan

**Overall Progress:** `100%` ✅

## TLDR
Fix design system inconsistencies, accessibility issues, and component duplication in the ChatScreen based on UI design review findings.

## Critical Decisions
- **Accent color replacement**: Replace purple accents (#805AD5, #E9D8FD) with brand gold (`colors.coachAccentLight`) and green (`colors.primaryLight`) to maintain golf brand cohesion
- **Component consolidation**: Keep inline `renderMessage` in ChatScreen.js, remove unused ChatHeader.js/ChatMessage.js/ChatBubble.js to avoid confusion
- **Touch target approach**: Increase button sizes rather than adding invisible hit areas for cleaner implementation

## Tasks:

- [x] 🟩 **Step 1: Replace Hardcoded Colors with Theme Tokens**
  - [x] 🟩 Update container background `#F7FAFC` → `colors.background`
  - [x] 🟩 Update header colors (`#1B4332`, `#4A5568`, `#E6FFFA`) → theme tokens
  - [x] 🟩 Update message card colors → `colors.primary`, `colors.surface`
  - [x] 🟩 Update input area colors (`#EDF2F7`, `#8F9BA8`) → theme tokens
  - [x] 🟩 Update timestamp/typing indicator colors → `colors.textLight`

- [x] 🟩 **Step 2: Fix Brand Color Consistency (Purple → Gold/Green)**
  - [x] 🟩 Change composerButton background `#E9D8FD` → `colors.coachAccentLight`
  - [x] 🟩 Change sendButtonActive `#805AD5` → `colors.primaryLight`
  - [x] 🟩 Update composerButton icon color to `colors.primary`

- [x] 🟩 **Step 3: Add Accessibility Labels**
  - [x] 🟩 Add `accessibilityLabel` to header camera button
  - [x] 🟩 Add `accessibilityLabel` to header settings button
  - [x] 🟩 Add `accessibilityLabel` to attachment button
  - [x] 🟩 Add `accessibilityLabel` to send button
  - [x] 🟩 Add `accessibilityLabel` to scroll-to-bottom button
  - [x] 🟩 Add `accessibilityLabel` to video clear button

- [x] 🟩 **Step 4: Fix Touch Target Sizes**
  - [x] 🟩 Increase headerButton from 36x36 to 44x44
  - [x] 🟩 Increase composerButton from 40x40 to 44x44
  - [x] 🟩 Increase scrollToBottomButton from 40x40 to 44x44
  - [x] 🟩 Adjust borderRadius values accordingly (22)

- [x] 🟩 **Step 5: Standardize Spacing and Radius Values**
  - [x] 🟩 Replace magic number paddings with `spacing.*` tokens
  - [x] 🟩 Standardize border radius values using `borderRadius.*` tokens
  - [x] 🟩 Replace inline shadow definitions with `shadows.*` tokens

- [x] 🟩 **Step 6: Clean Up Unused Components**
  - [x] 🟩 Deleted unused `ChatHeader.js`
  - [x] 🟩 Deleted unused `ChatMessage.js`
  - [x] 🟩 Deleted unused `ChatBubble.js`
