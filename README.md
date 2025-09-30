# THE WALK
*A Location-Based Audio Art Experience*

## Overview

THE WALK is an interactive audio art piece that uses precise location data to dynamically mix audio layers based on where users move within a specific neighborhood. As users walk through different zones, various audio elements fade in and out, creating a unique sonic landscape that responds to their physical movement through space.

## Features

- **Precise Location Tracking**: Uses GPS with high accuracy settings for responsive location-based audio
- **Dynamic Audio Mixing**: Multiple audio layers that fade in/out based on proximity to defined zones
- **Zone-Based Audio**: Configure multiple audio zones with different radii and fade distances
- **Real-time Audio Processing**: Web Audio API for low-latency audio mixing and effects
- **Mobile-Optimized**: Responsive design optimized for mobile devices
- **Visual Feedback**: Real-time display of location, active audio layers, and zone information

## Technical Architecture

### Core Components

1. **LocationService** (`js/locationService.js`)
   - High-accuracy GPS tracking
   - Distance calculations between points
   - Error handling for location permissions

2. **AudioMixer** (`js/audioMixer.js`)
   - Web Audio API integration
   - Multi-layer audio mixing
   - Zone-based volume control with fade effects
   - Master volume control

3. **TheWalkApp** (`js/app.js`)
   - Main application controller
   - UI management
   - Audio zone configuration
   - Event handling

### Audio Zones

Audio zones are circular areas defined by:
- **Center coordinates** (latitude, longitude)
- **Radius** (in meters)
- **Audio layers** (array of audio file IDs)
- **Fade distance** (gradual volume transition)
- **Maximum volume** (peak volume within the zone)

## Setup Instructions

### Prerequisites

1. **Install Node.js** (if not already installed):
   ```bash
   # Using Homebrew on macOS
   brew install node
   
   # Or download from https://nodejs.org/
   ```

2. **Install dependencies**:
   ```bash
   cd /Users/Alexander\ Kemp/CascadeProjects/THE_WALK
   npm install
   ```

### Adding Audio Content

1. Create an `audio` directory:
   ```bash
   mkdir audio
   ```

2. Add your audio files (MP3, WAV, or OGG format):
   ```
   audio/
   ├── ambient1.mp3
   ├── ambient2.mp3
   ├── melody1.mp3
   ├── rhythm1.mp3
   ├── nature1.mp3
   └── harmony1.mp3
   ```

3. Update the `loadDemoAudio()` function in `js/app.js` to load your actual audio files:
   ```javascript
   await audioMixer.loadAudio('audio/ambient1.mp3', 'ambient1');
   await audioMixer.loadAudio('audio/ambient2.mp3', 'ambient2');
   // ... etc
   ```

### Configuring Your Neighborhood

1. **Get coordinates** for your target neighborhood using:
   - Google Maps (right-click → "What's here?")
   - GPS coordinates from your phone
   - Online coordinate tools

2. **Update audio zones** in `js/app.js` in the `setupAudioZones()` method:
   ```javascript
   const zones = [
       {
           id: 'park_entrance',
           center: { lat: YOUR_LAT, lng: YOUR_LNG },
           radius: 50, // meters
           audioLayers: ['nature1', 'ambient1'],
           fadeDistance: 20,
           maxVolume: 0.8
       },
       // Add more zones...
   ];
   ```

### Running the Application

1. **Start a local server**:
   ```bash
   # Option 1: Using Python (if installed)
   python3 -m http.server 8000
   
   # Option 2: Using Node.js http-server
   npx http-server -p 8000
   
   # Option 3: Using any other local server
   ```

2. **Open in browser**:
   - Navigate to `http://localhost:8000`
   - **Important**: Use HTTPS for location services in production

3. **Grant permissions**:
   - Allow location access when prompted
   - Allow audio playback (may require user interaction)

## Usage

1. **Start The Walk**: Tap "Start The Walk" button
2. **Grant Permissions**: Allow location and audio access
3. **Begin Walking**: Move through your configured neighborhood
4. **Experience the Audio**: Listen as different audio layers fade in/out based on your location
5. **Adjust Volume**: Use the master volume control as needed

## Customization

### Audio Zones

Modify zones in `js/app.js`:
```javascript
{
    id: 'unique_zone_id',
    center: { lat: 37.7749, lng: -122.4194 },
    radius: 100, // Zone radius in meters
    audioLayers: ['layer1', 'layer2'], // Audio files to play
    fadeDistance: 30, // Fade transition distance
    maxVolume: 0.8 // Maximum volume (0.0 - 1.0)
}
```

### Audio Layers

Add new audio layers:
1. Place audio files in the `audio/` directory
2. Load them in `loadDemoAudio()`:
   ```javascript
   await audioMixer.loadAudio('audio/your_file.mp3', 'your_layer_id');
   ```
3. Reference them in zone configurations

### Visual Styling

Customize the appearance by modifying `styles.css`:
- Color schemes
- Layout adjustments
- Mobile responsiveness
- Animation effects

## Mobile Deployment

### Progressive Web App (PWA)

To make THE WALK installable on mobile devices:

1. Add a web app manifest (`manifest.json`)
2. Implement service worker for offline functionality
3. Add app icons for different screen sizes

### Native Mobile App

For enhanced mobile features:
- Convert to React Native or Cordova
- Access native location services
- Better audio performance
- App store distribution

## Troubleshooting

### Location Issues
- Ensure HTTPS is used (required for location services)
- Check browser location permissions
- Test GPS accuracy in your target area
- Consider using mock locations for development

### Audio Issues
- Verify audio files are properly formatted
- Check Web Audio API browser support
- Ensure user interaction before audio playback
- Test with different audio formats (MP3, WAV, OGG)

### Performance
- Optimize audio file sizes
- Limit number of simultaneous audio layers
- Test on target mobile devices
- Monitor battery usage during extended use

## Future Enhancements

- **Visual Map Integration**: Show zones and current position on a map
- **Audio Effects**: Add reverb, filters, and spatial audio effects
- **User Profiles**: Save preferences and walking history
- **Social Features**: Share walks and audio experiences
- **Analytics**: Track user movement patterns and engagement
- **Offline Mode**: Cache audio and work without internet connection

## Contributing

This is an art project, but contributions are welcome:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly on mobile devices
5. Submit a pull request

## License

MIT License - Feel free to use this code for your own location-based audio art projects.

---

*THE WALK transforms the act of walking into an immersive audio experience, where the city becomes your instrument and your movement becomes the performance.*
