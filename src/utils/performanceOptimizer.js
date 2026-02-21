import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { InteractionManager } from 'react-native';

export class PerformanceOptimizer {
  static memoryWarningThreshold = 0.8; // 80% memory usage
  static cacheExpiryDays = 7;
  static maxCacheSize = 50 * 1024 * 1024; // 50MB
  
  // Memory Management
  static cleanupOldData = async () => {
    try {
      console.log('Starting performance cleanup...');
      
      // Clean up old cached images and videos
      await this.cleanupImageCache();
      
      // Compress old chat messages
      await this.compressOldMessages();
      
      // Remove expired cached data
      await this.removeExpiredCache();
      
      console.log('Performance cleanup completed');
    } catch (error) {
      console.error('Performance cleanup failed:', error);
    }
  };

  static cleanupImageCache = async () => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const imageKeys = keys.filter(key => key.startsWith('cached_image_'));
      
      // Sort by timestamp and remove oldest if cache is too large
      const imageData = await Promise.all(
        imageKeys.map(async key => {
          try {
            const data = await AsyncStorage.getItem(key);
            const parsed = JSON.parse(data || '{}');
            return {
              key,
              timestamp: parsed.timestamp || 0,
              size: (data?.length || 0)
            };
          } catch {
            return { key, timestamp: 0, size: 0 };
          }
        })
      );

      // Calculate total cache size
      const totalSize = imageData.reduce((sum, item) => sum + item.size, 0);
      
      if (totalSize > this.maxCacheSize) {
        // Sort by timestamp (oldest first) and remove until under threshold
        const sortedData = imageData.sort((a, b) => a.timestamp - b.timestamp);
        let currentSize = totalSize;
        const keysToRemove = [];
        
        for (const item of sortedData) {
          if (currentSize <= this.maxCacheSize * 0.8) break; // Leave 20% buffer
          keysToRemove.push(item.key);
          currentSize -= item.size;
        }
        
        if (keysToRemove.length > 0) {
          await AsyncStorage.multiRemove(keysToRemove);
          console.log(`Removed ${keysToRemove.length} cached images`);
        }
      }
    } catch (error) {
      console.error('Failed to cleanup image cache:', error);
    }
  };

  static compressOldMessages = async () => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const chatKeys = keys.filter(key => key.startsWith('chat_history_'));
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.cacheExpiryDays);
      
      for (const key of chatKeys) {
        const data = await AsyncStorage.getItem(key);
        if (!data) continue;
        
        try {
          const conversation = JSON.parse(data);
          let hasChanges = false;
          
          // Compress old messages (keep essential info only)
          conversation.messages = conversation.messages.map(message => {
            const messageDate = new Date(message.timestamp);
            if (messageDate < cutoffDate && !message.compressed) {
              hasChanges = true;
              return {
                id: message.id,
                sender: message.sender,
                timestamp: message.timestamp,
                messageType: message.messageType,
                text: message.text?.substring(0, 100) + (message.text?.length > 100 ? '...' : ''),
                compressed: true
              };
            }
            return message;
          });
          
          if (hasChanges) {
            await AsyncStorage.setItem(key, JSON.stringify(conversation));
          }
        } catch (parseError) {
          console.error('Failed to parse conversation:', parseError);
        }
      }
    } catch (error) {
      console.error('Failed to compress old messages:', error);
    }
  };

  static removeExpiredCache = async () => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const cacheKeys = keys.filter(key => 
        key.startsWith('cache_') || 
        key.startsWith('temp_') ||
        key.includes('_cached')
      );
      
      const expiredKeys = [];
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.cacheExpiryDays);
      
      for (const key of cacheKeys) {
        try {
          const data = await AsyncStorage.getItem(key);
          if (data) {
            const parsed = JSON.parse(data);
            const cacheDate = new Date(parsed.cachedAt || parsed.timestamp || 0);
            
            if (cacheDate < cutoffDate) {
              expiredKeys.push(key);
            }
          }
        } catch {
          // If we can't parse it, consider it expired
          expiredKeys.push(key);
        }
      }
      
      if (expiredKeys.length > 0) {
        await AsyncStorage.multiRemove(expiredKeys);
        console.log(`Removed ${expiredKeys.length} expired cache entries`);
      }
    } catch (error) {
      console.error('Failed to remove expired cache:', error);
    }
  };

  // Loading Optimizations
  static deferHeavyOperations = (operation, delay = 100) => {
    return new Promise(resolve => {
      InteractionManager.runAfterInteractions(() => {
        setTimeout(async () => {
          try {
            const result = await operation();
            resolve(result);
          } catch (error) {
            console.error('Deferred operation failed:', error);
            resolve(null);
          }
        }, delay);
      });
    });
  };

  static preloadCriticalData = async (userId) => {
    try {
      // Preload user profile and recent chat in background
      const criticalDataPromises = [
        this.preloadUserProfile(userId),
        this.preloadRecentChat(userId),
        this.preloadVideoThumbnails(userId)
      ];
      
      // Don't wait for all - let them load in background
      Promise.all(criticalDataPromises).catch(error => {
        console.error('Background preload failed:', error);
      });
      
      console.log('Started background data preload');
    } catch (error) {
      console.error('Failed to start preload:', error);
    }
  };

  static preloadUserProfile = async (userId) => {
    try {
      const profileKey = `user_profile_${userId}`;
      const cached = await AsyncStorage.getItem(`${profileKey}_cached`);
      
      if (!cached) {
        // Cache the profile for faster subsequent loads
        const profile = await AsyncStorage.getItem(profileKey);
        if (profile) {
          await AsyncStorage.setItem(`${profileKey}_cached`, JSON.stringify({
            data: profile,
            cachedAt: new Date().toISOString()
          }));
        }
      }
    } catch (error) {
      console.error('Failed to preload user profile:', error);
    }
  };

  static preloadRecentChat = async (userId) => {
    try {
      const chatKey = `chat_history_${userId}`;
      const data = await AsyncStorage.getItem(chatKey);
      
      if (data) {
        const conversation = JSON.parse(data);
        const recentMessages = conversation.messages.slice(-10); // Last 10 messages
        
        // Cache recent messages for instant loading
        await AsyncStorage.setItem(`${chatKey}_recent`, JSON.stringify({
          messages: recentMessages,
          cachedAt: new Date().toISOString()
        }));
      }
    } catch (error) {
      console.error('Failed to preload recent chat:', error);
    }
  };

  static preloadVideoThumbnails = async (userId) => {
    try {
      const vaultKey = `video_vault_${userId}`;
      const vaultData = await AsyncStorage.getItem(vaultKey);
      
      if (vaultData) {
        const vault = JSON.parse(vaultData);
        const recentVideos = vault.videos?.slice(0, 5) || []; // First 5 videos
        
        // In a real app, you'd preload actual thumbnails here
        // For now, just mark them as priority for loading
        for (const video of recentVideos) {
          await AsyncStorage.setItem(`thumbnail_priority_${video.videoId}`, 'true');
        }
      }
    } catch (error) {
      console.error('Failed to preload video thumbnails:', error);
    }
  };

  // Animation Optimization
  static createOptimizedAnimationConfig = (duration = 300) => ({
    duration,
    useNativeDriver: true,
    isInteraction: false // Don't block interactions
  });

  static scheduleIdleCallback = (callback) => {
    // Schedule callback to run when the main thread is idle
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(callback);
    } else {
      setTimeout(callback, 16); // Fallback to next frame
    }
  };

  // Memory Monitoring
  static monitorMemoryUsage = () => {
    if (__DEV__) {
      setInterval(() => {
        // Only available in browsers
        if (typeof performance !== 'undefined' && performance.memory) {
          const memoryUsage = performance.memory;
          const usedRatio = memoryUsage.usedJSHeapSize / memoryUsage.jsHeapSizeLimit;
          
          if (usedRatio > this.memoryWarningThreshold) {
            console.warn(`Memory usage high: ${(usedRatio * 100).toFixed(1)}%`);
            this.cleanupOldData();
          }
        }
      }, 30000); // Check every 30 seconds
    }
  };

  // Network Optimization
  static createRequestQueue = () => {
    const queue = [];
    let processing = false;

    const processQueue = async () => {
      if (processing || queue.length === 0) return;
      
      processing = true;
      
      while (queue.length > 0) {
        const request = queue.shift();
        try {
          const result = await request.execute();
          request.resolve(result);
        } catch (error) {
          request.reject(error);
        }
        
        // Small delay between requests to prevent overwhelming
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      
      processing = false;
    };

    return {
      add: (execute) => {
        return new Promise((resolve, reject) => {
          queue.push({ execute, resolve, reject });
          processQueue();
        });
      }
    };
  };

  // Bundle Size Optimization
  static lazyLoadComponent = (importFunction) => {
    return React.lazy(() => {
      return importFunction().catch(error => {
        console.error('Failed to lazy load component:', error);
        // Return a fallback component for React Native
        return { default: () => React.createElement('Text', {}, 'Loading...') };
      });
    });
  };

  // Storage Optimization
  static getStorageInfo = async () => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      let totalSize = 0;
      const categories = {
        chat: 0,
        videos: 0,
        profile: 0,
        cache: 0,
        other: 0
      };
      
      for (const key of keys) {
        try {
          const value = await AsyncStorage.getItem(key);
          const size = value?.length || 0;
          totalSize += size;
          
          if (key.includes('chat_history')) categories.chat += size;
          else if (key.includes('video_vault') || key.includes('video_metadata')) categories.videos += size;
          else if (key.includes('user_profile')) categories.profile += size;
          else if (key.includes('cache') || key.includes('cached')) categories.cache += size;
          else categories.other += size;
        } catch (error) {
          console.error(`Failed to get size for key ${key}:`, error);
        }
      }
      
      return {
        totalSize,
        totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
        categories,
        keyCount: keys.length
      };
    } catch (error) {
      console.error('Failed to get storage info:', error);
      return {
        totalSize: 0,
        totalSizeMB: '0.00',
        categories: {},
        keyCount: 0
      };
    }
  };

  // Initialize performance monitoring
  static initialize = () => {
    console.log('Initializing performance optimizer...');
    
    // Start memory monitoring in development
    this.monitorMemoryUsage();
    
    // Schedule periodic cleanup
    setInterval(() => {
      this.cleanupOldData();
    }, 24 * 60 * 60 * 1000); // Daily cleanup
    
    console.log('Performance optimizer initialized');
  };
}

export default PerformanceOptimizer;