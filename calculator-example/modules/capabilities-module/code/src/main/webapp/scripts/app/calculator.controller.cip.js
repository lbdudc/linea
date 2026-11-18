/*→ tip_capabilitiesModule_2 ←*/
            /*% if (feature.decimal) { %*/
            decimal: decimal,
            /*% } %*/
/*→ tip_capabilitiesModule_2 ←*/
/*→ tip_capabilitiesModule_3 ←*/
        /*% if (feature.decimal) { %*/
        function decimal() {
            values[_currentNumber()].nextFloat = true;
        }
        /*% } %*/
/*→ tip_capabilitiesModule_3 ←*/
