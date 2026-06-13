# API Documentation

Base URL: `http://localhost:8084/api`

## `GET /health`
Returns a lightweight status check for demo verification.

Example response:

```json
{
  "status": "ok",
  "mode": "poc"
}
```

## `GET /layers`
Returns the available mock GIS layer catalog.

Example response:

```json
{
  "layers": [
    { "id": "shops", "name": "Shops", "fileName": "shops.geojson" },
    { "id": "schools", "name": "Schools", "fileName": "schools.geojson" },
    { "id": "hospitals", "name": "Hospitals", "fileName": "hospitals.geojson" },
    { "id": "roads", "name": "Roads", "fileName": "roads.geojson" }
  ]
}
```

## `GET /layers/{layerId}`
Returns the full GeoJSON payload for one layer.

Supported `layerId` values:

- `shops`
- `schools`
- `hospitals`
- `roads`

## `POST /recommendations`
Accepts analytics generated in the frontend JavaScript spatial engine and returns predefined recommendation messages.

Example request:

```json
{
  "nearbyShops": 2,
  "nearbySchools": 1,
  "nearbyHospitals": 1,
  "nearbyRoads": 2,
  "radiusMeters": 1000,
  "populationFactor": 71,
  "trafficFactor": 76,
  "competitionFactor": 82,
  "businessPotentialScore": 76
}
```

Example response:

```json
{
  "messages": [
    "Recommended for a fruit shop. Competition is low while population demand is strong.",
    "Traffic visibility is promising. This site may benefit from strong pass-by exposure.",
    "Overall business potential is high based on the current mock scoring model."
  ]
}
```

## `POST /assistant`
Accepts a GIS question and structured context. The backend sends the prompt to Gemini and returns the generated answer.

Example request:

```json
{
  "question": "Should I open a fruit shop here?",
  "context": {
    "selectedCoordinates": [77.5946, 12.9716],
    "radiusMeters": 1000,
    "analysis": {
      "suitabilityScore": 75
    }
  }
}
```

Example response:

```json
{
  "answer": "Recommended for a fruit shop...",
  "geminiUsed": true
}
```
