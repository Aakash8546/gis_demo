package com.example.webgis.knowledge.controller;

import com.example.webgis.knowledge.model.KnowledgeContext;
import com.example.webgis.knowledge.service.KnowledgeContextService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.List;

@RestController
@RequestMapping("/api/knowledge")
@CrossOrigin(origins = "*")
@RequiredArgsConstructor
@Slf4j
public class KnowledgeController {

    private final KnowledgeContextService contextService;

    @GetMapping("/context")
    public ResponseEntity<KnowledgeContext> getContext(
            @RequestParam("lat") double lat,
            @RequestParam("lon") double lon,
            @RequestParam(value = "radius", required = false) Double radius) {
        log.info("Request context for lat={}, lon={}, radius={}", lat, lon, radius);
        try {
            KnowledgeContext context = contextService.buildKnowledgeContext(lat, lon, radius);
            return ResponseEntity.ok(context);
        } catch (Exception e) {
            log.error("Failed to build knowledge context", e);
            return ResponseEntity.internalServerError().build();
        }
    }

    @PostMapping("/polygon-context")
    public ResponseEntity<KnowledgeContext> getPolygonContext(
            @RequestBody Map<String, Object> payload) {
        log.info("Request context for polygon: {}", payload);
        try {
            List<List<List<Double>>> coordinates = (List<List<List<Double>>>) payload.get("coordinates");
            if (coordinates == null || coordinates.isEmpty()) {
                return ResponseEntity.badRequest().build();
            }
            KnowledgeContext context = contextService.buildPolygonKnowledgeContext(coordinates);
            log.info("Successfully built polygon knowledge context with {} entities and {} relationships", 
                     context.getEntities().size(), context.getRelationships().size());
            return ResponseEntity.ok(context);
        } catch (Exception e) {
            log.error("Failed to build polygon knowledge context", e);
            return ResponseEntity.internalServerError().build();
        }
    }

    @PostMapping("/marker")
    public ResponseEntity<Map<String, Object>> saveMarker(@RequestBody Map<String, Object> payload) {
        log.info("Request to save custom marker: {}", payload);
        try {
            String name = (String) payload.get("name");
            String layerName = (String) payload.get("layerName");
            double lat = ((Number) payload.get("lat")).doubleValue();
            double lon = ((Number) payload.get("lon")).doubleValue();

            if (name == null || name.isBlank()) {
                return ResponseEntity.badRequest().body(Map.of("error", "Name is required"));
            }
            if (layerName == null || layerName.isBlank()) {
                return ResponseEntity.badRequest().body(Map.of("error", "Layer name is required"));
            }

            Map<String, Object> result = contextService.saveCustomMarker(name, layerName, lon, lat);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            log.error("Failed to save custom marker", e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }
}
