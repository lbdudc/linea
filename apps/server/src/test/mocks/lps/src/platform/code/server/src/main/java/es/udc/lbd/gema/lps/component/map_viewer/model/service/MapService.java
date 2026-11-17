/*% if (feature.MV_MapCustomization) { %*/
package es.udc.lbd.gema.lps.component.map_viewer.model.service;

import es.udc.lbd.gema.lps.component.map_viewer.model.service.dto.MapStateDTO;
import es.udc.lbd.gema.lps.component.map_viewer.model.service.dto.MapDTO;
import org.json.simple.parser.ParseException;
import es.udc.lbd.gema.lps.model.service.exceptions.OperationNotAllowedException;
import es.udc.lbd.gema.lps.model.service.exceptions.NotFoundException;
import jakarta.validation.constraints.NotNull;
import java.util.List;

public interface MapService {

  MapStateDTO importState(MapStateDTO stateDTO) throws OperationNotAllowedException, ParseException;
  MapStateDTO exportState(Long id) throws NotFoundException, ParseException;
  List<MapDTO> findAll();
  MapStateDTO updateState(Long id, MapStateDTO stateDTO)
          throws OperationNotAllowedException, NotFoundException, ParseException;
  void delete(Long id) throws NotFoundException;
}
/*% } %*/
