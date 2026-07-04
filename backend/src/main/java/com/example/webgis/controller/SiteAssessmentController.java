package com.example.webgis.controller;

import com.example.webgis.service.SiteAssessmentService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/assessment")
@CrossOrigin(origins = "*")
public class SiteAssessmentController {

    private final SiteAssessmentService siteAssessmentService;

    public SiteAssessmentController(SiteAssessmentService siteAssessmentService) {
        this.siteAssessmentService = siteAssessmentService;
    }

    @PostMapping("/site")
    public ResponseEntity<Map<String, Object>> getSiteAssessment(@RequestBody SiteAssessmentRequest request) {
        if (request.latitude() == null || request.longitude() == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "latitude and longitude are required"));
        }
        
        Map<String, Object> result = siteAssessmentService.assessSite(
                request.latitude(),
                request.longitude(),
                request.radius() != null ? request.radius() : 2000.0,
                request.businessType() != null ? request.businessType() : "distribution_center"
        );
        
        return ResponseEntity.ok(result);
    }
}

record SiteAssessmentRequest(Double latitude, Double longitude, Double radius, String businessType) {}
