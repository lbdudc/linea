/*→ tip_advancedOperationsModule_7 ←*/
            /*% if (feature.square_root) { %*/
            squareRoot: squareRoot,
            /*% } %*/
/*→ tip_advancedOperationsModule_7 ←*/
/*→ tip_advancedOperationsModule_8 ←*/
        /*% if (feature.square_root) { %*/
        function squareRoot() {
            var current = _currentNumber();
            if (values[current].value === null) {
                return;
            }
            Calculator.calculate(values[current].value, 0, 'SQUARE_ROOT').success(function (result) {
                values[current].value = result.value;
                values[current].nextFloat = false;
                justCalculated = current === 'first';
            });
        }
        /*% } %*/
/*→ tip_advancedOperationsModule_8 ←*/
