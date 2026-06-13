# WebGIS Decision Support System POC

This repository contains a presentation-focused WebGIS proof of concept that demonstrates how a future AI-assisted GIS decision support platform could work with a blank editable workspace, manual marker entry, and Gemini-backed guidance.

## Stack

- Frontend: React, JavaScript, OpenLayers, TailwindCSS
- Backend: Spring Boot 3, Maven, REST APIs
- Data: Manual layers created in the browser workspace

## What This POC Includes

- Interactive OpenLayers map with zoom, pan, scale, and live coordinate display
- Layer manager for blank user-created layers
- Manual marker entry workflow with a create-layer popup
- Click-to-select location workflow with live coordinates
- Gemini-backed AI assistant for business guidance
- Clean map-first layout built for presentation use

## Folder Structure

```text
GIS_demo1/
├── backend/
│   ├── pom.xml
│   └── src/main/
│       ├── java/com/example/webgis/
│       │   ├── WebgisPocBackendApplication.java
│       │   ├── controller/GisController.java
│       │   ├── model/
│       │   └── service/
│       └── resources/
│           └── application.properties
├── frontend/
│   ├── package.json
│   ├── src/
│   │   ├── App.jsx
│   │   ├── index.css
│   │   ├── main.jsx
│   │   └── utils/spatial.js
│   └── vite.config.js
├── API.md
└── README.md
```

## Setup Instructions

### 1. Start the backend

```bash
cd backend
mvn spring-boot:run
```

Backend runs at `http://localhost:8084`.

### 2. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at `http://localhost:5177`.

## Demo Workflow

1. Open the app in the browser.
2. Create a blank layer from the left panel.
3. Set that layer as active.
4. Turn on marker mode and click the map to save manual point features.
5. Ask the assistant for guidance about the current workspace.
6. Toggle the basemap if you want a lighter or darker presentation look.

## Notes

- This is a POC only and intentionally avoids database, authentication, user management, Docker, and persistent storage.
- The frontend keeps the app intentionally simple: layer explorer, map, and assistant.
- The backend includes a Gemini-backed assistant endpoint for management-style guidance.

## API Reference

See [API.md](/Users/aakashsrivastava/Documents/GIS_demo1/API.md).
