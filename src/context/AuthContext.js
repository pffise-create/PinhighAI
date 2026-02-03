// Authentication Context for Golf Coach App
import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { getCurrentUser, signOut, fetchAuthSession } from 'aws-amplify/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';

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
  const refreshInProgressRef = useRef(false);
  const lastRefreshTimeRef = useRef(0);

  // Check authentication status on app start
  useEffect(() => {
    checkAuthState();
  }, []);

  // Handle OAuth redirects from Google Sign-In
  useEffect(() => {
    const handleURL = (url) => {
      console.log('Received OAuth redirect URL:', url);

      // Check if this is an OAuth callback
      if (url && url.includes('golfcoach://')) {
        console.log('Processing OAuth callback...');

        // Give Amplify a moment to process the OAuth response
        setTimeout(() => {
          checkAuthState();
        }, 1000);
      }
    };

    // Listen for URL changes (OAuth redirects)
    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleURL(url);
    });

    // Check initial URL when app starts
    Linking.getInitialURL().then((url) => {
      if (url) {
        handleURL(url);
      }
    });

    // Cleanup
    return () => subscription?.remove();
  }, []);

  const checkAuthState = async () => {
    try {
      setIsLoading(true);
      console.log('Checking authentication state...');

      // First check for manually stored OAuth tokens
      const manualTokens = await AsyncStorage.getItem('amplify-signin-tokens');
      if (manualTokens) {
        try {
          const tokenData = JSON.parse(manualTokens);
          console.log('Found manual OAuth tokens, creating user session...');

          // Create user info from OAuth tokens
          const userInfo = {
            id: 'oauth-user', // Will be updated when we get actual user info
            username: 'oauth-user',
            email: '', // Will be populated from ID token
            name: 'OAuth User',
            picture: null,
            tokens: {
              idToken: tokenData.idToken,
              accessToken: tokenData.accessToken,
              refreshToken: tokenData.refreshToken
            }
          };

          // Try to decode ID token to get user info
          try {
            const idTokenPayload = JSON.parse(atob(tokenData.idToken.split('.')[1]));
            userInfo.id = idTokenPayload.sub || 'oauth-user';
            userInfo.email = idTokenPayload.email || '';
            userInfo.name = idTokenPayload.name || idTokenPayload.email || 'OAuth User';
            userInfo.username = idTokenPayload.preferred_username || idTokenPayload.email || 'oauth-user';
          } catch (decodeError) {
            console.warn('Failed to decode ID token:', decodeError);
          }

          setUser(userInfo);
          setIsAuthenticated(true);

          // Cache user info
          await AsyncStorage.setItem('userInfo', JSON.stringify(userInfo));

          console.log('Authentication state: authenticated via OAuth tokens');
          setIsLoading(false);
          return;
        } catch (tokenError) {
          console.error('Failed to process manual tokens:', tokenError);
          await AsyncStorage.multiRemove(['amplify-signin-tokens', 'userInfo']);
          setUser(null);
          setIsAuthenticated(false);
        }
      }

      // Try Amplify's standard authentication
      try {
        const currentUser = await getCurrentUser();

        if (currentUser) {
          console.log('User found via Amplify:', currentUser.username);

          // Get user attributes and tokens
          const session = await fetchAuthSession();

          const userInfo = {
            id: currentUser.userId,
            username: currentUser.username,
            email: currentUser.signInDetails?.loginId || '',
            name: currentUser.signInDetails?.loginId || currentUser.username,
            picture: null,
            tokens: session.tokens
          };

          setUser(userInfo);
          setIsAuthenticated(true);

          // Cache user info
          await AsyncStorage.setItem('userInfo', JSON.stringify(userInfo));

          console.log('Authentication state: authenticated via Amplify');
          setIsLoading(false);
          return;
        }
      } catch (amplifyError) {
        console.log('Amplify authentication check failed:', amplifyError);
      }

      // Try to load cached user info as fallback
      try {
        const cachedUserInfo = await AsyncStorage.getItem('userInfo');
        if (cachedUserInfo) {
          const userInfo = JSON.parse(cachedUserInfo);
          console.log('Using cached user info');
          setUser(userInfo);
          setIsAuthenticated(true);
          setIsLoading(false);
          return;
        }
      } catch (cacheError) {
        console.log('Cache error:', cacheError);
      }

      // No authentication found
      console.log('No authenticated user found');
      setUser(null);
      setIsAuthenticated(false);

    } catch (error) {
      console.error('Authentication check error:', error);
      setUser(null);
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  };

  const signOutUser = async () => {
    try {
      setIsLoading(true);
      console.log('Signing out user...');

      // Try Amplify sign out
      try {
        await signOut();
      } catch (amplifySignOutError) {
        console.warn('Amplify sign out failed:', amplifySignOutError);
      }

      setUser(null);
      setIsAuthenticated(false);

      // Clear all cached data including manual OAuth tokens
      await AsyncStorage.multiRemove(['userInfo', 'authTokens', 'amplify-signin-tokens']);

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

  const getUserId = () => {
    if (!isAuthenticated || !user?.id) {
      throw new Error('AUTHENTICATION_REQUIRED');
    }
    return user.id;
  };

  const getAuthHeaders = async () => {
    try {
      // Always validate and refresh tokens before API calls
      if (!isAuthenticated || !user?.tokens?.idToken) {
        console.log('No valid authentication - requiring login');
        throw new Error('AUTHENTICATION_REQUIRED');
      }

      // Check if token is expired (check expiration time)
      const idToken = user.tokens.idToken;
      const tokenPayload = JSON.parse(atob(idToken.toString().split('.')[1]));
      const currentTime = Math.floor(Date.now() / 1000);

      // If token expires within 5 minutes, refresh it
      if (tokenPayload.exp && (tokenPayload.exp - currentTime) < 300) {
        // Check if refresh is already in progress
        if (refreshInProgressRef.current) {
          console.log('Refresh already in progress, skipping...');
        } else {
          // Check cooldown period (minimum 60 seconds between refreshes)
          const timeSinceLastRefresh = Date.now() - lastRefreshTimeRef.current;
          if (timeSinceLastRefresh < 60000) {
            console.log('Refresh cooldown active, using current token...');
          } else {
            console.log('Token expiring soon, refreshing...');
            refreshInProgressRef.current = true;
            lastRefreshTimeRef.current = Date.now();

            try {
              await refreshUserData();

              // After refresh, check if we have valid tokens
              if (!user?.tokens?.idToken) {
                throw new Error('AUTHENTICATION_REQUIRED');
              }
            } finally {
              refreshInProgressRef.current = false;
            }
          }
        }
      }

      return {
        'Authorization': `Bearer ${user.tokens.idToken.toString()}`,
        'Content-Type': 'application/json',
      };
    } catch (error) {
      console.error('Auth header validation failed:', error);

      // Don't automatically sign out - just throw the error
      // Let the calling component handle the authentication requirement
      throw new Error('AUTHENTICATION_REQUIRED');
    }
  };

  const value = {
    user,
    isLoading,
    isAuthenticated,
    signOut: signOutUser,
    refreshUserData,
    getAuthHeaders,
    getUserId,
    checkAuthState,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;


