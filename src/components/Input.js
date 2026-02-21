import React from 'react';
import { View, TextInput, Text, StyleSheet } from 'react-native';
import { colors, typography, radius } from '../utils/theme';

export function Input({
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  autoCapitalize = 'none',
  keyboardType = 'default',
  editable = true,
  multiline = false,
  numberOfLines,
  leftIcon,
  error,
  label,
}) {
  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={[styles.inputWrapper, error && styles.inputWrapperError]}>
        {leftIcon && <View style={styles.leftIcon}>{leftIcon}</View>}
        <TextInput
          style={[styles.input, leftIcon && styles.inputWithIcon, multiline && styles.inputMultiline]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary}
          secureTextEntry={secureTextEntry}
          autoCapitalize={autoCapitalize}
          keyboardType={keyboardType}
          editable={editable}
          multiline={multiline}
          numberOfLines={numberOfLines}
        />
      </View>
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  label: {
    fontSize: typography.base,
    lineHeight: typography.baseLh,
    fontWeight: typography.medium,
    color: colors.textPrimary,
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.5)',
    borderRadius: radius.md,
    paddingHorizontal: 16,
  },
  inputWrapperError: {
    borderColor: colors.statusError,
  },
  input: {
    flex: 1,
    fontSize: typography.base,
    lineHeight: typography.baseLh,
    color: colors.textPrimary,
    padding: 0,
    paddingVertical: 12,
  },
  inputMultiline: {
    minHeight: 44,
    textAlignVertical: 'top',
  },
  inputWithIcon: {
    marginLeft: 8,
  },
  leftIcon: {
    marginRight: 4,
  },
  errorText: {
    fontSize: typography.sm,
    lineHeight: typography.smLh,
    color: colors.statusError,
    marginTop: 6,
  },
});

export default Input;
