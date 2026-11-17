/*% if (feature.MV_MapCustomization) { %*/
package es.udc.lbd.gema.lps.component.map_viewer.model.domain;

import jakarta.persistence.*;
import jakarta.persistence.Column;
import es.udc.lbd.gema.lps.component.map_viewer.model.service.dto.MapOptionsDTO;
import org.json.simple.JSONObject;
import org.json.simple.parser.ParseException;

@Entity(name = "mv_geojson_layer")
@Table(name = "mv_geojson_layer")
@DiscriminatorValue("GEOJSON")
public class GeoJSONLayer extends Layer
  {

    @Column(name = "editable" )
    private Boolean editable;

    @Column(name = "color" )
    private String color;

    @Column(name = "added" )
    private Boolean added;

    @Column(name = "url" )
    private String url;

    @Column(name = "list")
    private String list;

    @Column(name = "clustering")
    private Boolean clustering;

    public GeoJSONLayer() {
    }

    public Boolean getAdded() {
      return added;
    }

    public void setAdded(Boolean added) {
      this.added = added;
    }

    public Boolean getEditable() {
        return editable;
    }

    public void setEditable(Boolean editable) {
        this.editable = editable;
    }

    public String getColor() {
        return color;
    }

    public void setColor(String color) {
        this.color = color;
    }

    public String getUrl() {
        return url;
    }

    public void setUrl(String url) {
        this.url = url;
    }

    public String getList() {
      return list;
    }

    public void setList(String list) {
      this.list = list;
    }

    public Boolean getClustering() {
      return clustering;
    }

    public void setClustering(Boolean clustering) {
      this.clustering = clustering;
    }

    @Override
    public MapOptionsDTO getLayerParams(MapOptionsDTO dto) throws ParseException {
      dto.setId(this.getLayerId());
      dto.setLabel(this.getLabel());
      dto.setType(LayerType.GEOJSON);
      dto.setEditable(this.editable);
      dto.setColor(this.color);
      dto.setUrl(this.url);
      dto.setAdded(this.added);
      dto.setList(this.list);
      dto.setClustering(this.clustering);
      return dto;
    }
    @Override
    public GeoJSONLayer fromDtoToLayer(MapOptionsDTO dto){
      this.setLayerId(dto.getId());
      this.setLabel(dto.getLabel());
      this.editable = dto.getEditable();
      this.color = dto.getColor();
      this.url = dto.getUrl();
      this.added = dto.getAdded();
      this.list = dto.getList();
      this.clustering = dto.getClustering();
      return this;
    }
}
/*% } %*/
