class AudioMixer {
    constructor() {
        this.audioContext = null;
        this.masterGain = null;
        this.musicBus = null;      // Master bus for music (fades with distance)
        this.oneshotBus = null;    // Master bus for oneshots/voiceover (full volume)
        this.audioLayers = new Map();
        this.audioZones = [];
        this.isInitialized = false;
        this.masterVolume = 0.7;

        // Part-based grouping
        this.layerToPart = new Map(); // layerId -> partId
        this.partToLayers = new Map(); // partId -> Set(layerIds)
        this.startedParts = new Set(); // parts that have been started (sources running)
        this.layerGains = new Map(); // layerId -> GainNode for quick access
        this.loadingLayers = new Set(); // layerIds currently loading

        // Oneshot management
        this.playedOneshots = new Set(); // zoneId set (played this session)
        this.activeOneshots = new Set(); // layerIds currently playing as oneshots
        
        // Debug info for phone
        this.lastDebugMessage = '';
        
        // Track loading promises so we can wait for them
        this.loadingPromises = new Map(); // layerId -> Promise
    }

    // Simple readiness check
    isReady() {
        return this.isInitialized && this.audioContext && this.masterGain;
    }
    // Initialize Web Audio API
    async initialize() {
        if (this.isInitialized) return;

        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Create master gain
            this.masterGain = this.audioContext.createGain();
            this.masterGain.connect(this.audioContext.destination);
            this.masterGain.gain.setValueAtTime(this.masterVolume, this.audioContext.currentTime);
            
            // Create music bus (for distance-based music)
            this.musicBus = this.audioContext.createGain();
            this.musicBus.connect(this.masterGain);
            this.musicBus.gain.setValueAtTime(1.0, this.audioContext.currentTime);
            
            // Create oneshot bus (for voiceover - always full volume)
            this.oneshotBus = this.audioContext.createGain();
            this.oneshotBus.connect(this.masterGain);
            this.oneshotBus.gain.setValueAtTime(1.0, this.audioContext.currentTime);
            
            this.isInitialized = true;
            console.log('AudioMixer initialized with separate music and oneshot buses');
        } catch (error) {
            console.error('Failed to initialize AudioContext:', error);
            throw error;
        }
    }

    // Resume audio context (required for user interaction)
    async resumeContext() {
        if (this.audioContext && this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
    }

    // Load audio file
    async loadAudio(url, layerId) {
        try {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            
            // If layer exists, update its buffer while preserving ALL existing properties
            const existing = this.audioLayers.get(layerId) || {};
            const layer = {
                buffer: audioBuffer,
                source: existing.source || null,
                gainNode: existing.gainNode || null,
                isPlaying: existing.isPlaying || false,
                loop: existing.loop ?? true,
                volume: existing.volume ?? 1.0,
                url: existing.url || url  // Preserve existing URL!
            };

            this.audioLayers.set(layerId, layer);
            console.log(`Audio loaded: ${layerId}`);
            return layer;
        } catch (error) {
            console.error(`Failed to load audio ${layerId}:`, error);
            throw error;
        }
    }

    // Ensure a layer's buffer is loaded (on-demand). Safe to call repeatedly.
    async ensureLayerLoaded(layerId) {
        const layer = this.audioLayers.get(layerId);
        if (!layer) {
            console.log(`❌ ensureLayerLoaded: ${layerId} not found`);
            return;
        }
        if (layer.buffer) {
            console.log(`✓ ${layerId} already loaded`);
            return; // already loaded
        }
        
        // If already loading, wait for that promise instead of starting a new load
        if (this.loadingPromises.has(layerId)) {
            console.log(`⏳ ${layerId} already loading - waiting...`);
            return await this.loadingPromises.get(layerId);
        }
        
        if (!layer.url) {
            console.log(`❌ ${layerId} has no URL`);
            return; // nowhere to load from
        }

        console.log(`📥 Starting load: ${layerId} from ${layer.url}`);
        
        // Create and store the loading promise
        const loadPromise = (async () => {
            try {
                this.loadingLayers.add(layerId);
                this.updateAudioDebugPanel(); // Update UI to show loading
                await this.loadAudio(layer.url, layerId);
                console.log(`✅ Loaded: ${layerId}`);
            } catch (e) {
                console.warn(`❌ Load failed: ${layerId}`, e);
                throw e;
            } finally {
                this.loadingLayers.delete(layerId);
                this.loadingPromises.delete(layerId);
                this.updateAudioDebugPanel(); // Update UI after load
            }
        })();
        
        this.loadingPromises.set(layerId, loadPromise);
        return await loadPromise;
    }

    // Progressive preload: load layers for zones near the user to avoid pops
    async progressivePreload(position) {
        if (!position) return;
        const margin = 150; // meters beyond zone edge to begin loading
        for (const zone of this.audioZones) {
            const d = this.calculateDistance(
                position.latitude,
                position.longitude,
                zone.center.lat,
                zone.center.lng
            );
            const preloadDistance = (zone.radius || 0) + (zone.fadeDistance || 0) + margin;
            if (d <= preloadDistance) {
                for (const layerId of zone.audioLayers) {
                    // kick off loads in background, no await to keep UI snappy
                    this.ensureLayerLoaded(layerId);
                }
            }
        }
    }

    // Register a layer's default properties before loading audio data
    registerLayerDefaults(layerId, { loop = true, volume = 1.0, url = null } = {}) {
        const existing = this.audioLayers.get(layerId) || {};
        this.audioLayers.set(layerId, {
            buffer: existing.buffer ?? null,
            source: null,
            gainNode: null,
            isPlaying: false,
            loop: loop,
            volume: Math.max(0, Math.min(1, volume)),
            url: url || existing.url || null
        });
    }

    // Register mapping of a layer to a part
    registerLayerPart(layerId, partId) {
        if (!partId || !layerId) return;
        this.layerToPart.set(layerId, partId);
        if (!this.partToLayers.has(partId)) this.partToLayers.set(partId, new Set());
        this.partToLayers.get(partId).add(layerId);
    }

    // Start all layers in a part simultaneously (immediate start, gain 0)
    startPart(partId) {
        if (!partId) {
            console.log(`⚠️ startPart called with no partId`);
            return;
        }
        if (this.startedParts.has(partId)) {
            console.log(`✓ Part ${partId} already started`);
            return;
        }
        const layerSet = this.partToLayers.get(partId);
        if (!layerSet || layerSet.size === 0) {
            console.log(`⚠️ Part ${partId} has no layers registered`);
            return;
        }

        console.log(`🎬 Starting part ${partId} with layers: ${[...layerSet].join(', ')}`);

        // Ensure all layers are loaded before starting the part
        let allLoaded = true;
        const notLoaded = [];
        layerSet.forEach(layerId => {
            const l = this.audioLayers.get(layerId);
            if (!l || !l.buffer) {
                allLoaded = false;
                notLoaded.push(layerId);
            }
        });
        if (!allLoaded) {
            this.lastDebugMessage = `Part ${partId} waiting for: ${notLoaded.join(', ')}`;
            console.log(`⏳ ${this.lastDebugMessage}`);
            this.updateAudioDebugPanel();
            return;
        }

        layerSet.forEach(layerId => {
            const l = this.audioLayers.get(layerId);
            if (!l || !l.buffer) return; // guard
            if (l.isPlaying) return;

            // Create source and gain
            l.source = this.audioContext.createBufferSource();
            l.gainNode = this.audioContext.createGain();
            l.source.buffer = l.buffer;
            l.source.loop = true; // part layers are looping
            // Start muted; mixing happens via fades
            l.gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
            l.source.connect(l.gainNode);
            l.gainNode.connect(this.musicBus); // Route through music bus
            l.source.start();
            l.isPlaying = true;
            this.layerGains.set(layerId, l.gainNode);
        });

        this.startedParts.add(partId);
        this.lastDebugMessage = `✓ Started ${partId} (${layerSet.size} layers)`;
        console.log(`Part started: ${partId} (layers: ${[...layerSet].join(', ')})`);
        this.updateAudioDebugPanel();
    }

    // Create audio zone configuration
    addAudioZone(config) {
        const zone = {
            id: config.id,
            center: config.center, // {lat, lng}
            radius: config.radius, // in meters
            audioLayers: config.audioLayers, // array of layer IDs
            fadeDistance: config.fadeDistance || 50, // fade distance in meters
            maxVolume: config.maxVolume || 1.0,
            isOneshot: config.isOneshot || false, // CRITICAL: preserve oneshot flag
        };
        this.audioZones.push(zone);
        console.log(`Audio zone added: ${zone.id} (oneshot: ${zone.isOneshot})`);
    }

    // Play a specific layer with volume control
    playLayer(layerId, volume = 1.0, loop = true) {
        const layer = this.audioLayers.get(layerId);
        if (!layer || !layer.buffer) {
            console.warn(`Layer ${layerId} not found or not loaded`);
            return;
        }

        // Ensure audio context is running
        if (this.audioContext.state === 'suspended') {
            console.warn(`⚠️ AudioContext suspended - attempting to resume`);
            this.audioContext.resume();
        }

        // Stop existing source if playing
        if (layer.source) {
            try {
                layer.source.stop();
            } catch (e) {
                console.warn('Error stopping existing source:', e);
            }
            layer.source = null;
        }

        // Create new source
        const source = this.audioContext.createBufferSource();
        source.buffer = layer.buffer;
        source.loop = loop;

        // Create gain node for this layer - START AT ZERO to prevent blips
        const gainNode = this.audioContext.createGain();
        const currentTime = this.audioContext.currentTime;
        gainNode.gain.setValueAtTime(0, currentTime); // Start silent
        
        // Connect: source -> gain -> musicBus -> masterGain -> destination
        source.connect(gainNode);
        gainNode.connect(this.musicBus); // Route through music bus

        // Store references
        layer.source = source;
        layer.gainNode = gainNode;
        layer.isPlaying = true;

        // Start playback (silent)
        source.start();
        
        // Fade in to target volume over 50ms to prevent blips
        const targetGain = volume * this.masterVolume;
        gainNode.gain.linearRampToValueAtTime(targetGain, currentTime + 0.05);
        
        console.log(`🔊 Playing layer: ${layerId} vol=${volume} gain=${targetGain} (fading in)`);
        
        // Update visual debug panel
        this.updateAudioDebugPanel();
    }
    
    // Update visual audio debug panel for phone testing
    updateAudioDebugPanel() {
        const panel = document.getElementById('audio-debug-info');
        if (!panel) return;
        
        const playingLayers = [];
        const loadingLayers = [];
        const loadedLayers = [];
        const registeredLayers = [];
        const noUrlLayers = [];
        const startedParts = [];
        const partInfo = [];
        
        this.audioLayers.forEach((layer, id) => {
            registeredLayers.push(id);
            if (!layer.url) {
                noUrlLayers.push(id);
            }
            if (layer.isPlaying && layer.gainNode) {
                playingLayers.push(`${id}: vol=${layer.gainNode.gain.value.toFixed(2)}`);
            } else if (layer.buffer) {
                loadedLayers.push(id);
            }
        });
        
        this.loadingLayers.forEach(id => loadingLayers.push(id));
        this.startedParts.forEach(partId => startedParts.push(partId));
        
        // Show part-to-layers mapping
        this.partToLayers.forEach((layerSet, partId) => {
            const started = this.startedParts.has(partId) ? '✓' : '✗';
            partInfo.push(`${started} ${partId}: ${layerSet.size} layers`);
        });
        
        const activeOneshotsList = Array.from(this.activeOneshots);
        
        // Oneshot completion status (1-9 + finale)
        const oneshotStatus = [];
        for (let i = 1; i <= 9; i++) {
            const zoneId = `oneshot_${i}`;
            const played = this.playedOneshots.has(zoneId);
            oneshotStatus.push(`${played ? '✅' : '⬜'} ${i}`);
        }
        const finaleZoneId = 'oneshot_finale';
        const finalePlayed = this.playedOneshots.has(finaleZoneId);
        oneshotStatus.push(`${finalePlayed ? '✅' : '⬜'} F`);
        
        // Get oneshot proximity info (stored by updateLocationAudio)
        const proximityInfo = this._oneshotProximity || [];
        const nearbyOneshots = proximityInfo
            .filter(o => !o.played && parseFloat(o.distance) < 50)
            .sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance))
            .slice(0, 5);
        
        panel.innerHTML = `
            <strong>Context:</strong> ${this.audioContext ? this.audioContext.state : 'null'}<br>
            <strong>Master Vol:</strong> ${this.masterVolume.toFixed(2)}<br>
            <strong>Music Bus:</strong> ${this.musicBus ? (this.musicBus.gain.value * 100).toFixed(0) + '%' : 'N/A'}<br>
            ${this.lastDebugMessage ? `<strong style="color:#ff6b00;">Debug:</strong> ${this.lastDebugMessage}<br>` : ''}
            <strong>Oneshots Completed:</strong><br>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;font-size:0.9em;margin:4px 0;">
                ${oneshotStatus.map(s => `<span>${s}</span>`).join('')}
            </div>
            ${nearbyOneshots.length > 0 ? `<strong style="color:#00ff00;">📍 Nearby Oneshots:</strong><br>${nearbyOneshots.map(o => `• ${o.id}: ${o.distance}m (trigger: ${o.radius}m)`).join('<br>')}<br>` : ''}
            <strong>Active Oneshots (${activeOneshotsList.length}):</strong><br>
            ${activeOneshotsList.length > 0 ? activeOneshotsList.map(id => `• ${id}`).join('<br>') : '• None'}<br>
            <strong>Parts:</strong><br>
            ${partInfo.length > 0 ? partInfo.map(p => `• ${p}`).join('<br>') : '• None'}<br>
            <strong>Playing (${playingLayers.length}):</strong><br>
            ${playingLayers.length > 0 ? playingLayers.map(l => `• ${l}`).join('<br>') : '• None'}<br>
            <strong>Loading (${loadingLayers.length}):</strong><br>
            ${loadingLayers.length > 0 ? Array.from(loadingLayers).map(l => `⏳ ${l}`).join('<br>') : '• None'}<br>
            <strong>Loaded:</strong> ${loadedLayers.length}
        `;
    }

    // Stop audio layer
    stopLayer(layerId) {
        const layer = this.audioLayers.get(layerId);
        if (!layer || !layer.isPlaying) return;

        if (layer.source) {
            layer.source.stop();
        }
        
        layer.isPlaying = false;
        layer.source = null;
        layer.gainNode = null;
        
        console.log(`Stopped layer: ${layerId}`);
    }

    // Update layer volume
    setLayerVolume(layerId, volume) {
        const layer = this.audioLayers.get(layerId);
        if (!layer) return;

        layer.volume = Math.max(0, Math.min(1, volume));
        
        if (layer.gainNode) {
            layer.gainNode.gain.setValueAtTime(
                layer.volume * this.masterVolume,
                this.audioContext.currentTime
            );
        }
    }

    // Fade layer volume over time
    fadeLayer(layerId, targetVolume, duration = 1.0) {
        const layer = this.audioLayers.get(layerId);
        if (!layer) {
            console.log(`⚠️ fadeLayer: ${layerId} not found`);
            return;
        }
        
        // Get gain node from layer or layerGains map (for part-managed layers)
        const gainNode = layer.gainNode || this.layerGains.get(layerId);
        if (!gainNode) {
            console.log(`⚠️ fadeLayer: ${layerId} has no gainNode (isPlaying=${layer.isPlaying})`);
            return;
        }

        const currentTime = this.audioContext.currentTime;
        const currentGain = gainNode.gain.value;
        const targetGain = targetVolume * this.masterVolume;
        
        gainNode.gain.setValueAtTime(currentGain, currentTime);
        gainNode.gain.linearRampToValueAtTime(targetGain, currentTime + duration);
        
        layer.volume = targetVolume;
        console.log(`🎚️ Fading ${layerId}: ${currentGain.toFixed(3)} → ${targetGain.toFixed(3)} over ${duration}s`);
        
        // Update debug panel to show new volume
        setTimeout(() => this.updateAudioDebugPanel(), duration * 1000 + 100);
    }

    // Set master volume
    setMasterVolume(volume) {
        this.masterVolume = Math.max(0, Math.min(1, volume));
        if (this.masterGain) {
            this.masterGain.gain.setValueAtTime(
                this.masterVolume,
                this.audioContext.currentTime
            );
        }
    }

    // Update audio based on location
    async updateLocationAudio(position) {
        if (!position || !this.isReady()) return;

        // --- Step 1: Handle Oneshots ---
        const oneshotDistances = []; // Track all oneshot distances for debugging
        
        this.audioZones.forEach(zone => {
            if (!zone.isOneshot) return;
            
            const distance = this.calculateDistance(position.latitude, position.longitude, zone.center.lat, zone.center.lng);
            const triggerRadius = Math.max(1, zone.radius || 10);
            const alreadyPlayed = this.playedOneshots.has(zone.id);
            
            // Log proximity to ALL oneshots for debugging
            oneshotDistances.push({
                id: zone.id,
                distance: distance.toFixed(1),
                radius: triggerRadius,
                played: alreadyPlayed,
                willTrigger: distance <= triggerRadius && !alreadyPlayed
            });
            
            if (distance <= triggerRadius && !alreadyPlayed) {
                // If finale has been played, don't trigger any more oneshots
                if (this.playedOneshots.has('oneshot_finale') && zone.id !== 'oneshot_finale') {
                    console.log(`🏁 Walk completed - ignoring ${zone.id}`);
                    return;
                }
                
                // Special check for finale oneshot - only requires oneshot9 to have been played
                if (zone.id === 'oneshot_finale') {
                    const oneshot9Played = this.playedOneshots.has('oneshot_9');
                    
                    if (!oneshot9Played) {
                        console.log(`🔒 Finale locked: oneshot9 not yet played (distance: ${distance.toFixed(1)}m)`);
                        this.lastDebugMessage = `Finale locked: need oneshot9 first`;
                        this.updateAudioDebugPanel();
                        return; // Don't trigger finale yet
                    }
                    console.log(`🎉 Oneshot9 completed! Triggering finale!`);
                }
                
                this.playedOneshots.add(zone.id);
                console.log(`💥 Oneshot triggered: ${zone.id} (distance: ${distance.toFixed(1)}m, radius: ${triggerRadius}m, accuracy: ±${position.accuracy?.toFixed(1) || '?'}m)`);
                this.lastDebugMessage = `Triggered: ${zone.id} @ ${distance.toFixed(1)}m`;
                this.updateAudioDebugPanel();
                
                zone.audioLayers.forEach(async (layerId) => {
                    await this.ensureLayerLoaded(layerId);
                    this.playOneShot(layerId);
                });
            }
        });
        
        // Store proximity data for debug panel display
        this._oneshotProximity = oneshotDistances;
        
        // Log oneshot proximity summary to console (only show closest 3 unplayed)
        const unplayedClose = oneshotDistances
            .filter(o => !o.played && parseFloat(o.distance) < 50)
            .sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance))
            .slice(0, 3);
        
        if (unplayedClose.length > 0) {
            console.log(`📍 Nearby oneshots: ${unplayedClose.map(o => `${o.id}:${o.distance}m`).join(', ')}`);
        }

        // --- Step 2: Calculate Music Layer Volumes and Identify Active Layers ---
        const layerTargetVolumes = new Map();
        for (const zone of this.audioZones) {
            if (zone.isOneshot) continue;

            const distance = this.calculateDistance(position.latitude, position.longitude, zone.center.lat, zone.center.lng);
            let volume = 0;
            if (distance <= zone.radius) {
                const fadeStart = Math.max(0, zone.radius - zone.fadeDistance);
                volume = (distance <= fadeStart)
                    ? zone.maxVolume
                    : zone.maxVolume * ((zone.radius - distance) / zone.fadeDistance);
                this.lastDebugMessage = `Zone ${zone.id}: dist=${distance.toFixed(0)}m, vol=${volume.toFixed(2)}`;
            }

            zone.audioLayers.forEach(layerId => {
                const currentTargetVol = layerTargetVolumes.get(layerId) || 0;
                layerTargetVolumes.set(layerId, Math.max(currentTargetVol, volume));
            });
        }

        // --- Step 3: Start Queued Parts ---
        const partsToStart = new Set();
        for (const layerId of layerTargetVolumes.keys()) {
            if (layerTargetVolumes.get(layerId) > 0) {
                const partId = this.layerToPart.get(layerId);
                if (partId && !this.startedParts.has(partId)) {
                    partsToStart.add(partId);
                }
            }
        }

        if (partsToStart.size > 0) {
            for (const partId of partsToStart) {
                const layerSet = this.partToLayers.get(partId);
                if (layerSet) {
                    const loadPromises = Array.from(layerSet).map(id => this.ensureLayerLoaded(id));
                    await Promise.all(loadPromises);
                }
                this.startPart(partId);
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        // --- Step 4: Apply Fades to All Music Layers ---
        this.audioLayers.forEach((layer, layerId) => {
            // Skip oneshots entirely - they manage their own playback
            if (this.activeOneshots.has(layerId)) return;
            if (layerId.startsWith('oneshot')) return;

            const targetVolume = layerTargetVolumes.get(layerId) || 0;

            if (targetVolume > 0) {
                if (!layer.isPlaying) {
                    this.playLayer(layerId, targetVolume);
                } else {
                    this.fadeLayer(layerId, targetVolume, 0.4);
                }
            } else if (layer.isPlaying) {
                const partId = this.layerToPart.get(layerId);
                if (partId) {
                    this.fadeLayer(layerId, 0, 0.8);
                } else {
                    this.fadeLayer(layerId, 0, 0.8);
                    setTimeout(() => this.stopLayer(layerId), 900);
                }
            }
        });

        this.updateAudioDebugPanel();
    }

    // Play a oneshot layer once at max volume, no fades
    playOneShot(layerId) {
        const layer = this.audioLayers.get(layerId);
        if (!layer) {
            console.error(`❌ playOneShot: layer ${layerId} not found`);
            return;
        }
        if (!layer.buffer) {
            console.error(`❌ playOneShot: layer ${layerId} has no buffer`);
            return;
        }
        // If already playing as oneshot, ignore
        if (this.activeOneshots.has(layerId)) {
            console.log(`⏭️ Oneshot ${layerId} already playing, skipping`);
            return;
        }

        const source = this.audioContext.createBufferSource();
        const gain = this.audioContext.createGain();
        source.buffer = layer.buffer;
        source.loop = false;
        gain.gain.setValueAtTime(1.0, this.audioContext.currentTime); // Full volume
        source.connect(gain);
        gain.connect(this.oneshotBus); // Route through oneshot bus, not master

        this.activeOneshots.add(layerId);
        layer.isPlaying = true;
        source.start();
        
        console.log(`💥 Oneshot playing: ${layerId} at full volume via oneshot bus`);
        this.lastDebugMessage = `Playing oneshot: ${layerId}`;
        this.updateAudioDebugPanel();

        // Apply ducking based on which oneshot is playing
        if (layerId === 'oneshot8') {
            // Special case: oneshot8 - drop music to 0, fade back in over last 30 seconds
            this.duckMusicBus(0, 0.5); // Duck to 0% over 0.5 seconds
            // Schedule fade back in to start 30 seconds before end (at 55.6 seconds)
            setTimeout(() => {
                this.duckMusicBus(1.0, 30); // Fade back to 100% over 30 seconds
            }, 55600);
        } else if (layerId === 'oneshot5') {
            // Special case: oneshot5 (AI takes over) - drop music to 0%, fade back in over last 20 seconds
            this.duckMusicBus(0, 0.5); // Duck to 0% over 0.5 seconds
            // Schedule fade back in to start 20 seconds before end (at 70 seconds for 90s track)
            setTimeout(() => {
                this.duckMusicBus(1.0, 20); // Fade back to 100% over 20 seconds
            }, 70000);
        } else {
            // Standard ducking: drop to 60%
            this.duckMusicBus(0.6, 0.3);
        }

        source.onended = () => {
            this.activeOneshots.delete(layerId);
            layer.isPlaying = false;
            console.log(`✓ Oneshot finished: ${layerId}`);
            
            // Restore music volume when oneshot ends (unless it's oneshot5 or oneshot8, which handle their own fade-in)
            if (layerId !== 'oneshot5' && layerId !== 'oneshot8' && this.activeOneshots.size === 0) {
                this.duckMusicBus(1.0, 0.5); // Fade back to 100% over 0.5 seconds
            }
        };
    }

    // Duck the music bus to a specific gain level
    duckMusicBus(targetGain, duration) {
        if (!this.musicBus) return;
        
        const currentTime = this.audioContext.currentTime;
        this.musicBus.gain.cancelScheduledValues(currentTime);
        this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, currentTime);
        this.musicBus.gain.linearRampToValueAtTime(targetGain, currentTime + duration);
        
        console.log(`🎚️ Ducking music bus: ${(this.musicBus.gain.value * 100).toFixed(0)}% → ${(targetGain * 100).toFixed(0)}% over ${duration}s`);
    }

    // Calculate distance between two points
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371e3; // Earth's radius in meters
        const φ1 = lat1 * Math.PI/180;
        const φ2 = lat2 * Math.PI/180;
        const Δφ = (lat2-lat1) * Math.PI/180;
        const Δλ = (lon2-lon1) * Math.PI/180;

        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                  Math.cos(φ1) * Math.cos(φ2) *
                  Math.sin(Δλ/2) * Math.sin(Δλ/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        return R * c;
    }

    // Get active layers info
    getActiveLayersInfo() {
        const active = [];
        this.audioLayers.forEach((layer, layerId) => {
            if (layer.isPlaying) {
                active.push({
                    id: layerId,
                    volume: layer.volume
                });
            }
        });
        return active;
    }

    // Stop all audio
    stopAll() {
        this.audioLayers.forEach((layer, layerId) => {
            this.stopLayer(layerId);
        });
    }

    // Reset mixer state between runs
    reset() {
        this.stopAll();
        this.startedParts.clear();
        this.playedOneshots.clear();
        this.activeOneshots.clear();
        this.layerGains.clear();
        // Clear isPlaying flags to prevent stale state
        this.audioLayers.forEach(layer => {
            layer.isPlaying = false;
            layer.source = null;
            layer.gainNode = null;
        });
        // do not clear audioLayers buffers so we can reuse loaded assets
    }
}

// Create global instance
window.audioMixer = new AudioMixer();
