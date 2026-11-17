/*% if (feature.MV_MapCustomization) { %*/
package es.udc.lbd.gema.lps.component.map_viewer.model.service.dto;

import jakarta.validation.Valid;

public class MapLayerDTO {
  @Valid
  private MapOptionsDTO options;

  public MapLayerDTO() {
  }

  public MapLayerDTO(MapOptionsDTO options) {
    this.options = options;
  }

  public MapOptionsDTO getOptions() {
    return options;
  }

  public void setOptions(MapOptionsDTO options) {
    this.options = options;
  }
}
/*% } %*/
