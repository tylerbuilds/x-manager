'use client';

import { Home, Calendar, Compass, Settings, Users, LogOut, Workflow } from 'lucide-react';

interface SidebarProps {
  activeView: string;
  onViewChange: (view: string) => void;
  onLogout?: () => void;
}

export default function Sidebar({ activeView, onViewChange, onLogout }: SidebarProps) {
  return (
    <div className="fixed left-0 top-0 bottom-0 w-16 bg-slate-950/95 backdrop-blur-md border-r border-slate-800 flex flex-col items-center py-6 z-50">
      <div className="mb-8">
        <div className="w-10 h-10 bg-gradient-to-br from-cyan-500 via-teal-500 to-emerald-500 rounded-lg flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-cyan-900/40">
          X
        </div>
      </div>
      
      <nav className="flex-1 space-y-4 w-full px-2">
        <NavItem 
          icon={<Home size={22} />} 
          label="Dashboard" 
          active={activeView === 'dashboard'} 
          onClick={() => onViewChange('dashboard')} 
        />
        <NavItem 
          icon={<Calendar size={22} />} 
          label="Calendar" 
          active={activeView === 'calendar'} 
          onClick={() => onViewChange('calendar')} 
        />
        <NavItem 
          icon={<Compass size={22} />} 
          label="Discovery" 
          active={activeView === 'discovery'} 
          onClick={() => onViewChange('discovery')} 
        />
        <NavItem
          icon={<Workflow size={22} />}
          label="Ops"
          active={activeView === 'ops'}
          onClick={() => onViewChange('ops')}
        />
        <NavItem 
          icon={<Users size={22} />} 
          label="Accounts" 
          active={activeView === 'accounts'} 
          onClick={() => onViewChange('accounts')} 
        />
        <NavItem 
          icon={<Settings size={22} />} 
          label="Settings" 
          active={activeView === 'settings'} 
          onClick={() => onViewChange('settings')} 
        />
      </nav>

      <div className="mt-auto pb-4">
         <NavItem icon={<LogOut size={22} />} label="Logout" onClick={onLogout} />
      </div>
    </div>
  );
}

function NavItem({ icon, label, active = false, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick?: () => void }) {
  return (
    <div 
      onClick={onClick}
      className={`
      relative group flex items-center justify-center w-12 h-12 rounded-xl cursor-pointer transition-all
      ${active ? 'bg-slate-800 text-teal-400' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}
    `}>
      {icon}
      <div className="absolute left-14 bg-slate-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
        {label}
      </div>
    </div>
  );
}
