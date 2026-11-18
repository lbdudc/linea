/*→ tip_basicOperationsModule_2 ←*/
		/*% if (feature.add) { %*/
		case ADD:
			return add(first, second);/*% } if (feature.subtract) { %*/
		case SUBTRACT:
			return subtract(first, second);/*% } if (feature.multiply) { %*/
		case MULTIPLY:
			return multiply(first, second);/*% } %*/
/*→ tip_basicOperationsModule_2 ←*/
/*→ tip_basicOperationsModule_3 ←*/
	/*% if (feature.add) { %*/
	private float add(float first, float second) {
		return first + second;
	}/*% } if (feature.subtract) { %*/

	private float subtract(float first, float second) {
		return first - second;
	}/*% } if (feature.multiply) { %*/

	private float multiply(float first, float second) {
		return first * second;
	}/*% } %*/
/*→ tip_basicOperationsModule_3 ←*/
