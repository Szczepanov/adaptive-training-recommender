import React, { createContext, useContext, useState, useEffect } from 'react';
import { getAuthInstance } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { preferencesService } from '../services/preferencesService';
import { trainingSettingsService } from '../services/trainingSettingsService';

type AuthPhase = 'CHECKING' | 'LOGIN' | 'AUTHENTICATED';

interface AuthContextType {
  userId: string | null;
  authPhase: AuthPhase;
  user: User | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [userId, setUserId] = useState<string | null>(null);
  const [authPhase, setAuthPhase] = useState<AuthPhase>('CHECKING');
  const [user, setUser] = useState<User | null>(null);

  // Initialize user data on first login
  const initializeUserData = async (uid: string) => {
    try {
      // Check if preferences exist, if not create defaults
      const prefs = await preferencesService.getPreferences(uid);
      if (!prefs) {
        await preferencesService.createDefaultPreferences(uid);
        console.log('Created default preferences for user');
      }

      // Creates the typed profile for new users or safely migrates legacy constraints.
      await trainingSettingsService.getTrainingSettings(uid);

    } catch (error) {
      console.error('Error initializing user data:', error);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getAuthInstance(), async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        setUserId(firebaseUser.uid);
        setAuthPhase('AUTHENTICATED');
        // Initialize user data in the background
        initializeUserData(firebaseUser.uid);
      } else {
        setUserId(null);
        setAuthPhase('LOGIN');
      }
    });
    return () => unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ userId, authPhase, user }}>
      {children}
    </AuthContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
