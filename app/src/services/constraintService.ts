import { doc, setDoc, deleteDoc, collection, query, where, orderBy, getDocs, limit } from 'firebase/firestore';
import { db } from '../firebase';
import type { UserConstraint, ConstraintCategory } from '../engine/models';
import { validateConstraint } from '../engine/validation';

// Predefined constraints with stable keys
export const PREDEFINED_CONSTRAINTS = {
    // Equipment constraints
    'has_free_weights': {
        key: 'has_free_weights',
        type: 'boolean' as const,
        value: false,
        severity: 'hard' as const,
        category: 'equipment' as const,
        displayName: 'Free Weights Available',
        description: 'Access to dumbbells, barbells, or kettlebells'
    },
    'has_cable_machine': {
        key: 'has_cable_machine',
        type: 'boolean' as const,
        value: false,
        severity: 'hard' as const,
        category: 'equipment' as const,
        displayName: 'Cable Machine Available',
        description: 'Access to a cable machine for strength exercises'
    },
    'no_cable_machine': {
        key: 'no_cable_machine',
        type: 'boolean' as const,
        value: false,
        severity: 'hard' as const,
        category: 'equipment' as const,
        displayName: 'No Cable Machine',
        description: 'Cable machine is not available'
    },
    'has_treadmill': {
        key: 'has_treadmill',
        type: 'boolean' as const,
        value: false,
        severity: 'hard' as const,
        category: 'equipment' as const,
        displayName: 'Treadmill Available',
        description: 'Access to a treadmill for running/walking'
    },
    'has_stationary_bike': {
        key: 'has_stationary_bike',
        type: 'boolean' as const,
        value: false,
        severity: 'hard' as const,
        category: 'equipment' as const,
        displayName: 'Stationary Bike Available',
        description: 'Access to a stationary bike'
    },
    'has_pull_up_bar': {
        key: 'has_pull_up_bar',
        type: 'boolean' as const,
        value: false,
        severity: 'hard' as const,
        category: 'equipment' as const,
        displayName: 'Pull-up Bar Available',
        description: 'Access to a pull-up bar'
    },
    
    // Physical caution constraints
    'lower_body_caution': {
        key: 'lower_body_caution',
        type: 'boolean' as const,
        value: false,
        severity: 'hard' as const,
        category: 'physical_caution' as const,
        displayName: 'Lower Body Caution',
        description: 'Avoid heavy lower body exercises or high impact'
    },
    'knee_issues': {
        key: 'knee_issues',
        type: 'boolean' as const,
        value: false,
        severity: 'hard' as const,
        category: 'physical_caution' as const,
        displayName: 'Knee Issues',
        description: 'Avoid high-impact exercises that stress the knees'
    },
    'back_issues': {
        key: 'back_issues',
        type: 'boolean' as const,
        value: false,
        severity: 'hard' as const,
        category: 'physical_caution' as const,
        displayName: 'Back Issues',
        description: 'Avoid exercises that strain the lower back'
    },
    'shoulder_issues': {
        key: 'shoulder_issues',
        type: 'boolean' as const,
        value: false,
        severity: 'hard' as const,
        category: 'physical_caution' as const,
        displayName: 'Shoulder Issues',
        description: 'Avoid overhead pressing movements'
    },
    
    // Schedule constraints
    'max_45_min_weekday': {
        key: 'max_45_min_weekday',
        type: 'boolean' as const,
        value: false,
        severity: 'hard' as const,
        category: 'schedule' as const,
        displayName: 'Max 45 min on Weekdays',
        description: 'Weekday workouts limited to 45 minutes maximum'
    },
    'max_60_min_weekday': {
        key: 'max_60_min_weekday',
        type: 'boolean' as const,
        value: false,
        severity: 'hard' as const,
        category: 'schedule' as const,
        displayName: 'Max 60 min on Weekdays',
        description: 'Weekday workouts limited to 60 minutes maximum'
    },
    'max_time_minutes': {
        key: 'max_time_minutes',
        type: 'number' as const,
        value: 60,
        severity: 'hard' as const,
        category: 'schedule' as const,
        displayName: 'Maximum Session Time',
        description: 'Maximum time available for a single session'
    },
    'prefer_morning': {
        key: 'prefer_morning',
        type: 'boolean' as const,
        value: false,
        severity: 'soft' as const,
        category: 'schedule' as const,
        displayName: 'Prefer Morning Workouts',
        description: 'Prefer to schedule workouts in the morning'
    },
    
    // Environment constraints
    'indoor_only': {
        key: 'indoor_only',
        type: 'boolean' as const,
        value: false,
        severity: 'hard' as const,
        category: 'environment' as const,
        displayName: 'Indoor Only',
        description: 'Only indoor exercise options available'
    },
    'outdoor_only': {
        key: 'outdoor_only',
        type: 'boolean' as const,
        value: false,
        severity: 'hard' as const,
        category: 'environment' as const,
        displayName: 'Outdoor Only',
        description: 'Only outdoor exercise options available'
    },
    
    // Recovery preferences
    'prefer_active_recovery': {
        key: 'prefer_active_recovery',
        type: 'boolean' as const,
        value: false,
        severity: 'soft' as const,
        category: 'schedule' as const,
        displayName: 'Prefer Active Recovery Over Rest',
        description: 'Choose light activity over complete rest on recovery days'
    }
};

export class ConstraintService {
    private readonly collectionPath = 'constraints';

    /**
     * List all constraints for a user
     */
    async listConstraints(userId: string): Promise<UserConstraint[]> {
        try {
            const collRef = collection(db, 'users', userId, this.collectionPath);
            const q = query(
                collRef,
                where('userId', '==', userId),
                orderBy('category', 'asc'),
                orderBy('displayName', 'asc')
            );
            
            const querySnapshot = await getDocs(q);
            return querySnapshot.docs.map(doc => doc.data() as UserConstraint);
        } catch (error) {
            console.error('Error listing constraints:', error);
            throw error;
        }
    }

    /**
     * Get active constraints only
     */
    async getActiveConstraints(userId: string): Promise<UserConstraint[]> {
        try {
            const collRef = collection(db, 'users', userId, this.collectionPath);
            const q = query(
                collRef,
                where('isActive', '==', true)
            );
            
            const querySnapshot = await getDocs(q);
            const constraints = querySnapshot.docs.map(doc => doc.data() as UserConstraint);

            return constraints.sort((a, b) => {
                if (a.severity !== b.severity) {
                    return a.severity === 'hard' ? -1 : 1;
                }

                return a.category.localeCompare(b.category);
            });
        } catch (error: any) {
            if (error.message && error.message.includes('Missing or insufficient permissions')) {
                console.warn('Permission denied accessing constraints. Using default constraints.');
                return [];
            }
            console.error('Error fetching active constraints:', error);
            throw error;
        }
    }

    /**
     * Get constraints by category
     */
    async getConstraintsByCategory(userId: string, category: ConstraintCategory): Promise<UserConstraint[]> {
        try {
            const collRef = collection(db, 'users', userId, this.collectionPath);
            const q = query(
                collRef,
                where('userId', '==', userId),
                where('category', '==', category),
                orderBy('displayName', 'asc')
            );
            
            const querySnapshot = await getDocs(q);
            return querySnapshot.docs.map(doc => doc.data() as UserConstraint);
        } catch (error) {
            console.error('Error fetching constraints by category:', error);
            throw error;
        }
    }

    /**
     * Get a specific constraint by key
     */
    async getConstraintByKey(userId: string, key: string): Promise<UserConstraint | null> {
        try {
            const collRef = collection(db, 'users', userId, this.collectionPath);
            const q = query(
                collRef,
                where('userId', '==', userId),
                where('key', '==', key),
                limit(1)
            );
            
            const querySnapshot = await getDocs(q);
            if (querySnapshot.empty) {
                return null;
            }
            
            return querySnapshot.docs[0].data() as UserConstraint;
        } catch (error) {
            console.error('Error fetching constraint by key:', error);
            throw error;
        }
    }

    /**
     * Upsert a constraint (create or update)
     * For predefined constraints, uses the key as document ID
     * For custom constraints, generates a new ID
     */
    async upsertConstraint(userId: string, constraintData: Omit<UserConstraint, 'userId' | 'createdAt' | 'updatedAt'>): Promise<UserConstraint> {
        try {
            // Prepare data for validation
            const rawData = {
                userId,
                ...constraintData
            };

            // Validate the data
            const validation = validateConstraint(rawData);
            if (!validation.isValid) {
                const errorMessages = validation.errors.map(e => `${e.field}: ${e.message}`).join('; ');
                throw new Error(`Validation failed: ${errorMessages}`);
            }

            const validatedConstraint = validation.data!;
            
            // Determine document ID
            const isPredefined = Object.keys(PREDEFINED_CONSTRAINTS).includes(validatedConstraint.key);
            const docId = isPredefined ? validatedConstraint.key : validatedConstraint.key;
            
            // Save to Firestore
            const docRef = doc(db, 'users', userId, this.collectionPath, docId);
            await setDoc(docRef, validatedConstraint, { merge: true });

            return validatedConstraint;
        } catch (error) {
            console.error('Error upserting constraint:', error);
            throw error;
        }
    }

    /**
     * Toggle a constraint's active status
     */
    async toggleConstraint(userId: string, constraintKey: string, isActive: boolean): Promise<UserConstraint> {
        try {
            // Get existing constraint
            const existingConstraint = await this.getConstraintByKey(userId, constraintKey);
            
            if (!existingConstraint) {
                // If it's a predefined constraint, create it first
                if (PREDEFINED_CONSTRAINTS[constraintKey as keyof typeof PREDEFINED_CONSTRAINTS]) {
                    const predefined = PREDEFINED_CONSTRAINTS[constraintKey as keyof typeof PREDEFINED_CONSTRAINTS];
                    return this.upsertConstraint(userId, {
                        ...predefined,
                        isActive
                    });
                }
                throw new Error('Constraint not found');
            }

            return this.updateConstraint(userId, constraintKey, { isActive });
        } catch (error) {
            console.error('Error toggling constraint:', error);
            throw error;
        }
    }

    /**
     * Update an existing constraint
     */
    async updateConstraint(userId: string, constraintKey: string, updates: Partial<UserConstraint>): Promise<UserConstraint> {
        try {
            // Get existing constraint
            const existingConstraint = await this.getConstraintByKey(userId, constraintKey);
            if (!existingConstraint) {
                throw new Error('Constraint not found');
            }

            // Merge with updates
            const updatedData = {
                ...existingConstraint,
                ...updates,
                updatedAt: new Date().toISOString()
            };

            // Validate the updated data
            const validation = validateConstraint(updatedData);
            if (!validation.isValid) {
                const errorMessages = validation.errors.map(e => `${e.field}: ${e.message}`).join('; ');
                throw new Error(`Validation failed: ${errorMessages}`);
            }

            const validatedConstraint = validation.data!;
            
            // Save to Firestore
            const docId = constraintKey;
            const docRef = doc(db, 'users', userId, this.collectionPath, docId);
            await setDoc(docRef, validatedConstraint, { merge: true });

            return validatedConstraint;
        } catch (error) {
            console.error('Error updating constraint:', error);
            throw error;
        }
    }

    /**
     * Delete a constraint
     */
    async deleteConstraint(userId: string, constraintKey: string): Promise<void> {
        try {
            const docRef = doc(db, 'users', userId, this.collectionPath, constraintKey);
            await deleteDoc(docRef);
        } catch (error) {
            console.error('Error deleting constraint:', error);
            throw error;
        }
    }

    /**
     * Initialize predefined constraints for a new user
     */
    async initializePredefinedConstraints(userId: string): Promise<UserConstraint[]> {
        try {
            const constraints: UserConstraint[] = [];
            
            for (const [, template] of Object.entries(PREDEFINED_CONSTRAINTS)) {
                const constraint = await this.upsertConstraint(userId, {
                    ...template,
                    isActive: false // Default to inactive
                });
                constraints.push(constraint);
            }
            
            return constraints;
        } catch (error) {
            console.error('Error initializing predefined constraints:', error);
            throw error;
        }
    }

    /**
     * Create a custom constraint
     */
    async createCustomConstraint(
        userId: string, 
        constraintData: Omit<UserConstraint, 'userId' | 'key' | 'createdAt' | 'updatedAt'>
    ): Promise<UserConstraint> {
        try {
            // Generate a unique key for custom constraints
            const customKey = `custom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            return this.upsertConstraint(userId, {
                ...constraintData,
                key: customKey,
                category: 'custom'
            });
        } catch (error) {
            console.error('Error creating custom constraint:', error);
            throw error;
        }
    }

    /**
     * Get constraints by severity
     */
    async getConstraintsBySeverity(userId: string, severity: 'hard' | 'soft'): Promise<UserConstraint[]> {
        try {
            const collRef = collection(db, 'users', userId, this.collectionPath);
            const q = query(
                collRef,
                where('userId', '==', userId),
                where('severity', '==', severity),
                where('isActive', '==', true),
                orderBy('category', 'asc')
            );
            
            const querySnapshot = await getDocs(q);
            return querySnapshot.docs.map(doc => doc.data() as UserConstraint);
        } catch (error) {
            console.error('Error fetching constraints by severity:', error);
            throw error;
        }
    }

    /**
     * Get constraint summary for dashboard
     */
    async getConstraintSummary(userId: string): Promise<{
        total: number;
        active: number;
        hard: number;
        soft: number;
        byCategory: Record<ConstraintCategory, number>;
    }> {
        try {
            const constraints = await this.listConstraints(userId);
            
            const summary = {
                total: constraints.length,
                active: 0,
                hard: 0,
                soft: 0,
                byCategory: {
                    equipment: 0,
                    physical_caution: 0,
                    schedule: 0,
                    environment: 0,
                    custom: 0
                } as Record<ConstraintCategory, number>
            };

            constraints.forEach(constraint => {
                if (constraint.isActive) {
                    summary.active++;
                    
                    if (constraint.severity === 'hard') {
                        summary.hard++;
                    } else {
                        summary.soft++;
                    }
                }
                
                summary.byCategory[constraint.category]++;
            });

            return summary;
        } catch (error) {
            console.error('Error calculating constraint summary:', error);
            throw error;
        }
    }
}

// Export singleton instance
export const constraintService = new ConstraintService();
