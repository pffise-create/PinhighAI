import React from 'react';
import { StatusBar } from 'expo-status-bar';
import AppNavigator from './src/navigation/AppNavigator';
import { AuthProvider } from './src/context/AuthContext';
import { configureAmplify } from './src/config/amplifyConfig';

// Configure AWS Amplify before component initialization
configureAmplify();

export default function App() {
  return (
    <AuthProvider>
      <StatusBar style="light" backgroundColor="#2E8B57" />
      <AppNavigator />
    </AuthProvider>
  );
}