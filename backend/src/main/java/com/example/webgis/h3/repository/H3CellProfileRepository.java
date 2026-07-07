package com.example.webgis.h3.repository;

import com.example.webgis.h3.model.H3CellProfile;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

/**
 * Repository interface for H3CellProfile entities.
 */
@Repository
public interface H3CellProfileRepository extends JpaRepository<H3CellProfile, String> {
}
