# Audio Files Directory

This directory contains the audio files used in THE WALK experience.

## File Organization

Organize your audio files by category for easy management:

```
audio/
├── ambient/
│   ├── ambient1.mp3
│   ├── ambient2.mp3
│   └── nature_sounds.mp3
├── melodies/
│   ├── melody1.mp3
│   ├── harmony1.mp3
│   └── peaceful_harmony.mp3
├── rhythms/
│   ├── rhythm1.mp3
│   ├── urban_rhythm.mp3
│   └── electronic_texture.mp3
└── effects/
    ├── welcome_chime.mp3
    ├── transition_sound.mp3
    └── footsteps.mp3
```

## Audio Requirements

### Technical Specifications
- **Format**: MP3, WAV, or OGG
- **Sample Rate**: 44.1kHz recommended
- **Bit Rate**: 128-320 kbps for MP3
- **Channels**: Mono or Stereo
- **Duration**: 30 seconds to 5 minutes (for looping)

### Design Guidelines
- **Seamless Loops**: Ensure audio files loop smoothly without clicks or pops
- **Consistent Volume**: Normalize audio levels across all files
- **Complementary Tones**: Design layers that work well together when mixed
- **Dynamic Range**: Leave headroom for volume adjustments and mixing

## Sample Audio Ideas

### Ambient Layers
- Natural soundscapes (birds, wind, water)
- Urban environments (distant traffic, city hum)
- Abstract textures and drones
- Field recordings from the actual neighborhood

### Melodic Elements
- Simple, repetitive melodies that don't become annoying
- Harmonic progressions that complement the space
- Cultural or historical references to the location
- Instrumental pieces that evoke the neighborhood's character

### Rhythmic Components
- Subtle percussion loops
- Footstep patterns
- Mechanical or industrial sounds
- Heartbeat or breathing rhythms

### Interactive Elements
- Sounds triggered by specific movements
- Audio that responds to walking speed
- Directional audio cues
- Transition sounds between zones

## Creating Your Audio

### Recording Tips
1. **Field Recording**: Capture sounds from your actual neighborhood
2. **Studio Elements**: Add composed music and designed sounds
3. **Processing**: Use reverb and filters to create spatial depth
4. **Layering**: Design sounds that work well in combination

### Recommended Tools
- **Recording**: Zoom H1n, smartphone apps, or professional recorders
- **Editing**: Audacity (free), Reaper, Pro Tools, or Logic Pro
- **Processing**: Apply EQ, compression, and spatial effects
- **Conversion**: Use online converters or ffmpeg for format conversion

### Loop Creation
```bash
# Using ffmpeg to create seamless loops
ffmpeg -i input.wav -af "afade=t=in:ss=0:d=0.5,afade=t=out:st=29.5:d=0.5" output.mp3
```

## File Naming Convention

Use descriptive names that match your zone configuration:
- `ambient_park_birds.mp3`
- `melody_entrance_welcome.mp3`
- `rhythm_intersection_urban.mp3`
- `effect_transition_chime.mp3`

## Testing Your Audio

1. **Individual Testing**: Listen to each file on loop for several minutes
2. **Combination Testing**: Play multiple layers together at various volumes
3. **Mobile Testing**: Test on actual mobile devices with headphones
4. **Location Testing**: Walk through your zones while testing

## Copyright and Licensing

Ensure you have proper rights to all audio content:
- **Original Compositions**: You own the rights
- **Field Recordings**: Generally okay if recorded in public spaces
- **Licensed Music**: Obtain proper licensing for commercial use
- **Creative Commons**: Check attribution requirements
- **Stock Audio**: Verify licensing terms

## Performance Optimization

- **File Size**: Balance quality with loading time
- **Compression**: Use appropriate compression settings
- **Preloading**: Consider which files to preload vs. load on demand
- **Caching**: Implement browser caching for frequently used files

---

*Remember: The audio is the heart of THE WALK experience. Take time to craft sounds that truly enhance the physical journey through your chosen space.*
