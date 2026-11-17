/*% if (feature.MV_MapCustomization) { %*/
package es.udc.lbd.gema.lps.component.map_viewer.model.domain;

import java.util.List;
import jakarta.persistence.*;
import jakarta.persistence.Column;
import jakarta.persistence.SequenceGenerator;
import jakarta.persistence.CascadeType;
import es.udc.lbd.gema.lps.component.map_viewer.model.service.dto.MapOptionsDTO;
import org.json.simple.JSONObject;
import org.json.simple.parser.JSONParser;
import org.json.simple.parser.ParseException;

@Entity(name = "mv_layer")
@Table(name = "mv_layer")
@Inheritance(strategy = InheritanceType.SINGLE_TABLE)
@DiscriminatorColumn(name="layer_type", discriminatorType = DiscriminatorType.STRING)
public abstract class Layer {
    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "layerid")
    @SequenceGenerator(name = "layerid", sequenceName = "mv_layer_id_seq", initialValue = 1, allocationSize = 1)
    @Column(name = "id"  ,unique=true)
    private Long id;

    @Column(name = "layer_id")
    private String layerId;

    @Column(name = "label" )
    private String label;

    @ManyToMany(fetch = FetchType.LAZY, cascade = CascadeType.ALL, mappedBy = "layers")
    private List<Style> availableStyles;

    @ManyToOne(fetch = FetchType.LAZY, cascade = CascadeType.ALL)
    @JoinColumn(name = "default_style")
    private Style defaultStyle;

    public Layer() {
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getLayerId() {
        return layerId;
    }

    public void setLayerId(String layerId) {
        this.layerId = layerId;
    }

    public String getLabel() {
        return label;
    }

    public void setLabel(String label) {
        this.label = label;
    }

    public List<Style> getAvailableStyles() {
        return availableStyles;
    }

    public void setAvailableStyles(List<Style> availableStyles) {
        this.availableStyles = availableStyles;
    }

    public Style getDefaultStyle() {
        return defaultStyle;
    }

    public void setDefaultStyle(Style defaultStyle) {
        this.defaultStyle = defaultStyle;
    }

    public abstract MapOptionsDTO  getLayerParams(MapOptionsDTO dto) throws ParseException;

    public abstract Layer  fromDtoToLayer(MapOptionsDTO dto);

    JSONObject toJSONObject(String obj) throws ParseException {
    JSONParser jsonParser = new JSONParser();
    return (JSONObject) jsonParser.parse(obj);
  }
}
/*% } %*/
