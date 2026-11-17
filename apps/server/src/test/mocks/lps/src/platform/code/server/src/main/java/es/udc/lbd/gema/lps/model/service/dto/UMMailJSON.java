/*% if (feature.UM_A_RecoverPass || feature.UM_UP_ByAdmin || feature.UM_R_ByAdmin) { %*/
package es.udc.lbd.gema.lps.model.service.dto;

import jakarta.validation.constraints.Size;
import jakarta.validation.constraints.Email;

public class UMMailJSON {

    @Email
    @Size(min = 5, max = 100)
    private String email;

    public UMMailJSON() {}

    public UMMailJSON(String email) {
    this.email = email;
    }

    public String getEmail() {
    return email;
    }
}
/*% } %*/