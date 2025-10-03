// Zone Debug Map - Shows all music zones with radius and fade distance circles
class ZoneDebugMap {
    constructor() {
        this.map = null;
        this.userMarker = null;
        this.zoneMarkers = [];
        this.zoneCircles = [];
        this.init();
    }

    async init() {
        // Wait for Leaflet to be loaded
        if (typeof L === 'undefined') {
            console.error('Leaflet not loaded');
            return;
        }

        // Initialize map centered on the walk area
        this.map = L.map('zone-map').setView([33.9905, -118.4665], 16);

        // Add Stadia Dark tile layer (same as main map)
        L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a>, &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="http://openstreetmap.org">OpenStreetMap</a> contributors',
            maxZoom: 20
        }).addTo(this.map);

        // Load zones and add markers
        await this.loadZones();

        // Listen for location updates
        if (window.locationService) {
            window.locationService.onLocationUpdate((position) => {
                this.updateUserPosition(position);
            });
        }
    }

    async loadZones() {
        try {
            const response = await fetch('config/zones.geojson');
            const data = await response.json();

            data.features.forEach(feature => {
                const props = feature.properties;
                const coords = feature.geometry.coordinates;
                
                // Only show music zones (not oneshots or start)
                if (props.Name && props.Name.startsWith('music')) {
                    this.addZoneMarker(props, coords);
                }
            });
        } catch (error) {
            console.error('Error loading zones:', error);
        }
    }

    addZoneMarker(props, coords) {
        const lat = coords[1];
        const lng = coords[0];
        const radius = props.radius_m || 50;
        const fadeDistance = props.fadeDistance || 30;

        // Color coding by music section
        let color = '#00ff00';
        if (props.Name.includes('music 1')) color = '#ff0000';
        else if (props.Name.includes('music 2')) color = '#00ff00';
        else if (props.Name.includes('music 3')) color = '#0000ff';
        else if (props.Name.includes('music 4')) color = '#ffff00';
        else if (props.Name.includes('music 5')) color = '#ff00ff';

        // Add marker
        const marker = L.circleMarker([lat, lng], {
            radius: 5,
            fillColor: color,
            color: '#fff',
            weight: 1,
            opacity: 1,
            fillOpacity: 0.8
        }).addTo(this.map);

        // Add popup with zone info
        marker.bindPopup(`
            <strong>${props.Name}</strong><br>
            Radius: ${radius}m<br>
            Fade: ${fadeDistance}m<br>
            Max Volume: ${props.maxVolume}
        `);

        // Add inner circle (zone radius)
        const innerCircle = L.circle([lat, lng], {
            radius: radius,
            color: color,
            weight: 2,
            fillColor: color,
            fillOpacity: 0.1
        }).addTo(this.map);

        // Add outer circle (fade distance)
        const outerCircle = L.circle([lat, lng], {
            radius: radius + fadeDistance,
            color: color,
            weight: 1,
            dashArray: '5, 5',
            fillColor: color,
            fillOpacity: 0.05
        }).addTo(this.map);

        this.zoneMarkers.push(marker);
        this.zoneCircles.push(innerCircle, outerCircle);
    }

    updateUserPosition(position) {
        if (!this.map) return;

        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        // Remove old marker
        if (this.userMarker) {
            this.map.removeLayer(this.userMarker);
        }

        // Add new marker for user position
        this.userMarker = L.circleMarker([lat, lng], {
            radius: 8,
            fillColor: '#ffffff',
            color: '#000',
            weight: 2,
            opacity: 1,
            fillOpacity: 1
        }).addTo(this.map);

        // Add accuracy circle if available
        if (position.coords.accuracy) {
            L.circle([lat, lng], {
                radius: position.coords.accuracy,
                color: '#ffffff',
                weight: 1,
                fillColor: '#ffffff',
                fillOpacity: 0.1
            }).addTo(this.map);
        }
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new ZoneDebugMap();
    });
} else {
    new ZoneDebugMap();
}
