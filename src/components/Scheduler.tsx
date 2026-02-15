'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Calendar, Plus, Edit, Trash2, Send, Smile, ImageIcon, X, Save, Tag, Clock3, CheckCircle, XCircle, RefreshCw, Loader2, Sparkles, ChevronLeft, ChevronRight, List } from 'lucide-react';
import { MdOutlineGifBox } from "react-icons/md";
import EmojiPicker, { EmojiClickData, EmojiStyle, Theme } from 'emoji-picker-react';
import { GiphyFetch } from '@giphy/js-fetch-api';
import { Grid } from '@giphy/react-components';
import type { IGif } from '@giphy/js-types';
import { debugLog } from '@/lib/debug';

// Add Giphy API instance
const gf = new GiphyFetch(process.env.NEXT_PUBLIC_GIPHY_API_KEY || '__REMOVED__');

interface ScheduledPost {
  id: string;
  accountSlot?: number;
  text: string;
  media_ids: string[];
  mediaUrls?: string | null;
  communityId?: string;
  replyToTweetId?: string | null;
  scheduledTime: string;
  status: 'scheduled' | 'posted' | 'failed' | 'cancelled';
  twitterPostId?: string | null;
  twitter_post_id?: string;
  errorMessage?: string;
  metrics?: {
    impressions: number;
    likes: number;
    retweets: number;
    replies: number;
    quotes: number;
    bookmarks: number;
  } | null;
  createdAt: string;
  updatedAt: string;
}

interface CommunityTag {
  id: string;
  tagName: string;
  communityId: string;
  communityName?: string;
  createdAt: string;
  updatedAt: string;
}

type CalendarViewMode = 'day' | 'week' | 'month' | 'queue';

interface QueueItem {
  id: number;
  accountSlot: number;
  text: string;
  mediaUrls: string | null;
  communityId: string | null;
  position: number;
  status: string;
  scheduledPostId: number | null;
  createdAt: string;
  updatedAt: string;
}

interface SchedulerProps {
  onUpdate?: () => void;
  refreshTrigger?: number;
  compact?: boolean;
}

// Helper function to get the start of the week (Monday)
const getWeekStart = (date: Date) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
  return new Date(d.setDate(diff));
};

// Helper function to get the start of the week from today
const getWeekStartFromToday = (date: Date) => {
  const today = new Date();
  const d = new Date(date);
  
  // If the provided date is today or in the future, start from today
  // Otherwise, start from the provided date
  const startDate = d >= today ? today : d;
  
  return new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
};

// Helper functions for datetime-local input
const formatDateTimeForInput = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const parseDateTimeInput = (value: string) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const isDateTimeInPast = (value: string) => {
  const parsed = parseDateTimeInput(value);
  if (!parsed) return false;
  return parsed < new Date();
};

// Helper function to format date for display
const formatDateForDisplay = (date: Date) => {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
};

// Helper function to format time for display
const formatTimeForDisplay = (dateString: string) => {
  return new Date(dateString).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit'
  });
};

const getMediaCount = (post: ScheduledPost) => {
  if (Array.isArray(post.media_ids) && post.media_ids.length > 0) {
    return post.media_ids.length;
  }

  if (!post.mediaUrls) {
    return 0;
  }

  try {
    const parsed = JSON.parse(post.mediaUrls);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
};

export default function Scheduler({ onUpdate, refreshTrigger, compact = false }: SchedulerProps) {
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPost[]>([]);
  const [communityTags, setCommunityTags] = useState<CommunityTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [viewMode, setViewMode] = useState<CalendarViewMode>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [draggedPostId, setDraggedPostId] = useState<string | null>(null);
  const [selectedDateTime, setSelectedDateTime] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingPost, setEditingPost] = useState<ScheduledPost | null>(null);
  const [showManageTags, setShowManageTags] = useState(false);
  const [visibleSlots, setVisibleSlots] = useState<number[]>([1, 2]);
  
  // Queue states
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [queueText, setQueueText] = useState('');
  const [queueSlot, setQueueSlot] = useState(1);
  const [isAutoScheduling, setIsAutoScheduling] = useState(false);

  // Search and bulk states
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedPostIds, setSelectedPostIds] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState(false);

  // Form states
  const [postText, setPostText] = useState('');
  const [selectedCommunityTag, setSelectedCommunityTag] = useState('');
  const [replyToTweetId, setReplyToTweetId] = useState('');
  const [selectedAccountSlot, setSelectedAccountSlot] = useState(1);
  const [attachedImages, setAttachedImages] = useState<File[]>([]);
  const [attachedGifs, setAttachedGifs] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // UI states
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [gifSearchTerm, setGifSearchTerm] = useState('');
  const [imagePreviewUrls, setImagePreviewUrls] = useState<string[]>([]);
  const [dateTimeError, setDateTimeError] = useState<string>('');
  
  // Tag management states
  const [newTagName, setNewTagName] = useState('');
  const [newCommunityId, setNewCommunityId] = useState('');
  const [newCommunityName, setNewCommunityName] = useState('');
  const [isSavingTag, setIsSavingTag] = useState(false);
  
  // Ref to preserve scroll position during updates
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  
  // Helper function to preserve scroll position during updates
  const preserveScrollPosition = useCallback((callback: () => void) => {
    const scrollContainer = scrollContainerRef.current || document.documentElement;
    const scrollTop = scrollContainer.scrollTop;
    const scrollLeft = scrollContainer.scrollLeft;
    
    callback();
    
    requestAnimationFrame(() => {
      scrollContainer.scrollTop = scrollTop;
      scrollContainer.scrollLeft = scrollLeft;
    });
  }, []);
  
  // Create preview URLs when images are attached
  useEffect(() => {
    const urls = attachedImages.map(file => URL.createObjectURL(file));
    setImagePreviewUrls(urls);

    // Cleanup function to revoke URLs when component unmounts or images change
    return () => {
      urls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [attachedImages]);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (refreshTrigger) {
      fetchScheduledPosts();
    }
  }, [refreshTrigger]);

  const fetchData = async () => {
    setLoading(true);
    try {
      await Promise.all([fetchScheduledPosts(), fetchCommunityTags()]);
    } catch (error) {
      debugLog.error('Error fetching scheduler data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchScheduledPosts = async () => {
    try {
      const response = await fetch('/api/scheduler/posts?include_metrics=true');
      if (response.ok) {
        const posts = await response.json();
        setScheduledPosts(posts);
      }
    } catch (error) {
      debugLog.error('Error fetching scheduled posts:', error);
    }
  };

  const fetchCommunityTags = async () => {
    try {
      const response = await fetch('/api/scheduler/tags');
      if (response.ok) {
        const tags = await response.json();
        setCommunityTags(tags);
      }
    } catch (error) {
      debugLog.error('Error fetching community tags:', error);
    }
  };

  // Queue functions
  const fetchQueue = async () => {
    try {
      const response = await fetch(`/api/scheduler/queue?account_slot=${queueSlot}`);
      if (response.ok) {
        const data = await response.json();
        setQueueItems(data.items || []);
      }
    } catch (error) {
      debugLog.error('Error fetching queue:', error);
    }
  };

  const addToQueue = async () => {
    if (!queueText.trim()) return;
    try {
      const response = await fetch('/api/scheduler/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: queueText.trim(), accountSlot: queueSlot }),
      });
      if (response.ok) {
        setQueueText('');
        fetchQueue();
      }
    } catch (error) {
      debugLog.error('Error adding to queue:', error);
    }
  };

  const removeFromQueue = async (id: number) => {
    try {
      await fetch(`/api/scheduler/queue/${id}`, { method: 'DELETE' });
      fetchQueue();
    } catch (error) {
      debugLog.error('Error removing from queue:', error);
    }
  };

  const autoScheduleQueue = async () => {
    setIsAutoScheduling(true);
    try {
      const response = await fetch('/api/scheduler/queue/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountSlot: queueSlot }),
      });
      if (response.ok) {
        const result = await response.json();
        debugLog.log(`Auto-scheduled ${result.scheduled} posts`);
        fetchQueue();
        fetchScheduledPosts();
      }
    } catch (error) {
      debugLog.error('Error auto-scheduling:', error);
    } finally {
      setIsAutoScheduling(false);
    }
  };

  const togglePostSelection = (id: string) => {
    setSelectedPostIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkAction = async (action: string) => {
    if (selectedPostIds.size === 0) return;
    try {
      const response = await fetch('/api/scheduler/posts/bulk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postIds: Array.from(selectedPostIds), action }),
      });
      if (response.ok) {
        setSelectedPostIds(new Set());
        setBulkMode(false);
        fetchScheduledPosts();
      }
    } catch (error) {
      debugLog.error('Bulk action failed:', error);
    }
  };

  // Fetch queue when switching to queue view or changing slot
  useEffect(() => {
    if (viewMode === 'queue') {
      fetchQueue();
    }
  }, [viewMode, queueSlot]);

  const toggleSlotVisibility = (slot: number) => {
    setVisibleSlots(prev => 
      prev.includes(slot) 
        ? prev.filter(s => s !== slot) 
        : [...prev, slot]
    );
  };

  // Generate week view
  const generateWeekDays = () => {
    const weekStart = getWeekStartFromToday(currentWeek);
    const days = [];
    
    for (let i = 0; i < 7; i++) {
      const day = new Date(weekStart);
      day.setDate(weekStart.getDate() + i);
      days.push(day);
    }
    
    return days;
  };

  const weekDays = generateWeekDays();

  // Get posts for a specific date
  const getPostsForDate = (date: Date) => {
    const dateString = date.toDateString();
    const postsForDate = scheduledPosts.filter(post => {
      const postDate = new Date(post.scheduledTime);
      // Filter by date AND visible slots
      return postDate.toDateString() === dateString && visibleSlots.includes(post.accountSlot || 1);
    });
    
    // Sort by time (earliest to latest) and limit to 17 posts
    return postsForDate
      .sort((a, b) => new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime())
      .slice(0, 17);
  };

  // Month view helpers
  const getMonthDays = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPad = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1; // Monday start
    const days: (Date | null)[] = [];
    for (let i = 0; i < startPad; i++) days.push(null);
    for (let d = 1; d <= lastDay.getDate(); d++) {
      days.push(new Date(year, month, d));
    }
    return days;
  };

  // Day view: hourly slots
  const getHourSlots = () => {
    return Array.from({ length: 24 }, (_, h) => h);
  };

  const getPostsForHour = (date: Date, hour: number) => {
    return scheduledPosts.filter((post) => {
      const postDate = new Date(post.scheduledTime);
      return (
        postDate.toDateString() === date.toDateString() &&
        postDate.getHours() === hour &&
        visibleSlots.includes(post.accountSlot || 1)
      );
    });
  };

  // Filtered posts for search
  const filteredPosts = scheduledPosts.filter((post) => {
    if (searchQuery && !post.text.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (statusFilter && post.status !== statusFilter) return false;
    return true;
  });

  // Drag-drop handlers
  const handleDragStart = (postId: string) => {
    setDraggedPostId(postId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDropOnDate = async (targetDate: Date, targetHour?: number) => {
    if (!draggedPostId) return;
    setDraggedPostId(null);

    const post = scheduledPosts.find((p) => String(p.id) === draggedPostId);
    if (!post || post.status !== 'scheduled') return;

    const newTime = new Date(targetDate);
    if (targetHour !== undefined) {
      newTime.setHours(targetHour, 0, 0, 0);
    } else {
      // Keep original time, just change date
      const orig = new Date(post.scheduledTime);
      newTime.setHours(orig.getHours(), orig.getMinutes(), 0, 0);
    }

    try {
      const response = await fetch('/api/scheduler/posts/reschedule', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: Number(draggedPostId), newScheduledTime: newTime.toISOString() }),
      });
      if (response.ok) {
        await fetchScheduledPosts();
      }
    } catch (error) {
      debugLog.error('Failed to reschedule post:', error);
    }
  };

  // Navigation helpers for all views
  const navigatePrev = () => {
    if (viewMode === 'day') {
      const d = new Date(currentDate);
      d.setDate(d.getDate() - 1);
      setCurrentDate(d);
    } else if (viewMode === 'week') {
      handlePreviousWeek();
    } else {
      const d = new Date(currentDate);
      d.setMonth(d.getMonth() - 1);
      setCurrentDate(d);
    }
  };

  const navigateNext = () => {
    if (viewMode === 'day') {
      const d = new Date(currentDate);
      d.setDate(d.getDate() + 1);
      setCurrentDate(d);
    } else if (viewMode === 'week') {
      handleNextWeek();
    } else {
      const d = new Date(currentDate);
      d.setMonth(d.getMonth() + 1);
      setCurrentDate(d);
    }
  };

  const navigateToday = () => {
    const today = new Date();
    setCurrentDate(today);
    setCurrentWeek(today);
  };

  const handlePreviousWeek = () => {
    const newWeek = new Date(currentWeek);
    newWeek.setDate(currentWeek.getDate() - 7);
    setCurrentWeek(newWeek);
  };

  const handleNextWeek = () => {
    const newWeek = new Date(currentWeek);
    newWeek.setDate(currentWeek.getDate() + 7);
    setCurrentWeek(newWeek);
  };

  const handleCreatePost = (date?: Date) => {
    const now = new Date();
    const targetDate = date ? new Date(date) : new Date();
    targetDate.setHours(now.getHours(), now.getMinutes(), 0, 0);

    const defaultDateTime = formatDateTimeForInput(targetDate);
    resetForm();
    setSelectedDateTime(defaultDateTime);
    validateDateTime(defaultDateTime);
    setShowCreateForm(true);
    setEditingPost(null);
  };

  const handleEditPost = useCallback((post: ScheduledPost) => {
    setEditingPost(post);
    setPostText(post.text);
    const postDate = new Date(post.scheduledTime);
    const dateTimeValue = formatDateTimeForInput(postDate);
    setSelectedDateTime(dateTimeValue);
    validateDateTime(dateTimeValue);

    // Find the community tag for this post
    const communityTag = communityTags.find(tag => tag.communityId === post.communityId);
    setSelectedCommunityTag(communityTag?.tagName || '');
    setReplyToTweetId(post.replyToTweetId || '');
    setSelectedAccountSlot(post.accountSlot || 1);
    
    setShowCreateForm(true);
    resetAttachments();
  }, [communityTags]);

  const resetForm = () => {
    setPostText('');
    setSelectedDateTime('');
    setSelectedCommunityTag('');
    setReplyToTweetId('');
    setSelectedAccountSlot(1);
    setDateTimeError('');
    resetAttachments();
  };

  const resetAttachments = () => {
    setAttachedImages([]);
    setAttachedGifs([]);
    setShowEmojiPicker(false);
    setShowGifPicker(false);
    setGifSearchTerm('');
  };

  const validateDateTime = (value: string) => {
    if (!value) {
      setDateTimeError('');
      return true;
    }
    
    if (isDateTimeInPast(value)) {
      setDateTimeError('Cannot schedule posts in the past. Please select a future date and time.');
      return false;
    }
    
    setDateTimeError('');
    return true;
  };

  const handleSubmitPost = useCallback(async () => {
    if (!postText.trim() || !selectedDateTime) return;

    const scheduledDateTime = parseDateTimeInput(selectedDateTime);
    if (!scheduledDateTime) {
      setDateTimeError('Please select a valid date and time.');
      return;
    }
    
    // Check if scheduled time is in the past
    if (scheduledDateTime < new Date()) {
      setDateTimeError('Cannot schedule posts in the past. Please select a future date and time.');
      return;
    }
    
    // Save current scroll position before making changes
    const scrollContainer = scrollContainerRef.current || document.documentElement;
    const scrollTop = scrollContainer.scrollTop;
    const scrollLeft = scrollContainer.scrollLeft;
    
    setIsSubmitting(true);
    
    try {
      // Find community ID from selected tag
      const selectedTag = communityTags.find(tag => tag.tagName === selectedCommunityTag);
      
      const formData = new FormData();
      formData.append('text', postText);
      formData.append('scheduled_time', scheduledDateTime.toISOString());
      formData.append('account_slot', String(selectedAccountSlot));
      if (selectedTag) {
        formData.append('community_id', selectedTag.communityId);
      }
      if (replyToTweetId.trim()) {
        formData.append('reply_to_tweet_id', replyToTweetId.trim());
      }
      
      // Add attached images
      attachedImages.forEach(file => {
        formData.append('files', file);
      });

      // Download and add attached GIFs
      for (const gifUrl of attachedGifs) {
        try {
          const response = await fetch(gifUrl);
          const blob = await response.blob();
          const file = new File([blob], `gif_${Date.now()}.gif`, { type: 'image/gif' });
          formData.append('files', file);
        } catch (error) {
          debugLog.error('Error processing GIF:', error);
        }
      }

      const url = editingPost 
        ? `/api/scheduler/posts/${editingPost.id}`
        : '/api/scheduler/posts';
      
      const method = editingPost ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        body: formData,
      });

      if (response.ok) {
        await fetchScheduledPosts();
        setShowCreateForm(false);
        resetForm();
        // Only call onUpdate for new posts, not edits, to prevent unnecessary parent refreshes
        if (!editingPost) {
          onUpdate?.();
        }
        
        // Restore scroll position after all state updates
        requestAnimationFrame(() => {
          scrollContainer.scrollTop = scrollTop;
          scrollContainer.scrollLeft = scrollLeft;
        });
      } else {
        throw new Error('Failed to save post');
      }
    } catch (error) {
      debugLog.error('Error saving post:', error);
      alert('Failed to save post. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [postText, selectedDateTime, selectedAccountSlot, editingPost, communityTags, selectedCommunityTag, replyToTweetId, attachedImages, attachedGifs, onUpdate]);

  const handleDeletePost = useCallback(async (postId: string) => {
    // Save current scroll position before making changes
    const scrollContainer = scrollContainerRef.current || document.documentElement;
    const scrollTop = scrollContainer.scrollTop;
    const scrollLeft = scrollContainer.scrollLeft;
    
    try {
      const response = await fetch(`/api/scheduler/posts/${postId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        await fetchScheduledPosts();
        // Removed onUpdate?.() call to prevent page scroll to top
        
        // Restore scroll position after state updates
        requestAnimationFrame(() => {
          scrollContainer.scrollTop = scrollTop;
          scrollContainer.scrollLeft = scrollLeft;
        });
      } else {
        throw new Error('Failed to delete post');
      }
    } catch (error) {
      debugLog.error('Error deleting post:', error);
      alert('Failed to delete post. Please try again.');
    }
  }, []);

  const handleClearAllPosts = useCallback(async () => {
    if (scheduledPosts.length === 0) return;
    
    // Show confirmation dialog
    const confirmed = window.confirm(
      `Are you sure you want to delete all ${scheduledPosts.length} scheduled posts? This action cannot be undone.`
    );
    
    if (!confirmed) return;

    // Save current scroll position before making changes
    const scrollContainer = scrollContainerRef.current || document.documentElement;
    const scrollTop = scrollContainer.scrollTop;
    const scrollLeft = scrollContainer.scrollLeft;
    
    try {
      const response = await fetch('/api/scheduler/posts', {
        method: 'DELETE',
      });

      if (response.ok) {
        await fetchScheduledPosts();
        // Removed onUpdate?.() call to prevent page scroll to top
        
        // Restore scroll position after state updates
        requestAnimationFrame(() => {
          scrollContainer.scrollTop = scrollTop;
          scrollContainer.scrollLeft = scrollLeft;
        });
      } else {
        throw new Error('Failed to delete all posts');
      }
    } catch (error) {
      debugLog.error('Error deleting all posts:', error);
      alert('Failed to delete all posts. Please try again.');
    }
  }, [scheduledPosts.length]);

  const handleSaveTag = async () => {
    if (!newTagName.trim() || !newCommunityId.trim()) return;
    
    setIsSavingTag(true);
    
    try {
      const response = await fetch('/api/scheduler/tags', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tag_name: newTagName,
          community_id: newCommunityId,
          community_name: newCommunityName || undefined,
        }),
      });

      if (response.ok) {
        await fetchCommunityTags();
        setNewTagName('');
        setNewCommunityId('');
        setNewCommunityName('');
        setShowManageTags(false);
      } else {
        throw new Error('Failed to save tag');
      }
    } catch (error) {
      debugLog.error('Error saving tag:', error);
      alert('Failed to save tag. Please try again.');
    } finally {
      setIsSavingTag(false);
    }
  };

  const handleDeleteTag = async (tagId: string) => {
    if (!confirm('Are you sure you want to delete this tag?')) return;
    
    try {
      const response = await fetch(`/api/scheduler/tags/${tagId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        await fetchCommunityTags();
      } else {
        throw new Error('Failed to delete tag');
      }
    } catch (error) {
      debugLog.error('Error deleting tag:', error);
      alert('Failed to delete tag. Please try again.');
    }
  };

  const handleEmojiSelect = (emoji: string) => {
    setPostText(prev => prev + emoji);
    setShowEmojiPicker(false);
  };

  const handleImageAttach = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      const imageFiles = Array.from(files).filter(file => 
        file.type.startsWith('image/') && file.type !== 'image/gif'
      );
      
      const currentImageCount = attachedImages.filter(f => f.type !== 'image/gif').length;
      const availableSlots = 4 - currentImageCount;
      const allowedNewFiles = imageFiles.slice(0, availableSlots);
      
      if (imageFiles.length > availableSlots) {
        alert(`You can only attach up to 4 images. ${imageFiles.length - availableSlots} files were not added.`);
      }
      
      setAttachedImages(prev => [...prev, ...allowedNewFiles]);
    }
  };

  const handleGifSelect = async (gif: IGif, e: React.SyntheticEvent) => {
    e.preventDefault();
    
    if (attachedGifs.length >= 1) {
      alert('You can only attach 1 GIF at a time.');
      return;
    }
    
    const gifUrl = gif.images.original.url;
    setAttachedGifs(prev => [...prev, gifUrl]);
    setShowGifPicker(false);
  };

  const removeAttachedImage = (index: number) => {
    if (imagePreviewUrls[index]) {
      URL.revokeObjectURL(imagePreviewUrls[index]);
    }
    setAttachedImages(prev => prev.filter((_, i) => i !== index));
  };

  const removeAttachedGif = (index: number) => {
    setAttachedGifs(prev => prev.filter((_, i) => i !== index));
  };

  const fetchGifs = (offset: number) => {
    if (gifSearchTerm.trim()) {
      return gf.search(gifSearchTerm, { offset, limit: 10 });
    } else {
      return gf.trending({ offset, limit: 10 });
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'scheduled': return 'bg-blue-100 text-blue-800';
      case 'posted': return 'bg-green-100 text-green-800';
      case 'failed': return 'bg-red-100 text-red-800';
      case 'cancelled': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'scheduled': return <Clock3 size={14} />;
      case 'posted': return <CheckCircle size={14} />;
      case 'failed': return <XCircle size={14} />;
      case 'cancelled': return <X size={14} />;
      default: return <Clock3 size={14} />;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin h-8 w-8 text-gray-400" />
        <span className="ml-3 text-gray-600">Loading scheduler...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 fade-up" ref={scrollContainerRef}>
      {/* Header */}
      {!compact && (
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        {/* Slot Toggles */}
        <div className="flex items-center gap-2 bg-white p-1 rounded-lg border border-slate-200">
           <button
             onClick={() => toggleSlotVisibility(1)}
             className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
               visibleSlots.includes(1) 
                 ? 'bg-indigo-50 text-indigo-700 border border-indigo-200 shadow-sm' 
                 : 'text-slate-500 hover:bg-slate-50'
             }`}
           >
             <span className={`w-2 h-2 rounded-full ${visibleSlots.includes(1) ? 'bg-indigo-500' : 'bg-slate-300'}`}></span>
             Account 1
           </button>
           <button
             onClick={() => toggleSlotVisibility(2)}
             className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
               visibleSlots.includes(2) 
                 ? 'bg-amber-50 text-amber-700 border border-amber-200 shadow-sm' 
                 : 'text-slate-500 hover:bg-slate-50'
             }`}
           >
             <span className={`w-2 h-2 rounded-full ${visibleSlots.includes(2) ? 'bg-amber-500' : 'bg-slate-300'}`}></span>
             Account 2
           </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <button
            onClick={() => setShowManageTags(true)}
            className="flex items-center justify-center space-x-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors w-full sm:w-auto"
          >
            <Tag size={16} />
            <span>Manage Tags</span>
          </button>
          <button
            onClick={() => handleCreatePost()}
            className="flex items-center justify-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors w-full sm:w-auto"
          >
            <Plus size={16} />
            <span>Create Post</span>
          </button>
        </div>
      </div>
      )}

      {/* Compact Header */}
      {compact && (
        <div className="flex items-center justify-between mb-2 px-1">
           <div className="flex gap-2">
             <button
                onClick={() => setShowManageTags(true)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
                title="Manage Tags"
              >
                <Tag size={16} />
              </button>
           </div>
           <button
              onClick={() => handleCreatePost()}
              className="p-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              title="New Post"
            >
              <Plus size={16} />
            </button>
        </div>
      )}

      {/* Search and Filter Bar */}
      {!compact && (
        <div className="dashboard-card p-4 mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[200px]">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search posts..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="">All statuses</option>
              <option value="scheduled">Scheduled</option>
              <option value="posted">Posted</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <button
              onClick={() => { setBulkMode(!bulkMode); setSelectedPostIds(new Set()); }}
              className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                bulkMode ? 'bg-slate-900 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {bulkMode ? 'Cancel Bulk' : 'Bulk Select'}
            </button>
            {bulkMode && selectedPostIds.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">{selectedPostIds.size} selected</span>
                <button onClick={() => handleBulkAction('cancel')} className="px-3 py-1.5 bg-yellow-100 text-yellow-800 rounded-lg text-xs font-medium hover:bg-yellow-200">Cancel</button>
                <button onClick={() => handleBulkAction('delete')} className="px-3 py-1.5 bg-red-100 text-red-800 rounded-lg text-xs font-medium hover:bg-red-200">Delete</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Calendar View */}
      <div className={compact ? "overflow-hidden" : "dashboard-card overflow-hidden"}>
        {/* Calendar Header */}
        {!compact && (
        <div className="bg-gray-50 px-4 sm:px-6 py-4 border-b border-gray-200">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <h3 className="text-lg font-medium text-gray-900">
              {viewMode === 'day' && currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              {viewMode === 'week' && `Week of ${formatDateForDisplay(weekDays[0])}`}
              {viewMode === 'month' && currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              {viewMode === 'queue' && `Content Queue (${queueItems.length} items)`}
            </h3>
            <div className="flex items-center gap-3">
              {/* View mode toggle */}
              <div className="flex bg-white border border-slate-200 rounded-lg p-0.5">
                {(['day', 'week', 'month', 'queue'] as CalendarViewMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-all capitalize ${
                      viewMode === mode
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {mode === 'queue' ? 'Queue' : mode}
                  </button>
                ))}
              </div>
              <div className="flex items-center space-x-1">
                <button onClick={navigatePrev} className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded-md transition-colors">
                  <ChevronLeft size={16} />
                </button>
                <button onClick={navigateToday} className="px-3 py-1 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded-md transition-colors">
                  Today
                </button>
                <button onClick={navigateNext} className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded-md transition-colors">
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>
        )}

        {/* Compact Stream View */}
        {compact && (
           <div className="space-y-0 divide-y divide-slate-100">
             {scheduledPosts.filter(p => p.status === 'scheduled').length === 0 ? (
                <div className="p-8 text-center text-slate-500">
                  <p className="text-sm">No upcoming posts.</p>
                </div>
             ) : (
                scheduledPosts
                  .filter(p => p.status === 'scheduled')
                  .sort((a, b) => new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime())
                  .map(post => (
                    <div key={post.id} className="p-3 hover:bg-slate-50 transition-colors group relative">
                       <div className="flex justify-between items-start mb-1">
                          <span className="text-xs font-semibold text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded">
                            {new Date(post.scheduledTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} • {formatTimeForDisplay(post.scheduledTime)}
                          </span>
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                             <button onClick={() => handleEditPost(post)} className="text-slate-400 hover:text-blue-600"><Edit size={12}/></button>
                             <button onClick={() => handleDeletePost(post.id)} className="text-slate-400 hover:text-red-600"><Trash2 size={12}/></button>
                          </div>
                       </div>
                       <p className="text-sm text-slate-800 line-clamp-3 mb-2 whitespace-pre-wrap">{post.text}</p>
                       <div className="flex items-center gap-2 text-xs text-slate-400">
                          <span>Slot {post.accountSlot || 1}</span>
                          {getMediaCount(post) > 0 && <span>• 📎 {getMediaCount(post)}</span>}
                          {post.replyToTweetId && <span className="text-cyan-600">• Reply</span>}
                       </div>
                    </div>
                  ))
             )}
           </div>
        )}

        {/* Calendar Grid - Mobile: Single column, Desktop: 7 columns */}
        {!compact && (
        <div className="block sm:hidden">
          {/* Mobile View - Stack days vertically */}
          <div className="divide-y divide-gray-200">
            {weekDays.map((day, index) => {
              const dayPosts = getPostsForDate(day);
              const isToday = day.toDateString() === new Date().toDateString();
              
              return (
                <div
                  key={index}
                  className={`p-4 ${isToday ? 'bg-blue-50' : 'bg-white'}`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className={`text-base font-medium ${
                      isToday ? 'text-blue-600' : 'text-gray-900'
                    }`}>
                      {day.toLocaleDateString('en-US', {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric'
                      })}
                    </div>
                    <button
                      onClick={() => handleCreatePost(day)}
                      className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                      title="Add post"
                    >
                      <Plus size={18} />
                    </button>
                  </div>
                  
                  {/* Posts for this day */}
                  {dayPosts.length > 0 ? (
                    <div className="space-y-2">
                      {dayPosts.map((post) => (
                        <div
                          key={post.id}
                          className="group relative p-3 bg-gray-50 rounded-lg border hover:bg-gray-100 transition-colors cursor-pointer"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium text-gray-700 text-sm">
                              {formatTimeForDisplay(post.scheduledTime)}
                            </span>
                            <div className="flex items-center space-x-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEditPost(post);
                                }}
                                className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
                                title="Edit"
                              >
                                <Edit size={14} />
                              </button>
                                                          <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleDeletePost(post.id);
                              }}
                              className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                              title="Delete"
                            >
                              <Trash2 size={14} />
                            </button>
                            </div>
                          </div>
                          
                          <div className="text-gray-600 mb-2 text-sm leading-relaxed">
                            {post.text.length > 80 ? `${post.text.slice(0, 80)}...` : post.text}
                          </div>
                          
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                              <div className={`inline-flex items-center space-x-1 px-2 py-1 rounded-full text-xs ${getStatusColor(post.status)}`}>
                                {getStatusIcon(post.status)}
                                <span className="capitalize">{post.status}</span>
                              </div>
                              <div className="text-xs text-indigo-700 bg-indigo-50 px-2 py-1 rounded-full">
                                Account #{post.accountSlot || 1}
                              </div>
                              {post.communityId && (
                                <div className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded-full">
                                  {communityTags.find(tag => tag.communityId === post.communityId)?.tagName || 'Community'}
                                </div>
                              )}
                              {post.replyToTweetId && (
                                <div className="text-xs text-cyan-700 bg-cyan-50 px-2 py-1 rounded-full">
                                  Reply
                                </div>
                              )}
                            </div>
                            {getMediaCount(post) > 0 && (
                              <div className="text-gray-400 text-xs">
                                📎 {getMediaCount(post)}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-4 text-gray-500 text-sm">
                      No posts scheduled
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        )}

        {/* Day View */}
        {!compact && viewMode === 'day' && (
          <div className="hidden sm:block">
            <div className="divide-y divide-gray-200">
              {getHourSlots().map((hour) => {
                const hourPosts = getPostsForHour(currentDate, hour);
                return (
                  <div
                    key={hour}
                    className="flex min-h-[48px] hover:bg-slate-50 transition-colors"
                    onDragOver={handleDragOver}
                    onDrop={() => handleDropOnDate(currentDate, hour)}
                  >
                    <div className="w-16 flex-shrink-0 py-2 px-3 text-xs text-slate-500 font-medium border-r border-gray-200 bg-gray-50">
                      {hour.toString().padStart(2, '0')}:00
                    </div>
                    <div className="flex-1 p-1 flex flex-wrap gap-1">
                      {hourPosts.map((post) => (
                        <div
                          key={post.id}
                          draggable={post.status === 'scheduled'}
                          onDragStart={() => handleDragStart(String(post.id))}
                          className={`group relative p-2 rounded border text-xs cursor-grab active:cursor-grabbing flex-1 min-w-[200px] max-w-[400px] ${
                            (post.accountSlot || 1) === 1
                              ? 'bg-indigo-50/50 border-indigo-100 hover:border-indigo-300'
                              : 'bg-amber-50/50 border-amber-100 hover:border-amber-300'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-medium">{formatTimeForDisplay(post.scheduledTime)}</span>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => handleEditPost(post)} className="p-1 text-gray-400 hover:text-blue-600"><Edit size={12} /></button>
                              <button onClick={() => handleDeletePost(post.id)} className="p-1 text-gray-400 hover:text-red-600"><Trash2 size={12} /></button>
                            </div>
                          </div>
                          <p className="text-gray-600 line-clamp-2">{post.text}</p>
                          <div className="flex items-center gap-1 mt-1">
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] ${getStatusColor(post.status)}`}>
                              {getStatusIcon(post.status)} {post.status}
                            </span>
                            <span className="text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded-full text-[10px]">#{post.accountSlot || 1}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Month View */}
        {!compact && viewMode === 'month' && (
          <div className="hidden sm:block">
            {/* Day headers */}
            <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                <div key={d} className="text-xs font-medium text-gray-600 text-center py-2">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {getMonthDays().map((day, idx) => {
                if (!day) {
                  return <div key={`pad-${idx}`} className="min-h-[80px] border-r border-b border-gray-200 bg-gray-50/50" />;
                }
                const dayPosts = getPostsForDate(day);
                const isToday = day.toDateString() === new Date().toDateString();
                const isCurrentMonth = day.getMonth() === currentDate.getMonth();
                return (
                  <div
                    key={day.toISOString()}
                    className={`min-h-[80px] border-r border-b border-gray-200 p-1 ${isToday ? 'bg-blue-50' : ''} ${!isCurrentMonth ? 'opacity-50' : ''}`}
                    onDragOver={handleDragOver}
                    onDrop={() => handleDropOnDate(day)}
                    onClick={() => {
                      setCurrentDate(day);
                      setViewMode('day');
                    }}
                  >
                    <div className={`text-xs font-medium mb-1 ${isToday ? 'text-blue-600' : 'text-gray-700'}`}>
                      {day.getDate()}
                    </div>
                    {dayPosts.length > 0 && (
                      <div className="flex flex-wrap gap-0.5">
                        {dayPosts.slice(0, 3).map((post) => (
                          <div
                            key={post.id}
                            draggable={post.status === 'scheduled'}
                            onDragStart={(e) => {
                              e.stopPropagation();
                              handleDragStart(String(post.id));
                            }}
                            className={`w-full text-[10px] px-1 py-0.5 rounded truncate cursor-grab ${
                              (post.accountSlot || 1) === 1
                                ? 'bg-indigo-100 text-indigo-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                            title={post.text}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {formatTimeForDisplay(post.scheduledTime)} {post.text.slice(0, 20)}
                          </div>
                        ))}
                        {dayPosts.length > 3 && (
                          <span className="text-[10px] text-gray-500 px-1">+{dayPosts.length - 3} more</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Desktop View - 7 column grid (Week) */}
        {!compact && viewMode === 'week' && (
        <div className="hidden sm:block">
          <div className="grid grid-cols-7 gap-0">
            {weekDays.map((day, index) => {
              const dayPosts = getPostsForDate(day);
              const isToday = day.toDateString() === new Date().toDateString();
              
              return (
                <div
                  key={index}
                  className={`min-h-32 border-r border-b border-gray-200 p-2 ${
                    isToday ? 'bg-blue-50' : 'bg-white'
                  } last:border-r-0`}
                  onDragOver={handleDragOver}
                  onDrop={() => handleDropOnDate(day)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className={`text-sm font-medium ${
                      isToday ? 'text-blue-600' : 'text-gray-900'
                    }`}>
                      {formatDateForDisplay(day)}
                    </div>
                    <button
                      onClick={() => handleCreatePost(day)}
                      className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                      title="Add post"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                  
                  {/* Posts for this day */}
                  <div className="space-y-1">
                                          {dayPosts.map((post) => (
                                          <div
                                            key={post.id}
                                            draggable={post.status === 'scheduled'}
                                            onDragStart={() => handleDragStart(String(post.id))}
                                            className={`group relative p-2 rounded border text-xs hover:shadow-md transition-all cursor-grab active:cursor-grabbing ${
                                              (post.accountSlot || 1) === 1
                                                ? 'bg-indigo-50/50 border-indigo-100 hover:border-indigo-300'
                                                : 'bg-amber-50/50 border-amber-100 hover:border-amber-300'
                                            }`}
                                          >
                                            <div className="flex items-center justify-between mb-1">
                                              <span className={`font-medium ${
                                                (post.accountSlot || 1) === 1 ? 'text-indigo-900' : 'text-amber-900'
                                              }`}>
                                                {formatTimeForDisplay(post.scheduledTime)}
                                              </span>
                                              <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEditPost(post);
                              }}
                              className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
                              title="Edit"
                            >
                              <Edit size={12} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleDeletePost(post.id);
                              }}
                              className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                              title="Delete"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                        
                        <div className="text-gray-600 mb-1 line-clamp-2">
                          {post.text.length > 50 ? `${post.text.slice(0, 50)}...` : post.text}
                        </div>
                        
                        <div className="flex flex-col space-y-1">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1">
                              <div className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-xs ${getStatusColor(post.status)}`}>
                                {getStatusIcon(post.status)}
                                <span className="capitalize">{post.status}</span>
                              </div>
                              <div className="text-xs text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full">
                                #{post.accountSlot || 1}
                              </div>
                            </div>
                            {getMediaCount(post) > 0 && (
                              <div className="text-gray-400">
                                📎 {getMediaCount(post)}
                              </div>
                            )}
                          </div>
                          {post.communityId && (
                            <div className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full self-start">
                              {communityTags.find(tag => tag.communityId === post.communityId)?.tagName || 'Community'}
                            </div>
                          )}
                          {post.replyToTweetId && (
                            <div className="text-xs text-cyan-700 bg-cyan-50 px-2 py-0.5 rounded-full self-start">
                              Reply
                            </div>
                          )}
                          {post.status === 'posted' && post.metrics && (
                            <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                              <span title="Likes">♥ {post.metrics.likes}</span>
                              <span title="Retweets">⟲ {post.metrics.retweets}</span>
                              <span title="Impressions">👁 {post.metrics.impressions}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        )}

        {/* Queue View */}
        {!compact && viewMode === 'queue' && (
          <div className="p-4 sm:p-6">
            {/* Queue Controls */}
            <div className="flex items-center gap-3 mb-4">
              <select
                value={queueSlot}
                onChange={(e) => setQueueSlot(Number(e.target.value))}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value={1}>Account #1</option>
                <option value={2}>Account #2</option>
              </select>
              <button
                onClick={autoScheduleQueue}
                disabled={isAutoScheduling || queueItems.length === 0}
                className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isAutoScheduling ? (
                  <><Loader2 size={14} className="animate-spin" /> Scheduling...</>
                ) : (
                  <><Sparkles size={14} /> Auto-Schedule All</>
                )}
              </button>
            </div>

            {/* Add to queue form */}
            <div className="flex gap-2 mb-6">
              <textarea
                value={queueText}
                onChange={(e) => setQueueText(e.target.value)}
                placeholder="Write a post to add to the queue..."
                className="flex-1 p-3 border border-gray-300 rounded-lg text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                rows={2}
              />
              <button
                onClick={addToQueue}
                disabled={!queueText.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed self-end transition-colors"
              >
                <Plus size={16} />
              </button>
            </div>

            {/* Queue items list */}
            {queueItems.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <List size={32} className="mx-auto mb-3 opacity-50" />
                <p className="text-sm font-medium">Queue is empty</p>
                <p className="text-xs mt-1">Add posts above and click Auto-Schedule to assign optimal times.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {queueItems.map((item, index) => (
                  <div
                    key={item.id}
                    className="flex items-start gap-3 p-3 bg-white border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
                  >
                    <span className="flex-shrink-0 w-6 h-6 bg-slate-100 text-slate-600 rounded-full flex items-center justify-center text-xs font-medium">
                      {index + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900 whitespace-pre-wrap break-words">{item.text}</p>
                      {item.communityId && (
                        <span className="inline-block mt-1 text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                          {communityTags.find(t => t.communityId === item.communityId)?.tagName || 'Community'}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => removeFromQueue(item.id)}
                      className="flex-shrink-0 p-1 text-gray-400 hover:text-red-600 transition-colors"
                      title="Remove from queue"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create/Edit Post Modal */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-4 sm:p-6 w-full max-w-2xl max-h-[95vh] sm:max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4 sm:mb-6">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingPost ? 'Edit Scheduled Post' : 'Create Scheduled Post'}
              </h3>
              <button
                onClick={() => {
                  preserveScrollPosition(() => {
                    setShowCreateForm(false);
                    resetForm();
                  });
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={24} />
              </button>
            </div>

            <div className="space-y-4">
              {/* Post Content */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Post Content
                </label>
                <div className="space-y-0">
                  <textarea
                    value={postText}
                    onChange={(e) => setPostText(e.target.value)}
                    placeholder="What's happening?"
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                    rows={4}
                    maxLength={280}
                  />
                  
                  {/* Character count and tools */}
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 px-1">
                    <div className="flex items-center space-x-1 order-2 sm:order-1">
                      {/* Emoji Button */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                          className="p-2 text-gray-400 hover:text-gray-600 rounded transition-colors"
                          title="Add emoji"
                        >
                          <Smile size={18} />
                        </button>
                        
                        {showEmojiPicker && (
                          <div className="absolute bottom-full left-0 mb-2 z-20">
                            <EmojiPicker
                              onEmojiClick={(emoji: EmojiClickData) => handleEmojiSelect(emoji.emoji)}
                              emojiStyle={EmojiStyle.NATIVE}
                              theme={Theme.LIGHT}
                              searchPlaceHolder="Search emojis..."
                              lazyLoadEmojis={true}
                              previewConfig={{
                                showPreview: false
                              }}
                            />
                          </div>
                        )}
                      </div>

                      {/* GIF Button */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => {
                            setGifSearchTerm('');
                            setShowGifPicker(!showGifPicker);
                          }}
                          className="p-2 text-gray-400 hover:text-gray-600 rounded transition-colors"
                          title="Add GIF"
                          disabled={attachedGifs.length >= 1}
                        >
                          <MdOutlineGifBox size={20} />
                        </button>
                        
                        {showGifPicker && (
                          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                            <div className="bg-white rounded-lg p-4 w-full max-w-sm sm:max-w-md h-96 overflow-hidden">
                              <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-semibold text-gray-900">Choose a GIF</h3>
                                <button
                                  onClick={() => setShowGifPicker(false)}
                                  className="text-gray-500 hover:text-gray-700"
                                >
                                  <X size={18} />
                                </button>
                              </div>
                              
                              <div className="mb-4">
                                <input
                                  type="text"
                                  placeholder="Search GIFs..."
                                  value={gifSearchTerm}
                                  onChange={(e) => setGifSearchTerm(e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                />
                              </div>
                              
                              <div className="overflow-auto" style={{ height: 'calc(100% - 120px)' }}>
                                <Grid
                                  key={gifSearchTerm}
                                  width={280}
                                  columns={2}
                                  fetchGifs={fetchGifs}
                                  onGifClick={handleGifSelect}
                                />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Image Button */}
                      <div className="relative">
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={handleImageAttach}
                          className="hidden"
                          id="image-upload-scheduler"
                        />
                        <label
                          htmlFor="image-upload-scheduler"
                          className="p-2 text-gray-400 hover:text-gray-600 rounded transition-colors cursor-pointer inline-flex"
                          title="Attach image"
                        >
                          <ImageIcon size={18} />
                        </label>
                      </div>
                    </div>

                    <div className="text-sm text-gray-500 order-1 sm:order-2">
                      {postText.length}/280
                    </div>
                  </div>
                </div>
              </div>

              {/* Attached Images */}
              {attachedImages.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-700">Attached Images:</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {attachedImages.map((image, index) => (
                      <div key={index} className="relative group">
                        <img
                          src={imagePreviewUrls[index]}
                          alt={`Attached image ${index + 1}`}
                          className="w-full h-32 object-cover rounded-lg border border-gray-200"
                        />
                        <button
                          type="button"
                          onClick={() => removeAttachedImage(index)}
                          className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-80 hover:opacity-100 transition-opacity"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Attached GIFs */}
              {attachedGifs.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-700">Attached GIFs:</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {attachedGifs.map((gifUrl, index) => (
                      <div key={index} className="relative group">
                        <img
                          src={gifUrl}
                          alt={`Attached GIF ${index + 1}`}
                          className="w-full h-32 object-cover rounded-lg border border-gray-200"
                        />
                        <button
                          type="button"
                          onClick={() => removeAttachedGif(index)}
                          className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-80 hover:opacity-100 transition-opacity"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Date and Time */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Date &amp; Time
                  </label>
                  <input
                    type="datetime-local"
                    value={selectedDateTime}
                    onChange={(e) => {
                      setSelectedDateTime(e.target.value);
                      validateDateTime(e.target.value);
                    }}
                    min={formatDateTimeForInput(new Date())}
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  />
                </div>
                
                {/* Date/Time Error Message */}
                {dateTimeError && (
                  <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">
                    {dateTimeError}
                  </div>
                )}
              </div>

              {/* Community Tag */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  X Account
                </label>
                <select
                  value={selectedAccountSlot}
                  onChange={(e) => setSelectedAccountSlot(Number(e.target.value))}
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value={1}>Account 1</option>
                  <option value={2}>Account 2</option>
                </select>
              </div>

              {/* Community Tag */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Community (Optional)
                </label>
                <select
                  value={selectedCommunityTag}
                  onChange={(e) => setSelectedCommunityTag(e.target.value)}
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select a community...</option>
                  {communityTags.map((tag) => (
                    <option key={tag.id} value={tag.tagName}>
                      {tag.tagName} {tag.communityName && `(${tag.communityName})`}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Reply To Post ID (Optional)
                </label>
                <input
                  type="text"
                  value={replyToTweetId}
                  onChange={(e) => setReplyToTweetId(e.target.value)}
                  placeholder="e.g. 1893289302711484472"
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">
                  If set, this scheduled post will be published as a reply thread item.
                </p>
              </div>

              {/* Actions */}
              <div className="flex flex-col sm:flex-row justify-end space-y-2 sm:space-y-0 sm:space-x-3 pt-4 border-t border-gray-200">
                <button
                  onClick={() => {
                    preserveScrollPosition(() => {
                      setShowCreateForm(false);
                      resetForm();
                    });
                  }}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors order-2 sm:order-1"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmitPost}
                  disabled={!postText.trim() || !selectedDateTime || isSubmitting || !!dateTimeError}
                  className="flex items-center justify-center space-x-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed order-1 sm:order-2"
                >
                  {isSubmitting ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Save size={16} />
                  )}
                  <span>{isSubmitting ? 'Saving...' : editingPost ? 'Update Post' : 'Schedule Post'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Manage Tags Modal */}
      {showManageTags && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-4 sm:p-6 w-full max-w-2xl max-h-[95vh] sm:max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4 sm:mb-6">
              <h3 className="text-lg font-semibold text-gray-900">Manage Community Tags</h3>
              <button
                onClick={() => setShowManageTags(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={24} />
              </button>
            </div>

            {/* Add New Tag */}
            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <h4 className="text-sm font-medium text-gray-900 mb-3">Add New Tag</h4>
              <div className="space-y-3">
                <div>
                  <input
                    type="text"
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    placeholder="Tag name (e.g., 'Web3', 'AI News')"
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <input
                    type="text"
                    value={newCommunityId}
                    onChange={(e) => setNewCommunityId(e.target.value)}
                    placeholder="Community ID (from X/Twitter)"
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <input
                    type="text"
                    value={newCommunityName}
                    onChange={(e) => setNewCommunityName(e.target.value)}
                    placeholder="Community name (optional)"
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <button
                  onClick={handleSaveTag}
                  disabled={!newTagName.trim() || !newCommunityId.trim() || isSavingTag}
                  className="flex items-center justify-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 w-full sm:w-auto"
                >
                  {isSavingTag ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Plus size={16} />
                  )}
                  <span>{isSavingTag ? 'Saving...' : 'Add Tag'}</span>
                </button>
              </div>
            </div>

            {/* Existing Tags */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-3">Existing Tags</h4>
              {communityTags.length === 0 ? (
                <p className="text-gray-500 text-sm">No tags created yet.</p>
              ) : (
                <div className="space-y-2">
                  {communityTags.map((tag) => (
                    <div key={tag.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 bg-gray-50 rounded-lg gap-2">
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">{tag.tagName}</div>
                        <div className="text-sm text-gray-500">
                          ID: {tag.communityId}
                          {tag.communityName && ` • ${tag.communityName}`}
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteTag(tag.id)}
                        className="text-red-600 hover:text-red-800 transition-colors self-end sm:self-center"
                        title="Delete tag"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Posts History */}
      <div className="dashboard-card">
        <div className="px-4 sm:px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-lg font-medium text-gray-900">Scheduled Posts History</h3>
          {scheduledPosts.length > 0 && (
            <button
              onClick={handleClearAllPosts}
              className="flex items-center space-x-2 px-3 py-1.5 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 border border-red-300 hover:border-red-400 rounded-md transition-colors"
            >
              <Trash2 size={14} />
              <span>Clear All</span>
            </button>
          )}
        </div>
        <div className="p-4 sm:p-6">
          {scheduledPosts.length === 0 ? (
            <div className="text-center py-8">
              <Calendar className="mx-auto h-12 w-12 text-gray-400 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No scheduled posts</h3>
              <p className="text-gray-500">
                Create your first scheduled post to get started.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {scheduledPosts
                .sort((a, b) => new Date(b.scheduledTime).getTime() - new Date(a.scheduledTime).getTime())
                .map((post) => (
                  <div key={post.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex flex-col sm:flex-row items-start justify-between gap-3">
                      <div className="flex-1 w-full">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center space-y-2 sm:space-y-0 sm:space-x-3 mb-2">
                          <div className={`inline-flex items-center space-x-1 px-2 py-1 rounded-full text-sm ${getStatusColor(post.status)}`}>
                            {getStatusIcon(post.status)}
                            <span className="capitalize">{post.status}</span>
                          </div>
                          <div className="text-sm text-indigo-700 bg-indigo-50 px-2 py-1 rounded-full">
                            Account #{post.accountSlot || 1}
                          </div>
                          <div className="text-sm text-gray-500">
                            {new Date(post.scheduledTime).toLocaleString()}
                          </div>
                          {post.communityId && (
                            <div className="text-sm text-blue-600">
                              🏘️ Community Post
                            </div>
                          )}
                          {post.replyToTweetId && (
                            <div className="text-sm text-cyan-700">
                              💬 Reply Thread
                            </div>
                          )}
                        </div>
                        <p className="text-gray-900 mb-2 leading-relaxed">{post.text}</p>
                        {post.replyToTweetId && (
                          <div className="text-sm text-cyan-700 mb-2">
                            Replying to post: {post.replyToTweetId}
                          </div>
                        )}
                        {getMediaCount(post) > 0 && (
                          <div className="text-sm text-gray-500 mb-2">
                            📎 {getMediaCount(post)} media file(s)
                          </div>
                        )}
                        {post.errorMessage && (
                          <div className="text-sm text-red-600 bg-red-50 p-2 rounded">
                            Error: {post.errorMessage}
                          </div>
                        )}
                        {(post.twitterPostId || post.twitter_post_id) && (
                          <div className="text-sm text-green-600">
                            Posted on X: {post.twitterPostId || post.twitter_post_id}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center space-x-2 w-full sm:w-auto justify-end">
                        {post.status === 'scheduled' && (
                          <>
                            <button
                              onClick={() => handleEditPost(post)}
                              className="p-2 text-gray-400 hover:text-blue-600 transition-colors"
                              title="Edit"
                            >
                              <Edit size={16} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                handleDeletePost(post.id);
                              }}
                              className="p-2 text-gray-400 hover:text-red-600 transition-colors"
                              title="Delete"
                            >
                              <Trash2 size={16} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
} 
