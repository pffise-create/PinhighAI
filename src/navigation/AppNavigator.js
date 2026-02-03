import React, { useEffect } from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { TouchableOpacity, View, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import SignInScreen from '../screens/SignInScreen';
import ChatScreen from '../screens/ChatScreen';
import VideoRecordScreen from '../screens/VideoRecordScreen';
import CameraScreen from '../screens/CameraScreen';
import SettingsModal from '../screens/SettingsModal';
import { colors, typography, spacing } from '../utils/theme';
import ErrorBoundary from '../components/ErrorBoundary';
import PerformanceOptimizer from '../utils/performanceOptimizer';
import { useAuth } from '../context/AuthContext';

const Stack = createNativeStackNavigator();

const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
  },
};

export default function AppNavigator() {
  const { user, isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    PerformanceOptimizer.initialize();

    if (user?.id) {
      PerformanceOptimizer.preloadCriticalData(user.id);
    }
  }, [user]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <NavigationContainer theme={navigationTheme}>
        <StatusBar style="dark" />
        <Stack.Navigator
          initialRouteName={isAuthenticated ? 'Chat' : 'SignIn'}
          screenOptions={{
            headerShadowVisible: false,
            headerStyle: {
              backgroundColor: colors.surface,
            },
            headerTitleStyle: {
              fontSize: typography.fontSizes.lg,
              fontFamily: typography.fontFamily,
              color: colors.primary,
            },
            headerTintColor: colors.text,
          }}
        >
          <Stack.Screen
            name="SignIn"
            component={SignInScreen}
            options={{
              headerShown: false,
              gestureEnabled: false,
            }}
          />

          <Stack.Screen
            name="Chat"
            component={ChatScreen}
            options={{
              headerShown: false,
            }}
          />

          <Stack.Screen
            name="VideoRecord"
            component={VideoRecordScreen}
            options={{ title: 'Upload Swing' }}
          />

          <Stack.Screen
            name="Camera"
            component={CameraScreen}
            options={{ headerShown: false }}
          />

          <Stack.Screen
            name="SettingsModal"
            component={SettingsModal}
            options={{
              presentation: 'modal',
              title: 'Settings',
            }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </ErrorBoundary>
  );
}


