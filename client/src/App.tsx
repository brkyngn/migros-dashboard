import { useState } from 'react';
import Sidebar from './components/layout/Sidebar';
import Header from './components/layout/Header';
import Dashboard from './pages/Dashboard';
import SalesPerformance from './pages/SalesPerformance';
import StockAlerts from './pages/StockAlerts';
import TurnoverAnalysis from './pages/TurnoverAnalysis';
import Reports from './pages/Reports';
import DailyReport from './pages/DailyReport';
import type { Page } from './types';

export default function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [stockFilter, setStockFilter] = useState<string | undefined>();

  const navigate = (p: Page, filter?: string) => {
    setPage(p);
    if (filter) setStockFilter(filter);
  };

  return (
    <div className="flex min-h-screen">
      <Sidebar current={page} onChange={p => setPage(p)} />
      <div className="flex-1 flex flex-col min-w-0">
        <Header page={page} lastUpdate={new Date().toLocaleString('tr-TR')} />
        <main className="flex-1 overflow-auto bg-sand">
          {page === 'dashboard'     && <Dashboard onNavigate={navigate} />}
          {page === 'daily-report'  && <DailyReport />}
          {page === 'sales'         && <SalesPerformance />}
          {page === 'stock-alerts'  && <StockAlerts initialFilter={stockFilter} />}
          {page === 'turnover'      && <TurnoverAnalysis />}
          {page === 'reports'       && <Reports />}
        </main>
      </div>
    </div>
  );
}
