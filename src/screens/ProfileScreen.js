import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Switch,
  Modal
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, borderRadius, shadows } from '../utils/theme';
import { useAuth } from '../context/AuthContext';
import UserProfileManager from '../services/userProfileManager';
import GoalsManager from '../components/GoalsManager';
import CoachingPreferences from '../components/CoachingPreferences';
import AppSettings from '../components/AppSettings';

const ProfileScreen = ({ navigation }) => {
  const { user, isAuthenticated, signOut } = useAuth();
  const [loading, setLoading] = useState(true);
  const [userProfile, setUserProfile] = useState(null);
  const [userGoals, setUserGoals] = useState(null);
  const [coachingPrefs, setCoachingPrefs] = useState(null);
  const [userStats, setUserStats] = useState(null);
  const [activeModal, setActiveModal] = useState(null); // 'goals', 'preferences', 'settings', 'export'
  
  const userId = user?.id || 'guest';

  useEffect(() => {
    loadProfileData();
  }, [userId]);

  const loadProfileData = async () => {
    try {
      setLoading(true);
      const [profile, goals, preferences, stats] = await Promise.all([
        UserProfileManager.getUserProfile(userId),
        UserProfileManager.getUserGoals(userId),
        UserProfileManager.getCoachingPreferences(userId),
        UserProfileManager.generateUserStats(userId)
      ]);
      
      setUserProfile(profile);
      setUserGoals(goals);
      setCoachingPrefs(preferences);
      setUserStats(stats);
    } catch (error) {
      console.error('Failed to load profile data:', error);
      Alert.alert('Error', 'Failed to load profile data. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateGoals = async (updatedGoals) => {
    try {
      const result = await UserProfileManager.updateUserGoals(userId, updatedGoals);
      setUserGoals(result);
      setActiveModal(null);
    } catch (error) {
      console.error('Failed to update goals:', error);
      Alert.alert('Error', 'Failed to update goals. Please try again.');
    }
  };

  const handleUpdatePreferences = async (updatedPrefs) => {
    try {
      const result = await UserProfileManager.updateCoachingPreferences(userId, updatedPrefs);
      setCoachingPrefs(result);
      setActiveModal(null);
    } catch (error) {
      console.error('Failed to update preferences:', error);
      Alert.alert('Error', 'Failed to update preferences. Please try again.');
    }
  };

  const handleExportData = async () => {
    try {
      Alert.alert(
        'Export Data',
        'Your coaching data has been prepared for export. In a full implementation, this would allow you to download all your coaching insights, videos, and progress data.',
        [{ text: 'OK' }]
      );
      setActiveModal(null);
    } catch (error) {
      console.error('Failed to export data:', error);
      Alert.alert('Error', 'Failed to export data. Please try again.');
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'Are you sure you want to delete your account? This will permanently remove all your coaching data, videos, and progress. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Account',
          style: 'destructive',
          onPress: async () => {
            try {
              await UserProfileManager.deleteUserData(userId);
              await signOut();
              Alert.alert('Account Deleted', 'Your account has been permanently deleted.');
            } catch (error) {
              console.error('Failed to delete account:', error);
              Alert.alert('Error', 'Failed to delete account. Please try again.');
            }
          }
        }
      ]
    );
  };

  const renderProfileHeader = () => (
    <View style={styles.profileHeader}>
      <View style={styles.avatarContainer}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(user?.name || user?.email || 'U').charAt(0).toUpperCase()}
          </Text>
        </View>
      </View>
      
      <View style={styles.userInfo}>
        <Text style={styles.userName}>
          {user?.name || user?.email || 'Golf Enthusiast'}
        </Text>
        <Text style={styles.userEmail}>{user?.email || 'Guest User'}</Text>
        <Text style={styles.memberSince}>
          Member since {new Date(userStats?.joinDate || new Date()).toLocaleDateString()}
        </Text>
      </View>
      
      <View style={styles.overallProgress}>
        <Text style={styles.progressScore}>
          {userStats?.averageScore?.toFixed(1) || '—'}
        </Text>
        <Text style={styles.progressLabel}>Avg Score</Text>
      </View>
    </View>
  );

  const renderQuickStats = () => (
    <View style={styles.quickStats}>
      <View style={styles.statItem}>
        <Text style={styles.statValue}>{userStats?.totalVideos || 0}</Text>
        <Text style={styles.statLabel}>Videos</Text>
      </View>
      <View style={styles.statItem}>
        <Text style={styles.statValue}>{userStats?.videosAnalyzed || 0}</Text>
        <Text style={styles.statLabel}>Analyzed</Text>
      </View>
      <View style={styles.statItem}>
        <Text style={styles.statValue}>{userStats?.streakData?.current || 0}</Text>
        <Text style={styles.statLabel}>Streak</Text>
      </View>
      <View style={styles.statItem}>
        <View style={styles.trendIndicator}>
          <Ionicons 
            name={userStats?.improvementTrend === 'improving' ? 'trending-up' : 
                  userStats?.improvementTrend === 'declining' ? 'trending-down' : 'remove'} 
            size={20} 
            color={userStats?.improvementTrend === 'improving' ? colors.success : 
                   userStats?.improvementTrend === 'declining' ? colors.error : colors.textSecondary} 
          />
        </View>
        <Text style={styles.statLabel}>Trend</Text>
      </View>
    </View>
  );

  const renderMenuItems = () => (
    <View style={styles.menuSection}>
      <TouchableOpacity 
        style={styles.menuItem}
        onPress={() => setActiveModal('goals')}
      >
        <View style={styles.menuIconContainer}>
          <Ionicons name="trophy" size={24} color={colors.accent} />
        </View>
        <View style={styles.menuContent}>
          <Text style={styles.menuTitle}>Goals & Progress</Text>
          <Text style={styles.menuSubtitle}>
            {(userGoals?.swingGoals?.length || 0) + (userGoals?.golfGoals?.length || 0)} active goals
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity>

      <TouchableOpacity 
        style={styles.menuItem}
        onPress={() => setActiveModal('preferences')}
      >
        <View style={styles.menuIconContainer}>
          <Ionicons name="person-circle" size={24} color={colors.primary} />
        </View>
        <View style={styles.menuContent}>
          <Text style={styles.menuTitle}>Coaching Preferences</Text>
          <Text style={styles.menuSubtitle}>
            {coachingPrefs?.coachingStyle || 'Standard'} coaching style
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity>

      <TouchableOpacity 
        style={styles.menuItem}
        onPress={() => navigation.navigate('Videos')}
      >
        <View style={styles.menuIconContainer}>
          <Ionicons name="videocam" size={24} color={colors.warning} />
        </View>
        <View style={styles.menuContent}>
          <Text style={styles.menuTitle}>Video Vault</Text>
          <Text style={styles.menuSubtitle}>View all your swing videos</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity>

      <TouchableOpacity 
        style={styles.menuItem}
        onPress={() => setActiveModal('settings')}
      >
        <View style={styles.menuIconContainer}>
          <Ionicons name="settings" size={24} color={colors.textSecondary} />
        </View>
        <View style={styles.menuContent}>
          <Text style={styles.menuTitle}>App Settings</Text>
          <Text style={styles.menuSubtitle}>Notifications & preferences</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );

  const renderDataSection = () => (
    <View style={styles.dataSection}>
      <Text style={styles.sectionTitle}>Data & Account</Text>
      
      <TouchableOpacity 
        style={styles.dataMenuItem}
        onPress={handleExportData}
      >
        <Ionicons name="download" size={20} color={colors.primary} />
        <Text style={styles.dataMenuText}>Export My Data</Text>
      </TouchableOpacity>
      
      <TouchableOpacity 
        style={styles.dataMenuItem}
        onPress={() => {
          Alert.alert(
            'Clear Data',
            'This will remove all your local coaching data but keep your account. You can sign back in anytime.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Clear Data', onPress: () => UserProfileManager.deleteUserData(userId) }
            ]
          );
        }}
      >
        <Ionicons name="trash" size={20} color={colors.warning} />
        <Text style={styles.dataMenuText}>Clear Local Data</Text>
      </TouchableOpacity>
      
      <TouchableOpacity 
        style={styles.dataMenuItem}
        onPress={handleDeleteAccount}
      >
        <Ionicons name="close-circle" size={20} color={colors.error} />
        <Text style={[styles.dataMenuText, { color: colors.error }]}>Delete Account</Text>
      </TouchableOpacity>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading your profile...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Profile</Text>
      </View>

      <ScrollView 
        style={styles.content}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {renderProfileHeader()}
        {renderQuickStats()}
        {renderMenuItems()}
        {renderDataSection()}
        
        <View style={styles.appInfo}>
          <Text style={styles.appVersion}>Pin High Golf Coach v1.0.0</Text>
          <Text style={styles.buildInfo}>Built with ❤️ for golfers</Text>
        </View>
      </ScrollView>

      {/* Goals Modal */}
      <Modal
        visible={activeModal === 'goals'}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setActiveModal(null)}
      >
        {userGoals && (
          <GoalsManager
            goals={userGoals}
            userStats={userStats}
            onUpdateGoals={handleUpdateGoals}
            onClose={() => setActiveModal(null)}
          />
        )}
      </Modal>

      {/* Coaching Preferences Modal */}
      <Modal
        visible={activeModal === 'preferences'}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setActiveModal(null)}
      >
        {coachingPrefs && (
          <CoachingPreferences
            preferences={coachingPrefs}
            onUpdatePreferences={handleUpdatePreferences}
            onClose={() => setActiveModal(null)}
          />
        )}
      </Modal>

      {/* App Settings Modal */}
      <Modal
        visible={activeModal === 'settings'}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setActiveModal(null)}
      >
        {userProfile && (
          <AppSettings
            profile={userProfile}
            onUpdateProfile={async (updates) => {
              const updated = await UserProfileManager.updateUserProfile(userId, updates);
              setUserProfile(updated);
              setActiveModal(null);
            }}
            onClose={() => setActiveModal(null)}
          />
        )}
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.base,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    fontSize: typography.fontSizes['2xl'],
    fontWeight: typography.fontWeights.bold,
    color: colors.primary,
    fontFamily: typography.fontFamily,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  loadingText: {
    fontSize: typography.fontSizes.base,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    marginTop: spacing.base,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.surface,
    marginBottom: spacing.base,
  },
  avatarContainer: {
    marginRight: spacing.base,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.base,
  },
  avatarText: {
    fontSize: typography.fontSizes['3xl'],
    fontWeight: typography.fontWeights.bold,
    color: colors.surface,
    fontFamily: typography.fontFamily,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.bold,
    color: colors.text,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.xs,
  },
  userEmail: {
    fontSize: typography.fontSizes.base,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.xs,
  },
  memberSince: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
  },
  overallProgress: {
    alignItems: 'center',
  },
  progressScore: {
    fontSize: typography.fontSizes['2xl'],
    fontWeight: typography.fontWeights.bold,
    color: colors.primary,
    fontFamily: typography.fontFamily,
  },
  progressLabel: {
    fontSize: typography.fontSizes.xs,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
  },
  quickStats: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    paddingVertical: spacing.lg,
    marginBottom: spacing.base,
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: typography.fontSizes.xl,
    fontWeight: typography.fontWeights.bold,
    color: colors.primary,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.xs,
  },
  statLabel: {
    fontSize: typography.fontSizes.xs,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
  },
  trendIndicator: {
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  menuSection: {
    backgroundColor: colors.surface,
    marginBottom: spacing.base,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  menuIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.base,
  },
  menuContent: {
    flex: 1,
  },
  menuTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.medium,
    color: colors.text,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.xs,
  },
  menuSubtitle: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
  },
  dataSection: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.base,
    marginBottom: spacing.base,
  },
  sectionTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.semibold,
    color: colors.text,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.base,
  },
  dataMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dataMenuText: {
    fontSize: typography.fontSizes.base,
    color: colors.text,
    fontFamily: typography.fontFamily,
    marginLeft: spacing.base,
  },
  appInfo: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  appVersion: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.xs,
  },
  buildInfo: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
  },
});

export default ProfileScreen;