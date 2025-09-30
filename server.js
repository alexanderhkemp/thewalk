const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all routes
app.use(cors());

// Serve static files
app.use(express.static('.'));

// Parse JSON bodies (increase limit for GeoJSON uploads)
app.use(express.json({ limit: '5mb' }));

// Serve the main application
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// API endpoint to get zone configuration
app.get('/api/zones', (req, res) => {
    try {
        const geojsonPath = path.join(__dirname, 'config', 'zones.geojson');
        const jsonPath = path.join(__dirname, 'config', 'zones.json');

        if (fs.existsSync(geojsonPath)) {
            const raw = fs.readFileSync(geojsonPath, 'utf8');
            const data = JSON.parse(raw);
            return res.json(data);
        }

        if (fs.existsSync(jsonPath)) {
            const zones = require('./config/zones.json');
            return res.json(zones);
        }

        return res.status(404).json({ error: 'No zone configuration found. Add config/zones.geojson or config/zones.json' });
    } catch (error) {
        console.error('Failed to load zone configuration:', error);
        res.status(500).json({ error: 'Failed to load zone configuration', details: String(error) });
    }
});

// API endpoint to log user positions (for analytics/debugging)
app.post('/api/log-position', (req, res) => {
    const { latitude, longitude, timestamp, activeZones } = req.body;
    
    // In a real implementation, you might save this to a database
    console.log(`Position logged: ${latitude}, ${longitude} at ${new Date(timestamp)}`);
    console.log(`Active zones: ${activeZones?.join(', ') || 'none'}`);
    
    res.json({ success: true });
});

// API endpoint to get audio file metadata
app.get('/api/audio/:filename', (req, res) => {
    const filename = req.params.filename;
    const audioPath = path.join(__dirname, 'audio', filename);
    
    // Check if file exists and send metadata
    const fs = require('fs');
    if (fs.existsSync(audioPath)) {
        const stats = fs.statSync(audioPath);
        res.json({
            filename: filename,
            size: stats.size,
            lastModified: stats.mtime,
            exists: true
        });
    } else {
        res.status(404).json({
            filename: filename,
            exists: false,
            error: 'Audio file not found'
        });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// Save GeoJSON configuration
app.post('/api/zones/geojson', (req, res) => {
    try {
        const geojson = req.body;
        if (!geojson || typeof geojson !== 'object') {
            return res.status(400).json({ error: 'Invalid GeoJSON payload' });
        }
        const configDir = path.join(__dirname, 'config');
        if (!fs.existsSync(configDir)) fs.mkdirSync(configDir);
        const target = path.join(configDir, 'zones.geojson');
        fs.writeFileSync(target, JSON.stringify(geojson, null, 2), 'utf8');
        return res.json({ success: true, path: 'config/zones.geojson' });
    } catch (err) {
        console.error('Failed to save GeoJSON:', err);
        return res.status(500).json({ error: 'Failed to save GeoJSON', details: String(err) });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Start the server
app.listen(PORT, () => {
    console.log(`THE WALK server running on http://localhost:${PORT}`);
    console.log('Make sure to use HTTPS in production for location services');
    console.log('Add your audio files to the /audio directory');
    console.log('Configure your zones in /config/zones.json');
});

module.exports = app;
