import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  Linking
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, borderRadius, shadows } from '../utils/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function AppSettings({ 
  profile, 
  onUpdateProfile, 
  onClose 
}) {
  const [localProfile, setLocalProfile] = useState(profile);
  const [storageInfo, setStorageInfo] = useState({ used: '0 MB', total: '100 MB' });

  React.useEffect(() => {
    calculateStorageUsage();
  }, []);

  const calculateStorageUsage = async () => {
    try {
      // In a real app, you'd calculate actual storage usage
      // This is a simplified version for demonstration
      const keys = await AsyncStorage.getAllKeys();
      let totalSize = 0;
      
      for (const key of keys) {
        const value = await AsyncStorage.getItem(key);
        if (value) {
          totalSize += value.length;
        }
      }
      
      const sizeInMB = (totalSize / (1024 * 1024)).toFixed(1);
      setStorageInfo({
        used: `${sizeInMB} MB`,
        total: '100 MB' // Estimated total available
      });
    } catch (error) {
      console.error('Failed to calculate storage usage:', error);
    }
  };

  const handleNotificationToggle = (setting, value) => {
    const updatedProfile = {
      ...localProfile,
      notifications: {
        ...localProfile.notifications,
        [setting]: value
      }
    };
    setLocalProfile(updatedProfile);
  };

  const handlePrivacyToggle = (setting, value) => {
    const updatedProfile = {
      ...localProfile,
      privacy: {
        ...localProfile.privacy,
        [setting]: value
      }
    };
    setLocalProfile(updatedProfile);
  };

  const handleSaveSettings = () => {
    onUpdateProfile(localProfile);
  };

  const handleClearCache = () => {
    Alert.alert(
      'Clear Cache',
      'This will clear temporary files and may improve app performance. Your personal data will not be affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear Cache',
          onPress: () => {
            // In a real app, you'd clear actual cache
            Alert.alert('Success', 'Cache cleared successfully!');
            calculateStorageUsage();
          }
        }
      ]
    );
  };

  const handleResetSettings = () => {
    Alert.alert(
      'Reset Settings',
      'This will reset all app settings to their default values. Your goals and coaching data will not be affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            const defaultProfile = {
              ...localProfile,
              notifications: {
                enabled: true,
                practiceReminders: true,
                progressUpdates: true,
                goalDeadlines: true
              },
              privacy: {
                dataSharing: false,
                analytics: true
              }
            };
            setLocalProfile(defaultProfile);
            Alert.alert('Success', 'Settings reset to defaults!');
          }
        }
      ]
    );
  };

  const handleOpenLink = (url) => {
    Linking.openURL(url).catch(err => {
      console.error('Failed to open link:', err);
      Alert.alert('Error', 'Could not open link');
    });
  };

  const renderSettingsSection = (title, children) => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );

  const renderSettingItem = (title, description, rightComponent) => (
    <View style={styles.settingItem}>
      <View style={styles.settingContent}>
        <Text style={styles.settingTitle}>{title}</Text>
        {description && (
          <Text style={styles.settingDescription}>{description}</Text>
        )}
      </View>
      <View style={styles.settingControl}>
        {rightComponent}
      </View>
    </View>
  );

  const renderActionItem = (title, description, icon, onPress, color = colors.primary) => (
    <TouchableOpacity 
      style={styles.actionItem}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={[styles.actionIcon, { backgroundColor: color + '20' }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <View style={styles.actionContent}>
        <Text style={styles.actionTitle}>{title}</Text>
        {description && (
          <Text style={styles.actionDescription}>{description}</Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>App Settings</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Ionicons name="close" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView 
        style={styles.content}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Notifications Section */}
        {renderSettingsSection(
          'Notifications',
          <>
            {renderSettingItem(
              'Enable Notifications',
              'Allow the app to send you notifications',
              <Switch
                value={localProfile.notifications?.enabled || false}
                onValueChange={(value) => handleNotificationToggle('enabled', value)}
                trackColor={{ false: colors.border, true: colors.primary + '40' }}
                thumbColor={colors.primary}
              />
            )}
            
            {renderSettingItem(
              'Practice Reminders',
              'Get reminders to practice your swing',
              <Switch
                value={localProfile.notifications?.practiceReminders || false}
                onValueChange={(value) => handleNotificationToggle('practiceReminders', value)}
                disabled={!localProfile.notifications?.enabled}
                trackColor={{ false: colors.border, true: colors.primary + '40' }}
                thumbColor={colors.primary}
              />
            )}
            
            {renderSettingItem(
              'Progress Updates',
              'Receive updates about your improvement',
              <Switch
                value={localProfile.notifications?.progressUpdates || false}
                onValueChange={(value) => handleNotificationToggle('progressUpdates', value)}
                disabled={!localProfile.notifications?.enabled}
                trackColor={{ false: colors.border, true: colors.primary + '40' }}
                thumbColor={colors.primary}
              />
            )}
            
            {renderSettingItem(
              'Goal Deadlines',
              'Reminders about upcoming goal deadlines',
              <Switch
                value={localProfile.notifications?.goalDeadlines || false}
                onValueChange={(value) => handleNotificationToggle('goalDeadlines', value)}
                disabled={!localProfile.notifications?.enabled}
                trackColor={{ false: colors.border, true: colors.primary + '40' }}
                thumbColor={colors.primary}
              />
            )}
          </>
        )}

        {/* Privacy Section */}
        {renderSettingsSection(
          'Privacy & Data',
          <>
            {renderSettingItem(
              'Anonymous Analytics',
              'Help improve the app by sharing anonymous usage data',
              <Switch
                value={localProfile.privacy?.analytics || false}
                onValueChange={(value) => handlePrivacyToggle('analytics', value)}
                trackColor={{ false: colors.border, true: colors.primary + '40' }}
                thumbColor={colors.primary}
              />
            )}
            
            {renderSettingItem(
              'Data Sharing',
              'Allow sharing coaching insights with partners',
              <Switch
                value={localProfile.privacy?.dataSharing || false}
                onValueChange={(value) => handlePrivacyToggle('dataSharing', value)}
                trackColor={{ false: colors.border, true: colors.primary + '40' }}
                thumbColor={colors.primary}
              />
            )}
          </>
        )}

        {/* Storage Section */}
        {renderSettingsSection(
          'Storage & Performance',
          <>
            <View style={styles.storageInfo}>
              <Text style={styles.storageTitle}>Storage Usage</Text>
              <Text style={styles.storageDetails}>
                {storageInfo.used} of {storageInfo.total} used
              </Text>
              <View style={styles.storageBar}>
                <View 
                  style={[
                    styles.storageBarFill,
                    { width: '25%' } // This would be calculated based on actual usage
                  ]}
                />
              </View>
            </View>
            
            {renderActionItem(
              'Clear Cache',
              'Free up space by clearing temporary files',
              'trash-outline',
              handleClearCache,
              colors.warning
            )}
          </>
        )}

        {/* App Actions Section */}
        {renderSettingsSection(
          'App Management',
          <>
            {renderActionItem(
              'Reset Settings',
              'Reset all settings to default values',
              'refresh-outline',
              handleResetSettings,
              colors.warning
            )}
            
            {renderActionItem(
              'Rate the App',
              'Leave a review on the App Store',
              'star-outline',
              () => Alert.alert('Thanks!', 'App Store rating would open here'),
              colors.accent
            )}
            
            {renderActionItem(
              'Send Feedback',
              'Help us improve by sharing your thoughts',
              'chatbubble-outline',
              () => Alert.alert('Feedback', 'Feedback form would open here'),
              colors.primary
            )}
          </>
        )}

        {/* Legal Section */}
        {renderSettingsSection(
          'Legal & Support',
          <>
            {renderActionItem(
              'Privacy Policy',
              'Read our privacy policy',
              'shield-outline',
              () => Alert.alert('Privacy Policy', 'Privacy policy would be displayed here')
            )}
            
            {renderActionItem(
              'Terms of Service',
              'Read our terms of service',
              'document-outline',
              () => Alert.alert('Terms of Service', 'Terms would be displayed here')
            )}
            
            {renderActionItem(
              'Help & Support',
              'Get help using the app',
              'help-circle-outline',
              () => Alert.alert('Help', 'Help documentation would open here')
            )}
          </>
        )}

        {/* App Information */}
        <View style={styles.appInfo}>
          <Text style={styles.appName}>Pin High Golf Coach</Text>
          <Text style={styles.appVersion}>Version 1.0.0 (Build 1)</Text>
          <Text style={styles.appCopyright}>© 2025 Pin High. All rights reserved.</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity 
          style={styles.saveButton}
          onPress={handleSaveSettings}
          activeOpacity={0.8}
        >
          <Text style={styles.saveButtonText}>Save Settings</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  title: {
    fontSize: typography.fontSizes.xl,
    fontWeight: typography.fontWeights.bold,
    color: colors.primary,
    fontFamily: typography.fontFamily,
  },
  closeButton: {
    padding: spacing.xs,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  section: {
    backgroundColor: colors.surface,
    marginBottom: spacing.base,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  sectionTitle: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.semibold,
    color: colors.text,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.base,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  settingContent: {
    flex: 1,
  },
  settingTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.medium,
    color: colors.text,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.xs,
  },
  settingDescription: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    lineHeight: 18,
  },
  settingControl: {
    marginLeft: spacing.base,
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.base,
  },
  actionContent: {
    flex: 1,
  },
  actionTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.medium,
    color: colors.text,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.xs,
  },
  actionDescription: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
  },
  storageInfo: {
    paddingVertical: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  storageTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.medium,
    color: colors.text,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.xs,
  },
  storageDetails: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.sm,
  },
  storageBar: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  storageBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 3,
  },
  appInfo: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    backgroundColor: colors.surface,
  },
  appName: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.bold,
    color: colors.primary,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.xs,
  },
  appVersion: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.xs,
  },
  appCopyright: {
    fontSize: typography.fontSizes.xs,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
  },
  footer: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.base,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  saveButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.base,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    ...shadows.sm,
  },
  saveButtonText: {
    fontSize: typography.fontSizes.base,
    color: colors.surface,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeights.semibold,
  },
});