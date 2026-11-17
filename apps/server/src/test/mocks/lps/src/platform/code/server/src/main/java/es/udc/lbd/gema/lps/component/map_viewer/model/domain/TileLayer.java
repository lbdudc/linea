/*% if (feature.MV_MapCustomization) { %*/
package es.udc.lbd.gema.lps.component.map_viewer.model.domain;

import jakarta.persistence.*;
import jakarta.persistence.Column;
import es.udc.lbd.gema.lps.component.map_viewer.model.service.dto.MapOptionsDTO;
import org.json.simple.JSONObject;
import org.json.simple.parser.ParseException;

@Entity(name = "mv_tile_layer")
@Table(name = "mv_tile_layer")
@DiscriminatorValue("TILE")
public class TileLayer extends Layer
  {
    @Column(name = "url" )
    private String url;

    @Column(name = "params", length = 2550)
    private String params;

    public TileLayer() {
    }

    public String getUrl() {
        return url;
    }

    public void setUrl(String url) {
        this.url = url;
    }

    public String getParams() {
        return params;
    }

    public void setParams(String params) {
        this.params = params;
    }

    @Override
    public MapOptionsDTO getLayerParams(MapOptionsDTO dto) throws ParseException {
      dto.setId(this.getLabel());
      dto.setType(LayerType.TILE);
      dto.setUrl(this.url);
      if( this.params!=null ){
        dto.setParams(toJSONObject(this.params));
      }
      return dto;
    }

    @Override
    public TileLayer fromDtoToLayer(MapOptionsDTO dto){
      this.setLayerId(dto.getId());
      this.setLabel(dto.getId());
      this.url = dto.getUrl();
      if (dto.getParams() != null) this.params = dto.getParams().toString();
      return this;
    }

}
/*% } %*/
