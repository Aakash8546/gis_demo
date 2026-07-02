package com.example.webgis.service.llm;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.util.*;

@Service
public class GeminiLLMService implements LLMService {

    private final RestClient restClient;
    private final ObjectMapper objectMapper;

    @Value("${gemini.api.key:}")
    private String apiKey;

    public GeminiLLMService(ObjectMapper objectMapper) {
        this.restClient = RestClient.builder().build();
        this.objectMapper = objectMapper;
    }

    @Override
    public String extractEntityJson(String text, double lat, double lon) {
        if (apiKey == null || apiKey.isBlank()) {
            throw new IllegalStateException("Gemini API key is not configured. Please set the GEMINI_API_KEY environment variable.");
        }

        String prompt = String.format(
            "You are an expert geospatial AI assistant.\n" +
            "Extract structured geospatial entity information from the following user-reported text.\n" +
            "User text: \"%s\"\n" +
            "Entity coordinates: Latitude %f, Longitude %f\n\n" +
            "The output MUST be a single, valid JSON object matching the schema below.\n" +
            "No explanation, no markdown formatting (do NOT wrap in ```json), no HTML. Return ONLY the raw JSON string.\n\n" +
            "JSON Schema:\n" +
            "{\n" +
            "  \"title\": \"A short, descriptive title\",\n" +
            "  \"entityType\": \"Fire, Flood, Road Damage, Electricity Failure, Crime, Medical, Construction, or Unknown\",\n" +
            "  \"summary\": \"A concise summary of what occurred\",\n" +
            "  \"severity\": \"LOW, MEDIUM, or HIGH\",\n" +
            "  \"date\": \"YYYY-MM-DD\",\n" +
            "  \"persons\": [],\n" +
            "  \"organizations\": [],\n" +
            "  \"keywords\": [],\n" +
            "  \"confidence\": 0.0 to 1.0\n" +
            "}",
            text.replace("\"", "\\\""), lat, lon
        );

        Map<String, Object> part = Map.of("text", prompt);
        Map<String, Object> content = Map.of("parts", List.of(part));
        Map<String, Object> generationConfig = Map.of(
            "responseMimeType", "application/json"
        );

        Map<String, Object> requestBody = Map.of(
            "contents", List.of(content),
            "generationConfig", generationConfig
        );

        try {
            String url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + apiKey;
            
            String responseBody = restClient.post()
                    .uri(url)
                    .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                    .body(requestBody)
                    .retrieve()
                    .body(String.class);

            var root = objectMapper.readTree(responseBody);
            var candidates = root.path("candidates");
            if (candidates.isArray() && !candidates.isEmpty()) {
                var textNode = candidates.get(0)
                        .path("content")
                        .path("parts")
                        .get(0)
                        .path("text");
                return cleanJsonResponse(textNode.asText());
            }
            throw new RuntimeException("Empty response or invalid structure from Gemini API");

        } catch (Exception e) {
            throw new RuntimeException("Failed to query Gemini API: " + e.getMessage(), e);
        }
    }

    private String cleanJsonResponse(String response) {
        if (response == null) return "{}";
        response = response.trim();
        if (response.startsWith("```")) {
            int firstNewLine = response.indexOf("\n");
            if (firstNewLine != -1) {
                response = response.substring(firstNewLine).trim();
            }
            if (response.endsWith("```")) {
                response = response.substring(0, response.length() - 3).trim();
            }
        }
        return response.trim();
    }
}
