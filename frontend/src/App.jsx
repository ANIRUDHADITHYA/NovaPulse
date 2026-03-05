import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Login from './components/Login';
import PrivateRoute from './components/PrivateRoute';
import Dashboard from './components/Dashboard';
import Portfolio from './components/Portfolio';
import ErrorBoundary from './components/ErrorBoundary';

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <PrivateRoute>
                <Dashboard />
              </PrivateRoute>
            }
          />
          <Route
            path="/portfolio"
            element={
              <PrivateRoute>
                <Portfolio />
              </PrivateRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
