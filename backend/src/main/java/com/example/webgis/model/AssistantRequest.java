package com.example.webgis.model;

import java.util.List;
import java.util.Map;

public class AssistantRequest {
    private String question;
    private Map<String, Object> context;
    private List<Map<String, Object>> history;

    public String getQuestion() {
        return question;
    }

    public void setQuestion(String question) {
        this.question = question;
    }

    public Map<String, Object> getContext() {
        return context;
    }

    public void setContext(Map<String, Object> context) {
        this.context = context;
    }

    public List<Map<String, Object>> getHistory() {
        return history;
    }

    public void setHistory(List<Map<String, Object>> history) {
        this.history = history;
    }
}

