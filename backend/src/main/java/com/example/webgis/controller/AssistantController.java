package com.example.webgis.controller;

import com.example.webgis.model.AssistantRequest;
import com.example.webgis.model.AssistantResponse;
import com.example.webgis.service.GeminiAssistantService;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/assistant")
@CrossOrigin(origins = {
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5175",
        "http://127.0.0.1:5175"
})
public class AssistantController {

    private final GeminiAssistantService assistantService;

    public AssistantController(GeminiAssistantService assistantService) {
        this.assistantService = assistantService;
    }

    @PostMapping
    public AssistantResponse respond(@RequestBody AssistantRequest request) {
        return assistantService.respond(request);
    }
}
