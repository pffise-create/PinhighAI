/**
 * ContinueCoachingButton - Navigation to main chat with context
 * 
 * Provides seamless transition from ResultsScreen to ChatScreen
 * while preserving coaching context and conversation state.
 */

import React from 'react';
import { TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import { colors, typography, spacing, borderRadius } from '../utils/theme';

const ContinueCoachingButton = ({ 
  onPress, 
  context = null, 
  disabled = false,
  loading = false 
}) => {
  
  const getButtonText = () => {
    if (loading) return 'Loading...';
    
    if (context && context.session_metadata?.total_sessions > 0) {
      return 'Continue Coaching Chat';
    }
    
    return 'Start Coaching Chat';
  };

  const getSubText = () => {
    if (loading || !context) return null;
    
    const { session_metadata, coaching_themes } = context;
    
    if (session_metadata?.total_sessions > 0) {
      const activeFocus = coaching_themes?.active_focus_areas?.length || 0;
      if (activeFocus > 0) {
        return `Continue working on ${activeFocus} focus area${activeFocus !== 1 ? 's' : ''}`;
      }
      return 'Continue your coaching journey';
    }
    
    return 'Ask questions about this analysis';
  };

  const handlePress = () => {
    if (disabled || loading) return;
    onPress(context);
  };

  return (
    <TouchableOpacity 
      style={[
        styles.container, 
        disabled && styles.disabled,
        loading && styles.loading
      ]} 
      onPress={handlePress}
      disabled={disabled || loading}
      activeOpacity={0.8}
    >
      <View style={styles.content}>
        <Text style={[styles.buttonText, disabled && styles.disabledText]}>
          {getButtonText()}
        </Text>
        
        {getSubText() && (
          <Text style={[styles.subText, disabled && styles.disabledText]}>
            {getSubText()}
          </Text>
        )}
      </View>
      
      <View style={styles.arrow}>
        <Text style={[styles.arrowText, disabled && styles.disabledText]}>→</Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.primary,
    marginHorizontal: spacing.base,
    marginVertical: spacing.sm,
    borderRadius: borderRadius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.base,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  
  disabled: {
    backgroundColor: colors.textLight,
    shadowOpacity: 0,
    elevation: 0,
  },
  
  loading: {
    backgroundColor: colors.textSecondary,
  },
  
  content: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  
  buttonText: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.semibold,
    color: colors.surface,
    marginBottom: spacing.xs,
  },
  
  subText: {
    fontSize: typography.fontSizes.sm,
    color: colors.surface,
    opacity: 0.9,
    lineHeight: typography.fontSizes.sm * 1.3,
  },
  
  disabledText: {
    color: colors.textSecondary,
  },
  
  arrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  arrowText: {
    fontSize: typography.fontSizes.lg,
    color: colors.surface,
    fontWeight: typography.fontWeights.bold,
  },
});

export default ContinueCoachingButton;