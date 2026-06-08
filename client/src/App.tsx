import { useState } from 'react';
import Sidebar from './components/layout/Sidebar';
import Header from './components/layout/Header';
import Dashboard from './pages/Dashboard';
import SalesPerformance from './pages/SalesPerformance';
import StockAlerts from './pages/StockAlerts';
import TurnoverAnalysis from './pages/TurnoverAnalysis';
import Reports from './pages/Reports';
import DailyReport from './pages/DailyReport';
import DailyStock from './pages/DailyStock';
import StockComparison from './pages/StockComparison';
import type { Page } from './types';

export default function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [stockFilter, setStockFilter] = useState<string | undefined>();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navigate = (p: Page, filter?: string) => {
    setPage(p);
    if (filter) setStockFilter(filter);
    setSidebarOpen(false); // sayfaya gidince kapat
  };

  return (
    <div className="flex min-h-screen">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar
        current={page}
        onChange={p => { setPage(p); setSidebarOpen(false); }}
        isOpen={sidebarOpen}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <Header
          page={page}
          lastUpdate={new Date().toLocaleString('tr-TR')}
          onMenuClick={() => setSidebarOpen(o => !o)}
        />
        <main className="flex-1 overflow-auto bg-sand">
          {page === 'dashboard'     && <Dashboard onNavigate={navigate} />}
          {page === 'daily-report'  && <DailyReport />}
          {page === 'sales'         && <SalesPerformance />}
          {page === 'stock-alerts'  && <StockAlerts initialFilter={stockFilter} />}
          {page === 'daily-stock'      && <DailyStock />}
          {page === 'stock-comparison' && <StockComparison />}
          {page === 'turnover'      && <TurnoverAnalysis />}
          {page === 'reports'       && <Reports />}
        </main>
      </div>
    </div>
  );
}
