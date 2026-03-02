'use client';

import { Bell, Search, Plus, User, LogOut, Shield } from 'lucide-react';
import { ThemeToggle } from '@/components/ui/ThemeProvider';

interface TopbarProps {
  activeView: string;
  onViewChange: (view: string) => void;
  onLogout?: () => void;
  onSearchClick?: () => void;
}

const VIEW_TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  calendar: 'Content Planner',
  discovery: 'Topic Discovery',
  analytics: 'Analytics',
  drafts: 'Draft Manager',
  ops: 'Ops Center',
  accounts: 'Accounts',
  settings: 'Settings',
};

export default function Topbar({ activeView, onViewChange, onLogout, onSearchClick }: TopbarProps) {
  const title = VIEW_TITLES[activeView] || 'X Manager';
  const quickAction = activeView === 'calendar'
    ? {
      label: 'Ops Center',
      icon: <Shield size={16} />,
      onClick: () => onViewChange('ops'),
    }
    : {
      label: 'New Post',
      icon: <Plus size={16} />,
      onClick: () => onViewChange('calendar'),
    };

  return (
    <div className="h-16 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-700 flex items-center justify-between px-6 fixed top-0 left-16 right-0 z-40">
      <div className="flex items-center gap-4 w-full max-w-xl">
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 hidden sm:block">{title}</h1>
      </div>

      <div className="flex items-center gap-4">
        <button onClick={quickAction.onClick} className="btn-primary flex items-center gap-2">
          {quickAction.icon}
          <span className="hidden sm:inline">{quickAction.label}</span>
        </button>

        <div className="h-8 w-[1px] bg-slate-200 dark:bg-slate-700 mx-2"></div>

        <button className="text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-2" onClick={onSearchClick}>
          <Search size={20} />
        </button>
        <ThemeToggle />
        <button className="text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-2 relative">
          <Bell size={20} />
          <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border border-white dark:border-slate-900"></span>
        </button>

        <div className="flex items-center gap-3 ml-2 pl-2 border-l border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={onLogout}
            className="text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-2"
            title="Logout"
            aria-label="Logout"
          >
            <LogOut size={18} />
          </button>
          <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600">
            <User size={18} />
          </div>
        </div>
      </div>
    </div>
  );
}
