/*→ tip_advancedOperationsModule_4 ←*/
		/*% if (feature.divide) { %*/
		if (request.getOperation() == Operation.DIVIDE) {
			if (request.getSecond() == 0) {
				return new ResponseEntity<ResultJSON>(new ResultJSON(), HttpStatus.BAD_REQUEST);
			}
		}
		/*% } if (feature.square_root) { %*/
		if (request.getOperation() == Operation.SQUARE_ROOT) {
			if (request.getFirst() < 0) {
				return new ResponseEntity<ResultJSON>(new ResultJSON(), HttpStatus.BAD_REQUEST);
			}
		}
		/*% } %*/
/*→ tip_advancedOperationsModule_4 ←*/
