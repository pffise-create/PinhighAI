// Authentication Context for Golf Coach App
import React, { createContext, useContext, useState, useEffect } from 'react';
import { getCurrentUser, signOut, fetchAuthSession } from 'aws-amplify/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

const AuthContext = createContext({});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Check authentication status on app start
  useEffect(() => {
    checkAuthState();
  }, []);

  const checkAuthState = async () => {
    try {
      setIsLoading(true);
      console.log('Checking authentication state...');
      
      // Try to get current user
      const currentUser = await getCurrentUser();
      
      if (currentUser) {
        console.log('User found:', currentUser.username);
        
        // Get user attributes and tokens
        const session = await fetchAuthSession();
        
        const userInfo = {
          id: currentUser.userId,
          username: currentUser.username,
          email: currentUser.signInDetails?.loginId || '',
          name: currentUser.signInDetails?.loginId || currentUser.username,
          picture: null, // Will be populated from user attributes if available
          tokens: session.tokens
        };
        
        setUser(userInfo);
        setIsAuthenticated(true);
        
        // Cache user info
        await AsyncStorage.setItem('userInfo', JSON.stringify(userInfo));
        
        console.log('Authentication state: authenticated');
      } else {
        console.log('No authenticated user found');
        setUser(null);
        setIsAuthenticated(false);
        await AsyncStorage.removeItem('userInfo');
      }
    } catch (error) {
      console.log('Authentication check error:', error);
      
      // Try to load cached user info as fallback
      try {
        const cachedUserInfo = await AsyncStorage.getItem('userInfo');
        if (cachedUserInfo) {
          const userInfo = JSON.parse(cachedUserInfo);
          console.log('Using cached user info');
          setUser(userInfo);
          setIsAuthenticated(true);
        } else {
          setUser(null);
          setIsAuthenticated(false);
        }
      } catch (cacheError) {
        console.log('Cache error:', cacheError);
        setUser(null);
        setIsAuthenticated(false);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const signOutUser = async () => {
    try {
      setIsLoading(true);
      console.log('Signing out user...');
      
      await signOut();
      setUser(null);
      setIsAuthenticated(false);
      
      // Clear cached data
      await AsyncStorage.multiRemove(['userInfo', 'authTokens']);
      
      console.log('User signed out successfully');
    } catch (error) {
      console.error('Error signing out:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const refreshUserData = async () => {
    if (isAuthenticated) {
      await checkAuthState();
    }
  };

  const getAuthHeaders = () => {
    if (user?.tokens?.idToken) {
      return {
        'Authorization': `Bearer ${user.tokens.idToken.toString()}`,
        'Content-Type': 'application/json',
      };
    }
    return {
      'Content-Type': 'application/json',
    };
  };

  const value = {
    user,
    isLoading,
    isAuthenticated,
    signOut: signOutUser,
    refreshUserData,
    getAuthHeaders,
    checkAuthState,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;