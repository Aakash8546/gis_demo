package com.example.webgis.knowledge.model;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.util.List;
import java.util.Map;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class KnowledgeContext {
    private Map<String, Double> clickedLocation;
    private List<KnowledgeNode> entities;
    private List<KnowledgeRelationship> relationships;
    private Map<String, Object> summary;
    private Map<String, Object> metadata;
}
