import React from 'react';
import { View, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AppNavigator from './src/navigation/AppNavigator';
import { AuthProvider } from './src/context/AuthContext';
import { configureAmplify } from './src/config/amplifyConfig';

// Configure AWS Amplify before component initialization
try {
  configureAmplify();
  console.log('Amplify configured successfully');
} catch (error) {
  console.error('Amplify configuration failed:', error);
}

export default function App() {
  try {
    return (
      <AuthProvider>
        <StatusBar style="light" backgroundColor="#2E8B57" />
        <AppNavigator />
      </AuthProvider>
    );
  } catch (error) {
    console.error('App component error:', error);
    // Return a simple fallback component
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' }}>
        <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 10 }}>App Loading Error</Text>
        <Text>Please check the console for details.</Text>
      </View>
    );
  }
}