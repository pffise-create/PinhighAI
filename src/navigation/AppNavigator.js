// AppNavigator.js - Bottom tab navigation with authentication
import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

// Import screens
import ChatScreen from '../screens/ChatScreen';
import CoachingSummaryScreen from '../screens/CoachingSummaryScreen';
import VideosScreen from '../screens/VideosScreen';
import ProfileScreen from '../screens/ProfileScreen';
import SignInScreen from '../screens/SignInScreen';
import CameraScreen from '../screens/CameraScreen';

// Import theme and utilities
import { colors, typography, spacing } from '../utils/theme';
import { View } from 'react-native';
import ErrorBoundary from '../components/ErrorBoundary';
import PerformanceOptimizer from '../utils/performanceOptimizer';
import { useAuth } from '../context/AuthContext';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

// Enhanced Tab Navigator with coaching presence indicators
function MainTabs() {
  return (
    <Tab.Navigator
      initialRouteName="Chat"
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;
          let iconSize = focused ? 28 : 24; // Larger icons when focused
          
          if (route.name === 'Chat') {
            iconName = 'chatbubble';
          } else if (route.name === 'Summary') {
            iconName = 'bar-chart';
          } else if (route.name === 'Videos') {
            iconName = 'videocam';
          } else if (route.name === 'Profile') {
            iconName = 'person';
          }
          
          return (
            <View style={{ alignItems: 'center' }}>
              <Ionicons name={iconName} size={iconSize} color={color} />
              {focused && route.name === 'Chat' && (
                <View style={{
                  width: 4,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: colors.coachAccent,
                  marginTop: 2,
                }} />
              )}
            </View>
          );
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textLight,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopWidth: 2,
          borderTopColor: colors.border,
          height: 88, // Increased height for better accessibility
          paddingBottom: spacing.sm,
          paddingTop: spacing.sm,
        },
        tabBarLabelStyle: {
          fontSize: typography.fontSizes.xs,
          fontWeight: typography.fontWeights.semibold,
          fontFamily: typography.fontFamily,
        },
        tabBarIconStyle: {
          marginBottom: 4,
        },
        headerShown: false, // Individual screens handle their own headers
      })}
    >
      <Tab.Screen 
        name="Chat" 
        component={ChatScreen}
        options={{
          headerShown: false,
          tabBarLabel: 'Coaching Chat',
        }}
      />
      <Tab.Screen 
        name="Summary" 
        component={CoachingSummaryScreen}
        options={{
          tabBarLabel: 'Insights',
        }}
      />
      <Tab.Screen 
        name="Videos" 
        component={VideosScreen}
        options={{
          tabBarLabel: 'Videos',
        }}
      />
      <Tab.Screen 
        name="Profile" 
        component={ProfileScreen}
        options={{
          tabBarLabel: 'Profile',
        }}
      />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const { user } = useAuth();

  useEffect(() => {
    // Initialize performance optimizations
    PerformanceOptimizer.initialize();
    
    // Preload critical data if user is authenticated
    if (user?.email) {
      PerformanceOptimizer.preloadCriticalData(user.email);
    }
  }, [user]);

  return (
    <ErrorBoundary>
      <NavigationContainer>
        <StatusBar style="auto" />
        <Stack.Navigator
          initialRouteName="SignIn"
          screenOptions={{
            headerShown: false,
          }}
        >
        <Stack.Screen 
          name="SignIn" 
          component={SignInScreen}
        />
        <Stack.Screen 
          name="Main" 
          component={MainTabs}
        />
        <Stack.Screen 
          name="Camera" 
          component={CameraScreen}
          options={{
            presentation: 'modal', // Camera as modal overlay
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
    </ErrorBoundary>
  );
}

// Navigation Flow:
// 1. SignIn → Main (4-tab interface)
// 2. Primary interface: Chat tab with integrated video upload
// 3. Camera as modal overlay for video recording
// 4. Summary, Videos, Profile tabs for reference and settings