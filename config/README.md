# Mapping Guide for THE WALK

This app supports two configuration formats for zones:

- `config/zones.geojson` (preferred if present)
- `config/zones.json` (fallback, already provided)

Current app behavior in `server.js`:
- If `config/zones.geojson` exists, it will be served at `/api/zones`.
- Otherwise, `config/zones.json` is served.

## Recommended Workflow: Google Earth / Google My Maps

1. Define your zones in Google Earth or Google My Maps as placemarks (Points).
2. Export your map:
   - Google Earth: File → Save Place As… → KML (or KMZ)
   - Google My Maps: Menu → Export to KML/KMZ
3. Convert KML/KMZ to GeoJSON:
   - Use https://geojson.io (open KML/KMZ, then save as GeoJSON)
   - Or use `ogr2ogr` (GDAL):
     ```bash
     ogr2ogr -f GeoJSON zones.geojson your_map.kml
     ```
4. Edit each Feature’s properties (in geojson.io or a text editor) to include:
   - `id`: short unique identifier (string)
   - `radius_m`: zone radius in meters (number)
   - `fadeDistance`: optional fade distance in meters (number)
   - `maxVolume`: optional max volume 0.0–1.0 (number)
   - `audioLayers`: array of objects with `id`, `file`, `loop`, `volume`
5. Save the file as `config/zones.geojson` in this project.

Note: v1 supports circular zones centered on Points. Polygons aren’t yet supported, but can be added later.

## GeoJSON Feature Template

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "id": "entrance_zone",
        "name": "Neighborhood Entrance",
        "radius_m": 75,
        "fadeDistance": 25,
        "maxVolume": 0.8,
        "audioLayers": [
          { "id": "welcome_ambient", "file": "audio/ambient/welcome_ambient.mp3", "loop": true, "volume": 0.7 },
          { "id": "entrance_melody", "file": "audio/melodies/entrance_melody.mp3", "loop": true, "volume": 0.5 }
        ]
      },
      "geometry": { "type": "Point", "coordinates": [ -122.4194, 37.7749 ] }
    }
  ]
}
```

## Alternative Tools

- **geojson.io**: draw points and edit properties directly, then save as GeoJSON
- **QGIS**: professional GIS editor supporting GeoJSON export
- **Mapbox Studio / Felt / ArcGIS Online**: export GeoJSON for points

## Audio File Paths

- Place files in the `audio/` directory (you can use subfolders)
- Reference them by relative paths in `file`, e.g. `audio/ambient/nature_sounds.mp3`

## Quick Validation

To check your GeoJSON before running:
- Validate at https://geojsonlint.com/
- Ensure each feature has: `geometry.type = "Point"`, `properties.radius_m`, and `properties.audioLayers`

## Run the App

```bash
npm install
npm start
# open http://localhost:3000
```
