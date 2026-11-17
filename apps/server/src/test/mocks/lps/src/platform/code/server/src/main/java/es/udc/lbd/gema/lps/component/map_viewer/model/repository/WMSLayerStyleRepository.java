/*% if (feature.MV_MapCustomization) { %*/
package es.udc.lbd.gema.lps.component.map_viewer.model.repository;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import es.udc.lbd.gema.lps.component.map_viewer.model.domain.WMSLayerStyle;

public interface WMSLayerStyleRepository
  extends JpaRepository<WMSLayerStyle, Long>, JpaSpecificationExecutor<WMSLayerStyle> {}
/*% } %*/
