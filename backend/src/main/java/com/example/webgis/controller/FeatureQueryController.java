package com.example.webgis.controller;

import com.example.webgis.service.FeatureStoreService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/features")
@CrossOrigin(origins = "*")
public class FeatureQueryController {

    private final FeatureStoreService featureStoreService;

    public FeatureQueryController(FeatureStoreService featureStoreService) {
        this.featureStoreService = featureStoreService;
    }

    @PostMapping("/query")
    public ResponseEntity<Map<String, Object>> getFeatureVector(@RequestBody FeatureQueryRequest request) {
        if (request.latitude() == null || request.longitude() == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "latitude and longitude are required"));
        }

        Map<String, Object> featureVector = featureStoreService.queryFeatures(
                request.latitude(),
                request.longitude(),
                request.radius() != null ? request.radius() : 2000.0
        );

        return ResponseEntity.ok(featureVector);
    }
}

record FeatureQueryRequest(Double latitude, Double longitude, Double radius) {}
