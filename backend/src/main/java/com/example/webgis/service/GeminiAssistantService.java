package com.example.webgis.service;

import com.example.webgis.model.AssistantRequest;
import com.example.webgis.model.AssistantResponse;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Service
public class GeminiAssistantService {

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(8))
            .build();
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${gemini.api.key:}")
    private String geminiApiKey;

    @Value("${gemini.model:gemini-2.5-flash}")
    private String geminiModel;

    public AssistantResponse respond(AssistantRequest request) {
        if (geminiApiKey == null || geminiApiKey.isBlank()) {
            throw new IllegalStateException("Gemini API key is not configured.");
        }

        try {
            String prompt = buildPrompt(request);
            List<Map<String, Object>> contents = new ArrayList<>();
            if (request.getHistory() != null) {
                contents.addAll(request.getHistory());
            }
            contents.add(Map.of(
                    "role", "user",
                    "parts", new Object[]{
                            Map.of("text", prompt)
                    }
            ));

            Map<String, Object> payload = Map.of(
                    "contents", contents,
                    "generationConfig", Map.of(
                            "temperature", 0.4,
                            "topP", 0.9,
                            "maxOutputTokens", 512
                    )
            );

            HttpRequest httpRequest = HttpRequest.newBuilder()
                    .uri(URI.create("https://generativelanguage.googleapis.com/v1beta/models/"
                            + geminiModel + ":generateContent?key=" + geminiApiKey))
                    .header("Content-Type", "application/json")
                    .timeout(Duration.ofSeconds(20))
                    .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(payload)))
                    .build();

            HttpResponse<String> response = httpClient.send(httpRequest, HttpResponse.BodyHandlers.ofString());
            JsonNode root = objectMapper.readTree(response.body());
            JsonNode textNode = root.path("candidates").path(0).path("content").path("parts").path(0).path("text");

            if (!textNode.isMissingNode() && !textNode.asText().isBlank()) {
                return new AssistantResponse(textNode.asText(), true);
            }
            throw new IllegalStateException("Gemini response did not include assistant text.");
        } catch (Exception exception) {
            throw new IllegalStateException("Unable to generate a Gemini response.", exception);
        }

    }

    private String buildPrompt(AssistantRequest request) {
        return """
                You are a professional location intelligence expert and GIS decision support assistant.
                Analyze the provided Map Context and use it to answer the user's question with actionable business insights.
                
                Keep your answer structured, concise, and professional. 
                Identify potential competitors or demand drivers from the listed map markers/features. 
                Give data-driven reasoning (e.g. proximity, density, and local suitability factors) when asked about setting up businesses like gyms, fruit shops, or others.
                
                Map Context:
                %s
                
                Question: %s
                """.formatted(request.getContext() != null ? request.getContext().toString() : "{}", request.getQuestion());
    }
}
