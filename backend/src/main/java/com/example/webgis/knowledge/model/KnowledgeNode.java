package com.example.webgis.knowledge.model;

import com.example.webgis.knowledge.ontology.EntityType;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.util.Map;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class KnowledgeNode {
    private String id;
    private EntityType type;
    private String label;
    private Map<String, Object> properties;
}
