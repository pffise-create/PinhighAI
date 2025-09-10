import React from 'react';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  Modal, 
  StyleSheet,
  Dimensions 
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, borderRadius, shadows } from '../utils/theme';

const { height } = Dimensions.get('window');

export default function UploadOptionsModal({ 
  visible, 
  onClose, 
  onRecordVideo, 
  onChooseFromGallery 
}) {
  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.modalContainer}>
          <View style={styles.header}>
            <Text style={styles.title}>Upload Swing Video</Text>
            <TouchableOpacity 
              style={styles.closeButton} 
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          
          <Text style={styles.subtitle}>
            Choose how you'd like to add your golf swing video for analysis
          </Text>

          <View style={styles.optionsContainer}>
            <TouchableOpacity 
              style={styles.optionButton}
              onPress={onRecordVideo}
              activeOpacity={0.8}
            >
              <View style={styles.optionIconContainer}>
                <Ionicons name="videocam" size={32} color={colors.primary} />
              </View>
              <View style={styles.optionTextContainer}>
                <Text style={styles.optionTitle}>Record Video</Text>
                <Text style={styles.optionDescription}>
                  Use your camera to record a new swing video
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.optionButton}
              onPress={onChooseFromGallery}
              activeOpacity={0.8}
            >
              <View style={styles.optionIconContainer}>
                <Ionicons name="images" size={32} color={colors.accent} />
              </View>
              <View style={styles.optionTextContainer}>
                <Text style={styles.optionTitle}>Choose from Gallery</Text>
                <Text style={styles.optionDescription}>
                  Select an existing video from your photo library
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.tipsContainer}>
            <Text style={styles.tipsTitle}>📹 Recording Tips:</Text>
            <Text style={styles.tip}>• Record from the side (profile view)</Text>
            <Text style={styles.tip}>• Include setup through follow-through</Text>
            <Text style={styles.tip}>• Keep camera steady and at chest height</Text>
            <Text style={styles.tip}>• Make sure lighting is good</Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    maxHeight: height * 0.8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: typography.fontSizes['2xl'],
    fontWeight: typography.fontWeights.semibold,
    color: colors.primary,
    fontFamily: typography.fontFamily,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  subtitle: {
    fontSize: typography.fontSizes.base,
    color: colors.textSecondary,
    lineHeight: 20,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.xl,
  },
  optionsContainer: {
    marginBottom: spacing.xl,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.base,
    ...shadows.sm,
  },
  optionIconContainer: {
    width: 56,
    height: 56,
    backgroundColor: colors.surface,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.base,
    ...shadows.sm,
  },
  optionTextContainer: {
    flex: 1,
  },
  optionTitle: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.medium,
    color: colors.text,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.xs,
  },
  optionDescription: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    lineHeight: 18,
  },
  tipsContainer: {
    backgroundColor: colors.background,
    padding: spacing.base,
    borderRadius: borderRadius.base,
    borderLeftWidth: 4,
    borderLeftColor: colors.accent,
  },
  tipsTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.medium,
    color: colors.primary,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.sm,
  },
  tip: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.xs,
    lineHeight: 16,
  },
});