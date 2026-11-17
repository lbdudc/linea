import { describe, expect, it } from 'vitest';
import { parseUvl } from '@lbdudc/linea-core';
import { mandatoryFeaturesOf } from '../model/services/modules/ModularService.js';

const UVL = `features
  Demo
    mandatory
      Core
        mandatory
          Deep
        optional
          Extra
      Gamma
    optional
      Maybe
        mandatory
          NotReached
`;

describe('mandatoryFeaturesOf: what every product has whatever it selects', () => {
  it('is the root and what hangs from it through mandatory groups only', () => {
    expect([...mandatoryFeaturesOf(parseUvl({ content: UVL }))].sort()).toEqual(['Core', 'Deep', 'Demo', 'Gamma']);
  });
});
