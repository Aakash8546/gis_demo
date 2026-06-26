package com.example.webgis.knowledge.model;

import com.example.webgis.knowledge.ontology.RelationshipType;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.util.Map;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class KnowledgeRelationship {
    private String source;
    private String target;
    private RelationshipType relation;
    private Map<String, Object> properties;
}
