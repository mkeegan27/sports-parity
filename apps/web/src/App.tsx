import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { LeagueView } from './routes/LeagueView';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/nfl" replace />} />
        <Route path="/:league/:season?/:week?" element={<LeagueView />} />
        <Route path="*" element={<Navigate to="/nfl" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
