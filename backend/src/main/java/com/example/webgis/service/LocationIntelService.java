package com.example.webgis.service;

import com.example.webgis.dto.GeoEntity;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

@Service
public class LocationIntelService {

    private final Map<String, List<GeoEntity>> sessionStorage = new ConcurrentHashMap<>();

    public List<GeoEntity> getEntities(String sessionId) {
        if (sessionId == null) return Collections.emptyList();
        return sessionStorage.getOrDefault(sessionId, Collections.emptyList());
    }

    public GeoEntity addEntity(String sessionId, GeoEntity entity) {
        if (sessionId == null || entity == null) return null;
        sessionStorage.computeIfAbsent(sessionId, k -> new CopyOnWriteArrayList<>()).add(entity);
        return entity;
    }

    public boolean deleteEntity(String sessionId, String entityId) {
        if (sessionId == null || entityId == null) return false;
        List<GeoEntity> list = sessionStorage.get(sessionId);
        if (list != null) {
            return list.removeIf(e -> e.id().equals(entityId));
        }
        return false;
    }

    public void clearSession(String sessionId) {
        if (sessionId == null) return;
        sessionStorage.remove(sessionId);
    }
}
