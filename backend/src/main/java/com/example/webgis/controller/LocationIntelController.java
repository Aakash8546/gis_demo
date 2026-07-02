package com.example.webgis.controller;

import com.example.webgis.dto.ExtractedData;
import com.example.webgis.dto.GeoEntity;
import com.example.webgis.dto.LocationIntelRequest;
import com.example.webgis.service.llm.LLMService;
import com.fasterxml.jackson.databind.ObjectMapper;
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

    private final LLMService llmService;
    private final ObjectMapper objectMapper;
    private static final GeometryFactory GEOMETRY_FACTORY = new GeometryFactory(new PrecisionModel(), 4326);

    public LocationIntelController(LLMService llmService, ObjectMapper objectMapper) {
        this.llmService = llmService;
        this.objectMapper = objectMapper;
    }

    @PostMapping("/extract")
    public ResponseEntity<?> extractEntity(@RequestBody @Valid LocationIntelRequest request) {
        log.info("Request to extract entity at ({}, {})", request.latitude(), request.longitude());

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
                    "frontend"
            );

            return ResponseEntity.ok(entity);

        } catch (Exception e) {
            log.error("Failed to extract entity info: ", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(java.util.Map.of(
                            "status", "error",
                            "message", "Entity extraction failed: " + e.getMessage()
                    ));
        }
    }
}
