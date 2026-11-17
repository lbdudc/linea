import { Bango } from '@lbdudc/bango';

/**
 * A fresh metamodel engine (bango). linea-core is given a factory rather than depending on bango: it needs one engine per check,
 * because the grammars and instances of each SPL or product are loaded into it.
 */
export const createEngine = () => new Bango();
