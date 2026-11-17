/*% if (feature.MV_MapCustomization) { %*/
package es.udc.lbd.gema.lps.component.map_viewer.web.rest;

import es.udc.lbd.gema.lps.component.map_viewer.model.service.dto.MapStateDTO;
import es.udc.lbd.gema.lps.component.map_viewer.model.service.dto.MapDTO;
import es.udc.lbd.gema.lps.component.map_viewer.model.service.MapService;
import es.udc.lbd.gema.lps.web.rest.util.HeaderUtil;
import es.udc.lbd.gema.lps.web.rest.custom.ValidationErrorUtils;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.Errors;
import org.springframework.web.bind.annotation.*;
import jakarta.inject.Inject;
import jakarta.validation.Valid;
import org.slf4j.LoggerFactory;
import org.slf4j.Logger;
import java.net.URI;
import java.net.URISyntaxException;
import es.udc.lbd.gema.lps.model.service.exceptions.NotFoundException;
import es.udc.lbd.gema.lps.model.service.exceptions.OperationNotAllowedException;
import org.json.simple.parser.ParseException;
import java.util.List;

@RestController
@RequestMapping(MapResource.MAP_RESOURCE_URL)
public class MapResource {
  public final static String MAP_RESOURCE_URL = "/api/maps";

  private static final Logger logger = LoggerFactory.getLogger(MapResource.class);

  @Inject
  private MapService mapService;

  @PostMapping
  public ResponseEntity<?> importState (@RequestBody @Valid MapStateDTO state, Errors errors) throws URISyntaxException, OperationNotAllowedException, ParseException {
    if (errors.hasErrors()) {
      return ResponseEntity.badRequest().body(ValidationErrorUtils.getValidationErrors(errors));
    }
    try {
      MapStateDTO map = mapService.importState(state);
      return new ResponseEntity<>(map, HttpStatus.OK);
    } catch (Exception e){
      return ResponseEntity.badRequest().headers(HeaderUtil.createError(e.getMessage(), null)).body(null);
    }
  }
  @GetMapping("/{id}")
  public ResponseEntity<MapStateDTO> exportState (@PathVariable Long id) throws ParseException{
    try{
      return new ResponseEntity<>(mapService.exportState(id), HttpStatus.OK);
    } catch (NotFoundException e){
      return new ResponseEntity<>(HttpStatus.NOT_FOUND);
    }
  }
  @GetMapping
  public ResponseEntity<List<MapDTO>> findAll() {
    List<MapDTO> mapDtoList = mapService.findAll();
    return new ResponseEntity<List<MapDTO>>(mapDtoList, HttpStatus.OK);
  }

  @PutMapping("/{id}")
  public ResponseEntity<?> updateState(
          @PathVariable Long id, @Valid @RequestBody MapStateDTO state, Errors errors) {
    if (errors.hasErrors()) {
      return ResponseEntity.badRequest().body(ValidationErrorUtils.getValidationErrors(errors));
    }
    try {
      MapStateDTO result = mapService.updateState(id, state);
      return ResponseEntity.ok().body(result);
    } catch (Exception e) {
      return ResponseEntity.badRequest()
              .headers(HeaderUtil.createError(e.getMessage(), null))
              .body(null);
    }
  }

  @DeleteMapping("/{id}")
  public ResponseEntity<Void> deleteMap(@PathVariable Long id) {
    try {
      mapService.delete(id);
    } catch (Exception e) {
      logger.error(e.getMessage(), e);
      return ResponseEntity.status(HttpStatus.BAD_REQUEST)
              .headers(HeaderUtil.createError("psql.exception", null))
              .build();
    }

    return ResponseEntity.ok().build();
  }
}
/*% } %*/
