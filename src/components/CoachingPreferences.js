import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,

} from 'react-native';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, borderRadius, shadows } from '../utils/theme';

export default function CoachingPreferences({ 
  preferences, 
  onUpdatePreferences, 
  onClose 
}) {
  const [localPrefs, setLocalPrefs] = useState(preferences);

  const coachingStyles = [
    {
      key: 'encouraging',
      title: 'Encouraging Coach',
      description: 'Positive, motivational feedback with gentle guidance',
      icon: 'happy',
      color: colors.success
    },
    {
      key: 'analytical',
      title: 'Analytical Coach',
      description: 'Detailed technical analysis with data-driven insights',
      icon: 'analytics',
      color: colors.primary
    },
    {
      key: 'balanced',
      title: 'Balanced Coach',
      description: 'Mix of encouragement and technical detail',
      icon: 'scale',
      color: colors.accent
    }
  ];

  const focusAreas = [
    { key: 'setup', label: 'Setup & Address', icon: 'golf' },
    { key: 'backswing', label: 'Backswing', icon: 'trending-up' },
    { key: 'transition', label: 'Transition', icon: 'swap-horizontal' },
    { key: 'impact', label: 'Impact Position', icon: 'flash' },
    { key: 'follow_through', label: 'Follow Through', icon: 'trending-down' },
    { key: 'tempo', label: 'Tempo & Rhythm', icon: 'musical-notes' },
    { key: 'balance', label: 'Balance', icon: 'fitness' },
    { key: 'consistency', label: 'Consistency', icon: 'repeat' }
  ];

  const sessionFrequencies = [
    { key: 'daily', label: 'Daily', description: 'Practice reminders every day' },
    { key: 'weekly', label: 'Weekly', description: '2-3 times per week' },
    { key: 'biweekly', label: 'Bi-weekly', description: 'Every two weeks' },
    { key: 'monthly', label: 'Monthly', description: 'Once per month' }
  ];

  const handleStyleChange = (styleKey) => {
    setLocalPrefs({
      ...localPrefs,
      coachingStyle: styleKey
    });
  };

  const handleFocusAreaToggle = (areaKey) => {
    const currentFocusAreas = localPrefs.focusAreas || [];
    const updatedAreas = currentFocusAreas.includes(areaKey)
      ? currentFocusAreas.filter(area => area !== areaKey)
      : [...currentFocusAreas, areaKey];
    
    setLocalPrefs({
      ...localPrefs,
      focusAreas: updatedAreas
    });
  };

  const handleSavePreferences = () => {
    onUpdatePreferences(localPrefs);
  };

  const renderCoachingStyleCard = (style) => {
    const isSelected = localPrefs.coachingStyle === style.key;
    
    return (
      <TouchableOpacity
        key={style.key}
        style={[styles.styleCard, isSelected && styles.selectedStyleCard]}
        onPress={() => handleStyleChange(style.key)}
        activeOpacity={0.8}
      >
        <View style={styles.styleHeader}>
          <View style={[styles.styleIcon, { backgroundColor: style.color + '20' }]}>
            <Ionicons name={style.icon} size={24} color={style.color} />
          </View>
          <View style={styles.styleTitleContainer}>
            <Text style={[styles.styleTitle, isSelected && styles.selectedStyleTitle]}>
              {style.title}
            </Text>
            <Text style={styles.styleDescription}>{style.description}</Text>
          </View>
          {isSelected && (
            <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const renderFocusArea = (area) => {
    const isSelected = (localPrefs.focusAreas || []).includes(area.key);
    
    return (
      <TouchableOpacity
        key={area.key}
        style={[styles.focusAreaCard, isSelected && styles.selectedFocusAreaCard]}
        onPress={() => handleFocusAreaToggle(area.key)}
        activeOpacity={0.8}
      >
        <View style={styles.focusAreaContent}>
          <Ionicons 
            name={area.icon} 
            size={20} 
            color={isSelected ? colors.primary : colors.textSecondary} 
          />
          <Text style={[styles.focusAreaText, isSelected && styles.selectedFocusAreaText]}>
            {area.label}
          </Text>
          {isSelected && (
            <Ionicons name="checkmark" size={16} color={colors.primary} />
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const renderSessionFrequency = (frequency) => {
    const isSelected = localPrefs.sessionFrequency === frequency.key;
    
    return (
      <TouchableOpacity
        key={frequency.key}
        style={[styles.frequencyCard, isSelected && styles.selectedFrequencyCard]}
        onPress={() => setLocalPrefs({ ...localPrefs, sessionFrequency: frequency.key })}
        activeOpacity={0.8}
      >
        <View style={styles.frequencyContent}>
          <Text style={[styles.frequencyLabel, isSelected && styles.selectedFrequencyLabel]}>
            {frequency.label}
          </Text>
          <Text style={styles.frequencyDescription}>{frequency.description}</Text>
        </View>
        {isSelected && (
          <Ionicons name="radio-button-on" size={20} color={colors.primary} />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Coaching Preferences</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Ionicons name="close" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView 
        style={styles.content}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Coaching Style Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Coaching Style</Text>
          <Text style={styles.sectionDescription}>
            Choose how you'd like your AI coach to communicate with you
          </Text>
          
          <View style={styles.stylesContainer}>
            {coachingStyles.map(renderCoachingStyleCard)}
          </View>
        </View>

        {/* Focus Areas Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Priority Focus Areas</Text>
          <Text style={styles.sectionDescription}>
            Select areas you want to prioritize in your coaching sessions
          </Text>
          
          <View style={styles.focusAreasGrid}>
            {focusAreas.map(renderFocusArea)}
          </View>
        </View>

        {/* Session Frequency Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Session Frequency</Text>
          <Text style={styles.sectionDescription}>
            How often would you like coaching reminders?
          </Text>
          
          <View style={styles.frequencyContainer}>
            {sessionFrequencies.map(renderSessionFrequency)}
          </View>
        </View>

        {/* Analysis Detail Level */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Analysis Detail Level</Text>
          <Text style={styles.sectionDescription}>
            Control how detailed your swing analysis should be
          </Text>
          
          <View style={styles.sliderContainer}>
            <View style={styles.sliderLabels}>
              <Text style={styles.sliderLabel}>Basic</Text>
              <Text style={styles.sliderLabel}>Standard</Text>
              <Text style={styles.sliderLabel}>Detailed</Text>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={0}
              maximumValue={2}
              step={1}
              value={
                localPrefs.analysisDetail === 'basic' ? 0 :
                localPrefs.analysisDetail === 'standard' ? 1 : 2
              }
              onValueChange={(value) => {
                const detail = value === 0 ? 'basic' : value === 1 ? 'standard' : 'detailed';
                setLocalPrefs({ ...localPrefs, analysisDetail: detail });
              }}
              minimumTrackTintColor={colors.primary}
              maximumTrackTintColor={colors.border}
              thumbStyle={styles.sliderThumb}
            />
          </View>
        </View>

        {/* Reminder Settings */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Reminder Settings</Text>
          
          <View style={styles.reminderItem}>
            <View style={styles.reminderContent}>
              <Text style={styles.reminderTitle}>Practice Reminders</Text>
              <Text style={styles.reminderDescription}>
                Get notified when it's time to practice
              </Text>
            </View>
            <Switch
              value={localPrefs.reminderSettings?.practiceReminders || false}
              onValueChange={(value) => setLocalPrefs({
                ...localPrefs,
                reminderSettings: {
                  ...localPrefs.reminderSettings,
                  practiceReminders: value
                }
              })}
              trackColor={{ false: colors.border, true: colors.primary + '40' }}
              thumbColor={colors.primary}
            />
          </View>

          <View style={styles.reminderItem}>
            <View style={styles.reminderContent}>
              <Text style={styles.reminderTitle}>Progress Check-ins</Text>
              <Text style={styles.reminderDescription}>
                Weekly progress updates and encouragement
              </Text>
            </View>
            <Switch
              value={localPrefs.reminderSettings?.progressCheckins || false}
              onValueChange={(value) => setLocalPrefs({
                ...localPrefs,
                reminderSettings: {
                  ...localPrefs.reminderSettings,
                  progressCheckins: value
                }
              })}
              trackColor={{ false: colors.border, true: colors.primary + '40' }}
              thumbColor={colors.primary}
            />
          </View>

          <View style={styles.reminderItem}>
            <View style={styles.reminderContent}>
              <Text style={styles.reminderTitle}>Goal Deadlines</Text>
              <Text style={styles.reminderDescription}>
                Reminders about upcoming goal deadlines
              </Text>
            </View>
            <Switch
              value={localPrefs.reminderSettings?.goalDeadlines || false}
              onValueChange={(value) => setLocalPrefs({
                ...localPrefs,
                reminderSettings: {
                  ...localPrefs.reminderSettings,
                  goalDeadlines: value
                }
              })}
              trackColor={{ false: colors.border, true: colors.primary + '40' }}
              thumbColor={colors.primary}
            />
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity 
          style={styles.saveButton}
          onPress={handleSavePreferences}
          activeOpacity={0.8}
        >
          <Text style={styles.saveButtonText}>Save Preferences</Text>
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
    marginBottom: spacing.xs,
  },
  sectionDescription: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.base,
    lineHeight: 20,
  },
  // Coaching Style Styles
  stylesContainer: {
    gap: spacing.base,
  },
  styleCard: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    padding: spacing.base,
    borderWidth: 2,
    borderColor: colors.border,
  },
  selectedStyleCard: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '10',
  },
  styleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  styleIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.base,
  },
  styleTitleContainer: {
    flex: 1,
  },
  styleTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.semibold,
    color: colors.text,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.xs,
  },
  selectedStyleTitle: {
    color: colors.primary,
  },
  styleDescription: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    lineHeight: 18,
  },
  // Focus Areas Styles
  focusAreasGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  focusAreaCard: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: '48%',
    flexGrow: 1,
  },
  selectedFocusAreaCard: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '10',
  },
  focusAreaContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  focusAreaText: {
    fontSize: typography.fontSizes.sm,
    color: colors.text,
    fontFamily: typography.fontFamily,
    flex: 1,
    marginLeft: spacing.sm,
  },
  selectedFocusAreaText: {
    color: colors.primary,
    fontWeight: typography.fontWeights.medium,
  },
  // Frequency Styles
  frequencyContainer: {
    gap: spacing.sm,
  },
  frequencyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.border,
  },
  selectedFrequencyCard: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '10',
  },
  frequencyContent: {
    flex: 1,
  },
  frequencyLabel: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.medium,
    color: colors.text,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.xs,
  },
  selectedFrequencyLabel: {
    color: colors.primary,
  },
  frequencyDescription: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
  },
  // Slider Styles
  sliderContainer: {
    paddingHorizontal: spacing.base,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  sliderLabel: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  sliderThumb: {
    backgroundColor: colors.primary,
    width: 20,
    height: 20,
  },
  // Reminder Styles
  reminderItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  reminderContent: {
    flex: 1,
  },
  reminderTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.medium,
    color: colors.text,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.xs,
  },
  reminderDescription: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
  },
  // Footer
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