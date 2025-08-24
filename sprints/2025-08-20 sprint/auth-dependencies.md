# Authentication Dependencies Installation

## Required Dependencies

Run these commands to install authentication dependencies:

```bash
# Core AWS Amplify dependencies
npx expo install aws-amplify @aws-amplify/react-native

# Google Sign-In (if needed as fallback)
npx expo install expo-auth-session expo-crypto expo-web-browser

# AsyncStorage for token persistence  
npx expo install @react-native-async-storage/async-storage

# Additional UI components
npx expo install expo-constants
```

## Updated package.json Dependencies Section

Your package.json dependencies should include these new packages:

```json
{
  "dependencies": {
    "@react-navigation/native": "^7.1.14",
    "@react-navigation/stack": "^7.4.2",
    "@aws-amplify/react-native": "^1.1.5",
    "@react-native-async-storage/async-storage": "1.23.1",
    "aws-amplify": "^6.0.0",
    "expo": "~53.0.20",
    "expo-auth-session": "~6.0.3",
    "expo-av": "~15.1.7",
    "expo-camera": "~16.1.11",
    "expo-constants": "~17.0.4",
    "expo-crypto": "~14.0.2",
    "expo-file-system": "~18.1.11",
    "expo-image-picker": "~16.1.4",
    "expo-media-library": "~17.1.7",
    "expo-status-bar": "~2.2.3",
    "expo-video": "~2.2.2",
    "expo-web-browser": "~14.0.4",
    "react": "19.0.0",
    "react-native": "0.79.5",
    "react-native-gesture-handler": "~2.24.0",
    "react-native-safe-area-context": "5.4.0",
    "react-native-screens": "~4.11.1"
  }
}
```

## Installation Commands

```bash
# Navigate to your project directory
cd C:\Users\pffis\Documents\ReactNativeProjects\GolfCoachExpoFixed

# Install dependencies
npx expo install aws-amplify @aws-amplify/react-native @react-native-async-storage/async-storage expo-auth-session expo-crypto expo-web-browser expo-constants
```

**Run these installation commands first, then proceed with the authentication implementation.**