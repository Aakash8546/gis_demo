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
import java.util.Map;

@Service
public class GeminiAssistantService {

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(8))
            .build();
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${GEMINI}")
    private String geminiApiKey;

    @Value("${gemini.model:gemini-2.5-flash}")
    private String geminiModel;

    public AssistantResponse respond(AssistantRequest request) {
        if (geminiApiKey == null || geminiApiKey.isBlank()) {
            throw new IllegalStateException("Gemini API key is not configured.");
        }

        try {
            String prompt = buildPrompt(request);
            Map<String, Object> payload = Map.of(
                    "contents", new Object[]{
                            Map.of(
                                    "role", "user",
                                    "parts", new Object[]{
                                            Map.of("text", prompt)
                                    }
                            )
                    },
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
                You are a professional GIS decision support assistant for a management presentation.
                Use the supplied spatial context to answer in concise business language.
                Do not mention that you are simulated unless needed.

                Question: %s

                Context JSON:
                %s
                """.formatted(request.getQuestion(), request.getContext());
    }
}
