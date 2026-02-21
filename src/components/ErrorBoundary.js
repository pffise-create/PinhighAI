import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, borderRadius, shadows } from '../utils/theme';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: 0
    };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI
    return {
      hasError: true,
      error
    };
  }

  componentDidCatch(error, errorInfo) {
    // Log error for debugging
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    
    this.setState({
      error,
      errorInfo
    });

    // In a production app, you would send this to an error reporting service
    this.logErrorToService(error, errorInfo);
  }

  logErrorToService = (error, errorInfo) => {
    // This would send error details to a service like Sentry, Bugsnag, etc.
    const errorReport = {
      message: error?.message || 'Unknown error',
      stack: error?.stack,
      componentStack: errorInfo?.componentStack,
      timestamp: new Date().toISOString(),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'React Native',
      retryCount: this.state.retryCount
    };
    
    console.log('Error report would be sent:', errorReport);
  };

  handleRetry = () => {
    this.setState(prevState => ({
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: prevState.retryCount + 1
    }));
  };

  handleReportError = () => {
    const { error, errorInfo } = this.state;
    
    Alert.alert(
      'Report Error',
      'Would you like to send this error report to help us improve the app?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send Report',
          onPress: () => {
            // In a real app, this would send detailed error info
            Alert.alert('Thank You', 'Error report sent successfully!');
            console.log('Error report sent:', { error, errorInfo });
          }
        }
      ]
    );
  };

  handleGoHome = () => {
    // Reset error state and navigate to home
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: 0
    });
    
    // If navigation prop is available, navigate home
    if (this.props.navigation) {
      this.props.navigation.navigate('Chat');
    }
  };

  renderErrorDetails = () => {
    const { error, errorInfo } = this.state;
    
    if (!__DEV__) return null;
    
    return (
      <View style={styles.errorDetails}>
        <TouchableOpacity 
          style={styles.detailsHeader}
          onPress={() => this.setState(prev => ({ showDetails: !prev.showDetails }))}
        >
          <Text style={styles.detailsTitle}>Error Details (Development)</Text>
          <Ionicons 
            name={this.state.showDetails ? 'chevron-up' : 'chevron-down'} 
            size={20} 
            color={colors.textSecondary} 
          />
        </TouchableOpacity>
        
        {this.state.showDetails && (
          <ScrollView style={styles.errorScroll} nestedScrollEnabled>
            <Text style={styles.errorText}>
              <Text style={styles.errorLabel}>Error: </Text>
              {error?.message || 'Unknown error'}
            </Text>
            
            {error?.stack && (
              <Text style={styles.errorText}>
                <Text style={styles.errorLabel}>Stack: </Text>
                {error.stack}
              </Text>
            )}
            
            {errorInfo?.componentStack && (
              <Text style={styles.errorText}>
                <Text style={styles.errorLabel}>Component Stack: </Text>
                {errorInfo.componentStack}
              </Text>
            )}
          </ScrollView>
        )}
      </View>
    );
  };

  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={styles.container}>
          <View style={styles.content}>
            <View style={styles.errorIcon}>
              <Ionicons name="warning" size={80} color={colors.error} />
            </View>
            
            <Text style={styles.title}>Oops! Something went wrong</Text>
            
            <Text style={styles.description}>
              We encountered an unexpected error. Don't worry, your data is safe and this usually resolves with a simple retry.
            </Text>
            
            <View style={styles.errorStats}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{this.state.retryCount}</Text>
                <Text style={styles.statLabel}>Retry Attempts</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{new Date().toLocaleTimeString()}</Text>
                <Text style={styles.statLabel}>Error Time</Text>
              </View>
            </View>
            
            {this.renderErrorDetails()}
            
            <View style={styles.actions}>
              <TouchableOpacity 
                style={styles.primaryButton}
                onPress={this.handleRetry}
                activeOpacity={0.8}
              >
                <Ionicons name="refresh" size={20} color={colors.surface} />
                <Text style={styles.primaryButtonText}>Try Again</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={styles.secondaryButton}
                onPress={this.handleGoHome}
                activeOpacity={0.8}
              >
                <Ionicons name="home" size={20} color={colors.primary} />
                <Text style={styles.secondaryButtonText}>Go Home</Text>
              </TouchableOpacity>
            </View>
            
            <View style={styles.supportActions}>
              <TouchableOpacity 
                style={styles.supportButton}
                onPress={this.handleReportError}
                activeOpacity={0.8}
              >
                <Ionicons name="bug" size={16} color={colors.textSecondary} />
                <Text style={styles.supportButtonText}>Report Error</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={styles.supportButton}
                onPress={() => Alert.alert('Help', 'Help documentation would be shown here')}
                activeOpacity={0.8}
              >
                <Ionicons name="help-circle" size={16} color={colors.textSecondary} />
                <Text style={styles.supportButtonText}>Get Help</Text>
              </TouchableOpacity>
            </View>
            
            <Text style={styles.footer}>
              If this problem persists, please contact support with the error details above.
            </Text>
          </View>
        </SafeAreaView>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    padding: spacing.xl,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorIcon: {
    marginBottom: spacing.xl,
    opacity: 0.8,
  },
  title: {
    fontSize: typography.fontSizes['2xl'],
    fontWeight: typography.fontWeights.bold,
    color: colors.text,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
    marginBottom: spacing.base,
  },
  description: {
    fontSize: typography.fontSizes.base,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  errorStats: {
    flexDirection: 'row',
    marginBottom: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    ...shadows.base,
  },
  statItem: {
    alignItems: 'center',
    marginHorizontal: spacing.lg,
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
    textAlign: 'center',
  },
  errorDetails: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.xl,
    ...shadows.base,
  },
  detailsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  detailsTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.medium,
    color: colors.text,
    fontFamily: typography.fontFamily,
  },
  errorScroll: {
    maxHeight: 200,
    padding: spacing.lg,
  },
  errorText: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: 'monospace',
    marginBottom: spacing.base,
  },
  errorLabel: {
    fontWeight: typography.fontWeights.semibold,
    color: colors.error,
  },
  actions: {
    width: '100%',
    marginBottom: spacing.lg,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.base,
    ...shadows.sm,
  },
  primaryButtonText: {
    color: colors.surface,
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.semibold,
    fontFamily: typography.fontFamily,
    marginLeft: spacing.sm,
  },
  secondaryButton: {
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryButtonText: {
    color: colors.primary,
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.medium,
    fontFamily: typography.fontFamily,
    marginLeft: spacing.sm,
  },
  supportActions: {
    flexDirection: 'row',
    marginBottom: spacing.xl,
  },
  supportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.sm,
  },
  supportButtonText: {
    color: colors.textSecondary,
    fontSize: typography.fontSizes.sm,
    fontFamily: typography.fontFamily,
    marginLeft: spacing.xs,
    textDecorationLine: 'underline',
  },
  footer: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
    fontStyle: 'italic',
  },
});

export default ErrorBoundary;