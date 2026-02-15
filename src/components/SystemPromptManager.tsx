'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Search, 
  Plus, 
  Edit, 
  Trash2, 
  Check, 
  X, 
  Star, 
  StarOff, 
  Save,
  Eye,
  EyeOff,
  Settings,
  Loader2,
  Calendar,
  Copy
} from 'lucide-react';

interface SystemPrompt {
  id: number;
  name: string;
  prompt: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SystemPromptManagerProps {
  selectedPromptId?: number | null;
  onPromptSelect: (prompt: SystemPrompt) => void;
  onPromptChange?: (prompt: string) => void;
  currentPrompt?: string;
  isEmbedded?: boolean;
}

export default function SystemPromptManager({ 
  selectedPromptId, 
  onPromptSelect, 
  onPromptChange,
  currentPrompt,
  isEmbedded = false 
}: SystemPromptManagerProps) {
  const [prompts, setPrompts] = useState<SystemPrompt[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showManager, setShowManager] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Form states
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<SystemPrompt | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    prompt: '',
    isDefault: false
  });
  
  // Preview states
  const [expandedPromptId, setExpandedPromptId] = useState<number | null>(null);

  useEffect(() => {
    if (showManager || !isEmbedded) {
      fetchPrompts();
    }
  }, [showManager, isEmbedded]);

  const fetchPrompts = async (search?: string) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      
      const response = await fetch(`/api/system-prompts?${params}`);
      if (response.ok) {
        const data = await response.json();
        setPrompts(data);
        
        // Auto-select default prompt if no prompt is currently selected and prompts exist
        if (data.length > 0 && !selectedPromptId) {
          const defaultPrompt = data.find((p: SystemPrompt) => p.isDefault);
          if (defaultPrompt) {
            onPromptSelect(defaultPrompt);
          }
        }
      } else {
        throw new Error('Failed to fetch prompts');
      }
    } catch (err) {
      setError('Failed to load prompts');
      console.error('Error fetching prompts:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = useCallback((term: string) => {
    setSearchTerm(term);
    if (term.trim()) {
      fetchPrompts(term);
    } else {
      fetchPrompts();
    }
  }, []);

  const handleCreatePrompt = async () => {
    if (!formData.name.trim() || !formData.prompt.trim()) {
      setError('Name and prompt are required');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/system-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        const newPrompt = await response.json();
        await fetchPrompts();
        setFormData({ name: '', prompt: '', isDefault: false });
        setShowCreateForm(false);
        setSuccess('Prompt created successfully');
        
        // Auto-select the new prompt
        onPromptSelect(newPrompt);
      } else {
        const err = await response.json();
        throw new Error(err.error || 'Failed to create prompt');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdatePrompt = async () => {
    if (!editingPrompt || !formData.name.trim() || !formData.prompt.trim()) {
      setError('Name and prompt are required');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`/api/system-prompts/${editingPrompt.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        const updatedPrompt = await response.json();
        await fetchPrompts();
        setEditingPrompt(null);
        setFormData({ name: '', prompt: '', isDefault: false });
        setSuccess('Prompt updated successfully');
        
        // Update current prompt if it was selected
        if (selectedPromptId === editingPrompt.id) {
          onPromptSelect(updatedPrompt);
        }
      } else {
        const err = await response.json();
        throw new Error(err.error || 'Failed to update prompt');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeletePrompt = async (promptId: number) => {
    if (!confirm('Are you sure you want to delete this prompt?')) return;

    setIsLoading(true);
    try {
      const response = await fetch(`/api/system-prompts/${promptId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        await fetchPrompts();
        setSuccess('Prompt deleted successfully');
        
        // Clear selection if deleted prompt was selected
        if (selectedPromptId === promptId) {
          const defaultPrompt = prompts.find(p => p.isDefault && p.id !== promptId);
          if (defaultPrompt) {
            onPromptSelect(defaultPrompt);
          }
        }
      } else {
        const err = await response.json();
        throw new Error(err.error || 'Failed to delete prompt');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSetDefault = async (promptId: number) => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/system-prompts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: promptId, action: 'set-default' })
      });

      if (response.ok) {
        await fetchPrompts();
        setSuccess('Default prompt updated');
      } else {
        const err = await response.json();
        throw new Error(err.error || 'Failed to set default prompt');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditPrompt = (prompt: SystemPrompt) => {
    setEditingPrompt(prompt);
    setFormData({
      name: prompt.name,
      prompt: prompt.prompt,
      isDefault: prompt.isDefault
    });
    setShowCreateForm(true);
  };

  const handleCancelEdit = () => {
    setEditingPrompt(null);
    setFormData({ name: '', prompt: '', isDefault: false });
    setShowCreateForm(false);
  };

  const handleCopyPrompt = (prompt: SystemPrompt) => {
    navigator.clipboard.writeText(prompt.prompt);
    setSuccess('Prompt copied to clipboard');
  };

  const truncateText = (text: string, maxLength: number) => {
    return text.length > maxLength ? `${text.substring(0, maxLength)}...` : text;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const filteredPrompts = prompts.filter(prompt => 
    prompt.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    prompt.prompt.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selectedPrompt = prompts.find(p => p.id === selectedPromptId);

  // Clear messages after 3 seconds
  useEffect(() => {
    if (error || success) {
      const timer = setTimeout(() => {
        setError('');
        setSuccess('');
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [error, success]);

  // Load prompts when component mounts for embedded mode
  useEffect(() => {
    if (isEmbedded) {
      fetchPrompts();
    }
  }, [isEmbedded]);

  // Embedded view for use within other components
  if (isEmbedded) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-gray-700">
            System Prompt
          </label>
          <button
            onClick={() => setShowManager(true)}
            className="flex items-center space-x-1 text-sm text-blue-600 hover:text-blue-800"
          >
            <Settings size={16} />
            <span>Manage</span>
          </button>
        </div>

        {prompts.length > 0 ? (
          <div className="space-y-2">
            <select
              value={selectedPromptId || ''}
              onChange={(e) => {
                const value = e.target.value;
                if (value === 'clear') {
                  onPromptChange?.('');
                } else if (value) {
                  const prompt = prompts.find(p => p.id === parseInt(value));
                  if (prompt) {
                    onPromptSelect(prompt);
                  }
                }
              }}
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Select a saved prompt...</option>
              {prompts.map((prompt) => (
                <option key={prompt.id} value={prompt.id}>
                  {prompt.name} {prompt.isDefault ? '(Default)' : ''}
                </option>
              ))}
            </select>
            
            {selectedPrompt && (
              <div className="text-sm text-gray-700 p-4 bg-gray-50 border rounded-lg">
                <div className="font-medium text-gray-900 mb-2">
                  {selectedPrompt.name} {selectedPrompt.isDefault && <span className="text-yellow-600">(Default)</span>}
                </div>
                <div className="whitespace-pre-wrap text-gray-600 leading-relaxed">
                  {truncateText(selectedPrompt.prompt, 400)}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-6 px-4 bg-gray-50 border rounded-lg">
            <div className="text-gray-500 mb-3">
              <Settings size={32} className="mx-auto mb-2 text-gray-400" />
              <p className="text-sm">No saved prompts found</p>
            </div>
            <p className="text-xs text-gray-600 mb-4">
              Create and save your system prompts to quickly reuse them across different contexts.
            </p>
            <button
              onClick={() => setShowManager(true)}
              className="inline-flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
            >
              <Plus size={16} />
              <span>Add Your First Prompt</span>
            </button>
          </div>
        )}

        {showManager && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg w-full max-w-4xl max-h-[90vh] overflow-hidden">
              <SystemPromptManager
                selectedPromptId={selectedPromptId}
                onPromptSelect={onPromptSelect}
                onPromptChange={onPromptChange}
                currentPrompt={currentPrompt}
                isEmbedded={false}
              />
              <div className="p-4 border-t">
                <button
                  onClick={() => {
                    setShowManager(false);
                    window.location.reload();
                  }}
                  className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Full management interface
  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-gray-900">System Prompt Manager</h2>
        <button
          onClick={() => setShowCreateForm(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          <span>New Prompt</span>
        </button>
      </div>

      {/* Messages */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700">
          {success}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
        <input
          type="text"
          placeholder="Search prompts..."
          value={searchTerm}
          onChange={(e) => handleSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {/* Prompts List */}
      <div className="space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="animate-spin h-6 w-6 text-gray-400" />
            <span className="ml-2 text-gray-600">Loading prompts...</span>
          </div>
        ) : filteredPrompts.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {searchTerm ? 'No prompts found matching your search.' : 'No prompts found. Create your first prompt!'}
          </div>
        ) : (
          filteredPrompts.map((prompt) => (
            <div
              key={prompt.id}
              className={`border rounded-lg p-4 transition-all ${
                selectedPromptId === prompt.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-2">
                    <h3 className="font-medium text-gray-900">{prompt.name}</h3>
                    {prompt.isDefault && (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                        <Star size={12} className="mr-1" />
                        Default
                      </span>
                    )}
                    <span className="text-xs text-gray-500">
                      <Calendar size={12} className="inline mr-1" />
                      {formatDate(prompt.createdAt)}
                    </span>
                  </div>
                  
                  <div className="text-sm text-gray-600 mb-3">
                    {expandedPromptId === prompt.id ? (
                      <div className="whitespace-pre-wrap bg-gray-50 p-3 rounded border">
                        {prompt.prompt}
                      </div>
                    ) : (
                      truncateText(prompt.prompt, 150)
                    )}
                  </div>
                  
                  <div className="flex items-center space-x-2 text-sm">
                    <button
                      onClick={() => setExpandedPromptId(expandedPromptId === prompt.id ? null : prompt.id)}
                      className="flex items-center space-x-1 text-blue-600 hover:text-blue-800"
                    >
                      {expandedPromptId === prompt.id ? (
                        <><EyeOff size={14} /><span>Hide</span></>
                      ) : (
                        <><Eye size={14} /><span>Preview</span></>
                      )}
                    </button>
                    
                    <button
                      onClick={() => handleCopyPrompt(prompt)}
                      className="flex items-center space-x-1 text-gray-600 hover:text-gray-800"
                    >
                      <Copy size={14} />
                      <span>Copy</span>
                    </button>
                    
                    <button
                      onClick={() => onPromptSelect(prompt)}
                      className="flex items-center space-x-1 text-green-600 hover:text-green-800"
                    >
                      <Check size={14} />
                      <span>Use</span>
                    </button>
                  </div>
                </div>
                
                <div className="flex items-center space-x-2 ml-4">
                  {!prompt.isDefault && (
                    <button
                      onClick={() => handleSetDefault(prompt.id)}
                      className="p-1 text-gray-400 hover:text-yellow-600"
                      title="Set as default"
                    >
                      <StarOff size={16} />
                    </button>
                  )}
                  
                  <button
                    onClick={() => handleEditPrompt(prompt)}
                    className="p-1 text-gray-400 hover:text-blue-600"
                    title="Edit prompt"
                  >
                    <Edit size={16} />
                  </button>
                  
                  <button
                    onClick={() => handleDeletePrompt(prompt.id)}
                    className="p-1 text-gray-400 hover:text-red-600"
                    title="Delete prompt"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Create/Edit Form Modal */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-semibold">
                  {editingPrompt ? 'Edit Prompt' : 'Create New Prompt'}
                </h3>
                <button
                  onClick={handleCancelEdit}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Name
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Enter prompt name..."
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Prompt
                  </label>
                  <textarea
                    value={formData.prompt}
                    onChange={(e) => setFormData({ ...formData, prompt: e.target.value })}
                    placeholder="Enter your system prompt..."
                    rows={8}
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                  />
                </div>

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="isDefault"
                    checked={formData.isDefault}
                    onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                    className="h-4 w-4 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <label htmlFor="isDefault" className="ml-2 text-sm text-gray-700">
                    Set as default prompt
                  </label>
                </div>

                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    onClick={handleCancelEdit}
                    className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={editingPrompt ? handleUpdatePrompt : handleCreatePrompt}
                    disabled={isLoading}
                    className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                  >
                    {isLoading ? (
                      <Loader2 className="animate-spin" size={16} />
                    ) : (
                      <Save size={16} />
                    )}
                    <span>{editingPrompt ? 'Update' : 'Create'}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 