// Test Firebase connection
import { auth } from './firebase';
import { signInWithEmailAndPassword } from 'firebase/auth';

// Extend Window interface to include our test function
declare global {
  interface Window {
    testFirebase: () => Promise<boolean>;
  }
}

// Test credentials (you'll need to create a user in Firebase Auth first)
const testEmail = 'test@example.com';
const testPassword = 'test123456';

async function testConnection() {
  try {
    console.log('Testing Firebase connection...');
    const userCredential = await signInWithEmailAndPassword(auth, testEmail, testPassword);
    console.log('Successfully logged in:', userCredential.user.uid);
    return true;
  } catch (error: any) {
    console.error('Firebase connection error:', error.message);
    return false;
  }
}

// Run test if in browser
if (typeof window !== 'undefined') {
  window.testFirebase = testConnection;
  console.log('Test function available at window.testFirebase()');
}
