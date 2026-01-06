import { useState, useEffect, useRef } from 'react';
import { Music2, Volume2, Play, Home, Download, Search, Upload, X, Pencil } from 'lucide-react';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { api } from './api';
import GameCanvas from './GameCanvas';

export default function App() {
  // API Configuration
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

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
  const [pressOnlyMode, setPressOnlyMode] = useState(false);
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, message: '', onConfirm: null });
  const [leniencyConfig, setLeniencyConfig] = useState(null);
  const [editingMapData, setEditingMapData] = useState(null);
  const [initialLeniencyConfig, setInitialLeniencyConfig] = useState(null);
  const leniencyFormRef = useRef(null);

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
  const currentTimeRef = useRef(0);
  const inputEventsRef = useRef([]);
  const endingGameRef = useRef(false);

  // Configuration
  const HIT_WINDOW_MS = 18.0;
  const LEAD_IN_S = 1.5;
  const SCROLL_S = 2.5;
  const LANE_Y_FRAC = 0.55;
  const TARGET_FRAC = 1 / 3;
  const BEEP_VOLUME = 0.35 * 0.35 * 1.5; // ~0.18 (50% louder)

  // Tick conversion helpers
  const msToTicks = (ms, fps) => ms / (1000 / fps);
  const ticksToMs = (ticks, fps) => ticks * (1000 / fps);

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
        const response = await fetch(`${API_URL}/api/maps/download-zip`, {
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
        await downloadFile(`${API_URL}/api/maps/${encodeURIComponent(map.name)}/download`, `${map.name}.gdr`);
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

      const response = await fetch(`${API_URL}/api/maps/download-zip`, {
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

      const response = await fetch(`${API_URL}/api/maps/download-zip`, {
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

  const hasUnsavedChanges = () => {
    // With uncontrolled inputs, we can't easily track changes without reading form
    // For now, we'll skip this check to avoid lag
    return false;
  };

  const handleEditMap = async (e, map) => {
    e.stopPropagation(); // Prevent map selection when clicking edit

    try {
      setLoading(true);

      // Load map data and leniency configuration
      const [mapData, leniency] = await Promise.all([
        api.loadMap(map.name),
        api.getLeniency(map.name)
      ]);

      setSelectedMap(map);
      setEditingMapData(mapData);
      setLeniencyConfig(leniency);
      setInitialLeniencyConfig(JSON.parse(JSON.stringify(leniency))); // Deep copy
      setState('edit');
    } catch (err) {
      toast.error('Failed to load map editor');
    } finally {
      setLoading(false);
    }
  };

  const handleMapSelect = async (map) => {
    try {
      setLoading(true);
      const [data, leniency] = await Promise.all([
        api.loadMap(map.name),
        api.getLeniency(map.name)
      ]);
      setGameData(data);
      setSelectedMap(map);
      setLeniencyConfig(leniency);
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
          musicUrlRef.current = `${API_URL}${musicInfo.url}`;
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

    // Reset refs to avoid stale data
    currentTimeRef.current = startTime;
    inputEventsRef.current = [];
    endingGameRef.current = false;

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
      const timeValue = Math.max(0, t);
      currentTimeRef.current = timeValue;
      setCurrentTime(timeValue);

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
    const newEvent = { kind, actual_t: actualT };
    inputEventsRef.current = [...inputEventsRef.current, newEvent];
    setInputEvents((prev) => [...prev, newEvent]);
  };

  const endGame = async () => {
    // Prevent multiple simultaneous calls (race condition protection)
    if (endingGameRef.current) {
      console.warn('endGame: Already ending game, ignoring duplicate call');
      return;
    }
    endingGameRef.current = true;

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

    if (!selectedMap || !gameData) {
      console.warn('endGame: selectedMap or gameData is null', { selectedMap: !!selectedMap, gameData: !!gameData });
      setState('home');
      return;
    }

    // Use refs to get current values synchronously (avoids race conditions)
    const finalTime = currentTimeRef.current;
    const finalInputEvents = inputEventsRef.current;

    try {
      console.log('endGame: Evaluating results', {
        mapName: selectedMap.name,
        inputEventsCount: finalInputEvents.length,
        finalTime,
        pressOnlyMode,
        stateTime: currentTime,
        stateEventsCount: inputEvents.length
      });

      const result = await api.evaluateResults(selectedMap.name, finalInputEvents, {
        hit_window_ms: HIT_WINDOW_MS,
        end_time: finalTime,
        press_only_mode: pressOnlyMode,
      });

      console.log('endGame: Evaluation successful', result);
      setStats(result);
      setEndTime(finalTime);
      setState('results');
    } catch (err) {
      console.error('endGame: Failed to evaluate results', err);
      toast.error(`Failed to evaluate results: ${err.message || 'Unknown error'}`);
      setState('home');
    } finally {
      endingGameRef.current = false;
    }
  };

  const handleExport = async () => {
    if (!selectedMap || !gameData) return;

    try {
      setLoading(true);
      const result = await api.exportResults(selectedMap.name, inputEvents, {
        hit_window_ms: HIT_WINDOW_MS,
        end_time: endTime,
        press_only_mode: pressOnlyMode,
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
    if (!gameData || !gameData.events || !leniencyConfig) return;

    // In press-only mode, don't show feedback for releases
    if (pressOnlyMode && kind === 'up') return;

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

      // Get leniency for this event to determine if it's a hit
      const custom = leniencyConfig.custom[closestEvent.idx.toString()];
      const earlyWindow = custom?.early_ms ?? leniencyConfig.default_early_ms;
      const lateWindow = custom?.late_ms ?? leniencyConfig.default_late_ms;

      // Check if within leniency window (asymmetric)
      const isHit = (offsetMs < 0 && Math.abs(offsetMs) <= earlyWindow) || (offsetMs >= 0 && offsetMs <= lateWindow);

      setTimingFeedback({ offset: offsetMs, time: Date.now(), isHit });
    }
  };

  const handleKeyDown = (e) => {
    // Don't handle keyboard shortcuts when typing in input fields
    const isTyping = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';

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
    if (e.code === 'Space' && state === 'lead_in' && !countdownStarted && !isTyping) {
      e.preventDefault();
      setCountdownStarted(true);
      return;
    }

    if ((e.code === 'Space' || e.code === 'ArrowUp') && state === 'play' && !spaceHeldRef.current) {
      e.preventDefault();
      spaceHeldRef.current = true;
      recordInput('down', currentTime);
      calculateTimingFeedback('down', currentTime);
    }
    if (e.code === 'Escape' && state === 'play') {
      e.preventDefault();
      endGame();
    }
    if (e.code === 'Backspace' && (state === 'results' || state === 'edit' || state === 'lead_in') && !isTyping) {
      e.preventDefault();
      if (state === 'edit' && hasUnsavedChanges()) {
        showConfirmModal(
          'You have unsaved changes. Are you sure you want to leave?',
          () => setState('home')
        );
      } else {
        setState('home');
      }
    }
    if (e.code === 'Space' && state === 'results' && !isTyping) {
      e.preventDefault();
      handleMapSelect(selectedMap);
    }
  };

  const handleKeyUp = (e) => {
    if ((e.code === 'Space' || e.code === 'ArrowUp') && state === 'play') {
      e.preventDefault();
      spaceHeldRef.current = false;
      recordInput('up', currentTime);
      calculateTimingFeedback('up', currentTime);
    }
  };

  const handleTouchStart = (e) => {
    if (state === 'play' && !spaceHeldRef.current) {
      spaceHeldRef.current = true;
      recordInput('down', currentTimeRef.current);
      calculateTimingFeedback('down', currentTimeRef.current);
    }
  };

  const handleTouchEnd = (e) => {
    if (state === 'play' && spaceHeldRef.current) {
      spaceHeldRef.current = false;
      recordInput('up', currentTimeRef.current);
      calculateTimingFeedback('up', currentTimeRef.current);
    }
  };

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Add touch listeners with passive: false to allow preventDefault
    const playDiv = document.querySelector('[data-play-area]');
    if (playDiv && state === 'play') {
      playDiv.addEventListener('touchstart', handleTouchStart, { passive: false });
      playDiv.addEventListener('touchend', handleTouchEnd, { passive: false });
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);

      if (playDiv) {
        playDiv.removeEventListener('touchstart', handleTouchStart);
        playDiv.removeEventListener('touchend', handleTouchEnd);
      }
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
        <div className="w-full min-h-screen bg-linear-to-b from-slate-900 to-slate-950 p-4 sm:p-6 md:p-8 pb-8">
          <div className="max-w-4xl mx-auto">
            {/* Header */}
            <h1 className="text-xl sm:text-2xl font-bold mb-2 text-slate-100">GD Rhythm Trainer</h1>
            <p className="text-xs sm:text-sm text-slate-500 mb-4">
              Click a map to play
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
            <div className="border-2 border-slate-700 rounded-lg p-3 sm:p-4 md:p-6 mb-4 sm:mb-6 bg-slate-900">
              {/* Selection controls */}
              {maps.length > 0 && (
                <div className="mb-3 pb-3 sm:pb-4 border-b border-slate-700 space-y-2 sm:space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer text-xs sm:text-sm text-slate-300 hover:text-slate-100 transition">
                    <input
                      type="checkbox"
                      checked={filteredMaps.length > 0 && selectedMaps.length === filteredMaps.length}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 sm:w-5 sm:h-5 cursor-pointer appearance-none bg-slate-700 border-2 border-slate-600 rounded checked:bg-blue-600 checked:border-blue-600 hover:border-slate-500 transition"
                    />
                    Select All ({filteredMaps.length})
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={handleDownloadSelected}
                      disabled={loading || selectedMaps.length === 0}
                      className="px-2 sm:px-3 py-1.5 sm:py-1 text-xs sm:text-sm bg-green-700 hover:bg-green-600 disabled:bg-slate-700 disabled:text-slate-500 rounded transition whitespace-nowrap"
                    >
                      Download Selected ({selectedMaps.length})
                    </button>
                    <button
                      onClick={handleDownloadAll}
                      disabled={loading || maps.length === 0}
                      className="px-2 sm:px-3 py-1.5 sm:py-1 text-xs sm:text-sm bg-green-800 hover:bg-green-700 disabled:bg-slate-700 disabled:text-slate-500 rounded transition whitespace-nowrap"
                    >
                      Download All
                    </button>
                    <button
                      onClick={handleDeleteSelected}
                      disabled={loading || selectedMaps.length === 0}
                      className="px-2 sm:px-3 py-1.5 sm:py-1 text-xs sm:text-sm bg-red-700 hover:bg-red-600 disabled:bg-slate-700 disabled:text-slate-500 rounded transition whitespace-nowrap"
                    >
                      Delete Selected ({selectedMaps.length})
                    </button>
                    <button
                      onClick={handleDeleteAll}
                      disabled={loading || maps.length === 0}
                      className="px-2 sm:px-3 py-1.5 sm:py-1 text-xs sm:text-sm bg-red-900 hover:bg-red-800 disabled:bg-slate-700 disabled:text-slate-500 rounded transition whitespace-nowrap"
                    >
                      Delete All
                    </button>
                  </div>
                </div>
              )}
              <div className="min-h-[280px] sm:min-h-[320px] md:h-78 flex flex-col">
                {loading ? (
                  <p className="text-slate-400 text-sm">Loading maps...</p>
                ) : maps.length === 0 ? (
                  <p className="text-slate-400 text-sm">No maps found. Use "Upload Map" button below to add .gdr files</p>
                ) : filteredMaps.length === 0 ? (
                  <p className="text-slate-400 text-sm">No maps match your search</p>
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
                        <div className="flex items-center gap-1.5 sm:gap-2">
                          <button
                            onClick={(e) => handleDownloadMap(e, map)}
                            className="p-1.5 sm:p-2 rounded-lg bg-green-700 hover:bg-green-600 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex items-center justify-center"
                            disabled={loading}
                            title="Download map and music"
                          >
                            <Download size={18} className="text-white sm:w-5 sm:h-5" />
                          </button>
                          <button
                            onClick={(e) => handleEditMap(e, map)}
                            className="p-1.5 sm:p-2 rounded-lg bg-blue-700 hover:bg-blue-600 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex items-center justify-center"
                            disabled={loading}
                            title="Edit map"
                          >
                            <Pencil size={18} className="text-white sm:w-5 sm:h-5" />
                          </button>
                          <button
                            onClick={(e) => handleDeleteMap(e, map)}
                            className="p-1.5 sm:p-2 rounded-lg bg-red-700 hover:bg-red-600 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex items-center justify-center"
                            disabled={loading}
                            title="Delete map and music"
                          >
                            <X size={18} className="text-white sm:w-5 sm:h-5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Pagination - always visible with fixed height */}
              <div className="flex items-center justify-center gap-2 sm:gap-4 mt-3 sm:mt-0 min-h-[32px]">
                {filteredMaps.length > 4 ? (
                  <>
                    <button
                      onClick={() => setScrollOffset(Math.max(0, scrollOffset - 1))}
                      className="px-2 sm:px-3 py-1 text-xs sm:text-sm bg-slate-700 hover:bg-slate-600 rounded"
                    >
                      ←
                    </button>
                    <span className="text-xs sm:text-sm text-slate-400 w-24 sm:w-32 text-center">
                      {scrollOffset + 1}-{Math.min(scrollOffset + 4, filteredMaps.length)} of {filteredMaps.length}
                    </span>
                    <button
                      onClick={() => setScrollOffset(Math.min(scrollOffset + 1, filteredMaps.length - 4))}
                      className="px-2 sm:px-3 py-1 text-xs sm:text-sm bg-slate-700 hover:bg-slate-600 rounded"
                    >
                      →
                    </button>
                  </>
                ) : (
                  <span className="text-xs sm:text-sm text-slate-500">
                    {filteredMaps.length > 0 ? `${filteredMaps.length} map${filteredMaps.length !== 1 ? 's' : ''}` : ''}
                  </span>
                )}
              </div>
            </div>

            {/* Storage Tracker */}
            <div className="mb-4 h-12">
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
            <div className="flex flex-col sm:flex-row sm:justify-between gap-4">
              <div className="flex flex-wrap gap-2 sm:gap-4">
                <label className="px-4 sm:px-6 py-2 bg-green-700 hover:bg-green-600 disabled:bg-slate-800 rounded-lg flex items-center gap-2 transition cursor-pointer text-sm sm:text-base">
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

                <label className="px-4 sm:px-6 py-2 bg-purple-700 hover:bg-purple-600 disabled:bg-slate-800 rounded-lg flex items-center gap-2 transition cursor-pointer text-sm sm:text-base">
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

              <div className="flex flex-wrap gap-2 sm:gap-4">
                <button
                  onClick={() => setMusicEnabled(!musicEnabled)}
                  className={`px-3 sm:px-4 py-2 rounded-lg flex items-center gap-2 transition text-sm sm:text-base ${
                    musicEnabled ? 'bg-blue-600 hover:bg-blue-500' : 'bg-slate-700 hover:bg-slate-600'
                  }`}
                >
                  <Music2 size={16} />
                  Music: {musicEnabled ? 'ON' : 'OFF'}
                </button>
                <button
                  onClick={() => setBeepEnabled(!beepEnabled)}
                  className={`px-3 sm:px-4 py-2 rounded-lg flex items-center gap-2 transition text-sm sm:text-base ${
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

              {/* Press Only Mode */}
              <div>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pressOnlyMode}
                    onChange={(e) => setPressOnlyMode(e.target.checked)}
                    className="w-5 h-5 cursor-pointer appearance-none bg-slate-700 border-2 border-slate-600 rounded checked:bg-blue-600 checked:border-blue-600 hover:border-slate-500 transition"
                  />
                  <div>
                    <span className="text-sm font-medium text-slate-300">Press Only Mode</span>
                    <p className="text-xs text-slate-500 mt-1">
                      Only judge press events, ignore releases (like some GD game modes)
                    </p>
                  </div>
                </label>
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
                    <span className="sm:hidden">Start</span>
                    <span className="hidden sm:inline">Start Practice</span>
                    <span className="hidden sm:inline text-blue-200 text-sm">(Space)</span>
                  </button>
                  <button
                    onClick={() => setState('home')}
                    className="px-6 py-3 bg-slate-700 hover:bg-slate-600 rounded-lg transition flex items-center gap-2"
                  >
                    <Home size={16} />
                    <span className="sm:hidden">Back</span>
                    <span className="hidden sm:inline">Back to Home</span>
                    <span className="hidden sm:inline text-slate-400 text-sm">(Backspace)</span>
                  </button>
                </div>
                <p className="text-slate-400 text-sm">Adjust settings above, then press Space/↑ or click Start</p>
              </div>
            ) : (
              <div className="text-center">
                <h2 className="text-xl font-bold mb-4 text-slate-100">
                  Starting in {Math.max(0, leadInCountdown).toFixed(2)}s
                </h2>
                <p className="text-slate-400">
                  <span className="hidden sm:inline">SPACE/↑: press/release. ESC: quit.</span>
                  <span className="sm:hidden">Tap to press/release</span>
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* PLAY STATE */}
      {state === 'play' && gameData && (
        <div
          data-play-area
          className="w-full h-screen bg-slate-950 flex flex-col relative"
        >
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
                if (!leniencyConfig) return '';

                // Get practice section bounds
                const sectionStart = practiceStart ? parseFloat(practiceStart) : 0;
                const sectionEnd = practiceEnd ? parseFloat(practiceEnd) : Infinity;

                // Filter events to only those in the practice section
                let sectionEvents = gameData.events.filter(exp => exp.t >= sectionStart && exp.t <= sectionEnd);

                // In press-only mode, only count press events
                if (pressOnlyMode) {
                  sectionEvents = sectionEvents.filter(exp => exp.kind === 'down');
                }

                // Helper to get leniency for an event
                const getLeniency = (eventIdx) => {
                  const custom = leniencyConfig.custom[eventIdx.toString()];
                  return {
                    early: (custom?.early_ms ?? leniencyConfig.default_early_ms) / 1000,
                    late: (custom?.late_ms ?? leniencyConfig.default_late_ms) / 1000
                  };
                };

                // Judged = events whose late window has passed
                const judged = sectionEvents.filter(exp => {
                  const leniency = getLeniency(exp.idx);
                  return currentTime > exp.t + leniency.late;
                }).length;

                // Hits = inputs that matched an expected event within their leniency window
                const hits = inputEvents.filter(evt =>
                  sectionEvents.some(exp => {
                    if (evt.kind !== exp.kind) return false;
                    const leniency = getLeniency(exp.idx);
                    const offset = evt.actual_t - exp.t;
                    return offset >= -leniency.early && offset <= leniency.late;
                  })
                ).length;

                const misses = judged - hits;
                return `judged=${judged}/${sectionEvents.length}   misses=${Math.max(0, misses)}`;
              })()}
            </p>
            <p>
              {(() => {
                if (!leniencyConfig) return '';
                const getLeniency = (eventIdx) => {
                  const custom = leniencyConfig.custom[eventIdx.toString()];
                  return {
                    early: (custom?.early_ms ?? leniencyConfig.default_early_ms) / 1000,
                    late: (custom?.late_ms ?? leniencyConfig.default_late_ms) / 1000
                  };
                };

                // In press-only mode, only show next press event
                const nextEvent = gameData.events.find(exp => {
                  if (pressOnlyMode && exp.kind === 'up') return false;
                  const leniency = getLeniency(exp.idx);
                  return exp.t > currentTime - leniency.early;
                });
                return nextEvent ? `Next: ${nextEvent.kind.toUpperCase()} @ ${nextEvent.t.toFixed(3)}s (f ${nextEvent.frame})` : '';
              })()}
            </p>
          </div>

          {/* Timing feedback display - positioned above target box */}
          {timingFeedback && Date.now() - timingFeedback.time < 500 && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: `${((targetX + 10) / width) * 100}%`,
                top: `${((laneY - 120) / height) * 100}%`,
                transform: 'translate(-50%, -50%)'
              }}
            >
              <p className={`text-4xl font-bold font-mono ${
                timingFeedback.isHit
                  ? 'text-green-400'
                  : timingFeedback.offset < 0
                    ? 'text-blue-400'
                    : 'text-orange-400'
              }`}>
                {timingFeedback.offset >= 0 ? '+' : '-'}{Math.round(msToTicks(Math.abs(timingFeedback.offset), selectedMap.fps))} ticks
              </p>
              <p className="text-lg text-slate-300 text-center mt-1">
                ({timingFeedback.offset >= 0 ? '+' : ''}{timingFeedback.offset.toFixed(1)}ms)
              </p>
            </div>
          )}

          {/* Finish button */}
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-10">
            <button
              onClick={(e) => {
                e.stopPropagation();
                endGame();
              }}
              onTouchStart={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 active:bg-red-700 rounded-lg font-semibold transition text-sm sm:text-base shadow-lg pointer-events-auto"
            >
              Finish
              <span className="hidden sm:inline text-red-200 text-sm ml-2">(Esc)</span>
            </button>
          </div>
        </div>
      )}

      {/* RESULTS STATE */}
      {state === 'results' && stats && (
        <div className="w-full h-screen bg-gradient-to-b from-slate-900 to-slate-950 p-8 flex flex-col items-center">
          <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-8">
            <h1 className="text-4xl font-bold mb-2 text-slate-100">Run Results</h1>
            {selectedMap && <p className="text-slate-400">Map: {selectedMap.name}</p>}

            {/* Stats Grid */}
            <div className="space-y-4 mb-8">
              <div className="grid grid-cols-3 gap-4">
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
              </div>

              <div className="bg-slate-800 p-4 rounded-lg">
                <p className="text-slate-400 text-sm">Mean Offset Early</p>
                <p className="text-xl font-bold text-blue-400">
                  {stats.mean_early === 0 ? 'N/A' : (
                    <>
                      {Math.round(msToTicks(Math.abs(stats.mean_early), selectedMap.fps))} ticks
                      <span className="text-sm text-blue-300 block">
                        ({stats.mean_early.toFixed(2)} ms)
                      </span>
                    </>
                  )}
                </p>
              </div>
              <div className="bg-slate-800 p-4 rounded-lg">
                <p className="text-slate-400 text-sm">Mean Offset Late</p>
                <p className="text-xl font-bold text-orange-400">
                  {stats.mean_late === 0 ? 'N/A' : (
                    <>
                      +{Math.round(msToTicks(stats.mean_late, selectedMap.fps))} ticks
                      <span className="text-sm text-orange-300 block">
                        (+{stats.mean_late.toFixed(2)} ms)
                      </span>
                    </>
                  )}
                </p>
              </div>
            </div>

            {/* Detailed Results */}
            {stats.detailed_results && stats.detailed_results.length > 0 && (
              <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 max-h-[70vh] overflow-y-auto">
                <div className="space-y-2">
                  {stats.detailed_results.map((result, idx) => {
                        const isHit = result.verdict === 'hit';

                        return (
                          <div
                            key={idx}
                            className={`p-3 rounded-lg border-l-4 ${
                              isHit
                                ? 'bg-green-900/20 border-green-500'
                                : 'bg-red-900/20 border-red-500'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-4">
                                  <span className="text-sm font-mono text-slate-400">#{result.idx}</span>
                                  <span className={`text-sm font-semibold ${
                                    result.kind === 'down' ? 'text-blue-400' : 'text-purple-400'
                                  }`}>
                                    {result.kind === 'down' ? '▼ PRESS' : '▲ RELEASE'}
                                  </span>
                                  <span className="text-sm text-slate-400">
                                    @ {result.expected_t.toFixed(3)}s (f{result.expected_frame})
                                  </span>
                                </div>
                              </div>
                              <div className="text-right">
                                {isHit && result.offset_ms !== null && (
                                  <div>
                                    <span className="text-lg font-bold text-green-400">
                                      {result.offset_ms >= 0 ? '+' : ''}{Math.round(msToTicks(result.offset_ms, selectedMap.fps))} ticks
                                    </span>
                                    <span className="text-xs text-slate-400 block">
                                      ({result.offset_ms >= 0 ? '+' : ''}{result.offset_ms.toFixed(1)}ms)
                                    </span>
                                  </div>
                                )}
                                {!isHit && (
                                  <span className="text-lg font-bold text-red-400">
                                    {result.actual_t === null ? 'NO INPUT' : 'MISS'}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                </div>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex justify-center items-center gap-4 mt-8">
            <button
              onClick={() => setState('home')}
              className="px-6 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg flex items-center gap-2 transition"
            >
              <Home size={16} />
              <span className="sm:hidden">Back</span>
              <span className="hidden sm:inline">Back to Home</span>
              <span className="hidden sm:inline text-slate-400 text-sm">(Backspace)</span>
            </button>

            <button
              onClick={() => handleMapSelect(selectedMap)}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg flex items-center gap-2 transition"
            >
              <Play size={16} />
              <span className="sm:hidden">Retry</span>
              <span className="hidden sm:inline">Play Again</span>
              <span className="hidden sm:inline text-blue-200 text-sm">(Space)</span>
            </button>

            <button
              onClick={handleExport}
              disabled={loading}
              className="px-6 py-2 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 rounded-lg flex items-center gap-2 transition"
            >
              <Download size={16} />
              <span className="sm:hidden">Export</span>
              <span className="hidden sm:inline">Export Results</span>
            </button>
          </div>
        </div>
      )}

      {/* EDIT MAP STATE */}
      {state === 'edit' && selectedMap && editingMapData && leniencyConfig && (
        <div className="w-full min-h-screen bg-gradient-to-b from-slate-900 to-slate-950 p-4 sm:p-8">
          <div className="max-w-6xl mx-auto">
          <form ref={leniencyFormRef} onSubmit={(e) => e.preventDefault()}>
            <div className="flex items-center justify-between mb-6">
              <h1 className="text-2xl sm:text-4xl font-bold text-slate-100">Edit Leniency</h1>
              <button
                onClick={() => {
                  if (hasUnsavedChanges()) {
                    showConfirmModal(
                      'You have unsaved changes. Are you sure you want to leave?',
                      () => setState('home')
                    );
                  } else {
                    setState('home');
                  }
                }}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg flex items-center gap-2 transition text-sm"
              >
                <Home size={16} />
                Back <span className="hidden sm:inline text-slate-400 text-sm">(Backspace)</span>
              </button>
            </div>

            {/* Map Info */}
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 sm:p-6 mb-6">
              <h2 className="text-lg sm:text-xl font-semibold text-slate-100 mb-4">{selectedMap.name}</h2>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-slate-400">Events</p>
                  <p className="text-slate-100 font-mono">{editingMapData.events.length}</p>
                </div>
                <div>
                  <p className="text-slate-400">FPS</p>
                  <p className="text-slate-100 font-mono">{editingMapData.fps.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-slate-400">Duration</p>
                  <p className="text-slate-100 font-mono">{editingMapData.duration.toFixed(2)}s</p>
                </div>
              </div>
            </div>

            {/* Default Leniency */}
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 sm:p-6 mb-6">
              <h3 className="text-lg font-semibold text-slate-100 mb-4">Default Leniency</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-2">Early Leniency (ticks)</label>
                  <input
                    name="default_early"
                    defaultValue={Math.round(msToTicks(leniencyConfig.default_early_ms, editingMapData.fps))}
                    className="w-full px-3 py-2 bg-slate-700 border-2 border-slate-600 rounded text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-2">Late Leniency (ticks)</label>
                  <input
                    name="default_late"
                    defaultValue={Math.round(msToTicks(leniencyConfig.default_late_ms, editingMapData.fps))}
                    className="w-full px-3 py-2 bg-slate-700 border-2 border-slate-600 rounded text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Events List */}
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 sm:p-6 mb-6">
              <h3 className="text-lg font-semibold text-slate-100 mb-4">Event Leniency Settings</h3>
              <p className="text-sm text-slate-400 mb-4">
                Customize early/late leniency for individual events. Empty fields use default values.
              </p>

              <div className="max-h-[500px] overflow-y-auto space-y-2">
                {editingMapData.events.map((event) => {
                  const customLeniency = leniencyConfig.custom[event.idx.toString()];
                  return (
                    <div key={event.idx} className="bg-slate-700 p-3 rounded-lg">
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-4 items-center">
                        {/* Event info */}
                        <div className="sm:col-span-4">
                          <p className="text-xs text-slate-400">
                            Event #{event.idx}
                          </p>
                          <p className="text-sm text-slate-100 font-mono">
                            {event.kind.toUpperCase()} @ {event.t.toFixed(3)}s (f{event.frame})
                          </p>
                        </div>

                        {/* Early leniency */}
                        <div className="sm:col-span-3">
                          <label className="block text-xs text-slate-400 mb-1">Early (ticks)</label>
                          <input
                            name={`event_${event.idx}_early`}
                            placeholder="Default"
                            defaultValue={customLeniency?.early_ms !== undefined ? Math.round(msToTicks(customLeniency.early_ms, editingMapData.fps)) : ''}
                            className="w-full px-2 py-1 bg-slate-600 border-2 border-slate-500 rounded text-slate-100 text-sm focus:outline-none focus:border-blue-500 transition"
                          />
                        </div>

                        {/* Late leniency */}
                        <div className="sm:col-span-3">
                          <label className="block text-xs text-slate-400 mb-1">Late (ticks)</label>
                          <input
                            name={`event_${event.idx}_late`}
                            placeholder="Default"
                            defaultValue={customLeniency?.late_ms !== undefined ? Math.round(msToTicks(customLeniency.late_ms, editingMapData.fps)) : ''}
                            className="w-full px-2 py-1 bg-slate-600 border-2 border-slate-500 rounded text-slate-100 text-sm focus:outline-none focus:border-blue-500 transition"
                          />
                        </div>

                        {/* Clear button */}
                        <div className="sm:col-span-2 flex items-center">
                          {customLeniency && (
                            <button
                              type="button"
                              onClick={(e) => {
                                const form = e.target.closest('form');
                                form[`event_${event.idx}_early`].value = '';
                                form[`event_${event.idx}_late`].value = '';
                              }}
                              className="w-full px-2 py-1 bg-red-700 hover:bg-red-600 rounded text-xs transition"
                            >
                              Reset
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Save Button */}
            <div className="flex justify-between items-center">
              <button
                type="button"
                onClick={() => {
                  if (hasUnsavedChanges()) {
                    showConfirmModal(
                      'You have unsaved changes. Are you sure you want to leave?',
                      () => setState('home')
                    );
                  } else {
                    setState('home');
                  }
                }}
                className="px-6 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    setLoading(true);

                    // Read form values and build leniency config
                    const form = leniencyFormRef.current;
                    const defaultEarly = parseFloat(form.default_early.value);
                    const defaultLate = parseFloat(form.default_late.value);

                    const custom = {};
                    editingMapData.events.forEach((event) => {
                      const earlyValue = form[`event_${event.idx}_early`]?.value;
                      const lateValue = form[`event_${event.idx}_late`]?.value;

                      if (earlyValue || lateValue) {
                        const entry = {};

                        if (earlyValue) {
                          entry.early_ms = ticksToMs(parseFloat(earlyValue), editingMapData.fps);
                        }

                        if (lateValue) {
                          entry.late_ms = ticksToMs(parseFloat(lateValue), editingMapData.fps);
                        }

                        // Only save if entry has at least one field
                        if (Object.keys(entry).length > 0) {
                          custom[event.idx.toString()] = entry;
                        }
                      }
                    });

                    const newConfig = {
                      default_early_ms: ticksToMs(defaultEarly, editingMapData.fps),
                      default_late_ms: ticksToMs(defaultLate, editingMapData.fps),
                      custom
                    };

                    await api.updateLeniency(selectedMap.name, newConfig);
                    setLeniencyConfig(newConfig);
                    setInitialLeniencyConfig(JSON.parse(JSON.stringify(newConfig)));
                    toast.success('Leniency settings saved');
                    setState('home');
                  } catch (err) {
                    toast.error('Failed to save leniency settings');
                  } finally {
                    setLoading(false);
                  }
                }}
                disabled={loading}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 rounded-lg transition font-semibold"
              >
                Save Changes
              </button>
            </div>
            </form>
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
                Cancel <span className="hidden sm:inline text-slate-400 text-sm">(Esc)</span>
              </button>
              <button
                onClick={handleConfirm}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg transition font-semibold"
              >
                Confirm <span className="hidden sm:inline text-slate-400 text-sm">(Enter)</span>
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
