class LocationService {
    constructor() {
        this.watchId = null;
        this.currentPosition = null;
        this.isTracking = false;
        this.callbacks = [];
        this.options = {
            enableHighAccuracy: true,
            timeout: 60000, // allow up to 60s before timeout
            maximumAge: 5000
        };
        this._restartTimer = null;
        this._pollTimer = null;
        this.lastError = null;
    }

    // Wait for the first GPS fix or timeout
    waitForFix(timeoutMs = 10000) {
        return new Promise((resolve, reject) => {
            if (this.currentPosition) return resolve(this.currentPosition);
            let done = false;
            const onUpdate = (pos, err) => {
                if (done) return;
                if (pos) {
                    done = true;
                    // remove temp listener
                    this.callbacks = this.callbacks.filter(cb => cb !== onUpdate);
                    resolve(pos);
                }
            };
            this.onLocationUpdate(onUpdate);
            const t = setTimeout(() => {
                if (done) return;
                done = true;
                // remove temp listener
                this.callbacks = this.callbacks.filter(cb => cb !== onUpdate);
                reject(new Error('GPS fix timeout'));
            }, timeoutMs);
        });
    }

    // Milliseconds since last location update (Infinity if none)
    getLastUpdateAge() {
        if (!this.currentPosition || !this.currentPosition.timestamp) return Infinity;
        return Date.now() - this.currentPosition.timestamp;
    }

    // Add callback for location updates
    onLocationUpdate(callback) {
        this.callbacks.push(callback);
    }

    // Start tracking location
    startTracking() {
        if (!navigator.geolocation) {
            throw new Error('Geolocation is not supported by this browser');
        }

        if (this.isTracking) {
            return;
        }

        this.isTracking = true;
        this.startWatch();
        this.startPolling();
    }

    // Request permission with a single, short geolocation call (no persistent watch)
    requestPermission() {
        if (!navigator.geolocation) {
            return Promise.reject(new Error('Geolocation is not supported by this browser'));
        }
        return new Promise((resolve) => {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    // Warm the cache and notify listeners once
                    this.handleLocationUpdate(position);
                    resolve(true);
                },
                (error) => {
                    // Notify error but still resolve to allow flow to continue
                    this.handleLocationError(error);
                    resolve(false);
                },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
            );
        });
    }

    // Internal: (re)start watchPosition with current options
    startWatch() {
        // Clear any existing watch first
        if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }

        // Get an initial fix quickly (shorter timeout) then start a longer watch
        navigator.geolocation.getCurrentPosition(
            (position) => this.handleLocationUpdate(position),
            (error) => this.handleLocationError(error),
            { ...this.options, timeout: 15000 }
        );

        this.watchId = navigator.geolocation.watchPosition(
            (position) => this.handleLocationUpdate(position),
            (error) => this.handleLocationError(error),
            this.options
        );
    }

    // Fallback polling alongside watchPosition (helps on iOS when watch stalls)
    startPolling() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
        }
        this._pollTimer = setInterval(() => {
            if (!this.isTracking) return;
            console.log('[LocationService] polling for position...');
            navigator.geolocation.getCurrentPosition(
                (position) => { 
                    console.log('[LocationService] poll success'); 
                    this.handleLocationUpdate(position); 
                },
                (error) => { 
                    console.warn('[LocationService] poll error', error.message || error); 
                    this.handleLocationError(error); 
                },
                { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
            );
        }, 2000);
    }

    // Stop tracking location
    stopTracking() {
        if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }
        this.isTracking = false;
        if (this._restartTimer) {
            clearTimeout(this._restartTimer);
            this._restartTimer = null;
        }
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
    }

    // Handle location updates
    handleLocationUpdate(position) {
        console.log('[LocationService] update', position && position.coords);
        this.currentPosition = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: Date.now() // Use current time, not position.timestamp
        };

        // Notify all callbacks
        this.callbacks.forEach(callback => {
            try {
                callback(this.currentPosition);
            } catch (e) {
                console.error('Location callback error:', e);
            }
        });
    }

    // Handle location errors
    handleLocationError(error) {
        this.lastError = error;
        let message = '';
        switch(error.code) {
            case error.PERMISSION_DENIED:
                message = 'Location access denied by user';
                break;
            case error.POSITION_UNAVAILABLE:
                message = 'Location information unavailable';
                break;
            case error.TIMEOUT:
                message = 'Location request timed out';
                break;
            default:
                message = 'Unknown location error';
                break;
        }
        
        console.error('Location error:', message);
        
        // Notify callbacks of error
        this.callbacks.forEach(callback => {
            callback(null, message);
        });

        // Auto-recover: if still tracking, debounce a watch restart
        if (this.isTracking) {
            if (this._restartTimer) clearTimeout(this._restartTimer);
            this._restartTimer = setTimeout(() => {
                this.startWatch();
            }, 2000);
        }
    }

    // Calculate distance between two points (in meters)
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

    // Get current position
    getCurrentPosition() {
        return this.currentPosition;
    }

    // Check if currently tracking
    isCurrentlyTracking() {
        return this.isTracking;
    }
}

// Create global instance
window.locationService = new LocationService();
