# Revert Instructions

These files are pre-revamp backups created before the ChatScreen UI overhaul.

## To revert:
```bash
cp src/screens/_archive/ChatScreen.pre-revamp.js src/screens/ChatScreen.js
cp src/screens/_archive/SignInScreen.pre-revamp.js src/screens/SignInScreen.js
cp src/services/_archive/chatApiService.pre-revamp.js src/services/chatApiService.js
cp src/services/_archive/videoService.pre-revamp.js src/services/videoService.js
```

## What changed:
- ChatScreen.js: Full UI rewrite with extracted components
- SignInScreen.js: Guest access removed
- chatApiService.js: Simplified (no retry/fallback/guest logic)
- videoService.js: Trim params removed, progress messages enhanced
