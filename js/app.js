class TheWalkApp {
    constructor() {
        this.isWalking = false;
        this.isPaused = false;
        this.pendingLayers = [];
        this.wakeLock = null; // Screen wake lock
        // Map state
        this.enableMap = false; // temporarily disable map to reduce memory/CPU while stabilizing GPS
        this.map = null;
        this.mapMarker = null;
        this.accuracyCircle = null;
        this._watchdog = null;
        this.ui = {
            coordinates: document.getElementById('coordinates'),
            accuracy: document.getElementById('accuracy'),
            activeLayers: document.getElementById('active-layers'),
            startButton: document.getElementById('start-walk'),
            pauseButton: document.getElementById('pause-walk'),
            resetButton: document.getElementById('reset-walk'),
            masterVolume: document.getElementById('master-volume'),
            volumeDisplay: document.getElementById('volume-display'),
            audioLayers: document.getElementById('audio-layers'),
            debugToggle: document.getElementById('debug-toggle'),
            debugOverlay: document.getElementById('debug-overlay'),
            debugZones: document.getElementById('debug-zones'),
            debugLayers: document.getElementById('debug-layers')
        };
        
        // Initialize loading state
        this.updateLoadingStatus();
        
        this.initializeEventListeners();
        this.initializeResilienceHooks();
        if (this.enableMap) this.initializeMap();
        // Load configuration (zones + audio) and track readiness
        this.configLoaded = false;
        this.audioPreloaded = false;
        this.configPromise = this.loadConfiguration().then(() => {
            this.configLoaded = true;
            console.log(`Configuration loaded: ${audioMixer.audioZones.length} zones`);
            // Render overlay with whatever position we have once zones exist
            this.updateDebugOverlay(locationService.currentPosition || null);
            // Don't preload audio automatically - wait for user gesture
            this.updateLoadingStatus();
        }).catch(err => {
            console.error('Configuration failed:', err);
            this.updateLoadingStatus();
        });
    }

    // Initialize event listeners
    initializeEventListeners() {
        // Start/Pause/Reset buttons
        this.ui.startButton.addEventListener('click', () => this.startWalk());
        this.ui.pauseButton.addEventListener('click', () => {
            if (this.isPaused) {
                this.resumeWalk();
            } else {
                this.pauseWalk();
            }
        });
        this.ui.resetButton.addEventListener('click', () => this.resetWalk());
        
        const testBtn = document.getElementById('test-audio');
        if (testBtn) {
            testBtn.addEventListener('click', async () => {
                try {
                    await audioMixer.initialize();
                    await audioMixer.resumeContext();
                    
                    // Stop any existing test audio first
                    audioMixer.stopLayer('test_audio_layer');
                    
                    // Register and load a temporary test layer (NON-LOOPING)
                    const testId = 'test_audio_layer';
                    audioMixer.registerLayerDefaults(testId, { loop: false, volume: 1.0, url: 'audio/audioTEST.mp3' });
                    await audioMixer.loadAudio('audio/audioTEST.mp3', testId);
                    
                    // Play once, no loop, 5 second duration max
                    audioMixer.playLayer(testId, 1.0, false);
                    
                    // Auto-stop after 5 seconds to prevent endless playback
                    setTimeout(() => {
                        audioMixer.stopLayer(testId);
                    }, 5000);
                    
                } catch (e) {
                    console.error('Audio test failed', e);
                    alert('Audio test failed. Check console for details.');
                }
            });
        }
        

        // GPS Permission button
        const requestGPSBtn = document.getElementById('request-gps');
        const startWalkBtn = document.getElementById('start-walk');
        if (requestGPSBtn) {
            requestGPSBtn.addEventListener('click', async () => {
                try {
                    requestGPSBtn.disabled = true;
                    requestGPSBtn.textContent = '📍 Requesting permission...';
                    
                    const permissionGranted = await locationService.requestPermission();
                    
                    if (permissionGranted) {
                        requestGPSBtn.textContent = '✅ GPS Allowed';
                        requestGPSBtn.style.backgroundColor = '#4CAF50';
                        startWalkBtn.disabled = false;
                        alert('GPS permission granted! Now click "Load and Start" to begin.');
                    } else {
                        requestGPSBtn.textContent = '❌ GPS Denied';
                        requestGPSBtn.style.backgroundColor = '#f44336';
                        requestGPSBtn.disabled = false;
                        alert('GPS permission was denied. Please enable location access in your browser settings and try again.');
                    }
                } catch (error) {
                    console.error('GPS permission error:', error);
                    requestGPSBtn.textContent = '❌ Error';
                    requestGPSBtn.disabled = false;
                    alert('Error requesting GPS permission: ' + error.message);
                }
            });
        }

        // Volume control
        this.ui.masterVolume.addEventListener('input', (e) => {
            const volume = e.target.value / 100;
            audioMixer.setMasterVolume(volume);
            this.ui.volumeDisplay.textContent = `${e.target.value}%`;
        });

        // Debug overlay toggle
        if (this.ui.debugToggle && this.ui.debugOverlay) {
            this.ui.debugToggle.addEventListener('change', (e) => {
                if (e.target.checked) {
                    this.ui.debugOverlay.classList.remove('hidden');
                    // Show GPS simulator and audio debug when debug is enabled
                    document.getElementById('simulator-panel').style.display = 'block';
                    document.getElementById('audio-debug-panel').style.display = 'block';
                } else {
                    this.ui.debugOverlay.classList.add('hidden');
                    // Hide GPS simulator and audio debug when debug is disabled
                    document.getElementById('simulator-panel').style.display = 'none';
                    document.getElementById('audio-debug-panel').style.display = 'none';
                }
            });
        }

        // GPS Simulator controls
        this.initializeGPSSimulator();

        // Location updates
        locationService.onLocationUpdate((position, error) => {
            // Skip real GPS updates if in simulation mode
            if (this.simulationMode) {
                console.log('[App] Ignoring real GPS - simulation mode active');
                return;
            }
            
            console.log('[App] Location update received:', position ? `${position.latitude.toFixed(6)}, ${position.longitude.toFixed(6)}` : 'null', error || '');
            
            if (error) {
                this.updateLocationDisplay(null, error);
                // Still update overlay to show GPS error/age info
                this.updateDebugOverlay(null);
                return;
            }
            
            this.updateLocationDisplay(position);
            if (this.enableMap) this.updateMap(position);
            
            if (this.isWalking) {
                // Progressive load nearby layers (essential ones already preloaded)
                audioMixer.progressivePreload(position);
                // Update mix
                audioMixer.updateLocationAudio(position);
                this.updateActiveLayersDisplay();
            }
            
            // Always update overlay with latest position (or null above)
            this.updateDebugOverlay(position);
        });
    }

    // Resilience: resume audio/GPS on visibility and restart watch if stale
    initializeResilienceHooks() {
        document.addEventListener('visibilitychange', async () => {
            if (document.visibilityState === 'visible' && this.isWalking) {
                try { await audioMixer.resumeContext(); } catch {}
                locationService.startWatch();
            }
        });

        // Watchdog: every 10s, ensure GPS updates are fresh (<15s old)
        this._watchdog = setInterval(() => {
            if (!this.isWalking) return;
            const age = locationService.getLastUpdateAge();
            if (age > 15000) {
                console.warn('GPS watchdog: restarting watch (age ms =', age, ')');
                locationService.startWatch();
                audioMixer.resumeContext().catch(() => {});
            }
        }, 10000);
    }

    // Load configuration from server (supports JSON and GeoJSON)
    async loadConfiguration() {
        try {
            const res = await fetch('/config/zones.geojson');
            if (!res.ok) throw new Error('Failed to load configuration');
            const cfg = await res.json();

            // Set master volume if provided
            if (cfg.globalSettings && typeof cfg.globalSettings.masterVolume === 'number') {
                const mv = Math.max(0, Math.min(1, cfg.globalSettings.masterVolume));
                audioMixer.setMasterVolume(mv);
                this.ui.masterVolume.value = Math.round(mv * 100);
                this.ui.volumeDisplay.textContent = `${Math.round(mv * 100)}%`;
            }

            // Helper to derive partId from a name like "music 2-3" => "audio2"
            const derivePartId = (name) => {
                if (!name || typeof name !== 'string') return null;
                const m = name.toLowerCase().match(/music\s+(\d+)[-\s_]/);
                if (m && m[1]) return `audio${m[1]}`;
                return null;
            };

            // If FeatureCollection (GeoJSON), parse points with radius_m
            if (cfg.type === 'FeatureCollection' && Array.isArray(cfg.features)) {
                for (const feature of cfg.features) {
                    if (!feature || !feature.properties) continue;
                    const props = feature.properties;
                    const partId = derivePartId(props.Name || props.id || props.name);

                    // Register and preload audio layers
                    if (Array.isArray(props.audioLayers)) {
                        for (const layer of props.audioLayers) {
                            if (!layer?.id || !layer?.file) continue;
                            audioMixer.registerLayerDefaults(layer.id, {
                                loop: layer.loop !== false,
                                volume: typeof layer.volume === 'number' ? layer.volume : 1.0,
                                url: layer.file
                            });
                            if (partId) {
                                audioMixer.registerLayerPart(layer.id, partId);
                            }
                            // Defer actual loading until after user gesture (startWalk)
                            this.pendingLayers.push({ id: layer.id, file: layer.file });
                        }
                    }

                    // Zones: support Point with radius_m
                    if (feature.geometry?.type === 'Point' && Array.isArray(feature.geometry.coordinates)) {
                        const [lng, lat] = feature.geometry.coordinates;
                        const radius = props.radius_m ?? props.radius ?? 50;
                        const fadeDistance = props.fadeDistance ?? 30;
                        const maxVolume = props.maxVolume ?? 0.8;
                        const layerIds = Array.isArray(props.audioLayers) ? props.audioLayers.map(l => l.id) : [];
                        const isOneshot = props.isOneshot === true || /^(oneshot\d+)/i.test(props.Name || props.id || '');

                        audioMixer.addAudioZone({
                            id: props.id || props.name || `zone_${Math.random().toString(36).slice(2, 7)}`,
                            center: { lat, lng },
                            radius,
                            audioLayers: layerIds,
                            fadeDistance,
                            maxVolume,
                            isOneshot
                        });
                    }
                }
                return;
            }

            // Fallback to existing JSON structure
            if (Array.isArray(cfg.audioZones)) {
                for (const zone of cfg.audioZones) {
                    // Register and preload layers for this zone
                    if (Array.isArray(zone.audioLayers)) {
                        for (const layer of zone.audioLayers) {
                            const id = typeof layer === 'string' ? layer : layer.id;
                            const file = typeof layer === 'string' ? null : layer.file;
                            const loop = typeof layer === 'string' ? true : (layer.loop !== false);
                            const vol = typeof layer === 'string' ? 1.0 : (typeof layer.volume === 'number' ? layer.volume : 1.0);

                            if (id) {
                                audioMixer.registerLayerDefaults(id, { loop, volume: vol, url: file || null });
                                if (file) this.pendingLayers.push({ id, file });
                            }
                        }
                    }

                    audioMixer.addAudioZone({
                        id: zone.id,
                        center: zone.center,
                        radius: zone.radius,
                        audioLayers: (zone.audioLayers || []).map(l => typeof l === 'string' ? l : l.id),
                        fadeDistance: zone.fadeDistance,
                        maxVolume: zone.maxVolume
                    });
                }
            }
        } catch (err) {
            console.error('Error loading configuration:', err);
        }
    }

    // Preload only essential audio files to avoid Safari memory limits
    async preloadEssentialAudio() {
        console.log('Starting essential audio preload with user gesture...');
        this.updateLoadingStatus('Initializing audio...');
        
        // Initialize audio context first with user gesture
        try {
            await audioMixer.initialize();
            await audioMixer.resumeContext();
        } catch (error) {
            console.error('Failed to initialize audio:', error);
            throw error;
        }
        
        // Preload specific layers by their IDs (not filenames)
        const essentialLayerIds = [
            // Audio 1 series - but these don't exist in zones.geojson yet
            // Audio 2 series - but these don't exist in zones.geojson yet
            // First two oneshots
            'oneshot1',
            'oneshot2'
        ];
        
        // Build list of files to preload from actual pendingLayers
        const essentialFiles = [];
        essentialLayerIds.forEach(layerId => {
            const layer = this.pendingLayers.find(l => l.id === layerId);
            if (layer && layer.file) {
                essentialFiles.push({ id: layerId, file: layer.file });
            }
        });
        
        // Note: audioTEST.mp3 NOT preloaded - will test dynamic loading
        
        let loaded = 0;
        let failed = 0;
        const total = essentialFiles.length;
        
        console.log(`Preloading ${total} essential audio files...`);
        this.updateLoadingStatus(`Loading audio... 0/${total}`);
        
        // Load files sequentially
        for (const item of essentialFiles) {
            try {
                console.log(`Loading: ${item.file} as ${item.id}`);
                await audioMixer.loadAudio(item.file, item.id);
                loaded++;
                this.updateLoadingStatus(`Loading audio... ${loaded}/${total}`);
                console.log(`✓ Loaded: ${item.file}`);
            } catch (error) {
                failed++;
                console.warn(`✗ Failed to load ${item.file}:`, error.message || error);
                this.updateLoadingStatus(`Loading audio... ${loaded}/${total} (${failed} failed)`);
            }
        }
        
        console.log(`Essential audio preload complete: ${loaded} loaded, ${failed} failed out of ${total} files`);
        console.log(`Remaining ${this.pendingLayers.length - loaded} files will load on-demand`);
        
        if (loaded === 0) {
            console.warn('No audio files were preloaded, but will load on-demand');
            // Don't throw - allow the app to continue and load files on-demand
        }
    }
    
    // Update loading status and enable/disable start button
    updateLoadingStatus(message = null) {
        const isReady = this.configLoaded && this.audioPreloaded;
        const configReady = this.configLoaded && !this.audioPreloaded;
        
        if (message) {
            this.ui.startButton.textContent = message;
            this.ui.startButton.disabled = true;
        } else if (isReady) {
            this.ui.startButton.textContent = 'Start The Walk';
            this.ui.startButton.disabled = false;
        } else if (configReady) {
            this.ui.startButton.textContent = 'Load Audio & Start';
            this.ui.startButton.disabled = false;
        } else {
            this.ui.startButton.textContent = 'Loading...';
            this.ui.startButton.disabled = true;
        }
    }

    // Initialize GPS Simulator for testing
    initializeGPSSimulator() {
        // Predefined locations from THE WALK-9.geojson
        const locations = {
            'sim-home': { lat: 33.9876053, lng: -118.4634005, name: 'Home' },
            'sim-start': { lat: 33.9889161, lng: -118.4624973, name: 'Start' },
            'sim-music1-1': { lat: 33.9891545, lng: -118.4628989, name: 'Music 1-1' },
            'sim-music2-1': { lat: 33.9899985, lng: -118.4640777, name: 'Music 2-1' },
            'sim-music3-1': { lat: 33.9907066, lng: -118.4664467, name: 'Music 3-1' },
            'sim-music4-1': { lat: 33.9917539, lng: -118.4702927, name: 'Music 4-1' },
            'sim-music5-1': { lat: 33.9909623, lng: -118.4675182, name: 'Music 5-1' },
            'sim-oneshot1': { lat: 33.989112, lng: -118.4627964, name: 'Oneshot 1' },
            'sim-oneshot2': { lat: 33.9897737, lng: -118.4637515, name: 'Oneshot 2' },
            'sim-oneshot3': { lat: 33.9904448, lng: -118.4655877, name: 'Oneshot 3' },
            'sim-oneshot4': { lat: 33.991068, lng: -118.4681901, name: 'Oneshot 4' },
            'sim-oneshot5': { lat: 33.9916976, lng: -118.4705502, name: 'Oneshot 5' },
            'sim-oneshot6': { lat: 33.9915864, lng: -118.4695822, name: 'Oneshot 6' },
            'sim-oneshot7': { lat: 33.9906851, lng: -118.4660381, name: 'Oneshot 7' },
            'sim-oneshot8': { lat: 33.9904132, lng: -118.4649178, name: 'Oneshot 8' },
            'sim-oneshot9': { lat: 33.9896510, lng: -118.4632691, name: 'Oneshot 9' }
        };

        // Add event listeners for simulator buttons
        Object.keys(locations).forEach(buttonId => {
            const button = document.getElementById(buttonId);
            if (button) {
                button.addEventListener('click', () => {
                    const loc = locations[buttonId];
                    this.simulateGPS(loc.lat, loc.lng, loc.name);
                });
            }
        });

        // Real GPS button
        const realGPSBtn = document.getElementById('sim-real-gps');
        if (realGPSBtn) {
            realGPSBtn.addEventListener('click', () => {
                this.disableGPSSimulation();
            });
        }
    }

    // Simulate GPS position
    simulateGPS(lat, lng, name) {
        const position = {
            latitude: lat,
            longitude: lng,
            accuracy: 5,
            timestamp: Date.now()
        };

        // Update status
        const statusEl = document.getElementById('simulator-status');
        if (statusEl) {
            statusEl.textContent = `📍 Simulating: ${name} (${lat.toFixed(6)}, ${lng.toFixed(6)})`;
        }

        // Stop real GPS tracking and inject simulated position
        locationService.stopTracking();
        locationService.currentPosition = position;
        
        // Override the location service callback to prevent real GPS updates
        this.simulationMode = true;
        
        // Trigger location update manually
        this.updateLocationDisplay(position);
        if (this.enableMap) this.updateMap(position);
        
        if (this.isWalking) {
            // Progressive load nearby layers (essential ones already preloaded)
            audioMixer.progressivePreload(position);
            // Update mix
            audioMixer.updateLocationAudio(position);
            this.updateActiveLayersDisplay();
        }
        
        // Always update overlay with simulated position
        this.updateDebugOverlay(position);
        
        console.log(`🎯 GPS Simulated: ${name} at ${lat}, ${lng}`);
    }

    // Disable GPS simulation and return to real GPS
    disableGPSSimulation() {
        const statusEl = document.getElementById('simulator-status');
        if (statusEl) {
            statusEl.textContent = '📡 Using real GPS - move around to test';
        }
        
        // Re-enable real GPS tracking
        this.simulationMode = false;
        if (this.isWalking) {
            locationService.startTracking();
        }
        
        console.log('🌍 GPS Simulation disabled - using real GPS');
    }

    // Start the walk experience
    async startWalk() {
        try {
            if (this.isWalking) return; // prevent double start
            
            // Ensure config is loaded
            if (!this.configLoaded) {
                alert('App is still loading configuration. Please wait...');
                return;
            }
            
            // If audio isn't preloaded yet, do it now with user gesture
            if (!this.audioPreloaded) {
                console.log('Starting essential audio preload with user gesture...');
                await this.preloadEssentialAudio();
                this.audioPreloaded = true;
                this.updateLoadingStatus();
            }
            // Start persistent tracking (permission should already be granted)
            locationService.startTracking();

            // Audio already initialized during preload

            // 2.5) Wait for first GPS fix so overlay/mixing have real data
            try {
                await locationService.waitForFix(12000);
            } catch (e) {
                console.warn('Proceeding without initial GPS fix:', e?.message || e);
            }

            // Request wake lock to keep screen on
            await this.requestWakeLock();

            // Update UI now that we're ready
            this.isWalking = true;
            this.isPaused = false;
            this.ui.startButton.disabled = true;
            this.ui.pauseButton.disabled = false;
            this.ui.resetButton.disabled = false;
            this.ui.startButton.textContent = 'Walking...';

            // All audio is already preloaded - no need to load anything else!
            console.log('The Walk started with all audio preloaded');
        } catch (error) {
            console.error('Failed to start walk:', error);
            alert('Failed to start The Walk.\n\nError: ' + (error.message || error) + '\n\nCheck the Audio Status panel for more details.');
        }
    }

    // Pause the walk (preserves oneshot history)
    pauseWalk() {
        if (!this.isWalking || this.isPaused) return;
        
        // Release wake lock when paused
        this.releaseWakeLock();
        
        // Stop location tracking
        locationService.stopTracking();
        
        // Pause all audio (but don't reset)
        audioMixer.audioLayers.forEach((layer, layerId) => {
            if (layer.isPlaying && !layerId.startsWith('oneshot')) {
                audioMixer.fadeLayer(layerId, 0, 0.5);
                setTimeout(() => audioMixer.stopLayer(layerId), 600);
            }
        });
        
        this.isPaused = true;
        this.ui.pauseButton.textContent = '▶️ RESUME';
        this.ui.pauseButton.style.backgroundColor = '#4CAF50';
        
        console.log('The Walk paused (oneshot history preserved)');
    }

    // Resume the walk
    async resumeWalk() {
        if (!this.isWalking || !this.isPaused) return;
        
        // Re-request wake lock when resuming
        await this.requestWakeLock();
        
        // Restart location tracking
        locationService.startTracking();
        
        this.isPaused = false;
        this.ui.pauseButton.textContent = '⏸️ PAUSE';
        this.ui.pauseButton.style.backgroundColor = '#ff9800';
        
        console.log('The Walk resumed');
    }

    // Reset the walk (clears oneshot history)
    resetWalk() {
        // Release wake lock
        this.releaseWakeLock();
        
        // Stop location tracking
        locationService.stopTracking();

        // CRITICAL: Stop test audio first to prevent conflicts
        audioMixer.stopLayer('test_audio_layer');
        
        // Fully reset audio engine including oneshot history
        if (audioMixer && typeof audioMixer.reset === 'function') {
            audioMixer.reset();
        } else {
            audioMixer.stopAll();
        }

        // Update UI
        this.isWalking = false;
        this.isPaused = false;
        this.ui.startButton.disabled = false;
        this.ui.pauseButton.disabled = true;
        this.ui.resetButton.disabled = true;
        this.ui.startButton.textContent = '▶️ Load and Start';
        this.ui.pauseButton.textContent = '⏸️ PAUSE';
        this.ui.pauseButton.style.backgroundColor = '#ff9800';
        this.ui.activeLayers.textContent = 'No active layers';
        this.ui.audioLayers.innerHTML = '';

        console.log('The Walk reset (oneshot history cleared)');
    }

    // Request wake lock to keep screen on
    async requestWakeLock() {
        try {
            if ('wakeLock' in navigator) {
                this.wakeLock = await navigator.wakeLock.request('screen');
                console.log('✅ Wake Lock active - screen will stay on');
                
                // Re-request wake lock if it's released (e.g., when tab becomes inactive)
                this.wakeLock.addEventListener('release', () => {
                    console.log('⚠️ Wake Lock released');
                });
            } else {
                console.warn('⚠️ Wake Lock API not supported on this device');
            }
        } catch (err) {
            console.error('❌ Failed to request wake lock:', err);
        }
    }

    // Release wake lock
    releaseWakeLock() {
        if (this.wakeLock) {
            this.wakeLock.release();
            this.wakeLock = null;
            console.log('🔓 Wake Lock released - screen can sleep');
        }
    }

    // Removed demo audio loader; real assets are preloaded from configuration

    // Update location display
    updateLocationDisplay(position, error = null) {
        if (error) {
            this.ui.coordinates.textContent = `Error: ${error}`;
            this.ui.accuracy.textContent = 'Accuracy: Unknown';
        } else if (position) {
            this.ui.coordinates.textContent = 
                `${position.latitude.toFixed(6)}, ${position.longitude.toFixed(6)}`;
            this.ui.accuracy.textContent = 
                `Accuracy: ±${Math.round(position.accuracy)}m`;
        }
        
        // CRITICAL: Always update debug overlay when location display updates
        this.updateDebugOverlay(position);
    }

    // Update active layers display
    updateActiveLayersDisplay() {
        const activeLayers = audioMixer.getActiveLayersInfo();
        
        if (activeLayers.length === 0) {
            this.ui.activeLayers.textContent = 'No active layers';
            this.ui.audioLayers.innerHTML = '';
        } else {
            this.ui.activeLayers.textContent = 
                `${activeLayers.length} layer(s) playing`;
            
            // Update visual layer indicators
            this.ui.audioLayers.innerHTML = '';
            activeLayers.forEach(layer => {
                const layerElement = document.createElement('div');
                layerElement.className = 'audio-layer';
                layerElement.innerHTML = `
                    <h4>${layer.id}</h4>
                    <div class="volume-bar">
                        <div class="volume-fill" style="width: ${layer.volume * 100}%"></div>
                    </div>
                `;
                this.ui.audioLayers.appendChild(layerElement);
            });
        }
    }

    // Update debug overlay with distances and active zones/layers
    updateDebugOverlay(position) {
        if (!this.ui.debugOverlay || this.ui.debugOverlay.classList.contains('hidden')) return;

        // Zones distances table
        const rows = [];
        if (position && audioMixer.audioZones && audioMixer.audioZones.length > 0) {
            audioMixer.audioZones.forEach(zone => {
                const d = audioMixer.calculateDistance(
                    position.latitude,
                    position.longitude,
                    zone.center.lat,
                    zone.center.lng
                );
                const inside = d <= zone.radius;
                rows.push({ id: zone.id, distance: d, inside });
            });
            rows.sort((a, b) => a.distance - b.distance);
        }

        const lastErr = locationService.lastError ? (locationService.lastError.message || String(locationService.lastError)) : null;
        const ageMs = locationService.getLastUpdateAge();
        const ageLabel = isFinite(ageMs) ? `${Math.round(ageMs/1000)}s` : 'n/a';
        const coord = (position || locationService.currentPosition) ? `${(position||locationService.currentPosition).latitude.toFixed(6)}, ${(position||locationService.currentPosition).longitude.toFixed(6)}` : 'n/a';
        const zoneCount = audioMixer.audioZones ? audioMixer.audioZones.length : 0;
        const debugTime = new Date().toLocaleTimeString();

        const zonesHtml = rows.length > 0 ? `
            <table class="debug-table">
                <thead><tr><th>Zone</th><th>Dist (m)</th><th>Status</th></tr></thead>
                <tbody>
                    ${rows.map(r => `
                        <tr>
                            <td class="mono">${r.id}</td>
                            <td>${Math.round(r.distance)}</td>
                            <td>${r.inside ? '<span class="debug-badge">active</span>' : '<span class="muted">out</span>'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        ` : '<div class="muted">No position yet</div>';
        this.ui.debugZones.innerHTML = `
            <div class="muted" style="margin-bottom:6px;">
              ${debugTime} · Coords: ${coord} · GPS age: ${ageLabel} · Zones: ${zoneCount}${lastErr ? ` · Last error: ${lastErr}` : ''}
            </div>
            ${zonesHtml}
        `;

        // Active layers list
        const layers = audioMixer.getActiveLayersInfo();
        if (layers.length === 0) {
            this.ui.debugLayers.innerHTML = '<span class="muted">No layers</span>';
        } else {
            this.ui.debugLayers.innerHTML = `
                <table class="debug-table">
                    <thead><tr><th>Layer</th><th>Vol</th></tr></thead>
                    <tbody>
                        ${layers.map(l => `
                            <tr>
                                <td class="mono">${l.id}</td>
                                <td>${(l.volume * 100).toFixed(0)}%</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }
    }

    // Initialize Leaflet map with OpenStreetMap tiles
    initializeMap() {
        const mapEl = document.getElementById('map');
        if (!mapEl || typeof L === 'undefined') return;

        // Default view: Venice area as placeholder; will recenter on first GPS fix
        this.map = L.map('map', { zoomControl: true }).setView([33.9892, -118.4629], 16);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(this.map);
    }

    // Update map marker and accuracy circle
    updateMap(position) {
        if (!this.map || !position) return;
        const latlng = [position.latitude, position.longitude];

        if (!this.mapMarker) {
            const markerIcon = L.icon({
                iconUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="%2300E0FF" stroke="black" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="6"/></svg>',
                iconSize: [28, 28],
                iconAnchor: [14, 14]
            });
            this.mapMarker = L.marker(latlng, { icon: markerIcon }).addTo(this.map);
            this.map.setView(latlng, 17);
        } else {
            this.mapMarker.setLatLng(latlng);
        }

        // Accuracy circle
        const radius = position.accuracy || 0;
        if (!this.accuracyCircle) {
            this.accuracyCircle = L.circle(latlng, {
                radius,
                color: '#00E0FF',
                fillColor: '#00E0FF',
                fillOpacity: 0.15,
                weight: 1
            }).addTo(this.map);
        } else {
            this.accuracyCircle.setLatLng(latlng);
            this.accuracyCircle.setRadius(radius);
        }
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.theWalkApp = new TheWalkApp();
    console.log('THE WALK app initialized');
});
