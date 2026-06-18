package com.example.webgis.controller;

import com.example.webgis.dto.LulcRequest;
import com.example.webgis.dto.LulcResponse;
import com.example.webgis.service.LulcAnalysisService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/lulc")
@CrossOrigin(origins = {
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5175",
        "http://127.0.0.1:5175",
        "http://localhost:5177",
        "http://127.0.0.1:5177"
})
@RequiredArgsConstructor
@Slf4j
public class LulcController {

    private final LulcAnalysisService lulcAnalysisService;

    @PostMapping("/analyze")
    public ResponseEntity<LulcResponse> analyzeLulc(@Valid @RequestBody LulcRequest request) {
        log.info("Received request for LULC analysis");
        LulcResponse response = lulcAnalysisService.analyzeLulc(request);
        return ResponseEntity.ok(response);
    }
}
