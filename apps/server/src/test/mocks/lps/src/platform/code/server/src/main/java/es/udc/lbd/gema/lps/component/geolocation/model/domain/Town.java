/*% if (feature.DM_DS_Address || feature.DM_A_G_Batch) { %*/
package es.udc.lbd.gema.lps.component.geolocation.model.domain;

/*% if (feature.T_EntitiesInformation) { %*/
import es.udc.lbd.gema.lps.component.entities_information.EntityInfo;
/*% } %*/

import jakarta.persistence.DiscriminatorValue;
import jakarta.persistence.Entity;

@Entity
/*% if (feature.T_EntitiesInformation) { %*/
@EntityInfo(hidden = true)
/*% } %*/
@DiscriminatorValue("TOWN")
public class Town extends Geoname {

}
/*% } %*/
