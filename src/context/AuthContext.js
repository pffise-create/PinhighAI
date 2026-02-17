// Authentication Context for Golf Coach App
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { fetchAuthSession, getCurrentUser, signOut } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';

const AuthContext = createContext({});
const AUTH_REQUIRED_ERROR = 'AUTHENTICATION_REQUIRED';
const LEGACY_AUTH_STORAGE_KEYS = ['userInfo', 'authTokens', 'amplify-signin-tokens'];

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

function decodeJwtPayload(tokenString) {
  try {
    const payloadSegment = tokenString.split('.')[1];
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const decoded =
      typeof atob === 'function'
        ? atob(padded)
        : '';
    if (!decoded) {
      return {};
    }
    return JSON.parse(decoded);
  } catch {
    return {};
  }
}

function parseIdTokenPayload(idToken) {
  if (!idToken) return {};
  if (idToken.payload && typeof idToken.payload === 'object') {
    return idToken.payload;
  }
  return decodeJwtPayload(idToken.toString());
}

function buildUserInfo(currentUser, payload) {
  const userId = currentUser?.userId || payload?.sub;
  const email = payload?.email || currentUser?.signInDetails?.loginId || '';
  const username = currentUser?.username || payload?.['cognito:username'] || email || userId || 'user';

  return {
    id: userId,
    username,
    email,
    name: payload?.name || email || username,
    picture: payload?.picture || null,
  };
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const clearLegacyAuthStorage = useCallback(async () => {
    try {
      await AsyncStorage.multiRemove(LEGACY_AUTH_STORAGE_KEYS);
    } catch (error) {
      console.warn('Failed to clear legacy auth storage:', error);
    }
  }, []);

  const setUnauthenticated = useCallback(async () => {
    setUser(null);
    setIsAuthenticated(false);
    await clearLegacyAuthStorage();
  }, [clearLegacyAuthStorage]);

  const resolveValidSession = useCallback(async (forceRefresh = false) => {
    const session = await fetchAuthSession({ forceRefresh });
    const idToken = session?.tokens?.idToken;

    if (!idToken) {
      throw new Error('No ID token in auth session');
    }

    const payload = parseIdTokenPayload(idToken);
    const expiresAtMs = typeof payload?.exp === 'number' ? payload.exp * 1000 : null;
    const isExpired = expiresAtMs ? expiresAtMs <= Date.now() + 60_000 : false;

    if (isExpired) {
      if (!forceRefresh) {
        return resolveValidSession(true);
      }
      throw new Error('ID token expired');
    }

    return { session, idToken, payload };
  }, []);

  const checkAuthState = useCallback(async () => {
    try {
      setIsLoading(true);

      const currentUser = await getCurrentUser();
      const { payload } = await resolveValidSession(false);
      const userInfo = buildUserInfo(currentUser, payload);

      if (!userInfo.id) {
        throw new Error('Authenticated session missing user id');
      }

      setUser(userInfo);
      setIsAuthenticated(true);
      await clearLegacyAuthStorage();
    } catch (error) {
      console.log('No valid authenticated session found:', error?.message || error);
      await setUnauthenticated();
    } finally {
      setIsLoading(false);
    }
  }, [clearLegacyAuthStorage, resolveValidSession, setUnauthenticated]);

  useEffect(() => {
    checkAuthState();
  }, [checkAuthState]);

  useEffect(() => {
    // Keep session state in sync after redirect auth events.
    const cancelAuthListener = Hub.listen('auth', ({ payload }) => {
      const event = payload?.event;
      if (event === 'signedIn' || event === 'signInWithRedirect' || event === 'tokenRefresh') {
        checkAuthState();
      }
      if (event === 'signedOut' || event === 'tokenRefresh_failure' || event === 'signInWithRedirect_failure') {
        setUnauthenticated();
      }
    });

    const handleURL = (url) => {
      if (url && url.includes('golfcoach://')) {
        // Allow auth redirect handling to complete before reading session.
        setTimeout(() => {
          checkAuthState();
        }, 500);
      }
    };

    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleURL(url);
    });

    Linking.getInitialURL().then((url) => {
      if (url) {
        handleURL(url);
      }
    });

    return () => {
      cancelAuthListener();
      subscription?.remove();
    };
  }, [checkAuthState, setUnauthenticated]);

  const signOutUser = useCallback(async () => {
    try {
      setIsLoading(true);
      await signOut();
    } catch (error) {
      console.warn('Amplify sign out failed:', error);
    } finally {
      await setUnauthenticated();
      setIsLoading(false);
    }
  }, [setUnauthenticated]);

  const refreshUserData = useCallback(async () => {
    await checkAuthState();
  }, [checkAuthState]);

  const getUserId = useCallback(() => {
    if (!isAuthenticated || !user?.id) {
      throw new Error(AUTH_REQUIRED_ERROR);
    }
    return user.id;
  }, [isAuthenticated, user?.id]);

  const getAuthHeaders = useCallback(async () => {
    if (!isAuthenticated) {
      throw new Error(AUTH_REQUIRED_ERROR);
    }

    try {
      const { idToken } = await resolveValidSession(false);
      return {
        Authorization: `Bearer ${idToken.toString()}`,
        'Content-Type': 'application/json',
      };
    } catch (error) {
      console.error('Auth header validation failed:', error);
      await setUnauthenticated();
      throw new Error(AUTH_REQUIRED_ERROR);
    }
  }, [isAuthenticated, resolveValidSession, setUnauthenticated]);

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
