package com.example.webgis.model;

import java.util.Map;

public class AssistantRequest {
    private String question;
    private Map<String, Object> context;

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
}

