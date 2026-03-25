import React, { useState, useEffect } from 'react';
import './index.css';
import { evaluateTraining } from './engine/rules';
import type { SubjectiveInput, ObjectiveInput, UserContext, Recommendation, DailyReadiness } from './engine/models';
import { doc, getDoc } from 'firebase/firestore';
import { db, auth } from './firebase';
import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'firebase/auth';

type Phase = 'CHECK_AUTH' | 'LOGIN' | 'WELCOME' | 'SETTINGS' | 'QUESTIONNAIRE' | 'DASHBOARD';

function App() {
  const [phase, setPhase] = useState<Phase>('CHECK_AUTH');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  
  // Wizard State
  const [qIndex, setQIndex] = useState(0);
  const [subjective, setSubjective] = useState<SubjectiveInput>({
    readiness: 5,
    sleepQuality: 5,
    fatigue: 5,
    soreness: 5,
    stress: 5,
    motivation: 5,
    timeAvailable: 60,
    painFlag: false
  });

  const [constraints, setConstraints] = useState({
    hasCableMachine: false,
    hasFreeWeights: true,
    hasTreadmill: false,
    hasIndoorBike: true,
  });

  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);

  // Load constraints from LocalStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('adaptive_coach_constraints');
    if (saved) setConstraints(JSON.parse(saved));
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        if (phase === 'CHECK_AUTH' || phase === 'LOGIN') {
          setPhase('WELCOME');
        }
      } else {
        setPhase('LOGIN');
      }
    });
    return () => unsubscribe();
  }, [phase]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg("");
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e.message || "Failed to log in.");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  const saveConstraints = (newConstraints: typeof constraints) => {
    setConstraints(newConstraints);
    localStorage.setItem('adaptive_coach_constraints', JSON.stringify(newConstraints));
  };

  const questions = [
    { key: 'readiness', label: 'Overall Readiness', desc: 'How ready do you feel to crush it today?' },
    { key: 'sleepQuality', label: 'Sleep Quality (Subjective)', desc: 'How well rested do you feel regardless of what Garmin says?' },
    { key: 'fatigue', label: 'Physical Fatigue', desc: 'How heavy/tired does your body currently feel?' },
    { key: 'soreness', label: 'Muscle Soreness', desc: 'Current DOMS and stiffness level?' },
    { key: 'motivation', label: 'Mental Motivation', desc: 'How excited are you to train right now?' },
    { key: 'painFlag', label: 'Pain / Injury Risk', desc: 'Are you currently managing any acute pain? (Low = Good, High = Injured)', isBinary: true }
  ];

  const handleNext = () => {
    if (qIndex < questions.length - 1) {
      setQIndex(qIndex + 1);
    } else {
      generateRecommendation();
    }
  };

  const handleSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    const key = questions[qIndex].key;
    if (questions[qIndex].isBinary) {
       setSubjective({ ...subjective, painFlag: Number(e.target.value) > 5 });
    } else {
       setSubjective({ ...subjective, [key]: Number(e.target.value) });
    }
  };

  const generateRecommendation = async () => {
    setLoading(true);
    setErrorMsg("");
    
    try {
        // Build today's date string matching the Python script (YYYY-MM-DD)
        const todayIso = new Date().toISOString().split('T')[0];
        
        // Live Fetch from Firestore
        const docRef = doc(db, 'garmin_metrics', todayIso);
        const docSnap = await getDoc(docRef);
        
        let objective: ObjectiveInput;
        
        if (docSnap.exists()) {
            objective = docSnap.data() as ObjectiveInput;
        } else {
            console.warn("No Garmin data found for today, defaulting to an empty/conservative object for MVP.");
            objective = {
              total_steps: null, sleep_score: null, sleep_duration_min: null,
              rhr: null, rhr_7d_avg: null, rhr_delta: null, hrv_weekly_avg: null,
              hrv_last_night: null, hrv_delta: null, respiration: null, body_battery_wake: null,
              last_3_days_hard_sessions_count: 0, yesterday_training: null
            };
        }

        const mockContext: UserContext = {
          goals: { shortTerm: "Consistency", midTerm: "Base", longTerm: "Hybrid" },
          constraints: {
            ...constraints,
            injuries: [],
            maxTimeMinutes: subjective.timeAvailable
          }
        };

        const readiness: DailyReadiness = { subjective, objective };
        const rec = evaluateTraining(readiness, mockContext);
        
        setRecommendation(rec);
        setPhase('DASHBOARD');
    } catch (e: any) {
        console.error(e);
        setErrorMsg("Failed to connect to Firebase! Make sure you pasted your config inside app/src/firebase.ts");
    } finally {
        setLoading(false);
    }
  };

  return (
    <div className="glass-card question-transition" key={phase}>
      {phase === 'CHECK_AUTH' && (
        <div style={{ textAlign: 'center' }}>
          <p>Checking authentication...</p>
        </div>
      )}

      {phase === 'LOGIN' && (
        <form onSubmit={handleLogin} className="question-transition" style={{ textAlign: 'center' }}>
          <h1 style={{fontSize: '2.5rem', marginBottom: '1rem'}}>Secure Login</h1>
          <p style={{marginBottom: '2rem'}}>Access is restricted to authorized users.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '300px', margin: '0 auto' }}>
            <input 
               type="email" 
               placeholder="Email"
               value={email}
               onChange={(e) => setEmail(e.target.value)}
               required
               style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', background: 'rgba(0,0,0,0.3)', color: 'white', border: '1px solid rgba(255,255,255,0.1)' }}
            />
            <input 
               type="password" 
               placeholder="Password"
               value={password}
               onChange={(e) => setPassword(e.target.value)}
               required
               style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', background: 'rgba(0,0,0,0.3)', color: 'white', border: '1px solid rgba(255,255,255,0.1)' }}
            />
            {errorMsg && <p style={{color: '#f87171', fontSize: '0.875rem'}}>{errorMsg}</p>}
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Logging in...' : 'Log In'}
            </button>
          </div>
        </form>
      )}

      {phase === 'WELCOME' && (
        <div style={{ textAlign: 'center' }}>
          <h1 style={{fontSize: '2.5rem', marginBottom: '1rem'}}>Adaptive Coach</h1>
          <p style={{marginBottom: '2rem'}}>Let's drop the decision fatigue. Map out your perfect, adaptive training session for today.</p>
          <button className="btn-primary" onClick={() => setPhase('QUESTIONNAIRE')}>
            Start Daily Check-in
          </button>
          <button className="btn-secondary" style={{ marginTop: '1rem' }} onClick={() => setPhase('SETTINGS')}>
            Equipment Settings
          </button>
        </div>
      )}

      {phase === 'SETTINGS' && (
        <div className="question-transition">
          <h2>Equipment Constraints</h2>
          <p>Toggle what you have access to today. (Saved locally)</p>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', margin: '2rem 0' }}>
            {Object.entries(constraints).map(([key, val]) => (
              <label key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '12px', cursor: 'pointer' }}>
                <span style={{fontWeight: '500', textTransform: 'capitalize'}}>{key.replace(/has([A-Z])/g, ' $1')}</span>
                <input 
                   type="checkbox" 
                   checked={val} 
                   onChange={(e) => saveConstraints({...constraints, [key]: e.target.checked})} 
                   style={{ width: '24px', height: '24px' }}
                />
              </label>
             ))}
             
             <div style={{ background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '12px' }}>
                <span style={{fontWeight: '500', display: 'block', marginBottom: '0.5rem'}}>Minutes Available Today</span>
                <input 
                   type="number" 
                   value={subjective.timeAvailable} 
                   onChange={(e) => setSubjective({...subjective, timeAvailable: Number(e.target.value)})}
                   style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', background: 'rgba(0,0,0,0.3)', color: 'white', border: '1px solid rgba(255,255,255,0.1)', fontSize: '1rem' }}
                />
             </div>
          </div>

          <button className="btn-primary" onClick={() => setPhase('WELCOME')}>
            Save & Return
          </button>
          <div style={{marginTop: '2rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1rem'}}>
             <button className="btn-secondary" style={{ background: 'rgba(239, 68, 68, 0.2)' }} onClick={handleLogout}>
               Sign Out
             </button>
          </div>
        </div>
      )}

      {phase === 'QUESTIONNAIRE' && (
        <div className="question-transition" key={qIndex}>
          <p style={{ color: 'var(--primary-color)', fontWeight: 'bold', fontSize: '0.875rem', letterSpacing: '2px', textTransform: 'uppercase' }}>
            Question {qIndex + 1} of {questions.length}
          </p>
          <h2>{questions[qIndex].label}</h2>
          <p>{questions[qIndex].desc}</p>
          
          <div className="slider-container">
            <div className="slider-label">
              <span style={{opacity: 0.5}}>{questions[qIndex].isBinary ? 'Low (1)' : 'Low (1)'}</span>
              <span style={{opacity: 0.5}}>{questions[qIndex].isBinary ? 'Severe (10)' : 'High (10)'}</span>
            </div>
            <input 
              type="range" 
              min="1" 
              max="10" 
              value={questions[qIndex].isBinary ? (subjective.painFlag ? 10 : 1) : subjective[questions[qIndex].key as keyof SubjectiveInput] as number}
              onChange={handleSlider} 
            />
            <div style={{ textAlign: 'center', fontSize: '3.5rem', fontWeight: '800', margin: '1.5rem 0', color: 'var(--text-primary)' }}>
               {questions[qIndex].isBinary ? (subjective.painFlag ? 'YES' : 'NO') : subjective[questions[qIndex].key as keyof SubjectiveInput]}
            </div>
          </div>

          {errorMsg && <p style={{color: '#f87171', background: 'rgba(239, 68, 68, 0.1)', padding: '1rem', borderRadius: '8px'}}>{errorMsg}</p>}

          <button className="btn-primary" onClick={handleNext} disabled={loading}>
            {loading ? 'Syncing with Firestore...' : (qIndex === questions.length - 1 ? 'Get Recommendation' : 'Next')}
          </button>
        </div>
      )}

      {phase === 'DASHBOARD' && recommendation && (
        <div className="question-transition">
          <div className={`rec-tag tag-train`}>
            Recommended: {recommendation.template.category}
          </div>
          <h1>{recommendation.template.title}</h1>
          <p style={{fontSize: '1.125rem'}}>{recommendation.template.description}</p>
          
          <div style={{ padding: '1.5rem', background: 'rgba(255,255,255,0.03)', borderRadius: '16px', margin: '2rem 0', border: '1px solid rgba(255,255,255,0.05)' }}>
            <h3 style={{ margin: '0 0 0.5rem 0', color: 'var(--primary-color)', fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Rationale</h3>
            <p style={{ margin: 0, color: 'var(--text-primary)', fontStyle: 'italic' }}>"{recommendation.rationale}"</p>
          </div>
          
          <div style={{display: 'flex', gap: '1rem', marginTop: '1rem'}}>
             <div style={{flex: 1, padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '12px'}}>
                <span style={{display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase'}}>Duration</span>
                <span style={{fontWeight: 'bold'}}>{recommendation.template.durationMin} - {recommendation.template.durationMax} min</span>
             </div>
             <div style={{flex: 1, padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '12px'}}>
                <span style={{display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase'}}>Modality</span>
                <span style={{fontWeight: 'bold'}}>{recommendation.template.modality}</span>
             </div>
          </div>
          
          <button className="btn-secondary" style={{ marginTop: '2rem' }} onClick={() => { setQIndex(0); setPhase('WELCOME'); }}>
            Reset Check-in
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
