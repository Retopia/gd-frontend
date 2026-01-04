import { useState, useEffect, useRef } from 'react';
import { Music2, Volume2, RefreshCw, Play, Home, Download, Search, Upload, X, Pencil } from 'lucide-react';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { api } from './api';
import GameCanvas from './GameCanvas';

export default function App() {
  // State management
  const [state, setState] = useState('home'); // 'home', 'lead_in', 'play', 'results', 'edit'
  const [maps, setMaps] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMap, setSelectedMap] = useState(null);
  const [selectedMaps, setSelectedMaps] = useState([]); // For checkbox selection
  const [scrollOffset, setScrollOffset] = useState(0);
  const [musicEnabled, setMusicEnabled] = useState(true);
  const [beepEnabled, setBeepEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [storage, setStorage] = useState(null);

  // Gameplay state
  const [gameData, setGameData] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [inputEvents, setInputEvents] = useState([]);
  const [stats, setStats] = useState(null);
  const [endTime, setEndTime] = useState(0);
  const [leadInCountdown, setLeadInCountdown] = useState(0);
  const [countdownStarted, setCountdownStarted] = useState(false);
  const [timingFeedback, setTimingFeedback] = useState(null); // { offset: number, time: number }
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [practiceStart, setPracticeStart] = useState('');
  const [practiceEnd, setPracticeEnd] = useState('');
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, message: '', onConfirm: null });

  // Refs
  const gameLoopRef = useRef(null);
  const playStartRef = useRef(0);
  const audioContextRef = useRef(null);
  const oscillatorRef = useRef(null);
  const gainNodeRef = useRef(null);
  const beepEnabledRef = useRef(beepEnabled);
  const musicEnabledRef = useRef(musicEnabled);
  const musicAudioRef = useRef(null);
  const musicUrlRef = useRef(null);
  const spaceHeldRef = useRef(false);
  const beepNextIdxRef = useRef(0);

  // Configuration
  const HIT_WINDOW_MS = 18.0;
  const LEAD_IN_S = 1.5;
  const SCROLL_S = 2.5;
  const LANE_Y_FRAC = 0.55;
  const TARGET_FRAC = 1 / 3;
  const BEEP_VOLUME = 0.35 * 0.35; // ~0.12 to match old

  // Initialize
  useEffect(() => {
    refreshMaps();
  }, []);

  // Keep refs in sync
  useEffect(() => {
    beepEnabledRef.current = beepEnabled;
  }, [beepEnabled]);

  useEffect(() => {
    musicEnabledRef.current = musicEnabled;
  }, [musicEnabled]);

  const refreshMaps = async (forceRefresh = false) => {
    try {
      setLoading(true);
      const [mapList, storageInfo] = await Promise.all([
        api.getMaps(forceRefresh),
        api.getStorage()
      ]);
      setMaps(mapList);
      setStorage(storageInfo);
    } catch (err) {
      toast.error('Failed to load maps');
    } finally {
      setLoading(false);
    }
  };

  const handleMapUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    try {
      setLoading(true);
      const results = await Promise.allSettled(files.map(file => api.uploadMap(file)));
      
      // Categorize results by status code
      const successes = results.filter(r => r.status === 'fulfilled');
      const duplicates = results.filter(r => r.status === 'rejected' && r.reason?.status === 409);
      const storageFull = results.filter(r => r.status === 'rejected' && r.reason?.status === 507);
      const otherErrors = results.filter(r => r.status === 'rejected' && r.reason?.status !== 409 && r.reason?.status !== 507);
      
      if (successes.length > 0) {
        toast.success(`Successfully uploaded ${successes.length} map(s)`);
      }
      
      if (duplicates.length > 0) {
        toast.error(`${duplicates.length} map(s) already exist`);
      }
      
      if (storageFull.length > 0) {
        const firstError = storageFull[0].reason?.message || 'Storage limit exceeded';
        toast.error(firstError);
      }
      
      if (otherErrors.length > 0) {
        const firstError = otherErrors[0].reason?.message || 'Unknown error';
        toast.error(otherErrors.length === 1 ? firstError : `Failed to upload ${otherErrors.length} map(s)`);
      }
      
      await refreshMaps(true);
    } catch (err) {
      toast.error('Failed to upload map(s)');  
    } finally {
      setLoading(false);
      e.target.value = ''; // Reset input
    }
  };

  const handleMusicUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Frontend file size check for immediate feedback (backend also validates)
    const MAX_SIZE_MB = 100;
    const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;
    const oversizedFiles = files.filter(f => f.size > MAX_SIZE_BYTES);
    
    if (oversizedFiles.length > 0) {
      const fileNames = oversizedFiles.map(f => `${f.name} (${(f.size / 1024 / 1024).toFixed(1)}MB)`).join(', ');
      toast.error(`File(s) exceed ${MAX_SIZE_MB}MB limit: ${fileNames}`);
      e.target.value = ''; // Reset input
      return;
    }

    try {
      setLoading(true);
      const results = await Promise.allSettled(files.map(file => api.uploadMusic(file)));
      
      // Categorize results by HTTP status code
      const successes = results.filter(r => r.status === 'fulfilled');
      const duplicates = results.filter(r => r.status === 'rejected' && r.reason?.status === 409);
      const missingGdr = results.filter(r => r.status === 'rejected' && r.reason?.status === 400 && r.reason?.message?.includes('No corresponding'));
      const tooLarge = results.filter(r => r.status === 'rejected' && r.reason?.status === 413);
      const storageFull = results.filter(r => r.status === 'rejected' && r.reason?.status === 507);
      const otherErrors = results.filter(r => 
        r.status === 'rejected' && 
        r.reason?.status !== 409 && 
        r.reason?.status !== 413 &&
        r.reason?.status !== 507 &&
        !(r.reason?.status === 400 && r.reason?.message?.includes('No corresponding'))
      );
      
      if (successes.length > 0) {
        toast.success(`Successfully uploaded ${successes.length} music file(s)`);
      }
      
      if (duplicates.length > 0) {
        toast.error(`${duplicates.length} music file(s) already exist`);
      }
      
      if (missingGdr.length > 0) {
        toast.error(`${missingGdr.length} music file(s) have no matching .gdr map`);
      }
      
      if (tooLarge.length > 0) {
        const firstError = tooLarge[0].reason?.message || 'File too large';
        toast.error(firstError);
      }
      
      if (storageFull.length > 0) {
        const firstError = storageFull[0].reason?.message || 'Storage limit exceeded';
        toast.error(firstError);
      }
      
      if (otherErrors.length > 0) {
        const firstError = otherErrors[0].reason?.message || 'Unknown error';
        toast.error(otherErrors.length === 1 ? firstError : `Failed to upload ${otherErrors.length} music file(s)`);
      }
      
      // Refresh map list to update has_music status
      await refreshMaps(true);
    } catch (err) {
      toast.error(err.message || 'Failed to upload music');
    } finally {
      setLoading(false);
      e.target.value = ''; // Reset input
    }
  };

  const handleDeleteMap = async (e, map) => {
    e.stopPropagation(); // Prevent map selection when clicking delete

    try {
      setLoading(true);
      await api.deleteMap(map.name);
      await refreshMaps(true);
    } catch (err) {
      toast.error('Failed to delete map');
    } finally {
      setLoading(false);
    }
  };

  const showConfirmModal = (message, onConfirm) => {
    setConfirmModal({ isOpen: true, message, onConfirm });
  };

  const closeConfirmModal = () => {
    setConfirmModal({ isOpen: false, message: '', onConfirm: null });
  };

  const handleConfirm = () => {
    if (confirmModal.onConfirm) {
      confirmModal.onConfirm();
    }
    closeConfirmModal();
  };

  const toggleMapSelection = (mapName) => {
    setSelectedMaps(prev => 
      prev.includes(mapName) 
        ? prev.filter(name => name !== mapName)
        : [...prev, mapName]
    );
  };

  const toggleSelectAll = () => {
    if (selectedMaps.length === filteredMaps.length) {
      setSelectedMaps([]);
    } else {
      setSelectedMaps(filteredMaps.map(m => m.name));
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedMaps.length === 0) return;

    showConfirmModal(
      `Delete ${selectedMaps.length} selected map(s) and their music files?`,
      async () => {
        try {
          setLoading(true);
          const results = await Promise.allSettled(selectedMaps.map(mapName => api.deleteMap(mapName)));

          const successes = results.filter(r => r.status === 'fulfilled').length;
          const failures = results.filter(r => r.status === 'rejected').length;

          if (successes > 0) {
            toast.success(`Successfully deleted ${successes} map(s)`);
          }
          if (failures > 0) {
            toast.error(`Failed to delete ${failures} map(s)`);
          }

          setSelectedMaps([]);
          await refreshMaps(true);
        } catch (err) {
          toast.error('Failed to delete maps');
        } finally {
          setLoading(false);
        }
      }
    );
  };

  const handleDeleteAll = async () => {
    if (maps.length === 0) return;

    showConfirmModal(
      `Delete ALL ${maps.length} map(s) and their music files? This cannot be undone!`,
      async () => {
        try {
          setLoading(true);
          const results = await Promise.allSettled(maps.map(map => api.deleteMap(map.name)));

          const successes = results.filter(r => r.status === 'fulfilled').length;
          const failures = results.filter(r => r.status === 'rejected').length;

          if (successes > 0) {
            toast.success(`Successfully deleted ${successes} map(s)`);
          }
          if (failures > 0) {
            toast.error(`Failed to delete ${failures} map(s)`);
          }

          setSelectedMaps([]);
          await refreshMaps(true);
        } catch (err) {
          toast.error('Failed to delete maps');
        } finally {
          setLoading(false);
        }
      }
    );
  };

  const downloadFile = async (url, filename) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      throw new Error(`Failed to download ${filename}`);
    }
  };

  const handleDownloadMap = async (e, map) => {
    e.stopPropagation();

    try {
      setLoading(true);

      // If map has music, download as zip for convenience
      if (map.has_music) {
        const response = await fetch('http://localhost:8000/api/maps/download-zip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ map_names: [map.name] })
        });

        if (!response.ok) {
          throw new Error('Failed to download map');
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${map.name.replace('.gdr', '')}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        // No music, just download the .gdr file
        await downloadFile(`http://localhost:8000/api/maps/${encodeURIComponent(map.name)}/download`, `${map.name}.gdr`);
      }

      toast.success(`Downloaded ${map.name}`);
    } catch (err) {
      toast.error(`Failed to download ${map.name}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadSelected = async () => {
    if (selectedMaps.length === 0) return;

    try {
      setLoading(true);

      const response = await fetch('http://localhost:8000/api/maps/download-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ map_names: selectedMaps })
      });

      if (!response.ok) {
        throw new Error('Failed to download maps');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gd-maps-selected-${selectedMaps.length}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(`Downloaded ${selectedMaps.length} map(s) as zip`);
    } catch (err) {
      toast.error('Failed to download maps');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadAll = async () => {
    if (maps.length === 0) return;

    try {
      setLoading(true);

      const response = await fetch('http://localhost:8000/api/maps/download-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ map_names: maps.map(m => m.name) })
      });

      if (!response.ok) {
        throw new Error('Failed to download maps');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gd-maps-all-${maps.length}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(`Downloaded ${maps.length} map(s) as zip`);
    } catch (err) {
      toast.error('Failed to download maps');
    } finally {
      setLoading(false);
    }
  };

  const handleEditMap = (e, map) => {
    e.stopPropagation(); // Prevent map selection when clicking edit
    setSelectedMap(map);
    setState('edit');
  };

  const handleMapSelect = async (map) => {
    try {
      setLoading(true);
      const data = await api.loadMap(map.name);
      setGameData(data);
      setSelectedMap(map);
      setInputEvents([]);
      setCurrentTime(0);
      setLeadInCountdown(LEAD_IN_S);
      setCountdownStarted(false);
      setPlaybackSpeed(1.0);
      setPracticeStart('');
      setPracticeEnd('');

      // Load music if available
      musicUrlRef.current = null;
      if (musicAudioRef.current) {
        musicAudioRef.current.pause();
        musicAudioRef.current = null;
      }
      try {
        const musicInfo = await api.getMusic(map.name);
        if (musicInfo && musicInfo.available) {
          musicUrlRef.current = `http://localhost:8000${musicInfo.url}`;
          const audio = new Audio(musicUrlRef.current);
          audio.preload = 'auto';
          musicAudioRef.current = audio;
        }
      } catch (e) {
        // Music not available, continue without it
      }

      setState('lead_in');
    } catch (err) {
      toast.error('Failed to load map');
    } finally {
      setLoading(false);
    }
  };

  const startGame = () => {
    if (!gameData) return;

    // Parse practice section times
    const startTime = practiceStart ? parseFloat(practiceStart) : 0;
    const endTime = practiceEnd ? parseFloat(practiceEnd) : (selectedMap?.duration || Infinity);

    setInputEvents([]);
    setCurrentTime(startTime);
    setTimingFeedback(null);
    playStartRef.current = performance.now() / 1000 + LEAD_IN_S - startTime / playbackSpeed;
    setState('play');
    spaceHeldRef.current = false;
    beepNextIdxRef.current = 0;

    // Initialize audio for beeps
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    const audioCtx = audioContextRef.current;

    // Create oscillator and gain node
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 432; // Same as old: 432 Hz
    gainNode.gain.value = 0; // Start silent
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    oscillator.start();
    oscillatorRef.current = oscillator;
    gainNodeRef.current = gainNode;

    // Start music if available and enabled
    if (musicAudioRef.current && musicEnabledRef.current) {
      musicAudioRef.current.playbackRate = playbackSpeed;
      musicAudioRef.current.currentTime = startTime;
      musicAudioRef.current.play().catch(() => {
        // Autoplay blocked, ignore
      });
    }

    // Start game loop
    const gameLoop = () => {
      const now = performance.now() / 1000;
      const t = (now - playStartRef.current + LEAD_IN_S) * playbackSpeed;
      setCurrentTime(Math.max(0, t));

      // Handle beeps based on macro events
      if (beepEnabledRef.current && gameData.events && gainNodeRef.current) {
        while (beepNextIdxRef.current < gameData.events.length &&
               gameData.events[beepNextIdxRef.current].t <= t) {
          const ev = gameData.events[beepNextIdxRef.current];
          const audioTime = audioCtx.currentTime;
          gainNodeRef.current.gain.cancelScheduledValues(audioTime);
          gainNodeRef.current.gain.setValueAtTime(gainNodeRef.current.gain.value, audioTime);
          if (ev.kind === 'down') {
            gainNodeRef.current.gain.linearRampToValueAtTime(BEEP_VOLUME, audioTime + 0.008);
          } else {
            gainNodeRef.current.gain.linearRampToValueAtTime(0, audioTime + 0.018);
          }
          beepNextIdxRef.current++;
        }
      }

      // Auto-end if we've passed the practice section end time
      if (t >= endTime) {
        endGame();
        return;
      }

      // Auto-end if we've passed all events (for non-practice mode)
      if (gameData.events.length > 0 && !practiceEnd) {
        const lastEvent = gameData.events[gameData.events.length - 1];
        if (t > lastEvent.t + 1.0) {
          endGame();
          return;
        }
      }

      gameLoopRef.current = requestAnimationFrame(gameLoop);
    };

    gameLoopRef.current = requestAnimationFrame(gameLoop);
  };

  const recordInput = (kind, actualT) => {
    setInputEvents((prev) => [...prev, { kind, actual_t: actualT }]);
  };

  const endGame = async () => {
    if (gameLoopRef.current) {
      cancelAnimationFrame(gameLoopRef.current);
      gameLoopRef.current = null;
    }

    // Stop and clean up beep audio
    if (oscillatorRef.current) {
      oscillatorRef.current.stop();
      oscillatorRef.current.disconnect();
      oscillatorRef.current = null;
    }
    if (gainNodeRef.current) {
      gainNodeRef.current.disconnect();
      gainNodeRef.current = null;
    }

    // Stop music
    if (musicAudioRef.current) {
      musicAudioRef.current.pause();
      musicAudioRef.current.currentTime = 0;
    }

    if (!selectedMap || !gameData) return;

    try {
      const result = await api.evaluateResults(selectedMap.name, inputEvents, {
        hit_window_ms: HIT_WINDOW_MS,
        end_time: currentTime,
      });
      setStats(result);
      setEndTime(currentTime);
      setState('results');
    } catch (err) {
      toast.error('Failed to evaluate results');
    }
  };

  const handleExport = async () => {
    if (!selectedMap || !gameData) return;

    try {
      setLoading(true);
      const result = await api.exportResults(selectedMap.name, inputEvents, {
        hit_window_ms: HIT_WINDOW_MS,
        end_time: endTime,
      });

      // Trigger browser download
      const blob = new Blob([result.content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error('Failed to export results');
    } finally {
      setLoading(false);
    }
  };

  const calculateTimingFeedback = (kind, actualT) => {
    if (!gameData || !gameData.events) return;

    const events = gameData.events;

    // Find the closest event of the same kind within a reasonable time window
    let closestEvent = null;
    let closestOffset = Infinity;

    for (const ev of events) {
      if (ev.kind === kind) {
        const offset = actualT - ev.t;
        // Look for events within a wider window for feedback purposes
        if (Math.abs(offset) < Math.abs(closestOffset) && Math.abs(offset) <= 0.5) {
          closestOffset = offset;
          closestEvent = ev;
        }
      }
    }

    if (closestEvent) {
      const offsetMs = closestOffset * 1000;
      setTimingFeedback({ offset: offsetMs, time: Date.now() });
    }
  };

  const handleKeyDown = (e) => {
    // Modal keyboard handlers
    if (confirmModal.isOpen) {
      if (e.code === 'Enter') {
        e.preventDefault();
        handleConfirm();
      } else if (e.code === 'Escape') {
        e.preventDefault();
        closeConfirmModal();
      }
      return; // Don't process other keys when modal is open
    }

    // Lead-in state: Space to start countdown
    if (e.code === 'Space' && state === 'lead_in' && !countdownStarted) {
      e.preventDefault();
      setCountdownStarted(true);
      return;
    }

    if (e.code === 'Space' && state === 'play' && !spaceHeldRef.current) {
      e.preventDefault();
      spaceHeldRef.current = true;
      recordInput('down', currentTime);
      calculateTimingFeedback('down', currentTime);
    }
    if (e.code === 'Escape' && state === 'play') {
      e.preventDefault();
      endGame();
    }
    if (e.code === 'Backspace' && (state === 'results' || state === 'edit' || state === 'lead_in')) {
      e.preventDefault();
      setState('home');
    }
  };

  const handleKeyUp = (e) => {
    if (e.code === 'Space' && state === 'play') {
      e.preventDefault();
      spaceHeldRef.current = false;
      recordInput('up', currentTime);
      calculateTimingFeedback('up', currentTime);
    }
  };

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [state, currentTime]);

  // Lead-in timer
  useEffect(() => {
    if (state !== 'lead_in' || !countdownStarted) return;

    const timer = setInterval(() => {
      setLeadInCountdown((prev) => {
        const next = prev - 0.016;
        if (next <= 0) {
          startGame();
          return 0;
        }
        return next;
      });
    }, 16);

    return () => clearInterval(timer);
  }, [state, gameData, countdownStarted]);

  // Filter maps based on search query
  const filteredMaps = maps.filter((map) =>
    map.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const visibleMaps = filteredMaps.slice(scrollOffset, scrollOffset + 4);
  const width = 980;
  const height = 520;
  const laneY = Math.floor(height * LANE_Y_FRAC);
  const targetX = Math.floor(width * TARGET_FRAC);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-mono" onKeyDown={handleKeyDown} onKeyUp={handleKeyUp} tabIndex={0}>
      {/* HOME STATE */}
      {state === 'home' && (
        <div className="w-full h-screen bg-linear-to-b from-slate-900 to-slate-950 p-8">
          <div className="max-w-4xl mx-auto">
            {/* Header */}
            <h1 className="text-2xl font-bold mb-2 text-slate-100">GD Rhythm Trainer</h1>
            <p className="text-sm text-slate-500 mb-4">
              Click a map to play. SPACE: press/release. ESC: quit.
            </p>

            {/* Search Bar */}
            <div className="mb-6 relative">
              <Search className="absolute left-3 top-3 text-slate-500" size={20} />
              <input
                type="text"
                placeholder="Search maps..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setScrollOffset(0);
                }}
                className="w-full pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-slate-600"
              />
            </div>

            {/* Map List */}
            <div className="border-2 border-slate-700 rounded-lg p-6 mb-8 bg-slate-900 h-110">
              {/* Selection controls */}
              {maps.length > 0 && (
                <div className="h-10 mb-3 flex items-center justify-between pb-4 border-b border-slate-700">
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-300 hover:text-slate-100 transition">
                    <input
                      type="checkbox"
                      checked={filteredMaps.length > 0 && selectedMaps.length === filteredMaps.length}
                      onChange={toggleSelectAll}
                      className="w-5 h-5 cursor-pointer appearance-none bg-slate-700 border-2 border-slate-600 rounded checked:bg-blue-600 checked:border-blue-600 hover:border-slate-500 transition"
                    />
                    Select All ({filteredMaps.length})
                  </label>
                  <div className="flex gap-2">
                    <button
                      onClick={handleDownloadSelected}
                      disabled={loading || selectedMaps.length === 0}
                      className="px-3 py-1 text-sm bg-green-700 hover:bg-green-600 disabled:bg-slate-700 disabled:text-slate-500 rounded transition"
                    >
                      Download Selected ({selectedMaps.length})
                    </button>
                    <button
                      onClick={handleDownloadAll}
                      disabled={loading || maps.length === 0}
                      className="px-3 py-1 text-sm bg-green-800 hover:bg-green-700 disabled:bg-slate-700 disabled:text-slate-500 rounded transition"
                    >
                      Download All
                    </button>
                    <button
                      onClick={handleDeleteSelected}
                      disabled={loading || selectedMaps.length === 0}
                      className="px-3 py-1 text-sm bg-red-700 hover:bg-red-600 disabled:bg-slate-700 disabled:text-slate-500 rounded transition"
                    >
                      Delete Selected ({selectedMaps.length})
                    </button>
                    <button
                      onClick={handleDeleteAll}
                      disabled={loading || maps.length === 0}
                      className="px-3 py-1 text-sm bg-red-900 hover:bg-red-800 disabled:bg-slate-700 disabled:text-slate-500 rounded transition"
                    >
                      Delete All
                    </button>
                  </div>
                </div>
              )}
              <div className="h-78 flex flex-col">
                {loading ? (
                  <p className="text-slate-400">Loading maps...</p>
                ) : maps.length === 0 ? (
                  <p className="text-slate-400">No maps found. Use "Upload Map" button below to add .gdr files</p>
                ) : filteredMaps.length === 0 ? (
                  <p className="text-slate-400">No maps match your search</p>
                ) : (
                  <div className="space-y-3">
                    {visibleMaps.map((map, idx) => (
                      <div
                        key={idx}
                        className="p-3 bg-slate-800 hover:bg-slate-700 rounded-lg transition border border-slate-700 hover:border-slate-600 flex items-center justify-between group"
                      >
                        <div className="flex items-center gap-3 flex-1 cursor-pointer" onClick={() => handleMapSelect(map)}>
                          <input
                            type="checkbox"
                            checked={selectedMaps.includes(map.name)}
                            onChange={(e) => {
                              e.stopPropagation();
                              toggleMapSelection(map.name);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="w-5 h-5 cursor-pointer appearance-none bg-slate-700 border-2 border-slate-600 rounded checked:bg-blue-600 checked:border-blue-600 hover:border-slate-500 transition flex-shrink-0"
                          />
                          <div className="flex-1">
                            <p className="font-semibold text-slate-100 flex items-center gap-2">
                              {map.name}
                              {map.has_music && (
                                <Music2 size={16} className="text-purple-400" title="Has music" />
                              )}
                            </p>
                            <p className="text-xs text-slate-400">
                              {map.events} events | {map.fps.toFixed(0)} fps | {map.duration.toFixed(1)}s
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => handleDownloadMap(e, map)}
                            className="p-2 rounded-lg bg-green-700 hover:bg-green-600 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                            disabled={loading}
                            title="Download map and music"
                          >
                            <Download size={20} className="text-white" />
                          </button>
                          <button
                            onClick={(e) => handleEditMap(e, map)}
                            className="p-2 rounded-lg bg-blue-700 hover:bg-blue-600 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                            disabled={loading}
                            title="Edit map"
                          >
                            <Pencil size={20} className="text-white" />
                          </button>
                          <button
                            onClick={(e) => handleDeleteMap(e, map)}
                            className="p-2 rounded-lg bg-red-700 hover:bg-red-600 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                            disabled={loading}
                            title="Delete map and music"
                          >
                            <X size={20} className="text-white" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Pagination - always visible with fixed height */}
              <div className="flex items-center justify-center gap-4 h-8">
                {filteredMaps.length > 4 ? (
                  <>
                    <button
                      onClick={() => setScrollOffset(Math.max(0, scrollOffset - 1))}
                      className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded"
                    >
                      ←
                    </button>
                    <span className="text-sm text-slate-400 w-32 text-center">
                      {scrollOffset + 1}-{Math.min(scrollOffset + 4, filteredMaps.length)} of {filteredMaps.length}
                    </span>
                    <button
                      onClick={() => setScrollOffset(Math.min(scrollOffset + 1, filteredMaps.length - 4))}
                      className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded"
                    >
                      →
                    </button>
                  </>
                ) : (
                  <span className="text-sm text-slate-500">
                    {filteredMaps.length > 0 ? `${filteredMaps.length} map${filteredMaps.length !== 1 ? 's' : ''}` : ''}
                  </span>
                )}
              </div>
            </div>

            {/* Storage Tracker */}
            <div className="mb-6 h-12">
              {storage && (
                <>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-slate-400">Storage Used</span>
                    <span className="text-slate-300">
                      {storage.used_mb.toFixed(1)} MB / {storage.limit_mb.toFixed(0)} MB ({storage.percentage.toFixed(1)}%)
                    </span>
                  </div>
                  <div className="w-full bg-slate-700 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all ${
                        storage.percentage >= 90 ? 'bg-red-500' :
                        storage.percentage >= 70 ? 'bg-yellow-500' :
                        'bg-blue-500'
                      }`}
                      style={{ width: `${Math.min(storage.percentage, 100)}%` }}
                    />
                  </div>
                </>
              )}
            </div>

            {/* Bottom Controls */}
            <div className="flex justify-between items-center gap-4">
              <div className="flex gap-4">
                <button
                  onClick={() => refreshMaps(true)}
                  disabled={loading}
                  className="px-6 py-2 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 rounded-lg flex items-center gap-2 transition"
                >
                  <RefreshCw size={16} />
                  Refresh
                </button>

                <label className="px-6 py-2 bg-green-700 hover:bg-green-600 disabled:bg-slate-800 rounded-lg flex items-center gap-2 transition cursor-pointer">
                  <Upload size={16} />
                  Upload Map
                  <input
                    type="file"
                    accept=".gdr"
                    onChange={handleMapUpload}
                    className="hidden"
                    disabled={loading}
                    multiple
                  />
                </label>

                <label className="px-6 py-2 bg-purple-700 hover:bg-purple-600 disabled:bg-slate-800 rounded-lg flex items-center gap-2 transition cursor-pointer">
                  <Upload size={16} />
                  Upload Music
                  <input
                    type="file"
                    accept=".mp3,.wav,.ogg"
                    onChange={handleMusicUpload}
                    className="hidden"
                    disabled={loading}
                    multiple
                  />
                </label>
              </div>

              <div className="flex gap-4">
                <button
                  onClick={() => setMusicEnabled(!musicEnabled)}
                  className={`px-4 py-2 rounded-lg flex items-center gap-2 transition ${
                    musicEnabled ? 'bg-blue-600 hover:bg-blue-500' : 'bg-slate-700 hover:bg-slate-600'
                  }`}
                >
                  <Music2 size={16} />
                  Music: {musicEnabled ? 'ON' : 'OFF'}
                </button>
                <button
                  onClick={() => setBeepEnabled(!beepEnabled)}
                  className={`px-4 py-2 rounded-lg flex items-center gap-2 transition ${
                    beepEnabled ? 'bg-blue-600 hover:bg-blue-500' : 'bg-slate-700 hover:bg-slate-600'
                  }`}
                >
                  <Volume2 size={16} />
                  Beep: {beepEnabled ? 'ON' : 'OFF'}
                </button>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* LEAD-IN STATE */}
      {state === 'lead_in' && (
        <div className="w-full h-screen flex flex-col items-center justify-center bg-gradient-to-b from-slate-900 to-slate-950 p-8">
          <div className="max-w-2xl w-full">
            {selectedMap && (
              <div className="text-center mb-8">
                <h2 className="text-4xl font-bold mb-2 text-slate-100">{selectedMap.name}</h2>
                <p className="text-slate-400">
                  {selectedMap.events} events | {selectedMap.fps.toFixed(0)} fps | {selectedMap.duration.toFixed(1)}s
                </p>
              </div>
            )}

            {/* Practice Settings */}
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 mb-6 space-y-6">
              <h3 className="text-xl font-semibold text-slate-100 mb-4">Practice Settings</h3>
              
              {/* Speed Control */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Playback Speed: {playbackSpeed.toFixed(2)}x
                </label>
                <input
                  type="range"
                  min="0.25"
                  max="2.0"
                  step="0.05"
                  value={playbackSpeed}
                  onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
                  className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
                <div className="flex justify-between text-xs text-slate-500 mt-1 px-1">
                  <span>0.25x</span>
                  <span className="relative" style={{left: '-12%'}}>0.5x</span>
                  <span className="relative" style={{left: '-7%'}}>1.0x</span>
                  <span className="relative">1.5x</span>
                  <span>2.0x</span>
                </div>
              </div>

              {/* Section Practice */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Practice Section (optional)
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Start Time (seconds)</label>
                    <input
                      type="number"
                      placeholder="0.00"
                      value={practiceStart}
                      onChange={(e) => setPracticeStart(e.target.value)}
                      step="0.01"
                      min="0"
                      max={selectedMap?.duration || 999}
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">End Time (seconds)</label>
                    <input
                      type="number"
                      placeholder={selectedMap?.duration.toFixed(2) || '999.99'}
                      value={practiceEnd}
                      onChange={(e) => setPracticeEnd(e.target.value)}
                      step="0.01"
                      min="0"
                      max={selectedMap?.duration || 999}
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  Leave empty to practice the entire map
                </p>
              </div>
            </div>

            {/* Start Button or Countdown */}
            {!countdownStarted ? (
              <div className="text-center space-y-4">
                <div className="flex justify-center gap-4">
                  <button
                    onClick={() => setCountdownStarted(true)}
                    className="px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-semibold transition flex items-center gap-2"
                  >
                    <Play size={20} />
                    Start Practice <span className="text-blue-200 text-sm">(Space)</span>
                  </button>
                  <button
                    onClick={() => setState('home')}
                    className="px-6 py-3 bg-slate-700 hover:bg-slate-600 rounded-lg transition flex items-center gap-2"
                  >
                    <Home size={16} />
                    Back to Home <span className="text-slate-400 text-sm">(Backspace)</span>
                  </button>
                </div>
                <p className="text-slate-400 text-sm">Adjust settings above, then press Space or click Start</p>
              </div>
            ) : (
              <div className="text-center">
                <h2 className="text-xl font-bold mb-4 text-slate-100">
                  Starting in {Math.max(0, leadInCountdown).toFixed(2)}s
                </h2>
                <p className="text-slate-400">SPACE: press/release. ESC: quit.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* PLAY STATE */}
      {state === 'play' && gameData && (
        <div className="w-full h-screen bg-slate-950 flex flex-col relative">
          <GameCanvas
            currentTime={currentTime}
            notes={gameData.notes}
            inputEvents={inputEvents}
            expectedEvents={gameData.events}
            targetX={targetX}
            laneY={laneY}
            scrollS={SCROLL_S}
            width={width}
            height={height}
          />

          {/* Stats overlay */}
          <div className="absolute top-4 left-4 text-sm text-slate-300 font-mono space-y-1">
            <p>t={Math.max(0, currentTime).toFixed(3)}s</p>
            <p>
              {(() => {
                const HIT_WINDOW_S = 0.018;
                // Get practice section bounds
                const sectionStart = practiceStart ? parseFloat(practiceStart) : 0;
                const sectionEnd = practiceEnd ? parseFloat(practiceEnd) : Infinity;
                
                // Filter events to only those in the practice section
                const sectionEvents = gameData.events.filter(exp => exp.t >= sectionStart && exp.t <= sectionEnd);
                
                // Judged = events in section whose hit window has passed
                const judged = sectionEvents.filter(exp => currentTime > exp.t + HIT_WINDOW_S).length;
                // Hits = inputs that matched an expected event within the hit window
                const hits = inputEvents.filter(evt =>
                  sectionEvents.some(exp => Math.abs(evt.actual_t - exp.t) <= HIT_WINDOW_S && evt.kind === exp.kind)
                ).length;
                const misses = judged - hits;
                return `judged=${judged}/${sectionEvents.length}   misses=${Math.max(0, misses)}`;
              })()}
            </p>
            <p>
              {(() => {
                const nextEvent = gameData.events.find(exp => exp.t > currentTime - 0.018);
                return nextEvent ? `Next: ${nextEvent.kind.toUpperCase()} @ ${nextEvent.t.toFixed(3)}s (f ${nextEvent.frame})` : '';
              })()}
            </p>
          </div>

          {/* Timing feedback display */}
          {timingFeedback && Date.now() - timingFeedback.time < 500 && (
            <div className="absolute top-1/3 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none">
              <p className={`text-4xl font-bold font-mono ${
                Math.abs(timingFeedback.offset) <= HIT_WINDOW_MS
                  ? 'text-green-400'
                  : timingFeedback.offset < 0
                    ? 'text-blue-400'
                    : 'text-orange-400'
              }`}>
                {timingFeedback.offset >= 0 ? '+' : ''}{timingFeedback.offset.toFixed(1)}ms
              </p>
            </div>
          )}

          {/* Exit hint */}
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 text-xs text-slate-500">
            ESC to exit
          </div>
        </div>
      )}

      {/* RESULTS STATE */}
      {state === 'results' && stats && (
        <div className="w-full h-screen bg-gradient-to-b from-slate-900 to-slate-950 p-8 flex flex-col items-center">
          <div className="w-full max-w-lg">
            <h1 className="text-4xl font-bold mb-2 text-slate-100">Run Results</h1>
            {selectedMap && <p className="text-slate-400 mb-8">Map: {selectedMap.name}</p>}

            {/* Stats Grid */}
            <div className="space-y-4 mb-8">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-800 p-4 rounded-lg">
                  <p className="text-slate-400 text-sm">Completion</p>
                  <p className="text-2xl font-bold text-slate-100">
                    {(stats.completion * 100).toFixed(1)}%
                  </p>
                </div>
                <div className="bg-slate-800 p-4 rounded-lg">
                  <p className="text-slate-400 text-sm">Hits</p>
                  <p className="text-2xl font-bold text-green-400">{Math.floor(stats.hits)}</p>
                </div>
                <div className="bg-slate-800 p-4 rounded-lg">
                  <p className="text-slate-400 text-sm">Misses</p>
                  <p className="text-2xl font-bold text-red-400">{Math.floor(stats.misses)}</p>
                </div>
                <div className="bg-slate-800 p-4 rounded-lg">
                  <p className="text-slate-400 text-sm">Unexpected</p>
                  <p className="text-2xl font-bold text-yellow-400">{Math.floor(stats.extras)}</p>
                </div>
              </div>

              <div className="bg-slate-800 p-4 rounded-lg">
                <p className="text-slate-400 text-sm">Mean Hit Offset</p>
                <p className="text-xl font-bold text-slate-100">
                  {stats.mean > 0 ? '+' : ''}{stats.mean.toFixed(2)} ms (negative=early, positive=late)
                </p>
              </div>
              <div className="bg-slate-800 p-4 rounded-lg">
                <p className="text-slate-400 text-sm">Worst Hit Offset</p>
                <p className="text-xl font-bold text-slate-100">{stats.worst.toFixed(2)} ms</p>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex justify-center items-center gap-4 mt-8">
            <button
              onClick={() => setState('home')}
              className="px-6 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg flex items-center gap-2 transition"
            >
              <Home size={16} />
              Back to Home <span className="text-slate-400 text-sm">(Backspace)</span>
            </button>

            <button
              onClick={() => handleMapSelect(selectedMap)}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg flex items-center gap-2 transition"
            >
              <Play size={16} />
              Play Again
            </button>

            <button
              onClick={handleExport}
              disabled={loading}
              className="px-6 py-2 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 rounded-lg flex items-center gap-2 transition"
            >
              <Download size={16} />
              Export Results
            </button>
          </div>
        </div>
      )}

      {/* EDIT MAP STATE */}
      {state === 'edit' && selectedMap && (
        <div className="w-full h-screen bg-gradient-to-b from-slate-900 to-slate-950 p-8">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-8">
              <h1 className="text-4xl font-bold text-slate-100">Edit Map</h1>
              <button
                onClick={() => setState('home')}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg flex items-center gap-2 transition"
              >
                <Home size={16} />
                Back to Home <span className="text-slate-400 text-sm">(Backspace)</span>
              </button>
            </div>

            <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 mb-6">
              <h2 className="text-xl font-semibold text-slate-100 mb-4">{selectedMap.name}</h2>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-slate-400">Events</p>
                  <p className="text-slate-100 font-mono">{selectedMap.events}</p>
                </div>
                <div>
                  <p className="text-slate-400">FPS</p>
                  <p className="text-slate-100 font-mono">{selectedMap.fps.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-slate-400">Duration</p>
                  <p className="text-slate-100 font-mono">{selectedMap.duration.toFixed(2)}s</p>
                </div>
              </div>
            </div>

            <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
              <p className="text-slate-400 text-center py-8">
                Map editing functionality coming soon...
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmModal.isOpen && (
        <div 
          className="fixed inset-0 bg-slate-900 bg-opacity-50 flex items-center justify-center z-50"
          onClick={closeConfirmModal}
        >
          <div 
            className="bg-slate-800 border-2 border-slate-700 rounded-lg p-6 max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-semibold text-slate-100 mb-4">Confirm Action</h3>
            <p className="text-slate-300 mb-6">{confirmModal.message}</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={closeConfirmModal}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition"
              >
                Cancel <span className="text-slate-400 text-sm">(Esc)</span>
              </button>
              <button
                onClick={handleConfirm}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg transition font-semibold"
              >
                Confirm <span className="text-slate-400 text-sm">(Enter)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Container */}
      <ToastContainer
        position="bottom-center"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="dark"
      />
    </div>
  );
}
