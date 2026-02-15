'use client';

import { useState, useEffect, useCallback } from 'react';
import TwitterConnector from './TwitterConnector';
import Scheduler from './Scheduler';
import { Loader2, Calendar, Hash, FileInput } from 'lucide-react';
import AddContext from './AddContext';
import TopicDiscovery from './TopicDiscovery';
import CsvImporter from './CsvImporter';
import ReadinessPanel from './ReadinessPanel';
import SetupPanel from './SetupPanel';
import CreateThreadFromArticle from './CreateThreadFromArticle';

interface TwitterUser {
  id: number | null;
  slot: number;
  connected: boolean;
  twitterUsername: string | null;
  twitterDisplayName: string | null;
}

export default function MainDashboard() {
  const [accounts, setAccounts] = useState<TwitterUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [schedulerRefresh, setSchedulerRefresh] = useState(0);
  const [readinessRefresh, setReadinessRefresh] = useState(0);

  const fetchUser = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/user');
      if (response.ok) {
        const data = await response.json();
        setAccounts(Array.isArray(data.accounts) ? data.accounts : []);
      } else {
        setAccounts([]);
      }
    } catch (error) {
      console.error('Error fetching user:', error);
      setAccounts([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const handleProfileUpdate = useCallback(() => {
    fetchUser();
  }, [fetchUser]);

  const handleSchedulerRefresh = useCallback(() => {
    setSchedulerRefresh(prev => prev + 1);
  }, []);

  const handleSetupSaved = useCallback(() => {
    setReadinessRefresh((prev) => prev + 1);
  }, []);

  const handleConnectionChange = useCallback(() => {
    setReadinessRefresh((prev) => prev + 1);
    fetchUser();
  }, [fetchUser]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-100px)]">
        <Loader2 className="animate-spin h-8 w-8 text-teal-600" />
      </div>
    );
  }

  const hasConnectedAccount = accounts.some((account) => account.connected);

  return (
    <div className="space-y-6">
      {/* Top Status Area */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="col-span-1 md:col-span-2">
           <TwitterConnector onConnectionChange={handleConnectionChange} />
        </div>
        <div className="col-span-1">
           <ReadinessPanel refreshTrigger={readinessRefresh} />
        </div>
      </div>
      
      <div className="hidden">
         <SetupPanel onSaved={handleSetupSaved} />
      </div>

      {hasConnectedAccount ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-280px)] min-h-[600px]">
          
          {/* Column 1: Scheduler */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm flex flex-col overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
              <Calendar size={18} className="text-teal-600" />
              <h3 className="font-semibold text-slate-700">Scheduled Streams</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
              <Scheduler onUpdate={handleProfileUpdate} refreshTrigger={schedulerRefresh} compact={true} />
            </div>
          </div>

          {/* Column 2: Discovery */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm flex flex-col overflow-hidden">
             <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
              <Hash size={18} className="text-teal-600" />
              <h3 className="font-semibold text-slate-700">Topic Discovery</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
              <TopicDiscovery />
            </div>
          </div>

          {/* Column 3: Tools */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm flex flex-col overflow-hidden">
             <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
              <FileInput size={18} className="text-teal-600" />
              <h3 className="font-semibold text-slate-700">Import & Context</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
              <CreateThreadFromArticle onScheduled={handleSchedulerRefresh} />
              <div className="border-t border-slate-100 pt-6">
                <CsvImporter onImported={handleSchedulerRefresh} />
              </div>
              <div className="border-t border-slate-100 pt-6">
                <AddContext onSchedulerRefresh={handleSchedulerRefresh} />
              </div>
            </div>
          </div>

        </div>
      ) : (
        <div className="bg-white rounded-lg border border-slate-200 p-12 text-center shadow-sm">
          <div className="max-w-md mx-auto">
            <h3 className="text-lg font-medium text-slate-900 mb-2">Welcome to X Manager</h3>
            <p className="text-slate-500 mb-6">Connect at least one X account slot above to access your professional dashboard.</p>
          </div>
        </div>
      )}
    </div>
  );
}
 
