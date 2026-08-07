import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { getVisualScenario } from './fixtures';
import { installVisualServices } from './installVisualServices';
import { VisualReviewApp } from './VisualReviewApp';

const scenario = getVisualScenario(new URLSearchParams(window.location.search).get('scenario'));
installVisualServices(scenario.fixture);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <VisualReviewApp scenario={scenario} />
  </StrictMode>,
);
