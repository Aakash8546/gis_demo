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
