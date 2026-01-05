const API_BASE = `${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/api`;

export const api = {
  // Get all available maps
  async getMaps(refresh = false) {
    const url = refresh ? `${API_BASE}/maps?refresh=true` : `${API_BASE}/maps`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch maps');
    return response.json();
  },

  // Load specific map data
  async loadMap(mapName, options = {}) {
    const { btn = 1, second_player = false, hold_min_frames = 3 } = options;
    const params = new URLSearchParams({
      btn,
      second_player,
      hold_min_frames,
    });
    const response = await fetch(`${API_BASE}/maps/${mapName}/load?${params}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) throw new Error('Failed to load map');
    return response.json();
  },

  // Evaluate gameplay results
  async evaluateResults(mapName, inputEvents, options = {}) {
    const {
      btn = 1,
      second_player = false,
      hit_window_ms = 18.0,
      hold_min_frames = 3,
      end_time = null,
      press_only_mode = false,
    } = options;

    const response = await fetch(`${API_BASE}/results/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        map_name: mapName,
        btn,
        second_player,
        hit_window_ms,
        hold_min_frames,
        input_events: inputEvents,
        end_time: end_time,
        press_only_mode,
      }),
    });
    if (!response.ok) throw new Error('Failed to evaluate results');
    return response.json();
  },

  // Export results to file
  async exportResults(mapName, inputEvents, options = {}) {
    const {
      btn = 1,
      second_player = false,
      hit_window_ms = 18.0,
      hold_min_frames = 3,
      end_time = null,
      press_only_mode = false,
    } = options;

    const response = await fetch(`${API_BASE}/results/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        map_name: mapName,
        btn,
        second_player,
        hit_window_ms,
        hold_min_frames,
        input_events: inputEvents,
        end_time: end_time,
        press_only_mode,
      }),
    });
    if (!response.ok) throw new Error('Failed to export results');
    return response.json();
  },

  // Check if music exists for a map
  async getMusic(mapName) {
    const response = await fetch(`${API_BASE}/music/${mapName}`);
    if (!response.ok) return null;
    return response.json();
  },

  // Get storage usage
  async getStorage() {
    const response = await fetch(`${API_BASE}/storage`);
    if (!response.ok) throw new Error('Failed to fetch storage info');
    return response.json();
  },

  // Upload a map file
  async uploadMap(file) {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_BASE}/maps/upload`, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const error = new Error(errorData.detail || 'Failed to upload map');
      error.status = response.status;
      throw error;
    }
    return response.json();
  },

  // Upload a music file
  async uploadMusic(file) {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_BASE}/music/upload`, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const error = new Error(errorData.detail || 'Failed to upload music');
      error.status = response.status;
      throw error;
    }
    return response.json();
  },

  // Delete a map
  async deleteMap(mapName) {
    const response = await fetch(`${API_BASE}/maps/${mapName}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete map');
    return response.json();
  },

  // Delete a music file
  async deleteMusic(filename) {
    const response = await fetch(`${API_BASE}/music/${filename}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete music');
    return response.json();
  },

  // Get leniency configuration for a map
  async getLeniency(mapName) {
    const response = await fetch(`${API_BASE}/maps/${mapName}/leniency`);
    if (!response.ok) throw new Error('Failed to fetch leniency config');
    return response.json();
  },

  // Update leniency configuration for a map
  async updateLeniency(mapName, leniencyConfig) {
    const response = await fetch(`${API_BASE}/maps/${mapName}/leniency`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(leniencyConfig),
    });
    if (!response.ok) throw new Error('Failed to update leniency config');
    return response.json();
  },
};
