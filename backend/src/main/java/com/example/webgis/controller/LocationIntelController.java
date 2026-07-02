package com.example.webgis.controller;

import com.example.webgis.dto.ExtractedData;
import com.example.webgis.dto.GeoEntity;
import com.example.webgis.dto.LocationIntelRequest;
import com.example.webgis.service.LocationIntelService;
import com.example.webgis.service.llm.LLMService;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpSession;
import jakarta.validation.Valid;
import lombok.extern.slf4j.Slf4j;
import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.GeometryFactory;
import org.locationtech.jts.geom.Point;
import org.locationtech.jts.geom.PrecisionModel;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Slf4j
@RestController
@RequestMapping("/api/entities")
@CrossOrigin(origins = {
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5175",
        "http://127.0.0.1:5175",
        "http://localhost:5177",
        "http://127.0.0.1:5177",
        "http://127.0.0.1:5176",
        "http://localhost:5176"
}, allowCredentials = "true")
public class LocationIntelController {

    private final LocationIntelService locationIntelService;
    private final LLMService llmService;
    private final ObjectMapper objectMapper;
    private static final GeometryFactory GEOMETRY_FACTORY = new GeometryFactory(new PrecisionModel(), 4326);

    public LocationIntelController(LocationIntelService locationIntelService, LLMService llmService, ObjectMapper objectMapper) {
        this.locationIntelService = locationIntelService;
        this.llmService = llmService;
        this.objectMapper = objectMapper;
    }

    @PostMapping("/extract")
    public ResponseEntity<?> extractEntity(@RequestBody @Valid LocationIntelRequest request, HttpSession session) {
        String sessionId = session.getId();
        log.info("Request to extract entity at ({}, {}) in session: {}", request.latitude(), request.longitude(), sessionId);

        try {
            // 1. Call LLM Service to extract unstructured text to JSON
            String jsonOutput = llmService.extractEntityJson(request.text(), request.latitude(), request.longitude());
            
            // 2. Deserialize JSON into ExtractedData DTO
            ExtractedData extractedData = objectMapper.readValue(jsonOutput, ExtractedData.class);

            // 3. Create JTS Point Geometry
            Point point = GEOMETRY_FACTORY.createPoint(new Coordinate(request.longitude(), request.latitude()));

            // 4. Construct GeoEntity
            GeoEntity entity = new GeoEntity(
                    UUID.randomUUID().toString(),
                    request.latitude(),
                    request.longitude(),
                    point,
                    request.text(),
                    extractedData,
                    Instant.now(),
                    "MANUAL",
                    sessionId
            );

            // 5. Save to session-based storage
            GeoEntity saved = locationIntelService.addEntity(sessionId, entity);
            return ResponseEntity.ok(saved);

        } catch (Exception e) {
            log.error("Failed to extract entity info: ", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(java.util.Map.of(
                            "status", "error",
                            "message", "Entity extraction failed: " + e.getMessage()
                    ));
        }
    }

    @GetMapping
    public ResponseEntity<List<GeoEntity>> getEntities(HttpSession session) {
        String sessionId = session.getId();
        List<GeoEntity> entities = locationIntelService.getEntities(sessionId);
        return ResponseEntity.ok(entities);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteEntity(@PathVariable String id, HttpSession session) {
        String sessionId = session.getId();
        boolean deleted = locationIntelService.deleteEntity(sessionId, id);
        if (deleted) {
            return ResponseEntity.ok(java.util.Map.of("status", "success", "message", "Entity deleted successfully"));
        } else {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(java.util.Map.of("status", "error", "message", "Entity not found in the current session"));
        }
    }

    @DeleteMapping
    public ResponseEntity<?> clearSession(HttpSession session) {
        String sessionId = session.getId();
        locationIntelService.clearSession(sessionId);
        return ResponseEntity.ok(java.util.Map.of("status", "success", "message", "Session storage cleared"));
    }
}
