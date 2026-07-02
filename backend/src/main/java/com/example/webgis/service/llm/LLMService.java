package com.example.webgis.service.llm;

public interface LLMService {
    String extractEntityJson(String text, double lat, double lon);
}
