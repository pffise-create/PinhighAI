import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, borderRadius, shadows } from '../utils/theme';

export default function GoalsManager({ 
  goals, 
  userStats, 
  onUpdateGoals, 
  onClose 
}) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState(null);
  const [newGoal, setNewGoal] = useState({
    type: 'overall_score',
    target: '',
    targetScore: '',
    targetValue: '',
    deadline: '',
    priority: 'medium'
  });

  const goalTypes = [
    { key: 'overall_score', label: 'Overall Swing Score', scoreField: true },
    { key: 'improvement_area', label: 'Specific Improvement', scoreField: true },
    { key: 'consistency', label: 'Consistency Goal', scoreField: true },
    { key: 'handicap', label: 'Handicap Goal', valueField: true }
  ];

  const priorityColors = {
    high: colors.error,
    medium: colors.warning,
    low: colors.textSecondary
  };

  const handleAddGoal = () => {
    if (!newGoal.target.trim()) {
      Alert.alert('Error', 'Please enter a goal description.');
      return;
    }

    const goalData = {
      ...newGoal,
      targetScore: newGoal.targetScore ? parseFloat(newGoal.targetScore) : null,
      targetValue: newGoal.targetValue ? parseFloat(newGoal.targetValue) : null,
      currentScore: 0,
      currentValue: userStats?.handicap || 15 // Default handicap
    };

    const updatedGoals = { ...goals };
    const goalCategory = newGoal.type === 'handicap' ? 'golfGoals' : 'swingGoals';
    updatedGoals[goalCategory] = [...updatedGoals[goalCategory], goalData];

    onUpdateGoals(updatedGoals);
    setShowAddModal(false);
    setNewGoal({
      type: 'overall_score',
      target: '',
      targetScore: '',
      targetValue: '',
      deadline: '',
      priority: 'medium'
    });
  };

  const handleDeleteGoal = (goalId) => {
    Alert.alert(
      'Delete Goal',
      'Are you sure you want to delete this goal?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const updatedGoals = {
              ...goals,
              swingGoals: goals.swingGoals.filter(g => g.id !== goalId),
              golfGoals: goals.golfGoals.filter(g => g.id !== goalId)
            };
            onUpdateGoals(updatedGoals);
          }
        }
      ]
    );
  };

  const handleUpdateGoalProgress = (goalId, currentValue) => {
    const updatedGoals = { ...goals };
    
    // Update in swing goals
    updatedGoals.swingGoals = goals.swingGoals.map(goal => {
      if (goal.id === goalId) {
        return {
          ...goal,
          currentScore: parseFloat(currentValue) || 0,
          progress: goal.targetScore ? (parseFloat(currentValue) / goal.targetScore) * 100 : 0
        };
      }
      return goal;
    });

    // Update in golf goals
    updatedGoals.golfGoals = goals.golfGoals.map(goal => {
      if (goal.id === goalId) {
        return {
          ...goal,
          currentValue: parseFloat(currentValue) || 0,
          progress: goal.targetValue ? ((goal.currentValue - parseFloat(currentValue)) / goal.currentValue) * 100 : 0
        };
      }
      return goal;
    });

    onUpdateGoals(updatedGoals);
  };

  const renderGoalCard = (goal, index) => {
    const isCompleted = goal.isCompleted || 
      (goal.targetScore && goal.currentScore >= goal.targetScore) ||
      (goal.targetValue && goal.currentValue <= goal.targetValue);
      
    const progress = goal.progress || 0;
    const priorityColor = priorityColors[goal.priority] || colors.textSecondary;

    return (
      <View key={goal.id || index} style={[styles.goalCard, isCompleted && styles.completedGoalCard]}>
        <View style={styles.goalHeader}>
          <View style={styles.goalTitleContainer}>
            <View style={[styles.priorityIndicator, { backgroundColor: priorityColor }]} />
            <Text style={[styles.goalTitle, isCompleted && styles.completedGoalTitle]}>
              {goal.target}
            </Text>
            {isCompleted && (
              <Ionicons name="checkmark-circle" size={20} color={colors.success} />
            )}
          </View>
          
          <TouchableOpacity 
            onPress={() => handleDeleteGoal(goal.id)}
            style={styles.deleteButton}
          >
            <Ionicons name="trash-outline" size={18} color={colors.error} />
          </TouchableOpacity>
        </View>

        <View style={styles.goalProgress}>
          <View style={styles.progressBar}>
            <View 
              style={[
                styles.progressFill,
                {
                  width: `${Math.min(progress, 100)}%`,
                  backgroundColor: isCompleted ? colors.success : colors.primary
                }
              ]} 
            />
          </View>
          <Text style={styles.progressText}>
            {Math.round(progress)}% complete
          </Text>
        </View>

        <View style={styles.goalDetails}>
          {goal.targetScore && (
            <View style={styles.goalMetric}>
              <Text style={styles.goalMetricLabel}>Current: </Text>
              <TextInput
                style={styles.goalMetricInput}
                value={goal.currentScore?.toString() || '0'}
                onChangeText={(value) => handleUpdateGoalProgress(goal.id, value)}
                keyboardType="decimal-pad"
                placeholder="0.0"
              />
              <Text style={styles.goalMetricLabel}> / {goal.targetScore}</Text>
            </View>
          )}
          
          {goal.targetValue && (
            <View style={styles.goalMetric}>
              <Text style={styles.goalMetricLabel}>Current: </Text>
              <TextInput
                style={styles.goalMetricInput}
                value={goal.currentValue?.toString() || '0'}
                onChangeText={(value) => handleUpdateGoalProgress(goal.id, value)}
                keyboardType="decimal-pad"
                placeholder="15"
              />
              <Text style={styles.goalMetricLabel}> → Target: {goal.targetValue}</Text>
            </View>
          )}
          
          {goal.deadline && (
            <View style={styles.goalDeadline}>
              <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.goalDeadlineText}>
                Due: {new Date(goal.deadline).toLocaleDateString()}
              </Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  const renderGoalSection = (title, goalsList, emptyMessage) => {
    if (!goalsList || goalsList.length === 0) {
      return (
        <View style={styles.emptySection}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.emptyMessage}>{emptyMessage}</Text>
        </View>
      );
    }

    return (
      <View style={styles.goalSection}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {goalsList.map((goal, index) => renderGoalCard(goal, index))}
      </View>
    );
  };

  const renderAddGoalModal = () => (
    <Modal
      visible={showAddModal}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setShowAddModal(false)}
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Add New Goal</Text>
          <TouchableOpacity onPress={() => setShowAddModal(false)}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalContent} contentContainerStyle={styles.modalScrollContent}>
          <View style={styles.formSection}>
            <Text style={styles.formLabel}>Goal Type</Text>
            <View style={styles.goalTypeSelector}>
              {goalTypes.map(type => (
                <TouchableOpacity
                  key={type.key}
                  style={[
                    styles.goalTypeButton,
                    newGoal.type === type.key && styles.selectedGoalTypeButton
                  ]}
                  onPress={() => setNewGoal({ ...newGoal, type: type.key })}
                >
                  <Text style={[
                    styles.goalTypeButtonText,
                    newGoal.type === type.key && styles.selectedGoalTypeButtonText
                  ]}>
                    {type.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.formSection}>
            <Text style={styles.formLabel}>Goal Description</Text>
            <TextInput
              style={styles.textInput}
              value={newGoal.target}
              onChangeText={(text) => setNewGoal({ ...newGoal, target: text })}
              placeholder="Describe your goal..."
              placeholderTextColor={colors.textSecondary}
              multiline
            />
          </View>

          {goalTypes.find(t => t.key === newGoal.type)?.scoreField && (
            <View style={styles.formSection}>
              <Text style={styles.formLabel}>Target Score (0-10)</Text>
              <TextInput
                style={styles.textInput}
                value={newGoal.targetScore}
                onChangeText={(text) => setNewGoal({ ...newGoal, targetScore: text })}
                placeholder="8.5"
                placeholderTextColor={colors.textSecondary}
                keyboardType="decimal-pad"
              />
            </View>
          )}

          {goalTypes.find(t => t.key === newGoal.type)?.valueField && (
            <View style={styles.formSection}>
              <Text style={styles.formLabel}>Target Handicap</Text>
              <TextInput
                style={styles.textInput}
                value={newGoal.targetValue}
                onChangeText={(text) => setNewGoal({ ...newGoal, targetValue: text })}
                placeholder="9"
                placeholderTextColor={colors.textSecondary}
                keyboardType="decimal-pad"
              />
            </View>
          )}

          <View style={styles.formSection}>
            <Text style={styles.formLabel}>Target Date</Text>
            <TextInput
              style={styles.textInput}
              value={newGoal.deadline}
              onChangeText={(text) => setNewGoal({ ...newGoal, deadline: text })}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textSecondary}
            />
          </View>

          <View style={styles.formSection}>
            <Text style={styles.formLabel}>Priority</Text>
            <View style={styles.prioritySelector}>
              {['high', 'medium', 'low'].map(priority => (
                <TouchableOpacity
                  key={priority}
                  style={[
                    styles.priorityButton,
                    newGoal.priority === priority && styles.selectedPriorityButton,
                    { borderColor: priorityColors[priority] }
                  ]}
                  onPress={() => setNewGoal({ ...newGoal, priority })}
                >
                  <View style={[styles.priorityIndicator, { backgroundColor: priorityColors[priority] }]} />
                  <Text style={[
                    styles.priorityButtonText,
                    newGoal.priority === priority && { color: priorityColors[priority] }
                  ]}>
                    {priority.charAt(0).toUpperCase() + priority.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </ScrollView>

        <View style={styles.modalActions}>
          <TouchableOpacity 
            style={styles.cancelButton}
            onPress={() => setShowAddModal(false)}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.addButton}
            onPress={handleAddGoal}
          >
            <Text style={styles.addButtonText}>Add Goal</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Goals & Progress</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Ionicons name="close" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView 
        style={styles.content}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {renderGoalSection(
          'Swing Improvement Goals',
          goals.swingGoals,
          'Set goals to improve specific aspects of your swing'
        )}
        
        {renderGoalSection(
          'Golf Performance Goals',
          goals.golfGoals,
          'Set goals for your overall golf performance'
        )}

        <TouchableOpacity 
          style={styles.addGoalButton}
          onPress={() => setShowAddModal(true)}
        >
          <Ionicons name="add-circle" size={24} color={colors.primary} />
          <Text style={styles.addGoalText}>Add New Goal</Text>
        </TouchableOpacity>
      </ScrollView>

      {renderAddGoalModal()}
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
    padding: spacing.lg,
  },
  goalSection: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.semibold,
    color: colors.text,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.base,
  },
  emptySection: {
    marginBottom: spacing.xl,
  },
  emptyMessage: {
    fontSize: typography.fontSizes.base,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  goalCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.base,
    ...shadows.base,
  },
  completedGoalCard: {
    borderWidth: 2,
    borderColor: colors.success,
  },
  goalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.base,
  },
  goalTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  priorityIndicator: {
    width: 4,
    height: 20,
    borderRadius: 2,
    marginRight: spacing.sm,
  },
  goalTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.medium,
    color: colors.text,
    fontFamily: typography.fontFamily,
    flex: 1,
    marginRight: spacing.sm,
  },
  completedGoalTitle: {
    textDecorationLine: 'line-through',
    color: colors.textSecondary,
  },
  deleteButton: {
    padding: spacing.xs,
  },
  goalProgress: {
    marginBottom: spacing.base,
  },
  progressBar: {
    height: 8,
    backgroundColor: colors.border,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: spacing.xs,
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  progressText: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    textAlign: 'right',
  },
  goalDetails: {
    gap: spacing.sm,
  },
  goalMetric: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  goalMetricLabel: {
    fontSize: typography.fontSizes.sm,
    color: colors.text,
    fontFamily: typography.fontFamily,
  },
  goalMetricInput: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    fontSize: typography.fontSizes.sm,
    color: colors.text,
    fontFamily: typography.fontFamily,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 50,
    textAlign: 'center',
  },
  goalDeadline: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  goalDeadlineText: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily,
    marginLeft: spacing.xs,
  },
  addGoalButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 2,
    borderColor: colors.primary,
    borderStyle: 'dashed',
  },
  addGoalText: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.medium,
    color: colors.primary,
    fontFamily: typography.fontFamily,
    marginLeft: spacing.sm,
  },
  // Modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  modalTitle: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.semibold,
    color: colors.text,
    fontFamily: typography.fontFamily,
  },
  modalContent: {
    flex: 1,
  },
  modalScrollContent: {
    padding: spacing.lg,
  },
  formSection: {
    marginBottom: spacing.lg,
  },
  formLabel: {
    fontSize: typography.fontSizes.base,
    fontWeight: typography.fontWeights.medium,
    color: colors.text,
    fontFamily: typography.fontFamily,
    marginBottom: spacing.sm,
  },
  textInput: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.base,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    fontSize: typography.fontSizes.base,
    color: colors.text,
    fontFamily: typography.fontFamily,
    borderWidth: 1,
    borderColor: colors.border,
  },
  goalTypeSelector: {
    gap: spacing.sm,
  },
  goalTypeButton: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.base,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  selectedGoalTypeButton: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  goalTypeButtonText: {
    fontSize: typography.fontSizes.sm,
    color: colors.text,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
  },
  selectedGoalTypeButtonText: {
    color: colors.surface,
  },
  prioritySelector: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  priorityButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.base,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderWidth: 1,
  },
  selectedPriorityButton: {
    backgroundColor: colors.background,
  },
  priorityButtonText: {
    fontSize: typography.fontSizes.sm,
    color: colors.text,
    fontFamily: typography.fontFamily,
    marginLeft: spacing.sm,
  },
  modalActions: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.base,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.base,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: colors.background,
    paddingVertical: spacing.base,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelButtonText: {
    fontSize: typography.fontSizes.base,
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeights.medium,
  },
  addButton: {
    flex: 1,
    backgroundColor: colors.primary,
    paddingVertical: spacing.base,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    ...shadows.sm,
  },
  addButtonText: {
    fontSize: typography.fontSizes.base,
    color: colors.surface,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeights.semibold,
  },
});