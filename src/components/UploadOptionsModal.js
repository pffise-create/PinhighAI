import React from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, borderRadius, shadows } from '../utils/theme';

const { height } = Dimensions.get('window');

const OPTION_HEIGHT = 72;

const OptionRow = ({ icon, iconColor, title, description, onPress }) => (
  <TouchableOpacity
    style={styles.optionRow}
    onPress={onPress}
    activeOpacity={0.85}
  >
    <View style={[styles.optionIcon, { backgroundColor: colors.backgroundMuted }] }>
      <Ionicons name={icon} size={24} color={iconColor} />
    </View>
    <View style={styles.optionCopy}>
      <Text style={styles.optionTitle}>{title}</Text>
      <Text style={styles.optionDescription}>{description}</Text>
    </View>
    <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
  </TouchableOpacity>
);

const TipRow = ({ text }) => (
  <View style={styles.tipRow}>
    <View style={styles.tipDot} />
    <Text style={styles.tipText}>{text}</Text>
  </View>
);

const UploadOptionsModal = ({
  visible,
  onClose,
  onOpenStudio,
  onRecordVideo,
  onChooseFromGallery,
}) => (
  <Modal
    visible={visible}
    transparent
    animationType="slide"
    onRequestClose={onClose}
  >
    <View style={styles.overlay}>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <Text style={styles.sheetTitle}>Upload swing video</Text>
            <Text style={styles.sheetSubtitle}>
              Choose how you want to share your latest swing with your coach.
            </Text>
          </View>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <View style={styles.optionsContainer}>
          {onOpenStudio && (
            <OptionRow
              icon="walk"
              iconColor={colors.brandFern}
              title="Swing studio"
              description="Jump into the guided upload flow with progress tracking."
              onPress={() => {
                onClose?.();
                onOpenStudio();
              }}
            />
          )}
          <OptionRow
            icon="videocam"
            iconColor={colors.primary}
            title="Record a new swing"
            description="Launch the camera and capture a fresh swing clip."
            onPress={() => {
              onClose?.();
              onRecordVideo();
            }}
          />
          <OptionRow
            icon="images"
            iconColor={colors.coachAccent}
            title="Choose from library"
            description="Pick an existing video from your camera roll."
            onPress={() => {
              onClose?.();
              onChooseFromGallery();
            }}
          />
        </View>

        <View style={styles.tipsCard}>
          <Text style={styles.tipsTitle}>Quick recording tips</Text>
          <TipRow text="Film from chest height and keep the full swing in frame." />
          <TipRow text="Use good lighting so the club path stays clear." />
          <TipRow text="Hold the finish for two beats to capture follow-through." />
        </View>
      </View>
    </View>
  </Modal>
);

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing['2xl'],
    maxHeight: height * 0.85,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  headerCopy: {
    flex: 1,
    paddingRight: spacing.base,
  },
  sheetTitle: {
    fontSize: typography.fontSizes['2xl'],
    color: colors.primary,
    fontFamily: typography.fontFamilyHeading,
  },
  sheetSubtitle: {
    marginTop: spacing.xs,
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    lineHeight: typography.lineHeights.relaxed * typography.fontSizes.sm,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.full,
    backgroundColor: colors.backgroundMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionsContainer: {
    marginTop: spacing['2xl'],
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: OPTION_HEIGHT,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.base,
    marginBottom: spacing.sm,
    ...shadows.xs,
  },
  optionIcon: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.base,
  },
  optionCopy: {
    flex: 1,
  },
  optionTitle: {
    fontSize: typography.fontSizes.base,
    color: colors.text,
    fontFamily: typography.fontFamilyHeading,
  },
  optionDescription: {
    marginTop: spacing.xs / 2,
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    lineHeight: typography.lineHeights.relaxed * typography.fontSizes.sm,
  },
  tipsCard: {
    marginTop: spacing['2xl'],
    backgroundColor: colors.backgroundMuted,
    borderRadius: borderRadius.lg,
    padding: spacing.base,
    borderLeftWidth: 4,
    borderLeftColor: colors.coachAccent,
  },
  tipsTitle: {
    fontSize: typography.fontSizes.base,
    color: colors.primary,
    fontFamily: typography.fontFamilyHeading,
    marginBottom: spacing.sm,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.xs,
  },
  tipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.coachAccent,
    marginRight: spacing.sm,
    marginTop: spacing.xs / 2,
  },
  tipText: {
    flex: 1,
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    lineHeight: typography.lineHeights.relaxed * typography.fontSizes.sm,
  },
});

export default UploadOptionsModal;
